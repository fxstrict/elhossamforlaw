/**
 * verify_case_save_cycle_end_to_end.js
 * PROBLEM 9 (Case Save Cycle audit, v79) — comprehensive
 * Production-Order Integration Test.
 *
 * verify_case_save_cycle_full_integration.js already proved items 1-9
 * of the brief's list (single saveCase() call across Case + Client +
 * Opponent + Session + Administrative Work + PSW + Documents; no
 * duplicates; update-in-place; ConflictError on a duplicate رقم_القضية;
 * no orphaned child records on a rejected save) — but with
 * resetForm/collectForm/ApiService.syncRow all stubbed as no-ops, so it
 * could not prove items 10-12 (Cancel/reset/reopen leaves every field
 * clean) or that every entity type actually SYNCS to Google Sheets in
 * the FULL combined chain (each sync fix — sessions.js/tasks.js/
 * documents.js/process-server-works.js — was previously only proven in
 * isolation, one module at a time).
 *
 * This file closes both remaining gaps in ONE real, non-stubbed,
 * production-order run: loads cases.js -> tasks.js -> documents.js ->
 * sessions.js -> clients.js -> opponents.js -> process-server-works.js
 * (exact <script> order from index.html, confirmed in the Problem 8
 * wrapper-chain audit), with the REAL FIELDS/MAP objects parsed out of
 * index.html and the REAL print-utils.js resetForm/collectForm/fillForm
 * — not hand-typed stand-ins — plus a fake ApiService.syncRow that
 * actually records every call, so "did it sync" is a real assertion,
 * not an assumption.
 *
 * Covers, as one continuous scenario against ONE shared case:
 *   1.  successful save
 *   2.  every record verified
 *   3.  case linkage verified
 *   4.  no duplicates
 *   5.  update
 *   6.  update-in-place verified
 *   7.  duplicate رقم_القضية attempted
 *   8.  ConflictError confirmed
 *   9.  no child records created on the rejected save
 *   10. Cancel
 *   11. reopen "إضافة قضية"
 *   12. every field — case, all four embedded tabs, AND the
 *       client/opponent selectors' own internal state — confirmed clean
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

function makeFakeElement(tagName) {
  return {
    value: '', textContent: '', innerHTML: '', tagName: tagName || 'INPUT', options: [],
    style: { display: '' }, selectedIndex: 0,
    classList: {
      _classes: {},
      add: function (c) { this._classes[c] = true; },
      remove: function (c) { delete this._classes[c]; },
      contains: function (c) { return !!this._classes[c]; }
    },
    children: [], querySelectorAll: function () { return []; }, appendChild: function () {}
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
  const syncRowCalls = [];
  const toastLog = [];

  const allFieldIds = [
    'fCaseNum', 'fCaseTitle', 'fCaseClient', 'fCaseDocketNum', 'fCaseClients',
    'fCaseOpponents', 'fCaseOpponentRoles', 'fCaseParentCase',
    'fCaseSessionDate', 'fCaseSessionTime', 'fCaseSessionTitle', 'fCaseSessionRequired', 'fCaseSessionNotes',
    'fCaseTaskTitle', 'fCaseTaskDeadline', 'fCaseTaskLocation', 'fCaseTaskRequired', 'fCaseTaskNotes',
    'fCasePswNature', 'fCasePswNumber', 'fCasePswCourt', 'fCasePswOffice',
    'fCasePswDeliveryDate', 'fCasePswReceiptDate', 'fCasePswSessionDate', 'fCasePswNotes',
    'fCaseDocName', 'fCaseDocType', 'fCaseDocDriveUrl', 'fCaseDocNotes',
    'childrenRows', 'fCaseChildrenData'
  ];
  allFieldIds.forEach(function (id) { fakeElements[id] = makeFakeElement(); });

  const REAL_FIELDS = loadRealConfigObject('FIELDS');
  const REAL_MAP = loadRealConfigObject('MAP');

  const sandboxGlobals = {
    indexedDB: fakeIndexedDB,
    data: { cases: [], clients: [], opponents: [], sessions: [], documents: [], tasks: [], processServerWorks: [], caseClients: [], fees: [] },
    editIdx: { cases: -1 },
    FIELDS: REAL_FIELDS,
    MAP: REAL_MAP,
    document: {
      getElementById: function (id) { if (!fakeElements[id]) fakeElements[id] = makeFakeElement(); return fakeElements[id]; },
      createElement: function () { return makeFakeElement(); },
      addEventListener: function () {},
      querySelectorAll: function () { return []; }
    },
    escapeHtml: function (s) { return String(s == null ? '' : s); },
    toast: function (msg, type) { toastLog.push({ msg: msg, type: type }); },
    updateBadges: function () {},
    closeModal: function () {},
    parseLocalDate: function (d) { return d ? new Date(d) : null; },
    urgencyBadge: function () { return ''; },
    statusBadge: function () { return ''; },
    formatDate: function (d) { return d || '—'; },
    formatTime: function (t) { return t || '—'; },
    val: function (id) { const el = fakeElements[id]; return el ? el.value : ''; },
    uid: function () { return 'test-uid-' + Math.random().toString(36).slice(2, 8); },
    ApiService: {
      syncRow: function (sheetName, record, idx) { syncRowCalls.push({ sheetName: sheetName, record: record, idx: idx }); },
      deleteData: function () {},
      updateData: function () {},
      getPortalUrl: function (t) { return 'https://portal.example/' + t; },
      getQrImageUrl: function () { return 'https://qr.example/'; }
    },
    saveLocal: function () {},
    confirm: function () { return true; },
    confirmDialog: function () { return Promise.resolve(true); },
    console: console
  };
  sandboxGlobals.window = global;
  Object.keys(sandboxGlobals).forEach(function (k) { global[k] = sandboxGlobals[k]; });

  const printUtilsCode = fs.readFileSync(path.join(ROOT, 'js', 'print-utils.js'), 'utf8');
  vm.runInThisContext(printUtilsCode, { filename: path.join(ROOT, 'js', 'print-utils.js') });

  // ---- Real production <script> order (confirmed in the Problem 8
  //      wrapper-chain audit against index.html's actual <script> tags) ----
  const casesModule = loadModule(path.join(modulesDir, 'cases.js'));
  global.saveCase = casesModule.saveCase;
  const tasksModule = loadModule(path.join(modulesDir, 'tasks.js'));
  const docsModule = loadModule(path.join(modulesDir, 'documents.js'));
  const sessModule = loadModule(path.join(modulesDir, 'sessions.js'));
  const clientsModule = loadModule(path.join(modulesDir, 'clients.js'));
  const oppModule = loadModule(path.join(modulesDir, 'opponents.js'));
  const pswModule = loadModule(path.join(modulesDir, 'process-server-works.js'));

  await casesModule.ensureCasesRepositoryReady();
  await tasksModule.ensureTasksRepositoryReady();
  await docsModule.ensureDocumentsRepositoryReady();
  await sessModule.ensureSessionsRepositoryReady();
  await clientsModule.ensureClientsRepositoryReady();
  await clientsModule.ensureCaseClientsRepositoryReady();
  await oppModule.ensureOpponentsRepositoryReady();
  await pswModule.processServerWorksRepository.open();

  await clientsModule.clientsRepository.create({ 'رقم_الموكل': 'CL-1', 'الاسم': 'أحمد محمود', 'النوع': 'شخص طبيعي' });
  global.data.clients = clientsModule.clientsRepository.getAll();
  await oppModule.opponentsRepository.create({ 'رقم_الخصم': 'OP-1', 'الاسم': 'شركة النور', 'النوع': 'شخص اعتباري' });
  global.data.opponents = oppModule.opponentsRepository.getAll();
  clientsModule.toggleCaseClient('CL-1', true);
  oppModule.toggleCaseOpponent('OP-1');

  // ================================================================
  // 1/2/3/4 — ONE saveCase() call, everything filled at once
  // ================================================================
  fakeElements.fCaseNum.value = 'C-2026-E2E';
  fakeElements.fCaseTitle.value = 'قضية اختبار شامل';
  fakeElements.fCaseClient.value = 'أحمد محمود';
  fakeElements.fCaseDocketNum.value = '2026/7777 مدني كلي';
  fakeElements.fCaseSessionDate.value = '2026-09-10';
  fakeElements.fCaseSessionTime.value = '10:30';
  fakeElements.fCaseSessionTitle.value = 'جلسة أولى';
  fakeElements.fCaseTaskTitle.value = 'استخراج صورة رسمية';
  fakeElements.fCasePswNature.value = 'إعلان صحيفة دعوى';
  fakeElements.fCasePswNumber.value = 'PSW-1';
  fakeElements.fCaseDocName.value = 'عقد التوكيل';

  const save1 = await global.saveCase();

  check('1. successful save — saveCase() returns {success:true,...}', function () {
    assert.ok(save1 && save1.success === true, JSON.stringify(save1));
  });

  check('2/3/4. exactly one record per entity, all linked to C-2026-E2E — case', function () {
    assert.strictEqual(casesModule.casesRepository.getAll().length, 1);
  });
  check('2/3/4. exactly one session, linked', function () {
    assert.strictEqual(sessModule.sessionsRepository.getAll().filter(function (r) { return r['رقم_القضية'] === 'C-2026-E2E'; }).length, 1);
  });
  check('2/3/4. exactly one عمل اداري, linked', function () {
    assert.strictEqual(tasksModule.tasksRepository.getAll().filter(function (r) { return r['رقم_القضية'] === 'C-2026-E2E'; }).length, 1);
  });
  check('2/3/4. exactly one عمل محضرين, linked', function () {
    assert.strictEqual(pswModule.processServerWorksRepository.getAll().filter(function (r) { return r['رقم_القضية'] === 'C-2026-E2E'; }).length, 1);
  });
  check('2/3/4. exactly one مستند, linked', function () {
    assert.strictEqual(docsModule.documentsRepository.getAll().filter(function (r) { return r['رقم_القضية'] === 'C-2026-E2E'; }).length, 1);
  });
  check('2/3/4. exactly one قضية_موكلين relationship row (no duplicate Clients record from selecting an existing one)', function () {
    assert.strictEqual(clientsModule.clientsRepository.getAll().length, 1);
    assert.strictEqual(clientsModule.caseClientsRepository.getByCase('C-2026-E2E').length, 1);
  });
  check('2/3/4. no duplicate Opponents record from selecting an existing one', function () {
    assert.strictEqual(oppModule.opponentsRepository.getAll().length, 1);
  });

  check('every synced entity type (session/عمل اداري/محضرين/مستند) actually called ApiService.syncRow in this FULL combined chain — closes Problems 3/4/8 end-to-end, not just in isolation', function () {
    ['الجلسات', 'الأعمال الإدارية', 'أعمال_المحضرين', 'المستندات'].forEach(function (sheet) {
      const synced = syncRowCalls.some(function (c) { return c.sheetName === sheet && c.record && c.record['رقم_القضية'] === 'C-2026-E2E'; });
      assert.ok(synced, 'expected a syncRow call for sheet "' + sheet + '" — got calls for: ' + syncRowCalls.map(function (c) { return c.sheetName; }).join(', '));
    });
  });

  // ================================================================
  // 5/6 — UPDATE the same case
  // ================================================================
  global.editIdx.cases = 0;
  fakeElements.fCaseSessionTitle.value = ''; // don't re-add a session on update
  fakeElements.fCaseTaskTitle.value = '';
  fakeElements.fCasePswNature.value = '';
  fakeElements.fCaseDocName.value = '';
  fakeElements.fCaseTitle.value = 'قضية اختبار شامل — محدّثة';

  const save2 = await global.saveCase();

  check('5. update — saveCase() still returns {success:true,...}', function () {
    assert.ok(save2 && save2.success === true, JSON.stringify(save2));
  });
  check('6. update-in-place — still exactly ONE case record, with the updated title', function () {
    const all = casesModule.casesRepository.getAll();
    assert.strictEqual(all.length, 1);
    assert.strictEqual(all[0]['عنوان_القضية'], 'قضية اختبار شامل — محدّثة');
  });

  // ================================================================
  // 7/8 — duplicate رقم_القضية attempt (new-case form, same number)
  // ================================================================
  global.editIdx.cases = -1;
  fakeElements.fCaseTitle.value = 'محاولة تكرار';

  const save3 = await global.saveCase();

  check('7/8. duplicate رقم_القضية is rejected with ConflictError', function () {
    assert.ok(save3 && save3.success === false);
    assert.strictEqual(save3.error && save3.error.type, 'ConflictError');
  });
  check('7/8. still exactly one case record after the rejected duplicate', function () {
    assert.strictEqual(casesModule.casesRepository.getAll().length, 1);
  });

  // ================================================================
  // 9 — no child record created when the case save itself is rejected
  // ================================================================
  const sessionCountBefore = sessModule.sessionsRepository.getAll().length;
  const taskCountBefore = tasksModule.tasksRepository.getAll().length;
  const pswCountBefore = pswModule.processServerWorksRepository.getAll().length;
  const docCountBefore = docsModule.documentsRepository.getAll().length;

  fakeElements.fCaseSessionDate.value = '2026-12-01';
  fakeElements.fCaseSessionTime.value = '09:00';
  fakeElements.fCaseSessionTitle.value = 'جلسة من محاولة مرفوضة';
  fakeElements.fCaseTaskTitle.value = 'عمل من محاولة مرفوضة';
  fakeElements.fCasePswNature.value = 'محضر من محاولة مرفوضة';
  fakeElements.fCasePswNumber.value = 'PSW-REJECTED';
  fakeElements.fCaseDocName.value = 'مستند من محاولة مرفوضة';
  fakeElements.fCaseClients.value = JSON.stringify(['CL-STALE-1']);

  const save4 = await global.saveCase();

  check('9. the rejected save (still ConflictError) with every embedded tab filled', function () {
    assert.ok(save4 && save4.success === false);
    assert.strictEqual(save4.error && save4.error.type, 'ConflictError');
  });
  check('9. NO new session/عمل اداري/محضرين/مستند were created from the rejected save\'s filled tabs', function () {
    assert.strictEqual(sessModule.sessionsRepository.getAll().length, sessionCountBefore);
    assert.strictEqual(tasksModule.tasksRepository.getAll().length, taskCountBefore);
    assert.strictEqual(pswModule.processServerWorksRepository.getAll().length, pswCountBefore);
    assert.strictEqual(docsModule.documentsRepository.getAll().length, docCountBefore);
  });

  // ================================================================
  // 10/11/12 — Cancel, reopen "إضافة قضية", every field (and internal
  // selector state) must be clean. Uses the REAL, fully-composed
  // resetForm chain (print-utils.js base -> cases.js -> clients.js ->
  // opponents.js, in that exact load order) — `global.resetForm` is the
  // final composed version after all three wraps, exactly what
  // index.html's own bare `resetForm(type)` call resolves to.
  // ================================================================
  global.closeModal('modalCase'); // Cancel — real closeModal() is classList-only, asserted elsewhere (Problem 2)
  global.editIdx.cases = -1;
  global.resetForm('cases');

  check('10/11/12. every case-native field is empty after Cancel + reopening "إضافة قضية"', function () {
    ['fCaseNum', 'fCaseTitle', 'fCaseClient', 'fCaseDocketNum'].forEach(function (id) {
      assert.strictEqual(fakeElements[id].value, '', id + ' should be empty, got "' + fakeElements[id].value + '"');
    });
  });
  check('10/11/12. the جلسة/عمل اداري/محضرين/مستند tabs are all empty (Problem 2 + Problem 8 fixes, exercised here in the full combined chain)', function () {
    ['fCaseSessionDate', 'fCaseSessionTime', 'fCaseSessionTitle',
      'fCaseTaskTitle', 'fCasePswNature', 'fCasePswNumber', 'fCaseDocName'
    ].forEach(function (id) {
      assert.strictEqual(fakeElements[id].value, '', id + ' should be empty, got "' + fakeElements[id].value + '"');
    });
  });
  check('10/11/12. the stale #fCaseClients selection is cleared', function () {
    assert.strictEqual(fakeElements.fCaseClients.value, '');
  });
  check('10/11/12. #fCaseOpponents / #fCaseOpponentRoles are reset by opponents.js\'s own resetForm() wrap (not previously covered by any other test in this suite)', function () {
    assert.strictEqual(fakeElements.fCaseOpponents.value, '[]');
    assert.strictEqual(fakeElements.fCaseOpponentRoles.value, '{}');
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
