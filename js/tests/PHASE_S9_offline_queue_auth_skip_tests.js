/**
 * PHASE_S9_offline_queue_auth_skip_tests.js — نظام الحسام للمحاماة
 * ================================================================
 * Targeted regression for the ONE behavior PHASE S.9 changed in
 * js/core/OfflineQueue.js: replay() now drops an isAuthError item
 * instead of blocking the rest of the queue behind it, matching the
 * pre-existing saveData()/updateData()/deleteData()/restoreRow()
 * convention (js/api/api.js) for the same signal on a first attempt.
 *
 * Confirms:
 *  1. An isAuthError item is removed from the queue (not left stuck).
 *  2. ApiService._notifyMissingCredential() is called with the right
 *     authCode.
 *  3. Every OTHER queued item — before and after the bad one — is
 *     still replayed normally, in order (the actual bug being fixed:
 *     one bad item no longer blocks unrelated valid items).
 *  4. A NON-auth failure (plain network/application error) still
 *     stops the loop exactly as before — no change to that path,
 *     proving this fix did not weaken the existing conservative
 *     default for error types with no reliable permanent/transient
 *     classification.
 * ================================================================
 */
'use strict';

const assert = require('assert');
const path = require('path');

function makeFakeLocalStorage() {
  const store = {};
  return {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
    _dump: () => Object.assign({}, store)
  };
}

global.localStorage = makeFakeLocalStorage();
Object.defineProperty(global, 'navigator', { value: { onLine: true }, configurable: true, writable: true });
global.window = { addEventListener: () => {} };

let passed = 0, failed = 0;
async function check(label, fn) {
  try { await fn(); passed++; console.log('PASS — ' + label); }
  catch (e) { failed++; console.log('FAIL — ' + label + '  =>  ' + e.message); }
}

async function main() {
  const postedCalls = [];
  const notifyCalls = [];
  // sheet name -> behavior for this run
  let behavior = {};
  global.ApiService = {
    _post: async function (body) {
      const mode = behavior[body.sheet] || 'ok';
      if (mode === 'auth') {
        const err = new Error('[ApiService] فشل تطبيقي من الخادم: AUTH_FAILED');
        err.isAuthError = true;
        err.authCode = 'CREDENTIAL_REVOKED';
        throw err;
      }
      if (mode === 'network') {
        throw new Error('simulated network failure');
      }
      postedCalls.push(body);
      return { ok: true };
    },
    _notifyMissingCredential: function (authCode) { notifyCalls.push(authCode); }
  };

  delete require.cache[require.resolve(path.join(__dirname, '..', 'core', 'OfflineQueue.js'))];
  const { OfflineQueue } = require(path.join(__dirname, '..', 'core', 'OfflineQueue.js'));

  await check('replay(): isAuthError item is DROPPED (removed from queue), not left stuck', async () => {
    localStorage.setItem('__ahp_offline_write_queue__', '[]');
    postedCalls.length = 0; notifyCalls.length = 0;
    behavior = { 'الأتعاب': 'auth' };

    OfflineQueue.enqueue({ action: 'add', sheet: 'الأتعاب', data: { id: 'F1' } });
    await OfflineQueue.replay();

    assert.strictEqual(OfflineQueue.size(), 0, 'the auth-failing item must be removed from the queue, not left stuck');
    assert.strictEqual(notifyCalls.length, 1);
    assert.strictEqual(notifyCalls[0], 'CREDENTIAL_REVOKED');
  });

  await check('replay(): CONFIRMED FIX — an isAuthError item no longer blocks unrelated valid items queued after it', async () => {
    localStorage.setItem('__ahp_offline_write_queue__', '[]');
    postedCalls.length = 0; notifyCalls.length = 0;
    behavior = { 'الأتعاب': 'auth', 'المصروفات': 'ok', 'قضية_موكلين': 'ok' };

    OfflineQueue.enqueue({ action: 'add', sheet: 'الأتعاب', data: { id: 'F1' } });      // will auth-fail
    OfflineQueue.enqueue({ action: 'add', sheet: 'المصروفات', data: { id: 'E1' } });    // valid, queued AFTER the bad one
    OfflineQueue.enqueue({ action: 'add', sheet: 'قضية_موكلين', data: { id: 'CC1' } }); // valid, queued AFTER the bad one

    await OfflineQueue.replay();

    assert.strictEqual(OfflineQueue.size(), 0, 'both valid items behind the bad one must have been replayed and removed too — the actual bug being fixed');
    assert.strictEqual(postedCalls.length, 2);
    assert.strictEqual(postedCalls[0].sheet, 'المصروفات');
    assert.strictEqual(postedCalls[1].sheet, 'قضية_موكلين');
  });

  await check('replay(): a non-auth (network) failure still STOPS the loop unchanged — no weakening of the existing conservative default', async () => {
    localStorage.setItem('__ahp_offline_write_queue__', '[]');
    postedCalls.length = 0; notifyCalls.length = 0;
    behavior = { 'الأتعاب': 'network', 'المصروفات': 'ok' };

    OfflineQueue.enqueue({ action: 'add', sheet: 'الأتعاب', data: { id: 'F1' } });
    OfflineQueue.enqueue({ action: 'add', sheet: 'المصروفات', data: { id: 'E1' } });

    await OfflineQueue.replay();

    assert.strictEqual(OfflineQueue.size(), 2, 'a network failure must still leave BOTH items queued (the failing one and everything behind it) — unchanged behavior');
    assert.strictEqual(postedCalls.length, 0);
    assert.strictEqual(notifyCalls.length, 0);

    // Recovery: once the network issue clears, a later replay() must
    // still succeed normally — proves nothing was corrupted/lost while
    // stuck.
    behavior = { 'الأتعاب': 'ok', 'المصروفات': 'ok' };
    await OfflineQueue.replay();
    assert.strictEqual(OfflineQueue.size(), 0);
    assert.strictEqual(postedCalls.length, 2);
  });

  console.log('\n' + passed + '/' + (passed + failed) + ' checks passed.');
  if (failed > 0) { console.log('\n' + failed + ' CHECK(S) FAILED.'); process.exit(1); }
  console.log('\nALL CHECKS PASSED.');
}

main().catch((e) => { console.error(e); process.exit(1); });
