/**
 * ================================================================
 * SettingsRepository.js — Settings Repository | نظام الحسام للمحاماة
 * ================================================================
 * V10 — Offline First Architecture
 * PHASE 13.4 — PART 1B-1 — SettingsRepository (creation only)
 *
 * Source of design (per this phase's own "read only" scope):
 *   - docs/phase13/PROJECT_PROGRESS.md (Decision 001, Next Planned Task)
 *   - docs/phase13/REFERENCE_MAP.md (Repository Reference, Repository
 *     Templates, IndexedDB References)
 *   - js/core/Repository.js (Repository base class — extended here,
 *     never modified; read directly to confirm the exact constructor
 *     config shape and inherited method signatures this file relies on)
 *   - js/core/DatabaseService.js, js/core/IndexedDBAdapter.js (read
 *     directly to confirm the Storage Adapter wiring pattern; neither
 *     modified)
 *   - js/repositories/LibraryRepository.js (the approved template per
 *     REFERENCE_MAP.md "Repository Templates" — read directly for the
 *     established DatabaseService/IndexedDBAdapter wiring pattern only;
 *     not modified, not imported from)
 *
 * WHAT THIS FILE IS
 *   The tenth concrete Repository. It subclasses the generic Repository
 *   base class (js/core/Repository.js) and adds ONLY Settings knowledge:
 *   the "id" identifier field (the setting's own key, e.g. "apiUrl"),
 *   one-record-per-setting storage (Decision 001 / Part 1A, Option A),
 *   and the approved public API surface (open, get, set, remove, has,
 *   getAll, getAllAsObject, migrateFromLocalStorage).
 *
 * WHAT THIS FILE IS NOT
 *   - It does NOT modify js/core/Repository.js, js/core/DatabaseService.js,
 *     js/core/IndexedDBAdapter.js, js/core/IndexedDBEngine.js, any
 *     IndexedDB schema/version file, RepositoryReadyCoordinator.js,
 *     MigrationBootstrap.js, MigrationService.js, js/modules/settings.js,
 *     js/modules/firstrun.js, index.html, any CSS, or any existing
 *     Repository/Module.
 *   - It is NOT wired into index.html in this phase (no <script> tag
 *     references it) and is NOT registered with RepositoryReadyCoordinator
 *     — pure additive file, inert until later Phase 13 parts.
 *   - PHASE 13.4 — PART 4: migrateFromLocalStorage() now performs a real,
 *     copy-only LocalStorage -> IndexedDB migration for the five approved
 *     keys (apiUrl, driveUrl, sheetUrl, lastSyncAt, localModeChosen) per
 *     docs/phase13/REFERENCE_MAP.md ("Migration References"). It never
 *     deletes/clears LocalStorage and never overwrites an existing
 *     repository value — see the method's own doc comment below for the
 *     full policy. No other file contains migration logic.
 *   - It does NOT create tests, and does NOT integrate with settings.js
 *     or firstrun.js.
 *
 * STORAGE MODEL — Decision 001 (Part 1A, APPROVED): one record per
 *   setting, e.g. { "id": "apiUrl", "value": "https://..." }. Uses the
 *   EXISTING "settings" IndexedDB object store (keyPath "id") — no schema
 *   change, no version upgrade (REFERENCE_MAP.md "IndexedDB References").
 *
 * IDENTIFIER — idField is the generic "id" key, holding the setting's own
 *   name (a true natural key, always supplied by the caller via set(key,
 *   value) — never generated). No idGenerator is configured or required.
 *
 * DELETE MODEL — softDelete:false. Unlike the nine entity Repositories,
 *   a key/value settings store has no use for delete tombstones — remove()
 *   must make has()/get() behave as if the setting was never set. This is
 *   a deliberate, settings-specific deviation from LibraryRepository's
 *   softDelete:true, consistent with Decision 001's "lowest regression
 *   risk / simplest correct model" reasoning.
 *
 * WIRING — Storage Adapter is a real DatabaseService instance wrapping a
 *   real IndexedDBAdapter instance, exactly the pattern already
 *   established and verified in LibraryRepository.js (PHASE 8 / SUB-PHASE
 *   8.5.2) — reused here as a pattern only, not imported from
 *   LibraryRepository.js itself.
 *
 * Load order: additive file, not yet wired into index.html. Depends only
 * on js/core/Repository.js, js/core/DatabaseService.js, and
 * js/core/IndexedDBAdapter.js having been loaded first (throws a clear
 * error otherwise — see guards below).
 * ================================================================
 */

(function (root) {
  'use strict';

  var RepositoryNS = (typeof module !== 'undefined' && module.exports)
    ? require('../core/Repository.js')
    : root;

  var Repository = RepositoryNS.Repository;

  if (typeof Repository !== 'function') {
    throw new Error(
      'SettingsRepository requires js/core/Repository.js to be loaded ' +
      'first (Repository base class not found).'
    );
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
    throw new Error(
      'SettingsRepository requires js/core/DatabaseService.js to be ' +
      'loaded first (DatabaseService class not found).'
    );
  }
  if (typeof IndexedDBAdapter !== 'function') {
    throw new Error(
      'SettingsRepository requires js/core/IndexedDBAdapter.js to be ' +
      'loaded first (IndexedDBAdapter class not found).'
    );
  }

  // ================================================================
  // 1. Settings knowledge (private to this file)
  // ================================================================

  /** Identifier field — the setting's own key (e.g. "apiUrl"), a true
   *  natural key, always supplied by the caller. Never generated. */
  var SETTINGS_ID_FIELD = 'id';

  /** Existing IndexedDB object store name (REFERENCE_MAP.md "IndexedDB
   *  References") — already present in the current schema, keyPath "id". */
  var SETTINGS_ENTITY_KEY = 'settings';

  // ================================================================
  // 2. Storage Adapter — DatabaseService-backed
  // ================================================================

  /**
   * Builds the Storage Adapter injected into SettingsRepository's
   * underlying Repository base class: a real DatabaseService instance
   * wrapping a real IndexedDBAdapter instance — same pattern already
   * established for the existing entity Repositories (e.g.
   * LibraryRepository.js), reused here, not imported from it.
   * @param {IDBFactory} [storageImpl] - optional indexedDB-shaped override
   *   (e.g. a test harness's in-memory stand-in). When omitted,
   *   IndexedDBAdapter resolves the real global indexedDB lazily.
   * @returns {DatabaseService}
   */
  function createSettingsIndexedDBAdapter(storageImpl) {
    var adapter = new IndexedDBAdapter(storageImpl ? { engineOptions: { indexedDBImpl: storageImpl } } : {});
    return new DatabaseService(adapter);
  }

  // ================================================================
  // 3. SettingsRepository — subclass
  // ================================================================

  /**
   * @class SettingsRepository
   * @param {{storageAdapter?: object}} [config] - Optional overrides
   *   (e.g. for tests). Defaults to the IndexedDB-backed adapter above.
   */
  function SettingsRepository(config) {
    config = config || {};
    var storageAdapter = config.storageAdapter || createSettingsIndexedDBAdapter();

    Repository.call(this, {
      entityKey: SETTINGS_ENTITY_KEY,
      storageAdapter: storageAdapter,
      idField: SETTINGS_ID_FIELD,
      // No idGenerator: SettingsRepository never generates a key — every
      // record's "id" is the caller-supplied setting name (set(key, value)).
      searchFields: [SETTINGS_ID_FIELD, 'value'],
      softDelete: false, // see file header "DELETE MODEL" note
      unsupportedOperations: []
    });
  }

  SettingsRepository.prototype = Object.create(Repository.prototype);
  SettingsRepository.prototype.constructor = SettingsRepository;

  // ----------------------------------------------------------------
  // 3.1 Validation — Repository Contract §9 (extension point)
  // ----------------------------------------------------------------

  /**
   * _validate(operation, record) — overrides the base class no-op hook.
   * The only rule a generic key/value settings store needs: the setting's
   * key ("id") must be a non-empty string. No constraint is placed on
   * "value" — settings values are heterogeneous by design (string,
   * boolean, etc. — see Decision 001 examples).
   * @protected
   * @override
   */
  SettingsRepository.prototype._validate = function (operation, record) {
    if (operation !== 'create' && operation !== 'update') {
      return { valid: true, errors: [] };
    }
    var errors = [];
    var id = record ? record[SETTINGS_ID_FIELD] : undefined;
    var idEmpty = id == null || (typeof id === 'string' ? id.trim() === '' : typeof id !== 'string');
    if (idEmpty) {
      errors.push({ field: SETTINGS_ID_FIELD, message: 'Setting key ("id") must be a non-empty string.' });
    }
    return { valid: errors.length === 0, errors: errors };
  };

  // ----------------------------------------------------------------
  // 3.2 Approved Public API (Part 1A) — open, get, set, remove, has,
  //     getAll, getAllAsObject, migrateFromLocalStorage
  // ----------------------------------------------------------------

  // open() is inherited UNCHANGED from Repository.prototype.open — loads
  // the "settings" store's records into memory. No override needed.

  /**
   * get(key) -> value | undefined
   * Unwraps the underlying { id, value } record and returns just the
   * setting's value, or undefined when the key does not exist. Thin
   * wrapper over the inherited Repository.prototype.get(id).
   * @param {string} key
   * @returns {*}
   */
  SettingsRepository.prototype.get = function (key) {
    var record = Repository.prototype.get.call(this, key);
    return record ? record.value : undefined;
  };

  /**
   * set(key, value) -> WriteResult
   * Creates a new one-record-per-setting entry if the key does not yet
   * exist, or updates the existing record's value otherwise. Reuses the
   * inherited create()/update() (validation, persistence, metadata all
   * handled by the base class — no duplicated logic here).
   * @param {string} key
   * @param {*} value
   * @returns {Promise<{success:boolean, record:?Object, error:?Object}>}
   */
  SettingsRepository.prototype.set = function (key, value) {
    if (this.exists(key)) {
      return Repository.prototype.update.call(this, key, { value: value });
    }
    var entity = {};
    entity[SETTINGS_ID_FIELD] = key;
    entity.value = value;
    return Repository.prototype.create.call(this, entity);
  };

  /**
   * remove(key) -> WriteResult
   * Alias for the inherited Contract-literal delete(id). Because this
   * Repository is configured with softDelete:false (see file header
   * "DELETE MODEL" note), this is a genuine hard delete — has(key)/get(key)
   * behave as if the setting was never set.
   * @param {string} key
   * @returns {Promise<{success:boolean, record:?Object, error:?Object}>}
   */
  SettingsRepository.prototype.remove = function (key) {
    return Repository.prototype.delete.call(this, key);
  };

  /**
   * has(key) -> boolean
   * Alias for the inherited Contract-literal exists(id).
   * @param {string} key
   * @returns {boolean}
   */
  SettingsRepository.prototype.has = function (key) {
    return Repository.prototype.exists.call(this, key);
  };

  // getAll() is inherited UNCHANGED from Repository.prototype.getAll —
  // returns a copy of every { id, value, ...metadata } record. No
  // override needed.

  /**
   * getAllAsObject() -> Object
   * Convenience additive method (Part 1A Public API): flattens getAll()'s
   * array of { id, value } records into a single plain key/value object,
   * e.g. { apiUrl: "...", driveUrl: "...", localModeChosen: true }.
   * @returns {Object}
   */
  SettingsRepository.prototype.getAllAsObject = function () {
    var out = {};
    Repository.prototype.getAll.call(this).forEach(function (record) {
      out[record[SETTINGS_ID_FIELD]] = record.value;
    });
    return out;
  };

  /**
   * migrateFromLocalStorage() -> Promise<{migrated:boolean, reason:string,
   *   migratedKeys:string[], skippedKeys:string[]}>
   *
   * PHASE 13.4 — PART 4: real implementation (Part 1B-1's stub replaced).
   * Per docs/phase13/REFERENCE_MAP.md ("Migration References") the
   * approved migration keys are exactly: apiUrl, driveUrl, sheetUrl,
   * lastSyncAt, localModeChosen. `userName` and any other/unknown key are
   * intentionally never touched.
   *
   * Policy (copy-only / non-destructive / safe / idempotent):
   *   - Reads each approved key from LocalStorage via getItem() only.
   *     Never calls localStorage.removeItem()/clear() — LocalStorage is
   *     left fully intact, always.
   *   - If the key already exists in this SettingsRepository (has(key)
   *     === true), it is left completely unchanged — an existing
   *     repository value is never overwritten by an older LocalStorage
   *     value. The key is recorded in `skippedKeys`.
   *   - If the key is absent from LocalStorage (getItem returns null),
   *     nothing happens for that key — it is neither an error nor
   *     recorded in either list.
   *   - Only when a key is an approved key, present in LocalStorage, and
   *     NOT already present in the repository, is it copied via
   *     set(key, value) and recorded in `migratedKeys`.
   *   - Idempotent by construction: once a key has been migrated, has(key)
   *     is true on every subsequent call, so re-running always skips it —
   *     running this twice in a row produces identical repository state
   *     and an identical (empty-migratedKeys) result the second time.
   *   - If LocalStorage itself is not reachable in this environment
   *     (e.g. this codebase's existing Node test harnesses, which
   *     intentionally have no global `localStorage` — see
   *     js/tests/verify_database_pipeline.js's "global localStorage
   *     trap"), this method performs no reads/writes at all and returns
   *     a structured, non-throwing result — the exact same safe no-op
   *     behavior the Part 1B-1 stub already guaranteed in that
   *     environment.
   *   - A failure reading or writing a single key (e.g. a storage
   *     exception) is caught per-key, recorded in `skippedKeys`, and does
   *     not stop the remaining approved keys from being processed, nor
   *     does it throw out of this method.
   *
   * @returns {Promise<{migrated:boolean, reason:string, migratedKeys:string[], skippedKeys:string[]}>}
   */
  var SETTINGS_MIGRATION_APPROVED_KEYS = [
    'apiUrl', 'driveUrl', 'sheetUrl', 'lastSyncAt', 'localModeChosen'
  ];

  SettingsRepository.prototype.migrateFromLocalStorage = async function () {
    if (typeof localStorage === 'undefined' || localStorage === null) {
      return {
        migrated: false,
        reason: 'No LocalStorage available in this environment — nothing to migrate.',
        migratedKeys: [],
        skippedKeys: []
      };
    }

    var self = this;
    var migratedKeys = [];
    var skippedKeys = [];

    for (var i = 0; i < SETTINGS_MIGRATION_APPROVED_KEYS.length; i++) {
      var key = SETTINGS_MIGRATION_APPROVED_KEYS[i];
      var raw;
      try {
        raw = localStorage.getItem(key);
      } catch (e) {
        skippedKeys.push(key);
        continue;
      }

      if (raw === null || raw === undefined) {
        // Nothing in LocalStorage for this key — not an error, not migrated.
        continue;
      }

      if (self.has(key)) {
        // Repository already has a value for this key — never overwrite.
        skippedKeys.push(key);
        continue;
      }

      try {
        await self.set(key, raw);
        migratedKeys.push(key);
      } catch (e) {
        skippedKeys.push(key);
      }
    }

    return {
      migrated: migratedKeys.length > 0,
      reason: migratedKeys.length > 0
        ? 'Copied ' + migratedKeys.length + ' approved key(s) from LocalStorage to SettingsRepository.'
        : 'No eligible keys to migrate (already present in the repository, absent from LocalStorage, or LocalStorage unavailable).',
      migratedKeys: migratedKeys,
      skippedKeys: skippedKeys
    };
  };

  // ================================================================
  // 4. Exports
  // ================================================================

  var api = {
    SettingsRepository: SettingsRepository,
    createSettingsIndexedDBAdapter: createSettingsIndexedDBAdapter
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  if (root) {
    root.SettingsRepository = SettingsRepository;
    root.createSettingsIndexedDBAdapter = createSettingsIndexedDBAdapter;
  }

})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
