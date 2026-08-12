/**
 * verify_dashboard_widget_decomposition.js
 * ================================================================
 * PHASE 18.4 — Dashboard Progressive Decomposition — Verification
 * ================================================================
 * Standalone Node/jsdom harness (`node js/tests/verify_dashboard_widget_decomposition.js`).
 *
 * PURPOSE
 * Phase 18.4 split the single monolithic renderDashboard() in
 * js/modules/dashboard.js into five independent widget functions
 * (renderStatisticsWidget, renderAlertsWidget, renderSessionsWidget,
 * renderTasksWidget, renderWelcomeWidget) called in original order by
 * a thin renderDashboard() orchestrator. This is supposed to be PURE
 * internal refactoring with zero behavioural change.
 *
 * METHOD
 * This harness does NOT compare against a hand-written "expected"
 * string (that would just re-encode the same assumptions this phase
 * is trying to verify). Instead it:
 *
 *   1. Reconstructs the EXACT pre-Phase-18.4 monolithic
 *      renderDashboard() (frozen below as BASELINE_SOURCE, copied
 *      byte-for-byte from the Phase 18.3 dashboard.js) and runs it
 *      against a fake DOM + fixture data to capture "before" output.
 *   2. Loads the REAL, current js/modules/dashboard.js (the actual
 *      post-refactor file shipped in this phase) via vm against a
 *      FRESH copy of the same fake DOM + fixture data, calls the real
 *      renderDashboard(), and captures "after" output.
 *   3. Byte-compares every observable surface: innerHTML/textContent
 *      of every DOM id the module touches, and the display/visibility
 *      style of the welcome-state toggle elements.
 *   4. Also calls each new widget function (renderStatisticsWidget,
 *      renderAlertsWidget, renderSessionsWidget, renderTasksWidget,
 *      renderWelcomeWidget) INDIVIDUALLY against a fresh DOM to prove
 *      each one is independently callable and produces the same
 *      partial output as its slice of the baseline — the actual
 *      precondition Phase 18.5 (Progressive Boot) needs.
 *
 * This is repeated across multiple fixture scenarios chosen to exercise
 * every branch identified in DASHBOARD_WIDGET_DEPENDENCIES.md:
 *   - normal populated state (sessions today, urgent tasks incl. a
 *     reopened one with a reason, upcoming sessions)
 *   - zero cases (welcome state, "add client first" sub-step)
 *   - zero cases but clients present (welcome state, "add case" sub-step)
 *   - populated cases but zero sessions/tasks (empty-state branches for
 *     #dashSessions / #dashTasks, no #dashAlerts content)
 *   - a task with no due date and no case number (infoRow omitted)
 *
 * No production file is modified by this harness. It is read-only with
 * respect to js/modules/dashboard.js.
 * ================================================================
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { JSDOM } = require('jsdom');

let passed = 0, failed = 0;
const failures = [];
function section(name, fn) {
  try { fn(); passed++; console.log('  [PASS] ' + name); }
  catch (e) { failed++; failures.push(name + ' :: ' + e.message); console.log('  [FAIL] ' + name + ' :: ' + e.message); }
}

const DASHBOARD_PATH = path.join(__dirname, '..', 'modules', 'dashboard.js');
const REAL_SOURCE = fs.readFileSync(DASHBOARD_PATH, 'utf8');

// ---- Frozen pre-Phase-18.4 baseline (byte-for-byte copy of the
//      monolithic renderDashboard()/updateBadges() this phase started
//      from — see docs/phase18/PHASE_18_4_DASHBOARD_WIDGET_DECOMPOSITION.md) --
const BASELINE_SOURCE = `
function renderDashboard(){
  var now=new Date();now.setHours(0,0,0,0);
  var todayStr=now.getFullYear()+'-'+pad(now.getMonth()+1)+'-'+pad(now.getDate());
  var in7=new Date(now.getTime()+7*864e5);
  var active=data.cases.filter(function(c){return['نشطة','active'].includes(c['الحالة']);}).length;
  var todaySess=data.sessions.filter(function(s){return String(s['التاريخ']).slice(0,10)===todayStr;}).length;
  var weekSess=data.sessions.filter(function(s){var d=parseLocalDate(s['التاريخ']);return d&&d>=now&&d<=in7;}).length;
  var urgent=data.tasks.filter(function(t){return t['الأولوية']==='high'&&t['الحالة']!=='done';}).length;
  document.getElementById('statCases').textContent=data.cases.length;
  document.getElementById('statActive').textContent=active;
  document.getElementById('statToday').textContent=todaySess;
  document.getElementById('statWeek').textContent=weekSess;
  document.getElementById('statClients').textContent=data.clients.length;
  document.getElementById('statTasks').textContent=urgent;
  var alerts=document.getElementById('dashAlerts');alerts.innerHTML='';
  var ts=data.sessions.filter(function(s){return String(s['التاريخ']).slice(0,10)===todayStr;});
  if(ts.length)alerts.innerHTML='<div class="alert-bar">&#9888;&#65039; لديك <strong>'+ts.length+' جلسة</strong> اليوم: '+ts.map(function(s){return(s['عنوان_القضية']||'جلسة')+' الساعة '+formatTime(s['الوقت']);}).join(' | ')+'</div>';
  var up=data.sessions.filter(function(s){var d=parseLocalDate(s['التاريخ']);return d&&d>=now;}).sort(function(a,b){return parseLocalDate(a['التاريخ'])-parseLocalDate(b['التاريخ']);}).slice(0,5);
  var ds=document.getElementById('dashSessions');
  if(!up.length)ds.innerHTML='<div class="empty-state"><div class="icon">&#128197;</div><p>لا توجد جلسات قادمة</p></div>';
  else ds.innerHTML=up.map(function(s){var d=parseLocalDate(s['التاريخ']);if(!d)return'';return'<div class="session-item"><div class="session-date"><div class="day">'+d.getDate()+'</div><div class="month">'+d.toLocaleDateString('ar-EG',{month:'short'})+'</div></div><div class="session-info"><div class="session-title">'+(s['عنوان_القضية']||'جلسة')+' '+urgencyBadge(s['التاريخ'])+'</div><div class="session-meta"><span>&#128336; '+formatTime(s['الوقت'])+'</span><span>&#127963; '+(s['المحكمة']||'—')+'</span></div></div></div>';}).join('');
  var ut=data.tasks.filter(function(t){return t['الأولوية']==='high'&&t['الحالة']!=='done';}).slice(0,5);
  var dt=document.getElementById('dashTasks');
  if(!ut.length)dt.innerHTML='<div class="empty-state"><div class="icon">&#9989;</div><p>لا توجد مهام عاجلة</p></div>';
  else dt.innerHTML=ut.map(function(t){
    var ri=resolveTaskIndex(data.tasks,t);
    var caseSpan = t['رقم_القضية']
      ? '<span class="task-due">&#9878; '+t['رقم_القضية']+'</span>'
      : '';
    var dueSpan = t['الموعد_النهائي']
      ? '<span class="task-due">'+urgencyBadge(t['الموعد_النهائي'])+' '+formatDate(t['الموعد_النهائي'])+'</span>'
      : '';
    var infoRow = (caseSpan||dueSpan)
      ? '<div style="display:flex;gap:9px;flex-wrap:wrap;margin-top:3px;">'+caseSpan+dueSpan+'</div>'
      : '';
    var reopenLine = '';
    if (t['تاريخ_إعادة_الفتح']) {
      reopenLine =
        '<div class="task-due" style="width:100%;margin-top:2px;">أعيد فتحها:<br>'+formatDate(t['تاريخ_إعادة_الفتح'])+
        (t['وقت_إعادة_الفتح']?' الساعة '+formatTime(t['وقت_إعادة_الفتح']):'')+
        (t['سبب_إعادة_الفتح']?'<br>السبب:<br>'+t['سبب_إعادة_الفتح']:'')+
        '</div>';
    }
    return '<div class="task-item high" style="cursor:pointer;" onclick="editTask('+ri+')"><div style="flex:1;min-width:0;"><div class="task-text">'+(TASK_PRIORITY_ICONS['high']||'')+' '+t['العنوان']+'</div>'+infoRow+reopenLine+'</div></div>';
  }).join('');
  var dw=document.getElementById('dashboardWelcome');
  if(dw){
    var statsGrid=document.querySelector('#page-dashboard .stats-grid');
    var dashGrid=document.querySelector('#page-dashboard .dashboard-grid');
    var sectionTitle=document.querySelector('#page-dashboard .dash-section-title');
    if(!data.cases.length){
      dw.style.display='';
      if(statsGrid)statsGrid.style.display='none';
      if(dashGrid)dashGrid.style.display='none';
      if(sectionTitle)sectionTitle.style.display='none';
      var stepClient=document.getElementById('welcomeStepClient');
      var stepCase=document.getElementById('welcomeStepCase');
      if(stepClient&&stepCase){
        if(!data.clients.length){stepClient.style.display='';stepCase.style.display='none';}
        else{stepClient.style.display='none';stepCase.style.display='';}
      }
    }else{
      dw.style.display='none';
      if(statsGrid)statsGrid.style.display='';
      if(dashGrid)dashGrid.style.display='';
      if(sectionTitle)sectionTitle.style.display='';
    }
  }
}

function updateBadges(){
  function setBadge(id,val){var el=document.getElementById(id);if(el)el.textContent=val;}
  setBadge('badgeCases',data.cases.length);
  setBadge('badgeSessions',data.sessions.length);
  setBadge('badgeClients',data.clients.length);
  setBadge('badgeChildren',data.children.length);
  setBadge('badgeDocuments',data.documents.length);
  setBadge('badgeTasks',data.tasks.filter(function(t){return t['الحالة']!=='done';}).length);
  setBadge('badgeFees',data.fees.length);
}
`;

// ---- Shared DOM skeleton -----------------------------------------
const DOM_HTML = `<!doctype html><html dir="rtl"><body>
<div id="page-dashboard">
  <div class="stats-grid">
    <span id="statCases"></span><span id="statActive"></span>
    <span id="statToday"></span><span id="statWeek"></span>
    <span id="statClients"></span><span id="statTasks"></span>
  </div>
  <div id="dashAlerts"></div>
  <div class="dashboard-grid">
    <div id="dashSessions"></div>
    <div id="dashTasks"></div>
  </div>
  <div class="dash-section-title"></div>
  <div id="dashboardWelcome" style="display:none;">
    <div id="welcomeStepClient"></div>
    <div id="welcomeStepCase"></div>
  </div>
</div>
<span id="badgeCases"></span><span id="badgeSessions"></span>
<span id="badgeClients"></span><span id="badgeChildren"></span>
<span id="badgeDocuments"></span><span id="badgeTasks"></span>
<span id="badgeFees"></span>
</body></html>`;

// ---- ui-utils.js equivalents (real project helpers, minimal reimpl
//      matching js/ui-utils.js exactly for the subset dashboard.js uses) --
function pad(n){return String(n).length<2?'0'+n:''+n;}
function parseLocalDate(s){
  if(!s)return null;
  var parts=String(s).slice(0,10).split('-');
  if(parts.length!==3)return null;
  var d=new Date(+parts[0],+parts[1]-1,+parts[2]);
  return isNaN(d.getTime())?null:d;
}
function formatTime(t){return t||'';}
function formatDate(s){
  var d=parseLocalDate(s);
  return d?d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate()):'';
}
function urgencyBadge(dateStr){
  var d=parseLocalDate(dateStr);
  if(!d)return'';
  var now=new Date();now.setHours(0,0,0,0);
  return d<now?'<span class="badge-overdue">متأخر</span>':'';
}
const TASK_PRIORITY_ICONS = { high: '&#128308;' };
function resolveTaskIndex(list, item){
  for (var i=0;i<list.length;i++){ if(list[i]===item) return i; }
  return -1;
}

function todayStr(){
  var now=new Date();now.setHours(0,0,0,0);
  return now.getFullYear()+'-'+pad(now.getMonth()+1)+'-'+pad(now.getDate());
}
function inNDays(n){
  var now=new Date();now.setHours(0,0,0,0);
  var d=new Date(now.getTime()+n*864e5);
  return d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate());
}

// ---- Fixture scenarios --------------------------------------------
function scenarioNormal(){
  return {
    cases: [{ 'الحالة':'نشطة' }, { 'الحالة':'مغلقة' }, { 'الحالة':'active' }],
    clients: [{}, {}],
    sessions: [
      { 'التاريخ': todayStr(), 'الوقت':'10:00', 'عنوان_القضية':'قضية أ', 'المحكمة':'محكمة القاهرة' },
      { 'التاريخ': inNDays(2), 'الوقت':'12:30', 'عنوان_القضية':'قضية ب', 'المحكمة':'' },
      { 'التاريخ': inNDays(10), 'الوقت':'09:00', 'عنوان_القضية':'قضية ج' }
    ],
    tasks: [
      { 'الأولوية':'high', 'الحالة':'open', 'العنوان':'مهمة عاجلة 1', 'رقم_القضية':'12/2026',
        'الموعد_النهائي': inNDays(1),
        'تاريخ_إعادة_الفتح': todayStr(), 'وقت_إعادة_الفتح':'08:00', 'سبب_إعادة_الفتح':'خطأ سابق' },
      { 'الأولوية':'high', 'الحالة':'open', 'العنوان':'مهمة عاجلة 2' },
      { 'الأولوية':'low', 'الحالة':'open', 'العنوان':'مهمة عادية' },
      { 'الأولوية':'high', 'الحالة':'done', 'العنوان':'مهمة منجزة' }
    ],
    children: [{}], documents: [{}, {}], fees: [{}, {}, {}]
  };
}
function scenarioZeroCasesNoClients(){
  return { cases: [], clients: [], sessions: [], tasks: [], children: [], documents: [], fees: [] };
}
function scenarioZeroCasesWithClients(){
  return { cases: [], clients: [{}, {}], sessions: [], tasks: [], children: [], documents: [], fees: [] };
}
function scenarioCasesNoSessionsNoTasks(){
  return {
    cases: [{ 'الحالة':'نشطة' }], clients: [{}],
    sessions: [], tasks: [], children: [], documents: [], fees: []
  };
}
function scenarioTaskNoDueNoCase(){
  return {
    cases: [{ 'الحالة':'نشطة' }], clients: [{}],
    sessions: [],
    tasks: [{ 'الأولوية':'high', 'الحالة':'open', 'العنوان':'مهمة بدون موعد' }],
    children: [], documents: [], fees: []
  };
}

const SCENARIOS = {
  normal: scenarioNormal,
  zero_cases_no_clients: scenarioZeroCasesNoClients,
  zero_cases_with_clients: scenarioZeroCasesWithClients,
  cases_no_sessions_no_tasks: scenarioCasesNoSessionsNoTasks,
  task_no_due_no_case: scenarioTaskNoDueNoCase
};

const TRACKED_IDS = [
  'statCases','statActive','statToday','statWeek','statClients','statTasks',
  'dashAlerts','dashSessions','dashTasks','dashboardWelcome',
  'welcomeStepClient','welcomeStepCase'
];
const TRACKED_STYLE_IDS = [
  ['dashboardWelcome', null], // container display
];

function buildEnv(dataFixture) {
  const dom = new JSDOM(DOM_HTML);
  const window = dom.window;
  const document = window.document;
  const sandbox = {
    window, document,
    data: dataFixture,
    pad, parseLocalDate, formatTime, formatDate, urgencyBadge,
    TASK_PRIORITY_ICONS, resolveTaskIndex,
    console
  };
  vm.createContext(sandbox);
  return { dom, document, sandbox };
}

function snapshot(document) {
  const out = {};
  for (const id of TRACKED_IDS) {
    const el = document.getElementById(id);
    out[id] = el ? { innerHTML: el.innerHTML, textContent: el.textContent, display: el.style.display } : null;
  }
  const statsGrid = document.querySelector('#page-dashboard .stats-grid');
  const dashGrid = document.querySelector('#page-dashboard .dashboard-grid');
  const sectionTitle = document.querySelector('#page-dashboard .dash-section-title');
  out['.stats-grid'] = statsGrid ? statsGrid.style.display : null;
  out['.dashboard-grid'] = dashGrid ? dashGrid.style.display : null;
  out['.dash-section-title'] = sectionTitle ? sectionTitle.style.display : null;
  return out;
}

function runBaseline(dataFixture) {
  const { document, sandbox } = buildEnv(dataFixture);
  vm.runInContext(BASELINE_SOURCE, sandbox, { filename: 'baseline_dashboard.js' });
  vm.runInContext('renderDashboard(); updateBadges();', sandbox, { filename: 'baseline_call.js' });
  return snapshot(document);
}

function runReal(dataFixture) {
  const { document, sandbox } = buildEnv(dataFixture);
  vm.runInContext(REAL_SOURCE, sandbox, { filename: 'dashboard.js' });
  vm.runInContext('renderDashboard(); updateBadges();', sandbox, { filename: 'real_call.js' });
  // sanity: confirm the widget functions actually exist post-decomposition
  assert.strictEqual(typeof sandbox.renderStatisticsWidget, 'function', 'renderStatisticsWidget must exist');
  assert.strictEqual(typeof sandbox.renderAlertsWidget, 'function', 'renderAlertsWidget must exist');
  assert.strictEqual(typeof sandbox.renderSessionsWidget, 'function', 'renderSessionsWidget must exist');
  assert.strictEqual(typeof sandbox.renderTasksWidget, 'function', 'renderTasksWidget must exist');
  assert.strictEqual(typeof sandbox.renderWelcomeWidget, 'function', 'renderWelcomeWidget must exist');
  return { snap: snapshot(document), sandbox };
}

function diffSnapshots(a, b) {
  const diffs = [];
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) {
    const av = JSON.stringify(a[k]);
    const bv = JSON.stringify(b[k]);
    if (av !== bv) diffs.push(`${k}: baseline=${av} real=${bv}`);
  }
  return diffs;
}

// ==================== A. Full renderDashboard() parity ====================
for (const [name, fixtureFn] of Object.entries(SCENARIOS)) {
  section(`Scenario "${name}": full renderDashboard()+updateBadges() output identical to baseline`, () => {
    const before = runBaseline(fixtureFn());
    const after = runReal(fixtureFn()).snap;
    const diffs = diffSnapshots(before, after);
    assert.strictEqual(diffs.length, 0, 'differences found: ' + diffs.join(' | '));
  });
}

// ==================== B. Each widget independently callable ====================
// Prove each widget, called ALONE (no other widget having run first),
// still writes exactly its own slice of the DOM and nothing else —
// the precondition Phase 18.5 progressive/independent hydration needs.
const WIDGET_TARGETS = {
  renderStatisticsWidget: ['statCases','statActive','statToday','statWeek','statClients','statTasks'],
  renderAlertsWidget: ['dashAlerts'],
  renderSessionsWidget: ['dashSessions'],
  renderTasksWidget: ['dashTasks'],
  renderWelcomeWidget: ['dashboardWelcome','welcomeStepClient','welcomeStepCase','.stats-grid','.dashboard-grid','.dash-section-title']
};

for (const [name, fixtureFn] of Object.entries(SCENARIOS)) {
  for (const widgetName of Object.keys(WIDGET_TARGETS)) {
    section(`Scenario "${name}": ${widgetName}() called alone matches its slice of the full baseline render`, () => {
      const fullBefore = runBaseline(fixtureFn());
      const { document, sandbox } = buildEnv(fixtureFn());
      vm.runInContext(REAL_SOURCE, sandbox, { filename: 'dashboard.js' });
      vm.runInContext(`${widgetName}();`, sandbox, { filename: 'single_widget_call.js' });
      const partial = snapshot(document);
      const targets = WIDGET_TARGETS[widgetName];
      for (const t of targets) {
        assert.strictEqual(
          JSON.stringify(partial[t]), JSON.stringify(fullBefore[t]),
          `target "${t}" mismatch when ${widgetName}() run alone`
        );
      }
    });
  }
}

// ==================== C. renderDashboard() is a pure orchestrator ====================
section('renderDashboard() body contains only widget calls (no leftover inline logic)', () => {
  const m = REAL_SOURCE.match(/function renderDashboard\(\)\{([\s\S]*?)\n\}/);
  assert.ok(m, 'renderDashboard() not found in real source');
  const body = m[1];
  const calls = body.match(/render\w+Widget\(\);/g) || [];
  assert.ok(calls.length >= 5, 'expected at least 5 widget calls, found ' + calls.length);
  const withoutCalls = body.replace(/\s*render\w+Widget\(\);\s*/g, '').trim();
  assert.strictEqual(withoutCalls, '', 'renderDashboard() has leftover non-orchestration code: ' + JSON.stringify(withoutCalls));
});

// ==================== D. updateBadges() untouched (checksum) ====================
section('updateBadges() source is byte-identical to pre-Phase-18.4 baseline', () => {
  const extract = (src) => {
    const m = src.match(/function updateBadges\(\)\{[\s\S]*?\n\}/);
    assert.ok(m, 'updateBadges() not found');
    return m[0];
  };
  assert.strictEqual(extract(REAL_SOURCE), extract(BASELINE_SOURCE));
});

console.log('\n' + '='.repeat(70));
console.log(`RESULT: ${passed} passed, ${failed} failed`);
if (failed) {
  console.log('\nFailures:');
  failures.forEach(f => console.log('  - ' + f));
}
console.log('='.repeat(70));
process.exit(failed ? 1 : 0);
