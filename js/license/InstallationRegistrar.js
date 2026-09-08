/**
 * ============================================================================
 * PHASE C v3 + v3.1 + v3.2 — Per-Installation Registration
 * File: js/license/InstallationRegistrar.js
 * ----------------------------------------------------------------------------
 * Client-side counterpart of Config/11_Auth.gs → apiRegisterInstallation().
 * Called once by js/license/ActivationWizard.js right after a `.hsm` license
 * activates successfully locally (see that file for the exact UX/flow —
 * PHASE_C_V3_2_AMENDMENT.md §2). Registers this device on the Apps Script
 * backend and stores the resulting Per-Installation Bearer Credential.
 *
 * 100% additive: defines exactly one new global, window.InstallationRegistrar.
 * Depends only on already-loaded globals (ApiService); if missing, every
 * method here simply fails silently (Fail-Open — see §14 of the approved
 * design: a failed/absent registration NEVER blocks or invalidates the
 * local `.hsm` license, which is already fully activated and persisted by
 * the time this module is ever invoked).
 *
 * ⚠️ Security-critical rules enforced in this file (do not relax without
 * re-opening PHASE_C_V3_2_AMENDMENT.md §2.4/§4/§11 explicitly):
 *   - `forceReissue` is NEVER set to true except in the exact one
 *     condition in _handleAlreadyRegistered_() below: a genuine
 *     ALREADY_REGISTERED response (not a network exception) AND a
 *     confirmed-empty local credential store for that installationId.
 *   - A network exception on the FIRST call must never be reinterpreted
 *     as license for forceReissue, and must never clear the in-memory
 *     pendingRequestId (see _register_once_'s catch block) — a manual
 *     retry must reuse the same requestId.
 *   - The raw credential is stored ONLY in the single localStorage key
 *     below. It is never logged (no console.*, no Logger — this runs in
 *     the browser only, but the rule is stated for completeness), never
 *     sent to analytics, never included in any thrown/displayed error.
 *   - The activation code itself never enters this module's persistent
 *     storage at all — ActivationWizard.js is responsible for clearing
 *     the input field before calling register() (see that file).
 * ============================================================================
 */
(function (window) {
  'use strict';

  var STORAGE_KEY = 'hsm_installation_credential_v1';

  // In-memory only (never persisted) — keyed by a stable identity of the
  // *logical* registration attempt so a manual retry with the same
  // activation code reuses the same requestId (idempotent retry), while a
  // different activation code (e.g. the user re-opened the wizard with a
  // different code) starts a fresh attempt. Cleared only on a genuine
  // terminal server result — never on a network exception (PHASE_C_V3_2
  // §2.4 correction).
  var _pending = null; // { key: string, requestId: string }

  function _uuid() {
    return (window.crypto && window.crypto.randomUUID)
      ? window.crypto.randomUUID()
      : (String(Date.now()) + '-' + Math.random().toString(36).slice(2));
  }

  function _readLocal() {
    try {
      var raw = window.localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }

  function _writeLocal(installationId, credential, credentialIssuedAt) {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify({
        installationId: installationId,
        credential: credential,
        credentialIssuedAt: credentialIssuedAt
      }));
    } catch (e) {
      // Storage unavailable (private mode edge cases) — Fail-Open: the
      // registration itself still succeeded server-side and remains
      // safely recoverable later via idempotent retry (same requestId),
      // per the Credential Re-Issuance design. Nothing to do here.
    }
  }

  /** True only when a credential is already stored for THIS installationId. */
  function _hasLocalCredentialFor(installationId) {
    var local = _readLocal();
    return !!(local && local.installationId === installationId && local.credential);
  }

  function _pendingKeyFor(fields) {
    // Stable per logical attempt: same licenseId+machineId+activationCode
    // ⇒ same key ⇒ same reused requestId across manual retries. A changed
    // activationCode (new attempt) naturally produces a different key.
    return fields.licenseId + '|' + fields.machineId + '|' + fields.activationCode;
  }

  function _getOrCreateRequestId(fields) {
    var key = _pendingKeyFor(fields);
    if (_pending && _pending.key === key) return _pending.requestId;
    var requestId = _uuid();
    _pending = { key: key, requestId: requestId };
    return requestId;
  }

  function _clearPending(fields) {
    var key = _pendingKeyFor(fields);
    if (_pending && _pending.key === key) _pending = null;
  }

  /**
   * Fires one HTTP call to registerInstallation. Returns:
   *   { networkError: true }                       — fetch/HTTP failure, no server verdict at all
   *   { networkError: false, data: {...} }          — a real, fully-parsed server response
   * Never throws. This is the single point where the network-exception /
   * valid-server-response distinction (PHASE_C_V3_2 §15) is established.
   */
  async function _callServer(fields, requestId, forceReissue) {
    try {
      var response = await window.ApiService.registerInstallation({
        licenseId: fields.licenseId,
        activationCode: fields.activationCode,
        machineId: fields.machineId,
        requestId: requestId,
        forceReissue: !!forceReissue
      });
      var data = await response.json();
      return { networkError: false, data: data };
    } catch (e) {
      // fetch rejection, non-2xx HTTP, or a legitimate `error`-carrying
      // body from ApiService._post()'s own generic check. Config/11_Auth.gs
      // never emits `error`, so in practice this is a true network/HTTP
      // failure — treated uniformly as Fail-Open, per design.
      return { networkError: true };
    }
  }

  /**
   * Handles a genuine ALREADY_REGISTERED verdict (PHASE_C_V3_2 §2.4).
   * The ONLY path in this module allowed to send forceReissue:true.
   */
  async function _handleAlreadyRegistered_(fields, requestId, installationId) {
    if (_hasLocalCredentialFor(installationId)) {
      // Device already holds a valid credential for this exact
      // installationId — nothing to do, no further network call.
      return;
    }
    // Confirmed-empty local store + confirmed ALREADY_REGISTERED from the
    // server: this is the one sanctioned condition for forceReissue.
    // At most one such follow-up call per logical attempt.
    var result = await _callServer(fields, requestId, true);
    if (!result.networkError && result.data && result.data.status === 'REISSUED' && result.data.credential) {
      _writeLocal(result.data.installationId, result.data.credential, new Date().toISOString());
    }
    // Any other outcome (network error, or server logic changed its mind,
    // e.g. INSTALLATION_REVOKED) — Fail-Open, silently done. No further
    // automatic follow-up call under any circumstance.
  }

  /**
   * Registers this device for Phase C. Fail-Open in every branch: never
   * throws, never blocks the caller beyond the awaited promise.
   *
   * @param {{licenseId:string, activationCode:string, machineId:string}} fields
   * @returns {Promise<void>}
   */
  async function register(fields) {
    if (!window.ApiService || !fields || !fields.licenseId || !fields.activationCode || !fields.machineId) {
      return; // Fail-Open — nothing sane to attempt.
    }

    var requestId = _getOrCreateRequestId(fields);
    var result = await _callServer(fields, requestId, false);

    if (result.networkError) {
      // Deliberately do NOT clear _pending here — see PHASE_C_V3_2 §2.4
      // correction: a manual retry (another register() call with the
      // same activationCode) must reuse this exact requestId.
      return;
    }

    var data = result.data || {};

    if (data.status === 'REGISTERED' || data.status === 'REISSUED') {
      if (data.credential && data.installationId) {
        _writeLocal(data.installationId, data.credential, new Date().toISOString());
      }
      _clearPending(fields);
      return;
    }

    if (data.status === 'ALREADY_REGISTERED') {
      await _handleAlreadyRegistered_(fields, requestId, data.installationId);
      _clearPending(fields);
      return;
    }

    // Any other terminal, valid server verdict — INVALID_ACTIVATION,
    // EXPIRED, REVOKED, ALREADY_USED, REQUEST_ID_MISMATCH,
    // INSTALLATION_REVOKED, LOCK_TIMEOUT, MALFORMED_REQUEST,
    // UNKNOWN_ERROR — is a real, final answer from the server (not a
    // network failure): clear pending, do not retry automatically.
    _clearPending(fields);
  }

  /** Used by ActivationWizard.js to decide whether to even show the
   *  Activation Code step (skip it entirely if this device already has
   *  a stored credential from an earlier successful registration). */
  function hasLocalCredential() {
    var local = _readLocal();
    return !!(local && local.installationId && local.credential);
  }

  window.InstallationRegistrar = {
    register: register,
    hasLocalCredential: hasLocalCredential
  };

})(typeof window !== 'undefined' ? window : this);
