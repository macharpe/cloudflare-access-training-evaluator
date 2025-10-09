/**
 * Helpers for converting to and from URL safe Base64 strings
 *
 * Needed for JWT encoding and cryptographic operations.
 */

/**
 * Base64url encoding utilities
 */
export const base64url = {
  /**
   * Convert byte array to base64url string
   *
   * @param a - Uint8Array to encode
   * @returns Base64url encoded string
   */
  stringify(a: Uint8Array): string {
    const base64string = btoa(String.fromCharCode(...Array.from(a)))
    return base64string.replace(/[=+/]/g, (char) => {
      const lookup: Record<string, string> = {
        '=': '',
        '+': '-',
        '/': '_',
      }
      return lookup[char] ?? char
    })
  },

  /**
   * Parse base64url string to byte array
   *
   * @param s - Base64url encoded string
   * @returns Decoded byte array
   */
  parse(s: string): Uint8Array {
    const normalized = s
      .replace(/-/g, '+')
      .replace(/_/g, '/')
      .replace(/\s/g, '')
    return new Uint8Array(
      Array.from(atob(normalized)).map((c) => c.charCodeAt(0)),
    )
  },
}

/**
 * Helper to convert ASCII string to byte array
 *
 * Necessary for base64 encoding of string data.
 *
 * @param str - ASCII string
 * @returns Byte array representation
 */
export function asciiToUint8Array(str: string): Uint8Array {
  const chars: number[] = []
  for (let i = 0; i < str.length; ++i) {
    chars.push(str.charCodeAt(i))
  }
  return new Uint8Array(chars)
}
