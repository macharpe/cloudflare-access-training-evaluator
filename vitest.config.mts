import { defineConfig } from 'vitest/config'

// Unit/regression tests run in plain Node (>= 22 for node:sqlite). Node already
// provides the Web Crypto, fetch, Request/Response and Headers globals the
// Worker code relies on, so no Workers runtime is needed. External services
// (D1, KV, Okta, Access certs) are replaced by in-process fakes in tests/helpers.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    setupFiles: ['tests/setup.ts'],
    clearMocks: true,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.generated.ts', 'src/types/**'],
      reporter: ['text', 'html'],
    },
  },
})
