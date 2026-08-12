/* ============================================================================
 * PHASE 16.2 — RENDER QUEUE FOUNDATION (ZERO REGRESSION)
 * File: js/core/render/RenderScheduler.js
 * ----------------------------------------------------------------------------
 * WHAT THIS IS
 *   The single place that decides WHEN a flush runs. It does not decide
 *   WHAT runs (RenderRegistry) or run tasks itself (RenderDispatcher) — it
 *   only calls the flush function it is given, at the time this phase says
 *   is correct.
 *
 * WHY IT EXISTS (Phase 16.2)
 *   The brief is explicit: "flush() must still execute renders immediately
 *   in the same visual order as today. No visible optimisation yet." So in
 *   this phase, `scheduleFlush(flushFn)` simply calls `flushFn()`
 *   synchronously, right now, no microtask/rAF/timeout involved — meaning
 *   render order and timing are byte-for-byte identical to calling the
 *   render function directly, exactly as the app does before this phase.
 *
 *   Splitting "when" into its own file — even though it does nothing but
 *   call its argument immediately today — means Phase 16.3+ can change
 *   *only this file* (e.g. to batch via `requestAnimationFrame` or
 *   coalesce across a microtask) without touching RenderQueue's public API
 *   or any of its callers.
 *
 * HOW THIS WILL BE USED IN PHASE 16.3+
 *   A future version of `scheduleFlush` could defer the call (e.g. via
 *   `Promise.resolve().then(flushFn)` or `requestAnimationFrame(flushFn)`)
 *   so that multiple enqueue() calls within the same tick genuinely batch
 *   into a single flush. That change is NOT made in this phase.
 *
 * WHY THIS CANNOT BREAK THE EXISTING APP
 *   - Defines exactly one global: window.RenderScheduler.
 *   - scheduleFlush() is a direct, synchronous call to its argument — it
 *     introduces no new asynchrony, no new timing, nothing that could
 *     reorder work relative to today's behavior.
 *   - Nothing outside js/core/render/* references this file in this phase.
 * ==========================================================================*/
(function (global) {
  'use strict';

  function RenderScheduler() {}

  /**
   * Phase 16.2: purely synchronous, immediate execution — this is what
   * guarantees "no visible optimisation yet". `flushFn` is called exactly
   * once, exactly now, with no deferral of any kind.
   */
  RenderScheduler.prototype.scheduleFlush = function (flushFn) {
    if (typeof flushFn !== 'function') return;
    flushFn();
  };

  global.RenderScheduler = new RenderScheduler();
})(window);
