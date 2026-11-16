import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { syncOkta, updateTraining } from '../../ui/api'

const results = (over: Record<string, unknown> = {}) => ({
  added: 1,
  updated: 2,
  removed: 3,
  skipped: 4,
  errors: [],
  ...over,
})

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })

let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => {
  vi.unstubAllGlobals()
})

describe('updateTraining', () => {
  it('posts JSON and returns ok only for a server-confirmed success', async () => {
    fetchMock.mockResolvedValue(json({ success: true, message: 'ok' }))
    await expect(updateTraining('a@example.com', 'completed')).resolves.toEqual(
      { ok: true, data: null },
    )
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/update-training')
    expect(init.method).toBe('POST')
    expect(init.credentials).toBe('same-origin')
    expect(JSON.parse(init.body as string)).toEqual({
      email: 'a@example.com',
      status: 'completed',
    })
  })

  it.each([
    [400, 'Invalid request body'],
    [404, 'User not found or update failed'],
    [413, 'Request body too large'],
    [500, 'Internal error'],
  ])('surfaces the server message for HTTP %i', async (status, message) => {
    fetchMock.mockResolvedValue(json({ success: false, message }, status))
    await expect(updateTraining('a@example.com', 'started')).resolves.toEqual({
      ok: false,
      message,
    })
  })

  it('falls back to a generic message when the server sends none', async () => {
    fetchMock.mockResolvedValue(json({ success: false }, 400))
    await expect(updateTraining('a@example.com', 'started')).resolves.toEqual({
      ok: false,
      message: 'Request failed (HTTP 400).',
    })
  })

  it('treats HTTP 200 without success:true as a failure', async () => {
    fetchMock.mockResolvedValue(json({ message: 'maybe' }))
    const res = await updateTraining('a@example.com', 'started')
    expect(res.ok).toBe(false)
  })

  it('reports a non-JSON body without echoing it', async () => {
    fetchMock.mockResolvedValue(
      new Response('<html><script>alert(1)</script></html>', { status: 502 }),
    )
    const res = await updateTraining('a@example.com', 'started')
    expect(res).toEqual({
      ok: false,
      message: 'Unexpected non-JSON response (HTTP 502).',
    })
  })

  it('reports network errors', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'))
    const res = await updateTraining('a@example.com', 'started')
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.message).toMatch(/^Network error/)
  })
})

describe('syncOkta', () => {
  it('returns parsed results on success', async () => {
    fetchMock.mockResolvedValue(
      json({
        success: true,
        message: 'Sync done',
        results: results(),
        oktaUsers: 10,
      }),
    )
    const res = await syncOkta()
    expect(res).toEqual({
      ok: true,
      data: {
        message: 'Sync done',
        added: 1,
        updated: 2,
        removed: 3,
        skipped: 4,
        errors: [],
      },
    })
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/okta/sync')
    expect(init.method).toBe('POST')
    expect(init.body).toBeUndefined()
  })

  it('uses a default message when a successful response has none', async () => {
    fetchMock.mockResolvedValue(json({ success: true, results: results() }))
    const res = await syncOkta()
    expect(res.ok && res.data.message).toBe('Sync completed.')
  })

  it('surfaces HTTP 207 as a failure that carries the partial results', async () => {
    fetchMock.mockResolvedValue(
      json(
        {
          success: false,
          message: 'Sync completed with errors',
          results: results({ errors: ['user a: failed', 'user b: failed'] }),
        },
        207,
      ),
    )
    const res = await syncOkta()
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.message).toBe('Sync completed with errors')
    expect(res.partial).toEqual({
      message: 'Sync completed with errors',
      added: 1,
      updated: 2,
      removed: 3,
      skipped: 4,
      errors: ['user a: failed', 'user b: failed'],
    })
  })

  it('returns a plain failure for HTTP 500 without results', async () => {
    fetchMock.mockResolvedValue(
      json({ success: false, message: 'Sync failed' }, 500),
    )
    const res = await syncOkta()
    expect(res).toEqual({ ok: false, message: 'Sync failed' })
    expect('partial' in res).toBe(false)
  })

  it('does not treat malformed results on a failure as partial data', async () => {
    fetchMock.mockResolvedValue(
      json(
        { success: false, message: 'Sync failed', results: { added: 'x' } },
        500,
      ),
    )
    const res = await syncOkta()
    expect(res).toEqual({ ok: false, message: 'Sync failed' })
  })

  it('reports a non-JSON body without a partial result', async () => {
    fetchMock.mockResolvedValue(
      new Response('<h1>Bad gateway</h1>', { status: 502 }),
    )
    const res = await syncOkta()
    expect(res).toEqual({
      ok: false,
      message: 'Unexpected non-JSON response (HTTP 502).',
    })
  })

  it('reports network errors without a partial result', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'))
    const res = await syncOkta()
    expect(res.ok).toBe(false)
    expect('partial' in res).toBe(false)
  })

  it.each([
    ['missing results', undefined],
    ['null results', null],
    ['array results', []],
    ['missing count', { added: 1, updated: 1, removed: 1, errors: [] }],
    ['non-finite count', results({ added: null })],
    ['string count', results({ updated: '2' })],
    ['errors not an array', results({ errors: 'boom' })],
    ['non-string error entries', results({ errors: ['ok', 42] })],
  ])('rejects a successful response with %s', async (_name, bad) => {
    fetchMock.mockResolvedValue(
      json({ success: true, message: 'ok', results: bad }),
    )
    const res = await syncOkta()
    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.message).toMatch(/unexpected format/)
      expect(res.partial).toBeUndefined()
    }
  })

  it('keeps success:true with errors present as ok so errors are displayed', async () => {
    fetchMock.mockResolvedValue(
      json({
        success: true,
        message: 'Done',
        results: results({ errors: ['non-fatal warning'] }),
      }),
    )
    const res = await syncOkta()
    expect(res.ok).toBe(true)
    if (res.ok) expect(res.data.errors).toEqual(['non-fatal warning'])
  })

  it('truncates very long error strings', async () => {
    fetchMock.mockResolvedValue(
      json(
        {
          success: false,
          message: 'x',
          results: results({ errors: ['e'.repeat(5000)] }),
        },
        207,
      ),
    )
    const res = await syncOkta()
    if (res.ok || !res.partial) throw new Error('expected partial')
    expect(res.partial.errors[0]).toHaveLength(301)
  })

  it('never returns raw HTML from the server as a message', async () => {
    fetchMock.mockResolvedValue(
      new Response('<script>x</script>', {
        status: 500,
        headers: { 'Content-Type': 'text/html' },
      }),
    )
    const res = await syncOkta()
    expect(!res.ok && res.message).not.toContain('<script>')
  })
})
