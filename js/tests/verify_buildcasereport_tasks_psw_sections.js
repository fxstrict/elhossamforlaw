/**
 * verify_buildcasereport_tasks_psw_sections.js
 * ================================================================
 * CASE_SAVE_CYCLE_FIX_2026 — B2 dedicated coverage. buildCaseReport()
 * (js/modules/cases.js) is a pure function of its arguments (no
 * DOM/data-global reads inside its own body), so this file loads
 * cases.js with the same minimal sandbox verify_cases_repository_
 * integration.js already establishes, then calls buildCaseReport()
 * directly with fixture tasks/psw arrays — no need to drive the full
 * saveCase() wrapper chain just to test the rendering itself (that
 * end-to-end proof — that viewCase()/quickPrintCase() actually filter
 * and PASS tasks/psw into buildCaseReport() correctly — lives in
 * verify_case_save_cycle_full_integration.js, indirectly, via the
 * session/task/PSW repository-state assertions there; this file is the
 * narrow, direct proof of the rendering itself).
 * ================================================================
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const Module = require('module');
const vm = require('vm');
const { FakeIndexedDB } = require(path.join(__dirname, 'fake_indexeddb.js'));

let passed = 0, failed = 0;
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

function makeFakeElement() {
  return { value: '', textContent: '', innerHTML: '', style: { display: '' }, children: [], querySelectorAll: function () { return []; }, appendChild: function () {} };
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

function main() {
  const fakeIndexedDB = new FakeIndexedDB();
  const fakeElements = {};
  setGlobals({
    indexedDB: fakeIndexedDB,
    window: global,
    data: { cases: [], clients: [], sessions: [], documents: [], fees: [] },
    editIdx: { cases: -1 },
    document: {
      getElementById: function (id) { if (!fakeElements[id]) fakeElements[id] = makeFakeElement(); return fakeElements[id]; },
      createElement: function () { return makeFakeElement(); },
      querySelectorAll: function () { return []; }
    },
    escapeHtml: function (s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); },
    toast: function () {},
    formatDate: function (d) { return d || '—'; },
    formatTime: function (t) { return t || '—'; },
    parseLocalDate: function (d) { return d ? new Date(d).getTime() : 0; },
    urgencyBadge: function () { return ''; },
    statusBadge: function () { return ''; },
    collectForm: function () { return {}; },
    fillForm: function () {},
    resetForm: function () {},
    closeModal: function () {},
    updateBadges: function () {},
    saveLocal: function () {},
    ApiService: { syncRow: function () {}, deleteData: function () {} },
    confirm: function () { return true; },
    genClientQR: function () {},
    console: console
  });

  const casesModule = loadModule(path.join(__dirname, '..', 'modules', 'cases.js'));

  const c = { 'رقم_القضية': 'C-1', 'عنوان_القضية': 'قضية اختبار العرض', 'اسم_الموكل': 'موكل تجريبي' };

  const oneTask = [{
    'رقم_القضية': 'C-1', 'العنوان': 'استخراج صورة رسمية', 'الأولوية': 'عاجل',
    'الموعد_النهائي': '2026-10-01', 'الحالة': 'قيد التنفيذ', 'المطلوب': 'التوجه للمحكمة'
  }];
  const onePsw = [{
    'رقم_القضية': 'C-1', 'طبيعة_الاعلان': 'إعلان صحيفة دعوى', 'رقم_المحضرين': 'PSW-1',
    'قلم_المحضرين': 'قلم محضرين المعادي', 'الحالة': 'تم التسليم', 'تاريخ_التسليم': '2026-09-01'
  }];

  check('buildCaseReport(): with NO tasks/psw args at all (old 4-arg call shape) does not throw — backward compatible with any caller that has not been updated', function () {
    assert.doesNotThrow(function () { casesModule.buildCaseReport(c, [], [], []); });
  });

  check('buildCaseReport(): with empty tasks/psw arrays, renders NEITHER the "الأعمال الإدارية" nor the "أعمال المحضرين" section (no empty section clutter)', function () {
    const html = casesModule.buildCaseReport(c, [], [], [], [], []);
    assert.ok(!html.includes('الأعمال الإدارية المرتبطة'), 'must not render an empty admin-work section');
    assert.ok(!html.includes('أعمال المحضرين المرتبطة'), 'must not render an empty PSW section');
  });

  check('B2: buildCaseReport() renders the "الأعمال الإدارية" section, including the task title, when tasks are passed', function () {
    const html = casesModule.buildCaseReport(c, [], [], [], oneTask, []);
    assert.ok(html.includes('الأعمال الإدارية المرتبطة'), 'expected the admin-work section header');
    assert.ok(html.includes('استخراج صورة رسمية'), 'expected the task title in the output');
  });

  check('B2: buildCaseReport() renders the "أعمال المحضرين" section, including the PSW nature/office, when psw records are passed', function () {
    const html = casesModule.buildCaseReport(c, [], [], [], [], onePsw);
    assert.ok(html.includes('أعمال المحضرين المرتبطة'), 'expected the PSW section header');
    assert.ok(html.includes('إعلان صحيفة دعوى'), 'expected the PSW nature in the output');
    assert.ok(html.includes('قلم محضرين المعادي'), 'expected the PSW office in the output');
  });

  check('B2: buildCaseReport() renders BOTH new sections together without either clobbering the other, alongside the pre-existing sections (سجل الجلسات still present)', function () {
    const html = casesModule.buildCaseReport(c, [], [], [], oneTask, onePsw);
    assert.ok(html.includes('الأعمال الإدارية المرتبطة'));
    assert.ok(html.includes('أعمال المحضرين المرتبطة'));
    assert.ok(html.includes('سجل الجلسات'), 'pre-existing sessions section must still be present, unmodified');
  });

  check('B2: buildCaseReport() count shown in the section header matches the number of linked records (e.g. 2 tasks -> "(2)")', function () {
    const twoTasks = oneTask.concat([{ 'رقم_القضية': 'C-1', 'العنوان': 'مهمة ثانية', 'الحالة': 'مكتمل' }]);
    const html = casesModule.buildCaseReport(c, [], [], [], twoTasks, []);
    assert.ok(html.includes('الأعمال الإدارية المرتبطة (2)'), 'expected the section header to show the count 2');
  });

  console.log(log.join('\n'));
  console.log('\n' + passed + ' passed, ' + failed + ' failed.');
  if (failed > 0) process.exit(1);
}

main();
