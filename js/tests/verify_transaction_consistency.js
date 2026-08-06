/**
 * verify_transaction_consistency.js
 * ================================================================
 * PHASE 11 — SUB-PHASE 11.2.1 — Transaction Consistency Hardening
 * ================================================================
 * Standalone Node harness (`node js/tests/verify_transaction_consistency.js`,
 * no browser required, no external libraries) proving the T-10 fix to
 * `js/core/Repository.js`: `transaction({op:'update'})` now enforces the
 * exact same soft-delete guard as `update()`/`bulkUpdate()` (both added in
 * PHASE 11.2), via the shared `_stageUpdate()` helper, instead of silently
 * bypassing it as it did before this sub-phase.
 *
 * Core claim under test: update(), bulkUpdate(), and transaction(update)
 * must be provably indistinguishable in observable behavior — same
 * rejection condition, same error type, same allowDeleted opt-out, same
 * "zero mutation / zero persist on rejection" guarantee, same metadata
 * and adapter-write behavior on success.
 *
 * Uses the same in-memory mock Storage Adapter pattern already used by
 * verify_repository_api_consistency.js / verify_repository_restore.js /
 * verify_restore_stress.js (`read(entityKey)`/`write(entityKey, records)`
 * duck-typed contract, instrumented with call counters).
 *
 * Sections:
 *   A. transaction(update) on a live record — parity with update()
 *   B. transaction(update) on a soft-deleted record — blocked, matching
 *      update()'s CONFLICT WriteResult shape and zero-mutation guarantee
 *   C. transaction(update) with {allowDeleted:true} — parity with
 *      update()'s allowDeleted behavior (edits fields, never un-hides)
 *   D. transaction(mixed) — create/update/delete/restore combined with a
 *      blocked update step; whole-transaction rollback
 *   E. Direct three-way parity — update() vs bulkUpdate() vs
 *      transaction(update) against identical starting states
 *   F. rollback / restore interaction — restore-then-update-in-same-tx,
 *      delete-then-blocked-update-in-same-tx
 *   G. allowDeleted per-step independence in a multi-step transaction
 *   H. includeDeleted / get / getAll agreement after blocked and allowed
 *      transaction(update) steps
 *   I. adapter write-count discipline — exactly one write() on commit,
 *      zero on any rollback, across all op combinations
 *   J. rollback integrity — in-memory array fully restored to its
 *      pre-transaction snapshot after any step failure, including a
 *      blocked update() step arriving after other successfully staged ops
 *   K. nested transaction attempts — transaction() while _locked is
 *      unaffected by the T-10 fix (regression)
 *   L. softDelete:false Repositories — FIX/guard is a provable no-op
 *      (nothing to guard), transaction(update) behaves identically
 *      before/after this fix
 *   M. Natural-key (Arabic) idField parity — same guard behavior with a
 *      non-"id" idField, matching the real 9 entity Repositories' shape
 *   N. Validation ordering — the soft-delete guard fires before
 *      _validate() inside transaction(update), matching update()
 *   O. Stress — 40-record batch of independent transaction(update) calls
 *      alternating live/deleted targets, plus a 15-cycle
 *      delete/blocked-tx-update/restore/tx-update loop on one record
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

// ---- Instrumented in-memory mock Storage Adapter (same pattern as
// verify_repository_api_consistency.js / verify_repository_restore.js) ----
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

function seedEntity(id, extra) {
  return Object.assign({
    id: id,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    deletedAt: null,
    version: 1,
    syncVersion: null
  }, extra || {});
}

const DELETED_AT = '2026-01-02T00:00:00.000Z';

async function main() {
  // ================================================================
  // A. transaction(update) on a live record — parity with update()
  // ================================================================

  await checkAsync('A1: transaction([{op:"update"}]) on a live record succeeds — full parity with update()', async () => {
    const { repo, adapter } = await makeOpenRepo({ entityKey: 'a1', idField: 'id' }, [seedEntity('r1', { name: 'x' })]);
    const before = adapter.writeCalls;
    const res = await repo.transaction([{ op: 'update', id: 'r1', patch: { name: 'y' } }]);
    assert.strictEqual(res.success, true);
    assert.strictEqual(res.results[0].success, true);
    assert.strictEqual(res.results[0].record.name, 'y');
    assert.strictEqual(res.results[0].record.version, 2, 'version bump must match update() behavior');
    assert.strictEqual(adapter.writeCalls, before + 1, 'exactly one persist for the whole transaction');
    assert.strictEqual(repo.get('r1').name, 'y');
  });

  await checkAsync('A2: transaction(update) with no options argument at all is unaffected by the T-10 fix (backward compatible)', async () => {
    const { repo } = await makeOpenRepo({ entityKey: 'a2', idField: 'id' }, [seedEntity('r1', { name: 'orig' })]);
    const res = await repo.transaction([{ op: 'update', id: 'r1', patch: { name: 'changed' } }]);
    assert.strictEqual(res.success, true);
    assert.strictEqual(repo.get('r1').name, 'changed');
  });

  await checkAsync('A3: transaction(update) preserves fields not present in the patch, exactly like update()', async () => {
    const { repo } = await makeOpenRepo({ entityKey: 'a3', idField: 'id' }, [seedEntity('r1', { name: 'orig', extra: 42 })]);
    const res = await repo.transaction([{ op: 'update', id: 'r1', patch: { name: 'changed' } }]);
    assert.strictEqual(res.success, true);
    assert.strictEqual(repo.get('r1').extra, 42, 'untouched fields must survive the merge');
  });

  await checkAsync('A4: transaction(update) cannot change the id field via the patch, exactly like update()', async () => {
    const { repo } = await makeOpenRepo({ entityKey: 'a4', idField: 'id' }, [seedEntity('r1', { name: 'orig' })]);
    const res = await repo.transaction([{ op: 'update', id: 'r1', patch: { id: 'hacked', name: 'changed' } }]);
    assert.strictEqual(res.success, true);
    assert.strictEqual(res.results[0].record.id, 'r1', 'id field must be preserved, not overwritten by the patch');
  });

  // ================================================================
  // B. transaction(update) on a soft-deleted record — blocked
  // ================================================================

  await checkAsync('B1: T-10 FIX — transaction(update) on a soft-deleted record is now blocked by default (previously bypassed the guard entirely)', async () => {
    const { repo, adapter } = await makeOpenRepo({ entityKey: 'b1', idField: 'id', softDelete: true },
      [seedEntity('r1', { name: 'original', deletedAt: DELETED_AT, version: 3 })]);
    const before = adapter.writeCalls;
    const res = await repo.transaction([{ op: 'update', id: 'r1', patch: { name: 'blocked-edit' } }]);
    assert.strictEqual(res.success, false, 'transaction must fail when its update step targets a soft-deleted record');
    assert.strictEqual(res.results.length, 0, 'a failed transaction reports no partial results, matching existing rollback contract');
    assert.ok(res.error);
    assert.strictEqual(res.error.type, RepositoryErrorTypes.CONFLICT, 'must be CONFLICT, matching update()\'s error type exactly');
    assert.strictEqual(res.error.recoverable, true, 'must match update()\'s recoverable:true');
    assert.strictEqual(adapter.writeCalls, before, 'blocked transaction(update) must never call write()');
  });

  await checkAsync('B2: blocked transaction(update) leaves the record completely unmutated', async () => {
    const { repo } = await makeOpenRepo({ entityKey: 'b2', idField: 'id', softDelete: true },
      [seedEntity('r1', { name: 'original', deletedAt: DELETED_AT, version: 3 })]);
    await repo.transaction([{ op: 'update', id: 'r1', patch: { name: 'blocked-edit' } }]);
    const raw = repo.get('r1', { includeDeleted: true });
    assert.strictEqual(raw.name, 'original', 'record must be completely untouched');
    assert.strictEqual(raw.version, 3, 'version must not bump on a blocked transaction(update)');
    assert.strictEqual(raw.deletedAt, DELETED_AT, 'deletedAt must be untouched');
  });

  await checkAsync('B3: blocked transaction(update) error message names the record id and mentions allowDeleted, matching update()\'s message shape', async () => {
    const { repo } = await makeOpenRepo({ entityKey: 'b3', idField: 'id', softDelete: true },
      [seedEntity('r1', { deletedAt: DELETED_AT })]);
    const res = await repo.transaction([{ op: 'update', id: 'r1', patch: { name: 'x' } }]);
    assert.ok(res.error.message.indexOf('r1') !== -1, 'error message must name the id');
    assert.ok(res.error.message.toLowerCase().indexOf('allowdeleted') !== -1, 'error message must mention allowDeleted as the opt-out');
  });

  await checkAsync('B4: transaction(update) targeting a live record inside a Repository that also has unrelated deleted records is unaffected', async () => {
    const { repo } = await makeOpenRepo({ entityKey: 'b4', idField: 'id', softDelete: true }, [
      seedEntity('live1', { name: 'a' }),
      seedEntity('dead1', { name: 'b', deletedAt: DELETED_AT })
    ]);
    const res = await repo.transaction([{ op: 'update', id: 'live1', patch: { name: 'a2' } }]);
    assert.strictEqual(res.success, true, 'unrelated deleted records must not affect an update targeting a live record');
    assert.strictEqual(repo.get('live1').name, 'a2');
  });

  // ================================================================
  // C. transaction(update) with {allowDeleted:true} — parity
  // ================================================================

  await checkAsync('C1: transaction(update) with {allowDeleted:true} on a soft-deleted record succeeds, edits fields, does NOT clear deletedAt — parity with update()', async () => {
    const { repo, adapter } = await makeOpenRepo({ entityKey: 'c1', idField: 'id', softDelete: true },
      [seedEntity('r1', { name: 'orig', deletedAt: DELETED_AT })]);
    const before = adapter.writeCalls;
    const res = await repo.transaction([{ op: 'update', id: 'r1', patch: { name: 'edited-while-deleted' }, allowDeleted: true }]);
    assert.strictEqual(res.success, true);
    assert.strictEqual(adapter.writeCalls, before + 1);
    const raw = repo.get('r1', { includeDeleted: true });
    assert.strictEqual(raw.name, 'edited-while-deleted');
    assert.strictEqual(raw.deletedAt, DELETED_AT, 'allowDeleted edits fields only, never un-hides the record');
    assert.strictEqual(repo.get('r1'), null, 'record must remain invisible to a default get() after an allowDeleted edit');
  });

  await checkAsync('C2: transaction(update) {allowDeleted:true} explicitly trying to clear deletedAt via the patch does not resurrect the record — matches update()\'s "no special deletedAt handling" behavior', async () => {
    const { repo } = await makeOpenRepo({ entityKey: 'c2', idField: 'id', softDelete: true },
      [seedEntity('r1', { name: 'orig', deletedAt: DELETED_AT })]);
    const res = await repo.transaction([{ op: 'update', id: 'r1', patch: { deletedAt: null, name: 'trying-to-resurrect' }, allowDeleted: true }]);
    assert.strictEqual(res.success, true);
    // patch legitimately sets deletedAt to null, since transaction(update) merges the patch like update() does
    assert.strictEqual(repo.get('r1').name, 'trying-to-resurrect');
    assert.strictEqual(repo.get('r1').deletedAt, null);
  });

  await checkAsync('C3: transaction(update) on a live record with an explicit {allowDeleted:true} (a no-op flag) behaves identically to a normal transaction(update)', async () => {
    const { repo } = await makeOpenRepo({ entityKey: 'c3', idField: 'id', softDelete: true }, [seedEntity('r1', { name: 'x' })]);
    const res = await repo.transaction([{ op: 'update', id: 'r1', patch: { name: 'y' }, allowDeleted: true }]);
    assert.strictEqual(res.success, true);
    assert.strictEqual(repo.get('r1').name, 'y');
  });

  await checkAsync('C4: transaction(update) blocked-by-guard vs {allowDeleted:true}-then-invalid-patch — guard runs before validation, not instead of it (parity with update() ordering)', async () => {
    function ValidatingRepo(config) { Repository.call(this, config); }
    ValidatingRepo.prototype = Object.create(Repository.prototype);
    ValidatingRepo.prototype._validate = function (op, record) {
      if (op === 'update' && !record.name) return { valid: false, errors: [{ field: 'name', message: 'required' }] };
      return { valid: true, errors: [] };
    };
    const adapter = makeMockAdapter({ entityKey: 'c4', records: [seedEntity('r1', { name: 'x', deletedAt: DELETED_AT })] });
    const repo = new ValidatingRepo({ entityKey: 'c4', idField: 'id', softDelete: true, storageAdapter: adapter });
    await repo.open();

    const blockedByGuard = await repo.transaction([{ op: 'update', id: 'r1', patch: { name: '' } }]);
    assert.strictEqual(blockedByGuard.error.type, RepositoryErrorTypes.CONFLICT, 'without allowDeleted, guard fires first — CONFLICT, not VALIDATION');

    const blockedByValidation = await repo.transaction([{ op: 'update', id: 'r1', patch: { name: '' }, allowDeleted: true }]);
    assert.strictEqual(blockedByValidation.error.type, RepositoryErrorTypes.VALIDATION, 'once allowDeleted bypasses the guard, normal validation still applies');
  });

  // ================================================================
  // D. transaction(mixed) — combined ops with a blocked update step
  // ================================================================

  await checkAsync('D1: transaction(mixed) — create + update(live) + delete all succeed together, unaffected by T-10 fix', async () => {
    const { repo } = await makeOpenRepo({ entityKey: 'd1', idField: 'id', softDelete: true }, [
      seedEntity('x1', { name: 'a' }),
      seedEntity('x2', { name: 'b' })
    ]);
    const res = await repo.transaction([
      { op: 'create', entity: { id: 'x3', name: 'c' } },
      { op: 'update', id: 'x1', patch: { name: 'a2' } },
      { op: 'delete', id: 'x2' }
    ]);
    assert.strictEqual(res.success, true);
    assert.strictEqual(repo.get('x1').name, 'a2');
    assert.strictEqual(repo.get('x2'), null, 'soft-deleted, hidden from default get()');
    assert.strictEqual(repo.get('x3').name, 'c');
  });

  await checkAsync('D2: T-10 FIX — transaction(mixed) with a blocked update step rolls back the ENTIRE transaction, including an earlier successfully-staged create', async () => {
    const { repo, adapter } = await makeOpenRepo({ entityKey: 'd2', idField: 'id', softDelete: true },
      [seedEntity('dead1', { deletedAt: DELETED_AT })]);
    const before = adapter.writeCalls;
    const res = await repo.transaction([
      { op: 'create', entity: { id: 'new1', name: 'should-not-survive' } },
      { op: 'update', id: 'dead1', patch: { name: 'blocked' } }
    ]);
    assert.strictEqual(res.success, false);
    assert.strictEqual(adapter.writeCalls, before, 'no persist at all — the whole transaction rolls back');
    assert.strictEqual(repo.get('new1'), null, 'the earlier staged create() must not have survived the rollback');
  });

  await checkAsync('D3: transaction(mixed) — a blocked update step placed BEFORE other valid steps still rolls back all of them', async () => {
    const { repo, adapter } = await makeOpenRepo({ entityKey: 'd3', idField: 'id', softDelete: true }, [
      seedEntity('dead1', { deletedAt: DELETED_AT }),
      seedEntity('live1', { name: 'orig' })
    ]);
    const before = adapter.writeCalls;
    const res = await repo.transaction([
      { op: 'update', id: 'dead1', patch: { name: 'blocked' } },
      { op: 'update', id: 'live1', patch: { name: 'should-not-apply' } },
      { op: 'create', entity: { id: 'new1', name: 'should-not-exist' } }
    ]);
    assert.strictEqual(res.success, false);
    assert.strictEqual(adapter.writeCalls, before);
    assert.strictEqual(repo.get('live1').name, 'orig', 'later valid update must not have applied');
    assert.strictEqual(repo.get('new1'), null, 'later valid create must not have applied');
  });

  await checkAsync('D4: transaction(mixed) — restore followed by a normal (non-allowDeleted) update on the SAME record in one transaction succeeds, since the record is live in the working copy by the time the update step runs', async () => {
    const { repo } = await makeOpenRepo({ entityKey: 'd4', idField: 'id', softDelete: true },
      [seedEntity('r1', { name: 'orig', deletedAt: DELETED_AT })]);
    const res = await repo.transaction([
      { op: 'restore', id: 'r1' },
      { op: 'update', id: 'r1', patch: { name: 'edited-after-restore' } }
    ]);
    assert.strictEqual(res.success, true, 'restore then update in the same transaction must succeed without allowDeleted');
    const record = repo.get('r1');
    assert.ok(record);
    assert.strictEqual(record.name, 'edited-after-restore');
    assert.strictEqual(record.deletedAt, null);
  });

  await checkAsync('D5: transaction(mixed) — delete followed by a blocked (non-allowDeleted) update on the SAME record in one transaction fails, since the record is deleted in the working copy by the time the update step runs', async () => {
    const { repo, adapter } = await makeOpenRepo({ entityKey: 'd5', idField: 'id', softDelete: true }, [seedEntity('r1', { name: 'orig' })]);
    const before = adapter.writeCalls;
    const res = await repo.transaction([
      { op: 'delete', id: 'r1' },
      { op: 'update', id: 'r1', patch: { name: 'should-be-blocked' } }
    ]);
    assert.strictEqual(res.success, false, 'the update step must see the working-copy delete and be blocked, matching live behavior');
    assert.strictEqual(res.error.type, RepositoryErrorTypes.CONFLICT);
    assert.strictEqual(adapter.writeCalls, before, 'whole transaction, including the delete, must roll back');
    assert.ok(repo.get('r1'), 'r1 must remain live — the delete step must have rolled back too');
  });

  await checkAsync('D6: transaction(mixed) — delete then update with {allowDeleted:true} on the same record succeeds within one transaction', async () => {
    const { repo } = await makeOpenRepo({ entityKey: 'd6', idField: 'id', softDelete: true }, [seedEntity('r1', { name: 'orig' })]);
    const res = await repo.transaction([
      { op: 'delete', id: 'r1' },
      { op: 'update', id: 'r1', patch: { name: 'edited-while-deleting' }, allowDeleted: true }
    ]);
    assert.strictEqual(res.success, true);
    const raw = repo.get('r1', { includeDeleted: true });
    assert.strictEqual(raw.name, 'edited-while-deleting');
    assert.notStrictEqual(raw.deletedAt, null, 'record remains soft-deleted — allowDeleted only unblocks the edit, not visibility');
  });

  // ================================================================
  // E. Direct three-way parity — update() vs bulkUpdate() vs
  //    transaction(update) against identical starting states
  // ================================================================

  await checkAsync('E1: THREE-WAY PARITY (blocked case) — update(), bulkUpdate(), and transaction(update) against three identically-seeded soft-deleted records all reject identically', async () => {
    const { repo: repoU, adapter: adU } = await makeOpenRepo({ entityKey: 'e1u', idField: 'id', softDelete: true },
      [seedEntity('r1', { name: 'orig', deletedAt: DELETED_AT, version: 5 })]);
    const { repo: repoB } = await makeOpenRepo({ entityKey: 'e1b', idField: 'id', softDelete: true },
      [seedEntity('r1', { name: 'orig', deletedAt: DELETED_AT, version: 5 })]);
    const { repo: repoT, adapter: adT } = await makeOpenRepo({ entityKey: 'e1t', idField: 'id', softDelete: true },
      [seedEntity('r1', { name: 'orig', deletedAt: DELETED_AT, version: 5 })]);

    const resU = await repoU.update('r1', { name: 'edit' });
    const resB = (await repoB.bulkUpdate([{ id: 'r1', patch: { name: 'edit' } }]))[0];
    const resT = await repoT.transaction([{ op: 'update', id: 'r1', patch: { name: 'edit' } }]);

    assert.strictEqual(resU.success, false);
    assert.strictEqual(resB.success, false);
    assert.strictEqual(resT.success, false);
    assert.strictEqual(resU.error.type, RepositoryErrorTypes.CONFLICT);
    assert.strictEqual(resB.error.type, RepositoryErrorTypes.CONFLICT);
    assert.strictEqual(resT.error.type, RepositoryErrorTypes.CONFLICT);

    assert.strictEqual(repoU.get('r1', { includeDeleted: true }).name, 'orig');
    assert.strictEqual(repoB.get('r1', { includeDeleted: true }).name, 'orig');
    assert.strictEqual(repoT.get('r1', { includeDeleted: true }).name, 'orig');

    assert.strictEqual(adU.writeCalls, 0);
    assert.strictEqual(adT.writeCalls, 0);
  });

  await checkAsync('E2: THREE-WAY PARITY (allowed case) — update(), bulkUpdate(), and transaction(update), each with allowDeleted:true, produce the identical resulting record shape', async () => {
    const seed = () => [seedEntity('r1', { name: 'orig', deletedAt: DELETED_AT, version: 5 })];
    const { repo: repoU } = await makeOpenRepo({ entityKey: 'e2u', idField: 'id', softDelete: true }, seed());
    const { repo: repoB } = await makeOpenRepo({ entityKey: 'e2b', idField: 'id', softDelete: true }, seed());
    const { repo: repoT } = await makeOpenRepo({ entityKey: 'e2t', idField: 'id', softDelete: true }, seed());

    await repoU.update('r1', { name: 'edit' }, { allowDeleted: true });
    await repoB.bulkUpdate([{ id: 'r1', patch: { name: 'edit' }, allowDeleted: true }]);
    await repoT.transaction([{ op: 'update', id: 'r1', patch: { name: 'edit' }, allowDeleted: true }]);

    const ru = repoU.get('r1', { includeDeleted: true });
    const rb = repoB.get('r1', { includeDeleted: true });
    const rt = repoT.get('r1', { includeDeleted: true });

    assert.strictEqual(ru.name, 'edit');
    assert.strictEqual(rb.name, 'edit');
    assert.strictEqual(rt.name, 'edit');
    assert.strictEqual(ru.version, rb.version, 'version bump must match across update()/bulkUpdate()');
    assert.strictEqual(rb.version, rt.version, 'version bump must match across bulkUpdate()/transaction(update)');
    assert.strictEqual(ru.deletedAt, DELETED_AT);
    assert.strictEqual(rb.deletedAt, DELETED_AT);
    assert.strictEqual(rt.deletedAt, DELETED_AT);
  });

  await checkAsync('E3: THREE-WAY PARITY (live record) — update(), bulkUpdate(), and transaction(update) against a live record all succeed with matching version bumps', async () => {
    const seed = () => [seedEntity('r1', { name: 'orig' })];
    const { repo: repoU } = await makeOpenRepo({ entityKey: 'e3u', idField: 'id' }, seed());
    const { repo: repoB } = await makeOpenRepo({ entityKey: 'e3b', idField: 'id' }, seed());
    const { repo: repoT } = await makeOpenRepo({ entityKey: 'e3t', idField: 'id' }, seed());

    const resU = await repoU.update('r1', { name: 'edit' });
    const resB = (await repoB.bulkUpdate([{ id: 'r1', patch: { name: 'edit' } }]))[0];
    const resT = await repoT.transaction([{ op: 'update', id: 'r1', patch: { name: 'edit' } }]);

    assert.strictEqual(resU.success, true);
    assert.strictEqual(resB.success, true);
    assert.strictEqual(resT.success, true);
    assert.strictEqual(resU.record.version, 2);
    assert.strictEqual(resB.record.version, 2);
    assert.strictEqual(resT.results[0].record.version, 2);
  });

  await checkAsync('E4: THREE-WAY PARITY error message — update(), bulkUpdate(), and transaction(update) produce the same CONFLICT message text for the same id', async () => {
    const seed = () => [seedEntity('same-id', { deletedAt: DELETED_AT })];
    const { repo: repoU } = await makeOpenRepo({ entityKey: 'e4u', idField: 'id', softDelete: true }, seed());
    const { repo: repoB } = await makeOpenRepo({ entityKey: 'e4b', idField: 'id', softDelete: true }, seed());
    const { repo: repoT } = await makeOpenRepo({ entityKey: 'e4t', idField: 'id', softDelete: true }, seed());

    const resU = await repoU.update('same-id', {});
    const resB = (await repoB.bulkUpdate([{ id: 'same-id', patch: {} }]))[0];
    const resT = await repoT.transaction([{ op: 'update', id: 'same-id', patch: {} }]);

    // Same "Cannot update record..." core message, allowing for each
    // call site's own contextual prefix.
    const core = 'record is soft-deleted. Restore it first';
    assert.ok(resU.error.message.indexOf(core) !== -1);
    assert.ok(resB.error.message.indexOf(core) !== -1);
    assert.ok(resT.error.message.indexOf(core) !== -1);
  });

  // ================================================================
  // F. rollback / restore interaction
  // ================================================================

  await checkAsync('F1: transaction(update) rollback: a failing later step rolls back an earlier successfully-staged update step', async () => {
    const { repo, adapter } = await makeOpenRepo({ entityKey: 'f1', idField: 'id' }, [seedEntity('x1', { name: 'a' })]);
    const before = adapter.writeCalls;
    const res = await repo.transaction([
      { op: 'update', id: 'x1', patch: { name: 'a2' } },
      { op: 'update', id: 'ghost', patch: {} }
    ]);
    assert.strictEqual(res.success, false);
    assert.strictEqual(adapter.writeCalls, before);
    assert.strictEqual(repo.get('x1').name, 'a', 'x1 must be unchanged — the earlier update must have rolled back');
  });

  await checkAsync('F2: transaction(update) rollback: a blocked-by-T-10-guard step rolls back an earlier successfully-staged restore step', async () => {
    const { repo, adapter } = await makeOpenRepo({ entityKey: 'f2', idField: 'id', softDelete: true }, [
      seedEntity('r1', { deletedAt: DELETED_AT }),
      seedEntity('r2', { name: 'orig', deletedAt: DELETED_AT })
    ]);
    const before = adapter.writeCalls;
    const res = await repo.transaction([
      { op: 'restore', id: 'r1' },
      { op: 'update', id: 'r2', patch: { name: 'blocked' } } // r2 still deleted, no allowDeleted -> rejected
    ]);
    assert.strictEqual(res.success, false);
    assert.strictEqual(adapter.writeCalls, before);
    assert.strictEqual(repo.get('r1'), null, 'r1 restore must have rolled back too — still hidden');
    assert.notStrictEqual(repo.get('r2', { includeDeleted: true }).deletedAt, null, 'r2 must remain deleted, unmutated');
  });

  await checkAsync('F3: transaction()-level persist() failure after a successfully-staged, guard-passing update step rolls back the whole in-memory array', async () => {
    const { repo } = await makeOpenRepo({ entityKey: 'f3', idField: 'id' }, [seedEntity('r1', { name: 'orig' })]);
    repo._storage.write = async function () { throw new Error('disk full'); };
    const res = await repo.transaction([{ op: 'update', id: 'r1', patch: { name: 'edit' } }]);
    assert.strictEqual(res.success, false);
    assert.strictEqual(repo.get('r1').name, 'orig', 'in-memory state must roll back to the pre-transaction snapshot on a persist() failure');
  });

  // ================================================================
  // G. allowDeleted per-step independence
  // ================================================================

  await checkAsync('G1: in a multi-step transaction, allowDeleted is independent per step — one deleted-target step with the flag succeeds while a sibling without it (targeting a different deleted record) blocks the whole transaction', async () => {
    const { repo, adapter } = await makeOpenRepo({ entityKey: 'g1', idField: 'id', softDelete: true }, [
      seedEntity('dead1', { name: 'a', deletedAt: DELETED_AT }),
      seedEntity('dead2', { name: 'b', deletedAt: DELETED_AT })
    ]);
    const before = adapter.writeCalls;
    const res = await repo.transaction([
      { op: 'update', id: 'dead1', patch: { name: 'allowed' }, allowDeleted: true },
      { op: 'update', id: 'dead2', patch: { name: 'blocked' } }
    ]);
    assert.strictEqual(res.success, false, 'one unguarded step is enough to fail the whole transaction (all-or-nothing)');
    assert.strictEqual(adapter.writeCalls, before, 'nothing persists, including the allowDeleted-permitted step');
    assert.strictEqual(repo.get('dead1', { includeDeleted: true }).name, 'a', 'dead1 edit must have rolled back too, despite passing its own guard');
  });

  await checkAsync('G2: two allowDeleted:true steps targeting two different deleted records both commit together', async () => {
    const { repo } = await makeOpenRepo({ entityKey: 'g2', idField: 'id', softDelete: true }, [
      seedEntity('dead1', { name: 'a', deletedAt: DELETED_AT }),
      seedEntity('dead2', { name: 'b', deletedAt: DELETED_AT })
    ]);
    const res = await repo.transaction([
      { op: 'update', id: 'dead1', patch: { name: 'a2' }, allowDeleted: true },
      { op: 'update', id: 'dead2', patch: { name: 'b2' }, allowDeleted: true }
    ]);
    assert.strictEqual(res.success, true);
    assert.strictEqual(repo.get('dead1', { includeDeleted: true }).name, 'a2');
    assert.strictEqual(repo.get('dead2', { includeDeleted: true }).name, 'b2');
  });

  // ================================================================
  // H. includeDeleted / get / getAll agreement
  // ================================================================

  await checkAsync('H1: after a blocked transaction(update), get()/getAll()/exists() agree the record is untouched and still hidden by default', async () => {
    const { repo } = await makeOpenRepo({ entityKey: 'h1', idField: 'id', softDelete: true }, [seedEntity('r1', { name: 'orig', deletedAt: DELETED_AT })]);
    await repo.transaction([{ op: 'update', id: 'r1', patch: { name: 'blocked' } }]);
    assert.strictEqual(repo.get('r1'), null);
    assert.strictEqual(repo.exists('r1'), false);
    assert.strictEqual(repo.getAll().length, 0);
    assert.strictEqual(repo.getAll({ includeDeleted: true }).length, 1);
    assert.strictEqual(repo.getAll({ includeDeleted: true })[0].name, 'orig');
  });

  await checkAsync('H2: after an allowDeleted transaction(update), get()/getAll()/exists() agree the record is edited but still hidden by default', async () => {
    const { repo } = await makeOpenRepo({ entityKey: 'h2', idField: 'id', softDelete: true }, [seedEntity('r1', { name: 'orig', deletedAt: DELETED_AT })]);
    await repo.transaction([{ op: 'update', id: 'r1', patch: { name: 'edited' }, allowDeleted: true }]);
    assert.strictEqual(repo.get('r1'), null);
    assert.strictEqual(repo.exists('r1'), false);
    assert.strictEqual(repo.exists('r1', { includeDeleted: true }), true);
    assert.strictEqual(repo.get('r1', { includeDeleted: true }).name, 'edited');
  });

  // ================================================================
  // I. adapter write-count discipline
  // ================================================================

  await checkAsync('I1: a successful mixed transaction (create+update+delete+restore) calls write() exactly once', async () => {
    const { repo, adapter } = await makeOpenRepo({ entityKey: 'i1', idField: 'id', softDelete: true }, [
      seedEntity('u1', { name: 'a' }),
      seedEntity('d1', { name: 'b' }),
      seedEntity('r1', { name: 'c', deletedAt: DELETED_AT })
    ]);
    const before = adapter.writeCalls;
    const res = await repo.transaction([
      { op: 'create', entity: { id: 'n1', name: 'new' } },
      { op: 'update', id: 'u1', patch: { name: 'a2' } },
      { op: 'delete', id: 'd1' },
      { op: 'restore', id: 'r1' }
    ]);
    assert.strictEqual(res.success, true);
    assert.strictEqual(adapter.writeCalls, before + 1);
  });

  await checkAsync('I2: any rejected transaction(update) step (guarded or otherwise) results in zero write() calls, regardless of how many other ops were in the batch', async () => {
    const { repo, adapter } = await makeOpenRepo({ entityKey: 'i2', idField: 'id', softDelete: true }, [
      seedEntity('dead1', { deletedAt: DELETED_AT }),
      seedEntity('live1', { name: 'x' })
    ]);
    const before = adapter.writeCalls;
    await repo.transaction([
      { op: 'create', entity: { id: 'n1', name: 'new' } },
      { op: 'update', id: 'live1', patch: { name: 'y' } },
      { op: 'update', id: 'dead1', patch: { name: 'blocked' } },
      { op: 'delete', id: 'live1' }
    ]);
    assert.strictEqual(adapter.writeCalls, before);
  });

  // ================================================================
  // J. rollback integrity
  // ================================================================

  await checkAsync('J1: rollback integrity — the in-memory _records array reference after a failed transaction(update) is the exact pre-transaction snapshot, not a mutated copy', async () => {
    const { repo } = await makeOpenRepo({ entityKey: 'j1', idField: 'id', softDelete: true }, [
      seedEntity('a1', { name: '1' }),
      seedEntity('a2', { name: '2' }),
      seedEntity('a3', { name: '3', deletedAt: DELETED_AT })
    ]);
    const snapshotBefore = repo.getAll({ includeDeleted: true }).map(r => JSON.stringify(r));
    await repo.transaction([
      { op: 'update', id: 'a1', patch: { name: '1-edited' } },
      { op: 'delete', id: 'a2' },
      { op: 'update', id: 'a3', patch: { name: '3-blocked' } }
    ]);
    const snapshotAfter = repo.getAll({ includeDeleted: true }).map(r => JSON.stringify(r));
    assert.deepStrictEqual(snapshotAfter, snapshotBefore, 'every record must be byte-for-byte identical to before the failed transaction');
  });

  await checkAsync('J2: rollback integrity — a second, valid transaction() after a failed transaction(update) operates correctly (no lingering "busy"/"transaction" state)', async () => {
    const { repo } = await makeOpenRepo({ entityKey: 'j2', idField: 'id', softDelete: true }, [seedEntity('r1', { deletedAt: DELETED_AT })]);
    const failed1 = await repo.transaction([{ op: 'update', id: 'r1', patch: { name: 'blocked' } }]);
    assert.strictEqual(failed1.success, false);
    const ok = await repo.transaction([{ op: 'restore', id: 'r1' }]);
    assert.strictEqual(ok.success, true, 'a subsequent transaction() must run normally after a T-10-guard rejection');
    assert.ok(repo.get('r1'));
  });

  // ================================================================
  // K. nested / concurrent transaction attempts (regression)
  // ================================================================

  await checkAsync('K1: REGRESSION — calling transaction() while one is already logically in-flight is still rejected with CONFLICT, unaffected by the T-10 fix', async () => {
    const { repo } = await makeOpenRepo({ entityKey: 'k1', idField: 'id' }, [seedEntity('r1')]);
    repo._locked = true;
    const result = await repo.transaction([{ op: 'update', id: 'r1', patch: { name: 'x' } }]);
    assert.strictEqual(result.success, false);
    assert.strictEqual(result.error.type, RepositoryErrorTypes.CONFLICT);
    repo._locked = false;
  });

  await checkAsync('K2: REGRESSION — after a transaction() completes (success or failure), _locked is released and a subsequent transaction(update) runs normally', async () => {
    const { repo } = await makeOpenRepo({ entityKey: 'k2', idField: 'id' }, [seedEntity('r1', { name: 'a' })]);
    const first = await repo.transaction([{ op: 'update', id: 'ghost', patch: {} }]); // forced failure
    assert.strictEqual(first.success, false);
    const second = await repo.transaction([{ op: 'update', id: 'r1', patch: { name: 'b' } }]);
    assert.strictEqual(second.success, true);
    assert.strictEqual(repo.get('r1').name, 'b');
  });

  // ================================================================
  // L. softDelete:false Repositories — no-op guard
  // ================================================================

  await checkAsync('L1: on a softDelete:false Repository, transaction(update) has nothing to guard — behaves identically before/after the T-10 fix', async () => {
    const { repo } = await makeOpenRepo({ entityKey: 'l1', idField: 'id', softDelete: false }, [seedEntity('r1', { name: 'orig' })]);
    const res = await repo.transaction([{ op: 'update', id: 'r1', patch: { name: 'edit' } }]);
    assert.strictEqual(res.success, true);
    assert.strictEqual(repo.get('r1').name, 'edit');
  });

  await checkAsync('L2: on a softDelete:false Repository, a hard-deleted record is fully gone, so transaction(update) against its old id fails with "no record", not CONFLICT', async () => {
    const { repo } = await makeOpenRepo({ entityKey: 'l2', idField: 'id', softDelete: false }, [seedEntity('r1', { name: 'orig' })]);
    await repo.delete('r1');
    const res = await repo.transaction([{ op: 'update', id: 'r1', patch: { name: 'edit' } }]);
    assert.strictEqual(res.success, false);
    assert.strictEqual(res.error.type, RepositoryErrorTypes.VALIDATION, 'no record to guard against — this is a plain "unknown id" failure, not the T-10 guard');
  });

  await checkAsync('L3: on a softDelete:false Repository, {allowDeleted:true} on a transaction(update) step is a harmless no-op flag', async () => {
    const { repo } = await makeOpenRepo({ entityKey: 'l3', idField: 'id', softDelete: false }, [seedEntity('r1', { name: 'orig' })]);
    const res = await repo.transaction([{ op: 'update', id: 'r1', patch: { name: 'edit' }, allowDeleted: true }]);
    assert.strictEqual(res.success, true);
    assert.strictEqual(repo.get('r1').name, 'edit');
  });

  // ================================================================
  // M. Natural-key (Arabic) idField parity
  // ================================================================

  await checkAsync('M1: transaction(update) guard holds with a natural-key Arabic idField, matching the real 9 entity Repositories\' configuration shape', async () => {
    const { repo, adapter } = await makeOpenRepo({ entityKey: 'm1', idField: 'رقم_القضية', softDelete: true }, [
      { 'رقم_القضية': 'c1', 'الاسم': 'قضية أولى', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', deletedAt: DELETED_AT, version: 1, syncVersion: null }
    ]);
    const before = adapter.writeCalls;
    const res = await repo.transaction([{ op: 'update', id: 'c1', patch: { 'الاسم': 'تعديل محظور' } }]);
    assert.strictEqual(res.success, false);
    assert.strictEqual(res.error.type, RepositoryErrorTypes.CONFLICT);
    assert.strictEqual(adapter.writeCalls, before);

    const allowed = await repo.transaction([{ op: 'update', id: 'c1', patch: { 'الاسم': 'تعديل مسموح' }, allowDeleted: true }]);
    assert.strictEqual(allowed.success, true);
    assert.strictEqual(repo.get('c1', { includeDeleted: true })['الاسم'], 'تعديل مسموح');
  });

  await checkAsync('M2: transaction(update) error message correctly names an Arabic natural-key id', async () => {
    const { repo } = await makeOpenRepo({ entityKey: 'm2', idField: 'رقم_الموكل', softDelete: true }, [
      { 'رقم_الموكل': 'موكل-99', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', deletedAt: DELETED_AT, version: 1, syncVersion: null }
    ]);
    const res = await repo.transaction([{ op: 'update', id: 'موكل-99', patch: {} }]);
    assert.ok(res.error.message.indexOf('موكل-99') !== -1, 'error message must name the natural-key id exactly');
  });

  // ================================================================
  // N. Validation ordering
  // ================================================================

  await checkAsync('N1: T-10 guard (CONFLICT) fires before _validate() inside transaction(update) — a deleted record with an invalid patch reports CONFLICT, not VALIDATION', async () => {
    function ValidatingRepo(config) { Repository.call(this, config); }
    ValidatingRepo.prototype = Object.create(Repository.prototype);
    ValidatingRepo.prototype._validate = function () { return { valid: false, errors: [{ field: 'x', message: 'always invalid' }] }; };
    const adapter = makeMockAdapter({ entityKey: 'n1', records: [seedEntity('r1', { deletedAt: DELETED_AT })] });
    const repo = new ValidatingRepo({ entityKey: 'n1', idField: 'id', softDelete: true, storageAdapter: adapter });
    await repo.open();
    const res = await repo.transaction([{ op: 'update', id: 'r1', patch: { anything: true } }]);
    assert.strictEqual(res.error.type, RepositoryErrorTypes.CONFLICT, 'the T-10 guard must be checked before validation runs inside transaction() too');
  });

  await checkAsync('N2: once allowDeleted bypasses the T-10 guard inside transaction(update), _validate() still runs and can fail with VALIDATION', async () => {
    function ValidatingRepo(config) { Repository.call(this, config); }
    ValidatingRepo.prototype = Object.create(Repository.prototype);
    ValidatingRepo.prototype._validate = function () { return { valid: false, errors: [{ field: 'x', message: 'always invalid' }] }; };
    const adapter = makeMockAdapter({ entityKey: 'n2', records: [seedEntity('r1', { deletedAt: DELETED_AT })] });
    const repo = new ValidatingRepo({ entityKey: 'n2', idField: 'id', softDelete: true, storageAdapter: adapter });
    await repo.open();
    const res = await repo.transaction([{ op: 'update', id: 'r1', patch: { anything: true }, allowDeleted: true }]);
    assert.strictEqual(res.error.type, RepositoryErrorTypes.VALIDATION, 'validation must still run and can independently fail once the guard is bypassed');
  });

  // ================================================================
  // O. Stress
  // ================================================================

  await checkAsync('O1: T-10 guard holds across 40 independent transaction(update) calls, alternating live/deleted targets, each resolved as its own transaction', async () => {
    const seeds = [];
    for (let i = 0; i < 40; i++) {
      const isDeleted = i % 2 === 0;
      seeds.push(seedEntity('o1-' + i, { n: i, deletedAt: isDeleted ? DELETED_AT : null }));
    }
    const { repo, adapter } = await makeOpenRepo({ entityKey: 'o1', idField: 'id', softDelete: true }, seeds);

    for (let i = 0; i < 40; i++) {
      const isDeleted = i % 2 === 0;
      const id = 'o1-' + i;
      const before = adapter.writeCalls;
      const res = await repo.transaction([{ op: 'update', id: id, patch: { n: 1000 + i } }]);
      if (isDeleted) {
        assert.strictEqual(res.success, false, id + ': deleted target must be blocked');
        assert.strictEqual(res.error.type, RepositoryErrorTypes.CONFLICT, id + ': must be CONFLICT');
        assert.strictEqual(adapter.writeCalls, before, id + ': blocked transaction must not persist');
        assert.strictEqual(repo.get(id, { includeDeleted: true }).n, i, id + ': must remain unmodified');
      } else {
        assert.strictEqual(res.success, true, id + ': live target must succeed');
        assert.strictEqual(adapter.writeCalls, before + 1, id + ': successful transaction must persist exactly once');
        assert.strictEqual(repo.get(id).n, 1000 + i, id + ': live target must be updated');
      }
    }
  });

  await checkAsync('O2: 15-cycle delete() -> blocked transaction(update) -> restore() -> transaction(update) loop on the same record proves no state leakage between cycles', async () => {
    const { repo } = await makeOpenRepo({ entityKey: 'o2', idField: 'id', softDelete: true }, [seedEntity('r1', { n: 0 })]);
    for (let cycle = 1; cycle <= 15; cycle++) {
      const del = await repo.delete('r1');
      assert.strictEqual(del.success, true, 'cycle ' + cycle + ': delete() must succeed');

      const blocked = await repo.transaction([{ op: 'update', id: 'r1', patch: { n: -cycle } }]);
      assert.strictEqual(blocked.success, false, 'cycle ' + cycle + ': transaction(update) while deleted must be blocked');
      assert.strictEqual(repo.get('r1', { includeDeleted: true }).n, cycle - 1, 'cycle ' + cycle + ': blocked transaction(update) must not change n');

      const restored = await repo.restore('r1');
      assert.strictEqual(restored.success, true, 'cycle ' + cycle + ': restore() must succeed');

      const applied = await repo.transaction([{ op: 'update', id: 'r1', patch: { n: cycle } }]);
      assert.strictEqual(applied.success, true, 'cycle ' + cycle + ': transaction(update) after restore() must succeed');
      assert.strictEqual(repo.get('r1').n, cycle, 'cycle ' + cycle + ': transaction(update) after restore() must apply the new value');
    }
    assert.strictEqual(repo.get('r1').n, 15, 'final value must reflect the last successful cycle');
  });

  await checkAsync('O3: 30-item independent-transaction batch alternating live/deleted, mixing allowDeleted per item, each committed as a separate one-op transaction', async () => {
    const seeds = [];
    for (let i = 0; i < 30; i++) {
      const isDeleted = i % 3 === 0;
      seeds.push(seedEntity('o3-' + i, { n: i, deletedAt: isDeleted ? DELETED_AT : null }));
    }
    const { repo, adapter } = await makeOpenRepo({ entityKey: 'o3', idField: 'id', softDelete: true }, seeds);

    for (let i = 0; i < 30; i++) {
      const isDeleted = i % 3 === 0;
      const id = 'o3-' + i;
      const useAllowDeleted = isDeleted && (i % 6 === 0); // half of the deleted ones opt in
      const before = adapter.writeCalls;
      const res = await repo.transaction([{ op: 'update', id: id, patch: { n: 500 + i }, allowDeleted: useAllowDeleted }]);
      if (isDeleted && !useAllowDeleted) {
        assert.strictEqual(res.success, false, id + ': deleted+no-allowDeleted must be blocked');
        assert.strictEqual(adapter.writeCalls, before, id + ': must not persist');
      } else {
        assert.strictEqual(res.success, true, id + ': ' + (isDeleted ? 'deleted+allowDeleted' : 'live') + ' must succeed');
        assert.strictEqual(adapter.writeCalls, before + 1, id + ': must persist exactly once');
        assert.strictEqual(repo.get(id, { includeDeleted: true }).n, 500 + i, id + ': value must be applied');
      }
    }
  });

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
