/**
 * ================================================================
 * verify_license_startup_state_persistence.js — PROBLEM 16
 * نظام الحسام للمحاماة | Phase 30 Licensing — Startup Race Guard
 * ================================================================
 * Standalone Node harness, same style/conventions as
 * js/tests/verify_license_core.js (no browser, no external deps).
 *
 * WHAT THIS PROVES
 * -----------------
 * Root cause of "شاشة التفعيل تظهر مرة أخرى رغم وجود ترخيص صالح،
 * ويختفي بعد Refresh": js/license/LicenseCrypto.js computes
 *
 *     var SUBTLE = window.crypto && window.crypto.subtle;
 *
 * exactly ONCE, at <script> parse time, and every later call
 * (isAvailable(), verify(), sha256Hex()) reads that captured value
 * forever — it never looks at window.crypto.subtle again.
 *
 * On most devices window.crypto.subtle already exists the instant
 * the script parses, so this is invisible. But on some devices —
 * confirmed classes: certain Android System WebView builds that
 * attach SubtleCrypto lazily, and privacy/ad-block browser
 * extensions that reinstall a wrapped `window.crypto` after the
 * page's own <script> tags have already executed — Web Crypto is
 * NOT yet present at the moment LicenseCrypto.js's IIFE runs, but
 * IS present a few milliseconds later, well before the user ever
 * looks at the screen.
 *
 * Consequence, traced end to end through the real startup chain
 * (index.html -> LicenseCore.init() -> reevaluate() ->
 * verifyLicenseFile() -> LicenseCrypto.isAvailable()):
 *   isAvailable() permanently reports false for the rest of that
 *   page's lifetime -> verifyLicenseFile() returns
 *   {ok:false, reason:'crypto_unavailable'} -> reevaluate() sets
 *   state = INVALID, even though the stored license is 100% genuine
 *   and unexpired -> ActivationWizard shows its full-screen overlay.
 *   A Refresh reloads every <script> from scratch; by then Web
 *   Crypto is already attached, so the fresh capture of SUBTLE is
 *   truthy and the exact same stored license verifies -> ACTIVE.
 *
 * This is a genuine "UNKNOWN treated as INVALID" bug in exactly the
 * shape described in PROBLEM 16, just with the delayed signal being
 * Web Crypto readiness rather than IndexedDB/localStorage.
 *
 * TEST STRATEGY
 * --------------
 * Each scenario below spins up a FRESH require of LicenseCrypto.js /
 * MachineFingerprint.js / LicenseCore.js (require.cache is cleared
 * first) against a controlled globalThis.crypto, so "script parse
 * time" can be precisely simulated: crypto.subtle absent at the
 * instant of require(), then attached immediately after — exactly
 * mirroring "absent when the <script> tag executes, present a moment
 * later" on a real device. A fake in-memory localStorage
 * (globalThis.localStorage) carries a genuinely-signed, unexpired,
 * correct-machineId license record across the simulated reload, so
 * every assertion below exercises the REAL LicenseCore/LicenseCrypto
 * source files, not a mock of them.
 *
 * Run: node js/tests/verify_license_startup_state_persistence.js
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

// ----------------------------------------------------------------
// Fake in-memory storage + minimal DOM-ish globals LicenseCore.js
// needs (window.localStorage, window.dispatchEvent/CustomEvent).
// Fresh instance per scenario so scenarios never leak state.
// ----------------------------------------------------------------
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
  return { store, events };
}

/**
 * Simulates "the <script> tag executes while window.crypto.subtle is
 * not yet attached" by removing globalThis.crypto.subtle, requiring
 * a FRESH copy of LicenseCrypto.js (its IIFE captures SUBTLE at this
 * exact instant), then — mirroring the real devices this reproduces
 * on — reattaching a fully-working crypto.subtle a moment later,
 * before any license verification actually runs.
 */
function freshRequireWithDelayedCrypto(delayedAttachRealCrypto) {
  delete require.cache[require.resolve(LICENSE_CRYPTO_PATH)];
  delete require.cache[require.resolve(MACHINE_FP_PATH)];
  delete require.cache[require.resolve(LICENSE_CORE_PATH)];

  const realCrypto = globalThis.crypto;
  // "Not yet attached" — same observable shape as the affected devices
  // (window.crypto exists, .subtle does not) rather than window.crypto
  // being fully absent.
  Object.defineProperty(globalThis, 'crypto', {
    value: { getRandomValues: realCrypto.getRandomValues.bind(realCrypto) },
    configurable: true,
    writable: true
  });

  const LicenseCrypto = require(LICENSE_CRYPTO_PATH);
  globalThis.LicenseCrypto = LicenseCrypto;
  const MachineFingerprint = require(MACHINE_FP_PATH);
  globalThis.MachineFingerprint = MachineFingerprint;
  const LicenseCore = require(LICENSE_CORE_PATH);
  globalThis.LicenseCore = LicenseCore;

  if (delayedAttachRealCrypto) {
    // "a moment later" — attach the real, fully-capable crypto object
    // BEFORE the app ever calls isAvailable()/verify(), exactly as
    // happens on the affected devices (the delay is milliseconds,
    // long before a human perceives the activation screen).
    globalThis.crypto = realCrypto;
  }

  return { LicenseCrypto, MachineFingerprint, LicenseCore, realCrypto };
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
  globalThis.HOSSAM_LICENSE_PUBLIC_KEY_JWK = publicJwk;

  // ================================================================
  // Scenario 1 — reproduces the exact reported bug end-to-end:
  // a genuinely valid, unexpired, correct-machineId license is
  // already stored locally; crypto.subtle attaches a moment AFTER
  // the license modules have already loaded (the "some devices
  // only" timing). Cold start must still resolve to ACTIVE.
  // ================================================================
  {
    installFakeBrowserGlobals();
    const { LicenseCrypto, MachineFingerprint, LicenseCore } =
      freshRequireWithDelayedCrypto(/* delayedAttachRealCrypto */ true);

    const myMachineId = await MachineFingerprint.getMachineId();
    const payload = {
      licenseId: 'HSM-LIC-P16TEST',
      customer: { name: 'مكتب تجريبي', phone: '0100000000', email: 'x@example.com' },
      edition: 'Professional',
      type: 'yearly',
      machineId: myMachineId,
      modules: ['AI'],
      issuedAt: '2026-01-01T00:00:00.000Z',
      expiresAt: '2099-01-01T00:00:00.000Z', // far future — must never be GRACE/READ_ONLY in this test
      supportUntil: '2099-01-01T00:00:00.000Z',
      graceDays: 15,
      maxTransfers: 2,
      transferCount: 0
    };
    const signature = signPayloadLikeGenerator(LicenseCrypto.canonicalStringify, payload, privatePem);
    const licenseFile = { v: 1, alg: 'ECDSA-P256-SHA256', payload, signature };

    // Persist exactly the shape LicenseCore.activate() would have
    // written on a prior, successful activation.
    globalThis.localStorage.setItem('hsm_license_record_v1', JSON.stringify({
      licenseFile: licenseFile,
      activatedAt: '2026-01-01T00:00:00.000Z',
      lastOnlineCheck: null,
      revoked: false
    }));

    await asyncCheck(
      'Scenario 1 — LicenseCrypto.isAvailable() reflects the NOW-present crypto.subtle, not a stale parse-time snapshot',
      async () => {
        assert.strictEqual(LicenseCrypto.isAvailable(), true,
          'isAvailable() returned false even though crypto.subtle is available again before first use — this is the exact "شاشة تفعيل تظهر رغم ترخيص صالح" bug');
      }
    );

    await asyncCheck(
      'Scenario 1 — cold startup with a valid persisted license resolves to ACTIVE (not INVALID/crypto_unavailable), simulating the exact user-reported bug',
      async () => {
        const status = await LicenseCore.init();
        assert.strictEqual(status.state, LicenseCore.States.ACTIVE,
          'reason=' + status.reason + ' — Activation Wizard would incorrectly show on cold start for a device where Web Crypto attaches a moment late');
      }
    );
  }

  // ================================================================
  // Scenario 2 — same delayed-crypto timing, but proves this does
  // NOT weaken security: an absent license must still show Activation.
  // ================================================================
  {
    installFakeBrowserGlobals();
    const { LicenseCore } = freshRequireWithDelayedCrypto(true);
    await asyncCheck('Scenario 2 — no license stored + delayed crypto -> still NOT_ACTIVATED', async () => {
      const status = await LicenseCore.init();
      assert.strictEqual(status.state, LicenseCore.States.NOT_ACTIVATED);
    });
  }

  // ================================================================
  // Scenario 3 — delayed crypto + a REAL tampered signature must
  // still be rejected (INVALID), never silently accepted.
  // ================================================================
  {
    installFakeBrowserGlobals();
    const { LicenseCrypto, MachineFingerprint, LicenseCore } = freshRequireWithDelayedCrypto(true);
    const myMachineId = await MachineFingerprint.getMachineId();
    const payload = {
      licenseId: 'HSM-LIC-TAMPERED', customer: {}, edition: 'Professional', type: 'yearly',
      machineId: myMachineId, modules: [], issuedAt: '2026-01-01T00:00:00.000Z',
      expiresAt: '2099-01-01T00:00:00.000Z', supportUntil: null, graceDays: 15,
      maxTransfers: 2, transferCount: 0
    };
    const signature = signPayloadLikeGenerator(LicenseCrypto.canonicalStringify, payload, privatePem);
    const tamperedPayload = Object.assign({}, payload, { edition: 'Enterprise' }); // tamper after signing
    globalThis.localStorage.setItem('hsm_license_record_v1', JSON.stringify({
      licenseFile: { v: 1, payload: tamperedPayload, signature: signature },
      activatedAt: '2026-01-01T00:00:00.000Z', lastOnlineCheck: null, revoked: false
    }));
    await asyncCheck('Scenario 3 — delayed crypto + tampered payload -> still INVALID (security preserved)', async () => {
      const status = await LicenseCore.init();
      assert.strictEqual(status.state, LicenseCore.States.INVALID);
      assert.strictEqual(status.reason, 'invalid_signature');
    });
  }

  // ================================================================
  // Scenario 4 — delayed crypto + genuinely expired license, past
  // grace -> still READ_ONLY, never ACTIVE.
  // ================================================================
  {
    installFakeBrowserGlobals();
    const { LicenseCrypto, MachineFingerprint, LicenseCore } = freshRequireWithDelayedCrypto(true);
    const myMachineId = await MachineFingerprint.getMachineId();
    const payload = {
      licenseId: 'HSM-LIC-EXPIRED', customer: {}, edition: 'Professional', type: 'yearly',
      machineId: myMachineId, modules: [], issuedAt: '2020-01-01T00:00:00.000Z',
      expiresAt: '2020-02-01T00:00:00.000Z', supportUntil: null, graceDays: 15,
      maxTransfers: 2, transferCount: 0
    };
    const signature = signPayloadLikeGenerator(LicenseCrypto.canonicalStringify, payload, privatePem);
    globalThis.localStorage.setItem('hsm_license_record_v1', JSON.stringify({
      licenseFile: { v: 1, payload, signature }, activatedAt: '2020-01-01T00:00:00.000Z',
      lastOnlineCheck: null, revoked: false
    }));
    await asyncCheck('Scenario 4 — delayed crypto + long-expired license -> READ_ONLY, not ACTIVE', async () => {
      const status = await LicenseCore.init();
      assert.strictEqual(status.state, LicenseCore.States.READ_ONLY);
    });
  }

  // ================================================================
  // Scenario 5 — machine mismatch must still block activation even
  // with the delayed-crypto timing.
  // ================================================================
  {
    installFakeBrowserGlobals();
    const { LicenseCrypto, LicenseCore } = freshRequireWithDelayedCrypto(true);
    const payload = {
      licenseId: 'HSM-LIC-OTHERMACHINE', customer: {}, edition: 'Professional', type: 'yearly',
      machineId: 'HSM-0000-0000-0000', modules: [], issuedAt: '2026-01-01T00:00:00.000Z',
      expiresAt: '2099-01-01T00:00:00.000Z', supportUntil: null, graceDays: 15,
      maxTransfers: 2, transferCount: 0
    };
    const signature = signPayloadLikeGenerator(LicenseCrypto.canonicalStringify, payload, privatePem);
    globalThis.localStorage.setItem('hsm_license_record_v1', JSON.stringify({
      licenseFile: { v: 1, payload, signature }, activatedAt: '2026-01-01T00:00:00.000Z',
      lastOnlineCheck: null, revoked: false
    }));
    await asyncCheck('Scenario 5 — delayed crypto + machine mismatch -> INVALID/machine_mismatch', async () => {
      const status = await LicenseCore.init();
      assert.strictEqual(status.state, LicenseCore.States.INVALID);
      assert.strictEqual(status.reason, 'machine_mismatch');
    });
  }

  // ================================================================
  // Scenario 6 — "close app / reopen app" twice in a row (two
  // separate simulated cold starts against the SAME persisted
  // license), each with its own independent delayed-crypto timing.
  // Both must resolve ACTIVE — proves this isn't a one-shot fluke.
  // ================================================================
  {
    installFakeBrowserGlobals();
    let savedRecord;
    {
      const { LicenseCrypto, MachineFingerprint } = freshRequireWithDelayedCrypto(true);
      const myMachineId = await MachineFingerprint.getMachineId();
      const payload = {
        licenseId: 'HSM-LIC-REOPEN', customer: {}, edition: 'Professional', type: 'lifetime',
        machineId: myMachineId, modules: [], issuedAt: '2026-01-01T00:00:00.000Z',
        expiresAt: null, supportUntil: null, graceDays: 15, maxTransfers: 2, transferCount: 0
      };
      const signature = signPayloadLikeGenerator(LicenseCrypto.canonicalStringify, payload, privatePem);
      savedRecord = { licenseFile: { v: 1, payload, signature }, activatedAt: '2026-01-01T00:00:00.000Z', lastOnlineCheck: null, revoked: false };
      globalThis.localStorage.setItem('hsm_license_record_v1', JSON.stringify(savedRecord));
    }
    for (let reopen = 1; reopen <= 2; reopen++) {
      const { LicenseCore } = freshRequireWithDelayedCrypto(true); // fresh module instances = fresh "page load"
      globalThis.localStorage.setItem('hsm_license_record_v1', JSON.stringify(savedRecord)); // storage itself persists across reopens
      await asyncCheck('Scenario 6 — reopen #' + reopen + ' of the app resolves ACTIVE without any refresh workaround', async () => {
        const status = await LicenseCore.init();
        assert.strictEqual(status.state, LicenseCore.States.ACTIVE);
      });
    }
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
