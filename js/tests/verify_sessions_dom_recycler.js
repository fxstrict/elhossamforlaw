/**
 * verify_sessions_dom_recycler.js
 * ================================================================
 * PHASE 16.11 — DomRecycler Migration (Sessions) — Verification
 * ================================================================
 * Standalone Node harness (`node js/tests/verify_sessions_dom_recycler.js`,
 * no browser required). Loads the REAL js/modules/sessions.js (via the
 * same vm/Module.wrap technique verify_sessions_repository_integration.js
 * and verify_tasks_dom_recycler.js already use) against a REAL
 * SessionsRepository (backed by the fake localStorage/indexedDB doubles
 * every verify_*_repository*.js harness uses) and the REAL
 * js/core/dom/{DomKeyIndex,DomNodeFactory,DomPatch,DomRecycler}.js
 * files — exercising renderSessions() end-to-end against a full fake
 * DOM tree (the same FakeElement shape verify_dom_recycler.js and
 * verify_tasks_dom_recycler.js use: createElement/insertBefore/
 * removeChild/firstChild/nextSibling/parentNode/innerHTML/className/
 * id/title/hidden/disabled).
 *
 * No production file is modified by this harness. It is read-only with
 * respect to js/modules/sessions.js and js/core/dom/*.
 *
 * This does NOT re-test DomRecycler.reconcile()'s own internal
 * mechanics (already covered by verify_dom_recycler.js) — it tests
 * renderSessions() itself: that it wires reconcile() correctly, with
 * the correct key/tag/className/render, and falls back correctly.
 *
 * Coverage (per Phase 16.11 handoff prompt, item "تاسعاً"):
 *   A. Initial Create        F. Move (reorder)
 *   B. Reuse                 G. Filter
 *   C. Content Update        H. Forced Fallback
 *   D. Delete                I. No-op Render
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
//      verify_tasks_dom_recycler.js) -------------------------------

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

/**
 * Loads a CommonJS file via Node's own Module wrapper so its internal
 * relative require() calls resolve exactly as they would from its real
 * on-disk location. Identical technique to
 * verify_sessions_repository_integration.js's / verify_tasks_dom_recycler.js's
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
  console.log('PHASE 16.11 — DomRecycler Migration (Sessions) — Verification');
  console.log('================================================================\n');

  const sessionsJsPath = path.join(__dirname, '..', 'modules', 'sessions.js');
  const domDir = path.join(__dirname, '..', 'core', 'dom');

  // ---- Load the REAL js/core/dom/*.js files onto `global`, exactly as
  //      index.html's <script> tags would, so sessions.js's
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

  // ---- Fake elements the rest of sessions.js reads via val()/getElementById ----
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
    data: { sessions: [], cases: [] },
    editIdx: { sessions: -1 },
    document: {
      createElement: function (tag) { return new FakeElement(tag); },
      getElementById: function (id) { return getEl(id); }
    },
    toast: function () {},
    updateBadges: function () {},
    closeModal: function () {},
    populateCaseDropdown: function () {},
    autofillSessionFromCase: function () {},
    formatDate: function (d) { return d || '—'; },
    formatTime: function (t) { return t || '—'; },
    parseLocalDate: function (d) { return d ? new Date(d + 'T00:00:00') : null; },
    urgencyBadge: function () { return ''; },
    statusBadge: function () { return ''; },
    sanitizeTime: function (t) { return t || ''; },
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
  const sessModule = loadModule(sessionsJsPath);
  await sessModule.ensureSessionsRepositoryReady();

  // sessionsListView must be the SAME live container across every
  // render() call in this harness (getEl() caches it), exactly matching
  // how a real page keeps one #sessionsListView element across repeated
  // renderSessions() calls.
  const container = getEl('sessionsListView');

  async function makeSession(overrides) {
    const base = {
      'التاريخ': '2026-08-01',
      'الوقت': '10:00',
      'الحالة': 'قادمة',
      'عنوان_القضية': 'قضية',
      'المحكمة': 'محكمة الجيزة'
    };
    return sessModule.sessionsRepository.create(Object.assign(base, overrides));
  }

  // ---- A. Initial Create ---------------------------------------------
  await asyncSection('A. Initial render creates one outer node per session, with correct className', async () => {
    await makeSession({ 'عنوان_القضية': 'جلسة أولى', 'التاريخ': '2026-08-01' });
    await makeSession({ 'عنوان_القضية': 'جلسة ثانية', 'التاريخ': '2026-08-02' });

    resetWriteCounts();
    sessModule.renderSessions();

    countingAssert(container.children.length === 2, 'expected 2 session nodes, got ' + container.children.length);
    countingAssert(container.children[0].className === 'session-item', 'session 0 className, got "' + container.children[0].className + '"');
    countingAssert(container.children[1].className === 'session-item', 'session 1 className, got "' + container.children[1].className + '"');
    countingAssert(container.children[0].innerHTML.indexOf('جلسة أولى') !== -1, 'session 0 content present');
    countingAssert(container.children[1].innerHTML.indexOf('جلسة ثانية') !== -1, 'session 1 content present');
  });

  // ---- B. Reuse: zero DOM writes --------------------------------------
  section('B. Re-rendering with no data changes performs ZERO DOM writes', () => {
    const nodesBefore = container.children.slice();
    resetWriteCounts();
    sessModule.renderSessions();

    countingAssert(DOM_WRITE_COUNTS.innerHTML === 0, 'expected zero innerHTML writes, got ' + DOM_WRITE_COUNTS.innerHTML);
    countingAssert(DOM_WRITE_COUNTS.insertBefore === 0, 'expected zero insertBefore calls, got ' + DOM_WRITE_COUNTS.insertBefore);
    countingAssert(DOM_WRITE_COUNTS.attrs === 0, 'expected zero attribute writes, got ' + DOM_WRITE_COUNTS.attrs);
    countingAssert(container.children[0] === nodesBefore[0] && container.children[1] === nodesBefore[1], 'same node identities reused');
  });

  // ---- C. Content Update ------------------------------------------------
  await asyncSection('C. Editing a session field updates content on the same node', async () => {
    const rec = sessModule.sessionsRepository.getAll()[0];
    const nodeBefore = container.children[0];

    resetWriteCounts();
    await sessModule.sessionsRepository.update(rec[sessModule.SESSIONS_ID_FIELD], { 'المحكمة': 'محكمة القاهرة الجديدة' });
    sessModule.renderSessions();

    countingAssert(container.children[0] === nodeBefore, 'node identity preserved for a content-only change');
    countingAssert(container.children[0].innerHTML.indexOf('محكمة القاهرة الجديدة') !== -1, 'updated court name present');
    countingAssert(DOM_WRITE_COUNTS.attrs === 0, 'session-item has no attrs() layer — no attribute writes expected, got ' + DOM_WRITE_COUNTS.attrs);
  });

  // ---- D. Delete ----------------------------------------------------------
  await asyncSection('D. Deleting a session removes exactly its node', async () => {
    const all = sessModule.sessionsRepository.getAll();
    const idToDelete = all[0][sessModule.SESSIONS_ID_FIELD];
    const survivingTitle = all[1]['عنوان_القضية'];

    await sessModule.sessionsRepository.delete(idToDelete);
    sessModule.renderSessions();

    countingAssert(container.children.length === 1, 'expected exactly 1 remaining session node');
    countingAssert(container.children[0].innerHTML.indexOf(survivingTitle) !== -1, 'the surviving session is the correct one');
  });

  // ---- E. Insert ------------------------------------------------------------
  await asyncSection('E. Adding a new session creates exactly one new node, existing node untouched', async () => {
    const nodeBefore = container.children[0];
    resetWriteCounts();
    await makeSession({ 'عنوان_القضية': 'جلسة ثالثة', 'التاريخ': '2026-08-03' });
    sessModule.renderSessions();

    countingAssert(container.children.length === 2, 'expected 2 session nodes after add');
    countingAssert(container.children[0] === nodeBefore, 'existing node identity preserved');
    countingAssert(container.children[1].className === 'session-item', 'new node has correct className on create');
    countingAssert(container.children[1].innerHTML.indexOf('جلسة ثالثة') !== -1, 'new session content present');
  });

  // ---- F. Move (reorder) -----------------------------------------------------
  await asyncSection('F. A date change that alters sort order moves the node and preserves identity', async () => {
    // renderSessions() always sorts by التاريخ asc. Moving the earlier
    // ("جلسة ثانية", 2026-08-02) session to a LATER date than
    // "جلسة ثالثة" (2026-08-03) forces a reorder in the recycler's
    // single forward walk, exercising DomPatch.position()'s move path
    // (not just create/remove).
    const all = sessModule.sessionsRepository.getAll();
    const second = all.filter(r => r['عنوان_القضية'] === 'جلسة ثانية')[0];
    const nodeBefore = container.children.filter(n => n.innerHTML.indexOf('جلسة ثانية') !== -1)[0];

    resetWriteCounts();
    await sessModule.sessionsRepository.update(second[sessModule.SESSIONS_ID_FIELD], { 'التاريخ': '2026-08-04' });
    sessModule.renderSessions();

    countingAssert(container.children.length === 2, 'still 2 session nodes after a date-only change');
    countingAssert(DOM_WRITE_COUNTS.insertBefore >= 1, 'expected at least one insertBefore call for the reorder, got ' + DOM_WRITE_COUNTS.insertBefore);
    countingAssert(container.children.indexOf(nodeBefore) !== -1, 'the moved session kept its original node identity (not recreated)');
    countingAssert(container.children[container.children.length - 1] === nodeBefore, 'moved session is now last (latest date, ascending sort)');
  });

  // ---- G. Filter ----------------------------------------------------------
  await asyncSection('G. Status filter narrows and restores the visible set correctly', async () => {
    const all = sessModule.sessionsRepository.getAll();
    const third = all.filter(r => r['عنوان_القضية'] === 'جلسة ثالثة')[0];
    await sessModule.sessionsRepository.update(third[sessModule.SESSIONS_ID_FIELD], { 'الحالة': 'منتهية' });

    fakeElements['filterSessionStatus'] = new FakeElement('select');
    fakeElements['filterSessionStatus'].value = 'منتهية';
    sessModule.renderSessions();
    countingAssert(container.children.length === 1, 'filtered view shows exactly 1 session');
    countingAssert(container.children[0].innerHTML.indexOf('جلسة ثالثة') !== -1, 'filtered session is the correct one');

    fakeElements['filterSessionStatus'].value = '';
    sessModule.renderSessions();
    countingAssert(container.children.length === 2, 'unfiltered view restores both sessions');
  });

  // ---- H. Forced Fallback --------------------------------------------------
  await asyncSection('H. If DomRecycler.reconcile() throws, renderSessions() falls back to a correct full rebuild', async () => {
    // Force a failure the same way verify_dom_recycler.js test F/G and
    // verify_tasks_dom_recycler.js test 10 do: temporarily replace
    // DomRecycler.reconcile with a throwing stub, exactly simulating
    // "any internal reconcile failure" from the SAFETY contract,
    // without touching js/core/dom/*.js on disk.
    const realReconcile = global.DomRecycler.reconcile;
    global.DomRecycler.reconcile = function () { throw new Error('forced failure for fallback test'); };

    resetWriteCounts();
    sessModule.renderSessions();

    global.DomRecycler.reconcile = realReconcile;

    countingAssert(container.children.length === 0, 'legacy fallback assigns a raw HTML string, not live child nodes, in this harness (matches verify_dom_recycler.js test I / verify_tasks_dom_recycler.js test 10)');
    countingAssert(container.innerHTML.indexOf('session-item') !== -1, 'fallback output still contains the session-item wrapper');
    countingAssert(container.innerHTML.indexOf('جلسة ثانية') !== -1, 'fallback output still contains session content');

    // Confirm recovery: next normal render (real reconcile restored)
    // starts clean and recycles correctly again.
    sessModule.renderSessions();
    const all = sessModule.sessionsRepository.getAll();
    countingAssert(container.children.length === all.length, 'recycler resumes normal operation after the forced failure is cleared');
  });

  // ---- I. No-op Render -----------------------------------------------------
  section('I. A render touching nothing never recreates or repositions any node', () => {
    const nodesBefore = container.children.slice();
    resetWriteCounts();
    sessModule.renderSessions(); // no data change at all
    countingAssert(DOM_WRITE_COUNTS.innerHTML === 0 && DOM_WRITE_COUNTS.attrs === 0 && DOM_WRITE_COUNTS.insertBefore === 0, 'a no-op render must cost zero DOM writes of any kind');
    countingAssert(container.children.every((n, i) => n === nodesBefore[i]), 'every node identity preserved');
  });

  // ---- J. Node Identity (Empty State reset) --------------------------------
  await asyncSection('J. Emptying the visible set resets DomKeyIndex; a later re-add creates fresh nodes (no stale references)', async () => {
    const all = sessModule.sessionsRepository.getAll();
    for (const rec of all) {
      await sessModule.sessionsRepository.delete(rec[sessModule.SESSIONS_ID_FIELD]);
    }
    sessModule.renderSessions();

    countingAssert(container.children.length === 0, 'container cleared when no sessions match');
    countingAssert(fakeElements['sessionsEmpty'].style.display === '', 'empty-state element shown');

    await makeSession({ 'عنوان_القضية': 'جلسة جديدة بعد التفريغ', 'التاريخ': '2026-08-10' });
    resetWriteCounts();
    sessModule.renderSessions();

    countingAssert(container.children.length === 1, 'exactly one node after re-adding post-empty');
    countingAssert(container.children[0].innerHTML.indexOf('جلسة جديدة بعد التفريغ') !== -1, 'fresh node has correct content (no stale key-index carried across the empty state)');
    countingAssert(fakeElements['sessionsEmpty'].style.display === 'none', 'empty-state element hidden again');
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
