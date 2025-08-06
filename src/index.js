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
  isAdminAuthenticated,
  createUnauthorizedResponse,
  createUnauthorizedHtmlResponse,
} from './auth/admin.js'
import { isAccessAuthenticated, shouldUseApiKeyAuth } from './auth/access.js'

/**
 * Unified admin request handler with hybrid authentication
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
  // Determine authentication method
  if (shouldUseApiKeyAuth(request)) {
    // Use API key authentication (fallback mode)
    if (!isAdminAuthenticated(request, env)) {
      return isWebInterface
        ? createUnauthorizedHtmlResponse()
        : createUnauthorizedResponse()
    }
    console.log('Admin access via API key (fallback mode)')
  } else {
    // Use Cloudflare Access authentication
    const accessClaims = await isAccessAuthenticated(request, env)
    if (!accessClaims) {
      // Not authenticated via Access
      if (isWebInterface) {
        return createUnauthorizedHtmlResponse()
      } else {
        return createUnauthorizedResponse()
      }
    }
    console.log(`Admin access via Cloudflare Access: ${accessClaims.email}`)
  }

  // Execute the handler
  return await handler()
}

/**
 * Main Worker entry point
 */
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url)

    if (url.pathname.endsWith('/keys')) {
      return await handleKeysRequest(env)
    } else if (url.pathname.endsWith('/init-db')) {
      // Database initialization - requires authentication for security
      if (!isAdminAuthenticated(request, env)) {
        return createUnauthorizedResponse()
      }
      return await handleDatabaseInitRequest(env)
    } else if (url.pathname === '/admin' || url.pathname === '/admin/') {
      // Admin web interface - hybrid authentication
      return await handleAdminRequest(
        request,
        env,
        () => handleWebInterface(env),
        true,
      )
    } else if (
      url.pathname === '/api/update-training' &&
      request.method === 'POST'
    ) {
      // Admin API - hybrid authentication
      return await handleAdminRequest(
        request,
        env,
        () => handleUpdateTraining(env, request),
        false,
      )
    } else if (url.pathname === '/api/okta/sync' && request.method === 'POST') {
      // Admin API - hybrid authentication
      return await handleAdminRequest(
        request,
        env,
        () => handleOktaSync(env, request),
        false,
      )
    } else if (
      url.pathname === '/api/okta/groups' &&
      request.method === 'GET'
    ) {
      // Admin API - hybrid authentication
      return await handleAdminRequest(
        request,
        env,
        () => handleOktaGroups(env),
        false,
      )
    } else if (url.pathname === '/api/okta/users' && request.method === 'GET') {
      // Admin API - hybrid authentication
      return await handleAdminRequest(
        request,
        env,
        () => handleOktaUsers(env, request),
        false,
      )
    } else {
      return await handleExternalEvaluationRequest(env, request)
    }
  },
}
