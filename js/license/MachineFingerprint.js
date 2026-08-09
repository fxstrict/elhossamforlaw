/**
 * ============================================================================
 * PHASE 30 — ENTERPRISE LICENSING & PROTECTION FRAMEWORK
 * File: js/license/MachineFingerprint.js
 * ----------------------------------------------------------------------------
 * Component 2 "Machine Fingerprint Engine" of the licensing brief.
 *
 * This is a browser-based PWA, not a native desktop app, so there is no
 * CPU ID / Motherboard / Disk UUID / Windows SID available to any web
 * page (by design — browsers deliberately block that level of hardware
 * access). The brief's own list already includes the two signals that
 * ARE legitimately available and, together, are what this module uses:
 *
 *   1. "Device Salt"  — a random UUID generated ONCE with
 *      crypto.randomUUID() on first run and persisted in localStorage.
 *      This is the dominant, stable component: it survives OS updates,
 *      browser updates, and hardware-info changes, and two different
 *      browser profiles / two different devices will never collide.
 *   2. "Browser Fingerprint" — a light, stable set of environment
 *      signals (platform, logical CPU count, screen geometry, timezone,
 *      language) mixed in purely to make the ID recognizably tied to
 *      *this* browser profile, without doing invasive canvas/audio
 *      fingerprinting that would be fragile (changes on GPU driver
 *      updates) and privacy-invasive for a legal-practice tool.
 *
 * Combined and SHA-256 hashed, then formatted as:
 *   HSM-XXXX-XXXX-XXXX
 * matching the exact example format in the brief ("HSM-8D2A-E98F-41AA").
 *
 * The salt lives in localStorage (not IndexedDB) deliberately: it must
 * be readable synchronously-adjacent at the very first paint, before
 * the Repository layer has opened, so the Activation Wizard can display
 * a Machine ID immediately on a brand-new install.
 *
 * 100% additive: defines exactly one new global, window.MachineFingerprint.
 * ============================================================================
 */
(function (window) {
  'use strict';

  var SALT_KEY = 'hsm_license_device_salt_v1';
  // ROOT-CAUSE FIX (license re-prompt / intermittent machine_mismatch):
  // collectEnvironmentSignals() reads window.screen / navigator LIVE on
  // every call. screen.width/height/colorDepth can legitimately differ
  // between one launch and the next of the SAME device/browser profile —
  // a laptop undocked/redocked from an external monitor, a display mode
  // change, or simply the OS/webview not having finished settling the
  // window's display metrics yet on the very first paint after a cold
  // start (which self-resolves a few seconds later or on refresh, once
  // the values stabilize). Because formatMachineId() hashes these signals
  // together with the salt, ANY drift in a single signal completely
  // changes the resulting Machine ID (SHA-256 avalanche effect), which
  // then no longer matches payload.machineId captured at activation time
  // -> verifyLicenseFile() returns 'machine_mismatch' -> LicenseCore
  // reports INVALID -> ActivationWizard reopens asking for the license
  // again, exactly the reported symptom (works again after a refresh
  // because by then screen metrics have stabilized to their original
  // values). Fix: snapshot collectEnvironmentSignals() ONCE, the same
  // way the salt itself is snapshotted, and persist it — so every later
  // call (including across full app/browser restarts) reuses that first
  // captured string instead of re-reading potentially volatile live
  // values. This preserves the original design intent ("recognizably
  // tied to this browser profile") while making the Machine ID as
  // stable as the salt it's supposed to complement.
  var SIGNALS_KEY = 'hsm_license_device_signals_v1';

  function getOrCreateDeviceSalt() {
    try {
      var existing = window.localStorage.getItem(SALT_KEY);
      if (existing) return existing;
      var salt = (window.crypto && window.crypto.randomUUID)
        ? window.crypto.randomUUID()
        : (String(Date.now()) + '-' + Math.random().toString(36).slice(2));
      window.localStorage.setItem(SALT_KEY, salt);
      return salt;
    } catch (e) {
      // localStorage unavailable (private mode edge cases) — fall back
      // to a session-only salt so the app still functions; the resulting
      // Machine ID simply won't be stable across a full browser restart
      // in that narrow scenario, which is disclosed in the Ops Guide.
      return 'volatile-' + Math.random().toString(36).slice(2);
    }
  }

  function collectEnvironmentSignals() {
    var nav = window.navigator || {};
    var scr = window.screen || {};
    var tz = '';
    try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch (e) {}

    return [
      nav.platform || '',
      String(nav.hardwareConcurrency || ''),
      nav.language || '',
      String(scr.width || '') + 'x' + String(scr.height || ''),
      String(scr.colorDepth || ''),
      tz
    ].join('|');
  }

  function getOrCreatePersistedEnvironmentSignals() {
    try {
      var existing = window.localStorage.getItem(SIGNALS_KEY);
      if (existing) return existing;
      var signals = collectEnvironmentSignals();
      window.localStorage.setItem(SIGNALS_KEY, signals);
      return signals;
    } catch (e) {
      // localStorage unavailable — same narrow edge case as the salt
      // fallback above; fall back to live (volatile) signals so the app
      // still functions.
      return collectEnvironmentSignals();
    }
  }

  function formatMachineId(hex) {
    var short = hex.slice(0, 12).toUpperCase();
    return 'HSM-' + short.slice(0, 4) + '-' + short.slice(4, 8) + '-' + short.slice(8, 12);
  }

  var _cachedPromise = null;

  /**
   * @returns {Promise<string>} e.g. "HSM-8D2A-E98F-41AA"
   */
  function getMachineId() {
    if (_cachedPromise) return _cachedPromise;

    _cachedPromise = (async function () {
      var salt = getOrCreateDeviceSalt();
      var signals = getOrCreatePersistedEnvironmentSignals();
      var raw = 'hossam-v1|' + salt + '|' + signals;

      if (window.LicenseCrypto && window.LicenseCrypto.isAvailable()) {
        var hex = await window.LicenseCrypto.sha256Hex(raw);
        if (hex) return formatMachineId(hex);
      }
      // Extremely defensive fallback if SubtleCrypto is somehow missing
      // (should not happen in any supported browser): a non-cryptographic
      // but still stable-per-device hash, clearly not used for signature
      // verification, only for display / non-security-critical matching.
      var h = 0;
      for (var i = 0; i < raw.length; i++) { h = ((h << 5) - h + raw.charCodeAt(i)) | 0; }
      return formatMachineId(Math.abs(h).toString(16).padStart(12, '0'));
    })();

    return _cachedPromise;
  }

  var api = {
    getMachineId: getMachineId
  };

  window.MachineFingerprint = api;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof window !== 'undefined' ? window : globalThis);
