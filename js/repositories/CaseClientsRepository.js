/**
 * ================================================================
 * CaseClientsRepository.js — Case<->Client Junction (قضية_موكلين) | نظام الحسام
 * ================================================================
 * CASES_RELATIONSHIP_FINANCIAL — decision §3-C
 *
 * WHAT THIS FILE IS
 *   A new, additive, entity-aware Repository for "قضية_موكلين" — the
 *   real ID-based many-to-many relationship between a Case
 *   (رقم_القضية) and a Client (رقم_الموكل), built by directly
 *   mirroring js/repositories/OpponentsRepository.js (same base class,
 *   same Storage Adapter wiring, same identifier strategy, same
 *   validation style) — see that file's own header for the full
 *   rationale this file reuses unchanged.
 *
 *   Each row is ONE relationship, not an entity: a single case can
 *   have many rows (one per linked client) and a single client can
 *   have many rows (one per case they are linked to). The relationship
 *   itself carries its own data (الصفة، أتعاب_العلاقة) exactly as
 *   confirmed by the reference screenshots (§4.2 of the relationship
 *   audit) — this is why it is a junction Repository and not just an
 *   ID array column on either side.
 *
 * WHAT THIS FILE IS NOT
 *   - It does NOT modify js/core/Repository.js, js/core/DatabaseService.js,
 *     js/core/IndexedDBAdapter.js, ClientsRepository.js, or CasesRepository.js.
 *   - It does NOT touch 'اسم_الموكل' on القضايا (kept for backward
 *     compatibility only — see CasesRepository.js) or any other
 *     entity's Repository — 'caseClients' is its own, independent
 *     entityKey/localStorage key/IndexedDB store.
 *   - It does NOT replace رقم_الخصوم's existing JSON-array pattern for
 *     Case<->Opponent (kept as-is per decision §3-D backward-compat
 *     requirement) — Clients get the richer junction-table treatment
 *     specifically because the reference UI shows per-relationship
 *     fields (الصفة/الأتعاب) for clients that opponents' flow does not
 *     surface identically enough to justify migrating both at once.
 *
 * IDENTIFIER — 'id', a hybrid id exactly like Users'/AuditLog's junction
 *   -style records: generated via a local uid()-equivalent only when
 *   absent on create (the relationship itself has no natural single
 *   -column key — رقم_القضية + رقم_الموكل is a compound uniqueness rule,
 *   enforced at validate()-time below, not as the storage key).
 *
 * VALIDATION — 'رقم_القضية', 'رقم_الموكل', and 'الصفة' are required
 *   (matches the reference screenshots: "الصفة *" is marked required;
 *   "أتعاب القضية" is optional and clients-only per the images).
 *
 * FIELDS — matches SHEET_DEFS['قضية_موكلين'] in Config/00_Config.gs
 *   exactly: id, رقم_القضية, رقم_الموكل, الصفة, أتعاب_العلاقة, الملاحظات,
 *   تاريخ_الإنشاء.
 *
 * Load order: additive file. Depends on js/core/Repository.js,
 * js/core/DatabaseService.js and js/core/IndexedDBAdapter.js having
 * been loaded first (throws a clear error otherwise — see guards
 * below), exactly like every sibling Repository file.
 * ================================================================
 */

(function (root) {
  'use strict';

  var RepositoryNS = (typeof module !== 'undefined' && module.exports)
    ? require('../core/Repository.js')
    : root;

  var Repository = RepositoryNS.Repository;

  if (typeof Repository !== 'function') {
    throw new Error(
      'CaseClientsRepository requires js/core/Repository.js to be loaded first ' +
      '(Repository base class not found).'
    );
  }

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
      'CaseClientsRepository requires js/core/DatabaseService.js to be loaded ' +
      'first (DatabaseService class not found).'
    );
  }
  if (typeof IndexedDBAdapter !== 'function') {
    throw new Error(
      'CaseClientsRepository requires js/core/IndexedDBAdapter.js to be ' +
      'loaded first (IndexedDBAdapter class not found).'
    );
  }

  // ================================================================
  // 1. CaseClients business knowledge (private to this file)
  // ================================================================

  var CASE_CLIENTS_ID_FIELD = 'id';

  var CASE_CLIENTS_REQUIRED_FIELDS = ['رقم_القضية', 'رقم_الموكل', 'الصفة'];

  /** Search Fields — relationship rows are looked up by case/client id, not free text. */
  var CASE_CLIENTS_SEARCH_FIELDS = ['رقم_القضية', 'رقم_الموكل', 'الصفة'];

  /** Filter Fields — filter by case or by client. */
  var CASE_CLIENTS_FILTER_FIELDS = ['رقم_القضية', 'رقم_الموكل'];

  /** Sort Fields. */
  var CASE_CLIENTS_SORT_FIELDS = ['تاريخ_الإنشاء'];

  var CASE_CLIENTS_LEGACY_FIELDS = [
    'id', 'رقم_القضية', 'رقم_الموكل', 'الصفة', 'أتعاب_العلاقة',
    'الملاحظات', 'تاريخ_الإنشاء'
  ];

  // ================================================================
  // 2. Storage Adapter — DatabaseService-backed, own 'caseClients' key
  // ================================================================

  function createCaseClientsLocalStorageAdapter(storageImpl) {
    var adapter = new IndexedDBAdapter(storageImpl ? { engineOptions: { indexedDBImpl: storageImpl } } : {});
    return new DatabaseService(adapter);
  }

  // ================================================================
  // 3. Local uid()-equivalent generator (private to this file)
  // ================================================================
  // Byte-for-byte identical algorithm to js/ui-utils.js's uid(), same
  // self-contained approach OpponentsRepository.js already uses.

  function generateCaseClientId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  }

  // ================================================================
  // 4. CaseClientsRepository — subclass
  // ================================================================

  /**
   * @class CaseClientsRepository
   * @param {{storageAdapter?: object, idGenerator?: function}} [config]
   */
  function CaseClientsRepository(config) {
    config = config || {};
    var storageAdapter = config.storageAdapter || createCaseClientsLocalStorageAdapter();
    var idGenerator = typeof config.idGenerator === 'function' ? config.idGenerator : generateCaseClientId;

    Repository.call(this, {
      entityKey: 'caseClients',
      storageAdapter: storageAdapter,
      idField: CASE_CLIENTS_ID_FIELD,
      idGenerator: idGenerator,
      searchFields: CASE_CLIENTS_SEARCH_FIELDS,
      softDelete: true,
      unsupportedOperations: []
    });
  }

  CaseClientsRepository.prototype = Object.create(Repository.prototype);
  CaseClientsRepository.prototype.constructor = CaseClientsRepository;

  // ----------------------------------------------------------------
  // 4.1 Identifier resolution
  // ----------------------------------------------------------------
  CaseClientsRepository.prototype._resolveId = function (record) {
    var existing = record ? record[CASE_CLIENTS_ID_FIELD] : null;
    return (existing != null && existing !== '') ? existing : this._idGenerator();
  };

  // ----------------------------------------------------------------
  // 4.2 Validation — required fields + compound-uniqueness guard
  // ----------------------------------------------------------------
  CaseClientsRepository.prototype._validate = function (operation, record) {
    if (operation !== 'create' && operation !== 'update') {
      return { valid: true, errors: [] };
    }
    var errors = [];
    CASE_CLIENTS_REQUIRED_FIELDS.forEach(function (field) {
      var value = record ? record[field] : undefined;
      var isEmpty = value == null || (typeof value === 'string' && value.trim() === '');
      if (isEmpty) {
        errors.push({ field: field, message: 'الحقل "' + field + '" إلزامي ولا يمكن أن يكون فارغاً.' });
      }
    });

    // Compound-uniqueness: the same client cannot be linked twice to the
    // same case (would silently duplicate a relationship row). Only
    // enforced when both keys are present (already covered by the
    // required-field check above otherwise) and only against
    // non-deleted rows.
    if (record && record['رقم_القضية'] && record['رقم_الموكل']) {
      var all = this.getAll();
      var dup = all.some(function (r) {
        if (r[CASE_CLIENTS_ID_FIELD] === record[CASE_CLIENTS_ID_FIELD]) { return false; }
        return r['رقم_القضية'] === record['رقم_القضية'] && r['رقم_الموكل'] === record['رقم_الموكل'];
      });
      if (dup) {
        errors.push({ field: 'رقم_الموكل', message: 'هذا الموكل مرتبط بالفعل بهذه القضية.' });
      }
    }

    return { valid: errors.length === 0, errors: errors };
  };

  CaseClientsRepository.prototype.validate = function (record, operation) {
    return this._validate(operation || 'create', record);
  };

  // ----------------------------------------------------------------
  // 4.3 Search / filter
  // ----------------------------------------------------------------
  CaseClientsRepository.prototype._matchesSearch = function (record, term) {
    if (!term) return true;
    var needle = String(term).trim().toLowerCase();
    if (!needle) return true;
    var joined = CASE_CLIENTS_LEGACY_FIELDS
      .map(function (field) { return record[field] != null ? record[field] : ''; })
      .join(' ')
      .toLowerCase();
    return joined.indexOf(needle) !== -1;
  };

  CaseClientsRepository.prototype.filter = function (filterObj) {
    return this.search({ filter: filterObj }).items;
  };

  /**
   * Convenience: every client relationship row for a given case,
   * non-deleted. Mirrors the tab-scoped read pattern already used by
   * sessions.js/tasks.js when scoping by رقم_القضية.
   * @param {string} caseNum
   * @returns {Array<object>}
   */
  CaseClientsRepository.prototype.getByCase = function (caseNum) {
    if (!caseNum) return [];
    return this.getAll().filter(function (r) { return r['رقم_القضية'] === caseNum; });
  };

  /**
   * Convenience: every case relationship row for a given client,
   * non-deleted.
   * @param {string} clientId
   * @returns {Array<object>}
   */
  CaseClientsRepository.prototype.getByClient = function (clientId) {
    if (!clientId) return [];
    return this.getAll().filter(function (r) { return r['رقم_الموكل'] === clientId; });
  };

  // ----------------------------------------------------------------
  // 4.4 Sort
  // ----------------------------------------------------------------
  CaseClientsRepository.prototype.sort = function (records, sortSpec) {
    var list = Array.isArray(records) ? records.slice() : this.getAll();
    var spec = sortSpec || CASE_CLIENTS_SORT_FIELDS.map(function (f) { return { field: f, direction: 'asc' }; });
    var self = this;
    return list.sort(function (a, b) { return self._compareRecords(a, b, Array.isArray(spec) ? spec : [spec]); });
  };

  // ----------------------------------------------------------------
  // 4.5 Contract-literal convenience aliases
  // ----------------------------------------------------------------
  CaseClientsRepository.prototype.insert = function (entity) {
    return this.create(entity);
  };

  CaseClientsRepository.prototype.remove = function (id) {
    return this.delete(id);
  };

  // ================================================================
  // 5. Exports
  // ================================================================

  var api = {
    CaseClientsRepository: CaseClientsRepository,
    createCaseClientsLocalStorageAdapter: createCaseClientsLocalStorageAdapter,
    CASE_CLIENTS_ID_FIELD: CASE_CLIENTS_ID_FIELD,
    CASE_CLIENTS_REQUIRED_FIELDS: CASE_CLIENTS_REQUIRED_FIELDS,
    CASE_CLIENTS_SEARCH_FIELDS: CASE_CLIENTS_SEARCH_FIELDS,
    CASE_CLIENTS_FILTER_FIELDS: CASE_CLIENTS_FILTER_FIELDS,
    CASE_CLIENTS_SORT_FIELDS: CASE_CLIENTS_SORT_FIELDS,
    CASE_CLIENTS_LEGACY_FIELDS: CASE_CLIENTS_LEGACY_FIELDS
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  if (root) {
    root.CaseClientsRepository = CaseClientsRepository;
    root.createCaseClientsLocalStorageAdapter = createCaseClientsLocalStorageAdapter;
  }

})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
