/**
 * verify_office_agenda_gaps.js — AGENDA-2 gap-closing pass
 * Covers: PSW agendaDueDate/overdue, nextAction/nextDate reappearance,
 * BLOCKED suppresses overdue + shows in its own bucket, visibility
 * scoping (CanViewAllAgendaWork / assignee / case-scope / no-case),
 * CanViewAgenda hard gate, and no double-counting across sections.
 * Run: node js/tests/verify_office_agenda_gaps.js
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
global.toast = () => {};
global.ApiService = { syncRow: () => Promise.resolve() };
global.navigate = () => {};
global.escapeHtml = (v) => String(v == null ? '' : v);
global.statusBadge = () => '';
global.TASKS_ID_FIELD = 'رقم_المهمة';
global.SESSIONS_ID_FIELD = 'رقم_الجلسة';
global.PSW_ID_FIELD = 'رقم_العمل';
global.toggleTask = async (i) => { data.tasks[i]['الحالة'] = data.tasks[i]['الحالة'] === 'done' ? 'pending' : 'done'; };

global.data = { sessions: [], tasks: [], processServerWorks: [], cases: [] };

vm.runInThisContext(fs.readFileSync(path.join(ROOT, 'ui-utils.js'), 'utf8'));
vm.runInThisContext(fs.readFileSync(path.join(ROOT, 'modules', 'office-agenda.js'), 'utf8'));

let passed = 0, failed = 0;
const log = [];
async function check(label, fn) {
  try { await fn(); passed++; log.push('PASS — ' + label); }
  catch (e) { failed++; log.push('FAIL — ' + label + '  =>  ' + e.message); }
}
function today() { const n = new Date(); return n.getFullYear() + '-' + String(n.getMonth() + 1).padStart(2, '0') + '-' + String(n.getDate()).padStart(2, '0'); }
function daysFrom(n) { const d = new Date(); d.setDate(d.getDate() + n); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }

const OWNER = { id: 'u-owner', 'اسم_المستخدم': 'boss', 'الاسم': 'المدير', 'الحالة': 'نشط', 'الدور': 'office_owner' };
const LAWYER_A = { id: 'u-a', 'اسم_المستخدم': 'a', 'الاسم': 'محامي أ', 'الحالة': 'نشط', 'الدور': 'lawyer' };
const LAWYER_B = { id: 'u-b', 'اسم_المستخدم': 'b', 'الاسم': 'محامي ب', 'الحالة': 'نشط', 'الدور': 'lawyer' };
const ACCOUNTANT = { id: 'u-ac', 'اسم_المستخدم': 'ac', 'الاسم': 'محاسب', 'الحالة': 'نشط', 'الدور': 'accountant' };

(async function main() {
  await agendaMetadataRepositoryReadyPromise;

  data.cases = [{ 'رقم_القضية': 'C-SCOPED', 'المسئول': 'u-a' }]; // only LAWYER_A is assigned
  data.sessions = [
    { 'رقم_الجلسة': 'SA', 'التاريخ': today(), 'الوقت': '09:00', 'عنوان_القضية': 'قضية أ', 'رقم_القضية': 'C-SCOPED' },
    { 'رقم_الجلسة': 'SN', 'التاريخ': today(), 'الوقت': '10:00', 'عنوان_القضية': 'بلا قضية مرتبطة' } // no رقم_القضية
  ];
  data.tasks = [{ 'رقم_المهمة': 'TN1', 'العنوان': 'مهمة', 'الموعد_النهائي': daysFrom(-5), 'الحالة': 'pending' }];
  data.processServerWorks = [
    { 'رقم_العمل': 'PN1', 'الحالة': 'غير مستلم' }, // no تاريخ_الجلسة at all
    { 'رقم_العمل': 'PN2', 'الحالة': 'غير مستلم' }
  ];

  // ---- CanViewAgenda hard gate ----
  await check('accountant (no CanViewAgenda): agendaRenderCurrent shows the denied screen, not a render', () => {
    HossamSession.setCurrentUser(ACCOUNTANT, { persist: false });
    agendaMode = 'day';
    agendaRenderCurrent();
    assert.ok(el('agendaContent').innerHTML.indexOf('CanViewAgenda') !== -1);
  });

  // ---- PSW agendaDueDate (§8) ----
  await check('PSW with no تاريخ_الجلسة but with agendaDueDate: deadline = agendaDueDate, appears on that day', async () => {
    HossamSession.setCurrentUser(OWNER, { persist: false });
    await agendaApplyAction({ kind: 'edit', type: 'processServerWork', id: 'PN1' }, '', { due: today() });
    assert.deepStrictEqual(agendaPswDeadline(data.processServerWorks[0]), parseLocalDate(today()));
    const onToday = agendaPswOn(agendaStartOfDay(new Date()));
    assert.ok(onToday.some((w) => w['رقم_العمل'] === 'PN1'));
  });

  await check('PSW with agendaDueDate in the past and غير مستلم: counted overdue (§7 Table 6)', async () => {
    await agendaApplyAction({ kind: 'edit', type: 'processServerWork', id: 'PN1' }, '', { due: daysFrom(-3) });
    const od = agendaOverduePsw(new Date());
    assert.ok(od.some((w) => w['رقم_العمل'] === 'PN1'));
  });

  await check('PSW with NO تاريخ_الجلسة and NO agendaDueDate: never overdue, sits in the neutral awaiting bucket', () => {
    assert.strictEqual(agendaPswDeadline(data.processServerWorks[1]), null);
    const od = agendaOverduePsw(new Date());
    assert.ok(!od.some((w) => w['رقم_العمل'] === 'PN2'));
    const awaiting = agendaPswAwaitingNoDate();
    assert.ok(awaiting.some((w) => w['رقم_العمل'] === 'PN2'));
  });

  // ---- BLOCKED suppresses overdue + its own bucket ----
  await check('BLOCKED admin work: excluded from the overdue bucket, appears in the blocked bucket instead', async () => {
    await agendaApplyAction({ kind: 'start', type: 'administrativeWork', id: 'TN1' }, '');
    await agendaApplyAction({ kind: 'block', type: 'administrativeWork', id: 'TN1' }, 'ننتظر توكيل');
    const od = agendaOverdueAdminWorks(new Date());
    assert.ok(!od.some((t) => t['رقم_المهمة'] === 'TN1'));
    const blocked = agendaBlockedItems({});
    assert.ok(blocked.some((b) => b.type === 'administrativeWork' && b.rec['رقم_المهمة'] === 'TN1'));
  });

  // ---- nextAction / nextDate reappearance ----
  await check('nextDate reappearance: item shows again on the follow-up day even off its own date', async () => {
    const followUp = daysFrom(4);
    await agendaApplyAction({ kind: 'edit', type: 'administrativeWork', id: 'TN1' },
      '', { nextAction: 'إعادة الإعلان', nextDate: followUp });
    const onFollowUp = agendaAdminWorksDueOn(parseLocalDate(followUp));
    assert.ok(onFollowUp.some((t) => t['رقم_المهمة'] === 'TN1'));
    assert.strictEqual(agendaNextDateOf('administrativeWork', data.tasks[0]).toISOString().slice(0, 10),
      parseLocalDate(followUp).toISOString().slice(0, 10));
  });

  await check('nextDate does NOT reappear once the item is COMPLETED', async () => {
    await agendaApplyAction({ kind: 'resume', type: 'administrativeWork', id: 'TN1' }, '');
    await agendaApplyAction({ kind: 'complete', type: 'administrativeWork', id: 'TN1' }, 'تم');
    assert.strictEqual(agendaNextDateOf('administrativeWork', data.tasks[0]), null);
  });

  // ---- Visibility scoping (§19) ----
  await check('owner (CanViewAllAgendaWork): sees every item regardless of case/assignee', () => {
    HossamSession.setCurrentUser(OWNER, { persist: false });
    assert.strictEqual(agendaVisible('session', data.sessions[0]), true);
    assert.strictEqual(agendaVisible('session', data.sessions[1]), true);
  });

  await check('lawyer A (assigned on C-SCOPED): sees the case-linked session', () => {
    HossamSession.setCurrentUser(LAWYER_A, { persist: false });
    assert.strictEqual(agendaVisible('session', data.sessions[0]), true);
  });

  await check('lawyer B (NOT assigned on C-SCOPED): does NOT see the case-linked session', () => {
    HossamSession.setCurrentUser(LAWYER_B, { persist: false });
    assert.strictEqual(agendaVisible('session', data.sessions[0]), false);
  });

  await check('lawyer B: does NOT see a no-case item either, UNLESS assigned to them in the Agenda', async () => {
    assert.strictEqual(agendaVisible('session', data.sessions[1]), false);
    await agendaApplyAction({ kind: 'assign', type: 'session', id: 'SN' }, 'b');
    assert.strictEqual(agendaVisible('session', data.sessions[1]), true);
  });

  await check('agendaSessionsOn() itself is scoped: lawyer B only sees SN (assigned), not SA', () => {
    const onToday = agendaSessionsOn(agendaStartOfDay(new Date()));
    const ids = onToday.map((s) => s['رقم_الجلسة']);
    assert.ok(ids.indexOf('SN') !== -1 && ids.indexOf('SA') === -1);
  });

  await check('no login session: visibility layer is inert (fail-open, matches agendaCan convention)', () => {
    HossamSession.clear();
    assert.strictEqual(agendaVisible('session', data.sessions[0]), true);
  });

  console.log(log.join('\n'));
  console.log('\n' + passed + ' passed, ' + failed + ' failed.');
  process.exit(failed ? 1 : 0);
})();
