/**
 * Structured logging and metrics utilities
 *
 * Provides JSON-formatted logging and runtime metrics tracking
 * for observability and performance monitoring.
 */

import type { Env } from '../types';
import { sanitizeForLogging } from './validation.js';
import { getCacheStats } from './cache.js';

/**
 * Log levels
 */
export const LOG_LEVELS = {
  ERROR: 'error',
  WARN: 'warn',
  INFO: 'info',
  DEBUG: 'debug',
} as const;

type LogLevel = (typeof LOG_LEVELS)[keyof typeof LOG_LEVELS];

/**
 * Metrics structure
 */
interface MetricsData {
  requests: {
    total: number;
    successful: number;
    failed: number;
    byEndpoint: Record<string, number>;
  };
  auth: {
    attempts: number;
    successes: number;
    failures: number;
  };
  database: {
    queries: number;
    errors: number;
  };
  cache: {
    hits: number;
    misses: number;
  };
  okta: {
    apiCalls: number;
    usersSynced: number;
    errors: number;
  };
}

/**
 * Metrics counters (in-memory, resets on cold starts)
 */
const metrics: MetricsData = {
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
};

/**
 * Structured log entry
 *
 * @param level - Log level
 * @param message - Log message
 * @param metadata - Additional metadata
 * @param env - Environment bindings (for DEBUG flag)
 */
export function structuredLog(
  level: LogLevel,
  message: string,
  metadata: Record<string, unknown> = {},
  env?: Partial<Env>
): void {
  const logEntry: Record<string, unknown> = {
    timestamp: new Date().toISOString(),
    level: level.toUpperCase(),
    message: sanitizeForLogging(message),
    ...metadata,
  };

  // Add request ID if available
  if (metadata['requestId'] && typeof metadata['requestId'] === 'string') {
    logEntry['requestId'] = sanitizeForLogging(metadata['requestId']);
  }

  // Log based on level and debug mode
  if (level === LOG_LEVELS.ERROR) {
    console.error(JSON.stringify(logEntry));
  } else if (level === LOG_LEVELS.WARN) {
    console.warn(JSON.stringify(logEntry));
  } else if (level === LOG_LEVELS.DEBUG && env?.DEBUG) {
    console.log(JSON.stringify(logEntry));
  } else if (level === LOG_LEVELS.INFO) {
    console.log(JSON.stringify(logEntry));
  }
}

/**
 * Log request metrics
 *
 * @param endpoint - Endpoint path
 * @param method - HTTP method
 * @param status - Response status
 * @param duration - Request duration in ms
 * @param env - Environment bindings
 */
export function logRequest(
  endpoint: string,
  method: string,
  status: number,
  duration: number,
  env?: Partial<Env>
): void {
  metrics.requests.total++;

  if (status >= 200 && status < 400) {
    metrics.requests.successful++;
  } else {
    metrics.requests.failed++;
  }

  const endpointKey = `${method} ${endpoint}`;
  metrics.requests.byEndpoint[endpointKey] =
    (metrics.requests.byEndpoint[endpointKey] || 0) + 1;

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
          ((metrics.requests.successful / metrics.requests.total) * 100).toFixed(2) + '%',
      },
    },
    env
  );
}

/**
 * Log authentication metrics
 *
 * @param success - Authentication success
 * @param reason - Failure reason if applicable
 * @param env - Environment bindings
 */
export function logAuth(
  success: boolean,
  reason: string | null = null,
  env?: Partial<Env>
): void {
  metrics.auth.attempts++;

  if (success) {
    metrics.auth.successes++;
    structuredLog(
      LOG_LEVELS.INFO,
      'Authentication successful',
      {
        authStats: {
          attempts: metrics.auth.attempts,
          successes: metrics.auth.successes,
          successRate:
            ((metrics.auth.successes / metrics.auth.attempts) * 100).toFixed(2) + '%',
        },
      },
      env
    );
  } else {
    metrics.auth.failures++;
    structuredLog(
      LOG_LEVELS.WARN,
      'Authentication failed',
      {
        reason: reason ? sanitizeForLogging(reason) : 'Unknown',
        authStats: {
          attempts: metrics.auth.attempts,
          failures: metrics.auth.failures,
          failureRate:
            ((metrics.auth.failures / metrics.auth.attempts) * 100).toFixed(2) + '%',
        },
      },
      env
    );
  }
}

/**
 * Log database operation
 *
 * @param operation - Database operation type
 * @param success - Operation success
 * @param duration - Operation duration in ms
 * @param details - Additional details
 * @param env - Environment bindings
 */
export function logDatabase(
  operation: string,
  success: boolean,
  duration: number,
  details: Record<string, unknown> = {},
  env?: Partial<Env>
): void {
  metrics.database.queries++;

  if (!success) {
    metrics.database.errors++;
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
          ((metrics.database.errors / metrics.database.queries) * 100).toFixed(2) + '%',
      },
    },
    env
  );
}

/**
 * Log cache operation
 *
 * @param hit - Cache hit or miss
 * @param key - Cache key
 * @param env - Environment bindings
 */
export function logCache(hit: boolean, key: string, env?: Partial<Env>): void {
  if (hit) {
    metrics.cache.hits++;
  } else {
    metrics.cache.misses++;
  }

  const total = metrics.cache.hits + metrics.cache.misses;
  const hitRate = total > 0 ? ((metrics.cache.hits / total) * 100).toFixed(2) : '0.00';

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
    env
  );
}

/**
 * Log Okta operation
 *
 * @param operation - Okta operation type
 * @param success - Operation success
 * @param details - Additional details
 * @param env - Environment bindings
 */
export function logOkta(
  operation: string,
  success: boolean,
  details: Record<string, unknown> = {},
  env?: Partial<Env>
): void {
  metrics.okta.apiCalls++;

  if (!success) {
    metrics.okta.errors++;
  }

  if (details['usersSynced'] && typeof details['usersSynced'] === 'number') {
    metrics.okta.usersSynced += details['usersSynced'];
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
        errorRate: ((metrics.okta.errors / metrics.okta.apiCalls) * 100).toFixed(2) + '%',
      },
    },
    env
  );
}

/**
 * Get current metrics snapshot
 *
 * @returns Current metrics with timestamp
 */
export function getMetrics(): MetricsData & { timestamp: string; cache: ReturnType<typeof getCacheStats> & { hits: number; misses: number } } {
  return {
    ...metrics,
    timestamp: new Date().toISOString(),
    cache: {
      ...metrics.cache,
      ...getCacheStats(),
    },
  };
}

/**
 * Reset all metrics (useful for testing)
 */
export function resetMetrics(): void {
  metrics.requests = { total: 0, successful: 0, failed: 0, byEndpoint: {} };
  metrics.auth = { attempts: 0, successes: 0, failures: 0 };
  metrics.database = { queries: 0, errors: 0 };
  metrics.cache = { hits: 0, misses: 0 };
  metrics.okta = { apiCalls: 0, usersSynced: 0, errors: 0 };
}

/**
 * Log performance metrics
 *
 * @param operation - Operation name
 * @param startTime - Start time in milliseconds
 * @param env - Environment bindings
 * @returns Duration in milliseconds
 */
export function logPerformance(
  operation: string,
  startTime: number,
  env?: Partial<Env>
): number {
  const duration = Date.now() - startTime;

  structuredLog(
    LOG_LEVELS.DEBUG,
    `Performance: ${operation}`,
    {
      operation: sanitizeForLogging(operation),
      duration,
      timestamp: new Date().toISOString(),
    },
    env
  );

  return duration;
}
