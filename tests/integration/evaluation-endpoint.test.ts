import { beforeEach, describe, expect, it, vi } from 'vitest'
import { parseJWT } from '../../src/auth/jwt'
import { generateKeys, loadPublicKey } from '../../src/auth/keys'
import { handleExternalEvaluationRequest } from '../../src/handlers/index'
import { createEnv, type TestEnv } from '../helpers/env'
import { accessClaims, b64urlJson, generateTestKey, signTestJwt, nowSeconds } from '../helpers/jwt'
import { accessKey, signedAccessJwt, stubFetchWithAccess } from '../helpers/access'
import { call, json, postJson } from '../helpers/worker'
import { fetchUrl } from '../helpers/okta'

async function evalEnv(overrides: Partial<TestEnv> = {}): Promise<TestEnv> {
  const env = createEnv(overrides)
  const { privateKey } = await generateKeys(env)
  env.RSA_PRIVATE_KEY = JSON.stringify(privateKey)
  return env
}

async function verifyOurJwt(env: TestEnv, token: string) {
  const jwt = parseJWT(token)
  const pub = await crypto.subtle.importKey(
    'jwk',
    (await loadPublicKey(env)),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['verify'],
  )
  const valid = await crypto.subtle.verify(
    'RSASSA-PKCS1-v1_5',
    pub,
    Buffer.from(jwt.raw.signature, 'base64url'),
    new TextEncoder().encode(`${jwt.raw.header}.${jwt.raw.payload}`),
  )
  return { valid, payload: jwt.payload as unknown as Record<string, unknown> }
}

beforeEach(async () => {
  await stubFetchWithAccess()
})

describe('POST / — External Evaluation', () => {
  it.each([
    ['completed', true],
    ['started', false],
    ['not started', false],
  ] as const)('status %s => signed success=%s response echoing the nonce', async (status, expected) => {
    const env = await evalEnv()
    env.DB.seed('alice', status)
    const res = await call(env, '/', postJson({ token: await signedAccessJwt({ nonce: 'n-42' }) }))
    expect(res.status).toBe(200)
    const { token } = (await json(res)) as { token: string }
    const { valid, payload } = await verifyOurJwt(env, token)
    expect(valid).toBe(true)
    expect(payload['success']).toBe(expected)
    expect(payload['nonce']).toBe('n-42')
    expect(payload['exp'] as number).toBeGreaterThan(payload['iat'] as number)
    expect((payload['exp'] as number) - (payload['iat'] as number)).toBe(300)
  })

  it('denies (success=false, still 200 + signed) unknown users', async () => {
    const env = await evalEnv()
    const res = await call(env, '/', postJson({ token: await signedAccessJwt() }))
    const { payload } = await verifyOurJwt(env, ((await json(res)) as { token: string }).token)
    expect(payload['success']).toBe(false)
  })

  it('denies on DB failure (fail closed) instead of erroring open', async () => {
    const env = await evalEnv()
    env.DB.seed('alice', 'completed')
    env.DB.failWhen(() => new Error('d1 down'))
    const res = await call(env, '/', postJson({ token: await signedAccessJwt() }))
    const { payload } = await verifyOurJwt(env, ((await json(res)) as { token: string }).token)
    expect(payload['success']).toBe(false)
  })

  it('response is JSON with security headers', async () => {
    const env = await evalEnv()
    const res = await call(env, '/', postJson({ token: await signedAccessJwt() }))
    expect(res.headers.get('content-type')).toBe('application/json')
    expect(res.headers.get('x-content-type-options')).toBe('nosniff')
  })

  describe('rejects bad input with 403 and never mints a token', () => {
    const bad: Array<[string, () => Promise<RequestInit>]> = [
      ['no body', async () => ({ method: 'POST' })],
      ['invalid JSON', async () => postJson('{not json')],
      ['missing token', async () => postJson({})],
      ['empty token', async () => postJson({ token: '' })],
      ['garbage token', async () => postJson({ token: 'a.b.c' })],
      ['2-part token', async () => postJson({ token: 'a.b' })],
      [
        'tampered payload',
        async () => {
          const [h, , s] = (await signedAccessJwt({ email: 'x@example.com' })).split('.')
          return postJson({ token: `${h}.${b64urlJson(accessClaims({ email: 'alice@example.com' }))}.${s}` })
        },
      ],
      ['expired token', async () => postJson({ token: await signedAccessJwt({ exp: nowSeconds() - 60 }) })],
      [
        'token signed by an unknown key',
        async () => postJson({ token: await signTestJwt(await generateTestKey('access-test-kid'), accessClaims()) }),
      ],
      [
        'token with unknown kid',
        async () => postJson({ token: await signTestJwt(await generateTestKey('nope'), accessClaims()) }),
      ],
    ]
    it.each(bad)('%s', async (_name, build) => {
      const env = await evalEnv()
      env.DB.seed('alice', 'completed')
      const res = await call(env, '/', await build())
      expect(res.status).toBe(403)
      const body = await json(res)
      expect(body).toMatchObject({ success: false, error: 'Authentication failed' })
      expect(body).not.toHaveProperty('token')
      expect(body).not.toHaveProperty('stack')
      expect(body).not.toHaveProperty('details')
    })
  })

  it('DEBUG mode adds details to errors; production mode never does', async () => {
    const dbg = await evalEnv({ DEBUG: true })
    const res = await call(dbg, '/', postJson({}))
    expect(res.status).toBe(403)
    expect(await json(res)).toHaveProperty('details')
    const prod = await evalEnv({ DEBUG: false })
    expect(await json(await call(prod, '/', postJson({})))).not.toHaveProperty('details')
  })

  it('fails (403) rather than returning an unsigned result when the signing secret is missing', async () => {
    const env = await evalEnv()
    env.RSA_PRIVATE_KEY = ''
    env.DB.seed('alice', 'completed')
    const res = await call(env, '/', postJson({ token: await signedAccessJwt() }))
    expect(res.status).toBe(403)
    expect(await json(res)).not.toHaveProperty('token')
  })

  it('a different team key cannot be substituted: JWKS is fetched only from TEAM_DOMAIN', async () => {
    const spy = await stubFetchWithAccess()
    const env = await evalEnv()
    await call(env, '/', postJson({ token: await signedAccessJwt() }))
    const urls = spy.mock.calls.map(([u]) => fetchUrl(u))
    expect(urls).toEqual(['https://team.example.cloudflareaccess.com/cdn-cgi/access/certs'])
    void accessKey
  })
})

describe('GET /keys — public JWKS', () => {
  it('is public, cacheable, and exposes only public key material', async () => {
    const env = createEnv()
    const res = await call(env, '/keys')
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toContain('public')
    const { keys } = (await json(res)) as { keys: Array<Record<string, unknown>> }
    expect(keys).toHaveLength(1)
    expect(keys[0]).toMatchObject({ kty: 'RSA' })
    for (const priv of ['d', 'p', 'q', 'dp', 'dq', 'qi']) expect(keys[0]).not.toHaveProperty(priv)
  })
  it('returns the same key on subsequent calls (generated once)', async () => {
    const env = createEnv()
    const a = await json(await call(env, '/keys'))
    const b = await json(await call(env, '/keys'))
    expect(a).toEqual(b)
  })
  it('only the exact /keys path is the JWKS endpoint; other */keys paths are 404 and generate nothing', async () => {
    const env = createEnv()
    const res = await call(env, '/anything/at/all/keys', { method: 'DELETE' })
    expect(res.status).toBe(404)
    expect(env.KEY_STORAGE.store.has('external_auth_keys')).toBe(false)
  })
})

describe('GET / (public overview) and unrouted GETs', () => {
  it('serves an HTML page without authentication, with a nonce-based CSP', async () => {
    const res = await call(createEnv(), '/')
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/html')
    const csp = res.headers.get('content-security-policy')!
    expect(csp).toMatch(/script-src[^;]*'nonce-/)
    expect(csp).not.toContain('unsafe-inline')
    expect(csp).not.toContain('unsafe-eval')
    expect(res.headers.get('x-frame-options')).toBe('DENY')
  })
  it('the public page never contains user data or secrets', async () => {
    const env = createEnv()
    env.DB.seed('alice', 'completed', 'AliceSecretName', 'alice-secret@example.com')
    const body = await (await call(env, '/')).text()
    expect(body).not.toContain('AliceSecretName')
    expect(body).not.toContain('alice-secret')
    expect(body).not.toContain(env.OKTA_API_TOKEN)
    expect(env.DB.calls).toHaveLength(0)
  })
  it('unknown GET paths are a 404, not a data endpoint', async () => {
    const env = createEnv()
    env.DB.seed('alice')
    const res = await call(env, '/api/users')
    expect(res.status).toBe(404)
    expect(await res.text()).not.toContain('alice')
    expect(env.DB.calls).toHaveLength(0)
  })
})

describe('only POST / reaches the evaluation handler', () => {
  it.each(['/evaluate', '/api/evaluate', '/x', '/admin/x', '/keys/x'])(
    'a valid evaluation POST to %s is 404 and mints no token',
    async (path) => {
      const env = await evalEnv()
      env.DB.seed('alice', 'completed')
      const res = await call(env, path, postJson({ token: await signedAccessJwt() }))
      expect(res.status).toBe(404)
      expect(await json(res)).not.toHaveProperty('token')
    },
  )

  it('handleExternalEvaluationRequest answers non-POST with 405 (no HTML duplicate)', async () => {
    const env = await evalEnv()
    for (const method of ['GET', 'PUT', 'DELETE']) {
      const res = await handleExternalEvaluationRequest(env, new Request('https://x.test/', { method }))
      expect(res.status).toBe(405)
      expect(res.headers.get('allow')).toBe('POST')
      expect(res.headers.get('content-type')).toBe('application/json')
    }
  })
})

describe('evaluation token issuer is observed, not enforced', () => {
  const issuerWarnings = () =>
    vi
      .mocked(console.warn)
      .mock.calls.map((c) => fetchUrl(c[0]))
      .filter((m) => m.includes('Evaluation token issuer differs from TEAM_DOMAIN'))

  it('a different iss format logs one warning and the user is still evaluated', async () => {
    const env = await evalEnv()
    env.DB.seed('alice', 'completed')
    const token = await signedAccessJwt({ iss: 'https://team.example.cloudflareaccess.com/cdn-cgi/access' })
    const res = await call(env, '/', postJson({ token }))
    expect(res.status).toBe(200)
    const { payload } = await verifyOurJwt(env, ((await json(res)) as { token: string }).token)
    expect(payload['success']).toBe(true)
    expect(issuerWarnings()).toHaveLength(1)
    const logs = JSON.stringify([
      ...vi.mocked(console.log).mock.calls,
      ...vi.mocked(console.warn).mock.calls,
      ...vi.mocked(console.error).mock.calls,
    ])
    expect(logs).not.toContain(token)
    expect(logs).not.toContain(token.split('.')[1]!)
  })

  it('no warning when iss equals https://TEAM_DOMAIN', async () => {
    const env = await evalEnv()
    env.DB.seed('alice', 'completed')
    await call(env, '/', postJson({ token: await signedAccessJwt() }))
    expect(issuerWarnings()).toHaveLength(0)
  })

  it("DEBUG='false' (string) does not log tokens nor add error details", async () => {
    const env = await evalEnv({ DEBUG: 'false' as unknown as boolean })
    env.DB.seed('alice', 'completed')
    const token = await signedAccessJwt()
    await call(env, '/', postJson({ token }))
    expect(JSON.stringify(vi.mocked(console.log).mock.calls)).not.toContain(token)
    expect(await json(await call(env, '/', postJson({})))).not.toHaveProperty('details')
  })
})
