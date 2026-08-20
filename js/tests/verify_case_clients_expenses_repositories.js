/**
 * verify_case_clients_expenses_repositories.js
 * CASES_RELATIONSHIP_FINANCIAL — Phase A smoke test for the two new
 * Repositories (CaseClientsRepository, ExpensesRepository) against the
 * real Repository.js/DatabaseService.js/IndexedDBAdapter.js pipeline,
 * using the project's own FakeIndexedDB test harness (same pattern as
 * verify_documents_repository_integration.js / verify_clients_repository.js).
 */
'use strict';

const assert = require('assert');
const path = require('path');
const { FakeIndexedDB } = require(path.join(__dirname, 'fake_indexeddb.js'));

require(path.join(__dirname, '..', 'core', 'Repository.js'));
require(path.join(__dirname, '..', 'core', 'DatabaseService.js'));
require(path.join(__dirname, '..', 'core', 'IndexedDBAdapter.js'));

const { CaseClientsRepository, createCaseClientsLocalStorageAdapter } =
  require(path.join(__dirname, '..', 'repositories', 'CaseClientsRepository.js'));
const { ExpensesRepository, createExpensesLocalStorageAdapter } =
  require(path.join(__dirname, '..', 'repositories', 'ExpensesRepository.js'));

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
  {
    const fakeIndexedDB = new FakeIndexedDB();
    const adapter = createCaseClientsLocalStorageAdapter(fakeIndexedDB);
    const repo = new CaseClientsRepository({ storageAdapter: adapter });
    await repo.open();

    await check('CaseClientsRepository.create() persists a valid relationship row', async () => {
      const res = await repo.create({ 'رقم_القضية': 'C1', 'رقم_الموكل': 'CL1', 'الصفة': 'مدّعي', 'أتعاب_العلاقة': '5000' });
      assert.ok(res.success, res.error && res.error.message);
      assert.ok(res.record.id, 'expected a generated id');
      assert.strictEqual(res.record['رقم_القضية'], 'C1');
    });

    await check('CaseClientsRepository.create() rejects missing required fields', async () => {
      const res = await repo.create({ 'رقم_القضية': 'C2' });
      assert.strictEqual(res.success, false, 'expected validation failure for missing رقم_الموكل/الصفة');
    });

    await check('CaseClientsRepository rejects a duplicate client<->case relationship', async () => {
      await repo.create({ 'رقم_القضية': 'C3', 'رقم_الموكل': 'CL3', 'الصفة': 'مدّعي' });
      const res = await repo.create({ 'رقم_القضية': 'C3', 'رقم_الموكل': 'CL3', 'الصفة': 'مدّعى عليه' });
      assert.strictEqual(res.success, false, 'expected duplicate-relationship validation failure');
    });

    await check('CaseClientsRepository.getByCase()/getByClient() scope correctly', async () => {
      await repo.create({ 'رقم_القضية': 'C4', 'رقم_الموكل': 'CL4', 'الصفة': 'مدّعي' });
      await repo.create({ 'رقم_القضية': 'C4', 'رقم_الموكل': 'CL5', 'الصفة': 'مدّعي' });
      const byCase = repo.getByCase('C4');
      const byClient = repo.getByClient('CL4');
      assert.strictEqual(byCase.length, 2);
      assert.strictEqual(byClient.length, 1);
    });
  }

  {
    const fakeIndexedDB = new FakeIndexedDB();
    const adapter = createExpensesLocalStorageAdapter(fakeIndexedDB);
    const repo = new ExpensesRepository({ storageAdapter: adapter });
    await repo.open();

    await check('ExpensesRepository.create() persists a valid client-scope expense', async () => {
      const res = await repo.create({ 'النطاق': 'موكل', 'رقم_الموكل': 'CL1', 'المبلغ': '100', 'التصنيف': 'انتقال', 'التاريخ': '2026-01-01' });
      assert.ok(res.success, res.error && res.error.message);
      assert.ok(res.record.id);
    });

    await check('ExpensesRepository rejects client-scope expense without رقم_الموكل', async () => {
      const res = await repo.create({ 'النطاق': 'موكل', 'المبلغ': '100', 'التصنيف': 'انتقال', 'التاريخ': '2026-01-01' });
      assert.strictEqual(res.success, false);
    });

    await check('ExpensesRepository rejects case-scope expense without رقم_القضية', async () => {
      const res = await repo.create({ 'النطاق': 'قضية', 'المبلغ': '100', 'التصنيف': 'رسوم', 'التاريخ': '2026-01-01' });
      assert.strictEqual(res.success, false);
    });

    await check('ExpensesRepository accepts office-scope expense without client/case', async () => {
      const res = await repo.create({ 'النطاق': 'مكتب', 'المبلغ': '5000', 'التصنيف': 'إيجار', 'التاريخ': '2026-01-01' });
      assert.ok(res.success, res.error && res.error.message);
      assert.ok(res.record.id);
    });

    await check('ExpensesRepository rejects an invalid النطاق value', async () => {
      const res = await repo.create({ 'النطاق': 'غير_صحيح', 'المبلغ': '100', 'التصنيف': 'x', 'التاريخ': '2026-01-01' });
      assert.strictEqual(res.success, false);
    });

    await check('ExpensesRepository.getByCase()/getByClient()/getOfficeExpenses() scope correctly', async () => {
      await repo.create({ 'النطاق': 'قضية', 'رقم_القضية': 'C9', 'المبلغ': '50', 'التصنيف': 'دمغة', 'التاريخ': '2026-01-02' });
      await repo.create({ 'النطاق': 'موكل', 'رقم_الموكل': 'CL9', 'المبلغ': '30', 'التصنيف': 'نقل', 'التاريخ': '2026-01-03' });
      assert.strictEqual(repo.getByCase('C9').length, 1);
      assert.strictEqual(repo.getByClient('CL9').length, 1);
      assert.ok(repo.getOfficeExpenses().length >= 1);
    });
  }

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
