/**
 * verify_legacy_fees.js
 * PHASE 14 — LEGACY FEES. A dedicated, explicit test (requested
 * independently even though related coverage exists in
 * verify_case_registration_fee_gap.js's CONTROL check and
 * verify_fee_agreement_reporting.js's duplicate-counting guard check —
 * this file states the legacy-compatibility contract on its own,
 * in one place).
 *
 * Scenario 1 — a pre-OPTION-D-style Fee record (رقم_علاقة empty,
 * created only with رقم_القضية + اسم_الموكل + المبلغ, exactly as every
 * Fee in this project looked before PHASE 4):
 *   - is NOT ignored by any report
 *   - is NOT counted twice
 *   - enters collected (getCaseNet/getClientNet/getOfficeNet)
 *   - is NOT auto-attributed to any specific CaseClients relationship
 *     that happens to exist for that case (no invented link — PHASE 1's
 *     own rule: "لا تفترض وجود شيء لم تجده في الكود")
 *   - does not corrupt getRelationshipRemaining() for a real,
 *     properly-linked relationship on the very same case
 *
 * Scenario 2 — a NEW, رقم_علاقة-tagged Fee is counted through the
 * relationship path only, never additionally through the legacy
 * رقم_القضية/اسم_الموكل fallback (both paths read the exact same
 * `fees` array — this test proves the sum stays single, not doubled).
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
  global.data.cases = [{ 'رقم_القضية': '2026/X' }];

  // A real, properly-linked relationship exists on this same case
  // (agreed 10000) — the legacy fee below must NOT be silently
  // attributed to it.
  const rel = await caseClientsRepository.create({
    'رقم_القضية': '2026/X', 'رقم_الموكل': 'CL1', 'الصفة': 'مدّعي', 'أتعاب_العلاقة': '10000'
  });
  global.data.caseClients = caseClientsRepository.getAll();

  // ---- Scenario 1: legacy Fee, exactly the pre-PHASE-4 shape ----
  const legacyResult = await feesRepository.create({
    'رقم_القضية': '2026/X', 'اسم_الموكل': 'أحمد محمود', 'المبلغ': '5000', 'تاريخ_الاستلام': '2026-08-01'
    // deliberately NO رقم_علاقة, NO رقم_الموكل — this is what every Fee
    // looked like before PHASE 4 existed.
  });
  global.data.fees = feesRepository.getAll();

  await check('Legacy Fee (no رقم_علاقة): is created successfully — not rejected, not ignored', () => {
    assert.strictEqual(legacyResult.success, true, legacyResult.error && legacyResult.error.message);
    assert.strictEqual(feesRepository.getAll().length, 1);
  });

  await check('Legacy Fee: enters collected via getCaseNet() (name/case-matched fallback)', () => {
    const net = financialReports.getCaseNet('2026/X');
    assert.strictEqual(net.collected, 5000);
    assert.strictEqual(net.totalFees, 5000);
  });

  await check('Legacy Fee: enters collected via getClientNet() the same way', () => {
    const net = financialReports.getClientNet('CL1');
    assert.strictEqual(net.collected, 5000);
  });

  await check('Legacy Fee: is counted exactly ONCE in getOfficeNet() office-wide — not doubled by any second code path', () => {
    const officeNet = financialReports.getOfficeNet();
    assert.strictEqual(officeNet.collected, 5000);
  });

  await check('Legacy Fee: is NOT auto-attributed to the real relationship on this case — getRelationshipRemaining(rel.id) still shows 0 collected (the legacy fee has no رقم_علاقة, so it must not silently fill this relationship\'s balance)', () => {
    const relInfo = financialReports.getRelationshipRemaining(rel.record.id);
    assert.strictEqual(relInfo.agreedTotal, 10000);
    assert.strictEqual(relInfo.collected, 0, 'the legacy fee must not be invented into this relationship\'s collected total');
    assert.strictEqual(relInfo.remaining, 10000, 'remaining must reflect ONLY رقم_علاقة-tagged payments, untouched by the legacy fee');
  });

  // ---- Scenario 2: a NEW, properly-linked Fee on the SAME case,
  //      alongside the legacy one — must not be double-counted through
  //      both the relationship path AND the legacy name/case fallback ----
  const linkedResult = await feesRepository.create({
    'رقم_القضية': '2026/X', 'رقم_الموكل': 'CL1', 'اسم_الموكل': 'أحمد محمود',
    'المبلغ': '3000', 'تاريخ_الاستلام': '2026-08-05', 'رقم_علاقة': rel.record.id
  });
  global.data.fees = feesRepository.getAll();

  await check('New رقم_علاقة-tagged Fee: created successfully alongside the legacy one', () => {
    assert.strictEqual(linkedResult.success, true, linkedResult.error && linkedResult.error.message);
    assert.strictEqual(feesRepository.getAll().length, 2);
  });

  await check('getRelationshipRemaining(rel.id): now shows exactly 3000 collected (from the linked payment only) — the legacy 5000 still does not leak in', () => {
    const relInfo = financialReports.getRelationshipRemaining(rel.record.id);
    assert.strictEqual(relInfo.collected, 3000);
    assert.strictEqual(relInfo.remaining, 7000);
  });

  await check('getCaseNet(\'2026/X\'): totals 8000 (5000 legacy + 3000 linked) — summed exactly ONCE each, not 11000 or 16000 (no double counting across the two paths)', () => {
    const net = financialReports.getCaseNet('2026/X');
    assert.strictEqual(net.collected, 8000);
  });

  await check('getClientNet(\'CL1\'): also totals exactly 8000 — same single-count guarantee at the client level', () => {
    const net = financialReports.getClientNet('CL1');
    assert.strictEqual(net.collected, 8000);
  });

  await check('getOfficeNet(): office-wide total is exactly 8000, not doubled', () => {
    const net = financialReports.getOfficeNet();
    assert.strictEqual(net.collected, 8000);
  });

  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  if (failed > 0) process.exitCode = 1;
}

main().catch(function (e) {
  console.error('FATAL:', e);
  process.exitCode = 1;
});
