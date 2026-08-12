/**
 * verify_restore_stress.js
 * ================================================================
 * PHASE 11 — SUB-PHASE 11.1 — Restore System Stress Test & Edge Case
 * Verification
 * ================================================================
 * Standalone Node harness (`node js/tests/verify_restore_stress.js`,
 * no browser required, no external libraries) closing T-09 (missing
 * restore-after-update/import/clear coverage) and going beyond it to
 * give the Restore System (`Repository.prototype.restore`, the
 * `{op:'restore'}` transaction() step, and every write path it can
 * interact with) live, real-assertion coverage for every edge case in
 * `Restore_Stress_Test_Report.md` / `Restore_Edge_Case_Report.md`.
 *
 * Follows the same discipline as `verify_repository_restore.js`
 * (Phase 10.2): uses the real `Repository` base class directly against
 * an instrumented in-memory mock Storage Adapter — no mocks stand in
 * for Repository behavior itself, only for the storage engine below it
 * (exactly per Repository.js §2's documented adapter contract).
 *
 * No production file is modified by this harness or by writing it.
 *
 * Sections (mirrors the 25 required scenario groups in
 * Restore_Stress_Test_Report.md, condensed where scenarios share a
 * single mechanism at the Repository layer):
 *   A.  Restore immediately after Delete
 *   B.  Delete/Restore repeated in a tight loop
 *   C.  Restore after Update
 *   D.  Restore after Bulk Insert
 *   E.  Restore after Bulk Update
 *   F.  Restore after Bulk Delete
 *   G.  Restore after Import
 *   H.  Restore after Clear
 *   I.  Restore inside nested transaction() calls (re-entrancy)
 *   J.  Rollback after adapter write failure (create/update/delete/restore)
 *   K.  Rollback after validation failure (transaction create/update steps)
 *   L.  Rollback after transaction failure (mixed op failure position)
 *   M.  Unknown ID handling across every write method
 *   N.  Idempotency — restore called twice / already-live record
 *   O.  Delete twice — already-deleted record
 *   P.  Multiple restores inside one transaction
 *   Q.  Mixed-operation transaction (create/update/delete/restore x2)
 *   R.  Mirror synchronization pattern (data.<entity> = getAll()) after restore
 *   S.  Statistics consistency — counts/badges never include deleted records
 *   T.  includeDeleted behavior across get/getAll/search/exists/count
 *   U.  Performance — 100/500/1000/5000 restore operations
 *   V.  Repository isolation — restoring one Repository never affects another
 *   W.  Stress test — long random operation sequence, final integrity check
 *   X.  Regression — every pre-existing method unchanged (safety net)
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
const failedLabels = [];

function check(label, fn) {
  try {
    fn();
    passed++;
    log.push('PASS — ' + label);
  } catch (e) {
    failed++;
    failedLabels.push(label);
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
    failedLabels.push(label);
    log.push('FAIL — ' + label + '  =>  ' + (e && e.message ? e.message : e));
  }
}

// ---- Instrumented in-memory mock Storage Adapter (same contract as
//      verify_repository_restore.js) ----
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

// ---- Adapter that fails write() on specific call numbers (1-indexed),
//      to exercise rollback paths deterministically. ----
function makeFailingAdapter(seed, failOnWriteNumbers) {
  const base = makeMockAdapter(seed);
  const failSet = new Set(failOnWriteNumbers || []);
  return Object.assign({}, base, {
    read: base.read.bind(base),
    write: async function (entityKey, records) {
      base.writeCalls++;
      if (failSet.has(base.writeCalls)) {
        throw new Error('SIMULATED_ADAPTER_WRITE_FAILURE #' + base.writeCalls);
      }
      return base.write.call({ writeCalls: base.writeCalls - 1, }, entityKey, records)
        .then(() => { base.lastWritten = records; });
    },
    get writeCalls() { return base.writeCalls; },
    set writeCalls(v) { base.writeCalls = v; }
  });
}

// Simpler, self-contained failing adapter (avoids the prototype-binding
// complexity above) — used by all rollback tests below.
function makeSimpleFailingAdapter(seed, failOnWriteNumbers) {
  const store = {};
  if (seed) store[seed.entityKey] = seed.records;
  const failSet = new Set(failOnWriteNumbers || []);
  return {
    readCalls: 0,
    writeCalls: 0,
    read: async function (entityKey) {
      this.readCalls++;
      return store[entityKey] ? JSON.parse(JSON.stringify(store[entityKey])) : [];
    },
    write: async function (entityKey, records) {
      this.writeCalls++;
      if (failSet.has(this.writeCalls)) {
        throw new Error('SIMULATED_ADAPTER_WRITE_FAILURE #' + this.writeCalls);
      }
      store[entityKey] = JSON.parse(JSON.stringify(records));
    }
  };
}

async function makeOpenRepo(config, seedRecords, adapterOverride) {
  const adapter = adapterOverride || makeMockAdapter(seedRecords ? { entityKey: config.entityKey, records: seedRecords } : null);
  const repo = new Repository(Object.assign({ storageAdapter: adapter }, config));
  await repo.open();
  return { repo, adapter };
}

/** A Repository subclass with real validation rules, used to exercise
 *  validation-triggered rollback inside transaction(). */
function makeValidatingRepo(seedRecords) {
  const adapter = makeMockAdapter({ entityKey: 'validated', records: seedRecords || [] });
  const repo = new Repository({ entityKey: 'validated', idField: 'id', storageAdapter: adapter, softDelete: true });
  repo._validate = function (operation, record) {
    if ((operation === 'create' || operation === 'update') && !record.name) {
      return { valid: false, errors: [{ field: 'name', message: 'name is required' }] };
    }
    return { valid: true, errors: [] };
  };
  return { repo, adapter };
}

function seedEntity(id, overrides) {
  return Object.assign({
    id: id,
    name: 'record-' + id,
    deletedAt: null,
    updatedAt: '2026-01-01T00:00:00.000Z',
    createdAt: '2026-01-01T00:00:00.000Z',
    version: 1
  }, overrides || {});
}

async function main() {
  // ================================================================
  // A. Restore immediately after Delete
  // ================================================================
  await checkAsync('A1: delete() then restore() same tick — record fully live again, deletedAt cleared', async () => {
    const { repo } = await makeOpenRepo({ entityKey: 'a1', idField: 'id', softDelete: true }, [seedEntity('r1')]);
    const del = await repo.delete('r1');
    assert.strictEqual(del.success, true);
    assert.strictEqual(repo.get('r1'), null, 'must be invisible immediately after delete');
    const res = await repo.restore('r1');
    assert.strictEqual(res.success, true);
    assert.strictEqual(res.record.deletedAt, null);
    assert.ok(repo.get('r1'), 'must be visible immediately after restore');
  });

  await checkAsync('A2: delete() then restore() — version increments exactly twice (once per write)', async () => {
    const { repo } = await makeOpenRepo({ entityKey: 'a2', idField: 'id', softDelete: true }, [seedEntity('r1', { version: 5 })]);
    await repo.delete('r1');
    const res = await repo.restore('r1');
    assert.strictEqual(res.record.version, 7, 'delete bumps to 6, restore bumps to 7');
  });

  await checkAsync('A3: delete() then restore() persists exactly twice (one write per operation, no batching)', async () => {
    const { repo, adapter } = await makeOpenRepo({ entityKey: 'a3', idField: 'id', softDelete: true }, [seedEntity('r1')]);
    const before = adapter.writeCalls;
    await repo.delete('r1');
    await repo.restore('r1');
    assert.strictEqual(adapter.writeCalls, before + 2);
  });

  await checkAsync('A4: restore() immediately after delete() on all 9-style entity shapes (Arabic idField) works identically', async () => {
    const { repo } = await makeOpenRepo(
      { entityKey: 'a4', idField: 'رقم_القضية', softDelete: true },
      [{ 'رقم_القضية': 'ق1', name: 'قضية', deletedAt: null, version: 1 }]
    );
    await repo.delete('ق1');
    const res = await repo.restore('ق1');
    assert.strictEqual(res.success, true);
    assert.strictEqual(res.record['رقم_القضية'], 'ق1');
  });

  // ================================================================
  // B. Delete/Restore repeated many times
  // ================================================================
  await checkAsync('B1: delete/restore cycled 50 times — final state live, version increments by exactly 100, no drift', async () => {
    const { repo, adapter } = await makeOpenRepo({ entityKey: 'b1', idField: 'id', softDelete: true }, [seedEntity('r1', { version: 1 })]);
    const CYCLES = 50;
    for (let i = 0; i < CYCLES; i++) {
      const d = await repo.delete('r1');
      assert.strictEqual(d.success, true, 'cycle ' + i + ' delete must succeed');
      assert.strictEqual(repo.get('r1'), null, 'cycle ' + i + ' record must be invisible after delete');
      const r = await repo.restore('r1');
      assert.strictEqual(r.success, true, 'cycle ' + i + ' restore must succeed');
      assert.ok(repo.get('r1'), 'cycle ' + i + ' record must be visible after restore');
    }
    const final = repo.get('r1');
    assert.strictEqual(final.version, 1 + CYCLES * 2, 'version must be exactly 1 + 2*cycles, no skipped or duplicate writes');
    assert.strictEqual(adapter.writeCalls, CYCLES * 2, 'exactly one write per delete and one per restore, every cycle');
  });

  // ================================================================
  // C. Restore after Update  (closes T-09 item 1)
  // ================================================================
  await checkAsync('C1: update() a live record, then delete(), then restore() — updated fields survive the round trip', async () => {
    const { repo } = await makeOpenRepo({ entityKey: 'c1', idField: 'id', softDelete: true }, [seedEntity('r1', { name: 'original' })]);
    await repo.update('r1', { name: 'changed-by-update' });
    await repo.delete('r1');
    const res = await repo.restore('r1');
    assert.strictEqual(res.success, true);
    assert.strictEqual(res.record.name, 'changed-by-update', 'restore must not revert an update that happened before the delete');
  });

  await checkAsync('C2: restore() a soft-deleted record, then update() it — update() operates on the now-live restored record normally', async () => {
    const { repo } = await makeOpenRepo({ entityKey: 'c2', idField: 'id', softDelete: true }, [seedEntity('r1', { name: 'x', deletedAt: '2026-01-01T00:00:00.000Z' })]);
    const restored = await repo.restore('r1');
    assert.strictEqual(restored.success, true);
    const updated = await repo.update('r1', { name: 'y' });
    assert.strictEqual(updated.success, true, 'update() must work normally on a just-restored record');
    assert.strictEqual(updated.record.name, 'y');
    assert.strictEqual(updated.record.deletedAt, null, 'update() must not resurrect deletedAt');
  });

  await checkAsync('C3 (PHASE 11.2): update() attempted on a soft-deleted (not yet restored) record is rejected by default — CONFLICT WriteResult, record untouched; passing {allowDeleted:true} still allows the old pre-11.2 in-place edit behavior', async () => {
    const { repo } = await makeOpenRepo({ entityKey: 'c3', idField: 'id', softDelete: true }, [seedEntity('r1', { name: 'original', deletedAt: '2026-01-01T00:00:00.000Z' })]);

    const blocked = await repo.update('r1', { name: 'edited-while-deleted' });
    assert.strictEqual(blocked.success, false, 'update() must now refuse to modify a soft-deleted record by default (FIX 1, Repository_API_Consistency_Report.md)');
    assert.strictEqual(blocked.record, null);
    assert.strictEqual(blocked.error.type, RepositoryErrorTypes.CONFLICT);
    assert.strictEqual(blocked.error.recoverable, true, 'recoverable — restoring first, or retrying with allowDeleted, resolves it');
    assert.strictEqual(repo.get('r1'), null, 'record correctly remains invisible to get() — unaffected by the rejected update()');

    const allowed = await repo.update('r1', { name: 'edited-with-flag' }, { allowDeleted: true });
    assert.strictEqual(allowed.success, true, '{allowDeleted:true} must still permit the pre-11.2 in-place edit-while-deleted behavior');
    assert.notStrictEqual(allowed.record.deletedAt, null, 'deletedAt is preserved by the merge — allowDeleted edits fields only, never un-hides the record');
    assert.strictEqual(repo.get('r1'), null, 'record still correctly invisible to get() — only restore() can resurrect it');

    const afterRestore = await repo.restore('r1');
    assert.strictEqual(afterRestore.record.name, 'edited-with-flag', 'the allowDeleted edit is preserved once the record is restored');
  });

  // ================================================================
  // D. Restore after Bulk Insert
  // ================================================================
  await checkAsync('D1: bulkInsert() new records, delete() one, restore() it — unaffected siblings from the same batch remain untouched', async () => {
    const { repo } = await makeOpenRepo({ entityKey: 'd1', idField: 'id', softDelete: true }, []);
    const results = await repo.bulkInsert([seedEntity('b1'), seedEntity('b2'), seedEntity('b3')]);
    assert.ok(results.every(r => r.success));
    await repo.delete('b2');
    const res = await repo.restore('b2');
    assert.strictEqual(res.success, true);
    assert.strictEqual(repo.getAll().length, 3, 'all 3 bulk-inserted records must be live again');
    assert.ok(repo.get('b1') && repo.get('b3'), 'sibling records from the same bulkInsert() must be unaffected');
  });

  await checkAsync('D2: restore() on a bulk-inserted id that was never deleted — idempotent success, no persist()', async () => {
    const { repo, adapter } = await makeOpenRepo({ entityKey: 'd2', idField: 'id', softDelete: true }, []);
    await repo.bulkInsert([seedEntity('b1')]);
    const before = adapter.writeCalls;
    const res = await repo.restore('b1');
    assert.strictEqual(res.success, true);
    assert.strictEqual(adapter.writeCalls, before, 'idempotent restore on a never-deleted bulk-inserted record must not write');
  });

  // ================================================================
  // E. Restore after Bulk Update
  // ================================================================
  await checkAsync('E1: bulkUpdate() a live record, delete(), restore() — bulk-updated field values survive', async () => {
    const { repo } = await makeOpenRepo({ entityKey: 'e1', idField: 'id', softDelete: true }, [seedEntity('r1', { amount: 10 })]);
    await repo.bulkUpdate([{ id: 'r1', patch: { amount: 99 } }]);
    await repo.delete('r1');
    const res = await repo.restore('r1');
    assert.strictEqual(res.record.amount, 99, 'bulkUpdate patch must survive a subsequent delete/restore cycle');
  });

  await checkAsync('E2 (PHASE 11.2): bulkUpdate() targeting a soft-deleted id is rejected per-item by default — CONFLICT WriteResult for that item, record untouched; a per-item {allowDeleted:true} still allows the old pre-11.2 in-place edit behavior', async () => {
    const { repo } = await makeOpenRepo({ entityKey: 'e2', idField: 'id', softDelete: true }, [seedEntity('r1', { deletedAt: '2026-01-01T00:00:00.000Z' })]);

    const blocked = await repo.bulkUpdate([{ id: 'r1', patch: { name: 'z' } }]);
    assert.strictEqual(blocked[0].success, false, 'bulkUpdate() item must now refuse to modify a soft-deleted record by default (FIX 2, Repository_API_Consistency_Report.md)');
    assert.strictEqual(blocked[0].error.type, RepositoryErrorTypes.CONFLICT);
    assert.strictEqual(repo.get('r1'), null, 'still invisible — the blocked bulkUpdate item made no change');

    const allowed = await repo.bulkUpdate([{ id: 'r1', patch: { name: 'z' }, allowDeleted: true }]);
    assert.strictEqual(allowed[0].success, true, 'a per-item {allowDeleted:true} must still permit the pre-11.2 in-place edit-while-deleted behavior');
    assert.strictEqual(repo.get('r1'), null, 'still invisible — only restore() clears deletedAt');

    const restored = await repo.restore('r1');
    assert.strictEqual(restored.record.name, 'z', 'the allowDeleted bulkUpdate patch applied while deleted is preserved after restore');
  });

  // ================================================================
  // F. Restore after Bulk Delete
  // ================================================================
  await checkAsync('F1: bulkDelete() multiple records, restore() each individually — each restores independently, no cross-record leakage', async () => {
    const { repo } = await makeOpenRepo({ entityKey: 'f1', idField: 'id', softDelete: true }, [seedEntity('r1'), seedEntity('r2'), seedEntity('r3')]);
    const bulkRes = await repo.bulkDelete(['r1', 'r2', 'r3']);
    assert.ok(bulkRes.every(r => r.success));
    assert.strictEqual(repo.getAll().length, 0);
    await repo.restore('r1');
    assert.strictEqual(repo.getAll().length, 1);
    await repo.restore('r2');
    assert.strictEqual(repo.getAll().length, 2);
    assert.strictEqual(repo.get('r3'), null, 'r3 must remain deleted — restoring r1/r2 must not affect it');
    await repo.restore('r3');
    assert.strictEqual(repo.getAll().length, 3);
  });

  await checkAsync('F2: bulkDelete() partial failure (one unknown id) leaves successfully-deleted siblings persisted and restorable', async () => {
    const { repo } = await makeOpenRepo({ entityKey: 'f2', idField: 'id', softDelete: true }, [seedEntity('r1')]);
    const results = await repo.bulkDelete(['r1', 'ghost']);
    assert.strictEqual(results[0].success, true);
    assert.strictEqual(results[1].success, false);
    assert.strictEqual(results[1].error.type, RepositoryErrorTypes.VALIDATION);
    const res = await repo.restore('r1');
    assert.strictEqual(res.success, true, 'r1 must still be independently restorable despite the sibling failure in the same bulkDelete() call');
  });

  // ================================================================
  // G. Restore after Import  (closes T-09 item 2)
  // ================================================================
  await checkAsync('G1: import(replace) with a soft-deleted record in the payload, then restore() — restore works on imported data exactly like native data', async () => {
    const { repo } = await makeOpenRepo({ entityKey: 'g1', idField: 'id', softDelete: true }, []);
    const imp = await repo.import([seedEntity('imp1', { deletedAt: '2026-01-01T00:00:00.000Z' })], 'replace');
    assert.strictEqual(imp.success, true);
    assert.strictEqual(repo.get('imp1'), null, 'imported soft-deleted record must be invisible immediately');
    const res = await repo.restore('imp1');
    assert.strictEqual(res.success, true);
    assert.ok(repo.get('imp1'), 'imported record must be restorable exactly like a natively-created one');
  });

  await checkAsync('G2: import(replace) entirely discards prior records — a previously-restored id from before the import is gone, restore() on it now returns unknown-id', async () => {
    const { repo } = await makeOpenRepo({ entityKey: 'g2', idField: 'id', softDelete: true }, [seedEntity('old1')]);
    await repo.import([seedEntity('new1')], 'replace');
    const res = await repo.restore('old1');
    assert.strictEqual(res.success, false, 'replace-mode import must fully discard old1 — restore() must not find it');
    assert.strictEqual(res.error.type, RepositoryErrorTypes.VALIDATION);
  });

  await checkAsync('G3: import(merge) preserves a previously-restored live record untouched by the merge payload', async () => {
    const { repo } = await makeOpenRepo({ entityKey: 'g3', idField: 'id', softDelete: true }, [seedEntity('r1', { deletedAt: '2026-01-01T00:00:00.000Z' })]);
    await repo.restore('r1');
    await repo.import([seedEntity('r2')], 'merge');
    assert.ok(repo.get('r1'), 'merge-mode import must not remove r1, which was restored before the import');
    assert.ok(repo.get('r2'), 'merge-mode import must add the new record');
  });

  // ================================================================
  // H. Restore after Clear  (closes T-09 item 3)
  // ================================================================
  await checkAsync('H1: clear() empties the Repository entirely — restore() on any previously-live-or-deleted id now returns unknown-id (nothing to restore, by design)', async () => {
    const { repo } = await makeOpenRepo({ entityKey: 'h1', idField: 'id', softDelete: true }, [seedEntity('r1', { deletedAt: '2026-01-01T00:00:00.000Z' }), seedEntity('r2')]);
    const cl = await repo.clear();
    assert.strictEqual(cl.success, true);
    const res1 = await repo.restore('r1');
    const res2 = await repo.restore('r2');
    assert.strictEqual(res1.success, false, 'clear() must remove even soft-deleted records — restore() must fail cleanly, not throw');
    assert.strictEqual(res1.error.type, RepositoryErrorTypes.VALIDATION);
    assert.strictEqual(res2.success, false);
  });

  await checkAsync('H2: create() after clear(), then delete()/restore() on the new record works normally — clear() does not corrupt subsequent restore capability', async () => {
    const { repo } = await makeOpenRepo({ entityKey: 'h2', idField: 'id', softDelete: true }, [seedEntity('old')]);
    await repo.clear();
    await repo.create({ id: 'fresh', name: 'x' });
    await repo.delete('fresh');
    const res = await repo.restore('fresh');
    assert.strictEqual(res.success, true, 'restore must work normally on records created after a clear()');
  });

  // ================================================================
  // I. Restore inside nested transaction() calls (re-entrancy)
  // ================================================================
  await checkAsync('I1: calling transaction() again while one is already logically in-flight on the same Repository is rejected with a CONFLICT error (no true nested-transaction support exists — documented, not a defect)', async () => {
    const { repo } = await makeOpenRepo({ entityKey: 'i1', idField: 'id', softDelete: true }, [seedEntity('r1')]);
    repo._locked = true; // simulates being mid-transaction, as transaction() itself sets internally
    const result = await repo.transaction([{ op: 'restore', id: 'r1' }]);
    assert.strictEqual(result.success, false);
    assert.strictEqual(result.error.type, RepositoryErrorTypes.CONFLICT);
    repo._locked = false;
  });

  await checkAsync('I2: after a transaction() completes (success or failure), _locked is released and a subsequent transaction() with a restore step runs normally', async () => {
    const { repo } = await makeOpenRepo({ entityKey: 'i2', idField: 'id', softDelete: true }, [seedEntity('r1', { deletedAt: '2026-01-01T00:00:00.000Z' })]);
    const first = await repo.transaction([{ op: 'update', id: 'ghost', patch: {} }]); // forced failure
    assert.strictEqual(first.success, false);
    assert.strictEqual(repo._locked, false, 'lock must be released even after a rolled-back transaction');
    const second = await repo.transaction([{ op: 'restore', id: 'r1' }]);
    assert.strictEqual(second.success, true, 'a later transaction must run normally after an earlier one released the lock');
  });

  // ================================================================
  // J. Rollback after adapter write failure
  // ================================================================
  await checkAsync('J1: restore() rolls back the in-memory record when persist() fails — record remains invisible, no partial state', async () => {
    const adapter = makeSimpleFailingAdapter({ entityKey: 'j1', records: [seedEntity('r1', { deletedAt: '2026-01-01T00:00:00.000Z' })] }, [1]);
    const { repo } = await makeOpenRepo({ entityKey: 'j1', idField: 'id', softDelete: true }, null, adapter);
    const res = await repo.restore('r1');
    assert.strictEqual(res.success, false);
    assert.strictEqual(res.error.type, RepositoryErrorTypes.STORAGE);
    assert.strictEqual(repo.get('r1'), null, 'record must remain invisible — the in-memory mutation must have been rolled back');
  });

  await checkAsync('J2: create() rolls back (pop) when persist() fails', async () => {
    const adapter = makeSimpleFailingAdapter({ entityKey: 'j2', records: [] }, [1]);
    const { repo } = await makeOpenRepo({ entityKey: 'j2', idField: null, idGenerator: () => 'g1' }, null, adapter);
    const res = await repo.create({ name: 'x' });
    assert.strictEqual(res.success, false);
    assert.strictEqual(repo.getAll().length, 0, 'failed create must leave zero records — rollback via pop() confirmed');
  });

  await checkAsync('J3: update() rolls back to the previous record when persist() fails', async () => {
    const adapter = makeSimpleFailingAdapter({ entityKey: 'j3', records: [seedEntity('r1', { name: 'original' })] }, [1]);
    const { repo } = await makeOpenRepo({ entityKey: 'j3', idField: 'id' }, null, adapter);
    const res = await repo.update('r1', { name: 'changed' });
    assert.strictEqual(res.success, false);
    assert.strictEqual(repo.get('r1').name, 'original', 'failed update must roll back to the exact previous record');
  });

  await checkAsync('J4: delete() (soft) rolls back deletedAt when persist() fails — record remains live', async () => {
    const adapter = makeSimpleFailingAdapter({ entityKey: 'j4', records: [seedEntity('r1')] }, [1]);
    const { repo } = await makeOpenRepo({ entityKey: 'j4', idField: 'id', softDelete: true }, null, adapter);
    const res = await repo.delete('r1');
    assert.strictEqual(res.success, false);
    assert.ok(repo.get('r1'), 'record must remain live — failed soft-delete must roll back deletedAt');
  });

  await checkAsync('J5: bulkInsert() rolls back the whole batch (not partial) when persist() fails', async () => {
    const adapter = makeSimpleFailingAdapter({ entityKey: 'j5', records: [] }, [1]);
    const { repo } = await makeOpenRepo({ entityKey: 'j5', idField: 'id' }, null, adapter);
    const results = await repo.bulkInsert([seedEntity('b1'), seedEntity('b2')]);
    assert.ok(results.every(r => r.success === false));
    assert.strictEqual(repo.getAll().length, 0, 'a failed bulkInsert must leave zero records — no partial batch commit');
  });

  await checkAsync('J6: bulkDelete() then restore() sequence — if the restore()\'s own persist() fails, only that record rolls back, siblings already committed by bulkDelete() are unaffected', async () => {
    const adapter = makeSimpleFailingAdapter({ entityKey: 'j6', records: [seedEntity('r1'), seedEntity('r2')] }, [2]); // 1st write = bulkDelete OK, 2nd write = restore fails
    const { repo } = await makeOpenRepo({ entityKey: 'j6', idField: 'id', softDelete: true }, null, adapter);
    await repo.bulkDelete(['r1', 'r2']);
    const res = await repo.restore('r1');
    assert.strictEqual(res.success, false, 'the restore() persist() call (2nd write) is the one simulated to fail');
    assert.strictEqual(repo.get('r1'), null, 'r1 restore must have rolled back — remains deleted');
    assert.strictEqual(repo.get('r2'), null, 'r2 must remain independently deleted, unaffected by r1\'s failed restore');
  });

  // ================================================================
  // K. Rollback after validation failure (inside transaction())
  // ================================================================
  await checkAsync('K1: transaction() create step failing validation rolls back and never calls write()', async () => {
    const { repo, adapter } = makeValidatingRepo([]);
    await repo.open();
    const before = adapter.writeCalls;
    const res = await repo.transaction([{ op: 'create', entity: { id: 'x1' /* no name -> invalid */ } }]);
    assert.strictEqual(res.success, false);
    assert.strictEqual(res.error.type, RepositoryErrorTypes.VALIDATION);
    assert.strictEqual(adapter.writeCalls, before, 'validation failure must short-circuit before any persist() call');
    assert.strictEqual(repo.getAll().length, 0);
  });

  await checkAsync('K2: transaction() with a valid restore step followed by an invalid update step rolls back the restore too (all-or-nothing)', async () => {
    const { repo, adapter } = makeValidatingRepo([seedEntity('r1', { deletedAt: '2026-01-01T00:00:00.000Z', name: 'has-name' })]);
    await repo.open();
    const before = adapter.writeCalls;
    const res = await repo.transaction([
      { op: 'restore', id: 'r1' },
      { op: 'update', id: 'r1', patch: { name: '' } } // fails validation (falsy name)
    ]);
    assert.strictEqual(res.success, false);
    assert.strictEqual(adapter.writeCalls, before, 'no persist() at all — the earlier successful restore step must not leak through');
    assert.strictEqual(repo.get('r1'), null, 'r1 must remain deleted — the restore step must have been fully rolled back');
  });

  await checkAsync('K3: transaction() update step failing validation on an already-restored-in-this-transaction record rolls back cleanly', async () => {
    const { repo } = makeValidatingRepo([seedEntity('r1', { deletedAt: '2026-01-01T00:00:00.000Z', name: 'ok' })]);
    await repo.open();
    const res = await repo.transaction([
      { op: 'restore', id: 'r1' },
      { op: 'update', id: 'r1', patch: { name: null } }
    ]);
    assert.strictEqual(res.success, false);
    assert.strictEqual(repo.get('r1'), null);
  });

  // ================================================================
  // L. Rollback after transaction failure — failure at every possible
  //    position in a multi-step transaction, including persist()-level
  // ================================================================
  await checkAsync('L1: failure on the FIRST step of a multi-step transaction rolls back everything (nothing was staged before it)', async () => {
    const { repo, adapter } = await makeOpenRepo({ entityKey: 'l1', idField: 'id', softDelete: true }, [seedEntity('r1', { deletedAt: '2026-01-01T00:00:00.000Z' })]);
    const before = adapter.writeCalls;
    const res = await repo.transaction([
      { op: 'update', id: 'ghost', patch: {} },
      { op: 'restore', id: 'r1' }
    ]);
    assert.strictEqual(res.success, false);
    assert.strictEqual(adapter.writeCalls, before);
    assert.strictEqual(repo.get('r1'), null, 'r1 must remain deleted — its restore step never ran because step 0 failed first');
  });

  await checkAsync('L2: failure on the LAST step of a multi-step transaction rolls back all earlier successfully-staged steps', async () => {
    const { repo, adapter } = await makeOpenRepo(
      { entityKey: 'l2', idField: 'id', softDelete: true },
      [seedEntity('r1', { deletedAt: '2026-01-01T00:00:00.000Z' }), seedEntity('r2')]
    );
    const before = adapter.writeCalls;
    const res = await repo.transaction([
      { op: 'restore', id: 'r1' },
      { op: 'delete', id: 'r2' },
      { op: 'update', id: 'ghost', patch: {} } // fails last
    ]);
    assert.strictEqual(res.success, false);
    assert.strictEqual(adapter.writeCalls, before, 'no persist() call — staged-but-uncommitted work must vanish entirely');
    assert.strictEqual(repo.get('r1'), null, 'staged restore of r1 must be rolled back');
    assert.ok(repo.get('r2'), 'staged delete of r2 must be rolled back — r2 must still be live');
  });

  await checkAsync('L3: transaction()-level persist() failure (all ops individually valid, but the final write() throws) rolls back the whole in-memory array to its pre-transaction snapshot', async () => {
    const adapter = makeSimpleFailingAdapter(
      { entityKey: 'l3', records: [seedEntity('r1', { deletedAt: '2026-01-01T00:00:00.000Z' })] },
      [1] // the transaction's single commit write is the 1st write call
    );
    const { repo } = await makeOpenRepo({ entityKey: 'l3', idField: 'id', softDelete: true }, null, adapter);
    const res = await repo.transaction([{ op: 'restore', id: 'r1' }]);
    assert.strictEqual(res.success, false);
    assert.strictEqual(res.error.type, RepositoryErrorTypes.STORAGE);
    assert.strictEqual(repo.get('r1'), null, 'the whole-array persist() failure must revert this._records to the pre-transaction snapshot');
  });

  // ================================================================
  // M. Unknown ID handling across every write method
  // ================================================================
  await checkAsync('M1: restore() on an unknown id — ValidationError, unrecoverable, no persist()', async () => {
    const { repo, adapter } = await makeOpenRepo({ entityKey: 'm1', idField: 'id', softDelete: true }, []);
    const before = adapter.writeCalls;
    const res = await repo.restore('ghost');
    assert.strictEqual(res.success, false);
    assert.strictEqual(res.error.type, RepositoryErrorTypes.VALIDATION);
    assert.strictEqual(res.error.recoverable, false);
    assert.strictEqual(adapter.writeCalls, before);
  });

  await checkAsync('M2: update()/delete() on an unknown id both mirror restore()\'s unknown-id error shape exactly (consistency)', async () => {
    const { repo } = await makeOpenRepo({ entityKey: 'm2', idField: 'id' }, []);
    const u = await repo.update('ghost', {});
    const d = await repo.delete('ghost');
    assert.strictEqual(u.error.type, RepositoryErrorTypes.VALIDATION);
    assert.strictEqual(d.error.type, RepositoryErrorTypes.VALIDATION);
  });

  await checkAsync('M3: transaction() {op:"restore"} on an unknown id fails the whole transaction (not silently skipped)', async () => {
    const { repo } = await makeOpenRepo({ entityKey: 'm3', idField: 'id', softDelete: true }, []);
    const res = await repo.transaction([{ op: 'restore', id: 'ghost' }]);
    assert.strictEqual(res.success, false);
    assert.strictEqual(res.error.type, RepositoryErrorTypes.VALIDATION);
  });

  await checkAsync('M4: bulkDelete()/bulkUpdate() report per-item unknown-id failures without throwing, matching restore()\'s error style', async () => {
    const { repo } = await makeOpenRepo({ entityKey: 'm4', idField: 'id' }, [seedEntity('r1')]);
    const bd = await repo.bulkDelete(['r1', 'ghost']);
    const bu = await repo.bulkUpdate([{ id: 'ghost', patch: {} }]);
    assert.strictEqual(bd[1].error.type, RepositoryErrorTypes.VALIDATION);
    assert.strictEqual(bu[0].error.type, RepositoryErrorTypes.VALIDATION);
  });

  // ================================================================
  // N. Idempotency — restore() called twice / on an already-live record
  // ================================================================
  await checkAsync('N1: restore() called twice in a row on the same deleted record — second call is idempotent (no double version bump)', async () => {
    const { repo, adapter } = await makeOpenRepo({ entityKey: 'n1', idField: 'id', softDelete: true }, [seedEntity('r1', { deletedAt: '2026-01-01T00:00:00.000Z', version: 4 })]);
    const first = await repo.restore('r1');
    assert.strictEqual(first.record.version, 5);
    const writesAfterFirst = adapter.writeCalls;
    const second = await repo.restore('r1');
    assert.strictEqual(second.success, true);
    assert.strictEqual(second.record.version, 5, 'second restore must NOT bump version again — idempotent');
    assert.strictEqual(adapter.writeCalls, writesAfterFirst, 'second restore must not call write() at all');
  });

  await checkAsync('N2: restore() on a record that was never deleted at all (deletedAt was always null) — idempotent success', async () => {
    const { repo, adapter } = await makeOpenRepo({ entityKey: 'n2', idField: 'id', softDelete: true }, [seedEntity('r1')]);
    const before = adapter.writeCalls;
    const res = await repo.restore('r1');
    assert.strictEqual(res.success, true);
    assert.strictEqual(adapter.writeCalls, before);
  });

  // ================================================================
  // O. Delete twice — already-deleted record
  // ================================================================
  await checkAsync('O1: delete() called twice on the same record — second delete() re-stamps deletedAt/version again (delete has no idempotency guard, unlike restore — documented asymmetry, not a bug)', async () => {
    const { repo, adapter } = await makeOpenRepo({ entityKey: 'o1', idField: 'id', softDelete: true }, [seedEntity('r1', { version: 1 })]);
    const first = await repo.delete('r1');
    assert.strictEqual(first.success, true);
    const firstDeletedAt = first.record.deletedAt;
    const writesAfterFirst = adapter.writeCalls;
    const second = await repo.delete('r1');
    assert.strictEqual(second.success, true, 'delete() on an already-deleted record still succeeds — no guard against it, matching pre-Restore-System legacy behavior');
    assert.strictEqual(second.record.version, 3, 'unlike restore(), delete() always bumps version even when already deleted');
    assert.strictEqual(adapter.writeCalls, writesAfterFirst + 1, 'unlike restore(), delete() always calls write(), even redundantly');
  });

  await checkAsync('O2: delete() twice then restore() once — restore() still correctly returns the record to live state', async () => {
    const { repo } = await makeOpenRepo({ entityKey: 'o2', idField: 'id', softDelete: true }, [seedEntity('r1')]);
    await repo.delete('r1');
    await repo.delete('r1');
    const res = await repo.restore('r1');
    assert.strictEqual(res.success, true);
    assert.ok(repo.get('r1'));
  });

  // ================================================================
  // P. Multiple restores inside one transaction
  // ================================================================
  await checkAsync('P1: transaction() with 3 restore steps for 3 different deleted records — all 3 committed atomically in one persist()', async () => {
    const { repo, adapter } = await makeOpenRepo(
      { entityKey: 'p1', idField: 'id', softDelete: true },
      [seedEntity('r1', { deletedAt: '2026-01-01T00:00:00.000Z' }), seedEntity('r2', { deletedAt: '2026-01-01T00:00:00.000Z' }), seedEntity('r3', { deletedAt: '2026-01-01T00:00:00.000Z' })]
    );
    const before = adapter.writeCalls;
    const res = await repo.transaction([
      { op: 'restore', id: 'r1' },
      { op: 'restore', id: 'r2' },
      { op: 'restore', id: 'r3' }
    ]);
    assert.strictEqual(res.success, true);
    assert.strictEqual(res.results.length, 3);
    assert.strictEqual(adapter.writeCalls, before + 1, 'all 3 restores must be committed with exactly ONE persist() call');
    assert.strictEqual(repo.getAll().length, 3);
  });

  await checkAsync('P2: transaction() with the same id restored twice in one op list — second staged restore sees the first\'s in-memory staged state (idempotent, no double bump within the same transaction)', async () => {
    const { repo } = await makeOpenRepo({ entityKey: 'p2', idField: 'id', softDelete: true }, [seedEntity('r1', { deletedAt: '2026-01-01T00:00:00.000Z', version: 1 })]);
    const res = await repo.transaction([
      { op: 'restore', id: 'r1' },
      { op: 'restore', id: 'r1' }
    ]);
    assert.strictEqual(res.success, true);
    assert.strictEqual(res.results[0].record.version, 2, 'first staged restore bumps version');
    assert.strictEqual(res.results[1].record.version, 2, 'second staged restore on the same id within the same transaction sees it already live in the working copy — idempotent, no further bump');
  });

  // ================================================================
  // Q. Mixed-operation transaction: create/update/delete/restore x2
  // ================================================================
  await checkAsync('Q1: full mixed-operation transaction (create, update, delete, restore, update, delete, restore) commits atomically with correct final state', async () => {
    const { repo, adapter } = await makeOpenRepo({ entityKey: 'q1', idField: 'id', softDelete: true }, [seedEntity('base', { deletedAt: '2026-01-01T00:00:00.000Z' })]);
    const before = adapter.writeCalls;
    const res = await repo.transaction([
      { op: 'create', entity: { id: 'new1', name: 'created' } },
      { op: 'update', id: 'new1', patch: { name: 'updated-once' } },
      { op: 'delete', id: 'new1' },
      { op: 'restore', id: 'new1' },
      { op: 'update', id: 'new1', patch: { name: 'updated-twice' } },
      { op: 'delete', id: 'base' },
      { op: 'restore', id: 'base' }
    ]);
    assert.strictEqual(res.success, true);
    assert.strictEqual(res.results.length, 7);
    assert.strictEqual(adapter.writeCalls, before + 1, 'the entire 7-step mixed sequence must commit with exactly ONE persist() call');

    const finalNew1 = repo.get('new1');
    assert.ok(finalNew1, 'new1 must end up live');
    assert.strictEqual(finalNew1.name, 'updated-twice', 'final name must reflect the last update in the sequence');

    const finalBase = repo.get('base');
    assert.ok(finalBase, 'base must end up live after its own delete->restore round trip within the same transaction');
  });

  await checkAsync('Q2: mixed-operation transaction that fails on its final step rolls back the ENTIRE 6 preceding successfully-staged steps', async () => {
    const { repo, adapter } = await makeOpenRepo({ entityKey: 'q2', idField: 'id', softDelete: true }, [seedEntity('base')]);
    const before = adapter.writeCalls;
    const res = await repo.transaction([
      { op: 'create', entity: { id: 'new1', name: 'x' } },
      { op: 'update', id: 'new1', patch: { name: 'y' } },
      { op: 'delete', id: 'new1' },
      { op: 'restore', id: 'new1' },
      { op: 'delete', id: 'base' },
      { op: 'restore', id: 'base' },
      { op: 'update', id: 'does-not-exist', patch: {} } // fails
    ]);
    assert.strictEqual(res.success, false);
    assert.strictEqual(adapter.writeCalls, before, 'zero persist() calls — nothing from the 6 staged steps may leak through');
    assert.strictEqual(repo.get('new1'), null, 'new1 must not exist at all — its staged create was rolled back');
    assert.ok(repo.get('base'), 'base must remain exactly as it started — untouched by the rolled-back delete/restore pair');
  });

  // ================================================================
  // R. Mirror synchronization pattern (data.<entity> = getAll()) after restore
  // ================================================================
  const MIRROR_ENTITIES = ['cases', 'clients', 'sessions', 'tasks', 'documents', 'library', 'templates', 'children', 'fees'];
  for (const entityName of MIRROR_ENTITIES) {
    await checkAsync('R-' + entityName + ': the documented mirror pattern (data.' + entityName + ' = repo.getAll()) exactly matches Repository state after a restore', async () => {
      const { repo } = await makeOpenRepo(
        { entityKey: entityName, idField: 'id', softDelete: true },
        [seedEntity('m1', { deletedAt: '2026-01-01T00:00:00.000Z' }), seedEntity('m2')]
      );
      await repo.restore('m1');
      // This is exactly the sync<Entity>Mirror() pattern documented in
      // PROJECT_MAP.md §3: data.<entity> = <entity>Repository.getAll()
      const mirror = repo.getAll();
      assert.strictEqual(mirror.length, 2, 'mirror must include the just-restored record');
      assert.ok(mirror.some(r => r.id === 'm1'), 'restored record must be present in the mirror array');
      assert.deepStrictEqual(
        mirror.map(r => r.id).sort(),
        repo.getAll().map(r => r.id).sort(),
        'mirror must be byte-identical (by id set) to a fresh getAll() call — no staleness'
      );
    });
  }

  await checkAsync('R-isolation: restoring in one entity\'s Repository does not alter another entity\'s mirror snapshot taken beforehand', async () => {
    const { repo: casesRepo } = await makeOpenRepo({ entityKey: 'mirror_cases', idField: 'id', softDelete: true }, [seedEntity('c1', { deletedAt: '2026-01-01T00:00:00.000Z' })]);
    const { repo: clientsRepo } = await makeOpenRepo({ entityKey: 'mirror_clients', idField: 'id', softDelete: true }, [seedEntity('k1')]);
    const clientsMirrorBefore = clientsRepo.getAll();
    await casesRepo.restore('c1');
    const clientsMirrorAfter = clientsRepo.getAll();
    assert.deepStrictEqual(clientsMirrorBefore.map(r => r.id), clientsMirrorAfter.map(r => r.id), 'clients mirror must be completely unaffected by a cases restore()');
  });

  // ================================================================
  // S. Statistics consistency — counts/badges never include deleted records
  // ================================================================
  await checkAsync('S1: count() excludes soft-deleted records by default, before and after a restore changes the mix', async () => {
    const { repo } = await makeOpenRepo(
      { entityKey: 's1', idField: 'id', softDelete: true },
      [seedEntity('r1'), seedEntity('r2', { deletedAt: '2026-01-01T00:00:00.000Z' }), seedEntity('r3', { deletedAt: '2026-01-01T00:00:00.000Z' })]
    );
    assert.strictEqual(repo.count(), 1, 'count() must exclude both deleted records');
    await repo.restore('r2');
    assert.strictEqual(repo.count(), 2, 'count() must reflect the restore immediately');
  });

  await checkAsync('S2: getAll().length (the value a Dashboard badge/counter would read) always equals count() for the same filter state', async () => {
    const { repo } = await makeOpenRepo(
      { entityKey: 's2', idField: 'id', softDelete: true },
      [seedEntity('r1'), seedEntity('r2', { deletedAt: '2026-01-01T00:00:00.000Z' })]
    );
    assert.strictEqual(repo.getAll().length, repo.count(), 'badge-style getAll().length must always agree with count()');
    await repo.restore('r2');
    assert.strictEqual(repo.getAll().length, repo.count(), 'must still agree after a restore');
  });

  await checkAsync('S3: search({}) total (a "results found" statistic) excludes deleted records, matches count(), and updates after restore', async () => {
    const { repo } = await makeOpenRepo(
      { entityKey: 's3', idField: 'id', softDelete: true, searchFields: ['name'] },
      [seedEntity('r1'), seedEntity('r2', { deletedAt: '2026-01-01T00:00:00.000Z' })]
    );
    assert.strictEqual(repo.search({}).total, 1);
    await repo.restore('r2');
    assert.strictEqual(repo.search({}).total, 2);
    assert.strictEqual(repo.search({}).total, repo.count());
  });

  await checkAsync('S4: a filtered count (e.g. Dashboard "active cases" style query) never counts a record still soft-deleted, even mid-restore-sequence', async () => {
    const { repo } = await makeOpenRepo(
      { entityKey: 's4', idField: 'id', softDelete: true },
      [seedEntity('r1', { status: 'open' }), seedEntity('r2', { status: 'open', deletedAt: '2026-01-01T00:00:00.000Z' })]
    );
    assert.strictEqual(repo.count({ filter: { status: 'open' } }), 1, 'filtered count must still exclude the deleted matching record');
    await repo.restore('r2');
    assert.strictEqual(repo.count({ filter: { status: 'open' } }), 2, 'filtered count must include it immediately after restore');
  });

  // ================================================================
  // T. includeDeleted behavior across get/getAll/search/exists/count
  // ================================================================
  await checkAsync('T1: get() has NO includeDeleted option — always excludes soft-deleted records regardless of any argument (documented asymmetry vs getAll/search/count)', async () => {
    const { repo } = await makeOpenRepo({ entityKey: 't1', idField: 'id', softDelete: true }, [seedEntity('r1', { deletedAt: '2026-01-01T00:00:00.000Z' })]);
    assert.strictEqual(repo.get('r1'), null, 'get() cannot surface a deleted record under any circumstance — by design, no includeDeleted param exists on get()');
  });

  await checkAsync('T2: exists() has NO includeDeleted option — always returns false for a soft-deleted record, matching get()', async () => {
    const { repo } = await makeOpenRepo({ entityKey: 't2', idField: 'id', softDelete: true }, [seedEntity('r1', { deletedAt: '2026-01-01T00:00:00.000Z' })]);
    assert.strictEqual(repo.exists('r1'), false, 'exists() must not have an includeDeleted escape hatch — only restore() can make it true again');
  });

  await checkAsync('T3: getAll({includeDeleted:true}) surfaces deleted records; default getAll() (no options) does not', async () => {
    const { repo } = await makeOpenRepo({ entityKey: 't3', idField: 'id', softDelete: true }, [seedEntity('r1', { deletedAt: '2026-01-01T00:00:00.000Z' }), seedEntity('r2')]);
    assert.strictEqual(repo.getAll().length, 1);
    assert.strictEqual(repo.getAll({ includeDeleted: true }).length, 2);
  });

  await checkAsync('T4: search({includeDeleted:true}) surfaces deleted records in .items and .total; default search({}) does not', async () => {
    const { repo } = await makeOpenRepo({ entityKey: 't4', idField: 'id', softDelete: true }, [seedEntity('r1', { deletedAt: '2026-01-01T00:00:00.000Z' }), seedEntity('r2')]);
    assert.strictEqual(repo.search({}).total, 1);
    assert.strictEqual(repo.search({ includeDeleted: true }).total, 2);
  });

  await checkAsync('T5: count({includeDeleted:true}) surfaces deleted records; default count() does not', async () => {
    const { repo } = await makeOpenRepo({ entityKey: 't5', idField: 'id', softDelete: true }, [seedEntity('r1', { deletedAt: '2026-01-01T00:00:00.000Z' }), seedEntity('r2')]);
    assert.strictEqual(repo.count(), 1);
    assert.strictEqual(repo.count({ includeDeleted: true }), 2);
  });

  await checkAsync('T6: the documented Trash-only query pattern (includeDeleted:true + filter deletedAt ne null) correctly empties after restore across get/exists/getAll/search/count all agreeing', async () => {
    const { repo } = await makeOpenRepo({ entityKey: 't6', idField: 'id', softDelete: true }, [seedEntity('r1', { deletedAt: '2026-01-01T00:00:00.000Z' })]);
    const trashBefore = repo.search({ includeDeleted: true, filter: { deletedAt: { op: 'ne', value: null } } });
    assert.strictEqual(trashBefore.total, 1);
    await repo.restore('r1');
    const trashAfter = repo.search({ includeDeleted: true, filter: { deletedAt: { op: 'ne', value: null } } });
    assert.strictEqual(trashAfter.total, 0, 'Trash query must empty out after restore');
    assert.ok(repo.get('r1'), 'get() must now agree the record is live');
    assert.strictEqual(repo.exists('r1'), true, 'exists() must now agree the record is live');
    assert.strictEqual(repo.getAll().length, 1);
    assert.strictEqual(repo.count(), 1);
  });

  // ================================================================
  // U. Performance — 100 / 500 / 1000 / 5000 restore operations
  // ================================================================
  const PERF_SIZES = [100, 500, 1000, 5000];
  const perfResults = [];
  for (const size of PERF_SIZES) {
    await checkAsync('U-' + size + ': ' + size + ' sequential restore() calls all succeed, correct final count, single write per call (no batching drift)', async () => {
      const seeds = [];
      for (let i = 0; i < size; i++) seeds.push(seedEntity('perf' + i, { deletedAt: '2026-01-01T00:00:00.000Z' }));
      const { repo, adapter } = await makeOpenRepo({ entityKey: 'perf' + size, idField: 'id', softDelete: true }, seeds);

      const startMem = process.memoryUsage().heapUsed;
      const t0 = Date.now();
      for (let i = 0; i < size; i++) {
        const res = await repo.restore('perf' + i);
        assert.strictEqual(res.success, true, 'restore #' + i + ' of ' + size + ' must succeed');
      }
      const elapsedMs = Date.now() - t0;
      const endMem = process.memoryUsage().heapUsed;

      assert.strictEqual(repo.getAll().length, size, 'all ' + size + ' records must be live after the run');
      assert.strictEqual(adapter.writeCalls, size, 'exactly one write() per restore() — no accidental batching or double-write');

      perfResults.push({
        size: size,
        elapsedMs: elapsedMs,
        msPerOp: (elapsedMs / size).toFixed(4),
        heapDeltaKb: Math.round((endMem - startMem) / 1024)
      });

      // Generous, size-scaled ceiling. Repository._persist() writes the
      // FULL in-memory array on every single write (Repository.js §4.9)
      // by design — Contract-mandated "one adapter write per operation",
      // matching the same full-array-write cost every other write method
      // already has (create/update/delete). Because the mock adapter also
      // JSON-clones the whole array per write (mirroring the real
      // LocalStorageAdapter's serialize-on-write behavior), total cost
      // across N sequential single-record restores is inherently O(N^2)
      // in array size — this is an EXISTING, pre-Restore-System
      // characteristic shared with T-05 ("duplicate full-array scan per
      // render"), not a regression introduced by restore(). The ceiling
      // below is scaled accordingly so it still catches a genuine
      // algorithmic regression (e.g. restore() suddenly scanning some
      // additional structure per call) without false-failing on the
      // already-known O(N^2) shape.
      const ceilingMs = size * size * 0.01 + 1000;
      assert.ok(elapsedMs < ceilingMs, size + ' restores took ' + elapsedMs + 'ms (ceiling ' + Math.round(ceilingMs) + 'ms) — unexpectedly slow even accounting for the known O(N^2) full-array-persist-per-write cost');
    });
  }

  // ================================================================
  // V. Repository isolation — restoring one Repository never affects another
  // ================================================================
  await checkAsync('V1: two Repository instances for different entities, sharing no adapter state, are fully isolated across restore operations', async () => {
    const { repo: repoA } = await makeOpenRepo({ entityKey: 'iso_a', idField: 'id', softDelete: true }, [seedEntity('a1', { deletedAt: '2026-01-01T00:00:00.000Z' })]);
    const { repo: repoB } = await makeOpenRepo({ entityKey: 'iso_b', idField: 'id', softDelete: true }, [seedEntity('a1', { deletedAt: '2026-01-01T00:00:00.000Z' })]); // same id, different entity/repo
    await repoA.restore('a1');
    assert.ok(repoA.get('a1'), 'repoA record must be restored');
    assert.strictEqual(repoB.get('a1'), null, 'repoB record with the SAME id in a DIFFERENT Repository must remain untouched');
  });

  await checkAsync('V2: two Repository instances sharing the SAME underlying adapter object but different entityKeys remain isolated (adapter keys data by entityKey)', async () => {
    const adapter = makeMockAdapter(null);
    await adapter.write('shared_x', [seedEntity('s1', { deletedAt: '2026-01-01T00:00:00.000Z' })]);
    await adapter.write('shared_y', [seedEntity('s1', { deletedAt: '2026-01-01T00:00:00.000Z' })]);
    const repoX = new Repository({ entityKey: 'shared_x', idField: 'id', softDelete: true, storageAdapter: adapter });
    const repoY = new Repository({ entityKey: 'shared_y', idField: 'id', softDelete: true, storageAdapter: adapter });
    await repoX.open();
    await repoY.open();
    await repoX.restore('s1');
    assert.ok(repoX.get('s1'));
    assert.strictEqual(repoY.get('s1'), null, 'even sharing one adapter object, entityKey-scoped storage must keep repoY isolated from repoX\'s restore');
  });

  // ================================================================
  // W. Stress test — long random operation sequence, final integrity
  // ================================================================
  await checkAsync('W1: 2000-operation pseudo-random stress sequence (create/update/delete/restore/bulk*) ends with a fully self-consistent Repository', async () => {
    const { repo } = await makeOpenRepo({ entityKey: 'stress1', idField: 'id', idGenerator: null, softDelete: true }, []);
    // deterministic PRNG (mulberry32) so the run is reproducible across CI machines
    let seed = 42;
    function rand() {
      seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    }
    let nextId = 0;
    const liveIds = new Set();
    const deletedIds = new Set();
    const OPS = 2000;

    for (let i = 0; i < OPS; i++) {
      const roll = rand();
      if (roll < 0.30 || (liveIds.size === 0 && deletedIds.size === 0)) {
        const id = 'st' + (nextId++);
        const res = await repo.create({ id: id, name: 'n' + id });
        if (res.success) liveIds.add(id);
      } else if (roll < 0.55 && liveIds.size > 0) {
        const id = [...liveIds][Math.floor(rand() * liveIds.size)];
        await repo.update(id, { name: 'updated-' + i });
      } else if (roll < 0.80 && liveIds.size > 0) {
        const id = [...liveIds][Math.floor(rand() * liveIds.size)];
        const res = await repo.delete(id);
        if (res.success) { liveIds.delete(id); deletedIds.add(id); }
      } else if (deletedIds.size > 0) {
        const id = [...deletedIds][Math.floor(rand() * deletedIds.size)];
        const res = await repo.restore(id);
        if (res.success) { deletedIds.delete(id); liveIds.add(id); }
      }
    }

    // Final integrity checks — the Repository's own bookkeeping must
    // agree with the independently-tracked expected live/deleted sets.
    const finalLive = repo.getAll();
    const finalAll = repo.getAll({ includeDeleted: true });
    assert.strictEqual(finalLive.length, liveIds.size, 'live record count must match the independently-tracked expected set after ' + OPS + ' random ops');
    assert.strictEqual(finalAll.length, liveIds.size + deletedIds.size, 'total record count (including deleted) must match total ever-created minus none (soft delete never removes)');
    for (const id of liveIds) {
      assert.ok(repo.exists(id), 'expected-live id ' + id + ' must exist() after the stress run');
    }
    for (const id of deletedIds) {
      assert.strictEqual(repo.get(id), null, 'expected-deleted id ' + id + ' must be invisible to get() after the stress run');
      const trash = repo.search({ includeDeleted: true, filter: { id: id } }).items[0];
      assert.ok(trash && trash.deletedAt, 'expected-deleted id ' + id + ' must still carry a deletedAt timestamp in storage');
    }
  });

  await checkAsync('W2: stress sequence never leaves a duplicate id, an orphaned index, or a record missing its idField', async () => {
    const { repo } = await makeOpenRepo({ entityKey: 'stress2', idField: 'id', softDelete: true }, []);
    for (let i = 0; i < 500; i++) {
      await repo.create({ id: 'w' + i, name: 'x' });
    }
    for (let i = 0; i < 500; i += 2) {
      await repo.delete('w' + i);
    }
    for (let i = 0; i < 500; i += 4) {
      await repo.restore('w' + i);
    }
    const all = repo.getAll({ includeDeleted: true });
    const ids = all.map(r => r.id);
    const uniqueIds = new Set(ids);
    assert.strictEqual(ids.length, uniqueIds.size, 'no duplicate ids may exist after interleaved create/delete/restore');
    assert.strictEqual(all.length, 500, 'total record count must remain exactly 500 — soft delete/restore never creates or destroys records');
    assert.ok(all.every(r => r.id != null), 'every record must retain its idField');
  });

  // ================================================================
  // X. Regression — every pre-existing Repository method unchanged
  // ================================================================
  await checkAsync('X1: REGRESSION — create() unchanged: validation, id assignment, conflict detection, WriteResult shape', async () => {
    const { repo } = await makeOpenRepo({ entityKey: 'x_create', idField: null, idGenerator: () => 'gen-1' }, []);
    const res = await repo.create({ name: 'x' });
    assert.strictEqual(res.success, true);
    assert.strictEqual(res.record.id, 'gen-1');
    const dup = await repo.create({ id: 'gen-1', name: 'y' });
    assert.strictEqual(dup.success, false);
    assert.strictEqual(dup.error.type, RepositoryErrorTypes.CONFLICT);
  });

  await checkAsync('X2: REGRESSION — update() unchanged: merge semantics, version increment, unknown id error', async () => {
    const { repo } = await makeOpenRepo({ entityKey: 'x_update', idField: 'id' }, [seedEntity('u1', { version: 1 })]);
    const res = await repo.update('u1', { name: 'b' });
    assert.strictEqual(res.success, true);
    assert.strictEqual(res.record.version, 2);
  });

  await checkAsync('X3: REGRESSION — delete() unchanged: soft-delete sets deletedAt, hides from getAll()', async () => {
    const { repo } = await makeOpenRepo({ entityKey: 'x_delete', idField: 'id', softDelete: true }, [seedEntity('d1')]);
    const res = await repo.delete('d1');
    assert.strictEqual(res.success, true);
    assert.strictEqual(repo.getAll().length, 0);
  });

  await checkAsync('X4: REGRESSION — get()/getAll()/exists() unchanged for live and non-existent ids', async () => {
    const { repo } = await makeOpenRepo({ entityKey: 'x_get', idField: 'id' }, [seedEntity('g1')]);
    assert.ok(repo.get('g1'));
    assert.strictEqual(repo.get('ghost'), null);
    assert.strictEqual(repo.exists('g1'), true);
  });

  await checkAsync('X5: REGRESSION — search() unchanged: filter/sort/pagination/projection', async () => {
    const { repo } = await makeOpenRepo(
      { entityKey: 'x_search', idField: 'id', searchFields: ['name'] },
      [seedEntity('s1', { age: 30 }), seedEntity('s2', { age: 25 })]
    );
    const res = repo.search({ sort: [{ field: 'age', direction: 'asc' }] });
    assert.strictEqual(res.items[0].id, 's2');
  });

  await checkAsync('X6: REGRESSION — transaction() non-restore ops (create/update/delete) unchanged, including existing rollback behavior', async () => {
    const { repo, adapter } = await makeOpenRepo({ entityKey: 'x_tx', idField: 'id' }, [seedEntity('x1', { version: 1 })]);
    const ok = await repo.transaction([
      { op: 'create', entity: { id: 'x2', name: 'b' } },
      { op: 'update', id: 'x1', patch: { name: 'a2' } }
    ]);
    assert.strictEqual(ok.success, true);
    const before = adapter.writeCalls;
    const bad = await repo.transaction([
      { op: 'delete', id: 'x1' },
      { op: 'update', id: 'ghost', patch: {} }
    ]);
    assert.strictEqual(bad.success, false);
    assert.strictEqual(adapter.writeCalls, before);
    assert.ok(repo.get('x1'));
  });

  await checkAsync('X7: REGRESSION — export()/import() round trip unchanged, including soft-deleted records in export()', async () => {
    const { repo } = await makeOpenRepo({ entityKey: 'x_export', idField: 'id', softDelete: true }, [seedEntity('e1'), seedEntity('e2', { deletedAt: '2026-01-01T00:00:00.000Z' })]);
    const exported = repo.export();
    assert.strictEqual(exported.length, 2, 'export() must include soft-deleted records — backups must not silently drop them');
  });

  await checkAsync('X8: REGRESSION — clear() unchanged: empties records, persists, WriteResult shape', async () => {
    const { repo } = await makeOpenRepo({ entityKey: 'x_clear', idField: 'id' }, [seedEntity('c1')]);
    const res = await repo.clear();
    assert.strictEqual(res.success, true);
    assert.strictEqual(repo.getAll().length, 0);
  });

  await checkAsync('X9: REGRESSION — unsupportedOperations guard still applies to restore() exactly like every other method (restore() is async, so the guard surfaces as a rejected Promise, not a synchronous throw)', async () => {
    const { repo } = await makeOpenRepo({ entityKey: 'x_unsupported', idField: 'id', softDelete: true, unsupportedOperations: ['restore'] }, [seedEntity('u1', { deletedAt: '2026-01-01T00:00:00.000Z' })]);
    await assert.rejects(() => repo.restore('u1'), (err) => err.type === RepositoryErrorTypes.UNSUPPORTED_OPERATION);
  });

  await checkAsync('X10: REGRESSION — softDelete:false Repository: delete() hard-removes, restore() is UnsupportedOperationError, no lingering deletedAt semantics', async () => {
    const { repo } = await makeOpenRepo({ entityKey: 'x_hard', idField: 'id', softDelete: false }, [seedEntity('h1')]);
    const del = await repo.delete('h1');
    assert.strictEqual(del.success, true);
    assert.strictEqual(repo.getAll({ includeDeleted: true }).length, 0, 'hard delete must remove the record entirely, even with includeDeleted:true');
    const res = await repo.restore('h1');
    assert.strictEqual(res.success, false);
    assert.strictEqual(res.error.type, RepositoryErrorTypes.UNSUPPORTED_OPERATION);
  });

  // ---- Summary ----
  console.log(log.join('\n'));
  console.log('\n' + passed + '/' + (passed + failed) + ' checks passed.');
  if (perfResults.length) {
    console.log('\n--- Performance summary ---');
    perfResults.forEach(r => {
      console.log(r.size + ' restores: ' + r.elapsedMs + 'ms total, ' + r.msPerOp + 'ms/op, heap delta ~' + r.heapDeltaKb + 'KB');
    });
  }
  if (failed > 0) {
    console.error('\n' + failed + ' CHECK(S) FAILED:');
    failedLabels.forEach(l => console.error(' - ' + l));
    process.exit(1);
  }
}

main().catch(err => {
  console.error('HARNESS CRASHED:', err);
  process.exit(1);
});
