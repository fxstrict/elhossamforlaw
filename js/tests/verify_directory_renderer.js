/**
 * verify_directory_renderer.js
 * Standalone Node harness for js/utils/DirectoryRenderer.js
 * (Legal Directories — Generic UI, Stage 2).
 * Run: node js/tests/verify_directory_renderer.js
 * No browser required — uses a minimal hand-rolled DOM stub, the
 * same lightweight-sandbox convention already used by most
 * verify_*_repository_integration.js harnesses in this project
 * (see js/tests/_shared/browserStubs.js header comment), rather than
 * pulling in jsdom (an existing devDependency this sandbox does not
 * have installed) for a handful of createElement/appendChild calls.
 */

const assert = require('assert');
const path = require('path');

// ---- Minimal DOM stub (createElement/appendChild/addEventListener) ----

function makeElement(tag) {
  var _text = '';
  var el = {
    tagName: String(tag).toUpperCase(),
    children: [],
    dataset: {},
    style: {},
    className: '',
    type: '',
    src: '', alt: '', loading: '',
    _listeners: {},
    _attrs: {},
    appendChild(child) { this.children.push(child); return child; },
    addEventListener(evt, fn) { (this._listeners[evt] = this._listeners[evt] || []).push(fn); },
    click() { (this._listeners.click || []).forEach((fn) => fn()); },
    setAttribute(k, v) { this._attrs[k] = v; },
    getAttribute(k) { return this._attrs[k]; }
  };
  Object.defineProperty(el, 'textContent', {
    get() { return _text; },
    set(v) { _text = v; this.children = []; }
  });
  return el;
}

function installDomStub(global) {
  global.document = { createElement: (tag) => makeElement(tag) };
  global.__opened = [];
  global.open = function (url, target) { global.__opened.push({ url: url, target: target }); };
}

installDomStub(global);

const DirectoryModel = require(path.join(__dirname, '..', 'utils', 'DirectoryModel.js'));
const DirectoryRenderer = require(path.join(__dirname, '..', 'utils', 'DirectoryRenderer.js'));

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

function findByClass(el, cls) {
  return el.children.find((c) => (c.className || '').indexOf(cls) !== -1);
}

// ---- fixtures ----

function linkNode(overrides) {
  return Object.assign({
    id: 'n-1', title: 'رابط تجريبي', type: 'link', url: 'https://example.test/x', order: 1
  }, overrides || {});
}

function folderNode(overrides) {
  return Object.assign({
    id: 'n-2', title: 'مجلد تجريبي', type: 'folder', order: 1,
    children: [linkNode({ id: 'child-1' })]
  }, overrides || {});
}

// ---- 1. renderNode: dispatches purely on type ----

check('renderNode(link) produces a card with the link badge and title', () => {
  const card = DirectoryRenderer.renderNode(linkNode());
  assert.strictEqual(card.tagName, 'BUTTON');
  assert.strictEqual(card.dataset.nodeType, 'link');
  const badge = findByClass(card, 'legal-dir-card-badge');
  assert.ok(badge.className.indexOf('is-link') !== -1);
  const title = findByClass(card, 'legal-dir-card-title');
  assert.strictEqual(title.textContent, 'رابط تجريبي');
});

check('renderNode(folder) produces a card with the folder badge (no is-link class)', () => {
  const card = DirectoryRenderer.renderNode(folderNode());
  const badge = findByClass(card, 'legal-dir-card-badge');
  assert.strictEqual(badge.className.indexOf('is-link'), -1);
});

check('renderNode: clicking a link card without handlers opens node.url via global.open', () => {
  global.__opened = [];
  const card = DirectoryRenderer.renderNode(linkNode({ url: 'https://example.test/direct' }));
  card.click();
  assert.strictEqual(global.__opened.length, 1);
  assert.strictEqual(global.__opened[0].url, 'https://example.test/direct');
});

check('renderNode: clicking a link card calls handlers.onLinkClick instead of global.open when provided', () => {
  global.__opened = [];
  let received = null;
  const node = linkNode();
  const card = DirectoryRenderer.renderNode(node, { onLinkClick: (n) => { received = n; } });
  card.click();
  assert.strictEqual(received, node);
  assert.strictEqual(global.__opened.length, 0);
});

check('renderNode: clicking a folder card calls handlers.onFolderClick, never global.open', () => {
  global.__opened = [];
  let received = null;
  const node = folderNode();
  const card = DirectoryRenderer.renderNode(node, { onFolderClick: (n) => { received = n; } });
  card.click();
  assert.strictEqual(received, node);
  assert.strictEqual(global.__opened.length, 0);
});

check('renderNode: folder click with no handlers is a safe no-op (never throws)', () => {
  const card = DirectoryRenderer.renderNode(folderNode());
  assert.doesNotThrow(() => card.click());
});

// ---- 2. Icon dispatch (generic — no id/title branching) ----

check('renderNode: default icon renders a glyph span, not an <img>', () => {
  const card = DirectoryRenderer.renderNode(linkNode({ icon: { type: 'default' } }));
  const iconSpan = findByClass(card, 'legal-dir-card-icon');
  assert.ok(iconSpan);
  assert.strictEqual(iconSpan.tagName, 'SPAN');
});

check('renderNode: image icon with a value renders an <img>, not the glyph span', () => {
  const card = DirectoryRenderer.renderNode(linkNode({ icon: { type: 'image', value: 'assets/x.png' } }));
  const img = card.children.find((c) => c.tagName === 'IMG');
  assert.ok(img);
  assert.strictEqual(img.src, 'assets/x.png');
  assert.ok(!findByClass(card, 'legal-dir-card-icon'));
});

check('renderNode: image icon WITHOUT a value falls back to the default glyph (icon presence is never required)', () => {
  const card = DirectoryRenderer.renderNode(linkNode({ icon: { type: 'image' } }));
  const iconSpan = findByClass(card, 'legal-dir-card-icon');
  assert.ok(iconSpan, 'expected fallback glyph span when custom icon has no value');
});

// ---- 3. renderDirectory / renderNodeChildren — sorted, enabled-only ----

check('renderDirectory renders only enabled top-level items, sorted by order', () => {
  const directory = {
    id: 'd1', title: 'D', items: [
      linkNode({ id: 'b', title: 'B', order: 2 }),
      linkNode({ id: 'a', title: 'A', order: 1 }),
      linkNode({ id: 'disabled', title: 'Disabled', order: 0, enabled: false })
    ]
  };
  const cards = DirectoryRenderer.renderDirectory(directory);
  assert.deepStrictEqual(cards.map((c) => c.dataset.nodeId), ['a', 'b']);
});

check('renderNodeChildren renders a folder\'s sorted, enabled children', () => {
  const folder = folderNode({
    children: [
      linkNode({ id: 'x2', title: 'X2', order: 2 }),
      linkNode({ id: 'x1', title: 'X1', order: 1 })
    ]
  });
  const cards = DirectoryRenderer.renderNodeChildren(folder);
  assert.deepStrictEqual(cards.map((c) => c.dataset.nodeId), ['x1', 'x2']);
});

// ---- Report ----

console.log(log.join('\n'));
console.log('\n' + passed + ' passed, ' + failed + ' failed.');
if (failed > 0) process.exit(1);
