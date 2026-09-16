/**
 * ================================================================
 * PHASE_S1_1_children_offline_queue_tests.js — نظام الحسام للمحاماة
 * ================================================================
 * Satisfies PHASE S.1.1's mandatory Test Matrix items C and E:
 *   C. CREATE/UPDATE — OFFLINE FAILURE: local mutation preserved,
 *      operation enters the existing OfflineQueue/retry mechanism.
 *   E. DELETE — OFFLINE FAILURE: same, for deletion.
 *
 * Unlike js/tests/verify_children_repository_integration.js (which
 * mocks `ApiService` directly to assert children.js CALLS it), this
 * file loads the REAL js/api/api.js on top of a REAL failing `fetch`,
 * so the full chain is exercised exactly as production would run it:
 *
 *   children.js (saveChild/deleteChild)
 *       -> ApiService.syncRow()/deleteData()   (REAL js/api/api.js)
 *       -> saveData()/updateData()/deleteData() -> fetch() throws
 *       -> catch -> OfflineQueue.enqueue(body)  (spy — the only fake)
 *
 * This is the same "load the real production file, fake only the
 * network edge" technique already used by
 * js/tests/PHASE_F4_1_credential_alert_tests.js for js/api/api.js
 * itself.
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const Module = require('module');
const vm = require('vm');
const { FakeIndexedDB } = require(path.join(__dirname, 'fake_indexeddb.js'));
const { confirmDialog } = require(path.join(__dirname, '_shared', 'browserStubs.js'));

let passed = 0, failed = 0;
const log = [];
async function checkAsync(label, fn) {
  try { await fn(); passed++; log.push('PASS — ' + label); }
  catch (e) { failed++; log.push('FAIL — ' + label + '  =>  ' + e.message); }
}

function makeFakeElement() {
  return {
    value: '', textContent: '', innerHTML: '', style: { display: '' },
    classList: { _c: {}, add: function (c) { this._c[c] = true; }, remove: function (c) { delete this._c[c]; }, contains: function (c) { return !!this._c[c]; } }
  };
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

async function main() {
  const apiJsPath = path.join(__dirname, '..', 'api', 'api.js');
  const childrenJsPath = path.join(__dirname, '..', 'modules', 'children.js');

  const enqueued = [];
  const fakeElements = {};
  const toastLog = [];

  // ---- Real js/api/api.js, real fetch failure ----
  global.API_URL = 'https://example-apps-script.test/exec';
  global.fetch = async function () { throw new Error('simulated network failure'); };
  global.OfflineQueue = { enqueue: function (body) { enqueued.push(body); } };
  global.window = global; // api.js's `if (typeof window !== 'undefined') window.ApiService = ApiService;`
  loadModule(apiJsPath); // defines global.ApiService

  // ---- Real children.js on top of the same global scope ----
  global.indexedDB = new FakeIndexedDB();
  global.data = { children: [], cases: [] };
  global.editIdx = { children: -1 };
  global.document = {
    getElementById: function (id) { if (!fakeElements[id]) fakeElements[id] = makeFakeElement(); return fakeElements[id]; }
  };
  global.toast = function (msg, type) { toastLog.push({ msg: msg, type: type }); };
  global.updateBadges = function () {};
  global.closeModal = function () {};
  global.populateCaseDropdown = function () {};
  global.val = function (id) { return fakeElements[id] ? fakeElements[id].value : ''; };
  global.collectForm = function () { return global.__nextFormValue || {}; };
  global.fillForm = function () {};
  global.resetForm = function () {};
  global.saveLocal = function () {};
  global.confirm = function () { return true; };
  global.confirmDialog = confirmDialog;

  const childrenModule = loadModule(childrenJsPath);
  await childrenModule.ensureChildrenRepositoryReady();

  // ================================================================
  // C. CREATE — OFFLINE FAILURE
  // ================================================================
  await checkAsync('C: saveChild() CREATE — fetch fails — local record still created, ApiService.syncRow->saveData enters OfflineQueue.enqueue', async () => {
    fakeElements['fChildCaseNum'] = makeFakeElement();
    fakeElements['fChildCaseNum'].value = '2026-500';
    fakeElements['fChildName'] = makeFakeElement();
    fakeElements['fChildName'].value = 'ليلى أحمد';
    global.__nextFormValue = { 'رقم_القضية': '2026-500', 'الاسم': 'ليلى أحمد' };
    global.editIdx.children = -1;
    enqueued.length = 0;

    await childrenModule.saveChild();
    await new Promise(r => setTimeout(r, 20)); // let the fire-and-forget syncRow()'s fetch-reject->enqueue microtask chain settle

    assert.strictEqual(childrenModule.childrenRepository.getAll().filter(c => c['الاسم'] === 'ليلى أحمد').length, 1,
      'local Repository record must exist despite the network failure (local-first preserved)');
    assert.strictEqual(enqueued.length, 1, 'a failed syncRow (create) must enqueue exactly one OfflineQueue item');
    assert.strictEqual(enqueued[0].action, 'add');
    assert.strictEqual(enqueued[0].sheet, 'الأطفال');
    assert.strictEqual(enqueued[0].data['الاسم'], 'ليلى أحمد');
  });

  // ================================================================
  // C. UPDATE — OFFLINE FAILURE
  // ================================================================
  await checkAsync('C: saveChild() UPDATE — fetch fails — local record still updated, ApiService.syncRow->updateData enters OfflineQueue.enqueue', async () => {
    const idx = global.data.children.findIndex(c => c['الاسم'] === 'ليلى أحمد');
    global.editIdx.children = idx;
    fakeElements['fChildName'].value = 'ليلى أحمد (محدّثة)';
    global.__nextFormValue = { 'رقم_القضية': '2026-500', 'الاسم': 'ليلى أحمد (محدّثة)' };
    enqueued.length = 0;

    await childrenModule.saveChild();
    await new Promise(r => setTimeout(r, 20));

    assert.strictEqual(global.data.children[idx]['الاسم'], 'ليلى أحمد (محدّثة)',
      'local Repository record must be updated despite the network failure');
    assert.strictEqual(enqueued.length, 1, 'a failed syncRow (update) must enqueue exactly one OfflineQueue item');
    assert.strictEqual(enqueued[0].action, 'update');
    assert.strictEqual(enqueued[0].sheet, 'الأطفال');
    global.editIdx.children = -1;
  });

  // ================================================================
  // E. DELETE — OFFLINE FAILURE
  // ================================================================
  await checkAsync('E: deleteChild() — fetch fails — local record still soft-deleted, ApiService.deleteData enters OfflineQueue.enqueue', async () => {
    const idx = global.data.children.findIndex(c => c['الاسم'] === 'ليلى أحمد (محدّثة)');
    const id = global.data.children[idx][childrenModule.CHILDREN_ID_FIELD];
    enqueued.length = 0;

    await childrenModule.deleteChild(idx);

    assert.ok(!global.data.children.some(c => c[childrenModule.CHILDREN_ID_FIELD] === id),
      'record must be gone from the (soft-delete-aware) mirror despite the network failure');
    assert.strictEqual(enqueued.length, 1, 'a failed deleteData must enqueue exactly one OfflineQueue item');
    assert.strictEqual(enqueued[0].action, 'delete');
    assert.strictEqual(enqueued[0].sheet, 'الأطفال');
    assert.strictEqual(enqueued[0].id, id);
  });

  console.log(log.join('\n'));
  console.log('\n' + passed + '/' + (passed + failed) + ' checks passed.');
  if (failed > 0) { console.log('\n' + failed + ' CHECK(S) FAILED.'); process.exit(1); }
  console.log('\nALL CHECKS PASSED.');
}

main().catch((e) => { console.error(e); process.exit(1); });
