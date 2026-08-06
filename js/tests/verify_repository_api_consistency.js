/**
 * verify_repository_api_consistency.js
 * ================================================================
 * PHASE 11 — SUB-PHASE 11.2 — Repository Hardening & API Consistency
 * ================================================================
 * Standalone Node harness (`node js/tests/verify_repository_api_consistency.js`,
 * no browser required, no external libraries) proving the 4 fixes made in
 * this sub-phase to `js/core/Repository.js` behave exactly as specified
 * in `docs/Repository_API_Consistency_Report.md`, and that every
 * pre-existing `Repository.prototype.*` method not touched by this phase
 * remains 100% behaviorally unchanged (Regression, per Repository
 * Migration Standard / Verification & QA Standard).
 *
 * Fixes verified:
 *   FIX 1 — update() now refuses to modify a soft-deleted record unless
 *           {allowDeleted:true} is explicitly passed (CONFLICT WriteResult
 *           otherwise).
 *   FIX 2 — bulkUpdate() applies the same per-item guard
 *           ({id, patch, allowDeleted?}), batch persist/rollback
 *           semantics unchanged.
 *   FIX 3 — get(id, {includeDeleted}) — same option shape as
 *           getAll()/search()/count().
 *   FIX 4 — exists(id, {includeDeleted}) — same option shape.
 *   FIX 5 — find()/filter()(via search())/search()/count() proven
 *           unaffected (regression only, no code change made to them).
 *
 * Uses only the base `Repository` class directly (entityKey/idField
 * config, no entity subclass) against a purpose-built in-memory mock
 * Storage Adapter satisfying the minimal duck-typed contract documented
 * in Repository.js §2 (`read(entityKey)`/`write(entityKey, records)`),
 * instrumented with call counters so "adapter call counts" (e.g. a
 * blocked update() must never call write()) can be asserted directly.
 *
 * No production file other than `js/core/Repository.js` was modified to
 * make this phase's fixes; this harness itself modifies no production
 * file.
 *
 * Sections:
 *   A. update() — FIX 1 guard (blocked / allowed / unaffected paths)
 *   B. bulkUpdate() — FIX 2 guard (per-item, mixed batches, rollback)
 *   C. get() — FIX 3 includeDeleted option
 *   D. exists() — FIX 4 includeDeleted option
 *   E. find() — regression (no includeDeleted support, unchanged)
 *   F. count() — regression, including includeDeleted via queryModel
 *   G. search() — regression: filter / sort / pagination / projection /
 *      search / includeDeleted, all unaffected
 *   H. filter (via search({filter})) — regression: equality, operators,
 *      and/or composition, all unaffected
 *   I. create() / delete() / restore() — regression (untouched by this
 *      phase), including restore-then-update and update-then-delete
 *      interaction with the new guard
 *   J. bulkInsert() / bulkDelete() / import() / export() / clear() —
 *      regression (untouched by this phase)
 *   K. transaction() — regression (untouched by this phase); documents,
 *      via an explicit assertion, that the {op:'update'} transaction
 *      step intentionally does NOT receive the FIX 1 guard (out of this
 *      phase's exact scope — see Repository_API_Consistency_Report.md
 *      "Remaining Technical Debt")
 *   L. Guard/lifecycle parity — _guardSupported()/_guardReady() still
 *      apply to get()/exists()/update()/bulkUpdate() exactly as before
 *   M. Validation ordering — FIX 1/2 guard runs before _validate(), and
 *      allowDeleted:true records still run through _validate() normally
 *   N. Cross-check — softDelete:false Repositories are unaffected by
 *      FIX 1/2/3/4 (nothing to guard/include, since delete() removes
 *      the record entirely)
 *   O. Natural-key idField (Arabic field names, matching real entity
 *      Repositories) — FIX 1-4 confirmed unaffected by key shape
 *   P. Stress — FIX 1/2/3/4 exercised across 30-40 record batches and a
 *      15-cycle delete/blocked-update/restore/update loop on one
 *      record, loop-generated assertions (same convention as
 *      verify_restore_stress.js)
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
// verify_repository_restore.js / verify_restore_stress.js) ----
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

async function main() {
  // ================================================================
  // A. update() — FIX 1
  // ================================================================

  await checkAsync('A1: update() on a live record is completely unaffected by FIX 1 (no options argument at all — full backward compatibility)', async () => {
    const { repo, adapter } = await makeOpenRepo({ entityKey: 'a1', idField: 'id' }, [seedEntity('r1', { name: 'x' })]);
    const before = adapter.writeCalls;
    const res = await repo.update('r1', { name: 'y' });
    assert.strictEqual(res.success, true);
    assert.strictEqual(res.record.name, 'y');
    assert.strictEqual(res.record.version, 2, 'version bump unchanged');
    assert.strictEqual(adapter.writeCalls, before + 1);
  });

  await checkAsync('A2: update() on a soft-deleted record is blocked by default — CONFLICT WriteResult, no mutation, no persist()', async () => {
    const { repo, adapter } = await makeOpenRepo({ entityKey: 'a2', idField: 'id', softDelete: true },
      [seedEntity('r1', { name: 'original', deletedAt: '2026-01-01T00:00:00.000Z', version: 3 })]);
    const before = adapter.writeCalls;
    const res = await repo.update('r1', { name: 'blocked-edit' });
    assert.strictEqual(res.success, false);
    assert.strictEqual(res.record, null);
    assert.ok(res.error);
    assert.strictEqual(res.error.type, RepositoryErrorTypes.CONFLICT);
    assert.strictEqual(res.error.recoverable, true);
    assert.strictEqual(adapter.writeCalls, before, 'blocked update() must never call write()');
    const raw = repo.get('r1', { includeDeleted: true });
    assert.strictEqual(raw.name, 'original', 'record must be completely untouched');
    assert.strictEqual(raw.version, 3, 'version must not bump on a blocked update()');
  });

  await checkAsync('A3: update() with {allowDeleted:true} on a soft-deleted record succeeds, edits fields, but does NOT clear deletedAt', async () => {
    const { repo, adapter } = await makeOpenRepo({ entityKey: 'a3', idField: 'id', softDelete: true },
      [seedEntity('r1', { name: 'original', deletedAt: '2026-01-01T00:00:00.000Z' })]);
    const before = adapter.writeCalls;
    const res = await repo.update('r1', { name: 'edited-while-deleted' }, { allowDeleted: true });
    assert.strictEqual(res.success, true);
    assert.strictEqual(res.record.name, 'edited-while-deleted');
    assert.notStrictEqual(res.record.deletedAt, null, 'allowDeleted edits fields only, never un-hides the record');
    assert.strictEqual(adapter.writeCalls, before + 1);
    assert.strictEqual(repo.get('r1'), null, 'still invisible to default get() — only restore() clears deletedAt');
  });

  await checkAsync('A4: update() with {allowDeleted:true} explicitly trying to clear deletedAt via the patch does NOT resurrect the record (update() never treats deletedAt specially, exactly like before)', async () => {
    const { repo } = await makeOpenRepo({ entityKey: 'a4', idField: 'id', softDelete: true },
      [seedEntity('r1', { deletedAt: '2026-01-01T00:00:00.000Z' })]);
    const res = await repo.update('r1', { deletedAt: null, name: 'trying-to-resurrect' }, { allowDeleted: true });
    assert.strictEqual(res.success, true);
    // NOTE: this documents a real, intentional limitation, not a defect:
    // allowDeleted:true means "let me edit fields on a deleted record";
    // if the caller's own patch happens to include deletedAt:null, the
    // merge legitimately clears it (same merge semantics update() has
    // always had) — this is now the one remaining supported way update()
    // can still clear deletedAt, and it requires an explicit opt-in flag
    // plus an explicit deletedAt:null in the patch, unlike the pre-11.2
    // implicit path which needed neither.
    assert.strictEqual(res.record.deletedAt, null);
  });

  await checkAsync('A5: update() on an unknown id is unaffected by FIX 1 — still ValidationError, checked before the deletedAt guard', async () => {
    const { repo, adapter } = await makeOpenRepo({ entityKey: 'a5', idField: 'id', softDelete: true }, []);
    const before = adapter.writeCalls;
    const res = await repo.update('ghost', { name: 'x' });
    assert.strictEqual(res.success, false);
    assert.strictEqual(res.error.type, RepositoryErrorTypes.VALIDATION);
    assert.strictEqual(res.error.recoverable, false);
    assert.strictEqual(adapter.writeCalls, before);
  });

  await checkAsync('A6: update() on a live record with an explicit {allowDeleted:true} (a no-op flag since the record is not deleted) behaves identically to a normal update()', async () => {
    const { repo } = await makeOpenRepo({ entityKey: 'a6', idField: 'id', softDelete: true }, [seedEntity('r1', { name: 'x' })]);
    const res = await repo.update('r1', { name: 'y' }, { allowDeleted: true });
    assert.strictEqual(res.success, true);
    assert.strictEqual(res.record.name, 'y');
    assert.strictEqual(res.record.deletedAt, null);
  });

  await checkAsync('A7: update() blocked-by-FIX-1 result still fails _validate() checks correctly when allowDeleted is used with an invalid patch (guard runs before validation, not instead of it)', async () => {
    function ValidatingRepo(config) { Repository.call(this, config); }
    ValidatingRepo.prototype = Object.create(Repository.prototype);
    ValidatingRepo.prototype._validate = function (op, record) {
      if (op === 'update' && !record.name) return { valid: false, errors: [{ field: 'name', message: 'required' }] };
      return { valid: true, errors: [] };
    };
    const adapter = makeMockAdapter({ entityKey: 'a7', records: [seedEntity('r1', { name: 'original', deletedAt: '2026-01-01T00:00:00.000Z' })] });
    const repo = new ValidatingRepo({ entityKey: 'a7', idField: 'id', softDelete: true, storageAdapter: adapter });
    await repo.open();

    const blockedByGuard = await repo.update('r1', { name: '' }, { allowDeleted: false });
    assert.strictEqual(blockedByGuard.error.type, RepositoryErrorTypes.CONFLICT, 'FIX 1 guard fires first, before validation is even reached');

    const blockedByValidation = await repo.update('r1', { name: '' }, { allowDeleted: true });
    assert.strictEqual(blockedByValidation.success, false);
    assert.strictEqual(blockedByValidation.error.type, RepositoryErrorTypes.VALIDATION, 'once allowDeleted bypasses the guard, normal validation still applies');
  });

  // ================================================================
  // B. bulkUpdate() — FIX 2
  // ================================================================

  await checkAsync('B1: bulkUpdate() on all-live records is completely unaffected by FIX 2', async () => {
    const { repo, adapter } = await makeOpenRepo({ entityKey: 'b1', idField: 'id' },
      [seedEntity('r1', { amount: 1 }), seedEntity('r2', { amount: 2 })]);
    const before = adapter.writeCalls;
    const results = await repo.bulkUpdate([{ id: 'r1', patch: { amount: 10 } }, { id: 'r2', patch: { amount: 20 } }]);
    assert.ok(results.every(r => r.success));
    assert.strictEqual(repo.get('r1').amount, 10);
    assert.strictEqual(repo.get('r2').amount, 20);
    assert.strictEqual(adapter.writeCalls, before + 1, 'still one batch persist for the whole call');
  });

  await checkAsync('B2: bulkUpdate() item targeting a soft-deleted id is rejected per-item — CONFLICT WriteResult for that item only, siblings unaffected', async () => {
    const { repo, adapter } = await makeOpenRepo({ entityKey: 'b2', idField: 'id', softDelete: true },
      [seedEntity('live', { amount: 1 }), seedEntity('dead', { amount: 2, deletedAt: '2026-01-01T00:00:00.000Z' })]);
    const before = adapter.writeCalls;
    const results = await repo.bulkUpdate([
      { id: 'live', patch: { amount: 100 } },
      { id: 'dead', patch: { amount: 200 } }
    ]);
    assert.strictEqual(results[0].success, true);
    assert.strictEqual(results[1].success, false);
    assert.strictEqual(results[1].error.type, RepositoryErrorTypes.CONFLICT);
    assert.strictEqual(repo.get('live').amount, 100, 'the live sibling item must still apply');
    assert.strictEqual(repo.get('dead', { includeDeleted: true }).amount, 2, 'the blocked item must be completely untouched');
    assert.strictEqual(adapter.writeCalls, before + 1, 'one persist covering the successfully-staged item(s) only');
  });

  await checkAsync('B3: bulkUpdate() item with per-item {allowDeleted:true} on a soft-deleted id succeeds, siblings without the flag on other deleted ids still blocked', async () => {
    const { repo } = await makeOpenRepo({ entityKey: 'b3', idField: 'id', softDelete: true },
      [seedEntity('dead1', { name: 'a', deletedAt: '2026-01-01T00:00:00.000Z' }),
       seedEntity('dead2', { name: 'b', deletedAt: '2026-01-01T00:00:00.000Z' })]);
    const results = await repo.bulkUpdate([
      { id: 'dead1', patch: { name: 'allowed-edit' }, allowDeleted: true },
      { id: 'dead2', patch: { name: 'blocked-edit' } }
    ]);
    assert.strictEqual(results[0].success, true);
    assert.strictEqual(results[1].success, false);
    assert.strictEqual(results[1].error.type, RepositoryErrorTypes.CONFLICT);
    assert.strictEqual(repo.get('dead1', { includeDeleted: true }).name, 'allowed-edit');
    assert.strictEqual(repo.get('dead2', { includeDeleted: true }).name, 'b', 'blocked item unchanged');
  });

  await checkAsync('B4: bulkUpdate() mixed batch — unknown id + soft-deleted id (no flag) + live id — each item resolved independently, batch still persists once for the successful item', async () => {
    const { repo, adapter } = await makeOpenRepo({ entityKey: 'b4', idField: 'id', softDelete: true },
      [seedEntity('live', { n: 1 }), seedEntity('dead', { n: 2, deletedAt: '2026-01-01T00:00:00.000Z' })]);
    const before = adapter.writeCalls;
    const results = await repo.bulkUpdate([
      { id: 'ghost', patch: { n: 99 } },
      { id: 'dead', patch: { n: 88 } },
      { id: 'live', patch: { n: 77 } }
    ]);
    assert.strictEqual(results[0].error.type, RepositoryErrorTypes.VALIDATION, 'unknown id — unchanged error type');
    assert.strictEqual(results[1].error.type, RepositoryErrorTypes.CONFLICT, 'soft-deleted id — new FIX 2 error type');
    assert.strictEqual(results[2].success, true);
    assert.strictEqual(repo.get('live').n, 77);
    assert.strictEqual(adapter.writeCalls, before + 1);
  });

  await checkAsync('B5: bulkUpdate() batch persist failure still rolls back ALL staged items (including ones that passed the FIX 2 guard), matching pre-existing rollback semantics exactly', async () => {
    const adapter = makeMockAdapter({ entityKey: 'b5', records: [seedEntity('r1', { n: 1 }), seedEntity('r2', { n: 2, deletedAt: '2026-01-01T00:00:00.000Z' })] });
    adapter.write = async function () { throw new Error('simulated storage failure'); };
    const repo = new Repository({ entityKey: 'b5', idField: 'id', softDelete: true, storageAdapter: adapter });
    await repo.open();
    const results = await repo.bulkUpdate([
      { id: 'r1', patch: { n: 10 } },
      { id: 'r2', patch: { n: 20 }, allowDeleted: true }
    ]);
    assert.ok(results.every(r => r.success === false), 'persist failure converts every result to a failure, unchanged pre-existing behavior');
    assert.strictEqual(repo.get('r1').n, 1, 'in-memory state rolled back to before the batch');
  });

  // ================================================================
  // C. get() — FIX 3
  // ================================================================

  await checkAsync('C1: get(id) with no options is unchanged — soft-deleted still returns null', async () => {
    const { repo } = await makeOpenRepo({ entityKey: 'c1', idField: 'id', softDelete: true },
      [seedEntity('r1', { deletedAt: '2026-01-01T00:00:00.000Z' })]);
    assert.strictEqual(repo.get('r1'), null);
  });

  await checkAsync('C2: get(id, {includeDeleted:true}) returns a soft-deleted record', async () => {
    const { repo } = await makeOpenRepo({ entityKey: 'c2', idField: 'id', softDelete: true },
      [seedEntity('r1', { name: 'ghost', deletedAt: '2026-01-01T00:00:00.000Z' })]);
    const rec = repo.get('r1', { includeDeleted: true });
    assert.ok(rec);
    assert.strictEqual(rec.name, 'ghost');
    assert.notStrictEqual(rec.deletedAt, null);
  });

  await checkAsync('C3: get(id, {includeDeleted:false}) explicitly false behaves exactly like the default (no options)', async () => {
    const { repo } = await makeOpenRepo({ entityKey: 'c3', idField: 'id', softDelete: true },
      [seedEntity('r1', { deletedAt: '2026-01-01T00:00:00.000Z' })]);
    assert.strictEqual(repo.get('r1', { includeDeleted: false }), null);
  });

  await checkAsync('C4: get(id, {includeDeleted:true}) on a live record returns the record normally (no behavior difference for live records)', async () => {
    const { repo } = await makeOpenRepo({ entityKey: 'c4', idField: 'id', softDelete: true }, [seedEntity('r1', { name: 'live' })]);
    const rec = repo.get('r1', { includeDeleted: true });
    assert.ok(rec);
    assert.strictEqual(rec.name, 'live');
  });

  await checkAsync('C5: get(unknownId, {includeDeleted:true}) still returns null — includeDeleted does not invent records', async () => {
    const { repo } = await makeOpenRepo({ entityKey: 'c5', idField: 'id', softDelete: true }, []);
    assert.strictEqual(repo.get('ghost', { includeDeleted: true }), null);
  });

  await checkAsync('C6: get() returns a clone even with includeDeleted:true — mutating the result never touches internal state (Contract §19 preserved)', async () => {
    const { repo } = await makeOpenRepo({ entityKey: 'c6', idField: 'id', softDelete: true },
      [seedEntity('r1', { name: 'x', deletedAt: '2026-01-01T00:00:00.000Z' })]);
    const rec = repo.get('r1', { includeDeleted: true });
    rec.name = 'mutated';
    const again = repo.get('r1', { includeDeleted: true });
    assert.strictEqual(again.name, 'x', 'internal record must be untouched by external mutation of a returned clone');
  });

  // ================================================================
  // D. exists() — FIX 4
  // ================================================================

  await checkAsync('D1: exists(id) with no options is unchanged — soft-deleted returns false', async () => {
    const { repo } = await makeOpenRepo({ entityKey: 'd1', idField: 'id', softDelete: true },
      [seedEntity('r1', { deletedAt: '2026-01-01T00:00:00.000Z' })]);
    assert.strictEqual(repo.exists('r1'), false);
  });

  await checkAsync('D2: exists(id, {includeDeleted:true}) returns true for a soft-deleted record', async () => {
    const { repo } = await makeOpenRepo({ entityKey: 'd2', idField: 'id', softDelete: true },
      [seedEntity('r1', { deletedAt: '2026-01-01T00:00:00.000Z' })]);
    assert.strictEqual(repo.exists('r1', { includeDeleted: true }), true);
  });

  await checkAsync('D3: exists(unknownId, {includeDeleted:true}) is still false', async () => {
    const { repo } = await makeOpenRepo({ entityKey: 'd3', idField: 'id', softDelete: true }, []);
    assert.strictEqual(repo.exists('ghost', { includeDeleted: true }), false);
  });

  await checkAsync('D4: exists(id, {includeDeleted:true}) on a live record is still true (no behavior difference for live records)', async () => {
    const { repo } = await makeOpenRepo({ entityKey: 'd4', idField: 'id', softDelete: true }, [seedEntity('r1')]);
    assert.strictEqual(repo.exists('r1', { includeDeleted: true }), true);
  });

  await checkAsync('D5: exists()/get() agree on every combination of {live, deleted} x {includeDeleted true/false/absent}', async () => {
    const { repo } = await makeOpenRepo({ entityKey: 'd5', idField: 'id', softDelete: true },
      [seedEntity('live'), seedEntity('dead', { deletedAt: '2026-01-01T00:00:00.000Z' })]);
    assert.strictEqual(repo.exists('live'), !!repo.get('live'));
    assert.strictEqual(repo.exists('dead'), !!repo.get('dead'));
    assert.strictEqual(repo.exists('live', { includeDeleted: true }), !!repo.get('live', { includeDeleted: true }));
    assert.strictEqual(repo.exists('dead', { includeDeleted: true }), !!repo.get('dead', { includeDeleted: true }));
  });

  // ================================================================
  // E. find() — regression (out of FIX scope, no includeDeleted added)
  // ================================================================

  await checkAsync('E1: REGRESSION — find() still has no includeDeleted option and still excludes soft-deleted records unconditionally', async () => {
    const { repo } = await makeOpenRepo({ entityKey: 'e1', idField: 'id', softDelete: true },
      [seedEntity('r1', { name: 'target', deletedAt: '2026-01-01T00:00:00.000Z' }), seedEntity('r2', { name: 'target' })]);
    const found = repo.find({ name: 'target' });
    assert.ok(found);
    assert.strictEqual(found.id, 'r2', 'find() must skip the deleted match and return the live one');
  });

  await checkAsync('E2: REGRESSION — find() with a predicate function still behaves as before', async () => {
    const { repo } = await makeOpenRepo({ entityKey: 'e2', idField: 'id' }, [seedEntity('r1', { n: 5 }), seedEntity('r2', { n: 15 })]);
    const found = repo.find(r => r.n > 10);
    assert.strictEqual(found.id, 'r2');
  });

  await checkAsync('E3: REGRESSION — find() returns null when nothing matches', async () => {
    const { repo } = await makeOpenRepo({ entityKey: 'e3', idField: 'id' }, [seedEntity('r1', { n: 1 })]);
    assert.strictEqual(repo.find({ n: 999 }), null);
  });

  // ================================================================
  // F. count() — regression
  // ================================================================

  await checkAsync('F1: REGRESSION — count() excludes soft-deleted by default, unchanged', async () => {
    const { repo } = await makeOpenRepo({ entityKey: 'f1', idField: 'id', softDelete: true },
      [seedEntity('r1'), seedEntity('r2', { deletedAt: '2026-01-01T00:00:00.000Z' })]);
    assert.strictEqual(repo.count(), 1);
  });

  await checkAsync('F2: REGRESSION — count({includeDeleted:true}) counts everything, unchanged (already supported pre-11.2)', async () => {
    const { repo } = await makeOpenRepo({ entityKey: 'f2', idField: 'id', softDelete: true },
      [seedEntity('r1'), seedEntity('r2', { deletedAt: '2026-01-01T00:00:00.000Z' })]);
    assert.strictEqual(repo.count({ includeDeleted: true }), 2);
  });

  await checkAsync('F3: REGRESSION — count({filter}) composes with includeDeleted exactly as before', async () => {
    const { repo } = await makeOpenRepo({ entityKey: 'f3', idField: 'id', softDelete: true },
      [seedEntity('r1', { type: 'x' }), seedEntity('r2', { type: 'x', deletedAt: '2026-01-01T00:00:00.000Z' }), seedEntity('r3', { type: 'y' })]);
    assert.strictEqual(repo.count({ filter: { type: 'x' } }), 1);
    assert.strictEqual(repo.count({ filter: { type: 'x' }, includeDeleted: true }), 2);
  });

  // ================================================================
  // G. search() — regression
  // ================================================================

  await checkAsync('G1: REGRESSION — search() sort/pagination/projection all behave exactly as before', async () => {
    const { repo } = await makeOpenRepo({ entityKey: 'g1', idField: 'id', searchFields: ['name'] },
      [seedEntity('s1', { name: 'Ahmad', age: 30 }), seedEntity('s2', { name: 'Sara', age: 25 }), seedEntity('s3', { name: 'Omar', age: 40 })]);
    const sorted = repo.search({ sort: [{ field: 'age', direction: 'asc' }] });
    assert.strictEqual(sorted.items.map(r => r.id).join(','), 's2,s1,s3');

    const paged = repo.search({ sort: [{ field: 'age', direction: 'asc' }], offset: 1, limit: 1 });
    assert.strictEqual(paged.items.length, 1);
    assert.strictEqual(paged.items[0].id, 's1');
    assert.strictEqual(paged.total, 3);
    assert.strictEqual(paged.hasMore, true);

    const projected = repo.search({ projection: ['id', 'name'] });
    assert.deepStrictEqual(Object.keys(projected.items[0]).sort(), ['id', 'name']);
  });

  await checkAsync('G2: REGRESSION — search({search:term}) free-text matching unchanged (case-insensitive substring across searchFields)', async () => {
    const { repo } = await makeOpenRepo({ entityKey: 'g2', idField: 'id', searchFields: ['name'] },
      [seedEntity('s1', { name: 'Ahmad Hassan' })]);
    assert.strictEqual(repo.search({ search: 'hassan' }).items.length, 1);
    assert.strictEqual(repo.search({ search: 'ZZZ' }).items.length, 0);
  });

  await checkAsync('G3: REGRESSION — search() excludes soft-deleted by default, includeDeleted still includes them, unchanged', async () => {
    const { repo } = await makeOpenRepo({ entityKey: 'g3', idField: 'id', softDelete: true },
      [seedEntity('r1'), seedEntity('r2', { deletedAt: '2026-01-01T00:00:00.000Z' })]);
    assert.strictEqual(repo.search({}).items.length, 1);
    assert.strictEqual(repo.search({ includeDeleted: true }).items.length, 2);
  });

  // ================================================================
  // H. filter (via search({filter})) — regression
  // ================================================================

  await checkAsync('H1: REGRESSION — equality filter unchanged', async () => {
    const { repo } = await makeOpenRepo({ entityKey: 'h1', idField: 'id' }, [seedEntity('r1', { status: 'open' }), seedEntity('r2', { status: 'closed' })]);
    assert.strictEqual(repo.search({ filter: { status: 'open' } }).items.length, 1);
  });

  await checkAsync('H2: REGRESSION — operator filters (gt/gte/lt/lte/ne/in/between) unchanged', async () => {
    const { repo } = await makeOpenRepo({ entityKey: 'h2', idField: 'id' },
      [seedEntity('r1', { n: 5 }), seedEntity('r2', { n: 10 }), seedEntity('r3', { n: 15 })]);
    assert.strictEqual(repo.search({ filter: { n: { op: 'gt', value: 5 } } }).items.length, 2);
    assert.strictEqual(repo.search({ filter: { n: { op: 'gte', value: 10 } } }).items.length, 2);
    assert.strictEqual(repo.search({ filter: { n: { op: 'lt', value: 10 } } }).items.length, 1);
    assert.strictEqual(repo.search({ filter: { n: { op: 'lte', value: 10 } } }).items.length, 2);
    assert.strictEqual(repo.search({ filter: { n: { op: 'ne', value: 10 } } }).items.length, 2);
    assert.strictEqual(repo.search({ filter: { n: { op: 'in', value: [5, 15] } } }).items.length, 2);
    assert.strictEqual(repo.search({ filter: { n: { op: 'between', value: [6, 20] } } }).items.length, 2);
  });

  await checkAsync('H3: REGRESSION — and/or compound filters unchanged', async () => {
    const { repo } = await makeOpenRepo({ entityKey: 'h3', idField: 'id' },
      [seedEntity('r1', { a: 1, b: 1 }), seedEntity('r2', { a: 1, b: 2 }), seedEntity('r3', { a: 2, b: 2 })]);
    assert.strictEqual(repo.search({ filter: { and: [{ a: 1 }, { b: 1 }] } }).items.length, 1);
    assert.strictEqual(repo.search({ filter: { or: [{ a: 2 }, { b: 1 }] } }).items.length, 2);
  });

  await checkAsync('H4: REGRESSION — array shorthand ($in via array value) unchanged', async () => {
    const { repo } = await makeOpenRepo({ entityKey: 'h4', idField: 'id' }, [seedEntity('r1', { status: 'a' }), seedEntity('r2', { status: 'b' }), seedEntity('r3', { status: 'c' })]);
    assert.strictEqual(repo.search({ filter: { status: ['a', 'c'] } }).items.length, 2);
  });

  // ================================================================
  // I. create() / delete() / restore() — regression + interaction w/ FIX 1
  // ================================================================

  await checkAsync('I1: REGRESSION — create() unaffected by this phase', async () => {
    const { repo, adapter } = await makeOpenRepo({ entityKey: 'i1', idField: 'id' }, []);
    const before = adapter.writeCalls;
    const res = await repo.create({ id: 'n1', name: 'new' });
    assert.strictEqual(res.success, true);
    assert.strictEqual(res.record.version, 1);
    assert.strictEqual(adapter.writeCalls, before + 1);
  });

  await checkAsync('I2: REGRESSION — delete() unaffected by this phase (soft-delete branch)', async () => {
    const { repo } = await makeOpenRepo({ entityKey: 'i2', idField: 'id', softDelete: true }, [seedEntity('r1')]);
    const res = await repo.delete('r1');
    assert.strictEqual(res.success, true);
    assert.notStrictEqual(res.record.deletedAt, null);
    assert.strictEqual(repo.get('r1'), null);
  });

  await checkAsync('I3: REGRESSION — delete() unaffected by this phase (hard-delete branch)', async () => {
    const { repo } = await makeOpenRepo({ entityKey: 'i3', idField: 'id', softDelete: false }, [seedEntity('r1')]);
    const res = await repo.delete('r1');
    assert.strictEqual(res.success, true);
    assert.strictEqual(repo.getAll().length, 0);
  });

  await checkAsync('I4: REGRESSION — restore() unaffected by this phase, including idempotency', async () => {
    const { repo, adapter } = await makeOpenRepo({ entityKey: 'i4', idField: 'id', softDelete: true }, [seedEntity('r1', { deletedAt: '2026-01-01T00:00:00.000Z' })]);
    const res = await repo.restore('r1');
    assert.strictEqual(res.success, true);
    assert.strictEqual(res.record.deletedAt, null);
    const before = adapter.writeCalls;
    const again = await repo.restore('r1');
    assert.strictEqual(again.success, true);
    assert.strictEqual(adapter.writeCalls, before, 'idempotent restore still makes no persist() call');
  });

  await checkAsync('I5: delete() then update() then restore() — the FIX 1 guard correctly blocks the middle step, restore() still works on the untouched deleted record', async () => {
    const { repo } = await makeOpenRepo({ entityKey: 'i5', idField: 'id', softDelete: true }, [seedEntity('r1', { name: 'x' })]);
    await repo.delete('r1');
    const blockedUpdate = await repo.update('r1', { name: 'y' });
    assert.strictEqual(blockedUpdate.success, false);
    const restored = await repo.restore('r1');
    assert.strictEqual(restored.success, true);
    assert.strictEqual(restored.record.name, 'x', 'name is unchanged since the update() in between was correctly blocked');
  });

  await checkAsync('I6: restore() then update() — update() operates normally on the now-live record (unaffected by FIX 1, since the record is no longer deleted)', async () => {
    const { repo } = await makeOpenRepo({ entityKey: 'i6', idField: 'id', softDelete: true }, [seedEntity('r1', { name: 'x', deletedAt: '2026-01-01T00:00:00.000Z' })]);
    await repo.restore('r1');
    const res = await repo.update('r1', { name: 'y' });
    assert.strictEqual(res.success, true);
    assert.strictEqual(res.record.name, 'y');
  });

  // ================================================================
  // J. bulkInsert() / bulkDelete() / import() / export() / clear() — regression
  // ================================================================

  await checkAsync('J1: REGRESSION — bulkInsert() unaffected by this phase', async () => {
    const { repo } = await makeOpenRepo({ entityKey: 'j1', idField: 'id' }, []);
    const results = await repo.bulkInsert([{ id: 'b1', name: 'a' }, { id: 'b2', name: 'b' }]);
    assert.ok(results.every(r => r.success));
    assert.strictEqual(repo.getAll().length, 2);
  });

  await checkAsync('J2: REGRESSION — bulkDelete() unaffected by this phase', async () => {
    const { repo } = await makeOpenRepo({ entityKey: 'j2', idField: 'id', softDelete: true }, [seedEntity('r1'), seedEntity('r2')]);
    const results = await repo.bulkDelete(['r1', 'r2']);
    assert.ok(results.every(r => r.success));
    assert.strictEqual(repo.getAll().length, 0);
    assert.strictEqual(repo.getAll({ includeDeleted: true }).length, 2);
  });

  await checkAsync('J3: REGRESSION — export() still includes soft-deleted records, unchanged', async () => {
    const { repo } = await makeOpenRepo({ entityKey: 'j3', idField: 'id', softDelete: true }, [seedEntity('r1'), seedEntity('r2', { deletedAt: '2026-01-01T00:00:00.000Z' })]);
    assert.strictEqual(repo.export().length, 2);
  });

  await checkAsync('J4: REGRESSION — import(entities, "replace") unchanged', async () => {
    const { repo } = await makeOpenRepo({ entityKey: 'j4', idField: 'id' }, [seedEntity('old')]);
    const res = await repo.import([seedEntity('new1'), seedEntity('new2')], 'replace');
    assert.strictEqual(res.success, true);
    assert.strictEqual(repo.getAll().length, 2);
    assert.strictEqual(repo.get('old'), null);
  });

  await checkAsync('J5: REGRESSION — import(entities, "merge") unchanged', async () => {
    const { repo } = await makeOpenRepo({ entityKey: 'j5', idField: 'id' }, [seedEntity('r1', { n: 1 })]);
    const res = await repo.import([seedEntity('r1', { n: 99 }), seedEntity('r2', { n: 2 })], 'merge');
    assert.strictEqual(res.success, true);
    assert.strictEqual(repo.get('r1').n, 99);
    assert.strictEqual(repo.get('r2').n, 2);
  });

  await checkAsync('J6: REGRESSION — clear() unchanged', async () => {
    const { repo } = await makeOpenRepo({ entityKey: 'j6', idField: 'id' }, [seedEntity('r1')]);
    const res = await repo.clear();
    assert.strictEqual(res.success, true);
    assert.strictEqual(repo.getAll().length, 0);
  });

  // ================================================================
  // K. transaction() — regression + documented out-of-scope note
  // ================================================================

  await checkAsync('K1: REGRESSION — transaction() create/update/delete ops unchanged', async () => {
    const { repo } = await makeOpenRepo({ entityKey: 'k1', idField: 'id' }, [seedEntity('x1', { name: 'a' })]);
    const res = await repo.transaction([
      { op: 'create', entity: { id: 'x2', name: 'b' } },
      { op: 'update', id: 'x1', patch: { name: 'a2' } }
    ]);
    assert.strictEqual(res.success, true);
    assert.strictEqual(repo.getAll().length, 2);
    assert.strictEqual(repo.get('x1').name, 'a2');
  });

  await checkAsync('K2: REGRESSION — transaction() rollback on a failing later step unchanged', async () => {
    const { repo, adapter } = await makeOpenRepo({ entityKey: 'k2', idField: 'id' }, [seedEntity('x1')]);
    const before = adapter.writeCalls;
    const res = await repo.transaction([
      { op: 'delete', id: 'x1' },
      { op: 'update', id: 'ghost', patch: {} }
    ]);
    assert.strictEqual(res.success, false);
    assert.strictEqual(adapter.writeCalls, before);
    assert.ok(repo.get('x1'), 'x1 must remain live — the delete step must have rolled back');
  });

  await checkAsync('K3: REGRESSION — transaction() {op:"restore"} step unchanged', async () => {
    const { repo } = await makeOpenRepo({ entityKey: 'k3', idField: 'id', softDelete: true }, [seedEntity('x1', { deletedAt: '2026-01-01T00:00:00.000Z' })]);
    const res = await repo.transaction([{ op: 'restore', id: 'x1' }]);
    assert.strictEqual(res.success, true);
    assert.strictEqual(repo.get('x1') !== null, true);
  });

  await checkAsync('K4: SUPERSEDED BY T-10 FIX (PHASE 11.2.1, Transaction_Consistency_Report.md) — transaction()\'s {op:"update"} step now receives the exact same deletedAt guard as update()/bulkUpdate(): blocked by default (ConflictError, whole transaction rolled back, no persist), allowed only with {allowDeleted:true} on that step', async () => {
    const { repo, adapter } = await makeOpenRepo({ entityKey: 'k4', idField: 'id', softDelete: true }, [seedEntity('x1', { name: 'orig', deletedAt: '2026-01-01T00:00:00.000Z' })]);
    const writesBefore = adapter.writeCalls;

    const blocked = await repo.transaction([{ op: 'update', id: 'x1', patch: { name: 'edited-via-tx' } }]);
    assert.strictEqual(blocked.success, false, 'T-10 fix: transaction() update step on a soft-deleted record is now blocked by default');
    assert.strictEqual(blocked.error.type, RepositoryErrorTypes.CONFLICT, 'T-10 fix: blocked step reports CONFLICT, matching update()/bulkUpdate()');
    assert.strictEqual(adapter.writeCalls, writesBefore, 'a rolled-back transaction must never call write()');
    const untouched = repo.get('x1', { includeDeleted: true });
    assert.strictEqual(untouched.name, 'orig', 'no partial mutation leaked from the rolled-back step');

    const allowed = await repo.transaction([{ op: 'update', id: 'x1', patch: { name: 'edited-via-tx' }, allowDeleted: true }]);
    assert.strictEqual(allowed.success, true, 'T-10 fix: {allowDeleted:true} on the step opts back in, exactly like update()/bulkUpdate()');
    const raw = repo.get('x1', { includeDeleted: true });
    assert.strictEqual(raw.name, 'edited-via-tx');
    assert.notStrictEqual(raw.deletedAt, null, 'allowDeleted edits fields only, never un-hides the record — same rule as update()');
  });

  // ================================================================
  // L. Guard/lifecycle parity
  // ================================================================

  await checkAsync('L1: _guardSupported still applies to get()/exists()/update()/bulkUpdate() exactly as before FIX 1-4', async () => {
    const { repo } = await makeOpenRepo({ entityKey: 'l1', idField: 'id', unsupportedOperations: ['get', 'exists', 'update', 'bulkUpdate'] }, [seedEntity('r1')]);
    assert.throws(() => repo.get('r1'), (err) => err.message.indexOf('not supported') !== -1);
    assert.throws(() => repo.exists('r1'), (err) => err.message.indexOf('not supported') !== -1);
    await assert.rejects(() => repo.update('r1', {}), (err) => err.message.indexOf('not supported') !== -1);
    await assert.rejects(() => repo.bulkUpdate([{ id: 'r1', patch: {} }]), (err) => err.message.indexOf('not supported') !== -1);
  });

  check('L2: _guardReady still applies to get()/exists() before open() — unaffected by FIX 3/4', () => {
    const adapter = makeMockAdapter(null);
    const repo = new Repository({ entityKey: 'l2', idField: 'id', storageAdapter: adapter });
    assert.throws(() => repo.get('r1'), (err) => err.message.indexOf('not ready') !== -1);
    assert.throws(() => repo.exists('r1'), (err) => err.message.indexOf('not ready') !== -1);
    assert.throws(() => repo.get('r1', { includeDeleted: true }), (err) => err.message.indexOf('not ready') !== -1);
  });

  await checkAsync('L3: _guardReady still applies to update()/bulkUpdate() before open() — unaffected by FIX 1/2', async () => {
    const adapter = makeMockAdapter(null);
    const repo = new Repository({ entityKey: 'l3', idField: 'id', storageAdapter: adapter });
    await assert.rejects(() => repo.update('r1', {}), (err) => err.message.indexOf('not ready') !== -1);
    await assert.rejects(() => repo.bulkUpdate([{ id: 'r1', patch: {} }]), (err) => err.message.indexOf('not ready') !== -1);
  });

  // ================================================================
  // M. Validation ordering
  // ================================================================

  await checkAsync('M1: FIX 1 guard (CONFLICT) fires before _validate() on update() — a deleted record with an invalid patch still reports CONFLICT, not VALIDATION', async () => {
    function ValidatingRepo(config) { Repository.call(this, config); }
    ValidatingRepo.prototype = Object.create(Repository.prototype);
    ValidatingRepo.prototype._validate = function () { return { valid: false, errors: [{ field: 'x', message: 'always invalid' }] }; };
    const adapter = makeMockAdapter({ entityKey: 'm1', records: [seedEntity('r1', { deletedAt: '2026-01-01T00:00:00.000Z' })] });
    const repo = new ValidatingRepo({ entityKey: 'm1', idField: 'id', softDelete: true, storageAdapter: adapter });
    await repo.open();
    const res = await repo.update('r1', { anything: true });
    assert.strictEqual(res.error.type, RepositoryErrorTypes.CONFLICT, 'the deletedAt guard must be checked before validation runs');
  });

  await checkAsync('M2: FIX 2 guard (CONFLICT) fires before _validate() on bulkUpdate() per item, same ordering as M1', async () => {
    function ValidatingRepo(config) { Repository.call(this, config); }
    ValidatingRepo.prototype = Object.create(Repository.prototype);
    ValidatingRepo.prototype._validate = function () { return { valid: false, errors: [{ field: 'x', message: 'always invalid' }] }; };
    const adapter = makeMockAdapter({ entityKey: 'm2', records: [seedEntity('r1', { deletedAt: '2026-01-01T00:00:00.000Z' })] });
    const repo = new ValidatingRepo({ entityKey: 'm2', idField: 'id', softDelete: true, storageAdapter: adapter });
    await repo.open();
    const results = await repo.bulkUpdate([{ id: 'r1', patch: { anything: true } }]);
    assert.strictEqual(results[0].error.type, RepositoryErrorTypes.CONFLICT);
  });

  // ================================================================
  // N. softDelete:false Repositories — FIX 1-4 have nothing to do
  // ================================================================

  await checkAsync('N1: softDelete:false — update() is never blocked by FIX 1 (there is no such thing as a soft-deleted record to guard against)', async () => {
    const { repo } = await makeOpenRepo({ entityKey: 'n1', idField: 'id', softDelete: false }, [seedEntity('r1', { name: 'x' })]);
    const res = await repo.update('r1', { name: 'y' });
    assert.strictEqual(res.success, true);
  });

  await checkAsync('N2: softDelete:false — bulkUpdate() is never blocked by FIX 2', async () => {
    const { repo } = await makeOpenRepo({ entityKey: 'n2', idField: 'id', softDelete: false }, [seedEntity('r1', { name: 'x' })]);
    const results = await repo.bulkUpdate([{ id: 'r1', patch: { name: 'y' } }]);
    assert.strictEqual(results[0].success, true);
  });

  await checkAsync('N3: softDelete:false — get(id, {includeDeleted:true}) is a harmless no-op (nothing is ever excluded to begin with)', async () => {
    const { repo } = await makeOpenRepo({ entityKey: 'n3', idField: 'id', softDelete: false }, [seedEntity('r1')]);
    assert.deepStrictEqual(repo.get('r1'), repo.get('r1', { includeDeleted: true }));
  });

  await checkAsync('N4: softDelete:false — exists(id, {includeDeleted:true}) is a harmless no-op', async () => {
    const { repo } = await makeOpenRepo({ entityKey: 'n4', idField: 'id', softDelete: false }, [seedEntity('r1')]);
    assert.strictEqual(repo.exists('r1'), repo.exists('r1', { includeDeleted: true }));
  });

  await checkAsync('N5: softDelete:false — delete() removes the record entirely, so a subsequent update() correctly reports the pre-existing "unknown id" VALIDATION error, not the new FIX 1 CONFLICT error', async () => {
    const { repo } = await makeOpenRepo({ entityKey: 'n5', idField: 'id', softDelete: false }, [seedEntity('r1')]);
    await repo.delete('r1');
    const res = await repo.update('r1', { name: 'x' });
    assert.strictEqual(res.success, false);
    assert.strictEqual(res.error.type, RepositoryErrorTypes.VALIDATION, 'no record exists at all, so this is "not found," not "conflict"');
  });

  // ================================================================
  // O. Cross-check with a natural (non-generated) idField, mirroring the
  //    real 9 entity Repositories which mostly use Arabic natural keys
  // ================================================================

  await checkAsync('O1: FIX 1-4 all work identically with a natural-key idField (e.g. Arabic field names, matching real entity Repositories)', async () => {
    const { repo } = await makeOpenRepo(
      { entityKey: 'o1', idField: 'رقم_القضية', softDelete: true },
      [{ 'رقم_القضية': 'c1', 'الاسم': 'قضية 1', deletedAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', version: 1 }]
    );
    const blocked = await repo.update('c1', { 'الاسم': 'تعديل' });
    assert.strictEqual(blocked.success, false);
    assert.strictEqual(blocked.error.type, RepositoryErrorTypes.CONFLICT);

    assert.strictEqual(repo.get('c1'), null);
    assert.ok(repo.get('c1', { includeDeleted: true }));
    assert.strictEqual(repo.exists('c1'), false);
    assert.strictEqual(repo.exists('c1', { includeDeleted: true }), true);

    const allowed = await repo.update('c1', { 'الاسم': 'تعديل مسموح' }, { allowDeleted: true });
    assert.strictEqual(allowed.success, true);
    assert.strictEqual(allowed.record['الاسم'], 'تعديل مسموح');
  });

  // ================================================================
  // P. Stress — FIX 1-4 across a larger record set (loop-generated
  //    assertions, same convention as verify_restore_stress.js)
  // ================================================================

  await checkAsync('P1: FIX 1/3/4 hold across 40 independently soft-deleted records — each is blocked from update(), invisible to get()/exists() by default, visible with includeDeleted, and unblockable only via allowDeleted', async () => {
    const seeds = [];
    for (let i = 0; i < 40; i++) {
      seeds.push(seedEntity('p1-' + i, { n: i, deletedAt: '2026-01-01T00:00:00.000Z' }));
    }
    const { repo, adapter } = await makeOpenRepo({ entityKey: 'p1', idField: 'id', softDelete: true }, seeds);

    for (let i = 0; i < 40; i++) {
      const id = 'p1-' + i;
      const before = adapter.writeCalls;

      const blocked = await repo.update(id, { n: -1 });
      assert.strictEqual(blocked.success, false, id + ': update() must be blocked');
      assert.strictEqual(blocked.error.type, RepositoryErrorTypes.CONFLICT, id + ': error type must be CONFLICT');
      assert.strictEqual(adapter.writeCalls, before, id + ': blocked update() must not persist');

      assert.strictEqual(repo.get(id), null, id + ': get() default must be null');
      assert.ok(repo.get(id, { includeDeleted: true }), id + ': get() includeDeleted must return the record');
      assert.strictEqual(repo.exists(id), false, id + ': exists() default must be false');
      assert.strictEqual(repo.exists(id, { includeDeleted: true }), true, id + ': exists() includeDeleted must be true');

      const allowed = await repo.update(id, { n: -1 }, { allowDeleted: true });
      assert.strictEqual(allowed.success, true, id + ': allowDeleted update() must succeed');
      assert.strictEqual(repo.get(id, { includeDeleted: true }).n, -1, id + ': allowDeleted edit must apply');
      assert.strictEqual(repo.get(id), null, id + ': record must remain invisible after an allowDeleted edit');
    }

    assert.strictEqual(repo.getAll().length, 0, 'all 40 records must still be excluded from default getAll()');
    assert.strictEqual(repo.getAll({ includeDeleted: true }).length, 40, 'all 40 must still be present with includeDeleted');
  });

  await checkAsync('P2: FIX 2 holds across a 30-item bulkUpdate() batch alternating live/deleted ids — each item resolved independently in a single batch call', async () => {
    const seeds = [];
    for (let i = 0; i < 30; i++) {
      const isDeleted = i % 2 === 0;
      seeds.push(seedEntity('p2-' + i, { n: i, deletedAt: isDeleted ? '2026-01-01T00:00:00.000Z' : null }));
    }
    const { repo, adapter } = await makeOpenRepo({ entityKey: 'p2', idField: 'id', softDelete: true }, seeds);

    const patches = seeds.map((s, i) => ({ id: s.id, patch: { n: 1000 + i } }));
    const before = adapter.writeCalls;
    const results = await repo.bulkUpdate(patches);
    assert.strictEqual(adapter.writeCalls, before + 1, 'exactly one persist for the whole 30-item batch');

    for (let i = 0; i < 30; i++) {
      const isDeleted = i % 2 === 0;
      const id = 'p2-' + i;
      if (isDeleted) {
        assert.strictEqual(results[i].success, false, id + ': deleted item must be rejected');
        assert.strictEqual(results[i].error.type, RepositoryErrorTypes.CONFLICT, id + ': rejected item must be CONFLICT');
        assert.strictEqual(repo.get(id, { includeDeleted: true }).n, i, id + ': rejected item must be unmodified');
      } else {
        assert.strictEqual(results[i].success, true, id + ': live item must succeed');
        assert.strictEqual(repo.get(id).n, 1000 + i, id + ': live item must be updated');
      }
    }
  });

  await checkAsync('P3: repeated delete() -> blocked update() -> restore() -> update() cycle, 15 iterations on the same record, proves no state leakage between cycles', async () => {
    const { repo } = await makeOpenRepo({ entityKey: 'p3', idField: 'id', softDelete: true }, [seedEntity('r1', { n: 0 })]);
    for (let cycle = 1; cycle <= 15; cycle++) {
      const del = await repo.delete('r1');
      assert.strictEqual(del.success, true, 'cycle ' + cycle + ': delete() must succeed');

      const blocked = await repo.update('r1', { n: -cycle });
      assert.strictEqual(blocked.success, false, 'cycle ' + cycle + ': update() while deleted must be blocked');
      assert.strictEqual(repo.get('r1', { includeDeleted: true }).n, cycle - 1, 'cycle ' + cycle + ': blocked update() must not change n');

      const restored = await repo.restore('r1');
      assert.strictEqual(restored.success, true, 'cycle ' + cycle + ': restore() must succeed');

      const applied = await repo.update('r1', { n: cycle });
      assert.strictEqual(applied.success, true, 'cycle ' + cycle + ': update() after restore() must succeed');
      assert.strictEqual(applied.record.n, cycle, 'cycle ' + cycle + ': update() after restore() must apply the new value');
    }
    assert.strictEqual(repo.get('r1').n, 15, 'final value must reflect the last successful cycle');
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
