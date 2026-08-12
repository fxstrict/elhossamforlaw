/* ============================================================================
 * PHASE 16.1 — APPLICATION SHELL FOUNDATION
 * File: js/core/shell/LifecycleManager.js
 * ----------------------------------------------------------------------------
 * WHAT THIS IS
 *   The one piece of code that, when told "navigation to page X happened",
 *   updates ShellState and emits a couple of ShellEvents notifications. It
 *   coordinates the other shell/* files; it does not do any of their jobs
 *   itself and it does NOT render anything, fetch data, or touch CSS/DOM
 *   beyond what PageRegistry/NavigationRegistry already read.
 *
 * WHY IT EXISTS (Phase 16.1)
 *   Every other shell file (ShellState, PageRegistry, NavigationRegistry,
 *   ShellEvents) is a passive store. Something has to be the "manager" that
 *   calls them in the right order when a navigation happens. That is all
 *   this file does. It is intentionally thin.
 *
 * HOW THIS WILL BE USED IN PHASE 16.2+
 *   Later phases can add real before/after hooks here (e.g. "save scroll
 *   position before leaving", "restore it after entering") without touching
 *   navigate() again, because ApplicationShell.recordNavigation() (the only
 *   Shell entry point navigate() calls) delegates to this file. Right now
 *   there are no such hooks — onNavigate() only updates bookkeeping.
 *
 * WHY THIS CANNOT BREAK THE EXISTING APP
 *   - Defines exactly one global: window.ShellLifecycleManager.
 *   - onNavigate() only writes to ShellState and emits ShellEvents — it
 *     never calls a render function, never touches localStorage/IndexedDB,
 *     and never throws (all internal calls are defensive).
 *   - It is only ever invoked by ApplicationShell.recordNavigation(), which
 *     in turn is only ever called from the one guarded line added to
 *     navigate() in index.html (see that file's comment for the exact
 *     line). If ApplicationShell is absent, this file is simply never
 *     invoked, and the app behaves exactly as it did before Phase 16.1.
 * ==========================================================================*/
(function (global) {
  'use strict';

  function LifecycleManager() {}

  /**
   * Called once per navigation, AFTER the page id is known but without any
   * assumption about whether rendering has happened yet or not — this
   * phase does not reorder anything relative to the existing navigate().
   */
  LifecycleManager.prototype.onNavigate = function (pageId) {
    if (!pageId) return;

    var state = global.ShellState;
    var events = global.ShellEvents;
    if (!state) return; // Defensive: Foundation files may not all be present yet.

    var previousPage = state.getCurrentPage();

    if (events) events.emit('shell:beforeNavigate', { from: previousPage, to: pageId });

    state.recordNavigation(pageId);

    if (events) events.emit('shell:afterNavigate', { from: previousPage, to: pageId });
  };

  global.ShellLifecycleManager = new LifecycleManager();
})(window);
