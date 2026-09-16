// =====================================================================
// PHASE_S1_2_client_restoreRow_tests.js — نظام الحسام للمحاماة
// =====================================================================
// Tests ONLY js/api/api.js's new ApiService.restoreRow() (PHASE S.1.2):
// the 3-way SERVER_CONFIRMED / QUEUED_LOCAL / SERVER_REJECTED result
// contract every restore*() function (12 modules) now branches its
// toast on. Same "load the real production file, fake only the network
// edge" technique as PHASE_F4_1_credential_alert_tests.js.
//
// Does NOT touch/test saveData()/updateData()/deleteData()/syncRow() —
// those are unmodified by this phase (see phase report).
// =====================================================================

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const Module = require('module');
const assert = require('assert');

let passed = 0, failed = 0;
const log = [];
async function checkAsync(name, fn) { try { await fn(); passed++; log.push('PASS — ' + name); } catch (e) { failed++; log.push('FAIL — ' + name + '  =>  ' + e.message); } }

function setGlobals(extraGlobals) { Object.keys(extraGlobals).forEach(function (k) { global[k] = extraGlobals[k]; }); }
function clearGlobals(keys) { keys.forEach(function (k) { delete global[k]; }); }

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
  return { ok: ok, status: status, clone: function () { return this; }, json: async function () { return jsonBody; } };
}

async function main() {
  const apiJsPath = path.join(__dirname, '..', 'api', 'api.js');
  const GLOBAL_KEYS = ['API_URL', 'fetch', 'OfflineQueue', 'window', 'CustomEvent', 'ApiService', 'dispatchEvent'];

  // ================================================================
  // 1. Server actually confirms the restore -> SERVER_CONFIRMED
  // ================================================================
  {
    setGlobals({
      API_URL: 'https://example.test/exec',
      fetch: async function () { return makeFetchResponse({ ok: true, status: 200, jsonBody: { success: true, status: 'RESTORED' } }); },
      window: global
    });
    loadModule(apiJsPath);
    await checkAsync('restoreRow(): server confirms -> resolves SERVER_CONFIRMED', async () => {
      const r = await ApiService.restoreRow('الأطفال', { 'رقم_الطفل': 'C1' }, 0);
      assert.strictEqual(r, 'SERVER_CONFIRMED');
    });
    clearGlobals(GLOBAL_KEYS);
  }

  // ================================================================
  // 2. No API_URL configured at all -> QUEUED_LOCAL (never claims confirmed)
  // ================================================================
  {
    setGlobals({ API_URL: '', window: global });
    loadModule(apiJsPath);
    await checkAsync('restoreRow(): no API_URL configured -> resolves QUEUED_LOCAL (never SERVER_CONFIRMED)', async () => {
      const r = await ApiService.restoreRow('الأطفال', { 'رقم_الطفل': 'C1' }, 0);
      assert.strictEqual(r, 'QUEUED_LOCAL');
    });
    clearGlobals(GLOBAL_KEYS);
  }

  // ================================================================
  // 3. Transient network failure + OfflineQueue available -> QUEUED_LOCAL,
  //    and the exact restore body is what gets enqueued (so
  //    OfflineQueue.replay() can later replay it verbatim).
  // ================================================================
  {
    const queued = [];
    setGlobals({
      API_URL: 'https://example.test/exec',
      fetch: async function () { throw new Error('simulated network failure'); },
      OfflineQueue: { enqueue: function (body) { queued.push(body); } },
      window: global
    });
    loadModule(apiJsPath);
    await checkAsync('restoreRow(): transient network failure -> resolves QUEUED_LOCAL and enqueues the exact restore body', async () => {
      const r = await ApiService.restoreRow('الأطفال', { 'رقم_الطفل': 'C1' }, 0);
      assert.strictEqual(r, 'QUEUED_LOCAL');
      assert.strictEqual(queued.length, 1);
      assert.strictEqual(queued[0].action, 'restore');
      assert.strictEqual(queued[0].sheet, 'الأطفال');
      assert.strictEqual(queued[0].data['رقم_الطفل'], 'C1');
    });
    clearGlobals(GLOBAL_KEYS);
  }

  // ================================================================
  // 4. Server explicitly rejects (success:false, e.g. NOT_FOUND) -> SERVER_REJECTED
  // ================================================================
  {
    setGlobals({
      API_URL: 'https://example.test/exec',
      fetch: async function () { return makeFetchResponse({ ok: true, status: 200, jsonBody: { success: false, status: 'NOT_FOUND' } }); },
      window: global
    });
    loadModule(apiJsPath);
    await checkAsync('restoreRow(): server explicitly rejects (NOT_FOUND) -> resolves SERVER_REJECTED', async () => {
      const r = await ApiService.restoreRow('الأطفال', { 'رقم_الطفل': 'C-GONE' }, 0);
      assert.strictEqual(r, 'SERVER_REJECTED');
    });
    clearGlobals(GLOBAL_KEYS);
  }

  // ================================================================
  // 5. Auth rejection -> SERVER_REJECTED, NOT queued (matches saveData()/
  //    updateData()/deleteData()'s existing isAuthError convention)
  // ================================================================
  {
    const queued = [];
    global.dispatchEvent = function () {}; // present so _notifyMissingCredential() doesn't need to no-op-check further
    setGlobals({
      API_URL: 'https://example.test/exec',
      fetch: async function () { return makeFetchResponse({ ok: true, status: 200, jsonBody: { error: 'Missing credential', authCode: 'AUTH_MISSING_CREDENTIAL' } }); },
      OfflineQueue: { enqueue: function (body) { queued.push(body); } },
      window: global,
      CustomEvent: function (type, init) { this.type = type; this.detail = init && init.detail; }
    });
    loadModule(apiJsPath);
    await checkAsync('restoreRow(): AUTH_MISSING_CREDENTIAL -> resolves SERVER_REJECTED, NOT queued for retry', async () => {
      const r = await ApiService.restoreRow('الأطفال', { 'رقم_الطفل': 'C1' }, 0);
      assert.strictEqual(r, 'SERVER_REJECTED');
      assert.strictEqual(queued.length, 0, 'an auth rejection must never be queued — retrying would fail identically forever');
    });
    clearGlobals(GLOBAL_KEYS);
    delete global.dispatchEvent;
  }

  // ================================================================
  // 6. Transient network failure but NO OfflineQueue available at all
  //    -> SERVER_REJECTED (can't guarantee eventual retry, so must not
  //    claim QUEUED_LOCAL)
  // ================================================================
  {
    setGlobals({
      API_URL: 'https://example.test/exec',
      fetch: async function () { throw new Error('simulated network failure'); },
      window: global
      // OfflineQueue deliberately NOT set
    });
    loadModule(apiJsPath);
    await checkAsync('restoreRow(): network failure with no OfflineQueue available -> resolves SERVER_REJECTED (never falsely claims QUEUED_LOCAL)', async () => {
      const r = await ApiService.restoreRow('الأطفال', { 'رقم_الطفل': 'C1' }, 0);
      assert.strictEqual(r, 'SERVER_REJECTED');
    });
    clearGlobals(GLOBAL_KEYS);
  }

  console.log('\n' + log.join('\n'));
  console.log('\n' + passed + ' / ' + (passed + failed) + ' PASS');
  if (failed > 0) process.exit(1);
}

main();
