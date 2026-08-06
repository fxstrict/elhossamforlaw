/**
 * ================================================================
 * ChildrenRepository.js — Children Repository | نظام الحسام للمحاماة
 * ================================================================
 * V10 — Offline First Architecture
 * PHASE 5 — SUB-PHASE 5.4 — Children Repository
 *
 * Source of design (no assumption outside these — see Input Gap in
 * Children_Repository_Report.md):
 *   - Repository_Contract_Report_PHASE2_V10.md  (Contract §3, Catalog §4.3,
 *     Standards §19 — literal operation names, no synonyms)
 *   - Data_Schema_Specification_Report_PHASE4_V10.md (§4.3 Children: Primary
 *     Key, Required Fields, Search/Sort/Filter Fields, Delete/Sync Rules)
 *   - js/core/Repository.js (Repository Core — Phase 5.1, extended here,
 *     never modified)
 *   - js/core/CasesRepository.js and js/repositories/ClientsRepository.js
 *     (Phases 5.2/5.3 — the pattern reused again here: temporary
 *     localStorage Adapter, additive insert/remove/filter/sort/validate
 *     wrappers, documented deviations resolved in favor of actual runtime
 *     behavior — neither file read for implementation details beyond this
 *     pattern; neither modified)
 *   - Direct inspection of js/modules/children.js (actual current runtime
 *     behavior of saveChild()/deleteChild()/renderChildren() — ground truth
 *     for the "100% Behavior Compatible" requirement of this phase)
 *   - Direct inspection of index.html (FIELDS.children / MAP.children field
 *     definitions, `data.children` localStorage wiring)
 *   - Direct inspection of Code_v4.gs (SHEET_DEFS confirms NO 'الأطفال'
 *     sheet exists — see "SYNC" note below)
 *
 * WHAT THIS FILE IS
 *   The third concrete, entity-aware Repository. It subclasses the generic
 *   Repository base class (js/core/Repository.js) and adds ONLY Children
 *   business knowledge: the "رقم_الطفل" identifier field (hybrid id per
 *   Data_Schema_Specification §3.2 — generated via a uid()-equivalent when
 *   absent, exactly as saveChild() does today), the two fields required
 *   today by saveChild(), and the actual free-text search behavior enforced
 *   today by renderChildren() — which, importantly, CONTRADICTS both
 *   planning reports on this point (see "SEARCH" note below).
 *
 * WHAT THIS FILE IS NOT
 *   - It does NOT modify js/core/Repository.js, js/core/CasesRepository.js,
 *     or js/repositories/ClientsRepository.js.
 *   - It does NOT modify js/modules/children.js, js/modules/cases.js,
 *     js/modules/sessions.js, js/modules/documents.js, js/modules/tasks.js,
 *     js/modules/fees.js, index.html, any CSS, or Code_v4.gs.
 *   - It is NOT wired into index.html in this phase (no <script> tag
 *     references it) — pure additive file, inert until a later Migration
 *     Contract stage (Repository_Contract_Report.md §16).
 *   - It does NOT implement IndexedDB and does NOT call or reference
 *     DatabaseService or ApiService (no `syncToSheets()`/`API_URL`
 *     dependency — this Repository never syncs; see "SYNC" note below).
 *
 * ----------------------------------------------------------------
 * INPUT GAP — see Children_Repository_Report.md for the full table.
 *   Summary (unchanged since Phase 5.3, re-confirmed for this phase):
 *   `PROJECT_MAP.md` remains absent from the archive entirely.
 *   `PROJECT_HISTORY.md` and `NEXT_PHASE.md` remain available only under
 *   their numbered-duplicate filenames in doc/ (`PROJECT_HISTORY (5).md`,
 *   `NEXT_PHASE (5).md`). `PROJECT_STATE.md` and `PROJECT_STATE (7).md` were
 *   already reconciled into a single, identical, up-to-date pair at the end
 *   of Phase 5.3 — both read and treated as one authoritative document here.
 *
 * STORAGE ADAPTER — a temporary, Children-scoped adapter (same decision
 *   pattern as Cases/Clients — each Repository still gets its own adapter;
 *   NEXT_PHASE.md still leaves "shared adapter vs. per-Repository adapter"
 *   as an open decision). Reads/writes the SAME localStorage key
 *   ('children') that index.html's global `data.children` / `saveLocal()`
 *   already use today.
 *
 * IDENTIFIER — the same documented reconciliation pattern already applied
 *   to Clients in Phase 5.3, now confirmed again for Children:
 *   Data_Schema_Specification §4.3 abstracts the Primary Key as generic
 *   `id` (Hybrid). Direct inspection of the ACTUAL saveChild() in
 *   js/modules/children.js shows the generated identifier is stored under
 *   the Arabic field name "رقم_الطفل", not a generic "id":
 *     obj['رقم_الطفل'] = obj['رقم_الطفل'] || uid();
 *   Because this phase's explicit priority is "Behavior Compatible 100%
 *   مع Children Module الحالي", ChildrenRepository below configures
 *   `idField: 'رقم_الطفل'` (so every inherited Contract-literal method
 *   reads/writes the correct field name) and overrides `_resolveId()` to
 *   fall back to a local uid()-equivalent generator ONLY when 'رقم_الطفل'
 *   is absent on create — replicating saveChild()'s `|| uid()` fallback
 *   exactly, the same override pattern used in ClientsRepository.js (not
 *   imported from there — see "NAMING/independence" note below).
 *
 * VALIDATION — Data_Schema_Specification §4.3, Repository_Contract_Report
 *   §4.3, and direct inspection of the ACTUAL saveChild() (js/modules/
 *   children.js, line 38) all agree: TWO fields are required —
 *     var c=document.getElementById('fChildCaseNum').value.trim();
 *     var n=document.getElementById('fChildName').value.trim();
 *     if(!c||!n){toast('يرجى ملء رقم القضية واسم الطفل','error');return;}
 *   `c` maps (via MAP.children) to `رقم_القضية`, `n` maps to `الاسم`. No
 *   discrepancy here across any of the three sources — `_validate()` below
 *   enforces exactly these two required, non-empty (after trim) fields.
 *
 * SEARCH — **a documented discrepancy against BOTH planning reports, not
 *   just one forward-looking suggestion (a stronger case than Clients'
 *   §2.2 in Phase 5.3).** Both `Data_Schema_Specification_Report.md §4.3`
 *   ("لا بحث نصي حر موثَّق حالياً — فلترة فقط" — "no free-text search
 *   documented currently — filtering only") and
 *   `Repository_Contract_Report_PHASE2_V10.md §4.3` ("نوع البحث: فلترة حسب
 *   رقم_القضية فقط عملياً — لا بحث نصي حر موثّق في الكود الحالي") state
 *   there is no free-text search for Children. Direct inspection of the
 *   ACTUAL current renderChildren() (js/modules/children.js, line 46)
 *   shows otherwise — it implements the exact same full-record free-text
 *   join pattern already confirmed for Cases and Clients:
 *     var rows=data.children.filter(function(c){
 *       return !s||Object.values(c).join(' ').toLowerCase().includes(s);
 *     });
 *   bound to a real, live UI search box (`#searchChildren`,
 *   `oninput="renderChildren()"` — index.html line 121). Because this
 *   phase's explicit priority is "Behavior Compatible 100% مع Children
 *   Module الحالي" — and because a live, wired UI control exercising this
 *   exact behavior today is stronger evidence than an abstract planning
 *   document's field-list recommendation — `_matchesSearch` is overridden
 *   here to replicate the actual free-text join across
 *   `CHILDREN_LEGACY_FIELDS` (excluding the new audit/metadata fields that
 *   did not exist in the record shape before this Repository layer, same
 *   reasoning as Cases/Clients). This divergence from both official reports
 *   is called out explicitly (not silently "fixed") in
 *   Children_Repository_Report.md §2.4.
 *
 * SYNC — Code_v4.gs's SHEET_DEFS confirms NO 'الأطفال' sheet exists in the
 *   Apps Script backend, yet js/modules/children.js's saveChild() still
 *   calls `syncToSheets('الأطفال', obj, idx)` when API_URL is set, and
 *   js/modules/settings.js's loadFromSheets() pairs ['الأطفال','children']
 *   — a pre-existing, already-known gap (see PROJECT_STATE.md's prior audit
 *   history), not introduced or resolved here. This Repository does not
 *   call ApiService/syncToSheets/fetch at all (forbidden this phase, and
 *   consistent with CasesRepository/ClientsRepository, neither of which
 *   sync either) — it is a pure localStorage CRUD layer. The `syncPolicy`
 *   concept flagged in Data_Schema_Specification §4.3 and
 *   Repository_Contract_Report §4.3 ("delete = local-only until the policy
 *   decision is made") therefore does not yet apply to ANY Repository built
 *   so far, Children included; nothing here forecloses wiring a sync layer
 *   on top of this Repository later without changing its Contract.
 *
 * NAMING / independence — same reconciliation as CasesRepository.js and
 *   ClientsRepository.js (see their header "NAMING"/"IDENTIFIER" notes):
 *   every Contract-literal method (create/update/delete/get/getAll/find/
 *   exists/count/bulkInsert/bulkUpdate/bulkDelete/search/export/import/
 *   clear/transaction) is inherited UNCHANGED from Repository.prototype.
 *   insert()/remove()/filter()/sort()/validate() are additive convenience
 *   wrappers requested by this phase's instructions, not renamed or removed
 *   Contract methods. This file does not import or reference
 *   ClientsRepository.js/CasesRepository.js in any way — its local
 *   uid()-equivalent generator and Storage Adapter are self-contained
 *   duplicates of the same pattern, not shared code, per this phase's
 *   "depends only on Repository.js" instruction.
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
      'ChildrenRepository requires js/core/Repository.js to be loaded first ' +
      '(Repository base class not found).'
    );
  }

  // PHASE 8 / SUB-PHASE 8.5.2 — Repository Wiring: ChildrenRepository's Storage
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
      'ChildrenRepository requires js/core/DatabaseService.js to be loaded ' +
      'first (DatabaseService class not found).'
    );
  }
  if (typeof IndexedDBAdapter !== 'function') {
    throw new Error(
      'ChildrenRepository requires js/core/IndexedDBAdapter.js to be ' +
      'loaded first (IndexedDBAdapter class not found).'
    );
  }

  // ================================================================
  // 1. Children business knowledge (private to this file)
  // ================================================================

  /**
   * Identifier field — actual runtime field name (see file header
   * "IDENTIFIER" note). A hybrid id per Data_Schema_Specification §3.2:
   * generated via a uid()-equivalent, but stored under this Arabic key,
   * not a generic "id".
   */
  var CHILDREN_ID_FIELD = 'رقم_الطفل';

  /**
   * Fields required today, verified against the ACTUAL saveChild() runtime
   * check in js/modules/children.js (matches Data_Schema_Specification
   * §4.3 AND Repository_Contract_Report §4.3 exactly — no discrepancy on
   * this point, unlike search below).
   */
  var CHILDREN_REQUIRED_FIELDS = ['رقم_القضية', 'الاسم'];

  /** Filter Fields per Data_Schema_Specification §4.3 / Repository_Contract
   *  §4.3 — the only documented, and only actually-used, filtering
   *  dimension for Children (every real Children query today is "children
   *  of a given case"). */
  var CHILDREN_FILTER_FIELDS = ['رقم_القضية'];

  /** Sort Fields per Data_Schema_Specification §4.3 (proposed — the actual
   *  current renderChildren() applies no sort at all, insertion order
   *  only, same as Cases/Clients). Exposed here for the new sort()
   *  convenience method only. */
  var CHILDREN_SORT_FIELDS = ['تاريخ_الميلاد'];

  /**
   * The full set of legacy Arabic/business fields for Children, used to
   * replicate the exact legacy free-text search behavior (see
   * _matchesSearch override — file header "SEARCH" note) without
   * accidentally matching against the new English audit/metadata fields
   * (createdAt, updatedAt, deletedAt, version, syncVersion, checksum) that
   * did not exist in the record shape before this Repository layer —
   * including them in the join would change search results and break
   * "100% Behavior Compatible".
   *
   * Derived from MAP.children (index.html) — رقم_القضية, الاسم,
   * تاريخ_الميلاد, السن, المدرسة, محل_الإقامة, الحضانة_الحالية,
   * النفقة_الحالية, ملاحظات — plus:
   *   - 'رقم_الطفل'    : the identifier itself (set by saveChild() and
   *                       already part of every real record — included in
   *                       Object.values(c) today, so included here too).
   *   - 'تاريخ_الإنشاء' : creation timestamp stamped by saveChild().
   * No portal-token-equivalent or other dynamically-added field exists for
   * Children (unlike Clients' 'portal_token') — confirmed by full read of
   * js/modules/children.js (51 lines total, no other field ever written).
   */
  var CHILDREN_LEGACY_FIELDS = [
    'رقم_الطفل', 'رقم_القضية', 'الاسم', 'تاريخ_الميلاد', 'السن', 'المدرسة',
    'محل_الإقامة', 'الحضانة_الحالية', 'النفقة_الحالية', 'ملاحظات',
    'تاريخ_الإنشاء'
  ];

  // ================================================================
  // 2. Storage Adapter — DatabaseService-backed (PHASE 8 / SUB-PHASE 8.5.2)
  // ================================================================
  // See file header "WIRING UPDATE" note (added by this phase). Reads/
  // writes the SAME 'children' key index.html already uses today, in the
  // SAME flat JSON-array shape — LocalStorageAdapter's own default empty
  // keyPrefix guarantees this. Public factory NAME and SIGNATURE are
  // unchanged from the prior phase; only what it builds internally changed
  // (a real DatabaseService + LocalStorageAdapter pair instead of the old
  // hand-rolled ad-hoc {read,write} object).

  /**
   * Builds the Storage Adapter injected into ChildrenRepository's underlying
   * Repository base class: a real DatabaseService instance wrapping a real
   * LocalStorageAdapter instance. This satisfies Repository.js's duck-typed
   * contract ({read(entityKey), write(entityKey, records)}) because
   * DatabaseService exposes both methods, each delegating unchanged to the
   * LocalStorageAdapter beneath it — which in turn reads/writes the
   * browser's real localStorage (or an injected localStorage-shaped
   * stand-in) under the exact same key ('children') the current global
   * `data.children`/`saveLocal()` already use.
   * @param {Storage} [storageImpl] - optional localStorage-shaped override
   *   (e.g. a test harness's in-memory stand-in). When omitted,
   *   LocalStorageAdapter itself resolves the real global localStorage
   *   lazily, on first read()/write() call (not here, not at construction
   *   time), matching LocalStorageAdapter's own documented lazy-engine-
   *   resolution design.
   * @returns {DatabaseService}
   */
  function createChildrenLocalStorageAdapter(storageImpl) {
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
  // already defined independently in ClientsRepository.js, per this
  // phase's "depends only on Repository.js" instruction (no cross-Repository
  // imports).
  //
  // Verified identical algorithm to js/ui-utils.js:
  //   function uid(){return Date.now().toString(36)+Math.random().toString(36).slice(2,6);}

  function generateChildId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  }

  // ================================================================
  // 4. ChildrenRepository — subclass
  // ================================================================

  /**
   * @class ChildrenRepository
   * @param {{storageAdapter?: object, idGenerator?: function}} [config] -
   *   Optional overrides (e.g. for tests). Defaults to the
   *   localStorage-backed placeholder adapter and the local uid()-
   *   equivalent generator above.
   */
  function ChildrenRepository(config) {
    config = config || {};
    var storageAdapter = config.storageAdapter || createChildrenLocalStorageAdapter();
    var idGenerator = typeof config.idGenerator === 'function' ? config.idGenerator : generateChildId;

    Repository.call(this, {
      entityKey: 'children',
      storageAdapter: storageAdapter,
      idField: CHILDREN_ID_FIELD,
      idGenerator: idGenerator,
      // No officially documented narrow Search Fields list exists for
      // Children (file header "SEARCH" note) — searchFields is set to the
      // full legacy field list so that even a caller bypassing the
      // _matchesSearch override (e.g. via a future field-scoped query
      // option) still sees a sensible default rather than an empty scope.
      searchFields: CHILDREN_LEGACY_FIELDS,
      softDelete: true, // Data_Schema_Specification §4.3 Delete Rules: soft delete at Schema level.
      unsupportedOperations: []
    });
  }

  ChildrenRepository.prototype = Object.create(Repository.prototype);
  ChildrenRepository.prototype.constructor = ChildrenRepository;

  // ----------------------------------------------------------------
  // 4.1 Identifier resolution — extension point (see file header
  //     "IDENTIFIER" note)
  // ----------------------------------------------------------------

  /**
   * _resolveId(record) — overrides the base class default. The base
   * class's default (when idField is set) is `return record[idField];`
   * with no generation fallback, correct for Cases (a true user-entered
   * natural key, always present by validation time). Children's identifier
   * is a HYBRID id (Data_Schema §3.2): generated only when absent, exactly
   * replicating saveChild()'s `obj['رقم_الطفل'] = obj['رقم_الطفل'] ||
   * uid();`. This override is the only behavioral difference from the base
   * class's natural-key resolution path (same pattern as
   * ClientsRepository._resolveId, duplicated independently here).
   * @param {Object} record
   * @returns {string}
   * @protected
   * @override
   */
  ChildrenRepository.prototype._resolveId = function (record) {
    var existing = record ? record[CHILDREN_ID_FIELD] : null;
    return (existing != null && existing !== '') ? existing : this._idGenerator();
  };

  // ----------------------------------------------------------------
  // 4.2 Validation — Repository Contract §9 (extension point)
  // ----------------------------------------------------------------

  /**
   * _validate(operation, record) — overrides the base class no-op hook.
   * Enforces exactly the rule verified in ACTUAL saveChild() today: two
   * required, non-empty (after trim) fields — رقم_القضية and الاسم.
   * Applies to create/update (delete does not validate field content —
   * Contract §9 default).
   * @protected
   * @override
   */
  ChildrenRepository.prototype._validate = function (operation, record) {
    if (operation !== 'create' && operation !== 'update') {
      return { valid: true, errors: [] };
    }
    var errors = [];
    CHILDREN_REQUIRED_FIELDS.forEach(function (field) {
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
  ChildrenRepository.prototype.validate = function (record, operation) {
    return this._validate(operation || 'create', record);
  };

  // ----------------------------------------------------------------
  // 4.3 Search — Repository Contract §7 (extension point)
  // ----------------------------------------------------------------

  /**
   * _matchesSearch(record, term) — overrides the base class's
   * searchFields-scoped substring scan to exactly replicate the ACTUAL
   * current renderChildren() behavior: `Object.values(c).join(' ')` across
   * every legacy business field (excluding the new audit/metadata fields
   * that did not exist in the record before this Repository layer — see
   * CHILDREN_LEGACY_FIELDS comment above). Required for "100% Behavior
   * Compatible" free-text search once this Repository is eventually wired
   * to replace renderChildren()'s inline filter — see file header "SEARCH"
   * note for why this deliberately overrides what BOTH planning reports
   * claim (no free-text search for Children).
   * @protected
   * @override
   */
  ChildrenRepository.prototype._matchesSearch = function (record, term) {
    if (!term) return true;
    var needle = String(term).trim().toLowerCase();
    if (!needle) return true;
    var joined = CHILDREN_LEGACY_FIELDS
      .map(function (field) { return record[field] != null ? record[field] : ''; })
      .join(' ')
      .toLowerCase();
    return joined.indexOf(needle) !== -1;
  };

  /**
   * filter(filterObj) — PUBLIC convenience wrapper requested by this
   * phase's instructions. Thin pass-through to search({filter: filterObj}),
   * returning just the matched records (not the full QueryResult envelope)
   * to mirror how a "children of case X" query would consume a filtered
   * array directly (the actual, only real filtering pattern used by
   * Children today per Repository_Contract_Report §4.3). Does not replace
   * or rename search() — additive only.
   * @param {Object} filterObj - Query Model filter object (Contract §7).
   * @returns {Object[]}
   */
  ChildrenRepository.prototype.filter = function (filterObj) {
    return this.search({ filter: filterObj }).items;
  };

  // ----------------------------------------------------------------
  // 4.4 Sort — Repository Contract §7 (extension point)
  // ----------------------------------------------------------------

  /**
   * sort(records, sortSpec) — PUBLIC convenience wrapper requested by this
   * phase's instructions. Applies the base class's generic comparator
   * engine (_compareRecords) to an explicit array of records, defaulting
   * sortSpec to CHILDREN_SORT_FIELDS (Data_Schema_Specification §4.3 Sort
   * Fields — تاريخ_الميلاد) when omitted. Does not mutate the input array
   * or replace search()'s own sort option — additive only.
   * @param {Object[]} [records] - defaults to this.getAll() when omitted.
   * @param {Array<{field:string, direction?:'asc'|'desc'}>|{field:string, direction?:'asc'|'desc'}} [sortSpec]
   * @returns {Object[]}
   */
  ChildrenRepository.prototype.sort = function (records, sortSpec) {
    var list = Array.isArray(records) ? records.slice() : this.getAll();
    var spec = sortSpec || CHILDREN_SORT_FIELDS.map(function (f) { return { field: f, direction: 'asc' }; });
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
  ChildrenRepository.prototype.insert = function (entity) {
    return this.create(entity);
  };

  /**
   * remove(id) -> WriteResult
   * Alias for the inherited, Contract-literal delete(id).
   * @param {string} id
   * @returns {Promise<{success:boolean, record:?Object, error:?Object}>}
   */
  ChildrenRepository.prototype.remove = function (id) {
    return this.delete(id);
  };

  // ================================================================
  // 5. Exports
  // ================================================================

  var api = {
    ChildrenRepository: ChildrenRepository,
    createChildrenLocalStorageAdapter: createChildrenLocalStorageAdapter
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  if (root) {
    root.ChildrenRepository = ChildrenRepository;
    root.createChildrenLocalStorageAdapter = createChildrenLocalStorageAdapter;
  }

})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
