/**
 * Web interface handlers
 *
 * Handles admin dashboard, training status updates, and system overview pages.
 */

import type { Env, User } from '../types/index.js'
import { updateUserTrainingStatusByEmail } from '../database/training.js'
import { isTrainingStatus } from '../types/guards.js'
import {
  generateNonce,
  addCSPHeaders,
  createCSPHeaders,
} from '../security/csp.js'
import { ADMIN_CSS, ADMIN_JS } from '../ui-assets.generated.js'
import { isValidEmail, sanitizeForLogging } from '../utils/validation.js'

/**
 * Maximum accepted size of a POST /api/update-training body (10 KB)
 */
export const MAX_UPDATE_BODY_BYTES = 10 * 1024

/**
 * Update training response
 */
interface UpdateTrainingResponse {
  success: boolean
  message: string
}

/**
 * Result of the dashboard's initial user query. A failed query is reported
 * explicitly so the UI never presents an empty list as a successful load.
 */
interface UsersLoadResult {
  users: User[]
  error: string | null
}

/**
 * Get all users from the database
 */
async function getAllUsers(env: Env): Promise<UsersLoadResult> {
  try {
    const result = await env.DB.prepare(
      'SELECT id, username, first_name, primary_email, training_status, created_at, updated_at FROM users ORDER BY username',
    ).all<User>()
    if ((result as { success?: boolean }).success === false) {
      throw new Error('User query failed')
    }
    return { users: result.results || [], error: null }
  } catch (error) {
    console.error('Database error:', error)
    return {
      users: [],
      error: 'The user list could not be read from the database.',
    }
  }
}

/**
 * Serialize a value for embedding in an inline <script type="application/json">
 * element. Escapes characters that could close the element, start an HTML
 * comment, or be treated as line terminators by older script parsers.
 */
export function serializeForScript(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029')
}

// ---------------------------------------------------------------------------
// Shared Kumo-inspired CSS design tokens — light + dark
// All colors referenced via CSS custom properties so dark mode is a single
// [data-mode="dark"] block that overrides the :root defaults.
// ---------------------------------------------------------------------------
const KUMO_TOKENS = `
  :root {
    /* Surfaces */
    --kumo-canvas:    #f6f8fa;
    --kumo-base:      #ffffff;
    --kumo-tint:      #f6f8fa;
    --kumo-contrast:  #111827;

    /* Text */
    --kumo-text-default:  #111827;
    --kumo-text-strong:   #374151;
    --kumo-text-subtle:   #6b7280;
    --kumo-text-inactive: #9ca3af;

    /* Brand */
    --kumo-orange:        #f38020;
    --kumo-orange-tint:   #fff4ec;
    --kumo-orange-border: #fbd5b0;

    /* Status */
    --kumo-success:        #16a34a;
    --kumo-success-tint:   #dcfce7;
    --kumo-success-border: #bbf7d0;
    --kumo-warning:        #d97706;
    --kumo-warning-tint:   #fef3c7;
    --kumo-warning-border: #fde68a;
    --kumo-danger:         #dc2626;
    --kumo-danger-tint:    #fee2e2;
    --kumo-danger-border:  #fecaca;
    --kumo-info:           #2563eb;
    --kumo-info-tint:      #dbeafe;
    --kumo-info-border:    #bfdbfe;

    /* Borders */
    --kumo-hairline: #e5e7eb;
    --kumo-border:   #d1d5db;

    /* Shadows */
    --kumo-shadow-sm: 0 1px 3px rgba(0,0,0,.08), 0 1px 2px rgba(0,0,0,.05);
    --kumo-shadow-lg: 0 10px 30px rgba(0,0,0,.10), 0 2px 6px rgba(0,0,0,.05);

    /* Radius */
    --kumo-radius-sm: 6px;
    --kumo-radius:    8px;
    --kumo-radius-lg: 12px;
    --kumo-radius-xl: 16px;

    /* Typography */
    --kumo-font:      -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
    --kumo-font-mono: 'SF Mono', Monaco, 'Cascadia Code', 'Fira Code', monospace;
  }

  /* ── Dark mode overrides ── */
  [data-mode="dark"] {
    --kumo-canvas:    #0f1117;
    --kumo-base:      #1a1d27;
    --kumo-tint:      #22263a;
    --kumo-contrast:  #f9fafb;

    --kumo-text-default:  #f3f4f6;
    --kumo-text-strong:   #d1d5db;
    --kumo-text-subtle:   #9ca3af;
    --kumo-text-inactive: #6b7280;

    --kumo-orange-tint:   rgba(243,128,32,.15);
    --kumo-orange-border: rgba(243,128,32,.35);

    --kumo-success-tint:   rgba(22,163,74,.15);
    --kumo-success-border: rgba(22,163,74,.35);
    --kumo-warning-tint:   rgba(217,119,6,.15);
    --kumo-warning-border: rgba(217,119,6,.35);
    --kumo-danger-tint:    rgba(220,38,38,.15);
    --kumo-danger-border:  rgba(220,38,38,.35);
    --kumo-info-tint:      rgba(37,99,235,.15);
    --kumo-info-border:    rgba(37,99,235,.35);

    --kumo-hairline: rgba(255,255,255,.08);
    --kumo-border:   rgba(255,255,255,.14);

    --kumo-shadow-sm: 0 1px 3px rgba(0,0,0,.4), 0 1px 2px rgba(0,0,0,.3);
    --kumo-shadow-lg: 0 10px 30px rgba(0,0,0,.5), 0 2px 6px rgba(0,0,0,.3);
  }
`

// ---------------------------------------------------------------------------
// Shared theme toggle — flash-prevention init script + toggle button CSS/JS.
// Inlined as a raw string so each page can embed it with its own nonce.
// The NONCE placeholder is replaced at render time.
// ---------------------------------------------------------------------------
const THEME_INIT_SCRIPT = (nonce: string) => `
<script nonce="${nonce}">
  (function() {
    var stored = localStorage.getItem('ui-mode');
    var prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    document.documentElement.setAttribute('data-mode', stored || (prefersDark ? 'dark' : 'light'));
  })();
</script>`

const THEME_TOGGLE_CSS = `
  /* ── Theme toggle button ── */
  .theme-toggle {
    margin-left: auto;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    border-radius: var(--kumo-radius);
    border: 1px solid var(--kumo-border);
    background: var(--kumo-base);
    color: var(--kumo-text-subtle);
    cursor: pointer;
    transition: background 0.15s, border-color 0.15s, color 0.15s;
    flex-shrink: 0;
  }
  .theme-toggle:hover {
    background: var(--kumo-tint);
    color: var(--kumo-text-default);
    border-color: var(--kumo-text-subtle);
  }
  .theme-toggle svg { pointer-events: none; }
  /* Show the right icon based on current mode */
  .icon-sun  { display: none; }
  .icon-moon { display: block; }
  [data-mode="dark"] .icon-sun  { display: block; }
  [data-mode="dark"] .icon-moon { display: none; }
`

const THEME_TOGGLE_BTN = `
  <button class="theme-toggle" id="themeToggle" aria-label="Toggle dark/light mode" title="Toggle dark/light mode">
    <!-- Sun icon (shown in dark mode to switch to light) -->
    <svg class="icon-sun" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/>
      <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/>
      <line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/>
      <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>
    </svg>
    <!-- Moon icon (shown in light mode to switch to dark) -->
    <svg class="icon-moon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
    </svg>
  </button>`

const THEME_TOGGLE_JS = `
    // ── Theme toggle ─────────────────────────────────────────────────────────
    document.getElementById('themeToggle').addEventListener('click', function() {
      var next = document.documentElement.getAttribute('data-mode') === 'dark' ? 'light' : 'dark';
      document.documentElement.setAttribute('data-mode', next);
      localStorage.setItem('ui-mode', next);
    });`

// ---------------------------------------------------------------------------
// Admin Dashboard
// ---------------------------------------------------------------------------

export async function handleWebInterface(env: Env): Promise<Response> {
  const { users, error } = await getAllUsers(env)
  const styleNonce = generateNonce()
  const scriptNonce = generateNonce()
  const initNonce = generateNonce()

  // Only the fields the dashboard renders are sent to the browser.
  const bootstrap = serializeForScript({
    users: users.map((u) => ({
      id: u.id,
      username: u.username,
      first_name: u.first_name,
      primary_email: u.primary_email,
      training_status: u.training_status,
      updated_at: u.updated_at,
    })),
    loadError: error,
  })

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Training Completion Status</title>
  ${THEME_INIT_SCRIPT(initNonce)}
  <style nonce="${styleNonce}">${ADMIN_CSS}</style>
</head>
<body>
  <div id="root"></div>
  <noscript>This dashboard requires JavaScript.</noscript>
  <script type="application/json" id="training-data" nonce="${scriptNonce}">${bootstrap}</script>
  <script type="module" nonce="${scriptNonce}">${ADMIN_JS}</script>
</body>
</html>
`

  const response = new Response(html, {
    headers: {
      'content-type': 'text/html',
      'cache-control': 'private, no-cache, no-store, must-revalidate',
      pragma: 'no-cache',
      expires: '0',
    },
  })

  return addCSPHeaders(response, env, [scriptNonce, initNonce], styleNonce)
}

// ---------------------------------------------------------------------------
// Training update API (unchanged logic)
// ---------------------------------------------------------------------------

export async function handleUpdateTraining(
  env: Env,
  request: Request,
): Promise<Response> {
  const secureHeaders: Record<string, string> = {
    'content-type': 'application/json',
    ...createCSPHeaders(env),
  }
  const reply = (status: number, success: boolean, message: string) =>
    new Response(
      JSON.stringify({ success, message } satisfies UpdateTrainingResponse),
      { status, headers: secureHeaders },
    )

  // --- Input validation: every client error is a 4xx, never a 500 ---------
  let raw: string
  try {
    raw = await request.text()
  } catch {
    return reply(400, false, 'Request body could not be read')
  }

  // Length in UTF-16 code units is a lower bound for the byte size, so also
  // check the encoded size to enforce the byte limit precisely.
  if (
    raw.length > MAX_UPDATE_BODY_BYTES ||
    new TextEncoder().encode(raw).length > MAX_UPDATE_BODY_BYTES
  ) {
    return reply(413, false, 'Request body too large')
  }

  let body: unknown
  try {
    body = JSON.parse(raw)
  } catch {
    return reply(400, false, 'Malformed request body')
  }

  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return reply(400, false, 'Request body must be an object')
  }

  const { email, status } = body as Record<string, unknown>

  if (
    email === undefined ||
    email === null ||
    email === '' ||
    status === undefined ||
    status === null ||
    status === ''
  ) {
    return reply(400, false, 'Email and status are required')
  }

  if (typeof email !== 'string' || !isValidEmail(email)) {
    return reply(400, false, 'Invalid email address')
  }

  if (!isTrainingStatus(status)) {
    return reply(400, false, 'Invalid status value')
  }

  // --- Update: only genuine internal failures are a 500 -------------------
  try {
    const updated = await updateUserTrainingStatusByEmail(
      env,
      email,
      status,
    )
    if (updated) {
      return reply(200, true, 'Training status updated successfully')
    }
    return reply(404, false, 'User not found or update failed')
  } catch (error) {
    console.error(
      'Update training error:',
      sanitizeForLogging(
        error instanceof Error ? error.message : String(error),
      ),
    )
    return reply(500, false, 'Internal server error')
  }
}

// ---------------------------------------------------------------------------
// System Overview (/)
// ---------------------------------------------------------------------------

export function handleSystemOverview(env: Env): Response {
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
  ${THEME_INIT_SCRIPT(initNonce)}
  <style nonce="${styleNonce}">
    ${KUMO_TOKENS}

    *, *::before, *::after { margin: 0; padding: 0; box-sizing: border-box; }

    body {
      font-family: var(--kumo-font);
      background: var(--kumo-canvas);
      min-height: 100vh;
      display: flex; flex-direction: column; align-items: center; justify-content: center;
      color: var(--kumo-text-default); line-height: 1.5;
      -webkit-font-smoothing: antialiased; padding: 24px;
      transition: background 0.2s, color 0.2s;
    }

    .card {
      background: var(--kumo-base); border: 1px solid var(--kumo-hairline);
      border-radius: var(--kumo-radius-xl); box-shadow: var(--kumo-shadow-lg);
      max-width: 560px; width: 100%; overflow: hidden;
    }

    .card-header {
      background: var(--kumo-orange); padding: 28px 28px 22px;
      text-align: center; color: #fff; position: relative;
    }
    .card-header-icon { display: block; font-size: 36px; margin-bottom: 12px; line-height: 1; }
    .card-header h1 { font-size: 22px; font-weight: 700; letter-spacing: 0.2px; margin-bottom: 6px; }
    .card-header p  { font-size: 14px; opacity: 0.92; line-height: 1.5; }

    ${THEME_TOGGLE_CSS}
    .theme-toggle {
      position: absolute; top: 14px; right: 14px;
      background: rgba(255,255,255,.2); border-color: rgba(255,255,255,.3); color: #fff;
    }
    .theme-toggle:hover { background: rgba(255,255,255,.35); border-color: rgba(255,255,255,.5); color: #fff; }

    .card-body { padding: 24px 28px; }

    .status-banner {
      display: flex; align-items: center; gap: 10px; padding: 10px 14px;
      background: var(--kumo-success-tint); border: 1px solid var(--kumo-success-border);
      border-radius: var(--kumo-radius); margin-bottom: 24px;
    }
    .status-dot {
      width: 10px; height: 10px; border-radius: 50%; background: var(--kumo-success);
      box-shadow: 0 0 0 3px rgba(22,163,74,.2); animation: pulse 2s infinite; flex-shrink: 0;
    }
    @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.6} }
    .status-banner span { font-size: 14px; font-weight: 600; color: var(--kumo-success); }

    .section-title {
      font-size: 13px; font-weight: 600; color: var(--kumo-text-subtle);
      text-transform: uppercase; letter-spacing: 0.06em; margin-bottom: 10px;
    }

    .endpoints { display: flex; flex-direction: column; gap: 8px; margin-bottom: 20px; }
    .endpoint-row {
      display: flex; align-items: center; gap: 12px; padding: 10px 12px;
      background: var(--kumo-tint); border: 1px solid var(--kumo-hairline);
      border-radius: var(--kumo-radius);
    }
    .method-badge {
      font-size: 11px; font-weight: 700; padding: 2px 8px; border-radius: 4px;
      min-width: 44px; text-align: center; flex-shrink: 0;
    }
    .method-get  { background: var(--kumo-info-tint);   color: var(--kumo-info);   border: 1px solid var(--kumo-info-border); }
    .method-post { background: var(--kumo-danger-tint); color: var(--kumo-danger); border: 1px solid var(--kumo-danger-border); }
    .endpoint-path { font-family: var(--kumo-font-mono); font-size: 13px; font-weight: 600; color: var(--kumo-text-default); min-width: 72px; flex-shrink: 0; }
    .endpoint-desc { font-size: 13px; color: var(--kumo-text-subtle); }

    .notice {
      display: flex; gap: 10px; padding: 12px 14px;
      background: var(--kumo-warning-tint); border: 1px solid var(--kumo-warning-border);
      border-radius: var(--kumo-radius); margin-bottom: 20px;
    }
    .notice-icon { font-size: 16px; flex-shrink: 0; margin-top: 1px; }
    .notice-text { font-size: 13px; color: var(--kumo-warning); line-height: 1.5; }
    .notice-text strong { font-weight: 600; }

    .card-footer {
      border-top: 1px solid var(--kumo-hairline); padding: 14px 28px;
      text-align: center; background: var(--kumo-tint);
    }
    .card-footer span { font-size: 12px; color: var(--kumo-text-inactive); font-weight: 500; }

    @media (max-width: 600px) {
      body { padding: 16px; }
      .card-header { padding: 24px 20px 20px; }
      .card-body { padding: 20px; }
      .endpoint-row { flex-direction: column; align-items: flex-start; gap: 6px; }
    }
  </style>
</head>
<body>
  <div class="card">
    <div class="card-header">
      ${THEME_TOGGLE_BTN}
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
    ${THEME_TOGGLE_JS}
  </script>
</body>
</html>
`

  const response = new Response(html, {
    headers: {
      'content-type': 'text/html',
      'cache-control': 'public, max-age=300, s-maxage=600',
    },
  })

  return addCSPHeaders(response, env, [scriptNonce, initNonce], styleNonce)
}
