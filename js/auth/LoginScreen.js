/**
 * ============================================================================
 * PHASE 32 — Login Screen, Session Activation & Users Admin Panel
 * File: js/auth/LoginScreen.js
 * ----------------------------------------------------------------------------
 * The missing piece Phase 31's own report flagged as the next phase: this
 * is what actually calls `HossamSession.setCurrentUser()`, which is the
 * one thing that turns every permission check built in Phase 31 from
 * "computed but inert" into "actually enforced".
 *
 * WHEN THIS SCREEN APPEARS (opt-in by construction, not a flag)
 *   `init()` shows the overlay if, and only if, BOTH are true:
 *     1. `UsersRepository` contains at least one user with `الحالة`
 *        === 'نشط' (an office has to have deliberately created and
 *        activated a user account for this to ever trigger), AND
 *     2. `HossamSession.getCurrentUser()` is currently null (nobody is
 *        logged in yet this session).
 *   An office that never opens the (Phase 32) Users Admin Panel and
 *   never creates a user account will NEVER see this screen — the app
 *   behaves exactly as it did before Phase 31/32, forever, by default.
 *   This mirrors Phase 31's own fail-open philosophy one level up: Phase
 *   31 made enforcement inert until a session exists; this file is the
 *   one thing that can create that session, and it only offers to when
 *   the office has opted in by creating a user.
 *
 * FLOW
 *   username + password -> UsersRepository.get(username) -> account
 *   status must be 'نشط' -> LoginAttempts.isLocked() must be false ->
 *   PermissionService.withinLoginWindow() must be true ->
 *   PasswordHasher.verifyPassword() must match -> on success:
 *   HossamSession.setCurrentUser(), LoginAttempts.recordSuccess()
 *   persisted, HossamLoginLog.record({نجاح:true}); on any failure short
 *   of a match: LoginAttempts.recordFailure() persisted (if the account
 *   was found), HossamLoginLog.record({نجاح:false}), and a single
 *   generic Arabic error shown (deliberately never reveals WHICH check
 *   failed — same-shaped rejection whether the username doesn't exist,
 *   the password is wrong, or the account is locked/suspended/outside
 *   its login window, to avoid leaking which usernames are valid).
 *
 * 100% additive: defines exactly one new global, window.LoginScreen.
 * Same runtime-built-DOM pattern as ActivationWizard.js (Phase 30) and
 * SafeModeController.js before it — does not touch index.html's markup
 * beyond the one mount point + script tags (see docs/phase32).
 * ============================================================================
 */
(function (window, document) {
  'use strict';

  var GENERIC_ERROR = 'اسم المستخدم أو كلمة المرور غير صحيحة، أو الحساب غير متاح حاليًا.';

  var _mounted = false;
  var els = {};
  var _onSuccess = null;

  function build() {
    var overlay = document.createElement('div');
    overlay.className = 'hsm-auth-overlay';
    overlay.id = 'hsmLoginOverlay';
    overlay.setAttribute('hidden', 'hidden');
    overlay.innerHTML =
      '<div class="hsm-auth-card" role="dialog" aria-modal="true" aria-labelledby="hsmLoginTitle">' +
        '<h2 id="hsmLoginTitle">تسجيل الدخول</h2>' +
        '<p class="hsm-auth-sub">نظام الحسام للمحاماة</p>' +
        '<div class="hsm-auth-field">' +
          '<label for="hsmLoginUsername">اسم المستخدم</label>' +
          '<input type="text" id="hsmLoginUsername" autocomplete="username" />' +
        '</div>' +
        '<div class="hsm-auth-field">' +
          '<label for="hsmLoginPassword">كلمة المرور</label>' +
          '<input type="password" id="hsmLoginPassword" autocomplete="current-password" />' +
        '</div>' +
        '<button type="button" class="hsm-auth-btn-primary" id="hsmLoginBtn">دخول</button>' +
        '<div class="hsm-auth-error" id="hsmLoginError"></div>' +
        '<p class="hsm-auth-footer">للمساعدة في استعادة الدخول، يرجى مراجعة مدير المكتب.</p>' +
      '</div>';
    document.body.appendChild(overlay);

    els.overlay = overlay;
    els.username = overlay.querySelector('#hsmLoginUsername');
    els.password = overlay.querySelector('#hsmLoginPassword');
    els.btn = overlay.querySelector('#hsmLoginBtn');
    els.error = overlay.querySelector('#hsmLoginError');

    els.btn.addEventListener('click', onSubmit);
    els.password.addEventListener('keydown', function (e) { if (e.key === 'Enter') onSubmit(); });

    _mounted = true;
  }

  function showError(msg) {
    els.error.textContent = msg;
  }

  function setBusy(busy) {
    els.btn.disabled = busy;
    els.btn.textContent = busy ? 'جارٍ التحقق...' : 'دخول';
  }

  async function onSubmit() {
    showError('');
    var username = (els.username.value || '').trim();
    var password = els.password.value || '';
    if (!username || !password) {
      showError('الرجاء إدخال اسم المستخدم وكلمة المرور.');
      return;
    }
    setBusy(true);
    try {
      var repo = window.UsersRepository ? new window.UsersRepository() : null;
      if (!repo) { showError(GENERIC_ERROR); return; }
      await repo.open();
      var user = repo.get(username);

      if (!user) {
        // No account to record a failure against — still logs a
        // login-log entry against the attempted username, برief
        // "سجل الدخول" spec ("التاريخ/الوقت/نجاح أو فشل").
        if (window.HossamLoginLog) window.HossamLoginLog.record({ المستخدم: username, نجاح: false, سبب: 'unknown_username' });
        showError(GENERIC_ERROR);
        return;
      }

      var now = new Date();
      var reason = null;
      if (user.الحالة !== 'نشط') reason = 'inactive_status';
      else if (window.HossamLoginAttempts && window.HossamLoginAttempts.isLocked(user, now)) reason = 'locked';
      else if (window.HossamPermissionService && !window.HossamPermissionService.withinLoginWindow(user, now)) reason = 'outside_login_window';

      if (reason) {
        if (window.HossamLoginLog) window.HossamLoginLog.record({ المستخدم: username, نجاح: false, سبب: reason });
        showError(GENERIC_ERROR);
        return;
      }

      var stored = user.كلمة_المرور_مجزأة;
      var matches = stored && window.HossamPasswordHasher
        ? await window.HossamPasswordHasher.verifyPassword(password, stored)
        : false;

      if (!matches) {
        if (window.HossamLoginAttempts) {
          var failPatch = window.HossamLoginAttempts.recordFailure(user, now);
          await repo.update(username, failPatch);
        }
        if (window.HossamLoginLog) window.HossamLoginLog.record({ المستخدم: username, نجاح: false, سبب: 'wrong_password' });
        showError(GENERIC_ERROR);
        return;
      }

      // Success.
      if (window.HossamLoginAttempts) {
        await repo.update(username, window.HossamLoginAttempts.recordSuccess());
      }
      await repo.update(username, { آخر_دخول: now.toISOString() });
      if (window.HossamLoginLog) window.HossamLoginLog.record({ المستخدم: username, نجاح: true });
      if (window.HossamSession) window.HossamSession.setCurrentUser(user);

      els.password.value = '';
      els.overlay.setAttribute('hidden', 'hidden');
      if (typeof _onSuccess === 'function') _onSuccess(user);
    } catch (err) {
      showError(GENERIC_ERROR);
    } finally {
      setBusy(false);
    }
  }

  /**
   * shouldShow() -> Promise<boolean> — see file header, "WHEN THIS
   * SCREEN APPEARS".
   */
  async function shouldShow() {
    if (!window.UsersRepository) return false;
    if (window.HossamSession && window.HossamSession.getCurrentUser()) return false;
    try {
      var repo = new window.UsersRepository();
      await repo.open();
      var all = repo.getAll();
      return all.some(function (u) { return u.الحالة === 'نشط'; });
    } catch (e) {
      return false; // any storage error here must never block boot — fail-open on the GATE itself.
    }
  }

  /**
   * init(onSuccess) — mounts (once) and shows the overlay if
   * shouldShow() resolves true. `onSuccess(user)` fires once, right
   * after a successful login, so a caller (index.html's boot listener)
   * can resume whatever it was waiting to do.
   * @param {Function} [onSuccess]
   */
  async function init(onSuccess) {
    _onSuccess = onSuccess || null;
    var show = await shouldShow();
    if (!show) return false;
    if (!_mounted) build();
    els.overlay.removeAttribute('hidden');
    els.username.focus();
    return true;
  }

  window.LoginScreen = {
    init: init,
    shouldShow: shouldShow
  };
})(window, document);
