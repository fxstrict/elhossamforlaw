/**
 * ================================================================
 * SyncCheckpoint.js — PHASE A7: Incremental Sync Checkpoint Storage
 * نظام الحسام للمحاماة
 * ================================================================
 * GAP THIS CLOSES
 *   ApiService.syncSheet() (js/api/api.js) can now pull only records
 *   newer than a given Composite Cursor (updatedAt+id) from a single
 *   sheet. Something needs to remember, PER SHEET, the last cursor a
 *   successful sync run reached — durably, across app restarts.
 *
 * WHY A NEW FILE INSTEAD OF TOUCHING Repository.js/StorageAdapter.js
 *   §34 of the A7 request ("DO NOT REBUILD REPOSITORY") and §33
 *   ("Repository.js already has _isDeleted()/_attachMetadata()/
 *   deletedAt — reuse it, minimal change") were both honored by NOT
 *   touching Repository.js in this session — a checkpoint is sync
 *   *metadata*, not domain data, and does not belong inside a
 *   Repository record store. §38 asks to reuse existing storage
 *   rather than invent something new: this file follows the EXACT
 *   same "one small JSON blob under one localStorage key" pattern
 *   OfflineQueue.js already uses for its own outbound queue — kept
 *   independent of IndexedDB/Repository.js for the same reason
 *   OfflineQueue.js is: it has no domain schema, cannot collide with
 *   or block the existing offline-first data layer, and (like
 *   OfflineQueue's queue) is small enough that localStorage's
 *   synchronous, always-available API is the simpler, safer choice
 *   here than IndexedDB — this is NOT "domain data in localStorage"
 *   (§38 warns against that), it is one short cursor string per sheet.
 *
 * WHAT THIS FILE DOES NOT DO (documented, not glossed over)
 *   - Does NOT call ApiService.syncSheet() itself, and does NOT apply
 *     pulled records into Repository/IndexedDB. That "Receive → Validate
 *     → Apply → Commit Cursor" orchestration (§31) requires deciding,
 *     for EACH of the 15 repositories, exactly where its own initial
 *     bootstrap-from-remote currently happens (inspected in this
 *     session: it is NOT centralized in Repository.js or any single
 *     file — see PHASE_A7_IMPLEMENTATION_REPORT.md §"Frontend Sync").
 *     Wiring that blindly, per sheet, without full visibility into
 *     each loader risks exactly the kind of regression A7's own rules
 *     (§3, §51 STOP conditions) forbid. This file only provides the
 *     durable, safe, tested checkpoint primitive that a future
 *     orchestration layer (SyncEngine.js, not written this session)
 *     would call `commit()` on only AFTER a successful Apply step —
 *     see save() doc comment below for the exact safety contract.
 * ================================================================
 */

const SyncCheckpoint = (function () {
  'use strict';

  const STORAGE_KEY = '__ahp_sync_checkpoints__';

  function _readAll() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch (e) {
      return {};
    }
  }

  function _writeAll(map) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
    } catch (e) {
      try { console.warn('[SyncCheckpoint] failed to persist checkpoints:', e); } catch (e2) {}
    }
  }

  /**
   * @param {string} sheetName  Arabic sheet name, e.g. 'القضايا'
   * @returns {?string} the last committed cursor for this sheet, or null
   *          if this sheet has never completed a sync (Initial Sync
   *          still required — §36).
   */
  function get(sheetName) {
    const map = _readAll();
    return Object.prototype.hasOwnProperty.call(map, sheetName) ? map[sheetName] : null;
  }

  /**
   * Commits a new cursor for a sheet. CHECKPOINT SAFETY (§31 — mandatory
   * order: Receive → Validate → Apply → Commit Cursor): the caller MUST
   * only call save() AFTER every pulled item in that batch has been
   * successfully applied locally. If Apply fails partway through, the
   * caller must NOT call save() — the old cursor stays valid, and the
   * next sync attempt safely re-pulls from it (§32 — idempotent apply
   * makes re-pulling already-applied items safe by id).
   * @param {string} sheetName
   * @param {?string} cursor
   */
  function save(sheetName, cursor) {
    const map = _readAll();
    if (cursor == null) {
      delete map[sheetName];
    } else {
      map[sheetName] = cursor;
    }
    _writeAll(map);
  }

  /** Clears ALL checkpoints (e.g. forcing a full re-sync of every sheet). */
  function clearAll() {
    _writeAll({});
  }

  return { get: get, save: save, clearAll: clearAll };
})();
