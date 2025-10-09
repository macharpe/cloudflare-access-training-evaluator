/**
 * Okta synchronization handlers
 *
 * Handles Okta user sync, groups list, and users list endpoints.
 */

import type { Env, OktaGroup } from '../types/index.js'
import type { ProcessedUser, SyncStats } from '../integrations/okta.js'
import {
  fetchOktaUsers,
  fetchOktaGroupUsers,
  fetchOktaGroups,
  syncUsersToDatabase,
} from '../integrations/okta.js'
import { createCSPHeaders } from '../security/csp.js'

/**
 * Sync response structure
 */
interface SyncResponse {
  success: boolean
  message: string
  results?: SyncStats
  oktaUsers?: number
  error?: string
}

/**
 * Groups response structure
 */
interface GroupsResponse {
  success: boolean
  groups?: OktaGroup[]
  count?: number
  message?: string
}

/**
 * Users response structure
 */
interface UsersResponse {
  success: boolean
  users?: ProcessedUser[]
  count?: number
  message?: string
}

/**
 * Create secure headers for JSON responses
 *
 * @param env - Environment bindings
 * @returns Headers with CSP and security headers
 */
function createSecureJSONHeaders(env: Env): Record<string, string> {
  return {
    'content-type': 'application/json',
    ...createCSPHeaders(env),
  }
}

/**
 * Handle Okta user sync request
 *
 * @param env - Environment bindings
 * @param request - HTTP request
 * @returns JSON response
 */
export async function handleOktaSync(
  env: Env,
  request: Request,
): Promise<Response> {
  try {
    // Check if Okta is configured
    if (!env.OKTA_DOMAIN || !env.OKTA_API_TOKEN) {
      const response: SyncResponse = {
        success: false,
        message:
          'Okta integration not configured. Please set OKTA_DOMAIN and OKTA_API_TOKEN environment variables.',
      }
      return new Response(JSON.stringify(response), {
        status: 400,
        headers: createSecureJSONHeaders(env),
      })
    }

    const url = new URL(request.url)
    const groupId = url.searchParams.get('groupId')

    let oktaUsers: ProcessedUser[]
    if (groupId) {
      console.log('Syncing users from Okta group:', groupId)
      oktaUsers = await fetchOktaGroupUsers(env, groupId)
    } else {
      console.log('Syncing all users from Okta')
      oktaUsers = await fetchOktaUsers(env)
    }

    if (oktaUsers.length === 0) {
      const response: SyncResponse = {
        success: true,
        message: 'No users found in Okta',
        results: { added: 0, updated: 0, removed: 0, skipped: 0, errors: [] },
      }
      return new Response(JSON.stringify(response), {
        headers: createSecureJSONHeaders(env),
      })
    }

    // Sync users to database
    const syncResults = await syncUsersToDatabase(env, oktaUsers)

    const response: SyncResponse = {
      success: true,
      message: `Sync completed. Added: ${syncResults.added}, Updated: ${syncResults.updated}, Removed: ${syncResults.removed}, Errors: ${syncResults.errors.length}`,
      results: syncResults,
      oktaUsers: oktaUsers.length,
    }

    return new Response(JSON.stringify(response), {
      headers: { 'content-type': 'application/json' },
    })
  } catch (error) {
    console.error('Okta sync error:', error)
    const errorMessage = error instanceof Error ? error.message : String(error)
    const response: SyncResponse = {
      success: false,
      message: errorMessage,
      error: errorMessage,
    }

    return new Response(JSON.stringify(response), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    })
  }
}

/**
 * Handle Okta groups list request
 *
 * @param env - Environment bindings
 * @returns JSON response
 */
export async function handleOktaGroups(env: Env): Promise<Response> {
  try {
    if (!env.OKTA_DOMAIN || !env.OKTA_API_TOKEN) {
      const response: GroupsResponse = {
        success: false,
        message: 'Okta integration not configured',
      }
      return new Response(JSON.stringify(response), {
        status: 400,
        headers: createSecureJSONHeaders(env),
      })
    }

    const groups = await fetchOktaGroups(env)

    const response: GroupsResponse = {
      success: true,
      groups: groups,
      count: groups.length,
    }

    return new Response(JSON.stringify(response), {
      headers: { 'content-type': 'application/json' },
    })
  } catch (error) {
    console.error('Okta groups error:', error)
    const errorMessage = error instanceof Error ? error.message : String(error)
    const response: GroupsResponse = {
      success: false,
      message: errorMessage,
    }

    return new Response(JSON.stringify(response), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    })
  }
}

/**
 * Handle request to view Okta users (without syncing)
 *
 * @param env - Environment bindings
 * @param request - HTTP request
 * @returns JSON response
 */
export async function handleOktaUsers(
  env: Env,
  request: Request,
): Promise<Response> {
  try {
    if (!env.OKTA_DOMAIN || !env.OKTA_API_TOKEN) {
      const response: UsersResponse = {
        success: false,
        message: 'Okta integration not configured',
      }
      return new Response(JSON.stringify(response), {
        status: 400,
        headers: createSecureJSONHeaders(env),
      })
    }

    const url = new URL(request.url)
    const groupId = url.searchParams.get('groupId')

    let oktaUsers: ProcessedUser[]
    if (groupId) {
      oktaUsers = await fetchOktaGroupUsers(env, groupId)
    } else {
      oktaUsers = await fetchOktaUsers(env)
    }

    const response: UsersResponse = {
      success: true,
      users: oktaUsers,
      count: oktaUsers.length,
    }

    return new Response(JSON.stringify(response), {
      headers: { 'content-type': 'application/json' },
    })
  } catch (error) {
    console.error('Okta users error:', error)
    const errorMessage = error instanceof Error ? error.message : String(error)
    const response: UsersResponse = {
      success: false,
      message: errorMessage,
    }

    return new Response(JSON.stringify(response), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    })
  }
}
