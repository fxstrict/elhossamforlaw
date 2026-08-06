/**
 * ================================================================
 * js/modules/documents.js — وحدة المستندات | نظام الحسام للمحاماة
 * ================================================================
 * Contains ALL Documents-related functions extracted from index.html.
 *
 * PHASE 10 — SUB-PHASE 10.4 — Restore Rollout
 * ----------------------------------------------------------------
 * Additive-only addition on top of PHASE 9.3 below: a new
 * `restoreDocument(id)` function (see its own doc comment, next to
 * `deleteDocument()`), same Cases-piloted pattern (SUB-PHASE 10.3). No
 * existing function in this file was changed. See
 * docs/Restore_Rollout_Report.md for the full audit and verification
 * evidence.
 *
 * PHASE 9 — SUB-PHASE 9.3 — Repository Integration Pilot
 * ----------------------------------------------------------------
 * This module now reads and writes through js/repositories/
 * DocumentsRepository.js instead of the legacy global `data.documents`
 * array directly. Nothing else in the project was changed to make this
 * happen: DocumentsRepository.js, Repository.js, DatabaseService.js and
 * LocalStorageAdapter.js are all used exactly as PHASE 5/PHASE 8 left
 * them (no edits, no imports of internals).
 *
 * WHY `data.documents` STILL EXISTS BELOW
 *   js/modules/cases.js (`data.documents.filter(...)` twice) and
 *   js/modules/dashboard.js (`data.documents.length`) both read the
 *   global `data.documents` array directly, and this phase's mandate is
 *   "Modify ONLY documents.js" — neither of those Modules may be touched.
 *   So `data.documents` is kept alive as a read-only MIRROR of
 *   `DocumentsRepository.getAll()`, refreshed after every Repository
 *   read/write this file performs. Every other module keeps working
 *   unmodified and unaware that Documents moved to the Repository.
 *
 * READ / WRITE SPLIT (this phase's rule)
 *   - Reads (`renderDocuments`) call the Repository's SYNCHRONOUS methods
 *     only (`getAll()`, `search()`) — no unnecessary async.
 *   - Writes (`saveDocument`, `deleteDocument`) are the ONLY functions in
 *     this file that cross the async boundary, because
 *     Repository.create()/update()/delete() are Promise-returning
 *     (Repository Contract §3 — Validate -> Write Local -> Persist).
 *   - `editDocument` stays 100% synchronous and unchanged: it only reads
 *     the already-synced `data.documents` mirror to pre-fill the modal,
 *     exactly like before.
 *
 * INDEX -> RECORD -> ID TRANSLATION LAYER
 *   The rendered HTML still embeds plain 0-based array indexes in its
 *   `onclick="editDocument(N)"` / `onclick="deleteDocument(N)"` attributes
 *   (index.html's row templates were not changed, per this phase's rule
 *   "Do NOT change HTML templates unless absolutely necessary"). Because
 *   DocumentsRepository.search()/getAll() return CLONED records (not the
 *   same object references `data.documents` used to hold), the old
 *   `data.documents.indexOf(d)` reference-equality trick no longer works.
 *   `resolveDocIndex()` below is the smallest possible replacement: it
 *   looks a record up in the current mirror by its identifier field
 *   (`رقم_المستند`) instead of by reference. `editDocument(i)` /
 *   `deleteDocument(i)` then resolve that same index back to a record,
 *   and only `deleteDocument`/`saveDocument` go one step further and
 *   resolve the record to its `رقم_المستند` id before calling
 *   `DocumentsRepository.update()/delete()` (both take an id, not an
 *   index).
 *
 * SOFT DELETE — OBSERVABLE BEHAVIOR NOTE
 *   DocumentsRepository is configured with `softDelete: true` (unchanged,
 *   not this phase's decision to make). `delete(id)` therefore keeps the
 *   record in storage with a `deletedAt` stamp instead of physically
 *   removing it, unlike the original `data.documents.splice(i,1)`.
 *   `getAll()`/`search()` both exclude soft-deleted records by default,
 *   so nothing deleted ever reappears anywhere `data.documents` is read
 *   (this file, cases.js, dashboard.js) — the UI-observable behavior is
 *   therefore identical to a hard delete. See
 *   docs/Documents_Repository_Integration_Report.md §5 for the full
 *   analysis of what this means for the raw localStorage payload.
 *
 * Depends on (globals expected from index.html / prior scripts):
 *   - data              : shared app data object  { documents, cases, … }
 *   - editIdx           : shared edit-index map   { documents: -1 }
 *   - ApiService        : api.js layer (replaces direct syncToSheets /
 *                         syncDeleteToSheets calls)
 *   - saveLocal()       : localStorage persistence helper
 *   - toast()           : UI notification helper
 *   - updateBadges()    : badge counter updater
 *   - closeModal()      : modal close helper
 *   - populateCaseDropdown() : defined in cases.js
 *   - formatDate()      : date formatter          (from ui-utils.js)
 *   - val()             : getElementById+.value   (from ui-utils.js)
 *   - uid()             : unique-ID generator     (from ui-utils.js)
 *   - collectForm()     : generic form-to-object  (from ui-utils.js)
 *   - fillForm()        : generic object-to-form  (from ui-utils.js)
 *   - DocumentsRepository : js/repositories/DocumentsRepository.js
 *                           (new this phase — loaded the same dual
 *                           Node/browser way every Repository file
 *                           already loads its own dependencies)
 *
 * GAS Sheet name: 'المستندات'
 *
 * Does NOT touch:
 *   - CSS / HTML structure
 *   - Other modules (cases, clients, sessions, tasks, fees, …)
 *   - Google Apps Script backend
 *   - Database / sheet structure
 *   - ApiService internals
 *   - js/core/Repository.js, DatabaseService.js, StorageAdapter.js,
 *     LocalStorageAdapter.js, js/repositories/DocumentsRepository.js
 * ================================================================
 */

'use strict';

// ================================================================
// FIELDS & MAP — documents slice only (unchanged)
// ================================================================

var DOCUMENTS_FIELDS = [
  'fDocCaseNum',
  'fDocName',
  'fDocType',
  'fDocDate',
  'fDocDriveUrl',
  'fDocNotes'
];

var DOCUMENTS_MAP = {
  fDocCaseNum:   'رقم_القضية',
  fDocName:      'اسم_المستند',
  fDocType:      'نوع_المستند',
  fDocDate:      'تاريخ_الإيداع',
  fDocDriveUrl:  'رابط_Drive',
  fDocNotes:     'الملاحظات'
};

/**
 * Identifier field name — must match DocumentsRepository's own
 * DOCUMENTS_ID_FIELD constant exactly (js/repositories/
 * DocumentsRepository.js, §1). Duplicated here rather than imported,
 * same "depends only on its own declared dependency" discipline every
 * Repository file already uses for its own local constants — this file's
 * one declared new dependency is DocumentsRepository itself, not its
 * internals.
 */
var DOCUMENTS_ID_FIELD = 'رقم_المستند';

// ================================================================
// REPOSITORY WIRING — PHASE 9 / SUB-PHASE 9.3
// ================================================================
// Same dual Node/browser loading shape already used by every file under
// js/repositories/ and js/core/: `require()` when running under Node
// (module.exports exists — this is how js/tests/verify_documents_
// repository_integration.js loads this file), otherwise the browser
// global `window.DocumentsRepository` (populated once index.html's
// <script> tags load js/core/Repository.js, DatabaseService.js,
// LocalStorageAdapter.js and js/repositories/DocumentsRepository.js
// ahead of this file — see Documents_Repository_Integration_Report.md
// §6 "Deployment note" for the exact tags needed; adding them to
// index.html is explicitly out of scope for this phase's "Modify ONLY
// documents.js" mandate).

var DocumentsRepositoryNS = (typeof module !== 'undefined' && module.exports)
  ? require('../repositories/DocumentsRepository.js')
  : (typeof window !== 'undefined' ? window : this);

var DocumentsRepository = DocumentsRepositoryNS && DocumentsRepositoryNS.DocumentsRepository;

if (typeof DocumentsRepository !== 'function') {
  throw new Error(
    'documents.js requires js/repositories/DocumentsRepository.js to be ' +
    'loaded first (DocumentsRepository class not found).'
  );
}

/**
 * The single DocumentsRepository instance this module talks to. Default
 * construction (no config) wires it to the real DatabaseService +
 * LocalStorageAdapter pair, reading/writing the exact same 'documents'
 * localStorage key `data.documents` always used.
 */
var documentsRepository = new DocumentsRepository();

/**
 * PHASE 12 — SUB-PHASE 12.5 — General Undo Integration.
 * js/core/UndoManager.js and js/core/UndoReconciler.js are required
 * here the same dual Node/browser way documentsRepository is required above,
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
      'documents.js: js/core/UndoManager.js was not found (index.html has ' +
      'not yet added its <script> tag for it). This module continues ' +
      'to work exactly as before this phase; undoLastDocumentAction()/' +
      'redoLastDocumentAction() will simply report nothing to undo/redo ' +
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
      'documents.js: js/core/UndoReconciler.js was not found (index.html has ' +
      'not yet added its <script> tag for it). undoLastDocumentAction()/' +
      'redoLastDocumentAction() will simply report nothing to undo/redo ' +
      'until this dependency is wired.'
    );
  }
  UndoReconciler = null;
}

/**
 * DocumentsUndoManager — PHASE 12.5: the single UndoManager instance
 * wired to `documentsRepository` via the public `setUndoManager()` façade
 * (SUB-PHASE 12.3, js/core/Repository.js, NOT modified by this phase).
 * Each entity module constructs and wires its OWN UndoManager instance
 * — this one is never shared with any other module — so that
 * Undo/Redo history for Documents stays completely separate from every
 * other entity's history (Phase 12.5 brief §11), exactly as already
 * true for `casesUndoManager` in js/modules/cases.js.
 */
var documentsUndoManager = (typeof UndoManager === 'function') ? new UndoManager(documentsRepository) : null;
if (documentsUndoManager) {
  documentsRepository.setUndoManager(documentsUndoManager);
}

/**
 * Resolves once DocumentsRepository.open() has loaded its initial
 * in-memory copy from storage (Repository Contract §11: Create -> Open
 * -> Ready). Every write path awaits this before touching the
 * Repository; renderDocuments()/editDocument() stay synchronous and
 * simply no-op if called in the vanishingly small window before this
 * resolves (see file header "READ / WRITE SPLIT").
 */
var documentsRepositoryReadyPromise = (function () {
  var _p = documentsRepository.open().then(function () {
    syncDocumentsMirror();
  }).catch(function (err) {
    // Surface the failure without throwing out of a top-level Promise
    // chain (would otherwise be an unhandled rejection). renderDocuments()
    // guards on isReady() and simply shows nothing until this is fixed.
    if (typeof console !== 'undefined' && console.error) {
      console.error('DocumentsRepository failed to open:', err);
    }
  });
  // PHASE 17.0 — Startup Reliability: bound this Promise so a stuck
  // documentsRepository.open() can never hang
  // ensureDocumentsRepositoryReady() forever. See
  // js/core/RepositoryReadyTimeout.js. Purely additive: if that helper
  // isn't loaded, _p is returned completely unwrapped.
  return (typeof RepositoryReadyTimeout !== 'undefined') ? RepositoryReadyTimeout.wrap('documents', _p) : _p;
})();

/**
 * ensureDocumentsRepositoryReady() — awaited by every write path.
 * open() itself is idempotent (Repository.prototype.open() returns
 * immediately if already 'ready'/'busy'), so calling this more than once
 * is always safe and cheap.
 * @returns {Promise<void>}
 */
function ensureDocumentsRepositoryReady() {
  if (documentsRepository.isReady()) return Promise.resolve();
  return documentsRepositoryReadyPromise;
}

/**
 * syncDocumentsMirror — refreshes the legacy global `data.documents`
 * array from the Repository's current state (soft-deleted records
 * excluded, same as the Repository's own getAll() default). Called
 * after open() and after every create/update/delete this module
 * performs, so cases.js / dashboard.js keep seeing accurate data without
 * being touched themselves.
 */
function syncDocumentsMirror() {
  data.documents = documentsRepository.getAll();
}

/**
 * resolveDocIndex(list, record) — the index half of the "index -> record
 * -> id" translation layer (see file header). Finds `record`'s position
 * inside `list` by identifier equality (`رقم_المستند`), replacing the
 * old `data.documents.indexOf(d)` reference-equality lookup that no
 * longer works now that Repository reads return cloned objects.
 * @param {Object[]} list
 * @param {Object} record
 * @returns {number} 0-based index, or -1 if not found.
 */
function resolveDocIndex(list, record) {
  var id = record ? record[DOCUMENTS_ID_FIELD] : undefined;
  for (var i = 0; i < list.length; i++) {
    if (list[i][DOCUMENTS_ID_FIELD] === id) return i;
  }
  return -1;
}

// ================================================================
// RENDER — عرض قائمة المستندات
// ================================================================

/**
 * renderDocuments — renders the documents list view (table + mobile cards).
 * Reads: DocumentsRepository (search + getAll — both synchronous),
 * searchDocuments filter, filterDocType filter.
 * Writes to: #documentsTableBody, #documentsMobileList, #documentsEmpty,
 * and refreshes the data.documents mirror.
 *
 * PHASE 16.12 — DomRecycler Migration (Documents)
 * ----------------------------------------------------------------
 * Follows the exact Clients (PHASE 16.7) two-container shape (desktop
 * table <tr> + mobile .m-card list, both reconciled independently
 * against the SAME row set/key), narrowed by the Tasks (PHASE 16.10) /
 * Sessions (PHASE 16.11) precedent of checking first whether an attrs()
 * layer is actually needed.
 *
 * Outer-node class check (mandatory step, per this phase's brief):
 *   - Desktop row: bare `<tr>` — no class attribute at all, ever.
 *   - Mobile card: `<div class="m-card">` — a FIXED literal, identical
 *     to every other row, never computed from document data.
 * Neither container has a variable outer className (no per-document
 * type/status driving the wrapper's class, unlike Tasks' priority).
 * So — same decision as Clients (16.7), Cases (16.6), and Sessions
 * (16.11) — NO documentAttrs() is created and options.attrs is
 * omitted entirely from both reconcile() calls.
 *
 * documentRowKey()/documentDesktopRowInner()/documentMobileCardInner()
 * are the SAME markup strings this function always built per document
 * — moved out of the inline .map() callbacks into named functions so
 * DomRecycler (new path) and the untouched legacy full-rebuild block
 * (fallback path) share the exact same template logic. No js/core/
 * dom/* file is touched by this phase.
 */
function renderDocuments() {
  // Defensive only — see documentsRepositoryReadyPromise's doc comment.
  // In normal page load order this is always true by the time any
  // onclick/oninput can fire, since open() resolves via microtasks that
  // drain before the browser dispatches its first user-facing event.
  if (!documentsRepository.isReady()) return;

  var s  = val('searchDocuments').toLowerCase();
  var ty = val('filterDocType');

  syncDocumentsMirror();
  var allDocs = data.documents;

  var queryModel = {};
  if (s) queryModel.search = s;
  if (ty) queryModel.filter = { 'نوع_المستند': ty };
  var rows = documentsRepository.search(queryModel).items;

  var tb = document.getElementById('documentsTableBody');
  var em = document.getElementById('documentsEmpty');
  var ml = document.getElementById('documentsMobileList');

  if (!rows.length) {
    tb.innerHTML = '';
    ml.innerHTML = '';
    // PHASE 16.12 — SAFETY: the two lines above wipe both containers'
    // real children directly (not through DomRecycler), so any
    // key->node references DomKeyIndex is holding for them would now
    // point at detached/dead nodes. Reset both so the next non-empty
    // render starts clean instead of reusing dead references.
    // Additive only — window.DomKeyIndex may be undefined if
    // js/core/dom/ isn't loaded, hence the guard. Same pattern as
    // renderClients()/renderSessions().
    if (window.DomKeyIndex) { DomKeyIndex.reset(tb); DomKeyIndex.reset(ml); }
    em.style.display = '';
    return;
  }
  em.style.display = 'none';

  // ----------------------------------------------------------------
  // PHASE 16.12 — DomRecycler Migration (Documents)
  // ----------------------------------------------------------------
  // documentDesktopRowInner()/documentMobileCardInner() are the EXACT
  // SAME markup this function has always built for each document —
  // narrowed from "whole container" to "one row/card at a time",
  // exactly like desktopClientRowInner()/mobileClientCardInner() in
  // clients.js.

  function documentDesktopRowInner(d) {
    var ri = resolveDocIndex(allDocs, d);
    return (
      '<td><strong>' + (d['اسم_المستند'] || '—') + '</strong></td>' +
      '<td style="color:var(--gold)">' + (d['رقم_القضية'] || '—') + '</td>' +
      '<td>' + (d['نوع_المستند'] || '—') + '</td>' +
      '<td>' + formatDate(d['تاريخ_الإيداع']) + '</td>' +
      '<td>' +
        (d['رابط_Drive']
          ? '<a href="' + d['رابط_Drive'] + '" target="_blank" class="btn btn-success btn-sm">&#128279; فتح</a>'
          : '—') +
      '</td>' +
      '<td><small>' + (d['الملاحظات'] || '—') + '</small></td>' +
      '<td>' +
        '<button class="btn btn-ghost btn-sm btn-icon" onclick="editDocument(' + ri + ')">&#9998;</button> ' +
        '<button class="btn btn-danger btn-sm btn-icon" onclick="deleteDocument(' + ri + ')">&#128465;</button>' +
      '</td>'
    );
  }

  function documentMobileCardInner(d) {
    var ri = resolveDocIndex(allDocs, d);
    return (
      '<div class="m-card-header">' +
        '<div class="m-card-title">&#128206; ' + (d['اسم_المستند'] || '—') + '</div>' +
        '<div class="m-card-num">قضية: ' + (d['رقم_القضية'] || '—') + '</div>' +
      '</div>' +
      '<div class="m-card-meta">' +
        '<span>&#128203; ' + (d['نوع_المستند'] || '—') + '</span>' +
        '<span>&#128197; ' + formatDate(d['تاريخ_الإيداع']) + '</span>' +
      '</div>' +
      '<div class="m-card-actions">' +
        (d['رابط_Drive']
          ? '<a href="' + d['رابط_Drive'] + '" target="_blank" class="btn btn-success btn-sm" style="flex:1;">&#128279; فتح Drive</a>'
          : '') +
        '<button class="btn btn-ghost btn-sm btn-icon" onclick="editDocument(' + ri + ')">&#9998;</button>' +
        '<button class="btn btn-danger btn-sm btn-icon" onclick="deleteDocument(' + ri + ')">&#128465;</button>' +
      '</div>'
    );
  }

  // رقم_المستند only — stable identity, exactly like caseRowKey()/
  // clientRowKey()/taskRowKey()/sessionRowKey().
  function documentRowKey(d) { return d[DOCUMENTS_ID_FIELD]; }

  var recycled = false;
  if (window.DomRecycler && typeof DomRecycler.reconcile === 'function') {
    try {
      DomRecycler.reconcile(tb, rows, { key: documentRowKey, tag: 'tr', render: documentDesktopRowInner });
      DomRecycler.reconcile(ml, rows, { key: documentRowKey, tag: 'div', className: 'm-card', render: documentMobileCardInner });
      recycled = true;
    } catch (domRecyclerError) {
      // PHASE 16.6/16.7/16.9/16.10/16.11 SAFETY (unchanged pattern): any
      // recycler failure falls straight back to the legacy full-rebuild
      // path below, and drops whatever partial key-index state the
      // failed attempt may have left behind so the NEXT render
      // (recycled or not) never inherits it.
      recycled = false;
      if (window.DomKeyIndex) { DomKeyIndex.reset(tb); DomKeyIndex.reset(ml); }
    }
  }

  if (!recycled) {
    // ORIGINAL PHASE ≤16.11 implementation — UNCHANGED (full rebuild),
    // kept exactly as the guaranteed-safe fallback path. Uses the SAME
    // documentDesktopRowInner()/documentMobileCardInner() template
    // functions defined above, just with the outer wrapper restored
    // around each.
    tb.innerHTML = rows.map(function(d) {
      return '<tr>' + documentDesktopRowInner(d) + '</tr>';
    }).join('');

    ml.innerHTML = rows.map(function(d) {
      return '<div class="m-card">' + documentMobileCardInner(d) + '</div>';
    }).join('');
  }
}

// ================================================================
// CRUD — حفظ / تعديل / حذف
// ================================================================

/**
 * saveDocument — validates, saves through DocumentsRepository, syncs to
 * GAS. Replaces: inline saveDocument() in index.html <script> block.
 * ApiService.syncRow() replaces the original syncToSheets() call, same
 * as before.
 *
 * Crosses the async boundary (Repository.create()/update() are
 * Promise-returning) — the only reason this function is now `async`.
 */
async function saveDocument() {
  var c = document.getElementById('fDocCaseNum').value.trim();
  var n = document.getElementById('fDocName').value.trim();
  if (!c || !n) {
    toast('يرجى ملء رقم القضية واسم المستند', 'error');
    return;
  }

  await ensureDocumentsRepositoryReady();

  var obj = collectForm('documents');
  // Same field, same fallback, as the original inline saveDocument():
  // collectForm('documents') only ever returns the 6 form fields (see
  // index.html's MAP.documents), so this is always freshly stamped on
  // every save, exactly like before.
  obj['تاريخ_الإنشاء'] = obj['تاريخ_الإنشاء'] || new Date().toISOString();

  var idx = editIdx.documents;
  var result;

  if (idx >= 0) {
    var existing = data.documents[idx];
    var existingId = existing ? existing[DOCUMENTS_ID_FIELD] : null;
    result = await documentsRepository.update(existingId, obj);
  } else {
    result = await documentsRepository.create(obj);
  }

  if (!result || !result.success) {
    toast('حدث خطأ أثناء الحفظ', 'error');
    return;
  }

  syncDocumentsMirror();

  if (idx >= 0) {
    toast('تم التحديث', 'success');
  } else {
    toast('تمت الإضافة', 'success');
  }

  saveLocal();
  ApiService.syncRow('المستندات', result.record, idx);   // replaces: if(API_URL)syncToSheets(...)
  closeModal('modalDocument');
  renderDocuments();
  updateBadges();
  // PHASE 16.5.1 — DIRTY PROPAGATION (additive only, see phase brief)
  if (window.ApplicationShell) { ApplicationShell.markDirty('documents'); }
}

/**
 * editDocument — opens the document modal pre-filled with existing data.
 * Unchanged from before: purely a read of the (now Repository-backed)
 * data.documents mirror, so it stays fully synchronous — no Repository
 * call needed here at all.
 * @param {number} i - 0-based index in the data.documents mirror.
 */
function editDocument(i) {
  editIdx.documents = i;
  populateCaseDropdown('fDocCaseNum', data.documents[i]['رقم_القضية']);
  fillForm('documents', data.documents[i]);
  document.getElementById('modalDocTitle').textContent = 'تعديل المستند';
  document.getElementById('modalDocument').classList.add('open');
}

/**
 * deleteDocument — confirms, removes via DocumentsRepository.
 * @param {number} i - 0-based index in the data.documents mirror.
 *
 * NOTE: Preserves original behaviour exactly — the original inline
 * deleteDocument() does NOT call syncDeleteToSheets()/ApiService.deleteData()
 * for documents (unlike deleteSession/deleteClient/etc). This module makes
 * no functional change to that behaviour; it is flagged in
 * DOCUMENTS_MODULE_REPORT.md as a pre-existing gap, consistent with the
 * "no functional changes" extraction mandate.
 *
 * Crosses the async boundary (Repository.delete() is Promise-returning)
 * — the only reason this function is now `async`.
 */
async function deleteDocument(i) {
  if (!(await confirmDialog('هل تريد حذف هذا المستند؟'))) return;

  await ensureDocumentsRepositoryReady();

  var record = data.documents[i];
  if (!record) return;

  var id = record[DOCUMENTS_ID_FIELD];
  var result = await documentsRepository.delete(id);

  if (!result || !result.success) {
    toast('حدث خطأ أثناء الحذف', 'error');
    return;
  }

  syncDocumentsMirror();
  saveLocal();
  toast('تم الحذف', 'info');
  renderDocuments();
  updateBadges();
  // PHASE 16.5.1 — DIRTY PROPAGATION (additive only, see phase brief)
  if (window.ApplicationShell) { ApplicationShell.markDirty('documents'); }
}

/**
 * restoreDocument(id) — استرجاع مستند محذوف (Restore).
 * PHASE 10 — SUB-PHASE 10.4 — Restore Rollout (same pattern as Cases,
 * SUB-PHASE 10.3 — see docs/Restore_Rollout_Report.md).
 * Restores a soft-deleted document via `documentsRepository.restore(id)`
 * (inherited, unmodified, from SUB-PHASE 10.2's `Repository.prototype.
 * restore()`). Symmetric with `deleteDocument()` above: same
 * ready-guard, same `syncDocumentsMirror()` -> `saveLocal()` ->
 * `renderDocuments()` -> `updateBadges()` sequence.
 *
 * ID, NOT INDEX — same documented reason as `restoreCase()`.
 * NO UI WIRING — Rollout scope, matches the Pilot.
 * Does NOT call `ApiService` — same explicit, documented design
 * decision as `restoreCase()` (`deleteDocument()` itself calls no
 * `ApiService` method either, so this preserves exact symmetry).
 *
 * @param {string} id - the DocumentsRepository id (رقم_المستند) of the
 *   soft-deleted document to restore.
 */
async function restoreDocument(id) {
  await ensureDocumentsRepositoryReady();

  var result = await documentsRepository.restore(id);

  if (!result || !result.success) {
    toast('حدث خطأ أثناء الاسترجاع', 'error');
    return;
  }

  syncDocumentsMirror();
  saveLocal();
  toast('تم الاسترجاع', 'success');
  renderDocuments();
  updateBadges();
  // PHASE 16.5.1 — DIRTY PROPAGATION (additive only, see phase brief)
  if (window.ApplicationShell) { ApplicationShell.markDirty('documents'); }
}

// ================================================================
// Node/test export (browser: `module` is undefined, this is a no-op —
// renderDocuments/saveDocument/editDocument/deleteDocument remain plain
// global functions exactly as before).
// ================================================================

// ================================================================
// UNDO / REDO — تراجع / إعادة (PHASE 12 — SUB-PHASE 12.5 — General Undo
// Integration)
// ================================================================
// Reversal mapping, redo-stack suspension, and instruction application
// are all handled by the shared js/core/UndoReconciler.js (extracted
// from the Cases pilot, SUB-PHASE 12.4 → 12.5) — this module only
// supplies its own `documentsRepository`/`DOCUMENTS_ID_FIELD` and its own refresh sequence
// (`sync/saveLocal/render/updateBadges/toast`), matching every other
// entity module's `restoreDocument()` refresh sequence exactly.
//
// `documentsRepository` disables no operations (`unsupportedOperations: []`,
// confirmed in js/repositories/DocumentsRepository.js), so every reversal
// mapping case (create/update/delete/restore) is legal for this
// entity — same as Cases.

/**
 * undoLastDocumentAction() — PHASE 12.5. Reverses the most recent
 * Documents mutation (create/update/delete/restore). Mirrors
 * `undoLastCaseAction()` (js/modules/cases.js) exactly: same guard on
 * `canUndo()`, same use of the shared `UndoReconciler.applyUndoInstruction()`,
 * same refresh sequence, same graceful handling of empty history, a
 * Repository/persist failure, or any unexpected exception.
 * @returns {Promise<void>}
 */
async function undoLastDocumentAction() {
  await ensureDocumentsRepositoryReady();

  try {
    if (!documentsRepository.canUndo()) {
      toast('لا يوجد إجراء للتراجع عنه', 'info');
      return;
    }

    var instruction = documentsRepository.undo();
    if (!instruction) {
      toast('لا يوجد إجراء للتراجع عنه', 'info');
      return;
    }

    if (!UndoReconciler) {
      toast('حدث خطأ أثناء التراجع', 'error');
      return;
    }

    var result = await UndoReconciler.applyUndoInstruction(documentsRepository, DOCUMENTS_ID_FIELD, instruction, 'undo');
    if (!result || !result.success) {
      toast('حدث خطأ أثناء التراجع', 'error');
      return;
    }

    syncDocumentsMirror();
    saveLocal();
    renderDocuments();
    updateBadges();
    // PHASE 16.5.1 — DIRTY PROPAGATION (additive only, see phase brief)
    if (window.ApplicationShell) { ApplicationShell.markDirty('documents'); }
    toast('تم التراجع', 'success');
  } catch (e) {
    toast('حدث خطأ أثناء التراجع', 'error');
  }
}

/**
 * redoLastDocumentAction() — PHASE 12.5. Re-applies the most recently
 * undone Documents mutation. Same refresh sequence, same shared-utility
 * usage, same error-handling guarantees as `undoLastDocumentAction()`
 * above — mirrors `redoLastCaseAction()` exactly.
 * @returns {Promise<void>}
 */
async function redoLastDocumentAction() {
  await ensureDocumentsRepositoryReady();

  try {
    if (!documentsRepository.canRedo()) {
      toast('لا يوجد إجراء لإعادته', 'info');
      return;
    }

    var instruction = documentsRepository.redo();
    if (!instruction) {
      toast('لا يوجد إجراء لإعادته', 'info');
      return;
    }

    if (!UndoReconciler) {
      toast('حدث خطأ أثناء الإعادة', 'error');
      return;
    }

    var result = await UndoReconciler.applyUndoInstruction(documentsRepository, DOCUMENTS_ID_FIELD, instruction, 'redo');
    if (!result || !result.success) {
      toast('حدث خطأ أثناء الإعادة', 'error');
      return;
    }

    syncDocumentsMirror();
    saveLocal();
    renderDocuments();
    updateBadges();
    // PHASE 16.5.1 — DIRTY PROPAGATION (additive only, see phase brief)
    if (window.ApplicationShell) { ApplicationShell.markDirty('documents'); }
    toast('تمت الإعادة', 'success');
  } catch (e) {
    toast('حدث خطأ أثناء الإعادة', 'error');
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    documentsUndoManager: documentsUndoManager,
    undoLastDocumentAction: undoLastDocumentAction,
    redoLastDocumentAction: redoLastDocumentAction,
    DOCUMENTS_FIELDS: DOCUMENTS_FIELDS,
    DOCUMENTS_MAP: DOCUMENTS_MAP,
    DOCUMENTS_ID_FIELD: DOCUMENTS_ID_FIELD,
    documentsRepository: documentsRepository,
    ensureDocumentsRepositoryReady: ensureDocumentsRepositoryReady,
    syncDocumentsMirror: syncDocumentsMirror,
    resolveDocIndex: resolveDocIndex,
    renderDocuments: renderDocuments,
    saveDocument: saveDocument,
    editDocument: editDocument,
    deleteDocument: deleteDocument,
    restoreDocument: restoreDocument
  };
}
