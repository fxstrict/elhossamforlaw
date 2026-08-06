/* ============================================================================
 * PHASE 16.1 — APPLICATION SHELL FOUNDATION
 * File: js/core/shell/ShellEvents.js
 * ----------------------------------------------------------------------------
 * WHAT THIS IS
 *   A tiny, dependency-free publish/subscribe bus used ONLY by the Shell
 *   layer (ApplicationShell, LifecycleManager, etc.) to talk to each other
 *   and to let other code *observe* shell activity if it wants to.
 *
 * WHY IT EXISTS (Phase 16.1)
 *   The audit behind Phase 16.0 found no single place that knows "a page is
 *   about to change" or "a page just became visible" — every module figured
 *   this out itself by re-reading the DOM / calling its own render function.
 *   Before we can fix double-rendering, flashing, or layout shift (Phase
 *   16.2+), the Shell needs an internal notification channel that is
 *   completely decoupled from rendering. This file provides that channel
 *   and nothing else. It does not render, fetch data, or touch the DOM.
 *
 * HOW THIS WILL BE USED IN PHASE 16.2+
 *   Later phases will have LifecycleManager emit events such as
 *   'shell:beforeNavigate', 'shell:afterNavigate', 'shell:pageMounted' on
 *   this bus. A future Render Queue / View Cache can subscribe to those
 *   events instead of being called directly, which is what will eventually
 *   let us de-duplicate renders. NONE of that exists yet — this phase only
 *   builds the plumbing.
 *
 * WHY THIS CANNOT BREAK THE EXISTING APP
 *   - This file defines exactly one global: window.ShellEvents.
 *   - Nothing in the existing app (index.html, js/modules/*, js/core/*
 *     other than the new shell/* files) references window.ShellEvents.
 *   - If this script fails to load for any reason, every other shell file
 *     guards its use of ShellEvents defensively (see ApplicationShell.js),
 *     so the rest of the app is unaffected.
 *   - No listener throwing an error can break emit() for other listeners;
 *     each listener is invoked inside its own try/catch.
 * ==========================================================================*/
(function (global) {
  'use strict';

  function ShellEvents() {
    // Map<eventName, Array<listenerFn>>
    this._listeners = Object.create(null);
  }

  ShellEvents.prototype.on = function (eventName, listener) {
    if (typeof listener !== 'function') return function () {};
    if (!this._listeners[eventName]) this._listeners[eventName] = [];
    this._listeners[eventName].push(listener);
    var self = this;
    // Return an unsubscribe function for convenience.
    return function unsubscribe() {
      self.off(eventName, listener);
    };
  };

  ShellEvents.prototype.off = function (eventName, listener) {
    var list = this._listeners[eventName];
    if (!list) return;
    var idx = list.indexOf(listener);
    if (idx >= 0) list.splice(idx, 1);
  };

  ShellEvents.prototype.emit = function (eventName, payload) {
    var list = this._listeners[eventName];
    if (!list || !list.length) return;
    // Copy the array before iterating: a listener may unsubscribe itself
    // (or another listener) during emit, which would otherwise corrupt
    // the loop.
    var snapshot = list.slice();
    for (var i = 0; i < snapshot.length; i++) {
      try {
        snapshot[i](payload);
      } catch (err) {
        // A misbehaving listener must never break navigation or other
        // listeners. Log and continue — this is Foundation-phase safety,
        // not a place to introduce new failure modes into the app.
        if (global.console && global.console.warn) {
          global.console.warn('[ShellEvents] listener for "' + eventName + '" threw:', err);
        }
      }
    }
  };

  // Single shared bus for the whole Shell layer. Intentionally simple
  // (no namespacing, no wildcard events) — this is Foundation only.
  global.ShellEvents = new ShellEvents();
})(window);
