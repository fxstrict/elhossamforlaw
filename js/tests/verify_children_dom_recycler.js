/**
 * verify_children_dom_recycler.js
 * ================================================================
 * PHASE 16.14 — DomRecycler Migration (Children) — Verification
 * ================================================================
 * Standalone Node harness (`node js/tests/verify_children_dom_recycler.js`,
 * no browser required). Loads the REAL js/modules/children.js (via the
 * same vm/Module.wrap technique verify_children_repository_integration.js
 * and verify_fees_dom_recycler.js already use) against a REAL
 * ChildrenRepository (backed by the fake localStorage/indexedDB doubles
 * every verify_*_repository*.js harness uses) and the REAL
 * js/core/dom/{DomKeyIndex,DomNodeFactory,DomPatch,DomRecycler}.js
 * files — exercising renderChildren() end-to-end against a full fake DOM
 * tree (the same FakeElement shape verify_dom_recycler.js /
 * verify_tasks_dom_recycler.js / verify_sessions_dom_recycler.js /
 * verify_fees_dom_recycler.js use: createElement/insertBefore/
 * removeChild/firstChild/nextSibling/parentNode/innerHTML/className/id/
 * title/hidden/disabled).
 *
 * PHASE 16.14 REVIEW NOTE (see handoff report): renderChildren() uses
 * TWO containers — #childrenTableBody (<tr>, no className) and
 * #childrenMobileList (<div class="m-card">) — the exact same
 * dual-container shape as renderCases() (PHASE 16.6) and renderFees()
 * (PHASE 16.13), NOT the single-container shape of Sessions/Documents/
 * Clients/Tasks. This harness therefore exercises BOTH containers on
 * every render, directly modeled on verify_fees_dom_recycler.js's
 * dual-container assertions (the correct architectural reference per
 * Phase 16.14's own instruction to match by real structure, not by
 * name — Children shares Fees'/Cases' shape, not Sessions'/Documents').
 *
 * No production file is modified by this harness. It is read-only with
 * respect to js/modules/children.js and js/core/dom/*.
 *
 * This does NOT re-test DomRecycler.reconcile()'s own internal
 * mechanics (already covered by verify_dom_recycler.js) — it tests
 * renderChildren() itself: that it wires reconcile() correctly for BOTH
 * containers, with the correct key/tag/className/render, and falls
 * back correctly.
 *
 * Coverage (per Phase 16.14 handoff prompt, item "الاختبارات المطلوبة"):
 *   A. Initial Render        F. Filter
 *   B. Reuse                 G. Reorder (N/A — no sort in renderChildren())
 *   C. Content Update        H. Empty State
 *   D. Delete                I. Fallback
 *   E. Insert                J. Node Identity
 * ================================================================
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const Module = require('module');
const vm = require('vm');
const { FakeIndexedDB } = require(path.join(__dirname, 'fake_indexeddb.js'));

let passed = 0, failed = 0, assertionCount = 0;
const failures = [];
function countingAssert(cond, msg) { assertionCount++; if (!cond) throw new Error(msg || 'assertion failed'); }
function section(name, fn) {
  try { fn(); passed++; console.log('  [PASS] ' + name); }
  catch (e) { failed++; failures.push(name + ' :: ' + e.message); console.log('  [FAIL] ' + name + ' :: ' + e.message); }
}
async function asyncSection(name, fn) {
  try { await fn(); passed++; console.log('  [PASS] ' + name); }
  catch (e) { failed++; failures.push(name + ' :: ' + e.message); console.log('  [FAIL] ' + name + ' :: ' + e.message); }
}

// ---- Fake DOM (same shape/semantics as verify_dom_recycler.js /
//      verify_tasks_dom_recycler.js / verify_sessions_dom_recycler.js /
//      verify_fees_dom_recycler.js) --

class FakeElement {
  constructor(tag) {
    this.tagName = tag;
    this._className = '';
    this._id = '';
    this._title = '';
    this._hidden = false;
    this._disabled = false;
    this._html = '';
    this.children = [];
    this.parentNode = null;
    this.value = '';
    this.textContent = '';
    this.style = { display: '' };
  }
  get className() { return this._className; }
  set className(v) { this._className = v; DOM_WRITE_COUNTS.attrs++; }
  get id() { return this._id; }
  set id(v) { this._id = v; DOM_WRITE_COUNTS.attrs++; }
  get title() { return this._title; }
  set title(v) { this._title = v; DOM_WRITE_COUNTS.attrs++; }
  get hidden() { return this._hidden; }
  set hidden(v) { this._hidden = v; DOM_WRITE_COUNTS.attrs++; }
  get disabled() { return this._disabled; }
  set disabled(v) { this._disabled = v; DOM_WRITE_COUNTS.attrs++; }
  get firstChild() { return this.children.length ? this.children[0] : null; }
  get nextSibling() {
    if (!this.parentNode) return null;
    var i = this.parentNode.children.indexOf(this);
    return i >= 0 && i + 1 < this.parentNode.children.length ? this.parentNode.children[i + 1] : null;
  }
  set innerHTML(v) {
    this._html = v;
    DOM_WRITE_COUNTS.innerHTML++;
    this.children.forEach(n => { n.parentNode = null; });
    this.children = [];
  }
  get innerHTML() { return this._html; }
  insertBefore(node, ref) {
    DOM_WRITE_COUNTS.insertBefore++;
    if (node.parentNode) node.parentNode._removeChildInternal(node);
    var idx = ref == null ? this.children.length : this.children.indexOf(ref);
    if (idx === -1) idx = this.children.length;
    this.children.splice(idx, 0, node);
    node.parentNode = this;
    return node;
  }
  removeChild(node) {
    DOM_WRITE_COUNTS.removeChild++;
    this._removeChildInternal(node);
    return node;
  }
  _removeChildInternal(node) {
    var idx = this.children.indexOf(node);
    if (idx !== -1) this.children.splice(idx, 1);
    node.parentNode = null;
  }
}

var DOM_WRITE_COUNTS = { innerHTML: 0, insertBefore: 0, removeChild: 0, attrs: 0 };
function resetWriteCounts() { DOM_WRITE_COUNTS = { innerHTML: 0, insertBefore: 0, removeChild: 0, attrs: 0 }; }

// ---- Fake localStorage (same pattern every verify_*_repository.js uses) ----
function makeFakeStorage(seed) {
  const store = Object.assign({}, seed || {});
  return {
    getItem: function (k) { return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; },
    setItem: function (k, v) { store[k] = String(v); },
    _dump: function () { return store; }
  };
}

/**
 * Loads a CommonJS file via Node's own Module wrapper so its internal
 * relative require() calls resolve exactly as they would from its real
 * on-disk location. Identical technique to
 * verify_children_repository_integration.js's / verify_fees_dom_recycler.js's
 * loadModule().
 */
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

function setGlobals(extraGlobals) {
  Object.keys(extraGlobals).forEach(function (k) { global[k] = extraGlobals[k]; });
}

async function main() {
  console.log('================================================================');
  console.log('PHASE 16.14 — DomRecycler Migration (Children) — Verification');
  console.log('================================================================\n');

  const childrenJsPath = path.join(__dirname, '..', 'modules', 'children.js');
  const domDir = path.join(__dirname, '..', 'core', 'dom');

  // ---- Load the REAL js/core/dom/*.js files onto `global`, exactly as
  //      index.html's <script> tags would, so children.js's
  //      window.DomRecycler / window.DomKeyIndex checks see the genuine
  //      PHASE 16.6/16.9 implementation, not a stand-in. ----
  global.window = global;
  global.document = { createElement: function (tag) { return new FakeElement(tag); } };
  delete require.cache[require.resolve(path.join(domDir, 'DomKeyIndex.js'))];
  delete require.cache[require.resolve(path.join(domDir, 'DomNodeFactory.js'))];
  delete require.cache[require.resolve(path.join(domDir, 'DomPatch.js'))];
  delete require.cache[require.resolve(path.join(domDir, 'DomRecycler.js'))];
  require(path.join(domDir, 'DomKeyIndex.js'));
  require(path.join(domDir, 'DomNodeFactory.js'));
  require(path.join(domDir, 'DomPatch.js'));
  require(path.join(domDir, 'DomRecycler.js'));

  const DomKeyIndex = global.DomKeyIndex;

  // ---- Fake elements the rest of children.js reads via val()/getElementById ----
  const fakeElements = {};
  function getEl(id) {
    if (!fakeElements[id]) fakeElements[id] = new FakeElement('div');
    return fakeElements[id];
  }

  const fakeStorage = makeFakeStorage({});
  const fakeIndexedDB = new FakeIndexedDB();

  const sandboxGlobals = {
    localStorage: fakeStorage,
    indexedDB: fakeIndexedDB,
    window: global,
    DomRecycler: global.DomRecycler,
    DomKeyIndex: global.DomKeyIndex,
    data: { children: [], cases: [] },
    editIdx: { children: -1 },
    document: {
      createElement: function (tag) { return new FakeElement(tag); },
      getElementById: function (id) { return getEl(id); }
    },
    toast: function () {},
    updateBadges: function () {},
    closeModal: function () {},
    populateCaseDropdown: function () {},
    formatDate: function (d) { return d || '—'; },
    val: function (id) { const el = fakeElements[id]; return el ? el.value : ''; },
    uid: function () { return 'test-uid-' + Math.random().toString(36).slice(2, 8); },
    collectForm: function () { return {}; },
    fillForm: function () {},
    resetForm: function () {},
    ApiService: { syncRow: function () {}, deleteData: function () {} },
    syncToSheets: function () {},
    API_URL: '',
    saveLocal: function () {},
    confirm: function () { return true; },
    console: console
  };

  setGlobals(sandboxGlobals);
  const childrenModule = loadModule(childrenJsPath);
  await childrenModule.ensureChildrenRepositoryReady();

  // childrenTableBody / childrenMobileList must be the SAME live
  // containers across every render() call in this harness (getEl()
  // caches them), exactly matching how a real page keeps one
  // #childrenTableBody / #childrenMobileList element across repeated
  // renderChildren() calls.
  const tb = getEl('childrenTableBody');
  const ml = getEl('childrenMobileList');
  getEl('childrenEmpty');
  getEl('searchChildren');

  async function makeChild(overrides) {
    const base = {
      'رقم_القضية': '2026/100',
      'الاسم': 'طفل',
      'السن': '5',
      'المدرسة': 'مدرسة النور',
      'الحضانة_الحالية': 'الأم',
      'محل_الإقامة': 'القاهرة',
      'النفقة_الحالية': '500'
    };
    return childrenModule.childrenRepository.create(Object.assign(base, overrides));
  }

  // ---- A. Initial Create -------------------------------------------------
  await asyncSection('A. Initial render creates one <tr>/one m-card per child, with correct className on both containers', async () => {
    await makeChild({ 'الاسم': 'أحمد علي', 'رقم_القضية': '2026/1' });
    await makeChild({ 'الاسم': 'سارة محمود', 'رقم_القضية': '2026/2' });

    resetWriteCounts();
    childrenModule.renderChildren();

    countingAssert(tb.children.length === 2, 'expected 2 <tr> nodes, got ' + tb.children.length);
    countingAssert(ml.children.length === 2, 'expected 2 m-card nodes, got ' + ml.children.length);
    countingAssert(tb.children[0].className === '', '<tr> has no className, got "' + tb.children[0].className + '"');
    countingAssert(ml.children[0].className === 'm-card', 'card 0 className, got "' + ml.children[0].className + '"');
    countingAssert(ml.children[1].className === 'm-card', 'card 1 className, got "' + ml.children[1].className + '"');
    countingAssert(tb.children[0].innerHTML.indexOf('أحمد علي') !== -1, 'row 0 content present');
    countingAssert(ml.children[1].innerHTML.indexOf('سارة محمود') !== -1, 'card 1 content present');
  });

  // ---- B. Reuse: zero DOM writes ------------------------------------------
  section('B. Re-rendering with no data changes performs ZERO DOM writes on either container', () => {
    const tbNodesBefore = tb.children.slice();
    const mlNodesBefore = ml.children.slice();
    resetWriteCounts();
    childrenModule.renderChildren();

    countingAssert(DOM_WRITE_COUNTS.innerHTML === 0, 'expected zero innerHTML writes, got ' + DOM_WRITE_COUNTS.innerHTML);
    countingAssert(DOM_WRITE_COUNTS.insertBefore === 0, 'expected zero insertBefore calls, got ' + DOM_WRITE_COUNTS.insertBefore);
    countingAssert(DOM_WRITE_COUNTS.attrs === 0, 'expected zero attribute writes (no options.attrs used), got ' + DOM_WRITE_COUNTS.attrs);
    countingAssert(tb.children[0] === tbNodesBefore[0] && tb.children[1] === tbNodesBefore[1], 'same <tr> node identities reused');
    countingAssert(ml.children[0] === mlNodesBefore[0] && ml.children[1] === mlNodesBefore[1], 'same m-card node identities reused');
  });

  // ---- C. Content Update ---------------------------------------------------
  await asyncSection('C. Editing a child field updates content on the SAME node in both containers', async () => {
    const rec = childrenModule.childrenRepository.getAll()[0];
    const rowBefore = tb.children[0];
    const cardBefore = ml.children[0];

    resetWriteCounts();
    await childrenModule.childrenRepository.update(rec[childrenModule.CHILDREN_ID_FIELD], { 'المدرسة': 'مدرسة الأمل' });
    childrenModule.renderChildren();

    countingAssert(tb.children[0] === rowBefore, '<tr> identity preserved for a content-only change');
    countingAssert(ml.children[0] === cardBefore, 'm-card identity preserved for a content-only change');
    countingAssert(tb.children[0].innerHTML.indexOf('مدرسة الأمل') !== -1, 'updated school present in row');
    countingAssert(DOM_WRITE_COUNTS.attrs === 0, 'children has no attrs() layer — no attribute writes expected, got ' + DOM_WRITE_COUNTS.attrs);
  });

  // ---- D. Delete ------------------------------------------------------------
  await asyncSection('D. Deleting a child removes exactly its node from both containers', async () => {
    const all = childrenModule.childrenRepository.getAll();
    const idToDelete = all[0][childrenModule.CHILDREN_ID_FIELD];
    const survivingName = all[1]['الاسم'];

    await childrenModule.childrenRepository.delete(idToDelete);
    childrenModule.renderChildren();

    countingAssert(tb.children.length === 1, 'expected exactly 1 remaining <tr>');
    countingAssert(ml.children.length === 1, 'expected exactly 1 remaining m-card');
    countingAssert(tb.children[0].innerHTML.indexOf(survivingName) !== -1, 'the surviving row is the correct one');
    countingAssert(ml.children[0].innerHTML.indexOf(survivingName) !== -1, 'the surviving card is the correct one');
  });

  // ---- E. Insert --------------------------------------------------------------
  await asyncSection('E. Adding a new child creates exactly one new node in each container, existing nodes untouched', async () => {
    const rowBefore = tb.children[0];
    const cardBefore = ml.children[0];
    resetWriteCounts();
    await makeChild({ 'الاسم': 'محمد سعيد', 'رقم_القضية': '2026/3' });
    childrenModule.renderChildren();

    countingAssert(tb.children.length === 2, 'expected 2 <tr> nodes after add');
    countingAssert(ml.children.length === 2, 'expected 2 m-card nodes after add');
    countingAssert(tb.children[0] === rowBefore, 'existing <tr> identity preserved');
    countingAssert(ml.children[0] === cardBefore, 'existing m-card identity preserved');
    countingAssert(ml.children[1].className === 'm-card', 'new card has correct className on create');
    countingAssert(tb.children[1].innerHTML.indexOf('محمد سعيد') !== -1, 'new row content present');
    countingAssert(ml.children[1].innerHTML.indexOf('محمد سعيد') !== -1, 'new card content present');
  });

  // ---- F. Filter (search) -----------------------------------------------------
  await asyncSection('F. Free-text search narrows and restores the visible set correctly on both containers', async () => {
    fakeElements['searchChildren'].value = 'محمد سعيد';
    childrenModule.renderChildren();
    countingAssert(tb.children.length === 1, 'filtered table shows exactly 1 row');
    countingAssert(ml.children.length === 1, 'filtered mobile list shows exactly 1 card');
    countingAssert(tb.children[0].innerHTML.indexOf('محمد سعيد') !== -1, 'filtered row is the correct one');

    fakeElements['searchChildren'].value = '';
    childrenModule.renderChildren();
    countingAssert(tb.children.length === 2, 'unfiltered table restores both rows');
    countingAssert(ml.children.length === 2, 'unfiltered mobile list restores both cards');
  });

  // ---- G. Reorder — N/A ---------------------------------------------------
  section('G. Reorder — not applicable (renderChildren() applies no sort; documented, not a gap)', () => {
    // ChildrenRepository.search() applies no sort unless queryModel.sort
    // is explicitly passed (which renderChildren() never does — see
    // file header "SEARCH" note), so row order always matches
    // insertion order. There is therefore no reorder path for
    // DomPatch.position()'s move branch to exercise here, unlike
    // Sessions (sorted by التاريخ). This is a pre-existing, documented
    // behavior of Children, not a migration gap — matching Fees'
    // identical documented no-op.
    countingAssert(true, 'documented no-op');
  });

  // ---- H. Empty State -----------------------------------------------------
  await asyncSection('H. Emptying the visible set clears both containers and shows the empty-state element', async () => {
    const all = childrenModule.childrenRepository.getAll();
    for (const rec of all) {
      await childrenModule.childrenRepository.delete(rec[childrenModule.CHILDREN_ID_FIELD]);
    }
    childrenModule.renderChildren();

    countingAssert(tb.children.length === 0, 'table cleared when no children match');
    countingAssert(ml.children.length === 0, 'mobile list cleared when no children match');
    countingAssert(fakeElements['childrenEmpty'].style.display === '', 'empty-state element shown');
  });

  // ---- I. Fallback -----------------------------------------------------------
  await asyncSection('I. If DomRecycler.reconcile() throws, renderChildren() falls back to a correct full rebuild on both containers', async () => {
    await makeChild({ 'الاسم': 'فاطمة كريم', 'رقم_القضية': '2026/4' });

    const realReconcile = global.DomRecycler.reconcile;
    global.DomRecycler.reconcile = function () { throw new Error('forced failure for fallback test'); };

    resetWriteCounts();
    childrenModule.renderChildren();

    global.DomRecycler.reconcile = realReconcile;

    countingAssert(tb.children.length === 0, 'legacy fallback assigns a raw HTML string, not live child nodes, in this harness (matches verify_dom_recycler.js test I / verify_fees_dom_recycler.js test I)');
    countingAssert(ml.children.length === 0, 'same for the mobile list container');
    countingAssert(tb.innerHTML.indexOf('فاطمة كريم') !== -1, 'fallback table output still contains child content');
    countingAssert(ml.innerHTML.indexOf('m-card') !== -1, 'fallback mobile output still contains the m-card wrapper');
    countingAssert(ml.innerHTML.indexOf('فاطمة كريم') !== -1, 'fallback mobile output still contains child content');

    // Confirm recovery: next normal render (real reconcile restored)
    // starts clean and recycles correctly again.
    childrenModule.renderChildren();
    const all = childrenModule.childrenRepository.getAll();
    countingAssert(tb.children.length === all.length, 'table recycler resumes normal operation after the forced failure is cleared');
    countingAssert(ml.children.length === all.length, 'mobile list recycler resumes normal operation after the forced failure is cleared');
  });

  // ---- J. Node Identity (post-empty reset, no stale references) -----------
  await asyncSection('J. A later re-add after emptying creates fresh nodes in both containers (no stale key-index carried across)', async () => {
    const all = childrenModule.childrenRepository.getAll();
    for (const rec of all) {
      await childrenModule.childrenRepository.delete(rec[childrenModule.CHILDREN_ID_FIELD]);
    }
    childrenModule.renderChildren();
    countingAssert(tb.children.length === 0 && ml.children.length === 0, 'both containers cleared before re-add');

    await makeChild({ 'الاسم': 'خالد إبراهيم', 'رقم_القضية': '2026/5' });
    resetWriteCounts();
    childrenModule.renderChildren();

    countingAssert(tb.children.length === 1, 'exactly one row after re-adding post-empty');
    countingAssert(ml.children.length === 1, 'exactly one card after re-adding post-empty');
    countingAssert(tb.children[0].innerHTML.indexOf('خالد إبراهيم') !== -1, 'fresh row has correct content (no stale key-index carried across the empty state)');
    countingAssert(ml.children[0].innerHTML.indexOf('خالد إبراهيم') !== -1, 'fresh card has correct content (no stale key-index carried across the empty state)');
    countingAssert(fakeElements['childrenEmpty'].style.display === 'none', 'empty-state element hidden again');
  });

  // ---- Summary ------------------------------------------------------------
  console.log('\n================================================================');
  console.log('SUMMARY: ' + passed + ' passed, ' + failed + ' failed, ' + assertionCount + ' assertions');
  console.log('================================================================');
  if (failed > 0) {
    console.log('\nFAILURES:');
    failures.forEach(f => console.log('  - ' + f));
    process.exit(1);
  } else {
    process.exit(0);
  }
}

main().catch(function (e) {
  console.error('FATAL:', e);
  process.exit(1);
});
