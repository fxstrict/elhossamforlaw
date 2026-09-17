/**
 * ================================================================
 * PHASE_S6_1_client_messages_delete_and_clear_all_data_tests.js
 * نظام الحسام للمحاماة
 * ================================================================
 * Covers the two CONFIRMED, previously-unfixed defects from the
 * PHASE S.2 forensic audit (ROOT CAUSE E and ROOT CAUSE D), closed
 * this session (PHASE S.6.1):
 *
 *   SUITE 1 — js/modules/client-messages.js deleteClientMessage()
 *     Before this fix: deleted only through ClientMessagesRepository
 *     (local soft-delete). ApiService.deleteData() was NEVER called —
 *     no tombstone, no OfflineQueue fallback. Worse than every other
 *     migrated entity (PHASE S.2 audit §15, ROOT CAUSE E).
 *     Modeled directly on js/tests/PHASE_S1_1_children_offline_queue_
 *     tests.js's technique: load the REAL js/api/api.js on top of a
 *     REAL failing fetch, so the full chain (client-messages.js ->
 *     ApiService.deleteData() -> fetch() throws -> OfflineQueue.enqueue())
 *     is exercised exactly as production would run it.
 *
 *   SUITE 2 — js/modules/settings.js clearAllData()
 *     Before this fix: 'expenses', 'processServerWorks' and
 *     'caseClients' were missing from the `keys` list entirely (never
 *     cleared from their Repository/IndexedDB, never removed from
 *     localStorage, never marked dirty), and the in-memory `data`
 *     reset object was missing 'clientMessages' plus those same 3
 *     keys (stale in-memory copies kept rendering until next reload).
 *     Modeled on js/tests/verify_settings_merge_tombstone.js's
 *     technique: load the REAL js/modules/settings.js with a mock
 *     Repository-shaped object per key.
 *
 * Run: node js/tests/PHASE_S6_1_client_messages_delete_and_clear_all_data_tests.js
 * ================================================================
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

function makeFakeElement() {
  return {
    value: '', textContent: '', innerHTML: '', style: { display: '' },
    classList: { _c: {}, add: function (c) { this._c[c] = true; }, remove: function (c) { delete this._c[c]; }, contains: function (c) { return !!this._c[c]; } }
  };
}

// ================================================================
// SUITE 1 — deleteClientMessage() pushes to ApiService.deleteData()
// ================================================================
async function suite1() {
  const apiJsPath = path.join(__dirname, '..', 'api', 'api.js');
  const clientMessagesJsPath = path.join(__dirname, '..', 'modules', 'client-messages.js');

  const enqueued = [];
  const fakeElements = {};

  global.API_URL = 'https://example-apps-script.test/exec';
  global.fetch = async function () { throw new Error('simulated network failure'); };
  global.OfflineQueue = { enqueue: function (body) { enqueued.push(body); } };
  global.window = global;
  loadModule(apiJsPath); // defines global.ApiService

  global.indexedDB = new FakeIndexedDB();
  global.data = { clientMessages: [], clients: [], cases: [] };
  global.document = {
    getElementById: function (id) { if (!fakeElements[id]) fakeElements[id] = makeFakeElement(); return fakeElements[id]; }
  };
  global.toast = function () {};
  global.saveLocal = function () {};
  global.closeModal = function () {};
  global.confirm = function () { return true; };
  global.confirmDialog = confirmDialog;
  global.collectForm = function () { return global.__nextFormValue || {}; };
  global.ApplicationShell = undefined;

  const cm = loadModule(clientMessagesJsPath);
  await cm.clientMessagesRepository.open();

  // Seed one message directly through the repository (same as a prior
  // successful saveClientMessage() would have done).
  const created = await cm.clientMessagesRepository.create({
    'رقم_الموكل': 'C-1', 'نص_الرسالة': 'رسالة تجريبية', 'التاريخ': '2026-01-01'
  });
  cm.syncClientMessagesMirror();
  const id = created.record.id;

  await checkAsync('deleteClientMessage() — fetch fails — local soft-delete still applied, ApiService.deleteData enters OfflineQueue.enqueue with the correct sheet/id', async () => {
    enqueued.length = 0;
    await cm.deleteClientMessage(id, 'C-1');

    assert.ok(
      !cm.clientMessagesRepository.getAll().some(function (m) { return m.id === id; }),
      'record must be gone from the (soft-delete-aware) repository mirror despite the network failure'
    );
    assert.strictEqual(enqueued.length, 1, 'a failed deleteData must enqueue exactly one OfflineQueue item (this is exactly zero before the fix, since ApiService.deleteData() was never called at all)');
    assert.strictEqual(enqueued[0].action, 'delete');
    assert.strictEqual(enqueued[0].sheet, 'رسائل_الموكل');
    assert.strictEqual(enqueued[0].id, id);
  });

  delete global.API_URL; delete global.fetch; delete global.OfflineQueue; delete global.window;
  delete global.indexedDB; delete global.data; delete global.document; delete global.toast;
  delete global.saveLocal; delete global.closeModal; delete global.confirm; delete global.confirmDialog;
  delete global.collectForm; delete global.ApplicationShell;
}

// ================================================================
// SUITE 2 — clearAllData() clears/resets the 3 previously-missing
// entities and the previously-missing clientMessages reset key
// ================================================================
function makeMockRepo() {
  let cleared = false;
  return {
    cleared: function () { return cleared; },
    clear: async function () { cleared = true; return true; }
  };
}

async function suite2() {
  const settingsJsPath = path.join(__dirname, '..', 'modules', 'settings.js');

  const ALL_KEYS = ['cases', 'sessions', 'clients', 'opponents', 'children', 'documents',
    'tasks', 'fees', 'library', 'templates', 'clientMessages', 'expenses',
    'processServerWorks', 'caseClients'];

  const repos = {};
  ALL_KEYS.forEach(function (k) {
    repos[k + 'Repository'] = makeMockRepo();
    repos[k + 'RepositoryReadyPromise'] = Promise.resolve();
    global[k + 'Repository'] = repos[k + 'Repository'];
    global[k + 'RepositoryReadyPromise'] = repos[k + 'RepositoryReadyPromise'];
  });

  const storage = {};
  global.localStorage = {
    setItem: function (k, v) { storage[k] = String(v); },
    getItem: function (k) { return Object.prototype.hasOwnProperty.call(storage, k) ? storage[k] : null; },
    removeItem: function (k) { delete storage[k]; }
  };
  // Seed every legacy localStorage key so we can prove they get removed.
  ALL_KEYS.forEach(function (k) { storage[k] = '[]'; });

  global.data = { cases: [1], sessions: [1], clients: [1], opponents: [1], children: [1],
    documents: [1], tasks: [1], fees: [1], library: [1], templates: [1],
    clientMessages: [1], expenses: [1], processServerWorks: [1], caseClients: [1] };
  global.confirmDialog = confirmDialog;
  global.updateBadges = function () {};
  global.renderDashboard = function () {};
  global.toast = function () {};
  global.window = global; // settings.js's _persistEntityViaRepository() reads window[key+'Repository']

  const settingsModule = loadModule(settingsJsPath);

  await checkAsync('clearAllData() — expenses/processServerWorks/caseClients Repositories are cleared (previously never called at all)', async () => {
    await settingsModule.clearAllData();
    assert.ok(repos['expensesRepository'].cleared(), 'expensesRepository.clear() must have been called');
    assert.ok(repos['processServerWorksRepository'].cleared(), 'processServerWorksRepository.clear() must have been called');
    assert.ok(repos['caseClientsRepository'].cleared(), 'caseClientsRepository.clear() must have been called');
  });

  await checkAsync('clearAllData() — legacy localStorage keys for the 3 new entities are removed', async () => {
    assert.strictEqual(storage['expenses'], undefined);
    assert.strictEqual(storage['processServerWorks'], undefined);
    assert.strictEqual(storage['caseClients'], undefined);
  });

  await checkAsync('clearAllData() — in-memory data object resets clientMessages/expenses/processServerWorks/caseClients to [] (previously left stale/undefined)', async () => {
    assert.deepStrictEqual(global.data.clientMessages, []);
    assert.deepStrictEqual(global.data.expenses, []);
    assert.deepStrictEqual(global.data.processServerWorks, []);
    assert.deepStrictEqual(global.data.caseClients, []);
  });

  await checkAsync('clearAllData() — every pre-existing entity is still cleared (no regression on the original 11 keys)', async () => {
    ['cases', 'sessions', 'clients', 'opponents', 'children', 'documents', 'tasks',
      'fees', 'library', 'templates', 'clientMessages'].forEach(function (k) {
      assert.ok(repos[k + 'Repository'].cleared(), k + 'Repository.clear() must have been called');
    });
  });

  ALL_KEYS.forEach(function (k) { delete global[k + 'Repository']; delete global[k + 'RepositoryReadyPromise']; });
  delete global.localStorage; delete global.data; delete global.confirmDialog;
  delete global.updateBadges; delete global.renderDashboard; delete global.toast; delete global.window;
}

async function main() {
  await suite1();
  await suite2();
  console.log(log.join('\n'));
  console.log('\n' + passed + '/' + (passed + failed) + ' checks passed.');
  if (failed > 0) { console.log('\n' + failed + ' CHECK(S) FAILED.'); process.exit(1); }
  console.log('\nALL CHECKS PASSED.');
}

main().catch((e) => { console.error(e); process.exit(1); });
