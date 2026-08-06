/**
 * verify_render_orchestration_consolidation.js
 * ================================================================
 * PHASE 28 — RENDER ORCHESTRATION CONSOLIDATION — Verification
 * ================================================================
 * Standalone Node harness (`node js/tests/verify_render_orchestration_consolidation.js`,
 * no browser required, no external dependencies beyond Node's built-in `vm`).
 *
 * BACKGROUND
 * Phase 27 (docs/phase27/) wired navigate() to route every tracked-page
 * render through `RenderQueue.wrap(key, fn)()` directly, and deliberately
 * left `ApplicationShell.enqueueRender()` uncalled (it is a documented
 * one-line pass-through to `RenderQueue.enqueue()+.flush()`, added no
 * behavior beyond what `.wrap()` already provided, and using it would have
 * added a second call path for no reason at that time).
 *
 * Phase 28's Part A re-examined that decision now that the architecture is
 * meant to be consolidated rather than merely activated, and found:
 *   - `ApplicationShell.enqueueRender(pageId, callback)` performs the exact
 *     same two calls (`RenderQueue.enqueue` then `RenderQueue.flush()`) that
 *     `RenderQueue.wrap(key, fn)()`'s returned function makes — see
 *     ApplicationShell.js's own Phase 16.2 header comment. Migrating
 *     navigate() to call it is therefore behavior-identical on the success
 *     path.
 *   - It is NOT a safe drop-in substitution on its own: unlike
 *     `RenderQueue.wrap()`, `ApplicationShell.enqueueRender()` returns
 *     `null` (skipping the render entirely, calling nothing) if
 *     `window.RenderQueue` is missing, instead of falling back to a direct
 *     call. index.html's Phase 28 comment documents the fix: navigate()'s
 *     `__vcRunRender()` now requires BOTH `window.RenderQueue` and
 *     `window.ApplicationShell` (with a real `enqueueRender` method) before
 *     routing through the queue, and falls back to a direct `fn()` call
 *     otherwise — restoring the exact same "queue absent -> direct call"
 *     contract Phase 27 established.
 *
 * This file does NOT re-prove every scenario `verify_render_engine_activation.js`
 * already covers (that file was itself updated this phase so its Sections
 * B/C load the real ApplicationShell.js and exercise the new call path, and
 * its Section E now covers both ways ApplicationShell can be missing/broken).
 * This file adds the checks that are specific to Phase 28's own scope:
 *
 *   Part A — ApplicationShell.enqueueRender() is no longer dead code, and
 *            RenderQueue.wrap() remains independently correct even though
 *            navigate() no longer calls it.
 *   Part B — ShellEvents audit: shell:beforeNavigate/afterNavigate still
 *            fire on every real navigation, with the full real Shell stack
 *            loaded (ApplicationShell + LifecycleManager + ShellState +
 *            ShellRegistry + ShellBootState + ShellEvents), and having zero
 *            subscribers changes nothing about navigate()'s own behavior.
 *            A temporary, test-only subscriber proves the channel is fully
 *            usable by a future phase without navigate() or ApplicationShell
 *            needing to change.
 * ================================================================
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..', '..');
const RENDER_DIR = path.join(__dirname, '..', 'core', 'render');
const SHELL_DIR = path.join(__dirname, '..', 'core', 'shell');
const INDEX_HTML = path.join(ROOT, 'index.html');

let passed = 0;
function check(label, fn) {
  try {
    fn();
    passed++;
    console.log('  OK  ' + label);
  } catch (err) {
    console.error('FAIL  ' + label);
    console.error('      ' + err.message);
    process.exitCode = 1;
  }
}

const INDEX_SOURCE = fs.readFileSync(INDEX_HTML, 'utf8');
const NAV_START = INDEX_SOURCE.indexOf('function navigate(page){');
const NAV_END = INDEX_SOURCE.indexOf('function toggleSidebar()');
assert.ok(NAV_START >= 0 && NAV_END > NAV_START, 'could not locate navigate()...toggleSidebar() in index.html');
const NAVIGATE_SOURCE = INDEX_SOURCE.slice(NAV_START, NAV_END);
assert.ok(/ApplicationShell\.enqueueRender\(key,fn\)/.test(NAVIGATE_SOURCE), 'sanity: navigate() source should call ApplicationShell.enqueueRender(key,fn) after Phase 28 wiring');
assert.ok(!/=\s*RenderQueue\.wrap\(key,fn\)\(\)/.test(NAVIGATE_SOURCE), 'sanity: navigate() source should no longer assign the result of calling RenderQueue.wrap(key,fn)() directly');

function makeClassList() {
  return { add: function () {}, remove: function () {} };
}
function makeEl() {
  return { classList: makeClassList(), style: {}, innerHTML: '', textContent: '', value: '', href: '', addEventListener: function () {}, getAttribute: function () { return null; } };
}

function makeSandbox(overrides) {
  const els = {};
  const sandbox = {
    console: console,
    window: null,
    PAGE_TITLES: { dashboard: 'Dashboard', cases: 'Cases' },
    ADDABLE: ['cases'],
    currentPage: null,
    calYear: null,
    calMonth: null,
    document: {
      readyState: 'complete',
      addEventListener: function () {},
      querySelectorAll: function () { return { forEach: function () {} }; },
      getElementById: function (id) {
        if (!els[id]) els[id] = makeEl();
        return els[id];
      }
    },
    innerWidth: 1200
  };
  sandbox.window = sandbox;
  const calls = { dashboard: 0, cases: 0, sessions: 0, clients: 0, children: 0, documents: 0, tasks: 0, fees: 0, calendar: 0, library: 0, templates: 0 };
  ['dashboard', 'cases', 'sessions', 'clients', 'children', 'documents', 'tasks', 'fees', 'calendar', 'library', 'templates'].forEach(function (p) {
    const fnName = 'render' + p.charAt(0).toUpperCase() + p.slice(1);
    sandbox[fnName] = function () {
      calls[p]++;
      if (overrides && overrides.throwOn === p) throw new Error('simulated render failure for ' + p);
    };
  });
  sandbox.__renderCalls = calls;
  return sandbox;
}

function loadRenderEngine(sandbox) {
  ['RenderTask.js', 'RenderRegistry.js', 'RenderScheduler.js', 'RenderMetrics.js', 'RenderDispatcher.js', 'RenderQueue.js'].forEach(function (f) {
    const p = path.join(RENDER_DIR, f);
    vm.createContext(sandbox);
    vm.runInContext(fs.readFileSync(p, 'utf8'), sandbox, { filename: f });
  });
}

// Loads the FULL real shell stack, in the same order index.html's own
// <script> tags load them, so shell:beforeNavigate/afterNavigate actually
// fire (ApplicationShell.recordNavigation() -> ShellLifecycleManager.onNavigate()
// -> ShellEvents.emit()), not just the standalone ApplicationShell.js used
// by verify_render_engine_activation.js (which doesn't need the rest of the
// stack for enqueueRender()/isDirty() alone).
function loadFullShellStack(sandbox) {
  ['ShellEvents.js', 'BootState.js', 'ShellState.js', 'PageRegistry.js', 'NavigationRegistry.js', 'ViewRegistry.js', 'ShellRegistry.js', 'LifecycleManager.js', 'ApplicationShell.js'].forEach(function (f) {
    const p = path.join(SHELL_DIR, f);
    if (fs.existsSync(p)) {
      vm.createContext(sandbox);
      vm.runInContext(fs.readFileSync(p, 'utf8'), sandbox, { filename: f });
    }
  });
}

function runNavigate(sandbox, page) {
  vm.createContext(sandbox);
  vm.runInContext(NAVIGATE_SOURCE + '\nnavigate(' + JSON.stringify(page) + ');', sandbox, { filename: 'navigate.js' });
}

console.log('=== PART A: ApplicationShell.enqueueRender() is active; RenderQueue.wrap() remains independently correct ===');
(function () {
  const sandbox = makeSandbox();
  loadRenderEngine(sandbox);
  loadFullShellStack(sandbox);

  let enqueueRenderCalls = 0;
  const realEnqueueRender = sandbox.ApplicationShell.enqueueRender;
  sandbox.ApplicationShell.enqueueRender = function () {
    enqueueRenderCalls++;
    return realEnqueueRender.apply(this, arguments);
  };

  runNavigate(sandbox, 'dashboard');

  check('A1: navigate() actually calls ApplicationShell.enqueueRender() (no longer dead code)', function () {
    assert.strictEqual(enqueueRenderCalls, 1);
  });
  check('A2: the render still happened exactly once, through the real queue', function () {
    assert.strictEqual(sandbox.__renderCalls.dashboard, 1);
    assert.strictEqual(sandbox.RenderQueue.getStatistics().totalFlushed, 1);
  });
})();

(function () {
  // RenderQueue.wrap() itself: untouched by Phase 28, still works exactly
  // as documented, even though nothing in navigate() calls it anymore.
  const sandbox = makeSandbox();
  loadRenderEngine(sandbox);
  check('A3: RenderQueue.wrap() (no longer called by navigate(), but still public API) still behaves as documented', function () {
    let n = 0;
    const wrapped = sandbox.RenderQueue.wrap('standalone-key', function () { n++; });
    const results = wrapped();
    assert.strictEqual(n, 1);
    assert.strictEqual(results.length, 1);
    assert.strictEqual(results[0].error, null);
  });
})();

console.log('=== PART B: ShellEvents audit — still emitted, still (correctly) zero subscribers, channel remains usable ===');
(function () {
  const sandbox = makeSandbox();
  loadRenderEngine(sandbox);
  loadFullShellStack(sandbox);

  const seen = [];
  // Test-only subscriber: proves the channel is fully wired end-to-end
  // and could be consumed by a future phase without any change to
  // navigate(), ApplicationShell, or LifecycleManager. Not left in
  // production — this is verification, not a new feature.
  sandbox.ShellEvents.on('shell:beforeNavigate', function (detail) { seen.push(['before', detail]); });
  sandbox.ShellEvents.on('shell:afterNavigate', function (detail) { seen.push(['after', detail]); });

  runNavigate(sandbox, 'dashboard');

  check('B1: shell:beforeNavigate fires exactly once per navigation, with {from,to} detail', function () {
    const before = seen.filter(function (e) { return e[0] === 'before'; });
    assert.strictEqual(before.length, 1);
    assert.strictEqual(before[0][1].to, 'dashboard');
  });
  check('B2: shell:afterNavigate fires exactly once per navigation, after beforeNavigate', function () {
    const after = seen.filter(function (e) { return e[0] === 'after'; });
    assert.strictEqual(after.length, 1);
    assert.strictEqual(after[0][1].to, 'dashboard');
    assert.ok(seen[0][0] === 'before' && seen[seen.length - 1][0] === 'after');
  });
  check('B3: render still happened normally with a subscriber attached (observing does not alter navigation/render behavior)', function () {
    assert.strictEqual(sandbox.__renderCalls.dashboard, 1);
  });
})();

(function () {
  // The production-equivalent case: zero subscribers. Confirms navigate()
  // and the render engine behave identically whether or not anything is
  // listening on ShellEvents — i.e. this phase's audit-only conclusion
  // (leave ShellEvents dormant; no existing dormant consumer was found to
  // wire it to) has no observable effect either way.
  const sandbox = makeSandbox();
  loadRenderEngine(sandbox);
  loadFullShellStack(sandbox);
  runNavigate(sandbox, 'dashboard');
  check('B4: with zero ShellEvents subscribers (the actual production state), navigate() and rendering still work exactly the same', function () {
    assert.strictEqual(sandbox.__renderCalls.dashboard, 1);
    assert.strictEqual(sandbox.RenderQueue.getStatistics().totalFlushed, 1);
  });
})();

console.log('\n' + passed + ' checks passed.');
if (process.exitCode) {
  console.error('\nSOME CHECKS FAILED.');
} else {
  console.log('ALL CHECKS PASSED.');
}
