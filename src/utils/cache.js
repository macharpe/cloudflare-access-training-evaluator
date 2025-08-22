/**
 * Cache utilities for external API calls
 */

// In-memory cache for the worker instance (resets on cold starts)
const memoryCache = new Map()

/**
 * Cache configuration
 */
const CACHE_CONFIG = {
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
}

/**
 * Get item from cache
 * @param {string} key - Cache key
 * @returns {*} Cached value or null if not found/expired
 */
export function getCached(key) {
  const cached = memoryCache.get(key)

  if (!cached) {
    return null
  }

  // Check if expired
  if (Date.now() > cached.expires) {
    memoryCache.delete(key)
    return null
  }

  return cached.value
}

/**
 * Set item in cache
 * @param {string} key - Cache key
 * @param {*} value - Value to cache
 * @param {number} ttlSeconds - Time to live in seconds
 */
export function setCache(key, value, ttlSeconds) {
  const expires = Date.now() + ttlSeconds * 1000
  memoryCache.set(key, { value, expires })
}

/**
 * Clear specific cache entry
 * @param {string} key - Cache key to clear
 */
export function clearCache(key) {
  memoryCache.delete(key)
}

/**
 * Clear all cache entries
 */
export function clearAllCache() {
  memoryCache.clear()
}

/**
 * Get cache statistics
 * @returns {Object} Cache statistics
 */
export function getCacheStats() {
  const now = Date.now()
  let expired = 0
  let active = 0

  for (const [key, cached] of memoryCache.entries()) {
    if (now > cached.expires) {
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
 * Cached fetch wrapper for external API calls
 * @param {string} url - URL to fetch
 * @param {Object} options - Fetch options
 * @param {string} cacheKey - Cache key
 * @param {number} ttlSeconds - Cache TTL in seconds
 * @returns {Promise<Response>} Response (cached or fresh)
 */
export async function cachedFetch(
  url,
  options = {},
  cacheKey,
  ttlSeconds = 300,
  env = {},
) {
  // Try to get from cache first
  const cached = getCached(cacheKey)
  if (cached) {
    // Import here to avoid circular dependency
    const { logCache } = await import('./logging.js')
    logCache(true, cacheKey, env)

    // Return a mock Response-like object for cached data
    return {
      ok: true,
      status: 200,
      json: async () => cached,
      headers: new Headers({ 'x-cache': 'HIT' }),
    }
  }

  // Import here to avoid circular dependency
  const { logCache } = await import('./logging.js')
  logCache(false, cacheKey, env)

  // Fetch fresh data
  const response = await fetch(url, options)

  if (response.ok) {
    const data = await response.json()
    setCache(cacheKey, data, ttlSeconds)

    // Return enhanced response
    return {
      ok: true,
      status: response.status,
      statusText: response.statusText,
      json: async () => data,
      headers: new Headers([...response.headers, ['x-cache', 'MISS']]),
    }
  }

  // Don't cache errors, return original response
  return response
}

export { CACHE_CONFIG }
