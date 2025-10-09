/**
 * Handler-Specific Type Definitions
 *
 * Types for HTTP request handlers and API interactions.
 */

import type { Env } from './index'

/**
 * Admin Dashboard Filter Parameters
 */
export interface FilterParams {
  status?: string
  search?: string
}

/**
 * Training Status Update Request
 */
export interface UpdateTrainingRequest {
  username: string
  status: 'not started' | 'started' | 'completed'
}

/**
 * Okta Sync Request Parameters
 */
export interface OktaSyncRequest {
  groupId?: string
  profile?: string
}

/**
 * Request Handler Type
 *
 * Standard signature for Worker request handlers.
 */
export type RequestHandler = (
  request: Request,
  env: Env,
  ctx: ExecutionContext,
) => Promise<Response>

/**
 * Content Security Policy Configuration
 */
export interface CSPConfig {
  nonce: string
  env: Env
}
