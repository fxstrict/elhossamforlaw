/**
 * ================================================================
 * SessionContext.js — Current User Session | نظام الحسام للمحاماة
 * ================================================================
 * PHASE 31 — SUB-PHASE 31.1 — Users, Roles & Permissions Core (RBAC)
 *
 * WHAT THIS FILE IS
 *   Two small, related things:
 *   1. `window.HossamSession` — holds WHO is currently using the app
 *      (a single in-memory user record), set by whatever future login
 *      screen authenticates a user. Nothing in this phase calls
 *      `setCurrentUser()` automatically — see docs/phase31 report,
 *      "Deferred: Login Screen". Until something does, `getCurrentUser()`
 *      returns null and the whole RBAC layer stays fully inert.
 *   2. `window.HossamPermissionGuard` — the ONE object
 *      `js/core/Repository.js`'s new `_guardPermission()` hook looks for
 *      (mirrors the exact convention PHASE 30 already established for
 *      `window.LicenseReadOnlyGuard` — see Repository.js `_guardWritable`).
 *      `.check(entityKey, opName)` translates a generic Repository
 *      operation (e.g. entityKey:'cases', opName:'delete') into a
 *      concrete permission key (`CanDeleteCases`) via ENTITY_MODULE_MAP
 *      below, and asks PermissionService.can(). Absent a registered
 *      session, or an entityKey this map doesn't recognize, the check
 *      always allows — fail-open, zero regression for any repository
 *      this phase doesn't explicitly map, exactly like the license guard.
 *
 * WHAT THIS FILE IS NOT
 *   - Not authentication. It does not verify a password or issue a
 *     token — it only HOLDS whichever user record something else
 *     already authenticated, and enforces authorization (permissions)
 *     on top of that. Login screen and its "من مدخل كلمة المرور فعلاً
 *     صحيحة" verification is a separate, later phase (see report).
 *
 * Load order: additive file. Depends on PermissionService.js having
 * been loaded first. Loaded BEFORE js/core/Repository.js is exercised
 * (script order in index.html), so `_guardPermission()` finds
 * `window.HossamPermissionGuard` already defined by the time any
 * create()/update()/delete()/restore() call happens.
 *
 * PHASE — SESSION PERSISTENCE FIX
 *   Originally `currentUser` was ONLY an in-memory variable — nothing
 *   survived a page reload, so every refresh/PWA update forced a fresh
 *   login (reported bug). `setCurrentUser()` now also persists the
 *   username via `js/auth/SessionPersistence.js` (if loaded — optional
 *   dependency, fails open exactly like every other integration point
 *   in this file), and the new `restoreSession()` below re-hydrates
 *   `currentUser` from that persisted username on boot, re-validating
 *   against the live `UsersRepository` record first (an account
 *   suspended/deleted after login must not silently stay "logged in").
 *   `clear()` (logout) now also clears the persisted entry, so logging
 *   out and logging back in as a different user works across a reload
 *   too. See docs/PHASE_SESSION_PERSISTENCE.md for the full report.
 * ================================================================
 */

(function (root) {
  'use strict';

  var PermissionServiceNS = (typeof module !== 'undefined' && module.exports)
    ? require('./PermissionService.js') : root.HossamPermissionService;

  if (!PermissionServiceNS) {
    throw new Error('SessionContext.js requires js/core/rbac/PermissionService.js to be loaded first.');
  }

  /**
   * ENTITY_MODULE_MAP — Repository `entityKey` -> { create,update,delete,
   * restore -> permission key }. Only entities listed here are ever
   * subject to enforcement; any entityKey absent from this map is left
   * completely alone by `_guardPermission()` (fail-open by omission).
   * NOTE: `update` reuses the module's `edit` permission (Repository.js's
   * operation is literally named `update`, the brief's is `تعديل`/`edit`
   * — same action, different vocabulary layer).
   */
  var ENTITY_MODULE_MAP = Object.freeze({
    cases: Object.freeze({ create: 'CanCreateCases', update: 'CanEditCases', delete: 'CanDeleteCases', restore: 'CanRestoreCases' }),
    clients: Object.freeze({ create: 'CanCreateClients', update: 'CanEditClients', delete: 'CanDeleteClients', restore: 'CanRestoreClients' }),
    children: Object.freeze({ create: 'CanEditClients', update: 'CanEditClients', delete: 'CanDeleteClients', restore: 'CanRestoreClients' }),
    sessions: Object.freeze({ create: 'CanCreateSessions', update: 'CanEditSessions', delete: 'CanDeleteSessions', restore: 'CanEditSessions' }),
    documents: Object.freeze({ create: 'CanUploadDocuments', update: 'CanUploadDocuments', delete: 'CanDeleteDocuments', restore: 'CanUploadDocuments' }),
    fees: Object.freeze({ create: 'CanManageInvoices', update: 'CanManageInvoices', delete: 'CanManageInvoices', restore: 'CanManageInvoices' }),
    library: Object.freeze({ create: 'CanCreateLibraryItems', update: 'CanEditLibraryItems', delete: 'CanDeleteLibraryItems', restore: 'CanEditLibraryItems' }),
    tasks: Object.freeze({ create: 'CanEditCases', update: 'CanEditCases', delete: 'CanEditCases', restore: 'CanEditCases' }),
    templates: Object.freeze({ create: 'CanEditSettings', update: 'CanEditSettings', delete: 'CanEditSettings', restore: 'CanEditSettings' }),
    users: Object.freeze({ create: 'CanCreateUsers', update: 'CanEditUsers', delete: 'CanDeleteUsers', restore: 'CanEditUsers' })
  });

  var currentUser = null;
  // ACTIVITY RECORDER HOOK — real logout duration. `sessionStartedAt` is
  // purely a local timestamp (never persisted, never sent anywhere by
  // itself) marking when `currentUser` most recently went from null to
  // non-null, so `clear()` below can report a real "مدة الجلسة" to
  // js/core/rbac/ActivityRecorder.js. Guarded/optional exactly like
  // every other integration point in this file — if ActivityRecorder.js
  // hasn't loaded, this is a complete no-op with zero behavior change.
  var sessionStartedAt = null;

  /**
   * @param {Object|null} user
   * @param {{persist:boolean}} [opts] persist defaults to true — pass
   *   {persist:false} for the internal re-hydration path in
   *   restoreSession() below, which must not reset the sliding TTL that
   *   touch() already manages for that same read.
   */
  function setCurrentUser(user, opts) {
    var wasLoggedIn = !!currentUser;
    currentUser = user || null;
    if (currentUser && !wasLoggedIn) sessionStartedAt = Date.now();
    var persist = !opts || opts.persist !== false;
    if (persist && currentUser && root.HossamSessionPersistence) {
      var username = currentUser.اسم_المستخدم || currentUser.id || null;
      if (username) root.HossamSessionPersistence.save(username);
    }
  }
  function getCurrentUser() { return currentUser; }
  function clear() {
    // ACTIVITY RECORDER HOOK — the single canonical logout point every
    // logout button (sidebar/topbar/Users panel) already calls
    // HossamSession.clear() to reach. Recording it HERE, once, covers
    // all three entry points without touching any of them. Fails open:
    // any error here never blocks the actual logout below.
    try {
      if (currentUser && root.HossamActivity && typeof root.HossamActivity.recordLogout === 'function') {
        var username = currentUser.اسم_المستخدم || currentUser.id || null;
        var durationMs = sessionStartedAt ? (Date.now() - sessionStartedAt) : null;
        root.HossamActivity.recordLogout(username, durationMs);
      }
    } catch (e) { /* never block logout */ }
    sessionStartedAt = null;
    currentUser = null;
    if (root.HossamSessionPersistence) root.HossamSessionPersistence.clear();
  }

  /**
   * restoreSession() -> Promise<boolean>
   * Re-hydrates `currentUser` from a persisted, non-expired session
   * (see SessionPersistence.js) on boot, so a page reload does not force
   * a fresh login for a user who already authenticated. Always re-reads
   * the live UsersRepository record rather than trusting the persisted
   * snapshot — an account whose status changed to something other than
   * 'نشط' (or that was deleted) after login must NOT be silently
   * restored. Fails closed (returns false, clears the stale entry) on
   * any error or on any mismatch; fails open only in the sense that a
   * missing SessionPersistence/UsersRepository dependency is a no-op,
   * identical to how every other optional integration in this file
   * behaves — zero regression for a boot where those files aren't
   * loaded.
   */
  async function restoreSession() {
    if (currentUser) return true;
    if (!root.HossamSessionPersistence || !root.UsersRepository) return false;
    var entry = root.HossamSessionPersistence.read();
    if (!entry) return false;
    try {
      var repo = new root.UsersRepository();
      await repo.open();
      var user = repo.get(entry.username);
      if (!user || user.الحالة !== 'نشط') {
        root.HossamSessionPersistence.clear();
        return false;
      }
      setCurrentUser(user, { persist: false });
      root.HossamSessionPersistence.touch();
      return true;
    } catch (e) {
      // Storage/repository error while restoring must never leave the
      // app stuck: fail closed (no silent session) and let LoginScreen's
      // normal flow ask for credentials, same as a first-ever boot.
      return false;
    }
  }

  var HossamSession = {
    setCurrentUser: setCurrentUser,
    getCurrentUser: getCurrentUser,
    clear: clear,
    restoreSession: restoreSession
  };

  /**
   * check(entityKey, opName) -> {allowed:boolean, reason:?string}
   * The exact shape `_guardPermission()` in Repository.js expects.
   */
  function check(entityKey, opName) {
    if (!currentUser) return { allowed: true, reason: null }; // no session registered -> fail-open
    var moduleMap = ENTITY_MODULE_MAP[entityKey];
    if (!moduleMap) return { allowed: true, reason: null }; // unmapped entity -> fail-open
    var permissionKey = moduleMap[opName];
    if (!permissionKey) return { allowed: true, reason: null }; // unmapped operation -> fail-open
    var allowed = PermissionServiceNS.can(currentUser, permissionKey);
    return {
      allowed: allowed,
      reason: allowed ? null : ('المستخدم "' + (currentUser.اسم_المستخدم || currentUser.id || '؟') + '" لا يملك صلاحية "' + permissionKey + '".')
    };
  }

  var HossamPermissionGuard = { check: check, ENTITY_MODULE_MAP: ENTITY_MODULE_MAP };

  var api = { HossamSession: HossamSession, HossamPermissionGuard: HossamPermissionGuard };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  if (root) {
    root.HossamSession = HossamSession;
    root.HossamPermissionGuard = HossamPermissionGuard;
  }
})(typeof window !== 'undefined' ? window : (typeof global !== 'undefined' ? global : this));
