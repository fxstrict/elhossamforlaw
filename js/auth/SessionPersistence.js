/**
 * ============================================================================
 * SessionPersistence.js — Local Session Persistence | نظام الحسام للمحاماة
 * ----------------------------------------------------------------------------
 * PROBLEM THIS FILE FIXES
 *   `js/core/rbac/SessionContext.js` (Phase 31) holds `currentUser` in a
 *   plain in-memory JS variable — nothing ever wrote it to storage. Every
 *   full page reload (browser refresh, PWA/service-worker update, reopening
 *   the tab) re-runs index.html from zero, so `currentUser` resets to null
 *   and `js/auth/LoginScreen.js` shows the login overlay again, even for
 *   the SAME user who logged in seconds earlier. That is the exact bug
 *   reported: "every refresh asks for username/password again".
 *
 * WHAT THIS FILE DOES
 *   A small, self-contained persistence envelope for "who is currently
 *   logged in on this device", stored in `localStorage` (same mechanism
 *   already used everywhere else in this project for local device state —
 *   `apiUrl`, `driveUrl`, etc. — see index.html). It never stores a
 *   password or password hash — only the username and two timestamps.
 *
 *   save(username)   — writes {username, loginAt, expiresAt}, expiresAt =
 *                       now + SESSION_TTL_MS (sliding window, see touch()).
 *   read()            — returns {username, loginAt, expiresAt} if present
 *                       AND not expired, otherwise null (and self-clears
 *                       an expired/corrupt entry so it never lingers).
 *   touch()            — slides expiresAt forward from "now", called every
 *                       time a boot successfully restores a session, so an
 *                       office actively using the app stays logged in
 *                       (modern "stay signed in" behavior) while a device
 *                       left untouched for SESSION_TTL_MS is required to
 *                       log in again (still a real, if soft, security
 *                       boundary — see docs/PHASE_SESSION_PERSISTENCE.md).
 *   clear()            — removes the entry (logout).
 *
 * WHAT THIS FILE IS NOT
 *   - Not authentication. It never verifies a password — that remains
 *     exclusively `js/auth/LoginScreen.js` + `js/auth/PasswordHasher.js`.
 *   - Not a security token. This app has no server session to mirror
 *     (Google Apps Script backend is a sync target, not a session
 *     authority — see docs/PHASE_SESSION_PERSISTENCE.md) and
 *     `UsersRepository` itself already lives in local IndexedDB, so
 *     persisting "which local username is active" locally introduces no
 *     new trust boundary versus what already exists.
 *   - Does not decide whether a session is still VALID against the current
 *     user record (account could have been suspended/deleted after
 *     login) — that check belongs to whoever consumes read(), see
 *     `js/core/rbac/SessionContext.js`'s `restoreSession()`.
 *
 * 100% additive: defines exactly one new global, window.HossamSessionPersistence.
 * No existing file is required to load this one — every function above
 * degrades to a safe no-op if `localStorage` is unavailable (private
 * browsing edge cases, etc.).
 * ============================================================================
 */
(function (window) {
  'use strict';

  var STORAGE_KEY = 'hsm_auth_session_v1';

  // Sliding idle-timeout window: 12 hours of inactivity (no successful
  // boot restore) before the device is required to log in again. Refreshed
  // on every successful restore via touch() — an office working all day
  // never sees the login screen again after the first login; a machine
  // left untouched overnight/over a weekend does, by design.
  var SESSION_TTL_MS = 12 * 60 * 60 * 1000;

  function _storageAvailable() {
    try {
      return typeof window !== 'undefined' && !!window.localStorage;
    } catch (e) {
      return false;
    }
  }

  function _readRaw() {
    if (!_storageAvailable()) return null;
    var raw;
    try {
      raw = window.localStorage.getItem(STORAGE_KEY);
    } catch (e) {
      return null;
    }
    if (!raw) return null;
    try {
      var parsed = JSON.parse(raw);
      if (!parsed || typeof parsed.username !== 'string' || !parsed.username) return null;
      if (typeof parsed.expiresAt !== 'number') return null;
      return parsed;
    } catch (e) {
      return null; // corrupt entry — treated as "no session"
    }
  }

  function _writeRaw(entry) {
    if (!_storageAvailable()) return false;
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(entry));
      return true;
    } catch (e) {
      return false;
    }
  }

  function clear() {
    if (!_storageAvailable()) return;
    try { window.localStorage.removeItem(STORAGE_KEY); } catch (e) { /* ignore */ }
  }

  function save(username) {
    if (!username) return false;
    var now = Date.now();
    return _writeRaw({ username: username, loginAt: now, expiresAt: now + SESSION_TTL_MS });
  }

  /** Returns {username, loginAt, expiresAt} or null. Self-clears if expired/corrupt. */
  function read() {
    var entry = _readRaw();
    if (!entry) return null;
    if (Date.now() >= entry.expiresAt) {
      clear();
      return null;
    }
    return entry;
  }

  /** Slides expiresAt forward from now, for whichever username is currently persisted. */
  function touch() {
    var entry = _readRaw();
    if (!entry) return false;
    if (Date.now() >= entry.expiresAt) { clear(); return false; }
    entry.expiresAt = Date.now() + SESSION_TTL_MS;
    return _writeRaw(entry);
  }

  var api = {
    save: save,
    read: read,
    touch: touch,
    clear: clear,
    SESSION_TTL_MS: SESSION_TTL_MS
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  if (window) {
    window.HossamSessionPersistence = api;
  }
})(typeof window !== 'undefined' ? window : (typeof global !== 'undefined' ? global : this));
