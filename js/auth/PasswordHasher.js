/**
 * ================================================================
 * PasswordHasher.js — Password Hashing | نظام الحسام للمحاماة
 * ================================================================
 * PHASE 32 — Login Screen, Session Activation & Users Admin Panel
 *
 * WHAT THIS FILE IS
 *   The one place a plaintext password is ever turned into (or checked
 *   against) `UsersRepository`'s opaque `كلمة_المرور_مجزأة` field —
 *   exactly the field Phase 31's UsersRepository.js header reserved for
 *   "whatever produced it is a future phase's responsibility". This is
 *   that future phase.
 *
 *   Algorithm: PBKDF2-HMAC-SHA256, 100,000 iterations, a fresh random
 *   16-byte salt per password, via the native Web Crypto
 *   `crypto.subtle` API (available in every modern browser AND in
 *   Node 20+ as `globalThis.crypto.subtle` — no external dependency,
 *   same "no external package" discipline as PHASE 30's
 *   `LicenseCrypto.js`). Stored format is a single self-describing
 *   string so the iteration count can be raised later without breaking
 *   old hashes:
 *     "pbkdf2$<iterations>$<saltBase64>$<hashBase64>"
 *
 * WHAT THIS FILE IS NOT
 *   - It never stores or logs a plaintext password anywhere, including
 *     in error messages or the audit log.
 *   - It does not touch UsersRepository directly — callers
 *     (LoginScreen.js, UsersAdminPanel.js) read/write the
 *     `كلمة_المرور_مجزأة` field themselves; this file only hashes and
 *     compares.
 *   - It is not a session/token system — see SessionContext.js
 *     (Phase 31) for "who is logged in right now".
 *
 * Load order: additive file, zero dependencies on any other project
 * file. Safe to load anywhere, in browser or Node.
 * ================================================================
 */

(function (root) {
  'use strict';

  var ITERATIONS = 100000;
  var SALT_BYTES = 16;
  var HASH_BITS = 256;
  var ALGO_TAG = 'pbkdf2';

  function getSubtle() {
    var c = (typeof globalThis !== 'undefined' && globalThis.crypto) ||
      (typeof window !== 'undefined' && window.crypto) ||
      (typeof crypto !== 'undefined' ? crypto : null);
    if (!c || !c.subtle) {
      throw new Error('PasswordHasher requires the Web Crypto API (crypto.subtle), which is unavailable in this environment.');
    }
    return c;
  }

  function toBase64(buffer) {
    var bytes = new Uint8Array(buffer);
    if (typeof Buffer !== 'undefined') return Buffer.from(bytes).toString('base64');
    var binary = '';
    for (var i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    return btoa(binary);
  }

  function fromBase64(b64) {
    if (typeof Buffer !== 'undefined') return new Uint8Array(Buffer.from(b64, 'base64'));
    var binary = atob(b64);
    var bytes = new Uint8Array(binary.length);
    for (var i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }

  function randomSalt() {
    var c = getSubtle();
    var salt = new Uint8Array(SALT_BYTES);
    c.getRandomValues(salt);
    return salt;
  }

  /**
   * deriveBits(password, salt, iterations) -> Promise<ArrayBuffer>
   * @private
   */
  async function deriveBits(password, salt, iterations) {
    var c = getSubtle();
    var encoder = new TextEncoder();
    var keyMaterial = await c.subtle.importKey(
      'raw', encoder.encode(password), { name: 'PBKDF2' }, false, ['deriveBits']
    );
    return c.subtle.deriveBits(
      { name: 'PBKDF2', salt: salt, iterations: iterations, hash: 'SHA-256' },
      keyMaterial,
      HASH_BITS
    );
  }

  /**
   * hashPassword(password) -> Promise<string>
   * Never call with an empty/undefined password — throws instead of
   * silently hashing an empty string into a "valid-looking" hash.
   * @param {string} password - plaintext, never persisted or logged.
   * @returns {Promise<string>} "pbkdf2$100000$<saltB64>$<hashB64>"
   */
  async function hashPassword(password) {
    if (typeof password !== 'string' || password.length === 0) {
      throw new Error('hashPassword() requires a non-empty password string.');
    }
    var salt = randomSalt();
    var bits = await deriveBits(password, salt, ITERATIONS);
    return [ALGO_TAG, ITERATIONS, toBase64(salt), toBase64(bits)].join('$');
  }

  /**
   * verifyPassword(password, stored) -> Promise<boolean>
   * Constant-shape comparison (byte-by-byte over the full derived
   * length, never short-circuiting on the first mismatched byte) to
   * avoid a trivial timing side-channel. Malformed/unrecognized
   * `stored` values (wrong algorithm tag, corrupt data) resolve to
   * `false` rather than throwing — a corrupt hash must never be
   * treated as "no password set" (which would be fail-open on
   * authentication, the one place this whole layer must be
   * fail-CLOSED).
   * @param {string} password - plaintext candidate.
   * @param {string} stored - a string previously returned by hashPassword().
   * @returns {Promise<boolean>}
   */
  async function verifyPassword(password, stored) {
    if (typeof password !== 'string' || password.length === 0) return false;
    if (typeof stored !== 'string') return false;
    var parts = stored.split('$');
    if (parts.length !== 4 || parts[0] !== ALGO_TAG) return false;
    var iterations = parseInt(parts[1], 10);
    if (!Number.isFinite(iterations) || iterations <= 0) return false;
    var salt, expected;
    try {
      salt = fromBase64(parts[2]);
      expected = fromBase64(parts[3]);
    } catch (e) {
      return false;
    }
    var actualBits = await deriveBits(password, salt, iterations);
    var actual = new Uint8Array(actualBits);
    if (actual.length !== expected.length) return false;
    var diff = 0;
    for (var i = 0; i < actual.length; i++) diff |= actual[i] ^ expected[i];
    return diff === 0;
  }

  var api = {
    hashPassword: hashPassword,
    verifyPassword: verifyPassword,
    ITERATIONS: ITERATIONS
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  if (root) {
    root.HossamPasswordHasher = api;
  }
})(typeof window !== 'undefined' ? window : (typeof global !== 'undefined' ? global : this));
