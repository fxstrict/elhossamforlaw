/* ============================================================================
 * PHASE 16.1 — APPLICATION SHELL FOUNDATION
 * File: js/core/shell/BootState.js
 * ----------------------------------------------------------------------------
 * WHAT THIS IS
 *   A tiny state machine that tracks which phase of *startup* the Shell
 *   itself is in: NOT_STARTED -> BOOTING -> READY. This is about the Shell's
 *   own readiness, not about page rendering and not about the existing
 *   Repository/DatabaseService boot sequence (RepositoryReadyCoordinator
 *   already owns that, and Phase 16.1 is explicitly forbidden from touching
 *   it).
 *
 * WHY IT EXISTS (Phase 16.1)
 *   Phase 16.0's audit named "no real Application Shell" as the root cause
 *   of the flashing/re-render symptoms. A Shell needs to know, unambiguously,
 *   whether it has finished registering pages/views/navigation before
 *   anything asks it questions like "what page is mounted?". BootState gives
 *   every other Shell file a single, explicit source of truth for that,
 *   instead of guessing from timing.
 *
 * HOW THIS WILL BE USED IN PHASE 16.2+
 *   Future phases (Render Queue, Lazy Mount, Skeleton, Hydration — all
 *   explicitly out of scope here) will refuse to do their work until
 *   BootState.isReady() is true, so that e.g. a render queue never tries to
 *   flush before the Shell has finished discovering pages. Right now nothing
 *   consumes this except ApplicationShell.js itself.
 *
 * WHY THIS CANNOT BREAK THE EXISTING APP
 *   - Defines exactly one global: window.ShellBootState.
 *   - Purely in-memory bookkeeping; touches no DOM, no storage, no CSS.
 *   - Nothing in the pre-existing app reads or writes this object, so its
 *     presence or absence has zero effect on current behavior.
 * ==========================================================================*/
(function (global) {
  'use strict';

  var PHASES = Object.freeze({
    NOT_STARTED: 'NOT_STARTED',
    BOOTING: 'BOOTING',
    READY: 'READY'
  });

  function BootState() {
    this._phase = PHASES.NOT_STARTED;
  }

  BootState.prototype.begin = function () {
    if (this._phase === PHASES.NOT_STARTED) this._phase = PHASES.BOOTING;
  };

  BootState.prototype.markReady = function () {
    this._phase = PHASES.READY;
  };

  BootState.prototype.getPhase = function () {
    return this._phase;
  };

  BootState.prototype.isReady = function () {
    return this._phase === PHASES.READY;
  };

  global.ShellBootState = new BootState();
  global.ShellBootState.PHASES = PHASES;
})(window);
