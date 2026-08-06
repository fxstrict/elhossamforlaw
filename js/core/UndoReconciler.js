/**
 * ================================================================
 * UndoReconciler.js — Generic Undo/Redo Reconciliation Utility
 * نظام الحسام للمحاماة
 * ================================================================
 * PHASE 12 — SUB-PHASE 12.5 — General Undo Integration
 *
 * WHAT THIS FILE IS
 *   Entity-agnostic helper functions that answer exactly one question:
 *   "given a snapshot instruction returned by Repository.undo()/.redo()
 *   (SUB-PHASE 12.3), what actual create/update/delete/restore call
 *   reconciles it into real data?" This is the logic SUB-PHASE 12.4
 *   wrote once, locally, inside js/modules/cases.js
 *   (`_resolveUndoEntryId` / `_withUndoManagerSuspended` /
 *   `_applyCasesUndoInstruction`). Phase 12.5's pre-audit
 *   (PHASE_12_5_PRE_AUDIT_Undo_Generalization.md §4) identified that
 *   none of that logic actually depends on anything Cases-specific
 *   beyond the repository instance and its id-field name — both of
 *   which every one of the 9 entity modules already has as a local
 *   variable/constant. This file is that logic, extracted verbatim and
 *   parameterized, so it is written ONCE and shared by all 9 modules
 *   (Cases included, after this phase's refactor of cases.js) instead
 *   of being copy-pasted 8 more times.
 *
 * WHAT THIS FILE IS NOT
 *   - It does NOT construct or wire any UndoManager. Each module still
 *     builds its own `new UndoManager(<entity>Repository)` and calls
 *     `<entity>Repository.setUndoManager(...)` itself, so that each
 *     entity's undo/redo history stays completely separate (Phase 12.5
 *     brief §11) — this file only reconciles an already-returned
 *     instruction, it never touches undo/redo *history* itself.
 *   - It has ZERO knowledge of Arabic field labels beyond the generic
 *     `idField` string parameter, module-specific mirror/render/badge
 *     functions, ApiService/Google-Sheets sync, or toast text. Every
 *     one of those stays local to each module's own
 *     `undoLast<Entity>Action()`/`redoLast<Entity>Action()` wrapper —
 *     see those functions in each module for the full refresh sequence
 *     (`Repository.undo()/.redo() -> applyUndoInstruction() ->
 *     sync<Entity>Mirror() -> saveLocal() -> render<Entity>() ->
 *     updateBadges() [where applicable] -> toast()`).
 *   - It NEVER touches a Repository's private members (`_records`,
 *     `_persist`, `_idIndex`, `_liveCount`, `_state`, `_storage`, or
 *     any other underscore-prefixed field). Only the public façade is
 *     used: `create`/`update`/`delete`/`restore`/`getUndoManager`/
 *     `setUndoManager` — the exact same 6 methods SUB-PHASE 12.4 (Cases
 *     pilot) already limited itself to. This is a hard requirement of
 *     the governing Phase 12.5 prompt (§5), not a style preference.
 *
 * REVERSAL MAPPING (unchanged from Cases_Undo_Pilot_Report.md §2.2 —
 * copied verbatim, not reinterpreted):
 *
 *   Original action   Undo calls                          Redo calls
 *   ---------------   ----------------------------------  ----------------------------------
 *   create             delete(id)   (soft-delete it)        restore(id)  (id already exists,
 *                                                             soft-deleted by the undo above —
 *                                                             a plain create() would reject it
 *                                                             as a CONFLICT)
 *   delete             restore(id)                          delete(id)
 *   restore            delete(id)                           restore(id)
 *   update             update(id, before, {allowDeleted:true}) update(id, after, {allowDeleted:true})
 *
 * Only single-record entries are handled — no module in this project
 * calls bulk/import/clear/transaction Repository methods (confirmed
 * project-wide in the Phase 12.5 pre-audit §5 "Module Comparison
 * Matrix": 0/9 modules call bulkInsert/bulkUpdate/bulkDelete/
 * transaction/import/clear), so a bulk-shaped entry (an array `before`
 * or `after`) can never legitimately occur here — it is rejected
 * defensively, exactly as SUB-PHASE 12.4 already did, rather than
 * assumed impossible.
 *
 * REDO-STACK PROTECTION
 *   Applying the reversal above calls a real Repository mutation
 *   method, which — like any other create()/update()/delete()/
 *   restore() call — unconditionally invokes its own `_recordUndo()`
 *   hook (SUB-PHASE 12.3) if a manager is wired. Left unguarded, this
 *   would push a brand-new history entry for the RECONCILIATION step
 *   itself, and recording anything new unconditionally clears the redo
 *   stack (js/core/UndoManager.js: "Recording a new entry... always
 *   clears the redo stack") — silently destroying the very entry
 *   undo() just made available for redo(). `withUndoManagerSuspended()`
 *   closes this gap by briefly unwiring the repository's UndoManager
 *   (via the public `setUndoManager(null)` façade — never touching the
 *   manager instance itself) for the duration of the single
 *   reconciliation call, then re-wiring the same instance afterward,
 *   success or failure (`finally`).
 * ================================================================
 */

(function (root) {
  'use strict';

  /**
   * Resolves the id an undo/redo snapshot instruction refers to.
   * Prefers `after`, falls back to `before` (a 'delete' entry has no
   * `after`). Entity-agnostic — takes the id field name as a parameter.
   * @param {?Object} before
   * @param {?Object} after
   * @param {string} idField
   * @returns {?string}
   */
  function resolveUndoEntryId(before, after, idField) {
    if (after && after[idField] != null) return after[idField];
    if (before && before[idField] != null) return before[idField];
    return null;
  }

  /**
   * Runs `fn` (expected to return a Promise) with `repository`'s
   * UndoManager temporarily unwired, so the mutation `fn` performs is
   * never itself recorded as new undo history. Always restores the
   * original manager afterward, even if `fn` throws/rejects. Uses ONLY
   * the public `getUndoManager()`/`setUndoManager()` façade.
   * @param {Object} repository - any entity Repository instance.
   * @param {Function} fn
   * @returns {Promise<*>}
   */
  async function withUndoManagerSuspended(repository, fn) {
    var manager = repository.getUndoManager();
    repository.setUndoManager(null);
    try {
      return await fn();
    } finally {
      repository.setUndoManager(manager);
    }
  }

  /**
   * Applies one snapshot instruction (as returned by
   * `repository.undo()`/`.redo()`) in the given `direction`, per the
   * REVERSAL MAPPING documented above. Never throws — every failure
   * path (malformed entry, unknown action, missing id, Repository
   * rejection, persist failure) is normalized into a `WriteResult`-
   * shaped `{success:false, error}` so callers have one uniform shape
   * to check, exactly matching the Cases pilot's own contract.
   * @param {Object} repository - any entity Repository instance
   *   (already has an UndoManager wired via setUndoManager()).
   * @param {string} idField - the entity's id field name (e.g.
   *   CLIENTS_ID_FIELD, CASES_ID_FIELD, ...).
   * @param {?{action:string, before:?Object, after:?Object, metadata:Object}} instruction
   * @param {'undo'|'redo'} direction
   * @returns {Promise<{success:boolean, record:?Object, error:?Object}>}
   */
  async function applyUndoInstruction(repository, idField, instruction, direction) {
    if (!instruction || typeof instruction !== 'object') {
      return { success: false, record: null, error: { message: 'empty undo/redo instruction' } };
    }

    var action = instruction.action;
    var before = instruction.before;
    var after = instruction.after;

    if (Array.isArray(before) || Array.isArray(after)) {
      // Bulk-shaped entry (bulkInsert/bulkUpdate/bulkDelete/import/
      // clear/transaction) — never produced by any of the 9 modules'
      // own calls (Phase 12.5 pre-audit §5), but guarded defensively
      // rather than assumed impossible.
      return { success: false, record: null, error: { message: 'bulk-shaped undo entries are not supported by UndoReconciler' } };
    }

    var id = resolveUndoEntryId(before, after, idField);
    if (id == null) {
      return { success: false, record: null, error: { message: 'could not resolve an id from the undo/redo entry' } };
    }

    return withUndoManagerSuspended(repository, async function () {
      try {
        if (direction === 'undo') {
          if (action === 'create')  return await repository.delete(id);
          if (action === 'delete')  return await repository.restore(id);
          if (action === 'restore') return await repository.delete(id);
          if (action === 'update')  return await repository.update(id, before, { allowDeleted: true });
        } else if (direction === 'redo') {
          if (action === 'create')  return await repository.restore(id);
          if (action === 'delete')  return await repository.delete(id);
          if (action === 'restore') return await repository.restore(id);
          if (action === 'update')  return await repository.update(id, after, { allowDeleted: true });
        } else {
          return { success: false, record: null, error: { message: 'invalid direction: ' + direction + ' (expected "undo" or "redo")' } };
        }
        return { success: false, record: null, error: { message: 'unknown undo/redo action type: ' + action } };
      } catch (e) {
        return { success: false, record: null, error: { message: e && e.message ? e.message : String(e) } };
      }
    });
  }

  // ================================================================
  // Exports — mirrors UndoManager.js's own export pattern exactly.
  // ================================================================

  var api = {
    resolveUndoEntryId: resolveUndoEntryId,
    withUndoManagerSuspended: withUndoManagerSuspended,
    applyUndoInstruction: applyUndoInstruction
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  if (root) {
    root.UndoReconciler = api;
  }

})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
