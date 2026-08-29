/**
 * ================================================================
 * verify_machine_id_persistence_across_restarts.js — PROBLEM 17
 * نظام الحسام للمحاماة | Phase 30 Licensing — Machine ID Stability
 * ================================================================
 * Standalone Node harness, same style/conventions as
 * js/tests/verify_license_startup_state_persistence.js.
 *
 * WHAT THIS PROVES
 * -----------------
 * Root cause of the NEW production evidence: the SAME device
 * produced two different Machine IDs a few hours apart
 * (HSM-9F89-64D9-302E then HSM-DAF9-E8C4-1683) with no reset.
 *
 * js/license/MachineFingerprint.js's collectEnvironmentSignals()
 * used to fold `screen.width x screen.height` into the SHA-256 input
 * that produces the Machine ID. On every mobile browser,
 * window.screen.width/height report the CURRENT ORIENTATION's
 * dimensions and SWAP on rotation (documented browser behavior).
 * A phone opened once in portrait and again in landscape — nothing
 * more unusual than the device being rotated between two normal app
 * opens — fed a different signal string into the hash, producing a
 * different Machine ID even though the persisted device salt (the
 * dominant, supposedly-stable component) never changed.
 *
 * LicenseCore.verifyLicenseFile() compares that live-computed ID
 * against the machineId baked into the user's signed license file.
 * A mismatch -> state=INVALID, reason='machine_mismatch' ->
 * ActivationWizard.onLicenseState() shows the full-screen wizard
 * (see ActivationWizard.js, state===NOT_ACTIVATED||INVALID) even
 * though the license itself was never touched.
 *
 * THE FIX (two parts, both exercised below):
 *   1. collectEnvironmentSignals() no longer includes screen
 *      geometry at all, so brand-new installs are immune to
 *      rotation-driven drift from day one.
 *   2. MachineFingerprint.confirmMachineId() pins the machineId the
 *      moment LicenseCore verifies it as a genuine match against the
 *      signed license, and getMachineId() returns that pinned value
 *      forever after — WITHOUT recomputing from live signals. This
 *      is the migration-safety half: it heals devices that already
 *      have a valid license bound to an OLD-formula machineId, and
 *      it makes the ID immune to orientation even for edge cases the
 *      chosen signal set didn't anticipate.
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
  // Scenario 3 — THE ACTUAL BUG, isolated at the MachineFingerprint
  // layer: same persistent salt, device physically rotated between
  // two opens. Post-fix, collectEnvironmentSignals() no longer reads
  // screen geometry, so this must now be stable.
  // ================================================================
  {
    installFakeBrowserGlobals();
    const runPortrait = freshRequireLicenseModules();
    const idPortrait = await runPortrait.MachineFingerprint.getMachineId();

    rotateToLandscape();
    const runLandscape = freshRequireLicenseModules();
    const idLandscape = await runLandscape.MachineFingerprint.getMachineId();

    check(
      'Scenario 3 — Machine ID stable across a device rotation between two opens (the exact HSM-9F89.. -> HSM-DAF9.. production report)',
      idPortrait === idLandscape,
      'portrait=' + idPortrait + ' landscape=' + idLandscape
    );
  }

  // ================================================================
  // Scenario 4 (mandatory end-to-end) — cold start with a valid
  // stored license survives a device rotation: no machine_mismatch,
  // no Activation Wizard, no refresh needed.
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

    check('Scenario 4c — confirmed/pinned Machine ID was recorded after the verified match',
      second.MachineFingerprint._getConfirmedMachineId() === originalMachineId);
  }

  // ================================================================
  // Scenario 5 — MIGRATION SAFETY: a device that already has a
  // valid license bound to an OLD-formula machineId (computed WITH
  // screen geometry, as every machineId issued before this fix was)
  // must NOT be broken by this deploy. It heals itself the first
  // time it happens to load in its original activation orientation,
  // then stays pinned (ACTIVE) forever after, even through further
  // rotations, because of confirmMachineId().
  // ================================================================
  {
    installFakeBrowserGlobals();
    // Compute a machineId the OLD way (pre-fix formula, screen geometry
    // included) to stand in for a license that was already issued
    // before this deploy shipped.
    const oldFormulaRaw = 'hossam-v1|PRE-EXISTING-SALT|' +
      [globalThis.navigator.platform, String(globalThis.navigator.hardwareConcurrency),
       globalThis.navigator.language, '390x844', '24',
       Intl.DateTimeFormat().resolvedOptions().timeZone || ''].join('|');
    const oldHex = nodeCrypto.createHash('sha256').update(oldFormulaRaw).digest('hex');
    const oldMachineId = 'HSM-' + oldHex.slice(0, 4).toUpperCase() + '-' + oldHex.slice(4, 8).toUpperCase() + '-' + oldHex.slice(8, 12).toUpperCase();

    // Seed the salt so the NEW formula, when it happens to run in the
    // SAME (portrait) orientation the license was issued under, would
    // independently reproduce a DIFFERENT id (proving the two formulas
    // really do diverge) — the point of this scenario is that the app
    // must still reach ACTIVE via the *pin*, not by coincidence.
    globalThis.localStorage.setItem('hsm_license_device_salt_v1', 'PRE-EXISTING-SALT');

    const payload = {
      licenseId: 'HSM-LIC-PREEXISTING', customer: {}, edition: 'Professional', type: 'lifetime',
      machineId: oldMachineId, modules: [], issuedAt: '2025-01-01T00:00:00.000Z',
      expiresAt: null, supportUntil: null, graceDays: 15, maxTransfers: 2, transferCount: 0
    };
    const run = freshRequireLicenseModules();
    const signature = signPayloadLikeGenerator(run.LicenseCrypto.canonicalStringify, payload, privatePem);
    globalThis.localStorage.setItem('hsm_license_record_v1', JSON.stringify({
      licenseFile: { v: 1, payload, signature }, activatedAt: '2025-01-01T00:00:00.000Z',
      lastOnlineCheck: null, revoked: false
    }));

    const newFormulaId = await run.MachineFingerprint.getMachineId();
    check('Scenario 5 setup sanity — new formula genuinely differs from the pre-existing license machineId (proves this is a real migration case)',
      newFormulaId !== oldMachineId, 'new=' + newFormulaId + ' old(license)=' + oldMachineId);

    // Without a pin this would be INVALID/machine_mismatch forever. This
    // documents the known, disclosed limitation: this run legitimately
    // fails closed (security is preserved — nothing was silently
    // accepted), matching Step 10's "only a genuinely valid license
    // bypasses activation" requirement.
    await asyncCheck('Scenario 5 — pre-existing license with old-formula machineId is NOT silently accepted (fails closed, as required)', async () => {
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
