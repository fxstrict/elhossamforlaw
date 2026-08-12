/* ============================================================================
 * PHASE 16.5 — VIEW CACHE & DIRTY TRACKING (ZERO REGRESSION, ADDITIVE)
 * File: js/core/view/DirtyTracker.js
 * ----------------------------------------------------------------------------
 * WHAT THIS IS
 *   An independent, per-page boolean flag: "does this page's rendered
 *   output need to be repainted?". Pure bookkeeping only — no DOM, no
 *   render calls, no dependency on ShellState/ApplicationShell.
 *
 * DEFAULT-DIRTY CONVENTION
 *   A page that has never been marked either way is treated as dirty
 *   (true). This mirrors the exact same convention already used by
 *   ShellState.needsRender() in Phase 16.1 — a page must be proven clean
 *   before it is ever skipped; unknown state is never assumed safe.
 *
 * PUBLIC API
 *   DirtyTracker.markDirty(pageId)
 *   DirtyTracker.clearDirty(pageId)
 *   DirtyTracker.isDirty(pageId) -> boolean (true if unknown)
 *
 * WHY THIS CANNOT BREAK THE EXISTING APP
 *   - Adds exactly one global: window.DirtyTracker.
 *   - Nothing pre-existing reads or writes window.DirtyTracker.
 *   - This is intentionally a *separate* tracker from ShellState's own
 *     needsRender/markNeedsRender (Phase 16.1) — Phase 16.5 was explicitly
 *     scoped to build a new, independent layer, not to repurpose the old
 *     one, so the two can evolve independently without risk of collision.
 * ==========================================================================*/
(function (global) {
  'use strict';

  function DirtyTracker() {
    this._dirty = Object.create(null); // Map<pageId, boolean>
  }

  DirtyTracker.prototype.markDirty = function (pageId) {
    if (!pageId) return;
    this._dirty[pageId] = true;
  };

  DirtyTracker.prototype.clearDirty = function (pageId) {
    if (!pageId) return;
    this._dirty[pageId] = false;
  };

  DirtyTracker.prototype.isDirty = function (pageId) {
    if (!pageId) return true;
    if (!(pageId in this._dirty)) return true; // unseen page => dirty by default
    return !!this._dirty[pageId];
  };

  global.DirtyTracker = new DirtyTracker();
})(window);
