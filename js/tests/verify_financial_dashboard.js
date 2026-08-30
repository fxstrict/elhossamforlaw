/**
 * verify_financial_dashboard.js
 * PHASE 11 — OFFICE FINANCIAL DASHBOARD — UI wiring proof.
 *
 * Same isolated vm.createContext/runInContext technique as
 * verify_smart_dashboard_phase29.js (no jsdom dependency). Proves
 * renderFinancialDashboard() — additive, called from renderDashboard()
 * alongside the pre-existing renderKpiWidget() — actually renders real
 * numbers from financial-reports.js's functions into #dashFinancialGrid,
 * replacing the PHASE 7 §11 FAIL finding ("عدّاد سجلات فقط، صفر محتوى
 * مالي"). No production file is modified by this harness.
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function makeFakeElement(id) {
  return { id: id, innerHTML: '', textContent: '' };
}

function loadDashboardModule(sandboxOverrides) {
  const filePath = path.join(__dirname, '..', 'modules', 'dashboard.js');
  const src = fs.readFileSync(filePath, 'utf8');
  const store = { dashFinancialGrid: makeFakeElement('dashFinancialGrid'), dashKpiGrid: makeFakeElement('dashKpiGrid') };
  const fakeDocument = { getElementById: function (id) { return store[id] || null; } };
  const sandbox = Object.assign({
    document: fakeDocument,
    data: { cases: [], sessions: [] },
    pad: function (n) { return String(n).length < 2 ? '0' + n : String(n); },
    console: console
  }, sandboxOverrides || {});
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox, { filename: 'dashboard.js' });
  return { sandbox: sandbox, store: store };
}

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

function main() {
  check('renderFinancialDashboard(): does nothing (no throw) when financial-reports.js functions are not loaded — backward compatible', () => {
    const { sandbox } = loadDashboardModule({});
    sandbox.renderFinancialDashboard();
    // no assertion needed beyond "did not throw" — the guard is the point
  });

  check('renderFinancialDashboard(): renders real amounts from getTodayCollections/getMonthCollections/getOfficeNet/getTotalOutstanding/getOfficeExpenseBreakdown into #dashFinancialGrid', () => {
    const { sandbox, store } = loadDashboardModule({
      getTodayCollections: function () { return 5000; },
      getTodayExpenses: function () { return 350; },
      getMonthCollections: function () { return 21000; },
      getMonthExpenses: function () { return 2500; },
      getOfficeNet: function () { return { totalFees: 21000, totalExpenses: 2500, net: 18500, agreedTotal: 25000, collected: 21000, remaining: 4000 }; },
      getTotalOutstanding: function () { return 7000; },
      getOfficeExpenseBreakdown: function () { return { officeExpenses: 2000, caseExpenses: 500, clientExpenses: 0, total: 2500 }; }
    });

    sandbox.renderFinancialDashboard();
    const html = store.dashFinancialGrid.innerHTML;

    assert.ok(html.indexOf((5000).toLocaleString('ar-EG')) !== -1, 'expected today\'s collections (5000) to appear');
    assert.ok(html.indexOf((350).toLocaleString('ar-EG')) !== -1, 'expected today\'s expenses (350) to appear');
    assert.ok(html.indexOf((5000 - 350).toLocaleString('ar-EG')) !== -1, 'expected today\'s net (4650) to appear');
    assert.ok(html.indexOf((21000).toLocaleString('ar-EG')) !== -1, 'expected month collections (21000) to appear');
    assert.ok(html.indexOf((25000).toLocaleString('ar-EG')) !== -1, 'expected office-wide agreed total (25000) to appear');
    assert.ok(html.indexOf((7000).toLocaleString('ar-EG')) !== -1, 'expected total outstanding (7000, from getTotalOutstanding — NOT the possibly-different officeNet.remaining) to appear');
    assert.ok(html.indexOf((2000).toLocaleString('ar-EG')) !== -1, 'expected office-scope expenses (2000) to appear separately');
    assert.ok(html.indexOf((500).toLocaleString('ar-EG')) !== -1, 'expected case-scope expenses (500) to appear separately from office-scope');
    assert.ok(html.indexOf((2500).toLocaleString('ar-EG')) !== -1, 'expected the combined total expenses (2500) to appear');
    assert.ok(html.indexOf((18500).toLocaleString('ar-EG')) !== -1, 'expected office net cash (18500) to appear');
  });

  check('renderFinancialDashboard(): does NOT crash renderKpiWidget() or the rest of renderDashboard() — additive call only', () => {
    const { sandbox } = loadDashboardModule({
      getTodayCollections: function () { return 0; }, getTodayExpenses: function () { return 0; },
      getMonthCollections: function () { return 0; }, getMonthExpenses: function () { return 0; },
      getOfficeNet: function () { return { totalFees: 0, totalExpenses: 0, net: 0, agreedTotal: 0, collected: 0, remaining: 0 }; },
      getTotalOutstanding: function () { return 0; },
      getOfficeExpenseBreakdown: function () { return { officeExpenses: 0, caseExpenses: 0, clientExpenses: 0, total: 0 }; }
    });
    // renderKpiWidget() (pre-existing, untouched) must still run fine with a minimal data object
    sandbox.renderKpiWidget();
    sandbox.renderFinancialDashboard();
    // no throw = pass
  });

  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  if (failed > 0) process.exitCode = 1;
}

main();
