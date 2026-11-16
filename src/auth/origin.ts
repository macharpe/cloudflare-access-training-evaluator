/**
 * Server-side origin (CSRF) validation for state-changing admin requests
 *
 * Browsers always send `Origin` (and `Sec-Fetch-Site`) on cross-site POSTs and
 * the attacker's page cannot forge them. Requests from non-browser clients send
 * neither header and are not exposed to CSRF, so they are allowed.
 */

import type { Env } from '../types'
import { createCSPHeaders } from '../security/csp.js'

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

/**
 * Whether a request may perform a state-changing action
 *
 * - Safe methods are always allowed.
 * - If `Origin` is present it must be this application's own origin
 *   (the request origin or `https://ADMIN_DOMAIN`); `null` is rejected.
 * - Otherwise a present `Sec-Fetch-Site` must be `same-origin`.
 * - With neither header (non-browser client) the request is allowed.
 *
 * @param request - HTTP request
 * @param env - Environment bindings
 * @returns True when the request is same-origin or not browser-initiated
 */
export function isSameOriginRequest(request: Request, env: Env): boolean {
  if (SAFE_METHODS.has(request.method.toUpperCase())) {
    return true
  }

  const origin = request.headers.get('origin')
  if (origin !== null) {
    const allowed = new Set<string>([new URL(request.url).origin])
    if (env.ADMIN_DOMAIN) {
      allowed.add(`https://${env.ADMIN_DOMAIN}`)
    }
    return allowed.has(origin)
  }

  const fetchSite = request.headers.get('sec-fetch-site')
  if (fetchSite !== null) {
    return fetchSite === 'same-origin'
  }

  return true
}

/**
 * Create a 403 response for a rejected cross-origin request
 *
 * @param env - Environment bindings (for security headers)
 * @returns 403 Forbidden JSON response
 */
export function createCrossOriginResponse(env: Env): Response {
  return new Response(
    JSON.stringify({
      success: false,
      error: 'Forbidden',
      message: 'Cross-origin requests are not allowed.',
    }),
    {
      status: 403,
      headers: {
        'content-type': 'application/json',
        ...createCSPHeaders(env),
      },
    },
  )
}
