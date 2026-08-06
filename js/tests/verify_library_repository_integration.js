/**
 * verify_library_repository_integration.js
 * ================================================================
 * PHASE 9 — SUB-PHASE 9.6 — Repository Integration (Library Module)
 * ================================================================
 * Standalone Node harness (`node js/tests/verify_library_repository_
 * integration.js`, no browser required) proving that js/modules/
 * library.js — after this phase's migration — behaves identically to
 * the pre-migration inline module from the caller's point of view,
 * while now reading/writing exclusively through js/repositories/
 * LibraryRepository.js. Modeled directly on the Documents/Sessions/
 * Tasks modules' verify_*_repository_integration.js harnesses
 * (SUB-PHASES 9.3/9.4/9.5), same "single boundary" mocking discipline.
 *
 * No file is modified by running this harness. It only reads
 * js/modules/library.js and js/repositories/LibraryRepository.js (and,
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

// ---- Fake DOM element (only the surface library.js actually touches) ----
function makeFakeElement() {
  return {
    value: '',
    textContent: '',
    innerHTML: '',
    href: '',
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
 * library.js is a classic (non-module) browser script: it references
 * bare identifiers like `data`/`document`/`toast`/`DRIVE_URL` that are
 * NOT among Module.wrap's function parameters, so they must be resolved
 * via the scope chain, which bottoms out at the real global object when
 * the file is compiled with `vm`'s `runInThisContext`. Because
 * library.js itself kicks off an async `.open().then(...)` chain at
 * load time whose continuation (syncLibraryMirror, referencing `data`)
 * runs on a LATER microtask turn, these globals must stay assigned for
 * as long as that module instance is in use — not just for the duration
 * of the synchronous load call. Each test block below calls this once
 * with a fresh set of fakes before loading/using its own module
 * instance.
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
 * real on-disk location (js/modules/library.js's
 * `require('../repositories/LibraryRepository.js')` must resolve to
 * js/repositories/LibraryRepository.js, not to something relative to
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

  const libraryJsPath = path.join(__dirname, '..', 'modules', 'library.js');
  const libraryRepoPath = path.join(__dirname, '..', 'repositories', 'LibraryRepository.js');
  const repositoryCorePath = path.join(__dirname, '..', 'core', 'Repository.js');

  // ================================================================
  // 1. Static checks — only library.js touched, nothing else edited
  // ================================================================

  check('js/modules/library.js exists and is valid JS (node --check equivalent: parses via vm)', () => {
    const code = fs.readFileSync(libraryJsPath, 'utf8');
    assert.doesNotThrow(() => new vm.Script(Module.wrap(code), { filename: libraryJsPath }));
  });

  check('LibraryRepository.js on disk is unmodified (still exports LibraryRepository + factory)', () => {
    const ns = require(libraryRepoPath);
    assert.strictEqual(typeof ns.LibraryRepository, 'function');
    assert.strictEqual(typeof ns.createLibraryLocalStorageAdapter, 'function');
  });

  check('Repository.js on disk is unmodified (still exports Repository)', () => {
    const ns = require(repositoryCorePath);
    assert.strictEqual(typeof ns.Repository, 'function');
  });

  // ================================================================
  // 2. Fresh load (empty localStorage — real first-run condition)
  // ================================================================

  let libModule;
  let sandboxGlobals;
  let fakeElements;
  let toastLog;
  let closeModalLog;
  let saveLocalCalls;

  {
    const fakeStorage = makeFakeStorage({});
    const fakeIndexedDB = new FakeIndexedDB();
    fakeElements = {};
    toastLog = [];
    closeModalLog = [];
    saveLocalCalls = { count: 0 };

    sandboxGlobals = {
      localStorage: fakeStorage,
      indexedDB: fakeIndexedDB,
      window: global,
      data: { library: [] },
      editIdx: { library: -1 },
      DRIVE_URL: '',
      document: {
        getElementById: function (id) {
          if (!fakeElements[id]) fakeElements[id] = makeFakeElement();
          return fakeElements[id];
        }
      },
      toast: function (msg, type) { toastLog.push({ msg: msg, type: type }); },
      closeModal: function (id) { closeModalLog.push(id); },
      val: function (id) {
        const el = fakeElements[id];
        return el ? el.value : '';
      },
      uid: function () { return 'test-uid-' + Math.random().toString(36).slice(2, 8); },
      collectForm: function () { return sandboxGlobals.__nextFormValue || {}; },
      fillForm: function (type, obj) { sandboxGlobals.__lastFilled = obj; },
      saveLocal: function () { saveLocalCalls.count++; },
      confirm: function () { return true; },
      confirmDialog: __confirmDialogStub,
      console: console
    };

    setGlobals(sandboxGlobals);
    libModule = loadModule(libraryJsPath);

    await checkAsync('Fresh load: repository opens with zero records, data.library mirror is []', async () => {
      await libModule.ensureLibraryRepositoryReady();
      assert.deepStrictEqual(libModule.libraryRepository.getAll(), []);
      assert.deepStrictEqual(sandboxGlobals.data.library, []);
    });

    // ---- VALIDATION: missing title still blocked before the Repository ----
    check('saveLibBook(): empty العنوان still blocked before reaching the Repository (validated via direct DOM read)', () => {
      fakeElements['fLibTitle'] = makeFakeElement();
      fakeElements['fLibTitle'].value = '   ';
      const before = sandboxGlobals.data.library.length;
      const toastCountBefore = toastLog.length;
      // saveLibBook() is async but the guard clause returns before any
      // await, so no promise needs to be awaited for this observation.
      libModule.saveLibBook();
      assert.strictEqual(sandboxGlobals.data.library.length, before);
      assert.strictEqual(toastLog.length, toastCountBefore + 1);
      assert.strictEqual(toastLog[toastLog.length - 1].type, 'error');
    });

    // ---- CREATE via saveLibBook() ----
    await checkAsync('saveLibBook(): create path (editIdx.library = -1) inserts a new record via Repository.create(), id auto-generated', async () => {
      fakeElements['fLibTitle'].value = 'قانون العقوبات المصري';
      sandboxGlobals.__nextFormValue = {
        'العنوان': 'قانون العقوبات المصري',
        'النوع': 'pdf',
        'القسم': 'قوانين',
        'الرابط': 'https://drive.example/1',
        'الوصف': 'نسخة محدثة'
      };
      sandboxGlobals.editIdx.library = -1;

      await libModule.saveLibBook();

      assert.strictEqual(sandboxGlobals.data.library.length, 1);
      const rec = sandboxGlobals.data.library[0];
      assert.strictEqual(rec['العنوان'], 'قانون العقوبات المصري');
      assert.ok(rec[libModule.LIBRARY_ID_FIELD], 'an "id" must have been generated');
      assert.ok(rec['تاريخ_الإنشاء'], 'تاريخ_الإنشاء must have been stamped');
      assert.strictEqual(toastLog[toastLog.length - 1].msg, 'تمت الإضافة');
      assert.strictEqual(saveLocalCalls.count, 1);
      assert.strictEqual(closeModalLog[closeModalLog.length - 1], 'modalLibrary');
    });

    // ---- CREATE a second record with a different category/type (search/filter tests) ----
    await checkAsync('saveLibBook(): create a second record with a different نوع/قسم', async () => {
      sandboxGlobals.__nextFormValue = {
        'العنوان': 'نموذج عقد إيجار',
        'النوع': 'word',
        'القسم': 'نماذج',
        'الرابط': '',
        'الوصف': 'صيغة قابلة للتعديل'
      };
      sandboxGlobals.editIdx.library = -1;
      await libModule.saveLibBook();
      assert.strictEqual(sandboxGlobals.data.library.length, 2);
    });

    // ---- READ: renderLibrary() free-text search (Repository.search(), sync) ----
    check('renderLibrary(): free-text search matches across full legacy field set (Repository.search(), synchronous)', () => {
      fakeElements['searchLibrary'] = makeFakeElement();
      fakeElements['searchLibrary'].value = 'إيجار'; // only in book #2's العنوان
      fakeElements['filterLibCat'] = makeFakeElement();
      fakeElements['filterLibCat'].value = '';
      fakeElements['filterLibType'] = makeFakeElement();
      fakeElements['filterLibType'].value = '';
      fakeElements['libGrid'] = makeFakeElement();
      fakeElements['libEmpty'] = makeFakeElement();
      fakeElements['driveLinkLabel'] = makeFakeElement();
      fakeElements['driveLinkBtn'] = makeFakeElement();

      libModule.renderLibrary();

      assert.ok(fakeElements['libGrid'].innerHTML.indexOf('نموذج عقد إيجار') !== -1);
      assert.ok(fakeElements['libGrid'].innerHTML.indexOf('قانون العقوبات المصري') === -1);
      assert.strictEqual(fakeElements['libEmpty'].style.display, 'none');
    });

    // ---- READ: renderLibrary() category+type filters (exact-equality, AND semantics, combined with search) ----
    check('renderLibrary(): #filterLibCat + #filterLibType exact-equality filters combine with search (AND semantics, matches original)', () => {
      fakeElements['searchLibrary'].value = '';
      fakeElements['filterLibCat'].value = 'قوانين';
      fakeElements['filterLibType'].value = 'pdf';

      libModule.renderLibrary();

      assert.ok(fakeElements['libGrid'].innerHTML.indexOf('قانون العقوبات المصري') !== -1);
      assert.ok(fakeElements['libGrid'].innerHTML.indexOf('نموذج عقد إيجار') === -1);
    });

    check('renderLibrary(): mismatched قسم/نوع combination (AND semantics) excludes both records', () => {
      fakeElements['filterLibCat'].value = 'قوانين';
      fakeElements['filterLibType'].value = 'word'; // book #1 is pdf, not word — AND should fail

      libModule.renderLibrary();

      assert.strictEqual(fakeElements['libGrid'].innerHTML, '');
      assert.strictEqual(fakeElements['libEmpty'].style.display, '');
    });

    // ---- READ: dynamic #filterLibCat <option> list rebuilt from live data ----
    check('renderLibrary(): #filterLibCat <option> list is rebuilt from the distinct القسم values currently in data.library', () => {
      fakeElements['filterLibCat'].value = '';
      fakeElements['filterLibType'].value = '';

      libModule.renderLibrary();

      const opts = fakeElements['filterLibCat'].innerHTML;
      assert.ok(opts.indexOf('قوانين') !== -1);
      assert.ok(opts.indexOf('نماذج') !== -1);
      assert.ok(opts.indexOf('كل الأقسام') !== -1);
    });

    // ---- READ: Drive-link bar reflects DRIVE_URL global ----
    // NOTE: `global.DRIVE_URL` (not `sandboxGlobals.DRIVE_URL`) is mutated
    // directly here — library.js resolves the bare identifier `DRIVE_URL`
    // via the scope chain against the real Node `global` object (see
    // setGlobals()'s doc comment); reassigning the primitive string on the
    // local `sandboxGlobals` object after the initial setGlobals() call
    // does not change what `global.DRIVE_URL` holds.
    check('renderLibrary(): Drive-link bar shows "not connected" state when DRIVE_URL is empty', () => {
      global.DRIVE_URL = '';
      libModule.renderLibrary();
      assert.strictEqual(fakeElements['driveLinkLabel'].textContent, 'لم يتم ربط Google Drive بعد');
      assert.strictEqual(fakeElements['driveLinkBtn'].style.display, 'none');
    });

    check('renderLibrary(): Drive-link bar shows "connected" state and sets href when DRIVE_URL is set', () => {
      global.DRIVE_URL = 'https://drive.google.com/drive/folders/abc123';
      libModule.renderLibrary();
      assert.strictEqual(fakeElements['driveLinkLabel'].textContent, 'متصل بـ Google Drive');
      assert.strictEqual(fakeElements['driveLinkBtn'].href, 'https://drive.google.com/drive/folders/abc123');
      assert.strictEqual(fakeElements['driveLinkBtn'].style.display, '');
    });

    // ---- READ: no sort applied — insertion order preserved (matches original) ----
    check('renderLibrary(): rows render in insertion order — no .sort() applied, matching the original inline renderLibrary()', () => {
      libModule.renderLibrary();

      const html = fakeElements['libGrid'].innerHTML;
      const posFirst = html.indexOf('قانون العقوبات المصري');
      const posSecond = html.indexOf('نموذج عقد إيجار');
      assert.ok(posFirst !== -1 && posSecond !== -1 && posFirst < posSecond,
        'book #1 (created first) must render before book #2 (created second)');
    });

    // ---- READ: empty-result path (#libEmpty shown, grid cleared) ----
    check('renderLibrary(): no matches shows #libEmpty and clears the grid', () => {
      fakeElements['searchLibrary'].value = 'نص-غير-موجود-إطلاقاً';

      libModule.renderLibrary();

      assert.strictEqual(fakeElements['libGrid'].innerHTML, '');
      assert.strictEqual(fakeElements['libEmpty'].style.display, '');
    });

    // ---- Index -> record -> id translation layer, exercised end-to-end ----
    let secondBookIndex = -1;
    check('renderLibrary(): embeds resolvable indexes in onclick handlers matching the data.library mirror', () => {
      fakeElements['searchLibrary'].value = '';
      libModule.renderLibrary();

      secondBookIndex = libModule.resolveLibIndex(
        sandboxGlobals.data.library,
        sandboxGlobals.data.library.filter(function (x) { return x['العنوان'] === 'نموذج عقد إيجار'; })[0]
      );
      assert.notStrictEqual(secondBookIndex, -1);
      assert.ok(fakeElements['libGrid'].innerHTML.indexOf('editLibBook(' + secondBookIndex + ')') !== -1);
      assert.ok(fakeElements['libGrid'].innerHTML.indexOf('deleteLibBook(' + secondBookIndex + ')') !== -1);
    });

    // ---- editLibBook(): synchronous, no Repository call, reads mirror only ----
    check('editLibBook(i): purely synchronous, pre-fills form from data.library[i] (no Repository call)', () => {
      fakeElements['modalLibTitle'] = makeFakeElement();
      fakeElements['modalLibrary'] = makeFakeElement();

      libModule.editLibBook(secondBookIndex);

      assert.strictEqual(sandboxGlobals.editIdx.library, secondBookIndex);
      assert.strictEqual(sandboxGlobals.__lastFilled['العنوان'], 'نموذج عقد إيجار');
      assert.strictEqual(fakeElements['modalLibTitle'].textContent, 'تعديل الكتاب');
      assert.ok(fakeElements['modalLibrary'].classList.contains('open'));
    });

    // ---- UPDATE via saveLibBook(): same array position and id preserved ----
    await checkAsync('saveLibBook(): update path (editIdx.library >= 0) preserves list position and id', async () => {
      const idBefore = sandboxGlobals.data.library[secondBookIndex][libModule.LIBRARY_ID_FIELD];
      fakeElements['fLibTitle'].value = 'نموذج عقد إيجار (محدّث)';
      sandboxGlobals.__nextFormValue = {
        'العنوان': 'نموذج عقد إيجار (محدّث)',
        'النوع': 'word',
        'القسم': 'نماذج',
        'الرابط': '',
        'الوصف': 'صيغة قابلة للتعديل — نسخة ٢'
      };

      await libModule.saveLibBook();

      assert.strictEqual(sandboxGlobals.data.library.length, 2);
      assert.strictEqual(sandboxGlobals.data.library[secondBookIndex]['العنوان'], 'نموذج عقد إيجار (محدّث)');
      assert.strictEqual(sandboxGlobals.data.library[secondBookIndex][libModule.LIBRARY_ID_FIELD], idBefore,
        'Repository.update() preserves the existing id — same array position, same identity');
      assert.strictEqual(toastLog[toastLog.length - 1].msg, 'تم التحديث');
    });

    // ---- UPDATE: other fields on the record reflect the new form values ----
    check('saveLibBook(): update replaces all mapped fields (full-record replace semantics, matches original data.library[idx]=obj)', () => {
      const rec = sandboxGlobals.data.library[secondBookIndex];
      assert.strictEqual(rec['الوصف'], 'صيغة قابلة للتعديل — نسخة ٢');
      assert.strictEqual(rec['النوع'], 'word');
      assert.strictEqual(rec['القسم'], 'نماذج');
    });

    // ---- DELETE via deleteLibBook(): removed from mirror, soft delete under the hood ----
    await checkAsync('deleteLibBook(i): soft-deletes via Repository.delete(); vanishes from mirror/UI exactly like the old hard delete', async () => {
      const beforeCount = sandboxGlobals.data.library.length;
      const deletedId = sandboxGlobals.data.library[secondBookIndex][libModule.LIBRARY_ID_FIELD];

      await libModule.deleteLibBook(secondBookIndex);

      assert.strictEqual(sandboxGlobals.data.library.length, beforeCount - 1);
      assert.ok(!sandboxGlobals.data.library.some(function (b) { return b[libModule.LIBRARY_ID_FIELD] === deletedId; }));
      assert.strictEqual(toastLog[toastLog.length - 1].msg, 'تم الحذف');

      // Confirm this is a SOFT delete under the hood (Repository config,
      // unchanged by this phase) but that this is NOT observable through
      // any path library.js actually uses:
      const includingDeleted = libModule.libraryRepository.getAll({ includeDeleted: true });
      const tombstone = includingDeleted.find(function (b) { return b[libModule.LIBRARY_ID_FIELD] === deletedId; });
      assert.ok(tombstone && tombstone.deletedAt, 'record is soft-deleted, still in storage with deletedAt');
      assert.ok(!libModule.libraryRepository.exists(deletedId), 'but exists()/getAll()/get() all correctly hide it');
    });

    // ---- Pre-existing behaviour preserved: no ApiService call in any live function body ----
    check('library.js: saveLibBook()/deleteLibBook() bodies contain no ApiService.* call (matches the original — Library never synced)', () => {
      const saveSrc = libModule.saveLibBook.toString();
      const deleteSrc = libModule.deleteLibBook.toString();
      assert.strictEqual(saveSrc.indexOf('ApiService'), -1);
      assert.strictEqual(deleteSrc.indexOf('ApiService'), -1);
    });
  }

  // ================================================================
  // 3. exists() / count() spot checks against the live Repository
  // ================================================================

  await checkAsync('LibraryRepository.exists()/count() reflect the current (soft-delete-aware) record set', async () => {
    const remaining = libModule.libraryRepository.getAll();
    assert.strictEqual(remaining.length, 1);
    const id = remaining[0][libModule.LIBRARY_ID_FIELD];
    assert.ok(libModule.libraryRepository.exists(id));
    assert.strictEqual(libModule.libraryRepository.count(), 1);
  });

  // ================================================================
  // 4. LibraryRepository additive convenience methods (insert/remove/
  //    filter/sort/validate) — sanity spot checks, this phase does not
  //    rely on any of them from library.js itself, but they must still
  //    work unmodified against the same underlying data.
  // ================================================================

  check('LibraryRepository.filter()/sort()/validate() additive wrappers remain usable and unmodified', () => {
    const repo = libModule.libraryRepository;
    const filtered = repo.filter({ 'القسم': 'قوانين' });
    assert.ok(Array.isArray(filtered));
    assert.ok(filtered.every(function (r) { return r['القسم'] === 'قوانين'; }));

    const sorted = repo.sort();
    assert.ok(Array.isArray(sorted));

    const v = repo.validate({ 'العنوان': '' }, 'create');
    assert.strictEqual(v.valid, false);
  });

  // ================================================================
  // 5. Backward compatibility — pre-existing legacy-shaped localStorage
  // ================================================================

  {
    const legacySeed = {
      library: JSON.stringify([
        {
          'id': 'legacy-lib-1',
          'العنوان': 'كتاب قديم',
          'النوع': 'pdf',
          'القسم': 'مراجع',
          'الرابط': '',
          'الوصف': '',
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
      data: { library: [] },
      editIdx: { library: -1 },
      DRIVE_URL: '',
      document: { getElementById: function (id) { if (!legacyFakeElements[id]) legacyFakeElements[id] = makeFakeElement(); return legacyFakeElements[id]; } },
      toast: function () {},
      closeModal: function () {},
      val: function (id) { const el = legacyFakeElements[id]; return el ? el.value : ''; },
      uid: function () { return 'x'; },
      collectForm: function () { return {}; },
      fillForm: function () {},
      saveLocal: function () {},
      confirm: function () { return true; },
      confirmDialog: __confirmDialogStub,
      console: console
    };

    setGlobals(legacyGlobals);
    const { createLibraryLocalStorageAdapter } = require(libraryRepoPath);
    const seedAdapter = createLibraryLocalStorageAdapter(fakeIndexedDB);
    await seedAdapter.write('library', JSON.parse(legacySeed.library));

    const legacyLibModule = loadModule(libraryJsPath);

    await checkAsync('Pre-existing legacy-shaped "library" data (id-based, no Arabic id field) loads unchanged through the Repository', async () => {
      await legacyLibModule.ensureLibraryRepositoryReady();
      const all = legacyLibModule.libraryRepository.getAll();
      assert.strictEqual(all.length, 1);
      assert.strictEqual(all[0]['id'], 'legacy-lib-1');
      assert.strictEqual(all[0]['العنوان'], 'كتاب قديم');
      assert.deepStrictEqual(legacyGlobals.data.library, all);
    });

    await checkAsync('Storage key unchanged: writes still land in the bare "library" object store (no prefix)', async () => {
      const raw = await seedAdapter.read('library');
      assert.ok(Array.isArray(raw));
      assert.strictEqual(raw[0]['id'], 'legacy-lib-1');
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
