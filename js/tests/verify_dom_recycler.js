/**
 * verify_dom_recycler.js
 * ================================================================
 * PHASE 16.6 — Keyed DOM Recycling (Pilot) — Verification
 * PHASE 16.9 — Attribute Reconciliation — Verification (adds K–Q)
 * ================================================================
 * Standalone Node harness (`node js/tests/verify_dom_recycler.js`, no
 * browser required). Exercises `js/core/dom/{DomKeyIndex,DomNodeFactory,
 * DomPatch,DomRecycler}.js` directly against a minimal in-process fake
 * DOM (createElement/insertBefore/removeChild/firstChild/nextSibling/
 * parentNode/innerHTML/className/id/title/hidden/disabled — the only
 * DOM surface those four files use). No production file is modified
 * by this harness; it is read-only with respect to js/core/dom/ and
 * js/modules/{cases,clients}.js.
 *
 * Coverage (PHASE 16.6, unchanged):
 *   A. Initial render (all-create)              F. Missing-key guard
 *   B. Full reuse, no changes (zero DOM writes)  G. Duplicate-key guard
 *   C. Single content change                     H. DomKeyIndex.reset()
 *   D. Add + remove in the same render            I. Fallback-after-throw
 *   E. Reorder (moved-count + final order)        J. Stress (1000 items)
 *
 * Coverage (PHASE 16.9, new):
 *   K. Attrs on create                    O. Caller without attrs() never
 *   L. Same attrs twice, zero writes         enters the attrs path
 *   M. className change, exactly 1 write  P. Same object reference reused,
 *   N. Attribute removal clears value        zero writes
 *                                          Q. Mixed render (some items use
 *                                             attrs, some don't)
 *
 * Plus a DOM-write counter proving the recycling claim: an unchanged
 * render performs ZERO innerHTML writes, ZERO insertBefore calls, and
 * (PHASE 16.9) ZERO scalar-attribute writes.
 * ================================================================
 */

'use strict';

const assert = require('assert');
const path = require('path');

// ---- Minimal fake DOM ------------------------------------------------

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
  }
  // PHASE 16.9: track every scalar attribute write the same way
  // innerHTML/insertBefore are tracked, so tests can assert "zero
  // writes" for unchanged attrs the same way test B asserts it for
  // unchanged content.
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
    // A real browser detaches all previous child nodes when innerHTML is
    // reassigned. Model that here too — it matters for test I, which
    // simulates renderCases()'s legacy fallback (a full innerHTML
    // rebuild) after a failed reconcile() attempt.
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

global.window = global;
global.document = { createElement: function (tag) { return new FakeElement(tag); } };

const CORE_DOM_DIR = path.join(__dirname, '..', 'core', 'dom');
require(path.join(CORE_DOM_DIR, 'DomKeyIndex.js'));
require(path.join(CORE_DOM_DIR, 'DomNodeFactory.js'));
require(path.join(CORE_DOM_DIR, 'DomPatch.js'));
require(path.join(CORE_DOM_DIR, 'DomRecycler.js'));

const DomKeyIndex = global.DomKeyIndex;
const DomRecycler = global.DomRecycler;

let passed = 0, failed = 0, assertionCount = 0;
const failures = [];
function countingAssert(cond, msg) { assertionCount++; if (!cond) throw new Error(msg || 'assertion failed'); }
function section(name, fn) {
  try { fn(); passed++; console.log('  [PASS] ' + name); }
  catch (e) { failed++; failures.push(name + ' :: ' + e.message); console.log('  [FAIL] ' + name + ' :: ' + e.message); }
}

function makeContainer() { return new FakeElement('tbody'); }
function makeItem(id, label) { return { id: id, label: label }; }
function render(item) { return '<td>' + item.label + '</td>'; }
function keyOf(item) { return item.id; }

console.log('================================================================');
console.log('PHASE 16.6 — Keyed DOM Recycling (Pilot) — Verification');
console.log('================================================================\n');

// ---- A. Initial render (all-create) -----------------------------------
section('A. Initial render creates one node per item, in order', () => {
  const c = makeContainer();
  const items = [makeItem('C-1', 'a'), makeItem('C-2', 'b'), makeItem('C-3', 'c')];
  const stats = DomRecycler.reconcile(c, items, { key: keyOf, tag: 'tr', render: render });
  countingAssert(stats.created === 3 && stats.reused === 0 && stats.removed === 0, 'expected 3 created');
  countingAssert(c.children.length === 3, 'expected 3 children');
  countingAssert(c.children[0].innerHTML === '<td>a</td>', 'row 0 content');
  countingAssert(c.children[2].innerHTML === '<td>c</td>', 'row 2 content');
});

// ---- B. Full reuse, zero DOM writes ------------------------------------
section('B. Unchanged re-render reuses all nodes with ZERO DOM writes', () => {
  const c = makeContainer();
  const items = [makeItem('C-1', 'a'), makeItem('C-2', 'b'), makeItem('C-3', 'c')];
  DomRecycler.reconcile(c, items, { key: keyOf, tag: 'tr', render: render });
  const nodesBefore = c.children.slice();

  resetWriteCounts();
  const stats = DomRecycler.reconcile(c, items, { key: keyOf, tag: 'tr', render: render });

  countingAssert(stats.created === 0 && stats.reused === 3 && stats.updated === 0 && stats.moved === 0, 'expected pure reuse');
  countingAssert(DOM_WRITE_COUNTS.innerHTML === 0, 'expected zero innerHTML writes, got ' + DOM_WRITE_COUNTS.innerHTML);
  countingAssert(DOM_WRITE_COUNTS.insertBefore === 0, 'expected zero insertBefore calls, got ' + DOM_WRITE_COUNTS.insertBefore);
  countingAssert(c.children[0] === nodesBefore[0] && c.children[1] === nodesBefore[1] && c.children[2] === nodesBefore[2], 'same node identities reused');
});

// ---- C. Single content change -----------------------------------------
section('C. Changing one item updates only that node', () => {
  const c = makeContainer();
  const items = [makeItem('C-1', 'a'), makeItem('C-2', 'b'), makeItem('C-3', 'c')];
  DomRecycler.reconcile(c, items, { key: keyOf, tag: 'tr', render: render });
  const nodeBefore1 = c.children[1];

  const items2 = [makeItem('C-1', 'a'), makeItem('C-2', 'B-CHANGED'), makeItem('C-3', 'c')];
  resetWriteCounts();
  const stats = DomRecycler.reconcile(c, items2, { key: keyOf, tag: 'tr', render: render });

  countingAssert(stats.created === 0 && stats.reused === 3 && stats.updated === 1, 'expected exactly 1 updated');
  countingAssert(DOM_WRITE_COUNTS.innerHTML === 1, 'expected exactly 1 innerHTML write, got ' + DOM_WRITE_COUNTS.innerHTML);
  countingAssert(c.children[1] === nodeBefore1, 'node identity for changed row preserved (recycled, not recreated)');
  countingAssert(c.children[1].innerHTML === '<td>B-CHANGED</td>', 'new content applied');
});

// ---- D. Add + remove in the same render --------------------------------
section('D. Add one item, remove another, in the same render', () => {
  const c = makeContainer();
  const items = [makeItem('C-1', 'a'), makeItem('C-2', 'b'), makeItem('C-3', 'c')];
  DomRecycler.reconcile(c, items, { key: keyOf, tag: 'tr', render: render });

  const items2 = [makeItem('C-1', 'a'), makeItem('C-3', 'c'), makeItem('C-4', 'd')]; // C-2 removed, C-4 added
  const stats = DomRecycler.reconcile(c, items2, { key: keyOf, tag: 'tr', render: render });

  countingAssert(stats.created === 1 && stats.removed === 1 && stats.reused === 2, 'expected 1 created, 1 removed, 2 reused');
  countingAssert(c.children.length === 3, 'container has exactly 3 children');
  countingAssert(c.children.map(n => n.innerHTML).join('|') === '<td>a</td>|<td>c</td>|<td>d</td>', 'final order/content correct');
});

// ---- E. Reorder ----------------------------------------------------------
section('E. Reordering items moves nodes and preserves identity + order', () => {
  const c = makeContainer();
  const items = [makeItem('C-1', 'a'), makeItem('C-2', 'b'), makeItem('C-3', 'c')];
  DomRecycler.reconcile(c, items, { key: keyOf, tag: 'tr', render: render });
  const node1 = c.children[0], node2 = c.children[1], node3 = c.children[2];

  const reordered = [makeItem('C-3', 'c'), makeItem('C-1', 'a'), makeItem('C-2', 'b')];
  const stats = DomRecycler.reconcile(c, reordered, { key: keyOf, tag: 'tr', render: render });

  countingAssert(stats.created === 0 && stats.removed === 0 && stats.reused === 3, 'pure reorder: no create/remove');
  countingAssert(stats.moved > 0, 'expected at least one move');
  countingAssert(c.children[0] === node3 && c.children[1] === node1 && c.children[2] === node2, 'final order matches new item order, same node identities');
});

// ---- F. Missing-key guard -------------------------------------------------
section('F. Item with no usable key throws (Safety: caller must fall back)', () => {
  const c = makeContainer();
  const items = [makeItem('', 'a')];
  let threw = false;
  try { DomRecycler.reconcile(c, items, { key: keyOf, tag: 'tr', render: render }); }
  catch (e) { threw = true; }
  countingAssert(threw, 'expected reconcile() to throw on empty key');
});

// ---- G. Duplicate-key guard ------------------------------------------------
section('G. Duplicate keys in the same render throw', () => {
  const c = makeContainer();
  const items = [makeItem('C-1', 'a'), makeItem('C-1', 'b')];
  let threw = false;
  try { DomRecycler.reconcile(c, items, { key: keyOf, tag: 'tr', render: render }); }
  catch (e) { threw = true; }
  countingAssert(threw, 'expected reconcile() to throw on duplicate key');
});

// ---- H. DomKeyIndex.reset() --------------------------------------------
section('H. reset(container) drops stale key->node memory (empty-state wipe simulation)', () => {
  const c = makeContainer();
  const items = [makeItem('C-1', 'a'), makeItem('C-2', 'b')];
  DomRecycler.reconcile(c, items, { key: keyOf, tag: 'tr', render: render });

  // Simulate renderCases()'s empty-state branch: container wiped directly.
  c.children = [];
  DomKeyIndex.reset(c);

  const stats = DomRecycler.reconcile(c, items, { key: keyOf, tag: 'tr', render: render });
  countingAssert(stats.created === 2 && stats.reused === 0, 'after reset, all items are treated as new (no dead-node reuse)');
  countingAssert(c.children.length === 2, 'container correctly repopulated');
});

// ---- I. Fallback-after-throw does not corrupt subsequent renders ---------
section('I. A thrown reconcile() falls back to a full legacy rebuild, exactly like renderCases() does', () => {
  const c = makeContainer();
  const badItems = [makeItem('C-1', 'a'), makeItem('C-1', 'b')]; // duplicate -> throws
  let recycled = true;
  try { DomRecycler.reconcile(c, badItems, { key: keyOf, tag: 'tr', render: render }); }
  catch (e) {
    // Mirrors renderCases()'s catch block: reset the (possibly partial)
    // key index, then fall to the legacy path.
    recycled = false;
    if (window.DomKeyIndex) DomKeyIndex.reset(c);
  }
  countingAssert(!recycled, 'reconcile() should have thrown on the duplicate key');

  // Mirrors renderCases()'s `if (!recycled)` legacy full-rebuild branch —
  // a plain innerHTML reassignment, no reconcile() involved.
  const goodItems = [makeItem('C-1', 'a'), makeItem('C-2', 'b')];
  c.innerHTML = goodItems.map(it => '<tr>' + render(it) + '</tr>').join('');
  countingAssert(c.children.length === 0, 'legacy path uses a raw HTML string, not live child nodes, in this harness');

  // Next render after that goes through the recycler again, starting
  // clean because DomKeyIndex.reset(c) was called in the catch block.
  const stats = DomRecycler.reconcile(c, goodItems, { key: keyOf, tag: 'tr', render: render });
  countingAssert(stats.created === 2 && stats.reused === 0, 'clean recycler render after reset, no dead-node reuse');
  countingAssert(c.children.length === 2, 'container in a valid state');
});

// ---- J. Stress: 1000 items, small delta -----------------------------------
section('J. Stress: 1000 rows, then update 10 + add 5 + remove 5 — minimal DOM writes', () => {
  const c = makeContainer();
  const items = [];
  for (let i = 0; i < 1000; i++) items.push(makeItem('K-' + i, 'v' + i));
  DomRecycler.reconcile(c, items, { key: keyOf, tag: 'tr', render: render });
  countingAssert(c.children.length === 1000, 'initial 1000 rows created');

  const items2 = items.slice(5, 1000); // remove first 5
  for (let i = 0; i < 10; i++) items2[i] = makeItem(items2[i].id, items2[i].label + '-CHANGED'); // update 10
  for (let i = 0; i < 5; i++) items2.push(makeItem('NEW-' + i, 'new' + i)); // add 5

  resetWriteCounts();
  const stats = DomRecycler.reconcile(c, items2, { key: keyOf, tag: 'tr', render: render });

  countingAssert(stats.created === 5, 'exactly 5 created');
  countingAssert(stats.removed === 5, 'exactly 5 removed');
  countingAssert(stats.updated === 10, 'exactly 10 content updates');
  countingAssert(DOM_WRITE_COUNTS.innerHTML === 15, 'exactly 15 innerHTML writes (5 new + 10 changed), got ' + DOM_WRITE_COUNTS.innerHTML);
  countingAssert(c.children.length === 1000, 'container settles back at 1000 rows');
  console.log('    -> reused=' + stats.reused + ' created=' + stats.created + ' updated=' + stats.updated + ' removed=' + stats.removed + ' moved=' + stats.moved);
});

// ---- K. Attrs on create -----------------------------------------------
section('K. Attrs supplied for a brand-new item are written once on create', () => {
  const c = makeContainer();
  const items = [makeItem('C-1', 'a'), makeItem('C-2', 'b')];
  const attrsOf = (item) => ({ className: 'task-item ' + (item.id === 'C-1' ? 'high' : 'low') });

  resetWriteCounts();
  const stats = DomRecycler.reconcile(c, items, { key: keyOf, tag: 'div', render: render, attrs: attrsOf });

  countingAssert(stats.created === 2, 'expected 2 created');
  countingAssert(c.children[0].className === 'task-item high', 'row 0 className set on create');
  countingAssert(c.children[1].className === 'task-item low', 'row 1 className set on create');
  countingAssert(DOM_WRITE_COUNTS.attrs === 2, 'expected exactly 2 attr writes (one per new item), got ' + DOM_WRITE_COUNTS.attrs);
});

// ---- L. Same attrs twice, zero writes ----------------------------------
section('L. Re-rendering with identical attrs performs ZERO attribute writes', () => {
  const c = makeContainer();
  const items = [makeItem('C-1', 'a'), makeItem('C-2', 'b')];
  const attrsOf = (item) => ({ className: 'task-item ' + (item.id === 'C-1' ? 'high' : 'low') });
  DomRecycler.reconcile(c, items, { key: keyOf, tag: 'div', render: render, attrs: attrsOf });

  resetWriteCounts();
  const stats = DomRecycler.reconcile(c, items, { key: keyOf, tag: 'div', render: render, attrs: attrsOf });

  countingAssert(stats.created === 0 && stats.reused === 2 && stats.updated === 0, 'expected pure reuse, no updates');
  countingAssert(DOM_WRITE_COUNTS.attrs === 0, 'expected zero attribute writes, got ' + DOM_WRITE_COUNTS.attrs);
  countingAssert(DOM_WRITE_COUNTS.innerHTML === 0, 'expected zero innerHTML writes too, got ' + DOM_WRITE_COUNTS.innerHTML);
});

// ---- M. className change, exactly one write ----------------------------
section('M. Changing className on reuse writes exactly once, on the right node', () => {
  const c = makeContainer();
  const items = [makeItem('C-1', 'a'), makeItem('C-2', 'b')];
  const attrsOf = (item) => ({ className: 'task-item ' + (item.priority || 'low') });
  DomRecycler.reconcile(c, items, { key: keyOf, tag: 'div', render: render, attrs: attrsOf });
  const nodeBefore0 = c.children[0], nodeBefore1 = c.children[1];

  const items2 = [makeItem('C-1', 'a'), makeItem('C-2', 'b')];
  items2[0].priority = 'high'; // C-1 priority changed; C-2 unchanged

  resetWriteCounts();
  const stats = DomRecycler.reconcile(c, items2, { key: keyOf, tag: 'div', render: render, attrs: attrsOf });

  countingAssert(stats.created === 0 && stats.reused === 2, 'expected pure reuse');
  countingAssert(DOM_WRITE_COUNTS.attrs === 1, 'expected exactly 1 attribute write, got ' + DOM_WRITE_COUNTS.attrs);
  countingAssert(c.children[0] === nodeBefore0 && c.children[1] === nodeBefore1, 'node identities preserved (recycled, not recreated)');
  countingAssert(c.children[0].className === 'task-item high', 'C-1 className updated');
  countingAssert(c.children[1].className === 'task-item low', 'C-2 className left untouched');
  countingAssert(stats.updated === 1, 'stats.updated reflects the attrs-only change');
});

// ---- N. Attribute removal clears value ---------------------------------
section('N. Dropping a previously-supplied attribute key clears it to its DOM default', () => {
  const c = makeContainer();
  const items = [makeItem('C-1', 'a')];
  DomRecycler.reconcile(c, items, { key: keyOf, tag: 'div', render: render, attrs: () => ({ className: 'task-item high', title: 'Urgent' }) });
  countingAssert(c.children[0].title === 'Urgent', 'title initially set');

  resetWriteCounts();
  // Same className, but `title` is no longer supplied at all.
  const stats = DomRecycler.reconcile(c, items, { key: keyOf, tag: 'div', render: render, attrs: () => ({ className: 'task-item high' }) });

  countingAssert(c.children[0].title === '', 'title cleared back to default, got "' + c.children[0].title + '"');
  countingAssert(c.children[0].className === 'task-item high', 'className unaffected by the title removal');
  countingAssert(DOM_WRITE_COUNTS.attrs === 1, 'expected exactly 1 attribute write (title cleared only), got ' + DOM_WRITE_COUNTS.attrs);
  countingAssert(stats.updated === 1, 'stats.updated reflects the clear');
});

// ---- O. Caller without attrs() never enters the attrs path -------------
section('O. Omitting options.attrs entirely (Cases/Clients shape) never touches attrs', () => {
  const c = makeContainer();
  const items = [makeItem('C-1', 'a'), makeItem('C-2', 'b')];

  resetWriteCounts();
  const stats = DomRecycler.reconcile(c, items, { key: keyOf, tag: 'tr', render: render }); // no attrs option at all

  countingAssert(DOM_WRITE_COUNTS.attrs === 0, 'expected zero attribute writes when options.attrs is absent, got ' + DOM_WRITE_COUNTS.attrs);
  countingAssert(stats.created === 2, 'unaffected: normal create behavior');

  const map = DomKeyIndex.get(c);
  map.forEach((entry) => {
    countingAssert(entry.attrs === null, 'entry.attrs must stay null forever for a caller that never uses options.attrs');
  });
});

// ---- P. Same object reference reused, zero writes -----------------------
section('P. Passing back the exact same attrs object reference performs zero writes', () => {
  const c = makeContainer();
  const items = [makeItem('C-1', 'a')];
  const sharedAttrs = { className: 'task-item medium' };
  DomRecycler.reconcile(c, items, { key: keyOf, tag: 'div', render: render, attrs: () => sharedAttrs });

  resetWriteCounts();
  const stats = DomRecycler.reconcile(c, items, { key: keyOf, tag: 'div', render: render, attrs: () => sharedAttrs });

  countingAssert(DOM_WRITE_COUNTS.attrs === 0, 'expected zero attribute writes for the same object reference, got ' + DOM_WRITE_COUNTS.attrs);
  countingAssert(stats.updated === 0, 'expected no update recorded');
});

// ---- Q. Mixed render: some items use attrs, some don't ------------------
section('Q. Mixed render: attrs() returning undefined for some items skips only those items', () => {
  const c = makeContainer();
  const items = [makeItem('C-1', 'a'), makeItem('C-2', 'b'), makeItem('C-3', 'c')];
  // Only C-1 and C-3 get attrs; C-2's callback returns undefined.
  const attrsOf = (item) => (item.id === 'C-2' ? undefined : { className: 'task-item high' });

  resetWriteCounts();
  const stats = DomRecycler.reconcile(c, items, { key: keyOf, tag: 'div', render: render, attrs: attrsOf });

  countingAssert(c.children[0].className === 'task-item high', 'C-1 got attrs');
  countingAssert(c.children[1].className === '', 'C-2 never had attrs applied, default className');
  countingAssert(c.children[2].className === 'task-item high', 'C-3 got attrs');

  const map = DomKeyIndex.get(c);
  countingAssert(map.get('C-2').attrs === null, 'C-2 entry.attrs stays null (never touched, not cleared)');
  countingAssert(map.get('C-1').attrs !== null, 'C-1 entry.attrs was populated');

  // Second render: C-2 now also gets attrs for the first time, C-1/C-3 unchanged.
  const attrsOf2 = (item) => (item.id === 'C-2' ? { className: 'task-item low' } : { className: 'task-item high' });
  resetWriteCounts();
  const stats2 = DomRecycler.reconcile(c, items, { key: keyOf, tag: 'div', render: render, attrs: attrsOf2 });
  countingAssert(DOM_WRITE_COUNTS.attrs === 1, 'expected exactly 1 new attribute write (C-2 only), got ' + DOM_WRITE_COUNTS.attrs);
  countingAssert(c.children[1].className === 'task-item low', 'C-2 attrs applied on first use');
  countingAssert(stats2.updated === 1, 'stats.updated reflects only the one attrs change');
});

// ---- Summary --------------------------------------------------------------
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
