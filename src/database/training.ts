/**
 * Training certification database operations
 *
 * Provides CRUD operations for user training status in D1 database.
 */

import type { Env, TrainingStatus } from '../types'
import { isTrainingStatus } from '../types/guards'
import { sanitizeForLogging } from '../utils/validation.js'

/**
 * Initialize the D1 database with users table and indexes
 *
 * @param env - Environment bindings including DB
 * @returns Success status
 */
export async function initializeDatabase(env: Env): Promise<boolean> {
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
    } catch {
      // Column already exists
    }

    try {
      await env.DB.prepare(
        `ALTER TABLE users ADD COLUMN primary_email TEXT`,
      ).run()
    } catch {
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
 * Get user training status by FULL email (case-insensitive exact match)
 *
 * Fails closed: returns null when no row matches, when more than one row
 * matches the same email (ambiguous identity), or on any database error.
 *
 * @param env - Environment bindings including DB
 * @param email - Full email address to look up
 * @returns Training status, or null if not found / ambiguous / error
 */
export async function getUserTrainingStatusByEmail(
  env: Env,
  email: string,
): Promise<string | null> {
  try {
    const result = await env.DB.prepare(
      'SELECT training_status FROM users WHERE lower(primary_email) = lower(?) LIMIT 2',
    )
      .bind(email)
      .all<{ training_status: string }>()

    const rows = result.results ?? []
    if (rows.length === 0) {
      return null
    }
    if (rows.length > 1) {
      console.warn(
        'Ambiguous identity: several users share one email; denying access:',
        sanitizeForLogging(email),
      )
      return null
    }
    return rows[0]!.training_status
  } catch (error) {
    console.error(
      'Database error:',
      sanitizeForLogging(
        error instanceof Error ? error.message : String(error),
      ),
    )
    return null
  }
}

/**
 * Update user training status by email
 *
 * @param env - Environment bindings including DB
 * @param email - Email to update
 * @param status - New training status
 * @returns Success status
 */
export async function updateUserTrainingStatusByEmail(
  env: Env,
  email: string,
  status: TrainingStatus,
): Promise<boolean> {
  try {
    if (!isTrainingStatus(status)) {
      console.error('Invalid training status:', status)
      return false
    }

    const result = await env.DB.prepare(
      `
      UPDATE users SET training_status = ?, updated_at = CURRENT_TIMESTAMP
      WHERE primary_email = ?
    `,
    )
      .bind(status, email)
      .run()

    // Check both result.changes and result.meta.changes for compatibility
    const changes =
      (result as { changes?: number }).changes || result.meta?.changes || 0
    return changes > 0
  } catch (error) {
    console.error('Database update error:', error)
    return false
  }
}

