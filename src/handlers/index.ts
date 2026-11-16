/**
 * Top-level HTTP request handlers
 *
 * Handles database initialization, JWKS endpoint, and external evaluation requests.
 */

import type { Env, AccessClaims } from '../types/index.js'
import { loadPublicKey } from '../auth/keys.js'
import { verifyToken, signJWT } from '../auth/jwt.js'
import { externalEvaluation } from '../auth/evaluation.js'
import { initializeDatabase } from '../database/training.js'
import { sanitizeForLogging } from '../utils/validation.js'
import { createCSPHeaders } from '../security/csp.js'
import { isDebugEnabled } from '../utils/env.js'

/**
 * Evaluation result structure
 */
interface EvaluationResult {
  success: boolean
  iat: number
  exp: number
  nonce?: string
}

/**
 * Error response structure
 */
interface ErrorResponse {
  success: boolean
  error: string
  timestamp: string
  details?: string
  stack?: string
}

/**
 * External evaluation request body
 */
interface ExternalEvaluationBody {
  token: string
}

/**
 * Top level handler for database initialization endpoint
 *
 * @param env - Environment bindings
 * @returns HTTP response
 */
export async function handleDatabaseInitRequest(env: Env): Promise<Response> {
  const success = await initializeDatabase(env)
  return new Response(
    JSON.stringify({
      success,
      message: success
        ? 'Database initialized successfully'
        : 'Database initialization failed',
    }),
    {
      status: success ? 200 : 500,
      headers: {
        'content-type': 'application/json',
        ...createCSPHeaders(env),
      },
    },
  )
}

/**
 * Top level handler for public jwks endpoint
 *
 * @param env - Environment bindings
 * @returns HTTP response
 */
export async function handleKeysRequest(env: Env): Promise<Response> {
  const keys = await loadPublicKey(env)
  return new Response(JSON.stringify({ keys: [keys] }), {
    status: 200,
    headers: {
      'content-type': 'application/json',
      'cache-control': 'public, max-age=3600, s-maxage=7200',
      ...createCSPHeaders(env),
    },
  })
}

/**
 * Top level handler for external evaluation requests
 *
 * @param env - Environment bindings
 * @param request - HTTP request
 * @returns HTTP response
 */
export async function handleExternalEvaluationRequest(
  env: Env,
  request: Request,
): Promise<Response> {
  // Only Cloudflare Access External Evaluation (POST) is served here; the
  // router sends GET / to the system overview and never routes other paths.
  if (request.method !== 'POST') {
    return createMethodNotAllowedResponse(env, ['POST'])
  }

  const now = Math.round(Date.now() / 1000)
  const JWT_EXPIRY_SECONDS = 300
  const result: EvaluationResult = {
    success: false,
    iat: now,
    exp: now + JWT_EXPIRY_SECONDS,
  }

  try {
    // Validate request body
    if (!request.body) {
      throw new Error('Request body is required')
    }

    const body: ExternalEvaluationBody = await request.json()

    if (!body.token) {
      throw new Error('Token is required')
    }

    // Documented debugging aid for the External Evaluation rule only.
    if (isDebugEnabled(env)) {
      console.log('incoming JWT', body.token)
    }

    const claims: AccessClaims = await verifyToken(env, body.token, {
      warnOnIssuerMismatch: true,
    })

    if (claims) {
      result.nonce = claims.nonce
      if (await externalEvaluation(claims, env)) {
        result.success = true
      }
    }

    const jwt = await signJWT(env, result as unknown as Record<string, unknown>)
    if (isDebugEnabled(env)) {
      console.log('outgoing JWT', jwt)
    }
    return new Response(JSON.stringify({ token: jwt }), {
      headers: {
        'content-type': 'application/json',
        ...createCSPHeaders(env),
      },
    })
  } catch (e) {
    // Log detailed error for debugging (sanitized)
    const errorMessage = e instanceof Error ? e.message : String(e)
    console.error(
      'External evaluation error:',
      sanitizeForLogging(errorMessage),
    )

    // Create production-safe error response
    const errorResponse: ErrorResponse = {
      success: false,
      error: 'Authentication failed',
      timestamp: new Date().toISOString(),
    }

    // Include detailed error info only in debug mode
    if (isDebugEnabled(env)) {
      errorResponse.details = sanitizeForLogging(errorMessage)
      if (e instanceof Error && e.stack) {
        errorResponse.stack = sanitizeForLogging(e.stack)
      }
    }

    return new Response(JSON.stringify(errorResponse), {
      status: 403,
      headers: {
        'content-type': 'application/json',
        ...createCSPHeaders(env),
      },
    })
  }
}

/**
 * Create a 404 JSON response with security headers
 *
 * @param env - Environment bindings
 * @returns 404 Not Found response
 */
export function createNotFoundResponse(env: Env): Response {
  return new Response(JSON.stringify({ success: false, error: 'Not found' }), {
    status: 404,
    headers: {
      'content-type': 'application/json',
      ...createCSPHeaders(env),
    },
  })
}

/**
 * Create a 405 JSON response with an `Allow` header and security headers
 *
 * @param env - Environment bindings
 * @param allowed - Methods supported by the resource
 * @returns 405 Method Not Allowed response
 */
export function createMethodNotAllowedResponse(
  env: Env,
  allowed: readonly string[],
): Response {
  return new Response(
    JSON.stringify({ success: false, error: 'Method not allowed' }),
    {
      status: 405,
      headers: {
        'content-type': 'application/json',
        allow: allowed.join(', '),
        ...createCSPHeaders(env),
      },
    },
  )
}
