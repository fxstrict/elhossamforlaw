/**
 * ================================================================
 * js/repositories/WorkSheetsRepository.js — نظام الحسام للمحاماة
 * ================================================================
 * AGENDA-3 — Work Sheets (أوراق الشغل).
 *
 * Backs the new 'workSheets' IndexedDB store (IndexedDBSchema.js version
 * 8) and the new 'أوراق_الشغل' Google Sheet (Config/00_Config.gs
 * SHEET_DEFS). Same wired-in pattern as TasksRepository.js /
 * AgendaMetadataRepository.js: a Repository subclass over
 * DatabaseService(IndexedDBAdapter). Repository.js / DatabaseService.js /
 * IndexedDBAdapter.js are NOT modified.
 *
 * REFERENCE-ONLY (closure spec §10) — 'العناصر' stores a de-duplicated
 * JSON array of {sourceType, sourceRecordId} in ONE cell, the exact same
 * convention already used by the 'المستندات' column on
 * Tasks/ProcessServerWorks (JSON.parse(field || '[]')). A Work Sheet
 * NEVER copies or mutates the underlying Session/Task/PSW row, and the
 * same Work Item may legally sit on more than one open sheet (§11).
 *
 * LIFECYCLE (§11) — DRAFT -> ISSUED -> IN_PROGRESS -> SETTLED -> CLOSED,
 * plus CANCELLED (terminal, only from DRAFT or ISSUED). Only
 * transitionState() below performs transitions; _validate() rejects any
 * edge not on this state graph. This file does not decide WHO may call a
 * transition — that is js/modules/office-agenda.js's job via
 * CanCreateWorkSheet / CanAssignAgendaWork / CanCloseWorkSheet.
 *
 * Load order: after js/core/Repository.js, DatabaseService.js and
 * IndexedDBAdapter.js (same position as AgendaMetadataRepository.js).
 * ================================================================
 */

(function (root) {
  'use strict';

  var RepositoryNS = (typeof module !== 'undefined' && module.exports)
    ? require('../core/Repository.js')
    : root;
  var Repository = RepositoryNS.Repository;

  if (typeof Repository !== 'function') {
    throw new Error('WorkSheetsRepository requires js/core/Repository.js to be loaded first (Repository base class not found).');
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
    throw new Error('WorkSheetsRepository requires js/core/DatabaseService.js to be loaded first (DatabaseService class not found).');
  }
  if (typeof IndexedDBAdapter !== 'function') {
    throw new Error('WorkSheetsRepository requires js/core/IndexedDBAdapter.js to be loaded first (IndexedDBAdapter class not found).');
  }

  // ================================================================
  // 1. Business knowledge (private to this file)
  // ================================================================

  var WORK_SHEET_ID_FIELD = 'معرف_الورقة';

  /** §11 state graph — exactly this shape, nothing added/removed. */
  var WORK_SHEET_TRANSITIONS = {
    DRAFT:       ['ISSUED', 'CANCELLED'],
    ISSUED:      ['IN_PROGRESS', 'CANCELLED'],
    IN_PROGRESS: ['SETTLED'],
    SETTLED:     ['CLOSED'],
    CLOSED:      [],
    CANCELLED:   []
  };
  var WORK_SHEET_STATUSES = Object.keys(WORK_SHEET_TRANSITIONS);

  function isBlank(v) { return v == null || (typeof v === 'string' && v.trim() === ''); }

  function generateWorkSheetId() {
    return 'ws:' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  }

  /** Parses the 'العناصر' cell defensively — mirrors tasks.js's own المستندات pattern. */
  function parseItems(raw) {
    if (Array.isArray(raw)) return raw;
    if (isBlank(raw)) return [];
    try {
      var arr = JSON.parse(raw);
      return Array.isArray(arr) ? arr : [];
    } catch (e) {
      return [];
    }
  }

  function itemKey(item) { return item.sourceType + ':' + item.sourceRecordId; }

  /** De-duplicated add — §10 [DECISION]: adding an already-present item is a no-op. */
  function addItemDeduped(list, sourceType, sourceRecordId) {
    var key = sourceType + ':' + sourceRecordId;
    for (var i = 0; i < list.length; i++) {
      if (itemKey(list[i]) === key) return list; // no-op, already present
    }
    return list.concat([{ sourceType: sourceType, sourceRecordId: sourceRecordId }]);
  }

  function removeItemFrom(list, sourceType, sourceRecordId) {
    var key = sourceType + ':' + sourceRecordId;
    return list.filter(function (it) { return itemKey(it) !== key; });
  }

  // ================================================================
  // 2. Storage Adapter
  // ================================================================

  function createWorkSheetsStorageAdapter(storageImpl) {
    var adapter = new IndexedDBAdapter(storageImpl ? { engineOptions: { indexedDBImpl: storageImpl } } : {});
    return new DatabaseService(adapter);
  }

  // ================================================================
  // 3. WorkSheetsRepository — subclass
  // ================================================================

  function WorkSheetsRepository(config) {
    config = config || {};
    var storageAdapter = config.storageAdapter || createWorkSheetsStorageAdapter();
    var idGenerator = typeof config.idGenerator === 'function' ? config.idGenerator : generateWorkSheetId;

    Repository.call(this, {
      entityKey: 'workSheets',
      storageAdapter: storageAdapter,
      idField: WORK_SHEET_ID_FIELD,
      idGenerator: idGenerator,
      searchFields: ['معرف_الورقة', 'المسند_إلى', 'أنشأها', 'الحالة', 'ملاحظات'],
      softDelete: true,
      unsupportedOperations: []
    });
  }

  WorkSheetsRepository.prototype = Object.create(Repository.prototype);
  WorkSheetsRepository.prototype.constructor = WorkSheetsRepository;

  /**
   * _resolveId — the base class default (Repository.js) is
   * `return record[this._idField]`, with NO fallback to the generator
   * when that field is blank (it only falls back when `_idField` itself
   * is unset). A Work Sheet's id is repository-generated, not supplied by
   * the caller (unlike AgendaMetadataRepository's deterministic key), so
   * this override is required — same pattern as TasksRepository.js's own
   * `_resolveId` override, for the same reason.
   * @override
   */
  WorkSheetsRepository.prototype._resolveId = function (record) {
    var existing = record && record[WORK_SHEET_ID_FIELD];
    return (existing != null && existing !== '') ? existing : this._idGenerator();
  };

  /**
   * _validate — create/update only.
   *  - تاريخ_الاستهداف required (§11: "no separate deadline field; تاريخ_الاستهداف serves this role")
   *  - الحالة (when present) must be one of the six states
   *  - العناصر (when present) must be valid JSON array of {sourceType, sourceRecordId}
   * @override
   */
  WorkSheetsRepository.prototype._validate = function (operation, record) {
    if (operation !== 'create' && operation !== 'update') return { valid: true, errors: [] };
    var errors = [];
    var r = record || {};

    if (isBlank(r['تاريخ_الاستهداف'])) {
      errors.push({ field: 'تاريخ_الاستهداف', message: 'الحقل "تاريخ_الاستهداف" إلزامي.' });
    }
    if (!isBlank(r['الحالة']) && WORK_SHEET_STATUSES.indexOf(r['الحالة']) === -1) {
      errors.push({ field: 'الحالة', message: 'الحالة يجب أن تكون أحد: ' + WORK_SHEET_STATUSES.join(' | ') });
    }
    if (r['العناصر'] != null) {
      var items = parseItems(r['العناصر']);
      var bad = items.some(function (it) { return !it || isBlank(it.sourceType) || isBlank(it.sourceRecordId); });
      if (bad) errors.push({ field: 'العناصر', message: 'كل عنصر فى "العناصر" يجب أن يملك sourceType و sourceRecordId.' });
    }
    return { valid: errors.length === 0, errors: errors };
  };

  WorkSheetsRepository.prototype.validate = function (record, operation) {
    return this._validate(operation || 'create', record);
  };

  // ----------------------------------------------------------------
  // 3.1 Work Sheet convenience API (additive — no Contract method renamed)
  // ----------------------------------------------------------------

  WorkSheetsRepository.prototype.getItems = function (sheetOrId) {
    var rec = (typeof sheetOrId === 'string') ? this.get(sheetOrId) : sheetOrId;
    return rec ? parseItems(rec['العناصر']) : [];
  };

  WorkSheetsRepository.prototype.isCreatable = function () { return true; }; // documents the always-creatable DRAFT state

  /** create() convenience — always starts life as DRAFT (§11). */
  WorkSheetsRepository.prototype.createDraft = function (fields) {
    var base = Object.assign({}, fields || {});
    base['الحالة'] = 'DRAFT';
    if (base['العناصر'] == null) base['العناصر'] = '[]';
    else if (Array.isArray(base['العناصر'])) base['العناصر'] = JSON.stringify(base['العناصر']);
    return this.create(base);
  };

  /** addItem() — de-duplicated per §10; allowed while DRAFT/ISSUED/IN_PROGRESS (§11), enforced by the caller. */
  WorkSheetsRepository.prototype.addItem = function (id, sourceType, sourceRecordId) {
    var rec = this.get(id);
    if (!rec) return Promise.resolve({ success: false, error: { message: 'ورقة الشغل غير موجودة' } });
    var items = addItemDeduped(parseItems(rec['العناصر']), sourceType, sourceRecordId);
    return this.update(id, { 'العناصر': JSON.stringify(items) });
  };

  WorkSheetsRepository.prototype.removeItem = function (id, sourceType, sourceRecordId) {
    var rec = this.get(id);
    if (!rec) return Promise.resolve({ success: false, error: { message: 'ورقة الشغل غير موجودة' } });
    var items = removeItemFrom(parseItems(rec['العناصر']), sourceType, sourceRecordId);
    return this.update(id, { 'العناصر': JSON.stringify(items) });
  };

  /**
   * transitionState() — the ONLY way this repository changes 'الحالة'.
   * Rejects any edge not in WORK_SHEET_TRANSITIONS (§11's state graph,
   * verbatim — DRAFT/ISSUED->CANCELLED, linear otherwise, both terminal).
   * `extra` merges additional fields in the same write (e.g. المسند_إلى
   * on issue, ملخص_التسوية on settle).
   */
  WorkSheetsRepository.prototype.transitionState = function (id, toState, extra) {
    var rec = this.get(id);
    if (!rec) return Promise.resolve({ success: false, error: { message: 'ورقة الشغل غير موجودة' } });
    var from = rec['الحالة'];
    var allowed = WORK_SHEET_TRANSITIONS[from] || [];
    if (allowed.indexOf(toState) === -1) {
      return Promise.resolve({
        success: false,
        error: { message: 'انتقال غير مسموح: ' + from + ' → ' + toState }
      });
    }
    var patch = Object.assign({}, extra || {});
    patch['الحالة'] = toState;
    return this.update(id, patch);
  };

  /** Sheets that still have open (non-terminal) items an Agenda item might be flagged as "already on". */
  WorkSheetsRepository.prototype.findOpenSheetsContaining = function (sourceType, sourceRecordId) {
    var key = sourceType + ':' + sourceRecordId;
    return this.getAll().filter(function (ws) {
      if (ws['الحالة'] === 'CLOSED' || ws['الحالة'] === 'CANCELLED') return false;
      return parseItems(ws['العناصر']).some(function (it) { return itemKey(it) === key; });
    });
  };

  // ================================================================
  // 4. Exports
  // ================================================================

  var api = {
    WorkSheetsRepository: WorkSheetsRepository,
    createWorkSheetsStorageAdapter: createWorkSheetsStorageAdapter,
    WORK_SHEET_STATUSES: WORK_SHEET_STATUSES,
    WORK_SHEET_TRANSITIONS: WORK_SHEET_TRANSITIONS,
    parseWorkSheetItems: parseItems
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  if (root) {
    root.WorkSheetsRepository = WorkSheetsRepository;
    root.createWorkSheetsStorageAdapter = createWorkSheetsStorageAdapter;
  }

})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
