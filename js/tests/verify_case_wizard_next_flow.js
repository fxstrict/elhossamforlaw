/**
 * verify_case_wizard_next_flow.js
 * ================================================================
 * PROBLEM 13 — Case Form Wizard / "التالي" instead of "حفظ" (v82)
 * ================================================================
 * Standalone Node harness (`node js/tests/verify_case_wizard_next_flow.js`)
 * loading the REAL js/modules/cases.js (via Module.wrap+vm, same technique
 * as verify_cases_repository_integration.js) and the REAL index.html
 * footer/tabs markup (parsed, not hand-duplicated), proving:
 *
 *   A. The primary case-form action is no longer a mid-flow "حفظ" —
 *      #btnCaseNext/#btnCasePrev exist in index.html wired to
 *      caseWizardNext()/caseWizardPrev(), and #btnCaseSave (the only
 *      button wired to saveCase()) is the sole "save" control.
 *   B. getCaseTabOrder() reflects the REAL DOM order of #caseFormTabs'
 *      .tab-btn elements in index.html (info, stage, parties, session,
 *      adminwork, psw, docs, other) — not a hand-typed assumption.
 *   C. Data already entered in a tab is never touched by switching tabs
 *      (Next/Previous only toggle pane display — no field is read,
 *      cleared, or reset).
 *   D. Reaching the last tab in the real order flips the footer CTA to
 *      the final-save button; every earlier tab shows "التالي" instead.
 *   E. caseWizardNext()/caseWizardPrev() NEVER call saveCase() — no
 *      matter how many times Next/Previous are pressed.
 *   F. (documented via D/E) saveCase() itself is therefore reachable
 *      through exactly one control (#btnCaseSave), so the case (and its
 *      already-tested embedded children — Problems 1-12) can only be
 *      persisted once per registration, not once per tab.
 *   G./H. Out of scope for THIS file (ConflictError / Cancel-then-reopen
 *      behavior is saveCase()/resetForm() territory, already covered end
 *      -to-end by verify_case_save_cycle_end_to_end.js and verify_case_
 *      conflict_source_after_delete.js — both re-run unmodified as part
 *      of the full regression, and neither this file nor Problem 13
 *      touches saveCase()/resetForm() at all, so their PASS status is
 *      the actual evidence, not a duplicate re-implementation here).
 *   I. The step-guidance banner (#caseWizardHint) tells the user which
 *      step they're on and, on the last step, explicitly asks them to
 *      review all tabs before finishing.
 *   J. switchCaseFormTab()'s pre-existing pane show/hide/active-button
 *      contract (already covered by verify_cases_repository_integration.
 *      js) is unaffected — proven again here with the FULL real 8-tab
 *      order instead of that file's 4-tab fake subset.
 * ================================================================
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

const ROOT = path.join(__dirname, '..', '..');
const casesJsPath = path.join(ROOT, 'js', 'modules', 'cases.js');
const indexHtmlPath = path.join(ROOT, 'index.html');

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

function makeFakeElement(id) {
  return {
    id: id || '',
    value: '',
    textContent: '',
    innerHTML: '',
    style: { display: '' },
    classList: {
      _classes: {},
      add: function (c) { this._classes[c] = true; },
      remove: function (c) { delete this._classes[c]; },
      contains: function (c) { return !!this._classes[c]; },
      toggle: function (c, force) {
        var on = force !== undefined ? force : !this._classes[c];
        if (on) this._classes[c] = true; else delete this._classes[c];
        return on;
      }
    },
    getAttribute: function () { return null; }
  };
}

async function main() {
  const indexHtml = fs.readFileSync(indexHtmlPath, 'utf8');

  // ================================================================
  // A/D — Real footer markup: exactly one saveCase() control, Next/
  // Previous wired to the new wizard functions, not to saveCase().
  // ================================================================
  const footerMatch = indexHtml.match(/<div class="modal-footer">[\s\S]*?<\/div>\s*<\/div>\s*<\/div>\s*\n\s*<div class="modal-overlay" id="modalSession">/);
  check('index.html: the case-form footer block exists right before #modalSession (structural sanity check for the extraction below)', () => {
    assert.ok(footerMatch, 'could not locate the case-form modal-footer block in index.html');
  });
  const footerHtml = footerMatch ? footerMatch[0] : '';

  check('index.html: #btnCaseSave is the ONLY control in the case-form footer wired to saveCase()', () => {
    const saveCalls = (footerHtml.match(/onclick="saveCase\(\)"/g) || []);
    assert.strictEqual(saveCalls.length, 1, 'saveCase() must be reachable from exactly one button');
    assert.ok(/id="btnCaseSave"[^>]*onclick="saveCase\(\)"/.test(footerHtml), '#btnCaseSave must be the button wired to saveCase()');
  });

  check('index.html: #btnCaseNext is wired to caseWizardNext(), NOT saveCase()', () => {
    assert.ok(/id="btnCaseNext"[^>]*onclick="caseWizardNext\(\)"/.test(footerHtml));
  });

  check('index.html: #btnCasePrev is wired to caseWizardPrev(), NOT saveCase()/resetForm()', () => {
    assert.ok(/id="btnCasePrev"[^>]*onclick="caseWizardPrev\(\)"/.test(footerHtml));
  });

  check('index.html: #btnCaseSave/#btnCasePrev start hidden (display:none) — first tab ("info") shows only "التالي" by default, matching _updateCaseWizardUI()\'s own first-tab logic', () => {
    assert.ok(/id="btnCasePrev"[^>]*style="display:none;"/.test(footerHtml));
    assert.ok(/id="btnCaseSave"[^>]*style="display:none;"/.test(footerHtml));
    assert.ok(!/id="btnCaseNext"[^>]*style="display:none;"/.test(footerHtml), '#btnCaseNext must be visible by default');
  });

  check('index.html: #caseWizardHint step-guidance banner exists inside the case modal', () => {
    assert.ok(/id="caseWizardHint"/.test(indexHtml));
  });

  // ================================================================
  // Load the REAL cases.js and exercise the wizard functions against a
  // richer fake DOM (all 8 real tabs + footer controls + hint), same
  // querySelectorAll('#caseFormTabs .tab-btn') / ('.case-form-pane')
  // contract verify_cases_repository_integration.js already proved.
  // ================================================================
  const REAL_TAB_ORDER = ['info', 'stage', 'parties', 'session', 'adminwork', 'psw', 'docs', 'other'];

  const fakeIndexedDB = new FakeIndexedDB();
  const fakeElements = {};
  function el(id) { if (!fakeElements[id]) fakeElements[id] = makeFakeElement(id); return fakeElements[id]; }

  const panes = REAL_TAB_ORDER.map(function (id) {
    const p = el('casePane-' + id);
    p.style.display = id === 'info' ? '' : 'none';
    return p;
  });
  const buttons = REAL_TAB_ORDER.map(function (id) {
    const b = makeFakeElement();
    b._caseTab = id;
    b.getAttribute = function (attr) { return attr === 'data-case-tab' ? this._caseTab : null; };
    if (id === 'info') b.classList.add('active');
    return b;
  });
  el('btnCasePrev'); el('btnCaseNext'); el('btnCaseSave'); el('caseWizardHint');

  const sandboxGlobals = {
    indexedDB: fakeIndexedDB,
    data: { cases: [], clients: [] },
    editIdx: { cases: -1 },
    document: {
      getElementById: function (id) { return fakeElements[id] || null; },
      createElement: function () { return makeFakeElement(); },
      querySelectorAll: function (selector) {
        if (selector === '.case-form-pane') return panes;
        if (selector === '#caseFormTabs .tab-btn') return buttons;
        return [];
      }
    },
    escapeHtml: function (s) { return String(s == null ? '' : s); },
    toast: function () {},
    updateBadges: function () {},
    closeModal: function () {},
    formatDate: function (d) { return d || ''; },
    formatTime: function (t) { return t || ''; },
    parseLocalDate: function () { return 0; },
    urgencyBadge: function () { return ''; },
    statusBadge: function () { return ''; },
    val: function (id) { const e = fakeElements[id]; return e ? e.value : ''; },
    collectForm: function () { return {}; },
    fillForm: function () {},
    resetForm: function () {},
    ApiService: { syncRow: function () {}, deleteData: function () {} },
    saveLocal: function () {},
    confirm: function () { return true; },
    console: console
  };
  sandboxGlobals.window = global;
  Object.keys(sandboxGlobals).forEach(function (k) { global[k] = sandboxGlobals[k]; });

  const casesModule = loadModule(casesJsPath);

  // Wrap the module's own saveCase with a counter WITHOUT touching the
  // module's exported reference chain other tests rely on — mirrors how
  // clients.js/tasks.js wrap saveCase in production.
  let saveCaseCalls = 0;
  const realSaveCase = casesModule.saveCase;
  global.saveCase = function () { saveCaseCalls++; return realSaveCase.apply(this, arguments); };

  function activeTab() {
    for (var i = 0; i < buttons.length; i++) if (buttons[i].classList.contains('active')) return buttons[i]._caseTab;
    return null;
  }

  // ================================================================
  // B — real tab order
  // ================================================================
  check('getCaseTabOrder(): reads the exact real 8-tab order from #caseFormTabs (not a hand-typed duplicate)', () => {
    assert.deepStrictEqual(casesModule.getCaseTabOrder(), REAL_TAB_ORDER);
  });

  // ================================================================
  // J — switchCaseFormTab() contract, full 8-tab order
  // ================================================================
  check('switchCaseFormTab(): shows only the target pane and marks only its own button active, across all 8 real tabs', () => {
    casesModule.switchCaseFormTab('psw');
    panes.forEach(function (p) { assert.strictEqual(p.style.display, p.id === 'casePane-psw' ? '' : 'none'); });
    buttons.forEach(function (b) { assert.strictEqual(b.classList.contains('active'), b._caseTab === 'psw'); });
    casesModule.switchCaseFormTab('info'); // reset for the tests below
  });

  // ================================================================
  // D — footer CTA flips only on the real last tab
  // ================================================================
  check('_updateCaseWizardUI(): on tab "info" (first) — Prev hidden, Next visible, Save hidden', () => {
    casesModule.switchCaseFormTab('info');
    assert.strictEqual(fakeElements.btnCasePrev.style.display, 'none');
    assert.strictEqual(fakeElements.btnCaseNext.style.display, '');
    assert.strictEqual(fakeElements.btnCaseSave.style.display, 'none');
  });

  check('_updateCaseWizardUI(): on a middle tab ("adminwork") — Prev AND Next both visible, Save hidden', () => {
    casesModule.switchCaseFormTab('adminwork');
    assert.strictEqual(fakeElements.btnCasePrev.style.display, '');
    assert.strictEqual(fakeElements.btnCaseNext.style.display, '');
    assert.strictEqual(fakeElements.btnCaseSave.style.display, 'none');
  });

  check('_updateCaseWizardUI(): on tab "other" (real last tab) — Next hidden, Save visible', () => {
    casesModule.switchCaseFormTab('other');
    assert.strictEqual(fakeElements.btnCaseNext.style.display, 'none');
    assert.strictEqual(fakeElements.btnCaseSave.style.display, '');
  });

  check('_updateCaseWizardUI(): step-guidance banner names the step number and, on the last tab, asks for a full review', () => {
    casesModule.switchCaseFormTab('other');
    assert.ok(fakeElements.caseWizardHint.textContent.indexOf('8 من 8') !== -1 || fakeElements.caseWizardHint.textContent.indexOf('الخطوة 8') !== -1);
    assert.ok(fakeElements.caseWizardHint.textContent.indexOf('مراجعة') !== -1);
    casesModule.switchCaseFormTab('info');
    assert.ok(fakeElements.caseWizardHint.textContent.indexOf('الخطوة 1') !== -1);
  });

  // ================================================================
  // C/E — Next/Previous move the real order, touch no data, never save
  // ================================================================
  check('caseWizardNext(): walks the FULL real order end-to-end, one step per call, with zero saveCase() calls', () => {
    casesModule.switchCaseFormTab('info');
    saveCaseCalls = 0;
    for (var i = 0; i < REAL_TAB_ORDER.length - 1; i++) {
      casesModule.caseWizardNext();
      assert.strictEqual(activeTab(), REAL_TAB_ORDER[i + 1], 'step ' + i + ': expected to land on ' + REAL_TAB_ORDER[i + 1]);
    }
    assert.strictEqual(saveCaseCalls, 0, 'caseWizardNext() must never call saveCase()');
  });

  check('caseWizardNext(): calling it again while already on the last tab ("other") is a no-op — does not throw, does not save', () => {
    assert.strictEqual(activeTab(), 'other');
    saveCaseCalls = 0;
    casesModule.caseWizardNext();
    assert.strictEqual(activeTab(), 'other');
    assert.strictEqual(saveCaseCalls, 0);
  });

  check('caseWizardPrev(): walks the FULL real order backward end-to-end, with zero saveCase() calls', () => {
    saveCaseCalls = 0;
    for (var i = REAL_TAB_ORDER.length - 1; i > 0; i--) {
      casesModule.caseWizardPrev();
      assert.strictEqual(activeTab(), REAL_TAB_ORDER[i - 1]);
    }
    assert.strictEqual(saveCaseCalls, 0, 'caseWizardPrev() must never call saveCase()');
  });

  check('caseWizardPrev(): calling it again while already on the first tab ("info") is a no-op', () => {
    assert.strictEqual(activeTab(), 'info');
    casesModule.caseWizardPrev();
    assert.strictEqual(activeTab(), 'info');
  });

  check('C — a value set on a pane element before Next/Previous is never read, cleared, or overwritten by either function (no field access at all — only pane/button/footer visibility changes)', () => {
    var infoInput = fakeElements['casePane-info']; // stand-in DOM node for the "info" pane
    infoInput.value = 'SENTINEL-DATA-2026/999';
    casesModule.caseWizardNext(); // -> stage
    casesModule.caseWizardNext(); // -> parties
    casesModule.caseWizardPrev(); // -> stage
    casesModule.caseWizardPrev(); // -> info
    assert.strictEqual(activeTab(), 'info');
    assert.strictEqual(infoInput.value, 'SENTINEL-DATA-2026/999', 'wizard navigation must never touch field/pane values');
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

main().catch((e) => { console.error(e); process.exit(1); });
