import { describe, expect, it } from 'vitest'
import {
  getUserTrainingStatusByEmail,
  initializeDatabase,
  updateUserTrainingStatusByEmail,
} from '../../src/database/training'
import { TestD1 } from '../helpers/d1'
import { createEnv } from '../helpers/env'

describe('status validation', () => {
  it.each(['Completed', 'done', '', 'completed; DROP TABLE users', 'constructor'])(
    'rejects invalid status %j and writes nothing',
    async (bad) => {
      const env = createEnv()
      env.DB.seed('alice', 'not started')
      expect(await updateUserTrainingStatusByEmail(env, 'alice@example.com', bad as never)).toBe(false)
      expect(env.DB.status('alice')).toBe('not started')
      expect(env.DB.calls).toHaveLength(0) // rejected before reaching the DB
    },
  )

  it('the schema CHECK constraint is an independent backstop', () => {
    const db = new TestD1().withSchema()
    expect(() => db.seed('x', 'granted' as never)).toThrow(/CHECK/)
  })
})

describe('getUserTrainingStatusByEmail', () => {
  it('returns the stored status or null, matching the full email case-insensitively', async () => {
    const env = createEnv()
    env.DB.seed('alice', 'started', null, 'Alice@Example.com')
    expect(await getUserTrainingStatusByEmail(env, 'alice@example.com')).toBe('started')
    expect(await getUserTrainingStatusByEmail(env, 'ALICE@EXAMPLE.COM')).toBe('started')
    expect(await getUserTrainingStatusByEmail(env, 'nobody@example.com')).toBeNull()
  })
  it('does not match on the local part alone', async () => {
    const env = createEnv()
    env.DB.seed('alice', 'completed', null, 'alice@a.com')
    expect(await getUserTrainingStatusByEmail(env, 'alice@b.com')).toBeNull()
    expect(await getUserTrainingStatusByEmail(env, 'alice')).toBeNull()
  })
  it('does not treat SQL metacharacters or LIKE wildcards as syntax', async () => {
    const env = createEnv()
    env.DB.seed('alice', 'completed', null, 'alice@example.com')
    expect(await getUserTrainingStatusByEmail(env, "x' OR '1'='1")).toBeNull()
    expect(await getUserTrainingStatusByEmail(env, '%')).toBeNull()
  })
  it('fails closed (null) when several rows share the email', async () => {
    const env = createEnv()
    env.DB.seed('alice', 'completed', null, 'shared@example.com')
    env.DB.seed('alice2', 'completed', null, 'SHARED@example.com')
    expect(await getUserTrainingStatusByEmail(env, 'shared@example.com')).toBeNull()
  })
  it('returns null on database errors', async () => {
    const env = createEnv()
    env.DB.failWhen(() => new Error('boom'))
    expect(await getUserTrainingStatusByEmail(env, 'alice@example.com')).toBeNull()
  })
})

describe('updates', () => {
  it('update by email changes only the matching user', async () => {
    const env = createEnv()
    env.DB.seed('alice', 'not started')
    env.DB.seed('bob', 'completed')
    expect(await updateUserTrainingStatusByEmail(env, 'alice@example.com', 'started')).toBe(true)
    expect(env.DB.status('alice')).toBe('started')
    expect(env.DB.status('bob')).toBe('completed')
  })

  it('returns false when no row matched (does not report phantom success)', async () => {
    const env = createEnv()
    expect(await updateUserTrainingStatusByEmail(env, 'ghost@example.com', 'completed')).toBe(false)
  })

  it('returns false on DB errors', async () => {
    const env = createEnv()
    env.DB.seed('alice')
    env.DB.failWhen(() => new Error('boom'))
    expect(await updateUserTrainingStatusByEmail(env, 'alice@example.com', 'completed')).toBe(false)
  })

  it('email match is exact and case-sensitive, and uses a bound parameter', async () => {
    const env = createEnv()
    env.DB.seed('alice', 'not started', null, 'alice@example.com')
    expect(await updateUserTrainingStatusByEmail(env, 'ALICE@example.com', 'completed')).toBe(false)
    expect(await updateUserTrainingStatusByEmail(env, "' OR 1=1 --", 'completed')).toBe(false)
    expect(env.DB.status('alice')).toBe('not started')
  })

  it('CHARACTERISATION: update-by-email touches every row sharing that email (primary_email is not UNIQUE)', async () => {
    const env = createEnv()
    env.DB.seed('alice', 'not started', null, 'shared@example.com')
    env.DB.seed('alice2', 'not started', null, 'shared@example.com')
    await updateUserTrainingStatusByEmail(env, 'shared@example.com', 'completed')
    expect(env.DB.status('alice')).toBe('completed')
    expect(env.DB.status('alice2')).toBe('completed')
  })
})

describe('initializeDatabase', () => {
  it('creates the schema on an empty database, enforcing the status CHECK', async () => {
    const env = createEnv({ DB: new TestD1() as never })
    expect(await initializeDatabase(env)).toBe(true)
    ;(env.DB as unknown as TestD1).seed('a', 'completed')
    expect(() => (env.DB as unknown as TestD1).sqlite.exec(`UPDATE users SET training_status='x'`)).toThrow(/CHECK/)
  })
  it('is idempotent and never wipes existing data (duplicate ALTERs are tolerated)', async () => {
    const env = createEnv()
    env.DB.seed('alice', 'completed')
    expect(await initializeDatabase(env)).toBe(true)
    expect(await initializeDatabase(env)).toBe(true)
    expect(env.DB.status('alice')).toBe('completed')
    expect(env.DB.callsMatching(/DROP|DELETE/i)).toHaveLength(0)
  })
  it('returns false when table creation fails', async () => {
    const env = createEnv()
    env.DB.failWhen((c) => (/CREATE TABLE/.test(c.sql) ? new Error('nope') : undefined))
    expect(await initializeDatabase(env)).toBe(false)
  })
})
