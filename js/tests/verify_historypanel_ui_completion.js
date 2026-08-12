/**
 * verify_historypanel_ui_completion.js — PHASE 12.6A
 * Functional/jsdom harness for js/modules/historypanel-ui.js completion
 * work (search, tabs, TopBar badge, incremental rendering, RTL panel
 * position). Does not touch/require Repository.js, UndoManager.js is
 * loaded read-only exactly as shipped (no modification).
 */
'use strict';
const { JSDOM } = require('jsdom');
const fs = require('fs');
const path = require('path');

let pass = 0, fail = 0;
function ok(cond, label) {
  if (cond) { pass++; }
  else { fail++; console.log('FAIL — ' + label); }
}

const ROOT = path.join(__dirname, '..', '..');

const html = `<!doctype html><html dir="rtl"><body>
<button class="btn btn-ghost btn-sm hp-topbar-btn" id="historyPanelBtn" onclick="toggleHistoryPanel()">&#128337; السجل<span class="hp-topbar-badge" id="hpTopbarBadge" style="display:none;">0</span></button>
<div class="history-panel-overlay" id="historyPanelOverlay"></div>
<div id="historyPanel" role="dialog" aria-modal="true" aria-labelledby="hpHeaderTitle" aria-hidden="true">
  <div class="hp-header"><div class="hp-header-title" id="hpHeaderTitle">سجل</div><button class="hp-close-btn" id="hpCloseBtn">x</button></div>
  <div class="hp-search-wrap"><input type="text" id="hpSearchInput" class="hp-search-input"></div>
  <div class="hp-limits" id="hpLimits"></div>
  <div class="hp-tabs" id="hpTabs" role="tablist">
    <div class="hp-tab active" role="tab" aria-selected="true" tabindex="0" data-hp-filter="all">الكل</div>
    <div class="hp-tab" role="tab" aria-selected="false" tabindex="-1" data-hp-filter="cases">القضايا</div>
    <div class="hp-tab" role="tab" aria-selected="false" tabindex="-1" data-hp-filter="clients">الموكلون</div>
    <div class="hp-tab hp-tab-sep" role="tab" aria-selected="false" tabindex="-1" data-hp-filter="undo">Undo <span class="hp-tab-count" id="hpUndoCount">0</span></div>
    <div class="hp-tab" role="tab" aria-selected="false" tabindex="-1" data-hp-filter="redo">Redo <span class="hp-tab-count" id="hpRedoCount">0</span></div>
  </div>
  <div class="hp-body"><div class="hp-list active" id="hpList"></div></div>
</div>
</body></html>`;

const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'http://localhost/' });
const window = dom.window;
global.window = window;
global.document = window.document;
global.toast = function () {};

// Load UndoManager.js (READ-ONLY, unmodified) to build real history stacks.
const undoManagerSrc = fs.readFileSync(path.join(ROOT, 'js/core/UndoManager.js'), 'utf8');
window.eval(undoManagerSrc);
const UndoManager = window.UndoManager;
ok(typeof UndoManager === 'function', 'UndoManager.js loads unmodified in jsdom');

// Minimal fake repositories, matching the public facade HistoryPanel.js
// relies on (getUndoManager()) — nothing from Repository.js is used.
function makeFakeRepo() {
  const mgr = new UndoManager({ maxHistorySize: 50 });
  return { getUndoManager: () => mgr, canUndo: () => mgr.canUndo && mgr.canUndo(), canRedo: () => mgr.canRedo && mgr.canRedo() };
}

window.casesRepository = makeFakeRepo();
window.clientsRepository = makeFakeRepo();
window.childrenRepository = makeFakeRepo();
window.sessionsRepository = makeFakeRepo();
window.tasksRepository = makeFakeRepo();
window.feesRepository = makeFakeRepo();
window.documentsRepository = makeFakeRepo();
window.libraryRepository = makeFakeRepo();
window.templatesRepository = makeFakeRepo();

// Seed some history entries directly via the real UndoManager API.
function pushEntry(repoVar, type, before, after) {
  const mgr = window[repoVar].getUndoManager();
  mgr._history.push({ type, before, after, timestamp: new Date().toISOString() });
}
pushEntry('casesRepository', 'create', null, { 'رقم_القضية': 'C-1', 'عنوان_القضية': 'قضية تجريبية' });
pushEntry('casesRepository', 'update', { 'رقم_القضية': 'C-1' }, { 'رقم_القضية': 'C-1', 'عنوان_القضية': 'قضية معدلة' });
pushEntry('clientsRepository', 'create', null, { 'رقم_الموكل': 'CL-1', 'الاسم': 'أحمد محمد' });
pushEntry('clientsRepository', 'delete', { 'رقم_الموكل': 'CL-2', 'الاسم': 'سارة علي' }, null);

// Provide dummy undo/redo wrapper globals (jumpTo() calls these; not
// exercised in this harness, just need to exist as functions).
['undoLastCaseAction', 'redoLastCaseAction', 'undoLastClientAction', 'redoLastClientAction',
 'undoLastChildAction', 'redoLastChildAction', 'undoLastSessionAction', 'redoLastSessionAction',
 'undoLastTaskAction', 'redoLastTaskAction', 'undoLastFeeAction', 'redoLastFeeAction',
 'undoLastDocumentAction', 'redoLastDocumentAction', 'undoLastLibBookAction', 'redoLastLibBookAction',
 'undoLastTemplateAction', 'redoLastTemplateAction'
].forEach(n => { window[n] = async () => {}; });

// Load HistoryPanel.js (core aggregator, UNMODIFIED by 12.6A) then the
// completed UI file under test.
const historyPanelCoreSrc = fs.readFileSync(path.join(ROOT, 'js/core/HistoryPanel.js'), 'utf8');
window.eval(historyPanelCoreSrc);
ok(typeof window.HistoryPanel === 'object' && typeof window.HistoryPanel.getFeed === 'function', 'HistoryPanel.js core loads unmodified and exposes getFeed()');

const uiSrc = fs.readFileSync(path.join(ROOT, 'js/modules/historypanel-ui.js'), 'utf8');
window.eval(uiSrc);
ok(typeof window.renderHistoryPanel === 'function', 'historypanel-ui.js loads and exposes renderHistoryPanel()');
ok(typeof window.toggleHistoryPanel === 'function', 'historypanel-ui.js exposes toggleHistoryPanel()');

// Fire DOMContentLoaded manually (jsdom outside-only mode does not run
// inline <script> tags, and we injected our script via eval, not via a
// <script> tag, so the module's own DOMContentLoaded listener needs a
// dispatched event to attach its handlers).
window.document.dispatchEvent(new window.Event('DOMContentLoaded', { bubbles: true, cancelable: true }));

// ---- 1. Initial render: badge + counts ----
window.renderHistoryPanel();
const badge = window.document.getElementById('hpTopbarBadge');
ok(badge.style.display !== 'none', 'TopBar badge becomes visible once there is history (§7)');
ok(badge.textContent === '4', 'TopBar badge shows correct total undo count (4 seeded entries): got ' + badge.textContent);

const undoCountEl = window.document.getElementById('hpUndoCount');
ok(undoCountEl.textContent === '4', 'Undo tab count reflects seeded history');

let list = window.document.getElementById('hpList');
ok(list.querySelectorAll('.hp-row').length === 4, 'All 4 seeded entries render as rows with filter=all, query="" : got ' + list.querySelectorAll('.hp-row').length);

// ---- 2. Search (§5) ----
const searchInput = window.document.getElementById('hpSearchInput');
searchInput.value = 'سارة';
searchInput.dispatchEvent(new window.Event('input', { bubbles: true }));
list = window.document.getElementById('hpList');
ok(list.querySelectorAll('.hp-row').length === 1, 'Search "سارة" narrows to the 1 matching client-delete row: got ' + list.querySelectorAll('.hp-row').length);
ok(list.textContent.indexOf('سارة') !== -1, 'Search result row actually contains the matched client name');

searchInput.value = 'nonexistent_zzz';
searchInput.dispatchEvent(new window.Event('input', { bubbles: true }));
list = window.document.getElementById('hpList');
ok(list.querySelectorAll('.hp-row').length === 0, 'Search with no matches renders 0 rows');
ok(list.querySelector('.hp-empty') !== null, 'No-match search shows an empty state, not a blank list');

searchInput.value = '';
searchInput.dispatchEvent(new window.Event('input', { bubbles: true }));

// ---- 3. Tabs / entity filter (§6) ----
const casesTab = window.document.querySelector('[data-hp-filter="cases"]');
casesTab.dispatchEvent(new window.Event('click', { bubbles: true }));
list = window.document.getElementById('hpList');
ok(list.querySelectorAll('.hp-row').length === 2, 'Filtering to "cases" tab shows only the 2 case entries: got ' + list.querySelectorAll('.hp-row').length);
ok(casesTab.classList.contains('active') && casesTab.getAttribute('aria-selected') === 'true', 'Selected tab gets active class + aria-selected=true');
const allTab = window.document.querySelector('[data-hp-filter="all"]');
ok(!allTab.classList.contains('active'), 'Previously active tab loses active class');

const undoTab = window.document.querySelector('[data-hp-filter="undo"]');
undoTab.dispatchEvent(new window.Event('click', { bubbles: true }));
list = window.document.getElementById('hpList');
ok(list.querySelectorAll('.hp-row').length === 4, 'Filtering to "undo" tab shows all 4 undoable entries (none redone yet)');

allTab.dispatchEvent(new window.Event('click', { bubbles: true }));

// ---- 4. Incremental rendering (§8/§12) — same key => same DOM node ----
list = window.document.getElementById('hpList');
const rowsBefore = Array.prototype.slice.call(list.querySelectorAll('.hp-row'));
const keyToNodeBefore = {};
rowsBefore.forEach(r => { keyToNodeBefore[r.getAttribute('data-key')] = r; });

window.renderHistoryPanel(); // re-render with unchanged data

list = window.document.getElementById('hpList');
const rowsAfter = Array.prototype.slice.call(list.querySelectorAll('.hp-row'));
let allSameNodes = rowsAfter.length === rowsBefore.length;
rowsAfter.forEach(r => {
  const key = r.getAttribute('data-key');
  if (keyToNodeBefore[key] !== r) allSameNodes = false;
});
ok(allSameNodes, 'Re-rendering unchanged data re-uses the same DOM nodes (no full innerHTML rebuild) — this is the Incremental Rendering requirement (§8)');

// ---- 5. New entry appears, old entries are not touched/recreated ----
const untouchedKey = rowsBefore[0].getAttribute('data-key');
const untouchedNodeRef = keyToNodeBefore[untouchedKey];
pushEntry('tasksRepository', 'create', null, { 'رقم_المهمة': 'T-9', 'العنوان': 'مهمة جديدة' });
window.renderHistoryPanel();
list = window.document.getElementById('hpList');
ok(list.querySelectorAll('.hp-row').length === 5, 'A newly-pushed entry increases the row count incrementally (4 -> 5)');
const stillThere = list.querySelector('[data-key="' + untouchedKey.replace(/"/g, '\\"') + '"]');
ok(stillThere === untouchedNodeRef, 'Adding a new entry does not recreate/replace pre-existing unrelated row DOM nodes');

// ---- 6. RTL slide-in direction is right-anchored, not left ----
const cssSrc = fs.readFileSync(path.join(ROOT, 'css/components.css'), 'utf8');
const panelRuleMatch = cssSrc.match(/#historyPanel\{[^}]*\}/);
ok(!!panelRuleMatch && /right:0/.test(panelRuleMatch[0]), '#historyPanel CSS is right-anchored (RTL-correct slide-in), not left-anchored');
ok(!!panelRuleMatch && /translateX\(100%\)/.test(panelRuleMatch[0]), '#historyPanel closed-state transform slides off to the right (translateX(100%))');

console.log('================================================================');
console.log('verify_historypanel_ui_completion.js — RESULTS');
console.log('================================================================');
console.log('PASS: ' + pass + '   FAIL: ' + fail);
console.log(fail === 0 ? 'PASS — all checks succeeded.' : 'FAIL — see above.');
process.exit(fail === 0 ? 0 : 1);
