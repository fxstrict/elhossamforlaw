/* ============================================================================
 * PHASE 16.2 — RENDER QUEUE FOUNDATION (ZERO REGRESSION)
 * File: js/core/render/RenderDispatcher.js
 * ----------------------------------------------------------------------------
 * WHAT THIS IS
 *   The only place that actually CALLS a render callback. It takes one
 *   RenderTask, invokes `task.callback()`, times it, and reports the result
 *   to RenderMetrics. It never inspects `task.key` or `task.meta` beyond
 *   passing them through — it has no idea what it's rendering.
 *
 * WHY IT EXISTS (Phase 16.2)
 *   The brief requires existing render functions (renderDashboard,
 *   renderCases, ...) to be WRAPPED, never rewritten. "Wrapping" means:
 *   something else calls them, unmodified, inside a safety net (so one
 *   page's render error can never take down the whole queue or the caller)
 *   and reports timing. This file is that safety net. It contains zero
 *   entity-specific logic.
 *
 * HOW THIS WILL BE USED IN PHASE 16.3+
 *   Unchanged in spirit — later phases may add things like "skip if
 *   ShellState says this key doesn't need a render" BEFORE calling this
 *   dispatcher, but the dispatcher's own job (safely invoke one callback,
 *   record how long it took) is not expected to change.
 *
 * WHY THIS CANNOT BREAK THE EXISTING APP
 *   - Defines exactly one global: window.RenderDispatcher.
 *   - run() calls `task.callback()` completely unmodified — same
 *     arguments (none added), same `this` (global), same return value
 *     path an ordinary direct call would have.
 *   - A callback throwing is caught here so it cannot propagate out of the
 *     dispatcher; the error is recorded in RenderMetrics and returned to
 *     the caller (RenderQueue) as part of the result, never silently
 *     swallowed and never rethrown.
 *   - Nothing outside js/core/render/* references this file in this phase,
 *     and no existing render function had to change to be compatible with
 *     it — any zero-argument function works as-is.
 * ==========================================================================*/
(function (global) {
  'use strict';

  function now() {
    return (global.performance && global.performance.now) ? global.performance.now() : Date.now();
  }

  var RenderDispatcher = {
    /**
     * Executes exactly one RenderTask's callback, unmodified, and returns
     * a result descriptor. Never throws.
     */
    run: function (task) {
      var start = now();
      var error = null;
      if (task && typeof task.callback === 'function') {
        try {
          task.callback();
        } catch (err) {
          error = err;
          if (global.console && global.console.warn) {
            global.console.warn('[RenderDispatcher] render callback for key "' + task.key + '" threw:', err);
          }
        }
      }
      var durationMs = now() - start;
      if (global.RenderMetrics) {
        global.RenderMetrics.recordTaskFlushed(durationMs, !!error);
      }
      return { task: task, error: error, durationMs: durationMs };
    }
  };

  global.RenderDispatcher = RenderDispatcher;
})(window);
