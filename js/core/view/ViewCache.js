/* ============================================================================
 * PHASE 16.5 — VIEW CACHE & DIRTY TRACKING (ZERO REGRESSION, ADDITIVE)
 * File: js/core/view/ViewCache.js
 * ----------------------------------------------------------------------------
 * WHAT THIS IS
 *   The "cache" half of the layer: for each page, remembers which
 *   ViewVersion number was actually on screen after the last real paint.
 *   Pure bookkeeping only — no DOM, no render calls.
 *
 * WHY IT EXISTS
 *   ViewLifecycle.js needs to answer "is what's currently painted still
 *   correct?" by comparing this cached value against ViewVersion's current
 *   value. A page that has never been rendered has no cached value at all
 *   (null), which always compares as "needs render" the first time.
 *
 * PUBLIC API
 *   ViewCache.getRenderedVersion(pageId) -> number|null
 *   ViewCache.setRenderedVersion(pageId, version)
 *   ViewCache.hasRendered(pageId) -> boolean
 *
 * WHY THIS CANNOT BREAK THE EXISTING APP
 *   - Adds exactly one global: window.ViewCache.
 *   - Nothing pre-existing reads or writes window.ViewCache.
 *   - Never touches the DOM; it only stores numbers set by ViewLifecycle.
 * ==========================================================================*/
(function (global) {
  'use strict';

  function ViewCache() {
    this._renderedVersion = Object.create(null); // Map<pageId, number>
    this._hasRendered = Object.create(null); // Map<pageId, boolean>
  }

  ViewCache.prototype.getRenderedVersion = function (pageId) {
    if (!pageId || !(pageId in this._renderedVersion)) return null;
    return this._renderedVersion[pageId];
  };

  ViewCache.prototype.setRenderedVersion = function (pageId, version) {
    if (!pageId) return;
    this._renderedVersion[pageId] = version;
    this._hasRendered[pageId] = true;
  };

  ViewCache.prototype.hasRendered = function (pageId) {
    return !!(pageId && this._hasRendered[pageId]);
  };

  global.ViewCache = new ViewCache();
})(window);
