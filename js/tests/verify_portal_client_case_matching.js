/**
 * verify_portal_client_case_matching.js
 * CASES_RELATIONSHIP_FINANCIAL — decision §3-C: the Portal must resolve
 * a client's cases via the new ID-based قضية_موكلين junction table as
 * the primary path, falling back to legacy اسم_الموكل text-matching
 * only for cases that predate this phase. This tests the exact
 * selection algorithm now used inside Config/05_Portal.gs's
 * serveClientPortal() — extracted here because .gs files require GAS
 * globals not available under Node (same rationale as the other two
 * Portal algorithm test files in this directory).
 */
'use strict';

const assert = require('assert');

/**
 * Byte-for-byte the same algorithm as Config/05_Portal.gs's
 * serveClientPortal() case-matching block — kept in sync manually
 * since .gs isn't require()-able.
 */
function resolveMyCases(clientId, clientName, allCases, allCaseClients) {
  const myCaseNumsFromJunction = allCaseClients
    .filter(function (r) { return String(r['رقم_الموكل'] || '').trim() === String(clientId).trim() && clientId; })
    .map(function (r) { return String(r['رقم_القضية'] || '').trim(); });

  const myCaseNumsSet = {};
  myCaseNumsFromJunction.forEach(function (n) { if (n) myCaseNumsSet[n] = true; });

  return allCases.filter(function (c) {
    const num = String(c['رقم_القضية'] || '').trim();
    if (myCaseNumsSet[num]) return true;
    return String(c['اسم_الموكل'] || '').trim() === clientName.trim();
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

const ALL_CASES = [
  { 'رقم_القضية': '2025/1001', 'اسم_الموكل': 'أحمد محمود' },       // legacy-only, no junction row
  { 'رقم_القضية': '2025/2001', 'اسم_الموكل': '' },                  // ID-only (new flow — اسم_الموكل blank/unrelated)
  { 'رقم_القضية': '2025/3001', 'اسم_الموكل': 'موكل آخر تمامًا' }     // belongs to someone else entirely
];
const ALL_CASE_CLIENTS = [
  { 'رقم_القضية': '2025/2001', 'رقم_الموكل': 'CL1' }
];

check('resolveMyCases(): matches via the ID-based junction table (new cases with no legacy اسم_الموكل match)', () => {
  const mine = resolveMyCases('CL1', 'أحمد محمود', ALL_CASES, ALL_CASE_CLIENTS);
  assert.ok(mine.some(c => c['رقم_القضية'] === '2025/2001'), 'must include the ID-matched case');
});

check('resolveMyCases(): STILL matches a legacy case that has no قضية_موكلين row at all (backward compat, zero data loss)', () => {
  const mine = resolveMyCases('CL1', 'أحمد محمود', ALL_CASES, ALL_CASE_CLIENTS);
  assert.ok(mine.some(c => c['رقم_القضية'] === '2025/1001'), 'must still include the legacy name-matched case');
});

check('resolveMyCases(): does not include a case matched by neither method', () => {
  const mine = resolveMyCases('CL1', 'أحمد محمود', ALL_CASES, ALL_CASE_CLIENTS);
  assert.ok(!mine.some(c => c['رقم_القضية'] === '2025/3001'));
});

check('resolveMyCases(): a case matched by BOTH methods is not duplicated', () => {
  const bothCases = [{ 'رقم_القضية': '2025/9001', 'اسم_الموكل': 'أحمد محمود' }];
  const bothLinks = [{ 'رقم_القضية': '2025/9001', 'رقم_الموكل': 'CL1' }];
  const mine = resolveMyCases('CL1', 'أحمد محمود', bothCases, bothLinks);
  assert.strictEqual(mine.length, 1);
});

check('resolveMyCases(): a client with no رقم_الموكل at all (legacy client record) still falls back correctly to name-only matching', () => {
  const mine = resolveMyCases('', 'أحمد محمود', ALL_CASES, ALL_CASE_CLIENTS);
  assert.ok(mine.some(c => c['رقم_القضية'] === '2025/1001'));
  assert.ok(!mine.some(c => c['رقم_القضية'] === '2025/2001'), 'must NOT match the ID-only case when clientId is empty');
});

console.log('\n' + passed + '/' + (passed + failed) + ' checks passed.');
if (failed > 0) {
  console.log('\n' + failed + ' CHECK(S) FAILED.');
  process.exit(1);
} else {
  console.log('\nALL CHECKS PASSED.');
  process.exit(0);
}
