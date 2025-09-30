import { updateUserTrainingStatusByEmail } from '../database/training.js'
import {
  generateNonce,
  addCSPHeaders,
  createCSPHeaders,
} from '../security/csp.js'

/**
 * Get all users from the database
 * @param {*} env - Environment bindings
 * @returns {Array} List of users with their training status
 */
async function getAllUsers(env) {
  try {
    const result = await env.DB.prepare(
      'SELECT id, username, first_name, primary_email, training_status, created_at, updated_at FROM users ORDER BY username',
    ).all()

    return result.results || []
  } catch (error) {
    console.error('Database error:', error)
    return []
  }
}

/**
 * Handle GET request for the web interface
 * @param {*} env - Environment bindings
 * @returns {Response} HTML response
 */
export async function handleWebInterface(env) {
  const users = await getAllUsers(env)

  // Generate nonces for inline scripts and styles
  const styleNonce = generateNonce()
  const scriptNonce = generateNonce()

  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Training Completion Status</title>
    <style nonce="${styleNonce}">
        /* Professional Design System - Gateway Style */
        :root {
            --accent: #F38020;         /* Cloudflare Orange */
            --cta: #2563EB;            /* Blue CTA */
            --cta-hover: #1E40AF;
            --surface: #ffffff;        /* Card & modal surface */
            --muted: #6B7280;          /* Muted text */
            --border: #E5E7EB;         /* Subtle borders */
            --panel: #F8FAFC;          /* Light panels inside card */
            --shadow: 0 12px 30px rgba(2,6,23,.18);
            --shadow-sm: 0 4px 12px rgba(2,6,23,.08);
            --radius: 16px;
            --text-primary: #111827;
            --text-secondary: #374151;
            
            /* Status Colors */
            --status-success: #16A34A;
            --status-warning: #F59E0B;
            --status-danger: #DC2626;
            --status-info: #0EA5E9;
            
            /* Table Colors */
            --table-header: #1f2a5a;
            --table-header-end: #232e65;
        }
        
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
            background: radial-gradient(1200px 800px at 50% -10%, #111827 0%, #0f172a 60%);
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            color: var(--text-primary);
            line-height: 1.6;
            -webkit-font-smoothing: antialiased;
            -moz-osx-font-smoothing: grayscale;
            padding: 24px;
        }
        
        .container {
            background: var(--surface);
            border-radius: var(--radius);
            box-shadow: var(--shadow);
            max-width: 1152px;
            width: 100%;
            margin: 0;
            overflow: hidden;
        }
        
        .header {
            background: var(--accent);
            color: #fff;
            padding: 28px 28px 24px;
            text-align: center;
        }
        
        .header .icon {
            font-size: 40px;
            display: block;
            margin-bottom: 12px;
            line-height: 1;
        }
        
        .header h1 {
            font-size: 28px;
            font-weight: 700;
            letter-spacing: 0.2px;
            margin-bottom: 6px;
        }
        
        .header p {
            font-size: 14px;
            opacity: 0.95;
        }
        
        .content {
            padding: 28px;
        }
        
        .controls {
            background: var(--panel);
            border: 1px solid var(--border);
            border-radius: 12px;
            padding: 18px;
            margin-bottom: 18px;
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 16px;
        }
        
        
        .sync-button {
            appearance: none;
            border: none;
            cursor: pointer;
            background: linear-gradient(180deg, var(--table-header), var(--table-header-end));
            color: #fff;
            font-weight: 600;
            font-size: 16px;
            padding: 12px 22px;
            border-radius: 12px;
            transition: transform 0.05s ease, background 0.2s ease, box-shadow 0.2s ease;
            box-shadow: 0 6px 14px rgba(31,42,90,.25);
            display: inline-flex;
            align-items: center;
            gap: 8px;
        }
        
        .sync-button:hover {
            background: linear-gradient(180deg, #253463, #2a3a6f);
        }
        
        .sync-button:active {
            transform: translateY(1px);
        }
        
        .sync-button:disabled {
            opacity: 0.6;
            cursor: not-allowed;
        }
        
        .sync-status {
            font-weight: 600;
            color: var(--text-secondary);
            font-size: 14px;
        }
        
        .stats {
            display: grid;
            grid-template-columns: repeat(4, minmax(0, 1fr));
            gap: 16px;
            margin: 18px 0 24px;
        }
        
        .stat-card {
            background: rgba(255, 255, 255, 0.65);
            border: 1px solid rgba(15, 23, 42, 0.06);
            border-radius: 16px;
            padding: 18px;
            text-align: center;
            box-shadow: 0 6px 20px rgba(2, 6, 23, 0.10);
            transition: transform 0.15s ease;
        }
        
        .stat-card:hover {
            transform: translateY(-2px);
        }
        
        .stat-number {
            font-size: 1.875rem;
            font-weight: 800;
            line-height: var(--line-height-tight);
        }
        
        .stat-card.completed .stat-number {
            color: #10b981;
        }
        
        .stat-card.started .stat-number {
            color: #f59e0b;
        }
        
        .stat-card.not-started .stat-number {
            color: #ef4444;
        }
        
        .stat-card.total .stat-number {
            color: var(--table-header);
        }
        
        .stat-label {
            color: var(--color-neutral-600);
            margin-top: var(--spacing-2);
            font-weight: var(--font-weight-medium);
            font-size: var(--font-size-sm);
        }
        
        .table-container {
            border-radius: 16px;
            overflow: hidden;
            background: rgba(255, 255, 255, 0.8);
            border: 1px solid rgba(15, 23, 42, 0.08);
            box-shadow: 0 6px 20px rgba(2, 6, 23, 0.10);
        }
        
        table {
            width: 100%;
            border-collapse: separate;
            border-spacing: 0;
        }
        
        th {
            background: linear-gradient(180deg, #1f2a5a, #232e65);
            color: white;
            font-size: 0.75rem;
            letter-spacing: 0.06em;
            text-transform: uppercase;
            padding: 14px 16px;
            position: sticky;
            top: 0;
            z-index: 1;
            text-align: left;
            font-weight: var(--font-weight-semibold);
        }
        
        th.sortable {
            cursor: pointer;
            user-select: none;
            padding-right: var(--spacing-8);
            transition: background-color var(--transition-base);
        }
        
        th.sortable:hover {
            background: var(--color-neutral-900);
        }
        
        th.sortable::after {
            content: '↕';
            position: absolute;
            right: var(--spacing-3);
            opacity: 0.5;
            font-size: var(--font-size-xs);
        }
        
        th.sortable.asc::after {
            content: '↑';
            opacity: 1;
        }
        
        th.sortable.desc::after {
            content: '↓';
            opacity: 1;
        }
        
        td {
            padding: 14px 16px;
            border-top: 1px solid #eef2f7;
            vertical-align: middle;
        }
        
        tr:hover {
            background: #f8fafc;
        }
        
        tr:last-child td {
            border-bottom: none;
        }
        
        .status-select {
            background: var(--color-neutral-50);
            border: 2px solid var(--color-neutral-300);
            border-radius: var(--radius-sm);
            padding: var(--spacing-2) var(--spacing-3);
            font-size: var(--font-size-sm);
            font-family: var(--font-family-sans);
            cursor: pointer;
            transition: all var(--transition-base);
            font-weight: var(--font-weight-medium);
            min-width: 140px;
        }
        
        .status-select:focus {
            outline: 2px solid var(--color-primary-500);
            outline-offset: 2px;
            border-color: var(--color-primary-500);
        }
        
        .status-completed {
            background-color: var(--color-success-100);
            color: var(--color-success-800);
            border-color: var(--color-success-300);
        }
        
        .status-started {
            background-color: var(--color-warning-100);
            color: var(--color-warning-800);
            border-color: var(--color-warning-300);
        }
        
        .status-not-started {
            background-color: var(--color-danger-100);
            color: var(--color-danger-800);
            border-color: var(--color-danger-300);
        }
        
        .username {
            font-weight: var(--font-weight-semibold);
            color: var(--color-neutral-800);
            font-size: var(--font-size-base);
        }
        
        .email {
            color: var(--color-neutral-600);
            font-size: var(--font-size-sm);
            font-family: 'SF Mono', Monaco, 'Cascadia Code', monospace;
        }
        
        .timestamp {
            color: var(--color-neutral-500);
            font-size: var(--font-size-xs);
            font-weight: var(--font-weight-normal);
        }
        
        .loading {
            opacity: 0.6;
            pointer-events: none;
            position: relative;
        }
        
        .loading::after {
            content: '';
            position: absolute;
            inset: 0;
            background: var(--color-neutral-50);
            opacity: 0.5;
            border-radius: var(--radius-sm);
        }
        
        /* Spinner Animation */
        .spinner {
            display: inline-block;
            width: 16px;
            height: 16px;
            border: 2px solid var(--color-neutral-300);
            border-radius: 50%;
            border-top-color: var(--color-primary-600);
            animation: spin 1s ease-in-out infinite;
            margin-right: var(--spacing-2);
        }
        
        @keyframes spin {
            to {
                transform: rotate(360deg);
            }
        }
        
        .sync-button.loading {
            pointer-events: none;
            opacity: 0.8;
        }
        
        .sync-button.loading .spinner {
            border-top-color: var(--color-neutral-50);
            border-color: rgba(255, 255, 255, 0.3);
        }
        
        .success-message {
            background: var(--color-success-100);
            color: var(--color-success-800);
            padding: var(--spacing-3) var(--spacing-5);
            border-radius: var(--radius-base);
            margin: var(--spacing-3) 0;
            display: none;
            border-left: var(--spacing-1) solid var(--color-success-500);
            font-weight: var(--font-weight-medium);
            font-size: var(--font-size-sm);
        }
        
        .error-message {
            background: var(--color-danger-100);
            color: var(--color-danger-800);
            padding: var(--spacing-3) var(--spacing-5);
            border-radius: var(--radius-base);
            margin: var(--spacing-3) 0;
            display: none;
            border-left: var(--spacing-1) solid var(--color-danger-500);
            font-weight: var(--font-weight-medium);
            font-size: var(--font-size-sm);
        }
        
        .access-indicator {
            display: inline-flex;
            align-items: center;
            gap: var(--spacing-1);
            padding: var(--spacing-1) var(--spacing-3);
            border-radius: var(--radius-lg);
            font-size: var(--font-size-xs);
            font-weight: var(--font-weight-semibold);
            text-transform: uppercase;
            letter-spacing: 0.05em;
        }
        
        .access-granted {
            background-color: var(--color-success-100);
            color: var(--color-success-800);
            border: 1px solid var(--color-success-200);
        }
        
        .access-denied {
            background-color: var(--color-danger-100);
            color: var(--color-danger-800);
            border: 1px solid var(--color-danger-200);
        }
        
        /* Table Filter Controls */
        .table-filters {
            display: flex;
            flex-wrap: wrap;
            gap: 14px 18px;
            align-items: end;
            padding: clamp(16px, 2vw, 24px);
            background: rgba(255, 255, 255, 0.7);
            border: 1px solid rgba(15, 23, 42, 0.06);
            border-radius: 14px;
            margin-bottom: 18px;
        }
        
        .filter-group {
            display: flex;
            flex-direction: column;
            gap: var(--spacing-2);
        }
        
        .filter-label {
            font-size: var(--font-size-sm);
            font-weight: var(--font-weight-medium);
            color: var(--color-neutral-700);
        }
        
        .filter-select,
        .filter-input {
            padding: var(--spacing-2) var(--spacing-3);
            border: 2px solid var(--color-neutral-300);
            border-radius: var(--radius-sm);
            font-size: var(--font-size-sm);
            font-family: var(--font-family-sans);
            background: var(--color-neutral-50);
            transition: all var(--transition-base);
            min-width: 160px;
        }
        
        .filter-select:focus,
        .filter-input:focus {
            outline: 2px solid var(--color-primary-500);
            outline-offset: 2px;
            border-color: var(--color-primary-500);
        }
        
        .filter-input::placeholder {
            color: var(--color-neutral-400);
        }
        
        .filter-clear {
            background: var(--color-neutral-50);
            color: var(--color-neutral-700);
            border: 2px solid var(--color-neutral-300);
            padding: var(--spacing-2) var(--spacing-4);
            border-radius: var(--radius-sm);
            cursor: pointer;
            font-size: var(--font-size-sm);
            font-weight: var(--font-weight-medium);
            font-family: var(--font-family-sans);
            transition: all var(--transition-base);
        }
        
        .filter-clear:hover {
            background: var(--color-neutral-200);
            border-color: var(--color-neutral-400);
        }
        
        .filter-clear:focus {
            outline: 2px solid var(--color-primary-500);
            outline-offset: 2px;
        }
        
        .filter-count {
            font-size: var(--font-size-sm);
            color: var(--color-neutral-600);
            font-weight: var(--font-weight-medium);
            align-self: center;
            background: var(--color-primary-100);
            padding: var(--spacing-2) var(--spacing-3);
            border-radius: var(--radius-sm);
            border: 1px solid var(--color-primary-200);
        }
        
        /* Bulk Actions Toolbar */
        .bulk-actions {
            display: none;
            background: var(--color-neutral-800);
            color: var(--color-neutral-50);
            padding: var(--spacing-4) var(--spacing-5);
            border-radius: var(--radius-base);
            margin-bottom: var(--spacing-5);
            align-items: center;
            justify-content: space-between;
            box-shadow: var(--shadow-lg);
        }
        
        .bulk-actions.active {
            display: flex;
        }
        
        .bulk-actions-left {
            display: flex;
            align-items: center;
            gap: var(--spacing-4);
        }
        
        .bulk-selection-count {
            font-weight: var(--font-weight-semibold);
            font-size: var(--font-size-base);
        }
        
        .bulk-actions-right {
            display: flex;
            align-items: center;
            gap: var(--spacing-3);
        }
        
        .bulk-action-btn {
            background: var(--color-neutral-600);
            color: var(--color-neutral-50);
            border: 1px solid var(--color-neutral-500);
            padding: var(--spacing-2) var(--spacing-4);
            border-radius: var(--radius-sm);
            font-size: var(--font-size-sm);
            font-weight: var(--font-weight-medium);
            cursor: pointer;
            transition: all var(--transition-base);
            font-family: var(--font-family-sans);
        }
        
        .bulk-action-btn:hover {
            background: var(--color-neutral-500);
            border-color: var(--color-neutral-400);
        }
        
        .bulk-action-btn:disabled {
            opacity: 0.5;
            cursor: not-allowed;
        }
        
        .bulk-cancel {
            background: transparent;
            color: var(--color-neutral-300);
            border: 1px solid var(--color-neutral-500);
        }
        
        .bulk-cancel:hover {
            background: var(--color-neutral-700);
            border-color: var(--color-neutral-400);
            color: var(--color-neutral-50);
        }
        
        /* Checkbox Styling */
        .checkbox-cell {
            width: 40px;
            text-align: center;
        }
        
        .user-checkbox,
        .select-all-checkbox {
            width: 18px;
            height: 18px;
            accent-color: var(--color-primary-600);
            cursor: pointer;
            border-radius: var(--radius-xs);
        }
        
        .user-checkbox:focus,
        .select-all-checkbox:focus {
            outline: 2px solid var(--color-primary-500);
            outline-offset: 2px;
        }
        
        tr.selected {
            background: var(--color-primary-50);
        }
        
        tr.selected:hover {
            background: var(--color-primary-100);
        }
        
        
        @media (max-width: 768px) {
            body {
                padding: var(--spacing-3);
            }
            
            .header {
                padding: var(--spacing-6);
            }
            
            .header h1 {
                font-size: var(--font-size-3xl);
            }
            
            .content {
                padding: var(--spacing-5);
            }
            
            .controls {
                flex-direction: column;
                align-items: stretch;
                gap: var(--spacing-4);
            }
            
            .sync-status {
                text-align: center;
            }
            
            table {
                font-size: var(--font-size-sm);
            }
            
            th, td {
                padding: var(--spacing-3);
            }
            
            .stats {
                grid-template-columns: repeat(2, 1fr);
                gap: var(--spacing-3);
            }
            
            .table-container {
                overflow-x: auto;
            }
            
            .table-filters {
                flex-direction: column;
                align-items: stretch;
                gap: var(--spacing-4);
            }
            
            .filter-select,
            .filter-input {
                min-width: auto;
            }
            
            .bulk-actions {
                flex-direction: column;
                gap: var(--spacing-4);
                text-align: center;
            }
            
            .bulk-actions-right {
                flex-direction: column;
                gap: var(--spacing-3);
            }
            
            .bulk-action-btn,
            #bulkStatusSelect {
                width: 100%;
            }
            
            .stats {
                grid-template-columns: repeat(2, 1fr);
            }
        }
        
        @media (max-width: 520px) {
            .stats {
                grid-template-columns: 1fr;
            }
        }
        
        /* Stats Grid */
        .stats {
            display: grid;
            grid-template-columns: repeat(4, minmax(0, 1fr));
            gap: 16px;
            margin: 18px 0 24px;
        }
        
        .stat-card {
            background: var(--panel);
            border: 1px solid var(--border);
            border-radius: 12px;
            padding: 18px;
            text-align: center;
        }
        
        .stat-number {
            font-size: 1.875rem;
            font-weight: 700;
            line-height: 1.2;
            color: var(--text-primary);
        }
        
        .stat-label {
            font-size: 14px;
            color: var(--text-secondary);
            font-weight: 500;
            margin-top: 4px;
        }
        
        /* Table Filters */
        .table-filters {
            background: var(--panel);
            border: 1px solid var(--border);
            border-radius: 12px;
            padding: 16px 18px;
            margin: 18px 0;
            display: flex;
            gap: 16px;
            align-items: center;
            flex-wrap: wrap;
        }
        
        .filter-group {
            display: flex;
            align-items: center;
            gap: 8px;
        }
        
        .filter-label {
            font-weight: 600;
            color: var(--text-primary);
            font-size: 14px;
            white-space: nowrap;
        }
        
        .filter-select,
        .filter-input {
            background: var(--surface);
            border: 1px solid var(--border);
            border-radius: 8px;
            padding: 8px 12px;
            font-size: 14px;
            color: var(--text-primary);
            min-width: 140px;
        }
        
        .filter-select:focus,
        .filter-input:focus {
            outline: 2px solid var(--cta);
            outline-offset: -2px;
            border-color: var(--cta);
        }
        
        .filter-clear {
            background: var(--muted);
            color: white;
            border: none;
            padding: 8px 12px;
            border-radius: 8px;
            font-size: 14px;
            cursor: pointer;
            font-weight: 500;
        }
        
        .filter-clear:hover {
            background: #4B5563;
        }
        
        .filter-actions {
            display: flex;
            flex-direction: column;
            gap: 8px;
        }
        
        /* Bulk Actions */
        .bulk-actions {
            background: var(--cta);
            color: white;
            padding: 12px 18px;
            border-radius: 12px;
            margin: 18px 0;
            display: none;
            align-items: center;
            justify-content: space-between;
        }
        
        .bulk-actions.show {
            display: flex;
        }
        
        .bulk-actions-left {
            font-weight: 600;
        }
        
        .bulk-actions-right {
            display: flex;
            gap: 8px;
            align-items: center;
        }
        
        .bulk-action-btn {
            background: rgba(255,255,255,0.2);
            color: white;
            border: none;
            padding: 6px 12px;
            border-radius: 6px;
            font-size: 14px;
            cursor: pointer;
        }
        
        .bulk-action-btn:hover {
            background: rgba(255,255,255,0.3);
        }
        
        /* Table Container */
        .table-container {
            background: var(--surface);
            border: 1px solid var(--border);
            border-radius: 12px;
            overflow: hidden;
        }
        
        /* Table Styling */
        table {
            width: 100%;
            border-collapse: collapse;
        }
        
        th {
            background: linear-gradient(180deg, var(--table-header), var(--table-header-end));
            color: white;
            font-weight: 600;
            font-size: 14px;
            padding: 14px 16px;
            text-align: left;
            border: none;
            cursor: pointer;
        }
        
        th.sortable:hover {
            background: linear-gradient(180deg, #253463, #2a3a6f);
        }
        
        .checkbox-cell {
            width: 40px;
            text-align: center;
        }
        
        td {
            padding: 12px 16px;
            border-bottom: 1px solid var(--border);
            font-size: 14px;
            color: var(--text-primary);
        }
        
        tr:hover {
            background: var(--panel);
        }
        
        tr:last-child td {
            border-bottom: none;
        }
        
        /* Status Select Styling */
        .status-select {
            background: var(--panel);
            border: 1px solid var(--border);
            border-radius: 6px;
            padding: 6px 10px;
            font-size: 13px;
            cursor: pointer;
            font-weight: 500;
            min-width: 120px;
        }
        
        .status-select:focus {
            outline: 2px solid var(--cta);
            outline-offset: -2px;
        }
        
        .status-completed {
            background: #DCFCE7;
            color: #166534;
            border-color: #BBF7D0;
        }
        
        .status-started {
            background: #FEF3C7;
            color: #92400E;
            border-color: #FDE68A;
        }
        
        .status-not-started {
            background: #FEE2E2;
            color: #991B1B;
            border-color: #FECACA;
        }
        
        /* Access Indicators */
        .access-indicator {
            font-weight: 500;
            font-size: 13px;
        }
        
        .access-granted {
            color: var(--status-success);
        }
        
        .access-denied {
            color: var(--status-danger);
        }
        
        /* Success/Error Messages */
        .success-message,
        .error-message {
            padding: 12px 16px;
            border-radius: 8px;
            font-weight: 500;
            margin-bottom: 16px;
            display: none;
        }
        
        .success-message {
            background: #DCFCE7;
            color: #166534;
            border: 1px solid #BBF7D0;
        }
        
        .error-message {
            background: #FEE2E2;
            color: #991B1B;
            border: 1px solid #FECACA;
        }
        
        .success-message.show,
        .error-message.show {
            display: block;
        }
        
        /* Mobile Responsiveness */
        @media (max-width: 600px) {
            .container {
                margin: 12px;
            }
            
            .content {
                padding: 22px;
            }
            
            .header {
                padding: 24px;
            }
            
            .header h1 {
                font-size: 24px;
            }
            
            .stats {
                grid-template-columns: repeat(2, 1fr);
            }
            
            .table-filters {
                flex-direction: column;
                align-items: stretch;
            }
            
            .filter-group {
                justify-content: space-between;
            }
            
            .bulk-actions {
                flex-direction: column;
                gap: 12px;
            }
            
            .bulk-actions-right {
                width: 100%;
                justify-content: center;
            }
        }
        
        @media (max-width: 480px) {
            .stats {
                grid-template-columns: 1fr;
            }
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <span class="icon">🎓</span>
            <h1>Training Completion Status for the Team</h1>
            <p>Manage and track training certification progress</p>
        </div>
        
        <div class="content">
            <div class="success-message" id="successMessage">Training status updated successfully!</div>
            <div class="error-message" id="errorMessage">Failed to update training status. Please try again.</div>
            
            <div class="controls">
                <div class="sync-status">
                    <span id="syncStatus">Ready to sync users from Okta</span>
                </div>
                <button class="sync-button" id="syncButton" onclick="syncOktaUsers()">
                    🔄 Sync Users from Okta
                </button>
            </div>
            
            
            <div class="stats">
                <div class="stat-card completed">
                    <div class="stat-number" id="completedCount">${users.filter((u) => u.training_status === 'completed').length}</div>
                    <div class="stat-label">Completed</div>
                </div>
                <div class="stat-card started">
                    <div class="stat-number" id="startedCount">${users.filter((u) => u.training_status === 'started').length}</div>
                    <div class="stat-label">In Progress</div>
                </div>
                <div class="stat-card not-started">
                    <div class="stat-number" id="notStartedCount">${users.filter((u) => u.training_status === 'not started').length}</div>
                    <div class="stat-label">Not Started</div>
                </div>
                <div class="stat-card total">
                    <div class="stat-number" id="totalCount">${users.length}</div>
                    <div class="stat-label">Total Users</div>
                </div>
            </div>
                    <div class="table-filters">
                <div class="filter-group">
                    <label for="statusFilter" class="filter-label">Filter by Status:</label>
                    <select id="statusFilter" class="filter-select">
                        <option value="">All Status</option>
                        <option value="completed">Completed</option>
                        <option value="started">In Progress</option>
                        <option value="not started">Not Started</option>
                    </select>
                </div>
                <div class="filter-group">
                    <label for="searchFilter" class="filter-label">Search:</label>
                    <input type="text" id="searchFilter" class="filter-input" placeholder="Search by name or email...">
                </div>
                <div class="filter-actions">
                    <label class="filter-label" style="visibility: hidden;">Actions:</label>
                    <button type="button" class="filter-clear" onclick="clearFilters()">Clear Filters</button>
                </div>
            </div>
            
            <div class="bulk-actions" id="bulkActionsToolbar">
                <div class="bulk-actions-left">
                    <span class="bulk-selection-count" id="bulkSelectionCount">0 users selected</span>
                </div>
                <div class="bulk-actions-right">
                    <select id="bulkStatusSelect" class="bulk-action-btn" style="background: var(--color-neutral-600); color: var(--color-neutral-50);">
                        <option value="">Change Status To...</option>
                        <option value="completed">Mark as Completed</option>
                        <option value="started">Mark as In Progress</option>
                        <option value="not started">Mark as Not Started</option>
                    </select>
                    <button type="button" class="bulk-action-btn" id="applyBulkAction" onclick="applyBulkStatusUpdate()">Apply</button>
                    <button type="button" class="bulk-action-btn bulk-cancel" onclick="clearSelection()">Cancel</button>
                </div>
            </div>
            
            <div class="table-container">
                <table id="usersTable">
                    <thead>
                        <tr>
                            <th class="checkbox-cell">
                                <input type="checkbox" class="select-all-checkbox" id="selectAllCheckbox" onchange="toggleAllSelection(this)">
                            </th>
                            <th class="sortable" data-column="first_name">First Name</th>
                            <th class="sortable" data-column="primary_email">Primary Email</th>
                            <th class="sortable" data-column="training_status">Training Status</th>
                            <th>Access Status</th>
                            <th class="sortable" data-column="updated_at">Last Updated</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${users
                          .map(
                            (user) => `
                            <tr data-user-id="${user.id}" data-user-email="${user.primary_email}">
                                <td class="checkbox-cell">
                                    <input type="checkbox" class="user-checkbox" value="${user.primary_email}" onchange="updateSelection()">
                                </td>
                                <td class="username">${user.first_name || '-'}</td>
                                <td class="email">${user.primary_email || '-'}</td>
                                <td>
                                    <select class="status-select status-${user.training_status.replace(' ', '-')}" 
                                            onchange="updateTrainingStatus('${user.primary_email}', this.value, this)" 
                                            data-original-value="${user.training_status}">
                                        <option value="not started" ${user.training_status === 'not started' ? 'selected' : ''}>Not Started</option>
                                        <option value="started" ${user.training_status === 'started' ? 'selected' : ''}>In Progress</option>
                                        <option value="completed" ${user.training_status === 'completed' ? 'selected' : ''}>Completed</option>
                                    </select>
                                </td>
                                <td>
                                    <span class="access-indicator ${user.training_status === 'completed' ? 'access-granted' : 'access-denied'}">
                                        ${user.training_status === 'completed' ? '✅ Access Granted' : '❌ Access Denied'}
                                    </span>
                                </td>
                                <td class="timestamp">${new Date(user.updated_at).toLocaleString()}</td>
                            </tr>
                        `,
                          )
                          .join('')}
                    </tbody>
                    </table>
                </div>
        </div>
    </div>

    <script nonce="${scriptNonce}">
        async function updateTrainingStatus(email, newStatus, selectElement) {
            const originalValue = selectElement.getAttribute('data-original-value');
            
            if (newStatus === originalValue) {
                return; // No change
            }
            
            // Add loading state
            selectElement.classList.add('loading');
            
            try {
                const response = await fetch('/api/update-training', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        email: email,
                        status: newStatus
                    })
                });
                
                const result = await response.json();
                
                if (result.success) {
                    // Update the select styling
                    selectElement.className = 'status-select status-' + newStatus.replace(' ', '-');
                    selectElement.setAttribute('data-original-value', newStatus);
                    
                    // Update timestamp
                    const row = selectElement.closest('tr');
                    const timestampCell = row.querySelector('.timestamp');
                    timestampCell.textContent = new Date().toLocaleString();
                    
                    // Update access status
                    const accessCell = row.querySelector('.access-indicator');
                    if (newStatus === 'completed') {
                        accessCell.className = 'access-indicator access-granted';
                        accessCell.textContent = '✅ Access Granted';
                    } else {
                        accessCell.className = 'access-indicator access-denied';
                        accessCell.textContent = '❌ Access Denied';
                    }
                    
                    // Update stats
                    updateStats();
                    
                    // Show success message
                    showMessage('success', 'Training status updated successfully!');
                } else {
                    // Revert selection
                    selectElement.value = originalValue;
                    showMessage('error', result.message || 'Failed to update training status');
                }
            } catch (error) {
                console.error('Error updating training status:', error);
                // Revert selection
                selectElement.value = originalValue;
                showMessage('error', 'Network error. Please try again.');
            } finally {
                selectElement.classList.remove('loading');
            }
        }
        
        function updateStats() {
            const selects = document.querySelectorAll('.status-select');
            let completed = 0, started = 0, notStarted = 0;
            
            selects.forEach(select => {
                const status = select.value;
                if (status === 'completed') completed++;
                else if (status === 'started') started++;
                else if (status === 'not started') notStarted++;
            });
            
            document.getElementById('completedCount').textContent = completed;
            document.getElementById('startedCount').textContent = started;
            document.getElementById('notStartedCount').textContent = notStarted;
        }
        
        async function syncOktaUsers() {
            const syncButton = document.getElementById('syncButton');
            const syncStatus = document.getElementById('syncStatus');
            
            // Disable button and show loading state
            syncButton.disabled = true;
            syncButton.classList.add('loading');
            syncButton.innerHTML = '<span class="spinner"></span>Syncing...';
            syncStatus.textContent = 'Syncing users from Okta...';
            
            try {
                const response = await fetch('/api/okta/sync', {
                    method: 'POST'
                });
                
                const result = await response.json();
                
                if (result.success) {
                    syncStatus.textContent = \`Sync completed: Added \${result.results.added}, Updated \${result.results.updated}, Skipped \${result.results.skipped}\`;
                    showMessage('success', result.message);
                    
                    // Refresh the page to show new users
                    setTimeout(() => {
                        window.location.reload();
                    }, 2000);
                } else {
                    syncStatus.textContent = 'Sync failed';
                    showMessage('error', result.message || 'Failed to sync users from Okta');
                }
            } catch (error) {
                console.error('Sync error:', error);
                syncStatus.textContent = 'Sync failed';
                showMessage('error', 'Network error during sync. Please try again.');
            } finally {
                // Re-enable button
                syncButton.disabled = false;
                syncButton.classList.remove('loading');
                syncButton.innerHTML = '🔄 Sync Users from Okta';
                
                // Reset status after delay
                setTimeout(() => {
                    syncStatus.textContent = 'Ready to sync users from Okta';
                }, 5000);
            }
        }
        
        function showMessage(type, message) {
            const successMsg = document.getElementById('successMessage');
            const errorMsg = document.getElementById('errorMessage');
            
            // Hide both messages first
            successMsg.style.display = 'none';
            errorMsg.style.display = 'none';
            
            if (type === 'success') {
                successMsg.textContent = message;
                successMsg.style.display = 'block';
                setTimeout(() => successMsg.style.display = 'none', 3000);
            } else {
                errorMsg.textContent = message;
                errorMsg.style.display = 'block';
                setTimeout(() => errorMsg.style.display = 'none', 5000);
            }
        }
        
        // Table sorting functionality
        let currentSort = { column: null, direction: 'asc' };
        
        function initializeSorting() {
            const sortableHeaders = document.querySelectorAll('th.sortable');
            sortableHeaders.forEach(header => {
                header.addEventListener('click', () => {
                    const column = header.getAttribute('data-column');
                    sortTable(column, header);
                });
            });
        }
        
        function sortTable(column, headerElement) {
            const table = document.getElementById('usersTable');
            const tbody = table.querySelector('tbody');
            const rows = Array.from(tbody.querySelectorAll('tr'));
            
            // Determine sort direction
            let direction = 'asc';
            if (currentSort.column === column && currentSort.direction === 'asc') {
                direction = 'desc';
            }
            
            // Update header classes
            document.querySelectorAll('th.sortable').forEach(th => {
                th.classList.remove('asc', 'desc');
            });
            headerElement.classList.add(direction);
            
            // Sort rows
            rows.sort((a, b) => {
                let aValue = getCellValue(a, column);
                let bValue = getCellValue(b, column);
                
                // Handle different data types
                if (column === 'updated_at') {
                    aValue = new Date(aValue);
                    bValue = new Date(bValue);
                } else if (column === 'training_status') {
                    // Custom sort order for training status
                    const statusOrder = { 'completed': 3, 'started': 2, 'not started': 1 };
                    aValue = statusOrder[aValue] || 0;
                    bValue = statusOrder[bValue] || 0;
                } else {
                    aValue = aValue.toLowerCase();
                    bValue = bValue.toLowerCase();
                }
                
                if (direction === 'asc') {
                    return aValue > bValue ? 1 : -1;
                } else {
                    return aValue < bValue ? 1 : -1;
                }
            });
            
            // Re-append sorted rows
            rows.forEach(row => tbody.appendChild(row));
            
            // Update current sort state
            currentSort = { column, direction };
        }
        
        function getCellValue(row, column) {
            switch (column) {
                case 'first_name':
                    return row.querySelector('.username').textContent.trim();
                case 'primary_email':
                    return row.querySelector('.email').textContent.trim();
                case 'training_status':
                    return row.querySelector('.status-select').value;
                case 'updated_at':
                    return row.querySelector('.timestamp').textContent.trim();
                default:
                    return '';
            }
        }
        
        // Table filtering functionality
        function initializeFiltering() {
            const statusFilter = document.getElementById('statusFilter');
            const searchFilter = document.getElementById('searchFilter');
            
            statusFilter.addEventListener('change', applyFilters);
            searchFilter.addEventListener('input', debounce(applyFilters, 300));
        }
        
        function applyFilters() {
            const statusFilter = document.getElementById('statusFilter').value;
            const searchFilter = document.getElementById('searchFilter').value.toLowerCase();
            const rows = document.querySelectorAll('#usersTable tbody tr');
            
            let visibleCount = 0;
            
            rows.forEach(row => {
                const status = row.querySelector('.status-select').value;
                const name = row.querySelector('.username').textContent.toLowerCase();
                const email = row.querySelector('.email').textContent.toLowerCase();
                
                const statusMatch = !statusFilter || status === statusFilter;
                const searchMatch = !searchFilter || 
                    name.includes(searchFilter) || 
                    email.includes(searchFilter);
                
                if (statusMatch && searchMatch) {
                    row.style.display = '';
                    visibleCount++;
                } else {
                    row.style.display = 'none';
                }
            });
            
            // Update visible count indicator
            updateFilteredCount(visibleCount, rows.length);
        }
        
        function clearFilters() {
            document.getElementById('statusFilter').value = '';
            document.getElementById('searchFilter').value = '';
            applyFilters();
        }
        
        function updateFilteredCount(visible, total) {
            // Find or create the filter count indicator
            let countIndicator = document.querySelector('.filter-count');
            if (!countIndicator) {
                countIndicator = document.createElement('div');
                countIndicator.className = 'filter-count';
                document.querySelector('.table-filters').appendChild(countIndicator);
            }
            
            if (visible === total) {
                countIndicator.style.display = 'none';
            } else {
                countIndicator.style.display = 'block';
                countIndicator.textContent = 'Showing ' + visible + ' of ' + total + ' users';
            }
        }
        
        function debounce(func, wait) {
            let timeout;
            return function executedFunction(...args) {
                const later = () => {
                    clearTimeout(timeout);
                    func(...args);
                };
                clearTimeout(timeout);
                timeout = setTimeout(later, wait);
            };
        }
        
        // Bulk actions functionality
        let selectedUsers = [];
        
        function updateSelection() {
            const checkboxes = document.querySelectorAll('.user-checkbox');
            selectedUsers = Array.from(checkboxes)
                .filter(cb => cb.checked)
                .map(cb => cb.value);
            
            updateBulkActionsUI();
        }
        
        function toggleAllSelection(selectAllCheckbox) {
            const checkboxes = document.querySelectorAll('.user-checkbox:not([style*="display: none"]) .user-checkbox, .user-checkbox');
            const visibleCheckboxes = Array.from(checkboxes).filter(cb => {
                const row = cb.closest('tr');
                return row && row.style.display !== 'none';
            });
            
            visibleCheckboxes.forEach(checkbox => {
                checkbox.checked = selectAllCheckbox.checked;
                const row = checkbox.closest('tr');
                if (checkbox.checked) {
                    row.classList.add('selected');
                } else {
                    row.classList.remove('selected');
                }
            });
            
            updateSelection();
        }
        
        function updateBulkActionsUI() {
            const toolbar = document.getElementById('bulkActionsToolbar');
            const countDisplay = document.getElementById('bulkSelectionCount');
            const selectAllCheckbox = document.getElementById('selectAllCheckbox');
            
            if (selectedUsers.length > 0) {
                toolbar.classList.add('active');
                countDisplay.textContent = selectedUsers.length + ' user' + (selectedUsers.length !== 1 ? 's' : '') + ' selected';
                
                // Update row highlighting
                document.querySelectorAll('.user-checkbox').forEach(checkbox => {
                    const row = checkbox.closest('tr');
                    if (checkbox.checked) {
                        row.classList.add('selected');
                    } else {
                        row.classList.remove('selected');
                    }
                });
            } else {
                toolbar.classList.remove('active');
                selectAllCheckbox.checked = false;
                document.querySelectorAll('tr.selected').forEach(row => {
                    row.classList.remove('selected');
                });
            }
            
            // Update select all checkbox state
            const visibleCheckboxes = Array.from(document.querySelectorAll('.user-checkbox')).filter(cb => {
                const row = cb.closest('tr');
                return row && row.style.display !== 'none';
            });
            const checkedVisibleCheckboxes = visibleCheckboxes.filter(cb => cb.checked);
            
            if (checkedVisibleCheckboxes.length === 0) {
                selectAllCheckbox.indeterminate = false;
                selectAllCheckbox.checked = false;
            } else if (checkedVisibleCheckboxes.length === visibleCheckboxes.length) {
                selectAllCheckbox.indeterminate = false;
                selectAllCheckbox.checked = true;
            } else {
                selectAllCheckbox.indeterminate = true;
                selectAllCheckbox.checked = false;
            }
        }
        
        function clearSelection() {
            document.querySelectorAll('.user-checkbox').forEach(checkbox => {
                checkbox.checked = false;
            });
            document.getElementById('bulkStatusSelect').value = '';
            updateSelection();
        }
        
        async function applyBulkStatusUpdate() {
            const newStatus = document.getElementById('bulkStatusSelect').value;
            if (!newStatus || selectedUsers.length === 0) {
                showError('Please select a status and at least one user.');
                return;
            }
            
            const applyButton = document.getElementById('applyBulkAction');
            const originalText = applyButton.textContent;
            applyButton.disabled = true;
            applyButton.textContent = 'Updating...';
            
            try {
                // Update each user's status
                const updatePromises = selectedUsers.map(async (email) => {
                    const response = await fetch('/api/update-training', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                        },
                        body: JSON.stringify({
                            email: email,
                            status: newStatus
                        })
                    });
                    return { email, response: await response.json() };
                });
                
                const results = await Promise.all(updatePromises);
                const successful = results.filter(r => r.response.success);
                const failed = results.filter(r => !r.response.success);
                
                if (successful.length > 0) {
                    // Update the UI for successful updates
                    successful.forEach(result => {
                        const row = document.querySelector('tr[data-user-email="' + result.email + '"]');
                        if (row) {
                            const select = row.querySelector('.status-select');
                            const accessIndicator = row.querySelector('.access-indicator');
                            
                            select.value = newStatus;
                            select.className = 'status-select status-' + newStatus.replace(' ', '-');
                            select.setAttribute('data-original-value', newStatus);
                            
                            // Update access indicator
                            if (newStatus === 'completed') {
                                accessIndicator.className = 'access-indicator access-granted';
                                accessIndicator.textContent = '✅ Access Granted';
                            } else {
                                accessIndicator.className = 'access-indicator access-denied';
                                accessIndicator.textContent = '❌ Access Denied';
                            }
                        }
                    });
                    
                    // Update statistics
                    updateStatistics();
                    
                    showSuccess('Successfully updated ' + successful.length + ' user' + (successful.length !== 1 ? 's' : '') + ' to "' + newStatus + '".');
                }
                
                if (failed.length > 0) {
                    showError('Failed to update ' + failed.length + ' user' + (failed.length !== 1 ? 's' : '') + '. Please try again.');
                }
                
                // Clear selection after bulk update
                clearSelection();
                
            } catch (error) {
                console.error('Bulk update error:', error);
                showError('Bulk update failed. Please try again.');
            } finally {
                applyButton.disabled = false;
                applyButton.textContent = originalText;
            }
        }
        
        function updateStatistics() {
            const rows = document.querySelectorAll('#usersTable tbody tr');
            let completed = 0, started = 0, notStarted = 0;
            
            rows.forEach(row => {
                const status = row.querySelector('.status-select').value;
                if (status === 'completed') completed++;
                else if (status === 'started') started++;
                else if (status === 'not started') notStarted++;
            });
            
            document.getElementById('completedCount').textContent = completed;
            document.getElementById('startedCount').textContent = started;
            document.getElementById('notStartedCount').textContent = notStarted;
        }
        
        // Initialize sorting and filtering when page loads
        document.addEventListener('DOMContentLoaded', () => {
            initializeSorting();
            initializeFiltering();
        });
    </script>
</body>
</html>
  `

  const response = new Response(html, {
    headers: { 'content-type': 'text/html' },
  })

  // Add CSP headers with nonces
  return addCSPHeaders(response, env, scriptNonce, styleNonce)
}

/**
 * Handle API request to update training status
 * @param {*} env - Environment bindings
 * @param {Request} request - HTTP request
 * @returns {Response} JSON response
 */
export async function handleUpdateTraining(env, request) {
  try {
    const body = await request.json()
    const { email, status } = body

    // Create secure headers for JSON responses
    const secureHeaders = {
      'content-type': 'application/json',
      ...createCSPHeaders(env),
    }

    if (!email || !status) {
      return new Response(
        JSON.stringify({
          success: false,
          message: 'Email and status are required',
        }),
        {
          status: 400,
          headers: secureHeaders,
        },
      )
    }

    if (!['not started', 'started', 'completed'].includes(status)) {
      return new Response(
        JSON.stringify({
          success: false,
          message: 'Invalid status value',
        }),
        {
          status: 400,
          headers: secureHeaders,
        },
      )
    }

    const updated = await updateUserTrainingStatusByEmail(env, email, status)

    if (updated) {
      return new Response(
        JSON.stringify({
          success: true,
          message: 'Training status updated successfully',
        }),
        {
          headers: secureHeaders,
        },
      )
    } else {
      return new Response(
        JSON.stringify({
          success: false,
          message: 'User not found or update failed',
        }),
        {
          status: 404,
          headers: secureHeaders,
        },
      )
    }
  } catch (error) {
    console.error('Update training error:', error)
    return new Response(
      JSON.stringify({
        success: false,
        message: 'Internal server error',
      }),
      {
        status: 500,
        headers: {
          'content-type': 'application/json',
          ...createCSPHeaders(env),
        },
      },
    )
  }
}

/**
 * Handle GET request for the system overview (root path)
 * @param {*} env - Environment bindings
 * @returns {Response} HTML response showing system details
 */
export async function handleSystemOverview(env) {
  // Generate nonces for inline scripts and styles
  const styleNonce = generateNonce()

  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Training Compliance Gateway</title>
    <style nonce="${styleNonce}">
        /* Professional Design System - Gateway Style */
        :root {
            --accent: #F38020;         /* Cloudflare Orange */
            --cta: #2563EB;            /* Blue CTA */
            --cta-hover: #1E40AF;
            --surface: #ffffff;        /* Card & modal surface */
            --muted: #6B7280;          /* Muted text */
            --border: #E5E7EB;         /* Subtle borders */
            --panel: #F8FAFC;          /* Light panels inside card */
            --shadow: 0 12px 30px rgba(2,6,23,.18);
            --radius: 16px;
            --text-primary: #111827;
            --text-secondary: #374151;
        }
        
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
            background: radial-gradient(1200px 800px at 50% -10%, #111827 0%, #0f172a 60%);
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            color: var(--text-primary);
            line-height: 1.6;
            -webkit-font-smoothing: antialiased;
            -moz-osx-font-smoothing: grayscale;
            padding: 24px;
        }
        
        .container {
            background: var(--surface);
            border-radius: var(--radius);
            box-shadow: var(--shadow);
            max-width: 580px;
            width: 100%;
            margin: 0;
            overflow: hidden;
        }
        
        .header {
            background: var(--accent);
            color: #fff;
            padding: 28px 28px 24px;
            text-align: center;
        }
        
        .header .icon {
            font-size: 48px;
            display: block;
            margin-bottom: 16px;
            line-height: 1;
        }
        
        .header h1 {
            font-size: 28px;
            font-weight: 700;
            letter-spacing: 0.2px;
            margin-bottom: 8px;
        }
        
        .header p {
            font-size: 15px;
            opacity: 0.95;
            line-height: 1.5;
        }
        
        .content {
            padding: 28px;
        }
        
        .system-status {
            display: flex;
            align-items: center;
            gap: 12px;
            margin-bottom: 24px;
            padding: 12px 16px;
            background: #F0FDF4;
            border: 1px solid #BBF7D0;
            border-radius: 8px;
        }
        
        .status-indicator {
            width: 12px;
            height: 12px;
            border-radius: 50%;
            background: #16A34A;
            box-shadow: 0 0 0 3px rgba(22, 163, 74, 0.2);
            animation: pulse 2s infinite;
        }
        
        @keyframes pulse {
            0%, 100% { opacity: 1; }
            50% { opacity: 0.7; }
        }
        
        .status-text {
            color: #166534;
            font-weight: 600;
            font-size: 16px;
        }
        
        .endpoints-section {
            margin-bottom: 24px;
        }
        
        .endpoints-section h3 {
            color: var(--text-primary);
            font-size: 18px;
            font-weight: 600;
            margin-bottom: 16px;
        }
        
        .endpoints-grid {
            display: grid;
            gap: 12px;
        }
        
        .endpoint-card {
            display: flex;
            align-items: center;
            gap: 16px;
            padding: 12px 16px;
            background: var(--panel);
            border: 1px solid var(--border);
            border-radius: 8px;
            font-family: 'SF Mono', Monaco, 'Cascadia Code', monospace;
            font-size: 14px;
        }
        
        .endpoint-method {
            font-weight: 700;
            font-size: 12px;
            padding: 4px 8px;
            border-radius: 4px;
            text-align: center;
            min-width: 48px;
        }
        
        .endpoint-method.get {
            background: #DBEAFE;
            color: #1E40AF;
        }
        
        .endpoint-method.post {
            background: #FEE2E2;
            color: #DC2626;
        }
        
        .endpoint-path {
            font-weight: 600;
            color: var(--text-primary);
            min-width: 80px;
        }
        
        .endpoint-desc {
            color: var(--text-secondary);
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
            font-size: 14px;
        }
        
        .system-notice {
            display: flex;
            gap: 12px;
            padding: 16px;
            background: #FEF3C7;
            border: 1px solid #FDE68A;
            border-radius: 8px;
            margin-bottom: 24px;
        }
        
        .notice-icon {
            font-size: 20px;
            flex-shrink: 0;
        }
        
        .notice-content {
            color: #92400E;
            font-size: 14px;
            line-height: 1.5;
        }
        
        .notice-content strong {
            font-weight: 600;
        }
        
        .powered-by {
            text-align: center;
            padding: 16px 0;
            border-top: 1px solid var(--border);
            margin-top: 8px;
        }
        
        .powered-by span {
            color: var(--text-secondary);
            font-size: 14px;
            font-weight: 500;
        }
        
        @media (max-width: 600px) {
            .container {
                margin: 12px;
            }
            
            .content {
                padding: 22px;
            }
            
            .header {
                padding: 24px;
            }
            
            .header h1 {
                font-size: 24px;
            }
            
            .endpoint-card {
                flex-direction: column;
                align-items: flex-start;
                gap: 8px;
            }
            
            .endpoint-method {
                align-self: flex-start;
            }
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <span class="icon">🛡️</span>
            <h1>Training Compliance Gateway</h1>
            <p>This is a Cloudflare Access External Evaluation Worker that enforces training completion requirements for Zero Trust Security.</p>
        </div>
        
        <div class="content">
            <div class="system-status">
                <span class="status-indicator"></span>
                <span class="status-text">Worker is running and ready to process access requests</span>
            </div>
            
            <div class="endpoints-section">
                <h3>Available Endpoints:</h3>
                <div class="endpoints-grid">
                    <div class="endpoint-card">
                        <div class="endpoint-method get">GET</div>
                        <div class="endpoint-path">/keys</div>
                        <div class="endpoint-desc">Public key endpoint for Cloudflare Access</div>
                    </div>
                    <div class="endpoint-card">
                        <div class="endpoint-method post">POST</div>
                        <div class="endpoint-path">/</div>
                        <div class="endpoint-desc">External evaluation endpoint (used by Access)</div>
                    </div>
                    <div class="endpoint-card">
                        <div class="endpoint-method get">GET</div>
                        <div class="endpoint-path">/admin</div>
                        <div class="endpoint-desc">Training management dashboard (Access protected)</div>
                    </div>
                </div>
            </div>
            
            <div class="system-notice">
                <div class="notice-icon">⚠️</div>
                <div class="notice-content">
                    <strong>Note:</strong> This endpoint is designed to receive POST requests with JWT tokens from Cloudflare Access. Direct browser access shows this informational page instead of the JSON parsing error.
                </div>
            </div>
            
            <div class="powered-by">
                <span>Powered by Cloudflare Workers</span>
            </div>
        </div>
    </div>
</body>
</html>
  `

  const response = new Response(html, {
    headers: { 'content-type': 'text/html' },
  })

  // Add CSP headers with nonces
  return addCSPHeaders(response, env, null, styleNonce)
}
