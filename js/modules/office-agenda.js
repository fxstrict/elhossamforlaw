/**
 * ================================================================
 * js/modules/office-agenda.js — أجندة المكتب | نظام الحسام للمحاماة
 * ================================================================
 * AGENDA-1 — Read-Only Derived Agenda.
 * AGENDA-2 (added) — Agenda Metadata: assignment + execution status. The
 *   derivation/aggregation below is still read-only over the three source
 *   domains; the ONLY writes are (a) agendaMetadata rows (+ their Sheet
 *   sync) and (b) for Administrative Works only, the existing toggleTask()
 *   on COMPLETED/reopen (closure spec §6). See the AGENDA-2 section.
 *
 * ARCHITECTURE (per AGENDA_DESIGN_CLOSURE_AND_ARCHITECTURE_SPECIFICATION.md,
 * §4/§5/§14/§15, and the AGENDA-1 implementation brief):
 *
 *   The Agenda is a DERIVED READ MODEL over three existing, independently
 *   owned source domains — it creates no database, no Sheet, no Agenda
 *   Metadata, no Work Sheets, and performs ZERO writes of any kind:
 *
 *     Sessions               data.sessions            (owned by sessions.js)
 *     Administrative Works   data.tasks                (owned by tasks.js)
 *     Process Server Works   data.processServerWorks   (owned by
 *                                                        process-server-works.js)
 *
 *   Work Item identity is COMPUTED, never stored:
 *     agendaWorkItemId = sourceType + ':' + sourceRecordId
 *   e.g. 'session:123', 'administrativeWork:abc123', 'processServerWork:456'
 *
 *   One source record = exactly one derived Work Item. Rescheduling a
 *   source record's date simply changes what the next render shows —
 *   there is nothing to migrate, snapshot, or keep in sync.
 *
 * OVERDUE SEMANTICS (§7 — do not reinterpret):
 *   - Sessions are NEVER "overdue". A past session is a historical event,
 *     not a missed deadline. This module never applies date<today=>overdue
 *     to a session.
 *   - Administrative Works reuse the EXACT existing rule already computed
 *     in js/modules/dashboard.js (renderAlertsCenter()): status !== 'done'
 *     AND الموعد_النهائي < now. Not reimplemented differently — the same
 *     two-condition test is repeated here so the Agenda's "متأخر" bucket
 *     and the Dashboard's "مهام إدارية متأخرة" chip can never disagree.
 *   - Process Server Works: تاريخ_الجلسة (if present) is used as the
 *     relevant date signal. No agendaDueDate is invented (that is an
 *     AGENDA-2+ concept, requiring Agenda Metadata, which does not exist
 *     yet). A PSW with no تاريخ_الجلسة is never called overdue — it is
 *     surfaced separately as "بانتظار الاستلام" when still غير مستلم,
 *     with no date attached to it.
 *
 * DATA SOURCE / PERFORMANCE (§15/§26): reads the already-resident
 * data.sessions / data.tasks / data.processServerWorks arrays — the same
 * in-memory mirrors every other page (Calendar, Dashboard, Sessions,
 * Tasks, Process Server Works) already reads. No Repository call, no
 * ApiService call, no IndexedDB call, no network request is made by this
 * module. Aggregation is a plain client-side filter+join, redone on every
 * render (cheap at these record volumes, per §15's own rejection of a
 * cached/materialized alternative).
 *
 * NAVIGATION (§15 of the brief / read-only, not a write): tapping a
 * Work Item navigates to its existing source page and opens that source's
 * own existing, unmodified entry point:
 *     session              -> navigate('sessions')            + editSession(idx)
 *     administrativeWork   -> navigate('tasks')                + editTask(idx)
 *     processServerWork    -> navigate('processServerWorks')   + viewProcessServerWork(idx)
 * (viewProcessServerWork() is itself a pure read-only viewer — see
 * process-server-works.js's own header — so it is preferred there over
 * the edit modal.) None of these three functions is modified here; they
 * are called exactly as sessions.js/tasks.js/process-server-works.js's own
 * edit-pencil buttons already call them today.
 *
 * DOES NOT TOUCH (per AGENDA-1 scope — see implementation brief §18–§25):
 *   - js/modules/calendar.js — left completely untouched; #page-calendar
 *     and its التقويم nav item remain available exactly as before.
 *   - js/modules/sessions.js / tasks.js / process-server-works.js /
 *     dashboard.js — read-only consumer of their data/constants/functions.
 *   - SyncCoordinator/SyncEngine/OfflineQueue/Repository.js, RBAC engine,
 *     license, FCM/NotificationManager/service-worker.js, IndexedDB schema
 *     (DB_VERSION unchanged), any Google Sheet.
 *
 * Depends on (globals expected to already be loaded — see index.html's
 * script order: this file loads after sessions.js, tasks.js,
 * process-server-works.js, administrative-work-fields.js):
 *   - data                        : shared app data object — reads
 *                                    data.sessions / data.tasks /
 *                                    data.processServerWorks only.
 *   - SESSIONS_ID_FIELD, TASKS_ID_FIELD, PSW_ID_FIELD : ID-field name
 *                                    constants declared by sessions.js /
 *                                    tasks.js / process-server-works.js.
 *   - editSession(i), editTask(i), viewProcessServerWork(i) : existing,
 *                                    unmodified navigation entry points.
 *   - navigate(page)              : existing page router (index.html).
 *   - parseLocalDate(), pad(), formatTime(), formatDate() : ui-utils.js.
 *   - toast()                     : existing toast helper (index.html).
 *
 * Writes to (DOM only — never to `data`, never to storage):
 *   #agendaTabDay/#agendaTabWeek/#agendaTabCustom, #agendaNavRow,
 *   #agendaNavTitle, #agendaRangeForm, #agendaRangeFrom/#agendaRangeTo,
 *   #agendaContent.
 * ================================================================
 */

'use strict';

// ================================================================
// STATE — module-local view state. Not part of `data`; nothing here is
// ever persisted, synced, or read by any other module.
// ================================================================

var agendaMode        = 'day';   // 'day' | 'week' | 'custom'
var agendaDayCursor    = new Date();   // pivot date for 'day' mode
var agendaWeekCursor   = new Date();   // any date inside the displayed week
var agendaRangeFromVal = null;         // Date | null — 'custom' mode
var agendaRangeToVal   = null;         // Date | null — 'custom' mode

// ================================================================
// AGENDA-2 — Agenda Metadata: assignment + execution status.
// ================================================================
// Writes ONLY to the new 'agendaMetadata' store (and its Sheet
// 'أجندة_البيانات_الوصفية' via ApiService.syncRow). The single exception,
// mandated by closure spec §6, is Administrative Works: Agenda
// COMPLETED/reopen calls the EXISTING toggleTask(i) so the source task's
// own الحالة flips through its own function (Undo/History keep working).
// Sessions and Process Server Works are NEVER written to. BLOCKED never
// writes to any source.
//
// GLOBAL NAMES — 'agendaMetadataRepository' and
// 'agendaMetadataRepositoryReadyPromise' are deliberately global `var`s:
// SyncEngine.js (_applyPage) and settings.js (loadFromSheets) resolve
// window[key + 'Repository'] / window[key + 'RepositoryReadyPromise'].

var AGENDA_SHEET_NAME = 'أجندة_البيانات_الوصفية';
var AGENDA_STATUS_LABELS = {
  NOT_STARTED: 'لم يبدأ', IN_PROGRESS: 'قيد التنفيذ', BLOCKED: 'متوقف', COMPLETED: 'منجز'
};

var agendaMetadataRepository = (typeof AgendaMetadataRepository === 'function')
  ? new AgendaMetadataRepository() : null;

var agendaMetadataRepositoryReadyPromise = agendaMetadataRepository
  ? agendaMetadataRepository.open().then(function () {
      syncAgendaMetadataMirror();
    }).catch(function (err) {
      console.error('[office-agenda] AgendaMetadataRepository failed to open:', err);
    })
  : Promise.resolve();

function syncAgendaMetadataMirror() {
  agendaMetaIndex = null; // فهرس المعرفات يُعاد بناؤه عند أول قراءة بعد أى تحديث
  if (!agendaMetadataRepository || typeof data === 'undefined') return;
  if (!agendaMetadataRepository.isReady()) return;
  data.agendaMetadata = agendaMetadataRepository.getAll();
}

var agendaMetaIndex = null;
function agendaMetaFor(type, sourceId) {
  if (!agendaMetaIndex) {
    agendaMetaIndex = {};
    var list = (typeof data !== 'undefined' && data.agendaMetadata) || [];
    for (var k = 0; k < list.length; k++) agendaMetaIndex[list[k]['المعرف']] = list[k];
  }
  return agendaMetaIndex[agendaWorkItemId(type, sourceId)] || null;
}

/** No metadata row yet == implicit NOT_STARTED (closure spec §25, lazy migration). */
function agendaStatusOf(meta) {
  return (meta && meta['حالة_التنفيذ']) || 'NOT_STARTED';
}

/**
 * RBAC gate. Mirrors the app's documented convention (SessionContext.js):
 * with no login session the RBAC layer is inert (fail-open); with a
 * session, PermissionService.can() decides (fail-closed on error).
 */
function agendaCan(permissionKey) {
  try {
    if (typeof HossamSession === 'undefined' || typeof HossamSession.getCurrentUser !== 'function') return true;
    var user = HossamSession.getCurrentUser();
    if (!user) return true;
    if (typeof HossamPermissionService === 'undefined') return false;
    return HossamPermissionService.can(user, permissionKey) === true;
  } catch (e) {
    return false;
  }
}

function agendaCurrentUsername() {
  try {
    var u = (typeof HossamSession !== 'undefined' && HossamSession.getCurrentUser) ? HossamSession.getCurrentUser() : null;
    return (u && u['اسم_المستخدم']) || '';
  } catch (e) { return ''; }
}

var agendaUsersCache = null;
function agendaLoadUsers() {
  if (agendaUsersCache) return Promise.resolve(agendaUsersCache);
  if (typeof UsersRepository !== 'function') return Promise.resolve([]);
  var repo;
  try { repo = new UsersRepository(); } catch (e) { return Promise.resolve([]); }
  return repo.open().then(function () {
    agendaUsersCache = repo.getAll().filter(function (u) { return u['الحالة'] === 'نشط'; });
    return agendaUsersCache;
  }).catch(function () { return []; });
}

function agendaAssigneeLabel(username) {
  if (!username) return '';
  var list = agendaUsersCache || [];
  for (var i = 0; i < list.length; i++) {
    if (list[i]['اسم_المستخدم'] === username) return list[i]['الاسم'] || username;
  }
  return username;
}

/** Status chip + assignee + contextual action buttons for one Work Item. */
function agendaFooterHtml(type, sourceId) {
  var meta = agendaMetaFor(type, sourceId);
  var st = agendaStatusOf(meta);
  var assignee = meta && meta['مُسند_إلى'];
  var id = agendaEscape(sourceId);
  var btn = function (kind, label) {
    return '<button type="button" class="btn btn-ghost btn-sm agenda-act-btn" onclick="agendaAction(\'' + kind + '\',\'' + type + '\',\'' + id + '\')">' + label + '</button>';
  };
  var notes = [];
  if (meta && st === 'BLOCKED' && meta['سبب_التوقف']) notes.push('سبب التوقف: ' + agendaEscape(meta['سبب_التوقف']));
  if (meta && meta['الإجراء_التالي']) notes.push('الإجراء التالي: ' + agendaEscape(meta['الإجراء_التالي']));
  if (meta && meta['تاريخ_الإجراء_التالي']) notes.push('المتابعة في: ' + agendaEscape(formatDate(meta['تاريخ_الإجراء_التالي'])));
  if (type === 'processServerWork' && meta && meta['تاريخ_استحقاق_الأجندة']) notes.push('موعد الأجندة: ' + agendaEscape(formatDate(meta['تاريخ_استحقاق_الأجندة'])));

  var html = (notes.length ? '<div class="agenda-item-note" onclick="event.stopPropagation()">' + notes.join(' &middot; ') + '</div>' : '') +
    '<div class="agenda-item-actions" onclick="event.stopPropagation()">' +
    '<span class="agenda-status-chip st-' + st + '">' + AGENDA_STATUS_LABELS[st] + '</span>' +
    '<span class="agenda-assignee">&#128100; ' + (assignee ? agendaEscape(agendaAssigneeLabel(assignee)) : 'غير مُسند') + '</span>';
  if (agendaCan('CanAssignAgendaWork')) html += btn('assign', assignee ? 'تغيير الإسناد' : 'إسناد');
  if (agendaCan('CanChangeAgendaExecutionStatus')) {
    if (st === 'NOT_STARTED') html += btn('start', 'بدء');
    else if (st === 'IN_PROGRESS') html += btn('block', 'إيقاف') + btn('complete', 'إنجاز');
    else if (st === 'BLOCKED') html += btn('resume', 'استئناف');
    else if (st === 'COMPLETED') html += btn('reopen', 'إعادة فتح');
  }
  if (agendaCan('CanEditAgendaWork') && st !== 'COMPLETED') html += btn('edit', 'المتابعة/الموعد');
  return html + '</div>';
}

// ---- Action dialog -------------------------------------------------

var agendaPending = null;

var AGENDA_ACTION_TEXT = {
  block:    { title: 'إيقاف العمل',        label: 'سبب التوقف (إلزامي)' },
  complete: { title: 'إنجاز العمل',        label: 'ملاحظة الإنجاز (إلزامية)' },
  reopen:   { title: 'إعادة فتح العمل',    label: 'سبب إعادة الفتح (إلزامي)' }
};

function agendaSetDisplay(id, show) {
  var el = document.getElementById(id);
  if (el) el.style.display = show ? '' : 'none';
}
function agendaFieldVal(id) {
  var el = document.getElementById(id);
  return el ? String(el.value || '').trim() : '';
}

function agendaAction(kind, type, sourceId) {
  var needPerm = (kind === 'assign') ? 'CanAssignAgendaWork'
    : (kind === 'edit') ? 'CanEditAgendaWork' : 'CanChangeAgendaExecutionStatus';
  if (!agendaCan(needPerm)) {
    if (typeof toast === 'function') toast('لا تملك صلاحية تنفيذ هذا الإجراء', 'error');
    return;
  }
  agendaPending = { kind: kind, type: type, id: sourceId };

  if (kind === 'start' || kind === 'resume') { agendaApplyAction(agendaPending, ''); return; }

  ['agendaActionAssigneeWrap', 'agendaActionTextWrap', 'agendaActionNextActionWrap',
   'agendaActionNextDateWrap', 'agendaActionDueWrap'].forEach(function (w) { agendaSetDisplay(w, false); });
  var meta = agendaMetaFor(type, sourceId) || {};

  if (kind === 'assign') {
    document.getElementById('agendaActionTitle').textContent = 'إسناد العمل';
    agendaSetDisplay('agendaActionAssigneeWrap', true);
    var sel = document.getElementById('agendaActionAssignee');
    var txt = document.getElementById('agendaActionAssigneeText');
    var current = meta['مُسند_إلى'] || '';
    agendaLoadUsers().then(function (users) {
      if (users.length) {
        sel.style.display = ''; txt.style.display = 'none';
        sel.innerHTML = '<option value="">— بدون إسناد —</option>' + users.map(function (u) {
          return '<option value="' + agendaEscape(u['اسم_المستخدم']) + '">' + agendaEscape(u['الاسم'] || u['اسم_المستخدم']) + '</option>';
        }).join('');
        sel.value = current;
      } else {
        sel.style.display = 'none'; txt.style.display = '';
        txt.value = current;
      }
    });
  } else if (kind === 'edit') {
    document.getElementById('agendaActionTitle').textContent = 'المتابعة والموعد';
    agendaSetDisplay('agendaActionNextActionWrap', true);
    agendaSetDisplay('agendaActionNextDateWrap', true);
    agendaSetDisplay('agendaActionDueWrap', type === 'processServerWork'); // agendaDueDate: لأعمال المحضرين فقط (§8)
    document.getElementById('agendaActionNextAction').value = meta['الإجراء_التالي'] || '';
    document.getElementById('agendaActionNextDate').value = meta['تاريخ_الإجراء_التالي'] || '';
    document.getElementById('agendaActionDue').value = meta['تاريخ_استحقاق_الأجندة'] || '';
  } else {
    var cfg = AGENDA_ACTION_TEXT[kind];
    document.getElementById('agendaActionTitle').textContent = cfg.title;
    document.getElementById('agendaActionTextLabel').textContent = cfg.label;
    document.getElementById('agendaActionText').value = '';
    agendaSetDisplay('agendaActionTextWrap', true);
    if (kind === 'block') {
      document.getElementById('agendaActionNextAction').value = '';
      document.getElementById('agendaActionNextDate').value = '';
      agendaSetDisplay('agendaActionNextActionWrap', true);
      agendaSetDisplay('agendaActionNextDateWrap', true);
    }
  }
  document.getElementById('modalAgendaAction').classList.add('open');
}

function agendaActionSubmit() {
  if (!agendaPending) return;
  var value = '';
  var extra = null;
  if (agendaPending.kind === 'assign') {
    var sel = document.getElementById('agendaActionAssignee');
    var txt = document.getElementById('agendaActionAssigneeText');
    value = (sel.style.display === 'none') ? txt.value.trim() : sel.value;
  } else if (agendaPending.kind === 'edit') {
    extra = {
      nextAction: agendaFieldVal('agendaActionNextAction'),
      nextDate: agendaFieldVal('agendaActionNextDate'),
      due: agendaFieldVal('agendaActionDue')
    };
  } else {
    value = agendaFieldVal('agendaActionText');
    if (!value) {
      if (typeof toast === 'function') toast('هذا الحقل إلزامي', 'error');
      return;
    }
    if (agendaPending.kind === 'block') {
      extra = { nextAction: agendaFieldVal('agendaActionNextAction'), nextDate: agendaFieldVal('agendaActionNextDate') };
    }
  }
  var pending = agendaPending;
  closeModal('modalAgendaAction');
  agendaApplyAction(pending, value, extra);
}

function agendaNowIso() { return new Date().toISOString(); }

/**
 * agendaApplyAction — the ONLY write path of this module.
 *  1. (COMPLETED / reopen on an Administrative Work only) flip the source
 *     task through the existing toggleTask(); abort if it did not flip.
 *  2. upsert the agendaMetadata row via AgendaMetadataRepository.
 *  3. fire-and-forget ApiService.syncRow to the new Sheet.
 * `extra` (اختياري): block => {nextAction,nextDate}؛ edit => {nextAction,nextDate,due}.
 */
async function agendaApplyAction(pending, value, extra) {
  try {
    if (!agendaMetadataRepository) throw new Error('agendaMetadataRepository unavailable');
    await agendaMetadataRepositoryReadyPromise;
    var type = pending.type, sourceId = pending.id, kind = pending.kind;
    var meta = agendaMetaFor(type, sourceId);
    var patch = {};
    extra = extra || {};

    if (kind === 'assign') {
      patch['مُسند_إلى'] = value || '';
    } else if (kind === 'edit') {
      patch['الإجراء_التالي'] = extra.nextAction || '';
      patch['تاريخ_الإجراء_التالي'] = extra.nextDate || '';
      if (type === 'processServerWork') patch['تاريخ_استحقاق_الأجندة'] = extra.due || '';
      if (!meta && !patch['الإجراء_التالي'] && !patch['تاريخ_الإجراء_التالي'] && !patch['تاريخ_استحقاق_الأجندة']) return; // لا صف فارغ بلا سبب
    } else if (kind === 'start' || kind === 'resume') {
      patch['حالة_التنفيذ'] = 'IN_PROGRESS';
      patch['سبب_التوقف'] = '';
      if (kind === 'resume') { patch['الإجراء_التالي'] = ''; patch['تاريخ_الإجراء_التالي'] = ''; }
    } else if (kind === 'block') {
      patch['حالة_التنفيذ'] = 'BLOCKED';
      patch['سبب_التوقف'] = value;
      patch['الإجراء_التالي'] = extra.nextAction || '';
      patch['تاريخ_الإجراء_التالي'] = extra.nextDate || '';
    } else if (kind === 'complete') {
      await agendaWriteBackTask(type, sourceId, 'done');
      patch['حالة_التنفيذ'] = 'COMPLETED';
      patch['ملاحظة_الإنجاز'] = value;
      patch['تاريخ_الإنجاز'] = agendaNowIso();
      patch['أنجزها'] = agendaCurrentUsername();
      patch['الإجراء_التالي'] = '';
      patch['تاريخ_الإجراء_التالي'] = '';
    } else if (kind === 'reopen') {
      await agendaWriteBackTask(type, sourceId, 'pending');
      var prev = (meta && meta['ملاحظة_الإنجاز']) || '';
      var by = agendaCurrentUsername();
      patch['حالة_التنفيذ'] = 'IN_PROGRESS';
      patch['ملاحظة_الإنجاز'] = (prev ? prev + '\n' : '') +
        'إعادة فتح ' + agendaNowIso() + (by ? ' بواسطة ' + by : '') + ': ' + value;
      patch['تاريخ_الإنجاز'] = '';
      patch['أنجزها'] = '';
    } else {
      return;
    }

    var result = await agendaMetadataRepository.upsertForWorkItem(type, sourceId, patch);
    if (!result || !result.success) {
      throw new Error((result && result.error && result.error.message) || 'فشل حفظ بيانات الأجندة');
    }
    syncAgendaMetadataMirror();
    var list = data.agendaMetadata || [];
    var idx = -1;
    for (var i = 0; i < list.length; i++) { if (list[i]['المعرف'] === result.record['المعرف']) { idx = i; break; } }
    // idx >= 0 -> updateData, -1 -> saveData; server matches by id either way.
    if (typeof ApiService !== 'undefined' && ApiService.syncRow) {
      ApiService.syncRow(AGENDA_SHEET_NAME, result.record, meta ? idx : -1);
    }
    agendaRenderCurrent();
  } catch (err) {
    console.error('[office-agenda] agenda action failed:', err);
    if (typeof toast === 'function') toast(err && err.message ? err.message : 'تعذر تنفيذ الإجراء', 'error');
    try { agendaRenderCurrent(); } catch (e) {}
  }
}

/**
 * Closure spec §6 write-back: only Administrative Works, only through the
 * existing toggleTask(i). toggleTask FLIPS, so it is called only when the
 * source is not already in the target state; afterwards the result is
 * verified — if it did not flip, throw so no Agenda row is written.
 */
async function agendaWriteBackTask(type, sourceId, targetStatus) {
  if (type !== 'administrativeWork') return; // sessions / PSW: never written
  var idField = (typeof TASKS_ID_FIELD !== 'undefined') ? TASKS_ID_FIELD : 'رقم_المهمة';
  var idx = (data.tasks || []).findIndex(function (t) { return String(t[idField]) === String(sourceId); });
  if (idx < 0) throw new Error('تعذر العثور على العمل الإداري المصدر');
  if (data.tasks[idx]['الحالة'] === targetStatus) return; // already in the desired source state
  if (typeof toggleTask !== 'function') throw new Error('toggleTask غير متاح');
  await toggleTask(idx);
  var after = (data.tasks || []).findIndex(function (t) { return String(t[idField]) === String(sourceId); });
  if (after < 0 || data.tasks[after]['الحالة'] !== targetStatus) {
    throw new Error('تعذر تحديث حالة العمل الإداري المصدر');
  }
}

// ================================================================
// SMALL DATE HELPERS (local to this module — does not redeclare or
// shadow any ui-utils.js helper; parseLocalDate/pad/formatTime/formatDate
// are reused as-is from ui-utils.js).
// ================================================================

function agendaDateKey(d) {
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
}

function agendaSameDay(a, b) {
  return !!a && !!b && agendaDateKey(a) === agendaDateKey(b);
}

function agendaStartOfWeek(d) {
  // Week starts Sunday (getDay()===0), matching calendar.js's own
  // day-name ordering ('أح','إث','ثل','أر','خم','جم','سب').
  var r = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  r.setDate(r.getDate() - r.getDay());
  return r;
}

function agendaAddDays(d, n) {
  var r = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  r.setDate(r.getDate() + n);
  return r;
}

function agendaStartOfDay(d) {
  var r = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  r.setHours(0, 0, 0, 0);
  return r;
}

function agendaWeekdayShortLabel(d) {
  return d.toLocaleDateString('ar-EG', { weekday: 'long' });
}

function agendaDayTitleLabel(d) {
  return d.toLocaleDateString('ar-EG', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}

// ================================================================
// SOURCE-SPECIFIC DERIVATION (§14 mapping matrix — field names verified
// directly against SessionsRepository/TasksRepository/PSW's actual
// current field usage, not invented).
// ================================================================

/**
 * agendaWorkItemId — computed identity, never stored anywhere.
 * @param {string} type   'session' | 'administrativeWork' | 'processServerWork'
 * @param {string} sourceId
 */
function agendaWorkItemId(type, sourceId) {
  return type + ':' + sourceId;
}

// ---- visibility (closure spec §19) --------------------------------
function agendaIdField(type) {
  if (type === 'session') return (typeof SESSIONS_ID_FIELD !== 'undefined') ? SESSIONS_ID_FIELD : 'رقم_الجلسة';
  if (type === 'administrativeWork') return (typeof TASKS_ID_FIELD !== 'undefined') ? TASKS_ID_FIELD : 'رقم_المهمة';
  return (typeof PSW_ID_FIELD !== 'undefined') ? PSW_ID_FIELD : 'رقم_العمل';
}
function agendaIdOf(type, rec) { return rec[agendaIdField(type)]; }

function agendaCaseFor(caseNo) {
  var list = (typeof data !== 'undefined' && data.cases) || [];
  for (var i = 0; i < list.length; i++) {
    if (String(list[i]['رقم_القضية']) === String(caseNo)) return list[i];
  }
  return null;
}

/**
 * agendaVisible — نفس قاعدة §19: مع CanViewAllAgendaWork يرى الكل؛ وإلا فالعنصر
 * المرتبط بقضية يخضع لطبقة نطاق القضايا الموجودة (PermissionService.canAccessCase)،
 * وغير المرتبط بقضية يظهر لمن أُسند إليه فقط. إضافة صغيرة: من أُسند إليه عملٌ يراه
 * دائمًا. بلا مستخدم مسجّل (طبقة RBAC خاملة) يظهر كل شيء.
 */
function agendaVisible(type, rec) {
  try {
    if (typeof HossamSession === 'undefined' || typeof HossamSession.getCurrentUser !== 'function') return true;
    var user = HossamSession.getCurrentUser();
    if (!user) return true;
    if (agendaCan('CanViewAllAgendaWork')) return true;
    var m = agendaMetaFor(type, agendaIdOf(type, rec));
    if (m && m['مُسند_إلى'] && m['مُسند_إلى'] === user['اسم_المستخدم']) return true;
    var caseNo = rec['رقم_القضية'];
    if (caseNo) {
      // PermissionService.js's own contract: canAccessCase() only narrows —
      // the base CanViewCases permission must be checked first.
      if (!agendaCan('CanViewCases')) return false;
      var c = agendaCaseFor(caseNo);
      return !!(c && typeof HossamPermissionService !== 'undefined' && HossamPermissionService.canAccessCase(user, c));
    }
    return false;
  } catch (e) {
    return false;
  }
}

function agendaSourceList(type) {
  var key = (type === 'session') ? 'sessions' : (type === 'administrativeWork') ? 'tasks' : 'processServerWorks';
  var list = (typeof data !== 'undefined' && data[key]) || [];
  return list.filter(function (r) { return agendaVisible(type, r); });
}

function agendaIdsOf(type, arr, into) {
  arr.forEach(function (r) { into[agendaWorkItemId(type, agendaIdOf(type, r))] = true; });
  return into;
}
function agendaExcluding(type, arr, shown) {
  return arr.filter(function (r) { return !shown[agendaWorkItemId(type, agendaIdOf(type, r))]; });
}
function agendaItemHtml(type, rec, opts) {
  if (type === 'session') return agendaSessionItemHtml(rec);
  if (type === 'administrativeWork') return agendaAdminWorkItemHtml(rec, opts);
  return agendaPswItemHtml(rec, opts);
}

// ---- next-date reappearance (§6/§11 worked example: "إعادة الإعلان 28/9") ----
function agendaNextDateOf(type, rec) {
  var m = agendaMetaFor(type, agendaIdOf(type, rec));
  if (!m || !m['تاريخ_الإجراء_التالي'] || agendaStatusOf(m) === 'COMPLETED') return null;
  return parseLocalDate(m['تاريخ_الإجراء_التالي']);
}
function agendaNextDateOn(type, rec, day) { return agendaSameDay(agendaNextDateOf(type, rec), day); }
function agendaInRange(d, from, to) {
  if (!d) return false;
  var x = agendaStartOfDay(d);
  return x >= from && x <= to;
}

// ---- per-source derivation ----------------------------------------
/** Sessions: never overdue (§7.1). Reappear on their Agenda nextDate too. */
function agendaSessionsOn(day) {
  return agendaSourceList('session').filter(function (s) {
    return agendaSameDay(parseLocalDate(s['التاريخ']), day) || agendaNextDateOn('session', s, day);
  });
}

function agendaAdminWorksDueOn(day) {
  return agendaSourceList('administrativeWork').filter(function (t) {
    var d = t['الموعد_النهائي'] ? parseLocalDate(t['الموعد_النهائي']) : null;
    return agendaSameDay(d, day) || agendaNextDateOn('administrativeWork', t, day);
  });
}

/**
 * PSW effective deadline (§8): تاريخ_الجلسة إن وُجد، وإلا تاريخ_استحقاق_الأجندة
 * (Agenda-owned، يُضبط بـ CanEditAgendaWork)، وإلا لا موعد إطلاقًا (لا يُخترَع).
 */
function agendaPswDeadline(w) {
  if (w['تاريخ_الجلسة']) return parseLocalDate(w['تاريخ_الجلسة']);
  var m = agendaMetaFor('processServerWork', agendaIdOf('processServerWork', w));
  return (m && m['تاريخ_استحقاق_الأجندة']) ? parseLocalDate(m['تاريخ_استحقاق_الأجندة']) : null;
}

function agendaPswOn(day) {
  return agendaSourceList('processServerWork').filter(function (w) {
    return agendaSameDay(agendaPswDeadline(w), day) || agendaNextDateOn('processServerWork', w, day);
  });
}

/** BLOCKED / COMPLETED suppress "overdue" (§7): blocked has its own bucket. */
function agendaSuppressesOverdue(type, rec) {
  var st = agendaStatusOf(agendaMetaFor(type, agendaIdOf(type, rec)));
  return st === 'BLOCKED' || st === 'COMPLETED';
}

/**
 * agendaOverdueAdminWorks — نفس قاعدة dashboard.js حرفيًا (status !== 'done' AND
 * الموعد_النهائي < asOf)، مع استثناء ما هو متوقف/منجز فى الأجندة (§7).
 */
function agendaOverdueAdminWorks(asOf) {
  return agendaSourceList('administrativeWork').filter(function (t) {
    if (t['الحالة'] === 'done') return false;
    if (agendaSuppressesOverdue('administrativeWork', t)) return false;
    var d = t['الموعد_النهائي'] ? parseLocalDate(t['الموعد_النهائي']) : null;
    return d && d < asOf;
  });
}

/** PSW overdue (§7 Table 6): deadline < today AND الحالة != 'مستلم'. No deadline => never overdue. */
function agendaOverduePsw(asOf) {
  return agendaSourceList('processServerWork').filter(function (w) {
    if (w['الحالة'] === 'مستلم') return false;
    if (agendaSuppressesOverdue('processServerWork', w)) return false;
    var d = agendaPswDeadline(w);
    return d && d < asOf;
  });
}

/** PSW with no deadline at all: neutral "بانتظار الاستلام" bucket, never overdue. */
function agendaPswAwaitingNoDate() {
  return agendaSourceList('processServerWork').filter(function (w) {
    return !agendaPswDeadline(w) && w['الحالة'] !== 'مستلم' && !agendaSuppressesOverdue('processServerWork', w);
  });
}

/** Every visible, still-existing item whose Agenda status is BLOCKED and that is not already displayed. */
function agendaBlockedItems(shown) {
  var out = [];
  ['session', 'administrativeWork', 'processServerWork'].forEach(function (type) {
    agendaSourceList(type).forEach(function (rec) {
      var m = agendaMetaFor(type, agendaIdOf(type, rec));
      if (m && agendaStatusOf(m) === 'BLOCKED' && !(shown && shown[agendaWorkItemId(type, agendaIdOf(type, rec))])) {
        out.push({ type: type, rec: rec });
      }
    });
  });
  return out;
}

// ================================================================
// RENDER — item / section HTML builders. All plain string templates,
// same pattern as calendar.js's renderCalSessions()/tasks.js's row
// builders — no new templating engine, no new DOM framework.
// ================================================================

function agendaEscape(v) {
  if (typeof escapeHtml === 'function') return escapeHtml(v);
  return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}

function agendaSourceChip(type) {
  var labels = { session: 'جلسة', administrativeWork: 'عمل إداري', processServerWork: 'عمل محضرين' };
  return '<span class="agenda-source-chip src-' + type + '">' + labels[type] + '</span>';
}

function agendaSessionItemHtml(s) {
  var id = s[(typeof SESSIONS_ID_FIELD !== 'undefined') ? SESSIONS_ID_FIELD : 'رقم_الجلسة'];
  return (
    '<div class="agenda-item src-session" onclick="agendaOpenSession(\'' + agendaEscape(id) + '\')">' +
      '<div class="agenda-item-time">' + agendaEscape(formatTime(s['الوقت'])) + '</div>' +
      '<div class="agenda-item-body">' +
        '<div class="agenda-item-title">' + agendaEscape(s['عنوان_القضية'] || 'جلسة') + '</div>' +
        '<div class="agenda-item-meta">' +
          agendaSourceChip('session') +
          '<span>&#127963; ' + agendaEscape(s['المحكمة'] || '—') + '</span>' +
          (typeof statusBadge === 'function' ? statusBadge(s['الحالة']) : '') +
        '</div>' +
        (s['القرار'] ? '<div style="font-size:11px;color:var(--gold);margin-top:3px;">&#9878; ' + agendaEscape(s['القرار']) + '</div>' : '') +
        agendaFooterHtml('session', id) +
      '</div>' +
    '</div>'
  );
}

function agendaAdminWorkItemHtml(t, opts) {
  opts = opts || {};
  var id = t[(typeof TASKS_ID_FIELD !== 'undefined') ? TASKS_ID_FIELD : 'رقم_المهمة'];
  var done = t['الحالة'] === 'done';
  return (
    '<div class="agenda-item src-administrativeWork' + (opts.overdue ? ' is-overdue' : '') + '" onclick="agendaOpenTask(\'' + agendaEscape(id) + '\')">' +
      '<div class="agenda-item-time">' + (t['الموعد_النهائي'] ? agendaEscape(formatDate(t['الموعد_النهائي'])) : '—') + '</div>' +
      '<div class="agenda-item-body">' +
        '<div class="agenda-item-title' + (done ? ' done' : '') + '">' + agendaEscape(t['العنوان'] || 'عمل إداري') + '</div>' +
        '<div class="agenda-item-meta">' +
          agendaSourceChip('administrativeWork') +
          (t['اسم_الموكل'] ? '<span>&#128100; ' + agendaEscape(t['اسم_الموكل']) + '</span>' : '') +
          (t['رقم_القضية'] ? '<span>&#9878; ' + agendaEscape(t['رقم_القضية']) + '</span>' : '') +
          (opts.overdue ? '<span class="badge badge-urgent">متأخر</span>' : '') +
        '</div>' +
        agendaFooterHtml('administrativeWork', id) +
      '</div>' +
    '</div>'
  );
}

function agendaPswItemHtml(w, opts) {
  opts = opts || {};
  var id = w[(typeof PSW_ID_FIELD !== 'undefined') ? PSW_ID_FIELD : 'رقم_العمل'];
  var received = w['الحالة'] === 'مستلم';
  return (
    '<div class="agenda-item src-processServerWork' + (opts.overdue ? ' is-overdue' : '') + '" onclick="agendaOpenPsw(\'' + agendaEscape(id) + '\')">' +
      '<div class="agenda-item-time">' + (agendaPswDeadline(w) ? agendaEscape(formatDate(agendaDateKey(agendaPswDeadline(w)))) : '&#9203;') + '</div>' +
      '<div class="agenda-item-body">' +
        '<div class="agenda-item-title">' + agendaEscape(w['طبيعة_الاعلان'] || 'عمل محضرين') + '</div>' +
        '<div class="agenda-item-meta">' +
          agendaSourceChip('processServerWork') +
          (w['رقم_المحضرين'] ? '<span>&#128100; ' + agendaEscape(w['رقم_المحضرين']) + '</span>' : '') +
          (w['قلم_المحضرين'] ? '<span>' + agendaEscape(w['قلم_المحضرين']) + '</span>' : '') +
          '<span class="badge ' + (received ? 'badge-active' : 'badge-pending') + '">' + (received ? 'مستلم' : 'غير مستلم') + '</span>' +
          (opts.overdue ? '<span class="badge badge-urgent">متأخر</span>' : '') +
        '</div>' +
        agendaFooterHtml('processServerWork', id) +
      '</div>' +
    '</div>'
  );
}

function agendaSectionHtml(title, count, innerHtml, opts) {
  opts = opts || {};
  return (
    '<div class="agenda-section' + (opts.attention ? ' attention' : '') + '">' +
      '<div class="agenda-section-title"><span>' + title + '</span><span class="count">' + count + '</span></div>' +
      (count ? innerHtml : '<div class="agenda-empty">' + (opts.emptyLabel || 'لا توجد عناصر') + '</div>') +
    '</div>'
  );
}

// ================================================================
// DAY / WEEK / CUSTOM VIEWS
// ================================================================
// كل عنصر يظهر مرة واحدة فقط فى العرض الواحد: قوائم التاريخ أولًا، ثم المتأخر/المتوقف
// بعد استبعاد ما سبق عرضه (مصدر واحد = عنصر واحد، بلا تكرار).

function agendaSortByTime(list) {
  return list.slice().sort(function (a, b) { return String(a['الوقت'] || '').localeCompare(String(b['الوقت'] || '')); });
}

function agendaOverdueSectionsHtml(asOfAdmin, asOfPsw, shown, labels) {
  var html = '';
  var od = agendaExcluding('administrativeWork', agendaOverdueAdminWorks(asOfAdmin), shown);
  agendaIdsOf('administrativeWork', od, shown);
  html += agendaSectionHtml(labels.admin, od.length,
    od.map(function (t) { return agendaAdminWorkItemHtml(t, { overdue: true }); }).join(''),
    { attention: true, emptyLabel: labels.adminEmpty });
  var op = agendaExcluding('processServerWork', agendaOverduePsw(asOfPsw), shown);
  agendaIdsOf('processServerWork', op, shown);
  if (op.length) {
    html += agendaSectionHtml(labels.psw, op.length,
      op.map(function (w) { return agendaPswItemHtml(w, { overdue: true }); }).join(''), { attention: true });
  }
  return html;
}

function agendaBlockedSectionHtml(shown) {
  var blocked = agendaBlockedItems(shown);
  return agendaSectionHtml('&#9940; أعمال متوقفة', blocked.length,
    blocked.map(function (b) { return agendaItemHtml(b.type, b.rec, { overdue: false }); }).join(''),
    { attention: true, emptyLabel: 'لا توجد أعمال متوقفة' });
}

function agendaRenderDay() {
  var day = agendaStartOfDay(agendaDayCursor);
  var today = agendaStartOfDay(new Date());
  var isToday = agendaSameDay(day, today);

  document.getElementById('agendaNavTitle').textContent = agendaDayTitleLabel(day);
  document.getElementById('agendaNavTodayBtn').style.display = isToday ? 'none' : '';

  var sessions = agendaSortByTime(agendaSessionsOn(day));
  var adminWorks = agendaAdminWorksDueOn(day);
  var psw = agendaPswOn(day);
  var shown = {};
  agendaIdsOf('session', sessions, shown);
  agendaIdsOf('administrativeWork', adminWorks, shown);
  agendaIdsOf('processServerWork', psw, shown);

  var html = '';
  html += agendaSectionHtml('&#9878; جلسات ' + (isToday ? 'اليوم' : ''), sessions.length,
    sessions.map(agendaSessionItemHtml).join(''), { emptyLabel: 'لا توجد جلسات في هذا اليوم' });
  html += agendaSectionHtml('&#128203; أعمال إدارية مستحقة ' + (isToday ? 'اليوم' : ''), adminWorks.length,
    adminWorks.map(function (t) { return agendaAdminWorkItemHtml(t, { overdue: false }); }).join(''),
    { emptyLabel: 'لا توجد أعمال إدارية مستحقة' });
  html += agendaSectionHtml('&#128231; أعمال محضرين مرتبطة بموعد ' + (isToday ? 'اليوم' : 'هذا اليوم'), psw.length,
    psw.map(function (w) { return agendaPswItemHtml(w); }).join(''),
    { emptyLabel: 'لا توجد أعمال محضرين مرتبطة بهذه الفترة' });

  // "متأخر/متوقف/بانتظار الاستلام" مرتبطة بلحظة الآن، فتظهر على يوم اليوم فقط.
  if (isToday) {
    html += agendaOverdueSectionsHtml(new Date(), today, shown, {
      admin: '&#9888; أعمال إدارية متأخرة', adminEmpty: 'لا توجد أعمال إدارية متأخرة',
      psw: '&#9888; أعمال محضرين متأخرة'
    });
    var awaiting = agendaExcluding('processServerWork', agendaPswAwaitingNoDate(), shown);
    agendaIdsOf('processServerWork', awaiting, shown);
    if (awaiting.length) {
      html += agendaSectionHtml('&#128231; أعمال محضرين بانتظار الاستلام', awaiting.length,
        awaiting.map(function (w) { return agendaPswItemHtml(w); }).join(''));
    }
    html += agendaBlockedSectionHtml(shown);
  }

  document.getElementById('agendaContent').innerHTML = html;
}

function agendaRenderWeek() {
  var weekStart = agendaStartOfWeek(agendaWeekCursor);
  var weekEnd = agendaAddDays(weekStart, 6);
  var today = agendaStartOfDay(new Date());

  document.getElementById('agendaNavTitle').textContent =
    formatDate(agendaDateKey(weekStart)) + ' — ' + formatDate(agendaDateKey(weekEnd));
  document.getElementById('agendaNavTodayBtn').style.display =
    (today >= weekStart && today <= weekEnd) ? 'none' : '';

  var shown = {};
  var html = '<div class="agenda-week-grid">';
  for (var i = 0; i < 7; i++) {
    var day = agendaAddDays(weekStart, i);
    var isToday = agendaSameDay(day, today);
    var sessions = agendaSortByTime(agendaSessionsOn(day));
    var adminWorks = agendaAdminWorksDueOn(day);
    var psw = agendaPswOn(day);
    agendaIdsOf('session', sessions, shown);
    agendaIdsOf('administrativeWork', adminWorks, shown);
    agendaIdsOf('processServerWork', psw, shown);
    var total = sessions.length + adminWorks.length + psw.length;

    html +=
      '<div class="agenda-week-day">' +
        '<div class="agenda-week-day-header' + (isToday ? ' is-today' : '') + '">' +
          '<span>' + agendaWeekdayShortLabel(day) + ' — ' + formatDate(agendaDateKey(day)) + '</span>' +
          '<span class="count">' + total + '</span>' +
        '</div>' +
        (total
          ? (
              sessions.map(agendaSessionItemHtml).join('') +
              adminWorks.map(function (t) { return agendaAdminWorkItemHtml(t, { overdue: false }); }).join('') +
              psw.map(function (w) { return agendaPswItemHtml(w); }).join('')
            )
          : '<div class="agenda-week-day-empty">لا يوجد عمل مجدول</div>'
        ) +
      '</div>';
  }
  html += '</div>';

  // المتأخر قبل بداية الأسبوع (§11.2) بنفس القاعدة الوحيدة، ثم المتوقف.
  html += agendaOverdueSectionsHtml(weekStart, weekStart, shown, {
    admin: '&#9888; متأخر (قبل هذا الأسبوع)', adminEmpty: 'لا توجد أعمال إدارية متأخرة قبل هذا الأسبوع',
    psw: '&#9888; أعمال محضرين متأخرة (قبل هذا الأسبوع)'
  });
  html += agendaBlockedSectionHtml(shown);

  document.getElementById('agendaContent').innerHTML = html;
}

function agendaRenderCustom() {
  if (!agendaRangeFromVal || !agendaRangeToVal) {
    document.getElementById('agendaContent').innerHTML =
      '<div class="agenda-empty">اختر تاريخ البداية والنهاية ثم اضغط «تطبيق»</div>';
    return;
  }

  var from = agendaStartOfDay(agendaRangeFromVal);
  var to = agendaStartOfDay(agendaRangeToVal);
  if (from > to) { var tmp = from; from = to; to = tmp; }

  var sessions = agendaSourceList('session').filter(function (s) {
    return agendaInRange(parseLocalDate(s['التاريخ']), from, to) || agendaInRange(agendaNextDateOf('session', s), from, to);
  }).sort(function (a, b) { return String(a['التاريخ']).localeCompare(String(b['التاريخ'])); });

  var adminWorks = agendaSourceList('administrativeWork').filter(function (t) {
    var d = t['الموعد_النهائي'] ? parseLocalDate(t['الموعد_النهائي']) : null;
    return agendaInRange(d, from, to) || agendaInRange(agendaNextDateOf('administrativeWork', t), from, to);
  });

  var psw = agendaSourceList('processServerWork').filter(function (w) {
    return agendaInRange(agendaPswDeadline(w), from, to) || agendaInRange(agendaNextDateOf('processServerWork', w), from, to);
  });

  var shown = {};
  agendaIdsOf('session', sessions, shown);
  agendaIdsOf('administrativeWork', adminWorks, shown);
  agendaIdsOf('processServerWork', psw, shown);

  var html = '';
  html += agendaSectionHtml('&#9878; جلسات', sessions.length, sessions.map(agendaSessionItemHtml).join(''),
    { emptyLabel: 'لا توجد جلسات في هذه الفترة' });
  html += agendaSectionHtml('&#128203; أعمال إدارية', adminWorks.length,
    adminWorks.map(function (t) { return agendaAdminWorkItemHtml(t, { overdue: false }); }).join(''),
    { emptyLabel: 'لا توجد أعمال إدارية مستحقة في هذه الفترة' });
  html += agendaSectionHtml('&#128231; أعمال محضرين', psw.length,
    psw.map(function (w) { return agendaPswItemHtml(w); }).join(''),
    { emptyLabel: 'لا توجد أعمال محضرين مرتبطة بهذه الفترة' });

  html += agendaOverdueSectionsHtml(from, from, shown, {
    admin: '&#9888; متأخر (قبل بداية الفترة)', adminEmpty: 'لا توجد أعمال إدارية متأخرة قبل بداية الفترة',
    psw: '&#9888; أعمال محضرين متأخرة (قبل بداية الفترة)'
  });
  html += agendaBlockedSectionHtml(shown);

  document.getElementById('agendaContent').innerHTML = html;
}

// ================================================================
// MODE / NAVIGATION CONTROLS
// ================================================================

function agendaUpdateTabsUI() {
  var map = { day: 'agendaTabDay', week: 'agendaTabWeek', custom: 'agendaTabCustom' };
  Object.keys(map).forEach(function (m) {
    var el = document.getElementById(map[m]);
    if (el) el.classList.toggle('active', m === agendaMode);
  });
  var navRow = document.getElementById('agendaNavRow');
  var rangeForm = document.getElementById('agendaRangeForm');
  if (navRow) navRow.style.display = (agendaMode === 'day' || agendaMode === 'week') ? '' : 'none';
  if (rangeForm) rangeForm.style.display = (agendaMode === 'custom') ? '' : 'none';
}

function agendaSetMode(mode) {
  agendaMode = mode;
  agendaUpdateTabsUI();
  agendaRenderCurrent();
}

function agendaRenderDenied() {
  var navRow = document.getElementById('agendaNavRow');
  var rangeForm = document.getElementById('agendaRangeForm');
  if (navRow) navRow.style.display = 'none';
  if (rangeForm) rangeForm.style.display = 'none';
  document.getElementById('agendaContent').innerHTML =
    '<div class="agenda-empty">لا تملك صلاحية عرض أجندة المكتب (CanViewAgenda). تواصل مع مدير النظام.</div>';
}

function agendaRenderCurrent() {
  if (!agendaCan('CanViewAgenda')) { agendaRenderDenied(); return; }
  if (agendaMode === 'day') agendaRenderDay();
  else if (agendaMode === 'week') agendaRenderWeek();
  else agendaRenderCustom();
}

function agendaNavPrev() {
  if (agendaMode === 'day') { agendaDayCursor = agendaAddDays(agendaDayCursor, -1); agendaRenderDay(); }
  else if (agendaMode === 'week') { agendaWeekCursor = agendaAddDays(agendaWeekCursor, -7); agendaRenderWeek(); }
}

function agendaNavNext() {
  if (agendaMode === 'day') { agendaDayCursor = agendaAddDays(agendaDayCursor, 1); agendaRenderDay(); }
  else if (agendaMode === 'week') { agendaWeekCursor = agendaAddDays(agendaWeekCursor, 7); agendaRenderWeek(); }
}

function agendaNavToday() {
  var now = new Date();
  if (agendaMode === 'day') { agendaDayCursor = now; agendaRenderDay(); }
  else if (agendaMode === 'week') { agendaWeekCursor = now; agendaRenderWeek(); }
}

function agendaApplyCustomRange() {
  var fromEl = document.getElementById('agendaRangeFrom');
  var toEl = document.getElementById('agendaRangeTo');
  var fromVal = fromEl ? fromEl.value : '';
  var toVal = toEl ? toEl.value : '';
  if (!fromVal || !toVal) {
    if (typeof toast === 'function') toast('اختر تاريخ البداية والنهاية', 'error');
    return;
  }
  agendaRangeFromVal = parseLocalDate(fromVal);
  agendaRangeToVal = parseLocalDate(toVal);
  agendaRenderCustom();
}

// ================================================================
// SOURCE NAVIGATION — read-only: opens the existing source page's own
// existing entry point. Never writes anything itself.
// ================================================================

function agendaOpenSession(sourceId) {
  var idField = (typeof SESSIONS_ID_FIELD !== 'undefined') ? SESSIONS_ID_FIELD : 'رقم_الجلسة';
  var idx = (data.sessions || []).findIndex(function (s) { return String(s[idField]) === String(sourceId); });
  navigate('sessions');
  if (idx >= 0 && typeof editSession === 'function') {
    try { editSession(idx); } catch (e) { console.error('[office-agenda] تعذر فتح الجلسة:', e); }
  }
}

function agendaOpenTask(sourceId) {
  var idField = (typeof TASKS_ID_FIELD !== 'undefined') ? TASKS_ID_FIELD : 'رقم_المهمة';
  var idx = (data.tasks || []).findIndex(function (t) { return String(t[idField]) === String(sourceId); });
  navigate('tasks');
  if (idx >= 0 && typeof editTask === 'function') {
    try { editTask(idx); } catch (e) { console.error('[office-agenda] تعذر فتح العمل الإداري:', e); }
  }
}

function agendaOpenPsw(sourceId) {
  var idField = (typeof PSW_ID_FIELD !== 'undefined') ? PSW_ID_FIELD : 'رقم_العمل';
  var idx = (data.processServerWorks || []).findIndex(function (w) { return String(w[idField]) === String(sourceId); });
  navigate('processServerWorks');
  if (idx >= 0 && typeof viewProcessServerWork === 'function') {
    try { viewProcessServerWork(idx); } catch (e) { console.error('[office-agenda] تعذر فتح عمل المحضرين:', e); }
  }
}

// ================================================================
// ENTRY POINT — called by navigate()'s officeAgenda branch (index.html).
// ================================================================

/**
 * renderOfficeAgenda — page entry point. Resets the day/week cursors to
 * "now" on every page visit (same convention as navigate()'s calendar
 * branch resetting calYear/calMonth), fails gracefully on any unexpected
 * error (§17 — no crash, no fabricated data, reuses the existing toast()
 * mechanism) and performs ZERO writes to `data` or storage.
 */
function renderOfficeAgenda() {
  try {
    agendaDayCursor = new Date();
    agendaWeekCursor = new Date();
    agendaUsersCache = null;
    agendaMetaIndex = null;
    syncAgendaMetadataMirror();
    agendaUpdateTabsUI();
    agendaRenderCurrent();
    // First visit before the repository finished opening: render again
    // once it is ready (its rows were not yet in the mirror above).
    if (agendaMetadataRepository && !agendaMetadataRepository.isReady()) {
      agendaMetadataRepositoryReadyPromise.then(function () {
        syncAgendaMetadataMirror();
        agendaRenderCurrent();
      });
    }
    // Load users once so assignee names render as full names.
    agendaLoadUsers().then(function (u) { if (u.length) agendaRenderCurrent(); });
  } catch (err) {
    console.error('[office-agenda] تعذر عرض أجندة المكتب:', err);
    var el = document.getElementById('agendaContent');
    if (el) {
      el.innerHTML = '<div class="agenda-empty">تعذر عرض الأجندة بسبب خطأ غير متوقع. جرّب تحديث الصفحة.</div>';
    }
    if (typeof toast === 'function') { try { toast('حدث خطأ أثناء عرض أجندة المكتب', 'error'); } catch (e) {} }
  }
}
