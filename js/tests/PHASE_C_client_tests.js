/**
 * ================================================================
 * PHASE_C_client_tests.js — نظام الحسام للمحاماة
 * ================================================================
 * Standalone Node harness (`node js/tests/PHASE_C_client_tests.js`, no
 * browser required) for the CLIENT half of PHASE C v3/v3.1/v3.2:
 *   - js/license/InstallationRegistrar.js (loaded for real, unmodified)
 *   - js/license/ActivationWizard.js       (loaded for real, unmodified)
 * against a fake ApiService (fully scripted network behavior — success/
 * failure/throw on demand, with a call log) and a fake DOM/localStorage,
 * in the exact FakeElement/fake-document style already established by
 * js/tests/PHASE_B_bootstrap_race_tests.js (reused verbatim where
 * possible, extended only where PHASE C's markup/behavior needs it).
 *
 * Covers Test Matrix items #24, #31-#37 (v3.2 §7) plus a direct
 * re-verification of #21/#22/#34-#36 at the CLIENT layer (the Node
 * harness for Config/11_Auth.gs already proves the SERVER side of
 * those numbers; this file proves InstallationRegistrar.js drives the
 * server correctly and enforces the forceReissue guardrails on the
 * client side, independently).
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
function note(label) { log.push('NOTE: ' + label); }

const REGISTRAR_PATH = path.join(__dirname, '..', 'license', 'InstallationRegistrar.js');
const WIZARD_PATH = path.join(__dirname, '..', 'license', 'ActivationWizard.js');
const registrarSource = fs.readFileSync(REGISTRAR_PATH, 'utf8');
const wizardSource = fs.readFileSync(WIZARD_PATH, 'utf8');

// --------------------------------------------------------------------
// Fake DOM — same FakeElement/fake-document approach as
// PHASE_B_bootstrap_race_tests.js, extended with a `hidden` accessor
// pair (attribute-backed) since ActivationWizard.js's PHASE C additions
// use setAttribute('hidden',...)/removeAttribute('hidden') exclusively
// for the new step element, and hasAttribute('hidden') is what these
// tests assert on directly.
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
    this.disabled = false;
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
      // Capture the WHOLE opening tag (not just the id) so a bare
      // `hidden` attribute on that same tag is reflected onto the
      // created FakeElement — needed for PHASE C's
      // `<div ... id="licActivationCodeStep" hidden>` to actually
      // start in the hidden state the real markup declares, instead of
      // every fake element silently defaulting to "visible" regardless
      // of the real HTML (which would make hidden/visible assertions
      // pass vacuously rather than exercising the real behavior).
      const re = /<[^>]*\bid="([^"]+)"[^>]*>/g;
      let m;
      while ((m = re.exec(html))) {
        const id = m[1];
        if (!this._byId[id]) this._byId[id] = new FakeElement('div');
        if (/\bhidden\b/.test(m[0])) this._byId[id]._attrs.hidden = 'hidden';
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
    _FakeElement: FakeElement,
    createElement: function (tag) { return new FakeElement(tag); },
    body: body,
    getElementById: function () { return null; }
  };
}

function makeFakeWindowEventing() {
  const listeners = {};
  return {
    addEventListener: function (type, fn) { (listeners[type] = listeners[type] || []).push(fn); },
    dispatchEvent: function (evt) { (listeners[evt.type] || []).forEach(function (fn) { fn(evt); }); }
  };
}

function makeFakeLocalStorage() {
  const store = {};
  return {
    getItem: function (k) { return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; },
    setItem: function (k, v) { store[k] = String(v); },
    removeItem: function (k) { delete store[k]; },
    _dump: function () { return Object.assign({}, store); }
  };
}

/**
 * Fully scripted fake ApiService.registerInstallation. `script` is a
 * function (callIndex, fields) => response-data-object, OR the string
 * 'THROW' to simulate a network/HTTP failure on that call. Records
 * every call in `calls` for assertions.
 */
function makeFakeApiService(script) {
  const calls = [];
  return {
    calls: calls,
    registerInstallation: async function (fields) {
      const idx = calls.length;
      calls.push(Object.assign({}, fields));
      const outcome = typeof script === 'function' ? script(idx, fields) : script[idx];
      if (outcome === 'THROW') throw new Error('simulated network failure');
      return { json: async function () { return outcome; } };
    }
  };
}

function loadRegistrar(win) {
  const sandbox = { window: win, console: console };
  vm.createContext(sandbox);
  vm.runInContext(registrarSource, sandbox, { filename: 'InstallationRegistrar.js' });
  return win.InstallationRegistrar;
}

function loadWizard(win, doc) {
  const sandbox = { window: win, document: doc, console: console };
  vm.createContext(sandbox);
  vm.runInContext(wizardSource, sandbox, { filename: 'ActivationWizard.js' });
  return win.ActivationWizard;
}

function makeBaseWindow() {
  const evt = makeFakeWindowEventing();
  const win = {
    addEventListener: evt.addEventListener,
    dispatchEvent: evt.dispatchEvent,
    localStorage: makeFakeLocalStorage(),
    crypto: { randomUUID: function () { return 'uuid-' + Math.random().toString(36).slice(2); } }
  };
  return win;
}

// ====================================================================
// Part 1 — InstallationRegistrar.js in isolation
// ====================================================================

async function test_REGISTERED_storesCredential() {
  const win = makeBaseWindow();
  win.ApiService = makeFakeApiService([{ success: true, status: 'REGISTERED', installationId: 'I1', credential: 'c'.repeat(64) }]);
  const registrar = loadRegistrar(win);
  await registrar.register({ licenseId: 'L1', activationCode: 'CODE1', machineId: 'M1' });
  check('REGISTERED → exactly 1 network call', win.ApiService.calls.length === 1);
  check('REGISTERED → forceReissue false on first call', win.ApiService.calls[0].forceReissue === false);
  const stored = JSON.parse(win.localStorage.getItem('hsm_installation_credential_v1'));
  check('REGISTERED → credential stored in the single expected localStorage key', stored.installationId === 'I1' && stored.credential === 'c'.repeat(64));
  check('hasLocalCredential() true afterwards', registrar.hasLocalCredential() === true);
}

async function test35_alreadyRegistered_withLocalCredential_zeroExtraCalls() {
  const win = makeBaseWindow();
  win.localStorage.setItem('hsm_installation_credential_v1', JSON.stringify({ installationId: 'I2', credential: 'd'.repeat(64), credentialIssuedAt: 'x' }));
  win.ApiService = makeFakeApiService([{ success: true, status: 'ALREADY_REGISTERED', installationId: 'I2' }]);
  const registrar = loadRegistrar(win);
  await registrar.register({ licenseId: 'L2', activationCode: 'CODE2', machineId: 'M2' });
  check('#35 ALREADY_REGISTERED + existing local credential → exactly 1 network call total (no forceReissue follow-up)', win.ApiService.calls.length === 1);
}

async function test36_alreadyRegistered_emptyLocal_exactlyOneReissueCall() {
  const win = makeBaseWindow();
  win.ApiService = makeFakeApiService(function (idx) {
    if (idx === 0) return { success: true, status: 'ALREADY_REGISTERED', installationId: 'I3' };
    return { success: true, status: 'REISSUED', installationId: 'I3', credential: 'e'.repeat(64) };
  });
  const registrar = loadRegistrar(win);
  await registrar.register({ licenseId: 'L3', activationCode: 'CODE3', machineId: 'M3' });
  check('#36 ALREADY_REGISTERED + empty local store → exactly 2 calls total (1 + 1 forceReissue)', win.ApiService.calls.length === 2);
  check('#36 second call carries forceReissue:true', win.ApiService.calls[1].forceReissue === true);
  check('#36 first call carries forceReissue:false', win.ApiService.calls[0].forceReissue === false);
  const stored = JSON.parse(win.localStorage.getItem('hsm_installation_credential_v1'));
  check('#36 REISSUED credential ends up stored', stored && stored.credential === 'e'.repeat(64));
}

async function test36b_noThirdCallEvenIfSecondAlsoAlreadyRegistered() {
  // Defensive: even in a contrived scripted case where the follow-up
  // call somehow also came back ALREADY_REGISTERED, there must never be
  // a third automatic call — "at most one forceReissue follow-up" is
  // absolute, not conditional on the follow-up's own result.
  const win = makeBaseWindow();
  win.ApiService = makeFakeApiService([
    { success: true, status: 'ALREADY_REGISTERED', installationId: 'I4' },
    { success: true, status: 'ALREADY_REGISTERED', installationId: 'I4' }
  ]);
  const registrar = loadRegistrar(win);
  await registrar.register({ licenseId: 'L4', activationCode: 'CODE4', machineId: 'M4' });
  check('At most one forceReissue follow-up ever, regardless of its own result', win.ApiService.calls.length === 2);
}

async function test34_networkFailureFirstCall_neverSendsForceReissue() {
  const win = makeBaseWindow();
  win.ApiService = makeFakeApiService(['THROW']);
  const registrar = loadRegistrar(win);
  await registrar.register({ licenseId: 'L5', activationCode: 'CODE5', machineId: 'M5' });
  check('#34 Network failure on first call → exactly 1 attempted call, no forceReissue follow-up', win.ApiService.calls.length === 1);
  check('#34 Nothing stored locally after a pure network failure', win.localStorage.getItem('hsm_installation_credential_v1') === null);
}

async function test_manualRetryAfterNetworkFailure_reusesSameRequestId() {
  const win = makeBaseWindow();
  win.ApiService = makeFakeApiService(['THROW', { success: true, status: 'REGISTERED', installationId: 'I6', credential: 'f'.repeat(64) }]);
  const registrar = loadRegistrar(win);
  const fields = { licenseId: 'L6', activationCode: 'CODE6', machineId: 'M6' };
  await registrar.register(fields); // fails (network)
  await registrar.register(fields); // manual retry, same fields
  check('Manual retry after network failure reuses the SAME requestId (idempotency preserved)', win.ApiService.calls[0].requestId === win.ApiService.calls[1].requestId);
  check('Manual retry eventually succeeds and stores credential', JSON.parse(win.localStorage.getItem('hsm_installation_credential_v1')).installationId === 'I6');
}

async function test_differentActivationCode_getsFreshRequestId() {
  const win = makeBaseWindow();
  win.ApiService = makeFakeApiService(['THROW', { success: true, status: 'REGISTERED', installationId: 'I7', credential: '1'.repeat(64) }]);
  const registrar = loadRegistrar(win);
  await registrar.register({ licenseId: 'L7', activationCode: 'CODE-A', machineId: 'M7' });
  await registrar.register({ licenseId: 'L7', activationCode: 'CODE-B', machineId: 'M7' }); // different code = different logical attempt
  check('A different activation code starts a fresh requestId (not treated as the same retry)', win.ApiService.calls[0].requestId !== win.ApiService.calls[1].requestId);
}

async function test24_concurrentDuplicateRegisterCalls() {
  // Simulate two near-simultaneous register() calls for the exact same
  // logical attempt (e.g. a UI double-fire) — with the SERVER'S
  // documented behavior for this exact scenario (v3.1 §1.3 Scenario B /
  // v3.2 §1.4 test #24): first calls sees requestId not found →
  // REGISTERED; second (same requestId, arriving after) → ALREADY_REGISTERED.
  const win = makeBaseWindow();
  let callCount = 0;
  win.ApiService = {
    calls: [],
    registerInstallation: async function (fields) {
      win.ApiService.calls.push(Object.assign({}, fields));
      callCount++;
      // First call to resolve gets REGISTERED; assumes the fake server
      // behaves like the real one under lock-serialization.
      if (callCount === 1) return { json: async function () { return { success: true, status: 'REGISTERED', installationId: 'I8', credential: '2'.repeat(64) }; } };
      return { json: async function () { return { success: true, status: 'ALREADY_REGISTERED', installationId: 'I8' }; } };
    }
  };
  const registrar = loadRegistrar(win);
  const fields = { licenseId: 'L8', activationCode: 'CODE8', machineId: 'M8' };
  const p1 = registrar.register(fields);
  const p2 = registrar.register(fields);
  await Promise.all([p1, p2]);
  check('#24 Both concurrent calls used the SAME requestId (client-side dedup via pendingRequestId)', win.ApiService.calls[0].requestId === win.ApiService.calls[1].requestId);
  check('#24 Exactly one credential ends up stored, matching the REGISTERED response', JSON.parse(win.localStorage.getItem('hsm_installation_credential_v1')).installationId === 'I8');
}

// ====================================================================
// Part 2 — ActivationWizard.js UX integration
// ====================================================================

function makeWizardEnv(opts) {
  opts = opts || {};
  const doc = makeFakeDocument();
  const win = makeBaseWindow();
  win.ApiService = opts.apiService || makeFakeApiService([]);
  win.InstallationRegistrar = opts.installationRegistrar || loadRegistrar(win);
  win.LicenseCore = opts.licenseCore || {
    States: { NOT_ACTIVATED: 'NOT_ACTIVATED', INVALID: 'INVALID', VALID: 'VALID' },
    getStatus: function () { return null; },
    activate: async function () { return { ok: true }; },
    getStoredRecordMeta: function () { return { licenseId: 'LIC-WIZ' }; }
  };
  win.MachineFingerprint = opts.machineFingerprint || { getMachineId: async function () { return 'MID-WIZ'; } };
  const wizard = loadWizard(win, doc);
  return { doc: doc, win: win, wizard: wizard };
}

async function test31_skipButton_zeroNetworkCalls() {
  const env = makeWizardEnv();
  env.wizard.show();
  const overlay = env.doc.body.children[0];
  check('#31 Activation Code step starts hidden (real markup default, before any `.hsm` success)', overlay._byId.licActivationCodeStep.hasAttribute('hidden'));
  // Simulate a successful `.hsm` activation reaching the point where the
  // Activation Code step is revealed (mirrors onActivateClick()'s
  // post-success branch — invoked here directly via the button
  // listener path exactly as a real click would).
  overlay._byId.licTextarea.value = 'FAKE-HSM-CONTENT-FOR-TESTING'; // real onActivateClick() early-returns on empty textarea
  overlay._byId.licActivateBtn._listeners.click[0]();
  await new Promise(function (r) { setTimeout(r, 0); }); // flush the async onActivateClick
  check('#31 Activation Code step is visible after a successful `.hsm`', !overlay._byId.licActivationCodeStep.hasAttribute('hidden'));
  overlay._byId.licSkipRegisterBtn._listeners.click[0]();
  check('#31 "تخطي والمتابعة" → zero registerInstallation calls', env.win.ApiService.calls === undefined || (Array.isArray(env.win.ApiService.calls) && env.win.ApiService.calls.length === 0));
  check('#31 Skip closes the overlay (hidden attribute restored)', overlay.hasAttribute('hidden'));
}

async function test32_codeFieldClearedBeforeNetworkResolves() {
  let capturedValueAtCallTime = 'UNSET';
  const apiService = {
    calls: [],
    registerInstallation: async function (fields) {
      apiService.calls.push(fields);
      return new Promise(function (resolve) {
        setTimeout(function () {
          resolve({ json: async function () { return { success: true, status: 'REGISTERED', installationId: 'I9', credential: '3'.repeat(64) }; } });
        }, 5);
      });
    }
  };
  const env = makeWizardEnv({ apiService: apiService });
  env.wizard.show();
  const overlay = env.doc.body.children[0];
  overlay._byId.licTextarea.value = 'FAKE-HSM-CONTENT-FOR-TESTING';
  overlay._byId.licActivateBtn._listeners.click[0]();
  await new Promise(function (r) { setTimeout(r, 0); });
  overlay._byId.licActivationCodeInput.value = 'SECRET-CODE-123';
  overlay._byId.licRegisterBtn._listeners.click[0]();
  // Read the field IMMEDIATELY (synchronously after the click handler's
  // first microtask tick), i.e. long before the scripted 5ms network
  // delay resolves.
  capturedValueAtCallTime = overlay._byId.licActivationCodeInput.value;
  check('#32 Activation Code input is cleared before the network call resolves', capturedValueAtCallTime === '');
  await new Promise(function (r) { setTimeout(r, 20); });
  check('#32 The captured code (not the now-empty field) was actually sent to the server', apiService.calls[0].activationCode === 'SECRET-CODE-123');
}

async function test33_noSecretsInConsoleLogging() {
  const originalLog = console.log, originalWarn = console.warn, originalError = console.error;
  const captured = [];
  console.log = console.warn = console.error = function () { captured.push(Array.prototype.slice.call(arguments).join(' ')); };
  try {
    const apiService = makeFakeApiService([{ success: true, status: 'REGISTERED', installationId: 'I10', credential: 'SECRET-CRED-VALUE-999' }]);
    const env = makeWizardEnv({ apiService: apiService });
    env.wizard.show();
    const overlay = env.doc.body.children[0];
    overlay._byId.licTextarea.value = 'FAKE-HSM-CONTENT-FOR-TESTING';
    overlay._byId.licActivateBtn._listeners.click[0]();
    await new Promise(function (r) { setTimeout(r, 0); });
    overlay._byId.licActivationCodeInput.value = 'MY-SECRET-ACTIVATION-CODE';
    overlay._byId.licRegisterBtn._listeners.click[0]();
    await new Promise(function (r) { setTimeout(r, 10); });
  } finally {
    console.log = originalLog; console.warn = originalWarn; console.error = originalError;
  }
  const joined = captured.join('\n');
  check('#33 Activation code never appears in console output', joined.indexOf('MY-SECRET-ACTIVATION-CODE') === -1);
  check('#33 Raw credential never appears in console output', joined.indexOf('SECRET-CRED-VALUE-999') === -1);
}

async function test37_existingCredentialSkipsStep() {
  const win2setup = makeBaseWindow();
  win2setup.localStorage.setItem('hsm_installation_credential_v1', JSON.stringify({ installationId: 'IX', credential: 'g'.repeat(64), credentialIssuedAt: 'x' }));
  const preloadedRegistrar = loadRegistrar(win2setup);
  const env = makeWizardEnv({ installationRegistrar: preloadedRegistrar });
  env.wizard.show();
  const overlay = env.doc.body.children[0];
  overlay._byId.licTextarea.value = 'FAKE-HSM-CONTENT-FOR-TESTING';
  overlay._byId.licActivateBtn._listeners.click[0]();
  await new Promise(function (r) { setTimeout(r, 0); });
  check('#37 Device with an existing stored credential never sees the Activation Code step', overlay.hasAttribute('hidden'));
}

async function main() {
  await test_REGISTERED_storesCredential();
  await test35_alreadyRegistered_withLocalCredential_zeroExtraCalls();
  await test36_alreadyRegistered_emptyLocal_exactlyOneReissueCall();
  await test36b_noThirdCallEvenIfSecondAlsoAlreadyRegistered();
  await test34_networkFailureFirstCall_neverSendsForceReissue();
  await test_manualRetryAfterNetworkFailure_reusesSameRequestId();
  await test_differentActivationCode_getsFreshRequestId();
  await test24_concurrentDuplicateRegisterCalls();
  await test31_skipButton_zeroNetworkCalls();
  await test32_codeFieldClearedBeforeNetworkResolves();
  await test33_noSecretsInConsoleLogging();
  await test37_existingCredentialSkipsStep();
}

main().then(function () {
  console.log('\n' + log.join('\n'));
  console.log('\n==== PHASE C client (InstallationRegistrar.js + ActivationWizard.js) — Node harness ====');
  console.log('PASSED: ' + passed + '   FAILED: ' + failed);
  process.exitCode = failed > 0 ? 1 : 0;
});
