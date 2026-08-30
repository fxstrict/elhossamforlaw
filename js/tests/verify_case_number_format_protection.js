// =====================================================================
// verify_case_number_format_protection.js
//
// CASE_SAVE_CYCLE_FIX_2026 — B5 dedicated coverage. Loads the REAL
// Config/08_Utils.gs (for isCaseNumberColumn()/isPhoneColumn()/
// jsonResponse()) alongside Config/00_Config.gs and Config/06_Api.gs
// into one vm context — unlike verify_api_gs_id_based_matching.js
// (which stubs isCaseNumberColumn()/isPhoneColumn() away and uses a
// no-op setNumberFormat(), since that file's own focus is id-based row
// matching, not column formatting), this file uses a sheet mock that
// RECORDS every setNumberFormat() call so the exact column protected,
// and only that column, can be asserted directly.
//
// Run: node js/tests/verify_case_number_format_protection.js
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
// Same fake Sheet shape as verify_api_gs_id_based_matching.js, PLUS a
// `formatCalls` log (column-name is unknown to setNumberFormat() itself
// — GAS ranges are column-index based — so the mock records the
// (row, col) pair; each test below cross-references col against the
// `headers` array it already knows to name the column asserted on).
// ---------------------------------------------------------------------
function makeFakeSheet(headers, rows) {
  const grid = [headers.slice()].concat(rows.map(function (r) { return r.slice(); }));
  const formatCalls = [];
  return {
    _grid: grid,
    _formatCalls: formatCalls,
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
        setNumberFormat: function (fmt) {
          formatCalls.push({ row: row, col: col, format: fmt, header: headers[col - 1] });
          return this;
        },
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
  const utilsSrc  = fs.readFileSync(path.join(__dirname, '..', '..', 'Config', '08_Utils.gs'), 'utf8');
  const apiSrc    = fs.readFileSync(path.join(__dirname, '..', '..', 'Config', '06_Api.gs'), 'utf8');

  const sandbox = {
    console: console,
    PropertiesService: { getScriptProperties: function () { return { getProperty: function () { return null; }, setProperty: function () {} }; } },
    Logger: { log: function () {} },
    ContentService: {
      MimeType: { JSON: 'JSON' },
      createTextOutput: function (text) {
        return {
          _text: text,
          setMimeType: function () { return this; },
          getContent: function () { return text; }
        };
      }
    },
    openSpreadsheet: function () {
      return { getSheetByName: function (name) { return sheetsByName[name] || null; } };
    },
    setupSheets: function () {},
    addToCalendar: function () { return 'evt-1'; },
    updateCalendarEvent: function (oldId) { return oldId || 'evt-1'; },
    deleteCalendarEvent: function () {}
  };
  sandbox.global = sandbox;
  const context = vm.createContext(sandbox);
  // Order matters: 00_Config.gs (SHEET_DEFS), then 08_Utils.gs (the
  // REAL isCaseNumberColumn()/isPhoneColumn()/jsonResponse() this file
  // exists to cover), then 06_Api.gs (apiAddRow/apiUpdateRow, which
  // call the former two).
  vm.runInContext(configSrc, context, { filename: '00_Config.gs' });
  vm.runInContext(utilsSrc, context, { filename: '08_Utils.gs' });
  vm.runInContext(apiSrc, context, { filename: '06_Api.gs' });
  return context;
}

function main() {
  // ================================================================
  // Group 1 — isCaseNumberColumn() unit behavior (exact match only,
  // no false positives on similarly-named columns).
  // ================================================================
  {
    const ctx = loadGasContext({});

    check('isCaseNumberColumn(): matches the exact header "رقم_القضية"', () => {
      assert.strictEqual(ctx.isCaseNumberColumn('رقم_القضية'), true);
    });

    check('isCaseNumberColumn(): does NOT match "رقم_الدعوى" (a different, free-text field — must not be reformatted)', () => {
      assert.strictEqual(ctx.isCaseNumberColumn('رقم_الدعوى'), false);
    });

    check('isCaseNumberColumn(): does NOT match "رقم_الجلسة" (session id — different column, exact-match only, unlike isPhoneColumn\'s substring match)', () => {
      assert.strictEqual(ctx.isCaseNumberColumn('رقم_الجلسة'), false);
    });

    check('isCaseNumberColumn(): does NOT match "عنوان_القضية" (contains "القضية" as a substring, but is not the id column itself)', () => {
      assert.strictEqual(ctx.isCaseNumberColumn('عنوان_القضية'), false);
    });

    check('isCaseNumberColumn(): does NOT match undefined/empty input (no crash)', () => {
      assert.strictEqual(ctx.isCaseNumberColumn(undefined), false);
      assert.strictEqual(ctx.isCaseNumberColumn(''), false);
    });
  }

  // ================================================================
  // Group 2 — apiAddRow(): setNumberFormat('@') is applied to
  // رقم_القضية specifically, on the القضايا sheet, and to NO other
  // column (proves the fix is scoped, not a blanket format-everything
  // change).
  // ================================================================
  {
    const headers = ['رقم_القضية', 'عنوان_القضية', 'اسم_الموكل', 'هاتف_الموكل'];
    const sheet = makeFakeSheet(headers, []);
    const ctx = loadGasContext({ 'القضايا': sheet });

    ctx.apiAddRow('القضايا', { 'رقم_القضية': '2026/1234', 'عنوان_القضية': 'قضية', 'اسم_الموكل': 'موكل', 'هاتف_الموكل': '01000000000' });

    check('apiAddRow(): setNumberFormat(\'@\') was called on the رقم_القضية column', () => {
      const call = sheet._formatCalls.find(function (c) { return c.header === 'رقم_القضية'; });
      assert.ok(call, 'expected a setNumberFormat call on رقم_القضية; calls=' + JSON.stringify(sheet._formatCalls));
      assert.strictEqual(call.format, '@');
    });

    check('apiAddRow(): setNumberFormat(\'@\') was also called on هاتف_الموكل (pre-existing isPhoneColumn protection — proves B5 did not remove or interfere with it)', () => {
      const call = sheet._formatCalls.find(function (c) { return c.header === 'هاتف_الموكل'; });
      assert.ok(call, 'expected a setNumberFormat call on هاتف_الموكل; calls=' + JSON.stringify(sheet._formatCalls));
    });

    check('apiAddRow(): setNumberFormat() was NOT called on عنوان_القضية or اسم_الموكل (the fix is scoped to رقم_القضية + phone columns only, not the whole row)', () => {
      const untouched = sheet._formatCalls.filter(function (c) { return c.header === 'عنوان_القضية' || c.header === 'اسم_الموكل'; });
      assert.strictEqual(untouched.length, 0, 'unexpected format calls: ' + JSON.stringify(untouched));
    });
  }

  // ================================================================
  // Group 3 — apiUpdateRow(): same protection applies on update (not
  // just create) — this is the path a real duplicate-prevention retry
  // would go through.
  // ================================================================
  {
    const headers = ['رقم_القضية', 'عنوان_القضية'];
    const sheet = makeFakeSheet(headers, [['2026/1', 'قضية أولى']]);
    const ctx = loadGasContext({ 'القضايا': sheet });

    ctx.apiUpdateRow('القضايا', { 'رقم_القضية': '2026/1', 'عنوان_القضية': 'قضية أولى محدّثة' }, 0);

    check('apiUpdateRow(): setNumberFormat(\'@\') was called on رقم_القضية during an update, not only on create', () => {
      const call = sheet._formatCalls.find(function (c) { return c.header === 'رقم_القضية'; });
      assert.ok(call, 'expected a setNumberFormat call on رقم_القضية during update; calls=' + JSON.stringify(sheet._formatCalls));
      assert.strictEqual(call.format, '@');
    });
  }

  // ================================================================
  // Group 4 — the protection applies wherever رقم_القضية appears as a
  // foreign key (not just on the القضايا sheet itself) — e.g. الجلسات,
  // matching the B1 fix that just added it there.
  // ================================================================
  {
    const headers = ['رقم_الجلسة', 'رقم_القضية', 'التاريخ'];
    const sheet = makeFakeSheet(headers, []);
    const ctx = loadGasContext({ 'الجلسات': sheet });

    ctx.apiAddRow('الجلسات', { 'رقم_الجلسة': 'S-1', 'رقم_القضية': '2026/1234', 'التاريخ': '2026-09-10' });

    check('apiAddRow(): رقم_القضية protection also applies on the الجلسات sheet (foreign-key column, same name)', () => {
      const call = sheet._formatCalls.find(function (c) { return c.header === 'رقم_القضية'; });
      assert.ok(call, 'expected a setNumberFormat call on رقم_القضية in الجلسات; calls=' + JSON.stringify(sheet._formatCalls));
    });

    check('apiAddRow(): رقم_الجلسة (a DIFFERENT id column on the same sheet) was NOT touched', () => {
      const call = sheet._formatCalls.find(function (c) { return c.header === 'رقم_الجلسة'; });
      assert.strictEqual(call, undefined, 'رقم_الجلسة must not be reformatted; calls=' + JSON.stringify(sheet._formatCalls));
    });
  }

  console.log(log.join('\n'));
  console.log('\n' + passed + ' passed, ' + failed + ' failed.');
  if (failed > 0) process.exit(1);
}

main();
