/**
 * JWT parsing, verification, and signing utilities
 *
 * Handles JWT operations for both Cloudflare Access validation
 * and External Evaluation response signing.
 */

import type { Env, DecodedJWT, AccessClaims, JWKS } from '../types'
import { base64url, asciiToUint8Array } from '../utils/encoding.js'
import { cachedFetch, CACHE_CONFIG } from '../utils/cache.js'

/**
 * Parse a JWT into its respective pieces
 *
 * Does not do any validation other than form checking.
 *
 * @param token - JWT string
 * @returns Parsed JWT components
 */
export function parseJWT(token: string): DecodedJWT {
  const tokenParts = token.split('.')

  if (tokenParts.length !== 3) {
    throw new Error('token must have 3 parts')
  }

  const enc = new TextDecoder('utf-8')
  const header = JSON.parse(enc.decode(base64url.parse(tokenParts[0]!)))
  const payload = JSON.parse(enc.decode(base64url.parse(tokenParts[1]!)))

  return {
    header,
    payload: payload as AccessClaims,
    signature: tokenParts[2]!,
    raw: {
      header: tokenParts[0]!,
      payload: tokenParts[1]!,
      signature: tokenParts[2]!,
    },
  }
}

/**
 * Validates the provided token using the Access public key set
 *
 * @param env - Environment bindings
 * @param token - The token to be validated
 * @returns Returns the payload if valid, or throws an error if not
 */
export async function verifyToken(
  env: Env,
  token: string,
): Promise<AccessClaims> {
  if (env.DEBUG) {
    console.log('incoming JWT', token)
  }

  const jwt = parseJWT(token)
  const key = await fetchAccessPublicKey(env, jwt.header.kid)

  const toBeValidated = `${jwt.raw.header}.${jwt.raw.payload}`

  const verified = await crypto.subtle.verify(
    'RSASSA-PKCS1-v1_5',
    key,
    base64url.parse(jwt.signature),
    asciiToUint8Array(toBeValidated),
  )

  if (!verified) {
    throw new Error('failed to verify token')
  }

  const claims = jwt.payload
  const now = Math.floor(Date.now() / 1000)

  // Validate expiration
  if (claims.exp < now) {
    throw new Error('expired token')
  }

  return claims
}

/**
 * Turn a payload into a signed JWT
 *
 * @param env - Environment bindings
 * @param payload - JWT payload
 * @returns Signed JWT string
 */
export async function signJWT(
  env: Env,
  payload: Record<string, unknown>,
): Promise<string> {
  const { kid, privateKey } = await loadSigningKey(env)

  const header = {
    alg: 'RS256',
    kid: kid,
  }

  const encHeader = base64url.stringify(
    asciiToUint8Array(JSON.stringify(header)),
  )
  const encPayload = base64url.stringify(
    asciiToUint8Array(JSON.stringify(payload)),
  )
  const encoded = `${encHeader}.${encPayload}`

  const sig = new Uint8Array(
    await crypto.subtle.sign(
      'RSASSA-PKCS1-v1_5',
      privateKey,
      asciiToUint8Array(encoded),
    ),
  )

  return `${encoded}.${base64url.stringify(sig)}`
}

/**
 * Helper to get the Access public keys from the certs endpoint
 *
 * @param env - Environment bindings
 * @param kid - The key ID that signed the token
 * @returns Access public key
 */
async function fetchAccessPublicKey(env: Env, kid: string): Promise<CryptoKey> {
  // Validate TEAM_DOMAIN configuration
  if (!env.TEAM_DOMAIN || !env.TEAM_DOMAIN.includes('.')) {
    throw new Error('Invalid TEAM_DOMAIN configuration')
  }

  const cacheKey = `${CACHE_CONFIG.ACCESS_KEYS.key}_${env.TEAM_DOMAIN}`
  const url = `https://${env.TEAM_DOMAIN}/cdn-cgi/access/certs`

  // Use cached fetch for Access public keys
  const resp = await cachedFetch<JWKS>(
    url,
    {},
    cacheKey,
    CACHE_CONFIG.ACCESS_KEYS.ttl,
    env,
  )

  if (!resp.ok) {
    throw new Error(
      `Failed to fetch Access public keys: ${resp.status} ${resp.statusText || ''}`,
    )
  }

  const keys = (await resp.json()) as JWKS

  // Optimized: Use find() instead of filter()[0] for early termination
  const jwk = keys.keys.find((key: { kid: string }) => key.kid === kid)

  if (!jwk) {
    throw new Error(`Public key not found for kid: ${kid}`)
  }

  const key = await crypto.subtle.importKey(
    'jwk',
    jwk as JsonWebKey,
    {
      name: 'RSASSA-PKCS1-v1_5',
      hash: 'SHA-256',
    },
    false,
    ['verify'],
  )

  return key
}

/**
 * Stored keyset structure
 */
interface StoredKeyset {
  kid: string
  public: JsonWebKey
}

/**
 * Load the signing key from Workers Secrets and KV
 *
 * @param env - Environment bindings
 * @returns Key ID and private key
 */
async function loadSigningKey(
  env: Env,
): Promise<{ kid: string; privateKey: CryptoKey }> {
  // Get kid from KV (public key metadata)
  const publicKeyset = await env.KEY_STORAGE.get<StoredKeyset>(
    'external_auth_keys',
    'json',
  )

  if (!publicKeyset) {
    console.log('Key set has not been generated. Call /keys first.')
    throw new Error('cannot find signing key')
  }

  // Get private key from Workers Secret
  const privateKeyJWK = env.RSA_PRIVATE_KEY
  if (!privateKeyJWK) {
    console.log(
      'Private key secret not configured. Run: wrangler secret put RSA_PRIVATE_KEY',
    )
    throw new Error('RSA_PRIVATE_KEY secret not set')
  }

  try {
    const privateKeyObject = JSON.parse(privateKeyJWK) as JsonWebKey
    const signingKey = await crypto.subtle.importKey(
      'jwk',
      privateKeyObject,
      {
        name: 'RSASSA-PKCS1-v1_5',
        hash: 'SHA-256',
      },
      false,
      ['sign'],
    )

    return { kid: publicKeyset.kid, privateKey: signingKey }
  } catch (e) {
    console.log('Failed to parse or import private key from secret:', e)
    throw new Error('invalid RSA_PRIVATE_KEY secret format')
  }
}
