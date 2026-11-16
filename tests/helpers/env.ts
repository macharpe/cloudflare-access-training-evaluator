import type { Env } from '../../src/types'
import { TestD1 } from './d1'

export class FakeKV {
  readonly store = new Map<string, string>()

  async get(key: string, type?: string): Promise<unknown> {
    const value = this.store.get(key)
    if (value === undefined) return null
    return type === 'json' ? JSON.parse(value) : value
  }

  async put(key: string, value: string): Promise<void> {
    this.store.set(key, value)
  }
}

export interface TestEnv extends Env {
  DB: D1Database & TestD1
  KEY_STORAGE: KVNamespace & FakeKV
}

export const TEST_TEAM_DOMAIN = 'team.example.cloudflareaccess.com'
export const TEST_AUD = 'test-access-aud'
export const TEST_OKTA_DOMAIN = 'example.okta.com'

export function createEnv(overrides: Partial<Env> = {}): TestEnv {
  const db = new TestD1().withSchema()
  return {
    TEAM_DOMAIN: TEST_TEAM_DOMAIN,
    ADMIN_DOMAIN: 'admin.example.com',
    OKTA_DOMAIN: TEST_OKTA_DOMAIN,
    DEBUG: false,
    RSA_PRIVATE_KEY: '',
    OKTA_API_TOKEN: 'test-okta-token',
    ACCESS_APP_AUD: TEST_AUD,
    KEY_STORAGE: new FakeKV() as unknown as KVNamespace & FakeKV,
    DB: db as unknown as D1Database & TestD1,
    ...overrides,
  } as TestEnv
}
