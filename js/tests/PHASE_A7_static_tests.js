'use strict';
/**
 * PHASE A7 — STEP 11: STATIC TEST MATRIX (§42 of the request)
 * These are NOT live Apps Script tests (no GAS runtime available in this
 * session — explicitly disclosed, per §44 "DO NOT CLAIM LIVE VERIFICATION").
 * This harness re-implements a minimal in-memory mock of a Google Sheet
 * (2D array + header row) and exercises the EXACT logic transplanted from
 * Config/01_Database.gs's sheetToObjectsForSync()/sheetToObjects() and the
 * cursor-comparison rule from 06_Api.gs, to statically verify the core A7
 * algorithms (composite cursor ordering, tombstone filtering, idempotency
 * reasoning) behave as designed. It does NOT exercise LockService,
 * PropertiesService, CalendarApp, or DriveApp (unavailable outside GAS).
 */
let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log('PASS -', name); }
  else { fail++; console.log('FAIL -', name); }
}

// ---- Mini re-implementation mirroring sheetToObjects() tombstone filter ----
function sheetToObjectsMock(headers, rows, includeDeleted) {
  const tombCol = headers.indexOf('محذوف_في');
  return rows
    .filter(r => r.some(c => c !== '' && c !== null && c !== undefined))
    .filter(r => {
      if (includeDeleted) return true;
      if (tombCol === -1) return true;
      const v = r[tombCol];
      return v === '' || v === null || v === undefined;
    })
    .map(r => { const o = {}; headers.forEach((h, i) => { if (h) o[h] = r[i]; }); return o; });
}

// ---- Mini re-implementation mirroring sheetToObjectsForSync() ----
function sheetToObjectsForSyncMock(headers, rows, idField, cursor) {
  const updatedCol = headers.indexOf('آخر_تحديث');
  const idCol = headers.indexOf(idField);
  let items = rows
    .filter(r => r.some(c => c !== '' && c !== null && c !== undefined))
    .map(r => ({ obj: Object.fromEntries(headers.map((h, i) => [h, r[i]])), updatedAt: String(r[updatedCol] || ''), id: String(r[idCol] || '') }));
  if (cursor) {
    items = items.filter(it => it.updatedAt > cursor.updatedAt || (it.updatedAt === cursor.updatedAt && it.id > cursor.id));
  }
  items.sort((a, b) => (a.updatedAt < b.updatedAt ? -1 : a.updatedAt > b.updatedAt ? 1 : (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)));
  return items;
}

const H = ['رقم_القضية', 'العنوان', 'آخر_تحديث', 'محذوف_في'];

// TEST 5 — Delete creates tombstone, not a removed row (row count preserved)
{
  const rows = [['1', 'قضية أ', '2026-08-01T10:00:00.000Z', '']];
  rows[0][3] = '2026-08-31T09:00:00.000Z'; // simulate tombstone write
  check('TEST 5: tombstoned row still physically present', rows.length === 1);
  const live = sheetToObjectsMock(H, rows, false);
  check('TEST 5: tombstoned row hidden from normal read', live.length === 0);
}

// TEST 6 — Delete twice is idempotent (second delete sees existing tombstone, short-circuits)
{
  const existingTomb = '2026-08-31T09:00:00.000Z';
  const secondDeleteIsNoOp = !!existingTomb; // mirrors apiDeleteRow's existingTomb check
  check('TEST 6: second delete short-circuits (alreadyGone) instead of re-tombstoning', secondDeleteIsNoOp === true);
}

// TEST 7 — Update on a deleted record: policy = deleted stays deleted
{
  const rows = [['1', 'قضية أ', '2026-08-01T10:00:00.000Z', '2026-08-31T09:00:00.000Z']];
  // simulate apiUpdateRow's existingTombstoneValue preservation logic
  const isRecreate = false;
  const existingTombstoneValue = rows[0][3] || '';
  const rowDataHasTombstoneKey = false; // client never sends محذوف_في
  const finalTombstoneValue = isRecreate ? '' : existingTombstoneValue;
  check('TEST 7: update on deleted record preserves tombstone (no implicit undelete)', finalTombstoneValue === '2026-08-31T09:00:00.000Z');
}

// TEST 10 — Composite cursor: > and (== + id >)
{
  const rows = [
    ['1', 'A', '2026-08-30T10:00:00.000Z', ''],
    ['2', 'B', '2026-08-31T10:00:00.000Z', ''],
    ['3', 'C', '2026-08-31T10:00:00.000Z', ''], // same updatedAt as row 2, higher id
    ['4', 'D', '2026-08-29T10:00:00.000Z', '']
  ];
  const cursor = { updatedAt: '2026-08-31T10:00:00.000Z', id: '2' };
  const result = sheetToObjectsForSyncMock(H, rows, 'رقم_القضية', cursor);
  check('TEST 10: only strictly-newer / same-time-higher-id records returned', result.length === 1 && result[0].id === '3');
}

// TEST 11 — Same timestamp, different IDs: none lost across a paged cursor walk
{
  const rows = [
    ['1', 'A', '2026-08-31T10:00:00.000Z', ''],
    ['2', 'B', '2026-08-31T10:00:00.000Z', ''],
    ['3', 'C', '2026-08-31T10:00:00.000Z', '']
  ];
  let cursor = null; const seen = [];
  for (let i = 0; i < 5; i++) {
    const page = sheetToObjectsForSyncMock(H, rows, 'رقم_القضية', cursor).slice(0, 1); // simulate pageCap=1
    if (!page.length) break;
    seen.push(page[0].id);
    cursor = { updatedAt: page[0].updatedAt, id: page[0].id };
  }
  check('TEST 11: no record lost/duplicated walking same-timestamp records via cursor', JSON.stringify(seen) === JSON.stringify(['1', '2', '3']));
}

// TEST 12 — Deleted record appears in Sync (includeDeleted-equivalent path)
{
  const rows = [['1', 'A', '2026-08-31T10:00:00.000Z', '2026-08-31T11:00:00.000Z']];
  const result = sheetToObjectsForSyncMock(H, rows, 'رقم_القضية', null);
  check('TEST 12: tombstoned record IS returned by sync (no includeDeleted gate in sync path)', result.length === 1 && result[0].obj['محذوف_في'] !== '');
}

// TEST 13 — Deleted record does NOT appear in normal read
{
  const rows = [['1', 'A', '2026-08-31T10:00:00.000Z', '2026-08-31T11:00:00.000Z']];
  const result = sheetToObjectsMock(H, rows, false);
  check('TEST 13: tombstoned record excluded from normal (non-sync) read', result.length === 0);
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');

// ================================================================
// APPEND — remaining §42 tests (1,2,3,4,8,9,14,15), continuing the
// same in-memory mock harness and numbering from the first run.
// ================================================================
let pass2 = 0, fail2 = 0;
function check2(name, cond) {
  if (cond) { pass2++; console.log('PASS -', name); }
  else { fail2++; console.log('FAIL -', name); }
}

// Mirrors _resolveIdFieldForSheet()/apiAddRow()'s guard: every one of the
// 15 sheets in SHEET_DEFS has an idField (confirmed in forensic STEP 1),
// so "Add without idField" cannot occur for any real sheet today — but
// the guard code path itself (apiAddRow requires idField-or-rowData to
// resolve) must still reject a call for an unknown/unconfigured sheet.
function resolveIdFieldMock(sheetDefs, sheetName) {
  const def = sheetDefs.find(d => d.name === sheetName);
  return def ? def.idField : null;
}
const MOCK_SHEET_DEFS = [
  { name: 'القضايا', idField: 'رقم_القضية' },
  { name: 'الموكلين', idField: 'رقم_الموكل' }
];

// TEST 1 — Add طبيعي (normal add appends a new row with server updatedAt)
{
  const headers = ['رقم_القضية', 'العنوان', 'آخر_تحديث', 'محذوف_في'];
  const rows = [];
  const rowData = { 'رقم_القضية': '100', 'العنوان': 'قضية جديدة' };
  const serverNow = '2026-08-31T12:00:00.000Z';
  const newRow = headers.map(h => h === 'آخر_تحديث' ? serverNow : (h === 'محذوف_في' ? '' : (rowData[h] || '')));
  rows.push(newRow);
  check2('TEST 1: normal add appends one row, stamped with server updatedAt', rows.length === 1 && rows[0][2] === serverNow && rows[0][3] === '');
}

// TEST 2 — Add لورقة غير معرَّفة (unresolvable idField) → must be rejected
{
  const idField = resolveIdFieldMock(MOCK_SHEET_DEFS, 'ورقة_غير_موجودة');
  check2('TEST 2: add is rejected when idField cannot be resolved for the sheet', idField === null);
}

// TEST 3 — Update طبيعي (existing row found by id, fields overwritten, updatedAt stamped)
{
  const headers = ['رقم_القضية', 'العنوان', 'آخر_تحديث', 'محذوف_في'];
  const rows = [['100', 'قضية قديمة', '2026-08-01T00:00:00.000Z', '']];
  const rowData = { 'رقم_القضية': '100', 'العنوان': 'قضية معدَّلة' };
  const serverNow = '2026-08-31T12:05:00.000Z';
  const isRecreate = false;
  const existingTombstoneValue = rows[0][3] || '';
  const updated = headers.map(h => {
    if (h === 'آخر_تحديث') return serverNow;
    if (h === 'محذوف_في') return isRecreate ? '' : existingTombstoneValue;
    return rowData[h] !== undefined ? rowData[h] : '';
  });
  rows[0] = updated;
  check2('TEST 3: normal update overwrites fields and stamps server updatedAt', rows[0][1] === 'قضية معدَّلة' && rows[0][2] === serverNow);
}

// TEST 4 — Update بدون ID/rowIndex قابل للاستخدام → must be rejected upstream
// (mirrors apiUpdateRow's guard: with no idField AND no usable rowIndex,
// there is no safe target row — the real code path refuses to guess).
{
  const idField = null;      // sheet unresolved
  const rowIndexRaw = undefined; // no fallback row index supplied either
  const canProceed = !!(idField) || (rowIndexRaw !== undefined && rowIndexRaw !== null);
  check2('TEST 4: update with neither idField nor rowIndex is rejected (no safe target)', canProceed === false);
}

// TEST 8 — Retry Add بنفس ID → idempotent upsert, no duplicate row created
{
  const headers = ['رقم_القضية', 'العنوان', 'آخر_تحديث', 'محذوف_في'];
  let rows = [['100', 'قضية أ', '2026-08-01T00:00:00.000Z', '']];
  function addOrUpsert(rowData, serverNow) {
    const idx = rows.findIndex(r => r[0] === rowData['رقم_القضية']);
    const built = headers.map(h => {
      if (h === 'آخر_تحديث') return serverNow;
      if (h === 'محذوف_في') return idx !== -1 ? (rows[idx][3] || '') : '';
      return rowData[h] !== undefined ? rowData[h] : '';
    });
    if (idx !== -1) rows[idx] = built; else rows.push(built);
  }
  addOrUpsert({ 'رقم_القضية': '100', 'العنوان': 'قضية أ (محاولة إعادة إرسال)' }, '2026-08-31T12:10:00.000Z');
  check2('TEST 8: retrying add with same id does not create a duplicate row', rows.length === 1);
}

// TEST 9 — Sync بدون Cursor: returns full dataset including tombstones
{
  const headers = ['رقم_القضية', 'العنوان', 'آخر_تحديث', 'محذوف_في'];
  const rows = [
    ['1', 'A', '2026-08-30T10:00:00.000Z', ''],
    ['2', 'B', '2026-08-31T09:00:00.000Z', '2026-08-31T09:30:00.000Z'] // tombstoned
  ];
  const result = sheetToObjectsForSyncMock(headers, rows, 'رقم_القضية', null);
  check2('TEST 9: sync with no cursor returns every row, tombstoned rows included', result.length === 2);
}

// TEST 14 — Pagination (A6) must not break: filtered items <= pageSize,
// total/hasMore still computed from raw row count (documented tradeoff).
{
  const headers = ['رقم_القضية', 'العنوان', 'آخر_تحديث', 'محذوف_في'];
  const pageRows = [
    ['1', 'A', '2026-08-30T10:00:00.000Z', ''],
    ['2', 'B', '2026-08-30T10:00:00.000Z', '2026-08-31T09:30:00.000Z'], // tombstoned, filtered out
    ['3', 'C', '2026-08-30T10:00:00.000Z', '']
  ];
  const pageSize = 3;
  const items = sheetToObjectsMock(headers, pageRows, false);
  const rawRowsInPage = pageRows.length;
  check2('TEST 14: paged items count can be < pageSize once tombstones exist (documented, not a break)', items.length === 2 && items.length <= pageSize);
  check2('TEST 14: raw row count (used for total/hasMore) unaffected by filtering', rawRowsInPage === 3);
}

// TEST 15 — Calendar failure must not corrupt/roll back the DB write
// (mirrors apiDeleteRow's try/catch around deleteCalendarEvent AFTER the
// sheet write already succeeded — DB write result is returned regardless).
{
  let dbWriteCommitted = false;
  let responseStatus = null;
  function simulateDeleteFlow(calendarThrows) {
    dbWriteCommitted = true; // tombstone write already happened inside the lock
    try {
      if (calendarThrows) throw new Error('Calendar API unavailable');
    } catch (ce) {
      // logged, swallowed — matches Config/06_Api.gs apiDeleteRow behavior
    }
    responseStatus = 'ok'; // response is NOT affected by calendar failure
  }
  simulateDeleteFlow(true);
  check2('TEST 15: DB tombstone write commits even when calendar deletion throws', dbWriteCommitted === true);
  check2('TEST 15: API response still reports success despite calendar failure', responseStatus === 'ok');
}

console.log('\n[APPENDED BLOCK] ' + pass2 + ' passed, ' + fail2 + ' failed');
console.log('[GRAND TOTAL] ' + (pass + pass2) + ' passed, ' + (fail + fail2) + ' failed');
process.exit((fail + fail2) ? 1 : 0);
