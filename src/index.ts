/**
 * Main Cloudflare Worker entry point
 *
 * Routes requests to appropriate handlers with authentication middleware.
 */

import type { Env, AccessClaims } from './types/index.js'
import {
  handleKeysRequest,
  handleDatabaseInitRequest,
  handleExternalEvaluationRequest,
} from './handlers/index.js'
import {
  handleWebInterface,
  handleUpdateTraining,
  handleSystemOverview,
} from './handlers/web.js'
import {
  handleOktaSync,
  handleOktaGroups,
  handleOktaUsers,
} from './handlers/sync.js'
import {
  createUnauthorizedResponse,
  createUnauthorizedHtmlResponse,
} from './auth/admin.js'
import { createCSPHeaders } from './security/csp.js'
import { isAccessAuthenticated } from './auth/access.js'
import {
  logRequest,
  logAuth,
  structuredLog,
  LOG_LEVELS,
} from './utils/logging.js'

/**
 * Error response structure
 */
interface ErrorResponse {
  success: boolean
  error: string
  timestamp: string
}

/**
 * Unified admin request handler with Cloudflare Access authentication
 *
 * @param request - HTTP request
 * @param env - Environment bindings
 * @param handler - Handler function to execute if authenticated
 * @param isWebInterface - Whether this is a web interface request (affects redirects)
 * @returns HTTP response
 */
async function handleAdminRequest(
  request: Request,
  env: Env,
  handler: () => Promise<Response>,
  isWebInterface: boolean = false,
): Promise<Response> {
  // Use Cloudflare Access authentication only
  const accessClaims: AccessClaims | null = await isAccessAuthenticated(
    request,
    env,
  )
  if (!accessClaims) {
    // Not authenticated via Access
    logAuth(false, 'Cloudflare Access authentication failed', env)
    if (isWebInterface) {
      return createUnauthorizedHtmlResponse()
    } else {
      return createUnauthorizedResponse()
    }
  }

  logAuth(true, null, env)
  structuredLog(
    LOG_LEVELS.INFO,
    'Admin access granted',
    {
      email: accessClaims.email,
      userAgent: request.headers.get('user-agent') || 'unknown',
    },
    env,
  )

  // Execute the handler
  return handler()
}

/**
 * Main Worker export
 */
export default {
  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<Response> {
    const startTime = Date.now()
    const url = new URL(request.url)
    const endpoint = url.pathname
    const method = request.method

    try {
      let response: Response

      if (url.pathname.endsWith('/keys')) {
        response = await handleKeysRequest(env)
      } else if (url.pathname.endsWith('/init-db')) {
        // Database initialization - requires Cloudflare Access authentication
        response = await handleAdminRequest(
          request,
          env,
          () => handleDatabaseInitRequest(env),
          false,
        )
      } else if (url.pathname === '/' && request.method === 'GET') {
        // Root path - System overview (no authentication required)
        response = await handleSystemOverview(env)
      } else if (
        url.pathname === '/admin' ||
        url.pathname === '/admin/' ||
        url.pathname === '/dashboard' ||
        url.pathname === '/dashboard/'
      ) {
        // Admin web interface - Cloudflare Access authentication
        response = await handleAdminRequest(
          request,
          env,
          () => handleWebInterface(env, ctx),
          true,
        )
      } else if (
        url.pathname === '/api/update-training' &&
        request.method === 'POST'
      ) {
        // Admin API - Cloudflare Access authentication
        response = await handleAdminRequest(
          request,
          env,
          () => handleUpdateTraining(env, request),
          false,
        )
      } else if (
        url.pathname === '/api/okta/sync' &&
        request.method === 'POST'
      ) {
        // Admin API - Cloudflare Access authentication
        response = await handleAdminRequest(
          request,
          env,
          () => handleOktaSync(env, request),
          false,
        )
      } else if (
        url.pathname === '/api/okta/groups' &&
        request.method === 'GET'
      ) {
        // Admin API - Cloudflare Access authentication
        response = await handleAdminRequest(
          request,
          env,
          () => handleOktaGroups(env),
          false,
        )
      } else if (
        url.pathname === '/api/okta/users' &&
        request.method === 'GET'
      ) {
        // Admin API - Cloudflare Access authentication
        response = await handleAdminRequest(
          request,
          env,
          () => handleOktaUsers(env, request),
          false,
        )
      } else {
        response = await handleExternalEvaluationRequest(env, request)
      }

      // Log request metrics
      const duration = Date.now() - startTime
      logRequest(endpoint, method, response.status, duration, env)

      return response
    } catch (error) {
      const duration = Date.now() - startTime
      const errorMessage =
        error instanceof Error ? error.message : String(error)
      structuredLog(
        LOG_LEVELS.ERROR,
        'Unhandled request error',
        {
          endpoint,
          method,
          error: errorMessage,
          duration,
        },
        env,
      )

      logRequest(endpoint, method, 500, duration, env)

      const errorResponse: ErrorResponse = {
        success: false,
        error: 'Internal server error',
        timestamp: new Date().toISOString(),
      }

      return new Response(JSON.stringify(errorResponse), {
        status: 500,
        headers: {
          'content-type': 'application/json',
          ...createCSPHeaders(env),
        },
      })
    }
  },
}
