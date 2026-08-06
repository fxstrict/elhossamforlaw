/**
 * verify_runtime_debug_framework.js — PHASE 17.3.1
 * ================================================================
 * Runtime Diagnostics Framework (Permanent Hidden Developer Mode)
 * Standalone jsdom harness (`node js/tests/verify_runtime_debug_framework.js`).
 *
 * Loads js/debug/RuntimeDebugLayer.js UNMODIFIED into fresh jsdom windows —
 * one per section, so the module-level `__RDL_INSTALLED__` idempotency
 * guard never leaks state between sections. Every check below drives the
 * real file, not a re-implementation of it.
 *
 * Sections:
 *   A. Diagnostics OFF by default — zero footprint
 *   B. Enable Diagnostics — framework installs in full
 *   C. Persistence of the enabled/disabled preference
 *   D. Disable Diagnostics — button/panel torn down, pref persisted
 *   E. Dashboard summary counters
 *   F. Health status + counts
 *   G. Warnings surface (severity split)
 *   H. Export (json/txt/md) does not throw, produces distinct content
 *   I. Copy Runtime Report calls back
 *   J. Duplicate DOM node detection
 *   K. Duplicate repository record + soft-delete-resurrection detection
 *   L. Overlay detection (stacked large fixed/absolute elements)
 *   M. Render loop detection
 *   N. Double event listener detection
 *   O. DomRecycler statistics (external proxy)
 *   P. Auto Analysis / Smart Report content
 * ================================================================
 */
'use strict';
const { JSDOM } = require('jsdom');
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const RDL_PATH = path.join(__dirname, '..', 'debug', 'RuntimeDebugLayer.js');
const RDL_SRC = fs.readFileSync(RDL_PATH, 'utf8');

let pass = 0, fail = 0;
const failures = [];
function ok(cond, label) {
  if (cond) { pass++; }
  else { fail++; failures.push(label); console.log('FAIL — ' + label); }
}
function wait(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

function freshWindow(bodyHtml) {
  const dom = new JSDOM(
    `<!doctype html><html><head></head><body>${bodyHtml || ''}</body></html>`,
    { runScripts: 'outside-only', url: 'http://localhost/', pretendToBeVisual: true }
  );
  return dom.window;
}

function loadRDL(win) {
  win.eval(RDL_SRC);
}

function fireDCL(win) {
  const evt = new win.Event('DOMContentLoaded', { bubbles: true, cancelable: true });
  win.document.dispatchEvent(evt);
}

async function sectionA_offByDefault() {
  const win = freshWindow('');
  loadRDL(win);
  ok(typeof win.RuntimeDebug === 'object', 'A1: RuntimeDebug API exists even when OFF');
  ok(win.RuntimeDebug.isDiagnosticsEnabled() === false, 'A2: isDiagnosticsEnabled() is false by default');
  ok(win.RUNTIME_DEBUG === undefined, 'A3: RUNTIME_DEBUG global is never set while OFF');
  fireDCL(win);
  await wait(20);
  const rdButtons = Array.from(win.document.body.querySelectorAll('div')).filter((d) => d.textContent === 'RD');
  ok(rdButtons.length === 0, 'A4: no floating RD button exists while OFF');
  ok(win.localStorage.getItem('__RDL_SNAPSHOT_V1__') === null, 'A5: nothing persisted to localStorage while OFF');
  ok(win.RuntimeDebug.getSummary() === null, 'A6: getSummary() is a harmless null while OFF');
  ok(typeof win.RuntimeDebug.enable === 'function' && win.RuntimeDebug.enable() === undefined, 'A7: legacy enable()/disable() are safe no-ops while OFF');
}

async function sectionB_enableInstallsFully() {
  const win = freshWindow('');
  win.localStorage.setItem('__RDL_DIAGNOSTICS_ENABLED__', 'true');
  loadRDL(win);
  fireDCL(win);
  await wait(20);
  ok(win.RuntimeDebug.isDiagnosticsEnabled() === true, 'B1: isDiagnosticsEnabled() true once enabled pref is set');
  ok(win.RUNTIME_DEBUG === true, 'B2: recording auto-starts once Diagnostics is ON (no prior off-preference)');
  const rdButtons = Array.from(win.document.body.querySelectorAll('div')).filter((d) => d.textContent === 'RD');
  ok(rdButtons.length === 1, 'B3: floating RD button appears once Diagnostics is ON');
  ok(typeof win.RuntimeDebug.getHealth().status === 'string', 'B4: getHealth() returns a real health object once ON');
  return win;
}

async function sectionC_persistence() {
  const win1 = freshWindow('');
  win1.localStorage.setItem('__RDL_DIAGNOSTICS_ENABLED__', 'true');
  loadRDL(win1);
  fireDCL(win1);
  await wait(10);
  win1.console.error('synthetic test error for persistence check');
  win1.dispatchEvent(new win1.Event('beforeunload'));
  const snapshotRaw = win1.localStorage.getItem('__RDL_SNAPSHOT_V1__');
  ok(!!snapshotRaw, 'C1: ring buffer snapshot is written on beforeunload');

  // Simulate a reload: new window, but same localStorage contents carried
  // forward by hand (jsdom windows don't share storage automatically).
  const win2 = freshWindow('');
  win2.localStorage.setItem('__RDL_DIAGNOSTICS_ENABLED__', win1.localStorage.getItem('__RDL_DIAGNOSTICS_ENABLED__'));
  win2.localStorage.setItem('__RDL_SNAPSHOT_V1__', snapshotRaw);
  loadRDL(win2);
  fireDCL(win2);
  await wait(10);
  const log = win2.RuntimeDebug.getLog();
  ok(log.some((e) => e.category === 'Startup' && e.name === 'session:reloaded'), 'C2: carried-over events restored after simulated reload');
}

async function sectionD_disableTearsDown() {
  const win = await sectionB_enableInstallsFully();
  win.RuntimeDebug.disableDiagnostics();
  ok(win.localStorage.getItem('__RDL_DIAGNOSTICS_ENABLED__') === 'false', 'D1: disableDiagnostics() persists the OFF preference');
  ok(win.RUNTIME_DEBUG === false, 'D2: disableDiagnostics() stops recording immediately in the current session');
  const rdButtons = Array.from(win.document.body.querySelectorAll('div')).filter((d) => d.textContent === 'RD');
  ok(rdButtons.length === 0, 'D3: floating RD button is removed immediately on disableDiagnostics()');
}

async function sectionE_dashboard() {
  const win = freshWindow(
    '<div id="tasksListView"></div>'
  );
  win.localStorage.setItem('__RDL_DIAGNOSTICS_ENABLED__', 'true');
  win.renderTasks = function () {};
  loadRDL(win);
  fireDCL(win);
  await wait(10);
  win.renderTasks();
  win.renderTasks();
  const s = win.RuntimeDebug.getSummary();
  ok(s && typeof s.renders === 'object', 'E1: summary.renders exists');
  ok((s.renders.renderTasks || 0) >= 2, 'E2: dashboard counts renderTasks() calls');
  ok(typeof s.totalEvents === 'number' && s.totalEvents > 0, 'E3: dashboard totalEvents is populated');
}

async function sectionF_health() {
  const win = freshWindow('');
  win.localStorage.setItem('__RDL_DIAGNOSTICS_ENABLED__', 'true');
  loadRDL(win);
  fireDCL(win);
  await wait(10);
  const healthy = win.RuntimeDebug.getHealth();
  ok(['healthy', 'warning', 'critical'].indexOf(healthy.status) !== -1, 'F1: health.status is one of the three known states');
  ok(typeof healthy.icon === 'string' && healthy.icon.length > 0, 'F2: health.icon is set');
  win.console.error('synthetic error');
  const afterError = win.RuntimeDebug.getHealth();
  ok(afterError.status === 'critical', 'F3: a console error escalates health to critical');
}

async function sectionG_warnings() {
  const win = freshWindow('');
  win.localStorage.setItem('__RDL_DIAGNOSTICS_ENABLED__', 'true');
  loadRDL(win);
  fireDCL(win);
  await wait(10);
  const target = win.document.body;
  target.addEventListener('click', function () {});
  target.addEventListener('click', function () {}); // duplicate on purpose
  const problems = win.RuntimeDebug.getProblems();
  ok(problems.some((p) => p.severity === 'warning' && p.type === 'DoubleEventListener'), 'G1: a warning-severity problem is recorded for a duplicate listener');
}

async function sectionH_export() {
  const win = freshWindow('');
  win.localStorage.setItem('__RDL_DIAGNOSTICS_ENABLED__', 'true');
  loadRDL(win);
  fireDCL(win);
  await wait(10);
  let threw = false;
  try {
    win.RuntimeDebug.exportReport('json');
    win.RuntimeDebug.exportReport('txt');
    win.RuntimeDebug.exportReport('md');
  } catch (e) { threw = true; }
  ok(!threw, 'H1: exportReport() does not throw for json/txt/md formats');
  const report = win.RuntimeDebug.exportReport('json');
  ok(report && Array.isArray(report.events) && report.summary && report.health, 'H2: json export includes events + summary + health');
}

async function sectionI_copy() {
  const win = freshWindow('');
  win.localStorage.setItem('__RDL_DIAGNOSTICS_ENABLED__', 'true');
  loadRDL(win);
  fireDCL(win);
  await wait(10);
  let called = false, calledWith = null;
  win.RuntimeDebug.copyReport(function (result) { called = true; calledWith = result; });
  await wait(10);
  ok(called, 'I1: copyReport() always invokes its callback (clipboard API missing/unimplemented in jsdom is handled gracefully)');
  ok(typeof calledWith === 'boolean', 'I2: copyReport() callback receives a boolean success flag');
}

async function sectionJ_duplicateDom() {
  const win = freshWindow('<div id="tasksListView"></div>');
  win.localStorage.setItem('__RDL_DIAGNOSTICS_ENABLED__', 'true');
  loadRDL(win);
  fireDCL(win);
  await wait(10);
  const container = win.document.getElementById('tasksListView');
  const a = win.document.createElement('div');
  a.setAttribute('data-key', 'task-1');
  const b = win.document.createElement('div');
  b.setAttribute('data-key', 'task-1'); // same key = duplicate row
  container.appendChild(a);
  container.appendChild(b);
  await wait(30); // let the MutationObserver microtask/macrotask fire
  const problems = win.RuntimeDebug.getProblems();
  ok(problems.some((p) => p.type === 'DuplicateDomNode'), 'J1: duplicate data-key children are flagged as DuplicateDomNode');
}

async function sectionK_repositoryDetectors() {
  const win = freshWindow('');
  win.localStorage.setItem('__RDL_DIAGNOSTICS_ENABLED__', 'true');

  // Minimal fake Repository shaped exactly like the real contract this
  // wrapper depends on (entityKey + _records + async import/delete).
  function FakeRepo(entityKey) {
    this.entityKey = entityKey;
    this._records = [];
  }
  FakeRepo.prototype.import = function (records) {
    this._records = records.slice();
    return Promise.resolve({ success: true });
  };
  FakeRepo.prototype.delete = function (id) {
    this._records = this._records.filter((r) => r.id !== id);
    return Promise.resolve({ success: true });
  };
  FakeRepo.prototype.restore = function () { return Promise.resolve({ success: true }); };
  FakeRepo.prototype.create = function () { return Promise.resolve({ success: true }); };
  FakeRepo.prototype.update = function () { return Promise.resolve({ success: true }); };
  win.Repository = FakeRepo;

  loadRDL(win);
  fireDCL(win);
  await wait(10);

  const repo = new win.Repository('tasks');
  await repo.import([{ id: 1, deleted: false }, { id: 2, deleted: false }, { id: 2, deleted: false }]);
  await wait(5);
  let problems = win.RuntimeDebug.getProblems();
  ok(problems.some((p) => p.type === 'DuplicateRepositoryRecord'), 'K1: duplicate ids across records flagged as DuplicateRepositoryRecord');

  await repo.delete(1);
  await wait(5);
  await repo.import([{ id: 1, deleted: false }]); // id 1 resurrected active after being deleted
  await wait(5);
  problems = win.RuntimeDebug.getProblems();
  ok(problems.some((p) => p.type === 'SoftDeleteResurrection'), 'K2: a previously-deleted id reappearing active is flagged as SoftDeleteResurrection');
}

async function sectionL_overlayDetection() {
  const win = freshWindow('');
  win.localStorage.setItem('__RDL_DIAGNOSTICS_ENABLED__', 'true');
  Object.defineProperty(win, 'innerWidth', { value: 800, configurable: true });
  Object.defineProperty(win, 'innerHeight', { value: 600, configurable: true });
  loadRDL(win);
  fireDCL(win);
  await wait(10);

  function bigFixedOverlay() {
    const el = win.document.createElement('div');
    el.style.position = 'fixed';
    el.getBoundingClientRect = () => ({ width: 800, height: 600, top: 0, left: 0, right: 800, bottom: 600 });
    win.document.body.appendChild(el);
    return el;
  }
  bigFixedOverlay();
  bigFixedOverlay(); // two large overlays visible at once = the reported scenario

  await wait(3300); // one periodic tick (every 3s) is enough to run checkOverlayStack()
  const problems = win.RuntimeDebug.getProblems();
  ok(problems.some((p) => p.type === 'DomOverlayDetected'), 'L1: two simultaneous large fixed overlays are flagged as DomOverlayDetected');
}

async function sectionM_renderLoop() {
  const win = freshWindow('');
  win.localStorage.setItem('__RDL_DIAGNOSTICS_ENABLED__', 'true');
  win.renderCases = function () {};
  loadRDL(win);
  fireDCL(win);
  await wait(10);
  for (let i = 0; i < 25; i++) win.renderCases();
  const problems = win.RuntimeDebug.getProblems();
  ok(problems.some((p) => p.type === 'RenderLoop'), 'M1: calling the same render* function 25x rapidly is flagged as RenderLoop');
}

async function sectionN_doubleListenerViaWindow() {
  const win = freshWindow('');
  win.localStorage.setItem('__RDL_DIAGNOSTICS_ENABLED__', 'true');
  loadRDL(win);
  fireDCL(win);
  await wait(10);
  win.addEventListener('resize', function () {});
  win.addEventListener('resize', function () {});
  const problems = win.RuntimeDebug.getProblems();
  ok(problems.some((p) => p.type === 'DoubleEventListener' && p.detail && p.detail.target === 'window'), 'N1: duplicate listeners on window itself are also caught');
}

async function sectionO_domRecyclerStats() {
  const win = freshWindow('<div id="c1"></div>');
  win.localStorage.setItem('__RDL_DIAGNOSTICS_ENABLED__', 'true');
  win.DomRecycler = {
    reconcile: function (container, rows) {
      rows.forEach(() => container.appendChild(win.document.createElement('div')));
      return true;
    }
  };
  loadRDL(win);
  fireDCL(win);
  await wait(10);
  const container = win.document.getElementById('c1');
  win.DomRecycler.reconcile(container, [1, 2, 3]);
  await wait(5);
  const health = win.RuntimeDebug.getHealth();
  ok(health.domRecyclerStats.reconciles >= 1, 'O1: DomRecycler.reconcile() calls are counted');
  ok(health.domRecyclerStats.createdApprox >= 3, 'O2: external created-node proxy reflects the 3 rows added');
}

async function sectionP_autoAnalysisAndSmartReport() {
  const win = freshWindow('');
  win.localStorage.setItem('__RDL_DIAGNOSTICS_ENABLED__', 'true');
  win.renderClients = function () {};
  loadRDL(win);
  fireDCL(win);
  await wait(10);
  win.renderClients();
  win.console.error('boom');
  const text = win.RuntimeDebug.generateAnalysisReport();
  ['Root Cause Candidates', 'Timeline', 'Warnings', 'Performance', 'Suggestions'].forEach((section) => {
    ok(text.indexOf(section) !== -1, 'P1: Smart Report includes the "' + section + '" section');
  });
}

async function main() {
  await sectionA_offByDefault();
  await sectionB_enableInstallsFully();
  await sectionC_persistence();
  await sectionD_disableTearsDown();
  await sectionE_dashboard();
  await sectionF_health();
  await sectionG_warnings();
  await sectionH_export();
  await sectionI_copy();
  await sectionJ_duplicateDom();
  await sectionK_repositoryDetectors();
  await sectionL_overlayDetection();
  await sectionM_renderLoop();
  await sectionN_doubleListenerViaWindow();
  await sectionO_domRecyclerStats();
  await sectionP_autoAnalysisAndSmartReport();

  console.log('\n' + '='.repeat(70));
  console.log('PHASE 17.3.1 — Runtime Diagnostics Framework: ' + pass + ' passed, ' + fail + ' failed');
  console.log('='.repeat(70));
  if (fail > 0) {
    console.log('Failures:');
    failures.forEach((f) => console.log('  - ' + f));
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error('HARNESS ERROR:', err);
  process.exitCode = 1;
});
