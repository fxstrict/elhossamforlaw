/**
 * verify_delete_restore_matrix.js
 * PHASE 16 — DELETE / RESTORE. Explicit test matrix for Fee, Expense,
 * and CaseClients soft-delete/restore, proving the reports/ledger
 * recompute correctly with no duplication on restore.
 *
 * Why this proves Case view / Client view / Dashboard / Reports all
 * update too, without a separate DOM test for each: every one of those
 * surfaces calls getCaseNet()/getClientNet()/getOfficeNet()/
 * getCaseLedger()/getRelationshipRemaining() FRESH on each render —
 * confirmed in PHASE 7's own Performance Audit (no caching/memoization
 * anywhere in financial-reports.js) and structurally true here since
 * every one of those functions reads straight from data.fees/
 * data.expenses/data.caseClients with no intermediate stored value.
 * Proving the data-layer functions recompute correctly after delete/
 * restore is therefore sufficient — there is no separate "view cache"
 * that could go stale.
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

  global.data.clients = [{ 'رقم_الموكل': 'CL1', 'الاسم': 'أحمد محمود' }];
  global.data.cases = [{ 'رقم_القضية': '2026/D' }];

  const rel = await caseClientsRepository.create({
    'رقم_القضية': '2026/D', 'رقم_الموكل': 'CL1', 'الصفة': 'مدّعي', 'أتعاب_العلاقة': '20000'
  });
  global.data.caseClients = caseClientsRepository.getAll();

  // ================================================================
  // MATRIX 1 — Fee delete/restore (exactly the master prompt's own
  // numeric scenario: agreed=20000, two payments of 5000, delete one,
  // restore it)
  // ================================================================
  const p1 = await feesRepository.create({
    'رقم_القضية': '2026/D', 'رقم_الموكل': 'CL1', 'اسم_الموكل': 'أحمد محمود',
    'المبلغ': '5000', 'تاريخ_الاستلام': '2026-08-01', 'رقم_علاقة': rel.record.id
  });
  const p2 = await feesRepository.create({
    'رقم_القضية': '2026/D', 'رقم_الموكل': 'CL1', 'اسم_الموكل': 'أحمد محمود',
    'المبلغ': '5000', 'تاريخ_الاستلام': '2026-08-05', 'رقم_علاقة': rel.record.id
  });
  global.data.fees = feesRepository.getAll();

  await check('BEFORE: getCaseNet remaining = 10000 (20000 agreed - 10000 collected across two 5000 payments)', () => {
    assert.strictEqual(financialReports.getCaseNet('2026/D').remaining, 10000);
  });

  await feesRepository.delete(p1.record['رقم_العملية']);
  global.data.fees = feesRepository.getAll();

  await check('Fee DELETE (payment1): getCaseNet collected drops to 5000, remaining rises to 15000', () => {
    const net = financialReports.getCaseNet('2026/D');
    assert.strictEqual(net.collected, 5000);
    assert.strictEqual(net.remaining, 15000);
  });

  await check('Fee DELETE (payment1): getRelationshipRemaining and getCaseLedger agree with getCaseNet (same single source, no separate stale copy)', () => {
    const relInfo = financialReports.getRelationshipRemaining(rel.record.id);
    assert.strictEqual(relInfo.collected, 5000);
    const ledger = financialReports.getCaseLedger('2026/D');
    assert.strictEqual(ledger.length, 1, 'the deleted payment must not appear in the ledger at all');
    assert.strictEqual(ledger[0].balance, 5000);
  });

  await feesRepository.restore(p1.record['رقم_العملية']);
  global.data.fees = feesRepository.getAll();

  await check('Fee RESTORE (payment1): getCaseNet collected returns to exactly 10000, remaining back to exactly 10000 — no duplication', () => {
    const net = financialReports.getCaseNet('2026/D');
    assert.strictEqual(net.collected, 10000);
    assert.strictEqual(net.remaining, 10000);
  });

  await check('Fee RESTORE (payment1): getCaseLedger shows exactly 2 entries again (not 3 — restore must not create a duplicate row)', () => {
    const ledger = financialReports.getCaseLedger('2026/D');
    assert.strictEqual(ledger.length, 2);
    assert.strictEqual(ledger[ledger.length - 1].balance, 10000);
  });

  // ================================================================
  // MATRIX 2 — Expense delete/restore
  // ================================================================
  const exp1 = await expensesRepo.create({
    'النطاق': 'قضية', 'رقم_القضية': '2026/D', 'المبلغ': '2000', 'التصنيف': 'رسوم', 'التاريخ': '2026-08-10'
  });
  financialReports.syncExpensesMirror();

  await check('BEFORE: getCaseNet totalExpenses = 2000, net = 10000 - 2000 = 8000', () => {
    const net = financialReports.getCaseNet('2026/D');
    assert.strictEqual(net.totalExpenses, 2000);
    assert.strictEqual(net.net, 8000);
  });

  await expensesRepo.delete(exp1.record.id);
  financialReports.syncExpensesMirror();

  await check('Expense DELETE: getCaseNet totalExpenses drops to 0, net returns to 10000', () => {
    const net = financialReports.getCaseNet('2026/D');
    assert.strictEqual(net.totalExpenses, 0);
    assert.strictEqual(net.net, 10000);
  });

  await expensesRepo.restore(exp1.record.id);
  financialReports.syncExpensesMirror();

  await check('Expense RESTORE: getCaseNet totalExpenses returns to exactly 2000 — no duplication (not 4000)', () => {
    const net = financialReports.getCaseNet('2026/D');
    assert.strictEqual(net.totalExpenses, 2000);
    assert.strictEqual(net.net, 8000);
  });

  // ================================================================
  // MATRIX 3 — CaseClients relationship delete/restore
  // ================================================================
  await check('BEFORE: getCaseNet agreedTotal = 20000 (from the one active relationship)', () => {
    assert.strictEqual(financialReports.getCaseNet('2026/D').agreedTotal, 20000);
  });

  await caseClientsRepository.delete(rel.record.id);
  global.data.caseClients = caseClientsRepository.getAll();

  await check('CaseClient DELETE: getCaseNet agreedTotal drops to 0 (soft-deleted relationship excluded)', () => {
    assert.strictEqual(financialReports.getCaseNet('2026/D').agreedTotal, 0);
  });

  await caseClientsRepository.restore(rel.record.id);
  global.data.caseClients = caseClientsRepository.getAll();

  await check('CaseClient RESTORE: getCaseNet agreedTotal returns to exactly 20000 — no duplicate relationship created', () => {
    const net = financialReports.getCaseNet('2026/D');
    assert.strictEqual(net.agreedTotal, 20000);
    assert.strictEqual(global.data.caseClients.filter(r => r['رقم_القضية'] === '2026/D').length, 1, 'exactly one relationship row, not two');
  });

  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  if (failed > 0) process.exitCode = 1;
}

main().catch(function (e) {
  console.error('FATAL:', e);
  process.exitCode = 1;
});
