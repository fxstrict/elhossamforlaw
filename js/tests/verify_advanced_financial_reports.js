/**
 * verify_advanced_financial_reports.js
 * FINANCIAL_SYSTEM_AUDIT — PHASE 4 (continued) — advanced reporting
 * layer over the SAME existing sources (data.fees / data.expenses /
 * data.caseClients) — no new Repository, no new storage, per PHASE 3
 * §17 ("ما البيانات التي يجب أن تأتي من Repositories الحالية؟... حدد
 * أولًا... لا تضف UI الآن"). Written BEFORE the implementing code
 * change (TDD, per audit rule §19/§20).
 *
 * Covers PHASE 3 §17 report items that have no dedicated function yet:
 *   10-15: تحصيلات/مصروفات اليوم/الشهر/السنة  -> getCollectionsInRange / getExpensesInRange
 *   16-17: أكثر القضايا/الموكلين تحقيقًا للإيراد -> getTopRevenueCases / getTopRevenueClients
 *   18:    القضايا التي لها أتعاب متبقية        -> getCasesWithOutstandingBalance
 *   19:    إجمالي المبالغ المستحقة غير المحصلة  -> getTotalOutstanding
 *
 * getTotalOutstanding() DEFINITION (documented here because it is a
 * genuine design decision, not an obvious sum): it is the sum of each
 * CASE's own positive remaining (getCaseNet(caseNum).remaining, floored
 * at 0), summed across every case that has agreed-fee data — NOT
 * getOfficeNet().remaining (agreedTotal - collected office-wide), which
 * would let one case's overpayment silently cancel out another case's
 * unpaid balance. This test proves that distinction explicitly.
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
  const expensesRepo = financialReports.expensesRepository;

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

  // Case A: agreed 20000, collected 13000 -> remaining 7000
  await caseClientsRepository.create({ 'رقم_القضية': '2026/A', 'رقم_الموكل': 'CL1', 'الصفة': 'مدّعي', 'أتعاب_العلاقة': '20000' });
  // Case B: agreed 5000, collected 8000 (overpaid) -> remaining -3000
  await caseClientsRepository.create({ 'رقم_القضية': '2026/B', 'رقم_الموكل': 'CL2', 'الصفة': 'مدّعي', 'أتعاب_العلاقة': '5000' });
  global.data.caseClients = caseClientsRepository.getAll();

  await feesRepository.create({ 'رقم_القضية': '2026/A', 'رقم_الموكل': 'CL1', 'اسم_الموكل': 'أحمد محمود', 'المبلغ': '13000', 'تاريخ_الاستلام': '2026-08-01' });
  await feesRepository.create({ 'رقم_القضية': '2026/B', 'رقم_الموكل': 'CL2', 'اسم_الموكل': 'سارة عبد الله', 'المبلغ': '8000', 'تاريخ_الاستلام': '2026-08-15' });
  global.data.fees = feesRepository.getAll();

  await expensesRepo.create({ 'النطاق': 'قضية', 'رقم_القضية': '2026/A', 'المبلغ': '500', 'التصنيف': 'رسوم', 'التاريخ': '2026-08-05' });
  await expensesRepo.create({ 'النطاق': 'مكتب', 'المبلغ': '2000', 'التصنيف': 'إيجار', 'التاريخ': '2026-07-01' });
  financialReports.syncExpensesMirror();

  // ---- Collections/Expenses in range ----
  await check('getCollectionsInRange(): sums Fees whose تاريخ_الاستلام falls within [from,to]', () => {
    const total = financialReports.getCollectionsInRange('2026-08-01', '2026-08-10');
    assert.strictEqual(total, 13000, 'expected only the 2026-08-01 payment, not the 2026-08-15 one');
  });

  await check('getCollectionsInRange(): a wider range picks up both payments', () => {
    const total = financialReports.getCollectionsInRange('2026-08-01', '2026-08-31');
    assert.strictEqual(total, 21000);
  });

  await check('getExpensesInRange(): sums Expenses whose التاريخ falls within [from,to]', () => {
    const total = financialReports.getExpensesInRange('2026-08-01', '2026-08-31');
    assert.strictEqual(total, 500, 'expected only the case-scope expense, not the July office rent');
  });

  await check('getCollectionsInRange(): an empty/no-match range returns 0, not NaN or an error', () => {
    const total = financialReports.getCollectionsInRange('2099-01-01', '2099-01-31');
    assert.strictEqual(total, 0);
  });

  // ---- Top revenue ----
  await check('getTopRevenueCases(): ranks cases by collected amount, descending', () => {
    const top = financialReports.getTopRevenueCases(5);
    assert.strictEqual(top[0].caseNum, '2026/A');
    assert.strictEqual(top[0].collected, 13000);
    assert.strictEqual(top[1].caseNum, '2026/B');
    assert.strictEqual(top[1].collected, 8000);
  });

  await check('getTopRevenueCases(): respects the limit parameter', () => {
    const top = financialReports.getTopRevenueCases(1);
    assert.strictEqual(top.length, 1);
  });

  await check('getTopRevenueClients(): ranks clients by collected amount, descending, id-matched', () => {
    const top = financialReports.getTopRevenueClients(5);
    assert.strictEqual(top[0].clientId, 'CL1');
    assert.strictEqual(top[0].collected, 13000);
  });

  // ---- Outstanding balance ----
  await check('getCasesWithOutstandingBalance(): includes case A (remaining 7000) and EXCLUDES case B (overpaid, remaining negative)', () => {
    const list = financialReports.getCasesWithOutstandingBalance();
    const nums = list.map(function (r) { return r.caseNum; });
    assert.ok(nums.indexOf('2026/A') !== -1, 'expected case A in the outstanding list');
    assert.ok(nums.indexOf('2026/B') === -1, 'case B is overpaid, must NOT appear as outstanding');
    assert.strictEqual(list.filter(function (r) { return r.caseNum === '2026/A'; })[0].remaining, 7000);
  });

  await check('getTotalOutstanding(): sums only POSITIVE per-case remaining (7000), NOT net office-wide remaining (which would be masked by case B\'s overpayment)', () => {
    const total = financialReports.getTotalOutstanding();
    assert.strictEqual(total, 7000, 'case B\'s -3000 must not offset case A\'s +7000');
    // Contrast with the office-wide net figure, which WOULD net them out:
    const officeNet = financialReports.getOfficeNet();
    assert.strictEqual(officeNet.remaining, 25000 - 21000); // 4000 — proves the two are genuinely different numbers
    assert.notStrictEqual(total, officeNet.remaining);
  });

  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  if (failed > 0) process.exitCode = 1;
}

main().catch(function (e) {
  console.error('FATAL:', e);
  process.exitCode = 1;
});
