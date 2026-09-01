/**
 * verify_payment_security.js
 * PHASE 8 — SECURITY + PAYMENT WORKFLOW (data/logic layer). Written
 * BEFORE the implementing code change (TDD, per audit rule).
 *
 * Proves PHASE 7 §16 BUG FOUND items are fixed:
 *   1. createFeePayment() rejects a رقم_علاقة that doesn't exist in
 *      CaseClientsRepository (no referential integrity check existed
 *      before this phase).
 *   2. createFeePayment() rejects a payment whose رقم_القضية/رقم_الموكل
 *      don't match the relationship's own رقم_القضية/رقم_الموكل (a
 *      payment for case 123 cannot be filed under a relationship that
 *      actually belongs to case 456).
 *   3. createFeePayment() rejects (does not silently allow) a payment
 *      amount that would push collected beyond the relationship's
 *      أتعاب_العلاقة (agreed total) — per PHASE 8 prompt §4: "لا تسمح
 *      بالحفظ بشكل عادي... لا تفترض السماح بالزيادة من نفسك."
 *   4. getRelationshipRemaining(relationshipId) — new, precise
 *      per-relationship (not per-case/per-client aggregate) figure,
 *      needed by the payment modal to show "المتبقي قبل الدفعة" and to
 *      enforce the cap in (3). Uses ONLY رقم_علاقة-tagged Fees for
 *      "collected" (never the legacy رقم_القضية/اسم_الموكل fallback) —
 *      deliberately narrower than getCaseNet/getClientNet, because a
 *      single case can have more than one relationship (multiple
 *      clients), and legacy name/case matching cannot distinguish which
 *      relationship an untagged historical payment belongs to.
 *
 * A soft-deleted relationship must be treated as "does not exist" by
 * all of the above (CaseClientsRepository.getAll()/data.caseClients
 * mirror already exclude it — this test confirms createFeePayment()
 * actually looks it up through that same exclusion, not through a
 * separate unfiltered path).
 */
'use strict';

const assert = require('assert');
const path = require('path');
const { FakeIndexedDB } = require(path.join(__dirname, 'fake_indexeddb.js'));

require(path.join(__dirname, '..', 'core', 'Repository.js'));
require(path.join(__dirname, '..', 'core', 'DatabaseService.js'));
require(path.join(__dirname, '..', 'core', 'IndexedDBAdapter.js'));

global.data = { clients: [], cases: [], fees: [], expenses: [], caseClients: [] };

const { CaseClientsRepository, createCaseClientsLocalStorageAdapter } =
  require(path.join(__dirname, '..', 'repositories', 'CaseClientsRepository.js'));

const fakeIndexedDBForExpenses = new FakeIndexedDB();
global.indexedDB = fakeIndexedDBForExpenses;
const financialReports = require(path.join(__dirname, '..', 'modules', 'financial-reports.js'));

const { FeesRepository, createFeesLocalStorageAdapter } =
  require(path.join(__dirname, '..', 'repositories', 'FeesRepository.js'));

let passed = 0;
let failed = 0;
async function check(label, fn) {
  try {
    await fn();
    console.log('PASS — ' + label);
    passed++;
  } catch (e) {
    console.log('FAIL — ' + label + '  =>  ' + e.message);
    failed++;
  }
}

async function main() {
  await financialReports.ensureExpensesRepositoryReady();

  const feesFakeIndexedDB = new FakeIndexedDB();
  const feesAdapter = createFeesLocalStorageAdapter(feesFakeIndexedDB);
  const feesRepository = new FeesRepository({ storageAdapter: feesAdapter });
  await feesRepository.open();

  const caseClientsFakeIndexedDB = new FakeIndexedDB();
  const caseClientsAdapter = createCaseClientsLocalStorageAdapter(caseClientsFakeIndexedDB);
  const caseClientsRepository = new CaseClientsRepository({ storageAdapter: caseClientsAdapter });
  await caseClientsRepository.open();

  global.data.clients = [
    { 'رقم_الموكل': 'CL1', 'الاسم': 'أحمد محمود' },
    { 'رقم_الموكل': 'CL2', 'الاسم': 'سارة عبد الله' }
  ];
  global.data.cases = [{ 'رقم_القضية': '2026/123' }, { 'رقم_القضية': '2026/456' }];

  const relResult = await caseClientsRepository.create({
    'رقم_القضية': '2026/123', 'رقم_الموكل': 'CL1', 'الصفة': 'مدّعي', 'أتعاب_العلاقة': '20000'
  });
  const relId = relResult.record.id;

  const otherRelResult = await caseClientsRepository.create({
    'رقم_القضية': '2026/456', 'رقم_الموكل': 'CL2', 'الصفة': 'مدّعي', 'أتعاب_العلاقة': '5000'
  });
  const otherRelId = otherRelResult.record.id;

  global.data.caseClients = caseClientsRepository.getAll();

  const fees = require(path.join(__dirname, '..', 'modules', 'fees.js'));

  // ---- (1) referential integrity: relationship must exist ----
  await check('createFeePayment(): REJECTS a رقم_علاقة that does not exist in CaseClientsRepository', async () => {
    const result = await fees.createFeePayment({
      'رقم_القضية': '2026/123', 'رقم_الموكل': 'CL1', 'المبلغ': '5000', 'رقم_علاقة': 'no-such-relationship-id'
    }, feesRepository);
    assert.strictEqual(result.success, false);
    assert.strictEqual(feesRepository.getAll().length, 0, 'no Fees record should have been created');
  });

  // ---- (2) case/client must match the relationship's own case/client ----
  await check('createFeePayment(): REJECTS when رقم_القضية does not match the relationship\'s own case', async () => {
    const result = await fees.createFeePayment({
      'رقم_القضية': '2026/456', 'رقم_الموكل': 'CL1', 'المبلغ': '5000', 'رقم_علاقة': relId // relId belongs to case 2026/123, not 2026/456
    }, feesRepository);
    assert.strictEqual(result.success, false);
    assert.strictEqual(feesRepository.getAll().length, 0);
  });

  await check('createFeePayment(): REJECTS when رقم_الموكل does not match the relationship\'s own client', async () => {
    const result = await fees.createFeePayment({
      'رقم_القضية': '2026/123', 'رقم_الموكل': 'CL2', 'المبلغ': '5000', 'رقم_علاقة': relId // relId belongs to CL1, not CL2
    }, feesRepository);
    assert.strictEqual(result.success, false);
    assert.strictEqual(feesRepository.getAll().length, 0);
  });

  await check('createFeePayment(): REJECTS a رقم_علاقة pointing to a SOFT-DELETED relationship', async () => {
    await caseClientsRepository.delete(otherRelId);
    global.data.caseClients = caseClientsRepository.getAll();
    const result = await fees.createFeePayment({
      'رقم_القضية': '2026/456', 'رقم_الموكل': 'CL2', 'المبلغ': '1000', 'رقم_علاقة': otherRelId
    }, feesRepository);
    assert.strictEqual(result.success, false);
    // restore for the rest of the suite
    await caseClientsRepository.restore(otherRelId);
    global.data.caseClients = caseClientsRepository.getAll();
  });

  await check('createFeePayment(): ACCEPTS a valid, matching رقم_علاقة (control — the fix does not over-block)', async () => {
    const result = await fees.createFeePayment({
      'رقم_القضية': '2026/123', 'رقم_الموكل': 'CL1', 'اسم_الموكل': 'أحمد محمود', 'المبلغ': '5000', 'رقم_علاقة': relId
    }, feesRepository);
    assert.strictEqual(result.success, true, result.error && result.error.message);
  });

  global.data.fees = feesRepository.getAll();

  // ---- (4) getRelationshipRemaining ----
  await check('getRelationshipRemaining(): agreedTotal=20000, collected=5000, remaining=15000 after the one accepted payment above', () => {
    const r = financialReports.getRelationshipRemaining(relId);
    assert.strictEqual(r.agreedTotal, 20000);
    assert.strictEqual(r.collected, 5000);
    assert.strictEqual(r.remaining, 15000);
  });

  await check('getRelationshipRemaining(): a non-existent relationship id returns all-zero, not an error', () => {
    const r = financialReports.getRelationshipRemaining('does-not-exist');
    assert.deepStrictEqual(r, { agreedTotal: 0, collected: 0, remaining: 0 });
  });

  // ---- (3) over-limit guard ----
  await check('createFeePayment(): REJECTS a payment that would exceed the relationship\'s remaining balance (15000 remaining, attempting 20000)', async () => {
    const result = await fees.createFeePayment({
      'رقم_القضية': '2026/123', 'رقم_الموكل': 'CL1', 'اسم_الموكل': 'أحمد محمود', 'المبلغ': '20000', 'رقم_علاقة': relId
    }, feesRepository);
    assert.strictEqual(result.success, false);
    assert.strictEqual(result.error && result.error.code, 'EXCEEDS_REMAINING');
    assert.strictEqual(result.error.remaining, 15000);
    assert.strictEqual(feesRepository.getAll().length, 1, 'still only the one earlier accepted payment — the rejected one must not be created');
  });

  await check('createFeePayment(): a payment EXACTLY equal to the remaining balance is ACCEPTED (boundary — not treated as "exceeding")', async () => {
    const result = await fees.createFeePayment({
      'رقم_القضية': '2026/123', 'رقم_الموكل': 'CL1', 'اسم_الموكل': 'أحمد محمود', 'المبلغ': '15000', 'رقم_علاقة': relId
    }, feesRepository);
    assert.strictEqual(result.success, true, result.error && result.error.message);
  });

  global.data.fees = feesRepository.getAll();

  await check('getRelationshipRemaining(): remaining is now exactly 0 after the boundary payment (fully paid)', () => {
    const r = financialReports.getRelationshipRemaining(relId);
    assert.strictEqual(r.remaining, 0);
  });

  await check('createFeePayment(): a payment WITHOUT رقم_علاقة (legacy path, general Fees entry) is completely unaffected by the new guard', async () => {
    const result = await fees.createFeePayment({
      'رقم_القضية': '2099/999', 'اسم_الموكل': 'شخص غير مرتبط بعلاقة', 'المبلغ': '999'
    }, feesRepository);
    assert.strictEqual(result.success, true, result.error && result.error.message);
  });

  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  if (failed > 0) process.exitCode = 1;
}

main().catch(function (e) {
  console.error('FATAL:', e);
  process.exitCode = 1;
});
