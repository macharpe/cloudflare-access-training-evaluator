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
import {
  generateNonce,
  addCSPHeaders,
  createCSPHeaders,
} from '../security/csp.js'

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
  // Handle browser GET requests with a friendly response
  if (request.method === 'GET') {
    const styleNonce = generateNonce()
    const scriptNonce = generateNonce()
    const initNonce = generateNonce()
    const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Training Compliance Gateway</title>
  <script nonce="${initNonce}">(function(){var s=localStorage.getItem('ui-mode');var d=window.matchMedia('(prefers-color-scheme: dark)').matches;document.documentElement.setAttribute('data-mode',s||(d?'dark':'light'));})();</script>
  <style nonce="${styleNonce}">
    :root {
      --kumo-canvas:   #f6f8fa; --kumo-base: #ffffff; --kumo-tint: #f6f8fa;
      --kumo-hairline: #e5e7eb; --kumo-border: #d1d5db; --kumo-orange: #f38020;
      --kumo-text-default: #111827; --kumo-text-subtle: #6b7280; --kumo-text-inactive: #9ca3af;
      --kumo-success: #16a34a; --kumo-success-tint: #dcfce7; --kumo-success-border: #bbf7d0;
      --kumo-warning: #d97706; --kumo-warning-tint: #fef3c7; --kumo-warning-border: #fde68a;
      --kumo-info: #2563eb; --kumo-info-tint: #dbeafe; --kumo-info-border: #bfdbfe;
      --kumo-danger: #dc2626; --kumo-danger-tint: #fee2e2; --kumo-danger-border: #fecaca;
      --kumo-shadow-lg: 0 10px 30px rgba(0,0,0,.10), 0 2px 6px rgba(0,0,0,.05);
      --kumo-radius: 8px; --kumo-radius-xl: 16px;
      --kumo-font: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
      --kumo-font-mono: 'SF Mono', Monaco, 'Cascadia Code', monospace;
    }
    [data-mode="dark"] {
      --kumo-canvas: #0f1117; --kumo-base: #1a1d27; --kumo-tint: #22263a;
      --kumo-hairline: rgba(255,255,255,.08); --kumo-border: rgba(255,255,255,.14);
      --kumo-text-default: #f3f4f6; --kumo-text-subtle: #9ca3af; --kumo-text-inactive: #6b7280;
      --kumo-success-tint: rgba(22,163,74,.15); --kumo-success-border: rgba(22,163,74,.35);
      --kumo-warning-tint: rgba(217,119,6,.15); --kumo-warning-border: rgba(217,119,6,.35);
      --kumo-info-tint: rgba(37,99,235,.15); --kumo-info-border: rgba(37,99,235,.35);
      --kumo-danger-tint: rgba(220,38,38,.15); --kumo-danger-border: rgba(220,38,38,.35);
      --kumo-shadow-lg: 0 10px 30px rgba(0,0,0,.5), 0 2px 6px rgba(0,0,0,.3);
    }
    *, *::before, *::after { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: var(--kumo-font); background: var(--kumo-canvas); min-height: 100vh;
      display: flex; align-items: center; justify-content: center;
      color: var(--kumo-text-default); line-height: 1.5;
      -webkit-font-smoothing: antialiased; padding: 24px;
      transition: background 0.2s, color 0.2s;
    }
    .card {
      background: var(--kumo-base); border: 1px solid var(--kumo-hairline);
      border-radius: var(--kumo-radius-xl); box-shadow: var(--kumo-shadow-lg);
      max-width: 540px; width: 100%; overflow: hidden;
    }
    .card-header {
      background: var(--kumo-orange); padding: 28px 28px 22px;
      text-align: center; color: #fff; position: relative;
    }
    .card-header-icon { display: block; font-size: 36px; margin-bottom: 12px; line-height: 1; }
    .card-header h1 { font-size: 20px; font-weight: 700; margin-bottom: 6px; }
    .card-header p  { font-size: 13px; opacity: 0.92; line-height: 1.5; }
    .card-body { padding: 22px 24px; }
    .status-banner {
      display: flex; align-items: center; gap: 10px; padding: 10px 14px;
      background: var(--kumo-success-tint); border: 1px solid var(--kumo-success-border);
      border-radius: var(--kumo-radius); margin-bottom: 20px;
    }
    .status-dot {
      width: 10px; height: 10px; border-radius: 50%; background: var(--kumo-success);
      box-shadow: 0 0 0 3px rgba(22,163,74,.2); animation: pulse 2s infinite; flex-shrink: 0;
    }
    @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.6} }
    .status-banner span { font-size: 14px; font-weight: 600; color: var(--kumo-success); }
    .section-title {
      font-size: 12px; font-weight: 600; color: var(--kumo-text-subtle);
      text-transform: uppercase; letter-spacing: 0.06em; margin-bottom: 10px;
    }
    .endpoints { display: flex; flex-direction: column; gap: 7px; margin-bottom: 18px; }
    .endpoint-row {
      display: flex; align-items: center; gap: 10px; padding: 9px 12px;
      background: var(--kumo-tint); border: 1px solid var(--kumo-hairline);
      border-radius: var(--kumo-radius);
    }
    .method-badge {
      font-size: 10px; font-weight: 700; padding: 2px 7px; border-radius: 4px;
      min-width: 40px; text-align: center; flex-shrink: 0;
    }
    .method-get  { background: var(--kumo-info-tint);   color: var(--kumo-info);   border: 1px solid var(--kumo-info-border); }
    .method-post { background: var(--kumo-danger-tint); color: var(--kumo-danger); border: 1px solid var(--kumo-danger-border); }
    .endpoint-path { font-family: var(--kumo-font-mono); font-size: 13px; font-weight: 600; min-width: 64px; flex-shrink: 0; color: var(--kumo-text-default); }
    .endpoint-desc { font-size: 13px; color: var(--kumo-text-subtle); }
    .notice {
      display: flex; gap: 10px; padding: 12px 14px;
      background: var(--kumo-warning-tint); border: 1px solid var(--kumo-warning-border);
      border-radius: var(--kumo-radius); margin-bottom: 4px;
    }
    .notice-icon { font-size: 15px; flex-shrink: 0; margin-top: 1px; }
    .notice-text { font-size: 13px; color: var(--kumo-warning); line-height: 1.5; }
    .notice-text strong { font-weight: 600; }
    .card-footer {
      border-top: 1px solid var(--kumo-hairline); padding: 12px 24px;
      text-align: center; background: var(--kumo-tint);
    }
    .card-footer span { font-size: 12px; color: var(--kumo-text-inactive); font-weight: 500; }
    /* Theme toggle */
    .theme-toggle {
      position: absolute; top: 12px; right: 12px;
      display: inline-flex; align-items: center; justify-content: center;
      width: 30px; height: 30px; border-radius: var(--kumo-radius);
      background: rgba(255,255,255,.2); border: 1px solid rgba(255,255,255,.3);
      color: #fff; cursor: pointer; transition: background 0.15s;
    }
    .theme-toggle:hover { background: rgba(255,255,255,.35); }
    .theme-toggle svg { pointer-events: none; }
    .icon-sun { display: none; } .icon-moon { display: block; }
    [data-mode="dark"] .icon-sun { display: block; } [data-mode="dark"] .icon-moon { display: none; }
    @media (max-width: 560px) {
      body { padding: 16px; }
      .card-header { padding: 22px 18px 18px; }
      .card-body   { padding: 18px; }
      .endpoint-row { flex-direction: column; align-items: flex-start; gap: 5px; }
    }
  </style>
</head>
<body>
  <div class="card">
    <div class="card-header">
      <button class="theme-toggle" id="themeToggle" aria-label="Toggle dark/light mode">
        <svg class="icon-sun" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>
        <svg class="icon-moon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>
      </button>
      <span class="card-header-icon" aria-hidden="true">🛡️</span>
      <h1>Training Compliance Gateway</h1>
      <p>Cloudflare Access External Evaluation Worker enforcing training completion for Zero Trust security.</p>
    </div>
    <div class="card-body">
      <div class="status-banner">
        <div class="status-dot"></div>
        <span>Worker is running and ready</span>
      </div>
      <p class="section-title">Available Endpoints</p>
      <div class="endpoints">
        <div class="endpoint-row">
          <span class="method-badge method-get">GET</span>
          <span class="endpoint-path">/keys</span>
          <span class="endpoint-desc">Public key endpoint for Cloudflare Access</span>
        </div>
        <div class="endpoint-row">
          <span class="method-badge method-post">POST</span>
          <span class="endpoint-path">/</span>
          <span class="endpoint-desc">External evaluation endpoint (used by Access)</span>
        </div>
        <div class="endpoint-row">
          <span class="method-badge method-get">GET</span>
          <span class="endpoint-path">/admin</span>
          <span class="endpoint-desc">Training management dashboard (Access protected)</span>
        </div>
      </div>
      <div class="notice">
        <span class="notice-icon">⚠️</span>
        <p class="notice-text">
          <strong>Note:</strong> This endpoint is designed to receive POST requests with JWT tokens from Cloudflare Access. Direct browser access shows this informational page.
        </p>
      </div>
    </div>
    <div class="card-footer">
      <span>Powered by Cloudflare Workers</span>
    </div>
  </div>
  <script nonce="${scriptNonce}">
    document.getElementById('themeToggle').addEventListener('click', function() {
      var next = document.documentElement.getAttribute('data-mode') === 'dark' ? 'light' : 'dark';
      document.documentElement.setAttribute('data-mode', next);
      localStorage.setItem('ui-mode', next);
    });
  </script>
</body>
</html>
`

    const response = new Response(html, {
      headers: { 'content-type': 'text/html' },
    })

    return addCSPHeaders(response, env, [scriptNonce, initNonce], styleNonce)
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

    const body = (await request.json()) as ExternalEvaluationBody

    if (!body.token) {
      throw new Error('Token is required')
    }

    const claims: AccessClaims = await verifyToken(env, body.token)

    if (claims) {
      result.nonce = claims.nonce
      if (await externalEvaluation(claims, env)) {
        result.success = true
      }
    }

    const jwt = await signJWT(env, result as unknown as Record<string, unknown>)
    if (env.DEBUG) {
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
    if (env.DEBUG) {
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
