/**
 * ================================================================
 * File: js/license/CredentialAlertBanner.js
 * ================================================================
 * PHASE F.4.1 — closes the DISCOVERED DEBT logged at F.4 closure
 * (Master Report §42): "لا يوجد أي كود فى الواجهة الأمامية يتفاعل مع
 * AUTH_MISSING_CREDENTIAL" — an installation whose local credential is
 * missing/cleared silently stops syncing after F.4's Stage-2
 * Fail-Closed change, with no message telling the user why or what to
 * do.
 *
 * WHAT THIS FILE DOES:
 *   - Listens for the 'credential:missing' DOM event, dispatched by
 *     js/api/api.js (ApiService._notifyMissingCredential()) the moment
 *     any save/update/delete is rejected with authCode
 *     AUTH_MISSING_CREDENTIAL.
 *   - Shows a persistent banner telling the user this device isn't
 *     registered and that changes aren't reaching the server, pointing
 *     them at the existing "تسجيل هذا التثبيت" control
 *     (js/license/LicenseManagerPanel.js, IMPL-B) already present in
 *     الإعدادات > الترخيص.
 *
 * WHAT THIS FILE DELIBERATELY DOES NOT DO (scope discipline):
 *   - Does NOT reuse js/license/LicenseManagerPanel.js's existing
 *     'license:banner' element/event: that mechanism's dismiss logic
 *     is keyed to LicenseCore's subscription state (status.state —
 *     ACTIVE/GRACE/READ_ONLY/etc.) and is explicitly single-
 *     dismiss-per-state. A missing credential is an orthogonal
 *     condition (Stage-2 installation auth, not subscription state);
 *     forcing it through that dismiss logic would either fail to
 *     reappear when it should, or incorrectly suppress the real
 *     subscription banner's own dismiss tracking. This file owns a
 *     fully separate DOM element/id and its own independent dismiss
 *     logic instead.
 *   - Does NOT alter js/api/api.js's retry/OfflineQueue behavior,
 *     js/license/InstallationRegistrar.js, or any Stage-1/Stage-2
 *     server logic. Purely an additive UI notification layer.
 *   - Does NOT fire for AUTH_INVALID / AUTH_UNKNOWN_INSTALLATION /
 *     AUTH_REVOKED — those are different, already-terminal states
 *     outside this debt item's documented scope.
 *
 * 100% additive: defines exactly one new global, window.CredentialAlertBanner.
 * ================================================================
 */
(function () {
  'use strict';

  var BANNER_ID = 'credAlertBanner';
  var _dismissed = false; // independent of any license:banner dismiss state

  function _ensureBannerEl() {
    var el = document.getElementById(BANNER_ID);
    if (el) return el;
    el = document.createElement('div');
    el.id = BANNER_ID;
    el.className = 'lic-banner danger';
    el.setAttribute('hidden', 'hidden');
    el.innerHTML =
      '<span id="credAlertBannerText">هذا الجهاز غير مسجَّل — التعديلات الأخيرة لم تصل للسيرفر. ' +
      'افتح الإعدادات > الترخيص واضغط "تسجيل هذا التثبيت" لاسترجاع أو تسجيل هذا الجهاز.</span>' +
      '<button type="button" id="credAlertBannerCloseBtn" aria-label="إغلاق">&times;</button>';
    document.body.appendChild(el);
    el.querySelector('#credAlertBannerCloseBtn').addEventListener('click', function () {
      _dismissed = true;
      el.setAttribute('hidden', 'hidden');
    });
    return el;
  }

  function show() {
    if (_dismissed) return; // user already acknowledged this device's alert this session
    var el = _ensureBannerEl();
    el.removeAttribute('hidden');
  }

  function onCredentialMissing() {
    // Re-check live state rather than trusting only the event: if the
    // user has since completed registration/recovery (IMPL-B/C) in
    // another tab or since page load, don't show a stale alert.
    if (window.InstallationRegistrar && typeof window.InstallationRegistrar.hasLocalCredential === 'function') {
      if (window.InstallationRegistrar.hasLocalCredential()) return;
    }
    show();
  }

  function init() {
    window.addEventListener('credential:missing', onCredentialMissing);
  }

  window.CredentialAlertBanner = { init: init };
})();
