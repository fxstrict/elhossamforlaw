/* ============================================================================
 * PHASE 16.2 — RENDER QUEUE FOUNDATION (ZERO REGRESSION)
 * File: js/core/render/RenderMetrics.js
 * ----------------------------------------------------------------------------
 * WHAT THIS IS
 *   A pure counter/statistics object. It does not render anything, does not
 *   decide anything, and does not know what a "page" or "entity" is. It
 *   only records numbers that RenderQueue/RenderDispatcher report to it.
 *
 * WHY IT EXISTS (Phase 16.2)
 *   Before Phase 16.3 can be trusted to skip or defer renders, someone
 *   needs to be able to answer "how many renders actually happened, how
 *   many duplicate requests were coalesced, how long did the last flush
 *   take?". Without a neutral counter, that would have to be guessed from
 *   logs. This file is that neutral counter, built now so it is available
 *   from day one — it currently just counts; nothing consumes the numbers
 *   yet to change behavior.
 *
 * HOW THIS WILL BE USED IN PHASE 16.3+
 *   A future Render Scheduler that actually defers/batches work can use
 *   `duplicatesCoalesced` to prove it is preventing redundant renders, and
 *   `lastFlushDurationMs` to compare before/after a real optimization is
 *   introduced. Not used for any decision-making in this phase.
 *
 * WHY THIS CANNOT BREAK THE EXISTING APP
 *   - Defines exactly one global: window.RenderMetrics.
 *   - Every method is a plain counter increment/read; none of them touch
 *     the DOM, storage, or call any render function.
 *   - Nothing outside js/core/render/* reads or writes this object in this
 *     phase, so its presence has zero effect on current behavior.
 * ==========================================================================*/
(function (global) {
  'use strict';

  function RenderMetrics() {
    this.reset();
  }

  RenderMetrics.prototype.reset = function () {
    this.totalEnqueued = 0;
    this.totalFlushed = 0;
    this.totalCancelled = 0;
    this.totalErrors = 0;
    this.duplicatesCoalesced = 0;
    this.lastFlushCount = 0;
    this.lastFlushDurationMs = 0;
  };

  RenderMetrics.prototype.recordEnqueue = function () {
    this.totalEnqueued++;
  };

  RenderMetrics.prototype.recordDuplicateCoalesced = function () {
    this.duplicatesCoalesced++;
  };

  RenderMetrics.prototype.recordCancelled = function () {
    this.totalCancelled++;
  };

  RenderMetrics.prototype.recordTaskFlushed = function (durationMs, hadError) {
    this.totalFlushed++;
    if (hadError) this.totalErrors++;
    this.lastFlushDurationMs += (typeof durationMs === 'number' ? durationMs : 0);
  };

  RenderMetrics.prototype.recordFlushBatch = function (count, totalDurationMs) {
    this.lastFlushCount = count;
    this.lastFlushDurationMs = totalDurationMs || 0;
  };

  RenderMetrics.prototype.getSnapshot = function () {
    return {
      totalEnqueued: this.totalEnqueued,
      totalFlushed: this.totalFlushed,
      totalCancelled: this.totalCancelled,
      totalErrors: this.totalErrors,
      duplicatesCoalesced: this.duplicatesCoalesced,
      lastFlushCount: this.lastFlushCount,
      lastFlushDurationMs: this.lastFlushDurationMs
    };
  };

  global.RenderMetrics = new RenderMetrics();
})(window);
