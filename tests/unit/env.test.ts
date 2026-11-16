import { describe, expect, it } from 'vitest'
import { isDebugEnabled } from '../../src/utils/env'

describe('isDebugEnabled', () => {
  it.each([true, 'true', 'TRUE', 'True', '1', 'yes', 'YES', 'on', 'On', ' true '])('%j => true', (DEBUG) => {
    expect(isDebugEnabled({ DEBUG })).toBe(true)
  })

  it.each([false, 'false', 'FALSE', '', '0', 'no', 'off', 'enabled', 0, 1, null, undefined, {}, []])(
    '%j => false',
    (DEBUG) => {
      expect(isDebugEnabled({ DEBUG })).toBe(false)
    },
  )

  it('handles a missing env or DEBUG key', () => {
    expect(isDebugEnabled(undefined)).toBe(false)
    expect(isDebugEnabled(null)).toBe(false)
    expect(isDebugEnabled({})).toBe(false)
  })
})
