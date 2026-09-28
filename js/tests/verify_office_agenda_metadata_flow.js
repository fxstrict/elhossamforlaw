/**
 * verify_office_agenda_metadata_flow.js — AGENDA-2
 * End-to-end Node harness for js/modules/office-agenda.js's write paths:
 * REAL Repository / AgendaMetadataRepository / FakeIndexedDB / REAL RBAC
 * (Permissions, PermissionGroups, Roles, PermissionService, SessionContext),
 * with stubs only for the browser bits (document, toast, ApiService,
 * toggleTask, navigate).
 * Run: node js/tests/verify_office_agenda_metadata_flow.js
 */
const assert = require('assert');
const path = require('path');
const fs = require('fs');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
global.window = global;
const { FakeIndexedDB } = require(path.join(__dirname, 'fake_indexeddb.js'));
global.indexedDB = new FakeIndexedDB();

// Real core + repository + RBAC (each sets its own window/global export).
const RepoNS = require(path.join(ROOT, 'core', 'Repository.js'));
global.Repository = RepoNS.Repository;
global.RepositoryErrorTypes = RepoNS.RepositoryErrorTypes;
global.createRepositoryError = RepoNS.createRepositoryError;
const DS = require(path.join(ROOT, 'core', 'DatabaseService.js'));
global.DatabaseService = DS.DatabaseService;
const IA = require(path.join(ROOT, 'core', 'IndexedDBAdapter.js'));
global.IndexedDBAdapter = IA.IndexedDBAdapter;
require(path.join(ROOT, 'repositories', 'AgendaMetadataRepository.js'));
require(path.join(ROOT, 'core', 'rbac', 'Permissions.js'));
require(path.join(ROOT, 'core', 'rbac', 'PermissionGroups.js'));
require(path.join(ROOT, 'core', 'rbac', 'Roles.js'));
require(path.join(ROOT, 'core', 'rbac', 'PermissionService.js'));
require(path.join(ROOT, 'core', 'rbac', 'SessionContext.js'));

// Browser stubs
const els = {};
function el(id) {
  return els[id] || (els[id] = {
    innerHTML: '', textContent: '', value: '', style: {},
    classList: { _open: false, add() { this._open = true; }, remove() { this._open = false; }, toggle() {} }
  });
}
global.document = { getElementById: el };
global.closeModal = (id) => el(id).classList.remove('open');
const toasts = [];
global.toast = (m, t) => toasts.push({ m, t });
const apiCalls = [];
global.ApiService = { syncRow: (sheet, rec, idx) => { apiCalls.push({ sheet, rec, idx }); return Promise.resolve(); } };
global.navigate = () => {};
global.escapeHtml = (v) => String(v == null ? '' : v);
global.statusBadge = () => '';

global.data = { sessions: [], tasks: [], processServerWorks: [] };
let toggleCalls = 0;
let toggleShouldFlip = true;
global.TASKS_ID_FIELD = 'رقم_المهمة';
global.SESSIONS_ID_FIELD = 'رقم_الجلسة';
global.PSW_ID_FIELD = 'رقم_العمل';
global.toggleTask = async (i) => {
  toggleCalls++;
  if (!toggleShouldFlip) return;
  const t = data.tasks[i];
  t['الحالة'] = t['الحالة'] === 'done' ? 'pending' : 'done';
};

vm.runInThisContext(fs.readFileSync(path.join(ROOT, 'ui-utils.js'), 'utf8'));
vm.runInThisContext(fs.readFileSync(path.join(ROOT, 'modules', 'office-agenda.js'), 'utf8'));

let passed = 0, failed = 0;
const log = [];
async function check(label, fn) {
  try { await fn(); passed++; log.push('PASS — ' + label); }
  catch (e) { failed++; log.push('FAIL — ' + label + '  =>  ' + e.message); }
}
const clone = (o) => JSON.parse(JSON.stringify(o));
const OWNER = { 'اسم_المستخدم': 'boss', 'الاسم': 'المدير', 'الحالة': 'نشط', 'الدور': 'office_owner' };
const LAWYER = { 'اسم_المستخدم': 'lw', 'الاسم': 'محامي', 'الحالة': 'نشط', 'الدور': 'lawyer' };
const meta = (t, id) => agendaMetaFor(t, id);

(async function main() {
  await agendaMetadataRepositoryReadyPromise;

  data.sessions = [{ 'رقم_الجلسة': 'S1', 'التاريخ': '2026-09-28', 'الوقت': '10:00', 'عنوان_القضية': 'قضية' }];
  data.tasks = [
    { 'رقم_المهمة': 'T1', 'العنوان': 'مهمة 1', 'الموعد_النهائي': '2026-09-28', 'الحالة': 'pending' },
    { 'رقم_المهمة': 'T2', 'العنوان': 'مهمة 2', 'الموعد_النهائي': '2026-09-28', 'الحالة': 'done' }
  ];
  data.processServerWorks = [{ 'رقم_العمل': 'P1', 'تاريخ_الجلسة': '2026-09-28', 'الحالة': 'غير مستلم' }];
  const sessionsBefore = clone(data.sessions);
  const pswBefore = clone(data.processServerWorks);

  await check('exposes the globals SyncEngine/settings.js resolve (agendaMetadataRepository + ReadyPromise)', () => {
    assert.ok(agendaMetadataRepository && typeof agendaMetadataRepository.import === 'function');
    assert.ok(agendaMetadataRepositoryReadyPromise && typeof agendaMetadataRepositoryReadyPromise.then === 'function');
    assert.strictEqual(window['agendaMetadata' + 'Repository'], agendaMetadataRepository);
  });

  await check('no row yet => implicit NOT_STARTED, no assignee', () => {
    assert.strictEqual(agendaStatusOf(meta('session', 'S1')), 'NOT_STARTED');
    assert.strictEqual(meta('session', 'S1'), null);
  });

  // ---- RBAC: no login session => inert (fail-open) ----
  await check('no login session: actions allowed (documented RBAC-inert convention)', () => {
    HossamSession.clear();
    assert.strictEqual(agendaCan('CanAssignAgendaWork'), true);
  });

  // ---- RBAC: lawyer has no agenda keys ----
  await check('lawyer session: no assign/status permission, footer shows NO action buttons', async () => {
    HossamSession.setCurrentUser(LAWYER, { persist: false });
    assert.strictEqual(agendaCan('CanAssignAgendaWork'), false);
    assert.strictEqual(agendaCan('CanChangeAgendaExecutionStatus'), false);
    const html = agendaFooterHtml('session', 'S1');
    assert.ok(html.indexOf('agenda-act-btn') === -1, html);
    assert.ok(html.indexOf('لم يبدأ') !== -1);
  });

  await check('lawyer: agendaAction() is refused, writes nothing, does not open the dialog', async () => {
    const n = apiCalls.length;
    agendaAction('assign', 'session', 'S1');
    assert.strictEqual(el('modalAgendaAction').classList._open, false);
    assert.strictEqual(meta('session', 'S1'), null);
    assert.strictEqual(apiCalls.length, n);
  });

  // ---- RBAC: owner has all ----
  await check('office_owner session: gets assign + start buttons', () => {
    HossamSession.setCurrentUser(OWNER, { persist: false });
    assert.strictEqual(agendaCan('CanAssignAgendaWork'), true);
    const html = agendaFooterHtml('session', 'S1');
    assert.ok(html.indexOf("agendaAction('assign','session','S1')") !== -1);
    assert.ok(html.indexOf("agendaAction('start','session','S1')") !== -1);
  });

  await check('assign: creates the row lazily, syncs to the new Sheet as a NEW row (idx -1)', async () => {
    await agendaApplyAction({ kind: 'assign', type: 'session', id: 'S1' }, 'lw');
    const m = meta('session', 'S1');
    assert.ok(m, 'row created');
    assert.strictEqual(m['المعرف'], 'session:S1');
    assert.strictEqual(m['مُسند_إلى'], 'lw');
    assert.strictEqual(agendaStatusOf(m), 'NOT_STARTED');
    const last = apiCalls[apiCalls.length - 1];
    assert.strictEqual(last.sheet, 'أجندة_البيانات_الوصفية');
    assert.strictEqual(last.idx, -1);
  });

  await check('start: IN_PROGRESS, keeps the assignee, syncs as an UPDATE (idx >= 0)', async () => {
    await agendaApplyAction({ kind: 'start', type: 'session', id: 'S1' }, '');
    const m = meta('session', 'S1');
    assert.strictEqual(m['حالة_التنفيذ'], 'IN_PROGRESS');
    assert.strictEqual(m['مُسند_إلى'], 'lw');
    assert.ok(apiCalls[apiCalls.length - 1].idx >= 0);
  });

  await check('block stores سبب_التوقف; resume clears it', async () => {
    await agendaApplyAction({ kind: 'block', type: 'session', id: 'S1' }, 'بانتظار مستند');
    assert.strictEqual(meta('session', 'S1')['حالة_التنفيذ'], 'BLOCKED');
    assert.strictEqual(meta('session', 'S1')['سبب_التوقف'], 'بانتظار مستند');
    await agendaApplyAction({ kind: 'resume', type: 'session', id: 'S1' }, '');
    assert.strictEqual(meta('session', 'S1')['حالة_التنفيذ'], 'IN_PROGRESS');
    assert.strictEqual(meta('session', 'S1')['سبب_التوقف'], '');
  });

  await check('complete on a SESSION: metadata only — toggleTask never called, no source write', async () => {
    const before = toggleCalls;
    await agendaApplyAction({ kind: 'complete', type: 'session', id: 'S1' }, 'تمت الجلسة');
    assert.strictEqual(meta('session', 'S1')['حالة_التنفيذ'], 'COMPLETED');
    assert.strictEqual(meta('session', 'S1')['ملاحظة_الإنجاز'], 'تمت الجلسة');
    assert.strictEqual(meta('session', 'S1')['أنجزها'], 'boss');
    assert.strictEqual(toggleCalls, before);
  });

  await check('complete on a PSW: metadata only — no source write', async () => {
    const before = toggleCalls;
    await agendaApplyAction({ kind: 'start', type: 'processServerWork', id: 'P1' }, '');
    await agendaApplyAction({ kind: 'complete', type: 'processServerWork', id: 'P1' }, 'استلم');
    assert.strictEqual(meta('processServerWork', 'P1')['حالة_التنفيذ'], 'COMPLETED');
    assert.strictEqual(toggleCalls, before);
  });

  await check('complete on a pending ADMIN work: existing toggleTask() called once, task becomes done', async () => {
    await agendaApplyAction({ kind: 'start', type: 'administrativeWork', id: 'T1' }, '');
    const before = toggleCalls;
    await agendaApplyAction({ kind: 'complete', type: 'administrativeWork', id: 'T1' }, 'أُنجزت');
    assert.strictEqual(toggleCalls, before + 1);
    assert.strictEqual(data.tasks[0]['الحالة'], 'done');
    assert.strictEqual(meta('administrativeWork', 'T1')['حالة_التنفيذ'], 'COMPLETED');
  });

  await check('complete when the task is ALREADY done: toggleTask NOT called (no accidental flip back)', async () => {
    await agendaApplyAction({ kind: 'start', type: 'administrativeWork', id: 'T2' }, '');
    const before = toggleCalls;
    await agendaApplyAction({ kind: 'complete', type: 'administrativeWork', id: 'T2' }, 'ok');
    assert.strictEqual(toggleCalls, before);
    assert.strictEqual(data.tasks[1]['الحالة'], 'done');
    assert.strictEqual(meta('administrativeWork', 'T2')['حالة_التنفيذ'], 'COMPLETED');
  });

  await check('reopen on an admin work: task flips back to pending, note keeps history + reason', async () => {
    const before = toggleCalls;
    await agendaApplyAction({ kind: 'reopen', type: 'administrativeWork', id: 'T1' }, 'ظهر نقص');
    assert.strictEqual(toggleCalls, before + 1);
    assert.strictEqual(data.tasks[0]['الحالة'], 'pending');
    const m = meta('administrativeWork', 'T1');
    assert.strictEqual(m['حالة_التنفيذ'], 'IN_PROGRESS');
    assert.ok(m['ملاحظة_الإنجاز'].indexOf('أُنجزت') !== -1 && m['ملاحظة_الإنجاز'].indexOf('ظهر نقص') !== -1);
    assert.strictEqual(m['تاريخ_الإنجاز'], '');
  });

  await check('source write-back failure => NO metadata change, error toast (atomic)', async () => {
    toggleShouldFlip = false;
    const stateBefore = clone(meta('administrativeWork', 'T1'));
    const nToasts = toasts.length;
    await agendaApplyAction({ kind: 'complete', type: 'administrativeWork', id: 'T1' }, 'x');
    toggleShouldFlip = true;
    assert.deepStrictEqual(clone(meta('administrativeWork', 'T1')), stateBefore);
    assert.ok(toasts.length > nToasts && toasts[toasts.length - 1].t === 'error');
  });

  await check('BLOCKED without a reason is rejected by the repository (defense in depth)', async () => {
    const n = toasts.length;
    await agendaApplyAction({ kind: 'block', type: 'session', id: 'S1' }, '');
    assert.ok(toasts.length > n);
    assert.notStrictEqual(meta('session', 'S1')['حالة_التنفيذ'], 'BLOCKED');
  });

  await check('agendaAction(block) opens the dialog for an authorized user', () => {
    agendaAction('block', 'processServerWork', 'P1');
    assert.strictEqual(el('modalAgendaAction').classList._open, true);
    assert.strictEqual(el('agendaActionTextWrap').style.display, '');
  });

  await check('dialog submit with an empty required field is refused (no write)', () => {
    el('agendaActionText').value = '   ';
    const n = apiCalls.length;
    agendaActionSubmit();
    assert.strictEqual(apiCalls.length, n);
  });

  await check('SESSIONS and PSW source rows are byte-identical after every action (never written)', () => {
    assert.deepStrictEqual(clone(data.sessions), sessionsBefore);
    assert.deepStrictEqual(clone(data.processServerWorks), pswBefore);
  });

  await check('every Sheet write targeted ONLY أجندة_البيانات_الوصفية', () => {
    assert.ok(apiCalls.length > 0);
    apiCalls.forEach((c) => assert.strictEqual(c.sheet, 'أجندة_البيانات_الوصفية'));
  });

  await check('metadata rows persist across a fresh repository instance (IndexedDB round-trip)', async () => {
    const r2 = new AgendaMetadataRepository();
    await r2.open();
    const row = r2.getByWorkItemId('session:S1');
    assert.ok(row && row['حالة_التنفيذ'] === 'COMPLETED' && row['مُسند_إلى'] === 'lw');
  });

  console.log(log.join('\n'));
  console.log('\n' + passed + ' passed, ' + failed + ' failed.');
  process.exit(failed ? 1 : 0);
})();
