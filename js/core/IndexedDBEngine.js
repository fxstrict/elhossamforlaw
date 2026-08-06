/**
 * ================================================================
 * IndexedDBEngine.js — Database Engine Core | نظام الحسام للمحاماة
 * ================================================================
 * PHASE 13.3A — IndexedDB Foundation — Database Engine Core
 *
 * WHAT THIS FILE IS
 *   The actual `indexedDB.open()` / connection-lifecycle engine. This is
 *   the ONLY file in this phase that touches a real `indexedDB` global.
 *   It owns:
 *     - open()            opens (or upgrades) the HossamLawOffice
 *                          database, applying IndexedDBVersion.js's
 *                          `applyUpgrade()` inside `onupgradeneeded`.
 *     - close()            closes the current connection.
 *     - deleteDatabase()    deletes the whole database from disk.
 *     - isOpen()            synchronous connection-state check.
 *     - databaseReady()     Promise that resolves once open() has
 *                           settled (for callers that raced a concurrent
 *                           open()).
 *     - verifyIntegrity()   post-open structural check (store/version/
 *                           connection/transaction-state), built on
 *                           IndexedDBVersion.verifySchema().
 *
 * WHAT THIS FILE IS NOT
 *   - It is NOT a StorageAdapter subclass and does NOT implement
 *     read/write/delete/clear/exists — that is IndexedDBAdapter.js,
 *     explicitly deferred to PHASE 13.3B per this phase's own scope.
 *   - It does NOT migrate any LocalStorage data into IndexedDB.
 *   - It is NOT wired into DatabaseService.js, Repository.js, any
 *     Repository, any Module, Undo, History, Cache, or Google Sync in
 *     this phase. It is not referenced by index.html.
 *   - It does NOT modify Repository.js, StorageAdapter.js,
 *     LocalStorageAdapter.js, UndoManager.js, UndoReconciler.js, or any
 *     Repository — all remain on LocalStorage, unchanged, byte-identical.
 *
 * Load order: depends on IndexedDBErrors.js, IndexedDBSchema.js,
 * IndexedDBVersion.js, and IndexedDBUtils.js having loaded first. Safe
 * to load anywhere thereafter — this file is additive and self-
 * contained; nothing in the existing app references it yet.
 * ================================================================
 */

(function (root) {
  'use strict';

  function requireNS(name, prop) {
    var ns = (typeof module !== 'undefined' && module.exports)
      ? require('./' + name + '.js')
      : root[name];
    if (!ns) {
      throw new Error('IndexedDBEngine requires js/core/' + name + '.js to be loaded first.');
    }
    return ns;
  }

  var ErrorsNS = requireNS('IndexedDBErrors');
  var SchemaNS = requireNS('IndexedDBSchema');
  var VersionNS = requireNS('IndexedDBVersion');
  var UtilsNS = requireNS('IndexedDBUtils');

  var DEFAULT_OPEN_TIMEOUT_MS = 10000;
  var DEFAULT_DELETE_TIMEOUT_MS = 10000;

  /**
   * @class IndexedDBEngine
   * @param {Object} [options]
   * @param {*} [options.indexedDBImpl] - inject an `IDBFactory`-shaped
   *   object (real `window.indexedDB`, or a test double) instead of
   *   resolving one from the ambient global. Enables Node-side testing
   *   without a browser.
   * @param {string} [options.dbName] - defaults to IndexedDBSchema.DB_NAME.
   * @param {number} [options.dbVersion] - defaults to IndexedDBSchema.DB_VERSION.
   * @param {number} [options.openTimeoutMs] - defaults to 10000.
   * @param {number} [options.deleteTimeoutMs] - defaults to 10000.
   */
  function IndexedDBEngine(options) {
    options = options || {};
    this._indexedDB = options.indexedDBImpl || UtilsNS.getIndexedDB(root);
    this._dbName = options.dbName || SchemaNS.DB_NAME;
    this._dbVersion = options.dbVersion || SchemaNS.DB_VERSION;
    this._openTimeoutMs = options.openTimeoutMs || DEFAULT_OPEN_TIMEOUT_MS;
    this._deleteTimeoutMs = options.deleteTimeoutMs || DEFAULT_DELETE_TIMEOUT_MS;

    this._db = null;               // native IDBDatabase, once open
    this._openPromise = null;      // in-flight/settled open() promise (for databaseReady())
    this._lastUpgradeResult = null;
    this._onBlockedHandlers = [];  // optional external listeners, set via onBlocked()
  }

  // ----------------------------------------------------------------
  // Lifecycle
  // ----------------------------------------------------------------

  /**
   * open() -> Promise<IDBDatabase>
   * Idempotent: a second concurrent/subsequent call while a connection is
   * already open (or already opening) returns the same settled/in-flight
   * Promise rather than issuing a second `indexedDB.open()` — mirrors
   * `Repository.prototype.open()`'s own "already loaded" guard one layer
   * up, and StorageAdapter.js's documented expectation that a concrete
   * adapter "must be safely callable once before any read/write" (i.e.
   * safely callable repeatedly without side effects beyond the first).
   * @returns {Promise<IDBDatabase>}
   */
  IndexedDBEngine.prototype.open = function () {
    var self = this;

    if (this._db) {
      return Promise.resolve(this._db);
    }
    if (this._openPromise) {
      return this._openPromise;
    }

    try {
      UtilsNS.assertBrowserSupported({ indexedDB: this._indexedDB });
    } catch (unsupportedErr) {
      return Promise.reject(unsupportedErr);
    }

    var rawOpenPromise = new Promise(function (resolve, reject) {
      var request;
      try {
        request = self._indexedDB.open(self._dbName, self._dbVersion);
      } catch (syncErr) {
        reject(ErrorsNS.fromDOMException(syncErr, { dbName: self._dbName, op: 'open()' }));
        return;
      }

      request.onupgradeneeded = function (event) {
        try {
          self._lastUpgradeResult = VersionNS.applyUpgrade(
            request.result,
            request.transaction,
            event.oldVersion,
            event.newVersion
          );
        } catch (upgradeErr) {
          // Abort the versionchange transaction so a partially-applied
          // schema is never left committed; the abort's onerror/onabort
          // path below will surface the classified rejection.
          try { request.transaction.abort(); } catch (ignored) { /* already inactive */ }
          self._pendingUpgradeError = upgradeErr;
        }
      };

      request.onblocked = function () {
        var blockedErr = new ErrorsNS.BlockedError(
          'Opening "' + self._dbName + '" is blocked by another open connection ' +
          '(e.g. another tab) that has not closed yet.',
          { dbName: self._dbName }
        );
        for (var i = 0; i < self._onBlockedHandlers.length; i++) {
          try { self._onBlockedHandlers[i](blockedErr); } catch (ignored) { /* listener error is not this engine's concern */ }
        }
        reject(blockedErr);
      };

      request.onsuccess = function () {
        var db = request.result;
        // A later versionchange from ANOTHER connection/tab will fire
        // this event on our already-open handle; we close proactively so
        // that other connection's own upgrade is not itself blocked by
        // us (standard IndexedDB multi-tab courtesy).
        db.onversionchange = function () {
          try { db.close(); } catch (ignored) { /* already closing */ }
          self._db = null;
          self._openPromise = null;
        };
        self._db = db;
        resolve(db);
      };

      request.onerror = function () {
        var err = self._pendingUpgradeError ||
          ErrorsNS.fromDOMException(request.error, { dbName: self._dbName, op: 'open()' });
        self._pendingUpgradeError = null;
        reject(err);
      };
    });

    this._openPromise = UtilsNS.withTimeout(
      rawOpenPromise,
      this._openTimeoutMs,
      'Opening database "' + this._dbName + '" did not complete within ' + this._openTimeoutMs + 'ms'
    ).catch(function (err) {
      // A failed open must not permanently latch a stale in-flight
      // promise — clear it so a subsequent open() call gets a fresh
      // attempt instead of replaying the same rejection forever.
      self._openPromise = null;
      throw err;
    });

    return this._openPromise;
  };

  /**
   * close() -> Promise<void>
   * Closes the current connection, if any. No-op success if nothing is
   * open (matches StorageAdapter.js's documented `close()` contract:
   * "must not throw for nothing to close").
   * @returns {Promise<void>}
   */
  IndexedDBEngine.prototype.close = function () {
    if (this._db) {
      try {
        this._db.close();
      } catch (ignored) {
        // close() on a native IDBDatabase does not throw per spec; guarded
        // defensively only for a non-conformant test double.
      }
    }
    this._db = null;
    this._openPromise = null;
    return Promise.resolve();
  };

  /**
   * deleteDatabase() -> Promise<void>
   * Deletes the entire database from disk. Closes any open connection
   * first (a connection this engine itself holds cannot block its own
   * delete call).
   * @returns {Promise<void>}
   */
  IndexedDBEngine.prototype.deleteDatabase = function () {
    var self = this;
    return this.close().then(function () {
      try {
        UtilsNS.assertBrowserSupported({ indexedDB: self._indexedDB });
      } catch (unsupportedErr) {
        return Promise.reject(unsupportedErr);
      }

      var rawDeletePromise = new Promise(function (resolve, reject) {
        var request;
        try {
          request = self._indexedDB.deleteDatabase(self._dbName);
        } catch (syncErr) {
          reject(ErrorsNS.fromDOMException(syncErr, { dbName: self._dbName, op: 'deleteDatabase()' }));
          return;
        }

        request.onblocked = function () {
          var blockedErr = new ErrorsNS.BlockedError(
            'Deleting "' + self._dbName + '" is blocked by another open connection.',
            { dbName: self._dbName }
          );
          for (var i = 0; i < self._onBlockedHandlers.length; i++) {
            try { self._onBlockedHandlers[i](blockedErr); } catch (ignored) { /* listener error ignored */ }
          }
          reject(blockedErr);
        };
        request.onsuccess = function () { resolve(); };
        request.onerror = function () {
          reject(ErrorsNS.fromDOMException(request.error, { dbName: self._dbName, op: 'deleteDatabase()' }));
        };
      });

      return UtilsNS.withTimeout(
        rawDeletePromise,
        self._deleteTimeoutMs,
        'Deleting database "' + self._dbName + '" did not complete within ' + self._deleteTimeoutMs + 'ms'
      );
    });
  };

  /** isOpen() -> boolean — synchronous check: is a connection currently held? */
  IndexedDBEngine.prototype.isOpen = function () {
    return !!this._db;
  };

  /**
   * databaseReady() -> Promise<IDBDatabase>
   * Resolves once the current (or most recently started) `open()` call
   * settles. If `open()` was never called, this calls it. Distinct from
   * calling `open()` directly only in that a caller who merely wants to
   * "wait for whatever open in flight" reads more clearly with this name.
   * @returns {Promise<IDBDatabase>}
   */
  IndexedDBEngine.prototype.databaseReady = function () {
    return this.open();
  };

  /** onBlocked(handler) -> void — registers a listener invoked whenever
   *  an open()/deleteDatabase() call is blocked by another connection. */
  IndexedDBEngine.prototype.onBlocked = function (handler) {
    if (typeof handler === 'function') {
      this._onBlockedHandlers.push(handler);
    }
  };

  // ----------------------------------------------------------------
  // Integrity
  // ----------------------------------------------------------------

  /**
   * verifyIntegrity() -> Promise<{ok: boolean, connectionOpen: boolean, version: number|null, missingStores: string[], missingIndexes: Array}>
   * Validates: connection is open, reported version matches
   * `IndexedDBSchema.DB_VERSION`, and every declared store/index exists.
   * Opens a short-lived readonly transaction across all schema stores
   * purely to inspect index names — no records are read.
   * @returns {Promise<Object>}
   */
  IndexedDBEngine.prototype.verifyIntegrity = function () {
    var self = this;
    if (!this._db) {
      return Promise.resolve({
        ok: false,
        connectionOpen: false,
        version: null,
        missingStores: SchemaNS.getStoreNames(),
        missingIndexes: []
      });
    }

    var db = this._db;
    var storeNames = SchemaNS.getStoreNames().filter(function (name) {
      return db.objectStoreNames.contains(name);
    });

    var schemaCheck;
    try {
      if (storeNames.length === 0) {
        schemaCheck = VersionNS.verifySchema(db, null);
      } else {
        var tx = db.transaction(storeNames, 'readonly');
        schemaCheck = VersionNS.verifySchema(db, tx);
        // A readonly, no-request transaction completes on its own once
        // this synchronous inspection returns control to the event loop;
        // nothing further needs to be awaited here.
      }
    } catch (err) {
      return Promise.reject(ErrorsNS.fromDOMException(err, { dbName: self._dbName, op: 'verifyIntegrity()' }));
    }

    return Promise.resolve({
      ok: schemaCheck.ok && db.version === self._dbVersion,
      connectionOpen: true,
      version: db.version,
      missingStores: schemaCheck.missingStores,
      missingIndexes: schemaCheck.missingIndexes
    });
  };

  /** getLastUpgradeResult() -> the {appliedVersions, storesCreated} object
   *  from the most recent onupgradeneeded, or null if no upgrade ran. */
  IndexedDBEngine.prototype.getLastUpgradeResult = function () {
    return this._lastUpgradeResult;
  };

  /** getDatabaseName() / getDatabaseVersion() — plain accessors. */
  IndexedDBEngine.prototype.getDatabaseName = function () { return this._dbName; };
  IndexedDBEngine.prototype.getDatabaseVersion = function () { return this._dbVersion; };

  var api = {
    IndexedDBEngine: IndexedDBEngine
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  if (root) {
    root.IndexedDBEngine = api;
  }

})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
