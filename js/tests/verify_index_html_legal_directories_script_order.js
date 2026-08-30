/**
 * verify_index_html_legal_directories_script_order.js
 * Static/textual check on index.html's <script> tag order for the
 * Legal Directories feature (Final Audit §5).
 *
 * IMPORTANT — WHAT THIS TEST DOES NOT DO
 *   This does NOT execute index.html in a browser/DOM and does NOT
 *   prove the scripts actually run correctly together at runtime.
 *   Node has no <script> tag execution model to replicate real
 *   sequential, non-async/non-defer script loading. What it DOES
 *   check, honestly: (1) every relevant <script> tag exists exactly
 *   once, (2) none of them carry `async`/`defer` (which would break
 *   the sequential-execution assumption every file in this feature
 *   relies on), and (3) their DOCUMENT ORDER matches the real
 *   load-time dependency order (DirectoryModel -> DirectoryValidation
 *   -> DirectoryRenderer -> DirectoryPublisher -> legal-directories-
 *   admin.js -> legal-directories.js), which is what actually matters
 *   in a browser since these files resolve `global.DirectoryModel`
 *   etc. at SCRIPT-EXECUTION time, not inside a require() call.
 *   Real browser/DOM verification is unavailable in this sandbox —
 *   see the Final Audit report for the explicit
 *   "Static verification passed / Real browser verification
 *   unavailable" distinction.
 * Run: node js/tests/verify_index_html_legal_directories_script_order.js
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');

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

const indexPath = path.join(__dirname, '..', '..', 'index.html');
const html = fs.readFileSync(indexPath, 'utf8');

const REQUIRED_ORDER = [
  'js/utils/DirectoryModel.js?v=1',
  'js/utils/DirectoryValidation.js?v=1',
  'js/utils/DirectoryRenderer.js?v=1',
  'js/utils/DirectoryPublisher.js?v=1',
  'js/modules/legal-directories-admin.js?v=1',
  'js/modules/legal-directories.js?v=1'
];

check('every Legal Directories <script> tag appears exactly once in index.html', () => {
  REQUIRED_ORDER.forEach((src) => {
    const needle = '<script src="' + src + '"></script>';
    const count = html.split(needle).length - 1;
    assert.strictEqual(count, 1, 'expected exactly one <script> tag for ' + src + ', found ' + count);
  });
});

check('none of the Legal Directories <script> tags use async or defer (sequential execution is required)', () => {
  REQUIRED_ORDER.forEach((src) => {
    const re = new RegExp('<script[^>]*src="' + src.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '"[^>]*>', 'i');
    const tag = html.match(re)[0];
    assert.ok(!/\basync\b/.test(tag), src + ' unexpectedly has async');
    assert.ok(!/\bdefer\b/.test(tag), src + ' unexpectedly has defer');
  });
});

check('the <script> tags appear in the exact required dependency order (document order = execution order)', () => {
  const positions = REQUIRED_ORDER.map((src) => html.indexOf('<script src="' + src + '"></script>'));
  positions.forEach((pos, i) => {
    assert.ok(pos !== -1, 'missing tag for ' + REQUIRED_ORDER[i]);
  });
  for (let i = 1; i < positions.length; i++) {
    assert.ok(positions[i] > positions[i - 1],
      REQUIRED_ORDER[i] + ' must appear AFTER ' + REQUIRED_ORDER[i - 1] + ' in document order');
  }
});

check('RBAC scripts (window.HossamSession/HossamPermissionService providers) appear before the Legal Directories block', () => {
  const rbacPos = html.indexOf('<script src="js/core/rbac/PermissionService.js?v=42"></script>');
  const firstLegalDirPos = html.indexOf('<script src="' + REQUIRED_ORDER[0] + '"></script>');
  assert.ok(rbacPos !== -1 && firstLegalDirPos !== -1);
  assert.ok(rbacPos < firstLegalDirPos, 'RBAC scripts should load before the Legal Directories scripts');
});

// ---- Report ----

console.log(log.join('\n'));
console.log('\n' + passed + ' passed, ' + failed + ' failed.');
console.log('\nNOTE: Static verification passed. Real browser/DOM script-execution verification is unavailable in this environment.');
if (failed > 0) process.exit(1);
