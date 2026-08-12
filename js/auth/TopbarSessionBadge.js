/**
 * ============================================================================
 * TopbarSessionBadge.js — Site-wide Session Badge | نظام الحسام للمحاماة
 * ----------------------------------------------------------------------------
 * PROBLEM THIS FILE FIXES
 *   Phase 32's logout control (`js/auth/UsersAdminPanel.js`'s
 *   `#hsmLogoutBtn`) only exists inside the Settings -> "المستخدمون" card,
 *   so a user has to already know that screen exists (and have
 *   `CanViewUsers`) to log out or switch to a different username/role.
 *   Reported as "there's no way to log out and sign in as another user
 *   with different permissions". This file adds the same logout action
 *   (`HossamSession.clear()` + `LoginScreen.init()`) as a small, always-
 *   reachable control in the topbar (`#topbarRbacUserName` /
 *   `#topbarLogoutBtn`, index.html), the way virtually every modern web
 *   app surfaces "account / sign out" — not nested in a settings sub-page.
 *
 * VISIBILITY
 *   Both elements start `hidden` in index.html and are only revealed by
 *   render() when `HossamSession.getCurrentUser()` is non-null — i.e. for
 *   an office that has never created an RBAC user (the common case today,
 *   see LoginScreen.js's own "WHEN THIS SCREEN APPEARS" header) this file
 *   is a permanent no-op and the topbar looks exactly as it did before.
 *
 * 100% additive: defines exactly one new global, window.HossamTopbarSessionBadge.
 * Does not modify UsersAdminPanel.js's own logout button — that one still
 * works unchanged; this is a second, more discoverable entry point to the
 * exact same `HossamSession.clear()` action.
 * ============================================================================
 */
(function (window, document) {
  'use strict';

  function render() {
    var nameEl = document.getElementById('topbarRbacUserName');
    var btn = document.getElementById('topbarLogoutBtn');
    if (!nameEl || !btn) return;

    var user = window.HossamSession ? window.HossamSession.getCurrentUser() : null;
    if (!user) {
      nameEl.style.display = 'none';
      btn.style.display = 'none';
      nameEl.textContent = '';
      return;
    }

    nameEl.textContent = user.الاسم || user.اسم_المستخدم || '';
    nameEl.style.display = '';
    btn.style.display = '';

    // Rebind fresh each render() call (cheap; avoids duplicate listeners
    // accumulating across repeated logins in the same tab).
    var clone = btn.cloneNode(true);
    btn.parentNode.replaceChild(clone, btn);
    clone.addEventListener('click', function () {
      if (window.HossamSession) window.HossamSession.clear();
      render();
      if (window.HossamSidebarSessionBadge) window.HossamSidebarSessionBadge.render();
      if (window.LoginScreen) LoginScreen.init(function () {
        render();
        if (window.HossamSidebarSessionBadge) window.HossamSidebarSessionBadge.render();
      });
    });
  }

  window.HossamTopbarSessionBadge = { render: render };
})(typeof window !== 'undefined' ? window : this, typeof document !== 'undefined' ? document : undefined);
