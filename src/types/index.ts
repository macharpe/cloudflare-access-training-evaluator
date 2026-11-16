/**
 * Core Type Definitions for Cloudflare Access Training Evaluator
 *
 * This file contains all TypeScript interfaces and types for the Worker.
 */

/**
 * Cloudflare Workers Environment Bindings
 *
 * The bindings, vars and secret names come from the generated
 * `worker-configuration.d.ts` (`npm run types`, which reads `wrangler.jsonc`
 * and the secret names in `.dev.vars.example`). Do not hand-write bindings
 * here: add them to the Wrangler config and regenerate. Only optional
 * settings that are not part of the deployed config are declared below.
 */
export type Env = Cloudflare.Env & {
  /** Optional page size for Okta list calls (default and maximum 200) */
  OKTA_FETCH_LIMIT?: number
  /** Set to `development` for plain-http local dev only (see security/csp.ts) */
  ENVIRONMENT?: string
}

/**
 * Cloudflare Access JWT Claims
 *
 * Standard claims included in Access-issued JWT tokens.
 * @see https://developers.cloudflare.com/cloudflare-one/identity/authorization-cookie/validating-json/
 */
export interface AccessClaims {
  /** User's email address from identity provider */
  email: string

  /** Token expiration timestamp (seconds since epoch) */
  exp: number

  /** Token issued-at timestamp (seconds since epoch) */
  iat: number

  /** Token nonce for replay protection */
  nonce: string

  /** Access Application Audience tag */
  aud: string | string[]

  /** Token issuer (Cloudflare Access domain) */
  iss: string

  /** Subject (user ID) */
  sub: string

  /** Identity information */
  identity: {
    email: string
    name?: string
    groups?: string[]
  }

  /** Custom claims may be present */
  [key: string]: unknown
}

/**
 * Decoded JWT Structure
 *
 * Generic JWT token structure with typed header, payload, and signature.
 */
export interface DecodedJWT<T = AccessClaims> {
  header: JWTHeader
  payload: T
  signature: string
  raw: {
    header: string
    payload: string
    signature: string
  }
}

/**
 * JWT Header
 *
 * Standard JOSE header for JWT tokens.
 */
export interface JWTHeader {
  /** Algorithm used for signing */
  alg: string

  /** Key ID for signature verification */
  kid: string

  /** Token type (always "JWT") */
  typ: string
}

/**
 * JSON Web Key (JWK) Structure
 *
 * Represents a public key in JWK format.
 * @see https://tools.ietf.org/html/rfc7517
 */
export interface JWK {
  /** Key type (e.g., "RSA") */
  kty: string

  /** Key ID for identification */
  kid: string

  /** Algorithm (e.g., "RS256") */
  alg: string

  /** Key usage (e.g., "sig" for signature) */
  use: string

  /** RSA public exponent (base64url) */
  e: string

  /** RSA modulus (base64url) */
  n: string
}

/**
 * JWK Set (JWKS)
 *
 * Collection of public keys from Cloudflare Access.
 */
export interface JWKS {
  keys: JWK[]
  public_cert?: {
    kid: string
    cert: string
  }
}

/**
 * Training Status Values
 *
 * Possible states for user training completion.
 */
export type TrainingStatus = 'not started' | 'started' | 'completed'

/**
 * User Database Record
 *
 * Represents a user in the D1 training database.
 */
export interface User {
  id: number
  username: string
  first_name: string | null
  primary_email: string | null
  training_status: TrainingStatus
  created_at: string
  updated_at: string
}

/**
 * Okta User Profile
 *
 * User object returned from Okta API.
 * @see https://developer.okta.com/docs/reference/api/users/#user-object
 */
export interface OktaUser {
  id: string
  status: string
  created: string
  activated: string | null
  statusChanged: string | null
  lastLogin: string | null
  lastUpdated: string
  passwordChanged: string | null
  profile: {
    firstName: string
    lastName: string
    email: string
    login: string
    mobilePhone: string | null
  }
  credentials?: {
    provider: {
      type: string
      name: string
    }
  }
  _links: {
    self: { href: string }
  }
}

/**
 * Cache Entry with TTL
 *
 * Generic cached value with expiration.
 */
export interface CacheEntry<T> {
  value: T
  expiresAt: number
}
