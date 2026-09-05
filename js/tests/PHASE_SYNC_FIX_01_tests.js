'use strict';
/**
 * PHASE SYNC-FIX-01 — Sync Reliability Fix Test Matrix
 * ================================================================
 * Exercises the two files this phase actually changed for behavior
 * (js/core/SyncEngine.js, js/core/SyncCoordinator.js) plus the
 * loadFromSheets() classification change in js/modules/settings.js, in
 * sandboxed VM contexts (no network, no IndexedDB, no browser — same
 * "STATIC/MOCK VERIFIED, not LIVE VERIFIED" disclosure every other test
 * file in this suite already carries).
 *
 * What this file is checking, in one sentence each:
 *   A) SyncEngine.runIncrementalSyncAndPersist() — the actual root-cause
 *      fix — now persists lastSyncAt/updates the sync-status UI on a
 *      real success/partial incremental result, and never does so on a
 *      total failure.
 *   B) SyncCoordinator.js's "subsequent sync" branch now correctly
 *      surfaces a total incremental failure as an attempt failure
 *      (enabling retry/backoff), instead of silently treating it as
 *      success.
 *   C) settings.js's loadFromSheets() now classifies success/partial/
 *      failed instead of collapsing partial into a "full success" toast,
 *      and still never touches lastSyncAt on total failure.
 *   D) SyncCoordinator.js now actually wires visibilitychange/pageshow/
 *      online to requestSync('resume'/'online') — the direct fix for the
 *      reported "🟢 منذ يوم" staleness — and a burst of all three still
 *      yields at most one real sync attempt.
 *
 * Run: node tests/PHASE_SYNC_FIX_01_tests.js
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
const ENGINE_PATH = path.join(ROOT, 'js', 'core', 'SyncEngine.js');
const COORDINATOR_PATH = path.join(ROOT, 'js', 'core', 'SyncCoordinator.js');
const SETTINGS_PATH = path.join(ROOT, 'js', 'modules', 'settings.js');
const CSS_PATH = path.join(ROOT, 'css', 'components.css');

const engineSrc = fs.readFileSync(ENGINE_PATH, 'utf8');
const coordinatorSrc = fs.readFileSync(COORDINATOR_PATH, 'utf8');
const settingsSrc = fs.readFileSync(SETTINGS_PATH, 'utf8');
const cssSrc = fs.readFileSync(CSS_PATH, 'utf8');

// ========================================================================
// PART A — SyncEngine.js: runIncrementalSyncAndPersist()
// ========================================================================
function makeEngineSandbox(opts) {
  opts = opts || {};
  const checkpoints = opts.checkpoints || {};
  const persistCalls = [];
  const uiCalls = { updateTopbarSyncMeta: 0, showSyncIndicator: [] };

  const sandbox = {
    console: console, Object: Object, Array: Array, Promise: Promise,
    JSON: JSON, String: String, setTimeout: setTimeout, Date: Date
  };
  sandbox.window = sandbox;

  sandbox.SyncCheckpoint = {
    get: function (sheetName) {
      return Object.prototype.hasOwnProperty.call(checkpoints, sheetName) ? checkpoints[sheetName] : null;
    },
    save: function (sheetName, cursor) { checkpoints[sheetName] = cursor; }
  };

  const pairs = opts.pairs || [['SHEET_A', 'a'], ['SHEET_B', 'b']];
  sandbox.ApiService = {
    syncSheet: async function (sheetName, cursor) {
      if (opts.syncSheetImpl) return opts.syncSheetImpl(sheetName, cursor);
      return { sheet: sheetName, items: [], nextCursor: cursor || null, hasMore: false };
    }
  };
  pairs.forEach(function (pair) {
    var repoKey = pair[1];
    sandbox[repoKey + 'Repository'] = { async import() { return { success: true }; } };
    sandbox[repoKey + 'RepositoryReadyPromise'] = Promise.resolve();
  });

  // Mirrors the REAL globals SyncEngine.js's _persistSyncOutcome() looks
  // for (settings.js's own _persistSetting/updateTopbarSyncMeta and
  // showSyncIndicator) — this is what proves the fix actually reaches
  // the same persistence path loadFromSheets() uses, not a new one.
  sandbox._persistSetting = function (key, value) { persistCalls.push({ key: key, value: value }); };
  sandbox.updateTopbarSyncMeta = function () { uiCalls.updateTopbarSyncMeta++; };
  sandbox.showSyncIndicator = function (v) { uiCalls.showSyncIndicator.push(v); };

  // Override SYNC_ENTITY_PAIRS indirectly isn't possible post-IIFE, so we
  // patch the source's literal pairs list at load time for this test file
  // only — same technique PHASE_A7_frontend_sync_tests.js avoids needing
  // because it calls syncEntityIncremental() directly per-sheet instead
  // of runIncrementalSync() (which iterates the file's own constant). We
  // do the same here: call syncEntityIncremental() per pair ourselves is
  // not possible for testing runIncrementalSyncAndPersist() as a whole,
  // so this suite instead drives it through the real SYNC_ENTITY_PAIRS
  // list already defined in SyncEngine.js and provides a matching mock
  // repo/ApiService response for every one of those real sheet names.
  vm.createContext(sandbox);
  vm.runInContext(engineSrc, sandbox, { filename: ENGINE_PATH });

  // Now register mock repos for the REAL SYNC_ENTITY_PAIRS (not the
  // placeholder `pairs` above) so a full runIncrementalSync() pass has a
  // working repo for every entry regardless of test-supplied `pairs`.
  sandbox.SyncEngine.SYNC_ENTITY_PAIRS.forEach(function (pair) {
    var repoKey = pair[1];
    if (!sandbox[repoKey + 'Repository']) {
      sandbox[repoKey + 'Repository'] = { async import() { return { success: true }; } };
      sandbox[repoKey + 'RepositoryReadyPromise'] = Promise.resolve();
    }
  });

  return { sandbox: sandbox, checkpoints: checkpoints, persistCalls: persistCalls, uiCalls: uiCalls };
}

async function testA1_fullSuccessPersists() {
  const env = makeEngineSandbox({
    syncSheetImpl: async (sheet, cursor) => ({ sheet: sheet, items: [], nextCursor: cursor, hasMore: false })
  });
  const result = await env.sandbox.SyncEngine.runIncrementalSyncAndPersist();
  return result.status === 'success'
    && env.persistCalls.length === 1 && env.persistCalls[0].key === 'lastSyncAt'
    && env.uiCalls.updateTopbarSyncMeta === 1
    && env.uiCalls.showSyncIndicator[env.uiCalls.showSyncIndicator.length - 1] === 'success';
}

async function testA2_totalFailureDoesNotPersist() {
  const env = makeEngineSandbox({
    syncSheetImpl: async () => { throw new Error('network down (simulated)'); }
  });
  const result = await env.sandbox.SyncEngine.runIncrementalSyncAndPersist();
  return result.status === 'failed'
    && env.persistCalls.length === 0
    && env.uiCalls.updateTopbarSyncMeta === 0
    && env.uiCalls.showSyncIndicator.length === 0;
}

async function testA3_partialPersistsAsPartial() {
  const env = makeEngineSandbox();
  let call = 0;
  env.sandbox.ApiService.syncSheet = async function (sheetName, cursor) {
    call++;
    // Fail exactly one of the real SYNC_ENTITY_PAIRS sheets, succeed the rest.
    if (call === 1) throw new Error('one sheet down (simulated)');
    return { sheet: sheetName, items: [], nextCursor: cursor, hasMore: false };
  };
  const result = await env.sandbox.SyncEngine.runIncrementalSyncAndPersist();
  return result.status === 'partial'
    && result.succeeded > 0 && result.failed > 0
    && env.persistCalls.length === 1 // still a real, non-fabricated timestamp advance
    && env.uiCalls.showSyncIndicator[env.uiCalls.showSyncIndicator.length - 1] === 'partial';
}

async function testA4_neverThrows() {
  const env = makeEngineSandbox({ syncSheetImpl: async () => { throw new Error('boom'); } });
  try {
    const result = await env.sandbox.SyncEngine.runIncrementalSyncAndPersist();
    return result.status === 'failed'; // resolved, not rejected
  } catch (e) {
    return false;
  }
}

// ========================================================================
// PART B — SyncCoordinator.js: subsequent-sync failure now retries
// (reuses the exact sandbox pattern PHASE_A7_5_sync_coordinator_tests.js
// already established for this file).
// ========================================================================
function makeCoordinatorSandbox(opts) {
  opts = opts || {};
  let fakeNow = (typeof opts.startNow === 'number') ? opts.startNow : 1700000000000;
  const delaysRecorded = [];
  const calls = { replay: 0, loadFromSheets: 0, runIncrementalAndPersist: 0, bootIncremental: 0 };
  const listeners = {}; // event name -> array of handlers, for the lifecycle-wiring tests

  const sandbox = { console: console, Object: Object, Array: Array, Promise: Promise, String: String };
  sandbox.window = sandbox;
  sandbox.navigator = { onLine: (opts.onLine !== undefined) ? opts.onLine : true };
  sandbox.Date = { now: function () { return fakeNow; } };
  sandbox.setTimeout = function (fn, ms) { delaysRecorded.push(ms); return global.setTimeout(fn, 0); };

  if (opts.withDom) {
    sandbox.document = {
      visibilityState: 'visible',
      addEventListener: function (evt, fn) { (listeners[evt] = listeners[evt] || []).push(fn); }
    };
    sandbox.window.addEventListener = function (evt, fn) { (listeners[evt] = listeners[evt] || []).push(fn); };
  }

  const checkpoints = opts.checkpoints || {};
  sandbox.SyncCheckpoint = {
    get: function (sheetName) {
      return Object.prototype.hasOwnProperty.call(checkpoints, sheetName) ? checkpoints[sheetName] : null;
    }
  };

  const pairs = opts.pairs || [['SHEET_A', 'a'], ['SHEET_B', 'b']];
  sandbox.SyncEngine = {
    SYNC_ENTITY_PAIRS: pairs,
    // PHASE SYNC-FIX-01 — this is the method _attemptOnce() now prefers.
    runIncrementalSyncAndPersist: async function () {
      calls.runIncrementalAndPersist++;
      if (opts.runIncrementalAndPersistImpl) return opts.runIncrementalAndPersistImpl();
      return { status: 'success', results: [], succeeded: pairs.length, failed: 0 };
    },
    bootIncrementalSync: async function () { calls.bootIncremental++; return undefined; }
  };

  sandbox.loadFromSheets = async function () {
    calls.loadFromSheets++;
    if (opts.loadFromSheetsImpl) return opts.loadFromSheetsImpl();
    return { status: 'success', loaded: 0, failed: 0, total: 0 };
  };

  sandbox.OfflineQueue = { replay: async function () { calls.replay++; return undefined; } };

  vm.createContext(sandbox);
  vm.runInContext(coordinatorSrc, sandbox, { filename: COORDINATOR_PATH });

  return {
    sandbox: sandbox, checkpoints: checkpoints, calls: calls, delaysRecorded: delaysRecorded,
    listeners: listeners,
    setNow: function (t) { fakeNow = t; },
    advanceNow: function (d) { fakeNow += d; },
    fireVisible: function () { sandbox.document.visibilityState = 'visible'; (listeners.visibilitychange || []).forEach(function (fn) { fn(); }); },
    firePageshow: function () { (listeners.pageshow || []).forEach(function (fn) { fn(); }); },
    fireOnline: function () { (listeners.online || []).forEach(function (fn) { fn(); }); }
  };
}

async function testB1_totalIncrementalFailureNowRetries() {
  const env = makeCoordinatorSandbox({
    checkpoints: { SHEET_A: 'C1' }, // subsequent-sync path
    runIncrementalAndPersistImpl: async () => ({ status: 'failed', results: [], succeeded: 0, failed: 2 })
  });
  const result = await env.sandbox.SyncCoordinator.requestSync('boot');
  // BEFORE this phase: runIncrementalSync()'s result was discarded and
  // this would resolve as an immediate, single-attempt "success". AFTER:
  // a 'failed' status throws inside _attemptOnce(), so the full 1s/2s/4s
  // retry ladder (4 attempts total) must run, and the final coordinator
  // state must honestly be 'failed' — matching TEST 8/9 of the original
  // request ("فشل API -> lastSync يبقى كما هو" / no false success).
  return result.status === 'failed' && env.calls.runIncrementalAndPersist === 4;
}

async function testB2_partialIncrementalDoesNotRetry() {
  const env = makeCoordinatorSandbox({
    checkpoints: { SHEET_A: 'C1' },
    runIncrementalAndPersistImpl: async () => ({ status: 'partial', results: [], succeeded: 1, failed: 1 })
  });
  const result = await env.sandbox.SyncCoordinator.requestSync('boot');
  // A partial result is still forward progress (some sheets DID sync) —
  // it must NOT be treated as an attempt failure / trigger retry/backoff,
  // only a total failure should.
  return result.status === 'success' && env.calls.runIncrementalAndPersist === 1 && env.delaysRecorded.length === 0;
}

async function testB3_firstSyncTotalFailureRetries() {
  const env = makeCoordinatorSandbox({
    // no checkpoints -> first-sync branch -> loadFromSheets()
    loadFromSheetsImpl: async () => ({ status: 'failed', loaded: 0, failed: 12, total: 12 })
  });
  const result = await env.sandbox.SyncCoordinator.requestSync('boot');
  return result.status === 'failed' && env.calls.loadFromSheets === 4; // 1 initial + 3 retries
}

// ========================================================================
// PART D — lifecycle wiring (visibilitychange / pageshow / online)
// ========================================================================
async function testD1_visibilityChangeTriggersResume() {
  const env = makeCoordinatorSandbox({ withDom: true });
  env.fireVisible();
  // requestSync() itself is async/fire-and-forget from an event handler's
  // point of view; give the microtask queue a tick to let _runSync()'s
  // synchronous prologue (which sets lastReason) run.
  await new Promise(function (r) { setTimeout(r, 10); });
  return env.sandbox.SyncCoordinator.getState().lastReason === 'resume';
}

async function testD2_pageshowTriggersResume() {
  const env = makeCoordinatorSandbox({ withDom: true });
  env.firePageshow();
  await new Promise(function (r) { setTimeout(r, 10); });
  return env.sandbox.SyncCoordinator.getState().lastReason === 'resume';
}

async function testD3_onlineTriggersOnlineReason() {
  const env = makeCoordinatorSandbox({ withDom: true });
  env.fireOnline();
  await new Promise(function (r) { setTimeout(r, 10); });
  return env.sandbox.SyncCoordinator.getState().lastReason === 'online';
}

async function testD4_burstOfEventsYieldsOneSync() {
  const env = makeCoordinatorSandbox({ withDom: true });
  // §4 of the original request's exact scenario: visibilitychange +
  // pageshow + online all firing together must still be ONE sync.
  env.fireVisible();
  env.firePageshow();
  env.fireOnline();
  await new Promise(function (r) { setTimeout(r, 10); });
  return env.calls.replay === 1 && env.calls.runIncrementalAndPersist <= 1;
}

async function testD5_noDomEnvironmentDoesNotThrow() {
  // Node/test/SSR context with no document/window.addEventListener at
  // all — loading the file itself must not throw (guards _wireLifecycleTriggers()).
  try {
    makeCoordinatorSandbox({ withDom: false });
    return true;
  } catch (e) {
    return false;
  }
}

// ========================================================================
// PART C — settings.js loadFromSheets() classification (static source
// checks — a full functional sandbox for this function would need to
// mock fetch/AbortSignal/20+ globals; the existing test suite for this
// file (verify_settings_merge_tombstone.js) already does that for the
// merge/tombstone behavior this phase does not touch).
// ========================================================================
function stripComments(src) { return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, ''); }
const settingsCodeOnly = stripComments(settingsSrc);
const engineCodeOnly = stripComments(engineSrc);
const coordinatorCodeOnly = stripComments(coordinatorSrc);

function staticChecksPartC() {
  check('settings.js: loadFromSheets() returns a {status,...} object (not implicit undefined)',
    /return\s*\{status:status,loaded:loaded,failed:failed,total:total\}/.test(settingsCodeOnly));
  check('settings.js: three-way status classification (failed===total / failed===0 / otherwise partial) present',
    /var status = \(failed===total\) \? 'failed' : \(failed===0 \? 'success' : 'partial'\)/.test(settingsCodeOnly));
  check('settings.js: FAILED branch does not call _persistSetting(\'lastSyncAt\',...)',
    (function () {
      const m = settingsCodeOnly.match(/if\(status==='failed'\)\{[\s\S]*?\}else\{/);
      return !!m && !/_persistSetting\('lastSyncAt'/.test(m[0]);
    })());
  check('settings.js: PARTIAL branch shows a distinct \'مزامنة جزئية\' toast (not the full-success toast)',
    /مزامنة جزئية.*سيُعاد المحاولة تلقائيًا/.test(settingsCodeOnly));
  check('settings.js: showSyncIndicator() has a distinct \'partial\' branch',
    /else if\(v==='partial'\)\{/.test(settingsCodeOnly));
  check('settings.js: updateTopbarSyncMeta() has a distinct \'partial\' branch (not reusing the success text)',
    /state==='partial'/.test(settingsCodeOnly) && /مزامنة جزئية/.test(settingsCodeOnly));
  check('css/components.css: .sync-indicator.partial style defined',
    /\.sync-indicator\.partial\{/.test(cssSrc));
  check('css/components.css: .topbar-lastsync.is-partial style defined',
    /\.topbar-lastsync\.is-partial\{/.test(cssSrc));
  check('SyncEngine.js: runIncrementalSyncAndPersist exported',
    /runIncrementalSyncAndPersist:\s*runIncrementalSyncAndPersist/.test(engineCodeOnly));
  check('SyncEngine.js: FAILED status never calls _persistSetting (guarded by status !== \'failed\')',
    /if \(status !== 'failed'\) \{\s*_persistSyncOutcome\(status\);\s*\}/.test(engineSrc));
  check('SyncCoordinator.js: visibilitychange/pageshow/online listeners present',
    /addEventListener\('visibilitychange'/.test(coordinatorCodeOnly) &&
    /addEventListener\('pageshow'/.test(coordinatorCodeOnly) &&
    /addEventListener\('online'/.test(coordinatorCodeOnly));
  check('SyncCoordinator.js: still no setInterval anywhere (no polling introduced by this phase)',
    !/setInterval/.test(coordinatorCodeOnly));
  check('SyncCoordinator.js: no \'focus\' listener added (request §8 — not needed given visibilitychange+pageshow+online)',
    !/addEventListener\('focus'/.test(coordinatorCodeOnly));
  check('SyncCoordinator.js: subsequent-sync branch throws on incremental \'failed\' status',
    /if \(incResult && incResult\.status === 'failed'\)/.test(coordinatorCodeOnly));
  check('SyncCoordinator.js: first-sync branch throws on loadFromSheets \'failed\' status',
    /if \(lfsResult && lfsResult\.status === 'failed'\)/.test(coordinatorCodeOnly));
}

(async function main() {
  console.log('=== PHASE SYNC-FIX-01 — Sync Reliability Fix Test Matrix ===');

  await checkAsync('A1 — full success: lastSyncAt persisted + topbar/indicator updated', testA1_fullSuccessPersists);
  await checkAsync('A2 — total failure: lastSyncAt NOT touched, no UI update (no fabricated success)', testA2_totalFailureDoesNotPersist);
  await checkAsync('A3 — partial: lastSyncAt still advances (real progress) but UI marked \'partial\', not \'success\'', testA3_partialPersistsAsPartial);
  await checkAsync('A4 — runIncrementalSyncAndPersist() never rejects even on total failure', testA4_neverThrows);

  await checkAsync('B1 — ROOT CAUSE: subsequent-sync total failure now retries (1s/2s/4s) instead of faking success', testB1_totalIncrementalFailureNowRetries);
  await checkAsync('B2 — subsequent-sync partial result does not trigger retry/backoff', testB2_partialIncrementalDoesNotRetry);
  await checkAsync('B3 — first-sync total failure (loadFromSheets) now retries', testB3_firstSyncTotalFailureRetries);

  await checkAsync('D1 — ROOT CAUSE: visibilitychange->visible triggers requestSync(\'resume\')', testD1_visibilityChangeTriggersResume);
  await checkAsync('D2 — ROOT CAUSE: pageshow triggers requestSync(\'resume\') (BFCache restore)', testD2_pageshowTriggersResume);
  await checkAsync('D3 — ROOT CAUSE: window online event triggers requestSync(\'online\')', testD3_onlineTriggersOnlineReason);
  await checkAsync('D4 — §4: visibilitychange+pageshow+online firing together still yields exactly one sync', testD4_burstOfEventsYieldsOneSync);
  await checkAsync('D5 — no-DOM (Node/test) environment: wiring guard does not throw', testD5_noDomEnvironmentDoesNotThrow);

  staticChecksPartC();

  console.log('\n=== RESULT:', pass, 'PASS /', fail, 'FAIL ===');
  process.exit(fail === 0 ? 0 : 1);
})();
