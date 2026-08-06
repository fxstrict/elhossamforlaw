/**
 * verify_runtime_hooks.js — PHASE 17.4
 * ================================================================
 * Runtime Diagnostics Repair (DoubleEventListener + DomRecycler Hook Fix)
 * Standalone jsdom harness (`node js/tests/verify_runtime_hooks.js`).
 *
 * This file specifically targets the two proven root causes from Phase
 * 17.4 (see docs/phase17/PHASE_17_4_RUNTIME_DIAGNOSTICS_REPAIR_REPORT.md)
 * plus the hook-integrity/self-test/uninstall-reinstall machinery added
 * to fix them:
 *
 *   A. Every hook reports 'installed' on a normal load (nothing silently
 *      lost).
 *   B. No hook is ever wrapped twice (double-wrap guard).
 *   C. uninstall() fully restores late-patch wraps to their true
 *      originals.
 *   D. reinstall() after uninstall() re-wraps everything (and does not
 *      double-wrap on top of a stale reference).
 *   E. Repeated uninstall/reinstall cycles do not leak observers/
 *      intervals/entries in the true-originals ledger.
 *   F. DoubleEventListener regression: multiple independent modules
 *      registering the same event type on the same target is NOT
 *      flagged; the same call site registering twice IS flagged.
 *   G. DomRecycler regression: a throwing reconcile() is now observed
 *      (logged + counted) and still re-thrown unchanged to the caller.
 * ================================================================
 */
'use strict';
const { JSDOM } = require('jsdom');
const fs = require('fs');
const path = require('path');

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
function loadRDL(win) { win.eval(RDL_SRC); }
function fireDCL(win) {
  win.document.dispatchEvent(new win.Event('DOMContentLoaded', { bubbles: true, cancelable: true }));
}

function makeFakeRepo(win) {
  function FakeRepo(entityKey) { this.entityKey = entityKey; this._records = []; }
  FakeRepo.prototype.import = function (records) { this._records = records.slice(); return Promise.resolve({ success: true }); };
  FakeRepo.prototype.delete = function (id) { this._records = this._records.filter((r) => r.id !== id); return Promise.resolve({ success: true }); };
  FakeRepo.prototype.restore = function () { return Promise.resolve({ success: true }); };
  FakeRepo.prototype.create = function () { return Promise.resolve({ success: true }); };
  FakeRepo.prototype.update = function () { return Promise.resolve({ success: true }); };
  win.Repository = FakeRepo;
}

function makeFakeDomRecycler(win, opts) {
  opts = opts || {};
  win.DomRecycler = {
    reconcile: function (container, rows) {
      if (opts.throwOnReconcile) throw new Error('synthetic-key-collision');
      rows.forEach(() => container.appendChild(win.document.createElement('div')));
      return true;
    }
  };
}

async function sectionA_noHookLost() {
  const win = freshWindow('<div id="c1"></div>');
  win.localStorage.setItem('__RDL_DIAGNOSTICS_ENABLED__', 'true');
  win.renderTasks = function () {};
  win.deleteTask = function () {};
  makeFakeRepo(win);
  makeFakeDomRecycler(win);
  win.ApiService = { loadData: function () { return Promise.resolve({}); } };
  loadRDL(win);
  fireDCL(win);
  await wait(20);

  const integ = win.RuntimeDebug.getIntegrity();
  ok(integ.hooksFailed === 0, 'A1: zero hooks report "failed" on a normal load');
  ok(integ.eventHookStatus === 'installed', 'A2: event hook installed');
  ok(integ.timersHookStatus === 'installed', 'A3: timers hook installed');
  ok(integ.consoleHookStatus === 'installed', 'A4: console hook installed');
  ok(integ.storageHookStatus === 'installed', 'A5: storage hook installed');
  ok(integ.fetchHookStatus === 'installed', 'A6: fetch hook installed');
  ok(integ.domRecyclerHookStatus === 'installed', 'A7: DomRecycler hook installed (fake present)');
  ok(integ.repositoryHookStatus === 'installed', 'A8: Repository hook installed (fake present)');
  ok(integ.apiHookStatus === 'installed', 'A9: API hook installed (fake present)');
  ok(integ.renderHookStatus.installed >= 1, 'A10: at least one render* hook installed');
  ok(integ.deleteHookStatus.installed >= 1, 'A11: at least one delete* hook installed');

  const selfTest = win.RuntimeDebug.runSelfTest();
  ok(selfTest.failed === 0, 'A12: Self Test reports zero FAILs on a healthy load');
  return win;
}

async function sectionB_noDoubleWrap() {
  const win = freshWindow('');
  win.localStorage.setItem('__RDL_DIAGNOSTICS_ENABLED__', 'true');
  makeFakeRepo(win);
  makeFakeDomRecycler(win);
  loadRDL(win);
  fireDCL(win);
  await wait(10);

  const reconcileBefore = win.DomRecycler.reconcile;
  const importBefore = win.Repository.prototype.import;
  win.RuntimeDebug.reinstall(); // must be a no-op for already-wrapped hooks
  await wait(10);
  ok(win.DomRecycler.reconcile === reconcileBefore, 'B1: reinstall() on an already-installed hook does not re-wrap DomRecycler.reconcile');
  ok(win.Repository.prototype.import === importBefore, 'B2: reinstall() on an already-installed hook does not re-wrap Repository.prototype.import');
}

async function sectionC_uninstallRestoresOriginals() {
  const win = freshWindow('');
  win.localStorage.setItem('__RDL_DIAGNOSTICS_ENABLED__', 'true');
  makeFakeRepo(win);
  makeFakeDomRecycler(win);
  win.renderTasks = function () {};
  loadRDL(win);
  fireDCL(win);
  await wait(10);

  ok(win.DomRecycler.reconcile.__rdlWrapped === true, 'C0 (setup check): DomRecycler.reconcile is wrapped before uninstall');
  win.RuntimeDebug.uninstall();
  ok(win.DomRecycler.reconcile.__rdlWrapped !== true, 'C1: DomRecycler.reconcile is the true original after uninstall()');
  ok(win.Repository.prototype.import.__rdlWrapped !== true, 'C2: Repository.prototype.import is the true original after uninstall()');
  ok(win.renderTasks.__rdlWrapped !== true, 'C3: renderTasks is the true original after uninstall()');
  const integAfter = win.RuntimeDebug.getIntegrity();
  ok(integAfter.hooksInstalled === 0, 'C4: getIntegrity() reports zero installed hooks after uninstall()');

  // Behavior must be unaffected: reconcile still does its real job.
  const container = win.document.createElement('div');
  win.DomRecycler.reconcile(container, [1, 2, 3]);
  ok(container.children.length === 3, 'C5: DomRecycler.reconcile still works correctly (unwrapped) after uninstall()');
}

async function sectionD_reinstallAfterUninstall() {
  const win = freshWindow('');
  win.localStorage.setItem('__RDL_DIAGNOSTICS_ENABLED__', 'true');
  makeFakeRepo(win);
  makeFakeDomRecycler(win);
  loadRDL(win);
  fireDCL(win);
  await wait(10);
  win.RuntimeDebug.uninstall();
  await wait(10);
  win.RuntimeDebug.reinstall();
  await wait(10);
  ok(win.DomRecycler.reconcile.__rdlWrapped === true, 'D1: DomRecycler.reconcile is wrapped again after reinstall()');
  ok(win.Repository.prototype.import.__rdlWrapped === true, 'D2: Repository.prototype.import is wrapped again after reinstall()');
  const integ = win.RuntimeDebug.getIntegrity();
  ok(integ.hooksInstalled > 0, 'D3: getIntegrity() reports installed hooks again after reinstall()');
}

async function sectionE_noLeakOverCycles() {
  const win = freshWindow('');
  win.localStorage.setItem('__RDL_DIAGNOSTICS_ENABLED__', 'true');
  makeFakeRepo(win);
  makeFakeDomRecycler(win);
  loadRDL(win);
  fireDCL(win);
  await wait(10);

  for (let i = 0; i < 5; i++) {
    win.RuntimeDebug.uninstall();
    await wait(5);
    win.RuntimeDebug.reinstall();
    await wait(5);
  }
  const integ = win.RuntimeDebug.getIntegrity();
  ok(integ.observersInstalled <= 10, 'E1: observer count stays bounded after 5 uninstall/reinstall cycles (got ' + integ.observersInstalled + ')');
  ok(integ.intervalsRunning <= 2, 'E2: live-interval estimate stays bounded after 5 cycles (got ' + integ.intervalsRunning + ')');
  const rawKeys = Object.keys(integ.raw);
  const dupeCheck = {};
  let anyDuplicateHookKey = false;
  rawKeys.forEach((k) => { if (dupeCheck[k]) anyDuplicateHookKey = true; dupeCheck[k] = true; });
  ok(!anyDuplicateHookKey, 'E3: hook-status ledger has no duplicate keys after repeated cycles');
}

async function sectionF_doubleListenerRegression() {
  const win = freshWindow('');
  win.localStorage.setItem('__RDL_DIAGNOSTICS_ENABLED__', 'true');
  loadRDL(win);
  fireDCL(win);
  await wait(10);

  // Simulate "three independent modules each add their own listener" —
  // this is exactly the pattern the OLD detector falsely flagged.
  function moduleA() { win.addEventListener('customEvt', function () {}); }
  function moduleB() { win.addEventListener('customEvt', function () {}); }
  function moduleC() { win.addEventListener('customEvt', function () {}); }
  moduleA(); moduleB(); moduleC();

  let problems = win.RuntimeDebug.getProblems();
  const falsePositives = problems.filter((p) => p.type === 'DoubleEventListener' && p.detail && p.detail.type === 'customEvt');
  ok(falsePositives.length === 0, 'F1: three different call sites adding the same event type on the same target are NOT flagged');

  // Now the real bug pattern: the SAME call site (function) re-registers
  // on the SAME target without removing the old listener first. Using a
  // loop (not three separate literal statements) guarantees these calls
  // originate from the exact same source position every time, so the
  // test isn't sensitive to column-level stack-trace granularity.
  function reInitBug() { win.addEventListener('reinit-leak', function () {}); }
  for (let i = 0; i < 3; i++) reInitBug();
  problems = win.RuntimeDebug.getProblems();
  const realDuplicates = problems.filter((p) => p.type === 'DoubleEventListener' && p.detail && p.detail.type === 'reinit-leak');
  ok(realDuplicates.length >= 1, 'F2: the same call site re-registering on the same target IS flagged as DoubleEventListener');
}

async function sectionG_domRecyclerThrowVisibility() {
  const win = freshWindow('');
  win.localStorage.setItem('__RDL_DIAGNOSTICS_ENABLED__', 'true');
  makeFakeDomRecycler(win, { throwOnReconcile: true });
  loadRDL(win);
  fireDCL(win);
  await wait(10);

  const container = win.document.createElement('div');
  let caught = null;
  try {
    win.DomRecycler.reconcile(container, [1, 2]);
  } catch (e) {
    caught = e;
  }
  ok(!!caught && caught.message === 'synthetic-key-collision', 'G1: a throwing reconcile() still throws the SAME error to the caller (behavior unchanged)');

  const health = win.RuntimeDebug.getHealth();
  ok(health.domRecyclerStats.reconciles === 0, 'G2: a failed reconcile() does NOT increment the success counter');
  ok(health.domRecyclerStats.reconcileErrors === 1, 'G3: a failed reconcile() DOES increment the new reconcileErrors counter (this is the Phase 17.4 fix)');

  const problems = win.RuntimeDebug.getProblems();
  ok(problems.some((p) => p.type === 'DomRecyclerReconcileThrew'), 'G4: the failure is surfaced as a critical DomRecyclerReconcileThrew problem');
}

async function main() {
  await sectionA_noHookLost();
  await sectionB_noDoubleWrap();
  await sectionC_uninstallRestoresOriginals();
  await sectionD_reinstallAfterUninstall();
  await sectionE_noLeakOverCycles();
  await sectionF_doubleListenerRegression();
  await sectionG_domRecyclerThrowVisibility();

  console.log('\n' + '='.repeat(70));
  console.log('PHASE 17.4 — Runtime Hooks Repair: ' + pass + ' passed, ' + fail + ' failed');
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
