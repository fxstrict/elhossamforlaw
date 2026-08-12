/**
 * ================================================================
 * LoginAttempts.js — Failed-Attempt Lockout | نظام الحسام للمحاماة
 * ================================================================
 * PHASE 32 — Login Screen, Session Activation & Users Admin Panel
 *
 * Source of design: brief's "قفل الحساب — بعد 5 محاولات خاطئة، يقفل 30
 * دقيقة".
 *
 * WHAT THIS FILE IS
 *   Pure functions over a user record's two lockout fields
 *   (`محاولات_فاشلة`: number, `مقفل_حتى`: ISO string | null). No I/O,
 *   no Repository calls, no Date.now() side effects hidden inside —
 *   `now` is always passed in, so this is 100% deterministic and
 *   trivially testable. LoginScreen.js calls these, then persists the
 *   returned patch via `UsersRepository.update()` itself.
 *
 * WHAT THIS FILE IS NOT
 *   - Not account STATUS (`الحالة`, e.g. 'موقوف') — that is a separate,
 *     administrator-controlled field on the user record (Phase 31,
 *     UsersRepository.js) and is untouched by this file. A lockout is
 *     always temporary and self-clearing; a status change is not.
 *
 * Load order: additive file, zero dependencies. Safe to load anywhere.
 * ================================================================
 */

(function (root) {
  'use strict';

  var MAX_ATTEMPTS = 5;
  var LOCK_MINUTES = 30;

  /**
   * isLocked(user, now) -> boolean
   * @param {Object} user
   * @param {Date} [now]
   */
  function isLocked(user, now) {
    now = now || new Date();
    var until = user && user.مقفل_حتى;
    if (!until) return false;
    return new Date(until).getTime() > now.getTime();
  }

  /**
   * lockedUntil(user) -> Date|null — when the current lock (if any) expires.
   * @param {Object} user
   */
  function lockedUntil(user) {
    var until = user && user.مقفل_حتى;
    return until ? new Date(until) : null;
  }

  /**
   * recordFailure(user, now) -> {محاولات_فاشلة, مقفل_حتى}
   * Returns the PATCH to persist (via UsersRepository.update(id, patch)) —
   * does not mutate `user` in place.
   * @param {Object} user
   * @param {Date} [now]
   */
  function recordFailure(user, now) {
    now = now || new Date();
    var attempts = ((user && user.محاولات_فاشلة) || 0) + 1;
    var patch = { محاولات_فاشلة: attempts };
    if (attempts >= MAX_ATTEMPTS) {
      var until = new Date(now.getTime() + LOCK_MINUTES * 60 * 1000);
      patch.مقفل_حتى = until.toISOString();
      patch.محاولات_فاشلة = 0; // lock is now the deterrent; counter resets under it
    }
    return patch;
  }

  /**
   * recordSuccess() -> {محاولات_فاشلة, مقفل_حتى} — the reset patch to
   * persist on any successful login, clearing both fields.
   */
  function recordSuccess() {
    return { محاولات_فاشلة: 0, مقفل_حتى: null };
  }

  var api = {
    MAX_ATTEMPTS: MAX_ATTEMPTS,
    LOCK_MINUTES: LOCK_MINUTES,
    isLocked: isLocked,
    lockedUntil: lockedUntil,
    recordFailure: recordFailure,
    recordSuccess: recordSuccess
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  if (root) {
    root.HossamLoginAttempts = api;
  }
})(typeof window !== 'undefined' ? window : (typeof global !== 'undefined' ? global : this));
