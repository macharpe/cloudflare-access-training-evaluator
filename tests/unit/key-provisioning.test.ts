import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, statSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

describe('local signing-key provisioning', () => {
  it('creates a matching private/public pair without printing secrets and refuses overwrite', async () => {
    const temp = mkdtempSync(path.join(os.tmpdir(), 'training-keys-test-'))
    const output = path.join(temp, 'keys')
    try {
      const stdout = execFileSync(process.execPath, ['scripts/generate-signing-keys.mjs', output], { encoding: 'utf8' })
      const privatePath = path.join(output, 'private-key.json')
      const original = readFileSync(privatePath, 'utf8')
      const privateKey = JSON.parse(original)
      const publicSet = JSON.parse(readFileSync(path.join(output, 'public-keyset.json'), 'utf8'))
      expect(stdout).not.toContain(privateKey.d)
      expect(stdout).not.toContain(privateKey.p)
      expect(publicSet.public).not.toHaveProperty('d')
      expect(publicSet.public.n).toBe(privateKey.n)
      expect(publicSet.public.e).toBe(privateKey.e)
      expect(statSync(privatePath).mode & 0o777).toBe(0o600)
      expect(statSync(output).mode & 0o777).toBe(0o700)
      const kidHash = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(JSON.stringify(publicSet.public)))
      expect(publicSet.kid).toBe(Buffer.from(kidHash).toString('hex'))
      const again = spawnSync(process.execPath, ['scripts/generate-signing-keys.mjs', output], { encoding: 'utf8' })
      expect(again.status).not.toBe(0)
      expect(readFileSync(privatePath, 'utf8')).toBe(original)
      expect(again.stdout + again.stderr).not.toContain(privateKey.d)
    } finally {
      rmSync(temp, { recursive: true, force: true })
    }
  })
})
