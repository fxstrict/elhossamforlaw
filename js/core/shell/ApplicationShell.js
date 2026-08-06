/* ============================================================================
 * PHASE 16.1 — APPLICATION SHELL FOUNDATION (ZERO REGRESSION)
 * File: js/core/shell/ApplicationShell.js
 * ----------------------------------------------------------------------------
 * WHAT THIS IS
 *   The single public entry point for the new Application Shell layer.
 *   Everything else in js/core/shell/ (ShellEvents, ShellBootState,
 *   ShellPageRegistry, ShellViewRegistry, ShellNavigationRegistry,
 *   ShellState, ShellLifecycleManager, ShellRegistry) is an internal
 *   building block. `window.ApplicationShell` is the only one of these
 *   objects that code outside js/core/shell/ is meant to touch.
 *
 * WHY THIS LAYER EXISTS (Phase 16.0 -> 16.1)
 *   Phase 16.0's architecture audit concluded the app's flashing / full
 *   re-paint / re-fetch / layout-shift / double-rendering symptoms are not
 *   a CSS or speed problem — they are a symptom of never having had a real
 *   Application Shell: no single place tracks current vs. previous page,
 *   whether a page is mounted, or whether it actually needs to be
 *   re-rendered. Every page today just re-renders unconditionally, every
 *   time navigate() runs, because nothing else is possible without this
 *   layer existing first.
 *
 *   Phase 16.1's job is ONLY to build that layer — as a manager that knows
 *   about pages/views/navigation and their lifecycle. It deliberately does
 *   NOT change what the app does, does NOT add a render queue, view cache,
 *   DOM diff, lazy mount, skeleton, hydration, or virtualization. Those are
 *   explicitly reserved for later phases (16.2+) once this foundation is in
 *   place and proven to be zero-regression.
 *
 * PUBLIC API (this is the whole surface area other code should use)
 *   ApplicationShell.init()
 *       Idempotent. Auto-discovers the existing `.page` elements and
 *       `.nav-item` elements already in the DOM (via ShellRegistry) and
 *       marks the Shell as ready (ShellBootState). Safe to call multiple
 *       times; safe to call before or after DOMContentLoaded.
 *
 *   ApplicationShell.registerPage(pageId, element, title)
 *   ApplicationShell.registerView(pageId, renderFn)
 *   ApplicationShell.registerContainer(pageId, element)
 *       Same as registerPage — a page's container IS its element in this
 *       app's current architecture (one root element per page). Provided
 *       under both names because "page" and "container" are both used to
 *       describe the same thing in the Phase 16.1 brief; both call the
 *       same underlying registry entry so there is only one source of
 *       truth.
 *   ApplicationShell.registerNavigation(pageId, element)
 *       Manually register a nav element for a page (auto-discovery via
 *       init() already covers the existing sidebar; this is here for any
 *       nav element added later that init() would not automatically see
 *       again, e.g. injected after init() already ran).
 *
 *   ApplicationShell.recordNavigation(pageId)
 *       THE ONLY METHOD navigate() IN index.html CALLS.
 *       Tells the Shell "navigation to pageId just happened" so it can
 *       update ShellState (current/previous/mounted/needsRender) and emit
 *       'shell:beforeNavigate' / 'shell:afterNavigate' on ShellEvents. It
 *       does not render, fetch, or touch the DOM. It cannot throw out to
 *       its caller (see try/catch below) so it can never break navigate().
 *
 *   ApplicationShell.getCurrentPage() / getPreviousPage()
 *   ApplicationShell.isMounted(pageId) / needsRender(pageId)
 *   ApplicationShell.markNeedsRender(pageId)
 *   ApplicationShell.getPageState(pageId) / setPageState(pageId, bag)
 *       Read/write access to ShellState, exposed here so callers never
 *       need to reach into window.ShellState directly.
 *
 * HOW navigate() USES THIS (see index.html)
 *   navigate() gained exactly one added line, guarded so that it is a
 *   complete no-op when this file hasn't loaded:
 *
 *       if (window.ApplicationShell) ApplicationShell.recordNavigation(page);
 *
 *   No other line inside navigate() was touched. If ApplicationShell is
 *   ever removed, fails to load, or throws, navigate() runs exactly as it
 *   did before Phase 16.1 — this is the "if it exists use it, otherwise
 *   fall back to the old way" rule from the phase brief.
 *
 * HOW THIS WILL BE USED IN PHASE 16.2+
 *   Phase 16.2 is expected to start actually reading needsRender()/
 *   isMounted() from inside navigate() (or its eventual replacement) to
 *   skip redundant renders, and to start wiring renderX() functions into
 *   registerView() so a Render Queue can call them itself. None of that
 *   is implemented yet. This phase only prepares the data structures.
 *
 * WHY THIS CANNOT BREAK THE EXISTING APP (zero-regression checklist)
 *   - Adds exactly one global: window.ApplicationShell. All other shell/*
 *     globals (ShellEvents, ShellBootState, ShellPageRegistry,
 *     ShellViewRegistry, ShellNavigationRegistry, ShellState,
 *     ShellLifecycleManager, ShellRegistry) are internal to this layer.
 *   - No existing file was renamed, deleted, or had its API changed.
 *     Repository, DatabaseService, StorageAdapter, RepositoryReadyCoordinator
 *     are not referenced anywhere in js/core/shell/.
 *   - No CSS file was touched. No HTML structure was added, removed, or
 *     reordered — only <script> tags were added to load these files, and
 *     one guarded line was added inside the existing navigate() function.
 *   - Every public method on this object is wrapped so a failure inside
 *     the Shell layer cannot propagate out and break the caller (navigate,
 *     or anything else).
 *   - discoverFromDom() (invoked by init()) only reads the DOM — it never
 *     mutates classes, attributes, or structure.
 * ==========================================================================*/
(function (global) {
  'use strict';

  function safely(fn, fallback) {
    try {
      return fn();
    } catch (err) {
      if (global.console && global.console.warn) {
        global.console.warn('[ApplicationShell] internal error (swallowed):', err);
      }
      return fallback;
    }
  }

  function ApplicationShell() {}

  ApplicationShell.prototype.init = function () {
    return safely(function () {
      if (global.ShellBootState) global.ShellBootState.begin();

      var titleLookup = global.PAGE_TITLES || null; // Pre-existing global; read-only use.
      if (global.ShellRegistry) global.ShellRegistry.discoverFromDom(titleLookup);

      if (global.ShellBootState) global.ShellBootState.markReady();
      if (global.ShellEvents) global.ShellEvents.emit('shell:ready', null);
    }, undefined);
  };

  ApplicationShell.prototype.registerPage = function (pageId, element, title) {
    return safely(function () {
      if (global.ShellRegistry) global.ShellRegistry.registerPage(pageId, element, title);
    }, undefined);
  };

  // "Container" and "page" refer to the same element in this app's current
  // one-element-per-page architecture; kept as a separate method name only
  // because both terms appear in the Phase 16.1 brief.
  ApplicationShell.prototype.registerContainer = function (pageId, element) {
    return this.registerPage(pageId, element, null);
  };

  ApplicationShell.prototype.registerView = function (pageId, renderFn) {
    return safely(function () {
      if (global.ShellRegistry) global.ShellRegistry.registerView(pageId, renderFn);
    }, undefined);
  };

  ApplicationShell.prototype.registerNavigation = function (pageId, element) {
    return safely(function () {
      if (global.ShellRegistry) global.ShellRegistry.registerNavigation(pageId, element);
    }, undefined);
  };

  /**
   * The single call navigate() makes into the Shell. Must never throw.
   */
  ApplicationShell.prototype.recordNavigation = function (pageId) {
    return safely(function () {
      if (global.ShellLifecycleManager) global.ShellLifecycleManager.onNavigate(pageId);
    }, undefined);
  };

  ApplicationShell.prototype.getCurrentPage = function () {
    return safely(function () {
      return global.ShellState ? global.ShellState.getCurrentPage() : null;
    }, null);
  };

  ApplicationShell.prototype.getPreviousPage = function () {
    return safely(function () {
      return global.ShellState ? global.ShellState.getPreviousPage() : null;
    }, null);
  };

  ApplicationShell.prototype.isMounted = function (pageId) {
    return safely(function () {
      return global.ShellState ? global.ShellState.isMounted(pageId) : false;
    }, false);
  };

  ApplicationShell.prototype.needsRender = function (pageId) {
    return safely(function () {
      return global.ShellState ? global.ShellState.needsRender(pageId) : true;
    }, true);
  };

  ApplicationShell.prototype.markNeedsRender = function (pageId) {
    return safely(function () {
      if (global.ShellState) global.ShellState.markNeedsRender(pageId);
    }, undefined);
  };

  ApplicationShell.prototype.getPageState = function (pageId) {
    return safely(function () {
      return global.ShellState ? global.ShellState.getPageState(pageId) : null;
    }, null);
  };

  ApplicationShell.prototype.setPageState = function (pageId, stateBag) {
    return safely(function () {
      if (global.ShellState) global.ShellState.setPageState(pageId, stateBag);
    }, undefined);
  };

  /* --------------------------------------------------------------------
   * PHASE 16.2 ADDITION — RENDER QUEUE AWARENESS
   * ----------------------------------------------------------------------
   * Per the Phase 16.2 brief ("ApplicationShell may know about the queue.
   * The queue may know about the shell. But nothing else."), these are
   * NEW, additive methods only. Nothing above this block was changed.
   *
   * getRenderQueue() simply exposes the queue so callers that already go
   * through ApplicationShell don't also need to know about
   * window.RenderQueue directly.
   *
   * enqueueRender() is a convenience that enqueues AND immediately flushes
   * just that one task — i.e. calling it behaves exactly like calling the
   * callback directly today (see RenderScheduler.js: flush is synchronous
   * in this phase). It is provided for Phase 16.3 to use; it is NOT called
   * from navigate() or anywhere else in this phase, so it has zero effect
   * on current behavior.
   * ------------------------------------------------------------------ */
  ApplicationShell.prototype.getRenderQueue = function () {
    return safely(function () {
      return global.RenderQueue || null;
    }, null);
  };

  ApplicationShell.prototype.enqueueRender = function (pageId, callback) {
    return safely(function () {
      if (!global.RenderQueue) return null;
      global.RenderQueue.enqueue(pageId, callback);
      return global.RenderQueue.flush();
    }, null);
  };

  /* --------------------------------------------------------------------
   * PHASE 16.5 ADDITION — VIEW CACHE & DIRTY TRACKING AWARENESS
   * ----------------------------------------------------------------------
   * Per the Phase 16.5 brief ("ApplicationShell only gets two new
   * methods: markDirty(page), isDirty(page)"), these are the ONLY two
   * new, additive methods added in this phase. Nothing above this block
   * was changed. Both simply delegate to the new, independent
   * js/core/view/ViewLifecycle.js layer; both are safely() wrapped and
   * default to the pre-16.5 behavior (isDirty() -> true, i.e. "always
   * render") if that layer hasn't loaded for any reason.
   *
   * This is intentionally a *separate* tracker from the existing
   * needsRender()/markNeedsRender() pair above (Phase 16.1, backed by
   * ShellState) — Phase 16.5 was scoped to build a new, independent
   * layer, not to repurpose the old one.
   * ------------------------------------------------------------------ */
  ApplicationShell.prototype.markDirty = function (pageId) {
    return safely(function () {
      if (global.ViewLifecycle) global.ViewLifecycle.markDirty(pageId);
    }, undefined);
  };

  ApplicationShell.prototype.isDirty = function (pageId) {
    return safely(function () {
      return global.ViewLifecycle ? global.ViewLifecycle.isDirty(pageId) : true;
    }, true);
  };

  global.ApplicationShell = new ApplicationShell();

  // Self-initializing, but deferred and guarded: if the DOM is already
  // loaded (script placed after the page elements, as it is here) we can
  // init() right away; otherwise wait for DOMContentLoaded. Either way this
  // is entirely additive — it does not register a handler that touches any
  // existing app state, and the existing DOMContentLoaded handler in
  // index.html is completely untouched and still runs on its own.
  if (global.document && global.document.readyState !== 'loading') {
    global.ApplicationShell.init();
  } else if (global.document) {
    global.document.addEventListener('DOMContentLoaded', function () {
      safely(function () {
        global.ApplicationShell.init();
      }, undefined);
    });
  }
})(window);
