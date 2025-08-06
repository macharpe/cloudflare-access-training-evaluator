/**
 * Okta API integration for user management
 */

/**
 * Fetch all users from Okta instance
 * @param {*} env - Environment bindings
 * @returns {Array} List of Okta users
 */
export async function fetchOktaUsers(env) {
  try {
    if (!env.OKTA_DOMAIN || !env.OKTA_API_TOKEN) {
      throw new Error(
        'Okta configuration missing: OKTA_DOMAIN and OKTA_API_TOKEN required',
      )
    }

    const response = await fetch(
      `https://${env.OKTA_DOMAIN}/api/v1/users?limit=200`,
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
        `Okta API error: ${response.status} ${response.statusText}`,
      )
    }

    const users = await response.json()
    console.log(`Fetched ${users.length} users from Okta`)

    return users.map((user) => ({
      id: user.id,
      username: user.profile.login.split('@')[0].toLowerCase(), // Extract username from email
      email: user.profile.login,
      firstName: user.profile.firstName,
      lastName: user.profile.lastName,
      status: user.status, // ACTIVE, SUSPENDED, etc.
      created: user.created,
      lastLogin: user.lastLogin,
    }))
  } catch (error) {
    console.error('Error fetching Okta users:', error)
    throw error
  }
}

/**
 * Fetch users from a specific Okta group
 * @param {*} env - Environment bindings
 * @param {string} groupId - Okta group ID
 * @returns {Array} List of users in the group
 */
export async function fetchOktaGroupUsers(env, groupId) {
  try {
    if (!env.OKTA_DOMAIN || !env.OKTA_API_TOKEN) {
      throw new Error(
        'Okta configuration missing: OKTA_DOMAIN and OKTA_API_TOKEN required',
      )
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

    const users = await response.json()
    console.log(`Fetched ${users.length} users from Okta group ${groupId}`)

    return users.map((user) => ({
      id: user.id,
      username: user.profile.login.split('@')[0].toLowerCase(),
      email: user.profile.login,
      firstName: user.profile.firstName,
      lastName: user.profile.lastName,
      status: user.status,
      created: user.created,
      lastLogin: user.lastLogin,
    }))
  } catch (error) {
    console.error('Error fetching Okta group users:', error)
    throw error
  }
}

/**
 * Sync Okta users to the training database
 * @param {*} env - Environment bindings
 * @param {Array} oktaUsers - Users from Okta
 * @returns {Object} Sync results
 */
export async function syncUsersToDatabase(env, oktaUsers) {
  const results = {
    added: 0,
    updated: 0,
    skipped: 0,
    errors: [],
  }

  for (const user of oktaUsers) {
    try {
      // Check if user already exists
      const existingUser = await env.DB.prepare(
        'SELECT id, username FROM users WHERE username = ?',
      )
        .bind(user.username)
        .first()

      if (existingUser) {
        // User exists, update first name and email if missing
        await env.DB.prepare(
          `
          UPDATE users SET first_name = ?, primary_email = ?, updated_at = CURRENT_TIMESTAMP 
          WHERE username = ?
        `,
        )
          .bind(user.firstName, user.email, user.username)
          .run()

        results.updated++
        console.log(`Updated user details for: ${user.username}`)
      } else {
        // Add new user with default "not started" training status and user details
        await env.DB.prepare(
          `
          INSERT INTO users (username, first_name, primary_email, training_status, created_at, updated_at) 
          VALUES (?, ?, ?, 'not started', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        `,
        )
          .bind(user.username, user.firstName, user.email)
          .run()

        results.added++
        console.log(
          `Added new user: ${user.username} (${user.firstName} - ${user.email})`,
        )
      }
    } catch (error) {
      console.error(`Error syncing user ${user.username}:`, error)
      results.errors.push(`${user.username}: ${error.message}`)
    }
  }

  return results
}

/**
 * Get Okta groups (useful for finding group IDs)
 * @param {*} env - Environment bindings
 * @returns {Array} List of Okta groups
 */
export async function fetchOktaGroups(env) {
  try {
    if (!env.OKTA_DOMAIN || !env.OKTA_API_TOKEN) {
      throw new Error(
        'Okta configuration missing: OKTA_DOMAIN and OKTA_API_TOKEN required',
      )
    }

    const response = await fetch(
      `https://${env.OKTA_DOMAIN}/api/v1/groups?limit=200`,
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

    const groups = await response.json()
    return groups.map((group) => ({
      id: group.id,
      name: group.profile.name,
      description: group.profile.description,
      type: group.type,
      created: group.created,
    }))
  } catch (error) {
    console.error('Error fetching Okta groups:', error)
    throw error
  }
}
