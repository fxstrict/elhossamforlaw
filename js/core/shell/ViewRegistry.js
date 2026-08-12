/* ============================================================================
 * PHASE 16.1 — APPLICATION SHELL FOUNDATION
 * File: js/core/shell/ViewRegistry.js
 * ----------------------------------------------------------------------------
 * WHAT THIS IS
 *   A registry that can associate a page id with the function that renders
 *   it (renderCases, renderSessions, etc.). It is OPTIONAL and empty by
 *   default — Phase 16.1 explicitly does not wire it up to navigate(), and
 *   it never calls render functions itself. It exists purely as a place to
 *   register that mapping for future use.
 *
 * WHY IT EXISTS (Phase 16.1)
 *   The Phase 16.0 audit found render calls hard-coded into a long if/else
 *   chain inside navigate(). That if/else chain is NOT touched in this
 *   phase (rule: "no Render Queue", "no changes to navigate() behavior").
 *   But so that Phase 16.2 doesn't have to invent this mapping from
 *   scratch, this file gives it a home now, months before it's needed.
 *
 * HOW THIS WILL BE USED IN PHASE 16.2+
 *   A future Render Queue will look up a page's view function here
 *   (`ShellViewRegistry.get('cases')`) instead of the hard-coded if/else in
 *   navigate(), enabling de-duplicated / deferred rendering. Until that
 *   phase, nothing calls `.get()` for rendering purposes, and register()
 *   is not invoked from anywhere in Phase 16.1 — the registry is present
 *   but intentionally empty at rest.
 *
 * WHY THIS CANNOT BREAK THE EXISTING APP
 *   - Defines exactly one global: window.ShellViewRegistry.
 *   - register()/get() only manipulate this file's own internal map. They
 *     are never invoked by index.html or any other file in Phase 16.1, so
 *     this file has zero effect on current runtime behavior.
 *   - No render function is ever called from within this file.
 * ==========================================================================*/
(function (global) {
  'use strict';

  function ViewRegistry() {
    // Map<pageId, renderFn>
    this._views = Object.create(null);
  }

  ViewRegistry.prototype.register = function (pageId, renderFn) {
    if (!pageId || typeof renderFn !== 'function') return;
    this._views[pageId] = renderFn;
  };

  ViewRegistry.prototype.has = function (pageId) {
    return Object.prototype.hasOwnProperty.call(this._views, pageId);
  };

  ViewRegistry.prototype.get = function (pageId) {
    return this._views[pageId] || null;
  };

  global.ShellViewRegistry = new ViewRegistry();
})(window);
