/**
 * ================================================================
 * IndexedDBTransaction.js — Transaction Helper | نظام الحسام للمحاماة
 * ================================================================
 * PHASE 13.3A — IndexedDB Foundation — Database Engine Core
 *
 * WHAT THIS FILE IS
 *   A thin, Promise-based wrapper around a native `IDBTransaction`,
 *   supporting readonly/readwrite mode and single- or multi-store scope.
 *   It exposes `run()` (execute a callback with access to the wrapped
 *   store handles and await its own completion), plus explicit
 *   `abort()`. Built per Phase 13.3A's instruction: "Do NOT connect it
 *   yet" — this file is created and independently testable, but
 *   IndexedDBEngine.js's `open()` does not invoke it anywhere in this
 *   phase.
 *
 * WHAT THIS FILE IS NOT
 *   - It does not open a database connection itself — it is handed an
 *     already-open `IDBDatabase` by its caller.
 *   - It does not know about entities, records, or Repository shapes —
 *     pure store/transaction plumbing only.
 *   - It does not modify Repository.js, StorageAdapter.js,
 *     LocalStorageAdapter.js, DatabaseService.js, or any Repository.
 * ================================================================
 */

(function (root) {
  'use strict';

  var ErrorsNS = (typeof module !== 'undefined' && module.exports)
    ? require('./IndexedDBErrors.js')
    : root.IndexedDBErrors;

  if (!ErrorsNS) {
    throw new Error('IndexedDBTransaction requires js/core/IndexedDBErrors.js to be loaded first.');
  }

  /**
   * @class IndexedDBTransaction
   * @param {IDBDatabase} db - an already-open native database connection.
   * @param {string|string[]} storeNames - one store name, or an array of
   *   store names, this transaction spans.
   * @param {'readonly'|'readwrite'} [mode='readonly']
   */
  function IndexedDBTransaction(db, storeNames, mode) {
    if (!db) {
      throw new Error('IndexedDBTransaction requires an open IDBDatabase instance.');
    }
    this._db = db;
    this._storeNames = Array.isArray(storeNames) ? storeNames.slice() : [storeNames];
    this._mode = (mode === 'readwrite') ? 'readwrite' : 'readonly';
    this._nativeTx = null;
    this._state = 'idle'; // idle -> active -> committed | aborted
  }

  /** @returns {'idle'|'active'|'committed'|'aborted'} current lifecycle state. */
  IndexedDBTransaction.prototype.getState = function () {
    return this._state;
  };

  /** @returns {IDBTransaction|null} the underlying native transaction, once active. */
  IndexedDBTransaction.prototype.getNativeTransaction = function () {
    return this._nativeTx;
  };

  /** @returns {IDBObjectStore} a store handle from the active native transaction. */
  IndexedDBTransaction.prototype.objectStore = function (name) {
    if (this._state !== 'active') {
      throw new Error('IndexedDBTransaction.objectStore("' + name + '") called outside an active run().');
    }
    return this._nativeTx.objectStore(name);
  };

  /**
   * run(callback) -> Promise<*>
   * Opens a native `IDBTransaction` spanning this instance's store
   * names/mode, invokes `callback(this)` synchronously (per IndexedDB's
   * own requirement that all requests be issued within the same
   * event-loop tick the transaction was created in), and returns a
   * Promise that:
   *   - resolves with whatever `callback` returned, once the native
   *     transaction's `oncomplete` fires;
   *   - rejects with a classified `IndexedDBErrors` instance if the
   *     native transaction's `onerror`/`onabort` fires, or if `callback`
   *     itself throws synchronously (the transaction is then aborted
   *     explicitly, single-store or multi-store, so no partial writes
   *     are left committed).
   * @param {function(IndexedDBTransaction): *} callback
   * @returns {Promise<*>}
   */
  IndexedDBTransaction.prototype.run = function (callback) {
    var self = this;
    return new Promise(function (resolve, reject) {
      var callbackResult;
      var nativeTx;
      try {
        nativeTx = self._db.transaction(self._storeNames, self._mode);
      } catch (syncErr) {
        self._state = 'aborted';
        reject(ErrorsNS.fromDOMException(syncErr, { op: 'transaction()' }));
        return;
      }

      self._nativeTx = nativeTx;
      self._state = 'active';

      nativeTx.oncomplete = function () {
        self._state = 'committed';
        resolve(callbackResult);
      };
      nativeTx.onerror = function () {
        self._state = 'aborted';
        reject(ErrorsNS.fromDOMException(nativeTx.error, { op: 'transaction' }));
      };
      nativeTx.onabort = function () {
        self._state = 'aborted';
        var nativeErr = nativeTx.error;
        reject(nativeErr
          ? ErrorsNS.fromDOMException(nativeErr, { op: 'transaction' })
          : new ErrorsNS.AbortError('IndexedDB transaction aborted.'));
      };

      try {
        callbackResult = callback(self);
      } catch (cbErr) {
        // A synchronous throw inside the callback must abort the
        // transaction explicitly so no requests already issued before
        // the throw are left to commit partially.
        try { nativeTx.abort(); } catch (ignored) { /* already inactive */ }
        // onabort above will still fire and reject with the classified
        // native error; but if this environment does not deliver
        // onabort synchronously/at all, fall back to rejecting with the
        // original callback error directly.
        setTimeout(function () {
          if (self._state !== 'aborted') {
            self._state = 'aborted';
            reject(cbErr);
          }
        }, 0);
      }
    });
  };

  /**
   * abort() -> void
   * Explicitly aborts the in-flight native transaction, if one is
   * currently active. No-op if this instance has no active transaction
   * (never opened, or already committed/aborted).
   */
  IndexedDBTransaction.prototype.abort = function () {
    if (this._state === 'active' && this._nativeTx) {
      this._nativeTx.abort();
    }
  };

  var api = {
    IndexedDBTransaction: IndexedDBTransaction
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  if (root) {
    root.IndexedDBTransaction = api;
  }

})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
