/* ============================================================================
 * PHASE 16.1 — APPLICATION SHELL FOUNDATION
 * File: js/core/shell/PageRegistry.js
 * ----------------------------------------------------------------------------
 * WHAT THIS IS
 *   A registry that KNOWS ABOUT pages (dashboard, cases, sessions, ...) —
 *   their id, their container element, and their human title — without
 *   owning or changing how those pages are shown/hidden. Today the app
 *   already has this information scattered across index.html (elements with
 *   class="page" id="page-<name>") and the PAGE_TITLES object in the inline
 *   script. This registry does not replace either of those; it simply gives
 *   the Shell layer a structured, queryable copy.
 *
 * WHY IT EXISTS (Phase 16.1)
 *   Before the Shell can manage lifecycle (mounted / needs-render / current
 *   / previous), it needs a canonical list of "what is a page". Building
 *   that list requires no changes to existing HTML or to PAGE_TITLES — this
 *   registry is populated by reading the DOM that already exists (auto
 *   discovery), so there is nothing new to keep in sync by hand.
 *
 * HOW THIS WILL BE USED IN PHASE 16.2+
 *   Future phases (View Cache, Lazy Mount, DOM Diff) will use this registry
 *   to look up "which element is page X" instead of re-querying
 *   document.getElementById('page-' + x) all over the codebase. Right now
 *   it is read-only bookkeeping consumed only by ApplicationShell.js.
 *
 * WHY THIS CANNOT BREAK THE EXISTING APP
 *   - Defines exactly one global: window.ShellPageRegistry.
 *   - discoverFromDom() only READS the DOM (querySelectorAll); it never
 *     adds, removes, or mutates any element, attribute, or class.
 *   - If called before the DOM elements exist, it simply registers nothing
 *     and can safely be called again later — no exceptions are thrown to
 *     the caller.
 * ==========================================================================*/
(function (global) {
  'use strict';

  function PageRegistry() {
    // Map<pageId, { id, element, title }>
    this._pages = Object.create(null);
  }

  /**
   * Reads the *existing* page containers from the DOM
   * (`.page[id^="page-"]`) and, optionally, a title lookup already present
   * in the app (e.g. the inline script's PAGE_TITLES) to fill in
   * human-readable titles. Purely additive/observational.
   */
  PageRegistry.prototype.discoverFromDom = function (titleLookup) {
    var nodeList;
    try {
      nodeList = global.document.querySelectorAll('.page[id^="page-"]');
    } catch (err) {
      return; // No DOM yet / not a browser context — nothing to discover.
    }
    for (var i = 0; i < nodeList.length; i++) {
      var el = nodeList[i];
      var pageId = el.id.replace(/^page-/, '');
      if (!pageId) continue;
      var title = (titleLookup && titleLookup[pageId]) || pageId;
      this.register(pageId, el, title);
    }
  };

  PageRegistry.prototype.register = function (pageId, element, title) {
    if (!pageId) return;
    this._pages[pageId] = {
      id: pageId,
      element: element || null,
      title: title || pageId
    };
  };

  PageRegistry.prototype.has = function (pageId) {
    return Object.prototype.hasOwnProperty.call(this._pages, pageId);
  };

  PageRegistry.prototype.get = function (pageId) {
    return this._pages[pageId] || null;
  };

  PageRegistry.prototype.list = function () {
    var out = [];
    for (var id in this._pages) {
      if (Object.prototype.hasOwnProperty.call(this._pages, id)) out.push(this._pages[id]);
    }
    return out;
  };

  global.ShellPageRegistry = new PageRegistry();
})(window);
