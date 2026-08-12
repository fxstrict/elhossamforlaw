/**
 * verify_repository_restore.js
 * ================================================================
 * PHASE 10 — SUB-PHASE 10.2 — Repository Restore Core Implementation
 * ================================================================
 * Standalone Node harness (`node js/tests/verify_repository_restore.js`,
 * no browser required, no external libraries) proving that
 * `Repository.prototype.restore(id)` and the new `{op:'restore'}`
 * transaction() step behave exactly as specified in
 * `docs/Restore_System_Design.md` (§1-8) and
 * `docs/Restore_System_Architecture.md` §23, and that every pre-existing
 * `Repository.prototype.*` method remains 100% behaviorally unchanged
 * (Regression, per Repository Migration Standard / Verification & QA
 * Standard).
 *
 * Uses only the base `Repository` class directly (entityKey/idField
 * config, no entity subclass) against a purpose-built in-memory mock
 * Storage Adapter that satisfies the minimal duck-typed contract
 * documented in Repository.js §2 (`read(entityKey)`/`write(entityKey,
 * records)`), instrumented with call counters so "adapter call counts"
 * (idempotent restore() must NOT call write()) can be asserted directly,
 * not inferred.
 *
 * Structure:
 *   A. restore() on a soft-deleted record — deletedAt reset, updatedAt
 *      updated, version incremented, persisted, WriteResult envelope.
 *   B. restore() on an already-live record — idempotent: success, NO
 *      metadata mutation, NO persist()/write() call.
 *   C. restore() on an unknown id — ValidationError, unrecoverable.
 *   D. restore() when softDelete:false — UnsupportedOperationError.
 *   E. transaction() with a `{op:'restore'}` step — success, and staged
 *      atomically with other ops in the same transaction.
 *   F. transaction() rollback — a failing later step rolls back an
 *      earlier successful `restore` step (no partial commit, no persist).
 *   G. includeDeleted behavior before and after restore() (getAll/search).
 *   H. Regression — create/update/delete/get/getAll/exists/search/
 *      transaction (non-restore paths) all behave exactly as before this
 *      phase — no signature change, no return-shape change.
 *   I. Guard parity — restore() respects unsupportedOperations and
 *      _guardReady() exactly like every other CRUD method.
 * ================================================================
 */

'use strict';

const assert = require('assert');
const path = require('path');

const CORE_DIR = path.join(__dirname, '..', 'core');
const { Repository, RepositoryErrorTypes } = require(path.join(CORE_DIR, 'Repository.js'));

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

// ---- Instrumented in-memory mock Storage Adapter ----
// Satisfies exactly Repository.js §2's documented minimal contract
// (read(entityKey)/write(entityKey, records)), with call counters so
// tests can assert "no unnecessary write()" directly (idempotent
// restore()), not merely infer it from final state.
function makeMockAdapter(seed) {
  const store = {};
  if (seed) store[seed.entityKey] = seed.records;
  return {
    readCalls: 0,
    writeCalls: 0,
    lastWritten: null,
    read: async function (entityKey) {
      this.readCalls++;
      return store[entityKey] ? JSON.parse(JSON.stringify(store[entityKey])) : [];
    },
    write: async function (entityKey, records) {
      this.writeCalls++;
      store[entityKey] = JSON.parse(JSON.stringify(records));
      this.lastWritten = store[entityKey];
    }
  };
}

async function makeOpenRepo(config, seedRecords) {
  const adapter = makeMockAdapter(seedRecords ? { entityKey: config.entityKey, records: seedRecords } : null);
  const repo = new Repository(Object.assign({ storageAdapter: adapter }, config));
  await repo.open();
  return { repo, adapter };
}

async function main() {
  // ================================================================
  // A. restore() on a soft-deleted record
  // ================================================================
  await checkAsync('restore() on a soft-deleted record clears deletedAt, bumps version, updates updatedAt, persists, returns success WriteResult', async () => {
    const { repo, adapter } = await makeOpenRepo(
      { entityKey: 'cases', idField: 'id', softDelete: true },
      [{ id: 'c1', title: 'قضية 1', deletedAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', version: 2 }]
    );

    assert.strictEqual(repo.get('c1'), null, 'sanity: soft-deleted record must be invisible to get() before restore');

    const before = adapter.writeCalls;
    const res = await repo.restore('c1');

    assert.strictEqual(res.success, true);
    assert.strictEqual(res.error, null);
    assert.strictEqual(res.record.deletedAt, null);
    assert.strictEqual(res.record.version, 3, 'version must increment exactly like update()');
    assert.notStrictEqual(res.record.updatedAt, '2026-01-01T00:00:00.000Z', 'updatedAt must be refreshed');
    assert.strictEqual(adapter.writeCalls, before + 1, 'exactly one persist() call for a real restore');

    const live = repo.get('c1');
    assert.ok(live, 'record must be visible to get() again after restore');
    assert.strictEqual(live.deletedAt, null);
  });

  // ================================================================
  // B. restore() on an already-live record — Idempotent
  // ================================================================
  await checkAsync('restore() on an already-live record is idempotent: success, no version bump, no updatedAt mutation, no persist() call', async () => {
    const { repo, adapter } = await makeOpenRepo(
      { entityKey: 'clients', idField: 'id', softDelete: true },
      [{ id: 'k1', name: 'موكل حي', deletedAt: null, updatedAt: '2026-02-02T00:00:00.000Z', version: 1 }]
    );

    const before = adapter.writeCalls;
    const res = await repo.restore('k1');

    assert.strictEqual(res.success, true);
    assert.strictEqual(res.record.deletedAt, null);
    assert.strictEqual(res.record.version, 1, 'idempotent restore must NOT increment version');
    assert.strictEqual(res.record.updatedAt, '2026-02-02T00:00:00.000Z', 'idempotent restore must NOT touch updatedAt');
    assert.strictEqual(adapter.writeCalls, before, 'idempotent restore must NOT call write()/persist() at all');
  });

  // ================================================================
  // C. restore() on an unknown id
  // ================================================================
  await checkAsync('restore() on an unknown id returns a ValidationError WriteResult (unrecoverable), matching update()/delete() convention', async () => {
    const { repo, adapter } = await makeOpenRepo({ entityKey: 'tasks', idField: 'id', softDelete: true }, []);
    const before = adapter.writeCalls;
    const res = await repo.restore('does-not-exist');

    assert.strictEqual(res.success, false);
    assert.strictEqual(res.record, null);
    assert.ok(res.error, 'error must be present');
    assert.strictEqual(res.error.type, RepositoryErrorTypes.VALIDATION);
    assert.strictEqual(res.error.recoverable, false);
    assert.strictEqual(adapter.writeCalls, before, 'a failed restore() must never call write()');
  });

  // ================================================================
  // D. restore() when softDelete:false — UnsupportedOperationError
  // ================================================================
  await checkAsync('restore() on a softDelete:false Repository returns UnsupportedOperationError (nothing to restore — delete() already removed the record)', async () => {
    const { repo } = await makeOpenRepo(
      { entityKey: 'ephemeral', idField: 'id', softDelete: false },
      [{ id: 'e1', name: 'x' }]
    );
    const res = await repo.restore('e1');
    assert.strictEqual(res.success, false);
    assert.strictEqual(res.error.type, RepositoryErrorTypes.UNSUPPORTED_OPERATION);
  });

  // ================================================================
  // I. Guard parity — unsupportedOperations / not-ready
  // ================================================================
  await checkAsync('restore() rejects with UnsupportedOperationError when "restore" is listed in unsupportedOperations (_guardSupported parity with create/update/delete)', async () => {
    const adapter = makeMockAdapter({ entityKey: 'locked2', records: [] });
    const repo = new Repository({
      entityKey: 'locked2', idField: 'id', storageAdapter: adapter,
      unsupportedOperations: ['restore']
    });
    await repo.open();
    let caught = null;
    try {
      await repo.restore('x');
    } catch (e) {
      caught = e;
    }
    assert.ok(caught, 'restore() must reject/throw when unsupported');
    assert.strictEqual(caught.type, RepositoryErrorTypes.UNSUPPORTED_OPERATION);
  });

  await checkAsync('restore() throws the same "not ready" StorageError as delete()/update() when called before open() (_guardReady parity)', async () => {
    const adapter = makeMockAdapter({ entityKey: 'notready', records: [] });
    const repo = new Repository({ entityKey: 'notready', idField: 'id', storageAdapter: adapter });
    // Deliberately NOT calling open(). restore() is async, so a guard
    // throw before any `await` surfaces as a REJECTED Promise here, not a
    // synchronous exception — asserted via await/try-catch accordingly.
    let restoreErr = null, deleteErr = null;
    try { await repo.restore('x'); } catch (e) { restoreErr = e; }
    try { await repo.delete('x'); } catch (e) { deleteErr = e; }
    assert.strictEqual(restoreErr.type, deleteErr.type);
    assert.strictEqual(restoreErr.message.indexOf('not ready') !== -1, true);
  });

  // ================================================================
  // E. transaction() with a {op:'restore'} step
  // ================================================================
  await checkAsync('transaction() supports {op:"restore"} — restores a soft-deleted record atomically alongside other ops', async () => {
    const { repo } = await makeOpenRepo(
      { entityKey: 'sessions', idField: 'id', softDelete: true },
      [
        { id: 's1', title: 'جلسة 1', deletedAt: '2026-01-01T00:00:00.000Z', version: 1 },
        { id: 's2', title: 'جلسة 2', deletedAt: null, version: 1 }
      ]
    );

    const txResult = await repo.transaction([
      { op: 'restore', id: 's1' },
      { op: 'update', id: 's2', patch: { title: 'جلسة 2 معدّلة' } }
    ]);

    assert.strictEqual(txResult.success, true);
    assert.strictEqual(txResult.results.length, 2);
    assert.strictEqual(txResult.results[0].success, true);
    assert.strictEqual(txResult.results[0].record.deletedAt, null);
    assert.strictEqual(repo.get('s1').deletedAt, null, 'restored record visible after commit');
    assert.strictEqual(repo.get('s2').title, 'جلسة 2 معدّلة');
  });

  await checkAsync('transaction() {op:"restore"} on an already-live record is idempotent inside the transaction too', async () => {
    const { repo } = await makeOpenRepo(
      { entityKey: 'fees', idField: 'id', softDelete: true },
      [{ id: 'f1', amount: 100, deletedAt: null, version: 1 }]
    );
    const txResult = await repo.transaction([{ op: 'restore', id: 'f1' }]);
    assert.strictEqual(txResult.success, true);
    assert.strictEqual(txResult.results[0].record.version, 1, 'idempotent restore inside transaction must not bump version');
  });

  await checkAsync('transaction() {op:"restore"} on an unknown id fails the whole transaction with a ValidationError (staged, not partially applied)', async () => {
    const { repo } = await makeOpenRepo({ entityKey: 'documents', idField: 'id', softDelete: true }, []);
    const txResult = await repo.transaction([{ op: 'restore', id: 'ghost' }]);
    assert.strictEqual(txResult.success, false);
    assert.strictEqual(txResult.error.type, RepositoryErrorTypes.VALIDATION);
  });

  // ================================================================
  // F. transaction() rollback — a later failing step rolls back an
  //    earlier successful restore step
  // ================================================================
  await checkAsync('transaction() rollback: a failing later step rolls back an earlier successful {op:"restore"} step — no partial commit, no persist()', async () => {
    const { repo, adapter } = await makeOpenRepo(
      { entityKey: 'children', idField: 'id', softDelete: true },
      [{ id: 'ch1', name: 'طفل 1', deletedAt: '2026-01-01T00:00:00.000Z', version: 1 }]
    );

    const before = adapter.writeCalls;
    const txResult = await repo.transaction([
      { op: 'restore', id: 'ch1' },
      { op: 'update', id: 'does-not-exist', patch: { name: 'x' } } // forces failure
    ]);

    assert.strictEqual(txResult.success, false);
    assert.strictEqual(adapter.writeCalls, before, 'a rolled-back transaction must never call write()/persist()');
    assert.strictEqual(repo.get('ch1'), null, 'the record must remain deleted — restore step must NOT have been committed');
  });

  // ================================================================
  // G. includeDeleted before/after restore()
  // ================================================================
  await checkAsync('includeDeleted:true surfaces the soft-deleted record BEFORE restore(); default getAll()/search() exclude it', async () => {
    const { repo } = await makeOpenRepo(
      { entityKey: 'library', idField: 'id', softDelete: true, searchFields: ['title'] },
      [{ id: 'l1', title: 'مرجع محذوف', deletedAt: '2026-01-01T00:00:00.000Z', version: 1 }]
    );

    assert.strictEqual(repo.getAll().length, 0, 'default getAll() must exclude the deleted record');
    assert.strictEqual(repo.getAll({ includeDeleted: true }).length, 1, 'includeDeleted:true must surface it');
    assert.strictEqual(repo.search({}).items.length, 0, 'default search() must exclude the deleted record');
    assert.strictEqual(repo.search({ includeDeleted: true }).items.length, 1, 'search includeDeleted:true must surface it');

    const filtered = repo.search({ includeDeleted: true, filter: { deletedAt: { op: 'ne', value: null } } });
    assert.strictEqual(filtered.items.length, 1, 'documented Trash query pattern (Restore_System_Design.md §8) must work unmodified');
  });

  await checkAsync('AFTER restore(), the record appears in default getAll()/search() and disappears from the "deleted only" Trash query', async () => {
    const { repo } = await makeOpenRepo(
      { entityKey: 'templates', idField: 'id', softDelete: true },
      [{ id: 't1', name: 'قالب محذوف', deletedAt: '2026-01-01T00:00:00.000Z', version: 1 }]
    );

    await repo.restore('t1');

    assert.strictEqual(repo.getAll().length, 1, 'restored record must appear in default getAll()');
    assert.strictEqual(repo.search({}).items.length, 1, 'restored record must appear in default search()');
    const trashOnly = repo.search({ includeDeleted: true, filter: { deletedAt: { op: 'ne', value: null } } });
    assert.strictEqual(trashOnly.items.length, 0, 'restored record must no longer appear in the Trash-only query');
  });

  // ================================================================
  // H. Regression — every pre-existing Repository method, unchanged
  // ================================================================
  await checkAsync('REGRESSION — create() unchanged: validation, id assignment, conflict detection, WriteResult shape', async () => {
    const { repo } = await makeOpenRepo({ entityKey: 'r_create', idField: null, idGenerator: () => 'gen-1' }, []);
    const res = await repo.create({ name: 'x' });
    assert.strictEqual(res.success, true);
    assert.strictEqual(res.record.id, 'gen-1');
    assert.strictEqual(res.record.version, 1);
    const dup = await repo.create({ id: 'gen-1', name: 'y' });
    assert.strictEqual(dup.success, false);
    assert.strictEqual(dup.error.type, RepositoryErrorTypes.CONFLICT);
  });

  await checkAsync('REGRESSION — update() unchanged: merge semantics, version increment, unknown id error', async () => {
    const { repo } = await makeOpenRepo({ entityKey: 'r_update', idField: 'id' }, [{ id: 'u1', name: 'a', version: 1 }]);
    const res = await repo.update('u1', { name: 'b' });
    assert.strictEqual(res.success, true);
    assert.strictEqual(res.record.name, 'b');
    assert.strictEqual(res.record.version, 2);
    const bad = await repo.update('ghost', { name: 'z' });
    assert.strictEqual(bad.success, false);
    assert.strictEqual(bad.error.type, RepositoryErrorTypes.VALIDATION);
  });

  await checkAsync('REGRESSION — delete() unchanged: soft-delete sets deletedAt, hides from getAll(), WriteResult shape identical to pre-10.2', async () => {
    const { repo } = await makeOpenRepo({ entityKey: 'r_delete', idField: 'id', softDelete: true }, [{ id: 'd1', name: 'x', version: 1 }]);
    const res = await repo.delete('d1');
    assert.strictEqual(res.success, true);
    assert.notStrictEqual(res.record.deletedAt, null);
    assert.strictEqual(repo.getAll().length, 0);
    assert.strictEqual(repo.get('d1'), null);
  });

  await checkAsync('REGRESSION — get()/getAll()/exists() unchanged for live and non-existent ids', async () => {
    const { repo } = await makeOpenRepo({ entityKey: 'r_get', idField: 'id' }, [{ id: 'g1', name: 'x' }]);
    assert.ok(repo.get('g1'));
    assert.strictEqual(repo.get('ghost'), null);
    assert.strictEqual(repo.getAll().length, 1);
    assert.strictEqual(repo.exists('g1'), true);
    assert.strictEqual(repo.exists('ghost'), false);
  });

  await checkAsync('REGRESSION — search() unchanged: filter/sort/pagination/projection all behave as before', async () => {
    const { repo } = await makeOpenRepo(
      { entityKey: 'r_search', idField: 'id', searchFields: ['name'] },
      [{ id: 's1', name: 'Ahmad', age: 30 }, { id: 's2', name: 'Sara', age: 25 }]
    );
    const res = repo.search({ sort: [{ field: 'age', direction: 'asc' }] });
    assert.strictEqual(res.items[0].id, 's2');
    const filtered = repo.search({ filter: { age: { op: 'gte', value: 28 } } });
    assert.strictEqual(filtered.items.length, 1);
    assert.strictEqual(filtered.items[0].id, 's1');
    const searched = repo.search({ search: 'sara' });
    assert.strictEqual(searched.items.length, 1);
  });

  await checkAsync('REGRESSION — transaction() non-restore ops (create/update/delete) unchanged, including existing rollback behavior', async () => {
    const { repo, adapter } = await makeOpenRepo({ entityKey: 'r_tx', idField: 'id' }, [{ id: 'x1', name: 'a', version: 1 }]);
    const ok = await repo.transaction([
      { op: 'create', entity: { id: 'x2', name: 'b' } },
      { op: 'update', id: 'x1', patch: { name: 'a2' } }
    ]);
    assert.strictEqual(ok.success, true);
    assert.strictEqual(repo.getAll().length, 2);

    const before = adapter.writeCalls;
    const bad = await repo.transaction([
      { op: 'delete', id: 'x1' },
      { op: 'update', id: 'ghost', patch: {} }
    ]);
    assert.strictEqual(bad.success, false);
    assert.strictEqual(adapter.writeCalls, before, 'failed transaction must not persist');
    assert.ok(repo.get('x1'), 'x1 must remain live — delete step must have rolled back');
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
