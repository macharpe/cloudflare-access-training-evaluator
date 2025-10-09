/**
 * Okta API integration for user management
 *
 * Provides functions to fetch users, groups, and synchronize user data
 * between Okta and the training database.
 */

import type { Env, OktaUser, OktaGroup } from '../types/index.js'
import {
  isValidOktaDomain,
  isValidGroupId,
  extractUsername,
  sanitizeForLogging,
} from '../utils/validation.js'
import { cachedFetch, CACHE_CONFIG } from '../utils/cache.js'
import { logOkta, logPerformance } from '../utils/logging.js'

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
 * Sync statistics result
 */
export interface SyncStats {
  added: number
  updated: number
  removed: number
  skipped: number
  errors: string[]
}

/**
 * Existing database user structure
 */
interface ExistingUser {
  username: string
  first_name: string
  primary_email: string
}

/**
 * Okta API response for groups
 */
interface OktaGroupResponse {
  id: string
  profile: {
    name: string
    description?: string
  }
  type: string
  created: string
}

/**
 * Fetch all users from Okta instance
 *
 * @param env - Environment bindings
 * @returns List of processed Okta users
 */
export async function fetchOktaUsers(env: Env): Promise<ProcessedUser[]> {
  const startTime = Date.now()

  try {
    if (!env.OKTA_DOMAIN || !env.OKTA_API_TOKEN) {
      throw new Error(
        'Okta configuration missing: OKTA_DOMAIN and OKTA_API_TOKEN required',
      )
    }

    // Validate Okta domain
    if (!isValidOktaDomain(env.OKTA_DOMAIN)) {
      throw new Error('Invalid OKTA_DOMAIN format')
    }

    const cacheKey = `${CACHE_CONFIG.OKTA_USERS.key}_${env.OKTA_DOMAIN}`
    const limit = (env as { OKTA_FETCH_LIMIT?: number }).OKTA_FETCH_LIMIT || 200
    const url = `https://${env.OKTA_DOMAIN}/api/v1/users?limit=${limit}`
    const options: RequestInit = {
      headers: {
        Authorization: `SSWS ${env.OKTA_API_TOKEN}`,
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
    }

    const response = await cachedFetch<OktaUser[]>(
      url,
      options,
      cacheKey,
      CACHE_CONFIG.OKTA_USERS.ttl,
      env,
    )

    if (!response.ok) {
      throw new Error(
        `Okta API error: ${response.status} ${response.statusText}`,
      )
    }

    const users = (await response.json()) as OktaUser[]

    const processedUsers = users
      .map((user: OktaUser): ProcessedUser | null => {
        try {
          return {
            id: user.id,
            username: extractUsername(user.profile.login), // Extract and validate username
            email: user.profile.login,
            firstName: user.profile.firstName || '',
            lastName: user.profile.lastName || '',
            status: user.status, // ACTIVE, SUSPENDED, etc.
            created: user.created,
            lastLogin: user.lastLogin,
          }
        } catch (error) {
          console.error(
            'Invalid user data for user:',
            sanitizeForLogging(user.profile.login),
            'Error:',
            error instanceof Error ? error.message : String(error),
          )
          return null
        }
      })
      .filter((user): user is ProcessedUser => user !== null)

    logPerformance('fetchOktaUsers', startTime, env)
    logOkta(
      'fetchUsers',
      true,
      {
        usersCount: processedUsers.length,
        rawUsersCount: users.length,
        cacheUsed: response.headers.get('x-cache') === 'HIT',
      },
      env,
    )

    return processedUsers
  } catch (error) {
    logOkta(
      'fetchUsers',
      false,
      { error: error instanceof Error ? error.message : String(error) },
      env,
    )
    throw error
  }
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
    if (!env.OKTA_DOMAIN || !env.OKTA_API_TOKEN) {
      throw new Error(
        'Okta configuration missing: OKTA_DOMAIN and OKTA_API_TOKEN required',
      )
    }

    // Validate inputs
    if (!isValidOktaDomain(env.OKTA_DOMAIN)) {
      throw new Error('Invalid OKTA_DOMAIN format')
    }

    if (!isValidGroupId(groupId)) {
      throw new Error('Invalid group ID format')
    }

    const response = await fetch(
      `https://${env.OKTA_DOMAIN}/api/v1/groups/${groupId}/users`,
      {
        headers: {
          Authorization: `SSWS ${env.OKTA_API_TOKEN}`,
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
      },
    )

    if (!response.ok) {
      throw new Error(
        `Okta Groups API error: ${response.status} ${response.statusText}`,
      )
    }

    const users = (await response.json()) as OktaUser[]
    console.log('Fetched', users.length, 'users from Okta group:', groupId)

    return users
      .map((user: OktaUser): ProcessedUser | null => {
        try {
          return {
            id: user.id,
            username: extractUsername(user.profile.login),
            email: user.profile.login,
            firstName: user.profile.firstName || '',
            lastName: user.profile.lastName || '',
            status: user.status,
            created: user.created,
            lastLogin: user.lastLogin,
          }
        } catch (error) {
          console.error(
            'Invalid user data for user:',
            sanitizeForLogging(user.profile.login),
            'Error:',
            error instanceof Error ? error.message : String(error),
          )
          return null
        }
      })
      .filter((user): user is ProcessedUser => user !== null)
  } catch (error) {
    console.error('Error fetching Okta group users:', error)
    throw error
  }
}

/**
 * Sync Okta users to the training database with two-way sync (add, update, and remove)
 *
 * @param env - Environment bindings
 * @param oktaUsers - Users from Okta
 * @returns Sync results statistics
 */
export async function syncUsersToDatabase(
  env: Env,
  oktaUsers: ProcessedUser[],
): Promise<SyncStats> {
  const results: SyncStats = {
    added: 0,
    updated: 0,
    removed: 0,
    skipped: 0,
    errors: [],
  }

  try {
    // Get all existing users from database
    const existingUsersResult = await env.DB.prepare(
      'SELECT username, first_name, primary_email FROM users',
    ).all<ExistingUser>()

    const existingUserMap = new Map<string, ExistingUser>()
    existingUsersResult.results.forEach((user) => {
      existingUserMap.set(user.username, user)
    })

    const oktaUsernames = new Set(oktaUsers.map((user) => user.username))

    // Batch process users for better performance
    const usersToAdd: ProcessedUser[] = []
    const usersToUpdate: ProcessedUser[] = []

    // Categorize users for batch operations
    for (const user of oktaUsers) {
      try {
        const existingUser = existingUserMap.get(user.username)

        if (existingUser) {
          // Check if update is needed
          if (
            existingUser.first_name !== user.firstName ||
            existingUser.primary_email !== user.email
          ) {
            usersToUpdate.push(user)
          } else {
            results.skipped++
          }
        } else {
          usersToAdd.push(user)
        }
      } catch (error) {
        console.error('Error categorizing user:', user.username, error)
        results.errors.push(
          `${user.username}: ${error instanceof Error ? error.message : String(error)}`,
        )
      }
    }

    // Batch insert new users
    if (usersToAdd.length > 0) {
      try {
        // Use transaction for batch insert
        const insertStmt = env.DB.prepare(`
          INSERT INTO users (username, first_name, primary_email, training_status, created_at, updated_at)
          VALUES (?, ?, ?, 'not started', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        `)

        for (const user of usersToAdd) {
          await insertStmt.bind(user.username, user.firstName, user.email).run()
          results.added++
          console.log(
            `Added new user: ${user.username} (${user.firstName} - ${user.email})`,
          )
        }
      } catch (error) {
        console.error('Error in batch insert:', error)
        results.errors.push(
          `Batch insert: ${error instanceof Error ? error.message : String(error)}`,
        )
      }
    }

    // Batch update existing users
    if (usersToUpdate.length > 0) {
      try {
        const updateStmt = env.DB.prepare(`
          UPDATE users SET first_name = ?, primary_email = ?, updated_at = CURRENT_TIMESTAMP
          WHERE username = ?
        `)

        for (const user of usersToUpdate) {
          await updateStmt.bind(user.firstName, user.email, user.username).run()
          results.updated++
          console.log('Updated user details for:', user.username)
        }
      } catch (error) {
        console.error('Error in batch update:', error)
        results.errors.push(
          `Batch update: ${error instanceof Error ? error.message : String(error)}`,
        )
      }
    }

    // Remove users that no longer exist in Okta
    const usersToRemove = [...existingUserMap.keys()].filter(
      (username) => !oktaUsernames.has(username),
    )

    if (usersToRemove.length > 0) {
      try {
        const deleteStmt = env.DB.prepare(
          'DELETE FROM users WHERE username = ?',
        )

        for (const username of usersToRemove) {
          const deleteResult = await deleteStmt.bind(username).run()
          const changes = deleteResult.meta?.changes || 0
          if (changes > 0) {
            results.removed++
            console.log('Removed user no longer in Okta:', username)
          }
        }
      } catch (error) {
        console.error('Error in batch removal:', error)
        results.errors.push(
          `Batch removal: ${error instanceof Error ? error.message : String(error)}`,
        )
      }
    }
  } catch (error) {
    console.error('Error during sync process:', error)
    results.errors.push(
      `Sync process: ${error instanceof Error ? error.message : String(error)}`,
    )
  }

  return results
}

/**
 * Get Okta groups (useful for finding group IDs)
 *
 * @param env - Environment bindings
 * @returns List of Okta groups
 */
export async function fetchOktaGroups(env: Env): Promise<OktaGroup[]> {
  try {
    if (!env.OKTA_DOMAIN || !env.OKTA_API_TOKEN) {
      throw new Error(
        'Okta configuration missing: OKTA_DOMAIN and OKTA_API_TOKEN required',
      )
    }

    const cacheKey = `${CACHE_CONFIG.OKTA_GROUPS.key}_${env.OKTA_DOMAIN}`
    const limit = (env as { OKTA_FETCH_LIMIT?: number }).OKTA_FETCH_LIMIT || 200
    const url = `https://${env.OKTA_DOMAIN}/api/v1/groups?limit=${limit}`
    const options: RequestInit = {
      headers: {
        Authorization: `SSWS ${env.OKTA_API_TOKEN}`,
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
    }

    const response = await cachedFetch<OktaGroupResponse[]>(
      url,
      options,
      cacheKey,
      CACHE_CONFIG.OKTA_GROUPS.ttl,
    )

    if (!response.ok) {
      throw new Error(
        `Okta Groups API error: ${response.status} ${response.statusText}`,
      )
    }

    const groups = (await response.json()) as OktaGroupResponse[]
    return groups.map((group: OktaGroupResponse): OktaGroup => {
      return {
        id: group.id,
        created: group.created,
        lastUpdated: group.created, // Using created as default since API doesn't return lastUpdated
        lastMembershipUpdated: group.created,
        objectClass: [],
        type: group.type,
        profile: {
          name: group.profile.name,
          description: group.profile.description || '',
        },
        _links: {
          logo: [],
          users: { href: '' },
          apps: { href: '' },
        },
      }
    })
  } catch (error) {
    console.error('Error fetching Okta groups:', error)
    throw error
  }
}
