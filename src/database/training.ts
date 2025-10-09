/**
 * Training certification database operations
 *
 * Provides CRUD operations for user training status in D1 database.
 */

import type { Env, TrainingStatus, User } from '../types';
import { isTrainingStatus } from '../types/guards';

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
    `
    ).run();

    // Create indexes for faster lookups
    await env.DB.prepare(
      `
      CREATE INDEX IF NOT EXISTS idx_users_username ON users(username)
    `
    ).run();

    await env.DB.prepare(
      `
      CREATE INDEX IF NOT EXISTS idx_users_email ON users(primary_email)
    `
    ).run();

    // Apply migration to add new columns if they don't exist
    try {
      await env.DB.prepare(`ALTER TABLE users ADD COLUMN first_name TEXT`).run();
    } catch (e) {
      // Column already exists
    }

    try {
      await env.DB.prepare(`ALTER TABLE users ADD COLUMN primary_email TEXT`).run();
    } catch (e) {
      // Column already exists
    }

    // No initial user data - users will be synced from Okta

    console.log('Database initialized successfully');
    return true;
  } catch (error) {
    console.error('Database initialization error:', error);
    return false;
  }
}

/**
 * Get user training status from D1 database
 *
 * @param env - Environment bindings including DB
 * @param username - Username to lookup
 * @returns Training status or null if user not found
 */
export async function getUserTrainingStatus(
  env: Env,
  username: string
): Promise<string | null> {
  try {
    const result = await env.DB.prepare(
      'SELECT training_status FROM users WHERE username = ?'
    )
      .bind(username)
      .first<{ training_status: string }>();

    return result ? result.training_status : null;
  } catch (error) {
    console.error('Database error:', error);
    return null;
  }
}

/**
 * Update user training status by username
 *
 * @param env - Environment bindings including DB
 * @param username - Username to update
 * @param status - New training status
 * @returns Success status
 */
export async function updateUserTrainingStatus(
  env: Env,
  username: string,
  status: TrainingStatus
): Promise<boolean> {
  try {
    if (!isTrainingStatus(status)) {
      console.error('Invalid training status:', status);
      return false;
    }

    const result = await env.DB.prepare(
      `
      UPDATE users SET training_status = ?, updated_at = CURRENT_TIMESTAMP
      WHERE username = ?
    `
    )
      .bind(status, username)
      .run();

    // Check both result.changes and result.meta.changes for compatibility
    const changes = (result as { changes?: number }).changes || result.meta?.changes || 0;
    return changes > 0;
  } catch (error) {
    console.error('Database update error:', error);
    return false;
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
  status: TrainingStatus
): Promise<boolean> {
  try {
    if (!isTrainingStatus(status)) {
      console.error('Invalid training status:', status);
      return false;
    }

    const result = await env.DB.prepare(
      `
      UPDATE users SET training_status = ?, updated_at = CURRENT_TIMESTAMP
      WHERE primary_email = ?
    `
    )
      .bind(status, email)
      .run();

    // Check both result.changes and result.meta.changes for compatibility
    const changes = (result as { changes?: number }).changes || result.meta?.changes || 0;
    return changes > 0;
  } catch (error) {
    console.error('Database update error:', error);
    return false;
  }
}

/**
 * Get all users from database
 *
 * @param env - Environment bindings
 * @returns Array of users
 */
export async function getAllUsers(env: Env): Promise<User[]> {
  try {
    const result = await env.DB.prepare('SELECT * FROM users ORDER BY username ASC').all<User>();
    return result.results || [];
  } catch (error) {
    console.error('Database error fetching users:', error);
    return [];
  }
}

/**
 * Add or update user in database
 *
 * @param env - Environment bindings
 * @param username - Username
 * @param firstName - First name
 * @param email - Primary email
 * @param status - Training status
 * @returns Success status
 */
export async function upsertUser(
  env: Env,
  username: string,
  firstName: string | null,
  email: string | null,
  status: TrainingStatus
): Promise<boolean> {
  try {
    if (!isTrainingStatus(status)) {
      console.error('Invalid training status:', status);
      return false;
    }

    await env.DB.prepare(
      `
      INSERT INTO users (username, first_name, primary_email, training_status)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(username) DO UPDATE SET
        first_name = excluded.first_name,
        primary_email = excluded.primary_email,
        training_status = excluded.training_status,
        updated_at = CURRENT_TIMESTAMP
    `
    )
      .bind(username, firstName, email, status)
      .run();

    return true;
  } catch (error) {
    console.error('Database upsert error:', error);
    return false;
  }
}

/**
 * Delete user from database
 *
 * @param env - Environment bindings
 * @param username - Username to delete
 * @returns Success status
 */
export async function deleteUser(env: Env, username: string): Promise<boolean> {
  try {
    const result = await env.DB.prepare('DELETE FROM users WHERE username = ?').bind(username).run();

    const changes = (result as { changes?: number }).changes || result.meta?.changes || 0;
    return changes > 0;
  } catch (error) {
    console.error('Database delete error:', error);
    return false;
  }
}
