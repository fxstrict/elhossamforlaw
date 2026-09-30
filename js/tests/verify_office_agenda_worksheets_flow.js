/**
 * verify_office_agenda_worksheets_flow.js — AGENDA-3
 * End-to-end Node harness for js/modules/office-agenda.js's Work Sheet
 * write paths: REAL Repository / AgendaMetadataRepository /
 * WorkSheetsRepository / FakeIndexedDB / REAL RBAC, stubs only for the
 * browser bits.
 * Run: node js/tests/verify_office_agenda_worksheets_flow.js
 */
const assert = require('assert');
const path = require('path');
const fs = require('fs');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
global.window = global;
const { FakeIndexedDB } = require(path.join(__dirname, 'fake_indexeddb.js'));
global.indexedDB = new FakeIndexedDB();

const RepoNS = require(path.join(ROOT, 'core', 'Repository.js'));
global.Repository = RepoNS.Repository;
global.RepositoryErrorTypes = RepoNS.RepositoryErrorTypes;
global.createRepositoryError = RepoNS.createRepositoryError;
global.DatabaseService = require(path.join(ROOT, 'core', 'DatabaseService.js')).DatabaseService;
global.IndexedDBAdapter = require(path.join(ROOT, 'core', 'IndexedDBAdapter.js')).IndexedDBAdapter;
require(path.join(ROOT, 'repositories', 'AgendaMetadataRepository.js'));
require(path.join(ROOT, 'repositories', 'WorkSheetsRepository.js'));
require(path.join(ROOT, 'core', 'rbac', 'Permissions.js'));
require(path.join(ROOT, 'core', 'rbac', 'PermissionGroups.js'));
require(path.join(ROOT, 'core', 'rbac', 'Roles.js'));
require(path.join(ROOT, 'core', 'rbac', 'PermissionService.js'));
require(path.join(ROOT, 'core', 'rbac', 'SessionContext.js'));

const els = {};
function el(id) {
  return els[id] || (els[id] = {
    innerHTML: '', textContent: '', value: '', style: {},
    classList: { _open: false, add() { this._open = true; }, remove() { this._open = false; }, toggle() {} }
  });
}
global.document = { getElementById: el };
global.closeModal = () => {};
const toasts = [];
global.toast = (m, t) => toasts.push({ m, t });
const apiCalls = [];
global.ApiService = { syncRow: (sheet, rec, idx) => { apiCalls.push({ sheet, rec, idx }); return Promise.resolve(); } };
global.navigate = () => {};
global.escapeHtml = (v) => String(v == null ? '' : v);
global.statusBadge = () => '';
global.TASKS_ID_FIELD = 'رقم_المهمة';
global.SESSIONS_ID_FIELD = 'رقم_الجلسة';
global.PSW_ID_FIELD = 'رقم_العمل';
global.toggleTask = async (i) => { data.tasks[i]['الحالة'] = data.tasks[i]['الحالة'] === 'done' ? 'pending' : 'done'; };
let confirmAnswer = true;
global.confirmDialog = async () => confirmAnswer;
global.window.prompt = () => 'boss'; // used only by agendaSheetAssignPrompt (not exercised directly below)

global.data = { sessions: [], tasks: [], processServerWorks: [], cases: [] };

vm.runInThisContext(fs.readFileSync(path.join(ROOT, 'ui-utils.js'), 'utf8'));
vm.runInThisContext(fs.readFileSync(path.join(ROOT, 'modules', 'office-agenda.js'), 'utf8'));

let passed = 0, failed = 0;
const log = [];
async function check(label, fn) {
  try { await fn(); passed++; log.push('PASS — ' + label); }
  catch (e) { failed++; log.push('FAIL — ' + label + '  =>  ' + e.message); }
}
const OWNER = { 'اسم_المستخدم': 'boss', 'الاسم': 'المدير', 'الحالة': 'نشط', 'الدور': 'office_owner' };
const SECRETARY = { 'اسم_المستخدم': 'sec', 'الاسم': 'السكرتيرة', 'الحالة': 'نشط', 'الدور': 'secretary' };
const LAWYER = { 'اسم_المستخدم': 'lw', 'الاسم': 'محامي', 'الحالة': 'نشط', 'الدور': 'lawyer' };
const ACCOUNTANT = { 'اسم_المستخدم': 'ac', 'الاسم': 'محاسب', 'الحالة': 'نشط', 'الدور': 'accountant' };

(async function main() {
  await agendaMetadataRepositoryReadyPromise;
  await workSheetsRepositoryReadyPromise;

  data.sessions = [{ 'رقم_الجلسة': 'S1', 'التاريخ': '2026-09-28', 'الوقت': '10:00', 'عنوان_القضية': 'قضية' }];
  data.tasks = [{ 'رقم_المهمة': 'T1', 'العنوان': 'مهمة 1', 'الموعد_النهائي': '2026-09-28', 'الحالة': 'pending' }];
  data.processServerWorks = [{ 'رقم_العمل': 'P1', 'تاريخ_الجلسة': '2026-09-28', 'الحالة': 'غير مستلم' }];

  await check('accountant (no CanCreateWorkSheet): agendaCreateSheet() is refused, no write', async () => {
    HossamSession.setCurrentUser(ACCOUNTANT, { persist: false });
    const n = apiCalls.length;
    await agendaCreateSheet();
    assert.strictEqual(apiCalls.length, n);
    assert.strictEqual(agendaSheetsAll().length, 0);
  });

  let sheetId;
  await check('secretary (§11 default: CanCreateWorkSheet): can create a DRAFT sheet, synced to the new Sheet', async () => {
    HossamSession.setCurrentUser(SECRETARY, { persist: false });
    els.agendaNewSheetDate = { value: '2026-09-28' };
    await agendaCreateSheet();
    const sheets = agendaSheetsAll();
    assert.strictEqual(sheets.length, 1);
    sheetId = sheets[0]['معرف_الورقة'];
    assert.strictEqual(sheets[0]['الحالة'], 'DRAFT');
    const last = apiCalls[apiCalls.length - 1];
    assert.strictEqual(last.sheet, 'أوراق_الشغل');
    assert.strictEqual(last.idx, -1);
  });

  await check('adding the same item twice is a de-duplicated no-op, footer flags "on another sheet"', async () => {
    await agendaSheetAddItem(sheetId, 'session', 'S1');
    await agendaSheetAddItem(sheetId, 'session', 'S1');
    assert.strictEqual(workSheetsRepository.getItems(workSheetsRepository.get(sheetId)).length, 1);
    await agendaSheetAddItem(sheetId, 'administrativeWork', 'T1');
    await agendaSheetAddItem(sheetId, 'processServerWork', 'P1');
    HossamSession.setCurrentUser(OWNER, { persist: false }); // owner: CanCreateWorkSheet too
    const html = agendaFooterHtml('session', 'S1');
    assert.ok(html.indexOf('agenda-on-sheet-flag') !== -1);
  });

  await check('lawyer CANNOT create/issue a sheet (no CanCreateWorkSheet) but CAN close one later', () => {
    HossamSession.setCurrentUser(LAWYER, { persist: false });
    assert.strictEqual(agendaCan('CanCreateWorkSheet'), false);
    assert.strictEqual(agendaCan('CanCloseWorkSheet'), true);
  });

  await check('DRAFT -> IN_PROGRESS directly is rejected (must go through ISSUED)', async () => {
    HossamSession.setCurrentUser(SECRETARY, { persist: false });
    const r = await workSheetsRepository.transitionState(sheetId, 'IN_PROGRESS');
    assert.strictEqual(r.success, false);
  });

  await check('agendaSheetTransition(ISSUED) by secretary succeeds and syncs an UPDATE', async () => {
    const n = apiCalls.length;
    await agendaSheetTransition(sheetId, 'ISSUED');
    assert.strictEqual(workSheetsRepository.get(sheetId)['الحالة'], 'ISSUED');
    assert.ok(apiCalls.length > n);
    assert.ok(apiCalls[apiCalls.length - 1].idx >= 0);
  });

  await check('accountant cannot transition the sheet at all', async () => {
    HossamSession.setCurrentUser(ACCOUNTANT, { persist: false });
    const before = workSheetsRepository.get(sheetId)['الحالة'];
    await agendaSheetTransition(sheetId, 'IN_PROGRESS');
    assert.strictEqual(workSheetsRepository.get(sheetId)['الحالة'], before);
  });

  await check('secretary moves it to IN_PROGRESS', async () => {
    HossamSession.setCurrentUser(SECRETARY, { persist: false });
    await agendaSheetTransition(sheetId, 'IN_PROGRESS');
    assert.strictEqual(workSheetsRepository.get(sheetId)['الحالة'], 'IN_PROGRESS');
  });

  await check('settlement reconciliation: a COMPLETED admin-work item on the sheet gets its source flipped to done via the SAME toggleTask path', async () => {
    HossamSession.setCurrentUser(OWNER, { persist: false });
    await agendaApplyAction({ kind: 'start', type: 'administrativeWork', id: 'T1' }, '');
    await agendaApplyAction({ kind: 'complete', type: 'administrativeWork', id: 'T1' }, 'أُنجزت');
    assert.strictEqual(data.tasks[0]['الحالة'], 'done'); // already flipped by the complete action itself

    // Simulate a metadata/source desync (e.g. a partial prior failure) and
    // verify settlement's reconciliation pass repairs it idempotently.
    data.tasks[0]['الحالة'] = 'pending';
    HossamSession.setCurrentUser(SECRETARY, { persist: false });
    await agendaSheetSettle(sheetId, 'تم إنجاز البند الإداري، والجلسة والمحضر منتظران');
    assert.strictEqual(data.tasks[0]['الحالة'], 'done', 'settlement should have repaired the desync via agendaWriteBackTask');
    assert.strictEqual(workSheetsRepository.get(sheetId)['الحالة'], 'SETTLED');
    assert.strictEqual(workSheetsRepository.get(sheetId)['ملخص_التسوية'], 'تم إنجاز البند الإداري، والجلسة والمحضر منتظران');
  });

  await check('settlement does NOT touch sessions or PSW rows (§6: admin works only)', () => {
    assert.strictEqual(data.sessions[0]['التاريخ'], '2026-09-28');
    assert.strictEqual(data.processServerWorks[0]['الحالة'], 'غير مستلم');
  });

  await check('SETTLED -> CLOSED with incomplete items (session + PSW still not COMPLETED) requires confirmation; refusing it leaves the sheet SETTLED', async () => {
    HossamSession.setCurrentUser(LAWYER, { persist: false }); // has CanCloseWorkSheet
    confirmAnswer = false;
    await agendaSheetClose(sheetId);
    assert.strictEqual(workSheetsRepository.get(sheetId)['الحالة'], 'SETTLED');
  });

  await check('confirming closes it despite incomplete items; closing does NOT alter Agenda Metadata for those items', async () => {
    const sBefore = JSON.stringify(agendaMetaFor('session', 'S1'));
    const pBefore = JSON.stringify(agendaMetaFor('processServerWork', 'P1'));
    confirmAnswer = true;
    await agendaSheetClose(sheetId);
    assert.strictEqual(workSheetsRepository.get(sheetId)['الحالة'], 'CLOSED');
    assert.strictEqual(JSON.stringify(agendaMetaFor('session', 'S1')), sBefore);
    assert.strictEqual(JSON.stringify(agendaMetaFor('processServerWork', 'P1')), pBefore);
  });

  await check('CLOSED is terminal: no further transition, no removal of items allowed in the detail render', async () => {
    const r = await agendaSheetTransition(sheetId, 'ISSUED');
    assert.strictEqual(workSheetsRepository.get(sheetId)['الحالة'], 'CLOSED');
  });

  await check('a second, fresh sheet: ISSUED can be cancelled directly, and closed-sheet history stays untouched', async () => {
    HossamSession.setCurrentUser(SECRETARY, { persist: false });
    els.agendaNewSheetDate = { value: '2026-09-29' };
    await agendaCreateSheet();
    const sheets = agendaSheetsAll();
    const id2 = sheets.find((w) => w['تاريخ_الاستهداف'] === '2026-09-29')['معرف_الورقة'];
    await agendaSheetTransition(id2, 'ISSUED');
    await agendaSheetTransition(id2, 'CANCELLED');
    assert.strictEqual(workSheetsRepository.get(id2)['الحالة'], 'CANCELLED');
    assert.strictEqual(workSheetsRepository.get(sheetId)['الحالة'], 'CLOSED');
  });

  await check('every Sheet write from this module targeted only أجندة_البيانات_الوصفية or أوراق_الشغل — never a source sheet', () => {
    apiCalls.forEach((c) => assert.ok(c.sheet === 'أجندة_البيانات_الوصفية' || c.sheet === 'أوراق_الشغل', c.sheet));
  });

  await check('data persists across a fresh WorkSheetsRepository instance (IndexedDB round-trip)', async () => {
    const r2 = new WorkSheetsRepository();
    await r2.open();
    const row = r2.get(sheetId);
    assert.ok(row && row['الحالة'] === 'CLOSED' && row['ملخص_التسوية']);
  });

  console.log(log.join('\n'));
  console.log('\n' + passed + ' passed, ' + failed + ' failed.');
  process.exit(failed ? 1 : 0);
})();
