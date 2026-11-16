import { afterEach, beforeEach, vi } from 'vitest'
import { clearAllCache } from '../src/utils/cache'
import { resetMetrics } from '../src/utils/logging'

// Keep test output readable; tests that care can inspect the spies.
beforeEach(() => {
  clearAllCache()
  resetMetrics()
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

// The generated UI bundle is produced by `npm run build:ui` and is git-ignored.
// Tests must not depend on a prior build, so stub it if/when the Worker imports it.
vi.mock('../src/ui-assets.generated', () => ({
  ADMIN_JS: '/* test admin js */',
  ADMIN_CSS: '/* test admin css */',
}))
