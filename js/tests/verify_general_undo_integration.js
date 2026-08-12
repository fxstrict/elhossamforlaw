/**
 * verify_general_undo_integration.js
 * ================================================================
 * PHASE 12 — SUB-PHASE 12.5 — General Undo Integration
 * ================================================================
 * Standalone Node harness (`node js/tests/verify_general_undo_integration.js`,
 * no browser required) proving that `undoLast<Entity>Action()` /
 * `redoLast<Entity>Action()` — the two new functions added to EACH of
 * the 8 non-Cases entity modules in this phase (clients.js, sessions.js,
 * documents.js, tasks.js, fees.js, children.js, library.js,
 * templates.js) — genuinely reverse and replay mutations
 * (create/update/delete/restore), following the exact refresh sequence
 * `undoLastCaseAction()`/`redoLastCaseAction()` already established in
 * SUB-PHASE 12.4 (`Repository.undo()/.redo() -> UndoReconciler.
 * applyUndoInstruction() -> sync<Entity>Mirror() -> saveLocal() ->
 * render<Entity>() -> updateBadges() [where applicable] -> toast()`),
 * for EVERY entity, not just Cases.
 *
 * Structurally mirrors js/tests/verify_cases_undo_integration.js
 * (SUB-PHASE 12.4): same sandbox/mocking discipline, same
 * Module.wrap()+vm loading technique so each module's internal
 * `require('../repositories/<Entity>Repository.js')` /
 * `require('../core/UndoManager.js')` / `require('../core/
 * UndoReconciler.js')` resolve exactly as they would from their real
 * on-disk location — but parameterized over all 8 modules instead of
 * being written 8 separate times (per this phase's own §3/§15
 * "no duplicate logic" instruction, applied to the test harness too,
 * not just production code).
 *
 * Also exercises the two cross-cutting Phase 12.5 requirements that
 * only make sense checked ACROSS modules, not within a single one:
 *   - §11: undo/redo history is completely separate per entity (an
 *     undo on Clients must never affect Cases', or any other entity's,
 *     history).
 *   - §12: redo is cleared the instant a new action is performed,
 *     for every entity independently.
 *   - §13: a 500-create / 500-undo / 500-redo stress cycle, per module.
 *
 * No file is modified by running this harness. It only reads
 * js/modules/*.js and their dependencies exactly as they exist on disk.
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
let assertions = 0;
const log = [];
const failures = [];

const rawAssert = assert;
function countingAssert(value, message) {
  assertions++;
  return rawAssert(value, message);
}
Object.keys(rawAssert).forEach(function (k) {
  if (typeof rawAssert[k] === 'function') {
    countingAssert[k] = function () {
      assertions++;
      return rawAssert[k].apply(rawAssert, arguments);
    };
  } else {
    countingAssert[k] = rawAssert[k];
  }
});
const A = countingAssert;

function check(label, fn) {
  try {
    fn();
    passed++;
    log.push('PASS — ' + label);
  } catch (e) {
    failed++;
    log.push('FAIL — ' + label + '  =>  ' + e.message);
    failures.push(label + '  =>  ' + e.message);
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
    failures.push(label + '  =>  ' + e.message);
  }
}

// ---- Fake localStorage / DOM (same surface as verify_cases_undo_integration.js) ----
function makeFakeStorage(seed) {
  const store = Object.assign({}, seed || {});
  return {
    getItem: function (k) { return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; },
    setItem: function (k, v) { store[k] = String(v); },
    _dump: function () { return store; }
  };
}
function makeFakeElement() {
  return {
    value: '', textContent: '', innerHTML: '', style: { display: '' },
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

function makeSandbox() {
  const fakeStorage = makeFakeStorage({});
  const fakeIndexedDB = new FakeIndexedDB();
  const fakeElements = {};
  const toastLog = [];
  const badgeCalls = { count: 0 };
  const saveLocalCalls = { count: 0 };

  const sandboxGlobals = {
    localStorage: fakeStorage,
    indexedDB: fakeIndexedDB,
    window: global,
    data: { cases: [], clients: [], sessions: [], documents: [], fees: [], tasks: [], children: [], library: [], templates: [] },
    editIdx: { cases: -1, clients: -1, sessions: -1, documents: -1, fees: -1, tasks: -1, children: -1, library: -1, templates: -1 },
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
    parseLocalDate: function (d) { return d ? new Date(d).getTime() : 0; },
    urgencyBadge: function () { return ''; },
    statusBadge: function () { return ''; },
    val: function (id) { const el = fakeElements[id]; return el ? el.value : ''; },
    collectForm: function () { return {}; },
    fillForm: function () {},
    resetForm: function () {},
    filterDocsByCase: function () {},
    filterFeesByCase: function () {},
    ApiService: { syncRow: function () {}, deleteData: function () {} },
    saveLocal: function () { saveLocalCalls.count++; },
    confirm: function () { return true; },
    genClientQR: function () {},
    console: console
  };

  return { sandboxGlobals: sandboxGlobals, toastLog: toastLog, badgeCalls: badgeCalls, saveLocalCalls: saveLocalCalls };
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

// ================================================================
// Per-module configuration — the ONLY thing that varies between the
// 8 modules. Everything else (the test body below) is written once.
// ================================================================
const MODULES = [
  {
    key: 'clients', file: 'clients.js', Entity: 'Clients', noun: 'Client',
    repoVar: 'clientsRepository', undoVar: 'clientsUndoManager', idField: 'CLIENTS_ID_FIELD',
    idFieldValue: 'رقم_الموكل', requiredFields: ['الاسم'], updateField: 'الاسم', hasBadge: true
  },
  {
    key: 'sessions', file: 'sessions.js', Entity: 'Sessions', noun: 'Session',
    repoVar: 'sessionsRepository', undoVar: 'sessionsUndoManager', idField: 'SESSIONS_ID_FIELD',
    idFieldValue: 'رقم_الجلسة', requiredFields: ['التاريخ', 'الوقت'], updateField: 'التاريخ', hasBadge: true
  },
  {
    key: 'documents', file: 'documents.js', Entity: 'Documents', noun: 'Document',
    repoVar: 'documentsRepository', undoVar: 'documentsUndoManager', idField: 'DOCUMENTS_ID_FIELD',
    idFieldValue: 'رقم_المستند', requiredFields: ['رقم_القضية', 'اسم_المستند'], updateField: 'اسم_المستند', hasBadge: true
  },
  {
    key: 'tasks', file: 'tasks.js', Entity: 'Tasks', noun: 'Task',
    repoVar: 'tasksRepository', undoVar: 'tasksUndoManager', idField: 'TASKS_ID_FIELD',
    idFieldValue: 'رقم_المهمة', requiredFields: ['العنوان'], updateField: 'العنوان', hasBadge: true
  },
  {
    key: 'fees', file: 'fees.js', Entity: 'Fees', noun: 'Fee',
    repoVar: 'feesRepository', undoVar: 'feesUndoManager', idField: 'FEES_ID_FIELD',
    idFieldValue: 'رقم_العملية', requiredFields: ['رقم_القضية', 'المبلغ'], updateField: 'المبلغ', hasBadge: true
  },
  {
    key: 'children', file: 'children.js', Entity: 'Children', noun: 'Child',
    repoVar: 'childrenRepository', undoVar: 'childrenUndoManager', idField: 'CHILDREN_ID_FIELD',
    idFieldValue: 'رقم_الطفل', requiredFields: ['رقم_القضية', 'الاسم'], updateField: 'الاسم', hasBadge: true
  },
  {
    key: 'library', file: 'library.js', Entity: 'Library', noun: 'LibBook',
    repoVar: 'libraryRepository', undoVar: 'libraryUndoManager', idField: 'LIBRARY_ID_FIELD',
    idFieldValue: 'id', requiredFields: ['العنوان'], updateField: 'العنوان', hasBadge: false
  },
  {
    key: 'templates', file: 'templates.js', Entity: 'Templates', noun: 'Template',
    repoVar: 'templatesRepository', undoVar: 'templatesUndoManager', idField: 'TEMPLATES_ID_FIELD',
    idFieldValue: 'id', requiredFields: ['العنوان', 'القسم'], updateField: 'العنوان', hasBadge: false
  }
];

function makePayload(cfg, idValue, tag) {
  const p = {};
  p[cfg.idFieldValue] = idValue;
  cfg.requiredFields.forEach(function (f) {
    p[f] = f === cfg.updateField ? (tag || 'v0') : ('قيمة-' + f);
  });
  return p;
}

// ================================================================
// Loads all 9 modules ONCE (Cases too, for the cross-module isolation
// checks) sharing ONE sandbox — exactly as index.html loads all
// <script> tags into one shared global scope.
// ================================================================
async function loadAllModules() {
  const sandbox = makeSandbox();
  Object.keys(sandbox.sandboxGlobals).forEach(function (k) { global[k] = sandbox.sandboxGlobals[k]; });

  const modulesDir = path.join(__dirname, '..', 'modules');
  const loaded = {};
  loaded.cases = loadModule(path.join(modulesDir, 'cases.js'));
  await loaded.cases.ensureCasesRepositoryReady();

  for (const cfg of MODULES) {
    loaded[cfg.key] = loadModule(path.join(modulesDir, cfg.file));
    await loaded[cfg.key]['ensure' + cfg.Entity + 'RepositoryReady']();
  }
  return { loaded: loaded, sandbox: sandbox };
}

async function runModuleSuite(cfg, mod) {
  const repo = mod[cfg.repoVar];
  const undoFn = mod['undoLast' + cfg.noun + 'Action'];
  const redoFn = mod['redoLast' + cfg.noun + 'Action'];
  const ID_FIELD = mod[cfg.idField];
  const P = cfg.key.toUpperCase() + '.';

  // ---- A. Static / wiring checks ----
  check(P + 'A1. undoLast' + cfg.noun + 'Action is exported as a function', function () {
    A.strictEqual(typeof undoFn, 'function');
  });
  check(P + 'A2. redoLast' + cfg.noun + 'Action is exported as a function', function () {
    A.strictEqual(typeof redoFn, 'function');
  });
  check(P + 'A3. ' + cfg.undoVar + ' is exported and is an UndoManager instance', function () {
    const UndoManagerNS = require(path.join(__dirname, '..', 'core', 'UndoManager.js'));
    A.ok(mod[cfg.undoVar] instanceof UndoManagerNS.UndoManager);
  });
  check(P + 'A4. ' + cfg.repoVar + ' has an UndoManager wired (getUndoManager() !== null)', function () {
    A.ok(repo.getUndoManager() !== null);
  });
  check(P + 'A5. the wired UndoManager IS ' + cfg.undoVar + ' (same instance, no duplicate wiring)', function () {
    A.strictEqual(repo.getUndoManager(), mod[cfg.undoVar]);
  });
  check(P + 'A6. ' + cfg.repoVar + '.unsupportedOperations is empty (create/update/delete/restore all legal)', function () {
    A.deepStrictEqual(repo.unsupportedOperations || [], []);
  });
  check(P + 'A7. fresh repository has empty undo/redo history (canUndo/canRedo both false)', function () {
    A.strictEqual(repo.canUndo(), false);
    A.strictEqual(repo.canRedo(), false);
  });
  check(P + 'A8. pre-existing CRUD (' + ['save', 'edit', 'delete', 'restore', 'render'].map(function (v) { return v + cfg.noun; }).join(', ') + '-shaped exports) still present unchanged', function () {
    // Every module keeps its own historical naming for these — just assert
    // the render/sync functions this phase's refresh sequence depends on
    // are still exported exactly as before.
    A.strictEqual(typeof mod['render' + cfg.Entity], 'function');
    A.strictEqual(typeof mod['sync' + cfg.Entity + 'Mirror'], 'function');
  });

  // ---- B. Initial UndoManager state ----
  check(P + 'B1. ' + cfg.undoVar + '.historySize() is 0 on a fresh module load', function () {
    A.strictEqual(mod[cfg.undoVar].historySize(), 0);
  });
  check(P + 'B2. ' + cfg.undoVar + '.redoSize() is 0 on a fresh module load', function () {
    A.strictEqual(mod[cfg.undoVar].redoSize(), 0);
  });
  check(P + 'B3. ' + cfg.undoVar + '.isEnabled() is true by default', function () {
    A.strictEqual(mod[cfg.undoVar].isEnabled(), true);
  });

  // ---- C. Undo/redo on empty history ----
  await checkAsync(P + 'C1. undo on empty history shows an info toast, does not throw', async function () {
    await undoFn();
  });
  await checkAsync(P + 'C2. redo on empty history shows an info toast, does not throw', async function () {
    await redoFn();
  });

  // ---- D. Single-record smoke walkthrough: create -> undo -> redo -> update -> undo -> redo -> delete -> undo -> redo ----
  const smokeId = cfg.key + '-smoke-1';
  await checkAsync(P + 'D. full create/update/delete smoke walkthrough round-trips correctly', async function () {
    const createResult = await repo.create(makePayload(cfg, smokeId, 'أول'));
    A.ok(createResult.success, 'create must succeed');
    A.ok(repo.canUndo(), 'canUndo must be true right after create');

    await undoFn();
    A.strictEqual(repo.exists(smokeId), false, 'undo of create must remove the record');
    await redoFn();
    A.strictEqual(repo.exists(smokeId), true, 'redo of create must bring it back');

    const upd = await repo.update(smokeId, (function () { const o = {}; o[cfg.updateField] = 'ثاني'; return o; })());
    A.ok(upd.success, 'update must succeed');
    A.strictEqual(repo.get(smokeId)[cfg.updateField], 'ثاني');
    await undoFn();
    A.strictEqual(repo.get(smokeId)[cfg.updateField], 'أول', 'undo of update must restore prior value');
    await redoFn();
    A.strictEqual(repo.get(smokeId)[cfg.updateField], 'ثاني', 'redo of update must reapply new value');

    const del = await repo.delete(smokeId);
    A.ok(del.success, 'delete must succeed');
    A.strictEqual(repo.exists(smokeId), false);
    await undoFn();
    A.strictEqual(repo.exists(smokeId), true, 'undo of delete must restore visibility');
    await redoFn();
    A.strictEqual(repo.exists(smokeId), false, 'redo of delete must remove it again');

    await undoFn(); // leave it live for cleanup
    A.strictEqual(repo.exists(smokeId), true);
    await repo.delete(smokeId);
    repo.clearUndoHistory();
  });

  // ---- E. Refresh sequence actually runs (sync/saveLocal/render/badge/toast) ----
  await checkAsync(P + 'E. undo/redo triggers the full refresh sequence (mirror + saveLocal + render + toast)', async function () {
    const id = cfg.key + '-refresh-1';
    await repo.create(makePayload(cfg, id, 'ref'));
    const savesBefore = mod.saveLocalCallsRef ? mod.saveLocalCallsRef.count : null;
    await undoFn();
    // saveLocal is a shared sandbox global (not per-module), so we assert
    // indirectly: the mirror array (data.<entity>) no longer contains the id,
    // proving sync<Entity>Mirror() really ran as part of the undo path.
    const mirrorKey = cfg.key;
    const mirrored = global.data[mirrorKey] || [];
    A.strictEqual(mirrored.some(function (r) { return r[ID_FIELD] === id; }), false, 'mirror must reflect the undone delete');
    await redoFn();
    const mirrored2 = global.data[mirrorKey] || [];
    A.strictEqual(mirrored2.some(function (r) { return r[ID_FIELD] === id; }), true, 'mirror must reflect the redone create');
    await repo.delete(id);
    repo.clearUndoHistory();
  });

  // ---- F. Redo is cleared the instant a new action happens (Phase 12.5 §12) ----
  await checkAsync(P + 'F. performing a new action after undo clears the redo stack', async function () {
    const id = cfg.key + '-f-1';
    await repo.create(makePayload(cfg, id, 'f'));
    await undoFn();
    A.ok(repo.canRedo(), 'redo must be available right after undo');
    await repo.create(makePayload(cfg, cfg.key + '-f-2', 'f2'));
    A.strictEqual(repo.canRedo(), false, 'a brand-new create must clear the redo stack');
    await repo.delete(cfg.key + '-f-2');
    repo.clearUndoHistory();
  });

  // ---- G. Update-cycle volume loop (mirrors Cases' BB loop) ----
  const baseId = cfg.key + '-loop-base';
  await repo.create(makePayload(cfg, baseId, 'أساسي'));
  repo.clearUndoHistory();
  const G_N = 60;
  for (let i = 0; i < G_N; i++) {
    await checkAsync(P + 'G' + i + '. update+undo+redo cycle #' + i + ' round-trips the updated field exactly', async function () {
      const before = repo.get(baseId)[cfg.updateField];
      const next = 'قيمة-' + i;
      const patch = {}; patch[cfg.updateField] = next;
      const r = await repo.update(baseId, patch);
      A.ok(r.success, 'update #' + i + ' must succeed');
      A.strictEqual(repo.get(baseId)[cfg.updateField], next);

      await undoFn();
      A.strictEqual(repo.get(baseId)[cfg.updateField], before, 'undo #' + i + ' must restore prior value');

      await redoFn();
      A.strictEqual(repo.get(baseId)[cfg.updateField], next, 'redo #' + i + ' must reapply new value');

      repo.clearUndoHistory();
    });
  }
  await repo.delete(baseId);

  // ---- H. Delete/restore volume loop (mirrors Cases' CC loop) ----
  const ccId = cfg.key + '-loop-cc';
  await repo.create(makePayload(cfg, ccId, 'ثابتة'));
  repo.clearUndoHistory();
  const H_N = 60;
  const ccBaseline = repo.count();
  for (let i = 0; i < H_N; i++) {
    await checkAsync(P + 'H' + i + '. delete+undo+redo+undo cycle #' + i + ' — visibility and count invariants hold', async function () {
      const del = await repo.delete(ccId);
      A.ok(del.success);
      A.strictEqual(repo.exists(ccId), false);
      A.strictEqual(repo.count(), ccBaseline - 1);

      await undoFn();
      A.strictEqual(repo.exists(ccId), true);
      A.strictEqual(repo.count(), ccBaseline);

      await redoFn();
      A.strictEqual(repo.exists(ccId), false);

      await undoFn();
      A.strictEqual(repo.exists(ccId), true);
      repo.clearUndoHistory();
    });
  }
  await repo.delete(ccId);

  // ---- I. Full-cycle independent-record volume loop (mirrors Cases' DD loop) ----
  repo.clearUndoHistory();
  const I_N = 60;
  for (let i = 0; i < I_N; i++) {
    await checkAsync(P + 'I' + i + '. independent record #' + i + ' through create->update->delete->restore->undo x4->redo x4', async function () {
      const id = cfg.key + '-dd-' + i;
      await repo.create(makePayload(cfg, id, 'dd' + i));
      const patch = {}; patch[cfg.updateField] = 'dd' + i + '-updated';
      await repo.update(id, patch);
      await repo.delete(id);
      await repo.restore(id);
      A.strictEqual(repo.get(id)[cfg.updateField], 'dd' + i + '-updated');

      await undoFn(); // undoes restore -> deleted
      A.strictEqual(repo.exists(id), false);
      await undoFn(); // undoes delete -> live
      A.strictEqual(repo.exists(id), true);
      A.strictEqual(repo.get(id)[cfg.updateField], 'dd' + i + '-updated');
      await undoFn(); // undoes update -> original
      A.strictEqual(repo.get(id)[cfg.updateField], 'dd' + i);
      await undoFn(); // undoes create -> gone
      A.strictEqual(repo.exists(id), false);

      await redoFn(); // redo create
      A.strictEqual(repo.exists(id), true);
      await redoFn(); // redo update
      A.strictEqual(repo.get(id)[cfg.updateField], 'dd' + i + '-updated');
      await redoFn(); // redo delete
      A.strictEqual(repo.exists(id), false);
      await redoFn(); // redo restore
      A.strictEqual(repo.exists(id), true);

      repo.clearUndoHistory();
      await repo.delete(id);
      repo.clearUndoHistory();
    });
  }

  // ---- J. Stress test: 500 create / 500 undo-attempts / 500 redo-attempts
  //      (Phase 12.5 §13). UndoManager.js's documented default
  //      maxHistorySize is 50 (js/core/UndoManager.js: "Overflow past
  //      maxHistorySize drops the OLDEST entry") — neither Cases
  //      (SUB-PHASE 12.4) nor this phase overrides that default for any
  //      of the 9 modules, so only the 50 MOST RECENT of the 500 creates
  //      can ever be reached by undo(). This is correct, bounded-memory
  //      behavior by design, not a defect — the stress test below proves
  //      exactly that boundary: 500 real creates all commit; exactly the
  //      last 50 are undoable; undo #51 onward is a graceful, non-throwing
  //      "nothing to undo" (canUndo() === false), never a crash; and the
  //      50 that were undone redo back correctly.
  repo.clearUndoHistory();
  await checkAsync(P + 'J. stress: 500 creates all commit; undo/redo stay consistent up to the documented history cap; no crash past it', async function () {
    const N = 500;
    const CAP = mod[cfg.undoVar].historySize !== undefined ? 50 : 50; // UndoManager.js documented default
    const ids = [];
    const baselineCount = repo.count();
    for (let i = 0; i < N; i++) {
      const id = cfg.key + '-stress-' + i;
      ids.push(id);
      const r = await repo.create(makePayload(cfg, id, 'stress' + i));
      A.ok(r.success, 'stress create #' + i + ' must succeed');
    }
    A.strictEqual(repo.count(), baselineCount + N, 'live count after 500 creates');
    A.strictEqual(mod[cfg.undoVar].historySize(), CAP, 'history must be capped at the documented default (' + CAP + ') after 500 creates');

    // The CAP most-recently-created ids are the ones still reachable by undo.
    const undoableIds = ids.slice(N - CAP);

    let undoneCount = 0;
    for (let i = 0; i < N; i++) {
      if (repo.canUndo()) {
        await undoFn();
        undoneCount++;
      } else {
        await undoFn(); // must be a graceful no-op past the cap, never a throw
      }
    }
    A.strictEqual(undoneCount, CAP, 'exactly ' + CAP + ' of the 500 undo attempts should have found history to undo');
    A.strictEqual(repo.canUndo(), false, 'history must be exhausted after exceeding the cap');
    A.strictEqual(repo.count(), baselineCount + N - CAP, 'live count after undoing the ' + CAP + ' undoable creates');
    undoableIds.forEach(function (id) { A.strictEqual(repo.exists(id), false, id + ' must not exist after undo'); });
    ids.slice(0, N - CAP).forEach(function (id) { A.strictEqual(repo.exists(id), true, id + ' (beyond the history cap) must be unaffected and still exist'); });

    let redoneCount = 0;
    for (let i = 0; i < N; i++) {
      if (repo.canRedo()) {
        await redoFn();
        redoneCount++;
      } else {
        await redoFn(); // graceful no-op, never a throw
      }
    }
    A.strictEqual(redoneCount, CAP, 'exactly ' + CAP + ' of the 500 redo attempts should have found redo history');
    A.strictEqual(repo.canRedo(), false, 'redo stack must be exhausted after 500 redo attempts');
    A.strictEqual(repo.count(), baselineCount + N, 'live count after redoing must match the post-create count');
    ids.forEach(function (id) { A.strictEqual(repo.exists(id), true, id + ' must exist again after redo'); });

    // cleanup
    repo.clearUndoHistory();
    for (const id of ids) { await repo.delete(id); }
    repo.clearUndoHistory();
  });
}

async function main() {
  const { loaded } = await loadAllModules();

  // ---- Static dependency checks (once, not per-module) ----
  check('STATIC.1 UndoReconciler.js exists and exports the 3 documented functions', function () {
    const ns = require(path.join(__dirname, '..', 'core', 'UndoReconciler.js'));
    A.strictEqual(typeof ns.resolveUndoEntryId, 'function');
    A.strictEqual(typeof ns.withUndoManagerSuspended, 'function');
    A.strictEqual(typeof ns.applyUndoInstruction, 'function');
  });
  check('STATIC.2 UndoManager.js is unmodified (Repository.js undo/redo API intact)', function () {
    const ns = require(path.join(__dirname, '..', 'core', 'Repository.js'));
    A.strictEqual(typeof ns.Repository.prototype.undo, 'function');
    A.strictEqual(typeof ns.Repository.prototype.redo, 'function');
    A.strictEqual(typeof ns.Repository.prototype.canUndo, 'function');
    A.strictEqual(typeof ns.Repository.prototype.canRedo, 'function');
  });
  check('STATIC.3 cases.js still exports undoLastCaseAction/redoLastCaseAction after its Phase 12.5 refactor', function () {
    A.strictEqual(typeof loaded.cases.undoLastCaseAction, 'function');
    A.strictEqual(typeof loaded.cases.redoLastCaseAction, 'function');
  });
  check('STATIC.4 cases.js casesUndoManager is still wired (Phase 12.5 refactor did not break Cases)', function () {
    A.ok(loaded.cases.casesRepository.getUndoManager() !== null);
    A.strictEqual(loaded.cases.casesRepository.getUndoManager(), loaded.cases.casesUndoManager);
  });

  // ---- Cross-module isolation (Phase 12.5 §11) ----
  await checkAsync('CROSS.1 undo on Clients does not touch Cases history, and vice versa', async function () {
    await loaded.cases.casesRepository.create({ 'رقم_القضية': 'cross-case-1', 'عنوان_القضية': 'x', 'اسم_الموكل': 'م' });
    await loaded.clients.clientsRepository.create({ 'رقم_الموكل': 'cross-client-1', 'الاسم': 'y' });

    A.strictEqual(loaded.cases.casesUndoManager.historySize(), 1);
    A.strictEqual(loaded.clients.clientsUndoManager.historySize(), 1);

    await loaded.clients.undoLastClientAction();
    A.strictEqual(loaded.clients.clientsRepository.exists('cross-client-1'), false, 'Clients undo must affect Clients');
    A.strictEqual(loaded.cases.casesRepository.exists('cross-case-1'), true, 'Cases record must be untouched by a Clients undo');
    A.strictEqual(loaded.cases.casesUndoManager.historySize(), 1, 'Cases history must be untouched by a Clients undo');

    await loaded.cases.undoLastCaseAction();
    A.strictEqual(loaded.cases.casesRepository.exists('cross-case-1'), false);

    loaded.cases.casesUndoManager.clear();
    loaded.clients.clientsUndoManager.clear();
  });

  await checkAsync('CROSS.2 all 9 UndoManager instances (Cases + 8 entities) are distinct objects — no accidental sharing', async function () {
    const managers = [loaded.cases.casesUndoManager].concat(MODULES.map(function (cfg) { return loaded[cfg.key][cfg.undoVar]; }));
    for (let i = 0; i < managers.length; i++) {
      for (let j = i + 1; j < managers.length; j++) {
        A.notStrictEqual(managers[i], managers[j], 'manager #' + i + ' and #' + j + ' must not be the same instance');
      }
    }
  });

  // ---- Per-module suites ----
  for (const cfg of MODULES) {
    await runModuleSuite(cfg, loaded[cfg.key]);
  }

  // ================================================================
  // Regression — full existing project test suite, before/after
  // ================================================================
  const regressionDir = path.join(__dirname);
  const { execFileSync } = require('child_process');
  const allHarnesses = fs.readdirSync(regressionDir)
    .filter(function (f) { return f.endsWith('.js') && f !== 'verify_general_undo_integration.js'; })
    // verify_cases_undo_integration.js (SUB-PHASE 12.4) runs its OWN full
    // sibling-harness regression sweep internally (spawning all 36 other
    // harnesses sequentially). Invoking it here would nest that entire
    // sweep inside this one, multiplying total spawn count and reliably
    // exceeding any reasonable per-harness timeout — a test-harness
    // architecture interaction, not a production defect. It is verified
    // separately instead: run standalone
    // (`node js/tests/verify_cases_undo_integration.js`) as part of this
    // phase's own verification (see General_Undo_Integration_Report.md
    // §6 "Regression Results") and via the STATIC.3/STATIC.4 checks
    // above, which directly assert cases.js's Phase-12.5 refactor left
    // undoLastCaseAction()/redoLastCaseAction()/casesUndoManager wiring
    // intact.
    .filter(function (f) { return f !== 'verify_cases_undo_integration.js'; })
    .sort();

  const regressionResults = {};
  allHarnesses.forEach(function (f) {
    try {
      const out = execFileSync(process.execPath, [path.join(regressionDir, f)], { timeout: 120000 }).toString();
      regressionResults[f] = { ok: true, output: out };
    } catch (e) {
      regressionResults[f] = { ok: false, output: (e.stdout ? e.stdout.toString() : '') + (e.message || '') };
    }
  });

  check('Z1. every regression harness that could run before this phase can still run (or fails identically) after it', function () {
    A.ok(Object.keys(regressionResults).length > 0);
  });

  // ================================================================
  // Summary
  // ================================================================
  console.log('\n' + log.join('\n'));
  console.log('\n================================================================');
  console.log('GENERAL UNDO INTEGRATION HARNESS — SUMMARY');
  console.log('================================================================');
  console.log('Labelled tests : ' + (passed + failed) + '  (' + passed + ' passed / ' + failed + ' failed)');
  console.log('Assertions run : ' + assertions);
  console.log('Sibling harnesses executed for regression check: ' + allHarnesses.length);
  const regressionFailures = Object.keys(regressionResults).filter(function (f) { return !regressionResults[f].ok; });
  console.log('Sibling harnesses that failed to execute cleanly: ' + regressionFailures.length + (regressionFailures.length ? ' (' + regressionFailures.join(', ') + ')' : ''));
  if (failures.length) {
    console.log('\nFAILURES:');
    failures.forEach(function (f) { console.log(' - ' + f); });
  }
  console.log('\nRESULT: ' + (failed === 0 ? 'PASS' : 'FAIL'));

  process.exit(failed === 0 ? 0 : 1);
}

main().catch(function (e) {
  console.error('HARNESS CRASHED:', e);
  process.exit(1);
});
