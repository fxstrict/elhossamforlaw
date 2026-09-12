/**
 * ================================================================
 * PHASE_F3_2B4_readiness_tests.js — نظام الحسام للمحاماة
 * ================================================================
 * Standalone Node harness (`node js/tests/PHASE_F3_2B4_readiness_tests.js`,
 * no browser required). Covers the minimum required cases for the
 * offline/weak-network Office Setup flash fix:
 *   - js/office/OfficeProfileService.js (changed: bootstrap() now awaits
 *     the genuine settingsRepositoryOpenPromise instead of the
 *     12s-bounded settingsRepositoryReadyPromise; new: isRepositoryReady())
 *   - js/office/OfficeSetupWizard.js    (changed: _evaluate() never calls
 *     show() while the repository is not genuinely ready)
 *
 * Each test builds a fresh vm sandbox so bootstrap()'s memoization never
 * leaks between cases, exactly like PHASE_B_bootstrap_race_tests.js.
 * ================================================================
 */
'use strict';

const path = require('path');
const fs = require('fs');
const vm = require('vm');

let passed = 0, failed = 0;
const log = [];
function check(label, cond) {
  if (cond) { passed++; log.push('PASS: ' + label); }
  else { failed++; log.push('FAIL: ' + label); }
}

const API_PATH = path.join(__dirname, '..', 'api', 'api.js');
const OPS_PATH = path.join(__dirname, '..', 'office', 'OfficeProfileService.js');
const OSW_PATH = path.join(__dirname, '..', 'office', 'OfficeSetupWizard.js');

// Minimal fake DOM, reused from PHASE_B_bootstrap_race_tests.js's own
// pattern: enough for OfficeSetupWizard.js's build()/show()/hide() to run.
function makeFakeDocument() {
  function FakeElement(tag) {
    this.tag = tag;
    this._attrs = {};
    this._byId = {};
    this._listeners = {};
    this.children = [];
    this.value = '';
    this.textContent = '';
    this.classList = {
      _set: new Set(),
      add: function (c) { this._set.add(c); },
      remove: function (c) { this._set.delete(c); },
      contains: function (c) { return this._set.has(c); }
    };
  }
  Object.defineProperty(FakeElement.prototype, 'innerHTML', {
    get: function () { return this._innerHTML || ''; },
    set: function (html) {
      this._innerHTML = html;
      const re = /id="([^"]+)"/g;
      let m;
      while ((m = re.exec(html))) {
        if (!this._byId[m[1]]) this._byId[m[1]] = new FakeElement('div');
      }
    }
  });
  FakeElement.prototype.setAttribute = function (name, val) { this._attrs[name] = val; };
  FakeElement.prototype.removeAttribute = function (name) { delete this._attrs[name]; };
  FakeElement.prototype.getAttribute = function (name) { return this._attrs[name]; };
  FakeElement.prototype.hasAttribute = function (name) { return name in this._attrs; };
  FakeElement.prototype.appendChild = function (child) { this.children.push(child); return child; };
  FakeElement.prototype.addEventListener = function (type, fn) {
    (this._listeners[type] = this._listeners[type] || []).push(fn);
  };
  FakeElement.prototype.querySelector = function (sel) {
    const id = sel.replace('#', '');
    return this._byId[id] || null;
  };

  const body = new FakeElement('body');
  return {
    createElement: function (tag) { return new FakeElement(tag); },
    body: body,
    getElementById: function (id) { return null; }
  };
}

function runFile(context, filePath) {
  vm.runInContext(fs.readFileSync(filePath, 'utf8'), context, { filename: filePath });
}

// Minimal fake window event bus, same shape as
// PHASE_B_bootstrap_race_tests.js's makeFakeWindow() — needed since
// OfficeSetupWizard.js's init() wires window.addEventListener/
// dispatchEvent for the 'license:state' event.
function addFakeWindowEventBus(sandbox) {
  const listeners = {};
  sandbox.addEventListener = function (type, fn) { (listeners[type] = listeners[type] || []).push(fn); };
  sandbox.dispatchEvent = function (evt) { (listeners[evt.type] || []).forEach(function (fn) { fn(evt); }); };
  sandbox.CustomEvent = function (type, opts) { this.type = type; this.detail = opts && opts.detail; };
  return sandbox;
}

(async () => {

  // ------------------------------------------------------------------
  // R1 — Repository not genuinely ready (open() still pending, e.g. a
  // slow/blocked IndexedDB open that the 12s StartupTimeoutManager wrap
  // would otherwise paper over): _evaluate() must NOT infer
  // "NOT_CONFIGURED" and must NOT call show().
  // ------------------------------------------------------------------
  {
    let resolveOpen;
    const openPromise = new Promise(function (resolve) { resolveOpen = resolve; });
    const fakeDoc = makeFakeDocument();
    let repoReady = false;
    const sandbox = {
      document: fakeDoc, console: console,
      window: undefined,
      settingsRepository: { isReady: () => repoReady, get: () => undefined, set: () => Promise.resolve() },
      // Genuinely pending — simulates open() not having finished yet.
      settingsRepositoryOpenPromise: openPromise,
      // Simulates StartupTimeoutManager already having resolved the
      // bounded promise early, BEFORE the repository is actually ready.
      settingsRepositoryReadyPromise: Promise.resolve(),
      API_URL: '',
      AbortSignal: { timeout: function () { return undefined; } }
    };
    sandbox.window = sandbox;
    addFakeWindowEventBus(sandbox);
    const context = vm.createContext(sandbox);
    runFile(context, API_PATH);
    runFile(context, OPS_PATH);
    runFile(context, OSW_PATH);

    context.window.LicenseCore = {
      getStatus: function () { return { state: 'ACTIVE' }; }
    };
    context.window.OfficeSetupWizard.init();

    // Give pending microtasks a chance to run while open() is still
    // unresolved.
    await new Promise((r) => setTimeout(r, 20));
    check('R1: overlay stays hidden while repository open() is pending',
      context.window.document.body.children.length === 0 ||
      context.window.document.body.children.every(function (el) { return el.hasAttribute('hidden'); }));
    check('R1: isRepositoryReady() correctly reports false while pending',
      context.window.OfficeProfileService.isRepositoryReady() === false);

    // Now let the repository genuinely finish opening, with valid local
    // office data already present.
    repoReady = true;
    sandbox.settingsRepository.get = function (k) {
      if (k !== 'officeProfile') return undefined;
      return JSON.stringify({ officeName: 'مكتب قائم', lawyerName: 'محامٍ قائم', address: '', branches: '', phones: '', whatsapp: '' });
    };
    resolveOpen();
    await new Promise((r) => setTimeout(r, 20));

    check('R1: isRepositoryReady() reports true once open() genuinely resolves',
      context.window.OfficeProfileService.isRepositoryReady() === true);
  }

  // ------------------------------------------------------------------
  // R2 — Existing configured office + repository genuinely ready +
  // network unavailable (offline/weak internet): overlay must never be
  // shown at all (no flash).
  // ------------------------------------------------------------------
  {
    const store = { officeProfile: JSON.stringify({ officeName: 'مكتب أوفلاين', lawyerName: 'محامي أوفلاين', address: '', branches: '', phones: '', whatsapp: '' }) };
    const fakeDoc = makeFakeDocument();
    const sandbox = {
      document: fakeDoc, console: console,
      window: undefined,
      settingsRepository: { isReady: () => true, get: (k) => store[k], set: (k, v) => { store[k] = v; return Promise.resolve(); } },
      settingsRepositoryOpenPromise: Promise.resolve(),
      settingsRepositoryReadyPromise: Promise.resolve(),
      API_URL: 'https://script.google.com/macros/s/FAKE/exec',
      AbortSignal: { timeout: function () { return undefined; } },
      fetch: function () { return Promise.reject(new Error('offline')); }
    };
    sandbox.window = sandbox;
    addFakeWindowEventBus(sandbox);
    const context = vm.createContext(sandbox);
    runFile(context, API_PATH);
    runFile(context, OPS_PATH);
    runFile(context, OSW_PATH);

    context.window.LicenseCore = { getStatus: function () { return { state: 'ACTIVE' }; } };
    context.window.OfficeSetupWizard.init();
    await new Promise((r) => setTimeout(r, 20));

    check('R2: repository reports ready', context.window.OfficeProfileService.isRepositoryReady() === true);
    check('R2: local office remains configured despite offline server', context.window.OfficeProfileService.isConfigured() === true);
    check('R2: overlay never shown for an already-configured offline install',
      context.window.document.body.children.every(function (el) { return el.hasAttribute('hidden'); }));
  }

  // ------------------------------------------------------------------
  // R3 — Genuine new installation (no local data), repository ready,
  // server confirms no office: Setup screen must still appear normally
  // (the fix must not suppress legitimate first-run Setup).
  // ------------------------------------------------------------------
  {
    const fakeDoc = makeFakeDocument();
    const sandbox = {
      document: fakeDoc, console: console,
      window: undefined,
      settingsRepository: { isReady: () => true, get: () => undefined, set: () => Promise.resolve() },
      settingsRepositoryOpenPromise: Promise.resolve(),
      settingsRepositoryReadyPromise: Promise.resolve(),
      API_URL: 'https://script.google.com/macros/s/FAKE/exec',
      AbortSignal: { timeout: function () { return undefined; } },
      fetch: function () { return Promise.resolve({ ok: true, status: 200, json: async () => ([]), clone: function () { return this; } }); }
    };
    sandbox.window = sandbox;
    addFakeWindowEventBus(sandbox);
    const context = vm.createContext(sandbox);
    runFile(context, API_PATH);
    runFile(context, OPS_PATH);
    runFile(context, OSW_PATH);

    context.window.LicenseCore = { getStatus: function () { return { state: 'ACTIVE' }; } };
    context.window.OfficeSetupWizard.init();
    await new Promise((r) => setTimeout(r, 20));

    check('R3: new installation still shows Office Setup',
      context.window.document.body.children.some(function (el) { return !el.hasAttribute('hidden'); }));
  }

  console.log(log.join('\n'));
  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed === 0 ? 0 : 1);
})();
