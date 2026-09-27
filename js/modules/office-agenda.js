/**
 * ================================================================
 * js/modules/office-agenda.js — أجندة المكتب | نظام الحسام للمحاماة
 * ================================================================
 * AGENDA-1 — Read-Only Derived Agenda.
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

/**
 * agendaSessionsOn — sessions whose التاريخ falls on the given day.
 * Never marked overdue, regardless of how far in the past/future `day` is
 * (§7.1 — a past session is a historical event, not a missed deadline).
 */
function agendaSessionsOn(day) {
  return (data.sessions || []).filter(function (s) {
    var d = parseLocalDate(s['التاريخ']);
    return agendaSameDay(d, day);
  });
}

/**
 * agendaAdminWorksDueOn — administrative works whose الموعد_النهائي falls
 * on the given day (regardless of done/pending status — status is shown
 * via the existing .task-text.done styling, not filtered out here).
 */
function agendaAdminWorksDueOn(day) {
  return (data.tasks || []).filter(function (t) {
    var d = t['الموعد_النهائي'] ? parseLocalDate(t['الموعد_النهائي']) : null;
    return agendaSameDay(d, day);
  });
}

/**
 * agendaOverdueAdminWorks — EXACT same rule as dashboard.js's
 * renderAlertsCenter() overdueTasks filter: status !== 'done' AND
 * الموعد_النهائي < asOf. Reused verbatim (not a second competing
 * definition), scoped to items due strictly before `asOf`.
 */
function agendaOverdueAdminWorks(asOf) {
  return (data.tasks || []).filter(function (t) {
    if (t['الحالة'] === 'done') return false;
    var d = t['الموعد_النهائي'] ? parseLocalDate(t['الموعد_النهائي']) : null;
    return d && d < asOf;
  });
}

/**
 * agendaPswOn — process server works whose تاريخ_الجلسة falls on the
 * given day. PSW records with no تاريخ_الجلسة are never matched here
 * (§5.3/§8 — no invented deadline).
 */
function agendaPswOn(day) {
  return (data.processServerWorks || []).filter(function (w) {
    if (!w['تاريخ_الجلسة']) return false;
    var d = parseLocalDate(w['تاريخ_الجلسة']);
    return agendaSameDay(d, day);
  });
}

/**
 * agendaPswAwaitingNoDate — process server works with no تاريخ_الجلسة at
 * all, still غير مستلم. Shown as a neutral, non-date-tied bucket (§7.3 —
 * never labeled overdue, never given an invented date).
 */
function agendaPswAwaitingNoDate() {
  return (data.processServerWorks || []).filter(function (w) {
    return !w['تاريخ_الجلسة'] && w['الحالة'] !== 'مستلم';
  });
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
      '</div>' +
    '</div>'
  );
}

function agendaPswItemHtml(w, opts) {
  opts = opts || {};
  var id = w[(typeof PSW_ID_FIELD !== 'undefined') ? PSW_ID_FIELD : 'رقم_العمل'];
  var received = w['الحالة'] === 'مستلم';
  return (
    '<div class="agenda-item src-processServerWork" onclick="agendaOpenPsw(\'' + agendaEscape(id) + '\')">' +
      '<div class="agenda-item-time">' + (w['تاريخ_الجلسة'] ? agendaEscape(formatDate(w['تاريخ_الجلسة'])) : '&#9203;') + '</div>' +
      '<div class="agenda-item-body">' +
        '<div class="agenda-item-title">' + agendaEscape(w['طبيعة_الاعلان'] || 'عمل محضرين') + '</div>' +
        '<div class="agenda-item-meta">' +
          agendaSourceChip('processServerWork') +
          (w['رقم_المحضرين'] ? '<span>&#128100; ' + agendaEscape(w['رقم_المحضرين']) + '</span>' : '') +
          (w['قلم_المحضرين'] ? '<span>' + agendaEscape(w['قلم_المحضرين']) + '</span>' : '') +
          '<span class="badge ' + (received ? 'badge-active' : 'badge-pending') + '">' + (received ? 'مستلم' : 'غير مستلم') + '</span>' +
        '</div>' +
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
// DAY VIEW
// ================================================================

function agendaRenderDay() {
  var day = agendaStartOfDay(agendaDayCursor);
  var today = agendaStartOfDay(new Date());
  var isToday = agendaSameDay(day, today);

  document.getElementById('agendaNavTitle').textContent = agendaDayTitleLabel(day);
  document.getElementById('agendaNavTodayBtn').style.display = isToday ? 'none' : '';

  var sessions = agendaSessionsOn(day);
  var adminWorks = agendaAdminWorksDueOn(day);
  var psw = agendaPswOn(day);

  var html = '';
  html += agendaSectionHtml(
    '&#9878; جلسات ' + (isToday ? 'اليوم' : ''), sessions.length,
    sessions.sort(function (a, b) { return (a['الوقت'] || '').localeCompare(b['الوقت'] || ''); })
      .map(agendaSessionItemHtml).join(''),
    { emptyLabel: 'لا توجد جلسات في هذا اليوم' }
  );

  html += agendaSectionHtml(
    '&#128203; أعمال إدارية مستحقة ' + (isToday ? 'اليوم' : ''), adminWorks.length,
    adminWorks.map(function (t) { return agendaAdminWorkItemHtml(t, { overdue: false }); }).join(''),
    { emptyLabel: 'لا توجد أعمال إدارية مستحقة' }
  );

  html += agendaSectionHtml(
    '&#128231; أعمال محضرين مرتبطة بموعد ' + (isToday ? 'اليوم' : 'هذا اليوم'), psw.length,
    psw.map(function (w) { return agendaPswItemHtml(w); }).join(''),
    { emptyLabel: 'لا توجد أعمال محضرين مرتبطة بهذه الفترة' }
  );

  // "متأخر" — reuses the exact existing dashboard rule (§7.2). Only shown
  // on the 'today' pivot, since "overdue as of now" only makes sense
  // relative to the real current moment, not an arbitrary browsed day.
  if (isToday) {
    var overdue = agendaOverdueAdminWorks(new Date());
    html += agendaSectionHtml(
      '&#9888; أعمال إدارية متأخرة', overdue.length,
      overdue.map(function (t) { return agendaAdminWorkItemHtml(t, { overdue: true }); }).join(''),
      { emptyLabel: 'لا توجد أعمال إدارية متأخرة' }
    );

    var awaiting = agendaPswAwaitingNoDate();
    if (awaiting.length) {
      html += agendaSectionHtml(
        '&#128231; أعمال محضرين بانتظار الاستلام', awaiting.length,
        awaiting.map(function (w) { return agendaPswItemHtml(w); }).join('')
      );
    }
  }

  document.getElementById('agendaContent').innerHTML = html;
}

// ================================================================
// WEEK VIEW
// ================================================================

function agendaRenderWeek() {
  var weekStart = agendaStartOfWeek(agendaWeekCursor);
  var weekEnd = agendaAddDays(weekStart, 6);
  var today = agendaStartOfDay(new Date());

  document.getElementById('agendaNavTitle').textContent =
    formatDate(agendaDateKey(weekStart)) + ' — ' + formatDate(agendaDateKey(weekEnd));
  document.getElementById('agendaNavTodayBtn').style.display =
    (today >= weekStart && today <= weekEnd) ? 'none' : '';

  var html = '<div class="agenda-week-grid">';
  for (var i = 0; i < 7; i++) {
    var day = agendaAddDays(weekStart, i);
    var isToday = agendaSameDay(day, today);
    var sessions = agendaSessionsOn(day);
    var adminWorks = agendaAdminWorksDueOn(day);
    var psw = agendaPswOn(day);
    var total = sessions.length + adminWorks.length + psw.length;

    html +=
      '<div class="agenda-week-day">' +
        '<div class="agenda-week-day-header' + (isToday ? ' is-today' : '') + '">' +
          '<span>' + agendaWeekdayShortLabel(day) + ' — ' + formatDate(agendaDateKey(day)) + '</span>' +
          '<span class="count">' + total + '</span>' +
        '</div>' +
        (total
          ? (
              sessions.sort(function (a, b) { return (a['الوقت'] || '').localeCompare(b['الوقت'] || ''); }).map(agendaSessionItemHtml).join('') +
              adminWorks.map(function (t) { return agendaAdminWorkItemHtml(t, { overdue: false }); }).join('') +
              psw.map(function (w) { return agendaPswItemHtml(w); }).join('')
            )
          : '<div class="agenda-week-day-empty">لا يوجد عمل مجدول</div>'
        ) +
      '</div>';
  }
  html += '</div>';

  // Overdue Administrative Works that fall strictly before this week —
  // surfaced separately (§11.2) rather than silently lost, using the
  // exact same overdue rule as the Day view / dashboard.js.
  var overdueBeforeWeek = agendaOverdueAdminWorks(weekStart);
  html += agendaSectionHtml(
    '&#9888; متأخر (قبل هذا الأسبوع)', overdueBeforeWeek.length,
    overdueBeforeWeek.map(function (t) { return agendaAdminWorkItemHtml(t, { overdue: true }); }).join(''),
    { emptyLabel: 'لا توجد أعمال إدارية متأخرة قبل هذا الأسبوع' }
  );

  document.getElementById('agendaContent').innerHTML = html;
}

// ================================================================
// CUSTOM RANGE VIEW
// ================================================================

function agendaRenderCustom() {
  if (!agendaRangeFromVal || !agendaRangeToVal) {
    document.getElementById('agendaContent').innerHTML =
      '<div class="agenda-empty">اختر تاريخ البداية والنهاية ثم اضغط «تطبيق»</div>';
    return;
  }

  var from = agendaStartOfDay(agendaRangeFromVal);
  var to = agendaStartOfDay(agendaRangeToVal);
  if (from > to) { var tmp = from; from = to; to = tmp; }

  var sessions = (data.sessions || []).filter(function (s) {
    var d = parseLocalDate(s['التاريخ']);
    return d && agendaStartOfDay(d) >= from && agendaStartOfDay(d) <= to;
  }).sort(function (a, b) { return String(a['التاريخ']).localeCompare(String(b['التاريخ'])); });

  var adminWorks = (data.tasks || []).filter(function (t) {
    var d = t['الموعد_النهائي'] ? parseLocalDate(t['الموعد_النهائي']) : null;
    return d && agendaStartOfDay(d) >= from && agendaStartOfDay(d) <= to;
  });

  var psw = (data.processServerWorks || []).filter(function (w) {
    if (!w['تاريخ_الجلسة']) return false;
    var d = parseLocalDate(w['تاريخ_الجلسة']);
    return d && agendaStartOfDay(d) >= from && agendaStartOfDay(d) <= to;
  });

  var html = '';
  html += agendaSectionHtml('&#9878; جلسات', sessions.length, sessions.map(agendaSessionItemHtml).join(''),
    { emptyLabel: 'لا توجد جلسات في هذه الفترة' });
  html += agendaSectionHtml('&#128203; أعمال إدارية', adminWorks.length,
    adminWorks.map(function (t) { return agendaAdminWorkItemHtml(t, { overdue: false }); }).join(''),
    { emptyLabel: 'لا توجد أعمال إدارية مستحقة في هذه الفترة' });
  html += agendaSectionHtml('&#128231; أعمال محضرين', psw.length,
    psw.map(function (w) { return agendaPswItemHtml(w); }).join(''),
    { emptyLabel: 'لا توجد أعمال محضرين مرتبطة بهذه الفترة' });

  // Overdue Administrative Works before the range start — same treatment
  // as the Week view, using the one shared overdue rule.
  var overdueBeforeRange = agendaOverdueAdminWorks(from);
  html += agendaSectionHtml(
    '&#9888; متأخر (قبل بداية الفترة)', overdueBeforeRange.length,
    overdueBeforeRange.map(function (t) { return agendaAdminWorkItemHtml(t, { overdue: true }); }).join(''),
    { emptyLabel: 'لا توجد أعمال إدارية متأخرة قبل بداية الفترة' }
  );

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

function agendaRenderCurrent() {
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
    agendaUpdateTabsUI();
    agendaRenderCurrent();
  } catch (err) {
    console.error('[office-agenda] تعذر عرض أجندة المكتب:', err);
    var el = document.getElementById('agendaContent');
    if (el) {
      el.innerHTML = '<div class="agenda-empty">تعذر عرض الأجندة بسبب خطأ غير متوقع. جرّب تحديث الصفحة.</div>';
    }
    if (typeof toast === 'function') { try { toast('حدث خطأ أثناء عرض أجندة المكتب', 'error'); } catch (e) {} }
  }
}
