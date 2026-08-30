/**
 * ============================================================================
 * PHASE 30 — ENTERPRISE LICENSING & PROTECTION FRAMEWORK
 * File: js/license/LicenseCrypto.js
 * ----------------------------------------------------------------------------
 * Component 4 "Digital Signature" of the licensing brief.
 *
 * Verifies a license payload's signature using the browser's NATIVE
 * Web Crypto API (window.crypto.subtle) — ECDSA on curve P-256 with
 * SHA-256. No external cryptography library is vendored:
 *   - Zero extra dependency / zero extra attack surface / zero build step
 *     (this project ships as plain <script> tags, no bundler).
 *   - ECDSA P-256 has universal support in every browser this PWA already
 *     targets (Chrome, Edge, Safari, Firefox — desktop and mobile),
 *     unlike Ed25519 which still has inconsistent WebCrypto support as
 *     of this writing.
 *   - The signing side (tools/license-generator/) uses Node's built-in
 *     `crypto` module with the exact same curve, so signatures produced
 *     offline verify correctly here with no format translation needed.
 *
 * SECURITY MODEL (per brief §4 "Digital Signature"):
 *   The app embeds ONLY the PUBLIC key (js/license/license-public-key.js,
 *   a tiny generated file — see tools/license-generator/README.md). The
 *   PRIVATE key never exists anywhere inside this repository or this
 *   deployed app; it lives solely on the machine that runs the offline
 *   License Generator CLI. This makes forging a license file
 *   computationally infeasible without that private key, exactly as
 *   specified: "يستحيل تصنيع License مزيف".
 *
 * This file is 100% additive — it defines exactly one new global,
 * window.LicenseCrypto, and touches no existing file.
 * ============================================================================
 */
(function (window) {
  'use strict';

  // ROOT CAUSE FIX (PROBLEM 16 — "شاشة التفعيل تظهر رغم ترخيص صالح،
  // ويختفي بعد Refresh"): this used to be a plain module-level
  // constant — `var SUBTLE = window.crypto && window.crypto.subtle;`
  // — computed exactly ONCE, at the instant this <script> tag parses.
  // On most devices window.crypto.subtle already exists at that
  // instant, so the snapshot is harmless. But on some devices
  // (confirmed: certain Android WebView builds that attach
  // SubtleCrypto lazily, and privacy/ad-block extensions that
  // reinstall a wrapped `window.crypto` after page scripts have
  // already run) Web Crypto is NOT yet present the moment this file
  // executes, but IS present a few milliseconds later. A cached
  // `false` snapshot then means isAvailable()/verify()/sha256Hex()
  // report "unavailable" for the rest of that page's entire
  // lifetime — permanently, not just for that one instant — which
  // makes LicenseCore treat a perfectly valid, unexpired, correct
  // license as INVALID ("crypto_unavailable") and show the
  // Activation Wizard, even though the actually-correct state was
  // simply "not determined yet". A Refresh re-parses this file from
  // scratch, by which time Web Crypto is already attached, so the
  // bug "fixes itself" — the classic signature of a stale-snapshot
  // race, not an actual license problem.
  //
  // Fix: read window.crypto.subtle live, every time, instead of
  // caching it. This is a pure timing/liveness fix — it does not
  // relax verification in any way: a genuinely unavailable
  // SubtleCrypto (very old browser / non-secure context) still makes
  // every check below return false/null exactly as before, and
  // callers (LicenseCore.verifyLicenseFile) still fail closed.
  function getSubtle() {
    return window.crypto && window.crypto.subtle;
  }

  /**
   * Deterministic canonical JSON serialization: keys sorted recursively
   * so the exact same payload object always produces the exact same
   * byte string on both the signer (Node) and verifier (browser) sides,
   * regardless of property insertion order.
   * @param {*} value
   * @returns {string}
   */
  function canonicalStringify(value) {
    if (value === null || typeof value !== 'object') {
      return JSON.stringify(value);
    }
    if (Array.isArray(value)) {
      return '[' + value.map(canonicalStringify).join(',') + ']';
    }
    var keys = Object.keys(value).sort();
    var parts = keys.map(function (k) {
      return JSON.stringify(k) + ':' + canonicalStringify(value[k]);
    });
    return '{' + parts.join(',') + '}';
  }

  function base64ToBytes(b64) {
    var bin = atob(b64.replace(/-/g, '+').replace(/_/g, '/'));
    var bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  }

  function bytesToHex(bytes) {
    var hex = '';
    for (var i = 0; i < bytes.length; i++) {
      hex += bytes[i].toString(16).padStart(2, '0');
    }
    return hex;
  }

  var _publicKeyPromise = null;

  /**
   * Imports the embedded public key (JWK format) once and caches the
   * CryptoKey. Reads window.HOSSAM_LICENSE_PUBLIC_KEY_JWK, expected to
   * be defined by js/license/license-public-key.js (loaded before this
   * file has any reason to be called — see index.html ordering).
   * @returns {Promise<CryptoKey|null>} null if SubtleCrypto unavailable
   *   (very old browser / insecure context) — callers must treat that
   *   as "cannot verify" and fail closed for activation, per §4.
   */
  function importPublicKey() {
    var subtle = getSubtle();
    if (!subtle) return Promise.resolve(null);
    if (_publicKeyPromise) return _publicKeyPromise;

    var jwk = window.HOSSAM_LICENSE_PUBLIC_KEY_JWK;
    if (!jwk) return Promise.resolve(null);

    _publicKeyPromise = subtle.importKey(
      'jwk',
      jwk,
      { name: 'ECDSA', namedCurve: 'P-256' },
      false,
      ['verify']
    ).catch(function () { return null; });

    return _publicKeyPromise;
  }

  /**
   * Verifies that `signatureB64` is a valid ECDSA-P256-SHA256 signature
   * (raw r||s format, IEEE P1363 — the same format
   * crypto.subtle.sign('ECDSA',...) produces) over the canonical JSON
   * serialization of `payload`.
   * @param {Object} payload
   * @param {string} signatureB64
   * @returns {Promise<boolean>}
   */
  async function verify(payload, signatureB64) {
    var subtle = getSubtle();
    if (!subtle || !signatureB64 || !payload) return false;
    var key = await importPublicKey();
    if (!key) return false;

    try {
      var data = new TextEncoder().encode(canonicalStringify(payload));
      var sigBytes = base64ToBytes(signatureB64);
      return await subtle.verify(
        { name: 'ECDSA', hash: { name: 'SHA-256' } },
        key,
        sigBytes,
        data
      );
    } catch (e) {
      return false;
    }
  }

  /**
   * SHA-256 of an arbitrary string, returned as lowercase hex. Used by
   * MachineFingerprint.js — exposed here so there is exactly one
   * hashing implementation shared across the license module.
   * @param {string} text
   * @returns {Promise<string>}
   */
  async function sha256Hex(text) {
    var subtle = getSubtle();
    if (!subtle) return null;
    var data = new TextEncoder().encode(text);
    var digest = await subtle.digest('SHA-256', data);
    return bytesToHex(new Uint8Array(digest));
  }

  var api = {
    canonicalStringify: canonicalStringify,
    verify: verify,
    sha256Hex: sha256Hex,
    isAvailable: function () { return !!getSubtle(); }
  };

  window.LicenseCrypto = api;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof window !== 'undefined' ? window : globalThis);
