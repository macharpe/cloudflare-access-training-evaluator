/**
 * Cloudflare Access authentication utilities
 *
 * Validates the Cloudflare Access application token on admin requests.
 */

import type { Env, AccessClaims } from '../types'
import { verifyToken } from './jwt.js'
import { isDebugEnabled } from '../utils/env.js'

/**
 * Check if the request is authenticated via Cloudflare Access
 *
 * The token is only trusted after its RS256 signature has been verified
 * against the team's published Access keys, and its expiry, issuer and
 * audience have been checked. Unsigned/decoded-only headers such as
 * `CF-Access-Jwt-Payload` are never trusted: any client can set them.
 *
 * @param request - HTTP request
 * @param env - Environment bindings
 * @returns Access claims if authenticated, null otherwise
 */
export async function isAccessAuthenticated(
  request: Request,
  env: Env,
): Promise<AccessClaims | null> {
  try {
    // `cf-access-jwt-assertion` is the header Access adds to origin requests.
    // `CF-Access-Jwt` is accepted for compatibility; it is verified identically.
    const token =
      request.headers.get('cf-access-jwt-assertion') ??
      request.headers.get('cf-access-jwt')

    if (isDebugEnabled(env)) {
      console.log(
        'Access JWT header:',
        token ? 'present' : 'missing',
        'URL:',
        request.url,
      )
    }

    if (!token) {
      console.log('No Cloudflare Access JWT headers found')
      return null
    }

    const expectedAudience = env.ACCESS_APP_AUD
    if (!expectedAudience) {
      console.log('ACCESS_APP_AUD secret not configured')
      return null
    }

    // Verifies the signature (kid lookup in the team's Access keys) and expiry.
    // Throws on any failure, which is handled below as unauthenticated.
    const claims = await verifyToken(env, token)

    // Access tokens always expire; reject any token that carries no expiry.
    if (typeof claims.exp !== 'number') {
      console.log('Access JWT has no exp claim')
      return null
    }

    // The token must have been issued by our own Access team.
    if (claims.iss !== `https://${env.TEAM_DOMAIN}`) {
      console.log('Access JWT issuer mismatch')
      return null
    }

    if (typeof claims.email !== 'string' || !claims.email) {
      if (isDebugEnabled(env)) console.log('Access JWT has no email claim')
      return null
    }

    // The audience must match our Access application (string or array).
    const audMatch = Array.isArray(claims.aud)
      ? claims.aud.includes(expectedAudience)
      : claims.aud === expectedAudience

    if (!audMatch) {
      console.log('Access JWT audience mismatch')
      return null
    }

    if (isDebugEnabled(env))
      console.log('Access authenticated user:', claims.email)
    return claims
  } catch (error) {
    console.error(
      'Error validating Access JWT:',
      error instanceof Error ? error.message : String(error),
    )
    return null
  }
}

