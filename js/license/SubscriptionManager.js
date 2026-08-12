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

  function _reevaluateAndEmit() {
    if (window.LicenseCore && window.LicenseCore.reevaluate) window.LicenseCore.reevaluate();
    _emitBanner();
  }

  // BUGFIX ("الأيام المتبقية لا تقل كل يوم"): the 6-hour setInterval
  // above is useless on a phone PWA that's mostly opened-then-backgrounded
  // rather than fully reloaded — mobile browsers/OSes routinely freeze or
  // fully suspend a backgrounded tab's JS timers, so the interval simply
  // never fires while the person isn't looking at the screen, and the
  // days-remaining value stays frozen at whatever it was when the tab was
  // last actually active. This has nothing to do with LicenseCore's date
  // math (computeSubscriptionState already recomputes correctly from a
  // fresh `new Date()` every time it runs) — the bug is that "every time
  // it runs" was too rare on mobile. Forcing a reevaluate the moment the
  // tab becomes visible again (foreground/resume/back from bfcache) closes
  // that gap without touching the state-machine math itself.
  function _onVisible() {
    if (document.visibilityState === 'visible') _reevaluateAndEmit();
  }

  /**
   * BUGFIX ("العلامة ثابتة على 30 يوم / غير متزامنة يوميًا"): the copy used
   * to jump between five fixed snapshot values (30/15/7/3/1) instead of
   * counting down day by day — so, e.g., every day from day 16 through day
   * 30 all displayed the identical "باقي 30 يومًا" text, making the badge
   * look frozen even though LicenseCore.computeSubscriptionState() was
   * already recomputing info.daysRemaining correctly underneath (the
   * re-evaluation-on-visibility fix above already ensures that number
   * itself refreshes daily). Now the exact live daysRemaining is rendered
   * every time, through correct Arabic day-count grammar (dual "يومان",
   * plural "أيام" for 3–10, singular-accusative "يومًا" for 11+, exactly
   * as this brief's existing "يوم واحد" special-case for 1 already did).
   * @param {number} n  whole days, >= 2 (1, 0 and negative are handled by
   *   formatRenewalCopy() itself before this is ever called)
   * @returns {string} correctly-declined Arabic day count, e.g. "3 أيام" / "20 يومًا"
   */
  function _arabicDaysPhrase(n) {
    if (n === 2) return 'يومان';
    if (n >= 3 && n <= 10) return n + ' أيام';
    return n + ' يومًا';
  }

  /**
   * @param {number|null} daysRemaining  negative once expired
   * @returns {string} Arabic countdown copy per brief §11
   */
  function formatRenewalCopy(daysRemaining) {
    if (daysRemaining === null) return 'ترخيص دائم — لا يحتاج تجديدًا.';
    if (daysRemaining > 30) return 'الاشتراك ساري.';
    if (daysRemaining < 0) return 'انتهى الاشتراك.';
    if (daysRemaining === 0) return 'اليوم آخر يوم في الاشتراك.';
    if (daysRemaining === 1) return 'باقي يوم واحد على انتهاء الاشتراك — يُرجى التجديد فورًا.';
    var urgentSuffix = daysRemaining <= 3 ? ' — يُرجى التجديد' : '';
    return 'باقي ' + _arabicDaysPhrase(daysRemaining) + ' على انتهاء الاشتراك' + urgentSuffix + '.';
  }

  /**
   * BUGFIX (same report, color half): the badge stayed the same fixed
   * blue/"info" color for the entire 2–30 day countdown, only turning
   * orange/red once the subscription had ALREADY expired into GRACE/
   * READ_ONLY. Per explicit request, the ACTIVE-state countdown badge now
   * gets progressively more "danger"-red the closer it gets to expiry,
   * reaching fully red exactly at 0 days remaining, over the final 7-day
   * window — 0 for anything above 7 days left (still plain "info" blue).
   * Pure presentation math, returned as a 0..1 number; LicenseManagerPanel.js
   * (which already owns all banner DOM/styling per this file's own header
   * convention) is the one that turns this into an actual color.
   * @param {number|null} daysRemaining
   * @returns {number} 0 (7+ days left) .. 1 (0 days left / expired)
   */
  function _urgencyFor(daysRemaining) {
    if (daysRemaining === null) return 0;
    if (daysRemaining >= 7) return 0;
    if (daysRemaining <= 0) return 1;
    return (7 - daysRemaining) / 7;
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
        return {
          level: 'info',
          text: formatRenewalCopy(info.daysRemaining),
          urgency: _urgencyFor(info.daysRemaining) // 0..1, see _urgencyFor() above
        };
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
    // See _onVisible's comment above for why this is needed alongside
    // the interval, not instead of it.
    document.addEventListener('visibilitychange', _onVisible);
    window.addEventListener('pageshow', _reevaluateAndEmit);
  }

  function stop() {
    if (_timer) { window.clearInterval(_timer); _timer = null; }
    window.removeEventListener('license:state', _emitBanner);
    document.removeEventListener('visibilitychange', _onVisible);
    window.removeEventListener('pageshow', _reevaluateAndEmit);
  }

  var api = {
    formatRenewalCopy: formatRenewalCopy,
    formatGraceCopy: formatGraceCopy,
    currentBanner: currentBanner,
    urgencyFor: _urgencyFor,
    start: start,
    stop: stop
  };

  window.SubscriptionManager = api;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof window !== 'undefined' ? window : globalThis);
