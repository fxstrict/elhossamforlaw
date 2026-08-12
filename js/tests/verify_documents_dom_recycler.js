/**
 * verify_documents_dom_recycler.js
 * ================================================================
 * PHASE 16.12 — DomRecycler Migration (Documents) — Verification
 * ================================================================
 * Standalone Node harness (`node js/tests/verify_documents_dom_recycler.js`,
 * no browser required). Loads the REAL js/modules/documents.js (via the
 * same vm/Module.wrap technique verify_documents_repository_integration.js,
 * verify_tasks_dom_recycler.js and verify_sessions_dom_recycler.js
 * already use) against a REAL DocumentsRepository (backed by the fake
 * localStorage/indexedDB doubles every verify_*_repository*.js harness
 * uses) and the REAL js/core/dom/{DomKeyIndex,DomNodeFactory,DomPatch,
 * DomRecycler}.js files — exercising renderDocuments() end-to-end
 * against TWO full fake DOM trees (desktop table body + mobile card
 * list), using the same FakeElement shape verify_dom_recycler.js /
 * verify_tasks_dom_recycler.js / verify_sessions_dom_recycler.js use.
 *
 * No production file is modified by this harness. It is read-only with
 * respect to js/modules/documents.js and js/core/dom/*.
 *
 * This does NOT re-test DomRecycler.reconcile()'s own internal
 * mechanics (already covered by verify_dom_recycler.js) — it tests
 * renderDocuments() itself: that it wires reconcile() correctly for
 * BOTH containers (table <tr>, mobile .m-card), with the correct
 * shared key, and falls back correctly.
 *
 * No attrs() layer: neither the desktop <tr> nor the mobile .m-card
 * has a variable outer className (see PHASE 16.12 report §2), so this
 * harness has no attrs-specific test section — matching the Clients
 * (16.7) precedent, not the Tasks (16.10) one.
 *
 * Coverage (per Phase 16.12 handoff prompt):
 *   A. Initial render        F. Move (reorder via sort-affecting update)
 *   B. Reuse                 G. Zero DOM writes (alias of B, both containers)
 *   C. Content update        H. Fallback
 *   D. Delete                I. Empty state reset
 *   E. Insert                J. Node identity preserved
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
//      verify_tasks_dom_recycler.js / verify_sessions_dom_recycler.js) ----

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
  console.log('PHASE 16.12 — DomRecycler Migration (Documents) — Verification');
  console.log('================================================================\n');

  const documentsJsPath = path.join(__dirname, '..', 'modules', 'documents.js');
  const domDir = path.join(__dirname, '..', 'core', 'dom');

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
    data: { documents: [], cases: [] },
    editIdx: { documents: -1 },
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
    ApiService: { syncRow: function () {}, deleteData: function () {} },
    saveLocal: function () {},
    confirm: function () { return true; },
    console: console
  };

  setGlobals(sandboxGlobals);
  const docsModule = loadModule(documentsJsPath);
  await docsModule.ensureDocumentsRepositoryReady();

  // documentsTableBody / documentsMobileList must be the SAME live
  // containers across every render() call in this harness (getEl()
  // caches them), exactly matching how a real page keeps the same two
  // elements across repeated renderDocuments() calls.
  const tbody = getEl('documentsTableBody');
  const mlist = getEl('documentsMobileList');

  async function makeDoc(overrides) {
    const base = {
      'اسم_المستند': 'مستند',
      'رقم_القضية': '1/2026',
      'نوع_المستند': 'عقد',
      'تاريخ_الإيداع': '2026-08-01'
    };
    return docsModule.documentsRepository.create(Object.assign(base, overrides));
  }

  // ---- A. Initial render -----------------------------------------------
  await asyncSection('A. Initial render creates one row + one card per document, correct classNames', async () => {
    await makeDoc({ 'اسم_المستند': 'مستند أول', 'تاريخ_الإيداع': '2026-08-01' });
    await makeDoc({ 'اسم_المستند': 'مستند ثاني', 'تاريخ_الإيداع': '2026-08-02' });

    resetWriteCounts();
    docsModule.renderDocuments();

    countingAssert(tbody.children.length === 2, 'expected 2 table rows, got ' + tbody.children.length);
    countingAssert(mlist.children.length === 2, 'expected 2 mobile cards, got ' + mlist.children.length);
    countingAssert(tbody.children[0].tagName === 'tr', 'desktop row tag is <tr>, got ' + tbody.children[0].tagName);
    countingAssert(tbody.children[0].className === '', 'desktop <tr> has no className, got "' + tbody.children[0].className + '"');
    countingAssert(mlist.children[0].className === 'm-card', 'mobile card className, got "' + mlist.children[0].className + '"');
    countingAssert(tbody.children[0].innerHTML.indexOf('مستند أول') !== -1, 'row 0 content present');
    countingAssert(mlist.children[0].innerHTML.indexOf('مستند أول') !== -1, 'card 0 content present');
  });

  // ---- B / G. Reuse: zero DOM writes on both containers -----------------
  section('B/G. Re-rendering with no data changes performs ZERO DOM writes on both containers', () => {
    const rowsBefore = tbody.children.slice();
    const cardsBefore = mlist.children.slice();
    resetWriteCounts();
    docsModule.renderDocuments();

    countingAssert(DOM_WRITE_COUNTS.innerHTML === 0, 'expected zero innerHTML writes, got ' + DOM_WRITE_COUNTS.innerHTML);
    countingAssert(DOM_WRITE_COUNTS.insertBefore === 0, 'expected zero insertBefore calls, got ' + DOM_WRITE_COUNTS.insertBefore);
    countingAssert(DOM_WRITE_COUNTS.attrs === 0, 'expected zero attribute writes (no attrs() layer), got ' + DOM_WRITE_COUNTS.attrs);
    countingAssert(tbody.children[0] === rowsBefore[0] && tbody.children[1] === rowsBefore[1], 'same row node identities reused');
    countingAssert(mlist.children[0] === cardsBefore[0] && mlist.children[1] === cardsBefore[1], 'same card node identities reused');
  });

  // ---- C. Content update ------------------------------------------------
  await asyncSection('C. Editing a document field updates content on the same row/card nodes', async () => {
    const rec = docsModule.documentsRepository.getAll()[0];
    const rowBefore = tbody.children[0];
    const cardBefore = mlist.children[0];

    resetWriteCounts();
    await docsModule.documentsRepository.update(rec[docsModule.DOCUMENTS_ID_FIELD], { 'نوع_المستند': 'إنذار' });
    docsModule.renderDocuments();

    countingAssert(tbody.children[0] === rowBefore, 'row node identity preserved for a content-only change');
    countingAssert(mlist.children[0] === cardBefore, 'card node identity preserved for a content-only change');
    countingAssert(tbody.children[0].innerHTML.indexOf('إنذار') !== -1, 'updated type present in row');
    countingAssert(mlist.children[0].innerHTML.indexOf('إنذار') !== -1, 'updated type present in card');
    countingAssert(DOM_WRITE_COUNTS.attrs === 0, 'no attrs() layer — no attribute writes expected, got ' + DOM_WRITE_COUNTS.attrs);
  });

  // ---- D. Delete ----------------------------------------------------------
  await asyncSection('D. Deleting a document removes exactly its row and its card', async () => {
    const all = docsModule.documentsRepository.getAll();
    const idToDelete = all[0][docsModule.DOCUMENTS_ID_FIELD];
    const survivingName = all[1]['اسم_المستند'];

    await docsModule.documentsRepository.delete(idToDelete);
    docsModule.renderDocuments();

    countingAssert(tbody.children.length === 1, 'expected exactly 1 remaining row');
    countingAssert(mlist.children.length === 1, 'expected exactly 1 remaining card');
    countingAssert(tbody.children[0].innerHTML.indexOf(survivingName) !== -1, 'surviving row is correct');
    countingAssert(mlist.children[0].innerHTML.indexOf(survivingName) !== -1, 'surviving card is correct');
  });

  // ---- E. Insert ------------------------------------------------------------
  await asyncSection('E. Adding a new document creates exactly one new row/card, existing ones untouched', async () => {
    const rowBefore = tbody.children[0];
    const cardBefore = mlist.children[0];
    resetWriteCounts();
    await makeDoc({ 'اسم_المستند': 'مستند ثالث', 'تاريخ_الإيداع': '2026-08-03' });
    docsModule.renderDocuments();

    countingAssert(tbody.children.length === 2, 'expected 2 rows after add');
    countingAssert(mlist.children.length === 2, 'expected 2 cards after add');
    countingAssert(tbody.children[0] === rowBefore, 'existing row identity preserved');
    countingAssert(mlist.children[0] === cardBefore, 'existing card identity preserved');
    countingAssert(tbody.children[1].innerHTML.indexOf('مستند ثالث') !== -1, 'new row content present');
    countingAssert(mlist.children[1].className === 'm-card', 'new card has correct className on create');
  });

  // ---- F. Move (reorder via filter add/remove) ---------------------------
  await asyncSection('F. Filtering to a subset then restoring exercises add/remove-then-reorder on both containers', async () => {
    // Give the newest document ("مستند ثالث") a distinct, currently-unique
    // type so filtering to it produces a genuine narrow-then-restore
    // (rather than accidentally filtering to zero results, which proves
    // nothing about the reconciler's add/remove path).
    const all = docsModule.documentsRepository.getAll();
    const third = all.filter(d => d['اسم_المستند'] === 'مستند ثالث')[0];
    await docsModule.documentsRepository.update(third[docsModule.DOCUMENTS_ID_FIELD], { 'نوع_المستند': 'مذكرة' });

    fakeElements['filterDocType'] = new FakeElement('select');
    try {
      fakeElements['filterDocType'].value = 'مذكرة';
      docsModule.renderDocuments();
      countingAssert(tbody.children.length === 1, 'filtered table shows exactly 1 row, got ' + tbody.children.length);
      countingAssert(mlist.children.length === 1, 'filtered mobile list shows exactly 1 card, got ' + mlist.children.length);
    } finally {
      // Always clear the filter, even if an assertion above throws, so a
      // failure in this section can never cascade into every later
      // section (which all assume an unfiltered view).
      fakeElements['filterDocType'].value = '';
      docsModule.renderDocuments();
    }
    countingAssert(tbody.children.length === 2, 'unfiltered table restores both rows');
    countingAssert(mlist.children.length === 2, 'unfiltered mobile list restores both cards');
  });

  // ---- H. Fallback --------------------------------------------------------
  await asyncSection('H. If DomRecycler.reconcile() throws, renderDocuments() falls back to a correct full rebuild on both containers', async () => {
    const realReconcile = global.DomRecycler.reconcile;
    global.DomRecycler.reconcile = function () { throw new Error('forced failure for fallback test'); };

    resetWriteCounts();
    docsModule.renderDocuments();

    global.DomRecycler.reconcile = realReconcile;

    countingAssert(tbody.children.length === 0, 'legacy fallback assigns a raw HTML string, not live child nodes (table)');
    countingAssert(mlist.children.length === 0, 'legacy fallback assigns a raw HTML string, not live child nodes (mobile list)');
    countingAssert(tbody.innerHTML.indexOf('<tr>') !== -1, 'fallback table output still contains <tr> wrappers');
    countingAssert(mlist.innerHTML.indexOf('m-card') !== -1, 'fallback mobile output still contains m-card wrapper');
    countingAssert(tbody.innerHTML.indexOf('مستند ثالث') !== -1, 'fallback output still contains document content');

    // Confirm recovery: next normal render (real reconcile restored)
    // starts clean and recycles correctly again.
    docsModule.renderDocuments();
    const all = docsModule.documentsRepository.getAll();
    countingAssert(tbody.children.length === all.length, 'recycler resumes normal operation on table after the forced failure is cleared');
    countingAssert(mlist.children.length === all.length, 'recycler resumes normal operation on mobile list after the forced failure is cleared');
  });

  // ---- I. Empty state reset -------------------------------------------------
  await asyncSection('I. Emptying the visible set resets DomKeyIndex on both containers; a later re-add creates fresh nodes', async () => {
    const all = docsModule.documentsRepository.getAll();
    for (const rec of all) {
      await docsModule.documentsRepository.delete(rec[docsModule.DOCUMENTS_ID_FIELD]);
    }
    docsModule.renderDocuments();

    countingAssert(tbody.children.length === 0, 'table cleared when no documents match');
    countingAssert(mlist.children.length === 0, 'mobile list cleared when no documents match');
    countingAssert(fakeElements['documentsEmpty'].style.display === '', 'empty-state element shown');

    await makeDoc({ 'اسم_المستند': 'مستند جديد بعد التفريغ', 'تاريخ_الإيداع': '2026-08-10' });
    resetWriteCounts();
    docsModule.renderDocuments();

    countingAssert(tbody.children.length === 1, 'exactly one row after re-adding post-empty');
    countingAssert(mlist.children.length === 1, 'exactly one card after re-adding post-empty');
    countingAssert(tbody.children[0].innerHTML.indexOf('مستند جديد بعد التفريغ') !== -1, 'fresh row has correct content (no stale key-index)');
    countingAssert(fakeElements['documentsEmpty'].style.display === 'none', 'empty-state element hidden again');
  });

  // ---- J. Node identity preserved (no-op render) ---------------------------
  section('J. A render touching nothing never recreates or repositions any row/card', () => {
    const rowsBefore = tbody.children.slice();
    const cardsBefore = mlist.children.slice();
    resetWriteCounts();
    docsModule.renderDocuments(); // no data change at all
    countingAssert(DOM_WRITE_COUNTS.innerHTML === 0 && DOM_WRITE_COUNTS.attrs === 0 && DOM_WRITE_COUNTS.insertBefore === 0, 'a no-op render must cost zero DOM writes of any kind');
    countingAssert(tbody.children.every((n, i) => n === rowsBefore[i]), 'every row node identity preserved');
    countingAssert(mlist.children.every((n, i) => n === cardsBefore[i]), 'every card node identity preserved');
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
