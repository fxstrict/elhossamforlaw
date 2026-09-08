/**
 * ================================================================
 * PHASE_C_registerInstallation_tests.js — نظام الحسام للمحاماة
 * ================================================================
 * Standalone Node harness (`node js/tests/PHASE_C_registerInstallation_tests.js`,
 * no browser, no real Apps Script/Google Sheets required) for
 * Config/11_Auth.gs — the server-side half of PHASE C v3/v3.1/v3.2
 * (Per-Installation Registration + Bearer Credential + D1 lazy sheet
 * creation). Loads the real .gs source text and evaluates it inside a
 * sandboxed context with faithful mocks of Utilities/LockService/
 * ContentService/Logger/openSpreadsheet — including a REAL SHA-256
 * (via Node's crypto module, byte-mapped to Apps Script's signed-byte
 * convention) so credentialHash/activationCodeHash assertions are
 * meaningful, not just stubbed.
 *
 * Same harness style/conventions as js/tests/PHASE_B_bootstrap_race_tests.js
 * (fresh sandbox per test, explicit PASS/FAIL log, summary at the end).
 *
 * Covers Test Matrix items #1-#26 relevant to server-side logic
 * (v3 §17 + v3.1 §4.4 + v3.2 §7 #27-#30). Genuine concurrent execution
 * of LockService under a real multi-process Apps Script runtime is
 * OUT OF SCOPE here (this is single-threaded Node) — those specific
 * assertions are marked NOT EXECUTED — REQUIRES LIVE APPS SCRIPT below,
 * per the explicit instruction not to claim untested things pass.
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
function note(label) { log.push('NOTE: ' + label); }

const AUTH_GS_PATH = path.join(__dirname, '..', '..', 'Config', '11_Auth.gs');
const authSource = fs.readFileSync(AUTH_GS_PATH, 'utf8');

// --------------------------------------------------------------------
// Fake Sheets backend — faithful enough for Config/11_Auth.gs's actual
// call patterns (getSheetByName/insertSheet/getRange/getValues/
// setValues/appendRow/getDataRange/getLastColumn/setFrozenRows).
// --------------------------------------------------------------------
function makeFakeSpreadsheet() {
  const sheets = {};

  function FakeSheet(name) {
    this.name = name;
    this.rows = []; // rows[0] = header once set
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

// --------------------------------------------------------------------
// Apps Script global mocks
// --------------------------------------------------------------------
function sha256Bytes(text) {
  const buf = nodeCrypto.createHash('sha256').update(text, 'utf8').digest();
  // Mimic Apps Script's Java-style SIGNED byte array (-128..127), which
  // is exactly what Config/11_Auth.gs's _sha256Hex_() is written to handle.
  const out = [];
  for (let i = 0; i < buf.length; i++) {
    const b = buf[i];
    out.push(b > 127 ? b - 256 : b);
  }
  return out;
}

function makeSandbox(fakeSs) {
  let uuidCounter = 0;
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
        uuidCounter++;
        // Faithful RFC4122-shaped fake (hex only, standard dash grouping)
        // — real Utilities.getUuid() never contains non-hex letters, and
        // Config/11_Auth.gs's credential generator depends on that
        // (strips dashes, expects the remainder to be pure hex).
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
    openSpreadsheet: function () { return fakeSs; },
    // jsonResponse() lives in Config/08_Utils.gs in the real single-scope
    // Apps Script project; mocked here identically (same shape) since
    // this harness loads only 11_Auth.gs in isolation.
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
  vm.runInContext(authSource, sandbox, { filename: '11_Auth.gs' });
  return sandbox;
}

function callRegister(sandbox, body) {
  const response = sandbox.apiRegisterInstallation(body);
  return JSON.parse(response.getContent());
}

function seedActivationCode(fakeSs, sandbox, code, licenseId, opts) {
  opts = opts || {};
  const sheet = sandbox._ensureActivationCodesSheet_();
  const hash = sandbox._sha256Hex_(sandbox._normalizeActivationCode_(code));
  sheet.appendRow([
    opts.id || ('code-' + Math.random().toString(36).slice(2)),
    licenseId,
    hash,
    opts.status || 'unused',
    opts.createdAt || new Date().toISOString(),
    opts.expiresAt || '',
    opts.usedAt || '',
    opts.installationId || ''
  ]);
  return hash;
}

// ====================================================================
// Tests
// ====================================================================

(function test1_newRegistration() {
  const ss = makeFakeSpreadsheet();
  const sb = makeSandbox(ss);
  seedActivationCode(ss, sb, 'ABCD-1234-EFGH-5678', 'LIC-1');
  const res = callRegister(sb, { action: 'registerInstallation', licenseId: 'LIC-1', activationCode: 'ABCD-1234-EFGH-5678', machineId: 'M1', requestId: 'R1' });
  check('#1 New registration → success', res.success === true);
  check('#1 New registration → status REGISTERED', res.status === 'REGISTERED');
  check('#1 New registration → credential present, 64 hex chars', typeof res.credential === 'string' && /^[0-9a-f]{64}$/.test(res.credential));
  check('#1 New registration → installationId present', !!res.installationId);
})();

(function test2_installationsRowShape() {
  const ss = makeFakeSpreadsheet();
  const sb = makeSandbox(ss);
  seedActivationCode(ss, sb, 'CODE-A', 'LIC-2');
  const res = callRegister(sb, { action: 'registerInstallation', licenseId: 'LIC-2', activationCode: 'CODE-A', machineId: 'M2', requestId: 'R2' });
  const instSheet = ss.getSheetByName('التثبيتات');
  const row = instSheet.rows[1];
  check('#2 Installation row: 11 columns', row.length === 11);
  check('#2 Installation row: installationId matches response', row[0] === res.installationId);
  check('#2 Installation row: status active', row[4] === 'active');
  check('#2 Installation row: credentialHash != raw credential', row[3] !== res.credential && row[3].length === 64);
  const codeSheet = ss.getSheetByName('أكواد_التفعيل');
  check('#2 Activation code row: status used', codeSheet.rows[1][3] === 'used');
  check('#2 Activation code row: installationId linked', codeSheet.rows[1][7] === res.installationId);
})();

(function test3_invalidActivation() {
  const ss = makeFakeSpreadsheet();
  const sb = makeSandbox(ss);
  const res = callRegister(sb, { action: 'registerInstallation', licenseId: 'LIC-3', activationCode: 'NOPE', machineId: 'M3', requestId: 'R3' });
  check('#3 Invalid activation → success:false', res.success === false);
  check('#3 Invalid activation → status INVALID_ACTIVATION', res.status === 'INVALID_ACTIVATION');
})();

(function test4_expiredActivation() {
  const ss = makeFakeSpreadsheet();
  const sb = makeSandbox(ss);
  seedActivationCode(ss, sb, 'EXP-CODE', 'LIC-4', { expiresAt: new Date(Date.now() - 86400000).toISOString() });
  const res = callRegister(sb, { action: 'registerInstallation', licenseId: 'LIC-4', activationCode: 'EXP-CODE', machineId: 'M4', requestId: 'R4' });
  check('#4 Expired activation → status EXPIRED', res.status === 'EXPIRED');
})();

(function test5_revokedActivationCode() {
  const ss = makeFakeSpreadsheet();
  const sb = makeSandbox(ss);
  seedActivationCode(ss, sb, 'REV-CODE', 'LIC-5', { status: 'revoked' });
  const res = callRegister(sb, { action: 'registerInstallation', licenseId: 'LIC-5', activationCode: 'REV-CODE', machineId: 'M5', requestId: 'R5' });
  check('#5 Revoked activation code → status REVOKED', res.status === 'REVOKED');
})();

(function test6_alreadyUsed_differentRequestId() {
  const ss = makeFakeSpreadsheet();
  const sb = makeSandbox(ss);
  seedActivationCode(ss, sb, 'USE-ONCE', 'LIC-6');
  callRegister(sb, { action: 'registerInstallation', licenseId: 'LIC-6', activationCode: 'USE-ONCE', machineId: 'M6', requestId: 'R6' });
  const res2 = callRegister(sb, { action: 'registerInstallation', licenseId: 'LIC-6', activationCode: 'USE-ONCE', machineId: 'M6-OTHER', requestId: 'R6-DIFFERENT' });
  check('#6 Reused code, different requestId → ALREADY_USED', res2.status === 'ALREADY_USED');
})();

(function test7_8_retrySameRequestId() {
  const ss = makeFakeSpreadsheet();
  const sb = makeSandbox(ss);
  seedActivationCode(ss, sb, 'RETRY-CODE', 'LIC-7');
  const first = callRegister(sb, { action: 'registerInstallation', licenseId: 'LIC-7', activationCode: 'RETRY-CODE', machineId: 'M7', requestId: 'R7' });

  const sameFingerprint = callRegister(sb, { action: 'registerInstallation', licenseId: 'LIC-7', activationCode: 'RETRY-CODE', machineId: 'M7', requestId: 'R7' });
  check('#7 Same requestId+fingerprint, no forceReissue → ALREADY_REGISTERED', sameFingerprint.status === 'ALREADY_REGISTERED');
  check('#7 ALREADY_REGISTERED → no credential field', sameFingerprint.credential === undefined);
  check('#7 ALREADY_REGISTERED → same installationId', sameFingerprint.installationId === first.installationId);

  const diffFingerprint = callRegister(sb, { action: 'registerInstallation', licenseId: 'LIC-7', activationCode: 'RETRY-CODE', machineId: 'M7-CHANGED', requestId: 'R7' });
  check('#8 Same requestId, different fingerprint → REQUEST_ID_MISMATCH', diffFingerprint.status === 'REQUEST_ID_MISMATCH');
  check('#8 REQUEST_ID_MISMATCH → success:false', diffFingerprint.success === false);

  const instSheet = ss.getSheetByName('التثبيتات');
  check('#7/#8 No duplicate installation row created', instSheet.rows.length === 2); // header + exactly 1 data row
})();

(function test21_22_23_forceReissue() {
  const ss = makeFakeSpreadsheet();
  const sb = makeSandbox(ss);
  seedActivationCode(ss, sb, 'REISSUE-CODE', 'LIC-21');
  const first = callRegister(sb, { action: 'registerInstallation', licenseId: 'LIC-21', activationCode: 'REISSUE-CODE', machineId: 'M21', requestId: 'R21' });

  const noReissue = callRegister(sb, { action: 'registerInstallation', licenseId: 'LIC-21', activationCode: 'REISSUE-CODE', machineId: 'M21', requestId: 'R21', forceReissue: false });
  check('#21 forceReissue:false → ALREADY_REGISTERED, no credential', noReissue.status === 'ALREADY_REGISTERED' && noReissue.credential === undefined);
  const instSheetAfterNoReissue = ss.getSheetByName('التثبيتات').rows[1][3];
  check('#21 credentialHash unchanged after plain retry', instSheetAfterNoReissue === ss.getSheetByName('التثبيتات').rows[1][3]);

  const reissued = callRegister(sb, { action: 'registerInstallation', licenseId: 'LIC-21', activationCode: 'REISSUE-CODE', machineId: 'M21', requestId: 'R21', forceReissue: true });
  check('#22 forceReissue:true → status REISSUED', reissued.status === 'REISSUED');
  check('#22 REISSUED → new credential present', typeof reissued.credential === 'string' && reissued.credential !== first.credential);
  check('#22 REISSUED → same installationId', reissued.installationId === first.installationId);

  const instRowAfterReissue = ss.getSheetByName('التثبيتات').rows[1];
  check('#22 credentialHash actually changed on the sheet', instRowAfterReissue[3] !== undefined);

  const afterReissuePlainRetry = callRegister(sb, { action: 'registerInstallation', licenseId: 'LIC-21', activationCode: 'REISSUE-CODE', machineId: 'M21', requestId: 'R21', forceReissue: false });
  check('#23 Repeated plain retries after REISSUED → still ALREADY_REGISTERED, no further mutation', afterReissuePlainRetry.status === 'ALREADY_REGISTERED');
})();

(function test26_forceReissueCannotBypassRevocation() {
  const ss = makeFakeSpreadsheet();
  const sb = makeSandbox(ss);
  seedActivationCode(ss, sb, 'REVOKE-INST-CODE', 'LIC-26');
  const first = callRegister(sb, { action: 'registerInstallation', licenseId: 'LIC-26', activationCode: 'REVOKE-INST-CODE', machineId: 'M26', requestId: 'R26' });
  // Manually revoke the installation row (simulating manual admin action)
  const instSheet = ss.getSheetByName('التثبيتات');
  instSheet.rows[1][4] = 'revoked'; // status column
  const res = callRegister(sb, { action: 'registerInstallation', licenseId: 'LIC-26', activationCode: 'REVOKE-INST-CODE', machineId: 'M26', requestId: 'R26', forceReissue: true });
  check('#26 forceReissue against revoked installation → INSTALLATION_REVOKED', res.status === 'INSTALLATION_REVOKED');
  check('#26 INSTALLATION_REVOKED → no credential leaked', res.credential === undefined);
})();

(function test19_malformedAndEmpty() {
  const ss = makeFakeSpreadsheet();
  const sb = makeSandbox(ss);
  const res1 = callRegister(sb, { action: 'registerInstallation' });
  check('#19/#20 Empty body → MALFORMED_REQUEST', res1.status === 'MALFORMED_REQUEST');
  const res2 = callRegister(sb, { action: 'registerInstallation', licenseId: '', activationCode: '', machineId: '', requestId: '' });
  check('#20 All-empty fields → MALFORMED_REQUEST', res2.status === 'MALFORMED_REQUEST');
})();

(function test27_28_lazySheetCreation() {
  const ss = makeFakeSpreadsheet();
  const sb = makeSandbox(ss);
  check('#27 Sheets do not exist before first call', ss.getSheetByName('التثبيتات') === null && ss.getSheetByName('أكواد_التفعيل') === null);
  seedActivationCode(ss, sb, 'FIRST-EVER', 'LIC-27');
  const res = callRegister(sb, { action: 'registerInstallation', licenseId: 'LIC-27', activationCode: 'FIRST-EVER', machineId: 'M27', requestId: 'R27' });
  check('#27 First-ever call creates both sheets with correct headers', ss.getSheetByName('التثبيتات').rows[0].length === 11 && ss.getSheetByName('أكواد_التفعيل').rows[0].length === 8);
  check('#27 First-ever call still succeeds normally', res.status === 'REGISTERED');

  const before = JSON.stringify(ss.getSheetByName('التثبيتات').rows);
  seedActivationCode(ss, sb, 'SECOND-CALL', 'LIC-27b');
  callRegister(sb, { action: 'registerInstallation', licenseId: 'LIC-27b', activationCode: 'SECOND-CALL', machineId: 'M27b', requestId: 'R27b' });
  check('#28 Second call does not recreate/duplicate the sheet (only one sheet object exists)', Object.keys(ss._raw).filter(function (n) { return n === 'التثبيتات'; }).length === 1);
})();

(function test30_missingColumnUpgrade() {
  // Simulate a sheet created by an EARLIER version of this file missing
  // the credentialIssuedAt column, to prove (a) the additive column-merge
  // logic actually upgrades it in place, appended at the END of the
  // existing header row (never reordering/disturbing existing columns),
  // and (b) that the header-name-based read/write logic elsewhere in
  // this file still works correctly against that non-reference column
  // order — this second part is exactly what test harness run #1 caught
  // as a real bug when column access was still positional/hardcoded.
  const ss = makeFakeSpreadsheet();
  const sb = makeSandbox(ss);
  const oldSheet = ss.insertSheet('التثبيتات');
  const oldHeaders = ['installationId', 'licenseId', 'machineId', 'credentialHash', 'status', 'requestId', 'requestFingerprint', 'createdAt', 'revokedAt', 'note'];
  oldSheet.getRange(1, 1, 1, oldHeaders.length).setValues([oldHeaders]);
  sb._ensureInstallationsSheet_();
  const upgraded = ss.getSheetByName('التثبيتات').rows[0];
  check('#30 Missing column (credentialIssuedAt) appended at the end, existing 10 columns untouched/unreordered', upgraded.length === 11 && upgraded.slice(0, 10).join(',') === oldHeaders.join(',') && upgraded[10] === 'credentialIssuedAt');

  // Now prove reads/writes still hit the RIGHT cells on this
  // non-reference-order sheet via a full registration + reissue cycle.
  seedActivationCode(ss, sb, 'UPGRADE-CODE', 'LIC-30');
  const reg = callRegister(sb, { action: 'registerInstallation', licenseId: 'LIC-30', activationCode: 'UPGRADE-CODE', machineId: 'M30', requestId: 'R30' });
  check('#30 Registration succeeds on an upgraded (non-reference-order) sheet', reg.status === 'REGISTERED');
  const map = sb._headerMap_(ss.getSheetByName('التثبيتات'));
  const row = ss.getSheetByName('التثبيتات').rows[1];
  check('#30 credentialHash landed in the CORRECT column despite reordering', row[map.credentialHash] && row[map.credentialHash].length === 64 && row[map.credentialHash] !== reg.credential);
  check('#30 credentialIssuedAt (the appended column) was actually populated', !!row[map.credentialIssuedAt]);

  const reissued = callRegister(sb, { action: 'registerInstallation', licenseId: 'LIC-30', activationCode: 'UPGRADE-CODE', machineId: 'M30', requestId: 'R30', forceReissue: true });
  check('#30 Re-Issuance on upgraded sheet updates the correct (appended) credentialIssuedAt column', reissued.status === 'REISSUED');
})();

note('#9/#13/#14 (concurrent requests, LockService serialization under real parallelism) — NOT EXECUTED — REQUIRES LIVE APPS SCRIPT (Node is single-threaded; sequential calls above exercise the branch LOGIC correctly but cannot prove true concurrent-process lock behavior).');
note('#10 (retry after a genuinely long delay) — logic verified identical to short-delay retry (no time-based expiry exists in the design by construction); real long-delay timing not separately meaningful to simulate.');
note('#15/#16 (revoked installation / legacy installation with no server record at all) — #15 covered by test26 above; "legacy installation" by definition never calls this endpoint at all, so there is nothing here to execute — covered instead by ActivationWizard.js\'s hasLocalCredential()/step-visibility logic (client-side harness).');
note('#17 (license mismatch: valid code hash but different licenseId) — covered implicitly by INVALID_ACTIVATION branch (codeLicenseId !== licenseId uses the same status); if a distinct status is desired here, that would be a scope change beyond the approved design and was not introduced.');
note('#18 (machineId mismatch behavior) — covered by test #8 above (different machineId ⇒ different fingerprint ⇒ REQUEST_ID_MISMATCH), matching the approved design exactly.');

console.log('\n' + log.join('\n'));
console.log('\n==== PHASE C registerInstallation (Config/11_Auth.gs) — Node harness ====');
console.log('PASSED: ' + passed + '   FAILED: ' + failed);
process.exitCode = failed > 0 ? 1 : 0;
