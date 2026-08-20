/**
 * ================================================================
 * ExpensesRepository.js — Expenses (المصروفات) Repository | نظام الحسام
 * ================================================================
 * CASES_RELATIONSHIP_FINANCIAL — decision §3-G
 *
 * WHAT THIS FILE IS
 *   A new, additive, entity-aware Repository for "المصروفات" — a
 *   brand-new entity that did not exist anywhere in the project before
 *   this phase (confirmed: no SHEET_DEFS entry, no Repository, no
 *   module). Built by directly mirroring
 *   js/repositories/OpponentsRepository.js (same base class, same
 *   Storage Adapter wiring, same identifier strategy, same validation
 *   style) — see that file's own header for the full rationale this
 *   file reuses unchanged.
 *
 *   Three levels via a single 'النطاق' (scope) column rather than
 *   three separate sheets/stores, mirroring how SHEET_DEFS already
 *   keeps one sheet per entity with scope-style discriminator columns
 *   elsewhere (e.g. أعمال_المحضرين.ظهور_في_بوابة_الموكل):
 *     - 'موكل'  (client)  → رقم_الموكل required, رقم_القضية empty
 *     - 'قضية'  (case)    → رقم_القضية required, رقم_الموكل optional
 *     - 'مكتب'  (office)  → both optional/empty
 *
 * WHAT THIS FILE IS NOT
 *   - It does NOT modify js/core/Repository.js, js/core/DatabaseService.js,
 *     js/core/IndexedDBAdapter.js, or FeesRepository.js.
 *   - It does NOT compute Client Net / Case Net / Office Net itself —
 *     per the binding instruction ("don't compute profit shallowly"),
 *     this Repository only persists well-formed, sourced expense
 *     records; the net-calculation layer is a later, separate
 *     reporting concern (dashboard.js-style) built on top of this and
 *     FeesRepository, not inside either Repository.
 *
 * IDENTIFIER — 'id', generated via a local uid()-equivalent only when
 *   absent on create, matching CaseClientsRepository's junction-style
 *   identifier strategy (this entity has no natural single-column key
 *   either — an expense is identified by itself, not by its scope).
 *
 * VALIDATION — 'النطاق', 'المبلغ', 'التصنيف', and 'التاريخ' are always
 *   required. 'رقم_الموكل' is additionally required when النطاق='موكل'.
 *   'رقم_القضية' is additionally required when النطاق='قضية'. Office
 *   ('مكتب') scope requires neither.
 *
 * FIELDS — matches SHEET_DEFS['المصروفات'] in Config/00_Config.gs
 *   exactly: id, النطاق, رقم_الموكل, رقم_القضية, المبلغ, التصنيف,
 *   المصدر, التاريخ, الحالة, الملاحظات, تاريخ_الإنشاء.
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
      'ExpensesRepository requires js/core/Repository.js to be loaded first ' +
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
      'ExpensesRepository requires js/core/DatabaseService.js to be loaded ' +
      'first (DatabaseService class not found).'
    );
  }
  if (typeof IndexedDBAdapter !== 'function') {
    throw new Error(
      'ExpensesRepository requires js/core/IndexedDBAdapter.js to be ' +
      'loaded first (IndexedDBAdapter class not found).'
    );
  }

  // ================================================================
  // 1. Expenses business knowledge (private to this file)
  // ================================================================

  var EXPENSES_ID_FIELD = 'id';

  var EXPENSES_SCOPES = ['موكل', 'قضية', 'مكتب'];

  var EXPENSES_REQUIRED_FIELDS = ['النطاق', 'المبلغ', 'التصنيف', 'التاريخ'];

  var EXPENSES_SEARCH_FIELDS = ['التصنيف', 'المصدر', 'الملاحظات'];

  var EXPENSES_FILTER_FIELDS = ['النطاق', 'رقم_الموكل', 'رقم_القضية', 'الحالة'];

  var EXPENSES_SORT_FIELDS = ['التاريخ'];

  var EXPENSES_LEGACY_FIELDS = [
    'id', 'النطاق', 'رقم_الموكل', 'رقم_القضية', 'المبلغ', 'التصنيف',
    'المصدر', 'التاريخ', 'الحالة', 'الملاحظات', 'تاريخ_الإنشاء'
  ];

  // ================================================================
  // 2. Storage Adapter — DatabaseService-backed, own 'expenses' key
  // ================================================================

  function createExpensesLocalStorageAdapter(storageImpl) {
    var adapter = new IndexedDBAdapter(storageImpl ? { engineOptions: { indexedDBImpl: storageImpl } } : {});
    return new DatabaseService(adapter);
  }

  // ================================================================
  // 3. Local uid()-equivalent generator (private to this file)
  // ================================================================

  function generateExpenseId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  }

  // ================================================================
  // 4. ExpensesRepository — subclass
  // ================================================================

  /**
   * @class ExpensesRepository
   * @param {{storageAdapter?: object, idGenerator?: function}} [config]
   */
  function ExpensesRepository(config) {
    config = config || {};
    var storageAdapter = config.storageAdapter || createExpensesLocalStorageAdapter();
    var idGenerator = typeof config.idGenerator === 'function' ? config.idGenerator : generateExpenseId;

    Repository.call(this, {
      entityKey: 'expenses',
      storageAdapter: storageAdapter,
      idField: EXPENSES_ID_FIELD,
      idGenerator: idGenerator,
      searchFields: EXPENSES_SEARCH_FIELDS,
      softDelete: true,
      unsupportedOperations: []
    });
  }

  ExpensesRepository.prototype = Object.create(Repository.prototype);
  ExpensesRepository.prototype.constructor = ExpensesRepository;

  // ----------------------------------------------------------------
  // 4.1 Identifier resolution
  // ----------------------------------------------------------------
  ExpensesRepository.prototype._resolveId = function (record) {
    var existing = record ? record[EXPENSES_ID_FIELD] : null;
    return (existing != null && existing !== '') ? existing : this._idGenerator();
  };

  // ----------------------------------------------------------------
  // 4.2 Validation — scope-conditional required fields
  // ----------------------------------------------------------------
  ExpensesRepository.prototype._validate = function (operation, record) {
    if (operation !== 'create' && operation !== 'update') {
      return { valid: true, errors: [] };
    }
    var errors = [];

    EXPENSES_REQUIRED_FIELDS.forEach(function (field) {
      var value = record ? record[field] : undefined;
      var isEmpty = value == null || (typeof value === 'string' && value.trim() === '');
      if (isEmpty) {
        errors.push({ field: field, message: 'الحقل "' + field + '" إلزامي ولا يمكن أن يكون فارغاً.' });
      }
    });

    var scope = record ? record['النطاق'] : undefined;
    if (scope != null && scope !== '' && EXPENSES_SCOPES.indexOf(scope) === -1) {
      errors.push({ field: 'النطاق', message: 'النطاق يجب أن يكون أحد: ' + EXPENSES_SCOPES.join(' / ') + '.' });
    }

    var clientId = record ? record['رقم_الموكل'] : undefined;
    var caseNum = record ? record['رقم_القضية'] : undefined;
    var clientEmpty = clientId == null || (typeof clientId === 'string' && clientId.trim() === '');
    var caseEmpty = caseNum == null || (typeof caseNum === 'string' && caseNum.trim() === '');

    if (scope === 'موكل' && clientEmpty) {
      errors.push({ field: 'رقم_الموكل', message: 'مصروف مستوى "موكل" يتطلب رقم_الموكل.' });
    }
    if (scope === 'قضية' && caseEmpty) {
      errors.push({ field: 'رقم_القضية', message: 'مصروف مستوى "قضية" يتطلب رقم_القضية.' });
    }
    // 'مكتب' scope: neither field required — no additional check.

    return { valid: errors.length === 0, errors: errors };
  };

  ExpensesRepository.prototype.validate = function (record, operation) {
    return this._validate(operation || 'create', record);
  };

  // ----------------------------------------------------------------
  // 4.3 Search / filter
  // ----------------------------------------------------------------
  ExpensesRepository.prototype._matchesSearch = function (record, term) {
    if (!term) return true;
    var needle = String(term).trim().toLowerCase();
    if (!needle) return true;
    var joined = EXPENSES_LEGACY_FIELDS
      .map(function (field) { return record[field] != null ? record[field] : ''; })
      .join(' ')
      .toLowerCase();
    return joined.indexOf(needle) !== -1;
  };

  ExpensesRepository.prototype.filter = function (filterObj) {
    return this.search({ filter: filterObj }).items;
  };

  /**
   * Convenience: every non-deleted expense for a given client, across
   * all scopes where رقم_الموكل is set (client-scope and any
   * case-scope expense that also recorded the paying client).
   * @param {string} clientId
   * @returns {Array<object>}
   */
  ExpensesRepository.prototype.getByClient = function (clientId) {
    if (!clientId) return [];
    return this.getAll().filter(function (r) { return r['رقم_الموكل'] === clientId; });
  };

  /**
   * Convenience: every non-deleted expense for a given case.
   * @param {string} caseNum
   * @returns {Array<object>}
   */
  ExpensesRepository.prototype.getByCase = function (caseNum) {
    if (!caseNum) return [];
    return this.getAll().filter(function (r) { return r['رقم_القضية'] === caseNum; });
  };

  /**
   * Convenience: every non-deleted office-scope expense.
   * @returns {Array<object>}
   */
  ExpensesRepository.prototype.getOfficeExpenses = function () {
    return this.getAll().filter(function (r) { return r['النطاق'] === 'مكتب'; });
  };

  // ----------------------------------------------------------------
  // 4.4 Sort
  // ----------------------------------------------------------------
  ExpensesRepository.prototype.sort = function (records, sortSpec) {
    var list = Array.isArray(records) ? records.slice() : this.getAll();
    var spec = sortSpec || EXPENSES_SORT_FIELDS.map(function (f) { return { field: f, direction: 'desc' }; });
    var self = this;
    return list.sort(function (a, b) { return self._compareRecords(a, b, Array.isArray(spec) ? spec : [spec]); });
  };

  // ----------------------------------------------------------------
  // 4.5 Contract-literal convenience aliases
  // ----------------------------------------------------------------
  ExpensesRepository.prototype.insert = function (entity) {
    return this.create(entity);
  };

  ExpensesRepository.prototype.remove = function (id) {
    return this.delete(id);
  };

  // ================================================================
  // 5. Exports
  // ================================================================

  var api = {
    ExpensesRepository: ExpensesRepository,
    createExpensesLocalStorageAdapter: createExpensesLocalStorageAdapter,
    EXPENSES_ID_FIELD: EXPENSES_ID_FIELD,
    EXPENSES_SCOPES: EXPENSES_SCOPES,
    EXPENSES_REQUIRED_FIELDS: EXPENSES_REQUIRED_FIELDS,
    EXPENSES_SEARCH_FIELDS: EXPENSES_SEARCH_FIELDS,
    EXPENSES_FILTER_FIELDS: EXPENSES_FILTER_FIELDS,
    EXPENSES_SORT_FIELDS: EXPENSES_SORT_FIELDS,
    EXPENSES_LEGACY_FIELDS: EXPENSES_LEGACY_FIELDS
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  if (root) {
    root.ExpensesRepository = ExpensesRepository;
    root.createExpensesLocalStorageAdapter = createExpensesLocalStorageAdapter;
  }

})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
