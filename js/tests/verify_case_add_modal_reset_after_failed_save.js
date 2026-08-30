/**
 * verify_case_add_modal_reset_after_failed_save.js
 * PROBLEM 2 (Case Save Cycle audit, v79) — Regression test.
 *
 * ROOT CAUSE (proved by code trace, not guessed):
 *   Two independent, unrelated code paths govern what happens to the Add
 *   Case modal's fields, and NEITHER of them ever clears the three
 *   embedded-tab fields (جلسة/عمل اداري/محضرين) on a failed save + Cancel:
 *
 *   1) closeModal(id) (index.html) is `classList.remove('open')` only —
 *      zero field-clearing logic of any kind.
 *
 *   2) Reopening "إضافة قضية" calls resetForm('cases') (openAddModal(),
 *      index.html), which — through print-utils.js's base
 *      `(FIELDS[type]||[]).forEach(...)` and cases.js's override — clears
 *      exactly the field IDs listed in FIELDS.cases (index.html). That
 *      array holds the case's OWN 39 fields only; it does not list any of
 *      the 16 embedded-tab field IDs (fCaseSession*, fCaseTask*,
 *      fCasePsw*) nor the hidden #fCaseClients selector.
 *
 *   3) The ONLY place that ever clears those 16 fields is inside each of
 *      sessions.js's _createEmbeddedSessionIfFilled(), tasks.js's
 *      _createEmbeddedAdminWorkIfFilled(), and process-server-works.js's
 *      _createEmbeddedPswIfFilled() — but only on THEIR OWN successful
 *      create() (result.success), and each is only ever invoked when the
 *      CASE itself already saved successfully (every one of their
 *      saveCase() wraps starts with
 *      `if (!saveOutcome || !saveOutcome.success) return saveOutcome;`).
 *      On a ConflictError, none of the three ever run.
 *
 *   Net effect: after a rejected save (رقم القضية مستخدم بالفعل) + Cancel
 *   + reopening "إضافة قضية", fields in FIELDS.cases go blank, but the
 *   جلسة/عمل اداري/محضرين tabs — and #fCaseClients — keep whatever the
 *   user typed into the failed attempt. Exactly the reported symptom.
 *
 * This test loads the REAL js/modules/cases.js (+ sessions.js/tasks.js/
 * process-server-works.js, production <script> order) AND the REAL
 * print-utils.js + the REAL FIELDS.cases array parsed out of index.html
 * — not a hand-typed stand-in — so it fails/passes with the actual
 * production reset behavior, not a simulation of it.
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

function makeFakeElement(tagName) {
  return {
    value: '',
    textContent: '',
    innerHTML: '',
    tagName: tagName || 'INPUT',
    options: [],
    style: { display: '' },
    classList: {
      _classes: {},
      add: function (c) { this._classes[c] = true; },
      remove: function (c) { delete this._classes[c]; },
      contains: function (c) { return !!this._classes[c]; },
      toggle: function (c, force) {
        var on = force !== undefined ? force : !this._classes[c];
        if (on) this._classes[c] = true; else delete this._classes[c];
        return on;
      }
    },
    children: [],
    querySelectorAll: function () { return []; },
    appendChild: function () {}
  };
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

const ROOT = path.join(__dirname, '..', '..');
const modulesDir = path.join(ROOT, 'js', 'modules');

// ---- Extract the REAL FIELDS/MAP object literals out of the REAL
//      index.html (same "don't hand-duplicate production config"
//      discipline as verify_toast_above_modal_stacking.js). Both are
//      needed: FIELDS drives resetForm() (what this test is about), MAP
//      drives the real collectForm()/fillForm() that print-utils.js
//      declares once loaded (see below) — loading print-utils.js for a
//      real resetForm makes its real collectForm live too, so MAP must
//      exist or that throws. ----
function loadRealConfigObject(varName) {
  const indexHtml = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const re = new RegExp('var ' + varName + '=(\\{[\\s\\S]*?\\n\\};)');
  const m = indexHtml.match(re);
  if (!m) throw new Error('Could not locate `var ' + varName + '={...}` in index.html');
  const literal = '(' + m[1].replace(/;\s*$/, '') + ')';
  // eslint-disable-next-line no-eval
  return (0, eval)(literal);
}

async function main() {
  const fakeIndexedDB = new FakeIndexedDB();
  const fakeElements = {};
  const toastLog = [];

  const embeddedFieldIds = [
    // session tab
    'fCaseSessionDate', 'fCaseSessionTime', 'fCaseSessionTitle',
    'fCaseSessionRequired', 'fCaseSessionNotes',
    // admin-work tab
    'fCaseTaskTitle', 'fCaseTaskDeadline', 'fCaseTaskLocation',
    'fCaseTaskRequired', 'fCaseTaskNotes',
    // PSW tab
    'fCasePswNature', 'fCasePswNumber', 'fCasePswCourt', 'fCasePswOffice',
    'fCasePswDeliveryDate', 'fCasePswReceiptDate', 'fCasePswSessionDate',
    'fCasePswNotes'
  ];
  const caseFieldIds = ['fCaseNum', 'fCaseTitle', 'fCaseClient', 'fCaseDocketNum', 'fCaseClients'];

  caseFieldIds.concat(embeddedFieldIds).forEach(function (id) {
    fakeElements[id] = makeFakeElement();
  });

  const REAL_FIELDS = loadRealConfigObject('FIELDS');
  const REAL_MAP = loadRealConfigObject('MAP');

  const sandboxGlobals = {
    indexedDB: fakeIndexedDB,
    data: { cases: [], clients: [], sessions: [], tasks: [], processServerWorks: [] },
    editIdx: { cases: -1 },
    FIELDS: REAL_FIELDS,
    MAP: REAL_MAP,
    document: {
      getElementById: function (id) {
        if (!fakeElements[id]) fakeElements[id] = makeFakeElement();
        return fakeElements[id];
      },
      createElement: function () { return makeFakeElement(); },
      addEventListener: function () {},
      querySelectorAll: function () { return []; }
    },
    escapeHtml: function (s) { return String(s == null ? '' : s); },
    toast: function (msg, type) { toastLog.push({ msg: msg, type: type }); },
    updateBadges: function () {},
    closeModal: function (id) {
      // Real production closeModal(): classList.remove('open') only.
      // No field-clearing — modelled faithfully, not stubbed away.
      var el = fakeElements[id];
      if (el) el.classList.remove('open');
    },
    formatDate: function (d) { return d || '—'; },
    formatTime: function (t) { return t || '—'; },
    parseLocalDate: function (d) { return d ? new Date(d).getTime() : 0; },
    urgencyBadge: function () { return ''; },
    statusBadge: function () { return ''; },
    val: function (id) { const el = fakeElements[id]; return el ? el.value : ''; },
    uid: function () { return 'test-uid-' + Math.random().toString(36).slice(2, 8); },
    ApiService: {
      syncRow: function () {},
      deleteData: function () {},
      updateData: function () {},
      getPortalUrl: function (token) { return 'https://portal.example/' + token; },
      getQrImageUrl: function () { return 'https://qr.example/'; }
    },
    saveLocal: function () {},
    confirm: function () { return true; },
    confirmDialog: function () { return Promise.resolve(true); },
    console: console
  };
  sandboxGlobals.window = global;

  Object.keys(sandboxGlobals).forEach(function (k) { global[k] = sandboxGlobals[k]; });

  // ---- Load the REAL base resetForm/fillForm/collectForm (print-utils.js)
  //      into the real Node global scope BEFORE cases.js, exactly matching
  //      index.html's <script> load order (print-utils.js precedes
  //      cases.js) so cases.js's `var _origResetForm = resetForm;` closes
  //      over the REAL base function, not a stub. ----
  const printUtilsCode = fs.readFileSync(path.join(ROOT, 'js', 'print-utils.js'), 'utf8');
  vm.runInThisContext(printUtilsCode, { filename: path.join(ROOT, 'js', 'print-utils.js') });

  // ---- Load in production <script> order: cases.js -> tasks.js ->
  //      sessions.js -> process-server-works.js ----
  const casesModule = loadModule(path.join(modulesDir, 'cases.js'));
  global.saveCase = casesModule.saveCase;
  const tasksModule = loadModule(path.join(modulesDir, 'tasks.js'));
  const sessModule = loadModule(path.join(modulesDir, 'sessions.js'));
  const pswModule = loadModule(path.join(modulesDir, 'process-server-works.js'));

  await casesModule.ensureCasesRepositoryReady();
  await tasksModule.ensureTasksRepositoryReady();
  await sessModule.ensureSessionsRepositoryReady();
  await pswModule.processServerWorksRepository.open();

  // ---- Seed an existing case so the next save collides (ConflictError) ----
  fakeElements.fCaseNum.value = 'C-2026-001';
  fakeElements.fCaseTitle.value = 'قضية موجودة بالفعل';
  fakeElements.fCaseClient.value = 'أحمد محمود';
  const seedResult = await global.saveCase();

  check('setup — seed case saved successfully (precondition for the collision below)', function () {
    assert.ok(seedResult && seedResult.success === true, 'seed save failed: ' + JSON.stringify(seedResult));
  });

  // ================================================================
  // Reproduce the reported scenario: open Add Case (editIdx.cases=-1),
  // fill case + all three embedded tabs + select a client, save fails
  // with ConflictError (same رقم_القضية).
  // ================================================================
  global.editIdx.cases = -1;
  // SAME رقم_القضية as the seeded case above -> ConflictError
  fakeElements.fCaseNum.value = 'C-2026-001';
  fakeElements.fCaseTitle.value = 'محاولة قضية جديدة';
  fakeElements.fCaseClient.value = 'سارة عبد الله';
  fakeElements.fCaseDocketNum.value = '2026/1234 مدني كلي';
  fakeElements.fCaseClients.value = JSON.stringify(['CL-STALE']); // stale client selection

  fakeElements.fCaseSessionDate.value = '2026-11-01';
  fakeElements.fCaseSessionTime.value = '10:00';
  fakeElements.fCaseSessionTitle.value = 'جلسة من محاولة فاشلة';
  fakeElements.fCaseSessionRequired.value = 'تقديم مذكرة';
  fakeElements.fCaseSessionNotes.value = 'ملاحظات جلسة';

  fakeElements.fCaseTaskTitle.value = 'استخراج صورة رسمية';
  fakeElements.fCaseTaskDeadline.value = '2026-11-05';
  fakeElements.fCaseTaskLocation.value = 'المحكمة';
  fakeElements.fCaseTaskRequired.value = 'متابعة';
  fakeElements.fCaseTaskNotes.value = 'ملاحظات عمل إداري';

  fakeElements.fCasePswNature.value = 'إعلان بالحضور';
  fakeElements.fCasePswNumber.value = '55';
  fakeElements.fCasePswCourt.value = 'محكمة الأسرة';
  fakeElements.fCasePswOffice.value = 'قلم المحضرين الأول';
  fakeElements.fCasePswDeliveryDate.value = '2026-11-02';
  fakeElements.fCasePswReceiptDate.value = '2026-11-03';
  fakeElements.fCasePswSessionDate.value = '2026-11-10';
  fakeElements.fCasePswNotes.value = 'ملاحظات محضرين';

  const failedSaveResult = await global.saveCase();

  check('the collision reproduces: saveCase() rejects with ConflictError', function () {
    assert.ok(failedSaveResult && failedSaveResult.success === false, 'expected a rejected save, got ' + JSON.stringify(failedSaveResult));
    assert.strictEqual(failedSaveResult.error && failedSaveResult.error.type, 'ConflictError');
  });

  check('no orphaned session/task/PSW records were created by the rejected save (separate, already-fixed guarantee)', function () {
    assert.strictEqual(sessModule.sessionsRepository.getAll().length, 0);
    assert.strictEqual(tasksModule.tasksRepository.getAll().length, 0);
    assert.strictEqual(pswModule.processServerWorksRepository.getAll().length, 0);
  });

  // ---- Cancel ----
  global.closeModal('modalCase');

  // ---- Reopen "إضافة قضية" — same two lines openAddModal() runs for
  //      the cases page: editIdx.cases = -1; resetForm('cases'); ----
  global.editIdx.cases = -1;
  casesModule.resetForm('cases');

  // ================================================================
  // THE ASSERTION Problem 2 is about: every field — case-native AND
  // all three embedded tabs, AND the client selector — must be empty.
  // ================================================================
  check('after Cancel + reopening "إضافة قضية", every case-native field is empty (FIELDS.cases-driven — already worked before this fix)', function () {
    ['fCaseNum', 'fCaseTitle', 'fCaseClient', 'fCaseDocketNum'].forEach(function (id) {
      assert.strictEqual(fakeElements[id].value, '', 'expected ' + id + ' to be empty, got "' + fakeElements[id].value + '"');
    });
  });

  check('after Cancel + reopening "إضافة قضية", the embedded جلسة (Session) tab is empty', function () {
    ['fCaseSessionDate', 'fCaseSessionTime', 'fCaseSessionTitle', 'fCaseSessionRequired', 'fCaseSessionNotes'].forEach(function (id) {
      assert.strictEqual(fakeElements[id].value, '', 'expected ' + id + ' to be empty (stale value leaked from the failed attempt), got "' + fakeElements[id].value + '"');
    });
  });

  check('after Cancel + reopening "إضافة قضية", the embedded عمل اداري (Admin Work) tab is empty', function () {
    ['fCaseTaskTitle', 'fCaseTaskDeadline', 'fCaseTaskLocation', 'fCaseTaskRequired', 'fCaseTaskNotes'].forEach(function (id) {
      assert.strictEqual(fakeElements[id].value, '', 'expected ' + id + ' to be empty (stale value leaked from the failed attempt), got "' + fakeElements[id].value + '"');
    });
  });

  check('after Cancel + reopening "إضافة قضية", the embedded محضرين (PSW) tab is empty', function () {
    ['fCasePswNature', 'fCasePswNumber', 'fCasePswCourt', 'fCasePswOffice', 'fCasePswDeliveryDate', 'fCasePswReceiptDate', 'fCasePswSessionDate', 'fCasePswNotes'].forEach(function (id) {
      assert.strictEqual(fakeElements[id].value, '', 'expected ' + id + ' to be empty (stale value leaked from the failed attempt), got "' + fakeElements[id].value + '"');
    });
  });

  check('after Cancel + reopening "إضافة قضية", the stale #fCaseClients selection is cleared (would otherwise mis-link the NEXT embedded عمل اداري/محضرين save)', function () {
    assert.strictEqual(fakeElements.fCaseClients.value, '', 'expected fCaseClients to be empty, got "' + fakeElements.fCaseClients.value + '"');
  });

  console.log(log.join('\n'));
  console.log('\n' + passed + '/' + (passed + failed) + ' checks passed.');
  if (failed > 0) {
    console.log('\n' + failed + ' CHECK(S) FAILED.');
    process.exit(1);
  } else {
    console.log('\nALL CHECKS PASSED.');
    process.exit(0);
  }
}

main().catch(function (err) {
  console.error('FATAL — uncaught error in test runner:', err && err.stack ? err.stack : err);
  process.exit(1);
});
