/**
 * verify_directory_publisher.js
 * Standalone Node harness for js/utils/DirectoryPublisher.js
 * (Legal Directories — Architecture hardening / Publisher, Stage 4).
 * Run: node js/tests/verify_directory_publisher.js
 * No browser required — pure logic, no DOM, no network.
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');

const DirectoryModel = require(path.join(__dirname, '..', 'utils', 'DirectoryModel.js'));
const DirectoryValidation = require(path.join(__dirname, '..', 'utils', 'DirectoryValidation.js'));
const DirectoryPublisher = require(path.join(__dirname, '..', 'utils', 'DirectoryPublisher.js'));

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

function validDataset() {
  return {
    directories: [
      {
        id: 'dir-1', title: 'دليل', order: 1, items: [
          { id: 'n-2', title: 'ثاني', type: 'link', url: 'https://example.test/2', order: 2 },
          { id: 'n-1', title: 'أول', type: 'link', url: 'https://example.test/1', order: 1 },
          {
            id: 'n-3', title: 'مجلد', type: 'folder', order: 3, children: [
              { id: 'n-3b', title: 'فرعي ب', type: 'link', url: 'https://example.test/3b', order: 2 },
              { id: 'n-3a', title: 'فرعي أ', type: 'link', url: 'https://example.test/3a', order: 1 }
            ]
          }
        ]
      }
    ]
  };
}

// ---- 1. Export produces valid JSON ----

check('createExportArtifact() produces a valid, re-parseable JSON string', () => {
  const artifact = DirectoryPublisher.createExportArtifact(validDataset());
  assert.doesNotThrow(() => JSON.parse(artifact.content));
});

// ---- 2. Export contains the expected schema ----

check('the exported dataset has exactly the expected top-level keys, in canonical order', () => {
  const artifact = DirectoryPublisher.createExportArtifact(validDataset());
  const parsed = JSON.parse(artifact.content);
  assert.deepStrictEqual(Object.keys(parsed), ['$schemaVersion', 'version', 'updatedAt', 'directories']);
});

check('each exported Directory/Node only has schema fields, none of them the draft\'s internal extras', () => {
  const dataset = validDataset();
  dataset.directories[0].someAdminUiOnlyField = 'should not survive export'; // simulate stray field
  const artifact = DirectoryPublisher.createExportArtifact(dataset);
  const parsed = JSON.parse(artifact.content);
  assert.strictEqual(parsed.directories[0].someAdminUiOnlyField, undefined);
  const expectedDirKeys = ['id', 'slug', 'title', 'description', 'icon', 'defaultIcon', 'enabled', 'order', 'items', 'metadata', 'version', 'updatedAt'];
  assert.deepStrictEqual(Object.keys(parsed.directories[0]), expectedDirKeys.filter((k) => parsed.directories[0][k] !== undefined));
});

check('link nodes never carry a "children" key and folder nodes never carry a "url" key in the export', () => {
  const artifact = DirectoryPublisher.createExportArtifact(validDataset());
  const parsed = JSON.parse(artifact.content);
  const folder = parsed.directories[0].items.find((n) => n.type === 'folder');
  const link = parsed.directories[0].items.find((n) => n.type === 'link');
  assert.strictEqual(link.children, undefined);
  assert.strictEqual(folder.url, undefined);
  assert.ok(Array.isArray(folder.children));
});

// ---- 3. Export does not mutate the live/input dataset ----

check('createExportArtifact() never mutates the dataset object passed in', () => {
  const dataset = validDataset();
  const snapshot = JSON.stringify(dataset);
  DirectoryPublisher.createExportArtifact(dataset);
  assert.strictEqual(JSON.stringify(dataset), snapshot);
});

// ---- 4. Ordering remains deterministic ----

check('items/children are sorted by `order` in the export regardless of their order in the source array', () => {
  const artifact = DirectoryPublisher.createExportArtifact(validDataset());
  const parsed = JSON.parse(artifact.content);
  assert.deepStrictEqual(parsed.directories[0].items.map((n) => n.id), ['n-1', 'n-2', 'n-3']);
  const folder = parsed.directories[0].items.find((n) => n.id === 'n-3');
  assert.deepStrictEqual(folder.children.map((n) => n.id), ['n-3a', 'n-3b']);
});

check('two exports of the same dataset (fixed baseVersion/now) produce byte-identical content', () => {
  const dataset = validDataset();
  const a = DirectoryPublisher.createExportArtifact(dataset, { baseVersion: 5, now: '2026-01-01T00:00:00.000Z' });
  const b = DirectoryPublisher.createExportArtifact(dataset, { baseVersion: 5, now: '2026-01-01T00:00:00.000Z' });
  assert.strictEqual(a.content, b.content);
});

check('key order does not depend on admin edit history (rebuilt-in-different-order dataset still canonicalizes the same)', () => {
  const a = validDataset();
  // Build an equivalent dataset with items constructed in reverse key
  // insertion order, simulating "added later" vs "added first" drift.
  const b = {
    directories: [{
      order: 1, title: 'دليل', id: 'dir-1', items: [
        { order: 1, url: 'https://example.test/1', type: 'link', title: 'أول', id: 'n-1' },
        { order: 2, url: 'https://example.test/2', type: 'link', title: 'ثاني', id: 'n-2' },
        {
          order: 3, type: 'folder', title: 'مجلد', id: 'n-3', children: [
            { order: 1, url: 'https://example.test/3a', type: 'link', title: 'فرعي أ', id: 'n-3a' },
            { order: 2, url: 'https://example.test/3b', type: 'link', title: 'فرعي ب', id: 'n-3b' }
          ]
        }
      ]
    }]
  };
  const artifactA = DirectoryPublisher.createExportArtifact(a, { baseVersion: 0, now: 'X' });
  const artifactB = DirectoryPublisher.createExportArtifact(b, { baseVersion: 0, now: 'X' });
  assert.strictEqual(artifactA.content, artifactB.content);
});

// ---- 5. Validation blocks invalid draft ----

check('createExportArtifact() throws on an invalid dataset instead of silently exporting broken data', () => {
  const broken = { directories: [{ id: 'd1', title: 'D', items: [{ id: 'n1', title: 'N', type: 'link' }] }] }; // missing url
  assert.throws(() => DirectoryPublisher.createExportArtifact(broken), /failed validation/);
});

// ---- 6. Valid draft can be exported ----

check('createExportArtifact() succeeds on a valid dataset and returns the expected filename', () => {
  const artifact = DirectoryPublisher.createExportArtifact(validDataset());
  assert.strictEqual(artifact.filename, 'legal-directories.json');
});

// ---- Versioning (Stage-4 §5) ----

check('bump:false reuses the dataset\'s existing version/updatedAt verbatim (no-op re-export)', () => {
  const dataset = validDataset();
  dataset.version = 5;
  dataset.updatedAt = '2020-01-01T00:00:00.000Z';
  const artifact = DirectoryPublisher.createExportArtifact(dataset, { bump: false });
  const parsed = JSON.parse(artifact.content);
  assert.strictEqual(parsed.version, 5);
  assert.strictEqual(parsed.updatedAt, '2020-01-01T00:00:00.000Z');
});

check('re-exporting the SAME unchanged dataset twice with bump:false is byte-for-byte identical (FINAL AUDIT §2)', () => {
  const dataset = validDataset();
  dataset.version = 2;
  dataset.updatedAt = '2021-06-15T00:00:00.000Z';
  const a = DirectoryPublisher.createExportArtifact(dataset, { bump: false });
  const b = DirectoryPublisher.createExportArtifact(dataset, { bump: false });
  assert.strictEqual(a.content, b.content);
});

check('bump:false on a dataset with no prior version/updatedAt falls back sanely instead of emitting undefined', () => {
  const artifact = DirectoryPublisher.createExportArtifact(validDataset(), { bump: false, baseVersion: 0, now: '2022-02-02T00:00:00.000Z' });
  const parsed = JSON.parse(artifact.content);
  assert.strictEqual(parsed.version, 1); // no prior version, no baseVersion bump requested -> falls back to 1, not 0/undefined
  assert.strictEqual(parsed.updatedAt, '2022-02-02T00:00:00.000Z');
});

check('bump:true (default) always advances version/updatedAt even if content looks the same, when explicitly requested', () => {
  const dataset = validDataset();
  dataset.version = 5;
  dataset.updatedAt = '2020-01-01T00:00:00.000Z';
  const artifact = DirectoryPublisher.createExportArtifact(dataset, { now: '2026-01-01T00:00:00.000Z' });
  const parsed = JSON.parse(artifact.content);
  assert.strictEqual(parsed.version, 6);
  assert.strictEqual(parsed.updatedAt, '2026-01-01T00:00:00.000Z');
});

check('version defaults to 1 when the source dataset has no version field', () => {
  const artifact = DirectoryPublisher.createExportArtifact(validDataset());
  const parsed = JSON.parse(artifact.content);
  assert.strictEqual(parsed.version, 1);
});

check('version increments relative to an explicit baseVersion, not the (possibly stale) dataset.version', () => {
  const dataset = validDataset();
  dataset.version = 7; // simulate a dataset object that already has a version
  const artifact = DirectoryPublisher.createExportArtifact(dataset, { baseVersion: 41 });
  const parsed = JSON.parse(artifact.content);
  assert.strictEqual(parsed.version, 42); // baseVersion wins over dataset.version when explicitly given
});

check('version falls back to dataset.version + 1 when no explicit baseVersion is given', () => {
  const dataset = validDataset();
  dataset.version = 3;
  const artifact = DirectoryPublisher.createExportArtifact(dataset);
  const parsed = JSON.parse(artifact.content);
  assert.strictEqual(parsed.version, 4);
});

check('updatedAt uses the provided `now` when given, otherwise a valid current ISO date', () => {
  const artifact1 = DirectoryPublisher.createExportArtifact(validDataset(), { now: '2020-05-05T05:05:05.000Z' });
  assert.strictEqual(JSON.parse(artifact1.content).updatedAt, '2020-05-05T05:05:05.000Z');
  const artifact2 = DirectoryPublisher.createExportArtifact(validDataset());
  assert.ok(!isNaN(new Date(JSON.parse(artifact2.content).updatedAt).getTime()));
});

// ---- 7. Static dataset still validates (and now carries version/updatedAt) ----

check('the real shipped legal-directories.json still validates, including its new version/updatedAt stamp', () => {
  const datasetPath = path.join(__dirname, '..', 'data', 'directories', 'legal-directories.json');
  const real = JSON.parse(fs.readFileSync(datasetPath, 'utf8'));
  assert.strictEqual(typeof real.version, 'number');
  assert.strictEqual(typeof real.updatedAt, 'string');
  const result = DirectoryValidation.validateDataset(real);
  assert.strictEqual(result.valid, true, JSON.stringify(result.errors));
});

check('exporting the real shipped dataset bumps its version by exactly 1', () => {
  const datasetPath = path.join(__dirname, '..', 'data', 'directories', 'legal-directories.json');
  const real = JSON.parse(fs.readFileSync(datasetPath, 'utf8'));
  const artifact = DirectoryPublisher.createExportArtifact(real);
  assert.strictEqual(JSON.parse(artifact.content).version, real.version + 1);
});

// ---- Report ----

console.log(log.join('\n'));
console.log('\n' + passed + ' passed, ' + failed + ' failed.');
if (failed > 0) process.exit(1);
