import { describe, expect, it } from 'vitest'
import { handleUpdateTraining } from '../../src/handlers/web'
import { handleOktaGroups, handleOktaSync, handleOktaUsers } from '../../src/handlers/sync'
import { handleDatabaseInitRequest } from '../../src/handlers/index'
import { createEnv } from '../helpers/env'
import { fetchUrl, jsonResponse, nextLink, OKTA_BASE, oktaCalls, oktaUser, stubFetch } from '../helpers/okta'
import { postJson } from '../helpers/worker'

const post = (env: ReturnType<typeof createEnv>, body: unknown) =>
  handleUpdateTraining(env, new Request('https://x.test/api/update-training', postJson(body)))

describe('handleUpdateTraining — validation and contract', () => {
  it.each([
    ['missing email', { status: 'completed' }],
    ['missing status', { email: 'alice@example.com' }],
    ['empty email', { email: '', status: 'completed' }],
    ['empty status', { email: 'alice@example.com', status: '' }],
    ['empty body object', {}],
  ])('400 for %s, no DB write', async (_n, body) => {
    const env = createEnv()
    env.DB.seed('alice')
    const res = await post(env, body)
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ success: false, message: 'Email and status are required' })
    expect(env.DB.calls).toHaveLength(0)
  })

  it.each(['Completed', 'COMPLETED', 'done', 'granted', 'complete', 'completed ', 'started; --', '__proto__', 'toString'])(
    '400 "Invalid status value" for %j, no DB write',
    async (status) => {
      const env = createEnv()
      env.DB.seed('alice')
      const res = await post(env, { email: 'alice@example.com', status })
      expect(res.status).toBe(400)
      expect(await res.json()).toMatchObject({ success: false, message: 'Invalid status value' })
      expect(env.DB.calls).toHaveLength(0)
      expect(env.DB.status('alice')).toBe('not started')
    },
  )

  it.each([
    ['number', 1],
    ['array', ['completed']],
    ['object', { a: 1 }],
    ['true', true],
  ])('rejects non-string status (%s)', async (_n, status) => {
    const env = createEnv()
    env.DB.seed('alice')
    const res = await post(env, { email: 'alice@example.com', status })
    expect(res.status).toBe(400)
    expect(env.DB.status('alice')).toBe('not started')
  })

  it.each(['not started', 'started', 'completed'])('accepts %s and persists it', async (status) => {
    const env = createEnv()
    env.DB.seed('alice', status === 'started' ? 'completed' : 'started')
    const res = await post(env, { email: 'alice@example.com', status })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ success: true, message: 'Training status updated successfully' })
    expect(env.DB.status('alice')).toBe(status)
  })

  it('404 when the user does not exist; nothing else is modified', async () => {
    const env = createEnv()
    env.DB.seed('alice')
    const res = await post(env, { email: 'ghost@example.com', status: 'completed' })
    expect(res.status).toBe(404)
    expect(await res.json()).toMatchObject({ success: false })
    expect(env.DB.status('alice')).toBe('not started')
  })

  it('a failed DB write is reported as failure (404), never success', async () => {
    const env = createEnv()
    env.DB.seed('alice')
    env.DB.failWhen((c) => (/UPDATE/.test(c.sql) ? new Error('d1 down') : undefined))
    const res = await post(env, { email: 'alice@example.com', status: 'completed' })
    expect(res.status).toBe(404)
    expect(await res.json()).toMatchObject({ success: false })
    expect(env.DB.status('alice')).toBe('not started')
  })

  it('400 with generic message on malformed JSON (no parser detail leaked)', async () => {
    const env = createEnv()
    const res = await handleUpdateTraining(env, new Request('https://x.test/', postJson('{bad')))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body).toMatchObject({ success: false, message: 'Malformed request body' })
    expect(JSON.stringify(body)).not.toMatch(/Unexpected|JSON/)
  })

  it('does not interpret the email as SQL', async () => {
    const env = createEnv()
    env.DB.seed('alice', 'not started')
    env.DB.seed('bob', 'not started')
    const res = await post(env, { email: "' OR '1'='1", status: 'completed' })
    expect(res.status).toBe(400) // fails email validation before any DB access
    expect(env.DB.calls).toHaveLength(0)
    expect(env.DB.status('alice')).toBe('not started')
    expect(env.DB.status('bob')).toBe('not started')
  })

  it('sets security headers on all JSON responses', async () => {
    const res = await post(createEnv(), {})
    expect(res.headers.get('content-security-policy')).toBeTruthy()
    expect(res.headers.get('content-type')).toBe('application/json')
  })
})

describe('handleOktaSync', () => {
  const USERS_URL = `${OKTA_BASE}/api/v1/users?limit=200`
  const page2 = `${OKTA_BASE}/api/v1/users?after=2&limit=200`
  const sync = (env: ReturnType<typeof createEnv>, qs = '') =>
    handleOktaSync(env, new Request(`https://x.test/api/okta/sync${qs}`, { method: 'POST' }))

  it('400 without making any request when Okta is not configured', async () => {
    const spy = stubFetch(() => jsonResponse([]))
    const env = createEnv({ OKTA_API_TOKEN: '' })
    env.DB.seed('alice', 'completed')
    const res = await sync(env)
    expect(res.status).toBe(400)
    expect(res.headers.get('content-security-policy')).toBeTruthy()
    expect(spy).not.toHaveBeenCalled()
    expect(env.DB.calls).toHaveLength(0)
  })

  it('all-or-nothing: failure on page 2 → 500 generic message and the DB is untouched (no deletions)', async () => {
    const env = createEnv()
    env.DB.seed('b', 'completed')
    env.DB.seed('c', 'completed')
    stubFetch((url) =>
      url === USERS_URL ? jsonResponse([oktaUser('a@example.com')], { link: nextLink(page2) }) : jsonResponse({}, { status: 429 }),
    )
    const res = await sync(env)
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body).toEqual({ success: false, message: 'Okta sync failed. Check the Worker logs.' })
    expect(JSON.stringify(body)).not.toMatch(/429|Okta API error/)
    expect(res.headers.get('content-security-policy')).toBeTruthy()
    expect(env.DB.rows().map((r) => r['username'])).toEqual(['b', 'c'])
    expect(env.DB.calls).toHaveLength(0)
  })

  it('a malicious pagination link → 500, token never sent to the foreign host, DB untouched', async () => {
    const env = createEnv()
    env.DB.seed('b', 'completed')
    const spy = stubFetch((url) =>
      url === USERS_URL ? jsonResponse([oktaUser('a@example.com')], { link: nextLink('https://evil.example.com/steal') }) : jsonResponse([]),
    )
    const res = await sync(env)
    expect(res.status).toBe(500)
    expect(oktaCalls(spy).map(([u]) => fetchUrl(u))).toEqual([USERS_URL])
    expect(env.DB.calls).toHaveLength(0)
  })

  it('full multi-page sync adds, updates and removes correctly and preserves statuses', async () => {
    const env = createEnv()
    env.DB.seed('keep', 'completed', 'Keep', 'keep@example.com')
    env.DB.seed('rename', 'started', 'Old', 'rename@example.com')
    env.DB.seed('gone', 'completed', 'Gone', 'gone@example.com')
    stubFetch((url) =>
      url === USERS_URL
        ? jsonResponse([oktaUser('keep@example.com', 'Keep'), oktaUser('rename@example.com', 'New')], { link: nextLink(page2) })
        : jsonResponse([oktaUser('fresh@example.com', 'Fresh')]),
    )
    const res = await sync(env)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-security-policy')).toBeTruthy()
    const body: { message: string } = await res.json()
    expect(body).toMatchObject({
      success: true,
      oktaUsers: 3,
      results: { added: 1, updated: 1, removed: 1, skipped: 1, errors: [] },
    })
    expect(body.message).toBe('Sync completed. Added: 1, Updated: 1, Removed: 1, Skipped: 1.')
    expect(env.DB.status('keep')).toBe('completed')
    expect(env.DB.status('rename')).toBe('started')
    expect(env.DB.status('gone')).toBeNull()
    expect(env.DB.status('fresh')).toBe('not started')
  })

  it('identity conflicts → 207 success:false with sanitized errors, nothing overwritten or deleted', async () => {
    const env = createEnv()
    env.DB.seed('alice', 'completed', 'Alice', 'alice@a.com')
    env.DB.seed('gone', 'completed', 'Gone', 'gone@example.com')
    stubFetch(() => jsonResponse([oktaUser('alice@b.com', 'Alice'), oktaUser('new@example.com', 'New')]))
    const res = await sync(env)
    expect(res.status).toBe(207)
    expect(res.headers.get('content-security-policy')).toBeTruthy()
    const body: { success: boolean; message: string; results: { errors: string[]; added: number } } = await res.json()
    expect(body.success).toBe(false)
    expect(body.message).toMatch(/^Sync finished with 2 error\(s\)\. Added: 1, Updated: 0, Removed: 0, Skipped: 0\.$/)
    expect(body.results.errors[0]).toBe('identity conflict for username alice: needs manual review')
    expect(env.DB.rows().find((r) => r['username'] === 'alice')).toMatchObject({ primary_email: 'alice@a.com', training_status: 'completed' })
    expect(env.DB.status('gone')).toBe('completed')
  })

  it('a DB write failure is never reported as success and leaks no raw error text', async () => {
    const env = createEnv()
    env.DB.failWhen((c) => (/INSERT/.test(c.sql) ? new Error('SQLITE_SECRET_DETAIL') : undefined))
    stubFetch(() => jsonResponse([oktaUser('a@example.com')]))
    const res = await sync(env)
    expect(res.status).toBe(207)
    const text = await res.text()
    expect(JSON.parse(text)).toMatchObject({ success: false })
    expect(text).not.toContain('SQLITE_SECRET_DETAIL')
  })

  it('bypasses the 10-minute cache (fresh list) and then refreshes the cache', async () => {
    const env = createEnv()
    let n = 0
    const spy = stubFetch(() => jsonResponse([oktaUser(n++ === 0 ? 'old@example.com' : 'new@example.com')]))
    await handleOktaUsers(env, new Request('https://x.test/api/okta/users')) // warms cache with "old"
    const res = await sync(env)
    expect(oktaCalls(spy)).toHaveLength(2) // the sync refetched
    expect(await res.json()).toMatchObject({ success: true, results: { added: 1 } })
    expect(env.DB.rows().map((r) => r['username'])).toEqual(['new'])
    // read-only view now sees the fresh list from the cache
    const view: { users: Array<{ username: string }> } = await (await handleOktaUsers(env, new Request('https://x.test/api/okta/users'))).json()
    expect(view.users.map((u) => u.username)).toEqual(['new'])
    expect(oktaCalls(spy)).toHaveLength(2)
  })

  it('a stale cache can never cause deletions: users added in Okta after caching are seen by the sync', async () => {
    const env = createEnv()
    env.DB.seed('late', 'completed', 'Late', 'late@example.com')
    let phase = 0
    stubFetch(() =>
      jsonResponse(phase === 0 ? [oktaUser('a@example.com')] : [oktaUser('a@example.com'), oktaUser('late@example.com', 'Late')]),
    )
    await handleOktaUsers(env, new Request('https://x.test/api/okta/users')) // cache = [a]
    phase = 1
    const res = await sync(env)
    expect(await res.json()).toMatchObject({ success: true, results: { removed: 0 } })
    expect(env.DB.status('late')).toBe('completed')
  })

  it('does not delete a DB user whose Okta login is unmappable (kept, not silently dropped)', async () => {
    const env = createEnv()
    env.DB.seed('legacy', 'completed', 'L', 'legacy+alias@example.com')
    stubFetch(() => jsonResponse([oktaUser('ok@example.com'), oktaUser('legacy+alias@example.com')]))
    const res = await sync(env)
    expect(await res.json()).toMatchObject({ success: true, results: { added: 1, removed: 0 } })
    expect(env.DB.status('legacy')).toBe('completed')
  })

  it('empty directory → success message and NO deletions (guards against wiping the table)', async () => {
    const env = createEnv()
    env.DB.seed('alice', 'completed')
    stubFetch(() => jsonResponse([]))
    const res = await sync(env)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-security-policy')).toBeTruthy()
    expect(await res.json()).toMatchObject({ success: true, message: 'No users found in Okta' })
    expect(env.DB.status('alice')).toBe('completed')
    expect(env.DB.calls).toHaveLength(0)
  })

  it.each(['../users', 'a/b', 'a b', 'a?x=1'])('400 for invalid groupId %j without any Okta request', async (g) => {
    const spy = stubFetch(() => jsonResponse([]))
    const env = createEnv()
    env.DB.seed('alice', 'completed')
    const res = await sync(env, `?groupId=${encodeURIComponent(g)}`)
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ success: false })
    expect(res.headers.get('content-security-policy')).toBeTruthy()
    expect(spy).not.toHaveBeenCalled()
    expect(env.DB.calls).toHaveLength(0)
  })

  it('syncing a single group is add/update-only: users outside the group are never deleted', async () => {
    const env = createEnv()
    env.DB.seed('ingroup', 'completed', 'Old', 'ingroup@example.com')
    env.DB.seed('outsider', 'completed', 'O', 'outsider@example.com')
    const spy = stubFetch((url) =>
      url.includes('/groups/00g1/users')
        ? jsonResponse([oktaUser('ingroup@example.com', 'New'), oktaUser('fresh@example.com', 'Fresh')])
        : jsonResponse([]),
    )
    const res = await sync(env, '?groupId=00g1')
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({
      success: true,
      oktaUsers: 2,
      results: { added: 1, updated: 1, removed: 0, skipped: 0, errors: [] },
    })
    expect(oktaCalls(spy).map(([u]) => fetchUrl(u))).toEqual([`${OKTA_BASE}/api/v1/groups/00g1/users?limit=200`])
    expect(env.DB.status('outsider')).toBe('completed')
    expect(env.DB.status('ingroup')).toBe('completed')
    expect(env.DB.status('fresh')).toBe('not started')
    expect(env.DB.callsMatching(/DELETE/)).toHaveLength(0)
  })

  it('an empty group → success, nothing deleted, no DB writes', async () => {
    const env = createEnv()
    env.DB.seed('alice', 'completed')
    stubFetch(() => jsonResponse([]))
    const res = await sync(env, '?groupId=00g1')
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ success: true, results: { removed: 0 } })
    expect(env.DB.status('alice')).toBe('completed')
    expect(env.DB.callsMatching(/INSERT|UPDATE|DELETE/)).toHaveLength(0)
  })

  it('error responses do not leak the Okta token or raw upstream text', async () => {
    const env = createEnv()
    stubFetch(() => jsonResponse({}, { status: 401 }))
    const res = await sync(env)
    const text = await res.text()
    expect(text).not.toContain(env.OKTA_API_TOKEN)
    expect(text).not.toMatch(/401|Okta API error/)
  })

  it('>100 new users are written through multiple D1 batches', async () => {
    const env = createEnv()
    stubFetch(() => jsonResponse(Array.from({ length: 120 }, (_, i) => oktaUser(`u${i}@example.com`))))
    const res = await sync(env)
    expect(await res.json()).toMatchObject({ success: true, results: { added: 120 } })
    expect(env.DB.batches.map((b) => b.length)).toEqual([100, 20])
  })
})

describe('handleOktaUsers / handleOktaGroups', () => {
  it('return 400 when unconfigured and a generic 500 on upstream failure', async () => {
    const bad = createEnv({ OKTA_DOMAIN: '' })
    expect((await handleOktaGroups(bad)).status).toBe(400)
    expect((await handleOktaUsers(bad, new Request('https://x.test/'))).status).toBe(400)
    stubFetch(() => jsonResponse({}, { status: 500 }))
    const g = await handleOktaGroups(createEnv())
    expect(g.status).toBe(500)
    const gText = await g.text()
    expect(JSON.parse(gText)).toMatchObject({ success: false })
    expect(gText).not.toMatch(/Okta API error|500/)
    expect(g.headers.get('content-security-policy')).toBeTruthy()
    const u = await handleOktaUsers(createEnv(), new Request('https://x.test/'))
    expect(u.status).toBe(500)
    expect(await u.text()).not.toMatch(/Okta API error|500/)
    expect(u.headers.get('content-security-policy')).toBeTruthy()
  })

  it('users listing is read-only (never touches the DB) and carries security headers', async () => {
    const env = createEnv()
    env.DB.seed('gone', 'completed')
    stubFetch(() => jsonResponse([oktaUser('a@example.com')]))
    const res = await handleOktaUsers(env, new Request('https://x.test/api/okta/users'))
    expect(await res.json()).toMatchObject({ success: true, count: 1 })
    expect(res.headers.get('content-security-policy')).toBeTruthy()
    expect(env.DB.calls).toHaveLength(0)
  })

  it('groups listing returns only real fields', async () => {
    stubFetch(() => jsonResponse([{ id: 'g1', type: 'OKTA_GROUP', created: 'c', profile: { name: 'Eng', description: 'd' } }]))
    const res = await handleOktaGroups(createEnv())
    expect(res.headers.get('content-security-policy')).toBeTruthy()
    expect(await res.json()).toEqual({
      success: true,
      count: 1,
      groups: [{ id: 'g1', name: 'Eng', description: 'd', type: 'OKTA_GROUP', created: 'c' }],
    })
  })

  it.each(['a/b', '../x', 'a b'])('users listing with a bad groupId %j → 400 without a network call', async (g) => {
    const spy = stubFetch(() => jsonResponse([]))
    const res = await handleOktaUsers(createEnv(), new Request(`https://x.test/?groupId=${encodeURIComponent(g)}`))
    expect(res.status).toBe(400)
    expect(res.headers.get('content-security-policy')).toBeTruthy()
    expect(spy).not.toHaveBeenCalled()
  })
})

describe('handleDatabaseInitRequest', () => {
  it('reports success / failure status codes', async () => {
    const ok = await handleDatabaseInitRequest(createEnv())
    expect(ok.status).toBe(200)
    const env = createEnv()
    env.DB.failWhen((c) => (/CREATE TABLE/.test(c.sql) ? new Error('x') : undefined))
    expect((await handleDatabaseInitRequest(env)).status).toBe(500)
  })
})
