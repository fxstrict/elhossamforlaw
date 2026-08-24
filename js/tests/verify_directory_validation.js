/**
 * verify_directory_validation.js
 * Standalone Node harness for js/utils/DirectoryValidation.js
 * (Legal Directories — Data Model, Stage 1).
 * Run: node js/tests/verify_directory_validation.js
 * No browser required.
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');

const DirectoryValidation = require(path.join(__dirname, '..', 'utils', 'DirectoryValidation.js'));

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

function messages(result) {
  return result.errors.map(e => e.message);
}

// ---- 1. Valid dataset (minimal) ----

function validDataset() {
  return {
    directories: [
      {
        id: 'dir-1', title: 'دليل', items: [
          { id: 'n-1', title: 'رابط', type: 'link', url: 'https://example.test' },
          {
            id: 'n-2', title: 'مجلد', type: 'folder', children: [
              { id: 'n-3', title: 'رابط فرعي', type: 'link', url: 'https://example.test/2' }
            ]
          }
        ]
      }
    ]
  };
}

check('a well-formed dataset is valid with zero errors', () => {
  const result = DirectoryValidation.validateDataset(validDataset());
  assert.strictEqual(result.valid, true);
  assert.strictEqual(result.errors.length, 0);
});

// ---- 2. Missing URL on link ----

check('link node missing url is reported', () => {
  const dataset = validDataset();
  delete dataset.directories[0].items[0].url;
  const result = DirectoryValidation.validateDataset(dataset);
  assert.strictEqual(result.valid, false);
  assert.ok(messages(result).some(m => m.includes('url is missing')));
});

// ---- 3. Duplicate IDs ----

check('duplicate node id (even across different directories) is reported', () => {
  const dataset = validDataset();
  dataset.directories.push({
    id: 'dir-2', title: 'دليل 2', items: [
      { id: 'n-1', title: 'مكرر', type: 'link', url: 'https://example.test/dup' } // reuses n-1
    ]
  });
  const result = DirectoryValidation.validateDataset(dataset);
  assert.strictEqual(result.valid, false);
  assert.ok(messages(result).some(m => m.includes('duplicate id')));
});

check('duplicate directory id is reported', () => {
  const dataset = validDataset();
  dataset.directories.push(JSON.parse(JSON.stringify(dataset.directories[0])));
  // second copy re-uses same directory id AND same node ids — expect both kinds of duplicate errors
  const result = DirectoryValidation.validateDataset(dataset);
  assert.strictEqual(result.valid, false);
  assert.ok(messages(result).some(m => m.includes('duplicate directory id')));
});

// ---- 4. Invalid type ----

check('invalid node type is reported', () => {
  const dataset = validDataset();
  dataset.directories[0].items[0].type = 'court'; // forbidden entity-specific type
  const result = DirectoryValidation.validateDataset(dataset);
  assert.strictEqual(result.valid, false);
  assert.ok(messages(result).some(m => m.includes('is invalid')));
});

// ---- 5. Invalid order ----

check('non-numeric order is reported', () => {
  const dataset = validDataset();
  dataset.directories[0].items[0].order = 'first';
  const result = DirectoryValidation.validateDataset(dataset);
  assert.strictEqual(result.valid, false);
  assert.ok(messages(result).some(m => m.includes('order') && m.includes('invalid')));
});

check('duplicate numeric order values are NOT an error (documented tie-break, not a violation)', () => {
  const dataset = validDataset();
  dataset.directories[0].items[0].order = 1;
  dataset.directories[0].items[1].order = 1;
  const result = DirectoryValidation.validateDataset(dataset);
  assert.strictEqual(result.valid, true);
});

// ---- 6. Missing title / id ----

check('missing title is reported', () => {
  const dataset = validDataset();
  delete dataset.directories[0].items[0].title;
  const result = DirectoryValidation.validateDataset(dataset);
  assert.ok(messages(result).some(m => m.includes('title is missing')));
});

check('missing id is reported', () => {
  const dataset = validDataset();
  delete dataset.directories[0].items[0].id;
  const result = DirectoryValidation.validateDataset(dataset);
  assert.ok(messages(result).some(m => m.includes('id is missing')));
});

// ---- 7. folder/link cross-contamination ----

check('folder must not declare url', () => {
  const dataset = validDataset();
  dataset.directories[0].items[1].url = 'https://example.test/should-not-be-here';
  const result = DirectoryValidation.validateDataset(dataset);
  assert.ok(messages(result).some(m => m.includes('folder must not declare url')));
});

check('link must not declare children', () => {
  const dataset = validDataset();
  dataset.directories[0].items[0].children = [];
  const result = DirectoryValidation.validateDataset(dataset);
  assert.ok(messages(result).some(m => m.includes('link must not declare children')));
});

// ---- 8. Nested/deep folders validate recursively ----

check('errors inside deeply nested children are still reported with a readable path', () => {
  const dataset = {
    directories: [{
      id: 'dir-1', title: 'دليل', items: [{
        id: 'a', title: 'A', type: 'folder', children: [{
          id: 'b', title: 'B', type: 'folder', children: [{
            id: 'c', title: 'C', type: 'link' // missing url, nested 2 levels deep
          }]
        }]
      }]
    }]
  };
  const result = DirectoryValidation.validateDataset(dataset);
  assert.strictEqual(result.valid, false);
  const err = result.errors.find(e => e.nodeId === 'c');
  assert.ok(err, 'expected an error for the deeply nested node');
  assert.ok(err.path.includes('A') && err.path.includes('B') && err.path.includes('C'));
});

// ---- 9. Malformed dataset root ----

check('non-object dataset is reported, does not throw', () => {
  const result = DirectoryValidation.validateDataset(null);
  assert.strictEqual(result.valid, false);
  assert.ok(result.errors.length > 0);
});

check('dataset without directories array is reported, does not throw', () => {
  const result = DirectoryValidation.validateDataset({});
  assert.strictEqual(result.valid, false);
});

// ---- 10. toDisplayString formatting ----

check('toDisplayString formats Directory/Node/message per the spec example shape', () => {
  const str = DirectoryValidation.toDisplayString({
    directoryId: 'courts', nodeId: 'state-court-aswan',
    path: 'محاكم > مجلس الدولة > أسوان', message: 'type=link, url is missing'
  });
  assert.ok(str.includes('Directory "courts"'));
  assert.ok(str.includes('Node "state-court-aswan"'));
  assert.ok(str.includes('url is missing'));
});

// ---- 11. The real demo dataset shipped with this phase must itself be valid ----

check('the shipped demo dataset (legal-directories.json) is valid', () => {
  const datasetPath = path.join(__dirname, '..', 'data', 'directories', 'legal-directories.json');
  const raw = fs.readFileSync(datasetPath, 'utf8');
  const dataset = JSON.parse(raw);
  const result = DirectoryValidation.validateDataset(dataset);
  if (!result.valid) {
    throw new Error('demo dataset has validation errors: ' + JSON.stringify(result.errors, null, 2));
  }
});

// ---- Report ----

console.log(log.join('\n'));
console.log('\n' + passed + ' passed, ' + failed + ' failed.');
if (failed > 0) process.exit(1);
