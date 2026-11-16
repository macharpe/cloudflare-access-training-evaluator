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
  createNotFoundResponse,
  createMethodNotAllowedResponse,
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
import {
  isSameOriginRequest,
  createCrossOriginResponse,
} from './auth/origin.js'
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
 * Order of checks: authentication (401) -> origin/CSRF (403) -> method (405).
 * Authenticating first means unauthenticated callers learn nothing about the
 * route (not even which methods it supports).
 *
 * @param request - HTTP request
 * @param env - Environment bindings
 * @param route - Matched admin route (allowed methods, handlers, 401 style)
 * @returns HTTP response
 */
async function handleAdminRequest(
  request: Request,
  env: Env,
  route: AdminRoute,
): Promise<Response> {
  const isWebInterface = route.web
  // Use Cloudflare Access authentication only
  const accessClaims: AccessClaims | null = await isAccessAuthenticated(
    request,
    env,
  )
  if (!accessClaims) {
    // Not authenticated via Access
    logAuth(false, 'Cloudflare Access authentication failed', env)
    if (isWebInterface) {
      return createUnauthorizedHtmlResponse(env)
    } else {
      return createUnauthorizedResponse(env)
    }
  }

  // Server-side CSRF defence: state-changing requests must be same-origin.
  if (!isSameOriginRequest(request, env)) {
    structuredLog(
      LOG_LEVELS.WARN,
      'Cross-origin admin request rejected',
      { endpoint: new URL(request.url).pathname, method: request.method },
      env,
    )
    return createCrossOriginResponse(env)
  }

  const method = request.method.toUpperCase()
  const handler = Object.hasOwn(route.methods, method)
    ? route.methods[method]
    : undefined
  if (!handler) {
    return createMethodNotAllowedResponse(env, Object.keys(route.methods))
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
  return handler(request, env)
}

type RouteHandler = (request: Request, env: Env) => Promise<Response>

/**
 * An admin route: Cloudflare Access protected, with per-method handlers
 */
interface AdminRoute {
  /** Serve the HTML 401 page (browser dashboard) instead of JSON */
  web: boolean
  methods: Record<string, RouteHandler>
}

const dashboardRoute: AdminRoute = {
  web: true,
  methods: { GET: (_request, env) => handleWebInterface(env) },
}

const initDbRoute: AdminRoute = {
  web: false,
  methods: {
    GET: (_request, env) => handleDatabaseInitRequest(env),
    POST: (_request, env) => handleDatabaseInitRequest(env),
  },
}

/**
 * Admin routes, matched by EXACT pathname (no suffix/prefix matching).
 * A Map avoids accidental matches on Object.prototype keys (e.g. /constructor).
 */
const ADMIN_ROUTES = new Map<string, AdminRoute>([
  ['/admin', dashboardRoute],
  ['/admin/', dashboardRoute],
  ['/dashboard', dashboardRoute],
  ['/dashboard/', dashboardRoute],
  ['/init-db', initDbRoute],
  ['/init-db/', initDbRoute],
  [
    '/api/update-training',
    {
      web: false,
      methods: { POST: (request, env) => handleUpdateTraining(env, request) },
    },
  ],
  [
    '/api/okta/sync',
    {
      web: false,
      methods: { POST: (request, env) => handleOktaSync(env, request) },
    },
  ],
  [
    '/api/okta/groups',
    {
      web: false,
      methods: { GET: (_request, env) => handleOktaGroups(env) },
    },
  ],
  [
    '/api/okta/users',
    {
      web: false,
      methods: { GET: (request, env) => handleOktaUsers(env, request) },
    },
  ],
])

const KEYS_PATHS = new Set(['/keys', '/keys/'])

/**
 * Return the same status and headers as `response` without a body (HEAD)
 */
function withoutBody(response: Response): Response {
  return new Response(null, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  })
}

/**
 * Route a request by exact pathname and method
 *
 * - `GET|HEAD /keys` (and `/keys/`): public JWKS used by Cloudflare Access.
 * - `GET|HEAD /`: public system overview.
 * - `POST /`: External Evaluation (the only path that reaches it).
 * - Admin routes: Access authentication, then origin check, then method.
 * - Known path with an unsupported method: 405 with `Allow`.
 * - Anything else: 404.
 *
 * HEAD on public routes mirrors the GET status and headers without a body.
 */
async function routeRequest(
  request: Request,
  env: Env,
  pathname: string,
): Promise<Response> {
  const method = request.method.toUpperCase()

  if (KEYS_PATHS.has(pathname)) {
    if (method === 'GET') return handleKeysRequest(env)
    if (method === 'HEAD') return withoutBody(await handleKeysRequest(env))
    return createMethodNotAllowedResponse(env, ['GET', 'HEAD'])
  }

  if (pathname === '/') {
    // Root path - System overview (no authentication required)
    if (method === 'GET') return handleSystemOverview(env)
    if (method === 'HEAD') return withoutBody(handleSystemOverview(env))
    // Cloudflare Access External Evaluation endpoint
    if (method === 'POST') return handleExternalEvaluationRequest(env, request)
    return createMethodNotAllowedResponse(env, ['GET', 'HEAD', 'POST'])
  }

  const adminRoute = ADMIN_ROUTES.get(pathname)
  if (adminRoute) {
    return handleAdminRequest(request, env, adminRoute)
  }

  return createNotFoundResponse(env)
}

/**
 * Main Worker export
 */
export default {
  async fetch(
    request: Request,
    env: Env,
    _ctx: ExecutionContext,
  ): Promise<Response> {
    const startTime = Date.now()
    const url = new URL(request.url)
    const endpoint = url.pathname
    const method = request.method

    try {
      const response = await routeRequest(request, env, url.pathname)

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
