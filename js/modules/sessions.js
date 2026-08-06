/**
 * ================================================================
 * js/modules/sessions.js — وحدة الجلسات | نظام الحسام للمحاماة
 * ================================================================
 * Contains ALL Sessions-related functions extracted from index.html.
 *
 * PHASE 10 — SUB-PHASE 10.4 — Restore Rollout
 * ----------------------------------------------------------------
 * Additive-only addition on top of PHASE 9.4 below: a new
 * `restoreSession(id)` function (see its own doc comment, next to
 * `deleteSession()`), same Cases-piloted pattern (SUB-PHASE 10.3). No
 * existing function in this file was changed. See
 * docs/Restore_Rollout_Report.md for the full audit and verification
 * evidence.
 *
 * PHASE 9 — SUB-PHASE 9.4 — Repository Integration (Sessions Module)
 * ----------------------------------------------------------------
 * This module now reads and writes through js/repositories/
 * SessionsRepository.js instead of the legacy global `data.sessions`
 * array directly. Nothing else in the project was changed to make this
 * happen: SessionsRepository.js, Repository.js, DatabaseService.js and
 * LocalStorageAdapter.js are all used exactly as PHASE 5/PHASE 8 left
 * them (no edits, no imports of internals). This follows the same
 * proven pattern used for the Documents module in SUB-PHASE 9.3.
 *
 * WHY `data.sessions` STILL EXISTS BELOW
 *   js/modules/calendar.js (`data.sessions` — read-only calendar view),
 *   js/modules/dashboard.js (`data.sessions.filter(...)` / `.length` for
 *   badges/upcoming-list), and js/modules/cases.js
 *   (`data.sessions.filter(...)` twice, per-case session lists) all read
 *   the global `data.sessions` array directly, and this phase's mandate
 *   is "Modify ONLY sessions.js" — none of those Modules may be touched.
 *   So `data.sessions` is kept alive as a read-only MIRROR of
 *   `SessionsRepository.getAll()`, refreshed after every Repository
 *   read/write this file performs. Every other module keeps working
 *   unmodified and unaware that Sessions moved to the Repository.
 *
 * READ / WRITE SPLIT (this phase's rule)
 *   - Reads (`renderSessions`) call the Repository's SYNCHRONOUS methods
 *     only (`getAll()`, `search()`) — no unnecessary async.
 *   - Writes (`saveSession`, `deleteSession`) are the ONLY functions in
 *     this file that cross the async boundary, because
 *     Repository.create()/update()/delete() are Promise-returning
 *     (Repository Contract §3 — Validate -> Write Local -> Persist).
 *   - `editSession` stays 100% synchronous and unchanged: it only reads
 *     the already-synced `data.sessions` mirror to pre-fill the modal,
 *     exactly like before.
 *
 * INDEX -> RECORD -> ID TRANSLATION LAYER
 *   The rendered HTML still embeds plain 0-based array indexes in its
 *   `onclick="editSession(N)"` / `onclick="deleteSession(N)"` attributes
 *   (index.html's row templates were not changed, per this phase's rule
 *   "Do NOT change generated HTML unless absolutely necessary"). Because
 *   SessionsRepository.search()/getAll() return CLONED records (not the
 *   same object references `data.sessions` used to hold), the old
 *   `data.sessions.indexOf(s)` reference-equality trick no longer works.
 *   `resolveSessionIndex()` below is the smallest possible replacement:
 *   it looks a record up in the current mirror by its identifier field
 *   (`رقم_الجلسة`) instead of by reference. `editSession(i)` /
 *   `deleteSession(i)` then resolve that same index back to a record,
 *   and only `deleteSession`/`saveSession` go one step further and
 *   resolve the record to its `رقم_الجلسة` id before calling
 *   `SessionsRepository.update()/delete()` (both take an id, not an
 *   index).
 *
 * SOFT DELETE — OBSERVABLE BEHAVIOR NOTE
 *   SessionsRepository is configured with `softDelete: true` (unchanged,
 *   not this phase's decision to make). `delete(id)` therefore keeps the
 *   record in storage with a `deletedAt` stamp instead of physically
 *   removing it, unlike the original `data.sessions.splice(i,1)`.
 *   `getAll()`/`search()` both exclude soft-deleted records by default,
 *   so nothing deleted ever reappears anywhere `data.sessions` is read
 *   (this file, calendar.js, dashboard.js, cases.js) — the UI-observable
 *   behavior is therefore identical to a hard delete. See
 *   docs/Sessions_Repository_Integration_Report.md §5 for the full
 *   analysis of what this means for the raw localStorage payload.
 *
 * IDENTIFIER GENERATION NOTE
 *   The original inline `saveSession()` stamped
 *   `obj['رقم_الجلسة'] = obj['رقم_الجلسة'] || uid();` on the plain object
 *   before pushing/assigning it. `SessionsRepository._resolveId()`
 *   (js/repositories/SessionsRepository.js) already replicates this exact
 *   fallback internally on `create()` (generate only when absent), so
 *   this module does not need to duplicate that stamp — `create(obj)`
 *   assigns the id itself, exactly as `saveDocument()` in the Documents
 *   integration relies on `DocumentsRepository.create()` to assign
 *   `رقم_المستند`.
 *
 * SEARCH / FILTER / SORT — all three UI behaviors
 *   (`#searchSessions` free-text join, `#filterSessionStatus` exact-match
 *   on `الحالة`, ascending sort by `التاريخ`) are preserved bit-for-bit:
 *   `SessionsRepository._matchesSearch()` replicates the exact
 *   `Object.values(x).join(' ')` free-text join the inline module used,
 *   and `renderSessions()` below passes the same status filter and the
 *   same single-field ascending date sort through the Repository's
 *   generic `search({search, filter, sort})` Query Model instead of
 *   doing it in plain JS.
 *
 * Depends on (globals expected from index.html / prior scripts):
 *   - data              : shared app data object  { sessions, cases, … }
 *   - editIdx           : shared edit-index map   { sessions: -1 }
 *   - ApiService        : api.js layer (replaces direct syncToSheets /
 *                         syncDeleteToSheets calls)
 *   - saveLocal()       : localStorage persistence helper
 *   - toast()           : UI notification helper
 *   - updateBadges()    : badge counter updater
 *   - closeModal()      : modal close helper
 *   - populateCaseDropdown() : defined in cases.js
 *   - autofillSessionFromCase(): defined in cases.js
 *   - sanitizeTime()    : time-string normalizer (from ui-utils.js)
 *   - formatTime()      : time formatter          (from ui-utils.js)
 *   - formatDate()      : date formatter          (from ui-utils.js)
 *   - parseLocalDate()  : date parser             (from ui-utils.js)
 *   - urgencyBadge()    : urgency badge builder   (from ui-utils.js)
 *   - statusBadge()     : status badge builder    (from ui-utils.js)
 *   - val()             : getElementById+.value   (from ui-utils.js)
 *   - uid()             : unique-ID generator     (from ui-utils.js)
 *   - collectForm()     : generic form-to-object  (from ui-utils.js)
 *   - fillForm()        : generic object-to-form  (from ui-utils.js)
 *   - SessionsRepository : js/repositories/SessionsRepository.js
 *                          (loaded the same dual Node/browser way every
 *                          Repository file already loads its own
 *                          dependencies)
 *
 * GAS Sheet name: 'الجلسات'
 *
 * Does NOT touch:
 *   - CSS / HTML structure
 *   - Other modules (cases, clients, documents, tasks, fees, calendar,
 *     dashboard, …)
 *   - Google Apps Script backend
 *   - Database / sheet structure
 *   - ApiService internals
 *   - js/core/Repository.js, DatabaseService.js, StorageAdapter.js,
 *     LocalStorageAdapter.js, js/repositories/SessionsRepository.js
 * ================================================================
 */

'use strict';

// ================================================================
// FIELDS & MAP — sessions slice only (unchanged)
// ================================================================

var SESSIONS_FIELDS = [
  'fSessionCaseNum',
  'fSessionCaseTitle',
  'fSessionCaseType',
  'fSessionCourt',
  'fSessionCircuit',
  'fSessionRoom',
  'fSessionDate',
  'fSessionTime',
  'fSessionJudge',
  'fSessionStatus',
  'fSessionWhat',
  'fSessionDecision',
  'fSessionNextDate',
  'fSessionNotes'
];

var SESSIONS_MAP = {
  fSessionCaseNum:   'رقم_القضية',
  fSessionCaseTitle: 'عنوان_القضية',
  fSessionCaseType:  'نوع_الدعوى',
  fSessionCourt:     'المحكمة',
  fSessionCircuit:   'رقم_الدائرة',
  fSessionRoom:      'رقم_القاعة',
  fSessionDate:      'التاريخ',
  fSessionTime:      'الوقت',
  fSessionJudge:     'القاضي',
  fSessionStatus:    'الحالة',
  fSessionWhat:      'ما_تم_في_الجلسة',
  fSessionDecision:  'القرار',
  fSessionNextDate:  'التأجيل_إلى',
  fSessionNotes:     'الملاحظات'
};

/**
 * Identifier field name — must match SessionsRepository's own
 * SESSIONS_ID_FIELD constant exactly (js/repositories/
 * SessionsRepository.js, §1). Duplicated here rather than imported, same
 * "depends only on its own declared dependency" discipline every
 * Repository file already uses for its own local constants — this
 * file's one declared new dependency is SessionsRepository itself, not
 * its internals.
 */
var SESSIONS_ID_FIELD = 'رقم_الجلسة';

// ================================================================
// REPOSITORY WIRING — PHASE 9 / SUB-PHASE 9.4
// ================================================================
// Same dual Node/browser loading shape already used by every file under
// js/repositories/ and js/core/: `require()` when running under Node
// (module.exports exists — this is how js/tests/verify_sessions_
// repository_integration.js loads this file), otherwise the browser
// global `window.SessionsRepository` (populated once index.html's
// <script> tags load js/core/Repository.js, DatabaseService.js,
// LocalStorageAdapter.js and js/repositories/SessionsRepository.js ahead
// of this file — see Sessions_Repository_Integration_Report.md §6
// "Deployment note" for the exact tags needed; adding them to
// index.html is explicitly out of scope for this phase's "Modify ONLY
// sessions.js" mandate).

var SessionsRepositoryNS = (typeof module !== 'undefined' && module.exports)
  ? require('../repositories/SessionsRepository.js')
  : (typeof window !== 'undefined' ? window : this);

var SessionsRepository = SessionsRepositoryNS && SessionsRepositoryNS.SessionsRepository;

if (typeof SessionsRepository !== 'function') {
  throw new Error(
    'sessions.js requires js/repositories/SessionsRepository.js to be ' +
    'loaded first (SessionsRepository class not found).'
  );
}

/**
 * The single SessionsRepository instance this module talks to. Default
 * construction (no config) wires it to the real DatabaseService +
 * LocalStorageAdapter pair, reading/writing the exact same 'sessions'
 * localStorage key `data.sessions` always used.
 */
var sessionsRepository = new SessionsRepository();

/**
 * PHASE 12 — SUB-PHASE 12.5 — General Undo Integration.
 * js/core/UndoManager.js and js/core/UndoReconciler.js are required
 * here the same dual Node/browser way sessionsRepository is required above,
 * mirroring the exact pattern SUB-PHASE 12.4 established for
 * `casesRepository`/`casesUndoManager` in js/modules/cases.js, and
 * generalized to every entity module by this phase's pre-audit
 * (PHASE_12_5_PRE_AUDIT_Undo_Generalization.md §4/§6). Neither file is
 * modified by this phase. Degrades gracefully exactly like Cases: a
 * missing dependency disables Undo/Redo for this module only — every
 * pre-existing CRUD/render/sync/toast behavior in this file is
 * completely unaffected either way.
 */
var UndoManagerNS = (typeof module !== 'undefined' && module.exports)
  ? require('../core/UndoManager.js')
  : (typeof window !== 'undefined' ? window : this);

var UndoManager = UndoManagerNS && UndoManagerNS.UndoManager;

if (typeof UndoManager !== 'function') {
  if (typeof console !== 'undefined' && console.warn) {
    console.warn(
      'sessions.js: js/core/UndoManager.js was not found (index.html has ' +
      'not yet added its <script> tag for it). This module continues ' +
      'to work exactly as before this phase; undoLastSessionAction()/' +
      'redoLastSessionAction() will simply report nothing to undo/redo ' +
      'until this dependency is wired.'
    );
  }
  UndoManager = null;
}

var UndoReconcilerNS = (typeof module !== 'undefined' && module.exports)
  ? require('../core/UndoReconciler.js')
  : (typeof window !== 'undefined' ? window : this);

var UndoReconciler = UndoReconcilerNS && UndoReconcilerNS.UndoReconciler
  ? UndoReconcilerNS.UndoReconciler
  : UndoReconcilerNS;

if (!UndoReconciler || typeof UndoReconciler.applyUndoInstruction !== 'function') {
  if (typeof console !== 'undefined' && console.warn) {
    console.warn(
      'sessions.js: js/core/UndoReconciler.js was not found (index.html has ' +
      'not yet added its <script> tag for it). undoLastSessionAction()/' +
      'redoLastSessionAction() will simply report nothing to undo/redo ' +
      'until this dependency is wired.'
    );
  }
  UndoReconciler = null;
}

/**
 * SessionsUndoManager — PHASE 12.5: the single UndoManager instance
 * wired to `sessionsRepository` via the public `setUndoManager()` façade
 * (SUB-PHASE 12.3, js/core/Repository.js, NOT modified by this phase).
 * Each entity module constructs and wires its OWN UndoManager instance
 * — this one is never shared with any other module — so that
 * Undo/Redo history for Sessions stays completely separate from every
 * other entity's history (Phase 12.5 brief §11), exactly as already
 * true for `casesUndoManager` in js/modules/cases.js.
 */
var sessionsUndoManager = (typeof UndoManager === 'function') ? new UndoManager(sessionsRepository) : null;
if (sessionsUndoManager) {
  sessionsRepository.setUndoManager(sessionsUndoManager);
}

/**
 * Resolves once SessionsRepository.open() has loaded its initial
 * in-memory copy from storage (Repository Contract §11: Create -> Open
 * -> Ready). Every write path awaits this before touching the
 * Repository; renderSessions()/editSession() stay synchronous and
 * simply no-op if called in the vanishingly small window before this
 * resolves (see file header "READ / WRITE SPLIT").
 */
var sessionsRepositoryReadyPromise = (function () {
  var _p = sessionsRepository.open().then(function () {
    syncSessionsMirror();
  }).catch(function (err) {
    // Surface the failure without throwing out of a top-level Promise
    // chain (would otherwise be an unhandled rejection). renderSessions()
    // guards on isReady() and simply shows nothing until this is fixed.
    if (typeof console !== 'undefined' && console.error) {
      console.error('SessionsRepository failed to open:', err);
    }
  });
  // PHASE 17.0 — Startup Reliability: bound this Promise so a stuck
  // sessionsRepository.open() can never hang ensureSessionsRepositoryReady()
  // forever. See js/core/RepositoryReadyTimeout.js. Purely additive:
  // if that helper isn't loaded, _p is returned completely unwrapped.
  return (typeof RepositoryReadyTimeout !== 'undefined') ? RepositoryReadyTimeout.wrap('sessions', _p) : _p;
})();

/**
 * ensureSessionsRepositoryReady() — awaited by every write path.
 * open() itself is idempotent (Repository.prototype.open() returns
 * immediately if already 'ready'/'busy'), so calling this more than once
 * is always safe and cheap.
 * @returns {Promise<void>}
 */
function ensureSessionsRepositoryReady() {
  if (sessionsRepository.isReady()) return Promise.resolve();
  return sessionsRepositoryReadyPromise;
}

/**
 * syncSessionsMirror — refreshes the legacy global `data.sessions` array
 * from the Repository's current state (soft-deleted records excluded,
 * same as the Repository's own getAll() default). Called after open()
 * and after every create/update/delete this module performs, so
 * calendar.js / dashboard.js / cases.js keep seeing accurate data
 * without being touched themselves.
 */
function syncSessionsMirror() {
  data.sessions = sessionsRepository.getAll();
}

/**
 * resolveSessionIndex(list, record) — the index half of the "index ->
 * record -> id" translation layer (see file header). Finds `record`'s
 * position inside `list` by identifier equality (`رقم_الجلسة`),
 * replacing the old `data.sessions.indexOf(s)` reference-equality lookup
 * that no longer works now that Repository reads return cloned objects.
 * @param {Object[]} list
 * @param {Object} record
 * @returns {number} 0-based index, or -1 if not found.
 */
function resolveSessionIndex(list, record) {
  var id = record ? record[SESSIONS_ID_FIELD] : undefined;
  for (var i = 0; i < list.length; i++) {
    if (list[i][SESSIONS_ID_FIELD] === id) return i;
  }
  return -1;
}

// ================================================================
// RENDER — عرض قائمة الجلسات
// ================================================================

/**
 * renderSessions — renders the sessions list view.
 * Reads: SessionsRepository (search + getAll — both synchronous),
 * searchSessions filter, filterSessionStatus filter.
 * Writes to: #sessionsListView, #sessionsEmpty.
 *
 * PHASE 16.11 — DomRecycler Migration (Sessions)
 * ----------------------------------------------------------------
 * Follows the exact Cases (PHASE 16.6) / Clients (PHASE 16.7) / Tasks
 * (PHASE 16.10) shape: sessionInnerHtml() below is the SAME markup
 * string this function always built per session, just moved out of
 * the inline .map() callback so the SAME template logic is shared by
 * DomRecycler (new path) and the untouched legacy full-rebuild block
 * (fallback path). Only the outer wrapper (`<div class="session-item">
 * ...</div>`) moved: DomNodeFactory now owns creating that wrapper
 * element on create().
 *
 * No `attrs()` layer (unlike Tasks): `session-item`'s className is a
 * fixed literal — there is no per-item variable outer-node property
 * (no priority-driven className, no conditional id/title/hidden/
 * disabled) — so per the Phase 16.9 options.attrs() contract, this
 * migration deliberately omits options.attrs entirely rather than
 * inventing a no-op attrs() function. This matches renderCases()'s and
 * renderClients()'s pattern (also attrs-less), not renderTasks()'s.
 *
 * No js/core/dom/* file is touched by this phase.
 */
function renderSessions() {
  // Defensive only — see sessionsRepositoryReadyPromise's doc comment.
  // In normal page load order this is always true by the time any
  // onclick/oninput can fire, since open() resolves via microtasks that
  // drain before the browser dispatches its first user-facing event.
  if (!sessionsRepository.isReady()) return;

  var s  = val('searchSessions').toLowerCase();
  var st = val('filterSessionStatus');

  syncSessionsMirror();

  var queryModel = { sort: { field: 'التاريخ', direction: 'asc' } };
  if (s) queryModel.search = s;
  if (st) queryModel.filter = { 'الحالة': st };
  var rows = sessionsRepository.search(queryModel).items;

  var c  = document.getElementById('sessionsListView');
  var em = document.getElementById('sessionsEmpty');

  if (!rows.length) {
    c.innerHTML = '';
    // PHASE 16.11 — SAFETY: the line above wipes the container's real
    // children directly (not through DomRecycler), so any key->node
    // references DomKeyIndex is holding for it would now point at
    // detached/dead nodes. Reset so the next non-empty render starts
    // clean instead of reusing dead references. Additive only —
    // window.DomKeyIndex may be undefined if js/core/dom/ isn't
    // loaded, hence the guard (same pattern as tasks.js/cases.js/
    // clients.js).
    if (window.DomKeyIndex) DomKeyIndex.reset(c);
    em.style.display = '';
    return;
  }
  em.style.display = 'none';

  var allSessions = data.sessions;

  // ----------------------------------------------------------------
  // PHASE 16.11 — DomRecycler Migration (Sessions)
  // ----------------------------------------------------------------
  // sessionInnerHtml() is the EXACT SAME markup this function has
  // always built for each session — narrowed from "whole container"
  // to "one session at a time", exactly like taskInnerHtml() in
  // tasks.js and desktopRowInner()/mobileCardInner() in cases.js.

  function sessionInnerHtml(s) {
    var ri  = resolveSessionIndex(allSessions, s);
    var d   = parseLocalDate(s['التاريخ']);
    var day = d ? d.getDate() : '—';
    var mon = d ? d.toLocaleDateString('ar-EG', { month: 'short' }) : '';

    return (
      '<div class="session-date">' +
        '<div class="day">'   + day + '</div>' +
        '<div class="month">' + mon + '</div>' +
      '</div>' +
      '<div class="session-info">' +
        '<div class="session-title">' +
          (s['عنوان_القضية'] || 'جلسة') +
          (s['رقم_القضية'] ? ' <small style="color:var(--muted)">— ' + s['رقم_القضية'] + '</small>' : '') +
          ' ' + urgencyBadge(s['التاريخ']) +
        '</div>' +
        '<div class="session-meta">' +
          '<span>&#128336; ' + formatTime(s['الوقت']) + '</span>' +
          '<span>&#127963; ' + (s['المحكمة'] || '—') + '</span>' +
          (s['رقم_الدائرة'] ? '<span>&#127959; د. ' + s['رقم_الدائرة'] + '</span>' : '') +
          (s['رقم_القاعة']  ? '<span>&#128682; ق. ' + s['رقم_القاعة'] + '</span>' : '') +
          (s['القاضي']     ? '<span>&#128100; ' + s['القاضي']     + '</span>' : '') +
          (s['نوع_الدعوى'] ? '<span>&#128203; ' + s['نوع_الدعوى'] + '</span>' : '') +
          statusBadge(s['الحالة']) +
        '</div>' +
        (s['ما_تم_في_الجلسة']
          ? '<div style="font-size:12px;color:var(--muted);margin-top:5px;">&#128221; ' + s['ما_تم_في_الجلسة'] + '</div>'
          : '') +
        (s['القرار']
          ? '<div style="font-size:12px;color:var(--gold);margin-top:3px;">&#9878; القرار: ' + s['القرار'] + '</div>'
          : '') +
        (s['التأجيل_إلى']
          ? '<div style="font-size:12px;color:var(--info);margin-top:3px;">&#128197; التأجيل: ' + formatDate(s['التأجيل_إلى']) + '</div>'
          : '') +
      '</div>' +
      '<div class="session-actions">' +
        '<button class="btn btn-ghost btn-sm btn-icon" onclick="editSession(' + ri + ')">&#9998;</button>' +
        '<button class="btn btn-danger btn-sm btn-icon" onclick="deleteSession(' + ri + ')">&#128465;</button>' +
      '</div>'
    );
  }

  // رقم_الجلسة only — stable identity, exactly like caseRowKey()/
  // clientRowKey()/taskRowKey().
  function sessionRowKey(s) { return s[SESSIONS_ID_FIELD]; }

  var recycled = false;
  if (window.DomRecycler && typeof DomRecycler.reconcile === 'function') {
    try {
      DomRecycler.reconcile(c, rows, { key: sessionRowKey, tag: 'div', className: 'session-item', render: sessionInnerHtml });
      recycled = true;
    } catch (domRecyclerError) {
      // PHASE 16.6/16.9/16.10 SAFETY (unchanged pattern): any recycler
      // failure falls straight back to the legacy full-rebuild path
      // below, and drops whatever partial key-index state the failed
      // attempt may have left behind so the NEXT render (recycled or
      // not) never inherits it.
      recycled = false;
      if (window.DomKeyIndex) DomKeyIndex.reset(c);
    }
  }

  if (!recycled) {
    // ORIGINAL PHASE ≤16.10 implementation — UNCHANGED (full rebuild),
    // kept exactly as the guaranteed-safe fallback path. Uses the SAME
    // sessionInnerHtml() template function defined above, just with the
    // outer wrapper restored around it.
    c.innerHTML = rows.map(function(s) {
      return '<div class="session-item">' + sessionInnerHtml(s) + '</div>';
    }).join('');
  }
}

// ================================================================
// CRUD — حفظ / تعديل / حذف
// ================================================================

/**
 * saveSession — validates, saves through SessionsRepository, syncs to
 * GAS. Replaces: inline saveSession() in index.html <script> block.
 * ApiService.syncRow() replaces the original syncToSheets() call, same
 * as before.
 *
 * Crosses the async boundary (Repository.create()/update() are
 * Promise-returning) — the only reason this function is now `async`.
 */
async function saveSession() {
  var date = document.getElementById('fSessionDate').value;
  var time = document.getElementById('fSessionTime').value;
  if (!date || !time) {
    toast('يرجى تحديد تاريخ ووقت الجلسة', 'error');
    return;
  }

  await ensureSessionsRepositoryReady();

  var obj = collectForm('sessions');
  obj['الوقت'] = sanitizeTime(obj['الوقت']);
  // Note: obj['رقم_الجلسة'] is intentionally NOT stamped here — see file
  // header "IDENTIFIER GENERATION NOTE": SessionsRepository.create()
  // generates it internally (only when absent), exactly replicating the
  // original `|| uid()` fallback. SessionsRepository.update() always
  // preserves the existing record's id regardless of what is in obj.
  obj['تاريخ_الإنشاء'] = obj['تاريخ_الإنشاء'] || new Date().toISOString();

  var idx = editIdx.sessions;
  var result;

  if (idx >= 0) {
    var existing = data.sessions[idx];
    var existingId = existing ? existing[SESSIONS_ID_FIELD] : null;
    result = await sessionsRepository.update(existingId, obj);
  } else {
    result = await sessionsRepository.create(obj);
  }

  if (!result || !result.success) {
    toast('حدث خطأ أثناء الحفظ', 'error');
    return;
  }

  syncSessionsMirror();

  if (idx >= 0) {
    toast('تم تحديث الجلسة', 'success');
  } else {
    toast('تمت إضافة الجلسة — ستظهر في Google Calendar', 'success');
  }

  saveLocal();
  ApiService.syncRow('الجلسات', result.record, idx);   // replaces: if(API_URL)syncToSheets(...)
  closeModal('modalSession');
  renderSessions();
  updateBadges();
  // PHASE 16.5.1 — DIRTY PROPAGATION (additive only, see phase brief)
  if (window.ApplicationShell) { ApplicationShell.markDirty('sessions'); ApplicationShell.markDirty('dashboard'); ApplicationShell.markDirty('calendar'); }
}

/**
 * editSession — opens the session modal pre-filled with existing data.
 * Unchanged from before: purely a read of the (now Repository-backed)
 * data.sessions mirror, so it stays fully synchronous — no Repository
 * call needed here at all.
 * @param {number} i - 0-based index in the data.sessions mirror.
 */
function editSession(i) {
  editIdx.sessions = i;
  populateCaseDropdown('fSessionCaseNum', data.sessions[i]['رقم_القضية']);
  fillForm('sessions', data.sessions[i]);
  autofillSessionFromCase(data.sessions[i]['رقم_القضية'], true);
  document.getElementById('modalSessionTitle').textContent = 'تعديل الجلسة';
  document.getElementById('modalSession').classList.add('open');
}

/**
 * deleteSession — confirms, removes via SessionsRepository, syncs to GAS.
 * @param {number} i - 0-based index in the data.sessions mirror.
 * ApiService.deleteData() replaces the original syncDeleteToSheets() call
 * — preserved exactly, same call/argument order as before (this is one
 * of the few modules where the original inline deleteX() DID call
 * ApiService.deleteData(), unlike Documents' documented gap).
 *
 * Crosses the async boundary (Repository.delete() is Promise-returning)
 * — the only reason this function is now `async`.
 */
async function deleteSession(i) {
  if (!(await confirmDialog('حذف هذه الجلسة؟'))) return;

  await ensureSessionsRepositoryReady();

  var record = data.sessions[i];
  if (!record) return;

  ApiService.deleteData('الجلسات', i);       // replaces: if(API_URL)syncDeleteToSheets(...)

  var id = record[SESSIONS_ID_FIELD];
  var result = await sessionsRepository.delete(id);

  if (!result || !result.success) {
    toast('حدث خطأ أثناء الحذف', 'error');
    return;
  }

  syncSessionsMirror();
  saveLocal();
  toast('تم الحذف', 'info');
  renderSessions();
  updateBadges();
  // PHASE 16.5.1 — DIRTY PROPAGATION (additive only, see phase brief)
  if (window.ApplicationShell) { ApplicationShell.markDirty('sessions'); ApplicationShell.markDirty('dashboard'); ApplicationShell.markDirty('calendar'); }
}

/**
 * restoreSession(id) — استرجاع جلسة محذوفة (Restore).
 * PHASE 10 — SUB-PHASE 10.4 — Restore Rollout (same pattern as Cases,
 * SUB-PHASE 10.3 — see docs/Restore_Rollout_Report.md).
 * Restores a soft-deleted session via `sessionsRepository.restore(id)`
 * (inherited, unmodified, from SUB-PHASE 10.2's `Repository.prototype.
 * restore()`). Symmetric with `deleteSession()` above: same ready-guard,
 * same `syncSessionsMirror()` -> `saveLocal()` -> `renderSessions()` ->
 * `updateBadges()` sequence.
 *
 * ID, NOT INDEX — same documented reason as `restoreCase()`.
 * NO UI WIRING — Rollout scope, matches the Pilot.
 * Does NOT call `ApiService.deleteData()`/`syncRow()` — same explicit,
 * documented design decision as `restoreCase()`; Google Sheets sync is
 * untouched by this phase.
 *
 * @param {string} id - the SessionsRepository id (رقم_الجلسة) of the
 *   soft-deleted session to restore.
 */
async function restoreSession(id) {
  await ensureSessionsRepositoryReady();

  var result = await sessionsRepository.restore(id);

  if (!result || !result.success) {
    toast('حدث خطأ أثناء الاسترجاع', 'error');
    return;
  }

  syncSessionsMirror();
  saveLocal();
  toast('تم الاسترجاع', 'success');
  renderSessions();
  updateBadges();
  // PHASE 16.5.1 — DIRTY PROPAGATION (additive only, see phase brief)
  if (window.ApplicationShell) { ApplicationShell.markDirty('sessions'); ApplicationShell.markDirty('dashboard'); ApplicationShell.markDirty('calendar'); }
}

// ================================================================
// Node/test export (browser: `module` is undefined, this is a no-op —
// renderSessions/saveSession/editSession/deleteSession remain plain
// global functions exactly as before).
// ================================================================

// ================================================================
// UNDO / REDO — تراجع / إعادة (PHASE 12 — SUB-PHASE 12.5 — General Undo
// Integration)
// ================================================================
// Reversal mapping, redo-stack suspension, and instruction application
// are all handled by the shared js/core/UndoReconciler.js (extracted
// from the Cases pilot, SUB-PHASE 12.4 → 12.5) — this module only
// supplies its own `sessionsRepository`/`SESSIONS_ID_FIELD` and its own refresh sequence
// (`sync/saveLocal/render/updateBadges/toast`), matching every other
// entity module's `restoreSession()` refresh sequence exactly.
//
// `sessionsRepository` disables no operations (`unsupportedOperations: []`,
// confirmed in js/repositories/SessionsRepository.js), so every reversal
// mapping case (create/update/delete/restore) is legal for this
// entity — same as Cases.

/**
 * undoLastSessionAction() — PHASE 12.5. Reverses the most recent
 * Sessions mutation (create/update/delete/restore). Mirrors
 * `undoLastCaseAction()` (js/modules/cases.js) exactly: same guard on
 * `canUndo()`, same use of the shared `UndoReconciler.applyUndoInstruction()`,
 * same refresh sequence, same graceful handling of empty history, a
 * Repository/persist failure, or any unexpected exception.
 * @returns {Promise<void>}
 */
async function undoLastSessionAction() {
  await ensureSessionsRepositoryReady();

  try {
    if (!sessionsRepository.canUndo()) {
      toast('لا يوجد إجراء للتراجع عنه', 'info');
      return;
    }

    var instruction = sessionsRepository.undo();
    if (!instruction) {
      toast('لا يوجد إجراء للتراجع عنه', 'info');
      return;
    }

    if (!UndoReconciler) {
      toast('حدث خطأ أثناء التراجع', 'error');
      return;
    }

    var result = await UndoReconciler.applyUndoInstruction(sessionsRepository, SESSIONS_ID_FIELD, instruction, 'undo');
    if (!result || !result.success) {
      toast('حدث خطأ أثناء التراجع', 'error');
      return;
    }

    syncSessionsMirror();
    saveLocal();
    renderSessions();
    updateBadges();
    // PHASE 16.5.1 — DIRTY PROPAGATION (additive only, see phase brief)
    if (window.ApplicationShell) { ApplicationShell.markDirty('sessions'); ApplicationShell.markDirty('dashboard'); ApplicationShell.markDirty('calendar'); }
    toast('تم التراجع', 'success');
  } catch (e) {
    toast('حدث خطأ أثناء التراجع', 'error');
  }
}

/**
 * redoLastSessionAction() — PHASE 12.5. Re-applies the most recently
 * undone Sessions mutation. Same refresh sequence, same shared-utility
 * usage, same error-handling guarantees as `undoLastSessionAction()`
 * above — mirrors `redoLastCaseAction()` exactly.
 * @returns {Promise<void>}
 */
async function redoLastSessionAction() {
  await ensureSessionsRepositoryReady();

  try {
    if (!sessionsRepository.canRedo()) {
      toast('لا يوجد إجراء لإعادته', 'info');
      return;
    }

    var instruction = sessionsRepository.redo();
    if (!instruction) {
      toast('لا يوجد إجراء لإعادته', 'info');
      return;
    }

    if (!UndoReconciler) {
      toast('حدث خطأ أثناء الإعادة', 'error');
      return;
    }

    var result = await UndoReconciler.applyUndoInstruction(sessionsRepository, SESSIONS_ID_FIELD, instruction, 'redo');
    if (!result || !result.success) {
      toast('حدث خطأ أثناء الإعادة', 'error');
      return;
    }

    syncSessionsMirror();
    saveLocal();
    renderSessions();
    updateBadges();
    // PHASE 16.5.1 — DIRTY PROPAGATION (additive only, see phase brief)
    if (window.ApplicationShell) { ApplicationShell.markDirty('sessions'); ApplicationShell.markDirty('dashboard'); ApplicationShell.markDirty('calendar'); }
    toast('تمت الإعادة', 'success');
  } catch (e) {
    toast('حدث خطأ أثناء الإعادة', 'error');
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    sessionsUndoManager: sessionsUndoManager,
    undoLastSessionAction: undoLastSessionAction,
    redoLastSessionAction: redoLastSessionAction,
    SESSIONS_FIELDS: SESSIONS_FIELDS,
    SESSIONS_MAP: SESSIONS_MAP,
    SESSIONS_ID_FIELD: SESSIONS_ID_FIELD,
    sessionsRepository: sessionsRepository,
    ensureSessionsRepositoryReady: ensureSessionsRepositoryReady,
    syncSessionsMirror: syncSessionsMirror,
    resolveSessionIndex: resolveSessionIndex,
    renderSessions: renderSessions,
    saveSession: saveSession,
    editSession: editSession,
    deleteSession: deleteSession,
    restoreSession: restoreSession
  };
}
