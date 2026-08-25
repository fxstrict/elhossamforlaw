/**
 * verify_service_worker_legal_directories_precache.js
 * Static/textual checks on service-worker.js's PRECACHE_URLS changes
 * for Legal Directories offline support (Stage 4 §6).
 *
 * IMPORTANT — WHAT THIS TEST DOES NOT DO
 *   Node has no ServiceWorkerGlobalScope, no `self`, and no Cache
 *   Storage API. This file does NOT execute service-worker.js and
 *   does NOT verify actual offline behavior in a browser — that
 *   requires a real browser/Playwright environment this sandbox does
 *   not have. What it DOES verify, honestly and within what Node can
 *   check: (1) the file is still syntactically valid JavaScript,
 *   (2) PRECACHE_URLS contains exactly the intended new read-only
 *   Legal Directories entries, each exactly once, matching the exact
 *   ?v= query strings referenced by index.html's own <script>/<link>
 *   tags (a mismatch here would mean the precached response is never
 *   requested by the actual page — a real, catchable bug), (3) the
 *   Admin-only files are deliberately NOT in that list, and (4)
 *   SW_VERSION was bumped exactly once and is still a single
 *   declaration (no accidental duplicate `var SW_VERSION`).
 * Run: node js/tests/verify_service_worker_legal_directories_precache.js
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');

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

const swPath = path.join(__dirname, '..', '..', 'service-worker.js');
const indexPath = path.join(__dirname, '..', '..', 'index.html');
const swSource = fs.readFileSync(swPath, 'utf8');
const indexSource = fs.readFileSync(indexPath, 'utf8');

const EXPECTED_PRECACHED = [
  'css/legal-directories.css?v=1',
  'js/utils/DirectoryModel.js?v=1',
  'js/utils/DirectoryValidation.js?v=1',
  'js/utils/DirectoryRenderer.js?v=1',
  'js/modules/legal-directories.js?v=1',
  'js/data/directories/legal-directories.json'
];

const EXPECTED_NOT_PRECACHED = [
  'js/utils/DirectoryPublisher.js',
  'js/modules/legal-directories-admin.js'
];

check('service-worker.js is still syntactically valid JavaScript', () => {
  execSync('node -c ' + JSON.stringify(swPath), { stdio: 'pipe' });
});

check('SW_VERSION is declared exactly once (no duplicate/leftover var from editing)', () => {
  const matches = swSource.match(/var\s+SW_VERSION\s*=/g) || [];
  assert.strictEqual(matches.length, 1);
});

check('SW_VERSION was bumped to v62 for the compact-card CSS content change', () => {
  assert.ok(/var SW_VERSION = 'v62'/.test(swSource));
});

EXPECTED_PRECACHED.forEach((url) => {
  check('PRECACHE_URLS contains "' + url + '" exactly once', () => {
    const needle = "'" + url + "'";
    const count = swSource.split(needle).length - 1;
    assert.strictEqual(count, 1, 'expected exactly one occurrence, found ' + count);
  });
});

EXPECTED_NOT_PRECACHED.forEach((url) => {
  check('Admin-only file "' + url + '" is NOT in PRECACHE_URLS (by design — see Stage 4 §6)', () => {
    // It's fine for the bare filename to appear in a comment (it does,
    // explaining the exclusion) — what must never appear is the exact
    // quoted array-entry form used by every real PRECACHE_URLS item.
    const asArrayEntry = "'" + url + "?v=1'";
    assert.ok(!swSource.includes(asArrayEntry), 'found an unexpected precache entry for ' + url);
  });
});

check('every precached Legal-Directories JS/CSS URL exactly matches a real <script>/<link> tag in index.html', () => {
  ['css/legal-directories.css?v=1', 'js/utils/DirectoryModel.js?v=1', 'js/utils/DirectoryValidation.js?v=1',
    'js/utils/DirectoryRenderer.js?v=1', 'js/modules/legal-directories.js?v=1'].forEach((url) => {
    assert.ok(indexSource.includes(url), 'index.html has no tag referencing ' + url);
  });
});

check('the precached dataset URL exactly matches the fetch() path used in js/modules/legal-directories.js (no query string drift)', () => {
  const modulePath = path.join(__dirname, '..', 'modules', 'legal-directories.js');
  const moduleSource = fs.readFileSync(modulePath, 'utf8');
  assert.ok(moduleSource.includes("fetch('js/data/directories/legal-directories.json')"));
  assert.ok(swSource.includes("'js/data/directories/legal-directories.json'"));
});

// ---- Report ----

console.log(log.join('\n'));
console.log('\n' + passed + ' passed, ' + failed + ' failed.');
if (failed > 0) process.exit(1);
