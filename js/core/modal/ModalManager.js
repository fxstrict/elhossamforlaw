/* ============================================================================
 * PHASE 33 — MODAL ENGINE (ROOT CAUSE FIX)
 * File: js/core/modal/ModalManager.js
 * ----------------------------------------------------------------------------
 * WHAT THIS IS
 *   The orchestrator. Ties ModalStack + ZIndexEngine + ScrollLockManager +
 *   FocusManager + ModalHistoryBridge together into the lifecycle described
 *   in the accepted Phase 2 design (see
 *   docs/phase31/Modal_Engine_Root_Cause_And_Implementation_Report.md,
 *   Section 4): Open -> Register -> Push Stack -> Freeze Background ->
 *   Disable Background Scroll -> Create Overlay -> Focus -> Interaction ->
 *   Close -> Pop Stack -> Restore Previous -> Restore Focus -> Unlock
 *   Scroll -> Cleanup.
 *
 * WHY A MutationObserver, NOT NEW CALL SITES
 *   The Root Cause Report found 28 separate `classList.add('open')` /
 *   `classList.remove('open')` call sites across index.html and js/modules/
 *   *.js. Rewriting all 28 to call a new API would be exactly the kind of
 *   change the Engineering Core Standard warns against ("modify the minimum
 *   number of files required... never rewrite entire modules if a focused
 *   modification is sufficient") and would risk missing one. Instead this
 *   file OBSERVES every `.modal-overlay` element for `class` attribute
 *   changes and reacts to `open` being added/removed — so all 28 existing
 *   call sites, and any future one, are handled automatically with ZERO
 *   changes to their code. This is also what satisfies the "framework, not
 *   a one-off fix" requirement: a brand-new modal only has to use the
 *   existing `modal-overlay` + `open` convention to be fully managed.
 *
 * PUBLIC API (window.ModalManager)
 *   init()                Idempotent. Starts the MutationObserver, installs
 *                          the global Escape-key listener, and registers
 *                          any `.modal-overlay.open` element already present
 *                          at boot (defensive; none exist in current HTML).
 *   getStack()             Array snapshot of currently-open modal ids.
 *   closeTop()               Closes only the topmost modal (used by Escape
 *                          and by the history bridge). Safe no-op if empty.
 *   isOpen(id)
 * ==========================================================================*/
(function (global) {
  'use strict';

  var STACKED_HIDDEN_CLASS = 'modal-overlay--stacked-hidden';

  function ModalManagerImpl() {
    this._initialized = false;
    this._observer = null;
    this._trackedOpen = (typeof WeakSet !== 'undefined') ? new WeakSet() : null;
    this._fallbackOpenSet = this._trackedOpen ? null : []; // ancient-browser fallback, avoids WeakSet dependency
    this._disposeTrap = null; // dispose() for the currently-installed focus trap, or null
  }

  function safely(fn) {
    try { return fn(); } catch (e) {
      if (global.console && global.console.warn) {
        global.console.warn('[ModalManager] internal error (swallowed):', e);
      }
      return undefined;
    }
  }

  ModalManagerImpl.prototype._isTracked = function (el) {
    if (this._trackedOpen) return this._trackedOpen.has(el);
    return this._fallbackOpenSet.indexOf(el) !== -1;
  };

  ModalManagerImpl.prototype._track = function (el) {
    if (this._trackedOpen) { this._trackedOpen.add(el); return; }
    if (this._fallbackOpenSet.indexOf(el) === -1) this._fallbackOpenSet.push(el);
  };

  ModalManagerImpl.prototype._untrack = function (el) {
    if (this._trackedOpen) { this._trackedOpen.delete(el); return; }
    var i = this._fallbackOpenSet.indexOf(el);
    if (i !== -1) this._fallbackOpenSet.splice(i, 1);
  };

  // ---- visual stacking: hide every overlay below the current top -------
  ModalManagerImpl.prototype._restack = function () {
    var entries = global.ModalStack.entries();
    for (var i = 0; i < entries.length; i++) {
      var el = entries[i].el;
      el.style.zIndex = String(
        entries[i].isConfirm
          ? global.ModalZIndexEngine.forConfirmDialog(i)
          : global.ModalZIndexEngine.forDepth(i)
      );
      if (i === entries.length - 1) {
        el.classList.remove(STACKED_HIDDEN_CLASS);
      } else {
        el.classList.add(STACKED_HIDDEN_CLASS);
      }
    }
  };

  // ---- scroll-container reset (PROBLEM 14 + PROBLEM 15) ------------------
  // Resets scrollTop on `modalBox` itself AND on every descendant whose
  // OWN computed overflow-y is auto/scroll — covering both the general
  // case (`.modal` is the scroll container) and floating information
  // views like #modalView/#viewModalBody where a nested element scrolls
  // independently. Resetting scrollTop on an element that was never
  // actually scrolled is a harmless no-op, so this is safe to run
  // unconditionally on every modal-overlay open, not just #modalView's.
  ModalManagerImpl.prototype._resetScrollContainers = function (modalBox) {
    try { modalBox.scrollTop = 0; } catch (__scrollResetErr) {}

    try {
      var candidates = modalBox.querySelectorAll ? modalBox.querySelectorAll('*') : null;
      if (!candidates) return;
      var getStyle = (typeof global.getComputedStyle === 'function') ? global.getComputedStyle : null;
      for (var i = 0; i < candidates.length; i++) {
        var node = candidates[i];
        var overflowY = null;
        if (getStyle) {
          try { overflowY = getStyle(node).overflowY; } catch (__styleErr) {}
        } else if (node.style) {
          // Fallback for environments with no getComputedStyle (e.g. the
          // hand-rolled fake-DOM harnesses this project's other verify_*.
          // js files use for plain global functions): fall back to the
          // element's own inline style, same convention as the rest of
          // this file's `el.querySelector(...) || el` fallbacks.
          overflowY = node.style.overflowY || node.style['overflow-y'];
        }
        if (overflowY === 'auto' || overflowY === 'scroll') {
          try { node.scrollTop = 0; } catch (__nestedScrollResetErr) {}
        }
      }
    } catch (__walkErr) {}
  };

  // ---- OPEN lifecycle ----------------------------------------------------
  ModalManagerImpl.prototype._onOpen = function (el) {
    if (this._isTracked(el)) return; // already registered — ignore duplicate mutation records
    this._track(el);

    var stack = global.ModalStack;
    var wasEmpty = stack.isEmpty();

    var entry = stack.push({
      id: el.id || null,
      el: el,
      previouslyFocused: global.ModalFocusManager.saveActiveElement(),
      isConfirm: el.id === 'modalConfirm'
    });

    if (wasEmpty) global.ModalScrollLockManager.lock();

    this._restack();

    // Dispose any previous trap (from the modal that was on top before this
    // one) and install a fresh one scoped to the new top modal only —
    // Tab must never escape into a stacked-but-hidden modal or the page.
    if (this._disposeTrap) { this._disposeTrap(); this._disposeTrap = null; }
    var modalBox = el.querySelector('.modal') || el;
    // PROBLEM 14 (Global Scroll Position Reset, v82): `.modal` itself is
    // the scroll container inside every `.modal-overlay` in the GENERAL
    // case (css/components.css sets overflow-y:auto on `.modal`, not
    // `.modal-body`), and every modal box is a persistent DOM node reused
    // across opens/closes (same 28-call-site pattern this file's header
    // comment already documents for `.open`) — so a modal scrolled down,
    // closed, and reopened would otherwise resurface mid-scroll instead
    // of at the top. This MutationObserver-driven `_onOpen()` is the
    // single point every one of those 28 call sites already funnels
    // through, so resetting here covers all of them with no new call
    // site and no risk of missing one. Only runs on OPEN, only touches
    // scroll containers found INSIDE the modal box — it does not touch
    // window/page scroll (see navigate() in index.html) or
    // `.sidebar-nav` (see toggleSidebar()), and does not fire again
    // while the modal stays open (mutation records only land here on an
    // actual class-attribute open/close transition).
    //
    // PROBLEM 15 (Floating Information Views Scroll Reset, v84): `.modal`
    // is NOT always the real scroll container. #modalView — the single
    // shared overlay behind both viewCase() (js/modules/cases.js) and
    // viewClient() (js/modules/clients.js) — lays its `.modal` out as a
    // flex column whose header is flex-shrink:0 and whose body
    // (#viewModalBody) is flex:1 with its OWN independent inline
    // overflow-y:auto. `.modal` itself never actually overflows there
    // (the body flexes to fill exactly the remaining space and scrolls
    // internally instead), so PROBLEM 14's `modalBox.scrollTop = 0` was
    // resetting a container that was never scrolled, while the ACTUAL
    // scrolled container (#viewModalBody, a persistent node whose
    // innerHTML is replaced per view but which is never recreated) kept
    // its position across close/reopen. Rather than special-case
    // `#modalView`/`#viewModalBody` by id (which would only fix this one
    // view and miss any future floating information view built the same
    // way), reset EVERY actually-scrollable descendant found inside the
    // modal box, identified generically by its own computed overflow-y
    // (auto/scroll) — not by assuming `.modal` is the only candidate.
    this._resetScrollContainers(modalBox);
    this._disposeTrap = global.ModalFocusManager.trap(modalBox);
    global.ModalFocusManager.focusFirst(modalBox);

    global.ModalHistoryBridge.onModalOpened(stack.size());
  };

  // ---- CLOSE lifecycle ----------------------------------------------------
  ModalManagerImpl.prototype._onClose = function (el, fromHistory) {
    if (!this._isTracked(el)) return; // wasn't open per our bookkeeping — ignore
    this._untrack(el);

    var stack = global.ModalStack;
    var sizeBeforeClose = stack.size();
    var wasTop = (stack.top() && stack.top().el === el);
    var removed = stack.remove(el);
    if (!removed) return;

    if (!fromHistory) {
      global.ModalHistoryBridge.onModalClosedByCode(sizeBeforeClose);
    }

    if (this._disposeTrap) { this._disposeTrap(); this._disposeTrap = null; }

    if (stack.isEmpty()) {
      global.ModalScrollLockManager.unlock();
    } else {
      this._restack();
      var newTop = stack.top();
      var modalBox = newTop.el.querySelector('.modal') || newTop.el;
      this._disposeTrap = global.ModalFocusManager.trap(modalBox);
    }

    // Only the modal that actually held focus/scroll authority (the one
    // that was on top) hands focus back to what was focused before it
    // opened. A background modal being closed programmatically must not
    // steal focus away from whatever is currently on top.
    if (wasTop) {
      global.ModalFocusManager.restore(removed.previouslyFocused);
    }
  };

  // ---- MutationObserver plumbing -----------------------------------------
  ModalManagerImpl.prototype._handleMutations = function (records) {
    for (var i = 0; i < records.length; i++) {
      var rec = records[i];
      if (rec.attributeName !== 'class') continue;
      var el = rec.target;
      if (!el || !el.classList || !el.classList.contains('modal-overlay')) continue;
      var isOpenNow = el.classList.contains('open');
      if (isOpenNow) {
        this._onOpen(el);
      } else {
        this._onClose(el, false);
      }
    }
  };

  ModalManagerImpl.prototype.closeTop = function () {
    var top = global.ModalStack.top();
    if (!top) return;
    top.el.classList.remove('open');
  };

  ModalManagerImpl.prototype.getStack = function () {
    var out = [];
    var entries = global.ModalStack.entries();
    for (var i = 0; i < entries.length; i++) out.push(entries[i].id);
    return out;
  };

  ModalManagerImpl.prototype.isOpen = function (id) {
    var entries = global.ModalStack.entries();
    for (var i = 0; i < entries.length; i++) if (entries[i].id === id) return true;
    return false;
  };

  ModalManagerImpl.prototype._onKeydown = function (e) {
    if (e.key !== 'Escape' && e.keyCode !== 27) return;
    if (global.ModalStack.isEmpty()) return;
    this.closeTop();
  };

  ModalManagerImpl.prototype.init = function () {
    if (this._initialized) return;
    this._initialized = true;

    var self = this;

    if (typeof MutationObserver !== 'undefined' && typeof document !== 'undefined') {
      this._observer = new MutationObserver(function (records) {
        safely(function () { self._handleMutations(records); });
      });
      this._observer.observe(document.body || document.documentElement, {
        subtree: true,
        attributes: true,
        attributeFilter: ['class']
      });
    }

    if (typeof document !== 'undefined' && document.addEventListener) {
      document.addEventListener('keydown', function (e) {
        safely(function () { self._onKeydown(e); });
      });
    }

    safely(function () {
      global.ModalHistoryBridge.init();
      global.ModalHistoryBridge.setPopHandler(function (newDepth) {
        var toClose = global.ModalStack.size() - newDepth;
        for (var i = 0; i < toClose; i++) {
          var top = global.ModalStack.top();
          if (!top) break;
          // Mark as history-originated so _onClose skips the redundant
          // history.back() sync — the browser already performed that move.
          self._onClose(top.el, true);
          top.el.classList.remove('open');
        }
      });
    });

    // Defensive: register anything already open at boot (none in current
    // HTML, but keeps the engine correct if that ever changes).
    if (typeof document !== 'undefined' && document.querySelectorAll) {
      var alreadyOpen = document.querySelectorAll('.modal-overlay.open');
      for (var i = 0; i < alreadyOpen.length; i++) {
        this._onOpen(alreadyOpen[i]);
      }
    }
  };

  global.ModalManager = new ModalManagerImpl();
  global.ModalManager.Impl = ModalManagerImpl; // exposed for isolated Node-side tests

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { ModalManager: global.ModalManager, ModalManagerImpl: ModalManagerImpl };
  }

  // Self-initializing, deferred and guarded — same convention as
  // ShellNavigationManager (js/core/shell/NavigationManager.js).
  if (typeof document !== 'undefined') {
    if (document.readyState !== 'loading') {
      global.ModalManager.init();
    } else {
      document.addEventListener('DOMContentLoaded', function () {
        safely(function () { global.ModalManager.init(); });
      });
    }
  }
})(typeof window !== 'undefined' ? window : global);
