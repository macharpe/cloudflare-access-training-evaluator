/**
 * Okta API integration for user management
 */

import {
  isValidOktaDomain,
  isValidGroupId,
  extractUsername,
  sanitizeForLogging,
} from '../utils/validation.js'
import { cachedFetch, CACHE_CONFIG } from '../utils/cache.js'
import { logOkta, logPerformance } from '../utils/logging.js'

/**
 * Fetch all users from Okta instance
 * @param {*} env - Environment bindings
 * @returns {Array} List of Okta users
 */
export async function fetchOktaUsers(env) {
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
    const limit = env.OKTA_FETCH_LIMIT || 200
    const url = `https://${env.OKTA_DOMAIN}/api/v1/users?limit=${limit}`
    const options = {
      headers: {
        Authorization: `SSWS ${env.OKTA_API_TOKEN}`,
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
    }

    const response = await cachedFetch(
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

    const users = await response.json()

    const processedUsers = users
      .map((user) => {
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
            `Invalid user data for ${sanitizeForLogging(user.profile.login)}:`,
            error.message,
          )
          return null
        }
      })
      .filter((user) => user !== null)

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
    logOkta('fetchUsers', false, { error: error.message }, env)
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

    const users = await response.json()
    console.log('Fetched', users.length, 'users from Okta group:', groupId)

    return users
      .map((user) => {
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
            `Invalid user data for ${sanitizeForLogging(user.profile.login)}:`,
            error.message,
          )
          return null
        }
      })
      .filter((user) => user !== null)
  } catch (error) {
    console.error('Error fetching Okta group users:', error)
    throw error
  }
}

/**
 * Sync Okta users to the training database with two-way sync (add, update, and remove)
 * @param {*} env - Environment bindings
 * @param {Array} oktaUsers - Users from Okta
 * @returns {Object} Sync results
 */
export async function syncUsersToDatabase(env, oktaUsers) {
  const results = {
    added: 0,
    updated: 0,
    removed: 0,
    skipped: 0,
    errors: [],
  }

  try {
    // Get all existing users from database
    const existingUsers = await env.DB.prepare(
      'SELECT username, first_name, primary_email FROM users',
    ).all()

    const existingUserMap = new Map()
    existingUsers.results.forEach((user) => {
      existingUserMap.set(user.username, user)
    })

    const oktaUsernames = new Set(oktaUsers.map((user) => user.username))

    // Batch process users for better performance
    const usersToAdd = []
    const usersToUpdate = []

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
        results.errors.push(`${user.username}: ${error.message}`)
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
        results.errors.push(`Batch insert: ${error.message}`)
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
        results.errors.push(`Batch update: ${error.message}`)
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
          const changes =
            deleteResult.changes || deleteResult.meta?.changes || 0
          if (changes > 0) {
            results.removed++
            console.log('Removed user no longer in Okta:', username)
          }
        }
      } catch (error) {
        console.error('Error in batch removal:', error)
        results.errors.push(`Batch removal: ${error.message}`)
      }
    }
  } catch (error) {
    console.error('Error during sync process:', error)
    results.errors.push(`Sync process: ${error.message}`)
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

    const cacheKey = `${CACHE_CONFIG.OKTA_GROUPS.key}_${env.OKTA_DOMAIN}`
    const limit = env.OKTA_FETCH_LIMIT || 200
    const url = `https://${env.OKTA_DOMAIN}/api/v1/groups?limit=${limit}`
    const options = {
      headers: {
        Authorization: `SSWS ${env.OKTA_API_TOKEN}`,
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
    }

    const response = await cachedFetch(
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
