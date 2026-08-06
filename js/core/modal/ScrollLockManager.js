/* ============================================================================
 * PHASE 33 — MODAL ENGINE (ROOT CAUSE FIX)
 * File: js/core/modal/ScrollLockManager.js
 * ----------------------------------------------------------------------------
 * WHAT THIS IS
 *   Root Cause Report Section 2, item 4: a full-codebase search found zero
 *   references to `document.body.style.overflow` or any scroll-lock class
 *   anywhere in the project. The background page stayed scrollable under
 *   every open modal, which is the direct cause of the "page moves behind
 *   the overlay" symptom.
 *
 *   Reference-counted so nested/stacked modals lock and unlock correctly:
 *   the background is locked once when the FIRST modal opens, and unlocked
 *   only when the LAST one closes — not on every individual close.
 *
 * WHY MEASURE SCROLLBAR WIDTH
 *   Naively setting `overflow:hidden` on <body> removes the scrollbar,
 *   shifting all fixed-position content left/right by the scrollbar's width
 *   (a Cumulative-Layout-Shift regression the Engineering Core Standard
 *   explicitly forbids: "Prevent Layout Shift"). We compensate with an
 *   equal `padding-right` while locked, restoring it exactly on unlock.
 *
 * PUBLIC API (window.ModalScrollLockManager)
 *   lock()     Increments the ref-count. Applies the lock on 0 -> 1.
 *   unlock()   Decrements the ref-count (floored at 0). Removes the lock on
 *              1 -> 0.
 *   isLocked()
 *   reset()    Force ref-count to 0 and remove the lock (test/recovery use).
 * ==========================================================================*/
(function (global) {
  'use strict';

  var LOCK_STYLE_ATTR = 'data-modal-scroll-lock-prev-overflow';
  var PAD_STYLE_ATTR = 'data-modal-scroll-lock-prev-padding-right';

  function ScrollLockManagerImpl(doc) {
    this._doc = doc || (typeof document !== 'undefined' ? document : null);
    this._count = 0;
  }

  function getScrollbarWidth(doc) {
    if (!doc || !doc.defaultView) return 0;
    var win = doc.defaultView;
    var docEl = doc.documentElement;
    if (!docEl) return 0;
    var width = win.innerWidth - docEl.clientWidth;
    return width > 0 ? width : 0;
  }

  ScrollLockManagerImpl.prototype.lock = function () {
    this._count++;
    if (this._count !== 1) return; // already locked by an earlier stacked modal
    var doc = this._doc;
    if (!doc || !doc.body) return;
    var body = doc.body;
    var currentOverflow = body.style.overflow || '';
    var currentPaddingRight = body.style.paddingRight || '';
    body.setAttribute(LOCK_STYLE_ATTR, currentOverflow);
    body.setAttribute(PAD_STYLE_ATTR, currentPaddingRight);

    var scrollbarWidth = getScrollbarWidth(doc);
    body.style.overflow = 'hidden';
    if (scrollbarWidth > 0) {
      var computed = doc.defaultView && doc.defaultView.getComputedStyle
        ? parseFloat(doc.defaultView.getComputedStyle(body).paddingRight) || 0
        : 0;
      body.style.paddingRight = (computed + scrollbarWidth) + 'px';
    }
  };

  ScrollLockManagerImpl.prototype.unlock = function () {
    if (this._count === 0) return;
    this._count--;
    if (this._count !== 0) return; // other stacked modals still need the lock
    var doc = this._doc;
    if (!doc || !doc.body) return;
    var body = doc.body;
    var prevOverflow = body.getAttribute(LOCK_STYLE_ATTR);
    var prevPadding = body.getAttribute(PAD_STYLE_ATTR);
    body.style.overflow = prevOverflow || '';
    body.style.paddingRight = prevPadding || '';
    body.removeAttribute(LOCK_STYLE_ATTR);
    body.removeAttribute(PAD_STYLE_ATTR);
  };

  ScrollLockManagerImpl.prototype.isLocked = function () {
    return this._count > 0;
  };

  ScrollLockManagerImpl.prototype.reset = function () {
    this._count = 1; // force unlock() below to actually run its 1->0 branch
    this.unlock();
  };

  var singleton = (typeof document !== 'undefined')
    ? new ScrollLockManagerImpl(document)
    : null;

  global.ModalScrollLockManager = singleton;
  global.ModalScrollLockManager_Impl = ScrollLockManagerImpl; // for Node tests with a fake `doc`

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { ModalScrollLockManager: singleton, ScrollLockManagerImpl: ScrollLockManagerImpl };
  }
})(typeof window !== 'undefined' ? window : global);
