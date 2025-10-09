/**
 * Cache utilities for external API calls
 *
 * Provides in-memory caching with TTL to reduce external API calls
 * and improve Worker performance.
 */

import type { CacheEntry, Env } from '../types'

/**
 * In-memory cache storage
 *
 * Note: Cache resets on Worker cold starts (expected behavior)
 */
const memoryCache = new Map<string, CacheEntry<unknown>>()

/**
 * Cache configuration constants
 */
export const CACHE_CONFIG = {
  ACCESS_KEYS: {
    key: 'access_public_keys',
    ttl: 300, // 5 minutes
  },
  OKTA_USERS: {
    key: 'okta_users',
    ttl: 600, // 10 minutes
  },
  OKTA_GROUPS: {
    key: 'okta_groups',
    ttl: 1800, // 30 minutes
  },
} as const

/**
 * Get item from cache
 *
 * @param key - Cache key
 * @returns Cached value or null if not found/expired
 */
export function getCached<T>(key: string): T | null {
  const cached = memoryCache.get(key) as CacheEntry<T> | undefined

  if (!cached) {
    return null
  }

  // Check if expired
  if (Date.now() > cached.expiresAt) {
    memoryCache.delete(key)
    return null
  }

  return cached.value
}

/**
 * Set item in cache
 *
 * @param key - Cache key
 * @param value - Value to cache
 * @param ttlSeconds - Time to live in seconds
 */
export function setCache<T>(key: string, value: T, ttlSeconds: number): void {
  const expiresAt = Date.now() + ttlSeconds * 1000
  memoryCache.set(key, { value, expiresAt } as CacheEntry<unknown>)
}

/**
 * Clear specific cache entry
 *
 * @param key - Cache key to clear
 */
export function clearCache(key: string): void {
  memoryCache.delete(key)
}

/**
 * Clear all cache entries
 */
export function clearAllCache(): void {
  memoryCache.clear()
}

/**
 * Get cache statistics
 *
 * @returns Cache statistics
 */
export function getCacheStats(): {
  total: number
  active: number
  expired: number
} {
  const now = Date.now()
  let expired = 0
  let active = 0

  for (const [, cached] of memoryCache.entries()) {
    if (now > cached.expiresAt) {
      expired++
    } else {
      active++
    }
  }

  return {
    total: memoryCache.size,
    active,
    expired,
  }
}

/**
 * Response-like object for cached data
 */
interface CachedResponse<T> {
  ok: boolean
  status: number
  statusText?: string
  json: () => Promise<T>
  headers: Headers
}

/**
 * Cached fetch wrapper for external API calls
 *
 * @param url - URL to fetch
 * @param options - Fetch options
 * @param cacheKey - Cache key
 * @param ttlSeconds - Cache TTL in seconds
 * @param env - Environment bindings
 * @returns Response (cached or fresh)
 */
export async function cachedFetch<T>(
  url: string,
  options: RequestInit,
  cacheKey: string,
  ttlSeconds: number = 300,
  env?: Env,
): Promise<CachedResponse<T> | Response> {
  // Try to get from cache first
  const cached = getCached<T>(cacheKey)
  if (cached) {
    // Dynamic import to avoid circular dependency
    const { logCache } = await import('./logging.js')
    logCache(true, cacheKey, env)

    // Return a Response-like object for cached data
    return {
      ok: true,
      status: 200,
      json: async () => cached,
      headers: new Headers({ 'x-cache': 'HIT' }),
    }
  }

  // Dynamic import to avoid circular dependency
  const { logCache } = await import('./logging.js')
  logCache(false, cacheKey, env)

  // Fetch fresh data
  const response = await fetch(url, options)

  if (response.ok) {
    const data = (await response.json()) as T
    setCache(cacheKey, data, ttlSeconds)

    // Return enhanced response
    return {
      ok: true,
      status: response.status,
      statusText: response.statusText,
      json: async () => data,
      headers: new Headers([
        ...Array.from(response.headers.entries()),
        ['x-cache', 'MISS'],
      ]),
    }
  }

  // Don't cache errors, return original response
  return response
}
