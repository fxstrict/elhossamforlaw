/**
 * ================================================================
 * IndexedDBUtils.js — Shared Engine Utilities | نظام الحسام للمحاماة
 * ================================================================
 * PHASE 13.3A — IndexedDB Foundation — Database Engine Core
 *
 * WHAT THIS FILE IS
 *   Small, dependency-free helpers shared by IndexedDBEngine.js and
 *   IndexedDBTransaction.js: promisifying a native `IDBRequest`, racing a
 *   Promise against a timeout, and environment capability checks. Pure
 *   functions only — nothing here holds any connection or app state.
 *
 * WHAT THIS FILE IS NOT
 *   - It does not open, close, or upgrade any database itself.
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
    throw new Error('IndexedDBUtils requires js/core/IndexedDBErrors.js to be loaded first.');
  }

  /**
   * promisifyRequest(request, context) -> Promise<*>
   * Wraps a native `IDBRequest` (from `objectStore.get`, `.put`,
   * `.delete`, `.count`, `IDBIndex.openCursor`, etc.) in a Promise that
   * resolves with `request.result` on `onsuccess`, and rejects with a
   * classified `IndexedDBErrors` instance (via `fromDOMException`) on
   * `onerror`.
   * @param {IDBRequest} request
   * @param {{dbName?: string, storeName?: string, op?: string}} [context]
   */
  function promisifyRequest(request, context) {
    return new Promise(function (resolve, reject) {
      request.onsuccess = function () { resolve(request.result); };
      request.onerror = function () {
        reject(ErrorsNS.fromDOMException(request.error, context));
      };
    });
  }

  /**
   * withTimeout(promise, ms, timeoutMessage) -> Promise<*>
   * Races `promise` against a timer. If the timer fires first, rejects
   * with an `IndexedDBErrors.TimeoutError`; otherwise settles exactly as
   * `promise` does. Never leaves a dangling timer past settlement.
   * @param {Promise<*>} promise
   * @param {number} ms
   * @param {string} [timeoutMessage]
   */
  function withTimeout(promise, ms, timeoutMessage) {
    return new Promise(function (resolve, reject) {
      var settled = false;
      var timer = setTimeout(function () {
        if (settled) { return; }
        settled = true;
        reject(new ErrorsNS.TimeoutError(
          timeoutMessage || ('operation did not complete within ' + ms + 'ms')
        ));
      }, ms);

      promise.then(
        function (value) {
          if (settled) { return; }
          settled = true;
          clearTimeout(timer);
          resolve(value);
        },
        function (err) {
          if (settled) { return; }
          settled = true;
          clearTimeout(timer);
          reject(err);
        }
      );
    });
  }

  /**
   * getIndexedDB(globalObj) -> IDBFactory | null
   * Returns the environment's `indexedDB` factory, or null if the
   * environment has none (unsupported browser, or a Node runtime with no
   * IndexedDB shim injected).
   * @param {*} [globalObj] - defaults to the module's own root binding.
   */
  function getIndexedDB(globalObj) {
    var g = globalObj || root;
    return (g && g.indexedDB) ? g.indexedDB : null;
  }

  /**
   * assertBrowserSupported(globalObj) -> void
   * @throws {IndexedDBErrors.BrowserUnsupportedError} if no usable
   *   `indexedDB` global is present.
   */
  function assertBrowserSupported(globalObj) {
    if (!ErrorsNS.isBrowserSupported(globalObj || root)) {
      throw new ErrorsNS.BrowserUnsupportedError(
        'No usable indexedDB implementation is present in this environment.'
      );
    }
  }

  var api = {
    promisifyRequest: promisifyRequest,
    withTimeout: withTimeout,
    getIndexedDB: getIndexedDB,
    assertBrowserSupported: assertBrowserSupported
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  if (root) {
    root.IndexedDBUtils = api;
  }

})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
