// =====================================================================
// verify_api_service_error_handling.js
//
// FIX P5 (DATABASE_FORENSIC_REPORT.md §P5, "فشل صامت غير مُعاد المحاولة
// عند خطأ HTTP تطبيقي") + the frontend half of FIX C1 (ApiService.
// deleteData() now forwards the record's own id).
//
// Before this fix, `_post()` treated ANY resolved fetch() (any HTTP
// status, any body) as success — Config/06_Api.gs's own doPost()/
// doGet() return an ordinary HTTP 200 with `{error: "..."}` on internal
// failures, which went completely unnoticed: no retry, no OfflineQueue
// entry, no signal to the user. This test drives ApiService.saveData()/
// updateData()/deleteData() against a mocked global fetch() returning
// each of: a network rejection, a non-2xx HTTP status, and a 200 with
// an `{error}` body — and asserts all three now reach OfflineQueue.
//
// Run: node js/tests/verify_api_service_error_handling.js
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

function makeFetchResponse({ ok, status, jsonBody, throwOnJson }) {
  return {
    ok: ok,
    status: status,
    clone: function () { return this; },
    json: async function () {
      if (throwOnJson) throw new Error('not JSON');
      return jsonBody;
    }
  };
}

async function main() {
  const apiJsPath = path.join(__dirname, '..', 'api', 'api.js');
  const GLOBAL_KEYS = ['API_URL', 'fetch', 'OfflineQueue', 'window', 'ApiService'];

  // ================================================================
  // 1. Network-level rejection (fetch() itself throws) -> still queued.
  //    (This was already the pre-existing behavior — a regression guard.)
  // ================================================================
  {
    const queued = [];
    setGlobals({
      API_URL: 'https://example.test/exec',
      fetch: async function () { throw new Error('network down'); },
      OfflineQueue: { enqueue: function (body) { queued.push(body); } },
      window: global
    });
    loadModule(apiJsPath);

    await checkAsync('saveData(): a network-level rejection is still caught and queued (regression guard)', async () => {
      await ApiService.saveData('القضايا', { 'رقم_القضية': '2026/1' });
      assert.strictEqual(queued.length, 1);
      assert.strictEqual(queued[0].action, 'add');
    });
    clearGlobals(GLOBAL_KEYS);
  }

  // ================================================================
  // 2. HTTP 500 (non-ok status), valid or invalid JSON body -> queued.
  //    FIX P5: previously invisible — _post() used to just `return
  //    fetch(...)` with no status check at all.
  // ================================================================
  {
    const queued = [];
    setGlobals({
      API_URL: 'https://example.test/exec',
      fetch: async function () { return makeFetchResponse({ ok: false, status: 500, jsonBody: { error: 'Internal error' } }); },
      OfflineQueue: { enqueue: function (body) { queued.push(body); } },
      window: global
    });
    loadModule(apiJsPath);

    await checkAsync('updateData(): an HTTP 500 response (previously silently treated as success) is now caught and queued (FIX P5)', async () => {
      await ApiService.updateData('القضايا', { 'رقم_القضية': '2026/1' }, 0);
      assert.strictEqual(queued.length, 1);
      assert.strictEqual(queued[0].action, 'update');
    });
    clearGlobals(GLOBAL_KEYS);
  }

  // ================================================================
  // 3. HTTP 200 with `{error: ...}` body -> queued (the exact,
  //    original P5 symptom: Config/06_Api.gs's own jsonResponse({error})
  //    returns 200, so only a body-content check can catch this).
  // ================================================================
  {
    const queued = [];
    setGlobals({
      API_URL: 'https://example.test/exec',
      fetch: async function () { return makeFetchResponse({ ok: true, status: 200, jsonBody: { error: 'الورقة غير موجودة: القضايا' } }); },
      OfflineQueue: { enqueue: function (body) { queued.push(body); } },
      window: global
    });
    loadModule(apiJsPath);

    await checkAsync('saveData(): HTTP 200 with an {error} body (application-level failure) is now caught and queued (FIX P5 — the core symptom)', async () => {
      await ApiService.saveData('القضايا', { 'رقم_القضية': '2026/1' });
      assert.strictEqual(queued.length, 1);
      assert.strictEqual(queued[0].action, 'add');
    });
    clearGlobals(GLOBAL_KEYS);
  }

  // ================================================================
  // 4. HTTP 200 with a genuinely successful body -> NOT queued (no
  //    false positives — the fix must not make every call retry).
  // ================================================================
  {
    const queued = [];
    setGlobals({
      API_URL: 'https://example.test/exec',
      fetch: async function () { return makeFetchResponse({ ok: true, status: 200, jsonBody: { status: 'ok', message: 'تم الحفظ' } }); },
      OfflineQueue: { enqueue: function (body) { queued.push(body); } },
      window: global
    });
    loadModule(apiJsPath);

    await checkAsync('saveData(): a genuine HTTP 200 success is NOT queued (no false-positive retries)', async () => {
      await ApiService.saveData('القضايا', { 'رقم_القضية': '2026/1' });
      assert.strictEqual(queued.length, 0);
    });
    clearGlobals(GLOBAL_KEYS);
  }

  // ================================================================
  // 5. HTTP 200 with a non-JSON body (e.g. an HTML error page from a
  //    misconfigured/expired Apps Script deployment) -> status-only
  //    check still applies; ok+non-JSON is treated as success (matches
  //    prior behavior when the body was never inspected at all), while
  //    a non-ok+non-JSON response is still caught by the status check.
  // ================================================================
  {
    const queued = [];
    setGlobals({
      API_URL: 'https://example.test/exec',
      fetch: async function () { return makeFetchResponse({ ok: false, status: 404, throwOnJson: true }); },
      OfflineQueue: { enqueue: function (body) { queued.push(body); } },
      window: global
    });
    loadModule(apiJsPath);

    await checkAsync('deleteData(): a non-JSON, non-ok response (e.g. HTML error page) is still caught via the status check', async () => {
      await ApiService.deleteData('القضايا', 0, '2026/1');
      assert.strictEqual(queued.length, 1);
    });
    clearGlobals(GLOBAL_KEYS);
  }

  // ================================================================
  // 6. FIX C1 (frontend half): deleteData() forwards the record id in
  //    the request body.
  // ================================================================
  {
    let sentBody = null;
    setGlobals({
      API_URL: 'https://example.test/exec',
      fetch: async function (url, opts) { sentBody = JSON.parse(opts.body); return makeFetchResponse({ ok: true, status: 200, jsonBody: { status: 'ok' } }); },
      OfflineQueue: { enqueue: function () {} },
      window: global
    });
    loadModule(apiJsPath);

    await checkAsync('deleteData(): forwards the record id as body.id (FIX C1 frontend half)', async () => {
      await ApiService.deleteData('أعمال_المحضرين', 2, 'PSW-7');
      assert.strictEqual(sentBody.action, 'delete');
      assert.strictEqual(sentBody.sheet, 'أعمال_المحضرين');
      assert.strictEqual(sentBody.id, 'PSW-7');
      assert.strictEqual(sentBody.rowIndex, 3, 'legacy rowIndex (0-based+1) is still sent as a fallback, unchanged');
    });

    await checkAsync('deleteData(): omitting the id (older/uncovered call site) still works — id comes through as undefined, not a crash', async () => {
      sentBody = null;
      await ApiService.deleteData('المكتبة', 0);
      assert.strictEqual(sentBody.action, 'delete');
      assert.strictEqual(sentBody.id, undefined);
    });
    clearGlobals(GLOBAL_KEYS);
  }

  // ================================================================
  // 7. syncRow(): still correctly dispatches to saveData()/updateData()
  //    by rowIndex sign (regression guard — untouched by this phase,
  //    but exercised here since restoreX() now depends on it, FIX C4).
  // ================================================================
  {
    const bodies = [];
    setGlobals({
      API_URL: 'https://example.test/exec',
      fetch: async function (url, opts) { bodies.push(JSON.parse(opts.body)); return makeFetchResponse({ ok: true, status: 200, jsonBody: { status: 'ok' } }); },
      OfflineQueue: { enqueue: function () {} },
      window: global
    });
    loadModule(apiJsPath);

    await checkAsync('syncRow(): rowIndex -1 dispatches to add (create)', async () => {
      await ApiService.syncRow('القضايا', { 'رقم_القضية': '2026/9' }, -1);
      assert.strictEqual(bodies[bodies.length - 1].action, 'add');
    });
    await checkAsync('syncRow(): rowIndex >= 0 dispatches to update — this is what restoreX() (FIX C4) relies on, forcing the update/upsert path', async () => {
      await ApiService.syncRow('القضايا', { 'رقم_القضية': '2026/9' }, 0);
      assert.strictEqual(bodies[bodies.length - 1].action, 'update');
    });
    clearGlobals(GLOBAL_KEYS);
  }

  console.log(log.join('\n'));
  console.log('\n' + passed + ' passed, ' + failed + ' failed.');
  process.exit(failed > 0 ? 1 : 0);
}

main();
