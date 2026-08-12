#!/usr/bin/env node
/**
 * ============================================================================
 * PHASE 30 — ENTERPRISE LICENSING & PROTECTION FRAMEWORK
 * File: tools/license-generator/generate-license.js
 * ----------------------------------------------------------------------------
 * Component 3 "License Generator" of the licensing brief. This is a
 * SEPARATE program from the Hossam app itself, exactly as specified
 * ("برنامج منفصل لديك فقط") — it runs locally on YOUR machine only via
 * Node.js, is never deployed, never bundled into the PWA, and never
 * uploaded anywhere. It is the ONLY place the private signing key
 * exists.
 *
 * FIRST RUN — key pair setup (happens automatically if missing):
 *   Generates an ECDSA P-256 key pair with Node's built-in `crypto`
 *   module (no npm dependency at all — this script has zero external
 *   packages, deliberately, so there is nothing to audit or update).
 *   - Private key -> tools/license-generator/keys/private-key.pem
 *     NEVER commit this file. .gitignore in this folder already
 *     excludes keys/.
 *   - Public key (JWK) -> printed to console AND written to
 *     tools/license-generator/keys/public-key.jwk.json, with the exact
 *     contents you paste into js/license/license-public-key.js in the
 *     app (that file currently ships with a PLACEHOLDER key — the app
 *     will reject every license file's signature until you replace it
 *     with your real public key. This is intentional fail-closed
 *     behavior, not a bug).
 *
 * USAGE:
 *   node generate-license.js
 *   (interactive prompts — customer name/phone/email, edition, type,
 *   Machine ID the customer sent you, modules, expiry)
 *
 *   or non-interactively:
 *   node generate-license.js --json input.json --out customer.hsm
 *
 * OUTPUT: a `<customer>.hsm` file (plain JSON) — send it back to the
 * customer by any channel (email/WhatsApp/USB). They paste or upload it
 * in the Activation Wizard. No server, no internet required on either
 * side for this exchange.
 * ============================================================================
 */
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const readline = require('readline');

const KEYS_DIR = path.join(__dirname, 'keys');
const PRIVATE_KEY_PATH = path.join(KEYS_DIR, 'private-key.pem');
const PUBLIC_KEY_JWK_PATH = path.join(KEYS_DIR, 'public-key.jwk.json');

// ---------------------------------------------------------------------------
// Canonical JSON — MUST stay byte-for-byte identical to
// js/license/LicenseCrypto.js's canonicalStringify(), or every signature
// this tool produces will fail to verify in the app.
// ---------------------------------------------------------------------------
function canonicalStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonicalStringify).join(',') + ']';
  const keys = Object.keys(value).sort();
  return '{' + keys.map(k => JSON.stringify(k) + ':' + canonicalStringify(value[k])).join(',') + '}';
}

function ensureKeyPair() {
  if (fs.existsSync(PRIVATE_KEY_PATH)) {
    return fs.readFileSync(PRIVATE_KEY_PATH, 'utf8');
  }
  fs.mkdirSync(KEYS_DIR, { recursive: true });
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', {
    namedCurve: 'prime256v1' // == P-256, matches ECDSA P-256 used by LicenseCrypto.js
  });

  const privatePem = privateKey.export({ type: 'pkcs8', format: 'pem' });
  fs.writeFileSync(PRIVATE_KEY_PATH, privatePem, { mode: 0o600 });

  const publicJwk = publicKey.export({ format: 'jwk' });
  fs.writeFileSync(PUBLIC_KEY_JWK_PATH, JSON.stringify(publicJwk, null, 2));

  console.log('\n=============================================================');
  console.log('🔑 تم توليد زوج مفاتيح جديد لأول مرة.');
  console.log('   المفتاح الخاص (سرّي — لا تشاركه أبدًا):');
  console.log('   ' + PRIVATE_KEY_PATH);
  console.log('   المفتاح العام (انسخه إلى js/license/license-public-key.js):');
  console.log('   ' + PUBLIC_KEY_JWK_PATH);
  console.log('=============================================================\n');

  return privatePem;
}

function signPayload(payload, privatePem) {
  const data = Buffer.from(canonicalStringify(payload), 'utf8');
  const signer = crypto.createSign('SHA256');
  signer.update(data);
  signer.end();
  // ieee-p1363 = raw r||s format, matching what crypto.subtle.verify()
  // expects in the browser. Node's default ('der') would NOT verify.
  const signature = signer.sign({ key: privatePem, dsaEncoding: 'ieee-p1363' });
  return signature.toString('base64');
}

function addDays(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function computeExpiry(type, now) {
  if (type === 'lifetime') return null;
  if (type === 'trial') return addDays(now, 14).toISOString();
  if (type === 'monthly') return addDays(now, 30).toISOString();
  if (type === 'yearly') return addDays(now, 365).toISOString();
  return addDays(now, 365).toISOString();
}

function buildLicenseFile(answers, privatePem) {
  const now = new Date();
  const licenseId = 'HSM-LIC-' + crypto.randomBytes(4).toString('hex').toUpperCase();

  const payload = {
    licenseId,
    customer: {
      name: answers.customerName,
      phone: answers.customerPhone || '',
      email: answers.customerEmail || ''
    },
    edition: answers.edition,
    type: answers.type,
    machineId: answers.machineId,
    modules: answers.modules || [],
    issuedAt: now.toISOString(),
    expiresAt: computeExpiry(answers.type, now),
    supportUntil: answers.type === 'lifetime' ? null : computeExpiry(answers.type, now),
    graceDays: typeof answers.graceDays === 'number' ? answers.graceDays : 15,
    maxTransfers: 2,
    transferCount: 0
  };

  const signature = signPayload(payload, privatePem);

  return { v: 1, alg: 'ECDSA-P256-SHA256', payload, signature };
}

// ---------------------------------------------------------------------------
// CLI (interactive prompts, zero dependencies)
// ---------------------------------------------------------------------------
function prompt(rl, question, def) {
  return new Promise(resolve => {
    rl.question(question + (def ? ' [' + def + ']' : '') + ': ', answer => {
      resolve(answer.trim() || def || '');
    });
  });
}

async function runInteractive(privatePem) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  console.log('=== أداة إصدار تراخيص نظام الحسام (Phase 30 — License Generator) ===\n');
  const customerName = await prompt(rl, 'اسم العميل');
  const customerPhone = await prompt(rl, 'رقم الهاتف');
  const customerEmail = await prompt(rl, 'البريد الإلكتروني');
  const machineId = await prompt(rl, 'Machine ID (المرسل من العميل، مثال HSM-8D2A-E98F-41AA)');
  const edition = await prompt(rl, 'نوع النسخة (Starter/Professional/Enterprise)', 'Professional');
  const type = await prompt(rl, 'نوع الاشتراك (trial/monthly/yearly/lifetime)', 'yearly');
  const modulesRaw = await prompt(rl, 'الوحدات الإضافية مفصولة بفاصلة (اختياري، مثال AI,Backup)', '');
  const graceDaysRaw = await prompt(rl, 'عدد أيام فترة السماح بعد الانتهاء', '15');

  rl.close();

  const answers = {
    customerName, customerPhone, customerEmail, machineId, edition, type,
    modules: modulesRaw ? modulesRaw.split(',').map(s => s.trim()).filter(Boolean) : [],
    graceDays: parseInt(graceDaysRaw, 10) || 15
  };

  const licenseFile = buildLicenseFile(answers, privatePem);
  const safeName = (customerName || 'customer').replace(/[^a-zA-Z0-9\u0600-\u06FF_-]+/g, '_');
  const outPath = path.join(process.cwd(), safeName + '.hsm');
  fs.writeFileSync(outPath, JSON.stringify(licenseFile, null, 2));

  console.log('\n✅ تم إصدار الترخيص بنجاح: ' + outPath);
  console.log('   licenseId: ' + licenseFile.payload.licenseId);
  console.log('   أرسل هذا الملف للعميل — يقوم بلصقه أو رفعه في شاشة "تفعيل نظام الحسام".');
}

function runFromJson(jsonPath, outPath, privatePem) {
  const answers = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  const licenseFile = buildLicenseFile(answers, privatePem);
  const finalOut = outPath || (answers.customerName || 'customer') + '.hsm';
  fs.writeFileSync(finalOut, JSON.stringify(licenseFile, null, 2));
  console.log('✅ تم إصدار الترخيص: ' + finalOut + ' (licenseId: ' + licenseFile.payload.licenseId + ')');
}

function main() {
  const privatePem = ensureKeyPair();
  const args = process.argv.slice(2);
  const jsonIdx = args.indexOf('--json');
  const outIdx = args.indexOf('--out');

  if (jsonIdx !== -1) {
    const jsonPath = args[jsonIdx + 1];
    const outPath = outIdx !== -1 ? args[outIdx + 1] : null;
    runFromJson(jsonPath, outPath, privatePem);
  } else {
    runInteractive(privatePem);
  }
}

main();
