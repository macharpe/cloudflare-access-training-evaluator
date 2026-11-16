/**
 * External evaluation business logic for training certification
 *
 * Implements the core authorization logic based on user training status.
 */

import type { Env, AccessClaims } from '../types'
import { getUserTrainingStatusByEmail } from '../database/training.js'
import { isValidEmail, sanitizeForLogging } from '../utils/validation.js'

/**
 * External evaluation business logic for training certification
 *
 * Identity is the FULL email (case-insensitive), never just the local part:
 * alice@a.com and alice@b.com are different people. Any missing, invalid,
 * unknown or ambiguous identity is denied. Only `completed` grants access.
 *
 * @param claims - JWT claims from Access token
 * @param env - Environment bindings
 * @returns Authorization decision (true = allow, false = deny)
 */
export async function externalEvaluation(
  claims: AccessClaims,
  env: Env,
): Promise<boolean> {
  try {
    const email: unknown = claims?.identity?.email
    if (!isValidEmail(email)) {
      console.log('Invalid claims structure: missing or invalid email identity')
      return false
    }

    const trainingStatus = await getUserTrainingStatusByEmail(env, email)

    if (!trainingStatus) {
      console.log(
        `User not found (or ambiguous) in training database: ${sanitizeForLogging(email)}`,
      )
      return false
    }

    // Only allow access if training is completed
    const hasAccess = trainingStatus === 'completed'

    console.log(
      `User ${sanitizeForLogging(email)} training status: ${sanitizeForLogging(trainingStatus)}, access granted: ${hasAccess}`,
    )
    return hasAccess
  } catch (error) {
    console.error(
      'Error in external evaluation:',
      sanitizeForLogging(
        error instanceof Error ? error.message : String(error),
      ),
    )
    return false
  }
}
