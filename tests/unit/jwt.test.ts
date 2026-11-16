import { beforeEach, describe, expect, it, vi } from 'vitest'
import { parseJWT, signJWT, verifyToken } from '../../src/auth/jwt'
import { generateKeys, loadPublicKey } from '../../src/auth/keys'
import { clearAllCache } from '../../src/utils/cache'
import { createEnv, TEST_TEAM_DOMAIN } from '../helpers/env'
import {
  accessClaims,
  b64urlJson,
  generateTestKey,
  jwksFetch,
  nowSeconds,
  signTestJwt,
  type TestKey,
} from '../helpers/jwt'
import { fetchUrl } from '../helpers/okta'

let key: TestKey
beforeEach(async () => {
  key ??= await generateTestKey('access-kid-1')
  clearAllCache()
})

describe('parseJWT', () => {
  it('splits and decodes header/payload', () => {
    const token = `${b64urlJson({ alg: 'RS256', kid: 'k' })}.${b64urlJson({ a: 1 })}.sig`
    const jwt = parseJWT(token)
    expect(jwt.header).toMatchObject({ alg: 'RS256', kid: 'k' })
    expect(jwt.payload).toEqual({ a: 1 })
    expect(jwt.raw.signature).toBe('sig')
  })
  it('rejects tokens without exactly three parts', () => {
    expect(() => parseJWT('a.b')).toThrow('token must have 3 parts')
    expect(() => parseJWT('a.b.c.d')).toThrow('token must have 3 parts')
  })
  it('throws on non-JSON segments', () => {
    expect(() => parseJWT('e30.!!.sig')).toThrow()
  })
})

describe('verifyToken (Access public-key validation)', () => {
  it('accepts a correctly signed, unexpired token and returns claims', async () => {
    vi.stubGlobal('fetch', jwksFetch([key]))
    const token = await signTestJwt(key, accessClaims())
    const claims = await verifyToken(createEnv(), token)
    expect(claims.email).toBe('alice@example.com')
  })

  it('rejects a token signed by a different key with the same kid', async () => {
    vi.stubGlobal('fetch', jwksFetch([key]))
    const attacker = await generateTestKey(key.kid)
    const token = await signTestJwt(attacker, accessClaims())
    await expect(verifyToken(createEnv(), token)).rejects.toThrow('failed to verify token')
  })

  it('rejects a tampered payload (signature no longer matches)', async () => {
    vi.stubGlobal('fetch', jwksFetch([key]))
    const token = await signTestJwt(key, accessClaims({ email: 'alice@example.com' }))
    const [h, , s] = token.split('.')
    const forged = `${h}.${b64urlJson(accessClaims({ email: 'mallory@example.com' }))}.${s}`
    await expect(verifyToken(createEnv(), forged)).rejects.toThrow('failed to verify token')
  })

  it('rejects a tampered header', async () => {
    vi.stubGlobal('fetch', jwksFetch([key]))
    const token = await signTestJwt(key, accessClaims())
    const [, p, s] = token.split('.')
    const forged = `${b64urlJson({ alg: 'RS256', kid: key.kid, extra: 1 })}.${p}.${s}`
    await expect(verifyToken(createEnv(), forged)).rejects.toThrow('failed to verify token')
  })

  it('rejects alg=none style tokens (empty signature)', async () => {
    vi.stubGlobal('fetch', jwksFetch([key]))
    const token = `${b64urlJson({ alg: 'none', kid: key.kid })}.${b64urlJson(accessClaims())}.`
    await expect(verifyToken(createEnv(), token)).rejects.toThrow()
  })

  it('rejects an expired token', async () => {
    vi.stubGlobal('fetch', jwksFetch([key]))
    const token = await signTestJwt(key, accessClaims({ exp: nowSeconds() - 10 }))
    await expect(verifyToken(createEnv(), token)).rejects.toThrow('expired token')
  })

  it('rejects an unknown kid', async () => {
    vi.stubGlobal('fetch', jwksFetch([key]))
    const other = await generateTestKey('rotated-away')
    const token = await signTestJwt(other, accessClaims())
    await expect(verifyToken(createEnv(), token)).rejects.toThrow('Public key not found for kid')
  })

  it('rejects an invalid TEAM_DOMAIN configuration before fetching', async () => {
    const f = vi.fn()
    vi.stubGlobal('fetch', f)
    const token = await signTestJwt(key, accessClaims())
    await expect(verifyToken(createEnv({ TEAM_DOMAIN: 'nodots' }), token)).rejects.toThrow(
      'Invalid TEAM_DOMAIN configuration',
    )
    await expect(verifyToken(createEnv({ TEAM_DOMAIN: '' }), token)).rejects.toThrow()
    expect(f).not.toHaveBeenCalled()
  })

  it('fails closed when the certs endpoint errors', async () => {
    vi.stubGlobal('fetch', jwksFetch([key], 503))
    const token = await signTestJwt(key, accessClaims())
    await expect(verifyToken(createEnv(), token)).rejects.toThrow(/Failed to fetch Access public keys: 503/)
  })

  it('fetches certs only from the configured team domain over https and caches them', async () => {
    const f = vi.fn(jwksFetch([key]))
    vi.stubGlobal('fetch', f)
    const env = createEnv()
    const t = await signTestJwt(key, accessClaims())
    await verifyToken(env, t)
    await verifyToken(env, t)
    expect(f).toHaveBeenCalledTimes(1)
    expect(fetchUrl(f.mock.calls[0]![0])).toBe(`https://${TEST_TEAM_DOMAIN}/cdn-cgi/access/certs`)
  })

  // The External Evaluation token is minted by Access for *this* evaluator, but
  // verifyToken is the only validation performed on it.
  it('rejects a validly signed token without an exp claim', async () => {
    vi.stubGlobal('fetch', jwksFetch([key]))
    const c = { ...accessClaims() } as Record<string, unknown>
    delete c['exp']
    const token = await signTestJwt(key, c)
    await expect(verifyToken(createEnv(), token)).rejects.toThrow('expired token')
  })

  it('rejects a validly signed token with a non-numeric exp claim', async () => {
    vi.stubGlobal('fetch', jwksFetch([key]))
    const token = await signTestJwt(key, accessClaims({ exp: '9999999999' }))
    await expect(verifyToken(createEnv(), token)).rejects.toThrow('expired token')
  })

  it('does not compare iss (trust comes from our team keys); the admin gate pins it instead', async () => {
    vi.stubGlobal('fetch', jwksFetch([key]))
    const token = await signTestJwt(key, accessClaims({ iss: 'https://other-format.example.com' }))
    await expect(verifyToken(createEnv(), token)).resolves.toMatchObject({ email: 'alice@example.com' })
  })

  describe('issuer mismatch warning (External Evaluation, warnOnIssuerMismatch)', () => {
    const warnings = () =>
      vi
        .mocked(console.warn)
        .mock.calls.map((c) => fetchUrl(c[0]))
        .filter((m) => m.includes('Evaluation token issuer differs from TEAM_DOMAIN'))
    const allLogs = () =>
      JSON.stringify([
        ...vi.mocked(console.log).mock.calls,
        ...vi.mocked(console.warn).mock.calls,
        ...vi.mocked(console.error).mock.calls,
      ])

    it('warns once with sanitized issuer + expected value, but still verifies', async () => {
      vi.stubGlobal('fetch', jwksFetch([key]))
      const token = await signTestJwt(key, accessClaims({ iss: 'https://other-format.example.com/\nx' }))
      await expect(
        verifyToken(createEnv({ DEBUG: true }), token, { warnOnIssuerMismatch: true }),
      ).resolves.toMatchObject({ email: 'alice@example.com' })
      const w = warnings()
      expect(w).toHaveLength(1)
      const entry = JSON.parse(w[0]!)
      expect(entry).toMatchObject({
        level: 'WARN',
        issuer: 'https://other-format.example.com/ x',
        expected: `https://${TEST_TEAM_DOMAIN}`,
      })
      expect(allLogs()).not.toContain(token)
      expect(allLogs()).not.toContain(token.split('.')[1]!)
      expect(allLogs()).not.toContain(token.split('.')[2]!)
    })

    it('does not warn when iss equals https://TEAM_DOMAIN', async () => {
      vi.stubGlobal('fetch', jwksFetch([key]))
      const token = await signTestJwt(key, accessClaims())
      await verifyToken(createEnv(), token, { warnOnIssuerMismatch: true })
      expect(warnings()).toHaveLength(0)
    })

    it('does not warn when iss is absent', async () => {
      vi.stubGlobal('fetch', jwksFetch([key]))
      const c = { ...accessClaims() } as Record<string, unknown>
      delete c['iss']
      await expect(
        verifyToken(createEnv(), await signTestJwt(key, c), { warnOnIssuerMismatch: true }),
      ).resolves.toBeTruthy()
      expect(warnings()).toHaveLength(0)
    })

    it('does not warn by default (admin path pins iss itself)', async () => {
      vi.stubGlobal('fetch', jwksFetch([key]))
      const token = await signTestJwt(key, accessClaims({ iss: 'https://other.example.com' }))
      await verifyToken(createEnv(), token)
      expect(warnings()).toHaveLength(0)
    })

    it('never warns for a token that fails verification', async () => {
      vi.stubGlobal('fetch', jwksFetch([key]))
      const other = await generateTestKey(key.kid)
      const token = await signTestJwt(other, accessClaims({ iss: 'https://other.example.com' }))
      await expect(verifyToken(createEnv(), token, { warnOnIssuerMismatch: true })).rejects.toThrow()
      expect(warnings()).toHaveLength(0)
    })
  })

  it('rejects a token signed by another key even if it claims our issuer', async () => {
    vi.stubGlobal('fetch', jwksFetch([key]))
    const other = await generateTestKey(key.kid)
    const token = await signTestJwt(other, accessClaims())
    await expect(verifyToken(createEnv(), token)).rejects.toThrow('failed to verify token')
  })

  it('rejects a token whose header declares an algorithm other than RS256', async () => {
    vi.stubGlobal('fetch', jwksFetch([key]))
    for (const alg of ['HS256', 'none', 'RS512']) {
      const token = await signTestJwt(key, accessClaims(), { alg })
      await expect(verifyToken(createEnv(), token)).rejects.toThrow('unsupported token algorithm')
    }
  })
})

describe('key management + signJWT', () => {
  it.each([false, true])('never logs private key material when DEBUG=%s', async (DEBUG) => {
    const env = createEnv({ DEBUG })
    const { privateKey } = await generateKeys(env)
    const output = JSON.stringify([
      ...vi.mocked(console.log).mock.calls,
      ...vi.mocked(console.warn).mock.calls,
      ...vi.mocked(console.error).mock.calls,
    ])
    for (const field of ['d', 'p', 'q', 'dp', 'dq', 'qi'] as const) {
      expect(privateKey[field]).toBeTruthy()
      expect(output).not.toContain(privateKey[field])
    }
    expect(output).not.toContain(JSON.stringify(privateKey))
    expect(output).not.toContain('Private key JWK:')
    expect(JSON.stringify([...env.KEY_STORAGE.store.values()])).not.toContain(privateKey.d)
  })

  it('loadPublicKey generates and stores a keypair once, then reuses it', async () => {
    const env = createEnv()
    const first = await loadPublicKey(env)
    const second = await loadPublicKey(env)
    expect(first.kid).toBe(second.kid)
    expect(first.kty).toBe('RSA')
    expect(first).not.toHaveProperty('d') // never leak private material
    const stored = JSON.parse(env.KEY_STORAGE.store.get('external_auth_keys')!)
    expect(stored.kid).toBe(first.kid)
    expect(JSON.stringify(stored)).not.toContain('"d"')
  })

  it('signJWT output verifies against the published public key (RS256)', async () => {
    const env = createEnv()
    const { privateKey } = await generateKeys(env)
    env.RSA_PRIVATE_KEY = JSON.stringify(privateKey)
    const payload = { success: true, iat: 1, exp: 2, nonce: 'abc' }
    const token = await signJWT(env, payload)

    const jwt = parseJWT(token)
    expect(jwt.header.alg).toBe('RS256')
    const published = await loadPublicKey(env)
    expect(jwt.header.kid).toBe(published.kid)
    expect(jwt.payload).toEqual(payload)

    const pub = await crypto.subtle.importKey(
      'jwk',
      published,
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['verify'],
    )
    const ok = await crypto.subtle.verify(
      'RSASSA-PKCS1-v1_5',
      pub,
      Buffer.from(jwt.raw.signature, 'base64url'),
      new TextEncoder().encode(`${jwt.raw.header}.${jwt.raw.payload}`),
    )
    expect(ok).toBe(true)
  })

  it('signJWT refuses to sign without a key set in KV', async () => {
    const env = createEnv({ RSA_PRIVATE_KEY: '{}' })
    await expect(signJWT(env, {})).rejects.toThrow('cannot find signing key')
  })

  it('signJWT refuses to sign without the private-key secret', async () => {
    const env = createEnv({ RSA_PRIVATE_KEY: '' })
    await loadPublicKey(env)
    await expect(signJWT(env, {})).rejects.toThrow('RSA_PRIVATE_KEY secret not set')
  })

  it('signJWT rejects a malformed or mismatched-format secret', async () => {
    const env = createEnv({ RSA_PRIVATE_KEY: 'not json' })
    await loadPublicKey(env)
    await expect(signJWT(env, {})).rejects.toThrow('invalid RSA_PRIVATE_KEY secret format')
  })

  it('generateKeys fails cleanly if KV write fails', async () => {
    const env = createEnv()
    env.KEY_STORAGE.put = async () => {
      throw new Error('kv down')
    }
    await expect(generateKeys(env)).rejects.toThrow('failed to generate keyset')
  })
})
