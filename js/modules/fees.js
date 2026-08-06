/**
 * ================================================================
 * js/modules/fees.js — وحدة الأتعاب | نظام الحسام للمحاماة
 * ================================================================
 * Contains ALL Fees-related functions extracted from index.html.
 *
 * PHASE 10 — SUB-PHASE 10.4 — Restore Rollout
 * ----------------------------------------------------------------
 * Additive-only addition on top of PHASE 9.9 below: a new
 * `restoreFee(id)` function (see its own doc comment, next to
 * `deleteFee()`), same Cases-piloted pattern (SUB-PHASE 10.3). No
 * existing function in this file was changed. See
 * docs/Restore_Rollout_Report.md for the full audit and verification
 * evidence.
 *
 * PHASE 9 — SUB-PHASE 9.9 — Repository Integration (Fees Module)
 * ----------------------------------------------------------------
 * This module now reads and writes through js/repositories/
 * FeesRepository.js instead of the legacy global `data.fees` array
 * directly. Nothing else in the project was changed to make this
 * happen: FeesRepository.js, Repository.js, DatabaseService.js and
 * LocalStorageAdapter.js are all used exactly as PHASE 5/PHASE 8 left
 * them (no edits, no imports of internals). This follows the same
 * proven pattern used for the Documents module (SUB-PHASE 9.3), the
 * Sessions module (SUB-PHASE 9.4), the Tasks module (SUB-PHASE 9.5),
 * the Library module (SUB-PHASE 9.6), the Templates module
 * (SUB-PHASE 9.7), and the Children module (SUB-PHASE 9.8).
 *
 * WHY `data.fees` STILL EXISTS BELOW
 *   js/modules/dashboard.js (`data.fees` totals for the sidebar/summary
 *   widgets) reads the global `data.fees` array directly, and this
 *   phase's mandate is "Modify ONLY fees.js" — dashboard.js may not be
 *   touched. So `data.fees` is kept alive as a read-only MIRROR of
 *   `FeesRepository.getAll()`, refreshed after every Repository
 *   read/write this file performs. Every other module keeps working
 *   unmodified and unaware that Fees moved to the Repository.
 *
 * CROSS-MODULE READ FROM CASES — NOT TOUCHED HERE
 *   Per this phase's "SPECIAL REQUIREMENTS", Fees reads data from Cases
 *   for display/lookup purposes (the case-number dropdown pre-filled by
 *   `populateCaseDropdown()`, and the client-name autofill performed by
 *   `autofillFeeFromCase()`). Both of those live in js/modules/cases.js
 *   and read `data.cases` directly — this file never reads `data.cases`
 *   itself (confirmed by a full audit of the pre-migration file: no
 *   `data.cases` reference exists anywhere in fees.js), so `cases.js`
 *   and `data.cases` require no changes at all to preserve this
 *   behavior. This module simply keeps calling `populateCaseDropdown()`
 *   exactly as before — the same "mirror strategy" precedent already
 *   used for Documents/Sessions/Tasks/Library/Templates/Children, each
 *   of which also calls into cases.js's dropdown helper without owning
 *   any Cases data itself.
 *
 * READ / WRITE SPLIT (this phase's rule)
 *   - Reads (`renderFees`) call the Repository's SYNCHRONOUS methods
 *     only (`getAll()`, `search()`) — no unnecessary async.
 *   - Writes (`saveFee`, `deleteFee`) are the ONLY functions in this
 *     file that cross the async boundary, because
 *     Repository.create()/update()/delete() are Promise-returning
 *     (Repository Contract §3 — Validate -> Write Local -> Persist).
 *   - `editFee` stays 100% synchronous and unchanged: it only reads the
 *     already-synced `data.fees` mirror to pre-fill the modal, exactly
 *     like before.
 *
 * INDEX -> RECORD -> ID TRANSLATION LAYER
 *   The rendered HTML still embeds plain 0-based array indexes in its
 *   `onclick="editFee(N)"` / `onclick="deleteFee(N)"` attributes
 *   (index.html's row templates were not changed, per this phase's rule
 *   "Do NOT modify generated HTML unless absolutely necessary"). Because
 *   FeesRepository.search()/getAll() return CLONED records (not the same
 *   object references `data.fees` used to hold), the old
 *   `data.fees.indexOf(f)` reference-equality trick no longer works.
 *   `resolveFeeIndex()` below is the smallest possible replacement: it
 *   looks a record up in the current mirror by its identifier field
 *   (`رقم_العملية`) instead of by reference. `editFee(i)` / `deleteFee(i)`
 *   then resolve that same index back to a record, and `deleteFee`/
 *   `saveFee` go one step further and resolve the record to its
 *   `رقم_العملية` id before calling `FeesRepository.update()/delete()`
 *   (both take an id, not an index).
 *
 * SOFT DELETE — OBSERVABLE BEHAVIOR NOTE
 *   FeesRepository is configured with `softDelete: true` (unchanged, not
 *   this phase's decision to make). `delete(id)` therefore keeps the
 *   record in storage with a `deletedAt` stamp instead of physically
 *   removing it, unlike the original `data.fees.splice(i,1)`.
 *   `getAll()`/`search()` both exclude soft-deleted records by default,
 *   so nothing deleted ever reappears anywhere `data.fees` is read (this
 *   file, dashboard.js) — the UI-observable behavior is therefore
 *   identical to a hard delete.
 *
 * IDENTIFIER GENERATION NOTE
 *   The original inline `saveFee()` stamped
 *   `obj['رقم_العملية'] = obj['رقم_العملية'] || uid();` on the plain
 *   object before pushing/assigning it. `FeesRepository._resolveId()`
 *   (js/repositories/FeesRepository.js) already replicates this exact
 *   fallback internally on `create()` (generate only when absent), so
 *   this module does not need to duplicate that stamp — `create(obj)`
 *   assigns the id itself, exactly as `saveDocument()`/`saveSession()`/
 *   `saveTask()`/`saveChild()` rely on their own Repositories to assign
 *   the id.
 *
 * TOTALS/COUNT — UNFILTERED, COMPUTED BEFORE THE EMPTY-STATE RETURN
 *   The original inline `renderFees()` computes `#feesTotalNum` and
 *   `#feesCountNum` from the FULL, unfiltered `data.fees` array — not
 *   from the search-filtered rows — and does so BEFORE the empty-state
 *   early return, so the statistics always reflect all fee records
 *   regardless of the current search term. This module preserves that
 *   exact structure: the (now Repository-backed) `data.fees` mirror is
 *   synced first, the totals/count are read off that full mirror before
 *   any early return, and only the rows actually rendered in the
 *   table/mobile list come from `FeesRepository.search()`.
 *
 * SEARCH — the free-text `#searchFees` join (`Object.values(f).
 *   join(' ').toLowerCase().includes(s)`) is preserved bit-for-bit:
 *   `FeesRepository._matchesSearch()` replicates the exact same join
 *   across `FEES_LEGACY_FIELDS`. No filter control and no sort exist on
 *   the Fees page — matching the original inline `renderFees()`, which
 *   never called `.sort()` (insertion order only) and never read any
 *   filter dropdown (unlike Documents' #filterDocType or Tasks'
 *   #filterTaskPriority).
 *
 * Depends on (globals expected from index.html / prior scripts):
 *   - data              : shared app data object  { fees, cases, … }
 *   - editIdx           : shared edit-index map   { fees: -1 }
 *   - ApiService        : api.js layer (replaces direct syncToSheets /
 *                         syncDeleteToSheets calls)
 *   - saveLocal()       : localStorage persistence helper
 *   - toast()           : UI notification helper
 *   - updateBadges()    : badge counter updater
 *   - closeModal()      : modal close helper
 *   - formatDate()      : date formatter          (from ui-utils.js)
 *   - val()             : getElementById+.value   (from ui-utils.js)
 *   - uid()             : unique-ID generator     (from ui-utils.js) —
 *                         no longer called directly by this file (see
 *                         IDENTIFIER GENERATION NOTE), kept in the
 *                         dependency list only because js/ui-utils.js is
 *                         still a load-order requirement of this file.
 *   - collectForm()     : generic form-to-object  (from ui-utils.js)
 *   - fillForm()        : generic object-to-form  (from ui-utils.js)
 *   - populateCaseDropdown() : defined in cases.js
 *   - FeesRepository    : js/repositories/FeesRepository.js (loaded the
 *                         same dual Node/browser way every Repository
 *                         file already loads its own dependencies)
 *
 * GAS Sheet name: 'الأتعاب'
 *
 * Does NOT touch:
 *   - CSS / HTML structure
 *   - Other modules (cases, clients, sessions, documents, tasks, …)
 *   - `autofillFeeFromCase()` — pre-fills the client name in the fee
 *     modal from the selected case; this lives in cases.js and reads
 *     `data.cases`, so it is owned by the Cases module, not Fees
 *     (same precedent as `autofillSessionFromCase()` belonging to
 *     cases.js rather than sessions.js)
 *   - Google Apps Script backend
 *   - Database / sheet structure
 *   - ApiService internals
 *   - js/core/Repository.js, DatabaseService.js, StorageAdapter.js,
 *     LocalStorageAdapter.js, js/repositories/FeesRepository.js
 * ================================================================
 */

'use strict';

// ================================================================
// FIELDS & MAP — fees slice only (unchanged)
// ================================================================

var FEES_FIELDS = [
  'fFeeCaseNum',
  'fFeeClient',
  'fFeeType',
  'fFeeAmount',
  'fFeeDate',
  'fFeeMethod',
  'fFeeNotes'
];

var FEES_MAP = {
  fFeeCaseNum: 'رقم_القضية',
  fFeeClient:  'اسم_الموكل',
  fFeeType:    'نوع_الأتعاب',
  fFeeAmount:  'المبلغ',
  fFeeDate:    'تاريخ_الاستلام',
  fFeeMethod:  'طريقة_الدفع',
  fFeeNotes:   'الملاحظات'
};

/**
 * Identifier field name — must match FeesRepository's own
 * FEES_ID_FIELD constant exactly (js/repositories/FeesRepository.js,
 * §1). Duplicated here rather than imported, same "depends only on its
 * own declared dependency" discipline every Repository-integrated
 * module already uses for its own local constants — this file's one
 * declared new dependency is FeesRepository itself, not its internals.
 */
var FEES_ID_FIELD = 'رقم_العملية';

// ================================================================
// REPOSITORY WIRING — PHASE 9 / SUB-PHASE 9.9
// ================================================================
// Same dual Node/browser loading shape already used by every file under
// js/repositories/ and js/core/: `require()` when running under Node
// (module.exports exists — this is how js/tests/verify_fees_
// repository_integration.js loads this file), otherwise the browser
// global `window.FeesRepository` (populated once index.html's <script>
// tags load js/core/Repository.js, DatabaseService.js,
// LocalStorageAdapter.js and js/repositories/FeesRepository.js ahead of
// this file — adding those tags to index.html is explicitly out of
// scope for this phase's "Modify ONLY fees.js" mandate).

var FeesRepositoryNS = (typeof module !== 'undefined' && module.exports)
  ? require('../repositories/FeesRepository.js')
  : (typeof window !== 'undefined' ? window : this);

var FeesRepository = FeesRepositoryNS && FeesRepositoryNS.FeesRepository;

if (typeof FeesRepository !== 'function') {
  throw new Error(
    'fees.js requires js/repositories/FeesRepository.js to be ' +
    'loaded first (FeesRepository class not found).'
  );
}

/**
 * The single FeesRepository instance this module talks to. Default
 * construction (no config) wires it to the real DatabaseService +
 * LocalStorageAdapter pair, reading/writing the exact same 'fees'
 * localStorage key `data.fees` always used.
 */
var feesRepository = new FeesRepository();

/**
 * PHASE 12 — SUB-PHASE 12.5 — General Undo Integration.
 * js/core/UndoManager.js and js/core/UndoReconciler.js are required
 * here the same dual Node/browser way feesRepository is required above,
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
      'fees.js: js/core/UndoManager.js was not found (index.html has ' +
      'not yet added its <script> tag for it). This module continues ' +
      'to work exactly as before this phase; undoLastFeeAction()/' +
      'redoLastFeeAction() will simply report nothing to undo/redo ' +
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
      'fees.js: js/core/UndoReconciler.js was not found (index.html has ' +
      'not yet added its <script> tag for it). undoLastFeeAction()/' +
      'redoLastFeeAction() will simply report nothing to undo/redo ' +
      'until this dependency is wired.'
    );
  }
  UndoReconciler = null;
}

/**
 * FeesUndoManager — PHASE 12.5: the single UndoManager instance
 * wired to `feesRepository` via the public `setUndoManager()` façade
 * (SUB-PHASE 12.3, js/core/Repository.js, NOT modified by this phase).
 * Each entity module constructs and wires its OWN UndoManager instance
 * — this one is never shared with any other module — so that
 * Undo/Redo history for Fees stays completely separate from every
 * other entity's history (Phase 12.5 brief §11), exactly as already
 * true for `casesUndoManager` in js/modules/cases.js.
 */
var feesUndoManager = (typeof UndoManager === 'function') ? new UndoManager(feesRepository) : null;
if (feesUndoManager) {
  feesRepository.setUndoManager(feesUndoManager);
}

/**
 * Resolves once FeesRepository.open() has loaded its initial in-memory
 * copy from storage (Repository Contract §11: Create -> Open -> Ready).
 * Every write path awaits this before touching the Repository;
 * renderFees()/editFee() stay synchronous and simply no-op / read a
 * possibly-stale mirror in the vanishingly small window before this
 * resolves (see file header "READ / WRITE SPLIT").
 */
var feesRepositoryReadyPromise = (function () {
  var _p = feesRepository.open().then(function () {
    syncFeesMirror();
  }).catch(function (err) {
    // Surface the failure without throwing out of a top-level Promise
    // chain (would otherwise be an unhandled rejection). renderFees()
    // guards on isReady() and simply shows nothing until this is fixed.
    if (typeof console !== 'undefined' && console.error) {
      console.error('FeesRepository failed to open:', err);
    }
  });
  // PHASE 17.0 — Startup Reliability: bound this Promise so a stuck
  // feesRepository.open() can never hang ensureFeesRepositoryReady()
  // forever. See js/core/RepositoryReadyTimeout.js. Purely additive:
  // if that helper isn't loaded, _p is returned completely unwrapped.
  return (typeof RepositoryReadyTimeout !== 'undefined') ? RepositoryReadyTimeout.wrap('fees', _p) : _p;
})();

/**
 * ensureFeesRepositoryReady() — awaited by every write path. open()
 * itself is idempotent (Repository.prototype.open() returns immediately
 * if already 'ready'/'busy'), so calling this more than once is always
 * safe and cheap.
 * @returns {Promise<void>}
 */
function ensureFeesRepositoryReady() {
  if (feesRepository.isReady()) return Promise.resolve();
  return feesRepositoryReadyPromise;
}

/**
 * syncFeesMirror — refreshes the legacy global `data.fees` array from
 * the Repository's current state (soft-deleted records excluded, same
 * as the Repository's own getAll() default). Called after open() and
 * after every create/update/delete this module performs, so
 * dashboard.js keeps seeing accurate data without being touched itself.
 */
function syncFeesMirror() {
  data.fees = feesRepository.getAll();
}

/**
 * resolveFeeIndex(list, record) — the index half of the "index ->
 * record -> id" translation layer (see file header). Finds `record`'s
 * position inside `list` by identifier equality (`رقم_العملية`),
 * replacing the old `data.fees.indexOf(f)` reference-equality lookup
 * that no longer works now that Repository reads return cloned objects.
 * @param {Object[]} list
 * @param {Object} record
 * @returns {number} 0-based index, or -1 if not found.
 */
function resolveFeeIndex(list, record) {
  var id = record ? record[FEES_ID_FIELD] : undefined;
  for (var i = 0; i < list.length; i++) {
    if (list[i][FEES_ID_FIELD] === id) return i;
  }
  return -1;
}

// ================================================================
// RENDER — عرض قائمة الأتعاب + الإحصائيات
// ================================================================

/**
 * renderFees — renders the fees table + mobile cards, and updates the
 * totals/count statistics.
 * Reads: FeesRepository (search + getAll — both synchronous), searchFees
 * filter.
 * Writes to: #feesTableBody, #feesMobileList, #feesEmpty,
 *            #feesTotalNum, #feesCountNum.
 *
 * NOTE: there is no standalone searchFees()/filterFees() function in
 * the original app — the search box (#searchFees) is read directly
 * from the DOM via val() and applied via the Repository's Query Model,
 * and there is no separate fee-status/type filter control at all
 * (unlike Documents' #filterDocType or Tasks' #filterTaskPriority).
 * This module preserves that exact structure.
 *
 * NOTE: the totals (#feesTotalNum) and count (#feesCountNum) are
 * computed from the FULL, unfiltered data.fees mirror — not from the
 * search-filtered `rows` — and are updated *before* the empty-state
 * early return. This means the statistics always reflect all fee
 * records regardless of the current search term, exactly matching the
 * original inline behaviour (see file header "TOTALS/COUNT" note).
 *
 * PHASE 16.13 — DomRecycler Migration (Fees)
 * ----------------------------------------------------------------
 * Full read-only investigation (Phase 16.13 review, see handoff report)
 * found renderFees() uses TWO containers — #feesTableBody (<tr>, no
 * className) and #feesMobileList (<div class="m-card">) — the exact
 * same dual-container shape as renderCases() (PHASE 16.6), NOT the
 * single-container shape of Sessions/Documents/Clients. Both outer
 * className values are fixed literals (no variable className found),
 * so per the Phase 16.9 options.attrs() contract this migration
 * deliberately omits options.attrs entirely, exactly like Cases.
 *
 * feeRowInner()/feeCardInner() below are the EXACT SAME markup strings
 * this function has always built per fee record — moved out of the
 * inline .map() callbacks into named functions so the SAME template
 * logic is shared by DomRecycler (new path) and the untouched legacy
 * full-rebuild path (fallback). Only the outer wrapper tags
 * (<tr>...</tr> / <div class="m-card">...</div>) moved: DomNodeFactory
 * now owns creating those wrapper elements.
 *
 * No js/core/dom/* file is touched by this phase.
 */
function renderFees() {
  // Defensive only — see feesRepositoryReadyPromise's doc comment. In
  // normal page load order this is always true by the time any
  // onclick/oninput can fire, since open() resolves via microtasks that
  // drain before the browser dispatches its first user-facing event.
  if (!feesRepository.isReady()) return;

  var s = val('searchFees').toLowerCase();

  syncFeesMirror();
  var allFees = data.fees;

  var tb = document.getElementById('feesTableBody');
  var em = document.getElementById('feesEmpty');
  var ml = document.getElementById('feesMobileList');

  var total = allFees.reduce(function(acc, f) {
    return acc + (parseFloat(f['المبلغ']) || 0);
  }, 0);
  document.getElementById('feesTotalNum').textContent = total.toLocaleString('ar-EG');
  document.getElementById('feesCountNum').textContent = allFees.length;

  var queryModel = {};
  if (s) queryModel.search = s;
  var rows = feesRepository.search(queryModel).items;

  if (!rows.length) {
    tb.innerHTML = '';
    ml.innerHTML = '';
    // PHASE 16.13 — SAFETY: the two lines above wipe both containers'
    // real children directly (not through DomRecycler), so any
    // key->node references DomKeyIndex is holding for them would now
    // point at detached/dead nodes. Reset both so the next non-empty
    // render starts clean instead of reusing dead references.
    // Additive only — window.DomKeyIndex may be undefined if
    // js/core/dom/ isn't loaded, hence the guard (same pattern as
    // cases.js/tasks.js/sessions.js/documents.js).
    if (window.DomKeyIndex) { DomKeyIndex.reset(tb); DomKeyIndex.reset(ml); }
    em.style.display = '';
    return;
  }
  em.style.display = 'none';

  // ----------------------------------------------------------------
  // PHASE 16.13 — DomRecycler Migration (Fees)
  // ----------------------------------------------------------------
  // feeRowInner()/feeCardInner() are the EXACT SAME markup this
  // function has always built for each fee — narrowed from "whole
  // container" to "one row/card at a time", exactly like
  // desktopRowInner()/mobileCardInner() in cases.js.

  function feeRowInner(f) {
    var ri = resolveFeeIndex(allFees, f);
    return (
      '<td style="color:var(--gold)">' + (f['رقم_القضية'] || '—') + '</td>' +
      '<td>' + (f['اسم_الموكل'] || '—') + '</td>' +
      '<td>' + (f['نوع_الأتعاب'] || '—') + '</td>' +
      '<td><strong style="color:var(--success)">' +
        (f['المبلغ'] ? Number(f['المبلغ']).toLocaleString('ar-EG') + ' ج.م' : '—') +
      '</strong></td>' +
      '<td>' + formatDate(f['تاريخ_الاستلام']) + '</td>' +
      '<td>' + (f['طريقة_الدفع'] || '—') + '</td>' +
      '<td><small>' + (f['الملاحظات'] || '—') + '</small></td>' +
      '<td>' +
        '<button class="btn btn-ghost btn-sm btn-icon" onclick="editFee(' + ri + ')">&#9998;</button> ' +
        '<button class="btn btn-danger btn-sm btn-icon" onclick="deleteFee(' + ri + ')">&#128465;</button>' +
      '</td>'
    );
  }

  function feeCardInner(f) {
    var ri = resolveFeeIndex(allFees, f);
    return (
      '<div class="m-card-header">' +
        '<div class="m-card-title">&#128176; ' + (f['اسم_الموكل'] || '—') + '</div>' +
        '<div class="m-card-num" style="color:var(--success)">' +
          (f['المبلغ'] ? Number(f['المبلغ']).toLocaleString('ar-EG') + ' ج.م' : '—') +
        '</div>' +
      '</div>' +
      '<div class="m-card-meta">' +
        '<span>&#9878; ' + (f['رقم_القضية'] || '—') + '</span>' +
        '<span>&#128203; ' + (f['نوع_الأتعاب'] || '—') + '</span>' +
        '<span>&#128197; ' + formatDate(f['تاريخ_الاستلام']) + '</span>' +
      '</div>' +
      '<div class="m-card-actions">' +
        '<button class="btn btn-ghost btn-sm" onclick="editFee(' + ri + ')" style="flex:1;">&#9998; تعديل</button>' +
        '<button class="btn btn-danger btn-sm btn-icon" onclick="deleteFee(' + ri + ')">&#128465;</button>' +
      '</div>'
    );
  }

  // رقم_العملية only — stable identity, exactly like caseRowKey()/
  // sessionRowKey()/clientRowKey().
  function feeRowKey(f) { return f[FEES_ID_FIELD]; }

  var recycled = false;
  if (window.DomRecycler && typeof DomRecycler.reconcile === 'function') {
    try {
      DomRecycler.reconcile(tb, rows, { key: feeRowKey, tag: 'tr', render: feeRowInner });
      DomRecycler.reconcile(ml, rows, { key: feeRowKey, tag: 'div', className: 'm-card', render: feeCardInner });
      recycled = true;
    } catch (domRecyclerError) {
      // PHASE 16.13 SAFETY (unchanged pattern): any recycler failure
      // falls straight back to the legacy full-rebuild path below, and
      // drops whatever partial key-index state the failed attempt may
      // have left behind so the NEXT render (recycled or not) never
      // inherits it.
      recycled = false;
      if (window.DomKeyIndex) { DomKeyIndex.reset(tb); DomKeyIndex.reset(ml); }
    }
  }

  if (!recycled) {
    // ORIGINAL PHASE ≤16.12 implementation — UNCHANGED (full rebuild),
    // kept exactly as the guaranteed-safe fallback path. Uses the SAME
    // feeRowInner()/feeCardInner() template functions defined above,
    // just with the outer wrapper tags restored around them.
    tb.innerHTML = rows.map(function(f) {
      return '<tr>' + feeRowInner(f) + '</tr>';
    }).join('');

    ml.innerHTML = rows.map(function(f) {
      return '<div class="m-card">' + feeCardInner(f) + '</div>';
    }).join('');
  }
}

// ================================================================
// CRUD — حفظ / تعديل / حذف
// ================================================================

/**
 * saveFee — validates, saves through FeesRepository, syncs to GAS.
 * Replaces: inline saveFee() in index.html <script> block.
 * ApiService.syncRow() replaces the original syncToSheets() call, same
 * as before.
 *
 * Crosses the async boundary (Repository.create()/update() are
 * Promise-returning) — the only reason this function is now `async`.
 */
async function saveFee() {
  var c = document.getElementById('fFeeCaseNum').value.trim();
  var a = document.getElementById('fFeeAmount').value;
  if (!c || !a) {
    toast('يرجى ملء رقم القضية والمبلغ', 'error');
    return;
  }

  await ensureFeesRepositoryReady();

  var obj = collectForm('fees');
  // Note: obj['رقم_العملية'] is intentionally NOT stamped here — see file
  // header "IDENTIFIER GENERATION NOTE": FeesRepository.create()
  // generates it internally (only when absent), exactly replicating the
  // original `|| uid()` fallback. FeesRepository.update() always
  // preserves the existing record's id regardless of what is in obj.
  obj['تاريخ_الإنشاء'] = obj['تاريخ_الإنشاء'] || new Date().toISOString();

  var idx = editIdx.fees;
  var result;

  if (idx >= 0) {
    var existing = data.fees[idx];
    var existingId = existing ? existing[FEES_ID_FIELD] : null;
    result = await feesRepository.update(existingId, obj);
  } else {
    result = await feesRepository.create(obj);
  }

  if (!result || !result.success) {
    toast('حدث خطأ أثناء الحفظ', 'error');
    return;
  }

  syncFeesMirror();

  if (idx >= 0) {
    toast('تم التحديث', 'success');
  } else {
    toast('تم التسجيل', 'success');
  }

  saveLocal();
  ApiService.syncRow('الأتعاب', result.record, idx);   // replaces: if(API_URL)syncToSheets(...)
  closeModal('modalFee');
  renderFees();
  updateBadges();
  // PHASE 16.5.1 — DIRTY PROPAGATION (additive only, see phase brief)
  if (window.ApplicationShell) { ApplicationShell.markDirty('fees'); }
}

/**
 * editFee — opens the fee modal pre-filled with existing data.
 * Unchanged from before: purely a read of the (now Repository-backed)
 * data.fees mirror, so it stays fully synchronous — no Repository call
 * needed here at all.
 * @param {number} i - 0-based index in the data.fees mirror.
 */
function editFee(i) {
  editIdx.fees = i;
  populateCaseDropdown('fFeeCaseNum', data.fees[i]['رقم_القضية']);
  fillForm('fees', data.fees[i]);
  document.getElementById('modalFeeTitle').textContent = 'تعديل الأتعاب';
  document.getElementById('modalFee').classList.add('open');
}

/**
 * deleteFee — confirms, removes via FeesRepository.
 * @param {number} i - 0-based index in the data.fees mirror.
 *
 * NOTE: Preserves original behaviour exactly — the original inline
 * deleteFee() does NOT call syncDeleteToSheets()/ApiService.deleteData()
 * for fees, identical to the pre-existing gap already flagged for
 * deleteDocument() (DOCUMENTS_AUDIT_REPORT.md OBS-1/FIX-3) and
 * deleteTask()/toggleTask() (TASKS_AUDIT_REPORT.md FIX-3). This module
 * makes no functional change to that behaviour.
 *
 * Crosses the async boundary (Repository.delete() is Promise-returning)
 * — the only reason this function is now `async`.
 */
async function deleteFee(i) {
  if (!(await confirmDialog('هل تريد حذف قيد الأتعاب هذا؟'))) return;

  await ensureFeesRepositoryReady();

  var record = data.fees[i];
  if (!record) return;

  var id = record[FEES_ID_FIELD];
  var result = await feesRepository.delete(id);

  if (!result || !result.success) {
    toast('حدث خطأ أثناء الحذف', 'error');
    return;
  }

  syncFeesMirror();
  saveLocal();
  toast('تم الحذف', 'info');
  renderFees();
  updateBadges();
  // PHASE 16.5.1 — DIRTY PROPAGATION (additive only, see phase brief)
  if (window.ApplicationShell) { ApplicationShell.markDirty('fees'); }
}

/**
 * restoreFee(id) — استرجاع عملية أتعاب محذوفة (Restore).
 * PHASE 10 — SUB-PHASE 10.4 — Restore Rollout (same pattern as Cases,
 * SUB-PHASE 10.3 — see docs/Restore_Rollout_Report.md).
 * Restores a soft-deleted fee record via `feesRepository.restore(id)`
 * (inherited, unmodified, from SUB-PHASE 10.2's `Repository.prototype.
 * restore()`). Symmetric with `deleteFee()` above: same ready-guard,
 * same `syncFeesMirror()` -> `saveLocal()` -> `renderFees()` ->
 * `updateBadges()` sequence.
 *
 * ID, NOT INDEX — same documented reason as `restoreCase()`.
 * NO UI WIRING — Rollout scope, matches the Pilot.
 * Does NOT call `ApiService` — same explicit, documented design
 * decision as `restoreCase()` (`deleteFee()` itself calls no
 * `ApiService` method either, so this preserves exact symmetry).
 *
 * @param {string} id - the FeesRepository id (رقم_العملية) of the
 *   soft-deleted fee record to restore.
 */
async function restoreFee(id) {
  await ensureFeesRepositoryReady();

  var result = await feesRepository.restore(id);

  if (!result || !result.success) {
    toast('حدث خطأ أثناء الاسترجاع', 'error');
    return;
  }

  syncFeesMirror();
  saveLocal();
  toast('تم الاسترجاع', 'success');
  renderFees();
  updateBadges();
  // PHASE 16.5.1 — DIRTY PROPAGATION (additive only, see phase brief)
  if (window.ApplicationShell) { ApplicationShell.markDirty('fees'); }
}

// ================================================================
// Node/test export (browser: `module` is undefined, this is a no-op —
// renderFees/saveFee/editFee/deleteFee remain plain global functions
// exactly as before).
// ================================================================

// ================================================================
// UNDO / REDO — تراجع / إعادة (PHASE 12 — SUB-PHASE 12.5 — General Undo
// Integration)
// ================================================================
// Reversal mapping, redo-stack suspension, and instruction application
// are all handled by the shared js/core/UndoReconciler.js (extracted
// from the Cases pilot, SUB-PHASE 12.4 → 12.5) — this module only
// supplies its own `feesRepository`/`FEES_ID_FIELD` and its own refresh sequence
// (`sync/saveLocal/render/updateBadges/toast`), matching every other
// entity module's `restoreFee()` refresh sequence exactly.
//
// `feesRepository` disables no operations (`unsupportedOperations: []`,
// confirmed in js/repositories/FeesRepository.js), so every reversal
// mapping case (create/update/delete/restore) is legal for this
// entity — same as Cases.

/**
 * undoLastFeeAction() — PHASE 12.5. Reverses the most recent
 * Fees mutation (create/update/delete/restore). Mirrors
 * `undoLastCaseAction()` (js/modules/cases.js) exactly: same guard on
 * `canUndo()`, same use of the shared `UndoReconciler.applyUndoInstruction()`,
 * same refresh sequence, same graceful handling of empty history, a
 * Repository/persist failure, or any unexpected exception.
 * @returns {Promise<void>}
 */
async function undoLastFeeAction() {
  await ensureFeesRepositoryReady();

  try {
    if (!feesRepository.canUndo()) {
      toast('لا يوجد إجراء للتراجع عنه', 'info');
      return;
    }

    var instruction = feesRepository.undo();
    if (!instruction) {
      toast('لا يوجد إجراء للتراجع عنه', 'info');
      return;
    }

    if (!UndoReconciler) {
      toast('حدث خطأ أثناء التراجع', 'error');
      return;
    }

    var result = await UndoReconciler.applyUndoInstruction(feesRepository, FEES_ID_FIELD, instruction, 'undo');
    if (!result || !result.success) {
      toast('حدث خطأ أثناء التراجع', 'error');
      return;
    }

    syncFeesMirror();
    saveLocal();
    renderFees();
    updateBadges();
    // PHASE 16.5.1 — DIRTY PROPAGATION (additive only, see phase brief)
    if (window.ApplicationShell) { ApplicationShell.markDirty('fees'); }
    toast('تم التراجع', 'success');
  } catch (e) {
    toast('حدث خطأ أثناء التراجع', 'error');
  }
}

/**
 * redoLastFeeAction() — PHASE 12.5. Re-applies the most recently
 * undone Fees mutation. Same refresh sequence, same shared-utility
 * usage, same error-handling guarantees as `undoLastFeeAction()`
 * above — mirrors `redoLastCaseAction()` exactly.
 * @returns {Promise<void>}
 */
async function redoLastFeeAction() {
  await ensureFeesRepositoryReady();

  try {
    if (!feesRepository.canRedo()) {
      toast('لا يوجد إجراء لإعادته', 'info');
      return;
    }

    var instruction = feesRepository.redo();
    if (!instruction) {
      toast('لا يوجد إجراء لإعادته', 'info');
      return;
    }

    if (!UndoReconciler) {
      toast('حدث خطأ أثناء الإعادة', 'error');
      return;
    }

    var result = await UndoReconciler.applyUndoInstruction(feesRepository, FEES_ID_FIELD, instruction, 'redo');
    if (!result || !result.success) {
      toast('حدث خطأ أثناء الإعادة', 'error');
      return;
    }

    syncFeesMirror();
    saveLocal();
    renderFees();
    updateBadges();
    // PHASE 16.5.1 — DIRTY PROPAGATION (additive only, see phase brief)
    if (window.ApplicationShell) { ApplicationShell.markDirty('fees'); }
    toast('تمت الإعادة', 'success');
  } catch (e) {
    toast('حدث خطأ أثناء الإعادة', 'error');
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    feesUndoManager: feesUndoManager,
    undoLastFeeAction: undoLastFeeAction,
    redoLastFeeAction: redoLastFeeAction,
    FEES_FIELDS: FEES_FIELDS,
    FEES_MAP: FEES_MAP,
    FEES_ID_FIELD: FEES_ID_FIELD,
    feesRepository: feesRepository,
    ensureFeesRepositoryReady: ensureFeesRepositoryReady,
    syncFeesMirror: syncFeesMirror,
    resolveFeeIndex: resolveFeeIndex,
    renderFees: renderFees,
    saveFee: saveFee,
    editFee: editFee,
    deleteFee: deleteFee,
    restoreFee: restoreFee
  };
}
