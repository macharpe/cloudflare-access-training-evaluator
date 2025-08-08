import { loadPublicKey } from '../auth/keys.js'
import { verifyToken, signJWT } from '../auth/jwt.js'
import { externalEvaluation } from '../auth/evaluation.js'
import { initializeDatabase } from '../database/training.js'

/**
 * Top level handler for database initialization endpoint
 * @param {*} env - Environment bindings
 * @returns {Response} HTTP response
 */
export async function handleDatabaseInitRequest(env) {
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
      headers: { 'content-type': 'application/json' },
    },
  )
}

/**
 * Top level handler for public jwks endpoint
 * @param {*} env - Environment bindings
 * @returns {Response} HTTP response
 */
export async function handleKeysRequest(env) {
  const keys = await loadPublicKey(env)
  return new Response(JSON.stringify({ keys: [keys] }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

/**
 * Top level handler for external evaluation requests
 * @param {*} env - Environment bindings
 * @param {Request} request - HTTP request
 * @returns {Response} HTTP response
 */
export async function handleExternalEvaluationRequest(env, request) {
  // Handle browser GET requests with a friendly response
  if (request.method === 'GET') {
    const html = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Training Compliance Gateway</title>
    <style>
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
    `

    return new Response(html, {
      headers: { 'content-type': 'text/html' },
    })
  }

  const now = Math.round(Date.now() / 1000)
  let result = { success: false, iat: now, exp: now + 300 }

  try {
    const body = await request.json()
    const claims = await verifyToken(env, body.token)

    if (claims) {
      result.nonce = claims.nonce
      if (await externalEvaluation(claims, env)) {
        result.success = true
      }
    }

    const jwt = await signJWT(env, result)
    if (env.DEBUG) {
      console.log('outgoing JWT', jwt)
    }
    return new Response(JSON.stringify({ token: jwt }), {
      headers: { 'content-type': 'application/json' },
    })
  } catch (e) {
    console.log(`error:`, e.toString())
    return new Response(
      JSON.stringify({ success: false, error: e.toString(), stack: e.stack }),
      {
        status: 403,
        headers: { 'content-type': 'application/json' },
      },
    )
  }
}
