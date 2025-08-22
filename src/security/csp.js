/**
 * Content Security Policy (CSP) implementation
 * Protects against XSS, injection attacks, and other security vulnerabilities
 */

/**
 * Generate a cryptographically secure nonce for inline scripts/styles
 * @returns {string} Base64-encoded nonce
 */
export function generateNonce() {
  const array = new Uint8Array(16)
  crypto.getRandomValues(array)
  return btoa(String.fromCharCode(...array))
}

/**
 * CSP Configuration
 * Defines security policies for different content types
 */
export const CSP_CONFIG = {
  // Strict policy for production - blocks all inline content unless nonce is used
  strict: {
    'default-src': ["'self'"],
    'script-src': ["'self'"],
    'style-src': ["'self'"],
    'img-src': ["'self'", 'data:', 'https:'],
    'font-src': ["'self'", 'https:', 'data:'],
    'connect-src': ["'self'"],
    'form-action': ["'self'"],
    'frame-ancestors': ["'none'"],
    'base-uri': ["'self'"],
    'object-src': ["'none'"],
    'media-src': ["'self'"],
    'manifest-src': ["'self'"],
    'worker-src': ["'self'"],
    'upgrade-insecure-requests': true,
    'block-all-mixed-content': true,
  },

  // Development policy - more permissive for easier development
  development: {
    'default-src': ["'self'"],
    'script-src': ["'self'", "'unsafe-inline'"],
    'style-src': ["'self'", "'unsafe-inline'"],
    'img-src': ["'self'", 'data:', 'https:'],
    'font-src': ["'self'", 'https:', 'data:'],
    'connect-src': ["'self'"],
    'form-action': ["'self'"],
    'frame-ancestors': ["'none'"],
    'base-uri': ["'self'"],
    'object-src': ["'none'"],
  },
}

/**
 * Build CSP header value from configuration
 * @param {Object} config - CSP configuration object
 * @param {string} [scriptNonce] - Nonce for inline scripts
 * @param {string} [styleNonce] - Nonce for inline styles
 * @returns {string} CSP header value
 */
export function buildCSPHeader(config, scriptNonce = null, styleNonce = null) {
  const directives = []

  for (const [directive, values] of Object.entries(config)) {
    if (typeof values === 'boolean') {
      if (values) {
        directives.push(directive)
      }
      continue
    }

    if (!Array.isArray(values)) {
      continue
    }

    let directiveValues = [...values]

    // Add nonces for script and style sources
    if (directive === 'script-src' && scriptNonce) {
      directiveValues.push(`'nonce-${scriptNonce}'`)
    }
    if (directive === 'style-src' && styleNonce) {
      directiveValues.push(`'nonce-${styleNonce}'`)
    }

    directives.push(`${directive} ${directiveValues.join(' ')}`)
  }

  return directives.join('; ')
}

/**
 * Get CSP configuration based on environment
 * @param {Object} env - Environment bindings
 * @returns {Object} CSP configuration
 */
export function getCSPConfig(env) {
  // Use strict policy in production, development policy otherwise
  const isDevelopment =
    env.DEBUG === 'true' || env.ENVIRONMENT === 'development'
  return isDevelopment ? CSP_CONFIG.development : CSP_CONFIG.strict
}

/**
 * Create CSP headers for HTTP responses
 * @param {Object} env - Environment bindings
 * @param {string} [scriptNonce] - Nonce for inline scripts
 * @param {string} [styleNonce] - Nonce for inline styles
 * @returns {Object} Headers object with CSP
 */
export function createCSPHeaders(env, scriptNonce = null, styleNonce = null) {
  const config = getCSPConfig(env)
  const cspHeader = buildCSPHeader(config, scriptNonce, styleNonce)

  return {
    'Content-Security-Policy': cspHeader,
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'X-XSS-Protection': '1; mode=block',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'geolocation=(), microphone=(), camera=()',
  }
}

/**
 * Middleware to add CSP headers to HTML responses
 * @param {Response} response - Original response
 * @param {Object} env - Environment bindings
 * @param {string} [scriptNonce] - Nonce for inline scripts
 * @param {string} [styleNonce] - Nonce for inline styles
 * @returns {Response} Response with CSP headers
 */
export function addCSPHeaders(
  response,
  env,
  scriptNonce = null,
  styleNonce = null,
) {
  const headers = new Headers(response.headers)
  const cspHeaders = createCSPHeaders(env, scriptNonce, styleNonce)

  // Add all security headers
  for (const [key, value] of Object.entries(cspHeaders)) {
    headers.set(key, value)
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}

/**
 * Report CSP violations (for future implementation)
 * @param {Object} violation - CSP violation report
 * @param {Object} env - Environment bindings
 */
export function reportCSPViolation(violation, env) {
  // Log the violation for monitoring
  console.warn('CSP Violation:', {
    directive: violation['violated-directive'],
    blockedURI: violation['blocked-uri'],
    sourceFile: violation['source-file'],
    lineNumber: violation['line-number'],
    timestamp: new Date().toISOString(),
  })

  // In production, you might want to send this to a monitoring service
  // such as Cloudflare Analytics or another logging service
}
