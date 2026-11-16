import { describe, expect, it } from 'vitest'
import {
  CSP_CONFIG,
  addCSPHeaders,
  buildCSPHeader,
  createCSPHeaders,
  generateNonce,
  getCSPConfig,
} from '../../src/security/csp'
import { createEnv } from '../helpers/env'
import { isDebugEnabled } from '../../src/utils/env'

const directives = (header: string) =>
  Object.fromEntries(
    header.split('; ').map((d) => {
      const [name, ...values] = d.split(' ')
      return [name, values]
    }),
  ) as Record<string, string[]>

describe('generateNonce', () => {
  it('produces 16 random bytes, base64 encoded, unique per call', () => {
    const nonces = new Set(Array.from({ length: 50 }, generateNonce))
    expect(nonces.size).toBe(50)
    for (const n of nonces) {
      expect(n).toMatch(/^[A-Za-z0-9+/]{22}==$/)
      expect(Buffer.from(n, 'base64')).toHaveLength(16)
    }
  })
})

describe('production (strict) policy', () => {
  const env = createEnv({ DEBUG: false })
  const header = createCSPHeaders(env, ['abc', 'def'], 'sty')['Content-Security-Policy']!
  const d = directives(header)

  it('has no unsafe-inline / unsafe-eval anywhere', () => {
    expect(header).not.toContain('unsafe-inline')
    expect(header).not.toContain('unsafe-eval')
  })
  it('locks down framing, base-uri, objects and form targets', () => {
    expect(d['frame-ancestors']).toEqual(["'none'"])
    expect(d['object-src']).toEqual(["'none'"])
    expect(d['base-uri']).toEqual(["'self'"])
    expect(d['form-action']).toEqual(["'self'"])
    expect(d['default-src']).toEqual(["'self'"])
    expect(d['connect-src']).toEqual(["'self'"])
  })
  it('adds every script nonce and the style nonce', () => {
    expect(d['script-src']).toEqual(["'self'", "'nonce-abc'", "'nonce-def'"])
    expect(d['style-src']).toEqual(["'self'", "'nonce-sty'"])
  })
  it('emits boolean directives without values', () => {
    expect(d['upgrade-insecure-requests']).toEqual([])
    expect(d['block-all-mixed-content']).toEqual([])
  })
  it('does not mutate the shared config when adding nonces', () => {
    expect(CSP_CONFIG.strict['script-src']).toEqual(["'self'"])
  })
})

describe('buildCSPHeader', () => {
  it('accepts a single nonce string', () => {
    const h = buildCSPHeader(CSP_CONFIG.strict, 'one', null)
    expect(directives(h)['script-src']).toContain("'nonce-one'")
  })
  it('omits nonces when none provided', () => {
    expect(buildCSPHeader(CSP_CONFIG.strict)).not.toContain('nonce-')
  })
})

describe('security headers', () => {
  it('sets the standard hardening headers', () => {
    const h = createCSPHeaders(createEnv())
    expect(h['X-Content-Type-Options']).toBe('nosniff')
    expect(h['X-Frame-Options']).toBe('DENY')
    expect(h['Referrer-Policy']).toBe('strict-origin-when-cross-origin')
    expect(h['Permissions-Policy']).toContain('camera=()')
  })
  it('addCSPHeaders preserves status/body and overrides conflicting headers', async () => {
    const res = addCSPHeaders(
      new Response('body', { status: 201, headers: { 'x-frame-options': 'ALLOWALL', 'x-keep': '1' } }),
      createEnv(),
      'n1',
      's1',
    )
    expect(res.status).toBe(201)
    expect(await res.text()).toBe('body')
    expect(res.headers.get('x-keep')).toBe('1')
    expect(res.headers.get('x-frame-options')).toBe('DENY')
    expect(res.headers.get('content-security-policy')).toContain("'nonce-n1'")
  })
})

describe('DEBUG never relaxes the CSP', () => {
  // Project guidance: keep the strict CSP, no relaxed debugging settings.
  it.each([true, 'true', 'TRUE', '1', 'yes', 'on', false, 'false', '', '0', undefined])(
    'DEBUG=%j keeps the strict policy (no unsafe-inline)',
    (DEBUG) => {
      const env = createEnv({ DEBUG: DEBUG as boolean })
      expect(getCSPConfig(env)).toBe(CSP_CONFIG.strict)
      const h = createCSPHeaders(env)['Content-Security-Policy']!
      expect(h).not.toContain('unsafe-inline')
      expect(h).not.toContain('unsafe-eval')
    },
  )

  it("the string 'false' does not enable debug nor loosen the CSP", () => {
    const env = createEnv({ DEBUG: 'false' as unknown as boolean })
    expect(isDebugEnabled(env)).toBe(false)
    expect(createCSPHeaders(env)['Content-Security-Policy']).toBe(
      createCSPHeaders(createEnv({ DEBUG: false }))['Content-Security-Policy'],
    )
  })
})

describe('no policy ever allows inline script/style without a nonce', () => {
  it.each(Object.entries(CSP_CONFIG))('%s policy: script-src/style-src have no unsafe-*', (_name, config) => {
    const d = directives(buildCSPHeader(config))
    for (const directive of ['script-src', 'style-src', 'default-src']) {
      expect(d[directive]).toBeDefined()
      expect(d[directive]).not.toContain("'unsafe-inline'")
      expect(d[directive]).not.toContain("'unsafe-eval'")
    }
  })
})

describe('ENVIRONMENT=development (plain-http local dev only)', () => {
  const dev = createEnv({ ENVIRONMENT: 'development' })

  it('selects the development policy only for the exact value', () => {
    expect(getCSPConfig(dev)).toBe(CSP_CONFIG.development)
    for (const ENVIRONMENT of ['Development', 'dev', 'production', '', ' development']) {
      expect(getCSPConfig(createEnv({ ENVIRONMENT }))).toBe(CSP_CONFIG.strict)
    }
  })

  it('drops only upgrade-insecure-requests / block-all-mixed-content', () => {
    const devHeader = createCSPHeaders(dev, 'n', 's')['Content-Security-Policy']!
    const strictHeader = createCSPHeaders(createEnv(), 'n', 's')['Content-Security-Policy']!
    expect(devHeader).not.toContain('upgrade-insecure-requests')
    expect(devHeader).not.toContain('block-all-mixed-content')
    expect(devHeader).not.toContain('unsafe-inline')
    const strip = (h: string) =>
      h.split('; ').filter((x) => x !== 'upgrade-insecure-requests' && x !== 'block-all-mixed-content')
    expect(strip(devHeader)).toEqual(strip(strictHeader))
  })
})
