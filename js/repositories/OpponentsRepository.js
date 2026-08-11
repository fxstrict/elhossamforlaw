/**
 * ================================================================
 * OpponentsRepository.js — Opponents (الخصوم) Repository | نظام الحسام
 * ================================================================
 * PHASE 37 — Opponents Module
 *
 * WHAT THIS FILE IS
 *   A new, additive, entity-aware Repository for "الخصوم" (case
 *   opponents / adversaries), built by directly mirroring
 *   js/repositories/ClientsRepository.js (same base class, same
 *   Storage Adapter wiring, same identifier strategy, same validation
 *   style, same free-text search style) — see that file's own header
 *   for the full rationale this file reuses unchanged.
 *
 * WHAT THIS FILE IS NOT
 *   - It does NOT modify js/core/Repository.js, js/core/DatabaseService.js,
 *     js/core/IndexedDBAdapter.js, or js/repositories/ClientsRepository.js.
 *   - It does NOT touch the 'clients' storage/entity key or any other
 *     entity's Repository — 'opponents' is its own, independent
 *     entityKey/localStorage key/IndexedDB store, so there is zero
 *     collision risk with Clients or any other module.
 *
 * IDENTIFIER — 'رقم_الخصم', a hybrid id exactly like Clients'
 *   'رقم_الموكل': generated via a local uid()-equivalent only when
 *   absent on create.
 *
 * VALIDATION — only 'الاسم' (opponent name) is required, matching the
 *   Add-Opponent form's single '*' (required) field, and mirroring
 *   Clients' own single-required-field rule exactly.
 *
 * FIELDS — matches the actual Add-Opponent modal (index.html
 *   #modalOpponent) and js/modules/opponent-fields.js: اسم الخصم،
 *   نوع الخصم، الرقم القومي، الجنسية، رقم جواز السفر، الوظيفة،
 *   جهة العمل، ثم مجموعتان متكرّرتان (أرقام الهواتف / العناوين) بنفس
 *   أسلوب تخزين JSON نصي بعمود واحد المستخدم بالفعل لبيانات الموكل
 *   الموسّعة (client-fields.js) — متوافق 100% مع Google Sheets.
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
      'OpponentsRepository requires js/core/Repository.js to be loaded first ' +
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
      'OpponentsRepository requires js/core/DatabaseService.js to be loaded ' +
      'first (DatabaseService class not found).'
    );
  }
  if (typeof IndexedDBAdapter !== 'function') {
    throw new Error(
      'OpponentsRepository requires js/core/IndexedDBAdapter.js to be ' +
      'loaded first (IndexedDBAdapter class not found).'
    );
  }

  // ================================================================
  // 1. Opponents business knowledge (private to this file)
  // ================================================================

  var OPPONENTS_ID_FIELD = 'رقم_الخصم';

  var OPPONENTS_REQUIRED_FIELDS = ['الاسم'];

  /** Search Fields — mirrors CLIENTS_SEARCH_FIELDS's shape/intent. */
  var OPPONENTS_SEARCH_FIELDS = ['الاسم', 'الرقم_القومي'];

  /** Filter Fields — mirrors CLIENTS_FILTER_FIELDS (opponent type). */
  var OPPONENTS_FILTER_FIELDS = ['النوع'];

  /** Sort Fields — mirrors CLIENTS_SORT_FIELDS. */
  var OPPONENTS_SORT_FIELDS = ['الاسم'];

  /**
   * Full set of legacy/business fields for Opponents, used ONLY to
   * replicate the same "search every business field" behavior Clients
   * uses (see ClientsRepository._matchesSearch), without matching
   * against the new English audit/metadata fields (createdAt,
   * updatedAt, deletedAt, version, syncVersion, checksum).
   */
  var OPPONENTS_LEGACY_FIELDS = [
    'رقم_الخصم', 'الاسم', 'النوع', 'الرقم_القومي', 'الجنسية',
    'رقم_جواز_السفر', 'الوظيفة', 'جهة_العمل',
    'أرقام_الهواتف', 'العناوين', 'تاريخ_الإنشاء'
  ];

  // ================================================================
  // 2. Storage Adapter — DatabaseService-backed, own 'opponents' key
  // ================================================================

  /**
   * Builds the Storage Adapter injected into OpponentsRepository's
   * underlying Repository base class — the exact same DatabaseService +
   * IndexedDBAdapter pairing ClientsRepository uses, just resolving its
   * own independent 'opponents' entity/store (never 'clients').
   * @param {*} [storageImpl] - optional override (test harness).
   * @returns {DatabaseService}
   */
  function createOpponentsLocalStorageAdapter(storageImpl) {
    var adapter = new IndexedDBAdapter(storageImpl ? { engineOptions: { indexedDBImpl: storageImpl } } : {});
    return new DatabaseService(adapter);
  }

  // ================================================================
  // 3. Local uid()-equivalent generator (private to this file)
  // ================================================================
  // Byte-for-byte identical algorithm to js/ui-utils.js's uid(), same
  // self-contained approach ClientsRepository.js already uses.

  function generateOpponentId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  }

  // ================================================================
  // 4. OpponentsRepository — subclass
  // ================================================================

  /**
   * @class OpponentsRepository
   * @param {{storageAdapter?: object, idGenerator?: function}} [config]
   */
  function OpponentsRepository(config) {
    config = config || {};
    var storageAdapter = config.storageAdapter || createOpponentsLocalStorageAdapter();
    var idGenerator = typeof config.idGenerator === 'function' ? config.idGenerator : generateOpponentId;

    Repository.call(this, {
      entityKey: 'opponents',
      storageAdapter: storageAdapter,
      idField: OPPONENTS_ID_FIELD,
      idGenerator: idGenerator,
      searchFields: OPPONENTS_SEARCH_FIELDS,
      softDelete: true,
      unsupportedOperations: []
    });
  }

  OpponentsRepository.prototype = Object.create(Repository.prototype);
  OpponentsRepository.prototype.constructor = OpponentsRepository;

  // ----------------------------------------------------------------
  // 4.1 Identifier resolution
  // ----------------------------------------------------------------
  OpponentsRepository.prototype._resolveId = function (record) {
    var existing = record ? record[OPPONENTS_ID_FIELD] : null;
    return (existing != null && existing !== '') ? existing : this._idGenerator();
  };

  // ----------------------------------------------------------------
  // 4.2 Validation
  // ----------------------------------------------------------------
  OpponentsRepository.prototype._validate = function (operation, record) {
    if (operation !== 'create' && operation !== 'update') {
      return { valid: true, errors: [] };
    }
    var errors = [];
    OPPONENTS_REQUIRED_FIELDS.forEach(function (field) {
      var value = record ? record[field] : undefined;
      var isEmpty = value == null || (typeof value === 'string' && value.trim() === '');
      if (isEmpty) {
        errors.push({ field: field, message: 'الحقل "' + field + '" إلزامي ولا يمكن أن يكون فارغاً.' });
      }
    });
    return { valid: errors.length === 0, errors: errors };
  };

  OpponentsRepository.prototype.validate = function (record, operation) {
    return this._validate(operation || 'create', record);
  };

  // ----------------------------------------------------------------
  // 4.3 Search
  // ----------------------------------------------------------------
  OpponentsRepository.prototype._matchesSearch = function (record, term) {
    if (!term) return true;
    var needle = String(term).trim().toLowerCase();
    if (!needle) return true;
    var joined = OPPONENTS_LEGACY_FIELDS
      .map(function (field) { return record[field] != null ? record[field] : ''; })
      .join(' ')
      .toLowerCase();
    return joined.indexOf(needle) !== -1;
  };

  OpponentsRepository.prototype.filter = function (filterObj) {
    return this.search({ filter: filterObj }).items;
  };

  // ----------------------------------------------------------------
  // 4.4 Sort
  // ----------------------------------------------------------------
  OpponentsRepository.prototype.sort = function (records, sortSpec) {
    var list = Array.isArray(records) ? records.slice() : this.getAll();
    var spec = sortSpec || OPPONENTS_SORT_FIELDS.map(function (f) { return { field: f, direction: 'asc' }; });
    var self = this;
    return list.sort(function (a, b) { return self._compareRecords(a, b, Array.isArray(spec) ? spec : [spec]); });
  };

  // ----------------------------------------------------------------
  // 4.5 Contract-literal convenience aliases
  // ----------------------------------------------------------------
  OpponentsRepository.prototype.insert = function (entity) {
    return this.create(entity);
  };

  OpponentsRepository.prototype.remove = function (id) {
    return this.delete(id);
  };

  // ================================================================
  // 5. Exports
  // ================================================================

  var api = {
    OpponentsRepository: OpponentsRepository,
    createOpponentsLocalStorageAdapter: createOpponentsLocalStorageAdapter,
    OPPONENTS_ID_FIELD: OPPONENTS_ID_FIELD,
    OPPONENTS_REQUIRED_FIELDS: OPPONENTS_REQUIRED_FIELDS,
    OPPONENTS_SEARCH_FIELDS: OPPONENTS_SEARCH_FIELDS,
    OPPONENTS_FILTER_FIELDS: OPPONENTS_FILTER_FIELDS,
    OPPONENTS_SORT_FIELDS: OPPONENTS_SORT_FIELDS,
    OPPONENTS_LEGACY_FIELDS: OPPONENTS_LEGACY_FIELDS
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  if (root) {
    root.OpponentsRepository = OpponentsRepository;
    root.createOpponentsLocalStorageAdapter = createOpponentsLocalStorageAdapter;
  }

})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
