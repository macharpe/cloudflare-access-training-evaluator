import { beforeEach, describe, expect, it } from 'vitest'
import { createEnv, type TestEnv } from '../helpers/env'
import { accessClaims, b64urlJson, unsignedJwt } from '../helpers/jwt'
import { authedHeaders, signedAccessJwt, stubFetchWithAccess } from '../helpers/access'
import { fetchUrl, jsonResponse, oktaUser } from '../helpers/okta'
import { call, json, postJson } from '../helpers/worker'

/** Every admin endpoint exposed by src/index.ts (method, path). */
const ADMIN_ENDPOINTS: Array<{ method: string; path: string; web: boolean; body?: unknown }> = [
  { method: 'GET', path: '/admin', web: true },
  { method: 'GET', path: '/admin/', web: true },
  { method: 'GET', path: '/dashboard', web: true },
  { method: 'GET', path: '/dashboard/', web: true },
  { method: 'GET', path: '/init-db', web: false },
  { method: 'POST', path: '/init-db', web: false },
  { method: 'POST', path: '/api/update-training', web: false, body: { email: 'alice@example.com', status: 'completed' } },
  { method: 'POST', path: '/api/okta/sync', web: false },
  { method: 'GET', path: '/api/okta/groups', web: false },
  { method: 'GET', path: '/api/okta/users', web: false },
]

const init = (e: (typeof ADMIN_ENDPOINTS)[number], headers: Headers = new Headers()): RequestInit =>
  e.body !== undefined ? postJson(e.body, headers) : { method: e.method, headers }

let env: TestEnv
let fetchSpy: Awaited<ReturnType<typeof stubFetchWithAccess>>
beforeEach(async () => {
  env = createEnv()
  env.DB.seed('alice', 'not started', 'Alice', 'alice@example.com')
  fetchSpy = await stubFetchWithAccess((url) => {
    if (url.includes('/api/v1/users')) return jsonResponse([oktaUser('alice@example.com', 'Alice')])
    if (url.includes('/api/v1/groups')) return jsonResponse([])
    throw new Error(`unexpected ${url}`)
  })
  fetchSpy.mockClear()
})

describe('admin endpoints reject unauthenticated requests', () => {
  it.each(ADMIN_ENDPOINTS)('$method $path => 401 and no side effects', async (e) => {
    const res = await call(env, e.path, init(e))
    expect(res.status).toBe(401)
    expect(res.headers.get('content-type')).toContain(e.web ? 'text/html' : 'application/json')
    // No DB access, no Okta call, nothing changed.
    expect(env.DB.calls).toHaveLength(0)
    expect(env.DB.status('alice')).toBe('not started')
    expect(fetchSpy).not.toHaveBeenCalled()
    const body = await res.text()
    expect(body).not.toContain('alice@example.com')
    expect(body).not.toContain(env.OKTA_API_TOKEN)
  })

  it('JSON 401 body uses the documented error shape', async () => {
    const res = await call(env, '/api/okta/users')
    expect(await json(res)).toMatchObject({ error: 'Unauthorized' })
  })

  it.each([
    ['wrong audience', () => signedAccessJwt({ aud: 'other-app' })],
    ['missing email', async () => unsignedJwt({ aud: 'test-access-aud', iss: 'x' })],
    ['malformed', async () => 'not.a.jwt.at.all'],
    ['two parts', async () => 'abc.def'],
  ])('rejects Access header with %s', async (_n, mk) => {
    const headers = new Headers({ 'cf-access-jwt-assertion': await mk() })
    for (const e of ADMIN_ENDPOINTS) {
      const res = await call(env, e.path, init(e, headers))
      expect(res.status, `${e.method} ${e.path}`).toBe(401)
    }
    expect(env.DB.calls).toHaveLength(0)
  })

  it('does not accept credentials from query parameters (?key=, ?fallback=) or cookies/Authorization', async () => {
    for (const e of ADMIN_ENDPOINTS) {
      const res = await call(env, `${e.path}?key=secret&fallback=1`, init(e, new Headers({ Authorization: 'Bearer x', Cookie: 'CF_Authorization=abc' })))
      expect(res.status, `${e.method} ${e.path}`).toBe(401)
    }
  })

  it('a public-route path trick cannot reach admin handlers: /admin/keys is 404 (exact matching)', async () => {
    const res = await call(env, '/admin/keys')
    expect(res.status).toBe(404)
    expect(await json(res)).toEqual({ success: false, error: 'Not found' })
    expect(env.KEY_STORAGE.store.has('external_auth_keys')).toBe(false)
  })

  it('PUT/DELETE/PATCH on admin API paths never reach the admin handlers', async () => {
    for (const method of ['PUT', 'DELETE', 'PATCH']) {
      const res = await call(env, '/api/update-training', { method, body: '{}' })
      expect(res.status).not.toBe(200)
    }
    expect(env.DB.calls).toHaveLength(0)
  })

  // Decision: authentication is checked before the method, so an
  // unauthenticated wrong-method request to a known admin path is a 401
  // (it reveals nothing about which methods the route supports).
  it('unauthenticated wrong-method requests on admin paths are 401, never the evaluation handler', async () => {
    for (const [method, path] of [
      ['GET', '/api/okta/sync'],
      ['POST', '/api/okta/groups'],
      ['POST', '/api/okta/users'],
      ['GET', '/api/update-training'],
      ['POST', '/admin'],
      ['DELETE', '/admin'],
      ['PUT', '/init-db'],
    ] as const) {
      const res = await call(env, path, { method, ...(method === 'GET' ? {} : { body: '{}' }) })
      expect(res.status, `${method} ${path}`).toBe(401)
      expect(await res.text()).not.toContain('Authentication failed')
    }
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(env.DB.calls).toHaveLength(0)
  })

  it('/init-db is matched exactly: /anything/init-db and /init-db/x are 404', async () => {
    for (const path of ['/anything/init-db', '/init-db/x', '/xinit-db', '/api/init-db']) {
      const res = await call(env, path, { method: 'POST', headers: await authedHeaders() })
      expect(res.status, path).toBe(404)
    }
    expect(env.DB.calls).toHaveLength(0)
  })
})

describe('admin endpoints work with a valid Access identity', () => {
  it('GET /admin and aliases return an HTML dashboard with strict CSP', async () => {
    for (const path of ['/admin', '/admin/', '/dashboard', '/dashboard/']) {
      const res = await call(env, path, { headers: await authedHeaders() })
      expect(res.status, path).toBe(200)
      expect(res.headers.get('content-type')).toContain('text/html')
      const csp = res.headers.get('content-security-policy')!
      expect(csp).not.toContain('unsafe-inline')
      expect(csp).not.toContain('unsafe-eval')
      expect(csp).toContain("frame-ancestors 'none'")
    }
  })

  it('the dashboard HTML does not contain any secret', async () => {
    const body = await (await call(env, '/admin', { headers: await authedHeaders() })).text()
    expect(body).not.toContain(env.OKTA_API_TOKEN)
    expect(body).not.toContain(env.ACCESS_APP_AUD)
    expect(body).not.toContain('RSA_PRIVATE_KEY')
  })

  it('POST /init-db initialises the schema for authenticated admins', async () => {
    const res = await call(env, '/init-db', { method: 'POST', headers: await authedHeaders() })
    expect(res.status).toBe(200)
    expect(await json(res)).toMatchObject({ success: true })
    expect(env.DB.status('alice')).toBe('not started') // data preserved
  })

  it('POST /api/update-training updates and returns the documented contract', async () => {
    const res = await call(env, '/api/update-training', postJson({ email: 'alice@example.com', status: 'completed' }, await authedHeaders()))
    expect(res.status).toBe(200)
    expect(await json(res)).toEqual({ success: true, message: 'Training status updated successfully' })
    expect(env.DB.status('alice')).toBe('completed')
  })

  it('GET /api/okta/groups and /api/okta/users return the documented shapes', async () => {
    const g = await call(env, '/api/okta/groups', { headers: await authedHeaders() })
    expect(await json(g)).toMatchObject({ success: true, groups: [], count: 0 })
    const u = await call(env, '/api/okta/users', { headers: await authedHeaders() })
    expect(await json(u)).toMatchObject({ success: true, count: 1 })
  })

  it('POST /api/okta/sync returns the documented sync shape', async () => {
    const res = await call(env, '/api/okta/sync', { method: 'POST', headers: await authedHeaders() })
    expect(res.status).toBe(200)
    expect(await json(res)).toMatchObject({
      success: true,
      oktaUsers: 1,
      results: { added: 0, updated: 0, removed: 0, skipped: 1, errors: [] },
    })
  })

  it('unhandled handler errors become a generic 500 JSON with no stack/secret leakage', async () => {
    env.DB.prepare = () => {
      throw new Error('SECRET internal detail')
    }
    // /init-db's handler swallows DB errors (500 via success=false); /keys path throws from KV instead.
    env.KEY_STORAGE.get = async () => {
      throw new Error('SECRET kv detail')
    }
    const res = await call(env, '/keys')
    expect(res.status).toBe(500)
    const text = await res.text()
    expect(JSON.parse(text)).toMatchObject({ success: false, error: 'Internal server error' })
    expect(text).not.toContain('SECRET')
  })
})

describe('admin authentication is cryptographically verified', () => {
  it('rejects an admin request whose Access JWT has an invalid signature, on every admin route', async () => {
    const headers = new Headers({ 'cf-access-jwt-assertion': unsignedJwt(accessClaims()) })
    for (const e of ADMIN_ENDPOINTS) {
      expect((await call(env, e.path, init(e, headers))).status, `${e.method} ${e.path}`).toBe(401)
    }
    expect(env.DB.calls).toHaveLength(0)
    expect(env.DB.status('alice')).toBe('not started')
  })

  it('rejects an admin request carrying an expired Access JWT', async () => {
    const headers = await authedHeaders({ exp: Math.floor(Date.now() / 1000) - 3600 })
    expect((await call(env, '/admin', { headers })).status).toBe(401)
  })

  it('rejects the forgeable CF-Access-Jwt-Payload header on every admin route', async () => {
    const payload = Buffer.from(JSON.stringify(accessClaims())).toString('base64')
    for (const e of ADMIN_ENDPOINTS) {
      const headers = new Headers({ 'CF-Access-Jwt-Payload': payload })
      expect((await call(env, e.path, init(e, headers))).status, `${e.method} ${e.path}`).toBe(401)
    }
    expect(env.DB.calls).toHaveLength(0)
    expect(b64urlJson).toBeDefined()
  })

  it('rejects a validly signed token from a foreign issuer', async () => {
    const headers = await authedHeaders({ iss: 'https://evil.example.com' })
    expect((await call(env, '/api/okta/users', { headers })).status).toBe(401)
  })
})

describe('server-side origin (CSRF) check on state-changing admin requests', () => {
  const evil = { origin: 'https://evil.example.com', 'sec-fetch-site': 'cross-site' }

  it('rejects a cross-origin POST to /api/update-training and changes nothing', async () => {
    const headers = await authedHeaders({}, evil)
    const res = await call(env, '/api/update-training', postJson({ email: 'alice@example.com', status: 'completed' }, headers))
    expect(res.status).toBe(403)
    expect(await json(res)).toMatchObject({ success: false, error: 'Forbidden' })
    expect(env.DB.status('alice')).toBe('not started')
    expect(env.DB.calls).toHaveLength(0)
  })

  it('rejects a cross-origin POST to /api/okta/sync without calling Okta', async () => {
    const headers = await authedHeaders({}, evil)
    const res = await call(env, '/api/okta/sync', { method: 'POST', headers })
    expect(res.status).toBe(403)
    // Only the Access key lookup used for authentication; Okta is never contacted.
    const urls = fetchSpy.mock.calls.map((c) => fetchUrl(c[0]))
    expect(urls.every((u) => u.endsWith('/cdn-cgi/access/certs'))).toBe(true)
    expect(urls.some((u) => u.includes('okta'))).toBe(false)
    expect(env.DB.calls).toHaveLength(0)
  })

  it('rejects a cross-origin POST to /init-db', async () => {
    const headers = await authedHeaders({}, evil)
    expect((await call(env, '/init-db', { method: 'POST', headers })).status).toBe(403)
    expect(env.DB.calls).toHaveLength(0)
  })

  it.each([
    ['null origin (sandboxed iframe / redirect)', { origin: 'null' }],
    ['look-alike host', { origin: 'https://admin.example.com.evil.example.com' }],
    ['http downgrade of the admin origin', { origin: 'http://admin.example.com' }],
    ['different port', { origin: 'https://admin.example.com:8443' }],
    ['same-site but not same-origin (no Origin header)', { 'sec-fetch-site': 'same-site' }],
    ['cross-site (no Origin header)', { 'sec-fetch-site': 'cross-site' }],
    ['a matching Origin does not override a hostile Sec-Fetch-Site-less cross origin', { origin: 'https://evil.example.com' }],
  ])('rejects: %s', async (_name, extra) => {
    const headers = await authedHeaders({}, extra)
    const res = await call(env, '/api/update-training', postJson({ email: 'alice@example.com', status: 'completed' }, headers))
    expect(res.status).toBe(403)
    expect(env.DB.status('alice')).toBe('not started')
  })

  it('checks authentication first: an unauthenticated cross-origin POST is a 401, not a 403', async () => {
    const res = await call(env, '/api/update-training', postJson({ email: 'alice@example.com', status: 'completed' }, new Headers(evil)))
    expect(res.status).toBe(401)
  })

  it('accepts a same-origin POST with a matching Origin (the dashboard)', async () => {
    const headers = await authedHeaders({}, { origin: 'https://admin.example.com', 'sec-fetch-site': 'same-origin' })
    const res = await call(env, '/api/update-training', postJson({ email: 'alice@example.com', status: 'started' }, headers))
    expect(res.status).toBe(200)
    expect(env.DB.status('alice')).toBe('started')
  })

  it('accepts the configured ADMIN_DOMAIN origin even when the request URL host differs', async () => {
    const headers = await authedHeaders({}, { origin: 'https://admin.example.com' })
    const res = await call(env, '/api/update-training', postJson({ email: 'alice@example.com', status: 'started' }, headers), 'https://internal.workers.test')
    expect(res.status).toBe(200)
  })

  it('accepts a same-origin POST that sends only Sec-Fetch-Site', async () => {
    const headers = await authedHeaders({}, { 'sec-fetch-site': 'same-origin' })
    expect((await call(env, '/api/okta/sync', { method: 'POST', headers })).status).toBe(200)
  })

  it('accepts non-browser clients that send neither header (not exposed to CSRF)', async () => {
    const res = await call(env, '/api/update-training', postJson({ email: 'alice@example.com', status: 'completed' }, await authedHeaders()))
    expect(res.status).toBe(200)
  })

  it('never blocks read-only admin requests, whatever the origin headers', async () => {
    const headers = await authedHeaders({}, evil)
    expect((await call(env, '/admin', { headers })).status).toBe(200)
    expect((await call(env, '/api/okta/users', { headers })).status).toBe(200)
  })
})

describe('exact routing, 404 and 405', () => {
  const ALLOW: Record<string, string> = {
    '/admin': 'GET',
    '/admin/': 'GET',
    '/dashboard': 'GET',
    '/dashboard/': 'GET',
    '/init-db': 'GET, POST',
    '/init-db/': 'GET, POST',
    '/api/update-training': 'POST',
    '/api/okta/sync': 'POST',
    '/api/okta/groups': 'GET',
    '/api/okta/users': 'GET',
  }

  it.each([
    ['GET', '/api/okta/sync'],
    ['POST', '/api/okta/groups'],
    ['POST', '/api/okta/users'],
    ['GET', '/api/update-training'],
    ['POST', '/admin'],
    ['DELETE', '/admin'],
    ['PUT', '/dashboard/'],
    ['DELETE', '/init-db/'],
  ])('authenticated %s %s => 405 with Allow, no side effects', async (method, path) => {
    const res = await call(env, path, { method, headers: await authedHeaders() })
    expect(res.status).toBe(405)
    expect(res.headers.get('allow')).toBe(ALLOW[path])
    expect(await json(res)).toMatchObject({ success: false })
    expect(res.headers.get('content-security-policy')).toContain("default-src 'self'")
    expect(res.headers.get('x-content-type-options')).toBe('nosniff')
    expect(env.DB.calls).toHaveLength(0)
    const urls = fetchSpy.mock.calls.map((c) => fetchUrl(c[0]))
    expect(urls.some((u) => u.includes('okta'))).toBe(false)
  })

  it('origin check runs before the method check (cross-origin wrong method => 403)', async () => {
    const headers = await authedHeaders({}, { origin: 'https://evil.example.com' })
    expect((await call(env, '/admin', { method: 'POST', headers })).status).toBe(403)
  })

  it.each([
    ['POST', '/keys', 'GET, HEAD'],
    ['DELETE', '/keys/', 'GET, HEAD'],
    ['PUT', '/', 'GET, HEAD, POST'],
    ['DELETE', '/', 'GET, HEAD, POST'],
  ])('%s %s => 405 Allow: %s', async (method, path, allow) => {
    const res = await call(env, path, { method })
    expect(res.status).toBe(405)
    expect(res.headers.get('allow')).toBe(allow)
    expect(res.headers.get('x-frame-options')).toBe('DENY')
  })

  it('POST /keys does not generate or rotate a key pair', async () => {
    await call(env, '/keys', { method: 'POST' })
    expect(env.KEY_STORAGE.store.has('external_auth_keys')).toBe(false)
  })

  it.each([
    ['GET', '/api/users'],
    ['POST', '/api/users'],
    ['GET', '/anything/at/all/keys'],
    ['DELETE', '/anything/at/all/keys'],
    ['POST', '/x/keys'],
    ['GET', '/admin/x'],
    ['GET', '/ADMIN'],
    ['GET', '/admin//'],
    ['POST', '/evaluate'],
    ['GET', '/constructor'],
    ['GET', '/__proto__'],
    ['POST', '//'],
  ])('unknown path %s %s => 404 JSON with security headers', async (method, path) => {
    const res = await call(env, path, { method, ...(method === 'POST' ? { body: '{}' } : {}) })
    expect(res.status).toBe(404)
    expect(res.headers.get('content-type')).toBe('application/json')
    expect(await json(res)).toEqual({ success: false, error: 'Not found' })
    expect(res.headers.get('content-security-policy')).toBeTruthy()
    expect(env.KEY_STORAGE.store.has('external_auth_keys')).toBe(false)
    expect(env.DB.calls).toHaveLength(0)
  })

  it('GET /keys/ (trailing slash) serves the JWKS like /keys', async () => {
    const a = await json(await call(env, '/keys'))
    const b = await json(await call(env, '/keys/'))
    expect(b).toEqual(a)
  })

  it('HEAD /keys and HEAD / mirror the GET status and headers with no body', async () => {
    for (const path of ['/keys', '/']) {
      const get = await call(env, path)
      const head = await call(env, path, { method: 'HEAD' })
      expect(head.status, path).toBe(get.status)
      expect(head.headers.get('content-type')).toBe(get.headers.get('content-type'))
      expect(head.headers.get('content-security-policy')).toBeTruthy()
      expect(await head.text()).toBe('')
    }
  })

  it('all admin aliases still route to the dashboard', async () => {
    for (const path of ['/admin', '/admin/', '/dashboard', '/dashboard/']) {
      expect((await call(env, path, { headers: await authedHeaders() })).status, path).toBe(200)
    }
  })

  it('GET/POST /init-db/ (trailing slash) is the authenticated init route', async () => {
    expect((await call(env, '/init-db/', { method: 'POST' })).status).toBe(401)
    expect((await call(env, '/init-db/', { method: 'POST', headers: await authedHeaders() })).status).toBe(200)
  })
})
