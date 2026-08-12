/* ============================================================================
 * PHASE 16.2 — RENDER QUEUE FOUNDATION (ZERO REGRESSION)
 * File: js/core/render/RenderQueue.js
 * ----------------------------------------------------------------------------
 * WHAT THIS IS
 *   The single public entry point for the new Render Queue layer. Every
 *   other file in js/core/render/ (RenderTaskFactory, RenderRegistry,
 *   RenderScheduler, RenderDispatcher, RenderMetrics) is an internal
 *   building block. `window.RenderQueue` is the only one of these objects
 *   code outside js/core/render/ is meant to touch.
 *
 * WHY THIS LAYER EXISTS (Phase 16.1 -> 16.2)
 *   Phase 16.1 built the Application Shell so the app would finally have a
 *   single source of truth for page lifecycle (current/previous/mounted).
 *   The next problem named in the Phase 16.0 audit was "no single entry
 *   point for rendering" — every render call happens ad hoc, directly,
 *   wherever code decides a page needs to be shown. Phase 16.2's job is
 *   ONLY to build a generic queue that CAN become that single entry point.
 *
 *   This phase deliberately does NOT change when or how anything renders.
 *   `flush()` runs queued callbacks immediately, synchronously, in the
 *   exact order they were enqueued — indistinguishable from calling them
 *   directly. No caching, no dirty-page skipping, no deferral, no view
 *   diffing. Those are explicitly reserved for Phase 16.3+.
 *
 * WHY IT IS GENERIC (no knowledge of cases/clients/tasks/dashboard/etc.)
 *   RenderQueue takes an opaque `key` (any string) and an opaque
 *   `callback` (any zero-argument function). It never branches on what
 *   `key` is. This is what lets the SAME queue eventually serve every page
 *   in the app without ever needing entity-specific code inside
 *   js/core/render/.
 *
 * PUBLIC API
 *   RenderQueue.enqueue(key, callback, meta)
 *       Registers `callback` to run for `key`. If a task for the same
 *       `key` is already pending (not yet flushed), the new callback
 *       REPLACES it (see RenderRegistry.js) — this is the "prevent
 *       duplicate scheduling in the same tick" requirement. Returns the
 *       RenderTask that was stored.
 *
 *   RenderQueue.flush()
 *       Drains every pending task, in first-enqueued order, and runs each
 *       one via RenderDispatcher (which calls the callback unmodified,
 *       inside a try/catch). In THIS phase, nothing calls scheduleFlush()
 *       asynchronously — flush() always executes right now, synchronously,
 *       exactly like calling the callbacks directly would. Returns an array
 *       of per-task results (`{ task, error, durationMs }`).
 *
 *   RenderQueue.cancel(key)
 *       Removes a pending task for `key` without running it. Returns the
 *       removed task, or null if nothing was pending for that key.
 *
 *   RenderQueue.hasPending(key)
 *       With a key: is that specific key currently queued? Without a key:
 *       is anything at all currently queued?
 *
 *   RenderQueue.getPending()
 *       Read-only snapshot array of currently pending tasks, in order.
 *
 *   RenderQueue.getStatistics()
 *       Snapshot of RenderMetrics counters (see that file).
 *
 *   RenderQueue.wrap(key, renderFn)
 *       Convenience helper: returns a NEW function that, when called,
 *       enqueues `renderFn` under `key` and immediately flushes just that
 *       one task — i.e. calling the wrapped function behaves exactly like
 *       calling `renderFn()` directly, except the call now goes through
 *       the queue (satisfying "wrap them only, do not rewrite them").
 *       `renderFn` itself is never modified, copied, or re-implemented —
 *       only invoked, unchanged, when the wrapper runs.
 *       NOTE: this phase does not apply `.wrap()` to any of the existing
 *       renderDashboard/renderCases/... functions — see "Integration" at
 *       the bottom of this file for why.
 *
 * HOW THIS WILL BE USED IN PHASE 16.3+
 *   Phase 16.3 is expected to be the phase that actually threads
 *   navigate()'s render call sites through `RenderQueue.enqueue()` /
 *   `.wrap()`, and to change RenderScheduler so that `flush()` is no
 *   longer forced to run synchronously the instant something is enqueued
 *   — enabling real de-duplication of renders across a tick. NONE of that
 *   is implemented here. This phase only proves the queue mechanics work
 *   (enqueue, coalesce, flush, cancel, inspect, measure) without anything
 *   yet depending on them for correctness.
 *
 * HOW THIS PREVENTS FUTURE DOUBLE RENDERING
 *   Because RenderRegistry stores at most one pending task per key,
 *   ANY future caller that enqueues the same key twice before a flush —
 *   whether by mistake or because two unrelated code paths both decided
 *   "page X needs a render" — collapses into a single render when
 *   flush() finally runs, instead of running twice. That coalescing logic
 *   is real and active starting in this phase (see RenderMetrics
 *   .duplicatesCoalesced), even though nothing exercises it yet because
 *   nothing enqueues through this queue in normal app usage yet.
 *
 * WHY THIS CANNOT BREAK THE EXISTING APP (zero-regression checklist)
 *   - Adds exactly one PUBLIC global: window.RenderQueue. The supporting
 *     globals (RenderTaskFactory, RenderRegistry, RenderScheduler,
 *     RenderDispatcher, RenderMetrics) are internal to this layer, exactly
 *     as ShellPageRegistry/etc. were internal to the Shell layer in 16.1.
 *   - No existing render function (renderDashboard, renderCases, ...) was
 *     modified, wrapped in place, or replaced. This file does not even
 *     reference them by name — it is entity-agnostic by construction.
 *   - navigate() in index.html was NOT touched in this phase. The brief
 *     allows routing navigate() through the Shell "only if absolutely
 *     necessary" — it is not necessary to prove this Foundation works, so
 *     navigate()'s render call sites remain exactly as they were after
 *     Phase 16.1, unchanged, calling render functions directly.
 *   - Repository, DatabaseService, StorageAdapter,
 *     RepositoryReadyCoordinator, and every js/core/shell/* file from
 *     Phase 16.1 are unreferenced and unmodified by this file.
 *   - Every public method is wrapped so an internal failure cannot
 *     propagate to a caller in a way that would break app behavior.
 * ==========================================================================*/
(function (global) {
  'use strict';

  function safely(fn, fallback) {
    try {
      return fn();
    } catch (err) {
      if (global.console && global.console.warn) {
        global.console.warn('[RenderQueue] internal error (swallowed):', err);
      }
      return fallback;
    }
  }

  function RenderQueue() {}

  RenderQueue.prototype.enqueue = function (key, callback, meta) {
    return safely(function () {
      if (!key || typeof callback !== 'function') return null;
      var task = global.RenderTaskFactory.create(key, callback, meta);
      var wasDuplicate = global.RenderRegistry.add(task);
      if (global.RenderMetrics) {
        global.RenderMetrics.recordEnqueue();
        if (wasDuplicate) global.RenderMetrics.recordDuplicateCoalesced();
      }
      return task;
    }, null);
  };

  RenderQueue.prototype.flush = function () {
    return safely(function () {
      var results = [];
      global.RenderScheduler.scheduleFlush(function () {
        var pending = global.RenderRegistry.drain();
        var batchStart = (global.performance && global.performance.now) ? global.performance.now() : Date.now();
        for (var i = 0; i < pending.length; i++) {
          results.push(global.RenderDispatcher.run(pending[i]));
        }
        var batchEnd = (global.performance && global.performance.now) ? global.performance.now() : Date.now();
        if (global.RenderMetrics) {
          global.RenderMetrics.recordFlushBatch(pending.length, batchEnd - batchStart);
        }
      });
      return results;
    }, []);
  };

  RenderQueue.prototype.cancel = function (key) {
    return safely(function () {
      var removed = global.RenderRegistry.remove(key);
      if (removed && global.RenderMetrics) global.RenderMetrics.recordCancelled();
      return removed;
    }, null);
  };

  RenderQueue.prototype.hasPending = function (key) {
    return safely(function () {
      return global.RenderRegistry.hasPending(key);
    }, false);
  };

  RenderQueue.prototype.getPending = function () {
    return safely(function () {
      return global.RenderRegistry.getPending();
    }, []);
  };

  RenderQueue.prototype.getStatistics = function () {
    return safely(function () {
      return global.RenderMetrics.getSnapshot();
    }, null);
  };

  /**
   * See file-header docs: wraps (never rewrites) a render callback so
   * calling the returned function behaves like calling `renderFn` directly,
   * routed through enqueue+flush. Not applied to any existing render
   * function in this phase.
   */
  RenderQueue.prototype.wrap = function (key, renderFn) {
    var self = this;
    return function () {
      var args = arguments;
      var thisArg = this;
      self.enqueue(key, function () {
        renderFn.apply(thisArg, args);
      });
      return self.flush();
    };
  };

  global.RenderQueue = new RenderQueue();
})(window);
