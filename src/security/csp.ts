/**
 * Content Security Policy (CSP) implementation
 *
 * Protects against XSS, injection attacks, and other security vulnerabilities.
 */

import type { Env } from '../types';


/**
 * CSP configuration object
 */
interface CSPConfiguration {
  'default-src': string[];
  'script-src': string[];
  'style-src': string[];
  'img-src': string[];
  'font-src': string[];
  'connect-src': string[];
  'form-action': string[];
  'frame-ancestors': string[];
  'base-uri': string[];
  'object-src': string[];
  'media-src'?: string[];
  'manifest-src'?: string[];
  'worker-src'?: string[];
  'upgrade-insecure-requests'?: boolean;
  'block-all-mixed-content'?: boolean;
}

/**
 * Generate a cryptographically secure nonce for inline scripts/styles
 *
 * @returns Base64-encoded nonce
 */
export function generateNonce(): string {
  const array = new Uint8Array(16);
  crypto.getRandomValues(array);
  return btoa(String.fromCharCode(...array));
}

/**
 * CSP Configuration
 *
 * Defines security policies for different content types.
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
  } as CSPConfiguration,

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
  } as CSPConfiguration,
} as const;

/**
 * Build CSP header value from configuration
 *
 * @param config - CSP configuration object
 * @param scriptNonce - Nonce for inline scripts
 * @param styleNonce - Nonce for inline styles
 * @returns CSP header value
 */
export function buildCSPHeader(
  config: CSPConfiguration,
  scriptNonce: string | null = null,
  styleNonce: string | null = null
): string {
  const directives: string[] = [];

  for (const [directive, values] of Object.entries(config)) {
    if (typeof values === 'boolean') {
      if (values) {
        directives.push(directive);
      }
      continue;
    }

    if (!Array.isArray(values)) {
      continue;
    }

    const directiveValues = [...values];

    // Add nonces for script and style sources
    if (directive === 'script-src' && scriptNonce) {
      directiveValues.push(`'nonce-${scriptNonce}'`);
    }
    if (directive === 'style-src' && styleNonce) {
      directiveValues.push(`'nonce-${styleNonce}'`);
    }

    directives.push(`${directive} ${directiveValues.join(' ')}`);
  }

  return directives.join('; ');
}

/**
 * Get CSP configuration based on environment
 *
 * @param env - Environment bindings
 * @returns CSP configuration
 */
export function getCSPConfig(env: Env): CSPConfiguration {
  // Use strict policy in production, development policy otherwise
  const isDevelopment = env.DEBUG === true || (env as { ENVIRONMENT?: string }).ENVIRONMENT === 'development';
  return isDevelopment ? CSP_CONFIG.development : CSP_CONFIG.strict;
}

/**
 * Create CSP headers for HTTP responses
 *
 * @param env - Environment bindings
 * @param scriptNonce - Nonce for inline scripts
 * @param styleNonce - Nonce for inline styles
 * @returns Headers object with CSP
 */
export function createCSPHeaders(
  env: Env,
  scriptNonce: string | null = null,
  styleNonce: string | null = null
): Record<string, string> {
  const config = getCSPConfig(env);
  const cspHeader = buildCSPHeader(config, scriptNonce, styleNonce);

  return {
    'Content-Security-Policy': cspHeader,
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'X-XSS-Protection': '1; mode=block',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'geolocation=(), microphone=(), camera=()',
  };
}

/**
 * Middleware to add CSP headers to HTML responses
 *
 * @param response - Original response
 * @param env - Environment bindings
 * @param scriptNonce - Nonce for inline scripts
 * @param styleNonce - Nonce for inline styles
 * @returns Response with CSP headers
 */
export function addCSPHeaders(
  response: Response,
  env: Env,
  scriptNonce: string | null = null,
  styleNonce: string | null = null
): Response {
  const headers = new Headers(response.headers);
  const cspHeaders = createCSPHeaders(env, scriptNonce, styleNonce);

  // Add all security headers
  for (const [key, value] of Object.entries(cspHeaders)) {
    headers.set(key, value);
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

/**
 * CSP Violation Report
 */
interface CSPViolationReport {
  'violated-directive': string;
  'blocked-uri': string;
  'source-file': string;
  'line-number': number;
}

/**
 * Report CSP violations (for future implementation)
 *
 * @param violation - CSP violation report
 * @param env - Environment bindings
 */
export function reportCSPViolation(violation: CSPViolationReport): void {
  // Log the violation for monitoring
  console.warn('CSP Violation:', {
    directive: violation['violated-directive'],
    blockedURI: violation['blocked-uri'],
    sourceFile: violation['source-file'],
    lineNumber: violation['line-number'],
    timestamp: new Date().toISOString(),
  });

  // In production, you might want to send this to a monitoring service
  // such as Cloudflare Analytics or another logging service
}
