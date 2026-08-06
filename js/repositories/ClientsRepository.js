/**
 * ================================================================
 * ClientsRepository.js — Clients Repository | نظام الحسام للمحاماة
 * ================================================================
 * V10 — Offline First Architecture
 * PHASE 5 — SUB-PHASE 5.3 — Clients Repository
 *
 * Source of design (no assumption outside these — see Input Gap in
 * Clients_Repository_Report.md):
 *   - Repository_Contract_Report_PHASE2_V10.md  (Contract §3, Catalog §4.2,
 *     Standards §19 — literal operation names, no synonyms)
 *   - Data_Schema_Specification_Report_PHASE4_V10.md (§4.2 Clients: Primary
 *     Key, Required Fields, Search/Sort/Filter Fields, Delete Rules)
 *   - js/core/Repository.js (Repository Core — Phase 5.1, extended here,
 *     never modified)
 *   - js/core/CasesRepository.js (Phase 5.2 — the first concrete Repository;
 *     same pattern reused here: temporary localStorage Adapter, additive
 *     insert/remove/filter/sort/validate wrappers, documented deviations
 *     resolved in favor of actual runtime behavior)
 *   - Direct inspection of js/modules/clients.js (actual current runtime
 *     behavior of saveClient()/deleteClient()/renderClients() — ground
 *     truth for the "100% Behavior Compatible" requirement of this phase)
 *   - Direct inspection of Code_v4.gs (SHEET_DEFS 'الموكلين' — confirms the
 *     actual sheet/record field name for the client identifier)
 *
 * WHAT THIS FILE IS
 *   The second concrete, entity-aware Repository. It subclasses the generic
 *   Repository base class (js/core/Repository.js) and adds ONLY Clients
 *   business knowledge: the "رقم_الموكل" identifier field (hybrid id per
 *   Data_Schema_Specification §3.2 — generated via a uid()-equivalent when
 *   absent, exactly as saveClient() does today), the actual validation rule
 *   enforced today by saveClient() (a single required field), and the
 *   actual free-text search behavior enforced today by renderClients().
 *
 * WHAT THIS FILE IS NOT
 *   - It does NOT modify js/core/Repository.js or js/core/CasesRepository.js.
 *   - It does NOT modify js/modules/clients.js, js/modules/children.js,
 *     js/modules/sessions.js, js/modules/documents.js, js/modules/tasks.js,
 *     js/modules/fees.js, js/modules/library.js, js/modules/templates.js,
 *     index.html, any CSS, or Code_v4.gs.
 *   - It is NOT wired into index.html in this phase (no <script> tag
 *     references it) — pure additive file, inert until a later Migration
 *     Contract stage (Repository_Contract_Report.md §16).
 *   - It does NOT implement IndexedDB or modify DatabaseService/ApiService.
 *
 * ----------------------------------------------------------------
 * INPUT GAP — see Clients_Repository_Report.md for the full table. Summary:
 *   `PROJECT_MAP.md` is absent from the archive entirely (not used — every
 *   field detail needed here came directly from Data_Schema_Specification
 *   §4.2 plus direct inspection of js/modules/clients.js and Code_v4.gs).
 *   `PROJECT_HISTORY.md` and `NEXT_PHASE.md` exist only under their
 *   numbered-duplicate filenames in doc/ (`PROJECT_HISTORY (5).md`,
 *   `NEXT_PHASE (5).md`) — both read in full, no content gap.
 *   `PROJECT_STATE.md` exists as two versions (`PROJECT_STATE.md` and
 *   `PROJECT_STATE (7).md`); the latter is the newer, superset version
 *   (confirmed by diff) and was treated as authoritative.
 *
 * STORAGE ADAPTER — a temporary, Clients-scoped adapter (decision local to
 *   this phase, same as Cases in Phase 5.2 — NEXT_PHASE.md documents this
 *   as an open decision per future Repository, not a shared pattern yet).
 *   Reads/writes the SAME localStorage key ('clients') that index.html's
 *   global `data.clients` / `saveLocal()` already use today.
 *
 * IDENTIFIER — a documented deviation from NEXT_PHASE.md's forward-looking
 *   suggestion, resolved in favor of actual runtime behavior:
 *   NEXT_PHASE.md (written at the end of Phase 5.2, before this phase's own
 *   direct code inspection) predicted `idField: null` + an externally
 *   injected `idGenerator` for Clients, reasoning from
 *   Data_Schema_Specification §4.2's abstract "Primary Key: id (Hybrid)"
 *   description. Direct inspection of the ACTUAL saveClient() in
 *   js/modules/clients.js shows the generated identifier is stored under
 *   the Arabic field name "رقم_الموكل", not a generic "id":
 *     obj['رقم_الموكل'] = obj['رقم_الموكل'] || uid();
 *   Code_v4.gs's SHEET_DEFS for sheet 'الموكلين' confirms 'رقم_الموكل' is
 *   also the sheet's first column — i.e. the actual persisted identifier
 *   field project-wide, not an abstraction-layer artifact. Because this
 *   phase's explicit priority is "Behavior Compatible 100% مع النظام
 *   الحالي", ClientsRepository below configures `idField: 'رقم_الموكل'`
 *   (so every inherited Contract-literal method reads/writes the correct
 *   field name) and overrides `_resolveId()` to fall back to a local
 *   uid()-equivalent generator ONLY when 'رقم_الموكل' is absent on create
 *   — replicating saveClient()'s `|| uid()` fallback exactly, without
 *   requiring the caller to pre-populate the field (unlike Cases, where
 *   رقم_القضية is a true user-entered natural key and is one of the
 *   required fields, so it is always present by the time an id is
 *   resolved). This is documented again in Clients_Repository_Report.md.
 *
 * VALIDATION — Data_Schema_Specification §4.2 and direct inspection of the
 *   ACTUAL saveClient() (js/modules/clients.js, line ~150-155) agree: only
 *   `الاسم` (client name) is required —
 *     var name = document.getElementById('fClientName') ? ...value.trim() : '';
 *     if (!name) { toast('يرجى إدخال اسم الموكل', 'error'); return; }
 *   No discrepancy here, unlike Cases (Phase 5.2 §2.3), so `_validate()`
 *   below enforces exactly one required, non-empty (after trim) field.
 *
 * SEARCH — the base class's default `_matchesSearch` scans only the
 *   injected `searchFields`. The ACTUAL current renderClients() searches
 *   every field on the record instead:
 *     var rows = data.clients.filter(function(c) {
 *       return !s || Object.values(c).join(' ').toLowerCase().indexOf(s) >= 0;
 *     });
 *   Exactly the same pattern already resolved for Cases in Phase 5.2 §2.4 —
 *   `_matchesSearch` is overridden here to replicate this full-record join
 *   across `CLIENTS_LEGACY_FIELDS` only (excluding the new audit/metadata
 *   fields that did not exist in the record shape before this Repository
 *   layer — including them would change search results and break "100%
 *   Behavior Compatible"). `CLIENTS_SEARCH_FIELDS` (Data_Schema §4.2's
 *   narrower 3-field list) is kept as configuration for any future
 *   field-scoped caller, but is not the active default engine.
 *
 * NAMING — same reconciliation as CasesRepository.js (see its header
 *   "NAMING" note): every Contract-literal method (create/update/delete/
 *   get/getAll/find/exists/count/bulkInsert/bulkUpdate/bulkDelete/search/
 *   export/import/clear/transaction) is inherited UNCHANGED from
 *   Repository.prototype. insert()/remove()/filter()/sort()/validate() are
 *   additive convenience wrappers requested by this phase's instructions,
 *   not renamed or removed Contract methods.
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
      'ClientsRepository requires js/core/Repository.js to be loaded first ' +
      '(Repository base class not found).'
    );
  }

  // PHASE 8 / SUB-PHASE 8.5.2 — Repository Wiring: ClientsRepository's Storage
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
      'ClientsRepository requires js/core/DatabaseService.js to be loaded ' +
      'first (DatabaseService class not found).'
    );
  }
  if (typeof IndexedDBAdapter !== 'function') {
    throw new Error(
      'ClientsRepository requires js/core/IndexedDBAdapter.js to be ' +
      'loaded first (IndexedDBAdapter class not found).'
    );
  }

  // ================================================================
  // 1. Clients business knowledge (private to this file)
  // ================================================================

  /**
   * Identifier field — actual runtime field name (see file header
   * "IDENTIFIER" note). A hybrid id per Data_Schema_Specification §3.2:
   * generated via a uid()-equivalent, but stored under this Arabic key,
   * not a generic "id".
   */
  var CLIENTS_ID_FIELD = 'رقم_الموكل';

  /**
   * Fields required today, verified against the ACTUAL saveClient()
   * runtime check in js/modules/clients.js (matches
   * Data_Schema_Specification §4.2 exactly — no discrepancy here).
   */
  var CLIENTS_REQUIRED_FIELDS = ['الاسم'];

  /**
   * Search Fields per Data_Schema_Specification §4.2. Kept for any future
   * caller that wants a scoped, field-limited search via search({search:...})
   * on a subset of fields. NOT used as the default free-text engine below,
   * because the actual current renderClients() searches every field on the
   * record, not just these three (see _matchesSearch override).
   */
  var CLIENTS_SEARCH_FIELDS = ['الاسم', 'الرقم_القومي', 'الهاتف'];

  /** Filter Fields per Data_Schema_Specification §4.2 — matches the only
   *  business dimension documented for Clients filtering (client type). */
  var CLIENTS_FILTER_FIELDS = ['النوع'];

  /** Sort Fields per Data_Schema_Specification §4.2 (proposed — the actual
   *  current renderClients() applies no sort at all, array/insertion order
   *  only, same as Cases). Exposed here for the new sort() convenience
   *  method only. */
  var CLIENTS_SORT_FIELDS = ['الاسم'];

  /**
   * The full set of legacy Arabic/business fields for Clients, used ONLY to
   * replicate the exact legacy free-text search behavior (see
   * _matchesSearch override) without accidentally matching against the new
   * English audit/metadata fields (createdAt, updatedAt, deletedAt,
   * version, syncVersion, checksum) that did not exist in the record shape
   * before this Repository layer — including them in the join would change
   * search results and break "100% Behavior Compatible".
   *
   * Includes, beyond CLIENTS_MAP's 11 form fields (js/modules/clients.js,
   * updated Phase 13.16 to add رقم_التوكيل):
   *   - 'رقم_الموكل'    : the identifier itself (set by saveClient() and
   *                        already part of every real record — included in
   *                        Object.values(c) today, so included here too).
   *   - 'تاريخ_الإنشاء' : creation timestamp stamped by saveClient().
   *   - 'portal_token'  : Portal QR token, set by genClientQR()/
   *                        revokeAndRegenQR() (js/modules/clients.js) — an
   *                        actual field that appears on real client records
   *                        once a portal link has been generated, and is
   *                        therefore part of Object.values(c) for those
   *                        records today.
   */
  var CLIENTS_LEGACY_FIELDS = [
    'رقم_الموكل', 'الاسم', 'النوع', 'الرقم_القومي', 'رقم_التوكيل', 'الهاتف',
    'البريد', 'العنوان', 'الوظيفة', 'جهة_العمل', 'الحالة_الاجتماعية',
    'ملاحظات', 'تاريخ_الإنشاء', 'portal_token'
  ];

  // ================================================================
  // 2. Storage Adapter — DatabaseService-backed (PHASE 8 / SUB-PHASE 8.5.2)
  // ================================================================
  // See file header "WIRING UPDATE" note (added by this phase). Reads/
  // writes the SAME 'clients' key index.html already uses today, in the
  // SAME flat JSON-array shape — LocalStorageAdapter's own default empty
  // keyPrefix guarantees this. Public factory NAME and SIGNATURE are
  // unchanged from the prior phase; only what it builds internally changed
  // (a real DatabaseService + LocalStorageAdapter pair instead of the old
  // hand-rolled ad-hoc {read,write} object).

  /**
   * Builds the Storage Adapter injected into ClientsRepository's underlying
   * Repository base class: a real DatabaseService instance wrapping a real
   * LocalStorageAdapter instance. This satisfies Repository.js's duck-typed
   * contract ({read(entityKey), write(entityKey, records)}) because
   * DatabaseService exposes both methods, each delegating unchanged to the
   * LocalStorageAdapter beneath it — which in turn reads/writes the
   * browser's real localStorage (or an injected localStorage-shaped
   * stand-in) under the exact same key ('clients') the current global
   * `data.clients`/`saveLocal()` already use.
   * @param {Storage} [storageImpl] - optional localStorage-shaped override
   *   (e.g. a test harness's in-memory stand-in). When omitted,
   *   LocalStorageAdapter itself resolves the real global localStorage
   *   lazily, on first read()/write() call (not here, not at construction
   *   time), matching LocalStorageAdapter's own documented lazy-engine-
   *   resolution design.
   * @returns {DatabaseService}
   */
  function createClientsLocalStorageAdapter(storageImpl) {
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
  // private to this module, exactly as CasesRepository.js kept its
  // Storage Adapter self-contained rather than reaching into other files.
  //
  // Verified identical algorithm to js/ui-utils.js:
  //   function uid(){return Date.now().toString(36)+Math.random().toString(36).slice(2,6);}

  function generateClientId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  }

  // ================================================================
  // 4. ClientsRepository — subclass
  // ================================================================

  /**
   * @class ClientsRepository
   * @param {{storageAdapter?: object, idGenerator?: function}} [config] -
   *   Optional overrides (e.g. for tests). Defaults to the
   *   localStorage-backed placeholder adapter and the local uid()-
   *   equivalent generator above.
   */
  function ClientsRepository(config) {
    config = config || {};
    var storageAdapter = config.storageAdapter || createClientsLocalStorageAdapter();
    var idGenerator = typeof config.idGenerator === 'function' ? config.idGenerator : generateClientId;

    Repository.call(this, {
      entityKey: 'clients',
      storageAdapter: storageAdapter,
      idField: CLIENTS_ID_FIELD,
      idGenerator: idGenerator,
      searchFields: CLIENTS_SEARCH_FIELDS,
      softDelete: true, // Data_Schema_Specification §4.2 Delete Rules: soft delete.
      unsupportedOperations: []
    });
  }

  ClientsRepository.prototype = Object.create(Repository.prototype);
  ClientsRepository.prototype.constructor = ClientsRepository;

  // ----------------------------------------------------------------
  // 4.1 Identifier resolution — extension point (see file header
  //     "IDENTIFIER" note)
  // ----------------------------------------------------------------

  /**
   * _resolveId(record) — overrides the base class default. The base
   * class's default (when idField is set) is `return record[idField];`
   * with no generation fallback, correct for Cases (a true user-entered
   * natural key, always present by validation time). Clients' identifier
   * is a HYBRID id (Data_Schema §3.2): generated only when absent, exactly
   * replicating saveClient()'s `obj['رقم_الموكل'] = obj['رقم_الموكل'] ||
   * uid();`. This override is the only behavioral difference from the base
   * class's natural-key resolution path.
   * @param {Object} record
   * @returns {string}
   * @protected
   * @override
   */
  ClientsRepository.prototype._resolveId = function (record) {
    var existing = record ? record[CLIENTS_ID_FIELD] : null;
    return (existing != null && existing !== '') ? existing : this._idGenerator();
  };

  // ----------------------------------------------------------------
  // 4.2 Validation — Repository Contract §9 (extension point)
  // ----------------------------------------------------------------

  /**
   * _validate(operation, record) — overrides the base class no-op hook.
   * Enforces exactly the rule verified in ACTUAL saveClient() today: one
   * required, non-empty (after trim) field. Applies to create/update
   * (delete does not validate field content — Contract §9 default).
   * @protected
   * @override
   */
  ClientsRepository.prototype._validate = function (operation, record) {
    if (operation !== 'create' && operation !== 'update') {
      return { valid: true, errors: [] };
    }
    var errors = [];
    CLIENTS_REQUIRED_FIELDS.forEach(function (field) {
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
  ClientsRepository.prototype.validate = function (record, operation) {
    return this._validate(operation || 'create', record);
  };

  // ----------------------------------------------------------------
  // 4.3 Search — Repository Contract §7 (extension point)
  // ----------------------------------------------------------------

  /**
   * _matchesSearch(record, term) — overrides the base class's
   * searchFields-scoped substring scan to exactly replicate the ACTUAL
   * current renderClients() behavior: `Object.values(c).join(' ')` across
   * every legacy business field (excluding the new audit/metadata fields
   * that did not exist in the record before this Repository layer — see
   * CLIENTS_LEGACY_FIELDS comment above). Required for "100% Behavior
   * Compatible" free-text search once this Repository is eventually wired
   * to replace renderClients()'s inline filter.
   * @protected
   * @override
   */
  ClientsRepository.prototype._matchesSearch = function (record, term) {
    if (!term) return true;
    var needle = String(term).trim().toLowerCase();
    if (!needle) return true;
    var joined = CLIENTS_LEGACY_FIELDS
      .map(function (field) { return record[field] != null ? record[field] : ''; })
      .join(' ')
      .toLowerCase();
    return joined.indexOf(needle) !== -1;
  };

  /**
   * filter(filterObj) — PUBLIC convenience wrapper requested by this
   * phase's instructions. Thin pass-through to search({filter: filterObj}),
   * returning just the matched records (not the full QueryResult envelope)
   * to mirror how renderClients() would consume a filtered array directly.
   * Does not replace or rename search() — additive only.
   * @param {Object} filterObj - Query Model filter object (Contract §7).
   * @returns {Object[]}
   */
  ClientsRepository.prototype.filter = function (filterObj) {
    return this.search({ filter: filterObj }).items;
  };

  // ----------------------------------------------------------------
  // 4.4 Sort — Repository Contract §7 (extension point)
  // ----------------------------------------------------------------

  /**
   * sort(records, sortSpec) — PUBLIC convenience wrapper requested by this
   * phase's instructions. Applies the base class's generic comparator
   * engine (_compareRecords) to an explicit array of records, defaulting
   * sortSpec to CLIENTS_SORT_FIELDS (Data_Schema_Specification §4.2 Sort
   * Fields) when omitted. Does not mutate the input array or replace
   * search()'s own sort option — additive only.
   * @param {Object[]} [records] - defaults to this.getAll() when omitted.
   * @param {Array<{field:string, direction?:'asc'|'desc'}>|{field:string, direction?:'asc'|'desc'}} [sortSpec]
   * @returns {Object[]}
   */
  ClientsRepository.prototype.sort = function (records, sortSpec) {
    var list = Array.isArray(records) ? records.slice() : this.getAll();
    var spec = sortSpec || CLIENTS_SORT_FIELDS.map(function (f) { return { field: f, direction: 'asc' }; });
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
  ClientsRepository.prototype.insert = function (entity) {
    return this.create(entity);
  };

  /**
   * remove(id) -> WriteResult
   * Alias for the inherited, Contract-literal delete(id).
   * @param {string} id
   * @returns {Promise<{success:boolean, record:?Object, error:?Object}>}
   */
  ClientsRepository.prototype.remove = function (id) {
    return this.delete(id);
  };

  // ================================================================
  // 5. Exports
  // ================================================================

  var api = {
    ClientsRepository: ClientsRepository,
    createClientsLocalStorageAdapter: createClientsLocalStorageAdapter
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  if (root) {
    root.ClientsRepository = ClientsRepository;
    root.createClientsLocalStorageAdapter = createClientsLocalStorageAdapter;
  }

})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
