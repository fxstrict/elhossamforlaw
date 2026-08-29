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

  // PROBLEM 17 — MIGRATION SAFETY: the collectEnvironmentSignals() fix
  // below (dropping screen width/height) changes the SHA-256 input for
  // every device, including ones that were NEVER affected by rotation
  // and already have a perfectly valid, currently-ACTIVE license bound
  // to a machineId computed under the OLD formula. Without this pin,
  // shipping the formula fix alone would turn every existing
  // activation into a 'machine_mismatch' on the next boot — replacing
  // one bug with a worse one. So: the FIRST time LicenseCore confirms
  // a live-computed machineId matches the value stored in the user's
  // own license file (see LicenseCore.verifyLicenseFile ->
  // confirmMachineId call), that exact string is pinned here and
  // returned directly on every subsequent call, bypassing
  // recomputation entirely. This makes the Machine ID permanently
  // stable from that point on regardless of orientation, formula
  // tweaks, or any other environment-signal drift — while never
  // widening what counts as a valid match (confirmation only ever
  // records a value LicenseCore itself already verified against the
  // signed license payload).
  var CONFIRMED_KEY = 'hsm_license_machine_id_confirmed_v1';

  function getConfirmedMachineId() {
    try { return window.localStorage.getItem(CONFIRMED_KEY) || null; }
    catch (e) { return null; }
  }

  function confirmMachineId(id) {
    try { window.localStorage.setItem(CONFIRMED_KEY, id); } catch (e) {}
  }

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

  // PROBLEM 17 ROOT CAUSE (Machine ID changes between openings of the
  // SAME device, e.g. HSM-9F89-64D9-302E -> HSM-DAF9-E8C4-1683 with no
  // reset performed): this function used to include
  // `scr.width + 'x' + scr.height`. On every mobile browser,
  // window.screen.width/height report the CURRENT ORIENTATION's
  // dimensions and literally SWAP when the device is rotated
  // portrait<->landscape (this is standard, documented browser
  // behavior, not a bug in the browser). So a phone opened once in
  // portrait (e.g. 390x844) and again in landscape (844x390) — which
  // requires nothing more than the phone being rotated before/while
  // the PWA is opened, an entirely normal thing to happen to a device
  // over a few hours — fed a different signal string into the SHA-256
  // hash, producing a completely different Machine ID even though the
  // persisted device salt (the actually-dominant, stable component)
  // never changed. LicenseCore.verifyLicenseFile() then compared the
  // license's stored payload.machineId against this new, different
  // runtime ID, got 'machine_mismatch', and set state=INVALID, which
  // is exactly what makes ActivationWizard.show() run (see
  // ActivationWizard.js onLicenseState()). No refresh reliably "fixes"
  // this case — it only appears fixed if the device happens to be back
  // in its original orientation on the next load.
  //
  // Fix: drop screen geometry entirely from the signal mix. platform,
  // hardwareConcurrency, language and timeZone are all properties of
  // the OS/browser environment itself and do not change when the
  // device is physically rotated, so they keep contributing to "this
  // is recognizably the same browser profile" without the rotation
  // fragility. The persisted device salt (crypto.randomUUID(), stored
  // once in localStorage) remains the dominant, always-stable
  // component of the Machine ID either way.
  function collectEnvironmentSignals() {
    var nav = window.navigator || {};
    var tz = '';
    try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch (e) {}

    return [
      nav.platform || '',
      String(nav.hardwareConcurrency || ''),
      nav.language || '',
      tz
    ].join('|');
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

    var confirmed = getConfirmedMachineId();
    if (confirmed) {
      _cachedPromise = Promise.resolve(confirmed);
      return _cachedPromise;
    }

    _cachedPromise = (async function () {
      var salt = getOrCreateDeviceSalt();
      var signals = collectEnvironmentSignals();
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
    getMachineId: getMachineId,
    confirmMachineId: confirmMachineId, // called only by LicenseCore after a verified match
    _getConfirmedMachineId: getConfirmedMachineId // exposed for tests only
  };

  window.MachineFingerprint = api;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof window !== 'undefined' ? window : globalThis);
