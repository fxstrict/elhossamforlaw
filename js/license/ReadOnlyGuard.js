/**
 * ============================================================================
 * PHASE 30 — ENTERPRISE LICENSING & PROTECTION FRAMEWORK
 * File: js/license/ReadOnlyGuard.js
 * ----------------------------------------------------------------------------
 * Component 13 "Read Only Mode" of the licensing brief. This is the
 * bridge object js/core/Repository.js's new _guardWritable() method
 * looks for (window.LicenseReadOnlyGuard). Deliberately tiny and
 * synchronous — Repository write calls cannot await anything here, so
 * this module only ever reads the value LicenseCore already computed
 * and cached (LicenseCore.getStatus()), never re-verifies anything
 * itself.
 *
 * Per the brief, Read-Only Mode allows: open/search/print/export
 * PDF/backup/restore. It blocks: create/update/delete/restore(entity)
 * — exactly the four Repository methods that call _guardWritable().
 *
 * NOT_ACTIVATED and INVALID are treated as read-only too (defense in
 * depth) even though in practice the full-screen ActivationWizard
 * overlay already prevents the user from reaching those write actions
 * in the UI — this guard is what makes that a real enforcement
 * boundary instead of a purely cosmetic one, in case the overlay is
 * ever bypassed (browser devtools, automated script, etc.).
 *
 * 100% additive: defines exactly one new global, window.LicenseReadOnlyGuard.
 * ============================================================================
 */
(function (window) {
  'use strict';

  var REASON_LABELS = {
    NOT_ACTIVATED: 'not_activated',
    INVALID: 'invalid_license',
    READ_ONLY: 'subscription_expired'
  };

  function isReadOnly() {
    if (!window.LicenseCore) return false; // licensing module not loaded at all: no-op, zero regression
    var status = window.LicenseCore.getStatus();
    if (!status) return false;
    return status.state === window.LicenseCore.States.NOT_ACTIVATED ||
           status.state === window.LicenseCore.States.INVALID ||
           status.state === window.LicenseCore.States.READ_ONLY;
  }

  function getReason() {
    if (!window.LicenseCore) return 'unknown';
    var status = window.LicenseCore.getStatus();
    if (!status) return 'unknown';
    return REASON_LABELS[status.state] || 'unknown';
  }

  var api = { isReadOnly: isReadOnly, getReason: getReason };
  window.LicenseReadOnlyGuard = api;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof window !== 'undefined' ? window : globalThis);
