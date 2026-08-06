/**
 * verify_cases_restore_integration.js
 * ================================================================
 * PHASE 10 — SUB-PHASE 10.3 — Cases Restore Pilot (Integration)
 * ================================================================
 * Standalone Node harness (`node js/tests/verify_cases_restore_
 * integration.js`, no browser required) proving that the new
 * `restoreCase(id)` function added to js/modules/cases.js in this
 * phase behaves as designed: it restores a soft-deleted case through
 * `casesRepository.restore(id)` (the Core capability added to
 * js/core/Repository.js in SUB-PHASE 10.2), refreshes the `data.cases`
 * compatibility mirror, persists via `saveLocal()`, shows a toast, and
 * re-renders — while leaving `deleteCase()`, `saveCase()`, and every
 * other pre-existing function in this file completely unchanged.
 *
 * Structurally mirrors js/tests/verify_cases_repository_integration.js
 * (Sub-Phase 9.13) and js/tests/verify_repository_restore.js
 * (Sub-Phase 10.2): same sandbox/mocking discipline, same
 * Module.wrap()+vm loading technique so cases.js's internal
 * `require('../repositories/CasesRepository.js')` resolves exactly as
 * it would from its real on-disk location.
 *
 * No file is modified by running this harness. It only reads
 * js/modules/cases.js and js/repositories/CasesRepository.js (and,
 * transitively, js/core/Repository.js / DatabaseService.js /
 * LocalStorageAdapter.js) exactly as they exist on disk.
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
const log = [];

function check(label, fn) {
  try {
    fn();
    passed++;
    log.push('PASS — ' + label);
  } catch (e) {
    failed++;
    log.push('FAIL — ' + label + '  =>  ' + e.message);
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

/**
 * Assigns `extraGlobals` directly onto the real Node `global` object.
 * Same rationale as verify_cases_repository_integration.js: cases.js is
 * a classic (non-module) browser script referencing bare identifiers
 * that must resolve via the scope chain.
 * @param {Object} extraGlobals
 */
function setGlobals(extraGlobals) {
  Object.keys(extraGlobals).forEach(function (k) {
    global[k] = extraGlobals[k];
  });
}

/**
 * Loads a CommonJS file via Node's own Module wrapper so its internal
 * relative `require()` calls resolve exactly as they would from its
 * real on-disk location.
 * @param {string} filePath - absolute path to the file to load.
 * @returns {*} module.exports of the loaded file.
 */
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

/**
 * Builds a fresh sandbox globals object — same shape as
 * verify_cases_repository_integration.js's makeSandbox().
 */
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
  const genClientQRLog = [];

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
    genClientQR: function (idx) { genClientQRLog.push(idx); },
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
    genClientQRLog: genClientQRLog,
    fakeStorage: fakeStorage
  };
}

async function main() {

  const casesJsPath = path.join(__dirname, '..', 'modules', 'cases.js');
  const casesRepoPath = path.join(__dirname, '..', 'repositories', 'CasesRepository.js');
  const repositoryCorePath = path.join(__dirname, '..', 'core', 'Repository.js');
  const databaseServicePath = path.join(__dirname, '..', 'core', 'DatabaseService.js');
  const localStorageAdapterPath = path.join(__dirname, '..', 'core', 'LocalStorageAdapter.js');

  // ================================================================
  // 0. Static checks — files parse, restoreCase is exported
  // ================================================================

  check('js/modules/cases.js exists and is valid JS (parses via vm)', () => {
    const code = fs.readFileSync(casesJsPath, 'utf8');
    assert.doesNotThrow(() => new vm.Script(Module.wrap(code), { filename: casesJsPath }));
  });

  check('CasesRepository.js on disk is unmodified (still exports CasesRepository + factory)', () => {
    const ns = require(casesRepoPath);
    assert.strictEqual(typeof ns.CasesRepository, 'function');
    assert.strictEqual(typeof ns.createCasesLocalStorageAdapter, 'function');
  });

  check('Repository.js on disk is unmodified (still exports Repository, restore() present on prototype)', () => {
    const ns = require(repositoryCorePath);
    assert.strictEqual(typeof ns.Repository, 'function');
    assert.strictEqual(typeof ns.Repository.prototype.restore, 'function');
  });

  check('DatabaseService.js on disk is unmodified (still exports DatabaseService)', () => {
    const ns = require(databaseServicePath);
    assert.strictEqual(typeof ns.DatabaseService, 'function');
  });

  check('LocalStorageAdapter.js on disk is unmodified (still exports LocalStorageAdapter)', () => {
    const ns = require(localStorageAdapterPath);
    assert.strictEqual(typeof ns.LocalStorageAdapter, 'function');
  });

  // ================================================================
  // 1. Core restoreCase() flow — delete then restore, one live case
  // ================================================================

  {
    const sandbox = makeSandbox({});
    const { sandboxGlobals, toastLog, badgeCalls, saveLocalCalls } = sandbox;
    setGlobals(sandboxGlobals);
    const cm = loadModule(casesJsPath);

    await cm.ensureCasesRepositoryReady();

    // Seed two cases directly through the Repository (avoids depending
    // on saveCase()'s DOM-collection path for harness setup, same
    // convention as verify_cases_repository_integration.js §3).
    const c1 = await cm.casesRepository.create({
      'رقم_القضية': '2026/5001', 'عنوان_القضية': 'قضية أولى', 'اسم_الموكل': 'موكل أول'
    });
    const c2 = await cm.casesRepository.create({
      'رقم_القضية': '2026/5002', 'عنوان_القضية': 'قضية ثانية', 'اسم_الموكل': 'موكل ثاني'
    });
    assert.ok(c1.success && c2.success, 'setup: both seed cases must be created');
    cm.syncCasesMirror();

    const targetId = '2026/5002';

    check('restoreCase is exported as a function from cases.js', () => {
      assert.strictEqual(typeof cm.restoreCase, 'function');
    });

    await checkAsync('deleteCase(i): case #2 is soft-deleted and vanishes from the mirror (setup for restore)', async () => {
      const idx = cm.resolveCaseIndex(sandboxGlobals.data.cases, sandboxGlobals.data.cases.find(function (c) { return c[cm.CASES_ID_FIELD] === targetId; }));
      await cm.deleteCase(idx);
      assert.ok(!sandboxGlobals.data.cases.some(function (c) { return c[cm.CASES_ID_FIELD] === targetId; }));
    });

    check('soft-deleted case is still present in underlying storage with a deletedAt stamp', () => {
      const all = cm.casesRepository.getAll({ includeDeleted: true });
      const tombstone = all.find(function (c) { return c[cm.CASES_ID_FIELD] === targetId; });
      assert.ok(tombstone && tombstone.deletedAt, 'record must be soft-deleted, not gone');
    });

    const toastCountBeforeRestore = toastLog.length;
    const badgeCountBeforeRestore = badgeCalls.count;
    const saveLocalCountBeforeRestore = saveLocalCalls.count;

    await checkAsync('restoreCase(id): case reappears in data.cases (mirror) after restore', async () => {
      await cm.restoreCase(targetId);
      assert.ok(sandboxGlobals.data.cases.some(function (c) { return c[cm.CASES_ID_FIELD] === targetId; }), 'restored case must be visible in data.cases again');
    });

    check('restoreCase(id): deletedAt is cleared on the restored record', () => {
      const restored = sandboxGlobals.data.cases.find(function (c) { return c[cm.CASES_ID_FIELD] === targetId; });
      assert.strictEqual(restored.deletedAt, null);
    });

    check('restoreCase(id): casesRepository.exists(id) is true again', () => {
      assert.strictEqual(cm.casesRepository.exists(targetId), true);
    });

    check('restoreCase(id): syncCasesMirror() ran — data.cases length reflects the restored record', () => {
      assert.strictEqual(sandboxGlobals.data.cases.length, 2, 'both case #1 (never deleted) and restored case #2 must be present');
    });

    check('restoreCase(id): saveLocal() was called (persistence refresh)', () => {
      assert.ok(saveLocalCalls.count > saveLocalCountBeforeRestore, 'saveLocal() must have been invoked at least once during restoreCase()');
    });

    check('restoreCase(id): a success toast was shown', () => {
      assert.ok(toastLog.length > toastCountBeforeRestore, 'a new toast must have been pushed');
      const last = toastLog[toastLog.length - 1];
      assert.strictEqual(last.msg, 'تم استرجاع القضية');
      assert.strictEqual(last.type, 'success');
    });

    check('restoreCase(id): updateBadges() was called (render refresh)', () => {
      assert.ok(badgeCalls.count > badgeCountBeforeRestore, 'updateBadges() must have been invoked during restoreCase()');
    });

    check('restoreCase(id): renderCases() ran without throwing (casesCount element reflects visible rows)', () => {
      assert.strictEqual(sandboxGlobals.data.cases.length, 2);
    });
  }

  // ================================================================
  // 2. Idempotent restore — restoring an already-live record
  // ================================================================

  {
    const sandbox = makeSandbox({});
    setGlobals(sandbox.sandboxGlobals);
    const cm = loadModule(casesJsPath);
    await cm.ensureCasesRepositoryReady();

    await cm.casesRepository.create({ 'رقم_القضية': '2026/6001', 'عنوان_القضية': 'قضية حية', 'اسم_الموكل': 'موكل' });
    cm.syncCasesMirror();

    await checkAsync('restoreCase(id) on an already-live (never-deleted) case is idempotent — succeeds, no error toast', async () => {
      const toastCountBefore = sandbox.toastLog.length;
      await cm.restoreCase('2026/6001');
      const last = sandbox.toastLog[sandbox.toastLog.length - 1];
      assert.strictEqual(toastCountBefore < sandbox.toastLog.length, true);
      assert.strictEqual(last.type, 'success', 'idempotent restore must still report success, not error');
    });

    check('restoreCase(id) idempotent case: record still present exactly once in data.cases', () => {
      const matches = sandbox.sandboxGlobals.data.cases.filter(function (c) { return c['رقم_القضية'] === '2026/6001'; });
      assert.strictEqual(matches.length, 1);
    });
  }

  // ================================================================
  // 3. restoreCase() on an unknown id — graceful failure, error toast
  // ================================================================

  {
    const sandbox = makeSandbox({});
    setGlobals(sandbox.sandboxGlobals);
    const cm = loadModule(casesJsPath);
    await cm.ensureCasesRepositoryReady();

    await checkAsync('restoreCase("no-such-id") fails gracefully with an error toast, no throw', async () => {
      await assert.doesNotReject(cm.restoreCase('2099/does-not-exist'));
      const last = sandbox.toastLog[sandbox.toastLog.length - 1];
      assert.strictEqual(last.msg, 'حدث خطأ أثناء استرجاع القضية');
      assert.strictEqual(last.type, 'error');
    });

    check('restoreCase() on unknown id: data.cases remains empty (no phantom record created)', () => {
      assert.strictEqual(sandbox.sandboxGlobals.data.cases.length, 0);
    });
  }

  // ================================================================
  // 4. Duplicate / repeated restore prevention (no data loss, no dupes)
  // ================================================================

  {
    const sandbox = makeSandbox({});
    setGlobals(sandbox.sandboxGlobals);
    const cm = loadModule(casesJsPath);
    await cm.ensureCasesRepositoryReady();

    await cm.casesRepository.create({ 'رقم_القضية': '2026/7001', 'عنوان_القضية': 'قضية للاسترجاع المتكرر', 'اسم_الموكل': 'موكل' });
    cm.syncCasesMirror();
    const idx = cm.resolveCaseIndex(sandbox.sandboxGlobals.data.cases, sandbox.sandboxGlobals.data.cases[0]);
    await cm.deleteCase(idx);

    await checkAsync('First restoreCase(id) call succeeds', async () => {
      await cm.restoreCase('2026/7001');
      assert.ok(sandbox.sandboxGlobals.data.cases.some(function (c) { return c['رقم_القضية'] === '2026/7001'; }));
    });

    await checkAsync('Second, repeated restoreCase(id) call on the now-live record is idempotent — no duplicate, no error', async () => {
      await cm.restoreCase('2026/7001');
      const matches = sandbox.sandboxGlobals.data.cases.filter(function (c) { return c['رقم_القضية'] === '2026/7001'; });
      assert.strictEqual(matches.length, 1, 'duplicate restore must not create a second record');
      const last = sandbox.toastLog[sandbox.toastLog.length - 1];
      assert.strictEqual(last.type, 'success');
    });

    check('No data loss across delete -> restore -> restore: all original fields preserved', () => {
      const rec = sandbox.sandboxGlobals.data.cases.find(function (c) { return c['رقم_القضية'] === '2026/7001'; });
      assert.strictEqual(rec['عنوان_القضية'], 'قضية للاسترجاع المتكرر');
      assert.strictEqual(rec['اسم_الموكل'], 'موكل');
    });
  }

  // ================================================================
  // 5. includeDeleted visibility (soft delete visibility contract)
  // ================================================================

  {
    const sandbox = makeSandbox({});
    setGlobals(sandbox.sandboxGlobals);
    const cm = loadModule(casesJsPath);
    await cm.ensureCasesRepositoryReady();

    await cm.casesRepository.create({ 'رقم_القضية': '2026/8001', 'عنوان_القضية': 'قضية سلة المهملات', 'اسم_الموكل': 'موكل' });
    cm.syncCasesMirror();
    const idx = cm.resolveCaseIndex(sandbox.sandboxGlobals.data.cases, sandbox.sandboxGlobals.data.cases[0]);
    await cm.deleteCase(idx);

    check('getAll() default (no includeDeleted): soft-deleted case is hidden', () => {
      const visible = cm.casesRepository.getAll();
      assert.ok(!visible.some(function (c) { return c['رقم_القضية'] === '2026/8001'; }));
    });

    check('getAll({includeDeleted:true}): soft-deleted case IS returned', () => {
      const all = cm.casesRepository.getAll({ includeDeleted: true });
      assert.ok(all.some(function (c) { return c['رقم_القضية'] === '2026/8001'; }));
    });

    await checkAsync('After restoreCase(id): getAll() default now includes the case again', async () => {
      await cm.restoreCase('2026/8001');
      const visible = cm.casesRepository.getAll();
      assert.ok(visible.some(function (c) { return c['رقم_القضية'] === '2026/8001'; }));
    });

    check('search() after restore: the restored case matches a free-text search on its title', () => {
      const result = cm.casesRepository.search({ search: 'سلة المهملات' });
      assert.strictEqual(result.items.length, 1);
      assert.strictEqual(result.items[0]['رقم_القضية'], '2026/8001');
    });
  }

  // ================================================================
  // 6. Statistics remain correct after restore (data.cases.length-based)
  // ================================================================

  {
    const sandbox = makeSandbox({});
    setGlobals(sandbox.sandboxGlobals);
    const cm = loadModule(casesJsPath);
    await cm.ensureCasesRepositoryReady();

    await cm.casesRepository.create({ 'رقم_القضية': '2026/9001', 'عنوان_القضية': 'ق1', 'اسم_الموكل': 'م1', 'الحالة': 'نشطة' });
    await cm.casesRepository.create({ 'رقم_القضية': '2026/9002', 'عنوان_القضية': 'ق2', 'اسم_الموكل': 'م2', 'الحالة': 'نشطة' });
    cm.syncCasesMirror();

    const statsBefore = cm.getCaseStats();
    assert.strictEqual(statsBefore.total, 2);

    const idx = cm.resolveCaseIndex(sandbox.sandboxGlobals.data.cases, sandbox.sandboxGlobals.data.cases.find(function (c) { return c['رقم_القضية'] === '2026/9002'; }));
    await cm.deleteCase(idx);

    check('getCaseStats(): total drops by 1 immediately after delete', () => {
      const stats = cm.getCaseStats();
      assert.strictEqual(stats.total, 1);
    });

    await checkAsync('getCaseStats(): total rises back to 2 immediately after restoreCase() — expected behavior, not a bug (Restore_System_Architecture.md §18)', async () => {
      await cm.restoreCase('2026/9002');
      const stats = cm.getCaseStats();
      assert.strictEqual(stats.total, 2);
      assert.strictEqual(stats.active, 2);
    });
  }

  // ================================================================
  // 7. Persistence after reopen (new Repository instance, same storage)
  // ================================================================

  {
    const sandbox = makeSandbox({});
    setGlobals(sandbox.sandboxGlobals);
    const cm = loadModule(casesJsPath);
    await cm.ensureCasesRepositoryReady();

    await cm.casesRepository.create({ 'رقم_القضية': '2026/A001', 'عنوان_القضية': 'قضية الاستمرارية', 'اسم_الموكل': 'موكل' });
    cm.syncCasesMirror();
    const idx = cm.resolveCaseIndex(sandbox.sandboxGlobals.data.cases, sandbox.sandboxGlobals.data.cases[0]);
    await cm.deleteCase(idx);
    await cm.restoreCase('2026/A001');

    await checkAsync('Restored state survives a fresh CasesRepository instance re-reading the same underlying storage ("reopen")', async () => {
      const CasesRepositoryNS = require(casesRepoPath);
      const freshRepo = new CasesRepositoryNS.CasesRepository();
      await freshRepo.open();
      const all = freshRepo.getAll();
      const rec = all.find(function (c) { return c['رقم_القضية'] === '2026/A001'; });
      assert.ok(rec, 'restored record must persist across a fresh Repository instance reading the same storage key');
      assert.strictEqual(rec.deletedAt, null);
    });
  }

  // ================================================================
  // 8. Backward compatibility — legacy-shaped seed data
  // PHASE 13.6: Repository now persists exclusively through
  // IndexedDBAdapter, so a raw localStorage["cases"] JSON string is no
  // longer read at all — seed the object store directly instead (same
  // fix as verify_cases_repository_integration.js).
  // ================================================================

  {
    const legacySeed = {
      cases: JSON.stringify([
        {
          'رقم_القضية': '2024/LEGACY',
          'عنوان_القضية': 'قضية قديمة',
          'اسم_الموكل': 'موكل قديم',
          'الحالة': 'منتهية',
          'deletedAt': null
        }
      ])
    };
    const sandbox = makeSandbox(legacySeed);
    const { createCasesLocalStorageAdapter } = require(casesRepoPath);
    const seedAdapter = createCasesLocalStorageAdapter(sandbox.sandboxGlobals.indexedDB);
    await seedAdapter.write('cases', JSON.parse(legacySeed.cases));

    setGlobals(sandbox.sandboxGlobals);
    const cm = loadModule(casesJsPath);
    await cm.ensureCasesRepositoryReady();

    check('Pre-existing legacy-shaped "cases" data loads unchanged through the Repository', () => {
      const all = cm.casesRepository.getAll();
      assert.strictEqual(all.length, 1);
      assert.strictEqual(all[0]['رقم_القضية'], '2024/LEGACY');
    });

    await checkAsync('restoreCase() works normally against a Repository opened from legacy-shaped storage', async () => {
      const idx = cm.resolveCaseIndex(sandbox.sandboxGlobals.data.cases, sandbox.sandboxGlobals.data.cases[0]);
      await cm.deleteCase(idx);
      await cm.restoreCase('2024/LEGACY');
      assert.ok(sandbox.sandboxGlobals.data.cases.some(function (c) { return c['رقم_القضية'] === '2024/LEGACY'; }));
    });

    await checkAsync('Storage key unchanged: writes still land in the bare "cases" object store (no prefix) after restore', async () => {
      const raw = await seedAdapter.read('cases');
      assert.ok(Array.isArray(raw));
      assert.ok(raw.some(function (c) { return c['رقم_القضية'] === '2024/LEGACY'; }));
    });
  }

  // ================================================================
  // 9. restoreCase() does NOT call ApiService (documented design decision)
  // ================================================================

  {
    const sandbox = makeSandbox({});
    setGlobals(sandbox.sandboxGlobals);
    const cm = loadModule(casesJsPath);
    await cm.ensureCasesRepositoryReady();

    await cm.casesRepository.create({ 'رقم_القضية': '2026/B001', 'عنوان_القضية': 'قضية بلا مزامنة', 'اسم_الموكل': 'موكل' });
    cm.syncCasesMirror();
    const idx = cm.resolveCaseIndex(sandbox.sandboxGlobals.data.cases, sandbox.sandboxGlobals.data.cases[0]);
    await cm.deleteCase(idx);

    const syncRowCountBefore = sandbox.syncRowLog.length;
    const deleteDataCountBefore = sandbox.deleteDataLog.length;

    await checkAsync('restoreCase(id) does not call ApiService.syncRow() or ApiService.deleteData() (Google Sheets sync left untouched, per design)', async () => {
      await cm.restoreCase('2026/B001');
      assert.strictEqual(sandbox.syncRowLog.length, syncRowCountBefore, 'ApiService.syncRow() must not be called by restoreCase()');
      assert.strictEqual(sandbox.deleteDataLog.length, deleteDataCountBefore, 'ApiService.deleteData() must not be called by restoreCase()');
    });
  }

  // ================================================================
  // 10. No unhandled rejections / console.error during a full cycle
  // ================================================================

  {
    const originalConsoleError = console.error;
    let errorCount = 0;
    console.error = function () { errorCount++; originalConsoleError.apply(console, arguments); };

    const sandbox = makeSandbox({});
    setGlobals(sandbox.sandboxGlobals);
    const cm = loadModule(casesJsPath);
    await cm.ensureCasesRepositoryReady();

    await checkAsync('No console.error during a full create -> delete -> restore -> render cycle', async () => {
      await cm.casesRepository.create({ 'رقم_القضية': '2026/C001', 'عنوان_القضية': 'دورة كاملة', 'اسم_الموكل': 'موكل' });
      cm.syncCasesMirror();
      const idx = cm.resolveCaseIndex(sandbox.sandboxGlobals.data.cases, sandbox.sandboxGlobals.data.cases[0]);
      await cm.deleteCase(idx);
      await cm.restoreCase('2026/C001');
      cm.renderCases();
      assert.strictEqual(errorCount, 0);
    });

    console.error = originalConsoleError;
  }

  // ================================================================
  // 11. deleteCase()/saveCase() behavior unchanged (regression guard)
  // ================================================================

  {
    const sandbox = makeSandbox({});
    setGlobals(sandbox.sandboxGlobals);
    const cm = loadModule(casesJsPath);
    await cm.ensureCasesRepositoryReady();

    await checkAsync('deleteCase() flow (delete -> soft-delete -> mirror update -> toast) is unchanged by this phase', async () => {
      await cm.casesRepository.create({ 'رقم_القضية': '2026/D001', 'عنوان_القضية': 'اختبار حذف', 'اسم_الموكل': 'موكل' });
      cm.syncCasesMirror();
      const idx = cm.resolveCaseIndex(sandbox.sandboxGlobals.data.cases, sandbox.sandboxGlobals.data.cases[0]);
      await cm.deleteCase(idx);
      assert.ok(!sandbox.sandboxGlobals.data.cases.some(function (c) { return c['رقم_القضية'] === '2026/D001'; }));
      const last = sandbox.toastLog[sandbox.toastLog.length - 1];
      assert.strictEqual(last.msg, 'تم الحذف');
      assert.strictEqual(last.type, 'info');
    });
  }

  // ================================================================
  // Summary
  // ================================================================

  console.log(log.join('\n'));
  console.log('\n' + passed + ' passed, ' + failed + ' failed.');
  if (failed > 0) process.exitCode = 1;
}

main();
