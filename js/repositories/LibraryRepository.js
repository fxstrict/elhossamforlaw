/**
 * ================================================================
 * LibraryRepository.js — Library Repository | نظام الحسام للمحاماة
 * ================================================================
 * V10 — Offline First Architecture
 * PHASE 5 — SUB-PHASE 5.9.2 — Library Repository
 *
 * Source of design (no assumption outside these — see Input Gap in
 * Library_Repository_Report.md):
 *   - Repository_Contract_Report_PHASE2_V10.md  (Contract §3, Standards §19 —
 *     literal operation names, no synonyms)
 *   - Data_Schema_Specification_Report_PHASE4_V10.md (§4.8 Library: Primary
 *     Key, Required Fields, Search/Sort/Filter Fields, Delete/Sync Rules)
 *   - js/core/Repository.js (Repository Core — Phase 5.1, extended here,
 *     never modified)
 *   - js/repositories/CasesRepository.js, ClientsRepository.js,
 *     ChildrenRepository.js, SessionsRepository.js, TasksRepository.js,
 *     FeesRepository.js, DocumentsRepository.js (Phases 5.2–5.8 — the
 *     pattern reused again here: temporary localStorage Adapter, additive
 *     insert/remove/filter/sort/validate wrappers, documented deviations
 *     resolved in favor of actual runtime behavior — none of these seven
 *     files read for implementation details beyond this reused pattern;
 *     none modified, none imported from)
 *   - Direct inspection of js/modules/library.js (actual current runtime
 *     behavior of saveLibBook()/deleteLibBook()/editLibBook()/
 *     renderLibrary() — ground truth for the "100% Behavior Compatible"
 *     requirement of this phase)
 *   - Direct inspection of index.html (FIELDS.library / MAP.library field
 *     definitions, `data.library` localStorage wiring, `#searchLibrary`,
 *     `#filterLibCat`, `#filterLibType`)
 *
 * ----------------------------------------------------------------
 * INPUT GAP
 *   `docs/Library_Repository_Audit_Report.md` (item 1 of the required
 *   read-first list) is NOT present anywhere in the delivered archive —
 *   no file of that name, and no other file documenting a dedicated
 *   Library Repository audit, exists. Per this phase's own "DO NOT GUESS"
 *   instruction, this is recorded here rather than silently assumed away.
 *   Nearest verified sources used instead, exactly as `NEXT_PHASE.md`'s own
 *   Library section (written at the end of SUB-PHASE 5.8) already
 *   anticipated and flagged for direct re-verification:
 *     - `Data_Schema_Specification_Report_PHASE4_V10.md` §4.8 (Library) —
 *       present and used.
 *     - Direct inspection of `js/modules/library.js` — present and used;
 *       this is the actual ground truth for every runtime-behavior claim
 *       below, since no Library-specific audit report exists to cross-check
 *       against.
 *   Full detail in `Library_Repository_Report.md`, Input Gap section.
 *
 * WHAT THIS FILE IS
 *   The eighth concrete, entity-aware Repository. It subclasses the generic
 *   Repository base class (js/core/Repository.js) and adds ONLY Library
 *   business knowledge: the "id" identifier field (a genuine generic hybrid
 *   id — the FIRST entity in this migration order to actually use `id`
 *   rather than an Arabic-named field, confirmed by direct inspection of
 *   saveLibBook() — see "IDENTIFIER" note below), the single field ACTUALLY
 *   required today by saveLibBook() (`العنوان`, trimmed), the actual
 *   free-text search behavior enforced today by renderLibrary(), and the
 *   two real, live filter controls already wired to `#filterLibCat`/
 *   `#filterLibType`.
 *
 * WHAT THIS FILE IS NOT
 *   - It does NOT modify js/core/Repository.js,
 *     js/repositories/CasesRepository.js, js/repositories/ClientsRepository.js,
 *     js/repositories/ChildrenRepository.js,
 *     js/repositories/SessionsRepository.js, js/repositories/TasksRepository.js,
 *     js/repositories/FeesRepository.js, or
 *     js/repositories/DocumentsRepository.js.
 *   - It does NOT modify js/modules/library.js, js/modules/cases.js,
 *     js/modules/clients.js, js/modules/children.js,
 *     js/modules/sessions.js, js/modules/tasks.js, js/modules/fees.js,
 *     js/modules/documents.js, js/modules/templates.js,
 *     js/modules/dashboard.js, js/modules/settings.js, index.html, any CSS,
 *     or Code_v4.gs.
 *   - It is NOT wired into index.html in this phase (no <script> tag
 *     references it) — pure additive file, inert until a later Migration
 *     Contract stage (Repository_Contract_Report.md §16).
 *   - It does NOT implement IndexedDB and does NOT call or reference
 *     DatabaseService or ApiService (no `syncToSheets()`/`API_URL`
 *     dependency — Library never synced in the original, and this
 *     Repository never syncs either; see "SYNC" note below).
 *   - It does NOT transfer any Business Logic (grid/card HTML rendering,
 *     Drive-link bar building, category-tab generation, modal wiring) out
 *     of js/modules/library.js — that stays exactly where it is, untouched.
 *   - It does NOT add any Cache or Sync layer of any kind.
 *
 * IDENTIFIER — Data_Schema_Specification_Report.md §4.8 documents the
 *   Primary Key abstractly as `id` (Hybrid) — unlike every entity from
 *   Clients (5.3) through Documents (5.8), which all turned out to use a
 *   dedicated Arabic field name once inspected directly, `NEXT_PHASE.md`
 *   flagged Library as possibly the FIRST entity to actually match this
 *   abstract description literally. Direct inspection of the ACTUAL
 *   saveLibBook() in js/modules/library.js confirms this:
 *     obj['id']              = obj['id']              || uid();
 *     obj['تاريخ_الإنشاء']   = obj['تاريخ_الإنشاء']   || new Date().toISOString();
 *   — the generated identifier really is stored under the generic key
 *   "id", not an Arabic business-field name. This is independently
 *   consistent with Library having no corresponding Code_v4.gs sheet at all
 *   (see "SYNC" note) — there is no sheet header naming convention to
 *   reconcile against, unlike every synced entity so far.
 *   `idField: 'id'` is configured accordingly, with a `_resolveId()`
 *   override generating a local uid()-equivalent value only when `id` is
 *   absent on create() — replicating saveLibBook()'s `|| uid()` fallback
 *   exactly, same override pattern as every prior Repository (not imported
 *   from any of them — see "NAMING/independence" note below).
 *
 * VALIDATION — Data_Schema_Specification_Report.md §4.8 lists a single
 *   Required Field: `العنوان`. Direct inspection of the ACTUAL saveLibBook()
 *   (js/modules/library.js) confirms exactly this:
 *     var t = document.getElementById('fLibTitle').value.trim();
 *     if (!t) { toast('يرجى إدخال العنوان', 'error'); return; }
 *   — a single field, checked WITH `.trim()` before the emptiness check
 *   (rejects whitespace-only titles). `_validate()` below applies the same
 *   "non-empty after trim" rule, matching the live form check exactly. No
 *   other field (`الرابط` included) is validated in any way by the live
 *   code — Data_Schema_Specification §4.8's "لا يوجد قيد خاص" (no special
 *   constraint) for every other field is confirmed by direct inspection,
 *   not merely assumed; in particular `الرابط` has no URL-format check,
 *   same pattern already established for Documents' `رابط_Drive` (5.8).
 *
 * SEARCH — Data_Schema_Specification_Report.md §4.8 states the Search
 *   Fields are `العنوان` and `الوصف`. Direct inspection of the ACTUAL
 *   current renderLibrary() (js/modules/library.js) shows the claim
 *   UNDERSTATES the real behavior — same recurring pattern as every prior
 *   entity from Cases (5.2) through Documents (5.8), now the eighth
 *   consecutive occurrence: it is not scoped to two fields, it is the same
 *   full-record free-text join pattern:
 *     var rows = data.library.filter(function(b) {
 *       var t = Object.values(b).join(' ').toLowerCase();
 *       return (!s || t.includes(s)) && (!cF || b['القسم'] === cF) && (!tF || b['النوع'] === tF);
 *     });
 *   bound to a real, live UI search box (`#searchLibrary`). This phase's
 *   own OVERRIDES section is explicit and literal about `_matchesSearch()`:
 *   "Current behavior must remain identical. Search across ALL values
 *   using Object.values(record). Exactly like library.js." Unlike every
 *   prior Repository (Cases through Documents), which each scoped their
 *   `_matchesSearch` override to a curated legacy-field list explicitly
 *   EXCLUDING the new audit/metadata fields this Repository layer
 *   introduces (createdAt/updatedAt/deletedAt/version/syncVersion/
 *   checksum), `_matchesSearch` below deliberately does NOT exclude them —
 *   it calls `Object.values(record)` on the record AS GIVEN, literally
 *   matching `renderLibrary()`'s own unscoped `Object.values(b)` call, per
 *   this phase's explicit instruction, which takes priority over the
 *   audit-field-exclusion convention established in Phases 5.2–5.8. A
 *   practical, documented consequence: once a record has passed through
 *   this Repository's create()/update() and been stamped with metadata
 *   (§3.9/§3.10), searching for a substring of its own `checksum` (or any
 *   other audit field value) WILL match it — a new behavior relative to
 *   the pre-Repository `data.library` array (which never had these fields
 *   at all), but not a divergence from this phase's literal instruction.
 *
 * FILTER — Data_Schema_Specification §4.8 documents Filter Fields for
 *   Library as `النوع` and `القسم`. UNLIKE Fees (Phase 5.7, zero live filter
 *   controls) and MORE like Documents/Tasks (one live control each), direct
 *   inspection of index.html and renderLibrary() confirms Library has TWO
 *   real, live filter controls today: `#filterLibType` (a fixed-option
 *   `<select>`, `onchange="renderLibrary()"`, exact-equality against
 *   `النوع`) and `#filterLibCat` — the latter notably NOT a fixed-option
 *   dropdown like every filter control seen in any prior entity, but one
 *   whose `<option>` list is rebuilt on every renderLibrary() call directly
 *   from the current distinct `القسم` values present in `data.library`
 *   itself (`[...new Set(data.library.map(...).filter(Boolean))]`). This
 *   dynamic-options mechanism is a rendering-time UI concern only — it does
 *   not change the underlying filter semantics (`!cF || b['القسم'] === cF`
 *   is still a plain exact-equality match once a value is selected), so no
 *   Library-specific override of the generic engine is needed for `filter()`
 *   itself; both fields already work through the base class's generic
 *   range/equality engine, same as every prior Repository's additive
 *   `filter()` wrapper.
 *
 * SORT — Data_Schema_Specification §4.8 lists `العنوان` as the Sort Field.
 *   Direct inspection of the ACTUAL current renderLibrary() shows NO
 *   `.sort()` call exists at all — library rows render in `data.library`
 *   insertion order only, identical in kind to Children's (5.4), Tasks'
 *   (5.6), Fees' (5.7), and Documents' (5.8) findings. Because this phase's
 *   explicit priority is behavior compatibility, the additive `sort()`
 *   method below does not replace or emulate any existing behavior — it is
 *   a genuinely new capability, defaulting to `العنوان` ascending exactly as
 *   Data_Schema_Specification recommends, since no real behavior exists to
 *   contradict it.
 *
 * SYNC — Data_Schema_Specification_Report.md §4.8 documents Library's Sync
 *   Priority as "معطَّل بالكامل تصميماً (Local-only-by-design)" — fully
 *   disabled BY DESIGN, not a gap. This is independently confirmed by
 *   `js/modules/library.js`'s own file-header comment ("GAS Sheet name:
 *   none — Library has NO backend sync... Library data is local-only
 *   (localStorage), by original design — confirmed by full-file scan") and
 *   by direct inspection of saveLibBook()/deleteLibBook(), neither of which
 *   calls syncToSheets()/ApiService.syncRow()/ApiService.deleteData() at
 *   all. This is a materially different situation from the
 *   Documents/Tasks/Fees delete-sync GAPS (§11 of PROJECT_STATE.md) — those
 *   entities DO have a real corresponding Sheet that create/update syncs to
 *   but delete does not; Library has no corresponding Sheet at all, at any
 *   point in its lifecycle. This Repository adds no Sync layer of any kind,
 *   consistent with every prior Repository (none of which sync either) —
 *   it is a pure localStorage CRUD layer.
 *
 * NAMING / independence — same reconciliation as every prior concrete
 *   Repository (see their own "NAMING"/"IDENTIFIER" notes): every
 *   Contract-literal method (create/update/delete/get/getAll/find/exists/
 *   count/bulkInsert/bulkUpdate/bulkDelete/search/export/import/clear/
 *   transaction) is inherited UNCHANGED from Repository.prototype.
 *   insert()/remove()/filter()/sort()/validate() are additive convenience
 *   wrappers, not renamed or removed Contract methods. This file does not
 *   import or reference CasesRepository.js/ClientsRepository.js/
 *   ChildrenRepository.js/SessionsRepository.js/TasksRepository.js/
 *   FeesRepository.js/DocumentsRepository.js in any way — its local
 *   uid()-equivalent generator and Storage Adapter are self-contained
 *   duplicates of the same pattern, not shared code.
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
      'LibraryRepository requires js/core/Repository.js to be loaded first ' +
      '(Repository base class not found).'
    );
  }

  // PHASE 8 / SUB-PHASE 8.5.2 — Repository Wiring: LibraryRepository's Storage
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
      'LibraryRepository requires js/core/DatabaseService.js to be loaded ' +
      'first (DatabaseService class not found).'
    );
  }
  if (typeof IndexedDBAdapter !== 'function') {
    throw new Error(
      'LibraryRepository requires js/core/IndexedDBAdapter.js to be ' +
      'loaded first (IndexedDBAdapter class not found).'
    );
  }

  // ================================================================
  // 1. Library business knowledge (private to this file)
  // ================================================================

  /**
   * Identifier field — actual runtime field name (see file header
   * "IDENTIFIER" note). A hybrid id per Data_Schema_Specification §3.2:
   * generated via a uid()-equivalent, stored under the generic key "id" —
   * the first entity in this migration order to genuinely match the
   * abstract "id (Hybrid)" Primary Key description literally.
   */
  var LIBRARY_ID_FIELD = 'id';

  /**
   * Field ACTUALLY required today, verified against the ACTUAL
   * saveLibBook() runtime check in js/modules/library.js — matches
   * Data_Schema_Specification §4.8 exactly (single required field).
   */
  var LIBRARY_REQUIRED_FIELDS = ['العنوان'];

  /** Filter Fields per Data_Schema_Specification §4.8 / Repository_Contract
   *  §4.8 — `النوع` and `القسم`. Both ARE actually wired to live UI controls
   *  today (`#filterLibType` fixed-option; `#filterLibCat` dynamically
   *  populated from live data — see file header "FILTER" note). Exposed
   *  here for documentation only — filter() below is a generic,
   *  data-driven pass-through (no field hardcoded), same as every prior
   *  Repository's filter() wrapper, so both fields (and every other real
   *  field, e.g. `الرابط`) already work through it without any
   *  entity-specific override. */
  var LIBRARY_FILTER_FIELDS = ['النوع', 'القسم'];

  /** Sort Fields per Data_Schema_Specification §4.8 — `العنوان`. The ACTUAL
   *  current renderLibrary() applies no sort at all (insertion order only,
   *  same finding as Children/Tasks/Fees/Documents) — so this is a purely
   *  additive new capability, not a reconciliation against existing
   *  behavior (see file header "SORT" note). */
  var LIBRARY_SORT_FIELDS = ['العنوان'];

  /**
   * The full set of legacy Arabic/business fields for Library, kept here
   * for DOCUMENTATION and default `searchFields` config purposes only (see
   * constructor below). Derived directly from LIBRARY_MAP in
   * js/modules/library.js, plus the generic "id" identifier field and the
   * "تاريخ_الإنشاء" timestamp field saveLibBook() also writes. NOT consulted
   * by `_matchesSearch()` itself — per this phase's explicit instruction,
   * that method scans `Object.values(record)` literally, over every field
   * the record actually has (including audit/metadata fields), matching
   * `renderLibrary()` exactly. See file header "SEARCH" note.
   */
  var LIBRARY_LEGACY_FIELDS = [
    'id', 'العنوان', 'النوع', 'القسم', 'الرابط', 'الوصف', 'تاريخ_الإنشاء'
  ];

  // ================================================================
  // 2. Storage Adapter — DatabaseService-backed (PHASE 8 / SUB-PHASE 8.5.2)
  // ================================================================
  // See file header "WIRING UPDATE" note (added by this phase). Reads/
  // writes the SAME 'library' key index.html already uses today, in the
  // SAME flat JSON-array shape — LocalStorageAdapter's own default empty
  // keyPrefix guarantees this. Public factory NAME and SIGNATURE are
  // unchanged from the prior phase; only what it builds internally changed
  // (a real DatabaseService + LocalStorageAdapter pair instead of the old
  // hand-rolled ad-hoc {read,write} object).

  /**
   * Builds the Storage Adapter injected into LibraryRepository's underlying
   * Repository base class: a real DatabaseService instance wrapping a real
   * LocalStorageAdapter instance. This satisfies Repository.js's duck-typed
   * contract ({read(entityKey), write(entityKey, records)}) because
   * DatabaseService exposes both methods, each delegating unchanged to the
   * LocalStorageAdapter beneath it — which in turn reads/writes the
   * browser's real localStorage (or an injected localStorage-shaped
   * stand-in) under the exact same key ('library') the current global
   * `data.library`/`saveLocal()` already use.
   * @param {Storage} [storageImpl] - optional localStorage-shaped override
   *   (e.g. a test harness's in-memory stand-in). When omitted,
   *   LocalStorageAdapter itself resolves the real global localStorage
   *   lazily, on first read()/write() call (not here, not at construction
   *   time), matching LocalStorageAdapter's own documented lazy-engine-
   *   resolution design.
   * @returns {DatabaseService}
   */
  function createLibraryLocalStorageAdapter(storageImpl) {
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
  // already defined independently in every prior concrete Repository, per
  // this phase's "depends only on Repository.js" instruction (no
  // cross-Repository imports).
  //
  // Verified identical algorithm to js/ui-utils.js:
  //   function uid(){return Date.now().toString(36)+Math.random().toString(36).slice(2,6);}

  function generateLibraryId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  }

  // ================================================================
  // 4. LibraryRepository — subclass
  // ================================================================

  /**
   * @class LibraryRepository
   * @param {{storageAdapter?: object, idGenerator?: function}} [config] -
   *   Optional overrides (e.g. for tests). Defaults to the
   *   localStorage-backed placeholder adapter and the local uid()-
   *   equivalent generator above.
   */
  function LibraryRepository(config) {
    config = config || {};
    var storageAdapter = config.storageAdapter || createLibraryLocalStorageAdapter();
    var idGenerator = typeof config.idGenerator === 'function' ? config.idGenerator : generateLibraryId;

    Repository.call(this, {
      entityKey: 'library',
      storageAdapter: storageAdapter,
      idField: LIBRARY_ID_FIELD,
      idGenerator: idGenerator,
      // No officially documented narrow Search Fields list is accurate for
      // Library (file header "SEARCH" note) — searchFields is set to the
      // full legacy field list so that even a caller bypassing the
      // _matchesSearch override (e.g. via a future field-scoped query
      // option) still sees a sensible default rather than an empty scope.
      // _matchesSearch() itself does NOT consult this list — it scans
      // Object.values(record) literally, per this phase's instruction.
      searchFields: LIBRARY_LEGACY_FIELDS,
      softDelete: true, // Data_Schema_Specification §4.8 Delete Rules: Soft Delete.
      unsupportedOperations: []
    });
  }

  LibraryRepository.prototype = Object.create(Repository.prototype);
  LibraryRepository.prototype.constructor = LibraryRepository;

  // ----------------------------------------------------------------
  // 4.1 Identifier resolution — extension point (see file header
  //     "IDENTIFIER" note)
  // ----------------------------------------------------------------

  /**
   * _resolveId(record) — overrides the base class default. The base
   * class's default (when idField is set) is `return record[idField];`
   * with no generation fallback, correct for Cases (a true user-entered
   * natural key, always present by validation time). Library's identifier
   * is a HYBRID id (Data_Schema §3.2): generated only when absent, exactly
   * replicating saveLibBook()'s `obj['id'] = obj['id'] || uid();`. This
   * override is the only behavioral difference from the base class's
   * natural-key resolution path (same pattern as every prior Repository's
   * _resolveId, duplicated independently here).
   * @param {Object} record
   * @returns {string}
   * @protected
   * @override
   */
  LibraryRepository.prototype._resolveId = function (record) {
    var existing = record ? record[LIBRARY_ID_FIELD] : null;
    return (existing != null && existing !== '') ? existing : this._idGenerator();
  };

  // ----------------------------------------------------------------
  // 4.2 Validation — Repository Contract §9 (extension point)
  // ----------------------------------------------------------------

  /**
   * _validate(operation, record) — overrides the base class no-op hook.
   * Enforces exactly the rule verified in ACTUAL saveLibBook() today: a
   * single required field — العنوان — checked WITH `.trim()` (rejects
   * whitespace-only titles). Applies to create/update (delete does not
   * validate field content — Contract §9 default).
   * @protected
   * @override
   */
  LibraryRepository.prototype._validate = function (operation, record) {
    if (operation !== 'create' && operation !== 'update') {
      return { valid: true, errors: [] };
    }
    var errors = [];
    var title = record ? record['العنوان'] : undefined;
    var titleEmpty = title == null || (typeof title === 'string' ? title.trim() === '' : false);
    if (titleEmpty) {
      errors.push({ field: 'العنوان', message: 'الحقل "العنوان" إلزامي ولا يمكن أن يكون فارغاً.' });
    }
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
  LibraryRepository.prototype.validate = function (record, operation) {
    return this._validate(operation || 'create', record);
  };

  // ----------------------------------------------------------------
  // 4.3 Search — Repository Contract §7 (extension point)
  // ----------------------------------------------------------------

  /**
   * _matchesSearch(record, term) — overrides the base class's
   * searchFields-scoped substring scan to exactly replicate the ACTUAL
   * current renderLibrary() behavior, LITERALLY: `Object.values(b).join(' ')`
   * over the record exactly as given — no field list, no exclusion of the
   * new audit/metadata fields this Repository layer introduces. This is a
   * deliberate departure from every prior Repository's `_matchesSearch`
   * override (Cases through Documents each excluded audit fields via a
   * curated legacy-field list) — this phase's OVERRIDES section requires
   * "Object.values(record)" literally, "Exactly like library.js", so
   * LIBRARY_LEGACY_FIELDS above is documentation-only here, not consulted
   * by this method. See file header "SEARCH" note for full rationale.
   * @protected
   * @override
   */
  LibraryRepository.prototype._matchesSearch = function (record, term) {
    if (!term) return true;
    var needle = String(term).trim().toLowerCase();
    if (!needle) return true;
    var joined = Object.values(record || {})
      .map(function (v) { return v != null ? v : ''; })
      .join(' ')
      .toLowerCase();
    return joined.indexOf(needle) !== -1;
  };

  /**
   * filter(filterObj) — PUBLIC convenience wrapper requested by this
   * phase's instructions. Thin pass-through to search({filter: filterObj}),
   * returning just the matched records (not the full QueryResult envelope).
   * Generic and data-driven (no field hardcoded), so it supports both
   * documented `{النوع: ...}` / `{القسم: ...}` patterns — the same
   * exact-equality matches renderLibrary()'s live `#filterLibType`/
   * `#filterLibCat` controls already perform today — as well as any other
   * real field via the base class's generic range/equality engine — same
   * pattern as every prior Repository's filter() wrapper. Does not replace
   * or rename search() — additive only.
   * @param {Object} filterObj - Query Model filter object (Contract §7).
   * @returns {Object[]}
   */
  LibraryRepository.prototype.filter = function (filterObj) {
    return this.search({ filter: filterObj }).items;
  };

  // ----------------------------------------------------------------
  // 4.4 Sort — Repository Contract §7 (extension point)
  // ----------------------------------------------------------------

  /**
   * sort(records, sortSpec) — PUBLIC convenience wrapper requested by this
   * phase's instructions. Applies the base class's generic comparator
   * engine (_compareRecords) to an explicit array of records, defaulting
   * sortSpec to LIBRARY_SORT_FIELDS (`العنوان` ascending — a purely
   * additive capability, since the ACTUAL renderLibrary() applies no sort
   * at all; see file header "SORT" note) when omitted. Does not mutate the
   * input array or replace search()'s own sort option — additive only.
   * @param {Object[]} [records] - defaults to this.getAll() when omitted.
   * @param {Array<{field:string, direction?:'asc'|'desc'}>|{field:string, direction?:'asc'|'desc'}} [sortSpec]
   * @returns {Object[]}
   */
  LibraryRepository.prototype.sort = function (records, sortSpec) {
    var list = Array.isArray(records) ? records.slice() : this.getAll();
    var spec = sortSpec || LIBRARY_SORT_FIELDS.map(function (f) { return { field: f, direction: 'asc' }; });
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
  LibraryRepository.prototype.insert = function (entity) {
    return this.create(entity);
  };

  /**
   * remove(id) -> WriteResult
   * Alias for the inherited, Contract-literal delete(id).
   * @param {string} id
   * @returns {Promise<{success:boolean, record:?Object, error:?Object}>}
   */
  LibraryRepository.prototype.remove = function (id) {
    return this.delete(id);
  };

  // ================================================================
  // 5. Exports
  // ================================================================

  var api = {
    LibraryRepository: LibraryRepository,
    createLibraryLocalStorageAdapter: createLibraryLocalStorageAdapter
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  if (root) {
    root.LibraryRepository = LibraryRepository;
    root.createLibraryLocalStorageAdapter = createLibraryLocalStorageAdapter;
  }

})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
