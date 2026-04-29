/**
 * Admin authentication utilities
 *
 * Provides response generators for unauthorized access attempts.
 */

/**
 * Create an unauthorized JSON response
 *
 * @returns 401 Unauthorized response with JSON body
 */
export function createUnauthorizedResponse(): Response {
  return new Response(
    JSON.stringify({
      error: 'Unauthorized',
      message:
        'Admin access required. This endpoint is protected by Cloudflare Access authentication.',
    }),
    {
      status: 401,
      headers: { 'content-type': 'application/json' },
    },
  )
}

/**
 * Create an unauthorized HTML response for web interface
 *
 * @returns 401 Unauthorized HTML response with styled page
 */
export function createUnauthorizedHtmlResponse(): Response {
  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>Access Denied — Training Admin</title>
  <script>(function(){var s=localStorage.getItem('ui-mode');var d=window.matchMedia('(prefers-color-scheme: dark)').matches;document.documentElement.setAttribute('data-mode',s||(d?'dark':'light'));})();</script>
  <style>
    :root {
      --kumo-canvas:   #f6f8fa; --kumo-base: #ffffff; --kumo-tint: #f6f8fa;
      --kumo-hairline: #e5e7eb; --kumo-border: #d1d5db;
      --kumo-text-default: #111827; --kumo-text-strong: #374151;
      --kumo-text-subtle: #6b7280; --kumo-text-inactive: #9ca3af;
      --kumo-danger: #dc2626; --kumo-danger-tint: #fee2e2; --kumo-danger-border: #fecaca;
      --kumo-info: #2563eb; --kumo-info-tint: #dbeafe; --kumo-info-border: #bfdbfe;
      --kumo-shadow-lg: 0 10px 30px rgba(0,0,0,.10), 0 2px 6px rgba(0,0,0,.05);
      --kumo-radius: 8px; --kumo-radius-lg: 12px; --kumo-radius-xl: 16px;
      --kumo-font: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
      --kumo-font-mono: 'SF Mono', Monaco, 'Cascadia Code', monospace;
    }
    [data-mode="dark"] {
      --kumo-canvas: #0f1117; --kumo-base: #1a1d27; --kumo-tint: #22263a;
      --kumo-hairline: rgba(255,255,255,.08); --kumo-border: rgba(255,255,255,.14);
      --kumo-text-default: #f3f4f6; --kumo-text-strong: #d1d5db;
      --kumo-text-subtle: #9ca3af; --kumo-text-inactive: #6b7280;
      --kumo-danger-tint: rgba(220,38,38,.15); --kumo-danger-border: rgba(220,38,38,.35);
      --kumo-info-tint: rgba(37,99,235,.15); --kumo-info-border: rgba(37,99,235,.35);
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
      max-width: 520px; width: 100%; overflow: hidden;
    }

    .card-header {
      background: var(--kumo-danger); padding: 28px 28px 22px;
      text-align: center; color: #fff; position: relative;
    }
    .card-header-icon { display: block; font-size: 36px; margin-bottom: 12px; line-height: 1; }
    .card-header h1   { font-size: 22px; font-weight: 700; margin-bottom: 4px; }
    .card-header p    { font-size: 13px; opacity: 0.92; }

    .card-body { padding: 22px 24px; display: flex; flex-direction: column; gap: 16px; }

    .info-panel {
      background: var(--kumo-tint); border: 1px solid var(--kumo-hairline);
      border-radius: var(--kumo-radius-lg); padding: 16px 18px;
    }
    .info-panel-title { font-size: 14px; font-weight: 700; color: var(--kumo-text-default); margin-bottom: 8px; }
    .info-panel p { font-size: 14px; color: var(--kumo-text-strong); line-height: 1.55; }

    .hint-box {
      background: var(--kumo-info-tint); border: 1px solid var(--kumo-info-border);
      border-radius: var(--kumo-radius); padding: 12px 14px;
      font-size: 13px; color: var(--kumo-text-strong); line-height: 1.5;
      display: flex; align-items: flex-start; gap: 10px;
    }
    .hint-box-icon { font-size: 14px; flex-shrink: 0; margin-top: 1px; }
    .hint-box strong { font-weight: 600; }
    .hint-box code {
      font-family: var(--kumo-font-mono); font-size: 12px;
      background: rgba(37,99,235,.1); border: 1px solid var(--kumo-info-border);
      border-radius: 4px; padding: 1px 6px;
    }

    .info-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 12px; }
    .info-tile {
      background: var(--kumo-tint); border: 1px solid var(--kumo-hairline);
      border-radius: var(--kumo-radius-lg); padding: 14px 16px;
    }
    .info-tile-label {
      font-size: 11px; font-weight: 600; color: var(--kumo-text-subtle);
      text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 6px;
    }
    .info-tile-value { font-size: 13px; color: var(--kumo-text-strong); line-height: 1.45; }

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
      .info-grid   { grid-template-columns: 1fr; }
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
      <span class="card-header-icon" aria-hidden="true">🔒</span>
      <h1>Access Denied</h1>
      <p>Training Admin Authentication Required</p>
    </div>

    <div class="card-body">
      <div class="info-panel">
        <p class="info-panel-title">Cloudflare Access Authentication Required</p>
        <p>This admin interface is protected by Cloudflare Access. Please ensure you are authenticated through your SSO provider before accessing the training management system.</p>
      </div>

      <div class="hint-box">
        <span class="hint-box-icon">ℹ️</span>
        <p><strong>Admin access:</strong> Once authenticated, navigate to <code>/admin</code> to open the training management dashboard.</p>
      </div>

      <div class="info-grid">
        <div class="info-tile">
          <p class="info-tile-label">Protection</p>
          <p class="info-tile-value">Cloudflare Access with SSO</p>
        </div>
        <div class="info-tile">
          <p class="info-tile-label">Required Role</p>
          <p class="info-tile-value">Training Administrator</p>
        </div>
      </div>
    </div>

    <div class="card-footer">
      <span>Powered by Cloudflare Workers</span>
    </div>
  </div>

  <script>
    document.getElementById('themeToggle').addEventListener('click', function() {
      var next = document.documentElement.getAttribute('data-mode') === 'dark' ? 'light' : 'dark';
      document.documentElement.setAttribute('data-mode', next);
      localStorage.setItem('ui-mode', next);
    });
  </script>
</body>
</html>
`

  return new Response(html, {
    status: 401,
    headers: { 'content-type': 'text/html' },
  })
}
