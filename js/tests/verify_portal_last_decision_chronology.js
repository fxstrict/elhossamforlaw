/**
 * verify_portal_last_decision_chronology.js
 * CASES_RELATIONSHIP_FINANCIAL — decision §3-K: "آخر قرار جلسة" must be
 * the chronologically-latest decision, not whatever array position
 * happened to be last. This tests the exact selection algorithm now
 * used inside Config/05_Portal.gs's renderCaseCard() (date+time sort,
 * explicit and local, independent of input order) — extracted here
 * because .gs files require GAS globals (SpreadsheetApp, Session,
 * Utilities) not available under Node, matching the project's existing
 * test-suite scope (no prior 05_Portal.gs coverage existed either).
 */
'use strict';

const assert = require('assert');

/**
 * Byte-for-byte the same algorithm as Config/05_Portal.gs renderCaseCard()
 * after the fix — kept in sync manually since .gs isn't require()-able.
 */
function pickLastDecisionAndNextDate(sessions, today, fallbackDecision, fallbackNextDate) {
  var chronological = (sessions || []).slice().sort(function (a, b) {
    var dateCmp = String(a['التاريخ'] || '').localeCompare(String(b['التاريخ'] || ''));
    if (dateCmp !== 0) return dateCmp;
    return String(a['الوقت'] || '').localeCompare(String(b['الوقت'] || ''));
  });
  var future = chronological.filter(function (s) { return String(s['التاريخ'] || '') >= today; });
  var past = chronological.filter(function (s) { return String(s['التاريخ'] || '') < today && s['القرار']; });
  return {
    lastDecision: past.length ? past[past.length - 1]['القرار'] : (fallbackDecision || ''),
    nextDate: future.length ? future[0]['التاريخ'] : (fallbackNextDate || '')
  };
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

const TODAY = '2026-06-01';

check('Sessions arriving in REVERSE chronological order still resolve the true last decision', () => {
  const sessions = [
    { 'التاريخ': '2026-03-01', 'القرار': 'تأجيل' },   // most recent, but FIRST in array
    { 'التاريخ': '2026-01-01', 'القرار': 'قبول الدعوى' } // oldest, but LAST in array
  ];
  const r = pickLastDecisionAndNextDate(sessions, TODAY);
  assert.strictEqual(r.lastDecision, 'تأجيل', 'expected the chronologically-latest decision, not array-last');
});

check('Same-day sessions are broken by وقت (time), not array order', () => {
  const sessions = [
    { 'التاريخ': '2026-02-01', 'الوقت': '16:00', 'القرار': 'قرار المساء' },
    { 'التاريخ': '2026-02-01', 'الوقت': '09:00', 'القرار': 'قرار الصباح' }
  ];
  const r = pickLastDecisionAndNextDate(sessions, TODAY);
  assert.strictEqual(r.lastDecision, 'قرار المساء', 'expected the later time-of-day to win on a tied date');
});

check('A session added later (appended) but chronologically earlier does not override a true later decision', () => {
  const sessions = [
    { 'التاريخ': '2026-01-01', 'القرار': 'أول جلسة' },
    { 'التاريخ': '2026-04-01', 'القرار': 'قرار حقيقي أحدث' },
    { 'التاريخ': '2026-02-15', 'القرار': 'جلسة أُضيفت لاحقًا لكنها أقدم تاريخيًا' } // appended last, but not latest date
  ];
  const r = pickLastDecisionAndNextDate(sessions, TODAY);
  assert.strictEqual(r.lastDecision, 'قرار حقيقي أحدث');
});

check('No past sessions with a decision falls back to قرارات_المحكمة', () => {
  const sessions = [{ 'التاريخ': '2026-08-01' }]; // future, no القرار
  const r = pickLastDecisionAndNextDate(sessions, TODAY, 'قرار قديم من الحقل المسطّح');
  assert.strictEqual(r.lastDecision, 'قرار قديم من الحقل المسطّح');
});

check('Next session date picks the soonest future date regardless of array order', () => {
  const sessions = [
    { 'التاريخ': '2026-09-01' },
    { 'التاريخ': '2026-06-15' },
    { 'التاريخ': '2026-07-01' }
  ];
  const r = pickLastDecisionAndNextDate(sessions, TODAY);
  assert.strictEqual(r.nextDate, '2026-06-15');
});

check('A single first-ever session for a case (no history) still resolves correctly', () => {
  const sessions = [{ 'التاريخ': '2026-01-01', 'القرار': 'الجلسة الأولى' }];
  const r = pickLastDecisionAndNextDate(sessions, TODAY);
  assert.strictEqual(r.lastDecision, 'الجلسة الأولى');
  assert.strictEqual(r.nextDate, '');
});

console.log('\n' + passed + '/' + (passed + failed) + ' checks passed.');
if (failed > 0) {
  console.log('\n' + failed + ' CHECK(S) FAILED.');
  process.exit(1);
} else {
  console.log('\nALL CHECKS PASSED.');
  process.exit(0);
}
