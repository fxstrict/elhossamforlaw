/**
 * ================================================================
 * ProcessServerWorksRepository.js — أعمال المحضرين | نظام الحسام للمحاماة
 * ================================================================
 * PHASE 38 — Process Server Works Module (أعمال المحضرين)
 *
 * WHAT THIS FILE IS
 *   A new, additive, entity-aware Repository for "أعمال المحضرين"
 *   (process-server / bailiff works — إعلانات، تكليفات بالحضور،
 *   إنذارات...), built by directly mirroring
 *   js/repositories/OpponentsRepository.js (same base class, same
 *   Storage Adapter wiring, same identifier strategy, same validation
 *   style, same free-text search style) — see that file's own header
 *   for the full rationale this file reuses unchanged.
 *
 * WHAT THIS FILE IS NOT
 *   - It does NOT modify js/core/Repository.js, js/core/DatabaseService.js,
 *     js/core/IndexedDBAdapter.js, or any sibling *Repository.js.
 *   - It does NOT touch the 'clients'/'cases'/'opponents' storage/entity
 *     keys — 'processServerWorks' is its own, independent
 *     entityKey/localStorage key/IndexedDB store, so there is zero
 *     collision risk with any other module.
 *
 * IDENTIFIER — 'رقم_العمل', a hybrid id exactly like Opponents'
 *   'رقم_الخصم': generated via a local uid()-equivalent only when
 *   absent on create.
 *
 * LINKING — a Process Server Work is linked to exactly ONE client
 *   ('رقم_الموكل', the ClientsRepository id — REQUIRED) and, optionally,
 *   to ONE of that client's cases ('رقم_القضية' — a case number, matched
 *   the exact same way js/modules/clients.js already links cases to
 *   clients: by name text, since 'القضايا' has no formal client-id
 *   column — see js/modules/process-server-works.js for the selector
 *   that only lists cases whose 'اسم_الموكل' matches the chosen client).
 *
 * DOCUMENTS — 'المستندات' stores a JSON array of uploaded-file
 *   descriptors: [{name, fileUrl, fileId, uploadedAt}], uploaded via
 *   ApiService.uploadFile(...) straight into a per-client subfolder of
 *   the "مستندات القضايا" Drive folder (see Config/03_Drive.gs's
 *   getOrCreateClientDocsFolder() and js/modules/process-server-fields.js).
 *
 * CLIENT PORTAL VISIBILITY — 'ظهور_في_بوابة_الموكل' is a tri-state flag
 *   (مخفي | بيانات_فقط | بيانات_ومستندات), read by Config/05_Portal.gs,
 *   defaulting to 'مخفي' (hidden) for safety on any legacy/blank record —
 *   the exact same "default hidden unless explicitly marked visible"
 *   philosophy already used for 'ظاهر_للموكل' on Documents/Tasks.
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
      'ProcessServerWorksRepository requires js/core/Repository.js to be loaded first ' +
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
      'ProcessServerWorksRepository requires js/core/DatabaseService.js to be loaded ' +
      'first (DatabaseService class not found).'
    );
  }
  if (typeof IndexedDBAdapter !== 'function') {
    throw new Error(
      'ProcessServerWorksRepository requires js/core/IndexedDBAdapter.js to be ' +
      'loaded first (IndexedDBAdapter class not found).'
    );
  }

  // ================================================================
  // 1. Process Server Works business knowledge (private to this file)
  // ================================================================

  var PSW_ID_FIELD = 'رقم_العمل';

  /** Only linking a client is mandatory — every other field is optional,
   *  matching the Add-Work modal (only "اختيار الموكل" carries a '*'). */
  var PSW_REQUIRED_FIELDS = ['رقم_الموكل'];

  var PSW_SEARCH_FIELDS = ['طبيعة_الاعلان', 'رقم_المحضرين', 'المحكمة', 'اسم_الموكل'];

  var PSW_FILTER_FIELDS = ['الحالة', 'رقم_الموكل', 'رقم_القضية'];

  var PSW_SORT_FIELDS = ['تاريخ_الإنشاء'];

  /**
   * Full set of legacy/business fields for Process Server Works, used
   * ONLY to replicate the same "search every business field" behavior
   * Clients/Opponents use (see OpponentsRepository._matchesSearch),
   * without matching against the new English audit/metadata fields
   * (createdAt, updatedAt, deletedAt, version, syncVersion, checksum).
   */
  var PSW_LEGACY_FIELDS = [
    'رقم_العمل', 'رقم_الموكل', 'اسم_الموكل', 'رقم_القضية', 'عنوان_القضية',
    'طبيعة_الاعلان', 'رقم_المحضرين', 'المحكمة', 'قلم_المحضرين',
    'تاريخ_التسليم', 'تاريخ_الاستلام', 'تاريخ_الجلسة', 'الحالة',
    'الملاحظات', 'تاريخ_الإنشاء'
  ];

  /** Allowed values for 'الحالة' — matches the list page's tabs
   *  (الكل / مستلم / غير مستلم) in the screenshots supplied. */
  var PSW_STATUS_VALUES = ['مستلم', 'غير مستلم'];

  /** Allowed values for the client-portal visibility tri-state. */
  var PSW_PORTAL_VISIBILITY_VALUES = ['مخفي', 'بيانات_فقط', 'بيانات_ومستندات'];
  var PSW_PORTAL_VISIBILITY_DEFAULT = 'مخفي';

  // ================================================================
  // 2. Storage Adapter — DatabaseService-backed, own storage key
  // ================================================================

  function createProcessServerWorksLocalStorageAdapter(storageImpl) {
    var adapter = new IndexedDBAdapter(storageImpl ? { engineOptions: { indexedDBImpl: storageImpl } } : {});
    return new DatabaseService(adapter);
  }

  // ================================================================
  // 3. Local uid()-equivalent generator (private to this file)
  // ================================================================

  function generatePswId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  }

  // ================================================================
  // 4. ProcessServerWorksRepository — subclass
  // ================================================================

  /**
   * @class ProcessServerWorksRepository
   * @param {{storageAdapter?: object, idGenerator?: function}} [config]
   */
  function ProcessServerWorksRepository(config) {
    config = config || {};
    var storageAdapter = config.storageAdapter || createProcessServerWorksLocalStorageAdapter();
    var idGenerator = typeof config.idGenerator === 'function' ? config.idGenerator : generatePswId;

    Repository.call(this, {
      entityKey: 'processServerWorks',
      storageAdapter: storageAdapter,
      idField: PSW_ID_FIELD,
      idGenerator: idGenerator,
      searchFields: PSW_SEARCH_FIELDS,
      softDelete: true,
      unsupportedOperations: []
    });
  }

  ProcessServerWorksRepository.prototype = Object.create(Repository.prototype);
  ProcessServerWorksRepository.prototype.constructor = ProcessServerWorksRepository;

  // ----------------------------------------------------------------
  // 4.1 Identifier resolution
  // ----------------------------------------------------------------
  ProcessServerWorksRepository.prototype._resolveId = function (record) {
    var existing = record ? record[PSW_ID_FIELD] : null;
    return (existing != null && existing !== '') ? existing : this._idGenerator();
  };

  // ----------------------------------------------------------------
  // 4.2 Validation
  // ----------------------------------------------------------------
  ProcessServerWorksRepository.prototype._validate = function (operation, record) {
    if (operation !== 'create' && operation !== 'update') {
      return { valid: true, errors: [] };
    }
    var errors = [];
    PSW_REQUIRED_FIELDS.forEach(function (field) {
      var value = record ? record[field] : undefined;
      var isEmpty = value == null || (typeof value === 'string' && value.trim() === '');
      if (isEmpty) {
        errors.push({ field: field, message: 'الحقل "' + field + '" إلزامي ولا يمكن أن يكون فارغاً.' });
      }
    });
    return { valid: errors.length === 0, errors: errors };
  };

  ProcessServerWorksRepository.prototype.validate = function (record, operation) {
    return this._validate(operation || 'create', record);
  };

  // ----------------------------------------------------------------
  // 4.3 Search / Filter
  // ----------------------------------------------------------------
  ProcessServerWorksRepository.prototype._matchesSearch = function (record, term) {
    if (!term) return true;
    var needle = String(term).trim().toLowerCase();
    if (!needle) return true;
    var joined = PSW_LEGACY_FIELDS
      .map(function (field) { return record[field] != null ? record[field] : ''; })
      .join(' ')
      .toLowerCase();
    return joined.indexOf(needle) !== -1;
  };

  ProcessServerWorksRepository.prototype.filter = function (filterObj) {
    return this.search({ filter: filterObj }).items;
  };

  // ----------------------------------------------------------------
  // 4.4 Sort — newest first by default (تاريخ_الإنشاء)
  // ----------------------------------------------------------------
  ProcessServerWorksRepository.prototype.sort = function (records, sortSpec) {
    var list = Array.isArray(records) ? records.slice() : this.getAll();
    var spec = sortSpec || PSW_SORT_FIELDS.map(function (f) { return { field: f, direction: 'desc' }; });
    var self = this;
    return list.sort(function (a, b) { return self._compareRecords(a, b, Array.isArray(spec) ? spec : [spec]); });
  };

  // ----------------------------------------------------------------
  // 4.5 Contract-literal convenience aliases
  // ----------------------------------------------------------------
  ProcessServerWorksRepository.prototype.insert = function (entity) {
    return this.create(entity);
  };

  ProcessServerWorksRepository.prototype.remove = function (id) {
    return this.delete(id);
  };

  // ================================================================
  // 5. Exports
  // ================================================================

  var api = {
    ProcessServerWorksRepository: ProcessServerWorksRepository,
    createProcessServerWorksLocalStorageAdapter: createProcessServerWorksLocalStorageAdapter,
    PSW_ID_FIELD: PSW_ID_FIELD,
    PSW_REQUIRED_FIELDS: PSW_REQUIRED_FIELDS,
    PSW_SEARCH_FIELDS: PSW_SEARCH_FIELDS,
    PSW_FILTER_FIELDS: PSW_FILTER_FIELDS,
    PSW_SORT_FIELDS: PSW_SORT_FIELDS,
    PSW_LEGACY_FIELDS: PSW_LEGACY_FIELDS,
    PSW_STATUS_VALUES: PSW_STATUS_VALUES,
    PSW_PORTAL_VISIBILITY_VALUES: PSW_PORTAL_VISIBILITY_VALUES,
    PSW_PORTAL_VISIBILITY_DEFAULT: PSW_PORTAL_VISIBILITY_DEFAULT
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  if (root) {
    root.ProcessServerWorksRepository = ProcessServerWorksRepository;
    root.createProcessServerWorksLocalStorageAdapter = createProcessServerWorksLocalStorageAdapter;
    root.PSW_STATUS_VALUES = PSW_STATUS_VALUES;
    root.PSW_PORTAL_VISIBILITY_VALUES = PSW_PORTAL_VISIBILITY_VALUES;
    root.PSW_PORTAL_VISIBILITY_DEFAULT = PSW_PORTAL_VISIBILITY_DEFAULT;
  }

})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
