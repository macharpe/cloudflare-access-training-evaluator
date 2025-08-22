import { getUserTrainingStatus } from '../database/training.js'
import { extractUsername, sanitizeForLogging } from '../utils/validation.js'

/**
 * External evaluation business logic for training certification
 * @param {*} claims - JWT claims from Access token
 * @param {*} env - Environment bindings
 * @returns {boolean} Authorization decision
 */
export async function externalEvaluation(claims, env) {
  try {
    // Validate claims structure
    if (!claims || !claims.identity || !claims.identity.email) {
      console.log('Invalid claims structure: missing email identity')
      return false
    }

    // Extract and validate username from email
    const email = claims.identity.email
    const username = extractUsername(email)

    // Get user training status from D1 database
    const trainingStatus = await getUserTrainingStatus(env, username)

    if (!trainingStatus) {
      console.log(
        `User not found in training database: ${sanitizeForLogging(username)}`,
      )
      return false
    }

    // Only allow access if training is completed
    const hasAccess = trainingStatus === 'completed'

    console.log(
      `User ${sanitizeForLogging(username)} training status: ${sanitizeForLogging(trainingStatus)}, access granted: ${hasAccess}`,
    )
    return hasAccess
  } catch (error) {
    console.error(
      'Error in external evaluation:',
      sanitizeForLogging(error.message),
    )
    return false
  }
}
