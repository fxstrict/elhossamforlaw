/**
 * verify_migration_service.js
 * PHASE 13.3C — PART 3B — MigrationService.js verification harness.
 * Standalone Node harness, matching the existing `verify_*.js` harnesses'
 * pattern (check()/checkAsync() + PASS/FAIL log + summary + exit code).
 * No browser required — LocalStorageAdapter is driven through a fake
 * Storage-shaped object (same pattern verify_localstorage_adapter.js
 * uses), IndexedDBAdapter is driven through js/tests/fake_indexeddb.js
 * (extended this phase — see that file's PART 3B header comment).
 *
 * Covers every scenario PHASE 13.3C — PART 3B was asked to verify:
 *   1. Empty database
 *   2. Existing LocalStorage
 *   3. Existing IndexedDB
 *   4. Interrupted migration
 *   5. Repeated / double migration
 *   6. Large dataset
 *   7. Atomic migration
 *   8. No duplicated records
 *
 * Run: node js/tests/verify_migration_service.js
 */

const assert = require('assert');
const path = require('path');

// ----------------------------------------------------------------------
// Pre-existing, out-of-scope issue discovered while writing this harness
// (documented here rather than fixed — IndexedDBTransaction.js is
// existing architecture this phase reuses exactly, not a file this phase
// touches or owns):
//
// `IndexedDBTransaction.prototype.run()` (js/core/IndexedDBTransaction.js)
// captures its callback's return value as `callbackResult` and only ever
// consumes it via `resolve(callbackResult)` inside `nativeTx.oncomplete`.
// On the ABORT path (`nativeTx.onabort`), it rejects the outer promise
// directly with its own classified error and never touches
// `callbackResult` at all. `IndexedDBAdapter.write()`'s callback returns
// exactly such a promise (`store.clear()` → `.then(() => Promise.all(N
// puts))`), so whenever a `put()` failure aborts the transaction, that
// inner promise chain independently rejects with the same underlying
// error — but nothing ever attaches a handler to it, producing a Node
// `unhandledRejection` for every migration failure this harness
// intentionally injects (6 occurrences across the checks below).
//
// This does NOT affect correctness: `IndexedDBAdapter.write()` (and
// therefore `MigrationService.migrate()`) is driven entirely by `run()`'s
// OUTER promise, which every "[Interrupted migration]" / "[Atomic
// migration]" check below asserts rejects correctly, with the right
// `MigrationError.entityKey`/`.stage`. The orphaned inner promise is a
// pure duplicate — the same failure reaching a promise nobody reads —
// not a swallowed or misrouted one. Registering a handler here (rather
// than in MigrationService.js or fake_indexeddb.js, neither of which
// causes this) keeps this harness's exit code an honest reflection of
// its own 25 assertions instead of an unrelated pre-existing leak in a
// file PART 3B does not modify.
process.on('unhandledRejection', function (reason) {
  const isKnownOrphanedTransactionLeak = reason && /write\(\) put/.test(String(reason.message || ''));
  if (!isKnownOrphanedTransactionLeak) {
    // Anything else really is a bug this harness should surface loudly.
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
const { MigrationService, MigrationError } = require(path.join(__dirname, '..', 'core', 'MigrationService.js'));

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

// ---- Fake localStorage — identical shape to verify_localstorage_adapter.js's own helper. ----
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
// IndexedDBSchema.js (never re-derived/guessed) — needed to build
// records that will actually satisfy IndexedDBAdapter.write()'s
// store.put() (an out-of-line keyPath that doesn't resolve on a record
// throws DataError). ----
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

function uniqueCount(records, keyPath) {
  const seen = new Set();
  records.forEach(function (r) { seen.add(r[keyPath]); });
  return seen.size;
}

/** Builds one fully isolated source+target environment: a fresh fake
 *  localStorage (optionally seeded), a fresh FakeIndexedDB factory (so
 *  no test can leak state into another), and the MigrationService wired
 *  to both. `svcConfig` is merged on top of the default
 *  {sourceAdapter, targetAdapter}. */
function buildEnv(localStorageSeed, svcConfig) {
  const source = new LocalStorageAdapter({ storageImpl: makeFakeStorage(localStorageSeed) });
  const fakeIDB = new FakeIndexedDB();
  const target = new IndexedDBAdapter({ engineOptions: { indexedDBImpl: fakeIDB } });
  const svc = new MigrationService(Object.assign(
    { sourceAdapter: source, targetAdapter: target },
    svcConfig || {}
  ));
  return { source, target, fakeIDB, svc };
}

async function main() {

  // ============================================================
  // 1. EMPTY DATABASE — fresh localStorage (no keys at all set),
  //    fresh IndexedDB. Migration must complete cleanly with zero
  //    records moved, and leave every entity genuinely empty.
  // ============================================================
  await checkAsync('[Empty database] migrate() completes (not skipped) with zero records moved', async () => {
    const { svc } = buildEnv({});
    const report = await svc.migrate();
    assert.strictEqual(report.skipped, false);
    assert.strictEqual(report.totalRecordsMigrated, 0);
    assert.strictEqual(report.entities.length, 14); // PHASE 31 (RBAC): schema grew 12->15 stores (11->14 excluding metadata).
    report.entities.forEach(e => assert.strictEqual(e.status, 'migrated'));
  });

  await checkAsync('[Empty database] every entity reads back as an empty array on the target', async () => {
    const { target, svc } = buildEnv({});
    await svc.migrate();
    for (const entityKey of Object.keys(KEY_PATHS)) {
      const records = await target.read(entityKey);
      assert.deepStrictEqual(records, [], entityKey + ' should be empty');
    }
  });

  await checkAsync('[Empty database] checkpoint status is "completed" and getStatus() reflects it', async () => {
    const { svc } = buildEnv({});
    await svc.migrate();
    const status = await svc.getStatus();
    assert.strictEqual(status.status, 'completed');
    assert.strictEqual(status.completedEntities.length, 14); // PHASE 31 (RBAC): 11 -> 14.
    assert.strictEqual(status.remainingEntities.length, 0);
  });

  await checkAsync('[Empty database] getStatus() before any migrate() call reports "not-started"', async () => {
    const { svc } = buildEnv({});
    const status = await svc.getStatus();
    assert.strictEqual(status.status, 'not-started');
    assert.strictEqual(status.completedEntities.length, 0);
  });

  // ============================================================
  // 2. EXISTING LOCALSTORAGE — localStorage already holds real
  //    records for several entities before migration ever runs.
  // ============================================================
  await checkAsync('[Existing LocalStorage] populated entities migrate with matching record sets', async () => {
    const casesSeed = makeRecords('cases', 3, 1);
    const clientsSeed = makeRecords('clients', 2, 1);
    const { target, svc } = buildEnv({
      cases: JSON.stringify(casesSeed),
      clients: JSON.stringify(clientsSeed)
    });
    const report = await svc.migrate();
    assert.strictEqual(report.totalRecordsMigrated, 5);

    const casesOut = await target.read('cases');
    const clientsOut = await target.read('clients');
    assert.deepStrictEqual(casesOut.slice().sort((a, b) => a['رقم_القضية'] - b['رقم_القضية']), casesSeed);
    assert.deepStrictEqual(clientsOut.slice().sort((a, b) => a['رقم_الموكل'] - b['رقم_الموكل']), clientsSeed);
  });

  await checkAsync('[Existing LocalStorage] entities the source never had migrate as empty, not omitted', async () => {
    const { target, svc } = buildEnv({ cases: JSON.stringify(makeRecords('cases', 1, 1)) });
    const report = await svc.migrate();
    const sessionsEntry = report.entities.find(e => e.entityKey === 'sessions');
    assert.strictEqual(sessionsEntry.status, 'migrated');
    assert.strictEqual(sessionsEntry.sourceCount, 0);
    assert.deepStrictEqual(await target.read('sessions'), []);
  });

  // ============================================================
  // 3. EXISTING INDEXEDDB — the target already holds data before
  //    migrate() ever runs (not from a prior migration — from some
  //    other prior write). Two sub-cases: (a) source also has that
  //    entity → source wins (whole-array replace, matches every
  //    other write() caller in this codebase); (b) source never had
  //    that entity at all → the documented design decision applies:
  //    target's existing data must survive untouched.
  // ============================================================
  await checkAsync('[Existing IndexedDB] source-present entity overwrites pre-existing target data', async () => {
    const newCases = makeRecords('cases', 2, 100);
    const { target, svc } = buildEnv({ cases: JSON.stringify(newCases) });
    await target.open();
    await target.write('cases', makeRecords('cases', 5, 1)); // stale pre-existing target data
    const report = await svc.migrate();
    const casesEntry = report.entities.find(e => e.entityKey === 'cases');
    assert.strictEqual(casesEntry.status, 'migrated');
    const casesOut = await target.read('cases');
    assert.strictEqual(casesOut.length, 2);
    assert.deepStrictEqual(casesOut.slice().sort((a, b) => a['رقم_القضية'] - b['رقم_القضية']), newCases);
  });

  await checkAsync('[Existing IndexedDB] source-absent entity leaves pre-existing target data untouched', async () => {
    const { target, svc } = buildEnv({}); // localStorage never had "settings" at all
    await target.open();
    const preExisting = makeRecords('settings', 3, 1);
    await target.write('settings', preExisting);
    const report = await svc.migrate();
    const settingsEntry = report.entities.find(e => e.entityKey === 'settings');
    assert.strictEqual(settingsEntry.status, 'skipped-source-absent-target-populated');
    const settingsOut = await target.read('settings');
    assert.deepStrictEqual(settingsOut.slice().sort((a, b) => a.id - b.id), preExisting);
  });

  // ============================================================
  // 4. INTERRUPTED MIGRATION — a write fails partway through a
  //    multi-entity run. The checkpoint must record exactly what
  //    finished, the run must reject with a MigrationError naming
  //    the failed entity, and a second migrate() call must resume
  //    and finish without re-touching what already succeeded.
  // ============================================================
  await checkAsync('[Interrupted migration] rejects with a MigrationError naming the failed entity and stage', async () => {
    const { fakeIDB, target, svc } = buildEnv(
      {
        cases: JSON.stringify(makeRecords('cases', 1, 1)),
        clients: JSON.stringify(makeRecords('clients', 1, 1)),
        sessions: JSON.stringify(makeRecords('sessions', 2, 1))
      },
      { entityKeys: ['cases', 'clients', 'sessions'] }
    );
    await target.open();
    fakeIDB.injectStoreFailure(target._engine.getDatabaseName(), 'sessions', 'put', 'UnknownError', 'Simulated interruption.');

    await assert.rejects(
      () => svc.migrate(),
      (err) => {
        assert.ok(err instanceof MigrationError, 'error should be a MigrationError');
        assert.strictEqual(err.entityKey, 'sessions');
        assert.strictEqual(err.stage, 'write');
        return true;
      }
    );
  });

  await checkAsync('[Interrupted migration] checkpoint records exactly which entities finished before the failure', async () => {
    const { fakeIDB, target, svc } = buildEnv(
      {
        cases: JSON.stringify(makeRecords('cases', 1, 1)),
        clients: JSON.stringify(makeRecords('clients', 1, 1)),
        sessions: JSON.stringify(makeRecords('sessions', 2, 1))
      },
      { entityKeys: ['cases', 'clients', 'sessions'] }
    );
    await target.open();
    fakeIDB.injectStoreFailure(target._engine.getDatabaseName(), 'sessions', 'put', 'UnknownError', 'Simulated interruption.');
    await svc.migrate().catch(() => {});

    const status = await svc.getStatus();
    assert.strictEqual(status.status, 'interrupted');
    assert.deepStrictEqual(status.completedEntities, ['cases', 'clients']);
    assert.deepStrictEqual(status.remainingEntities, ['sessions']);
    assert.strictEqual(status.lastError.entityKey, 'sessions');
  });

  await checkAsync('[Interrupted migration] a second migrate() call resumes and completes without re-touching finished entities', async () => {
    const casesSeed = makeRecords('cases', 1, 1);
    const clientsSeed = makeRecords('clients', 1, 1);
    const sessionsSeed = makeRecords('sessions', 2, 1);
    const { fakeIDB, target, svc } = buildEnv(
      {
        cases: JSON.stringify(casesSeed),
        clients: JSON.stringify(clientsSeed),
        sessions: JSON.stringify(sessionsSeed)
      },
      { entityKeys: ['cases', 'clients', 'sessions'] }
    );
    await target.open();
    fakeIDB.injectStoreFailure(target._engine.getDatabaseName(), 'sessions', 'put', 'UnknownError', 'Simulated interruption.');
    await svc.migrate().catch(() => {});

    const resumeReport = await svc.migrate();
    assert.strictEqual(resumeReport.skipped, false);
    // Only the entity that had not yet finished should appear in THIS
    // call's report — "cases" and "clients" must not be re-processed.
    assert.deepStrictEqual(resumeReport.entities.map(e => e.entityKey), ['sessions']);
    assert.strictEqual(resumeReport.entities[0].status, 'migrated');

    const status = await svc.getStatus();
    assert.strictEqual(status.status, 'completed');
    const sessionsOut = await target.read('sessions');
    assert.strictEqual(sessionsOut.length, 2);
    assert.deepStrictEqual(sessionsOut.slice().sort((a, b) => a['رقم_الجلسة'] - b['رقم_الجلسة']), sessionsSeed);
    // cases/clients survived the whole interrupted-then-resumed run untouched.
    assert.deepStrictEqual(await target.read('cases'), casesSeed);
    assert.deepStrictEqual(await target.read('clients'), clientsSeed);
  });

  // ============================================================
  // 5. REPEATED / DOUBLE MIGRATION — calling migrate() again after
  //    a successful completion must be a safe no-op.
  // ============================================================
  await checkAsync('[Double migration] second call is skipped and touches no entity data', async () => {
    const { target, svc } = buildEnv({ cases: JSON.stringify(makeRecords('cases', 2, 1)) });
    await svc.migrate();
    const beforeSecond = await target.read('cases');

    const report2 = await svc.migrate();
    assert.strictEqual(report2.skipped, true);
    assert.strictEqual(report2.reason, 'already-completed');

    const afterSecond = await target.read('cases');
    assert.deepStrictEqual(afterSecond, beforeSecond);
  });

  await checkAsync('[Double migration] calling migrate() three times in a row never changes the record count', async () => {
    const { target, svc } = buildEnv({ cases: JSON.stringify(makeRecords('cases', 4, 1)) });
    await svc.migrate();
    await svc.migrate();
    await svc.migrate();
    const casesOut = await target.read('cases');
    assert.strictEqual(casesOut.length, 4);
  });

  await checkAsync('[Double migration] force:true re-runs every entity from scratch and still ends in the same state', async () => {
    const seed = makeRecords('clients', 3, 1);
    const { target, svc } = buildEnv({ clients: JSON.stringify(seed) });
    await svc.migrate();
    const forced = await svc.migrate({ force: true });
    assert.strictEqual(forced.skipped, false);
    assert.strictEqual(forced.entities.length, 14); // PHASE 31 (RBAC): 11 -> 14.
    const clientsOut = await target.read('clients');
    assert.strictEqual(clientsOut.length, 3);
    assert.strictEqual(uniqueCount(clientsOut, 'رقم_الموكل'), 3);
  });

  // ============================================================
  // 6. LARGE DATASET
  // ============================================================
  await checkAsync('[Large dataset] 4000 records for one entity migrate completely and correctly', async () => {
    const bigSeed = makeRecords('documents', 4000, 1);
    const { target, svc } = buildEnv({ documents: JSON.stringify(bigSeed) });
    const report = await svc.migrate();
    const docsEntry = report.entities.find(e => e.entityKey === 'documents');
    assert.strictEqual(docsEntry.sourceCount, 4000);
    assert.strictEqual(docsEntry.targetCountAfter, 4000);

    const docsOut = await target.read('documents');
    assert.strictEqual(docsOut.length, 4000);
    assert.strictEqual(uniqueCount(docsOut, 'رقم_المستند'), 4000);
  });

  await checkAsync('[Large dataset] large datasets across several entities simultaneously all migrate correctly', async () => {
    const { target, svc } = buildEnv({
      cases: JSON.stringify(makeRecords('cases', 1500, 1)),
      clients: JSON.stringify(makeRecords('clients', 1200, 1)),
      fees: JSON.stringify(makeRecords('fees', 2000, 1))
    });
    const report = await svc.migrate();
    assert.strictEqual(report.totalRecordsMigrated, 1500 + 1200 + 2000);
    assert.strictEqual((await target.read('cases')).length, 1500);
    assert.strictEqual((await target.read('clients')).length, 1200);
    assert.strictEqual((await target.read('fees')).length, 2000);
  });

  // ============================================================
  // 7. ATOMIC MIGRATION — a write that fails partway through must
  //    leave the target EXACTLY as it was before that write, never
  //    a mix of old and new records.
  // ============================================================
  await checkAsync('[Atomic migration] a mid-write failure leaves a previously-empty entity still empty (no partial records)', async () => {
    const { fakeIDB, target, svc } = buildEnv(
      { fees: JSON.stringify(makeRecords('fees', 5, 1)) },
      { entityKeys: ['fees'] }
    );
    await target.open();
    // Let put #1 and #2 succeed, fail put #3 of 5 — clear() already ran,
    // two records are already physically in the store when the failure
    // hits, so this actually exercises the rollback (not just "nothing
    // ever got written yet").
    fakeIDB.injectStoreFailure(target._engine.getDatabaseName(), 'fees', 'put', 'UnknownError', 'Simulated mid-write failure.', 2);
    await assert.rejects(() => svc.migrate());
    const feesOut = await target.read('fees');
    assert.deepStrictEqual(feesOut, [], 'a failed write must never leave partial records behind, even though 2 of 5 puts had already succeeded');
  });

  await checkAsync('[Atomic migration] a mid-write failure leaves a previously-populated entity exactly as it was (no old+new mix)', async () => {
    const original = makeRecords('fees', 3, 1);
    const incoming = makeRecords('fees', 5, 100);
    const { fakeIDB, target, svc } = buildEnv(
      { fees: JSON.stringify(incoming) },
      { entityKeys: ['fees'] }
    );
    await target.open();
    await target.write('fees', original);
    // Same "2 succeed, 3rd fails" targeting as above, against a store
    // that already held different real data before this write began.
    fakeIDB.injectStoreFailure(target._engine.getDatabaseName(), 'fees', 'put', 'UnknownError', 'Simulated mid-write failure.', 2);

    await assert.rejects(() => svc.migrate());
    const feesOut = await target.read('fees');
    assert.deepStrictEqual(
      feesOut.slice().sort((a, b) => a['رقم_العملية'] - b['رقم_العملية']),
      original,
      'target must still hold exactly its pre-migration data, not a mix of old and new records'
    );
  });

  await checkAsync('[Atomic migration] a successful write is still all-or-nothing (sanity control, no injected failure)', async () => {
    const seed = makeRecords('templates', 10, 1);
    const { target, svc } = buildEnv({ templates: JSON.stringify(seed) }, { entityKeys: ['templates'] });
    await svc.migrate();
    const out = await target.read('templates');
    assert.strictEqual(out.length, 10);
  });

  // ============================================================
  // 8. NO DUPLICATED RECORDS
  // ============================================================
  await checkAsync('[No duplicated records] fresh migration produces exactly one record per source record, no more', async () => {
    const seed = makeRecords('library', 250, 1);
    const { target, svc } = buildEnv({ library: JSON.stringify(seed) });
    await svc.migrate();
    const out = await target.read('library');
    assert.strictEqual(out.length, 250);
    assert.strictEqual(uniqueCount(out, 'id'), 250);
  });

  await checkAsync('[No duplicated records] resuming an interrupted migration never doubles the recovered entity\'s records', async () => {
    const sessionsSeed = makeRecords('sessions', 6, 1);
    const { fakeIDB, target, svc } = buildEnv(
      { sessions: JSON.stringify(sessionsSeed) },
      { entityKeys: ['sessions'] }
    );
    await target.open();
    fakeIDB.injectStoreFailure(target._engine.getDatabaseName(), 'sessions', 'put', 'UnknownError', 'Simulated interruption.');
    await svc.migrate().catch(() => {});
    await svc.migrate(); // resume

    const out = await target.read('sessions');
    assert.strictEqual(out.length, 6, 'resumed migration must not duplicate the recovered entity\'s records');
    assert.strictEqual(uniqueCount(out, 'رقم_الجلسة'), 6);
  });

  await checkAsync('[No duplicated records] repeated migrate() calls after completion never accumulate records', async () => {
    const seed = makeRecords('children', 40, 1);
    const { target, svc } = buildEnv({ children: JSON.stringify(seed) });
    for (let i = 0; i < 5; i++) { await svc.migrate(); }
    const out = await target.read('children');
    assert.strictEqual(out.length, 40);
    assert.strictEqual(uniqueCount(out, 'رقم_الطفل'), 40);
  });

  // ============================================================
  // Construction / defensive-shape checks (matches the discipline
  // every other core file's own harness applies to its constructor).
  // ============================================================
  check('MigrationService constructor rejects a non-adapter-shaped sourceAdapter', () => {
    assert.throws(() => new MigrationService({ sourceAdapter: {}, targetAdapter: buildEnv({}).target }));
  });
  check('MigrationService constructor rejects a non-adapter-shaped targetAdapter', () => {
    assert.throws(() => new MigrationService({ sourceAdapter: buildEnv({}).source, targetAdapter: {} }));
  });
  check('MigrationService defaults entityKeys to every schema store except "metadata"', () => {
    const { source, target } = buildEnv({});
    const svc = new MigrationService({ sourceAdapter: source, targetAdapter: target });
    assert.strictEqual(svc._entityKeys.indexOf('metadata'), -1);
    assert.strictEqual(svc._entityKeys.length, 14); // PHASE 31 (RBAC): 11 -> 14 (adds 'users', 'auditLog', 'loginLog').
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
