import { TEST_AUD, TEST_TEAM_DOMAIN } from './env'
import type { AccessClaims } from '../../src/types'

export function b64urlJson(value: unknown): string {
  const json = JSON.stringify(value) as string | undefined
  const encoded: string = Buffer.from(json ?? 'null').toString('base64url')
  return encoded
}

export interface TestKey {
  kid: string
  publicJwk: JsonWebKey & { kid: string }
  privateJwk: JsonWebKey
  privateKey: CryptoKey
}

export async function generateTestKey(kid: string): Promise<TestKey> {
  const pair = (await crypto.subtle.generateKey(
    {
      name: 'RSASSA-PKCS1-v1_5',
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: 'SHA-256',
    },
    true,
    ['sign', 'verify'],
  )) as CryptoKeyPair
  const publicJwk = (await crypto.subtle.exportKey('jwk', pair.publicKey)) as JsonWebKey
  const privateJwk = (await crypto.subtle.exportKey('jwk', pair.privateKey)) as JsonWebKey
  return {
    kid,
    publicJwk: { ...publicJwk, kid, alg: 'RS256', use: 'sig' },
    privateJwk,
    privateKey: pair.privateKey,
  }
}

/** Sign a JWT the same way Cloudflare Access does (RS256). */
export async function signTestJwt(
  key: TestKey,
  payload: Record<string, unknown>,
  headerOverrides: Record<string, unknown> = {},
): Promise<string> {
  const header = { alg: 'RS256', kid: key.kid, typ: 'JWT', ...headerOverrides }
  const signingInput = `${b64urlJson(header)}.${b64urlJson(payload)}`
  const sig = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    key.privateKey,
    new TextEncoder().encode(signingInput),
  )
  return `${signingInput}.${Buffer.from(sig).toString('base64url')}`
}

export function nowSeconds(): number {
  return Math.floor(Date.now() / 1000)
}

export function accessClaims(overrides: Record<string, unknown> = {}): AccessClaims {
  const email = (overrides['email'] as string | undefined) ?? 'alice@example.com'
  return {
    email,
    aud: TEST_AUD,
    iss: `https://${TEST_TEAM_DOMAIN}`,
    sub: 'user-1',
    iat: nowSeconds(),
    exp: nowSeconds() + 300,
    nonce: 'nonce-123',
    identity: { email },
    ...overrides,
  }
}

/** A structurally valid but UNSIGNED token (signature is junk). */
export function unsignedJwt(payload: Record<string, unknown>): string {
  return `${b64urlJson({ alg: 'RS256', kid: 'x' })}.${b64urlJson(payload)}.c2ln`
}

/**
 * Headers as Cloudflare Access would forward them to the origin.
 * Uses `cf-access-jwt-assertion` (the header Access really sends).
 */
export function accessHeaders(
  payloadOverrides: Record<string, unknown> = {},
  extra: Record<string, string> = {},
): Headers {
  const headers = new Headers(extra)
  headers.set('cf-access-jwt-assertion', unsignedJwt(accessClaims(payloadOverrides)))
  return headers
}

/** Fetch stub serving the Access JWKS (and nothing else). */
export function jwksFetch(keys: TestKey[], status = 200): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = String(input instanceof Request ? input.url : input)
    if (url !== `https://${TEST_TEAM_DOMAIN}/cdn-cgi/access/certs`) {
      throw new Error(`unexpected fetch in test: ${url}`)
    }
    return new Response(JSON.stringify({ keys: keys.map((k) => k.publicJwk) }), {
      status,
      statusText: status === 200 ? 'OK' : 'Bad',
      headers: { 'content-type': 'application/json' },
    })
  })
}
