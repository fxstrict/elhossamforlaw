/**
 * ================================================================
 * PHASE_F5_installation_limit_tests.js — نظام الحسام للمحاماة
 * ================================================================
 * Standalone Node harness (`node js/tests/PHASE_F5_installation_limit_tests.js`,
 * no browser, no real Apps Script/Google Sheets required) for the
 * PHASE F.5 additions to Config/11_Auth.gs (apiRegisterInstallation's
 * new maxInstallations gate, on top of the existing Config/09_License.gs
 * "التراخيص" sheet).
 *
 * Reuses the exact same fake-Sheets/Apps-Script-globals harness as
 * js/tests/PHASE_C_registerInstallation_tests.js (loads BOTH
 * Config/09_License.gs and Config/11_Auth.gs into one sandbox, mirroring
 * the real single-project global scope) — duplicated here rather than
 * imported, following this project's existing convention of fully
 * standalone, dependency-free test files.
 *
 * Covers the exact test matrix approved for F.5:
 *   - Unlimited (no license row at all) → allowed
 *   - max=1, 0 active → allowed
 *   - max=1, 1 active → rejected (INSTALLATION_LIMIT_REACHED)
 *   - max=2, 1 active → allowed
 *   - max=2, 2 active → rejected
 *   - revoked installations never count toward the limit
 *   - a rejected registration creates/mutates NO installation row
 *   - Recovery (apiRecoverInstallationCredential) is untouched by this
 *     gate (different function, not exercised by this path at all)
 *   - idempotency (existing requestId) is untouched by this gate
 *   - forceReissue (ALREADY_REGISTERED path) is untouched by this gate
 *   - the gate runs inside the same lock as everything else (verified
 *     structurally: sequential calls through the same lock-wrapped
 *     function all see a consistent, already-updated count)
 *   - a missing/blank/non-numeric/non-positive maxInstallations cell
 *     never causes an unintended rejection (falls back to unlimited)
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
const authSource = fs.readFileSync(AUTH_GS_PATH, 'utf8');
const LICENSE_GS_PATH = path.join(__dirname, '..', '..', 'Config', '09_License.gs');
const licenseSource = fs.readFileSync(LICENSE_GS_PATH, 'utf8');

// --------------------------------------------------------------------
// Fake Sheets backend — identical to PHASE_C_registerInstallation_tests.js
// --------------------------------------------------------------------
function makeFakeSpreadsheet() {
  const sheets = {};
  function FakeSheet(name) { this.name = name; this.rows = []; }
  FakeSheet.prototype.getLastColumn = function () { return this.rows.length > 0 ? this.rows[0].length : 0; };
  FakeSheet.prototype.setFrozenRows = function () {};
  FakeSheet.prototype.getRange = function (row, col, numRows, numCols) {
    const self = this; numRows = numRows || 1; numCols = numCols || 1;
    return {
      setValues: function (values) {
        for (let r = 0; r < values.length; r++) {
          const targetRow = row - 1 + r;
          while (self.rows.length <= targetRow) self.rows.push([]);
          for (let c = 0; c < values[r].length; c++) self.rows[targetRow][col - 1 + c] = values[r][c];
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
  FakeSheet.prototype.appendRow = function (arr) { this.rows.push(arr.slice()); };
  return {
    getSheetByName: function (name) { return sheets[name] || null; },
    insertSheet: function (name) { const s = new FakeSheet(name); sheets[name] = s; return s; },
    _raw: sheets
  };
}

function sha256Bytes(text) {
  const buf = nodeCrypto.createHash('sha256').update(text, 'utf8').digest();
  const out = [];
  for (let i = 0; i < buf.length; i++) { const b = buf[i]; out.push(b > 127 ? b - 256 : b); }
  return out;
}

function makeSandbox(fakeSs) {
  const sandbox = {
    console: console,
    Logger: { log: function () {} },
    ContentService: {
      MimeType: { JSON: 'JSON' },
      createTextOutput: function (str) {
        return { _content: str, setMimeType: function () { return this; }, getContent: function () { return this._content; } };
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
    LockService: { getScriptLock: function () { return { waitLock: function () {}, releaseLock: function () {} }; } },
    openSpreadsheet: function () { return fakeSs; },
    jsonResponse: function (data) {
      return { _content: JSON.stringify(data), setMimeType: function () { return this; }, getContent: function () { return this._content; } };
    },
    Date: Date
  };
  vm.createContext(sandbox);
  vm.runInContext(licenseSource, sandbox, { filename: '09_License.gs' });
  vm.runInContext(authSource, sandbox, { filename: '11_Auth.gs' });
  return sandbox;
}

function callRegister(sandbox, body) {
  return JSON.parse(sandbox.apiRegisterInstallation(body).getContent());
}

function seedActivationCode(sandbox, code, licenseId, opts) {
  opts = opts || {};
  const sheet = sandbox._ensureActivationCodesSheet_();
  const hash = sandbox._sha256Hex_(sandbox._normalizeActivationCode_(code));
  sheet.appendRow([
    opts.id || ('code-' + Math.random().toString(36).slice(2)), licenseId, hash,
    opts.status || 'unused', opts.createdAt || new Date().toISOString(),
    opts.expiresAt || '', opts.usedAt || '', opts.installationId || ''
  ]);
  return hash;
}

/** Seeds a pre-existing installation row via the sandbox's own
 *  header-map builder (_buildRowFromObject_/_headerMap_) rather than a
 *  hardcoded column-index array, so this test stays correct even if
 *  INSTALLATIONS_HEADERS' order ever changes. */
function seedInstallation(sandbox, licenseId, machineId, status) {
  const sheet = sandbox._ensureInstallationsSheet_();
  const map = sandbox._headerMap_(sheet);
  sheet.appendRow(sandbox._buildRowFromObject_({
    installationId: 'inst-' + Math.random().toString(36).slice(2),
    licenseId: licenseId,
    machineId: machineId,
    credentialHash: 'x'.repeat(64),
    status: status,
    requestId: 'seed-' + Math.random().toString(36).slice(2),
    requestFingerprint: 'seed-fp',
    createdAt: new Date().toISOString(),
    credentialIssuedAt: new Date().toISOString(),
    revokedAt: status === 'revoked' ? new Date().toISOString() : '',
    note: ''
  }, map));
}

/** Seeds/updates a row in "التراخيص" with a given maxInstallations
 *  value, via the sandbox's own self-healing helper — never assumes a
 *  column position. */
function seedLicenseMax(sandbox, licenseId, maxInstallationsValue) {
  const sheet = sandbox._ensureLicensesSheetHasMaxInstallationsColumn_();
  const map = sandbox._headerMap_(sheet);
  const row = new Array(Object.keys(map).length).fill('');
  row[map.licenseId] = licenseId;
  row[map.status] = 'active';
  row[map.maxInstallations] = maxInstallationsValue;
  sheet.appendRow(row);
}

// ====================================================================
// Tests
// ====================================================================

(function test_unlimited_no_license_row() {
  const ss = makeFakeSpreadsheet();
  const sb = makeSandbox(ss);
  seedActivationCode(sb, 'CODE-1', 'LIC-A');
  const res = callRegister(sb, { action: 'registerInstallation', licenseId: 'LIC-A', activationCode: 'CODE-1', machineId: 'M1', requestId: 'R1' });
  check('Unlimited (no license row at all) → REGISTERED', res.success === true && res.status === 'REGISTERED');
})();

(function test_max1_zero_active_allowed() {
  const ss = makeFakeSpreadsheet();
  const sb = makeSandbox(ss);
  seedLicenseMax(sb, 'LIC-B', 1);
  seedActivationCode(sb, 'CODE-2', 'LIC-B');
  const res = callRegister(sb, { action: 'registerInstallation', licenseId: 'LIC-B', activationCode: 'CODE-2', machineId: 'M1', requestId: 'R1' });
  check('max=1, 0 active → REGISTERED', res.success === true && res.status === 'REGISTERED');
})();

(function test_max1_one_active_rejected() {
  const ss = makeFakeSpreadsheet();
  const sb = makeSandbox(ss);
  seedLicenseMax(sb, 'LIC-C', 1);
  seedInstallation(sb, 'LIC-C', 'M1', 'active');
  seedActivationCode(sb, 'CODE-3', 'LIC-C');
  const before = ss.getSheetByName('التثبيتات').rows.length;
  const res = callRegister(sb, { action: 'registerInstallation', licenseId: 'LIC-C', activationCode: 'CODE-3', machineId: 'M2', requestId: 'R1' });
  check('max=1, 1 active → success:false', res.success === false);
  check('max=1, 1 active → status INSTALLATION_LIMIT_REACHED', res.status === 'INSTALLATION_LIMIT_REACHED');
  check('rejected registration creates NO new installation row', ss.getSheetByName('التثبيتات').rows.length === before);
  const codeSheet = ss.getSheetByName('أكواد_التفعيل');
  check('rejected registration does NOT consume the activation code', codeSheet.rows[1][3] === 'unused');
})();

(function test_max2_one_active_allowed() {
  const ss = makeFakeSpreadsheet();
  const sb = makeSandbox(ss);
  seedLicenseMax(sb, 'LIC-D', 2);
  seedInstallation(sb, 'LIC-D', 'M1', 'active');
  seedActivationCode(sb, 'CODE-4', 'LIC-D');
  const res = callRegister(sb, { action: 'registerInstallation', licenseId: 'LIC-D', activationCode: 'CODE-4', machineId: 'M2', requestId: 'R1' });
  check('max=2, 1 active → REGISTERED', res.success === true && res.status === 'REGISTERED');
})();

(function test_max2_two_active_rejected() {
  const ss = makeFakeSpreadsheet();
  const sb = makeSandbox(ss);
  seedLicenseMax(sb, 'LIC-E', 2);
  seedInstallation(sb, 'LIC-E', 'M1', 'active');
  seedInstallation(sb, 'LIC-E', 'M2', 'active');
  seedActivationCode(sb, 'CODE-5', 'LIC-E');
  const res = callRegister(sb, { action: 'registerInstallation', licenseId: 'LIC-E', activationCode: 'CODE-5', machineId: 'M3', requestId: 'R1' });
  check('max=2, 2 active → INSTALLATION_LIMIT_REACHED', res.success === false && res.status === 'INSTALLATION_LIMIT_REACHED');
})();

(function test_revoked_not_counted() {
  const ss = makeFakeSpreadsheet();
  const sb = makeSandbox(ss);
  seedLicenseMax(sb, 'LIC-F', 1);
  seedInstallation(sb, 'LIC-F', 'M1', 'revoked'); // does NOT count
  seedActivationCode(sb, 'CODE-6', 'LIC-F');
  const res = callRegister(sb, { action: 'registerInstallation', licenseId: 'LIC-F', activationCode: 'CODE-6', machineId: 'M2', requestId: 'R1' });
  check('max=1, 1 revoked (0 active) → REGISTERED', res.success === true && res.status === 'REGISTERED');
})();

(function test_revoke_frees_a_slot() {
  const ss = makeFakeSpreadsheet();
  const sb = makeSandbox(ss);
  seedLicenseMax(sb, 'LIC-G', 1);
  seedInstallation(sb, 'LIC-G', 'M1', 'active');
  seedActivationCode(sb, 'CODE-7A', 'LIC-G');
  const blocked = callRegister(sb, { action: 'registerInstallation', licenseId: 'LIC-G', activationCode: 'CODE-7A', machineId: 'M2', requestId: 'R1' });
  check('blocked while old installation still active', blocked.status === 'INSTALLATION_LIMIT_REACHED');
  // Operator revokes the old installation (existing mechanism — flip status)
  const instSheet = ss.getSheetByName('التثبيتات');
  const map = sb._headerMap_(instSheet);
  instSheet.rows[1][map.status] = 'revoked';
  seedActivationCode(sb, 'CODE-7B', 'LIC-G');
  const afterRevoke = callRegister(sb, { action: 'registerInstallation', licenseId: 'LIC-G', activationCode: 'CODE-7B', machineId: 'M2', requestId: 'R2' });
  check('revoking the old installation frees the slot for a new one', afterRevoke.success === true && afterRevoke.status === 'REGISTERED');
})();

(function test_missing_blank_nonpositive_maxInstallations_never_rejects() {
  const ss = makeFakeSpreadsheet();
  const sb = makeSandbox(ss);
  // A license row exists (e.g. for an unrelated 'status' reason) but the
  // maxInstallations cell is blank/zero/non-numeric — must NEVER be
  // treated as "0 allowed" (that would silently lock everyone out).
  const licSheet = sb._ensureLicensesSheetHasMaxInstallationsColumn_();
  const licMap = sb._headerMap_(licSheet);
  ['', 0, 'غير رقم', -1].forEach(function (badValue, idx) {
    const licenseId = 'LIC-H-' + idx;
    const row = new Array(Object.keys(licMap).length).fill('');
    row[licMap.licenseId] = licenseId;
    row[licMap.status] = 'active';
    row[licMap.maxInstallations] = badValue;
    licSheet.appendRow(row);
    seedInstallation(sb, licenseId, 'M1', 'active'); // already 1 active
    seedActivationCode(sb, 'CODE-H-' + idx, licenseId);
    const res = callRegister(sb, { action: 'registerInstallation', licenseId: licenseId, activationCode: 'CODE-H-' + idx, machineId: 'M2', requestId: 'R-H-' + idx });
    check('maxInstallations=' + JSON.stringify(badValue) + ' never causes rejection (falls back to unlimited)', res.success === true && res.status === 'REGISTERED');
  });
})();

(function test_idempotent_requestId_untouched_by_gate() {
  const ss = makeFakeSpreadsheet();
  const sb = makeSandbox(ss);
  seedLicenseMax(sb, 'LIC-I', 1);
  seedActivationCode(sb, 'CODE-9', 'LIC-I');
  const first = callRegister(sb, { action: 'registerInstallation', licenseId: 'LIC-I', activationCode: 'CODE-9', machineId: 'M1', requestId: 'R1' });
  check('first registration (fills the only slot) → REGISTERED', first.success === true);
  // Same requestId replay (idempotency path) — must NOT be blocked by
  // the F.5 gate even though the license is now "at capacity", because
  // this is the SAME installation replaying, not a new one.
  const replay = callRegister(sb, { action: 'registerInstallation', licenseId: 'LIC-I', activationCode: 'CODE-9', machineId: 'M1', requestId: 'R1' });
  check('idempotent replay of the SAME requestId at capacity → still ALREADY_REGISTERED (not blocked)', replay.success === true && replay.status === 'ALREADY_REGISTERED');
})();

(function test_forceReissue_untouched_by_gate() {
  const ss = makeFakeSpreadsheet();
  const sb = makeSandbox(ss);
  seedLicenseMax(sb, 'LIC-J', 1);
  seedActivationCode(sb, 'CODE-10', 'LIC-J');
  const first = callRegister(sb, { action: 'registerInstallation', licenseId: 'LIC-J', activationCode: 'CODE-10', machineId: 'M1', requestId: 'R1' });
  check('first registration (fills the only slot) → REGISTERED', first.success === true);
  const reissued = callRegister(sb, { action: 'registerInstallation', licenseId: 'LIC-J', activationCode: 'CODE-10', machineId: 'M1', requestId: 'R1', forceReissue: true });
  check('forceReissue on the SAME installation at capacity → still REISSUED (not blocked)', reissued.success === true && reissued.status === 'REISSUED');
})();

(function test_diagnostic_note_records_prior_count_not_used_as_source_of_truth() {
  const ss = makeFakeSpreadsheet();
  const sb = makeSandbox(ss);
  seedLicenseMax(sb, 'LIC-K', 5);
  seedInstallation(sb, 'LIC-K', 'M1', 'active');
  seedInstallation(sb, 'LIC-K', 'M2', 'active');
  seedActivationCode(sb, 'CODE-11', 'LIC-K');
  const res = callRegister(sb, { action: 'registerInstallation', licenseId: 'LIC-K', activationCode: 'CODE-11', machineId: 'M3', requestId: 'R1' });
  const instSheet = ss.getSheetByName('التثبيتات');
  const map = sb._headerMap_(instSheet);
  const newRow = instSheet.rows[instSheet.rows.length - 1];
  check('diagnostic note records the PRIOR active count (2), not a decision value', newRow[map.note] === 'registration_active_count=2');
  // Prove the note is diagnostic-only: even if some future bug mangled
  // an existing row's note, a FRESH count from the sheet itself (not the
  // note) is still what the next call would use. We assert this
  // structurally: _countActiveInstallationsForLicense_ never reads the
  // 'note' column at all.
  check('_countActiveInstallationsForLicense_ never references the note column', sb._countActiveInstallationsForLicense_.toString().indexOf('note') === -1);
})();

(function test_recovery_path_not_exercised_by_this_gate() {
  // apiRecoverInstallationCredential is a structurally separate function
  // in this same file — this test simply confirms it exists unchanged
  // and does not itself call _getMaxInstallationsForLicense_/
  // _countActiveInstallationsForLicense_ at all (grep-level structural
  // guard, consistent with the approved F.5 scope: Recovery untouched).
  const ss = makeFakeSpreadsheet();
  const sb = makeSandbox(ss);
  const recoverSrc = sb.apiRecoverInstallationCredential.toString();
  check('apiRecoverInstallationCredential does not reference the F.5 gate functions', recoverSrc.indexOf('_getMaxInstallationsForLicense_') === -1 && recoverSrc.indexOf('_countActiveInstallationsForLicense_') === -1);
})();

console.log('\n' + log.join('\n'));
console.log('\n==== PHASE F.5 installation limit (Config/11_Auth.gs) — Node harness ====');
console.log('PASSED: ' + passed + '   FAILED: ' + failed);
if (failed > 0) process.exit(1);
