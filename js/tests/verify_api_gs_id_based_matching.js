// =====================================================================
// verify_api_gs_id_based_matching.js
//
// FIX C1 (DATABASE_FORENSIC_REPORT.md §P6-C1, "الباك-إند يكتب/يحذف
// بالفهرس الرقمي البحت دون أي تحقق من الهوية") — sheet-level coverage.
//
// This test loads Config/00_Config.gs (for SHEET_DEFS/getSheetHeaders)
// and Config/06_Api.gs (for apiUpdateRow/apiDeleteRow/apiAddRow/
// _resolveIdFieldForSheet/_findRowByIdValue) into a single vm context,
// with a minimal in-memory mock of SpreadsheetApp's Sheet API (only the
// methods these functions actually call: getRange/getValues/setValues/
// getLastRow/getLastColumn/deleteRow/setNumberFormat/setBackground/
// setFontColor/setFontWeight/setHorizontalAlignment/setFrozenRows).
//
// This is the ONLY layer where the actual bug lived (a real Apps Script
// deployment writes/deletes by raw row number) — js/api/api.js and
// Repository.js already have their own dedicated test coverage for the
// frontend side of this same fix, but neither of those can exercise the
// real row-resolution logic that runs against the Sheet itself. This
// file closes that gap.
//
// Run: node js/tests/verify_api_gs_id_based_matching.js
// =====================================================================

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

let passed = 0, failed = 0;
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

// ---------------------------------------------------------------------
// Minimal in-memory Sheet mock — enough surface for apiAddRow/
// apiUpdateRow/apiDeleteRow/ensureSheetHeaders to run unmodified.
// Row 1 is always the header row; data starts at row 2 (1-based,
// matching real Google Sheets semantics exactly).
// ---------------------------------------------------------------------
function makeFakeSheet(headers, rows) {
  // grid[0] = headers, grid[1..] = data rows (each an array aligned to headers)
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
    deleteRow: function (row) {
      grid.splice(row - 1, 1);
    }
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
    // openSpreadsheet()/setupSheets() are defined in files NOT loaded here
    // (01_Database.gs pulls in SpreadsheetApp.openById/create + DriveApp,
    // far outside the scope of this test) — stubbed directly since
    // apiUpdateRow/apiDeleteRow/apiAddRow only ever call
    // openSpreadsheet().getSheetByName(sheetName), never anything else
    // on the returned object.
    openSpreadsheet: function () {
      return { getSheetByName: function (name) { return sheetsByName[name] || null; } };
    },
    setupSheets: function () {},
    isPhoneColumn: function () { return false; },
    addToCalendar: function () { calls.addToCalendar++; return 'evt-1'; },
    updateCalendarEvent: function (oldId) { calls.updateCalendarEvent++; return oldId || 'evt-1'; },
    deleteCalendarEvent: function () { calls.deleteCalendarEvent++; },
    // jsonResponse() itself lives in Config/08_Utils.gs (not loaded here
    // — depends on the real ContentService global). Stubbed with the
    // same externally-observable contract (.getContent() returns the
    // JSON string) so apiUpdateRow()/apiDeleteRow()/apiAddRow() run
    // completely unmodified and this test can still inspect the body.
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
  // Group 1 — apiUpdateRow(): id-based match takes priority over a
  // deliberately WRONG rowIndex.
  // ================================================================
  {
    const headers = ['رقم_القضية', 'عنوان_القضية', 'اسم_الموكل'];
    const sheet = makeFakeSheet(headers, [
      ['2026/1', 'قضية أولى', 'موكل أ'],
      ['2026/2', 'قضية ثانية', 'موكل ب'],
      ['2026/3', 'قضية ثالثة', 'موكل ج']
    ]);
    const ctx = loadGasContext({ 'القضايا': sheet });

    check('apiUpdateRow(): updates the CORRECT row by id even when rowIndex points at a completely different row', () => {
      // rowIndex says "row 0" (-> actualRow would be 1, the HEADER row,
      // if id-matching didn't take priority) but the id correctly
      // identifies case 2026/2 (real sheet row 3).
      const res = ctx.apiUpdateRow('القضايا', { 'رقم_القضية': '2026/2', 'عنوان_القضية': 'قضية ثانية محدّثة', 'اسم_الموكل': 'موكل ب' }, 0);
      const body = JSON.parse(res.getContent());
      assert.strictEqual(body.status, 'ok');
      assert.strictEqual(sheet._grid[0][0], 'رقم_القضية', 'header row (grid[0]) must be untouched');
      assert.strictEqual(sheet._grid[2][1], 'قضية ثانية محدّثة', 'row for 2026/2 (grid[2] = sheet row 3) must carry the update');
      assert.strictEqual(sheet._grid[1][1], 'قضية أولى', '2026/1 (grid[1]) must be completely unaffected');
      assert.strictEqual(sheet._grid[3][1], 'قضية ثالثة', '2026/3 (grid[3]) must be completely unaffected');
    });
  }

  // ================================================================
  // Group 2 — apiUpdateRow(): falls back to rowIndex only when no
  // idField is configured for the sheet at all.
  // ================================================================
  {
    const headers = ['col_a', 'col_b'];
    const sheet = makeFakeSheet(headers, [['r1a', 'r1b'], ['r2a', 'r2b']]);
    const ctx = loadGasContext({ 'شيت_غير_معروف': sheet });

    check('apiUpdateRow(): unknown sheet (no idField in SHEET_DEFS) falls back to legacy rowIndex behavior unchanged', () => {
      const res = ctx.apiUpdateRow('شيت_غير_معروف', { col_a: 'updated', col_b: 'r1b' }, 0);
      const body = JSON.parse(res.getContent());
      assert.strictEqual(body.status, 'ok');
      assert.strictEqual(sheet._grid[1][0], 'updated', 'rowIndex 0 -> sheet row 2 (grid[1]) must be written, exact prior behavior');
    });
  }

  // ================================================================
  // Group 3 — apiUpdateRow(): id configured but record missing from
  // sheet -> safe Upsert (never guesses via rowIndex).
  // ================================================================
  {
    const headers = ['رقم_القضية', 'عنوان_القضية'];
    const sheet = makeFakeSheet(headers, [['2026/1', 'قضية أولى']]);
    const ctx = loadGasContext({ 'القضايا': sheet });

    check('apiUpdateRow(): id configured, no matching row (e.g. post-restore) -> appends as new row instead of guessing rowIndex', () => {
      const beforeRows = sheet._grid.length;
      const res = ctx.apiUpdateRow('القضايا', { 'رقم_القضية': '2026/99', 'عنوان_القضية': 'قضية مستعادة' }, 0);
      const body = JSON.parse(res.getContent());
      assert.strictEqual(body.status, 'ok');
      assert.strictEqual(sheet._grid.length, beforeRows + 1, 'a new row must be appended, existing rows untouched in place');
      assert.strictEqual(sheet._grid[1][0], '2026/1', 'the pre-existing row 2026/1 must be completely unaffected');
      const appended = sheet._grid[sheet._grid.length - 1];
      assert.strictEqual(appended[0], '2026/99');
    });
  }

  // ================================================================
  // Group 4 — apiDeleteRow(): id-based match takes priority over a
  // deliberately WRONG rowIndex.
  // ================================================================
  {
    const headers = ['رقم_الخصم', 'الاسم'];
    const sheet = makeFakeSheet(headers, [
      ['OPP-1', 'خصم أول'],
      ['OPP-2', 'خصم ثاني'],
      ['OPP-3', 'خصم ثالث']
    ]);
    const ctx = loadGasContext({ 'الخصوم': sheet });

    check('apiDeleteRow(): deletes the CORRECT row by id even when rowIndex points at a completely different row', () => {
      // rowIndex says "row 0" -> would target the header row without id
      // matching; recordId correctly identifies OPP-2 (real sheet row 3).
      const res = ctx.apiDeleteRow('الخصوم', 0, 'OPP-2');
      const body = JSON.parse(res.getContent());
      assert.strictEqual(body.status, 'ok');
      assert.strictEqual(sheet._grid.length, 3, 'header + 2 remaining data rows');
      assert.strictEqual(sheet._grid[0][0], 'رقم_الخصم', 'header row must survive');
      assert.ok(sheet._grid.some(function (r) { return r[0] === 'OPP-1'; }), 'OPP-1 must survive');
      assert.ok(sheet._grid.some(function (r) { return r[0] === 'OPP-3'; }), 'OPP-3 must survive');
      assert.ok(!sheet._grid.some(function (r) { return r[0] === 'OPP-2'; }), 'OPP-2 must be gone');
    });
  }

  // ================================================================
  // Group 5 — apiDeleteRow(): id configured + supplied, no match found
  // -> safe no-op (never deletes a possibly-wrong row via rowIndex).
  // This is the exact scenario behind the original bug report symptom:
  // "بيانات أعمال المحضرين لا تُحذف بشكل صحيح... ثم تظهر مرة أخرى" —
  // a delete that raced with a stale index must never delete the wrong
  // (unrelated) row.
  // ================================================================
  {
    const headers = ['رقم_العمل', 'النوع'];
    const sheet = makeFakeSheet(headers, [
      ['PSW-1', 'إعلان'],
      ['PSW-2', 'تنفيذ']
    ]);
    const ctx = loadGasContext({ 'أعمال_المحضرين': sheet });

    check('apiDeleteRow(): id supplied but no match (already deleted / never synced) -> no row is deleted, not even via a stale rowIndex', () => {
      const beforeRows = sheet._grid.length;
      const res = ctx.apiDeleteRow('أعمال_المحضرين', 0, 'PSW-DOES-NOT-EXIST');
      const body = JSON.parse(res.getContent());
      assert.strictEqual(body.status, 'ok', 'must report ok — the desired end state (record absent) is already true');
      assert.strictEqual(sheet._grid.length, beforeRows, 'no row may be removed, including the header row that rowIndex=0 would otherwise target');
      assert.ok(sheet._grid.some(function (r) { return r[0] === 'PSW-1'; }));
      assert.ok(sheet._grid.some(function (r) { return r[0] === 'PSW-2'; }));
    });
  }

  // ================================================================
  // Group 6 — apiDeleteRow(): no recordId supplied at all (older
  // frontend cache, or a call site not yet updated) -> exact legacy
  // rowIndex behavior, fully backward compatible.
  // ================================================================
  {
    const headers = ['رقم_الجلسة', 'التاريخ'];
    const sheet = makeFakeSheet(headers, [['S-1', '2026-01-01'], ['S-2', '2026-01-02']]);
    const ctx = loadGasContext({ 'الجلسات': sheet });

    check('apiDeleteRow(): no recordId at all -> falls back to legacy rowIndex-only deletion, unchanged', () => {
      const res = ctx.apiDeleteRow('الجلسات', 0 /* -> sheet row 2, grid[1] */, undefined);
      const body = JSON.parse(res.getContent());
      assert.strictEqual(body.status, 'ok');
      assert.strictEqual(sheet._grid.length, 2, 'header + 1 remaining row');
      assert.strictEqual(sheet._grid[1][0], 'S-2', 'S-1 (rowIndex 0 -> sheet row 2) was removed, S-2 remains');
    });
  }

  // ================================================================
  // Group 7 — _findRowByIdValue(): whitespace/format-tolerant matching,
  // and correctly reports -1 (not a crash) for an empty sheet.
  // ================================================================
  {
    const headers = ['رقم_القضية', 'عنوان_القضية'];
    const sheet = makeFakeSheet(headers, [[' 2026/5 ', 'قضية بمسافات']]);
    const ctx = loadGasContext({});

    check('_findRowByIdValue(): trims whitespace on both sides of the comparison', () => {
      const row = ctx._findRowByIdValue(sheet, headers, 'رقم_القضية', '2026/5');
      assert.strictEqual(row, 2);
    });

    check('_findRowByIdValue(): empty sheet (header only) returns -1, not a crash', () => {
      const emptySheet = makeFakeSheet(headers, []);
      const row = ctx._findRowByIdValue(emptySheet, headers, 'رقم_القضية', '2026/5');
      assert.strictEqual(row, -1);
    });

    check('_findRowByIdValue(): unconfigured idField (null) returns -1 immediately, no lookup attempted', () => {
      const row = ctx._findRowByIdValue(sheet, headers, null, '2026/5');
      assert.strictEqual(row, -1);
    });
  }

  // ================================================================
  // Group 8 — _resolveIdFieldForSheet(): matches the real SHEET_DEFS
  // table, not a parallel/duplicated list.
  // ================================================================
  {
    const ctx = loadGasContext({});
    check('_resolveIdFieldForSheet(): returns the exact idField from SHEET_DEFS for a known sheet', () => {
      assert.strictEqual(ctx._resolveIdFieldForSheet('القضايا'), 'رقم_القضية');
      assert.strictEqual(ctx._resolveIdFieldForSheet('الموكلين'), 'رقم_الموكل');
      assert.strictEqual(ctx._resolveIdFieldForSheet('أعمال_المحضرين'), 'رقم_العمل');
    });
    check('_resolveIdFieldForSheet(): returns null for an unknown sheet name (safe default, no crash)', () => {
      assert.strictEqual(ctx._resolveIdFieldForSheet('لا يوجد شيت بهذا الاسم'), null);
    });
  }

  // ================================================================
  // Group 9 — sessions calendar-event hook still fires exactly once,
  // on the id-resolved row, not a stale rowIndex row (regression guard
  // for the sheetName === 'الجلسات' special case inside apiUpdateRow/
  // apiDeleteRow, which this refactor touched directly).
  // ================================================================
  {
    const headers = ['رقم_الجلسة', 'التاريخ', 'calendar_event_id'];
    const sheet = makeFakeSheet(headers, [
      ['S-1', '2026-01-01', 'evt-old-1'],
      ['S-2', '2026-01-02', 'evt-old-2']
    ]);
    const ctx = loadGasContext({ 'الجلسات': sheet });

    check('apiUpdateRow(): "الجلسات" calendar hook still fires exactly once on the id-resolved row', () => {
      ctx.apiUpdateRow('الجلسات', { 'رقم_الجلسة': 'S-2', 'التاريخ': '2026-01-03' }, 0 /* would be S-1 by index */);
      assert.strictEqual(ctx.__calls.updateCalendarEvent, 1);
      assert.strictEqual(sheet._grid[2][1], '2026-01-03', 'S-2 (grid[2]) got the date update, not S-1 (grid[1])');
      assert.strictEqual(sheet._grid[1][1], '2026-01-01', 'S-1 untouched');
    });
  }

  console.log(log.join('\n'));
  console.log('\n' + passed + ' passed, ' + failed + ' failed.');
  process.exit(failed > 0 ? 1 : 0);
}

main();
