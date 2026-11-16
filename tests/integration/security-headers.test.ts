import { beforeEach, describe, expect, it } from 'vitest'
import { createUnauthorizedHtmlResponse, createUnauthorizedResponse } from '../../src/auth/admin'
import { createCrossOriginResponse } from '../../src/auth/origin'
import { handleSystemOverview, handleWebInterface } from '../../src/handlers/web'
import { createEnv, type TestEnv } from '../helpers/env'
import { authedHeaders, stubFetchWithAccess } from '../helpers/access'
import { jsonResponse } from '../helpers/okta'
import { call, postJson } from '../helpers/worker'

/** Parse a CSP header into directive -> values. */
const directives = (header: string) =>
  Object.fromEntries(
    header.split('; ').map((d) => {
      const [name, ...values] = d.split(' ')
      return [name, values]
    }),
  ) as Record<string, string[]>

/**
 * Assert every inline <script>/<style> element carries a nonce that the CSP
 * allows for that element type, and that no inline event handlers / external
 * script sources bypass the policy.
 */
async function expectAllInlineContentNonced(res: Response) {
  const csp = res.headers.get('content-security-policy')
  expect(csp).toBeTruthy()
  const d = directives(csp!)
  const html = await res.text()

  const tags = [...html.matchAll(/<(script|style)\b([^>]*)>/gi)]
  expect(tags.length).toBeGreaterThan(0)
  for (const [tag, kind, attrs] of tags) {
    const nonce = /\bnonce="([^"]+)"/.exec(attrs!)?.[1]
    expect(nonce, `missing nonce on ${tag}`).toBeTruthy()
    const allowed = kind!.toLowerCase() === 'script' ? d['script-src'] : d['style-src']
    expect(allowed, `${kind} nonce not in CSP`).toContain(`'nonce-${nonce}'`)
    expect(attrs).not.toMatch(/\bsrc=/)
  }
  // No inline handlers (blocked by a nonce-based CSP) and no style attributes.
  expect(html).not.toMatch(/\son[a-z]+\s*=/i)
  expect(html).not.toMatch(/\sstyle\s*=/i)
  for (const directive of ['script-src', 'style-src']) {
    expect(d[directive]).not.toContain("'unsafe-inline'")
    expect(d[directive]).not.toContain("'unsafe-eval'")
  }
  return html
}

const expectSecurityHeaders = (res: Response) => {
  expect(res.headers.get('content-security-policy'), 'CSP').toContain("frame-ancestors 'none'")
  expect(res.headers.get('x-content-type-options')).toBe('nosniff')
  expect(res.headers.get('x-frame-options')).toBe('DENY')
  expect(res.headers.get('referrer-policy')).toBe('strict-origin-when-cross-origin')
  expect(res.headers.get('permissions-policy')).toContain('camera=()')
}

let env: TestEnv
beforeEach(async () => {
  env = createEnv()
  env.DB.seed('alice', 'not started', 'Alice', 'alice@example.com')
  await stubFetchWithAccess((url) => {
    if (url.includes('/api/v1/users')) return jsonResponse([])
    if (url.includes('/api/v1/groups')) return jsonResponse([])
    throw new Error(`unexpected ${url}`)
  })
})

describe('every HTML response nonces all of its inline scripts and styles', () => {
  it('401 HTML page (unauthenticated /admin)', async () => {
    const res = await call(env, '/admin')
    expect(res.status).toBe(401)
    expectSecurityHeaders(res)
    await expectAllInlineContentNonced(res)
  })

  it('createUnauthorizedHtmlResponse uses fresh nonces per response', async () => {
    const a = createUnauthorizedHtmlResponse(env).headers.get('content-security-policy')
    const b = createUnauthorizedHtmlResponse(env).headers.get('content-security-policy')
    expect(a).not.toBe(b)
  })

  it('system overview (GET /)', async () => {
    const res = await call(env, '/')
    expectSecurityHeaders(res)
    await expectAllInlineContentNonced(res)
  })

  it('admin dashboard (authenticated GET /admin)', async () => {
    const res = await call(env, '/admin', { headers: await authedHeaders() })
    expect(res.status).toBe(200)
    expectSecurityHeaders(res)
    await expectAllInlineContentNonced(res)
  })

  it('direct handler output (handleWebInterface / handleSystemOverview)', async () => {
    await expectAllInlineContentNonced(await handleWebInterface(env))
    await expectAllInlineContentNonced(handleSystemOverview(env))
  })
})

describe('the dashboard does not leak nonces or debug headers', () => {
  it('sends no x-content-version / x-script-nonce / x-style-nonce headers', async () => {
    const res = await call(env, '/admin', { headers: await authedHeaders() })
    for (const h of ['x-content-version', 'x-script-nonce', 'x-style-nonce']) {
      expect(res.headers.has(h), h).toBe(false)
    }
    for (const [name] of res.headers) expect(name).not.toMatch(/nonce/i)
    expect(res.headers.get('cache-control')).toContain('no-store')
  })
})

describe('non-HTML responses carry the security headers', () => {
  const cases: Array<[string, () => Promise<Response>]> = [
    ['401 JSON (unauthenticated API)', () => call(env, '/api/okta/users')],
    ['401 JSON (unauthenticated /init-db)', () => call(env, '/init-db', { method: 'POST' })],
    [
      '403 cross-origin',
      async () =>
        call(env, '/api/update-training', postJson({ email: 'alice@example.com', status: 'completed' }, await authedHeaders({}, { origin: 'https://evil.example.com' }))),
    ],
    ['404 unknown path', () => call(env, '/nope')],
    ['405 wrong method (public)', () => call(env, '/keys', { method: 'POST' })],
    ['405 wrong method (admin)', async () => call(env, '/admin', { method: 'DELETE', headers: await authedHeaders() })],
    ['GET /keys', () => call(env, '/keys')],
    ['POST /init-db', async () => call(env, '/init-db', { method: 'POST', headers: await authedHeaders() })],
    [
      'POST /api/update-training (200)',
      async () => call(env, '/api/update-training', postJson({ email: 'alice@example.com', status: 'completed' }, await authedHeaders())),
    ],
    ['POST /api/update-training (400)', async () => call(env, '/api/update-training', postJson('{bad', await authedHeaders()))],
    ['POST / evaluation failure (403)', () => call(env, '/', postJson({}))],
  ]

  it.each(cases)('%s', async (_name, run) => {
    expectSecurityHeaders(await run())
  })

  it('response factories take env and add the headers', () => {
    expectSecurityHeaders(createUnauthorizedResponse(env))
    expectSecurityHeaders(createUnauthorizedHtmlResponse(env))
    expectSecurityHeaders(createCrossOriginResponse(env))
  })

  it("DEBUG='true' does not relax the CSP on any route", async () => {
    const dbg = createEnv({ DEBUG: 'true' as unknown as boolean })
    for (const res of [await call(dbg, '/'), await call(dbg, '/admin'), await call(dbg, '/nope')]) {
      expect(res.headers.get('content-security-policy')).not.toContain('unsafe-inline')
    }
  })
})
