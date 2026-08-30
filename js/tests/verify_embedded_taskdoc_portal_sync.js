/**
 * verify_embedded_taskdoc_portal_sync.js
 * PROBLEM 8 (Case Save Cycle audit, v79) — wrapper-chain audit finding,
 * fixed with the SAME proven pattern as Problem 3 (sessions.js) and
 * Problem 4 (process-server-works.js).
 *
 * While auditing every saveCase() wrapper's behavior (tasks.js,
 * documents.js, sessions.js, clients.js, opponents.js,
 * process-server-works.js — real order extracted from index.html's
 * actual <script> tags, not assumed), the same defect family already
 * proven for embedded جلسة/محضرين was also present, unreported, in the
 * two remaining embedded creators:
 *
 *   tasks.js's _createEmbeddedAdminWorkIfFilled() only called
 *   syncTasksMirror() (local IndexedDB mirror refresh) — no
 *   ApiService.syncRow('الأعمال الإدارية', ...) anywhere in it, unlike
 *   the standalone saveTask() (tasks.js:799).
 *
 *   documents.js's _createEmbeddedDocumentIfFilled() only called
 *   syncDocumentsMirror() — no ApiService.syncRow('المستندات', ...)
 *   anywhere in it, unlike the standalone saveDocument()
 *   (documents.js:537).
 *
 * Net effect, identical to Problem 3: an عمل اداري or مستند created
 * from inside the case saves correctly to local IndexedDB (with a
 * correct رقم_القضية) but never reaches Google Sheets, and therefore
 * never reaches Client Portal.
 *
 * This test loads the REAL cases.js + tasks.js + documents.js and
 * proves both records are created locally with correct linkage but
 * were never synced (before the fix), then confirms the fix.
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
    style: { display: '' },
    selectedIndex: 0,
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

  [
    'fCaseNum', 'fCaseTitle', 'fCaseClient', 'fCaseDocketNum', 'fCaseClients',
    'fCaseTaskTitle', 'fCaseTaskDeadline', 'fCaseTaskLocation', 'fCaseTaskRequired', 'fCaseTaskNotes',
    'fCaseDocName', 'fCaseDocType', 'fCaseDocDriveUrl', 'fCaseDocNotes'
  ].forEach(function (id) { fakeElements[id] = makeFakeElement(); });

  const REAL_FIELDS = loadRealConfigObject('FIELDS');
  const REAL_MAP = loadRealConfigObject('MAP');

  const sandboxGlobals = {
    indexedDB: fakeIndexedDB,
    data: { cases: [], clients: [], tasks: [], documents: [] },
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
    toast: function () {},
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
      updateData: function () {}
    },
    saveLocal: function () {},
    console: console
  };
  sandboxGlobals.window = global;
  Object.keys(sandboxGlobals).forEach(function (k) { global[k] = sandboxGlobals[k]; });

  const printUtilsCode = fs.readFileSync(path.join(ROOT, 'js', 'print-utils.js'), 'utf8');
  vm.runInThisContext(printUtilsCode, { filename: path.join(ROOT, 'js', 'print-utils.js') });

  const casesModule = loadModule(path.join(modulesDir, 'cases.js'));
  global.saveCase = casesModule.saveCase;
  // Real production <script> order: tasks.js THEN documents.js
  const tasksModule = loadModule(path.join(modulesDir, 'tasks.js'));
  const docsModule = loadModule(path.join(modulesDir, 'documents.js'));

  await casesModule.ensureCasesRepositoryReady();
  await tasksModule.ensureTasksRepositoryReady();
  await docsModule.ensureDocumentsRepositoryReady();

  fakeElements.fCaseNum.value = 'C-2026-808';
  fakeElements.fCaseTitle.value = 'قضية اختبار العمل الاداري والمستندات';
  fakeElements.fCaseClient.value = 'هالة كمال';
  fakeElements.fCaseTaskTitle.value = 'استخراج شهادة رسمية';
  fakeElements.fCaseDocName.value = 'عقد التوكيل';

  const saveOutcome = await global.saveCase();

  check('setup — case + embedded عمل اداري + embedded مستند all saved locally without error', function () {
    assert.ok(saveOutcome && saveOutcome.success === true, JSON.stringify(saveOutcome));
    assert.strictEqual(tasksModule.tasksRepository.getAll().length, 1);
    assert.strictEqual(docsModule.documentsRepository.getAll().length, 1);
  });

  check('the embedded عمل اداري record has the correct رقم_القضية (repository layer is not where this bug lives)', function () {
    assert.strictEqual(tasksModule.tasksRepository.getAll()[0]['رقم_القضية'], 'C-2026-808');
  });

  check('ApiService.syncRow(\'الأعمال الإدارية\', ...) must be called for the embedded عمل اداري, same as standalone saveTask()', function () {
    const wasSynced = syncRowCalls.some(function (c) { return c.sheetName === 'الأعمال الإدارية' && c.record && c.record['رقم_القضية'] === 'C-2026-808'; });
    assert.ok(wasSynced, 'the embedded عمل اداري was created locally but ApiService.syncRow was never called for it');
  });

  check('the embedded مستند record has the correct رقم_القضية (repository layer is not where this bug lives)', function () {
    assert.strictEqual(docsModule.documentsRepository.getAll()[0]['رقم_القضية'], 'C-2026-808');
  });

  check('ApiService.syncRow(\'المستندات\', ...) must be called for the embedded مستند, same as standalone saveDocument()', function () {
    const wasSynced = syncRowCalls.some(function (c) { return c.sheetName === 'المستندات' && c.record && c.record['رقم_القضية'] === 'C-2026-808'; });
    assert.ok(wasSynced, 'the embedded مستند was created locally but ApiService.syncRow was never called for it');
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
