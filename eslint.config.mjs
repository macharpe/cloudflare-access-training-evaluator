import js from '@eslint/js'
import tsPlugin from '@typescript-eslint/eslint-plugin'
import tsParser from '@typescript-eslint/parser'
import globals from 'globals'

// Flat config (ESLint 9). Type-aware rules run on the Worker source, the React
// dashboard and the tests, each against its own tsconfig.
const typeChecked = tsPlugin.configs['flat/recommended-type-checked']

const project = (tsconfig) => ({
  languageOptions: {
    parser: tsParser,
    parserOptions: { project: tsconfig, tsconfigRootDir: import.meta.dirname },
  },
})

const sharedRules = {
  '@typescript-eslint/no-explicit-any': 'error',
  '@typescript-eslint/no-unused-vars': [
    'error',
    { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
  ],
  // Cloudflare guidance: every promise must be awaited, returned or passed to waitUntil.
  '@typescript-eslint/no-floating-promises': 'error',
  '@typescript-eslint/no-misused-promises': 'error',
  // Fail-open parsing of untrusted JSON is a security smell in this app.
  '@typescript-eslint/no-unsafe-assignment': 'error',
}

export default [
  {
    ignores: [
      'node_modules/',
      'dist/',
      '.ui-build/',
      '.wrangler/',
      'coverage/',
      '.signing-keys/',
      'src/ui-assets.generated.ts',
      'worker-configuration.d.ts',
    ],
  },
  js.configs.recommended,

  // Worker source
  ...typeChecked.map((c) => ({ ...c, files: ['src/**/*.ts'] })),
  {
    files: ['src/**/*.ts'],
    ...project('./tsconfig.json'),
    rules: sharedRules,
  },

  // React dashboard (browser)
  ...typeChecked.map((c) => ({ ...c, files: ['ui/**/*.{ts,tsx}'] })),
  {
    files: ['ui/**/*.{ts,tsx}'],
    ...project('./ui/tsconfig.json'),
    languageOptions: {
      ...project('./ui/tsconfig.json').languageOptions,
      globals: globals.browser,
    },
    rules: sharedRules,
  },

  // Tests of the dashboard logic (browser types, own tsconfig)
  ...typeChecked.map((c) => ({ ...c, files: ['tests/ui/**/*.ts'] })),
  {
    files: ['tests/ui/**/*.ts'],
    ...project('./tests/ui/tsconfig.json'),
    languageOptions: {
      ...project('./tests/ui/tsconfig.json').languageOptions,
      globals: { ...globals.node, ...globals.browser },
    },
    rules: {
      ...sharedRules,
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/unbound-method': 'off',
      '@typescript-eslint/require-await': 'off',
    },
  },

  // Worker tests (Node)
  ...typeChecked.map((c) => ({ ...c, files: ['tests/**/*.ts'], ignores: ['tests/ui/**'] })),
  {
    files: ['tests/**/*.ts'],
    ignores: ['tests/ui/**'],
    ...project('./tests/tsconfig.json'),
    languageOptions: {
      ...project('./tests/tsconfig.json').languageOptions,
      globals: globals.node,
    },
    rules: {
      ...sharedRules,
      // Test doubles and fixtures legitimately cast and poke at unknown shapes.
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/unbound-method': 'off',
      '@typescript-eslint/require-await': 'off',
    },
  },

  // Build/provisioning scripts and configs (plain JS/MJS, Node)
  {
    files: ['scripts/**/*.mjs', '*.mjs', '*.config.mts'],
    languageOptions: { globals: globals.node },
  },
]
