/**
 * ================================================================
 * PHASE_F4_PREP_C1_recovery_tests.js — نظام الحسام للمحاماة
 * ================================================================
 * PHASE: F.4-PREP-IMPL-C.1 — Recovery Automated Test Gap
 *
 * Standalone Node harness (`node js/tests/PHASE_F4_PREP_C1_recovery_tests.js`,
 * no browser, no real Apps Script/Google Sheets required) for
 * Config/11_Auth.gs's apiRecoverInstallationCredential() — the
 * PHASE F.3.2 "Installation Credential Recovery (Model 3)" endpoint —
 * plus its read-only dependency on Config/09_License.gs's
 * _ensureLicensesSheet_()/LICENSES_HEADERS (used internally by
 * _readLicenseStatusForRecovery_()).
 *
 * This is a NEW, ADDITIVE test file only. It does not modify
 * Config/11_Auth.gs, Config/09_License.gs, InstallationRegistrar.js,
 * LicenseCore.js, any .hsm/ECDSA/machineId/installationId logic, any
 * Stage-1/Stage-2 policy, apiRegisterInstallation, any recovery
 * PRODUCTION logic, any Sheet schema, or any License Manager
 * production behavior. It only READS the two .gs source files as text
 * and evaluates them in a sandboxed Node vm context with faithful
 * mocks — exactly the same technique as, and reusing the fake-sheet /
 * sandbox pattern of, js/tests/PHASE_C_registerInstallation_tests.js.
 *
 * Scope: closes the gap documented in MASTER CONTROL REPORT §5
 * (F.4-PREP-IMPL-C.1) — an executable test for every one of the 9
 * documented recovery statuses:
 *   NOT_FOUND, AMBIGUOUS_LICENSE_ID, INSTALLATION_REVOKED,
 *   LICENSE_REVOKED, UNAUTHORIZED, SERVER_NOT_CONFIGURED,
 *   MALFORMED_REQUEST, LOCK_TIMEOUT, UNKNOWN_ERROR
 * plus the success (recovered) path itself.
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

const AUTH_GS_PATH    = path.join(__dirname, '..', '..', 'Config', '11_Auth.gs');
const LICENSE_GS_PATH = path.join(__dirname, '..', '..', 'Config', '09_License.gs');
const authSource    = fs.readFileSync(AUTH_GS_PATH, 'utf8');
const licenseSource = fs.readFileSync(LICENSE_GS_PATH, 'utf8');

// --------------------------------------------------------------------
// Fake Sheets backend — identical in shape/behaviour to the one in
// PHASE_C_registerInstallation_tests.js (same call patterns:
// getSheetByName/insertSheet/getRange/getValues/setValues/setValue/
// appendRow/getDataRange/getLastColumn/setFrozenRows). Duplicated here
// (rather than require()'d) to keep this harness standalone/runnable
// on its own, matching the existing convention in this test folder.
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

/**
 * @param {Object} fakeSs
 * @param {Object} [opts]
 * @param {string|null} [opts.recoverySecret] value returned by
 *   PropertiesService.getScriptProperties().getProperty('HOSSAM_RECOVERY_ADMIN_SECRET');
 *   undefined/null/'' → simulates "not configured".
 * @param {boolean} [opts.propertiesThrows] if true, getScriptProperties()
 *   throws (simulates the other _authenticateRecoveryAdmin_ catch branch).
 * @param {boolean} [opts.lockThrows] if true, LockService.getScriptLock().waitLock()
 *   throws (simulates LOCK_TIMEOUT).
 * @param {boolean} [opts.spreadsheetThrows] if true, openSpreadsheet()
 *   throws AFTER the lock is acquired (simulates an unexpected internal
 *   failure → UNKNOWN_ERROR), matching apiRecoverInstallationCredential's
 *   outer try/catch contract.
 */
function makeSandbox(fakeSs, opts) {
  opts = opts || {};
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
        return {
          waitLock: function () {
            if (opts.lockThrows) throw new Error('simulated lock timeout');
          },
          releaseLock: function () {}
        };
      }
    },
    PropertiesService: {
      getScriptProperties: function () {
        if (opts.propertiesThrows) throw new Error('simulated PropertiesService failure');
        return {
          getProperty: function (key) {
            if (key === 'HOSSAM_RECOVERY_ADMIN_SECRET') {
              return Object.prototype.hasOwnProperty.call(opts, 'recoverySecret') ? opts.recoverySecret : null;
            }
            return null;
          }
        };
      }
    },
    openSpreadsheet: function () {
      if (opts.spreadsheetThrows) throw new Error('simulated spreadsheet access failure');
      return fakeSs;
    },
    // jsonResponse() lives in Config/08_Utils.gs in the real single-scope
    // Apps Script project; mocked here identically (same shape) since
    // this harness loads only 11_Auth.gs + 09_License.gs in isolation.
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
  // Load 09_License.gs first (defines _ensureLicensesSheet_/LICENSES_HEADERS,
  // a read-only dependency of _readLicenseStatusForRecovery_() in 11_Auth.gs),
  // then 11_Auth.gs itself — both are function/const top-level declarations
  // only (verified: no immediately-invoked code), so load order between the
  // two files is safe as long as both finish loading before any function is
  // actually called, which is the case here.
  vm.runInContext(licenseSource, sandbox, { filename: '09_License.gs' });
  vm.runInContext(authSource, sandbox, { filename: '11_Auth.gs' });
  return sandbox;
}

function callRecover(sandbox, body) {
  const response = sandbox.apiRecoverInstallationCredential(body);
  return JSON.parse(response.getContent());
}

/** Seeds one row directly into "التثبيتات" (bypassing apiRegisterInstallation,
 * exactly like production data would already exist from a prior real
 * registration). Uses the real _ensureInstallationsSheet_()/_headerMap_()
 * from the loaded source so column order always matches the actual schema. */
function seedInstallation(ss, sb, overrides) {
  const sheet = sb._ensureInstallationsSheet_();
  const map = sb._headerMap_(sheet);
  const data = Object.assign({
    installationId: 'inst-' + Math.random().toString(36).slice(2),
    licenseId: 'LIC-X',
    machineId: 'OLD-MACHINE',
    credentialHash: sb._sha256Hex_('old-credential-' + Math.random()),
    status: 'active',
    requestId: 'req-' + Math.random().toString(36).slice(2),
    requestFingerprint: 'fp-' + Math.random().toString(36).slice(2),
    createdAt: new Date(Date.now() - 86400000).toISOString(),
    credentialIssuedAt: new Date(Date.now() - 86400000).toISOString(),
    revokedAt: '',
    note: ''
  }, overrides || {});
  sheet.appendRow(sb._buildRowFromObject_(data, map));
  return data;
}

/** Seeds one row directly into "التراخيص" using the real LICENSES_HEADERS
 * order (licenseId, customer, machineId, status, note, updatedAt). */
function seedLicense(ss, sb, licenseId, status) {
  const sheet = sb._ensureLicensesSheet_();
  sheet.appendRow([licenseId, 'عميل تجريبي', '', status, '', new Date().toISOString()]);
}

const VALID_SECRET = 'test-recovery-secret-do-not-use-in-prod';

// ====================================================================
// Tests — one per documented recovery status, plus the success path
// ====================================================================

(function test_MALFORMED_REQUEST_missingFields() {
  const ss = makeFakeSpreadsheet();
  const sb = makeSandbox(ss, { recoverySecret: VALID_SECRET });
  const res1 = callRecover(sb, { action: 'recoverInstallationCredential', recoveryAuth: VALID_SECRET, requestId: 'R1' });
  check('MALFORMED_REQUEST: missing licenseId+machineId → success:false', res1.success === false);
  check('MALFORMED_REQUEST: missing licenseId+machineId → status MALFORMED_REQUEST', res1.status === 'MALFORMED_REQUEST');

  const res2 = callRecover(sb, { action: 'recoverInstallationCredential', licenseId: 'LIC-1', machineId: '', recoveryAuth: VALID_SECRET, requestId: 'R2' });
  check('MALFORMED_REQUEST: empty machineId → status MALFORMED_REQUEST', res2.status === 'MALFORMED_REQUEST');

  const res3 = callRecover(sb, { action: 'recoverInstallationCredential', licenseId: 'LIC-1', machineId: 'M1', recoveryAuth: VALID_SECRET, requestId: '' });
  check('MALFORMED_REQUEST: empty requestId → status MALFORMED_REQUEST', res3.status === 'MALFORMED_REQUEST');
})();

(function test_SERVER_NOT_CONFIGURED_propertyMissing() {
  const ss = makeFakeSpreadsheet();
  const sb = makeSandbox(ss, { recoverySecret: null }); // property never set
  const res = callRecover(sb, { action: 'recoverInstallationCredential', licenseId: 'LIC-2', machineId: 'M2', recoveryAuth: 'anything', requestId: 'R2' });
  check('SERVER_NOT_CONFIGURED: property never set → success:false', res.success === false);
  check('SERVER_NOT_CONFIGURED: property never set → status SERVER_NOT_CONFIGURED', res.status === 'SERVER_NOT_CONFIGURED');
})();

(function test_SERVER_NOT_CONFIGURED_propertiesServiceThrows() {
  const ss = makeFakeSpreadsheet();
  const sb = makeSandbox(ss, { propertiesThrows: true });
  const res = callRecover(sb, { action: 'recoverInstallationCredential', licenseId: 'LIC-2b', machineId: 'M2b', recoveryAuth: 'anything', requestId: 'R2b' });
  check('SERVER_NOT_CONFIGURED: PropertiesService throws → status SERVER_NOT_CONFIGURED', res.status === 'SERVER_NOT_CONFIGURED');
})();

(function test_UNAUTHORIZED_wrongSecret() {
  const ss = makeFakeSpreadsheet();
  const sb = makeSandbox(ss, { recoverySecret: VALID_SECRET });
  const res = callRecover(sb, { action: 'recoverInstallationCredential', licenseId: 'LIC-3', machineId: 'M3', recoveryAuth: 'wrong-secret', requestId: 'R3' });
  check('UNAUTHORIZED: wrong recoveryAuth → success:false', res.success === false);
  check('UNAUTHORIZED: wrong recoveryAuth → status UNAUTHORIZED', res.status === 'UNAUTHORIZED');
})();

(function test_UNAUTHORIZED_missingAuth() {
  const ss = makeFakeSpreadsheet();
  const sb = makeSandbox(ss, { recoverySecret: VALID_SECRET });
  const res = callRecover(sb, { action: 'recoverInstallationCredential', licenseId: 'LIC-3b', machineId: 'M3b', requestId: 'R3b' }); // no recoveryAuth at all
  check('UNAUTHORIZED: recoveryAuth omitted entirely → status UNAUTHORIZED', res.status === 'UNAUTHORIZED');
})();

(function test_UNAUTHORIZED_neverLeaksSecret() {
  const ss = makeFakeSpreadsheet();
  const sb = makeSandbox(ss, { recoverySecret: VALID_SECRET });
  const response = sb.apiRecoverInstallationCredential({ action: 'recoverInstallationCredential', licenseId: 'LIC-3c', machineId: 'M3c', recoveryAuth: 'wrong', requestId: 'R3c' });
  const raw = response.getContent();
  check('Security: UNAUTHORIZED response body never contains the real server secret', raw.indexOf(VALID_SECRET) === -1);
})();

(function test_NOT_FOUND_noInstallationAtAll() {
  const ss = makeFakeSpreadsheet();
  const sb = makeSandbox(ss, { recoverySecret: VALID_SECRET });
  // No installation seeded at all — sheet will be lazily created empty.
  const res = callRecover(sb, { action: 'recoverInstallationCredential', licenseId: 'LIC-NOTFOUND', machineId: 'M4', recoveryAuth: VALID_SECRET, requestId: 'R4' });
  check('NOT_FOUND: no matching installation row → success:false', res.success === false);
  check('NOT_FOUND: no matching installation row → status NOT_FOUND', res.status === 'NOT_FOUND');
})();

(function test_NOT_FOUND_differentLicenseIdExists() {
  const ss = makeFakeSpreadsheet();
  const sb = makeSandbox(ss, { recoverySecret: VALID_SECRET });
  seedInstallation(ss, sb, { licenseId: 'LIC-OTHER', status: 'active' });
  const res = callRecover(sb, { action: 'recoverInstallationCredential', licenseId: 'LIC-NOTFOUND-2', machineId: 'M4b', recoveryAuth: VALID_SECRET, requestId: 'R4b' });
  check('NOT_FOUND: only a different licenseId exists → status NOT_FOUND', res.status === 'NOT_FOUND');
})();

(function test_AMBIGUOUS_LICENSE_ID() {
  const ss = makeFakeSpreadsheet();
  const sb = makeSandbox(ss, { recoverySecret: VALID_SECRET });
  seedInstallation(ss, sb, { licenseId: 'LIC-DUP', machineId: 'M-A', status: 'active' });
  seedInstallation(ss, sb, { licenseId: 'LIC-DUP', machineId: 'M-B', status: 'active' });
  const before = JSON.stringify(ss.getSheetByName('التثبيتات').rows);
  const res = callRecover(sb, { action: 'recoverInstallationCredential', licenseId: 'LIC-DUP', machineId: 'M5', recoveryAuth: VALID_SECRET, requestId: 'R5' });
  check('AMBIGUOUS_LICENSE_ID: 2 rows same licenseId → success:false', res.success === false);
  check('AMBIGUOUS_LICENSE_ID: 2 rows same licenseId → status AMBIGUOUS_LICENSE_ID', res.status === 'AMBIGUOUS_LICENSE_ID');
  const after = JSON.stringify(ss.getSheetByName('التثبيتات').rows);
  check('AMBIGUOUS_LICENSE_ID: no write happened at all ("رفض كامل بلا أي كتابة")', before === after);
})();

(function test_INSTALLATION_REVOKED() {
  const ss = makeFakeSpreadsheet();
  const sb = makeSandbox(ss, { recoverySecret: VALID_SECRET });
  const seeded = seedInstallation(ss, sb, { licenseId: 'LIC-REV-INST', status: 'revoked' });
  const res = callRecover(sb, { action: 'recoverInstallationCredential', licenseId: 'LIC-REV-INST', machineId: 'M6', recoveryAuth: VALID_SECRET, requestId: 'R6' });
  check('INSTALLATION_REVOKED: revoked installation row → success:false', res.success === false);
  check('INSTALLATION_REVOKED: revoked installation row → status INSTALLATION_REVOKED', res.status === 'INSTALLATION_REVOKED');
  check('INSTALLATION_REVOKED: no credential leaked in response', res.credential === undefined);
  const sheet = ss.getSheetByName('التثبيتات');
  const map = sb._headerMap_(sheet);
  check('INSTALLATION_REVOKED: machineId on the row is untouched', sheet.rows[1][map.machineId] === seeded.machineId);
})();

(function test_LICENSE_REVOKED() {
  const ss = makeFakeSpreadsheet();
  const sb = makeSandbox(ss, { recoverySecret: VALID_SECRET });
  seedInstallation(ss, sb, { licenseId: 'LIC-REV-LIC', status: 'active' });
  seedLicense(ss, sb, 'LIC-REV-LIC', 'revoked');
  const res = callRecover(sb, { action: 'recoverInstallationCredential', licenseId: 'LIC-REV-LIC', machineId: 'M7', recoveryAuth: VALID_SECRET, requestId: 'R7' });
  check('LICENSE_REVOKED: license status=revoked in "التراخيص" → success:false', res.success === false);
  check('LICENSE_REVOKED: license status=revoked in "التراخيص" → status LICENSE_REVOKED', res.status === 'LICENSE_REVOKED');
})();

(function test_LICENSE_REVOKED_transferredCounts() {
  const ss = makeFakeSpreadsheet();
  const sb = makeSandbox(ss, { recoverySecret: VALID_SECRET });
  seedInstallation(ss, sb, { licenseId: 'LIC-TRANSFERRED', status: 'active' });
  seedLicense(ss, sb, 'LIC-TRANSFERRED', 'transferred');
  const res = callRecover(sb, { action: 'recoverInstallationCredential', licenseId: 'LIC-TRANSFERRED', machineId: 'M7b', recoveryAuth: VALID_SECRET, requestId: 'R7b' });
  check('LICENSE_REVOKED: license status=transferred is ALSO rejected as LICENSE_REVOKED', res.status === 'LICENSE_REVOKED');
})();

(function test_LOCK_TIMEOUT() {
  const ss = makeFakeSpreadsheet();
  const sb = makeSandbox(ss, { recoverySecret: VALID_SECRET, lockThrows: true });
  const res = callRecover(sb, { action: 'recoverInstallationCredential', licenseId: 'LIC-8', machineId: 'M8', recoveryAuth: VALID_SECRET, requestId: 'R8' });
  check('LOCK_TIMEOUT: lock.waitLock() throws → success:false', res.success === false);
  check('LOCK_TIMEOUT: lock.waitLock() throws → status LOCK_TIMEOUT', res.status === 'LOCK_TIMEOUT');
})();

(function test_UNKNOWN_ERROR() {
  const ss = makeFakeSpreadsheet();
  const sb = makeSandbox(ss, { recoverySecret: VALID_SECRET, spreadsheetThrows: true });
  const res = callRecover(sb, { action: 'recoverInstallationCredential', licenseId: 'LIC-9', machineId: 'M9', recoveryAuth: VALID_SECRET, requestId: 'R9' });
  check('UNKNOWN_ERROR: unexpected internal exception (openSpreadsheet throws) → success:false', res.success === false);
  check('UNKNOWN_ERROR: unexpected internal exception → status UNKNOWN_ERROR', res.status === 'UNKNOWN_ERROR');
})();

(function test_SUCCESS_recoveredPath() {
  const ss = makeFakeSpreadsheet();
  const sb = makeSandbox(ss, { recoverySecret: VALID_SECRET });
  const seeded = seedInstallation(ss, sb, { licenseId: 'LIC-OK', machineId: 'OLD-MACHINE', status: 'active' });
  // No row at all in "التراخيص" for this licenseId → _readLicenseStatusForRecovery_
  // must treat it as 'unknown', which the design explicitly does NOT reject.
  const res = callRecover(sb, { action: 'recoverInstallationCredential', licenseId: 'LIC-OK', machineId: 'NEW-MACHINE', recoveryAuth: VALID_SECRET, requestId: 'R10' });

  check('SUCCESS: success:true', res.success === true);
  check('SUCCESS: installationId unchanged from the existing row', res.installationId === seeded.installationId);
  check('SUCCESS: credential present, 64 hex chars (raw, opaque)', typeof res.credential === 'string' && /^[0-9a-f]{64}$/.test(res.credential));
  check('SUCCESS: machineId echoes the NEW machineId supplied by the client', res.machineId === 'NEW-MACHINE');
  check('SUCCESS: idempotent:false (this endpoint always mints a new credential)', res.idempotent === false);

  const sheet = ss.getSheetByName('التثبيتات');
  const map = sb._headerMap_(sheet);
  const row = sheet.rows[1];
  check('SUCCESS: exactly one installation row still exists (no new row created)', sheet.rows.length === 2);
  check('SUCCESS: licenseId on the row is untouched', row[map.licenseId] === 'LIC-OK');
  check('SUCCESS: installationId on the row is untouched', row[map.installationId] === seeded.installationId);
  check('SUCCESS: machineId on the row was updated in place', row[map.machineId] === 'NEW-MACHINE');
  check('SUCCESS: credentialHash on the row changed from the old seeded hash', row[map.credentialHash] !== seeded.credentialHash);
  check('SUCCESS: credentialHash stored != raw credential returned to client', row[map.credentialHash] !== res.credential && row[map.credentialHash].length === 64);
  check('SUCCESS: credentialIssuedAt was refreshed (differs from the old seeded value)', row[map.credentialIssuedAt] !== seeded.credentialIssuedAt);
})();

(function test_SUCCESS_licenseActiveExplicitlyAllowed() {
  const ss = makeFakeSpreadsheet();
  const sb = makeSandbox(ss, { recoverySecret: VALID_SECRET });
  seedInstallation(ss, sb, { licenseId: 'LIC-ACTIVE-EXPLICIT', status: 'active' });
  seedLicense(ss, sb, 'LIC-ACTIVE-EXPLICIT', 'active');
  const res = callRecover(sb, { action: 'recoverInstallationCredential', licenseId: 'LIC-ACTIVE-EXPLICIT', machineId: 'M11', recoveryAuth: VALID_SECRET, requestId: 'R11' });
  check('SUCCESS: license explicitly status=active in "التراخيص" → recovery allowed', res.success === true);
})();

(function test_recoveryAuthNeverLeakedOnSuccess() {
  const ss = makeFakeSpreadsheet();
  const sb = makeSandbox(ss, { recoverySecret: VALID_SECRET });
  seedInstallation(ss, sb, { licenseId: 'LIC-NOLEAK', status: 'active' });
  const response = sb.apiRecoverInstallationCredential({ action: 'recoverInstallationCredential', licenseId: 'LIC-NOLEAK', machineId: 'M12', recoveryAuth: VALID_SECRET, requestId: 'R12' });
  const raw = response.getContent();
  check('Security: successful response body never echoes back the admin secret', raw.indexOf(VALID_SECRET) === -1);
})();

note('Genuine concurrent-process LockService serialization under real parallelism is OUT OF SCOPE here (Node is single-threaded), same documented limitation as PHASE_C_registerInstallation_tests.js — the LOCK_TIMEOUT branch LOGIC above is exercised correctly, but true concurrent-process lock contention cannot be proven outside a live Apps Script runtime.');
note('Constant-time comparison timing safety of _constantTimeEquals_() (reused unmodified from apiRegisterInstallation\'s existing security posture) is not re-verified here — it is pre-existing code untouched by F.4-PREP-IMPL-C.1 and was not in scope for this phase.');
note('This harness intentionally does not call the real Config/08_Utils.gs jsonResponse() — it mocks it identically in shape, exactly as PHASE_C_registerInstallation_tests.js already does, since only 11_Auth.gs + 09_License.gs are loaded here in isolation.');

console.log('\n' + log.join('\n'));
console.log('\n==== PHASE F.4-PREP-IMPL-C.1 — Recovery (apiRecoverInstallationCredential) — Node harness ====');
console.log('PASSED: ' + passed + '   FAILED: ' + failed);
process.exitCode = failed > 0 ? 1 : 0;
