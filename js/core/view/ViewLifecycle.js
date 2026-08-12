/* ============================================================================
 * PHASE 16.5 — VIEW CACHE & DIRTY TRACKING (ZERO REGRESSION, ADDITIVE)
 * File: js/core/view/ViewLifecycle.js
 * ----------------------------------------------------------------------------
 * WHAT THIS IS
 *   The single orchestrator for the new js/core/view/ layer. It is the only
 *   file in this layer that ApplicationShell.js and navigate() need to know
 *   about — DirtyTracker/ViewVersion/ViewCache/PageState are its internal
 *   building blocks, same pattern as ApplicationShell.js sits in front of
 *   ShellState/ShellRegistry/etc. in js/core/shell/.
 *
 * WHAT IT ANSWERS
 *   isDirty(pageId)      -> true if this page's paint is (or might be) stale:
 *                             - DirtyTracker says so, OR
 *                             - the version last painted (ViewCache) does not
 *                               match the current version (ViewVersion), OR
 *                             - the layer has been disabled (see below).
 *                           A page that has never been painted has no cached
 *                           version at all, so it is always dirty the first
 *                           time it is asked about.
 *   markDirty(pageId)    -> forces the page dirty AND bumps its ViewVersion,
 *                           so isDirty() stays true even if something later
 *                           clears the flag directly on DirtyTracker.
 *   recordRendered(pageId) -> called once a page has actually been painted:
 *                           clears the dirty flag, caches the version that
 *                           was just painted, stamps PageState's timestamp.
 *
 * KILL-SWITCH (defensive, requested by the accompanying risk analysis)
 *   setEnabled(false) makes isDirty() always return true, i.e. navigate()
 *   will render every page every time — byte-for-byte the pre-16.5
 *   behavior. Default is enabled. This exists so the skip behavior can be
 *   turned off instantly from a console/config without editing navigate()
 *   or any render function, in case a cross-entity staleness issue (see
 *   Risk Analysis — Dashboard reads cases/sessions/clients/tasks data that
 *   nothing in this phase's scope can invalidate) needs to be neutralized
 *   before the follow-up phase wires real markDirty() triggers in.
 *
 * PUBLIC API
 *   ViewLifecycle.isDirty(pageId) -> boolean
 *   ViewLifecycle.markDirty(pageId)
 *   ViewLifecycle.recordRendered(pageId)
 *   ViewLifecycle.setEnabled(boolean)
 *   ViewLifecycle.isEnabled() -> boolean
 *
 * WHY THIS CANNOT BREAK THE EXISTING APP
 *   - Adds exactly one global: window.ViewLifecycle.
 *   - Every method is wrapped in safely() so a failure here can never
 *     propagate out and break navigate() or ApplicationShell.
 *   - Does not touch the DOM, Repository, StorageAdapter, RenderQueue,
 *     BootManager, or any render function.
 *   - Nothing calls any method on this object except the new, additive
 *     ApplicationShell.markDirty()/isDirty() methods and the new guarded
 *     block added to navigate() — no pre-existing code path is affected
 *     unless this file is present.
 * ==========================================================================*/
(function (global) {
  'use strict';

  function safely(fn, fallback) {
    try {
      return fn();
    } catch (err) {
      if (global.console && global.console.warn) {
        global.console.warn('[ViewLifecycle] internal error (swallowed):', err);
      }
      return fallback;
    }
  }

  function ViewLifecycle() {
    this._enabled = true;
  }

  ViewLifecycle.prototype.setEnabled = function (value) {
    this._enabled = !!value;
  };

  ViewLifecycle.prototype.isEnabled = function () {
    return this._enabled;
  };

  ViewLifecycle.prototype.markDirty = function (pageId) {
    return safely(function () {
      if (!pageId) return;
      if (global.DirtyTracker) global.DirtyTracker.markDirty(pageId);
      if (global.ViewVersion) global.ViewVersion.bump(pageId);
    }, undefined);
  };

  ViewLifecycle.prototype.isDirty = function (pageId) {
    var self = this;
    return safely(function () {
      if (!self._enabled) return true; // kill-switch: behave exactly like pre-16.5
      if (!pageId) return true;
      if (global.DirtyTracker && global.DirtyTracker.isDirty(pageId)) return true;
      var cached = global.ViewCache ? global.ViewCache.getRenderedVersion(pageId) : null;
      var current = global.ViewVersion ? global.ViewVersion.getVersion(pageId) : 0;
      return cached === null || cached !== current;
    }, true);
  };

  ViewLifecycle.prototype.recordRendered = function (pageId) {
    return safely(function () {
      if (!pageId) return;
      if (global.DirtyTracker) global.DirtyTracker.clearDirty(pageId);
      var current = global.ViewVersion ? global.ViewVersion.getVersion(pageId) : 0;
      if (global.ViewCache) global.ViewCache.setRenderedVersion(pageId, current);
      if (global.PageState) global.PageState.touch(pageId);
    }, undefined);
  };

  global.ViewLifecycle = new ViewLifecycle();
})(window);
