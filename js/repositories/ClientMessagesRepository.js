/**
 * ================================================================
 * ClientMessagesRepository.js — Client Messages/Notes Repository
 * نظام الحسام للمحاماة
 * ================================================================
 * V10 — Offline First Architecture
 * INTEGRATION PHASE — Client Portal Messages Wiring
 *
 * WHAT THIS FILE IS
 *   Wires the "رسائل_الموكل" sheet — already defined in
 *   Config/00_Config.gs's SHEET_DEFS and already read/rendered by
 *   Config/05_Portal.gs's serveClientPortal() — into the SAME
 *   Repository Pattern every other entity in the project uses
 *   (Repository -> DatabaseService -> LocalStorageAdapter/IndexedDB),
 *   so messages the lawyer adds from the app persist locally, survive
 *   offline use, and sync to Google Sheets exactly like every other
 *   entity (cases, tasks, documents, ...).
 *
 *   It follows the exact structural pattern of
 *   js/repositories/TasksRepository.js and
 *   js/repositories/DocumentsRepository.js (both read, not modified):
 *   a thin subclass of js/core/Repository.js with only
 *   Client-Messages-specific knowledge added.
 *
 * WHAT THIS FILE IS NOT
 *   - It does NOT modify js/core/Repository.js or any other
 *     Repository file.
 *   - It does NOT modify Config/00_Config.gs, Config/05_Portal.gs, or
 *     Config/06_Api.gs — the backend already supports this sheet
 *     generically (SHEET_DEFS + the generic add/update/delete/read
 *     API router), so no backend change is required.
 *   - It is inert until wired into index.html (<script> tag) and
 *     consumed by js/modules/client-messages.js.
 *
 * FIELD SHAPE (from Config/00_Config.gs SHEET_DEFS 'رسائل_الموكل'):
 *   id, رقم_الموكل, رقم_القضية, التاريخ, نوع_الرسالة, نص_الرسالة,
 *   رابط_مرفق, اسم_المرفق, ظاهر_للموكل, تاريخ_الإنشاء
 *
 * IDENTIFIER: 'id' — a hybrid id (generated when absent), same
 * strategy as Tasks/Documents/Library/Templates (idField 'id' or a
 * dedicated رقم_* column, always generated client-side via the same
 * uid()-equivalent duplicated independently in every Repository file
 * per the project's existing "no cross-Repository imports" rule).
 *
 * REQUIRED FIELDS: 'رقم_الموكل' (a message must always belong to a
 * specific client) and 'نص_الرسالة' (an empty message is meaningless).
 * 'رقم_القضية' is intentionally optional — a message may target the
 * whole client, not any one specific case (see Config/05_Portal.gs's
 * own doc comment on 'رسائل_الموكل').
 * ================================================================
 */

(function (root) {
  'use strict';

  // Same dual Node/browser resolution shape used by every other
  // Repository file under js/repositories/ (see TasksRepository.js).
  var RepositoryNS = (typeof module !== 'undefined' && module.exports)
    ? require('../core/Repository.js')
    : (typeof window !== 'undefined' ? window : this);

  var Repository = RepositoryNS && RepositoryNS.Repository;

  if (typeof Repository !== 'function') {
    throw new Error(
      'ClientMessagesRepository.js requires js/core/Repository.js to be ' +
      'loaded first (Repository class not found).'
    );
  }

  var DatabaseServiceNS = (typeof module !== 'undefined' && module.exports)
    ? require('../core/DatabaseService.js')
    : (typeof window !== 'undefined' ? window : this);
  var DatabaseService = DatabaseServiceNS && DatabaseServiceNS.DatabaseService;

  var IndexedDBAdapterNS = (typeof module !== 'undefined' && module.exports)
    ? require('../core/IndexedDBAdapter.js')
    : (typeof window !== 'undefined' ? window : this);
  var IndexedDBAdapter = IndexedDBAdapterNS && IndexedDBAdapterNS.IndexedDBAdapter;

  // ================================================================
  // 1. Identifier field + full legacy/business field list
  // ================================================================
  var CLIENT_MESSAGES_ID_FIELD = 'id';

  var CLIENT_MESSAGES_REQUIRED_FIELDS = ['رقم_الموكل', 'نص_الرسالة'];

  /**
   * Full set of business fields for Client Messages — byte-for-byte the
   * same header list Config/00_Config.gs's SHEET_DEFS declares for the
   * 'رسائل_الموكل' sheet, so search/import/export stay in lockstep with
   * the backend sheet shape.
   */
  var CLIENT_MESSAGES_LEGACY_FIELDS = [
    'id', 'رقم_الموكل', 'رقم_القضية', 'التاريخ', 'نوع_الرسالة',
    'نص_الرسالة', 'رابط_مرفق', 'اسم_المرفق', 'ظاهر_للموكل', 'تاريخ_الإنشاء'
  ];

  var CLIENT_MESSAGES_SORT_FIELDS = ['التاريخ'];

  // ================================================================
  // 2. Storage Adapter — DatabaseService-backed (same pattern as every
  //    other entity Repository — see TasksRepository.js §2)
  // ================================================================
  function createClientMessagesLocalStorageAdapter(storageImpl) {
    var adapter = new IndexedDBAdapter(storageImpl ? { engineOptions: { indexedDBImpl: storageImpl } } : {});
    return new DatabaseService(adapter);
  }

  // ================================================================
  // 3. Local uid()-equivalent generator (private to this file — same
  //    duplicated helper every other Repository file defines
  //    independently; see TasksRepository.js §3)
  // ================================================================
  function generateClientMessageId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  }

  // ================================================================
  // 4. ClientMessagesRepository — subclass
  // ================================================================

  /**
   * @class ClientMessagesRepository
   * @param {{storageAdapter?: object, idGenerator?: function}} [config]
   */
  function ClientMessagesRepository(config) {
    config = config || {};
    var storageAdapter = config.storageAdapter || createClientMessagesLocalStorageAdapter();
    var idGenerator = typeof config.idGenerator === 'function' ? config.idGenerator : generateClientMessageId;

    Repository.call(this, {
      entityKey: 'clientMessages',
      storageAdapter: storageAdapter,
      idField: CLIENT_MESSAGES_ID_FIELD,
      idGenerator: idGenerator,
      searchFields: CLIENT_MESSAGES_LEGACY_FIELDS,
      softDelete: true,
      unsupportedOperations: []
    });
  }

  ClientMessagesRepository.prototype = Object.create(Repository.prototype);
  ClientMessagesRepository.prototype.constructor = ClientMessagesRepository;

  // ----------------------------------------------------------------
  // 4.1 Identifier resolution — hybrid id (generated only when absent)
  // ----------------------------------------------------------------
  ClientMessagesRepository.prototype._resolveId = function (record) {
    var existing = record ? record[CLIENT_MESSAGES_ID_FIELD] : null;
    return (existing != null && existing !== '') ? existing : this._idGenerator();
  };

  // ----------------------------------------------------------------
  // 4.2 Validation
  // ----------------------------------------------------------------
  ClientMessagesRepository.prototype._validate = function (operation, record) {
    if (operation !== 'create' && operation !== 'update') {
      return { valid: true, errors: [] };
    }
    var errors = [];
    CLIENT_MESSAGES_REQUIRED_FIELDS.forEach(function (field) {
      var value = record ? record[field] : undefined;
      var isEmpty = value == null || (typeof value === 'string' && value.trim() === '');
      if (isEmpty) {
        errors.push({ field: field, message: 'الحقل "' + field + '" إلزامي ولا يمكن أن يكون فارغاً.' });
      }
    });
    return { valid: errors.length === 0, errors: errors };
  };

  ClientMessagesRepository.prototype.validate = function (record, operation) {
    return this._validate(operation || 'create', record);
  };

  // ----------------------------------------------------------------
  // 4.3 Search
  // ----------------------------------------------------------------
  ClientMessagesRepository.prototype._matchesSearch = function (record, term) {
    if (!term) return true;
    var needle = String(term).trim().toLowerCase();
    if (!needle) return true;
    var joined = CLIENT_MESSAGES_LEGACY_FIELDS
      .map(function (field) { return record[field] != null ? record[field] : ''; })
      .join(' ')
      .toLowerCase();
    return joined.indexOf(needle) !== -1;
  };

  ClientMessagesRepository.prototype.filter = function (filterObj) {
    return this.search({ filter: filterObj }).items;
  };

  /**
   * byClient(clientId) — convenience: all non-deleted messages for one
   * client, matching the exact filter Config/05_Portal.gs's
   * serveClientPortal() applies server-side.
   * @param {string} clientId
   * @returns {Object[]}
   */
  ClientMessagesRepository.prototype.byClient = function (clientId) {
    var needle = String(clientId || '').trim();
    return this.getAll().filter(function (m) {
      return String(m['رقم_الموكل'] || '').trim() === needle;
    });
  };

  // ----------------------------------------------------------------
  // 4.4 Sort
  // ----------------------------------------------------------------
  ClientMessagesRepository.prototype.sort = function (records, sortSpec) {
    var list = Array.isArray(records) ? records.slice() : this.getAll();
    var spec = sortSpec || CLIENT_MESSAGES_SORT_FIELDS.map(function (f) { return { field: f, direction: 'desc' }; });
    var self = this;
    return list.sort(function (a, b) { return self._compareRecords(a, b, Array.isArray(spec) ? spec : [spec]); });
  };

  // ----------------------------------------------------------------
  // 4.5 Contract-literal convenience aliases
  // ----------------------------------------------------------------
  ClientMessagesRepository.prototype.insert = function (entity) {
    return this.create(entity);
  };

  ClientMessagesRepository.prototype.remove = function (id) {
    return this.delete(id);
  };

  // ================================================================
  // 5. Exports
  // ================================================================
  var api = {
    ClientMessagesRepository: ClientMessagesRepository,
    createClientMessagesLocalStorageAdapter: createClientMessagesLocalStorageAdapter
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  if (root) {
    root.ClientMessagesRepository = ClientMessagesRepository;
    root.createClientMessagesLocalStorageAdapter = createClientMessagesLocalStorageAdapter;
  }

})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
