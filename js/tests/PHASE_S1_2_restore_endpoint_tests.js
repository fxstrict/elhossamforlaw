/**
 * ================================================================
 * PHASE_S1_2_restore_endpoint_tests.js — نظام الحسام للمحاماة
 * ================================================================
 * Tests the REAL Config/06_Api.gs apiRestoreRow() (PHASE S.1.2) against
 * a fake Sheets backend, loading the actual production source files
 * together in one sandbox — mirrors the real single-Apps-Script-project
 * shared global scope (same technique already used by
 * js/tests/PHASE_C_registerInstallation_tests.js for Config/09_License.gs
 * + Config/11_Auth.gs).
 *
 * Files loaded: Config/00_Config.gs (SHEET_DEFS, getSheetHeaders, BRAND_*),
 * Config/01_Database.gs (openSpreadsheet), Config/06_Api.gs (apiRestoreRow
 * itself, plus apiUpdateRow/apiDeleteRow/_findRowByIdValue/
 * _resolveIdFieldForSheet/ensureSheetHeaders/_rejectIfRestrictedSheet_),
 * Config/08_Utils.gs (withRowLock, jsonResponse, isPhoneColumn,
 * isCaseNumberColumn).
 *
 * Covers the exact scenarios from the approved S.1.2 blueprint:
 *   - A row WITH an existing تومبستون (محذوف_في populated) — restore
 *     must clear it to '' and update آخر_تحديث.
 *   - A row with NO tombstone (defensive — restoring an already-live
 *     row must not error, just re-confirm it live).
 *   - Row not found by id at all -> NOT_FOUND (no row created — this is
 *     the deliberate difference from apiUpdateRow's Upsert-on-miss).
 *   - Missing/blank id -> MALFORMED_REQUEST.
 *   - Other fields in rowData ARE written (full-row update), matching
 *     apiUpdateRow()'s general behavior — only the tombstone rule
 *     differs.
 *   - apiUpdateRow() itself is completely unmodified: restoring via
 *     apiUpdateRow() (i.e., a plain 'update' on an already-tombstoned
 *     row) still preserves the tombstone exactly as before — proves
 *     PHASE S.1.2 did not weaken the STEP 3B/§19 safety guard.
 * ================================================================
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

let passed = 0, failed = 0;
const log = [];
function check(label, cond) {
  if (cond) { passed++; log.push('PASS: ' + label); }
  else { failed++; log.push('FAIL: ' + label); }
}

const CONFIG_DIR = path.join(__dirname, '..', '..', 'Config');
const configSource = ['00_Config.gs', '01_Database.gs', '09_License.gs', '11_Auth.gs', '06_Api.gs', '08_Utils.gs']
  .map(function (f) { return fs.readFileSync(path.join(CONFIG_DIR, f), 'utf8'); })
  .join('\n\n');

// --------------------------------------------------------------------
// Fake Sheets backend (same shape as PHASE_C_registerInstallation_tests.js's)
// --------------------------------------------------------------------
function makeFakeSpreadsheet() {
  const sheets = {};
  function FakeSheet(name) { this.name = name; this.rows = []; }
  FakeSheet.prototype.getLastColumn = function () { return this.rows.length > 0 ? this.rows[0].length : 0; };
  FakeSheet.prototype.getLastRow = function () { return this.rows.length; };
  FakeSheet.prototype.setFrozenRows = function () {};
  FakeSheet.prototype.getRange = function (row, col, numRows, numCols) {
    const self = this; numRows = numRows || 1; numCols = numCols || 1;
    return {
      setValues: function (values) {
        for (let r = 0; r < values.length; r++) {
          const t = row - 1 + r;
          while (self.rows.length <= t) self.rows.push([]);
          for (let c = 0; c < values[r].length; c++) self.rows[t][col - 1 + c] = values[r][c];
        }
      },
      setValue: function (value) {
        const t = row - 1;
        while (self.rows.length <= t) self.rows.push([]);
        self.rows[t][col - 1] = value;
      },
      getValues: function () {
        const out = [];
        for (let r = 0; r < numRows; r++) {
          const src = self.rows[row - 1 + r] || [];
          const line = [];
          for (let c = 0; c < numCols; c++) line.push(src[col - 1 + c] !== undefined ? src[col - 1 + c] : '');
          out.push(line);
        }
        return out;
      },
      getValue: function () {
        const src = self.rows[row - 1] || [];
        return src[col - 1] !== undefined ? src[col - 1] : '';
      },
      setBackground: function () { return this; },
      setFontColor: function () { return this; },
      setFontWeight: function () { return this; },
      setHorizontalAlignment: function () { return this; },
      setNumberFormat: function () { return this; }
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
    SpreadsheetApp: { openById: function () { return fakeSs; } },
    LockService: { getScriptLock: function () { return { waitLock: function () {}, releaseLock: function () {} }; } },
    PropertiesService: { getScriptProperties: function () { return { getProperty: function () { return 'fake-id'; }, setProperty: function () {} }; } },
    Date: Date
  };
  vm.createContext(sandbox);
  vm.runInContext(configSource, sandbox, { filename: 'Config-combined.gs' });
  return sandbox;
}

// Seeds a sheet with a header row + one data row, using the sheet's own
// SHEET_DEFS-declared headers (via the sandbox's getSheetHeaders()) so
// this test never hardcodes/guesses a column layout.
function seedSheet(sb, ss, sheetName, fieldValues) {
  const sheet = ss.insertSheet(sheetName);
  const headers = sb.getSheetHeaders(sheetName);
  sheet.appendRow(headers.slice());
  const row = headers.map(function (h) { return (fieldValues[h] !== undefined) ? fieldValues[h] : ''; });
  sheet.appendRow(row);
  return { sheet: sheet, headers: headers };
}

function callRestore(sb, sheetName, rowData, rowIndex) {
  return JSON.parse(sb.apiRestoreRow(sheetName, rowData, rowIndex).getContent());
}

// ====================================================================
// Tests
// ====================================================================

(function test_clears_existing_tombstone() {
  const ss = makeFakeSpreadsheet();
  const sb = makeSandbox(ss);
  const { sheet, headers } = seedSheet(sb, ss, 'الأطفال', {
    'رقم_الطفل': 'CHILD-1', 'رقم_القضية': '2026-1', 'الاسم': 'سارة',
    'محذوف_في': '2026-01-01T00:00:00.000Z', 'آخر_تحديث': '2026-01-01T00:00:00.000Z'
  });
  const res = callRestore(sb, 'الأطفال', { 'رقم_الطفل': 'CHILD-1', 'رقم_القضية': '2026-1', 'الاسم': 'سارة (محدّثة)' }, 0);
  check('success:true, status:RESTORED', res.success === true && res.status === 'RESTORED');
  const map = {}; headers.forEach(function (h, i) { map[h] = i; });
  const row = sheet.rows[1];
  check('محذوف_في cleared to empty string', row[map['محذوف_في']] === '');
  check('آخر_تحديث updated to a fresh timestamp', row[map['آخر_تحديث']] !== '2026-01-01T00:00:00.000Z' && row[map['آخر_تحديث']] === res.updatedAt);
  check('other field (الاسم) written from rowData (full-row update)', row[map['الاسم']] === 'سارة (محدّثة)');
})();

(function test_restore_row_with_no_existing_tombstone() {
  const ss = makeFakeSpreadsheet();
  const sb = makeSandbox(ss);
  const { sheet, headers } = seedSheet(sb, ss, 'الأطفال', { 'رقم_الطفل': 'CHILD-2', 'الاسم': 'يوسف', 'محذوف_في': '' });
  const res = callRestore(sb, 'الأطفال', { 'رقم_الطفل': 'CHILD-2', 'الاسم': 'يوسف' }, 0);
  check('restoring an already-live row succeeds (defensive, no error)', res.success === true && res.status === 'RESTORED');
  const map = {}; headers.forEach(function (h, i) { map[h] = i; });
  check('محذوف_في stays empty', sheet.rows[1][map['محذوف_في']] === '');
})();

(function test_not_found() {
  const ss = makeFakeSpreadsheet();
  const sb = makeSandbox(ss);
  seedSheet(sb, ss, 'الأطفال', { 'رقم_الطفل': 'CHILD-OTHER' });
  const res = callRestore(sb, 'الأطفال', { 'رقم_الطفل': 'CHILD-DOES-NOT-EXIST' }, 0);
  check('unknown id -> success:false, status:NOT_FOUND (NOT an Upsert, unlike apiUpdateRow)', res.success === false && res.status === 'NOT_FOUND');
})();

(function test_malformed_missing_id() {
  const ss = makeFakeSpreadsheet();
  const sb = makeSandbox(ss);
  seedSheet(sb, ss, 'الأطفال', { 'رقم_الطفل': 'CHILD-3' });
  const res1 = callRestore(sb, 'الأطفال', { 'الاسم': 'بلا معرف' }, 0);
  check('missing id field entirely -> MALFORMED_REQUEST', res1.success === false && res1.status === 'MALFORMED_REQUEST');
  const res2 = callRestore(sb, 'الأطفال', { 'رقم_الطفل': '   ' }, 0);
  check('blank/whitespace-only id -> MALFORMED_REQUEST', res2.success === false && res2.status === 'MALFORMED_REQUEST');
})();

(function test_apiUpdateRow_still_preserves_tombstone_unmodified() {
  // Proves PHASE S.1.2 did NOT weaken apiUpdateRow()'s STEP 3B/§19 guard:
  // an ordinary 'update' on an already-tombstoned row still preserves the
  // tombstone exactly as before this phase.
  const ss = makeFakeSpreadsheet();
  const sb = makeSandbox(ss);
  const { sheet, headers } = seedSheet(sb, ss, 'الأطفال', {
    'رقم_الطفل': 'CHILD-4', 'الاسم': 'قديم', 'محذوف_في': '2026-02-02T00:00:00.000Z'
  });
  const res = JSON.parse(sb.apiUpdateRow('الأطفال', { 'رقم_الطفل': 'CHILD-4', 'الاسم': 'جديد' }, 0).getContent());
  check('apiUpdateRow() still succeeds normally', res.status === 'ok');
  const map = {}; headers.forEach(function (h, i) { map[h] = i; });
  check('apiUpdateRow() STILL preserves an existing tombstone (unchanged by S.1.2)', sheet.rows[1][map['محذوف_في']] === '2026-02-02T00:00:00.000Z');
  check('apiUpdateRow() still updates other fields normally', sheet.rows[1][map['الاسم']] === 'جديد');
})();

(function test_restrictedSheet_guard_still_applies() {
  // apiRestoreRow() reuses _rejectIfRestrictedSheet_() — spot-check it's
  // actually wired (structural check: function exists and is called).
  const ss = makeFakeSpreadsheet();
  const sb = makeSandbox(ss);
  const src = sb.apiRestoreRow.toString();
  check('apiRestoreRow() calls _rejectIfRestrictedSheet_()', src.indexOf('_rejectIfRestrictedSheet_') !== -1);
})();

console.log(log.join('\n'));
console.log('\n==== PHASE S.1.2 apiRestoreRow (Config/06_Api.gs) — Node harness ====');
console.log('PASSED: ' + passed + '   FAILED: ' + failed);
if (failed > 0) process.exit(1);
