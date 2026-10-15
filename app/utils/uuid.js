/**
 * Generate a random (version 4) UUID.
 *
 * `crypto.randomUUID` only exists in secure contexts (https or localhost), so
 * fall back to building one from `crypto.getRandomValues`, which is available
 * everywhere.
 *
 * @returns {string} a UUID such as `8f7a5c2e-1b4d-4e3f-9a6b-2c1d0e9f8a7b`
 */
export default function uuid() {
  if (typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  const bytes = crypto.getRandomValues(new Uint8Array(16));
  // Version 4, variant 10xx (RFC 4122)
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0'));

  return [
    hex.slice(0, 4).join(''),
    hex.slice(4, 6).join(''),
    hex.slice(6, 8).join(''),
    hex.slice(8, 10).join(''),
    hex.slice(10, 16).join(''),
  ].join('-');
}
