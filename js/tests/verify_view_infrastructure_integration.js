/**
 * verify_view_infrastructure_integration.js
 * ================================================================
 * PHASE 26 — VIEW INFRASTRUCTURE INTEGRATION — Verification
 * ================================================================
 * Standalone Node harness (`node js/tests/verify_view_infrastructure_integration.js`,
 * no browser required, no external dependencies).
 *
 * BACKGROUND
 * Phase 26's audit (see docs/phase26/VIEW_INFRASTRUCTURE_INTEGRATION_REPORT.md)
 * found the Shell -> DirtyTracker -> ViewVersion -> ViewCache -> ViewLifecycle
 * -> render chain was already fully connected through navigate() as of
 * v1.18.3 (Phase 16.5's markDirty()/isDirty() wiring, exercised by every
 * mutation call-site across js/modules/*.js). The one genuine remaining
 * gap was BootManager._hydrateOnce() — the app's single real initial
 * dashboard paint — never told js/core/view/ that paint had happened, so
 * ViewCache started cold and the very first navigate('dashboard') after
 * boot always re-rendered even when nothing had changed. This harness
 * proves that gap is closed, and that every pre-existing guarantee
 * (guarded no-ops, idempotency, zero effect when a layer is absent)
 * still holds.
 *
 * This file does NOT modify any production file. It is read-only with
 * respect to every file it requires.
 *
 * Sections:
 *   A. ViewLifecycle chain sanity (isDirty/markDirty/recordRendered)
 *   B. BootManager._hydrateOnce() now calls ViewLifecycle.recordRendered('dashboard')
 *   C. Post-boot: ApplicationShell.isDirty('dashboard') is false (cache warm)
 *   D. markDirty() after boot still correctly flips isDirty() back to true
 *   E. Regression: BootManager works identically when ViewLifecycle is absent
 *   F. Regression: _hydrateOnce() is still called at most once (idempotent)
 * ================================================================
 */

'use strict';

const assert = require('assert');
const path = require('path');

const CORE_DIR = path.join(__dirname, '..', 'core');

function FakeEl() {
  this.className = '';
  this.style = {};
  this.parentNode = null;
  this.classList = { add: function () {}, remove: function () {} };
}
FakeEl.prototype.appendChild = function () {};
FakeEl.prototype.setAttribute = function () {};

function freshSandbox() {
  // Each section gets an untouched global object graph so module-level
  // singletons (global.ViewCache = new ViewCache(), etc.) don't leak
  // state or registrations between sections. Includes the minimal
  // document/timer surface BootManager.js touches (skeleton element,
  // safety-net timer) so beginBoot() can run end-to-end without a real
  // browser, same spirit as verify_dom_recycler.js's FakeElement.
  const sandboxGlobal = {};
  sandboxGlobal.window = sandboxGlobal;
  sandboxGlobal.console = console;
  sandboxGlobal.document = {
    readyState: 'complete',
    addEventListener: function () {},
    createElement: function () { return new FakeEl(); },
    body: { appendChild: function () {} }
  };
  sandboxGlobal.setTimeout = setTimeout;
  sandboxGlobal.clearTimeout = clearTimeout;
  sandboxGlobal.Promise = Promise;
  sandboxGlobal.dispatchEvent = function () {};
  sandboxGlobal.CustomEvent = function (type, opts) { this.type = type; this.detail = opts && opts.detail; };
  return sandboxGlobal;
}

// Loads a project file's source and runs it against a plain object acting
// as `window`/`global`, without touching Node's own require cache (each
// call gets a fresh module instance) — same technique already used by
// verify_dom_recycler.js / verify_dashboard_widget_decomposition.js for
// files written as `(function (global) { ... })(window);`.
const fs = require('fs');
function loadInto(sandbox, absPath) {
  const src = fs.readFileSync(absPath, 'utf8');
  const fn = new Function('window', 'global', 'document', 'console', 'module', 'exports', src);
  fn(sandbox, sandbox, sandbox.document, console, {}, {});
}

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

console.log('=== SECTION A: ViewLifecycle chain sanity ===');
(function () {
  const g = freshSandbox();
  loadInto(g, path.join(CORE_DIR, 'view', 'ViewVersion.js'));
  loadInto(g, path.join(CORE_DIR, 'view', 'DirtyTracker.js'));
  loadInto(g, path.join(CORE_DIR, 'view', 'ViewCache.js'));
  loadInto(g, path.join(CORE_DIR, 'view', 'PageState.js'));
  loadInto(g, path.join(CORE_DIR, 'view', 'ViewLifecycle.js'));

  check('A1: unseen page is dirty by default', function () {
    assert.strictEqual(g.ViewLifecycle.isDirty('dashboard'), true);
  });
  check('A2: recordRendered() clears dirty + caches current version', function () {
    g.ViewLifecycle.recordRendered('dashboard');
    assert.strictEqual(g.ViewLifecycle.isDirty('dashboard'), false);
    assert.strictEqual(g.ViewCache.getRenderedVersion('dashboard'), 0);
    assert.strictEqual(g.PageState.getLastRenderedAt('dashboard') !== null, true);
  });
  check('A3: markDirty() bumps ViewVersion and flips isDirty() back to true', function () {
    g.ViewLifecycle.markDirty('dashboard');
    assert.strictEqual(g.ViewLifecycle.isDirty('dashboard'), true);
    assert.strictEqual(g.ViewVersion.getVersion('dashboard'), 1);
  });
  check('A4: recordRendered() again re-caches the new version', function () {
    g.ViewLifecycle.recordRendered('dashboard');
    assert.strictEqual(g.ViewLifecycle.isDirty('dashboard'), false);
    assert.strictEqual(g.ViewCache.getRenderedVersion('dashboard'), 1);
  });
  check('A5: setEnabled(false) kill-switch forces isDirty() true unconditionally', function () {
    g.ViewLifecycle.setEnabled(false);
    assert.strictEqual(g.ViewLifecycle.isDirty('dashboard'), true);
    g.ViewLifecycle.setEnabled(true);
    assert.strictEqual(g.ViewLifecycle.isDirty('dashboard'), false);
  });
})();

console.log('=== SECTION B-D: BootManager <-> ViewLifecycle integration ===');
function runBootIntegrationSection() {
  const g = freshSandbox();
  loadInto(g, path.join(CORE_DIR, 'view', 'ViewVersion.js'));
  loadInto(g, path.join(CORE_DIR, 'view', 'DirtyTracker.js'));
  loadInto(g, path.join(CORE_DIR, 'view', 'ViewCache.js'));
  loadInto(g, path.join(CORE_DIR, 'view', 'PageState.js'));
  loadInto(g, path.join(CORE_DIR, 'view', 'ViewLifecycle.js'));
  loadInto(g, path.join(CORE_DIR, 'shell', 'ShellEvents.js'));
  loadInto(g, path.join(CORE_DIR, 'shell', 'BootState.js'));
  loadInto(g, path.join(CORE_DIR, 'shell', 'ShellState.js'));
  loadInto(g, path.join(CORE_DIR, 'shell', 'PageRegistry.js'));
  loadInto(g, path.join(CORE_DIR, 'shell', 'ViewRegistry.js'));
  loadInto(g, path.join(CORE_DIR, 'shell', 'NavigationRegistry.js'));
  loadInto(g, path.join(CORE_DIR, 'shell', 'ShellRegistry.js'));
  loadInto(g, path.join(CORE_DIR, 'shell', 'LifecycleManager.js'));
  loadInto(g, path.join(CORE_DIR, 'shell', 'ApplicationShell.js'));

  let dashboardRenderCount = 0;
  g.updateBadges = function () {};
  g.renderDashboard = function () { dashboardRenderCount++; };
  g.bootReadyPromise = Promise.resolve({ timedOut: false, notReadyEntities: [] });

  loadInto(g, path.join(CORE_DIR, 'boot', 'BootManager.js'));

  g.BootManager.beginBoot();
  // Give BootManager's own .then() handler (chained off the same
  // bootReadyPromise instance) a turn to run before asserting.
  return g.bootReadyPromise.then(function () {
    return Promise.resolve().then(function () {
      check('B1: BootManager still renders the dashboard exactly once', function () {
        assert.strictEqual(dashboardRenderCount, 1);
      });
      check('B2: _hydrateOnce() recorded the boot paint in ViewLifecycle', function () {
        assert.strictEqual(g.ViewCache.hasRendered('dashboard'), true);
      });
      check('C1: ApplicationShell.isDirty(\'dashboard\') is false immediately after boot (cache warm)', function () {
        assert.strictEqual(g.ApplicationShell.isDirty('dashboard'), false);
      });
      check('D1: markDirty(\'dashboard\') after boot flips isDirty() back to true', function () {
        g.ApplicationShell.markDirty('dashboard');
        assert.strictEqual(g.ApplicationShell.isDirty('dashboard'), true);
      });
      check('D2: a subsequent recordRendered() clears it again', function () {
        g.ViewLifecycle.recordRendered('dashboard');
        assert.strictEqual(g.ApplicationShell.isDirty('dashboard'), false);
      });
    });
  });
}

runBootIntegrationSection().then(runRegressionSections).then(function () {
  console.log('\n' + passed + ' checks passed.');
  if (process.exitCode) {
    console.error('SOME CHECKS FAILED.');
    process.exit(1);
  } else {
    console.log('ALL CHECKS PASSED.');
  }
}).catch(function (err) {
  console.error('HARNESS ERROR:', err);
  process.exit(1);
});

function runRegressionSections() {
  console.log('=== SECTION E: BootManager works identically when ViewLifecycle is absent ===');
  const g = freshSandbox();
  // Deliberately do NOT load js/core/view/* — simulates that layer being
  // absent/failed-to-load, which must remain a complete no-op per every
  // other guarded line in this file.
  let dashboardRenderCount = 0;
  g.updateBadges = function () {};
  g.renderDashboard = function () { dashboardRenderCount++; };
  g.bootReadyPromise = Promise.resolve({ timedOut: false, notReadyEntities: [] });
  loadInto(g, path.join(CORE_DIR, 'boot', 'BootManager.js'));

  g.BootManager.beginBoot();
  return g.bootReadyPromise.then(function () {
    return Promise.resolve().then(function () {
      check('E1: dashboard still renders exactly once with ViewLifecycle absent', function () {
        assert.strictEqual(dashboardRenderCount, 1);
      });
      check('E2: BootManager.isReady() still fires normally', function () {
        assert.strictEqual(g.BootManager.isReady(), true);
      });

      console.log('=== SECTION F: _hydrateOnce() remains idempotent ===');
      let recordCalls = 0;
      g.ViewLifecycle = { recordRendered: function () { recordCalls++; } };
      g.BootManager._hydrateOnce();
      g.BootManager._hydrateOnce();
      check('F1: calling _hydrateOnce() again after boot is a no-op (still hydrated)', function () {
        assert.strictEqual(dashboardRenderCount, 1);
        assert.strictEqual(recordCalls, 0); // already hydrated; ViewLifecycle.recordRendered not called again
      });
    });
  });
}
