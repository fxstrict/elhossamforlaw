/**
 * verify_embedded_adminwork_case_editview.js
 * PROBLEM 11 (Case Save Cycle audit, v80) — Regression test.
 *
 * ROOT CAUSE (same defect family as Problem 4/Root-Cause-B in
 * process-server-works.js, NOT yet applied here):
 *   editTask(i) (js/modules/tasks.js) calls, in order:
 *     fillForm(...) -> syncTaskClientSelectorFromRecord(record)
 *                    -> syncTaskCaseSelectorFromRecord(record)
 *   The last of those does `sel.value = record['رقم_القضية']` on the
 *   #fTaskCaseNum <select> — but that <select>'s <option> list is ONLY
 *   ever (re)built by populateTaskCaseDropdown(clientName), which is
 *   called from selectTaskClient()/removeTaskClient()/
 *   resetTaskClientSelector() only — NEVER from editTask()'s own path.
 *   Opening an existing embedded Administrative Work record therefore
 *   sets .value to a case number with no matching <option> yet, so —
 *   exactly like a real <select> — the field renders empty/unselected
 *   even though the record's own رقم_القضية is correct, and re-picking
 *   it directly is rejected (no matching <option>). Manually clearing
 *   and re-picking the client (which DOES call populateTaskCaseDropdown)
 *   is what "unstuck" it in the reported reproduction — matching the
 *   report exactly.
 *
 *   process-server-works.js's syncPswCaseSelectorFromRecord() was
 *   already fixed for this exact defect (calls populatePswCaseDropdown
 *   before setting .value) — this test proves tasks.js's twin function
 *   was never given the same fix.
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
    value: '',
    textContent: '',
    innerHTML: '',
    tagName: tagName || 'INPUT',
    options: [],
    style: { display: '' },
    disabled: false,
    classList: {
      _classes: {},
      add: function (c) { this._classes[c] = true; },
      remove: function (c) { delete this._classes[c]; },
      contains: function (c) { return !!this._classes[c]; }
    },
    children: [],
    querySelectorAll: function () { return []; },
    appendChild: function () {},
    setAttribute: function (name, val) { this['_attr_' + name] = val; },
    getAttribute: function (name) { return this['_attr_' + name] !== undefined ? this['_attr_' + name] : null; }
  };
}

// Faithful <select> fake: setting .value to something with no matching
// <option> resets to '' (selectedIndex -1), exactly like a real browser
// <select> — the only way Root Cause B is provable rather than trivially
// true (see verify_embedded_psw_portal_and_editview.js, same technique).
function makeFakeSelectElement() {
  var el = makeFakeElement('SELECT');
  var _value = '';
  el.options = [];
  el.selectedIndex = -1;
  Object.defineProperty(el, 'value', {
    get: function () { return _value; },
    set: function (v) {
      var idx = el.options.findIndex(function (o) { return o.value === v; });
      if (idx === -1) { _value = ''; el.selectedIndex = -1; }
      else { _value = v; el.selectedIndex = idx; }
    }
  });
  Object.defineProperty(el, 'innerHTML', {
    get: function () { return el._innerHTML || ''; },
    set: function (html) {
      el._innerHTML = html;
      var placeholderMatch = /<option value="([^"]*)">/.exec(html || '');
      el.options = placeholderMatch ? [{ value: placeholderMatch[1], selected: false }] : [];
      _value = el.options.length ? el.options[0].value : '';
      el.selectedIndex = el.options.length ? 0 : -1;
    }
  });
  el.appendChild = function (opt) { el.options.push(opt); };
  return el;
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

  const REAL_FIELDS = loadRealConfigObject('FIELDS');
  const REAL_MAP = loadRealConfigObject('MAP');

  ['fCaseNum', 'fCaseTitle', 'fCaseClient', 'fCaseDocketNum', 'fCaseClients',
    'fCaseTaskTitle', 'fCaseTaskDeadline', 'fCaseTaskLocation', 'fCaseTaskRequired', 'fCaseTaskNotes',
    'fTaskCompletionReason', 'fTaskReopenReason'
  ].forEach(function (id) { fakeElements[id] = makeFakeElement(); });
  fakeElements.fTaskCaseNum = makeFakeSelectElement();
  fakeElements.fTaskCaseTitle = makeFakeElement();
  fakeElements.fTaskClientId = makeFakeElement();
  fakeElements.fTaskClientNameHidden = makeFakeElement();
  fakeElements.taskClientSelectorChips = makeFakeElement();
  fakeElements.taskClientSelectorPanel = makeFakeElement();
  fakeElements.modalTask = makeFakeElement();
  fakeElements.modalTaskTitle = makeFakeElement();
  fakeElements.taskLastCompletionInfo = makeFakeElement();
  fakeElements.taskLastCompletionWhen = makeFakeElement();
  fakeElements.taskLastCompletionReasonRow = makeFakeElement();
  fakeElements.taskLastCompletionReasonText = makeFakeElement();
  fakeElements.taskLastReopenInfo = makeFakeElement();
  fakeElements.taskLastReopenWhen = makeFakeElement();
  fakeElements.taskLastReopenReasonRow = makeFakeElement();
  fakeElements.taskLastReopenReasonText = makeFakeElement();

  const sandboxGlobals = {
    indexedDB: fakeIndexedDB,
    data: {
      cases: [], clients: [{ 'رقم_الموكل': 'CL-9', 'الاسم': 'منى إبراهيم' }],
      tasks: []
    },
    editIdx: { cases: -1, tasks: -1 },
    FIELDS: REAL_FIELDS,
    MAP: REAL_MAP,
    document: {
      getElementById: function (id) {
        if (!fakeElements[id]) fakeElements[id] = makeFakeElement();
        return fakeElements[id];
      },
      createElement: function (tag) { return tag === 'select' ? makeFakeSelectElement() : makeFakeElement(tag); },
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
    CLIENTS_ID_FIELD: 'رقم_الموكل',
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
  const tasksModule = loadModule(path.join(modulesDir, 'tasks.js'));

  await casesModule.ensureCasesRepositoryReady();
  await tasksModule.ensureTasksRepositoryReady();

  // ================================================================
  // Create an embedded Administrative Work from inside a Case
  // ================================================================
  fakeElements.fCaseNum.value = 'C-2026-777';
  fakeElements.fCaseTitle.value = 'قضية اختبار الأعمال الإدارية';
  fakeElements.fCaseClient.value = 'منى إبراهيم';
  fakeElements.fCaseClients.value = JSON.stringify(['CL-9']);
  fakeElements.fCaseTaskTitle.value = 'استخراج صورة رسمية';
  fakeElements.fCaseTaskLocation.value = 'محكمة الأسرة';

  const saveOutcome = await global.saveCase();

  check('precondition — case + embedded Administrative Work both saved locally without error', function () {
    assert.ok(saveOutcome && saveOutcome.success === true, 'case save failed: ' + JSON.stringify(saveOutcome));
    assert.strictEqual(tasksModule.tasksRepository.getAll().length, 1, 'expected exactly 1 عمل إداري created by the embedded tab');
  });

  const embeddedTask = tasksModule.tasksRepository.getAll()[0];
  check('the embedded record itself has correct رقم_الموكل, اسم_الموكل AND رقم_القضية', function () {
    assert.strictEqual(embeddedTask['رقم_الموكل'], 'CL-9');
    assert.strictEqual(embeddedTask['اسم_الموكل'], 'منى إبراهيم');
    assert.strictEqual(embeddedTask['رقم_القضية'], 'C-2026-777');
  });

  // Mirror into data.tasks the way the app does via syncTasksMirror()
  // (already exercised inside _createEmbeddedAdminWorkIfFilled above),
  // then reopen it exactly like the Administrative Work screen does.
  const mirrorIdx = global.data.tasks.findIndex(function (r) { return r['رقم_القضية'] === 'C-2026-777'; });
  assert.ok(mirrorIdx !== -1, 'setup — embedded Administrative Work record must be present in the data.tasks mirror');

  tasksModule.editTask(mirrorIdx);

  check('client name IS shown when reopening the embedded record (matches "اسم الموكل يظهر" in the report)', function () {
    assert.strictEqual(fakeElements.fTaskClientNameHidden.value, 'منى إبراهيم');
  });

  check('ROOT CAUSE — رقم القضية must ALSO be shown/selected in #fTaskCaseNum when reopening the embedded record without any extra user action (matches "رقم القضية لا يظهر" / needing to clear-and-re-pick the client in the report)', function () {
    assert.strictEqual(
      fakeElements.fTaskCaseNum.value,
      'C-2026-777',
      'the case dropdown shows "' + fakeElements.fTaskCaseNum.value + '" instead of the record\'s actual case — its <option> list was never (re)populated for this client before its value was set'
    );
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
