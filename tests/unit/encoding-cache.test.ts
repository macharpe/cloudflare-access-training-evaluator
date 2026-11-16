import { describe, expect, it, vi } from 'vitest'
import { asciiToUint8Array, base64url } from '../../src/utils/encoding'
import {
  cachedFetch,
  clearCache,
  getCacheStats,
  getCached,
  setCache,
} from '../../src/utils/cache'

describe('base64url', () => {
  it('round-trips all byte values without padding or +/ characters', () => {
    const bytes = Uint8Array.from({ length: 256 }, (_, i) => i)
    const enc = base64url.stringify(bytes)
    expect(enc).not.toMatch(/[+/=]/)
    expect(Array.from(base64url.parse(enc))).toEqual(Array.from(bytes))
  })
  it('matches Node base64url output', () => {
    const bytes = new TextEncoder().encode('{"alg":"RS256"}??>>')
    expect(base64url.stringify(bytes)).toBe(Buffer.from(bytes).toString('base64url'))
  })
  it('asciiToUint8Array maps char codes', () => {
    expect(Array.from(asciiToUint8Array('AB'))).toEqual([65, 66])
  })
})

describe('memory cache', () => {
  it('returns values until TTL elapses, then evicts', () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(1_000_000)
    setCache('k', { a: 1 }, 10)
    expect(getCached('k')).toEqual({ a: 1 })
    vi.setSystemTime(1_000_000 + 9_999)
    expect(getCached('k')).toEqual({ a: 1 })
    vi.setSystemTime(1_000_000 + 10_001)
    expect(getCached('k')).toBeNull()
    expect(getCacheStats().total).toBe(0)
  })
  it('clearCache removes a single key', () => {
    setCache('a', 1, 60)
    setCache('b', 2, 60)
    clearCache('a')
    expect(getCached('a')).toBeNull()
    expect(getCached('b')).toBe(2)
  })
})

describe('cachedFetch', () => {
  it('caches successful responses and serves hits without refetching', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ n: 1 }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const first = await cachedFetch<{ n: number }>('https://x.test/a', {}, 'ck', 60)
    expect(await first.json()).toEqual({ n: 1 })
    const second = await cachedFetch<{ n: number }>('https://x.test/a', {}, 'ck', 60)
    expect(await second.json()).toEqual({ n: 1 })
    expect(second.headers.get('x-cache')).toBe('HIT')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
  it('never caches error responses', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('boom', { status: 500 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: 1 }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const bad = await cachedFetch('https://x.test/a', {}, 'ck2', 60)
    expect(bad.ok).toBe(false)
    expect(getCached('ck2')).toBeNull()
    const good = await cachedFetch('https://x.test/a', {}, 'ck2', 60)
    expect(good.ok).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})
