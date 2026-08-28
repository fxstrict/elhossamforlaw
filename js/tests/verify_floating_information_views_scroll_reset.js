/**
 * verify_floating_information_views_scroll_reset.js
 * ================================================================
 * PROBLEM 15 — Floating Information Views Scroll Reset (v84)
 * ================================================================
 * Run: node js/tests/verify_floating_information_views_scroll_reset.js
 * (requires devDependency `jsdom`, already declared in package.json;
 * `npm install` first if node_modules is not present).
 *
 * Same jsdom-based technique as js/tests/verify_modal_engine.js (real
 * MutationObserver, real classList, real getComputedStyle — a hand-rolled
 * fake DOM cannot reasonably reproduce those), loading the 6 real engine
 * files from js/core/modal/*.js UNMODIFIED via window.eval(). This
 * harness never re-implements ModalManager's logic, only its DOM
 * environment.
 *
 * WHY THIS IS A SEPARATE PROBLEM FROM PROBLEM 14
 * PROBLEM 14 (verify_global_scroll_position_reset.js) proved and fixed
 * three DIFFERENT scroll containers: window/document (navigate()),
 * #sidebar .sidebar-nav (toggleSidebar()), and `.modal` (ModalManager.
 * _onOpen(), because css/components.css's `.modal{overflow-y:auto}` is
 * the scroll container in the general case).
 *
 * This harness proves, against the REAL current index.html markup for
 * #modalView (the single shared overlay behind BOTH viewCase() and
 * viewClient() — js/modules/cases.js's viewCase()/buildCaseReport() and
 * js/modules/clients.js's viewClient() both just do
 * `document.getElementById('viewModalBody').innerHTML = ...` then
 * `document.getElementById('modalView').classList.add('open')`, no
 * ModalManager.open() call, no per-view code at all) that #modalView is
 * the ONE exception to that general rule:
 *
 *   <div class="modal-overlay" id="modalView">
 *     <div class="modal" style="...;display:flex;flex-direction:column;">
 *       <div class="modal-header" style="...flex-shrink:0;...">...</div>
 *       <div class="modal-body" id="viewModalBody"
 *            style="padding:0;flex:1;overflow-y:auto;"></div>
 *     </div>
 *   </div>
 *
 * `.modal` here is a flex column whose header is flex-shrink:0 and whose
 * body is flex:1 with its OWN inline overflow-y:auto — so `.modal`'s own
 * content never exceeds its max-height (the body flexes to fill exactly
 * the remaining space and scrolls internally instead), meaning `.modal`
 * itself never actually needs to scroll and `#viewModalBody` is the real,
 * persistent (never recreated — only its innerHTML is replaced) scroll
 * container a user's scroll position survives in. Confirmed against the
 * real project files (not assumed):
 *   - index.html: #modalView's `.modal` has no overflow set inline, so
 *     css/components.css's `.modal{overflow-y:auto}` still nominally
 *     applies to it, but #viewModalBody carries its own independent
 *     inline `overflow-y:auto`.
 *   - js/core/modal/ModalManager.js's `_onOpen()` only ever resets
 *     `el.querySelector('.modal').scrollTop` (the PROBLEM 14 fix) — it
 *     has no knowledge of `#viewModalBody` or any nested scroll
 *     container, so a user scrolled down inside a case/client report,
 *     closing it, and reopening it (or a different one) resurfaces
 *     mid-scroll. `.modal`'s OWN scrollTop was already 0 the whole time
 *     (it never scrolled), so PROBLEM 14's existing check couldn't have
 *     caught this — a genuinely different container, proven here from
 *     the real DOM structure and the real engine file, not assumed.
 *
 * Coverage:
 *   A. Case Information View (viewCase()'s target, #modalView /
 *      #viewModalBody): open, scroll down, close, reopen -> scrollTop
 *      must be 0. FAILS on the current (pre-fix) ModalManager.js.
 *   B. Client Information View (viewClient()'s target — the SAME shared
 *      #modalView/#viewModalBody per the real source): identical
 *      close/reopen scenario -> scrollTop must be 0.
 *   C. Opening a DIFFERENT record while the node/scroll position is
 *      still dirty from a previous record (the shared node is reused,
 *      never recreated) -> scrollTop must be 0 on the new record too,
 *      not just the first open.
 *   D. `.modal` itself (the container PROBLEM 14 already resets) is
 *      still reset — no regression to the existing behavior.
 *   E. A normal modal WITHOUT a nested independently-scrollable body
 *      (e.g. modalCase-style edit forms, where `.modal` itself is the
 *      only scroll container) still resets correctly — the fix must be
 *      general, not a #modalView special case.
 *   F. Scroll reset only fires on OPEN, never on CLOSE (matches the
 *      established convention from toggleSidebar()/PROBLEM 14).
 *   G. Focus trap / history-bridge notification still fire exactly once
 *      per open — the new reset logic must not disturb existing modal
 *      lifecycle behavior proven in verify_modal_engine.js.
 * ================================================================
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

let passed = 0;
let failed = 0;
const log = [];

async function checkAsync(label, fn) {
  try {
    await fn();
    passed++;
    log.push('PASS — ' + label);
  } catch (e) {
    failed++;
    log.push('FAIL — ' + label + '  =>  ' + e.message);
  }
}

function tick(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms || 20));
}

const ENGINE_FILES = [
  'ZIndexEngine.js',
  'ModalStack.js',
  'ScrollLockManager.js',
  'FocusManager.js',
  'ModalHistoryBridge.js',
  'ModalManager.js'
];
const MODAL_DIR = path.join(__dirname, '..', 'core', 'modal');

// Real #modalView markup, copied verbatim (structure + inline styles)
// from index.html — the exact shared overlay viewCase()/buildCaseReport()
// (js/modules/cases.js) and viewClient() (js/modules/clients.js) both
// write into via `viewModalBody.innerHTML = ...` + `modalView.classList.
// add('open')`. Trimmed of only the visual button markup that has no
// bearing on scroll behavior.
const MODAL_VIEW_HTML =
  '<div class="modal-overlay" id="modalView" style="z-index:300;">' +
  '  <div class="modal" style="max-width:860px;max-height:96vh;display:flex;flex-direction:column;">' +
  '    <div class="modal-header" style="background:#1E3452;flex-shrink:0;flex-wrap:wrap;gap:6px;">' +
  '      <div class="modal-title" id="viewModalTitle"></div>' +
  '    </div>' +
  '    <div class="modal-body" id="viewModalBody" style="padding:0;flex:1;overflow-y:auto;"></div>' +
  '  </div>' +
  '</div>';

// A plain modal (modalCase/modalClient-style edit form): `.modal` itself
// is the only scroll container, no nested independently-scrollable body
// — this is the shape PROBLEM 14's fix already targets and must keep
// working unmodified.
function buildPlainModalHTML(id) {
  return (
    '<div class="modal-overlay" id="' + id + '">' +
    '  <div class="modal">' +
    '    <div class="modal-header"><button class="modal-close" id="' + id + 'CloseBtn">x</button></div>' +
    '    <div class="modal-body"><input type="text" id="' + id + 'Input"></div>' +
    '  </div>' +
    '</div>'
  );
}

async function freshWindow() {
  const dom = new JSDOM(
    '<!doctype html><html><body>' +
      '<button id="pageTrigger">open</button>' +
      MODAL_VIEW_HTML +
      buildPlainModalHTML('modalCase') +
      '</body></html>',
    { url: 'https://example.test/app', runScripts: 'outside-only', pretendToBeVisual: true }
  );
  const { window } = dom;

  // Same stub as verify_modal_engine.js: jsdom has no real layout engine,
  // so getComputedStyle().paddingRight needs stubbing for
  // ScrollLockManager's padding-compensation branch. Does not touch
  // overflowY, which jsdom DOES compute correctly from inline styles —
  // exactly the property this fix (and this test) relies on.
  const realGetComputedStyle = window.getComputedStyle.bind(window);
  window.getComputedStyle = function (el) {
    const cs = realGetComputedStyle(el);
    try { Object.defineProperty(cs, 'paddingRight', { value: '0px', configurable: true }); } catch (e) {}
    return cs;
  };

  for (const file of ENGINE_FILES) {
    const src = fs.readFileSync(path.join(MODAL_DIR, file), 'utf8');
    window.eval(src);
  }
  window.ModalManager.init();
  await tick();
  return { dom, window };
}

function el(window, id) {
  return window.document.getElementById(id);
}

(async () => {
  // ================================================================
  // A. Case Information View — open, scroll, close, reopen -> top
  // ================================================================
  await checkAsync('A. Case Information View (#viewModalBody): scrolled down, closed, reopened -> scrollTop === 0', async () => {
    const { window } = await freshWindow();

    // Simulate viewCase()/buildCaseReport(): fill the shared body then open.
    el(window, 'viewModalBody').innerHTML = '<div style="height:4000px;">تقرير القضية رقم 123</div>';
    el(window, 'modalView').classList.add('open');
    await tick();

    // User scrolls down while reading the case report.
    el(window, 'viewModalBody').scrollTop = 900;
    assert.strictEqual(el(window, 'viewModalBody').scrollTop, 900, 'precondition: scroll actually moved');

    // Leaves the view.
    el(window, 'modalView').classList.remove('open');
    await tick();

    // Reopens the SAME Case Information View (the real code reuses the
    // same #modalView/#viewModalBody node — it is never recreated).
    el(window, 'modalView').classList.add('open');
    await tick();

    assert.strictEqual(el(window, 'viewModalBody').scrollTop, 0,
      'Case Information View must reopen at the top, not at the previous scroll position');
  });

  // ================================================================
  // B. Client Information View — same shared overlay, same scenario
  // ================================================================
  await checkAsync('B. Client Information View (#viewModalBody, shared with viewCase): scrolled down, closed, reopened -> scrollTop === 0', async () => {
    const { window } = await freshWindow();

    // Simulate viewClient(): same target elements as viewCase(), per the
    // real source (js/modules/clients.js's viewClient() writes into the
    // identical #viewModalBody / #modalView pair).
    el(window, 'viewModalBody').innerHTML = '<div style="height:3000px;">ملف الموكل — أحمد محمد</div>';
    el(window, 'modalView').classList.add('open');
    await tick();

    el(window, 'viewModalBody').scrollTop = 650;
    assert.strictEqual(el(window, 'viewModalBody').scrollTop, 650, 'precondition: scroll actually moved');

    el(window, 'modalView').classList.remove('open');
    await tick();

    el(window, 'modalView').classList.add('open');
    await tick();

    assert.strictEqual(el(window, 'viewModalBody').scrollTop, 0,
      'Client Information View must reopen at the top, not at the previous scroll position');
  });

  // ================================================================
  // C. Opening a DIFFERENT record must also reset — not just the first
  //    open. The shared node carries a dirty scroll position forward
  //    from whichever record was viewed last.
  // ================================================================
  await checkAsync('C. Opening a different record (still using the same reused node) also resets to the top', async () => {
    const { window } = await freshWindow();

    // Record #1.
    el(window, 'viewModalBody').innerHTML = '<div style="height:2000px;">تقرير القضية رقم 1</div>';
    el(window, 'modalView').classList.add('open');
    await tick();
    el(window, 'viewModalBody').scrollTop = 500;
    el(window, 'modalView').classList.remove('open');
    await tick();

    // Record #2 — a genuinely different case, opened right after.
    el(window, 'viewModalBody').innerHTML = '<div style="height:2000px;">تقرير القضية رقم 2</div>';
    el(window, 'modalView').classList.add('open');
    await tick();

    assert.strictEqual(el(window, 'viewModalBody').scrollTop, 0,
      'a different record opened into the same reused node must not inherit the previous record\'s scroll position');

    // And scrolling record #2, closing, then reopening record #2 again
    // must ALSO reset (proves this isn't a first-open-only fluke).
    el(window, 'viewModalBody').scrollTop = 300;
    el(window, 'modalView').classList.remove('open');
    await tick();
    el(window, 'modalView').classList.add('open');
    await tick();
    assert.strictEqual(el(window, 'viewModalBody').scrollTop, 0);
  });

  // ================================================================
  // D. `.modal` itself — the container PROBLEM 14 already resets —
  //    must still be reset (no regression).
  // ================================================================
  await checkAsync('D. `.modal` (the #modalView container) scrollTop is still reset on open — no PROBLEM 14 regression', async () => {
    const { window } = await freshWindow();
    const modalBox = window.document.querySelector('#modalView .modal');

    el(window, 'modalView').classList.add('open');
    await tick();
    modalBox.scrollTop = 400;
    el(window, 'modalView').classList.remove('open');
    await tick();
    el(window, 'modalView').classList.add('open');
    await tick();

    assert.strictEqual(modalBox.scrollTop, 0);
  });

  // ================================================================
  // E. A normal modal with NO nested independently-scrollable body
  //    (`.modal` is the only scroll container) still resets correctly
  //    — the fix generalizes, it is not a #modalView special case.
  // ================================================================
  await checkAsync('E. Plain modal (modalCase-style, `.modal` is the only scroll container) still resets on reopen', async () => {
    const { window } = await freshWindow();
    const modalBox = window.document.querySelector('#modalCase .modal');

    el(window, 'modalCase').classList.add('open');
    await tick();
    modalBox.scrollTop = 700;
    el(window, 'modalCase').classList.remove('open');
    await tick();
    el(window, 'modalCase').classList.add('open');
    await tick();

    assert.strictEqual(modalBox.scrollTop, 0);
  });

  // ================================================================
  // F. Reset only fires on OPEN, never on CLOSE.
  // ================================================================
  await checkAsync('F. Closing #modalView does NOT reset #viewModalBody scrollTop (only opening should)', async () => {
    const { window } = await freshWindow();

    el(window, 'modalView').classList.add('open');
    await tick();
    el(window, 'viewModalBody').scrollTop = 555;
    el(window, 'modalView').classList.remove('open');
    await tick();

    assert.strictEqual(el(window, 'viewModalBody').scrollTop, 555,
      'closing must leave scrollTop untouched — only the next open() resets it');
  });

  // ================================================================
  // G. Existing modal lifecycle (focus trap, history bridge) unaffected.
  // ================================================================
  await checkAsync('G. Opening #modalView still traps focus inside it and pushes exactly one history entry', async () => {
    const { window } = await freshWindow();
    const before = window.history.length;

    el(window, 'viewModalBody').innerHTML = '<button id="viewModalFirstBtn">x</button>';
    window.document.getElementById('pageTrigger').focus();
    el(window, 'modalView').classList.add('open');
    await tick();

    assert.ok(el(window, 'modalView').contains(window.document.activeElement),
      'focus should move inside #modalView on open');
    assert.strictEqual(window.history.length, before + 1);
    assert.strictEqual(window.history.state.__modalDepth, 1);
  });

  console.log(log.join('\n'));
  console.log('\n' + passed + '/' + (passed + failed) + ' checks passed.');
  if (failed > 0) {
    console.log('\n' + failed + ' CHECK(S) FAILED.');
    process.exit(1);
  } else {
    console.log('\nALL CHECKS PASSED.');
    process.exit(0);
  }
})();
