/**
 * ============================================================================
 * PHASE 30 — ENTERPRISE LICENSING & PROTECTION FRAMEWORK
 * File: js/license/LicenseCore.js
 * ----------------------------------------------------------------------------
 * Component 1 "License Core" of the licensing brief — the heart of the
 * whole system. Responsible for: reading the license, verifying it,
 * verifying the signature (delegated to LicenseCrypto.js), extracting
 * subscription type / expiry / customer permissions, and exposing a
 * single source of truth (window.LicenseCore) that every other Phase 30
 * module (ReadOnlyGuard, ActivationWizard, SubscriptionManager,
 * LicenseManagerPanel, LicenseOnlineValidator) reads from.
 *
 * LICENSE FILE FORMAT (what tools/license-generator/ produces, and what
 * this file consumes) — a JSON document, typically saved as `*.hsm`:
 * {
 *   "v": 1,
 *   "alg": "ECDSA-P256-SHA256",
 *   "payload": {
 *     "licenseId":    "HSM-LIC-7F3A9C21",
 *     "customer":     { "name": "...", "phone": "...", "email": "..." },
 *     "edition":      "Professional",      // Starter|Professional|Enterprise|Network|Cloud
 *     "type":         "yearly",            // trial|monthly|yearly|lifetime
 *     "machineId":    "HSM-8D2A-E98F-41AA",
 *     "modules":      ["AI","Backup"],     // §15 Modules License
 *     "issuedAt":     "2026-08-01T00:00:00.000Z",
 *     "expiresAt":    "2027-08-01T00:00:00.000Z", // null => دائم (lifetime)
 *     "supportUntil": "2027-08-01T00:00:00.000Z", // null => no support cutoff
 *     "graceDays":    15,
 *     "maxTransfers": 2,
 *     "transferCount":0
 *   },
 *   "signature": "base64..."   // ECDSA signature over canonical(payload)
 * }
 *
 * STATE MACHINE (window.LicenseCore.getStatus().state):
 *   NOT_ACTIVATED  — no license stored yet. Full-screen Activation Wizard.
 *   INVALID        — stored license present but signature/machineId/JSON
 *                     verification failed (or Online Validation reported
 *                     status:'revoked'). Full-screen Activation Wizard.
 *   ACTIVE         — signature valid, machineId matches, not expired
 *                     (or expiresAt is null / lifetime).
 *   GRACE          — expired but still inside payload.graceDays. App is
 *                     fully usable, a dismissible banner is shown.
 *   READ_ONLY      — expired and past the grace period. Repository
 *                     write ops (create/update/delete/restore) throw
 *                     PermissionError (see js/core/Repository.js
 *                     _guardWritable, Phase 30 addition). Search, view,
 *                     print, export PDF, backup/restore all keep
 *                     working, exactly as specified in §13.
 *
 * PERSISTENCE: localStorage key below (NOT the IndexedDB Repository
 * layer) deliberately — the license gate must be evaluable at the very
 * first paint, long before RepositoryReadyCoordinator resolves.
 *
 * 100% additive: defines exactly one new global, window.LicenseCore.
 * ============================================================================
 */
(function (window) {
  'use strict';

  var STORAGE_KEY = 'hsm_license_record_v1';
  var DEFAULT_GRACE_DAYS = 15;
  var ONLINE_CHECK_INTERVAL_DAYS = 30;

  var States = Object.freeze({
    NOT_ACTIVATED: 'NOT_ACTIVATED',
    INVALID: 'INVALID',
    ACTIVE: 'ACTIVE',
    GRACE: 'GRACE',
    READ_ONLY: 'READ_ONLY'
  });

  /** In-memory cache of the last computed status, recomputed by init()
   *  and by every activate()/deactivate()/applyRemoteStatus() call. */
  var _current = { state: States.NOT_ACTIVATED, info: null, reason: 'no_license_stored' };
  var _initPromise = null;

  function _readStoredRecord() {
    try {
      var raw = window.localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }

  function _writeStoredRecord(record) {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(record));
      return true;
    } catch (e) {
      return false;
    }
  }

  function _clearStoredRecord() {
    try { window.localStorage.removeItem(STORAGE_KEY); } catch (e) {}
  }

  function _daysBetween(a, b) {
    return (b.getTime() - a.getTime()) / 86400000;
  }

  /**
   * Pure function: given a verified license payload and "now", decides
   * ACTIVE / GRACE / READ_ONLY. Exported separately so
   * SubscriptionManager.js and unit tests can exercise it without
   * touching storage or crypto.
   * @param {Object} payload
   * @param {Date} [now]
   * @returns {{state:string, daysRemaining:?number, daysIntoGrace:?number}}
   */
  function computeSubscriptionState(payload, now) {
    now = now || new Date();
    if (!payload.expiresAt) {
      return { state: States.ACTIVE, daysRemaining: null, daysIntoGrace: null };
    }
    var expires = new Date(payload.expiresAt);
    var daysRemaining = Math.ceil(_daysBetween(now, expires));
    if (daysRemaining >= 0) {
      return { state: States.ACTIVE, daysRemaining: daysRemaining, daysIntoGrace: null };
    }
    var graceDays = (typeof payload.graceDays === 'number') ? payload.graceDays : DEFAULT_GRACE_DAYS;
    var daysIntoGrace = -daysRemaining;
    if (daysIntoGrace <= graceDays) {
      return { state: States.GRACE, daysRemaining: daysRemaining, daysIntoGrace: daysIntoGrace };
    }
    return { state: States.READ_ONLY, daysRemaining: daysRemaining, daysIntoGrace: daysIntoGrace };
  }

  /**
   * Verifies a full license file object: JSON shape, signature, and
   * machineId match against this browser. Does NOT touch storage.
   * @param {Object} licenseFile
   * @returns {Promise<{ok:boolean, reason:?string, payload:?Object}>}
   */
  async function verifyLicenseFile(licenseFile) {
    if (!licenseFile || typeof licenseFile !== 'object' || !licenseFile.payload || !licenseFile.signature) {
      return { ok: false, reason: 'malformed_file', payload: null };
    }
    var payload = licenseFile.payload;
    if (!payload.licenseId || !payload.machineId || !payload.edition) {
      return { ok: false, reason: 'malformed_payload', payload: null };
    }

    if (!window.LicenseCrypto || !window.LicenseCrypto.isAvailable()) {
      return { ok: false, reason: 'crypto_unavailable', payload: null };
    }

    var signatureOk = await window.LicenseCrypto.verify(payload, licenseFile.signature);
    if (!signatureOk) {
      return { ok: false, reason: 'invalid_signature', payload: null };
    }

    var myMachineId = await window.MachineFingerprint.getMachineId();
    if (payload.machineId !== myMachineId) {
      return { ok: false, reason: 'machine_mismatch', payload: payload };
    }

    return { ok: true, reason: null, payload: payload };
  }

  function _setCurrent(state, payload, reason) {
    _current = { state: state, info: payload || null, reason: reason || null };
    try {
      window.dispatchEvent(new CustomEvent('license:state', { detail: _current }));
    } catch (e) {
      // CustomEvent unsupported in some very old embedded webviews —
      // state is still readable synchronously via getStatus(), so this
      // is a soft failure only (no reactive banner update).
    }
  }

  /**
   * Re-evaluates the currently stored license (if any) against "now"
   * and updates _current accordingly. Called by init() and by the
   * daily-ish background timer in SubscriptionManager.js so a session
   * left open across midnight transitions ACTIVE -> GRACE -> READ_ONLY
   * without requiring a page reload.
   */
  async function reevaluate() {
    var record = _readStoredRecord();
    if (!record || !record.licenseFile) {
      _setCurrent(States.NOT_ACTIVATED, null, 'no_license_stored');
      return _current;
    }

    if (record.revoked) {
      _setCurrent(States.INVALID, null, 'revoked_remote');
      return _current;
    }

    var verification = await verifyLicenseFile(record.licenseFile);
    if (!verification.ok) {
      _setCurrent(States.INVALID, verification.payload, verification.reason);
      return _current;
    }

    var sub = computeSubscriptionState(verification.payload, new Date());
    _setCurrent(sub.state, Object.assign({}, verification.payload, {
      daysRemaining: sub.daysRemaining,
      daysIntoGrace: sub.daysIntoGrace
    }), null);
    return _current;
  }

  /**
   * Boot-time entry point. Idempotent — safe to call more than once.
   * @returns {Promise<{state:string, info:?Object, reason:?string}>}
   */
  function init() {
    if (_initPromise) return _initPromise;
    _initPromise = reevaluate();
    return _initPromise;
  }

  /**
   * Activates (or re-activates / renews) this browser profile with a
   * license file the user pasted or uploaded.
   * @param {Object|string} licenseFileOrJsonString
   * @returns {Promise<{ok:boolean, reason:?string}>}
   */
  async function activate(licenseFileOrJsonString) {
    var licenseFile = licenseFileOrJsonString;
    if (typeof licenseFileOrJsonString === 'string') {
      try { licenseFile = JSON.parse(licenseFileOrJsonString); }
      catch (e) { return { ok: false, reason: 'malformed_json' }; }
    }

    var verification = await verifyLicenseFile(licenseFile);
    if (!verification.ok) {
      return { ok: false, reason: verification.reason };
    }

    _writeStoredRecord({
      licenseFile: licenseFile,
      activatedAt: new Date().toISOString(),
      lastOnlineCheck: null,
      revoked: false
    });

    await reevaluate();
    return { ok: true, reason: null };
  }

  /**
   * §22 "Device Reset" / §21 "License Transfer" support: clears the
   * locally stored license so the Activation Wizard reappears (e.g.
   * after the office issued a new license file for a replaced machine).
   * Does NOT contact any server — this is purely a local reset.
   */
  function deactivate() {
    _clearStoredRecord();
    _setCurrent(States.NOT_ACTIVATED, null, 'deactivated_locally');
  }

  /**
   * Called by LicenseOnlineValidator.js after a successful §20 "Online
   * Validation" round-trip. `remoteStatus` is one of
   * 'active'|'revoked'|'transferred'|'unknown' as returned by
   * Config/09_License.gs → apiCheckLicenseStatus().
   */
  async function applyRemoteStatus(remoteStatus) {
    var record = _readStoredRecord();
    if (!record) return;
    record.lastOnlineCheck = new Date().toISOString();
    if (remoteStatus === 'revoked' || remoteStatus === 'transferred') {
      record.revoked = true;
    }
    _writeStoredRecord(record);
    await reevaluate();
  }

  function getStatus() {
    return _current;
  }

  function getStoredRecordMeta() {
    var record = _readStoredRecord();
    if (!record) return null;
    return {
      activatedAt: record.activatedAt,
      lastOnlineCheck: record.lastOnlineCheck,
      licenseId: record.licenseFile && record.licenseFile.payload && record.licenseFile.payload.licenseId
    };
  }

  var api = {
    States: States,
    init: init,
    reevaluate: reevaluate,
    activate: activate,
    deactivate: deactivate,
    applyRemoteStatus: applyRemoteStatus,
    getStatus: getStatus,
    getStoredRecordMeta: getStoredRecordMeta,
    computeSubscriptionState: computeSubscriptionState, // exposed for tests
    verifyLicenseFile: verifyLicenseFile,                // exposed for tests
    ONLINE_CHECK_INTERVAL_DAYS: ONLINE_CHECK_INTERVAL_DAYS
  };

  window.LicenseCore = api;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof window !== 'undefined' ? window : globalThis);
