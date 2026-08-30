/**
 * js/modules/financial-reports-ui.js
 * PHASE 12 — FINANCIAL REPORTS UI.
 *
 * Pure rendering layer over js/modules/financial-reports.js's existing,
 * already-tested functions (getTodayCollections, getMonthCollections,
 * getYearCollections + their expense counterparts, getOfficeNet,
 * getOfficeExpenseBreakdown, getCaseFinancialRanking,
 * getClientFinancialRanking). Every one of these had NO UI consumer
 * before this file (PHASE 7 §10/§21 "dead code" finding) — this is
 * that consumer. No new data source, no new computation duplicated
 * here beyond simple sort/limit on the ranking arrays.
 */
'use strict';

var _reportsActiveTab = 'today';
var _reportsCaseSortBy = 'collected';
var _reportsClientSortBy = 'collected';

/** openFinancialReports() — opens #modalFinancialReports on the default (اليوم) tab. */
function openFinancialReports() {
  var modal = document.getElementById('modalFinancialReports');
  if (modal && modal.classList) modal.classList.add('open');
  switchFinancialReportTab('today');
}

/**
 * switchFinancialReportTab(tabId) — same show/hide-pane + toggle-active-
 * button pattern already used by switchSettingsTab()/switchCaseFormTab()
 * (js/modules/settings.js) — reused here, not reinvented.
 * @param {'today'|'month'|'year'|'cases'|'clients'|'office'} tabId
 */
function switchFinancialReportTab(tabId) {
  _reportsActiveTab = tabId;

  var panes = document.querySelectorAll('.financial-report-pane');
  for (var i = 0; i < panes.length; i++) panes[i].style.display = 'none';
  var pane = document.getElementById('reportPane-' + tabId);
  if (pane) pane.style.display = '';

  var btns = document.querySelectorAll('#financialReportsTabs .tab-btn');
  for (var j = 0; j < btns.length; j++) {
    btns[j].classList.toggle('active', btns[j].getAttribute('data-report-tab') === tabId);
  }

  if (tabId === 'today') renderReportPeriod('today');
  else if (tabId === 'month') renderReportPeriod('month');
  else if (tabId === 'year') renderReportPeriod('year');
  else if (tabId === 'cases') renderReportCases(_reportsCaseSortBy);
  else if (tabId === 'clients') renderReportClients(_reportsClientSortBy);
  else if (tabId === 'office') renderReportOffice();
}

function _fmt(n) { return (n || 0).toLocaleString('ar-EG') + ' ج.م'; }

/**
 * renderReportPeriod('today'|'month'|'year') — collections/expenses/net
 * (+ agreed/collected/remaining for month/year, per PHASE 12's spec —
 * "اليوم" only asks for collections/expenses/net + counts, not agreed/
 * remaining, since a single day's agreed-fee total isn't a meaningful
 * figure).
 */
function renderReportPeriod(period) {
  var container = document.getElementById('reportPane-' + period);
  if (!container) return;

  var collections, expenses;
  if (period === 'today') { collections = getTodayCollections(); expenses = getTodayExpenses(); }
  else if (period === 'month') { collections = getMonthCollections(); expenses = getMonthExpenses(); }
  else { collections = getYearCollections(); expenses = getYearExpenses(); }

  var net = collections - expenses;
  var officeNet = (typeof getOfficeNet === 'function') ? getOfficeNet() : { agreedTotal: 0, collected: 0, remaining: 0 };

  var rows = [
    ['إجمالي التحصيلات', _fmt(collections), '#1ab46c'],
    ['إجمالي المصروفات', _fmt(expenses), '#c0392b'],
    ['صافي الفترة', _fmt(net), net >= 0 ? '#1ab46c' : '#c0392b']
  ];
  if (period !== 'today') {
    rows.push(['الأتعاب المتفق عليها (إجمالي المكتب)', _fmt(officeNet.agreedTotal), '#333']);
    rows.push(['إجمالي المحصَّل (إجمالي المكتب)', _fmt(officeNet.collected), '#1ab46c']);
    rows.push(['إجمالي المتبقي (إجمالي المكتب)', _fmt((typeof getTotalOutstanding === 'function') ? getTotalOutstanding() : 0), '#c0392b']);
  }

  container.innerHTML = '<div class="hsm-table-scroll"><table style="width:100%;min-width:320px;font-size:13px;border-collapse:collapse;">' +
    rows.map(function (r) {
      return '<tr><td style="padding:8px 10px;border:1px solid #e8e0d0;">' + r[0] + '</td>' +
        '<td style="padding:8px 10px;border:1px solid #e8e0d0;font-weight:700;color:' + r[2] + ';">' + r[1] + '</td></tr>';
    }).join('') + '</table></div>';
}

/**
 * renderReportCases(sortBy) — table from getCaseFinancialRanking()
 * (single-pass aggregation — see that function's own header for why
 * this is NOT getCaseNet() called in a loop).
 * @param {'collected'|'remaining'|'expenses'|'netCash'} sortBy
 */
function renderReportCases(sortBy) {
  _reportsCaseSortBy = sortBy;
  var container = document.getElementById('reportPane-cases');
  if (!container || typeof getCaseFinancialRanking !== 'function') return;

  var rows = getCaseFinancialRanking().slice().sort(function (a, b) { return b[sortBy] - a[sortBy]; });

  var sortButtons = ['collected', 'remaining', 'expenses', 'netCash'].map(function (key) {
    var labels = { collected: 'المحصَّل', remaining: 'المتبقي', expenses: 'المصروفات', netCash: 'الصافي' };
    return '<button class="btn btn-sm ' + (sortBy === key ? 'btn-primary' : 'btn-ghost') + '" onclick="renderReportCases(\'' + key + '\')">ترتيب حسب ' + labels[key] + '</button>';
  }).join(' ');

  var table = '<div class="hsm-table-scroll"><table style="width:100%;min-width:640px;font-size:12px;border-collapse:collapse;">' +
    '<tr style="background:#f5f0e6;"><th style="padding:7px 10px;border:1px solid #e8e0d0;">القضية</th>' +
      '<th style="padding:7px 10px;border:1px solid #e8e0d0;">المتفق عليه</th>' +
      '<th style="padding:7px 10px;border:1px solid #e8e0d0;">المحصَّل</th>' +
      '<th style="padding:7px 10px;border:1px solid #e8e0d0;">المتبقي</th>' +
      '<th style="padding:7px 10px;border:1px solid #e8e0d0;">المصروفات</th>' +
      '<th style="padding:7px 10px;border:1px solid #e8e0d0;">الصافي</th>' +
      '<th style="padding:7px 10px;border:1px solid #e8e0d0;"></th></tr>';

  rows.forEach(function (r) {
    var caseObj = (typeof data !== 'undefined' && data.cases ? data.cases : []).filter(function (c) { return c['رقم_القضية'] === r.caseNum; })[0];
    var caseIdx = (caseObj && typeof resolveCaseIndex === 'function') ? resolveCaseIndex(data.cases, caseObj) : -1;
    table += '<tr>' +
      '<td style="padding:7px 10px;border:1px solid #e8e0d0;">' + escapeHtml(r.caseNum) + '</td>' +
      '<td style="padding:7px 10px;border:1px solid #e8e0d0;">' + r.agreed.toLocaleString('ar-EG') + '</td>' +
      '<td style="padding:7px 10px;border:1px solid #e8e0d0;color:#1ab46c;font-weight:700;">' + r.collected.toLocaleString('ar-EG') + '</td>' +
      '<td style="padding:7px 10px;border:1px solid #e8e0d0;color:' + (r.remaining > 0 ? '#c0392b' : '#1ab46c') + ';">' + r.remaining.toLocaleString('ar-EG') + '</td>' +
      '<td style="padding:7px 10px;border:1px solid #e8e0d0;color:#c0392b;">' + r.expenses.toLocaleString('ar-EG') + '</td>' +
      '<td style="padding:7px 10px;border:1px solid #e8e0d0;font-weight:900;">' + r.netCash.toLocaleString('ar-EG') + '</td>' +
      '<td style="padding:7px 10px;border:1px solid #e8e0d0;">' +
        (caseIdx > -1 ? '<button class="btn btn-ghost btn-sm" onclick="viewCase(' + caseIdx + ')">&#128065;</button> ' : '') +
        '<button class="btn btn-ghost btn-sm" onclick="openLedger(\'case\',\'' + escapeHtml(r.caseNum) + '\')">&#128179;</button>' +
      '</td></tr>';
  });
  table += '</table></div>';

  container.innerHTML = '<div style="margin-bottom:8px;">' + sortButtons + '</div>' + table;
}

/**
 * renderReportClients(sortBy) — same pattern, from
 * getClientFinancialRanking().
 * @param {'collected'|'remaining'|'expenses'|'netCash'} sortBy
 */
function renderReportClients(sortBy) {
  _reportsClientSortBy = sortBy;
  var container = document.getElementById('reportPane-clients');
  if (!container || typeof getClientFinancialRanking !== 'function') return;

  var rows = getClientFinancialRanking().slice().sort(function (a, b) { return b[sortBy] - a[sortBy]; });

  var sortButtons = ['collected', 'remaining', 'expenses', 'netCash'].map(function (key) {
    var labels = { collected: 'المحصَّل', remaining: 'المتبقي', expenses: 'المصروفات', netCash: 'الصافي' };
    return '<button class="btn btn-sm ' + (sortBy === key ? 'btn-primary' : 'btn-ghost') + '" onclick="renderReportClients(\'' + key + '\')">ترتيب حسب ' + labels[key] + '</button>';
  }).join(' ');

  var table = '<div class="hsm-table-scroll"><table style="width:100%;min-width:640px;font-size:12px;border-collapse:collapse;">' +
    '<tr style="background:#f5f0e6;"><th style="padding:7px 10px;border:1px solid #e8e0d0;">الموكل</th>' +
      '<th style="padding:7px 10px;border:1px solid #e8e0d0;">المتفق عليه</th>' +
      '<th style="padding:7px 10px;border:1px solid #e8e0d0;">المحصَّل</th>' +
      '<th style="padding:7px 10px;border:1px solid #e8e0d0;">المتبقي</th>' +
      '<th style="padding:7px 10px;border:1px solid #e8e0d0;">المصروفات</th>' +
      '<th style="padding:7px 10px;border:1px solid #e8e0d0;">الصافي</th>' +
      '<th style="padding:7px 10px;border:1px solid #e8e0d0;"></th></tr>';

  rows.forEach(function (r) {
    var clientObj = (typeof data !== 'undefined' && data.clients ? data.clients : []).filter(function (c) { return c['رقم_الموكل'] === r.clientId; })[0];
    var clientName = clientObj ? (clientObj['الاسم'] || r.clientId) : r.clientId;
    var clientIdx = (clientObj && typeof resolveClientIndex === 'function') ? resolveClientIndex(data.clients, clientObj) : -1;
    table += '<tr>' +
      '<td style="padding:7px 10px;border:1px solid #e8e0d0;">' + escapeHtml(clientName) + '</td>' +
      '<td style="padding:7px 10px;border:1px solid #e8e0d0;">' + r.agreed.toLocaleString('ar-EG') + '</td>' +
      '<td style="padding:7px 10px;border:1px solid #e8e0d0;color:#1ab46c;font-weight:700;">' + r.collected.toLocaleString('ar-EG') + '</td>' +
      '<td style="padding:7px 10px;border:1px solid #e8e0d0;color:' + (r.remaining > 0 ? '#c0392b' : '#1ab46c') + ';">' + r.remaining.toLocaleString('ar-EG') + '</td>' +
      '<td style="padding:7px 10px;border:1px solid #e8e0d0;color:#c0392b;">' + r.expenses.toLocaleString('ar-EG') + '</td>' +
      '<td style="padding:7px 10px;border:1px solid #e8e0d0;font-weight:900;">' + r.netCash.toLocaleString('ar-EG') + '</td>' +
      '<td style="padding:7px 10px;border:1px solid #e8e0d0;">' +
        (clientIdx > -1 ? '<button class="btn btn-ghost btn-sm" onclick="viewClient(' + clientIdx + ')">&#128065;</button> ' : '') +
        '<button class="btn btn-ghost btn-sm" onclick="openLedger(\'client\',\'' + escapeHtml(r.clientId) + '\')">&#128179;</button>' +
      '</td></tr>';
  });
  table += '</table></div>';

  container.innerHTML = '<div style="margin-bottom:8px;">' + sortButtons + '</div>' + table;
}

/**
 * renderReportOffice() — office-wide figures, with the three expense
 * scopes shown SEPARATELY (PHASE 7 §11/§13 finding: getOfficeNet()
 * alone gives one lump expense figure — this is the fix, additive).
 */
function renderReportOffice() {
  var container = document.getElementById('reportPane-office');
  if (!container || typeof getOfficeNet !== 'function') return;

  var officeNet = getOfficeNet();
  var breakdown = (typeof getOfficeExpenseBreakdown === 'function') ? getOfficeExpenseBreakdown() : { officeExpenses: 0, caseExpenses: 0, clientExpenses: 0, total: officeNet.totalExpenses };

  var rows = [
    ['مصروفات المكتب', _fmt(breakdown.officeExpenses), '#c0392b'],
    ['مصروفات القضايا', _fmt(breakdown.caseExpenses), '#c0392b'],
    ['مصروفات الموكلين', _fmt(breakdown.clientExpenses), '#c0392b'],
    ['إجمالي المصروفات', _fmt(breakdown.total), '#c0392b'],
    ['إجمالي التحصيل', _fmt(officeNet.collected), '#1ab46c'],
    ['صافي النقد', _fmt(officeNet.net), officeNet.net >= 0 ? '#1ab46c' : '#c0392b']
  ];

  container.innerHTML = '<div class="hsm-table-scroll"><table style="width:100%;min-width:320px;font-size:13px;border-collapse:collapse;">' +
    rows.map(function (r) {
      return '<tr><td style="padding:8px 10px;border:1px solid #e8e0d0;">' + r[0] + '</td>' +
        '<td style="padding:8px 10px;border:1px solid #e8e0d0;font-weight:700;color:' + r[2] + ';">' + r[1] + '</td></tr>';
    }).join('') + '</table></div>';
}

// ================================================================
// Node/test export
// ================================================================
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    openFinancialReports: openFinancialReports,
    switchFinancialReportTab: switchFinancialReportTab,
    renderReportPeriod: renderReportPeriod,
    renderReportCases: renderReportCases,
    renderReportClients: renderReportClients,
    renderReportOffice: renderReportOffice
  };
}
if (typeof window !== 'undefined') {
  window.openFinancialReports = openFinancialReports;
  window.switchFinancialReportTab = switchFinancialReportTab;
  window.renderReportPeriod = renderReportPeriod;
  window.renderReportCases = renderReportCases;
  window.renderReportClients = renderReportClients;
  window.renderReportOffice = renderReportOffice;
}
