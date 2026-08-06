/* ============================================================================
 * PHASE 16.5 — VIEW CACHE & DIRTY TRACKING (ZERO REGRESSION, ADDITIVE)
 * File: js/core/view/ViewVersion.js
 * ----------------------------------------------------------------------------
 * WHAT THIS IS
 *   A tiny, independent per-page counter representing "which data
 *   generation is this page's underlying data currently at". It has no
 *   knowledge of pages, DOM, or rendering — it is pure bookkeeping, exactly
 *   like ShellState.js was for Phase 16.1.
 *
 * WHY IT EXISTS
 *   ViewCache.js needs something to compare against: "the version that was
 *   on screen last time" vs. "the version that is current now". ViewVersion
 *   is the "current now" half of that comparison. Nothing bumps this
 *   automatically in this phase (that would require touching Repository or
 *   module files, which is out of scope for Phase 16.5) — it starts at 0
 *   for every page and only advances when something explicitly calls
 *   bump(pageId), e.g. via ApplicationShell.markDirty(pageId).
 *
 * PUBLIC API
 *   ViewVersion.getVersion(pageId) -> number (0 if never bumped)
 *   ViewVersion.bump(pageId)       -> number (new version, after increment)
 *
 * WHY THIS CANNOT BREAK THE EXISTING APP
 *   - Adds exactly one global: window.ViewVersion.
 *   - Pure in-memory bookkeeping only; no DOM, no storage, no render calls.
 *   - Nothing pre-existing reads or writes window.ViewVersion, so its mere
 *     presence has zero effect until something (ViewLifecycle.js) chooses
 *     to consult it.
 * ==========================================================================*/
(function (global) {
  'use strict';

  function ViewVersion() {
    this._versions = Object.create(null); // Map<pageId, number>
  }

  ViewVersion.prototype.getVersion = function (pageId) {
    if (!pageId) return 0;
    return this._versions[pageId] || 0;
  };

  ViewVersion.prototype.bump = function (pageId) {
    if (!pageId) return 0;
    var next = (this._versions[pageId] || 0) + 1;
    this._versions[pageId] = next;
    return next;
  };

  global.ViewVersion = new ViewVersion();
})(window);
