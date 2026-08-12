/**
 * ================================================================
 * js/modules/library.js — وحدة المكتبة القانونية | نظام الحسام للمحاماة
 * ================================================================
 * Contains ALL Library-related functions extracted from index.html.
 *
 * PHASE 10 — SUB-PHASE 10.4 — Restore Rollout
 * ----------------------------------------------------------------
 * Additive-only addition on top of PHASE 9.6 below: a new
 * `restoreLibBook(id)` function (see its own doc comment, next to
 * `deleteLibBook()`), same Cases-piloted pattern (SUB-PHASE 10.3). No
 * existing function in this file was changed. See
 * docs/Restore_Rollout_Report.md for the full audit and verification
 * evidence.
 *
 * PHASE 9 — SUB-PHASE 9.6 — Repository Integration (Library Module)
 * ----------------------------------------------------------------
 * This module now reads and writes through js/repositories/
 * LibraryRepository.js instead of the legacy global `data.library`
 * array directly. Nothing else in the project was changed to make this
 * happen: LibraryRepository.js, Repository.js, DatabaseService.js and
 * LocalStorageAdapter.js are all used exactly as PHASE 5/PHASE 8 left
 * them (no edits, no imports of internals). This follows the same
 * proven pattern used for the Documents module (SUB-PHASE 9.3), the
 * Sessions module (SUB-PHASE 9.4) and the Tasks module (SUB-PHASE 9.5).
 *
 * WHY `data.library` STILL EXISTS BELOW
 *   No other Module reads `data.library` directly (unlike
 *   data.documents/data.tasks, which dashboard.js/cases.js also read) —
 *   a full-project scan confirms Library is read/written only from this
 *   file. The mirror is kept anyway, for two reasons: (1) it is the
 *   established pattern from every prior Repository integration this
 *   phase must follow "exactly", and (2) `saveLocal()` in index.html
 *   still persists `data.library` directly to localStorage on every
 *   Module's save/delete path (`['cases','sessions',...,'library',...]
 *   .forEach(...)`) — `saveLocal()` is NOT part of this phase's mandate
 *   ("Modify ONLY library.js"), so `data.library` must keep mirroring
 *   LibraryRepository's current state for that pre-existing call to
 *   keep persisting accurate data (in practice a harmless duplicate of
 *   what LibraryRepository.create()/update()/delete() already persisted
 *   themselves under the same 'library' localStorage key — see
 *   Library_Repository_Integration_Report.md §5).
 *
 * READ / WRITE SPLIT (this phase's rule)
 *   - Reads (`renderLibrary`) call the Repository's SYNCHRONOUS methods
 *     only (`getAll()`, `search()`) — no unnecessary async.
 *   - Writes (`saveLibBook`, `deleteLibBook`) are the ONLY functions in
 *     this file that cross the async boundary, because
 *     Repository.create()/update()/delete() are Promise-returning
 *     (Repository Contract §3 — Validate -> Write Local -> Persist).
 *   - `editLibBook` stays 100% synchronous and unchanged: it only reads
 *     the already-synced `data.library` mirror to pre-fill the modal,
 *     exactly like before.
 *
 * INDEX -> RECORD -> ID TRANSLATION LAYER
 *   The rendered HTML still embeds plain 0-based array indexes in its
 *   `onclick="editLibBook(N)"` / `onclick="deleteLibBook(N)"` attributes
 *   (index.html's card template was not changed, per this phase's rule
 *   "Do NOT change generated HTML unless absolutely necessary"). Because
 *   LibraryRepository.search()/getAll() return CLONED records (not the
 *   same object references `data.library` used to hold), the old
 *   `data.library.indexOf(b)` reference-equality trick no longer works.
 *   `resolveLibIndex()` below is the smallest possible replacement: it
 *   looks a record up in the current mirror by its identifier field
 *   (`id`) instead of by reference. `editLibBook(i)` / `deleteLibBook(i)`
 *   then resolve that same index back to a record, and `deleteLibBook`/
 *   `saveLibBook` go one step further and resolve the record to its
 *   `id` before calling `LibraryRepository.update()/delete()` (both take
 *   an id, not an index).
 *
 * IDENTIFIER GENERATION NOTE
 *   The original inline `saveLibBook()` stamped
 *   `obj['id'] = obj['id'] || uid();` on the plain object before
 *   pushing/assigning it. Because `collectForm('library')` only ever
 *   returns the 5 form fields declared in `MAP.library`/`LIBRARY_MAP`
 *   (`fLibTitle`/`fLibType`/`fLibCat`/`fLibUrl`/`fLibDesc` — none of
 *   which map to `id`), `obj['id']` was in practice ALWAYS absent at
 *   that line, on both the create path and the update path.
 *   `LibraryRepository._resolveId()` (js/repositories/
 *   LibraryRepository.js §4.1) already replicates this exact
 *   generate-only-when-absent fallback internally on `create()`, so
 *   this module does not need to duplicate that stamp — `create(obj)`
 *   assigns the id itself, exactly as `saveDocument()`/`saveTask()`
 *   rely on their own Repositories to assign the id (see those modules'
 *   own "IDENTIFIER GENERATION NOTE"). On the update path,
 *   `Repository.prototype.update()` unconditionally re-stamps
 *   `merged[idField] = existing[idField]` on the merged record
 *   regardless of what the patch contains (Repository.js §"update()"),
 *   so the pre-existing record's `id` is always preserved across an
 *   update — this is not a functional regression versus the original:
 *   `id` was never read, displayed, or otherwise relied upon anywhere
 *   in `renderLibrary()`/the UI, only used internally for the index
 *   translation layer above, and that layer only ever needs the id to
 *   stay stable *within* a single render pass, which it now does more
 *   reliably than before (see Library_Repository_Integration_Report.md
 *   §4 for the full before/after analysis of this specific point).
 *
 * SOFT DELETE — OBSERVABLE BEHAVIOR NOTE
 *   LibraryRepository is configured with `softDelete: true` (unchanged,
 *   not this phase's decision to make). `delete(id)` therefore keeps
 *   the record in storage with a `deletedAt` stamp instead of
 *   physically removing it, unlike the original
 *   `data.library.splice(i,1)`. `getAll()`/`search()` both exclude
 *   soft-deleted records by default, so nothing deleted ever reappears
 *   anywhere `data.library` is read (only this file reads it) — the
 *   UI-observable behavior is therefore identical to a hard delete.
 *
 * SEARCH / FILTER — both UI behaviors
 *   (`#searchLibrary` free-text join, `#filterLibCat` exact-match on
 *   `القسم`, `#filterLibType` exact-match on `النوع`, combined with AND
 *   semantics) are preserved bit-for-bit:
 *   `LibraryRepository._matchesSearch()` replicates the exact
 *   `Object.values(b).join(' ')` free-text join the inline module used
 *   (literally, including audit/metadata fields — see
 *   LibraryRepository.js file header "SEARCH" note), and `renderLibrary()`
 *   below passes both filter fields through the Repository's generic
 *   `search({search, filter})` Query Model instead of doing it in plain
 *   JS — `_matchesFilter()`'s multi-key AND semantics (Repository.js
 *   §4.5) reproduce the original's `&&`-chained equality checks exactly.
 *   No sort is applied — matching the original inline renderLibrary(),
 *   which never called `.sort()` (insertion order only). LibraryRepository
 *   does expose an additive `sort()` convenience method, but using it
 *   here would change observable row order versus the original, so this
 *   phase's "preserve identical behavior" rule means it is intentionally
 *   NOT used in `renderLibrary()`.
 *
 * DYNAMIC CATEGORY DROPDOWN — UNCHANGED
 *   `renderLibrary()` still rebuilds `#filterLibCat`'s `<option>` list on
 *   every call from the distinct `القسم` values present in the current
 *   data (`[...new Set(data.library.map(...).filter(Boolean))]`), reading
 *   the freshly-synced `data.library` mirror exactly as before — this is
 *   a rendering-time UI concern only and needed no Repository-side
 *   change (see LibraryRepository.js file header "FILTER" note).
 *
 * DRIVE-LINK BAR — UNCHANGED
 *   `renderLibrary()` still reads the global `DRIVE_URL` directly to
 *   drive `#driveLinkLabel`/`#driveLinkBtn` — Library only ever read
 *   that global, never assigned to it, and this phase makes no change
 *   to that.
 *
 * Depends on (globals expected from index.html / prior scripts):
 *   - data              : shared app data object  { library, … }
 *   - editIdx           : shared edit-index map   { library: -1 }
 *   - DRIVE_URL         : global Google Drive folder URL string,
 *                         owned/written by Settings (saveDriveUrl() /
 *                         saveDriveFromModal() in index.html); Library
 *                         only READS it to drive the Drive-link bar on
 *                         the Library page (#driveLinkLabel/#driveLinkBtn)
 *   - saveLocal()       : localStorage persistence helper
 *   - toast()           : UI notification helper
 *   - closeModal()      : modal close helper
 *   - val()             : getElementById+.value   (from ui-utils.js)
 *   - uid()             : unique-ID generator     (from ui-utils.js)
 *   - collectForm()     : generic form-to-object  (from ui-utils.js)
 *   - fillForm()        : generic object-to-form  (from ui-utils.js)
 *   - LibraryRepository : js/repositories/LibraryRepository.js
 *                         (loaded the same dual Node/browser way every
 *                         Repository file already loads its own
 *                         dependencies)
 *
 * GAS Sheet name: none — Library has NO backend sync. It is not part of
 * the seven sheet→key pairs loaded by ApiService.loadAllSheets() /
 * loadFromSheets() (القضايا، الجلسات، الموكلين، الأطفال، المستندات،
 * المهام، الأتعاب), and the original saveLibBook()/deleteLibBook() never
 * called syncToSheets()/syncDeleteToSheets(). Library data is local-only
 * (localStorage), by original design — confirmed by full-file scan, and
 * independently confirmed by LibraryRepository.js's own "SYNC" note
 * (never wired to ApiService/DatabaseService's remote path). This
 * migration therefore adds NO ApiService.syncRow()/deleteData() calls
 * anywhere in this file — there were none to begin with.
 *
 * Does NOT touch:
 *   - CSS / HTML structure
 *   - Other modules (cases, clients, sessions, documents, tasks, fees, …)
 *   - Templates module (renderTemplates/saveTemplate/editTemplate/
 *     deleteTemplate/filterTemplates) — a visually similar but
 *     functionally separate page/data-slice (data.templates), not
 *     touched here
 *   - `openAddLibModal()` — single-purpose modal opener, left in
 *     index.html (same precedent as openAddFeeModal/openAddDocModal/etc.)
 *   - DRIVE_URL's source of truth — Library reads it but never assigns
 *     to it; ownership stays with Settings
 *   - Google Apps Script backend
 *   - Database / sheet structure
 *   - ApiService internals
 *   - js/core/Repository.js, DatabaseService.js, StorageAdapter.js,
 *     LocalStorageAdapter.js, js/repositories/LibraryRepository.js
 * ================================================================
 */

'use strict';

// ================================================================
// FIELDS & MAP — library slice only (unchanged)
// ================================================================

var LIBRARY_FIELDS = [
  'fLibTitle',
  'fLibType',
  'fLibCat',
  'fLibUrl',
  'fLibDesc'
];

var LIBRARY_MAP = {
  fLibTitle: 'العنوان',
  fLibType:  'النوع',
  fLibCat:   'القسم',
  fLibUrl:   'الرابط',
  fLibDesc:  'الوصف'
};

/**
 * Identifier field name — must match LibraryRepository's own
 * LIBRARY_ID_FIELD constant exactly (js/repositories/LibraryRepository.js,
 * §1). Duplicated here rather than imported, same "depends only on its
 * own declared dependency" discipline every Repository-integrated
 * module already uses for its own local constants — this file's one
 * declared new dependency is LibraryRepository itself, not its
 * internals. Unlike every other entity migrated so far (Documents'
 * `رقم_المستند`, Sessions'/Tasks' own Arabic id fields), Library's
 * identifier is the generic key `'id'` — see LibraryRepository.js file
 * header "IDENTIFIER" note.
 */
var LIBRARY_ID_FIELD = 'id';

// ================================================================
// REPOSITORY WIRING — PHASE 9 / SUB-PHASE 9.6
// ================================================================
// Same dual Node/browser loading shape already used by every file under
// js/repositories/ and js/core/: `require()` when running under Node
// (module.exports exists — this is how js/tests/verify_library_
// repository_integration.js loads this file), otherwise the browser
// global `window.LibraryRepository` (populated once index.html's
// <script> tags load js/core/Repository.js, DatabaseService.js,
// LocalStorageAdapter.js and js/repositories/LibraryRepository.js ahead
// of this file — adding those tags to index.html is explicitly out of
// scope for this phase's "Modify ONLY library.js" mandate).

var LibraryRepositoryNS = (typeof module !== 'undefined' && module.exports)
  ? require('../repositories/LibraryRepository.js')
  : (typeof window !== 'undefined' ? window : this);

var LibraryRepository = LibraryRepositoryNS && LibraryRepositoryNS.LibraryRepository;

if (typeof LibraryRepository !== 'function') {
  throw new Error(
    'library.js requires js/repositories/LibraryRepository.js to be ' +
    'loaded first (LibraryRepository class not found).'
  );
}

/**
 * The single LibraryRepository instance this module talks to. Default
 * construction (no config) wires it to the real DatabaseService +
 * LocalStorageAdapter pair, reading/writing the exact same 'library'
 * localStorage key `data.library` always used.
 */
var libraryRepository = new LibraryRepository();

/**
 * PHASE 12 — SUB-PHASE 12.5 — General Undo Integration.
 * js/core/UndoManager.js and js/core/UndoReconciler.js are required
 * here the same dual Node/browser way libraryRepository is required above,
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
      'library.js: js/core/UndoManager.js was not found (index.html has ' +
      'not yet added its <script> tag for it). This module continues ' +
      'to work exactly as before this phase; undoLastLibBookAction()/' +
      'redoLastLibBookAction() will simply report nothing to undo/redo ' +
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
      'library.js: js/core/UndoReconciler.js was not found (index.html has ' +
      'not yet added its <script> tag for it). undoLastLibBookAction()/' +
      'redoLastLibBookAction() will simply report nothing to undo/redo ' +
      'until this dependency is wired.'
    );
  }
  UndoReconciler = null;
}

/**
 * LibraryUndoManager — PHASE 12.5: the single UndoManager instance
 * wired to `libraryRepository` via the public `setUndoManager()` façade
 * (SUB-PHASE 12.3, js/core/Repository.js, NOT modified by this phase).
 * Each entity module constructs and wires its OWN UndoManager instance
 * — this one is never shared with any other module — so that
 * Undo/Redo history for Library stays completely separate from every
 * other entity's history (Phase 12.5 brief §11), exactly as already
 * true for `casesUndoManager` in js/modules/cases.js.
 */
var libraryUndoManager = (typeof UndoManager === 'function') ? new UndoManager(libraryRepository) : null;
if (libraryUndoManager) {
  libraryRepository.setUndoManager(libraryUndoManager);
}

/**
 * Resolves once LibraryRepository.open() has loaded its initial
 * in-memory copy from storage (Repository Contract §11: Create -> Open
 * -> Ready). Every write path awaits this before touching the
 * Repository; renderLibrary()/editLibBook() stay synchronous and
 * simply no-op / render nothing until this resolves (see file header
 * "READ / WRITE SPLIT").
 */
var libraryRepositoryReadyPromise = (function () {
  var _p = libraryRepository.open().then(function () {
    syncLibraryMirror();
  }).catch(function (err) {
    // Surface the failure without throwing out of a top-level Promise
    // chain (would otherwise be an unhandled rejection). renderLibrary()
    // guards on isReady() and simply shows nothing until this is fixed.
    if (typeof console !== 'undefined' && console.error) {
      console.error('LibraryRepository failed to open:', err);
    }
  });
  // PHASE 17.0 — Startup Reliability: bound this Promise so a stuck
  // libraryRepository.open() can never hang ensureLibraryRepositoryReady()
  // forever. See js/core/RepositoryReadyTimeout.js. Purely additive:
  // if that helper isn't loaded, _p is returned completely unwrapped.
  return (typeof RepositoryReadyTimeout !== 'undefined') ? RepositoryReadyTimeout.wrap('library', _p) : _p;
})();

/**
 * ensureLibraryRepositoryReady() — awaited by every write path.
 * open() itself is idempotent (Repository.prototype.open() returns
 * immediately if already 'ready'/'busy'), so calling this more than once
 * is always safe and cheap.
 * @returns {Promise<void>}
 */
function ensureLibraryRepositoryReady() {
  if (libraryRepository.isReady()) return Promise.resolve();
  return libraryRepositoryReadyPromise;
}

/**
 * syncLibraryMirror — refreshes the legacy global `data.library` array
 * from the Repository's current state (soft-deleted records excluded,
 * same as the Repository's own getAll() default). Called after open()
 * and after every create/update/delete this module performs (see file
 * header "WHY data.library STILL EXISTS" note).
 */
function syncLibraryMirror() {
  data.library = libraryRepository.getAll();
}

/**
 * resolveLibIndex(list, record) — the index half of the "index -> record
 * -> id" translation layer (see file header). Finds `record`'s position
 * inside `list` by identifier equality (`id`), replacing the old
 * `data.library.indexOf(b)` reference-equality lookup that no longer
 * works now that Repository reads return cloned objects.
 * @param {Object[]} list
 * @param {Object} record
 * @returns {number} 0-based index, or -1 if not found.
 */
function resolveLibIndex(list, record) {
  var id = record ? record[LIBRARY_ID_FIELD] : undefined;
  for (var i = 0; i < list.length; i++) {
    if (list[i][LIBRARY_ID_FIELD] === id) return i;
  }
  return -1;
}

// ================================================================
// RENDER — عرض قائمة المكتبة
// ================================================================

/**
 * renderLibrary — renders the library grid view, rebuilds the category
 * filter <select> options from the current data, and updates the
 * Google-Drive link bar at the top of the Library page.
 * Reads: LibraryRepository (search + getAll — both synchronous),
 *        searchLibrary filter, filterLibCat filter, filterLibType
 *        filter, DRIVE_URL.
 * Writes to: #filterLibCat (options), #libGrid, #libEmpty,
 *            #driveLinkLabel, #driveLinkBtn, and refreshes the
 *            data.library mirror.
 */
function renderLibrary() {
  // Defensive only — see libraryRepositoryReadyPromise's doc comment.
  // In normal page load order this is always true by the time any
  // onclick/oninput can fire, since open() resolves via microtasks that
  // drain before the browser dispatches its first user-facing event.
  if (!libraryRepository.isReady()) return;

  var s  = val('searchLibrary').toLowerCase();
  var cF = val('filterLibCat');
  var tF = val('filterLibType');

  syncLibraryMirror();
  var allBooks = data.library;

  var cats = [...new Set(allBooks.map(function(b) { return b['القسم']; }).filter(Boolean))];
  var cs = document.getElementById('filterLibCat');
  var cc = cs.value;
  cs.innerHTML = '<option value="">كل الأقسام</option>' +
    cats.map(function(c) { return '<option' + (c === cc ? ' selected' : '') + '>' + c + '</option>'; }).join('');

  var queryModel = {};
  if (s) queryModel.search = s;
  var filterObj = {};
  if (cF) filterObj['القسم'] = cF;
  if (tF) filterObj['النوع'] = tF;
  if (Object.keys(filterObj).length) queryModel.filter = filterObj;
  var rows = libraryRepository.search(queryModel).items;

  var g  = document.getElementById('libGrid');
  var em = document.getElementById('libEmpty');

  var lb = document.getElementById('driveLinkLabel');
  var db = document.getElementById('driveLinkBtn');
  if (DRIVE_URL) {
    lb.textContent = 'متصل بـ Google Drive';
    db.href = DRIVE_URL;
    db.style.display = '';
  } else {
    lb.textContent = 'لم يتم ربط Google Drive بعد';
    db.style.display = 'none';
  }

  if (!rows.length) {
    g.innerHTML = '';
    // PHASE 16.15 — SAFETY: the line above wipes the container's real
    // children directly (not through DomRecycler), so any key->node
    // references DomKeyIndex is holding for it would now point at
    // detached/dead nodes. Reset so the next non-empty render starts
    // clean instead of reusing dead references. Additive only —
    // window.DomKeyIndex may be undefined if js/core/dom/ isn't
    // loaded, hence the guard (same pattern as tasks.js/cases.js/
    // clients.js/sessions.js).
    if (window.DomKeyIndex) DomKeyIndex.reset(g);
    em.style.display = '';
    return;
  }
  em.style.display = 'none';

  var ti = { pdf: '&#128213;', word: '&#128216;', folder: '&#128193;', other: '&#128196;' };

  // ----------------------------------------------------------------
  // PHASE 16.15 — DomRecycler Migration (Library)
  // ----------------------------------------------------------------
  // libCardInnerHtml() is the EXACT SAME markup this function has
  // always built for each book — narrowed from "whole container" to
  // "one book at a time", exactly like sessionInnerHtml() in
  // sessions.js (16.11): ONE container (#libGrid — no separate desktop
  // table + mobile list), fixed outer className ('lib-card', never
  // varies per item), so options.attrs is deliberately omitted here
  // too (matches Sessions/Cases/Clients/Documents/Fees/Children, not
  // Tasks, where className genuinely varies per item).

  function libCardInnerHtml(b) {
    var ri = resolveLibIndex(allBooks, b);
    return (
      '<span class="lib-card-type ' + (b['النوع'] || 'other') + '">' +
        (b['النوع'] ? b['النوع'].toUpperCase() : 'ملف') +
      '</span>' +
      '<span class="lib-card-icon">' + (ti[b['النوع']] || '&#128196;') + '</span>' +
      '<div class="lib-card-title">' + b['العنوان'] + '</div>' +
      '<div class="lib-card-meta">&#128193; ' + (b['القسم'] || 'عام') + '</div>' +
      (b['الوصف']
        ? '<div style="font-size:11px;color:var(--muted);margin-top:5px;line-height:1.5;">' + b['الوصف'] + '</div>'
        : '') +
      '<div class="lib-card-actions">' +
        (b['الرابط']
          ? '<a href="' + b['الرابط'] + '" target="_blank" class="btn btn-success btn-sm" style="flex:1;justify-content:center;">&#128279; فتح</a>'
          : '<span style="font-size:11px;color:var(--muted);flex:1;">بدون رابط</span>') +
        '<button class="btn btn-ghost btn-sm btn-icon" onclick="editLibBook(' + ri + ')">&#9998;</button>' +
        '<button class="btn btn-danger btn-sm btn-icon" onclick="deleteLibBook(' + ri + ')">&#128465;</button>' +
      '</div>'
    );
  }

  // LIBRARY_ID_FIELD ('id') only — stable identity, exactly like
  // sessionRowKey()/caseRowKey()/clientRowKey()/taskRowKey().
  function libRowKey(b) { return b[LIBRARY_ID_FIELD]; }

  var recycled = false;
  if (window.DomRecycler && typeof DomRecycler.reconcile === 'function') {
    try {
      DomRecycler.reconcile(g, rows, { key: libRowKey, tag: 'div', className: 'lib-card', render: libCardInnerHtml });
      recycled = true;
    } catch (domRecyclerError) {
      // PHASE 16.6/16.9/16.10/16.11 SAFETY (unchanged pattern): any
      // recycler failure falls straight back to the legacy full-rebuild
      // path below, and drops whatever partial key-index state the
      // failed attempt may have left behind so the NEXT render
      // (recycled or not) never inherits it.
      recycled = false;
      if (window.DomKeyIndex) DomKeyIndex.reset(g);
    }
  }

  if (!recycled) {
    // ORIGINAL PHASE ≤16.14 implementation — UNCHANGED (full rebuild),
    // kept exactly as the guaranteed-safe fallback path. Uses the SAME
    // libCardInnerHtml() template function defined above, just with the
    // outer wrapper restored around it.
    g.innerHTML = rows.map(function(b) {
      return '<div class="lib-card">' + libCardInnerHtml(b) + '</div>';
    }).join('');
  }
}

// ================================================================
// CRUD — حفظ / تعديل / حذف
// ================================================================

/**
 * saveLibBook — validates, saves through LibraryRepository.
 *
 * NOTE: Library has no GAS backend sync — the original inline
 * saveLibBook() never called syncToSheets()/ApiService.syncRow().
 * This is preserved exactly, unmodified, per the "no functional
 * changes" migration mandate (Library is not one of the seven
 * sheets the app loads/syncs).
 *
 * Replaces: inline saveLibBook() in index.html <script> block.
 *
 * Crosses the async boundary (Repository.create()/update() are
 * Promise-returning) — the only reason this function is now `async`.
 */
async function saveLibBook() {
  var t = document.getElementById('fLibTitle').value.trim();
  if (!t) {
    toast('يرجى إدخال العنوان', 'error');
    return;
  }

  await ensureLibraryRepositoryReady();

  var obj = collectForm('library');
  // Note: obj['id'] is intentionally NOT stamped here — see file header
  // "IDENTIFIER GENERATION NOTE": LibraryRepository.create() generates
  // it internally (only when absent), exactly replicating the original
  // `|| uid()` fallback. LibraryRepository.update() always preserves
  // the existing record's id regardless of what is in obj.
  obj['تاريخ_الإنشاء'] = obj['تاريخ_الإنشاء'] || new Date().toISOString();

  var idx = editIdx.library;
  var result;

  if (idx >= 0) {
    var existing = data.library[idx];
    var existingId = existing ? existing[LIBRARY_ID_FIELD] : null;
    result = await libraryRepository.update(existingId, obj);
  } else {
    result = await libraryRepository.create(obj);
  }

  if (!result || !result.success) {
    toast('حدث خطأ أثناء الحفظ', 'error');
    return;
  }

  syncLibraryMirror();

  if (idx >= 0) {
    toast('تم التحديث', 'success');
  } else {
    toast('تمت الإضافة', 'success');
  }

  saveLocal();
  closeModal('modalLibrary');
  renderLibrary();
  // PHASE 16.5.1 — DIRTY PROPAGATION (additive only, see phase brief)
  if (window.ApplicationShell) { ApplicationShell.markDirty('library'); }
}

/**
 * editLibBook — opens the library modal pre-filled with existing data.
 * Unchanged from before: purely a read of the (now Repository-backed)
 * data.library mirror, so it stays fully synchronous — no Repository
 * call needed here at all.
 * @param {number} i - 0-based index in the data.library mirror.
 */
function editLibBook(i) {
  editIdx.library = i;
  fillForm('library', data.library[i]);
  document.getElementById('modalLibTitle').textContent = 'تعديل الكتاب';
  document.getElementById('modalLibrary').classList.add('open');
}

/**
 * deleteLibBook — confirms, removes via LibraryRepository.
 * @param {number} i - 0-based index in the data.library mirror.
 *
 * NOTE: Preserves original behaviour exactly — Library has no GAS
 * backend sync at all (see saveLibBook note above), so there was never
 * a syncDeleteToSheets()/ApiService.deleteData() call to replace here,
 * unlike the pre-existing sync gaps flagged for deleteDocument()/
 * deleteTask()/deleteFee() in prior audit reports (those sheets ARE
 * synced elsewhere; Library simply never is).
 *
 * Crosses the async boundary (Repository.delete() is Promise-returning)
 * — the only reason this function is now `async`.
 */
async function deleteLibBook(i) {
  if (!(await confirmDialog('حذف هذا العنصر من المكتبة؟'))) return;

  await ensureLibraryRepositoryReady();

  var record = data.library[i];
  if (!record) return;

  var id = record[LIBRARY_ID_FIELD];
  var result = await libraryRepository.delete(id);

  if (!result || !result.success) {
    toast('حدث خطأ أثناء الحذف', 'error');
    return;
  }

  syncLibraryMirror();
  saveLocal();
  toast('تم الحذف', 'info');
  renderLibrary();
  // PHASE 16.5.1 — DIRTY PROPAGATION (additive only, see phase brief)
  if (window.ApplicationShell) { ApplicationShell.markDirty('library'); }
}

/**
 * restoreLibBook(id) — استرجاع كتاب محذوف من المكتبة (Restore).
 * PHASE 10 — SUB-PHASE 10.4 — Restore Rollout (same pattern as Cases,
 * SUB-PHASE 10.3 — see docs/Restore_Rollout_Report.md).
 * Restores a soft-deleted library book via `libraryRepository.
 * restore(id)` (inherited, unmodified, from SUB-PHASE 10.2's
 * `Repository.prototype.restore()`). Symmetric with `deleteLibBook()`
 * above: same ready-guard, same `syncLibraryMirror()` -> `saveLocal()`
 * -> `renderLibrary()` sequence.
 *
 * No `updateBadges()` call — `deleteLibBook()` itself does not call it
 * either (Library has no dashboard badge), so this preserves exact
 * symmetry with the existing delete flow rather than introducing a new
 * side effect.
 *
 * ID, NOT INDEX — same documented reason as `restoreCase()`.
 * NO UI WIRING — Rollout scope, matches the Pilot.
 * Does NOT call `ApiService` — same explicit, documented design
 * decision as `restoreCase()` (`deleteLibBook()` itself calls no
 * `ApiService` method either, so this preserves exact symmetry).
 *
 * @param {string} id - the LibraryRepository id of the soft-deleted
 *   book to restore.
 */
async function restoreLibBook(id) {
  await ensureLibraryRepositoryReady();

  var result = await libraryRepository.restore(id);

  if (!result || !result.success) {
    toast('حدث خطأ أثناء الاسترجاع', 'error');
    return;
  }

  syncLibraryMirror();
  saveLocal();
  toast('تم الاسترجاع', 'success');
  renderLibrary();
  // PHASE 16.5.1 — DIRTY PROPAGATION (additive only, see phase brief)
  if (window.ApplicationShell) { ApplicationShell.markDirty('library'); }
}

// ================================================================
// Node/test export (browser: `module` is undefined, this is a no-op —
// renderLibrary/saveLibBook/editLibBook/deleteLibBook remain plain
// global functions exactly as before).
// ================================================================

// ================================================================
// UNDO / REDO — تراجع / إعادة (PHASE 12 — SUB-PHASE 12.5 — General Undo
// Integration)
// ================================================================
// Reversal mapping, redo-stack suspension, and instruction application
// are all handled by the shared js/core/UndoReconciler.js (extracted
// from the Cases pilot, SUB-PHASE 12.4 → 12.5) — this module only
// supplies its own `libraryRepository`/`LIBRARY_ID_FIELD` and its own refresh sequence
// (`sync/saveLocal/render (no badge concept for this entity)/toast`), matching every other
// entity module's `restoreLibBook()` refresh sequence exactly.
//
// `libraryRepository` disables no operations (`unsupportedOperations: []`,
// confirmed in js/repositories/LibraryRepository.js), so every reversal
// mapping case (create/update/delete/restore) is legal for this
// entity — same as Cases.

/**
 * undoLastLibBookAction() — PHASE 12.5. Reverses the most recent
 * Library mutation (create/update/delete/restore). Mirrors
 * `undoLastCaseAction()` (js/modules/cases.js) exactly: same guard on
 * `canUndo()`, same use of the shared `UndoReconciler.applyUndoInstruction()`,
 * same refresh sequence, same graceful handling of empty history, a
 * Repository/persist failure, or any unexpected exception.
 * @returns {Promise<void>}
 */
async function undoLastLibBookAction() {
  await ensureLibraryRepositoryReady();

  try {
    if (!libraryRepository.canUndo()) {
      toast('لا يوجد إجراء للتراجع عنه', 'info');
      return;
    }

    var instruction = libraryRepository.undo();
    if (!instruction) {
      toast('لا يوجد إجراء للتراجع عنه', 'info');
      return;
    }

    if (!UndoReconciler) {
      toast('حدث خطأ أثناء التراجع', 'error');
      return;
    }

    var result = await UndoReconciler.applyUndoInstruction(libraryRepository, LIBRARY_ID_FIELD, instruction, 'undo');
    if (!result || !result.success) {
      toast('حدث خطأ أثناء التراجع', 'error');
      return;
    }

    syncLibraryMirror();
    saveLocal();
    renderLibrary();
    // PHASE 16.5.1 — DIRTY PROPAGATION (additive only, see phase brief)
    if (window.ApplicationShell) { ApplicationShell.markDirty('library'); }
    toast('تم التراجع', 'success');
  } catch (e) {
    toast('حدث خطأ أثناء التراجع', 'error');
  }
}

/**
 * redoLastLibBookAction() — PHASE 12.5. Re-applies the most recently
 * undone Library mutation. Same refresh sequence, same shared-utility
 * usage, same error-handling guarantees as `undoLastLibBookAction()`
 * above — mirrors `redoLastCaseAction()` exactly.
 * @returns {Promise<void>}
 */
async function redoLastLibBookAction() {
  await ensureLibraryRepositoryReady();

  try {
    if (!libraryRepository.canRedo()) {
      toast('لا يوجد إجراء لإعادته', 'info');
      return;
    }

    var instruction = libraryRepository.redo();
    if (!instruction) {
      toast('لا يوجد إجراء لإعادته', 'info');
      return;
    }

    if (!UndoReconciler) {
      toast('حدث خطأ أثناء الإعادة', 'error');
      return;
    }

    var result = await UndoReconciler.applyUndoInstruction(libraryRepository, LIBRARY_ID_FIELD, instruction, 'redo');
    if (!result || !result.success) {
      toast('حدث خطأ أثناء الإعادة', 'error');
      return;
    }

    syncLibraryMirror();
    saveLocal();
    renderLibrary();
    // PHASE 16.5.1 — DIRTY PROPAGATION (additive only, see phase brief)
    if (window.ApplicationShell) { ApplicationShell.markDirty('library'); }
    toast('تمت الإعادة', 'success');
  } catch (e) {
    toast('حدث خطأ أثناء الإعادة', 'error');
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    libraryUndoManager: libraryUndoManager,
    undoLastLibBookAction: undoLastLibBookAction,
    redoLastLibBookAction: redoLastLibBookAction,
    LIBRARY_FIELDS: LIBRARY_FIELDS,
    LIBRARY_MAP: LIBRARY_MAP,
    LIBRARY_ID_FIELD: LIBRARY_ID_FIELD,
    libraryRepository: libraryRepository,
    ensureLibraryRepositoryReady: ensureLibraryRepositoryReady,
    syncLibraryMirror: syncLibraryMirror,
    resolveLibIndex: resolveLibIndex,
    renderLibrary: renderLibrary,
    saveLibBook: saveLibBook,
    editLibBook: editLibBook,
    deleteLibBook: deleteLibBook,
    restoreLibBook: restoreLibBook
  };
}
