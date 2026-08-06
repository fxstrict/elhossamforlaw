/**
 * ============================================================================
 * PHASE 30 — ENTERPRISE LICENSING & PROTECTION FRAMEWORK
 * File: js/license/LicenseOnlineValidator.js
 * ----------------------------------------------------------------------------
 * Component 20 "Online Validation" of the licensing brief: every ~30
 * days, IF the browser reports it's online, ask the existing Apps
 * Script backend (Config/09_License.gs → apiCheckLicenseStatus, routed
 * from the existing doPost() in Config/06_Api.gs) whether this license
 * was manually revoked or transferred. Uses the project's existing
 * ApiService._post() transport (js/api/api.js) — no new network layer.
 *
 * This module NEVER blocks the app waiting on network. It fires the
 * check in the background, and only calls LicenseCore.applyRemoteStatus()
 * once a response actually arrives. Offline-first is preserved: a
 * customer who never gets internet access again simply keeps running
 * on the last-verified signed license file forever (component 19
 * "License Cache" in the brief — LicenseCore's localStorage record IS
 * that cache; no separate cache file is needed).
 *
 * 100% additive: defines exactly one new global,
 * window.LicenseOnlineValidator. Depends only on already-loaded
 * globals (ApiService, LicenseCore, MachineFingerprint); if any is
 * missing this module simply does nothing.
 * ============================================================================
 */
(function (window) {
  'use strict';

  function isDue() {
    if (!window.LicenseCore) return false;
    var meta = window.LicenseCore.getStoredRecordMeta();
    if (!meta) return false;
    if (!meta.lastOnlineCheck) return true;
    var last = new Date(meta.lastOnlineCheck);
    var days = (Date.now() - last.getTime()) / 86400000;
    return days >= window.LicenseCore.ONLINE_CHECK_INTERVAL_DAYS;
  }

  async function checkNow(force) {
    if (!window.LicenseCore || !window.ApiService) return { checked: false, reason: 'module_unavailable' };
    if (!navigator.onLine) return { checked: false, reason: 'offline' };
    if (!force && !isDue()) return { checked: false, reason: 'not_due' };

    var meta = window.LicenseCore.getStoredRecordMeta();
    if (!meta || !meta.licenseId) return { checked: false, reason: 'not_activated' };

    var machineId = await window.MachineFingerprint.getMachineId();

    try {
      var response = await window.ApiService._post({
        action: 'checkLicenseStatus',
        licenseId: meta.licenseId,
        machineId: machineId
      });
      var data = await response.json();
      var status = (data && data.status) ? data.status : 'unknown';
      await window.LicenseCore.applyRemoteStatus(status);
      return { checked: true, status: status };
    } catch (e) {
      // Network hiccup / CORS / backend not configured yet — fail silent
      // and simply try again next time isDue() is true. Never punishes
      // an offline or misconfigured-backend customer.
      return { checked: false, reason: 'network_error' };
    }
  }

  /** Wires up the "check once at boot if due, and again whenever the
   *  browser regains connectivity" behavior. Call once from the boot
   *  sequence (see index.html). */
  function scheduleAuto() {
    checkNow(false);
    window.addEventListener('online', function () { checkNow(false); });
  }

  window.LicenseOnlineValidator = {
    checkNow: checkNow,
    scheduleAuto: scheduleAuto,
    isDue: isDue
  };
})(typeof window !== 'undefined' ? window : globalThis);
