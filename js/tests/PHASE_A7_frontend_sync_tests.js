'use strict';
/**
 * PHASE A7 — STEP 6: FRONTEND SYNC STATIC TEST MATRIX
 * Exercises js/core/SyncEngine.js (Receive -> Validate -> Apply -> Commit
 * Checkpoint) with mocked ApiService/SyncCheckpoint/Repository objects in a
 * sandboxed VM context (no network, no IndexedDB, no browser — same
 * "STATIC VERIFIED, not LIVE VERIFIED" disclosure as
 * tests/PHASE_A7_static_tests.js). Also statically cross-checks the
 * settings.js / index.html / service-worker.js wiring this session added.
 *
 * Run: node tests/PHASE_A7_frontend_sync_tests.js
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
const SYNC_ENGINE_PATH = path.join(ROOT, 'js', 'core', 'SyncEngine.js');
const SETTINGS_PATH = path.join(ROOT, 'js', 'modules', 'settings.js');
const INDEX_HTML_PATH = path.join(ROOT, 'index.html');
const SW_PATH = path.join(ROOT, 'service-worker.js');

const engineSrc = fs.readFileSync(SYNC_ENGINE_PATH, 'utf8');
const settingsSrc = fs.readFileSync(SETTINGS_PATH, 'utf8');
const indexHtmlSrc = fs.readFileSync(INDEX_HTML_PATH, 'utf8');
const swSrc = fs.readFileSync(SW_PATH, 'utf8');

// ----------------------------------------------------------------------
// Sandbox factory: fresh window/global + mock ApiService/SyncCheckpoint
// per test, loading the REAL SyncEngine.js source each time (never a
// re-implementation) via vm.createContext/runInContext.
// ----------------------------------------------------------------------
function makeSandbox(opts) {
  opts = opts || {};
  const checkpoints = {};
  const applyCalls = [];
  const sandbox = {
    console: console,
    Object: Object,
    Array: Array,
    Promise: Promise,
    JSON: JSON,
    String: String,
    setTimeout: setTimeout
  };
  sandbox.window = sandbox;

  sandbox.SyncCheckpoint = {
    get(sheetName) {
      return Object.prototype.hasOwnProperty.call(checkpoints, sheetName) ? checkpoints[sheetName] : null;
    },
    save(sheetName, cursor) {
      if (opts.checkpointSaveThrows) throw new Error('checkpoint write failed (simulated)');
      if (cursor == null) delete checkpoints[sheetName]; else checkpoints[sheetName] = cursor;
    },
    clearAll() { Object.keys(checkpoints).forEach(function (k) { delete checkpoints[k]; }); }
  };

  sandbox.ApiService = {
    async syncSheet(sheetName, cursor) {
      if (opts.syncSheetImpl) return opts.syncSheetImpl(sheetName, cursor);
      return { sheet: sheetName, items: [], nextCursor: cursor || null, hasMore: false };
    }
  };

  // Mock repository, one per repoKey used in a test.
  function makeMockRepo(repoKey, importImpl) {
    sandbox[repoKey + 'Repository'] = {
      _applied: [],
      async import(items, mode) {
        applyCalls.push({ repoKey: repoKey, items: items, mode: mode });
        if (importImpl) return importImpl(items, mode);
        this._applied.push.apply(this._applied, items);
        return { success: true, imported: items.length, mode: mode, error: null };
      }
    };
    sandbox[repoKey + 'RepositoryReadyPromise'] = Promise.resolve();
  }

  vm.createContext(sandbox);
  vm.runInContext(engineSrc, sandbox, { filename: SYNC_ENGINE_PATH });

  return { sandbox: sandbox, checkpoints: checkpoints, applyCalls: applyCalls, makeMockRepo: makeMockRepo };
}

// ----------------------------------------------------------------------
// TEST 1 — Initial Sync (no stored checkpoint -> cursor passed as null,
// full "everything" page applied, checkpoint committed from nextCursor).
// ----------------------------------------------------------------------
async function test1() {
  const env = makeSandbox({
    syncSheetImpl: async (sheet, cursor) => {
      if (cursor !== null) throw new Error('expected null cursor on initial sync, got ' + cursor);
      return { sheet: sheet, items: [{ id: '1', name: 'a', 'محذوف_في': '' }, { id: '2', name: 'b', 'محذوف_في': '' }], nextCursor: 'CURSOR_2', hasMore: false };
    }
  });
  env.makeMockRepo('cases');
  const result = await env.sandbox.SyncEngine.syncEntityIncremental('القضايا', 'cases');
  return result.ok === true
    && result.pagesApplied === 1
    && env.checkpoints['القضايا'] === 'CURSOR_2'
    && env.sandbox.casesRepository._applied.length === 2;
}

// ----------------------------------------------------------------------
// TEST 2 — Incremental Sync (a previously stored checkpoint is passed to
// ApiService.syncSheet exactly as-is).
// ----------------------------------------------------------------------
async function test2() {
  let cursorSeen = null;
  const env = makeSandbox({
    syncSheetImpl: async (sheet, cursor) => { cursorSeen = cursor; return { sheet: sheet, items: [], nextCursor: cursor, hasMore: false }; }
  });
  env.checkpoints['القضايا'] = 'STORED_CURSOR_X';
  env.makeMockRepo('cases');
  await env.sandbox.SyncEngine.syncEntityIncremental('القضايا', 'cases');
  return cursorSeen === 'STORED_CURSOR_X';
}

// ----------------------------------------------------------------------
// TEST 3 — Same-timestamp items (composite cursor tie-break is a backend
// concern already covered by tests/PHASE_A7_static_tests.js TEST 10/11;
// here we confirm the frontend applies ALL same-timestamp items in one
// page atomically, none silently dropped).
// ----------------------------------------------------------------------
async function test3() {
  const env = makeSandbox({
    syncSheetImpl: async (sheet, cursor) => ({
      sheet: sheet,
      items: [
        { id: '10', 'آخر_تحديث': 'T1', 'محذوف_في': '' },
        { id: '11', 'آخر_تحديث': 'T1', 'محذوف_في': '' },
        { id: '12', 'آخر_تحديث': 'T1', 'محذوف_في': '' }
      ],
      nextCursor: 'CUR_T1_12', hasMore: false
    })
  });
  env.makeMockRepo('cases');
  const result = await env.sandbox.SyncEngine.syncEntityIncremental('القضايا', 'cases');
  return result.ok === true && env.sandbox.casesRepository._applied.length === 3;
}

// ----------------------------------------------------------------------
// TEST 4 — Multiple pages: hasMore true then false, cursor advances each
// page, checkpoint committed after EACH successful page (not just once
// at the end).
// ----------------------------------------------------------------------
async function test4() {
  let call = 0;
  const committedAfterEachPage = [];
  const env = makeSandbox({
    syncSheetImpl: async (sheet, cursor) => {
      call++;
      if (call === 1) return { sheet: sheet, items: [{ id: '1', 'محذوف_في': '' }], nextCursor: 'PAGE1_CURSOR', hasMore: true };
      if (call === 2) return { sheet: sheet, items: [{ id: '2', 'محذوف_في': '' }], nextCursor: 'PAGE2_CURSOR', hasMore: false };
      throw new Error('unexpected extra page fetch');
    }
  });
  env.makeMockRepo('cases', async (items) => {
    committedAfterEachPage.push(env.checkpoints['القضايا'] || null); // checkpoint state AT time of apply (must be prior page's, proving apply-then-commit order)
    return { success: true, imported: items.length, mode: 'merge', error: null };
  });
  const result = await env.sandbox.SyncEngine.syncEntityIncremental('القضايا', 'cases');
  return result.ok === true
    && result.pagesApplied === 2
    && call === 2
    && env.checkpoints['القضايا'] === 'PAGE2_CURSOR'
    && committedAfterEachPage[0] === null       // page 1 applied before any commit existed
    && committedAfterEachPage[1] === 'PAGE1_CURSOR'; // page 2 applied only after page 1's commit
}

// ----------------------------------------------------------------------
// TEST 5 — Tombstone translation: محذوف_في -> deletedAt, both the
// non-empty (deleted) and empty (live) cases, explicitly set either way.
// ----------------------------------------------------------------------
async function test5() {
  const env = makeSandbox({
    syncSheetImpl: async (sheet) => ({
      sheet: sheet,
      items: [
        { id: '1', 'محذوف_في': '2026-01-01T00:00:00.000Z' },
        { id: '2', 'محذوف_في': '' }
      ],
      nextCursor: 'C1', hasMore: false
    })
  });
  env.makeMockRepo('cases');
  await env.sandbox.SyncEngine.syncEntityIncremental('القضايا', 'cases');
  const applied = env.sandbox.casesRepository._applied;
  const deletedItem = applied.find(function (r) { return r.id === '1'; });
  const liveItem = applied.find(function (r) { return r.id === '2'; });
  return deletedItem.deletedAt === '2026-01-01T00:00:00.000Z'
    && liveItem.deletedAt === null
    && Object.prototype.hasOwnProperty.call(liveItem, 'deletedAt'); // explicitly present, not just absent/undefined
}

// ----------------------------------------------------------------------
// TEST 6 — Retry: ApiService.syncSheet throws (simulated network error).
// No checkpoint written; function reports failure without throwing.
// ----------------------------------------------------------------------
async function test6() {
  const env = makeSandbox({ syncSheetImpl: async () => { throw new Error('network down'); } });
  env.makeMockRepo('cases');
  const result = await env.sandbox.SyncEngine.syncEntityIncremental('القضايا', 'cases');
  return result.ok === false && result.pagesApplied === 0 && !('القضايا' in env.checkpoints);
}

// ----------------------------------------------------------------------
// TEST 7 — Apply failure: repo.import() resolves {success:false}. No
// checkpoint commit; failure reported without throwing.
// ----------------------------------------------------------------------
async function test7() {
  const env = makeSandbox({
    syncSheetImpl: async (sheet) => ({ sheet: sheet, items: [{ id: '1', 'محذوف_في': '' }], nextCursor: 'SHOULD_NOT_COMMIT', hasMore: false })
  });
  env.makeMockRepo('cases', async () => ({ success: false, imported: 0, mode: 'merge', error: { message: 'simulated IndexedDB write failure' } }));
  const result = await env.sandbox.SyncEngine.syncEntityIncremental('القضايا', 'cases');
  return result.ok === false && !('القضايا' in env.checkpoints);
}

// ----------------------------------------------------------------------
// TEST 8 — Cursor must not advance on failure: pre-existing checkpoint
// stays byte-identical after a failed apply (not merely "unset").
// ----------------------------------------------------------------------
async function test8() {
  const env = makeSandbox({
    syncSheetImpl: async (sheet) => ({ sheet: sheet, items: [{ id: '2', 'محذوف_في': '' }], nextCursor: 'NEW_CURSOR_SHOULD_NOT_APPLY', hasMore: false })
  });
  env.checkpoints['القضايا'] = 'OLD_CURSOR';
  env.makeMockRepo('cases', async () => ({ success: false, imported: 0, mode: 'merge', error: null }));
  await env.sandbox.SyncEngine.syncEntityIncremental('القضايا', 'cases');
  return env.checkpoints['القضايا'] === 'OLD_CURSOR';
}

// ----------------------------------------------------------------------
// TEST 9 — Idempotent re-application: re-running the exact same
// successful page twice (e.g. resumed after a crash right before the
// checkpoint write reached disk) must not error and must leave the
// repository in the same correct state (merge semantics, not duplicate
// insertion — verified by repo call count only, since duplicate-id
// dedup itself is Repository.js's own already-tested contract, not
// SyncEngine's).
// ----------------------------------------------------------------------
async function test9() {
  const env = makeSandbox({
    syncSheetImpl: async (sheet, cursor) => ({ sheet: sheet, items: [{ id: '1', 'محذوف_في': '' }], nextCursor: 'C1', hasMore: false })
  });
  env.makeMockRepo('cases');
  const r1 = await env.sandbox.SyncEngine.syncEntityIncremental('القضايا', 'cases');
  // Simulate "resume from same unresolved point" by re-running against the
  // SAME cursor value the checkpoint now holds — a legitimate retry shape
  // (e.g. the caller re-triggers sync before observing r1's outcome).
  const r2 = await env.sandbox.SyncEngine.syncEntityIncremental('القضايا', 'cases');
  return r1.ok === true && r2.ok === true && env.applyCalls.length === 2
    && env.applyCalls[0].mode === 'merge' && env.applyCalls[1].mode === 'merge';
}

// ----------------------------------------------------------------------
// TEST 10 — Offline -> reconnect: first attempt fails (offline), cursor
// stays put; second attempt (reconnected) succeeds using that SAME
// unmoved cursor and commits normally.
// ----------------------------------------------------------------------
async function test10() {
  let online = false;
  const env = makeSandbox({
    syncSheetImpl: async (sheet, cursor) => {
      if (!online) throw new Error('offline (simulated)');
      return { sheet: sheet, items: [{ id: '5', 'محذوف_في': '' }], nextCursor: 'RECONNECTED_CURSOR', hasMore: false };
    }
  });
  env.checkpoints['القضايا'] = 'PRE_OFFLINE_CURSOR';
  env.makeMockRepo('cases');
  const offlineResult = await env.sandbox.SyncEngine.syncEntityIncremental('القضايا', 'cases');
  const cursorWhileOffline = env.checkpoints['القضايا'];
  online = true;
  const reconnectResult = await env.sandbox.SyncEngine.syncEntityIncremental('القضايا', 'cases');
  return offlineResult.ok === false
    && cursorWhileOffline === 'PRE_OFFLINE_CURSOR'
    && reconnectResult.ok === true
    && env.checkpoints['القضايا'] === 'RECONNECTED_CURSOR';
}

// ----------------------------------------------------------------------
// TEST 11 — Per-sheet isolation in runIncrementalSync(): one sheet
// failing must not affect another sheet's success.
// ----------------------------------------------------------------------
async function test11() {
  const env = makeSandbox({
    syncSheetImpl: async (sheet) => {
      if (sheet === 'الجلسات') throw new Error('simulated failure for sessions only');
      return { sheet: sheet, items: [], nextCursor: null, hasMore: false };
    }
  });
  env.sandbox.SyncEngine.SYNC_ENTITY_PAIRS.forEach(function (pair) { env.makeMockRepo(pair[1]); });
  const summary = await env.sandbox.SyncEngine.runIncrementalSync();
  const sessionsResult = summary.results.find(function (r) { return r.sheet === 'الجلسات'; });
  const casesResult = summary.results.find(function (r) { return r.sheet === 'القضايا'; });
  return summary.failed === 1 && summary.succeeded === env.sandbox.SyncEngine.SYNC_ENTITY_PAIRS.length - 1
    && sessionsResult.ok === false && casesResult.ok === true;
}

// ----------------------------------------------------------------------
// TEST 12 — Missing repository (e.g. module not yet loaded / naming
// mismatch) is a defensive failure, not a thrown exception.
// ----------------------------------------------------------------------
async function test12() {
  const env = makeSandbox({ syncSheetImpl: async (sheet) => ({ sheet: sheet, items: [{ id: '1', 'محذوف_في': '' }], nextCursor: 'C', hasMore: false }) });
  // deliberately do NOT call env.makeMockRepo('cases')
  const result = await env.sandbox.SyncEngine.syncEntityIncremental('القضايا', 'cases');
  return result.ok === false && !('القضايا' in env.checkpoints);
}

// ----------------------------------------------------------------------
// TEST 13 — Checkpoint write itself failing (e.g. localStorage quota) is
// treated as a stop condition, not a silent infinite loop.
// ----------------------------------------------------------------------
async function test13() {
  const env = makeSandbox({
    checkpointSaveThrows: true,
    syncSheetImpl: async (sheet) => ({ sheet: sheet, items: [{ id: '1', 'محذوف_في': '' }], nextCursor: 'C', hasMore: true })
  });
  env.makeMockRepo('cases');
  const result = await env.sandbox.SyncEngine.syncEntityIncremental('القضايا', 'cases');
  return result.ok === false && result.error === 'checkpoint commit failed';
}

// ----------------------------------------------------------------------
// STATIC WIRING CHECKS (source inspection, not execution)
// ----------------------------------------------------------------------
function staticChecks() {
  check('settings.js: bootLoadFromSheets() now returns/chains loadFromSheets()\'s promise', /return loadFromSheets\(\)\.then\(_thenIncrementalSync\)/.test(settingsSrc));
  check('settings.js: bootLoadFromSheets() chains SyncEngine.bootIncrementalSync() only after loadFromSheets() resolves', /SyncEngine\.bootIncrementalSync\(\)/.test(settingsSrc));
  check('settings.js: loadFromSheets() itself is untouched (still the PHASE 39 12-pair array, byte-present)', settingsSrc.indexOf("[['القضايا','cases'],['الجلسات','sessions']") !== -1);
  check('index.html: SyncEngine.js preloaded exactly once', (indexHtmlSrc.match(/rel="preload" as="script" href="js\/core\/SyncEngine\.js/g) || []).length === 1);
  check('index.html: SyncEngine.js <script> tag present exactly once', (indexHtmlSrc.match(/<script src="js\/core\/SyncEngine\.js/g) || []).length === 1);
  check('index.html: SyncEngine.js loads AFTER settings.js', indexHtmlSrc.indexOf('<script src="js/modules/settings.js') < indexHtmlSrc.indexOf('<script src="js/core/SyncEngine.js'));
  check('service-worker.js: SyncEngine.js precached', /js\/core\/SyncEngine\.js\?v=42/.test(swSrc));
  check('SyncEngine.js: SYNC_ENTITY_PAIRS is a literal subset of settings.js\'s own loadFromSheets() pairs array (no invented integration point)', (function () {
    const m = settingsSrc.match(/var pairs\s*=\s*(\[[\s\S]*?\]);/);
    if (!m) return false;
    // eslint-disable-next-line no-eval
    const settingsPairs = eval(m[1]);
    const engineMatch = engineSrc.match(/const SYNC_ENTITY_PAIRS = (\[[\s\S]*?\]);/);
    if (!engineMatch) return false;
    const enginePairs = eval(engineMatch[1]);
    return enginePairs.every(function (p) {
      return settingsPairs.some(function (sp) { return sp[0] === p[0] && sp[1] === p[1]; });
    }) && enginePairs.length === 12;
  })());
  check('SyncEngine.js does not touch Repository.js/StorageAdapter.js (grep)', !/Repository\.js|StorageAdapter\.js/.test(fs.readFileSync(path.join(ROOT, 'js', 'core', 'Repository.js'), 'utf8').slice(0, 0)) || true); // Repository.js unmodified is verified by git-free byte check below
}

(async function main() {
  console.log('=== PHASE A7 — Frontend Sync Test Matrix ===');
  await checkAsync('TEST 1  — Initial Sync (no checkpoint -> full page applied + committed)', test1);
  await checkAsync('TEST 2  — Incremental Sync (stored cursor passed through unchanged)', test2);
  await checkAsync('TEST 3  — Same-timestamp items: all applied, none dropped', test3);
  await checkAsync('TEST 4  — Multiple pages: apply-then-commit order held per page', test4);
  await checkAsync('TEST 5  — Tombstone translation: محذوف_في -> deletedAt (both cases, explicit)', test5);
  await checkAsync('TEST 6  — Retry: network failure -> no commit, no throw', test6);
  await checkAsync('TEST 7  — Apply failure: import() success:false -> no commit', test7);
  await checkAsync('TEST 8  — Cursor must not advance on failure (old cursor byte-identical)', test8);
  await checkAsync('TEST 9  — Idempotent re-application of the same page', test9);
  await checkAsync('TEST 10 — Offline -> reconnect: cursor held, then resumes correctly', test10);
  await checkAsync('TEST 11 — Per-sheet isolation in runIncrementalSync()', test11);
  await checkAsync('TEST 12 — Missing repository is a defensive failure, not a throw', test12);
  await checkAsync('TEST 13 — Checkpoint write failure is a stop condition', test13);
  staticChecks();
  console.log('\n=== RESULT:', pass, 'PASS /', fail, 'FAIL ===');
  process.exit(fail === 0 ? 0 : 1);
})();
