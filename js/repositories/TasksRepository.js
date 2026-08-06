/**
 * ================================================================
 * TasksRepository.js — Tasks Repository | نظام الحسام للمحاماة
 * ================================================================
 * V10 — Offline First Architecture
 * PHASE 5 — SUB-PHASE 5.6 — Tasks Repository
 *
 * Source of design (no assumption outside these — see Input Gap in
 * Tasks_Repository_Report.md):
 *   - Repository_Contract_Report_PHASE2_V10.md  (Contract §3, Catalog §4.6,
 *     Standards §19 — literal operation names, no synonyms)
 *   - Data_Schema_Specification_Report_PHASE4_V10.md (§4.6 Tasks: Primary
 *     Key, Required Fields, Search/Sort/Filter Fields, Delete/Sync Rules)
 *   - js/core/Repository.js (Repository Core — Phase 5.1, extended here,
 *     never modified)
 *   - js/core/CasesRepository.js, js/repositories/ClientsRepository.js,
 *     js/repositories/ChildrenRepository.js, js/repositories/SessionsRepository.js
 *     (Phases 5.2/5.3/5.4/5.5 — the pattern reused again here: temporary
 *     localStorage Adapter, additive insert/remove/filter/sort/validate
 *     wrappers, documented deviations resolved in favor of actual runtime
 *     behavior — none of these four files read for implementation details
 *     beyond this pattern; none modified, none imported from)
 *   - Direct inspection of js/modules/tasks.js (actual current runtime
 *     behavior of saveTask()/deleteTask()/toggleTask()/renderTasks() —
 *     ground truth for the "100% Behavior Compatible" requirement of this
 *     phase)
 *   - Direct inspection of index.html (FIELDS.tasks / MAP.tasks field
 *     definitions, `data.tasks` localStorage wiring, the #filterTaskPriority
 *     dropdown — no #filterTaskStatus exists)
 *   - Direct inspection of Code_v4.gs (SHEET_DEFS confirms a real 'المهام'
 *     sheet exists — see "SYNC" note below)
 *
 * WHAT THIS FILE IS
 *   The fifth concrete, entity-aware Repository. It subclasses the generic
 *   Repository base class (js/core/Repository.js) and adds ONLY Tasks
 *   business knowledge: the "رقم_المهمة" identifier field (hybrid id per
 *   Data_Schema_Specification §3.2 — generated via a uid()-equivalent when
 *   absent, exactly as saveTask() does today), the single field ACTUALLY
 *   required today by saveTask() (`العنوان` — no discrepancy with either
 *   planning report this time), and the actual free-text search behavior
 *   enforced today by renderTasks().
 *
 * WHAT THIS FILE IS NOT
 *   - It does NOT modify js/core/Repository.js, js/core/CasesRepository.js,
 *     js/repositories/ClientsRepository.js,
 *     js/repositories/ChildrenRepository.js, or
 *     js/repositories/SessionsRepository.js.
 *   - It does NOT modify js/modules/tasks.js, js/modules/cases.js,
 *     js/modules/clients.js, js/modules/children.js,
 *     js/modules/sessions.js, js/modules/documents.js, js/modules/fees.js,
 *     js/modules/library.js, js/modules/templates.js,
 *     js/modules/dashboard.js, js/modules/settings.js, index.html, any CSS,
 *     or Code_v4.gs.
 *   - It is NOT wired into index.html in this phase (no <script> tag
 *     references it) — pure additive file, inert until a later Migration
 *     Contract stage (Repository_Contract_Report.md §16).
 *   - It does NOT implement IndexedDB and does NOT call or reference
 *     DatabaseService or ApiService (no `syncToSheets()`/`API_URL`
 *     dependency — this Repository never syncs; see "SYNC" note below).
 *   - It does NOT implement a specialized `toggleStatus(id)` operation,
 *     despite `Repository_Contract_Report.md §4.6` explicitly proposing one
 *     to mirror `toggleTask()` — this phase's instructions list an exact,
 *     closed set of methods to implement ("نفذ فقط"), and `toggleStatus` is
 *     not among them. See "TOGGLE" note below.
 *
 * ----------------------------------------------------------------
 * INPUT GAP — see Tasks_Repository_Report.md for the full table.
 *   Summary (unchanged since Phase 5.5, re-confirmed for this phase):
 *   `PROJECT_MAP.md` remains absent from the archive entirely.
 *   `PROJECT_HISTORY.md` and `NEXT_PHASE.md` remain available only under
 *   their numbered-duplicate filenames in doc/ (`PROJECT_HISTORY (5).md`,
 *   `NEXT_PHASE (5).md`). `PROJECT_STATE.md` and `PROJECT_STATE (7).md`
 *   remain a single, identical, up-to-date pair — both read and treated as
 *   one authoritative document here.
 *
 * STORAGE ADAPTER — a temporary, Tasks-scoped adapter (same decision
 *   pattern as Cases/Clients/Children/Sessions — each Repository still gets
 *   its own adapter; NEXT_PHASE.md still leaves "shared adapter vs.
 *   per-Repository adapter" as an open decision). Reads/writes the SAME
 *   localStorage key ('tasks') that index.html's global `data.tasks` /
 *   `saveLocal()` already use today.
 *
 * IDENTIFIER — the same documented reconciliation pattern already applied
 *   to Clients/Children/Sessions, now confirmed again for Tasks, exactly as
 *   `NEXT_PHASE.md` flagged as the first thing to check for this phase:
 *   Data_Schema_Specification §4.6 abstracts the Primary Key as generic
 *   `id` (Hybrid). Direct inspection of the ACTUAL saveTask() in
 *   js/modules/tasks.js (line 144) shows the generated identifier is
 *   stored under the Arabic field name "رقم_المهمة", not a generic "id":
 *     obj['رقم_المهمة'] = obj['رقم_المهمة'] || uid();
 *   Because this phase's explicit priority is "Behavior Compatible 100%
 *   مع Tasks Module الحالي", TasksRepository below configures
 *   `idField: 'رقم_المهمة'` (so every inherited Contract-literal method
 *   reads/writes the correct field name) and overrides `_resolveId()` to
 *   fall back to a local uid()-equivalent generator ONLY when 'رقم_المهمة'
 *   is absent on create — replicating saveTask()'s `|| uid()` fallback
 *   exactly, the same override pattern used in ClientsRepository.js /
 *   ChildrenRepository.js / SessionsRepository.js (not imported from any of
 *   them — see "NAMING/independence" note below).
 *
 * VALIDATION — **no discrepancy this time**, unlike Sessions (Phase 5.5).
 *   `Data_Schema_Specification_Report.md §4.6` lists exactly one Required
 *   Field: `العنوان`. Direct inspection of the ACTUAL saveTask() (lines
 *   137-141) confirms exactly this:
 *     var t = document.getElementById('fTaskTitle').value.trim();
 *     if (!t) { toast('يرجى إدخال عنوان المهمة', 'error'); return; }
 *   (`t` maps via MAP.tasks to `العنوان`.) `_validate()` below enforces
 *   exactly this one field, non-empty after trim — no more, no less.
 *
 * SEARCH — Data_Schema_Specification_Report.md §4.6 states Search Fields
 *   are narrowly `العنوان` only. Direct inspection of the ACTUAL current
 *   renderTasks() (js/modules/tasks.js, lines 80-83) shows the claim
 *   UNDERSTATES the real behavior — same recurring pattern as
 *   Cases/Clients/Children/Sessions: it is not scoped to one field, it is
 *   the same full-record free-text join pattern:
 *     var rows = data.tasks.filter(function(t) {
 *       var tx = Object.values(t).join(' ').toLowerCase();
 *       return (!s || tx.includes(s)) && (!pr || t['الأولوية'] === pr);
 *     });
 *   bound to a real, live UI search box (`#searchTasks`). Because this
 *   phase's explicit priority is "Behavior Compatible 100% مع Tasks Module
 *   الحالي" — and because a live, wired UI control exercising this exact
 *   behavior today is stronger evidence than an abstract planning
 *   document's narrower field list — `_matchesSearch` is overridden here
 *   to replicate the actual free-text join across `TASKS_LEGACY_FIELDS`
 *   (excluding the new audit/metadata fields that did not exist in the
 *   record shape before this Repository layer, same reasoning as
 *   Cases/Clients/Children/Sessions). This divergence is called out
 *   explicitly in Tasks_Repository_Report.md §2.4.
 *
 * FILTER — renderTasks() also applies a second, independent condition in
 *   the SAME filter callback: `t['الأولوية'] === pr` (a priority dropdown,
 *   `#filterTaskPriority`) — the only filter dropdown that actually exists
 *   in index.html for Tasks today. Data_Schema_Specification §4.6 /
 *   Repository_Contract_Report §4.6 both additionally list `الحالة`
 *   (status) as a documented Filter Field, but direct inspection of
 *   index.html confirms **no `#filterTaskStatus` (or equivalent) element
 *   exists anywhere** — status filtering is not wired to any live UI
 *   control today (only `toggleTask()`'s checkbox click reads/writes
 *   `الحالة` directly, which is a mutation, not a filter). This is a
 *   documented gap between the plans and the live UI, NOT a code
 *   discrepancy requiring reconciliation: the additive `filter()` wrapper
 *   below is a generic, data-driven pass-through (no field hardcoded, same
 *   pattern as every prior Repository's `filter()`), so it already
 *   supports both `{الأولوية: ...}` (matching the real, live dropdown) and
 *   `{الحالة: ...}` (matching the documented-but-not-yet-UI-wired pattern)
 *   without any entity-specific override needed.
 *
 * SORT — Data_Schema_Specification §4.6 lists `الموعد_النهائي` as the Sort
 *   Field. Direct inspection of the ACTUAL current renderTasks() (lines
 *   80-83) shows NO `.sort()` call exists at all — tasks render in
 *   insertion order only, identical in kind to Children's Phase 5.4 finding
 *   (`renderChildren()` also applies no sort). Because this phase's
 *   explicit priority is "Behavior Compatible 100%", the additive `sort()`
 *   method below does not replace or emulate any existing behavior — it is
 *   a genuinely new capability, defaulting to `الموعد_النهائي` ascending
 *   (missing/unparseable due dates sort first) exactly as
 *   Data_Schema_Specification recommends, since no real behavior exists to
 *   contradict it (unlike Sessions' Phase 5.5 single-vs-composite
 *   reconciliation, where a real sort already existed to defer to).
 *
 * TOGGLE — `Repository_Contract_Report.md §4.6` explicitly proposes a
 *   specialized `toggleStatus(id)` operation mirroring the ACTUAL
 *   `toggleTask()` (a partial, single-field status flip, deliberately NOT
 *   a full `update()` — described there as a performance optimization to
 *   avoid sending an entire record over the network for a one-field
 *   change). This phase's instructions enumerate an exact, closed set of
 *   methods to implement ("نفذ فقط: getAll/get/insert/update/remove/
 *   exists/count/search/filter/sort/validate") — `toggleStatus` is not
 *   among them, and this phase does not add methods beyond that list.
 *   `toggleTask()`'s exact semantics (flip 'done'⇄'pending', no
 *   ApiService sync) therefore remain entirely inside
 *   `js/modules/tasks.js`, untouched and unreplicated here. A caller
 *   wanting the same effect through this Repository today would use the
 *   already-present `update(id, {'الحالة': newStatus})` — functionally
 *   equivalent but not the same partial-network-payload optimization the
 *   Contract report envisions. This is a deliberate, documented scope
 *   exclusion for this phase, not an oversight — see
 *   Tasks_Repository_Report.md §2.6.
 *
 * SYNC — Code_v4.gs's SHEET_DEFS confirms a real 'المهام' sheet DOES exist
 *   in the Apps Script backend, and js/modules/tasks.js's saveTask() calls
 *   `ApiService.syncRow('المهام', obj, idx)` (create/update ARE synced) —
 *   but `deleteTask()` does NOT call `ApiService.deleteData()`/
 *   `syncDeleteToSheets()` at all (a pre-existing, already-documented gap,
 *   matching `Data_Schema_Specification_Report.md §4.6`'s
 *   `"syncPolicy" حذف = local-only` and `PROJECT_STATE.md §11`'s
 *   "Documents/Tasks/Fees delete-sync gap"). This does not change anything
 *   about this Repository's scope: this phase's instructions forbid adding
 *   any Sync here regardless, consistent with
 *   CasesRepository/ClientsRepository/ChildrenRepository/SessionsRepository
 *   (none of which sync either) — it is a pure localStorage CRUD layer.
 *   Nothing here forecloses wiring a sync layer on top of this Repository
 *   later without changing its Contract.
 *
 * NAMING / independence — same reconciliation as CasesRepository.js,
 *   ClientsRepository.js, ChildrenRepository.js, and SessionsRepository.js
 *   (see their header "NAMING"/"IDENTIFIER" notes): every Contract-literal
 *   method (create/update/delete/get/getAll/find/exists/count/bulkInsert/
 *   bulkUpdate/bulkDelete/search/export/import/clear/transaction) is
 *   inherited UNCHANGED from Repository.prototype. insert()/remove()/
 *   filter()/sort()/validate() are additive convenience wrappers requested
 *   by this phase's instructions, not renamed or removed Contract methods.
 *   This file does not import or reference ClientsRepository.js/
 *   CasesRepository.js/ChildrenRepository.js/SessionsRepository.js in any
 *   way — its local uid()-equivalent generator and Storage Adapter are
 *   self-contained duplicates of the same pattern, not shared code, per
 *   this phase's "depends only on Repository.js" instruction.
 *
 * Load order: additive file, not yet wired into index.html. Depends only on
 * js/core/Repository.js having been loaded first (throws a clear error
 * otherwise — see guard below).
 * ================================================================
 */

(function (root) {
  'use strict';

  var RepositoryNS = (typeof module !== 'undefined' && module.exports)
    ? require('../core/Repository.js')
    : root;

  var Repository = RepositoryNS.Repository;
  var RepositoryErrorTypes = RepositoryNS.RepositoryErrorTypes;
  var createRepositoryError = RepositoryNS.createRepositoryError;

  if (typeof Repository !== 'function') {
    throw new Error(
      'TasksRepository requires js/core/Repository.js to be loaded first ' +
      '(Repository base class not found).'
    );
  }

  // PHASE 8 / SUB-PHASE 8.5.2 — Repository Wiring: TasksRepository's Storage
  // Adapter is now built from the real DatabaseService/LocalStorageAdapter
  // pair, exactly as CasesRepository/ClientsRepository were wired in PHASE
  // 8/8.5.1. Neither dependency is modified by this phase — both are
  // required here exactly as PHASE 8 already built and verified them.
  var DatabaseServiceNS = (typeof module !== 'undefined' && module.exports)
    ? require('../core/DatabaseService.js')
    : root;
  var IndexedDBAdapterNS = (typeof module !== 'undefined' && module.exports)
    ? require('../core/IndexedDBAdapter.js')
    : root;

  var DatabaseService = DatabaseServiceNS && DatabaseServiceNS.DatabaseService;
  var IndexedDBAdapter = IndexedDBAdapterNS && IndexedDBAdapterNS.IndexedDBAdapter;

  if (typeof DatabaseService !== 'function') {
    throw new Error(
      'TasksRepository requires js/core/DatabaseService.js to be loaded ' +
      'first (DatabaseService class not found).'
    );
  }
  if (typeof IndexedDBAdapter !== 'function') {
    throw new Error(
      'TasksRepository requires js/core/IndexedDBAdapter.js to be ' +
      'loaded first (IndexedDBAdapter class not found).'
    );
  }

  // ================================================================
  // 1. Tasks business knowledge (private to this file)
  // ================================================================

  /**
   * Identifier field — actual runtime field name (see file header
   * "IDENTIFIER" note). A hybrid id per Data_Schema_Specification §3.2:
   * generated via a uid()-equivalent, but stored under this Arabic key,
   * not a generic "id".
   */
  var TASKS_ID_FIELD = 'رقم_المهمة';

  /**
   * Field ACTUALLY required today, verified against the ACTUAL saveTask()
   * runtime check in js/modules/tasks.js — matches
   * Data_Schema_Specification §4.6 exactly (no discrepancy this time,
   * unlike Sessions in Phase 5.5).
   */
  var TASKS_REQUIRED_FIELDS = ['العنوان'];

  /** Filter Fields per Data_Schema_Specification §4.6 / Repository_Contract
   *  §4.6 — `الحالة` (status) and `الأولوية` (priority). Only `الأولوية` is
   *  actually wired to a live UI control today (`#filterTaskPriority`);
   *  `الحالة` has no equivalent live dropdown (see file header "FILTER"
   *  note). Exposed here for documentation only — filter() below is a
   *  generic, data-driven pass-through (no field hardcoded), same as
   *  ChildrenRepository.filter()/SessionsRepository.filter(), so both
   *  fields already work through it. */
  var TASKS_FILTER_FIELDS = ['الحالة', 'الأولوية'];

  /** Sort Fields per Data_Schema_Specification §4.6 — `الموعد_النهائي`. The
   *  ACTUAL current renderTasks() applies no sort at all (insertion order
   *  only, same finding as Children in Phase 5.4) — so this is a purely
   *  additive new capability, not a reconciliation against existing
   *  behavior (see file header "SORT" note). */
  var TASKS_SORT_FIELDS = ['الموعد_النهائي'];

  /**
   * The full set of legacy Arabic/business fields for Tasks, used to
   * replicate the exact legacy free-text search behavior (see
   * _matchesSearch override — file header "SEARCH" note) without
   * accidentally matching against the new English audit/metadata fields
   * (createdAt, updatedAt, deletedAt, version, syncVersion, checksum) that
   * did not exist in the record shape before this Repository layer —
   * including them in the join would change search results and break
   * "100% Behavior Compatible".
   *
   * Derived from TASKS_MAP (js/modules/tasks.js) — العنوان, رقم_القضية,
   * الأولوية, الموعد_النهائي, الحالة, الملاحظات — plus:
   *   - 'رقم_المهمة'    : the identifier itself (set by saveTask() and
   *                       already part of every real record — included in
   *                       Object.values(t) today, so included here too).
   *   - 'تاريخ_الإنشاء' : creation timestamp stamped by saveTask().
   * No other dynamically-added field exists for Tasks (unlike Clients'
   * 'portal_token') — confirmed by full read of js/modules/tasks.js (208
   * lines total, no other field ever written).
   */
  var TASKS_LEGACY_FIELDS = [
    'رقم_المهمة', 'العنوان', 'رقم_القضية', 'الأولوية', 'الموعد_النهائي',
    'الحالة', 'الملاحظات', 'ظاهر_للموكل', 'تاريخ_الإنشاء'
  ];

  // ================================================================
  // 2. Storage Adapter — DatabaseService-backed (PHASE 8 / SUB-PHASE 8.5.2)
  // ================================================================
  // See file header "WIRING UPDATE" note (added by this phase). Reads/
  // writes the SAME 'tasks' key index.html already uses today, in the
  // SAME flat JSON-array shape — LocalStorageAdapter's own default empty
  // keyPrefix guarantees this. Public factory NAME and SIGNATURE are
  // unchanged from the prior phase; only what it builds internally changed
  // (a real DatabaseService + LocalStorageAdapter pair instead of the old
  // hand-rolled ad-hoc {read,write} object).

  /**
   * Builds the Storage Adapter injected into TasksRepository's underlying
   * Repository base class: a real DatabaseService instance wrapping a real
   * LocalStorageAdapter instance. This satisfies Repository.js's duck-typed
   * contract ({read(entityKey), write(entityKey, records)}) because
   * DatabaseService exposes both methods, each delegating unchanged to the
   * LocalStorageAdapter beneath it — which in turn reads/writes the
   * browser's real localStorage (or an injected localStorage-shaped
   * stand-in) under the exact same key ('tasks') the current global
   * `data.tasks`/`saveLocal()` already use.
   * @param {Storage} [storageImpl] - optional localStorage-shaped override
   *   (e.g. a test harness's in-memory stand-in). When omitted,
   *   LocalStorageAdapter itself resolves the real global localStorage
   *   lazily, on first read()/write() call (not here, not at construction
   *   time), matching LocalStorageAdapter's own documented lazy-engine-
   *   resolution design.
   * @returns {DatabaseService}
   */
  function createTasksLocalStorageAdapter(storageImpl) {
    var adapter = new IndexedDBAdapter(storageImpl ? { engineOptions: { indexedDBImpl: storageImpl } } : {});
    return new DatabaseService(adapter);
  }

  // ================================================================
  // 3. Local uid()-equivalent generator (private to this file)
  // ================================================================
  // Repository.js deliberately does NOT define uid() itself (it lives in
  // js/ui-utils.js and must be injected — see Repository.js file header,
  // config.idGenerator doc). This file does not import js/ui-utils.js (no
  // dependency beyond js/core/Repository.js is permitted this phase), so a
  // byte-for-byte algorithmic replica of the actual uid() is defined here,
  // private to this module — a self-contained duplicate of the same helper
  // already defined independently in ClientsRepository.js/
  // ChildrenRepository.js/SessionsRepository.js, per this phase's "depends
  // only on Repository.js" instruction (no cross-Repository imports).
  //
  // Verified identical algorithm to js/ui-utils.js:
  //   function uid(){return Date.now().toString(36)+Math.random().toString(36).slice(2,6);}

  function generateTaskId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  }

  // ================================================================
  // 4. TasksRepository — subclass
  // ================================================================

  /**
   * @class TasksRepository
   * @param {{storageAdapter?: object, idGenerator?: function}} [config] -
   *   Optional overrides (e.g. for tests). Defaults to the
   *   localStorage-backed placeholder adapter and the local uid()-
   *   equivalent generator above.
   */
  function TasksRepository(config) {
    config = config || {};
    var storageAdapter = config.storageAdapter || createTasksLocalStorageAdapter();
    var idGenerator = typeof config.idGenerator === 'function' ? config.idGenerator : generateTaskId;

    Repository.call(this, {
      entityKey: 'tasks',
      storageAdapter: storageAdapter,
      idField: TASKS_ID_FIELD,
      idGenerator: idGenerator,
      // No officially documented narrow Search Fields list is accurate for
      // Tasks (file header "SEARCH" note) — searchFields is set to the
      // full legacy field list so that even a caller bypassing the
      // _matchesSearch override (e.g. via a future field-scoped query
      // option) still sees a sensible default rather than an empty scope.
      searchFields: TASKS_LEGACY_FIELDS,
      softDelete: true, // Data_Schema_Specification §4.6 Delete Rules: Soft Delete.
      unsupportedOperations: []
    });
  }

  TasksRepository.prototype = Object.create(Repository.prototype);
  TasksRepository.prototype.constructor = TasksRepository;

  // ----------------------------------------------------------------
  // 4.1 Identifier resolution — extension point (see file header
  //     "IDENTIFIER" note)
  // ----------------------------------------------------------------

  /**
   * _resolveId(record) — overrides the base class default. The base
   * class's default (when idField is set) is `return record[idField];`
   * with no generation fallback, correct for Cases (a true user-entered
   * natural key, always present by validation time). Tasks' identifier is
   * a HYBRID id (Data_Schema §3.2): generated only when absent, exactly
   * replicating saveTask()'s `obj['رقم_المهمة'] = obj['رقم_المهمة'] ||
   * uid();`. This override is the only behavioral difference from the base
   * class's natural-key resolution path (same pattern as
   * ClientsRepository._resolveId / ChildrenRepository._resolveId /
   * SessionsRepository._resolveId, duplicated independently here).
   * @param {Object} record
   * @returns {string}
   * @protected
   * @override
   */
  TasksRepository.prototype._resolveId = function (record) {
    var existing = record ? record[TASKS_ID_FIELD] : null;
    return (existing != null && existing !== '') ? existing : this._idGenerator();
  };

  // ----------------------------------------------------------------
  // 4.2 Validation — Repository Contract §9 (extension point)
  // ----------------------------------------------------------------

  /**
   * _validate(operation, record) — overrides the base class no-op hook.
   * Enforces exactly the rule verified in ACTUAL saveTask() today: one
   * required, non-empty (after trim) field — العنوان. No discrepancy with
   * either planning report for this entity (unlike Sessions' Phase 5.5
   * finding). Applies to create/update (delete does not validate field
   * content — Contract §9 default).
   * @protected
   * @override
   */
  TasksRepository.prototype._validate = function (operation, record) {
    if (operation !== 'create' && operation !== 'update') {
      return { valid: true, errors: [] };
    }
    var errors = [];
    TASKS_REQUIRED_FIELDS.forEach(function (field) {
      var value = record ? record[field] : undefined;
      var isEmpty = value == null || (typeof value === 'string' && value.trim() === '');
      if (isEmpty) {
        errors.push({ field: field, message: 'الحقل "' + field + '" إلزامي ولا يمكن أن يكون فارغاً.' });
      }
    });
    return { valid: errors.length === 0, errors: errors };
  };

  /**
   * validate(record) — PUBLIC convenience wrapper requested by this phase's
   * instructions. Thin pass-through to the protected _validate() hook,
   * defaulting to the 'create' operation shape. Does not replace or rename
   * any Contract operation.
   * @param {Object} record
   * @param {'create'|'update'} [operation='create']
   * @returns {{valid:boolean, errors:Array<{field:string,message:string}>}}
   */
  TasksRepository.prototype.validate = function (record, operation) {
    return this._validate(operation || 'create', record);
  };

  // ----------------------------------------------------------------
  // 4.3 Search — Repository Contract §7 (extension point)
  // ----------------------------------------------------------------

  /**
   * _matchesSearch(record, term) — overrides the base class's
   * searchFields-scoped substring scan to exactly replicate the ACTUAL
   * current renderTasks() behavior: `Object.values(t).join(' ')` across
   * every legacy business field (excluding the new audit/metadata fields
   * that did not exist in the record before this Repository layer — see
   * TASKS_LEGACY_FIELDS comment above). Required for "100% Behavior
   * Compatible" free-text search once this Repository is eventually wired
   * to replace renderTasks()'s inline filter — see file header "SEARCH"
   * note for why this deliberately overrides the narrower single-field
   * list both planning reports claim for Tasks.
   * @protected
   * @override
   */
  TasksRepository.prototype._matchesSearch = function (record, term) {
    if (!term) return true;
    var needle = String(term).trim().toLowerCase();
    if (!needle) return true;
    var joined = TASKS_LEGACY_FIELDS
      .map(function (field) { return record[field] != null ? record[field] : ''; })
      .join(' ')
      .toLowerCase();
    return joined.indexOf(needle) !== -1;
  };

  /**
   * filter(filterObj) — PUBLIC convenience wrapper requested by this
   * phase's instructions. Thin pass-through to search({filter: filterObj}),
   * returning just the matched records (not the full QueryResult envelope).
   * Generic and data-driven (no field hardcoded), so it supports both the
   * real `{الأولوية: ...}` priority-dropdown pattern (renderTasks()) and the
   * documented-but-not-yet-UI-wired `{الحالة: ...}` status pattern (see file
   * header "FILTER" note) — same pattern as
   * ChildrenRepository.filter()/SessionsRepository.filter(). Does not
   * replace or rename search() — additive only.
   * @param {Object} filterObj - Query Model filter object (Contract §7).
   * @returns {Object[]}
   */
  TasksRepository.prototype.filter = function (filterObj) {
    return this.search({ filter: filterObj }).items;
  };

  // ----------------------------------------------------------------
  // 4.4 Sort — Repository Contract §7 (extension point)
  // ----------------------------------------------------------------

  /**
   * sort(records, sortSpec) — PUBLIC convenience wrapper requested by this
   * phase's instructions. Applies the base class's generic comparator
   * engine (_compareRecords) to an explicit array of records, defaulting
   * sortSpec to TASKS_SORT_FIELDS (`الموعد_النهائي` ascending — a purely
   * additive capability, since the ACTUAL renderTasks() applies no sort at
   * all; see file header "SORT" note) when omitted. Does not mutate the
   * input array or replace search()'s own sort option — additive only.
   * @param {Object[]} [records] - defaults to this.getAll() when omitted.
   * @param {Array<{field:string, direction?:'asc'|'desc'}>|{field:string, direction?:'asc'|'desc'}} [sortSpec]
   * @returns {Object[]}
   */
  TasksRepository.prototype.sort = function (records, sortSpec) {
    var list = Array.isArray(records) ? records.slice() : this.getAll();
    var spec = sortSpec || TASKS_SORT_FIELDS.map(function (f) { return { field: f, direction: 'asc' }; });
    var self = this;
    return list.sort(function (a, b) { return self._compareRecords(a, b, Array.isArray(spec) ? spec : [spec]); });
  };

  // ----------------------------------------------------------------
  // 4.5 Contract-literal convenience aliases (Repository §3, §19)
  // ----------------------------------------------------------------
  // insert()/remove() are ADDITIVE public aliases, named exactly as this
  // phase's instructions require, wired directly to the unchanged
  // Contract-literal create()/delete() inherited from Repository.prototype.
  // create()/update()/delete() themselves remain available, unrenamed, on
  // every instance — Contract §19 compliance is preserved.

  /**
   * insert(entity) -> WriteResult
   * Alias for the inherited, Contract-literal create(entity).
   * @param {Object} entity
   * @returns {Promise<{success:boolean, record:?Object, error:?Object}>}
   */
  TasksRepository.prototype.insert = function (entity) {
    return this.create(entity);
  };

  /**
   * remove(id) -> WriteResult
   * Alias for the inherited, Contract-literal delete(id).
   * @param {string} id
   * @returns {Promise<{success:boolean, record:?Object, error:?Object}>}
   */
  TasksRepository.prototype.remove = function (id) {
    return this.delete(id);
  };

  // ================================================================
  // 5. Exports
  // ================================================================

  var api = {
    TasksRepository: TasksRepository,
    createTasksLocalStorageAdapter: createTasksLocalStorageAdapter
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  if (root) {
    root.TasksRepository = TasksRepository;
    root.createTasksLocalStorageAdapter = createTasksLocalStorageAdapter;
  }

})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
