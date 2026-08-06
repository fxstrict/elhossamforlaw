/* ============================================================================
 * PHASE 16.5 — VIEW CACHE & DIRTY TRACKING (ZERO REGRESSION, ADDITIVE)
 * File: js/core/view/PageState.js
 * ----------------------------------------------------------------------------
 * WHAT THIS IS
 *   A small, generic per-page state bag scoped to the new view-cache layer,
 *   plus a `lastRenderedAt` timestamp. Deliberately independent from
 *   ShellState.getPageState()/setPageState() (Phase 16.1), which already
 *   exists for a different layer — Phase 16.5 was scoped to be a fully
 *   separate, self-contained set of files.
 *
 * WHY IT EXISTS
 *   Reserved for future, view-cache-specific per-page data (e.g. scroll
 *   position, active filters) that this phase does not yet populate beyond
 *   the render timestamp ViewLifecycle records. Nothing reads this data
 *   yet except getLastRenderedAt(), which exists for diagnostics/future use
 *   and is not consulted by navigate()'s skip decision in this phase.
 *
 * PUBLIC API
 *   PageState.get(pageId) -> object|null
 *   PageState.set(pageId, bag)
 *   PageState.touch(pageId)            // stamps bag.lastRenderedAt = now
 *   PageState.getLastRenderedAt(pageId) -> number|null
 *
 * WHY THIS CANNOT BREAK THE EXISTING APP
 *   - Adds exactly one global: window.PageState.
 *   - Nothing pre-existing reads or writes window.PageState.
 *   - Never touches the DOM.
 * ==========================================================================*/
(function (global) {
  'use strict';

  function PageState() {
    this._state = Object.create(null); // Map<pageId, object>
  }

  PageState.prototype.get = function (pageId) {
    return (pageId && this._state[pageId]) || null;
  };

  PageState.prototype.set = function (pageId, bag) {
    if (!pageId) return;
    this._state[pageId] = bag;
  };

  PageState.prototype.touch = function (pageId) {
    if (!pageId) return;
    var bag = this._state[pageId] || {};
    bag.lastRenderedAt = Date.now();
    this._state[pageId] = bag;
  };

  PageState.prototype.getLastRenderedAt = function (pageId) {
    var bag = pageId && this._state[pageId];
    return (bag && bag.lastRenderedAt) || null;
  };

  global.PageState = new PageState();
})(window);
