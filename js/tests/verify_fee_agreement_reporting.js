/**
 * verify_fee_agreement_reporting.js
 * FINANCIAL_SYSTEM_AUDIT — PHASE 4 (Implementation) — written BEFORE the
 * implementing code change, per audit rule §19/§20 ("أنشئ اختبارات تكشف
 * المشكلات... قبل الإصلاح", "لا تصلح بناء على التخمين").
 *
 * Proves OPTION D (approved PHASE 3 architecture decision):
 *   - CaseClientsRepository.أتعاب_العلاقة == "الأتعاب المتفق عليها"
 *     (agreed total) for one Client<->Case relationship.
 *   - FeesRepository records == actual collected payments, optionally
 *     tagged with رقم_علاقة (the CaseClients row id — already declared
 *     in Config/00_Config.gs SHEET_DEFS['الأتعاب'] and in
 *     FeesRepository's own FEES_LEGACY_FIELDS, unused until now).
 *   - getCaseNet()/getClientNet()/getOfficeNet() gain ADDITIVE fields
 *     (agreedTotal, collected, remaining) alongside their existing
 *     totalFees/totalExpenses/net (untouched, for backward
 *     compatibility with verify_financial_reports.js and every other
 *     existing caller).
 *   - fees.js gains an additive, DOM-free createFeePayment(data) helper
 *     that create()s a Fees record carrying رقم_علاقة, without touching
 *     saveFee()/the modal form in any way.
 *
 * NOTHING in this file replaces or weakens verify_financial_reports.js
 * or verify_case_registration_fee_gap.js — both must keep passing
 * unmodified (regression baseline).
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

  global.data.clients = [{ 'رقم_الموكل': 'CL1', 'الاسم': 'أحمد محمود' }];
  global.data.cases = [{ 'رقم_القضية': '2026/123' }];

  // ---- Scenario exactly as specified by the user ----
  // Case 2026/123, client Ahmed, agreed fee = 20,000, three payments
  // (5000 + 5000 + 3000 = 13000), remaining should be 7000.
  const relResult = await caseClientsRepository.create({
    'رقم_القضية': '2026/123',
    'رقم_الموكل': 'CL1',
    'الصفة': 'مدّعي',
    'أتعاب_العلاقة': '20000'
  });
  assert.ok(relResult.success, relResult.error && relResult.error.message);
  const relationshipId = relResult.record.id;

  global.data.caseClients = caseClientsRepository.getAll();

  const fees = require(path.join(__dirname, '..', 'modules', 'fees.js'));

  await check('SETUP: fees.js exposes an additive, DOM-free createFeePayment() helper', () => {
    assert.strictEqual(typeof fees.createFeePayment, 'function');
  });

  // Wire fees.js's module-internal feesRepository to our test instance
  // via the same override pattern verify_fees_repository_integration.js
  // already uses (feesRepository is exported for tests).
  const paymentA = await fees.createFeePayment({
    'رقم_القضية': '2026/123',
    'رقم_الموكل': 'CL1',
    'اسم_الموكل': 'أحمد محمود',
    'المبلغ': '5000',
    'رقم_علاقة': relationshipId
  }, feesRepository);
  const paymentB = await fees.createFeePayment({
    'رقم_القضية': '2026/123',
    'رقم_الموكل': 'CL1',
    'اسم_الموكل': 'أحمد محمود',
    'المبلغ': '5000',
    'رقم_علاقة': relationshipId
  }, feesRepository);
  const paymentC = await fees.createFeePayment({
    'رقم_القضية': '2026/123',
    'رقم_الموكل': 'CL1',
    'اسم_الموكل': 'أحمد محمود',
    'المبلغ': '3000',
    'رقم_علاقة': relationshipId
  }, feesRepository);

  await check('createFeePayment(): all three payments saved successfully, tagged with رقم_علاقة', () => {
    assert.ok(paymentA.success && paymentB.success && paymentC.success);
    assert.strictEqual(paymentA.record['رقم_علاقة'], relationshipId);
  });

  global.data.fees = feesRepository.getAll();

  await check('getCaseNet(): agreedTotal reads 20000 from CaseClients.أتعاب_العلاقة (new field, additive)', () => {
    const net = financialReports.getCaseNet('2026/123');
    assert.strictEqual(net.agreedTotal, 20000);
  });

  await check('getCaseNet(): collected reads 13000 (sum of the three payments — new field, additive)', () => {
    const net = financialReports.getCaseNet('2026/123');
    assert.strictEqual(net.collected, 13000);
  });

  await check('getCaseNet(): remaining computes to 7000 (agreedTotal - collected — never stored, always derived)', () => {
    const net = financialReports.getCaseNet('2026/123');
    assert.strictEqual(net.remaining, 7000);
  });

  await check('getCaseNet(): totalFees (EXISTING field) is untouched and still equals the raw fees sum (13000) — backward compatible', () => {
    const net = financialReports.getCaseNet('2026/123');
    assert.strictEqual(net.totalFees, 13000);
  });

  await check('getClientNet(): agreedTotal/collected/remaining mirror the case-level numbers for this single-case client', () => {
    const net = financialReports.getClientNet('CL1');
    assert.strictEqual(net.agreedTotal, 20000);
    assert.strictEqual(net.collected, 13000);
    assert.strictEqual(net.remaining, 7000);
  });

  await check('getOfficeNet(): agreedTotal/collected/remaining aggregate office-wide (additive fields)', () => {
    const net = financialReports.getOfficeNet();
    assert.strictEqual(net.agreedTotal, 20000);
    assert.strictEqual(net.collected, 13000);
    assert.strictEqual(net.remaining, 7000);
  });

  // ---- No double counting when a payment is رقم_علاقة-tagged AND
  //      would also match the legacy اسم_الموكل fallback ----
  await check('getClientNet(): a رقم_علاقة-tagged payment is counted exactly ONCE, not twice (id-match and legacy name-match do not both fire)', () => {
    const net = financialReports.getClientNet('CL1');
    assert.strictEqual(net.collected, 13000, 'if this were 26000, the payment was double-counted');
  });

  // ---- Legacy relationship with no أتعاب_العلاقة set at all ----
  await check('getCaseNet(): a case with NO CaseClients agreed-fee data reports agreedTotal=0, remaining=0-collected (no crash, no NaN)', () => {
    const net = financialReports.getCaseNet('2099/999');
    assert.strictEqual(net.agreedTotal, 0);
    assert.strictEqual(net.remaining, 0);
    assert.ok(!isNaN(net.remaining));
  });

  // ---- Soft-deleted relationship must not count toward agreedTotal ----
  await check('getCaseNet(): a soft-deleted CaseClients relationship no longer contributes to agreedTotal', async () => {
    const rel2 = await caseClientsRepository.create({
      'رقم_القضية': '2026/999', 'رقم_الموكل': 'CL1', 'الصفة': 'مدّعي', 'أتعاب_العلاقة': '9999'
    });
    global.data.caseClients = caseClientsRepository.getAll();
    let net = financialReports.getCaseNet('2026/999');
    assert.strictEqual(net.agreedTotal, 9999);

    await caseClientsRepository.delete(rel2.record.id);
    global.data.caseClients = caseClientsRepository.getAll();
    net = financialReports.getCaseNet('2026/999');
    assert.strictEqual(net.agreedTotal, 0, 'soft-deleted relationship must not count');
  });

  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  if (failed > 0) process.exitCode = 1;
}

main().catch(function (e) {
  console.error('FATAL:', e);
  process.exitCode = 1;
});
