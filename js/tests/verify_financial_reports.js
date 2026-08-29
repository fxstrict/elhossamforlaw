/**
 * verify_financial_reports.js
 * CASES_RELATIONSHIP_FINANCIAL — Phase F/G: Client/Case/Office net
 * calculation tests against the real ExpensesRepository engine (via
 * FakeIndexedDB, same harness as every other Repository test this
 * phase) and a plain in-memory data.fees/data.clients mirror (matching
 * how js/modules/fees.js/clients.js already populate those globals).
 */
'use strict';

const assert = require('assert');
const path = require('path');
const { FakeIndexedDB } = require(path.join(__dirname, 'fake_indexeddb.js'));

require(path.join(__dirname, '..', 'core', 'Repository.js'));
require(path.join(__dirname, '..', 'core', 'DatabaseService.js'));
require(path.join(__dirname, '..', 'core', 'IndexedDBAdapter.js'));

global.data = { clients: [], fees: [], expenses: [] };

const { ExpensesRepository, createExpensesLocalStorageAdapter } =
  require(path.join(__dirname, '..', 'repositories', 'ExpensesRepository.js'));

const fakeIndexedDB = new FakeIndexedDB();
global.indexedDB = fakeIndexedDB; // so financial-reports.js's own internal (default-adapter) ExpensesRepository instance opens silently instead of logging a harmless "no indexedDB" error
const adapter = createExpensesLocalStorageAdapter(fakeIndexedDB);
const testExpensesRepo = new ExpensesRepository({ storageAdapter: adapter });

// financial-reports.js creates its OWN internal ExpensesRepository
// instance (own default storageAdapter) when required — for these
// tests we want everything going through ONE shared fake-IndexedDB
// backend, so we require it, then swap data.expenses to be populated
// via testExpensesRepo directly and call syncExpensesMirror() to pull
// it into data.expenses — this exercises the exact same mirror path
// financial-reports.js uses internally, without needing two separate
// repository instances to somehow share storage.
const financialReports = require(path.join(__dirname, '..', 'modules', 'financial-reports.js'));

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
  await testExpensesRepo.open();

  // Seed clients (ID-based)
  global.data.clients = [
    { 'رقم_الموكل': 'CL1', 'الاسم': 'أحمد محمود' },
    { 'رقم_الموكل': 'CL2', 'الاسم': 'سارة عبد الله' }
  ];

  // Seed fees — MIX of new ID-based rows and legacy name-only rows,
  // matching decision §10's "لا تكسر التوافق مع البيانات القديمة".
  global.data.fees = [
    { 'رقم_العملية': 'F1', 'رقم_القضية': '2025/1001', 'رقم_الموكل': 'CL1', 'اسم_الموكل': 'أحمد محمود', 'المبلغ': '5000' },
    { 'رقم_العملية': 'F2', 'رقم_القضية': '2025/1001', 'اسم_الموكل': 'أحمد محمود', 'المبلغ': '2000' }, // legacy: no رقم_الموكل at all
    { 'رقم_العملية': 'F3', 'رقم_القضية': '2025/2002', 'رقم_الموكل': 'CL2', 'اسم_الموكل': 'سارة عبد الله', 'المبلغ': '3000' }
  ];

  // Seed expenses via the real Repository (not a raw array push), then
  // pull them into data.expenses the same way financial-reports.js does
  // internally — proves the actual create()/getAll() round-trip works,
  // not just that the reducer math is correct on a hand-built array.
  await testExpensesRepo.create({ 'النطاق': 'موكل', 'رقم_الموكل': 'CL1', 'المبلغ': '1200', 'التصنيف': 'انتقال', 'التاريخ': '2026-01-01' });
  await testExpensesRepo.create({ 'النطاق': 'قضية', 'رقم_القضية': '2025/1001', 'المبلغ': '800', 'التصنيف': 'رسوم إعلان', 'التاريخ': '2026-01-02' });
  await testExpensesRepo.create({ 'النطاق': 'مكتب', 'المبلغ': '4000', 'التصنيف': 'إيجار', 'التاريخ': '2026-01-03' });
  global.data.expenses = testExpensesRepo.getAll();

  await check('getClientNet(): sums fees matching BOTH رقم_الموكل (new) and legacy اسم_الموكل (old) rows for the same client, minus that client\'s موكل-scope expenses', () => {
    const result = financialReports.getClientNet('CL1');
    // F1 (5000, id-matched) + F2 (2000, legacy name-matched) = 7000 total fees
    assert.strictEqual(result.totalFees, 7000);
    assert.strictEqual(result.totalExpenses, 1200);
    assert.strictEqual(result.net, 5800);
  });

  await check('getClientNet(): a client with no fees/expenses at all returns all-zero, not an error', () => {
    const result = financialReports.getClientNet('CL-does-not-exist');
    // PHASE 4 (OPTION D, approved): additive agreedTotal/collected/remaining fields.
    assert.deepStrictEqual(result, { totalFees: 0, totalExpenses: 0, net: 0, agreedTotal: 0, collected: 0, remaining: 0 });
  });

  await check('getClientNet(): a falsy clientId returns all-zero without throwing', () => {
    // PHASE 4 (OPTION D, approved): agreedTotal/collected/remaining are
    // additive fields alongside the original totalFees/totalExpenses/net
    // — see verify_fee_agreement_reporting.js for their dedicated tests.
    const zero = { totalFees: 0, totalExpenses: 0, net: 0, agreedTotal: 0, collected: 0, remaining: 0 };
    assert.deepStrictEqual(financialReports.getClientNet(''), zero);
    assert.deepStrictEqual(financialReports.getClientNet(null), zero);
  });

  await check('getCaseNet(): sums fees + expenses scoped to رقم_القضية only, independent of client-level totals', () => {
    const result = financialReports.getCaseNet('2025/1001');
    // F1 (5000) + F2 (2000) = 7000 (same two fee rows as CL1's client total, by coincidence — this case has no other client)
    assert.strictEqual(result.totalFees, 7000);
    assert.strictEqual(result.totalExpenses, 800); // only the قضية-scope expense, NOT the موكل-scope or مكتب-scope ones
    assert.strictEqual(result.net, 6200);
  });

  await check('getCaseNet(): does not leak another case\'s fees/expenses into the total', () => {
    const result = financialReports.getCaseNet('2025/2002');
    assert.strictEqual(result.totalFees, 3000);
    assert.strictEqual(result.totalExpenses, 0);
    assert.strictEqual(result.net, 3000);
  });

  await check('getOfficeNet(): totals ALL fees and ALL expenses across every scope (complete P&L, not office-scope-only — see file header rationale)', () => {
    const result = financialReports.getOfficeNet();
    assert.strictEqual(result.totalFees, 5000 + 2000 + 3000); // 10000
    assert.strictEqual(result.totalExpenses, 1200 + 800 + 4000); // 6000 — all three scopes
    assert.strictEqual(result.net, 4000);
  });

  await check('Level isolation: client/case/office nets do not double-count or cross-contaminate each other (§18 "بدون خلط المستويات")', () => {
    const clientNet = financialReports.getClientNet('CL1');
    const caseNet = financialReports.getCaseNet('2025/1001');
    const officeNet = financialReports.getOfficeNet();
    // These three are DIFFERENT numbers by design (different scopes),
    // not because of a bug — this test guards against a future edit
    // accidentally making them collapse into the same value.
    assert.notStrictEqual(clientNet.totalExpenses, officeNet.totalExpenses);
    assert.notStrictEqual(caseNet.totalExpenses, officeNet.totalExpenses);
  });

  console.log('\n' + passed + '/' + (passed + failed) + ' checks passed.');
  if (failed > 0) {
    console.log('\n' + failed + ' CHECK(S) FAILED.');
    process.exit(1);
  } else {
    console.log('\nALL CHECKS PASSED.');
    process.exit(0);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
