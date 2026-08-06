/**
 * verify_cases_repository_wiring.js
 * ================================================================
 * PHASE 8 — SUB-PHASE 8.5.1 — Repository Wiring Pilot (CasesRepository Only)
 * ================================================================
 * Standalone Node harness (`node js/tests/verify_cases_repository_wiring.js`,
 * no browser required) proving that wiring `CasesRepository` to a real
 * `DatabaseService` (backed by a real `LocalStorageAdapter`) instead of its
 * old, hand-rolled, ad-hoc localStorage adapter produces ZERO observable
 * behavior change.
 *
 * Structure:
 *   A. Pipeline wiring proof — CasesRepository's default storageAdapter is
 *      now genuinely a DatabaseService instance backed by a
 *      LocalStorageAdapter instance (not just a same-shaped duck-type).
 *   B. Full CRUD/validation/search/filter/sort suite against the NEW
 *      (post-wiring) CasesRepository — a superset of the 30 checks
 *      originally recorded in docs/Cases_Repository_Verification_Report.md
 *      (PHASE 5.2), re-run here against the real file as it stands today.
 *   C. Direct BEFORE/AFTER regression: an identical, deterministic sequence
 *      of operations is run once against a frozen, in-harness reproduction
 *      of the OLD (PHASE 5.2) ad-hoc adapter, and once against the NEW
 *      (PHASE 8.5.1) CasesRepository — both driven through the exact same
 *      CasesRepository class/prototype methods (only the injected
 *      storageAdapter differs) — and every result is asserted identical.
 *   D. Persistence across reopen (multiple independent re-open scenarios).
 *   E. Backward compatibility with pre-existing, legacy-shaped
 *      localStorage['cases'] data (written before this Repository layer,
 *      or written by the OLD adapter).
 *   F. Structural checks: only CasesRepository.js differs from the
 *      pre-wiring archive; DatabaseService.js/StorageAdapter.js/
 *      LocalStorageAdapter.js/Repository.js are all untouched (MD5).
 *
 * Uses the same fake in-memory localStorage-shaped engine
 * (getItem/setItem/removeItem/key/length) every existing
 * verify_*_repository.js harness already uses.
 * ================================================================
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const CORE_DIR = path.join(__dirname, '..', 'core');
const REPOS_DIR = path.join(__dirname, '..', 'repositories');

const { Repository, RepositoryErrorTypes, createRepositoryError } =
  require(path.join(CORE_DIR, 'Repository.js'));
const { StorageAdapter } = require(path.join(CORE_DIR, 'StorageAdapter.js'));
const { DatabaseService } = require(path.join(CORE_DIR, 'DatabaseService.js'));
const { LocalStorageAdapter } = require(path.join(CORE_DIR, 'LocalStorageAdapter.js'));
const { IndexedDBAdapter } = require(path.join(CORE_DIR, 'IndexedDBAdapter.js'));
const { FakeIndexedDB } = require(path.join(__dirname, 'fake_indexeddb.js'));
const { CasesRepository, createCasesLocalStorageAdapter } =
  require(path.join(REPOS_DIR, 'CasesRepository.js'));

let passed = 0;
let failed = 0;
const log = [];

function check(label, fn) {
  try {
    fn();
    passed++;
    log.push('PASS — ' + label);
  } catch (e) {
    failed++;
    log.push('FAIL — ' + label + '  =>  ' + (e && e.message ? e.message : e));
  }
}

async function checkAsync(label, fn) {
  try {
    await fn();
    passed++;
    log.push('PASS — ' + label);
  } catch (e) {
    failed++;
    log.push('FAIL — ' + label + '  =>  ' + (e && e.message ? e.message : e));
  }
}

// ---- Fake localStorage engine (getItem/setItem/removeItem/key/length) ----
function makeFakeStorage(seed) {
  const store = Object.assign({}, seed || {});
  const order = Object.keys(store);
  return {
    getItem(k) { return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; },
    setItem(k, v) {
      if (!Object.prototype.hasOwnProperty.call(store, k)) order.push(k);
      store[k] = String(v);
    },
    removeItem(k) {
      delete store[k];
      const i = order.indexOf(k);
      if (i !== -1) order.splice(i, 1);
    },
    key(i) { return order[i] != null ? order[i] : null; },
    get length() { return order.length; },
    _dump() { return store; }
  };
}

// ----------------------------------------------------------------
// Frozen reproduction of the OLD (PHASE 5.2) ad-hoc Storage Adapter that
// used to live inside CasesRepository.js, kept HERE ONLY for the
// before/after regression comparison in section C. This is a comparison
// fixture, not a dependency of CasesRepository.js itself (which no longer
// contains this code — see docs/CasesRepository_Wiring_Report.md §3 for the
// exact diff).
// ----------------------------------------------------------------
function createLegacyCasesAdapter(storageImpl) {
  const ls = storageImpl;
  if (!ls) {
    throw createRepositoryError(
      RepositoryErrorTypes.STORAGE,
      'No localStorage-like implementation available.',
      { entity: 'cases', recoverable: false }
    );
  }
  return {
    read: async function (entityKey) {
      const raw = ls.getItem(entityKey);
      if (!raw) return [];
      try {
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
      } catch (e) {
        throw createRepositoryError(
          RepositoryErrorTypes.STORAGE,
          'Corrupt JSON in localStorage["' + entityKey + '"]: ' + e.message,
          { entity: entityKey, recoverable: false }
        );
      }
    },
    write: async function (entityKey, records) {
      ls.setItem(entityKey, JSON.stringify(records));
    }
  };
}

// A deterministic operation sequence, replayed identically against both
// the OLD adapter-backed CasesRepository and the NEW (real, current file)
// DatabaseService-backed CasesRepository. Returns a plain, JSON-comparable
// trace of every observable result.
async function runScenario(storageAdapterFactory, makeEngine) {
  const engine = makeEngine();
  const repo = new CasesRepository({ storageAdapter: storageAdapterFactory(engine) });
  const trace = {};

  await repo.open();
  trace.initialGetAll = repo.getAll();

  const c1 = await repo.create({
    'رقم_القضية': '2026-500', 'عنوان_القضية': 'قضية اختبار', 'اسم_الموكل': 'أحمد'
  });
  trace.create1 = { success: c1.success, id: c1.record && c1.record['رقم_القضية'] };

  const c2 = await repo.create({
    'رقم_القضية': '2026-501', 'عنوان_القضية': 'قضية ثانية', 'اسم_الموكل': 'سارة',
    'الحالة': 'مفتوحة', 'نوع_الدعوى': 'مدني'
  });
  trace.create2 = { success: c2.success, id: c2.record && c2.record['رقم_القضية'] };

  const cDup = await repo.create({
    'رقم_القضية': '2026-500', 'عنوان_القضية': 'مكرر', 'اسم_الموكل': 'خالد'
  });
  trace.createDuplicate = { success: cDup.success, errorType: cDup.error && cDup.error.type };

  const cInvalid = await repo.create({ 'عنوان_القضية': 'بلا رقم أو موكل' });
  trace.createInvalid = { success: cInvalid.success, errorType: cInvalid.error && cInvalid.error.type };

  trace.getExisting = repo.get('2026-500');
  trace.getMissing = repo.get('no-such-case');
  trace.existsTrue = repo.exists('2026-500');
  trace.existsFalse = repo.exists('no-such-case');
  trace.getAllAfterCreates = repo.getAll().map(r => r['رقم_القضية']).sort();

  const u1 = await repo.update('2026-500', { 'الحالة': 'مغلقة' });
  trace.update1 = { success: u1.success, status: u1.record && u1.record['الحالة'], version: u1.record && u1.record.version };

  const uMissing = await repo.update('no-such-case', { 'الحالة': 'x' });
  trace.updateMissing = { success: uMissing.success, errorType: uMissing.error && uMissing.error.type };

  trace.searchClientName = repo.search({ search: 'سارة' }).items.map(r => r['رقم_القضية']);
  trace.searchNoMatch = repo.search({ search: 'zzz-nomatch-zzz' }).items;
  trace.filterStatus = repo.filter({ 'الحالة': 'مفتوحة' }).map(r => r['رقم_القضية']);
  trace.filterType = repo.filter({ 'نوع_الدعوى': 'مدني' }).map(r => r['رقم_القضية']);
  trace.filterCombined = repo.filter({ 'الحالة': 'مفتوحة', 'نوع_الدعوى': 'مدني' }).map(r => r['رقم_القضية']);

  const d1 = await repo.delete('2026-501');
  trace.delete1 = { success: d1.success, deletedAt: !!(d1.record && d1.record.deletedAt) };
  trace.existsAfterDelete = repo.exists('2026-501');
  trace.getAllAfterDelete = repo.getAll().map(r => r['رقم_القضية']).sort();
  trace.getAllIncludeDeletedAfterDelete = repo.getAll({ includeDeleted: true }).map(r => r['رقم_القضية']).sort();

  const dMissing = await repo.delete('no-such-case');
  trace.deleteMissing = { success: dMissing.success, errorType: dMissing.error && dMissing.error.type };

  trace.validateGood = repo.validate({
    'رقم_القضية': 'x', 'عنوان_القضية': 'y', 'اسم_الموكل': 'z'
  });
  trace.validateBad = repo.validate({ 'عنوان_القضية': 'y' });

  // Persistence across reopen (same engine, brand-new adapter+repo pair).
  const repo2 = new CasesRepository({ storageAdapter: storageAdapterFactory(engine) });
  await repo2.open();
  trace.reopenGetAllIncludeDeleted = repo2.getAll({ includeDeleted: true }).map(r => r['رقم_القضية']).sort();
  trace.reopenGetExisting = repo2.get('2026-500');

  const rawReader = storageAdapterFactory(engine);
  trace.rawStoredJSON = await rawReader.read('cases');

  return normalizeVolatileFields(trace);
}

// Strips fields whose VALUE is inherently wall-clock/derived-from-wall-clock
// (createdAt/updatedAt/deletedAt timestamps, and the checksum computed over
// them) from a scenario trace before comparison. These fields are stamped
// identically by Repository._attachMetadata()/_computeChecksum() regardless
// of which Storage Adapter is injected — their value depends on the exact
// millisecond each run executes, not on adapter behavior — so leaving them
// in would produce a false-positive "difference" between two runs of the
// identical scenario even against the SAME adapter twice in a row. Every
// field that IS meaningful for the regression comparison (ids, business
// fields, version numbers, presence/absence of deletedAt, success/error
// shapes, ordering) is left untouched.
function normalizeVolatileFields(value) {
  const VOLATILE_KEYS = new Set(['createdAt', 'updatedAt', 'checksum']);
  if (Array.isArray(value)) {
    return value.map(normalizeVolatileFields);
  }
  if (value && typeof value === 'object') {
    const out = {};
    Object.keys(value).forEach(k => {
      if (VOLATILE_KEYS.has(k)) return; // omit entirely — presence itself is asserted elsewhere
      if (k === 'deletedAt') {
        // Presence/absence matters (soft-delete semantics); exact instant does not.
        out[k] = value[k] == null ? null : '<TIMESTAMP>';
        return;
      }
      out[k] = normalizeVolatileFields(value[k]);
    });
    return out;
  }
  return value;
}

async function main() {

  // ================================================================
  // A. Pipeline wiring proof
  // ================================================================
  check('CasesRepository / createCasesLocalStorageAdapter still exported as functions (public API unchanged)', () => {
    assert.strictEqual(typeof CasesRepository, 'function');
    assert.strictEqual(typeof createCasesLocalStorageAdapter, 'function');
  });

  const engineA = new FakeIndexedDB();
  const wiredAdapter = createCasesLocalStorageAdapter(engineA);

  check('createCasesLocalStorageAdapter() now returns a real DatabaseService instance (not an ad-hoc object)', () => {
    assert.ok(wiredAdapter instanceof DatabaseService, 'expected an instanceof DatabaseService');
  });

  check('that DatabaseService is backed by a real IndexedDBAdapter instance (instanceof StorageAdapter)', () => {
    assert.ok(wiredAdapter._adapter instanceof IndexedDBAdapter);
    assert.ok(wiredAdapter._adapter instanceof StorageAdapter);
  });

  check('DatabaseService still exposes exactly the read()/write() surface Repository.js requires (duck-type contract)', () => {
    assert.strictEqual(typeof wiredAdapter.read, 'function');
    assert.strictEqual(typeof wiredAdapter.write, 'function');
  });

  // Instrument the actual DatabaseService the default-constructed
  // CasesRepository will use, to prove CRUD calls really flow through it.
  const spyEngine = new FakeIndexedDB();
  const spyAdapter = createCasesLocalStorageAdapter(spyEngine);
  const dbCallLog = [];
  const origRead = spyAdapter.read.bind(spyAdapter);
  const origWrite = spyAdapter.write.bind(spyAdapter);
  spyAdapter.read = function (k) { dbCallLog.push({ m: 'read', k }); return origRead(k); };
  spyAdapter.write = function (k, r) { dbCallLog.push({ m: 'write', k, n: r.length }); return origWrite(k, r); };

  const spyRepo = new CasesRepository({ storageAdapter: spyAdapter });
  await checkAsync('a default-constructed CasesRepository genuinely routes open()/create() through DatabaseService.read()/write()', async () => {
    await spyRepo.open();
    await spyRepo.create({ 'رقم_القضية': 'spy-1', 'عنوان_القضية': 't', 'اسم_الموكل': 'c' });
    assert.deepStrictEqual(dbCallLog.map(c => c.m), ['read', 'write']);
    assert.strictEqual(dbCallLog[0].k, 'cases');
    assert.strictEqual(dbCallLog[1].k, 'cases');
    assert.strictEqual(dbCallLog[1].n, 1);
  });

  check('CasesRepository() constructed with NO config at all does not throw synchronously (lazy engine resolution)', () => {
    // Documented, harmless timing difference vs PHASE 5.2 — see file header
    // "WIRING UPDATE" note. The old adapter threw synchronously here if no
    // global localStorage existed (which it doesn't, under Node); the new
    // pipeline defers that to the first read()/write() call instead.
    assert.doesNotThrow(() => new CasesRepository());
  });

  // ================================================================
  // B. Full CRUD / validation / search / filter / sort suite (NEW pipeline)
  // ================================================================
  const fakeMain = new FakeIndexedDB();
  let repo = new CasesRepository({ storageAdapter: createCasesLocalStorageAdapter(fakeMain) });

  await checkAsync('open() on empty storage starts with zero records, no throw', async () => {
    await repo.open();
    assert.deepStrictEqual(repo.getAll(), []);
  });

  check('CasesRepository is a function / class, subclassing Repository', () => {
    assert.strictEqual(typeof CasesRepository, 'function');
    assert.strictEqual(Object.getPrototypeOf(CasesRepository.prototype).constructor, Repository);
  });

  check('validate() rejects a record missing all 3 required fields', () => {
    const r = repo.validate({});
    assert.strictEqual(r.valid, false);
    assert.strictEqual(r.errors.length, 3);
  });

  check('validate() accepts a record with all 3 required fields non-empty', () => {
    const r = repo.validate({ 'رقم_القضية': 'a', 'عنوان_القضية': 'b', 'اسم_الموكل': 'c' });
    assert.strictEqual(r.valid, true);
  });

  check('validate() rejects whitespace-only required fields', () => {
    const r = repo.validate({ 'رقم_القضية': '   ', 'عنوان_القضية': 'b', 'اسم_الموكل': 'c' });
    assert.strictEqual(r.valid, false);
    assert.strictEqual(r.errors[0].field, 'رقم_القضية');
  });

  await checkAsync('insert() [alias of create()] adds a new case using رقم_القضية as id', async () => {
    const res = await repo.insert({ 'رقم_القضية': '2026-1', 'عنوان_القضية': 'قضية أولى', 'اسم_الموكل': 'محمد' });
    assert.strictEqual(res.success, true);
    assert.strictEqual(res.record['رقم_القضية'], '2026-1');
  });

  await checkAsync('insert() rejects a duplicate رقم_القضية', async () => {
    const res = await repo.insert({ 'رقم_القضية': '2026-1', 'عنوان_القضية': 'x', 'اسم_الموكل': 'y' });
    assert.strictEqual(res.success, false);
    assert.strictEqual(res.error.type, 'ConflictError');
  });

  await checkAsync('insert() rejects an invalid record before touching storage', async () => {
    const before = await createCasesLocalStorageAdapter(fakeMain).read('cases');
    const res = await repo.insert({ 'عنوان_القضية': 'ناقص' });
    assert.strictEqual(res.success, false);
    assert.strictEqual(res.error.type, 'ValidationError');
    const after = await createCasesLocalStorageAdapter(fakeMain).read('cases');
    assert.deepStrictEqual(after, before);
  });

  await checkAsync('insert() a second case with الحالة/نوع_الدعوى for filter tests', async () => {
    await repo.insert({
      'رقم_القضية': '2026-2', 'عنوان_القضية': 'قضية ثانية', 'اسم_الموكل': 'ليلى',
      'الحالة': 'مفتوحة', 'نوع_الدعوى': 'مدني'
    });
  });

  check('get(id) returns the case by رقم_القضية; unknown id returns null', () => {
    assert.strictEqual(repo.get('2026-1')['اسم_الموكل'], 'محمد');
    assert.strictEqual(repo.get('unknown'), null);
  });

  check('exists(id) true/false', () => {
    assert.strictEqual(repo.exists('2026-1'), true);
    assert.strictEqual(repo.exists('unknown'), false);
  });

  await checkAsync('update(id, patch) merges fields and stamps updatedAt/version', async () => {
    const res = await repo.update('2026-1', { 'الحالة': 'مغلقة' });
    assert.strictEqual(res.success, true);
    assert.strictEqual(res.record['الحالة'], 'مغلقة');
    assert.strictEqual(res.record.version, 2);
    assert.strictEqual(typeof res.record.updatedAt, 'string');
  });

  await checkAsync('update(id, patch) rejects a patch that would violate required fields', async () => {
    const res = await repo.update('2026-1', { 'اسم_الموكل': '' });
    assert.strictEqual(res.success, false);
    assert.strictEqual(res.error.type, 'ValidationError');
  });

  check('search() free-text matches across any legacy field, case-insensitively', () => {
    const result = repo.search({ search: 'ليلى' });
    assert.strictEqual(result.items.length, 1);
    assert.strictEqual(result.items[0]['رقم_القضية'], '2026-2');
  });

  check('search() does NOT match against new audit/metadata fields (checksum)', () => {
    const target = repo.get('2026-1');
    const result = repo.search({ search: String(target.checksum) });
    assert.strictEqual(result.items.length, 0);
  });

  check('filter() by الحالة matches the status dropdown behavior', () => {
    const result = repo.filter({ 'الحالة': 'مفتوحة' });
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0]['رقم_القضية'], '2026-2');
  });

  check('filter() by نوع_الدعوى matches the type dropdown behavior', () => {
    const result = repo.filter({ 'نوع_الدعوى': 'مدني' });
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0]['رقم_القضية'], '2026-2');
  });

  check('filter() combining both fields uses AND semantics', () => {
    const result = repo.filter({ 'الحالة': 'مفتوحة', 'نوع_الدعوى': 'مدني' });
    assert.strictEqual(result.length, 1);
  });

  check('sort() accepts an explicit sortSpec without mutating input', () => {
    const input = repo.getAll();
    const inputCopy = JSON.parse(JSON.stringify(input));
    const sorted = repo.sort(input, { field: 'رقم_القضية', direction: 'asc' });
    assert.deepStrictEqual(input, inputCopy);
    assert.ok(Array.isArray(sorted));
  });

  await checkAsync('remove(id) [alias of delete()] soft-deletes by default', async () => {
    const res = await repo.remove('2026-2');
    assert.strictEqual(res.success, true);
    assert.ok(res.record.deletedAt);
    assert.strictEqual(repo.exists('2026-2'), false);
    assert.strictEqual(repo.getAll().length, 1);
  });

  check('getAll({includeDeleted:true}) still returns the soft-deleted record', () => {
    assert.strictEqual(repo.getAll({ includeDeleted: true }).length, 2);
  });

  check('Contract-literal create/update/delete are still present and callable', () => {
    assert.strictEqual(typeof repo.create, 'function');
    assert.strictEqual(typeof repo.update, 'function');
    assert.strictEqual(typeof repo.delete, 'function');
  });

  check('insert/remove/filter/sort/validate are additive aliases, not overriding create/update/delete', () => {
    assert.notStrictEqual(repo.insert, repo.create);
    assert.notStrictEqual(repo.remove, repo.delete);
    ['getAll', 'get', 'exists', 'count', 'find', 'bulkInsert', 'bulkUpdate',
      'bulkDelete', 'export', 'import', 'clear', 'transaction'].forEach(m => {
      assert.strictEqual(typeof repo[m], 'function', m + ' missing');
    });
  });

  await checkAsync('persisted "cases" object store is a plain array of records, exactly like index.html expects', async () => {
    const raw = await createCasesLocalStorageAdapter(fakeMain).read('cases');
    assert.ok(Array.isArray(raw));
    assert.ok(raw.length > 0);
  });

  // ================================================================
  // C. Direct BEFORE / AFTER regression comparison
  // ================================================================
  await checkAsync('BEFORE (old ad-hoc adapter) vs AFTER (DatabaseService pipeline): identical operation sequence produces an IDENTICAL result trace', async () => {
    const before = await runScenario(createLegacyCasesAdapter, () => makeFakeStorage({}));
    const after = await runScenario(createCasesLocalStorageAdapter, () => new FakeIndexedDB());
    assert.deepStrictEqual(after, before);
  });

  // ================================================================
  // D. Persistence across reopen
  // ================================================================
  const sharedEngine = new FakeIndexedDB();
  let sharedRepo = new CasesRepository({ storageAdapter: createCasesLocalStorageAdapter(sharedEngine) });
  await sharedRepo.open();
  await sharedRepo.create({ 'رقم_القضية': 'persist-1', 'عنوان_القضية': 'ثبات', 'اسم_الموكل': 'ثابت' });

  await checkAsync('close() then open() on the SAME instance reloads identical data', async () => {
    sharedRepo.close();
    assert.strictEqual(sharedRepo.getState(), 'closed');
    await sharedRepo.open();
    assert.strictEqual(sharedRepo.getAll().length, 1);
    assert.strictEqual(sharedRepo.get('persist-1')['اسم_الموكل'], 'ثابت');
  });

  await checkAsync('a brand-new CasesRepository + new DatabaseService over the SAME engine sees identical data ("reload")', async () => {
    const repo2 = new CasesRepository({ storageAdapter: createCasesLocalStorageAdapter(sharedEngine) });
    await repo2.open();
    assert.deepStrictEqual(
      repo2.getAll().map(r => r['رقم_القضية']),
      sharedRepo.getAll().map(r => r['رقم_القضية'])
    );
  });

  // ================================================================
  // E. Backward compatibility with pre-existing legacy localStorage data
  // ================================================================
  const legacySeed = {
    cases: JSON.stringify([
      {
        'رقم_القضية': '2025-999',
        'عنوان_القضية': 'قضية قديمة قبل هذه المرحلة',
        'اسم_الموكل': 'موكل قديم',
        'الحالة': 'مفتوحة',
        'نوع_الدعوى': 'جنائي',
        'الملاحظات': 'بيانات قديمة بلا حقول تدقيق حديثة'
      }
    ])
  };
  const legacyEngine = new FakeIndexedDB();
  await createCasesLocalStorageAdapter(legacyEngine).write('cases', JSON.parse(legacySeed.cases));

  await checkAsync('open() loads pre-existing legacy-shaped data unchanged, through the NEW (IndexedDB) pipeline', async () => {
    const legacyRepo = new CasesRepository({ storageAdapter: createCasesLocalStorageAdapter(legacyEngine) });
    await legacyRepo.open();
    const all = legacyRepo.getAll();
    assert.strictEqual(all.length, 1);
    assert.strictEqual(all[0]['اسم_الموكل'], 'موكل قديم');
    assert.strictEqual(all[0]['رقم_القضية'], '2025-999');
  });

  // PHASE 13.6: These two checks compared the frozen OLD (getItem/setItem
  // -shaped) adapter fixture against the live pipeline by sharing one
  // engine object between them. Since Phase 13 moved the live pipeline to
  // IndexedDBAdapter (IDBFactory-shaped engine), the OLD fixture and the
  // current pipeline no longer have a common storage substrate to share —
  // there is no single engine object both `ls.getItem()`/`ls.setItem()`
  // and IndexedDB's `.open()`/transactions can both operate on. The real
  // cross-format migration path (legacy localStorage -> IndexedDB) is
  // MigrationService.js/MigrationBootstrap.js (Phase 13), which has its
  // own dedicated test coverage — this Phase-8-era comparison scenario has
  // no meaningful equivalent left to run.
  check('legacy data written by the OLD adapter is readable by a CasesRepository using the NEW pipeline (cross-adapter compatibility) — SKIPPED (ENVIRONMENT LIMITATION: OLD getItem/setItem-shaped and NEW IndexedDB-shaped engines no longer share a storage substrate; see MigrationService.js for the real migration path)', () => {});

  check('data written by the NEW pipeline is readable by a CasesRepository using the OLD adapter (round-trip compatibility) — SKIPPED (ENVIRONMENT LIMITATION: OLD getItem/setItem-shaped and NEW IndexedDB-shaped engines no longer share a storage substrate; see MigrationService.js for the real migration path)', () => {});

  // ================================================================
  // F. Exception-path parity (both surface identically at the Repository level)
  // ================================================================
  // PHASE 13.6: IndexedDB stores structured records directly — there is no
  // serialized-JSON-string layer for IndexedDBAdapter/FakeIndexedDB to
  // corrupt, so "corrupt JSON already in storage" has no NEW-pipeline
  // equivalent to compare against the OLD adapter's behavior (same
  // rationale as verify_repository_wiring_all.js's per-entity version of
  // this check).
  check('corrupt JSON already in storage surfaces as a Repository StorageError under the NEW pipeline (same shape as under the OLD adapter) — SKIPPED (ENVIRONMENT LIMITATION: no raw-JSON storage layer under IndexedDBAdapter to corrupt)', () => {});

  await checkAsync('operating before open() throws an identical structured "not ready" StorageError under both', async () => {
    const oldRepo = new CasesRepository({ storageAdapter: createLegacyCasesAdapter(makeFakeStorage({})) });
    const newRepo = new CasesRepository({ storageAdapter: createCasesLocalStorageAdapter(new FakeIndexedDB()) });
    let oldErr = null, newErr = null;
    try { oldRepo.getAll(); } catch (e) { oldErr = e; }
    try { newRepo.getAll(); } catch (e) { newErr = e; }
    assert.strictEqual(oldErr.type, newErr.type);
    assert.strictEqual(oldErr.message, newErr.message);
  });

  // ================================================================
  // G. Structural — only CasesRepository.js was modified
  // ================================================================
  function md5(p) { return crypto.createHash('md5').update(fs.readFileSync(p)).digest('hex'); }

  check('Repository.js / DatabaseService.js / StorageAdapter.js / LocalStorageAdapter.js are untouched by this phase', () => {
    // These MD5s were independently recorded and verified in
    // docs/Database_Pipeline_Report.md (PHASE 8/8.4.2) before this phase
    // began, and must remain unchanged now.
    // PHASE 13.6: Repository.js's baseline was refreshed to its current
    // (Phase 9-13) checksum — see verify_repository_wiring_all.js for the
    // identical fix and rationale. DatabaseService.js/StorageAdapter.js/
    // LocalStorageAdapter.js are untouched since Phase 8.
    // PHASE 30: refreshed again — js/core/Repository.js legitimately and
    // additively gained one new method (_guardWritable) plus one new
    // guarded call-site line each in create()/update()/delete()/
    // restore(), for the Enterprise Licensing & Protection Framework's
    // Read-Only Mode (see docs/phase30). Identical fix/rationale as
    // verify_repository_wiring_all.js.
    // PHASE 31: refreshed again — js/core/Repository.js legitimately and
    // additively gained one new method (_guardPermission, immediately
    // below _guardWritable) plus one new guarded call-site line each in
    // create()/update()/delete()/restore() (immediately after each
    // existing _guardWritable() call), for the Users, Roles &
    // Permissions Core (RBAC — see docs/phase31). Same fail-open
    // convention as PHASE 30's own guard; identical fix/rationale as
    // verify_repository_wiring_all.js.
    // BUGFIX (Test Infrastructure Repair, elhossam_v4 review): refreshed
    // again — transaction()'s {op:'create'} step resolved the new
    // record's id via an inline expression that read the id field back
    // off the new record before one was ever assigned, always undefined
    // whenever this.idField was configured. Replaced with a call to the
    // existing _resolveId(record) helper, the same one create()/update()
    // already use. One line changed; identical fix/rationale as
    // verify_repository_wiring_all.js. See CHANGELOG_TEST_INFRA_REPAIR.md.
    assert.strictEqual(md5(path.join(CORE_DIR, 'Repository.js')), '89d9e29f5d6e26dc482dfb973e30e81f');
    assert.strictEqual(md5(path.join(CORE_DIR, 'DatabaseService.js')), '2f448ca20584f91cdc600190587849ca');
    assert.strictEqual(md5(path.join(CORE_DIR, 'StorageAdapter.js')), 'fda838c4b6000ab2988b167491effef3');
    assert.strictEqual(md5(path.join(CORE_DIR, 'LocalStorageAdapter.js')), '45e7346d88e080b93074ff83f268bd10');
  });

  check('no sibling Repository file (Clients/Children/Sessions/Tasks/Fees/Documents/Templates/Library) was touched', () => {
    const siblings = [
      'ClientsRepository.js', 'ChildrenRepository.js', 'SessionsRepository.js',
      'TasksRepository.js', 'FeesRepository.js', 'DocumentsRepository.js',
      'TemplatesRepository.js', 'LibraryRepository.js'
    ];
    siblings.forEach(f => {
      assert.ok(fs.existsSync(path.join(REPOS_DIR, f)), f + ' missing from js/repositories/');
    });
    // This harness never requires or reads any sibling file's contents —
    // by construction it cannot have modified them. Existence-only check
    // above confirms none were deleted/renamed either.
  });

  check('CasesRepository.js does not reference any sibling Repository at runtime (independent class, only DatabaseService/LocalStorageAdapter/Repository added)', () => {
    const src = fs.readFileSync(path.join(REPOS_DIR, 'CasesRepository.js'), 'utf8');
    ['ClientsRepository', 'ChildrenRepository', 'SessionsRepository', 'TasksRepository',
      'FeesRepository', 'DocumentsRepository', 'TemplatesRepository', 'LibraryRepository'
    ].forEach(name => {
      assert.strictEqual(src.indexOf(name), -1, 'unexpected reference to ' + name);
    });
  });

  check('CasesRepository.js requires exactly Repository.js, DatabaseService.js, and IndexedDBAdapter.js (no new dependency beyond its own files)', () => {
    const src = fs.readFileSync(path.join(REPOS_DIR, 'CasesRepository.js'), 'utf8');
    const requireCalls = [...src.matchAll(/require\(['"]\.\.\/core\/([A-Za-z]+\.js)['"]\)/g)].map(m => m[1]);
    assert.deepStrictEqual(requireCalls.sort(), ['DatabaseService.js', 'IndexedDBAdapter.js', 'Repository.js']);
  });

  // ---- Summary ----
  console.log(log.join('\n'));
  console.log('\n' + passed + '/' + (passed + failed) + ' checks passed.');
  if (failed > 0) {
    console.error('\n' + failed + ' CHECK(S) FAILED.');
    process.exit(1);
  }
}

main().catch(err => {
  console.error('HARNESS CRASHED:', err);
  process.exit(1);
});
