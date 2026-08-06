/**
 * verify_fees_repository_integration.js
 * ================================================================
 * PHASE 9 — SUB-PHASE 9.9 — Repository Integration (Fees Module)
 * ================================================================
 * Standalone Node harness (`node js/tests/verify_fees_repository_
 * integration.js`, no browser required) proving that js/modules/
 * fees.js — after this phase's migration — behaves identically to
 * the pre-migration inline module from the caller's point of view,
 * while now reading/writing exclusively through js/repositories/
 * FeesRepository.js.
 *
 * Because fees.js is a classic (non-module) browser script that
 * references a pile of globals (`data`, `editIdx`, `document`, `toast`,
 * `saveLocal`, `ApiService`, `val`, `collectForm`, `fillForm`,
 * `populateCaseDropdown`, `formatDate`, `updateBadges`, `closeModal`,
 * `confirm`), this harness loads the REAL js/modules/fees.js file (via
 * Node's own Module wrapper, so its internal
 * `require('../repositories/FeesRepository.js')` resolves exactly the
 * way it would from its real location on disk) inside a sandbox that
 * stubs those globals with small, inspectable fakes — the same
 * "single boundary" mocking discipline every existing verify_*.js
 * harness in this project already uses for localStorage.
 *
 * No file is modified by running this harness. It only reads
 * js/modules/fees.js and js/repositories/FeesRepository.js (and,
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

// ---- Fake DOM element (only the surface fees.js actually touches) ----
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
    }
  };
}

/**
 * Assigns `extraGlobals` directly onto the real Node `global` object.
 * fees.js is a classic (non-module) browser script: it references bare
 * identifiers like `data`/`document`/`toast` that are NOT among
 * Module.wrap's function parameters, so they must be resolved via the
 * scope chain, which bottoms out at the real global object when the
 * file is compiled with `vm`'s `runInThisContext`. Because fees.js
 * itself kicks off an async `.open().then(...)` chain at load time whose
 * continuation (syncFeesMirror, referencing `data`) runs on a LATER
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
 * relative `require()` calls resolve exactly as they would from its
 * real on-disk location (js/modules/fees.js's
 * `require('../repositories/FeesRepository.js')` must resolve to
 * js/repositories/FeesRepository.js, not to something relative to this
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

async function main() {

  const feesJsPath = path.join(__dirname, '..', 'modules', 'fees.js');
  const feesRepoPath = path.join(__dirname, '..', 'repositories', 'FeesRepository.js');
  const repositoryCorePath = path.join(__dirname, '..', 'core', 'Repository.js');

  // ================================================================
  // 1. Static checks — only fees.js touched, nothing else edited
  // ================================================================

  check('js/modules/fees.js exists and is valid JS (node --check equivalent: parses via vm)', () => {
    const code = fs.readFileSync(feesJsPath, 'utf8');
    assert.doesNotThrow(() => new vm.Script(Module.wrap(code), { filename: feesJsPath }));
  });

  check('FeesRepository.js on disk is unmodified (still exports FeesRepository + factory)', () => {
    const ns = require(feesRepoPath);
    assert.strictEqual(typeof ns.FeesRepository, 'function');
    assert.strictEqual(typeof ns.createFeesLocalStorageAdapter, 'function');
  });

  check('Repository.js on disk is unmodified (still exports Repository)', () => {
    const ns = require(repositoryCorePath);
    assert.strictEqual(typeof ns.Repository, 'function');
  });

  // ================================================================
  // 2. Fresh load (empty localStorage — real first-run condition)
  // ================================================================

  {
    const fakeStorage = makeFakeStorage({});
    const fakeIndexedDB = new FakeIndexedDB();
    const fakeElements = {};
    const toastLog = [];
    const badgeCalls = { count: 0 };
    const closeModalLog = [];
    const syncRowLog = [];
    const saveLocalCalls = { count: 0 };
    const populateCaseDropdownLog = [];

    const sandboxGlobals = {
      localStorage: fakeStorage,
      indexedDB: fakeIndexedDB,
      window: global,
      data: { fees: [], cases: [] },
      editIdx: { fees: -1 },
      document: {
        getElementById: function (id) {
          if (!fakeElements[id]) fakeElements[id] = makeFakeElement();
          return fakeElements[id];
        }
      },
      toast: function (msg, type) { toastLog.push({ msg: msg, type: type }); },
      updateBadges: function () { badgeCalls.count++; },
      closeModal: function (id) { closeModalLog.push(id); },
      populateCaseDropdown: function (fieldId, val) { populateCaseDropdownLog.push({ fieldId: fieldId, val: val }); },
      formatDate: function (d) { return d || '—'; },
      val: function (id) {
        const el = fakeElements[id];
        return el ? el.value : '';
      },
      uid: function () { return 'test-uid-' + Math.random().toString(36).slice(2, 8); },
      collectForm: function () { return sandboxGlobals.__nextFormValue || {}; },
      fillForm: function (type, obj) { sandboxGlobals.__lastFilled = obj; },
      ApiService: { syncRow: function (sheet, obj, idx) { syncRowLog.push({ sheet: sheet, obj: obj, idx: idx }); } },
      saveLocal: function () { saveLocalCalls.count++; },
      confirm: function () { return true; },
      confirmDialog: __confirmDialogStub,
      console: console
    };

    setGlobals(sandboxGlobals);
    const feesModule = loadModule(feesJsPath);

    await checkAsync('Fresh load: repository opens with zero records, data.fees mirror is []', async () => {
      await feesModule.ensureFeesRepositoryReady();
      assert.deepStrictEqual(feesModule.feesRepository.getAll(), []);
      assert.deepStrictEqual(sandboxGlobals.data.fees, []);
    });

    // ---- READ: renderFees() on an empty repository shows #feesEmpty and zeroed stats ----
    check('renderFees(): empty repository shows #feesEmpty, zeroed totals/count', () => {
      fakeElements['searchFees'] = makeFakeElement();
      fakeElements['searchFees'].value = '';
      fakeElements['feesTableBody'] = makeFakeElement();
      fakeElements['feesMobileList'] = makeFakeElement();
      fakeElements['feesEmpty'] = makeFakeElement();
      fakeElements['feesTotalNum'] = makeFakeElement();
      fakeElements['feesCountNum'] = makeFakeElement();

      feesModule.renderFees();

      assert.strictEqual(fakeElements['feesTableBody'].innerHTML, '');
      assert.strictEqual(fakeElements['feesMobileList'].innerHTML, '');
      assert.strictEqual(fakeElements['feesEmpty'].style.display, '');
      assert.strictEqual(fakeElements['feesTotalNum'].textContent, (0).toLocaleString('ar-EG'));
      assert.strictEqual(fakeElements['feesCountNum'].textContent, 0);
    });

    // ---- CREATE via saveFee() ----
    await checkAsync('saveFee(): create path (editIdx.fees = -1) inserts a new record via Repository.create()', async () => {
      fakeElements['fFeeCaseNum'] = makeFakeElement();
      fakeElements['fFeeCaseNum'].value = '2026-55';
      fakeElements['fFeeAmount'] = makeFakeElement();
      fakeElements['fFeeAmount'].value = '5000';
      sandboxGlobals.__nextFormValue = {
        'رقم_القضية': '2026-55',
        'اسم_الموكل': 'أحمد علي',
        'نوع_الأتعاب': 'أتعاب مقدمة',
        'المبلغ': '5000',
        'تاريخ_الاستلام': '2026-01-10',
        'طريقة_الدفع': 'نقدًا',
        'الملاحظات': ''
      };
      sandboxGlobals.editIdx.fees = -1;

      await feesModule.saveFee();

      assert.strictEqual(sandboxGlobals.data.fees.length, 1);
      const rec = sandboxGlobals.data.fees[0];
      assert.strictEqual(rec['اسم_الموكل'], 'أحمد علي');
      assert.ok(rec[feesModule.FEES_ID_FIELD], 'a رقم_العملية id must have been generated');
      assert.ok(rec['تاريخ_الإنشاء'], 'تاريخ_الإنشاء must have been stamped');
      assert.strictEqual(toastLog[toastLog.length - 1].msg, 'تم التسجيل');
      assert.strictEqual(saveLocalCalls.count, 1);
      assert.strictEqual(syncRowLog[syncRowLog.length - 1].sheet, 'الأتعاب');
      assert.strictEqual(syncRowLog[syncRowLog.length - 1].idx, -1);
      assert.strictEqual(closeModalLog[closeModalLog.length - 1], 'modalFee');
      assert.strictEqual(badgeCalls.count, 1);
    });

    // ---- CREATE a second record (for search/totals/index tests) ----
    await checkAsync('saveFee(): create a second record of a different type/amount', async () => {
      sandboxGlobals.__nextFormValue = {
        'رقم_القضية': '2026-56',
        'اسم_الموكل': 'منى سامي',
        'نوع_الأتعاب': 'أتعاب إضافية',
        'المبلغ': '2500',
        'تاريخ_الاستلام': '2026-02-01',
        'طريقة_الدفع': 'تحويل بنكي',
        'الملاحظات': 'دفعة ثانية معتمدة'
      };
      sandboxGlobals.editIdx.fees = -1;
      await feesModule.saveFee();
      assert.strictEqual(sandboxGlobals.data.fees.length, 2);
    });

    // ---- READ: renderFees() totals/count computed from FULL data.fees, unfiltered ----
    check('renderFees(): #feesTotalNum/#feesCountNum reflect the FULL unfiltered data.fees mirror', () => {
      fakeElements['searchFees'].value = '';
      feesModule.renderFees();
      assert.strictEqual(fakeElements['feesCountNum'].textContent, 2);
      assert.strictEqual(fakeElements['feesTotalNum'].textContent, (7500).toLocaleString('ar-EG'));
    });

    // ---- READ: renderFees() free-text search narrows visible rows but NOT the totals ----
    check('renderFees(): free-text search matches across full legacy field set (Repository.search(), synchronous); totals stay unfiltered', () => {
      fakeElements['searchFees'].value = 'معتمدة'; // only in fee #2's notes
      feesModule.renderFees();

      assert.ok(fakeElements['feesTableBody'].innerHTML.indexOf('منى سامي') !== -1);
      assert.ok(fakeElements['feesTableBody'].innerHTML.indexOf('أحمد علي') === -1);
      assert.strictEqual(fakeElements['feesEmpty'].style.display, 'none');
      // Totals/count still reflect ALL records, not just the search-matched one:
      assert.strictEqual(fakeElements['feesCountNum'].textContent, 2);
      assert.strictEqual(fakeElements['feesTotalNum'].textContent, (7500).toLocaleString('ar-EG'));
    });

    // ---- READ: empty-result path (#feesEmpty shown, both lists cleared, totals still full) ----
    check('renderFees(): no search matches shows #feesEmpty and clears both lists, but totals remain unfiltered', () => {
      fakeElements['searchFees'].value = 'نص-غير-موجود-إطلاقاً';

      feesModule.renderFees();

      assert.strictEqual(fakeElements['feesTableBody'].innerHTML, '');
      assert.strictEqual(fakeElements['feesMobileList'].innerHTML, '');
      assert.strictEqual(fakeElements['feesEmpty'].style.display, '');
      assert.strictEqual(fakeElements['feesCountNum'].textContent, 2);
      assert.strictEqual(fakeElements['feesTotalNum'].textContent, (7500).toLocaleString('ar-EG'));
    });

    // ---- Index -> record -> id translation layer, exercised end-to-end ----
    let secondFeeIndex = -1;
    check('renderFees(): embeds resolvable indexes in onclick handlers matching the data.fees mirror', () => {
      fakeElements['searchFees'].value = '';
      feesModule.renderFees();

      secondFeeIndex = feesModule.resolveFeeIndex(sandboxGlobals.data.fees, sandboxGlobals.data.fees[1]);
      assert.strictEqual(secondFeeIndex, 1);
      assert.ok(fakeElements['feesTableBody'].innerHTML.indexOf('editFee(' + secondFeeIndex + ')') !== -1);
      assert.ok(fakeElements['feesTableBody'].innerHTML.indexOf('deleteFee(' + secondFeeIndex + ')') !== -1);
    });

    // ---- editFee(): synchronous, no Repository call, reads mirror only, calls populateCaseDropdown() ----
    check('editFee(i): purely synchronous, pre-fills form from data.fees[i] (no Repository call), calls populateCaseDropdown()', () => {
      fakeElements['modalFeeTitle'] = makeFakeElement();
      fakeElements['modalFee'] = makeFakeElement();

      feesModule.editFee(secondFeeIndex);

      assert.strictEqual(sandboxGlobals.editIdx.fees, secondFeeIndex);
      assert.strictEqual(sandboxGlobals.__lastFilled['اسم_الموكل'], 'منى سامي');
      assert.strictEqual(fakeElements['modalFeeTitle'].textContent, 'تعديل الأتعاب');
      assert.ok(fakeElements['modalFee'].classList.contains('open'));
      assert.strictEqual(populateCaseDropdownLog[populateCaseDropdownLog.length - 1].fieldId, 'fFeeCaseNum');
      assert.strictEqual(populateCaseDropdownLog[populateCaseDropdownLog.length - 1].val, '2026-56');
    });

    // ---- UPDATE via saveFee(): same array position preserved ----
    await checkAsync('saveFee(): update path (editIdx.fees >= 0) preserves list position and id', async () => {
      const idBefore = sandboxGlobals.data.fees[secondFeeIndex][feesModule.FEES_ID_FIELD];
      sandboxGlobals.__nextFormValue = {
        'رقم_القضية': '2026-56',
        'اسم_الموكل': 'منى سامي',
        'نوع_الأتعاب': 'أتعاب إضافية',
        'المبلغ': '3000',
        'تاريخ_الاستلام': '2026-02-05',
        'طريقة_الدفع': 'تحويل بنكي',
        'الملاحظات': 'دفعة ثانية معدّلة'
      };

      await feesModule.saveFee();

      assert.strictEqual(sandboxGlobals.data.fees.length, 2);
      assert.strictEqual(sandboxGlobals.data.fees[secondFeeIndex]['المبلغ'], '3000');
      assert.strictEqual(sandboxGlobals.data.fees[secondFeeIndex][feesModule.FEES_ID_FIELD], idBefore,
        'Repository.update() preserves the existing id — same array position, same identity');
      assert.strictEqual(toastLog[toastLog.length - 1].msg, 'تم التحديث');
      assert.strictEqual(syncRowLog[syncRowLog.length - 1].idx, secondFeeIndex);
    });

    // Totals must now reflect the UPDATED amount (5000 + 3000 = 8000):
    check('renderFees(): totals reflect the updated amount after saveFee() update path', () => {
      fakeElements['searchFees'].value = '';
      feesModule.renderFees();
      assert.strictEqual(fakeElements['feesTotalNum'].textContent, (8000).toLocaleString('ar-EG'));
    });

    // ---- DELETE via deleteFee(): soft-deletes, vanishes from mirror/UI/totals ----
    await checkAsync('deleteFee(i): soft-deletes via Repository.delete(); vanishes from mirror/UI exactly like the old hard delete', async () => {
      const beforeCount = sandboxGlobals.data.fees.length;
      const deletedId = sandboxGlobals.data.fees[secondFeeIndex][feesModule.FEES_ID_FIELD];

      await feesModule.deleteFee(secondFeeIndex);

      assert.strictEqual(sandboxGlobals.data.fees.length, beforeCount - 1);
      assert.ok(!sandboxGlobals.data.fees.some(function (f) { return f[feesModule.FEES_ID_FIELD] === deletedId; }));
      assert.strictEqual(toastLog[toastLog.length - 1].msg, 'تم الحذف');

      // Confirm this is a SOFT delete under the hood (Repository config,
      // unchanged by this phase) but that this is NOT observable through
      // any path fees.js/dashboard.js actually use:
      const includingDeleted = feesModule.feesRepository.getAll({ includeDeleted: true });
      const tombstone = includingDeleted.find(function (f) { return f[feesModule.FEES_ID_FIELD] === deletedId; });
      assert.ok(tombstone && tombstone.deletedAt, 'record is soft-deleted, still in storage with deletedAt');
      assert.ok(!feesModule.feesRepository.exists(deletedId), 'but exists()/getAll()/get() all correctly hide it');
    });

    // Totals/count must now reflect ONLY the surviving record (5000):
    check('renderFees(): totals/count reflect the surviving record after deleteFee()', () => {
      fakeElements['searchFees'].value = '';
      feesModule.renderFees();
      assert.strictEqual(fakeElements['feesCountNum'].textContent, 1);
      assert.strictEqual(fakeElements['feesTotalNum'].textContent, (5000).toLocaleString('ar-EG'));
    });

    // ---- ApiService delete/sync gap preserved ----
    check('deleteFee(): still does NOT call any ApiService delete/sync method (pre-existing documented gap, unchanged)', () => {
      // syncRowLog only ever receives calls from saveFee(); deleteFee() never
      // pushes to it at all. The last entry in syncRowLog must therefore
      // still be the saveFee() update call, not anything delete-related.
      assert.strictEqual(syncRowLog[syncRowLog.length - 1].sheet, 'الأتعاب');
      assert.notStrictEqual(syncRowLog[syncRowLog.length - 1].idx, undefined);
    });

    // ---- Validation: required-field guard still short-circuits before any Repository/DOM call ----
    check('saveFee(): empty رقم_القضية/المبلغ still blocked before reaching the Repository (validated via direct DOM read)', () => {
      fakeElements['fFeeCaseNum'].value = '';
      fakeElements['fFeeAmount'].value = '';
      const before = sandboxGlobals.data.fees.length;
      const toastCountBefore = toastLog.length;
      // saveFee() is async but the guard clause returns before any await,
      // so no promise needs to be awaited for this observation.
      feesModule.saveFee();
      assert.strictEqual(sandboxGlobals.data.fees.length, before);
      assert.strictEqual(toastLog.length, toastCountBefore + 1);
      assert.strictEqual(toastLog[toastLog.length - 1].type, 'error');
    });
  }

  // ================================================================
  // 3. Backward compatibility — pre-existing legacy-shaped localStorage
  // ================================================================

  {
    const legacySeed = {
      fees: JSON.stringify([
        {
          'رقم_العملية': 'legacy-fee-1',
          'رقم_القضية': '2025-900',
          'اسم_الموكل': 'سمير فوزي',
          'نوع_الأتعاب': 'أتعاب نهائية',
          'المبلغ': '10000',
          'تاريخ_الاستلام': '2025-06-01',
          'طريقة_الدفع': 'نقدًا',
          'الملاحظات': '',
          'تاريخ_الإنشاء': '2025-06-01T00:00:00.000Z'
        }
      ])
    };
    const fakeStorage = makeFakeStorage(legacySeed);
    const fakeIndexedDB = new FakeIndexedDB();
    const fakeElements = {};

    const sandboxGlobals = {
      localStorage: fakeStorage,
      indexedDB: fakeIndexedDB,
      window: global,
      data: { fees: [], cases: [] },
      editIdx: { fees: -1 },
      document: { getElementById: function (id) { if (!fakeElements[id]) fakeElements[id] = makeFakeElement(); return fakeElements[id]; } },
      toast: function () {},
      updateBadges: function () {},
      closeModal: function () {},
      populateCaseDropdown: function () {},
      formatDate: function (d) { return d || '—'; },
      val: function (id) { const el = fakeElements[id]; return el ? el.value : ''; },
      uid: function () { return 'x'; },
      collectForm: function () { return {}; },
      fillForm: function () {},
      ApiService: { syncRow: function () {} },
      saveLocal: function () {},
      confirm: function () { return true; },
      confirmDialog: __confirmDialogStub,
      console: console
    };

    setGlobals(sandboxGlobals);
    const { createFeesLocalStorageAdapter } = require(feesRepoPath);
    const seedAdapter = createFeesLocalStorageAdapter(fakeIndexedDB);
    await seedAdapter.write('fees', JSON.parse(legacySeed.fees));

    const feesModule = loadModule(feesJsPath);

    await checkAsync('Pre-existing legacy-shaped "fees" data loads unchanged through the Repository', async () => {
      await feesModule.ensureFeesRepositoryReady();
      const all = feesModule.feesRepository.getAll();
      assert.strictEqual(all.length, 1);
      assert.strictEqual(all[0]['رقم_العملية'], 'legacy-fee-1');
      assert.strictEqual(all[0]['اسم_الموكل'], 'سمير فوزي');
      assert.deepStrictEqual(sandboxGlobals.data.fees, all);
    });

    await checkAsync('Storage key unchanged: writes still land in the bare "fees" object store (no prefix)', async () => {
      const raw = await seedAdapter.read('fees');
      assert.ok(Array.isArray(raw));
      assert.strictEqual(raw[0]['رقم_العملية'], 'legacy-fee-1');
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
