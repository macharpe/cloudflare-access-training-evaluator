// the key in KV that holds the generated signing keys
const KV_SIGNING_KEY = 'external_auth_keys'

/**
 * Generate a key id for the key set
 * @param {string} publicKey - Public key string
 * @returns {string} Key ID
 */
async function generateKID(publicKey) {
  const msgUint8 = new TextEncoder().encode(publicKey)
  const hashBuffer = await crypto.subtle.digest('SHA-1', msgUint8)
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  const hashHex = hashArray.map((b) => b.toString(16).padStart(2, '0')).join('')
  return hashHex.substring(0, 64)
}

/**
 * Generate a key pair and stores them securely (public key in KV, private key in secrets)
 * @param {*} env - Environment bindings
 * @returns {Object} Generated key information
 */
export async function generateKeys(env) {
  console.log('generating a new signing key pair')
  try {
    const keypair = await crypto.subtle.generateKey(
      {
        name: 'RSASSA-PKCS1-v1_5',
        modulusLength: 2048,
        publicExponent: new Uint8Array([1, 0, 1]),
        hash: 'SHA-256',
      },
      true,
      ['sign', 'verify'],
    )
    const publicKey = await crypto.subtle.exportKey('jwk', keypair.publicKey)
    const privateKey = await crypto.subtle.exportKey('jwk', keypair.privateKey)
    const kid = await generateKID(JSON.stringify(publicKey))

    // Store only public key and kid in KV (secure)
    await env.KEY_STORAGE.put(
      KV_SIGNING_KEY,
      JSON.stringify({ public: publicKey, kid: kid }),
    )

    console.log(
      'SECURITY WARNING: Private key generated but not stored. You must manually set RSA_PRIVATE_KEY secret.',
    )
    console.log('Run: wrangler secret put RSA_PRIVATE_KEY')
    console.log('Private key JWK:', JSON.stringify(privateKey))

    return { keypair, publicKey, privateKey, kid }
  } catch (e) {
    console.log('failed to generate keyset', e)
    throw 'failed to generate keyset'
  }
}

/**
 * Get the public key in JWK format
 * @param {*} env - Environment bindings
 * @returns {Object} Public key in JWK format
 */
export async function loadPublicKey(env) {
  // if the JWK values are already in KV then just return that
  const key = await env.KEY_STORAGE.get(KV_SIGNING_KEY, 'json')
  if (key) {
    return { kid: key.kid, ...key.public }
  }

  // otherwise generate keys and store the public key in KV
  const { kid, publicKey } = await generateKeys(env)
  return { kid, ...publicKey }
}
