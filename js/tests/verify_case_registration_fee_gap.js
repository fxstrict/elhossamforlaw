/**
 * verify_case_registration_fee_gap.js
 * FINANCIAL_SYSTEM_AUDIT — PHASE 2 (Test / Reproduction).
 *
 * PURPOSE
 *   Proves, against the REAL Repository/DatabaseService/IndexedDBAdapter
 *   pipeline (no mocked business logic), the gap documented in
 *   PHASE 1 — DISCOVERY: an "أتعاب القضية" amount entered on the
 *   Client<->Case relationship record (CaseClientsRepository's
 *   'أتعاب_العلاقة' field — the field that sits next to the
 *   مدّعي/مدّعى عليه role picker during case registration) never
 *   becomes a Fees record and is therefore invisible to every
 *   financial total in the app (Fees page, Case Net, Client Net,
 *   Office Net).
 *
 * EVIDENCE THIS TEST IS BASED ON (not guessed):
 *   - js/repositories/CaseClientsRepository.js:116 — 'أتعاب_العلاقة' is
 *     a first-class field on the CaseClients schema.
 *   - js/modules/clients.js:1767,1929,1943 — the ONLY three places
 *     'أتعاب_العلاقة' is ever read or written in the entire project
 *     (all inside the CaseClients role-card UI itself; confirmed by a
 *     full-project grep in PHASE 1 — no other file references it).
 *   - js/modules/fees.js FEES_FIELDS (line 168) — has no
 *     'رقم_علاقة'/'أتعاب_العلاقة' entry, so saveFee() can never create
 *     a Fees record from a CaseClients row.
 *   - js/repositories/FeesRepository.js FEES_LEGACY_FIELDS (line 351)
 *     — DOES declare 'رقم_علاقة' as a Fees schema column (Config/
 *     00_Config.gs's own SHEET_DEFS comment: "اختياري: id من
 *     'قضية_موكلين' عند ربط الأتعاب بعلاقة موكل↔قضية محددة") — i.e.
 *     the link was designed for, but no code path in the project ever
 *     populates it. This test proves that gap in behavior, not just
 *     in schema.
 *   - js/modules/financial-reports.js getClientNet/getCaseNet/
 *     getOfficeNet (lines 104-153) read ONLY data.fees and
 *     data.expenses — never CaseClientsRepository — confirmed by
 *     direct inspection in PHASE 1.
 *
 * This file creates NO new production code and modifies NO existing
 * file — pure reproduction, per audit rule "لا تصلح بناء على التخمين"
 * (§20) and "أنشئ اختبارات تكشف المشكلات الحالية... قبل الإصلاح" (§19).
 */
'use strict';

const assert = require('assert');
const path = require('path');
const { FakeIndexedDB } = require(path.join(__dirname, 'fake_indexeddb.js'));

require(path.join(__dirname, '..', 'core', 'Repository.js'));
require(path.join(__dirname, '..', 'core', 'DatabaseService.js'));
require(path.join(__dirname, '..', 'core', 'IndexedDBAdapter.js'));

// financial-reports.js and fees.js both read the shared `data` global
// exactly as the real app does (see PHASE 1 evidence above).
global.data = { clients: [], cases: [], fees: [], expenses: [] };

const { CaseClientsRepository, createCaseClientsLocalStorageAdapter } =
  require(path.join(__dirname, '..', 'repositories', 'CaseClientsRepository.js'));

const fakeIndexedDBForExpenses = new FakeIndexedDB();
global.indexedDB = fakeIndexedDBForExpenses; // financial-reports.js's internal ExpensesRepository() opens against this
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

  // Independent FeesRepository instance, mirroring exactly how
  // js/modules/fees.js wires its own `feesRepository` (own adapter,
  // own fake IndexedDB backend) — kept separate from the CaseClients
  // backend below on purpose, matching the real app's module isolation.
  const feesFakeIndexedDB = new FakeIndexedDB();
  const feesAdapter = createFeesLocalStorageAdapter(feesFakeIndexedDB);
  const feesRepository = new FeesRepository({ storageAdapter: feesAdapter });
  await feesRepository.open();

  const caseClientsFakeIndexedDB = new FakeIndexedDB();
  const caseClientsAdapter = createCaseClientsLocalStorageAdapter(caseClientsFakeIndexedDB);
  const caseClientsRepository = new CaseClientsRepository({ storageAdapter: caseClientsAdapter });
  await caseClientsRepository.open();

  // Seed client + case exactly as the real "تسجيل قضية" flow would
  // have them already saved before the CaseClients role-card is filled.
  global.data.clients = [{ 'رقم_الموكل': 'CL1', 'الاسم': 'أحمد محمود' }];
  global.data.cases = [{ 'رقم_القضية': '2026/123' }];

  // ---- Reproduce the exact user scenario from the audit prompt ----
  // "عند تسجيل القضية واختيار الموكل... وبجانب الموكل توجد بيانات
  //  مرتبطة بالأتعاب" — this IS that write path: CaseClientsRepository
  // .create() with أتعاب_العلاقة, exactly as clients.js:1943 performs it.
  const relResult = await caseClientsRepository.create({
    'رقم_القضية': '2026/123',
    'رقم_الموكل': 'CL1',
    'الصفة': 'مدّعي',
    'أتعاب_العلاقة': '20000'
  });

  await check('SETUP: CaseClients relationship with أتعاب_العلاقة=20000 saves successfully', () => {
    assert.ok(relResult.success, relResult.error && relResult.error.message);
  });

  await check('GAP 1 — no Fees record is ever created as a side effect of the CaseClients write (FeesRepository stays empty)', () => {
    const allFees = feesRepository.getAll();
    assert.strictEqual(allFees.length, 0,
      'expected 0 Fees records, found ' + allFees.length + ' — if this now fails, a fee IS being created automatically, re-audit before trusting this test');
  });

  // Sync the (still-empty) Fees mirror + expenses mirror the way the
  // real app does before rendering any report.
  global.data.fees = feesRepository.getAll();
  financialReports.syncExpensesMirror();

  await check('GAP 2 — getCaseNet(\'2026/123\') does NOT include the 20000 registered on the case-client relationship (totalFees stays 0)', () => {
    const net = financialReports.getCaseNet('2026/123');
    assert.strictEqual(net.totalFees, 0,
      'expected case totalFees to ignore أتعاب_العلاقة and read 0, got ' + net.totalFees);
  });

  await check('GAP 3 — getClientNet(\'CL1\') does NOT include the 20000 registered on the case-client relationship (totalFees stays 0)', () => {
    const net = financialReports.getClientNet('CL1');
    assert.strictEqual(net.totalFees, 0,
      'expected client totalFees to ignore أتعاب_العلاقة and read 0, got ' + net.totalFees);
  });

  await check('GAP 4 — getOfficeNet() does NOT include the 20000 anywhere in office-wide revenue (totalFees stays 0)', () => {
    const net = financialReports.getOfficeNet();
    assert.strictEqual(net.totalFees, 0,
      'expected office-wide totalFees to ignore أتعاب_العلاقة and read 0, got ' + net.totalFees);
  });

  // ---- Prove the SAME amount entered through the Fees page instead
  //      IS fully visible everywhere — isolates the gap to the
  //      case-registration entry point specifically, not to Fees/
  //      reporting logic in general. ----
  const feeResult = await feesRepository.create({
    'رقم_القضية': '2026/123',
    'اسم_الموكل': 'أحمد محمود',
    'رقم_الموكل': 'CL1',
    'المبلغ': '20000'
  });
  global.data.fees = feesRepository.getAll();

  await check('CONTROL — the identical 20000 amount, entered via the Fees page instead, DOES appear in FeesRepository', () => {
    assert.ok(feeResult.success, feeResult.error && feeResult.error.message);
    assert.strictEqual(feesRepository.getAll().length, 1);
  });

  await check('CONTROL — getCaseNet(\'2026/123\') DOES total 20000 once the SAME amount goes through the Fees page', () => {
    const net = financialReports.getCaseNet('2026/123');
    assert.strictEqual(net.totalFees, 20000);
  });

  await check('CONTROL — getClientNet(\'CL1\') DOES total 20000 once the SAME amount goes through the Fees page', () => {
    const net = financialReports.getClientNet('CL1');
    assert.strictEqual(net.totalFees, 20000);
  });

  // ---- Confirm the designed-but-dead link column ----
  // UPDATED — PHASE 4 (Architecture Decision OPTION D, approved and
  // implemented): رقم_علاقة is no longer dead. fees.js now exposes
  // createFeePayment() (see verify_fee_agreement_reporting.js for its
  // dedicated tests), which DOES populate رقم_علاقة when passed. This
  // check now asserts the NARROWER, still-true guarantee that motivated
  // choosing OPTION D over a full rewrite: saveFee() itself — the
  // #modalFee DOM form's actual save path — remains byte-for-byte
  // unmodified, so the existing Fees page behaves exactly as before.
  await check('FIXED (was SCHEMA GAP) — رقم_علاقة is now populated via the new createFeePayment() helper, while saveFee() itself (the #modalFee form path) stays completely unmodified', () => {
    const feesModuleSource = require('fs').readFileSync(
      path.join(__dirname, '..', 'modules', 'fees.js'), 'utf8');
    const hasFeesLegacyField = /FEES_LEGACY_FIELDS[\s\S]*?رقم_علاقة/.test(
      require('fs').readFileSync(path.join(__dirname, '..', 'repositories', 'FeesRepository.js'), 'utf8'));
    assert.ok(hasFeesLegacyField, 'expected رقم_علاقة to be declared on FeesRepository (it is, per Config/00_Config.gs SHEET_DEFS)');
    assert.ok(/createFeePayment/.test(feesModuleSource), 'expected fees.js to expose createFeePayment()');

    const saveFeeSource = feesModuleSource.slice(
      feesModuleSource.indexOf('async function saveFee()'),
      feesModuleSource.indexOf('function editFee(i)')
    );
    assert.ok(!/رقم_علاقة/.test(saveFeeSource),
      'expected saveFee() (the #modalFee DOM form path) to remain untouched — رقم_علاقة should only be reachable via createFeePayment()');
  });

  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  if (failed > 0) process.exitCode = 1;
}

main().catch(function (e) {
  console.error('FATAL:', e);
  process.exitCode = 1;
});
