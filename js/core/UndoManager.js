/**
 * ================================================================
 * UndoManager.js — Undo Engine Core | نظام الحسام للمحاماة
 * ================================================================
 * PHASE 12 — SUB-PHASE 12.2 — Undo Manager Core Implementation
 *
 * WHAT THIS FILE IS
 *   A single, storage-agnostic, entity-agnostic Undo Engine. It records
 *   snapshot-based history entries (create/update/delete/restore) and
 *   exposes undo()/redo() that return SNAPSHOT INSTRUCTIONS describing
 *   what would need to happen to reverse/reapply an operation.
 *
 * WHAT THIS FILE IS NOT
 *   - It does NOT mutate any Repository. undo()/redo() never call
 *     create()/update()/delete()/restore() on the injected repository —
 *     that wiring is explicitly out of scope for this sub-phase (see the
 *     governing prompt: "Repository integration comes later").
 *   - It has NO knowledge of entity field names, Arabic labels, or any
 *     business validation rule.
 *   - It touches no browser global: no window, no document, no
 *     localStorage, no DOM of any kind. Pure, dependency-free JavaScript.
 *
 * DESIGN NOTES (documented here since no prior Undo_System_Design.md
 * exists in this project to record them against):
 *   - `repository` is accepted and stored (`this._repository`) purely as
 *     a forward-compatible handle for a *future* sub-phase to use when
 *     wiring undo()/redo() to real mutations. This engine never calls
 *     any method on it.
 *   - `_enabled` (default: true) gates the four `record*()` methods only.
 *     undo()/redo()/clear()/etc. are always callable regardless of
 *     enabled state — disabling the manager stops new history from being
 *     recorded, it does not freeze the ability to undo what already
 *     happened.
 *   - Every stored snapshot (`before`/`after`/`metadata`) is deep-cloned
 *     via JSON.parse(JSON.stringify(...)) — identical technique to
 *     Repository.js's own `cloneRecord()` — so no caller can ever mutate
 *     UndoManager's internal state through a held reference, and every
 *     entry is guaranteed JSON-serializable (required for
 *     serialize()/deserialize()).
 *   - History is a simple array used as a stack (push = most recent at
 *     the end). Overflow past `maxHistorySize` drops the OLDEST entry
 *     (index 0, FIFO), never the most recent.
 *   - Recording a new entry (any record*() call) always clears the redo
 *     stack — standard undo/redo semantics: once a new action happens,
 *     the previously-undone future is no longer reachable.
 *   - The redo stack is capped at the same `maxHistorySize` and follows
 *     the same FIFO drop rule, for symmetry and to bound memory
 *     regardless of how many times undo() is called in a row.
 *   - undo()/redo() return `null` when there is nothing to undo/redo
 *     (canUndo()/canRedo() are the non-throwing way to check first).
 *   - After dispose(), the instance is inert: history/redo are cleared,
 *     recording is disabled, and the repository handle is released.
 *     dispose() never throws and is always safe to call more than once.
 * ================================================================
 */

(function (root) {
  'use strict';

  // ================================================================
  // Small internal utilities (mirrors Repository.js's own helpers —
  // duplicated intentionally rather than imported, since this file must
  // have zero dependency on Repository.js per the governing prompt).
  // ================================================================

  /** Deep-clones a plain JSON-serializable value. `undefined`/functions/
   *  Dates are not supported (mirrors Repository.js's cloneRecord()
   *  contract exactly — snapshots are plain data, never live objects). */
  function deepClone(value) {
    if (value === null || value === undefined) return value === undefined ? null : value;
    return JSON.parse(JSON.stringify(value));
  }

  function isPlainObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
  }

  function nowIso() {
    return new Date().toISOString();
  }

  var VALID_TYPES = Object.freeze(['create', 'update', 'delete', 'restore']);

  /**
   * Builds one history entry. Never keeps a live reference to anything
   * the caller passed in.
   * @private
   */
  function buildEntry(type, before, after, metadata) {
    return {
      type: type,
      before: deepClone(before === undefined ? null : before),
      after: deepClone(after === undefined ? null : after),
      timestamp: nowIso(),
      metadata: deepClone(metadata === undefined || metadata === null ? {} : metadata)
    };
  }

  // ================================================================
  // UndoManager
  // ================================================================

  /**
   * @class UndoManager
   * @param {Object} repository - forward-compatible handle only; never
   *   called by this engine (see file header "Design Notes").
   * @param {{maxHistorySize?: number}} [options]
   */
  class UndoManager {
    constructor(repository, options) {
      options = options || {};

      var maxSize = options.maxHistorySize;
      if (typeof maxSize !== 'number' || !isFinite(maxSize) || maxSize <= 0) {
        maxSize = 50;
      } else {
        maxSize = Math.floor(maxSize);
      }

      /** @private forward-compatible only — never invoked by this class. */
      this._repository = repository !== undefined ? repository : null;

      /** @private stack of history entries, oldest first, newest last. */
      this._history = [];

      /** @private stack of undone entries available for redo(), oldest
       *  first (relative to when they were undone), newest last. */
      this._redo = [];

      /** @private maximum size of BOTH _history and _redo. */
      this._maxHistory = maxSize;

      /** @private gates record*() only — see file header. */
      this._enabled = true;

      /** @private set true by dispose(); informational only, nothing in
       *  this class currently branches on it beyond dispose() itself
       *  being idempotent. */
      this._disposed = false;
    }

    // --------------------------------------------------------------
    // Lifecycle / mode
    // --------------------------------------------------------------

    enable() {
      this._enabled = true;
    }

    disable() {
      this._enabled = false;
    }

    isEnabled() {
      return this._enabled;
    }

    clear() {
      this._history = [];
      this._redo = [];
    }

    canUndo() {
      return this._history.length > 0;
    }

    canRedo() {
      return this._redo.length > 0;
    }

    historySize() {
      return this._history.length;
    }

    redoSize() {
      return this._redo.length;
    }

    dispose() {
      this._history = [];
      this._redo = [];
      this._enabled = false;
      this._repository = null;
      this._disposed = true;
    }

    // --------------------------------------------------------------
    // Internal push/trim helpers
    // --------------------------------------------------------------

    /** @private pushes `entry` onto `stack`, dropping the oldest entry
     *  (index 0) if this pushes the stack past this._maxHistory. */
    _pushBounded(stack, entry) {
      stack.push(entry);
      while (stack.length > this._maxHistory) {
        stack.shift();
      }
    }

    /**
     * @private shared implementation behind all four record*() methods.
     * No-ops (returns null) when disabled — see file header.
     */
    _record(type, before, after, metadata) {
      if (!this._enabled) return null;
      var entry = buildEntry(type, before, after, metadata);
      this._pushBounded(this._history, entry);
      // A new, real action invalidates whatever future redo() would have
      // replayed — standard undo/redo semantics.
      this._redo = [];
      return deepClone(entry);
    }

    // --------------------------------------------------------------
    // Recording
    // --------------------------------------------------------------

    /**
     * @param {Object} after - the record as it exists after creation.
     * @param {Object} [metadata]
     * @returns {?Object} the recorded entry (deep-cloned), or null if disabled.
     */
    recordCreate(after, metadata) {
      return this._record('create', null, after, metadata);
    }

    /**
     * @param {Object} before - the record's state prior to the update.
     * @param {Object} after - the record's state after the update.
     * @param {Object} [metadata]
     * @returns {?Object}
     */
    recordUpdate(before, after, metadata) {
      return this._record('update', before, after, metadata);
    }

    /**
     * @param {Object} before - the record's state prior to deletion.
     * @param {Object} [metadata]
     * @returns {?Object}
     */
    recordDelete(before, metadata) {
      return this._record('delete', before, null, metadata);
    }

    /**
     * @param {Object} before - the record's state prior to restoration
     *   (typically soft-deleted).
     * @param {Object} after - the record's state after restoration.
     * @param {Object} [metadata]
     * @returns {?Object}
     */
    recordRestore(before, after, metadata) {
      return this._record('restore', before, after, metadata);
    }

    // --------------------------------------------------------------
    // Undo / Redo
    // --------------------------------------------------------------

    /**
     * Pops the most recent history entry and moves it to the redo stack.
     * Does NOT touch any Repository — returns snapshot instructions only
     * (see file header "Design Notes").
     * @returns {?{action:string, before:?Object, after:?Object, metadata:Object}}
     */
    undo() {
      if (this._history.length === 0) return null;
      var entry = this._history.pop();
      this._pushBounded(this._redo, entry);
      return {
        action: entry.type,
        before: deepClone(entry.before),
        after: deepClone(entry.after),
        metadata: deepClone(entry.metadata)
      };
    }

    /**
     * Pops the most recently undone entry and moves it back onto the
     * history stack. Does NOT touch any Repository.
     * @returns {?{action:string, before:?Object, after:?Object, metadata:Object}}
     */
    redo() {
      if (this._redo.length === 0) return null;
      var entry = this._redo.pop();
      this._pushBounded(this._history, entry);
      return {
        action: entry.type,
        before: deepClone(entry.before),
        after: deepClone(entry.after),
        metadata: deepClone(entry.metadata)
      };
    }

    // --------------------------------------------------------------
    // Export / Import / Serialize / Deserialize
    // --------------------------------------------------------------

    /**
     * @returns {{maxHistorySize:number, history:Array<Object>, redo:Array<Object>}}
     *   Plain, JSON-serializable, deep-cloned snapshot of the full
     *   internal state.
     */
    exportHistory() {
      return {
        maxHistorySize: this._maxHistory,
        history: deepClone(this._history),
        redo: deepClone(this._redo)
      };
    }

    /**
     * Loads a previously-exported state (as produced by exportHistory()).
     * Validates shape defensively; throws a plain Error (not a Repository
     * error type — this file has no dependency on Repository.js's error
     * model) on malformed input.
     * @param {{maxHistorySize?:number, history?:Array, redo?:Array}} data
     */
    importHistory(data) {
      if (!isPlainObject(data)) {
        throw new Error('UndoManager.importHistory(): expected a plain object.');
      }
      var history = Array.isArray(data.history) ? data.history : [];
      var redo = Array.isArray(data.redo) ? data.redo : [];

      history.forEach(function (entry, i) {
        if (!isPlainObject(entry) || VALID_TYPES.indexOf(entry.type) === -1) {
          throw new Error('UndoManager.importHistory(): history[' + i + '] is not a valid entry.');
        }
      });
      redo.forEach(function (entry, i) {
        if (!isPlainObject(entry) || VALID_TYPES.indexOf(entry.type) === -1) {
          throw new Error('UndoManager.importHistory(): redo[' + i + '] is not a valid entry.');
        }
      });

      if (typeof data.maxHistorySize === 'number' && isFinite(data.maxHistorySize) && data.maxHistorySize > 0) {
        this._maxHistory = Math.floor(data.maxHistorySize);
      }

      this._history = deepClone(history);
      this._redo = deepClone(redo);

      // Imported state must itself respect the (possibly just-updated)
      // bound, oldest-dropped-first, same as any other mutation path.
      while (this._history.length > this._maxHistory) this._history.shift();
      while (this._redo.length > this._maxHistory) this._redo.shift();
    }

    /**
     * @returns {string} JSON string of exportHistory()'s output.
     */
    serialize() {
      return JSON.stringify(this.exportHistory());
    }

    /**
     * @param {string} json - a string previously produced by serialize().
     */
    deserialize(json) {
      var parsed;
      try {
        parsed = JSON.parse(json);
      } catch (e) {
        throw new Error('UndoManager.deserialize(): input is not valid JSON.');
      }
      this.importHistory(parsed);
    }
  }

  // ================================================================
  // Exports — mirrors Repository.js's own export pattern exactly.
  // ================================================================

  var api = {
    UndoManager: UndoManager
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  if (root) {
    root.UndoManager = UndoManager;
  }

})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
