/**
 * verify_embedded_portal_visibility_case_tabs.js
 * PROBLEM 12 (Case Save Cycle audit, v80) — Regression test.
 *
 * ROOT CAUSE (three occurrences of the same gap, proven against real
 * production code, not simulated):
 *   The Client Portal visibility field already exists in the data
 *   model and is already exposed as a control in every STANDALONE
 *   record screen:
 *     - #modalTask       -> #fTaskPortalVisible       -> 'ظاهر_للموكل'      (لا/نعم)
 *     - #modalDocument   -> #fDocPortalVisible         -> 'ظاهر_للموكل'      (لا/نعم)
 *     - standalone PSW   -> #fPswPortalVisibility      -> 'ظهور_في_بوابة_الموكل' (tri-state)
 *
 *   But the EMBEDDED tabs inside the Case-add modal (عمل اداري /
 *   محضرين / مستندات) never had an equivalent control, and
 *   _createEmbeddedAdminWorkIfFilled() / _createEmbeddedPswIfFilled() /
 *   _createEmbeddedDocumentIfFilled() never read/wrote the field —
 *   forcing the reported "حفظ القضية -> فتح السجل مستقلاً -> تعديل
 *   الظهور -> حفظ مرة أخرى" round trip.
 *
 * This test loads the REAL cases.js + tasks.js + process-server-works.js
 * + documents.js, fills all three embedded tabs (including the new
 * portal-visibility controls) during ONE case save, and proves the
 * chosen value reaches each created record AND is respected by the
 * REAL Config/05_Portal.gs / Config/01_Database.gs filtering logic
 * (extracted from the actual .gs source, not reimplemented by hand).
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
    options: [{ value: '' }],
    selectedIndex: 0,
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

// A <select> fake whose `.options[0].value` is honored by
// `.selectedIndex = 0` resets (mirrors js/print-utils.js's own
// resetForm() convention: `el.options[0] ? el.options[0].value : ''`),
// and lets the test pick a specific option by assigning `.value`
// directly (used the same way real UI code does when the user picks
// from a <select>).
function makeFakeVisibilitySelect(optionValues) {
  var el = makeFakeElement('SELECT');
  el.options = optionValues.map(function (v) { return { value: v }; });
  var _index = 0;
  Object.defineProperty(el, 'value', {
    get: function () { return el.options[_index] ? el.options[_index].value : ''; },
    set: function (v) { var idx = optionValues.indexOf(v); _index = idx === -1 ? 0 : idx; }
  });
  Object.defineProperty(el, 'selectedIndex', {
    // kept in sync with .value both ways, exactly like a real <select> —
    // production cleanup code does `el.selectedIndex = 0` to reset back
    // to the first <option> (the safe default) after a successful save.
    get: function () { return _index; },
    set: function (i) { _index = i; }
  });
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

// Extracts the REAL toBoolFlag() from Config/01_Database.gs (used by
// Config/05_Portal.gs for التاسكس/documents visibility) instead of
// reimplementing it by hand.
function loadRealToBoolFlag() {
  const gas = fs.readFileSync(path.join(ROOT, 'Config', '01_Database.gs'), 'utf8');
  const m = gas.match(/function toBoolFlag\(raw, fallback\) \{([\s\S]*?)\n\}/);
  if (!m) throw new Error('Could not locate toBoolFlag() in Config/01_Database.gs — re-verify this test');
  return new Function('raw', 'fallback', m[1]); // eslint-disable-line no-new-func
}

// Extracts the REAL PSW visibility filter body from Config/05_Portal.gs
// (same technique already used by verify_embedded_psw_portal_and_editview.js).
function loadRealPortalPswFilter() {
  const gas = fs.readFileSync(path.join(ROOT, 'Config', '05_Portal.gs'), 'utf8');
  const m = gas.match(
    /const processServerWorks = allProcessServerWorks\s*\n\s*\.filter\(function \(w\) \{\s*\n\s*const byClient = (.+?);\s*\n\s*const byCase = (.+?);\s*\n\s*const visibility = (.+?);\s*\n\s*return (.+?);\s*\n\s*\}\)/
  );
  if (!m) throw new Error('Could not locate the processServerWorks filter in Config/05_Portal.gs — re-verify this test');
  var body = 'const byClient = ' + m[1] + '; const byCase = ' + m[2] + '; const visibility = ' + m[3] + '; return ' + m[4] + ';';
  return new Function('w', 'clientId', 'caseNum', body); // eslint-disable-line no-new-func
}

function loadRealPortalDefaults() {
  const gas = fs.readFileSync(path.join(ROOT, 'Config', '00_Config.gs'), 'utf8');
  const docsM = gas.match(/const PORTAL_DOCUMENTS_DEFAULT_VISIBLE\s*=\s*(true|false)/);
  const tasksM = gas.match(/const PORTAL_TASKS_DEFAULT_VISIBLE\s*=\s*(true|false)/);
  if (!docsM || !tasksM) throw new Error('Could not locate PORTAL_*_DEFAULT_VISIBLE in Config/00_Config.gs — re-verify this test');
  return { docs: docsM[1] === 'true', tasks: tasksM[1] === 'true' };
}

async function main() {
  const fakeIndexedDB = new FakeIndexedDB();
  const fakeElements = {};
  const syncRowCalls = [];

  const REAL_FIELDS = loadRealConfigObject('FIELDS');
  const REAL_MAP = loadRealConfigObject('MAP');
  const toBoolFlag = loadRealToBoolFlag();
  const portalPswMatches = loadRealPortalPswFilter();
  const portalDefaults = loadRealPortalDefaults();

  // ---- verify the new embedded controls actually exist in index.html ----
  const indexHtmlSrc = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  check('index.html — embedded Administrative Work tab has a Portal-visibility control (#fCaseTaskPortalVisible)', function () {
    assert.ok(/id="fCaseTaskPortalVisible"/.test(indexHtmlSrc), 'no #fCaseTaskPortalVisible control found inside the case-form عمل اداري tab');
  });
  check('index.html — embedded Process Server Work tab has a Portal-visibility control (#fCasePswPortalVisibility)', function () {
    assert.ok(/id="fCasePswPortalVisibility"/.test(indexHtmlSrc), 'no #fCasePswPortalVisibility control found inside the case-form محضرين tab');
  });
  check('index.html — embedded Documents tab has a Portal-visibility control (#fCaseDocPortalVisible)', function () {
    assert.ok(/id="fCaseDocPortalVisible"/.test(indexHtmlSrc), 'no #fCaseDocPortalVisible control found inside the case-form مستندات tab');
  });

  ['fCaseNum', 'fCaseTitle', 'fCaseClient', 'fCaseDocketNum', 'fCaseClients',
    'fCaseTaskTitle', 'fCaseTaskDeadline', 'fCaseTaskLocation', 'fCaseTaskRequired', 'fCaseTaskNotes',
    'fCasePswNature', 'fCasePswNumber', 'fCasePswCourt', 'fCasePswOffice',
    'fCasePswDeliveryDate', 'fCasePswReceiptDate', 'fCasePswSessionDate', 'fCasePswNotes',
    'fCaseDocName', 'fCaseDocDriveUrl', 'fCaseDocNotes',
    'fTaskCompletionReason', 'fTaskReopenReason'
  ].forEach(function (id) { fakeElements[id] = makeFakeElement(); });
  fakeElements.fCaseDocType = makeFakeVisibilitySelect(['عقد زواج']);
  fakeElements.fTaskCaseNum = makeFakeVisibilitySelect(['']);
  fakeElements.fTaskClientId = makeFakeElement();
  fakeElements.fTaskClientNameHidden = makeFakeElement();
  fakeElements.fPswCaseNum = makeFakeVisibilitySelect(['']);
  fakeElements.fPswClientId = makeFakeElement();
  fakeElements.fPswClientNameHidden = makeFakeElement();
  fakeElements.modalTask = makeFakeElement();
  fakeElements.modalTaskTitle = makeFakeElement();
  ['taskLastCompletionInfo', 'taskLastCompletionWhen', 'taskLastCompletionReasonRow', 'taskLastCompletionReasonText',
    'taskLastReopenInfo', 'taskLastReopenWhen', 'taskLastReopenReasonRow', 'taskLastReopenReasonText'
  ].forEach(function (id) { fakeElements[id] = makeFakeElement(); });

  // The three new controls under test — only present when the ROOT
  // CAUSE has actually been fixed in the JS reading them; a missing
  // getElementById() lookup would otherwise silently no-op, so we make
  // them real, distinguishable <select>s the same way the real HTML now
  // renders them.
  fakeElements.fCaseTaskPortalVisible = makeFakeVisibilitySelect(['لا', 'نعم']);
  fakeElements.fCasePswPortalVisibility = makeFakeVisibilitySelect(['مخفي', 'بيانات_فقط', 'بيانات_ومستندات']);
  fakeElements.fCaseDocPortalVisible = makeFakeVisibilitySelect(['لا', 'نعم']);

  const sandboxGlobals = {
    indexedDB: fakeIndexedDB,
    data: {
      cases: [], clients: [{ 'رقم_الموكل': 'CL-42', 'الاسم': 'كريم عادل' }],
      tasks: [], processServerWorks: [], documents: []
    },
    editIdx: { cases: -1, tasks: -1, processServerWorks: -1, documents: -1 },
    FIELDS: REAL_FIELDS,
    MAP: REAL_MAP,
    document: {
      getElementById: function (id) {
        if (!fakeElements[id]) fakeElements[id] = makeFakeElement();
        return fakeElements[id];
      },
      createElement: function (tag) { return tag === 'select' ? makeFakeVisibilitySelect(['']) : makeFakeElement(tag); },
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
    // Used as the fallback inside the extracted processServerWorks
    // filter body (Config/05_Portal.gs references the REAL global
    // constant of the same name, defined in Config/00_Config.gs).
    PORTAL_PSW_DEFAULT_VISIBILITY: 'مخفي',
    console: console
  };
  sandboxGlobals.window = global;
  Object.keys(sandboxGlobals).forEach(function (k) { global[k] = sandboxGlobals[k]; });

  const printUtilsCode = fs.readFileSync(path.join(ROOT, 'js', 'print-utils.js'), 'utf8');
  vm.runInThisContext(printUtilsCode, { filename: path.join(ROOT, 'js', 'print-utils.js') });

  const casesModule = loadModule(path.join(modulesDir, 'cases.js'));
  global.saveCase = casesModule.saveCase;
  const tasksModule = loadModule(path.join(modulesDir, 'tasks.js'));
  global.saveCase = tasksModule.saveCase || global.saveCase; // tasks.js wraps saveCase in place; re-read just in case
  const pswModule = loadModule(path.join(modulesDir, 'process-server-works.js'));
  const documentsModule = loadModule(path.join(modulesDir, 'documents.js'));

  await casesModule.ensureCasesRepositoryReady();
  await tasksModule.ensureTasksRepositoryReady();
  await pswModule.processServerWorksRepository.open();
  await documentsModule.ensureDocumentsRepositoryReady();

  // ================================================================
  // CASE A — everything filled, visibility explicitly set to VISIBLE
  // ================================================================
  fakeElements.fCaseNum.value = 'C-2026-VIS';
  fakeElements.fCaseTitle.value = 'قضية أ — ظاهرة للموكل';
  fakeElements.fCaseClient.value = 'كريم عادل';
  fakeElements.fCaseClients.value = JSON.stringify(['CL-42']);

  fakeElements.fCaseTaskTitle.value = 'استخراج شهادة';
  fakeElements.fCaseTaskPortalVisible.value = 'نعم';

  fakeElements.fCasePswNature.value = 'إعلان بالحضور';
  fakeElements.fCasePswPortalVisibility.value = 'بيانات_فقط';

  fakeElements.fCaseDocName.value = 'عقد الإيجار';
  fakeElements.fCaseDocPortalVisible.value = 'نعم';

  const outcomeA = await global.saveCase();
  check('Case A — case + all 3 embedded records saved without error', function () {
    assert.ok(outcomeA && outcomeA.success === true, 'case A save failed: ' + JSON.stringify(outcomeA));
    assert.strictEqual(tasksModule.tasksRepository.getAll().length, 1);
    assert.strictEqual(pswModule.processServerWorksRepository.getAll().length, 1);
    assert.strictEqual(documentsModule.documentsRepository.getAll().length, 1);
  });

  const taskA = tasksModule.tasksRepository.getAll()[0];
  const pswA = pswModule.processServerWorksRepository.getAll()[0];
  const docA = documentsModule.documentsRepository.getAll()[0];

  check('ROOT CAUSE — Case A embedded Administrative Work record stores the visibility chosen INSIDE the case form ("نعم"), no second save needed', function () {
    assert.strictEqual(taskA['ظاهر_للموكل'], 'نعم');
  });
  check('ROOT CAUSE — Case A embedded PSW record stores the visibility chosen INSIDE the case form ("بيانات_فقط")', function () {
    assert.strictEqual(pswA['ظهور_في_بوابة_الموكل'], 'بيانات_فقط');
  });
  check('ROOT CAUSE — Case A embedded Document record stores the visibility chosen INSIDE the case form ("نعم")', function () {
    assert.strictEqual(docA['ظاهر_للموكل'], 'نعم');
  });

  check('Case A — REAL Config/01_Database.gs toBoolFlag() confirms the Admin Work record IS Portal-visible', function () {
    assert.strictEqual(toBoolFlag(taskA['ظاهر_للموكل'], portalDefaults.tasks), true);
  });
  check('Case A — REAL Config/01_Database.gs toBoolFlag() confirms the Document record IS Portal-visible', function () {
    assert.strictEqual(toBoolFlag(docA['ظاهر_للموكل'], portalDefaults.docs), true);
  });
  check('Case A — REAL Config/05_Portal.gs PSW filter confirms the embedded PSW record IS shown once synced', function () {
    assert.ok(portalPswMatches(pswA, 'CL-42', 'C-2026-VIS'));
  });

  // ================================================================
  // CASE B — everything filled, visibility left at the SAFE DEFAULT
  // (hidden) — must stay hidden without any extra action
  // ================================================================
  fakeElements.fCaseNum.value = 'C-2026-HID';
  fakeElements.fCaseTitle.value = 'قضية ب — مخفية عن الموكل';
  fakeElements.fCaseClient.value = 'كريم عادل';
  fakeElements.fCaseClients.value = JSON.stringify(['CL-42']);

  fakeElements.fCaseTaskTitle.value = 'مهمة أخرى';
  fakeElements.fCaseTaskPortalVisible.selectedIndex = 0; // untouched -> 'لا'

  fakeElements.fCasePswNature.value = 'إعلان آخر';
  fakeElements.fCasePswPortalVisibility.selectedIndex = 0; // untouched -> 'مخفي'

  fakeElements.fCaseDocName.value = 'مستند آخر';
  fakeElements.fCaseDocPortalVisible.selectedIndex = 0; // untouched -> 'لا'

  const outcomeB = await global.saveCase();
  check('Case B — case + all 3 embedded records saved without error', function () {
    assert.ok(outcomeB && outcomeB.success === true, 'case B save failed: ' + JSON.stringify(outcomeB));
  });

  const taskB = tasksModule.tasksRepository.getAll().filter(function (t) { return t['رقم_القضية'] === 'C-2026-HID'; })[0];
  const pswB = pswModule.processServerWorksRepository.getAll().filter(function (w) { return w['رقم_القضية'] === 'C-2026-HID'; })[0];
  const docB = documentsModule.documentsRepository.getAll().filter(function (d) { return d['رقم_القضية'] === 'C-2026-HID'; })[0];

  check('Case B — safe default (لا/مخفي) preserved when the user leaves the new control untouched — no regression on the existing safe default', function () {
    assert.strictEqual(taskB['ظاهر_للموكل'], 'لا');
    assert.strictEqual(pswB['ظهور_في_بوابة_الموكل'], 'مخفي');
    assert.strictEqual(docB['ظاهر_للموكل'], 'لا');
  });

  check('Case B — REAL Config/01_Database.gs toBoolFlag() confirms the Admin Work record is NOT Portal-visible', function () {
    assert.strictEqual(toBoolFlag(taskB['ظاهر_للموكل'], portalDefaults.tasks), false);
  });
  check('Case B — REAL Config/01_Database.gs toBoolFlag() confirms the Document record is NOT Portal-visible', function () {
    assert.strictEqual(toBoolFlag(docB['ظاهر_للموكل'], portalDefaults.docs), false);
  });
  check('Case B — REAL Config/05_Portal.gs PSW filter confirms the embedded PSW record is NOT shown (hidden default respected)', function () {
    assert.strictEqual(portalPswMatches(pswB, 'CL-42', 'C-2026-HID'), false);
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
