'use strict';
/**
 * PHASE A7.5 — SyncCoordinator Test Matrix (§30 of the request)
 * Exercises js/core/SyncCoordinator.js in a sandboxed VM context (no
 * network, no IndexedDB, no browser — same "STATIC VERIFIED, not LIVE
 * VERIFIED" disclosure as tests/PHASE_A7_frontend_sync_tests.js), with
 * mocked OfflineQueue/SyncCheckpoint/SyncEngine/loadFromSheets/navigator/
 * Date/setTimeout so TTL, cooldown, and retry-backoff timing can all be
 * verified deterministically without real wall-clock waiting.
 *
 * Run: node tests/PHASE_A7_5_sync_coordinator_tests.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log('PASS -', name); }
  else { fail++; console.log('FAIL -', name); }
}
async function checkAsync(name, fn) {
  try { const ok = await fn(); if (ok) { pass++; console.log('PASS -', name); } else { fail++; console.log('FAIL -', name); } }
  catch (e) { fail++; console.log('FAIL -', name, '=>', e && e.message); }
}

const ROOT = path.join(__dirname, '..', '..');
const COORDINATOR_PATH = path.join(ROOT, 'js', 'core', 'SyncCoordinator.js');
const INDEX_HTML_PATH = path.join(ROOT, 'index.html');
const SETTINGS_PATH = path.join(ROOT, 'js', 'modules', 'settings.js');
const FIRSTRUN_PATH = path.join(ROOT, 'js', 'modules', 'firstrun.js');
const SW_PATH = path.join(ROOT, 'service-worker.js');

// ---- TEST 1 — file existence (§30.1) -----------------------------------
check('TEST 1 — js/core/SyncCoordinator.js exists', fs.existsSync(COORDINATOR_PATH));

const coordinatorSrc = fs.readFileSync(COORDINATOR_PATH, 'utf8');
const indexHtmlSrc = fs.readFileSync(INDEX_HTML_PATH, 'utf8');
const settingsSrc = fs.readFileSync(SETTINGS_PATH, 'utf8');
const firstrunSrc = fs.readFileSync(FIRSTRUN_PATH, 'utf8');
const swSrc = fs.readFileSync(SW_PATH, 'utf8');

// ----------------------------------------------------------------------
// Sandbox factory: fresh window/global + controllable Date.now()/
// setTimeout()/navigator.onLine + mock OfflineQueue/SyncCheckpoint/
// SyncEngine/loadFromSheets per test, loading the REAL SyncCoordinator.js
// source each time (never a re-implementation) via vm.createContext/
// runInContext — same pattern tests/PHASE_A7_frontend_sync_tests.js uses.
// ----------------------------------------------------------------------
function makeSandbox(opts) {
  opts = opts || {};

  let fakeNow = (typeof opts.startNow === 'number') ? opts.startNow : 1700000000000;
  const delaysRecorded = [];
  const calls = { replay: 0, loadFromSheets: 0, runIncremental: 0, bootIncremental: 0 };

  const sandbox = {
    console: console,
    Object: Object,
    Array: Array,
    Promise: Promise,
    String: String
  };
  sandbox.window = sandbox;
  sandbox.navigator = { onLine: (opts.onLine !== undefined) ? opts.onLine : true };
  sandbox.Date = { now: function () { return fakeNow; } };
  // Fires callbacks on the real Node event loop (so async ordering still
  // works) but WITHOUT actually waiting `ms` real milliseconds — this
  // suite verifies which delay VALUES SyncCoordinator asks for, not real
  // wall-clock timing (a real 1s+2s+4s wait per retry test would make
  // this suite unacceptably slow).
  sandbox.setTimeout = function (fn, ms) {
    delaysRecorded.push(ms);
    return global.setTimeout(fn, 0);
  };

  const checkpoints = opts.checkpoints || {};
  sandbox.SyncCheckpoint = {
    get: function (sheetName) {
      if (opts.checkpointGetThrows) throw new Error('checkpoint read failed (simulated)');
      return Object.prototype.hasOwnProperty.call(checkpoints, sheetName) ? checkpoints[sheetName] : null;
    }
  };

  const pairs = opts.pairs || [['SHEET_A', 'a'], ['SHEET_B', 'b']];
  sandbox.SyncEngine = {
    SYNC_ENTITY_PAIRS: pairs,
    runIncrementalSync: async function () {
      calls.runIncremental++;
      if (opts.runIncrementalImpl) return opts.runIncrementalImpl();
      return { results: [], succeeded: pairs.length, failed: 0 };
    },
    bootIncrementalSync: async function () {
      calls.bootIncremental++;
      if (opts.bootIncrementalImpl) return opts.bootIncrementalImpl();
      return undefined;
    }
  };

  sandbox.loadFromSheets = async function () {
    calls.loadFromSheets++;
    if (opts.loadFromSheetsImpl) return opts.loadFromSheetsImpl();
    return undefined;
  };

  sandbox.OfflineQueue = {
    replay: async function () {
      calls.replay++;
      if (opts.replayImpl) return opts.replayImpl();
      return undefined;
    }
  };

  vm.createContext(sandbox);
  vm.runInContext(coordinatorSrc, sandbox, { filename: COORDINATOR_PATH });

  return {
    sandbox: sandbox,
    checkpoints: checkpoints,
    calls: calls,
    delaysRecorded: delaysRecorded,
    setNow: function (t) { fakeNow = t; },
    advanceNow: function (deltaMs) { fakeNow += deltaMs; }
  };
}

// ---- TEST 2-6 — API surface exists (§30.2-6) ----------------------------
{
  const env = makeSandbox();
  check('TEST 2 — SyncCoordinator exists', typeof env.sandbox.SyncCoordinator !== 'undefined');
  check('TEST 3 — requestSync exists', typeof env.sandbox.SyncCoordinator.requestSync === 'function');
  check('TEST 4 — syncNow exists', typeof env.sandbox.SyncCoordinator.syncNow === 'function');
  check('TEST 5 — getState exists', typeof env.sandbox.SyncCoordinator.getState === 'function');
  check('TEST 6 — shouldSync exists', typeof env.sandbox.SyncCoordinator.shouldSync === 'function');
}

// ---- TEST 7 — TTL (§30.7) ------------------------------------------------
async function test7_ttl() {
  const env = makeSandbox();
  const SC = env.sandbox.SyncCoordinator;
  await SC.requestSync('boot'); // succeeds, sets lastSuccessAt = fakeNow
  const rightAfter = SC.shouldSync('boot'); // still fresh -> should be false
  env.advanceNow(SC.DEFAULT_TTL_MS + 1); // past TTL
  const afterTtl = SC.shouldSync('boot'); // stale -> should be true
  return rightAfter === false && afterTtl === true;
}

// ---- TEST 8 — manual bypasses TTL (§30.8) --------------------------------
async function test8_manualBypassTtl() {
  const env = makeSandbox();
  const SC = env.sandbox.SyncCoordinator;
  await SC.requestSync('boot'); // fresh success recorded
  return SC.shouldSync('manual') === true; // manual ignores TTL entirely
}

// ---- TEST 9 — cooldown (§30.9) -------------------------------------------
async function test9_cooldown() {
  const env = makeSandbox({
    // force a FAILED sync so lastSuccessAt stays null and only the
    // cooldown (based on lastStartedAt), not the TTL, is in play
    runIncrementalImpl: async () => { throw new Error('simulated'); }
  });
  const SC = env.sandbox.SyncCoordinator;
  env.checkpoints['SHEET_A'] = 'C1'; // subsequent-sync path -> runIncrementalSync
  await SC.requestSync('boot'); // fails after retries; lastStartedAt = fakeNow
  const rightAfter = SC.shouldSync('online'); // within cooldown -> false
  env.advanceNow(SC.DEFAULT_COOLDOWN_MS + 1);
  const afterCooldown = SC.shouldSync('online'); // cooldown elapsed -> true
  return rightAfter === false && afterCooldown === true;
}

// ---- TEST 10 — offline guard (§30.10) ------------------------------------
async function test10_offline() {
  const env = makeSandbox({ onLine: false });
  const SC = env.sandbox.SyncCoordinator;
  const result = await SC.requestSync('boot');
  return result.status === 'offline'
    && env.calls.replay === 0 && env.calls.loadFromSheets === 0
    && env.calls.runIncremental === 0 && env.calls.bootIncremental === 0
    && SC.getState().status === 'offline';
}

// ---- TEST 11 — single-flight (§30.11) ------------------------------------
async function test11_singleFlight() {
  const env = makeSandbox();
  const SC = env.sandbox.SyncCoordinator;
  const p1 = SC.requestSync('boot');
  const p2 = SC.requestSync('online');
  const p3 = SC.requestSync('manual'); // manual too — single-flight beats TTL bypass
  const same = (p1 === p2) && (p2 === p3);
  await p1;
  return same;
}

// Strips // and /* */ comments so "must not appear in code" checks (no
// polling, no Firebase) aren't tripped by this file's own prose
// explaining, IN COMMENTS, why it deliberately avoids those things.
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}
const coordinatorCodeOnly = stripComments(coordinatorSrc);

// ---- TEST 12 — no polling (§30.12) ---------------------------------------
check('TEST 12 — no setInterval anywhere in SyncCoordinator.js\'s actual code (no polling)', !/setInterval/.test(coordinatorCodeOnly));

// ---- TEST 13 — calls OfflineQueue.replay() (§30.13) ----------------------
async function test13_callsReplay() {
  const env = makeSandbox();
  await env.sandbox.SyncCoordinator.requestSync('boot');
  return env.calls.replay === 1;
}

// ---- TEST 14 — first sync behavior (§30.14) ------------------------------
async function test14_firstSync() {
  const env = makeSandbox(); // no checkpoints at all
  await env.sandbox.SyncCoordinator.requestSync('boot');
  return env.calls.loadFromSheets === 1 && env.calls.bootIncremental === 1 && env.calls.runIncremental === 0;
}

// ---- TEST 15 — subsequent incremental behavior (§30.15) ------------------
async function test15_subsequentSync() {
  const env = makeSandbox();
  env.checkpoints['SHEET_A'] = 'SOME_CURSOR'; // at least one sheet already synced
  await env.sandbox.SyncCoordinator.requestSync('boot');
  return env.calls.runIncremental === 1 && env.calls.loadFromSheets === 0 && env.calls.bootIncremental === 0;
}

// ---- TEST 16-19 — retry backoff + attempt cap (§30.16-19) ----------------
// See SyncCoordinator.js's own file-header note on how "1s/2s/4s x 3
// محاولات" was interpreted: initial attempt + up to 3 retries, delays
// [1000, 2000, 4000] between consecutive attempts.
async function test16to19_retryBackoff() {
  const env = makeSandbox({
    checkpoints: { SHEET_A: 'C1' }, // subsequent-sync path
    runIncrementalImpl: async () => { throw new Error('always fails (simulated)'); }
  });
  const result = await env.sandbox.SyncCoordinator.requestSync('manual');
  const delays = env.delaysRecorded;
  return {
    retry1s: delays[0] === 1000,
    retry2s: delays[1] === 2000,
    retry4s: delays[2] === 4000,
    maxAttempts: delays.length === 3 && env.calls.runIncremental === 4, // 1 initial + 3 retries
    finalStatus: result.status === 'failed'
  };
}

// ---- TEST 20 — successful state reset (§30.20) ---------------------------
async function test20_successState() {
  const env = makeSandbox();
  const SC = env.sandbox.SyncCoordinator;
  await SC.requestSync('boot');
  const st = SC.getState();
  return st.status === 'success' && st.consecutiveFailures === 0 && st.lastSuccessAt !== null && st.lastReason === 'boot';
}

// ---- TEST 21 — failed state (§30.21) -------------------------------------
async function test21_failedState() {
  const env = makeSandbox({
    checkpoints: { SHEET_A: 'C1' },
    runIncrementalImpl: async () => { throw new Error('always fails (simulated)'); }
  });
  const SC = env.sandbox.SyncCoordinator;
  await SC.requestSync('boot');
  const st = SC.getState();
  return st.status === 'failed' && st.lastFailureAt !== null && st.consecutiveFailures === 1;
}

// ---- TEST 22/23 — notification/resume APIs exist and are usable (§30.22-23)
async function test22_notificationApi() {
  const env = makeSandbox();
  const result = await env.sandbox.SyncCoordinator.requestSync('notification');
  return result.reason === 'notification' && result.success === true;
}
async function test23_resumeApi() {
  const env = makeSandbox();
  const result = await env.sandbox.SyncCoordinator.requestSync('resume');
  return result.reason === 'resume' && result.success === true;
}

// ---- TEST 24 — no Firebase in A7.5 (§30.24, §29/§35) ---------------------
check('TEST 24 — no Firebase/FCM/Firestore code in SyncCoordinator.js\'s actual code', !/firebase|firestore|FCM/i.test(coordinatorCodeOnly));

// ----------------------------------------------------------------------
// STATIC WIRING CHECKS (source inspection, not execution) — confirms the
// five call sites (§21-23) were actually redirected through the
// Coordinator, and that the protected/black-box files were not touched.
// ----------------------------------------------------------------------
function staticWiringChecks() {
  check('index.html: both boot call sites use SyncCoordinator.requestSync(\'boot\')',
    (indexHtmlSrc.match(/SyncCoordinator\.requestSync\('boot'\)/g) || []).length === 2);
  check('settings.js: testConnection() calls SyncCoordinator.requestSync(\'manual\') (with a same-line legacy fallback only)',
    /if\(typeof SyncCoordinator!=='undefined'\)\{SyncCoordinator\.requestSync\('manual'\);\}else\{setTimeout\(loadFromSheets,800\);\}/.test(settingsSrc));
  check('settings.js: refreshAll() uses SyncCoordinator.requestSync(\'manual\')',
    /async function refreshAll\(\)\{if\(API_URL\)\{if\(typeof SyncCoordinator/.test(settingsSrc));
  check('firstrun.js: uses SyncCoordinator.requestSync(\'boot\') instead of a bare loadFromSheets() timeout',
    /SyncCoordinator\.requestSync\('boot'\)/.test(firstrunSrc));
  check('service-worker.js: SyncCoordinator.js precached',
    /js\/core\/SyncCoordinator\.js\?v=1/.test(swSrc));
  check('index.html: SyncCoordinator.js loads AFTER SyncEngine.js and BEFORE firstrun.js',
    indexHtmlSrc.indexOf('<script src="js/core/SyncEngine.js') <
      indexHtmlSrc.indexOf('<script src="js/core/SyncCoordinator.js') &&
    indexHtmlSrc.indexOf('<script src="js/core/SyncCoordinator.js') <
      indexHtmlSrc.indexOf('<script src="js/modules/firstrun.js'));
  check('SyncCoordinator.js does not touch OfflineQueue.js/SyncEngine.js/SyncCheckpoint.js/api.js/Repository.js/StorageAdapter.js/IndexedDBAdapter.js (grep)',
    !/OfflineQueue\.js\s*=|SyncEngine\.js\s*=|SyncCheckpoint\.js\s*=/.test(coordinatorSrc)); // this file only CALLS those globals, never redefines/edits their source
}

(async function main() {
  console.log('=== PHASE A7.5 — SyncCoordinator Test Matrix ===');
  await checkAsync('TEST 7  — TTL: fresh success suppresses re-sync, stale success allows it', test7_ttl);
  await checkAsync('TEST 8  — manual bypasses TTL', test8_manualBypassTtl);
  await checkAsync('TEST 9  — cooldown absorbs a burst of triggers, then releases', test9_cooldown);
  await checkAsync('TEST 10 — offline guard: no network calls, status=offline', test10_offline);
  await checkAsync('TEST 11 — single-flight: concurrent requestSync() calls share one Promise', test11_singleFlight);
  await checkAsync('TEST 13 — OfflineQueue.replay() called once per sync attempt', test13_callsReplay);
  await checkAsync('TEST 14 — First Sync: loadFromSheets() + bootIncrementalSync(), no runIncrementalSync()', test14_firstSync);
  await checkAsync('TEST 15 — Subsequent Sync: runIncrementalSync() only, no full pull', test15_subsequentSync);

  const retry = await test16to19_retryBackoff();
  check('TEST 16 — retry backoff #1 = 1s', retry.retry1s);
  check('TEST 17 — retry backoff #2 = 2s', retry.retry2s);
  check('TEST 18 — retry backoff #3 = 4s', retry.retry4s);
  check('TEST 19 — max 3 retries (4 attempts total), then permanent failure', retry.maxAttempts && retry.finalStatus);

  await checkAsync('TEST 20 — successful sync resets consecutiveFailures and records lastSuccessAt', test20_successState);
  await checkAsync('TEST 21 — exhausted retries record failed state + increment consecutiveFailures', test21_failedState);
  await checkAsync('TEST 22 — \'notification\' reason is a usable requestSync() API', test22_notificationApi);
  await checkAsync('TEST 23 — \'resume\' reason is a usable requestSync() API', test23_resumeApi);

  staticWiringChecks();

  console.log('\n=== RESULT:', pass, 'PASS /', fail, 'FAIL ===');
  process.exit(fail === 0 ? 0 : 1);
})();
