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
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Access Denied - Training Admin</title>
    <style>
        body {
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            background: linear-gradient(135deg, #e3f2fd 0%, #bbdefb 50%, #90caf9 100%);
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            margin: 0;
        }
        .container {
            background: white;
            padding: 40px;
            border-radius: 12px;
            box-shadow: 0 8px 32px rgba(0,0,0,0.1);
            text-align: center;
            max-width: 500px;
        }
        .header {
            color: #1976d2;
            font-size: 3rem;
            margin-bottom: 20px;
        }
        h1 {
            color: #333;
            margin-bottom: 20px;
        }
        p {
            color: #666;
            margin-bottom: 30px;
            line-height: 1.6;
        }
        .code {
            background: #f5f5f5;
            padding: 15px;
            border-radius: 6px;
            font-family: monospace;
            margin: 20px 0;
            border-left: 4px solid #2196f3;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">🔒</div>
        <h1>Access Denied</h1>
        <p>This admin interface is protected by Cloudflare Access authentication. Please ensure you are logged in through your SSO provider.</p>
        
        <p>Contact your administrator if you need access to the training management system.</p>
    </div>
</body>
</html>
  `

  return new Response(html, {
    status: 401,
    headers: { 'content-type': 'text/html' },
  })
}
