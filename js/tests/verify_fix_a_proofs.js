/**
 * verify_fix_a_proofs.js — PHASE 13.14 PART 2 FIX-A
 * One-off proof harness (not part of the permanent suite) exercising the
 * REAL js/modules/tasks.js saveTask()/editTask() against a real
 * TasksRepository + FakeIndexedDB, proving the 5 required proofs.
 * Run: node js/tests/verify_fix_a_proofs.js
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const Module = require('module');
const vm = require('vm');
const { FakeIndexedDB } = require(path.join(__dirname, 'fake_indexeddb.js'));
const { formatTime: __formatTimeStub } = require(path.join(__dirname, '_shared', 'browserStubs.js'));
const { UndoManager } = require(path.join(__dirname, '..', 'core', 'UndoManager.js'));

let passed = 0, failed = 0;
const log = [];
function check(label, fn) {
  try { fn(); passed++; log.push('PASS — ' + label); }
  catch (e) { failed++; log.push('FAIL — ' + label + '  =>  ' + e.message); }
}
async function checkAsync(label, fn) {
  try { await fn(); passed++; log.push('PASS — ' + label); }
  catch (e) { failed++; log.push('FAIL — ' + label + '  =>  ' + e.message); }
}

function makeFakeElement() {
  return {
    value: '', textContent: '', innerHTML: '',
    style: { display: '' },
    classList: {
      _c: {}, add: function (c) { this._c[c] = true; },
      remove: function (c) { delete this._c[c]; },
      contains: function (c) { return !!this._c[c]; }
    }
  };
}

function setGlobals(g) { Object.keys(g).forEach(function (k) { global[k] = g[k]; }); }

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

// Real MAP.tasks / FIELDS.tasks exactly as defined in index.html, so
// collectForm/fillForm behave exactly like production.
const MAP = { tasks: { fTaskTitle: 'العنوان', fTaskCaseNum: 'رقم_القضية', fTaskPriority: 'الأولوية', fTaskDue: 'الموعد_النهائي', fTaskStatus: 'الحالة', fTaskNotes: 'الملاحظات', fTaskCompletionReason: 'سبب_الإنجاز', fTaskReopenReason: 'سبب_إعادة_الفتح' } };

async function main() {
  const tasksJsPath = path.join(__dirname, '..', 'modules', 'tasks.js');
  const fakeStorage = { getItem: function () { return null; }, setItem: function () {} };
  const fakeIndexedDB = new FakeIndexedDB();
  const fakeElements = {};
  const toastLog = [];

  const sandboxGlobals = {
    localStorage: fakeStorage,
    indexedDB: fakeIndexedDB,
    window: global,
    data: { tasks: [], cases: [] },
    editIdx: { tasks: -1 },
    document: {
      getElementById: function (id) {
        if (!fakeElements[id]) fakeElements[id] = makeFakeElement();
        return fakeElements[id];
      }
    },
    toast: function (msg, type) { toastLog.push({ msg: msg, type: type }); },
    updateBadges: function () {},
    closeModal: function () {},
    formatDate: function (d) { return d || '—'; },
    // PHASE 24 — taskInnerHtml() (js/modules/tasks.js) calls formatTime()
    // (a real js/ui-utils.js export the production app loads), just like
    // it already calls formatDate()/urgencyBadge()/statusBadge() below —
    // this harness stubbed those three but missed formatTime.
    formatTime: __formatTimeStub,
    urgencyBadge: function () { return ''; },
    statusBadge: function () { return ''; },
    val: function (id) { const el = fakeElements[id]; return el ? el.value : ''; },
    uid: function () { return 'uid-' + Math.random().toString(36).slice(2, 8); },
    MAP: MAP,
    FIELDS: { tasks: Object.keys(MAP.tasks) },
    // Real collectForm/fillForm logic (byte-identical to js/print-utils.js)
    collectForm: function (type) {
      const m = MAP[type] || {};
      const obj = {};
      Object.keys(m).forEach(function (fid) {
        const el = fakeElements[fid];
        obj[m[fid]] = el ? el.value : '';
      });
      return obj;
    },
    fillForm: function (type, obj) {
      const m = MAP[type] || {};
      Object.keys(m).forEach(function (fid) {
        if (!fakeElements[fid]) fakeElements[fid] = makeFakeElement();
        if (obj[m[fid]] !== undefined) fakeElements[fid].value = obj[m[fid]];
      });
    },
    ApiService: { syncRow: function () {}, deleteData: function () {} },
    saveLocal: function () {},
    confirm: function () { return true; },
    console: console,
    UndoManager: UndoManager
  };

  setGlobals(sandboxGlobals);
  const taskModule = loadModule(tasksJsPath);
  await taskModule.ensureTasksRepositoryReady();
  // Undo/Redo is opt-in per Repository instance (setUndoManager()) — not
  // wired by tasks.js itself, so wire one here purely to prove Undo/Redo
  // still functions correctly against records this fix writes.
  taskModule.tasksRepository.setUndoManager(new UndoManager(null));

  function setField(id, v) {
    if (!fakeElements[id]) fakeElements[id] = makeFakeElement();
    fakeElements[id].value = v;
  }

  // ================================================================
  // إثبات 1 — pending -> done يحفظ السبب
  // ================================================================
  setField('fTaskTitle', 'مهمة اختبار 1');
  setField('fTaskStatus', 'pending');
  sandboxGlobals.editIdx.tasks = -1;
  await taskModule.saveTask();
  const rec1 = sandboxGlobals.data.tasks[sandboxGlobals.data.tasks.length - 1];

  taskModule.editTask(sandboxGlobals.data.tasks.length - 1);
  setField('fTaskStatus', 'done');
  setField('fTaskCompletionReason', 'تم الانتهاء من الاجراء القانوني');
  await taskModule.saveTask();

  await checkAsync('إثبات 1: pending → done يحفظ سبب الإنجاز', async () => {
    const t = sandboxGlobals.data.tasks.find(function (x) { return x['رقم_المهمة'] === rec1['رقم_المهمة']; });
    assert.strictEqual(t['سبب_الإنجاز'], 'تم الانتهاء من الاجراء القانوني');
    assert.ok(t['تاريخ_الإنجاز']);
  });

  // ================================================================
  // إثبات 2 — إعادة فتح المهمة وتعديل العنوان فقط لا يمس سبب الإنجاز
  // ================================================================
  const idx2 = sandboxGlobals.data.tasks.findIndex(function (x) { return x['رقم_المهمة'] === rec1['رقم_المهمة']; });
  taskModule.editTask(idx2); // fillForm repopulates fTaskCompletionReason from stored value
  setField('fTaskTitle', 'مهمة اختبار 1 — عنوان معدّل');
  // status stays 'done' (unchanged), completion reason textarea left as
  // fillForm loaded it — user did not touch it.
  await taskModule.saveTask();

  await checkAsync('إثبات 2: تعديل العنوان فقط لا يمس سبب الإنجاز', async () => {
    const t = sandboxGlobals.data.tasks.find(function (x) { return x['رقم_المهمة'] === rec1['رقم_المهمة']; });
    assert.strictEqual(t['العنوان'], 'مهمة اختبار 1 — عنوان معدّل');
    assert.strictEqual(t['سبب_الإنجاز'], 'تم الانتهاء من الاجراء القانوني');
  });

  // ================================================================
  // إثبات 3 — تعديل سبب الإنجاز بدون تغيير الحالة يحفظ السبب الجديد
  //           (هذا هو العطل الأصلي المثبت في التحقيق)
  // ================================================================
  const idx3 = sandboxGlobals.data.tasks.findIndex(function (x) { return x['رقم_المهمة'] === rec1['رقم_المهمة']; });
  taskModule.editTask(idx3);
  // status stays 'done' — no transition — this is exactly the branch that
  // used to discard the typed value before FIX-A.
  setField('fTaskCompletionReason', 'سبب معدّل بعد المراجعة القانونية');
  await taskModule.saveTask();

  await checkAsync('إثبات 3: تعديل سبب الإنجاز بدون تغيير الحالة يحفظ القيمة الجديدة', async () => {
    const t = sandboxGlobals.data.tasks.find(function (x) { return x['رقم_المهمة'] === rec1['رقم_المهمة']; });
    assert.strictEqual(t['سبب_الإنجاز'], 'سبب معدّل بعد المراجعة القانونية');
  });

  // ================================================================
  // إثبات 4 — إنشاء مهمة جديدة بحالة "مكتملة" يحفظ السبب أيضاً
  // ================================================================
  sandboxGlobals.editIdx.tasks = -1;
  setField('fTaskTitle', 'مهمة جديدة مكتملة من البداية');
  setField('fTaskStatus', 'done');
  setField('fTaskCompletionReason', 'أُنجزت فور إضافتها');
  await taskModule.saveTask();

  await checkAsync('إثبات 4: مهمة جديدة بحالة مكتملة تحفظ السبب', async () => {
    const t = sandboxGlobals.data.tasks.find(function (x) { return x['العنوان'] === 'مهمة جديدة مكتملة من البداية'; });
    assert.ok(t, 'record not found');
    assert.strictEqual(t['سبب_الإنجاز'], 'أُنجزت فور إضافتها');
  });

  // ================================================================
  // إثبات 5 — Undo / Redo ما زال يعمل (Repository لم يُمس)
  // ================================================================
  await checkAsync('إثبات 5: Undo/Redo لا يزال يعمل بعد الإصلاح', async () => {
    // Repository.undo()/redo() forward to the wired UndoManager and return
    // SNAPSHOT INSTRUCTIONS (or null if nothing to undo) — Repository never
    // auto-applies them to its own records (documented, out-of-scope
    // reconciliation — Repository.js:479-482). This proof therefore checks
    // the actual contract: canUndo()/undo()/canRedo()/redo() all still
    // function against a record this fix wrote, exactly as
    // verify_repository_undo_hooks.js already proves in isolation (294/294
    // passing, unmodified by this fix).
    assert.strictEqual(taskModule.tasksRepository.canUndo(), true, 'canUndo() should be true after إثبات 4\'s create');
    const undoInstruction = taskModule.tasksRepository.undo();
    assert.ok(undoInstruction, 'undo() returned null unexpectedly');
    assert.strictEqual(undoInstruction.action, 'create');
    assert.strictEqual(undoInstruction.after['العنوان'], 'مهمة جديدة مكتملة من البداية');
    assert.strictEqual(undoInstruction.after['سبب_الإنجاز'], 'أُنجزت فور إضافتها');

    assert.strictEqual(taskModule.tasksRepository.canRedo(), true, 'canRedo() should be true right after an undo()');
    const redoInstruction = taskModule.tasksRepository.redo();
    assert.ok(redoInstruction, 'redo() returned null unexpectedly');
    assert.strictEqual(redoInstruction.after['سبب_الإنجاز'], 'أُنجزت فور إضافتها');

    // The record FIX-A wrote earlier (إثبات 1-3) is completely undisturbed
    // by this undo/redo cycle on an unrelated later record.
    const idBefore = rec1['رقم_المهمة'];
    const t = taskModule.tasksRepository.get(idBefore);
    assert.strictEqual(t['سبب_الإنجاز'], 'سبب معدّل بعد المراجعة القانونية');
  });

  console.log(log.join('\n'));
  console.log('\n' + passed + '/' + (passed + failed) + ' proofs passed.');
  process.exit(failed ? 1 : 0);
}

main().catch(function (e) { console.error('HARNESS ERROR:', e); process.exit(1); });
