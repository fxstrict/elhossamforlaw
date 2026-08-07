/**
 * verify_session_persistence.js
 * ================================================================
 * SESSION PERSISTENCE FIX — verification harness
 * ================================================================
 * Covers the two pure, non-DOM pieces of the fix:
 *   1. SessionPersistence.js — the localStorage envelope itself
 *      (save/read/touch/clear, TTL expiry, corrupt-entry handling).
 *   2. SessionContext.js's restoreSession() — re-hydration on boot,
 *      including the "account no longer نشط" and "account deleted"
 *      fail-closed paths, using a minimal in-memory UsersRepository
 *      stub (no DOM, no IndexedDB — same style as verify_auth_core.js).
 * ================================================================
 */

'use strict';

const assert = require('assert');
const path = require('path');

// --- Minimal in-memory localStorage stub, installed on the global object
// SessionPersistence.js's IIFE receives (Node has no window) so its
// internal `window.localStorage` calls resolve against this. ---
function makeFakeLocalStorage() {
  const store = new Map();
  return {
    getItem(k) { return store.has(k) ? store.get(k) : null; },
    setItem(k, v) { store.set(k, String(v)); },
    removeItem(k) { store.delete(k); }
  };
}
global.localStorage = makeFakeLocalStorage();

const AUTH_DIR = path.join(__dirname, '..', 'auth');
const RBAC_DIR = path.join(__dirname, '..', 'core', 'rbac');
const SessionPersistence = require(path.join(AUTH_DIR, 'SessionPersistence.js'));

let passed = 0;
let failed = 0;
const failures = [];

async function check(label, fn) {
  try {
    await fn();
    passed++;
    console.log('  \u2713 ' + label);
  } catch (err) {
    failed++;
    failures.push({ label, error: err });
    console.log('  \u2717 ' + label + ' -> ' + (err && err.stack ? err.stack : err));
  }
}

async function main() {
  console.log('\n=== SessionPersistence.js ===');

  await check('read() is null with nothing saved yet', () => {
    global.localStorage = makeFakeLocalStorage();
    assert.strictEqual(SessionPersistence.read(), null);
  });

  await check('save() then read() round-trips the username', () => {
    global.localStorage = makeFakeLocalStorage();
    SessionPersistence.save('ahmed');
    const entry = SessionPersistence.read();
    assert.ok(entry);
    assert.strictEqual(entry.username, 'ahmed');
    assert.ok(entry.expiresAt > Date.now());
  });

  await check('read() self-clears and returns null for an expired entry', () => {
    global.localStorage = makeFakeLocalStorage();
    global.localStorage.setItem('hsm_auth_session_v1', JSON.stringify({
      username: 'ahmed', loginAt: Date.now() - 100000, expiresAt: Date.now() - 1
    }));
    assert.strictEqual(SessionPersistence.read(), null);
    assert.strictEqual(global.localStorage.getItem('hsm_auth_session_v1'), null);
  });

  await check('read() returns null for a corrupt (non-JSON) entry', () => {
    global.localStorage = makeFakeLocalStorage();
    global.localStorage.setItem('hsm_auth_session_v1', 'not-json{{{');
    assert.strictEqual(SessionPersistence.read(), null);
  });

  await check('touch() slides expiresAt forward for an existing entry', () => {
    global.localStorage = makeFakeLocalStorage();
    SessionPersistence.save('ahmed');
    const before = SessionPersistence.read().expiresAt;
    // Force the stored expiresAt artificially close, then touch() should push it back out.
    const raw = JSON.parse(global.localStorage.getItem('hsm_auth_session_v1'));
    raw.expiresAt = Date.now() + 1000;
    global.localStorage.setItem('hsm_auth_session_v1', JSON.stringify(raw));
    SessionPersistence.touch();
    const after = SessionPersistence.read().expiresAt;
    assert.ok(after > Date.now() + 1000, 'touch() should extend expiresAt well past the near-term value');
    void before;
  });

  await check('touch() on an already-expired entry clears it and returns false', () => {
    global.localStorage = makeFakeLocalStorage();
    global.localStorage.setItem('hsm_auth_session_v1', JSON.stringify({
      username: 'ahmed', loginAt: Date.now() - 100000, expiresAt: Date.now() - 1
    }));
    assert.strictEqual(SessionPersistence.touch(), false);
    assert.strictEqual(global.localStorage.getItem('hsm_auth_session_v1'), null);
  });

  await check('clear() removes the entry', () => {
    global.localStorage = makeFakeLocalStorage();
    SessionPersistence.save('ahmed');
    SessionPersistence.clear();
    assert.strictEqual(SessionPersistence.read(), null);
  });

  console.log('\n=== SessionContext.js restoreSession() ===');

  // A fresh global.window-like context per test: SessionContext.js is a
  // require()'d CommonJS module cached by Node, but its internal
  // `currentUser` closure variable is per-require — since we need a
  // *fresh* module instance per scenario (no leftover currentUser from a
  // previous check), we bust Node's require cache between scenarios.
  function freshSessionContext() {
    const p = path.join(RBAC_DIR, 'SessionContext.js');
    delete require.cache[require.resolve(p)];
    delete require.cache[require.resolve(path.join(RBAC_DIR, 'PermissionService.js'))];
    return require(p).HossamSession;
  }

  function stubUsersRepository(usersByUsername) {
    global.UsersRepository = function UsersRepositoryStub() {};
    global.UsersRepository.prototype.open = async function () {};
    global.UsersRepository.prototype.get = function (username) {
      return usersByUsername[username] || null;
    };
  }

  await check('restoreSession() restores an active user from a valid persisted entry', async () => {
    global.localStorage = makeFakeLocalStorage();
    global.HossamSessionPersistence = SessionPersistence;
    stubUsersRepository({ ahmed: { اسم_المستخدم: 'ahmed', الاسم: 'أحمد', الحالة: 'نشط' } });
    SessionPersistence.save('ahmed');
    const Session = freshSessionContext();
    const ok = await Session.restoreSession();
    assert.strictEqual(ok, true);
    assert.ok(Session.getCurrentUser());
    assert.strictEqual(Session.getCurrentUser().اسم_المستخدم, 'ahmed');
  });

  await check('restoreSession() fails closed when the account is no longer نشط', async () => {
    global.localStorage = makeFakeLocalStorage();
    global.HossamSessionPersistence = SessionPersistence;
    stubUsersRepository({ ahmed: { اسم_المستخدم: 'ahmed', الاسم: 'أحمد', الحالة: 'موقوف' } });
    SessionPersistence.save('ahmed');
    const Session = freshSessionContext();
    const ok = await Session.restoreSession();
    assert.strictEqual(ok, false);
    assert.strictEqual(Session.getCurrentUser(), null);
    // and the stale persisted entry must have been cleared
    assert.strictEqual(SessionPersistence.read(), null);
  });

  await check('restoreSession() fails closed when the account was deleted', async () => {
    global.localStorage = makeFakeLocalStorage();
    global.HossamSessionPersistence = SessionPersistence;
    stubUsersRepository({}); // ahmed no longer exists
    SessionPersistence.save('ahmed');
    const Session = freshSessionContext();
    const ok = await Session.restoreSession();
    assert.strictEqual(ok, false);
    assert.strictEqual(Session.getCurrentUser(), null);
  });

  await check('restoreSession() is a no-op (false) with no persisted entry at all', async () => {
    global.localStorage = makeFakeLocalStorage();
    global.HossamSessionPersistence = SessionPersistence;
    stubUsersRepository({ ahmed: { اسم_المستخدم: 'ahmed', الحالة: 'نشط' } });
    const Session = freshSessionContext();
    const ok = await Session.restoreSession();
    assert.strictEqual(ok, false);
    assert.strictEqual(Session.getCurrentUser(), null);
  });

  await check('clear() (logout) also clears the persisted entry', async () => {
    global.localStorage = makeFakeLocalStorage();
    global.HossamSessionPersistence = SessionPersistence;
    stubUsersRepository({ ahmed: { اسم_المستخدم: 'ahmed', الحالة: 'نشط' } });
    const Session = freshSessionContext();
    Session.setCurrentUser({ اسم_المستخدم: 'ahmed', الحالة: 'نشط' });
    assert.ok(SessionPersistence.read(), 'setCurrentUser() should have persisted the session');
    Session.clear();
    assert.strictEqual(SessionPersistence.read(), null);
    assert.strictEqual(Session.getCurrentUser(), null);
  });

  console.log(`\n${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exitCode = 1;
}

main();
