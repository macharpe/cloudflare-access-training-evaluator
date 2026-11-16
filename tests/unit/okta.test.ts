import { describe, expect, it, vi } from 'vitest'
import {
  fetchOktaDirectory,
  fetchOktaGroupUsers,
  fetchOktaGroups,
  fetchOktaPages,
  fetchOktaUsers,
  parseNextLink,
  syncUsersToDatabase,
  type ProcessedUser,
} from '../../src/integrations/okta'
import { CACHE_CONFIG, getCached } from '../../src/utils/cache'
import { createEnv, TEST_OKTA_DOMAIN } from '../helpers/env'
import type { TestD1 } from '../helpers/d1'
import { fetchUrl, jsonResponse, nextLink, OKTA_BASE, oktaCalls, oktaUser, stubFetch } from '../helpers/okta'

const USERS_URL = `${OKTA_BASE}/api/v1/users?limit=200`
const page = (n: number) => `${OKTA_BASE}/api/v1/users?after=p${n}&limit=200`

describe('parseNextLink', () => {
  it('returns null for missing/last-page headers', () => {
    expect(parseNextLink(null)).toBeNull()
    expect(parseNextLink('')).toBeNull()
    expect(parseNextLink('<https://a.test/x>; rel="self"')).toBeNull()
  })
  it('extracts rel="next" among multiple links, regardless of order/case', () => {
    expect(parseNextLink('<https://a.test/self>; rel="self", <https://a.test/next>; rel="next"')).toBe('https://a.test/next')
    expect(parseNextLink('<https://a.test/next>;rel="NEXT"')).toBe('https://a.test/next')
  })
})

describe('fetchOktaPages — pagination', () => {
  it('follows Link rel=next across pages and concatenates in order', async () => {
    const env = createEnv()
    const spy = stubFetch((url) => {
      if (url === USERS_URL) return jsonResponse([1, 2], { link: nextLink(page(2)) })
      if (url === page(2)) return jsonResponse([3, 4], { link: nextLink(page(3)) })
      if (url === page(3)) return jsonResponse([5])
      throw new Error(`unexpected ${url}`)
    })
    expect(await fetchOktaPages<number>(env, USERS_URL)).toEqual([1, 2, 3, 4, 5])
    expect(oktaCalls(spy)).toHaveLength(3)
  })

  it('handles multiple Link headers (self + next)', async () => {
    const env = createEnv()
    stubFetch((url) =>
      url === USERS_URL
        ? jsonResponse([1], { link: [`<${USERS_URL}>; rel="self"`, nextLink(page(2))] })
        : jsonResponse([2]),
    )
    expect(await fetchOktaPages<number>(env, USERS_URL)).toEqual([1, 2])
  })

  it('sends the SSWS token on every page', async () => {
    const env = createEnv()
    const spy = stubFetch((url) =>
      url === USERS_URL ? jsonResponse([1], { link: nextLink(page(2)) }) : jsonResponse([2]),
    )
    await fetchOktaPages(env, USERS_URL)
    for (const [, init] of oktaCalls(spy)) {
      expect((init!.headers as Record<string, string>)['Authorization']).toBe('SSWS test-okta-token')
    }
  })

  it('throws if a later page fails — never returns the partial list', async () => {
    const env = createEnv()
    stubFetch((url) =>
      url === USERS_URL ? jsonResponse([1, 2], { link: nextLink(page(2)) }) : jsonResponse({ errorCode: 'E0000047' }, { status: 429 }),
    )
    await expect(fetchOktaPages(env, USERS_URL)).rejects.toThrow('Okta API error: 429')
  })

  it.each([401, 403, 500, 503])('throws on first-page HTTP %i', async (status) => {
    stubFetch(() => jsonResponse({}, { status }))
    await expect(fetchOktaPages(createEnv(), USERS_URL)).rejects.toThrow(`Okta API error: ${status}`)
  })

  it.each([
    ['object', { errorCode: 'x' }],
    ['null', null],
    ['string', 'nope'],
  ])('throws when a page is a JSON %s rather than an array', async (_n, body) => {
    stubFetch(() => jsonResponse(body))
    await expect(fetchOktaPages(createEnv(), USERS_URL)).rejects.toThrow('unexpected response shape')
  })

  it('throws when the second page has an unexpected shape', async () => {
    stubFetch((url) =>
      url === USERS_URL ? jsonResponse([1], { link: nextLink(page(2)) }) : jsonResponse({ oops: true }),
    )
    await expect(fetchOktaPages(createEnv(), USERS_URL)).rejects.toThrow('unexpected response shape')
  })

  it('propagates network errors', async () => {
    stubFetch(() => {
      throw new TypeError('network down')
    })
    await expect(fetchOktaPages(createEnv(), USERS_URL)).rejects.toThrow('network down')
  })

  it('allows exactly 50 pages but refuses a 51st (cap) instead of truncating', async () => {
    const env = createEnv()
    const serve = (total: number) =>
      stubFetch((url) => {
        const n = url === USERS_URL ? 1 : Number(new URL(url).searchParams.get('after')!.slice(1))
        return jsonResponse([n], { link: n < total ? nextLink(page(n + 1)) : undefined })
      })
    serve(50)
    expect(await fetchOktaPages<number>(env, USERS_URL)).toHaveLength(50)
    serve(51)
    await expect(fetchOktaPages(env, USERS_URL)).rejects.toThrow(/exceeded 50 pages/)
  })

  describe('credentials are never sent off-origin', () => {
    it.each([
      ['another host', 'https://evil.example.com/api/v1/users?after=2'],
      ['a lookalike suffix host', `https://${TEST_OKTA_DOMAIN}.evil.com/api/v1/users`],
      ['a lookalike prefix host', `https://evil-${TEST_OKTA_DOMAIN}/api/v1/users`],
      ['a userinfo trick', `https://${TEST_OKTA_DOMAIN}@evil.example.com/x`],
      ['plain http', `http://${TEST_OKTA_DOMAIN}/api/v1/users?after=2`],
      ['a non-http scheme', 'ftp://example.okta.com/x'],
    ])('rejects a next link pointing to %s and never requests it', async (_n, bad) => {
      const spy = stubFetch((url) =>
        url === USERS_URL ? jsonResponse([1], { link: nextLink(bad) }) : jsonResponse([2]),
      )
      await expect(fetchOktaPages(createEnv(), USERS_URL)).rejects.toThrow('unexpected host')
      expect(oktaCalls(spy).map(([u]) => fetchUrl(u))).toEqual([USERS_URL])
    })

    it('rejects a malformed next link URL', async () => {
      stubFetch(() => jsonResponse([1], { link: nextLink('not a url') }))
      await expect(fetchOktaPages(createEnv(), USERS_URL)).rejects.toThrow()
    })

    it('accepts a host that differs only in case', async () => {
      stubFetch((url) =>
        url === USERS_URL
          ? jsonResponse([1], { link: nextLink(`https://${TEST_OKTA_DOMAIN.toUpperCase()}/api/v1/users?after=2`) })
          : jsonResponse([2]),
      )
      expect(await fetchOktaPages(createEnv(), USERS_URL)).toEqual([1, 2])
    })

    it('validates the first URL too', async () => {
      const spy = stubFetch(() => jsonResponse([]))
      await expect(fetchOktaPages(createEnv(), 'https://evil.example.com/api/v1/users')).rejects.toThrow('unexpected host')
      expect(spy).not.toHaveBeenCalled()
    })

    it('rejects a next link on a different port of the same host (different origin)', async () => {
      const spy = stubFetch((url) =>
        url === USERS_URL
          ? jsonResponse([1], { link: nextLink(`https://${TEST_OKTA_DOMAIN}:8443/api/v1/users?after=2`) })
          : jsonResponse([2]),
      )
      await expect(fetchOktaPages(createEnv(), USERS_URL)).rejects.toThrow('unexpected host')
      expect(oktaCalls(spy)).toHaveLength(1)
    })

    it('rejects embedded credentials even on the right host', async () => {
      const spy = stubFetch((url) =>
        url === USERS_URL
          ? jsonResponse([1], { link: nextLink(`https://user:pw@${TEST_OKTA_DOMAIN}/api/v1/users?after=2`) })
          : jsonResponse([2]),
      )
      await expect(fetchOktaPages(createEnv(), USERS_URL)).rejects.toThrow('unexpected host')
      expect(oktaCalls(spy)).toHaveLength(1)
    })

    it('accepts an explicit default port (:443) as the same origin', async () => {
      stubFetch((url) =>
        url === USERS_URL
          ? jsonResponse([1], { link: nextLink(`https://${TEST_OKTA_DOMAIN}:443/api/v1/users?after=2`) })
          : jsonResponse([2]),
      )
      expect(await fetchOktaPages(createEnv(), USERS_URL)).toEqual([1, 2])
    })

    it('never follows redirects, so the SSWS token cannot be re-sent elsewhere', async () => {
      const spy = stubFetch(() => jsonResponse([1]))
      await fetchOktaPages(createEnv(), USERS_URL)
      // The Workers runtime only accepts 'follow' | 'manual'; 'error' throws at fetch time
      // in production (it was missed once because Node fetch stubs accept anything).
      for (const [, init] of oktaCalls(spy)) expect(init!.redirect).toBe('manual')
    })

    it.each([301, 302, 307, 308])('rejects a %i redirect instead of following it', async (status) => {
      const spy = stubFetch(() => new Response(null, { status, headers: { location: 'https://evil.example.com/steal' } }))
      await expect(fetchOktaPages(createEnv(), USERS_URL)).rejects.toThrow('redirected')
      expect(oktaCalls(spy)).toHaveLength(1) // never contacted the redirect target
    })

    it('only uses RequestInit values the Workers runtime supports', async () => {
      const spy = stubFetch(() => jsonResponse([1]))
      await fetchOktaPages(createEnv(), USERS_URL)
      for (const [, init] of oktaCalls(spy)) expect(['follow', 'manual']).toContain(init!.redirect)
    })
  })
})

describe('fetchOktaUsers', () => {
  const env = () => createEnv()

  it('requires Okta configuration and a valid domain', async () => {
    const spy = stubFetch(() => jsonResponse([]))
    await expect(fetchOktaUsers(createEnv({ OKTA_API_TOKEN: '' }))).rejects.toThrow('Okta configuration missing')
    await expect(fetchOktaUsers(createEnv({ OKTA_DOMAIN: '' }))).rejects.toThrow('Okta configuration missing')
    await expect(fetchOktaUsers(createEnv({ OKTA_DOMAIN: 'evil.com/x' }))).rejects.toThrow('Invalid OKTA_DOMAIN format')
    expect(spy).not.toHaveBeenCalled()
  })

  it('aggregates all pages and maps profile fields', async () => {
    stubFetch((url) =>
      url === USERS_URL
        ? jsonResponse([oktaUser('Alice@Example.com', 'Alice')], { link: nextLink(page(2)) })
        : jsonResponse([oktaUser('bob@example.com', 'Bob', { status: 'SUSPENDED' })]),
    )
    const users = await fetchOktaUsers(env())
    expect(users.map((u) => u.username)).toEqual(['alice', 'bob'])
    expect(users[0]).toMatchObject({ email: 'Alice@Example.com', firstName: 'Alice', status: 'ACTIVE' })
    expect(users[1]!.status).toBe('SUSPENDED')
  })

  it('drops users with unusable logins instead of failing the whole fetch', async () => {
    stubFetch(() =>
      jsonResponse([oktaUser('ok@example.com'), oktaUser('not-an-email'), oktaUser('bad+tag@example.com')]),
    )
    expect((await fetchOktaUsers(env())).map((u) => u.username)).toEqual(['ok'])
  })

  it('fetchOktaDirectory reports unusable logins (lower-cased) instead of silently dropping them', async () => {
    stubFetch(() =>
      jsonResponse([oktaUser('ok@example.com'), oktaUser('Legacy+Alias@Example.com'), oktaUser('not-an-email')]),
    )
    const dir = await fetchOktaDirectory(env())
    expect(dir.users.map((u) => u.username)).toEqual(['ok'])
    expect(dir.invalidLogins).toEqual(['legacy+alias@example.com', 'not-an-email'])
  })

  it('fetchOktaDirectory({ fresh: true }) bypasses the cache read and refreshes the cache', async () => {
    let n = 0
    const spy = stubFetch(() => jsonResponse([oktaUser(n++ === 0 ? 'old@example.com' : 'new@example.com')]))
    expect((await fetchOktaDirectory(env())).users.map((u) => u.username)).toEqual(['old'])
    expect((await fetchOktaDirectory(env())).users.map((u) => u.username)).toEqual(['old']) // cached
    expect((await fetchOktaDirectory(env(), { fresh: true })).users.map((u) => u.username)).toEqual(['new'])
    expect(oktaCalls(spy)).toHaveLength(2)
    // the fresh list was written back to the cache
    expect((await fetchOktaDirectory(env())).users.map((u) => u.username)).toEqual(['new'])
    expect(oktaCalls(spy)).toHaveLength(2)
  })

  it('honours OKTA_FETCH_LIMIT in the first URL', async () => {
    const spy = stubFetch(() => jsonResponse([]))
    await fetchOktaUsers(createEnv({ OKTA_FETCH_LIMIT: 50 }))
    expect(fetchUrl(oktaCalls(spy)[0]![0])).toBe(`${OKTA_BASE}/api/v1/users?limit=50`)
  })

  describe('cache safety', () => {
    const key = `${CACHE_CONFIG.OKTA_USERS.key}_${TEST_OKTA_DOMAIN}`

    it('caches the COMPLETE multi-page list and serves it without refetching', async () => {
      const spy = stubFetch((url) =>
        url === USERS_URL
          ? jsonResponse([oktaUser('a@example.com')], { link: nextLink(page(2)) })
          : jsonResponse([oktaUser('b@example.com')]),
      )
      const first = await fetchOktaUsers(env())
      expect(getCached<unknown[]>(key)).toHaveLength(2)
      const second = await fetchOktaUsers(env())
      expect(second).toEqual(first)
      expect(oktaCalls(spy)).toHaveLength(2) // 2 pages once, none for the cache hit
    })

    it('does not cache anything when a later page fails, and the next call retries from scratch', async () => {
      let failPage2 = true
      const spy = stubFetch((url) => {
        if (url === USERS_URL) return jsonResponse([oktaUser('a@example.com')], { link: nextLink(page(2)) })
        return failPage2 ? jsonResponse({}, { status: 500 }) : jsonResponse([oktaUser('b@example.com')])
      })
      await expect(fetchOktaUsers(env())).rejects.toThrow('Okta API error: 500')
      expect(getCached(key)).toBeNull()

      failPage2 = false
      const users = await fetchOktaUsers(env())
      expect(users.map((u) => u.username)).toEqual(['a', 'b'])
      expect(oktaCalls(spy)).toHaveLength(4)
    })

    it('does not cache when the page cap is exceeded', async () => {
      stubFetch((url) => {
        const n = url === USERS_URL ? 1 : Number(new URL(url).searchParams.get('after')!.slice(1))
        return jsonResponse([oktaUser(`u${n}@example.com`)], { link: nextLink(page(n + 1)) })
      })
      await expect(fetchOktaUsers(env())).rejects.toThrow(/exceeded 50 pages/)
      expect(getCached(key)).toBeNull()
    })

    it('does not cache a rejected foreign-host pagination link', async () => {
      stubFetch(() => jsonResponse([oktaUser('a@example.com')], { link: nextLink('https://evil.example.com/x') }))
      await expect(fetchOktaUsers(env())).rejects.toThrow('unexpected host')
      expect(getCached(key)).toBeNull()
    })

    it('keys the cache by Okta domain', async () => {
      stubFetch(() => jsonResponse([oktaUser('a@example.com')]))
      await fetchOktaUsers(env())
      expect(getCached(`${CACHE_CONFIG.OKTA_USERS.key}_other.okta.com`)).toBeNull()
    })
  })
})

describe('fetchOktaGroupUsers', () => {
  it('rejects invalid group ids before any network call (no path injection)', async () => {
    const spy = stubFetch(() => jsonResponse([]))
    for (const bad of ['../users', 'a/b', 'a?x=1', '', 'a b']) {
      await expect(fetchOktaGroupUsers(createEnv(), bad)).rejects.toThrow('Invalid group ID format')
    }
    expect(spy).not.toHaveBeenCalled()
  })

  it('paginates group membership and fails whole on a bad page', async () => {
    const gUrl = `${OKTA_BASE}/api/v1/groups/00g1/users?limit=200`
    stubFetch((url) =>
      url === gUrl
        ? jsonResponse([oktaUser('a@example.com')], { link: nextLink(`${OKTA_BASE}/api/v1/groups/00g1/users?after=2`) })
        : jsonResponse({}, { status: 500 }),
    )
    await expect(fetchOktaGroupUsers(createEnv(), '00g1')).rejects.toThrow('Okta API error: 500')
    stubFetch((url) =>
      url === gUrl
        ? jsonResponse([oktaUser('a@example.com')], { link: nextLink(`${OKTA_BASE}/api/v1/groups/00g1/users?after=2`) })
        : jsonResponse([oktaUser('b@example.com')]),
    )
    expect((await fetchOktaGroupUsers(createEnv(), '00g1')).map((u) => u.username)).toEqual(['a', 'b'])
  })
})

describe('fetchOktaGroups', () => {
  const G = `${OKTA_BASE}/api/v1/groups?limit=200`
  const gp = `${OKTA_BASE}/api/v1/groups?after=2&limit=200`
  const key = `${CACHE_CONFIG.OKTA_GROUPS.key}_${TEST_OKTA_DOMAIN}`

  it('maps only real fields and requires configuration', async () => {
    stubFetch(() =>
      jsonResponse([
        { id: 'g1', type: 'OKTA_GROUP', created: 'c', profile: { name: 'Eng' } },
        { id: 'g2', type: 'APP_GROUP', created: 'c2', lastUpdated: 'u2', lastMembershipUpdated: 'm2', profile: { name: 'Ops', description: 'Operators' } },
      ]),
    )
    const groups = await fetchOktaGroups(createEnv())
    expect(groups[0]).toEqual({ id: 'g1', name: 'Eng', description: '', type: 'OKTA_GROUP', created: 'c' })
    expect(groups[1]).toEqual({
      id: 'g2', name: 'Ops', description: 'Operators', type: 'APP_GROUP', created: 'c2', lastUpdated: 'u2', lastMembershipUpdated: 'm2',
    })
    await expect(fetchOktaGroups(createEnv({ OKTA_API_TOKEN: '' }))).rejects.toThrow('Okta configuration missing')
  })

  it('paginates through every page and caches only the complete list', async () => {
    const spy = stubFetch((url) =>
      url === G
        ? jsonResponse([{ id: 'g1', type: 't', created: 'c', profile: { name: 'A' } }], { link: nextLink(gp) })
        : jsonResponse([{ id: 'g2', type: 't', created: 'c', profile: { name: 'B' } }]),
    )
    expect((await fetchOktaGroups(createEnv())).map((g) => g.id)).toEqual(['g1', 'g2'])
    expect(getCached<unknown[]>(key)).toHaveLength(2)
    await fetchOktaGroups(createEnv())
    expect(oktaCalls(spy)).toHaveLength(2)
  })

  it('fails on a bad later page and caches nothing', async () => {
    stubFetch((url) =>
      url === G
        ? jsonResponse([{ id: 'g1', type: 't', created: 'c', profile: { name: 'A' } }], { link: nextLink(gp) })
        : jsonResponse({}, { status: 500 }),
    )
    await expect(fetchOktaGroups(createEnv())).rejects.toThrow('Okta API error: 500')
    expect(getCached(key)).toBeNull()
  })

  it('throws on non-OK responses', async () => {
    stubFetch(() => jsonResponse({}, { status: 403 }))
    await expect(fetchOktaGroups(createEnv())).rejects.toThrow('Okta API error: 403')
  })

  it('applies the page cap', async () => {
    stubFetch((url) => {
      const n = url === G ? 1 : Number(new URL(url).searchParams.get('after')!.slice(1))
      return jsonResponse([{ id: `g${n}`, type: 't', created: 'c', profile: { name: 'x' } }], {
        link: nextLink(`${OKTA_BASE}/api/v1/groups?after=p${n + 1}&limit=200`),
      })
    })
    await expect(fetchOktaGroups(createEnv())).rejects.toThrow(/exceeded 50 pages/)
    expect(getCached(key)).toBeNull()
  })
})

const pu = (username: string, firstName = 'First', email = `${username}@example.com`): ProcessedUser => ({
  id: `id-${username}`,
  username,
  email,
  firstName,
  lastName: 'Last',
  status: 'ACTIVE',
  created: '2024-01-01',
  lastLogin: null,
})

const FULL = { scope: 'full' } as const
const GROUP = { scope: 'group' } as const

describe('syncUsersToDatabase — group scope is add/update-only', () => {
  it('never deletes users outside the group and preserves every training status', async () => {
    const env = createEnv()
    env.DB.seed('outsider', 'completed', 'Out', 'outsider@example.com')
    env.DB.seed('outsider2', 'started', 'Out2', 'outsider2@example.com')
    env.DB.seed('member', 'completed', 'Old', 'member@example.com')
    const r = await syncUsersToDatabase(env, [pu('member', 'New'), pu('fresh', 'Fresh')], GROUP)
    expect(r).toMatchObject({ added: 1, updated: 1, removed: 0, skipped: 0, errors: [] })
    expect(env.DB.status('outsider')).toBe('completed')
    expect(env.DB.status('outsider2')).toBe('started')
    expect(env.DB.status('member')).toBe('completed')
    expect(env.DB.status('fresh')).toBe('not started')
    expect(env.DB.rows().find((u) => u['username'] === 'member')).toMatchObject({
      first_name: 'New',
      primary_email: 'member@example.com',
    })
    expect(env.DB.callsMatching(/DELETE/)).toHaveLength(0)
    for (const c of env.DB.callsMatching(/UPDATE/)) expect(c.sql).not.toMatch(/training_status/)
  })

  it('an empty group list deletes nobody and issues no DELETE', async () => {
    const env = createEnv()
    env.DB.seed('alice', 'completed')
    env.DB.seed('bob', 'completed')
    const r = await syncUsersToDatabase(env, [], GROUP)
    expect(r).toMatchObject({ added: 0, updated: 0, removed: 0, skipped: 0, errors: [] })
    expect(env.DB.rows()).toHaveLength(2)
    expect(env.DB.callsMatching(/DELETE/)).toHaveLength(0)
  })

  it('a full directory snapshot still removes genuinely removed users', async () => {
    const env = createEnv()
    env.DB.seed('alice', 'completed')
    env.DB.seed('gone', 'completed')
    const r = await syncUsersToDatabase(env, [pu('alice', 'First')], FULL)
    expect(r.removed).toBe(1)
    expect(env.DB.status('gone')).toBeNull()
    expect(env.DB.status('alice')).toBe('completed')
  })
})

describe('syncUsersToDatabase', () => {
  it('adds new users as "not started" (never auto-granted)', async () => {
    const env = createEnv()
    const r = await syncUsersToDatabase(env, [pu('alice', 'Alice')], FULL)
    expect(r).toMatchObject({ added: 1, updated: 0, removed: 0, skipped: 0, errors: [] })
    expect(env.DB.rows()[0]).toMatchObject({
      username: 'alice',
      first_name: 'Alice',
      primary_email: 'alice@example.com',
      training_status: 'not started',
    })
  })

  it('NEVER changes training_status; updates first_name only when the email matches', async () => {
    const env = createEnv()
    env.DB.seed('alice', 'completed', 'Old', 'alice@example.com')
    env.DB.seed('bob', 'started', 'Bob', 'bob@example.com')
    const r = await syncUsersToDatabase(env, [pu('alice', 'New'), pu('bob', 'Bob')], FULL)
    expect(r).toMatchObject({ added: 0, updated: 1, skipped: 1, removed: 0, errors: [] })
    expect(env.DB.status('alice')).toBe('completed')
    expect(env.DB.status('bob')).toBe('started')
    expect(env.DB.rows()[0]).toMatchObject({ first_name: 'New', primary_email: 'alice@example.com' })
    for (const c of env.DB.callsMatching(/UPDATE/)) expect(c.sql).not.toMatch(/training_status/)
  })

  it('matches the stored email case-insensitively (no spurious conflict)', async () => {
    const env = createEnv()
    env.DB.seed('alice', 'completed', 'Alice', 'alice@example.com')
    const r = await syncUsersToDatabase(env, [pu('alice', 'Alice', 'Alice@Example.COM')], FULL)
    expect(r).toMatchObject({ skipped: 1, errors: [] })
    expect(env.DB.rows()[0]).toMatchObject({ primary_email: 'alice@example.com' })
  })

  it('does not write for unchanged users (skipped)', async () => {
    const env = createEnv()
    env.DB.seed('alice', 'completed', 'Alice', 'alice@example.com')
    const r = await syncUsersToDatabase(env, [pu('alice', 'Alice')], FULL)
    expect(r.skipped).toBe(1)
    expect(env.DB.callsMatching(/INSERT|UPDATE|DELETE/)).toHaveLength(0)
    expect(env.DB.batches).toHaveLength(0)
  })

  it('removes users that are absent from the directory it was given', async () => {
    const env = createEnv()
    env.DB.seed('alice', 'completed')
    env.DB.seed('gone', 'completed')
    const r = await syncUsersToDatabase(env, [pu('alice', 'First')], FULL)
    expect(r.removed).toBe(1)
    expect(env.DB.status('gone')).toBeNull()
    expect(env.DB.status('alice')).toBe('completed')
  })

  it('removal uses parameterised, per-user DELETE statements inside one batch', async () => {
    const env = createEnv()
    env.DB.seed('keep', 'not started', 'First')
    env.DB.seed('drop1')
    env.DB.seed('drop2')
    await syncUsersToDatabase(env, [pu('keep', 'First')], FULL)
    const deletes = env.DB.callsMatching(/DELETE/)
    expect(deletes.map((d) => d.params)).toEqual([['drop1'], ['drop2']])
    for (const d of deletes) expect(d.sql).toBe('DELETE FROM users WHERE username = ?')
    expect(env.DB.batches).toHaveLength(1)
  })

  describe('identity safety (username is only the email local part)', () => {
    it('alice@a.com and alice@b.com in the directory: the existing row is kept, the other is a conflict', async () => {
      const env = createEnv()
      env.DB.seed('alice', 'completed', 'Alice', 'alice@a.com')
      const r = await syncUsersToDatabase(
        env,
        [pu('alice', 'Alice', 'alice@a.com'), pu('alice', 'Other', 'alice@b.com')],
        FULL,
      )
      // two distinct identities share a username: never guess, touch nothing
      expect(r.added).toBe(0)
      expect(r.updated).toBe(0)
      expect(r.removed).toBe(0)
      expect(r.errors).toEqual(['identity conflict for username alice: needs manual review'])
      expect(env.DB.rows()).toHaveLength(1)
      expect(env.DB.rows()[0]).toMatchObject({ primary_email: 'alice@a.com', training_status: 'completed' })
    })

    it('two new Okta users sharing a username insert NONE and report ONE error for it', async () => {
      const env = createEnv()
      const r = await syncUsersToDatabase(
        env,
        [pu('alice', 'A', 'alice@a.com'), pu('alice', 'B', 'alice@b.com'), pu('bob', 'Bob')],
        FULL,
      )
      expect(r.added).toBe(1)
      expect(r.errors).toEqual(['identity conflict for username alice: needs manual review'])
      expect(env.DB.rows().map((x) => x['username'])).toEqual(['bob'])
    })

    it('alice@a.com removed from Okta + alice@b.com added must NOT give b.com the completed status', async () => {
      const env = createEnv()
      env.DB.seed('alice', 'completed', 'Alice', 'alice@a.com')
      const r = await syncUsersToDatabase(env, [pu('alice', 'Alice', 'alice@b.com')], FULL)
      expect(r.errors).toEqual(['identity conflict for username alice: needs manual review'])
      expect(r.added + r.updated + r.removed).toBe(0)
      // the original row is untouched: still a.com, still completed, never re-pointed to b.com
      expect(env.DB.rows()).toHaveLength(1)
      expect(env.DB.rows()[0]).toMatchObject({ primary_email: 'alice@a.com', training_status: 'completed' })
      expect(env.DB.callsMatching(/INSERT|UPDATE|DELETE/)).toHaveLength(0)
    })

    it('a conflict also blocks deletion in the same full sync (fail safe)', async () => {
      const env = createEnv()
      env.DB.seed('alice', 'completed', 'Alice', 'alice@a.com')
      env.DB.seed('gone', 'completed', 'Gone', 'gone@example.com')
      const r = await syncUsersToDatabase(env, [pu('alice', 'Alice', 'alice@b.com')], FULL)
      expect(r.removed).toBe(0)
      expect(env.DB.status('gone')).toBe('completed')
      expect(r.errors.join(' ')).toMatch(/Removal skipped/)
    })

    it('treats the same username AND same email (any case) listed twice as one user', async () => {
      const env = createEnv()
      const r = await syncUsersToDatabase(
        env,
        [pu('alice', 'Alice', 'alice@a.com'), pu('alice', 'Alice', 'Alice@A.com')],
        FULL,
      )
      expect(r).toMatchObject({ added: 1, errors: [] })
      expect(env.DB.rows()).toHaveLength(1)
    })

    it('never inserts a new username whose email already belongs to another row', async () => {
      const env = createEnv()
      env.DB.seed('legacy', 'completed', 'L', 'shared@example.com')
      const r = await syncUsersToDatabase(env, [pu('shared', 'S', 'shared@example.com')], GROUP)
      expect(r.added).toBe(0)
      expect(r.errors).toEqual(['identity conflict for username shared: needs manual review'])
      expect(env.DB.status('legacy')).toBe('completed')
    })

    it('conflict messages are sanitized (no control characters)', async () => {
      const env = createEnv()
      env.DB.seed('a', 'completed', 'A', 'a@a.com')
      const r = await syncUsersToDatabase(env, [pu('a\nb\u0000', 'x', 'q@a.com'), pu('a\nb\u0000', 'y', 'r@a.com')], GROUP)
      expect(r.errors[0]).not.toMatch(/\n/)
      expect(r.errors[0]).not.toContain(String.fromCharCode(0))
    })
  })

  describe('deletion safety', () => {
    it('protectedEmails (unmappable Okta logins) are never deleted, case-insensitively', async () => {
      const env = createEnv()
      env.DB.seed('legacy', 'completed', 'L', 'Legacy+alias@example.com')
      env.DB.seed('gone', 'completed', 'G', 'gone@example.com')
      const r = await syncUsersToDatabase(env, [pu('alice')], {
        scope: 'full',
        protectedEmails: ['legacy+alias@example.com'],
      })
      expect(r.removed).toBe(1)
      expect(env.DB.status('legacy')).toBe('completed')
      expect(env.DB.status('gone')).toBeNull()
    })

    it('end-to-end: a user dropped for an invalid login is protected when passed from fetchOktaDirectory', async () => {
      const env = createEnv()
      env.DB.seed('legacy', 'completed', 'L', 'legacy+alias@example.com')
      stubFetch(() => jsonResponse([oktaUser('ok@example.com'), oktaUser('legacy+alias@example.com')]))
      const dir = await fetchOktaDirectory(env, { fresh: true })
      const r = await syncUsersToDatabase(env, dir.users, { scope: 'full', protectedEmails: dir.invalidLogins })
      expect(r.removed).toBe(0)
      expect(env.DB.status('legacy')).toBe('completed')
    })

    it('deletion is skipped (with a note) when the add/update phase had any error', async () => {
      const env = createEnv()
      env.DB.seed('gone', 'completed')
      env.DB.failWhen((c) => (/INSERT/.test(c.sql) ? new Error('insert failed: secret detail') : undefined))
      const r = await syncUsersToDatabase(env, [pu('new')], FULL)
      expect(r.removed).toBe(0)
      expect(env.DB.status('gone')).toBe('completed')
      expect(env.DB.callsMatching(/DELETE/)).toHaveLength(0)
      expect(r.errors.length).toBeGreaterThanOrEqual(1)
      expect(r.errors.join(' ')).not.toContain('secret detail')
    })

    it('an empty directory does not delete anyone (refused with a note)', async () => {
      const env = createEnv()
      env.DB.seed('alice', 'completed')
      env.DB.seed('bob', 'completed')
      const r = await syncUsersToDatabase(env, [], FULL)
      expect(r.removed).toBe(0)
      expect(env.DB.rows()).toHaveLength(2)
      expect(r.errors.join(' ')).toMatch(/Removal skipped/)
    })

    it('performs NO write when the existing-user snapshot cannot be read, with a sanitized error', async () => {
      const env = createEnv()
      env.DB.seed('alice')
      env.DB.failWhen((c) => (/SELECT username, first_name/.test(c.sql) ? new Error('read failed: secret') : undefined))
      const r = await syncUsersToDatabase(env, [pu('bob')], FULL)
      expect(r.errors).toHaveLength(1)
      expect(r.errors[0]).not.toContain('secret')
      expect(env.DB.callsMatching(/INSERT|UPDATE|DELETE/)).toHaveLength(0)
      expect(env.DB.status('alice')).toBe('not started')
    })
  })

  describe('atomic, chunked writes', () => {
    const many = (n: number) => Array.from({ length: n }, (_, i) => pu(`user${String(i).padStart(4, '0')}`))

    it('splits >100 inserts into batches of at most 100 statements', async () => {
      const env = createEnv()
      const r = await syncUsersToDatabase(env, many(250), GROUP)
      expect(r).toMatchObject({ added: 250, errors: [] })
      expect(env.DB.batches.map((b) => b.length)).toEqual([100, 100, 50])
      expect(env.DB.rows()).toHaveLength(250)
    })

    it('chunks deletions too', async () => {
      const env = createEnv()
      for (const u of many(230)) env.DB.seed(u.username, 'completed', 'x', u.email)
      const r = await syncUsersToDatabase(env, [pu('keeper')], FULL)
      expect(r.removed).toBe(230)
      const deleteBatches = env.DB.batches.filter((b) => /DELETE/.test(b[0]!.sql)).map((b) => b.length)
      expect(deleteBatches).toEqual([100, 100, 30])
    })

    it('a failing statement rolls its whole batch back: no partial inserts persist', async () => {
      const env = createEnv()
      env.DB.seed('dup', 'completed', 'D', 'dup@example.com')
      // Force a real SQL failure inside the batch: a UNIQUE clash the planner cannot see
      // (a concurrent writer inserts 'bbb' after the snapshot was read).
      const users = [pu('aaa'), pu('bbb'), pu('ccc')]
      const snapshotDone = vi.fn()
      const db = env.DB as unknown as TestD1
      const realPrepare = db.prepare.bind(db)
      vi.spyOn(db, 'prepare').mockImplementation((sql: string) => {
        const stmt = realPrepare(sql)
        if (/SELECT username, first_name/.test(sql)) {
          const realAll = stmt.all.bind(stmt)
          stmt.all = (async () => {
            const res = await realAll()
            snapshotDone()
            env.DB.seed('bbb', 'completed', 'Race', 'race@example.com')
            return res
          }) as typeof stmt.all
        }
        return stmt
      })
      const r = await syncUsersToDatabase(env, users, FULL)
      expect(snapshotDone).toHaveBeenCalled()
      expect(r.added).toBe(0)
      expect(r.errors[0]).toMatch(/insert batch 1 of 1 failed and was rolled back/)
      expect(r.errors[0]).not.toMatch(/UNIQUE/)
      // aaa and ccc, which come before/after the failing statement, were rolled back
      expect(env.DB.rows().map((x) => x['username'])).toEqual(['bbb', 'dup'])
    })

    it('one failed chunk stops later chunks and the removal phase', async () => {
      const env = createEnv()
      env.DB.seed('gone', 'completed', 'G', 'gone@example.com')
      let batchNo = 0
      const db = env.DB as unknown as TestD1
      const realBatch = db.batch.bind(db)
      vi.spyOn(db, 'batch').mockImplementation(async (stmts: Parameters<TestD1['batch']>[0]) => {
        if (++batchNo === 2) throw new Error('chunk 2 exploded')
        return realBatch(stmts)
      })
      const users = Array.from({ length: 250 }, (_, i) => pu(`u${String(i).padStart(4, '0')}`))
      const r = await syncUsersToDatabase(env, users, FULL)
      expect(r.added).toBe(0)
      expect(r.removed).toBe(0)
      expect(batchNo).toBe(2) // third insert chunk and removal never attempted
      expect(env.DB.status('gone')).toBe('completed')
      expect(r.errors.filter((e) => /batch 2 of 3/.test(e))).toHaveLength(1)
      expect(r.errors.join(' ')).not.toContain('exploded')
    })

    it('uses D1 batch(), never one round trip per row', async () => {
      const env = createEnv()
      await syncUsersToDatabase(env, many(10), GROUP)
      expect(env.DB.batches).toHaveLength(1)
    })
  })

  it('end-to-end: multi-page directory is fully synced and none of the existing users is wrongly removed', async () => {
    const env = createEnv()
    env.DB.seed('b', 'completed', 'First', 'b@example.com')
    stubFetch((url) =>
      url === USERS_URL
        ? jsonResponse([oktaUser('a@example.com'), oktaUser('b@example.com')], { link: nextLink(page(2)) })
        : jsonResponse([oktaUser('c@example.com')]),
    )
    const dir = await fetchOktaDirectory(env, { fresh: true })
    const r = await syncUsersToDatabase(env, dir.users, { scope: 'full', protectedEmails: dir.invalidLogins })
    expect(r).toMatchObject({ added: 2, removed: 0, errors: [] })
    expect(env.DB.status('b')).toBe('completed')
  })

  it('end-to-end: a failing page 2 means the DB is not touched at all', async () => {
    const env = createEnv()
    env.DB.seed('b', 'completed')
    env.DB.seed('c', 'completed')
    stubFetch((url) =>
      url === USERS_URL ? jsonResponse([oktaUser('a@example.com')], { link: nextLink(page(2)) }) : jsonResponse({}, { status: 500 }),
    )
    await expect(fetchOktaUsers(env)).rejects.toThrow()
    expect(env.DB.rows()).toHaveLength(2)
    expect(env.DB.calls).toHaveLength(0)
  })
})
