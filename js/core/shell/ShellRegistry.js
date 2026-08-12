/* ============================================================================
 * PHASE 16.1 — APPLICATION SHELL FOUNDATION
 * File: js/core/shell/ShellRegistry.js
 * ----------------------------------------------------------------------------
 * WHAT THIS IS
 *   A thin convenience facade over the three specialized registries
 *   (PageRegistry, ViewRegistry, NavigationRegistry) so other code — and
 *   future phases — has one object to ask instead of three. It does not
 *   store anything itself; every method just forwards to the matching
 *   specialized registry.
 *
 * WHY IT EXISTS (Phase 16.1)
 *   Keeping Page/View/Navigation concerns in separate small files (per the
 *   Phase 16.1 brief) makes each one easy to read and audit in isolation.
 *   But call sites like ApplicationShell.js shouldn't need to know that
 *   split exists. ShellRegistry is the single door in front of all three.
 *
 * HOW THIS WILL BE USED IN PHASE 16.2+
 *   Future phases can keep depending on ShellRegistry.pages / .views /
 *   .navigation without caring if the internal split changes later.
 *
 * WHY THIS CANNOT BREAK THE EXISTING APP
 *   - Defines exactly one global: window.ShellRegistry.
 *   - Every property is a direct reference to an already-independent,
 *     already-safe registry object; this file adds no new behavior of its
 *     own beyond exposing them together.
 * ==========================================================================*/
(function (global) {
  'use strict';

  function ShellRegistry() {
    this.pages = global.ShellPageRegistry || null;
    this.views = global.ShellViewRegistry || null;
    this.navigation = global.ShellNavigationRegistry || null;
  }

  ShellRegistry.prototype.registerPage = function (pageId, element, title) {
    if (this.pages) this.pages.register(pageId, element, title);
  };

  ShellRegistry.prototype.registerView = function (pageId, renderFn) {
    if (this.views) this.views.register(pageId, renderFn);
  };

  ShellRegistry.prototype.registerNavigation = function (pageId, element) {
    if (this.navigation) this.navigation.register(pageId, element);
  };

  ShellRegistry.prototype.discoverFromDom = function (titleLookup) {
    if (this.pages) this.pages.discoverFromDom(titleLookup);
    if (this.navigation) this.navigation.discoverFromDom();
  };

  global.ShellRegistry = new ShellRegistry();
})(window);
