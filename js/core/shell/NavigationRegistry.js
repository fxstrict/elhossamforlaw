/* ============================================================================
 * PHASE 16.1 — APPLICATION SHELL FOUNDATION
 * File: js/core/shell/NavigationRegistry.js
 * ----------------------------------------------------------------------------
 * WHAT THIS IS
 *   A registry of the existing sidebar navigation elements
 *   (`.nav-item[onclick*="navigate('<page>')"]`), mapped to the page id
 *   they navigate to. It is a read-only index of what already exists in
 *   index.html — it does not create nav items, does not attach new click
 *   handlers, and does not change the existing onclick="navigate(...)"
 *   wiring in any way.
 *
 * WHY IT EXISTS (Phase 16.1)
 *   navigate() currently finds "which nav item is active" by re-scanning
 *   all `.nav-item` elements and string-comparing their onclick attribute
 *   every single call. That logic is left completely untouched in this
 *   phase (rule: don't change navigate()'s behavior). This registry simply
 *   gives the Shell its own structured copy of the same information, built
 *   once, so a future phase can replace that per-call DOM scan without
 *   guessing at the mapping from scratch.
 *
 * HOW THIS WILL BE USED IN PHASE 16.2+
 *   A future LifecycleManager/NavigationManager can use this to update the
 *   active nav item in O(1) instead of iterating and string-matching every
 *   element's onclick attribute on every navigation. Not wired in yet.
 *
 * WHY THIS CANNOT BREAK THE EXISTING APP
 *   - Defines exactly one global: window.ShellNavigationRegistry.
 *   - discoverFromDom() only reads the DOM; it never adds/removes
 *     attributes, classes, or listeners on any nav element.
 *   - Nothing in the existing app reads this registry, so its presence has
 *     no effect on current navigation behavior.
 * ==========================================================================*/
(function (global) {
  'use strict';

  function NavigationRegistry() {
    // Map<pageId, Array<Element>>  (usually one element per page, but the
    // registry supports more than one nav entry pointing at the same page).
    this._entries = Object.create(null);
  }

  NavigationRegistry.prototype.discoverFromDom = function () {
    var nodeList;
    try {
      nodeList = global.document.querySelectorAll('.nav-item');
    } catch (err) {
      return;
    }
    var onclickPattern = /navigate\(\s*'([^']+)'\s*\)/;
    for (var i = 0; i < nodeList.length; i++) {
      var el = nodeList[i];
      var onclickAttr = el.getAttribute && el.getAttribute('onclick');
      if (!onclickAttr) continue;
      var match = onclickPattern.exec(onclickAttr);
      if (!match) continue;
      this.register(match[1], el);
    }
  };

  NavigationRegistry.prototype.register = function (pageId, element) {
    if (!pageId || !element) return;
    if (!this._entries[pageId]) this._entries[pageId] = [];
    if (this._entries[pageId].indexOf(element) === -1) {
      this._entries[pageId].push(element);
    }
  };

  NavigationRegistry.prototype.get = function (pageId) {
    return this._entries[pageId] ? this._entries[pageId].slice() : [];
  };

  NavigationRegistry.prototype.list = function () {
    var out = [];
    for (var id in this._entries) {
      if (Object.prototype.hasOwnProperty.call(this._entries, id)) {
        out.push({ pageId: id, elements: this._entries[id].slice() });
      }
    }
    return out;
  };

  global.ShellNavigationRegistry = new NavigationRegistry();
})(window);
