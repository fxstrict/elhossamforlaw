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
