import { webcrypto } from 'node:crypto'
import { mkdir, writeFile, rm } from 'node:fs/promises'
import path from 'node:path'

// Local-only provisioning: no Cloudflare calls, no private material on stdout.
// mkdir (without recursive) refuses to overwrite an existing key directory.
const output = path.resolve(process.argv[2] ?? '.signing-keys')
await mkdir(output, { mode: 0o700 })
try {
  const pair = await webcrypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true,
    ['sign', 'verify'],
  )
  const publicKey = await webcrypto.subtle.exportKey('jwk', pair.publicKey)
  const privateKey = await webcrypto.subtle.exportKey('jwk', pair.privateKey)
  // Match src/auth/keys.ts so both provisioning paths use the same key ID.
  const digest = await webcrypto.subtle.digest('SHA-1', new TextEncoder().encode(JSON.stringify(publicKey)))
  const kid = Buffer.from(digest).toString('hex')
  await writeFile(path.join(output, 'private-key.json'), JSON.stringify(privateKey), { mode: 0o600, flag: 'wx' })
  await writeFile(path.join(output, 'public-keyset.json'), JSON.stringify({ public: publicKey, kid }), { mode: 0o600, flag: 'wx' })
  console.log(`Signing key files created in ${output}. No credentials uploaded. Keep private-key.json secret.`)
} catch {
  // Remove only files inside the directory this invocation just created.
  await rm(output, { recursive: true, force: true })
  // Do not print exception objects: keep secret material out of output paths.
  console.error('Could not create signing key files. No credentials uploaded.')
  process.exitCode = 1
}
