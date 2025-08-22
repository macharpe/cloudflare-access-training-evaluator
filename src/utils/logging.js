/**
 * Structured logging and metrics utilities
 */

import { sanitizeForLogging } from './validation.js'
import { getCacheStats } from './cache.js'

/**
 * Log levels
 */
export const LOG_LEVELS = {
  ERROR: 'error',
  WARN: 'warn',
  INFO: 'info',
  DEBUG: 'debug',
}

/**
 * Metrics counters (in-memory, resets on cold starts)
 */
const metrics = {
  requests: {
    total: 0,
    successful: 0,
    failed: 0,
    byEndpoint: {},
  },
  auth: {
    attempts: 0,
    successes: 0,
    failures: 0,
  },
  database: {
    queries: 0,
    errors: 0,
  },
  cache: {
    hits: 0,
    misses: 0,
  },
  okta: {
    apiCalls: 0,
    usersSynced: 0,
    errors: 0,
  },
}

/**
 * Structured log entry
 * @param {string} level - Log level
 * @param {string} message - Log message
 * @param {Object} metadata - Additional metadata
 * @param {*} env - Environment bindings (for DEBUG flag)
 */
export function structuredLog(level, message, metadata = {}, env = {}) {
  const logEntry = {
    timestamp: new Date().toISOString(),
    level: level.toUpperCase(),
    message: sanitizeForLogging(message),
    ...metadata,
  }

  // Add request ID if available
  if (metadata.requestId) {
    logEntry.requestId = sanitizeForLogging(metadata.requestId)
  }

  // Log based on level and debug mode
  if (level === LOG_LEVELS.ERROR) {
    console.error(JSON.stringify(logEntry))
  } else if (level === LOG_LEVELS.WARN) {
    console.warn(JSON.stringify(logEntry))
  } else if (level === LOG_LEVELS.DEBUG && env.DEBUG) {
    console.log(JSON.stringify(logEntry))
  } else if (level === LOG_LEVELS.INFO) {
    console.log(JSON.stringify(logEntry))
  }
}

/**
 * Log request metrics
 * @param {string} endpoint - Endpoint path
 * @param {string} method - HTTP method
 * @param {number} status - Response status
 * @param {number} duration - Request duration in ms
 * @param {*} env - Environment bindings
 */
export function logRequest(endpoint, method, status, duration, env = {}) {
  metrics.requests.total++

  if (status >= 200 && status < 400) {
    metrics.requests.successful++
  } else {
    metrics.requests.failed++
  }

  const endpointKey = `${method} ${endpoint}`
  metrics.requests.byEndpoint[endpointKey] =
    (metrics.requests.byEndpoint[endpointKey] || 0) + 1

  structuredLog(
    LOG_LEVELS.INFO,
    'Request completed',
    {
      endpoint: sanitizeForLogging(endpoint),
      method: sanitizeForLogging(method),
      status,
      duration,
      metrics: {
        totalRequests: metrics.requests.total,
        successRate:
          (
            (metrics.requests.successful / metrics.requests.total) *
            100
          ).toFixed(2) + '%',
      },
    },
    env,
  )
}

/**
 * Log authentication metrics
 * @param {boolean} success - Authentication success
 * @param {string} reason - Failure reason if applicable
 * @param {*} env - Environment bindings
 */
export function logAuth(success, reason = null, env = {}) {
  metrics.auth.attempts++

  if (success) {
    metrics.auth.successes++
    structuredLog(
      LOG_LEVELS.INFO,
      'Authentication successful',
      {
        authStats: {
          attempts: metrics.auth.attempts,
          successes: metrics.auth.successes,
          successRate:
            ((metrics.auth.successes / metrics.auth.attempts) * 100).toFixed(
              2,
            ) + '%',
        },
      },
      env,
    )
  } else {
    metrics.auth.failures++
    structuredLog(
      LOG_LEVELS.WARN,
      'Authentication failed',
      {
        reason: sanitizeForLogging(reason),
        authStats: {
          attempts: metrics.auth.attempts,
          failures: metrics.auth.failures,
          failureRate:
            ((metrics.auth.failures / metrics.auth.attempts) * 100).toFixed(2) +
            '%',
        },
      },
      env,
    )
  }
}

/**
 * Log database operation
 * @param {string} operation - Database operation type
 * @param {boolean} success - Operation success
 * @param {number} duration - Operation duration in ms
 * @param {Object} details - Additional details
 * @param {*} env - Environment bindings
 */
export function logDatabase(
  operation,
  success,
  duration,
  details = {},
  env = {},
) {
  metrics.database.queries++

  if (!success) {
    metrics.database.errors++
  }

  structuredLog(
    success ? LOG_LEVELS.INFO : LOG_LEVELS.ERROR,
    `Database ${operation} ${success ? 'completed' : 'failed'}`,
    {
      operation: sanitizeForLogging(operation),
      success,
      duration,
      ...details,
      dbStats: {
        totalQueries: metrics.database.queries,
        errors: metrics.database.errors,
        errorRate:
          ((metrics.database.errors / metrics.database.queries) * 100).toFixed(
            2,
          ) + '%',
      },
    },
    env,
  )
}

/**
 * Log cache operation
 * @param {boolean} hit - Cache hit or miss
 * @param {string} key - Cache key
 * @param {*} env - Environment bindings
 */
export function logCache(hit, key, env = {}) {
  if (hit) {
    metrics.cache.hits++
  } else {
    metrics.cache.misses++
  }

  const total = metrics.cache.hits + metrics.cache.misses
  const hitRate =
    total > 0 ? ((metrics.cache.hits / total) * 100).toFixed(2) : '0.00'

  structuredLog(
    LOG_LEVELS.DEBUG,
    `Cache ${hit ? 'hit' : 'miss'}`,
    {
      key: sanitizeForLogging(key),
      cacheStats: {
        hits: metrics.cache.hits,
        misses: metrics.cache.misses,
        hitRate: hitRate + '%',
        ...getCacheStats(),
      },
    },
    env,
  )
}

/**
 * Log Okta operation
 * @param {string} operation - Okta operation type
 * @param {boolean} success - Operation success
 * @param {Object} details - Additional details
 * @param {*} env - Environment bindings
 */
export function logOkta(operation, success, details = {}, env = {}) {
  metrics.okta.apiCalls++

  if (!success) {
    metrics.okta.errors++
  }

  if (details.usersSynced) {
    metrics.okta.usersSynced += details.usersSynced
  }

  structuredLog(
    success ? LOG_LEVELS.INFO : LOG_LEVELS.ERROR,
    `Okta ${operation} ${success ? 'completed' : 'failed'}`,
    {
      operation: sanitizeForLogging(operation),
      success,
      ...details,
      oktaStats: {
        apiCalls: metrics.okta.apiCalls,
        errors: metrics.okta.errors,
        totalUsersSynced: metrics.okta.usersSynced,
        errorRate:
          ((metrics.okta.errors / metrics.okta.apiCalls) * 100).toFixed(2) +
          '%',
      },
    },
    env,
  )
}

/**
 * Get current metrics snapshot
 * @returns {Object} Current metrics
 */
export function getMetrics() {
  return {
    ...metrics,
    timestamp: new Date().toISOString(),
    cache: {
      ...metrics.cache,
      ...getCacheStats(),
    },
  }
}

/**
 * Reset all metrics (useful for testing)
 */
export function resetMetrics() {
  metrics.requests = { total: 0, successful: 0, failed: 0, byEndpoint: {} }
  metrics.auth = { attempts: 0, successes: 0, failures: 0 }
  metrics.database = { queries: 0, errors: 0 }
  metrics.cache = { hits: 0, misses: 0 }
  metrics.okta = { apiCalls: 0, usersSynced: 0, errors: 0 }
}

/**
 * Log performance metrics
 * @param {string} operation - Operation name
 * @param {number} startTime - Start time in milliseconds
 * @param {*} env - Environment bindings
 */
export function logPerformance(operation, startTime, env = {}) {
  const duration = Date.now() - startTime

  structuredLog(
    LOG_LEVELS.DEBUG,
    `Performance: ${operation}`,
    {
      operation: sanitizeForLogging(operation),
      duration,
      timestamp: new Date().toISOString(),
    },
    env,
  )

  return duration
}
