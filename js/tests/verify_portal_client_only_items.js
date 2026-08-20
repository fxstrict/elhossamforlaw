/**
 * verify_portal_client_only_items.js
 * CASES_RELATIONSHIP_FINANCIAL — decision §3-L/§3-H: a document or
 * admin-work task linked to a client without any case (رقم_القضية
 * empty) was previously invisible in the Client Portal entirely, since
 * every existing section was scoped strictly per-case. This tests the
 * exact filtering algorithm now used inside Config/05_Portal.gs's
 * serveClientPortal() — extracted here because .gs files require GAS
 * globals not available under Node (same rationale as this session's
 * other Portal algorithm test files).
 */
'use strict';

const assert = require('assert');

const PORTAL_DOCUMENTS_DEFAULT_VISIBLE = false;
const PORTAL_TASKS_DEFAULT_VISIBLE = false;

function toBoolFlag(v, defaultVal) {
  if (v === '' || v == null) return defaultVal;
  var s = String(v).trim();
  if (s === 'نعم' || s === 'true' || s === '1') return true;
  if (s === 'لا' || s === 'false' || s === '0') return false;
  return defaultVal;
}

/**
 * Byte-for-byte the same algorithm as Config/05_Portal.gs's
 * myClientOnlyDocuments/myClientOnlyTasks filters.
 */
function filterClientOnlyDocuments(allDocuments, clientId) {
  return allDocuments.filter(function (d) {
    var noCaseNum = !String(d['رقم_القضية'] || '').trim();
    var byClient = String(d['رقم_الموكل'] || '').trim() === String(clientId).trim();
    return noCaseNum && byClient && toBoolFlag(d['ظاهر_للموكل'], PORTAL_DOCUMENTS_DEFAULT_VISIBLE);
  });
}

function filterClientOnlyTasks(allTasks, clientId) {
  return allTasks.filter(function (t) {
    var noCaseNum = !String(t['رقم_القضية'] || '').trim();
    var byClient = String(t['رقم_الموكل'] || '').trim() === String(clientId).trim();
    return noCaseNum && byClient && toBoolFlag(t['ظاهر_للموكل'], PORTAL_TASKS_DEFAULT_VISIBLE);
  });
}

let passed = 0;
let failed = 0;
function check(label, fn) {
  try {
    fn();
    console.log('PASS — ' + label);
    passed++;
  } catch (e) {
    console.log('FAIL — ' + label + '  =>  ' + e.message);
    failed++;
  }
}

const DOCS = [
  { 'رقم_المستند': 'D1', 'رقم_القضية': '', 'رقم_الموكل': 'CL1', 'ظاهر_للموكل': 'نعم' }, // client-only, visible -> should appear
  { 'رقم_المستند': 'D2', 'رقم_القضية': '', 'رقم_الموكل': 'CL1', 'ظاهر_للموكل': 'لا' },  // client-only, hidden -> excluded
  { 'رقم_المستند': 'D3', 'رقم_القضية': '2025/1001', 'رقم_الموكل': 'CL1', 'ظاهر_للموكل': 'نعم' }, // HAS a case -> excluded from client-only (belongs to the per-case section instead)
  { 'رقم_المستند': 'D4', 'رقم_القضية': '', 'رقم_الموكل': 'CL2', 'ظاهر_للموكل': 'نعم' } // different client -> excluded
];

const TASKS = [
  { 'رقم_المهمة': 'T1', 'رقم_القضية': '', 'رقم_الموكل': 'CL1', 'ظاهر_للموكل': 'نعم' },
  { 'رقم_المهمة': 'T2', 'رقم_القضية': '2025/1001', 'رقم_الموكل': 'CL1', 'ظاهر_للموكل': 'نعم' }
];

check('filterClientOnlyDocuments(): a client-only, visible document IS included', () => {
  const result = filterClientOnlyDocuments(DOCS, 'CL1');
  assert.ok(result.some(d => d['رقم_المستند'] === 'D1'));
});

check('filterClientOnlyDocuments(): a client-only, HIDDEN document is excluded (respects ظاهر_للموكل)', () => {
  const result = filterClientOnlyDocuments(DOCS, 'CL1');
  assert.ok(!result.some(d => d['رقم_المستند'] === 'D2'));
});

check('filterClientOnlyDocuments(): a document that HAS a case is excluded from the client-only section (belongs in the per-case section instead — no double-display)', () => {
  const result = filterClientOnlyDocuments(DOCS, 'CL1');
  assert.ok(!result.some(d => d['رقم_المستند'] === 'D3'));
});

check('filterClientOnlyDocuments(): a different client\'s document is excluded', () => {
  const result = filterClientOnlyDocuments(DOCS, 'CL1');
  assert.ok(!result.some(d => d['رقم_المستند'] === 'D4'));
  assert.strictEqual(result.length, 1); // only D1
});

check('filterClientOnlyTasks(): same rules apply to tasks (client-only + visible + no case)', () => {
  const result = filterClientOnlyTasks(TASKS, 'CL1');
  assert.strictEqual(result.length, 1);
  assert.strictEqual(result[0]['رقم_المهمة'], 'T1');
});

console.log('\n' + passed + '/' + (passed + failed) + ' checks passed.');
if (failed > 0) {
  console.log('\n' + failed + ' CHECK(S) FAILED.');
  process.exit(1);
} else {
  console.log('\nALL CHECKS PASSED.');
  process.exit(0);
}
