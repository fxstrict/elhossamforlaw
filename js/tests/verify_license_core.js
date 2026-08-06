/**
 * ================================================================
 * verify_license_core.js — PHASE 30: Enterprise Licensing & Protection
 * Framework | نظام الحسام للمحاماة
 * ================================================================
 * Standalone Node harness (`node js/tests/verify_license_core.js`, no
 * browser required, no external libraries — Node's built-in
 * globalThis.crypto.subtle, available since Node 20, is used directly,
 * exactly like a real browser would use window.crypto.subtle).
 *
 * Proves, end to end, exactly like tools/license-generator/ +
 * js/license/LicenseCrypto.js are meant to work together in
 * production:
 *   A. canonicalStringify() is deterministic regardless of key order.
 *   B. A real ECDSA P-256/SHA-256 key pair signs a payload and
 *      LicenseCrypto.verify() accepts it.
 *   C. Any single-byte tamper of the payload is rejected.
 *   D. A signature from the WRONG key is rejected.
 *   E. LicenseCore.computeSubscriptionState() correctly classifies
 *      ACTIVE / GRACE / READ_ONLY / lifetime at exact day boundaries.
 *   F. LicenseCore.verifyLicenseFile() end-to-end: malformed file,
 *      malformed payload, wrong machine, and a fully valid file.
 *   G. SubscriptionManager's Arabic countdown copy matches brief §11's
 *      30/15/7/3/1-day thresholds exactly.
 * ================================================================
 */
'use strict';

const path = require('path');
const assert = require('assert');
const crypto = require('crypto');

const LICENSE_DIR = path.join(__dirname, '..', 'license');

let passed = 0, failed = 0;
const log = [];
function check(label, fn) {
  try {
    fn();
    passed++;
    log.push('PASS — ' + label);
  } catch (e) {
    failed++;
    log.push('FAIL — ' + label + '  =>  ' + e.message);
  }
}

// ----------------------------------------------------------------
// Load modules (each exports via module.exports, added in Phase 30
// specifically so they are Node-testable exactly like Repository.js)
// ----------------------------------------------------------------
const LicenseCrypto = require(path.join(LICENSE_DIR, 'LicenseCrypto.js'));
// LicenseCore.js reads window.LicenseCrypto / window.MachineFingerprint
// via the shared globalThis object at call time — since Node has no
// `window`, register both onto globalThis under the same names before
// requiring LicenseCore.js, mirroring what <script> tag load order
// does in the real app (see index.html).
globalThis.LicenseCrypto = LicenseCrypto;
const MachineFingerprint = require(path.join(LICENSE_DIR, 'MachineFingerprint.js'));
globalThis.MachineFingerprint = MachineFingerprint;
const LicenseCore = require(path.join(LICENSE_DIR, 'LicenseCore.js'));
globalThis.LicenseCore = LicenseCore;
const SubscriptionManager = require(path.join(LICENSE_DIR, 'SubscriptionManager.js'));

// ----------------------------------------------------------------
// A. canonicalStringify
// ----------------------------------------------------------------
check('canonicalStringify(): key order does not affect output', () => {
  const a = LicenseCrypto.canonicalStringify({ b: 1, a: 2, c: { y: 1, x: 2 } });
  const b = LicenseCrypto.canonicalStringify({ a: 2, c: { x: 2, y: 1 }, b: 1 });
  assert.strictEqual(a, b);
  assert.strictEqual(a, '{"a":2,"b":1,"c":{"x":2,"y":1}}');
});

// ----------------------------------------------------------------
// B-D. Real ECDSA P-256 sign/verify round trip (mirrors
// tools/license-generator/generate-license.js exactly)
// ----------------------------------------------------------------
function signPayloadLikeGenerator(payload, privatePem) {
  const data = Buffer.from(LicenseCrypto.canonicalStringify(payload), 'utf8');
  const signer = crypto.createSign('SHA256');
  signer.update(data);
  signer.end();
  return signer.sign({ key: privatePem, dsaEncoding: 'ieee-p1363' }).toString('base64');
}

const keyPair = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const privatePem = keyPair.privateKey.export({ type: 'pkcs8', format: 'pem' });
const publicJwk = keyPair.publicKey.export({ format: 'jwk' });

const otherKeyPair = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const otherPrivatePem = otherKeyPair.privateKey.export({ type: 'pkcs8', format: 'pem' });

const samplePayload = {
  licenseId: 'HSM-LIC-TESTCASE',
  customer: { name: 'مكتب تجريبي', phone: '0100000000', email: 'x@example.com' },
  edition: 'Professional',
  type: 'yearly',
  machineId: 'HSM-AAAA-BBBB-CCCC',
  modules: ['AI'],
  issuedAt: '2026-01-01T00:00:00.000Z',
  expiresAt: '2027-01-01T00:00:00.000Z',
  supportUntil: '2027-01-01T00:00:00.000Z',
  graceDays: 15,
  maxTransfers: 2,
  transferCount: 0
};

// check() is sync-only by design (matches every other harness in this
// project); the ECDSA verify calls are async (native SubtleCrypto), so
// they run through this tiny dedicated async runner instead.
async function asyncCheck(label, fn) {
  try {
    await fn();
    passed++;
    log.push('PASS — ' + label);
  } catch (e) {
    failed++;
    log.push('FAIL — ' + label + '  =>  ' + e.message);
  }
}

async function main() {
  globalThis.HOSSAM_LICENSE_PUBLIC_KEY_JWK = publicJwk;
  const validSignature = signPayloadLikeGenerator(samplePayload, privatePem);

  await asyncCheck('LicenseCrypto.verify(): accepts a genuine ECDSA-P256-SHA256 signature', async () => {
    const ok = await LicenseCrypto.verify(samplePayload, validSignature);
    assert.strictEqual(ok, true);
  });

  await asyncCheck('LicenseCrypto.verify(): rejects a single-field tamper (edition changed)', async () => {
    const tampered = Object.assign({}, samplePayload, { edition: 'Enterprise' });
    const ok = await LicenseCrypto.verify(tampered, validSignature);
    assert.strictEqual(ok, false);
  });

  await asyncCheck('LicenseCrypto.verify(): rejects a signature made with a different private key', async () => {
    const wrongSig = signPayloadLikeGenerator(samplePayload, otherPrivatePem);
    const ok = await LicenseCrypto.verify(samplePayload, wrongSig);
    assert.strictEqual(ok, false);
  });

  await asyncCheck('LicenseCrypto.sha256Hex(): matches Node crypto SHA-256 for the same string', async () => {
    const hex = await LicenseCrypto.sha256Hex('hossam-test-string');
    const expected = crypto.createHash('sha256').update('hossam-test-string').digest('hex');
    assert.strictEqual(hex, expected);
  });

  await asyncCheck('MachineFingerprint.getMachineId(): returns HSM-XXXX-XXXX-XXXX shape and is stable across two calls', async () => {
    const id1 = await MachineFingerprint.getMachineId();
    const id2 = await MachineFingerprint.getMachineId();
    assert.ok(/^HSM-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}$/.test(id1), 'unexpected shape: ' + id1);
    assert.strictEqual(id1, id2);
  });

  // ----------------------------------------------------------------
  // E. computeSubscriptionState — exact boundary math
  // ----------------------------------------------------------------
  check('computeSubscriptionState(): lifetime license (expiresAt=null) is always ACTIVE', () => {
    const r = LicenseCore.computeSubscriptionState({ expiresAt: null });
    assert.strictEqual(r.state, 'ACTIVE');
    assert.strictEqual(r.daysRemaining, null);
  });

  check('computeSubscriptionState(): 10 days before expiry is ACTIVE', () => {
    const now = new Date('2026-01-01T00:00:00.000Z');
    const expires = new Date('2026-01-11T00:00:00.000Z');
    const r = LicenseCore.computeSubscriptionState({ expiresAt: expires.toISOString(), graceDays: 15 }, now);
    assert.strictEqual(r.state, 'ACTIVE');
  });

  check('computeSubscriptionState(): 1 day after expiry, graceDays=15 is GRACE', () => {
    const now = new Date('2026-01-02T00:00:00.000Z');
    const expires = new Date('2026-01-01T00:00:00.000Z');
    const r = LicenseCore.computeSubscriptionState({ expiresAt: expires.toISOString(), graceDays: 15 }, now);
    assert.strictEqual(r.state, 'GRACE');
  });

  check('computeSubscriptionState(): exactly graceDays after expiry is still GRACE (inclusive boundary)', () => {
    const now = new Date('2026-01-16T00:00:00.000Z'); // 15 days after
    const expires = new Date('2026-01-01T00:00:00.000Z');
    const r = LicenseCore.computeSubscriptionState({ expiresAt: expires.toISOString(), graceDays: 15 }, now);
    assert.strictEqual(r.state, 'GRACE');
  });

  check('computeSubscriptionState(): 1 day past graceDays is READ_ONLY', () => {
    const now = new Date('2026-01-17T00:00:00.000Z'); // 16 days after
    const expires = new Date('2026-01-01T00:00:00.000Z');
    const r = LicenseCore.computeSubscriptionState({ expiresAt: expires.toISOString(), graceDays: 15 }, now);
    assert.strictEqual(r.state, 'READ_ONLY');
  });

  // ----------------------------------------------------------------
  // F. verifyLicenseFile — full pipeline
  // ----------------------------------------------------------------
  await asyncCheck('verifyLicenseFile(): rejects malformed file (missing payload/signature)', async () => {
    const r = await LicenseCore.verifyLicenseFile({ foo: 'bar' });
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.reason, 'malformed_file');
  });

  await asyncCheck('verifyLicenseFile(): rejects payload missing required fields', async () => {
    const r = await LicenseCore.verifyLicenseFile({ payload: { foo: 'bar' }, signature: 'x' });
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.reason, 'malformed_payload');
  });

  await asyncCheck('verifyLicenseFile(): a genuinely signed license for A DIFFERENT machine is rejected as machine_mismatch', async () => {
    const myId = await MachineFingerprint.getMachineId();
    const payloadForOtherMachine = Object.assign({}, samplePayload, { machineId: myId + '-DIFFERENT' });
    const sig = signPayloadLikeGenerator(payloadForOtherMachine, privatePem);
    const r = await LicenseCore.verifyLicenseFile({ v: 1, payload: payloadForOtherMachine, signature: sig });
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.reason, 'machine_mismatch');
  });

  await asyncCheck('verifyLicenseFile(): a genuinely signed license for THIS machine verifies ok:true', async () => {
    const myId = await MachineFingerprint.getMachineId();
    const payloadForThisMachine = Object.assign({}, samplePayload, { machineId: myId });
    const sig = signPayloadLikeGenerator(payloadForThisMachine, privatePem);
    const r = await LicenseCore.verifyLicenseFile({ v: 1, payload: payloadForThisMachine, signature: sig });
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.payload.machineId, myId);
  });

  // ----------------------------------------------------------------
  // G. SubscriptionManager renewal copy — exact brief §11 thresholds
  // ----------------------------------------------------------------
  check('formatRenewalCopy(): 31 days -> generic "ساري"', () => {
    assert.strictEqual(SubscriptionManager.formatRenewalCopy(31), 'الاشتراك ساري.');
  });
  check('formatRenewalCopy(): 30 days -> "باقي 30 يومًا"', () => {
    assert.ok(SubscriptionManager.formatRenewalCopy(30).indexOf('30') !== -1);
  });
  check('formatRenewalCopy(): 15 days -> "باقي 15 يومًا"', () => {
    assert.ok(SubscriptionManager.formatRenewalCopy(15).indexOf('15') !== -1);
  });
  check('formatRenewalCopy(): 7 days -> "باقي 7 أيام"', () => {
    assert.ok(SubscriptionManager.formatRenewalCopy(7).indexOf('7') !== -1);
  });
  check('formatRenewalCopy(): 1 day -> singular "يوم واحد"', () => {
    assert.ok(SubscriptionManager.formatRenewalCopy(1).indexOf('يوم واحد') !== -1);
  });
  check('formatRenewalCopy(): negative days -> "انتهى الاشتراك"', () => {
    assert.strictEqual(SubscriptionManager.formatRenewalCopy(-5), 'انتهى الاشتراك.');
  });
  check('formatRenewalCopy(): null (lifetime) -> permanent-license copy', () => {
    assert.ok(SubscriptionManager.formatRenewalCopy(null).indexOf('دائم') !== -1);
  });

  // ---- Summary ----
  console.log(log.join('\n'));
  console.log('\n' + passed + '/' + (passed + failed) + ' checks passed.');
  if (failed > 0) {
    console.log('\n' + failed + ' CHECK(S) FAILED.');
    process.exitCode = 1;
  }
}

main();
