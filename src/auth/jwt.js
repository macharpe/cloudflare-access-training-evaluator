import { base64url, asciiToUint8Array } from '../utils/encoding.js'

/**
 * Parse a JWT into its respective pieces. Does not do any validation other than form checking.
 * @param {string} token - jwt string
 * @returns {Object} Parsed JWT components
 */
export function parseJWT(token) {
  const tokenParts = token.split('.')

  if (tokenParts.length !== 3) {
    throw new Error('token must have 3 parts')
  }

  let enc = new TextDecoder('utf-8')
  return {
    to_be_validated: `${tokenParts[0]}.${tokenParts[1]}`,
    header: JSON.parse(enc.decode(base64url.parse(tokenParts[0]))),
    payload: JSON.parse(enc.decode(base64url.parse(tokenParts[1]))),
    signature: tokenParts[2],
  }
}

/**
 * Validates the provided token using the Access public key set
 * @param {*} env - Environment bindings
 * @param {string} token - the token to be validated
 * @returns {Object} Returns the payload if valid, or throws an error if not
 */
export async function verifyToken(env, token) {
  if (env.DEBUG) {
    console.log('incoming JWT', token)
  }
  const jwt = parseJWT(token)
  const key = await fetchAccessPublicKey(env, jwt.header.kid)

  const verified = await crypto.subtle.verify(
    'RSASSA-PKCS1-v1_5',
    key,
    base64url.parse(jwt.signature),
    asciiToUint8Array(jwt.to_be_validated),
  )

  if (!verified) {
    throw new Error('failed to verify token')
  }

  const claims = jwt.payload
  let now = Math.floor(Date.now() / 1000)
  // Validate expiration
  if (claims.exp < now) {
    throw new Error('expired token')
  }

  return claims
}

/**
 * Turn a payload into a JWT
 * @param {*} env - Environment bindings
 * @param {*} payload - JWT payload
 * @returns {string} Signed JWT
 */
export async function signJWT(env, payload) {
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
 * @param {*} env - Environment bindings
 * @param {string} kid - The key id that signed the token
 * @returns {CryptoKey} Access public key
 */
async function fetchAccessPublicKey(env, kid) {
  const resp = await fetch(`https://${env.TEAM_DOMAIN}/cdn-cgi/access/certs`)
  const keys = await resp.json()
  const jwk = keys.keys.filter((key) => key.kid == kid)[0]
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
 * Load the signing key from Workers Secrets and KV
 * @param {*} env - Environment bindings
 * @returns {Object} Key ID and private key
 */
async function loadSigningKey(env) {
  // Get kid from KV (public key metadata)
  const publicKeyset = await env.KEY_STORAGE.get('external_auth_keys', 'json')
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
    const privateKeyObject = JSON.parse(privateKeyJWK)
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
