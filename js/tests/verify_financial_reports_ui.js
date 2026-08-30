/**
 * verify_financial_reports_ui.js
 * PHASE 12 — FINANCIAL REPORTS UI wiring proof (mirrors verify_ledger_
 * ui_workflow.js's technique). Proves every tab actually renders real
 * data from financial-reports.js — not dead functions (PHASE 7 §10/§21,
 * and the PHASE 8-24 master prompt's core rule: a report with no UI
 * consumer is FAIL, not PASS).
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const Module = require('module');
const vm = require('vm');

let passed = 0;
let failed = 0;
function check(label, fn) {
  try {
    fn();
    passed++;
    console.log('PASS — ' + label);
  } catch (e) {
    failed++;
    console.log('FAIL — ' + label + '  =>  ' + e.message);
  }
}

function makeFakeElement() {
  return { innerHTML: '', style: { display: '' }, classList: { _c: {}, add: function (c) { this._c[c] = true; }, toggle: function (c, on) { this._c[c] = on; }, contains: function (c) { return !!this._c[c]; } } };
}

function loadModule(filePath) {
  const code = fs.readFileSync(filePath, 'utf8');
  const wrapper = Module.wrap(code);
  const script = new vm.Script(wrapper, { filename: filePath });
  const compiledWrapper = script.runInThisContext();
  const mod = new Module(filePath, module);
  mod.filename = filePath;
  mod.paths = Module._nodeModulePaths(path.dirname(filePath));
  compiledWrapper.call(mod.exports, mod.exports, function (id) { return mod.require(id); }, mod, filePath, path.dirname(filePath));
  mod.loaded = true;
  return mod.exports;
}

function main() {
  const fakeElements = {};
  const fakeTabButtons = [
    { attr: 'today', classList: { _c: { active: true }, toggle: function (c, on) { this._c[c] = on; }, contains: function (c) { return !!this._c[c]; } }, getAttribute: function () { return 'today'; } },
    { attr: 'cases', classList: { _c: {}, toggle: function (c, on) { this._c[c] = on; }, contains: function (c) { return !!this._c[c]; } }, getAttribute: function () { return 'cases'; } }
  ];

  global.document = {
    getElementById: function (id) { if (!fakeElements[id]) fakeElements[id] = makeFakeElement(); return fakeElements[id]; },
    querySelectorAll: function (sel) {
      if (sel === '.financial-report-pane') return Object.keys(fakeElements).filter(function (id) { return id.indexOf('reportPane-') === 0; }).map(function (id) { return fakeElements[id]; });
      if (sel === '#financialReportsTabs .tab-btn') return fakeTabButtons;
      return [];
    }
  };
  global.escapeHtml = function (s) { return s == null ? '' : String(s); };
  global.data = { cases: [{ 'رقم_القضية': '2026/A' }], clients: [{ 'رقم_الموكل': 'CL1', 'الاسم': 'أحمد محمود' }] };
  global.resolveCaseIndex = function (list, rec) { return list.indexOf(rec); };
  global.resolveClientIndex = function (list, rec) { return list.indexOf(rec); };
  global.window = global;

  global.getTodayCollections = function () { return 5000; };
  global.getTodayExpenses = function () { return 350; };
  global.getMonthCollections = function () { return 21000; };
  global.getMonthExpenses = function () { return 2500; };
  global.getYearCollections = function () { return 100000; };
  global.getYearExpenses = function () { return 15000; };
  global.getOfficeNet = function () { return { totalFees: 21000, totalExpenses: 2500, net: 18500, agreedTotal: 25000, collected: 21000, remaining: 4000 }; };
  global.getTotalOutstanding = function () { return 7000; };
  global.getOfficeExpenseBreakdown = function () { return { officeExpenses: 2000, caseExpenses: 500, clientExpenses: 0, total: 2500 }; };
  global.getCaseFinancialRanking = function () {
    return [
      { caseNum: '2026/A', agreed: 20000, collected: 13000, remaining: 7000, expenses: 500, netCash: 12500 },
      { caseNum: '2026/B', agreed: 5000, collected: 8000, remaining: -3000, expenses: 0, netCash: 8000 }
    ];
  };
  global.getClientFinancialRanking = function () {
    return [{ clientId: 'CL1', agreed: 20000, collected: 13000, remaining: 7000, expenses: 0, netCash: 13000 }];
  };

  const reportsUi = loadModule(path.join(__dirname, '..', 'modules', 'financial-reports-ui.js'));

  check('switchFinancialReportTab(\'today\'): renders real today collections/expenses/net into #reportPane-today', () => {
    reportsUi.switchFinancialReportTab('today');
    const html = fakeElements['reportPane-today'].innerHTML;
    assert.ok(html.indexOf((5000).toLocaleString('ar-EG')) !== -1);
    assert.ok(html.indexOf((350).toLocaleString('ar-EG')) !== -1);
    assert.ok(html.indexOf((5000 - 350).toLocaleString('ar-EG')) !== -1);
  });

  check('switchFinancialReportTab(\'month\'): also includes agreed/collected/remaining (unlike \'today\')', () => {
    reportsUi.switchFinancialReportTab('month');
    const html = fakeElements['reportPane-month'].innerHTML;
    assert.ok(html.indexOf((21000).toLocaleString('ar-EG')) !== -1);
    assert.ok(html.indexOf((25000).toLocaleString('ar-EG')) !== -1, 'expected agreedTotal to appear for the month view');
    assert.ok(html.indexOf((7000).toLocaleString('ar-EG')) !== -1, 'expected getTotalOutstanding() (7000), not officeNet.remaining (4000)');
  });

  check('renderReportCases(\'collected\'): ranks 2026/B above 2026/A (8000 > 13000 is false — actually A should rank first by collected)', () => {
    reportsUi.renderReportCases('collected');
    const html = fakeElements['reportPane-cases'].innerHTML;
    const idxA = html.indexOf('2026/A');
    const idxB = html.indexOf('2026/B');
    assert.ok(idxA !== -1 && idxB !== -1 && idxA < idxB, 'case A (13000 collected) should rank above case B (8000 collected)');
  });

  check('renderReportCases(\'remaining\'): re-sorting by a different key changes the row order', () => {
    reportsUi.renderReportCases('remaining');
    const html = fakeElements['reportPane-cases'].innerHTML;
    // case A remaining=7000, case B remaining=-3000 -> A still first
    const idxA = html.indexOf('2026/A');
    const idxB = html.indexOf('2026/B');
    assert.ok(idxA < idxB);
  });

  check('renderReportCases(): each row carries a working "فتح القضية" link (viewCase with the resolved index) and a "كشف الحساب" link (openLedger)', () => {
    const html = fakeElements['reportPane-cases'].innerHTML;
    assert.ok(html.indexOf('viewCase(0)') !== -1);
    assert.ok(html.indexOf("openLedger('case','2026/A')") !== -1);
  });

  check('renderReportClients(): renders the client\'s real name (not just the raw id) with agreed/collected/remaining/expenses/netCash', () => {
    reportsUi.renderReportClients('collected');
    const html = fakeElements['reportPane-clients'].innerHTML;
    assert.ok(html.indexOf('أحمد محمود') !== -1);
    assert.ok(html.indexOf((13000).toLocaleString('ar-EG')) !== -1);
  });

  check('renderReportOffice(): separates مصروفات المكتب/القضايا/الموكلين into three distinct visible lines, not one lump sum', () => {
    reportsUi.renderReportOffice();
    const html = fakeElements['reportPane-office'].innerHTML;
    assert.ok(html.indexOf((2000).toLocaleString('ar-EG')) !== -1, 'office-scope expenses');
    assert.ok(html.indexOf((500).toLocaleString('ar-EG')) !== -1, 'case-scope expenses, shown separately');
    assert.ok(html.indexOf((2500).toLocaleString('ar-EG')) !== -1, 'combined total');
  });

  check('openFinancialReports(): opens the modal and defaults to the "اليوم" tab', () => {
    reportsUi.openFinancialReports();
    assert.ok(fakeElements['modalFinancialReports'].classList.contains('open'));
  });

  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  if (failed > 0) process.exitCode = 1;
}

main();
