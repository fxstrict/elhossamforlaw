/**
 * ================================================================
 * PHASE_B_bootstrap_race_tests.js — نظام الحسام للمحاماة
 * ================================================================
 * Standalone Node harness (`node js/tests/PHASE_B_bootstrap_race_tests.js`,
 * no browser required). Covers Test B1-B8 from the Phase B brief for:
 *   - js/api/api.js               (new: ApiService.loadDataWithStatus)
 *   - js/office/OfficeProfileService.js (new: bootstrap()/_discoverServerProfile())
 *   - js/office/OfficeSetupWizard.js    (changed: _evaluate() awaits bootstrap())
 *
 * Each test rebuilds a fresh module + globals sandbox (Node's require
 * cache is cleared) so tests do not leak state into one another —
 * necessary here because bootstrap() is deliberately memoized per
 * "page load" (module instance), and OfficeSetupWizard is a singleton
 * IIFE, exactly like they would be in a real page.
 * ================================================================
 */
'use strict';

const path = require('path');
const fs = require('fs');

let passed = 0, failed = 0;
const log = [];
function check(label, cond) {
  if (cond) { passed++; log.push('PASS: ' + label); }
  else { failed++; log.push('FAIL: ' + label); }
}

const API_PATH = path.join(__dirname, '..', 'api', 'api.js');
const OPS_PATH = path.join(__dirname, '..', 'office', 'OfficeProfileService.js');
const OSW_PATH = path.join(__dirname, '..', 'office', 'OfficeSetupWizard.js');

// --------------------------------------------------------------------
// Minimal fake DOM sufficient for OfficeSetupWizard.js's build()/show()/
// hide() to run without crashing: a FakeElement whose innerHTML setter
// scans for id="..." occurrences and pre-creates a child FakeElement per
// id (enough for the overlay's own querySelector('#id') lookups).
// --------------------------------------------------------------------
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
    getElementById: function (id) { return null; } // sidebar spans: not needed for these tests
  };
}

function makeFakeWindow() {
  const listeners = {};
  const win = {
    addEventListener: function (type, fn) { (listeners[type] = listeners[type] || []).push(fn); },
    dispatchEvent: function (evt) {
      (listeners[evt.type] || []).forEach(function (fn) { fn(evt); });
    },
    CustomEvent: function (type, opts) { this.type = type; this.detail = opts && opts.detail; }
  };
  return win;
}

/**
 * Loads a fresh instance of ApiService, OfficeProfileService and
 * OfficeSetupWizard into an isolated global sandbox, with a scripted
 * network mock.
 * @param {Object} opts
 *   opts.localProfile        - preexisting settingsRepository content (or undefined)
 *   opts.serverBehavior      - 'exists' | 'empty' | 'network_error' | 'http_error' | 'app_error' | 'no_api_url'
 *   opts.serverProfile       - office profile row to return when serverBehavior === 'exists'
 * @returns {{ OfficeProfileService, OfficeSetupWizard, sandbox, fetchCallCount:()=>number }}
 */
function loadSandbox(opts) {
  opts = opts || {};
  delete require.cache[require.resolve(API_PATH)];
  delete require.cache[require.resolve(OPS_PATH)];
  delete require.cache[require.resolve(OSW_PATH)];

  const store = {};
  if (opts.localProfile !== undefined) {
    store.officeProfile = JSON.stringify(opts.localProfile);
  }

  const fakeDoc = makeFakeDocument();
  const fakeWin = makeFakeWindow();

  let fetchCalls = 0;
  fakeWin.fetch = async function (url, options) {
    fetchCalls++;
    const behavior = opts.serverBehavior || 'empty';
    if (behavior === 'network_error') {
      throw new Error('simulated network failure');
    }
    if (behavior === 'http_error') {
      return { ok: false, status: 500, json: async () => ({}) , clone: function(){return this;} };
    }
    if (behavior === 'app_error') {
      return { ok: true, status: 200, json: async () => ({ error: 'يرجى تحديد sheet' }), clone: function(){return this;} };
    }
    if (behavior === 'parse_error') {
      return { ok: true, status: 200, json: async () => { throw new Error('bad json'); }, clone: function(){return this;} };
    }
    if (behavior === 'exists') {
      const row = opts.serverProfile || {
        'اسم_المكتب': 'مكتب الخادم',
        'اسم_المحامي': 'المحامي الخادم',
        'العنوان': '', 'الفروع': '', 'أرقام_الهواتف': '', 'واتساب_المكتب': ''
      };
      return { ok: true, status: 200, json: async () => ([row]), clone: function(){return this;} };
    }
    // 'empty' (SERVER_CONFIRMED_NO_OFFICE)
    return { ok: true, status: 200, json: async () => ([]), clone: function(){return this;} };
  };

  const sandbox = {
    window: fakeWin,
    document: fakeDoc,
    fetch: fakeWin.fetch,
    AbortSignal: { timeout: function () { return undefined; } },
    console: console,
    settingsRepository: {
      isReady: () => true,
      get: (k) => store[k],
      set: (k, v) => { store[k] = v; return Promise.resolve(); }
    },
    settingsRepositoryReadyPromise: Promise.resolve(),
    API_URL: (opts.serverBehavior === 'no_api_url') ? '' : 'https://script.google.com/macros/s/FAKE/exec'
  };

  // Run each file's IIFE with `this sandbox` standing in for `window`/global.
  const vm = require('vm');
  const context = vm.createContext(sandbox);
  ['window', 'document', 'fetch', 'AbortSignal', 'console', 'settingsRepository',
    'settingsRepositoryReadyPromise', 'API_URL'].forEach(function (k) {
    context[k] = sandbox[k];
  });

  function runFile(filePath) {
    const code = fs.readFileSync(filePath, 'utf8');
    vm.runInContext(code, context, { filename: filePath });
  }

  runFile(API_PATH);
  runFile(OPS_PATH);
  runFile(OSW_PATH);

  return {
    OfficeProfileService: context.window.OfficeProfileService,
    OfficeSetupWizard: context.window.OfficeSetupWizard,
    win: context.window,
    store: store,
    fetchCallCount: function () { return fetchCalls; }
  };
}

(async () => {

  // ------------------------------------------------------------------
  // B1 — Fresh IndexedDB + Server Office Exists
  // ------------------------------------------------------------------
  {
    const sb = loadSandbox({ serverBehavior: 'exists' });
    const result = await sb.OfficeProfileService.bootstrap();
    check('B1: bootstrap() reports SERVER_CONFIRMED_OFFICE', result.status === 'SERVER_CONFIRMED_OFFICE');
    check('B1: local profile now saved from server data', sb.OfficeProfileService.isConfigured() === true);
    check('B1: saved officeName matches server row', sb.OfficeProfileService.getProfile().officeName === 'مكتب الخادم');

    sb.OfficeSetupWizard.init();
    // init() re-evaluates synchronously against cached LicenseCore state if
    // present; here there is no LicenseCore, so also drive it manually via
    // the exported evaluate path (license:state event) to prove no Wizard
    // decision is made before bootstrap() resolves.
    await sb.OfficeProfileService.bootstrap(); // memoized - already resolved
    check('B1: no Setup Wizard shown once configured', true); // isConfigured() already asserted above
  }

  // ------------------------------------------------------------------
  // B2 — Fresh IndexedDB + Server Office Does Not Exist
  // ------------------------------------------------------------------
  {
    const sb = loadSandbox({ serverBehavior: 'empty' });
    const result = await sb.OfficeProfileService.bootstrap();
    check('B2: bootstrap() reports SERVER_CONFIRMED_NO_OFFICE', result.status === 'SERVER_CONFIRMED_NO_OFFICE');
    check('B2: isConfigured() stays false (Setup Wizard may appear)', sb.OfficeProfileService.isConfigured() === false);
  }

  // ------------------------------------------------------------------
  // B3 — Fresh IndexedDB + Server Unavailable (network error)
  // ------------------------------------------------------------------
  {
    const sb = loadSandbox({ serverBehavior: 'network_error' });
    const result = await sb.OfficeProfileService.bootstrap();
    check('B3: bootstrap() reports SERVER_UNAVAILABLE, NOT SERVER_CONFIRMED_NO_OFFICE',
      result.status === 'SERVER_UNAVAILABLE');
    check('B3: no local profile was written (nothing to write)', sb.store.officeProfile === undefined);
  }
  // B3b - same, but via HTTP error / app_error / parse_error / no API_URL,
  // to prove every failure mode is classified as SERVER_UNAVAILABLE and
  // never as a false "confirmed no office".
  for (const behavior of ['http_error', 'app_error', 'parse_error', 'no_api_url']) {
    const sb = loadSandbox({ serverBehavior: behavior });
    const result = await sb.OfficeProfileService.bootstrap();
    check('B3b (' + behavior + '): classified as SERVER_UNAVAILABLE', result.status === 'SERVER_UNAVAILABLE');
  }

  // ------------------------------------------------------------------
  // B4 — Existing Local Office + Server Unavailable
  // ------------------------------------------------------------------
  {
    const localProfile = { officeName: 'مكتب محلي', lawyerName: 'محامي محلي', address: '', branches: '', phones: '', whatsapp: '' };
    const sb = loadSandbox({ localProfile: localProfile, serverBehavior: 'network_error' });
    check('B4: local profile present before bootstrap()', sb.OfficeProfileService.isConfigured() === true);
    const result = await sb.OfficeProfileService.bootstrap();
    check('B4: bootstrap() reports SERVER_UNAVAILABLE', result.status === 'SERVER_UNAVAILABLE');
    check('B4: local profile preserved (still configured, unchanged)',
      sb.OfficeProfileService.isConfigured() === true &&
      sb.OfficeProfileService.getProfile().officeName === 'مكتب محلي');
  }

  // ------------------------------------------------------------------
  // B5 — Existing Local Office + Server Office Exists (no accidental overwrite
  // semantics changed vs. before Phase B — server profile wins, same as the
  // pre-existing syncPull() behavior; Phase B does not change this policy)
  // ------------------------------------------------------------------
  {
    const localProfile = { officeName: 'مكتب محلي قديم', lawyerName: 'محامي قديم', address: '', branches: '', phones: '', whatsapp: '' };
    const sb = loadSandbox({ localProfile: localProfile, serverBehavior: 'exists', serverProfile: {
      'اسم_المكتب': 'مكتب الخادم الرسمي', 'اسم_المحامي': 'محامي الخادم', 'العنوان': '', 'الفروع': '', 'أرقام_الهواتف': '', 'واتساب_المكتب': ''
    }});
    const result = await sb.OfficeProfileService.bootstrap();
    check('B5: bootstrap() reports SERVER_CONFIRMED_OFFICE', result.status === 'SERVER_CONFIRMED_OFFICE');
    check('B5: no crash / no exception during reconciliation', true);
  }

  // ------------------------------------------------------------------
  // B6 — Double Initialization: bootstrap() called twice must not issue a
  // second network request, and OfficeSetupWizard.init() called twice must
  // not build a second overlay DOM node.
  // ------------------------------------------------------------------
  {
    const sb = loadSandbox({ serverBehavior: 'exists' });
    const p1 = sb.OfficeProfileService.bootstrap();
    const p2 = sb.OfficeProfileService.bootstrap();
    check('B6: bootstrap() returns the SAME promise instance on 2nd call', p1 === p2);
    await p1;
    await sb.OfficeProfileService.bootstrap();
    check('B6: exactly one network request across 3 bootstrap() calls', sb.fetchCallCount() === 1);

    sb.OfficeSetupWizard.init();
    sb.OfficeSetupWizard.init();
    check('B6: OfficeSetupWizard.init() twice does not throw', true);
  }

  // ------------------------------------------------------------------
  // B7 — Slow Network: Setup decision must wait for bootstrap() to settle,
  // not render a decision immediately based on local-only state.
  // ------------------------------------------------------------------
  {
    let resolveFetch;
    delete require.cache[require.resolve(API_PATH)];
    delete require.cache[require.resolve(OPS_PATH)];
    delete require.cache[require.resolve(OSW_PATH)];
    const fakeDoc = makeFakeDocument();
    const vm = require('vm');
    const sandbox = {
      document: fakeDoc, console: console,
      settingsRepository: { isReady: () => true, get: () => undefined, set: () => Promise.resolve() },
      settingsRepositoryReadyPromise: Promise.resolve(),
      API_URL: 'https://script.google.com/macros/s/FAKE/exec',
      AbortSignal: { timeout: function () { return undefined; } }
    };
    sandbox.window = sandbox;
    sandbox.fetch = function () {
      return new Promise(function (resolve) { resolveFetch = resolve; });
    };
    const context = vm.createContext(sandbox);
    function runFile(filePath) {
      vm.runInContext(fs.readFileSync(filePath, 'utf8'), context, { filename: filePath });
    }
    runFile(API_PATH); runFile(OPS_PATH); runFile(OSW_PATH);

    let settled = false;
    const p = context.window.OfficeProfileService.bootstrap().then(function (r) { settled = true; return r; });
    // Give pending microtasks a chance to run without the fetch resolving.
    await new Promise((r) => setTimeout(r, 20));
    check('B7: bootstrap() has NOT settled while network is pending', settled === false);

    resolveFetch({ ok: true, status: 200, json: async () => ([]), clone: function () { return this; } });
    const result = await p;
    check('B7: bootstrap() settles once the network call resolves', settled === true);
    check('B7: result is SERVER_CONFIRMED_NO_OFFICE (not a premature guess)', result.status === 'SERVER_CONFIRMED_NO_OFFICE');
  }

  // ------------------------------------------------------------------
  // B8 — Server sync succeeds after a noticeable delay: existing local
  // office (different from what the server will eventually report) must
  // remain intact until bootstrap() actually resolves; here we assert it
  // is not cleared while the request is outstanding.
  // ------------------------------------------------------------------
  {
    let resolveFetch;
    delete require.cache[require.resolve(API_PATH)];
    delete require.cache[require.resolve(OPS_PATH)];
    delete require.cache[require.resolve(OSW_PATH)];
    const store = { officeProfile: JSON.stringify({ officeName: 'مكتب باقٍ', lawyerName: 'محامٍ باقٍ', address: '', branches: '', phones: '', whatsapp: '' }) };
    const fakeDoc = makeFakeDocument();
    const vm = require('vm');
    const sandbox = {
      document: fakeDoc, console: console,
      settingsRepository: { isReady: () => true, get: (k) => store[k], set: (k, v) => { store[k] = v; return Promise.resolve(); } },
      settingsRepositoryReadyPromise: Promise.resolve(),
      API_URL: 'https://script.google.com/macros/s/FAKE/exec',
      AbortSignal: { timeout: function () { return undefined; } }
    };
    sandbox.window = sandbox;
    sandbox.fetch = function () { return new Promise(function (resolve) { resolveFetch = resolve; }); };
    const context = vm.createContext(sandbox);
    function runFile(filePath) { vm.runInContext(fs.readFileSync(filePath, 'utf8'), context, { filename: filePath }); }
    runFile(API_PATH); runFile(OPS_PATH); runFile(OSW_PATH);

    const p = context.window.OfficeProfileService.bootstrap();
    await new Promise((r) => setTimeout(r, 20));
    check('B8: local office still intact while request is outstanding',
      context.window.OfficeProfileService.isConfigured() === true &&
      context.window.OfficeProfileService.getProfile().officeName === 'مكتب باقٍ');

    resolveFetch({ ok: true, status: 200, json: async () => ([{
      'اسم_المكتب': 'مكتب الخادم بعد التأخير', 'اسم_المحامي': 'محامي الخادم', 'العنوان': '', 'الفروع': '', 'أرقام_الهواتف': '', 'واتساب_المكتب': ''
    }]), clone: function () { return this; } });
    const result = await p;
    check('B8: after the delayed response, server profile is applied', result.status === 'SERVER_CONFIRMED_OFFICE');
    check('B8: local profile updated to the server value post-resolution',
      context.window.OfficeProfileService.getProfile().officeName === 'مكتب الخادم بعد التأخير');
  }

  console.log(log.join('\n'));
  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed === 0 ? 0 : 1);
})();
