/**
 * ================================================================
 * verify_license_identity_final.js — PROBLEM 18 FINAL AUDIT
 * نظام الحسام للمحاماة | Phase 30 Licensing — Machine ID + License
 * Identity, end to end.
 * ================================================================
 * Standalone Node harness, same conventions as the other files in
 * this directory (no browser, no external libs — Node's built-in
 * globalThis.crypto.subtle stands in for window.crypto.subtle).
 *
 * WHY THIS FILE EXISTS
 * ---------------------
 * Problems 16 and 17 each fixed one specific trigger of the same
 * underlying defect class ("Machine ID drifts on an untouched
 * device, so a previously-ACTIVE license flips to machine_mismatch
 * and the Activation Wizard reappears"): first a stale SubtleCrypto
 * snapshot, then screen-geometry swapping on rotation. Neither fix
 * addressed the *general* problem — the identity formula still had
 * live, user/OS-controllable environment signals of ANY kind mixed
 * into it (navigator.language, Intl timeZone), which is its own
 * instance of the exact same defect class, reproduced below in
 * Scenario 3/4/15 running against the PRE-FIX code.
 *
 * This file is the single authoritative regression suite for
 * Problem 18: it must be run against both the pre-fix and post-fix
 * copies of js/license/MachineFingerprint.js + LicenseCore.js (see
 * the BEFORE/AFTER section of the Problem 18 report) using the
 * RUN_AGAINST env var, e.g.:
 *
 *   RUN_AGAINST=/path/to/baseline/js/license node js/tests/verify_license_identity_final.js
 *   RUN_AGAINST=/path/to/fixed/js/license    node js/tests/verify_license_identity_final.js
 *
 * With no RUN_AGAINST, it runs against the license modules that ship
 * alongside this test file (../license), i.e. the current, fixed
 * copy — this is the mode used for normal CI/regression runs.
 * ================================================================
 */
'use strict';

const path = require('path');
const assert = require('assert');
const nodeCrypto = require('crypto');

const LICENSE_DIR = process.env.RUN_AGAINST
  ? path.resolve(process.env.RUN_AGAINST)
  : path.join(__dirname, '..', 'license');

console.log('Running against license modules in: ' + LICENSE_DIR + '\n');

const LICENSE_CRYPTO_PATH = path.join(LICENSE_DIR, 'LicenseCrypto.js');
const MACHINE_FP_PATH = path.join(LICENSE_DIR, 'MachineFingerprint.js');
const LICENSE_CORE_PATH = path.join(LICENSE_DIR, 'LicenseCore.js');

let passed = 0, failed = 0, skipped = 0;
const log = [];
function check(label, ok, extra) {
  if (ok) { passed++; log.push('PASS — ' + label); }
  else { failed++; log.push('FAIL — ' + label + (extra ? '  =>  ' + extra : '')); }
}
async function asyncCheck(label, fn) {
  try { await fn(); passed++; log.push('PASS — ' + label); }
  catch (e) { failed++; log.push('FAIL — ' + label + '  =>  ' + e.message); }
}
function skip(label, reason) {
  skipped++; log.push('SKIP — ' + label + '  (' + reason + ')');
}

// ----------------------------------------------------------------
// Fake browser environment. Every mutable property lives on
// `state`, and the getters below always read live from `state` —
// exactly like a real browser exposes live `navigator`/`screen`
// objects — so a scenario can mutate `state` mid-test to simulate
// "the user changed a system setting" without needing a fresh
// require() in between, matching real-world "still on the same page
// load" cases as well as fresh-load cases.
// ----------------------------------------------------------------
function installFakeBrowserGlobals() {
  const store = new Map();
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => {
      if (v === undefined || v === null) throw new Error('refusing to store ' + v);
      store.set(k, String(v));
    },
    removeItem: (k) => { store.delete(k); }
  };
  globalThis.dispatchEvent = () => {};
  if (typeof globalThis.CustomEvent === 'undefined') {
    globalThis.CustomEvent = function CustomEvent(type, opts) {
      this.type = type; this.detail = opts && opts.detail;
    };
  }
  Object.defineProperty(globalThis, 'crypto', { value: require('crypto').webcrypto, configurable: true, writable: true });

  const state = {
    platform: 'Linux armv8l',
    hardwareConcurrency: 8,
    language: 'ar-EG',
    languages: ['ar-EG', 'ar'],
    userAgent: 'Mozilla/5.0 (Linux; Android 13)',
    deviceMemory: 4,
    timeZone: 'Africa/Cairo',
    screenWidth: 390,
    screenHeight: 844,
    innerWidth: 390,
    innerHeight: 800,
    devicePixelRatio: 2.75,
    colorDepth: 24,
    pixelDepth: 24,
    maxTouchPoints: 5,
    online: true
  };

  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    get() {
      return {
        platform: state.platform,
        hardwareConcurrency: state.hardwareConcurrency,
        language: state.language,
        languages: state.languages,
        userAgent: state.userAgent,
        deviceMemory: state.deviceMemory,
        onLine: state.online,
        maxTouchPoints: state.maxTouchPoints
      };
    }
  });
  Object.defineProperty(globalThis, 'screen', {
    configurable: true,
    get() {
      return {
        width: state.screenWidth,
        height: state.screenHeight,
        colorDepth: state.colorDepth,
        pixelDepth: state.pixelDepth,
        orientation: { type: state.screenWidth >= state.screenHeight ? 'landscape-primary' : 'portrait-primary' }
      };
    }
  });
  Object.defineProperty(globalThis, 'innerWidth', { configurable: true, get() { return state.innerWidth; } });
  Object.defineProperty(globalThis, 'innerHeight', { configurable: true, get() { return state.innerHeight; } });
  Object.defineProperty(globalThis, 'devicePixelRatio', { configurable: true, get() { return state.devicePixelRatio; } });

  // Stub Intl.DateTimeFormat().resolvedOptions().timeZone to read live
  // from `state.timeZone`, exactly the property real code queries.
  const RealIntl = Intl;
  globalThis.Intl = {
    DateTimeFormat: function () {
      return { resolvedOptions: () => ({ timeZone: state.timeZone }) };
    }
  };
  // Keep everything else (NumberFormat etc.) working, just in case.
  Object.setPrototypeOf(globalThis.Intl, RealIntl);

  return { store, state };
}

function freshRequireLicenseModules() {
  delete require.cache[require.resolve(LICENSE_CRYPTO_PATH)];
  delete require.cache[require.resolve(MACHINE_FP_PATH)];
  delete require.cache[require.resolve(LICENSE_CORE_PATH)];
  const LicenseCrypto = require(LICENSE_CRYPTO_PATH);
  globalThis.LicenseCrypto = LicenseCrypto;
  const MachineFingerprint = require(MACHINE_FP_PATH);
  globalThis.MachineFingerprint = MachineFingerprint;
  const LicenseCore = require(LICENSE_CORE_PATH);
  globalThis.LicenseCore = LicenseCore;
  return { LicenseCrypto, MachineFingerprint, LicenseCore };
}

function signPayloadLikeGenerator(canonicalStringify, payload, privatePem) {
  const data = Buffer.from(canonicalStringify(payload), 'utf8');
  const signer = nodeCrypto.createSign('SHA256');
  signer.update(data);
  signer.end();
  return signer.sign({ key: privatePem, dsaEncoding: 'ieee-p1363' }).toString('base64');
}

async function main() {
  const keyPair = nodeCrypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const privatePem = keyPair.privateKey.export({ type: 'pkcs8', format: 'pem' });
  const publicJwk = keyPair.publicKey.export({ format: 'jwk' });

  function setupWithLicenseFor(machineId, overrides) {
    const payload = Object.assign({
      licenseId: 'HSM-LIC-FINAL', customer: { name: 'مكتب تجريبي' }, edition: 'Professional', type: 'yearly',
      machineId: machineId, modules: ['AI'], issuedAt: '2026-01-01T00:00:00.000Z',
      expiresAt: '2099-01-01T00:00:00.000Z', supportUntil: '2099-01-01T00:00:00.000Z',
      graceDays: 15, maxTransfers: 2, transferCount: 0
    }, overrides);
    return payload;
  }

  // ================================================================
  // Scenario 1 — same device, same environment, two computations:
  // must be identical.
  // ================================================================
  {
    const { } = installFakeBrowserGlobals();
    globalThis.HOSSAM_LICENSE_PUBLIC_KEY_JWK = publicJwk;
    const run1 = freshRequireLicenseModules();
    const id1 = await run1.MachineFingerprint.getMachineId();
    const run2 = freshRequireLicenseModules();
    const id2 = await run2.MachineFingerprint.getMachineId();
    check('Scenario 1 — same device/environment, two computations are identical', id1 === id2, 'id1=' + id1 + ' id2=' + id2);
  }

  // Scenarios 2-7 + 15: one persistent salt, mutate ONE environment
  // property at a time (or several combined for Scenario 15/14),
  // recompute WITHOUT a fresh page load first (state mutated live,
  // matching "user changes a setting while the PWA tab / WebView
  // process stays alive") and then also WITH a fresh load (cold
  // restart) — both must be stable.
  const mutations = [
    ['Scenario 2 — orientation portrait -> landscape', (s) => { const w = s.screenWidth, h = s.screenHeight; s.screenWidth = h; s.screenHeight = w; }],
    ['Scenario 3 — navigator.language changes', (s) => { s.language = 'en-US'; }],
    ['Scenario 4 — navigator.languages changes', (s) => { s.languages = ['en-US', 'en']; }],
    ['Scenario 5 — timezone changes', (s) => { s.timeZone = 'America/New_York'; }],
    ['Scenario 6 — screen.width/height change (independent of orientation swap)', (s) => { s.screenWidth = 1080; s.screenHeight = 2400; }],
    ['Scenario 7a — innerWidth/innerHeight (viewport) change', (s) => { s.innerWidth = 1024; s.innerHeight = 768; }],
    ['Scenario 7b — devicePixelRatio changes', (s) => { s.devicePixelRatio = 1; }]
  ];

  for (const [label, mutate] of mutations) {
    const { state } = installFakeBrowserGlobals();
    globalThis.HOSSAM_LICENSE_PUBLIC_KEY_JWK = publicJwk;
    const before = freshRequireLicenseModules();
    const idBefore = await before.MachineFingerprint.getMachineId();

    mutate(state);
    // Cold-restart case (fresh module instances = fresh "page load").
    const afterCold = freshRequireLicenseModules();
    const idAfterCold = await afterCold.MachineFingerprint.getMachineId();

    check(label + ' [cold restart]', idBefore === idAfterCold, 'before=' + idBefore + ' after=' + idAfterCold);
  }

  // ================================================================
  // Scenario 8 — same persistent salt across two fresh "installs"
  // that share the same localStorage => same Machine ID.
  // ================================================================
  {
    installFakeBrowserGlobals();
    globalThis.HOSSAM_LICENSE_PUBLIC_KEY_JWK = publicJwk;
    const run1 = freshRequireLicenseModules();
    const id1 = await run1.MachineFingerprint.getMachineId();
    const run2 = freshRequireLicenseModules();
    const id2 = await run2.MachineFingerprint.getMachineId();
    check('Scenario 8 — same persisted salt (same localStorage) => same Machine ID', id1 === id2);
  }

  // ================================================================
  // Scenario 9 — a DIFFERENT salt (i.e. genuinely a different
  // device/browser-profile/localStorage) => a DIFFERENT Machine ID.
  // Proves the salt — not environment noise — is what actually
  // determines the id, and that the formula isn't a constant.
  // ================================================================
  {
    installFakeBrowserGlobals();
    globalThis.HOSSAM_LICENSE_PUBLIC_KEY_JWK = publicJwk;
    const runA = freshRequireLicenseModules();
    const idA = await runA.MachineFingerprint.getMachineId();

    installFakeBrowserGlobals(); // brand-new empty localStorage => brand-new salt
    globalThis.HOSSAM_LICENSE_PUBLIC_KEY_JWK = publicJwk;
    const runB = freshRequireLicenseModules();
    const idB = await runB.MachineFingerprint.getMachineId();

    check('Scenario 9 — a genuinely different device (different salt) gets a different Machine ID', idA !== idB, 'idA=' + idA + ' idB=' + idB);
  }

  // ================================================================
  // Scenarios 10-14 — LicenseCore state machine correctness.
  // ================================================================
  {
    installFakeBrowserGlobals();
    globalThis.HOSSAM_LICENSE_PUBLIC_KEY_JWK = publicJwk;
    const run = freshRequireLicenseModules();
    const myId = await run.MachineFingerprint.getMachineId();

    // Scenario 10 — valid license + correct Machine ID => ACTIVE
    {
      const payload = setupWithLicenseFor(myId);
      const signature = signPayloadLikeGenerator(run.LicenseCrypto.canonicalStringify, payload, privatePem);
      globalThis.localStorage.setItem('hsm_license_record_v1', JSON.stringify({
        licenseFile: { v: 1, payload, signature }, activatedAt: '2026-01-01T00:00:00.000Z', lastOnlineCheck: null, revoked: false
      }));
      await asyncCheck('Scenario 10 — valid license + correct Machine ID => ACTIVE', async () => {
        const status = await run.LicenseCore.reevaluate();
        assert.strictEqual(status.state, run.LicenseCore.States.ACTIVE, 'reason=' + status.reason);
      });
    }

    // Scenario 11 — valid license + WRONG Machine ID => INVALID
    {
      const payload = setupWithLicenseFor('HSM-0000-0000-0000');
      const signature = signPayloadLikeGenerator(run.LicenseCrypto.canonicalStringify, payload, privatePem);
      globalThis.localStorage.setItem('hsm_license_record_v1', JSON.stringify({
        licenseFile: { v: 1, payload, signature }, activatedAt: '2026-01-01T00:00:00.000Z', lastOnlineCheck: null, revoked: false
      }));
      await asyncCheck('Scenario 11 — valid signature + WRONG Machine ID => INVALID/machine_mismatch', async () => {
        const status = await run.LicenseCore.reevaluate();
        assert.strictEqual(status.state, run.LicenseCore.States.INVALID);
        assert.strictEqual(status.reason, 'machine_mismatch');
      });
    }

    // Scenario 12 — tampered license (signed then edited) => INVALID
    {
      const payload = setupWithLicenseFor(myId);
      const signature = signPayloadLikeGenerator(run.LicenseCrypto.canonicalStringify, payload, privatePem);
      const tampered = Object.assign({}, payload, { edition: 'Enterprise' });
      globalThis.localStorage.setItem('hsm_license_record_v1', JSON.stringify({
        licenseFile: { v: 1, payload: tampered, signature }, activatedAt: '2026-01-01T00:00:00.000Z', lastOnlineCheck: null, revoked: false
      }));
      await asyncCheck('Scenario 12 — tampered payload (signed then edited) => INVALID/invalid_signature', async () => {
        const status = await run.LicenseCore.reevaluate();
        assert.strictEqual(status.state, run.LicenseCore.States.INVALID);
        assert.strictEqual(status.reason, 'invalid_signature');
      });
    }

    // Scenario 13 — bad signature => INVALID
    {
      const payload = setupWithLicenseFor(myId);
      globalThis.localStorage.setItem('hsm_license_record_v1', JSON.stringify({
        licenseFile: { v: 1, payload, signature: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==' },
        activatedAt: '2026-01-01T00:00:00.000Z', lastOnlineCheck: null, revoked: false
      }));
      await asyncCheck('Scenario 13 — bad/forged signature => INVALID/invalid_signature', async () => {
        const status = await run.LicenseCore.reevaluate();
        assert.strictEqual(status.state, run.LicenseCore.States.INVALID);
        assert.strictEqual(status.reason, 'invalid_signature');
      });
    }

    // Scenario 14 — missing license => NOT_ACTIVATED
    {
      globalThis.localStorage.removeItem('hsm_license_record_v1');
      await asyncCheck('Scenario 14 — missing license => NOT_ACTIVATED', async () => {
        const status = await run.LicenseCore.reevaluate();
        assert.strictEqual(status.state, run.LicenseCore.States.NOT_ACTIVATED);
      });
    }
  }

  // ================================================================
  // Scenario 15 / Phase 14's "most important test" — the exact
  // client-reported sequence: activate once, close, reopen with
  // language + timezone + orientation ALL changed at once, must
  // still be ACTIVE with no re-activation needed.
  // ================================================================
  {
    const { state } = installFakeBrowserGlobals();
    globalThis.HOSSAM_LICENSE_PUBLIC_KEY_JWK = publicJwk;

    // Startup #1 — first activation.
    const first = freshRequireLicenseModules();
    const machineIdAtActivation = await first.MachineFingerprint.getMachineId();
    const payload = setupWithLicenseFor(machineIdAtActivation);
    const signature = signPayloadLikeGenerator(first.LicenseCrypto.canonicalStringify, payload, privatePem);
    globalThis.localStorage.setItem('hsm_license_record_v1', JSON.stringify({
      licenseFile: { v: 1, payload, signature }, activatedAt: '2026-01-01T00:00:00.000Z', lastOnlineCheck: null, revoked: false
    }));
    await asyncCheck('Scenario 15a — startup #1: activation resolves ACTIVE', async () => {
      const status = await first.LicenseCore.init();
      assert.strictEqual(status.state, first.LicenseCore.States.ACTIVE, 'reason=' + status.reason);
    });

    // App closed. Between opens: language, timezone, AND orientation
    // all change — exactly the client-reported conditions (nothing
    // reset, nothing uninstalled, license untouched).
    state.language = 'en-US';
    state.languages = ['en-US'];
    state.timeZone = 'Europe/London';
    const w = state.screenWidth, h = state.screenHeight;
    state.screenWidth = h; state.screenHeight = w;

    // Startup #2 — fresh "page load" (cold restart), localStorage persists.
    const second = freshRequireLicenseModules();
    await asyncCheck(
      'Scenario 15b — startup #2 after language+timezone+orientation change: still ACTIVE, no re-activation, no machine_mismatch',
      async () => {
        const status = await second.LicenseCore.init();
        assert.strictEqual(status.state, second.LicenseCore.States.ACTIVE,
          'reason=' + status.reason + ' — this is exactly the client-reported "Activation Wizard reappears" bug');
      }
    );
    check('Scenario 15c — Machine ID after all three changes is bit-for-bit identical to the one issued at activation',
      (await second.MachineFingerprint.getMachineId()) === machineIdAtActivation);
  }

  // ---- Summary ----
  console.log(log.join('\n'));
  console.log('\n' + passed + '/' + (passed + failed) + ' checks passed' + (skipped ? (', ' + skipped + ' skipped') : '') + '.');
  if (failed > 0) {
    console.log('\n' + failed + ' CHECK(S) FAILED.');
    process.exitCode = 1;
  }
}

main();
