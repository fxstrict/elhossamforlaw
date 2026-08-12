/* ============================================================================
 * PHASE 16.3 — NAVIGATION MANAGER + HISTORY API (ZERO REGRESSION, ADDITIVE)
 * File: js/core/shell/NavigationManager.js
 * ----------------------------------------------------------------------------
 * WHAT THIS IS
 *   A new, self-contained Shell layer file that adds browser History API
 *   support (pushState / replaceState / popstate), Deep Linking, and
 *   Back/Forward button support on top of the existing navigate() function
 *   in index.html — WITHOUT deleting, renaming, or changing the signature
 *   of navigate(), and WITHOUT changing any of its existing behavior.
 *
 *   This file does not render anything, does not touch Repository/
 *   StorageAdapter/IndexedDB, does not touch CSS, and does not reorder any
 *   existing script tag. It defines exactly one global:
 *   window.ShellNavigationManager.
 *
 * WHY HASH-BASED URLS, NOT PATH-BASED
 *   This app is an offline-first PWA that is also opened directly from
 *   `file://` and from static hosts with no server-side routing (see
 *   Law-Office-Pro's sibling static-hosted projects). A path-based
 *   history.pushState('/cases') would 404 on refresh in both of those
 *   environments, because there is no server to answer that path. Using
 *   history.pushState(state, '', '#'+pageId) satisfies the "use the
 *   History API" requirement literally, while keeping the URL a same-
 *   document fragment — refreshing the page, opening from file://, or
 *   deploying to a static host all continue to work exactly as before.
 *
 * HOW navigate() USES THIS (see index.html)
 *   navigate() gained exactly one additional guarded line, alongside the
 *   existing Phase 16.1 ApplicationShell line:
 *
 *       if (window.ShellNavigationManager) ShellNavigationManager.onNavigate(page);
 *
 *   No other line inside navigate() was touched. If this file is absent,
 *   fails to load, or throws, navigate() runs exactly as it did before
 *   Phase 16.3.
 *
 * PUBLIC API
 *   ShellNavigationManager.init()
 *       Idempotent. Reads location.hash once at startup. If it names a
 *       known page (validated against the existing PAGE_TITLES whitelist)
 *       and differs from the page already showing (dashboard, by default),
 *       restores that page via a direct call to navigate() so a bookmarked
 *       or shared deep link opens on the right page. Uses replaceState (not
 *       pushState) for this initial sync, so no artificial history entry is
 *       created before the user has navigated anywhere. If the hash is
 *       empty or unrecognized, only replaceState('#dashboard') is set as a
 *       baseline — navigate() is NOT called again in that case, since
 *       dashboard is already the active page rendered by the pre-existing
 *       inline bootstrap.
 *
 *   ShellNavigationManager.onNavigate(pageId)
 *       THE ONLY METHOD navigate() CALLS. Pushes a new history entry
 *       (history.pushState) reflecting pageId, UNLESS this navigation was
 *       itself triggered by a popstate event (Back/Forward button), in
 *       which case it is a no-op — the browser has already moved the
 *       history pointer; pushing again would create a duplicate entry and
 *       break Back/Forward. Never throws out to its caller.
 *
 * WHY THIS CANNOT BREAK THE EXISTING APP (zero-regression checklist)
 *   - Adds exactly one global: window.ShellNavigationManager.
 *   - No existing file was renamed, deleted, or had its API changed.
 *     Repository, DatabaseService, StorageAdapter, ShellState,
 *     LifecycleManager, RenderQueue are not referenced anywhere here.
 *   - No CSS touched. No HTML structure changed — only one new <script>
 *     tag was added, and one guarded line inside the existing navigate().
 *   - Every public method is wrapped so a failure here can never propagate
 *     out and break navigate() or app startup.
 *   - Page ids coming from the URL (hash) are always validated against the
 *     existing PAGE_TITLES whitelist before ever being passed to
 *     navigate(); an unrecognized or tampered hash is simply ignored.
 *   - Deep Linking in this phase restores the PAGE only, not any modal /
 *     sub-view state (e.g. navigate('clients');openAddModal() combos are
 *     out of scope) — an intentional scope limit, not a defect.
 * ==========================================================================*/
(function (global) {
  'use strict';

  function safely(fn, fallback) {
    try {
      return fn();
    } catch (err) {
      if (global.console && global.console.warn) {
        global.console.warn('[ShellNavigationManager] internal error (swallowed):', err);
      }
      return fallback;
    }
  }

  function NavigationManager() {
    this._restoring = false; // true only while replaying a popstate-driven navigation
    this._initialized = false;
  }

  function isKnownPage(pageId) {
    var titles = global.PAGE_TITLES; // Pre-existing global; read-only whitelist use.
    return !!(pageId && titles && Object.prototype.hasOwnProperty.call(titles, pageId));
  }

  function readHash() {
    var raw = global.location ? global.location.hash : '';
    if (!raw) return '';
    return raw.charAt(0) === '#' ? raw.slice(1) : raw;
  }

  function currentActivePage() {
    // Prefer the Shell's own bookkeeping if present (Phase 16.1); fall back
    // to the pre-existing loose global `currentPage` set by navigate().
    return safely(function () {
      if (global.ApplicationShell) {
        var p = global.ApplicationShell.getCurrentPage();
        if (p) return p;
      }
      return typeof global.currentPage !== 'undefined' ? global.currentPage : 'dashboard';
    }, 'dashboard');
  }

  NavigationManager.prototype.init = function () {
    return safely(function () {
      if (this._initialized) return; // idempotent, same convention as ApplicationShell.init()
      this._initialized = true;

      if (!global.history || !global.history.pushState) return; // Defensive: no History API support.

      var hashPage = readHash();
      var active = currentActivePage();

      if (isKnownPage(hashPage) && hashPage !== active) {
        this._restoring = true;
        safely(function () {
          if (typeof global.navigate === 'function') global.navigate(hashPage);
        }, undefined);
        this._restoring = false;
        safely(function () {
          global.history.replaceState({ page: hashPage }, '', '#' + hashPage);
        }, undefined);
      } else {
        // No valid deep link — just establish a clean baseline entry for
        // the page that is already showing, without re-navigating.
        safely(function () {
          global.history.replaceState({ page: active }, '', '#' + active);
        }, undefined);
      }

      if (global.window && global.window.addEventListener) {
        global.window.addEventListener('popstate', this._onPopState.bind(this));
      }
    }.bind(this), undefined);
  };

  /**
   * Called once per navigation from inside navigate(). Must never throw.
   */
  NavigationManager.prototype.onNavigate = function (pageId) {
    return safely(function () {
      if (!pageId) return;
      if (this._restoring) return; // Back/Forward already moved history; don't push again.
      if (!global.history || !global.history.pushState) return;
      global.history.pushState({ page: pageId }, '', '#' + pageId);
    }.bind(this), undefined);
  };

  NavigationManager.prototype._onPopState = function (event) {
    return safely(function () {
      var pageId = (event && event.state && event.state.page) || readHash();
      if (!isKnownPage(pageId)) return; // Ignore unrecognized/tampered state.
      if (pageId === currentActivePage()) return; // Nothing to do.

      this._restoring = true;
      safely(function () {
        if (typeof global.navigate === 'function') global.navigate(pageId);
      }, undefined);
      this._restoring = false;
    }.bind(this), undefined);
  };

  global.ShellNavigationManager = new NavigationManager();

  // Self-initializing, deferred and guarded — same convention as
  // ApplicationShell.js. Runs after navigate() and PAGE_TITLES already
  // exist (this script loads after the inline script that defines both).
  if (global.document && global.document.readyState !== 'loading') {
    global.ShellNavigationManager.init();
  } else if (global.document) {
    global.document.addEventListener('DOMContentLoaded', function () {
      safely(function () {
        global.ShellNavigationManager.init();
      }, undefined);
    });
  }
})(window);
