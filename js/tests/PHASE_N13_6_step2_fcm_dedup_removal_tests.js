/**
 * ================================================================
 * PHASE_N13_6_step2_fcm_dedup_removal_tests.js — نظام الحسام للمحاماة
 * ================================================================
 * PHASE N.13.6 STEP 2 — removes the application-level FCM event
 * suppression (Config/10_Fcm.gs shouldSendNow_() gated by
 * Config/00_Config.gs FCM_BATCH_WINDOW_SECONDS) that N.13.3/N.13.4
 * identified as silently collapsing independent business events into
 * a single notification.
 *
 * WHY THIS FILE EXISTS
 *   PHASE_N12/N13.2's FCM suites prove the sender builds correct
 *   messages FOR A GIVEN event, and prove device registration works.
 *   Neither proves that N INDEPENDENT successful business events (the
 *   actual production entry points: apiAddRow/apiUpdateRow/
 *   apiDeleteRow in Config/06_Api.gs) each reach the network — that is
 *   exactly what the old 25-second CacheService-backed suppression
 *   window could (and did) prevent for same-sheet/same-eventKind/
 *   same-variant events on DIFFERENT records. This suite drives the
 *   REAL, unmodified-except-for-STEP-2 Config/*.gs sources through the
 *   real public doPost() entry point — the same path the frontend
 *   Repository layer uses — and counts actual outbound FCM HTTP v1
 *   requests.
 *
 * WHAT IS MOCKED (and only this — identical harness to
 *   PHASE_N13_2_fcm_registration_e2e_tests.js): the Sheet grid,
 *   PropertiesService, CacheService (instrumented — see below),
 *   LockService, ContentService, UrlFetchApp, Utilities, Logger,
 *   ensureSetup/openSpreadsheet/setupSheets (01_Database.gs
 *   infrastructure, not under test in this file).
 *
 * CACHE INSTRUMENTATION
 *   CacheService.getScriptCache() here is wrapped to additionally log
 *   every get/put/remove call whose key starts with the real
 *   FCM_BATCH_CACHE_PREFIX ('FCM_BATCH_') into env.batchCacheOps, so
 *   Test 6 can assert a literal ZERO dedup-purpose cache touches when
 *   FCM_BATCH_WINDOW_SECONDS<=0 — not just "the count of sends looked
 *   right", but that the suppression PATH itself is provably unused.
 *
 * SCOPE — this file tests ONLY the dedup/suppression gate in
 * Config/10_Fcm.gs and the FCM_BATCH_WINDOW_SECONDS constant in
 * Config/00_Config.gs. It does not test or claim anything about real
 * Firebase delivery, real Android behavior, or device-level duplicate
 * push handling — see PHASE N.13.6's report §19 for that distinction.
 *
 * Run: node js/tests/PHASE_N13_6_step2_fcm_dedup_removal_tests.js
 * ================================================================
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..', '..');
function read(rel) { return fs.readFileSync(path.join(ROOT, rel), 'utf8'); }

/**
 * `const`/`let` top-level declarations inside a vm.runInContext'd script
 * live in that context's own lexical environment and are NEITHER visible
 * NOR settable as properties on the sandbox object from outside (a
 * documented Node vm quirk — only `var`/function declarations attach to
 * the global object). Reading FCM_BATCH_WINDOW_SECONDS or
 * shouldSendNow_'s view of it therefore requires evaluating an
 * expression INSIDE the same context, not touching env.ctx.NAME
 * directly.
 */
function evalInBackend(env, expr) { return vm.runInContext(expr, env.ctx); }

let passed = 0, failed = 0;
function check(label, fn) {
  try { fn(); passed++; console.log('PASS - ' + label); }
  catch (e) { failed++; console.log('FAIL - ' + label + '  =>  ' + e.message); }
}

// ------------------------------------------------------------------
// In-memory Sheet (identical to PHASE_N13_2_fcm_registration_e2e_tests.js)
// ------------------------------------------------------------------
function makeSheet(headers) {
  const grid = [headers.slice()];
  const sheet = {
    _grid: grid,
    getLastRow: function () { return grid.length; },
    getLastColumn: function () { return grid[0] ? grid[0].length : 0; },
    getDataRange: function () {
      return { getValues: function () { return grid.map(function (r) { return r.slice(); }); } };
    },
    getRange: function (row, col, numRows, numCols) {
      numRows = numRows || 1; numCols = numCols || 1;
      const rng = {
        getValues: function () {
          const out = [];
          for (let r = 0; r < numRows; r++) {
            const gr = grid[(row - 1) + r] || [];
            const o = [];
            for (let c = 0; c < numCols; c++) o.push(gr[(col - 1) + c] !== undefined ? gr[(col - 1) + c] : '');
            out.push(o);
          }
          return out;
        },
        getValue: function () { const gr = grid[row - 1] || []; return gr[col - 1] !== undefined ? gr[col - 1] : ''; },
        setValues: function (values) {
          for (let r = 0; r < values.length; r++) {
            while (grid.length <= (row - 1) + r) grid.push([]);
            for (let c = 0; c < values[r].length; c++) grid[(row - 1) + r][(col - 1) + c] = values[r][c];
          }
          return rng;
        },
        setValue: function (v) { while (grid.length <= row - 1) grid.push([]); grid[row - 1][col - 1] = v; return rng; },
        setNumberFormat: function () { return rng; },
        setBackground: function () { return rng; },
        setFontColor: function () { return rng; },
        setFontWeight: function () { return rng; },
        setHorizontalAlignment: function () { return rng; }
      };
      return rng;
    },
    setFrozenRows: function () {},
    deleteRow: function (row) { grid.splice(row - 1, 1); }
  };
  return sheet;
}

// ------------------------------------------------------------------
// Real Config/*.gs loaded into a vm context (same set as N.13.2 e2e)
// ------------------------------------------------------------------
function loadBackend(opts) {
  opts = opts || {};
  const logs = [];
  const fetchCalls = [];
  const props = {};
  if (opts.serviceAccount !== false) {
    props['FCM_SERVICE_ACCOUNT_JSON'] = JSON.stringify({ client_email: 'sa@hossammohamedlawyer-499ea.iam.gserviceaccount.com', private_key: 'SECRET-PRIVATE-KEY-DO-NOT-LEAK', project_id: 'hossammohamedlawyer-499ea' });
  }
  const rawCacheStore = {};
  const batchCacheOps = []; // {op:'get'|'put'|'remove', key} — ONLY for FCM_BATCH_ prefixed keys
  const sheets = {};

  const sandbox = {
    console: console,
    Logger: { log: function (m) { logs.push(String(m)); } },
    PropertiesService: { getScriptProperties: function () { return {
      getProperty: function (k) { return Object.prototype.hasOwnProperty.call(props, k) ? props[k] : null; },
      setProperty: function (k, v) { props[k] = v; }
    }; } },
    CacheService: { getScriptCache: function () { return {
      get: function (k) {
        if (String(k).indexOf('FCM_BATCH_') === 0) batchCacheOps.push({ op: 'get', key: k });
        return Object.prototype.hasOwnProperty.call(rawCacheStore, k) ? rawCacheStore[k] : null;
      },
      put: function (k, v, ttl) {
        if (String(k).indexOf('FCM_BATCH_') === 0) batchCacheOps.push({ op: 'put', key: k, ttl: ttl });
        rawCacheStore[k] = v;
      },
      remove: function (k) {
        if (String(k).indexOf('FCM_BATCH_') === 0) batchCacheOps.push({ op: 'remove', key: k });
        delete rawCacheStore[k];
      }
    }; } },
    LockService: { getScriptLock: function () { return { waitLock: function () {}, releaseLock: function () {} }; } },
    ContentService: {
      MimeType: { JSON: 'JSON' },
      createTextOutput: function (s) { return { _s: s, setMimeType: function () { return this; }, getContent: function () { return this._s; } }; }
    },
    Utilities: {
      getUuid: (function () { let n = 0; return function () { return 'uuid-' + (++n); }; })(),
      newBlob: function (s) { return { getBytes: function () { return Array.from(Buffer.from(String(s))); } }; },
      base64EncodeWebSafe: function (b) { return Buffer.from(b).toString('base64').replace(/\+/g, '-').replace(/\//g, '_'); },
      computeRsaSha256Signature: function () { return [1, 2, 3]; }
    },
    UrlFetchApp: { fetch: function (url, o) {
      fetchCalls.push({ url: url, options: o });
      if (String(url).indexOf('oauth2.googleapis.com') !== -1) {
        return { getResponseCode: function () { return 200; }, getContentText: function () { return JSON.stringify({ access_token: 'AT-1' }); } };
      }
      if (opts.fcmSendImpl) return opts.fcmSendImpl(url, o, fetchCalls.length);
      return { getResponseCode: function () { return 200; }, getContentText: function () { return '{}'; } };
    } },
    // --- infrastructure normally provided by 01_Database.gs (not under test)
    ensureSetup: function () {},
    setupSheets: function () {},
    openSpreadsheet: function () {
      return { getSheetByName: function (n) { return sheets[n] || null; }, getId: function () { return 'ss'; }, getUrl: function () { return 'u'; } };
    },
    addToCalendar: function () { return ''; },
    updateCalendarEvent: function (o) { return o || ''; },
    deleteCalendarEvent: function () {}
  };
  sandbox.global = sandbox;
  const ctx = vm.createContext(sandbox);
  ['00_Config', '08_Utils', '09_License', '11_Auth', '06_Api', '10_Fcm'].forEach(function (f) {
    var src = read('Config/' + f + '.gs');
    // TEST-TIME-ONLY source substitution (the real Config/00_Config.gs on
    // disk is never touched) — used solely by the rollback-guard test
    // (Group 9) to prove that restoring a POSITIVE window value brings
    // back the exact old suppression behavior, without needing to edit
    // (or re-edit) the actual project file for that one assertion.
    if (f === '00_Config' && opts.overrideBatchWindowSeconds !== undefined) {
      var needle = 'const FCM_BATCH_WINDOW_SECONDS = 0;';
      var occurrences = src.split(needle).length - 1;
      if (occurrences !== 1) throw new Error('expected exactly one occurrence of \'' + needle + '\' in 00_Config.gs, found ' + occurrences + ' — source may have changed');
      src = src.replace(needle, 'const FCM_BATCH_WINDOW_SECONDS = ' + opts.overrideBatchWindowSeconds + ';');
    }
    vm.runInContext(src, ctx, { filename: f + '.gs' });
  });

  vm.runInContext('SHEET_DEFS.forEach(function (d) { __mk(d.name, d.headers); });', Object.assign(ctx, {
    __mk: function (name, headers) { sheets[name] = makeSheet(headers); }
  }));

  if (opts.authenticated !== false) {
    ctx._authenticateInstallation_ = function () { return { state: 'authenticated', installationId: 'test-inst' }; };
  }
  return { ctx: ctx, logs: logs, fetchCalls: fetchCalls, sheets: sheets, props: props, rawCacheStore: rawCacheStore, batchCacheOps: batchCacheOps };
}

function post(env, body) {
  const out = env.ctx.doPost({ postData: { contents: JSON.stringify(body) } });
  return JSON.parse(out.getContent());
}

function registerDevice(env, token, extra) {
  const now = new Date().toISOString();
  return post(env, {
    action: 'add', sheet: 'أجهزة_FCM',
    data: Object.assign({ id: token, token: token, device_label: 'UA', created_at: now, updated_at: now, status: 'active', project_id: 'hossam_02' }, extra || {})
  });
}

function fcmSends(env) {
  return env.fetchCalls.filter(function (c) { return String(c.url).indexOf('fcm.googleapis.com') !== -1; });
}

function addCase(env, num, status) {
  return post(env, { action: 'add', sheet: 'القضايا', data: { 'رقم_القضية': num, 'عنوان_القضية': 'قضية ' + num, 'الحالة': status || 'نشطة' } });
}
/** A "critical" update per computeUpdateChangeContext_: الحالة actually changes. */
function updateCaseStatus(env, num, newStatus) {
  return post(env, { action: 'update', sheet: 'القضايا', rowIndex: 1, data: { 'رقم_القضية': num, 'عنوان_القضية': 'قضية ' + num, 'الحالة': newStatus } });
}
function deleteCase(env, num) {
  return post(env, { action: 'delete', sheet: 'القضايا', rowIndex: 1, id: num });
}

// ==================================================================
// Group 0 — pre-audit assertions confirmed on THIS loaded source
// (not assumed from any prior report)
// ==================================================================
{
  const env = loadBackend();
  check('G0.1 FCM_BATCH_WINDOW_SECONDS === 0 (STEP 2 disables suppression by default)', () => {
    assert.strictEqual(evalInBackend(env, 'FCM_BATCH_WINDOW_SECONDS'), 0);
  });
  check('G0.2 shouldSendNow_() itself also refuses to touch CacheService when window<=0 (defense in depth)', () => {
    env.ctx.CacheService.getScriptCache(); // warm, no-op
    const before = env.batchCacheOps.length;
    const r = env.ctx.shouldSendNow_('some::direct::call');
    assert.strictEqual(r, true);
    assert.strictEqual(env.batchCacheOps.length, before, 'shouldSendNow_ must not touch CacheService when disabled');
  });
}

// ==================================================================
// TEST 1 — RAPID SAME RECORD: 3 independent UPDATE events on the SAME
// case, all within the same synchronous burst (< 25s), must all send.
// ==================================================================
{
  const env = loadBackend();
  registerDevice(env, 'TOKEN-A');
  addCase(env, 'C-1', 'جديدة'); // a DISTINCT 'add' event — correctly sends its own notification too
  updateCaseStatus(env, 'C-1', 'قيد النظر');
  updateCaseStatus(env, 'C-1', 'مؤجلة');
  updateCaseStatus(env, 'C-1', 'منتهية');
  check('TEST 1 (rapid same record): 3 independent status-changing UPDATEs on the SAME case => 3 update-sends (not 1)', () => {
    const updates = fcmSends(env).filter(c => JSON.parse(c.options.payload).message.data.entityAction === 'update');
    assert.strictEqual(updates.length, 3, 'got ' + updates.length + ' update sends out of ' + fcmSends(env).length + ' total');
  });
  check('TEST 1b: the initial add on the same record was ALSO independently sent (4 events total, not fewer)', () => {
    assert.strictEqual(fcmSends(env).length, 4);
  });
}

// ==================================================================
// TEST 2 — DIFFERENT RECORDS: same sheet, same eventKind, same variant
// (the EXACT collision the old batchKey — sheet::eventKind::variant,
// with no entityId — used to produce). Root cause regression guard.
// ==================================================================
{
  const env = loadBackend();
  registerDevice(env, 'TOKEN-A');
  addCase(env, 'C-1', 'جديدة'); addCase(env, 'C-2', 'جديدة'); addCase(env, 'C-3', 'جديدة');
  check('TEST 2 (different records): Case A/B/C add — identical sheet+eventKind+variant => 3 sends (root cause fixed)', () => {
    assert.strictEqual(fcmSends(env).length, 3);
    const entityIds = fcmSends(env).map(c => JSON.parse(c.options.payload).message.data.entityId);
    assert.deepStrictEqual(entityIds, ['C-1', 'C-2', 'C-3'], 'each send must carry its own record identity');
  });
}

// ==================================================================
// TEST 3 — DIFFERENT EVENT TYPES on the same entity: add, update, delete
// ==================================================================
{
  const env = loadBackend();
  registerDevice(env, 'TOKEN-A');
  addCase(env, 'C-1', 'جديدة');
  updateCaseStatus(env, 'C-1', 'قيد النظر');
  deleteCase(env, 'C-1');
  check('TEST 3 (different event types): add + update + delete on the same case => 3 sends', () => {
    assert.strictEqual(fcmSends(env).length, 3);
    const actions = fcmSends(env).map(c => JSON.parse(c.options.payload).message.data.entityAction);
    assert.deepStrictEqual(actions, ['add', 'update', 'delete']);
  });
}

// ==================================================================
// TEST 4 — DIFFERENT ENTITIES: case add, session add, task add
// ==================================================================
{
  const env = loadBackend();
  registerDevice(env, 'TOKEN-A');
  addCase(env, 'C-1', 'جديدة');
  post(env, { action: 'add', sheet: 'الجلسات', data: { 'رقم_الجلسة': 'S-1', 'رقم_القضية': 'C-1' } });
  post(env, { action: 'add', sheet: 'الأعمال الإدارية', data: { 'رقم_المهمة': 'T-1', 'العنوان': 'مهمة' } });
  check('TEST 4 (different entities): case add + session add + task add => 3 sends', () => {
    assert.strictEqual(fcmSends(env).length, 3);
    const types = fcmSends(env).map(c => JSON.parse(c.options.payload).message.data.entityType);
    assert.deepStrictEqual(types, ['القضايا', 'الجلسات', 'الأعمال الإدارية']);
  });
}

// ==================================================================
// TEST 5 — FAILURE MUST NOT SUPPRESS THE NEXT EVENT. Two independent
// mechanisms both prove this: (a) even in the OLD suppression design,
// the cache mark was written unconditionally BEFORE any network call
// (so failure was already irrelevant to it) — but with STEP 2 the
// question is moot because no cache mark exists at all; (b) a genuine
// network-level failure (UrlFetchApp throws) for event A's send must
// not prevent event B's independent attempt.
// ==================================================================
{
  const env = loadBackend({
    fcmSendImpl: function (url, o, callNum) {
      // Fail every FCM send whose payload is for case C-1 (event A); succeed for others.
      const body = JSON.parse(o.payload);
      if (body.message && body.message.data && body.message.data.entityId === 'C-1') {
        throw new Error('simulated network failure for event A');
      }
      return { getResponseCode: function () { return 200; }, getContentText: function () { return '{}'; } };
    }
  });
  registerDevice(env, 'TOKEN-A');
  addCase(env, 'C-1', 'جديدة'); // event A — its send will throw inside sendFcmToSingleToken_
  addCase(env, 'C-2', 'جديدة'); // event B — independent, must still be attempted
  check('TEST 5 (failed send does not suppress next event): both A and B were attempted; B reached the network', () => {
    // sendFcmToSingleToken_ catches its own UrlFetchApp errors (fire-and-forget,
    // §Golden Rule at the top of 10_Fcm.gs) — so the ATTEMPT for A still counts
    // as a fetchCalls entry (it was reached, it just threw inside the try/catch).
    const allFcm = fcmSends(env);
    assert.strictEqual(allFcm.length, 2, 'both A and B must have reached the network layer, got ' + allFcm.length);
    const bEntry = allFcm.filter(c => JSON.parse(c.options.payload).message.data.entityId === 'C-2');
    assert.strictEqual(bEntry.length, 1, 'event B must have been sent regardless of event A failing');
  });
  check('TEST 5b: the case data itself was saved for BOTH A and B regardless of the notification failure (Golden Rule preserved)', () => {
    assert.strictEqual(env.sheets['القضايا']._grid.length, 3); // header + 2 rows
  });
}

// ==================================================================
// TEST 6 — CACHE MUST NOT BE TOUCHED WHEN WINDOW = 0
// ==================================================================
{
  const env = loadBackend();
  registerDevice(env, 'TOKEN-A');
  addCase(env, 'C-1', 'جديدة');
  updateCaseStatus(env, 'C-1', 'قيد النظر');
  deleteCase(env, 'C-1');
  addCase(env, 'C-2', 'جديدة');
  addCase(env, 'C-3', 'جديدة');
  check('TEST 6 (cache untouched): zero CacheService.get/put/remove calls with the FCM_BATCH_ prefix across 5 events', () => {
    assert.strictEqual(env.batchCacheOps.length, 0, 'batchCacheOps=' + JSON.stringify(env.batchCacheOps));
    assert.strictEqual(fcmSends(env).length, 5);
  });
}

// ==================================================================
// TEST 7 — "CONCURRENT" SENDERS. Apps Script's execution model runs
// each doPost() to completion synchronously (there is no true
// interleaving within one V8 isolate) — see PHASE N.13.4 §8 Q11 for
// the same acknowledgment re: CacheService atomicity. What this test
// actually proves, precisely: four independent events submitted back
// to back with no artificial delay between them (the closest
// achievable approximation of "near-simultaneous" in this execution
// model) all independently reach the network — i.e. there is no
// shared, request-spanning state left in Config/10_Fcm.gs (like the
// old cache-backed window) that a tight sequence of calls could still
// collide on.
// ==================================================================
{
  const env = loadBackend();
  registerDevice(env, 'TOKEN-A');
  ['C-A', 'C-B', 'C-C', 'C-D'].forEach(n => addCase(env, n, 'جديدة'));
  check('TEST 7 (back-to-back "concurrent" events): A, B, C, D all independently reach the network, no collision', () => {
    assert.strictEqual(fcmSends(env).length, 4);
    const ids = fcmSends(env).map(c => JSON.parse(c.options.payload).message.data.entityId);
    assert.deepStrictEqual(ids, ['C-A', 'C-B', 'C-C', 'C-D']);
  });
}

// ==================================================================
// TEST 8 — NO ACCIDENTAL BATCHING: 10 independent events => 10 sends
// ==================================================================
{
  const env = loadBackend();
  registerDevice(env, 'TOKEN-A');
  for (let i = 1; i <= 10; i++) addCase(env, 'C-' + i, 'جديدة');
  check('TEST 8 (10-event storm): exactly 10 independent sends, not fewer', () => {
    assert.strictEqual(fcmSends(env).length, 10, 'got ' + fcmSends(env).length);
  });
}

// ==================================================================
// Group 9 — ROLLBACK GUARD: if FCM_BATCH_WINDOW_SECONDS is ever set
// back to a positive value (operator decision, not this phase's), the
// OLD suppression semantics must resume EXACTLY as before, proving the
// STEP 2 guard (`FCM_BATCH_WINDOW_SECONDS > 0 && !shouldSendNow_(...)`)
// is a true on/off switch and not a one-way change.
// ==================================================================
{
  // Reverting the constant is simulated by a TEST-TIME-ONLY source
  // substitution inside loadBackend() (see its definition above) — the
  // real Config/00_Config.gs on disk is never edited for this. This
  // proves the STEP 2 guard is a true on/off switch, not a one-way change.
  const env = loadBackend({ overrideBatchWindowSeconds: 25 });
  check('G9.0 sanity: the override actually took effect inside this backend instance', () => {
    assert.strictEqual(evalInBackend(env, 'FCM_BATCH_WINDOW_SECONDS'), 25);
  });
  registerDevice(env, 'TOKEN-A');
  addCase(env, 'C-1', 'جديدة');
  addCase(env, 'C-2', 'جديدة'); // same sheet+eventKind+variant, within the (restored) 25s window
  check('G9.1 rollback guard: with FCM_BATCH_WINDOW_SECONDS restored to 25, OLD suppression behavior returns unchanged (B collapses)', () => {
    assert.strictEqual(fcmSends(env).length, 1, 'expected the OLD suppression to collapse B, got ' + fcmSends(env).length);
  });
  check('G9.2 rollback guard: CacheService IS touched again once suppression is re-enabled', () => {
    assert.ok(env.batchCacheOps.length > 0, 'batchCacheOps=' + JSON.stringify(env.batchCacheOps));
  });
}

console.log('\nPHASE N.13.6 STEP 2 dedup removal: ' + passed + ' PASS / ' + failed + ' FAIL');
process.exit(failed ? 1 : 0);
