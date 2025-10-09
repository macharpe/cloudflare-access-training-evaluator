/**
 * Core Type Definitions for Cloudflare Access Training Evaluator
 *
 * This file contains all TypeScript interfaces and types for the Worker.
 */

/**
 * Cloudflare Workers Environment Bindings
 *
 * Defines all environment variables, secrets, and bindings
 * available to the Worker at runtime.
 */
export interface Env {
  // Environment Variables (from wrangler.jsonc vars)
  TEAM_DOMAIN: string
  ADMIN_DOMAIN: string
  OKTA_DOMAIN: string
  DEBUG: boolean
  OKTA_FETCH_LIMIT?: number

  // Secrets (configured via wrangler secret put)
  RSA_PRIVATE_KEY: string
  OKTA_API_TOKEN: string
  ACCESS_APP_AUD: string

  // Cloudflare Bindings
  KEY_STORAGE: KVNamespace
  DB: D1Database
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
 * D1 Query Result for User
 *
 * D1 database query result structure.
 */
export interface D1Result<T> {
  results: T[]
  success: boolean
  meta: {
    duration: number
    rows_read: number
    rows_written: number
  }
}

/**
 * External Evaluation Request
 *
 * Incoming request from Cloudflare Access for evaluation.
 */
export interface ExternalEvaluationRequest {
  token: string
}

/**
 * External Evaluation Response
 *
 * Signed JWT response returned to Cloudflare Access.
 */
export interface ExternalEvaluationResponse {
  success: boolean
  challenge?: string
  error?: string
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
 * Okta Group Object
 *
 * Group object returned from Okta API.
 */
export interface OktaGroup {
  id: string
  created: string
  lastUpdated: string
  lastMembershipUpdated: string
  objectClass: string[]
  type: string
  profile: {
    name: string
    description: string
  }
  _links: {
    logo: Array<{ name: string; href: string; type: string }>
    users: { href: string }
    apps: { href: string }
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

/**
 * Metrics Data Structure
 *
 * Tracks performance metrics for monitoring.
 */
export interface Metrics {
  requests: {
    total: number
    byEndpoint: Record<string, number>
  }
  authentication: {
    success: number
    failure: number
  }
  database: {
    queries: number
    errors: number
  }
  cache: {
    hits: number
    misses: number
  }
  okta: {
    userFetches: number
    groupFetches: number
    syncOperations: number
  }
}

/**
 * Structured Log Entry
 *
 * JSON log format for observability.
 */
export interface LogEntry {
  timestamp: string
  level: 'info' | 'warn' | 'error' | 'debug'
  message: string
  context?: Record<string, unknown>
  requestId?: string
  duration?: number
}

/**
 * API Response Wrapper
 *
 * Standard response structure for admin API endpoints.
 */
export interface ApiResponse<T = unknown> {
  success: boolean
  data?: T
  error?: string
  timestamp: string
}

/**
 * Okta Sync Statistics
 *
 * Results from Okta user synchronization.
 */
export interface SyncStats {
  usersAdded: number
  usersUpdated: number
  usersRemoved: number
  errors: string[]
}
