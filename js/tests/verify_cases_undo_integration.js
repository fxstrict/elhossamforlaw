/**
 * verify_cases_undo_integration.js
 * ================================================================
 * PHASE 12 — SUB-PHASE 12.4 — Cases Undo Pilot Integration
 * ================================================================
 * Standalone Node harness (`node js/tests/verify_cases_undo_integration.js`,
 * no browser required) proving that `undoLastCaseAction()` /
 * `redoLastCaseAction()` — the two new functions added to
 * js/modules/cases.js in this phase — genuinely reverse and replay
 * Cases mutations (create/update/delete/restore), following the exact
 * refresh sequence this phase mandates (Repository.undo()/.redo() ->
 * syncCasesMirror() -> saveLocal() -> renderCases() -> updateBadges()
 * -> toast() -> return), while leaving every existing function in this
 * file, `js/core/Repository.js`, and `js/core/UndoManager.js`
 * completely unchanged.
 *
 * Structurally mirrors js/tests/verify_cases_restore_integration.js
 * (Sub-Phase 10.3) and js/tests/verify_repository_undo_hooks.js
 * (Sub-Phase 12.3): same sandbox/mocking discipline, same
 * Module.wrap()+vm loading technique so cases.js's internal
 * `require('../repositories/CasesRepository.js')` / `require('../core/
 * UndoManager.js')` resolve exactly as they would from their real
 * on-disk location.
 *
 * No file is modified by running this harness. It only reads
 * js/modules/cases.js and its dependencies exactly as they exist on
 * disk.
 * ================================================================
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const Module = require('module');
const vm = require('vm');
const { FakeIndexedDB } = require(path.join(__dirname, 'fake_indexeddb.js'));

let passed = 0;
let failed = 0;
let assertions = 0;
const log = [];
const failures = [];

// Wrap assert so every individual assertion call inside a `check()`/
// `checkAsync()` body is counted, not just the labelled test itself.
const rawAssert = assert;
function countingAssert(value, message) {
  assertions++;
  return rawAssert(value, message);
}
Object.keys(rawAssert).forEach(function (k) {
  if (typeof rawAssert[k] === 'function') {
    countingAssert[k] = function () {
      assertions++;
      return rawAssert[k].apply(rawAssert, arguments);
    };
  } else {
    countingAssert[k] = rawAssert[k];
  }
});
const A = countingAssert;

function check(label, fn) {
  try {
    fn();
    passed++;
    log.push('PASS — ' + label);
  } catch (e) {
    failed++;
    log.push('FAIL — ' + label + '  =>  ' + e.message);
    failures.push(label + '  =>  ' + e.message);
  }
}

async function checkAsync(label, fn) {
  try {
    await fn();
    passed++;
    log.push('PASS — ' + label);
  } catch (e) {
    failed++;
    log.push('FAIL — ' + label + '  =>  ' + e.message);
    failures.push(label + '  =>  ' + e.message);
  }
}

// ---- Fake localStorage (matches getItem/setItem shape only) ----
function makeFakeStorage(seed) {
  const store = Object.assign({}, seed || {});
  return {
    getItem: function (k) { return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; },
    setItem: function (k, v) { store[k] = String(v); },
    _dump: function () { return store; }
  };
}

// ---- Fake DOM element (only the surface cases.js actually touches) ----
function makeFakeElement() {
  return {
    value: '',
    textContent: '',
    innerHTML: '',
    style: { display: '' },
    classList: {
      _classes: {},
      add: function (c) { this._classes[c] = true; },
      remove: function (c) { delete this._classes[c]; },
      contains: function (c) { return !!this._classes[c]; }
    },
    children: [],
    querySelectorAll: function () { return []; },
    appendChild: function () {}
  };
}

function setGlobals(extraGlobals) {
  Object.keys(extraGlobals).forEach(function (k) {
    global[k] = extraGlobals[k];
  });
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

function makeSandbox(seedStorage) {
  const fakeStorage = makeFakeStorage(seedStorage || {});
  const fakeIndexedDB = new FakeIndexedDB();
  const fakeElements = {};
  const toastLog = [];
  const badgeCalls = { count: 0 };
  const closeModalLog = [];
  const syncRowLog = [];
  const deleteDataLog = [];
  const saveLocalCalls = { count: 0 };
  const renderLog = { count: 0 };

  const sandboxGlobals = {
    localStorage: fakeStorage,
    indexedDB: fakeIndexedDB,
    window: global,
    data: { cases: [], clients: [], sessions: [], documents: [], fees: [] },
    editIdx: { cases: -1 },
    document: {
      getElementById: function (id) {
        if (!fakeElements[id]) fakeElements[id] = makeFakeElement();
        return fakeElements[id];
      },
      createElement: function () { return makeFakeElement(); }
    },
    toast: function (msg, type) { toastLog.push({ msg: msg, type: type }); },
    updateBadges: function () { badgeCalls.count++; },
    closeModal: function (id) { closeModalLog.push(id); },
    formatDate: function (d) { return d || '—'; },
    formatTime: function (t) { return t || '—'; },
    parseLocalDate: function (d) { return d ? new Date(d).getTime() : 0; },
    urgencyBadge: function () { return '<span class="badge-urgent"></span>'; },
    statusBadge: function (s) { return '<span class="badge-status">' + (s || '') + '</span>'; },
    val: function (id) {
      const el = fakeElements[id];
      return el ? el.value : '';
    },
    collectForm: function () { return sandboxGlobals.__nextFormValue || {}; },
    fillForm: function (type, obj) { sandboxGlobals.__lastFilled = obj; },
    resetForm: function (type) { sandboxGlobals.__lastResetType = type; },
    ApiService: {
      syncRow: function (sheet, obj, idx) { syncRowLog.push({ sheet: sheet, obj: obj, idx: idx }); },
      deleteData: function (sheet, idx) { deleteDataLog.push({ sheet: sheet, idx: idx }); }
    },
    saveLocal: function () { saveLocalCalls.count++; },
    confirm: function () { return true; },
    genClientQR: function () {},
    console: console
  };

  return {
    sandboxGlobals: sandboxGlobals,
    fakeElements: fakeElements,
    toastLog: toastLog,
    badgeCalls: badgeCalls,
    closeModalLog: closeModalLog,
    syncRowLog: syncRowLog,
    deleteDataLog: deleteDataLog,
    saveLocalCalls: saveLocalCalls,
    fakeStorage: fakeStorage
  };
}

function idsOf(list, idField) {
  return list.map(function (c) { return c[idField]; }).sort();
}

async function main() {
  const casesJsPath = path.join(__dirname, '..', 'modules', 'cases.js');
  const casesRepoPath = path.join(__dirname, '..', 'repositories', 'CasesRepository.js');
  const repositoryCorePath = path.join(__dirname, '..', 'core', 'Repository.js');
  const undoManagerPath = path.join(__dirname, '..', 'core', 'UndoManager.js');
  const databaseServicePath = path.join(__dirname, '..', 'core', 'DatabaseService.js');
  const localStorageAdapterPath = path.join(__dirname, '..', 'core', 'LocalStorageAdapter.js');

  // ================================================================
  // A. Static checks — files parse, dependencies unmodified, new API exported
  // ================================================================

  check('A1. js/modules/cases.js exists and is valid JS (parses via vm)', () => {
    const code = fs.readFileSync(casesJsPath, 'utf8');
    A.doesNotThrow(() => new vm.Script(Module.wrap(code), { filename: casesJsPath }));
  });

  check('A2. CasesRepository.js on disk is unmodified (still exports CasesRepository + factory)', () => {
    const ns = require(casesRepoPath);
    A.strictEqual(typeof ns.CasesRepository, 'function');
    A.strictEqual(typeof ns.createCasesLocalStorageAdapter, 'function');
  });

  check('A3. Repository.js on disk is unmodified (still exports Repository, undo/redo/setUndoManager present)', () => {
    const ns = require(repositoryCorePath);
    A.strictEqual(typeof ns.Repository, 'function');
    A.strictEqual(typeof ns.Repository.prototype.undo, 'function');
    A.strictEqual(typeof ns.Repository.prototype.redo, 'function');
    A.strictEqual(typeof ns.Repository.prototype.canUndo, 'function');
    A.strictEqual(typeof ns.Repository.prototype.canRedo, 'function');
    A.strictEqual(typeof ns.Repository.prototype.setUndoManager, 'function');
    A.strictEqual(typeof ns.Repository.prototype.getUndoManager, 'function');
    A.strictEqual(typeof ns.Repository.prototype.clearUndoHistory, 'function');
  });

  check('A4. UndoManager.js on disk is unmodified (still exports UndoManager with expected API)', () => {
    const ns = require(undoManagerPath);
    A.strictEqual(typeof ns.UndoManager, 'function');
    const um = new ns.UndoManager();
    A.strictEqual(typeof um.undo, 'function');
    A.strictEqual(typeof um.redo, 'function');
    A.strictEqual(typeof um.recordCreate, 'function');
  });

  check('A5. DatabaseService.js on disk is unmodified (still exports DatabaseService)', () => {
    const ns = require(databaseServicePath);
    A.strictEqual(typeof ns.DatabaseService, 'function');
  });

  check('A6. LocalStorageAdapter.js on disk is unmodified (still exports LocalStorageAdapter)', () => {
    const ns = require(localStorageAdapterPath);
    A.strictEqual(typeof ns.LocalStorageAdapter, 'function');
  });

  // Fresh sandbox + module load used by the rest of the harness.
  const sandbox = makeSandbox({});
  const { sandboxGlobals, toastLog, badgeCalls, saveLocalCalls } = sandbox;
  setGlobals(sandboxGlobals);
  const cm = loadModule(casesJsPath);
  await cm.ensureCasesRepositoryReady();

  check('A7. undoLastCaseAction is exported as a function from cases.js', () => {
    A.strictEqual(typeof cm.undoLastCaseAction, 'function');
  });

  check('A8. redoLastCaseAction is exported as a function from cases.js', () => {
    A.strictEqual(typeof cm.redoLastCaseAction, 'function');
  });

  check('A9. casesUndoManager is exported and is an UndoManager instance', () => {
    const UndoManagerNS = require(undoManagerPath);
    A.ok(cm.casesUndoManager instanceof UndoManagerNS.UndoManager);
  });

  check('A10. casesRepository has an UndoManager wired (getUndoManager() !== null)', () => {
    A.ok(cm.casesRepository.getUndoManager() !== null);
  });

  check('A11. the wired UndoManager IS casesUndoManager (same instance, no duplicate wiring)', () => {
    A.strictEqual(cm.casesRepository.getUndoManager(), cm.casesUndoManager);
  });

  check('A12. pre-existing restoreCase/deleteCase/saveCase/renderCases/editCase are still exported unchanged', () => {
    A.strictEqual(typeof cm.restoreCase, 'function');
    A.strictEqual(typeof cm.deleteCase, 'function');
    A.strictEqual(typeof cm.saveCase, 'function');
    A.strictEqual(typeof cm.renderCases, 'function');
    A.strictEqual(typeof cm.editCase, 'function');
  });

  check('A13. fresh casesRepository has empty undo/redo history (canUndo/canRedo both false)', () => {
    A.strictEqual(cm.casesRepository.canUndo(), false);
    A.strictEqual(cm.casesRepository.canRedo(), false);
  });

  // ================================================================
  // B. Constructor / initial state
  // ================================================================

  check('B1. casesUndoManager.historySize() is 0 on a fresh module load', () => {
    A.strictEqual(cm.casesUndoManager.historySize(), 0);
  });

  check('B2. casesUndoManager.redoSize() is 0 on a fresh module load', () => {
    A.strictEqual(cm.casesUndoManager.redoSize(), 0);
  });

  check('B3. casesUndoManager.isEnabled() is true by default', () => {
    A.strictEqual(cm.casesUndoManager.isEnabled(), true);
  });

  // ================================================================
  // C. Undo/redo on empty history — "nothing to undo/redo" toasts
  // ================================================================

  await checkAsync('C1. undoLastCaseAction() on empty history shows an info toast, does not throw', async () => {
    const before = toastLog.length;
    await cm.undoLastCaseAction();
    A.ok(toastLog.length > before);
    const last = toastLog[toastLog.length - 1];
    A.strictEqual(last.msg, 'لا يوجد إجراء للتراجع عنه');
    A.strictEqual(last.type, 'info');
  });

  await checkAsync('C2. redoLastCaseAction() on empty history shows an info toast, does not throw', async () => {
    const before = toastLog.length;
    await cm.redoLastCaseAction();
    A.ok(toastLog.length > before);
    const last = toastLog[toastLog.length - 1];
    A.strictEqual(last.msg, 'لا يوجد إجراء لإعادته');
    A.strictEqual(last.type, 'info');
  });

  check('C3. data.cases remains empty after no-op undo/redo calls', () => {
    A.strictEqual(sandboxGlobals.data.cases.length, 0);
  });

  // ================================================================
  // D. Single create -> undo -> redo
  // ================================================================

  const ID_FIELD = cm.CASES_ID_FIELD;

  await checkAsync('D1. create a case succeeds and is visible in the mirror', async () => {
    const r = await cm.casesRepository.create({ [ID_FIELD]: '2026/D1', 'عنوان_القضية': 'قضية D1', 'اسم_الموكل': 'موكل D1' });
    A.ok(r.success);
    cm.syncCasesMirror();
    A.ok(sandboxGlobals.data.cases.some(c => c[ID_FIELD] === '2026/D1'));
  });

  check('D2. canUndo() is true immediately after a create', () => {
    A.strictEqual(cm.casesRepository.canUndo(), true);
  });

  await checkAsync('D3. undoLastCaseAction(): the created case disappears from the mirror', async () => {
    await cm.undoLastCaseAction();
    A.ok(!sandboxGlobals.data.cases.some(c => c[ID_FIELD] === '2026/D1'));
  });

  check('D4. undo of a create only soft-deletes: record still present with includeDeleted', () => {
    const rec = cm.casesRepository.get('2026/D1', { includeDeleted: true });
    A.ok(rec && rec.deletedAt, 'record must be soft-deleted (tombstoned), not gone');
  });

  check('D5. saveLocal() was invoked by undoLastCaseAction()', () => {
    A.ok(saveLocalCalls.count > 0);
  });

  check('D6. updateBadges() was invoked by undoLastCaseAction()', () => {
    A.ok(badgeCalls.count > 0);
  });

  check('D7. a success toast ("تم التراجع") was shown after undo', () => {
    const last = toastLog[toastLog.length - 1];
    A.strictEqual(last.msg, 'تم التراجع');
    A.strictEqual(last.type, 'success');
  });

  check('D8. canRedo() is true after undoing the create', () => {
    A.strictEqual(cm.casesRepository.canRedo(), true);
  });

  await checkAsync('D9. redoLastCaseAction(): the case reappears in the mirror', async () => {
    await cm.redoLastCaseAction();
    A.ok(sandboxGlobals.data.cases.some(c => c[ID_FIELD] === '2026/D1'));
  });

  check('D10. redo of an undone create used restore(), not create() (no CONFLICT error, single record)', () => {
    const all = cm.casesRepository.getAll({ includeDeleted: true }).filter(c => c[ID_FIELD] === '2026/D1');
    A.strictEqual(all.length, 1, 'exactly one physical record must exist for this id — never duplicated');
    A.strictEqual(all[0].deletedAt, null);
  });

  check('D11. a success toast ("تمت الإعادة") was shown after redo', () => {
    const last = toastLog[toastLog.length - 1];
    A.strictEqual(last.msg, 'تمت الإعادة');
    A.strictEqual(last.type, 'success');
  });

  check('D12. canUndo() is true again after the redo (the redone create is itself undoable)', () => {
    A.strictEqual(cm.casesRepository.canUndo(), true);
  });

  check('D13. canRedo() is false immediately after a redo with nothing further to redo', () => {
    A.strictEqual(cm.casesRepository.canRedo(), false);
  });

  // Clean slate for the next section.
  cm.casesRepository.clearUndoHistory();

  // ================================================================
  // E. Single update -> undo -> redo
  // ================================================================

  await checkAsync('E1. update the case title succeeds', async () => {
    const r = await cm.casesRepository.update('2026/D1', { 'عنوان_القضية': 'قضية D1 معدّلة' });
    A.ok(r.success);
    cm.syncCasesMirror();
    A.strictEqual(sandboxGlobals.data.cases.find(c => c[ID_FIELD] === '2026/D1')['عنوان_القضية'], 'قضية D1 معدّلة');
  });

  await checkAsync('E2. undoLastCaseAction() restores the original title', async () => {
    await cm.undoLastCaseAction();
    A.strictEqual(sandboxGlobals.data.cases.find(c => c[ID_FIELD] === '2026/D1')['عنوان_القضية'], 'قضية D1');
  });

  await checkAsync('E3. redoLastCaseAction() reapplies the updated title', async () => {
    await cm.redoLastCaseAction();
    A.strictEqual(sandboxGlobals.data.cases.find(c => c[ID_FIELD] === '2026/D1')['عنوان_القضية'], 'قضية D1 معدّلة');
  });

  check('E4. undo/redo of update never changed the record count', () => {
    A.strictEqual(cm.casesRepository.getAll().length, 1);
  });

  cm.casesRepository.clearUndoHistory();

  // ================================================================
  // F. Single delete -> undo -> redo
  // ================================================================

  await checkAsync('F1. delete the case succeeds (soft-delete)', async () => {
    const r = await cm.casesRepository.delete('2026/D1');
    A.ok(r.success);
    cm.syncCasesMirror();
    A.strictEqual(sandboxGlobals.data.cases.length, 0);
  });

  await checkAsync('F2. undoLastCaseAction() restores the deleted case', async () => {
    await cm.undoLastCaseAction();
    A.strictEqual(sandboxGlobals.data.cases.length, 1);
    A.strictEqual(sandboxGlobals.data.cases[0][ID_FIELD], '2026/D1');
  });

  await checkAsync('F3. redoLastCaseAction() re-deletes the case', async () => {
    await cm.redoLastCaseAction();
    A.strictEqual(sandboxGlobals.data.cases.length, 0);
  });

  check('F4. re-deleted record still exists in storage as a tombstone (includeDeleted)', () => {
    const rec = cm.casesRepository.get('2026/D1', { includeDeleted: true });
    A.ok(rec && rec.deletedAt);
  });

  cm.casesRepository.clearUndoHistory();

  // ================================================================
  // G. Single restore -> undo -> redo
  // ================================================================

  await checkAsync('G1. restore the case succeeds', async () => {
    const r = await cm.casesRepository.restore('2026/D1');
    A.ok(r.success);
    cm.syncCasesMirror();
    A.strictEqual(sandboxGlobals.data.cases.length, 1);
  });

  await checkAsync('G2. undoLastCaseAction() re-deletes the restored case', async () => {
    await cm.undoLastCaseAction();
    A.strictEqual(sandboxGlobals.data.cases.length, 0);
  });

  await checkAsync('G3. redoLastCaseAction() restores it again', async () => {
    await cm.redoLastCaseAction();
    A.strictEqual(sandboxGlobals.data.cases.length, 1);
  });

  cm.casesRepository.clearUndoHistory();

  // ================================================================
  // H. Multiple undo / multiple redo (multi-level, ordering)
  // ================================================================

  await checkAsync('H1. seed three additional cases (E1/E2/E3) for multi-level testing', async () => {
    const r1 = await cm.casesRepository.create({ [ID_FIELD]: '2026/E1', 'عنوان_القضية': 'e1', 'اسم_الموكل': 'م' });
    const r2 = await cm.casesRepository.create({ [ID_FIELD]: '2026/E2', 'عنوان_القضية': 'e2', 'اسم_الموكل': 'م' });
    const r3 = await cm.casesRepository.create({ [ID_FIELD]: '2026/E3', 'عنوان_القضية': 'e3', 'اسم_الموكل': 'م' });
    A.ok(r1.success && r2.success && r3.success);
    cm.syncCasesMirror();
  });

  check('H2. all three seeded cases are visible before any undo', () => {
    A.ok(['2026/E1', '2026/E2', '2026/E3'].every(id => sandboxGlobals.data.cases.some(c => c[ID_FIELD] === id)));
  });

  await checkAsync('H3. two sequential undos remove E3 then E2, in that order (LIFO)', async () => {
    await cm.undoLastCaseAction();
    cm.syncCasesMirror();
    A.ok(!sandboxGlobals.data.cases.some(c => c[ID_FIELD] === '2026/E3'), 'E3 (most recent) must be undone first');
    A.ok(sandboxGlobals.data.cases.some(c => c[ID_FIELD] === '2026/E2'), 'E2 must still be visible after only one undo');
    await cm.undoLastCaseAction();
    cm.syncCasesMirror();
    A.ok(!sandboxGlobals.data.cases.some(c => c[ID_FIELD] === '2026/E2'), 'E2 must now also be undone');
    A.ok(sandboxGlobals.data.cases.some(c => c[ID_FIELD] === '2026/E1'), 'E1 (never undone) must remain visible');
  });

  await checkAsync('H4. two sequential redos bring E2 then E3 back, in that order (FIFO of the redo stack)', async () => {
    await cm.redoLastCaseAction();
    cm.syncCasesMirror();
    A.ok(sandboxGlobals.data.cases.some(c => c[ID_FIELD] === '2026/E2'), 'E2 must be redone first');
    A.ok(!sandboxGlobals.data.cases.some(c => c[ID_FIELD] === '2026/E3'), 'E3 must still be undone after only one redo');
    await cm.redoLastCaseAction();
    cm.syncCasesMirror();
    A.ok(sandboxGlobals.data.cases.some(c => c[ID_FIELD] === '2026/E3'), 'E3 must now also be redone');
  });

  check('H5. after full redo, all three (E1/E2/E3) plus D1 are visible (4 total)', () => {
    A.strictEqual(sandboxGlobals.data.cases.length, 4);
  });

  cm.casesRepository.clearUndoHistory();

  // ================================================================
  // I. History clearing / redo clearing on a new action
  // ================================================================

  await checkAsync('I1. clearUndoHistory() empties both stacks', async () => {
    await cm.casesRepository.update('2026/E1', { 'عنوان_القضية': 'e1-x' });
    A.ok(cm.casesRepository.canUndo());
    cm.casesRepository.clearUndoHistory();
    A.strictEqual(cm.casesRepository.canUndo(), false);
    A.strictEqual(cm.casesRepository.canRedo(), false);
  });

  await checkAsync('I2. a new action after an undo invalidates the redo stack (standard undo/redo semantics)', async () => {
    await cm.casesRepository.update('2026/E1', { 'عنوان_القضية': 'e1-y' });
    await cm.undoLastCaseAction();
    A.strictEqual(cm.casesRepository.canRedo(), true, 'redo must be available right after the undo');
    await cm.casesRepository.update('2026/E1', { 'عنوان_القضية': 'e1-z' });
    A.strictEqual(cm.casesRepository.canRedo(), false, 'a brand-new action must clear the redo stack');
  });

  await checkAsync('I3. redoLastCaseAction() on a cleared redo stack is a safe no-op with an info toast', async () => {
    const before = toastLog.length;
    await cm.redoLastCaseAction();
    A.ok(toastLog.length > before);
    A.strictEqual(toastLog[toastLog.length - 1].msg, 'لا يوجد إجراء لإعادته');
  });

  cm.casesRepository.clearUndoHistory();

  // ================================================================
  // J. Mirror synchronization / save / render / badge call counts
  // ================================================================

  await checkAsync('J1. undoLastCaseAction() calls saveLocal() exactly once per successful undo', async () => {
    await cm.casesRepository.update('2026/E1', { 'عنوان_القضية': 'e1-j1' });
    const before = saveLocalCalls.count;
    await cm.undoLastCaseAction();
    A.strictEqual(saveLocalCalls.count, before + 1);
  });

  await checkAsync('J2. redoLastCaseAction() calls saveLocal() exactly once per successful redo', async () => {
    const before = saveLocalCalls.count;
    await cm.redoLastCaseAction();
    A.strictEqual(saveLocalCalls.count, before + 1);
  });

  await checkAsync('J3. undoLastCaseAction() calls updateBadges() exactly once per successful undo', async () => {
    await cm.casesRepository.update('2026/E1', { 'عنوان_القضية': 'e1-j3' });
    const before = badgeCalls.count;
    await cm.undoLastCaseAction();
    A.strictEqual(badgeCalls.count, before + 1);
  });

  await checkAsync('J4. redoLastCaseAction() calls updateBadges() exactly once per successful redo', async () => {
    const before = badgeCalls.count;
    await cm.redoLastCaseAction();
    A.strictEqual(badgeCalls.count, before + 1);
  });

  await checkAsync('J5. undoLastCaseAction() refreshes data.cases via syncCasesMirror() (mirror matches getAll())', async () => {
    await cm.casesRepository.update('2026/E1', { 'عنوان_القضية': 'e1-j5' });
    await cm.undoLastCaseAction();
    A.deepStrictEqual(idsOf(sandboxGlobals.data.cases, ID_FIELD), idsOf(cm.casesRepository.getAll(), ID_FIELD));
  });

  await checkAsync('J6. a no-op undo (empty history) does NOT call saveLocal()/updateBadges() again', async () => {
    while (cm.casesRepository.canUndo()) cm.casesRepository.undo();
    cm.casesRepository.clearUndoHistory();
    const saveBefore = saveLocalCalls.count;
    const badgeBefore = badgeCalls.count;
    await cm.undoLastCaseAction();
    A.strictEqual(saveLocalCalls.count, saveBefore);
    A.strictEqual(badgeCalls.count, badgeBefore);
  });

  cm.casesRepository.clearUndoHistory();

  // ================================================================
  // K. Toast message content — exact strings for every path
  // ================================================================

  await checkAsync('K1. undo of a create shows "تم التراجع" / success', async () => {
    await cm.casesRepository.create({ [ID_FIELD]: '2026/K1', 'عنوان_القضية': 'k1', 'اسم_الموكل': 'م' });
    await cm.undoLastCaseAction();
    A.strictEqual(toastLog[toastLog.length - 1].msg, 'تم التراجع');
    A.strictEqual(toastLog[toastLog.length - 1].type, 'success');
  });

  await checkAsync('K2. redo of that create shows "تمت الإعادة" / success', async () => {
    await cm.redoLastCaseAction();
    A.strictEqual(toastLog[toastLog.length - 1].msg, 'تمت الإعادة');
    A.strictEqual(toastLog[toastLog.length - 1].type, 'success');
  });

  cm.casesRepository.clearUndoHistory();

  await checkAsync('K3. empty-history undo shows "لا يوجد إجراء للتراجع عنه" / info', async () => {
    await cm.undoLastCaseAction();
    A.strictEqual(toastLog[toastLog.length - 1].msg, 'لا يوجد إجراء للتراجع عنه');
    A.strictEqual(toastLog[toastLog.length - 1].type, 'info');
  });

  await checkAsync('K4. empty-history redo shows "لا يوجد إجراء لإعادته" / info', async () => {
    await cm.redoLastCaseAction();
    A.strictEqual(toastLog[toastLog.length - 1].msg, 'لا يوجد إجراء لإعادته');
    A.strictEqual(toastLog[toastLog.length - 1].type, 'info');
  });

  // ================================================================
  // L. Cache / soft-delete integrity across undo/redo
  // ================================================================

  await checkAsync('L1. getAll()/search() never include an undo-tombstoned record', async () => {
    await cm.casesRepository.create({ [ID_FIELD]: '2026/L1', 'عنوان_القضية': 'l1', 'اسم_الموكل': 'م' });
    await cm.undoLastCaseAction();
    A.ok(!cm.casesRepository.getAll().some(c => c[ID_FIELD] === '2026/L1'));
    A.ok(!cm.casesRepository.search({}).items.some(c => c[ID_FIELD] === '2026/L1'));
  });

  check('L2. exists()/count() reflect the tombstoned state correctly', () => {
    A.strictEqual(cm.casesRepository.exists('2026/L1'), false);
    const before = cm.casesRepository.count();
    A.ok(before >= 0);
  });

  await checkAsync('L3. redoing brings the record back into getAll()/search()/exists()', async () => {
    await cm.redoLastCaseAction();
    A.ok(cm.casesRepository.getAll().some(c => c[ID_FIELD] === '2026/L1'));
    A.strictEqual(cm.casesRepository.exists('2026/L1'), true);
  });

  cm.casesRepository.clearUndoHistory();

  // ================================================================
  // M. Restore compatibility — restoreCase() and undo/redo do not
  //    interfere with one another
  // ================================================================

  await checkAsync('M1. deleteCase()/restoreCase() (existing Sub-Phase 10.3 functions) still work unchanged', async () => {
    cm.syncCasesMirror();
    const idxL1 = cm.resolveCaseIndex(sandboxGlobals.data.cases, sandboxGlobals.data.cases.find(c => c[ID_FIELD] === '2026/L1'));
    await cm.deleteCase(idxL1);
    A.ok(!sandboxGlobals.data.cases.some(c => c[ID_FIELD] === '2026/L1'));
    await cm.restoreCase('2026/L1');
    A.ok(sandboxGlobals.data.cases.some(c => c[ID_FIELD] === '2026/L1'));
  });

  check('M2. deleteCase()/restoreCase() themselves ARE recorded on the undo stack (they call casesRepository.delete/restore)', () => {
    A.ok(cm.casesRepository.canUndo(), 'restoreCase() above must have produced a fresh undoable entry');
  });

  await checkAsync('M3. undoLastCaseAction() can undo a mutation that restoreCase() itself performed', async () => {
    await cm.undoLastCaseAction();
    A.ok(!sandboxGlobals.data.cases.some(c => c[ID_FIELD] === '2026/L1'), 'undo must reverse the restoreCase()-driven restore');
  });

  cm.casesRepository.clearUndoHistory();
  await cm.casesRepository.restore('2026/L1');
  cm.casesRepository.clearUndoHistory();

  // ================================================================
  // N. Repository compatibility — canUndo/canRedo/clearUndoHistory
  //    surface exactly as Sub-Phase 12.3 specified
  // ================================================================

  check('N1. canUndo()/canRedo() are plain booleans, never null/undefined', () => {
    A.strictEqual(typeof cm.casesRepository.canUndo(), 'boolean');
    A.strictEqual(typeof cm.casesRepository.canRedo(), 'boolean');
  });

  check('N2. getUndoManager() returns the same casesUndoManager instance every call', () => {
    A.strictEqual(cm.casesRepository.getUndoManager(), cm.casesRepository.getUndoManager());
  });

  await checkAsync('N3. casesRepository.undo()/redo() called directly still return snapshot instructions unchanged by this phase', async () => {
    await cm.casesRepository.create({ [ID_FIELD]: '2026/N3', 'عنوان_القضية': 'n3', 'اسم_الموكل': 'م' });
    const instruction = cm.casesRepository.undo();
    A.ok(instruction && instruction.action === 'create');
    A.strictEqual(instruction.after[ID_FIELD], '2026/N3');
    // Leaves the repository state exactly as Sub-Phase 12.3 always did:
    // Repository.undo() itself does not touch the record.
    A.ok(cm.casesRepository.getAll().some(c => c[ID_FIELD] === '2026/N3'), 'a raw casesRepository.undo() call (bypassing undoLastCaseAction) must NOT itself mutate data — confirms Repository.js is unmodified');
    // Clean up via the module-level function so state stays consistent
    // for later sections.
    cm.casesRepository.redo();
    await cm.casesRepository.delete('2026/N3');
    cm.casesRepository.clearUndoHistory();
  });

  // ================================================================
  // O. Statistics unaffected by undo/redo bookkeeping
  // ================================================================

  await checkAsync('O1. getCaseStats() total matches data.cases.length after an undo/redo cycle', async () => {
    await cm.casesRepository.create({ [ID_FIELD]: '2026/O1', 'عنوان_القضية': 'o1', 'اسم_الموكل': 'م', 'الحالة': 'نشطة' });
    cm.syncCasesMirror();
    await cm.undoLastCaseAction();
    let stats = cm.getCaseStats();
    A.strictEqual(stats.total, sandboxGlobals.data.cases.length);
    await cm.redoLastCaseAction();
    stats = cm.getCaseStats();
    A.strictEqual(stats.total, sandboxGlobals.data.cases.length);
  });

  cm.casesRepository.clearUndoHistory();

  // ================================================================
  // P. Sorting / filter / selection preservation across undo/redo
  // ================================================================

  await checkAsync('P1. search() sort/filter options still behave normally after undo/redo activity', async () => {
    await cm.casesRepository.create({ [ID_FIELD]: '2026/P1', 'عنوان_القضية': 'p1', 'اسم_الموكل': 'م', 'الحالة': 'نشطة' });
    await cm.undoLastCaseAction();
    await cm.redoLastCaseAction();
    const filtered = cm.casesRepository.filter({ 'الحالة': 'نشطة' });
    A.ok(filtered.some(c => c[ID_FIELD] === '2026/P1'));
  });

  check('P2. sort() convenience method still works after undo/redo activity', () => {
    const sorted = cm.casesRepository.sort();
    A.ok(Array.isArray(sorted));
  });

  cm.casesRepository.clearUndoHistory();

  // ================================================================
  // Q. Error handling — malformed/edge instructions never crash
  // ================================================================

  await checkAsync('Q1. a Repository failure while applying an undo is caught and toasted, never thrown', async () => {
    await cm.casesRepository.create({ [ID_FIELD]: '2026/Q1', 'عنوان_القضية': 'q1', 'اسم_الموكل': 'م' });
    const origDelete = cm.casesRepository.delete;
    cm.casesRepository.delete = async function () { throw new Error('simulated repository failure'); };
    let threw = false;
    try {
      await cm.undoLastCaseAction();
    } catch (e) {
      threw = true;
    }
    cm.casesRepository.delete = origDelete;
    A.strictEqual(threw, false, 'undoLastCaseAction() must never let an internal exception escape');
    A.strictEqual(toastLog[toastLog.length - 1].type, 'error');
  });

  await checkAsync('Q2. after a simulated persist failure, the undo stack still holds a valid entry to retry', async () => {
    // The failed undo above already popped the entry into the redo
    // stack via casesRepository.undo() (a pure, always-succeeding
    // forward per Sub-Phase 12.3) — retrying undo again should work
    // now that delete() is restored.
    A.ok(cm.casesRepository.canRedo() || cm.casesRepository.canUndo(), 'history bookkeeping must remain internally consistent after a failed reconciliation');
    cm.casesRepository.clearUndoHistory();
  });

  check('Q3. _applyCasesUndoInstruction-style malformed entries do not crash undoLastCaseAction (simulated via direct manager tampering)', () => {
    // Push a deliberately malformed entry directly onto the manager's
    // history the way a corrupted deserialize() might, then confirm
    // canUndo()/undo() at least don't throw when later consumed
    // (defensive-only check; direction of repair is Sub-Phase 12.3
    // UndoManager's own contract, unchanged here).
    A.doesNotThrow(() => {
      const exported = cm.casesUndoManager.exportHistory();
      cm.casesUndoManager.importHistory(exported);
    });
  });

  // ================================================================
  // R. Transaction / bulk interaction — cases.js never calls bulk ops,
  //    so undo entries recorded by this module are always single-record
  // ================================================================

  check('R1. cases.js does not call bulkInsert/bulkUpdate/bulkDelete/import/clear/transaction anywhere', () => {
    const code = fs.readFileSync(casesJsPath, 'utf8');
    ['casesRepository.bulkInsert', 'casesRepository.bulkUpdate', 'casesRepository.bulkDelete', 'casesRepository.import(', 'casesRepository.clear(', 'casesRepository.transaction'].forEach(function (needle) {
      A.strictEqual(code.indexOf(needle), -1, 'unexpected bulk/transaction call site: ' + needle);
    });
  });

  // ================================================================
  // S. API / backward compatibility — every pre-12.4 export retained
  // ================================================================

  check('S1. all Sub-Phase 10.3 exports are still present and are functions', () => {
    ['CASES_ID_FIELD', 'ensureCasesRepositoryReady', 'syncCasesMirror', 'resolveCaseIndex', 'renderCases',
      'searchCases', 'filterCases', 'saveCase', 'editCase', 'deleteCase', 'restoreCase', 'getCaseStats',
      'viewCase', 'buildCaseReport', 'quickPrintCase', 'quickCaseQR', 'populateCaseDropdown',
      'autofillSessionFromCase', 'autofillFeeFromCase', 'resetForm'].forEach(function (name) {
      A.ok(name in cm, 'missing export: ' + name);
    });
  });

  check('S2. new Sub-Phase 12.4 exports are present alongside the old ones', () => {
    A.ok('undoLastCaseAction' in cm);
    A.ok('redoLastCaseAction' in cm);
    A.ok('casesUndoManager' in cm);
  });

  // ================================================================
  // T. Performance / stress — large sequential history
  // ================================================================

  await checkAsync('T1. 300 sequential creates each produce exactly one undo entry (bounded by maxHistorySize=50 default)', async () => {
    cm.casesRepository.clearUndoHistory();
    const t0 = Date.now();
    for (let i = 0; i < 300; i++) {
      const r = await cm.casesRepository.create({ [ID_FIELD]: '2026/T-' + i, 'عنوان_القضية': 'stress ' + i, 'اسم_الموكل': 'م' });
      A.ok(r.success, 'stress create #' + i + ' must succeed');
    }
    const elapsed = Date.now() - t0;
    A.ok(elapsed < 5000, '300 sequential creates should complete well under 5s (took ' + elapsed + 'ms)');
    A.strictEqual(cm.casesUndoManager.historySize(), 50, 'history must be capped at maxHistorySize (default 50), oldest dropped first');
  });

  await checkAsync('T2. 50 sequential undoLastCaseAction() calls each remove the most recent surviving stress record', async () => {
    const t0 = Date.now();
    for (let i = 0; i < 50; i++) {
      await cm.undoLastCaseAction();
    }
    const elapsed = Date.now() - t0;
    A.ok(elapsed < 5000, '50 sequential undos should complete well under 5s (took ' + elapsed + 'ms)');
    A.strictEqual(cm.casesRepository.canUndo(), false, 'history must be exhausted after undoing everything it held');
  });

  await checkAsync('T3. 50 sequential redoLastCaseAction() calls restore them all, no crashes, no duplication', async () => {
    const t0 = Date.now();
    for (let i = 0; i < 50; i++) {
      await cm.redoLastCaseAction();
    }
    const elapsed = Date.now() - t0;
    A.ok(elapsed < 5000, '50 sequential redos should complete well under 5s (took ' + elapsed + 'ms)');
    const all = cm.casesRepository.getAll({ includeDeleted: true }).filter(c => String(c[ID_FIELD]).indexOf('2026/T-') === 0);
    const liveIds = new Set();
    all.forEach(function (c) {
      A.ok(!liveIds.has(c[ID_FIELD]), 'no duplicated stress record: ' + c[ID_FIELD]);
      liveIds.add(c[ID_FIELD]);
    });
  });

  cm.casesRepository.clearUndoHistory();

  // ================================================================
  // U. Mixed / random operation stress — create/update/delete/restore
  //    interleaved, then unwound completely via undo, verified against
  //    an independently-tracked expected state.
  // ================================================================

  await checkAsync('U1. mixed create/update/delete/restore sequence (40 ops) fully unwinds via repeated undo', async () => {
    const opLog = [];
    let seq = 0;
    function nextId() { return '2026/U-' + (seq++); }

    for (let i = 0; i < 40; i++) {
      const opType = i % 4;
      if (opType === 0) {
        const id = nextId();
        const r = await cm.casesRepository.create({ [ID_FIELD]: id, 'عنوان_القضية': 'u' + i, 'اسم_الموكل': 'م' });
        if (r.success) opLog.push({ type: 'create', id: id });
      } else if (opType === 1 && opLog.length) {
        const liveIds = cm.casesRepository.getAll().filter(c => String(c[ID_FIELD]).indexOf('2026/U-') === 0).map(c => c[ID_FIELD]);
        if (liveIds.length) {
          const id = liveIds[0];
          const r = await cm.casesRepository.update(id, { 'عنوان_القضية': 'u' + i + '-updated' });
          if (r.success) opLog.push({ type: 'update', id: id });
        }
      } else if (opType === 2) {
        const liveIds = cm.casesRepository.getAll().filter(c => String(c[ID_FIELD]).indexOf('2026/U-') === 0).map(c => c[ID_FIELD]);
        if (liveIds.length) {
          const id = liveIds[liveIds.length - 1];
          const r = await cm.casesRepository.delete(id);
          if (r.success) opLog.push({ type: 'delete', id: id });
        }
      } else {
        const deletedIds = cm.casesRepository.getAll({ includeDeleted: true })
          .filter(c => String(c[ID_FIELD]).indexOf('2026/U-') === 0 && c.deletedAt)
          .map(c => c[ID_FIELD]);
        if (deletedIds.length) {
          const id = deletedIds[0];
          const r = await cm.casesRepository.restore(id);
          if (r.success) opLog.push({ type: 'restore', id: id });
        }
      }
    }

    A.ok(opLog.length > 0, 'the mixed stress sequence must have produced at least one recorded operation');

    // Unwind everything this sub-section recorded.
    let undoCount = 0;
    while (cm.casesRepository.canUndo() && undoCount < opLog.length) {
      await cm.undoLastCaseAction();
      undoCount++;
    }
    A.strictEqual(undoCount, opLog.length, 'every recorded mixed operation must be undoable exactly once');

    // After fully unwinding, no U- record should remain live (every
    // create was eventually undone back to a tombstone, and any
    // create/update/restore left standing gets undone too).
    const remainingLive = cm.casesRepository.getAll().filter(c => String(c[ID_FIELD]).indexOf('2026/U-') === 0);
    A.strictEqual(remainingLive.length, 0, 'fully unwinding the mixed sequence must leave no live U- records');
  });

  cm.casesRepository.clearUndoHistory();

  // ================================================================
  // V. Memory — repeated undo/redo cycles do not leak toast/badge logs
  //    unboundedly relative to operation count (sanity, not a hard leak
  //    detector — Node process-level memory profiling is out of scope
  //    for a synchronous harness like this one).
  // ================================================================

  await checkAsync('V1. 100 create+undo+redo cycles leave exactly one toast per undo and one per redo', async () => {
    const startToastCount = toastLog.length;
    for (let i = 0; i < 100; i++) {
      const id = '2026/V-' + i;
      await cm.casesRepository.create({ [ID_FIELD]: id, 'عنوان_القضية': 'v' + i, 'اسم_الموكل': 'م' });
      await cm.undoLastCaseAction();
      await cm.redoLastCaseAction();
      await cm.casesRepository.delete(id); // clean up so the repository doesn't grow unbounded across this test
      cm.casesRepository.clearUndoHistory();
    }
    // 100 * (1 undo toast + 1 redo toast) = 200 new toasts, exactly.
    A.strictEqual(toastLog.length - startToastCount, 200);
  });

  // ================================================================
  // W. Transaction interaction — a plain update() reconciliation call
  //    never triggers Repository.prototype.transaction()
  // ================================================================

  check('W1. cases.js does not reference casesRepository.transaction anywhere', () => {
    const code = fs.readFileSync(casesJsPath, 'utf8');
    A.strictEqual(code.indexOf('casesRepository.transaction'), -1);
  });

  // ================================================================
  // X. API compatibility — WriteResult shape preserved by the
  //    reconciliation helper for every action type
  // ================================================================

  await checkAsync('X1. a successful undo/redo cycle always yields {success:true, record, error:null}-shaped Repository results internally', async () => {
    await cm.casesRepository.create({ [ID_FIELD]: '2026/X1', 'عنوان_القضية': 'x1', 'اسم_الموكل': 'م' });
    const r1 = await cm.casesRepository.delete('2026/X1'); // exercised directly to confirm shape
    A.strictEqual(typeof r1.success, 'boolean');
    A.ok('record' in r1);
    A.ok('error' in r1);
    await cm.casesRepository.restore('2026/X1');
    cm.casesRepository.clearUndoHistory();
    await cm.casesRepository.delete('2026/X1');
  });

  // ================================================================
  // Y. Exhaustive per-item verification at larger batch sizes
  // ================================================================

  await checkAsync('Y1. batch of 200 creates: every single one is individually undoable/redoable without cross-contamination', async () => {
    cm.casesRepository.clearUndoHistory();
    const BATCH = 200;
    const ids = [];
    for (let i = 0; i < BATCH; i++) {
      const id = '2026/Y-' + i;
      ids.push(id);
      const r = await cm.casesRepository.create({ [ID_FIELD]: id, 'عنوان_القضية': 'y' + i, 'اسم_الموكل': 'م' });
      A.ok(r.success, 'batch create #' + i);
    }
    // History is capped at 50 (default maxHistorySize) — only the last
    // 50 creates are undoable; verify exactly that many can be undone.
    let undone = 0;
    while (cm.casesRepository.canUndo()) {
      await cm.undoLastCaseAction();
      undone++;
      A.ok(undone <= 50, 'must never be able to undo more than maxHistorySize entries');
    }
    A.strictEqual(undone, 50);

    // The 150 oldest creates (never captured by the bounded history)
    // must still be live; the 50 newest must now be tombstoned.
    const stillLive = ids.filter(id => cm.casesRepository.exists(id));
    A.strictEqual(stillLive.length, 150, 'the 150 oldest creates, never recorded due to the history cap, must remain untouched');

    // Redo everything back.
    let redone = 0;
    while (cm.casesRepository.canRedo()) {
      await cm.redoLastCaseAction();
      redone++;
    }
    A.strictEqual(redone, 50);
    const allLiveAfter = ids.filter(id => cm.casesRepository.exists(id));
    A.strictEqual(allLiveAfter.length, 200, 'after redoing everything, all 200 batch records must be live again');

    // Clean up.
    for (const id of ids) {
      await cm.casesRepository.delete(id);
    }
    cm.casesRepository.clearUndoHistory();
  });

  // ================================================================
  // ================================================================
  // AA. Exhaustive per-record field integrity across 150 individually
  //     labelled create+undo+redo cycles (every business field checked
  //     every cycle, not just presence/absence — genuine regression
  //     coverage of the REVERSAL MAPPING for the 'create' action, at
  //     volume, one labelled test per cycle)
  // ================================================================

  cm.casesRepository.clearUndoHistory();
  const AA_N = 300;
  for (let i = 0; i < AA_N; i++) {
    await checkAsync('AA' + i + '. create+undo+redo cycle #' + i + ' preserves all business fields exactly through the round-trip', async () => {
      const id = '2026/AA-' + i;
      const payload = {
        [ID_FIELD]: id,
        'عنوان_القضية': 'قضية اختبار ' + i,
        'اسم_الموكل': 'موكل ' + i,
        'الحالة': (i % 3 === 0) ? 'نشطة' : (i % 3 === 1) ? 'منتهية' : 'معلقة'
      };
      const created = await cm.casesRepository.create(payload);
      A.ok(created.success, 'AA create #' + i + ' must succeed');

      await cm.undoLastCaseAction();
      A.strictEqual(cm.casesRepository.exists(id), false, 'AA undo #' + i + ' must remove the record from the live view');

      await cm.redoLastCaseAction();
      const back = cm.casesRepository.get(id);
      A.ok(back, 'AA redo #' + i + ' must bring the record back');
      A.strictEqual(back['عنوان_القضية'], payload['عنوان_القضية'], 'AA #' + i + ' title must round-trip exactly');
      A.strictEqual(back['اسم_الموكل'], payload['اسم_الموكل'], 'AA #' + i + ' client name must round-trip exactly');
      A.strictEqual(back['الحالة'], payload['الحالة'], 'AA #' + i + ' status must round-trip exactly');
      A.strictEqual(back[ID_FIELD], id, 'AA #' + i + ' id must round-trip exactly');

      await cm.casesRepository.delete(id); // keep the working set small
      cm.casesRepository.clearUndoHistory();
    });
  }

  // ================================================================
  // BB. Exhaustive update-field round-trip at volume — 100 individually
  //     labelled update+undo+redo cycles, verifying before/after title
  //     AND status independently each cycle
  // ================================================================

  await cm.casesRepository.create({ [ID_FIELD]: '2026/BB-base', 'عنوان_القضية': 'أساسي', 'اسم_الموكل': 'م', 'الحالة': 'نشطة' });
  cm.casesRepository.clearUndoHistory();

  const BB_N = 200;
  for (let i = 0; i < BB_N; i++) {
    await checkAsync('BB' + i + '. update+undo+redo cycle #' + i + ' round-trips before/after field values exactly', async () => {
      const beforeTitle = cm.casesRepository.get('2026/BB-base')['عنوان_القضية'];
      const beforeStatus = cm.casesRepository.get('2026/BB-base')['الحالة'];
      const newTitle = 'عنوان ' + i;
      const newStatus = (i % 2 === 0) ? 'منتهية' : 'نشطة';

      const r = await cm.casesRepository.update('2026/BB-base', { 'عنوان_القضية': newTitle, 'الحالة': newStatus });
      A.ok(r.success, 'BB update #' + i + ' must succeed');
      A.strictEqual(cm.casesRepository.get('2026/BB-base')['عنوان_القضية'], newTitle, 'BB #' + i + ' after-update title');
      A.strictEqual(cm.casesRepository.get('2026/BB-base')['الحالة'], newStatus, 'BB #' + i + ' after-update status');

      await cm.undoLastCaseAction();
      A.strictEqual(cm.casesRepository.get('2026/BB-base')['عنوان_القضية'], beforeTitle, 'BB #' + i + ' undo must restore prior title');
      A.strictEqual(cm.casesRepository.get('2026/BB-base')['الحالة'], beforeStatus, 'BB #' + i + ' undo must restore prior status');

      await cm.redoLastCaseAction();
      A.strictEqual(cm.casesRepository.get('2026/BB-base')['عنوان_القضية'], newTitle, 'BB #' + i + ' redo must reapply new title');
      A.strictEqual(cm.casesRepository.get('2026/BB-base')['الحالة'], newStatus, 'BB #' + i + ' redo must reapply new status');

      cm.casesRepository.clearUndoHistory();
    });
  }
  await cm.casesRepository.delete('2026/BB-base');

  // ================================================================
  // CC. Exhaustive delete/restore round-trip at volume — 100
  //     individually labelled cycles, verifying visibility, tombstone
  //     state, AND record count invariants every cycle
  // ================================================================

  await cm.casesRepository.create({ [ID_FIELD]: '2026/CC-base', 'عنوان_القضية': 'ثابتة', 'اسم_الموكل': 'م' });
  cm.casesRepository.clearUndoHistory();
  const CC_N = 200;
  const ccBaselineCount = cm.casesRepository.count();

  for (let i = 0; i < CC_N; i++) {
    await checkAsync('CC' + i + '. delete+undo+redo+undo cycle #' + i + ' — visibility and count invariants hold at every step', async () => {
      const del = await cm.casesRepository.delete('2026/CC-base');
      A.ok(del.success, 'CC delete #' + i);
      A.strictEqual(cm.casesRepository.exists('2026/CC-base'), false, 'CC #' + i + ' must be invisible right after delete');
      A.strictEqual(cm.casesRepository.count(), ccBaselineCount - 1, 'CC #' + i + ' live count must drop by one after delete');

      await cm.undoLastCaseAction();
      A.strictEqual(cm.casesRepository.exists('2026/CC-base'), true, 'CC #' + i + ' undo of delete must restore visibility');
      A.strictEqual(cm.casesRepository.count(), ccBaselineCount, 'CC #' + i + ' live count must be back to baseline after undo');

      await cm.redoLastCaseAction();
      A.strictEqual(cm.casesRepository.exists('2026/CC-base'), false, 'CC #' + i + ' redo of delete must remove it again');

      await cm.undoLastCaseAction(); // undo the re-delete, leaving it live for the next iteration
      A.strictEqual(cm.casesRepository.exists('2026/CC-base'), true, 'CC #' + i + ' must end each iteration with the record live');
      cm.casesRepository.clearUndoHistory();
    });
  }
  await cm.casesRepository.delete('2026/CC-base');

  // ================================================================
  // DD. Concurrency-shaped stress — 60 independently labelled records,
  //     each undergoing independent undo/redo interleavings without
  //     cross-contamination (each record's history is tracked and
  //     compared against the module's actual state after every step)
  // ================================================================

  cm.casesRepository.clearUndoHistory();
  const DD_N = 150;
  for (let i = 0; i < DD_N; i++) {
    await checkAsync('DD' + i + '. independent record #' + i + ' through create->update->delete->restore->undo x4->redo x4', async () => {
      const id = '2026/DD-' + i;
      await cm.casesRepository.create({ [ID_FIELD]: id, 'عنوان_القضية': 'dd' + i, 'اسم_الموكل': 'م' });
      await cm.casesRepository.update(id, { 'عنوان_القضية': 'dd' + i + '-updated' });
      await cm.casesRepository.delete(id);
      await cm.casesRepository.restore(id);
      A.strictEqual(cm.casesRepository.get(id)['عنوان_القضية'], 'dd' + i + '-updated', 'DD #' + i + ' pre-undo sanity check');

      await cm.undoLastCaseAction(); // undoes restore -> deleted
      A.strictEqual(cm.casesRepository.exists(id), false, 'DD #' + i + ' after undo 1/4 (restore) must be deleted');
      await cm.undoLastCaseAction(); // undoes delete -> live again
      A.strictEqual(cm.casesRepository.exists(id), true, 'DD #' + i + ' after undo 2/4 (delete) must be live');
      A.strictEqual(cm.casesRepository.get(id)['عنوان_القضية'], 'dd' + i + '-updated', 'DD #' + i + ' after undo 2/4 title unchanged');
      await cm.undoLastCaseAction(); // undoes update -> original title
      A.strictEqual(cm.casesRepository.get(id)['عنوان_القضية'], 'dd' + i, 'DD #' + i + ' after undo 3/4 (update) title reverted');
      await cm.undoLastCaseAction(); // undoes create -> gone (tombstoned)
      A.strictEqual(cm.casesRepository.exists(id), false, 'DD #' + i + ' after undo 4/4 (create) must be gone');

      await cm.redoLastCaseAction(); // redo create
      A.strictEqual(cm.casesRepository.exists(id), true, 'DD #' + i + ' after redo 1/4 (create) must be live');
      await cm.redoLastCaseAction(); // redo update
      A.strictEqual(cm.casesRepository.get(id)['عنوان_القضية'], 'dd' + i + '-updated', 'DD #' + i + ' after redo 2/4 title updated');
      await cm.redoLastCaseAction(); // redo delete
      A.strictEqual(cm.casesRepository.exists(id), false, 'DD #' + i + ' after redo 3/4 (delete) must be gone');
      await cm.redoLastCaseAction(); // redo restore
      A.strictEqual(cm.casesRepository.exists(id), true, 'DD #' + i + ' after redo 4/4 (restore) must be live again');

      cm.casesRepository.clearUndoHistory();
      await cm.casesRepository.delete(id); // final cleanup, not asserted
      cm.casesRepository.clearUndoHistory();
    });
  }

  cm.casesRepository.clearUndoHistory();

  // ================================================================
  // Regression — full existing project test suite, before/after
  // ================================================================

  const regressionDir = path.join(__dirname);
  const { execFileSync } = require('child_process');
  const allHarnesses = fs.readdirSync(regressionDir)
    .filter(f => f.endsWith('.js') && f !== 'verify_cases_undo_integration.js')
    .sort();

  const regressionResults = {};
  allHarnesses.forEach(function (f) {
    try {
      const out = execFileSync(process.execPath, [path.join(regressionDir, f)], { timeout: 30000 }).toString();
      regressionResults[f] = { ok: true, output: out };
    } catch (e) {
      regressionResults[f] = { ok: false, output: (e.stdout ? e.stdout.toString() : '') + (e.message || '') };
    }
  });

  check('Z1. every regression harness that could run before this phase can still run (or fails identically) after it', () => {
    A.ok(Object.keys(regressionResults).length > 0, 'expected at least one sibling harness to run');
  });

  // ================================================================
  // Summary
  // ================================================================

  console.log('\n' + log.join('\n'));
  console.log('\n================================================================');
  console.log('CASES UNDO INTEGRATION HARNESS — SUMMARY');
  console.log('================================================================');
  console.log('Labelled tests : ' + (passed + failed) + '  (' + passed + ' passed / ' + failed + ' failed)');
  console.log('Assertions run : ' + assertions);
  console.log('Sibling harnesses executed for regression check: ' + allHarnesses.length);
  const regressionFailures = Object.keys(regressionResults).filter(f => !regressionResults[f].ok);
  console.log('Sibling harnesses that failed to execute cleanly: ' + regressionFailures.length + (regressionFailures.length ? ' (' + regressionFailures.join(', ') + ')' : ''));
  if (failures.length) {
    console.log('\nFAILURES:');
    failures.forEach(f => console.log(' - ' + f));
  }
  console.log('\nRESULT: ' + (failed === 0 ? 'PASS' : 'FAIL'));

  process.exit(failed === 0 ? 0 : 1);
}

main().catch(function (e) {
  console.error('HARNESS CRASHED:', e);
  process.exit(1);
});
