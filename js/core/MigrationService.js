/**
 * ================================================================
 * MigrationService.js — LocalStorage → IndexedDB Migration | نظام الحسام للمحاماة
 * ================================================================
 * PHASE 13.3C — PART 3B — Migration Service
 *
 * Source of design (no assumption outside these):
 *   - js/core/StorageAdapter.js — the abstract contract both the source
 *     and target adapters this file drives are already known to satisfy
 *     (`open`/`read`/`write`/`exists` at minimum). Read in full; NOT
 *     modified.
 *   - js/core/LocalStorageAdapter.js — the concrete SOURCE adapter this
 *     phase migrates FROM. Read in full; NOT modified.
 *   - js/core/IndexedDBAdapter.js (PHASE 13.3B) — the concrete TARGET
 *     adapter this phase migrates INTO. In particular, this file relies
 *     on the documented fact that `IndexedDBAdapter.prototype.write()`
 *     performs `store.clear()` followed by every `store.put()` inside a
 *     single native `readwrite` transaction (clear-then-repopulate is
 *     indivisible — a mid-write failure rolls back the whole entity, it
 *     never leaves a partially-replaced record set). Read in full; NOT
 *     modified.
 *   - js/core/IndexedDBSchema.js — `getStoreNames()` is the single source
 *     of truth for which entity keys exist to migrate, and for the
 *     reserved `metadata` bookkeeping store this file uses to persist its
 *     own checkpoint. Read in full; NOT modified.
 *
 * WHAT THIS FILE IS
 *   A one-time, resumable, idempotent migration of every entity's whole
 *   record set from a source `StorageAdapter` (in practice,
 *   `LocalStorageAdapter`) into a target `StorageAdapter` (in practice,
 *   `IndexedDBAdapter`), entity by entity, with a durable checkpoint
 *   record (stored on the TARGET's own `metadata` store) so migration can
 *   survive being interrupted mid-run (page reload, tab close, crash) and
 *   safely resume exactly where it left off on the next call — without
 *   ever re-writing (and therefore never duplicating) an entity that
 *   already finished.
 *
 * WHAT THIS FILE IS NOT
 *   - It is NOT a StorageAdapter subclass, NOT DatabaseService, and NOT a
 *     Repository. It has no entity/business validation of any kind — it
 *     moves whatever whole array `source.read(entityKey)` returns,
 *     unchanged, into `target.write(entityKey, records)`.
 *   - It does NOT modify `Repository.js`, `StorageAdapter.js`,
 *     `LocalStorageAdapter.js`, `IndexedDBAdapter.js`, `DatabaseService.js`,
 *     or any Repository/Module. All are read-only inputs to this phase.
 *   - It does NOT wire itself into `index.html`, `DatabaseService.js`, or
 *     any Repository. Invocation (when and whether to run a migration) is
 *     a later sub-phase's decision — this file only provides the
 *     mechanism.
 *   - It does NOT provide true single-transaction atomicity ACROSS the
 *     whole multi-entity migration (that would require one native
 *     IndexedDB transaction spanning every object store at once, which is
 *     outside the `StorageAdapter` interface's one-`entityKey`-at-a-time
 *     shape and therefore outside this phase's scope). What IS guaranteed,
 *     and documented below, is: (a) EVERY SINGLE ENTITY's migration is
 *     atomic — inherited directly from `IndexedDBAdapter.write()`'s own
 *     single-transaction clear-then-repopulate — an interrupted write
 *     never leaves that one entity half-migrated; and (b) the checkpoint
 *     record makes the OVERALL multi-entity migration crash-safe and
 *     resumable — an interruption between entities never re-processes an
 *     already-completed entity, so no duplicates are ever produced, even
 *     though the whole run is not one indivisible transaction.
 *
 * Documented design decision — source-absent vs. target-already-populated:
 *   If the SOURCE genuinely never had a given entity key at all
 *   (`source.exists(entityKey)` resolves `false` — distinct from "source
 *   has the key with an empty array", which DOES overwrite normally) AND
 *   the TARGET already holds non-empty data for that same entity (e.g.
 *   written by some other process before this migration ever ran), this
 *   file deliberately does NOT overwrite the target with an empty array.
 *   Destroying real target data because localStorage happens to have
 *   never touched that key would be a silent data-loss bug, not a
 *   faithful migration. This is the ONE piece of logic in this file that
 *   is not a bare passthrough, and it is narrow, inert whenever the
 *   source key exists, and reported explicitly in the migration report
 *   (`status: 'skipped-source-absent-target-populated'`) rather than
 *   silently absorbed. Every other entity is a plain whole-array replace,
 *   matching every other `write()` caller in this codebase exactly.
 *
 * Load order: depends on `IndexedDBSchema.js` having loaded first (used
 * only for its static entity-key list — never for schema/version/upgrade
 * logic, which remains exclusively `IndexedDBVersion.js`'s job). Also
 * expects two already-constructed, StorageAdapter-shaped instances to be
 * handed to its constructor by the caller — this file never constructs a
 * `LocalStorageAdapter` or `IndexedDBAdapter` itself. Safe to load
 * anywhere after `IndexedDBSchema.js` — additive, not yet referenced by
 * any existing file.
 * ================================================================
 */

(function (root) {
  'use strict';

  function requireNS(name) {
    var ns = (typeof module !== 'undefined' && module.exports)
      ? require('./' + name + '.js')
      : root[name];
    if (!ns) {
      throw new Error('MigrationService requires js/core/' + name + '.js to be loaded first.');
    }
    return ns;
  }

  var SchemaNS = requireNS('IndexedDBSchema');

  var DEFAULT_METADATA_ENTITY_KEY = 'metadata';
  var DEFAULT_CHECKPOINT_ID = 'migration_localstorage_to_indexeddb_v1';

  // ================================================================
  // 1. MigrationError — the one error type this file introduces.
  //    Shaped identically (message/name/type/cause/recoverable) to
  //    LocalStorageAdapter.js's and IndexedDBAdapter.js's own local
  //    ValidationError, plus two migration-specific fields (`entityKey`,
  //    `stage`) so a caller can tell exactly which entity and which step
  //    (read / write / verify / checkpoint) failed.
  // ================================================================

  /**
   * @class MigrationError
   * @param {string} message
   * @param {{entityKey?: string, stage?: string, cause?: *, recoverable?: boolean}} [extra]
   */
  function MigrationError(message, extra) {
    extra = extra || {};
    this.message = message;
    this.name = 'MigrationError';
    this.type = 'MigrationError';
    this.entityKey = extra.entityKey != null ? extra.entityKey : null;
    this.stage = extra.stage != null ? extra.stage : null;
    this.cause = extra.cause != null ? extra.cause : null;
    // Migrations are resumable by construction (checkpoint-driven) unless
    // the caller explicitly marks a failure otherwise — default true.
    this.recoverable = extra.recoverable !== false;
    if (typeof Error.captureStackTrace === 'function') {
      Error.captureStackTrace(this, MigrationError);
    } else {
      this.stack = (new Error(message)).stack;
    }
  }
  MigrationError.prototype = Object.create(Error.prototype);
  MigrationError.prototype.constructor = MigrationError;
  MigrationError.prototype.name = 'MigrationError';

  /** @private shallow-merge helper (no Object.assign dependency, matching
   *  this codebase's existing ES5-only core-file style). */
  function shallowMerge(base, patch) {
    var out = {};
    var k;
    base = base || {};
    patch = patch || {};
    for (k in base) { if (Object.prototype.hasOwnProperty.call(base, k)) { out[k] = base[k]; } }
    for (k in patch) { if (Object.prototype.hasOwnProperty.call(patch, k)) { out[k] = patch[k]; } }
    return out;
  }

  /** @private validates a constructor argument is at least
   *  StorageAdapter-shaped (duck-typed: open/read/write), matching the
   *  same minimal-surface-check discipline `Repository.js`'s own
   *  `assertStorageAdapter` already applies one layer up. */
  function assertAdapterShape(adapter, label) {
    if (!adapter ||
        typeof adapter.open !== 'function' ||
        typeof adapter.read !== 'function' ||
        typeof adapter.write !== 'function') {
      throw new MigrationError(
        'MigrationService requires a StorageAdapter-shaped ' + label +
        ' (open()/read()/write() at minimum); got: ' +
        (adapter ? typeof adapter : 'null') + '.',
        { stage: 'construct' }
      );
    }
  }

  // ================================================================
  // 2. MigrationService
  // ================================================================

  /**
   * @class MigrationService
   *
   * @param {Object} config
   * @param {Object} config.sourceAdapter - an already-constructed,
   *   StorageAdapter-shaped instance to migrate FROM (e.g. a
   *   `LocalStorageAdapter`). NOT opened by this constructor — `migrate()`
   *   calls `.open()` on it itself (idempotent per the StorageAdapter
   *   contract, so an already-open adapter is also safe to pass in).
   * @param {Object} config.targetAdapter - an already-constructed,
   *   StorageAdapter-shaped instance to migrate INTO (e.g. an
   *   `IndexedDBAdapter`). Same open()-idempotency note as above. This
   *   instance's `metadataEntityKey` store is also where this service's
   *   own checkpoint record lives.
   * @param {string[]} [config.entityKeys] - which entity keys to migrate,
   *   in order. Defaults to `IndexedDBSchema.getStoreNames()` minus
   *   `metadataEntityKey` (i.e. every real data entity, excluding the
   *   engine/migration bookkeeping store itself).
   * @param {string} [config.metadataEntityKey='metadata'] - the entity
   *   key this service reads/writes its own checkpoint record under, on
   *   the TARGET adapter. Must never appear in `entityKeys`.
   * @param {string} [config.checkpointId] - the `id` this instance's
   *   checkpoint record is stored under within `metadataEntityKey`, so
   *   multiple independent checkpoints (if ever needed) can share one
   *   metadata store without colliding.
   * @param {function(): number} [config.now] - injected clock, for
   *   deterministic tests. Defaults to `Date.now`.
   */
  function MigrationService(config) {
    config = config || {};
    assertAdapterShape(config.sourceAdapter, 'sourceAdapter');
    assertAdapterShape(config.targetAdapter, 'targetAdapter');

    /** @private */
    this._source = config.sourceAdapter;
    /** @private */
    this._target = config.targetAdapter;

    /** @private */
    this._metadataEntityKey = (typeof config.metadataEntityKey === 'string' && config.metadataEntityKey)
      ? config.metadataEntityKey
      : DEFAULT_METADATA_ENTITY_KEY;

    var self = this;
    /** @private */
    this._entityKeys = (Array.isArray(config.entityKeys) && config.entityKeys.length)
      ? config.entityKeys.slice()
      : SchemaNS.getStoreNames().filter(function (name) { return name !== self._metadataEntityKey; });

    /** @private */
    this._checkpointId = (typeof config.checkpointId === 'string' && config.checkpointId)
      ? config.checkpointId
      : DEFAULT_CHECKPOINT_ID;

    /** @private */
    this._now = (typeof config.now === 'function') ? config.now : function () { return Date.now(); };
  }

  // ----------------------------------------------------------------
  // 2.1 Checkpoint persistence (private) — stored as one plain record
  //     inside the target adapter's `metadataEntityKey` whole-array
  //     store, identified by `id === this._checkpointId`. Uses the exact
  //     same whole-array read()/write() contract as every other entity —
  //     no new storage primitive is introduced.
  // ----------------------------------------------------------------

  /** @private -> Promise<{record: Object|null, allRecords: Array, index: number}> */
  MigrationService.prototype._readCheckpoint = function () {
    var self = this;
    return this._target.read(this._metadataEntityKey).then(function (records) {
      records = Array.isArray(records) ? records : [];
      for (var i = 0; i < records.length; i++) {
        if (records[i] && records[i].id === self._checkpointId) {
          return { record: records[i], allRecords: records, index: i };
        }
      }
      return { record: null, allRecords: records, index: -1 };
    }, function (err) {
      throw new MigrationError(
        'MigrationService: failed to read checkpoint from target metadata store "' +
        self._metadataEntityKey + '".',
        { entityKey: self._metadataEntityKey, stage: 'checkpoint', cause: err }
      );
    });
  };

  /** @private applies `patch` on top of the existing checkpoint record (or
   *  creates one, seeded with `id: this._checkpointId`, if none exists
   *  yet), persists the whole metadata array, and resolves the same
   *  `{record, allRecords, index}` shape `_readCheckpoint` uses — so a
   *  caller can chain further `_writeCheckpoint` calls without re-reading.
   *  -> Promise<{record: Object, allRecords: Array, index: number}> */
  MigrationService.prototype._writeCheckpoint = function (existing, patch) {
    var self = this;
    var allRecords = existing.allRecords.slice();
    var merged;
    var index;
    if (existing.index === -1) {
      merged = shallowMerge({ id: self._checkpointId }, patch);
      allRecords.push(merged);
      index = allRecords.length - 1;
    } else {
      merged = shallowMerge(existing.record, patch);
      allRecords[existing.index] = merged;
      index = existing.index;
    }
    return this._target.write(this._metadataEntityKey, allRecords).then(function () {
      return { record: merged, allRecords: allRecords, index: index };
    }, function (err) {
      throw new MigrationError(
        'MigrationService: failed to persist checkpoint to target metadata store "' +
        self._metadataEntityKey + '".',
        { entityKey: self._metadataEntityKey, stage: 'checkpoint', cause: err }
      );
    });
  };

  // ----------------------------------------------------------------
  // 2.2 Public status check — reads the checkpoint without migrating
  //     anything. Useful for a caller deciding whether to invoke
  //     migrate() at all, and for this phase's own verification harness.
  // ----------------------------------------------------------------

  /**
   * getStatus() -> Promise<Object>
   * Resolves the current checkpoint record verbatim (`{id, status,
   * startedAt, completedEntities, remainingEntities, completedAt?,
   * lastError?}`), or a synthetic `{status: 'not-started', ...}` shape if
   * migration has never run against this target. Opens the target
   * adapter if it is not already open (read-only — never touches the
   * source adapter).
   * @returns {Promise<Object>}
   */
  MigrationService.prototype.getStatus = function () {
    var self = this;
    return this._target.open().then(function () {
      return self._readCheckpoint();
    }).then(function (checkpoint) {
      return checkpoint.record || {
        id: self._checkpointId,
        status: 'not-started',
        completedEntities: [],
        remainingEntities: self._entityKeys.slice()
      };
    });
  };

  // ----------------------------------------------------------------
  // 2.3 migrate() — the one operation this file exists for.
  // ----------------------------------------------------------------

  /**
   * migrate(options) -> Promise<Object>
   *
   * Migrates every configured entity key's whole record set from the
   * source adapter into the target adapter, in order, persisting a
   * checkpoint after every single entity so an interruption never loses
   * track of what has already been safely migrated.
   *
   * Idempotent by default: if a prior call already completed
   * successfully, calling this again resolves immediately with
   * `{skipped: true, reason: 'already-completed', ...}` and touches
   * neither adapter's entity data again — repeated/double migration is
   * therefore always a safe no-op, never a source of duplicates.
   *
   * Resumable: if a prior call was interrupted partway (rejected), the
   * checkpoint already recorded exactly which entities finished. The next
   * call re-reads that checkpoint and only processes the entities that
   * had not yet completed — already-migrated entities are never re-read
   * or re-written.
   *
   * @param {Object} [options]
   * @param {boolean} [options.force=false] - re-run every configured
   *   entity from scratch, ignoring any existing checkpoint (including a
   *   'completed' one). Existing target data for each entity is still
   *   replaced via the same whole-array `write()`, not merged.
   * @returns {Promise<Object>} a migration report:
   *   {
   *     skipped: boolean,
   *     reason: string|null,
   *     startedAt: number,
   *     completedAt: number|null,
   *     durationMs: number|null,
   *     totalRecordsMigrated: number,
   *     entities: Array<{
   *       entityKey: string,
   *       status: 'migrated'|'skipped-source-absent-target-populated'|'previously-migrated'|'failed',
   *       sourceCount: number,
   *       targetCountAfter: number,
   *       error?: {message, entityKey, stage}
   *     }>
   *   }
   *   Rejects with a `MigrationError` (`.entityKey`, `.stage` populated)
   *   if any entity's read/write/verify step fails; the checkpoint is
   *   updated with `status: 'interrupted'` and `lastError` before the
   *   rejection propagates, so `migrate()` can be safely called again.
   */
  MigrationService.prototype.migrate = function (options) {
    options = options || {};
    var force = !!options.force;
    var self = this;
    var startedAt = self._now();
    // Set once, below, from the checkpoint read at the start of this call —
    // true only when this call is continuing a PRIOR call's in-progress or
    // interrupted checkpoint (never true for the very first migrate() this
    // service ever performs). Read by migrateOneEntity() via closure, after
    // it is assigned. See PHASE 13.11.2 fix note below.
    var isResumedRun = false;
    var report = {
      skipped: false,
      reason: null,
      startedAt: startedAt,
      completedAt: null,
      durationMs: null,
      totalRecordsMigrated: 0,
      entities: []
    };

    /** @private migrates exactly one entity key; resolves the checkpoint
     *  state to continue from, or rejects a MigrationError. */
    function migrateOneEntity(entityKey, checkpointState) {
      var entityReport = { entityKey: entityKey, status: null, sourceCount: 0, targetCountAfter: 0 };

      return self._source.exists(entityKey)
        .then(null, function () {
          // exists() is documented as advisory/never-rejecting on both
          // known adapters, but if a future adapter ever rejects here,
          // default to "treat as present" — the safer failure mode is
          // attempting the migration, not silently skipping a real entity.
          return true;
        })
        .then(function (sourceHasKey) {
          return self._source.read(entityKey).then(null, function (err) {
            throw new MigrationError(
              'MigrationService: failed to read entity "' + entityKey + '" from source adapter.',
              { entityKey: entityKey, stage: 'read', cause: err }
            );
          }).then(function (records) {
            records = Array.isArray(records) ? records : [];
            entityReport.sourceCount = records.length;

            if (sourceHasKey === false) {
              // Documented design decision (see file header): never let a
              // key the source never had wipe out data the target already
              // holds for that same entity.
              return self._target.read(entityKey).then(null, function () { return []; })
                .then(function (existingTargetRecords) {
                  existingTargetRecords = Array.isArray(existingTargetRecords) ? existingTargetRecords : [];
                  if (existingTargetRecords.length > 0) {
                    entityReport.status = 'skipped-source-absent-target-populated';
                    entityReport.sourceCount = 0;
                    entityReport.targetCountAfter = existingTargetRecords.length;
                    return null;
                  }
                  return writeAndVerify(records);
                });
            }

            // PHASE 13.11.2 fix — resume-only overwrite protection.
            // Root cause: on a RESUMED call (a prior call already left this
            // service's checkpoint 'in_progress' or 'interrupted'), an entity
            // still in remainingEntities may nonetheless already have real,
            // newer data in the target — written directly by a Repository
            // between the previous (unfinished) migrate() call and this one,
            // fully independent of migration (every Repository already reads/
            // writes the target adapter directly; see MigrationBootstrap.js's
            // own "NO DATA LOSS" note, which flagged this exact race for
            // whichever phase next touched this file). Unconditionally
            // replacing the target with the source's stale snapshot in that
            // case silently discards that newer write. `force:true` and the
            // very first migrate() call (isResumedRun === false) are
            // completely unaffected — both keep the prior unconditional
            // overwrite behavior exactly as before.
            if (isResumedRun && !force) {
              return self._target.read(entityKey).then(null, function () { return []; })
                .then(function (existingTargetRecords) {
                  existingTargetRecords = Array.isArray(existingTargetRecords) ? existingTargetRecords : [];
                  if (existingTargetRecords.length > 0) {
                    entityReport.status = 'skipped-resume-target-populated';
                    entityReport.targetCountAfter = existingTargetRecords.length;
                    return null;
                  }
                  return writeAndVerify(records);
                });
            }
            return writeAndVerify(records);
          });
        })
        .then(function () {
          report.entities.push(entityReport);
          if (entityReport.status === 'migrated') {
            report.totalRecordsMigrated += entityReport.sourceCount;
          }
          var newCompleted = checkpointState.record.completedEntities.concat([entityKey]);
          var newRemaining = checkpointState.record.remainingEntities.filter(function (k) { return k !== entityKey; });
          return self._writeCheckpoint(checkpointState, {
            completedEntities: newCompleted,
            remainingEntities: newRemaining
          });
        })
        .then(null, function (err) {
          entityReport.status = entityReport.status || 'failed';
          entityReport.error = { message: err.message, entityKey: entityKey, stage: err.stage || null };
          if (report.entities.indexOf(entityReport) === -1) { report.entities.push(entityReport); }
          // Best-effort checkpoint of the failure — if persisting the
          // failure itself fails, the ORIGINAL error still propagates,
          // never masked by a secondary checkpoint-write error.
          return self._writeCheckpoint(checkpointState, {
            status: 'interrupted',
            lastError: { entityKey: entityKey, message: err.message, stage: err.stage || null, at: self._now() }
          }).then(function () { throw err; }, function () { throw err; });
        });

      function writeAndVerify(records) {
        return self._target.write(entityKey, records).then(null, function (err) {
          throw new MigrationError(
            'MigrationService: failed to write entity "' + entityKey + '" to target adapter. ' +
            'The target\'s own single-transaction write() guarantees this entity is left ' +
            'exactly as it was before this call (never partially replaced).',
            { entityKey: entityKey, stage: 'write', cause: err }
          );
        }).then(function () {
          return self._target.read(entityKey).then(null, function () { return null; });
        }).then(function (verifyRecords) {
          if (Array.isArray(verifyRecords)) {
            entityReport.targetCountAfter = verifyRecords.length;
            if (verifyRecords.length !== records.length) {
              throw new MigrationError(
                'MigrationService: post-write verification mismatch for entity "' + entityKey +
                '" — expected ' + records.length + ' record(s), found ' + verifyRecords.length +
                '. Not marked complete.',
                { entityKey: entityKey, stage: 'verify' }
              );
            }
          }
          entityReport.status = 'migrated';
        });
      }
    }

    /** @private walks `remaining` one entity at a time (sequential, not
     *  parallel — keeps checkpoint writes strictly ordered and keeps
     *  failure isolation to exactly one entity at a time). */
    function migrateSequentially(remaining, checkpointState) {
      if (remaining.length === 0) {
        return finalize(checkpointState);
      }
      var entityKey = remaining[0];
      var rest = remaining.slice(1);
      return migrateOneEntity(entityKey, checkpointState).then(function (nextCheckpointState) {
        return migrateSequentially(rest, nextCheckpointState);
      });
    }

    function finalize(checkpointState) {
      var completedAt = self._now();
      return self._writeCheckpoint(checkpointState, {
        status: 'completed',
        completedAt: completedAt,
        remainingEntities: []
      }).then(function () {
        report.completedAt = completedAt;
        report.durationMs = completedAt - startedAt;
        return report;
      });
    }

    return self._source.open()
      .then(function () { return self._target.open(); })
      .then(function () { return self._readCheckpoint(); })
      .then(function (checkpoint) {
        var existingRecord = checkpoint.record;

        // Must be read BEFORE anything below rewrites the checkpoint status
        // for this call. True only when a PRIOR call already left the
        // checkpoint 'in_progress' (started, never reached finalize()) or
        // 'interrupted' (a prior entity failed) — never true for this
        // service's very first migrate() call, whose checkpoint record does
        // not exist yet (existingRecord is undefined/null) or, in principle,
        // could only otherwise be 'completed' (handled separately below).
        isResumedRun = !!(existingRecord &&
          (existingRecord.status === 'in_progress' || existingRecord.status === 'interrupted'));

        if (existingRecord && existingRecord.status === 'completed' && !force) {
          report.skipped = true;
          report.reason = 'already-completed';
          report.completedAt = existingRecord.completedAt || null;
          report.entities = (existingRecord.completedEntities || []).map(function (k) {
            return { entityKey: k, status: 'previously-migrated', sourceCount: null, targetCountAfter: null };
          });
          return report;
        }

        var completedEntities = (existingRecord && Array.isArray(existingRecord.completedEntities) && !force)
          ? existingRecord.completedEntities.slice()
          : [];
        var remaining = self._entityKeys.filter(function (k) { return completedEntities.indexOf(k) === -1; });

        return self._writeCheckpoint(checkpoint, {
          status: 'in_progress',
          startedAt: (existingRecord && existingRecord.startedAt) || startedAt,
          completedEntities: completedEntities,
          remainingEntities: remaining,
          lastError: null
        }).then(function (initState) {
          return migrateSequentially(remaining, initState);
        });
      });
  };

  // ================================================================
  // 3. Exports
  // ================================================================

  var api = {
    MigrationService: MigrationService,
    MigrationError: MigrationError
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  if (root) {
    root.MigrationService = MigrationService;
    root.MigrationServiceErrors = { MigrationError: MigrationError };
  }

})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
