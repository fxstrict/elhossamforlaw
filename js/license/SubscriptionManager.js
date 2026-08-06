/**
 * ============================================================================
 * PHASE 30 — ENTERPRISE LICENSING & PROTECTION FRAMEWORK
 * File: js/license/SubscriptionManager.js
 * ----------------------------------------------------------------------------
 * Components 10 "Subscription Manager" + 11 "Renewal System" +
 * 12 "Grace Period" of the licensing brief. The actual state-machine
 * math (ACTIVE/GRACE/READ_ONLY) lives in LicenseCore.computeSubscriptionState
 * — this file is the thin layer on top that:
 *   - Formats the renewal countdown copy the brief specifies verbatim
 *     (باقي 30/15/7/3/1 يوم).
 *   - Re-checks the state on a timer so a browser tab left open across
 *     midnight (or across the grace-period boundary) updates without
 *     a manual reload.
 *   - Emits 'license:banner' events LicenseManagerPanel.js listens to.
 *
 * 100% additive: defines exactly one new global, window.SubscriptionManager.
 * ============================================================================
 */
(function (window) {
  'use strict';

  var RECHECK_INTERVAL_MS = 6 * 60 * 60 * 1000; // every 6h is plenty for a day-granularity state machine
  var _timer = null;

  /**
   * @param {number|null} daysRemaining  negative once expired
   * @returns {string} Arabic countdown copy per brief §11
   */
  function formatRenewalCopy(daysRemaining) {
    if (daysRemaining === null) return 'ترخيص دائم — لا يحتاج تجديدًا.';
    if (daysRemaining > 30) return 'الاشتراك ساري.';
    if (daysRemaining > 15) return 'باقي 30 يومًا على انتهاء الاشتراك.';
    if (daysRemaining > 7) return 'باقي 15 يومًا على انتهاء الاشتراك.';
    if (daysRemaining > 3) return 'باقي 7 أيام على انتهاء الاشتراك.';
    if (daysRemaining > 1) return 'باقي 3 أيام على انتهاء الاشتراك — يُرجى التجديد.';
    if (daysRemaining === 1) return 'باقي يوم واحد على انتهاء الاشتراك — يُرجى التجديد فورًا.';
    if (daysRemaining === 0) return 'اليوم آخر يوم في الاشتراك.';
    return 'انتهى الاشتراك.';
  }

  function formatGraceCopy(daysIntoGrace, graceDays) {
    var remaining = Math.max(0, graceDays - daysIntoGrace);
    return 'انتهى الاشتراك ودخل النظام فترة السماح — متبقٍ ' + remaining +
      ' يومًا قبل التحول لوضع القراءة فقط (Read Only).';
  }

  function currentBanner() {
    var status = window.LicenseCore ? window.LicenseCore.getStatus() : null;
    if (!status || !status.info) return null;

    var info = status.info;
    if (status.state === window.LicenseCore.States.ACTIVE) {
      if (info.daysRemaining !== null && info.daysRemaining <= 30) {
        return { level: 'info', text: formatRenewalCopy(info.daysRemaining) };
      }
      return null;
    }
    if (status.state === window.LicenseCore.States.GRACE) {
      var graceDays = (typeof info.graceDays === 'number') ? info.graceDays : 15;
      return { level: 'warning', text: formatGraceCopy(info.daysIntoGrace, graceDays) };
    }
    if (status.state === window.LicenseCore.States.READ_ONLY) {
      return { level: 'danger', text: 'انتهى الاشتراك وفترة السماح — النظام الآن في وضع القراءة فقط. يمكنك البحث والطباعة وتصدير PDF والنسخ الاحتياطي، ولا يمكن إضافة أو تعديل أو حذف بيانات حتى التجديد.' };
    }
    return null;
  }

  function _emitBanner() {
    var banner = currentBanner();
    try {
      window.dispatchEvent(new CustomEvent('license:banner', { detail: banner }));
    } catch (e) {}
  }

  function start() {
    if (_timer) return;
    _emitBanner();
    window.addEventListener('license:state', _emitBanner);
    _timer = window.setInterval(function () {
      if (window.LicenseCore) window.LicenseCore.reevaluate ? window.LicenseCore.reevaluate() : null;
      _emitBanner();
    }, RECHECK_INTERVAL_MS);
  }

  function stop() {
    if (_timer) { window.clearInterval(_timer); _timer = null; }
    window.removeEventListener('license:state', _emitBanner);
  }

  var api = {
    formatRenewalCopy: formatRenewalCopy,
    formatGraceCopy: formatGraceCopy,
    currentBanner: currentBanner,
    start: start,
    stop: stop
  };

  window.SubscriptionManager = api;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof window !== 'undefined' ? window : globalThis);
