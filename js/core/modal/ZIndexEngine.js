/* ============================================================================
 * PHASE 33 — MODAL ENGINE (ROOT CAUSE FIX)
 * File: js/core/modal/ZIndexEngine.js
 * ----------------------------------------------------------------------------
 * WHAT THIS IS
 *   Pure, dependency-free stacking-order calculator. Every existing modal in
 *   index.html used a single hard-coded `z-index:200` (some overrode it
 *   ad-hoc per-element: 300/400/500/800/950). With no engine, two modals
 *   open together had no deterministic order — the visible one depended on
 *   DOM source order, not open order. This file replaces that with a single
 *   deterministic formula.
 *
 *   This file does not touch the DOM. It only computes numbers. ModalStack.js
 *   owns "what is open, in what order"; ModalManager.js owns "when to call
 *   this". This file owns "what number to assign".
 *
 * PUBLIC API (window.ModalZIndexEngine)
 *   BASE                     Base z-index for the first (bottom) modal.
 *   STEP                     Distance between consecutive stack levels.
 *   forDepth(depth)           depth = 0-based stack position -> z-index.
 *   forConfirmDialog(depth)   Confirmation dialogs always render above every
 *                             regular modal at the same depth (native
 *                             confirm() replacement — see modalConfirm in
 *                             index.html); adds a fixed offset.
 *
 * WHY BASE=1000
 *   Highest pre-existing hard-coded value in the app was modalConfirm at
 *   950 (css inline style, index.html:1293). Starting the engine at 1000
 *   guarantees every engine-managed modal renders above any legacy static
 *   value still present in HTML/CSS during the transition, with no need to
 *   touch those inline styles (zero-regression: nothing else changes).
 * ==========================================================================*/
(function (global) {
  'use strict';

  var BASE = 1000;
  var STEP = 10;
  var CONFIRM_OFFSET = 5; // sits between a level and the next (never collides with STEP=10 multiples)

  function forDepth(depth) {
    var d = (typeof depth === 'number' && depth >= 0) ? Math.floor(depth) : 0;
    return BASE + (d * STEP);
  }

  function forConfirmDialog(depth) {
    return forDepth(depth) + CONFIRM_OFFSET;
  }

  global.ModalZIndexEngine = {
    BASE: BASE,
    STEP: STEP,
    forDepth: forDepth,
    forConfirmDialog: forConfirmDialog
  };

  // Node.js test harness support (js/tests/verify_*.js run under `node`,
  // matching every other js/core/* file's dual browser/CommonJS export
  // convention already used in this project, e.g. StorageAdapter.js).
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = global.ModalZIndexEngine;
  }
})(typeof window !== 'undefined' ? window : global);
