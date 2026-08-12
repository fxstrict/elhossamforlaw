/**
 * ================================================================
 * js/tests/_shared/browserStubs.js — نظام الحسام للمحاماة
 * PHASE 24 — TEST INFRASTRUCTURE REPAIR
 * ================================================================
 * WHAT THIS IS
 *   The single, canonical source for small browser-API stubs that
 *   Node-based verification harnesses need when they load a real
 *   js/modules/*.js file into a hand-built sandbox (see each
 *   harness's own `sandboxGlobals`/`setGlobals()` pattern).
 *
 *   This file does NOT replace or wrap jsdom/Playwright. It exists
 *   ONLY for the lightweight, hand-rolled sandboxes that most
 *   verify_*_repository_integration.js harnesses already build
 *   themselves (see e.g. verify_clients_repository_integration.js).
 *   Those harnesses already stub `confirm`, `toast`, `console`, etc.
 *   inline; this file adds the handful of stubs that were missing
 *   from that existing pattern (PHASE 24 audit finding — see
 *   docs/phase24/TEST_INFRASTRUCTURE_REPAIR_REPORT.md).
 *
 * WHY THESE THREE STUBS, SPECIFICALLY
 *   - confirmDialog(message, title) -> Promise<boolean>
 *       Several modules (clients.js, documents.js, fees.js,
 *       children.js, sessions.js, tasks.js, library.js, templates.js)
 *       were migrated at some point from the native `confirm()` to the
 *       project's own async modal-based `confirmDialog()`
 *       (see index.html's confirmDialog() implementation). Every one
 *       of those harnesses' sandboxes already stubs the OLD `confirm`
 *       (`confirm: function () { return true; }`) but was never
 *       updated to also stub the NEW `confirmDialog` — a genuine gap
 *       between the test environment and the production API surface
 *       it exercises, not a defect in the production code or in the
 *       test's assertions. Resolves true (== "the user clicked Yes"),
 *       matching the existing `confirm` stub's always-approve
 *       behavior exactly, so every harness using it keeps its
 *       existing delete/destructive-action assertions unchanged.
 *   - windowPrint() -> no-op
 *       js/modules/cases.js's quickPrintCase() calls `win.print()`
 *       inside a setTimeout(). Harnesses that exercise quickPrintCase()
 *       need a `print` stub on whatever `window`/`win` object they
 *       pass in — real browsers have window.print(); Node does not.
 *   - formatTime(t) -> string
 *       A real, shipped production utility (js/ui-utils.js, loaded by
 *       index.html) used by several render functions
 *       (cases.js/calendar.js/dashboard.js/sessions.js/tasks.js).
 *       Most harnesses that load one of those modules already stub it
 *       inline (grep for `formatTime` across js/tests/*.js to confirm
 *       the existing convention this stub matches exactly:
 *       `function formatTime(t){return t||'';}`,
 *       taken verbatim from verify_dashboard_widget_decomposition.js).
 *
 * HOW TO USE
 *   const { confirmDialog, windowPrint, formatTime } =
 *     require(path.join(__dirname, '_shared', 'browserStubs.js'));
 *   // then reference confirmDialog / formatTime directly as a
 *   // sandboxGlobals property, and assign windowPrint to whatever
 *   // property a harness's fake `win`/`window` object calls print()
 *   // on (see verify_cases_repository_integration.js for the exact
 *   // site).
 *
 * WHY THIS CANNOT CHANGE PRODUCTION BEHAVIOR
 *   - Lives under js/tests/, never required by any file under
 *     js/core/, js/modules/, js/repositories/, or index.html.
 *   - Three trivial, side-effect-free functions; no DOM, no storage,
 *     no network.
 * ================================================================
 */
'use strict';

function confirmDialog() {
  // Matches the always-approve behavior every affected harness's
  // existing `confirm: function () { return true; }` stub already
  // uses, just async (Promise<boolean>) to match the real
  // confirmDialog(message, title) contract these modules `await`.
  return Promise.resolve(true);
}

function windowPrint() {
  // No-op: real browsers open the print dialog; nothing to do here.
}

function formatTime(t) {
  // Verbatim match of the stub already used in
  // verify_dashboard_widget_decomposition.js.
  return t || '';
}

module.exports = {
  confirmDialog: confirmDialog,
  windowPrint: windowPrint,
  formatTime: formatTime
};
