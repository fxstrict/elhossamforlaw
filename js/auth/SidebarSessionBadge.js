/**
 * ============================================================================
 * SidebarSessionBadge.js — Sidebar Quick Logout | نظام الحسام للمحاماة
 * ----------------------------------------------------------------------------
 * PROBLEM THIS FILE FIXES
 *   There are already two logout entry points to the exact same
 *   `HossamSession.clear()` action:
 *     1. `js/auth/UsersAdminPanel.js`'s `#hsmLogoutBtn`, nested inside
 *        Settings -> "المستخدمون والصلاحيات".
 *     2. `js/auth/TopbarSessionBadge.js`'s `#topbarLogoutBtn`, in the topbar.
 *   Requested: a THIRD, always-visible entry point directly in the sidebar
 *   menu (under "الإعدادات"), so switching accounts doesn't require opening
 *   Settings or hunting the topbar. This file adds exactly that — nothing
 *   else. It does not remove or modify either existing button; both keep
 *   working exactly as before.
 *
 * VISIBILITY
 *   `#sidebarLogoutBtn` (index.html, sidebar nav, right after the
 *   "الإعدادات" item) starts `hidden` and is only revealed by render() when
 *   `HossamSession.getCurrentUser()` is non-null — i.e. for an office that
 *   has never created an RBAC user (the common case, see LoginScreen.js's
 *   own "WHEN THIS SCREEN APPEARS" header) this file is a permanent no-op
 *   and the sidebar looks exactly as it did before.
 *
 * 100% additive: defines exactly one new global, window.HossamSidebarSessionBadge.
 * Does not modify UsersAdminPanel.js's or TopbarSessionBadge.js's own logout
 * controls — those still work unchanged; this is a third, more reachable
 * entry point to the exact same `HossamSession.clear()` action.
 * ============================================================================
 */
(function (window, document) {
  'use strict';

  function render() {
    var btn = document.getElementById('sidebarLogoutBtn');
    if (!btn) return;

    var user = window.HossamSession ? window.HossamSession.getCurrentUser() : null;
    if (!user) {
      btn.style.display = 'none';
      return;
    }

    btn.style.display = '';

    // Rebind fresh each render() call (cheap; avoids duplicate listeners
    // accumulating across repeated logins in the same tab).
    var clone = btn.cloneNode(true);
    btn.parentNode.replaceChild(clone, btn);
    clone.addEventListener('click', function () {
      if (window.HossamSession) window.HossamSession.clear();
      render();
      if (window.HossamTopbarSessionBadge) window.HossamTopbarSessionBadge.render();
      if (window.LoginScreen) LoginScreen.init(function () {
        render();
        if (window.HossamTopbarSessionBadge) window.HossamTopbarSessionBadge.render();
      });
    });
  }

  window.HossamSidebarSessionBadge = { render: render };
})(typeof window !== 'undefined' ? window : this, typeof document !== 'undefined' ? document : undefined);
