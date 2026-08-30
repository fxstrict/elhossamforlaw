/**
 * verify_api_addrow_idempotent_replay.js
 * PROBLEM 7 (Case Save Cycle audit, v79) — Regression test.
 *
 * ROOT CAUSE (proved by code trace across the full path, not guessed):
 *   Traced the full chain: saveCase()/saveOpponent()/etc. -> repository
 *   .create() (client-side ConflictError already prevents a genuine
 *   duplicate id from ever reaching the network — see
 *   verify_case_conflict_source_after_delete.js, Problem 6) ->
 *   ApiService.syncRow() -> saveData() -> _post() -> fetch() ->
 *   Config/06_Api.gs's apiAddRow().
 *
 *   js/api/api.js's saveData() catches ANY thrown error from _post()
 *   (a genuine network failure, but ALSO an HTTP non-ok status or a
 *   parsed {error:...} body per _post()'s own doc comment) and enqueues
 *   the identical {action:'add', sheet, data} body into
 *   js/core/OfflineQueue.js for later replay. OfflineQueue.replay()
 *   re-POSTs that exact body via ApiService._post() directly, with no
 *   idempotency key of any kind.
 *
 *   A well-known Apps Script Web App failure mode is the REQUEST
 *   succeeding server-side (the row genuinely gets appended) while the
 *   RESPONSE fails to reach the client — indistinguishable, from the
 *   client's point of view, from the request never arriving at all. In
 *   that case OfflineQueue queues and later replays an add whose row
 *   already exists.
 *
 *   Config/06_Api.gs's apiAddRow(), BEFORE this fix, had NO existence
 *   check whatsoever — it unconditionally computed
 *   targetRow = sheet.getLastRow() + 1 and appended. Every replay of an
 *   already-succeeded add therefore created a genuine duplicate row —
 *   repeated failed-response cycles could compound into several
 *   duplicates for the same case/client/opponent, exactly matching the
 *   report ("القضية تحفظ مرتين"، "الخصم يحفظ ثلاث مرات").
 *
 *   apiUpdateRow() (same file) already had the exact inverse guard
 *   ("byId === -1 -> Upsert via apiAddRow()", explicitly commented
 *   FIX C1) — apiAddRow() lacked the symmetric "byId !== -1 -> update
 *   in place instead of appending again" guard. This fix adds it,
 *   reusing the SAME _resolveIdFieldForSheet()/_findRowByIdValue()
 *   helpers apiUpdateRow() already uses — no new columns, no new
 *   schema, no client-side change.
 *
 * This test loads the REAL Config/00_Config.gs + Config/06_Api.gs
 * (unmodified) into a vm context with a minimal in-memory Sheet mock —
 * same harness verify_api_gs_id_based_matching.js already established
 * for exercising this exact file.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

let passed = 0;
let failed = 0;
const log = [];

function check(name, fn) {
  try {
    fn();
    passed++;
    log.push('PASS — ' + name);
  } catch (e) {
    failed++;
    log.push('FAIL — ' + name + '  =>  ' + e.message);
  }
}

function makeFakeSheet(headers, rows) {
  const grid = [headers.slice()].concat(rows.map(function (r) { return r.slice(); }));
  return {
    _grid: grid,
    getLastRow: function () { return grid.length; },
    getLastColumn: function () { return grid[0].length; },
    getRange: function (row, col, numRows, numCols) {
      numRows = numRows || 1;
      numCols = numCols || 1;
      const self = this;
      return {
        getValues: function () {
          const out = [];
          for (let r = 0; r < numRows; r++) {
            const gridRow = self._grid[(row - 1) + r] || [];
            const outRow = [];
            for (let c = 0; c < numCols; c++) {
              outRow.push(gridRow[(col - 1) + c] !== undefined ? gridRow[(col - 1) + c] : '');
            }
            out.push(outRow);
          }
          return out;
        },
        getValue: function () {
          const gridRow = self._grid[row - 1] || [];
          return gridRow[col - 1] !== undefined ? gridRow[col - 1] : '';
        },
        setValues: function (values) {
          for (let r = 0; r < values.length; r++) {
            while (self._grid.length <= (row - 1) + r) self._grid.push([]);
            const gridRow = self._grid[(row - 1) + r];
            for (let c = 0; c < values[r].length; c++) {
              gridRow[(col - 1) + c] = values[r][c];
            }
          }
          return this;
        },
        setValue: function (v) {
          while (self._grid.length <= row - 1) self._grid.push([]);
          self._grid[row - 1][col - 1] = v;
          return this;
        },
        setNumberFormat: function () { return this; },
        setBackground: function () { return this; },
        setFontColor: function () { return this; },
        setFontWeight: function () { return this; },
        setHorizontalAlignment: function () { return this; }
      };
    },
    setFrozenRows: function () {},
    deleteRow: function (row) { grid.splice(row - 1, 1); }
  };
}

function loadGasContext(sheetsByName) {
  const configSrc = fs.readFileSync(path.join(__dirname, '..', '..', 'Config', '00_Config.gs'), 'utf8');
  const apiSrc = fs.readFileSync(path.join(__dirname, '..', '..', 'Config', '06_Api.gs'), 'utf8');

  const calls = { addToCalendar: 0, updateCalendarEvent: 0, deleteCalendarEvent: 0 };

  const sandbox = {
    console: console,
    PropertiesService: { getScriptProperties: function () { return { getProperty: function () { return null; }, setProperty: function () {} }; } },
    Logger: { log: function () {} },
    openSpreadsheet: function () {
      return { getSheetByName: function (name) { return sheetsByName[name] || null; } };
    },
    setupSheets: function () {},
    isPhoneColumn: function () { return false; },
    isCaseNumberColumn: function () { return false; },
    addToCalendar: function () { calls.addToCalendar++; return 'evt-1'; },
    updateCalendarEvent: function (oldId) { calls.updateCalendarEvent++; return oldId || 'evt-1'; },
    deleteCalendarEvent: function () { calls.deleteCalendarEvent++; },
    jsonResponse: function (data) {
      const json = JSON.stringify(data);
      return { getContent: function () { return json; } };
    }
  };
  sandbox.global = sandbox;
  const context = vm.createContext(sandbox);
  vm.runInContext(configSrc, context, { filename: '00_Config.gs' });
  vm.runInContext(apiSrc, context, { filename: '06_Api.gs' });
  context.__calls = calls;
  return context;
}

function main() {
  // ================================================================
  // Group 1 — القضايا: a replayed add of an ALREADY-SUCCEEDED case
  // must not create a duplicate row.
  // ================================================================
  {
    const headers = ['رقم_القضية', 'عنوان_القضية', 'اسم_الموكل'];
    const sheet = makeFakeSheet(headers, []); // empty sheet, data starts fresh
    const ctx = loadGasContext({ 'القضايا': sheet });

    const rowData = { 'رقم_القضية': 'C-2026-500', 'عنوان_القضية': 'قضية اختبار التكرار', 'اسم_الموكل': 'طارق سعيد' };

    // First add: the ORIGINAL request. Server appends the row
    // successfully (this is the part whose RESPONSE gets "lost" in the
    // real bug scenario — but the row itself IS written here, exactly
    // as it would be on the real server).
    const first = ctx.apiAddRow('القضايا', rowData);
    check('first apiAddRow() call appends the row normally', () => {
      assert.strictEqual(JSON.parse(first.getContent()).status, 'ok');
      assert.strictEqual(sheet._grid.length, 2, 'expected exactly 1 data row (header + 1)');
    });

    // Second add: OfflineQueue.replay() re-POSTing the IDENTICAL body,
    // because the client never received the first call's response.
    const replay = ctx.apiAddRow('القضايا', rowData);
    check('REPRODUCES THE BUG (fixed): a replayed apiAddRow() with the same رقم_القضية does NOT create a duplicate row', () => {
      assert.strictEqual(JSON.parse(replay.getContent()).status, 'ok');
      assert.strictEqual(sheet._grid.length, 2, 'expected STILL exactly 1 data row after the replay — got ' + (sheet._grid.length - 1) + ' data row(s), meaning a duplicate was created');
    });

    check('a THIRD replay (e.g. two consecutive lost responses) still does not compound into more duplicates', () => {
      ctx.apiAddRow('القضايا', rowData);
      assert.strictEqual(sheet._grid.length, 2, 'expected still exactly 1 data row after a third replay');
    });

    check('the surviving row has the correct, current data (not blanked or corrupted by the replay)', () => {
      assert.strictEqual(sheet._grid[1][0], 'C-2026-500');
      assert.strictEqual(sheet._grid[1][1], 'قضية اختبار التكرار');
      assert.strictEqual(sheet._grid[1][2], 'طارق سعيد');
    });
  }

  // ================================================================
  // Group 2 — الخصوم (opponents): same guard, different sheet — proves
  // the fix is generic (SHEET_DEFS-driven), not Cases-specific, closing
  // "الخصم يحفظ ثلاث مرات" specifically.
  // ================================================================
  {
    const headers = ['رقم_الخصم', 'اسم_الخصم'];
    const sheet = makeFakeSheet(headers, []);
    const ctx = loadGasContext({ 'الخصوم': sheet });
    const rowData = { 'رقم_الخصم': 'OPP-77', 'اسم_الخصم': 'محمود عادل' };

    ctx.apiAddRow('الخصوم', rowData);
    ctx.apiAddRow('الخصوم', rowData); // replay #1
    ctx.apiAddRow('الخصوم', rowData); // replay #2 — "three times" scenario

    check('الخصوم: three apiAddRow() calls with the same رقم_الخصم (simulating "الخصم يحفظ ثلاث مرات") result in exactly ONE row, not three', () => {
      assert.strictEqual(sheet._grid.length, 2, 'expected exactly 1 data row after 3 add calls with the same id — got ' + (sheet._grid.length - 1));
    });
  }

  // ================================================================
  // Group 3 — genuinely DIFFERENT records must still both be added —
  // proves the fix does not over-block legitimate distinct adds.
  // ================================================================
  {
    const headers = ['رقم_القضية', 'عنوان_القضية'];
    const sheet = makeFakeSheet(headers, []);
    const ctx = loadGasContext({ 'القضايا': sheet });

    ctx.apiAddRow('القضايا', { 'رقم_القضية': 'C-2026-1', 'عنوان_القضية': 'الأولى' });
    ctx.apiAddRow('القضايا', { 'رقم_القضية': 'C-2026-2', 'عنوان_القضية': 'الثانية' });

    check('two DIFFERENT case numbers both get their own row — the idempotency guard only collapses TRUE id matches', () => {
      assert.strictEqual(sheet._grid.length, 3, 'expected 2 distinct data rows for 2 distinct case numbers');
    });
  }

  // ================================================================
  // Group 4 — sheet with NO idField configured falls back to the
  // original unconditional-append behavior, completely unchanged.
  // ================================================================
  {
    const headers = ['col_a', 'col_b'];
    const sheet = makeFakeSheet(headers, []);
    const ctx = loadGasContext({ 'شيت_غير_معروف': sheet });

    ctx.apiAddRow('شيت_غير_معروف', { col_a: 'x', col_b: 'y' });
    ctx.apiAddRow('شيت_غير_معروف', { col_a: 'x', col_b: 'y' });

    check('a sheet with no idField in SHEET_DEFS keeps the exact prior unconditional-append behavior (2 identical adds -> 2 rows)', () => {
      assert.strictEqual(sheet._grid.length, 3, 'expected 2 data rows — unknown-sheet behavior must stay untouched, matching apiUpdateRow\'s own documented fallback');
    });
  }

  console.log(log.join('\n'));
  console.log('\n' + passed + '/' + (passed + failed) + ' checks passed.');
  if (failed > 0) {
    console.log('\n' + failed + ' CHECK(S) FAILED.');
    process.exit(1);
  } else {
    console.log('\nALL CHECKS PASSED.');
    process.exit(0);
  }
}

main();
