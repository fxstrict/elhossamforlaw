/**
 * verify_cases_repository_integration.js
 * ================================================================
 * PHASE 9 — SUB-PHASE 9.13 — Repository Integration (Cases Module)
 * ================================================================
 * Standalone Node harness (`node js/tests/verify_cases_repository_
 * integration.js`, no browser required) proving that js/modules/
 * cases.js — after this phase's migration — behaves identically to the
 * pre-migration inline module from the caller's point of view, while now
 * reading/writing exclusively through js/repositories/CasesRepository.js.
 * Structurally mirrors js/tests/verify_clients_repository_integration.js
 * (Sub-Phase 9.11), extended for Cases' own distinguishing features per
 * docs/Cases_Repository_Integration_Audit.md:
 *   - a NATURAL KEY (رقم_القضية, user-entered) instead of an
 *     auto-generated id — this is the only migrated module with this
 *     shape, so it gets its own duplicate-key rejection test (§5/§17.1);
 *   - FIVE index-dependent action buttons per row instead of Clients'
 *     four (editCase/viewCase/quickPrintCase/quickCaseQR/deleteCase);
 *   - two filter dropdowns (فلترة الحالة/فلترة النوع) combined with
 *     free-text search, all through one Repository.search() call;
 *   - the embedded-children JSON sub-system threaded through saveCase()
 *     via window._pendingChildren (§8), left completely alone;
 *   - the viewCase()/quickPrintCase() client-field backfill asymmetry
 *     (§7), explicitly tested to confirm it is preserved, not fixed.
 *
 * Because cases.js is a classic (non-module) browser script that
 * references a pile of globals (`data`, `editIdx`, `document`, `toast`,
 * `saveLocal`, `ApiService`, `val`, `collectForm`, `fillForm`,
 * `resetForm`, `closeModal`, `updateBadges`, `confirm`, `formatDate`,
 * `formatTime`, `parseLocalDate`, `urgencyBadge`, `statusBadge`,
 * `genClientQR`, `window`), this harness loads the REAL
 * js/modules/cases.js file (via Node's own Module wrapper, so its
 * internal `require('../repositories/CasesRepository.js')` resolves
 * exactly the way it would from its real location on disk) inside a
 * sandbox that stubs those globals with small, inspectable fakes — the
 * same "single boundary" mocking discipline every existing verify_*.js
 * harness in this project already uses for localStorage.
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
const { windowPrint: __windowPrintStub } = require(path.join(__dirname, '_shared', 'browserStubs.js'));

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

// ---- Fake localStorage (matches getItem/setItem shape only — same
//      fake every existing verify_*_repository.js harness uses) ----
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
 * cases.js is a classic (non-module) browser script: it references bare
 * identifiers like `data`/`document`/`toast` that are NOT among
 * Module.wrap's function parameters, so they must be resolved via the
 * scope chain, which bottoms out at the real global object when the
 * file is compiled with `vm`'s `runInThisContext`. Because cases.js
 * itself kicks off an async `.open().then(...)` chain at load time whose
 * continuation (syncCasesMirror, referencing `data`) runs on a LATER
 * microtask turn, these globals must stay assigned for as long as that
 * module instance is in use — not just for the duration of the
 * synchronous load call. Each test block below calls this once with a
 * fresh set of fakes before loading/using its own module instance.
 * @param {Object} extraGlobals
 */
function setGlobals(extraGlobals) {
  Object.keys(extraGlobals).forEach(function (k) {
    global[k] = extraGlobals[k];
  });
}

/**
 * Loads a CommonJS file via Node's own Module wrapper so its internal
 * relative `require()` calls resolve exactly as they would from its real
 * on-disk location (js/modules/cases.js's
 * `require('../repositories/CasesRepository.js')` must resolve to
 * js/repositories/CasesRepository.js, not to something relative to this
 * test file). Call `setGlobals()` first with whatever fakes the file
 * needs to find on the global object.
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
 * Builds a fresh sandbox globals object. Shared shape used by every test
 * block below; each block gets its own fakeElements/logs closure.
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
  const apiServicePath = path.join(__dirname, '..', 'api', 'api.js');
  const dashboardJsPath = path.join(__dirname, '..', 'modules', 'dashboard.js');
  const clientsJsPath = path.join(__dirname, '..', 'modules', 'clients.js');
  const sessionsJsPath = path.join(__dirname, '..', 'modules', 'sessions.js');
  const documentsJsPath = path.join(__dirname, '..', 'modules', 'documents.js');
  const feesJsPath = path.join(__dirname, '..', 'modules', 'fees.js');
  const libraryJsPath = path.join(__dirname, '..', 'modules', 'library.js');
  const templatesJsPath = path.join(__dirname, '..', 'modules', 'templates.js');

  // ================================================================
  // 1. Static checks — only cases.js touched, nothing else edited
  // ================================================================

  check('js/modules/cases.js exists and is valid JS (node --check equivalent: parses via vm)', () => {
    const code = fs.readFileSync(casesJsPath, 'utf8');
    assert.doesNotThrow(() => new vm.Script(Module.wrap(code), { filename: casesJsPath }));
  });

  check('CasesRepository.js on disk is unmodified (still exports CasesRepository + factory)', () => {
    const ns = require(casesRepoPath);
    assert.strictEqual(typeof ns.CasesRepository, 'function');
    assert.strictEqual(typeof ns.createCasesLocalStorageAdapter, 'function');
  });

  check('Repository.js on disk is unmodified (still exports Repository)', () => {
    const ns = require(repositoryCorePath);
    assert.strictEqual(typeof ns.Repository, 'function');
  });

  check('DatabaseService.js on disk is unmodified (still exports DatabaseService)', () => {
    const ns = require(databaseServicePath);
    assert.strictEqual(typeof ns.DatabaseService, 'function');
  });

  check('LocalStorageAdapter.js on disk is unmodified (still exports LocalStorageAdapter)', () => {
    const ns = require(localStorageAdapterPath);
    assert.strictEqual(typeof ns.LocalStorageAdapter, 'function');
  });

  check('ApiService (js/api/api.js) file is present on disk, untouched by this phase', () => {
    assert.ok(fs.existsSync(apiServicePath));
  });

  check('dashboard.js still reads plain data.cases.filter()/.length (file untouched by this phase)', () => {
    const code = fs.readFileSync(dashboardJsPath, 'utf8');
    assert.ok(code.indexOf('data.cases.filter') !== -1);
    assert.ok(code.indexOf('data.cases.length') !== -1);
  });

  check('clients.js still reads plain data.cases (linkedCases filter, file untouched by this phase)', () => {
    const code = fs.readFileSync(clientsJsPath, 'utf8');
    assert.ok(code.indexOf('data.cases') !== -1);
  });

  check('sessions.js/documents.js/fees.js still call populateCaseDropdown()/autofillSessionFromCase()/autofillFeeFromCase() unmodified (natural-key-only reads, no index dependency)', () => {
    assert.ok(fs.readFileSync(sessionsJsPath, 'utf8').indexOf('populateCaseDropdown') !== -1);
    assert.ok(fs.readFileSync(sessionsJsPath, 'utf8').indexOf('autofillSessionFromCase') !== -1);
    assert.ok(fs.readFileSync(documentsJsPath, 'utf8').indexOf('populateCaseDropdown') !== -1);
    assert.ok(fs.readFileSync(feesJsPath, 'utf8').indexOf('populateCaseDropdown') !== -1);
    assert.ok(fs.readFileSync(feesJsPath, 'utf8').indexOf('autofillFeeFromCase') !== -1);
  });

  check('library.js/templates.js have zero Cases cross-references (unaffected by this migration)', () => {
    assert.strictEqual(fs.readFileSync(libraryJsPath, 'utf8').indexOf('data.cases'), -1);
    assert.strictEqual(fs.readFileSync(templatesJsPath, 'utf8').indexOf('data.cases'), -1);
  });

  // ================================================================
  // 2. Fresh load (empty localStorage — real first-run condition)
  // ================================================================

  let casesModule, sandbox, secondCaseIndex = -1, secondCaseId = null;

  {
    sandbox = makeSandbox({});
    const { sandboxGlobals, fakeElements, toastLog, badgeCalls, closeModalLog, syncRowLog, saveLocalCalls } = sandbox;

    setGlobals(sandboxGlobals);
    casesModule = loadModule(casesJsPath);

    await checkAsync('Fresh load: repository opens with zero records, data.cases mirror is []', async () => {
      await casesModule.ensureCasesRepositoryReady();
      assert.deepStrictEqual(casesModule.casesRepository.getAll(), []);
      assert.deepStrictEqual(sandboxGlobals.data.cases, []);
    });

    // ---- CREATE via saveCase() ----
    await checkAsync('saveCase(): create path (editIdx.cases = -1) inserts a new record via Repository.create(), stamps تاريخ_الإنشاء/آخر_تحديث', async () => {
      fakeElements['fCaseNum'] = makeFakeElement();
      fakeElements['fCaseNum'].value = '2025/1001';
      fakeElements['fCaseTitle'] = makeFakeElement();
      fakeElements['fCaseTitle'].value = 'قضية نفقة';
      fakeElements['fCaseClient'] = makeFakeElement();
      fakeElements['fCaseClient'].value = 'أحمد محمود';

      sandboxGlobals.__nextFormValue = {
        'رقم_القضية': '2025/1001',
        'عنوان_القضية': 'قضية نفقة',
        'اسم_الموكل': 'أحمد محمود',
        'نوع_الدعوى': 'أحوال شخصية',
        'الحالة': 'نشطة'
      };
      sandboxGlobals.editIdx.cases = -1;

      await casesModule.saveCase();

      assert.strictEqual(sandboxGlobals.data.cases.length, 1);
      const rec = sandboxGlobals.data.cases[0];
      assert.strictEqual(rec['رقم_القضية'], '2025/1001');
      assert.ok(rec['تاريخ_الإنشاء'], 'تاريخ_الإنشاء must have been stamped');
      assert.ok(rec['آخر_تحديث'], 'آخر_تحديث must have been stamped');
      assert.strictEqual(toastLog[toastLog.length - 1].msg, 'تمت إضافة القضية');
      assert.strictEqual(saveLocalCalls.count, 1);
      assert.strictEqual(syncRowLog[syncRowLog.length - 1].sheet, 'القضايا');
      assert.strictEqual(syncRowLog[syncRowLog.length - 1].idx, -1);
      assert.strictEqual(closeModalLog[closeModalLog.length - 1], 'modalCase');
      assert.strictEqual(badgeCalls.count, 1);
    });

    // ---- CREATE a second record (for search/filter/index/QR tests) ----
    await checkAsync('saveCase(): create a second record with a different رقم_القضية', async () => {
      fakeElements['fCaseNum'].value = '2025/1002';
      fakeElements['fCaseTitle'].value = 'قضية طلاق';
      fakeElements['fCaseClient'].value = 'سارة عبد الله';
      sandboxGlobals.__nextFormValue = {
        'رقم_القضية': '2025/1002',
        'عنوان_القضية': 'قضية طلاق',
        'اسم_الموكل': 'سارة عبد الله',
        'نوع_الدعوى': 'مدني',
        'الحالة': 'معلقة',
        'الملاحظات': 'قضية عاجلة جداً'
      };
      sandboxGlobals.editIdx.cases = -1;
      await casesModule.saveCase();
      assert.strictEqual(sandboxGlobals.data.cases.length, 2);
    });

    // ---- VALIDATION: missing required field blocked before any Repository call ----
    check('saveCase(): empty fCaseClient is still blocked with the original Arabic toast, before any Repository call', () => {
      fakeElements['fCaseClient'].value = '   ';
      const before = sandboxGlobals.data.cases.length;
      const toastCountBefore = toastLog.length;
      // saveCase() is async but the guard clause returns before any
      // await, so no promise needs to be awaited for this observation.
      casesModule.saveCase();
      assert.strictEqual(sandboxGlobals.data.cases.length, before);
      assert.strictEqual(toastLog.length, toastCountBefore + 1);
      assert.strictEqual(toastLog[toastLog.length - 1].msg, 'يرجى ملء الحقول الإلزامية');
      assert.strictEqual(toastLog[toastLog.length - 1].type, 'error');
      fakeElements['fCaseClient'].value = 'سارة عبد الله'; // restore for later checks
    });

    // ---- NEW BEHAVIOR (audit §5/§17.1): duplicate رقم_القضية now REJECTED, where data.cases.push() never used to fail ----
    await checkAsync('saveCase(): create path with a رقم_القضية that already exists is now REJECTED by Repository.create() (CONFLICT), surfaced as a specific toast, no duplicate row created', async () => {
      fakeElements['fCaseNum'].value = '2025/1001'; // already used by case #1
      fakeElements['fCaseTitle'].value = 'قضية مكررة بالخطأ';
      fakeElements['fCaseClient'].value = 'موكل آخر';
      sandboxGlobals.__nextFormValue = {
        'رقم_القضية': '2025/1001',
        'عنوان_القضية': 'قضية مكررة بالخطأ',
        'اسم_الموكل': 'موكل آخر'
      };
      sandboxGlobals.editIdx.cases = -1; // add mode, not edit — this is the new failure path

      const before = sandboxGlobals.data.cases.length;
      await casesModule.saveCase();

      assert.strictEqual(sandboxGlobals.data.cases.length, before, 'no duplicate row must have been created');
      assert.strictEqual(toastLog[toastLog.length - 1].type, 'error');
      assert.ok(toastLog[toastLog.length - 1].msg.indexOf('2025/1001') !== -1, 'the specific duplicate toast must name the offending رقم_القضية');
    });

    // ---- READ: renderCases() full-record free-text search (Repository.search(), synchronous) ----
    check('renderCases(): full-record free-text search still matches on notes field (not just the 4-field CASES_SEARCH_FIELDS list)', () => {
      fakeElements['searchCases'] = makeFakeElement();
      fakeElements['searchCases'].value = 'عاجلة'; // only in case #2's الملاحظات
      fakeElements['casesTableBody'] = makeFakeElement();
      fakeElements['casesMobileList'] = makeFakeElement();
      fakeElements['casesEmpty'] = makeFakeElement();
      fakeElements['casesCount'] = makeFakeElement();
      fakeElements['filterCaseStatus'] = makeFakeElement();
      fakeElements['filterCaseType'] = makeFakeElement();

      casesModule.renderCases();

      assert.ok(fakeElements['casesTableBody'].innerHTML.indexOf('قضية طلاق') !== -1);
      assert.ok(fakeElements['casesTableBody'].innerHTML.indexOf('قضية نفقة') === -1);
      assert.strictEqual(fakeElements['casesEmpty'].style.display, 'none');
    });

    // ---- READ: status/type filter dropdowns, AND-combined with search (Repository search+filter in one call) ----
    check('renderCases(): فلترة الحالة/فلترة النوع dropdowns still AND-combine with free-text search via a single Repository.search({filter,search}) call', () => {
      fakeElements['searchCases'].value = '';
      fakeElements['filterCaseStatus'].value = 'معلقة';
      fakeElements['filterCaseType'].value = 'مدني';

      casesModule.renderCases();
      assert.ok(fakeElements['casesTableBody'].innerHTML.indexOf('قضية طلاق') !== -1);
      assert.ok(fakeElements['casesTableBody'].innerHTML.indexOf('قضية نفقة') === -1);

      fakeElements['filterCaseType'].value = 'أحوال شخصية'; // wrong type for case #2 -> AND semantics exclude it
      casesModule.renderCases();
      assert.strictEqual(fakeElements['casesTableBody'].innerHTML, '');
      assert.strictEqual(fakeElements['casesEmpty'].style.display, '');

      fakeElements['filterCaseStatus'].value = '';
      fakeElements['filterCaseType'].value = '';
    });

    // ---- READ: empty-result path (#casesEmpty shown, both lists cleared) ----
    check('renderCases(): no matches shows #casesEmpty and clears both lists', () => {
      fakeElements['searchCases'].value = 'نص-غير-موجود-إطلاقاً';
      casesModule.renderCases();
      assert.strictEqual(fakeElements['casesTableBody'].innerHTML, '');
      assert.strictEqual(fakeElements['casesMobileList'].innerHTML, '');
      assert.strictEqual(fakeElements['casesEmpty'].style.display, '');
    });

    // ---- searchCases()/filterCases() aliases still just delegate to renderCases() ----
    check('searchCases()/filterCases(): pure alias/delegates to renderCases() (identical output)', () => {
      fakeElements['searchCases'].value = '';
      casesModule.searchCases();
      assert.ok(fakeElements['casesTableBody'].innerHTML.indexOf('قضية نفقة') !== -1);
      assert.ok(fakeElements['casesTableBody'].innerHTML.indexOf('قضية طلاق') !== -1);
      casesModule.filterCases();
      assert.ok(fakeElements['casesTableBody'].innerHTML.indexOf('قضية نفقة') !== -1);
    });

    // ---- Search order matches plain insertion order (audit §4 — the one Cases-specific check Clients' migration didn't need) ----
    check('renderCases(): Repository.search() result order matches plain insertion order (no accidental CASES_SORT_FIELDS activation)', () => {
      const html = fakeElements['casesTableBody'].innerHTML;
      assert.ok(html.indexOf('قضية نفقة') < html.indexOf('قضية طلاق'), 'case #1 (inserted first) must still render before case #2');
    });

    // ---- Index -> record -> id translation layer, exercised end-to-end (audit §16.3 — FIVE buttons, one more than Clients' four) ----
    check('renderCases(): embeds resolvable indexes in all FIVE per-row onclick handlers matching the data.cases mirror (R-01 fixed via resolveCaseIndex)', () => {
      secondCaseIndex = casesModule.resolveCaseIndex(sandboxGlobals.data.cases, sandboxGlobals.data.cases[1]);
      secondCaseId = sandboxGlobals.data.cases[1][casesModule.CASES_ID_FIELD];
      assert.strictEqual(secondCaseIndex, 1);
      ['editCase', 'viewCase', 'quickPrintCase', 'quickCaseQR', 'deleteCase'].forEach(function (fnName) {
        assert.ok(
          fakeElements['casesTableBody'].innerHTML.indexOf(fnName + '(' + secondCaseIndex + ')') !== -1,
          'desktop table row must embed ' + fnName + '(' + secondCaseIndex + ')'
        );
        assert.ok(
          fakeElements['casesMobileList'].innerHTML.indexOf(fnName + '(' + secondCaseIndex + ')') !== -1,
          'mobile card must embed ' + fnName + '(' + secondCaseIndex + ')'
        );
      });
    });

    // ---- editCase(): synchronous, no Repository call, reads mirror only ----
    check('editCase(i): purely synchronous, pre-fills form from data.cases[i] (no Repository call)', () => {
      fakeElements['modalCaseTitle'] = makeFakeElement();
      fakeElements['modalCase'] = makeFakeElement();

      casesModule.editCase(secondCaseIndex);

      assert.strictEqual(sandboxGlobals.editIdx.cases, secondCaseIndex);
      assert.strictEqual(sandboxGlobals.__lastFilled['عنوان_القضية'], 'قضية طلاق');
      assert.strictEqual(fakeElements['modalCaseTitle'].textContent, 'تعديل القضية');
      assert.ok(fakeElements['modalCase'].classList.contains('open'));
    });

    // ---- UPDATE via saveCase(): id preserved, تاريخ_الإنشاء NOT regenerated, آخر_تحديث IS refreshed (dual-stamp behavior unique to Cases) ----
    await checkAsync('saveCase(): update path (editIdx.cases >= 0) preserves رقم_القضية and تاريخ_الإنشاء, refreshes آخر_تحديث', async () => {
      const before = sandboxGlobals.data.cases[secondCaseIndex];
      const idBefore = before[casesModule.CASES_ID_FIELD];
      const createdBefore = before['تاريخ_الإنشاء'];

      fakeElements['fCaseNum'].value = '2025/1002';
      fakeElements['fCaseTitle'].value = 'قضية طلاق (محدثة)';
      fakeElements['fCaseClient'].value = 'سارة عبد الله';
      sandboxGlobals.__nextFormValue = {
        'رقم_القضية': '2025/1002',
        'تاريخ_الإنشاء': createdBefore,
        'عنوان_القضية': 'قضية طلاق (محدثة)',
        'اسم_الموكل': 'سارة عبد الله',
        'نوع_الدعوى': 'مدني',
        'الحالة': 'معلقة',
        'الملاحظات': 'قضية عاجلة جداً'
      };

      await casesModule.saveCase();

      assert.strictEqual(sandboxGlobals.data.cases.length, 2);
      const updated = sandboxGlobals.data.cases.filter(function (c) { return c[casesModule.CASES_ID_FIELD] === idBefore; })[0];
      assert.strictEqual(updated['عنوان_القضية'], 'قضية طلاق (محدثة)');
      assert.strictEqual(updated[casesModule.CASES_ID_FIELD], idBefore, 'رقم_القضية must not be regenerated on update');
      assert.strictEqual(updated['تاريخ_الإنشاء'], createdBefore, 'تاريخ_الإنشاء must not be regenerated on update');
      assert.ok(updated['آخر_تحديث'], 'آخر_تحديث must be present');
      assert.strictEqual(toastLog[toastLog.length - 1].msg, 'تم تحديث القضية');
    });

    // ---- viewCase(): opens report, performs client-field backfill from data.clients on a SHALLOW COPY (audit §7/§9) ----
    check('viewCase(i): backfills missing client detail fields from data.clients onto a shallow copy, without mutating data.cases[i]', () => {
      sandboxGlobals.data.clients = [
        { 'الاسم': 'سارة عبد الله', 'الرقم_القومي': '29505051234567', 'الهاتف': '01000000002', 'العنوان': 'الجيزة', 'الوظيفة': 'محاسبة', 'جهة_العمل': 'شركة ب' }
      ];
      fakeElements['viewModalTitle'] = makeFakeElement();
      fakeElements['viewModalBody'] = makeFakeElement();
      fakeElements['modalView'] = makeFakeElement();

      const originalRecord = sandboxGlobals.data.cases[secondCaseIndex];
      assert.strictEqual(originalRecord['رقم_قومي_الموكل'], undefined, 'sanity: case record has no NID before backfill');

      casesModule.viewCase(secondCaseIndex);

      assert.ok(fakeElements['viewModalBody'].innerHTML.indexOf('29505051234567') !== -1, 'report must show the backfilled NID');
      assert.strictEqual(sandboxGlobals.data.cases[secondCaseIndex]['رقم_قومي_الموكل'], undefined, 'the original data.cases[i] object must remain unmutated (shallow-copy backfill)');
      assert.ok(fakeElements['modalView'].classList.contains('open'));
    });

    // ---- quickPrintCase(): deliberately does NOT perform the same backfill (audit §7 asymmetry, preserved as-is) ----
    check('quickPrintCase(i): does NOT perform the client-field backfill viewCase() does — pre-existing asymmetry preserved exactly', () => {
      const originalOpen = global.window.open;
      let capturedHtml = null;
      global.window.open = function () {
        return {
          document: { write: function (html) { capturedHtml = html; }, close: function () {}, open: function () {} },
          focus: function () {},
          // PHASE 24 — quickPrintCase() schedules win.print() via
          // setTimeout(..., 600), which fires AFTER this check()'s
          // synchronous body (and its global.window.open restore)
          // already returned — so the mock window still needs its own
          // print() no-op, matching real window.print() (opens the
          // browser print dialog; nothing to assert on here).
          print: __windowPrintStub
        };
      };

      casesModule.quickPrintCase(secondCaseIndex);

      assert.ok(capturedHtml, 'a print document must have been built');
      assert.strictEqual(capturedHtml.indexOf('29505051234567'), -1, 'quickPrintCase() must NOT show the backfilled NID — asymmetry with viewCase() preserved');

      global.window.open = originalOpen;
    });

    // ---- quickCaseQR(): linear data.clients scan then delegates to genClientQR(), unchanged ----
    check('quickCaseQR(i): resolves the linked client by name and delegates to genClientQR() with the resolved CLIENT index', () => {
      casesModule.quickCaseQR(secondCaseIndex);
      assert.strictEqual(sandbox.genClientQRLog[sandbox.genClientQRLog.length - 1], 0, 'must resolve to index 0 in data.clients, not the case index');
    });

    check('quickCaseQR(i): shows an info toast and does not call genClientQR() when the linked client is not registered', () => {
      sandboxGlobals.data.clients = []; // no matching client this time
      const toastCountBefore = toastLog.length;
      const qrCallsBefore = sandbox.genClientQRLog.length;

      casesModule.quickCaseQR(secondCaseIndex);

      assert.strictEqual(sandbox.genClientQRLog.length, qrCallsBefore, 'genClientQR() must not be called');
      assert.strictEqual(toastLog.length, toastCountBefore + 1);
      assert.strictEqual(toastLog[toastLog.length - 1].type, 'info');
    });

    // ---- getCaseStats(): pre-existing dead code (audit §15/§17.2), still works, unaffected by migration ----
    check('getCaseStats(): still computes total/active/closed/pending counts against the live mirror (unreferenced dead code, unaffected by this migration)', () => {
      const stats = casesModule.getCaseStats();
      assert.strictEqual(stats.total, 2);
      assert.strictEqual(typeof stats.active, 'number');
      assert.strictEqual(typeof stats.closed, 'number');
      assert.strictEqual(typeof stats.pending, 'number');
    });

    // ---- Embedded-children sub-system (audit §8): completely untouched, still threads through window._pendingChildren ----
    await checkAsync('Embedded children JSON (أطفال_القضية): toggleChildrenSection/addChildRow/updateChildrenData round-trip through window._pendingChildren into saveCase(), untouched by this migration', async () => {
      fakeElements['fCaseHasChildren'] = makeFakeElement();
      fakeElements['fCaseHasChildren'].value = 'نعم';
      fakeElements['childrenSectionDiv'] = makeFakeElement();
      fakeElements['childrenRows'] = makeFakeElement();
      fakeElements['fCaseChildrenData'] = makeFakeElement();

      casesModule.toggleChildrenSection();
      assert.strictEqual(fakeElements['childrenSectionDiv'].style.display, '');

      casesModule.updateChildrenData();
      assert.strictEqual(fakeElements['fCaseChildrenData'].value, '[]');

      fakeElements['fCaseNum'].value = '2025/1003';
      fakeElements['fCaseTitle'].value = 'قضية حضانة';
      fakeElements['fCaseClient'].value = 'سارة عبد الله';
      sandboxGlobals.__nextFormValue = {
        'رقم_القضية': '2025/1003',
        'عنوان_القضية': 'قضية حضانة',
        'اسم_الموكل': 'سارة عبد الله',
        'وجود_أطفال': 'نعم'
      };
      sandboxGlobals.editIdx.cases = -1;

      await casesModule.saveCase();

      const created = sandboxGlobals.data.cases.filter(function (c) { return c['رقم_القضية'] === '2025/1003'; })[0];
      assert.ok(created, 'the new case must have been created');
      assert.strictEqual(created['أطفال_القضية'], '[]', 'collectForm override must have attached أطفال_القضية from window._pendingChildren');
    });

    // ---- Cross-module natural-key-only dependencies (audit §10-12): populateCaseDropdown/autofillSessionFromCase/autofillFeeFromCase ----
    check('populateCaseDropdown(): fills a <select> with every current case, natural-key value/selection (Sessions/Documents/Fees/Children dependency)', () => {
      fakeElements['fSessionCaseNum'] = makeFakeElement();
      fakeElements['fSessionCaseNum'].appendChild = function () { this._appended = (this._appended || 0) + 1; };
      casesModule.populateCaseDropdown('fSessionCaseNum', '2025/1001');
      assert.ok(fakeElements['fSessionCaseNum']._appended >= 2, 'must append the placeholder option plus at least one case option per current case');
    });

    check('autofillSessionFromCase(): pre-fills session title/type/court from the matched case (natural-key .find(), no index dependency)', () => {
      fakeElements['fSessionCaseTitle'] = makeFakeElement();
      fakeElements['fSessionCaseType'] = makeFakeElement();
      fakeElements['fSessionCourt'] = makeFakeElement();

      casesModule.autofillSessionFromCase('2025/1001', false);

      assert.strictEqual(fakeElements['fSessionCaseTitle'].value, 'قضية نفقة');
      assert.strictEqual(fakeElements['fSessionCaseType'].value, 'أحوال شخصية');
    });

    check('autofillFeeFromCase(): pre-fills the fee client name from the matched case (natural-key .find(), no index dependency)', () => {
      fakeElements['fFeeClient'] = makeFakeElement();
      casesModule.autofillFeeFromCase('2025/1001');
      assert.strictEqual(fakeElements['fFeeClient'].value, 'أحمد محمود');
    });

    // ---- resetForm() override: repopulates case dropdowns in other modules after reset (cases.js's own override chain, untouched) ----
    check('resetForm(type): cases.js override still repopulates the matching cross-module case dropdown after the base reset runs', () => {
      fakeElements['fSessionCaseNum'].appendChild = function () {}; // no-op again for a clean count check
      const before = sandboxGlobals.__lastResetType;
      casesModule.resetForm('sessions');
      assert.strictEqual(sandboxGlobals.__lastResetType, 'sessions', 'base resetForm(type) must still have been called with the original type');
    });

    // ---- DELETE via deleteCase(): soft-deletes, vanishes from mirror, ApiService still gets a plain index (R-06) ----
    await checkAsync('deleteCase(i): soft-deletes via Repository.delete(); vanishes from mirror/UI exactly like the old hard delete', async () => {
      const beforeCount = sandboxGlobals.data.cases.length;
      const idxToDelete = casesModule.resolveCaseIndex(sandboxGlobals.data.cases, sandboxGlobals.data.cases.filter(function (c) { return c[casesModule.CASES_ID_FIELD] === secondCaseId; })[0]);
      const deletedId = secondCaseId;

      await casesModule.deleteCase(idxToDelete);

      assert.strictEqual(sandboxGlobals.data.cases.length, beforeCount - 1);
      assert.ok(!sandboxGlobals.data.cases.some(function (c) { return c[casesModule.CASES_ID_FIELD] === deletedId; }));
      assert.strictEqual(toastLog[toastLog.length - 1].msg, 'تم الحذف');

      // R-06 / audit §14 (documented, not fixed): ApiService.deleteData()
      // still receives the plain frontend index, exactly as before migration.
      assert.strictEqual(sandbox.deleteDataLog[sandbox.deleteDataLog.length - 1].sheet, 'القضايا');
      assert.strictEqual(sandbox.deleteDataLog[sandbox.deleteDataLog.length - 1].idx, idxToDelete);

      // Confirm this is a SOFT delete under the hood (Repository config,
      // unchanged by this phase) but that this is NOT observable through
      // any path cases.js/dashboard.js/clients.js actually use — this is
      // an INTENTIONAL, EXPECTED divergence (audit §5 mirror strategy),
      // not a regression.
      const includingDeleted = casesModule.casesRepository.getAll({ includeDeleted: true });
      const tombstone = includingDeleted.find(function (c) { return c[casesModule.CASES_ID_FIELD] === deletedId; });
      assert.ok(tombstone && tombstone.deletedAt, 'record is soft-deleted, still in storage with deletedAt');
      assert.ok(!casesModule.casesRepository.exists(deletedId), 'but exists()/getAll()/get() all correctly hide it');
    });

    // ---- data.cases.length reflects the deletion immediately (dashboard.js dependency) ----
    check('data.cases.length (read by dashboard.js) reflects only non-deleted cases immediately after delete', () => {
      assert.strictEqual(sandboxGlobals.data.cases.length, 2); // case #1 + the newly-created "قضية حضانة"
    });

    // ---- dashboard.js-style read still works unmodified against the mirror ----
    check('dashboard.js-style read (data.cases.filter for "active" stat card) still works against the Repository-backed mirror', () => {
      const active = sandboxGlobals.data.cases.filter(function (c) { return ['نشطة', 'active'].includes(c['الحالة']); }).length;
      assert.strictEqual(typeof active, 'number');
    });

    // ---- clients.js-style linear scan over data.cases (buildClientReport's linkedCases) still works unmodified against the mirror ----
    check('clients.js-style linear filter (buildClientReport linkedCases pattern) still resolves cases by اسم_الموكل against the Repository-backed mirror', () => {
      const linked = sandboxGlobals.data.cases.filter(function (c) { return c['اسم_الموكل'] === 'أحمد محمود'; });
      assert.strictEqual(linked.length, 1);
      assert.strictEqual(linked[0]['رقم_القضية'], '2025/1001');
    });
  }

  // ================================================================
  // 3. Repository core method regression (Repository.open/getAll/search/
  //    filter/create/update/delete/exists — audit's mandatory list)
  // ================================================================

  {
    const sandbox2 = makeSandbox({});
    setGlobals(sandbox2.sandboxGlobals);
    const cm2 = loadModule(casesJsPath);

    await checkAsync('Repository.open()/isReady() lifecycle behaves as documented (opening -> ready)', async () => {
      await cm2.ensureCasesRepositoryReady();
      assert.ok(cm2.casesRepository.isReady());
    });

    await checkAsync('Repository.create() + getAll() + exists() round-trip', async () => {
      const r = await cm2.casesRepository.create({ 'رقم_القضية': '2026/1', 'عنوان_القضية': 'قضية تجريبية', 'اسم_الموكل': 'عميل تجريبي' });
      assert.ok(r.success);
      assert.ok(cm2.casesRepository.exists(r.record[cm2.CASES_ID_FIELD]));
      assert.strictEqual(cm2.casesRepository.getAll().length, 1);
    });

    await checkAsync('Repository.create() rejects a duplicate natural key directly (not just through saveCase())', async () => {
      const r = await cm2.casesRepository.create({ 'رقم_القضية': '2026/1', 'عنوان_القضية': 'قضية أخرى', 'اسم_الموكل': 'عميل آخر' });
      assert.strictEqual(r.success, false);
      assert.strictEqual(r.error.type, 'ConflictError');
    });

    await checkAsync('Repository.search()/filter() synchronous read methods work against the live instance', async () => {
      const searchResult = cm2.casesRepository.search({ search: 'تجريبي' });
      assert.strictEqual(searchResult.items.length, 1);
      const filtered = cm2.casesRepository.filter({});
      assert.strictEqual(filtered.length, 1);
    });

    await checkAsync('Repository.update()/delete() round-trip, exists() flips false after delete', async () => {
      const all = cm2.casesRepository.getAll();
      const id = all[0][cm2.CASES_ID_FIELD];
      const upd = await cm2.casesRepository.update(id, { 'الملاحظات': 'محدث' });
      assert.ok(upd.success);
      assert.strictEqual(upd.record['الملاحظات'], 'محدث');
      const del = await cm2.casesRepository.delete(id);
      assert.ok(del.success);
      assert.strictEqual(cm2.casesRepository.exists(id), false);
    });
  }

  // ================================================================
  // 4. Backward compatibility — pre-existing legacy-shaped data
  // PHASE 13.6: Repository now persists exclusively through
  // IndexedDBAdapter (Phase 13 finding: every *Repository.js factory
  // already constructs IndexedDBAdapter, never LocalStorageAdapter), so
  // a raw localStorage["cases"] JSON string is no longer read by
  // ensureCasesRepositoryReady() at all — seeding it proved nothing.
  // The IndexedDB-era equivalent of "pre-existing data loads unchanged"
  // is data already present in the object store (written here via the
  // same createCasesLocalStorageAdapter()/DatabaseService pair the
  // Repository itself uses) before cases.js ever loads — the same
  // "simulates a page reload against a used profile" pattern the
  // per-Repository unit harnesses already use.
  // ================================================================

  {
    const legacySeed = {
      cases: JSON.stringify([
        {
          'رقم_القضية': '2024/9999',
          'عنوان_القضية': 'قضية قديمة',
          'اسم_الموكل': 'موكل قديم',
          'نوع_الدعوى': 'مدني',
          'الحالة': 'منتهية',
          'تاريخ_الإنشاء': '2024-01-01T00:00:00.000Z'
        }
      ])
    };
    const sandbox3 = makeSandbox(legacySeed);
    const { createCasesLocalStorageAdapter } = require(casesRepoPath);
    const seedAdapter = createCasesLocalStorageAdapter(sandbox3.sandboxGlobals.indexedDB);
    await seedAdapter.write('cases', JSON.parse(legacySeed.cases));

    setGlobals(sandbox3.sandboxGlobals);
    const cm3 = loadModule(casesJsPath);

    await checkAsync('Pre-existing legacy-shaped "cases" data loads unchanged through the Repository', async () => {
      await cm3.ensureCasesRepositoryReady();
      const all = cm3.casesRepository.getAll();
      assert.strictEqual(all.length, 1);
      assert.strictEqual(all[0]['رقم_القضية'], '2024/9999');
      assert.strictEqual(all[0]['عنوان_القضية'], 'قضية قديمة');
      assert.deepStrictEqual(sandbox3.sandboxGlobals.data.cases, all);
    });

    await checkAsync('Storage key unchanged: writes still land in the bare "cases" object store (no prefix)', async () => {
      const raw = await seedAdapter.read('cases');
      assert.ok(Array.isArray(raw));
      assert.strictEqual(raw[0]['رقم_القضية'], '2024/9999');
    });
  }

  // ================================================================
  // 5. No unhandled rejections / console.error during normal flows
  // ================================================================

  {
    const originalConsoleError = console.error;
    let errorCount = 0;
    console.error = function () { errorCount++; originalConsoleError.apply(console, arguments); };

    const sandbox4 = makeSandbox({});
    setGlobals(sandbox4.sandboxGlobals);
    const cm4 = loadModule(casesJsPath);

    await checkAsync('No console.error during a normal add/edit/delete cycle', async () => {
      sandbox4.fakeElements['fCaseNum'] = makeFakeElement();
      sandbox4.fakeElements['fCaseNum'].value = '2027/1';
      sandbox4.fakeElements['fCaseTitle'] = makeFakeElement();
      sandbox4.fakeElements['fCaseTitle'].value = 'قضية الفحص';
      sandbox4.fakeElements['fCaseClient'] = makeFakeElement();
      sandbox4.fakeElements['fCaseClient'].value = 'موكل الفحص';
      sandbox4.sandboxGlobals.__nextFormValue = { 'رقم_القضية': '2027/1', 'عنوان_القضية': 'قضية الفحص', 'اسم_الموكل': 'موكل الفحص' };
      sandbox4.sandboxGlobals.editIdx.cases = -1;
      await cm4.saveCase();

      const idx = 0;
      sandbox4.sandboxGlobals.editIdx.cases = idx;
      sandbox4.fakeElements['modalCaseTitle'] = makeFakeElement();
      sandbox4.fakeElements['modalCase'] = makeFakeElement();
      cm4.editCase(idx);

      await cm4.deleteCase(idx);

      assert.strictEqual(errorCount, 0);
    });

    console.error = originalConsoleError;
  }

  // ================================================================
  // Summary
  // ================================================================

  console.log(log.join('\n'));
  console.log('\n' + passed + ' passed, ' + failed + ' failed.');
  if (failed > 0) process.exitCode = 1;
}

main();
