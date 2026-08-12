/* ============================================================================
 * PHASE 33 — MODAL ENGINE (ROOT CAUSE FIX)
 * File: js/core/modal/FocusManager.js
 * ----------------------------------------------------------------------------
 * WHAT THIS IS
 *   Root Cause Report Section 2, item 5: no focus save/restore and no
 *   keyboard trap existed anywhere except one hand-built, one-off copy
 *   inside confirmDialog() (index.html). This file is the single shared
 *   implementation every modal now gets automatically.
 *
 * PUBLIC API (window.ModalFocusManager)
 *   saveActiveElement()        Returns document.activeElement (or null),
 *                               to be handed back to restore() on close.
 *   restore(el)                 Refocuses el if it is still attached to the
 *                               document; no-op otherwise (element may have
 *                               been removed/re-rendered while the modal
 *                               was open — never throws).
 *   focusFirst(container)        Focuses the first focusable descendant of
 *                               container; falls back to focusing the
 *                               container itself (temporarily made
 *                               focusable via tabindex="-1") if none exist,
 *                               so keyboard/AT users always land inside the
 *                               modal, never on background content.
 *   trap(container)              Installs a Tab/Shift+Tab keydown listener
 *                               that cycles focus within container only.
 *                               Returns a dispose() function that removes
 *                               the listener — callers MUST invoke it on
 *                               close (ModalManager does this), or the
 *                               listener would leak, which is exactly the
 *                               "no Cleanup Manager" failure mode the Root
 *                               Cause Report flagged in item 8.
 * ==========================================================================*/
(function (global) {
  'use strict';

  var FOCUSABLE_SELECTOR = [
    'a[href]', 'button:not([disabled])', 'textarea:not([disabled])',
    'input:not([disabled]):not([type="hidden"])', 'select:not([disabled])',
    '[tabindex]:not([tabindex="-1"])', '[contenteditable="true"]'
  ].join(',');

  function isVisible(el) {
    if (!el || !el.getClientRects) return !!el;
    // offsetParent-based check is the standard cheap "is it actually
    // rendered" test; avoids trapping focus on display:none descendants.
    return !!(el.offsetWidth || el.offsetHeight || (el.getClientRects && el.getClientRects().length));
  }

  function getFocusable(container) {
    if (!container || !container.querySelectorAll) return [];
    var nodes = container.querySelectorAll(FOCUSABLE_SELECTOR);
    var out = [];
    for (var i = 0; i < nodes.length; i++) {
      if (isVisible(nodes[i])) out.push(nodes[i]);
    }
    return out;
  }

  function saveActiveElement() {
    var doc = typeof document !== 'undefined' ? document : null;
    return (doc && doc.activeElement && doc.activeElement !== doc.body) ? doc.activeElement : null;
  }

  function restore(el) {
    if (!el || typeof el.focus !== 'function') return;
    var doc = typeof document !== 'undefined' ? document : null;
    if (doc && doc.body && !doc.body.contains(el)) return; // detached/re-rendered away — safe no-op
    try { el.focus(); } catch (e) { /* never throw out of cleanup path */ }
  }

  function focusFirst(container) {
    if (!container) return;
    var focusables = getFocusable(container);
    if (focusables.length) {
      try { focusables[0].focus(); } catch (e) { /* ignore */ }
      return;
    }
    // No focusable descendant (e.g. a pure-text confirm dialog) — make the
    // container itself the focus target so keyboard/Escape still works and
    // screen readers announce entering the dialog.
    var hadTabindex = container.hasAttribute('tabindex');
    if (!hadTabindex) container.setAttribute('tabindex', '-1');
    try { container.focus(); } catch (e) { /* ignore */ }
  }

  function trap(container) {
    if (!container) return function () {};
    function onKeydown(e) {
      if (e.key !== 'Tab' && e.keyCode !== 9) return;
      var focusables = getFocusable(container);
      if (!focusables.length) { e.preventDefault(); return; }
      var first = focusables[0];
      var last = focusables[focusables.length - 1];
      var active = (typeof document !== 'undefined') ? document.activeElement : null;
      if (e.shiftKey) {
        if (active === first || !container.contains(active)) {
          e.preventDefault();
          last.focus();
        }
      } else {
        if (active === last || !container.contains(active)) {
          e.preventDefault();
          first.focus();
        }
      }
    }
    container.addEventListener('keydown', onKeydown, true);
    return function dispose() {
      container.removeEventListener('keydown', onKeydown, true);
    };
  }

  global.ModalFocusManager = {
    saveActiveElement: saveActiveElement,
    restore: restore,
    focusFirst: focusFirst,
    trap: trap,
    _getFocusable: getFocusable // exposed for tests only
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = global.ModalFocusManager;
  }
})(typeof window !== 'undefined' ? window : global);
