/**
 * ================================================================
 * IndexedDBAdapter.js — IndexedDB Storage Adapter | نظام الحسام للمحاماة
 * ================================================================
 * PHASE 13.3B — IndexedDBAdapter Implementation
 *
 * Source of design (no assumption outside these):
 *   - js/core/StorageAdapter.js — the abstract base class this file
 *     subclasses. Every method signature, return shape, and error-timing
 *     rule documented there is followed exactly. Read in full; NOT modified.
 *   - js/core/LocalStorageAdapter.js — the ONE existing concrete
 *     StorageAdapter this file must stay behavior-compatible with (same
 *     Promise-always-async discipline, same "reject, never throw
 *     synchronously except for constructor/assert-style programmer
 *     errors" pattern). Read in full; NOT modified.
 *   - js/core/DatabaseService.js — the sole current consumer shape (duck-
 *     types the 8 methods below). Read in full; NOT modified.
 *   - js/core/IndexedDBEngine.js / IndexedDBTransaction.js /
 *     IndexedDBUtils.js / IndexedDBErrors.js / IndexedDBSchema.js — the
 *     Phase 13.3A foundation this adapter is built entirely on top of.
 *     None of these five files are modified or reimplemented here; this
 *     file only calls their existing public APIs.
 *
 * WHAT THIS FILE IS
 *   The SECOND concrete Storage Adapter: a thin binding of the abstract
 *   `StorageAdapter` interface to the real IndexedDB engine built in Phase
 *   13.3A. It stores one whole-array-per-entity record set per object
 *   store (matching each store's Phase 13.3A schema definition), and
 *   implements all 8 `StorageAdapter` methods by delegating to
 *   `IndexedDBEngine` (connection lifecycle) and `IndexedDBTransaction`
 *   (per-call transaction scoping), classifying every native failure via
 *   `IndexedDBErrors.fromDOMException`.
 *
 * WHAT THIS FILE IS NOT
 *   - It is NOT DatabaseService, IndexedDBEngine, IndexedDBTransaction,
 *     IndexedDBUtils, IndexedDBErrors, or IndexedDBSchema — it calls each
 *     of those unchanged; none of their logic is duplicated or
 *     reimplemented here.
 *   - It does NOT modify `Repository.js`, `StorageAdapter.js`,
 *     `LocalStorageAdapter.js`, `DatabaseService.js`, `UndoManager.js`,
 *     `UndoReconciler.js`, or any Repository/Module. All are read-only
 *     inputs to this phase.
 *   - It does NOT delete the underlying IndexedDB database. That remains
 *     the exclusive responsibility of `IndexedDBEngine.deleteDatabase()` —
 *     see `destroy()` below, which only releases this adapter's own
 *     connection, exactly like `LocalStorageAdapter.prototype.destroy`
 *     only releases its own `_engine`/`_isOpen` bookkeeping.
 *   - It does NOT implement partial/per-record updates. `write()` is
 *     always a whole-array replace inside one `readwrite` transaction,
 *     matching `Repository.prototype._persist()`'s call shape and
 *     `StorageAdapter.js`'s own documented `write()` contract exactly.
 *   - It does NOT wire itself into `index.html`, `DatabaseService.js`, or
 *     any Repository. That bridging is a later sub-phase's job.
 *
 * Two deliberate, approved behavioral deviations from LocalStorageAdapter
 * (both documented in full at each method below, not silently absorbed):
 *   1. `delete(entityKey)` cannot remove the object store itself (Phase
 *      13.3A's schema creates every store up front, in `onupgradeneeded`,
 *      for the lifetime of the database) — it clears every record within
 *      that store instead, which is the closest IndexedDB-native
 *      equivalent to "this entity's whole record set is gone".
 *   2. `exists(entityKey)` is implemented as `count() > 0` rather than
 *      LocalStorageAdapter's literal "key exists, even if empty" check —
 *      approved because Repository.js and DatabaseService never call
 *      `exists()` today, so this is a documented, currently-inert
 *      divergence, not a live behavioral regression.
 *
 * Error vocabulary (approved Decision 1): genuine IndexedDB engine
 * failures propagate the classified `IndexedDBErrors` instances
 * unchanged (`QuotaExceededError`, `BlockedError`, `VersionConflictError`,
 * `AbortError`, `UnknownError`, `TimeoutError`, `BrowserUnsupportedError`)
 * — `IndexedDBErrors.js` is not modified, wrapped, or replaced. The one
 * gap that taxonomy has no type for — an adapter-level structural input
 * check ("records is not an Array") — is covered by a small local
 * `ValidationError`, shaped identically to `LocalStorageAdapter.js`'s own
 * `ValidationError` (same `message`/`name`/`type`/`entityKey`/`cause`/
 * `recoverable` fields), so a caller checking `.type === 'ValidationError'`
 * sees the same shape regardless of which adapter is in use.
 *
 * Load order: depends on `StorageAdapter.js`, `IndexedDBEngine.js`,
 * `IndexedDBTransaction.js`, `IndexedDBUtils.js`, `IndexedDBErrors.js`,
 * and `IndexedDBSchema.js` having loaded first. Safe to load anywhere
 * thereafter — additive, self-contained, not yet referenced by any
 * existing file.
 * ================================================================
 */

(function (root) {
  'use strict';

  var StorageAdapterNS = (typeof module !== 'undefined' && module.exports)
    ? require('./StorageAdapter.js')
    : root;
  var StorageAdapter = StorageAdapterNS && StorageAdapterNS.StorageAdapter;
  if (typeof StorageAdapter !== 'function') {
    throw new Error(
      'IndexedDBAdapter requires js/core/StorageAdapter.js to be loaded ' +
      'first (StorageAdapter base class not found).'
    );
  }

  /** @private loads one of this adapter's Phase 13.3A foundation
   *  dependencies, identically to IndexedDBEngine.js's own `requireNS`
   *  pattern — thrown error if the dependency hasn't loaded yet. */
  function requireNS(name) {
    var ns = (typeof module !== 'undefined' && module.exports)
      ? require('./' + name + '.js')
      : root[name];
    if (!ns) {
      throw new Error('IndexedDBAdapter requires js/core/' + name + '.js to be loaded first.');
    }
    return ns;
  }

  var EngineNS = requireNS('IndexedDBEngine');
  var TransactionNS = requireNS('IndexedDBTransaction');
  var UtilsNS = requireNS('IndexedDBUtils');
  var ErrorsNS = requireNS('IndexedDBErrors');
  var SchemaNS = requireNS('IndexedDBSchema');

  // ================================================================
  // 1. ValidationError — the one local error type this file introduces
  //    (see file header, "Error vocabulary"). Shaped identically to
  //    LocalStorageAdapter.js's own ValidationError.
  // ================================================================

  /**
   * @class ValidationError
   * Thrown/rejected ONLY when an input's type itself prevents the
   * operation — currently just `write()`'s `records` argument not being
   * an Array. Never used for business/shape validation of record
   * contents (Repository's job, one layer up) — mirrors
   * `LocalStorageAdapter.js`'s own `ValidationError` scope exactly.
   * @param {string} message
   * @param {{entityKey?: string, cause?: *}} [extra]
   */
  function ValidationError(message, extra) {
    extra = extra || {};
    this.message = message;
    this.name = 'ValidationError';
    this.type = 'ValidationError';
    this.entityKey = extra.entityKey != null ? extra.entityKey : null;
    this.cause = extra.cause != null ? extra.cause : null;
    this.recoverable = false;
    if (typeof Error.captureStackTrace === 'function') {
      Error.captureStackTrace(this, ValidationError);
    } else {
      this.stack = (new Error(message)).stack;
    }
  }
  ValidationError.prototype = Object.create(Error.prototype);
  ValidationError.prototype.constructor = ValidationError;
  ValidationError.prototype.name = 'ValidationError';

  /** @private Throws a synchronous, structural ValidationError when
   *  `entityKey` is not a non-empty string — same discipline as
   *  LocalStorageAdapter.js's own `assertEntityKey`. */
  function assertEntityKey(entityKey) {
    if (typeof entityKey !== 'string' || entityKey.length === 0) {
      throw new ValidationError(
        'IndexedDBAdapter requires a non-empty string entityKey; got: ' +
        (typeof entityKey) + '.',
        { entityKey: null }
      );
    }
  }

  // ================================================================
  // 2. IndexedDBAdapter — concrete StorageAdapter subclass
  // ================================================================

  /**
   * @class IndexedDBAdapter
   * @extends StorageAdapter
   *
   * Config shape (all optional):
   * {
   *   engine:        IndexedDBEngine   Inject an already-constructed
   *                                    IndexedDBEngine instance (e.g. one
   *                                    shared with other callers, or a
   *                                    test double). Defaults to a fresh
   *                                    `new IndexedDBEngine(engineOptions)`.
   *   engineOptions: Object            Passed straight through to
   *                                    `new IndexedDBEngine(...)` when no
   *                                    `engine` override is given (e.g.
   *                                    `indexedDBImpl`, `dbName`,
   *                                    `dbVersion`, timeouts — see
   *                                    IndexedDBEngine.js's own JSDoc).
   * }
   *
   * @param {Object} [config]
   */
  function IndexedDBAdapter(config) {
    StorageAdapter.call(this, config);
    config = config || {};

    /** @private the IndexedDBEngine instance this adapter drives. Never
     *  constructed more than once per adapter instance; resolved eagerly
     *  here (unlike LocalStorageAdapter's lazy engine resolution) because
     *  IndexedDBEngine itself is already lazy — its own `open()` does not
     *  touch `indexedDB` until first called. */
    this._engine = config.engine || new EngineNS.IndexedDBEngine(config.engineOptions || {});

    /** @private lifecycle flag — mirrors LocalStorageAdapter.js's own
     *  `_isOpen` bookkeeping discipline. */
    this._isOpen = false;
  }

  IndexedDBAdapter.prototype = Object.create(StorageAdapter.prototype);
  IndexedDBAdapter.prototype.constructor = IndexedDBAdapter;

  // ----------------------------------------------------------------
  // 2.1 Lifecycle
  // ----------------------------------------------------------------

  /**
   * open() -> Promise<void>
   * Delegates to `IndexedDBEngine.open()` (idempotent there already).
   * Resolves once the underlying connection is ready to accept
   * read/write/delete/clear/exists calls.
   * @returns {Promise<void>}
   */
  IndexedDBAdapter.prototype.open = function () {
    var self = this;
    return self._engine.open().then(function () {
      self._isOpen = true;
    });
  };

  /**
   * close() -> Promise<void>
   * Delegates to `IndexedDBEngine.close()`, which itself never rejects
   * ("no-op success if nothing is open" — matches
   * `StorageAdapter.js`'s documented `close()` contract).
   * @returns {Promise<void>}
   */
  IndexedDBAdapter.prototype.close = function () {
    var self = this;
    return self._engine.close().then(function () {
      self._isOpen = false;
    });
  };

  /**
   * destroy() -> Promise<void>
   * APPROVED DECISION 1: behaves exactly like
   * `LocalStorageAdapter.prototype.destroy` — releases this adapter's own
   * connection only (via `close()`), and does NOT delete the underlying
   * database. Database deletion remains exclusively
   * `IndexedDBEngine.prototype.deleteDatabase()`'s responsibility, never
   * called from here.
   * @returns {Promise<void>}
   */
  IndexedDBAdapter.prototype.destroy = function () {
    return this.close();
  };

  // ----------------------------------------------------------------
  // 2.2 Whole-Entity Storage Operations
  // ----------------------------------------------------------------
  // Every method below opens exactly one IndexedDBTransaction scoped to
  // the single object store named by `entityKey` (or, for `clear()`, all
  // schema-declared stores at once), issues its native IDBRequest(s)
  // synchronously inside that transaction's `run()` callback, and
  // resolves/rejects only once the native transaction itself settles
  // (`oncomplete`/`onerror`/`onabort`) — never before. This mirrors
  // LocalStorageAdapter's own per-call try/catch-wrapped Promise
  // discipline: a caller of any of these five methods only ever sees a
  // resolved value or a rejected Promise, never a synchronous throw
  // (beyond the `assertEntityKey`/Array-check ValidationErrors below,
  // which are converted to rejections in the same tick before any engine
  // call is attempted).

  /**
   * read(entityKey) -> Promise<Array<Object>>
   * Reads the full array of records currently stored in the object store
   * named by `entityKey`, via a single `readonly` transaction's
   * `getAll()`. Resolves `[]` if the store is empty — never
   * `null`/`undefined` — matching `StorageAdapter.js`'s documented `read()`
   * contract exactly.
   * @param {string} entityKey
   * @returns {Promise<Array<Object>>}
   */
  IndexedDBAdapter.prototype.read = function (entityKey) {
    var self = this;
    try {
      assertEntityKey(entityKey);
    } catch (err) {
      return Promise.reject(err);
    }
    return self._engine.databaseReady().then(function (db) {
      var tx = new TransactionNS.IndexedDBTransaction(db, entityKey, 'readonly');
      return tx.run(function (t) {
        var store = t.objectStore(entityKey);
        var request = store.getAll();
        return UtilsNS.promisifyRequest(request, {
          dbName: self._engine.getDatabaseName(),
          storeName: entityKey,
          op: 'read()'
        });
      }).then(function (result) {
        return Array.isArray(result) ? result : [];
      });
    });
  };

  /**
   * write(entityKey, records) -> Promise<void>
   * APPROVED DECISION 2 (whole-array Repository semantics): replaces the
   * ENTIRE record set of the object store named by `entityKey` — never a
   * per-record merge/patch — atomically inside one `readwrite`
   * transaction: `store.clear()` followed by a `store.put(record)` for
   * every element of `records`, all issued synchronously in the same
   * transaction so the clear-then-repopulate is indivisible (the native
   * transaction's own `onerror`/`onabort` rolls back every `put()` already
   * issued if any single one fails, exactly like a real atomic replace).
   * Matches `Repository.prototype._persist()`'s call shape
   * (`this._storage.write(this.entityKey, this._records)`) exactly.
   * @param {string} entityKey
   * @param {Array<Object>} records
   * @returns {Promise<void>}
   */
  IndexedDBAdapter.prototype.write = function (entityKey, records) {
    var self = this;
    try {
      assertEntityKey(entityKey);
    } catch (err) {
      return Promise.reject(err);
    }
    if (!Array.isArray(records)) {
      return Promise.reject(new ValidationError(
        'IndexedDBAdapter.write("' + entityKey + '") requires records to ' +
        'be an Array; got: ' + (typeof records) + '.',
        { entityKey: entityKey }
      ));
    }
    return self._engine.databaseReady().then(function (db) {
      var tx = new TransactionNS.IndexedDBTransaction(db, entityKey, 'readwrite');
      return tx.run(function (t) {
        var store = t.objectStore(entityKey);
        var clearRequest = store.clear();
        return UtilsNS.promisifyRequest(clearRequest, {
          dbName: self._engine.getDatabaseName(),
          storeName: entityKey,
          op: 'write() clear'
        }).then(function () {
          // Every put() is issued synchronously, in one microtask, right
          // after clear() resolves — no macrotask boundary is crossed, so
          // the native transaction stays active throughout (the same
          // technique IndexedDBTransaction.run() itself relies on: all
          // requests are issued before control returns to the event
          // loop). Batched via Promise.all rather than a sequential await
          // chain, so no request is issued one tick after another.
          var putPromises = records.map(function (record) {
            var putRequest = store.put(record);
            return UtilsNS.promisifyRequest(putRequest, {
              dbName: self._engine.getDatabaseName(),
              storeName: entityKey,
              op: 'write() put'
            });
          });
          return Promise.all(putPromises);
        });
      }).then(function () {
        return undefined;
      });
    });
  };

  /**
   * delete(entityKey) -> Promise<void>
   * DOCUMENTED DEVIATION (approved): `StorageAdapter.js` describes
   * `delete()` as removing the entire storage key so a future engine can
   * distinguish "zero records" from "this entity's key never existed".
   * IndexedDB has no such distinction at this adapter's granularity — the
   * object store named by `entityKey` is created once, for the lifetime
   * of the database, in `IndexedDBVersion.applyUpgrade()` (Phase 13.3A),
   * and is never removed by anything other than a full schema migration.
   * The closest available equivalent, and the one implemented here, is
   * clearing every record inside that store — functionally identical to
   * `write(entityKey, [])` for any caller that only inspects `read()`'s
   * result afterward. Resolves successfully even if the store was already
   * empty, matching `StorageAdapter.js`'s "deleting something already
   * absent is not a failure condition" rule.
   * @param {string} entityKey
   * @returns {Promise<void>}
   */
  IndexedDBAdapter.prototype.delete = function (entityKey) {
    var self = this;
    try {
      assertEntityKey(entityKey);
    } catch (err) {
      return Promise.reject(err);
    }
    return self._engine.databaseReady().then(function (db) {
      var tx = new TransactionNS.IndexedDBTransaction(db, entityKey, 'readwrite');
      return tx.run(function (t) {
        var store = t.objectStore(entityKey);
        var request = store.clear();
        return UtilsNS.promisifyRequest(request, {
          dbName: self._engine.getDatabaseName(),
          storeName: entityKey,
          op: 'delete()'
        });
      }).then(function () {
        return undefined;
      });
    });
  };

  /**
   * clear() -> Promise<void>
   * Removes EVERY entity this adapter manages — clears every object store
   * declared in `IndexedDBSchema.getStoreNames()` that actually exists on
   * the open connection, inside a single multi-store `readwrite`
   * transaction. Adapter-level full wipe, distinct from any single
   * Repository's own `clear()` — matches `StorageAdapter.js`'s documented
   * `clear()` scope exactly. Not called anywhere by `Repository.js` today.
   * @returns {Promise<void>}
   */
  IndexedDBAdapter.prototype.clear = function () {
    var self = this;
    return self._engine.databaseReady().then(function (db) {
      var storeNames = SchemaNS.getStoreNames().filter(function (name) {
        return db.objectStoreNames.contains(name);
      });
      if (storeNames.length === 0) {
        return undefined;
      }
      var tx = new TransactionNS.IndexedDBTransaction(db, storeNames, 'readwrite');
      return tx.run(function (t) {
        var clearPromises = storeNames.map(function (name) {
          var store = t.objectStore(name);
          var request = store.clear();
          return UtilsNS.promisifyRequest(request, {
            dbName: self._engine.getDatabaseName(),
            storeName: name,
            op: 'clear()'
          });
        });
        return Promise.all(clearPromises);
      }).then(function () {
        return undefined;
      });
    });
  };

  /**
   * exists(entityKey) -> Promise<boolean>
   * APPROVED DECISION 2: implemented as `count() > 0` on a single
   * `readonly` transaction, rather than LocalStorageAdapter's literal
   * "storage key exists, even if its array is empty" check. Accepted,
   * documented divergence: a store that has been explicitly
   * `write(entityKey, [])`-ed reads as `false` here, where
   * LocalStorageAdapter would read it as `true` — safe today because
   * neither `Repository.js` nor `DatabaseService.js` calls `exists()`
   * anywhere, and no metadata "has been written" flag is introduced to
   * close this gap (per the approved scope for this phase). Never
   * rejects — resolves `false` on any inconclusive/failed check, matching
   * `StorageAdapter.js`'s "existence checks are advisory" rule.
   * @param {string} entityKey
   * @returns {Promise<boolean>}
   */
  IndexedDBAdapter.prototype.exists = function (entityKey) {
    var self = this;
    return new Promise(function (resolve) {
      try {
        assertEntityKey(entityKey);
      } catch (err) {
        resolve(false);
        return;
      }
      self._engine.databaseReady().then(function (db) {
        if (!db.objectStoreNames.contains(entityKey)) {
          resolve(false);
          return;
        }
        var tx = new TransactionNS.IndexedDBTransaction(db, entityKey, 'readonly');
        tx.run(function (t) {
          var store = t.objectStore(entityKey);
          var request = store.count();
          return UtilsNS.promisifyRequest(request, {
            dbName: self._engine.getDatabaseName(),
            storeName: entityKey,
            op: 'exists()'
          });
        }).then(function (count) {
          resolve(count > 0);
        }).catch(function () {
          resolve(false);
        });
      }).catch(function () {
        resolve(false);
      });
    });
  };

  // ================================================================
  // 3. Exports
  // ================================================================

  var api = {
    IndexedDBAdapter: IndexedDBAdapter,
    ValidationError: ValidationError
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  if (root) {
    root.IndexedDBAdapter = IndexedDBAdapter;
    root.IndexedDBAdapterErrors = {
      ValidationError: ValidationError
    };
  }

})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
