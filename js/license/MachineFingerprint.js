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
 * access). The only thing this module uses is:
 *
 *   "Device Salt" — a random UUID generated ONCE with
 *   crypto.randomUUID() on first run and persisted in localStorage.
 *   It survives OS updates, browser updates, display-language changes,
 *   timezone changes, and orientation/viewport changes, and two
 *   different browser profiles / two different devices will never
 *   collide.
 *
 * PROBLEM 18 — FINAL AUDIT changed this file to use the device salt as
 * the SOLE input. Two earlier revisions (Problems 16/17) also mixed in
 * a "browser fingerprint" of environment signals — first including
 * screen geometry, then (after Problem 17 dropped geometry) still
 * platform/hardwareConcurrency/language/timeZone. Both revisions
 * shared the same flaw: every environment signal is a live OS/browser
 * property that can legitimately change on a completely untouched
 * device (screen geometry swaps on rotation; language and timezone
 * change with user/OS settings), and any such change silently produces
 * a different Machine ID, which LicenseCore.verifyLicenseFile() then
 * reports as machine_mismatch. None of those signals were ever
 * necessary for security — the actual cryptographic guarantee is the
 * ECDSA signature check in LicenseCrypto.js — so none of them belong
 * in the identity formula. See collectEnvironmentSignals() below and
 * js/tests/verify_license_identity_final.js for the reproduction and
 * fix evidence.
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

  // PROBLEM 18 — FINAL AUDIT: the PROBLEM 17 "pinning" layer
  // (confirmMachineId/getConfirmedMachineId, keyed by
  // hsm_license_machine_id_confirmed_v1) has been REMOVED.
  //
  // It existed for exactly one reason, stated explicitly in its own
  // comment at the time: healing devices that already held a valid
  // license issued under the OLD (pre-Problem-17) formula that
  // included screen geometry. Project confirmed (Problem 18 brief):
  // there are no pre-existing licenses of any kind, under any
  // formula, in production. That migration scenario does not exist,
  // so the pin has no remaining justification — and leaving it in
  // would itself become a "compatibility layer for an old Machine
  // ID", which this project's licensing model explicitly forbids.
  //
  // Worse, keeping it would leave a *second* root cause undetected:
  // collectEnvironmentSignals() (see below) still mixed navigator
  // .language and Intl timeZone into the hash. Reproduced on this
  // exact pre-fix code (see js/tests/verify_license_identity_final.js,
  // "Scenario D — language change"): the SAME persisted device salt,
  // with only the OS/browser display language changed (nothing else
  // touched — no reset, no reinstall, no rotation), produced a
  // DIFFERENT Machine ID. A user who changes the phone's language, or
  // whose timezone changes (e.g. travel, or the office adjusts system
  // time zone), would hit the exact "Activation Wizard reappears"
  // symptom again on first activation, before any pin could exist to
  // hide it. The old pin only ever protected an *already-activated*
  // license from this drift; it did nothing for a brand-new
  // activation attempt made in between generating the Machine ID
  // (sent to the vendor) and pasting the resulting license file back.
  //
  // Fix applied here (see collectEnvironmentSignals() below): every
  // environment signal is dropped from the identity formula. The
  // persisted device salt (crypto.randomUUID(), generated once,
  // stored in localStorage — already proven stable across cold
  // starts, reloads, and restarts, see verify_license_identity_final.js)
  // is now the ONLY input. With no environment-derived component left
  // at all, there is nothing left that can drift, so no pinning/
  // migration/compatibility mechanism is needed to keep the ID
  // stable — the raw computation IS the stable, single source of
  // truth, exactly as required.
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

  // PROBLEM 17 fixed the reported symptom (screen.width/height swap on
  // rotation) by dropping screen geometry, but kept platform,
  // hardwareConcurrency, language and timeZone "purely to make the ID
  // recognizably tied to this browser profile" (original comment) —
  // none of them were ever claimed to be a *necessary* part of the
  // security identity. PROBLEM 18 audit: language and timeZone are
  // both user/OS-level settings that can change on a completely
  // untouched device (display language switched, or the system
  // timezone changed — e.g. daylight-saving rules updated by an OS
  // patch, or the office corrects the device clock/region), and
  // reproducibly do change the resulting Machine ID (see
  // js/tests/verify_license_identity_final.js, "Scenario D"). That is
  // exactly the same bug class Problem 17 was meant to close, just
  // triggered by a different environment signal instead of rotation.
  //
  // Since no signal here is proven necessary for security (the actual
  // security guarantee comes entirely from the ECDSA signature check
  // in LicenseCrypto.verify() + the exact-match check against the
  // persisted salt-derived id in LicenseCore.verifyLicenseFile() —
  // see that file), the correct fix is to remove ALL environment
  // signals, not add another one to a still-open list. The persisted
  // device salt is already sufficient to make the id unique per
  // browser profile/device; environment signals were never adding
  // uniqueness, only fragility.
  function collectEnvironmentSignals() {
    // Intentionally empty: no live environment property (screen,
    // viewport, orientation, platform, hardwareConcurrency, language,
    // timeZone, or any other navigator/Intl-derived value) is mixed
    // into the Machine ID. The ONLY input is the persisted device
    // salt below, so nothing about the runtime environment can ever
    // cause the id to drift on an otherwise-untouched device.
    return '';
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
      var signals = collectEnvironmentSignals(); // always '' — kept as a named step so
                                                  // a future signal can only be added here
                                                  // deliberately, never silently.
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
