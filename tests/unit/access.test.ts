import { beforeEach, describe, expect, it, vi } from 'vitest'
import { isAccessAuthenticated } from '../../src/auth/access'
import { createEnv, TEST_AUD } from '../helpers/env'
import {
  accessClaims,
  b64urlJson,
  generateTestKey,
  nowSeconds,
  signTestJwt,
  unsignedJwt,
} from '../helpers/jwt'
import { accessKey, signedAccessJwt, stubFetchWithAccess } from '../helpers/access'

const req = (headers: Record<string, string> = {}, url = 'https://admin.example.com/admin') =>
  new Request(url, { headers })

describe('isAccessAuthenticated — header handling', () => {
  const env = createEnv()
  beforeEach(async () => {
    await stubFetchWithAccess()
  })

  it('rejects requests with no Access headers (fail closed)', async () => {
    expect(await isAccessAuthenticated(req(), env)).toBeNull()
  })

  it('accepts a signed cf-access-jwt-assertion header with matching audience', async () => {
    const claims = await isAccessAuthenticated(req({ 'cf-access-jwt-assertion': await signedAccessJwt() }), env)
    expect(claims?.email).toBe('alice@example.com')
  })

  it('accepts the CF-Access-Jwt header', async () => {
    const claims = await isAccessAuthenticated(req({ 'CF-Access-Jwt': await signedAccessJwt() }), env)
    expect(claims?.email).toBe('alice@example.com')
  })

  it('accepts an audience array containing the expected AUD', async () => {
    const jwt = await signedAccessJwt({ aud: ['other', TEST_AUD] })
    expect(await isAccessAuthenticated(req({ 'cf-access-jwt-assertion': jwt }), env)).not.toBeNull()
  })

  it('rejects a wrong audience (string and array)', async () => {
    for (const aud of ['someone-elses-app', ['a', 'b']]) {
      const jwt = await signedAccessJwt({ aud })
      expect(await isAccessAuthenticated(req({ 'cf-access-jwt-assertion': jwt }), env)).toBeNull()
    }
  })

  it('rejects when ACCESS_APP_AUD is not configured', async () => {
    const noAud = createEnv({ ACCESS_APP_AUD: '' })
    const jwt = await signedAccessJwt()
    expect(await isAccessAuthenticated(req({ 'cf-access-jwt-assertion': jwt }), noAud)).toBeNull()
  })

  it.each(['email', 'aud', 'iss'])('rejects tokens missing %s', async (field) => {
    const key = await accessKey()
    const c = { ...accessClaims() } as Record<string, unknown>
    delete c[field]
    const jwt = await signTestJwt(key, c)
    expect(await isAccessAuthenticated(req({ 'cf-access-jwt-assertion': jwt }), env)).toBeNull()
  })

  it('rejects malformed tokens without throwing', async () => {
    for (const bad of ['garbage', 'a.b', 'a.b.c.d', 'a.!!!.c', `a.${b64urlJson('x')}.c`]) {
      expect(await isAccessAuthenticated(req({ 'cf-access-jwt-assertion': bad }), env)).toBeNull()
    }
  })
})

describe('isAccessAuthenticated — cryptographic validation', () => {
  const env = createEnv()
  beforeEach(async () => {
    await stubFetchWithAccess()
  })

  it('rejects a token signed by a different key that reuses the trusted kid', async () => {
    const trusted = await accessKey()
    const attacker = await generateTestKey(trusted.kid) // same kid, different key
    const forged = await signTestJwt(attacker, accessClaims())
    expect(await isAccessAuthenticated(req({ 'cf-access-jwt-assertion': forged }), env)).toBeNull()
  })

  it('rejects an unsigned/garbage-signature token', async () => {
    const token = unsignedJwt(accessClaims())
    expect(await isAccessAuthenticated(req({ 'cf-access-jwt-assertion': token }), env)).toBeNull()
  })

  it('rejects a correctly signed but expired token', async () => {
    const jwt = await signedAccessJwt({ exp: nowSeconds() - 3600 })
    expect(await isAccessAuthenticated(req({ 'cf-access-jwt-assertion': jwt }), env)).toBeNull()
  })

  it('rejects a correctly signed token with no exp claim', async () => {
    const claims = { ...accessClaims() } as Record<string, unknown>
    delete claims['exp']
    const jwt = await signTestJwt(await accessKey(), claims)
    expect(await isAccessAuthenticated(req({ 'cf-access-jwt-assertion': jwt }), env)).toBeNull()
  })

  it('rejects a correctly signed token from a different issuer', async () => {
    const jwt = await signedAccessJwt({ iss: 'https://evil.example.com' })
    expect(await isAccessAuthenticated(req({ 'cf-access-jwt-assertion': jwt }), env)).toBeNull()
  })

  it('rejects a token whose header declares a different algorithm', async () => {
    const jwt = await signTestJwt(await accessKey(), accessClaims(), { alg: 'HS256' })
    expect(await isAccessAuthenticated(req({ 'cf-access-jwt-assertion': jwt }), env)).toBeNull()
  })

  it('rejects the unauthenticated CF-Access-Jwt-Payload header (client-forgeable), even with valid-looking claims', async () => {
    // Access never sends this header to origins; any client could forge it.
    const payload = Buffer.from(JSON.stringify(accessClaims())).toString('base64')
    expect(await isAccessAuthenticated(req({ 'CF-Access-Jwt-Payload': payload }), env)).toBeNull()
  })

  it('does not fall back to a forged payload header when a bad JWT is also present', async () => {
    const payload = Buffer.from(JSON.stringify(accessClaims())).toString('base64')
    const headers = { 'CF-Access-Jwt-Payload': payload, 'cf-access-jwt-assertion': unsignedJwt(accessClaims()) }
    expect(await isAccessAuthenticated(req(headers), env)).toBeNull()
  })

  it('accepts real base64url-encoded Access JWTs containing - or _', async () => {
    // Real Access JWTs are base64url. atob() throws on '-'/'_' so such users used to be locked out.
    const jwt = await signedAccessJwt({ name: 'Zoë ??>' })
    expect(jwt.split('.')[1]).toMatch(/[-_]/)
    const claims = await isAccessAuthenticated(req({ 'cf-access-jwt-assertion': jwt }), env)
    expect(claims?.email).toBe('alice@example.com')
  })

  it('never logs token contents when DEBUG is on', async () => {
    const jwt = await signedAccessJwt()
    await isAccessAuthenticated(req({ 'cf-access-jwt-assertion': jwt }), createEnv({ DEBUG: true }))
    const logged = JSON.stringify((console.log as unknown as { mock: { calls: unknown[] } }).mock.calls)
    expect(logged).not.toContain(jwt)
    expect(logged).not.toContain(jwt.split('.')[1]!)
  })
})

describe('isAccessAuthenticated — DEBUG parsing', () => {
  beforeEach(async () => {
    await stubFetchWithAccess()
  })

  it.each(['false', '', '0', 'off'])('DEBUG=%j (string) does not enable debug logging', async (DEBUG) => {
    const env = createEnv({ DEBUG: DEBUG as unknown as boolean })
    await isAccessAuthenticated(req({ 'cf-access-jwt-assertion': await signedAccessJwt() }), env)
    const logged = JSON.stringify(vi.mocked(console.log).mock.calls)
    expect(logged).not.toContain('Access JWT header:')
    expect(logged).not.toContain('Access authenticated user:')
  })

  it("DEBUG='true' (string) enables debug logging", async () => {
    const env = createEnv({ DEBUG: 'true' as unknown as boolean })
    await isAccessAuthenticated(req({ 'cf-access-jwt-assertion': await signedAccessJwt() }), env)
    expect(JSON.stringify(vi.mocked(console.log).mock.calls)).toContain('Access authenticated user:')
  })

  it('still pins the issuer strictly on the admin gate (no warn-and-continue)', async () => {
    const jwt = await signedAccessJwt({ iss: 'https://other-format.example.com' })
    expect(await isAccessAuthenticated(req({ 'cf-access-jwt-assertion': jwt }), createEnv())).toBeNull()
  })
})
