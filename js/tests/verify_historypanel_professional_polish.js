/**
 * verify_historypanel_professional_polish.js — PHASE 12.6B
 * Functional/jsdom harness for the History Timeline Professional Polish
 * pass: colored icon markers (§6), bulk grouping still correct (§7),
 * expandable "عرض التفاصيل" Before/After detail (§8), search clear (×)
 * button (§12), and that js/core/HistoryPanel.js's before/after
 * passthrough is present without changing its existing public API.
 * UndoManager.js / Repository.js are loaded read-only, unmodified.
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
  <div class="hp-search-wrap">
    <input type="text" id="hpSearchInput" class="hp-search-input">
    <button type="button" class="hp-search-clear" id="hpSearchClear" style="display:none;">&#10005;</button>
  </div>
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

const undoManagerSrc = fs.readFileSync(path.join(ROOT, 'js/core/UndoManager.js'), 'utf8');
window.eval(undoManagerSrc);
const UndoManager = window.UndoManager;
ok(typeof UndoManager === 'function', 'UndoManager.js loads unmodified in jsdom');

function makeFakeRepo() {
  const mgr = new UndoManager({ maxHistorySize: 50 });
  return { getUndoManager: () => mgr, canUndo: () => mgr.canUndo && mgr.canUndo(), canRedo: () => mgr.canRedo && mgr.canRedo() };
}
['casesRepository', 'clientsRepository', 'childrenRepository', 'sessionsRepository', 'tasksRepository',
 'feesRepository', 'documentsRepository', 'libraryRepository', 'templatesRepository'
].forEach(v => { window[v] = makeFakeRepo(); });

function pushEntry(repoVar, type, before, after, tsOffsetMs) {
  const mgr = window[repoVar].getUndoManager();
  const t = new Date(Date.now() + (tsOffsetMs || 0)).toISOString();
  mgr._history.push({ type, before, after, timestamp: t });
}

// One ordinary UPDATE (for Before/After diff coverage).
pushEntry('casesRepository', 'update',
  { 'رقم_القضية': 'C-1', 'عنوان_القضية': 'قضية أصلية', 'الحالة': 'مفتوحة' },
  { 'رقم_القضية': 'C-1', 'عنوان_القضية': 'قضية معدلة', 'الحالة': 'مغلقة' });

// One ordinary DELETE (for before-only detail coverage).
pushEntry('clientsRepository', 'delete', { 'رقم_الموكل': 'CL-2', 'الاسم': 'سارة علي' }, null);

// A bulk delete run (>= BULK_MIN_COUNT=3 within BULK_WINDOW_MS) to
// exercise Bulk grouping + the member-list detail branch.
for (let i = 0; i < 4; i++) {
  pushEntry('tasksRepository', 'delete', { 'رقم_المهمة': 'T-' + i, 'العنوان': 'مهمة ' + i }, null, i * 10);
}

['undoLastCaseAction', 'redoLastCaseAction', 'undoLastClientAction', 'redoLastClientAction',
 'undoLastChildAction', 'redoLastChildAction', 'undoLastSessionAction', 'redoLastSessionAction',
 'undoLastTaskAction', 'redoLastTaskAction', 'undoLastFeeAction', 'redoLastFeeAction',
 'undoLastDocumentAction', 'redoLastDocumentAction', 'undoLastLibBookAction', 'redoLastLibBookAction',
 'undoLastTemplateAction', 'redoLastTemplateAction'
].forEach(n => { window[n] = async () => {}; });

const historyPanelCoreSrc = fs.readFileSync(path.join(ROOT, 'js/core/HistoryPanel.js'), 'utf8');
window.eval(historyPanelCoreSrc);
ok(typeof window.HistoryPanel === 'object' && typeof window.HistoryPanel.getFeed === 'function', 'HistoryPanel.js core loads and exposes getFeed()');

// ---- HistoryPanel.js before/after passthrough (this phase's only change to that file) ----
const feedRaw = window.HistoryPanel.getFeed();
const updateGroup = feedRaw.undo.find(g => g.type === 'update' && !g.bulk);
ok(!!updateGroup && updateGroup.anchor.before && updateGroup.anchor.after, 'getFeed() anchors now carry both before and after (PHASE 12.6B passthrough)');
ok(updateGroup.anchor.before['عنوان_القضية'] === 'قضية أصلية' && updateGroup.anchor.after['عنوان_القضية'] === 'قضية معدلة', 'before/after values match the actual recorded entry, not swapped/mixed up');

const uiSrc = fs.readFileSync(path.join(ROOT, 'js/modules/historypanel-ui.js'), 'utf8');
window.eval(uiSrc);
ok(typeof window.renderHistoryPanel === 'function', 'historypanel-ui.js loads and exposes renderHistoryPanel()');

window.document.dispatchEvent(new window.Event('DOMContentLoaded', { bubbles: true, cancelable: true }));
window.renderHistoryPanel();

// ---- 1. Bulk grouping still correct after redesign (§7) ----
let list = window.document.getElementById('hpList');
const bulkRow = list.querySelector('.hp-marker-bulk');
ok(!!bulkRow, 'A bulk (purple) marker row is rendered for the 4 grouped task deletes (§6/§7)');
const bulkRowEl = bulkRow && bulkRow.closest('.hp-row');
ok(!!bulkRowEl && /4/.test(bulkRowEl.querySelector('.hp-row-title').textContent), 'Bulk row title reflects the grouped member count');

// ---- 2. Per-type marker colors (§6) ----
ok(!!list.querySelector('.hp-marker-update'), 'Update entry gets the blue (.hp-marker-update) marker');
ok(!!list.querySelector('.hp-marker-delete'), 'Delete entry gets the red (.hp-marker-delete) marker (the single, non-bulk client delete)');

// ---- 3. Timeline connector present ----
ok(list.getAttribute('data-empty') !== '1', 'List is not in the empty state with seeded data present');

// ---- 4. Expandable details (§8) — single update entry ----
const updateRow = list.querySelector('.hp-marker-update').closest('.hp-row');
const expandBtn = updateRow.querySelector('.hp-expand-btn');
ok(!!expandBtn && expandBtn.getAttribute('aria-expanded') === 'false', 'Update row has a closed expand button initially');
const detailsEl = updateRow.querySelector('.hp-details');
ok(detailsEl.hasAttribute('hidden'), 'Details panel starts hidden');

expandBtn.dispatchEvent(new window.Event('click', { bubbles: true }));
ok(!detailsEl.hasAttribute('hidden'), 'Clicking "عرض التفاصيل" reveals the details panel');
ok(expandBtn.getAttribute('aria-expanded') === 'true', 'aria-expanded flips to true on open');
ok(detailsEl.textContent.indexOf('قضية أصلية') !== -1 && detailsEl.textContent.indexOf('قضية معدلة') !== -1, 'Details panel shows both the Before and After value for a changed field');
ok(detailsEl.textContent.indexOf('الحالة') !== -1, 'Changed field name (الحالة) is listed in the diff');

expandBtn.dispatchEvent(new window.Event('click', { bubbles: true }));
ok(detailsEl.hasAttribute('hidden'), 'Clicking again collapses the details panel');
ok(expandBtn.getAttribute('aria-expanded') === 'false', 'aria-expanded flips back to false on close');

// ---- 5. Expandable details — bulk member breakdown ----
const bulkExpandBtn = bulkRowEl.querySelector('.hp-expand-btn');
bulkExpandBtn.dispatchEvent(new window.Event('click', { bubbles: true }));
const bulkDetailsEl = bulkRowEl.querySelector('.hp-details');
ok(!bulkDetailsEl.hasAttribute('hidden'), 'Bulk group details panel opens');
ok(bulkDetailsEl.querySelectorAll('.hp-detail-member').length === 4, 'Bulk details lists all 4 individual grouped members: got ' + bulkDetailsEl.querySelectorAll('.hp-detail-member').length);

// ---- 6. Search clear (×) button (§12) ----
const searchInput = window.document.getElementById('hpSearchInput');
const clearBtn = window.document.getElementById('hpSearchClear');
ok(clearBtn.style.display === 'none', 'Clear button hidden while search is empty');
searchInput.value = 'سارة';
searchInput.dispatchEvent(new window.Event('input', { bubbles: true }));
ok(clearBtn.style.display !== 'none', 'Clear button appears once a query is typed');
list = window.document.getElementById('hpList');
ok(list.querySelectorAll('.hp-row').length === 1, 'Query narrows results as before (unchanged search logic)');
clearBtn.dispatchEvent(new window.Event('click', { bubbles: true }));
ok(searchInput.value === '', 'Clicking × empties the search input');
ok(clearBtn.style.display === 'none', 'Clear button hides itself again after clearing');
list = window.document.getElementById('hpList');
ok(list.querySelectorAll('.hp-row').length === 3, 'Clearing search restores all 3 groups (1 update + 1 single delete + 1 bulk-delete group): got ' + list.querySelectorAll('.hp-row').length);

// ---- 7. Incremental rendering still holds after the redesign ----
const rowsBefore = Array.prototype.slice.call(list.querySelectorAll('.hp-row'));
const keyToNodeBefore = {};
rowsBefore.forEach(r => { keyToNodeBefore[r.getAttribute('data-key')] = r; });
window.renderHistoryPanel();
list = window.document.getElementById('hpList');
let allSameNodes = true;
Array.prototype.slice.call(list.querySelectorAll('.hp-row')).forEach(r => {
  if (keyToNodeBefore[r.getAttribute('data-key')] !== r) allSameNodes = false;
});
ok(allSameNodes, 'Re-render with unchanged data still reuses existing row DOM nodes post-redesign (§18 Performance)');

// ---- 8. CSS: marker/timeline classes exist, connector line declared ----
const cssSrc = fs.readFileSync(path.join(ROOT, 'css/components.css'), 'utf8');
ok(/\.hp-marker-bulk\{[^}]*background:var\(--hp-purple\)/.test(cssSrc), 'CSS defines the purple bulk marker color (§6)');
ok(/\.hp-list-undo \.hp-row-content\{[^}]*var\(--hp-indigo\)/.test(cssSrc), 'CSS defines the indigo Undo-list accent (§6)');
ok(/\.hp-list-redo \.hp-row-content\{[^}]*var\(--hp-teal\)/.test(cssSrc), 'CSS defines the teal Redo-list accent (§6)');
ok(/\.hp-list:not\(\[data-empty="1"\]\)::before/.test(cssSrc), 'CSS declares the timeline connector line');
const fadeInRuleMatch = cssSrc.match(/\.hp-row\.hp-row-enter\{[^}]*\}/);
const keyframesMatch = cssSrc.match(/@keyframes hp-row-fade-in\{[^}]*\}/);
ok(!!fadeInRuleMatch && /ease-out/.test(fadeInRuleMatch[0]), 'Row entrance animation uses an ease-out timing function (§10)');
ok(!!keyframesMatch && !/cubic-bezier\([^)]*-\d/.test(keyframesMatch[0]), 'hp-row-fade-in keyframes contain no bounce-style overshoot easing (§10: "بدون Bounce")');

// ---- 9. TopBar sync status adaptive tiers (§14/§15) ----
const responsiveSrc = fs.readFileSync(path.join(ROOT, 'css/responsive.css'), 'utf8');
ok(!/\.topbar-meta\{display:none;?\}/.test(responsiveSrc), 'Mobile no longer fully hides .topbar-meta (the original bug)');
ok(/\.tls-chip\{display:inline-flex;?\}/.test(responsiveSrc), 'Mobile breakpoint switches the sync status to the compact chip form instead of hiding it');
const settingsSrc = fs.readFileSync(path.join(ROOT, 'js/modules/settings.js'), 'utf8');
ok(/tlsFull/.test(settingsSrc) && /tlsCompact/.test(settingsSrc) && /tlsChipText/.test(settingsSrc), 'settings.js renders all three (full/compact/chip) sync status tiers every state change');

console.log('================================================================');
console.log('verify_historypanel_professional_polish.js — RESULTS');
console.log('================================================================');
console.log('PASS: ' + pass + '   FAIL: ' + fail);
console.log(fail === 0 ? 'PASS — all checks succeeded.' : 'FAIL — see above.');
process.exit(fail === 0 ? 0 : 1);
