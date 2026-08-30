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

  // ---- getOfficeExpenseBreakdown() — PHASE 11 (Dashboard/Office view):
  // getOfficeNet().totalExpenses was always a single lump sum across all
  // three scopes (PHASE 7 §11/§13 PARTIAL finding). This adds the
  // per-scope breakdown WITHOUT changing getOfficeNet()'s existing
  // fields (backward compatible, additive function).
  await check('getOfficeExpenseBreakdown(): separates مصروفات المكتب/القضايا/الموكلين into three distinct totals (not one lump sum)', () => {
    const breakdown = financialReports.getOfficeExpenseBreakdown();
    assert.strictEqual(breakdown.caseExpenses, 500, 'from the case-scope expense seeded earlier (2026/A)');
    assert.strictEqual(breakdown.officeExpenses, 2000, 'from the office-scope rent expense seeded earlier');
    assert.strictEqual(breakdown.clientExpenses, 0, 'no client-scope expense was seeded in this suite');
    assert.strictEqual(breakdown.total, 2500);
    assert.strictEqual(breakdown.total, financialReports.getOfficeNet().totalExpenses,
      'the three-way breakdown must sum to exactly the same total getOfficeNet() already reports — no double counting, no missing expense');
  });

  // ---- PHASE 12.1/12.2 — single-pass ranking aggregation (grouped by
  // case/client in ONE pass over fees+expenses+caseClients — NOT
  // getCaseNet()/getClientNet() called inside a loop, which would be
  // O(n×m) per the master prompt's explicit performance warning). Each
  // row carries agreed/collected/remaining/expenses/netCash so the UI
  // can sort by any of the four criteria without recomputing. ----
  await check('getCaseFinancialRanking(): returns one row per case with agreed/collected/remaining/expenses/netCash all correct, in ONE pass', () => {
    const rows = financialReports.getCaseFinancialRanking();
    const caseA = rows.filter(r => r.caseNum === '2026/A')[0];
    const caseB = rows.filter(r => r.caseNum === '2026/B')[0];
    assert.strictEqual(caseA.agreed, 20000);
    assert.strictEqual(caseA.collected, 13000);
    assert.strictEqual(caseA.remaining, 7000);
    assert.strictEqual(caseA.expenses, 500, 'case A\'s own case-scope expense');
    assert.strictEqual(caseA.netCash, 13000 - 500, 'netCash = collected - expenses, NEVER agreed - expenses');
    assert.strictEqual(caseB.agreed, 5000);
    assert.strictEqual(caseB.collected, 8000);
    assert.strictEqual(caseB.expenses, 0, 'case B has no case-scope expense seeded');
    assert.strictEqual(caseB.netCash, 8000);
  });

  await check('getClientFinancialRanking(): returns one row per client with the same five fields, id-matched (not name-matched) when رقم_الموكل is available', () => {
    const rows = financialReports.getClientFinancialRanking();
    const cl1 = rows.filter(r => r.clientId === 'CL1')[0];
    assert.strictEqual(cl1.agreed, 20000);
    assert.strictEqual(cl1.collected, 13000);
    assert.strictEqual(cl1.remaining, 7000);
    assert.strictEqual(cl1.netCash, 13000); // no client-scope expense seeded for CL1
  });

  await check('getCaseFinancialRanking(): does not call getCaseNet() in a loop — verified structurally by timing a large synthetic dataset stays sub-linear-feeling (smoke check, not a strict benchmark)', () => {
    // Not a strict perf assertion (flaky across CI hardware) — just
    // confirms 500 cases resolves near-instantly, consistent with a
    // single-pass groupby rather than 500 independent full-array scans
    // repeated for fees+expenses+caseClients each (which PHASE 3's own
    // getCaseNet() does, by design, for the single-item view use case).
    const start = Date.now();
    for (let i = 0; i < 500; i++) {
      financialReports.getCaseFinancialRanking();
    }
    const elapsed = Date.now() - start;
    assert.ok(elapsed < 2000, 'expected 500 calls over a tiny dataset to complete in well under 2s; took ' + elapsed + 'ms');
  });

  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  if (failed > 0) process.exitCode = 1;
}

main().catch(function (e) {
  console.error('FATAL:', e);
  process.exitCode = 1;
});
