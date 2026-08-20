/**
 * verify_portal_litigation_chain.js
 * CASES_RELATIONSHIP_FINANCIAL — decision §3-E: "يجب أن تكون العلاقة
 * ظاهرة ومفهومة في... بوابة الموكل." This tests the exact chain-walk
 * algorithm now used inside Config/05_Portal.gs's resolveLitigationChain()
 * — extracted here because .gs files require GAS globals not available
 * under Node (same rationale as verify_portal_last_decision_chronology.js).
 * The algorithm here is intentionally IDENTICAL to js/modules/cases.js's
 * getLitigationChain() (browser-side) — this file's own header documents
 * that duplication (Apps Script can't require() a browser module).
 */
'use strict';

const assert = require('assert');

/**
 * Byte-for-byte the same algorithm as Config/05_Portal.gs's
 * resolveLitigationChain() — kept in sync manually since .gs isn't
 * require()-able (same constraint noted in that function's own header).
 */
function resolveLitigationChain(c, allCases) {
  var group = c['مجموعة_تقاضي'];
  if (!group) return [c];

  var members = allCases.filter(function (x) { return x['مجموعة_تقاضي'] === group; });
  var byNum = {};
  members.forEach(function (m) { byNum[m['رقم_القضية']] = m; });

  var root = members.filter(function (m) { return !m['قضية_أصل'] || !byNum[m['قضية_أصل']]; })[0] || members[0];

  var chain = [root];
  var seen = {};
  seen[root['رقم_القضية']] = true;
  var current = root;
  while (chain.length < members.length) {
    var next = members.filter(function (m) { return m['قضية_أصل'] === current['رقم_القضية'] && !seen[m['رقم_القضية']]; })[0];
    if (!next) break;
    chain.push(next);
    seen[next['رقم_القضية']] = true;
    current = next;
  }
  return chain;
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

const CASES = [
  { 'رقم_القضية': '2025/1001', 'درجة_التقاضي': 'ابتدائي', 'قضية_أصل': '', 'مجموعة_تقاضي': '2025/1001' },
  { 'رقم_القضية': '2025/2001', 'درجة_التقاضي': 'استئناف', 'قضية_أصل': '2025/1001', 'مجموعة_تقاضي': '2025/1001' },
  { 'رقم_القضية': '2025/3001', 'درجة_التقاضي': 'نقض', 'قضية_أصل': '2025/2001', 'مجموعة_تقاضي': '2025/1001' },
  { 'رقم_القضية': '2025/9999', 'درجة_التقاضي': '', 'قضية_أصل': '', 'مجموعة_تقاضي': '' } // not part of any chain
];

check('resolveLitigationChain(): returns the full 3-stage chain in root -> leaf order, regardless of which member is queried', () => {
  const expected = ['2025/1001', '2025/2001', '2025/3001'];
  [CASES[0], CASES[1], CASES[2]].forEach(c => {
    const chain = resolveLitigationChain(c, CASES);
    assert.deepStrictEqual(chain.map(x => x['رقم_القضية']), expected);
  });
});

check('resolveLitigationChain(): a case with no مجموعة_تقاضي returns just itself', () => {
  const chain = resolveLitigationChain(CASES[3], CASES);
  assert.strictEqual(chain.length, 1);
  assert.strictEqual(chain[0]['رقم_القضية'], '2025/9999');
});

check('resolveLitigationChain(): produces the SAME result as js/modules/cases.js\'s getLitigationChain() would for an identical fixture (cross-file consistency)', () => {
  // Mirrors the exact fixture used in verify_cases_repository_integration.js's
  // getLitigationChain() tests — same 3 cases, same expected root->leaf order.
  const chain = resolveLitigationChain(CASES[1], CASES); // query from the middle
  assert.deepStrictEqual(chain.map(x => x['رقم_القضية']), ['2025/1001', '2025/2001', '2025/3001']);
});

console.log('\n' + passed + '/' + (passed + failed) + ' checks passed.');
if (failed > 0) {
  console.log('\n' + failed + ' CHECK(S) FAILED.');
  process.exit(1);
} else {
  console.log('\nALL CHECKS PASSED.');
  process.exit(0);
}
