/**
 * verify_legal_directories_admin.js
 * Standalone Node harness for js/modules/legal-directories-admin.js
 * (Legal Directories — Admin Panel, Stage 3, PART A).
 * Run: node js/tests/verify_legal_directories_admin.js
 * No browser required — pure logic, no DOM.
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');

require(path.join(__dirname, '..', 'utils', 'DirectoryModel.js'));
require(path.join(__dirname, '..', 'utils', 'DirectoryValidation.js'));
const Admin = require(path.join(__dirname, '..', 'modules', 'legal-directories-admin.js'));

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

function baseDataset() {
  return {
    directories: [
      {
        id: 'dir-1', title: 'دليل 1', enabled: true, order: 1, items: [
          { id: 'n-1', title: 'رابط 1', type: 'link', url: 'https://example.test/1', order: 1, enabled: true },
          {
            id: 'n-2', title: 'مجلد 1', type: 'folder', order: 2, enabled: true, children: [
              { id: 'n-3', title: 'رابط فرعي', type: 'link', url: 'https://example.test/3', order: 1, enabled: true }
            ]
          }
        ]
      }
    ]
  };
}

// ---- 1. Draft lifecycle ----

check('startDraft clones the input (mutating the draft never mutates the original)', () => {
  const original = baseDataset();
  const draft = Admin.startDraft(original);
  draft.directories[0].title = 'تغيّر';
  assert.strictEqual(original.directories[0].title, 'دليل 1');
});

check('isDirty() is false right after startDraft, true after a mutation', () => {
  Admin.startDraft(baseDataset());
  assert.strictEqual(Admin.isDirty(), false);
  Admin.addDirectory({ title: 'جديد' });
  assert.strictEqual(Admin.isDirty(), true);
});

check('resetDraft() discards all changes back to the original snapshot', () => {
  Admin.startDraft(baseDataset());
  Admin.addDirectory({ title: 'جديد' });
  Admin.resetDraft();
  assert.strictEqual(Admin.isDirty(), false);
  assert.strictEqual(Admin.getDraft().directories.length, 1);
});

// ---- 2. Directory CRUD ----

check('addDirectory generates a stable, non-index-based id and appends with next order', () => {
  Admin.startDraft(baseDataset());
  const id = Admin.addDirectory({ title: 'دليل 2' });
  assert.ok(id && !/^0$|^1$/.test(id), 'id must not look like a bare array index');
  const dir = Admin.findDirectory(id);
  assert.strictEqual(dir.title, 'دليل 2');
  assert.strictEqual(dir.order, 2); // after existing order:1
  assert.deepStrictEqual(dir.items, []);
});

check('updateDirectory only applies allowed fields (id/order cannot be overwritten via fields)', () => {
  Admin.startDraft(baseDataset());
  Admin.updateDirectory('dir-1', { title: 'اسم جديد', id: 'hacked', order: 999 });
  const dir = Admin.findDirectory('dir-1');
  assert.strictEqual(dir.title, 'اسم جديد');
  assert.strictEqual(dir.id, 'dir-1');
  assert.strictEqual(dir.order, 1);
});

check('updateDirectory on a missing id throws (does not silently no-op)', () => {
  Admin.startDraft(baseDataset());
  assert.throws(() => Admin.updateDirectory('nope', { title: 'x' }));
});

check('toggleDirectoryEnabled flips enabled and is idempotent-reversible', () => {
  Admin.startDraft(baseDataset());
  assert.strictEqual(Admin.toggleDirectoryEnabled('dir-1'), false);
  assert.strictEqual(Admin.toggleDirectoryEnabled('dir-1'), true);
});

check('removeDirectory hard-deletes and returns false for an already-missing id', () => {
  Admin.startDraft(baseDataset());
  assert.strictEqual(Admin.removeDirectory('dir-1'), true);
  assert.strictEqual(Admin.findDirectory('dir-1'), null);
  assert.strictEqual(Admin.removeDirectory('dir-1'), false);
});

check('moveDirectoryOrder swaps order with the neighbor and is a no-op past the edges', () => {
  const dataset = baseDataset();
  dataset.directories.push({ id: 'dir-2', title: 'دليل 2', order: 2, items: [] });
  Admin.startDraft(dataset);
  assert.strictEqual(Admin.moveDirectoryOrder('dir-1', 'up'), false); // already first
  assert.strictEqual(Admin.moveDirectoryOrder('dir-1', 'down'), true);
  const sorted = require(path.join(__dirname, '..', 'utils', 'DirectoryModel.js')).sortByOrder(Admin.getDraft().directories);
  assert.strictEqual(sorted[0].id, 'dir-2');
});

// ---- 3. Node CRUD (top-level + nested) ----

check('addNode(top-level link) appends to directory.items with a generated id and next order', () => {
  Admin.startDraft(baseDataset());
  const id = Admin.addNode('dir-1', null, { title: 'رابط جديد', type: 'link', url: 'https://example.test/new' });
  const result = Admin.findNode(id);
  assert.ok(result);
  assert.strictEqual(result.node.type, 'link');
  assert.strictEqual(result.node.url, 'https://example.test/new');
  assert.strictEqual(result.node.order, 3); // after existing 1,2
});

check('addNode(nested folder) requires an existing folder parent and appends to its children', () => {
  Admin.startDraft(baseDataset());
  const id = Admin.addNode('dir-1', 'n-2', { title: 'رابط متداخل جديد', type: 'link', url: 'https://example.test/deep' });
  const parent = Admin.findNode('n-2').node;
  assert.ok(parent.children.some((c) => c.id === id));
});

check('addNode into a link (not a folder) as parent throws', () => {
  Admin.startDraft(baseDataset());
  assert.throws(() => Admin.addNode('dir-1', 'n-1', { title: 'x', type: 'link', url: 'https://example.test' }));
});

check('addNode(folder) initializes empty children and strips url/target even if passed', () => {
  Admin.startDraft(baseDataset());
  const id = Admin.addNode('dir-1', null, { title: 'مجلد جديد', type: 'folder', url: 'should-be-stripped' });
  const node = Admin.findNode(id).node;
  assert.deepStrictEqual(node.children, []);
  assert.strictEqual(node.url, undefined);
});

check('updateNode applies only allowed fields; type is never changed via updateNode', () => {
  Admin.startDraft(baseDataset());
  Admin.updateNode('n-1', { title: 'عنوان محدث', type: 'folder', id: 'hacked' });
  const node = Admin.findNode('n-1').node;
  assert.strictEqual(node.title, 'عنوان محدث');
  assert.strictEqual(node.type, 'link'); // unchanged
  assert.strictEqual(node.id, 'n-1');
});

check('toggleNodeEnabled works on a deeply nested node (n-3, two levels deep)', () => {
  Admin.startDraft(baseDataset());
  assert.strictEqual(Admin.toggleNodeEnabled('n-3'), false);
  const node = Admin.findNode('n-3').node;
  assert.strictEqual(node.enabled, false);
});

check('removeNode removes a deeply nested node from its actual parent children array', () => {
  Admin.startDraft(baseDataset());
  assert.strictEqual(Admin.removeNode('n-3'), true);
  const parent = Admin.findNode('n-2').node;
  assert.strictEqual(parent.children.length, 0);
  assert.strictEqual(Admin.findNode('n-3'), null);
});

check('moveNodeOrder swaps within the correct sibling list (top-level vs nested are independent)', () => {
  Admin.startDraft(baseDataset());
  assert.strictEqual(Admin.moveNodeOrder('n-1', 'down'), true); // n-1 (order1) <-> n-2 (order2)
  const dm = require(path.join(__dirname, '..', 'utils', 'DirectoryModel.js'));
  const dir = Admin.findDirectory('dir-1');
  const sorted = dm.sortByOrder(dir.items);
  assert.strictEqual(sorted[0].id, 'n-2');
});

// ---- 4. Validation + export integrate with the real Stage-1 layer ----

check('validateDraft() flags a broken draft (missing url on a link) using the real DirectoryValidation', () => {
  Admin.startDraft(baseDataset());
  Admin.updateNode('n-1', {}); // no-op update
  Admin.getDraft().directories[0].items[0].url = undefined;
  delete Admin.getDraft().directories[0].items[0].url;
  const result = Admin.validateDraft();
  assert.strictEqual(result.valid, false);
});

check('a freshly-added, correctly-filled node keeps the draft valid', () => {
  Admin.startDraft(baseDataset());
  Admin.addNode('dir-1', null, { title: 'صحيح', type: 'link', url: 'https://example.test/ok' });
  const result = Admin.validateDraft();
  assert.strictEqual(result.valid, true);
});

check('exportDraftJSON() produces valid, re-parseable JSON identical in content to the draft', () => {
  Admin.startDraft(baseDataset());
  Admin.addDirectory({ title: 'دليل جديد' });
  const json = Admin.exportDraftJSON();
  const parsed = JSON.parse(json);
  assert.deepStrictEqual(parsed, Admin.getDraft());
});

// ---- 5. Round-trip against the real shipped dataset ----

check('starting a draft from the real shipped legal-directories.json, editing, and re-validating works end-to-end', () => {
  const datasetPath = path.join(__dirname, '..', 'data', 'directories', 'legal-directories.json');
  const real = JSON.parse(fs.readFileSync(datasetPath, 'utf8'));
  Admin.startDraft(real);
  const firstDir = Admin.getDraft().directories[0];
  const newNodeId = Admin.addNode(firstDir.id, null, { title: 'اختبار', type: 'link', url: 'https://example.test/roundtrip' });
  assert.strictEqual(Admin.validateDraft().valid, true);
  Admin.removeNode(newNodeId);
  assert.strictEqual(Admin.exportDraftJSON(), JSON.stringify(Admin.getDraft(), null, 2));
});

// ---- Report ----

console.log(log.join('\n'));
console.log('\n' + passed + ' passed, ' + failed + ' failed.');
if (failed > 0) process.exit(1);
