/**
 * ================================================================
 * StorageAdapter.js — Storage Adapter Interface | نظام الحسام للمحاماة
 * ================================================================
 * V10 — Offline First Architecture
 * PHASE 8 — SUB-PHASE 8.3.1 — Storage Adapter Interface
 *
 * Source of design (no assumption outside these — see
 * StorageAdapter_Interface_Report.md "Input Reading" section):
 *   - DatabaseService_Contract_V1.md (PHASE 8, SUB-PHASE 8.2.1) — the public
 *     DatabaseService contract this adapter sits underneath.
 *   - js/core/Repository.js (Repository base class) — the ONLY existing
 *     consumer of a storage-adapter-shaped object today. Its constructor
 *     validates (`assertStorageAdapter`) and its `open()`/`_persist()`
 *     methods call exactly `adapter.read(entityKey)` and
 *     `adapter.write(entityKey, records)` — no other adapter method is
 *     called anywhere in Repository.js today (grounding fact carried over
 *     unchanged from DatabaseService_Contract_V1.md §0).
 *
 * WHAT THIS FILE IS
 *   A single, engine-agnostic, entity-agnostic Storage Adapter ABSTRACT
 *   BASE CLASS. It defines the full method surface a concrete storage
 *   engine binding (a future LocalStorageAdapter, IndexedDBAdapter,
 *   SQLiteAdapter, ...) must implement, and nothing more.
 *
 *   It owns:
 *     - The lifecycle method signatures (`open`, `close`, `destroy`)
 *     - The whole-entity storage method signatures (`read`, `write`,
 *       `delete`, `clear`, `exists`)
 *     - A single, shared `NotImplementedError` type every abstract method
 *       throws, so a caller can detect "this adapter method was never
 *       overridden" as a distinct, structured failure rather than a bare
 *       `TypeError: x is not a function` or silent undefined-behavior.
 *
 * WHAT THIS FILE IS NOT
 *   - It is NOT a localStorage adapter, an IndexedDB adapter, or any other
 *     concrete engine binding. None of those exist in this file or this
 *     phase (reserved for SUB-PHASE 8.3.2 — "localStorage Adapter").
 *   - It is NOT DatabaseService. DatabaseService (a separate, later file —
 *     see DatabaseService_Contract_V1.md) is the future CONSUMER of a
 *     concrete subclass of this abstract base, not this file itself.
 *   - It does NOT touch `localStorage`, `indexedDB`, `sessionStorage`,
 *     `fetch`, `window`, `document`, or any other Browser/DOM API. Every
 *     method body in this file is either the constructor (no-op beyond
 *     optional config storage) or a `throw new NotImplementedError(...)`
 *     — nothing else executes.
 *   - It does NOT modify `js/core/Repository.js` or any file under
 *     `js/repositories/*.js`. Those files are read-only inputs to this
 *     phase, not outputs.
 *   - It does NOT decide entity shapes, field names, validation rules, or
 *     any business logic of any kind — it is pure storage-engine
 *     plumbing, exactly as narrow in scope as Repository.js's own
 *     documented Storage Adapter Contract (§2 there).
 *
 * Load order: additive file, not yet wired into index.html, not yet
 * referenced by Repository.js or any Repository. Safe to load anywhere —
 * this file has zero dependency on any other project file.
 * ================================================================
 */

(function (root) {
  'use strict';

  // ================================================================
  // 1. NotImplementedError — the one error type this file introduces
  // ================================================================
  // Every abstract method below throws this, synchronously, the instant
  // it is called on a StorageAdapter instance that has not overridden it.
  // This is deliberately a real Error subclass (not a plain object, unlike
  // Repository's structured RepositoryErrorTypes) because it represents a
  // PROGRAMMING error (a concrete adapter forgot to implement a required
  // method), not a runtime/data condition a caller is expected to branch
  // on and recover from — it should surface exactly like any other
  // programmer-facing "not implemented" failure, with a real stack trace.

  /**
   * @class NotImplementedError
   * Thrown by every StorageAdapter abstract method that has not been
   * overridden by a concrete subclass.
   * @param {string} methodName - the abstract method that was called
   *   (e.g. 'read', 'open').
   * @param {string} [className='StorageAdapter'] - the constructor name
   *   of the instance the call was made on, for a clearer message when a
   *   concrete subclass only partially overrides the interface.
   */
  function NotImplementedError(methodName, className) {
    var name = className || 'StorageAdapter';
    // Deliberately NOT `Error.call(this, message)` — in V8 (and per spec),
    // invoking Error as a plain function returns a brand-new Error object
    // rather than initializing `this`, which silently breaks the
    // `instanceof NotImplementedError` prototype chain for callers that
    // branch on error type. Setting `message`/`name` directly on `this`
    // (constructed via `new NotImplementedError(...)`) keeps `this` as the
    // actual instance, so `instanceof` and `.constructor` both resolve
    // correctly.
    this.message = name + '.' + methodName + '() is not implemented. ' +
      'StorageAdapter is an abstract interface — a concrete subclass ' +
      '(e.g. a future LocalStorageAdapter) must override ' + methodName + '().';
    this.name = 'NotImplementedError';
    this.methodName = methodName;
    this.className = name;
    // Ensure a proper stack trace across engines that support it (V8's
    // Error.captureStackTrace), without depending on any Browser/DOM API —
    // this is a pure JS-engine capability check, falling back to a plain
    // Error's stack on engines without it.
    if (typeof Error.captureStackTrace === 'function') {
      Error.captureStackTrace(this, NotImplementedError);
    } else {
      this.stack = (new Error(this.message)).stack;
    }
  }
  NotImplementedError.prototype = Object.create(Error.prototype);
  NotImplementedError.prototype.constructor = NotImplementedError;
  NotImplementedError.prototype.name = 'NotImplementedError';

  /** @private throws a NotImplementedError for the given method name,
   *  tagged with the calling instance's actual constructor name so a
   *  partially-overridden subclass produces a useful message. */
  function abstractMethod(instance, methodName) {
    var className = (instance && instance.constructor && instance.constructor.name)
      ? instance.constructor.name
      : 'StorageAdapter';
    throw new NotImplementedError(methodName, className);
  }

  // ================================================================
  // 2. StorageAdapter — Abstract Base Class
  // ================================================================

  /**
   * @class StorageAdapter
   *
   * Engine-agnostic Storage Adapter interface. A concrete subclass binds
   * this interface to one real storage engine (localStorage, IndexedDB,
   * SQLite, an in-memory test double, ...) by overriding every method
   * below. This base class itself never touches any engine, Browser API,
   * or DOM — it exists purely to define and enforce the shape of the
   * interface (Contract-literal method set + NotImplementedError
   * discipline for anything left unimplemented).
   *
   * Config shape passed to the constructor (entirely optional — the base
   * class does not require or interpret any field; a concrete subclass
   * may define and validate its own config shape, e.g. a key prefix or a
   * connection string):
   * {
   *   [any]: *   No field is required or read by this base class itself.
   * }
   *
   * @param {Object} [config] - implementation-specific configuration,
   *   opaque to this base class. Stored verbatim on `this._config` purely
   *   as a convenience for subclasses; never read or validated here.
   */
  function StorageAdapter(config) {
    /** @protected opaque config bag for subclasses — never read by this
     *  base class itself. */
    this._config = config || {};
  }

  // ----------------------------------------------------------------
  // 2.1 Lifecycle
  // ----------------------------------------------------------------

  /**
   * open() -> Promise<void>
   * Opens/initializes the underlying storage engine connection (e.g.
   * validate a `localStorage` handle is reachable, open an IndexedDB
   * connection, open a SQLite file handle). Must be safely callable once
   * before any `read`/`write`/`delete`/`clear`/`exists` call — a concrete
   * subclass decides what "open" concretely means for its engine; this
   * base class only defines that the method exists and must resolve (or
   * reject) a Promise.
   *
   * @returns {Promise<void>} resolves once the engine connection is ready
   *   to accept storage calls.
   * @throws {NotImplementedError} always, in this abstract base class —
   *   thrown synchronously the instant this method is invoked on an
   *   instance that has not overridden it (not rejected as a Promise),
   *   so a caller immediately sees a real stack trace rather than an
   *   unhandled-rejection warning for what is a programming error, not a
   *   runtime storage condition.
   * @async A concrete override is expected to be asynchronous (or at
   *   minimum Promise-returning) even if the underlying engine happens to
   *   be synchronous today (mirrors `DatabaseService_Contract_V1.md` §3's
   *   own `open()` — every engine-facing method stays Promise-shaped so a
   *   future engine swap needs no caller changes).
   */
  StorageAdapter.prototype.open = function () {
    abstractMethod(this, 'open');
  };

  /**
   * close() -> Promise<void>
   * Begins an orderly shutdown of the engine connection this adapter
   * holds (release any handle/connection a concrete subclass opened in
   * `open()`). Must not throw for "nothing to close" — a concrete
   * subclass should treat an already-closed/never-opened state as a
   * no-op success, not an error condition.
   *
   * @returns {Promise<void>} resolves once the connection is released.
   * @throws {NotImplementedError} always, in this abstract base class —
   *   thrown synchronously.
   * @async Expected to be asynchronous in a concrete override, for the
   *   same future-engine-compatibility reason as `open()` above.
   */
  StorageAdapter.prototype.close = function () {
    abstractMethod(this, 'close');
  };

  /**
   * destroy() -> Promise<void>
   * Terminal teardown of this adapter INSTANCE's own runtime state (in-
   * flight handles, any internal buffers/caches the concrete subclass
   * keeps) — calls the concrete subclass's own `close()` semantics
   * internally where relevant, but does NOT delete the underlying stored
   * data itself (that is what `clear()` below is for). Reserved for
   * instance-replacement / tab-teardown scenarios.
   *
   * @returns {Promise<void>} resolves once this adapter instance's own
   *   runtime state has been torn down.
   * @throws {NotImplementedError} always, in this abstract base class —
   *   thrown synchronously.
   * @async Expected to be asynchronous in a concrete override.
   */
  StorageAdapter.prototype.destroy = function () {
    abstractMethod(this, 'destroy');
  };

  // ----------------------------------------------------------------
  // 2.2 Whole-Entity Storage Operations
  // ----------------------------------------------------------------
  // These five methods operate at the SAME granularity Repository.js's
  // own two adapter call sites already use today: one whole entity's
  // array of records, keyed by `entityKey` (e.g. 'cases', 'clients') —
  // never a single record within that array. Per-record operations are a
  // DatabaseService-layer concept (DatabaseService_Contract_V1.md §4's
  // `read(storeName, key)`/`write(storeName, key, record)`), not this
  // adapter's — a concrete DatabaseService implementation is expected to
  // hold each Store's full array in memory (its own Cache Model,
  // DatabaseService_Contract_V1.md §8) and use THIS adapter only for the
  // coarse whole-array read/write/delete/clear/exists primitives that
  // sit underneath that Cache.

  /**
   * read(entityKey) -> Promise<Array<Object>>
   * Reads the full array of records currently stored for one entity.
   *
   * @param {string} entityKey - the storage key identifying one entity's
   *   whole record set (e.g. `'cases'`, `'clients'`, `'sessions'`) —
   *   matches `Repository.prototype.entityKey` exactly (Repository.js
   *   line 292: `this._storage.read(this.entityKey)`).
   * @returns {Promise<Array<Object>>} resolves with the stored array, or
   *   an empty array (`[]`) if `entityKey` has never been written before
   *   — never `null`/`undefined` (mirrors the `Array.isArray(loaded) ?
   *   loaded : []` guard `Repository.prototype.open` already applies at
   *   its own layer, Repository.js line 293 — a concrete adapter is
   *   expected to provide that same guarantee one layer down, so callers
   *   never need to re-guard).
   * @throws {NotImplementedError} always, in this abstract base class —
   *   thrown synchronously.
   *   A concrete override is expected to reject its Promise (never throw
   *   synchronously) on a real storage-engine read failure — synchronous
   *   throwing is reserved for exactly this base class's own
   *   "unimplemented" condition.
   * @async Always asynchronous — a concrete engine binding may be
   *   synchronous internally (e.g. `localStorage.getItem`) but must still
   *   return a Promise, so Repository.js's `await this._storage.read(...)`
   *   (which already awaits unconditionally, Repository.js's own
   *   documented "never assumes these are synchronous or asynchronous"
   *   rule, line 127) keeps working unchanged for any future engine.
   */
  StorageAdapter.prototype.read = function (entityKey) {
    abstractMethod(this, 'read');
  };

  /**
   * write(entityKey, records) -> Promise<void>
   * Writes (replaces in full) the array of records stored for one entity.
   * This is always a whole-array replace, never a per-record merge or
   * patch — matches `Repository.prototype._persist()`'s own call shape
   * exactly (Repository.js line 577:
   * `this._storage.write(this.entityKey, this._records)`).
   *
   * @param {string} entityKey - the storage key identifying one entity's
   *   whole record set.
   * @param {Array<Object>} records - the complete replacement array for
   *   this entity. Must be serializable by the concrete storage engine
   *   (e.g. JSON-serializable for a `localStorage`-backed subclass) — this
   *   base class defines no serialization behavior itself.
   * @returns {Promise<void>} resolves once the write is durably applied
   *   by the concrete storage engine.
   * @throws {NotImplementedError} always, in this abstract base class —
   *   thrown synchronously.
   *   A concrete override is expected to reject its Promise (never throw
   *   synchronously) on a real storage-engine write failure (e.g. a quota
   *   error) — Repository.js's `_persist()` already wraps its `await` in
   *   a `try/catch` expecting exactly a rejected Promise, not a
   *   synchronous throw (Repository.js lines 576-584).
   * @async Always asynchronous, for the same future-engine-compatibility
   *   reason as `read()` above.
   */
  StorageAdapter.prototype.write = function (entityKey, records) {
    abstractMethod(this, 'write');
  };

  /**
   * delete(entityKey) -> Promise<void>
   * Removes an entire entity's stored record set from the underlying
   * engine (the whole-array key itself is deleted, not any single record
   * within it — for that, a caller writes a shorter array via `write()`
   * instead). Not called anywhere by Repository.js today (Repository.js
   * has no operation that deletes an entire entity's storage key — its
   * own `clear()` empties the array via `write(entityKey, [])`, it does
   * not remove the key). This method exists on the interface for a
   * future DatabaseService-level entity-removal/reset primitive that is
   * more explicit than "write an empty array" (e.g. distinguishing "this
   * entity has zero records" from "this entity's storage key never
   * existed" for a future engine where that distinction is meaningful,
   * such as IndexedDB object-store deletion).
   *
   * @param {string} entityKey - the storage key identifying one entity's
   *   whole record set to remove entirely.
   * @returns {Promise<void>} resolves once the entity's storage key has
   *   been removed. Resolves successfully (not an error) if `entityKey`
   *   did not exist to begin with — deleting something already absent is
   *   not a failure condition at this engine-agnostic layer.
   * @throws {NotImplementedError} always, in this abstract base class —
   *   thrown synchronously.
   *   A concrete override is expected to reject its Promise (never throw
   *   synchronously) on a genuine engine-level failure.
   * @async Always asynchronous.
   */
  StorageAdapter.prototype.delete = function (entityKey) {
    abstractMethod(this, 'delete');
  };

  /**
   * clear() -> Promise<void>
   * Removes EVERY entity this adapter manages from the underlying engine
   * — the adapter-level counterpart of a full-database wipe (distinct
   * from, and broader than, any single Repository's own `clear()`, which
   * only empties that one Repository's entity via `write(entityKey, [])`
   * — Repository.js never calls this adapter-level `clear()` at all
   * today; it is reserved for a future DatabaseService-level
   * `clearAllData()`-equivalent primitive that needs to reset the entire
   * underlying engine at once, e.g. for tests or a full app data reset).
   *
   * @returns {Promise<void>} resolves once every entity managed by this
   *   adapter has been removed from the underlying engine.
   * @throws {NotImplementedError} always, in this abstract base class —
   *   thrown synchronously.
   *   A concrete override is expected to reject its Promise (never throw
   *   synchronously) on a genuine engine-level failure.
   * @async Always asynchronous.
   */
  StorageAdapter.prototype.clear = function () {
    abstractMethod(this, 'clear');
  };

  /**
   * exists(entityKey) -> Promise<boolean>
   * Checks whether a storage key exists for the given entity, without
   * necessarily materializing (reading/parsing) its full record array —
   * a concrete subclass may implement this as a cheap existence check
   * (e.g. `localStorage.getItem(entityKey) !== null`) rather than calling
   * its own `read()` internally, though a naive
   * `(await this.read(entityKey)).length > 0`-style implementation is
   * also a valid (if less optimal) override. Not called anywhere by
   * Repository.js today — reserved for a future DatabaseService-level
   * existence check equivalent to `DatabaseService_Contract_V1.md` §4's
   * own per-record `exists(storeName, key)`, but at this adapter's
   * whole-entity granularity.
   *
   * @param {string} entityKey - the storage key identifying one entity's
   *   whole record set.
   * @returns {Promise<boolean>} resolves `true` if a storage key exists
   *   for `entityKey` (even if its stored array is empty — existence of
   *   the key, not non-emptiness of its contents, is what this method
   *   answers), `false` otherwise. Never resolves `null`/`undefined`.
   * @throws {NotImplementedError} always, in this abstract base class —
   *   thrown synchronously.
   *   A concrete override is expected to resolve `false` (not reject) on
   *   an inconclusive/failed check — existence checks are advisory, per
   *   the same principle `DatabaseService_Contract_V1.md` §4 already
   *   states for its own `exists()`: "a read failure resolves `false`
   *   rather than rejecting."
   * @async Always asynchronous, for the same future-engine-compatibility
   *   reason as every other method on this interface.
   */
  StorageAdapter.prototype.exists = function (entityKey) {
    abstractMethod(this, 'exists');
  };

  // ================================================================
  // 3. Exports
  // ================================================================

  var api = {
    StorageAdapter: StorageAdapter,
    NotImplementedError: NotImplementedError
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  if (root) {
    root.StorageAdapter = StorageAdapter;
    root.NotImplementedError = NotImplementedError;
  }

})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
