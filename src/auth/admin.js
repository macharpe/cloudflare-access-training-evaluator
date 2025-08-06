/**
 * Admin authentication utilities
 */

/**
 * Check if the request is authenticated for admin access
 * @param {Request} request - HTTP request
 * @param {*} env - Environment bindings
 * @returns {boolean} Whether the request is authenticated
 */
export function isAdminAuthenticated(request, env) {
  if (!env.ADMIN_API_KEY) {
    console.warn(
      'ADMIN_API_KEY not configured - admin endpoints are unprotected!',
    )
    return true // Allow access if no key is configured (for development)
  }

  const url = new URL(request.url)
  const queryKey = url.searchParams.get('key')
  const authHeader = request.headers.get('Authorization')

  // Check query parameter: ?key=your-secret-key
  if (queryKey && queryKey === env.ADMIN_API_KEY) {
    return true
  }

  // Check Authorization header: Bearer your-secret-key
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.substring(7)
    if (token === env.ADMIN_API_KEY) {
      return true
    }
  }

  return false
}

/**
 * Create an unauthorized response
 * @returns {Response} 401 Unauthorized response
 */
export function createUnauthorizedResponse() {
  return new Response(
    JSON.stringify({
      error: 'Unauthorized',
      message:
        'Admin access required. Provide API key via ?key=your-key or Authorization: Bearer your-key header.',
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
        <p>This admin interface requires authentication. Please provide your API key.</p>
        
        <div class="code">
            Access via: /admin?key=your-secret-key
        </div>
        
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
