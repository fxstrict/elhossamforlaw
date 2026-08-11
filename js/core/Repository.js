/**
 * ================================================================
 * Repository.js — Repository Core | نظام الحسام للمحاماة
 * ================================================================
 * V10 — Offline First Architecture
 * PHASE 5 — SUB-PHASE 5.1 — Repository Core
 *
 * Source of design (no assumption outside these — see Input Gap in
 * delivery report):
 *   - Repository_Contract_Report_PHASE2_V10.md   (Repository Contract §3,
 *     Query Model §7, Transaction Model §8, Error Model §10, Lifecycle §11)
 *   - DatabaseService_Design_Report_PHASE3_V10.md (Storage Adapter shape,
 *     Transaction/Cache/Error models on the storage-engine side)
 *   - Data_Schema_Specification_Report_PHASE4_V10.md (Audit/Metadata
 *     fields §3.9/§3.10, Soft Delete §3.7, Record Version §3.8)
 *
 * WHAT THIS FILE IS
 *   A single, storage-agnostic, entity-agnostic Repository BASE CLASS.
 *   It is the one and only wall between a Module and however its data is
 *   actually persisted (localStorage today, IndexedDB/SQLite tomorrow —
 *   Repository_Contract_Report.md §17 "Future SQLite/Cloud Support").
 *
 *   It owns:
 *     - Storage Adapter integration point (dependency, not implementation)
 *     - The full CRUD Interface signatures (Contract §3)
 *     - Validation Hooks   (extension point — no rules defined here)
 *     - Search Hooks       (extension point + generic substring engine)
 *     - Filter Hooks       (extension point + generic equality/range engine)
 *     - Sort Hooks         (extension point + generic comparator engine)
 *     - Transaction Hooks  (extension point around transaction() lifecycle)
 *     - Metadata Hooks     (generic audit-field block, Schema §3.9/§3.10)
 *
 * WHAT THIS FILE IS NOT
 *   - It is NOT CasesRepository, ClientsRepository, SessionsRepository,
 *     ChildrenRepository, DocumentsRepository, TasksRepository,
 *     FeesRepository, LibraryRepository, TemplatesRepository, or
 *     SettingsRepository. None of those exist in this file or this phase.
 *   - It contains NO business logic: no Arabic field names, no FIELDS/MAP
 *     awareness, no entity-specific required-field lists, no case/client/
 *     session/task rules of any kind.
 *   - It does NOT talk to localStorage, IndexedDB, fetch, or ApiService
 *     directly. It only calls whatever Storage Adapter is injected into it.
 *   - It does NOT touch the DOM, toast(), closeModal(), showLoading(),
 *     navigate(), FIELDS, MAP, editIdx, or currentPage.
 *   - It does NOT modify index.html, any Module, any CSS, the Apps Script
 *     backend, or localStorage. This file only defines a class.
 *
 * Load order: additive file, not yet wired into index.html. No existing
 * <script> tag references it. Safe to load anywhere after no dependency
 * (this file has zero dependency on any other project file).
 * ================================================================
 */

(function (root) {
  'use strict';

  // ================================================================
  // 1. Error Model — Repository_Contract_Report.md §10
  // ================================================================
  // Every error a Repository raises is a structured object, never a raw
  // thrown string. Shape: { type, message, field?, entity?, recoverable }

  var RepositoryErrorTypes = Object.freeze({
    VALIDATION: 'ValidationError',
    STORAGE: 'StorageError',
    CONFLICT: 'ConflictError',
    SYNC: 'SyncError',
    PERMISSION: 'PermissionError',
    NETWORK: 'NetworkError',
    UNSUPPORTED_OPERATION: 'UnsupportedOperationError'
  });

  // Error types that are recoverable by default (retry later makes sense).
  // Per Contract §10: recoverable=true for SyncError/NetworkError,
  // recoverable=false for ValidationError. Everything else defaults false
  // unless the caller says otherwise.
  var DEFAULT_RECOVERABLE_TYPES = Object.freeze({
    SyncError: true,
    NetworkError: true
  });

  /**
   * Builds a structured Repository error object (never a bare throw).
   * @param {string} type - one of RepositoryErrorTypes
   * @param {string} message - human-readable description
   * @param {{field?:string, entity?:string, recoverable?:boolean}} [extra]
   * @returns {{type:string, message:string, field:?string, entity:?string, recoverable:boolean}}
   */
  function createRepositoryError(type, message, extra) {
    extra = extra || {};
    return {
      type: type,
      message: message,
      field: extra.field != null ? extra.field : null,
      entity: extra.entity != null ? extra.entity : null,
      recoverable: extra.recoverable != null
        ? extra.recoverable
        : !!DEFAULT_RECOVERABLE_TYPES[type]
    };
  }

  /**
   * Builds a WriteResult — the unified return shape for create/update/
   * delete/clear (Contract §3).
   */
  function createWriteResult(success, record, error) {
    return {
      success: !!success,
      record: record != null ? record : null,
      error: error != null ? error : null
    };
  }

  // ================================================================
  // 2. Storage Adapter Contract (documented, NOT implemented here)
  // ================================================================
  // Repository depends on a Storage Adapter but does not build one.
  // DatabaseService (a separate, later file — see
  // DatabaseService_Design_Report_PHASE3_V10.md) is expected to satisfy
  // this shape. Until then, any object matching this duck-typed contract
  // may be injected (including a throwaway adapter for tests).
  //
  // Required members on the injected adapter:
  //   read(entityKey)              -> Array<Object> | Promise<Array<Object>>
  //   write(entityKey, records)    -> void | Promise<void>
  //
  // Repository never assumes these are synchronous or asynchronous — it
  // always awaits them. This is the entire reason a storage-engine swap
  // (localStorage -> IndexedDB -> SQLite) must never require editing this
  // file (DatabaseService_Design_Report.md §26, last standard).

  var REQUIRED_ADAPTER_METHODS = ['read', 'write'];

  /**
   * Validates (duck-typing only) that an object exposes the minimum
   * Storage Adapter Contract. Throws a structured error, not a bare
   * exception, if the shape is missing.
   * @param {*} adapter
   * @param {string} entityKey
   */
  function assertStorageAdapter(adapter, entityKey) {
    if (!adapter || typeof adapter !== 'object') {
      throw createRepositoryError(
        RepositoryErrorTypes.STORAGE,
        'Repository requires a storageAdapter object (read/write) to be injected.',
        { entity: entityKey, recoverable: false }
      );
    }
    for (var i = 0; i < REQUIRED_ADAPTER_METHODS.length; i++) {
      var method = REQUIRED_ADAPTER_METHODS[i];
      if (typeof adapter[method] !== 'function') {
        throw createRepositoryError(
          RepositoryErrorTypes.STORAGE,
          'storageAdapter is missing required method: ' + method + '()',
          { entity: entityKey, recoverable: false }
        );
      }
    }
  }

  // ================================================================
  // 3. Small internal utilities (generic — no entity awareness)
  // ================================================================

  /** Deep-clones a plain JSON-serializable record so callers never hold
   *  a live reference into the Repository's internal state (Repository
   *  Contract §19: "getAll() returns a copy, never a live reference"). */
  function cloneRecord(record) {
    if (record == null) return record;
    return JSON.parse(JSON.stringify(record));
  }

  function isPlainObject(value) {
    return value != null && typeof value === 'object' && !Array.isArray(value);
  }

  /** Reads a (possibly dotted) field path off a record. Generic — the
   *  base class has no idea which field names exist for any entity. */
  function readField(record, path) {
    if (record == null) return undefined;
    if (path.indexOf('.') === -1) return record[path];
    var parts = path.split('.');
    var cur = record;
    for (var i = 0; i < parts.length; i++) {
      if (cur == null) return undefined;
      cur = cur[parts[i]];
    }
    return cur;
  }

  function toComparable(value) {
    if (value == null) return '';
    if (value instanceof Date) return value.getTime();
    return value;
  }

  // ================================================================
  // 3.1 Undo Manager compatibility check — PHASE 12.3
  // ================================================================
  // Repository.js has zero load-time dependency on UndoManager.js (no
  // require(), no reference to the class outside this one runtime
  // check). Validation is duck-typing first, with a *best-effort*
  // instanceof check only when a global/root `UndoManager` constructor
  // happens to already be loaded (e.g. in the browser, after
  // UndoManager.js's own <script> tag has run) — see
  // Repository_Undo_Hook_Report.md §"Validation Strategy".

  var UNDO_MANAGER_REQUIRED_METHODS = Object.freeze([
    'recordCreate', 'recordUpdate', 'recordDelete', 'recordRestore', 'undo', 'redo'
  ]);

  /**
   * @param {*} manager
   * @returns {boolean} true if `manager` is either an instance of a
   *   globally-available UndoManager constructor, or duck-type
   *   compatible (exposes every method in
   *   UNDO_MANAGER_REQUIRED_METHODS as a function).
   */
  function isUndoManagerCompatible(manager) {
    if (manager == null || typeof manager !== 'object') return false;

    var GlobalUndoManager = root && root.UndoManager;
    if (typeof GlobalUndoManager === 'function' && manager instanceof GlobalUndoManager) {
      return true;
    }

    for (var i = 0; i < UNDO_MANAGER_REQUIRED_METHODS.length; i++) {
      if (typeof manager[UNDO_MANAGER_REQUIRED_METHODS[i]] !== 'function') return false;
    }
    return true;
  }

  // ================================================================
  // 4. Repository — Base Class
  // ================================================================

  /**
   * @class Repository
   *
   * Config shape passed to the constructor:
   * {
   *   entityKey:        string   REQUIRED. Storage-adapter key (e.g. 'cases').
   *   storageAdapter:   object   REQUIRED. Must satisfy the Storage Adapter
   *                              Contract (§2 above).
   *   idField:          string|null  Natural key field name (e.g. Cases'
   *                              'رقم_القضية'), or null to use a generated id
   *                              via idGenerator (default for every other
   *                              entity per Data_Schema §3.2).
   *   idGenerator:      function  Required when idField is null. Produces a
   *                              new id string for create(). Base class does
   *                              NOT define uid() itself (that lives in
   *                              js/ui-utils.js) — it must be injected.
   *   searchFields:     string[]  Field names the generic text-search hook
   *                              scans. Empty by default (no search fields
   *                              known to the base class).
   *   softDelete:       boolean   Default true — delete() sets deletedAt
   *                              instead of removing the record (Data
   *                              Schema §3.7). Set false for a hard-delete
   *                              entity.
   *   unsupportedOperations: string[]  Contract operation names this
   *                              concrete Repository does not support
   *                              (e.g. Calendar/Dashboard disabling
   *                              create/update/delete). Calling one of
   *                              these returns an UnsupportedOperationError
   *                              WriteResult/throw instead of a missing
   *                              method (Contract §3, mandatory note).
   * }
   */
  function Repository(config) {
    config = config || {};

    if (!config.entityKey || typeof config.entityKey !== 'string') {
      throw createRepositoryError(
        RepositoryErrorTypes.STORAGE,
        'Repository requires a non-empty string entityKey.',
        { recoverable: false }
      );
    }
    assertStorageAdapter(config.storageAdapter, config.entityKey);

    if (config.idField == null && typeof config.idGenerator !== 'function') {
      throw createRepositoryError(
        RepositoryErrorTypes.STORAGE,
        'Repository requires either idField (natural key) or an ' +
        'idGenerator function (generated key) — neither was provided.',
        { entity: config.entityKey, recoverable: false }
      );
    }

    this.entityKey = config.entityKey;

    /** @private */ this._storage = config.storageAdapter;
    /** @private */ this._idField = config.idField || null;
    /** @private */ this._idGenerator = config.idGenerator || null;
    /** @private */ this._searchFields = Array.isArray(config.searchFields) ? config.searchFields.slice() : [];
    /** @private */ this._softDelete = config.softDelete !== false;
    /** @private */ this._unsupported = {};
    (config.unsupportedOperations || []).forEach(function (op) {
      this._unsupported[op] = true;
    }, this);

    /** @private in-memory single-source-of-truth for this entity, valid
     *  only after open() (Repository Contract §11: Create → Open → Ready) */
    this._records = [];

    /** @private PHASE 11.4 (Cache_Layer_Design.md / Cache_Layer_Architecture.md):
     *  id -> current index into this._records. A pure, derived, internal
     *  positional index — never persisted, never itself the source of
     *  truth, always re-derivable from this._records via _rebuildIndex().
     *  Valid only after open(), exactly like this._records itself. Kept in
     *  lockstep with every this._records mutation (see each write method
     *  below); on any failure/rollback it is fully rebuilt rather than
     *  incrementally "undone" (Cache_Layer_Design.md §14/§20). */
    this._idIndex = new Map();

    /** @private PHASE 11.4: running count of non-deleted records, kept in
     *  lockstep with this._idIndex. Powers count()'s O(1) fast path for
     *  the common no-filter/no-search case (Cache_Layer_Design.md §6). For
     *  softDelete:false Repositories this always equals this._records.length
     *  (no record can ever be "deleted" there — see _isDeleted()). */
    this._liveCount = 0;

    /** @private lifecycle state — Repository Contract §11 */
    this._state = 'created'; // created -> opening -> open -> ready -> busy/transaction -> closed -> disposed

    /** @private logical write lock — guards against re-entrant writes
     *  while a transaction() is in flight (Contract §11 "Transaction"
     *  state closes other writes on this Repository until done). */
    this._locked = false;

    /** @private PHASE 12.3 (Repository_Undo_Hook_Report.md): optional
     *  UndoManager handle. null by default — undo/redo is entirely
     *  opt-in per Repository instance via setUndoManager(). Repository
     *  never constructs one itself and has zero load-time dependency on
     *  UndoManager.js (validated by duck-typing/instanceof at
     *  setUndoManager()-call time only, not by require()). */
    this._undoManager = null;
  }

  // ----------------------------------------------------------------
  // 4.1 Lifecycle — Repository Contract §11
  // ----------------------------------------------------------------

  /**
   * Opens the Repository: loads the initial in-memory copy from the
   * Storage Adapter. Must be called once before any other operation.
   * @returns {Promise<void>}
   */
  Repository.prototype.open = async function () {
    if (this._state === 'ready' || this._state === 'busy') return;
    this._state = 'opening';
    try {
      var loaded = await this._storage.read(this.entityKey);
      this._records = Array.isArray(loaded) ? loaded : [];
      // PHASE 11.4: build the id index + live count once, from the newly
      // loaded array — the only place a full rebuild is "normal" rather
      // than a failure-path fallback (Cache_Layer_Architecture.md §2).
      this._rebuildIndex();
      this._state = 'open';
      this._state = 'ready';
    } catch (err) {
      this._state = 'closed';
      throw createRepositoryError(
        RepositoryErrorTypes.STORAGE,
        'Failed to open Repository for entity "' + this.entityKey + '": ' + describeError(err),
        { entity: this.entityKey, recoverable: false }
      );
    }
  };

  Repository.prototype.isReady = function () {
    return this._state === 'ready';
  };

  Repository.prototype.getState = function () {
    return this._state;
  };

  /**
   * Closed: no explicit teardown needed in the current single-page,
   * always-on SPA (Contract §11) — reserved for future multi-page/PWA
   * compatibility. Safe no-op today beyond the state transition.
   */
  Repository.prototype.close = function () {
    this._state = 'closed';
  };

  Repository.prototype.dispose = function () {
    this.close();
    this._state = 'disposed';
    this._records = [];
    // PHASE 11.4: no live cache should survive disposal, mirroring _records.
    this._idIndex = new Map();
    this._liveCount = 0;
    // PHASE 12.3: dispose() releases the undo handle too — a disposed
    // Repository holds nothing live, undo included.
    this._undoManager = null;
  };

  // ----------------------------------------------------------------
  // 4.1.1 Undo Manager wiring — Repository Contract extension,
  // PHASE 12.3 (Repository_Undo_Hook_Report.md)
  // ----------------------------------------------------------------
  // Repository remains the public façade: Modules call
  // repository.undo()/redo()/canUndo()/canRedo(), never an UndoManager
  // directly (governing prompt, "GOAL"). This block is the entire
  // surface of that façade — everything below just forwards to
  // whatever manager (if any) is currently wired in, and every write
  // method further down calls the private _recordUndo() helper
  // defined here, after a successful persist only.

  /**
   * Wires (or unwires) an UndoManager for this Repository instance.
   * Repository never constructs one — it is always injected.
   * @param {?Object} manager - an UndoManager instance (or duck-type
   *   compatible object), or null/undefined to remove the current one.
   * @returns {true}
   * @throws {Object} a structured RepositoryErrorTypes.VALIDATION error
   *   (Contract §10 shape) if `manager` is neither null/undefined nor
   *   UndoManager-compatible.
   */
  Repository.prototype.setUndoManager = function (manager) {
    if (manager === null || manager === undefined) {
      this._undoManager = null;
      return true;
    }
    if (!isUndoManagerCompatible(manager)) {
      throw createRepositoryError(
        RepositoryErrorTypes.VALIDATION,
        'setUndoManager() requires an UndoManager instance (or an object ' +
        'exposing recordCreate/recordUpdate/recordDelete/recordRestore/undo/redo ' +
        'as functions), or null/undefined to remove the current manager.',
        { entity: this.entityKey, recoverable: false }
      );
    }
    this._undoManager = manager;
    return true;
  };

  /**
   * @returns {?Object} the currently wired UndoManager, or null if none.
   */
  Repository.prototype.getUndoManager = function () {
    return this._undoManager;
  };

  /**
   * Clears all recorded undo/redo history on the wired UndoManager.
   * A safe no-op if no UndoManager is wired, or if the wired manager
   * has no clear() method.
   * @returns {void}
   */
  Repository.prototype.clearUndoHistory = function () {
    if (this._undoManager && typeof this._undoManager.clear === 'function') {
      this._undoManager.clear();
    }
  };

  /**
   * @returns {boolean} false if no UndoManager is wired (nothing to undo
   *   without one), otherwise the wired manager's own canUndo().
   */
  Repository.prototype.canUndo = function () {
    return !!(this._undoManager &&
      typeof this._undoManager.canUndo === 'function' &&
      this._undoManager.canUndo());
  };

  /**
   * @returns {boolean} false if no UndoManager is wired, otherwise the
   *   wired manager's own canRedo().
   */
  Repository.prototype.canRedo = function () {
    return !!(this._undoManager &&
      typeof this._undoManager.canRedo === 'function' &&
      this._undoManager.canRedo());
  };

  /**
   * Forwards to the wired UndoManager's undo(). Repository itself never
   * applies the returned snapshot instructions to its own records —
   * that reconciliation is explicitly out of scope for this sub-phase
   * (see governing prompt, "GOAL": "NO Module integration"). Returns
   * whatever the manager's undo() returns (null if nothing to undo).
   * @returns {?Object}
   */
  Repository.prototype.undo = function () {
    if (!this._undoManager) return null;
    return this._undoManager.undo();
  };

  /**
   * Forwards to the wired UndoManager's redo(). Same non-mutating
   * contract as undo() above.
   * @returns {?Object}
   */
  Repository.prototype.redo = function () {
    if (!this._undoManager) return null;
    return this._undoManager.redo();
  };

  /**
   * @private Shared call-site for every record*() hook below. Never
   * lets a misbehaving UndoManager break the primary mutation path —
   * a throwing/faulty manager degrades undo/redo only, never data
   * integrity or the caller's WriteResult (Repository_Undo_Hook_Report.md
   * §"Failure Isolation"). No-ops silently if no manager is wired, or if
   * the wired manager doesn't expose `method` as a function (defensive;
   * setUndoManager() already required these methods to exist, so this
   * only guards against a manager mutated after being wired).
   * @param {string} method - one of recordCreate/recordUpdate/recordDelete/recordRestore
   * @param {Array} args
   */
  Repository.prototype._recordUndo = function (method, args) {
    // ACTIVITY RECORDER HOOK — real, cross-refresh, cross-device audit
    // trail (js/core/rbac/ActivityRecorder.js). Placed BEFORE the
    // UndoManager guards below deliberately: not every repository has an
    // undo manager wired (e.g. OpponentsRepository/ClientMessagesRepository/
    // UsersRepository never call setUndoManager()), but every repository
    // DOES call `this._recordUndo(method, args)` from create()/update()/
    // delete()/restore() unconditionally (see those methods further down
    // this file) — so this is the one true universal call site for real
    // activity logging across all entities, regardless of undo-manager
    // wiring. Own try/catch, isolated from the undo-manager block below:
    // a failure here must never affect undo/redo, and vice versa.
    try {
      if (root.HossamActivity && typeof root.HossamActivity.recordFromRepository === 'function') {
        root.HossamActivity.recordFromRepository(this.entityKey, method, args);
      }
    } catch (e2) {
      // Intentionally swallowed — logging must never break a CRUD action.
    }

    if (!this._undoManager) return;
    var fn = this._undoManager[method];
    if (typeof fn !== 'function') return;
    try {
      // BUGFIX ("سجل العمليات غير مرتبطة بالحسابات"): every record*() call
      // below is always invoked with the entry's `metadata` object as the
      // LAST element of `args` (see every _recordUndo() call site further
      // down this file — recordCreate:[record,meta], recordUpdate:
      // [before,after,meta], recordDelete:[before,meta], recordRestore:
      // [before,after,meta]). This stamps WHO performed the action onto
      // that same metadata object, read-only, from the existing
      // `window.HossamSession` session façade (js/core/rbac/
      // SessionContext.js — already the single source of truth the RBAC
      // permission guard uses elsewhere in this file, e.g.
      // _guardPermission()). Fails open exactly like every other optional
      // integration point in this project: if SessionContext.js hasn't
      // loaded, or no user is currently logged in, the metadata object is
      // left exactly as every call site already built it — zero behavior
      // change for those cases. Never mutates the record itself, never
      // touches `before`/`after`.
      var metaArg = args && args.length ? args[args.length - 1] : null;
      if (metaArg && typeof metaArg === 'object') {
        var sessionApi = (typeof root !== 'undefined') ? root.HossamSession : null;
        var currentUser = (sessionApi && typeof sessionApi.getCurrentUser === 'function')
          ? sessionApi.getCurrentUser() : null;
        if (currentUser) {
          metaArg.actorName = currentUser.الاسم || currentUser.اسم_المستخدم || currentUser.id || null;
          metaArg.actorUsername = currentUser.اسم_المستخدم || null;
        }
      }
      fn.apply(this._undoManager, args);
    } catch (e) {
      // Intentionally swallowed — see doc comment above.
    }
  };

  // ----------------------------------------------------------------
  // 4.2 Guard helpers
  // ----------------------------------------------------------------

  /** @private throws UnsupportedOperationError if this concrete
   *  Repository was configured to not support `opName` (Contract §3). */
  Repository.prototype._guardSupported = function (opName) {
    if (this._unsupported[opName]) {
      throw createRepositoryError(
        RepositoryErrorTypes.UNSUPPORTED_OPERATION,
        'Operation "' + opName + '" is not supported by this Repository (' + this.entityKey + ').',
        { entity: this.entityKey, recoverable: false }
      );
    }
  };

  /** @private throws if open() has not completed. Read/write ops are
   *  meaningless before the in-memory copy exists. */
  Repository.prototype._guardReady = function () {
    if (this._state !== 'ready' && this._state !== 'busy') {
      throw createRepositoryError(
        RepositoryErrorTypes.STORAGE,
        'Repository "' + this.entityKey + '" is not ready (state=' + this._state + '). Call open() first.',
        { entity: this.entityKey, recoverable: false }
      );
    }
  };

  /**
   * PHASE 30 — LICENSE READ-ONLY GUARD (additive, fail-open by design)
   * @private throws PermissionError when js/license/ReadOnlyGuard.js has
   * registered itself on window.LicenseReadOnlyGuard AND that guard
   * reports the app is currently in Read-Only mode (expired subscription
   * past its grace period, invalid signature, tampered files, etc. —
   * see docs/phase30). Read operations (getAll/getById/search/...) never
   * call this, only create/update/delete/restore do (per the licensing
   * brief's Read Only Mode section: search/print/export/backup stay
   * allowed). If the guard object is absent entirely (older cached
   * bundle, guard script failed to load, or licensing is simply not part
   * of this build), this is a silent no-op and every Repository behaves
   * exactly as it did before Phase 30 — zero regression for any
   * deployment that doesn't ship the license module.
   */
  Repository.prototype._guardWritable = function (opName) {
    if (root.LicenseReadOnlyGuard && root.LicenseReadOnlyGuard.isReadOnly()) {
      throw createRepositoryError(
        RepositoryErrorTypes.PERMISSION,
        'Operation "' + opName + '" is blocked on "' + this.entityKey + '": the application is in License Read-Only Mode (' + root.LicenseReadOnlyGuard.getReason() + ').',
        { entity: this.entityKey, recoverable: false }
      );
    }
  };

  /**
   * PHASE 31 — RBAC PERMISSION GUARD (additive, fail-open by design)
   * @private throws PermissionError when js/core/rbac/SessionContext.js
   * has registered itself on window.HossamPermissionGuard AND both (a) a
   * current user session is actually set (HossamSession.setCurrentUser()
   * was called — nothing in this project calls it yet, see
   * docs/phase31) and (b) that user's resolved permissions (Roles.js +
   * PermissionGroups.js + individual overrides, via
   * PermissionService.js) do not include the permission this entityKey/
   * opName combination maps to (SessionContext.js's ENTITY_MODULE_MAP).
   * Exactly the same fail-open convention as PHASE 30's
   * `_guardWritable()` immediately above: if `window.HossamPermissionGuard`
   * is absent (older cached bundle, RBAC scripts not loaded, or this
   * simply isn't part of a given build), this is a silent no-op and
   * every Repository behaves exactly as it did before Phase 31 — zero
   * regression. Called from the exact same four call sites as
   * `_guardWritable()` (create/update/delete/restore), immediately after
   * it, so a License Read-Only block is always reported first when both
   * would apply.
   */
  Repository.prototype._guardPermission = function (opName) {
    if (!root.HossamPermissionGuard) return;
    var decision = root.HossamPermissionGuard.check(this.entityKey, opName);
    if (decision && decision.allowed === false) {
      throw createRepositoryError(
        RepositoryErrorTypes.PERMISSION,
        'Operation "' + opName + '" is blocked on "' + this.entityKey + '": ' + (decision.reason || 'permission denied.'),
        { entity: this.entityKey, recoverable: false }
      );
    }
  };

  // ----------------------------------------------------------------
  // 4.3 Metadata Hooks — Data_Schema_Specification §3.9 / §3.10
  // ----------------------------------------------------------------
  // Generic structural audit block. Not business logic: no Arabic field
  // name is read or written here, only the five englist-named audit
  // fields defined project-wide for every real entity's records.

  /**
   * Metadata Hook: stamps/refreshes the audit-field block on a record.
   * Subclasses may override for entity-specific metadata needs, but the
   * default here matches Data_Schema_Specification §3.9/§3.10 exactly.
   * @param {Object} record
   * @param {'create'|'update'} operation
   * @protected
   */
  Repository.prototype._attachMetadata = function (record, operation) {
    var now = new Date().toISOString();
    if (operation === 'create') {
      record.createdAt = now;
      record.updatedAt = now;
      record.deletedAt = record.deletedAt != null ? record.deletedAt : null;
      record.version = 1;
      record.syncVersion = null;
    } else if (operation === 'update') {
      record.updatedAt = now;
      record.version = (typeof record.version === 'number' ? record.version : 0) + 1;
    }
    record.checksum = this._computeChecksum(record);
    return record;
  };

  /**
   * Metadata Hook: lightweight content checksum for Integrity Check use
   * (DatabaseService_Design_Report §14). Deliberately simple (not
   * cryptographic) — a cheap fingerprint, not a security control.
   * @protected
   */
  Repository.prototype._computeChecksum = function (record) {
    var keys = Object.keys(record).filter(function (k) { return k !== 'checksum'; }).sort();
    var str = keys.map(function (k) { return k + '=' + JSON.stringify(record[k]); }).join('|');
    var hash = 0;
    for (var i = 0; i < str.length; i++) {
      hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
    }
    return 'c' + Math.abs(hash).toString(36);
  };

  // ----------------------------------------------------------------
  // 4.4 Validation Hooks — Repository Contract §9 (extension point only)
  // ----------------------------------------------------------------
  // The base class defines NO validation rules (no required fields, no
  // uniqueness, no foreign keys — those are entity/business knowledge).
  // A concrete Repository overrides _validate() to add real rules.

  /**
   * Validation Hook. Default: always valid. Concrete Repositories
   * override this to enforce required fields, uniqueness, business
   * rules, etc. (Repository Contract §9).
   * @param {'create'|'update'|'delete'|'import'} operation
   * @param {Object} record
   * @returns {{valid: boolean, errors: Array<{field?:string, message:string}>}}
   * @protected
   */
  Repository.prototype._validate = function (operation, record) {
    return { valid: true, errors: [] };
  };

  // ----------------------------------------------------------------
  // 4.5 Filter Hooks — Repository Contract §7 (Query Model)
  // ----------------------------------------------------------------
  // Generic filter engine: equality by default, {op,value} for ranges,
  // and {and:[...]} / {or:[...]} for compound filters. No field name is
  // hardcoded — entirely data-driven by whatever filter object a Module
  // supplies through search()/count().

  /**
   * Filter Hook: does `record` match `filter`? Concrete Repositories may
   * override for entity-specific filter shortcuts, but the default
   * engine below already covers equality, range operators, and AND/OR
   * composition per Query Model §7.
   * @protected
   */
  Repository.prototype._matchesFilter = function (record, filter) {
    if (filter == null) return true;

    if (Array.isArray(filter.and)) {
      return filter.and.every(function (f) { return this._matchesFilter(record, f); }, this);
    }
    if (Array.isArray(filter.or)) {
      return filter.or.some(function (f) { return this._matchesFilter(record, f); }, this);
    }

    var self = this;
    return Object.keys(filter).every(function (field) {
      var expected = filter[field];
      var actual = readField(record, field);

      if (isPlainObject(expected) && ('op' in expected)) {
        return self._applyFilterOperator(actual, expected.op, expected.value);
      }
      if (Array.isArray(expected)) {
        // implicit $in shorthand: field: [a, b, c]
        return expected.indexOf(actual) !== -1;
      }
      return actual === expected;
    });
  };

  /** @private evaluates a single range/comparison operator. */
  Repository.prototype._applyFilterOperator = function (actual, op, value) {
    var a = toComparable(actual);
    var v = toComparable(value);
    switch (op) {
      case 'eq': return a === v;
      case 'ne': return a !== v;
      case 'gt': return a > v;
      case 'gte': return a >= v;
      case 'lt': return a < v;
      case 'lte': return a <= v;
      case 'in': return Array.isArray(value) && value.indexOf(actual) !== -1;
      case 'between':
        return Array.isArray(value) && value.length === 2 &&
          a >= toComparable(value[0]) && a <= toComparable(value[1]);
      default:
        return false;
    }
  };

  // ----------------------------------------------------------------
  // 4.6 Search Hooks — Repository Contract §7 (Query Model — Search)
  // ----------------------------------------------------------------

  /**
   * Search Hook: does `record` match free-text `term`? Default is a
   * case-insensitive substring scan across this._searchFields (injected
   * by the concrete Repository — the base class knows no field names).
   * @protected
   */
  Repository.prototype._matchesSearch = function (record, term) {
    if (!term) return true;
    if (!this._searchFields.length) return false;
    var needle = String(term).trim().toLowerCase();
    if (!needle) return true;
    return this._searchFields.some(function (field) {
      var value = readField(record, field);
      if (value == null) return false;
      return String(value).toLowerCase().indexOf(needle) !== -1;
    });
  };

  // ----------------------------------------------------------------
  // 4.7 Sort Hooks — Repository Contract §7 (Query Model — Sort)
  // ----------------------------------------------------------------

  /**
   * Sort Hook: generic multi-field comparator. sortSpec is an array of
   * {field, direction:'asc'|'desc'}. No field name is hardcoded.
   * @protected
   */
  Repository.prototype._compareRecords = function (a, b, sortSpec) {
    if (!Array.isArray(sortSpec) || !sortSpec.length) return 0;
    for (var i = 0; i < sortSpec.length; i++) {
      var spec = sortSpec[i];
      var field = spec.field;
      var dir = spec.direction === 'desc' ? -1 : 1;
      var av = toComparable(readField(a, field));
      var bv = toComparable(readField(b, field));
      if (av < bv) return -1 * dir;
      if (av > bv) return 1 * dir;
    }
    return 0;
  };

  // ----------------------------------------------------------------
  // 4.8 Transaction Hooks — Repository Contract §8
  // ----------------------------------------------------------------
  // No-op by default; concrete Repositories (or cross-cutting concerns
  // like logging) may override to observe transaction lifecycle without
  // touching the transaction() implementation itself.

  /** @protected called before a transaction()'s ops begin executing. */
  Repository.prototype._beforeTransaction = function (ops) {};

  /** @protected called after a successful commit. */
  Repository.prototype._afterCommit = function (result) {};

  /** @protected called when a transaction is rolled back. */
  Repository.prototype._onRollback = function (error) {};

  // ----------------------------------------------------------------
  // 4.9 Internal write plumbing
  // ----------------------------------------------------------------

  /** @private resolves the id for a record: natural key field if
   *  configured, otherwise the injected id generator. */
  Repository.prototype._resolveId = function (record) {
    if (this._idField) return record[this._idField];
    if (record.id != null) return record.id;
    return this._idGenerator();
  };

  /** @private PHASE 11.4 (Cache_Layer_Design.md §3/§4, Cache_Layer_Architecture.md §2):
   *  fully re-derives this._idIndex and this._liveCount from the current
   *  this._records array. O(n). This is the ONLY place the cache is ever
   *  treated as independently authoritative state to reconcile — every
   *  other mutation site either patches the cache incrementally (O(1)) or
   *  calls this method (Cache_Layer_Design.md §20: "the id-index is always
   *  treated as fully derivable, never as independently authoritative,
   *  state"). Safe to call at any time this._records is itself valid
   *  (i.e. after open()); never touches the Storage Adapter. */
  Repository.prototype._rebuildIndex = function () {
    var idField = this._idField || 'id';
    var idx = new Map();
    var live = 0;
    for (var i = 0; i < this._records.length; i++) {
      var recId = this._records[i][idField];
      // Guarded with .has(): if a duplicate id exists anywhere in
      // this._records (only reachable via bulkInsert()'s pre-existing
      // lack of a duplicate-id check — see that method's own comment),
      // the FIRST occurrence's position must win, matching exactly what
      // a linear re-scan (the pre-cache _indexOf() implementation) would
      // have returned. An unconditional .set() here would let the LAST
      // occurrence silently win instead — a real behavioral divergence,
      // not just a style choice.
      if (!idx.has(recId)) idx.set(recId, i);
      if (!this._isDeleted(this._records[i])) live++;
    }
    this._idIndex = idx;
    this._liveCount = live;
  };

  /** @private finds the array index for a given id, respecting the
   *  configured id field. Returns -1 if not found.
   *
   *  PHASE 11.4 (Cache_Layer_Design.md/Cache_Layer_Architecture.md): now an
   *  O(1)-average Map lookup against this._idIndex instead of an O(n)
   *  linear scan. This single change is what accelerates every call site
   *  that already used _indexOf() — get(), exists(), update(), delete(),
   *  restore(), create()'s duplicate check, and every per-item iteration
   *  of bulkUpdate()/bulkDelete()/import('merge') — with zero change to
   *  any of those methods' own code. Behavior (return value for every
   *  input) is byte-for-byte identical to the prior linear-scan
   *  implementation, provided this._idIndex is kept correctly in sync
   *  with this._records at every mutation site (see each write method
   *  below, and _rebuildIndex() above for the failure-path fallback). */
  Repository.prototype._indexOf = function (id) {
    var idx = this._idIndex.get(id);
    return idx === undefined ? -1 : idx;
  };

  Repository.prototype._isDeleted = function (record) {
    return this._softDelete && record && record.deletedAt != null;
  };

  /** @private persists the full current in-memory array through the
   *  Storage Adapter. This is the ONLY place this class touches the
   *  adapter's write() — everything else mutates this._records first. */
  Repository.prototype._persist = async function () {
    try {
      await this._storage.write(this.entityKey, this._records);
    } catch (err) {
      throw createRepositoryError(
        RepositoryErrorTypes.STORAGE,
        'Failed to persist entity "' + this.entityKey + '": ' + describeError(err),
        { entity: this.entityKey, recoverable: false }
      );
    }
  };

  function describeError(err) {
    if (err == null) return 'unknown error';
    if (typeof err === 'string') return err;
    if (err.message) return err.message;
    try { return JSON.stringify(err); } catch (e) { return String(err); }
  }

  // ================================================================
  // 5. CRUD Interface — Repository Contract §3
  // ================================================================
  // Every signature in the Contract table exists here, even the ones a
  // given concrete Repository won't logically use (e.g. Dashboard has no
  // create()) — those are disabled per-instance via `unsupportedOperations`
  // in the constructor config, not by omitting the method (Contract §3,
  // mandatory note).

  // ---- Writes: Validate -> Write Local (sync to memory) -> Persist ----

  /**
   * create(entity) -> WriteResult
   * @param {Object} entity
   * @returns {Promise<{success:boolean, record:?Object, error:?Object}>}
   */
  Repository.prototype.create = async function (entity) {
    this._guardSupported('create');
    this._guardReady();
    this._guardWritable('create');
    this._guardPermission('create');

    var validation = this._validate('create', entity);
    if (!validation.valid) {
      return createWriteResult(false, null, createRepositoryError(
        RepositoryErrorTypes.VALIDATION,
        'Validation failed for create() on "' + this.entityKey + '".',
        { entity: this.entityKey, field: validation.errors[0] && validation.errors[0].field, recoverable: false }
      ));
    }

    var record = cloneRecord(entity) || {};
    var id = this._resolveId(record);
    if (this._idField) record[this._idField] = id; else record.id = id;

    if (this._indexOf(id) !== -1) {
      return createWriteResult(false, null, createRepositoryError(
        RepositoryErrorTypes.CONFLICT,
        'A record with id "' + id + '" already exists in "' + this.entityKey + '".',
        { entity: this.entityKey, recoverable: false }
      ));
    }

    this._attachMetadata(record, 'create');
    this._state = 'busy';
    this._records.push(record);
    // PHASE 11.4: O(1) incremental index insert — a create() always appends
    // at the end, so the new record's position is simply the new length-1.
    // A freshly-created record is never soft-deleted (_attachMetadata's
    // 'create' branch only preserves an already-null/absent deletedAt —
    // see below), so this always increments _liveCount.
    var newIdx = this._records.length - 1;
    this._idIndex.set(id, newIdx);
    if (!this._isDeleted(record)) this._liveCount++;
    try {
      await this._persist();
    } catch (err) {
      this._records.pop();
      // PHASE 11.4: precise O(1) revert — undo exactly the two mutations
      // just made above, mirroring the this._records.pop() rollback.
      this._idIndex.delete(id);
      if (!this._isDeleted(record)) this._liveCount--;
      this._state = 'ready';
      return createWriteResult(false, null, err);
    }
    this._state = 'ready';
    // PHASE 12.3: recorded after successful persist only (never before,
    // never on the rollback path above).
    this._recordUndo('recordCreate', [cloneRecord(record), { entity: this.entityKey, op: 'create' }]);
    return createWriteResult(true, cloneRecord(record), null);
  };

  /**
   * @private Shared update-staging logic (PHASE 11.2.1, T-10 fix —
   * Transaction_Consistency_Report.md). This is the SINGLE place that
   * implements: the FIX 1/2 (Phase 11.2) soft-delete guard (rejects a
   * soft-deleted target unless `allowDeleted` is true), the patch/merge
   * (preserving the id field), and `_validate('update', merged)`.
   *
   * update(), bulkUpdate(), and transaction()'s {op:'update'} step all
   * call this instead of maintaining three parallel copies of this logic
   * — the exact defect (T-10) this sub-phase fixes. Never throws; callers
   * decide how to surface failure (WriteResult for update()/bulkUpdate(),
   * a thrown error for transaction()'s rollback-by-exception model).
   *
   * @param {Object} existing - current in-memory record (this._records[idx] or a transaction's working[idx])
   * @param {Object} patch
   * @param {boolean} allowDeleted
   * @param {string} label - human-readable call-site context for error messages, e.g. 'update()', 'bulkUpdate() item #2', 'transaction() step #0 (update)'
   * @returns {{ok:boolean, merged:?Object, error:?Object}}
   */
  Repository.prototype._stageUpdate = function (existing, patch, allowDeleted, label) {
    var idField = this._idField || 'id';

    if (!allowDeleted && this._isDeleted(existing)) {
      return {
        ok: false, merged: null,
        error: createRepositoryError(
          RepositoryErrorTypes.CONFLICT,
          'Cannot update record with id "' + existing[idField] + '" in "' + this.entityKey + '" — record is soft-deleted. Restore it first, or pass {allowDeleted:true} to modify it while deleted.',
          { entity: this.entityKey, recoverable: true }
        )
      };
    }

    var merged = Object.assign({}, existing, cloneRecord(patch) || {});
    merged[idField] = existing[idField];

    var validation = this._validate('update', merged);
    if (!validation.valid) {
      return {
        ok: false, merged: null,
        error: createRepositoryError(
          RepositoryErrorTypes.VALIDATION,
          'Validation failed for ' + label + ' on "' + this.entityKey + '".',
          { entity: this.entityKey, field: validation.errors[0] && validation.errors[0].field, recoverable: false }
        )
      };
    }

    return { ok: true, merged: merged, error: null };
  };

  /**
   * update(id, patch, options?) -> WriteResult
   * FIX 1 (PHASE 11.2, Repository_API_Consistency_Report.md): by default,
   * update() now refuses to modify a soft-deleted record (previously an
   * undocumented asymmetry vs. delete()/restore() — Phase11_Validation_
   * Report.md, "Documented Asymmetry" #1). Pass `{allowDeleted:true}` to
   * explicitly opt into modifying a soft-deleted record's fields without
   * un-hiding it (the pre-11.2 behavior, now opt-in instead of implicit).
   *
   * PHASE 11.2.1: guard/merge/validate logic now lives in the shared
   * `_stageUpdate()` helper (see above) instead of being duplicated here.
   * @param {string} id
   * @param {Object} patch
   * @param {{allowDeleted?:boolean}} [options]
   * @returns {Promise<{success:boolean, record:?Object, error:?Object}>}
   */
  Repository.prototype.update = async function (id, patch, options) {
    this._guardSupported('update');
    this._guardReady();
    this._guardWritable('update');
    this._guardPermission('update');

    var idx = this._indexOf(id);
    if (idx === -1) {
      return createWriteResult(false, null, createRepositoryError(
        RepositoryErrorTypes.VALIDATION,
        'No record with id "' + id + '" in "' + this.entityKey + '".',
        { entity: this.entityKey, recoverable: false }
      ));
    }

    var existing = this._records[idx];
    var allowDeleted = !!(options && options.allowDeleted);
    var staged = this._stageUpdate(existing, patch, allowDeleted, 'update()');
    if (!staged.ok) {
      return createWriteResult(false, null, staged.error);
    }

    var merged = staged.merged;
    this._attachMetadata(merged, 'update');
    this._state = 'busy';
    var previous = this._records[idx];
    // PHASE 11.4: update() never changes an id or an array position, so
    // this._idIndex needs no mutation here. this._liveCount, however, CAN
    // change in the one narrow case FIX 1's own doc comment already
    // documents: {allowDeleted:true} plus a patch that itself touches
    // deletedAt (e.g. clearing it) — the only remaining way update() can
    // affect deletedAt. Computed once, applied on success, precisely
    // reverted on failure (Cache_Layer_Design.md §12/§20 "precise O(1)
    // revert" philosophy — no array shift occurred, so no full rebuild is
    // needed here).
    var wasDeleted = this._isDeleted(previous);
    var isDeletedNow = this._isDeleted(merged);
    var liveDelta = wasDeleted === isDeletedNow ? 0 : (isDeletedNow ? -1 : 1);
    this._records[idx] = merged;
    this._liveCount += liveDelta;
    try {
      await this._persist();
    } catch (err) {
      this._records[idx] = previous;
      this._liveCount -= liveDelta;
      this._state = 'ready';
      return createWriteResult(false, null, err);
    }
    this._state = 'ready';
    // PHASE 12.3: recorded after successful persist only.
    this._recordUndo('recordUpdate', [cloneRecord(previous), cloneRecord(merged), { entity: this.entityKey, op: 'update' }]);
    return createWriteResult(true, cloneRecord(merged), null);
  };

  /**
   * delete(id) -> WriteResult
   * Soft-delete by default (Data_Schema_Specification §3.7: sets
   * deletedAt, record remains in storage, excluded from getAll()/search()
   * by default). Hard-delete when configured with softDelete:false.
   * @param {string} id
   * @returns {Promise<{success:boolean, record:?Object, error:?Object}>}
   */
  Repository.prototype.delete = async function (id) {
    this._guardSupported('delete');
    this._guardReady();
    this._guardWritable('delete');
    this._guardPermission('delete');

    var idx = this._indexOf(id);
    if (idx === -1) {
      return createWriteResult(false, null, createRepositoryError(
        RepositoryErrorTypes.VALIDATION,
        'No record with id "' + id + '" in "' + this.entityKey + '".',
        { entity: this.entityKey, recoverable: false }
      ));
    }

    this._state = 'busy';
    var previous = this._records[idx];
    var removedRecord;
    // PHASE 11.4: delete() has no "already deleted" guard (pre-existing,
    // unchanged behavior — calling delete() again on an already
    // soft-deleted record just re-stamps deletedAt/version). Capture
    // whether it was live BEFORE mutating so _liveCount only decrements
    // once per genuine live->deleted transition, never on a repeat call.
    var wasLive = !this._isDeleted(previous);

    if (this._softDelete) {
      var softDeleted = Object.assign({}, previous);
      softDeleted.deletedAt = new Date().toISOString();
      this._attachMetadata(softDeleted, 'update');
      this._records[idx] = softDeleted;
      removedRecord = softDeleted;
      // Same array position, same id -> this._idIndex needs no mutation.
      if (wasLive) this._liveCount--;
    } else {
      this._records.splice(idx, 1);
      removedRecord = previous;
      // Hard-delete shifts every subsequent record's array position by
      // one, so an incremental patch would need to touch every entry
      // after idx — a full rebuild is simplest, correct, and the same
      // O(n) order the splice() itself already is
      // (Cache_Layer_Design.md §4/§9; zero of the 9 real entity
      // Repositories are configured with softDelete:false, so this path
      // has no production exposure today — Cache_Layer_Implementation_
      // Report.md "Risk Assessment").
      this._rebuildIndex();
    }

    try {
      await this._persist();
    } catch (err) {
      this._records[idx] = previous; // works for both branches: splice case re-inserts below
      if (!this._softDelete) this._records.splice(idx, 0, previous);
      // PHASE 11.4: reconcile the cache with whatever this._records now
      // actually contains. For the soft-delete branch this restores the
      // live/deleted counter precisely (O(1)); for the hard-delete branch
      // — which just re-spliced previous back in above, at whatever
      // position the pre-existing rollback logic leaves it — a full
      // rebuild guarantees the index exactly mirrors the real array
      // regardless of that logic's own pre-existing shape (this phase
      // does not alter pre-existing rollback behavior, only keeps the
      // cache truthful to it — see Cache_Layer_Implementation_Report.md
      // "Known Pre-Existing Behavior").
      if (this._softDelete) { if (wasLive) this._liveCount++; }
      else { this._rebuildIndex(); }
      this._state = 'ready';
      return createWriteResult(false, null, err);
    }
    this._state = 'ready';
    // PHASE 12.3: recorded after successful persist only. `previous` is
    // the record's state prior to deletion (soft or hard) — exactly what
    // recordDelete()'s `before` parameter documents.
    this._recordUndo('recordDelete', [cloneRecord(previous), { entity: this.entityKey, op: 'delete', softDelete: this._softDelete }]);
    return createWriteResult(true, cloneRecord(removedRecord), null);
  };

  /**
   * restore(id) -> WriteResult
   * Clears a soft-deleted record's `deletedAt`, making it visible again to
   * get()/getAll()/search()/count() (Restore_System_Design.md §1-6, T-01).
   * Symmetric with delete(): mutates a copy of the existing record directly
   * (does NOT call update(), so no _validate('update', ...) rules run —
   * Restore_System_Design.md §3) via the same _attachMetadata(record,
   * 'update') call delete() itself already uses (§3), then persists the
   * full array exactly like every other write.
   *
   * Idempotent (Restore_System_Design.md §1/§3): calling restore() on a
   * record that is already live (deletedAt == null) returns success with
   * no metadata mutation and no persist() call — not an error condition.
   *
   * Not supported when this._softDelete is false (Restore_System_Design.md
   * §2): a hard-delete Repository has nothing to restore, since delete()
   * already removed the record from _records entirely.
   * @param {string} id
   * @returns {Promise<{success:boolean, record:?Object, error:?Object}>}
   */
  Repository.prototype.restore = async function (id) {
    this._guardSupported('restore');
    this._guardReady();
    this._guardWritable('restore');
    this._guardPermission('restore');

    if (!this._softDelete) {
      return createWriteResult(false, null, createRepositoryError(
        RepositoryErrorTypes.UNSUPPORTED_OPERATION,
        'restore() is not supported on "' + this.entityKey + '" — this Repository is configured with softDelete:false, so delete() removes records entirely and there is nothing to restore.',
        { entity: this.entityKey, recoverable: false }
      ));
    }

    var idx = this._indexOf(id);
    if (idx === -1) {
      return createWriteResult(false, null, createRepositoryError(
        RepositoryErrorTypes.VALIDATION,
        'No record with id "' + id + '" in "' + this.entityKey + '".',
        { entity: this.entityKey, recoverable: false }
      ));
    }

    var existing = this._records[idx];

    // Idempotent: already live -> success, no mutation, no persist.
    if (!this._isDeleted(existing)) {
      return createWriteResult(true, cloneRecord(existing), null);
    }

    this._state = 'busy';
    var previous = existing;
    var restored = Object.assign({}, existing);
    restored.deletedAt = null;
    this._attachMetadata(restored, 'update');
    this._records[idx] = restored;
    // PHASE 11.4: same array position, same id -> no this._idIndex
    // mutation. The idempotent already-live case above already returned
    // before this point, so reaching here guarantees a genuine
    // deleted->live transition: _liveCount always increments by exactly 1.
    this._liveCount++;

    try {
      await this._persist();
    } catch (err) {
      this._records[idx] = previous;
      this._liveCount--;
      this._state = 'ready';
      return createWriteResult(false, null, err);
    }
    this._state = 'ready';
    // PHASE 12.3: recorded after successful persist only. The idempotent
    // already-live branch above returns before any mutation/persist
    // happens, so it intentionally never reaches this call — nothing
    // actually changed, so nothing is recorded (Repository_Undo_Hook_
    // Report.md §"Idempotent Restore").
    this._recordUndo('recordRestore', [cloneRecord(previous), cloneRecord(restored), { entity: this.entityKey, op: 'restore' }]);
    return createWriteResult(true, cloneRecord(restored), null);
  };

  // ---- Reads: pure in-memory, never touch the network (Contract §5) ----

  /**
   * get(id, options?) -> Entity | null
   * FIX 3 (PHASE 11.2, Repository_API_Consistency_Report.md): now accepts
   * the same `{includeDeleted}` option already supported by getAll()/
   * search()/count() (previously "Documented Asymmetry" #4 —
   * Phase11_Validation_Report.md — get()/exists() had no includeDeleted
   * at all). Default behavior (no options) is unchanged: a soft-deleted
   * record still returns null.
   * @param {string} id
   * @param {{includeDeleted?:boolean}} [options]
   * @returns {?Object}
   */
  Repository.prototype.get = function (id, options) {
    this._guardSupported('get');
    this._guardReady();
    var idx = this._indexOf(id);
    if (idx === -1) return null;
    var record = this._records[idx];
    var includeDeleted = !!(options && options.includeDeleted);
    if (!includeDeleted && this._isDeleted(record)) return null;
    return cloneRecord(record);
  };

  /**
   * getAll() -> Entity[]
   * Always returns a copy, never a live reference (Contract §19),
   * excludes soft-deleted records by default.
   * @param {{includeDeleted?:boolean}} [options]
   * @returns {Object[]}
   */
  Repository.prototype.getAll = function (options) {
    this._guardSupported('getAll');
    this._guardReady();
    var includeDeleted = !!(options && options.includeDeleted);
    var self = this;
    return this._records
      .filter(function (r) { return includeDeleted || !self._isDeleted(r); })
      .map(cloneRecord);
  };

  /**
   * find(predicateOrQuery) -> Entity | null
   * Accepts either a plain filter object (Filter Hook semantics) or a
   * predicate function(record) -> boolean.
   * @param {Function|Object} predicateOrQuery
   * @returns {?Object}
   */
  Repository.prototype.find = function (predicateOrQuery) {
    this._guardSupported('find');
    this._guardReady();
    var self = this;
    var matcher = typeof predicateOrQuery === 'function'
      ? predicateOrQuery
      : function (r) { return self._matchesFilter(r, predicateOrQuery); };

    for (var i = 0; i < this._records.length; i++) {
      var record = this._records[i];
      if (this._isDeleted(record)) continue;
      if (matcher(record)) return cloneRecord(record);
    }
    return null;
  };

  /**
   * exists(id, options?) -> boolean
   * FIX 4 (PHASE 11.2, Repository_API_Consistency_Report.md): same
   * `{includeDeleted}` extension as get() — see FIX 3 doc comment above.
   * @param {string} id
   * @param {{includeDeleted?:boolean}} [options]
   * @returns {boolean}
   */
  Repository.prototype.exists = function (id, options) {
    this._guardSupported('exists');
    this._guardReady();
    var idx = this._indexOf(id);
    if (idx === -1) return false;
    var includeDeleted = !!(options && options.includeDeleted);
    return includeDeleted || !this._isDeleted(this._records[idx]);
  };

  /**
   * count(queryModel?) -> number
   * PHASE 11.4 (Cache_Layer_Design.md §6): O(1) fast path for the common
   * case of no filter/search — returns the maintained _liveCount (or
   * this._records.length when includeDeleted is set), which is
   * mathematically identical to what _queryInternal() would compute for
   * that same no-filter/no-search queryModel. Any filter or search still
   * requires the full O(n) scan below — an arbitrary predicate cannot be
   * answered by a single counter.
   * @param {Object} [queryModel] - {filter?, search?, includeDeleted?}
   * @returns {number}
   */
  Repository.prototype.count = function (queryModel) {
    this._guardSupported('count');
    this._guardReady();
    var qm = queryModel || {};
    if (!qm.filter && !qm.search) {
      return qm.includeDeleted ? this._records.length : this._liveCount;
    }
    return this._queryInternal(qm).total;
  };

  // ---- Bulk writes (Contract §3 + §5: replace-mode, batch persist) ----

  /**
   * bulkInsert(entities[]) -> WriteResult[]
   * Used for initial loads (loadFromSheets equivalent) — persists once
   * for the whole batch rather than once per record (Performance
   * Strategy §14 in Repository_Contract_Report.md).
   * @param {Object[]} entities
   * @returns {Promise<Array<{success:boolean, record:?Object, error:?Object}>>}
   */
  Repository.prototype.bulkInsert = async function (entities) {
    this._guardSupported('bulkInsert');
    this._guardReady();

    var results = [];
    var toAppend = [];
    for (var i = 0; i < entities.length; i++) {
      var record = cloneRecord(entities[i]) || {};
      var validation = this._validate('create', record);
      if (!validation.valid) {
        results.push(createWriteResult(false, null, createRepositoryError(
          RepositoryErrorTypes.VALIDATION,
          'Validation failed for bulkInsert() item #' + i + ' on "' + this.entityKey + '".',
          { entity: this.entityKey, field: validation.errors[0] && validation.errors[0].field, recoverable: false }
        )));
        continue;
      }
      var id = this._resolveId(record);
      if (this._idField) record[this._idField] = id; else record.id = id;
      this._attachMetadata(record, 'create');
      toAppend.push(record);
      results.push(createWriteResult(true, cloneRecord(record), null));
    }

    this._state = 'busy';
    var before = this._records.slice();
    this._records = this._records.concat(toAppend);
    // PHASE 11.4: O(m) incremental index insert for the appended range —
    // every appended record's position is simply its offset from
    // before.length, in the same order toAppend was built, so no id
    // re-lookup is needed. Matches bulkInsert()'s pre-existing behavior
    // of never checking for duplicate ids against the existing array
    // (Cache_Layer_Implementation_Report.md "Known Pre-Existing
    // Behavior") — this loop only maintains the cache, it does not add
    // any new validation.
    //
    // IMPORTANT (discovered during this phase's own verification, see
    // verify_repository_cache_layer.js I2/I3): because bulkInsert() can
    // append a record whose id already exists elsewhere in this._records,
    // a plain unconditional `.set(id, ai)` here would let the SECOND
    // occurrence silently overwrite the cached position of the FIRST —
    // diverging from the pre-cache linear-scan behavior of _indexOf(),
    // which always returns the position of the FIRST match. Guarding
    // with `.has()` preserves "first occurrence wins" exactly, keeping
    // this._idIndex.get(id) byte-for-byte identical to what a linear
    // re-scan of this._records would return for every id, duplicated or
    // not — this is a cache-correctness fix, not a behavior change: no
    // duplicate-id validation is added, and duplicate ids are still
    // silently accepted exactly as before this phase.
    var idFieldForAppend = this._idField || 'id';
    for (var ai = before.length; ai < this._records.length; ai++) {
      var appendedRecord = this._records[ai];
      var appendedId = appendedRecord[idFieldForAppend];
      if (!this._idIndex.has(appendedId)) this._idIndex.set(appendedId, ai);
      if (!this._isDeleted(appendedRecord)) this._liveCount++;
    }
    try {
      await this._persist();
    } catch (err) {
      this._records = before;
      // PHASE 11.4: multiple records were just inserted into the cache
      // above — a full rebuild from the restored (pre-insert) array is
      // simpler and safer than reversing m individual insertions one by
      // one (Cache_Layer_Design.md §20).
      this._rebuildIndex();
      this._state = 'ready';
      return entities.map(function () { return createWriteResult(false, null, err); });
    }
    this._state = 'ready';
    // PHASE 12.3: ONE history entry for the whole batch (not one per
    // record) — `toAppend` already holds exactly the records that passed
    // validation and were actually appended/persisted. Skipped entirely
    // if nothing was actually appended (e.g. every item failed
    // validation) — nothing changed, nothing to record.
    if (toAppend.length > 0) {
      this._recordUndo('recordCreate', [
        toAppend.map(cloneRecord),
        { entity: this.entityKey, op: 'bulkInsert', bulk: true, count: toAppend.length }
      ]);
    }
    return results;
  };

  /**
   * bulkUpdate(patches[]) -> WriteResult[]
   * FIX 2 (PHASE 11.2, Repository_API_Consistency_Report.md): same guard
   * as update() — a patch item targeting a soft-deleted record is
   * rejected (per-item CONFLICT WriteResult, matching the "unknown id"
   * per-item error pattern already used here) unless that item sets
   * `allowDeleted:true`. Batch persist/rollback semantics are unchanged:
   * a rejected item is simply never staged into `working`/persisted.
   *
   * PHASE 11.2.1: guard/merge/validate logic now lives in the shared
   * `_stageUpdate()` helper, the same one update() and transaction()'s
   * {op:'update'} step call — no more parallel copies of this logic.
   * @param {Array<{id:string, patch:Object, allowDeleted?:boolean}>} patches
   * @returns {Promise<Array<{success:boolean, record:?Object, error:?Object}>>}
   */
  Repository.prototype.bulkUpdate = async function (patches) {
    this._guardSupported('bulkUpdate');
    this._guardReady();

    var before = this._records.slice();
    var results = [];
    // PHASE 12.3: parallel arrays of the items that actually get staged
    // successfully, used to build ONE undo entry for the whole batch
    // after persist succeeds — never populated for items that failed
    // (unknown id / soft-delete guard / validation).
    var undoBefore = [];
    var undoAfter = [];
    for (var i = 0; i < patches.length; i++) {
      var idx = this._indexOf(patches[i].id);
      if (idx === -1) {
        results.push(createWriteResult(false, null, createRepositoryError(
          RepositoryErrorTypes.VALIDATION,
          'No record with id "' + patches[i].id + '" in "' + this.entityKey + '".',
          { entity: this.entityKey, recoverable: false }
        )));
        continue;
      }
      var targetRecord = this._records[idx];
      var allowDeleted = !!patches[i].allowDeleted;
      var staged = this._stageUpdate(targetRecord, patches[i].patch, allowDeleted, 'bulkUpdate() item #' + i);
      if (!staged.ok) {
        results.push(createWriteResult(false, null, staged.error));
        continue;
      }
      var merged = staged.merged;
      this._attachMetadata(merged, 'update');
      // PHASE 11.4: bulkUpdate() only ever replaces content at an
      // already-known position (never inserts/removes), so this._idIndex
      // needs no mutation for any item, and this._indexOf() above stays
      // valid across every iteration of this loop (unlike a splice-based
      // removal, nothing here ever shifts another item's position). Only
      // _liveCount can change, in the same narrow allowDeleted+deletedAt-
      // patch case update() itself documents.
      if (this._isDeleted(targetRecord) !== this._isDeleted(merged)) {
        this._liveCount += this._isDeleted(merged) ? -1 : 1;
      }
      this._records[idx] = merged;
      undoBefore.push(targetRecord);
      undoAfter.push(merged);
      results.push(createWriteResult(true, cloneRecord(merged), null));
    }

    this._state = 'busy';
    try {
      await this._persist();
    } catch (err) {
      this._records = before;
      // PHASE 11.4: multiple _liveCount deltas may have been applied
      // above before the persist failure — a full rebuild from the
      // restored array is simpler and safer than reversing each one
      // individually (Cache_Layer_Design.md §20).
      this._rebuildIndex();
      this._state = 'ready';
      return patches.map(function () { return createWriteResult(false, null, err); });
    }
    this._state = 'ready';
    // PHASE 12.3: ONE history entry for the whole batch, only if at
    // least one item was actually staged and persisted.
    if (undoBefore.length > 0) {
      this._recordUndo('recordUpdate', [
        undoBefore.map(cloneRecord),
        undoAfter.map(cloneRecord),
        { entity: this.entityKey, op: 'bulkUpdate', bulk: true, count: undoBefore.length }
      ]);
    }
    return results;
  };

  /**
   * bulkDelete(ids[]) -> WriteResult[]
   * @param {string[]} ids
   * @returns {Promise<Array<{success:boolean, record:?Object, error:?Object}>>}
   */
  Repository.prototype.bulkDelete = async function (ids) {
    this._guardSupported('bulkDelete');
    this._guardReady();

    var before = this._records.slice();
    var results = [];
    // PHASE 12.3: parallel arrays for ONE undo entry covering the whole
    // batch — populated only for ids that actually existed and were
    // actually deleted (soft or hard).
    var undoBefore = [];
    var undoAfter = [];
    for (var i = 0; i < ids.length; i++) {
      var idx = this._indexOf(ids[i]);
      if (idx === -1) {
        results.push(createWriteResult(false, null, createRepositoryError(
          RepositoryErrorTypes.VALIDATION,
          'No record with id "' + ids[i] + '" in "' + this.entityKey + '".',
          { entity: this.entityKey, recoverable: false }
        )));
        continue;
      }
      if (this._softDelete) {
        var wasLiveItem = !this._isDeleted(this._records[idx]);
        var originalItem = this._records[idx];
        var softDeleted = Object.assign({}, this._records[idx]);
        softDeleted.deletedAt = new Date().toISOString();
        this._attachMetadata(softDeleted, 'update');
        this._records[idx] = softDeleted;
        undoBefore.push(originalItem);
        undoAfter.push(softDeleted);
        // PHASE 11.4: soft-delete never shifts any array position, so
        // this._idIndex stays valid across every iteration of this loop
        // (this._indexOf() above remains an accurate O(1) lookup for
        // every subsequent id, including a duplicate of an id already
        // processed earlier in this same call — matching pre-existing
        // behavior exactly). Only _liveCount changes, and only once per
        // genuine live->deleted transition.
        if (wasLiveItem) this._liveCount--;
        results.push(createWriteResult(true, cloneRecord(softDeleted), null));
      } else {
        var removed = this._records[idx];
        this._records.splice(idx, 1);
        // PHASE 11.4: hard-delete shifts every subsequent record's array
        // position by one. Rebuilding immediately (rather than deferring
        // to the end of the loop) is required for correctness: it is
        // what keeps this._indexOf() — now Map-backed — returning the
        // exact same result a live linear re-scan would for every
        // remaining id in this same ids[] list, including duplicates,
        // preserving this method's pre-existing observable behavior
        // exactly. This trades this dormant path's performance (still
        // O(m·n), unchanged from before this phase) for guaranteed
        // correctness — zero of the 9 real entity Repositories are
        // configured with softDelete:false, so this trade has no
        // production performance cost (Cache_Layer_Implementation_
        // Report.md "Risk Assessment" / "Performance Results").
        this._rebuildIndex();
        undoBefore.push(removed);
        undoAfter.push(null);
        results.push(createWriteResult(true, cloneRecord(removed), null));
      }
    }

    this._state = 'busy';
    try {
      await this._persist();
    } catch (err) {
      this._records = before;
      // PHASE 11.4: full rebuild from the restored array — simplest,
      // correct reconciliation regardless of how many soft-delete
      // decrements or hard-delete rebuilds already happened above
      // (Cache_Layer_Design.md §20).
      this._rebuildIndex();
      this._state = 'ready';
      return ids.map(function () { return createWriteResult(false, null, err); });
    }
    this._state = 'ready';
    // PHASE 12.3: ONE history entry for the whole batch. `after` snapshots
    // are folded into metadata (recordDelete()'s own `after` parameter is
    // hardcoded null by UndoManager's design — see UndoManager.js
    // buildEntry() via recordDelete()) so no information is lost for a
    // future module-level "undo a bulk delete" implementation.
    if (undoBefore.length > 0) {
      this._recordUndo('recordDelete', [
        undoBefore.map(cloneRecord),
        { entity: this.entityKey, op: 'bulkDelete', bulk: true, count: undoBefore.length, after: undoAfter.map(cloneRecord) }
      ]);
    }
    return results;
  };

  // ---- Query Model — Repository Contract §7 ----

  /** @private shared engine behind search()/count(). */
  Repository.prototype._queryInternal = function (queryModel) {
    var self = this;
    var includeDeleted = !!queryModel.includeDeleted;
    var items = this._records.filter(function (r) {
      return includeDeleted || !self._isDeleted(r);
    });

    if (queryModel.filter) {
      items = items.filter(function (r) { return self._matchesFilter(r, queryModel.filter); });
    }
    if (queryModel.search) {
      items = items.filter(function (r) { return self._matchesSearch(r, queryModel.search); });
    }

    var total = items.length;

    if (queryModel.sort) {
      var sortSpec = Array.isArray(queryModel.sort) ? queryModel.sort : [queryModel.sort];
      items = items.slice().sort(function (a, b) { return self._compareRecords(a, b, sortSpec); });
    }

    var offset = queryModel.offset || 0;
    var limit = typeof queryModel.limit === 'number' ? queryModel.limit : items.length;
    var paged = items.slice(offset, offset + limit);

    if (Array.isArray(queryModel.projection) && queryModel.projection.length) {
      paged = paged.map(function (r) {
        var projected = {};
        queryModel.projection.forEach(function (field) { projected[field] = readField(r, field); });
        return projected;
      });
    } else {
      paged = paged.map(cloneRecord);
    }

    return {
      items: paged,
      total: total,
      hasMore: offset + paged.length < total
    };
  };

  /**
   * search(queryModel) -> QueryResult
   * queryModel: { filter?, search?, sort?, offset?, limit?, projection?,
   *               includeDeleted? } — Query Model, Contract §7.
   * @param {Object} queryModel
   * @returns {{items:Object[], total:number, hasMore:boolean}}
   */
  Repository.prototype.search = function (queryModel) {
    this._guardSupported('search');
    this._guardReady();
    return this._queryInternal(queryModel || {});
  };

  // ---- Export / Import / Clear (Contract §3 + §5) ----

  /**
   * export() -> Entity[]
   * Full serializable copy, including soft-deleted records (backups
   * must not silently drop pending-delete data).
   * @returns {Object[]}
   */
  Repository.prototype.export = function () {
    this._guardSupported('export');
    this._guardReady();
    return this._records.map(cloneRecord);
  };

  /**
   * import(entities[], mode) -> ImportResult
   * mode: 'replace' (default, matches current loadFromSheets behavior
   * per Contract §5) or 'merge'. No strict validation on import — data
   * from a trusted backup/remote source is accepted as-is (Contract §5).
   * @param {Object[]} entities
   * @param {'replace'|'merge'} [mode]
   * @returns {Promise<{success:boolean, imported:number, mode:string, error:?Object}>}
   */
  Repository.prototype.import = async function (entities, mode) {
    this._guardSupported('import');
    this._guardReady();
    mode = mode || 'replace';

    var before = this._records.slice();
    this._state = 'busy';

    if (mode === 'replace') {
      this._records = (entities || []).map(cloneRecord);
      // PHASE 11.4: entire array replaced from an external source — a
      // full rebuild is required and is the same invalidation moment
      // already documented for a future DatabaseService-level cache
      // (DatabaseService_Design_Report_PHASE3_V10.md §11: "بعد
      // import/bulkInsert كامل... تُعاد بناء نسخة الذاكرة بالكامل").
      this._rebuildIndex();
    } else if (mode === 'merge') {
      var idField = this._idField || 'id';
      var self = this;
      (entities || []).forEach(function (incoming) {
        var record = cloneRecord(incoming);
        var idx = self._indexOf(record[idField]);
        if (idx === -1) {
          self._records.push(record);
          // PHASE 11.4: merge-mode "not found" always appends — never a
          // splice, so no other item's position ever shifts, and the
          // index stays valid across every iteration of this forEach.
          var newIdx = self._records.length - 1;
          self._idIndex.set(record[idField], newIdx);
          if (!self._isDeleted(record)) self._liveCount++;
        } else {
          var oldRecord = self._records[idx];
          var oldWasDeleted = self._isDeleted(oldRecord);
          self._records[idx] = record;
          // Same array position, same id -> no this._idIndex mutation;
          // only _liveCount can change, if the incoming record's deleted
          // status differs from what it replaced.
          var newIsDeleted = self._isDeleted(record);
          if (oldWasDeleted !== newIsDeleted) {
            self._liveCount += newIsDeleted ? -1 : 1;
          }
        }
      });
    } else {
      this._state = 'ready';
      return {
        success: false, imported: 0, mode: mode,
        error: createRepositoryError(
          RepositoryErrorTypes.VALIDATION,
          'Unknown import mode "' + mode + '" — expected "replace" or "merge".',
          { entity: this.entityKey, recoverable: false }
        )
      };
    }

    try {
      await this._persist();
    } catch (err) {
      this._records = before;
      // PHASE 11.4: whether 'replace' or 'merge', a full rebuild from the
      // restored (pre-import) array is the simplest correct reconciliation
      // (Cache_Layer_Design.md §20).
      this._rebuildIndex();
      this._state = 'ready';
      return { success: false, imported: 0, mode: mode, error: err };
    }
    this._state = 'ready';
    // PHASE 12.3: ONE history entry for the whole import, regardless of
    // mode ('replace' or 'merge') or how many records were involved —
    // recorded as an 'update' snapshot of the full before/after array,
    // since import can add, replace, and leave-untouched records all in
    // one call (no single create/delete/restore type fits both modes).
    this._recordUndo('recordUpdate', [
      before.map(cloneRecord),
      this._records.map(cloneRecord),
      { entity: this.entityKey, op: 'import', bulk: true, mode: mode, count: (entities || []).length }
    ]);
    return { success: true, imported: (entities || []).length, mode: mode, error: null };
  };

  /**
   * clear() -> WriteResult
   * Empties this entity entirely — used by clearAllData().
   * @returns {Promise<{success:boolean, record:?Object, error:?Object}>}
   */
  Repository.prototype.clear = async function () {
    this._guardSupported('clear');
    this._guardReady();

    var before = this._records.slice();
    var beforeIdIndex = this._idIndex;
    var beforeLiveCount = this._liveCount;
    this._state = 'busy';
    this._records = [];
    // PHASE 11.4: emptied array -> empty index, zero live count. Trivial
    // O(1) equivalent of _rebuildIndex() on an empty array.
    this._idIndex = new Map();
    this._liveCount = 0;
    try {
      await this._persist();
    } catch (err) {
      this._records = before;
      // PHASE 11.4: precise O(1) revert — the pre-clear index/count were
      // saved above and are still exactly correct for the restored array.
      this._idIndex = beforeIdIndex;
      this._liveCount = beforeLiveCount;
      this._state = 'ready';
      return createWriteResult(false, null, err);
    }
    this._state = 'ready';
    // PHASE 12.3: ONE history entry for the whole clear(), recorded as a
    // 'delete' snapshot of everything that existed beforehand — only if
    // there was anything to clear in the first place (an empty
    // Repository's clear() is a true no-op, nothing changed to record).
    if (before.length > 0) {
      this._recordUndo('recordDelete', [
        before.map(cloneRecord),
        { entity: this.entityKey, op: 'clear', bulk: true, count: before.length }
      ]);
    }
    return createWriteResult(true, null, null);
  };

  // ---- Transaction — Repository Contract §8 ----

  /**
   * transaction(ops[]) -> TransactionResult
   * Executes multiple ops as one logical unit on THIS Repository only
   * (no cross-Repository transactions here — Contract §8/§12: that is an
   * Orchestration-layer concern, out of scope for a single Repository).
   *
   * ops: Array<
   *   {op:'create', entity:Object} |
   *   {op:'update', id:string, patch:Object, allowDeleted?:boolean} |
   *   {op:'delete', id:string} |
   *   {op:'restore', id:string}
   * >
   *
   * All ops are validated and staged against an in-memory working copy
   * first; only if every op succeeds is the result persisted once
   * (Contract §8: "no intermediate state is ever written").
   *
   * PHASE 11.2.1 (T-10 fix, Transaction_Consistency_Report.md): the
   * {op:'update'} step now enforces the exact same soft-delete guard as
   * update()/bulkUpdate() (via the shared `_stageUpdate()` helper) — a
   * step targeting a soft-deleted record is rejected (whole transaction
   * rolled back) unless that step sets `allowDeleted:true`. Previously
   * this step bypassed the guard entirely.
   * @param {Array<Object>} ops
   * @returns {Promise<{success:boolean, results:Array<Object>, error:?Object}>}
   */
  Repository.prototype.transaction = async function (ops) {
    this._guardSupported('transaction');
    this._guardReady();

    if (this._locked) {
      return {
        success: false, results: [],
        error: createRepositoryError(
          RepositoryErrorTypes.CONFLICT,
          'Repository "' + this.entityKey + '" is already inside a transaction.',
          { entity: this.entityKey, recoverable: true }
        )
      };
    }

    this._locked = true;
    this._state = 'transaction';
    this._beforeTransaction(ops);

    var working = this._records.slice();
    var results = [];
    var idField = this._idField || 'id';

    try {
      for (var i = 0; i < ops.length; i++) {
        var step = ops[i];
        if (step.op === 'create') {
          var record = cloneRecord(step.entity) || {};
          var validation = this._validate('create', record);
          if (!validation.valid) throw createRepositoryError(
            RepositoryErrorTypes.VALIDATION,
            'transaction() step #' + i + ' (create) failed validation on "' + this.entityKey + '".',
            { entity: this.entityKey, field: validation.errors[0] && validation.errors[0].field, recoverable: false }
          );
          var id = this._resolveId(record);
          record[idField] = id;
          if (working.some(function (r) { return r[idField] === id; })) {
            throw createRepositoryError(
              RepositoryErrorTypes.CONFLICT,
              'transaction() step #' + i + ' (create) — id "' + id + '" already exists in "' + this.entityKey + '".',
              { entity: this.entityKey, recoverable: false }
            );
          }
          this._attachMetadata(record, 'create');
          working.push(record);
          results.push(createWriteResult(true, cloneRecord(record), null));

        } else if (step.op === 'update') {
          var uIdx = working.findIndex(function (r) { return r[idField] === step.id; });
          if (uIdx === -1) throw createRepositoryError(
            RepositoryErrorTypes.VALIDATION,
            'transaction() step #' + i + ' (update) — no record with id "' + step.id + '" in "' + this.entityKey + '".',
            { entity: this.entityKey, recoverable: false }
          );
          // PHASE 11.2.1 (T-10 fix, Transaction_Consistency_Report.md):
          // transaction()'s {op:'update'} step now calls the exact same
          // `_stageUpdate()` helper as update()/bulkUpdate() — same
          // soft-delete guard (opt out per-step via {allowDeleted:true}),
          // same merge, same _validate('update', ...) call. A rejected
          // step throws, which the existing catch block below already
          // turns into a full rollback (working[] is discarded, nothing
          // persisted) — no separate rollback path needed.
          var uAllowDeleted = !!step.allowDeleted;
          var uStaged = this._stageUpdate(working[uIdx], step.patch, uAllowDeleted, 'transaction() step #' + i + ' (update)');
          if (!uStaged.ok) throw uStaged.error;
          var merged = uStaged.merged;
          this._attachMetadata(merged, 'update');
          working[uIdx] = merged;
          results.push(createWriteResult(true, cloneRecord(merged), null));

        } else if (step.op === 'delete') {
          var dIdx = working.findIndex(function (r) { return r[idField] === step.id; });
          if (dIdx === -1) throw createRepositoryError(
            RepositoryErrorTypes.VALIDATION,
            'transaction() step #' + i + ' (delete) — no record with id "' + step.id + '" in "' + this.entityKey + '".',
            { entity: this.entityKey, recoverable: false }
          );
          if (this._softDelete) {
            var softDeleted = Object.assign({}, working[dIdx]);
            softDeleted.deletedAt = new Date().toISOString();
            this._attachMetadata(softDeleted, 'update');
            working[dIdx] = softDeleted;
            results.push(createWriteResult(true, cloneRecord(softDeleted), null));
          } else {
            var removed = working[dIdx];
            working.splice(dIdx, 1);
            results.push(createWriteResult(true, cloneRecord(removed), null));
          }

        } else if (step.op === 'restore') {
          if (!this._softDelete) throw createRepositoryError(
            RepositoryErrorTypes.UNSUPPORTED_OPERATION,
            'transaction() step #' + i + ' (restore) — "' + this.entityKey + '" is configured with softDelete:false, nothing to restore.',
            { entity: this.entityKey, recoverable: false }
          );
          var rIdx = working.findIndex(function (r) { return r[idField] === step.id; });
          if (rIdx === -1) throw createRepositoryError(
            RepositoryErrorTypes.VALIDATION,
            'transaction() step #' + i + ' (restore) — no record with id "' + step.id + '" in "' + this.entityKey + '".',
            { entity: this.entityKey, recoverable: false }
          );
          if (!this._isDeleted(working[rIdx])) {
            // Idempotent (Restore_System_Design.md §1/§3): already live,
            // no mutation staged, but still a successful step result.
            results.push(createWriteResult(true, cloneRecord(working[rIdx]), null));
          } else {
            var restoredTx = Object.assign({}, working[rIdx]);
            restoredTx.deletedAt = null;
            this._attachMetadata(restoredTx, 'update');
            working[rIdx] = restoredTx;
            results.push(createWriteResult(true, cloneRecord(restoredTx), null));
          }

        } else {
          throw createRepositoryError(
            RepositoryErrorTypes.VALIDATION,
            'transaction() step #' + i + ' has unknown op "' + step.op + '".',
            { entity: this.entityKey, recoverable: false }
          );
        }
      }
    } catch (stepError) {
      this._onRollback(stepError);
      this._locked = false;
      this._state = 'ready';
      return { success: false, results: [], error: stepError };
    }

    // All steps staged successfully — commit once.
    var previousRecords = this._records;
    this._records = working;
    try {
      await this._persist();
    } catch (persistError) {
      this._records = previousRecords;
      // PHASE 11.4: this._idIndex/this._liveCount were never touched for
      // this attempt (see below — the rebuild only happens after a
      // successful persist), so they are still exactly correct for
      // previousRecords; nothing to revert here. transaction()'s own
      // internal per-step lookups (working.findIndex()/.some() above)
      // deliberately remain unaccelerated in this phase — they operate on
      // the separate `working` array, not on this._records/this._idIndex,
      // and transaction() has zero current production Module callers
      // (Cache_Layer_Design.md §13, Cache_Layer_Migration_Plan.md §2
      // SUB-PHASE 11.6 — explicitly deferred, not part of 11.4's scope).
      this._onRollback(persistError);
      this._locked = false;
      this._state = 'ready';
      return { success: false, results: [], error: persistError };
    }

    // PHASE 11.4: commit succeeded — this._records now permanently holds
    // `working`, which may have added/updated/removed/restored records at
    // arbitrary positions relative to the pre-transaction array. A single
    // O(n) rebuild here is the correct, simplest reconciliation (same
    // reasoning as import('replace') and clear() above).
    this._rebuildIndex();

    // PHASE 12.3: ONE history entry for the whole transaction, after
    // successful commit only — never on the rollback path above (that
    // path returns before ever reaching here). Recorded as an 'update'
    // snapshot of the full before/after array, since a transaction can
    // freely mix create/update/delete/restore steps in one call — no
    // single create/delete/restore type could represent that mix, and a
    // full before/after snapshot is sufficient for a future full-revert.
    if (ops.length > 0) {
      this._recordUndo('recordUpdate', [
        previousRecords.map(cloneRecord),
        this._records.map(cloneRecord),
        { entity: this.entityKey, op: 'transaction', bulk: true, opsCount: ops.length, opTypes: ops.map(function (s) { return s.op; }) }
      ]);
    }

    var txResult = { success: true, results: results, error: null };
    this._afterCommit(txResult);
    this._locked = false;
    this._state = 'ready';
    return txResult;
  };

  // ================================================================
  // 6. Exports
  // ================================================================

  var api = {
    Repository: Repository,
    RepositoryErrorTypes: RepositoryErrorTypes,
    createRepositoryError: createRepositoryError,
    createWriteResult: createWriteResult,
    assertStorageAdapter: assertStorageAdapter
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  if (root) {
    root.Repository = Repository;
    root.RepositoryErrorTypes = RepositoryErrorTypes;
    root.createRepositoryError = createRepositoryError;
    root.createWriteResult = createWriteResult;
  }

})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
