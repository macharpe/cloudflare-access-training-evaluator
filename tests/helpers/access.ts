import { vi } from 'vitest'
import { TEST_TEAM_DOMAIN } from './env'
import {
  accessClaims,
  generateTestKey,
  signTestJwt,
  type TestKey,
} from './jwt'
import { stubFetch, type FetchHandler } from './okta'

let sharedKey: TestKey | undefined

/** One RSA key shared by all tests (key generation is slow). */
export async function accessKey(): Promise<TestKey> {
  sharedKey ??= await generateTestKey('access-test-kid')
  return sharedKey
}

/** A properly RS256-signed Access JWT (valid under both lax and strict validation). */
export async function signedAccessJwt(overrides: Record<string, unknown> = {}): Promise<string> {
  return signTestJwt(await accessKey(), accessClaims(overrides))
}

/** Headers of an authenticated Access request, as forwarded to the origin. */
export async function authedHeaders(
  overrides: Record<string, unknown> = {},
  extra: Record<string, string> = {},
): Promise<Headers> {
  const headers = new Headers(extra)
  headers.set('cf-access-jwt-assertion', await signedAccessJwt(overrides))
  return headers
}

/**
 * Stub global fetch: serves the Access JWKS signed by the shared key and
 * delegates everything else (e.g. Okta) to `handler`. Unmatched => throws.
 */
export async function stubFetchWithAccess(handler?: FetchHandler) {
  const key = await accessKey()
  return stubFetch(
    handler ??
      ((url) => {
        throw new Error(`unexpected outbound fetch: ${url}`)
      }),
    [key],
  )
}

export { TEST_TEAM_DOMAIN, vi }
