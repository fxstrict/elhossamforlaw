/**
 * ================================================================
 * verify_machine_id_persistence_across_restarts.js — PROBLEM 17/18
 * نظام الحسام للمحاماة | Phase 30 Licensing — Machine ID Stability
 * ================================================================
 * Standalone Node harness, same style/conventions as
 * js/tests/verify_license_startup_state_persistence.js.
 *
 * PROBLEM 18 UPDATE: this file originally also exercised the
 * PROBLEM 17 "pinning" mechanism (MachineFingerprint.confirmMachineId
 * / _getConfirmedMachineId, and a Scenario 5 simulating an
 * old-formula pre-existing license "healing" itself via that pin).
 * That mechanism has been REMOVED entirely in Problem 18 (see
 * MachineFingerprint.js header) because: (a) the project confirmed
 * there are no pre-existing licenses of any formula to migrate, so
 * the pin's only stated justification no longer applies, and (b) the
 * identity formula itself no longer contains anything that can drift
 * (see js/tests/verify_license_identity_final.js), so there is
 * nothing left for a pin to protect against. The scenarios below now
 * test the RAW getMachineId() output directly — no pinning API exists
 * anymore, so this is the only thing that CAN be tested, which is
 * exactly the point: the raw computation is the single source of
 * truth.
 *
 * WHAT THIS PROVES
 * -----------------
 * Root cause of the original production evidence: the SAME device
 * produced two different Machine IDs a few hours apart
 * (HSM-9F89-64D9-302E then HSM-DAF9-E8C4-1683) with no reset.
 * js/license/MachineFingerprint.js's collectEnvironmentSignals() used
 * to fold `screen.width x screen.height` into the SHA-256 input. On
 * every mobile browser, window.screen.width/height report the CURRENT
 * ORIENTATION's dimensions and SWAP on rotation (documented browser
 * behavior). Fixed in Problem 17 by dropping screen geometry; fixed
 * further in Problem 18 by dropping every remaining environment
 * signal (see verify_license_identity_final.js for that evidence) so
 * ONLY the persisted device salt feeds the hash.
 *
 * Run: node js/tests/verify_machine_id_persistence_across_restarts.js
 * ================================================================
 */
'use strict';

const path = require('path');
const assert = require('assert');
const nodeCrypto = require('crypto');

const LICENSE_DIR = path.join(__dirname, '..', 'license');
const LICENSE_CRYPTO_PATH = path.join(LICENSE_DIR, 'LicenseCrypto.js');
const MACHINE_FP_PATH = path.join(LICENSE_DIR, 'MachineFingerprint.js');
const LICENSE_CORE_PATH = path.join(LICENSE_DIR, 'LicenseCore.js');

let passed = 0, failed = 0;
const log = [];
function check(label, ok, extra) {
  if (ok) { passed++; log.push('PASS — ' + label); }
  else { failed++; log.push('FAIL — ' + label + (extra ? '  =>  ' + extra : '')); }
}
async function asyncCheck(label, fn) {
  try { await fn(); passed++; log.push('PASS — ' + label); }
  catch (e) { failed++; log.push('FAIL — ' + label + '  =>  ' + e.message); }
}

function installFakeBrowserGlobals() {
  const store = new Map();
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => { store.set(k, String(v)); },
    removeItem: (k) => { store.delete(k); }
  };
  const events = [];
  globalThis.dispatchEvent = (evt) => { events.push(evt); };
  if (typeof globalThis.CustomEvent === 'undefined') {
    globalThis.CustomEvent = function CustomEvent(type, opts) {
      this.type = type; this.detail = opts && opts.detail;
    };
  }
  Object.defineProperty(globalThis, 'crypto', { value: require('crypto').webcrypto, configurable: true, writable: true });
  Object.defineProperty(globalThis, 'navigator', { value: { platform: 'Linux armv8l', hardwareConcurrency: 8, language: 'ar-EG' }, configurable: true, writable: true });
  // PORTRAIT by default — orientation is flipped explicitly per-scenario below.
  Object.defineProperty(globalThis, 'screen', { value: { width: 390, height: 844, colorDepth: 24 }, configurable: true, writable: true });
  return { store, events };
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

function rotateToLandscape() {
  const w = globalThis.screen.width, h = globalThis.screen.height;
  globalThis.screen = Object.assign({}, globalThis.screen, { width: h, height: w });
}

async function main() {
  const keyPair = nodeCrypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const privatePem = keyPair.privateKey.export({ type: 'pkcs8', format: 'pem' });
  const publicJwk = keyPair.publicKey.export({ format: 'jwk' });
  globalThis.HOSSAM_LICENSE_PUBLIC_KEY_JWK = publicJwk;

  // ================================================================
  // Scenario 1 (mandatory) — persistence across 2 restarts with the
  // SAME orientation: ID A === ID B.
  // ================================================================
  {
    installFakeBrowserGlobals();
    const run1 = freshRequireLicenseModules();
    const idA = await run1.MachineFingerprint.getMachineId();

    const run2 = freshRequireLicenseModules(); // fresh module instances = fresh "page load"
    const idB = await run2.MachineFingerprint.getMachineId();

    check('Scenario 1 — Machine ID identical across two cold starts, same orientation', idA === idB, 'A=' + idA + ' B=' + idB);
  }

  // ================================================================
  // Scenario 2 — 20-restart loop, same orientation throughout.
  // ================================================================
  {
    installFakeBrowserGlobals();
    const ids = new Set();
    for (let i = 0; i < 20; i++) {
      const run = freshRequireLicenseModules();
      ids.add(await run.MachineFingerprint.getMachineId());
    }
    check('Scenario 2 — 20 consecutive restarts (same orientation) yield exactly 1 unique Machine ID', ids.size === 1, Array.from(ids).join(', '));
  }

  // ================================================================
  // Scenario 3 — THE ORIGINAL REPORTED BUG, isolated at the
  // MachineFingerprint layer: same persistent salt, device physically
  // rotated between two opens. Tested on the RAW getMachineId() output
  // directly (no pinning API exists anymore) — this must be stable
  // because collectEnvironmentSignals() reads nothing from `screen` at
  // all now.
  // ================================================================
  {
    installFakeBrowserGlobals();
    const runPortrait = freshRequireLicenseModules();
    const idPortrait = await runPortrait.MachineFingerprint.getMachineId();

    rotateToLandscape();
    const runLandscape = freshRequireLicenseModules();
    const idLandscape = await runLandscape.MachineFingerprint.getMachineId();

    rotateToLandscape(); // back to portrait
    const runPortraitAgain = freshRequireLicenseModules();
    const idPortraitAgain = await runPortraitAgain.MachineFingerprint.getMachineId();

    check(
      'Scenario 3 — Machine ID stable across a device rotation between two opens (the exact HSM-9F89.. -> HSM-DAF9.. production report)',
      idPortrait === idLandscape && idLandscape === idPortraitAgain,
      'portrait=' + idPortrait + ' landscape=' + idLandscape + ' portrait2=' + idPortraitAgain
    );
  }

  // ================================================================
  // Scenario 4 (mandatory end-to-end) — cold start with a valid
  // stored license survives a device rotation: no machine_mismatch,
  // no Activation Wizard, no refresh needed. No pin is involved —
  // this passes purely because the raw formula never changes.
  // ================================================================
  {
    installFakeBrowserGlobals();
    const first = freshRequireLicenseModules();
    const originalMachineId = await first.MachineFingerprint.getMachineId();

    const payload = {
      licenseId: 'HSM-LIC-P17TEST',
      customer: { name: 'مكتب تجريبي', phone: '0100000000', email: 'x@example.com' },
      edition: 'Professional', type: 'yearly',
      machineId: originalMachineId,
      modules: ['AI'], issuedAt: '2026-01-01T00:00:00.000Z',
      expiresAt: '2099-01-01T00:00:00.000Z', supportUntil: '2099-01-01T00:00:00.000Z',
      graceDays: 15, maxTransfers: 2, transferCount: 0
    };
    const signature = signPayloadLikeGenerator(first.LicenseCrypto.canonicalStringify, payload, privatePem);
    globalThis.localStorage.setItem('hsm_license_record_v1', JSON.stringify({
      licenseFile: { v: 1, alg: 'ECDSA-P256-SHA256', payload, signature },
      activatedAt: '2026-01-01T00:00:00.000Z', lastOnlineCheck: null, revoked: false
    }));

    await asyncCheck('Scenario 4a — activation confirmed ACTIVE on first (portrait) cold start', async () => {
      const status = await first.LicenseCore.init();
      assert.strictEqual(status.state, first.LicenseCore.States.ACTIVE, 'reason=' + status.reason);
    });

    // Device is rotated, then closed and reopened — a fresh "page load".
    rotateToLandscape();
    const second = freshRequireLicenseModules();
    // localStorage (the fake Map-backed store) persists across reopens exactly like real localStorage would.

    await asyncCheck(
      'Scenario 4b — cold start after rotation still resolves ACTIVE, no machine_mismatch, no refresh required',
      async () => {
        const status = await second.LicenseCore.init();
        assert.strictEqual(status.state, second.LicenseCore.States.ACTIVE,
          'reason=' + status.reason + ' — this is exactly the reported "Activation Wizard reappears" bug');
      }
    );

    check('Scenario 4c — Machine ID after rotation is bit-for-bit identical to the one baked into the license (no pin needed)',
      (await second.MachineFingerprint.getMachineId()) === originalMachineId);
  }

  // ================================================================
  // Scenario 5 — NO MIGRATION, BY DESIGN: a license bearing a
  // machineId that does not match this device's CURRENT (only, single)
  // formula must fail closed — there is no old-formula/legacy
  // acceptance path of any kind. This is the direct replacement for
  // the old "Scenario 5 migration" test, which is no longer
  // applicable now that the pinning/migration layer has been removed.
  // ================================================================
  {
    installFakeBrowserGlobals();
    const run = freshRequireLicenseModules();
    const payload = {
      licenseId: 'HSM-LIC-FOREIGN', customer: {}, edition: 'Professional', type: 'lifetime',
      machineId: 'HSM-0000-0000-0000', modules: [], issuedAt: '2025-01-01T00:00:00.000Z',
      expiresAt: null, supportUntil: null, graceDays: 15, maxTransfers: 2, transferCount: 0
    };
    const signature = signPayloadLikeGenerator(run.LicenseCrypto.canonicalStringify, payload, privatePem);
    globalThis.localStorage.setItem('hsm_license_record_v1', JSON.stringify({
      licenseFile: { v: 1, payload, signature }, activatedAt: '2025-01-01T00:00:00.000Z',
      lastOnlineCheck: null, revoked: false
    }));

    await asyncCheck('Scenario 5 — a license for a machineId this device cannot reproduce is rejected as machine_mismatch (no migration/compat path exists)', async () => {
      const status = await run.LicenseCore.init();
      assert.strictEqual(status.state, run.LicenseCore.States.INVALID);
      assert.strictEqual(status.reason, 'machine_mismatch');
    });
  }

  // ================================================================
  // Scenario 6 (security regressions — must still fail after fix)
  // ================================================================
  {
    installFakeBrowserGlobals();
    const run = freshRequireLicenseModules();
    const myId = await run.MachineFingerprint.getMachineId();

    async function expectInvalid(label, payloadOverrides, opts) {
      opts = opts || {};
      const payload = Object.assign({
        licenseId: 'HSM-LIC-SEC', customer: {}, edition: 'Professional', type: 'yearly',
        machineId: myId, modules: [], issuedAt: '2025-01-01T00:00:00.000Z',
        expiresAt: '2020-01-01T00:00:00.000Z', supportUntil: null, graceDays: 0,
        maxTransfers: 2, transferCount: 0
      }, payloadOverrides);
      const signature = opts.badSignature
        ? 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=='
        : signPayloadLikeGenerator(run.LicenseCrypto.canonicalStringify, payload, privatePem);
      const finalPayload = opts.tamperAfterSign ? Object.assign({}, payload, opts.tamperAfterSign) : payload;
      globalThis.localStorage.setItem('hsm_license_record_v1', JSON.stringify({
        licenseFile: { v: 1, payload: finalPayload, signature }, activatedAt: '2025-01-01T00:00:00.000Z',
        lastOnlineCheck: null, revoked: false
      }));
      const runN = freshRequireLicenseModules();
      const status = await runN.LicenseCore.init();
      check(label, status.state !== runN.LicenseCore.States.ACTIVE, 'got state=' + status.state + ' reason=' + status.reason);
    }

    await expectInvalid('Scenario 6a — wrong machineId still rejected', { machineId: 'HSM-0000-0000-0000', expiresAt: '2099-01-01T00:00:00.000Z' });
    await expectInvalid('Scenario 6b — tampered payload (signed then edited) still rejected', { expiresAt: '2099-01-01T00:00:00.000Z' }, { tamperAfterSign: { edition: 'Enterprise' } });
    await expectInvalid('Scenario 6c — bad signature still rejected', { expiresAt: '2099-01-01T00:00:00.000Z' }, { badSignature: true });

    installFakeBrowserGlobals();
    const runMissing = freshRequireLicenseModules();
    await asyncCheck('Scenario 6d — deleted localStorage license -> NOT_ACTIVATED', async () => {
      const status = await runMissing.LicenseCore.init();
      assert.strictEqual(status.state, runMissing.LicenseCore.States.NOT_ACTIVATED);
    });
  }

  // ---- Summary ----
  console.log(log.join('\n'));
  console.log('\n' + passed + '/' + (passed + failed) + ' checks passed.');
  if (failed > 0) {
    console.log('\n' + failed + ' CHECK(S) FAILED.');
    process.exitCode = 1;
  }
}

main();
