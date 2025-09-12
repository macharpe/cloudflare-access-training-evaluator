import {
  handleKeysRequest,
  handleDatabaseInitRequest,
  handleExternalEvaluationRequest,
} from './handlers/index.js'
import { handleWebInterface, handleUpdateTraining } from './handlers/web.js'
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
 * Unified admin request handler with Cloudflare Access authentication
 * @param {Request} request - HTTP request
 * @param {*} env - Environment bindings
 * @param {Function} handler - Handler function to execute if authenticated
 * @param {boolean} isWebInterface - Whether this is a web interface request (affects redirects)
 * @returns {Response} HTTP response
 */
async function handleAdminRequest(
  request,
  env,
  handler,
  isWebInterface = false,
) {
  // Use Cloudflare Access authentication only
  const accessClaims = await isAccessAuthenticated(request, env)
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
 * Main Worker entry point
 */
export default {
  async fetch(request, env, ctx) {
    const startTime = Date.now()
    const url = new URL(request.url)
    const endpoint = url.pathname
    const method = request.method

    try {
      let response

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
      } else if (url.pathname === '/') {
        // Root path - System overview (no authentication required)
        const { handleSystemOverview } = await import('./handlers/web.js')
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
          () => handleWebInterface(env),
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
      structuredLog(
        LOG_LEVELS.ERROR,
        'Unhandled request error',
        {
          endpoint,
          method,
          error: error.message,
          duration,
        },
        env,
      )

      logRequest(endpoint, method, 500, duration, env)

      return new Response(
        JSON.stringify({
          success: false,
          error: 'Internal server error',
          timestamp: new Date().toISOString(),
        }),
        {
          status: 500,
          headers: {
            'content-type': 'application/json',
            ...createCSPHeaders(env),
          },
        },
      )
    }
  },
}
