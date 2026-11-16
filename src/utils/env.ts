/**
 * Environment flag parsing
 *
 * Wrangler `vars` may arrive as booleans or strings (e.g. `"false"`), so a
 * plain truthiness check would treat the string "false" as enabled.
 */

const TRUE_STRINGS = new Set(['true', '1', 'yes', 'on'])

/**
 * Whether debug mode is explicitly enabled
 *
 * True only for boolean `true` or the case-insensitive strings
 * 'true', '1', 'yes' and 'on' (surrounding whitespace ignored).
 * Everything else, including 'false', '', '0' and undefined, is false.
 *
 * @param env - Environment bindings (any object with an optional DEBUG)
 * @returns True when DEBUG is explicitly enabled
 */
export function isDebugEnabled(env?: { DEBUG?: unknown } | null): boolean {
  const value = env?.DEBUG
  if (value === true) return true
  if (typeof value === 'string') {
    return TRUE_STRINGS.has(value.trim().toLowerCase())
  }
  return false
}
