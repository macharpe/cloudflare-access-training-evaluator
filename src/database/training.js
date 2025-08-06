/**
 * Training certification database operations
 */

/**
 * Initialize the D1 database with users table and data
 * @param {*} env - Environment bindings including DB
 * @returns {Promise<boolean>} Success status
 */
export async function initializeDatabase(env) {
  try {
    // Create users table
    await env.DB.prepare(
      `
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        first_name TEXT,
        primary_email TEXT,
        training_status TEXT NOT NULL CHECK (training_status IN ('not started', 'started', 'completed')),
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `,
    ).run()

    // Create indexes for faster lookups
    await env.DB.prepare(
      `
      CREATE INDEX IF NOT EXISTS idx_users_username ON users(username)
    `,
    ).run()

    await env.DB.prepare(
      `
      CREATE INDEX IF NOT EXISTS idx_users_email ON users(primary_email)
    `,
    ).run()

    // Apply migration to add new columns if they don't exist
    try {
      await env.DB.prepare(`ALTER TABLE users ADD COLUMN first_name TEXT`).run()
    } catch (e) {
      // Column already exists
    }

    try {
      await env.DB.prepare(
        `ALTER TABLE users ADD COLUMN primary_email TEXT`,
      ).run()
    } catch (e) {
      // Column already exists
    }

    // No initial user data - users will be synced from Okta

    console.log('Database initialized successfully')
    return true
  } catch (error) {
    console.error('Database initialization error:', error)
    return false
  }
}

/**
 * Get user training status from D1 database
 * @param {*} env - Environment bindings including DB
 * @param {string} username - Username to lookup
 * @returns {Promise<string|null>} Training status or null if user not found
 */
export async function getUserTrainingStatus(env, username) {
  try {
    const result = await env.DB.prepare(
      'SELECT training_status FROM users WHERE username = ?',
    )
      .bind(username)
      .first()

    return result ? result.training_status : null
  } catch (error) {
    console.error('Database error:', error)
    return null
  }
}

/**
 * Update user training status by username
 * @param {*} env - Environment bindings including DB
 * @param {string} username - Username to update
 * @param {string} status - New training status
 * @returns {Promise<boolean>} Success status
 */
export async function updateUserTrainingStatus(env, username, status) {
  try {
    const result = await env.DB.prepare(
      `
      UPDATE users SET training_status = ?, updated_at = CURRENT_TIMESTAMP 
      WHERE username = ?
    `,
    )
      .bind(status, username)
      .run()

    // Check both result.changes and result.meta.changes for compatibility
    const changes = result.changes || result.meta?.changes || 0
    return changes > 0
  } catch (error) {
    console.error('Database update error:', error)
    return false
  }
}

/**
 * Update user training status by email
 * @param {*} env - Environment bindings including DB
 * @param {string} email - Email to update
 * @param {string} status - New training status
 * @returns {Promise<boolean>} Success status
 */
export async function updateUserTrainingStatusByEmail(env, email, status) {
  try {
    const result = await env.DB.prepare(
      `
      UPDATE users SET training_status = ?, updated_at = CURRENT_TIMESTAMP 
      WHERE primary_email = ?
    `,
    )
      .bind(status, email)
      .run()

    // Check both result.changes and result.meta.changes for compatibility
    const changes = result.changes || result.meta?.changes || 0
    return changes > 0
  } catch (error) {
    console.error('Database update error:', error)
    return false
  }
}
