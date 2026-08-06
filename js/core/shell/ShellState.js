/* ============================================================================
 * PHASE 16.1 — APPLICATION SHELL FOUNDATION
 * File: js/core/shell/ShellState.js
 * ----------------------------------------------------------------------------
 * WHAT THIS IS
 *   The single, central piece of bookkeeping for "what page are we on and
 *   what do we know about it": current page, previous page, which pages
 *   have ever been mounted, which pages are flagged as needing a render,
 *   and a small per-page state bag for arbitrary saved values (e.g. scroll
 *   position, filters — nothing is stored there yet; the bag just exists).
 *
 *   This file does NOT render anything, does NOT touch the DOM directly,
 *   and does NOT decide when a page "needs render" on its own — it only
 *   stores flags that something else sets and reads.
 *
 * WHY IT EXISTS (Phase 16.1)
 *   Right now this information does not exist anywhere as a single source
 *   of truth. `currentPage` is a loose global variable set inside
 *   navigate(); "previous page", "is X mounted", and "does X need a
 *   render" are not tracked at all — every page just re-renders in full,
 *   every time, unconditionally. The Phase 16.0 audit named exactly this
 *   ("Repository re-render", "Double Rendering") as the root cause of the
 *   flashing/layout-shift symptoms. Before that can be fixed, the Shell
 *   needs somewhere to record this information. This file is that place.
 *
 * HOW THIS WILL BE USED IN PHASE 16.2+
 *   Phase 16.2+ can consult `isMounted(page)` / `needsRender(page)` to
 *   decide whether to skip a redundant render (the actual skip-logic, i.e.
 *   a Render Queue, is explicitly out of scope for 16.1). Until then,
 *   nothing conditions its behavior on these flags — LifecycleManager
 *   updates them, but no existing render call checks them.
 *
 * WHY THIS CANNOT BREAK THE EXISTING APP
 *   - Defines exactly one global: window.ShellState.
 *   - Every method is pure bookkeeping (get/set on internal fields). None
 *     of them touch the DOM, storage, or call any render function.
 *   - Nothing in the pre-existing app (index.html inline script, js/modules
 *     /*, js/repositories/*) reads or writes window.ShellState, so its
 *     presence has zero effect on current behavior. It only starts having
 *     an effect once something (Phase 16.2+) chooses to read these flags
 *     and act on them.
 * ==========================================================================*/
(function (global) {
  'use strict';

  function ShellState() {
    this._currentPage = null;
    this._previousPage = null;
    this._mountedPages = Object.create(null); // Map<pageId, true>
    this._needsRender = Object.create(null); // Map<pageId, boolean>
    this._pageState = Object.create(null); // Map<pageId, arbitrary bag>
  }

  ShellState.prototype.getCurrentPage = function () {
    return this._currentPage;
  };

  ShellState.prototype.getPreviousPage = function () {
    return this._previousPage;
  };

  /**
   * Records that navigation to `pageId` has happened. Shifts current ->
   * previous. Marks the new page as mounted (a page, once shown, stays
   * "mounted" in this app's current architecture — there is no unmount/
   * destroy step today) and clears its needs-render flag (it was just
   * rendered by the existing navigate() logic, which is untouched).
   */
  ShellState.prototype.recordNavigation = function (pageId) {
    if (!pageId) return;
    if (this._currentPage !== pageId) {
      this._previousPage = this._currentPage;
    }
    this._currentPage = pageId;
    this._mountedPages[pageId] = true;
    this._needsRender[pageId] = false;
  };

  ShellState.prototype.isMounted = function (pageId) {
    return !!this._mountedPages[pageId];
  };

  ShellState.prototype.needsRender = function (pageId) {
    // Unknown pages are treated as needing a render the first time they're
    // asked about, since they've never been confirmed rendered.
    if (!(pageId in this._needsRender)) return true;
    return !!this._needsRender[pageId];
  };

  ShellState.prototype.markNeedsRender = function (pageId) {
    if (!pageId) return;
    this._needsRender[pageId] = true;
  };

  ShellState.prototype.getPageState = function (pageId) {
    return this._pageState[pageId] || null;
  };

  ShellState.prototype.setPageState = function (pageId, stateBag) {
    if (!pageId) return;
    this._pageState[pageId] = stateBag;
  };

  global.ShellState = new ShellState();
})(window);
