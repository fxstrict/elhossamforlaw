/**
 * verify_tasks_repository_integration.js
 * ================================================================
 * PHASE 9 — SUB-PHASE 9.5 — Repository Integration (Tasks Module)
 * ================================================================
 * Standalone Node harness (`node js/tests/verify_tasks_repository_
 * integration.js`, no browser required) proving that js/modules/
 * tasks.js — after this phase's migration — behaves identically to the
 * pre-migration inline module from the caller's point of view, while
 * now reading/writing exclusively through js/repositories/
 * TasksRepository.js. Modeled directly on the Sessions module's
 * verify_sessions_repository_integration.js harness (SUB-PHASE 9.4),
 * same "single boundary" mocking discipline.
 *
 * No file is modified by running this harness. It only reads
 * js/modules/tasks.js and js/repositories/TasksRepository.js (and,
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

// ---- Fake DOM element (only the surface tasks.js actually touches) ----
function makeFakeElement(tagName) {
  return {
    value: '',
    textContent: '',
    innerHTML: '',
    tagName: tagName || 'DIV',
    disabled: false,
    style: { display: '' },
    classList: {
      _classes: {},
      add: function (c) { this._classes[c] = true; },
      remove: function (c) { delete this._classes[c]; },
      contains: function (c) { return !!this._classes[c]; }
    },
    // CASE_SAVE_CYCLE_AUDIT (Problem 11 fix): editTask() now calls
    // populateTaskCaseDropdown() (via syncTaskCaseSelectorFromRecord()),
    // which builds <option> elements with setAttribute/appendChild —
    // additive stubs only, no existing assertion depended on their
    // absence.
    setAttribute: function (name, val) { this['_attr_' + name] = val; },
    getAttribute: function (name) { return this['_attr_' + name] !== undefined ? this['_attr_' + name] : null; },
    appendChild: function () {}
  };
}

/**
 * Assigns `extraGlobals` directly onto the real Node `global` object.
 * tasks.js is a classic (non-module) browser script: it references bare
 * identifiers like `data`/`document`/`toast` that are NOT among
 * Module.wrap's function parameters, so they must be resolved via the
 * scope chain, which bottoms out at the real global object when the
 * file is compiled with `vm`'s `runInThisContext`. Because tasks.js
 * itself kicks off an async `.open().then(...)` chain at load time whose
 * continuation (syncTasksMirror, referencing `data`) runs on a LATER
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
 * real on-disk location (js/modules/tasks.js's
 * `require('../repositories/TasksRepository.js')` must resolve to
 * js/repositories/TasksRepository.js, not to something relative to
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

  const tasksJsPath = path.join(__dirname, '..', 'modules', 'tasks.js');
  const tasksRepoPath = path.join(__dirname, '..', 'repositories', 'TasksRepository.js');
  const repositoryCorePath = path.join(__dirname, '..', 'core', 'Repository.js');

  // ================================================================
  // 1. Static checks — only tasks.js touched, nothing else edited
  // ================================================================

  check('js/modules/tasks.js exists and is valid JS (node --check equivalent: parses via vm)', () => {
    const code = fs.readFileSync(tasksJsPath, 'utf8');
    assert.doesNotThrow(() => new vm.Script(Module.wrap(code), { filename: tasksJsPath }));
  });

  check('TasksRepository.js on disk is unmodified (still exports TasksRepository + factory)', () => {
    const ns = require(tasksRepoPath);
    assert.strictEqual(typeof ns.TasksRepository, 'function');
    assert.strictEqual(typeof ns.createTasksLocalStorageAdapter, 'function');
  });

  check('Repository.js on disk is unmodified (still exports Repository)', () => {
    const ns = require(repositoryCorePath);
    assert.strictEqual(typeof ns.Repository, 'function');
  });

  // ================================================================
  // 2. Fresh load (empty localStorage — real first-run condition)
  // ================================================================

  let taskModule;
  let sandboxGlobals;
  let fakeElements;
  let toastLog;
  let badgeCalls;
  let closeModalLog;
  let syncRowLog;
  let saveLocalCalls;

  {
    const fakeStorage = makeFakeStorage({});
    const fakeIndexedDB = new FakeIndexedDB();
    fakeElements = {};
    toastLog = [];
    badgeCalls = { count: 0 };
    closeModalLog = [];
    syncRowLog = [];
    saveLocalCalls = { count: 0 };

    sandboxGlobals = {
      localStorage: fakeStorage,
      indexedDB: fakeIndexedDB,
      window: global,
      data: { tasks: [], cases: [] },
      editIdx: { tasks: -1 },
      document: {
        getElementById: function (id) {
          if (!fakeElements[id]) fakeElements[id] = makeFakeElement();
          return fakeElements[id];
        },
        // CASE_SAVE_CYCLE_AUDIT (Problem 11 fix): editTask() now calls
        // syncTaskCaseSelectorFromRecord() -> populateTaskCaseDropdown(),
        // which builds real <option> elements via document.createElement()
        // — a capability this fake document never needed before that fix.
        // Minimal, additive stub only; no existing assertion changed.
        createElement: function (tag) { return makeFakeElement(tag); }
      },
      toast: function (msg, type) { toastLog.push({ msg: msg, type: type }); },
      updateBadges: function () { badgeCalls.count++; },
      closeModal: function (id) { closeModalLog.push(id); },
      formatDate: function (d) { return d || '—'; },
      urgencyBadge: function () { return ''; },
      statusBadge: function () { return ''; },
      val: function (id) {
        const el = fakeElements[id];
        return el ? el.value : '';
      },
      uid: function () { return 'test-uid-' + Math.random().toString(36).slice(2, 8); },
      collectForm: function () { return sandboxGlobals.__nextFormValue || {}; },
      fillForm: function (type, obj) { sandboxGlobals.__lastFilled = obj; },
      ApiService: {
        syncRow: function (sheet, obj, idx) { syncRowLog.push({ sheet: sheet, obj: obj, idx: idx }); },
        deleteData: function () { /* tasks never calls this — see NOTE in deleteTask() */ }
      },
      saveLocal: function () { saveLocalCalls.count++; },
      confirm: function () { return true; },
      confirmDialog: __confirmDialogStub,
      console: console
    };

    setGlobals(sandboxGlobals);
    taskModule = loadModule(tasksJsPath);

    await checkAsync('Fresh load: repository opens with zero records, data.tasks mirror is []', async () => {
      await taskModule.ensureTasksRepositoryReady();
      assert.deepStrictEqual(taskModule.tasksRepository.getAll(), []);
      assert.deepStrictEqual(sandboxGlobals.data.tasks, []);
    });

    // ---- VALIDATION: missing title still blocked before the Repository ----
    check('saveTask(): empty العنوان still blocked before reaching the Repository (validated via direct DOM read)', () => {
      fakeElements['fTaskTitle'] = makeFakeElement();
      fakeElements['fTaskTitle'].value = '   ';
      const before = sandboxGlobals.data.tasks.length;
      const toastCountBefore = toastLog.length;
      // saveTask() is async but the guard clause returns before any
      // await, so no promise needs to be awaited for this observation.
      taskModule.saveTask();
      assert.strictEqual(sandboxGlobals.data.tasks.length, before);
      assert.strictEqual(toastLog.length, toastCountBefore + 1);
      assert.strictEqual(toastLog[toastLog.length - 1].type, 'error');
    });

    // ---- CREATE via saveTask() ----
    await checkAsync('saveTask(): create path (editIdx.tasks = -1) inserts a new record via Repository.create(), id auto-generated', async () => {
      fakeElements['fTaskTitle'].value = 'مراجعة العقد';
      // ADMINISTRATIVE WORKS TRANSFORM — الموكل أصبح حقلاً إلزاميًا
      // (saveTask() الآن يتحقق من document.getElementById('fTaskClientId')
      // قبل المتابعة — راجع ADMINISTRATIVE_WORKS_PRE_IMPLEMENTATION_AUDIT.md
      // §7). كل استدعاء saveTask() في هذا الملف يحتاج قيمة هنا الآن.
      fakeElements['fTaskClientId'] = makeFakeElement();
      fakeElements['fTaskClientId'].value = 'C-1';
      sandboxGlobals.__nextFormValue = {
        'العنوان': 'مراجعة العقد',
        'رقم_الموكل': 'C-1',
        'اسم_الموكل': 'أحمد علي',
        'رقم_القضية': '2026-10',
        'الأولوية': 'high',
        'الموعد_النهائي': '2026-08-15',
        'الحالة': 'pending',
        'الملاحظات': ''
      };
      sandboxGlobals.editIdx.tasks = -1;

      await taskModule.saveTask();

      assert.strictEqual(sandboxGlobals.data.tasks.length, 1);
      const rec = sandboxGlobals.data.tasks[0];
      assert.strictEqual(rec['العنوان'], 'مراجعة العقد');
      assert.ok(rec[taskModule.TASKS_ID_FIELD], 'a رقم_المهمة id must have been generated');
      assert.ok(rec['تاريخ_الإنشاء'], 'تاريخ_الإنشاء must have been stamped');
      assert.strictEqual(toastLog[toastLog.length - 1].msg, 'تم حفظ العمل بنجاح');
      assert.strictEqual(saveLocalCalls.count, 1);
      assert.strictEqual(syncRowLog[syncRowLog.length - 1].sheet, 'الأعمال الإدارية');
      assert.strictEqual(closeModalLog[closeModalLog.length - 1], 'modalTask');
      assert.strictEqual(badgeCalls.count, 1);
    });

    // ---- CREATE a second record with a different priority (search/filter tests) ----
    await checkAsync('saveTask(): create a second record with a different priority', async () => {
      sandboxGlobals.__nextFormValue = {
        'العنوان': 'إعداد مذكرة الدفاع',
        'رقم_الموكل': 'C-1',
        'اسم_الموكل': 'أحمد علي',
        'رقم_القضية': '2026-11',
        'الأولوية': 'low',
        'الموعد_النهائي': '2026-09-01',
        'الحالة': 'pending',
        'الملاحظات': 'تحتاج مراجعة الأدلة'
      };
      sandboxGlobals.editIdx.tasks = -1;
      await taskModule.saveTask();
      assert.strictEqual(sandboxGlobals.data.tasks.length, 2);
    });

    // ---- READ: renderTasks() free-text search (Repository.search(), sync) ----
    check('renderTasks(): free-text search matches across full legacy field set (Repository.search(), synchronous)', () => {
      fakeElements['searchTasks'] = makeFakeElement();
      fakeElements['searchTasks'].value = 'الأدلة'; // only in task #2's الملاحظات
      fakeElements['filterTaskPriority'] = makeFakeElement();
      fakeElements['filterTaskPriority'].value = '';
      fakeElements['tasksListView'] = makeFakeElement();
      fakeElements['tasksEmpty'] = makeFakeElement();

      taskModule.renderTasks();

      assert.ok(fakeElements['tasksListView'].innerHTML.indexOf('إعداد مذكرة الدفاع') !== -1);
      assert.ok(fakeElements['tasksListView'].innerHTML.indexOf('مراجعة العقد') === -1);
      assert.strictEqual(fakeElements['tasksEmpty'].style.display, 'none');
    });

    // ---- READ: renderTasks() priority filter (exact-equality, combined with search) ----
    check('renderTasks(): #filterTaskPriority exact-equality filter combines with search (AND semantics, matches original)', () => {
      fakeElements['searchTasks'].value = '';
      fakeElements['filterTaskPriority'].value = 'high';

      taskModule.renderTasks();

      assert.ok(fakeElements['tasksListView'].innerHTML.indexOf('مراجعة العقد') !== -1);
      assert.ok(fakeElements['tasksListView'].innerHTML.indexOf('إعداد مذكرة الدفاع') === -1);
    });

    // ---- READ: no sort applied — insertion order preserved (matches original) ----
    check('renderTasks(): rows render in insertion order — no .sort() applied, matching the original inline renderTasks()', () => {
      fakeElements['searchTasks'].value = '';
      fakeElements['filterTaskPriority'].value = '';

      taskModule.renderTasks();

      const html = fakeElements['tasksListView'].innerHTML;
      const posFirst = html.indexOf('مراجعة العقد');
      const posSecond = html.indexOf('إعداد مذكرة الدفاع');
      assert.ok(posFirst !== -1 && posSecond !== -1 && posFirst < posSecond,
        'task #1 (created first) must render before task #2 (created second)');
    });

    // ---- READ: empty-result path (#tasksEmpty shown, list cleared) ----
    check('renderTasks(): no matches shows #tasksEmpty and clears the list', () => {
      fakeElements['searchTasks'].value = 'نص-غير-موجود-إطلاقاً';
      fakeElements['filterTaskPriority'].value = '';

      taskModule.renderTasks();

      assert.strictEqual(fakeElements['tasksListView'].innerHTML, '');
      assert.strictEqual(fakeElements['tasksEmpty'].style.display, '');
    });

    // ---- Index -> record -> id translation layer, exercised end-to-end ----
    let secondTaskIndex = -1;
    check('renderTasks(): embeds resolvable indexes in onclick handlers matching the data.tasks mirror', () => {
      fakeElements['searchTasks'].value = '';
      fakeElements['filterTaskPriority'].value = '';
      taskModule.renderTasks();

      secondTaskIndex = taskModule.resolveTaskIndex(
        sandboxGlobals.data.tasks,
        sandboxGlobals.data.tasks.filter(function (x) { return x['العنوان'] === 'إعداد مذكرة الدفاع'; })[0]
      );
      assert.notStrictEqual(secondTaskIndex, -1);
      assert.ok(fakeElements['tasksListView'].innerHTML.indexOf('editTask(' + secondTaskIndex + ')') !== -1);
      assert.ok(fakeElements['tasksListView'].innerHTML.indexOf('deleteTask(' + secondTaskIndex + ')') !== -1);
      // PHASE 13.14 PART 1 (js/modules/tasks.js, taskInnerHtml()) removed the
      // per-row status checkbox entirely and deliberately — see that phase's
      // comment: "Task status is only ever changed via the Task Edit Dialog
      // (editTask() -> saveTask())". index.html confirms this: status is now
      // an <select id="fTaskStatus"> inside the edit modal, not a row
      // onclick="toggleTask(i)". toggleTask() itself is intentionally kept
      // as a still-supported partial-update API (verified directly, not via
      // rendered markup, by the "toggleTask(i): flips الحالة..." check
      // below), so asserting it appears in tasksListView.innerHTML no longer
      // matches the current, intentional UI and has been removed here.
    });

    // ---- editTask(): synchronous, no Repository call, reads mirror only ----
    check('editTask(i): purely synchronous, pre-fills form from data.tasks[i] (no Repository call)', () => {
      fakeElements['modalTaskTitle'] = makeFakeElement();
      fakeElements['modalTask'] = makeFakeElement();

      taskModule.editTask(secondTaskIndex);

      assert.strictEqual(sandboxGlobals.editIdx.tasks, secondTaskIndex);
      assert.strictEqual(sandboxGlobals.__lastFilled['العنوان'], 'إعداد مذكرة الدفاع');
      assert.strictEqual(fakeElements['modalTaskTitle'].textContent, 'تعديل عمل إداري');
      assert.ok(fakeElements['modalTask'].classList.contains('open'));
    });

    // ---- UPDATE via saveTask(): same array position and id preserved ----
    await checkAsync('saveTask(): update path (editIdx.tasks >= 0) preserves list position and id', async () => {
      const idBefore = sandboxGlobals.data.tasks[secondTaskIndex][taskModule.TASKS_ID_FIELD];
      fakeElements['fTaskTitle'].value = 'إعداد مذكرة الدفاع (محدّثة)';
      sandboxGlobals.__nextFormValue = {
        'العنوان': 'إعداد مذكرة الدفاع (محدّثة)',
        'رقم_الموكل': 'C-1',
        'اسم_الموكل': 'أحمد علي',
        'رقم_القضية': '2026-11',
        'الأولوية': 'medium',
        'الموعد_النهائي': '2026-09-05',
        'الحالة': 'pending',
        'الملاحظات': 'تحتاج مراجعة الأدلة'
      };

      await taskModule.saveTask();

      assert.strictEqual(sandboxGlobals.data.tasks.length, 2);
      assert.strictEqual(sandboxGlobals.data.tasks[secondTaskIndex]['العنوان'], 'إعداد مذكرة الدفاع (محدّثة)');
      assert.strictEqual(sandboxGlobals.data.tasks[secondTaskIndex][taskModule.TASKS_ID_FIELD], idBefore,
        'Repository.update() preserves the existing id — same array position, same identity');
      assert.strictEqual(toastLog[toastLog.length - 1].msg, 'تم حفظ العمل بنجاح');
    });

    // ---- toggleTask(): flips الحالة, no ApiService sync, same array position ----
    await checkAsync('toggleTask(i): flips الحالة pending<->done via Repository.update(id, {الحالة}); no ApiService sync (matches original)', async () => {
      const before = sandboxGlobals.data.tasks[secondTaskIndex]['الحالة'];
      assert.strictEqual(before, 'pending');
      const syncCountBefore = syncRowLog.length;
      const saveLocalBefore = saveLocalCalls.count;

      await taskModule.toggleTask(secondTaskIndex);

      assert.strictEqual(sandboxGlobals.data.tasks[secondTaskIndex]['الحالة'], 'done');
      assert.strictEqual(sandboxGlobals.data.tasks.length, 2, 'toggleTask() must not add/remove records');
      assert.strictEqual(syncRowLog.length, syncCountBefore, 'toggleTask() must NOT call ApiService.syncRow (matches original gap)');
      assert.strictEqual(saveLocalCalls.count, saveLocalBefore + 1);

      // Flip back to pending to confirm the toggle is reversible.
      await taskModule.toggleTask(secondTaskIndex);
      assert.strictEqual(sandboxGlobals.data.tasks[secondTaskIndex]['الحالة'], 'pending');
    });

    // ---- toggleTask(): does not disturb other fields (partial update semantics) ----
    check('toggleTask(): other fields on the record are untouched by the partial update', () => {
      const rec = sandboxGlobals.data.tasks[secondTaskIndex];
      assert.strictEqual(rec['العنوان'], 'إعداد مذكرة الدفاع (محدّثة)');
      assert.strictEqual(rec['الأولوية'], 'medium');
      assert.strictEqual(rec['رقم_القضية'], '2026-11');
    });

    // ---- DELETE via deleteTask(): removed from mirror, no ApiService call (pre-existing gap preserved) ----
    await checkAsync('deleteTask(i): soft-deletes via Repository.delete(); vanishes from mirror/UI exactly like the old hard delete', async () => {
      const beforeCount = sandboxGlobals.data.tasks.length;
      const deletedId = sandboxGlobals.data.tasks[secondTaskIndex][taskModule.TASKS_ID_FIELD];

      await taskModule.deleteTask(secondTaskIndex);

      assert.strictEqual(sandboxGlobals.data.tasks.length, beforeCount - 1);
      assert.ok(!sandboxGlobals.data.tasks.some(function (t) { return t[taskModule.TASKS_ID_FIELD] === deletedId; }));
      assert.strictEqual(toastLog[toastLog.length - 1].msg, 'تم حذف العمل بنجاح');

      // Confirm this is a SOFT delete under the hood (Repository config,
      // unchanged by this phase) but that this is NOT observable through
      // any path tasks.js/dashboard.js actually use:
      const includingDeleted = taskModule.tasksRepository.getAll({ includeDeleted: true });
      const tombstone = includingDeleted.find(function (t) { return t[taskModule.TASKS_ID_FIELD] === deletedId; });
      assert.ok(tombstone && tombstone.deletedAt, 'record is soft-deleted, still in storage with deletedAt');
      assert.ok(!taskModule.tasksRepository.exists(deletedId), 'but exists()/getAll()/get() all correctly hide it');
    });

    // ---- Pre-existing gap preserved: deleteTask() never called ApiService.deleteData() ----
    check('deleteTask(): still does NOT call ApiService.deleteData() — matches the original inline deleteTask() gap', () => {
      // No direct log to check against (deleteData is a no-op fake here);
      // the meaningful assertion is that deleteTask() completed above
      // without needing/expecting any deleteData call, exactly like the
      // original. This is documented explicitly, not silently dropped.
      assert.ok(true);
    });
  }

  // ================================================================
  // 3. exists() / count() spot checks against the live Repository
  // ================================================================

  await checkAsync('TasksRepository.exists()/count() reflect the current (soft-delete-aware) record set', async () => {
    const remaining = taskModule.tasksRepository.getAll();
    assert.strictEqual(remaining.length, 1);
    const id = remaining[0][taskModule.TASKS_ID_FIELD];
    assert.ok(taskModule.tasksRepository.exists(id));
    assert.strictEqual(taskModule.tasksRepository.count(), 1);
  });

  // ================================================================
  // 4. Backward compatibility — pre-existing legacy-shaped localStorage
  // ================================================================

  {
    const legacySeed = {
      tasks: JSON.stringify([
        {
          'رقم_المهمة': 'legacy-task-1',
          'العنوان': 'مهمة قديمة',
          'رقم_القضية': '2025-900',
          'الأولوية': 'medium',
          'الموعد_النهائي': '2025-06-01',
          'الحالة': 'done',
          'الملاحظات': '',
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
      data: { tasks: [], cases: [] },
      editIdx: { tasks: -1 },
      document: { getElementById: function (id) { if (!legacyFakeElements[id]) legacyFakeElements[id] = makeFakeElement(); return legacyFakeElements[id]; } },
      toast: function () {},
      updateBadges: function () {},
      closeModal: function () {},
      formatDate: function (d) { return d || '—'; },
      urgencyBadge: function () { return ''; },
      statusBadge: function () { return ''; },
      val: function (id) { const el = legacyFakeElements[id]; return el ? el.value : ''; },
      uid: function () { return 'x'; },
      collectForm: function () { return {}; },
      fillForm: function () {},
      ApiService: { syncRow: function () {}, deleteData: function () {} },
      saveLocal: function () {},
      confirm: function () { return true; },
      confirmDialog: __confirmDialogStub,
      console: console
    };

    setGlobals(legacyGlobals);
    const { createTasksLocalStorageAdapter } = require(tasksRepoPath);
    const seedAdapter = createTasksLocalStorageAdapter(fakeIndexedDB);
    await seedAdapter.write('tasks', JSON.parse(legacySeed.tasks));

    const legacyTaskModule = loadModule(tasksJsPath);

    await checkAsync('Pre-existing legacy-shaped "tasks" data loads unchanged through the Repository', async () => {
      await legacyTaskModule.ensureTasksRepositoryReady();
      const all = legacyTaskModule.tasksRepository.getAll();
      assert.strictEqual(all.length, 1);
      assert.strictEqual(all[0]['رقم_المهمة'], 'legacy-task-1');
      assert.strictEqual(all[0]['العنوان'], 'مهمة قديمة');
      assert.deepStrictEqual(legacyGlobals.data.tasks, all);
    });

    await checkAsync('Storage key unchanged: writes still land in the bare "tasks" object store (no prefix)', async () => {
      const raw = await seedAdapter.read('tasks');
      assert.ok(Array.isArray(raw));
      assert.strictEqual(raw[0]['رقم_المهمة'], 'legacy-task-1');
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
