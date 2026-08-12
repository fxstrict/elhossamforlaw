/**
 * ================================================================
 * js/modules/tasks.js — وحدة المهام | نظام الحسام للمحاماة
 * ================================================================
 * Contains ALL Tasks-related functions extracted from index.html.
 *
 * PHASE 10 — SUB-PHASE 10.4 — Restore Rollout
 * ----------------------------------------------------------------
 * Additive-only addition on top of PHASE 9.5 below: a new
 * `restoreTask(id)` function (see its own doc comment, next to
 * `deleteTask()`), same Cases-piloted pattern (SUB-PHASE 10.3). No
 * existing function in this file was changed. See
 * docs/Restore_Rollout_Report.md for the full audit and verification
 * evidence.
 *
 * PHASE 9 — SUB-PHASE 9.5 — Repository Integration (Tasks Module)
 * ----------------------------------------------------------------
 * This module now reads and writes through js/repositories/
 * TasksRepository.js instead of the legacy global `data.tasks` array
 * directly. Nothing else in the project was changed to make this
 * happen: TasksRepository.js, Repository.js, DatabaseService.js and
 * LocalStorageAdapter.js are all used exactly as PHASE 5/PHASE 8 left
 * them (no edits, no imports of internals). This follows the same
 * proven pattern used for the Documents module (SUB-PHASE 9.3) and the
 * Sessions module (SUB-PHASE 9.4).
 *
 * WHY `data.tasks` STILL EXISTS BELOW
 *   js/modules/dashboard.js (`data.tasks.filter(...)` / `.length` for
 *   badges/upcoming-list) reads the global `data.tasks` array directly,
 *   and this phase's mandate is "Modify ONLY tasks.js" — dashboard.js
 *   may not be touched. So `data.tasks` is kept alive as a read-only
 *   MIRROR of `TasksRepository.getAll()`, refreshed after every
 *   Repository read/write this file performs. Every other module keeps
 *   working unmodified and unaware that Tasks moved to the Repository.
 *
 * READ / WRITE SPLIT (this phase's rule)
 *   - Reads (`renderTasks`) call the Repository's SYNCHRONOUS methods
 *     only (`getAll()`, `search()`) — no unnecessary async.
 *   - Writes (`saveTask`, `deleteTask`, `toggleTask`) are the ONLY
 *     functions in this file that cross the async boundary, because
 *     Repository.create()/update()/delete() are Promise-returning
 *     (Repository Contract §3 — Validate -> Write Local -> Persist).
 *     `toggleTask()` is a partial update (single field flip) and is
 *     implemented as `TasksRepository.update(id, {'الحالة': ...})` —
 *     TasksRepository deliberately does not expose a specialized
 *     `toggleStatus()` operation (see TasksRepository.js file header
 *     "TOGGLE" note), so a normal `update()` call is the correct,
 *     already-available substitute.
 *   - `editTask` stays 100% synchronous and unchanged: it only reads
 *     the already-synced `data.tasks` mirror to pre-fill the modal,
 *     exactly like before.
 *
 * INDEX -> RECORD -> ID TRANSLATION LAYER
 *   The rendered HTML still embeds plain 0-based array indexes in its
 *   `onclick="toggleTask(N)"` / `onclick="editTask(N)"` /
 *   `onclick="deleteTask(N)"` attributes (index.html's row templates
 *   were not changed, per this phase's rule "Do NOT change generated
 *   HTML unless absolutely necessary"). Because
 *   TasksRepository.search()/getAll() return CLONED records (not the
 *   same object references `data.tasks` used to hold), the old
 *   `data.tasks.indexOf(t)` reference-equality trick no longer works.
 *   `resolveTaskIndex()` below is the smallest possible replacement: it
 *   looks a record up in the current mirror by its identifier field
 *   (`رقم_المهمة`) instead of by reference. `toggleTask(i)` /
 *   `editTask(i)` / `deleteTask(i)` then resolve that same index back
 *   to a record, and `toggleTask`/`deleteTask`/`saveTask` go one step
 *   further and resolve the record to its `رقم_المهمة` id before
 *   calling `TasksRepository.update()/delete()` (both take an id, not
 *   an index).
 *
 * SOFT DELETE — OBSERVABLE BEHAVIOR NOTE
 *   TasksRepository is configured with `softDelete: true` (unchanged,
 *   not this phase's decision to make). `delete(id)` therefore keeps
 *   the record in storage with a `deletedAt` stamp instead of
 *   physically removing it, unlike the original `data.tasks.splice(i,1)`.
 *   `getAll()`/`search()` both exclude soft-deleted records by default,
 *   so nothing deleted ever reappears anywhere `data.tasks` is read
 *   (this file, dashboard.js) — the UI-observable behavior is therefore
 *   identical to a hard delete.
 *
 * IDENTIFIER GENERATION NOTE
 *   The original inline `saveTask()` stamped
 *   `obj['رقم_المهمة'] = obj['رقم_المهمة'] || uid();` on the plain
 *   object before pushing/assigning it. `TasksRepository._resolveId()`
 *   (js/repositories/TasksRepository.js) already replicates this exact
 *   fallback internally on `create()` (generate only when absent), so
 *   this module does not need to duplicate that stamp — `create(obj)`
 *   assigns the id itself, exactly as `saveDocument()`/`saveSession()`
 *   rely on their own Repositories to assign the id.
 *
 * SEARCH / FILTER — both UI behaviors
 *   (`#searchTasks` free-text join, `#filterTaskPriority` exact-match on
 *   `الأولوية`) are preserved bit-for-bit: `TasksRepository._matchesSearch()`
 *   replicates the exact `Object.values(t).join(' ')` free-text join the
 *   inline module used, and `renderTasks()` below passes the same
 *   priority filter through the Repository's generic
 *   `search({search, filter})` Query Model instead of doing it in plain
 *   JS. No sort is applied — matching the original inline renderTasks(),
 *   which never called `.sort()` (insertion order only). TasksRepository
 *   does expose an additive `sort()` convenience method, but using it
 *   here would change observable row order versus the original, so this
 *   phase's "preserve identical behavior" rule means it is intentionally
 *   NOT used in `renderTasks()`.
 *
 * Depends on (globals expected from index.html / prior scripts):
 *   - data              : shared app data object  { tasks, cases, … }
 *   - editIdx           : shared edit-index map   { tasks: -1 }
 *   - ApiService        : api.js layer (replaces direct syncToSheets /
 *                         syncDeleteToSheets calls)
 *   - saveLocal()       : localStorage persistence helper
 *   - toast()           : UI notification helper
 *   - updateBadges()    : badge counter updater
 *   - closeModal()      : modal close helper
 *   - urgencyBadge()    : urgency badge builder   (from ui-utils.js)
 *   - statusBadge()     : status badge builder    (from ui-utils.js)
 *   - formatDate()      : date formatter          (from ui-utils.js)
 *   - val()             : getElementById+.value   (from ui-utils.js)
 *   - uid()             : unique-ID generator     (from ui-utils.js)
 *   - collectForm()     : generic form-to-object  (from ui-utils.js)
 *   - fillForm()        : generic object-to-form  (from ui-utils.js)
 *   - TasksRepository   : js/repositories/TasksRepository.js
 *                         (loaded the same dual Node/browser way every
 *                         Repository file already loads its own
 *                         dependencies)
 *
 * GAS Sheet name: 'المهام'
 *
 * Does NOT touch:
 *   - CSS / HTML structure
 *   - Other modules (cases, clients, sessions, documents, fees, …)
 *   - Dashboard widgets (#statTasks, #dashTasks — owned by renderDashboard()
 *     in index.html, since they read across multiple data slices)
 *   - Google Apps Script backend
 *   - Database / sheet structure
 *   - ApiService internals
 *   - js/core/Repository.js, DatabaseService.js, StorageAdapter.js,
 *     LocalStorageAdapter.js, js/repositories/TasksRepository.js
 * ================================================================
 */

'use strict';

// ================================================================
// FIELDS & MAP — tasks slice only (unchanged)
// ================================================================

var TASKS_FIELDS = [
  'fTaskTitle',
  'fTaskCaseNum',
  'fTaskPriority',
  'fTaskDue',
  'fTaskStatus',
  'fTaskNotes'
];

var TASKS_MAP = {
  fTaskTitle:    'العنوان',
  fTaskCaseNum:  'رقم_القضية',
  fTaskPriority: 'الأولوية',
  fTaskDue:      'الموعد_النهائي',
  fTaskStatus:   'الحالة',
  fTaskNotes:    'الملاحظات'
};

/**
 * TASK_PRIORITY_ICONS — PHASE 13.15 PART 3 §5. Single shared source for
 * the priority emoji used everywhere a task's priority is rendered
 * (renderTasks() below, and dashboard.js's renderDashboard()). Both
 * files read this same object at call time rather than each keeping
 * its own literal, so the "عاجلة"/"متوسطة"/"عادية" icon is guaranteed
 * to be visually identical in the Tasks page and the Dashboard.
 * Display-only constant — does not affect the الأولوية value stored
 * on a task, only which emoji is shown next to it.
 */
var TASK_PRIORITY_ICONS = { high: '&#128308;', medium: '&#128993;', low: '&#128994;' };

/**
 * Identifier field name — must match TasksRepository's own
 * TASKS_ID_FIELD constant exactly (js/repositories/TasksRepository.js,
 * §1). Duplicated here rather than imported, same "depends only on its
 * own declared dependency" discipline every Repository-integrated
 * module already uses for its own local constants — this file's one
 * declared new dependency is TasksRepository itself, not its internals.
 */
var TASKS_ID_FIELD = 'رقم_المهمة';

// ================================================================
// REPOSITORY WIRING — PHASE 9 / SUB-PHASE 9.5
// ================================================================
// Same dual Node/browser loading shape already used by every file under
// js/repositories/ and js/core/: `require()` when running under Node
// (module.exports exists — this is how js/tests/verify_tasks_
// repository_integration.js loads this file), otherwise the browser
// global `window.TasksRepository` (populated once index.html's
// <script> tags load js/core/Repository.js, DatabaseService.js,
// LocalStorageAdapter.js and js/repositories/TasksRepository.js ahead
// of this file — adding those tags to index.html is explicitly out of
// scope for this phase's "Modify ONLY tasks.js" mandate).

var TasksRepositoryNS = (typeof module !== 'undefined' && module.exports)
  ? require('../repositories/TasksRepository.js')
  : (typeof window !== 'undefined' ? window : this);

var TasksRepository = TasksRepositoryNS && TasksRepositoryNS.TasksRepository;

if (typeof TasksRepository !== 'function') {
  throw new Error(
    'tasks.js requires js/repositories/TasksRepository.js to be ' +
    'loaded first (TasksRepository class not found).'
  );
}

/**
 * The single TasksRepository instance this module talks to. Default
 * construction (no config) wires it to the real DatabaseService +
 * LocalStorageAdapter pair, reading/writing the exact same 'tasks'
 * localStorage key `data.tasks` always used.
 */
var tasksRepository = new TasksRepository();

/**
 * PHASE 12 — SUB-PHASE 12.5 — General Undo Integration.
 * js/core/UndoManager.js and js/core/UndoReconciler.js are required
 * here the same dual Node/browser way tasksRepository is required above,
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
      'tasks.js: js/core/UndoManager.js was not found (index.html has ' +
      'not yet added its <script> tag for it). This module continues ' +
      'to work exactly as before this phase; undoLastTaskAction()/' +
      'redoLastTaskAction() will simply report nothing to undo/redo ' +
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
      'tasks.js: js/core/UndoReconciler.js was not found (index.html has ' +
      'not yet added its <script> tag for it). undoLastTaskAction()/' +
      'redoLastTaskAction() will simply report nothing to undo/redo ' +
      'until this dependency is wired.'
    );
  }
  UndoReconciler = null;
}

/**
 * TasksUndoManager — PHASE 12.5: the single UndoManager instance
 * wired to `tasksRepository` via the public `setUndoManager()` façade
 * (SUB-PHASE 12.3, js/core/Repository.js, NOT modified by this phase).
 * Each entity module constructs and wires its OWN UndoManager instance
 * — this one is never shared with any other module — so that
 * Undo/Redo history for Tasks stays completely separate from every
 * other entity's history (Phase 12.5 brief §11), exactly as already
 * true for `casesUndoManager` in js/modules/cases.js.
 */
var tasksUndoManager = (typeof UndoManager === 'function') ? new UndoManager(tasksRepository) : null;
if (tasksUndoManager) {
  tasksRepository.setUndoManager(tasksUndoManager);
}

/**
 * Resolves once TasksRepository.open() has loaded its initial in-memory
 * copy from storage (Repository Contract §11: Create -> Open -> Ready).
 * Every write path awaits this before touching the Repository;
 * renderTasks()/editTask() stay synchronous and simply no-op if called
 * in the vanishingly small window before this resolves (see file header
 * "READ / WRITE SPLIT").
 */
var tasksRepositoryReadyPromise = (function () {
  var _p = tasksRepository.open().then(function () {
    syncTasksMirror();
  }).catch(function (err) {
    // Surface the failure without throwing out of a top-level Promise
    // chain (would otherwise be an unhandled rejection). renderTasks()
    // guards on isReady() and simply shows nothing until this is fixed.
    if (typeof console !== 'undefined' && console.error) {
      console.error('TasksRepository failed to open:', err);
    }
  });
  // PHASE 17.0 — Startup Reliability: bound this Promise so a stuck
  // tasksRepository.open() can never hang ensureTasksRepositoryReady()
  // forever. See js/core/RepositoryReadyTimeout.js. Purely additive:
  // if that helper isn't loaded, _p is returned completely unwrapped.
  return (typeof RepositoryReadyTimeout !== 'undefined') ? RepositoryReadyTimeout.wrap('tasks', _p) : _p;
})();

/**
 * ensureTasksRepositoryReady() — awaited by every write path. open()
 * itself is idempotent (Repository.prototype.open() returns
 * immediately if already 'ready'/'busy'), so calling this more than
 * once is always safe and cheap.
 * @returns {Promise<void>}
 */
function ensureTasksRepositoryReady() {
  if (tasksRepository.isReady()) return Promise.resolve();
  return tasksRepositoryReadyPromise;
}

/**
 * syncTasksMirror — refreshes the legacy global `data.tasks` array from
 * the Repository's current state (soft-deleted records excluded, same
 * as the Repository's own getAll() default). Called after open() and
 * after every create/update/delete this module performs, so
 * dashboard.js keeps seeing accurate data without being touched itself.
 */
function syncTasksMirror() {
  data.tasks = tasksRepository.getAll();
}

/**
 * resolveTaskIndex(list, record) — the index half of the "index ->
 * record -> id" translation layer (see file header). Finds `record`'s
 * position inside `list` by identifier equality (`رقم_المهمة`),
 * replacing the old `data.tasks.indexOf(t)` reference-equality lookup
 * that no longer works now that Repository reads return cloned objects.
 * @param {Object[]} list
 * @param {Object} record
 * @returns {number} 0-based index, or -1 if not found.
 */
function resolveTaskIndex(list, record) {
  var id = record ? record[TASKS_ID_FIELD] : undefined;
  for (var i = 0; i < list.length; i++) {
    if (list[i][TASKS_ID_FIELD] === id) return i;
  }
  return -1;
}

// ================================================================
// COMPLETION / REOPEN METADATA — PHASE 13.13 PART 2
// ================================================================
// Task Completion Metadata (Completion Reason / Reopen Reason).
//
// WHAT WAS ADDED — 6 new plain fields on the Task record, nothing else:
//   سبب_الإنجاز / تاريخ_الإنجاز / وقت_الإنجاز       (completion reason/date/time)
//   سبب_إعادة_الفتح / تاريخ_إعادة_الفتح / وقت_إعادة_الفتح  (reopen reason/date/time)
// No new History table, no new Repository method, no Migration, no
// IndexedDB/LocalStorage schema change, no DatabaseService/Adapter
// change — the 6 fields are just additional keys on the same Task
// object TasksRepository already reads/writes/persists/syncs/undoes
// generically (Repository.js clones and merges whatever keys a record
// has; ApiService.syncRow() posts the whole record; neither cares what
// the keys are named — see docs/phase13/PHASE13_13_PART2_Report.md for
// the full audit proving this).
//
// WHY فسط تاريخ/وقت (date+time) ARE NOT FORM FIELDS
//   Only the two "reason" fields are user-editable (textareas in the
//   modal, wired into FIELDS.tasks / MAP.tasks in index.html — same
//   mechanism as every other tasks field). Date/time are stamped by
//   saveTask() itself at the exact moment a transition is detected —
//   there is no date/time input for them, so they cannot be
//   accidentally hand-edited.
//
// TRANSITION RULE (see saveTask() below for the actual stamping logic)
//   pending -> done  : stamps تاريخ_الإنجاز/وقت_الإنجاز "now", keeps
//                        whatever the user typed in #fTaskCompletionReason.
//   done -> pending  : stamps تاريخ_إعادة_الفتح/وقت_إعادة_الفتح "now",
//                        keeps whatever the user typed in #fTaskReopenReason.
//   any other save   : all 6 fields are explicitly re-copied from the
//                        EXISTING stored record (never taken from the
//                        DOM in this case) — guarantees editing the
//                        title/notes/etc. on an already-completed or
//                        already-reopened task can never silently
//                        change its completion/reopen history.
//
// CANCEL BEHAVIOR
//   The modal's existing "إلغاء" button (`closeModal('modalTask')`,
//   unchanged) already fully satisfies "إذا ضغط المستخدم إلغاء لا تحفظ
//   المهمة" — it closes the modal without ever invoking saveTask(), so
//   nothing is written. No second/nested confirmation dialog was added
//   (see report §"Design Decisions" for why this reading was chosen).

/**
 * toggleTaskReasonFields — shows/hides the completion-reason and
 * reopen-reason textareas based purely on the CURRENT #fTaskStatus
 * value (and, for the reopen box, whether the task being edited has
 * ever been completed before). Called:
 *   - on every #fTaskStatus 'change' event (index.html onchange=)
 *   - once from editTask(), right after fillForm(), so an already-
 *     completed/reopened task shows the right box(es) the instant the
 *     modal opens (matches the phase spec: visibility is driven by
 *     "الحالة الحالية", not by any click).
 * Pure DOM read/show/hide — no Repository call, no data mutation.
 */
function toggleTaskReasonFields() {
  var statusEl     = document.getElementById('fTaskStatus');
  var compGroup    = document.getElementById('fTaskCompletionReasonGroup');
  var reopenGroup  = document.getElementById('fTaskReopenReasonGroup');
  if (!statusEl || !compGroup || !reopenGroup) return;

  var status   = statusEl.value;
  var idx      = (typeof editIdx !== 'undefined') ? editIdx.tasks : -1;
  var existing = (idx >= 0 && data.tasks[idx]) ? data.tasks[idx] : null;
  var hasCompletedBefore = !!(existing && existing['تاريخ_الإنجاز']);

  compGroup.style.display   = (status === 'done') ? '' : 'none';
  reopenGroup.style.display = (status === 'pending' && hasCompletedBefore) ? '' : 'none';
}

// ================================================================
// RENDER — عرض قائمة المهام
// ================================================================

/**
 * renderTasks — renders the tasks list view.
 * Reads: TasksRepository (search + getAll — both synchronous),
 * searchTasks filter, filterTaskPriority filter.
 * Writes to: #tasksListView, #tasksEmpty.
 *
 * NOTE: there is no separate searchTasks()/filterTasks() function in the
 * original app — search and priority filtering are both read directly
 * from the DOM (#searchTasks, #filterTaskPriority) and applied via the
 * Repository's Query Model, exactly matching the original inline
 * implementation's observable behavior.
 *
 * PHASE 16.10 — DomRecycler Migration (Tasks)
 * ----------------------------------------------------------------
 * Follows the exact Cases (PHASE 16.6) / Clients (PHASE 16.7) shape:
 * taskInnerHtml() below is the SAME markup string this function always
 * built per task, just moved out of the inline .map() callback so the
 * SAME template logic is shared by DomRecycler (new path) and the
 * untouched legacy full-rebuild block (fallback path). Only the outer
 * wrapper (`<div class="task-item ...">...</div>`) moved: DomNodeFactory
 * now owns creating that wrapper element on create() and
 * DomNodeFactory.setAttrs() (via taskAttrs()) now owns keeping its
 * className in sync with priority on reuse — the exact gap that
 * blocked Tasks migration at PHASE 16.8 and motivated PHASE 16.9's
 * options.attrs() layer. No js/core/dom/* file is touched by this
 * phase.
 */
function renderTasks() {
  // Defensive only — see tasksRepositoryReadyPromise's doc comment. In
  // normal page load order this is always true by the time any
  // onclick/oninput can fire, since open() resolves via microtasks that
  // drain before the browser dispatches its first user-facing event.
  if (!tasksRepository.isReady()) return;

  var s  = val('searchTasks').toLowerCase();
  var pr = val('filterTaskPriority');

  syncTasksMirror();
  var allTasks = data.tasks;

  var queryModel = {};
  if (s) queryModel.search = s;
  if (pr) queryModel.filter = { 'الأولوية': pr };
  var rows = tasksRepository.search(queryModel).items;

  var c  = document.getElementById('tasksListView');
  var em = document.getElementById('tasksEmpty');

  if (!rows.length) {
    c.innerHTML = '';
    // PHASE 16.10 — SAFETY: the line above wipes the container's real
    // children directly (not through DomRecycler), so any key->node
    // references DomKeyIndex is holding for it would now point at
    // detached/dead nodes. Reset so the next non-empty render starts
    // clean instead of reusing dead references. Additive only —
    // window.DomKeyIndex may be undefined if js/core/dom/ isn't
    // loaded, hence the guard (same pattern as cases.js/clients.js).
    if (window.DomKeyIndex) DomKeyIndex.reset(c);
    em.style.display = '';
    return;
  }
  em.style.display = 'none';

  // ----------------------------------------------------------------
  // PHASE 16.10 — DomRecycler Migration (Tasks)
  // ----------------------------------------------------------------
  // taskInnerHtml() is the EXACT SAME markup this function has always
  // built for each task — narrowed from "whole container" to "one
  // task at a time", exactly like desktopRowInner()/mobileCardInner()
  // in cases.js and desktopClientRowInner()/mobileClientCardInner() in
  // clients.js.

  function taskInnerHtml(t) {
    var ri   = resolveTaskIndex(allTasks, t);
    var done = t['الحالة'] === 'done';

    // PHASE 13.13 PART 2 — Completion / Reopen history line. Reuses the
    // existing .task-due class (font-size/color only) — no CSS change.
    // PHASE 13.15 PART 2 — wording/format unified project-wide: always
    // "السبب:" (never "بسبب"), always "الساعة" before the time (never
    // "•" or any other separator), and the reason line is only emitted
    // when a reason is actually stored (never an empty "السبب:" line).
    var historyLine = '';
    if (done && t['تاريخ_الإنجاز']) {
      historyLine =
        '<div class="task-due" style="width:100%;margin-top:2px;">اكتملت:<br>' + formatDate(t['تاريخ_الإنجاز']) +
        (t['وقت_الإنجاز'] ? ' الساعة ' + formatTime(t['وقت_الإنجاز']) : '') +
        (t['سبب_الإنجاز'] ? '<br>السبب:<br>' + t['سبب_الإنجاز'] : '') +
        '</div>';
    } else if (!done && t['تاريخ_إعادة_الفتح']) {
      historyLine =
        '<div class="task-due" style="width:100%;margin-top:2px;">أعيد فتحها:<br>' + formatDate(t['تاريخ_إعادة_الفتح']) +
        (t['وقت_إعادة_الفتح'] ? ' الساعة ' + formatTime(t['وقت_إعادة_الفتح']) : '') +
        (t['سبب_إعادة_الفتح'] ? '<br>السبب:<br>' + t['سبب_إعادة_الفتح'] : '') +
        '</div>';
    }

    return (
      // PHASE 13.14 PART 1 — Checkbox removed entirely (not hidden, not
      // disabled): the .task-check circle/checkmark element itself is no
      // longer emitted. Task status is only ever changed via the Task
      // Edit Dialog (editTask() → saveTask()). The freed width is
      // absorbed by the existing flex:1 info wrapper below — no CSS
      // change needed, statusBadge() already conveys done/pending state.
      '<div style="flex:1;min-width:0;">' +
        '<div class="task-text ' + (done ? 'done' : '') + '">' +
          (TASK_PRIORITY_ICONS[t['الأولوية']] || '') + '&nbsp;' + t['العنوان'] +
        '</div>' +
        '<div style="display:flex;gap:9px;flex-wrap:wrap;margin-top:3px;">' +
          (t['رقم_القضية'] ? '<span class="task-due">&#9878; ' + t['رقم_القضية'] + '</span>' : '') +
          statusBadge(t['الحالة']) +
          (t['الموعد_النهائي']
            ? '<span class="task-due">' + urgencyBadge(t['الموعد_النهائي']) + ' ' + formatDate(t['الموعد_النهائي']) + '</span>'
            : '') +
        '</div>' +
        historyLine +
      '</div>' +
      '<div style="display:flex;gap:5px;flex-shrink:0;">' +
        '<button class="btn btn-ghost btn-sm btn-icon" onclick="editTask(' + ri + ')">&#9998;</button>' +
        '<button class="btn btn-danger btn-sm btn-icon" onclick="deleteTask(' + ri + ')">&#128465;</button>' +
      '</div>'
    );
  }

  // taskAttrs() is the PHASE 16.9 attrs() layer's only Tasks-side
  // caller so far: it returns ONLY className (the exact, and only,
  // outer-node property Tasks needs — see PHASE 16.8/16.9 evidence),
  // recomputed from current priority on every render so a priority
  // change updates the outer node's className on reuse instead of
  // leaving it frozen at its create()-time value.
  function taskAttrs(t) {
    return { className: 'task-item ' + (t['الأولوية'] || '') };
  }

  // رقم_المهمة only — priority is intentionally NOT part of the key.
  // PHASE 16.8 evidence showed priority changing the outer className;
  // PHASE 16.9's attrs() layer (via taskAttrs() above) is what now
  // handles that, so the key stays a pure, stable identity exactly
  // like caseRowKey()/clientRowKey().
  function taskRowKey(t) { return t[TASKS_ID_FIELD]; }

  var recycled = false;
  if (window.DomRecycler && typeof DomRecycler.reconcile === 'function') {
    try {
      DomRecycler.reconcile(c, rows, { key: taskRowKey, tag: 'div', render: taskInnerHtml, attrs: taskAttrs });
      recycled = true;
    } catch (domRecyclerError) {
      // PHASE 16.6/16.9 SAFETY (unchanged pattern): any recycler
      // failure falls straight back to the legacy full-rebuild path
      // below, and drops whatever partial key-index state the failed
      // attempt may have left behind so the NEXT render (recycled or
      // not) never inherits it.
      recycled = false;
      if (window.DomKeyIndex) DomKeyIndex.reset(c);
    }
  }

  if (!recycled) {
    // ORIGINAL PHASE ≤16.9 implementation — UNCHANGED (full rebuild),
    // kept exactly as the guaranteed-safe fallback path. Uses the SAME
    // taskInnerHtml() template function defined above, just with the
    // outer wrapper (including the priority className, computed the
    // same way taskAttrs() computes it) restored around it.
    c.innerHTML = rows.map(function(t) {
      return '<div class="task-item ' + (t['الأولوية'] || '') + '">' + taskInnerHtml(t) + '</div>';
    }).join('');
  }
}

// ================================================================
// CRUD — حفظ / تعديل / حذف / تبديل الحالة
// ================================================================

/**
 * saveTask — validates, saves through TasksRepository, syncs to GAS.
 * Replaces: inline saveTask() in index.html <script> block.
 * ApiService.syncRow() replaces the original syncToSheets() call, same
 * as before.
 *
 * Crosses the async boundary (Repository.create()/update() are
 * Promise-returning) — the only reason this function is now `async`.
 */
async function saveTask() {
  var t = document.getElementById('fTaskTitle').value.trim();
  if (!t) {
    toast('يرجى إدخال عنوان المهمة', 'error');
    return;
  }

  await ensureTasksRepositoryReady();

  var obj = collectForm('tasks');
  // Note: obj['رقم_المهمة'] is intentionally NOT stamped here — see file
  // header "IDENTIFIER GENERATION NOTE": TasksRepository.create()
  // generates it internally (only when absent), exactly replicating the
  // original `|| uid()` fallback. TasksRepository.update() always
  // preserves the existing record's id regardless of what is in obj.
  obj['تاريخ_الإنشاء'] = obj['تاريخ_الإنشاء'] || new Date().toISOString();

  var idx = editIdx.tasks;
  var existing = (idx >= 0) ? data.tasks[idx] : null;

  // ------------------------------------------------------------
  // PHASE 13.13 PART 2 — Completion / Reopen metadata stamping.
  // `obj['سبب_الإنجاز']`/`obj['سبب_إعادة_الفتح']` were already read from
  // the (possibly hidden) textareas by collectForm() above; every branch
  // below explicitly OVERWRITES all 6 fields one way or another, so
  // nothing here depends on incidental DOM/hidden-field state.
  // ------------------------------------------------------------
  function zeroPad2(n) { return (n < 10 ? '0' : '') + n; }

  var previousStatus = existing ? existing['الحالة'] : null;
  var newStatus = obj['الحالة'];
  var now = new Date();
  var nowDateStr = now.getFullYear() + '-' + zeroPad2(now.getMonth() + 1) + '-' + zeroPad2(now.getDate());
  var nowTimeStr = zeroPad2(now.getHours()) + ':' + zeroPad2(now.getMinutes());

  if (previousStatus !== 'done' && newStatus === 'done') {
    // Transition: pending -> done. Stamp completion metadata now.
    var completionReasonEl = document.getElementById('fTaskCompletionReason');
    obj['سبب_الإنجاز'] = completionReasonEl ? completionReasonEl.value.trim() : '';
    obj['تاريخ_الإنجاز'] = nowDateStr;
    obj['وقت_الإنجاز'] = nowTimeStr;
  } else if (existing) {
    // Not a completion transition — completion date/time are still never
    // touched here (unchanged). The reason text, however, must not be
    // silently discarded: if the user actually typed something into the
    // (visible, since status==='done') fTaskCompletionReason textarea,
    // that wins; only fall back to the previously stored reason when the
    // field is genuinely empty. PHASE 13.14 PART 2 FIX-A.
    var completionReasonEl2 = document.getElementById('fTaskCompletionReason');
    var typedCompletionReason = completionReasonEl2 ? completionReasonEl2.value.trim() : '';
    obj['سبب_الإنجاز'] = typedCompletionReason || existing['سبب_الإنجاز'] || '';
    obj['تاريخ_الإنجاز'] = existing['تاريخ_الإنجاز'] || '';
    obj['وقت_الإنجاز'] = existing['وقت_الإنجاز'] || '';
  } else {
    obj['سبب_الإنجاز'] = '';
    obj['تاريخ_الإنجاز'] = '';
    obj['وقت_الإنجاز'] = '';
  }

  if (existing && previousStatus === 'done' && newStatus === 'pending') {
    // Transition: done -> pending. Stamp reopen metadata now.
    var reopenReasonEl = document.getElementById('fTaskReopenReason');
    obj['سبب_إعادة_الفتح'] = reopenReasonEl ? reopenReasonEl.value.trim() : '';
    obj['تاريخ_إعادة_الفتح'] = nowDateStr;
    obj['وقت_إعادة_الفتح'] = nowTimeStr;
  } else if (existing) {
    // Not a reopen transition — reopen date/time are still never touched
    // here (unchanged). The reason text, however, must not be silently
    // discarded: if the user actually typed something into the (visible,
    // since status==='pending' and hasCompletedBefore) fTaskReopenReason
    // textarea, that wins; only fall back to the previously stored reason
    // when the field is genuinely empty. PHASE 13.14 PART 2 FIX-A.
    var reopenReasonEl2 = document.getElementById('fTaskReopenReason');
    var typedReopenReason = reopenReasonEl2 ? reopenReasonEl2.value.trim() : '';
    obj['سبب_إعادة_الفتح'] = typedReopenReason || existing['سبب_إعادة_الفتح'] || '';
    obj['تاريخ_إعادة_الفتح'] = existing['تاريخ_إعادة_الفتح'] || '';
    obj['وقت_إعادة_الفتح'] = existing['وقت_إعادة_الفتح'] || '';
  } else {
    obj['سبب_إعادة_الفتح'] = '';
    obj['تاريخ_إعادة_الفتح'] = '';
    obj['وقت_إعادة_الفتح'] = '';
  }

  var result;

  if (idx >= 0) {
    var existingId = existing ? existing[TASKS_ID_FIELD] : null;
    result = await tasksRepository.update(existingId, obj);
  } else {
    result = await tasksRepository.create(obj);
  }

  if (!result || !result.success) {
    toast('حدث خطأ أثناء الحفظ', 'error');
    return;
  }

  syncTasksMirror();

  if (idx >= 0) {
    toast('تم التحديث', 'success');
  } else {
    toast('تمت الإضافة', 'success');
  }

  saveLocal();
  ApiService.syncRow('المهام', result.record, idx);   // replaces: if(API_URL)syncToSheets(...)
  closeModal('modalTask');
  renderTasks();
  updateBadges();
  // PHASE 16.5.1 — DIRTY PROPAGATION (additive only, see phase brief)
  if (window.ApplicationShell) { ApplicationShell.markDirty('tasks'); ApplicationShell.markDirty('dashboard'); }
}

/**
 * editTask — opens the task modal pre-filled with existing data.
 * Unchanged from before: purely a read of the (now Repository-backed)
 * data.tasks mirror, so it stays fully synchronous — no Repository call
 * needed here at all.
 * @param {number} i - 0-based index in the data.tasks mirror.
 */
function editTask(i) {
  editIdx.tasks = i;
  var fCompletionReasonEl = document.getElementById('fTaskCompletionReason');
  var fReopenReasonEl = document.getElementById('fTaskReopenReason');
  if (fCompletionReasonEl) fCompletionReasonEl.value = '';
  if (fReopenReasonEl) fReopenReasonEl.value = '';
  fillForm('tasks', data.tasks[i]);
  toggleTaskReasonFields();

  // PHASE 13.15 PART 2 — read-only "آخر إنجاز" / "آخر إعادة فتح" summary
  // shown just below the status field (#modalTask). Pure DOM display of
  // already-stored history fields (تاريخ_الإنجاز/وقت_الإنجاز/سبب_الإنجاز,
  // تاريخ_إعادة_الفتح/وقت_إعادة_الفتح/سبب_إعادة_الفتح) — no data is
  // written, no field the user can edit is added (div/span/small only,
  // per phase spec). Each block hides itself entirely when its date is
  // absent; the reason line hides itself when the reason is empty, so
  // nothing is ever shown twice or shown blank.
  var t = data.tasks[i];

  var lastCompletionInfo   = document.getElementById('taskLastCompletionInfo');
  var lastCompletionWhen   = document.getElementById('taskLastCompletionWhen');
  var lastCompletionRow    = document.getElementById('taskLastCompletionReasonRow');
  var lastCompletionReason = document.getElementById('taskLastCompletionReasonText');

  if (lastCompletionInfo && lastCompletionWhen && lastCompletionRow && lastCompletionReason) {
    if (t && t['تاريخ_الإنجاز']) {
      lastCompletionWhen.textContent = formatDate(t['تاريخ_الإنجاز']) +
        (t['وقت_الإنجاز'] ? ' الساعة ' + formatTime(t['وقت_الإنجاز']) : '');
      if (t['سبب_الإنجاز']) {
        lastCompletionReason.textContent = t['سبب_الإنجاز'];
        lastCompletionRow.style.display = '';
      } else {
        lastCompletionReason.textContent = '';
        lastCompletionRow.style.display = 'none';
      }
      lastCompletionInfo.style.display = '';
    } else {
      lastCompletionWhen.textContent = '';
      lastCompletionReason.textContent = '';
      lastCompletionRow.style.display = 'none';
      lastCompletionInfo.style.display = 'none';
    }
  }

  var lastReopenInfo   = document.getElementById('taskLastReopenInfo');
  var lastReopenWhen   = document.getElementById('taskLastReopenWhen');
  var lastReopenRow    = document.getElementById('taskLastReopenReasonRow');
  var lastReopenReason = document.getElementById('taskLastReopenReasonText');

  if (lastReopenInfo && lastReopenWhen && lastReopenRow && lastReopenReason) {
    if (t && t['تاريخ_إعادة_الفتح']) {
      lastReopenWhen.textContent = formatDate(t['تاريخ_إعادة_الفتح']) +
        (t['وقت_إعادة_الفتح'] ? ' الساعة ' + formatTime(t['وقت_إعادة_الفتح']) : '');
      if (t['سبب_إعادة_الفتح']) {
        lastReopenReason.textContent = t['سبب_إعادة_الفتح'];
        lastReopenRow.style.display = '';
      } else {
        lastReopenReason.textContent = '';
        lastReopenRow.style.display = 'none';
      }
      lastReopenInfo.style.display = '';
    } else {
      lastReopenWhen.textContent = '';
      lastReopenReason.textContent = '';
      lastReopenRow.style.display = 'none';
      lastReopenInfo.style.display = 'none';
    }
  }

  document.getElementById('modalTaskTitle').textContent = 'تعديل المهمة';
  document.getElementById('modalTask').classList.add('open');
}

/**
 * deleteTask — confirms, removes via TasksRepository.
 * @param {number} i - 0-based index in the data.tasks mirror.
 *
 * NOTE: Preserves original behaviour exactly — the original inline
 * deleteTask() does NOT call syncDeleteToSheets()/ApiService.deleteData()
 * for tasks, identical to the pre-existing gap already flagged for
 * deleteDocument(). This module makes no functional change to that
 * behaviour.
 *
 * Crosses the async boundary (Repository.delete() is Promise-returning)
 * — the only reason this function is now `async`.
 */
async function deleteTask(i) {
  if (!(await confirmDialog('هل تريد حذف هذه المهمة؟'))) return;

  await ensureTasksRepositoryReady();

  var record = data.tasks[i];
  if (!record) return;

  var id = record[TASKS_ID_FIELD];
  var result = await tasksRepository.delete(id);

  if (!result || !result.success) {
    toast('حدث خطأ أثناء الحذف', 'error');
    return;
  }

  syncTasksMirror();
  saveLocal();
  toast('تم الحذف', 'info');
  renderTasks();
  updateBadges();
  // PHASE 16.5.1 — DIRTY PROPAGATION (additive only, see phase brief)
  if (window.ApplicationShell) { ApplicationShell.markDirty('tasks'); ApplicationShell.markDirty('dashboard'); }
}

/**
 * restoreTask(id) — استرجاع مهمة محذوفة (Restore).
 * PHASE 10 — SUB-PHASE 10.4 — Restore Rollout (same pattern as Cases,
 * SUB-PHASE 10.3 — see docs/Restore_Rollout_Report.md).
 * Restores a soft-deleted task via `tasksRepository.restore(id)`
 * (inherited, unmodified, from SUB-PHASE 10.2's `Repository.prototype.
 * restore()`). Symmetric with `deleteTask()` above: same ready-guard,
 * same `syncTasksMirror()` -> `saveLocal()` -> `renderTasks()` ->
 * `updateBadges()` sequence.
 *
 * ID, NOT INDEX — same documented reason as `restoreCase()`.
 * NO UI WIRING — Rollout scope, matches the Pilot.
 * Does NOT call `ApiService` — same explicit, documented design
 * decision as `restoreCase()` (`deleteTask()` itself calls no
 * `ApiService` method either, so this preserves exact symmetry).
 *
 * @param {string} id - the TasksRepository id (رقم_المهمة) of the
 *   soft-deleted task to restore.
 */
async function restoreTask(id) {
  await ensureTasksRepositoryReady();

  var result = await tasksRepository.restore(id);

  if (!result || !result.success) {
    toast('حدث خطأ أثناء الاسترجاع', 'error');
    return;
  }

  syncTasksMirror();
  saveLocal();
  toast('تم الاسترجاع', 'success');
  renderTasks();
  updateBadges();
  // PHASE 16.5.1 — DIRTY PROPAGATION (additive only, see phase brief)
  if (window.ApplicationShell) { ApplicationShell.markDirty('tasks'); ApplicationShell.markDirty('dashboard'); }
}

/**
 * toggleTask — flips a task's status between 'pending' and 'done'.
 * @param {number} i - 0-based index in the data.tasks mirror.
 *
 * NOTE: Preserves original behaviour exactly — the original inline
 * toggleTask() does NOT sync the status change to GAS (no
 * syncToSheets()/ApiService.syncRow() call). This module makes no
 * functional change to that behaviour.
 *
 * Implemented as a partial `TasksRepository.update(id, {الحالة: ...})`
 * call rather than a full-record update — TasksRepository does not
 * expose a specialized `toggleStatus()` operation (see
 * TasksRepository.js file header "TOGGLE" note), so `update()` with
 * only the changed field is the correct, already-available substitute;
 * Repository.update() merges the patch onto the existing stored record
 * (Repository Contract), so no other field is disturbed.
 *
 * Crosses the async boundary (Repository.update() is Promise-returning)
 * — the only reason this function is now `async`.
 */
async function toggleTask(i) {
  await ensureTasksRepositoryReady();

  var record = data.tasks[i];
  if (!record) return;

  var id = record[TASKS_ID_FIELD];
  var newStatus = record['الحالة'] === 'done' ? 'pending' : 'done';
  var result = await tasksRepository.update(id, { 'الحالة': newStatus });

  if (!result || !result.success) return;

  syncTasksMirror();
  saveLocal();
  renderTasks();
  updateBadges();
  // PHASE 16.5.1 — DIRTY PROPAGATION (additive only, see phase brief)
  if (window.ApplicationShell) { ApplicationShell.markDirty('tasks'); ApplicationShell.markDirty('dashboard'); }
}

// ================================================================
// Node/test export (browser: `module` is undefined, this is a no-op —
// renderTasks/saveTask/editTask/deleteTask/toggleTask remain plain
// global functions exactly as before).
// ================================================================

// ================================================================
// UNDO / REDO — تراجع / إعادة (PHASE 12 — SUB-PHASE 12.5 — General Undo
// Integration)
// ================================================================
// Reversal mapping, redo-stack suspension, and instruction application
// are all handled by the shared js/core/UndoReconciler.js (extracted
// from the Cases pilot, SUB-PHASE 12.4 → 12.5) — this module only
// supplies its own `tasksRepository`/`TASKS_ID_FIELD` and its own refresh sequence
// (`sync/saveLocal/render/updateBadges/toast`), matching every other
// entity module's `restoreTask()` refresh sequence exactly.
//
// `tasksRepository` disables no operations (`unsupportedOperations: []`,
// confirmed in js/repositories/TasksRepository.js), so every reversal
// mapping case (create/update/delete/restore) is legal for this
// entity — same as Cases.

/**
 * undoLastTaskAction() — PHASE 12.5. Reverses the most recent
 * Tasks mutation (create/update/delete/restore). Mirrors
 * `undoLastCaseAction()` (js/modules/cases.js) exactly: same guard on
 * `canUndo()`, same use of the shared `UndoReconciler.applyUndoInstruction()`,
 * same refresh sequence, same graceful handling of empty history, a
 * Repository/persist failure, or any unexpected exception.
 * @returns {Promise<void>}
 */
async function undoLastTaskAction() {
  await ensureTasksRepositoryReady();

  try {
    if (!tasksRepository.canUndo()) {
      toast('لا يوجد إجراء للتراجع عنه', 'info');
      return;
    }

    var instruction = tasksRepository.undo();
    if (!instruction) {
      toast('لا يوجد إجراء للتراجع عنه', 'info');
      return;
    }

    if (!UndoReconciler) {
      toast('حدث خطأ أثناء التراجع', 'error');
      return;
    }

    var result = await UndoReconciler.applyUndoInstruction(tasksRepository, TASKS_ID_FIELD, instruction, 'undo');
    if (!result || !result.success) {
      toast('حدث خطأ أثناء التراجع', 'error');
      return;
    }

    syncTasksMirror();
    saveLocal();
    renderTasks();
    updateBadges();
    // PHASE 16.5.1 — DIRTY PROPAGATION (additive only, see phase brief)
    if (window.ApplicationShell) { ApplicationShell.markDirty('tasks'); ApplicationShell.markDirty('dashboard'); }
    toast('تم التراجع', 'success');
  } catch (e) {
    toast('حدث خطأ أثناء التراجع', 'error');
  }
}

/**
 * redoLastTaskAction() — PHASE 12.5. Re-applies the most recently
 * undone Tasks mutation. Same refresh sequence, same shared-utility
 * usage, same error-handling guarantees as `undoLastTaskAction()`
 * above — mirrors `redoLastCaseAction()` exactly.
 * @returns {Promise<void>}
 */
async function redoLastTaskAction() {
  await ensureTasksRepositoryReady();

  try {
    if (!tasksRepository.canRedo()) {
      toast('لا يوجد إجراء لإعادته', 'info');
      return;
    }

    var instruction = tasksRepository.redo();
    if (!instruction) {
      toast('لا يوجد إجراء لإعادته', 'info');
      return;
    }

    if (!UndoReconciler) {
      toast('حدث خطأ أثناء الإعادة', 'error');
      return;
    }

    var result = await UndoReconciler.applyUndoInstruction(tasksRepository, TASKS_ID_FIELD, instruction, 'redo');
    if (!result || !result.success) {
      toast('حدث خطأ أثناء الإعادة', 'error');
      return;
    }

    syncTasksMirror();
    saveLocal();
    renderTasks();
    updateBadges();
    // PHASE 16.5.1 — DIRTY PROPAGATION (additive only, see phase brief)
    if (window.ApplicationShell) { ApplicationShell.markDirty('tasks'); ApplicationShell.markDirty('dashboard'); }
    toast('تمت الإعادة', 'success');
  } catch (e) {
    toast('حدث خطأ أثناء الإعادة', 'error');
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    tasksUndoManager: tasksUndoManager,
    undoLastTaskAction: undoLastTaskAction,
    redoLastTaskAction: redoLastTaskAction,
    TASKS_FIELDS: TASKS_FIELDS,
    TASKS_MAP: TASKS_MAP,
    TASKS_ID_FIELD: TASKS_ID_FIELD,
    tasksRepository: tasksRepository,
    ensureTasksRepositoryReady: ensureTasksRepositoryReady,
    syncTasksMirror: syncTasksMirror,
    resolveTaskIndex: resolveTaskIndex,
    toggleTaskReasonFields: toggleTaskReasonFields,
    renderTasks: renderTasks,
    saveTask: saveTask,
    editTask: editTask,
    deleteTask: deleteTask,
    restoreTask: restoreTask,
    toggleTask: toggleTask
  };
}
