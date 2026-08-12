/**
 * verify_large_dataset_baseline.js
 * ================================================================
 * PHASE 13 — SUB-PHASE 13.0 — Performance Baseline Audit (Large Data Readiness)
 * ================================================================
 * Standalone Node harness (`node js/tests/verify_large_dataset_baseline.js`,
 * no browser required for this file — the browser-side measurements this
 * file's numbers are cross-checked against were taken separately, this
 * session, via a real headless Chromium instance driving the actual
 * `index.html` over a local HTTP server; see
 * `docs/Large_Data_Performance_Audit.md` §2 for that methodology and raw
 * results). This harness exercises the REAL `Repository`/`CasesRepository`
 * classes (unmodified, loaded directly) against an in-memory fake storage
 * engine, at record counts of 100 / 500 / 1,000 / 5,000 / 10,000 / 25,000 /
 * 50,000, and prints real wall-clock timings for every operation
 * PHASE 13.0's brief calls for.
 *
 * MEASUREMENT-ONLY: no production file is read for modification, none is
 * modified. This file and the three docs it accompanies
 * (`Large_Data_Performance_Audit.md`, `Large_Data_Bottlenecks.md`,
 * `Phase13_0_Verification_Report.md`) are the only files this phase creates.
 *
 * IMPORTANT — Node fake storage vs. real browser localStorage:
 * The fake storage engine below (`makeFakeStorage`, same shape every
 * existing verify_*.js harness in this project already uses) is a plain
 * JS object — it has NO size ceiling. It is correct for timing
 * Repository/JSON-layer CPU cost (parse/stringify/persist/index lookups),
 * but it CANNOT reproduce or detect the real browser's localStorage quota
 * (a storage-engine limit, not a Repository-layer one). That quota was
 * measured separately, live, in headless Chromium this session by binary
 * search directly against `localStorage.setItem()`: the browser rejects
 * `cases` once the serialized JSON string exceeds exactly 5,242,880 UTF-16
 * code units (5 MiB of string length == the standard 10 MiB Chromium
 * per-origin localStorage cap, at 2 bytes/UTF-16 unit). With this
 * project's actual ~23-field Arabic case-record shape, that boundary fell
 * at 6,937 records (last confirmed-OK) / 6,968 (first confirmed-FAIL) —
 * see `Large_Data_Performance_Audit.md` §3 for the full bisection log.
 * This harness's own §7 reproduces that arithmetic (record-size × N vs.
 * the 5,242,880-char constant) so the same conclusion is derivable from a
 * plain `node` run, without needing a browser on hand, while being
 * explicit that the constant itself is an empirical browser measurement,
 * not something Node can independently verify.
 * ================================================================
 */

'use strict';

const path = require('path');

const CORE_DIR = path.join(__dirname, '..', 'core');
const REPO_DIR = path.join(__dirname, '..', 'repositories');
const { CasesRepository } = require(path.join(REPO_DIR, 'CasesRepository.js'));

const SIZES = [100, 500, 1000, 5000, 10000, 25000, 50000];

// Empirically measured this session, live, in headless Chromium — see file
// header. Not derived or assumed; a real binary-search result.
const BROWSER_LOCALSTORAGE_CHAR_LIMIT = 5242880; // 5 MiB of UTF-16 chars (~10 MiB storage)

function makeFakeStorage(seed) {
  const store = Object.assign({}, seed || {});
  return {
    getItem: function (k) { return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; },
    setItem: function (k, v) { store[k] = String(v); },
    removeItem: function (k) { delete store[k]; },
    _dump: function () { return store; }
  };
}

function makeCase(i) {
  return {
    'رقم_القضية': 'C-' + String(i).padStart(6, '0'),
    'رقم_الدعوى': String(1000 + i),
    'نوع_الدعوى': ['نفقة', 'حضانة', 'طلاق', 'رؤية'][i % 4],
    'المحكمة': 'محكمة الأسرة ' + (i % 20),
    'عنوان_القضية': 'قضية رقم ' + i + ' لسنة 2026',
    'نوع_الموكل': i % 2 === 0 ? 'مدعي' : 'مدعى عليه',
    'اسم_الموكل': 'الموكل رقم ' + i,
    'رقم_قومي_الموكل': '2900101012345' + (i % 10),
    'هاتف_الموكل': '0100' + String(1000000 + i).slice(0, 7),
    'عنوان_الموكل': 'شارع رقم ' + (i % 100) + '، القاهرة',
    'عمل_الموكل': 'موظف',
    'جهة_عمل_الموكل': 'شركة رقم ' + (i % 50),
    'اسم_الخصم': 'الخصم رقم ' + i,
    'رقم_قومي_الخصم': '2850101012345' + (i % 10),
    'هاتف_الخصم': '0111' + String(1000000 + i).slice(0, 7),
    'عنوان_الخصم': 'شارع آخر رقم ' + (i % 100),
    'عمل_الخصم': 'حر',
    'جهة_عمل_الخصم': '',
    'الحالة': ['منظورة', 'محكوم فيها', 'مؤجلة'][i % 3],
    'تاريخ_القيد': '2026-06-15',
    'تاريخ_الجلسة_القادمة': '2026-06-28',
    'أتعاب_المحاماة': String(5000 + (i % 50) * 100),
    'الملاحظات': 'ملاحظات تجريبية لقضية رقم ' + i
  };
}

function ms(hrtimeDelta) {
  return hrtimeDelta[0] * 1000 + hrtimeDelta[1] / 1e6;
}

async function timeAsync(fn) {
  const t0 = process.hrtime();
  const r = await fn();
  const t1 = process.hrtime(t0);
  return { ms: ms(t1), r };
}

function timeSync(fn) {
  const t0 = process.hrtime();
  const r = fn();
  const t1 = process.hrtime(t0);
  return { ms: ms(t1), r };
}

async function benchAtSize(n) {
  const storage = makeFakeStorage();
  const repo = new CasesRepository({ storageAdapter: {
    read: function (key) {
      const raw = storage.getItem(key);
      return Promise.resolve(raw ? JSON.parse(raw) : []);
    },
    write: function (key, records) {
      storage.setItem(key, JSON.stringify(records));
      return Promise.resolve();
    }
  }});

  await repo.open();
  const seed = [];
  for (let i = 0; i < n; i++) seed.push(makeCase(i));
  const bulk = await repo.bulkInsert(seed);
  if (bulk.some(r => !r.success)) throw new Error('seed bulkInsert had failures at n=' + n);

  const midId = 'C-' + String(Math.floor(n / 2)).padStart(6, '0');
  const out = { n: n };

  out.get = timeSync(() => repo.get(midId)).ms;
  out.exists = timeSync(() => repo.exists(midId)).ms;
  out.getAll = timeSync(() => repo.getAll()).ms;
  out.count_noFilter = timeSync(() => repo.count()).ms;
  out.count_filter = timeSync(() => repo.count({ filter: { 'الحالة': 'منظورة' } })).ms;
  out.search_term = timeSync(() => repo.search({ search: 'قضية رقم 5' })).ms;
  out.search_filter = timeSync(() => repo.search({ filter: { 'نوع_الدعوى': 'نفقة' } })).ms;
  out.search_sort = timeSync(() => repo.search({ sort: [{ field: 'رقم_القضية', direction: 'desc' }] })).ms;
  out.find = timeSync(() => repo.find({ 'رقم_القضية': midId })).ms;

  const allRecords = repo.getAll();
  const jsonStr = JSON.stringify(allRecords);
  out.json_stringify = timeSync(() => JSON.stringify(allRecords)).ms;
  out.json_parse = timeSync(() => JSON.parse(jsonStr)).ms;
  out.recordCharsApprox = jsonStr.length / allRecords.length;
  out.totalChars = jsonStr.length;

  out.array_filter = timeSync(() => allRecords.filter(r => r['نوع_الدعوى'] === 'نفقة')).ms;
  out.array_map = timeSync(() => allRecords.map(r => r['رقم_القضية'])).ms;
  out.array_find = timeSync(() => allRecords.find(r => r['رقم_القضية'] === midId)).ms;
  out.array_sort = timeSync(() => allRecords.slice().sort((a, b) => a['رقم_القضية'] < b['رقم_القضية'] ? -1 : 1)).ms;
  out.array_reduce = timeSync(() => allRecords.reduce((acc) => acc + 1, 0)).ms;

  out.create = (await timeAsync(() => repo.create(makeCase(n + 1)))).ms;
  out.update = (await timeAsync(() => repo.update(midId, { 'الملاحظات': 'x' }))).ms;
  const tmpId = 'TMP-' + n;
  await repo.create(Object.assign(makeCase(n + 2), { 'رقم_القضية': tmpId }));
  out.delete = (await timeAsync(() => repo.delete(tmpId))).ms;
  out.restore = (await timeAsync(() => repo.restore(tmpId))).ms;

  const m = Math.max(1, Math.min(200, Math.floor(n / 10) || 1));
  const bulkInsertItems = [];
  for (let i = 0; i < m; i++) bulkInsertItems.push(Object.assign(makeCase(n + 100 + i), { 'رقم_القضية': 'BI-' + n + '-' + i }));
  out.bulkInsert_m = m;
  out.bulkInsert = (await timeAsync(() => repo.bulkInsert(bulkInsertItems))).ms;

  const idsToTouch = repo.getAll().slice(0, m).map(r => r['رقم_القضية']);
  out.bulkUpdate = (await timeAsync(() => repo.bulkUpdate(idsToTouch.map(id => ({ id: id, patch: { 'الملاحظات': 'bulk' } }))))).ms;
  out.bulkDelete = (await timeAsync(() => repo.bulkDelete(idsToTouch))).ms;

  out.transaction_m = Math.min(20, m);
  const txOps = idsToTouch.slice(0, out.transaction_m).map(id => ({ op: 'restore', id: id }));
  out.transaction = (await timeAsync(() => repo.transaction(txOps))).ms;

  return out;
}

function fmt(v) { return typeof v === 'number' ? v.toFixed(2) : String(v); }

async function main() {
  console.log('PHASE 13.0 — Large Dataset Performance Baseline (real Repository/CasesRepository, Node fake storage)');
  console.log('='.repeat(100));
  const allResults = [];
  for (const n of SIZES) {
    try {
      const r = await benchAtSize(n);
      allResults.push(r);
      console.log('\n--- n=' + n + ' ---');
      Object.keys(r).forEach(function (k) { console.log('  ' + k + ': ' + fmt(r[k])); });
    } catch (e) {
      console.log('\n--- n=' + n + ' -- ERROR: ' + e.message + ' ---');
      allResults.push({ n: n, error: e.message });
    }
  }

  console.log('\n' + '='.repeat(100));
  console.log('§7 — Real browser localStorage quota arithmetic (constant measured live this session)');
  console.log('Chromium per-origin localStorage char limit (measured): ' + BROWSER_LOCALSTORAGE_CHAR_LIMIT + ' chars (~10 MiB)');
  allResults.filter(r => !r.error).forEach(function (r) {
    const capacity = Math.floor(BROWSER_LOCALSTORAGE_CHAR_LIMIT / r.recordCharsApprox);
    console.log('  at n=' + r.n + ': ~' + r.recordCharsApprox.toFixed(0) + ' chars/record -> ' +
      'max records the "cases" key alone could hold before quota failure ≈ ' + capacity);
  });

  console.log('\nDone. Full narrative interpretation: docs/Large_Data_Performance_Audit.md');
}

main().catch(function (e) { console.error('HARNESS FAILURE:', e); process.exitCode = 1; });
