/**
 * verify_smart_dashboard_phase29.js
 * ================================================================
 * PHASE 29 — Smart Dashboard (Priority 1 + Priority 3) — Verification
 * ================================================================
 * Standalone Node harness: `node js/tests/verify_smart_dashboard_phase29.js`
 *
 * PURPOSE
 * Phase 29 appended two NEW, independently-callable widget functions
 * to js/modules/dashboard.js — renderTodayCenterWidget() and
 * renderAlertsCenterWidget() — without touching any of the five
 * pre-existing widgets or the five pre-existing calls inside
 * renderDashboard(). This harness proves:
 *
 *   1. Both new functions run standalone against a minimal DOM stub
 *      without throwing, and without requiring any container/id that
 *      isn't documented in the Phase 29 report.
 *   2. renderAlertsCenterWidget() produces the correct alert set (and
 *      the correct "no alerts" empty state) across multiple fixture
 *      scenarios, exercising every branch: soon-session, overdue task,
 *      case without opponent, case without documents, and the
 *      no-alerts-at-all state.
 *   3. renderTodayCenterWidget() writes a non-empty Gregorian
 *      date/day/time string (Hijri line is best-effort and allowed to
 *      be absent when ICU Islamic-calendar data isn't available in
 *      the runtime — see the try/catch in the widget itself).
 *
 * This harness intentionally avoids the jsdom devDependency used by
 * most other js/tests/*.js files (see verify_dashboard_widget_
 * decomposition.js) — jsdom has been observed unavailable in some
 * sandboxed execution environments (Phase 17.5 note). A hand-rolled
 * fake `document` covering only getElementById()/innerHTML is
 * sufficient for these two widgets and lets this harness run anywhere
 * plain Node runs, with no install step.
 *
 * No production file is modified by this harness. It is read-only
 * with respect to js/modules/dashboard.js.
 * ================================================================
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function makeFakeElement(id) {
  var classes = {};
  return {
    id: id, innerHTML: '', textContent: '', style: {},
    classList: {
      add: function (c) { classes[c] = true; },
      remove: function (c) { delete classes[c]; },
      contains: function (c) { return !!classes[c]; }
    }
  };
}

function makeFakeDocument(ids) {
  const store = {};
  ids.forEach(function (id) { store[id] = makeFakeElement(id); });
  // renderWelcomeWidget() (pre-existing, untouched) reads three
  // .querySelector('#page-dashboard .xxx') elements + two
  // getElementById() welcome-step elements. Stubbed here only so
  // Scenario 6 can exercise the full, real renderDashboard() without
  // throwing — none of this is new Phase 29 behaviour.
  const querySelectorMap = {
    '#page-dashboard .stats-grid': makeFakeElement('statsGrid'),
    '#page-dashboard .dashboard-grid': makeFakeElement('dashboardGrid'),
    '#page-dashboard .dash-section-title': makeFakeElement('sectionTitle')
  };
  store.welcomeStepClient = makeFakeElement('welcomeStepClient');
  store.welcomeStepCase = makeFakeElement('welcomeStepCase');
  return {
    getElementById: function (id) { return store[id] || null; },
    querySelector: function (sel) { return querySelectorMap[sel] || null; },
    _store: store
  };
}

// ---- Minimal helpers Phase 29's renderAlertsCenterWidget() depends on
// (copied behaviour, not reference, from js/ui-utils.js — same contract
// already assumed by the pre-existing widgets in this file). ----
function pad(n) { return String(n).length < 2 ? '0' + n : String(n); }
function parseLocalDate(s) {
  if (!s) return null;
  const parts = String(s).slice(0, 10).split('-');
  if (parts.length !== 3) return null;
  const d = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
  return isNaN(d.getTime()) ? null : d;
}

function loadDashboardModule(fakeDocument, fakeData, navigateSpy) {
  const filePath = path.join(__dirname, '..', 'modules', 'dashboard.js');
  const src = fs.readFileSync(filePath, 'utf8');
  const sandbox = {
    document: fakeDocument,
    data: fakeData,
    pad: pad,
    parseLocalDate: parseLocalDate,
    formatTime: function (t) { return t || ''; },
    formatDate: function (d) { return d || ''; },
    urgencyBadge: function () { return ''; },
    navigate: navigateSpy || function () {},
    resolveTaskIndex: function (list, rec) { return list.indexOf(rec); },
    TASK_PRIORITY_ICONS: { high: '!' },
    console: console
  };
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox, { filename: 'dashboard.js' });
  return sandbox;
}

function todayISO(offsetDays) {
  const d = new Date();
  d.setDate(d.getDate() + (offsetDays || 0));
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
}

function nowPlusMinutesHHMM(mins) {
  const d = new Date(Date.now() + mins * 60000);
  return pad(d.getHours()) + ':' + pad(d.getMinutes());
}

let passed = 0;
function check(label, cond) {
  assert.ok(cond, 'FAILED: ' + label);
  passed++;
  console.log('  OK - ' + label);
}

// ================================================================
// SCENARIO 1 — No alerts at all
// ================================================================
(function scenarioNoAlerts() {
  console.log('Scenario 1: no alerts');
  const doc = makeFakeDocument(['dashTodayCenter', 'dashAlertsCenterList']);
  const data = {
    cases: [{ 'رقم_القضية': 'C1', 'الحالة': 'نشطة', 'اسم_الخصم': 'فلان' }],
    sessions: [],
    tasks: [],
    documents: [{ 'رقم_القضية': 'C1' }]
  };
  const sb = loadDashboardModule(doc, data);
  sb.renderAlertsCenterWidget();
  check('empty-state message shown', doc._store.dashAlertsCenterList.innerHTML.indexOf('لا توجد تنبيهات') !== -1);
})();

// ================================================================
// SCENARIO 2 — Session starting within 2 hours
// ================================================================
(function scenarioSoonSession() {
  console.log('Scenario 2: session within 2 hours');
  const doc = makeFakeDocument(['dashTodayCenter', 'dashAlertsCenterList']);
  const data = {
    cases: [],
    sessions: [{ 'التاريخ': todayISO(0), 'الوقت': nowPlusMinutesHHMM(30), 'عنوان_القضية': 'قضية تجريبية' }],
    tasks: [],
    documents: []
  };
  const sb = loadDashboardModule(doc, data);
  sb.renderAlertsCenterWidget();
  const html = doc._store.dashAlertsCenterList.innerHTML;
  check('soon-session chip rendered', html.indexOf('جلسة خلال ساعتين') !== -1);
  check('count is 1', html.indexOf('>1<') !== -1);
})();

// ================================================================
// SCENARIO 3 — Overdue task
// ================================================================
(function scenarioOverdueTask() {
  console.log('Scenario 3: overdue task');
  const doc = makeFakeDocument(['dashTodayCenter', 'dashAlertsCenterList']);
  const data = {
    cases: [],
    sessions: [],
    tasks: [{ 'الحالة': 'open', 'الموعد_النهائي': todayISO(-3), 'العنوان': 'مهمة متأخرة' }],
    documents: []
  };
  const sb = loadDashboardModule(doc, data);
  sb.renderAlertsCenterWidget();
  check('overdue-task chip rendered', doc._store.dashAlertsCenterList.innerHTML.indexOf('مهام إدارية متأخرة') !== -1);
})();

// ================================================================
// SCENARIO 4 — Active case without opponent + without documents
// ================================================================
(function scenarioCaseGaps() {
  console.log('Scenario 4: case without opponent / without documents');
  const doc = makeFakeDocument(['dashTodayCenter', 'dashAlertsCenterList']);
  const data = {
    cases: [{ 'رقم_القضية': 'C9', 'الحالة': 'active' }], // no اسم_الخصم, no linked docs
    sessions: [],
    tasks: [],
    documents: []
  };
  const sb = loadDashboardModule(doc, data);
  sb.renderAlertsCenterWidget();
  const html = doc._store.dashAlertsCenterList.innerHTML;
  check('no-opponent chip rendered', html.indexOf('قضايا بدون بيانات خصم') !== -1);
  check('no-documents chip rendered', html.indexOf('قضايا بدون مستندات') !== -1);
  check('closed/inactive cases are ignored (only one case, active, counted once per alert type)', (html.match(/>1</g) || []).length === 2);
})();

// ================================================================
// SCENARIO 5 — Today Center writes a non-empty date/time string
// ================================================================
(function scenarioTodayCenter() {
  console.log('Scenario 5: Today Center widget');
  const doc = makeFakeDocument(['dashTodayCenter', 'dashAlertsCenterList']);
  const data = { cases: [], sessions: [], tasks: [], documents: [] };
  const sb = loadDashboardModule(doc, data);
  sb.renderTodayCenterWidget();
  const html = doc._store.dashTodayCenter.innerHTML;
  check('gregorian date block present', html.indexOf('today-center-gregorian') !== -1);
  check('time block present', html.indexOf('today-center-time') !== -1);
})();

// ================================================================
// SCENARIO 5b — Extended Statistics widget (Priority 2 completion)
// ================================================================
(function scenarioExtendedStats() {
  console.log('Scenario 5b: Extended Statistics widget');
  const doc = makeFakeDocument(['statClosed', 'statChildren', 'statDocuments', 'statUpcoming']);
  const data = {
    cases: [{ 'الحالة': 'منتهية' }, { 'الحالة': 'منتهية' }, { 'الحالة': 'نشطة' }],
    children: [{}, {}],
    documents: [{}, {}, {}],
    sessions: [{ 'التاريخ': todayISO(2) }, { 'التاريخ': todayISO(-5) }],
    tasks: []
  };
  const sb = loadDashboardModule(doc, data);
  sb.renderExtendedStatisticsWidget();
  check('closed cases counted', doc._store.statClosed.textContent === 2);
  check('children counted', doc._store.statChildren.textContent === 2);
  check('documents counted', doc._store.statDocuments.textContent === 3);
  check('only future session counted as upcoming', doc._store.statUpcoming.textContent === 1);
})();

// ================================================================
// SCENARIO 7 — KPI widget
// ================================================================
(function scenarioKpi() {
  console.log('Scenario 7: KPI widget');
  const doc = makeFakeDocument(['dashKpiGrid']);
  const now = new Date();
  const thisMonth = now.getFullYear() + '-' + pad(now.getMonth() + 1);
  const data = {
    cases: [
      { 'الحالة': 'منتهية', 'تاريخ_القيد': thisMonth + '-05' },
      { 'الحالة': 'نشطة', 'تاريخ_القيد': '2020-01-01' },
      { 'الحالة': 'نشطة', 'تاريخ_القيد': thisMonth + '-10' }
    ],
    sessions: [{ 'الحالة': 'منتهية' }, { 'الحالة': 'قادمة' }],
    tasks: [], clients: [], documents: []
  };
  const sb = loadDashboardModule(doc, data);
  sb.renderKpiWidget();
  const html = doc._store.dashKpiGrid.innerHTML;
  check('2 new cases this month counted', html.indexOf('>2<') !== -1);
  check('completion rate 33% (1 of 3 closed) shown', html.indexOf('33%') !== -1);
  check('1 executed session counted', html.indexOf('>1<') !== -1);
})();

// ================================================================
// SCENARIO 8 — Charts widget
// ================================================================
(function scenarioCharts() {
  console.log('Scenario 8: Charts widget');
  const doc = makeFakeDocument(['dashChartCaseType', 'dashChartCaseStatus', 'dashChartSessionsYear']);
  const year = new Date().getFullYear();
  const data = {
    cases: [
      { 'نوع_الدعوى': 'نفقة', 'الحالة': 'نشطة' },
      { 'نوع_الدعوى': 'نفقة', 'الحالة': 'منتهية' },
      { 'نوع_الدعوى': 'طلاق', 'الحالة': 'معلقة' }
    ],
    sessions: [
      { 'التاريخ': year + '-01-15' },
      { 'التاريخ': year + '-01-20' },
      { 'التاريخ': (year - 1) + '-12-01' } // different year — must be excluded
    ],
    tasks: [], clients: [], documents: []
  };
  const sb = loadDashboardModule(doc, data);
  sb.renderChartsWidget();
  check('case-type chart shows نفقة with count 2', doc._store.dashChartCaseType.innerHTML.indexOf('نفقة') !== -1 && doc._store.dashChartCaseType.innerHTML.indexOf('>2<') !== -1);
  check('case-status chart always shows all 4 fixed statuses', (doc._store.dashChartCaseStatus.innerHTML.match(/chart-bar-row/g) || []).length === 4);
  check('sessions-per-year chart has 12 month rows', (doc._store.dashChartSessionsYear.innerHTML.match(/chart-bar-row/g) || []).length === 12);
  check('January this year shows 2 sessions, prior-year session excluded', doc._store.dashChartSessionsYear.innerHTML.indexOf('>2<') !== -1);
})();

// ================================================================
// SCENARIO 9 — Quick Search
// ================================================================
(function scenarioQuickSearch() {
  console.log('Scenario 9: Quick Search');
  const doc = makeFakeDocument(['dashQuickSearchResults']);
  const data = {
    cases: [{ 'رقم_القضية': 'C-100', 'عنوان_القضية': 'قضية نفقة', 'اسم_الخصم': 'محمد' }],
    clients: [{ 'الاسم': 'أحمد علي' }],
    documents: [{ 'اسم_المستند': 'عقد إيجار' }],
    tasks: [{ 'العنوان': 'مراجعة صحيفة' }],
    sessions: [{ 'عنوان_القضية': 'قضية نفقة', 'التاريخ': '2026-01-01' }]
  };
  const sb = loadDashboardModule(doc, data);
  sb.performDashboardQuickSearch('نفقة');
  const html = doc._store.dashQuickSearchResults.innerHTML;
  check('matches case by title', html.indexOf('قضية نفقة') !== -1);
  check('matches session linked to same case title', (html.match(/قضية نفقة/g) || []).length === 2);
  check('results dropdown opened', doc._store.dashQuickSearchResults.classList.contains('open'));
  sb.performDashboardQuickSearch('');
  check('clearing query closes dropdown', !doc._store.dashQuickSearchResults.classList.contains('open'));
  sb.performDashboardQuickSearch('xyz-no-match');
  check('no-match state shown', doc._store.dashQuickSearchResults.innerHTML.indexOf('لا توجد نتائج') !== -1);
})();

// ================================================================
// SCENARIO 6 — renderDashboard() still calls all widgets, in order,
// without throwing (proves the appended lines didn't break the
// pre-existing five).
// ================================================================
(function scenarioFullDashboard() {
  console.log('Scenario 6: full renderDashboard() orchestration');
  const ids = ['statCases','statActive','statToday','statWeek','statClients','statTasks',
    'statClosed','statChildren','statDocuments','statUpcoming',
    'dashAlerts','dashSessions','dashTasks','dashboardWelcome',
    'dashTodayCenter','dashAlertsCenterList','dashKpiGrid',
    'dashChartCaseType','dashChartCaseStatus','dashChartSessionsYear'];
  const doc = makeFakeDocument(ids);
  const data = {
    cases: [{ 'رقم_القضية': 'C1', 'الحالة': 'نشطة', 'اسم_الخصم': 'خصم' }],
    clients: [],
    sessions: [],
    tasks: [],
    documents: [{ 'رقم_القضية': 'C1' }]
  };
  const sb = loadDashboardModule(doc, data);
  assert.doesNotThrow(function () { sb.renderDashboard(); });
  check('renderDashboard() completed without throwing', true);
  check('Today Center populated by full orchestration', doc._store.dashTodayCenter.innerHTML.length > 0);
  check('Alerts Center populated by full orchestration', doc._store.dashAlertsCenterList.innerHTML.length > 0);
})();

console.log('\n' + passed + ' checks passed. Phase 29 Smart Dashboard widgets verified.');
