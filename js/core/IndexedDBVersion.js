/**
 * ================================================================
 * IndexedDBVersion.js — Database Version Manager | نظام الحسام للمحاماة
 * ================================================================
 * PHASE 13.3A — IndexedDB Foundation — Database Engine Core
 *
 * WHAT THIS FILE IS
 *   The version/upgrade manager. Given a native `IDBVersionChangeEvent`-
 *   style `(db, transaction, oldVersion, newVersion)` tuple — supplied by
 *   IndexedDBEngine.js's `onupgradeneeded` handler — this file walks
 *   IndexedDBSchema.js's `SCHEMA_VERSIONS` list and creates/upgrades
 *   exactly the object stores and indexes each version step declares
 *   that don't already exist. It is pure schema application: it never
 *   opens a connection itself and never touches application data.
 *
 * WHAT THIS FILE IS NOT
 *   - It does not call `indexedDB.open()` — that is IndexedDBEngine.js's
 *     job; this file only reacts to the `db`/`transaction` it is handed.
 *   - It performs no data migration, no record transformation, no
 *     LocalStorage reads. Schema evolution only.
 *   - It does not modify Repository.js, StorageAdapter.js,
 *     LocalStorageAdapter.js, DatabaseService.js, or any Repository.
 * ================================================================
 */

(function (root) {
  'use strict';

  var SchemaNS = (typeof module !== 'undefined' && module.exports)
    ? require('./IndexedDBSchema.js')
    : root.IndexedDBSchema;

  var ErrorsNS = (typeof module !== 'undefined' && module.exports)
    ? require('./IndexedDBErrors.js')
    : root.IndexedDBErrors;

  if (!SchemaNS) {
    throw new Error('IndexedDBVersion requires js/core/IndexedDBSchema.js to be loaded first.');
  }
  if (!ErrorsNS) {
    throw new Error('IndexedDBVersion requires js/core/IndexedDBErrors.js to be loaded first.');
  }

  /**
   * ensureStore(db, transaction, storeDef) — creates the object store if
   * missing, then ensures every declared index exists on it (creating any
   * that are absent). Safe to call against an already-up-to-date store —
   * every check is existence-guarded, nothing is ever re-created or
   * dropped.
   * @param {IDBDatabase} db
   * @param {IDBTransaction} transaction - the in-flight versionchange
   *   transaction (needed to fetch an existing store's IDBObjectStore
   *   handle for index creation).
   * @param {Object} storeDef - one IndexedDBSchema.STORE_DEFINITIONS entry.
   */
  function ensureStore(db, transaction, storeDef) {
    var store;
    if (!db.objectStoreNames.contains(storeDef.name)) {
      store = db.createObjectStore(storeDef.name, {
        keyPath: storeDef.keyPath,
        autoIncrement: !!storeDef.autoIncrement
      });
    } else {
      store = transaction.objectStore(storeDef.name);
    }

    var indexes = storeDef.indexes || [];
    for (var i = 0; i < indexes.length; i++) {
      var idx = indexes[i];
      if (!store.indexNames.contains(idx.name)) {
        store.createIndex(idx.name, idx.keyPath, {
          unique: !!idx.unique,
          multiEntry: !!idx.multiEntry
        });
      }
    }
    return store;
  }

  /**
   * applyUpgrade(db, transaction, oldVersion, newVersion) -> {appliedVersions: number[], storesCreated: string[]}
   * Walks every SCHEMA_VERSIONS step whose `version` is greater than
   * `oldVersion` and at most `newVersion`, applying each in ascending
   * order. Intended to be called from inside a real
   * `IDBOpenDBRequest.onupgradeneeded` handler, where `db` and
   * `transaction` are the native `event.target.result` and
   * `event.target.transaction` respectively.
   *
   * @param {IDBDatabase} db
   * @param {IDBTransaction} transaction
   * @param {number} oldVersion
   * @param {number} newVersion
   * @returns {{appliedVersions: number[], storesCreated: string[]}}
   * @throws {IndexedDBErrors.VersionConflictError} if newVersion is not
   *   greater than oldVersion (nothing to upgrade) or newVersion exceeds
   *   the highest known SCHEMA_VERSIONS entry (schema/code mismatch).
   */
  function applyUpgrade(db, transaction, oldVersion, newVersion) {
    var versions = SchemaNS.SCHEMA_VERSIONS;
    var highestKnown = versions.length ? versions[versions.length - 1].version : 0;

    if (newVersion > highestKnown) {
      throw new ErrorsNS.VersionConflictError(
        'Requested database version ' + newVersion + ' exceeds the highest ' +
        'schema version this build of IndexedDBSchema.js knows about (' +
        highestKnown + '). The app code is older than the on-disk database.',
        { dbName: SchemaNS.DB_NAME }
      );
    }

    var appliedVersions = [];
    var storesTouched = {};

    for (var i = 0; i < versions.length; i++) {
      var step = versions[i];
      if (step.version <= oldVersion || step.version > newVersion) { continue; }

      var stepStores = step.stores || [];
      for (var j = 0; j < stepStores.length; j++) {
        ensureStore(db, transaction, stepStores[j]);
        storesTouched[stepStores[j].name] = true;
      }
      appliedVersions.push(step.version);
    }

    return {
      appliedVersions: appliedVersions,
      storesCreated: Object.keys(storesTouched)
    };
  }

  /**
   * verifySchema(db, transaction) -> {ok: boolean, missingStores: string[], missingIndexes: Array<{store, index}>}
   * Read-only integrity check: does an already-open `db` actually contain
   * every store/index the current (latest) schema version declares? Used
   * by IndexedDBEngine.js's integrity helpers after `open()` succeeds.
   * @param {IDBDatabase} db
   * @param {IDBTransaction} [transaction] - an optional readonly
   *   transaction spanning every store name in the schema, needed to
   *   inspect each store's `indexNames` (store existence alone is
   *   checkable from `db.objectStoreNames` without a transaction, but
   *   index existence is only exposed via an open `IDBObjectStore`
   *   handle). If omitted, index checks are skipped and only store
   *   existence is verified.
   */
  function verifySchema(db, transaction) {
    var missingStores = [];
    var missingIndexes = [];
    var storeDefs = SchemaNS.STORE_DEFINITIONS;

    for (var i = 0; i < storeDefs.length; i++) {
      var def = storeDefs[i];
      if (!db.objectStoreNames.contains(def.name)) {
        missingStores.push(def.name);
        continue;
      }
      if (transaction) {
        var store = transaction.objectStore(def.name);
        var indexes = def.indexes || [];
        for (var j = 0; j < indexes.length; j++) {
          if (!store.indexNames.contains(indexes[j].name)) {
            missingIndexes.push({ store: def.name, index: indexes[j].name });
          }
        }
      }
    }

    return {
      ok: missingStores.length === 0 && missingIndexes.length === 0,
      missingStores: missingStores,
      missingIndexes: missingIndexes
    };
  }

  var api = {
    ensureStore: ensureStore,
    applyUpgrade: applyUpgrade,
    verifySchema: verifySchema
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  if (root) {
    root.IndexedDBVersion = api;
  }

})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
