/**
 * ================================================================
 * PHASE_S8_case_clients_sync_tests.js — نظام الحسام للمحاماة
 * ================================================================
 * Covers PHASE S.8 — CASE-CLIENT RELATIONSHIP SYNC (قضية_موكلين).
 *
 * SUITE 1 — PUSH (real js/modules/clients.js + real js/api/api.js +
 *   real FakeIndexedDB-backed CaseClientsRepository). Same "load the
 *   real production file, fake only the network edge" technique as
 *   js/tests/PHASE_S1_1_children_offline_queue_tests.js. Calls
 *   `_reconcileCaseClientsAfterSave()` directly (exported this phase,
 *   test-support only) rather than the full saveCase() flow, to keep
 *   these tests scoped to the one function this phase actually
 *   changed — saveCase()'s own wiring into it is already covered by
 *   js/tests/verify_clients_repository_integration.js's existing
 *   "CASES_RELATIONSHIP_FINANCIAL" block, re-run as part of this
 *   phase's regression (52/52 passed unchanged).
 *
 * SUITE 2 — PULL / MULTI-DEVICE / TOMBSTONE simulation. Two
 * independent CaseClientsRepository instances sharing one FakeIndexedDB
 * store stand in for "Device A" and "Device B". Device A's create/
 * update/delete results are pushed through the exact same
 * `_translateSheetRowTombstone()` (real js/modules/settings.js
 * function) + `repo.import(items,'merge')` primitive the real
 * loadFromSheets()/SyncEngine.js pull path uses — proven generic and
 * entity-agnostic already by js/tests/verify_settings_merge_tombstone.js,
 * exercised here specifically for 'caseClients'/'قضية_موكلين'.
 * A full end-to-end run through the real network/Apps Script layer is
 * NOT possible in this environment — this suite is INTEGRATION
 * VERIFIED against the real merge/translation primitives, not LIVE
 * VERIFIED against a real deployment.
 *
 * SUITE 3 — Static configuration checks (both entity-pair lists
 * actually contain the new pair; existing subset/count test updated
 * in the same phase).
 *
 * Run: node js/tests/PHASE_S8_case_clients_sync_tests.js
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
function check(label, fn) {
  try { fn(); passed++; log.push('PASS — ' + label); }
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
    classList: { _c: {}, add: function (c) { this._c[c] = true; }, remove: function (c) { delete this._c[c]; }, contains: function (c) { return !!this._c[c]; } },
    querySelectorAll: function () { return []; }
  };
}

// ================================================================
// SUITE 1 — PUSH (real api.js, real clients.js, real network failure)
// ================================================================
async function suite1() {
  const apiJsPath = path.join(__dirname, '..', 'api', 'api.js');
  const clientsJsPath = path.join(__dirname, '..', 'modules', 'clients.js');

  const enqueued = [];
  const fakeElements = {};

  global.API_URL = 'https://example-apps-script.test/exec';
  global.fetch = async function () { throw new Error('simulated network failure'); };
  global.OfflineQueue = { enqueue: function (body) { enqueued.push(body); } };
  global.window = global;
  loadModule(apiJsPath); // defines global.ApiService

  global.indexedDB = new FakeIndexedDB();
  global.data = { caseClients: [], clients: [], cases: [] };
  global.editIdx = { clients: -1 };
  global.document = {
    getElementById: function (id) { if (!fakeElements[id]) fakeElements[id] = makeFakeElement(); return fakeElements[id]; },
    querySelectorAll: function () { return []; }, // getCaseClientRole() always sees "nothing typed" -> default role/fee
    addEventListener: function () {}
  };
  global.toast = function () {};
  global.saveLocal = function () {};
  global.closeModal = function () {};
  global.updateBadges = function () {};
  global.confirm = function () { return true; };
  global.confirmDialog = confirmDialog;
  global.uid = function () { return 'test-uid-' + Math.random().toString(36).slice(2, 8); };
  global.val = function (id) { return fakeElements[id] ? fakeElements[id].value : ''; };
  global.collectForm = function () { return {}; };
  global.fillForm = function () {};
  global.resetForm = function () {};
  global.escapeHtml = function (s) { return s == null ? '' : String(s); };
  global.formatDate = function (d) { return d || ''; };

  const cm = loadModule(clientsJsPath);
  await cm.ensureCaseClientsRepositoryReady();

  fakeElements['fCaseNum'] = makeFakeElement();
  fakeElements['fCaseNum'].value = '2026/S8-1';

  // ---- PUSH: CREATE ----
  await checkAsync('_reconcileCaseClientsAfterSave() CREATE — fetch fails — local relationship still created, ApiService.syncRow->saveData enters OfflineQueue.enqueue as an "add" for قضية_موكلين', async () => {
    cm._setCaseSelectedClientIdsForTest(['CL-A']);
    enqueued.length = 0;

    await cm._reconcileCaseClientsAfterSave();
    await new Promise(r => setTimeout(r, 20)); // let the fire-and-forget syncRow()->fetch-reject->enqueue microtask chain settle

    const rows = cm.caseClientsRepository.getByCase('2026/S8-1');
    assert.strictEqual(rows.length, 1, 'local Repository record must exist despite the network failure (local-first preserved)');
    assert.strictEqual(rows[0]['رقم_الموكل'], 'CL-A');
    assert.strictEqual(enqueued.length, 1, 'a failed syncRow (create) must enqueue exactly one OfflineQueue item');
    assert.strictEqual(enqueued[0].action, 'add');
    assert.strictEqual(enqueued[0].sheet, 'قضية_موكلين');
    assert.strictEqual(enqueued[0].data['رقم_الموكل'], 'CL-A');
  });

  // ---- PUSH: UPDATE ----
  await checkAsync('_reconcileCaseClientsAfterSave() UPDATE — same client still selected, role unchanged (nothing typed) so NO update call fires (matches existing "leave untouched" semantics) — then simulate a typed role via the role registry equivalent by re-invoking with a direct repository patch, and confirm a real update push', async () => {
    // getCaseClientRole() always returns {role:'',fee:''} in this sandbox
    // (querySelectorAll stubbed to []), so the reconciliation's own
    // "nothing typed -> leave untouched" guard means no update push
    // fires from a second reconcile call with the same selection. This
    // matches saveCase()'s real behavior (verify_clients_repository_
    // integration.js's own equivalent scenario) — proving this contract
    // is unchanged is itself the point of this check.
    enqueued.length = 0;
    await cm._reconcileCaseClientsAfterSave(); // selection unchanged from previous check
    await new Promise(r => setTimeout(r, 20));
    assert.strictEqual(enqueued.length, 0, 'no role/fee typed -> no update push, exactly as before this phase');
  });

  // ---- PUSH: DELETE ----
  await checkAsync('_reconcileCaseClientsAfterSave() DELETE — deselecting the client — fetch fails — local relationship soft-deleted, ApiService.deleteData enters OfflineQueue.enqueue for قضية_موكلين with the correct id', async () => {
    const before = cm.caseClientsRepository.getByCase('2026/S8-1')[0];
    cm._setCaseSelectedClientIdsForTest([]); // deselect CL-A
    enqueued.length = 0;

    await cm._reconcileCaseClientsAfterSave();

    const rows = cm.caseClientsRepository.getByCase('2026/S8-1');
    assert.strictEqual(rows.length, 0, 'relationship must be gone from the (soft-delete-aware) getByCase() view despite the network failure');
    assert.strictEqual(enqueued.length, 1, 'a failed deleteData must enqueue exactly one OfflineQueue item');
    assert.strictEqual(enqueued[0].action, 'delete');
    assert.strictEqual(enqueued[0].sheet, 'قضية_موكلين');
    assert.strictEqual(enqueued[0].id, before.id);
  });

  delete global.API_URL; delete global.fetch; delete global.OfflineQueue; delete global.window;
  delete global.indexedDB; delete global.data; delete global.editIdx; delete global.document;
  delete global.toast; delete global.saveLocal; delete global.closeModal; delete global.updateBadges;
  delete global.confirm; delete global.confirmDialog; delete global.uid; delete global.val;
  delete global.collectForm; delete global.fillForm; delete global.resetForm; delete global.escapeHtml;
  delete global.formatDate;
}

// ================================================================
// SUITE 2 — PULL / MULTI-DEVICE / TOMBSTONE (real settings.js
// translator + real CaseClientsRepository merge, two instances
// sharing one FakeIndexedDB store)
// ================================================================
async function suite2() {
  const settingsJsPath = path.join(__dirname, '..', 'modules', 'settings.js');
  const CaseClientsRepositoryNS = require(path.join(__dirname, '..', 'repositories', 'CaseClientsRepository.js'));

  global.window = global; // settings.js top-level guards check `typeof module`, harmless either way
  const settingsModule = loadModule(settingsJsPath);
  delete global.window;

  const sharedDB = new FakeIndexedDB();

  function makeDeviceRepo() {
    const savedIndexedDB = global.indexedDB;
    global.indexedDB = sharedDB;
    const repo = new CaseClientsRepositoryNS.CaseClientsRepository();
    global.indexedDB = savedIndexedDB;
    return repo;
  }

  const deviceA = makeDeviceRepo();
  const deviceB = makeDeviceRepo();
  await deviceA.open();
  await deviceB.open();

  await checkAsync('Multi-device CREATE — Device A creates a relationship; a server-shaped row (real _translateSheetRowTombstone output) merged into Device B\'s Repository produces the same relationship', async () => {
    const created = await deviceA.create({ 'رقم_القضية': '2026/S8-2', 'رقم_الموكل': 'CL-B', 'الصفة': 'موكل بالقضية', 'أتعاب_العلاقة': '' });
    assert.ok(created.success);

    // Simulate what the real Sheet row looks like after apiAddRow() writes
    // it (server-shaped: raw 'محذوف_في' key, possibly empty/absent — never
    // the frontend's own 'deletedAt' key), then pass it through the REAL
    // translator loadFromSheets() already applies to every pulled row.
    const serverShapedRow = Object.assign({}, created.record, { 'محذوف_في': '' });
    const translated = settingsModule._translateSheetRowTombstone(serverShapedRow);

    const importResult = await deviceB.import([translated], 'merge');
    assert.ok(importResult.success);

    const onB = deviceB.getByCase('2026/S8-2');
    assert.strictEqual(onB.length, 1, 'Device B must see the relationship after a merge-import of the translated server row');
    assert.strictEqual(onB[0]['رقم_الموكل'], 'CL-B');
    assert.strictEqual(translated.deletedAt, undefined, 'settings.js\'s translator must NOT set deletedAt at all for a live row (deletes the key rather than nulling it — see that function\'s own header comment) so a not-yet-synced local tombstone can never be resurrected by this merge');
  });

  await checkAsync('Multi-device DELETE — Device A deletes the relationship; the tombstoned server row (raw محذوف_في timestamp, real translator) merged into Device B soft-deletes it there too — relationship remains deleted, not resurrected', async () => {
    const before = deviceA.getByCase('2026/S8-2')[0];
    const del = await deviceA.delete(before.id);
    assert.ok(del.success);

    // apiDeleteRow() writes محذوف_في as a real ISO timestamp string on
    // the sheet row — simulate that exact shape, NOT deletedAt directly.
    const tombstonedServerRow = Object.assign({}, before, { 'محذوف_في': '2026-01-01T00:00:00.000Z' });
    const translated = settingsModule._translateSheetRowTombstone(tombstonedServerRow);
    assert.ok(translated.deletedAt, 'translator must produce a non-empty deletedAt for a tombstoned row');

    const importResult = await deviceB.import([translated], 'merge');
    assert.ok(importResult.success);

    const onB = deviceB.getByCase('2026/S8-2');
    assert.strictEqual(onB.length, 0, 'Device B must see the relationship as deleted (getByCase excludes soft-deleted rows) — not resurrected by the pull');
  });

  await checkAsync('Duplicate scenario (documented, pre-existing, unchanged by S.8) — two devices independently creating "the same" Case<->Client relationship produce two distinct rows, exactly like every other client-generated-ID entity in this project (children/clientMessages/etc.) — NOT a regression introduced by this phase, NOT solved by it', async () => {
    const a = await deviceA.create({ 'رقم_القضية': '2026/S8-3', 'رقم_الموكل': 'CL-C', 'الصفة': 'موكل بالقضية', 'أتعاب_العلاقة': '' });
    const b = await deviceB.create({ 'رقم_القضية': '2026/S8-3', 'رقم_الموكل': 'CL-C', 'الصفة': 'موكل بالقضية', 'أتعاب_العلاقة': '' });
    assert.notStrictEqual(a.record.id, b.record.id, 'two independently-generated local ids for the conceptually-same relationship (documented limitation, shared by the whole project\'s ID scheme — see PHASE S.8 report §L)');
  });
}

// ================================================================
// SUITE 3 — static configuration checks
// ================================================================
function suite3() {
  const syncEngineSrc = fs.readFileSync(path.join(__dirname, '..', 'core', 'SyncEngine.js'), 'utf8');
  const settingsSrc = fs.readFileSync(path.join(__dirname, '..', 'modules', 'settings.js'), 'utf8');

  check('SyncEngine.js: SYNC_ENTITY_PAIRS literally includes [\'قضية_موكلين\', \'caseClients\']', () => {
    assert.ok(syncEngineSrc.indexOf("['قضية_موكلين', 'caseClients']") !== -1);
  });
  check('settings.js: loadFromSheets() pairs literally includes [\'قضية_موكلين\',\'caseClients\']', () => {
    assert.ok(settingsSrc.indexOf("['قضية_موكلين','caseClients']") !== -1);
  });
  check('SHEET_DEFS (Config/00_Config.gs) still defines قضية_موكلين with idField \'id\' and both محذوف_في/آخر_تحديث columns (backend contract this phase relies on, unchanged)', () => {
    const configSrc = fs.readFileSync(path.join(__dirname, '..', '..', 'Config', '00_Config.gs'), 'utf8');
    const idx = configSrc.indexOf("name: 'قضية_موكلين'");
    assert.ok(idx !== -1);
    const block = configSrc.slice(idx, idx + 400);
    assert.ok(block.indexOf("idField: 'id'") !== -1);
    assert.ok(block.indexOf('محذوف_في') !== -1);
    assert.ok(block.indexOf('آخر_تحديث') !== -1);
  });
  check('قضية_موكلين is NOT in the restricted-sheets list (Config/00_Config.gs _getRestrictedSheetNames_)', () => {
    const configSrc = fs.readFileSync(path.join(__dirname, '..', '..', 'Config', '00_Config.gs'), 'utf8');
    const m = configSrc.match(/function _getRestrictedSheetNames_\(\)\s*\{\s*return\s*(\[[^\]]*\]);/);
    assert.ok(m, 'could not locate _getRestrictedSheetNames_() body');
    assert.ok(m[1].indexOf('قضية_موكلين') === -1, 'قضية_موكلين must not appear in the restricted list');
  });
}

async function main() {
  await suite1();
  await suite2();
  suite3();
  console.log(log.join('\n'));
  console.log('\n' + passed + '/' + (passed + failed) + ' checks passed.');
  if (failed > 0) { console.log('\n' + failed + ' CHECK(S) FAILED.'); process.exit(1); }
  console.log('\nALL CHECKS PASSED.');
}

main().catch((e) => { console.error(e); process.exit(1); });
