/**
 * ================================================================
 * LocalStorageAdapter.js — localStorage Storage Adapter | نظام الحسام للمحاماة
 * ================================================================
 * V10 — Offline First Architecture
 * PHASE 8 — SUB-PHASE 8.3.2 — localStorage Adapter
 *
 * Source of design (no assumption outside these):
 *   - js/core/StorageAdapter.js (PHASE 8, SUB-PHASE 8.3.1) — the abstract
 *     base class this file subclasses. Every method signature, return
 *     shape, and error-timing rule documented there is followed exactly.
 *   - docs/DatabaseService_Contract_V1.md (PHASE 8, SUB-PHASE 8.2.1) — the
 *     shared DBError-style error vocabulary (`StorageError`,
 *     `ValidationError`, `NotFoundError`) this adapter's error objects
 *     borrow their `type` strings from (§2 "Shared Types").
 *   - js/core/Repository.js — the ONLY existing consumer of a storage-
 *     adapter-shaped object today. Its constructor validates via
 *     `assertStorageAdapter` (requires only `read`/`write`) and its
 *     `open()`/`_persist()` methods call exactly
 *     `adapter.read(this.entityKey)` and
 *     `adapter.write(this.entityKey, this._records)` — no other adapter
 *     method is called anywhere in Repository.js today. Read in full;
 *     NOT modified.
 *   - index.html (lines ~570-586) — the CURRENT, pre-existing runtime
 *     localStorage shape this adapter must stay byte-for-byte compatible
 *     with: one JSON array per bare key name (`localStorage['cases']`,
 *     `localStorage['clients']`, ... no prefix, no wrapper object).
 *
 * WHAT THIS FILE IS
 *   The FIRST concrete Storage Adapter: a thin, engine-specific binding of
 *   the abstract `StorageAdapter` interface to the browser's real
 *   `localStorage` (or an injected `localStorage`-shaped object, e.g. a
 *   Node test double exposing `getItem`/`setItem`/`removeItem`/`key`/
 *   `length`). It stores one JSON-serialized array per `entityKey`, using
 *   the entityKey itself as the literal `localStorage` key — identical to
 *   the format `index.html`'s own `saveLocal()`/`data.*` bootstrap already
 *   produces and reads today (Compatibility requirement).
 *
 * WHAT THIS FILE IS NOT
 *   - It is NOT DatabaseService. DatabaseService (a separate, later file —
 *     see DatabaseService_Contract_V1.md) is the future CONSUMER of this
 *     adapter (or a sibling adapter), not this file itself. This file
 *     defines no Cache, no Transaction Model, no per-record primitives, no
 *     Store Registry, no events, no locking, no migration.
 *   - It does NOT modify `js/core/Repository.js`, `js/core/
 *     StorageAdapter.js`, or any file under `js/repositories/*.js`. Those
 *     are read-only inputs to this phase, not outputs.
 *   - It does NOT validate records, generate ids, filter, sort, search,
 *     cache, migrate, or synchronize anything. It is storage only — pure
 *     whole-array get/set against one engine, exactly as narrow in scope
 *     as `StorageAdapter.js`'s own documented method surface.
 *   - It does NOT change any existing application behavior. It is not
 *     wired into `index.html`, not referenced by any Repository, and not
 *     loaded by any existing `<script>` tag.
 *
 * Load order: additive file, not yet wired into index.html. Depends only
 * on `js/core/StorageAdapter.js` having been loaded first (throws a clear
 * error otherwise — see guard below, mirrors the existing
 * FeesRepository.js-style dependency guard pattern).
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
      'LocalStorageAdapter requires js/core/StorageAdapter.js to be loaded ' +
      'first (StorageAdapter base class not found).'
    );
  }

  // ================================================================
  // 1. Error types — borrowed `type` vocabulary only (DatabaseService_
  //    Contract_V1.md §2's `DBError.type` union), NOT that Contract's
  //    richer DBError object itself (this adapter has no `store`/`key`
  //    fields, no Store Registry — it is one layer beneath that). Each is
  //    a real Error subclass, matching StorageAdapter.js's own
  //    NotImplementedError discipline (real stack trace, `instanceof`-
  //    safe), never a bare thrown string or plain object.
  // ================================================================

  /**
   * @class StorageError
   * Generic engine-level failure (localStorage unreachable, quota
   * exceeded, corrupt JSON on read, or any other non-validation failure
   * from the underlying engine). Mirrors `DatabaseService_Contract_V1.md`
   * §2's `StorageError` type string.
   * @param {string} message
   * @param {{entityKey?: string, cause?: *}} [extra]
   */
  function StorageError(message, extra) {
    extra = extra || {};
    this.message = message;
    this.name = 'StorageError';
    this.type = 'StorageError';
    this.entityKey = extra.entityKey != null ? extra.entityKey : null;
    this.cause = extra.cause != null ? extra.cause : null;
    this.recoverable = false;
    if (typeof Error.captureStackTrace === 'function') {
      Error.captureStackTrace(this, StorageError);
    } else {
      this.stack = (new Error(message)).stack;
    }
  }
  StorageError.prototype = Object.create(Error.prototype);
  StorageError.prototype.constructor = StorageError;
  StorageError.prototype.name = 'StorageError';

  /**
   * @class NotFoundError
   * Reserved for the shared `DatabaseService_Contract_V1.md` §2 error
   * vocabulary (`DBError.type` includes `'NotFoundError'`). Defined here
   * for taxonomy completeness and for any future strict-mode caller, but
   * — per `StorageAdapter.js`'s own documented contract for `delete()`
   * ("resolves successfully ... if entityKey did not exist to begin
   * with — deleting something already absent is not a failure condition
   * at this engine-agnostic layer") — this adapter's default `delete()`,
   * `clear()`, and `read()` methods never throw or reject with this type;
   * a missing key is treated as "empty", not "not found". It exists so a
   * future caller (or a future strict-mode option) has a structurally
   * correct type available without this file needing later modification.
   * @param {string} message
   * @param {{entityKey?: string}} [extra]
   */
  function NotFoundError(message, extra) {
    extra = extra || {};
    this.message = message;
    this.name = 'NotFoundError';
    this.type = 'NotFoundError';
    this.entityKey = extra.entityKey != null ? extra.entityKey : null;
    this.recoverable = false;
    if (typeof Error.captureStackTrace === 'function') {
      Error.captureStackTrace(this, NotFoundError);
    } else {
      this.stack = (new Error(message)).stack;
    }
  }
  NotFoundError.prototype = Object.create(Error.prototype);
  NotFoundError.prototype.constructor = NotFoundError;
  NotFoundError.prototype.name = 'NotFoundError';

  /**
   * @class ValidationError
   * Thrown ONLY when an input's type itself prevents serialization —
   * e.g. `write()`'s `records` argument is not an Array, or a value
   * inside it cannot be JSON-serialized at all (a circular reference, a
   * `BigInt`, ...). This is deliberately narrow: this adapter never
   * validates record SHAPE or business rules (Repository's job, one
   * layer up) — only whether the given input is even serializable.
   * Mirrors `DatabaseService_Contract_V1.md` §2's `ValidationError` type
   * string, scoped down to "structural, not business" exactly as that
   * Contract's §1 design constraints require one layer up too.
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

  // ================================================================
  // 2. LocalStorageAdapter — concrete StorageAdapter subclass
  // ================================================================

  /**
   * @class LocalStorageAdapter
   * @extends StorageAdapter
   *
   * Config shape (all optional):
   * {
   *   storageImpl: Object   A `localStorage`-shaped object exposing
   *                         `getItem`/`setItem`/`removeItem`/`key`/
   *                         `length` (e.g. a Node test double, matching
   *                         the exact pattern the existing
   *                         `verify_*_repository.js` harnesses already
   *                         use via `makeFakeStorage()`). Defaults to the
   *                         real global `localStorage` when running in a
   *                         browser and no override is given.
   *   keyPrefix:   string   Optional prefix prepended to every
   *                         `entityKey` before touching the underlying
   *                         engine. Defaults to `''` (no prefix) so the
   *                         literal `localStorage` keys produced/read are
   *                         byte-for-byte identical to the ones
   *                         `index.html`'s existing `saveLocal()`/
   *                         `data.*` bootstrap already uses today
   *                         (Compatibility requirement — see file
   *                         header).
   * }
   *
   * @param {Object} [config]
   */
  function LocalStorageAdapter(config) {
    StorageAdapter.call(this, config);
    config = config || {};

    /** @private the localStorage-shaped engine this instance is bound to.
     *  Resolved lazily in `open()`, not here — the constructor never
     *  touches the engine (mirrors `StorageAdapter`'s own base
     *  constructor being a pure no-op beyond config storage). */
    this._storageImplOverride = config.storageImpl || null;

    /** @private @type {?Object} the resolved engine handle, set by
     *  `open()`. `null` before `open()`/after `close()`/`destroy()`. */
    this._engine = null;

    /** @private */
    this._keyPrefix = typeof config.keyPrefix === 'string' ? config.keyPrefix : '';

    /** @private lifecycle flag — mirrors StorageAdapter.js's own
     *  documented "safely callable once" / no-op-when-already-closed
     *  discipline for open()/close(). */
    this._isOpen = false;
  }

  LocalStorageAdapter.prototype = Object.create(StorageAdapter.prototype);
  LocalStorageAdapter.prototype.constructor = LocalStorageAdapter;

  // ----------------------------------------------------------------
  // 2.1 Internal helpers (private — no entity/business awareness)
  // ----------------------------------------------------------------

  /** @private Resolves the engine to use: an injected override, else the
   *  real global `localStorage` if reachable, else `null`. Never throws —
   *  callers decide how to react to a `null` result. */
  function resolveEngine(adapter) {
    if (adapter._storageImplOverride) return adapter._storageImplOverride;
    if (typeof localStorage !== 'undefined' && localStorage) return localStorage;
    if (typeof window !== 'undefined' && window.localStorage) return window.localStorage;
    return null;
  }

  /** @private Applies this instance's configured key prefix to a raw
   *  entityKey. With the default empty prefix this is the identity
   *  function, which is exactly what keeps the produced `localStorage`
   *  key byte-for-byte identical to `index.html`'s existing bare-key
   *  format (Compatibility requirement). */
  function prefixedKey(adapter, entityKey) {
    return adapter._keyPrefix + entityKey;
  }

  /** @private Throws a synchronous, structural ValidationError when
   *  `entityKey` is not a non-empty string — every one of the five
   *  whole-entity methods needs a real key to address the engine with,
   *  and this is a caller programming error, not an engine condition. */
  function assertEntityKey(entityKey) {
    if (typeof entityKey !== 'string' || entityKey.length === 0) {
      throw new ValidationError(
        'LocalStorageAdapter requires a non-empty string entityKey; got: ' +
        (typeof entityKey) + '.',
        { entityKey: null }
      );
    }
  }

  /** @private Guards every read/write/delete/clear/exists call against
   *  "engine not available" (no localStorage reachable, or this instance
   *  was never `open()`-ed / already `close()`-d). Returns the live
   *  engine handle on success. Throws a StorageError synchronously
   *  otherwise — callers below always catch this inside their own
   *  Promise executor/async body, so it still surfaces as a rejection to
   *  the caller, never as a bare synchronous throw out of a public
   *  method (matching StorageAdapter.js's own documented rule that only
   *  the abstract base's own NotImplementedError throws synchronously).
   */
  function requireEngine(adapter, entityKey) {
    var engine = adapter._engine || resolveEngine(adapter);
    if (!engine) {
      throw new StorageError(
        'No localStorage-like engine is available for LocalStorageAdapter ' +
        '(no injected storageImpl, and no global localStorage reachable).',
        { entityKey: entityKey || null }
      );
    }
    return engine;
  }

  // ----------------------------------------------------------------
  // 2.2 Lifecycle
  // ----------------------------------------------------------------

  /**
   * open() -> Promise<void>
   * Resolves the engine handle (injected override, else the real global
   * `localStorage`) and verifies it is reachable. Idempotent — calling
   * `open()` again while already open is a no-op success (matches
   * `StorageAdapter.js`'s own documented "safely callable once" /
   * `Repository.prototype.open`'s own idempotency precedent).
   * @returns {Promise<void>}
   */
  LocalStorageAdapter.prototype.open = function () {
    var self = this;
    return new Promise(function (resolve, reject) {
      if (self._isOpen) { resolve(); return; }
      var engine = resolveEngine(self);
      if (!engine) {
        reject(new StorageError(
          'LocalStorageAdapter.open() failed: no localStorage-like engine ' +
          'is available (no injected storageImpl, and no global ' +
          'localStorage reachable in this environment).'
        ));
        return;
      }
      // Cheap reachability probe — mirrors a real browser's own failure
      // mode (e.g. localStorage disabled/blocked in some private-browsing
      // configurations throws synchronously on first access), without
      // writing any real data.
      try {
        if (typeof engine.getItem !== 'function' || typeof engine.setItem !== 'function') {
          throw new Error('engine is missing getItem()/setItem().');
        }
      } catch (err) {
        reject(new StorageError(
          'LocalStorageAdapter.open() failed: engine is unreachable or ' +
          'incomplete — ' + (err && err.message ? err.message : String(err)),
          { cause: err }
        ));
        return;
      }
      self._engine = engine;
      self._isOpen = true;
      resolve();
    });
  };

  /**
   * close() -> Promise<void>
   * Releases this instance's held engine reference. Never fails for
   * "nothing to close" (matches `StorageAdapter.js`'s documented no-op
   * rule) — `localStorage` itself has no connection handle to release,
   * so this is purely this instance's own bookkeeping.
   * @returns {Promise<void>}
   */
  LocalStorageAdapter.prototype.close = function () {
    var self = this;
    return new Promise(function (resolve) {
      self._isOpen = false;
      self._engine = null;
      resolve();
    });
  };

  /**
   * destroy() -> Promise<void>
   * Terminal teardown of this instance's own runtime state. Does NOT
   * delete any stored data (that is `clear()`'s job) — only this
   * instance's own `_engine`/`_isOpen` bookkeeping, via `close()`.
   * @returns {Promise<void>}
   */
  LocalStorageAdapter.prototype.destroy = function () {
    return this.close();
  };

  // ----------------------------------------------------------------
  // 2.3 Whole-Entity Storage Operations
  // ----------------------------------------------------------------

  /**
   * read(entityKey) -> Promise<Array<Object>>
   * Reads and JSON-parses the array stored at `entityKey`. Resolves `[]`
   * if the key has never been written (matches `index.html`'s existing
   * `JSON.parse(localStorage.getItem('cases')||'[]')` bootstrap exactly),
   * never `null`/`undefined`.
   * @param {string} entityKey
   * @returns {Promise<Array<Object>>}
   */
  LocalStorageAdapter.prototype.read = function (entityKey) {
    var self = this;
    return new Promise(function (resolve, reject) {
      try {
        assertEntityKey(entityKey);
        var engine = requireEngine(self, entityKey);
        var raw;
        try {
          raw = engine.getItem(prefixedKey(self, entityKey));
        } catch (err) {
          reject(new StorageError(
            'LocalStorageAdapter.read("' + entityKey + '") failed: engine ' +
            'getItem() threw — ' + (err && err.message ? err.message : String(err)),
            { entityKey: entityKey, cause: err }
          ));
          return;
        }
        if (raw == null) { resolve([]); return; }
        var parsed;
        try {
          parsed = JSON.parse(raw);
        } catch (err) {
          // Corrupt JSON — no dedicated CorruptionError exists in this
          // adapter's narrow error set (StorageError/NotFoundError/
          // ValidationError only, per this phase's scope), so a parse
          // failure on data already inside the engine is reported as a
          // StorageError, exactly as `DatabaseService_Contract_V1.md`
          // §2's own table treats "any write/read primitive" generic
          // engine-level failure not covered by a more specific type.
          reject(new StorageError(
            'LocalStorageAdapter.read("' + entityKey + '") failed: stored ' +
            'value is not valid JSON — ' + (err && err.message ? err.message : String(err)),
            { entityKey: entityKey, cause: err }
          ));
          return;
        }
        resolve(Array.isArray(parsed) ? parsed : []);
      } catch (err) {
        reject(err);
      }
    });
  };

  /**
   * write(entityKey, records) -> Promise<void>
   * Whole-array replace: JSON-serializes `records` and stores it verbatim
   * at `entityKey`. Matches `Repository.prototype._persist()`'s own call
   * shape exactly (`this._storage.write(this.entityKey, this._records)`).
   * @param {string} entityKey
   * @param {Array<Object>} records
   * @returns {Promise<void>}
   */
  LocalStorageAdapter.prototype.write = function (entityKey, records) {
    var self = this;
    return new Promise(function (resolve, reject) {
      try {
        assertEntityKey(entityKey);
        if (!Array.isArray(records)) {
          reject(new ValidationError(
            'LocalStorageAdapter.write("' + entityKey + '") requires ' +
            'records to be an Array; got: ' + (typeof records) + '.',
            { entityKey: entityKey }
          ));
          return;
        }
        var engine = requireEngine(self, entityKey);
        var serialized;
        try {
          serialized = JSON.stringify(records);
        } catch (err) {
          // Input type prevents serialization (circular reference,
          // BigInt, etc.) — this is exactly the "invalid input type"
          // case this phase's instructions reserve ValidationError for.
          reject(new ValidationError(
            'LocalStorageAdapter.write("' + entityKey + '") failed: ' +
            'records could not be JSON-serialized — ' +
            (err && err.message ? err.message : String(err)),
            { entityKey: entityKey, cause: err }
          ));
          return;
        }
        try {
          engine.setItem(prefixedKey(self, entityKey), serialized);
        } catch (err) {
          // Covers both a generic engine failure and a quota-exceeded
          // condition — this adapter's narrow error set has no dedicated
          // QuotaError, so both surface as StorageError (matches
          // DatabaseService_Contract_V1.md §2's own "StorageError:
          // generic engine-level failure not covered by a more specific
          // type" fallback rule).
          reject(new StorageError(
            'LocalStorageAdapter.write("' + entityKey + '") failed: engine ' +
            'setItem() threw — ' + (err && err.message ? err.message : String(err)),
            { entityKey: entityKey, cause: err }
          ));
          return;
        }
        resolve();
      } catch (err) {
        reject(err);
      }
    });
  };

  /**
   * delete(entityKey) -> Promise<void>
   * Removes the entire `entityKey` storage key from the engine. Resolves
   * successfully (never `NotFoundError`) if `entityKey` did not exist to
   * begin with — matches `StorageAdapter.js`'s documented contract for
   * this method exactly.
   * @param {string} entityKey
   * @returns {Promise<void>}
   */
  LocalStorageAdapter.prototype.delete = function (entityKey) {
    var self = this;
    return new Promise(function (resolve, reject) {
      try {
        assertEntityKey(entityKey);
        var engine = requireEngine(self, entityKey);
        try {
          engine.removeItem(prefixedKey(self, entityKey));
        } catch (err) {
          reject(new StorageError(
            'LocalStorageAdapter.delete("' + entityKey + '") failed: engine ' +
            'removeItem() threw — ' + (err && err.message ? err.message : String(err)),
            { entityKey: entityKey, cause: err }
          ));
          return;
        }
        resolve();
      } catch (err) {
        reject(err);
      }
    });
  };

  /**
   * clear() -> Promise<void>
   * Removes EVERY entity this adapter manages from the engine. Only keys
   * matching this instance's configured `keyPrefix` are removed — with
   * the default empty prefix (Compatibility mode), this means every key
   * currently in the engine, matching this method's own documented
   * "adapter-level full wipe" scope in `StorageAdapter.js`. Not called
   * anywhere by `Repository.js` today.
   * @returns {Promise<void>}
   */
  LocalStorageAdapter.prototype.clear = function () {
    var self = this;
    return new Promise(function (resolve, reject) {
      try {
        var engine = requireEngine(self);
        var keysToRemove = [];
        try {
          if (typeof engine.length === 'number' && typeof engine.key === 'function') {
            // Real localStorage / any engine exposing the standard
            // Storage interface's length+key() enumeration.
            for (var i = 0; i < engine.length; i++) {
              var k = engine.key(i);
              if (k != null && (self._keyPrefix === '' || k.indexOf(self._keyPrefix) === 0)) {
                keysToRemove.push(k);
              }
            }
          } else if (typeof engine._dump === 'function') {
            // Test-double fallback (matches the existing
            // `makeFakeStorage()._dump()` shape already used by
            // verify_*_repository.js harnesses), for engines that don't
            // implement length/key().
            var dump = engine._dump() || {};
            Object.keys(dump).forEach(function (k) {
              if (self._keyPrefix === '' || k.indexOf(self._keyPrefix) === 0) {
                keysToRemove.push(k);
              }
            });
          }
        } catch (err) {
          reject(new StorageError(
            'LocalStorageAdapter.clear() failed: could not enumerate ' +
            'engine keys — ' + (err && err.message ? err.message : String(err)),
            { cause: err }
          ));
          return;
        }
        try {
          keysToRemove.forEach(function (k) { engine.removeItem(k); });
        } catch (err) {
          reject(new StorageError(
            'LocalStorageAdapter.clear() failed: engine removeItem() threw — ' +
            (err && err.message ? err.message : String(err)),
            { cause: err }
          ));
          return;
        }
        resolve();
      } catch (err) {
        reject(err);
      }
    });
  };

  /**
   * exists(entityKey) -> Promise<boolean>
   * Cheap existence check via `getItem() !== null`, without JSON-parsing.
   * Never rejects — resolves `false` on an inconclusive/failed check,
   * matching `StorageAdapter.js`'s documented "existence checks are
   * advisory" rule exactly.
   * @param {string} entityKey
   * @returns {Promise<boolean>}
   */
  LocalStorageAdapter.prototype.exists = function (entityKey) {
    var self = this;
    return new Promise(function (resolve) {
      try {
        assertEntityKey(entityKey);
        var engine = requireEngine(self, entityKey);
        var raw = engine.getItem(prefixedKey(self, entityKey));
        resolve(raw != null);
      } catch (err) {
        resolve(false);
      }
    });
  };

  // ================================================================
  // 3. Exports
  // ================================================================

  var api = {
    LocalStorageAdapter: LocalStorageAdapter,
    StorageError: StorageError,
    NotFoundError: NotFoundError,
    ValidationError: ValidationError
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  if (root) {
    root.LocalStorageAdapter = LocalStorageAdapter;
    root.LocalStorageAdapterErrors = {
      StorageError: StorageError,
      NotFoundError: NotFoundError,
      ValidationError: ValidationError
    };
  }

})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
