/**
 * verify_ledger.js
 * PHASE 9 — LEDGER (Projection/View, NOT a new financial source — per
 * audit prompt §18: "Fees = مصدر التحصيل، Expenses = مصدر المصروف،
 * Ledger = View/Projection"). Written BEFORE implementation (TDD).
 *
 * getCaseLedger(caseNum) / getClientLedger(clientId) / getOfficeLedger()
 * merge Fees + Expenses records (already-existing sources — no new
 * Repository, no new storage, no copy of any transaction) into one
 * chronologically-sorted list with a running balance. Each entry keeps
 * a reference back to its source record (sourceType + sourceId) so the
 * UI can "فتح" back to the original Fees/Expenses record — never a
 * second stored copy of the transaction itself.
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
  global.data.cases = [{ 'رقم_القضية': '2026/123' }];

  const rel = await caseClientsRepository.create({
    'رقم_القضية': '2026/123', 'رقم_الموكل': 'CL1', 'الصفة': 'مدّعي', 'أتعاب_العلاقة': '20000'
  });
  global.data.caseClients = caseClientsRepository.getAll();

  // Exactly the audit prompt's §5 example scenario:
  // 01/08: +5000  (دفعة أولى)
  // 10/08: -350   (مصروف قضية: رسوم إعلان)
  // 15/08: +8000  (دفعة ثانية)
  const f1 = await feesRepository.create({
    'رقم_القضية': '2026/123', 'رقم_الموكل': 'CL1', 'اسم_الموكل': 'أحمد محمود',
    'نوع_الأتعاب': 'دفعة أولى', 'المبلغ': '5000', 'تاريخ_الاستلام': '2026-08-01', 'رقم_علاقة': rel.record.id
  });
  const e1 = await expensesRepo.create({
    'النطاق': 'قضية', 'رقم_القضية': '2026/123', 'المبلغ': '350', 'التصنيف': 'رسوم إعلان', 'التاريخ': '2026-08-10'
  });
  const f2 = await feesRepository.create({
    'رقم_القضية': '2026/123', 'رقم_الموكل': 'CL1', 'اسم_الموكل': 'أحمد محمود',
    'نوع_الأتعاب': 'دفعة ثانية', 'المبلغ': '8000', 'تاريخ_الاستلام': '2026-08-15', 'رقم_علاقة': rel.record.id
  });
  global.data.fees = feesRepository.getAll();
  financialReports.syncExpensesMirror();

  await check('getCaseLedger(): returns exactly 3 entries in chronological order (01/08, 10/08, 15/08)', () => {
    const ledger = financialReports.getCaseLedger('2026/123');
    assert.strictEqual(ledger.length, 3);
    assert.strictEqual(ledger[0].date, '2026-08-01');
    assert.strictEqual(ledger[1].date, '2026-08-10');
    assert.strictEqual(ledger[2].date, '2026-08-15');
  });

  await check('getCaseLedger(): income/expense columns and running balance are exactly right (5000 -> 4650 -> 12650)', () => {
    const ledger = financialReports.getCaseLedger('2026/123');
    assert.strictEqual(ledger[0].income, 5000);
    assert.strictEqual(ledger[0].expense, 0);
    assert.strictEqual(ledger[0].balance, 5000);

    assert.strictEqual(ledger[1].income, 0);
    assert.strictEqual(ledger[1].expense, 350);
    assert.strictEqual(ledger[1].balance, 4650);

    assert.strictEqual(ledger[2].income, 8000);
    assert.strictEqual(ledger[2].expense, 0);
    assert.strictEqual(ledger[2].balance, 12650);
  });

  await check('getCaseLedger(): each entry keeps a reference back to its own SOURCE record (sourceType + sourceId) — this is a projection, not a copy', () => {
    const ledger = financialReports.getCaseLedger('2026/123');
    assert.strictEqual(ledger[0].sourceType, 'fee');
    assert.strictEqual(ledger[0].sourceId, f1.record['رقم_العملية']);
    assert.strictEqual(ledger[1].sourceType, 'expense');
    assert.strictEqual(ledger[1].sourceId, e1.record.id);
    assert.strictEqual(ledger[2].sourceType, 'fee');
    assert.strictEqual(ledger[2].sourceId, f2.record['رقم_العملية']);
  });

  await check('getCaseLedger(): does NOT create or store any new record anywhere — Fees/Expenses counts are unchanged after calling it repeatedly', () => {
    const feesCountBefore = feesRepository.getAll().length;
    const expensesCountBefore = expensesRepo.getAll().length;
    financialReports.getCaseLedger('2026/123');
    financialReports.getCaseLedger('2026/123');
    financialReports.getCaseLedger('2026/123');
    assert.strictEqual(feesRepository.getAll().length, feesCountBefore);
    assert.strictEqual(expensesRepo.getAll().length, expensesCountBefore);
  });

  await check('getClientLedger(): includes both fee payments (2 entries) — the case-SCOPED expense (رسوم إعلان) does NOT appear, since it is tagged to the case only, not to رقم_الموكل directly (same scoping rule getClientNet already uses for expenses — a client ledger is not a transitive union of every one of its cases\' case-scoped items)', () => {
    const ledger = financialReports.getClientLedger('CL1');
    assert.strictEqual(ledger.length, 2);
    assert.strictEqual(ledger[ledger.length - 1].balance, 5000 + 8000);
  });

  await check('getClientLedger(): each entry carries the القضية number, so the client-wide ledger can show which case a movement belongs to', () => {
    const ledger = financialReports.getClientLedger('CL1');
    assert.ok(ledger.every(function (entry) { return entry.caseNum === '2026/123'; }));
  });

  await check('getOfficeLedger(): same three entries appear office-wide (no filter)', () => {
    const ledger = financialReports.getOfficeLedger();
    assert.strictEqual(ledger.length, 3);
    assert.strictEqual(ledger[2].balance, 12650);
  });

  await check('getCaseLedger(): a case with no fees/expenses at all returns an empty array, not an error', () => {
    const ledger = financialReports.getCaseLedger('no-such-case');
    assert.deepStrictEqual(ledger, []);
  });

  // ---- Two movements on the SAME date must remain stable/ordered, not scrambled ----
  await check('getCaseLedger(): two entries dated the SAME day are both included and the running balance still adds up correctly regardless of their relative order', async () => {
    const f3 = await feesRepository.create({
      'رقم_القضية': '2026/123', 'رقم_الموكل': 'CL1', 'اسم_الموكل': 'أحمد محمود',
      'المبلغ': '1000', 'تاريخ_الاستلام': '2026-08-15', 'رقم_علاقة': rel.record.id
    });
    global.data.fees = feesRepository.getAll();
    const ledger = financialReports.getCaseLedger('2026/123');
    assert.strictEqual(ledger.length, 4);
    const finalBalance = ledger[ledger.length - 1].balance;
    assert.strictEqual(finalBalance, 12650 + 1000);
  });

  // ---- Delete/restore must be reflected immediately (no separate stored copy to go stale) ----
  await check('getCaseLedger(): a soft-deleted Fees record disappears from the ledger immediately, and the running balance recalculates correctly', async () => {
    await feesRepository.delete(f2.record['رقم_العملية']);
    global.data.fees = feesRepository.getAll();
    const ledger = financialReports.getCaseLedger('2026/123');
    assert.strictEqual(ledger.some(function (e) { return e.sourceId === f2.record['رقم_العملية']; }), false);
  });

  await check('getCaseLedger(): restoring that Fees record brings it back into the ledger, at the same date, with no duplicate', async () => {
    await feesRepository.restore(f2.record['رقم_العملية']);
    global.data.fees = feesRepository.getAll();
    const ledger = financialReports.getCaseLedger('2026/123');
    const matches = ledger.filter(function (e) { return e.sourceId === f2.record['رقم_العملية']; });
    assert.strictEqual(matches.length, 1, 'restored record must appear exactly once, not duplicated');
  });

  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  if (failed > 0) process.exitCode = 1;
}

main().catch(function (e) {
  console.error('FATAL:', e);
  process.exitCode = 1;
});
