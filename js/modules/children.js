/**
 * ================================================================
 * js/modules/children.js — وحدة الأطفال | نظام الحسام للمحاماة
 * ================================================================
 * Contains ALL Children-related functions extracted from index.html.
 *
 * PHASE 10 — SUB-PHASE 10.4 — Restore Rollout
 * ----------------------------------------------------------------
 * Additive-only addition on top of PHASE 9.8 below: a new
 * `restoreChild(id)` function (see its own doc comment, next to
 * `deleteChild()`), same Cases-piloted pattern (SUB-PHASE 10.3). No
 * existing function in this file was changed. See
 * docs/Restore_Rollout_Report.md for the full audit and verification
 * evidence.
 *
 * PHASE 9 — SUB-PHASE 9.8 — Repository Integration (Children Module)
 * ----------------------------------------------------------------
 * This module now reads and writes through js/repositories/
 * ChildrenRepository.js instead of the legacy global `data.children`
 * array directly. Nothing else in the project was changed to make this
 * happen: ChildrenRepository.js, Repository.js, DatabaseService.js and
 * LocalStorageAdapter.js are all used exactly as PHASE 5/PHASE 8 left
 * them (no edits, no imports of internals). This follows the same
 * proven pattern used for the Documents module (SUB-PHASE 9.3), the
 * Sessions module (SUB-PHASE 9.4), the Tasks module (SUB-PHASE 9.5),
 * the Library module (SUB-PHASE 9.6), and the Templates module
 * (SUB-PHASE 9.7).
 *
 * SCOPE NOTE: This module covers ONLY the standalone Children feature
 * (the "الأطفال" page: data.children[]). It does NOT include the
 * separate, already-extracted embedded children section inside the
 * Case modal (toggleChildrenSection / addChildRow / updateChildrenData
 * / loadChildrenRows), which lives in js/modules/cases.js and operates
 * on the JSON-string field أطفال_القضية inside each case record — that
 * code is untouched, unrelated, and out of scope here, exactly as it
 * was in the pre-migration file.
 *
 * WHY `data.children` STILL EXISTS BELOW
 *   js/modules/dashboard.js (`data.children.length` for the sidebar
 *   badge) reads the global `data.children` array directly, and this
 *   phase's mandate is "Modify ONLY children.js" — dashboard.js may not
 *   be touched. So `data.children` is kept alive as a read-only MIRROR
 *   of `ChildrenRepository.getAll()`, refreshed after every Repository
 *   read/write this file performs. Every other module keeps working
 *   unmodified and unaware that Children moved to the Repository.
 *
 * READ / WRITE SPLIT (this phase's rule)
 *   - Reads (`renderChildren`) call the Repository's SYNCHRONOUS
 *     methods only (`getAll()`, `search()`) — no unnecessary async.
 *   - Writes (`saveChild`, `deleteChild`) are the ONLY functions in this
 *     file that cross the async boundary, because
 *     Repository.create()/update()/delete() are Promise-returning
 *     (Repository Contract §3 — Validate -> Write Local -> Persist).
 *   - `openAddChildModal` and `editChild` stay 100% synchronous and
 *     unchanged: they only read the already-synced `data.children`
 *     mirror / populate the modal, exactly like before.
 *
 * INDEX -> RECORD -> ID TRANSLATION LAYER
 *   The rendered HTML still embeds plain 0-based array indexes in its
 *   `onclick="editChild(N)"` / `onclick="deleteChild(N)"` attributes
 *   (index.html's row templates were not changed, per this phase's
 *   rule "Do NOT change generated HTML unless absolutely necessary").
 *   Because ChildrenRepository.search()/getAll() return CLONED records
 *   (not the same object references `data.children` used to hold), the
 *   old `data.children.indexOf(c)` reference-equality trick no longer
 *   works. `resolveChildIndex()` below is the smallest possible
 *   replacement: it looks a record up in the current mirror by its
 *   identifier field (`رقم_الطفل`) instead of by reference.
 *   `editChild(i)` / `deleteChild(i)` then resolve that same index back
 *   to a record, and `deleteChild`/`saveChild` go one step further and
 *   resolve the record to its `رقم_الطفل` id before calling
 *   `ChildrenRepository.update()/delete()` (both take an id, not an
 *   index).
 *
 * SOFT DELETE — OBSERVABLE BEHAVIOR NOTE
 *   ChildrenRepository is configured with `softDelete: true` (unchanged,
 *   not this phase's decision to make). `delete(id)` therefore keeps
 *   the record in storage with a `deletedAt` stamp instead of
 *   physically removing it, unlike the original `data.children.splice
 *   (i,1)`. `getAll()`/`search()` both exclude soft-deleted records by
 *   default, so nothing deleted ever reappears anywhere `data.children`
 *   is read (this file, dashboard.js) — the UI-observable behavior is
 *   therefore identical to a hard delete.
 *
 * IDENTIFIER GENERATION NOTE
 *   The original inline `saveChild()` stamped
 *   `obj['رقم_الطفل'] = obj['رقم_الطفل'] || uid();` on the plain object
 *   before pushing/assigning it. `ChildrenRepository._resolveId()`
 *   (js/repositories/ChildrenRepository.js) already replicates this
 *   exact fallback internally on `create()` (generate only when
 *   absent), so this module does not need to duplicate that stamp —
 *   `create(obj)` assigns the id itself, exactly as
 *   `saveDocument()`/`saveSession()`/`saveTask()` rely on their own
 *   Repositories to assign the id.
 *
 * SEARCH — the free-text `#searchChildren` join (`Object.values(c).
 *   join(' ').toLowerCase().includes(s)`) is preserved bit-for-bit:
 *   `ChildrenRepository._matchesSearch()` replicates the exact same
 *   join across `CHILDREN_LEGACY_FIELDS`. No filter control and no sort
 *   exist on the Children page — matching the original inline
 *   `renderChildren()`, which never called `.sort()` (insertion order
 *   only) and never read any filter dropdown.
 *
 * ================================================================
 * SPECIAL REQUIREMENT — LEGACY SYNC BEHAVIOR (syncToSheets) — NOT
 * TOUCHED, NOT MIGRATED, NOT FIXED
 * ================================================================
 *   Unlike every other already-migrated module (Documents, Sessions,
 *   Tasks, Library, Templates — all of which now call
 *   `ApiService.syncRow()`/`ApiService.deleteData()`), this module
 *   deliberately keeps calling the legacy global `syncToSheets()`
 *   function (defined in js/modules/settings.js), exactly as the
 *   pre-migration file did:
 *     if(API_URL)syncToSheets('الأطفال',obj,idx);
 *   Two facts, both already confirmed by prior audits and repeated here
 *   per this phase's explicit instruction, make this the CORRECT
 *   behavior to preserve rather than "fix":
 *     1. The server-side Apps Script (Code_v4.gs SHEET_DEFS) has NO
 *        'الأطفال' sheet defined at all.
 *     2. js/modules/settings.js's loadFromSheets() nonetheless still
 *        lists the ['الأطفال','children'] pair among the sheets it
 *        tries to pull on refresh.
 *   Both are pre-existing, already-known gaps, not introduced or
 *   resolved by this phase. This module's mandate is Repository
 *   integration only — the sync target and sync mechanism for Children
 *   are explicitly out of scope and are left byte-for-byte as they
 *   were. See docs/Children_Repository_Integration_Report.md, section
 *   "Legacy Behavior Preserved", for the full explanation.
 *
 * `deleteChild()` — like the pre-migration file — does NOT call
 *   `syncToSheets()`/`syncDeleteToSheets()` at all (there never was a
 *   delete-sync call for Children). This module makes no functional
 *   change to that pre-existing gap either.
 *
 * Depends on (globals expected from index.html / prior scripts):
 *   - data                  : shared app data object { children, cases, … }
 *   - editIdx                : shared edit-index map { children: -1 }
 *   - API_URL                : global Apps Script URL string (settings.js)
 *   - syncToSheets()         : legacy GAS sync helper (js/modules/settings.js)
 *                              — intentionally NOT replaced by ApiService;
 *                              see "SPECIAL REQUIREMENT" note above.
 *   - saveLocal()            : localStorage persistence helper
 *   - toast()                : UI notification helper
 *   - updateBadges()         : badge counter updater
 *   - closeModal()           : modal close helper
 *   - val()                  : getElementById+.value (from ui-utils.js)
 *   - uid()                  : unique-ID generator (from ui-utils.js) —
 *                              no longer called directly by this file
 *                              (see IDENTIFIER GENERATION NOTE), kept in
 *                              the dependency list only because
 *                              js/ui-utils.js is still a load-order
 *                              requirement of this file.
 *   - collectForm()          : generic form-to-object (overridden by
 *                              cases.js, per original load-order note)
 *   - fillForm()              : generic object-to-form (overridden by
 *                              cases.js, per original load-order note)
 *   - resetForm()             : generic form reset (overridden by
 *                              cases.js, per original load-order note)
 *   - populateCaseDropdown()  : case-picker populator (js/modules/cases.js)
 *   - ChildrenRepository      : js/repositories/ChildrenRepository.js
 *                              (loaded the same dual Node/browser way
 *                              every Repository file already loads its
 *                              own dependencies)
 *
 * GAS Sheet name: 'الأطفال' (no matching server-side sheet exists — see
 * "SPECIAL REQUIREMENT" note above).
 *
 * Does NOT touch:
 *   - CSS / HTML structure
 *   - Other modules (cases, clients, sessions, documents, tasks, fees,
 *     library, templates, settings, dashboard, calendar)
 *   - Dashboard widgets (#badgeChildren — owned by dashboard.js, since
 *     it reads across multiple data slices)
 *   - Google Apps Script backend
 *   - Database / sheet structure
 *   - js/core/Repository.js, DatabaseService.js, StorageAdapter.js,
 *     LocalStorageAdapter.js, js/repositories/ChildrenRepository.js
 * ================================================================
 */

'use strict';

/**
 * Identifier field name — must match ChildrenRepository's own
 * CHILDREN_ID_FIELD constant exactly (js/repositories/
 * ChildrenRepository.js, §1). Duplicated here rather than imported,
 * same "depends only on its own declared dependency" discipline every
 * Repository-integrated module already uses for its own local
 * constants — this file's one declared new dependency is
 * ChildrenRepository itself, not its internals.
 */
var CHILDREN_ID_FIELD = 'رقم_الطفل';

// ================================================================
// REPOSITORY WIRING — PHASE 9 / SUB-PHASE 9.8
// ================================================================
// Same dual Node/browser loading shape already used by every file under
// js/repositories/ and js/core/: `require()` when running under Node
// (module.exports exists — this is how js/tests/verify_children_
// repository_integration.js loads this file), otherwise the browser
// global `window.ChildrenRepository` (populated once index.html's
// <script> tags load js/core/Repository.js, DatabaseService.js,
// LocalStorageAdapter.js and js/repositories/ChildrenRepository.js
// ahead of this file — adding those tags to index.html is explicitly
// out of scope for this phase's "Modify ONLY children.js" mandate).

var ChildrenRepositoryNS = (typeof module !== 'undefined' && module.exports)
  ? require('../repositories/ChildrenRepository.js')
  : (typeof window !== 'undefined' ? window : this);

var ChildrenRepository = ChildrenRepositoryNS && ChildrenRepositoryNS.ChildrenRepository;

if (typeof ChildrenRepository !== 'function') {
  throw new Error(
    'children.js requires js/repositories/ChildrenRepository.js to be ' +
    'loaded first (ChildrenRepository class not found).'
  );
}

/**
 * The single ChildrenRepository instance this module talks to. Default
 * construction (no config) wires it to the real DatabaseService +
 * LocalStorageAdapter pair, reading/writing the exact same 'children'
 * localStorage key `data.children` always used.
 */
var childrenRepository = new ChildrenRepository();

/**
 * PHASE 12 — SUB-PHASE 12.5 — General Undo Integration.
 * js/core/UndoManager.js and js/core/UndoReconciler.js are required
 * here the same dual Node/browser way childrenRepository is required above,
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
      'children.js: js/core/UndoManager.js was not found (index.html has ' +
      'not yet added its <script> tag for it). This module continues ' +
      'to work exactly as before this phase; undoLastChildAction()/' +
      'redoLastChildAction() will simply report nothing to undo/redo ' +
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
      'children.js: js/core/UndoReconciler.js was not found (index.html has ' +
      'not yet added its <script> tag for it). undoLastChildAction()/' +
      'redoLastChildAction() will simply report nothing to undo/redo ' +
      'until this dependency is wired.'
    );
  }
  UndoReconciler = null;
}

/**
 * ChildrenUndoManager — PHASE 12.5: the single UndoManager instance
 * wired to `childrenRepository` via the public `setUndoManager()` façade
 * (SUB-PHASE 12.3, js/core/Repository.js, NOT modified by this phase).
 * Each entity module constructs and wires its OWN UndoManager instance
 * — this one is never shared with any other module — so that
 * Undo/Redo history for Children stays completely separate from every
 * other entity's history (Phase 12.5 brief §11), exactly as already
 * true for `casesUndoManager` in js/modules/cases.js.
 */
var childrenUndoManager = (typeof UndoManager === 'function') ? new UndoManager(childrenRepository) : null;
if (childrenUndoManager) {
  childrenRepository.setUndoManager(childrenUndoManager);
}

/**
 * Resolves once ChildrenRepository.open() has loaded its initial
 * in-memory copy from storage (Repository Contract §11: Create -> Open
 * -> Ready). Every write path awaits this before touching the
 * Repository; renderChildren()/editChild() stay synchronous and simply
 * no-op / read a possibly-stale mirror in the vanishingly small window
 * before this resolves (see file header "READ / WRITE SPLIT").
 */
var childrenRepositoryReadyPromise = (function () {
  var _p = childrenRepository.open().then(function () {
    syncChildrenMirror();
  }).catch(function (err) {
    // Surface the failure without throwing out of a top-level Promise
    // chain (would otherwise be an unhandled rejection). renderChildren()
    // guards on isReady() and simply shows nothing until this is fixed.
    if (typeof console !== 'undefined' && console.error) {
      console.error('ChildrenRepository failed to open:', err);
    }
  });
  // PHASE 17.0 — Startup Reliability: bound this Promise so a stuck
  // childrenRepository.open() can never hang ensureChildrenRepositoryReady()
  // forever. See js/core/RepositoryReadyTimeout.js. Purely additive:
  // if that helper isn't loaded, _p is returned completely unwrapped.
  return (typeof RepositoryReadyTimeout !== 'undefined') ? RepositoryReadyTimeout.wrap('children', _p) : _p;
})();

/**
 * ensureChildrenRepositoryReady() — awaited by every write path. open()
 * itself is idempotent (Repository.prototype.open() returns
 * immediately if already 'ready'/'busy'), so calling this more than
 * once is always safe and cheap.
 * @returns {Promise<void>}
 */
function ensureChildrenRepositoryReady() {
  if (childrenRepository.isReady()) return Promise.resolve();
  return childrenRepositoryReadyPromise;
}

/**
 * syncChildrenMirror — refreshes the legacy global `data.children`
 * array from the Repository's current state (soft-deleted records
 * excluded, same as the Repository's own getAll() default). Called
 * after open() and after every create/update/delete this module
 * performs, so dashboard.js keeps seeing accurate data without being
 * touched itself.
 */
function syncChildrenMirror() {
  data.children = childrenRepository.getAll();
}

/**
 * resolveChildIndex(list, record) — the index half of the "index ->
 * record -> id" translation layer (see file header). Finds `record`'s
 * position inside `list` by identifier equality (`رقم_الطفل`),
 * replacing the old `data.children.indexOf(c)` reference-equality
 * lookup that no longer works now that Repository reads return cloned
 * objects.
 * @param {Object[]} list
 * @param {Object} record
 * @returns {number} 0-based index, or -1 if not found.
 */
function resolveChildIndex(list, record) {
  var id = record ? record[CHILDREN_ID_FIELD] : undefined;
  for (var i = 0; i < list.length; i++) {
    if (list[i][CHILDREN_ID_FIELD] === id) return i;
  }
  return -1;
}

// ================================================================
// MODAL — فتح / تعديل
// ================================================================

/**
 * openAddChildModal — opens the "add child" modal in create mode.
 * Unchanged from before: purely DOM/modal setup plus
 * populateCaseDropdown() (js/modules/cases.js) — no Repository call
 * needed here at all.
 */
function openAddChildModal(){editIdx.children=-1;resetForm('children');document.getElementById('modalChildTitle').textContent='إضافة بيانات طفل';document.getElementById('modalChild').classList.add('open');populateCaseDropdown('fChildCaseNum');}

// ================================================================
// CRUD — حفظ / تعديل / حذف
// ================================================================

/**
 * saveChild — validates, saves through ChildrenRepository, syncs to
 * GAS via the legacy syncToSheets() call (NOT ApiService — see file
 * header "SPECIAL REQUIREMENT" note).
 * Replaces: inline saveChild() in index.html <script> block.
 *
 * Crosses the async boundary (Repository.create()/update() are
 * Promise-returning) — the only reason this function is now `async`.
 */
async function saveChild(){
  var c=document.getElementById('fChildCaseNum').value.trim();
  var n=document.getElementById('fChildName').value.trim();
  if(!c||!n){toast('يرجى ملء رقم القضية واسم الطفل','error');return;}

  await ensureChildrenRepositoryReady();

  var obj=collectForm('children');
  // Note: obj['رقم_الطفل'] is intentionally NOT stamped here — see file
  // header "IDENTIFIER GENERATION NOTE": ChildrenRepository.create()
  // generates it internally (only when absent), exactly replicating
  // the original `|| uid()` fallback. ChildrenRepository.update()
  // always preserves the existing record's id regardless of what is in
  // obj.
  obj['تاريخ_الإنشاء']=obj['تاريخ_الإنشاء']||new Date().toISOString();

  var idx=editIdx.children;
  var result;

  if(idx>=0){
    var existing=data.children[idx];
    var existingId=existing?existing[CHILDREN_ID_FIELD]:null;
    result=await childrenRepository.update(existingId,obj);
  }else{
    result=await childrenRepository.create(obj);
  }

  if(!result||!result.success){
    toast('حدث خطأ أثناء الحفظ','error');
    return;
  }

  syncChildrenMirror();

  if(idx>=0){toast('تم التحديث','success');}else{toast('تمت الإضافة','success');}

  saveLocal();
  if(API_URL)syncToSheets('الأطفال',result.record,idx);   // legacy call — see "SPECIAL REQUIREMENT" note
  closeModal('modalChild');
  renderChildren();
  updateBadges();
  // PHASE 16.5.1 — DIRTY PROPAGATION (additive only, see phase brief)
  if (window.ApplicationShell) { ApplicationShell.markDirty('children'); }
}

/**
 * editChild — opens the child modal pre-filled with existing data.
 * Unchanged from before: purely a read of the (now Repository-backed)
 * data.children mirror, so it stays fully synchronous — no Repository
 * call needed here at all.
 * @param {number} i - 0-based index in the data.children mirror.
 */
function editChild(i){editIdx.children=i;populateCaseDropdown('fChildCaseNum',data.children[i]['رقم_القضية']);fillForm('children',data.children[i]);document.getElementById('modalChildTitle').textContent='تعديل بيانات الطفل';document.getElementById('modalChild').classList.add('open');}

/**
 * deleteChild — confirms, removes via ChildrenRepository.
 * @param {number} i - 0-based index in the data.children mirror.
 *
 * NOTE: Preserves original behaviour exactly — the original inline
 * deleteChild() never called syncToSheets()/syncDeleteToSheets() at
 * all (there never was a delete-sync call for Children). This module
 * makes no functional change to that pre-existing gap.
 *
 * Crosses the async boundary (Repository.delete() is Promise-returning)
 * — the only reason this function is now `async`.
 */
async function deleteChild(i){
  if(!(await confirmDialog('هل تريد حذف بيانات هذا الطفل؟')))return;

  await ensureChildrenRepositoryReady();

  var record=data.children[i];
  if(!record)return;

  var id=record[CHILDREN_ID_FIELD];
  var result=await childrenRepository.delete(id);

  if(!result||!result.success){
    toast('حدث خطأ أثناء الحذف','error');
    return;
  }

  syncChildrenMirror();
  saveLocal();
  toast('تم الحذف','info');
  renderChildren();
  updateBadges();
  // PHASE 16.5.1 — DIRTY PROPAGATION (additive only, see phase brief)
  if (window.ApplicationShell) { ApplicationShell.markDirty('children'); }
}

/**
 * restoreChild(id) — استرجاع سجل طفل محذوف (Restore).
 * PHASE 10 — SUB-PHASE 10.4 — Restore Rollout (same pattern as Cases,
 * SUB-PHASE 10.3 — see docs/Restore_Rollout_Report.md).
 * Restores a soft-deleted child record via `childrenRepository.
 * restore(id)` (inherited, unmodified, from SUB-PHASE 10.2's
 * `Repository.prototype.restore()`). Symmetric with `deleteChild()`
 * above: same ready-guard, same `syncChildrenMirror()` -> `saveLocal()`
 * -> `renderChildren()` -> `updateBadges()` sequence.
 *
 * ID, NOT INDEX — same documented reason as `restoreCase()`.
 * NO UI WIRING — Rollout scope, matches the Pilot.
 * Does NOT call `ApiService` — same explicit, documented design
 * decision as `restoreCase()` (`deleteChild()` itself calls no
 * `ApiService` method either, so this preserves exact symmetry).
 *
 * @param {string} id - the ChildrenRepository id (رقم_الطفل) of the
 *   soft-deleted child record to restore.
 */
async function restoreChild(id){
  await ensureChildrenRepositoryReady();

  var result=await childrenRepository.restore(id);

  if(!result||!result.success){
    toast('حدث خطأ أثناء الاسترجاع','error');
    return;
  }

  syncChildrenMirror();
  saveLocal();
  toast('تم الاسترجاع','success');
  renderChildren();
  updateBadges();
  // PHASE 16.5.1 — DIRTY PROPAGATION (additive only, see phase brief)
  if (window.ApplicationShell) { ApplicationShell.markDirty('children'); }
}

// ================================================================
// RENDER — عرض قائمة الأطفال
// ================================================================

/**
 * renderChildren — renders the children list view (table + mobile
 * cards).
 * Reads: ChildrenRepository (search — synchronous), #searchChildren
 * free-text filter.
 * Writes to: #childrenTableBody, #childrenEmpty, #childrenMobileList.
 *
 * NOTE: there is no separate searchChildren()/filterChildren() function
 * in the original app, and no filter dropdown or sort exists on the
 * Children page — free-text search is read directly from the DOM
 * (#searchChildren) and applied via the Repository's Query Model,
 * exactly matching the original inline implementation's observable
 * behavior. No sort option is passed, matching the original, which
 * never called `.sort()` (insertion order only).
 *
 * PHASE 16.14 — DomRecycler Migration (Children)
 * ----------------------------------------------------------------
 * Full read-only investigation (Phase 16.14 review, per the same
 * discipline established in the Phase 16.13 Fees handoff) found
 * renderChildren() uses TWO containers — #childrenTableBody (<tr>, no
 * className) and #childrenMobileList (<div class="m-card">) — the
 * exact same dual-container shape as renderCases() (PHASE 16.6) and
 * renderFees() (PHASE 16.13), NOT the single-container shape of
 * Sessions/Documents/Clients/Tasks. Both outer className values are
 * fixed literals (no variable className found on either wrapper), so
 * per the Phase 16.9 options.attrs() contract this migration
 * deliberately omits options.attrs entirely, exactly like Cases and
 * Fees.
 *
 * childRowInner()/childCardInner() below are the EXACT SAME markup
 * strings this function has always built per child record — moved out
 * of the inline .map() callbacks into named functions so the SAME
 * template logic is shared by DomRecycler (new path) and the untouched
 * legacy full-rebuild path (fallback). Only the outer wrapper tags
 * (<tr>...</tr> / <div class="m-card">...</div>) moved: DomNodeFactory
 * now owns creating those wrapper elements.
 *
 * No js/core/dom/* file is touched by this phase.
 */
function renderChildren(){
  // Defensive only — see childrenRepositoryReadyPromise's doc comment.
  // In normal page load order this is always true by the time any
  // onclick/oninput can fire, since open() resolves via microtasks that
  // drain before the browser dispatches its first user-facing event.
  if(!childrenRepository.isReady())return;

  var s=val('searchChildren').toLowerCase();

  syncChildrenMirror();
  var allRows=data.children;

  var queryModel={};
  if(s)queryModel.search=s;
  var rows=childrenRepository.search(queryModel).items;

  var tb=document.getElementById('childrenTableBody'),em=document.getElementById('childrenEmpty'),ml=document.getElementById('childrenMobileList');
  if(!rows.length){
    tb.innerHTML='';ml.innerHTML='';
    // PHASE 16.14 — SAFETY: the two lines above wipe both containers'
    // real children directly (not through DomRecycler), so any
    // key->node references DomKeyIndex is holding for them would now
    // point at detached/dead nodes. Reset both so the next non-empty
    // render starts clean instead of reusing dead references.
    // Additive only — window.DomKeyIndex may be undefined if
    // js/core/dom/ isn't loaded, hence the guard (same pattern as
    // cases.js/tasks.js/sessions.js/documents.js/fees.js).
    if(window.DomKeyIndex){DomKeyIndex.reset(tb);DomKeyIndex.reset(ml);}
    em.style.display='';return;
  }
  em.style.display='none';

  // ----------------------------------------------------------------
  // PHASE 16.14 — DomRecycler Migration (Children)
  // ----------------------------------------------------------------
  // childRowInner()/childCardInner() are the EXACT SAME markup this
  // function has always built for each child — narrowed from "whole
  // container" to "one row/card at a time", exactly like
  // desktopRowInner()/mobileCardInner() in cases.js and
  // feeRowInner()/feeCardInner() in fees.js.

  function childRowInner(c){
    var ri=resolveChildIndex(allRows,c);
    return '<td><strong>'+(c['الاسم']||'—')+'</strong></td><td style="color:var(--gold)">'+(c['رقم_القضية']||'—')+'</td><td>'+(c['السن']?c['السن']+' سنة':'—')+'</td><td>'+(c['المدرسة']||'—')+'</td><td>'+(c['الحضانة_الحالية']||'—')+'</td><td>'+(c['محل_الإقامة']||'—')+'</td><td>'+(c['النفقة_الحالية']?c['النفقة_الحالية']+' ج.م':'—')+'</td><td><button class="btn btn-ghost btn-sm btn-icon" onclick="editChild('+ri+')">&#9998;</button> <button class="btn btn-danger btn-sm btn-icon" onclick="deleteChild('+ri+')">&#128465;</button></td>';
  }

  function childCardInner(c){
    var ri=resolveChildIndex(allRows,c);
    return '<div class="m-card-header"><div class="m-card-title">&#128118; '+(c['الاسم']||'—')+'</div><div class="m-card-num">قضية: '+(c['رقم_القضية']||'—')+'</div></div><div class="m-card-meta">'+(c['السن']?'<span>&#127874; '+c['السن']+' سنة</span>':'')+(c['الحضانة_الحالية']?'<span>&#127968; '+c['الحضانة_الحالية']+'</span>':'')+(c['المدرسة']?'<span>&#127979; '+c['المدرسة']+'</span>':'')+(c['النفقة_الحالية']?'<span>&#128176; '+c['النفقة_الحالية']+' ج.م</span>':'')+'</div><div class="m-card-actions"><button class="btn btn-ghost btn-sm" onclick="editChild('+ri+')" style="flex:1;">&#9998; تعديل</button><button class="btn btn-danger btn-sm btn-icon" onclick="deleteChild('+ri+')">&#128465;</button></div>';
  }

  // رقم_الطفل only — stable identity, exactly like caseRowKey()/
  // feeRowKey()/sessionRowKey().
  function childRowKey(c){ return c[CHILDREN_ID_FIELD]; }

  var recycled=false;
  if(window.DomRecycler && typeof DomRecycler.reconcile==='function'){
    try{
      DomRecycler.reconcile(tb,rows,{key:childRowKey,tag:'tr',render:childRowInner});
      DomRecycler.reconcile(ml,rows,{key:childRowKey,tag:'div',className:'m-card',render:childCardInner});
      recycled=true;
    }catch(domRecyclerError){
      // PHASE 16.14 SAFETY (unchanged pattern): any recycler failure
      // falls straight back to the legacy full-rebuild path below, and
      // drops whatever partial key-index state the failed attempt may
      // have left behind so the NEXT render (recycled or not) never
      // inherits it.
      recycled=false;
      if(window.DomKeyIndex){DomKeyIndex.reset(tb);DomKeyIndex.reset(ml);}
    }
  }

  if(!recycled){
    // ORIGINAL PHASE ≤16.13 implementation — UNCHANGED (full rebuild),
    // kept exactly as the guaranteed-safe fallback path. Uses the SAME
    // childRowInner()/childCardInner() template functions defined
    // above, just with the outer wrapper tags restored around them.
    tb.innerHTML=rows.map(function(c){return '<tr>'+childRowInner(c)+'</tr>';}).join('');
    ml.innerHTML=rows.map(function(c){return '<div class="m-card">'+childCardInner(c)+'</div>';}).join('');
  }
}

// ================================================================
// Node/test export (browser: `module` is undefined, this is a no-op —
// openAddChildModal/saveChild/editChild/deleteChild/renderChildren
// remain plain global functions exactly as before).
// ================================================================

// ================================================================
// UNDO / REDO — تراجع / إعادة (PHASE 12 — SUB-PHASE 12.5 — General Undo
// Integration)
// ================================================================
// Reversal mapping, redo-stack suspension, and instruction application
// are all handled by the shared js/core/UndoReconciler.js (extracted
// from the Cases pilot, SUB-PHASE 12.4 → 12.5) — this module only
// supplies its own `childrenRepository`/`CHILDREN_ID_FIELD` and its own refresh sequence
// (`sync/saveLocal/render/updateBadges/toast`), matching every other
// entity module's `restoreChild()` refresh sequence exactly.
//
// `childrenRepository` disables no operations (`unsupportedOperations: []`,
// confirmed in js/repositories/ChildrenRepository.js), so every reversal
// mapping case (create/update/delete/restore) is legal for this
// entity — same as Cases.

/**
 * undoLastChildAction() — PHASE 12.5. Reverses the most recent
 * Children mutation (create/update/delete/restore). Mirrors
 * `undoLastCaseAction()` (js/modules/cases.js) exactly: same guard on
 * `canUndo()`, same use of the shared `UndoReconciler.applyUndoInstruction()`,
 * same refresh sequence, same graceful handling of empty history, a
 * Repository/persist failure, or any unexpected exception.
 * @returns {Promise<void>}
 */
async function undoLastChildAction() {
  await ensureChildrenRepositoryReady();

  try {
    if (!childrenRepository.canUndo()) {
      toast('لا يوجد إجراء للتراجع عنه', 'info');
      return;
    }

    var instruction = childrenRepository.undo();
    if (!instruction) {
      toast('لا يوجد إجراء للتراجع عنه', 'info');
      return;
    }

    if (!UndoReconciler) {
      toast('حدث خطأ أثناء التراجع', 'error');
      return;
    }

    var result = await UndoReconciler.applyUndoInstruction(childrenRepository, CHILDREN_ID_FIELD, instruction, 'undo');
    if (!result || !result.success) {
      toast('حدث خطأ أثناء التراجع', 'error');
      return;
    }

    syncChildrenMirror();
    saveLocal();
    renderChildren();
    updateBadges();
    // PHASE 16.5.1 — DIRTY PROPAGATION (additive only, see phase brief)
    if (window.ApplicationShell) { ApplicationShell.markDirty('children'); }
    toast('تم التراجع', 'success');
  } catch (e) {
    toast('حدث خطأ أثناء التراجع', 'error');
  }
}

/**
 * redoLastChildAction() — PHASE 12.5. Re-applies the most recently
 * undone Children mutation. Same refresh sequence, same shared-utility
 * usage, same error-handling guarantees as `undoLastChildAction()`
 * above — mirrors `redoLastCaseAction()` exactly.
 * @returns {Promise<void>}
 */
async function redoLastChildAction() {
  await ensureChildrenRepositoryReady();

  try {
    if (!childrenRepository.canRedo()) {
      toast('لا يوجد إجراء لإعادته', 'info');
      return;
    }

    var instruction = childrenRepository.redo();
    if (!instruction) {
      toast('لا يوجد إجراء لإعادته', 'info');
      return;
    }

    if (!UndoReconciler) {
      toast('حدث خطأ أثناء الإعادة', 'error');
      return;
    }

    var result = await UndoReconciler.applyUndoInstruction(childrenRepository, CHILDREN_ID_FIELD, instruction, 'redo');
    if (!result || !result.success) {
      toast('حدث خطأ أثناء الإعادة', 'error');
      return;
    }

    syncChildrenMirror();
    saveLocal();
    renderChildren();
    updateBadges();
    // PHASE 16.5.1 — DIRTY PROPAGATION (additive only, see phase brief)
    if (window.ApplicationShell) { ApplicationShell.markDirty('children'); }
    toast('تمت الإعادة', 'success');
  } catch (e) {
    toast('حدث خطأ أثناء الإعادة', 'error');
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    childrenUndoManager: childrenUndoManager,
    undoLastChildAction: undoLastChildAction,
    redoLastChildAction: redoLastChildAction,
    CHILDREN_ID_FIELD: CHILDREN_ID_FIELD,
    childrenRepository: childrenRepository,
    ensureChildrenRepositoryReady: ensureChildrenRepositoryReady,
    syncChildrenMirror: syncChildrenMirror,
    resolveChildIndex: resolveChildIndex,
    openAddChildModal: openAddChildModal,
    saveChild: saveChild,
    editChild: editChild,
    deleteChild: deleteChild,
    restoreChild: restoreChild,
    renderChildren: renderChildren
  };
}
