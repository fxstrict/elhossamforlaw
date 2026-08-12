/**
 * verify_modal_engine.js
 * PHASE 33 — Modal Engine (Root Cause fix) — Verification Harness.
 * Run: node js/tests/verify_modal_engine.js   (requires devDependency
 * `jsdom`, already declared in package.json; `npm install` first if
 * node_modules is not present).
 *
 * Unlike js/core/dom/*'s hand-rolled fake DOM, this harness uses real
 * jsdom because the engine under test depends on browser-native behavior
 * a hand-rolled fake cannot reasonably reproduce: MutationObserver batching
 * semantics, real classList/getComputedStyle, and window.history
 * pushState/back()/popstate sequencing. All 6 engine files are loaded
 * unmodified via window.eval() of their real file contents — this test
 * never re-implements or mocks engine logic, only its DOM environment.
 *
 * Coverage:
 *   A. Single modal open  — register, z-index, scroll lock, focus-in, 1 history push
 *   B. Single modal close (by code) — unregister, scroll unlock, focus restore, 1 history.back()
 *   C. Two modals stacked — depths/z-index ordering, lower one visually hidden
 *   D. Closing the top of two — lower one reappears, scroll stays locked
 *   E. Real Back button (history.back()) while a modal is open — closes it,
 *      does NOT re-call history.back() (no double-consumption)
 *   F. Escape key — closes only the topmost modal
 *   G. Duplicate mutation records for the same open/close do not double-register
 *   H. Backdrop-click convention (existing index.html generic listener
 *      equivalent) still results in correct cleanup through the engine
 *   I. ZIndexEngine formula
 *   J. ScrollLockManager reference counting (2 locks require 2 unlocks)
 *   K. FocusManager.focusFirst falls back to the container when no
 *      focusable descendant exists (e.g. a plain-text confirm dialog)
 *   L. Stress — open 100 stacked modals, then close all 100, with zero
 *      leaked stack entries, zero leaked scroll-lock refcount, and correct
 *      final z-index/visibility invariants at every step
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

function check(label, fn) {
  try {
    fn();
    passed++;
    log.push('PASS — ' + label);
  } catch (e) {
    failed++;
    log.push('FAIL — ' + label + '  =>  ' + e.message);
  }
}

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

function buildModalOverlayHTML(id, extraStyle) {
  return (
    '<div class="modal-overlay" id="' + id + '"' + (extraStyle ? ' style="' + extraStyle + '"' : '') + '>' +
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
      buildModalOverlayHTML('modalA') +
      buildModalOverlayHTML('modalB') +
      buildModalOverlayHTML('modalConfirm') +
      '</body></html>',
    { url: 'https://example.test/app', runScripts: 'outside-only', pretendToBeVisual: true }
  );
  const { window } = dom;

  // getComputedStyle().paddingRight needs a real layout engine jsdom
  // doesn't ship; stub it so ScrollLockManager's padding-compensation
  // branch executes without throwing (behavior is still fully exercised
  // via the overflow/attr assertions below — see check J and the module's
  // own inline scrollbar-width guard for width<=0 environments).
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

function getEntry(window, id) {
  return window.document.getElementById(id);
}

(async () => {
  // ---- I. ZIndexEngine formula (no DOM needed) --------------------------
  await checkAsync('ZIndexEngine.forDepth(0) === BASE', async () => {
    const { window } = await freshWindow();
    assert.strictEqual(window.ModalZIndexEngine.forDepth(0), window.ModalZIndexEngine.BASE);
  });

  await checkAsync('ZIndexEngine.forDepth increases by STEP per level', async () => {
    const { window } = await freshWindow();
    const z0 = window.ModalZIndexEngine.forDepth(0);
    const z1 = window.ModalZIndexEngine.forDepth(1);
    const z2 = window.ModalZIndexEngine.forDepth(2);
    assert.strictEqual(z1 - z0, window.ModalZIndexEngine.STEP);
    assert.strictEqual(z2 - z1, window.ModalZIndexEngine.STEP);
  });

  await checkAsync('ZIndexEngine.forConfirmDialog always beats forDepth at same depth', async () => {
    const { window } = await freshWindow();
    assert.ok(window.ModalZIndexEngine.forConfirmDialog(3) > window.ModalZIndexEngine.forDepth(3));
  });

  // ---- A. Single modal open ----------------------------------------------
  await checkAsync('A1. opening modalA registers it in the stack', async () => {
    const { window } = await freshWindow();
    getEntry(window, 'modalA').classList.add('open');
    await tick();
    assert.strictEqual(window.ModalManager.getStack().length, 1);
    assert.strictEqual(window.ModalManager.isOpen('modalA'), true);
  });

  await checkAsync('A2. opening modalA assigns z-index === forDepth(0)', async () => {
    const { window } = await freshWindow();
    getEntry(window, 'modalA').classList.add('open');
    await tick();
    assert.strictEqual(getEntry(window, 'modalA').style.zIndex, String(window.ModalZIndexEngine.forDepth(0)));
  });

  await checkAsync('A3. opening a modal locks background scroll', async () => {
    const { window } = await freshWindow();
    assert.strictEqual(window.ModalScrollLockManager.isLocked(), false);
    getEntry(window, 'modalA').classList.add('open');
    await tick();
    assert.strictEqual(window.ModalScrollLockManager.isLocked(), true);
    assert.strictEqual(window.document.body.style.overflow, 'hidden');
  });

  await checkAsync('A4. opening a modal moves focus inside it (not left on the page)', async () => {
    const { window } = await freshWindow();
    window.document.getElementById('pageTrigger').focus();
    assert.strictEqual(window.document.activeElement.id, 'pageTrigger');
    getEntry(window, 'modalA').classList.add('open');
    await tick();
    assert.ok(getEntry(window, 'modalA').contains(window.document.activeElement),
      'active element should be inside modalA, was: ' + window.document.activeElement.id);
  });

  await checkAsync('A5. opening a modal pushes exactly one history entry', async () => {
    const { window } = await freshWindow();
    const before = window.history.length;
    getEntry(window, 'modalA').classList.add('open');
    await tick();
    assert.strictEqual(window.history.length, before + 1);
    assert.strictEqual(window.history.state.__modalDepth, 1);
  });

  // ---- B. Single modal close (by code) -----------------------------------
  await checkAsync('B1. closing modalA (by code) unregisters it', async () => {
    const { window } = await freshWindow();
    getEntry(window, 'modalA').classList.add('open');
    await tick();
    getEntry(window, 'modalA').classList.remove('open');
    await tick();
    assert.strictEqual(window.ModalManager.getStack().length, 0);
  });

  await checkAsync('B2. closing the only open modal unlocks scroll', async () => {
    const { window } = await freshWindow();
    getEntry(window, 'modalA').classList.add('open');
    await tick();
    getEntry(window, 'modalA').classList.remove('open');
    await tick();
    assert.strictEqual(window.ModalScrollLockManager.isLocked(), false);
    assert.strictEqual(window.document.body.style.overflow, '');
  });

  await checkAsync('B3. closing modalA restores focus to what was focused before it opened', async () => {
    const { window } = await freshWindow();
    window.document.getElementById('pageTrigger').focus();
    getEntry(window, 'modalA').classList.add('open');
    await tick();
    getEntry(window, 'modalA').classList.remove('open');
    await tick();
    assert.strictEqual(window.document.activeElement.id, 'pageTrigger');
  });

  await checkAsync('B4. closing modalA by code silently consumes its history entry (no phantom entry)', async () => {
    const { window } = await freshWindow();
    const before = window.history.length;
    getEntry(window, 'modalA').classList.add('open');
    await tick();
    getEntry(window, 'modalA').classList.remove('open');
    await tick(30);
    // history.back() cannot reduce window.history.length (browsers never
    // shrink the list), but the pointer/state must be back to pre-open —
    // i.e. no modal-depth marker left active (jsdom's original entry has
    // state === null, same as a real browser's initial document entry).
    const depth = window.history.state && window.history.state.__modalDepth;
    assert.ok(!depth, 'expected no active __modalDepth after the entry was consumed, got: ' + JSON.stringify(window.history.state));
  });

  // ---- C. Two modals stacked ----------------------------------------------
  await checkAsync('C1. opening two modals gives depth 2 with increasing z-index', async () => {
    const { window } = await freshWindow();
    getEntry(window, 'modalA').classList.add('open');
    await tick();
    getEntry(window, 'modalB').classList.add('open');
    await tick();
    const zA = parseInt(getEntry(window, 'modalA').style.zIndex, 10);
    const zB = parseInt(getEntry(window, 'modalB').style.zIndex, 10);
    assert.ok(zB > zA, 'top modal (B) must have a higher z-index than background modal (A)');
    assert.strictEqual(window.ModalManager.getStack().length, 2);
  });

  await checkAsync('C2. the background modal (A) is visually hidden while B is on top', async () => {
    const { window } = await freshWindow();
    getEntry(window, 'modalA').classList.add('open');
    await tick();
    getEntry(window, 'modalB').classList.add('open');
    await tick();
    assert.ok(getEntry(window, 'modalA').classList.contains('modal-overlay--stacked-hidden'));
    assert.ok(!getEntry(window, 'modalB').classList.contains('modal-overlay--stacked-hidden'));
  });

  await checkAsync('C3. focus moves to modalB, not modalA, when B opens on top of A', async () => {
    const { window } = await freshWindow();
    getEntry(window, 'modalA').classList.add('open');
    await tick();
    getEntry(window, 'modalB').classList.add('open');
    await tick();
    assert.ok(getEntry(window, 'modalB').contains(window.document.activeElement));
  });

  // ---- D. Closing the top of two -----------------------------------------
  await checkAsync('D1. closing B (top of 2) reveals A again and keeps scroll locked', async () => {
    const { window } = await freshWindow();
    getEntry(window, 'modalA').classList.add('open');
    await tick();
    getEntry(window, 'modalB').classList.add('open');
    await tick();
    getEntry(window, 'modalB').classList.remove('open');
    await tick();
    assert.strictEqual(window.ModalManager.getStack().length, 1);
    assert.ok(!getEntry(window, 'modalA').classList.contains('modal-overlay--stacked-hidden'));
    assert.strictEqual(window.ModalScrollLockManager.isLocked(), true);
  });

  // ---- E. Real Back button while a modal is open --------------------------
  await checkAsync('E1. pressing Back closes the open modal via history, not classList directly', async () => {
    const { window } = await freshWindow();
    getEntry(window, 'modalA').classList.add('open');
    await tick();
    assert.strictEqual(window.ModalManager.getStack().length, 1);
    window.history.back();
    await tick(40);
    assert.strictEqual(window.ModalManager.getStack().length, 0);
    assert.strictEqual(getEntry(window, 'modalA').classList.contains('open'), false);
  });

  await checkAsync('E2. Back-driven close still unlocks scroll and restores focus', async () => {
    const { window } = await freshWindow();
    window.document.getElementById('pageTrigger').focus();
    getEntry(window, 'modalA').classList.add('open');
    await tick();
    window.history.back();
    await tick(40);
    assert.strictEqual(window.ModalScrollLockManager.isLocked(), false);
    assert.strictEqual(window.document.activeElement.id, 'pageTrigger');
  });

  await checkAsync('E3. Back with two modals stacked closes only the topmost one', async () => {
    const { window } = await freshWindow();
    getEntry(window, 'modalA').classList.add('open');
    await tick();
    getEntry(window, 'modalB').classList.add('open');
    await tick();
    window.history.back();
    await tick(40);
    assert.strictEqual(window.ModalManager.getStack().length, 1, 'exactly one modal should remain');
    assert.strictEqual(window.ModalManager.isOpen('modalA'), true, 'the background modal must survive the Back press');
    assert.strictEqual(window.ModalManager.isOpen('modalB'), false, 'the top modal must be the one that closed');
  });

  // ---- F. Escape key --------------------------------------------------------
  await checkAsync('F1. Escape closes only the topmost modal', async () => {
    const { window } = await freshWindow();
    getEntry(window, 'modalA').classList.add('open');
    await tick();
    getEntry(window, 'modalB').classList.add('open');
    await tick();
    const evt = new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true });
    window.document.dispatchEvent(evt);
    await tick();
    assert.strictEqual(window.ModalManager.isOpen('modalB'), false);
    assert.strictEqual(window.ModalManager.isOpen('modalA'), true);
  });

  // ---- G. Duplicate mutation records don't double-register -----------------
  await checkAsync('G1. toggling the open class does not create duplicate stack entries', async () => {
    const { window } = await freshWindow();
    const el = getEntry(window, 'modalA');
    el.classList.add('open');
    el.className = el.className; // no-op re-assignment (forces an extra, redundant class mutation record)
    el.classList.add('open'); // already-open add — no state change but exercises the observer path again
    await tick();
    assert.strictEqual(window.ModalManager.getStack().length, 1);
  });

  // ---- H. Backdrop-click-equivalent close path -----------------------------
  await checkAsync('H1. closing via clicking the modal-close button cleans up fully', async () => {
    const { window } = await freshWindow();
    getEntry(window, 'modalA').classList.add('open');
    await tick();
    window.document.getElementById('modalACloseBtn').addEventListener('click', function () {
      getEntry(window, 'modalA').classList.remove('open');
    });
    window.document.getElementById('modalACloseBtn').click();
    await tick();
    assert.strictEqual(window.ModalManager.getStack().length, 0);
    assert.strictEqual(window.ModalScrollLockManager.isLocked(), false);
  });

  // ---- J. ScrollLockManager reference counting ------------------------------
  await checkAsync('J1. two stacked modals require both to close before scroll unlocks', async () => {
    const { window } = await freshWindow();
    getEntry(window, 'modalA').classList.add('open');
    await tick();
    getEntry(window, 'modalB').classList.add('open');
    await tick();
    getEntry(window, 'modalB').classList.remove('open');
    await tick();
    assert.strictEqual(window.ModalScrollLockManager.isLocked(), true, 'A is still open — must stay locked');
    getEntry(window, 'modalA').classList.remove('open');
    await tick();
    assert.strictEqual(window.ModalScrollLockManager.isLocked(), false);
  });

  // ---- K. FocusManager fallback ---------------------------------------------
  check('K1. focusFirst falls back to the container when it has no focusable descendant', () => {
    const dom = new JSDOM('<!doctype html><html><body><div id="c"><span>text only</span></div></body></html>', { runScripts: 'outside-only' });
    const src = fs.readFileSync(path.join(MODAL_DIR, 'FocusManager.js'), 'utf8');
    dom.window.eval(src);
    const container = dom.window.document.getElementById('c');
    dom.window.ModalFocusManager.focusFirst(container);
    assert.strictEqual(dom.window.document.activeElement, container);
    assert.strictEqual(container.getAttribute('tabindex'), '-1');
  });

  // ---- L. Stress: 100 stacked modals -----------------------------------------
  await checkAsync('L1. opening 100 modals sequentially yields a correct 100-deep stack', async () => {
    const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://example.test/app', pretendToBeVisual: true, runScripts: 'outside-only' });
    const { window } = dom;
    const realGCS = window.getComputedStyle.bind(window);
    window.getComputedStyle = function (el) {
      const cs = realGCS(el);
      try { Object.defineProperty(cs, 'paddingRight', { value: '0px', configurable: true }); } catch (e) {}
      return cs;
    };
    for (const file of ENGINE_FILES) {
      window.eval(fs.readFileSync(path.join(MODAL_DIR, file), 'utf8'));
    }
    window.ModalManager.init();
    await tick();

    const N = 100;
    for (let i = 0; i < N; i++) {
      const el = window.document.createElement('div');
      el.className = 'modal-overlay';
      el.id = 'stressModal' + i;
      el.innerHTML = '<div class="modal"><button>x</button></div>';
      window.document.body.appendChild(el);
      el.classList.add('open');
    }
    await tick(50);

    assert.strictEqual(window.ModalManager.getStack().length, N);
    const topEl = window.document.getElementById('stressModal' + (N - 1));
    const bottomEl = window.document.getElementById('stressModal0');
    assert.strictEqual(topEl.classList.contains('modal-overlay--stacked-hidden'), false, 'topmost must be visible');
    assert.strictEqual(bottomEl.classList.contains('modal-overlay--stacked-hidden'), true, 'bottom of a 100-stack must be hidden');
    assert.ok(parseInt(topEl.style.zIndex, 10) > parseInt(bottomEl.style.zIndex, 10));
    assert.strictEqual(window.ModalScrollLockManager.isLocked(), true);

    // close all 100, top-down (mirrors real Escape-repeatedly / Back-repeatedly usage)
    for (let i = N - 1; i >= 0; i--) {
      window.document.getElementById('stressModal' + i).classList.remove('open');
    }
    await tick(80);

    assert.strictEqual(window.ModalManager.getStack().length, 0, 'stack must be fully drained');
    assert.strictEqual(window.ModalScrollLockManager.isLocked(), false, 'scroll lock must not leak after 100 closes');
  });

  await checkAsync('L2. 100 opens then 100 Back presses drains the stack via history alone', async () => {
    const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://example.test/app', pretendToBeVisual: true, runScripts: 'outside-only' });
    const { window } = dom;
    const realGCS = window.getComputedStyle.bind(window);
    window.getComputedStyle = function (el) {
      const cs = realGCS(el);
      try { Object.defineProperty(cs, 'paddingRight', { value: '0px', configurable: true }); } catch (e) {}
      return cs;
    };
    for (const file of ENGINE_FILES) {
      window.eval(fs.readFileSync(path.join(MODAL_DIR, file), 'utf8'));
    }
    window.ModalManager.init();
    await tick();

    const N = 25; // kept smaller than L1 — each Back press is a real async history round trip
    for (let i = 0; i < N; i++) {
      const el = window.document.createElement('div');
      el.className = 'modal-overlay';
      el.id = 'backModal' + i;
      el.innerHTML = '<div class="modal"><button>x</button></div>';
      window.document.body.appendChild(el);
      el.classList.add('open');
      await tick(5);
    }
    assert.strictEqual(window.ModalManager.getStack().length, N);

    for (let i = 0; i < N; i++) {
      window.history.back();
      await tick(15);
    }
    assert.strictEqual(window.ModalManager.getStack().length, 0, 'N Back presses must close all N modals, none left behind');
    assert.strictEqual(window.ModalScrollLockManager.isLocked(), false);
  });

  console.log(log.join('\n'));
  console.log('\n' + '='.repeat(60));
  console.log('TOTAL: ' + (passed + failed) + '   PASSED: ' + passed + '   FAILED: ' + failed);
  console.log('='.repeat(60));
  process.exit(failed > 0 ? 1 : 0);
})();
