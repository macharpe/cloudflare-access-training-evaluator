import { describe, expect, it, vi } from 'vitest'
import { externalEvaluation } from '../../src/auth/evaluation'
import { accessClaims } from '../helpers/jwt'
import { createEnv } from '../helpers/env'

describe('externalEvaluation — only `completed` grants access', () => {
  it.each([
    ['completed', true],
    ['started', false],
    ['not started', false],
  ] as const)('status %s => %s', async (status, expected) => {
    const env = createEnv()
    env.DB.seed('alice', status, null, 'alice@example.com')
    expect(await externalEvaluation(accessClaims({ email: 'alice@example.com' }), env)).toBe(expected)
  })

  it('denies users that are not in the database', async () => {
    expect(await externalEvaluation(accessClaims({ email: 'ghost@example.com' }), createEnv())).toBe(false)
  })

  it('matches the full email case-insensitively', async () => {
    const env = createEnv()
    env.DB.seed('alice.smith', 'completed', null, 'alice.smith@example.com')
    expect(await externalEvaluation(accessClaims({ identity: { email: 'Alice.Smith@Example.COM' } }), env)).toBe(true)
    const env2 = createEnv()
    env2.DB.seed('alice.smith', 'completed', null, 'Alice.Smith@Example.com')
    expect(await externalEvaluation(accessClaims({ identity: { email: 'alice.smith@example.com' } }), env2)).toBe(true)
  })

  it('the email domain matters: alice@a.com and alice@b.com are independent identities', async () => {
    const env = createEnv()
    env.DB.seed('alice', 'completed', null, 'alice@a.com')
    expect(await externalEvaluation(accessClaims({ identity: { email: 'alice@a.com' } }), env)).toBe(true)
    expect(await externalEvaluation(accessClaims({ identity: { email: 'alice@b.com' } }), env)).toBe(false)
    expect(await externalEvaluation(accessClaims({ identity: { email: 'alice@other-domain.org' } }), env)).toBe(false)
  })

  it('a same-local-part user with a different domain never inherits completed', async () => {
    const env = createEnv()
    env.DB.seed('alice', 'not started', null, 'alice@b.com')
    expect(await externalEvaluation(accessClaims({ identity: { email: 'alice@b.com' } }), env)).toBe(false)
    expect(await externalEvaluation(accessClaims({ identity: { email: 'alice@a.com' } }), env)).toBe(false)
  })

  it('denies (fail closed) when more than one row matches the same email', async () => {
    const env = createEnv()
    env.DB.seed('alice', 'completed', null, 'shared@example.com')
    env.DB.seed('alice2', 'completed', null, 'Shared@Example.com')
    expect(await externalEvaluation(accessClaims({ identity: { email: 'shared@example.com' } }), env)).toBe(false)
    expect(console.warn).toHaveBeenCalled()
  })

  it('denies users whose row has no stored email', async () => {
    const env = createEnv()
    env.DB.seed('alice', 'completed', null, null)
    expect(await externalEvaluation(accessClaims(), env)).toBe(false)
  })

  it('denies when claims lack an identity email', async () => {
    const env = createEnv()
    env.DB.seed('alice', 'completed', null, 'alice@example.com')
    const claims = accessClaims() as unknown as Record<string, unknown>
    delete claims['identity']
    expect(await externalEvaluation(claims as never, env)).toBe(false)
    expect(await externalEvaluation({ ...accessClaims(), identity: {} } as never, env)).toBe(false)
    expect(await externalEvaluation(null as never, env)).toBe(false)
  })

  it('uses identity.email, not the top-level email claim', async () => {
    const env = createEnv()
    env.DB.seed('victim', 'completed', null, 'victim@example.com')
    env.DB.seed('attacker', 'not started', null, 'attacker@example.com')
    const claims = accessClaims({ email: 'victim@example.com', identity: { email: 'attacker@example.com' } })
    expect(await externalEvaluation(claims, env)).toBe(false)
  })

  it.each(['bad email', "a'b@", ''])('denies invalid identity email %j without touching the DB', async (email) => {
    const env = createEnv()
    expect(await externalEvaluation(accessClaims({ identity: { email } }), env)).toBe(false)
    expect(env.DB.calls).toHaveLength(0)
  })

  it('plus-addressed emails are valid but only match a row that stores that exact email', async () => {
    const env = createEnv()
    env.DB.seed('ab', 'completed', null, 'ab@example.com')
    expect(await externalEvaluation(accessClaims({ identity: { email: 'a+b@example.com' } }), env)).toBe(false)
    expect(await externalEvaluation(accessClaims({ identity: { email: 'ab+tag@example.com' } }), env)).toBe(false)
  })

  it('fails closed on database errors', async () => {
    const env = createEnv()
    env.DB.seed('alice', 'completed', null, 'alice@example.com')
    env.DB.failWhen(() => new Error('D1 unavailable'))
    expect(await externalEvaluation(accessClaims(), env)).toBe(false)
  })

  it('fails closed on an unexpected status value (never truthy-coerces)', async () => {
    const env = createEnv()
    vi.spyOn(env.DB, 'prepare').mockReturnValue({
      bind: () => ({ all: async () => ({ results: [{ training_status: 'Completed' }] }) }),
    } as never)
    expect(await externalEvaluation(accessClaims(), env)).toBe(false)
  })

  it('binds the email as a parameter, matching on lower(primary_email)', async () => {
    const env = createEnv()
    env.DB.seed('alice', 'completed', null, 'alice@example.com')
    await externalEvaluation(accessClaims({ identity: { email: 'alice@example.com' } }), env)
    const call = env.DB.callsMatching(/SELECT training_status/)[0]!
    expect(call.sql).toContain('lower(primary_email) = lower(?)')
    expect(call.params).toEqual(['alice@example.com'])
  })

  it('treats SQL metacharacters in the email as invalid, before any DB access', async () => {
    const env = createEnv()
    env.DB.seed('alice', 'completed', null, 'alice@example.com')
    expect(await externalEvaluation(accessClaims({ identity: { email: "x' OR '1'='1@example.com" } }), env)).toBe(false)
  })
})
