/**
 * Cloudflare Access authentication utilities
 */

/**
 * Check if the request is authenticated via Cloudflare Access
 * @param {Request} request - HTTP request
 * @param {*} env - Environment bindings
 * @returns {Promise<Object|null>} Access claims if authenticated, null otherwise
 */
export async function isAccessAuthenticated(request, env) {
  try {
    if (env.DEBUG) {
      // Debug: Log all headers to see what Access is sending
      console.log('=== Access Authentication Debug ===')
      console.log('Request URL:', request.url)
      console.log('Headers:')
      for (const [key, value] of request.headers.entries()) {
        if (
          key.toLowerCase().startsWith('cf-access') ||
          key.toLowerCase().includes('jwt')
        ) {
          console.log('  ', key, ':', value)
        }
      }
    }

    // Look for Cloudflare Access JWT in multiple possible headers
    let accessJwtPayload = request.headers.get('CF-Access-Jwt-Payload')
    let accessJwt = request.headers.get('CF-Access-Jwt')
    let accessJwtAssertion = request.headers.get('cf-access-jwt-assertion')
    let accessUserEmail = request.headers.get(
      'cf-access-authenticated-user-email',
    )

    if (env.DEBUG) {
      console.log(
        'CF-Access-Jwt-Payload:',
        accessJwtPayload ? 'present' : 'missing',
      )
      console.log('CF-Access-Jwt:', accessJwt ? 'present' : 'missing')
      console.log(
        'cf-access-jwt-assertion:',
        accessJwtAssertion ? 'present' : 'missing',
      )
      console.log(
        'cf-access-authenticated-user-email:',
        accessUserEmail ? 'present' : 'missing',
      )
    }

    if (!accessJwtPayload && !accessJwt && !accessJwtAssertion) {
      console.log('No Cloudflare Access JWT headers found')
      return null
    }

    let claims

    if (accessJwtPayload) {
      // Decode the base64-encoded payload
      if (env.DEBUG) console.log('Using CF-Access-Jwt-Payload header')
      const payloadJson = atob(accessJwtPayload)
      claims = JSON.parse(payloadJson)
    } else if (accessJwt) {
      // Parse the full JWT token
      if (env.DEBUG) console.log('Using CF-Access-Jwt header - parsing JWT')
      const parts = accessJwt.split('.')
      if (parts.length !== 3) {
        if (env.DEBUG) console.log('Invalid JWT format')
        return null
      }
      const payloadJson = atob(parts[1])
      claims = JSON.parse(payloadJson)
    } else if (accessJwtAssertion) {
      // Parse the cf-access-jwt-assertion header (the actual header being sent)
      if (env.DEBUG)
        console.log('Using cf-access-jwt-assertion header - parsing JWT')
      const parts = accessJwtAssertion.split('.')
      if (parts.length !== 3) {
        if (env.DEBUG) console.log('Invalid JWT assertion format')
        return null
      }
      const payloadJson = atob(parts[1])
      claims = JSON.parse(payloadJson)
    }

    if (env.DEBUG)
      console.log('Parsed claims:', JSON.stringify(claims, null, 2))

    // Verify this is a valid Access token by checking required fields
    if (!claims.email || !claims.aud || !claims.iss) {
      if (env.DEBUG) {
        console.log('Invalid Access JWT payload - missing required fields')
        console.log('Has email:', !!claims.email)
        console.log('Has aud:', !!claims.aud)
        console.log('Has iss:', !!claims.iss)
      }
      return null
    }

    // Additional verification: ensure the audience matches our Access application
    const expectedAudience = env.ACCESS_APP_AUD
    if (!expectedAudience) {
      console.log('ACCESS_APP_AUD secret not configured')
      return null
    }

    // Check if the audience matches (can be string or array)
    const audMatch = Array.isArray(claims.aud)
      ? claims.aud.includes(expectedAudience)
      : claims.aud === expectedAudience

    if (!audMatch) {
      console.log(
        `Access JWT audience mismatch: expected ${expectedAudience}, got ${claims.aud}`,
      )
      return null
    }

    if (env.DEBUG) console.log('Access authenticated user:', claims.email)
    return claims
  } catch (error) {
    console.error('Error validating Access JWT:', error)
    return null
  }
}

/**
 * Check if request should use API key authentication (fallback mode)
 * @param {Request} request - HTTP request
 * @returns {boolean} Whether to use API key auth
 */
export function shouldUseApiKeyAuth(request) {
  // Since workers.dev is disabled, API key auth is only used with explicit parameters
  const url = new URL(request.url)
  const hasFallback = url.searchParams.has('fallback')
  const hasKey = url.searchParams.has('key')

  return hasFallback || hasKey
}
