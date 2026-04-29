/**
 * Web interface handlers
 *
 * Handles admin dashboard, training status updates, and system overview pages.
 */

import type { Env, TrainingStatus, User } from '../types/index.js'
import { updateUserTrainingStatusByEmail } from '../database/training.js'
import {
  generateNonce,
  addCSPHeaders,
  createCSPHeaders,
} from '../security/csp.js'

/**
 * Update training request body
 */
interface UpdateTrainingBody {
  email: string
  status: string
}

/**
 * Update training response
 */
interface UpdateTrainingResponse {
  success: boolean
  message: string
}

/**
 * Get all users from the database
 */
async function getAllUsers(env: Env): Promise<User[]> {
  try {
    const result = await env.DB.prepare(
      'SELECT id, username, first_name, primary_email, training_status, created_at, updated_at FROM users ORDER BY username',
    ).all<User>()
    return result.results || []
  } catch (error) {
    console.error('Database error:', error)
    return []
  }
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
  const users = await getAllUsers(env)
  const styleNonce = generateNonce()
  const scriptNonce = generateNonce()
  const initNonce = generateNonce()

  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Training Completion Status</title>
  ${THEME_INIT_SCRIPT(initNonce)}
  <style nonce="${styleNonce}">
    ${KUMO_TOKENS}

    *, *::before, *::after { margin: 0; padding: 0; box-sizing: border-box; }

    body {
      font-family: var(--kumo-font);
      background: var(--kumo-canvas);
      min-height: 100vh;
      color: var(--kumo-text-default);
      line-height: 1.5;
      -webkit-font-smoothing: antialiased;
      transition: background 0.2s, color 0.2s;
    }

    /* ── Page header ── */
    .page-header {
      background: var(--kumo-base);
      border-bottom: 1px solid var(--kumo-hairline);
      padding: 0 24px;
      display: flex;
      align-items: center;
      gap: 12px;
      height: 56px;
    }
    .page-header-logo { display: flex; align-items: center; gap: 8px; }
    .cf-dot { width: 20px; height: 20px; background: var(--kumo-orange); border-radius: 50%; flex-shrink: 0; }
    .page-header-title { font-size: 15px; font-weight: 600; color: var(--kumo-text-default); }
    .page-header-sep { color: var(--kumo-hairline); font-size: 18px; font-weight: 300; margin: 0 4px; }
    .page-header-sub { font-size: 14px; color: var(--kumo-text-subtle); }

    ${THEME_TOGGLE_CSS}

    /* ── Page body ── */
    .page-body { max-width: 1200px; margin: 0 auto; padding: 28px 24px 48px; }

    .section-heading { font-size: 22px; font-weight: 700; color: var(--kumo-text-default); margin-bottom: 4px; }
    .section-sub { font-size: 14px; color: var(--kumo-text-subtle); margin-bottom: 24px; }

    /* ── Toasts ── */
    .toast {
      display: none; align-items: center; gap: 10px;
      padding: 12px 16px; border-radius: var(--kumo-radius);
      margin-bottom: 16px; font-size: 14px; font-weight: 500;
      border-left: 3px solid transparent;
    }
    .toast.visible { display: flex; }
    .toast-success { background: var(--kumo-success-tint); color: var(--kumo-success); border-left-color: var(--kumo-success); }
    .toast-error   { background: var(--kumo-danger-tint);  color: var(--kumo-danger);  border-left-color: var(--kumo-danger); }
    .toast-icon { font-size: 16px; flex-shrink: 0; }

    /* ── Toolbar ── */
    .toolbar {
      display: flex; align-items: center; justify-content: space-between; gap: 12px;
      padding: 14px 16px; background: var(--kumo-tint);
      border: 1px solid var(--kumo-hairline); border-radius: var(--kumo-radius-lg);
      margin-bottom: 20px;
    }
    .toolbar-label { font-size: 14px; color: var(--kumo-text-subtle); }

    /* ── Buttons ── */
    .btn {
      display: inline-flex; align-items: center; gap: 6px;
      padding: 8px 16px; border-radius: var(--kumo-radius);
      font-size: 14px; font-weight: 500; font-family: var(--kumo-font);
      cursor: pointer; border: 1px solid transparent;
      transition: background 0.15s, border-color 0.15s, color 0.15s;
      white-space: nowrap;
    }
    .btn:disabled { opacity: 0.55; cursor: not-allowed; }
    .btn-primary { background: var(--kumo-orange); color: #fff; border-color: var(--kumo-orange); }
    .btn-primary:hover:not(:disabled) { background: #d96e18; border-color: #d96e18; }
    .btn-ghost { background: transparent; color: var(--kumo-text-subtle); border-color: transparent; }
    .btn-ghost:hover:not(:disabled) { background: var(--kumo-tint); color: var(--kumo-text-default); }

    /* ── Stats ── */
    .stats-grid {
      display: grid; grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 14px; margin-bottom: 20px;
    }
    .stat-card {
      background: var(--kumo-base); border: 1px solid var(--kumo-hairline);
      border-radius: var(--kumo-radius-lg); padding: 18px 20px;
      display: flex; flex-direction: column; gap: 4px;
      box-shadow: var(--kumo-shadow-sm);
    }
    .stat-value { font-size: 28px; font-weight: 800; line-height: 1.1; }
    .stat-label { font-size: 13px; color: var(--kumo-text-subtle); font-weight: 500; }
    .stat-card.completed  .stat-value { color: var(--kumo-success); }
    .stat-card.started    .stat-value { color: var(--kumo-warning); }
    .stat-card.not-started .stat-value { color: var(--kumo-danger); }
    .stat-card.total       .stat-value { color: var(--kumo-text-default); }

    /* ── Filters ── */
    .filters-row {
      display: flex; flex-wrap: wrap; gap: 12px; align-items: flex-end;
      padding: 14px 16px; background: var(--kumo-tint);
      border: 1px solid var(--kumo-hairline); border-radius: var(--kumo-radius-lg);
      margin-bottom: 14px;
    }
    .filter-group { display: flex; flex-direction: column; gap: 5px; }
    .filter-label { font-size: 12px; font-weight: 500; color: var(--kumo-text-subtle); text-transform: uppercase; letter-spacing: 0.04em; }
    .filter-input, .filter-select {
      padding: 7px 10px; border: 1px solid var(--kumo-border);
      border-radius: var(--kumo-radius); font-size: 14px; font-family: var(--kumo-font);
      background: var(--kumo-base); color: var(--kumo-text-default);
      min-width: 160px; transition: border-color 0.15s, box-shadow 0.15s;
    }
    .filter-input:focus, .filter-select:focus {
      outline: none; border-color: var(--kumo-orange);
      box-shadow: 0 0 0 3px var(--kumo-orange-tint);
    }
    .filter-input::placeholder { color: var(--kumo-text-inactive); }
    .filter-count {
      display: none; font-size: 13px; color: var(--kumo-text-subtle);
      background: var(--kumo-info-tint); border: 1px solid var(--kumo-info-border);
      border-radius: var(--kumo-radius); padding: 7px 12px; align-self: flex-end;
    }

    /* ── Bulk bar ── */
    .bulk-bar {
      display: none; align-items: center; justify-content: space-between; gap: 12px;
      padding: 12px 16px; background: var(--kumo-contrast); color: var(--kumo-canvas);
      border-radius: var(--kumo-radius-lg); margin-bottom: 14px;
    }
    .bulk-bar.active { display: flex; }
    .bulk-bar-left  { display: flex; align-items: center; gap: 12px; }
    .bulk-bar-right { display: flex; align-items: center; gap: 10px; }
    .bulk-count { font-size: 14px; font-weight: 600; }
    .bulk-select {
      padding: 7px 10px; border-radius: var(--kumo-radius); font-size: 14px;
      font-family: var(--kumo-font); background: rgba(255,255,255,.1);
      color: inherit; border: 1px solid rgba(255,255,255,.2); cursor: pointer;
    }
    .bulk-select:focus { outline: none; border-color: var(--kumo-orange); }
    .btn-bulk {
      padding: 7px 14px; border-radius: var(--kumo-radius); font-size: 14px;
      font-weight: 500; font-family: var(--kumo-font); cursor: pointer;
      border: 1px solid rgba(255,255,255,.2); background: rgba(255,255,255,.1);
      color: inherit; transition: background 0.15s;
    }
    .btn-bulk:hover:not(:disabled) { background: rgba(255,255,255,.2); }
    .btn-bulk:disabled { opacity: 0.5; cursor: not-allowed; }
    .btn-bulk-cancel { background: transparent; }
    .btn-bulk-cancel:hover:not(:disabled) { background: rgba(255,255,255,.08); }

    /* ── Table ── */
    .table-wrap {
      border: 1px solid var(--kumo-hairline); border-radius: var(--kumo-radius-lg);
      overflow: hidden; box-shadow: var(--kumo-shadow-sm);
    }
    table { width: 100%; border-collapse: collapse; font-size: 14px; }
    thead tr { background: var(--kumo-tint); border-bottom: 1px solid var(--kumo-hairline); }
    th {
      padding: 10px 14px; font-size: 11px; font-weight: 600;
      color: var(--kumo-text-subtle); text-transform: uppercase;
      letter-spacing: 0.06em; text-align: left; white-space: nowrap;
    }
    th.sortable { cursor: pointer; user-select: none; padding-right: 28px; position: relative; transition: color 0.15s; }
    th.sortable:hover { color: var(--kumo-text-default); }
    th.sortable::after { content: '↕'; position: absolute; right: 10px; opacity: 0.35; font-size: 10px; }
    th.sortable.asc::after  { content: '↑'; opacity: 0.9; color: var(--kumo-orange); }
    th.sortable.desc::after { content: '↓'; opacity: 0.9; color: var(--kumo-orange); }
    .checkbox-cell { width: 40px; padding: 10px 14px; text-align: center; }
    td {
      padding: 12px 14px; border-bottom: 1px solid var(--kumo-hairline);
      vertical-align: middle; background: var(--kumo-base);
      transition: background 0.1s;
    }
    tbody tr:last-child td { border-bottom: none; }
    tbody tr:hover td { background: var(--kumo-tint); }
    tbody tr.selected td { background: var(--kumo-info-tint); }
    .user-name  { font-weight: 600; color: var(--kumo-text-default); }
    .user-email { font-size: 13px; color: var(--kumo-text-subtle); font-family: var(--kumo-font-mono); }
    .timestamp  { font-size: 12px; color: var(--kumo-text-inactive); }
    .user-checkbox, .select-all-checkbox { width: 16px; height: 16px; accent-color: var(--kumo-orange); cursor: pointer; }

    /* ── Status select ── */
    .status-select {
      padding: 5px 10px; border-radius: 20px; font-size: 12px; font-weight: 600;
      font-family: var(--kumo-font); border: 1px solid; cursor: pointer;
      appearance: none; background-repeat: no-repeat;
      background-position: right 8px center; background-size: 10px; padding-right: 24px;
      background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6'%3E%3Cpath d='M0 0l5 6 5-6z' fill='%236b7280'/%3E%3C/svg%3E");
      transition: box-shadow 0.15s;
    }
    .status-select:focus { outline: none; box-shadow: 0 0 0 3px var(--kumo-orange-tint); }
    .status-select.status-completed  { background-color: var(--kumo-success-tint); color: var(--kumo-success); border-color: var(--kumo-success-border); }
    .status-select.status-started    { background-color: var(--kumo-warning-tint); color: var(--kumo-warning); border-color: var(--kumo-warning-border); }
    .status-select.status-not-started { background-color: var(--kumo-danger-tint);  color: var(--kumo-danger);  border-color: var(--kumo-danger-border); }

    /* ── Badge ── */
    .badge {
      display: inline-flex; align-items: center; gap: 4px;
      padding: 3px 10px; border-radius: 20px; font-size: 11px;
      font-weight: 600; letter-spacing: 0.03em; border: 1px solid; white-space: nowrap;
    }
    .badge-success { background: var(--kumo-success-tint); color: var(--kumo-success); border-color: var(--kumo-success-border); }
    .badge-danger  { background: var(--kumo-danger-tint);  color: var(--kumo-danger);  border-color: var(--kumo-danger-border); }
    .badge-dot { width: 6px; height: 6px; border-radius: 50%; background: currentColor; flex-shrink: 0; }

    /* ── Spinner ── */
    .spinner {
      display: inline-block; width: 14px; height: 14px;
      border: 2px solid rgba(255,255,255,0.35); border-top-color: #fff;
      border-radius: 50%; animation: spin 0.7s linear infinite; flex-shrink: 0;
    }
    @keyframes spin { to { transform: rotate(360deg); } }

    /* ── Responsive ── */
    @media (max-width: 768px) {
      .page-body { padding: 20px 16px 40px; }
      .stats-grid { grid-template-columns: repeat(2, 1fr); }
      .toolbar { flex-direction: column; align-items: stretch; }
      .bulk-bar { flex-direction: column; }
      .bulk-bar-right { flex-wrap: wrap; }
      .table-wrap { overflow-x: auto; }
    }
    @media (max-width: 480px) {
      .stats-grid { grid-template-columns: 1fr; }
      .filters-row { flex-direction: column; align-items: stretch; }
      .filter-input, .filter-select { min-width: 0; }
    }
  </style>
</head>
<body>

  <header class="page-header">
    <div class="page-header-logo">
      <div class="cf-dot"></div>
      <span class="page-header-title">Cloudflare Access</span>
    </div>
    <span class="page-header-sep">|</span>
    <span class="page-header-sub">Training Completion Status</span>
    ${THEME_TOGGLE_BTN}
  </header>

  <div class="page-body">
    <h1 class="section-heading">Training Dashboard</h1>
    <p class="section-sub">Manage and track training certification progress across the team.</p>

    <div class="toast toast-success" id="successToast">
      <span class="toast-icon">✓</span>
      <span id="successText">Training status updated successfully.</span>
    </div>
    <div class="toast toast-error" id="errorToast">
      <span class="toast-icon">✕</span>
      <span id="errorText">Failed to update training status.</span>
    </div>

    <div class="toolbar">
      <span class="toolbar-label" id="syncStatus">Ready to sync users from Okta</span>
      <button class="btn btn-primary" id="syncButton">
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
          <path d="M14 8A6 6 0 1 1 8 2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
          <path d="M8 0l2.5 2.5L8 5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
        Sync from Okta
      </button>
    </div>

    <div class="stats-grid">
      <div class="stat-card completed">
        <span class="stat-value" id="completedCount">${users.filter((u) => u.training_status === 'completed').length}</span>
        <span class="stat-label">Completed</span>
      </div>
      <div class="stat-card started">
        <span class="stat-value" id="startedCount">${users.filter((u) => u.training_status === 'started').length}</span>
        <span class="stat-label">In Progress</span>
      </div>
      <div class="stat-card not-started">
        <span class="stat-value" id="notStartedCount">${users.filter((u) => u.training_status === 'not started').length}</span>
        <span class="stat-label">Not Started</span>
      </div>
      <div class="stat-card total">
        <span class="stat-value" id="totalCount">${users.length}</span>
        <span class="stat-label">Total Users</span>
      </div>
    </div>

    <div class="filters-row">
      <div class="filter-group">
        <label for="statusFilter" class="filter-label">Status</label>
        <select id="statusFilter" class="filter-select">
          <option value="">All</option>
          <option value="completed">Completed</option>
          <option value="started">In Progress</option>
          <option value="not started">Not Started</option>
        </select>
      </div>
      <div class="filter-group">
        <label for="searchFilter" class="filter-label">Search</label>
        <input type="text" id="searchFilter" class="filter-input" placeholder="Name or email…">
      </div>
      <div class="filter-group" style="justify-content:flex-end;">
        <label class="filter-label" style="visibility:hidden">Reset</label>
        <button type="button" class="btn btn-ghost" id="clearFiltersBtn">Clear filters</button>
      </div>
      <div class="filter-count" id="filterCount"></div>
    </div>

    <div class="bulk-bar" id="bulkBar">
      <div class="bulk-bar-left">
        <span class="bulk-count" id="bulkCount">0 selected</span>
      </div>
      <div class="bulk-bar-right">
        <select id="bulkStatusSelect" class="bulk-select">
          <option value="">Change status to…</option>
          <option value="completed">Completed</option>
          <option value="started">In Progress</option>
          <option value="not started">Not Started</option>
        </select>
        <button type="button" class="btn-bulk" id="applyBulkAction">Apply</button>
        <button type="button" class="btn-bulk btn-bulk-cancel" id="cancelBulkAction">Cancel</button>
      </div>
    </div>

    <div class="table-wrap">
      <table id="usersTable">
        <thead>
          <tr>
            <th class="checkbox-cell"><input type="checkbox" class="select-all-checkbox" id="selectAllCheckbox"></th>
            <th class="sortable" data-column="first_name">Name</th>
            <th class="sortable" data-column="primary_email">Email</th>
            <th class="sortable" data-column="training_status">Training Status</th>
            <th>Access</th>
            <th class="sortable" data-column="updated_at">Last Updated</th>
          </tr>
        </thead>
        <tbody>
          ${users
            .map(
              (user) => `
          <tr data-user-id="${user.id}" data-user-email="${user.primary_email}">
            <td class="checkbox-cell"><input type="checkbox" class="user-checkbox" value="${user.primary_email}"></td>
            <td class="user-name">${user.first_name || '-'}</td>
            <td class="user-email">${user.primary_email || '-'}</td>
            <td>
              <select class="status-select status-${user.training_status.replace(' ', '-')}"
                      data-email="${user.primary_email}"
                      data-original-value="${user.training_status}">
                <option value="not started" ${user.training_status === 'not started' ? 'selected' : ''}>Not Started</option>
                <option value="started"     ${user.training_status === 'started'     ? 'selected' : ''}>In Progress</option>
                <option value="completed"   ${user.training_status === 'completed'   ? 'selected' : ''}>Completed</option>
              </select>
            </td>
            <td>
              <span class="badge ${user.training_status === 'completed' ? 'badge-success' : 'badge-danger'}">
                <span class="badge-dot"></span>
                ${user.training_status === 'completed' ? 'Granted' : 'Denied'}
              </span>
            </td>
            <td class="timestamp">${new Date(user.updated_at).toLocaleString()}</td>
          </tr>`,
            )
            .join('')}
        </tbody>
      </table>
    </div>
  </div>

  <script nonce="${scriptNonce}">
    ${THEME_TOGGLE_JS}

    async function updateTrainingStatus(email, newStatus, selectElement) {
      const originalValue = selectElement.getAttribute('data-original-value');
      if (newStatus === originalValue) return;
      selectElement.disabled = true;
      try {
        const res = await fetch('/api/update-training', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          credentials: 'same-origin', body: JSON.stringify({ email, status: newStatus }),
        });
        const result = await res.json();
        if (result.success) {
          selectElement.className = 'status-select status-' + newStatus.replace(' ', '-');
          selectElement.setAttribute('data-original-value', newStatus);
          const row = selectElement.closest('tr');
          row.querySelector('.timestamp').textContent = new Date().toLocaleString();
          const badge = row.querySelector('.badge');
          if (newStatus === 'completed') { badge.className = 'badge badge-success'; badge.innerHTML = '<span class="badge-dot"></span>Granted'; }
          else { badge.className = 'badge badge-danger'; badge.innerHTML = '<span class="badge-dot"></span>Denied'; }
          updateStats();
          showToast('success', 'Training status updated.');
        } else {
          selectElement.value = originalValue;
          showToast('error', result.message || 'Failed to update training status.');
        }
      } catch (err) {
        console.error(err); selectElement.value = originalValue;
        showToast('error', 'Network error. Please try again.');
      } finally { selectElement.disabled = false; }
    }

    function updateStats() {
      let completed = 0, started = 0, notStarted = 0;
      document.querySelectorAll('.status-select').forEach(s => {
        if (s.value === 'completed') completed++;
        else if (s.value === 'started') started++;
        else notStarted++;
      });
      document.getElementById('completedCount').textContent = completed;
      document.getElementById('startedCount').textContent = started;
      document.getElementById('notStartedCount').textContent = notStarted;
    }

    async function syncOktaUsers() {
      const btn = document.getElementById('syncButton');
      const label = document.getElementById('syncStatus');
      btn.disabled = true;
      btn.innerHTML = '<span class="spinner"></span>Syncing\u2026';
      label.textContent = 'Syncing users from Okta\u2026';
      try {
        const res = await fetch('/api/okta/sync', { method: 'POST', credentials: 'same-origin' });
        const result = await res.json();
        if (result.success) {
          label.textContent = 'Sync completed: +' + result.results.added + ' added, ' + result.results.updated + ' updated, ' + result.results.skipped + ' skipped';
          showToast('success', result.message);
          setTimeout(() => window.location.reload(), 2000);
        } else {
          label.textContent = 'Sync failed';
          showToast('error', result.message || 'Failed to sync users from Okta.');
        }
      } catch (err) {
        console.error(err); label.textContent = 'Sync failed';
        showToast('error', 'Network error during sync.');
      } finally {
        btn.disabled = false;
        btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M14 8A6 6 0 1 1 8 2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><path d="M8 0l2.5 2.5L8 5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>Sync from Okta';
        setTimeout(() => { label.textContent = 'Ready to sync users from Okta'; }, 5000);
      }
    }

    function showToast(type, message) {
      const s = document.getElementById('successToast');
      const e = document.getElementById('errorToast');
      s.classList.remove('visible'); e.classList.remove('visible');
      if (type === 'success') {
        document.getElementById('successText').textContent = message;
        s.classList.add('visible'); setTimeout(() => s.classList.remove('visible'), 3000);
      } else {
        document.getElementById('errorText').textContent = message;
        e.classList.add('visible'); setTimeout(() => e.classList.remove('visible'), 5000);
      }
    }

    let currentSort = { column: null, direction: 'asc' };
    function initSorting() {
      document.querySelectorAll('th.sortable').forEach(th => {
        th.addEventListener('click', () => sortTable(th.dataset.column, th));
      });
    }
    function sortTable(column, headerEl) {
      const tbody = document.querySelector('#usersTable tbody');
      const rows = Array.from(tbody.querySelectorAll('tr'));
      let dir = (currentSort.column === column && currentSort.direction === 'asc') ? 'desc' : 'asc';
      document.querySelectorAll('th.sortable').forEach(th => th.classList.remove('asc', 'desc'));
      headerEl.classList.add(dir);
      rows.sort((a, b) => {
        let av = getCellValue(a, column), bv = getCellValue(b, column);
        if (column === 'updated_at') { av = new Date(av); bv = new Date(bv); }
        else if (column === 'training_status') { const o = { completed:3, started:2, 'not started':1 }; av = o[av]||0; bv = o[bv]||0; }
        else { av = av.toLowerCase(); bv = bv.toLowerCase(); }
        return dir === 'asc' ? (av > bv ? 1 : -1) : (av < bv ? 1 : -1);
      });
      rows.forEach(r => tbody.appendChild(r));
      currentSort = { column, direction: dir };
    }
    function getCellValue(row, column) {
      switch (column) {
        case 'first_name':      return row.querySelector('.user-name').textContent.trim();
        case 'primary_email':   return row.querySelector('.user-email').textContent.trim();
        case 'training_status': return row.querySelector('.status-select').value;
        case 'updated_at':      return row.querySelector('.timestamp').textContent.trim();
        default: return '';
      }
    }

    function initFiltering() {
      document.getElementById('statusFilter').addEventListener('change', applyFilters);
      document.getElementById('searchFilter').addEventListener('input', debounce(applyFilters, 250));
    }
    function applyFilters() {
      const status = document.getElementById('statusFilter').value;
      const search = document.getElementById('searchFilter').value.toLowerCase();
      const rows = document.querySelectorAll('#usersTable tbody tr');
      let visible = 0;
      rows.forEach(row => {
        const s = row.querySelector('.status-select').value;
        const n = row.querySelector('.user-name').textContent.toLowerCase();
        const e = row.querySelector('.user-email').textContent.toLowerCase();
        const match = (!status || s === status) && (!search || n.includes(search) || e.includes(search));
        row.style.display = match ? '' : 'none';
        if (match) visible++;
      });
      const counter = document.getElementById('filterCount');
      if (visible === rows.length) { counter.style.display = 'none'; }
      else { counter.style.display = 'block'; counter.textContent = 'Showing ' + visible + ' of ' + rows.length; }
    }
    function clearFilters() {
      document.getElementById('statusFilter').value = '';
      document.getElementById('searchFilter').value = '';
      applyFilters();
    }
    function debounce(fn, wait) {
      let t;
      return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), wait); };
    }

    let selectedUsers = [];
    function updateSelection() {
      selectedUsers = Array.from(document.querySelectorAll('.user-checkbox')).filter(cb => cb.checked).map(cb => cb.value);
      updateBulkUI();
    }
    function toggleAll(masterCb) {
      const visible = Array.from(document.querySelectorAll('.user-checkbox')).filter(cb => cb.closest('tr').style.display !== 'none');
      visible.forEach(cb => { cb.checked = masterCb.checked; cb.closest('tr').classList.toggle('selected', masterCb.checked); });
      updateSelection();
    }
    function updateBulkUI() {
      const bar = document.getElementById('bulkBar');
      const count = document.getElementById('bulkCount');
      const master = document.getElementById('selectAllCheckbox');
      if (selectedUsers.length > 0) {
        bar.classList.add('active');
        count.textContent = selectedUsers.length + ' user' + (selectedUsers.length !== 1 ? 's' : '') + ' selected';
        document.querySelectorAll('.user-checkbox').forEach(cb => { cb.closest('tr').classList.toggle('selected', cb.checked); });
      } else {
        bar.classList.remove('active'); master.checked = false; master.indeterminate = false;
        document.querySelectorAll('tr.selected').forEach(r => r.classList.remove('selected'));
      }
      const visible = Array.from(document.querySelectorAll('.user-checkbox')).filter(cb => cb.closest('tr').style.display !== 'none');
      const checked = visible.filter(cb => cb.checked);
      if (checked.length === 0) { master.indeterminate = false; master.checked = false; }
      else if (checked.length === visible.length) { master.indeterminate = false; master.checked = true; }
      else { master.indeterminate = true; }
    }
    function clearSelection() {
      document.querySelectorAll('.user-checkbox').forEach(cb => { cb.checked = false; });
      document.getElementById('bulkStatusSelect').value = '';
      updateSelection();
    }
    async function applyBulk() {
      const newStatus = document.getElementById('bulkStatusSelect').value;
      if (!newStatus || selectedUsers.length === 0) { showToast('error', 'Please select a status and at least one user.'); return; }
      const applyBtn = document.getElementById('applyBulkAction');
      applyBtn.disabled = true; applyBtn.textContent = 'Updating\u2026';
      try {
        const results = await Promise.all(selectedUsers.map(async email => {
          const res = await fetch('/api/update-training', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            credentials: 'same-origin', body: JSON.stringify({ email, status: newStatus }),
          });
          return { email, data: await res.json() };
        }));
        const ok = results.filter(r => r.data.success);
        const fail = results.filter(r => !r.data.success);
        ok.forEach(({ email }) => {
          const row = document.querySelector('tr[data-user-email="' + email + '"]');
          if (!row) return;
          const sel = row.querySelector('.status-select');
          sel.value = newStatus; sel.className = 'status-select status-' + newStatus.replace(' ', '-');
          sel.setAttribute('data-original-value', newStatus);
          const badge = row.querySelector('.badge');
          if (newStatus === 'completed') { badge.className = 'badge badge-success'; badge.innerHTML = '<span class="badge-dot"></span>Granted'; }
          else { badge.className = 'badge badge-danger'; badge.innerHTML = '<span class="badge-dot"></span>Denied'; }
        });
        updateStats();
        if (ok.length)   showToast('success', 'Updated ' + ok.length + ' user' + (ok.length !== 1 ? 's' : '') + ' to "' + newStatus + '".');
        if (fail.length) showToast('error', 'Failed to update ' + fail.length + ' user' + (fail.length !== 1 ? 's' : '') + '.');
        clearSelection();
      } catch (err) {
        console.error(err); showToast('error', 'Bulk update failed. Please try again.');
      } finally { applyBtn.disabled = false; applyBtn.textContent = 'Apply'; }
    }

    document.addEventListener('DOMContentLoaded', () => {
      initSorting(); initFiltering();
      document.getElementById('syncButton').addEventListener('click', syncOktaUsers);
      document.getElementById('clearFiltersBtn').addEventListener('click', clearFilters);
      document.getElementById('applyBulkAction').addEventListener('click', applyBulk);
      document.getElementById('cancelBulkAction').addEventListener('click', clearSelection);
      document.getElementById('selectAllCheckbox').addEventListener('change', function() { toggleAll(this); });
      document.getElementById('usersTable').addEventListener('change', e => {
        if (e.target.classList.contains('user-checkbox')) updateSelection();
        if (e.target.classList.contains('status-select')) updateTrainingStatus(e.target.dataset.email, e.target.value, e.target);
      });
    });
  </script>

</body>
</html>
`

  const response = new Response(html, {
    headers: {
      'content-type': 'text/html',
      'cache-control': 'private, no-cache, no-store, must-revalidate',
      pragma: 'no-cache',
      expires: '0',
      'x-content-version': `${Date.now()}-${scriptNonce.substring(0, 8)}`,
      'x-script-nonce': scriptNonce,
      'x-style-nonce': styleNonce,
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
  try {
    const body = (await request.json()) as UpdateTrainingBody
    const { email, status } = body

    const secureHeaders: Record<string, string> = {
      'content-type': 'application/json',
      ...createCSPHeaders(env),
    }

    if (!email || !status) {
      return new Response(
        JSON.stringify({ success: false, message: 'Email and status are required' } as UpdateTrainingResponse),
        { status: 400, headers: secureHeaders },
      )
    }

    const validStatuses: TrainingStatus[] = ['not started', 'started', 'completed']
    if (!validStatuses.includes(status as TrainingStatus)) {
      return new Response(
        JSON.stringify({ success: false, message: 'Invalid status value' } as UpdateTrainingResponse),
        { status: 400, headers: secureHeaders },
      )
    }

    const updated = await updateUserTrainingStatusByEmail(env, email, status as TrainingStatus)

    if (updated) {
      return new Response(
        JSON.stringify({ success: true, message: 'Training status updated successfully' } as UpdateTrainingResponse),
        { headers: secureHeaders },
      )
    } else {
      return new Response(
        JSON.stringify({ success: false, message: 'User not found or update failed' } as UpdateTrainingResponse),
        { status: 404, headers: secureHeaders },
      )
    }
  } catch (error) {
    console.error('Update training error:', error)
    return new Response(
      JSON.stringify({ success: false, message: 'Internal server error' } as UpdateTrainingResponse),
      { status: 500, headers: { 'content-type': 'application/json', ...createCSPHeaders(env) } },
    )
  }
}

// ---------------------------------------------------------------------------
// System Overview (/)
// ---------------------------------------------------------------------------

export async function handleSystemOverview(env: Env): Promise<Response> {
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
