/**
 * verify_children_repository_integration.js
 * ================================================================
 * PHASE 9 — SUB-PHASE 9.8 — Repository Integration (Children Module)
 * ================================================================
 * Standalone Node harness (`node js/tests/verify_children_repository_
 * integration.js`, no browser required) proving that js/modules/
 * children.js — after this phase's migration — behaves identically to
 * the pre-migration inline module from the caller's point of view,
 * while now reading/writing exclusively through js/repositories/
 * ChildrenRepository.js. Modeled directly on the Tasks module's
 * verify_tasks_repository_integration.js harness (SUB-PHASE 9.5), same
 * "single boundary" mocking discipline.
 *
 * No file is modified by running this harness. It only reads
 * js/modules/children.js and js/repositories/ChildrenRepository.js
 * (and, transitively, js/core/Repository.js / DatabaseService.js /
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

// ---- Fake DOM element (only the surface children.js actually touches) ----
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
 * children.js is a classic (non-module) browser script: it references
 * bare identifiers like `data`/`document`/`toast` that are NOT among
 * Module.wrap's function parameters, so they must be resolved via the
 * scope chain, which bottoms out at the real global object when the
 * file is compiled with `vm`'s `runInThisContext`. Because children.js
 * itself kicks off an async `.open().then(...)` chain at load time whose
 * continuation (syncChildrenMirror, referencing `data`) runs on a LATER
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
 * real on-disk location (js/modules/children.js's
 * `require('../repositories/ChildrenRepository.js')` must resolve to
 * js/repositories/ChildrenRepository.js, not to something relative to
 * this test file). Call `setGlobals()` first with whatever fakes the
 * file needs to find on the global object.
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

  const childrenJsPath = path.join(__dirname, '..', 'modules', 'children.js');
  const childrenRepoPath = path.join(__dirname, '..', 'repositories', 'ChildrenRepository.js');
  const repositoryCorePath = path.join(__dirname, '..', 'core', 'Repository.js');

  // ================================================================
  // 1. Static checks — only children.js touched, nothing else edited
  // ================================================================

  check('js/modules/children.js exists and is valid JS (node --check equivalent: parses via vm)', () => {
    const code = fs.readFileSync(childrenJsPath, 'utf8');
    assert.doesNotThrow(() => new vm.Script(Module.wrap(code), { filename: childrenJsPath }));
  });

  check('ChildrenRepository.js on disk is unmodified (still exports ChildrenRepository + factory)', () => {
    const ns = require(childrenRepoPath);
    assert.strictEqual(typeof ns.ChildrenRepository, 'function');
    assert.strictEqual(typeof ns.createChildrenLocalStorageAdapter, 'function');
  });

  check('Repository.js on disk is unmodified (still exports Repository)', () => {
    const ns = require(repositoryCorePath);
    assert.strictEqual(typeof ns.Repository, 'function');
  });

  // ================================================================
  // 2. Fresh load (empty localStorage — real first-run condition)
  // ================================================================

  let childrenModule;
  let sandboxGlobals;
  let fakeElements;
  let toastLog;
  let badgeCalls;
  let closeModalLog;
  let syncToSheetsLog;
  let saveLocalCalls;
  let populateCaseDropdownLog;

  {
    const fakeStorage = makeFakeStorage({});
    const fakeIndexedDB = new FakeIndexedDB();
    fakeElements = {};
    toastLog = [];
    badgeCalls = { count: 0 };
    closeModalLog = [];
    syncToSheetsLog = [];
    saveLocalCalls = { count: 0 };
    populateCaseDropdownLog = [];

    sandboxGlobals = {
      localStorage: fakeStorage,
      indexedDB: fakeIndexedDB,
      window: global,
      data: { children: [], cases: [] },
      editIdx: { children: -1 },
      API_URL: '', // matches original default: no Apps Script URL configured
      document: {
        getElementById: function (id) {
          if (!fakeElements[id]) fakeElements[id] = makeFakeElement();
          return fakeElements[id];
        }
      },
      toast: function (msg, type) { toastLog.push({ msg: msg, type: type }); },
      updateBadges: function () { badgeCalls.count++; },
      closeModal: function (id) { closeModalLog.push(id); },
      populateCaseDropdown: function (elId, caseNum) { populateCaseDropdownLog.push({ elId: elId, caseNum: caseNum }); },
      val: function (id) {
        const el = fakeElements[id];
        return el ? el.value : '';
      },
      uid: function () { return 'test-uid-' + Math.random().toString(36).slice(2, 8); },
      collectForm: function () { return sandboxGlobals.__nextFormValue || {}; },
      fillForm: function (type, obj) { sandboxGlobals.__lastFilled = obj; },
      resetForm: function () { sandboxGlobals.__resetFormCalled = true; },
      syncToSheets: function (sheet, rowData, rowIndex) { syncToSheetsLog.push({ sheet: sheet, rowData: rowData, rowIndex: rowIndex }); },
      saveLocal: function () { saveLocalCalls.count++; },
      confirm: function () { return true; },
      confirmDialog: __confirmDialogStub,
      console: console
    };

    setGlobals(sandboxGlobals);
    childrenModule = loadModule(childrenJsPath);

    await checkAsync('Fresh load: repository opens with zero records, data.children mirror is []', async () => {
      await childrenModule.ensureChildrenRepositoryReady();
      assert.deepStrictEqual(childrenModule.childrenRepository.getAll(), []);
      assert.deepStrictEqual(sandboxGlobals.data.children, []);
    });

    // ---- openAddChildModal(): synchronous, no Repository call ----
    check('openAddChildModal(): resets editIdx, opens modal, calls populateCaseDropdown — no Repository call', () => {
      fakeElements['modalChildTitle'] = makeFakeElement();
      fakeElements['modalChild'] = makeFakeElement();

      childrenModule.openAddChildModal();

      assert.strictEqual(sandboxGlobals.editIdx.children, -1);
      assert.ok(sandboxGlobals.__resetFormCalled);
      assert.strictEqual(fakeElements['modalChildTitle'].textContent, 'إضافة بيانات طفل');
      assert.ok(fakeElements['modalChild'].classList.contains('open'));
      assert.strictEqual(populateCaseDropdownLog[populateCaseDropdownLog.length - 1].elId, 'fChildCaseNum');
    });

    // ---- VALIDATION: missing رقم القضية/اسم الطفل still blocked before the Repository ----
    check('saveChild(): empty رقم القضية / اسم الطفل still blocked before reaching the Repository (validated via direct DOM read)', () => {
      fakeElements['fChildCaseNum'] = makeFakeElement();
      fakeElements['fChildCaseNum'].value = '   ';
      fakeElements['fChildName'] = makeFakeElement();
      fakeElements['fChildName'].value = '';
      const before = sandboxGlobals.data.children.length;
      const toastCountBefore = toastLog.length;
      // saveChild() is async but the guard clause returns before any
      // await, so no promise needs to be awaited for this observation.
      childrenModule.saveChild();
      assert.strictEqual(sandboxGlobals.data.children.length, before);
      assert.strictEqual(toastLog.length, toastCountBefore + 1);
      assert.strictEqual(toastLog[toastLog.length - 1].type, 'error');
      assert.strictEqual(toastLog[toastLog.length - 1].msg, 'يرجى ملء رقم القضية واسم الطفل');
    });

    // ---- CREATE via saveChild() ----
    await checkAsync('saveChild(): create path (editIdx.children = -1) inserts a new record via Repository.create(), id auto-generated', async () => {
      fakeElements['fChildCaseNum'].value = '2026-10';
      fakeElements['fChildName'].value = 'أحمد محمد';
      sandboxGlobals.__nextFormValue = {
        'رقم_القضية': '2026-10',
        'الاسم': 'أحمد محمد',
        'تاريخ_الميلاد': '2015-03-01',
        'السن': '11',
        'المدرسة': 'مدرسة النصر',
        'محل_الإقامة': 'القاهرة',
        'الحضانة_الحالية': 'الأم',
        'النفقة_الحالية': '1500',
        'ملاحظات': ''
      };
      sandboxGlobals.editIdx.children = -1;

      await childrenModule.saveChild();

      assert.strictEqual(sandboxGlobals.data.children.length, 1);
      const rec = sandboxGlobals.data.children[0];
      assert.strictEqual(rec['الاسم'], 'أحمد محمد');
      assert.ok(rec[childrenModule.CHILDREN_ID_FIELD], 'a رقم_الطفل id must have been generated');
      assert.ok(rec['تاريخ_الإنشاء'], 'تاريخ_الإنشاء must have been stamped');
      assert.strictEqual(toastLog[toastLog.length - 1].msg, 'تمت الإضافة');
      assert.strictEqual(saveLocalCalls.count, 1);
      assert.strictEqual(closeModalLog[closeModalLog.length - 1], 'modalChild');
      assert.strictEqual(badgeCalls.count, 1);
      // API_URL is '' in this sandbox (matches original default), so
      // syncToSheets() must NOT have been called (if(API_URL)... guard).
      assert.strictEqual(syncToSheetsLog.length, 0, 'syncToSheets() must be gated behind API_URL, matching the original');
    });

    // ---- CREATE a second record (search test) ----
    await checkAsync('saveChild(): create a second record with a different case number', async () => {
      sandboxGlobals.__nextFormValue = {
        'رقم_القضية': '2026-11',
        'الاسم': 'سارة علي',
        'تاريخ_الميلاد': '2018-07-12',
        'السن': '8',
        'المدرسة': 'مدرسة الأمل',
        'محل_الإقامة': 'الجيزة',
        'الحضانة_الحالية': 'الأب',
        'النفقة_الحالية': '900',
        'ملاحظات': 'تحتاج متابعة نفسية'
      };
      sandboxGlobals.editIdx.children = -1;
      await childrenModule.saveChild();
      assert.strictEqual(sandboxGlobals.data.children.length, 2);
    });

    // ---- READ: renderChildren() free-text search (Repository.search(), synchronous) ----
    check('renderChildren(): free-text search matches across full legacy field set (Repository.search(), synchronous)', () => {
      fakeElements['searchChildren'] = makeFakeElement();
      fakeElements['searchChildren'].value = 'نفسية'; // only in child #2's ملاحظات
      fakeElements['childrenTableBody'] = makeFakeElement();
      fakeElements['childrenEmpty'] = makeFakeElement();
      fakeElements['childrenMobileList'] = makeFakeElement();

      childrenModule.renderChildren();

      assert.ok(fakeElements['childrenTableBody'].innerHTML.indexOf('سارة علي') !== -1);
      assert.ok(fakeElements['childrenTableBody'].innerHTML.indexOf('أحمد محمد') === -1);
      assert.strictEqual(fakeElements['childrenEmpty'].style.display, 'none');
    });

    // ---- READ: no sort applied — insertion order preserved (matches original) ----
    check('renderChildren(): rows render in insertion order — no .sort() applied, matching the original inline renderChildren()', () => {
      fakeElements['searchChildren'].value = '';

      childrenModule.renderChildren();

      const html = fakeElements['childrenTableBody'].innerHTML;
      const posFirst = html.indexOf('أحمد محمد');
      const posSecond = html.indexOf('سارة علي');
      assert.ok(posFirst !== -1 && posSecond !== -1 && posFirst < posSecond,
        'child #1 (created first) must render before child #2 (created second)');
    });

    // ---- READ: mobile card list rendered in parallel with the table ----
    check('renderChildren(): #childrenMobileList rendered in parallel with #childrenTableBody', () => {
      const html = fakeElements['childrenMobileList'].innerHTML;
      assert.ok(html.indexOf('أحمد محمد') !== -1 && html.indexOf('سارة علي') !== -1);
    });

    // ---- READ: empty-result path (#childrenEmpty shown, lists cleared) ----
    check('renderChildren(): no matches shows #childrenEmpty and clears both lists', () => {
      fakeElements['searchChildren'].value = 'نص-غير-موجود-إطلاقاً';

      childrenModule.renderChildren();

      assert.strictEqual(fakeElements['childrenTableBody'].innerHTML, '');
      assert.strictEqual(fakeElements['childrenMobileList'].innerHTML, '');
      assert.strictEqual(fakeElements['childrenEmpty'].style.display, '');
    });

    // ---- Index -> record -> id translation layer, exercised end-to-end ----
    let secondChildIndex = -1;
    check('renderChildren(): embeds resolvable indexes in onclick handlers matching the data.children mirror', () => {
      fakeElements['searchChildren'].value = '';
      childrenModule.renderChildren();

      secondChildIndex = childrenModule.resolveChildIndex(
        sandboxGlobals.data.children,
        sandboxGlobals.data.children.filter(function (x) { return x['الاسم'] === 'سارة علي'; })[0]
      );
      assert.notStrictEqual(secondChildIndex, -1);
      assert.ok(fakeElements['childrenTableBody'].innerHTML.indexOf('editChild(' + secondChildIndex + ')') !== -1);
      assert.ok(fakeElements['childrenTableBody'].innerHTML.indexOf('deleteChild(' + secondChildIndex + ')') !== -1);
    });

    // ---- editChild(): synchronous, no Repository call, reads mirror only ----
    check('editChild(i): purely synchronous, pre-fills form from data.children[i] (no Repository call)', () => {
      fakeElements['modalChildTitle'] = makeFakeElement();
      fakeElements['modalChild'] = makeFakeElement();

      childrenModule.editChild(secondChildIndex);

      assert.strictEqual(sandboxGlobals.editIdx.children, secondChildIndex);
      assert.strictEqual(sandboxGlobals.__lastFilled['الاسم'], 'سارة علي');
      assert.strictEqual(fakeElements['modalChildTitle'].textContent, 'تعديل بيانات الطفل');
      assert.ok(fakeElements['modalChild'].classList.contains('open'));
      assert.strictEqual(populateCaseDropdownLog[populateCaseDropdownLog.length - 1].elId, 'fChildCaseNum');
      assert.strictEqual(populateCaseDropdownLog[populateCaseDropdownLog.length - 1].caseNum, '2026-11');
    });

    // ---- UPDATE via saveChild(): same array position and id preserved ----
    await checkAsync('saveChild(): update path (editIdx.children >= 0) preserves list position and id', async () => {
      const idBefore = sandboxGlobals.data.children[secondChildIndex][childrenModule.CHILDREN_ID_FIELD];
      fakeElements['fChildCaseNum'].value = '2026-11';
      fakeElements['fChildName'].value = 'سارة علي (محدّثة)';
      sandboxGlobals.__nextFormValue = {
        'رقم_القضية': '2026-11',
        'الاسم': 'سارة علي (محدّثة)',
        'تاريخ_الميلاد': '2018-07-12',
        'السن': '9',
        'المدرسة': 'مدرسة الأمل',
        'محل_الإقامة': 'الجيزة',
        'الحضانة_الحالية': 'الأب',
        'النفقة_الحالية': '1000',
        'ملاحظات': 'تحتاج متابعة نفسية'
      };

      await childrenModule.saveChild();

      assert.strictEqual(sandboxGlobals.data.children.length, 2);
      assert.strictEqual(sandboxGlobals.data.children[secondChildIndex]['الاسم'], 'سارة علي (محدّثة)');
      assert.strictEqual(sandboxGlobals.data.children[secondChildIndex][childrenModule.CHILDREN_ID_FIELD], idBefore,
        'Repository.update() preserves the existing id — same array position, same identity');
      assert.strictEqual(toastLog[toastLog.length - 1].msg, 'تم التحديث');
    });

    // ---- syncToSheets() called (legacy call, NOT ApiService) when API_URL is set ----
    await checkAsync('saveChild(): calls legacy syncToSheets() (NOT ApiService) when API_URL is set, with the full saved record', async () => {
      // children.js reads the bare `API_URL` identifier fresh on every
      // call (resolved via the scope chain to the real Node `global`
      // object — see setGlobals()'s doc comment), so the actual
      // `global.API_URL` must be updated directly, not just the
      // bookkeeping `sandboxGlobals` object.
      sandboxGlobals.API_URL = 'https://example-apps-script.test/exec';
      global.API_URL = sandboxGlobals.API_URL;
      const syncCountBefore = syncToSheetsLog.length;

      fakeElements['fChildCaseNum'].value = '2026-12';
      fakeElements['fChildName'].value = 'ياسين خالد';
      sandboxGlobals.__nextFormValue = {
        'رقم_القضية': '2026-12',
        'الاسم': 'ياسين خالد',
        'تاريخ_الميلاد': '2020-01-20',
        'السن': '6',
        'المدرسة': '',
        'محل_الإقامة': 'الإسكندرية',
        'الحضانة_الحالية': 'الأم',
        'النفقة_الحالية': '700',
        'ملاحظات': ''
      };
      sandboxGlobals.editIdx.children = -1;

      await childrenModule.saveChild();

      assert.strictEqual(syncToSheetsLog.length, syncCountBefore + 1);
      const call = syncToSheetsLog[syncToSheetsLog.length - 1];
      assert.strictEqual(call.sheet, 'الأطفال');
      assert.strictEqual(call.rowData['الاسم'], 'ياسين خالد');
      assert.ok(call.rowData[childrenModule.CHILDREN_ID_FIELD], 'the synced record must include its generated رقم_الطفل id');

      // Reset API_URL back to '' for the remaining tests, matching the
      // original default (no Apps Script URL configured).
      sandboxGlobals.API_URL = '';
      global.API_URL = '';
    });

    // ---- DELETE via deleteChild(): removed from mirror, no sync call at all (pre-existing gap preserved) ----
    await checkAsync('deleteChild(i): soft-deletes via Repository.delete(); vanishes from mirror/UI exactly like the old hard delete', async () => {
      // Re-resolve the index for "سارة علي (محدّثة)" since a third record
      // was inserted above (array positions may have shifted only if
      // insertion changed ordering — insertion is append-only, so this
      // index is unchanged, but re-resolving keeps the test robust).
      const targetIdx = childrenModule.resolveChildIndex(
        sandboxGlobals.data.children,
        sandboxGlobals.data.children.filter(function (x) { return x['الاسم'] === 'سارة علي (محدّثة)'; })[0]
      );
      const beforeCount = sandboxGlobals.data.children.length;
      const deletedId = sandboxGlobals.data.children[targetIdx][childrenModule.CHILDREN_ID_FIELD];
      const syncCountBefore = syncToSheetsLog.length;

      await childrenModule.deleteChild(targetIdx);

      assert.strictEqual(sandboxGlobals.data.children.length, beforeCount - 1);
      assert.ok(!sandboxGlobals.data.children.some(function (c) { return c[childrenModule.CHILDREN_ID_FIELD] === deletedId; }));
      assert.strictEqual(toastLog[toastLog.length - 1].msg, 'تم الحذف');
      assert.strictEqual(syncToSheetsLog.length, syncCountBefore,
        'deleteChild() must NOT call syncToSheets() — matches the original (no delete-sync call ever existed)');

      // Confirm this is a SOFT delete under the hood (Repository config,
      // unchanged by this phase) but that this is NOT observable through
      // any path children.js/dashboard.js actually use:
      const includingDeleted = childrenModule.childrenRepository.getAll({ includeDeleted: true });
      const tombstone = includingDeleted.find(function (c) { return c[childrenModule.CHILDREN_ID_FIELD] === deletedId; });
      assert.ok(tombstone && tombstone.deletedAt, 'record is soft-deleted, still in storage with deletedAt');
      assert.ok(!childrenModule.childrenRepository.exists(deletedId), 'but exists()/getAll()/get() all correctly hide it');
    });
  }

  // ================================================================
  // 3. exists() / count() spot checks against the live Repository
  // ================================================================

  await checkAsync('ChildrenRepository.exists()/count() reflect the current (soft-delete-aware) record set', async () => {
    const remaining = childrenModule.childrenRepository.getAll();
    assert.strictEqual(remaining.length, 2);
    const id = remaining[0][childrenModule.CHILDREN_ID_FIELD];
    assert.ok(childrenModule.childrenRepository.exists(id));
    assert.strictEqual(childrenModule.childrenRepository.count(), 2);
  });

  // ================================================================
  // 4. Backward compatibility — pre-existing legacy-shaped localStorage
  // ================================================================

  {
    const legacySeed = {
      children: JSON.stringify([
        {
          'رقم_الطفل': 'legacy-child-1',
          'رقم_القضية': '2025-900',
          'الاسم': 'طفل قديم',
          'تاريخ_الميلاد': '2012-01-01',
          'السن': '13',
          'المدرسة': 'مدرسة قديمة',
          'محل_الإقامة': 'القاهرة',
          'الحضانة_الحالية': 'الأم',
          'النفقة_الحالية': '500',
          'ملاحظات': '',
          'تاريخ_الإنشاء': '2025-06-01T00:00:00.000Z'
        }
      ])
    };
    const fakeStorage = makeFakeStorage(legacySeed);
    const fakeIndexedDB = new FakeIndexedDB();
    const legacyFakeElements = {};

    const legacyGlobals = {
      localStorage: fakeStorage,
      indexedDB: fakeIndexedDB,
      window: global,
      data: { children: [], cases: [] },
      editIdx: { children: -1 },
      API_URL: '',
      document: { getElementById: function (id) { if (!legacyFakeElements[id]) legacyFakeElements[id] = makeFakeElement(); return legacyFakeElements[id]; } },
      toast: function () {},
      updateBadges: function () {},
      closeModal: function () {},
      populateCaseDropdown: function () {},
      val: function (id) { const el = legacyFakeElements[id]; return el ? el.value : ''; },
      uid: function () { return 'x'; },
      collectForm: function () { return {}; },
      fillForm: function () {},
      resetForm: function () {},
      syncToSheets: function () {},
      saveLocal: function () {},
      confirm: function () { return true; },
      confirmDialog: __confirmDialogStub,
      console: console
    };

    setGlobals(legacyGlobals);
    const { createChildrenLocalStorageAdapter } = require(childrenRepoPath);
    const seedAdapter = createChildrenLocalStorageAdapter(fakeIndexedDB);
    await seedAdapter.write('children', JSON.parse(legacySeed.children));

    const legacyChildrenModule = loadModule(childrenJsPath);

    await checkAsync('Pre-existing legacy-shaped "children" data loads unchanged through the Repository', async () => {
      await legacyChildrenModule.ensureChildrenRepositoryReady();
      const all = legacyChildrenModule.childrenRepository.getAll();
      assert.strictEqual(all.length, 1);
      assert.strictEqual(all[0]['رقم_الطفل'], 'legacy-child-1');
      assert.strictEqual(all[0]['الاسم'], 'طفل قديم');
      assert.deepStrictEqual(legacyGlobals.data.children, all);
    });

    await checkAsync('Storage key unchanged: writes still land in the bare "children" object store (no prefix)', async () => {
      const raw = await seedAdapter.read('children');
      assert.ok(Array.isArray(raw));
      assert.strictEqual(raw[0]['رقم_الطفل'], 'legacy-child-1');
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
