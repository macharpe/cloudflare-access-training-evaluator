/**
 * Admin authentication utilities
 */

/**
 * Create an unauthorized response
 * @returns {Response} 401 Unauthorized response
 */
export function createUnauthorizedResponse() {
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
 * @returns {Response} 401 Unauthorized HTML response
 */
export function createUnauthorizedHtmlResponse() {
  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>Access Denied - Training Admin</title>
  <style>
    /* Reset */
    * { margin:0; padding:0; box-sizing:border-box; }

    /* Professional Design System - Gateway Style */
    :root{
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

    body{
      font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Oxygen,Ubuntu,Cantarell,sans-serif;
      background: radial-gradient(1200px 800px at 50% -10%, #111827 0%, #0f172a 60%);
      min-height:100vh;
      display:flex;
      align-items:center;
      justify-content:center;
      color: var(--text-primary);
      line-height:1.6;
      -webkit-font-smoothing:antialiased;
      -moz-osx-font-smoothing:grayscale;
      padding: 24px;
    }

    .container{
      background:var(--surface);
      border-radius:var(--radius);
      box-shadow:var(--shadow);
      max-width:720px;
      width:100%;
      margin:0;
      overflow:hidden;
    }

    .header{
      background:var(--accent);
      color:#fff;
      padding:28px 28px 24px;
      text-align:center;
    }
    
    .header .icon{
      font-size:40px;
      display:block;
      margin-bottom:12px;
      line-height:1;
    }
    
    .header h1{
      font-size:28px;
      font-weight:700;
      letter-spacing:.2px;
      margin-bottom:6px;
    }
    
    .header p{
      font-size:14px;
      opacity:.95;
    }

    .content{ 
      padding:28px; 
    }

    .auth-info{
      background:var(--panel);
      border:1px solid var(--border);
      border-radius:12px;
      padding:16px 18px;
      margin-bottom: 18px;
    }
    
    .auth-title{
      font-weight:700;
      font-size:16px;
      color: var(--text-primary);
      margin-bottom:6px;
    }
    
    .auth-info p{
      font-size:14px;
      color: var(--text-secondary);
      margin-bottom: 10px;
    }
    
    .admin-access{
      margin:18px 0 0;
      padding:14px 16px;
      background: #EFF6FF;
      border:1px solid #DBEAFE;
      border-radius:10px;
      font-size:14px;
      color: var(--text-primary);
    }
    
    .admin-access strong{
      font-weight:600;
      font-size:14px;
    }

    .info-boxes {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
      gap: 16px;
      margin-top: 18px;
    }
    
    .info-box {
      background: var(--panel);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 18px;
    }
    
    .info-box-title {
      font-weight: 600;
      color: var(--text-primary);
      font-size: 14px;
      margin-bottom: 8px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    
    .info-box-content {
      font-size: 14px;
      color: var(--text-secondary);
      line-height: 1.5;
    }

    @media (max-width:600px){
      .container{ margin:12px; }
      .content{ padding:22px; }
      .header{ padding:24px; }
      .header h1{ font-size:24px; }
      .info-boxes {
        grid-template-columns: 1fr;
      }
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <span class="icon">🔒</span>
      <h1>Access Denied</h1>
      <p>Training Admin Authentication Required</p>
    </div>

    <div class="content">
      <div class="auth-info">
        <div class="auth-title">Cloudflare Access Authentication Required</div>
        <p>This admin interface is protected by Cloudflare Access authentication. Please ensure you are logged in through your SSO provider to access the training management system.</p>
        
        <div class="admin-access">
          <strong>Admin Interface:</strong> Once authenticated, access the full training dashboard at <code style="background: #F3F4F6; padding: 2px 6px; border-radius: 4px; font-family: monospace;">/admin</code>
        </div>
      </div>
    </div>
  </div>
</body>
</html>
  `

  return new Response(html, {
    status: 401,
    headers: { 'content-type': 'text/html' },
  })
}
