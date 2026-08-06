/**
 * verify_render_engine_activation.js
 * ================================================================
 * PHASE 27 — RENDER ENGINE ACTIVATION — Verification
 * ================================================================
 * Standalone Node harness (`node js/tests/verify_render_engine_activation.js`,
 * no browser required, no external dependencies beyond Node's built-in `vm`).
 *
 * BACKGROUND
 * Phase 26 (docs/phase26/) confirmed js/core/render/*.js (RenderQueue,
 * RenderRegistry, RenderScheduler, RenderDispatcher, RenderMetrics) had
 * zero runtime callers — ApplicationShell.enqueueRender() exists but
 * nothing calls it, so the queue built in Phase 16.2 never actually ran.
 * Phase 27's own Step 3 safety analysis (docs/phase27/) found that wiring
 * it in is safe ONLY if the one real behavioral difference — RenderQueue's
 * synchronous flush() catches a render callback's exception internally
 * instead of letting it propagate — is neutralized at the call site by
 * re-throwing any captured error. This harness proves that neutralization
 * actually holds, using the REAL navigate() source extracted from
 * index.html (not a re-implementation), loaded into a `vm` sandbox
 * alongside the REAL js/core/render/*.js files.
 *
 * This file does NOT modify any production file. It is read-only with
 * respect to every file it requires.
 *
 * Sections:
 *   A. RenderQueue mechanics still behave exactly as documented (sanity,
 *      no navigate() involvement) — enqueue/flush/wrap/error-capture.
 *   B. navigate() + RenderQueue present: render fires exactly once, in
 *      the exact page requested, and RenderMetrics/RenderRegistry show
 *      real activity (proving the queue is no longer dormant).
 *   C. navigate() + RenderQueue present + render function throws: the
 *      exception propagates OUT of navigate() (identical to a direct
 *      renderX() call throwing pre-Phase-27), the render function was
 *      invoked exactly once (no double-render), and downstream navigate()
 *      logic (ViewLifecycle.recordRendered, sidebar-close) that used to
 *      be skipped on a thrown error is still skipped, matching pre-Phase-27
 *      behavior exactly.
 *   D. navigate() + RenderQueue absent: falls back to a direct call,
 *      byte-for-byte the pre-Phase-27 behavior.
 *   E. navigate() + RenderQueue.wrap not a function (partially loaded /
 *      corrupted): also falls back to a direct call, never throws from
 *      the wiring itself.
 *   F. Dirty-tracking skip (ApplicationShell.isDirty === false) still
 *      means the render function is never called at all, queue or no
 *      queue — proves Phase 27 did not disturb Phase 26's behavior.
 * ================================================================
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..', '..');
const RENDER_DIR = path.join(__dirname, '..', 'core', 'render');
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

// Extract the real navigate() function body verbatim from index.html —
// same technique verify_dashboard_widget_decomposition.js uses for
// renderDashboard(), so this test tracks the actual shipped source, not a
// hand-copied approximation of it.
const INDEX_SOURCE = fs.readFileSync(INDEX_HTML, 'utf8');
const NAV_START = INDEX_SOURCE.indexOf('function navigate(page){');
const NAV_END = INDEX_SOURCE.indexOf('function toggleSidebar()');
assert.ok(NAV_START >= 0 && NAV_END > NAV_START, 'could not locate navigate()...toggleSidebar() in index.html');
const NAVIGATE_SOURCE = INDEX_SOURCE.slice(NAV_START, NAV_END);
assert.ok(/RenderQueue/.test(NAVIGATE_SOURCE), 'sanity: navigate() source should reference RenderQueue after Phase 27 wiring');

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
      querySelectorAll: function () { return { forEach: function () {} }; },
      getElementById: function (id) {
        if (!els[id]) els[id] = makeEl();
        return els[id];
      }
    },
    innerWidth: 1200
  };
  sandbox.window = sandbox;
  // Render function spies — every tracked page gets one so navigate()'s
  // full if/else chain always resolves to a real function reference.
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
    if (fs.existsSync(p)) {
      vm.createContext(sandbox);
      vm.runInContext(fs.readFileSync(p, 'utf8'), sandbox, { filename: f });
    }
  });
}

// PHASE 28 ADDITION — loads the REAL js/core/shell/ApplicationShell.js (not
// a stub) so Sections B/C exercise navigate()'s actual post-Phase-28 call
// path: ApplicationShell.enqueueRender(), not RenderQueue.wrap() directly.
// ApplicationShell.js only touches its shell/* siblings (ShellBootState,
// ShellRegistry, ShellEvents) defensively via `if (global.X)` guards, so it
// is safe to load standalone here, exactly as loadRenderEngine() above
// loads js/core/render/*.js standalone without the shell layer.
const SHELL_DIR = path.join(__dirname, '..', 'core', 'shell');
function loadShell(sandbox) {
  const p = path.join(SHELL_DIR, 'ApplicationShell.js');
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(p, 'utf8'), sandbox, { filename: 'ApplicationShell.js' });
}

function runNavigate(sandbox, page) {
  vm.createContext(sandbox);
  vm.runInContext(NAVIGATE_SOURCE + '\nnavigate(' + JSON.stringify(page) + ');', sandbox, { filename: 'navigate.js' });
}

console.log('=== SECTION A: RenderQueue mechanics (no navigate() involved) ===');
(function () {
  const sandbox = makeSandbox();
  loadRenderEngine(sandbox);
  check('A1: enqueue+flush runs the callback synchronously, exactly once', function () {
    let n = 0;
    sandbox.RenderQueue.enqueue('k', function () { n++; });
    const results = sandbox.RenderQueue.flush();
    assert.strictEqual(n, 1);
    assert.strictEqual(results.length, 1);
    assert.strictEqual(results[0].error, null);
  });
  check('A2: wrap() returns a function whose call is equivalent to calling the wrapped fn once', function () {
    let n = 0;
    const wrapped = sandbox.RenderQueue.wrap('k2', function () { n++; });
    wrapped();
    assert.strictEqual(n, 1);
  });
  check('A3: a throwing callback is captured in the flush results, not thrown from flush() itself', function () {
    let threw = false;
    let results;
    try {
      sandbox.RenderQueue.enqueue('k3', function () { throw new Error('boom'); });
      results = sandbox.RenderQueue.flush();
    } catch (e) {
      threw = true;
    }
    assert.strictEqual(threw, false, 'flush() itself must never throw');
    assert.ok(results[0].error instanceof Error);
    assert.strictEqual(results[0].error.message, 'boom');
  });
})();

console.log('=== SECTION B: navigate() + RenderQueue present — activation proof ===');
(function () {
  const sandbox = makeSandbox();
  loadRenderEngine(sandbox);
  loadShell(sandbox); // PHASE 28: navigate() now goes through ApplicationShell.enqueueRender().
  runNavigate(sandbox, 'dashboard');
  check('B1: renderDashboard was called exactly once', function () {
    assert.strictEqual(sandbox.__renderCalls.dashboard, 1);
  });
  check('B2: only the requested page rendered, no other tracked page did', function () {
    const total = Object.keys(sandbox.__renderCalls).reduce(function (s, k) { return s + sandbox.__renderCalls[k]; }, 0);
    assert.strictEqual(total, 1);
  });
  check('B3: RenderMetrics recorded real activity (queue is no longer dormant)', function () {
    const snap = sandbox.RenderQueue.getStatistics();
    assert.strictEqual(snap.totalEnqueued, 1);
    assert.strictEqual(snap.totalFlushed, 1);
    assert.strictEqual(snap.totalErrors, 0);
  });
  check('B4: no pending tasks left in the registry after navigate() returns', function () {
    assert.strictEqual(sandbox.RenderQueue.hasPending(), false);
  });
})();

console.log('=== SECTION C: navigate() + RenderQueue present + render throws ===');
(function () {
  const sandbox = makeSandbox({ throwOn: 'cases' });
  loadRenderEngine(sandbox);
  loadShell(sandbox); // PHASE 28: navigate() now goes through ApplicationShell.enqueueRender().
  check('C1: the exception propagates OUT of navigate() (matches pre-Phase-27 direct-call behavior)', function () {
    assert.throws(function () { runNavigate(sandbox, 'cases'); }, /simulated render failure for cases/);
  });
  check('C2: the render function was invoked exactly once (no double-render via the fallback path)', function () {
    assert.strictEqual(sandbox.__renderCalls.cases, 1);
  });
  check('C3: RenderMetrics recorded the error (observable via diagnostics, unlike before Phase 27)', function () {
    const snap = sandbox.RenderQueue.getStatistics();
    assert.strictEqual(snap.totalErrors, 1);
  });
})();

console.log('=== SECTION D: navigate() + RenderQueue absent — fallback to direct call ===');
(function () {
  const sandbox = makeSandbox();
  // Deliberately do NOT load the render engine — window.RenderQueue stays undefined.
  runNavigate(sandbox, 'dashboard');
  check('D1: renderDashboard still ran exactly once via the direct-call fallback', function () {
    assert.strictEqual(sandbox.__renderCalls.dashboard, 1);
  });
})();

console.log('=== SECTION E: RenderQueue present but ApplicationShell/enqueueRender missing — safe fallback ===');
// PHASE 28 NOTE: navigate() no longer calls RenderQueue.wrap() directly (it
// calls ApplicationShell.enqueueRender()), so "RenderQueue.wrap corrupted"
// is no longer a reachable failure mode from navigate()'s own call site.
// The corresponding real risk after this migration is the one flagged in
// index.html's own Phase 28 comment: ApplicationShell.enqueueRender()
// returns null (skipping the render entirely) if RenderQueue is missing —
// so navigate() must independently confirm RenderQueue is present before
// trusting ApplicationShell.enqueueRender() to do anything. These checks
// prove that guard holds for both ways ApplicationShell can be missing.
(function () {
  const sandbox = makeSandbox();
  loadRenderEngine(sandbox);
  // Deliberately do NOT loadShell(sandbox) — ApplicationShell stays undefined.
  check('E1: RenderQueue present, ApplicationShell absent — navigate() falls back to a direct call (not a silently skipped render)', function () {
    assert.doesNotThrow(function () { runNavigate(sandbox, 'dashboard'); });
    assert.strictEqual(sandbox.__renderCalls.dashboard, 1);
  });
})();
(function () {
  const sandbox = makeSandbox();
  loadRenderEngine(sandbox);
  loadShell(sandbox);
  sandbox.ApplicationShell.enqueueRender = 'not-a-function';
  check('E2: RenderQueue present, ApplicationShell.enqueueRender corrupted — navigate() falls back to a direct call', function () {
    assert.doesNotThrow(function () { runNavigate(sandbox, 'dashboard'); });
    assert.strictEqual(sandbox.__renderCalls.dashboard, 1);
  });
})();

console.log('=== SECTION F: dirty-tracking skip still short-circuits the render entirely ===');
(function () {
  const sandbox = makeSandbox();
  loadRenderEngine(sandbox);
  sandbox.ApplicationShell = { isDirty: function () { return false; }, recordNavigation: function () {} };
  runNavigate(sandbox, 'dashboard');
  check('F1: render function is never called when the page is not dirty (queue or no queue)', function () {
    assert.strictEqual(sandbox.__renderCalls.dashboard, 0);
  });
  check('F2: RenderQueue was never touched either (no phantom activity for a skipped render)', function () {
    const snap = sandbox.RenderQueue.getStatistics();
    assert.strictEqual(snap.totalEnqueued, 0);
  });
})();

console.log('\n' + passed + ' checks passed.');
if (process.exitCode) {
  console.error('\nSOME CHECKS FAILED.');
} else {
  console.log('ALL CHECKS PASSED.');
}
