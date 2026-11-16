/**
 * Okta API integration for user management
 *
 * Provides functions to fetch users, groups, and synchronize user data
 * between Okta and the training database.
 */

import type { Env, OktaUser } from '../types/index.js'
import {
  isValidOktaDomain,
  isValidGroupId,
  extractUsername,
  sanitizeForLogging,
} from '../utils/validation.js'
import { getCached, setCache, CACHE_CONFIG } from '../utils/cache.js'
import { logCache, logOkta, logPerformance } from '../utils/logging.js'

/**
 * Safety cap on Okta pages followed in one call.
 *
 * With 200 users per page this covers 10,000 users. If the cap is reached the
 * call throws rather than returning a truncated list, because the sync deletes
 * every database user that is missing from the list it receives.
 */
const OKTA_MAX_PAGES = 50

/**
 * Maximum statements per D1 `batch()` call. Each batch runs as a single
 * transaction and counts as one subrequest.
 */
export const SYNC_BATCH_SIZE = 100

/**
 * Extract the `rel="next"` URL from an Okta `Link` response header
 *
 * @param linkHeader - Raw Link header value (may hold several links)
 * @returns Next page URL, or null when this is the last page
 */
export function parseNextLink(linkHeader: string | null): string | null {
  if (!linkHeader) {
    return null
  }
  const match = /<([^>]+)>\s*;\s*rel="next"/i.exec(linkHeader)
  return match?.[1] ?? null
}

/**
 * Fetch every page of an Okta list endpoint
 *
 * Follows `Link: rel="next"` headers. Any failed page, unexpected payload,
 * foreign origin (host or port), embedded credentials, any redirect or page-cap
 * overrun throws, so callers never act on a partial list. The API token is
 * only ever sent to `https://OKTA_DOMAIN` (default port) and never re-sent
 * after a redirect.
 *
 * @param env - Environment bindings
 * @param firstUrl - URL of the first page
 * @returns All items across all pages
 */
export async function fetchOktaPages<T>(
  env: Env,
  firstUrl: string,
): Promise<T[]> {
  const options: RequestInit = {
    headers: {
      Authorization: `SSWS ${env.OKTA_API_TOKEN}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    // Never follow redirects: the SSWS token must not reach another URL. The
    // Workers runtime only supports 'follow' and 'manual' ('error' throws at
    // fetch time), so use 'manual' and reject any 3xx response below.
    redirect: 'manual',
  }
  const expectedHost = env.OKTA_DOMAIN.toLowerCase()
  const items: T[] = []
  let url: string | null = firstUrl
  let pages = 0

  while (url) {
    if (pages >= OKTA_MAX_PAGES) {
      throw new Error(
        `Okta pagination exceeded ${OKTA_MAX_PAGES} pages; refusing to return a partial list`,
      )
    }

    const parsed: URL = new URL(url)
    // `host` includes the port, so a different port is a different origin.
    if (
      parsed.protocol !== 'https:' ||
      parsed.host !== expectedHost ||
      parsed.username !== '' ||
      parsed.password !== ''
    ) {
      throw new Error('Okta pagination link points to an unexpected host')
    }

    const response: Response = await fetch(parsed.toString(), options)
    if (response.status >= 300 && response.status < 400) {
      throw new Error('Okta API redirected the request; refusing to follow it')
    }
    if (!response.ok) {
      throw new Error(
        `Okta API error: ${response.status} ${response.statusText}`,
      )
    }

    const page: unknown = await response.json()
    if (!Array.isArray(page)) {
      throw new Error('Okta API returned an unexpected response shape')
    }

    items.push(...(page as T[]))
    pages++
    url = parseNextLink(response.headers.get('link'))
  }

  return items
}

/**
 * Processed user data structure
 */
export interface ProcessedUser {
  id: string
  username: string
  email: string
  firstName: string
  lastName: string
  status: string
  created: string
  lastLogin: string | null
}

/**
 * Okta directory snapshot returned by {@link fetchOktaDirectory}
 */
export interface OktaDirectory {
  /** Users whose login could be mapped to a username */
  users: ProcessedUser[]
  /**
   * Lower-cased logins that exist in Okta but could not be mapped to a
   * username. They are still present in the directory, so a full sync must
   * never treat them as removed.
   */
  invalidLogins: string[]
}

/**
 * Group fields actually returned by the Okta Groups API
 */
export interface ProcessedGroup {
  id: string
  name: string
  description: string
  type: string
  created: string
  lastUpdated?: string
  lastMembershipUpdated?: string
}

/**
 * Sync statistics result
 */
export interface SyncStats {
  added: number
  updated: number
  removed: number
  skipped: number
  /** Sanitized, user-safe messages only (no raw internal error text) */
  errors: string[]
}

/**
 * Scope of the Okta user list handed to {@link syncUsersToDatabase}
 *
 * - `full`: the complete Okta directory. Database users missing from the list
 *   are treated as removed from Okta and deleted (two-way reconcile), but only
 *   when the add/update phase finished without any error.
 * - `group`: members of a single Okta group. This is a partial view of the
 *   directory, so users outside the group are never deleted (add/update only).
 */
export type SyncScope = 'full' | 'group'

/**
 * Options for {@link syncUsersToDatabase}
 */
export interface SyncOptions {
  /** Required so that deletion is always an explicit decision by the caller */
  scope: SyncScope
  /**
   * Lower-cased emails that must never be deleted (e.g. Okta logins that
   * could not be mapped to a username but still exist in the directory).
   */
  protectedEmails?: Iterable<string>
}

/**
 * Existing database user structure
 */
interface ExistingUser {
  username: string
  first_name: string | null
  primary_email: string | null
}

/**
 * Okta API response for groups
 */
interface OktaGroupResponse {
  id: string
  profile: {
    name: string
    description?: string | null
  }
  type: string
  created: string
  lastUpdated?: string
  lastMembershipUpdated?: string
}

function assertOktaConfig(env: Env): void {
  if (!env.OKTA_DOMAIN || !env.OKTA_API_TOKEN) {
    throw new Error(
      'Okta configuration missing: OKTA_DOMAIN and OKTA_API_TOKEN required',
    )
  }
  if (!isValidOktaDomain(env.OKTA_DOMAIN)) {
    throw new Error('Invalid OKTA_DOMAIN format')
  }
}

/**
 * Map raw Okta users to processed users, collecting unmappable logins
 */
function processOktaUsers(users: OktaUser[]): OktaDirectory {
  const processed: ProcessedUser[] = []
  const invalidLogins: string[] = []

  for (const user of users) {
    const login: unknown = user?.profile?.login
    try {
      processed.push({
        id: user.id,
        username: extractUsername(login as string),
        email: login as string,
        firstName: user.profile.firstName || '',
        lastName: user.profile.lastName || '',
        status: user.status, // ACTIVE, SUSPENDED, etc.
        created: user.created,
        lastLogin: user.lastLogin,
      })
    } catch (error) {
      if (typeof login === 'string' && login.trim() !== '') {
        invalidLogins.push(login.trim().toLowerCase())
      }
      console.warn(
        'Okta user with unusable login kept out of sync:',
        sanitizeForLogging(login),
        'Reason:',
        sanitizeForLogging(
          error instanceof Error ? error.message : String(error),
        ),
      )
    }
  }

  return { users: processed, invalidLogins }
}

/**
 * Fetch the complete Okta user directory
 *
 * The full list (all pages) is cached, so a cache hit never returns a partial
 * list. `fresh: true` bypasses the cache read (use it before any write) and
 * refreshes the cache with the newly fetched list.
 *
 * @param env - Environment bindings
 * @param options - `fresh` bypasses the cache read
 * @returns Mappable users plus logins that could not be mapped
 */
export async function fetchOktaDirectory(
  env: Env,
  options: { fresh?: boolean } = {},
): Promise<OktaDirectory> {
  const startTime = Date.now()

  try {
    assertOktaConfig(env)

    const cacheKey = `${CACHE_CONFIG.OKTA_USERS.key}_${env.OKTA_DOMAIN}`
    const limit = env.OKTA_FETCH_LIMIT || 200
    const url = `https://${env.OKTA_DOMAIN}/api/v1/users?limit=${limit}`

    const cachedUsers = options.fresh ? null : getCached<OktaUser[]>(cacheKey)
    const cacheHit = cachedUsers !== null
    if (!options.fresh) {
      logCache(cacheHit, cacheKey, env)
    }

    let users: OktaUser[]
    if (cachedUsers) {
      users = cachedUsers
    } else {
      users = await fetchOktaPages<OktaUser>(env, url)
      setCache(cacheKey, users, CACHE_CONFIG.OKTA_USERS.ttl)
    }

    const directory = processOktaUsers(users)

    logPerformance('fetchOktaUsers', startTime, env)
    logOkta(
      'fetchUsers',
      true,
      {
        usersCount: directory.users.length,
        invalidLoginsCount: directory.invalidLogins.length,
        rawUsersCount: users.length,
        cacheUsed: cacheHit,
      },
      env,
    )

    return directory
  } catch (error) {
    logOkta(
      'fetchUsers',
      false,
      {
        error: sanitizeForLogging(
          error instanceof Error ? error.message : String(error),
        ),
      },
      env,
    )
    throw error
  }
}

/**
 * Fetch all users from Okta instance (read-only view; may be cached)
 *
 * @param env - Environment bindings
 * @returns List of processed Okta users
 */
export async function fetchOktaUsers(env: Env): Promise<ProcessedUser[]> {
  return (await fetchOktaDirectory(env)).users
}

/**
 * Fetch users from a specific Okta group
 *
 * @param env - Environment bindings
 * @param groupId - Okta group ID
 * @returns List of users in the group
 */
export async function fetchOktaGroupUsers(
  env: Env,
  groupId: string,
): Promise<ProcessedUser[]> {
  try {
    assertOktaConfig(env)

    if (!isValidGroupId(groupId)) {
      throw new Error('Invalid group ID format')
    }

    const users = await fetchOktaPages<OktaUser>(
      env,
      `https://${env.OKTA_DOMAIN}/api/v1/groups/${groupId}/users?limit=200`,
    )
    console.log('Fetched', users.length, 'users from Okta group:', groupId)

    return processOktaUsers(users).users
  } catch (error) {
    console.error(
      'Error fetching Okta group users:',
      sanitizeForLogging(
        error instanceof Error ? error.message : String(error),
      ),
    )
    throw error
  }
}

const lower = (value: string | null | undefined): string =>
  (value ?? '').trim().toLowerCase()

/**
 * Run statements through `env.DB.batch()` in transactional chunks
 *
 * @returns Sum of changed rows, or null when a chunk failed (that chunk was
 *   rolled back; earlier chunks stay committed). Later chunks are not run.
 */
async function runInChunks(
  env: Env,
  statements: D1PreparedStatement[],
  phase: string,
  results: SyncStats,
): Promise<number | null> {
  let changes = 0
  const total = Math.ceil(statements.length / SYNC_BATCH_SIZE)
  for (let i = 0; i < total; i++) {
    const chunk = statements.slice(
      i * SYNC_BATCH_SIZE,
      (i + 1) * SYNC_BATCH_SIZE,
    )
    try {
      const batchResults = await env.DB.batch(chunk)
      for (const r of batchResults) {
        changes += r.meta?.changes ?? 0
      }
    } catch (error) {
      console.error(
        `Sync ${phase} batch ${i + 1}/${total} failed:`,
        sanitizeForLogging(
          error instanceof Error ? error.message : String(error),
        ),
      )
      results.errors.push(
        `Database ${phase} batch ${i + 1} of ${total} failed and was rolled back; remaining changes were not applied.`,
      )
      return null
    }
  }
  return changes
}

/**
 * Sync Okta users to the training database
 *
 * Identity is the full email: the `username` column is only the email local
 * part, so a database row is treated as the same person only when its
 * `primary_email` matches the Okta login case-insensitively. Mismatches and
 * ambiguous usernames are reported for manual review and never written, so a
 * new person can never inherit another person's training status.
 *
 * New users are added as `not started`; existing users only get `first_name`
 * refreshed. Training status is never touched. Writes go through D1 batches
 * (one transaction per chunk of {@link SYNC_BATCH_SIZE}). Only a `full` scope
 * with an error-free add/update phase removes database users absent from the
 * directory; protected emails are never removed.
 *
 * @param env - Environment bindings
 * @param oktaUsers - Users from Okta
 * @param options - Sync options; `scope` decides whether removal runs
 * @returns Sync results statistics (sanitized errors only)
 */
export async function syncUsersToDatabase(
  env: Env,
  oktaUsers: ProcessedUser[],
  options: SyncOptions,
): Promise<SyncStats> {
  const results: SyncStats = {
    added: 0,
    updated: 0,
    removed: 0,
    skipped: 0,
    errors: [],
  }

  let existingRows: ExistingUser[]
  try {
    const existingUsersResult = await env.DB.prepare(
      'SELECT username, first_name, primary_email FROM users',
    ).all<ExistingUser>()
    existingRows = existingUsersResult.results ?? []
  } catch (error) {
    console.error(
      'Sync could not read existing users:',
      sanitizeForLogging(
        error instanceof Error ? error.message : String(error),
      ),
    )
    results.errors.push(
      'Could not read existing users from the database; nothing was changed.',
    )
    return results
  }

  const existingByUsername = new Map<string, ExistingUser>()
  const usernamesByEmail = new Map<string, Set<string>>()
  for (const row of existingRows) {
    existingByUsername.set(row.username, row)
    const email = lower(row.primary_email)
    if (email) {
      const set = usernamesByEmail.get(email) ?? new Set<string>()
      set.add(row.username)
      usernamesByEmail.set(email, set)
    }
  }

  // Group Okta users by username, collapsing exact duplicates (same email).
  const oktaByUsername = new Map<string, Map<string, ProcessedUser>>()
  for (const user of oktaUsers) {
    const byEmail =
      oktaByUsername.get(user.username) ?? new Map<string, ProcessedUser>()
    if (!byEmail.has(lower(user.email))) {
      byEmail.set(lower(user.email), user)
    }
    oktaByUsername.set(user.username, byEmail)
  }
  const oktaEmails = new Set(oktaUsers.map((u) => lower(u.email)))

  const insertSql = `
          INSERT INTO users (username, first_name, primary_email, training_status, created_at, updated_at)
          VALUES (?, ?, ?, 'not started', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        `
  const updateSql = `
          UPDATE users SET first_name = ?, updated_at = CURRENT_TIMESTAMP
          WHERE username = ? AND lower(primary_email) = lower(?)
        `
  const inserts: D1PreparedStatement[] = []
  const updates: D1PreparedStatement[] = []
  const conflict = (username: string) =>
    results.errors.push(
      `identity conflict for username ${sanitizeForLogging(username)}: needs manual review`,
    )

  for (const [username, byEmail] of oktaByUsername) {
    const row = existingByUsername.get(username)

    if (byEmail.size > 1) {
      // Several distinct Okta identities map to one username: never guess.
      conflict(username)
      continue
    }

    const user = [...byEmail.values()][0]!
    const email = lower(user.email)

    if (row) {
      if (lower(row.primary_email) !== email) {
        // Same local part, different person (or changed login): do not write,
        // do not inherit status, do not delete.
        conflict(username)
        continue
      }
      if ((row.first_name ?? '') !== user.firstName) {
        updates.push(
          env.DB.prepare(updateSql).bind(user.firstName, username, user.email),
        )
      } else {
        results.skipped++
      }
      continue
    }

    // New username: refuse if that email already belongs to another row.
    if (usernamesByEmail.has(email)) {
      conflict(username)
      continue
    }
    inserts.push(
      env.DB.prepare(insertSql).bind(username, user.firstName, user.email),
    )
  }

  const added = await runInChunks(env, inserts, 'insert', results)
  if (added === null) {
    results.errors.push('Removal skipped because a database write failed.')
    return results
  }
  results.added = added

  const updated = await runInChunks(env, updates, 'update', results)
  if (updated === null) {
    results.errors.push('Removal skipped because a database write failed.')
    return results
  }
  results.updated = updated

  // Only a complete directory snapshot can prove absence; a group list is
  // partial, so it never deletes.
  if (options.scope !== 'full') {
    return results
  }

  const protectedEmails = new Set(
    [...(options.protectedEmails ?? [])].map((e) => lower(e)),
  )
  const candidates = existingRows.filter((row) => {
    if (oktaByUsername.has(row.username)) return false
    const email = lower(row.primary_email)
    if (email && (protectedEmails.has(email) || oktaEmails.has(email))) {
      console.warn(
        'Keeping user still present in Okta under another login form:',
        sanitizeForLogging(row.username),
      )
      return false
    }
    return true
  })

  if (results.errors.length > 0) {
    if (candidates.length > 0) {
      results.errors.push(
        `Removal skipped because of the errors above; ${candidates.length} user(s) no longer in Okta were kept.`,
      )
    }
    return results
  }

  if (oktaUsers.length === 0 && candidates.length > 0) {
    // An empty directory would delete everyone: refuse.
    results.errors.push(
      'Removal skipped because the Okta directory returned no users.',
    )
    return results
  }

  const deletes = candidates.map((row) =>
    env.DB.prepare('DELETE FROM users WHERE username = ?').bind(row.username),
  )
  const removed = await runInChunks(env, deletes, 'removal', results)
  if (removed !== null) {
    results.removed = removed
  }

  return results
}

/**
 * Get Okta groups (useful for finding group IDs)
 *
 * Follows pagination; only a complete list is cached.
 *
 * @param env - Environment bindings
 * @returns List of Okta groups (only fields Okta actually returned)
 */
export async function fetchOktaGroups(env: Env): Promise<ProcessedGroup[]> {
  try {
    assertOktaConfig(env)

    const cacheKey = `${CACHE_CONFIG.OKTA_GROUPS.key}_${env.OKTA_DOMAIN}`
    const cached = getCached<ProcessedGroup[]>(cacheKey)
    logCache(cached !== null, cacheKey, env)
    if (cached) {
      return cached
    }

    const limit = env.OKTA_FETCH_LIMIT || 200
    const raw = await fetchOktaPages<OktaGroupResponse>(
      env,
      `https://${env.OKTA_DOMAIN}/api/v1/groups?limit=${limit}`,
    )

    const groups = raw.map((group): ProcessedGroup => {
      const processed: ProcessedGroup = {
        id: group.id,
        name: group.profile?.name ?? '',
        description: group.profile?.description ?? '',
        type: group.type,
        created: group.created,
      }
      if (typeof group.lastUpdated === 'string') {
        processed.lastUpdated = group.lastUpdated
      }
      if (typeof group.lastMembershipUpdated === 'string') {
        processed.lastMembershipUpdated = group.lastMembershipUpdated
      }
      return processed
    })

    setCache(cacheKey, groups, CACHE_CONFIG.OKTA_GROUPS.ttl)
    return groups
  } catch (error) {
    console.error(
      'Error fetching Okta groups:',
      sanitizeForLogging(
        error instanceof Error ? error.message : String(error),
      ),
    )
    throw error
  }
}
