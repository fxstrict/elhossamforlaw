/**
 * ================================================================
 * js/modules/templates.js — وحدة صيغ الدعاوى | نظام الحسام للمحاماة
 * ================================================================
 * Contains ALL Templates-related functions extracted from index.html.
 *
 * PHASE 10 — SUB-PHASE 10.4 — Restore Rollout
 * ----------------------------------------------------------------
 * Additive-only addition on top of PHASE 9.7 below: a new
 * `restoreTemplate(id)` function (see its own doc comment, next to
 * `deleteTemplate()`), same Cases-piloted pattern (SUB-PHASE 10.3). No
 * existing function in this file was changed. See
 * docs/Restore_Rollout_Report.md for the full audit and verification
 * evidence.
 *
 * PHASE 9 — SUB-PHASE 9.7 — Repository Integration (Templates Module)
 * ----------------------------------------------------------------
 * This module now reads and writes through js/repositories/
 * TemplatesRepository.js instead of the legacy global `data.templates`
 * array directly. Nothing else in the project was changed to make this
 * happen: TemplatesRepository.js, Repository.js, DatabaseService.js and
 * LocalStorageAdapter.js are all used exactly as PHASE 5/PHASE 8 left
 * them (no edits, no imports of internals). This follows the same
 * proven pattern used for the Documents module (SUB-PHASE 9.3), the
 * Sessions module (SUB-PHASE 9.4), the Tasks module (SUB-PHASE 9.5) and
 * the Library module (SUB-PHASE 9.6).
 *
 * WHY `data.templates` STILL EXISTS BELOW
 *   No other Module reads `data.templates` directly (a full-project scan
 *   confirms Templates is read/written only from this file, the same
 *   characteristic already documented for Library). The mirror is kept
 *   anyway, for two reasons: (1) it is the established pattern from
 *   every prior Repository integration this phase must follow "exactly",
 *   and (2) `saveLocal()` in index.html still persists `data.templates`
 *   directly to localStorage on every Module's save/delete path
 *   (`['cases','sessions',...,'templates',...].forEach(...)`) —
 *   `saveLocal()` is NOT part of this phase's mandate ("Modify ONLY
 *   templates.js"), so `data.templates` must keep mirroring
 *   TemplatesRepository's current state for that pre-existing call to
 *   keep persisting accurate data (in practice a harmless duplicate of
 *   what TemplatesRepository.create()/update()/delete() already
 *   persisted themselves under the same 'templates' localStorage key —
 *   see Templates_Repository_Integration_Report.md §5).
 *
 * READ / WRITE SPLIT (this phase's rule)
 *   - Reads (`renderTemplates`) call the Repository's SYNCHRONOUS
 *     methods only (`getAll()`, `filter()`) — no unnecessary async.
 *   - Writes (`saveTemplate`, `deleteTemplate`) are the ONLY functions
 *     in this file that cross the async boundary, because
 *     Repository.create()/update()/delete() are Promise-returning
 *     (Repository Contract §3 — Validate -> Write Local -> Persist).
 *   - `editTemplate` stays 100% synchronous and unchanged: it only reads
 *     the already-synced `data.templates` mirror to pre-fill the modal,
 *     exactly like before.
 *   - `filterTemplates` stays 100% synchronous and unchanged: it only
 *     writes the shared `currentTplFilter` state and calls
 *     `renderTemplates()`.
 *
 * INDEX -> RECORD -> ID TRANSLATION LAYER
 *   The rendered HTML still embeds plain 0-based array indexes in its
 *   `onclick="editTemplate(N)"` / `onclick="deleteTemplate(N)"`
 *   attributes (index.html's card template was not changed, per this
 *   phase's rule "Do NOT change generated HTML unless absolutely
 *   necessary"). Because TemplatesRepository.getAll()/filter() return
 *   CLONED records (not the same object references `data.templates`
 *   used to hold), the old `data.templates.indexOf(t)` reference-equality
 *   trick no longer works. `resolveTemplateIndex()` below is the
 *   smallest possible replacement: it looks a record up in the current
 *   mirror by its identifier field (`id`) instead of by reference.
 *   `editTemplate(i)` / `deleteTemplate(i)` then resolve that same index
 *   back to a record, and `deleteTemplate`/`saveTemplate` go one step
 *   further and resolve the record to its `id` before calling
 *   `TemplatesRepository.update()/delete()` (both take an id, not an
 *   index).
 *
 * IDENTIFIER GENERATION NOTE
 *   The original inline `saveTemplate()` stamped
 *   `obj['id'] = obj['id'] || uid();` on the plain object before
 *   pushing/assigning it. `TemplatesRepository._resolveId()`
 *   (js/repositories/TemplatesRepository.js §4.1) already replicates
 *   this exact generate-only-when-absent fallback internally on
 *   `create()`, so this module does not need to duplicate that stamp —
 *   `create(obj)` assigns the id itself, exactly as `saveDocument()`/
 *   `saveTask()`/`saveLibBook()` rely on their own Repositories to
 *   assign the id (see those modules' own "IDENTIFIER GENERATION NOTE").
 *   On the update path, `Repository.prototype.update()` unconditionally
 *   re-stamps `merged[idField] = existing[idField]` on the merged record
 *   regardless of what the patch contains (Repository.js §"update()"),
 *   so the pre-existing record's `id` is always preserved across an
 *   update — this is not a functional regression versus the original:
 *   `id` was never read, displayed, or otherwise relied upon anywhere
 *   in `renderTemplates()`/the UI, only used internally for the index
 *   translation layer above, and that layer only ever needs the id to
 *   stay stable *within* a single render pass, which it now does more
 *   reliably than before.
 *
 * SOFT DELETE — OBSERVABLE BEHAVIOR NOTE
 *   TemplatesRepository is configured with `softDelete: true` (unchanged,
 *   not this phase's decision to make). `delete(id)` therefore keeps
 *   the record in storage with a `deletedAt` stamp instead of physically
 *   removing it, unlike the original `data.templates.splice(i,1)`.
 *   `getAll()`/`filter()` both exclude soft-deleted records by default,
 *   so nothing deleted ever reappears anywhere `data.templates` is read
 *   (only this file reads it) — the UI-observable behavior is therefore
 *   identical to a hard delete.
 *
 * FILTER / SORT — both UI behaviors preserved bit-for-bit
 *   The Templates page has NO free-text search box (unlike Library's
 *   #searchLibrary) — its only query mechanism is the category-tab
 *   filter (`filterTemplates(cat)` / `#templateTabs`, exact-match on
 *   `القسم`), and this structure is unchanged: `filterTemplates()`
 *   still only sets `currentTplFilter` and calls `renderTemplates()`.
 *   `renderTemplates()` below now sources rows from
 *   `TemplatesRepository.getAll()` (when `currentTplFilter === 'all'`)
 *   or `TemplatesRepository.filter({القسم: currentTplFilter})`
 *   (otherwise) instead of a plain-JS `.filter()` on `data.templates` —
 *   `_matchesFilter()`'s exact-equality semantics (Repository.js §4.5)
 *   reproduce the original's `t['القسم'] === currentTplFilter` check
 *   exactly. No sort is applied — matching the original inline
 *   renderTemplates(), which never called `.sort()` (insertion order
 *   only). TemplatesRepository does expose an additive `sort()`
 *   convenience method, but using it here would change observable row
 *   order versus the original, so this phase's "preserve identical
 *   behavior" rule means it is intentionally NOT used in
 *   `renderTemplates()`.
 *
 * DYNAMIC CATEGORY TAB BAR — UNCHANGED
 *   `renderTemplates()` still rebuilds `#templateTabs`'s tab-button list
 *   on every call from the distinct `القسم` values present in the
 *   current data (`['all'].concat([...new Set(data.templates.map(...)
 *   .filter(Boolean))])`), reading the freshly-synced `data.templates`
 *   mirror exactly as before — this is a rendering-time UI concern only
 *   and needed no Repository-side change.
 *
 * Depends on (globals expected from index.html / prior scripts):
 *   - data              : shared app data object  { templates, … }
 *   - editIdx           : shared edit-index map   { templates: -1 }
 *   - currentTplFilter  : shared category-filter state string,
 *                         declared in index.html bootstrap
 *                         (`var currentPage=...,currentTplFilter='all';`).
 *                         Read by renderTemplates(), written by
 *                         filterTemplates(). NOT redeclared here —
 *                         it must remain a single shared global, the
 *                         same pattern as data/editIdx.
 *   - saveLocal()       : localStorage persistence helper
 *   - toast()           : UI notification helper
 *   - closeModal()      : modal close helper
 *   - val()             : getElementById+.value   (from ui-utils.js)
 *   - uid()             : unique-ID generator     (from ui-utils.js)
 *   - collectForm()     : generic form-to-object  (from ui-utils.js)
 *   - fillForm()        : generic object-to-form  (from ui-utils.js)
 *   - TemplatesRepository : js/repositories/TemplatesRepository.js
 *                         (loaded the same dual Node/browser way every
 *                         Repository file already loads its own
 *                         dependencies)
 *
 * GAS Sheet name: none — Templates has NO backend sync, identical to
 * Library. It is not part of the seven sheet→key pairs loaded by
 * ApiService.loadAllSheets() / loadFromSheets() (القضايا، الجلسات،
 * الموكلين، الأطفال، المستندات، المهام، الأتعاب), and the original
 * saveTemplate()/deleteTemplate() never called syncToSheets()/
 * syncDeleteToSheets(). Templates data is local-only (localStorage),
 * by original design — confirmed by full-file scan. This migration
 * therefore adds NO ApiService.syncRow()/deleteData() calls anywhere in
 * this file — there were none to begin with.
 *
 * Does NOT touch:
 *   - CSS / HTML structure
 *   - Other modules (cases, clients, sessions, documents, tasks, fees,
 *     library, calendar, settings)
 *   - `openAddTemplateModal()` — single-purpose modal opener, left in
 *     index.html (same precedent as openAddFeeModal/openAddLibModal/etc.)
 *   - Google Apps Script backend
 *   - Database / sheet structure
 *   - ApiService internals
 *   - js/core/Repository.js, DatabaseService.js, StorageAdapter.js,
 *     LocalStorageAdapter.js, js/repositories/TemplatesRepository.js
 * ================================================================
 */

'use strict';

// ================================================================
// FIELDS & MAP — templates slice only (unchanged)
// ================================================================

var TEMPLATES_FIELDS = [
  'fTplTitle',
  'fTplType',
  'fTplCat',
  'fTplUrl',
  'fTplDesc'
];

var TEMPLATES_MAP = {
  fTplTitle: 'العنوان',
  fTplType:  'النوع',
  fTplCat:   'القسم',
  fTplUrl:   'الرابط',
  fTplDesc:  'الوصف'
};

/**
 * Identifier field name — must match TemplatesRepository's own
 * TEMPLATES_ID_FIELD constant exactly (js/repositories/
 * TemplatesRepository.js §1). Duplicated here rather than imported,
 * same "depends only on its own declared dependency" discipline every
 * Repository-integrated module already uses for its own local
 * constants — this file's one declared new dependency is
 * TemplatesRepository itself, not its internals. Like Library's
 * identifier, Templates' identifier is the generic key `'id'` — see
 * TemplatesRepository.js file header "IDENTIFIER" note.
 */
var TEMPLATES_ID_FIELD = 'id';

// ================================================================
// REPOSITORY WIRING — PHASE 9 / SUB-PHASE 9.7
// ================================================================
// Same dual Node/browser loading shape already used by every file under
// js/repositories/ and js/core/: `require()` when running under Node
// (module.exports exists — this is how js/tests/verify_templates_
// repository_integration.js loads this file), otherwise the browser
// global `window.TemplatesRepository` (populated once index.html's
// <script> tags load js/core/Repository.js, DatabaseService.js,
// LocalStorageAdapter.js and js/repositories/TemplatesRepository.js
// ahead of this file — adding those tags to index.html is explicitly
// out of scope for this phase's "Modify ONLY templates.js" mandate).

var TemplatesRepositoryNS = (typeof module !== 'undefined' && module.exports)
  ? require('../repositories/TemplatesRepository.js')
  : (typeof window !== 'undefined' ? window : this);

var TemplatesRepository = TemplatesRepositoryNS && TemplatesRepositoryNS.TemplatesRepository;

if (typeof TemplatesRepository !== 'function') {
  throw new Error(
    'templates.js requires js/repositories/TemplatesRepository.js to be ' +
    'loaded first (TemplatesRepository class not found).'
  );
}

/**
 * The single TemplatesRepository instance this module talks to. Default
 * construction (no config) wires it to the real DatabaseService +
 * LocalStorageAdapter pair, reading/writing the exact same 'templates'
 * localStorage key `data.templates` always used.
 */
var templatesRepository = new TemplatesRepository();

/**
 * PHASE 12 — SUB-PHASE 12.5 — General Undo Integration.
 * js/core/UndoManager.js and js/core/UndoReconciler.js are required
 * here the same dual Node/browser way templatesRepository is required above,
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
      'templates.js: js/core/UndoManager.js was not found (index.html has ' +
      'not yet added its <script> tag for it). This module continues ' +
      'to work exactly as before this phase; undoLastTemplateAction()/' +
      'redoLastTemplateAction() will simply report nothing to undo/redo ' +
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
      'templates.js: js/core/UndoReconciler.js was not found (index.html has ' +
      'not yet added its <script> tag for it). undoLastTemplateAction()/' +
      'redoLastTemplateAction() will simply report nothing to undo/redo ' +
      'until this dependency is wired.'
    );
  }
  UndoReconciler = null;
}

/**
 * TemplatesUndoManager — PHASE 12.5: the single UndoManager instance
 * wired to `templatesRepository` via the public `setUndoManager()` façade
 * (SUB-PHASE 12.3, js/core/Repository.js, NOT modified by this phase).
 * Each entity module constructs and wires its OWN UndoManager instance
 * — this one is never shared with any other module — so that
 * Undo/Redo history for Templates stays completely separate from every
 * other entity's history (Phase 12.5 brief §11), exactly as already
 * true for `casesUndoManager` in js/modules/cases.js.
 */
var templatesUndoManager = (typeof UndoManager === 'function') ? new UndoManager(templatesRepository) : null;
if (templatesUndoManager) {
  templatesRepository.setUndoManager(templatesUndoManager);
}

/**
 * Resolves once TemplatesRepository.open() has loaded its initial
 * in-memory copy from storage (Repository Contract §11: Create -> Open
 * -> Ready). Every write path awaits this before touching the
 * Repository; renderTemplates()/editTemplate() stay synchronous and
 * simply no-op / render nothing until this resolves (see file header
 * "READ / WRITE SPLIT").
 */
var templatesRepositoryReadyPromise = (function () {
  var _p = templatesRepository.open().then(function () {
    syncTemplatesMirror();
  }).catch(function (err) {
    // Surface the failure without throwing out of a top-level Promise
    // chain (would otherwise be an unhandled rejection). renderTemplates()
    // guards on isReady() and simply shows nothing until this is fixed.
    if (typeof console !== 'undefined' && console.error) {
      console.error('TemplatesRepository failed to open:', err);
    }
  });
  // PHASE 17.0 — Startup Reliability: bound this Promise so a stuck
  // templatesRepository.open() can never hang
  // ensureTemplatesRepositoryReady() forever. See
  // js/core/RepositoryReadyTimeout.js. Purely additive: if that helper
  // isn't loaded, _p is returned completely unwrapped.
  return (typeof RepositoryReadyTimeout !== 'undefined') ? RepositoryReadyTimeout.wrap('templates', _p) : _p;
})();

/**
 * ensureTemplatesRepositoryReady() — awaited by every write path.
 * open() itself is idempotent (Repository.prototype.open() returns
 * immediately if already 'ready'/'busy'), so calling this more than once
 * is always safe and cheap.
 * @returns {Promise<void>}
 */
function ensureTemplatesRepositoryReady() {
  if (templatesRepository.isReady()) return Promise.resolve();
  return templatesRepositoryReadyPromise;
}

/**
 * syncTemplatesMirror — refreshes the legacy global `data.templates`
 * array from the Repository's current state (soft-deleted records
 * excluded, same as the Repository's own getAll() default). Called
 * after open() and after every create/update/delete this module
 * performs (see file header "WHY data.templates STILL EXISTS" note).
 */
function syncTemplatesMirror() {
  data.templates = templatesRepository.getAll();
}

/**
 * resolveTemplateIndex(list, record) — the index half of the "index ->
 * record -> id" translation layer (see file header). Finds `record`'s
 * position inside `list` by identifier equality (`id`), replacing the
 * old `data.templates.indexOf(t)` reference-equality lookup that no
 * longer works now that Repository reads return cloned objects.
 * @param {Object[]} list
 * @param {Object} record
 * @returns {number} 0-based index, or -1 if not found.
 */
function resolveTemplateIndex(list, record) {
  var id = record ? record[TEMPLATES_ID_FIELD] : undefined;
  for (var i = 0; i < list.length; i++) {
    if (list[i][TEMPLATES_ID_FIELD] === id) return i;
  }
  return -1;
}

// ================================================================
// CRUD — حفظ / تعديل / حذف
// ================================================================

/**
 * saveTemplate — validates, saves through TemplatesRepository.
 *
 * NOTE: Templates has no GAS backend sync — the original inline
 * saveTemplate() never called syncToSheets()/ApiService.syncRow().
 * This is preserved exactly, unmodified, per the "no functional
 * changes" migration mandate (Templates is not one of the seven
 * sheets the app loads/syncs).
 *
 * Replaces: inline saveTemplate() in index.html <script> block.
 *
 * Crosses the async boundary (Repository.create()/update() are
 * Promise-returning) — the only reason this function is now `async`.
 */
async function saveTemplate() {
  var t = document.getElementById('fTplTitle').value.trim();
  var c = document.getElementById('fTplCat').value.trim();
  if (!t || !c) {
    toast('يرجى ملء الاسم والقسم', 'error');
    return;
  }

  await ensureTemplatesRepositoryReady();

  var obj = collectForm('templates');
  // Note: obj['id'] is intentionally NOT stamped here — see file header
  // "IDENTIFIER GENERATION NOTE": TemplatesRepository.create() generates
  // it internally (only when absent), exactly replicating the original
  // `|| uid()` fallback. TemplatesRepository.update() always preserves
  // the existing record's id regardless of what is in obj.
  obj['تاريخ_الإنشاء'] = obj['تاريخ_الإنشاء'] || new Date().toISOString();

  var idx = editIdx.templates;
  var result;

  if (idx >= 0) {
    var existing = data.templates[idx];
    var existingId = existing ? existing[TEMPLATES_ID_FIELD] : null;
    result = await templatesRepository.update(existingId, obj);
  } else {
    result = await templatesRepository.create(obj);
  }

  if (!result || !result.success) {
    toast('حدث خطأ أثناء الحفظ', 'error');
    return;
  }

  syncTemplatesMirror();

  if (idx >= 0) {
    toast('تم التحديث', 'success');
  } else {
    toast('تمت الإضافة', 'success');
  }

  saveLocal();
  closeModal('modalTemplate');
  renderTemplates();
  // PHASE 16.5.1 — DIRTY PROPAGATION (additive only, see phase brief)
  if (window.ApplicationShell) { ApplicationShell.markDirty('templates'); }
}

/**
 * editTemplate — opens the template modal pre-filled with existing data.
 * Unchanged from before: purely a read of the (now Repository-backed)
 * data.templates mirror, so it stays fully synchronous — no Repository
 * call needed here at all.
 * @param {number} i - 0-based index in the data.templates mirror.
 */
function editTemplate(i) {
  editIdx.templates = i;
  fillForm('templates', data.templates[i]);
  document.getElementById('modalTplTitle').textContent = 'تعديل الصيغة';
  document.getElementById('modalTemplate').classList.add('open');
}

/**
 * deleteTemplate — confirms, removes via TemplatesRepository.
 * @param {number} i - 0-based index in the data.templates mirror.
 *
 * NOTE: Preserves original behaviour exactly — Templates has no GAS
 * backend sync at all (see saveTemplate note above), so there was never
 * a syncDeleteToSheets()/ApiService.deleteData() call to replace here,
 * identical to the same characteristic already documented for
 * deleteLibBook() in library.js.
 *
 * Crosses the async boundary (Repository.delete() is Promise-returning)
 * — the only reason this function is now `async`.
 */
async function deleteTemplate(i) {
  if (!(await confirmDialog('هل تريد حذف هذه الصيغة؟'))) return;

  await ensureTemplatesRepositoryReady();

  var record = data.templates[i];
  if (!record) return;

  var id = record[TEMPLATES_ID_FIELD];
  var result = await templatesRepository.delete(id);

  if (!result || !result.success) {
    toast('حدث خطأ أثناء الحذف', 'error');
    return;
  }

  syncTemplatesMirror();
  saveLocal();
  toast('تم الحذف', 'info');
  renderTemplates();
  // PHASE 16.5.1 — DIRTY PROPAGATION (additive only, see phase brief)
  if (window.ApplicationShell) { ApplicationShell.markDirty('templates'); }
}

/**
 * restoreTemplate(id) — استرجاع صيغة محذوفة (Restore).
 * PHASE 10 — SUB-PHASE 10.4 — Restore Rollout (same pattern as Cases,
 * SUB-PHASE 10.3 — see docs/Restore_Rollout_Report.md).
 * Restores a soft-deleted template via `templatesRepository.
 * restore(id)` (inherited, unmodified, from SUB-PHASE 10.2's
 * `Repository.prototype.restore()`). Symmetric with `deleteTemplate()`
 * above: same ready-guard, same `syncTemplatesMirror()` -> `saveLocal()`
 * -> `renderTemplates()` sequence.
 *
 * No `updateBadges()` call — `deleteTemplate()` itself does not call it
 * either (Templates has no dashboard badge), so this preserves exact
 * symmetry with the existing delete flow.
 *
 * ID, NOT INDEX — same documented reason as `restoreCase()`.
 * NO UI WIRING — Rollout scope, matches the Pilot.
 * Does NOT call `ApiService` — same explicit, documented design
 * decision as `restoreCase()` (`deleteTemplate()` itself calls no
 * `ApiService` method either, so this preserves exact symmetry).
 *
 * @param {string} id - the TemplatesRepository id of the soft-deleted
 *   template to restore.
 */
async function restoreTemplate(id) {
  await ensureTemplatesRepositoryReady();

  var result = await templatesRepository.restore(id);

  if (!result || !result.success) {
    toast('حدث خطأ أثناء الاسترجاع', 'error');
    return;
  }

  syncTemplatesMirror();
  saveLocal();
  toast('تم الاسترجاع', 'success');
  renderTemplates();
  // PHASE 16.5.1 — DIRTY PROPAGATION (additive only, see phase brief)
  if (window.ApplicationShell) { ApplicationShell.markDirty('templates'); }
}

// ================================================================
// FILTER — تصفية حسب القسم القانوني
// ================================================================

/**
 * filterTemplates — sets the active category-tab filter and re-renders.
 * @param {string} cat - 'all' or a specific قسم value
 *
 * NOTE: there is no standalone searchTemplates() function in the
 * original app, and no free-text search box exists on the Templates
 * page (unlike Library's #searchLibrary) — only category tabs built
 * dynamically by renderTemplates() and driven by filterTemplates().
 * This structure is preserved exactly. Purely synchronous, unchanged
 * from before — it never touched data.templates directly and still
 * doesn't.
 */
function filterTemplates(cat) {
  currentTplFilter = cat;
  renderTemplates();
}

// ================================================================
// RENDER — عرض قائمة صيغ الدعاوى
// ================================================================

/**
 * renderTemplates — rebuilds the category tab bar from the current
 * data, then renders the templates grid filtered by currentTplFilter.
 * Reads: TemplatesRepository (getAll + filter — both synchronous),
 *        currentTplFilter.
 * Writes to: #templateTabs, #templatesGrid, #templatesEmpty, and
 *            refreshes the data.templates mirror.
 */
function renderTemplates() {
  // Defensive only — see templatesRepositoryReadyPromise's doc comment.
  // In normal page load order this is always true by the time any
  // onclick/oninput can fire, since open() resolves via microtasks that
  // drain before the browser dispatches its first user-facing event.
  if (!templatesRepository.isReady()) return;

  syncTemplatesMirror();
  var allTemplates = data.templates;

  var cats = ['all'].concat([...new Set(allTemplates.map(function(t) { return t['القسم']; }).filter(Boolean))]);

  document.getElementById('templateTabs').innerHTML = cats.map(function(c) {
    return (
      '<button class="tab-btn' + (c === currentTplFilter ? ' active' : '') + '" onclick="filterTemplates(\'' + c + '\')">' +
        (c === 'all' ? '&#128203; الكل' : '&#9878; ' + c) +
      '</button>'
    );
  }).join('');

  var rows = currentTplFilter === 'all'
    ? templatesRepository.getAll()
    : templatesRepository.filter({ 'القسم': currentTplFilter });

  var g  = document.getElementById('templatesGrid');
  var em = document.getElementById('templatesEmpty');

  if (!rows.length) {
    g.innerHTML = '';
    // PHASE 16.16 — SAFETY: the line above wipes the container's real
    // children directly (not through DomRecycler), so any key->node
    // references DomKeyIndex is holding for it would now point at
    // detached/dead nodes. Reset so the next non-empty render starts
    // clean instead of reusing dead references. Additive only —
    // window.DomKeyIndex may be undefined if js/core/dom/ isn't
    // loaded, hence the guard (same pattern as library.js/tasks.js/
    // cases.js/clients.js/sessions.js/documents.js/fees.js/children.js).
    if (window.DomKeyIndex) DomKeyIndex.reset(g);
    em.style.display = '';
    return;
  }
  em.style.display = 'none';

  var ti = { word: '&#128216;', pdf: '&#128213;', other: '&#128196;' };

  // ----------------------------------------------------------------
  // PHASE 16.16 — DomRecycler Migration (Templates)
  // ----------------------------------------------------------------
  // templateCardInnerHtml() is the EXACT SAME markup this function has
  // always built for each template — narrowed from "whole container"
  // to "one template at a time", exactly like libCardInnerHtml() in
  // library.js (16.15): ONE container (#templatesGrid — no separate
  // desktop table + mobile list), fixed outer className ('lib-card',
  // never varies per item), so options.attrs is deliberately omitted
  // here too (matches Library/Sessions/Cases/Clients/Documents/Fees/
  // Children, not Tasks, where className genuinely varies per item).

  function templateCardInnerHtml(t) {
    var ri = resolveTemplateIndex(allTemplates, t);
    return (
      '<span class="lib-card-type ' + (t['النوع'] === 'word' ? 'word' : t['النوع'] === 'pdf' ? 'pdf' : 'other') + '">' +
        (t['النوع'] ? t['النوع'].toUpperCase() : 'ملف') +
      '</span>' +
      '<span class="lib-card-icon">' + (ti[t['النوع']] || '&#128196;') + '</span>' +
      '<div class="lib-card-title">' + t['العنوان'] + '</div>' +
      '<div class="lib-card-meta">&#128193; ' + t['القسم'] + '</div>' +
      (t['الوصف']
        ? '<div style="font-size:11px;color:var(--muted);margin-top:5px;line-height:1.5;">' + t['الوصف'] + '</div>'
        : '') +
      '<div class="lib-card-actions">' +
        (t['الرابط']
          ? '<a href="' + t['الرابط'] + '" target="_blank" class="btn btn-success btn-sm" style="flex:1;justify-content:center;">&#11015; تحميل</a>'
          : '<span style="font-size:11px;color:var(--muted);flex:1;">بدون رابط</span>') +
        '<button class="btn btn-ghost btn-sm btn-icon" onclick="editTemplate(' + ri + ')">&#9998;</button>' +
        '<button class="btn btn-danger btn-sm btn-icon" onclick="deleteTemplate(' + ri + ')">&#128465;</button>' +
      '</div>'
    );
  }

  // TEMPLATES_ID_FIELD ('id') only — stable identity, exactly like
  // libRowKey()/sessionRowKey()/caseRowKey()/clientRowKey()/taskRowKey().
  function templateRowKey(t) { return t[TEMPLATES_ID_FIELD]; }

  var recycled = false;
  if (window.DomRecycler && typeof DomRecycler.reconcile === 'function') {
    try {
      DomRecycler.reconcile(g, rows, { key: templateRowKey, tag: 'div', className: 'lib-card', render: templateCardInnerHtml });
      recycled = true;
    } catch (domRecyclerError) {
      // PHASE 16.6/16.9/16.10/16.11/16.12/16.13/16.14/16.15 SAFETY
      // (unchanged pattern): any recycler failure falls straight back
      // to the legacy full-rebuild path below, and drops whatever
      // partial key-index state the failed attempt may have left
      // behind so the NEXT render (recycled or not) never inherits it.
      recycled = false;
      if (window.DomKeyIndex) DomKeyIndex.reset(g);
    }
  }

  if (!recycled) {
    // ORIGINAL PHASE ≤16.15 implementation — UNCHANGED (full rebuild),
    // kept exactly as the guaranteed-safe fallback path. Uses the SAME
    // templateCardInnerHtml() template function defined above, just
    // with the outer wrapper restored around it.
    g.innerHTML = rows.map(function(t) {
      return '<div class="lib-card">' + templateCardInnerHtml(t) + '</div>';
    }).join('');
  }
}

// ================================================================
// Node/test export (browser: `module` is undefined, this is a no-op —
// renderTemplates/saveTemplate/editTemplate/deleteTemplate/
// filterTemplates remain plain global functions exactly as before).
// ================================================================

// ================================================================
// UNDO / REDO — تراجع / إعادة (PHASE 12 — SUB-PHASE 12.5 — General Undo
// Integration)
// ================================================================
// Reversal mapping, redo-stack suspension, and instruction application
// are all handled by the shared js/core/UndoReconciler.js (extracted
// from the Cases pilot, SUB-PHASE 12.4 → 12.5) — this module only
// supplies its own `templatesRepository`/`TEMPLATES_ID_FIELD` and its own refresh sequence
// (`sync/saveLocal/render (no badge concept for this entity)/toast`), matching every other
// entity module's `restoreTemplate()` refresh sequence exactly.
//
// `templatesRepository` disables no operations (`unsupportedOperations: []`,
// confirmed in js/repositories/TemplatesRepository.js), so every reversal
// mapping case (create/update/delete/restore) is legal for this
// entity — same as Cases.

/**
 * undoLastTemplateAction() — PHASE 12.5. Reverses the most recent
 * Templates mutation (create/update/delete/restore). Mirrors
 * `undoLastCaseAction()` (js/modules/cases.js) exactly: same guard on
 * `canUndo()`, same use of the shared `UndoReconciler.applyUndoInstruction()`,
 * same refresh sequence, same graceful handling of empty history, a
 * Repository/persist failure, or any unexpected exception.
 * @returns {Promise<void>}
 */
async function undoLastTemplateAction() {
  await ensureTemplatesRepositoryReady();

  try {
    if (!templatesRepository.canUndo()) {
      toast('لا يوجد إجراء للتراجع عنه', 'info');
      return;
    }

    var instruction = templatesRepository.undo();
    if (!instruction) {
      toast('لا يوجد إجراء للتراجع عنه', 'info');
      return;
    }

    if (!UndoReconciler) {
      toast('حدث خطأ أثناء التراجع', 'error');
      return;
    }

    var result = await UndoReconciler.applyUndoInstruction(templatesRepository, TEMPLATES_ID_FIELD, instruction, 'undo');
    if (!result || !result.success) {
      toast('حدث خطأ أثناء التراجع', 'error');
      return;
    }

    syncTemplatesMirror();
    saveLocal();
    renderTemplates();
    // PHASE 16.5.1 — DIRTY PROPAGATION (additive only, see phase brief)
    if (window.ApplicationShell) { ApplicationShell.markDirty('templates'); }
    toast('تم التراجع', 'success');
  } catch (e) {
    toast('حدث خطأ أثناء التراجع', 'error');
  }
}

/**
 * redoLastTemplateAction() — PHASE 12.5. Re-applies the most recently
 * undone Templates mutation. Same refresh sequence, same shared-utility
 * usage, same error-handling guarantees as `undoLastTemplateAction()`
 * above — mirrors `redoLastCaseAction()` exactly.
 * @returns {Promise<void>}
 */
async function redoLastTemplateAction() {
  await ensureTemplatesRepositoryReady();

  try {
    if (!templatesRepository.canRedo()) {
      toast('لا يوجد إجراء لإعادته', 'info');
      return;
    }

    var instruction = templatesRepository.redo();
    if (!instruction) {
      toast('لا يوجد إجراء لإعادته', 'info');
      return;
    }

    if (!UndoReconciler) {
      toast('حدث خطأ أثناء الإعادة', 'error');
      return;
    }

    var result = await UndoReconciler.applyUndoInstruction(templatesRepository, TEMPLATES_ID_FIELD, instruction, 'redo');
    if (!result || !result.success) {
      toast('حدث خطأ أثناء الإعادة', 'error');
      return;
    }

    syncTemplatesMirror();
    saveLocal();
    renderTemplates();
    // PHASE 16.5.1 — DIRTY PROPAGATION (additive only, see phase brief)
    if (window.ApplicationShell) { ApplicationShell.markDirty('templates'); }
    toast('تمت الإعادة', 'success');
  } catch (e) {
    toast('حدث خطأ أثناء الإعادة', 'error');
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    templatesUndoManager: templatesUndoManager,
    undoLastTemplateAction: undoLastTemplateAction,
    redoLastTemplateAction: redoLastTemplateAction,
    TEMPLATES_FIELDS: TEMPLATES_FIELDS,
    TEMPLATES_MAP: TEMPLATES_MAP,
    TEMPLATES_ID_FIELD: TEMPLATES_ID_FIELD,
    templatesRepository: templatesRepository,
    ensureTemplatesRepositoryReady: ensureTemplatesRepositoryReady,
    syncTemplatesMirror: syncTemplatesMirror,
    resolveTemplateIndex: resolveTemplateIndex,
    renderTemplates: renderTemplates,
    saveTemplate: saveTemplate,
    editTemplate: editTemplate,
    deleteTemplate: deleteTemplate,
    restoreTemplate: restoreTemplate,
    filterTemplates: filterTemplates
  };
}
