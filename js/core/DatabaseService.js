/**
 * ================================================================
 * DatabaseService.js — DatabaseService Core Skeleton | نظام الحسام للمحاماة
 * ================================================================
 * V10 — Offline First Architecture
 * PHASE 8 — SUB-PHASE 8.4.1 — DatabaseService Core Skeleton
 *
 * Source of design (no assumption outside these):
 *   - docs/DatabaseService_Contract_V1.md (PHASE 8, SUB-PHASE 8.2.1) — the
 *     full, future public Contract (Lifecycle §3, per-record Storage §4,
 *     Transactions §5, Bulk Operations §6, Metadata §7). This skeleton
 *     implements ONLY the Lifecycle method names (`open`/`close`/
 *     `destroy`) plus the whole-entity Storage method NAMES this phase's
 *     instructions request (`read`/`write`/`delete`/`clear`/`exists`) —
 *     at the Storage Adapter's own whole-entity signature shape (§0
 *     below), not yet the Contract's richer per-record
 *     `(storeName, key[, record])` shape. Every other section of that
 *     Contract (Transactions, Bulk Operations, Metadata, Events,
 *     Migration, Cache) is explicitly OUT OF SCOPE for this sub-phase and
 *     is not present anywhere in this file.
 *   - js/core/StorageAdapter.js (PHASE 8, SUB-PHASE 8.3.1) — the abstract
 *     interface this skeleton's single injected `adapter` is expected to
 *     satisfy. Read in full; NOT modified.
 *   - js/core/LocalStorageAdapter.js (PHASE 8, SUB-PHASE 8.3.2) — the one
 *     existing concrete `StorageAdapter` this skeleton will actually be
 *     handed at runtime. Read in full; NOT modified.
 *   - js/core/Repository.js — read in full to reconfirm the grounding
 *     fact already established in `DatabaseService_Contract_V1.md` §0:
 *     Repository touches its own injected adapter in exactly two places
 *     (`read(entityKey)` / `write(entityKey, records)`) and awaits both
 *     unconditionally. NOT modified, NOT wired to this file in this
 *     phase (that is SUB-PHASE 8.4.2+'s "Repository Wiring" job, per this
 *     phase's own closing line).
 *
 * WHAT THIS FILE IS
 *   A minimal, single-adapter DatabaseService SKELETON: a class that
 *   receives exactly one Storage Adapter instance in its constructor and
 *   exposes the Lifecycle + whole-entity Storage method NAMES a future,
 *   richer DatabaseService will eventually expose — but every method body
 *   here does nothing except delegate the call, unchanged, straight to
 *   the injected adapter's own same-named method, and return (or reject
 *   with) exactly what that adapter call returns (or rejects with).
 *
 *   It owns, in this phase, ONLY:
 *     - The constructor's `adapter` shape guard (duck-typed, mirrors
 *       `Repository.js`'s own `assertStorageAdapter` discipline one layer
 *       up, but checking the full 8-method `StorageAdapter` surface since
 *       this skeleton calls all 8, not just `read`/`write`).
 *     - The 8 requested methods themselves, and NOTHING else — no
 *       lifecycle-state bookkeeping, no extra convenience methods beyond
 *       the 9 this phase's instructions literally name (`constructor`,
 *       `open`, `close`, `destroy`, `read`, `write`, `delete`, `clear`,
 *       `exists`). Every one of the 8 methods is a single-line `return
 *       this._adapter.<method>(...)` — the exact same Promise the
 *       adapter itself returns is handed back to the caller unchanged
 *       (not a derived/wrapped Promise), so a resolution or a rejection
 *       passes through with zero intermediate logic of any kind.
 *
 * WHAT THIS FILE IS NOT
 *   - It is NOT the full `DatabaseService_Contract_V1.md` surface. No
 *     Cache (§Design Report), no Transaction Model (§5), no Bulk
 *     Operations (§6), no Metadata Store (§7), no Events, no Migration,
 *     no Store Registry, no multi-store routing. A future sub-phase adds
 *     these on top of this skeleton; none of it exists here.
 *   - It does NOT validate records, generate ids, filter, sort, search,
 *     cache, transact, migrate, or synchronize anything. Every one of
 *     the 8 implemented methods is a one-line delegation to `this._adapter`.
 *   - It does NOT modify `js/core/Repository.js`, `js/core/
 *     StorageAdapter.js`, or `js/core/LocalStorageAdapter.js`. All three
 *     are read-only inputs to this phase, not outputs.
 *   - It does NOT wire itself into any Repository, any Module, or
 *     `index.html`. It is not yet a Storage-Adapter-shaped object itself
 *     from a Repository's point of view — that bridging is explicitly
 *     deferred to "Repository Wiring", the next sub-phase this report's
 *     closing line names.
 *   - It does NOT swallow or re-type any exception/rejection the adapter
 *     produces. A `StorageError`/`NotFoundError`/`ValidationError` (or
 *     any other error) raised by the adapter passes through this file
 *     completely unchanged — this file introduces zero new error types.
 *
 * Load order: additive file, not yet wired into index.html, not yet
 * referenced by Repository.js or any Repository. Depends only on
 * `js/core/StorageAdapter.js` having been loaded first (for the
 * `instanceof` shape check below) — throws a clear error otherwise,
 * mirroring the existing `LocalStorageAdapter.js`/`FeesRepository.js`-
 * style dependency guard pattern.
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
      'DatabaseService requires js/core/StorageAdapter.js to be loaded ' +
      'first (StorageAdapter base class not found).'
    );
  }

  // ================================================================
  // 0. Grounding fact carried forward unchanged from
  //    DatabaseService_Contract_V1.md §0 / this file's own header:
  //    the ONLY methods this skeleton needs to delegate, and their
  //    exact whole-entity signatures, are the 8 named in this phase's
  //    instructions — nothing about `storeName`/per-record shapes is
  //    introduced here.
  // ================================================================

  var REQUIRED_ADAPTER_METHODS = [
    'open', 'close', 'destroy', 'read', 'write', 'delete', 'clear', 'exists'
  ];

  /**
   * Validates (duck-typing only, mirrors `Repository.js`'s own
   * `assertStorageAdapter`) that the injected object exposes every method
   * this skeleton will call on it. Throws synchronously — a constructor-
   * time shape mismatch is a programming error, not a runtime storage
   * condition, exactly the same category `Repository.js`'s own
   * constructor guard already treats it as.
   * @param {*} adapter
   */
  function assertAdapterShape(adapter) {
    if (!adapter || typeof adapter !== 'object') {
      throw new Error(
        'DatabaseService requires a StorageAdapter instance (an object ' +
        'exposing open/close/destroy/read/write/delete/clear/exists) to ' +
        'be injected into its constructor.'
      );
    }
    for (var i = 0; i < REQUIRED_ADAPTER_METHODS.length; i++) {
      var method = REQUIRED_ADAPTER_METHODS[i];
      if (typeof adapter[method] !== 'function') {
        throw new Error(
          'DatabaseService requires the injected adapter to implement ' +
          method + '() — missing on the object passed to the constructor.'
        );
      }
    }
  }

  // ================================================================
  // 1. DatabaseService — Core Skeleton
  // ================================================================

  /**
   * @class DatabaseService
   *
   * @param {StorageAdapter} adapter - a single Storage Adapter instance
   *   (e.g. a `LocalStorageAdapter`) satisfying the full 8-method
   *   `StorageAdapter` surface. Stored verbatim on `this._adapter`; never
   *   wrapped, cloned, or reconfigured.
   */
  function DatabaseService(adapter) {
    assertAdapterShape(adapter);

    /** @private the single injected Storage Adapter every method below
     *  delegates to, unchanged. */
    this._adapter = adapter;
  }

  // ----------------------------------------------------------------
  // 1.1 Lifecycle — pure delegation to the adapter's own lifecycle
  // ----------------------------------------------------------------

  /**
   * open() -> Promise<void>
   * Delegates directly to `adapter.open()`. Returns the adapter's own
   * Promise unchanged — no state tracking, no follow-up logic.
   * @returns {Promise<void>}
   */
  DatabaseService.prototype.open = function () {
    return this._adapter.open();
  };

  /**
   * close() -> Promise<void>
   * Delegates directly to `adapter.close()`.
   * @returns {Promise<void>}
   */
  DatabaseService.prototype.close = function () {
    return this._adapter.close();
  };

  /**
   * destroy() -> Promise<void>
   * Delegates directly to `adapter.destroy()`.
   * @returns {Promise<void>}
   */
  DatabaseService.prototype.destroy = function () {
    return this._adapter.destroy();
  };

  // ----------------------------------------------------------------
  // 1.2 Whole-Entity Storage Operations — pure delegation, same
  //     signatures as StorageAdapter.js §2.2 exactly.
  // ----------------------------------------------------------------

  /**
   * read(entityKey) -> Promise<Array<Object>>
   * Delegates directly to `adapter.read(entityKey)`. No default value,
   * no shape check, no cache lookup — whatever the adapter resolves or
   * rejects with is returned/thrown unchanged.
   * @param {string} entityKey
   * @returns {Promise<Array<Object>>}
   */
  DatabaseService.prototype.read = function (entityKey) {
    return this._adapter.read(entityKey);
  };

  /**
   * write(entityKey, records) -> Promise<void>
   * Delegates directly to `adapter.write(entityKey, records)`. No
   * validation of `records`, no id generation, no transaction wrapping —
   * that is entirely the adapter's own concern at this skeleton's layer.
   * @param {string} entityKey
   * @param {Array<Object>} records
   * @returns {Promise<void>}
   */
  DatabaseService.prototype.write = function (entityKey, records) {
    return this._adapter.write(entityKey, records);
  };

  /**
   * delete(entityKey) -> Promise<void>
   * Delegates directly to `adapter.delete(entityKey)`.
   * @param {string} entityKey
   * @returns {Promise<void>}
   */
  DatabaseService.prototype.delete = function (entityKey) {
    return this._adapter.delete(entityKey);
  };

  /**
   * clear() -> Promise<void>
   * Delegates directly to `adapter.clear()`.
   * @returns {Promise<void>}
   */
  DatabaseService.prototype.clear = function () {
    return this._adapter.clear();
  };

  /**
   * exists(entityKey) -> Promise<boolean>
   * Delegates directly to `adapter.exists(entityKey)`.
   * @param {string} entityKey
   * @returns {Promise<boolean>}
   */
  DatabaseService.prototype.exists = function (entityKey) {
    return this._adapter.exists(entityKey);
  };

  // ================================================================
  // 2. Exports
  // ================================================================

  var api = {
    DatabaseService: DatabaseService
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  if (root) {
    root.DatabaseService = DatabaseService;
  }

})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
