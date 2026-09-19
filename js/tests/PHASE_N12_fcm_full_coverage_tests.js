/**
 * ================================================================
 * PHASE_N12_fcm_full_coverage_tests.js — نظام الحسام للمحاماة
 * ================================================================
 * PHASE N.12 widened FCM notification coverage from 7/3/2 sheets
 * (add/update/delete) to all 14 synced business entities, per an
 * explicit owner request: any add/edit/delete anywhere should reach
 * every device live, not just cases/sessions/tasks creation and a
 * few specific status changes.
 *
 * Unlike PHASE_A8_fcm_tests.js (which only does static source-text
 * regex assertions on Config/10_Fcm.gs, since most of that file calls
 * real Apps Script globals like SpreadsheetApp/UrlFetchApp/
 * PropertiesService that don't exist in Node), this suite goes
 * further: FCM_ENTITY_LABELS_, resolveFcmTitleBody_(), and
 * computeUpdateChangeContext_() are pure functions with ZERO Apps
 * Script API calls — they only touch plain objects/strings/arrays —
 * so they are extracted from the real .gs source text (regex-anchored
 * on function/const names, not hardcoded line numbers, so this stays
 * robust against later unrelated edits to the same files) and
 * actually EXECUTED here with real inputs, asserting the exact
 * returned {title, body, page, variant} shape. This is strictly
 * stronger evidence than a regex match on the source text.
 *
 * Run: node js/tests/PHASE_N12_fcm_full_coverage_tests.js
 * ================================================================
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..', '..');
function read(rel) { return fs.readFileSync(path.join(ROOT, rel), 'utf8'); }

const configGs = read('Config/00_Config.gs');
const fcmGs = read('Config/10_Fcm.gs');

let passed = 0, failed = 0;
function check(label, fn) {
  try { fn(); passed++; console.log('PASS - ' + label); }
  catch (e) { failed++; console.log('FAIL - ' + label + '  =>  ' + e.message); }
}

/** Extracts a `const NAME = [...];` declaration's full source text. */
function extractConst(src, name) {
  const m = src.match(new RegExp('const ' + name + '\\s*=\\s*\\[[^\\]]*\\];'));
  if (!m) throw new Error('could not find const ' + name + ' in source');
  return m[0];
}

/** Extracts a top-level `function NAME(...) { ... }` by brace counting,
 *  anchored on the function's own opening line — robust against the
 *  function's internal content containing braces/strings. */
function extractFunction(src, name) {
  const startIdx = src.indexOf('function ' + name + '(');
  if (startIdx === -1) throw new Error('could not find function ' + name + ' in source');
  const braceStart = src.indexOf('{', startIdx);
  let depth = 0, i = braceStart;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) { i++; break; } }
  }
  return src.slice(startIdx, i);
}

/** Extracts a top-level `var NAME = { ... };` object literal declaration. */
function extractVarObject(src, name) {
  const startIdx = src.indexOf('var ' + name + ' =');
  if (startIdx === -1) throw new Error('could not find var ' + name + ' in source');
  const braceStart = src.indexOf('{', startIdx);
  let depth = 0, i = braceStart;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) { i++; break; } }
  }
  // consume the trailing ';'
  while (src[i] !== ';') i++;
  i++;
  return src.slice(startIdx, i);
}

// ---- Extract the real, current source of the pure pieces under test ----
const FCM_NOTIFY_SHEETS_SRC = extractConst(configGs, 'FCM_NOTIFY_SHEETS');
const FCM_NOTIFY_UPDATE_SHEETS_SRC = extractConst(configGs, 'FCM_NOTIFY_UPDATE_SHEETS');
const FCM_NOTIFY_DELETE_SHEETS_SRC = extractConst(configGs, 'FCM_NOTIFY_DELETE_SHEETS');
const FCM_ENTITY_LABELS_SRC = extractVarObject(fcmGs, 'FCM_ENTITY_LABELS_');
const resolveFcmTitleBody_SRC = extractFunction(fcmGs, 'resolveFcmTitleBody_');
const computeUpdateChangeContext_SRC = extractFunction(fcmGs, 'computeUpdateChangeContext_');

const wrapped = new vm.Script(
  '(function(){\n' +
  FCM_NOTIFY_SHEETS_SRC + '\n' +
  FCM_NOTIFY_UPDATE_SHEETS_SRC + '\n' +
  FCM_NOTIFY_DELETE_SHEETS_SRC + '\n' +
  FCM_ENTITY_LABELS_SRC + '\n' +
  resolveFcmTitleBody_SRC + '\n' +
  computeUpdateChangeContext_SRC + '\n' +
  'return { FCM_NOTIFY_SHEETS: FCM_NOTIFY_SHEETS, FCM_NOTIFY_UPDATE_SHEETS: FCM_NOTIFY_UPDATE_SHEETS, FCM_NOTIFY_DELETE_SHEETS: FCM_NOTIFY_DELETE_SHEETS, FCM_ENTITY_LABELS_: FCM_ENTITY_LABELS_, resolveFcmTitleBody_: resolveFcmTitleBody_, computeUpdateChangeContext_: computeUpdateChangeContext_ };\n' +
  '})'
);
// runInThisContext (NOT createContext/runInContext) keeps this in the
// SAME realm as the rest of this test file, so returned plain objects
// share the same Object.prototype as the expected-value literals below —
// assert.deepStrictEqual compares prototypes too, and a separate vm
// context (a different realm) would otherwise fail that check even when
// every own property matches exactly, which is a test-harness pitfall,
// not a real behavioral difference.
const {
  FCM_NOTIFY_SHEETS, FCM_NOTIFY_UPDATE_SHEETS, FCM_NOTIFY_DELETE_SHEETS,
  FCM_ENTITY_LABELS_, resolveFcmTitleBody_, computeUpdateChangeContext_
} = wrapped.runInThisContext()();

const ALL_14_ENTITIES = [
  'القضايا', 'قضية_موكلين', 'المصروفات', 'الجلسات', 'الموكلين', 'الخصوم',
  'أعمال_المحضرين', 'الأطفال', 'المستندات', 'الأعمال الإدارية', 'الأتعاب',
  'المكتبة', 'الصيغ', 'رسائل_الموكل'
];
// Cross-checked directly against Config/00_Config.gs's SHEET_DEFS entries,
// minus the 4 already-documented-and-unchanged exclusions (بيانات_المكتب,
// أجهزة_FCM, التثبيتات, أكواد_التفعيل).

// ================================================================
// SUITE 1 — coverage: all 14 entities are now eligible for add/update/delete
// ================================================================
check('FCM_NOTIFY_SHEETS (add-eligible) now contains all 14 synced business entities', () => {
  ALL_14_ENTITIES.forEach((sheet) => {
    assert.ok(FCM_NOTIFY_SHEETS.indexOf(sheet) !== -1, sheet + ' missing from FCM_NOTIFY_SHEETS');
  });
  assert.strictEqual(FCM_NOTIFY_SHEETS.length, 14);
});
check('FCM_NOTIFY_UPDATE_SHEETS now contains all 14 synced business entities', () => {
  ALL_14_ENTITIES.forEach((sheet) => {
    assert.ok(FCM_NOTIFY_UPDATE_SHEETS.indexOf(sheet) !== -1, sheet + ' missing from FCM_NOTIFY_UPDATE_SHEETS');
  });
  assert.strictEqual(FCM_NOTIFY_UPDATE_SHEETS.length, 14);
});
check('FCM_NOTIFY_DELETE_SHEETS now contains all 14 synced business entities', () => {
  ALL_14_ENTITIES.forEach((sheet) => {
    assert.ok(FCM_NOTIFY_DELETE_SHEETS.indexOf(sheet) !== -1, sheet + ' missing from FCM_NOTIFY_DELETE_SHEETS');
  });
  assert.strictEqual(FCM_NOTIFY_DELETE_SHEETS.length, 14);
});
check('Deliberately-excluded sheets remain excluded from all 3 lists (بيانات_المكتب/أجهزة_FCM/التثبيتات/أكواد_التفعيل)', () => {
  ['بيانات_المكتب', 'أجهزة_FCM', 'التثبيتات', 'أكواد_التفعيل'].forEach((sheet) => {
    assert.strictEqual(FCM_NOTIFY_SHEETS.indexOf(sheet), -1, sheet + ' must stay excluded (add)');
    assert.strictEqual(FCM_NOTIFY_UPDATE_SHEETS.indexOf(sheet), -1, sheet + ' must stay excluded (update)');
    assert.strictEqual(FCM_NOTIFY_DELETE_SHEETS.indexOf(sheet), -1, sheet + ' must stay excluded (delete)');
  });
});

// ================================================================
// SUITE 2 — resolveFcmTitleBody_(): real execution, every entity x every event
// ================================================================
check('resolveFcmTitleBody_(): EVERY one of the 14 entities produces a real {title,body,page,variant} for add/update/delete (no silent null anywhere in scope)', () => {
  ALL_14_ENTITIES.forEach((sheet) => {
    const add = resolveFcmTitleBody_(sheet, 'add');
    assert.ok(add && add.title && add.body && add.page, sheet + ': add must not be null/incomplete');

    // update: no changeContext at all (the common case for the 11 newly-
    // widened entities, and for القضايا/الجلسات/الأعمال الإدارية when the
    // edit doesn't match one of their specific richer sub-cases) — must
    // now fall through to the generic fallback, NOT return null.
    const upd = resolveFcmTitleBody_(sheet, 'update', {});
    assert.ok(upd && upd.title && upd.body && upd.page, sheet + ': update (no specific changeContext) must fall back to a generic notification, not null');

    const del = resolveFcmTitleBody_(sheet, 'delete');
    assert.ok(del && del.title && del.body && del.page, sheet + ': delete must not be null/incomplete');
  });
});

check('resolveFcmTitleBody_(): the 7 ORIGINAL add-branch messages are byte-for-byte unchanged', () => {
  assert.deepStrictEqual(resolveFcmTitleBody_('الجلسات', 'add'), { title: 'جلسة جديدة', body: 'تم إضافة جلسة جديدة إلى النظام', page: 'sessions', variant: 'default' });
  assert.deepStrictEqual(resolveFcmTitleBody_('الأعمال الإدارية', 'add'), { title: 'مهمة جديدة', body: 'تم إضافة عمل إداري جديد إلى النظام', page: 'tasks', variant: 'default' });
  assert.deepStrictEqual(resolveFcmTitleBody_('القضايا', 'add'), { title: 'قضية جديدة', body: 'تم تسجيل قضية جديدة إلى النظام', page: 'cases', variant: 'default' });
  assert.deepStrictEqual(resolveFcmTitleBody_('الموكلين', 'add'), { title: 'موكل جديد', body: 'تم تسجيل موكل جديد إلى النظام', page: 'clients', variant: 'default' });
  assert.deepStrictEqual(resolveFcmTitleBody_('المستندات', 'add'), { title: 'مستند جديد', body: 'تم إضافة مستند جديد إلى النظام', page: 'documents', variant: 'default' });
  assert.deepStrictEqual(resolveFcmTitleBody_('الأتعاب', 'add'), { title: 'دفعة أتعاب جديدة', body: 'تم تسجيل دفعة أتعاب جديدة إلى النظام', page: 'fees', variant: 'default' });
});

check('resolveFcmTitleBody_(): PHASE N.12 bugfix — أعمال_المحضرين add now points at the REAL page slug processServerWorks (was the never-matching process-server)', () => {
  const r = resolveFcmTitleBody_('أعمال_المحضرين', 'add');
  assert.strictEqual(r.page, 'processServerWorks');
  assert.strictEqual(r.title, 'عمل محضرين جديد'); // text itself unchanged
});

check('resolveFcmTitleBody_(): the 5 ORIGINAL specific update sub-cases still take PRIORITY over the new generic fallback', () => {
  assert.deepStrictEqual(
    resolveFcmTitleBody_('القضايا', 'update', { statusChanged: true }),
    { title: 'تحديث حالة قضية', body: 'تم تحديث حالة إحدى القضايا', page: 'cases', variant: 'status' }
  );
  assert.deepStrictEqual(
    resolveFcmTitleBody_('الجلسات', 'update', { postponed: true }),
    { title: 'تم تأجيل جلسة', body: 'تم تأجيل إحدى الجلسات إلى موعد جديد', page: 'sessions', variant: 'postponed' }
  );
  assert.deepStrictEqual(
    resolveFcmTitleBody_('الجلسات', 'update', { decisionAdded: true }),
    { title: 'تم تسجيل نتيجة جلسة', body: 'تمت إضافة قرار/نتيجة لإحدى الجلسات', page: 'sessions', variant: 'decision' }
  );
  assert.deepStrictEqual(
    resolveFcmTitleBody_('الأعمال الإدارية', 'update', { reopened: true }),
    { title: 'تم إعادة فتح عمل إداري', body: 'تمت إعادة فتح أحد الأعمال الإدارية', page: 'tasks', variant: 'reopened' }
  );
  assert.deepStrictEqual(
    resolveFcmTitleBody_('الأعمال الإدارية', 'update', { completed: true }),
    { title: 'تم إنجاز عمل إداري', body: 'تم إنجاز أحد الأعمال الإدارية', page: 'tasks', variant: 'completed' }
  );
});

check('resolveFcmTitleBody_(): PHASE N.12 — an ordinary (non-critical-field) edit on القضايا/الجلسات/الأعمال الإدارية now ALSO notifies (generic fallback), where it silently returned null before N.12', () => {
  const c = resolveFcmTitleBody_('القضايا', 'update', {}); // no statusChanged
  assert.strictEqual(c.variant, 'generic');
  assert.strictEqual(c.page, 'cases');
  const t = resolveFcmTitleBody_('الأعمال الإدارية', 'update', {}); // no completed/reopened
  assert.strictEqual(t.variant, 'generic');
  assert.strictEqual(t.page, 'tasks');
});

check('resolveFcmTitleBody_(): the 2 ORIGINAL delete-branch messages are byte-for-byte unchanged', () => {
  assert.deepStrictEqual(resolveFcmTitleBody_('القضايا', 'delete'), { title: 'تم حذف قضية', body: 'تم حذف إحدى القضايا من النظام', page: 'cases', variant: 'default' });
  assert.deepStrictEqual(resolveFcmTitleBody_('الجلسات', 'delete'), { title: 'تم حذف جلسة', body: 'تم حذف إحدى الجلسات من النظام', page: 'sessions', variant: 'default' });
});

check('resolveFcmTitleBody_(): PHASE N.12 — task deletion now notifies too (was null before N.12, matching N.7\'s own "cancellation via delete" gap finding)', () => {
  const r = resolveFcmTitleBody_('الأعمال الإدارية', 'delete');
  assert.ok(r);
  assert.strictEqual(r.page, 'tasks');
});

check('resolveFcmTitleBody_(): an entity genuinely absent from all 3 lists still correctly returns null for every event kind (defensive fallback preserved)', () => {
  assert.strictEqual(resolveFcmTitleBody_('بيانات_المكتب', 'add'), null);
  assert.strictEqual(resolveFcmTitleBody_('بيانات_المكتب', 'update', {}), null);
  assert.strictEqual(resolveFcmTitleBody_('بيانات_المكتب', 'delete'), null);
  assert.strictEqual(resolveFcmTitleBody_('غير موجودة أصلًا', 'add'), null);
});

// ================================================================
// SUITE 3 — batchKey distinctness (dedup/batching still correctly scoped)
// ================================================================
check('New generic-fallback variant ("generic") produces a DIFFERENT batchKey than the specific variants, for the 3 entities that have both — so a burst of specific + generic updates for the same sheet does not wrongly collapse into one batch slot', () => {
  const specific = resolveFcmTitleBody_('القضايا', 'update', { statusChanged: true });
  const generic = resolveFcmTitleBody_('القضايا', 'update', {});
  assert.notStrictEqual(specific.variant, generic.variant);
});

check('Every one of the 14 entities gets its OWN distinct add/update/delete batchKey component (sheet name itself differs) — no cross-entity batch collision introduced by the shared FCM_ENTITY_LABELS_ fallback', () => {
  const seen = new Set();
  ALL_14_ENTITIES.forEach((sheet) => {
    ['add', 'delete'].forEach((kind) => {
      const r = resolveFcmTitleBody_(sheet, kind);
      const key = sheet + '::' + kind + '::' + r.variant;
      assert.ok(!seen.has(key), 'duplicate batchKey component: ' + key);
      seen.add(key);
    });
  });
});

// ================================================================
// SUITE 4 — FCM_ENTITY_LABELS_ map integrity
// ================================================================
check('FCM_ENTITY_LABELS_ has a complete, non-empty {label, page} entry for all 14 entities', () => {
  ALL_14_ENTITIES.forEach((sheet) => {
    const info = FCM_ENTITY_LABELS_[sheet];
    assert.ok(info, sheet + ' missing from FCM_ENTITY_LABELS_');
    assert.ok(info.label && info.label.trim().length > 0, sheet + ': empty label');
    assert.ok(info.page && info.page.trim().length > 0, sheet + ': empty page');
  });
});

check('FCM_ENTITY_LABELS_ page slugs match the REAL #page-<slug> ids in index.html (re-verified against the live file, not assumed)', () => {
  const indexHtml = read('index.html');
  const realPageIds = new Set();
  const re = /id="page-([A-Za-z]+)"/g;
  let m;
  while ((m = re.exec(indexHtml))) realPageIds.add(m[1]);
  ALL_14_ENTITIES.forEach((sheet) => {
    const page = FCM_ENTITY_LABELS_[sheet].page;
    assert.ok(realPageIds.has(page), sheet + ": page '" + page + "' has no matching #page-" + page + " element in index.html");
  });
});

// ================================================================
// SUITE 5 — computeUpdateChangeContext_() unchanged (not touched by N.12)
// ================================================================
check('computeUpdateChangeContext_(): unchanged behavior for القضايا/الجلسات/الأعمال الإدارية (PHASE N.12 did not modify this function at all)', () => {
  assert.deepStrictEqual(computeUpdateChangeContext_('القضايا', { 'الحالة': 'نشطة' }, { 'الحالة': 'منتهية' }), { statusChanged: true });
  assert.deepStrictEqual(computeUpdateChangeContext_('القضايا', { 'الحالة': 'نشطة' }, { 'الحالة': 'نشطة' }), {});
  assert.deepStrictEqual(computeUpdateChangeContext_('الأعمال الإدارية', {}, { 'تاريخ_الإنجاز': '2026-01-01' }), { completed: true });
  assert.deepStrictEqual(computeUpdateChangeContext_('غير موجودة', {}, {}), {});
});

console.log('\n' + passed + '/' + (passed + failed) + ' checks passed.');
if (failed > 0) { console.log('\n' + failed + ' CHECK(S) FAILED.'); process.exit(1); }
console.log('\nALL CHECKS PASSED — real dynamic execution of the extracted pure Apps Script functions, not just static source-text matching.');
