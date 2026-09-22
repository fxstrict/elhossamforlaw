'use strict';
/**
 * PHASE N.13.5 STEP 1 — SyncCoordinator Design D Test Matrix
 * ================================================================
 * Exercises the REAL, modified js/core/SyncCoordinator.js (Design D:
 * "Single-Flight Sync + Pending Notification") in a sandboxed VM
 * context — same pattern as PHASE_A7_5_sync_coordinator_tests.js and
 * PHASE_SYNC_FIX_01_tests.js (vm.createContext/runInContext over the
 * real source, never a re-implementation). STATIC/MOCK VERIFIED only —
 * no network, no IndexedDB, no browser, no real Apps Script.
 *
 * WHY A "GATE" INSTEAD OF A VIRTUAL CLOCK
 *   Design D's core behaviors ("notification arrives WHILE a sync is
 *   running", "pending survives across the follow-up cap") depend on
 *   ORDERING relative to an in-flight async call, not on wall-clock
 *   duration. Rather than modeling sync duration with fake timers, this
 *   suite gives SyncEngine.runIncrementalSyncAndPersist() a per-call
 *   "gate": the Nth call to it (opts.gateCalls) suspends on an
 *   externally-held Promise until the test explicitly calls
 *   env.releaseGate(N). This makes "notification arrives mid-sync"
 *   deterministic without any timing assumptions. TTL/cooldown tests
 *   (E1.1, E1.8) still use the existing fakeNow/advanceNow mechanism
 *   from PHASE_SYNC_FIX_01_tests.js's makeCoordinatorSandbox, reused
 *   verbatim in spirit here.
 *
 * SCOPE — this file tests ONLY js/core/SyncCoordinator.js. It does not
 * touch, mock as "fixed", or make any claim about FCM, the Service
 * Worker, NotificationManager, or SyncEngine.js's own internals — all
 * of those are simulated as black boxes exactly as SyncCoordinator.js
 * itself treats them (per that file's own header).
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..', '..');
const COORDINATOR_PATH = path.join(ROOT, 'js', 'core', 'SyncCoordinator.js');
const coordinatorSrc = fs.readFileSync(COORDINATOR_PATH, 'utf8');

let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log('PASS -', name); }
  else { fail++; console.log('FAIL -', name); }
}
async function checkAsync(name, fn) {
  try { check(name, await fn()); }
  catch (e) { fail++; console.log('FAIL -', name, ' threw:', e && e.stack || e); }
}

/**
 * Same shape/spirit as PHASE_SYNC_FIX_01_tests.js's makeCoordinatorSandbox,
 * extended with a per-call "gate" on runIncrementalSyncAndPersist() so
 * tests can deterministically pause a sync mid-flight.
 *
 * DETERMINISM NOTE: env.callStarted(idx) resolves the INSTANT call #idx
 * begins (synchronously, before it awaits its gate) — it is a signal, not
 * a poll. This suite deliberately avoids "await N ticks and hope" timing
 * loops, which proved flaky under heavy single-core CPU contention (this
 * sandbox reports `nproc` = 1) when the whole test suite runs in parallel:
 * a bounded tick-count wait is not a fixed amount of real progress under
 * contention, so it could occasionally read `calls.*` before the awaited
 * mock had actually run. callStarted() has no such window — it is
 * resolved by the mock itself, so a test can never observe a call that
 * has not truly started.
 */
function makeCoordinatorSandbox(opts) {
  opts = opts || {};
  let fakeNow = (typeof opts.startNow === 'number') ? opts.startNow : 1700000000000;
  const delaysRecorded = [];
  const calls = { replay: 0, loadFromSheets: 0, runIncrementalAndPersist: 0, bootIncremental: 0 };
  const gates = {}; // call index (1-based) -> { resolve }
  const startedResolvers = {}; // call index -> resolve fn
  const startedPromises = {}; // call index -> Promise, created lazily/eagerly on first reference

  function callStarted(idx) {
    if (!startedPromises[idx]) {
      startedPromises[idx] = new Promise(function (resolve) { startedResolvers[idx] = resolve; });
    }
    return startedPromises[idx];
  }

  const sandbox = { console: console, Object: Object, Array: Array, Promise: Promise, String: String };
  sandbox.window = sandbox;
  sandbox.navigator = { onLine: (opts.onLine !== undefined) ? opts.onLine : true };
  sandbox.Date = { now: function () { return fakeNow; } };
  sandbox.setTimeout = function (fn, ms) { delaysRecorded.push(ms); return global.setTimeout(fn, 0); };

  const checkpoints = opts.checkpoints || { SHEET_A: 'C1' }; // default: subsequent-sync branch
  sandbox.SyncCheckpoint = {
    get: function (sheetName) {
      return Object.prototype.hasOwnProperty.call(checkpoints, sheetName) ? checkpoints[sheetName] : null;
    }
  };

  const pairs = opts.pairs || [['SHEET_A', 'a']];
  sandbox.SyncEngine = {
    SYNC_ENTITY_PAIRS: pairs,
    runIncrementalSyncAndPersist: async function () {
      calls.runIncrementalAndPersist++;
      var idx = calls.runIncrementalAndPersist;
      // Signal "call #idx has started" BEFORE awaiting anything, so a test
      // that is already `await`-ing callStarted(idx) is released at the
      // exact instant this call began — not some number of ticks later.
      if (startedResolvers[idx]) startedResolvers[idx]();
      else callStarted(idx), startedResolvers[idx]();
      if (opts.gateCalls && opts.gateCalls.indexOf(idx) !== -1) {
        await new Promise(function (resolve) { gates[idx] = { resolve: resolve }; });
      }
      if (opts.resultForCall) return opts.resultForCall(idx);
      return { status: 'success', results: [], succeeded: pairs.length, failed: 0 };
    },
    bootIncrementalSync: async function () { calls.bootIncremental++; return undefined; }
  };

  sandbox.loadFromSheets = async function () {
    calls.loadFromSheets++;
    return { status: 'success', loaded: 0, failed: 0, total: 0 };
  };

  sandbox.OfflineQueue = { replay: async function () { calls.replay++; return undefined; } };

  vm.createContext(sandbox);
  vm.runInContext(coordinatorSrc, sandbox, { filename: COORDINATOR_PATH });

  return {
    sandbox: sandbox, calls: calls, delaysRecorded: delaysRecorded,
    setNow: function (t) { fakeNow = t; },
    advanceNow: function (d) { fakeNow += d; },
    callStarted: callStarted,
    releaseGate: function (idx) {
      if (gates[idx]) { gates[idx].resolve(); delete gates[idx]; }
    }
  };
}

// ========================================================================
// E1.1 — recent successful sync must NOT block a notification
// ========================================================================
async function testE1_1() {
  const env = makeCoordinatorSandbox({});
  const r1 = await env.sandbox.SyncCoordinator.requestSync('resume');
  if (!(r1.success === true && env.calls.runIncrementalAndPersist === 1)) return false;
  env.advanceNow(60 * 1000); // 1 minute later — well inside the 5-minute TTL
  const before = env.calls.runIncrementalAndPersist;
  const r2 = await env.sandbox.SyncCoordinator.requestSync('notification');
  return r2.skipped !== true && r2.success === true && env.calls.runIncrementalAndPersist === before + 1;
}

// ========================================================================
// E1.2 — notification arriving WHILE a sync runs: no concurrent sync,
// same Promise returned, pending consumed as a follow-up afterward.
// ========================================================================
async function testE1_2() {
  const env = makeCoordinatorSandbox({ gateCalls: [1] });
  const p1 = env.sandbox.SyncCoordinator.requestSync('resume'); // call #1 will suspend on the gate
  await env.callStarted(1);

  const p2 = env.sandbox.SyncCoordinator.requestSync('notification');
  const samePromise = (p1 === p2);
  const noConcurrentSync = (env.calls.runIncrementalAndPersist === 1); // still just call #1, gated

  env.releaseGate(1);
  const result = await p1; // resolves after the follow-up (call #2) also completes

  return samePromise && noConcurrentSync && env.calls.runIncrementalAndPersist === 2 && result.reason === 'notification';
}

// ========================================================================
// E1.3 — TWO notifications during one sync => exactly ONE follow-up,
// never two additional concurrent/sequential syncs.
// ========================================================================
async function testE1_3() {
  const env = makeCoordinatorSandbox({ gateCalls: [1] });
  const p1 = env.sandbox.SyncCoordinator.requestSync('resume');
  await env.callStarted(1);

  env.sandbox.SyncCoordinator.requestSync('notification');
  env.sandbox.SyncCoordinator.requestSync('notification');
  const duringSync = env.calls.runIncrementalAndPersist; // must still be 1

  env.releaseGate(1);
  await p1;

  // initial (call #1) + exactly one follow-up (call #2) — NOT three calls.
  return duringSync === 1 && env.calls.runIncrementalAndPersist === 2;
}

// ========================================================================
// E1.4 — a FAILED notification-triggered sync must not block the NEXT
// notification via the 10-second cooldown.
// ========================================================================
async function testE1_4() {
  const env = makeCoordinatorSandbox({
    resultForCall: function () { return { status: 'failed', results: [], succeeded: 0, failed: 2 }; }
  });
  const r1 = await env.sandbox.SyncCoordinator.requestSync('notification');
  const callsAfterFirst = env.calls.runIncrementalAndPersist; // 4 (1 initial + 3 retries, all 'failed')
  if (r1.status !== 'failed') return false;

  env.advanceNow(2000); // well within the normal 10s cooldown
  const r2 = await env.sandbox.SyncCoordinator.requestSync('notification');

  return r2.skipped !== true && env.calls.runIncrementalAndPersist > callsAfterFirst;
}

// ========================================================================
// E1.5 — repeated notification arrivals across an in-flight sync AND its
// follow-ups are bounded at initial + MAX_FOLLOW_UP_SYNCS(2) = 3 total
// sync executions, never more, however many notifications arrive.
// ========================================================================
async function testE1_5() {
  const env = makeCoordinatorSandbox({ gateCalls: [1, 2] });
  const p1 = env.sandbox.SyncCoordinator.requestSync('notification'); // call #1 (initial), gated
  await env.callStarted(1);
  for (let i = 0; i < 5; i++) env.sandbox.SyncCoordinator.requestSync('notification'); // all join p1

  env.releaseGate(1); // call #1 done -> follow-up #1 = call #2 starts, also gated
  await env.callStarted(2);
  for (let i = 0; i < 5; i++) env.sandbox.SyncCoordinator.requestSync('notification'); // arrive during follow-up #1

  env.releaseGate(2); // call #2 done -> follow-up #2 = call #3 starts, ungated -> resolves immediately
  const result = await p1;

  // Nothing arrived during call #3, so pending should be consumed and false afterward.
  const finalState = env.sandbox.SyncCoordinator.getState();
  return env.calls.runIncrementalAndPersist === 3 && result.success === true && finalState.hasPendingNotification === false;
}

// ========================================================================
// E1.6 — a notification that arrives while OFFLINE must not be lost:
// pending survives, and 'online' consumes it and actually runs a sync.
// ========================================================================
async function testE1_6() {
  const env = makeCoordinatorSandbox({ onLine: false });
  const r1 = await env.sandbox.SyncCoordinator.requestSync('notification');
  const pendingWhileOffline = env.sandbox.SyncCoordinator.getState().hasPendingNotification;
  const callsWhileOffline = env.calls.runIncrementalAndPersist;

  env.sandbox.navigator.onLine = true;
  const r2 = await env.sandbox.SyncCoordinator.requestSync('online');

  return r1.status === 'offline' && pendingWhileOffline === true && callsWhileOffline === 0 &&
    r2.skipped !== true && env.calls.runIncrementalAndPersist === 1;
}

// ========================================================================
// E1.7 — pending that survives hitting the follow-up cap must still be
// consumable by a LATER, unrelated trigger (e.g. 'resume') — never lost.
// ========================================================================
async function testE1_7() {
  const env = makeCoordinatorSandbox({ gateCalls: [1, 2, 3] });

  const p1 = env.sandbox.SyncCoordinator.requestSync('notification'); // call #1 (initial)
  await env.callStarted(1);
  env.sandbox.SyncCoordinator.requestSync('notification'); // -> pending for follow-up #1

  env.releaseGate(1); // call #1 done -> follow-up #1 = call #2 starts
  await env.callStarted(2);
  env.sandbox.SyncCoordinator.requestSync('notification'); // -> pending for follow-up #2

  env.releaseGate(2); // call #2 done -> follow-up #2 = call #3 starts
  await env.callStarted(3);
  env.sandbox.SyncCoordinator.requestSync('notification'); // arrives DURING the LAST allowed follow-up

  env.releaseGate(3); // call #3 done -> cap reached (followUps=2) -> loop exits, pending LEFT true
  await p1;

  const leftPending = env.sandbox.SyncCoordinator.getState().hasPendingNotification;
  if (leftPending !== true) return false;
  if (env.calls.runIncrementalAndPersist !== 3) return false;

  // A later, unrelated trigger must still consume it and run a real sync.
  const r = await env.sandbox.SyncCoordinator.requestSync('resume');
  const consumedAfter = env.sandbox.SyncCoordinator.getState().hasPendingNotification;

  return r.skipped !== true && env.calls.runIncrementalAndPersist === 4 && consumedAfter === false;
}

// ========================================================================
// E1.8 — with NO pending notification, existing boot/online/resume TTL
// behavior is entirely unaffected (regression guard for Design D itself).
// ========================================================================
async function testE1_8() {
  const env = makeCoordinatorSandbox({});
  await env.sandbox.SyncCoordinator.requestSync('resume');
  env.advanceNow(60 * 1000);
  const before = env.calls.runIncrementalAndPersist;
  const r = await env.sandbox.SyncCoordinator.requestSync('resume'); // no pending notification exists
  return r.skipped === true && env.calls.runIncrementalAndPersist === before;
}

// ========================================================================
// Static source checks — confirm the allowlisted change surface only.
// ========================================================================
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}
function staticChecks() {
  const codeOnly = stripComments(coordinatorSrc);
  check('SyncCoordinator.js: MAX_FOLLOW_UP_SYNCS constant defined (bounded loop, per N.13.4 §15)',
    /MAX_FOLLOW_UP_SYNCS\s*=\s*2/.test(codeOnly));
  check('SyncCoordinator.js: _pendingNotification is in-memory only (no localStorage/IndexedDB/persistence call)',
    !/_pendingNotification[\s\S]{0,80}(localStorage|indexedDB|IDB)/i.test(codeOnly));
  check('SyncCoordinator.js: no unbounded "while (pending)" loop — the follow-up loop is bounded by MAX_FOLLOW_UP_SYNCS',
    /while\s*\(\s*_pendingNotification\s*&&\s*followUps\s*<\s*MAX_FOLLOW_UP_SYNCS\s*\)/.test(codeOnly));
  check('SyncCoordinator.js: manual reason bypass is unchanged (still present verbatim)',
    /reason === 'manual' \|\| _pendingNotification/.test(codeOnly));
  check('SyncCoordinator.js: still no setInterval anywhere (no polling introduced by Design D)',
    !/setInterval/.test(codeOnly));
  check('SyncCoordinator.js: still no new global object / event bus introduced (single IIFE, single export)',
    (codeOnly.match(/if \(typeof window !== 'undefined'\)/g) || []).length === 1);
}

(async function main() {
  console.log('=== PHASE N.13.5 STEP 1 — SyncCoordinator Design D Test Matrix ===');
  console.log('NOTE: STATIC/MOCK VERIFIED only — SyncEngine/OfflineQueue/SyncCheckpoint are simulated black boxes,');
  console.log('no network, no IndexedDB, no browser. This file does NOT test or claim FCM/Service Worker behavior.');

  await checkAsync('E1.1 — recent successful sync does not block a notification (TTL bypass)', testE1_1);
  await checkAsync('E1.2 — notification during active sync: no concurrent sync, same Promise, follow-up runs after', testE1_2);
  await checkAsync('E1.3 — two notifications during one sync collapse into exactly one follow-up', testE1_3);
  await checkAsync('E1.4 — a failed notification sync does not cooldown-block the next notification', testE1_4);
  await checkAsync('E1.5 — repeated notifications are bounded at initial + 2 follow-ups (max 3 executions)', testE1_5);
  await checkAsync('E1.6 — notification while offline survives; online consumes it and syncs', testE1_6);
  await checkAsync('E1.7 — pending left true after hitting the follow-up cap is consumed by a later trigger', testE1_7);
  await checkAsync('E1.8 — with no pending notification, existing TTL behavior for other reasons is unchanged', testE1_8);

  staticChecks();

  console.log('\n=== RESULT:', pass, 'PASS /', fail, 'FAIL ===');
  process.exit(fail === 0 ? 0 : 1);
})();
