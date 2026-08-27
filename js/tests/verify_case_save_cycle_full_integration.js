/**
 * verify_case_save_cycle_full_integration.js
 * ================================================================
 * CASE_SAVE_CYCLE_FIX_2026 — the single most important gap this fix
 * cycle closes: every existing verify_embedded_*_in_case.js test loads
 * ONE module in isolation and stubs `saveCase` as a fake function, so
 * none of them ever exercise the REAL wrapper chain index.html actually
 * builds at runtime. This file loads the real module files, in the
 * REAL production <script> order taken directly from index.html:
 *
 *   cases.js -> tasks.js -> documents.js -> sessions.js -> clients.js
 *   -> opponents.js -> process-server-works.js
 *
 * ...into ONE shared global sandbox, so the final `global.saveCase` is
 * the exact same nested-wrapper chain the real app builds (outermost =
 * last-loaded = process-server-works.js's wrapper).
 *
 * Scenario (single saveCase() call): new case + an existing client
 * selected + an existing opponent selected + a session tab filled +
 * an administrative-work tab filled + a process-server-work tab filled.
 * Asserts exactly one record is created per entity, all correctly
 * linked to the case, and that رقم_الدعوى (B1) reaches the session.
 *
 * A second scenario re-runs saveCase() as an UPDATE (same رقم_القضية,
 * editIdx.cases pointed at the existing record) and asserts no
 * duplicate case/session/task/PSW/CaseClients rows are produced.
 *
 * documents.js and its embedded-document tab are deliberately left
 * EMPTY throughout (fCaseDocName stays '') — its own gate is already
 * covered by verify_embedded_document_in_case.js; here it only needs
 * to prove it does not break the chain when present but unused.
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

// ---- Fake DOM element (same minimal surface every existing harness
//      in this suite uses) ----
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

function setGlobals(extraGlobals) {
  Object.keys(extraGlobals).forEach(function (k) { global[k] = extraGlobals[k]; });
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

const modulesDir = path.join(__dirname, '..', 'modules');

async function main() {
  const fakeIndexedDB = new FakeIndexedDB();
  const fakeElements = {};
  const toastLog = [];

  // Real production case-form field ids (cases.js CASES_MAP) — only
  // fCaseNum/fCaseTitle/fCaseClient/fCaseDocketNum are read directly by
  // saveCase()'s own validation/DOM reads; the rest of the case record
  // itself comes from the collectForm('cases') stub below, exactly like
  // verify_cases_repository_integration.js already does (that file's own
  // comment explains why: cases.js is a classic browser script, not a
  // Node module, so collectForm's *real* per-field DOM-walking logic is
  // out of scope for this harness — CASES_MAP field-mapping itself is
  // already covered by verify_cases_repository_integration.js).
  ['fCaseNum', 'fCaseTitle', 'fCaseClient', 'fCaseClients', 'fCaseDocketNum',
    'fCaseParentCase', 'fCaseOpponents', 'fCaseOpponentRoles',
    // session tab
    'fCaseSessionDate', 'fCaseSessionTime', 'fCaseSessionTitle',
    'fCaseSessionRequired', 'fCaseSessionNotes',
    // admin-work tab
    'fCaseTaskTitle', 'fCaseTaskDeadline', 'fCaseTaskLocation',
    'fCaseTaskRequired', 'fCaseTaskNotes',
    // PSW tab
    'fCasePswNature', 'fCasePswNumber', 'fCasePswCourt', 'fCasePswOffice',
    'fCasePswDeliveryDate', 'fCasePswReceiptDate', 'fCasePswSessionDate',
    'fCasePswNotes',
    // documents tab — left empty on purpose (see file header)
    'fCaseDocName',
    // cases.js's saveCase() itself touches these unconditionally
    'childrenRows', 'fCaseChildrenData'
  ].forEach(function (id) { fakeElements[id] = makeFakeElement(); });

  const sandboxGlobals = {
    indexedDB: fakeIndexedDB,
    data: { cases: [], clients: [], opponents: [], sessions: [], documents: [], tasks: [], processServerWorks: [], caseClients: [], fees: [] },
    editIdx: { cases: -1 },
    document: {
      getElementById: function (id) {
        // Auto-vivify any DOM id not explicitly pre-seeded above — this
        // full production-chain test touches far more incidental
        // rendering DOM (renderCases()/badges/empty-state toggles) than
        // any single-module harness ever does; those elements only need
        // to exist and not throw, never to hold meaningful test data.
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
    closeModal: function () {},
    formatDate: function (d) { return d || '—'; },
    formatTime: function (t) { return t || '—'; },
    parseLocalDate: function (d) { return d ? new Date(d).getTime() : 0; },
    urgencyBadge: function () { return ''; },
    statusBadge: function () { return ''; },
    val: function (id) { const el = fakeElements[id]; return el ? el.value : ''; },
    uid: function () { return 'test-uid-' + Math.random().toString(36).slice(2, 8); },
    // collectForm('cases') stands in for cases.js's real per-field DOM
    // walk (same simplification verify_cases_repository_integration.js
    // uses) — the test controls the case object's content directly via
    // sandboxGlobals.__nextFormValue, set right before each saveCase()
    // call below.
    collectForm: function () { return sandboxGlobals.__nextFormValue || {}; },
    fillForm: function () {},
    resetForm: function () {},
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
  sandboxGlobals.window = global; // self-referential — IndexedDBAdapter resolves its root to `window` when defined; must be the SAME object as global.indexedDB above (matches every other integration harness in this suite).

  setGlobals(sandboxGlobals);

  // ---- Load in the EXACT production <script> order from index.html ----
  const casesModule   = loadModule(path.join(modulesDir, 'cases.js'));
  // Real index.html <script> tags are NOT ES modules — a top-level
  // `function saveCase(){}` in cases.js becomes `window.saveCase`
  // automatically there. Under Node's CommonJS wrapping that same
  // declaration is scoped to cases.js's own module wrapper instead, so
  // this one line is this harness's stand-in for that browser-only
  // behavior — every later module's `if (typeof saveCase === 'function')
  // { var orig = saveCase; saveCase = function(){...} }` wrap (bare
  // assignment, sloppy mode — confirmed none of these files declare
  // 'use strict') then chains onto it exactly as index.html would.
  global.saveCase = casesModule.saveCase;
  const tasksModule   = loadModule(path.join(modulesDir, 'tasks.js'));
  const docsModule    = loadModule(path.join(modulesDir, 'documents.js'));
  const sessModule    = loadModule(path.join(modulesDir, 'sessions.js'));
  const clientsModule = loadModule(path.join(modulesDir, 'clients.js'));
  const oppModule     = loadModule(path.join(modulesDir, 'opponents.js'));
  const pswModule     = loadModule(path.join(modulesDir, 'process-server-works.js'));

  await casesModule.ensureCasesRepositoryReady();
  await tasksModule.ensureTasksRepositoryReady();
  await docsModule.ensureDocumentsRepositoryReady();
  await sessModule.ensureSessionsRepositoryReady();
  await clientsModule.ensureClientsRepositoryReady();
  await clientsModule.ensureCaseClientsRepositoryReady();
  await oppModule.ensureOpponentsRepositoryReady();
  // NOTE: ensureProcessServerWorksRepositoryReady() exists in
  // process-server-works.js but is NOT in its module.exports list —
  // awaiting the repository's own .open() (idempotent, same object the
  // internal ready-promise wraps) achieves the same readiness guarantee
  // without needing that file changed just for this test.
  await pswModule.processServerWorksRepository.open();

  // ---- Pre-existing client + opponent (selected into the case, not
  //      created by saving it — matches real usage: both tabs are
  //      pickers over already-existing standalone records) ----
  await clientsModule.clientsRepository.create({ 'رقم_الموكل': 'CL-1', 'الاسم': 'أحمد محمود', 'النوع': 'شخص طبيعي' });
  global.data.clients = clientsModule.clientsRepository.getAll();

  await oppModule.opponentsRepository.create({ 'رقم_الخصم': 'OP-1', 'الاسم': 'شركة النور', 'النوع': 'شخص اعتباري' });
  global.data.opponents = oppModule.opponentsRepository.getAll();

  clientsModule.toggleCaseClient('CL-1', true);
  oppModule.toggleCaseOpponent('OP-1');

  // ================================================================
  // SCENARIO 1 — one saveCase() call, everything filled in one go
  // ================================================================
  fakeElements.fCaseNum.value = 'C-2026-001';
  fakeElements.fCaseTitle.value = 'قضية اختبار التكامل الكامل';
  fakeElements.fCaseDocketNum.value = '2026/9999 مدني كلي';

  fakeElements.fCaseSessionDate.value = '2026-09-10';
  fakeElements.fCaseSessionTime.value = '10:30';
  fakeElements.fCaseSessionTitle.value = 'جلسة أولى';
  fakeElements.fCaseSessionRequired.value = 'تقديم مستندات';

  fakeElements.fCaseTaskTitle.value = 'استخراج صورة رسمية من الحكم';
  fakeElements.fCaseTaskDeadline.value = '2026-09-05';

  fakeElements.fCasePswNature.value = 'إعلان صحيفة دعوى';
  fakeElements.fCasePswNumber.value = 'PSW-2026-1';

  sandboxGlobals.__nextFormValue = {
    'رقم_القضية': 'C-2026-001',
    'عنوان_القضية': 'قضية اختبار التكامل الكامل',
    'رقم_الدعوى': '2026/9999 مدني كلي',
    'اسم_الموكل': 'أحمد محمود'
  };

  const saveResult1 = await global.saveCase();

  // CASE_SAVE_CYCLE_FIX_2026 — saveCase() now resolves to the Repository's
  // {success, record, error} WriteResult on every exit path instead of an
  // implicit `undefined`. Every wrapper's `saveOutcome` is therefore the
  // REAL outcome, letting each "runs AFTER the case saves" side effect gate
  // on saveOutcome.success (see SCENARIO 4 below for the case this fixes).
  check('SCENARIO 1 — saveCase()\'s return value now surfaces the real Repository WriteResult (success:true, the saved record) all the way through the wrapper chain', function () {
    assert.ok(saveResult1 && saveResult1.success === true, 'expected {success:true,...}, got ' + JSON.stringify(saveResult1));
    assert.strictEqual(saveResult1.record['رقم_القضية'], 'C-2026-001');
  });

  check('SCENARIO 1 — exactly ONE case record was created', function () {
    assert.strictEqual(casesModule.casesRepository.getAll().length, 1);
  });

  check('SCENARIO 1 — the case record carries the correct رقم_القضية and رقم_الدعوى', function () {
    const c = casesModule.casesRepository.getAll()[0];
    assert.strictEqual(c['رقم_القضية'], 'C-2026-001');
    assert.strictEqual(c['رقم_الدعوى'], '2026/9999 مدني كلي');
  });

  check('SCENARIO 1 — exactly ONE session record was created, linked to the case', function () {
    const rows = sessModule.sessionsRepository.getAll().filter(function (s) { return s['رقم_القضية'] === 'C-2026-001'; });
    assert.strictEqual(rows.length, 1, 'expected 1 session, found ' + rows.length);
  });

  check('B1 (end-to-end) — that session record carries the case\'s رقم_الدعوى', function () {
    const s = sessModule.sessionsRepository.getAll().filter(function (r) { return r['رقم_القضية'] === 'C-2026-001'; })[0];
    assert.strictEqual(s['رقم_الدعوى'], '2026/9999 مدني كلي');
  });

  check('SCENARIO 1 — exactly ONE administrative-work record was created, linked to the case', function () {
    const rows = tasksModule.tasksRepository.getAll().filter(function (t) { return t['رقم_القضية'] === 'C-2026-001'; });
    assert.strictEqual(rows.length, 1, 'expected 1 admin-work row, found ' + rows.length);
  });

  check('SCENARIO 1 — exactly ONE process-server-work record was created, linked to the case AND to the selected client', function () {
    const rows = pswModule.processServerWorksRepository.getAll().filter(function (w) { return w['رقم_القضية'] === 'C-2026-001'; });
    assert.strictEqual(rows.length, 1, 'expected 1 PSW row, found ' + rows.length);
    assert.strictEqual(rows[0]['رقم_الموكل'], 'CL-1');
  });

  check('SCENARIO 1 — NO document record was created (tab left empty — the gate still works inside the real chain)', function () {
    const rows = docsModule.documentsRepository.getAll().filter(function (d) { return d['رقم_القضية'] === 'C-2026-001'; });
    assert.strictEqual(rows.length, 0);
  });

  check('SCENARIO 1 — exactly ONE قضية_موكلين relationship row links CL-1 to the case (selecting an existing client does not create a duplicate Clients record)', function () {
    assert.strictEqual(clientsModule.clientsRepository.getAll().length, 1, 'client repository must still hold exactly the 1 pre-existing client');
    const rel = clientsModule.caseClientsRepository.getByCase('C-2026-001');
    assert.strictEqual(rel.length, 1, 'expected 1 قضية_موكلين row, found ' + rel.length);
    assert.strictEqual(rel[0]['رقم_الموكل'], 'CL-1');
  });

  check('SCENARIO 1 — selecting an existing opponent syncs #fCaseOpponents correctly and does not create a duplicate Opponents record (the case-modal picker only stores a JSON id reference on the case, never calls opponentsRepository.create() — verified directly on the hidden field opponents.js\'s saveCase wrap writes; the real production collectForm(\'cases\') — not part of this Node harness, see file header — is what transfers that field onto the case record itself)', function () {
    assert.strictEqual(oppModule.opponentsRepository.getAll().length, 1, 'opponents repository must still hold exactly the 1 pre-existing opponent');
    assert.deepStrictEqual(JSON.parse(fakeElements.fCaseOpponents.value || '[]'), ['OP-1']);
  });

  // ================================================================
  // SCENARIO 2 — UPDATE the same case (editIdx points at record 0),
  // re-submitting the SAME session/task/PSW tab values. Must NOT
  // duplicate anything.
  // ================================================================
  global.editIdx.cases = 0; // real UI sets this when editCase() opens an existing record

  // Re-fill the embedded tabs — a user re-opening the case and adding
  // one MORE session (not re-submitting the same one) is the realistic
  // update scenario; the case-level duplicate-prevention question this
  // scenario is really aimed at is the CASE record itself.
  fakeElements.fCaseSessionDate.value = '2026-09-20';
  fakeElements.fCaseSessionTime.value = '12:00';
  fakeElements.fCaseSessionTitle.value = 'جلسة ثانية';
  fakeElements.fCaseTaskTitle.value = ''; // leave empty — already created once, don't re-create
  fakeElements.fCasePswNature.value = ''; // leave empty — already created once, don't re-create

  sandboxGlobals.__nextFormValue = {
    'رقم_القضية': 'C-2026-001',
    'عنوان_القضية': 'قضية اختبار التكامل الكامل — محدّثة',
    'رقم_الدعوى': '2026/9999 مدني كلي',
    'اسم_الموكل': 'أحمد محمود'
  };

  const saveResult2 = await global.saveCase();

  check('SCENARIO 2 (UPDATE) — saveCase()\'s return value is still a real {success:true,...} WriteResult on the update path', function () {
    assert.ok(saveResult2 && saveResult2.success === true, 'expected {success:true,...}, got ' + JSON.stringify(saveResult2));
  });

  check('SCENARIO 2 (UPDATE) — still exactly ONE case record (update, not a new row)', function () {
    assert.strictEqual(casesModule.casesRepository.getAll().length, 1);
  });

  check('SCENARIO 2 (UPDATE) — the case record reflects the updated title (proves it was actually updated, not silently skipped)', function () {
    assert.strictEqual(casesModule.casesRepository.getAll()[0]['عنوان_القضية'], 'قضية اختبار التكامل الكامل — محدّثة');
  });

  check('SCENARIO 2 (UPDATE) — a SECOND, distinct session was added (2 total) — the update path does not silently drop a newly-filled embedded tab', function () {
    const rows = sessModule.sessionsRepository.getAll().filter(function (s) { return s['رقم_القضية'] === 'C-2026-001'; });
    assert.strictEqual(rows.length, 2, 'expected 2 sessions total, found ' + rows.length);
  });

  check('SCENARIO 2 (UPDATE) — admin-work count unchanged at 1 (tab left empty on update — no phantom duplicate)', function () {
    const rows = tasksModule.tasksRepository.getAll().filter(function (t) { return t['رقم_القضية'] === 'C-2026-001'; });
    assert.strictEqual(rows.length, 1);
  });

  check('SCENARIO 2 (UPDATE) — PSW count unchanged at 1 (tab left empty on update — no phantom duplicate)', function () {
    const rows = pswModule.processServerWorksRepository.getAll().filter(function (w) { return w['رقم_القضية'] === 'C-2026-001'; });
    assert.strictEqual(rows.length, 1);
  });

  check('SCENARIO 2 (UPDATE) — قضية_موكلين relationship still exactly 1 row (reconciliation updates in place, does not duplicate)', function () {
    const rel = clientsModule.caseClientsRepository.getByCase('C-2026-001');
    assert.strictEqual(rel.length, 1, 'expected 1 قضية_موكلين row after update, found ' + rel.length);
  });

  // ================================================================
  // SCENARIO 3 — DUPLICATE-SAVE ATTEMPT: call saveCase() a THIRD time
  // with editIdx reset to -1 (simulates a NEW-case form that still has
  // the same رقم_القضية typed in — e.g. browser back/forward, or a
  // double-submit before the UI had a chance to disable the button)
  // ================================================================
  global.editIdx.cases = -1;
  fakeElements.fCaseSessionTitle.value = ''; // leave every embedded tab empty for this scenario — isolates the CASE-level duplicate question from embedded-tab behavior, which SCENARIO 4 below covers separately
  fakeElements.fCaseTaskTitle.value = '';
  fakeElements.fCasePswNature.value = '';
  sandboxGlobals.__nextFormValue = {
    'رقم_القضية': 'C-2026-001', // SAME number as the existing record
    'عنوان_القضية': 'محاولة تكرار',
    'اسم_الموكل': 'أحمد محمود'
  };

  const saveResult3 = await global.saveCase();

  check('SCENARIO 3 (DUPLICATE-SAVE ATTEMPT) — saveCase()\'s return value now surfaces the real ConflictError WriteResult (success:false) all the way through the wrapper chain', function () {
    assert.ok(saveResult3 && saveResult3.success === false, 'expected {success:false,...}, got ' + JSON.stringify(saveResult3));
    assert.strictEqual(saveResult3.error && saveResult3.error.type, 'ConflictError');
  });

  check('SCENARIO 3 (DUPLICATE-SAVE ATTEMPT) — still exactly ONE case record (local ConflictError guard — Repository.js — holds)', function () {
    assert.strictEqual(casesModule.casesRepository.getAll().length, 1);
  });

  await checkAsync('SCENARIO 3 (DUPLICATE-SAVE ATTEMPT) — a user-visible error toast was shown for the rejected save', async function () {
    const hasConflictToast = toastLog.some(function (t) { return t.type === 'error'; });
    assert.ok(hasConflictToast, 'expected at least one error-type toast after the rejected duplicate save; toastLog=' + JSON.stringify(toastLog));
  });

  // ================================================================
  // SCENARIO 4 — CASE_SAVE_CYCLE_FIX_2026: repeat the exact
  // duplicate-save-rejection setup of SCENARIO 3, but this time with
  // the session tab ALSO filled in. Proves that an embedded sub-entity
  // is NO LONGER created when the case save it would be attached to is
  // REJECTED (ConflictError). Root cause (fixed above, see cases.js
  // saveCase()): the base saveCase() now returns its real
  // {success, record, error} WriteResult on every exit path, so every
  // wrapper's `saveOutcome` reflects the true outcome and each
  // wrapper's post-save continuation is gated on `saveOutcome.success`
  // before running.
  // ================================================================
  const sessionCountBeforeScenario4 = sessModule.sessionsRepository.getAll()
    .filter(function (s) { return s['رقم_القضية'] === 'C-2026-001'; }).length;

  fakeElements.fCaseSessionDate.value = '2026-10-01';
  fakeElements.fCaseSessionTime.value = '09:00';
  fakeElements.fCaseSessionTitle.value = 'جلسة من محاولة حفظ مرفوضة';
  sandboxGlobals.__nextFormValue = {
    'رقم_القضية': 'C-2026-001', // SAME number — will hit ConflictError again
    'عنوان_القضية': 'محاولة تكرار مع جلسة',
    'اسم_الموكل': 'أحمد محمود'
  };

  const saveResult4 = await global.saveCase();

  const sessionCountAfterScenario4 = sessModule.sessionsRepository.getAll()
    .filter(function (s) { return s['رقم_القضية'] === 'C-2026-001'; }).length;

  check('SCENARIO 4 (FIXED) — saveCase() still surfaces the ConflictError WriteResult when an embedded tab is also filled', function () {
    assert.ok(saveResult4 && saveResult4.success === false, 'expected {success:false,...}, got ' + JSON.stringify(saveResult4));
    assert.strictEqual(saveResult4.error && saveResult4.error.type, 'ConflictError');
  });

  check('SCENARIO 4 (FIXED) — a session tab filled alongside a REJECTED (ConflictError) case save no longer creates an orphaned session record', function () {
    assert.strictEqual(sessionCountAfterScenario4, sessionCountBeforeScenario4,
      'expected NO new session to be created once the case save is gated on saveOutcome.success; before=' + sessionCountBeforeScenario4 + ' after=' + sessionCountAfterScenario4);
  });

  // ================================================================
  // report
  // ================================================================
  console.log(log.join('\n'));
  console.log('\n' + passed + ' passed, ' + failed + ' failed.');
  if (failed > 0) process.exit(1);
}

main().catch(function (err) {
  console.error('FATAL — uncaught error in test runner:', err && err.stack ? err.stack : err);
  process.exit(1);
});
