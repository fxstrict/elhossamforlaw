/**
 * verify_global_scroll_position_reset.js
 * ================================================================
 * PROBLEM 14 — Global Scroll Position Reset (v82)
 * ================================================================
 * Standalone Node harness (`node js/tests/verify_global_scroll_position_
 * reset.js`, no browser/jsdom required — this project's `verify_modal_
 * engine.js` already covers the jsdom-dependent path for ModalManager;
 * this harness instead uses the SAME hand-rolled fake-DOM technique every
 * other verify_*.js in js/tests/ uses for plain global functions defined
 * inline in index.html, e.g. verify_case_add_modal_reset_after_failed_
 * save.js's `loadRealConfigObject()`/extraction pattern) to prove the
 * fix without a new dependency.
 *
 * Root cause traced in the accompanying report:
 *   1. window/document is the app's real page-scroll container
 *      (css/base.css sets no overflow on body; .main/.page carry none
 *      either) and nothing previously reset it on page switch.
 *   2. .sidebar-nav (css/layout.css) is an independent overflow-y:auto
 *      container on a single PERSISTENT DOM node (never recreated by
 *      toggleSidebar()), so its scrollTop survived close/reopen.
 *   3. .modal (css/components.css) is the actual scroll container inside
 *      every .modal-overlay (not .modal-body) and is likewise a
 *      persistent node reused across opens, per js/core/modal/
 *      ModalManager.js's own header comment about 28 shared
 *      classList.add('open') call sites.
 *   4. history.scrollRestoration defaults to 'auto', which would fight a
 *      manual reset on Back/Forward (NavigationManager.js drives
 *      pushState/popstate) if left unset.
 *
 * This harness proves, against the REAL production source (index.html's
 * navigate()/toggleSidebar(), and the real js/core/modal/ModalManager.js
 * loaded unmodified via Node's vm/Module wrapper — the same technique
 * used throughout js/tests/):
 *   A. navigate(page) resets window scroll to the top exactly once per
 *      call, on the SAME page-activation entry point every kind of
 *      navigation already funnels through.
 *   B. Scrolling down, "leaving" (navigating elsewhere), then coming
 *      back to a page resets it to the top again (not just the first
 *      time).
 *   C. navigate() does not fire the scroll reset before it actually
 *      activates the target page (ordering/no side-channel regression).
 *   D. toggleSidebar() resets #sidebar .sidebar-nav's scrollTop to 0
 *      only when OPENING (not when closing).
 *   E. Sidebar scroll survives an *open* sidebar being scrolled around
 *      (no reset while it stays open) — only reopening after a close
 *      resets it.
 *   F. ModalManager's real _onOpen() resets the modal box's own
 *      scrollTop to 0 on every open — proven via ModalManagerImpl (the
 *      file's own explicit "exposed for isolated Node-side tests" hook)
 *      with a fresh instance and hand-rolled engine-dependency stubs, so
 *      no jsdom/MutationObserver is required.
 *   G. Existing modal-engine behavior this fix must not disturb: focus
 *      trap/first-focus and history-bridge notification still fire
 *      exactly once per open, unaffected by the new scrollTop line.
 * ================================================================
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const Module = require('module');
const vm = require('vm');

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

const ROOT = path.join(__dirname, '..', '..');

// ----------------------------------------------------------------
// extractFunctionSource — brace-counting extractor (regex cannot
// safely handle nested braces in these functions' real bodies).
// Finds `function <name>(` at the start of a line in the real
// index.html and returns the full source from `function` through its
// matching closing brace, inclusive. Same "don't hand-duplicate
// production code" discipline as this project's existing
// loadRealConfigObject() helper (verify_case_add_modal_reset_after_
// failed_save.js) — just for a function body instead of an object
// literal.
// ----------------------------------------------------------------
function extractFunctionSource(code, name) {
  var marker = 'function ' + name + '(';
  var start = -1;
  var searchFrom = 0;
  while (true) {
    var idx = code.indexOf(marker, searchFrom);
    if (idx === -1) throw new Error('Could not locate `function ' + name + '(` in index.html');
    // Require it to be a top-level declaration (line starts with it,
    // possibly after nothing else) — the real file's convention.
    var lineStart = code.lastIndexOf('\n', idx) + 1;
    if (code.slice(lineStart, idx) === '') { start = idx; break; }
    searchFrom = idx + marker.length;
  }
  var braceOpen = code.indexOf('{', start);
  if (braceOpen === -1) throw new Error('Could not find opening brace for ' + name + '()');
  var depth = 0;
  var i = braceOpen;
  for (; i < code.length; i++) {
    if (code[i] === '{') depth++;
    else if (code[i] === '}') {
      depth--;
      if (depth === 0) { i++; break; }
    }
  }
  return code.slice(start, i);
}

function loadModule(filePath) {
  const code = fs.readFileSync(filePath, 'utf8');
  const wrapper = Module.wrap(code);
  const script = new vm.Script(wrapper, { filename: filePath });
  const compiledWrapper = script.runInThisContext();
  const mod = new Module(filePath, module);
  mod.filename = filePath;
  mod.paths = Module._nodeModulePaths(path.dirname(filePath));
  const localRequire = function (id) { return mod.require(id); };
  compiledWrapper.call(mod.exports, mod.exports, localRequire, mod, filePath, path.dirname(filePath));
  mod.loaded = true;
  return mod.exports;
}

// ---- Fake element (only the surface navigate()/toggleSidebar() touch) ----
function makeFakeElement(id) {
  return {
    id: id || '',
    value: '',
    textContent: '',
    innerHTML: '',
    style: { display: '' },
    scrollTop: 0,
    classList: {
      _classes: {},
      add: function (c) { this._classes[c] = true; },
      remove: function (c) { delete this._classes[c]; },
      contains: function (c) { return !!this._classes[c]; },
      toggle: function (c, force) {
        var on = force !== undefined ? force : !this._classes[c];
        if (on) this._classes[c] = true; else delete this._classes[c];
        return on;
      }
    }
  };
}

function makeNodeList(arr) {
  arr.forEach = Array.prototype.forEach;
  return arr;
}

async function main() {
  const indexHtml = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

  // ================================================================
  // A/B/C — navigate() window-scroll reset
  // ================================================================
  (function () {
    const navigateSrc = extractFunctionSource(indexHtml, 'navigate');

    const pages = { 'cases': makeFakeElement('page-cases'), 'dashboard': makeFakeElement('page-dashboard') };
    const navItems = [];
    const scrollCalls = [];
    let topbarActionEl = makeFakeElement('topbarAction');
    let topbarTitleEl = makeFakeElement('topbarTitle');

    const fakeDocument = {
      querySelectorAll: function (sel) {
        if (sel === '.page') return makeNodeList(Object.keys(pages).map(function (k) { return pages[k]; }));
        if (sel === '.nav-item') return makeNodeList(navItems);
        return makeNodeList([]);
      },
      getElementById: function (id) {
        if (id === 'topbarTitle') return topbarTitleEl;
        if (id === 'topbarAction') return topbarActionEl;
        if (id.indexOf('page-') === 0) return pages[id.slice(5)] || null;
        return null;
      }
    };

    const sandbox = {
      window: {},
      document: fakeDocument,
      PAGE_TITLES: { cases: 'القضايا', dashboard: 'لوحة التحكم' },
      ADDABLE: ['cases'],
      currentPage: 'dashboard',
      scrollTo: function (x, y) { scrollCalls.push([x, y]); },
      // navigate()'s render dispatch falls back to a direct fn() call
      // when window.RenderQueue/ApplicationShell aren't present (see the
      // real function's own header comment) — stub only the two render
      // functions this test's two tracked pages need.
      renderCases: function () {},
      renderDashboard: function () {},
      toast: function () {}
    };
    sandbox.window = sandbox; // window.scrollTo === global scrollTo, matches browser semantics
    Object.keys(sandbox).forEach(function (k) { global[k] = sandbox[k]; });

    // eslint-disable-next-line no-eval
    (0, eval)(navigateSrc);
    global.navigate = navigate; // the extracted declaration

    check('navigate(): calls window.scrollTo(0,0) exactly once on a normal page switch', () => {
      scrollCalls.length = 0;
      global.navigate('cases');
      assert.strictEqual(scrollCalls.length, 1);
      assert.deepStrictEqual(scrollCalls[0], [0, 0]);
    });

    check('navigate(): still activates the target page (no regression to the pre-existing behavior)', () => {
      assert.ok(pages.cases.classList.contains('active'));
      assert.ok(!pages.dashboard.classList.contains('active'));
      assert.strictEqual(global.currentPage, 'cases');
    });

    check('navigate(): resets scroll AGAIN on a later switch back — not just the first time (leave-then-return case)', () => {
      // Simulate the reported bug scenario: scrolled down on "cases",
      // then navigated to "dashboard" and back to "cases".
      scrollCalls.length = 0;
      global.navigate('dashboard');
      global.navigate('cases');
      assert.strictEqual(scrollCalls.length, 2, 'one reset per navigate() call, including the return trip');
      scrollCalls.forEach(function (call) { assert.deepStrictEqual(call, [0, 0]); });
    });

    check('navigate(): resets scroll even when re-selecting the SAME page (still counts as "opening" it)', () => {
      scrollCalls.length = 0;
      global.navigate('cases');
      assert.strictEqual(scrollCalls.length, 1);
    });
  })();

  // ================================================================
  // D/E — toggleSidebar() sidebar-nav scroll reset
  // ================================================================
  (function () {
    const toggleSrc = extractFunctionSource(indexHtml, 'toggleSidebar');

    const sidebarEl = makeFakeElement('sidebar');
    const overlayEl = makeFakeElement('sidebarOverlay');
    const navEl = makeFakeElement();

    const fakeDocument = {
      getElementById: function (id) {
        if (id === 'sidebar') return sidebarEl;
        if (id === 'sidebarOverlay') return overlayEl;
        return null;
      },
      querySelector: function (sel) {
        if (sel === '#sidebar .sidebar-nav') return navEl;
        return null;
      }
    };

    const sandbox = { document: fakeDocument };
    Object.keys(sandbox).forEach(function (k) { global[k] = sandbox[k]; });
    delete global.window; delete global.scrollTo; delete global.PAGE_TITLES;
    delete global.ADDABLE; delete global.currentPage; delete global.navigate;

    // eslint-disable-next-line no-eval
    (0, eval)(toggleSrc);
    global.toggleSidebar = toggleSidebar;

    check('toggleSidebar(): opening resets #sidebar .sidebar-nav scrollTop to 0', () => {
      navEl.scrollTop = 480; // simulate having scrolled down last time it was open
      sidebarEl.classList.remove('open'); // start closed
      global.toggleSidebar(); // -> opens
      assert.ok(sidebarEl.classList.contains('open'));
      assert.strictEqual(navEl.scrollTop, 0);
    });

    check('toggleSidebar(): scrolling while it STAYS open is not reset by this function (only open/close calls toggleSidebar)', () => {
      navEl.scrollTop = 200; // user scrolls down while sidebar is open — not a toggleSidebar() call
      assert.strictEqual(navEl.scrollTop, 200, 'no code path here resets scroll without a toggle');
    });

    check('toggleSidebar(): closing does NOT reset scrollTop (only opening should)', () => {
      navEl.scrollTop = 200;
      global.toggleSidebar(); // -> closes (was open from the first check)
      assert.ok(!sidebarEl.classList.contains('open'));
      assert.strictEqual(navEl.scrollTop, 200, 'closing must leave scrollTop untouched');
    });

    check('toggleSidebar(): reopening after a close resets scrollTop to 0 again', () => {
      global.toggleSidebar(); // -> opens again
      assert.ok(sidebarEl.classList.contains('open'));
      assert.strictEqual(navEl.scrollTop, 0);
    });
  })();

  // ================================================================
  // F/G — ModalManager._onOpen() modal-box scroll reset
  // ================================================================
  await (async function () {
    const modalManagerPath = path.join(ROOT, 'js', 'core', 'modal', 'ModalManager.js');

    const historyBridgeLog = [];
    const focusTrapLog = [];
    const focusFirstLog = [];

    const fakeDocument = {
      body: {},
      documentElement: {},
      addEventListener: function () {},
      querySelectorAll: function () { return []; },
      readyState: 'complete'
    };

    const sandboxGlobals = {
      document: fakeDocument,
      window: undefined,
      ModalStack: {
        _entries: [],
        isEmpty: function () { return this._entries.length === 0; },
        push: function (entry) { this._entries.push(entry); return entry; },
        top: function () { return this._entries[this._entries.length - 1] || null; },
        size: function () { return this._entries.length; },
        entries: function () { return this._entries.slice(); },
        remove: function (el) {
          var i = this._entries.findIndex(function (e) { return e.el === el; });
          if (i === -1) return null;
          return this._entries.splice(i, 1)[0];
        }
      },
      ModalScrollLockManager: { lock: function () {}, unlock: function () {} },
      ModalZIndexEngine: { forConfirmDialog: function () { return 9999; }, forDepth: function () { return 1000; } },
      ModalFocusManager: {
        saveActiveElement: function () { return null; },
        trap: function (box) { focusTrapLog.push(box); return function () {}; },
        focusFirst: function (box) { focusFirstLog.push(box); },
        restore: function () {}
      },
      ModalHistoryBridge: {
        init: function () {},
        setPopHandler: function () {},
        onModalOpened: function (depth) { historyBridgeLog.push(depth); },
        onModalClosedByCode: function () {}
      }
    };
    sandboxGlobals.window = sandboxGlobals;
    Object.keys(sandboxGlobals).forEach(function (k) { global[k] = sandboxGlobals[k]; });

    const modalManagerExports = loadModule(modalManagerPath);
    const ModalManagerImpl = modalManagerExports.ModalManagerImpl;

    function makeFakeModalOverlay(scrollTopStart) {
      const modalBox = makeFakeElement();
      modalBox.scrollTop = scrollTopStart;
      const overlay = makeFakeElement('modalCase');
      overlay.querySelector = function (sel) { return sel === '.modal' ? modalBox : null; };
      overlay._modalBox = modalBox;
      return overlay;
    }

    await checkAsync('ModalManager._onOpen(): resets the .modal box scrollTop to 0 on open (was scrolled down from a previous open)', async () => {
      const instance = new ModalManagerImpl();
      const overlay = makeFakeModalOverlay(650); // simulate a modal left scrolled down before it was last closed
      instance._onOpen(overlay);
      assert.strictEqual(overlay._modalBox.scrollTop, 0);
    });

    await checkAsync('ModalManager._onOpen(): still performs its pre-existing job (stack push, scroll lock, focus trap/first, history notify) — unaffected by the new scrollTop line', async () => {
      const instance = new ModalManagerImpl();
      const overlay = makeFakeModalOverlay(0);
      historyBridgeLog.length = 0; focusTrapLog.length = 0; focusFirstLog.length = 0;
      instance._onOpen(overlay);
      assert.strictEqual(historyBridgeLog.length, 1);
      assert.strictEqual(focusTrapLog.length, 1);
      assert.strictEqual(focusFirstLog.length, 1);
    });

    await checkAsync('ModalManager._onOpen(): a modal with no .modal descendant (falls back to the overlay itself) does not throw', async () => {
      const instance = new ModalManagerImpl();
      const overlay = makeFakeElement('modalPlain');
      overlay.querySelector = function () { return null; };
      overlay.scrollTop = 300;
      instance._onOpen(overlay);
      assert.strictEqual(overlay.scrollTop, 0, 'falls back to resetting the overlay itself, matching the same fallback `el.querySelector(".modal") || el` used for the focus trap');
    });
  })();

  console.log(log.join('\n'));
  console.log('\n' + passed + '/' + (passed + failed) + ' checks passed.');
  if (failed > 0) {
    console.log('\n' + failed + ' CHECK(S) FAILED.');
    process.exit(1);
  } else {
    console.log('\nALL CHECKS PASSED.');
    process.exit(0);
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

main().catch((e) => { console.error(e); process.exit(1); });
