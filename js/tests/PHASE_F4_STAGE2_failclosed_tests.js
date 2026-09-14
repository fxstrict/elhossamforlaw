/**
 * ================================================================
 * PHASE_F4_STAGE2_failclosed_tests.js — نظام الحسام للمحاماة
 * ================================================================
 * PHASE: F.4 — Stage-2 Fail-Closed
 *
 * Standalone Node harness (`node js/tests/PHASE_F4_STAGE2_failclosed_tests.js`,
 * no browser, no real Apps Script/Google Sheets required) for the two
 * pure functions in Config/11_Auth.gs that make up the Phase D
 * installation-authentication gate:
 *   _authenticateInstallation_(installationId, credential)
 *   _authFailureResponseIfAny_(authResult)
 * plus the new PHASE F.4 kill switch, INSTALLATION_FAIL_CLOSED_ENABLED.
 *
 * This is a NEW, ADDITIVE test file only — same fake-sheet / vm-sandbox
 * technique as js/tests/PHASE_C_registerInstallation_tests.js and
 * js/tests/PHASE_F4_PREP_C1_recovery_tests.js (duplicated here rather
 * than require()'d, matching this test folder's existing convention of
 * standalone runnable files).
 *
 * Definition of Done covered (MASTER CONTROL REPORT §7):
 *   - valid credential                → allowed      (state 'authenticated')
 *   - missing credential              → rejected      (AUTH_MISSING_CREDENTIAL)
 *   - invalid credential              → rejected      (AUTH_INVALID)
 *   - unknown installation            → rejected      (AUTH_UNKNOWN_INSTALLATION)
 *   - revoked installation            → rejected      (AUTH_REVOKED)
 *   - valid legacy user after migration (i.e. a real row seeded exactly
 *     as apiRegisterInstallation/IMPL-B/recovery would leave it) → allowed
 *   - rollback procedure               → tested: with
 *     INSTALLATION_FAIL_CLOSED_ENABLED forced to false, the exact same
 *     missing-credential request is GRACED again (returns null), proving
 *     the documented single-constant rollback actually works.
 *
 * Explicitly NOT covered here (by design, not a gap):
 *   - Config/06_Api.gs's doGet()/doPost() routing itself was not
 *     modified in this phase (verified by diff — see phase closure
 *     notes) and is not re-executed by this harness; the pre-existing
 *     routing order (checkLicenseStatus/registerInstallation/
 *     setLicenseStatus/recoverInstallationCredential/uploadFile all
 *     dispatched before the auth gate) was confirmed by static reading
 *     only, exactly as before this phase.
 * ================================================================
 */
'use strict';

const path = require('path');
const fs = require('fs');
const vm = require('vm');
const nodeCrypto = require('crypto');

let passed = 0, failed = 0;
const log = [];
function check(label, cond) {
  if (cond) { passed++; log.push('PASS: ' + label); }
  else { failed++; log.push('FAIL: ' + label); }
}

const AUTH_GS_PATH = path.join(__dirname, '..', '..', 'Config', '11_Auth.gs');
const authSourceOriginal = fs.readFileSync(AUTH_GS_PATH, 'utf8');

// --------------------------------------------------------------------
// Fake Sheets backend — identical in shape/behaviour to the one in
// PHASE_C_registerInstallation_tests.js / PHASE_F4_PREP_C1_recovery_tests.js.
// --------------------------------------------------------------------
function makeFakeSpreadsheet() {
  const sheets = {};

  function FakeSheet(name) {
    this.name = name;
    this.rows = [];
  }
  FakeSheet.prototype.getLastColumn = function () {
    return this.rows.length > 0 ? this.rows[0].length : 0;
  };
  FakeSheet.prototype.setFrozenRows = function () {};
  FakeSheet.prototype.getRange = function (row, col, numRows, numCols) {
    const self = this;
    numRows = numRows || 1; numCols = numCols || 1;
    return {
      setValues: function (values) {
        for (let r = 0; r < values.length; r++) {
          const targetRow = row - 1 + r;
          while (self.rows.length <= targetRow) self.rows.push([]);
          for (let c = 0; c < values[r].length; c++) {
            self.rows[targetRow][col - 1 + c] = values[r][c];
          }
        }
      },
      setValue: function (value) {
        const targetRow = row - 1;
        while (self.rows.length <= targetRow) self.rows.push([]);
        self.rows[targetRow][col - 1] = value;
      },
      getValues: function () {
        const out = [];
        for (let r = 0; r < numRows; r++) {
          const srcRow = self.rows[row - 1 + r] || [];
          const line = [];
          for (let c = 0; c < numCols; c++) line.push(srcRow[col - 1 + c] !== undefined ? srcRow[col - 1 + c] : '');
          out.push(line);
        }
        return out;
      }
    };
  };
  FakeSheet.prototype.getDataRange = function () {
    const self = this;
    return { getValues: function () { return self.rows.map(function (r) { return r.slice(); }); } };
  };
  FakeSheet.prototype.appendRow = function (arr) {
    this.rows.push(arr.slice());
  };

  return {
    getSheetByName: function (name) { return sheets[name] || null; },
    insertSheet: function (name) {
      const s = new FakeSheet(name);
      sheets[name] = s;
      return s;
    },
    _raw: sheets
  };
}

function sha256Bytes(text) {
  const buf = nodeCrypto.createHash('sha256').update(text, 'utf8').digest();
  const out = [];
  for (let i = 0; i < buf.length; i++) {
    const b = buf[i];
    out.push(b > 127 ? b - 256 : b);
  }
  return out;
}

/**
 * @param {Object} fakeSs
 * @param {string} sourceText  the (possibly patched) 11_Auth.gs source
 */
function makeSandbox(fakeSs, sourceText) {
  const sandbox = {
    console: console,
    Logger: { log: function () {} },
    ContentService: {
      MimeType: { JSON: 'JSON' },
      createTextOutput: function (str) {
        return {
          _content: str,
          setMimeType: function () { return this; },
          getContent: function () { return this._content; }
        };
      }
    },
    Utilities: {
      getUuid: function () {
        const hex = function (n) { return nodeCrypto.randomBytes(n).toString('hex'); };
        return hex(4) + '-' + hex(2) + '-' + hex(2) + '-' + hex(2) + '-' + hex(6);
      },
      computeDigest: function (_algo, text, _charset) { return sha256Bytes(text); },
      DigestAlgorithm: { SHA_256: 'SHA_256' },
      Charset: { UTF_8: 'UTF_8' }
    },
    LockService: {
      getScriptLock: function () {
        return { waitLock: function () {}, releaseLock: function () {} };
      }
    },
    PropertiesService: {
      getScriptProperties: function () {
        return { getProperty: function () { return null; } };
      }
    },
    openSpreadsheet: function () { return fakeSs; },
    jsonResponse: function (data) {
      return {
        _content: JSON.stringify(data),
        setMimeType: function () { return this; },
        getContent: function () { return this._content; }
      };
    },
    Date: Date
  };
  vm.createContext(sandbox);
  vm.runInContext(sourceText, sandbox, { filename: '11_Auth.gs' });
  return sandbox;
}

/** Seeds one row into "التثبيتات" exactly as apiRegisterInstallation /
 *  IMPL-B redemption / a successful recovery would leave it — i.e. a
 *  real "legacy user after migration" record, not a synthetic shortcut. */
function seedInstallation(sb, overrides) {
  const sheet = sb._ensureInstallationsSheet_();
  const map = sb._headerMap_(sheet);
  const rawCredential = overrides && overrides._rawCredential || 'real-credential-' + Math.random();
  const data = Object.assign({
    installationId: 'inst-' + Math.random().toString(36).slice(2),
    licenseId: 'LIC-LEGACY-1',
    machineId: 'MACHINE-1',
    credentialHash: sb._sha256Hex_(sb._normalizeCredential_(rawCredential)),
    status: 'active',
    requestId: 'req-' + Math.random().toString(36).slice(2),
    requestFingerprint: 'fp-' + Math.random().toString(36).slice(2),
    createdAt: new Date(Date.now() - 86400000).toISOString(),
    credentialIssuedAt: new Date(Date.now() - 86400000).toISOString(),
    revokedAt: '',
    note: ''
  }, overrides || {});
  delete data._rawCredential;
  sheet.appendRow(sb._buildRowFromObject_(data, map));
  return Object.assign({}, data, { _rawCredential: rawCredential });
}

function runAuthGate(sb, installationId, credential) {
  const result = sb._authenticateInstallation_(installationId, credential);
  const failure = sb._authFailureResponseIfAny_(result);
  return { result: result, failureBody: failure ? JSON.parse(failure.getContent()) : null };
}

function main() {
  console.log('\n=== PHASE F.4 — Stage-2 Fail-Closed: _authenticateInstallation_ / _authFailureResponseIfAny_ ===\n');

  // ------------------------------------------------------------------
  // Group 1 — Stage 2 ENABLED (INSTALLATION_FAIL_CLOSED_ENABLED = true,
  // the actual, unmodified shipped source — no string patching here).
  // ------------------------------------------------------------------
  console.log('--- Stage 2 enabled (production default) ---');
  {
    const ss = makeFakeSpreadsheet();
    const sb = makeSandbox(ss, authSourceOriginal);

    // Note: top-level `const` in a vm context is NOT exposed as a
    // property on the sandbox object (Node vm semantics — unlike `var`/
    // function declarations), so read it back by evaluating an
    // expression in the same context instead of `sb.<name>`.
    check(
      'source under test actually has INSTALLATION_FAIL_CLOSED_ENABLED === true (sanity check on the fixture itself)',
      vm.runInContext('INSTALLATION_FAIL_CLOSED_ENABLED', sb) === true
    );

    // valid legacy user after migration (seeded exactly as a real
    // registration/backfill/recovery would leave the row)
    const legacy = seedInstallation(sb);
    const validRun = runAuthGate(sb, legacy.installationId, legacy._rawCredential);
    check('valid credential (legacy, post-migration) → allowed (state=authenticated)', validRun.result.state === 'authenticated');
    check('valid credential → no failure response (null)', validRun.failureBody === null);

    // missing credential → rejected
    const missingRun = runAuthGate(sb, '', '');
    check('missing credential → state=missing_credential', missingRun.result.state === 'missing_credential');
    check('missing credential → REJECTED under Stage 2 (failure response present)', missingRun.failureBody !== null);
    check('missing credential → authCode AUTH_MISSING_CREDENTIAL', missingRun.failureBody && missingRun.failureBody.authCode === 'AUTH_MISSING_CREDENTIAL');
    check('missing credential rejection → error field is AUTH_FAILED (existing client contract)', missingRun.failureBody && missingRun.failureBody.error === 'AUTH_FAILED');

    // installationId present but credential empty — still missing_credential
    const halfMissingRun = runAuthGate(sb, legacy.installationId, '');
    check('installationId with no credential → still rejected as AUTH_MISSING_CREDENTIAL', halfMissingRun.failureBody && halfMissingRun.failureBody.authCode === 'AUTH_MISSING_CREDENTIAL');

    // invalid credential → rejected
    const invalidRun = runAuthGate(sb, legacy.installationId, 'totally-wrong-credential');
    check('invalid credential → state=invalid_credential', invalidRun.result.state === 'invalid_credential');
    check('invalid credential → authCode AUTH_INVALID', invalidRun.failureBody && invalidRun.failureBody.authCode === 'AUTH_INVALID');

    // unknown installation → rejected
    const unknownRun = runAuthGate(sb, 'inst-does-not-exist', 'whatever');
    check('unknown installation → state=unknown_installation', unknownRun.result.state === 'unknown_installation');
    check('unknown installation → authCode AUTH_UNKNOWN_INSTALLATION', unknownRun.failureBody && unknownRun.failureBody.authCode === 'AUTH_UNKNOWN_INSTALLATION');

    // revoked installation → rejected
    const revoked = seedInstallation(sb, { status: 'revoked' });
    const revokedRun = runAuthGate(sb, revoked.installationId, revoked._rawCredential);
    check('revoked installation (correct credential) → state=revoked_installation', revokedRun.result.state === 'revoked_installation');
    check('revoked installation → authCode AUTH_REVOKED', revokedRun.failureBody && revokedRun.failureBody.authCode === 'AUTH_REVOKED');

    // never leak credentialHash / raw credential in any rejection body
    const allBodies = [missingRun, halfMissingRun, invalidRun, unknownRun, revokedRun].map(r => r.failureBody);
    const noLeak = allBodies.every(b => {
      const s = JSON.stringify(b);
      return s.indexOf('credentialHash') === -1 && s.indexOf(legacy._rawCredential) === -1 && s.indexOf(revoked._rawCredential) === -1;
    });
    check('no rejection response leaks credentialHash or a raw credential', noLeak);
  }

  // ------------------------------------------------------------------
  // Group 2 — Rollback path: INSTALLATION_FAIL_CLOSED_ENABLED forced to
  // false on a patched copy of the source text (the real file on disk
  // is NEVER modified by this test — only an in-memory string used to
  // build a separate vm context). Proves the documented single-constant
  // rollback actually restores Stage-1 GRACE behavior.
  // ------------------------------------------------------------------
  console.log('--- Rollback: INSTALLATION_FAIL_CLOSED_ENABLED = false ---');
  {
    const marker = 'const INSTALLATION_FAIL_CLOSED_ENABLED = true;';
    check('rollback fixture: the const declaration exists verbatim in the real source (patch target found)', authSourceOriginal.indexOf(marker) !== -1);
    const patchedSource = authSourceOriginal.replace(marker, 'const INSTALLATION_FAIL_CLOSED_ENABLED = false;');
    check('rollback fixture: patch actually changed exactly one occurrence', patchedSource !== authSourceOriginal);

    const ss = makeFakeSpreadsheet();
    const sb = makeSandbox(ss, patchedSource);
    check('patched source has INSTALLATION_FAIL_CLOSED_ENABLED === false', vm.runInContext('INSTALLATION_FAIL_CLOSED_ENABLED', sb) === false);

    const missingRun = runAuthGate(sb, '', '');
    check('rollback: missing credential → state still missing_credential', missingRun.result.state === 'missing_credential');
    check('rollback: missing credential → GRACED again (no failure response)', missingRun.failureBody === null);

    // Non-missing-credential rejections are UNCHANGED by the switch —
    // it only ever gates the missing_credential branch.
    const legacy = seedInstallation(sb);
    const invalidRun = runAuthGate(sb, legacy.installationId, 'wrong');
    check('rollback: invalid credential is still rejected (switch only affects missing_credential)', invalidRun.failureBody && invalidRun.failureBody.authCode === 'AUTH_INVALID');
  }

  console.log('\n' + log.join('\n'));
  console.log('\n' + passed + ' / ' + (passed + failed) + ' PASS');
  if (failed > 0) process.exitCode = 1;
}

main();
