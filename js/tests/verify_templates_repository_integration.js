/**
 * verify_templates_repository_integration.js
 * ================================================================
 * PHASE 9 — SUB-PHASE 9.7 — Repository Integration (Templates Module)
 * ================================================================
 * Standalone Node harness (`node js/tests/verify_templates_repository_
 * integration.js`, no browser required) proving that js/modules/
 * templates.js — after this phase's migration — behaves identically to
 * the pre-migration inline module from the caller's point of view,
 * while now reading/writing exclusively through js/repositories/
 * TemplatesRepository.js. Modeled directly on the Documents/Sessions/
 * Tasks/Library modules' verify_*_repository_integration.js harnesses
 * (SUB-PHASES 9.3/9.4/9.5/9.6), same "single boundary" mocking
 * discipline.
 *
 * No file is modified by running this harness. It only reads
 * js/modules/templates.js and js/repositories/TemplatesRepository.js
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

// ---- Fake DOM element (only the surface templates.js actually touches) ----
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
 * templates.js is a classic (non-module) browser script: it references
 * bare identifiers like `data`/`document`/`toast`/`currentTplFilter` that
 * are NOT among Module.wrap's function parameters, so they must be
 * resolved via the scope chain, which bottoms out at the real global
 * object when the file is compiled with `vm`'s `runInThisContext`.
 * Because templates.js itself kicks off an async `.open().then(...)`
 * chain at load time whose continuation (syncTemplatesMirror,
 * referencing `data`) runs on a LATER microtask turn, these globals must
 * stay assigned for as long as that module instance is in use — not just
 * for the duration of the synchronous load call. Each test block below
 * calls this once with a fresh set of fakes before loading/using its own
 * module instance.
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
 * real on-disk location (js/modules/templates.js's
 * `require('../repositories/TemplatesRepository.js')` must resolve to
 * js/repositories/TemplatesRepository.js, not to something relative to
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

  const templatesJsPath = path.join(__dirname, '..', 'modules', 'templates.js');
  const templatesRepoPath = path.join(__dirname, '..', 'repositories', 'TemplatesRepository.js');
  const repositoryCorePath = path.join(__dirname, '..', 'core', 'Repository.js');

  // ================================================================
  // 1. Static checks — only templates.js touched, nothing else edited
  // ================================================================

  check('js/modules/templates.js exists and is valid JS (node --check equivalent: parses via vm)', () => {
    const code = fs.readFileSync(templatesJsPath, 'utf8');
    assert.doesNotThrow(() => new vm.Script(Module.wrap(code), { filename: templatesJsPath }));
  });

  check('TemplatesRepository.js on disk is unmodified (still exports TemplatesRepository + factory)', () => {
    const ns = require(templatesRepoPath);
    assert.strictEqual(typeof ns.TemplatesRepository, 'function');
    assert.strictEqual(typeof ns.createTemplatesLocalStorageAdapter, 'function');
  });

  check('Repository.js on disk is unmodified (still exports Repository)', () => {
    const ns = require(repositoryCorePath);
    assert.strictEqual(typeof ns.Repository, 'function');
  });

  // ================================================================
  // 2. Fresh load (empty localStorage — real first-run condition)
  // ================================================================

  let tplModule;
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
      data: { templates: [] },
      editIdx: { templates: -1 },
      currentTplFilter: 'all',
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
    tplModule = loadModule(templatesJsPath);

    await checkAsync('Fresh load: repository opens with zero records, data.templates mirror is []', async () => {
      await tplModule.ensureTemplatesRepositoryReady();
      assert.deepStrictEqual(tplModule.templatesRepository.getAll(), []);
      assert.deepStrictEqual(sandboxGlobals.data.templates, []);
    });

    // ---- VALIDATION: missing title/category still blocked before the Repository ----
    check('saveTemplate(): empty العنوان still blocked before reaching the Repository (validated via direct DOM read)', () => {
      fakeElements['fTplTitle'] = makeFakeElement();
      fakeElements['fTplTitle'].value = '   ';
      fakeElements['fTplCat'] = makeFakeElement();
      fakeElements['fTplCat'].value = 'نماذج';
      const before = sandboxGlobals.data.templates.length;
      const toastCountBefore = toastLog.length;
      // saveTemplate() is async but the guard clause returns before any
      // await, so no promise needs to be awaited for this observation.
      tplModule.saveTemplate();
      assert.strictEqual(sandboxGlobals.data.templates.length, before);
      assert.strictEqual(toastLog.length, toastCountBefore + 1);
      assert.strictEqual(toastLog[toastLog.length - 1].type, 'error');
    });

    check('saveTemplate(): empty القسم (title present) still blocked before reaching the Repository', () => {
      fakeElements['fTplTitle'].value = 'عقد بيع';
      fakeElements['fTplCat'].value = '   ';
      const before = sandboxGlobals.data.templates.length;
      const toastCountBefore = toastLog.length;
      tplModule.saveTemplate();
      assert.strictEqual(sandboxGlobals.data.templates.length, before);
      assert.strictEqual(toastLog.length, toastCountBefore + 1);
      assert.strictEqual(toastLog[toastLog.length - 1].type, 'error');
    });

    // ---- CREATE via saveTemplate() ----
    await checkAsync('saveTemplate(): create path (editIdx.templates = -1) inserts a new record via Repository.create(), id auto-generated', async () => {
      fakeElements['fTplTitle'].value = 'عقد بيع';
      fakeElements['fTplCat'].value = 'عقود';
      sandboxGlobals.__nextFormValue = {
        'العنوان': 'عقد بيع',
        'النوع': 'word',
        'القسم': 'عقود',
        'الرابط': 'https://drive.example/tpl1',
        'الوصف': 'صيغة عقد بيع قابلة للتعديل'
      };
      sandboxGlobals.editIdx.templates = -1;

      await tplModule.saveTemplate();

      assert.strictEqual(sandboxGlobals.data.templates.length, 1);
      const rec = sandboxGlobals.data.templates[0];
      assert.strictEqual(rec['العنوان'], 'عقد بيع');
      assert.ok(rec[tplModule.TEMPLATES_ID_FIELD], 'an "id" must have been generated');
      assert.ok(rec['تاريخ_الإنشاء'], 'تاريخ_الإنشاء must have been stamped');
      assert.strictEqual(toastLog[toastLog.length - 1].msg, 'تمت الإضافة');
      assert.strictEqual(saveLocalCalls.count, 1);
      assert.strictEqual(closeModalLog[closeModalLog.length - 1], 'modalTemplate');
    });

    // ---- CREATE a second record with a different category (filter tests) ----
    await checkAsync('saveTemplate(): create a second record with a different قسم', async () => {
      sandboxGlobals.__nextFormValue = {
        'العنوان': 'صحيفة دعوى',
        'النوع': 'pdf',
        'القسم': 'مرافعات',
        'الرابط': '',
        'الوصف': 'نموذج صحيفة دعوى'
      };
      sandboxGlobals.editIdx.templates = -1;
      await tplModule.saveTemplate();
      assert.strictEqual(sandboxGlobals.data.templates.length, 2);
    });

    // ---- READ: renderTemplates() 'all' tab shows every record (Repository.getAll(), sync) ----
    check('renderTemplates(): currentTplFilter "all" renders every record via Repository.getAll() (synchronous)', () => {
      fakeElements['templateTabs'] = makeFakeElement();
      fakeElements['templatesGrid'] = makeFakeElement();
      fakeElements['templatesEmpty'] = makeFakeElement();
      // NOTE: `global.currentTplFilter` (not `sandboxGlobals.currentTplFilter`)
      // is mutated directly here — templates.js resolves the bare identifier
      // `currentTplFilter` via the scope chain against the real Node `global`
      // object (see setGlobals()'s doc comment); reassigning the primitive
      // string on the local `sandboxGlobals` object after the initial
      // setGlobals() call does not change what `global.currentTplFilter` holds
      // (same characteristic already documented for library.js's DRIVE_URL).
      global.currentTplFilter = 'all';

      tplModule.renderTemplates();

      assert.ok(fakeElements['templatesGrid'].innerHTML.indexOf('عقد بيع') !== -1);
      assert.ok(fakeElements['templatesGrid'].innerHTML.indexOf('صحيفة دعوى') !== -1);
      assert.strictEqual(fakeElements['templatesEmpty'].style.display, 'none');
    });

    // ---- READ: renderTemplates() category-tab filter (exact-equality, Repository.filter(), sync) ----
    check('renderTemplates(): category tab filter narrows to matching القسم only (Repository.filter(), synchronous)', () => {
      global.currentTplFilter = 'عقود';

      tplModule.renderTemplates();

      assert.ok(fakeElements['templatesGrid'].innerHTML.indexOf('عقد بيع') !== -1);
      assert.ok(fakeElements['templatesGrid'].innerHTML.indexOf('صحيفة دعوى') === -1);
    });

    check('renderTemplates(): a قسم with no matching records shows #templatesEmpty and clears the grid', () => {
      global.currentTplFilter = 'قسم-غير-موجود';

      tplModule.renderTemplates();

      assert.strictEqual(fakeElements['templatesGrid'].innerHTML, '');
      assert.strictEqual(fakeElements['templatesEmpty'].style.display, '');
    });

    // ---- READ: dynamic #templateTabs tab list rebuilt from live data ----
    check('renderTemplates(): #templateTabs list is rebuilt from the distinct القسم values currently in data.templates, plus "all"', () => {
      global.currentTplFilter = 'all';

      tplModule.renderTemplates();

      const tabs = fakeElements['templateTabs'].innerHTML;
      assert.ok(tabs.indexOf('عقود') !== -1);
      assert.ok(tabs.indexOf('مرافعات') !== -1);
      assert.ok(tabs.indexOf("filterTemplates('all')") !== -1);
    });

    // ---- READ: no sort applied — insertion order preserved (matches original) ----
    check('renderTemplates(): rows render in insertion order — no .sort() applied, matching the original inline renderTemplates()', () => {
      tplModule.renderTemplates();

      const html = fakeElements['templatesGrid'].innerHTML;
      const posFirst = html.indexOf('عقد بيع');
      const posSecond = html.indexOf('صحيفة دعوى');
      assert.ok(posFirst !== -1 && posSecond !== -1 && posFirst < posSecond,
        'template #1 (created first) must render before template #2 (created second)');
    });

    // ---- Index -> record -> id translation layer, exercised end-to-end ----
    let secondTemplateIndex = -1;
    check('renderTemplates(): embeds resolvable indexes in onclick handlers matching the data.templates mirror', () => {
      global.currentTplFilter = 'all';
      tplModule.renderTemplates();

      secondTemplateIndex = tplModule.resolveTemplateIndex(
        sandboxGlobals.data.templates,
        sandboxGlobals.data.templates.filter(function (x) { return x['العنوان'] === 'صحيفة دعوى'; })[0]
      );
      assert.notStrictEqual(secondTemplateIndex, -1);
      assert.ok(fakeElements['templatesGrid'].innerHTML.indexOf('editTemplate(' + secondTemplateIndex + ')') !== -1);
      assert.ok(fakeElements['templatesGrid'].innerHTML.indexOf('deleteTemplate(' + secondTemplateIndex + ')') !== -1);
    });

    // ---- editTemplate(): synchronous, no Repository call, reads mirror only ----
    check('editTemplate(i): purely synchronous, pre-fills form from data.templates[i] (no Repository call)', () => {
      fakeElements['modalTplTitle'] = makeFakeElement();
      fakeElements['modalTemplate'] = makeFakeElement();

      tplModule.editTemplate(secondTemplateIndex);

      assert.strictEqual(sandboxGlobals.editIdx.templates, secondTemplateIndex);
      assert.strictEqual(sandboxGlobals.__lastFilled['العنوان'], 'صحيفة دعوى');
      assert.strictEqual(fakeElements['modalTplTitle'].textContent, 'تعديل الصيغة');
      assert.ok(fakeElements['modalTemplate'].classList.contains('open'));
    });

    // ---- UPDATE via saveTemplate(): same array position and id preserved ----
    await checkAsync('saveTemplate(): update path (editIdx.templates >= 0) preserves list position and id', async () => {
      const idBefore = sandboxGlobals.data.templates[secondTemplateIndex][tplModule.TEMPLATES_ID_FIELD];
      fakeElements['fTplTitle'].value = 'صحيفة دعوى (محدّثة)';
      fakeElements['fTplCat'].value = 'مرافعات';
      sandboxGlobals.__nextFormValue = {
        'العنوان': 'صحيفة دعوى (محدّثة)',
        'النوع': 'pdf',
        'القسم': 'مرافعات',
        'الرابط': '',
        'الوصف': 'نموذج صحيفة دعوى — نسخة ٢'
      };

      await tplModule.saveTemplate();

      assert.strictEqual(sandboxGlobals.data.templates.length, 2);
      assert.strictEqual(sandboxGlobals.data.templates[secondTemplateIndex]['العنوان'], 'صحيفة دعوى (محدّثة)');
      assert.strictEqual(sandboxGlobals.data.templates[secondTemplateIndex][tplModule.TEMPLATES_ID_FIELD], idBefore,
        'Repository.update() preserves the existing id — same array position, same identity');
      assert.strictEqual(toastLog[toastLog.length - 1].msg, 'تم التحديث');
    });

    // ---- UPDATE: other fields on the record reflect the new form values ----
    check('saveTemplate(): update replaces all mapped fields (full-record replace semantics, matches original data.templates[idx]=obj)', () => {
      const rec = sandboxGlobals.data.templates[secondTemplateIndex];
      assert.strictEqual(rec['الوصف'], 'نموذج صحيفة دعوى — نسخة ٢');
      assert.strictEqual(rec['النوع'], 'pdf');
      assert.strictEqual(rec['القسم'], 'مرافعات');
    });

    // ---- DELETE via deleteTemplate(): removed from mirror, soft delete under the hood ----
    await checkAsync('deleteTemplate(i): soft-deletes via Repository.delete(); vanishes from mirror/UI exactly like the old hard delete', async () => {
      const beforeCount = sandboxGlobals.data.templates.length;
      const deletedId = sandboxGlobals.data.templates[secondTemplateIndex][tplModule.TEMPLATES_ID_FIELD];

      await tplModule.deleteTemplate(secondTemplateIndex);

      assert.strictEqual(sandboxGlobals.data.templates.length, beforeCount - 1);
      assert.ok(!sandboxGlobals.data.templates.some(function (t) { return t[tplModule.TEMPLATES_ID_FIELD] === deletedId; }));
      assert.strictEqual(toastLog[toastLog.length - 1].msg, 'تم الحذف');

      // Confirm this is a SOFT delete under the hood (Repository config,
      // unchanged by this phase) but that this is NOT observable through
      // any path templates.js actually uses:
      const includingDeleted = tplModule.templatesRepository.getAll({ includeDeleted: true });
      const tombstone = includingDeleted.find(function (t) { return t[tplModule.TEMPLATES_ID_FIELD] === deletedId; });
      assert.ok(tombstone && tombstone.deletedAt, 'record is soft-deleted, still in storage with deletedAt');
      assert.ok(!tplModule.templatesRepository.exists(deletedId), 'but exists()/getAll()/filter() all correctly hide it');
    });

    // ---- Pre-existing behaviour preserved: no ApiService call in any live function body ----
    check('templates.js: saveTemplate()/deleteTemplate() bodies contain no ApiService.* call (matches the original — Templates never synced)', () => {
      const saveSrc = tplModule.saveTemplate.toString();
      const deleteSrc = tplModule.deleteTemplate.toString();
      assert.strictEqual(saveSrc.indexOf('ApiService'), -1);
      assert.strictEqual(deleteSrc.indexOf('ApiService'), -1);
    });
  }

  // ================================================================
  // 3. exists() / count() spot checks against the live Repository
  // ================================================================

  await checkAsync('TemplatesRepository.exists()/count() reflect the current (soft-delete-aware) record set', async () => {
    const remaining = tplModule.templatesRepository.getAll();
    assert.strictEqual(remaining.length, 1);
    const id = remaining[0][tplModule.TEMPLATES_ID_FIELD];
    assert.ok(tplModule.templatesRepository.exists(id));
    assert.strictEqual(tplModule.templatesRepository.count(), 1);
  });

  // ================================================================
  // 4. TemplatesRepository additive convenience methods (insert/remove/
  //    filter/sort/validate) — sanity spot checks, this phase does not
  //    rely on insert()/remove()/sort()/validate() from templates.js
  //    itself (filter() IS used by renderTemplates()), but they must
  //    still work unmodified against the same underlying data.
  // ================================================================

  check('TemplatesRepository.filter()/sort()/validate() additive wrappers remain usable and unmodified', () => {
    const repo = tplModule.templatesRepository;
    const filtered = repo.filter({ 'القسم': 'عقود' });
    assert.ok(Array.isArray(filtered));
    assert.ok(filtered.every(function (r) { return r['القسم'] === 'عقود'; }));

    const sorted = repo.sort();
    assert.ok(Array.isArray(sorted));

    const v = repo.validate({ 'العنوان': '', 'القسم': '' }, 'create');
    assert.strictEqual(v.valid, false);
  });

  // ================================================================
  // 5. Backward compatibility — pre-existing legacy-shaped localStorage
  // ================================================================

  {
    const legacySeed = {
      templates: JSON.stringify([
        {
          'id': 'legacy-tpl-1',
          'العنوان': 'صيغة قديمة',
          'النوع': 'word',
          'القسم': 'نماذج',
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
      data: { templates: [] },
      editIdx: { templates: -1 },
      currentTplFilter: 'all',
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
    const { createTemplatesLocalStorageAdapter } = require(templatesRepoPath);
    const seedAdapter = createTemplatesLocalStorageAdapter(fakeIndexedDB);
    await seedAdapter.write('templates', JSON.parse(legacySeed.templates));

    const legacyTplModule = loadModule(templatesJsPath);

    await checkAsync('Pre-existing legacy-shaped "templates" data (id-based, no Arabic id field) loads unchanged through the Repository', async () => {
      await legacyTplModule.ensureTemplatesRepositoryReady();
      const all = legacyTplModule.templatesRepository.getAll();
      assert.strictEqual(all.length, 1);
      assert.strictEqual(all[0]['id'], 'legacy-tpl-1');
      assert.strictEqual(all[0]['العنوان'], 'صيغة قديمة');
      assert.deepStrictEqual(legacyGlobals.data.templates, all);
    });

    await checkAsync('Storage key unchanged: writes still land in the bare "templates" object store (no prefix)', async () => {
      const raw = await seedAdapter.read('templates');
      assert.ok(Array.isArray(raw));
      assert.strictEqual(raw[0]['id'], 'legacy-tpl-1');
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
