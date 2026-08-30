/**
 * verify_directory_model.js
 * Standalone Node harness for js/utils/DirectoryModel.js
 * (Legal Directories — Data Model, Stage 1).
 * Run: node js/tests/verify_directory_model.js
 * No browser required.
 */

const assert = require('assert');
const path = require('path');

const DirectoryModel = require(path.join(__dirname, '..', 'utils', 'DirectoryModel.js'));

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

// ---- fixtures ----

function makeDirectory() {
  return {
    id: 'dir-1',
    title: 'دليل تجريبي',
    items: [
      { id: 'n-b', title: 'B', type: 'link', url: 'https://example.test/b', order: 2 },
      { id: 'n-a', title: 'A', type: 'link', url: 'https://example.test/a', order: 1 },
      { id: 'n-no-order-1', title: 'No order 1', type: 'link', url: 'https://example.test/x' },
      { id: 'n-no-order-2', title: 'No order 2', type: 'link', url: 'https://example.test/y' },
      {
        id: 'n-folder', title: 'Folder', type: 'folder', order: 0,
        children: [
          { id: 'n-child-2', title: 'Child2', type: 'link', url: 'https://example.test/c2', order: 2 },
          { id: 'n-child-1', title: 'Child1', type: 'link', url: 'https://example.test/c1', order: 1 }
        ]
      }
    ]
  };
}

// ---- 1. Types & predicates ----

check('NODE_TYPES exposes folder/link', () => {
  assert.strictEqual(DirectoryModel.NODE_TYPES.FOLDER, 'folder');
  assert.strictEqual(DirectoryModel.NODE_TYPES.LINK, 'link');
});

check('isFolder / isLink dispatch purely on type', () => {
  assert.strictEqual(DirectoryModel.isFolder({ type: 'folder' }), true);
  assert.strictEqual(DirectoryModel.isFolder({ type: 'link' }), false);
  assert.strictEqual(DirectoryModel.isLink({ type: 'link' }), true);
  assert.strictEqual(DirectoryModel.isLink({ type: 'folder' }), false);
});

check('isEnabled defaults to true when absent', () => {
  assert.strictEqual(DirectoryModel.isEnabled({}), true);
  assert.strictEqual(DirectoryModel.isEnabled({ enabled: false }), false);
  assert.strictEqual(DirectoryModel.isEnabled({ enabled: true }), true);
});

check('hasChildren true only for non-empty folder.children', () => {
  assert.strictEqual(DirectoryModel.hasChildren({ type: 'folder', children: [{ id: 'x' }] }), true);
  assert.strictEqual(DirectoryModel.hasChildren({ type: 'folder', children: [] }), false);
  assert.strictEqual(DirectoryModel.hasChildren({ type: 'link', children: [{ id: 'x' }] }), false);
});

// ---- 2. Sorting (documented behavior) ----

check('sortByOrder: ascending numeric order', () => {
  const sorted = DirectoryModel.sortByOrder([{ id: 'b', order: 2 }, { id: 'a', order: 1 }]);
  assert.deepStrictEqual(sorted.map(n => n.id), ['a', 'b']);
});

check('sortByOrder: missing order sorts after items with valid order, stable among themselves', () => {
  const sorted = DirectoryModel.sortByOrder([
    { id: 'no-order-1' },
    { id: 'with-order', order: 5 },
    { id: 'no-order-2' }
  ]);
  assert.deepStrictEqual(sorted.map(n => n.id), ['with-order', 'no-order-1', 'no-order-2']);
});

check('sortByOrder: duplicate order values keep original relative order (stable, no throw)', () => {
  const sorted = DirectoryModel.sortByOrder([
    { id: 'first', order: 1 },
    { id: 'second', order: 1 },
    { id: 'third', order: 1 }
  ]);
  assert.deepStrictEqual(sorted.map(n => n.id), ['first', 'second', 'third']);
});

check('sortByOrder: does not mutate the input array', () => {
  const input = [{ id: 'b', order: 2 }, { id: 'a', order: 1 }];
  const before = input.map(n => n.id).join(',');
  DirectoryModel.sortByOrder(input);
  assert.strictEqual(input.map(n => n.id).join(','), before);
});

check('sortByOrder: non-array input returns empty array, does not throw', () => {
  assert.deepStrictEqual(DirectoryModel.sortByOrder(undefined), []);
  assert.deepStrictEqual(DirectoryModel.sortByOrder(null), []);
});

check('getSortedItems / getSortedChildren apply the same sort', () => {
  const dir = makeDirectory();
  const items = DirectoryModel.getSortedItems(dir);
  assert.strictEqual(items[0].id, 'n-folder'); // order 0
  assert.strictEqual(items[1].id, 'n-a');      // order 1
  assert.strictEqual(items[2].id, 'n-b');      // order 2

  const folder = items.find(n => n.id === 'n-folder');
  const children = DirectoryModel.getSortedChildren(folder);
  assert.deepStrictEqual(children.map(n => n.id), ['n-child-1', 'n-child-2']);
});

// ---- 3. Normalization ----

check('normalizeNode defaults icon to {type:"default"} when absent', () => {
  const n = DirectoryModel.normalizeNode({ id: 'x', title: 'X', type: 'link', url: 'https://example.test' });
  assert.deepStrictEqual(n.icon, { type: 'default' });
});

check('normalizeNode preserves custom image icon', () => {
  const n = DirectoryModel.normalizeNode({
    id: 'x', title: 'X', type: 'link', url: 'https://example.test',
    icon: { type: 'image', value: 'assets/x.png' }
  });
  assert.deepStrictEqual(n.icon, { type: 'image', value: 'assets/x.png' });
});

check('normalizeNode does not mutate the input object', () => {
  const input = { id: 'x', title: 'X', type: 'link', url: 'https://example.test' };
  const snapshot = JSON.stringify(input);
  DirectoryModel.normalizeNode(input);
  assert.strictEqual(JSON.stringify(input), snapshot);
});

check('normalizeDirectory defaults enabled=true and preserves items array', () => {
  const dir = DirectoryModel.normalizeDirectory({ id: 'd1', title: 'D', items: [{ id: 'n1', title: 'N', type: 'link', url: 'u' }] });
  assert.strictEqual(dir.enabled, true);
  assert.strictEqual(dir.items.length, 1);
});

// ---- 4. Traversal ----

check('walkNodes visits every node depth-first in sorted order', () => {
  const dir = makeDirectory();
  const visited = [];
  DirectoryModel.walkNodes(dir, (node) => { visited.push(node.id); });
  // top-level sorted: n-folder(0), n-a(1), n-b(2), n-no-order-1, n-no-order-2
  // n-folder's children sorted: n-child-1(1), n-child-2(2), inserted right after n-folder (depth-first)
  assert.deepStrictEqual(visited, [
    'n-folder', 'n-child-1', 'n-child-2',
    'n-a', 'n-b',
    'n-no-order-1', 'n-no-order-2'
  ]);
});

check('walkNodes: visitor returning false skips descending into that node', () => {
  const dir = makeDirectory();
  const visited = [];
  DirectoryModel.walkNodes(dir, (node) => {
    visited.push(node.id);
    if (node.id === 'n-folder') return false;
  });
  assert.ok(!visited.includes('n-child-1'));
  assert.ok(!visited.includes('n-child-2'));
});

check('walkNodes: ids survive traversal unchanged (identity preserved regardless of order)', () => {
  const dir = makeDirectory();
  const ids = new Set();
  DirectoryModel.walkNodes(dir, (node) => { ids.add(node.id); });
  ['n-a', 'n-b', 'n-folder', 'n-child-1', 'n-child-2', 'n-no-order-1', 'n-no-order-2']
    .forEach((id) => assert.ok(ids.has(id), 'missing id ' + id));
});

// ---- 5. Renderer contract ----

check('DIRECTORY_RENDERER_CONTRACT declares renderDirectory(directory) and renderNode(node)', () => {
  const contract = DirectoryModel.DIRECTORY_RENDERER_CONTRACT;
  assert.deepStrictEqual(contract.renderDirectory.params, ['directory']);
  assert.deepStrictEqual(contract.renderNode.params, ['node']);
});

check('DIRECTORY_RENDERER_CONTRACT is frozen (cannot be silently redefined)', () => {
  const contract = DirectoryModel.DIRECTORY_RENDERER_CONTRACT;
  assert.strictEqual(Object.isFrozen(contract), true);
  contract.renderDirectory = null; // no-op in non-strict mode when frozen
  assert.notStrictEqual(contract.renderDirectory, null);
});

// ---- Report ----

console.log(log.join('\n'));
console.log('\n' + passed + ' passed, ' + failed + ' failed.');
if (failed > 0) process.exit(1);
