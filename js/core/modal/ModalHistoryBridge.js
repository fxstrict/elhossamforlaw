/* ============================================================================
 * PHASE 33 — MODAL ENGINE (ROOT CAUSE FIX)
 * File: js/core/modal/ModalHistoryBridge.js
 * ----------------------------------------------------------------------------
 * WHAT THIS IS
 *   Root Cause Report Section 2, item 6, quoting NavigationManager.js
 *   itself: "Deep Linking in this phase restores the PAGE only, not any
 *   modal / sub-view state ... an intentional scope limit, not a defect."
 *   ShellNavigationManager (js/core/shell/NavigationManager.js) owns
 *   PAGE history only and is NOT modified by this file — no existing
 *   method, event listener, or state shape there changes. This file adds
 *   an independent `popstate` listener that only acts when a modal-history
 *   marker is involved; on any other back/forward it does nothing, and
 *   ShellNavigationManager's own listener continues handling page changes
 *   exactly as before (zero regression).
 *
 * HOW IT WORKS (depth-marker pattern)
 *   Every time a modal opens, this bridge pushes one history entry carrying
 *   `{__modalDepth: <stack size after opening>}` (the URL/hash is left
 *   untouched — only a fragment-less pushState — so this never interferes
 *   with ShellNavigationManager's own hash-based page entries).
 *
 *   - Back button pressed while a modal is open -> browser fires `popstate`
 *     with the PREVIOUS entry's state, whose `__modalDepth` is lower than
 *     the current stack size. The bridge closes exactly that many topmost
 *     modals (normally 1) by removing their `open` class — routing back
 *     through the exact same ModalManager pipeline as every other close,
 *     so scroll unlock / focus restore / cleanup all still run identically.
 *     It does NOT call history.back() again (the browser already consumed
 *     that entry) and it does NOT let the "close a modal" action re-trigger
 *     ShellNavigationManager's page navigation (that listener independently
 *     no-ops because the page itself never changed).
 *
 *   - Modal closed WITHOUT the Back button (X button, Escape, backdrop
 *     click, Save-and-close, etc.) -> if the current top-of-history entry
 *     is this modal's own marker, the bridge calls `history.back()` once to
 *     silently consume it, so a LATER physical Back press does not need an
 *     extra press to leave the page (which would otherwise dead-land the
 *     user on a phantom history entry). A re-entrancy flag prevents that
 *     synthetic back() from being treated as a second user-initiated close.
 *
 * PUBLIC API (window.ModalHistoryBridge)
 *   init()                      Idempotent. Installs the popstate listener.
 *   onModalOpened(stackSizeAfterOpen)
 *   onModalClosedByCode(stackSizeBeforeClose)
 *                                Called by ModalManager right before it
 *                                removes a modal from the DOM/stack via any
 *                                non-history-triggered path.
 *   setPopHandler(fn)            fn(countToClose) — ModalManager registers
 *                                the callback that actually closes N
 *                                topmost modals when a real Back is
 *                                detected. Kept decoupled so this file has
 *                                no direct dependency on ModalStack/DOM.
 * ==========================================================================*/
(function (global) {
  'use strict';

  function safely(fn) {
    try { return fn(); } catch (e) {
      if (global.console && global.console.warn) {
        global.console.warn('[ModalHistoryBridge] internal error (swallowed):', e);
      }
      return undefined;
    }
  }

  function Bridge() {
    this._initialized = false;
    this._syntheticBack = false; // true only while our own history.back() call is in flight
    this._popHandler = null;
  }

  Bridge.prototype.setPopHandler = function (fn) {
    this._popHandler = (typeof fn === 'function') ? fn : null;
  };

  Bridge.prototype.init = function () {
    if (this._initialized) return;
    this._initialized = true;
    if (!global.addEventListener || !global.history || !global.history.pushState) return;
    global.addEventListener('popstate', this._onPopState.bind(this));
  };

  Bridge.prototype.onModalOpened = function (stackSizeAfterOpen) {
    return safely(function () {
      if (!global.history || !global.history.pushState) return;
      var hash = global.location ? global.location.hash : '';
      global.history.pushState({ __modalDepth: stackSizeAfterOpen }, '', hash);
    }.bind(this));
  };

  Bridge.prototype.onModalClosedByCode = function (stackSizeBeforeClose) {
    return safely(function () {
      if (!global.history || !global.history.back) return;
      var st = global.history.state;
      if (st && typeof st.__modalDepth === 'number' && st.__modalDepth === stackSizeBeforeClose) {
        this._syntheticBack = true;
        global.history.back();
      }
    }.bind(this));
  };

  Bridge.prototype._currentDepth = function () {
    var st = global.history ? global.history.state : null;
    return (st && typeof st.__modalDepth === 'number') ? st.__modalDepth : 0;
  };

  Bridge.prototype._onPopState = function () {
    return safely(function () {
      if (this._syntheticBack) {
        // This popstate was caused by our own onModalClosedByCode() call —
        // the modal it belongs to is already closed. Consume the flag and
        // do nothing else, so we never close a second, unrelated modal.
        this._syntheticBack = false;
        return;
      }
      if (!this._popHandler) return;
      var newDepth = this._currentDepth();
      // The caller (ModalManager) tracks the real current stack size; we
      // only tell it how many entries the user's Back press skipped past.
      this._popHandler(newDepth);
    }.bind(this));
  };

  global.ModalHistoryBridge = new Bridge();

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { ModalHistoryBridge: global.ModalHistoryBridge, Bridge: Bridge };
  }
})(typeof window !== 'undefined' ? window : global);
