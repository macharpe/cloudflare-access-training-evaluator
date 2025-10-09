/**
 * Top-level HTTP request handlers
 *
 * Handles database initialization, JWKS endpoint, and external evaluation requests.
 */

import type { Env, AccessClaims } from '../types/index.js';
import { loadPublicKey } from '../auth/keys.js';
import { verifyToken, signJWT } from '../auth/jwt.js';
import { externalEvaluation } from '../auth/evaluation.js';
import { initializeDatabase } from '../database/training.js';
import { sanitizeForLogging } from '../utils/validation.js';
import { generateNonce, addCSPHeaders, createCSPHeaders } from '../security/csp.js';

/**
 * Evaluation result structure
 */
interface EvaluationResult {
  success: boolean;
  iat: number;
  exp: number;
  nonce?: string;
}

/**
 * Error response structure
 */
interface ErrorResponse {
  success: boolean;
  error: string;
  timestamp: string;
  details?: string;
  stack?: string;
}

/**
 * External evaluation request body
 */
interface ExternalEvaluationBody {
  token: string;
}

/**
 * Top level handler for database initialization endpoint
 *
 * @param env - Environment bindings
 * @returns HTTP response
 */
export async function handleDatabaseInitRequest(env: Env): Promise<Response> {
  const success = await initializeDatabase(env);
  return new Response(
    JSON.stringify({
      success,
      message: success ? 'Database initialized successfully' : 'Database initialization failed',
    }),
    {
      status: success ? 200 : 500,
      headers: {
        'content-type': 'application/json',
        ...createCSPHeaders(env),
      },
    }
  );
}

/**
 * Top level handler for public jwks endpoint
 *
 * @param env - Environment bindings
 * @returns HTTP response
 */
export async function handleKeysRequest(env: Env): Promise<Response> {
  const keys = await loadPublicKey(env);
  return new Response(JSON.stringify({ keys: [keys] }), {
    status: 200,
    headers: {
      'content-type': 'application/json',
      ...createCSPHeaders(env),
    },
  });
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
  request: Request
): Promise<Response> {
  // Handle browser GET requests with a friendly response
  if (request.method === 'GET') {
    const styleNonce = generateNonce();
    const html = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Training Compliance Gateway</title>
    <style nonce="${styleNonce}">
        body {
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            background: linear-gradient(135deg, #e3f2fd 0%, #bbdefb 50%, #90caf9 100%);
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            margin: 0;
            padding: 20px;
        }
        .container {
            background: white;
            padding: 40px;
            border-radius: 12px;
            box-shadow: 0 8px 32px rgba(0,0,0,0.1);
            text-align: center;
            max-width: 600px;
        }
        .header {
            color: #1976d2;
            font-size: 3rem;
            margin-bottom: 20px;
        }
        h1 {
            color: #333;
            margin-bottom: 20px;
            font-size: 2rem;
        }
        p {
            color: #666;
            margin-bottom: 20px;
            line-height: 1.6;
        }
        .status {
            background: #e8f5e8;
            color: #2e7d32;
            padding: 15px;
            border-radius: 8px;
            margin: 20px 0;
            border-left: 4px solid #4caf50;
            font-weight: 600;
        }
        .endpoints {
            background: #f5f5f5;
            padding: 20px;
            border-radius: 8px;
            margin: 20px 0;
            text-align: left;
        }
        .endpoints h3 {
            color: #1976d2;
            margin-top: 0;
        }
        .endpoint {
            font-family: monospace;
            background: white;
            padding: 8px 12px;
            margin: 8px 0;
            border-radius: 4px;
            border-left: 3px solid #2196f3;
        }
        .note {
            background: #fff3e0;
            color: #e65100;
            padding: 15px;
            border-radius: 8px;
            border-left: 4px solid #ff9800;
            text-align: left;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">🛡️</div>
        <h1>Training Compliance Gateway</h1>
        <p>This is a <strong>Cloudflare Access External Evaluation Worker</strong> that enforces training completion requirements for Zero Trust security.</p>

        <div class="status">
            ✅ Worker is running and ready to process access requests
        </div>

        <div class="endpoints">
            <h3>Available Endpoints:</h3>
            <div class="endpoint">GET /keys - Public key endpoint for Cloudflare Access</div>
            <div class="endpoint">POST / - External evaluation endpoint (used by Access)</div>
            <div class="endpoint">GET /admin - Training management dashboard (Access protected)</div>
        </div>

        <div class="note">
            <strong>Note:</strong> This endpoint is designed to receive POST requests with JWT tokens from Cloudflare Access.
            Direct browser access shows this informational page instead of the JSON parsing error.
        </div>

        <p><strong>Powered by Cloudflare Workers</strong></p>
    </div>
</body>
</html>
    `;

    const response = new Response(html, {
      headers: { 'content-type': 'text/html' },
    });

    return addCSPHeaders(response, env, null, styleNonce);
  }

  const now = Math.round(Date.now() / 1000);
  const JWT_EXPIRY_SECONDS = 300;
  const result: EvaluationResult = { success: false, iat: now, exp: now + JWT_EXPIRY_SECONDS };

  try {
    // Validate request body
    if (!request.body) {
      throw new Error('Request body is required');
    }

    const body = (await request.json()) as ExternalEvaluationBody;

    if (!body.token) {
      throw new Error('Token is required');
    }

    const claims: AccessClaims = await verifyToken(env, body.token);

    if (claims) {
      result.nonce = claims.nonce;
      if (await externalEvaluation(claims, env)) {
        result.success = true;
      }
    }

    const jwt = await signJWT(env, result as unknown as Record<string, unknown>);
    if (env.DEBUG) {
      console.log('outgoing JWT', jwt);
    }
    return new Response(JSON.stringify({ token: jwt }), {
      headers: {
        'content-type': 'application/json',
        ...createCSPHeaders(env),
      },
    });
  } catch (e) {
    // Log detailed error for debugging (sanitized)
    const errorMessage = e instanceof Error ? e.message : String(e);
    console.error('External evaluation error:', sanitizeForLogging(errorMessage));

    // Create production-safe error response
    const errorResponse: ErrorResponse = {
      success: false,
      error: 'Authentication failed',
      timestamp: new Date().toISOString(),
    };

    // Include detailed error info only in debug mode
    if (env.DEBUG) {
      errorResponse.details = sanitizeForLogging(errorMessage);
      if (e instanceof Error && e.stack) {
        errorResponse.stack = sanitizeForLogging(e.stack);
      }
    }

    return new Response(JSON.stringify(errorResponse), {
      status: 403,
      headers: {
        'content-type': 'application/json',
        ...createCSPHeaders(env),
      },
    });
  }
}
