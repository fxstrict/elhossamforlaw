/**
 * ============================================================================
 * PHASE 30 — ENTERPRISE LICENSING & PROTECTION FRAMEWORK
 * File: js/license/license-public-key.js
 * ----------------------------------------------------------------------------
 * PUBLIC key only — this is meant to be public and safe to ship inside
 * the app. It can verify signatures but can never create one.
 *
 * This is a TEST/DEMO key pair generated once, during Phase 30
 * development, purely to prove the end-to-end sign → ship → verify
 * flow actually works (see docs/phase30 for the round-trip test
 * output). Its matching private key was intentionally NOT included in
 * this delivery — it never leaves the sandbox it was generated in, per
 * the brief's own requirement that the private key must exist only on
 * a machine you control.
 *
 * ⚠️ REQUIRED BEFORE ISSUING ANY REAL CUSTOMER LICENSE:
 *   Run `node tools/license-generator/generate-license.js` once on
 *   YOUR OWN machine (no existing keys/ folder there, so it will
 *   generate a brand-new pair). Then replace the JWK object below with
 *   the contents of the public-key.jwk.json it produces. Until you do
 *   this, the app will correctly REJECT every license file as
 *   "invalid_signature" — that is the intended fail-closed behavior,
 *   not a bug. See docs/phase30 Operations Guide, "تدوير المفاتيح".
 *
 * 100% additive: defines exactly one new global,
 * window.HOSSAM_LICENSE_PUBLIC_KEY_JWK.
 * ============================================================================
 */
(typeof window !== 'undefined' ? window : globalThis).HOSSAM_LICENSE_PUBLIC_KEY_JWK = {
  "kty": "EC",
  "crv": "P-256",
  "x": "d4H0mnYLA6BZwCA1pI5-75f4vFgGInEHw8qeANAc8Lk",
  "y": "k7qo7LYGYfpedLv4WfX6G425bVJBX-vtjx5ZvFKf_Q4"
};
