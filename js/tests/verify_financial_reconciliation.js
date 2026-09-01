/**
 * verify_financial_reconciliation.js
 * PHASE 17 — FINANCIAL RECONCILIATION.
 *
 * One known dataset (exactly the master prompt's own numbers), checked
 * against EVERY financial surface: Case view (getCaseNet), Client view
 * (getClientNet), Case Ledger, Client Ledger, Office Ledger, Dashboard
 * figures (getTodayCollections/getMonthCollections/getOfficeNet),
 * Daily/Monthly/Yearly reports (getCollectionsInRange), Cases Ranking
 * (getCaseFinancialRanking), Clients Ranking (getClientFinancialRanking).
 * All of them read the exact same data.fees/data.expenses/
 * data.caseClients and share the exact same arithmetic — this test is
 * the proof that no surface has quietly diverged with its own copy of
 * the calculation logic.
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

  // ---- Exactly the master prompt's PHASE 17 dataset ----
  // Case A / Client A: agreed 20,000; payments 5,000 + 3,000 + 2,000 = 10,000 collected; remaining 10,000
  // Case expenses = 2,000 -> Net Case = 8,000 (collected - case expenses)
  // Office expenses = 1,000; Client expenses = 500 (both separate from the case's own net)
  const today = new Date().toISOString().slice(0, 10);

  global.data.clients = [{ 'رقم_الموكل': 'CLA', 'الاسم': 'موكل أ' }];
  global.data.cases = [{ 'رقم_القضية': 'CASE-A' }];

  const rel = await caseClientsRepository.create({
    'رقم_القضية': 'CASE-A', 'رقم_الموكل': 'CLA', 'الصفة': 'مدّعي', 'أتعاب_العلاقة': '20000'
  });
  global.data.caseClients = caseClientsRepository.getAll();

  await feesRepository.create({ 'رقم_القضية': 'CASE-A', 'رقم_الموكل': 'CLA', 'اسم_الموكل': 'موكل أ', 'المبلغ': '5000', 'تاريخ_الاستلام': today, 'رقم_علاقة': rel.record.id });
  await feesRepository.create({ 'رقم_القضية': 'CASE-A', 'رقم_الموكل': 'CLA', 'اسم_الموكل': 'موكل أ', 'المبلغ': '3000', 'تاريخ_الاستلام': today, 'رقم_علاقة': rel.record.id });
  await feesRepository.create({ 'رقم_القضية': 'CASE-A', 'رقم_الموكل': 'CLA', 'اسم_الموكل': 'موكل أ', 'المبلغ': '2000', 'تاريخ_الاستلام': today, 'رقم_علاقة': rel.record.id });
  global.data.fees = feesRepository.getAll();

  await expensesRepo.create({ 'النطاق': 'قضية', 'رقم_القضية': 'CASE-A', 'المبلغ': '2000', 'التصنيف': 'مصروف قضية', 'التاريخ': today });
  await expensesRepo.create({ 'النطاق': 'مكتب', 'المبلغ': '1000', 'التصنيف': 'مصروف مكتب', 'التاريخ': today });
  await expensesRepo.create({ 'النطاق': 'موكل', 'رقم_الموكل': 'CLA', 'المبلغ': '500', 'التصنيف': 'مصروف موكل', 'التاريخ': today });
  financialReports.syncExpensesMirror();

  // ================================================================
  // Reconciliation checks — every surface must agree
  // ================================================================

  await check('Case view (getCaseNet): collected=10000, remaining=10000, case-expenses=2000, net=8000', () => {
    const net = financialReports.getCaseNet('CASE-A');
    assert.strictEqual(net.agreedTotal, 20000);
    assert.strictEqual(net.collected, 10000);
    assert.strictEqual(net.remaining, 10000);
    assert.strictEqual(net.totalExpenses, 2000, 'client-scope and office-scope expenses must NOT leak into the case\'s own expense total');
    assert.strictEqual(net.net, 8000);
  });

  await check('Client view (getClientNet): collected=10000, remaining=10000 (same case, single relationship) — client-scope expense (500) IS this client\'s own, case-scope expense (2000) is not double-subtracted here', () => {
    const net = financialReports.getClientNet('CLA');
    assert.strictEqual(net.collected, 10000);
    assert.strictEqual(net.remaining, 10000);
    assert.strictEqual(net.totalExpenses, 500, 'only the client-scope expense belongs to the client view, per the established scoping rule (see verify_ledger.js\'s own documented rationale)');
  });

  await check('Case Ledger: three income entries sum to the same collected=10000, one expense entry of 2000, final balance = 8000 (matches Case view\'s net exactly)', () => {
    const ledger = financialReports.getCaseLedger('CASE-A');
    const totalIncome = ledger.reduce((a, e) => a + e.income, 0);
    const totalExpense = ledger.reduce((a, e) => a + e.expense, 0);
    assert.strictEqual(totalIncome, 10000);
    assert.strictEqual(totalExpense, 2000);
    assert.strictEqual(ledger[ledger.length - 1].balance, 8000);
    assert.strictEqual(ledger[ledger.length - 1].balance, financialReports.getCaseNet('CASE-A').net, 'Ledger\'s final balance must equal Case view\'s net exactly — same arithmetic, not a parallel copy');
  });

  await check('Client Ledger: reconciles the same way at the client level (client-scope expense only, per the same scoping rule)', () => {
    const ledger = financialReports.getClientLedger('CLA');
    const totalIncome = ledger.reduce((a, e) => a + e.income, 0);
    const totalExpense = ledger.reduce((a, e) => a + e.expense, 0);
    assert.strictEqual(totalIncome, 10000);
    assert.strictEqual(totalExpense, 500);
    assert.strictEqual(ledger[ledger.length - 1].balance, financialReports.getClientNet('CLA').net);
  });

  await check('Office Ledger: ALL three expenses appear together (case + office + client scopes), income = 10000, final balance = 10000 - 3500 = 6500', () => {
    const ledger = financialReports.getOfficeLedger();
    const totalIncome = ledger.reduce((a, e) => a + e.income, 0);
    const totalExpense = ledger.reduce((a, e) => a + e.expense, 0);
    assert.strictEqual(totalIncome, 10000);
    assert.strictEqual(totalExpense, 3500);
    assert.strictEqual(ledger[ledger.length - 1].balance, 6500);
  });

  await check('Dashboard figures (getTodayCollections/getOfficeNet): today\'s collections=10000 (all three payments dated today), office net matches getOfficeLedger\'s final balance exactly', () => {
    assert.strictEqual(financialReports.getTodayCollections(), 10000);
    const officeNet = financialReports.getOfficeNet();
    assert.strictEqual(officeNet.collected, 10000);
    assert.strictEqual(officeNet.totalExpenses, 3500);
    assert.strictEqual(officeNet.net, 6500);
    assert.strictEqual(officeNet.net, financialReports.getOfficeLedger()[financialReports.getOfficeLedger().length - 1].balance);
  });

  await check('Daily/Monthly/Yearly reports (getCollectionsInRange over today/this-month/this-year): all agree on 10000 — same underlying getCollectionsInRange(), just different date ranges', () => {
    assert.strictEqual(financialReports.getTodayCollections(), 10000);
    assert.strictEqual(financialReports.getMonthCollections(), 10000);
    assert.strictEqual(financialReports.getYearCollections(), 10000);
  });

  await check('Cases Ranking (getCaseFinancialRanking): CASE-A row matches Case view\'s numbers exactly (single-pass aggregation reconciles with the single-case function)', () => {
    const ranking = financialReports.getCaseFinancialRanking().filter(r => r.caseNum === 'CASE-A')[0];
    const caseNet = financialReports.getCaseNet('CASE-A');
    assert.strictEqual(ranking.agreed, caseNet.agreedTotal);
    assert.strictEqual(ranking.collected, caseNet.collected);
    assert.strictEqual(ranking.remaining, caseNet.remaining);
    assert.strictEqual(ranking.expenses, caseNet.totalExpenses);
    assert.strictEqual(ranking.netCash, caseNet.net);
  });

  await check('Clients Ranking (getClientFinancialRanking): CLA row matches Client view\'s numbers exactly', () => {
    const ranking = financialReports.getClientFinancialRanking().filter(r => r.clientId === 'CLA')[0];
    const clientNet = financialReports.getClientNet('CLA');
    assert.strictEqual(ranking.agreed, clientNet.agreedTotal);
    assert.strictEqual(ranking.collected, clientNet.collected);
    assert.strictEqual(ranking.remaining, clientNet.remaining);
    assert.strictEqual(ranking.expenses, clientNet.totalExpenses);
    assert.strictEqual(ranking.netCash, clientNet.net);
  });

  await check('getOfficeExpenseBreakdown: the three scopes sum to exactly 3500, matching getOfficeNet().totalExpenses and getOfficeLedger\'s total expense column', () => {
    const breakdown = financialReports.getOfficeExpenseBreakdown();
    assert.strictEqual(breakdown.caseExpenses, 2000);
    assert.strictEqual(breakdown.officeExpenses, 1000);
    assert.strictEqual(breakdown.clientExpenses, 500);
    assert.strictEqual(breakdown.total, 3500);
  });

  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  if (failed > 0) process.exitCode = 1;
}

main().catch(function (e) {
  console.error('FATAL:', e);
  process.exitCode = 1;
});
