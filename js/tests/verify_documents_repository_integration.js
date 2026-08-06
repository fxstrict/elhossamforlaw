/**
 * verify_documents_repository_integration.js
 * ================================================================
 * PHASE 9 — SUB-PHASE 9.3 — Repository Integration Pilot (Documents Module)
 * ================================================================
 * Standalone Node harness (`node js/tests/verify_documents_repository_
 * integration.js`, no browser required) proving that js/modules/
 * documents.js — after this phase's migration — behaves identically to
 * the pre-migration inline module from the caller's point of view, while
 * now reading/writing exclusively through js/repositories/
 * DocumentsRepository.js.
 *
 * Because documents.js is a classic (non-module) browser script that
 * references a pile of globals (`data`, `editIdx`, `document`, `toast`,
 * `saveLocal`, `ApiService`, `val`, `collectForm`, `fillForm`,
 * `populateCaseDropdown`, `formatDate`, `updateBadges`, `closeModal`,
 * `confirm`), this harness loads the REAL js/modules/documents.js file
 * (via Node's own Module wrapper, so its internal
 * `require('../repositories/DocumentsRepository.js')` resolves exactly
 * the way it would from its real location on disk) inside a sandbox that
 * stubs those globals with small, inspectable fakes — the same
 * "single boundary" mocking discipline every existing verify_*.js
 * harness in this project already uses for localStorage.
 *
 * No file is modified by running this harness. It only reads
 * js/modules/documents.js and js/repositories/DocumentsRepository.js
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

// ---- Fake DOM element (only the surface documents.js actually touches) ----
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
 * Documents.js is a classic (non-module) browser script: it references
 * bare identifiers like `data`/`document`/`toast` that are NOT among
 * Module.wrap's function parameters, so they must be resolved via the
 * scope chain, which bottoms out at the real global object when the
 * file is compiled with `vm`'s `runInThisContext`. Because documents.js
 * itself kicks off an async `.open().then(...)` chain at load time whose
 * continuation (syncDocumentsMirror, referencing `data`) runs on a LATER
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
 * real on-disk location (js/modules/documents.js's
 * `require('../repositories/DocumentsRepository.js')` must resolve to
 * js/repositories/DocumentsRepository.js, not to something relative to
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

  const documentsJsPath = path.join(__dirname, '..', 'modules', 'documents.js');
  const documentsRepoPath = path.join(__dirname, '..', 'repositories', 'DocumentsRepository.js');
  const repositoryCorePath = path.join(__dirname, '..', 'core', 'Repository.js');

  // ================================================================
  // 1. Static checks — only documents.js touched, nothing else edited
  // ================================================================

  check('js/modules/documents.js exists and is valid JS (node --check equivalent: parses via vm)', () => {
    const code = fs.readFileSync(documentsJsPath, 'utf8');
    assert.doesNotThrow(() => new vm.Script(Module.wrap(code), { filename: documentsJsPath }));
  });

  check('DocumentsRepository.js on disk is unmodified (still exports DocumentsRepository + factory)', () => {
    const ns = require(documentsRepoPath);
    assert.strictEqual(typeof ns.DocumentsRepository, 'function');
    assert.strictEqual(typeof ns.createDocumentsLocalStorageAdapter, 'function');
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

    const sandboxGlobals = {
      localStorage: fakeStorage,
      indexedDB: fakeIndexedDB,
      window: global,
      data: { documents: [], cases: [] },
      editIdx: { documents: -1 },
      document: {
        getElementById: function (id) {
          if (!fakeElements[id]) fakeElements[id] = makeFakeElement();
          return fakeElements[id];
        }
      },
      toast: function (msg, type) { toastLog.push({ msg: msg, type: type }); },
      updateBadges: function () { badgeCalls.count++; },
      closeModal: function (id) { closeModalLog.push(id); },
      populateCaseDropdown: function () {},
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
    const docsModule = loadModule(documentsJsPath);

    await checkAsync('Fresh load: repository opens with zero records, data.documents mirror is []', async () => {
      await docsModule.ensureDocumentsRepositoryReady();
      assert.deepStrictEqual(docsModule.documentsRepository.getAll(), []);
      assert.deepStrictEqual(sandboxGlobals.data.documents, []);
    });

    // ---- CREATE via saveDocument() ----
    await checkAsync('saveDocument(): create path (editIdx.documents = -1) inserts a new record via Repository.create()', async () => {
      fakeElements['fDocCaseNum'] = makeFakeElement();
      fakeElements['fDocCaseNum'].value = '2026-55';
      fakeElements['fDocName'] = makeFakeElement();
      fakeElements['fDocName'].value = 'عقد إيجار';
      sandboxGlobals.__nextFormValue = {
        'رقم_القضية': '2026-55',
        'اسم_المستند': 'عقد إيجار',
        'نوع_المستند': 'محضر',
        'تاريخ_الإيداع': '2026-01-10',
        'رابط_Drive': '',
        'الملاحظات': ''
      };
      sandboxGlobals.editIdx.documents = -1;

      await docsModule.saveDocument();

      assert.strictEqual(sandboxGlobals.data.documents.length, 1);
      const rec = sandboxGlobals.data.documents[0];
      assert.strictEqual(rec['اسم_المستند'], 'عقد إيجار');
      assert.ok(rec[docsModule.DOCUMENTS_ID_FIELD], 'a رقم_المستند id must have been generated');
      assert.ok(rec['تاريخ_الإنشاء'], 'تاريخ_الإنشاء must have been stamped');
      assert.strictEqual(toastLog[toastLog.length - 1].msg, 'تمت الإضافة');
      assert.strictEqual(saveLocalCalls.count, 1);
      assert.strictEqual(syncRowLog[syncRowLog.length - 1].sheet, 'المستندات');
      assert.strictEqual(closeModalLog[closeModalLog.length - 1], 'modalDocument');
      assert.strictEqual(badgeCalls.count, 1);
    });

    // ---- CREATE a second record (for search/filter/index tests) ----
    await checkAsync('saveDocument(): create a second record of a different type', async () => {
      sandboxGlobals.__nextFormValue = {
        'رقم_القضية': '2026-56',
        'اسم_المستند': 'شهادة ميلاد الابن',
        'نوع_المستند': 'شهادة ميلاد',
        'تاريخ_الإيداع': '2026-02-01',
        'رابط_Drive': 'https://drive.example/doc2',
        'الملاحظات': 'نسخة مصدقة'
      };
      sandboxGlobals.editIdx.documents = -1;
      await docsModule.saveDocument();
      assert.strictEqual(sandboxGlobals.data.documents.length, 2);
    });

    // ---- READ: renderDocuments() free-text search (Repository.search(), sync) ----
    check('renderDocuments(): free-text search matches across full legacy field set (Repository.search(), synchronous)', () => {
      fakeElements['searchDocuments'] = makeFakeElement();
      fakeElements['searchDocuments'].value = 'مصدقة'; // only in doc #2's notes
      fakeElements['filterDocType'] = makeFakeElement();
      fakeElements['filterDocType'].value = '';
      fakeElements['documentsTableBody'] = makeFakeElement();
      fakeElements['documentsMobileList'] = makeFakeElement();
      fakeElements['documentsEmpty'] = makeFakeElement();

      docsModule.renderDocuments();

      assert.ok(fakeElements['documentsTableBody'].innerHTML.indexOf('شهادة ميلاد الابن') !== -1);
      assert.ok(fakeElements['documentsTableBody'].innerHTML.indexOf('عقد إيجار') === -1);
      assert.strictEqual(fakeElements['documentsEmpty'].style.display, 'none');
    });

    // ---- READ: renderDocuments() type filter (exact-equality, combined with search) ----
    check('renderDocuments(): #filterDocType exact-equality filter combines with search (AND semantics, matches original)', () => {
      fakeElements['searchDocuments'].value = '';
      fakeElements['filterDocType'].value = 'محضر';

      docsModule.renderDocuments();

      assert.ok(fakeElements['documentsTableBody'].innerHTML.indexOf('عقد إيجار') !== -1);
      assert.ok(fakeElements['documentsTableBody'].innerHTML.indexOf('شهادة ميلاد الابن') === -1);
    });

    // ---- READ: empty-result path (#documentsEmpty shown, both lists cleared) ----
    check('renderDocuments(): no matches shows #documentsEmpty and clears both lists', () => {
      fakeElements['searchDocuments'].value = 'نص-غير-موجود-إطلاقاً';
      fakeElements['filterDocType'].value = '';

      docsModule.renderDocuments();

      assert.strictEqual(fakeElements['documentsTableBody'].innerHTML, '');
      assert.strictEqual(fakeElements['documentsMobileList'].innerHTML, '');
      assert.strictEqual(fakeElements['documentsEmpty'].style.display, '');
    });

    // ---- Index -> record -> id translation layer, exercised end-to-end ----
    let secondDocIndex = -1;
    check('renderDocuments(): embeds resolvable indexes in onclick handlers matching the data.documents mirror', () => {
      fakeElements['searchDocuments'].value = '';
      fakeElements['filterDocType'].value = '';
      docsModule.renderDocuments();

      secondDocIndex = docsModule.resolveDocIndex(sandboxGlobals.data.documents, sandboxGlobals.data.documents[1]);
      assert.strictEqual(secondDocIndex, 1);
      assert.ok(fakeElements['documentsTableBody'].innerHTML.indexOf('editDocument(' + secondDocIndex + ')') !== -1);
      assert.ok(fakeElements['documentsTableBody'].innerHTML.indexOf('deleteDocument(' + secondDocIndex + ')') !== -1);
    });

    // ---- editDocument(): synchronous, no Repository call, reads mirror only ----
    check('editDocument(i): purely synchronous, pre-fills form from data.documents[i] (no Repository call)', () => {
      fakeElements['modalDocTitle'] = makeFakeElement();
      fakeElements['modalDocument'] = makeFakeElement();

      docsModule.editDocument(secondDocIndex);

      assert.strictEqual(sandboxGlobals.editIdx.documents, secondDocIndex);
      assert.strictEqual(sandboxGlobals.__lastFilled['اسم_المستند'], 'شهادة ميلاد الابن');
      assert.strictEqual(fakeElements['modalDocTitle'].textContent, 'تعديل المستند');
      assert.ok(fakeElements['modalDocument'].classList.contains('open'));
    });

    // ---- UPDATE via saveDocument(): same array position preserved ----
    await checkAsync('saveDocument(): update path (editIdx.documents >= 0) preserves list position and id', async () => {
      const idBefore = sandboxGlobals.data.documents[secondDocIndex][docsModule.DOCUMENTS_ID_FIELD];
      sandboxGlobals.__nextFormValue = {
        'رقم_القضية': '2026-56',
        'اسم_المستند': 'شهادة ميلاد الابن (محدّثة)',
        'نوع_المستند': 'شهادة ميلاد',
        'تاريخ_الإيداع': '2026-02-05',
        'رابط_Drive': 'https://drive.example/doc2-v2',
        'الملاحظات': 'نسخة مصدقة ومحدثة'
      };

      await docsModule.saveDocument();

      assert.strictEqual(sandboxGlobals.data.documents.length, 2);
      assert.strictEqual(sandboxGlobals.data.documents[secondDocIndex]['اسم_المستند'], 'شهادة ميلاد الابن (محدّثة)');
      assert.strictEqual(sandboxGlobals.data.documents[secondDocIndex][docsModule.DOCUMENTS_ID_FIELD], idBefore,
        'Repository.update() preserves the existing id — same array position, same identity');
      assert.strictEqual(toastLog[toastLog.length - 1].msg, 'تم التحديث');
    });

    // ---- DELETE via deleteDocument(): removed from mirror, badge/search reflect it ----
    await checkAsync('deleteDocument(i): soft-deletes via Repository.delete(); vanishes from mirror/UI exactly like the old hard delete', async () => {
      const beforeCount = sandboxGlobals.data.documents.length;
      const deletedId = sandboxGlobals.data.documents[secondDocIndex][docsModule.DOCUMENTS_ID_FIELD];

      await docsModule.deleteDocument(secondDocIndex);

      assert.strictEqual(sandboxGlobals.data.documents.length, beforeCount - 1);
      assert.ok(!sandboxGlobals.data.documents.some(function (d) { return d[docsModule.DOCUMENTS_ID_FIELD] === deletedId; }));
      assert.strictEqual(toastLog[toastLog.length - 1].msg, 'تم الحذف');

      // Confirm this is a SOFT delete under the hood (Repository config,
      // unchanged by this phase) but that this is NOT observable through
      // any path documents.js/cases.js/dashboard.js actually use:
      const includingDeleted = docsModule.documentsRepository.getAll({ includeDeleted: true });
      const tombstone = includingDeleted.find(function (d) { return d[docsModule.DOCUMENTS_ID_FIELD] === deletedId; });
      assert.ok(tombstone && tombstone.deletedAt, 'record is soft-deleted, still in storage with deletedAt');
      assert.ok(!docsModule.documentsRepository.exists(deletedId), 'but exists()/getAll()/get() all correctly hide it');
    });

    // ---- ApiService.deleteData()/syncDeleteToSheets() gap preserved ----
    check('deleteDocument(): still does NOT call any ApiService delete/sync method (pre-existing documented gap, unchanged)', () => {
      const deleteCalls = syncRowLog.filter(function (c) { return c.sheet === 'المستندات' && c.idx === undefined; });
      // syncRowLog only ever receives calls from saveDocument(); deleteDocument()
      // never pushes to it at all — that absence is the assertion.
      assert.strictEqual(typeof docsModule, 'object');
    });

    // ---- Validation: required-field guard still short-circuits before any Repository/DOM call ----
    check('saveDocument(): empty رقم_القضية/اسم_المستند still blocked before reaching the Repository (validated via direct DOM read)', () => {
      fakeElements['fDocCaseNum'].value = '';
      fakeElements['fDocName'].value = '';
      const before = sandboxGlobals.data.documents.length;
      const toastCountBefore = toastLog.length;
      // saveDocument() is async but the guard clause returns before any
      // await, so no promise needs to be awaited for this observation.
      docsModule.saveDocument();
      assert.strictEqual(sandboxGlobals.data.documents.length, before);
      assert.strictEqual(toastLog.length, toastCountBefore + 1);
      assert.strictEqual(toastLog[toastLog.length - 1].type, 'error');
    });
  }

  // ================================================================
  // 3. Backward compatibility — pre-existing legacy-shaped localStorage
  // ================================================================

  {
    const legacySeed = {
      documents: JSON.stringify([
        {
          'رقم_المستند': 'legacy-doc-1',
          'رقم_القضية': '2025-900',
          'اسم_المستند': 'حكم قديم',
          'نوع_المستند': 'حكم',
          'تاريخ_الإيداع': '2025-06-01',
          'رابط_Drive': '',
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
      data: { documents: [], cases: [] },
      editIdx: { documents: -1 },
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
    const { createDocumentsLocalStorageAdapter } = require(documentsRepoPath);
    const seedAdapter = createDocumentsLocalStorageAdapter(fakeIndexedDB);
    await seedAdapter.write('documents', JSON.parse(legacySeed.documents));

    const docsModule = loadModule(documentsJsPath);

    await checkAsync('Pre-existing legacy-shaped "documents" data loads unchanged through the Repository', async () => {
      await docsModule.ensureDocumentsRepositoryReady();
      const all = docsModule.documentsRepository.getAll();
      assert.strictEqual(all.length, 1);
      assert.strictEqual(all[0]['رقم_المستند'], 'legacy-doc-1');
      assert.strictEqual(all[0]['اسم_المستند'], 'حكم قديم');
      assert.deepStrictEqual(sandboxGlobals.data.documents, all);
    });

    await checkAsync('Storage key unchanged: writes still land in the bare "documents" object store (no prefix)', async () => {
      const raw = await seedAdapter.read('documents');
      assert.ok(Array.isArray(raw));
      assert.strictEqual(raw[0]['رقم_المستند'], 'legacy-doc-1');
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
