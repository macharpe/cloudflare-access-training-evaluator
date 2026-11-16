/**
 * JWT parsing, verification, and signing utilities
 *
 * Handles JWT operations for both Cloudflare Access validation
 * and External Evaluation response signing.
 */

import type { Env, DecodedJWT, AccessClaims, JWKS } from '../types'
import { base64url, asciiToUint8Array } from '../utils/encoding.js'
import { cachedFetch, CACHE_CONFIG } from '../utils/cache.js'
import { structuredLog, LOG_LEVELS } from '../utils/logging.js'
import { sanitizeForLogging } from '../utils/validation.js'

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
  const header = JSON.parse(
    enc.decode(base64url.parse(tokenParts[0]!)),
  ) as DecodedJWT['header']
  const payload = JSON.parse(
    enc.decode(base64url.parse(tokenParts[1]!)),
  ) as AccessClaims

  return {
    header,
    payload,
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
  options: VerifyTokenOptions = {},
): Promise<AccessClaims> {
  // Never log the token here: this also validates admin session tokens.
  const jwt = parseJWT(token)

  // Only RS256 is ever issued by Access; never let the token pick the algorithm.
  if (jwt.header.alg !== 'RS256') {
    throw new Error('unsupported token algorithm')
  }

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

  // Validate expiration. A token without a numeric exp never expires, so reject it.
  if (typeof claims.exp !== 'number' || claims.exp < now) {
    throw new Error('expired token')
  }

  // The issuer is deliberately not enforced here: the signature was verified
  // against OUR team's keys, so the token can only come from our Access team,
  // and the exact `iss` format of External Evaluation tokens is not pinned
  // down - enforcing a wrong guess would deny every user. The admin gate
  // (auth/access.ts) strictly pins `iss` for admin sessions.
  if (options.warnOnIssuerMismatch) {
    warnOnUnexpectedIssuer(env, claims)
  }
  return claims
}

/**
 * Options for {@link verifyToken}
 */
export interface VerifyTokenOptions {
  /**
   * Emit one structured warning (never enforce) when a present `iss` claim
   * differs from `https://TEAM_DOMAIN`. Used for External Evaluation tokens.
   */
  warnOnIssuerMismatch?: boolean
}

/**
 * Log a single structured warning when the token issuer is present and differs
 * from our team domain. Observability only: never rejects, never logs the token.
 *
 * @param env - Environment bindings
 * @param claims - Verified token claims
 */
export function warnOnUnexpectedIssuer(env: Env, claims: AccessClaims): void {
  const expected = `https://${env.TEAM_DOMAIN}`
  const issuer = (claims as { iss?: unknown }).iss
  if (issuer === undefined || issuer === null || issuer === expected) {
    return
  }
  structuredLog(
    LOG_LEVELS.WARN,
    'Evaluation token issuer differs from TEAM_DOMAIN',
    {
      issuer: sanitizeForLogging(
        typeof issuer === 'string' ? issuer : JSON.stringify(issuer),
      ),
      expected,
    },
    env,
  )
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

  const keys: JWKS = await resp.json()

  // Optimized: Use find() instead of filter()[0] for early termination
  const jwk = keys.keys.find((key: { kid: string }) => key.kid === kid)

  if (!jwk) {
    throw new Error(`Public key not found for kid: ${kid}`)
  }

  const key = await crypto.subtle.importKey(
    'jwk',
    jwk,
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
    // The cause is attached for debugging; it never contains key material because
    // import errors describe the format problem, not the secret's value.
    console.log(
      'Failed to parse or import private key from secret:',
      e instanceof Error ? e.message : String(e),
    )
    throw new Error('invalid RSA_PRIVATE_KEY secret format', { cause: e })
  }
}
