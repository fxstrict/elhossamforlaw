/* ============================================================================
 * PHASE 16.2 — RENDER QUEUE FOUNDATION (ZERO REGRESSION)
 * File: js/core/render/RenderRegistry.js
 * ----------------------------------------------------------------------------
 * WHAT THIS IS
 *   The pending-task store for the Render Queue. It holds, at most, ONE
 *   pending RenderTask per key at a time, in first-enqueued order. It does
 *   not decide when tasks run (that's RenderScheduler) and does not run
 *   them (that's RenderDispatcher) — it only stores and hands them back.
 *
 * WHY IT EXISTS (Phase 16.2)
 *   The brief requires the queue to "prevent duplicate scheduling in the
 *   same tick". The simplest, safest way to guarantee that — without any
 *   timing/async logic that could change observable behavior — is to key
 *   pending tasks by `key` (generic; e.g. a page id) and overwrite in place
 *   if the same key is enqueued again before it has been flushed. Whichever
 *   callback was enqueued *last* for a given key is the one that runs,
 *   which matches how the app already behaves today (navigating to the
 *   same page again just re-renders it with the newest call).
 *
 * HOW THIS WILL BE USED IN PHASE 16.3+
 *   A future scheduler that defers flushing across multiple synchronous
 *   enqueue() calls (e.g. within one animation frame) will rely on this
 *   registry to guarantee at most one render per key survives to that
 *   flush. In this phase, RenderQueue.flush() is still called synchronously
 *   right after enqueue() (see RenderQueue.js), so no observable batching
 *   occurs yet — but the coalescing mechanism itself is real and active
 *   from day one.
 *
 * WHY THIS CANNOT BREAK THE EXISTING APP
 *   - Defines exactly one global: window.RenderRegistry.
 *   - Every method only manipulates this file's own internal map/array.
 *     No DOM access, no storage access, no callback invocation happens
 *     here — invocation is strictly RenderDispatcher's job.
 *   - Nothing outside js/core/render/* references this file in this phase.
 * ==========================================================================*/
(function (global) {
  'use strict';

  function RenderRegistry() {
    this._tasksByKey = Object.create(null); // Map<key, RenderTask>
    this._order = []; // Array<key>, insertion order of the *first* pending occurrence
  }

  /**
   * Adds (or replaces, if `key` is already pending) a task.
   * Returns true if this call coalesced with an existing pending task for
   * the same key (i.e. it was a duplicate within the same un-flushed
   * window), false if it was a brand new pending entry.
   */
  RenderRegistry.prototype.add = function (task) {
    if (!task || !task.key) return false;
    var alreadyPending = Object.prototype.hasOwnProperty.call(this._tasksByKey, task.key);
    this._tasksByKey[task.key] = task; // Last write wins for this key.
    if (!alreadyPending) {
      this._order.push(task.key);
    }
    return alreadyPending;
  };

  RenderRegistry.prototype.hasPending = function (key) {
    if (key === undefined) return this._order.length > 0;
    return Object.prototype.hasOwnProperty.call(this._tasksByKey, key);
  };

  /** Returns pending tasks in first-enqueued order, without removing them. */
  RenderRegistry.prototype.getPending = function () {
    var out = [];
    for (var i = 0; i < this._order.length; i++) {
      var key = this._order[i];
      if (Object.prototype.hasOwnProperty.call(this._tasksByKey, key)) {
        out.push(this._tasksByKey[key]);
      }
    }
    return out;
  };

  /** Removes and returns all pending tasks, in first-enqueued order. */
  RenderRegistry.prototype.drain = function () {
    var drained = this.getPending();
    this._tasksByKey = Object.create(null);
    this._order = [];
    return drained;
  };

  /** Removes a single pending task by key, if present. Returns it or null. */
  RenderRegistry.prototype.remove = function (key) {
    if (!Object.prototype.hasOwnProperty.call(this._tasksByKey, key)) return null;
    var task = this._tasksByKey[key];
    delete this._tasksByKey[key];
    var idx = this._order.indexOf(key);
    if (idx >= 0) this._order.splice(idx, 1);
    return task;
  };

  global.RenderRegistry = new RenderRegistry();
})(window);
