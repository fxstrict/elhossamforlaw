/**
 * ================================================================
 * js/repositories/AgendaMetadataRepository.js — نظام الحسام للمحاماة
 * ================================================================
 * AGENDA-2 — Agenda Metadata (إسناد + حالة تنفيذ) Repository.
 *
 * Backs the new 'agendaMetadata' IndexedDB store (IndexedDBSchema.js
 * version 7) and the new 'أجندة_البيانات_الوصفية' Google Sheet
 * (Config/00_Config.gs SHEET_DEFS). Follows the exact same wired-in
 * pattern as js/repositories/TasksRepository.js: a Repository subclass
 * over DatabaseService(IndexedDBAdapter), entityKey === the store name.
 * Repository.js / DatabaseService.js / IndexedDBAdapter.js are NOT
 * modified — this file only subclasses/uses them.
 *
 * IDENTITY — 'المعرف' is a DETERMINISTIC, caller-computed key:
 *     المعرف = نوع_المصدر + ':' + معرف_المصدر
 * (identical to agendaWorkItemId() in js/modules/office-agenda.js).
 * It is never a random uid. _resolveId() below uses the caller-supplied
 * 'المعرف' when present, otherwise derives it from the two source
 * fields — so one source record can never own two metadata rows.
 *
 * LAZY MIGRATION (closure spec §25) — there is no batch job. A source
 * record has NO metadata row until someone assigns it or changes its
 * execution status; readers treat "no row" as the defaults
 * (حالة_التنفيذ = NOT_STARTED, no assignee). upsertForWorkItem() below
 * creates the row on first write and updates it afterwards.
 *
 * NEVER TOUCHES the source rows: this repository only ever reads/writes
 * agendaMetadata records. Sessions/Tasks/Process Server Works rows are
 * never altered by anything in this file.
 *
 * Load order: after js/core/Repository.js, DatabaseService.js and
 * IndexedDBAdapter.js (same position as TasksRepository.js).
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
    throw new Error('AgendaMetadataRepository requires js/core/Repository.js to be loaded first (Repository base class not found).');
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
    throw new Error('AgendaMetadataRepository requires js/core/DatabaseService.js to be loaded first (DatabaseService class not found).');
  }
  if (typeof IndexedDBAdapter !== 'function') {
    throw new Error('AgendaMetadataRepository requires js/core/IndexedDBAdapter.js to be loaded first (IndexedDBAdapter class not found).');
  }

  // ================================================================
  // 1. Business knowledge (private to this file)
  // ================================================================

  var AGENDA_METADATA_ID_FIELD = 'المعرف';

  /** The three source domains (closure spec §3/§14). */
  var AGENDA_SOURCE_TYPES = ['session', 'administrativeWork', 'processServerWork'];

  /** Agenda execution state machine (closure spec §6) — separate from any source status. */
  var AGENDA_EXECUTION_STATUSES = ['NOT_STARTED', 'IN_PROGRESS', 'BLOCKED', 'COMPLETED'];

  /** Value a reader must assume when a work item has no metadata row yet (§25). */
  var AGENDA_DEFAULT_EXECUTION_STATUS = 'NOT_STARTED';

  function agendaMetadataKey(sourceType, sourceId) {
    return sourceType + ':' + sourceId;
  }

  function isBlank(v) {
    return v == null || (typeof v === 'string' && v.trim() === '');
  }

  // ================================================================
  // 2. Storage Adapter — same construction as TasksRepository
  // ================================================================

  function createAgendaMetadataStorageAdapter(storageImpl) {
    var adapter = new IndexedDBAdapter(storageImpl ? { engineOptions: { indexedDBImpl: storageImpl } } : {});
    return new DatabaseService(adapter);
  }

  // ================================================================
  // 3. AgendaMetadataRepository — subclass
  // ================================================================

  function AgendaMetadataRepository(config) {
    config = config || {};
    var storageAdapter = config.storageAdapter || createAgendaMetadataStorageAdapter();

    Repository.call(this, {
      entityKey: 'agendaMetadata',
      storageAdapter: storageAdapter,
      idField: AGENDA_METADATA_ID_FIELD,
      // The id is always derivable from the record itself (see _resolveId);
      // this generator is only a last-resort so the base class never
      // receives an undefined generator.
      idGenerator: typeof config.idGenerator === 'function'
        ? config.idGenerator
        : function () { return 'agenda:' + Date.now().toString(36); },
      searchFields: ['المعرف', 'نوع_المصدر', 'معرف_المصدر', 'مُسند_إلى', 'حالة_التنفيذ'],
      softDelete: true,
      unsupportedOperations: []
    });
  }

  AgendaMetadataRepository.prototype = Object.create(Repository.prototype);
  AgendaMetadataRepository.prototype.constructor = AgendaMetadataRepository;

  /**
   * _resolveId — caller-supplied 'المعرف' wins; otherwise derived from
   * نوع_المصدر + معرف_المصدر. Never random when the source fields exist.
   * @override
   */
  AgendaMetadataRepository.prototype._resolveId = function (record) {
    if (record && !isBlank(record[AGENDA_METADATA_ID_FIELD])) return record[AGENDA_METADATA_ID_FIELD];
    if (record && !isBlank(record['نوع_المصدر']) && !isBlank(record['معرف_المصدر'])) {
      return agendaMetadataKey(record['نوع_المصدر'], record['معرف_المصدر']);
    }
    return this._idGenerator();
  };

  /**
   * _validate — create/update only.
   *  - نوع_المصدر must be one of the three source types
   *  - معرف_المصدر required
   *  - حالة_التنفيذ (when present) must be one of the four states
   *  - BLOCKED requires a non-empty سبب_التوقف (closure spec §6)
   * @override
   */
  AgendaMetadataRepository.prototype._validate = function (operation, record) {
    if (operation !== 'create' && operation !== 'update') {
      return { valid: true, errors: [] };
    }
    var errors = [];
    var r = record || {};

    if (AGENDA_SOURCE_TYPES.indexOf(r['نوع_المصدر']) === -1) {
      errors.push({ field: 'نوع_المصدر', message: 'نوع_المصدر يجب أن يكون أحد: ' + AGENDA_SOURCE_TYPES.join(' | ') });
    }
    if (isBlank(r['معرف_المصدر'])) {
      errors.push({ field: 'معرف_المصدر', message: 'الحقل "معرف_المصدر" إلزامي ولا يمكن أن يكون فارغاً.' });
    }
    if (!isBlank(r['حالة_التنفيذ']) && AGENDA_EXECUTION_STATUSES.indexOf(r['حالة_التنفيذ']) === -1) {
      errors.push({ field: 'حالة_التنفيذ', message: 'حالة_التنفيذ يجب أن تكون أحد: ' + AGENDA_EXECUTION_STATUSES.join(' | ') });
    }
    ['تاريخ_استحقاق_الأجندة', 'تاريخ_الإجراء_التالي'].forEach(function (dateField) {
      var dv = r[dateField];
      if (!isBlank(dv) && !/^\d{4}-\d{2}-\d{2}$/.test(String(dv).trim())) {
        errors.push({ field: dateField, message: 'الحقل "' + dateField + '" يجب أن يكون تاريخاً بصيغة YYYY-MM-DD.' });
      }
    });
    if (r['حالة_التنفيذ'] === 'BLOCKED' && isBlank(r['سبب_التوقف'])) {
      errors.push({ field: 'سبب_التوقف', message: 'سبب التوقف إلزامي عند الانتقال إلى BLOCKED.' });
    }
    return { valid: errors.length === 0, errors: errors };
  };

  AgendaMetadataRepository.prototype.validate = function (record, operation) {
    return this._validate(operation || 'create', record);
  };

  // ----------------------------------------------------------------
  // 3.1 Agenda convenience API (additive — no Contract method renamed)
  // ----------------------------------------------------------------

  /** getByWorkItemId(id) -> record | null — id is 'sourceType:sourceId'. */
  AgendaMetadataRepository.prototype.getByWorkItemId = function (workItemId) {
    return this.get(workItemId) || null;
  };

  /**
   * upsertForWorkItem(sourceType, sourceId, patch) -> Promise<WriteResult>
   * Lazy creation (§25): creates the row on first write with the default
   * NOT_STARTED status, otherwise updates it. `patch` uses the Arabic
   * column names. Only agendaMetadata is ever written.
   */
  AgendaMetadataRepository.prototype.upsertForWorkItem = function (sourceType, sourceId, patch) {
    var id = agendaMetadataKey(sourceType, sourceId);
    var existing = this.get(id);
    if (existing) {
      return this.update(id, patch || {});
    }
    var base = {};
    base[AGENDA_METADATA_ID_FIELD] = id;
    base['نوع_المصدر'] = sourceType;
    base['معرف_المصدر'] = sourceId;
    base['حالة_التنفيذ'] = AGENDA_DEFAULT_EXECUTION_STATUS;
    base['تاريخ_الإنشاء'] = new Date().toISOString();
    var merged = Object.assign(base, patch || {});
    return this.create(merged);
  };

  // ================================================================
  // 4. Exports
  // ================================================================

  var api = {
    AgendaMetadataRepository: AgendaMetadataRepository,
    createAgendaMetadataStorageAdapter: createAgendaMetadataStorageAdapter,
    AGENDA_SOURCE_TYPES: AGENDA_SOURCE_TYPES,
    AGENDA_EXECUTION_STATUSES: AGENDA_EXECUTION_STATUSES,
    AGENDA_DEFAULT_EXECUTION_STATUS: AGENDA_DEFAULT_EXECUTION_STATUS,
    agendaMetadataKey: agendaMetadataKey
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  if (root) {
    root.AgendaMetadataRepository = AgendaMetadataRepository;
    root.createAgendaMetadataStorageAdapter = createAgendaMetadataStorageAdapter;
  }

})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
