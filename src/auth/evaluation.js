import { getUserTrainingStatus } from '../database/training.js'

/**
 * External evaluation business logic for training certification
 * @param {*} claims - JWT claims from Access token
 * @param {*} env - Environment bindings
 * @returns {boolean} Authorization decision
 */
export async function externalEvaluation(claims, env) {
  // Extract username from email (assumes format: username@domain.com)
  const email = claims.identity.email
  const username = email.split('@')[0].toLowerCase()

  // Get user training status from D1 database
  const trainingStatus = await getUserTrainingStatus(env, username)

  if (!trainingStatus) {
    console.log(`User ${username} not found in training database`)
    return false
  }

  // Only allow access if training is completed
  const hasAccess = trainingStatus === 'completed'

  console.log(
    `User ${username} training status: ${trainingStatus}, access granted: ${hasAccess}`,
  )
  return hasAccess
}
