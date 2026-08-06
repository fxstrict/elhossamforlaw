/**
 * verify_restore_rollout.js
 * ================================================================
 * PHASE 10 — SUB-PHASE 10.4 — Repository Restore Rollout
 * ================================================================
 * Standalone Node harness (`node js/tests/verify_restore_rollout.js`,
 * no browser required) proving that the new `restore<Entity>(id)`
 * function added to each of the 8 remaining migrated modules —
 * clients.js, sessions.js, tasks.js, documents.js, library.js,
 * templates.js, children.js, fees.js — behaves identically to the
 * `restoreCase(id)` pattern piloted and verified in SUB-PHASE 10.3
 * (js/tests/verify_cases_restore_integration.js), for every module.
 *
 * One shared, table-driven test suite (`runModuleSuite`) is applied to
 * all 8 modules via a config table (`MODULES` below) capturing each
 * module's actual, audited shape (id field, mirror/render/ensure-ready
 * function names, required fields, whether its own `delete<Entity>()`
 * calls `updateBadges()` — Library and Templates do not, matching the
 * existing delete flow exactly) — so the SAME assertions run against
 * every module's real, on-disk code, not a re-implemented mock.
 *
 * Structurally follows js/tests/verify_cases_restore_integration.js:
 * same sandbox/mocking discipline, same Module.wrap()+vm loading
 * technique so each module's internal `require('../repositories/...')`
 * resolves exactly as it would from its real on-disk location.
 *
 * No file is modified by running this harness.
 * ================================================================
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const Module = require('module');
const vm = require('vm');
const { FakeIndexedDB } = require(path.join(__dirname, 'fake_indexeddb.js'));
const { confirmDialog: __confirmDialogStub } = require(path.join(__dirname, '_shared', 'browserStubs.js'));

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

// ---- Fake localStorage ----
function makeFakeStorage(seed) {
  const store = Object.assign({}, seed || {});
  return {
    getItem: function (k) { return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; },
    setItem: function (k, v) { store[k] = String(v); },
    _dump: function () { return store; }
  };
}

// ---- Fake DOM element ----
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
  const syncRowLog = [];
  const deleteDataLog = [];
  const saveLocalCalls = { count: 0 };
  const genClientQRLog = [];

  const sandboxGlobals = {
    localStorage: fakeStorage,
    indexedDB: fakeIndexedDB,
    window: global,
    data: { cases: [], clients: [], sessions: [], tasks: [], documents: [], library: [], templates: [], children: [], fees: [] },
    editIdx: {},
    document: {
      getElementById: function (id) {
        if (!fakeElements[id]) fakeElements[id] = makeFakeElement();
        return fakeElements[id];
      },
      createElement: function () { return makeFakeElement(); },
      addEventListener: function () {}
    },
    toast: function (msg, type) { toastLog.push({ msg: msg, type: type }); },
    updateBadges: function () { badgeCalls.count++; },
    closeModal: function () {},
    formatDate: function (d) { return d || '—'; },
    formatTime: function (t) { return t || '—'; },
    parseLocalDate: function (d) { return d ? new Date(d) : null; },
    urgencyBadge: function () { return '<span class="badge-urgent"></span>'; },
    statusBadge: function (s) { return '<span class="badge-status">' + (s || '') + '</span>'; },
    val: function (id) { const el = fakeElements[id]; return el ? el.value : ''; },
    collectForm: function () { return {}; },
    fillForm: function () {},
    resetForm: function () {},
    populateCaseDropdown: function () {},
    genClientQR: function (idx) { genClientQRLog.push(idx); },
    ApiService: {
      syncRow: function (sheet, obj, idx) { syncRowLog.push({ sheet: sheet, obj: obj, idx: idx }); },
      deleteData: function (sheet, idx) { deleteDataLog.push({ sheet: sheet, idx: idx }); },
      updateData: function () {}
    },
    saveLocal: function () { saveLocalCalls.count++; },
    confirm: function () { return true; },
    confirmDialog: __confirmDialogStub,
    uid: function () { return 'uid-' + Math.random().toString(36).slice(2); },
    API_URL: '',
    DRIVE_URL: '',
    currentTplFilter: 'الكل',
    console: console
  };

  return {
    sandboxGlobals: sandboxGlobals,
    fakeElements: fakeElements,
    toastLog: toastLog,
    badgeCalls: badgeCalls,
    syncRowLog: syncRowLog,
    deleteDataLog: deleteDataLog,
    saveLocalCalls: saveLocalCalls,
    fakeStorage: fakeStorage
  };
}

// ================================================================
// Module config table — one row per remaining migrated module.
// Every field below was confirmed by direct audit of the real
// js/modules/<name>.js and js/repositories/<Name>Repository.js files
// (see docs/Restore_Rollout_Report.md §2 for the full per-module
// audit findings this table is built from).
// ================================================================
const MODULES = [
  {
    label: 'Clients',
    modulePath: 'clients.js',
    repoPath: 'ClientsRepository.js',
    dataKey: 'clients',
    idField: 'رقم_الموكل',
    repoVar: 'clientsRepository',
    ensureReady: 'ensureClientsRepositoryReady',
    syncMirror: 'syncClientsMirror',
    render: 'renderClients',
    deleteFn: 'deleteClient',
    restoreFn: 'restoreClient',
    hasUpdateBadges: true,
    successToast: 'تم استرجاع الموكل',
    errorToast: 'حدث خطأ أثناء استرجاع الموكل',
    deleteToast: 'تم حذف الموكل',
    sample: function (id, extra) { return Object.assign({ 'رقم_الموكل': id, 'الاسم': 'موكل تجريبي' }, extra || {}); },
    searchField: 'الاسم',
    searchValue: 'موكل تجريبي'
  },
  {
    label: 'Sessions',
    modulePath: 'sessions.js',
    repoPath: 'SessionsRepository.js',
    dataKey: 'sessions',
    idField: 'رقم_الجلسة',
    repoVar: 'sessionsRepository',
    ensureReady: 'ensureSessionsRepositoryReady',
    syncMirror: 'syncSessionsMirror',
    render: 'renderSessions',
    deleteFn: 'deleteSession',
    restoreFn: 'restoreSession',
    hasUpdateBadges: true,
    successToast: 'تم الاسترجاع',
    errorToast: 'حدث خطأ أثناء الاسترجاع',
    deleteToast: 'تم الحذف',
    sample: function (id, extra) { return Object.assign({ 'رقم_الجلسة': id, 'التاريخ': '2026-08-01', 'الوقت': '10:00' }, extra || {}); },
    searchField: 'التاريخ',
    searchValue: '2026-08-01'
  },
  {
    label: 'Tasks',
    modulePath: 'tasks.js',
    repoPath: 'TasksRepository.js',
    dataKey: 'tasks',
    idField: 'رقم_المهمة',
    repoVar: 'tasksRepository',
    ensureReady: 'ensureTasksRepositoryReady',
    syncMirror: 'syncTasksMirror',
    render: 'renderTasks',
    deleteFn: 'deleteTask',
    restoreFn: 'restoreTask',
    hasUpdateBadges: true,
    successToast: 'تم الاسترجاع',
    errorToast: 'حدث خطأ أثناء الاسترجاع',
    deleteToast: 'تم الحذف',
    sample: function (id, extra) { return Object.assign({ 'رقم_المهمة': id, 'العنوان': 'مهمة تجريبية' }, extra || {}); },
    searchField: 'العنوان',
    searchValue: 'مهمة تجريبية'
  },
  {
    label: 'Documents',
    modulePath: 'documents.js',
    repoPath: 'DocumentsRepository.js',
    dataKey: 'documents',
    idField: 'رقم_المستند',
    repoVar: 'documentsRepository',
    ensureReady: 'ensureDocumentsRepositoryReady',
    syncMirror: 'syncDocumentsMirror',
    render: 'renderDocuments',
    deleteFn: 'deleteDocument',
    restoreFn: 'restoreDocument',
    hasUpdateBadges: true,
    successToast: 'تم الاسترجاع',
    errorToast: 'حدث خطأ أثناء الاسترجاع',
    deleteToast: 'تم الحذف',
    sample: function (id, extra) { return Object.assign({ 'رقم_المستند': id, 'رقم_القضية': '2026/1', 'اسم_المستند': 'مستند تجريبي' }, extra || {}); },
    searchField: 'اسم_المستند',
    searchValue: 'مستند تجريبي'
  },
  {
    label: 'Library',
    modulePath: 'library.js',
    repoPath: 'LibraryRepository.js',
    dataKey: 'library',
    idField: 'id',
    repoVar: 'libraryRepository',
    ensureReady: 'ensureLibraryRepositoryReady',
    syncMirror: 'syncLibraryMirror',
    render: 'renderLibrary',
    deleteFn: 'deleteLibBook',
    restoreFn: 'restoreLibBook',
    hasUpdateBadges: false,
    successToast: 'تم الاسترجاع',
    errorToast: 'حدث خطأ أثناء الاسترجاع',
    deleteToast: 'تم الحذف',
    sample: function (id, extra) { return Object.assign({ 'id': id, 'العنوان': 'كتاب تجريبي' }, extra || {}); },
    searchField: 'العنوان',
    searchValue: 'كتاب تجريبي'
  },
  {
    label: 'Templates',
    modulePath: 'templates.js',
    repoPath: 'TemplatesRepository.js',
    dataKey: 'templates',
    idField: 'id',
    repoVar: 'templatesRepository',
    ensureReady: 'ensureTemplatesRepositoryReady',
    syncMirror: 'syncTemplatesMirror',
    render: 'renderTemplates',
    deleteFn: 'deleteTemplate',
    restoreFn: 'restoreTemplate',
    hasUpdateBadges: false,
    successToast: 'تم الاسترجاع',
    errorToast: 'حدث خطأ أثناء الاسترجاع',
    deleteToast: 'تم الحذف',
    sample: function (id, extra) { return Object.assign({ 'id': id, 'العنوان': 'صيغة تجريبية', 'القسم': 'مدني' }, extra || {}); },
    searchField: 'العنوان',
    searchValue: 'صيغة تجريبية'
  },
  {
    label: 'Children',
    modulePath: 'children.js',
    repoPath: 'ChildrenRepository.js',
    dataKey: 'children',
    idField: 'رقم_الطفل',
    repoVar: 'childrenRepository',
    ensureReady: 'ensureChildrenRepositoryReady',
    syncMirror: 'syncChildrenMirror',
    render: 'renderChildren',
    deleteFn: 'deleteChild',
    restoreFn: 'restoreChild',
    hasUpdateBadges: true,
    successToast: 'تم الاسترجاع',
    errorToast: 'حدث خطأ أثناء الاسترجاع',
    deleteToast: 'تم الحذف',
    sample: function (id, extra) { return Object.assign({ 'رقم_الطفل': id, 'رقم_القضية': '2026/1', 'الاسم': 'طفل تجريبي' }, extra || {}); },
    searchField: 'الاسم',
    searchValue: 'طفل تجريبي'
  },
  {
    label: 'Fees',
    modulePath: 'fees.js',
    repoPath: 'FeesRepository.js',
    dataKey: 'fees',
    idField: 'رقم_العملية',
    repoVar: 'feesRepository',
    ensureReady: 'ensureFeesRepositoryReady',
    syncMirror: 'syncFeesMirror',
    render: 'renderFees',
    deleteFn: 'deleteFee',
    restoreFn: 'restoreFee',
    hasUpdateBadges: true,
    successToast: 'تم الاسترجاع',
    errorToast: 'حدث خطأ أثناء الاسترجاع',
    deleteToast: 'تم الحذف',
    sample: function (id, extra) { return Object.assign({ 'رقم_العملية': id, 'رقم_القضية': '2026/1', 'المبلغ': 1000 }, extra || {}); },
    searchField: 'رقم_القضية',
    searchValue: '2026/1'
  }
];

async function runModuleSuite(cfg) {
  const modulesDir = path.join(__dirname, '..', 'modules');
  const reposDir = path.join(__dirname, '..', 'repositories');
  const modulePath = path.join(modulesDir, cfg.modulePath);
  const repoPath = path.join(reposDir, cfg.repoPath);

  // ---- 0. Static checks ----
  check('[' + cfg.label + '] module file parses via vm', () => {
    const code = fs.readFileSync(modulePath, 'utf8');
    assert.doesNotThrow(() => new vm.Script(Module.wrap(code), { filename: modulePath }));
  });

  check('[' + cfg.label + '] Repository file on disk exports the constructor unmodified', () => {
    const ns = require(repoPath);
    const ctorName = cfg.repoPath.replace('.js', '');
    assert.strictEqual(typeof ns[ctorName], 'function');
  });

  // ---- 1. Core flow: create -> delete -> restore ----
  {
    const sandbox = makeSandbox({});
    setGlobals(sandbox.sandboxGlobals);
    const mod = loadModule(modulePath);

    await mod[cfg.ensureReady]();

    check('[' + cfg.label + '] ' + cfg.restoreFn + ' is exported as a function', () => {
      assert.strictEqual(typeof mod[cfg.restoreFn], 'function');
    });

    const id1 = 'R10.4-' + cfg.label + '-001';
    const id2 = 'R10.4-' + cfg.label + '-002';
    const r1 = await mod[cfg.repoVar].create(cfg.sample(id1));
    const r2 = await mod[cfg.repoVar].create(cfg.sample(id2));
    assert.ok(r1.success && r2.success, cfg.label + ' setup: both seed records must be created');
    mod[cfg.syncMirror]();

    // delete() performed via direct repository call here (isolated from
    // deleteFn's own ApiService side effects); deleteFn's own behavior
    // is separately regression-tested in §10 below.
    await mod[cfg.repoVar].delete(id2);
    mod[cfg.syncMirror]();

    check('[' + cfg.label + '] soft-deleted record vanishes from data.' + cfg.dataKey, () => {
      assert.ok(!sandbox.sandboxGlobals.data[cfg.dataKey].some(function (r) { return r[cfg.idField] === id2; }));
    });

    check('[' + cfg.label + '] soft-deleted record still present with includeDeleted:true', () => {
      const all = mod[cfg.repoVar].getAll({ includeDeleted: true });
      const tombstone = all.find(function (r) { return r[cfg.idField] === id2; });
      assert.ok(tombstone && tombstone.deletedAt);
    });

    const toastBefore = sandbox.toastLog.length;
    const badgeBefore = sandbox.badgeCalls.count;
    const saveLocalBefore = sandbox.saveLocalCalls.count;

    await checkAsync('[' + cfg.label + '] ' + cfg.restoreFn + '(id): record reappears in data.' + cfg.dataKey, async () => {
      await mod[cfg.restoreFn](id2);
      assert.ok(sandbox.sandboxGlobals.data[cfg.dataKey].some(function (r) { return r[cfg.idField] === id2; }));
    });

    check('[' + cfg.label + '] deletedAt cleared on restored record', () => {
      const restored = sandbox.sandboxGlobals.data[cfg.dataKey].find(function (r) { return r[cfg.idField] === id2; });
      assert.strictEqual(restored.deletedAt, null);
    });

    check('[' + cfg.label + '] repository.exists(id) is true again after restore', () => {
      assert.strictEqual(mod[cfg.repoVar].exists(id2), true);
    });

    check('[' + cfg.label + '] mirror length reflects both records after restore', () => {
      assert.strictEqual(sandbox.sandboxGlobals.data[cfg.dataKey].length, 2);
    });

    check('[' + cfg.label + '] saveLocal() called during restore', () => {
      assert.ok(sandbox.saveLocalCalls.count > saveLocalBefore);
    });

    check('[' + cfg.label + '] success toast shown on restore', () => {
      assert.ok(sandbox.toastLog.length > toastBefore);
      const last = sandbox.toastLog[sandbox.toastLog.length - 1];
      assert.strictEqual(last.msg, cfg.successToast);
      assert.strictEqual(last.type, 'success');
    });

    if (cfg.hasUpdateBadges) {
      check('[' + cfg.label + '] updateBadges() called during restore (matches its delete() flow)', () => {
        assert.ok(sandbox.badgeCalls.count > badgeBefore);
      });
    } else {
      check('[' + cfg.label + '] updateBadges() NOT called during restore (matches its own delete() flow, which also does not call it)', () => {
        assert.strictEqual(sandbox.badgeCalls.count, badgeBefore);
      });
    }
  }

  // ---- 2. Idempotent restore on a never-deleted record ----
  {
    const sandbox = makeSandbox({});
    setGlobals(sandbox.sandboxGlobals);
    const mod = loadModule(modulePath);
    await mod[cfg.ensureReady]();

    const id = 'R10.4-' + cfg.label + '-idem';
    await mod[cfg.repoVar].create(cfg.sample(id));
    mod[cfg.syncMirror]();

    await checkAsync('[' + cfg.label + '] restore on an already-live record is idempotent (no error)', async () => {
      await mod[cfg.restoreFn](id);
      const last = sandbox.toastLog[sandbox.toastLog.length - 1];
      assert.strictEqual(last.type, 'success');
    });

    check('[' + cfg.label + '] idempotent restore: record present exactly once', () => {
      const matches = sandbox.sandboxGlobals.data[cfg.dataKey].filter(function (r) { return r[cfg.idField] === id; });
      assert.strictEqual(matches.length, 1);
    });
  }

  // ---- 3. Restore on unknown id ----
  {
    const sandbox = makeSandbox({});
    setGlobals(sandbox.sandboxGlobals);
    const mod = loadModule(modulePath);
    await mod[cfg.ensureReady]();

    await checkAsync('[' + cfg.label + '] restore on an unknown id fails gracefully, no throw', async () => {
      await assert.doesNotReject(mod[cfg.restoreFn]('does-not-exist-R10.4'));
      const last = sandbox.toastLog[sandbox.toastLog.length - 1];
      assert.strictEqual(last.msg, cfg.errorToast);
      assert.strictEqual(last.type, 'error');
    });

    check('[' + cfg.label + '] restore on unknown id: no phantom record created', () => {
      assert.strictEqual(sandbox.sandboxGlobals.data[cfg.dataKey].length, 0);
    });
  }

  // ---- 4. Duplicate/repeated restore prevention, no data loss ----
  {
    const sandbox = makeSandbox({});
    setGlobals(sandbox.sandboxGlobals);
    const mod = loadModule(modulePath);
    await mod[cfg.ensureReady]();

    const id = 'R10.4-' + cfg.label + '-dup';
    await mod[cfg.repoVar].create(cfg.sample(id));
    mod[cfg.syncMirror]();
    await mod[cfg.repoVar].delete(id);
    mod[cfg.syncMirror]();

    await checkAsync('[' + cfg.label + '] first restore succeeds', async () => {
      await mod[cfg.restoreFn](id);
      assert.ok(sandbox.sandboxGlobals.data[cfg.dataKey].some(function (r) { return r[cfg.idField] === id; }));
    });

    await checkAsync('[' + cfg.label + '] repeated restore is idempotent, no duplicate created', async () => {
      await mod[cfg.restoreFn](id);
      const matches = sandbox.sandboxGlobals.data[cfg.dataKey].filter(function (r) { return r[cfg.idField] === id; });
      assert.strictEqual(matches.length, 1);
    });

    check('[' + cfg.label + '] no data loss across delete -> restore -> restore', () => {
      const rec = sandbox.sandboxGlobals.data[cfg.dataKey].find(function (r) { return r[cfg.idField] === id; });
      const original = cfg.sample(id);
      Object.keys(original).forEach(function (k) {
        assert.strictEqual(rec[k], original[k], 'field ' + k + ' must survive restore unchanged');
      });
    });
  }

  // ---- 5. includeDeleted visibility + search after restore ----
  {
    const sandbox = makeSandbox({});
    setGlobals(sandbox.sandboxGlobals);
    const mod = loadModule(modulePath);
    await mod[cfg.ensureReady]();

    const id = 'R10.4-' + cfg.label + '-vis';
    await mod[cfg.repoVar].create(cfg.sample(id));
    mod[cfg.syncMirror]();
    await mod[cfg.repoVar].delete(id);

    check('[' + cfg.label + '] getAll() default hides the soft-deleted record', () => {
      const visible = mod[cfg.repoVar].getAll();
      assert.ok(!visible.some(function (r) { return r[cfg.idField] === id; }));
    });

    check('[' + cfg.label + '] getAll({includeDeleted:true}) returns it', () => {
      const all = mod[cfg.repoVar].getAll({ includeDeleted: true });
      assert.ok(all.some(function (r) { return r[cfg.idField] === id; }));
    });

    await checkAsync('[' + cfg.label + '] after restore, getAll() default includes it again', async () => {
      await mod[cfg.restoreFn](id);
      const visible = mod[cfg.repoVar].getAll();
      assert.ok(visible.some(function (r) { return r[cfg.idField] === id; }));
    });

    check('[' + cfg.label + '] search() after restore matches the restored record', () => {
      const q = {};
      q.search = cfg.searchValue;
      const result = mod[cfg.repoVar].search(q);
      assert.ok(result.items.some(function (r) { return r[cfg.idField] === id; }));
    });
  }

  // ---- 6. Persistence after reopen ----
  {
    const sandbox = makeSandbox({});
    setGlobals(sandbox.sandboxGlobals);
    const mod = loadModule(modulePath);
    await mod[cfg.ensureReady]();

    const id = 'R10.4-' + cfg.label + '-reopen';
    await mod[cfg.repoVar].create(cfg.sample(id));
    mod[cfg.syncMirror]();
    await mod[cfg.repoVar].delete(id);
    await mod[cfg.restoreFn](id);

    await checkAsync('[' + cfg.label + '] restored state survives a fresh Repository instance ("reopen")', async () => {
      const RepoNS = require(repoPath);
      const ctorName = cfg.repoPath.replace('.js', '');
      const freshRepo = new RepoNS[ctorName]();
      await freshRepo.open();
      const rec = freshRepo.getAll().find(function (r) { return r[cfg.idField] === id; });
      assert.ok(rec, 'restored record must persist across a fresh Repository instance');
      assert.strictEqual(rec.deletedAt, null);
    });
  }

  // ---- 7. Backward compatibility with pre-existing (legacy-shaped) data ----
  // PHASE 13.6: Repository now persists exclusively through
  // IndexedDBAdapter, so a raw localStorage[cfg.dataKey] JSON string is
  // no longer read at all — seed the object store directly instead,
  // via the same create<Entity>LocalStorageAdapter() factory each
  // Repository module exports (looked up generically since this block
  // runs once per entity in MODULES).
  {
    const legacySeed = {};
    const legacyRecord = cfg.sample('R10.4-' + cfg.label + '-legacy', { deletedAt: null });
    legacySeed[cfg.dataKey] = JSON.stringify([legacyRecord]);
    const sandbox = makeSandbox(legacySeed);

    const RepoNS = require(repoPath);
    const adapterFactoryName = Object.keys(RepoNS).find(function (k) {
      return /^create.*LocalStorageAdapter$/.test(k);
    });
    const seedAdapter = RepoNS[adapterFactoryName](sandbox.sandboxGlobals.indexedDB);
    await seedAdapter.write(cfg.dataKey, [legacyRecord]);

    setGlobals(sandbox.sandboxGlobals);
    const mod = loadModule(modulePath);
    await mod[cfg.ensureReady]();

    check('[' + cfg.label + '] pre-existing legacy-shaped data loads unchanged', () => {
      const all = mod[cfg.repoVar].getAll();
      assert.strictEqual(all.length, 1);
    });

    await checkAsync('[' + cfg.label + '] restore works normally against legacy-shaped storage', async () => {
      const legacyId = 'R10.4-' + cfg.label + '-legacy';
      await mod[cfg.repoVar].delete(legacyId);
      await mod[cfg.restoreFn](legacyId);
      assert.ok(sandbox.sandboxGlobals.data[cfg.dataKey].some(function (r) { return r[cfg.idField] === legacyId; }));
    });
  }

  // ---- 8. No ApiService call from restore (documented design decision) ----
  {
    const sandbox = makeSandbox({});
    setGlobals(sandbox.sandboxGlobals);
    const mod = loadModule(modulePath);
    await mod[cfg.ensureReady]();

    const id = 'R10.4-' + cfg.label + '-noapi';
    await mod[cfg.repoVar].create(cfg.sample(id));
    mod[cfg.syncMirror]();
    await mod[cfg.repoVar].delete(id);

    const syncRowBefore = sandbox.syncRowLog.length;
    const deleteDataBefore = sandbox.deleteDataLog.length;

    await checkAsync('[' + cfg.label + '] restore does not call ApiService.syncRow()/deleteData() (Sheets sync untouched)', async () => {
      await mod[cfg.restoreFn](id);
      assert.strictEqual(sandbox.syncRowLog.length, syncRowBefore);
      assert.strictEqual(sandbox.deleteDataLog.length, deleteDataBefore);
    });
  }

  // ---- 9. No console.error during a full cycle; render doesn't throw ----
  {
    const originalConsoleError = console.error;
    let errorCount = 0;
    console.error = function () { errorCount++; originalConsoleError.apply(console, arguments); };

    const sandbox = makeSandbox({});
    setGlobals(sandbox.sandboxGlobals);
    const mod = loadModule(modulePath);
    await mod[cfg.ensureReady]();

    await checkAsync('[' + cfg.label + '] no console.error during create -> delete -> restore -> render cycle', async () => {
      const id = 'R10.4-' + cfg.label + '-cycle';
      await mod[cfg.repoVar].create(cfg.sample(id));
      mod[cfg.syncMirror]();
      await mod[cfg.repoVar].delete(id);
      await mod[cfg.restoreFn](id);
      mod[cfg.render]();
      assert.strictEqual(errorCount, 0);
    });

    console.error = originalConsoleError;
  }

  // ---- 10. Regression guard: deleteFn's own existing behavior unchanged ----
  {
    const sandbox = makeSandbox({});
    setGlobals(sandbox.sandboxGlobals);
    const mod = loadModule(modulePath);
    await mod[cfg.ensureReady]();

    await checkAsync('[' + cfg.label + '] ' + cfg.deleteFn + '() flow is unchanged by this phase', async () => {
      const id = 'R10.4-' + cfg.label + '-regress';
      await mod[cfg.repoVar].create(cfg.sample(id));
      mod[cfg.syncMirror]();
      const idx = sandbox.sandboxGlobals.data[cfg.dataKey].findIndex(function (r) { return r[cfg.idField] === id; });
      await mod[cfg.deleteFn](idx);
      assert.ok(!sandbox.sandboxGlobals.data[cfg.dataKey].some(function (r) { return r[cfg.idField] === id; }));
      const last = sandbox.toastLog[sandbox.toastLog.length - 1];
      assert.strictEqual(last.msg, cfg.deleteToast);
      assert.strictEqual(last.type, 'info');
    });
  }
}

async function main() {
  for (const cfg of MODULES) {
    await runModuleSuite(cfg);
  }

  console.log(log.join('\n'));
  console.log('\n' + passed + ' passed, ' + failed + ' failed.');
  if (failed > 0) process.exitCode = 1;
}

main();
