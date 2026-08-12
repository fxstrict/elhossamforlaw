/**
 * verify_templates_dom_recycler.js
 * ================================================================
 * PHASE 16.16 — DomRecycler Migration (Templates) — Verification
 * ================================================================
 * Standalone Node harness (`node js/tests/verify_templates_dom_recycler.js`,
 * no browser required). Loads the REAL js/modules/templates.js (via the
 * same vm/Module.wrap technique verify_templates_repository_integration.js
 * and verify_library_dom_recycler.js already use) against a REAL
 * TemplatesRepository (backed by the fake localStorage/indexedDB doubles
 * every verify_*_repository*.js harness uses) and the REAL
 * js/core/dom/{DomKeyIndex,DomNodeFactory,DomPatch,DomRecycler}.js
 * files — exercising renderTemplates() end-to-end against a full fake
 * DOM tree (the same FakeElement shape verify_dom_recycler.js /
 * verify_library_dom_recycler.js use: createElement/insertBefore/
 * removeChild/firstChild/nextSibling/parentNode/innerHTML/className/
 * id/title/hidden/disabled).
 *
 * No production file is modified by this harness. It is read-only with
 * respect to js/modules/templates.js and js/core/dom/*.
 *
 * This does NOT re-test DomRecycler.reconcile()'s own internal
 * mechanics (already covered by verify_dom_recycler.js) — it tests
 * renderTemplates() itself: that it wires reconcile() correctly, with
 * the correct key/tag/className/render (no attrs() — same shape as
 * Library 16.15 / Sessions 16.11), and falls back correctly.
 *
 * Coverage (same shape as verify_library_dom_recycler.js):
 *   A. Initial Create        F. Move (reorder via filter re-query)
 *   B. Reuse                 G. Filter (category tab)
 *   C. Content Update        H. Forced Fallback
 *   D. Delete                I. No-op Render
 *   E. Insert                J. Node Identity (Empty State reset)
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
//      verify_library_dom_recycler.js) ----

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
    this.href = '';
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
 * verify_templates_repository_integration.js's / verify_library_dom_recycler.js's
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
  console.log('PHASE 16.16 — DomRecycler Migration (Templates) — Verification');
  console.log('================================================================\n');

  const templatesJsPath = path.join(__dirname, '..', 'modules', 'templates.js');
  const domDir = path.join(__dirname, '..', 'core', 'dom');

  // ---- Load the REAL js/core/dom/*.js files onto `global`, exactly as
  //      index.html's <script> tags would, so templates.js's
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

  // ---- Fake elements the rest of templates.js reads via getElementById ----
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
    data: { templates: [] },
    editIdx: { templates: -1 },
    currentTplFilter: 'all',
    document: {
      createElement: function (tag) { return new FakeElement(tag); },
      getElementById: function (id) { return getEl(id); }
    },
    toast: function () {},
    closeModal: function () {},
    val: function (id) { const el = fakeElements[id]; return el ? el.value : ''; },
    uid: function () { return 'test-uid-' + Math.random().toString(36).slice(2, 8); },
    collectForm: function () { return {}; },
    fillForm: function () {},
    saveLocal: function () {},
    confirm: function () { return true; },
    console: console
  };

  setGlobals(sandboxGlobals);
  const tplModule = loadModule(templatesJsPath);
  await tplModule.ensureTemplatesRepositoryReady();

  // templatesGrid must be the SAME live container across every render()
  // call in this harness (getEl() caches it), exactly matching how a
  // real page keeps one #templatesGrid element across repeated
  // renderTemplates() calls. templatesEmpty/templateTabs also need to
  // pre-exist since renderTemplates() unconditionally touches them
  // every call.
  const container = getEl('templatesGrid');
  getEl('templatesEmpty');
  getEl('templateTabs');

  async function makeTemplate(overrides) {
    const base = {
      'العنوان': 'نموذج',
      'القسم': 'مدني',
      'النوع': 'pdf'
    };
    return tplModule.templatesRepository.create(Object.assign(base, overrides));
  }

  // ---- A. Initial Create ---------------------------------------------
  await asyncSection('A. Initial render creates one outer node per template, with correct className', async () => {
    await makeTemplate({ 'العنوان': 'نموذج أول', 'القسم': 'مدني' });
    await makeTemplate({ 'العنوان': 'نموذج ثاني', 'القسم': 'جنائي' });

    resetWriteCounts();
    tplModule.renderTemplates();

    countingAssert(container.children.length === 2, 'expected 2 template nodes, got ' + container.children.length);
    countingAssert(container.children[0].className === 'lib-card', 'template 0 className, got "' + container.children[0].className + '"');
    countingAssert(container.children[1].className === 'lib-card', 'template 1 className, got "' + container.children[1].className + '"');
    countingAssert(container.children[0].innerHTML.indexOf('نموذج أول') !== -1, 'template 0 content present');
    countingAssert(container.children[1].innerHTML.indexOf('نموذج ثاني') !== -1, 'template 1 content present');
  });

  // ---- B. Reuse: zero DOM writes on the grid itself --------------------------
  section('B. Re-rendering with no data changes performs ZERO DOM writes on #templatesGrid', () => {
    // NOTE: renderTemplates() unconditionally rebuilds #templateTabs's
    // tab-button list every call (pre-existing behavior, unchanged by
    // this migration — same shape as Library's #filterLibCat rebuild).
    // That is ONE expected innerHTML write on a DIFFERENT element every
    // render, unrelated to DomRecycler/#templatesGrid correctness — so
    // this test asserts the grid container's own children are
    // untouched, rather than a global zero-innerHTML-writes count.
    const nodesBefore = container.children.slice();
    const gridHtmlBefore = container.innerHTML;
    resetWriteCounts();
    tplModule.renderTemplates();

    countingAssert(DOM_WRITE_COUNTS.insertBefore === 0, 'expected zero insertBefore calls, got ' + DOM_WRITE_COUNTS.insertBefore);
    countingAssert(DOM_WRITE_COUNTS.removeChild === 0, 'expected zero removeChild calls, got ' + DOM_WRITE_COUNTS.removeChild);
    countingAssert(DOM_WRITE_COUNTS.attrs === 0, 'expected zero attribute writes, got ' + DOM_WRITE_COUNTS.attrs);
    countingAssert(container.children[0] === nodesBefore[0] && container.children[1] === nodesBefore[1], 'same node identities reused');
    countingAssert(container.innerHTML === gridHtmlBefore, '#templatesGrid own innerHTML unchanged (only the recycled per-node content, never rebuilt as a whole string)');
  });

  // ---- C. Content Update ------------------------------------------------
  await asyncSection('C. Editing a template field updates content on the same node', async () => {
    const rec = tplModule.templatesRepository.getAll()[0];
    const nodeBefore = container.children[0];

    resetWriteCounts();
    await tplModule.templatesRepository.update(rec[tplModule.TEMPLATES_ID_FIELD], { 'القسم': 'تجاري' });
    tplModule.renderTemplates();

    countingAssert(container.children[0] === nodeBefore, 'node identity preserved for a content-only change');
    countingAssert(container.children[0].innerHTML.indexOf('تجاري') !== -1, 'updated category present');
    countingAssert(DOM_WRITE_COUNTS.attrs === 0, 'lib-card has no attrs() layer — no attribute writes expected, got ' + DOM_WRITE_COUNTS.attrs);
  });

  // ---- D. Delete ----------------------------------------------------------
  await asyncSection('D. Deleting a template removes exactly its node', async () => {
    const all = tplModule.templatesRepository.getAll();
    const idToDelete = all[0][tplModule.TEMPLATES_ID_FIELD];
    const survivingTitle = all[1]['العنوان'];

    await tplModule.templatesRepository.delete(idToDelete);
    tplModule.renderTemplates();

    countingAssert(container.children.length === 1, 'expected exactly 1 remaining template node');
    countingAssert(container.children[0].innerHTML.indexOf(survivingTitle) !== -1, 'the surviving template is the correct one');
  });

  // ---- E. Insert ------------------------------------------------------------
  await asyncSection('E. Adding a new template creates exactly one new node, existing node untouched', async () => {
    const nodeBefore = container.children[0];
    resetWriteCounts();
    await makeTemplate({ 'العنوان': 'نموذج ثالث', 'القسم': 'جنائي' });
    tplModule.renderTemplates();

    countingAssert(container.children.length === 2, 'expected 2 template nodes after add');
    countingAssert(container.children[0] === nodeBefore, 'existing node identity preserved');
    countingAssert(container.children[1].className === 'lib-card', 'new node has correct className on create');
    countingAssert(container.children[1].innerHTML.indexOf('نموذج ثالث') !== -1, 'new template content present');
  });

  // ---- F. Move (reorder via filter re-query) -------------------------------
  await asyncSection('F. A category filter that narrows results moves/preserves node identity correctly', async () => {
    // renderTemplates() re-queries templatesRepository.getAll()/filter()
    // every call, driven by currentTplFilter — no fixed sort field, so
    // this exercises the same "narrow then restore" identity-preservation
    // path verify_library_dom_recycler.js's test F uses (Library has no
    // sort either), adapted to Templates' actual filter mechanism
    // (currentTplFilter + filterTemplates(), not a DOM <select>).
    const all = tplModule.templatesRepository.getAll();
    const third = all.filter(r => r['العنوان'] === 'نموذج ثالث')[0];
    const nodeBefore = container.children.filter(n => n.innerHTML.indexOf('نموذج ثالث') !== -1)[0];

    tplModule.filterTemplates('جنائي');
    tplModule.renderTemplates();

    countingAssert(container.children.length === 2, 'both جنائي templates match the narrowed filter');
    countingAssert(container.children.indexOf(nodeBefore) !== -1, 'نموذج ثالث kept its original node identity (not recreated) across a re-render with a narrower (but still matching) filter');

    tplModule.filterTemplates('all');
    tplModule.renderTemplates();
    countingAssert(container.children.length === 2, 'clearing the filter restores both remaining templates');
  });

  // ---- G. Filter (category tab) -------------------------------------------------
  await asyncSection('G. Category tab filter narrows and restores the visible set correctly', async () => {
    tplModule.filterTemplates('جنائي');
    tplModule.renderTemplates();
    countingAssert(container.children.length === 2, 'both remaining templates are جنائي, filtered view shows 2');

    await makeTemplate({ 'العنوان': 'نموذج رابع مدني', 'القسم': 'مدني' });
    tplModule.renderTemplates();
    countingAssert(container.children.length === 2, 'filtered (جنائي) view still shows exactly 2 after adding a مدني template');

    tplModule.filterTemplates('all');
    tplModule.renderTemplates();
    countingAssert(container.children.length === 3, 'unfiltered view restores all 3 templates');
  });

  // ---- H. Forced Fallback --------------------------------------------------
  await asyncSection('H. If DomRecycler.reconcile() throws, renderTemplates() falls back to a correct full rebuild', async () => {
    // Force a failure the same way verify_dom_recycler.js test F/G and
    // verify_library_dom_recycler.js test H do: temporarily replace
    // DomRecycler.reconcile with a throwing stub, exactly simulating
    // "any internal reconcile failure" from the SAFETY contract,
    // without touching js/core/dom/*.js on disk.
    const realReconcile = global.DomRecycler.reconcile;
    global.DomRecycler.reconcile = function () { throw new Error('forced failure for fallback test'); };

    resetWriteCounts();
    tplModule.renderTemplates();

    global.DomRecycler.reconcile = realReconcile;

    countingAssert(container.children.length === 0, 'legacy fallback assigns a raw HTML string, not live child nodes, in this harness (matches verify_dom_recycler.js / verify_library_dom_recycler.js test H)');
    countingAssert(container.innerHTML.indexOf('lib-card') !== -1, 'fallback output still contains the lib-card wrapper');
    countingAssert(container.innerHTML.indexOf('نموذج ثاني') !== -1, 'fallback output still contains template content');

    // Confirm recovery: next normal render (real reconcile restored)
    // starts clean and recycles correctly again.
    tplModule.renderTemplates();
    const all = tplModule.templatesRepository.getAll();
    countingAssert(container.children.length === all.length, 'recycler resumes normal operation after the forced failure is cleared');
  });

  // ---- I. No-op Render -----------------------------------------------------
  section('I. A render touching nothing never recreates or repositions any node in #templatesGrid', () => {
    // Same "#templateTabs rebuilds every call" caveat as test B — this
    // asserts #templatesGrid's own writes/identities, not a global
    // zero count.
    const nodesBefore = container.children.slice();
    resetWriteCounts();
    tplModule.renderTemplates(); // no data change at all
    countingAssert(DOM_WRITE_COUNTS.attrs === 0 && DOM_WRITE_COUNTS.insertBefore === 0 && DOM_WRITE_COUNTS.removeChild === 0, 'a no-op render must cost zero grid-node creation/attribute/position writes');
    countingAssert(container.children.every((n, i) => n === nodesBefore[i]), 'every node identity preserved');
  });

  // ---- J. Node Identity (Empty State reset) --------------------------------
  await asyncSection('J. Emptying the visible set resets DomKeyIndex; a later re-add creates fresh nodes (no stale references)', async () => {
    const all = tplModule.templatesRepository.getAll();
    for (const rec of all) {
      await tplModule.templatesRepository.delete(rec[tplModule.TEMPLATES_ID_FIELD]);
    }
    tplModule.renderTemplates();

    countingAssert(container.children.length === 0, 'container cleared when no templates match');
    countingAssert(fakeElements['templatesEmpty'].style.display === '', 'empty-state element shown');

    await makeTemplate({ 'العنوان': 'نموذج جديد بعد التفريغ', 'القسم': 'مدني' });
    resetWriteCounts();
    tplModule.renderTemplates();

    countingAssert(container.children.length === 1, 'exactly one node after re-adding post-empty');
    countingAssert(container.children[0].innerHTML.indexOf('نموذج جديد بعد التفريغ') !== -1, 'fresh node has correct content (no stale key-index carried across the empty state)');
    countingAssert(fakeElements['templatesEmpty'].style.display === 'none', 'empty-state element hidden again');
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
