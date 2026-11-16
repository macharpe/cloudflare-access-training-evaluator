import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Lets a test make the DB layer throw unexpectedly (the real function catches
// its own D1 errors and returns false, so a 500 needs a genuine throw).
const dbThrow = vi.hoisted(() => ({ error: null as Error | null }))
vi.mock('../../src/database/training', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/database/training')>()
  return {
    ...actual,
    updateUserTrainingStatusByEmail: (...args: Parameters<typeof actual.updateUserTrainingStatusByEmail>) => {
      if (dbThrow.error) throw dbThrow.error
      return actual.updateUserTrainingStatusByEmail(...args)
    },
  }
})

import { handleUpdateTraining, MAX_UPDATE_BODY_BYTES } from '../../src/handlers/web'
import { createEnv, type TestEnv } from '../helpers/env'
import { authedHeaders, stubFetchWithAccess } from '../helpers/access'
import { call, json, postJson } from '../helpers/worker'

const direct = (env: TestEnv, body: string) =>
  handleUpdateTraining(
    env,
    new Request('https://admin.example.com/api/update-training', postJson(body)),
  )

const expectSecurityHeaders = (res: Response) => {
  expect(res.headers.get('content-type')).toBe('application/json')
  expect(res.headers.get('content-security-policy')).toContain("default-src 'self'")
  expect(res.headers.get('x-content-type-options')).toBe('nosniff')
  expect(res.headers.get('x-frame-options')).toBe('DENY')
}

const noWrite = (env: TestEnv) => {
  expect(env.DB.callsMatching(/UPDATE|INSERT|DELETE/i)).toHaveLength(0)
  expect(env.DB.status('alice')).toBe('not started')
}

let env: TestEnv
afterEach(() => {
  dbThrow.error = null
})
beforeEach(async () => {
  env = createEnv()
  env.DB.seed('alice', 'not started', 'Alice', 'alice@example.com')
  await stubFetchWithAccess()
})

describe('POST /api/update-training — malformed input is a 400, never a 500', () => {
  it.each([
    ['invalid JSON', '{bad'],
    ['truncated JSON', '{"email":"alice@example.com","status":'],
    ['empty body', ''],
    ['whitespace body', '   '],
  ])('%s => 400 "Malformed request body"', async (_n, body) => {
    const res = await direct(env, body)
    expect(res.status).toBe(400)
    const parsed = await json(res)
    expect(parsed).toEqual({ success: false, message: 'Malformed request body' })
    expect(JSON.stringify(parsed)).not.toMatch(/Unexpected|position|SyntaxError/)
    expectSecurityHeaders(res)
    noWrite(env)
  })

  it.each([
    ['null', 'null'],
    ['array', '["alice@example.com","completed"]'],
    ['string', '"completed"'],
    ['number', '42'],
    ['boolean', 'true'],
  ])('non-object body (%s) => 400', async (_n, body) => {
    const res = await direct(env, body)
    expect(res.status).toBe(400)
    expect(await json(res)).toEqual({ success: false, message: 'Request body must be an object' })
    expectSecurityHeaders(res)
    noWrite(env)
  })

  it.each([
    ['missing email', { status: 'completed' }],
    ['empty email', { email: '', status: 'completed' }],
    ['null email', { email: null, status: 'completed' }],
    ['missing status', { email: 'alice@example.com' }],
  ])('%s => 400 "required"', async (_n, body) => {
    const res = await direct(env, JSON.stringify(body))
    expect(res.status).toBe(400)
    expect(await json(res)).toMatchObject({ success: false, message: 'Email and status are required' })
    expectSecurityHeaders(res)
    noWrite(env)
  })

  it.each([
    ['number', 1],
    ['array', ['alice@example.com']],
    ['object', { email: 'alice@example.com' }],
    ['boolean', true],
    ['no @', 'alice.example.com'],
    ['no domain dot', 'alice@example'],
    ['spaces', 'alice @example.com'],
    ['SQL-ish', "' OR '1'='1"],
    ['too long', `${'a'.repeat(250)}@example.com`],
  ])('invalid email (%s) => 400', async (_n, email) => {
    const res = await direct(env, JSON.stringify({ email, status: 'completed' }))
    expect(res.status).toBe(400)
    expect(await json(res)).toEqual({ success: false, message: 'Invalid email address' })
    expectSecurityHeaders(res)
    noWrite(env)
  })

  it.each([
    ['number', 1],
    ['array', ['completed']],
    ['object', { a: 1 }],
    ['boolean', true],
  ])('non-string status (%s) => 400', async (_n, status) => {
    const res = await direct(env, JSON.stringify({ email: 'alice@example.com', status }))
    expect(res.status).toBe(400)
    expect(await json(res)).toEqual({ success: false, message: 'Invalid status value' })
    expectSecurityHeaders(res)
    noWrite(env)
  })

  it('unknown status string => 400 "Invalid status value" (unchanged)', async () => {
    const res = await direct(env, JSON.stringify({ email: 'alice@example.com', status: 'done' }))
    expect(res.status).toBe(400)
    expect(await json(res)).toEqual({ success: false, message: 'Invalid status value' })
    noWrite(env)
  })
})

describe('POST /api/update-training — body size limit', () => {
  it('rejects a body larger than 10 KB with 413 before parsing', async () => {
    const big = JSON.stringify({ email: 'alice@example.com', status: 'completed', pad: 'x'.repeat(MAX_UPDATE_BODY_BYTES) })
    const res = await direct(env, big)
    expect(res.status).toBe(413)
    expect(await json(res)).toEqual({ success: false, message: 'Request body too large' })
    expectSecurityHeaders(res)
    noWrite(env)
  })

  it('counts bytes, not characters (multi-byte padding over the limit => 413)', async () => {
    const pad = 'é'.repeat(Math.ceil(MAX_UPDATE_BODY_BYTES / 2) + 10) // < limit chars, > limit bytes
    const body = JSON.stringify({ email: 'alice@example.com', status: 'completed', pad })
    expect(body.length).toBeLessThan(MAX_UPDATE_BODY_BYTES)
    expect((await direct(env, body)).status).toBe(413)
    noWrite(env)
  })

  it('accepts a body of exactly 10 KB', async () => {
    const base = JSON.stringify({ email: 'alice@example.com', status: 'completed', pad: '' })
    const body = JSON.stringify({ email: 'alice@example.com', status: 'completed', pad: 'x'.repeat(MAX_UPDATE_BODY_BYTES - base.length) })
    expect(new TextEncoder().encode(body).length).toBe(MAX_UPDATE_BODY_BYTES)
    const res = await direct(env, body)
    expect(res.status).toBe(200)
    expect(env.DB.status('alice')).toBe('completed')
  })
})

describe('POST /api/update-training — outcomes', () => {
  it('200 on success with the documented contract and security headers', async () => {
    const res = await direct(env, JSON.stringify({ email: 'alice@example.com', status: 'completed' }))
    expect(res.status).toBe(200)
    expect(await json(res)).toEqual({ success: true, message: 'Training status updated successfully' })
    expectSecurityHeaders(res)
    expect(env.DB.status('alice')).toBe('completed')
  })

  it('404 when the user is not found (unchanged)', async () => {
    const res = await direct(env, JSON.stringify({ email: 'ghost@example.com', status: 'completed' }))
    expect(res.status).toBe(404)
    expect(await json(res)).toEqual({ success: false, message: 'User not found or update failed' })
    expectSecurityHeaders(res)
    expect(env.DB.status('alice')).toBe('not started')
  })

  it('500 with a generic message only for real internal errors', async () => {
    dbThrow.error = new Error('SECRET internal detail')
    const res = await direct(env, JSON.stringify({ email: 'alice@example.com', status: 'completed' }))
    expect(res.status).toBe(500)
    const text = await res.text()
    expect(JSON.parse(text)).toEqual({ success: false, message: 'Internal server error' })
    expect(text).not.toContain('SECRET')
    expectSecurityHeaders(res)
  })

  it('end-to-end through the router: malformed JSON from an authenticated admin is a 400', async () => {
    const res = await call(env, '/api/update-training', postJson('{bad', await authedHeaders()))
    expect(res.status).toBe(400)
    expectSecurityHeaders(res)
    noWrite(env)
  })

  it('end-to-end through the router: oversized body is a 413', async () => {
    const res = await call(env, '/api/update-training', postJson('x'.repeat(MAX_UPDATE_BODY_BYTES + 1), await authedHeaders()))
    expect(res.status).toBe(413)
    noWrite(env)
  })
})
