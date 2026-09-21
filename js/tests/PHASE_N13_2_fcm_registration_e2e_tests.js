/**
 * ================================================================
 * PHASE_N13_2_fcm_registration_e2e_tests.js — نظام الحسام للمحاماة
 * ================================================================
 * PHASE N.13.2 — FCM registration / Restricted-Sheet regression.
 *
 * WHY THIS FILE EXISTS
 *   PHASE_A8 / PHASE_N12 prove that "IF a valid token exists in
 *   أجهزة_FCM, the server builds the right message". Neither proves
 *   that a device can actually GET its token into أجهزة_FCM through the
 *   real public entry point after PHASE E.1 introduced Restricted
 *   Sheets. This suite closes that gap by executing the REAL, unmodified
 *   Config/*.gs sources (00,06,08,09,10,11) inside a vm context with
 *   in-memory Apps Script service mocks, and driving them ONLY through
 *   the real public entry point doPost() — exactly the request that
 *   js/core/pwa/NotificationManager.js -> ApiService.saveData() sends.
 *
 * WHAT IS MOCKED (and only this): SpreadsheetApp-equivalent sheet grid,
 *   PropertiesService, CacheService, LockService, ContentService,
 *   UrlFetchApp, Utilities, Logger, ensureSetup/openSpreadsheet/
 *   setupSheets (01_Database.gs — infrastructure, not under test).
 *
 * Run: node js/tests/PHASE_N13_2_fcm_registration_e2e_tests.js
 * ================================================================
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..', '..');
function read(rel) { return fs.readFileSync(path.join(ROOT, rel), 'utf8'); }

let passed = 0, failed = 0;
function check(label, fn) {
  try { fn(); passed++; console.log('PASS - ' + label); }
  catch (e) { failed++; console.log('FAIL - ' + label + '  =>  ' + e.message); }
}

// ------------------------------------------------------------------
// In-memory Sheet
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
// Real Config/*.gs loaded into a vm context
// ------------------------------------------------------------------
function loadBackend(opts) {
  opts = opts || {};
  const logs = [];
  const fetchCalls = [];
  const props = {};
  if (opts.serviceAccount !== false) {
    props['FCM_SERVICE_ACCOUNT_JSON'] = JSON.stringify({ client_email: 'sa@hossammohamedlawyer-499ea.iam.gserviceaccount.com', private_key: 'SECRET-PRIVATE-KEY-DO-NOT-LEAK', project_id: 'hossammohamedlawyer-499ea' });
  }
  const cacheStore = {};
  const sheets = {};

  const sandbox = {
    console: console,
    Logger: { log: function (m) { logs.push(String(m)); } },
    PropertiesService: { getScriptProperties: function () { return {
      getProperty: function (k) { return Object.prototype.hasOwnProperty.call(props, k) ? props[k] : null; },
      setProperty: function (k, v) { props[k] = v; }
    }; } },
    CacheService: { getScriptCache: function () { return {
      get: function (k) { return Object.prototype.hasOwnProperty.call(cacheStore, k) ? cacheStore[k] : null; },
      put: function (k, v) { cacheStore[k] = v; },
      remove: function (k) { delete cacheStore[k]; }
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
    vm.runInContext(read('Config/' + f + '.gs'), ctx, { filename: f + '.gs' });
  });

  // Create every business sheet with its real SHEET_DEFS headers (what
  // setupSheets() would do) so the real handlers run against real schemas.
  vm.runInContext('SHEET_DEFS.forEach(function (d) { __mk(d.name, d.headers); });', Object.assign(ctx, {
    __mk: function (name, headers) { sheets[name] = makeSheet(headers); }
  }));

  if (opts.authenticated !== false) {
    // Isolate the gate under test from installation-credential storage,
    // which is orthogonal to the Restricted-Sheet question.
    ctx._authenticateInstallation_ = function () { return { state: 'authenticated', installationId: 'test-inst' }; };
  }
  return { ctx: ctx, logs: logs, fetchCalls: fetchCalls, sheets: sheets, props: props, cacheStore: cacheStore };
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

// ==================================================================
// Group 1 — the Restricted-Sheet guard must NOT block device registration
// ==================================================================
{
  const env = loadBackend();

  check('G1.1 _getRestrictedSheetNames_() does not contain أجهزة_FCM (registration path must stay open)', () => {
    const list = vm.runInContext('_getRestrictedSheetNames_()', env.ctx);
    assert.ok(list.indexOf('أجهزة_FCM') === -1, 'أجهزة_FCM must not be a restricted sheet: ' + list.join(','));
  });

  check('G1.2 the guard is still live for the real infrastructure sheets (التثبيتات rejected via doPost add)', () => {
    const r = post(env, { action: 'add', sheet: 'التثبيتات', data: { installationId: 'x' } });
    assert.strictEqual(r.error, 'RESTRICTED_SHEET');
  });

  check('G1.3 doPost add on أجهزة_FCM (the exact request NotificationManager sends) succeeds', () => {
    const r = registerDevice(env, 'TOKEN-A');
    assert.strictEqual(r.status, 'ok', JSON.stringify(r));
    assert.notStrictEqual(r.error, 'RESTRICTED_SHEET');
  });

  check('G1.4 the token row is physically written with status=active in أجهزة_FCM', () => {
    const g = env.sheets['أجهزة_FCM']._grid;
    assert.strictEqual(g.length, 2);
    const h = g[0];
    assert.strictEqual(g[1][h.indexOf('token')], 'TOKEN-A');
    assert.strictEqual(g[1][h.indexOf('status')], 'active');
  });

  check('G1.5 getActiveFcmTokens_() (what the sender reads) returns the registered token', () => {
    const t = vm.runInContext('getActiveFcmTokens_()', env.ctx);
    assert.deepStrictEqual(Array.from(t), ['TOKEN-A']);
  });

  check('G1.6 registering the same token again is idempotent (still one row)', () => {
    const r = registerDevice(env, 'TOKEN-A');
    assert.strictEqual(r.status, 'ok');
    assert.strictEqual(env.sheets['أجهزة_FCM']._grid.length, 2);
  });

  check('G1.7 registering an unchanged token never triggers a push (registration is not a business event)', () => {
    assert.strictEqual(fcmSends(env).length, 0);
  });

  check('G1.8 a token previously marked expired is re-activated when the device registers again', () => {
    vm.runInContext('markFcmTokenExpired_("TOKEN-A")', env.ctx);
    const g = env.sheets['أجهزة_FCM']._grid;
    assert.strictEqual(g[1][g[0].indexOf('status')], 'expired');
    registerDevice(env, 'TOKEN-A');
    assert.strictEqual(g[1][g[0].indexOf('status')], 'active');
  });
}

// ==================================================================
// Group 2 — fan-out: a registered device really receives add/update/delete
// ==================================================================
{
  const env = loadBackend();
  registerDevice(env, 'TOKEN-A');
  registerDevice(env, 'TOKEN-B');

  const caseRow = { 'رقم_القضية': 'C-1', 'عنوان_القضية': 'قضية' };

  check('G2.1 add on القضايا sends one FCM v1 request per registered device', () => {
    const r = post(env, { action: 'add', sheet: 'القضايا', data: caseRow });
    assert.strictEqual(r.status, 'ok');
    const sends = fcmSends(env);
    assert.strictEqual(sends.length, 2, 'expected 2 sends, got ' + sends.length + ' logs=' + env.logs.join(' | '));
    const tokens = sends.map(function (c) { return JSON.parse(c.options.payload).message.token; }).sort();
    assert.deepStrictEqual(tokens, ['TOKEN-A', 'TOKEN-B']);
  });

  check('G2.2 the message carries the notification title/body and nested data.page/projectId the SW relies on', () => {
    const m = JSON.parse(fcmSends(env)[0].options.payload).message;
    assert.strictEqual(m.notification.title, 'قضية جديدة');
    assert.strictEqual(m.data.page, 'cases');
    assert.strictEqual(m.data.projectId, 'hossam_02');
    assert.strictEqual(m.data.entityAction, 'add');
    assert.strictEqual(fcmSends(env)[0].options.headers.Authorization, 'Bearer AT-1');
  });
}

// ==================================================================
// Group 3 — failure modes are observable in the log (silent to the user
// by design, but must never be silent to a maintainer)
// ==================================================================
{
  const env = loadBackend({ serviceAccount: false });
  registerDevice(env, 'TOKEN-A');
  post(env, { action: 'add', sheet: 'القضايا', data: { 'رقم_القضية': 'C-9', 'عنوان_القضية': 'x' } });

  check('G3.1 missing FCM_SERVICE_ACCOUNT_JSON: the case is still saved, no push is attempted, cause is logged', () => {
    assert.strictEqual(env.sheets['القضايا']._grid.length, 2, 'business write must still succeed');
    assert.strictEqual(fcmSends(env).length, 0);
    assert.ok(env.logs.some(function (l) { return l.indexOf('FCM_SERVICE_ACCOUNT_JSON') !== -1; }), 'expected the missing-property cause in the log');
  });
}

// ==================================================================
// Group 4 — installation-credential gate applies to FCM registration
// exactly as to every other write (documented, not changed here)
// ==================================================================
{
  const env = loadBackend({ authenticated: false });
  check('G4.1 (Fail-Closed) a device with no installation credential cannot register a token — same AUTH_FAILED as any other write', () => {
    const r = registerDevice(env, 'TOKEN-Z');
    assert.strictEqual(r.error, 'AUTH_FAILED');
    assert.strictEqual(r.authCode, 'AUTH_MISSING_CREDENTIAL');
    assert.strictEqual(env.sheets['أجهزة_FCM']._grid.length, 1);
  });
}


// ==================================================================
// Group 5 — read-only diagnostics (run manually from the Apps Script
// editor; never reachable through doGet/doPost)
// ==================================================================
{
  const env = loadBackend();
  registerDevice(env, 'TOKEN-AAAAAA111111');
  registerDevice(env, 'TOKEN-BBBBBB222222', { status: 'expired' });
  const rep = vm.runInContext('diagnoseFcmSetup()', env.ctx);
  const byName = function (frag) { return rep.checks.filter(function (c) { return c.name.indexOf(frag) !== -1; })[0]; };

  check('G5.1 diagnoseFcmSetup(): healthy setup => ok, every check passes', () => {
    assert.strictEqual(rep.ok, true, JSON.stringify(rep.checks.filter(function (c) { return !c.pass; })));
    assert.ok(rep.checks.length >= 6);
  });

  check('G5.2 it counts active vs expired devices correctly', () => {
    assert.ok(/active=1/.test(byName('أجهزة').detail) && /expired=1/.test(byName('أجهزة').detail), byName('أجهزة').detail);
  });

  check('G5.3 it really performs a fresh OAuth exchange (bypassing the cached token)', () => {
    env.ctx.CacheService.getScriptCache().put('FCM_ACCESS_TOKEN_CACHE', 'STALE');
    env.fetchCalls.length = 0;
    vm.runInContext('diagnoseFcmSetup()', env.ctx);
    assert.ok(env.fetchCalls.some(function (c) { return String(c.url).indexOf('oauth2.googleapis.com') !== -1; }));
  });

  check('G5.4 no secret (private key, full tokens) ever appears in the report or the log', () => {
    const blob = JSON.stringify(rep) + env.logs.join('\n');
    assert.ok(blob.indexOf('SECRET-PRIVATE-KEY-DO-NOT-LEAK') === -1);
    assert.ok(blob.indexOf('TOKEN-AAAAAA111111') === -1, 'full token leaked');
  });

  check('G5.5 it never sends a push and never modifies any sheet', () => {
    assert.strictEqual(fcmSends(env).length, 0);
    assert.strictEqual(env.sheets['أجهزة_FCM']._grid.length, 3);
  });

  const bad = loadBackend({ serviceAccount: false });
  const badRep = vm.runInContext('diagnoseFcmSetup()', bad.ctx);
  check('G5.6 missing FCM_SERVICE_ACCOUNT_JSON => ok=false and the failing check names the cause', () => {
    assert.strictEqual(badRep.ok, false);
    const f = badRep.checks.filter(function (c) { return !c.pass; }).map(function (c) { return c.name; }).join(' | ');
    assert.ok(f.indexOf('FCM_SERVICE_ACCOUNT_JSON') !== -1, f);
  });

  const wrongProj = loadBackend();
  wrongProj.props['FCM_SERVICE_ACCOUNT_JSON'] = JSON.stringify({ client_email: 'a@other.iam', private_key: 'k', project_id: 'some-other-project' });
  const wpRep = vm.runInContext('diagnoseFcmSetup()', wrongProj.ctx);
  check('G5.7 a service account from a DIFFERENT Firebase project is flagged', () => {
    assert.strictEqual(wpRep.ok, false);
    assert.ok(wpRep.checks.some(function (c) { return !c.pass && c.name.indexOf('نفس مشروع') !== -1; }));
  });

  const noDev = loadBackend();
  const ndRep = vm.runInContext('diagnoseFcmSetup()', noDev.ctx);
  check('G5.8 zero registered devices => ok=false (the exact "nobody to notify" state)', () => {
    assert.strictEqual(ndRep.ok, false);
    assert.ok(ndRep.checks.some(function (c) { return !c.pass && c.name.indexOf('أجهزة') !== -1; }));
  });

  const t = loadBackend();
  registerDevice(t, 'TOKEN-OK-000001'); registerDevice(t, 'TOKEN-GONE-00002');
  t.ctx.UrlFetchApp.fetch = function (url, o) {
    t.fetchCalls.push({ url: url, options: o });
    if (String(url).indexOf('oauth2') !== -1) return { getResponseCode: function () { return 200; }, getContentText: function () { return JSON.stringify({ access_token: 'AT' }); } };
    const tok = JSON.parse(o.payload).message.token;
    if (tok === 'TOKEN-GONE-00002') return { getResponseCode: function () { return 404; }, getContentText: function () { return '{"error":{"status":"NOT_FOUND"}}'; } };
    return { getResponseCode: function () { return 200; }, getContentText: function () { return '{}'; } };
  };
  const res = vm.runInContext('sendFcmDiagnosticTest()', t.ctx);
  check('G5.9 sendFcmDiagnosticTest(): one push per active device, per-device HTTP code reported, tokens masked', () => {
    assert.strictEqual(res.results.length, 2);
    assert.deepStrictEqual(Array.from(res.results).map(function (r) { return r.code; }).sort(), [200, 404]);
    assert.ok(JSON.stringify(res).indexOf('TOKEN-OK-000001') === -1, 'full token leaked');
    const m = JSON.parse(fcmSends(t)[0].options.payload).message;
    assert.strictEqual(m.data.projectId, 'hossam_02');
    assert.ok(m.notification.title);
  });
  check('G5.10 an UNREGISTERED/404 device is marked expired, exactly like the production sender', () => {
    const g = t.sheets['أجهزة_FCM']._grid;
    const row = g.filter(function (r) { return r[1] === 'TOKEN-GONE-00002'; })[0];
    assert.strictEqual(row[g[0].indexOf('status')], 'expired');
  });

  const rem = loadBackend();
  registerDevice(rem, 'TOKEN-R-0000001');
  rem.fetchCalls.length = 0;
  const viaPost = post(rem, { action: 'diagnoseFcmSetup', sheet: 'القضايا' });
  const viaPost2 = post(rem, { action: 'sendFcmDiagnosticTest' });
  check('G5.11 the diagnostics are NOT reachable through the public Web App (doPost rejects them, nothing is sent)', () => {
    assert.ok(viaPost.error && viaPost2.error);
    assert.strictEqual(fcmSends(rem).length, 0);
  });
}

console.log('\nPHASE N.13.2 e2e: ' + passed + ' PASS / ' + failed + ' FAIL');
process.exit(failed ? 1 : 0);
