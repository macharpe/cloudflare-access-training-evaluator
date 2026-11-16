import { describe, expect, it } from 'vitest'
import {
  extractUsername,
  isValidEmail,
  isValidGroupId,
  isValidOktaDomain,
  sanitizeForLogging,
} from '../../src/utils/validation'
import { isTrainingStatus } from '../../src/types/guards'

describe('isValidEmail', () => {
  it.each(['a@b.co', 'first.last+tag@sub.example.com'])('accepts %s', (e) => {
    expect(isValidEmail(e)).toBe(true)
  })
  it.each(['', 'nope', 'a@b', 'a b@c.com', '@x.com', null, undefined, 42, {}])(
    'rejects %j',
    (e) => {
      expect(isValidEmail(e)).toBe(false)
    },
  )
  it('rejects addresses over 254 characters', () => {
    expect(isValidEmail(`${'a'.repeat(250)}@b.co`)).toBe(false)
  })
})

describe('extractUsername', () => {
  it('lower-cases and trims the local part', () => {
    expect(extractUsername('Alice.Smith@Example.com')).toBe('alice.smith')
  })
  it('throws on invalid email', () => {
    expect(() => extractUsername('not-an-email')).toThrow('Invalid email format')
  })
  it('rejects usernames over 64 chars', () => {
    expect(() => extractUsername(`${'a'.repeat(65)}@x.com`)).toThrow(/too long/)
  })
  it.each(['a+b@x.com', "a'b@x.com", 'a"b@x.com', 'a%b@x.com'])(
    'rejects unsafe characters in %s',
    (email) => {
      expect(() => extractUsername(email)).toThrow('invalid characters')
    },
  )
})

describe('training status validation', () => {
  it.each(['not started', 'started', 'completed'])('accepts %s', (s) => {
    expect(isTrainingStatus(s)).toBe(true)
  })
  it.each(['Completed', 'COMPLETED', ' completed', 'done', '', null, undefined, 1, [], 'constructor'])(
    'rejects %j',
    (s) => {
      expect(isTrainingStatus(s)).toBe(false)
    },
  )
})

describe('sanitizeForLogging', () => {
  it('strips CR/LF/tab and control chars to prevent log injection', () => {
    expect(sanitizeForLogging('a\r\nFAKE LOG\tx\u0000y')).toBe('a  FAKE LOG xy')
  })
  it('truncates to 200 chars', () => {
    expect(sanitizeForLogging('x'.repeat(500))).toHaveLength(200)
  })
  it('stringifies non-strings', () => {
    expect(sanitizeForLogging(undefined)).toBe('')
    expect(sanitizeForLogging(null)).toBe('')
  })
})

describe('Okta input validators', () => {
  it('accepts normal Okta domains and rejects malformed ones', () => {
    expect(isValidOktaDomain('acme.okta.com')).toBe(true)
    for (const bad of ['acme', 'acme.okta.com/evil', 'acme.okta.com:443', 'a b.com', '', null, 'https://acme.okta.com', 'evil.com@acme.okta.com']) {
      expect(isValidOktaDomain(bad)).toBe(false)
    }
  })
  it('accepts normal group ids and rejects path traversal / injection', () => {
    expect(isValidGroupId('00g1abcXYZ')).toBe(true)
    for (const bad of ['', '../users', 'a/b', 'a?b=1', 'a b', 'a%2Fb', 'x'.repeat(256), null, 5]) {
      expect(isValidGroupId(bad)).toBe(false)
    }
  })
})
