import {
  fetchOktaUsers,
  fetchOktaGroupUsers,
  fetchOktaGroups,
  syncUsersToDatabase,
} from '../integrations/okta.js'

/**
 * Handle Okta user sync request
 * @param {*} env - Environment bindings
 * @param {Request} request - HTTP request
 * @returns {Response} JSON response
 */
export async function handleOktaSync(env, request) {
  try {
    // Check if Okta is configured
    if (!env.OKTA_DOMAIN || !env.OKTA_API_TOKEN) {
      return new Response(
        JSON.stringify({
          success: false,
          message:
            'Okta integration not configured. Please set OKTA_DOMAIN and OKTA_API_TOKEN environment variables.',
        }),
        {
          status: 400,
          headers: { 'content-type': 'application/json' },
        },
      )
    }

    const url = new URL(request.url)
    const groupId = url.searchParams.get('groupId')

    let oktaUsers
    if (groupId) {
      console.log('Syncing users from Okta group:', groupId)
      oktaUsers = await fetchOktaGroupUsers(env, groupId)
    } else {
      console.log('Syncing all users from Okta')
      oktaUsers = await fetchOktaUsers(env)
    }

    if (oktaUsers.length === 0) {
      return new Response(
        JSON.stringify({
          success: true,
          message: 'No users found in Okta',
          results: { added: 0, updated: 0, skipped: 0, errors: [] },
        }),
        {
          headers: { 'content-type': 'application/json' },
        },
      )
    }

    // Sync users to database
    const syncResults = await syncUsersToDatabase(env, oktaUsers)

    return new Response(
      JSON.stringify({
        success: true,
        message: `Sync completed. Added: ${syncResults.added}, Updated: ${syncResults.updated}, Removed: ${syncResults.removed}, Errors: ${syncResults.errors.length}`,
        results: syncResults,
        oktaUsers: oktaUsers.length,
      }),
      {
        headers: { 'content-type': 'application/json' },
      },
    )
  } catch (error) {
    console.error('Okta sync error:', error)
    return new Response(
      JSON.stringify({
        success: false,
        message: error.message,
        error: error.toString(),
      }),
      {
        status: 500,
        headers: { 'content-type': 'application/json' },
      },
    )
  }
}

/**
 * Handle Okta groups list request
 * @param {*} env - Environment bindings
 * @returns {Response} JSON response
 */
export async function handleOktaGroups(env) {
  try {
    if (!env.OKTA_DOMAIN || !env.OKTA_API_TOKEN) {
      return new Response(
        JSON.stringify({
          success: false,
          message: 'Okta integration not configured',
        }),
        {
          status: 400,
          headers: { 'content-type': 'application/json' },
        },
      )
    }

    const groups = await fetchOktaGroups(env)

    return new Response(
      JSON.stringify({
        success: true,
        groups: groups,
        count: groups.length,
      }),
      {
        headers: { 'content-type': 'application/json' },
      },
    )
  } catch (error) {
    console.error('Okta groups error:', error)
    return new Response(
      JSON.stringify({
        success: false,
        message: error.message,
      }),
      {
        status: 500,
        headers: { 'content-type': 'application/json' },
      },
    )
  }
}

/**
 * Handle request to view Okta users (without syncing)
 * @param {*} env - Environment bindings
 * @param {Request} request - HTTP request
 * @returns {Response} JSON response
 */
export async function handleOktaUsers(env, request) {
  try {
    if (!env.OKTA_DOMAIN || !env.OKTA_API_TOKEN) {
      return new Response(
        JSON.stringify({
          success: false,
          message: 'Okta integration not configured',
        }),
        {
          status: 400,
          headers: { 'content-type': 'application/json' },
        },
      )
    }

    const url = new URL(request.url)
    const groupId = url.searchParams.get('groupId')

    let oktaUsers
    if (groupId) {
      oktaUsers = await fetchOktaGroupUsers(env, groupId)
    } else {
      oktaUsers = await fetchOktaUsers(env)
    }

    return new Response(
      JSON.stringify({
        success: true,
        users: oktaUsers,
        count: oktaUsers.length,
      }),
      {
        headers: { 'content-type': 'application/json' },
      },
    )
  } catch (error) {
    console.error('Okta users error:', error)
    return new Response(
      JSON.stringify({
        success: false,
        message: error.message,
      }),
      {
        status: 500,
        headers: { 'content-type': 'application/json' },
      },
    )
  }
}
