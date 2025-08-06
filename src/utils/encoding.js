/**
 * Helpers for converting to and from URL safe Base64 strings. Needed for JWT encoding.
 */
export const base64url = {
  stringify: function (a) {
    let base64string = btoa(String.fromCharCode.apply(0, a))
    return base64string
      .replace(/=/g, '')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
  },
  parse: function (s) {
    s = s.replace(/-/g, '+').replace(/_/g, '/').replace(/\s/g, '')
    return new Uint8Array(
      Array.prototype.map.call(atob(s), function (c) {
        return c.charCodeAt(0)
      }),
    )
  },
}

/**
 * Helper to get from an ascii string to a literal byte array.
 * Necessary to get ascii string prepped for base 64 encoding
 * @param {string} str - ASCII string
 * @returns {Uint8Array} Byte array
 */
export function asciiToUint8Array(str) {
  let chars = []
  for (let i = 0; i < str.length; ++i) {
    chars.push(str.charCodeAt(i))
  }
  return new Uint8Array(chars)
}
