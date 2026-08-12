/* ============================================================================
 * PHASE 33 — MODAL ENGINE (ROOT CAUSE FIX)
 * File: js/core/modal/ModalStack.js
 * ----------------------------------------------------------------------------
 * WHAT THIS IS
 *   The Modal Registry + Stack the Root Cause Report (Section 2, item 1)
 *   found completely absent from the project. Every open `.modal-overlay`
 *   element is tracked here, in open order, with the bookkeeping needed to
 *   undo everything cleanly on close (previously-focused element, assigned
 *   z-index, whether it was opened while another modal was already open).
 *
 *   Pure in-memory data structure. No DOM mutation, no history, no focus
 *   handling — those belong to ScrollLockManager / FocusManager /
 *   ModalHistoryBridge / ModalManager respectively (Single Responsibility,
 *   per Engineering Core Standard).
 *
 * PUBLIC API (window.ModalStack — a singleton instance)
 *   push(entry)        entry = {id, el, previouslyFocused}. Appends to the
 *                       top of the stack. No-op (returns existing entry) if
 *                       this element is already tracked — guards against the
 *                       MutationObserver ever double-registering the same
 *                       open transition.
 *   remove(el)          Removes by element, from ANY position in the stack
 *                       (not just the top) — required because a background
 *                       modal can be programmatically closed (e.g. a future
 *                       caller closing modalClient while modalPortal is
 *                       stacked above it) without going through Escape/Back.
 *                       Returns the removed entry, or null.
 *   top()                Returns the topmost entry, or null if empty.
 *   size()                Current stack depth.
 *   isEmpty()
 *   contains(el)
 *   indexOf(el)          -1 if not present.
 *   entries()             Shallow-copied array snapshot, bottom to top.
 *   clear()                Empties the stack (test/reset use only).
 * ==========================================================================*/
(function (global) {
  'use strict';

  function ModalStackImpl() {
    this._stack = []; // bottom -> top
  }

  ModalStackImpl.prototype.push = function (entry) {
    if (!entry || !entry.el) return null;
    var existingIdx = this.indexOf(entry.el);
    if (existingIdx !== -1) return this._stack[existingIdx];
    this._stack.push(entry);
    return entry;
  };

  ModalStackImpl.prototype.remove = function (el) {
    var idx = this.indexOf(el);
    if (idx === -1) return null;
    return this._stack.splice(idx, 1)[0];
  };

  ModalStackImpl.prototype.top = function () {
    return this._stack.length ? this._stack[this._stack.length - 1] : null;
  };

  ModalStackImpl.prototype.size = function () {
    return this._stack.length;
  };

  ModalStackImpl.prototype.isEmpty = function () {
    return this._stack.length === 0;
  };

  ModalStackImpl.prototype.indexOf = function (el) {
    for (var i = 0; i < this._stack.length; i++) {
      if (this._stack[i].el === el) return i;
    }
    return -1;
  };

  ModalStackImpl.prototype.contains = function (el) {
    return this.indexOf(el) !== -1;
  };

  ModalStackImpl.prototype.entries = function () {
    return this._stack.slice();
  };

  ModalStackImpl.prototype.clear = function () {
    this._stack.length = 0;
  };

  var singleton = new ModalStackImpl();
  global.ModalStack = singleton;
  // Constructor exposed for isolated Node-side testing (each verify_*.js
  // test file should build its own instance rather than share the page
  // singleton — same isolation pattern as ModalStack's siblings below).
  global.ModalStack.Impl = ModalStackImpl;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { ModalStack: singleton, ModalStackImpl: ModalStackImpl };
  }
})(typeof window !== 'undefined' ? window : global);
