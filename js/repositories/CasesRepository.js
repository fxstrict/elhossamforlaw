/**
 * ================================================================
 * CasesRepository.js — Cases Repository | نظام الحسام للمحاماة
 * ================================================================
 * V10 — Offline First Architecture
 * PHASE 5 — SUB-PHASE 5.2 — Cases Repository
 *
 * Source of design (no assumption outside these — see Input Gap in
 * Cases_Repository_Report.md):
 *   - Repository_Contract_Report_PHASE2_V10.md  (Contract §3, Catalog §4.1,
 *     Standards §19 — literal operation names, no synonyms)
 *   - Data_Schema_Specification_Report_PHASE4_V10.md (§4.1 Cases: Primary
 *     Key, Required Fields, Search/Sort/Filter Fields, Delete Rules)
 *   - js/core/Repository.js (Repository Core — Phase 5.1, extended here,
 *     never modified)
 *   - Direct inspection of js/modules/cases.js (actual current runtime
 *     behavior of saveCase()/deleteCase()/renderCases() — ground truth for
 *     the "100% Behavior Compatible" requirement of this phase)
 *
 * WHAT THIS FILE IS
 *   The first concrete, entity-aware Repository. It subclasses the generic
 *   Repository base class (js/core/Repository.js) and adds ONLY Cases
 *   business knowledge: the "رقم_القضية" natural key, the actual validation
 *   rule enforced today by saveCase(), and the actual free-text search
 *   behavior enforced today by renderCases().
 *
 * WHAT THIS FILE IS NOT
 *   - It does NOT modify js/core/Repository.js.
 *   - It does NOT modify js/modules/cases.js, index.html, or any other
 *     Module/CSS/Apps Script file.
 *   - It is NOT wired into index.html in this phase (no <script> tag
 *     references it) — pure additive file, inert until a later Migration
 *     Contract stage (Repository_Contract_Report.md §16).
 *   - It does NOT implement IndexedDB or modify DatabaseService.
 *
 * INPUT GAP — originally opened here, now CLOSED (superseded by the
 * update below):
 *   As originally written (PHASE 5.2), `DatabaseService` did not exist yet
 *   as code anywhere in the project, so this file defined its own minimal,
 *   localStorage-only, Cases-scoped Storage Adapter
 *   (`createCasesLocalStorageAdapter`, private to this file) as an explicit
 *   placeholder, satisfying only the duck-typed contract Repository.js
 *   documents ({read(entityKey), write(entityKey, records)}), reading/
 *   writing the localStorage key 'cases' directly.
 *
 * WIRING UPDATE — PHASE 8 / SUB-PHASE 8.5.1 — Repository Wiring Pilot
 *   `js/core/DatabaseService.js` and `js/core/LocalStorageAdapter.js` now
 *   exist (PHASE 8/8.3.2, 8.4.1) and were integration-verified end-to-end
 *   against the real `Repository` base class in PHASE 8/8.4.2
 *   (`js/tests/verify_database_pipeline.js`, `docs/Database_Pipeline_Report.md`
 *   — 37/37 checks passed, confirming Repository -> DatabaseService ->
 *   LocalStorageAdapter is a drop-in-safe pipeline). This phase replaces
 *   ONLY what `createCasesLocalStorageAdapter()` builds internally: instead
 *   of the hand-rolled ad-hoc `{read, write}` object above, it now
 *   constructs a real `LocalStorageAdapter` instance and wraps it in a real
 *   `DatabaseService` instance, and returns THAT as the Storage Adapter
 *   injected into the underlying `Repository` base class. Neither
 *   `js/core/DatabaseService.js` nor `js/core/StorageAdapter.js` nor
 *   `js/core/LocalStorageAdapter.js` is modified anywhere by this phase —
 *   all three are required here exactly as PHASE 8 already built and
 *   verified them, unchanged.
 *
 *   This is a pure dependency-injection swap:
 *     - `createCasesLocalStorageAdapter`'s exported NAME and SIGNATURE
 *       (`(storageImpl?)`) are unchanged, so nothing calling it needs to
 *       change.
 *     - `CasesRepository`'s own constructor, and every one of its
 *       prototype methods (`_validate`, `validate`, `_matchesSearch`,
 *       `filter`, `sort`, `insert`, `remove`) are BYTE-IDENTICAL to PHASE
 *       5.2 — see `docs/CasesRepository_Wiring_Report.md §3` for the exact
 *       diff. Only the Storage Adapter construction changed.
 *     - Reads/writes still hit the exact SAME localStorage key ('cases'),
 *       in the exact SAME flat JSON-array shape, that index.html's global
 *       `data.cases`/`saveLocal()` already use today —
 *       `LocalStorageAdapter`'s own default empty `keyPrefix` guarantees
 *       this byte-for-byte compatibility (see `LocalStorageAdapter.js`
 *       header, "Compatibility requirement").
 *     - One documented, harmless timing difference: the OLD adapter threw
 *       synchronously, at `CasesRepository` construction time, if no
 *       `storageImpl` was injected AND no global `localStorage` existed.
 *       The NEW pipeline defers that same check to the first `read()`/
 *       `write()` call (an async rejection, not a synchronous throw),
 *       matching `LocalStorageAdapter`'s own documented lazy-engine-
 *       resolution design. `Repository.prototype.open()`/`_persist()`
 *       already wrap ANY adapter rejection into the identical structured
 *       `RepositoryError` shape regardless of when/how the underlying
 *       adapter fails, so no caller-observable CRUD behavior changes — see
 *       `docs/CasesRepository_Wiring_Report.md §5` for the full analysis.
 *
 * VALIDATION — a documented discrepancy between the two source reports
 *   Data_Schema_Specification_Report.md §4.1 lists Required Fields for
 *   Cases as رقم_القضية + عنوان_القضية only. However, direct inspection of
 *   the ACTUAL saveCase() in js/modules/cases.js (line ~182-190) shows a
 *   third field is already enforced at runtime today:
 *     if (!num || !title || !client) { toast(...); return; }
 *   i.e. رقم_القضية, عنوان_القضية, AND اسم_الموكل are all required today.
 *   The Data Schema report's own methodology note (§1) explains the gap:
 *   its Required-Fields audit only grepped for the HTML `required`
 *   attribute (zero results), which does not capture this manual
 *   JavaScript-level check inside saveCase(). Because THIS phase's explicit
 *   priority is "Behavior Compatible 100% مع النظام الحالي", _validate()
 *   below follows the verified ACTUAL code behavior (3 required fields),
 *   not the schema report's narrower list. This is documented again in
 *   Cases_Repository_Report.md.
 *
 * NAMING — a documented, deliberate reconciliation
 *   Repository_Contract_Report.md §19 mandates literal Contract operation
 *   names with no synonyms (create/update/delete, inherited unchanged from
 *   Repository.js). This phase's own instructions additionally ask for
 *   insert()/remove()/filter()/sort()/validate() by name. Both are honored
 *   without conflict: the Contract-literal methods (create, update, delete,
 *   get, getAll, find, exists, count, bulkInsert, bulkUpdate, bulkDelete,
 *   search, export, import, clear, transaction) are inherited UNCHANGED
 *   from Repository.prototype and remain the canonical API every future
 *   Repository must also expose. CasesRepository additionally defines
 *   insert()/remove()/filter()/sort()/validate() as thin, additive
 *   convenience wrappers around those same canonical methods — new public
 *   surface, not renamed or removed Contract methods.
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
      'CasesRepository requires js/core/Repository.js to be loaded first ' +
      '(Repository base class not found).'
    );
  }

  // PHASE 8 / SUB-PHASE 8.5.1 — Repository Wiring Pilot: CasesRepository's
  // Storage Adapter is now built from the real DatabaseService/
  // LocalStorageAdapter pair (see file header "WIRING UPDATE" note above).
  // Neither dependency is modified by this phase — both are required here
  // exactly as PHASE 8 already built and verified them.
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
      'CasesRepository requires js/core/DatabaseService.js to be loaded ' +
      'first (DatabaseService class not found).'
    );
  }
  if (typeof IndexedDBAdapter !== 'function') {
    throw new Error(
      'CasesRepository requires js/core/IndexedDBAdapter.js to be ' +
      'loaded first (IndexedDBAdapter class not found).'
    );
  }

  // ================================================================
  // 1. Cases business knowledge (private to this file)
  // ================================================================

  /** Natural key field — Data_Schema_Specification §4.1 / §3.2. */
  var CASES_ID_FIELD = 'رقم_القضية';

  /**
   * Fields required today, verified against the ACTUAL saveCase() runtime
   * check in js/modules/cases.js (not the Data Schema report's narrower
   * list — see file header "VALIDATION" note).
   */
  var CASES_REQUIRED_FIELDS = ['رقم_القضية', 'عنوان_القضية', 'اسم_الموكل'];

  /**
   * Search Fields per Data_Schema_Specification §4.1. Kept for any future
   * caller that wants a scoped, field-limited search via search({search:...})
   * on a subset of fields. NOT used as the default free-text engine below,
   * because the actual current renderCases() searches every field on the
   * record, not just these four (see _matchesSearch override).
   */
  var CASES_SEARCH_FIELDS = ['اسم_الموكل', 'اسم_الخصم', 'رقم_القضية', 'عنوان_القضية'];

  /** Filter Fields per Data_Schema_Specification §4.1 — matches exactly the
   *  two dropdowns actually wired in renderCases() today (فلترة الحالة/النوع). */
  var CASES_FILTER_FIELDS = ['الحالة', 'نوع_الدعوى'];

  /** Sort Fields per Data_Schema_Specification §4.1 (proposed — the actual
   *  current renderCases() applies no sort at all, array/insertion order
   *  only). Exposed here for the new sort() convenience method only. */
  var CASES_SORT_FIELDS = ['تاريخ_الجلسة_القادمة', 'تاريخ_القيد'];

  /**
   * The full set of legacy Arabic business fields for Cases (34 fields —
   * Data_Schema_Specification §4.1: 2 required + 32 optional). Used ONLY to
   * replicate the exact legacy free-text search behavior (see
   * _matchesSearch override) without accidentally matching against the new
   * English audit/metadata fields (createdAt, updatedAt, deletedAt,
   * version, syncVersion, checksum) that did not exist in the record shape
   * before this Repository layer — including them in the join would change
   * search results and break "100% Behavior Compatible".
   */
  var CASES_LEGACY_FIELDS = [
    'رقم_القضية', 'رقم_الدائرة', 'رقم_القاعة', 'رقم_الدعوى', 'نوع_الدعوى', 'المحكمة', 'عنوان_القضية',
    'نوع_الموكل', 'اسم_الموكل', 'رقم_قومي_الموكل', 'هاتف_الموكل',
    'عنوان_الموكل', 'عمل_الموكل', 'جهة_عمل_الموكل',
    'اسم_الخصم', 'رقم_قومي_الخصم', 'هاتف_الخصم', 'عنوان_الخصم',
    'عمل_الخصم', 'جهة_عمل_الخصم',
    'الحالة', 'تاريخ_القيد', 'تاريخ_الجلسة_القادمة', 'أتعاب_المحاماة',
    'تاريخ_عقد_الزواج', 'رقم_وثيقة_الزواج', 'مكتب_التوثيق',
    'وجود_قائمة_منقولات', 'وجود_أطفال',
    'الطلبات_القانونية', 'الدفوع_القانونية', 'إجراءات_الدعوى',
    'قرارات_المحكمة', 'تاريخ_الحكم', 'رقم_التنفيذ', 'إجراءات_التنفيذ',
    'الملاحظات'
  ];

  // ================================================================
  // 2. Storage Adapter — DatabaseService-backed (PHASE 8 / SUB-PHASE 8.5.1)
  // ================================================================
  // See file header "WIRING UPDATE" note. Reads/writes the SAME 'cases'
  // key index.html already uses today, in the SAME flat JSON-array shape
  // — LocalStorageAdapter's own default empty keyPrefix guarantees this.
  // Public factory NAME and SIGNATURE are unchanged from PHASE 5.2; only
  // what it builds internally changed (DatabaseService + LocalStorageAdapter
  // instead of a hand-rolled ad-hoc {read,write} object).

  /**
   * Builds the Storage Adapter injected into CasesRepository's underlying
   * Repository base class: a real DatabaseService instance wrapping a real
   * LocalStorageAdapter instance. This satisfies Repository.js's duck-typed
   * contract ({read(entityKey), write(entityKey, records)}) because
   * DatabaseService exposes both methods, each delegating unchanged to the
   * LocalStorageAdapter beneath it (js/core/DatabaseService.js §1.2) —
   * which in turn reads/writes the browser's real localStorage (or an
   * injected localStorage-shaped stand-in) under the exact same key
   * ('cases') the current global `data.cases`/`saveLocal()` already use.
   * @param {Storage} [storageImpl] - optional localStorage-shaped override
   *   (e.g. a test harness's in-memory stand-in). When omitted,
   *   LocalStorageAdapter itself resolves the real global localStorage
   *   lazily, on first read()/write() — not here, not at construction time
   *   (see file header "one documented, harmless timing difference" note).
   * @returns {DatabaseService}
   */
  function createCasesLocalStorageAdapter(storageImpl) {
    var adapter = new IndexedDBAdapter(storageImpl ? { engineOptions: { indexedDBImpl: storageImpl } } : {});
    return new DatabaseService(adapter);
  }

  // ================================================================
  // 3. CasesRepository — subclass
  // ================================================================

  /**
   * @class CasesRepository
   * @param {{storageAdapter?: object}} [config] - Optional override of the
   *   storage adapter (e.g. for tests). Defaults to the localStorage-backed
   *   placeholder adapter above.
   */
  function CasesRepository(config) {
    config = config || {};
    var storageAdapter = config.storageAdapter || createCasesLocalStorageAdapter();

    Repository.call(this, {
      entityKey: 'cases',
      storageAdapter: storageAdapter,
      idField: CASES_ID_FIELD,
      searchFields: CASES_SEARCH_FIELDS,
      softDelete: true, // Data_Schema_Specification §4.1 Delete Rules: soft delete is the default for Cases.
      unsupportedOperations: []
    });
  }

  CasesRepository.prototype = Object.create(Repository.prototype);
  CasesRepository.prototype.constructor = CasesRepository;

  // ----------------------------------------------------------------
  // 3.1 Validation — Repository Contract §9 (extension point)
  // ----------------------------------------------------------------

  /**
   * _validate(operation, record) — overrides the base class no-op hook.
   * Enforces exactly the rule verified in ACTUAL saveCase() today: three
   * required, non-empty (after trim) fields. Applies to create/update
   * (delete does not validate field content — Contract §9 default).
   * @protected
   * @override
   */
  CasesRepository.prototype._validate = function (operation, record) {
    if (operation !== 'create' && operation !== 'update') {
      return { valid: true, errors: [] };
    }
    var errors = [];
    CASES_REQUIRED_FIELDS.forEach(function (field) {
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
   * defaulting to the 'create' operation shape (the strictest / most common
   * caller use-case: "is this record saveable as a new case?"). Does not
   * replace or rename any Contract operation.
   * @param {Object} record
   * @param {'create'|'update'} [operation='create']
   * @returns {{valid:boolean, errors:Array<{field:string,message:string}>}}
   */
  CasesRepository.prototype.validate = function (record, operation) {
    return this._validate(operation || 'create', record);
  };

  // ----------------------------------------------------------------
  // 3.2 Search — Repository Contract §7 (extension point)
  // ----------------------------------------------------------------

  /**
   * _matchesSearch(record, term) — overrides the base class's
   * searchFields-scoped substring scan to exactly replicate the ACTUAL
   * current renderCases() behavior: `Object.values(c).join(' ')` across
   * every legacy business field (excluding the new audit/metadata fields
   * that did not exist in the record before this Repository layer — see
   * CASES_LEGACY_FIELDS comment above). Required for "100% Behavior
   * Compatible" free-text search once this Repository is eventually wired
   * to replace renderCases()'s inline filter.
   * @protected
   * @override
   */
  CasesRepository.prototype._matchesSearch = function (record, term) {
    if (!term) return true;
    var needle = String(term).trim().toLowerCase();
    if (!needle) return true;
    var joined = CASES_LEGACY_FIELDS
      .map(function (field) { return record[field] != null ? record[field] : ''; })
      .join(' ')
      .toLowerCase();
    return joined.indexOf(needle) !== -1;
  };

  /**
   * filter(filterObj) — PUBLIC convenience wrapper requested by this
   * phase's instructions. Thin pass-through to search({filter: filterObj}),
   * returning just the matched records (not the full QueryResult envelope)
   * to mirror how renderCases() consumes a filtered array directly today.
   * Does not replace or rename search() — additive only.
   * @param {Object} filterObj - Query Model filter object (Contract §7).
   * @returns {Object[]}
   */
  CasesRepository.prototype.filter = function (filterObj) {
    return this.search({ filter: filterObj }).items;
  };

  // ----------------------------------------------------------------
  // 3.3 Sort — Repository Contract §7 (extension point)
  // ----------------------------------------------------------------

  /**
   * sort(records, sortSpec) — PUBLIC convenience wrapper requested by this
   * phase's instructions. Applies the base class's generic comparator
   * engine (_compareRecords) to an explicit array of records, defaulting
   * sortSpec to CASES_SORT_FIELDS (Data_Schema_Specification §4.1 Sort
   * Fields) when omitted. Does not mutate the input array or replace
   * search()'s own sort option — additive only.
   * @param {Object[]} [records] - defaults to this.getAll() when omitted.
   * @param {Array<{field:string, direction?:'asc'|'desc'}>|{field:string, direction?:'asc'|'desc'}} [sortSpec]
   * @returns {Object[]}
   */
  CasesRepository.prototype.sort = function (records, sortSpec) {
    var list = Array.isArray(records) ? records.slice() : this.getAll();
    var spec = sortSpec || CASES_SORT_FIELDS.map(function (f) { return { field: f, direction: 'asc' }; });
    var self = this;
    return list.sort(function (a, b) { return self._compareRecords(a, b, Array.isArray(spec) ? spec : [spec]); });
  };

  // ----------------------------------------------------------------
  // 3.4 Contract-literal convenience aliases (Repository §3, §19)
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
  CasesRepository.prototype.insert = function (entity) {
    return this.create(entity);
  };

  /**
   * remove(id) -> WriteResult
   * Alias for the inherited, Contract-literal delete(id).
   * @param {string} id
   * @returns {Promise<{success:boolean, record:?Object, error:?Object}>}
   */
  CasesRepository.prototype.remove = function (id) {
    return this.delete(id);
  };

  // ================================================================
  // 4. Exports
  // ================================================================

  var api = {
    CasesRepository: CasesRepository,
    createCasesLocalStorageAdapter: createCasesLocalStorageAdapter
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  if (root) {
    root.CasesRepository = CasesRepository;
    root.createCasesLocalStorageAdapter = createCasesLocalStorageAdapter;
  }

})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
