/**
 * verify_migration_bootstrap.js
 * PHASE 13.3C — PART 3C — MigrationBootstrap.js verification harness.
 * Standalone Node harness, matching the existing `verify_*.js` harnesses'
 * pattern (check()/checkAsync() + PASS/FAIL log + summary + exit code).
 * No browser required — LocalStorageAdapter is driven through a fake
 * Storage-shaped object (same pattern verify_migration_service.js and
 * verify_localstorage_adapter.js use), IndexedDBAdapter is driven through
 * js/tests/fake_indexeddb.js.
 *
 * Covers every requirement PHASE 13.3C — PART 3C's redesign was asked to
 * satisfy:
 *   1. Background migration only — run() resolves without any DOM/window
 *      dependency when adapters are injected.
 *   2. Never reloads the page — static source scan for location.reload.
 *   3. Never shows a browser dialog — static source scan for
 *      alert(/confirm(/prompt(.
 *   4. Already-completed checkpoint -> startup continues immediately,
 *      zero additional entity writes.
 *   5. Fresh/empty environment -> completes cleanly.
 *   6. Migration failure -> run() still resolves (never rejects),
 *      success:false, application-safe report.
 *   7. Missing dependency -> run() still resolves, never throws.
 *   8. No data loss: a second run() after completion never overwrites
 *      target data already sitting in IndexedDB.
 *   9. No duplicate migration: repeated run() calls never accumulate
 *      records.
 *  10. Idempotent bootstrap: concurrent run() calls share one in-flight
 *      Promise (single-flight), not one migration attempt per call.
 *  11. Interrupted migration resumes correctly through the bootstrap
 *      (not just through MigrationService directly).
 *  12. index.html wiring: MigrationBootstrap.js is loaded after its
 *      dependencies and before any Repository script tag.
 *
 * Run: node js/tests/verify_migration_bootstrap.js
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

// ----------------------------------------------------------------------
// Same pre-existing, out-of-scope issue documented in
// verify_migration_service.js (IndexedDBTransaction.js's abort path never
// attaches a handler to the callback's own inner promise). This harness
// intentionally injects IndexedDB write failures to prove
// MigrationBootstrap.run() never rejects even when MigrationService.
// migrate() itself fails underneath it — see that file's header for the
// full root-cause writeup. Not fixed here: IndexedDBTransaction.js is not
// among this phase's allowed files.
// ----------------------------------------------------------------------
process.on('unhandledRejection', function (reason) {
  const isKnownOrphanedTransactionLeak = reason && /write\(\) put/.test(String(reason.message || ''));
  if (!isKnownOrphanedTransactionLeak) {
    console.error('UNEXPECTED UNHANDLED REJECTION (not the documented IndexedDBTransaction.js leak):', reason);
    failed++;
    log.push('FAIL — (unexpected unhandled rejection)  =>  ' + (reason && reason.message ? reason.message : reason));
  }
});

const { FakeIndexedDB } = require(path.join(__dirname, 'fake_indexeddb.js'));
require(path.join(__dirname, '..', 'core', 'StorageAdapter.js'));
const { LocalStorageAdapter } = require(path.join(__dirname, '..', 'core', 'LocalStorageAdapter.js'));
require(path.join(__dirname, '..', 'core', 'IndexedDBErrors.js'));
require(path.join(__dirname, '..', 'core', 'IndexedDBSchema.js'));
require(path.join(__dirname, '..', 'core', 'IndexedDBVersion.js'));
require(path.join(__dirname, '..', 'core', 'IndexedDBUtils.js'));
require(path.join(__dirname, '..', 'core', 'IndexedDBTransaction.js'));
require(path.join(__dirname, '..', 'core', 'IndexedDBEngine.js'));
const { IndexedDBAdapter } = require(path.join(__dirname, '..', 'core', 'IndexedDBAdapter.js'));
require(path.join(__dirname, '..', 'core', 'MigrationService.js'));
const MigrationBootstrap = require(path.join(__dirname, '..', 'core', 'MigrationBootstrap.js'));

const INDEX_HTML_PATH = path.join(__dirname, '..', '..', 'index.html');
const BOOTSTRAP_SRC_PATH = path.join(__dirname, '..', 'core', 'MigrationBootstrap.js');

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

// ---- Fake localStorage — identical shape to verify_migration_service.js's own helper. ----
function makeFakeStorage(seed) {
  const store = Object.assign({}, seed || {});
  const impl = {
    getItem: function (k) { return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; },
    setItem: function (k, v) { store[k] = String(v); },
    removeItem: function (k) { delete store[k]; },
    key: function (i) { return Object.keys(store)[i] || null; },
    _dump: function () { return store; }
  };
  Object.defineProperty(impl, 'length', { get: function () { return Object.keys(store).length; } });
  return impl;
}

// ---- Every real entity's real keyPath, copied straight from
// IndexedDBSchema.js (never re-derived/guessed) — same table
// verify_migration_service.js uses. ----
const KEY_PATHS = {
  cases: 'رقم_القضية',
  clients: 'رقم_الموكل',
  sessions: 'رقم_الجلسة',
  documents: 'رقم_المستند',
  tasks: 'رقم_المهمة',
  children: 'رقم_الطفل',
  fees: 'رقم_العملية',
  library: 'id',
  templates: 'id',
  settings: 'id'
};

function makeRecords(entityKey, count, startAt) {
  const keyPath = KEY_PATHS[entityKey];
  const out = [];
  for (let i = 0; i < count; i++) {
    const rec = {};
    rec[keyPath] = (startAt || 1) + i;
    rec.name = entityKey + '-' + rec[keyPath];
    out.push(rec);
  }
  return out;
}

/** Builds one fully isolated source+target environment, mirroring
 *  verify_migration_service.js's buildEnv(), but returns raw adapters
 *  (not a MigrationService) since MigrationBootstrap.run() builds its own
 *  MigrationService internally from injected adapters. */
function buildEnv(localStorageSeed) {
  const source = new LocalStorageAdapter({ storageImpl: makeFakeStorage(localStorageSeed) });
  const fakeIDB = new FakeIndexedDB();
  const target = new IndexedDBAdapter({ engineOptions: { indexedDBImpl: fakeIDB } });
  return { source, target, fakeIDB };
}

async function main() {

  // ============================================================
  // 1. FRESH / EMPTY ENVIRONMENT
  // ============================================================
  await checkAsync('[Fresh environment] run() resolves success:true, ran:true, on a brand-new source/target pair', async () => {
    MigrationBootstrap.reset();
    const { source, target } = buildEnv({});
    const report = await MigrationBootstrap.run({ sourceAdapter: source, targetAdapter: target });
    assert.strictEqual(report.success, true);
    assert.strictEqual(report.ran, true);
    assert.ok(report.migrationReport, 'expected a migrationReport to be attached');
  });

  await checkAsync('[Fresh environment] real user data seeded in localStorage lands in the IndexedDB target', async () => {
    MigrationBootstrap.reset();
    const seed = makeRecords('cases', 5, 1);
    const { source, target } = buildEnv({ cases: JSON.stringify(seed) });
    await MigrationBootstrap.run({ sourceAdapter: source, targetAdapter: target });
    const out = await target.read('cases');
    assert.strictEqual(out.length, 5);
  });

  // ============================================================
  // 2. ALREADY-COMPLETED CHECKPOINT — "startup must immediately continue"
  // ============================================================
  await checkAsync('[Already completed] a second bootstrap run against an already-migrated target is a safe no-op (skipped:true)', async () => {
    const seed = makeRecords('clients', 3, 1);
    const { source, target } = buildEnv({ clients: JSON.stringify(seed) });

    MigrationBootstrap.reset();
    await MigrationBootstrap.run({ sourceAdapter: source, targetAdapter: target });

    MigrationBootstrap.reset(); // simulate a fresh page load's own single-flight cache
    const secondReport = await MigrationBootstrap.run({ sourceAdapter: source, targetAdapter: target });
    assert.strictEqual(secondReport.ran, false);
    assert.strictEqual(secondReport.skipped, true);
    assert.strictEqual(secondReport.reason, 'already-completed');
  });

  await checkAsync('[No data loss] an already-completed re-run never overwrites target data with stale source data', async () => {
    const originalSeed = makeRecords('tasks', 4, 1);
    const { source, target } = buildEnv({ tasks: JSON.stringify(originalSeed) });

    MigrationBootstrap.reset();
    await MigrationBootstrap.run({ sourceAdapter: source, targetAdapter: target });

    // Simulate a real user creating a 5th task directly in IndexedDB
    // AFTER migration completed (exactly what a live Repository would do).
    const afterMigration = await target.read('tasks');
    afterMigration.push({ [KEY_PATHS.tasks]: 999, name: 'tasks-999-user-created' });
    await target.write('tasks', afterMigration);

    // Stale localStorage still has only the original 4 records — this
    // must NOT be allowed to clobber the 5-record target on a re-run.
    MigrationBootstrap.reset();
    await MigrationBootstrap.run({ sourceAdapter: source, targetAdapter: target });

    const finalRecords = await target.read('tasks');
    assert.strictEqual(finalRecords.length, 5, 'the user-created 5th record must survive a re-run of an already-completed migration');
  });

  // ============================================================
  // 3. FAILURE HANDLING — "must never interrupt the user"
  // ============================================================
  await checkAsync('[Migration failure] run() still resolves (never rejects) when the underlying migration fails', async () => {
    MigrationBootstrap.reset();
    const seed = makeRecords('sessions', 6, 1);
    const { source, target, fakeIDB } = buildEnv({ sessions: JSON.stringify(seed) });
    await target.open();
    fakeIDB.injectStoreFailure(target._engine.getDatabaseName(), 'sessions', 'put', 'UnknownError', 'Simulated interruption.');

    const report = await MigrationBootstrap.run({ sourceAdapter: source, targetAdapter: target });
    assert.strictEqual(report.success, false);
    assert.strictEqual(report.reason, 'migration-failed');
    assert.ok(report.error && report.error.message, 'expected an error object with a message');
  });

  await checkAsync('[Never throws] a falsy MigrationServiceClass override falls back gracefully and still resolves (never throws)', async () => {
    MigrationBootstrap.reset();
    const { source, target } = buildEnv({});
    const report = await MigrationBootstrap.run({
      sourceAdapter: source,
      targetAdapter: target,
      MigrationServiceClass: null // force the "class missing" path (no real MigrationService injected, and module-level lookup is bypassed by explicit null? see note)
    });
    // MigrationBootstrap only falls back to the module-level MigrationService
    // when MigrationServiceClass is falsy AND the module-level require
    // succeeded (which it did, in this Node harness). To genuinely exercise
    // the "dependency missing" path we instead pass a deliberately broken
    // adapter shape below.
    assert.ok(report.success === true || report.success === false, 'run() must resolve either way, never throw/reject');
  });

  await checkAsync('[Missing dependency, forced] run() resolves success:false when adapter construction itself throws', async () => {
    MigrationBootstrap.reset();
    // A MigrationService-shaped constructor that always throws synchronously,
    // simulating a genuinely broken/incompatible dependency being loaded.
    function BrokenMigrationService() {
      throw new Error('Simulated: MigrationService failed to construct.');
    }
    const { source, target } = buildEnv({});
    const report = await MigrationBootstrap.run({
      sourceAdapter: source,
      targetAdapter: target,
      MigrationServiceClass: BrokenMigrationService
    });
    assert.strictEqual(report.success, false);
    assert.strictEqual(report.reason, 'dependencies-unavailable');
    assert.ok(report.error && /Simulated/.test(report.error.message));
  });

  // ============================================================
  // 4. RESUMPTION THROUGH THE BOOTSTRAP (not just MigrationService directly)
  // ============================================================
  await checkAsync('[Interrupted migration] a bootstrap run that fails partway resumes cleanly on the next bootstrap run, no duplicates', async () => {
    const seed = makeRecords('sessions', 6, 1);
    const { source, target, fakeIDB } = buildEnv({ sessions: JSON.stringify(seed) });
    await target.open();
    fakeIDB.injectStoreFailure(target._engine.getDatabaseName(), 'sessions', 'put', 'UnknownError', 'Simulated interruption.');

    MigrationBootstrap.reset();
    const firstReport = await MigrationBootstrap.run({ sourceAdapter: source, targetAdapter: target });
    assert.strictEqual(firstReport.success, false);

    MigrationBootstrap.reset();
    const secondReport = await MigrationBootstrap.run({ sourceAdapter: source, targetAdapter: target });
    assert.strictEqual(secondReport.success, true);

    const out = await target.read('sessions');
    assert.strictEqual(out.length, 6);
    const seen = new Set(out.map(function (r) { return r[KEY_PATHS.sessions]; }));
    assert.strictEqual(seen.size, 6, 'resumed migration through the bootstrap must not duplicate records');
  });

  // ============================================================
  // 5. SINGLE-FLIGHT / IDEMPOTENT BOOTSTRAP
  // ============================================================
  await checkAsync('[Idempotent bootstrap] concurrent run() calls share exactly one in-flight Promise', async () => {
    MigrationBootstrap.reset();
    const seed = makeRecords('children', 10, 1);
    const { source, target } = buildEnv({ children: JSON.stringify(seed) });

    const p1 = MigrationBootstrap.run({ sourceAdapter: source, targetAdapter: target });
    const p2 = MigrationBootstrap.run({ sourceAdapter: source, targetAdapter: target });
    const p3 = MigrationBootstrap.run();
    assert.strictEqual(p1, p2, 'a second concurrent call must return the exact same Promise instance');
    assert.strictEqual(p1, p3, 'a third concurrent call (even with no config) must return the exact same Promise instance');
    await p1;
    const out = await target.read('children');
    assert.strictEqual(out.length, 10, 'a single-flight guarantee must mean only one migration attempt actually ran');
  });

  await checkAsync('[No duplicate migration] repeated bootstrap run() calls after completion never accumulate records', async () => {
    const seed = makeRecords('library', 8, 1);
    const { source, target } = buildEnv({ library: JSON.stringify(seed) });
    for (let i = 0; i < 5; i++) {
      MigrationBootstrap.reset();
      await MigrationBootstrap.run({ sourceAdapter: source, targetAdapter: target });
    }
    const out = await target.read('library');
    assert.strictEqual(out.length, 8);
  });

  // ============================================================
  // 6. STATIC SAFETY CHECKS — no reload, no dialogs, never throws synchronously
  // ============================================================
  const bootstrapSrc = fs.readFileSync(BOOTSTRAP_SRC_PATH, 'utf8');

  check('[No page reload] MigrationBootstrap.js never calls location.reload anywhere', () => {
    assert.ok(!/location\s*\.\s*reload/.test(bootstrapSrc), 'found a location.reload() call — the abandoned design must not reappear');
  });
  check('[No browser dialogs] MigrationBootstrap.js never calls alert(/confirm(/prompt(', () => {
    assert.ok(!/\balert\s*\(/.test(bootstrapSrc));
    assert.ok(!/\bconfirm\s*\(/.test(bootstrapSrc));
    assert.ok(!/\bprompt\s*\(/.test(bootstrapSrc));
  });
  check('run() never throws synchronously, even with a completely empty config object', () => {
    assert.doesNotThrow(() => { MigrationBootstrap.reset(); MigrationBootstrap.run({}); });
  });
  check('MigrationBootstrap exposes exactly run() and reset()', () => {
    const keys = Object.keys(MigrationBootstrap).sort();
    assert.deepStrictEqual(keys, ['reset', 'run']);
  });

  // ============================================================
  // 7. index.html WIRING — static script-order check
  // ============================================================
  const html = fs.readFileSync(INDEX_HTML_PATH, 'utf8');
  const srcs = [...html.matchAll(/<script src="([^"]+)"><\/script>/g)].map(m => m[1]);
  const indexOf = (needle) => srcs.findIndex(s => s === needle);

  check('[Wiring] index.html loads MigrationBootstrap.js exactly once', () => {
    assert.strictEqual(srcs.filter(s => s === 'js/core/MigrationBootstrap.js').length, 1);
  });
  check('[Wiring] MigrationBootstrap.js loads after LocalStorageAdapter.js, IndexedDBAdapter.js, and MigrationService.js', () => {
    const bootstrapIdx = indexOf('js/core/MigrationBootstrap.js');
    assert.ok(bootstrapIdx > indexOf('js/core/LocalStorageAdapter.js'));
    assert.ok(bootstrapIdx > indexOf('js/core/IndexedDBAdapter.js'));
    assert.ok(bootstrapIdx > indexOf('js/core/MigrationService.js'));
  });
  check('[Wiring] MigrationBootstrap.js loads before every *Repository.js script tag', () => {
    const bootstrapIdx = indexOf('js/core/MigrationBootstrap.js');
    const repoSrcs = srcs.filter(s => /\/repositories\/.*Repository\.js$/.test(s));
    assert.ok(repoSrcs.length >= 9, 'expected all 9 entity Repository script tags to still be present');
    repoSrcs.forEach(s => {
      assert.ok(bootstrapIdx < indexOf(s), s + ' must load AFTER MigrationBootstrap.js');
    });
  });
  check('[Wiring] index.html contains no location.reload call anywhere near the migration wiring', () => {
    // Broad, whole-file safety net (not just the bootstrap file itself):
    // confirms the abandoned auto-reload design was never wired into the
    // page at all.
    assert.ok(!/location\s*\.\s*reload\s*\(\s*\)/.test(html));
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
