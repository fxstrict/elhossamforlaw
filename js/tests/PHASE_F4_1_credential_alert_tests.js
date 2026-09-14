// =====================================================================
// PHASE_F4_1_credential_alert_tests.js
//
// PHASE F.4.1 — closes the DISCOVERED DEBT logged at F.4 closure
// (Master Report §42): js/api/api.js now dispatches a 'credential:missing'
// DOM event (ApiService._notifyMissingCredential()) whenever
// saveData()/updateData()/deleteData() are rejected with authCode
// AUTH_MISSING_CREDENTIAL, so a UI layer (js/license/CredentialAlertBanner.js)
// can tell the user why sync stopped instead of failing silently.
//
// This file tests ONLY js/api/api.js's new dispatch logic (pure JS, no
// DOM needed beyond a minimal fake window/CustomEvent). It does NOT
// test js/license/CredentialAlertBanner.js's own DOM rendering — that
// file is a thin, directly-inspectable listener with no independent
// branching logic beyond what's asserted here (event name, and calling
// InstallationRegistrar.hasLocalCredential() when present), consistent
// with this project's existing convention of not DOM-testing purely
// presentational banner files (see js/license/LicenseManagerPanel.js /
// SubscriptionManager.js, neither of which has a dedicated test file).
//
// Run: node js/tests/PHASE_F4_1_credential_alert_tests.js
// =====================================================================

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const Module = require('module');
const assert = require('assert');

let passed = 0, failed = 0;
const log = [];
function check(name, fn) { try { fn(); passed++; log.push('PASS — ' + name); } catch (e) { failed++; log.push('FAIL — ' + name + '  =>  ' + e.message); } }
async function checkAsync(name, fn) { try { await fn(); passed++; log.push('PASS — ' + name); } catch (e) { failed++; log.push('FAIL — ' + name + '  =>  ' + e.message); } }

function setGlobals(extraGlobals) {
  Object.keys(extraGlobals).forEach(function (k) { global[k] = extraGlobals[k]; });
}
function clearGlobals(keys) {
  keys.forEach(function (k) { delete global[k]; });
}

function loadModule(filePath) {
  const code = fs.readFileSync(filePath, 'utf8');
  const wrapper = Module.wrap(code);
  const script = new vm.Script(wrapper, { filename: filePath });
  const compiledWrapper = script.runInThisContext();
  const mod = new Module(filePath, module);
  mod.filename = filePath;
  mod.paths = Module._nodeModulePaths(path.dirname(filePath));
  const localRequire = function (id) { return mod.require(id); };
  compiledWrapper.call(mod.exports, mod.exports, localRequire, mod, filePath, path.dirname(filePath));
  mod.loaded = true;
  return mod.exports;
}

function makeFetchResponse({ ok, status, jsonBody }) {
  return {
    ok: ok,
    status: status,
    clone: function () { return this; },
    json: async function () { return jsonBody; }
  };
}

// api.js does `if (typeof window !== 'undefined') { window.ApiService = ApiService; }`
// and every existing test in this suite (verify_api_service_error_handling.js)
// relies on that by passing `window: global`, so the bare `ApiService`
// identifier resolves in this file too. We follow the same convention:
// `window` IS `global`, with dispatchEvent/CustomEvent attached to it
// (removed again in clearGlobals via GLOBAL_KEYS).
function makeFakeBrowserWindow() {
  const dispatched = [];
  global.dispatchEvent = function (evt) { dispatched.push(evt); };
  return { win: global, dispatched: dispatched };
}

async function main() {
  const apiJsPath = path.join(__dirname, '..', 'api', 'api.js');
  const GLOBAL_KEYS = ['API_URL', 'fetch', 'OfflineQueue', 'window', 'CustomEvent', 'ApiService', 'dispatchEvent'];

  function FakeCustomEvent(type, init) {
    this.type = type;
    this.detail = init && init.detail;
  }

  // ================================================================
  // 1. AUTH_MISSING_CREDENTIAL on saveData() -> event dispatched.
  // ================================================================
  {
    const { win, dispatched } = makeFakeBrowserWindow();
    setGlobals({
      API_URL: 'https://example.test/exec',
      fetch: async function () { return makeFetchResponse({ ok: true, status: 200, jsonBody: { error: 'Missing credential', authCode: 'AUTH_MISSING_CREDENTIAL' } }); },
      OfflineQueue: { enqueue: function () { throw new Error('must NOT be queued (isAuthError)'); } },
      window: win,
      CustomEvent: FakeCustomEvent
    });
    loadModule(apiJsPath);

    await checkAsync('saveData(): AUTH_MISSING_CREDENTIAL dispatches credential:missing on window', async () => {
      await ApiService.saveData('القضايا', { 'رقم_القضية': '2026/1' });
      assert.strictEqual(dispatched.length, 1);
      assert.strictEqual(dispatched[0].type, 'credential:missing');
      assert.strictEqual(dispatched[0].detail.authCode, 'AUTH_MISSING_CREDENTIAL');
    });
    clearGlobals(GLOBAL_KEYS);
  }

  // ================================================================
  // 2. Same for updateData() and deleteData() (all three call sites).
  // ================================================================
  {
    const { win, dispatched } = makeFakeBrowserWindow();
    setGlobals({
      API_URL: 'https://example.test/exec',
      fetch: async function () { return makeFetchResponse({ ok: true, status: 200, jsonBody: { error: 'Missing credential', authCode: 'AUTH_MISSING_CREDENTIAL' } }); },
      OfflineQueue: { enqueue: function () { throw new Error('must NOT be queued'); } },
      window: win,
      CustomEvent: FakeCustomEvent
    });
    loadModule(apiJsPath);

    await checkAsync('updateData(): AUTH_MISSING_CREDENTIAL dispatches credential:missing', async () => {
      await ApiService.updateData('القضايا', { 'رقم_القضية': '2026/1' }, 0);
      assert.strictEqual(dispatched.length, 1);
      assert.strictEqual(dispatched[0].detail.authCode, 'AUTH_MISSING_CREDENTIAL');
    });
    await checkAsync('deleteData(): AUTH_MISSING_CREDENTIAL dispatches credential:missing', async () => {
      await ApiService.deleteData('القضايا', 0, 'C-1');
      assert.strictEqual(dispatched.length, 2);
      assert.strictEqual(dispatched[1].detail.authCode, 'AUTH_MISSING_CREDENTIAL');
    });
    clearGlobals(GLOBAL_KEYS);
  }

  // ================================================================
  // 3. Scope discipline: AUTH_INVALID / AUTH_UNKNOWN_INSTALLATION /
  //    AUTH_REVOKED must NOT dispatch (out of this debt item's scope).
  // ================================================================
  for (const otherCode of ['AUTH_INVALID', 'AUTH_UNKNOWN_INSTALLATION', 'AUTH_REVOKED']) {
    const { win, dispatched } = makeFakeBrowserWindow();
    setGlobals({
      API_URL: 'https://example.test/exec',
      fetch: async function () { return makeFetchResponse({ ok: true, status: 200, jsonBody: { error: 'Auth failed', authCode: otherCode } }); },
      OfflineQueue: { enqueue: function () { throw new Error('must NOT be queued (isAuthError)'); } },
      window: win,
      CustomEvent: FakeCustomEvent
    });
    loadModule(apiJsPath);

    await checkAsync('saveData(): ' + otherCode + ' does NOT dispatch credential:missing (scope discipline)', async () => {
      await ApiService.saveData('القضايا', { 'رقم_القضية': '2026/1' });
      assert.strictEqual(dispatched.length, 0);
    });
    clearGlobals(GLOBAL_KEYS);
  }

  // ================================================================
  // 4. Regression guard: existing tests set `window: global` (no
  //    dispatchEvent/CustomEvent) — must remain a silent no-op, never
  //    throw, and never disturb the existing isAuthError/no-queue
  //    behavior those tests already cover.
  // ================================================================
  {
    const queued = [];
    setGlobals({
      API_URL: 'https://example.test/exec',
      fetch: async function () { return makeFetchResponse({ ok: true, status: 200, jsonBody: { error: 'Missing credential', authCode: 'AUTH_MISSING_CREDENTIAL' } }); },
      OfflineQueue: { enqueue: function (body) { queued.push(body); } },
      window: global // no dispatchEvent/CustomEvent — same shape as verify_api_service_error_handling.js
    });
    loadModule(apiJsPath);

    await checkAsync('saveData(): missing window.dispatchEvent/CustomEvent is a silent no-op (no throw), isAuthError still skips queue', async () => {
      await ApiService.saveData('القضايا', { 'رقم_القضية': '2026/1' });
      assert.strictEqual(queued.length, 0);
    });
    clearGlobals(GLOBAL_KEYS);
  }

  console.log(log.join('\n'));
  console.log('\n' + passed + ' / ' + (passed + failed) + ' PASS');
  if (failed > 0) process.exit(1);
}

main();
