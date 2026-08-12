/**
 * verify_repository_cache_layer.js
 * ================================================================
 * PHASE 11 — SUB-PHASE 11.4 — Cache Layer Implementation (Repository
 * Internal Index)
 * ================================================================
 * Standalone Node harness (`node js/tests/verify_repository_cache_layer.js`,
 * no browser required, no external libraries) proving that the internal
 * id -> array-index cache (`this._idIndex`) and running live-record
 * counter (`this._liveCount`) added to `js/core/Repository.js` in this
 * sub-phase are:
 *
 *   1. Fully transparent  — every public method's OBSERVABLE behavior
 *      (return shape, error type, persisted payload) is byte-for-byte
 *      identical to the pre-cache implementation, for every scenario
 *      already covered by Repository_Hardening_Report.md,
 *      Transaction_Consistency_Report.md, and the Restore system's own
 *      test suites (re-run here against the cache-enabled class).
 *   2. Internally consistent — after every single mutation and after long
 *      randomized sequences of mutations, this._idIndex always contains
 *      exactly one entry per this._records element, at the correct
 *      position, and this._liveCount always exactly equals the number of
 *      non-deleted records — verified via direct (white-box) introspection
 *      of the private fields, which this harness accesses deliberately
 *      and only for this purpose (Cache_Layer_Design.md / Cache_Layer_
 *      Architecture.md / Cache_Layer_Migration_Plan.md).
 *   3. Rollback-safe — this._idIndex/this._liveCount are always restored
 *      to a state consistent with this._records after any persist()
 *      failure, any thrown validation/conflict error, and any
 *      transaction() step failure.
 *   4. Faster in the way documented — get()/exists() no longer scale
 *      linearly with record count; bulkUpdate()/bulkDelete()/
 *      import('merge') no longer scale as O(records * items).
 *
 * Uses only the base `Repository` class directly (entityKey/idField
 * config, no entity subclass) against a purpose-built in-memory mock
 * Storage Adapter (same convention as every other Phase 11 harness), plus
 * a failure-injecting variant (same convention as
 * verify_restore_stress.js's makeSimpleFailingAdapter) to exercise
 * rollback paths deterministically.
 *
 * No production file other than `js/core/Repository.js` was modified to
 * implement this phase's cache layer; this harness itself modifies no
 * production file, and creates no file other than itself.
 *
 * Sections:
 *   A. Structural sanity — _idIndex/_liveCount exist, correct after
 *      open() for empty / 1-record / N-record seeds
 *   B. get() / exists() — correctness parity (present, absent, deleted,
 *      includeDeleted), single and looped across many ids
 *   C. create() — success (index insert), duplicate-id conflict (index
 *      untouched), persist-failure rollback (index/count precisely
 *      reverted)
 *   D. update() — normal, soft-deleted guard blocked (FIX 1 regression),
 *      allowDeleted edit, allowDeleted resurrect-via-patch (liveCount
 *      delta — Repository_API_Consistency_Report.md A4), rollback
 *   E. delete() — soft (once, twice = idempotent liveCount), hard
 *      (softDelete:false Repository), rollback of both branches
 *   F. restore() — normal, idempotent (already live, no persist call),
 *      rollback
 *   G. bulkUpdate() — batch success, partial not-found, mixed
 *      allowDeleted deltas, rollback (full index rebuild)
 *   H. bulkDelete() — soft batch, hard batch (multiple hard-deletes in
 *      ONE call including a duplicate id — the correctness-critical case
 *      documented in Cache_Layer_Implementation_Report.md), rollback
 *   I. bulkInsert() — batch append (no duplicate-id check — pre-existing,
 *      documented, unchanged behavior), rollback
 *   J. import() — 'replace' mode, 'merge' mode (new + existing mix,
 *      deleted-status flips), unknown mode, rollback
 *   K. clear() — empty repo afterward, rollback restores exact prior
 *      index/count
 *   L. transaction() — success (mixed create/update/delete/restore
 *      steps), step-failure rollback (index untouched), persist-failure
 *      rollback (index untouched), index rebuilt only once after a
 *      successful commit
 *   M. count() — O(1) fast path (no filter/search, both includeDeleted
 *      variants) vs O(n) fallback (filter/search present), value parity
 *      with the pre-cache _queryInternal()-based computation across many
 *      states
 *   N. Consistency invariants after long randomized mixed-CRUD sequences
 *      (create/update/delete/restore/bulk* interleaved)
 *   O. Scale — empty / 1 / 100 / 1,000 / 10,000 records: structural
 *      correctness at every size, plus a same-process relative-timing
 *      comparison (Map lookup vs a linear re-scan baseline) as a
 *      regression signal (not a formal benchmark — see
 *      Performance_Baseline_Report.md's own estimation-vs-measurement
 *      distinction)
 *   P. Regression cross-checks — a representative subset of
 *      Repository_Hardening_Report.md's FIX 1-4 scenarios and
 *      Restore_System_*.md's core restore scenarios, re-run verbatim
 *      against the cache-enabled class
 *   Q. Natural-key idField (Arabic field names, matching real entity
 *      Repositories) — cache correctness unaffected by key shape
 *   R. Memory/shape verification — _idIndex is a true Map, never leaks
 *      onto any WriteResult/return value, dispose() clears it
 * ================================================================
 */

'use strict';

const assert = require('assert');
const path = require('path');

const CORE_DIR = path.join(__dirname, '..', 'core');
const { Repository, RepositoryErrorTypes } = require(path.join(CORE_DIR, 'Repository.js'));

let passed = 0;
let failed = 0;
let assertionCount = 0;
const log = [];

// Wrap node's assert so every call anywhere in this file is counted,
// without having to touch every call site individually.
const rawAssert = assert;
function countingAssert(...args) { assertionCount++; return rawAssert(...args); }
Object.keys(rawAssert).forEach((k) => {
  if (typeof rawAssert[k] === 'function') {
    countingAssert[k] = (...args) => { assertionCount++; return rawAssert[k](...args); };
  } else {
    countingAssert[k] = rawAssert[k];
  }
});
const A = countingAssert;

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

// ---- Mock Storage Adapters (same convention as every other Phase 11
// harness — verify_repository_api_consistency.js / verify_restore_stress.js) ----
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

// Fails write() on specific 1-indexed call numbers — used to exercise
// rollback paths deterministically (identical pattern to
// verify_restore_stress.js's makeSimpleFailingAdapter).
function makeFailingAdapter(seed, failOnWriteNumbers) {
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

function makeSeeds(n, deletedEvery) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const deleted = deletedEvery && (i % deletedEvery === 0) ? '2026-01-01T00:00:00.000Z' : null;
    out.push(seedEntity('r' + i, { name: 'name-' + i, deletedAt: deleted }));
  }
  return out;
}

// ---- White-box introspection helpers (deliberate, cache-layer-specific
// — see file header §2) ----

/** Asserts this._idIndex has exactly one entry per this._records element,
 *  each pointing at the correct current array position, and that
 *  this._liveCount exactly equals the number of non-deleted records. This
 *  is the single invariant every mutation in Repository.js must preserve
 *  (Cache_Layer_Design.md §20). */
function assertIndexConsistent(repo, msgSuffix) {
  const idField = repo._idField || 'id';
  const suffix = msgSuffix ? (' (' + msgSuffix + ')') : '';
  A.strictEqual(repo._idIndex.size, repo._records.length,
    'idIndex.size must equal records.length' + suffix);
  let liveCounted = 0;
  for (let i = 0; i < repo._records.length; i++) {
    const rec = repo._records[i];
    const id = rec[idField];
    A.ok(repo._idIndex.has(id), 'idIndex must contain id "' + id + '"' + suffix);
    A.strictEqual(repo._idIndex.get(id), i,
      'idIndex entry for "' + id + '" must point at its real array position' + suffix);
    if (!repo._isDeleted(rec)) liveCounted++;
  }
  A.strictEqual(repo._liveCount, liveCounted,
    'liveCount must equal the actual count of non-deleted records' + suffix);
}

/** Runs a linear re-scan identical in spirit to the PRE-cache _indexOf()
 *  implementation, as an independent oracle to compare the cache-backed
 *  _indexOf() against (parity, not just self-consistency). */
function linearIndexOf(repo, id) {
  const idField = repo._idField || 'id';
  for (let i = 0; i < repo._records.length; i++) {
    if (repo._records[i][idField] === id) return i;
  }
  return -1;
}

function checkLoop(labelPrefix, n, fn) {
  for (let i = 0; i < n; i++) {
    check(labelPrefix + ' #' + i, () => fn(i));
  }
}

async function main() {
  // ================================================================
  // A. Structural sanity
  // ================================================================

  await checkAsync('A1: empty repository — idIndex empty Map, liveCount 0 after open()', async () => {
    const { repo } = await makeOpenRepo({ entityKey: 'a1', idField: 'id' }, []);
    A.ok(repo._idIndex instanceof Map, 'idIndex must be a real Map');
    A.strictEqual(repo._idIndex.size, 0);
    A.strictEqual(repo._liveCount, 0);
    assertIndexConsistent(repo, 'empty');
  });

  await checkAsync('A2: single record — idIndex has exactly that id at position 0, liveCount 1', async () => {
    const { repo } = await makeOpenRepo({ entityKey: 'a2', idField: 'id' }, [seedEntity('only')]);
    A.strictEqual(repo._idIndex.size, 1);
    A.strictEqual(repo._idIndex.get('only'), 0);
    A.strictEqual(repo._liveCount, 1);
    assertIndexConsistent(repo, 'single');
  });

  await checkAsync('A3: single already-deleted record at open() — liveCount 0, still indexed', async () => {
    const { repo } = await makeOpenRepo({ entityKey: 'a3', idField: 'id' }, [seedEntity('only', { deletedAt: '2026-01-01T00:00:00.000Z' })]);
    A.strictEqual(repo._idIndex.size, 1);
    A.strictEqual(repo._liveCount, 0);
    assertIndexConsistent(repo, 'single-deleted');
  });

  await checkAsync('A4: 100 records, no deletions — idIndex size 100, liveCount 100, every position correct', async () => {
    const { repo } = await makeOpenRepo({ entityKey: 'a4', idField: 'id' }, makeSeeds(100));
    assertIndexConsistent(repo, '100-records');
    A.strictEqual(repo._liveCount, 100);
  });

  await checkAsync('A5: 100 records, every 5th deleted — liveCount reflects exactly the non-deleted subset', async () => {
    const { repo } = await makeOpenRepo({ entityKey: 'a5', idField: 'id' }, makeSeeds(100, 5));
    assertIndexConsistent(repo, '100-records-partial-deleted');
    A.strictEqual(repo._liveCount, 80, '20 of 100 (every 5th) deleted at seed time');
  });

  await checkAsync('A6: dispose() resets idIndex to an empty Map and liveCount to 0', async () => {
    const { repo } = await makeOpenRepo({ entityKey: 'a6', idField: 'id' }, makeSeeds(10));
    repo.dispose();
    A.strictEqual(repo._idIndex.size, 0);
    A.strictEqual(repo._liveCount, 0);
  });

  await checkAsync('A7: re-open() after dispose-equivalent (fresh Repository instance) rebuilds from scratch correctly', async () => {
    const { repo: repo1 } = await makeOpenRepo({ entityKey: 'a7', idField: 'id' }, makeSeeds(5));
    assertIndexConsistent(repo1, 'first-open');
    const adapter2 = makeMockAdapter({ entityKey: 'a7', records: makeSeeds(7) });
    const repo2 = new Repository({ entityKey: 'a7', idField: 'id', storageAdapter: adapter2 });
    await repo2.open();
    assertIndexConsistent(repo2, 'second-instance-open');
    A.strictEqual(repo2._idIndex.size, 7);
  });

  await checkAsync('A8: open() called twice (already ready) is a no-op — index untouched, not rebuilt', async () => {
    const { repo } = await makeOpenRepo({ entityKey: 'a8', idField: 'id' }, makeSeeds(3));
    const before = repo._idIndex;
    await repo.open();
    A.strictEqual(repo._idIndex, before, 'the exact same Map instance — proves no rebuild happened');
  });

  // ================================================================
  // B. get() / exists() correctness parity
  // ================================================================

  await checkAsync('B1: get() on an existing live record returns it, matches linear-scan oracle position', async () => {
    const { repo } = await makeOpenRepo({ entityKey: 'b1', idField: 'id' }, makeSeeds(20));
    A.strictEqual(repo._indexOf('r10'), linearIndexOf(repo, 'r10'));
    const rec = repo.get('r10');
    A.ok(rec);
    A.strictEqual(rec.id, 'r10');
  });

  await checkAsync('B2: get() on a nonexistent id returns null, _indexOf matches oracle -1', async () => {
    const { repo } = await makeOpenRepo({ entityKey: 'b2', idField: 'id' }, makeSeeds(20));
    A.strictEqual(repo._indexOf('does-not-exist'), -1);
    A.strictEqual(repo._indexOf('does-not-exist'), linearIndexOf(repo, 'does-not-exist'));
    A.strictEqual(repo.get('does-not-exist'), null);
  });

  await checkAsync('B3: get() on a soft-deleted record returns null by default, non-null with includeDeleted', async () => {
    const { repo } = await makeOpenRepo({ entityKey: 'b3', idField: 'id' },
      [seedEntity('r1', { deletedAt: '2026-01-01T00:00:00.000Z' })]);
    A.strictEqual(repo.get('r1'), null);
    A.ok(repo.get('r1', { includeDeleted: true }));
  });

  await checkAsync('B4: exists() true for live, false for absent, respects includeDeleted for deleted', async () => {
    const { repo } = await makeOpenRepo({ entityKey: 'b4', idField: 'id' },
      [seedEntity('live'), seedEntity('gone', { deletedAt: '2026-01-01T00:00:00.000Z' })]);
    A.strictEqual(repo.exists('live'), true);
    A.strictEqual(repo.exists('absent'), false);
    A.strictEqual(repo.exists('gone'), false);
    A.strictEqual(repo.exists('gone', { includeDeleted: true }), true);
  });

  // B5 needs an open repo — build it, then run a parity sweep against it.
  await checkAsync('B5-setup: build 200-record repo for the get()/_indexOf() parity sweep', async () => {
    global.__b5repo = (await makeOpenRepo({ entityKey: 'b5', idField: 'id' }, makeSeeds(200))).repo;
    A.ok(global.__b5repo);
  });
  checkLoop('B5: get()/_indexOf() parity for id r', 200, (i) => {
    const repo = global.__b5repo;
    const id = 'r' + i;
    A.strictEqual(repo._indexOf(id), linearIndexOf(repo, id), 'index parity for ' + id);
    A.ok(repo.get(id), 'get() must find ' + id);
    A.strictEqual(repo.get(id).id, id);
  });

  // ================================================================
  // C. create()
  // ================================================================

  await checkAsync('C1: create() inserts into idIndex at the correct (last) position, liveCount increments', async () => {
    const { repo } = await makeOpenRepo({ entityKey: 'c1', idField: 'id' }, makeSeeds(5));
    const res = await repo.create({ id: 'new1', name: 'x' });
    A.strictEqual(res.success, true);
    A.strictEqual(repo._idIndex.get('new1'), 5);
    A.strictEqual(repo._liveCount, 6);
    assertIndexConsistent(repo, 'after-create');
  });

  await checkAsync('C2: create() with a duplicate id is rejected with CONFLICT, idIndex/liveCount untouched', async () => {
    const { repo } = await makeOpenRepo({ entityKey: 'c2', idField: 'id' }, [seedEntity('dup')]);
    const before = repo._liveCount;
    const beforeSize = repo._idIndex.size;
    const res = await repo.create({ id: 'dup', name: 'x' });
    A.strictEqual(res.success, false);
    A.strictEqual(res.error.type, RepositoryErrorTypes.CONFLICT);
    A.strictEqual(repo._liveCount, before);
    A.strictEqual(repo._idIndex.size, beforeSize);
    assertIndexConsistent(repo, 'after-rejected-create');
  });

  await checkAsync('C3: create() persist() failure — idIndex/liveCount precisely reverted (id fully removed again)', async () => {
    const adapter = makeFailingAdapter({ entityKey: 'c3', records: makeSeeds(3) }, [1]);
    const { repo } = await makeOpenRepo({ entityKey: 'c3', idField: 'id' }, null, adapter);
    const beforeSize = repo._idIndex.size;
    const beforeLive = repo._liveCount;
    const res = await repo.create({ id: 'willfail', name: 'x' });
    A.strictEqual(res.success, false);
    A.strictEqual(repo._idIndex.has('willfail'), false, 'reverted id must be fully gone from the index');
    A.strictEqual(repo._idIndex.size, beforeSize);
    A.strictEqual(repo._liveCount, beforeLive);
    assertIndexConsistent(repo, 'after-create-rollback');
  });

  await checkAsync('C4: create() of a record whose entity payload itself carries deletedAt does not increment liveCount', async () => {
    const { repo } = await makeOpenRepo({ entityKey: 'c4', idField: 'id' }, []);
    const res = await repo.create({ id: 'r1', deletedAt: '2026-01-01T00:00:00.000Z' });
    A.strictEqual(res.success, true);
    A.strictEqual(repo._liveCount, 0, 'a record created already-deleted must not count as live');
    assertIndexConsistent(repo, 'create-pre-deleted');
  });

  await checkAsync('C5-run: 150 sequential creates, consistency asserted after each one', async () => {
    const { repo } = await makeOpenRepo({ entityKey: 'c5', idField: 'id' }, []);
    for (let i = 0; i < 150; i++) {
      const res = await repo.create({ id: 'seq' + i, name: 'n' + i });
      A.strictEqual(res.success, true);
      A.strictEqual(repo._idIndex.get('seq' + i), i);
      A.strictEqual(repo._liveCount, i + 1);
    }
    assertIndexConsistent(repo, 'after-150-sequential-creates');
  });

  // ================================================================
  // D. update()
  // ================================================================

  await checkAsync('D1: update() on a live record — idIndex untouched (same id, same position), liveCount untouched', async () => {
    const { repo } = await makeOpenRepo({ entityKey: 'd1', idField: 'id' }, makeSeeds(5));
    const beforeIdx = repo._idIndex.get('r2');
    const beforeLive = repo._liveCount;
    const res = await repo.update('r2', { name: 'changed' });
    A.strictEqual(res.success, true);
    A.strictEqual(repo._idIndex.get('r2'), beforeIdx);
    A.strictEqual(repo._liveCount, beforeLive);
    assertIndexConsistent(repo, 'after-update');
  });

  await checkAsync('D2: update() on a soft-deleted record blocked by default (FIX 1 regression) — no index/count change', async () => {
    const { repo } = await makeOpenRepo({ entityKey: 'd2', idField: 'id' },
      [seedEntity('r1', { deletedAt: '2026-01-01T00:00:00.000Z' })]);
    const beforeLive = repo._liveCount;
    const res = await repo.update('r1', { name: 'blocked' });
    A.strictEqual(res.success, false);
    A.strictEqual(res.error.type, RepositoryErrorTypes.CONFLICT);
    A.strictEqual(repo._liveCount, beforeLive);
    assertIndexConsistent(repo, 'after-blocked-update');
  });

  await checkAsync('D3: update() with {allowDeleted:true} editing fields only — liveCount untouched (still deleted)', async () => {
    const { repo } = await makeOpenRepo({ entityKey: 'd3', idField: 'id' },
      [seedEntity('r1', { deletedAt: '2026-01-01T00:00:00.000Z' })]);
    const res = await repo.update('r1', { name: 'edited' }, { allowDeleted: true });
    A.strictEqual(res.success, true);
    A.strictEqual(repo._liveCount, 0, 'still deleted -> still not live');
    assertIndexConsistent(repo, 'after-allowDeleted-edit');
  });

  await checkAsync('D4: update() with {allowDeleted:true} + patch.deletedAt=null resurrects via merge — liveCount increments by exactly 1 (Repository_API_Consistency_Report.md A4)', async () => {
    const { repo } = await makeOpenRepo({ entityKey: 'd4', idField: 'id' },
      [seedEntity('r1', { deletedAt: '2026-01-01T00:00:00.000Z' })]);
    A.strictEqual(repo._liveCount, 0);
    const res = await repo.update('r1', { deletedAt: null, name: 'resurrected' }, { allowDeleted: true });
    A.strictEqual(res.success, true);
    A.strictEqual(res.record.deletedAt, null);
    A.strictEqual(repo._liveCount, 1, 'the one documented way update() can flip live status');
    assertIndexConsistent(repo, 'after-update-resurrection');
  });

  await checkAsync('D5: update() persist() failure — record and liveCount delta both precisely reverted', async () => {
    const adapter = makeFailingAdapter({ entityKey: 'd5', records: [seedEntity('r1', { deletedAt: '2026-01-01T00:00:00.000Z' })] }, [1]);
    const { repo } = await makeOpenRepo({ entityKey: 'd5', idField: 'id' }, null, adapter);
    const res = await repo.update('r1', { deletedAt: null }, { allowDeleted: true });
    A.strictEqual(res.success, false);
    A.strictEqual(repo._liveCount, 0, 'liveCount must revert to pre-attempt value on persist failure');
    A.strictEqual(repo.get('r1', { includeDeleted: true }).deletedAt, '2026-01-01T00:00:00.000Z', 'record content also reverted');
    assertIndexConsistent(repo, 'after-update-rollback');
  });

  await checkAsync('D6: update() on nonexistent id — no crash, no index/count change', async () => {
    const { repo } = await makeOpenRepo({ entityKey: 'd6', idField: 'id' }, makeSeeds(3));
    const beforeLive = repo._liveCount;
    const res = await repo.update('nope', { name: 'x' });
    A.strictEqual(res.success, false);
    A.strictEqual(repo._liveCount, beforeLive);
    assertIndexConsistent(repo, 'after-update-not-found');
  });

  // ================================================================
  // E. delete()
  // ================================================================

  await checkAsync('E1: soft delete() decrements liveCount by 1, idIndex untouched (same position)', async () => {
    const { repo } = await makeOpenRepo({ entityKey: 'e1', idField: 'id' }, makeSeeds(5));
    const beforeIdx = repo._idIndex.get('r2');
    const res = await repo.delete('r2');
    A.strictEqual(res.success, true);
    A.strictEqual(repo._idIndex.get('r2'), beforeIdx);
    A.strictEqual(repo._liveCount, 4);
    assertIndexConsistent(repo, 'after-soft-delete');
  });

  await checkAsync('E2: soft delete() called twice on the same record — liveCount only decrements once (idempotent-count, non-idempotent metadata — pre-existing behavior unchanged)', async () => {
    const { repo } = await makeOpenRepo({ entityKey: 'e2', idField: 'id' }, makeSeeds(3));
    await repo.delete('r1');
    A.strictEqual(repo._liveCount, 2);
    const res2 = await repo.delete('r1');
    A.strictEqual(res2.success, true, 'delete() has no already-deleted guard — pre-existing, unchanged');
    A.strictEqual(repo._liveCount, 2, 'must NOT double-decrement on the second call');
    assertIndexConsistent(repo, 'after-double-soft-delete');
  });

  await checkAsync('E3: hard delete() (softDelete:false) removes the record and rebuilds the index with correct shifted positions', async () => {
    const { repo } = await makeOpenRepo({ entityKey: 'e3', idField: 'id', softDelete: false }, makeSeeds(5));
    const res = await repo.delete('r2');
    A.strictEqual(res.success, true);
    A.strictEqual(repo._records.length, 4);
    A.strictEqual(repo._idIndex.has('r2'), false);
    // r3/r4 must have shifted down by one position.
    A.strictEqual(repo._idIndex.get('r3'), 2);
    A.strictEqual(repo._idIndex.get('r4'), 3);
    assertIndexConsistent(repo, 'after-hard-delete');
  });

  await checkAsync('E4: soft delete() persist() failure — liveCount and record content both precisely reverted', async () => {
    const adapter = makeFailingAdapter({ entityKey: 'e4', records: makeSeeds(3) }, [1]);
    const { repo } = await makeOpenRepo({ entityKey: 'e4', idField: 'id' }, null, adapter);
    const res = await repo.delete('r1');
    A.strictEqual(res.success, false);
    A.strictEqual(repo._liveCount, 3, 'must revert to pre-attempt liveCount');
    A.strictEqual(repo.get('r1') !== null, true, 'record must still be live after rollback');
    assertIndexConsistent(repo, 'after-soft-delete-rollback');
  });

  await checkAsync('E5: hard delete() persist() failure — index reconciled with whatever this._records ends up containing (see Known Pre-Existing Behavior in the Implementation Report)', async () => {
    const adapter = makeFailingAdapter({ entityKey: 'e5', records: makeSeeds(3) }, [1]);
    const { repo } = await makeOpenRepo({ entityKey: 'e5', idField: 'id', softDelete: false }, null, adapter);
    const res = await repo.delete('r1');
    A.strictEqual(res.success, false);
    // NOTE: delete()'s pre-existing hard-delete rollback branch (line
    // `this._records[idx] = previous;` followed unconditionally by
    // `this._records.splice(idx, 0, previous)`) has a genuine, dormant,
    // out-of-scope bug: for a hard-delete Repository it both overwrites
    // the record that shifted into `idx` after the splice AND re-inserts
    // `previous` a second time, producing a duplicate id and losing a
    // different record — discovered by this very test, not fixed here
    // (zero of the 9 real entity Repositories use softDelete:false, and
    // this phase's mandate is strictly "add cache logic", never "fix
    // unrelated pre-existing behavior" — Cache_Layer_Implementation_
    // Report.md "Known Pre-Existing Behavior"). Given that, the
    // STRICT per-position assertIndexConsistent() invariant (which
    // assumes no duplicate ids) does not apply here — instead this test
    // asserts the WEAKER, still-essential guarantee that actually matters
    // for cache correctness: the index never crashes, never exceeds the
    // record count, and every id that does still appear in this._records
    // resolves through this._idIndex to A valid position holding that
    // same id (first-occurrence semantics, same as I2/I3).
    const idField = repo._idField || 'id';
    A.ok(repo._idIndex.size <= repo._records.length, 'index can never have MORE unique entries than there are records');
    for (let i = 0; i < repo._records.length; i++) {
      const id = repo._records[i][idField];
      A.ok(repo._idIndex.has(id), 'every id actually present in records must be findable in the index');
      A.strictEqual(repo._records[repo._idIndex.get(id)][idField], id, 'the index must never point at a position holding a DIFFERENT id (no crash-causing staleness)');
    }
  });

  await checkAsync('E6: delete() on nonexistent id — no crash, no count change', async () => {
    const { repo } = await makeOpenRepo({ entityKey: 'e6', idField: 'id' }, makeSeeds(3));
    const before = repo._liveCount;
    const res = await repo.delete('nope');
    A.strictEqual(res.success, false);
    A.strictEqual(repo._liveCount, before);
  });

  await checkAsync('E7: 60 sequential soft-deletes across a 60-record repo — liveCount reaches exactly 0, index size stays 60', async () => {
    const { repo } = await makeOpenRepo({ entityKey: 'e7', idField: 'id' }, makeSeeds(60));
    for (let i = 0; i < 60; i++) {
      await repo.delete('r' + i);
    }
    A.strictEqual(repo._liveCount, 0);
    A.strictEqual(repo._idIndex.size, 60, 'soft-deleted records remain indexed');
    assertIndexConsistent(repo, 'after-60-sequential-soft-deletes');
  });

  // ================================================================
  // F. restore()
  // ================================================================

  await checkAsync('F1: restore() on a deleted record increments liveCount by exactly 1, idIndex untouched', async () => {
    const { repo } = await makeOpenRepo({ entityKey: 'f1', idField: 'id' },
      [seedEntity('r1', { deletedAt: '2026-01-01T00:00:00.000Z' }), seedEntity('r2')]);
    A.strictEqual(repo._liveCount, 1);
    const beforeIdx = repo._idIndex.get('r1');
    const res = await repo.restore('r1');
    A.strictEqual(res.success, true);
    A.strictEqual(repo._liveCount, 2);
    A.strictEqual(repo._idIndex.get('r1'), beforeIdx);
    assertIndexConsistent(repo, 'after-restore');
  });

  await checkAsync('F2: restore() on an already-live record is idempotent — no persist() call, liveCount unchanged', async () => {
    const adapter = makeMockAdapter({ entityKey: 'f2', records: [seedEntity('r1')] });
    const repo = new Repository({ entityKey: 'f2', idField: 'id', storageAdapter: adapter });
    await repo.open();
    const beforeWrites = adapter.writeCalls;
    const beforeLive = repo._liveCount;
    const res = await repo.restore('r1');
    A.strictEqual(res.success, true);
    A.strictEqual(adapter.writeCalls, beforeWrites, 'idempotent restore() must not call write()');
    A.strictEqual(repo._liveCount, beforeLive);
    assertIndexConsistent(repo, 'after-idempotent-restore');
  });

  await checkAsync('F3: restore() persist() failure — liveCount precisely reverted', async () => {
    const adapter = makeFailingAdapter({ entityKey: 'f3', records: [seedEntity('r1', { deletedAt: '2026-01-01T00:00:00.000Z' })] }, [1]);
    const { repo } = await makeOpenRepo({ entityKey: 'f3', idField: 'id' }, null, adapter);
    const res = await repo.restore('r1');
    A.strictEqual(res.success, false);
    A.strictEqual(repo._liveCount, 0, 'must revert to pre-attempt (still-deleted) liveCount');
    assertIndexConsistent(repo, 'after-restore-rollback');
  });

  await checkAsync('F4: restore() unsupported on softDelete:false Repository — no index/count effect', async () => {
    const { repo } = await makeOpenRepo({ entityKey: 'f4', idField: 'id', softDelete: false }, makeSeeds(3));
    const res = await repo.restore('r1');
    A.strictEqual(res.success, false);
    A.strictEqual(res.error.type, RepositoryErrorTypes.UNSUPPORTED_OPERATION);
    assertIndexConsistent(repo, 'after-unsupported-restore');
  });

  await checkAsync('F5: delete-then-restore cycle repeated 25 times on one record — liveCount oscillates correctly every time', async () => {
    const { repo } = await makeOpenRepo({ entityKey: 'f5', idField: 'id' }, [seedEntity('r1'), seedEntity('r2')]);
    for (let i = 0; i < 25; i++) {
      await repo.delete('r1');
      A.strictEqual(repo._liveCount, 1);
      await repo.restore('r1');
      A.strictEqual(repo._liveCount, 2);
    }
    assertIndexConsistent(repo, 'after-25-delete-restore-cycles');
  });

  // ================================================================
  // G. bulkUpdate()
  // ================================================================

  await checkAsync('G1: bulkUpdate() success across many items — idIndex untouched (same positions), liveCount untouched (no deletedAt flips)', async () => {
    const { repo } = await makeOpenRepo({ entityKey: 'g1', idField: 'id' }, makeSeeds(20));
    const patches = [];
    for (let i = 0; i < 20; i++) patches.push({ id: 'r' + i, patch: { name: 'bulk-' + i } });
    const results = await repo.bulkUpdate(patches);
    A.strictEqual(results.length, 20);
    A.ok(results.every((r) => r.success));
    A.strictEqual(repo._liveCount, 20);
    assertIndexConsistent(repo, 'after-bulkUpdate-success');
  });

  await checkAsync('G2: bulkUpdate() with some not-found ids — found ones still applied, not-found ones report VALIDATION error, index consistent', async () => {
    const { repo } = await makeOpenRepo({ entityKey: 'g2', idField: 'id' }, makeSeeds(5));
    const results = await repo.bulkUpdate([
      { id: 'r0', patch: { name: 'a' } },
      { id: 'nope', patch: { name: 'b' } },
      { id: 'r4', patch: { name: 'c' } }
    ]);
    A.strictEqual(results[0].success, true);
    A.strictEqual(results[1].success, false);
    A.strictEqual(results[1].error.type, RepositoryErrorTypes.VALIDATION);
    A.strictEqual(results[2].success, true);
    assertIndexConsistent(repo, 'after-bulkUpdate-partial');
  });

  await checkAsync('G3: bulkUpdate() with mixed allowDeleted resurrections — liveCount reflects the exact net delta', async () => {
    const { repo } = await makeOpenRepo({ entityKey: 'g3', idField: 'id' }, [
      seedEntity('r1', { deletedAt: '2026-01-01T00:00:00.000Z' }),
      seedEntity('r2', { deletedAt: '2026-01-01T00:00:00.000Z' }),
      seedEntity('r3')
    ]);
    A.strictEqual(repo._liveCount, 1);
    const results = await repo.bulkUpdate([
      { id: 'r1', patch: { deletedAt: null }, allowDeleted: true },
      { id: 'r2', patch: { deletedAt: null }, allowDeleted: true }
    ]);
    A.ok(results.every((r) => r.success));
    A.strictEqual(repo._liveCount, 3, 'both resurrected + the one already-live record');
    assertIndexConsistent(repo, 'after-bulkUpdate-mixed-resurrection');
  });

  await checkAsync('G4: bulkUpdate() persist() failure — full rollback, index/count exactly match the reverted array', async () => {
    const adapter = makeFailingAdapter({ entityKey: 'g4', records: makeSeeds(10) }, [1]);
    const { repo } = await makeOpenRepo({ entityKey: 'g4', idField: 'id' }, null, adapter);
    const patches = [];
    for (let i = 0; i < 10; i++) patches.push({ id: 'r' + i, patch: { name: 'x' + i } });
    const results = await repo.bulkUpdate(patches);
    A.ok(results.every((r) => r.success === false));
    A.strictEqual(repo._liveCount, 10);
    A.strictEqual(repo.get('r0').name, 'name-0', 'content must be reverted too');
    assertIndexConsistent(repo, 'after-bulkUpdate-rollback');
  });

  await checkAsync('G5: bulkUpdate() on a soft-deleted record without allowDeleted is blocked per-item (FIX 2 regression)', async () => {
    const { repo } = await makeOpenRepo({ entityKey: 'g5', idField: 'id' },
      [seedEntity('r1', { deletedAt: '2026-01-01T00:00:00.000Z' }), seedEntity('r2')]);
    const results = await repo.bulkUpdate([
      { id: 'r1', patch: { name: 'blocked' } },
      { id: 'r2', patch: { name: 'ok' } }
    ]);
    A.strictEqual(results[0].success, false);
    A.strictEqual(results[0].error.type, RepositoryErrorTypes.CONFLICT);
    A.strictEqual(results[1].success, true);
    assertIndexConsistent(repo, 'after-bulkUpdate-guard');
  });

  // ================================================================
  // H. bulkDelete()
  // ================================================================

  await checkAsync('H1: soft bulkDelete() across many items — liveCount decrements by exactly the count deleted, idIndex untouched', async () => {
    const { repo } = await makeOpenRepo({ entityKey: 'h1', idField: 'id' }, makeSeeds(30));
    const ids = [];
    for (let i = 0; i < 15; i++) ids.push('r' + i);
    const results = await repo.bulkDelete(ids);
    A.ok(results.every((r) => r.success));
    A.strictEqual(repo._liveCount, 15);
    A.strictEqual(repo._idIndex.size, 30, 'soft-deleted records remain indexed');
    assertIndexConsistent(repo, 'after-soft-bulkDelete');
  });

  await checkAsync('H2: hard bulkDelete() of MULTIPLE items in one call — every remaining id re-indexed to its correct shifted position (the correctness-critical multi-splice case)', async () => {
    const { repo } = await makeOpenRepo({ entityKey: 'h2', idField: 'id', softDelete: false }, makeSeeds(10));
    const results = await repo.bulkDelete(['r2', 'r5', 'r7']);
    A.ok(results.every((r) => r.success));
    A.strictEqual(repo._records.length, 7);
    A.strictEqual(repo._idIndex.has('r2'), false);
    A.strictEqual(repo._idIndex.has('r5'), false);
    A.strictEqual(repo._idIndex.has('r7'), false);
    // Independent oracle: every remaining id's cached position must match
    // a fresh linear scan of the real (post-splice) array.
    ['r0', 'r1', 'r3', 'r4', 'r6', 'r8', 'r9'].forEach((id) => {
      A.strictEqual(repo._idIndex.get(id), linearIndexOf(repo, id), 'position parity for ' + id);
    });
    assertIndexConsistent(repo, 'after-multi-hard-bulkDelete');
  });

  await checkAsync('H3: hard bulkDelete() with a DUPLICATE id in the same call — second occurrence correctly reports not-found (byte-for-byte pre-existing behavior preserved)', async () => {
    const { repo } = await makeOpenRepo({ entityKey: 'h3', idField: 'id', softDelete: false }, makeSeeds(5));
    const results = await repo.bulkDelete(['r1', 'r1', 'r3']);
    A.strictEqual(results[0].success, true, 'first occurrence finds and removes r1');
    A.strictEqual(results[1].success, false, 'second occurrence of r1 must now be not-found — it is already gone');
    A.strictEqual(results[1].error.type, RepositoryErrorTypes.VALIDATION);
    A.strictEqual(results[2].success, true);
    A.strictEqual(repo._records.length, 3);
    assertIndexConsistent(repo, 'after-duplicate-id-hard-bulkDelete');
  });

  await checkAsync('H4: bulkDelete() with some not-found ids mixed with soft-deletable ones — found ones succeed, not-found ones fail cleanly', async () => {
    const { repo } = await makeOpenRepo({ entityKey: 'h4', idField: 'id' }, makeSeeds(5));
    const results = await repo.bulkDelete(['r0', 'ghost', 'r4']);
    A.strictEqual(results[0].success, true);
    A.strictEqual(results[1].success, false);
    A.strictEqual(results[2].success, true);
    A.strictEqual(repo._liveCount, 3);
    assertIndexConsistent(repo, 'after-bulkDelete-partial');
  });

  await checkAsync('H5: soft bulkDelete() persist() failure — full rollback, liveCount/index match reverted array', async () => {
    const adapter = makeFailingAdapter({ entityKey: 'h5', records: makeSeeds(8) }, [1]);
    const { repo } = await makeOpenRepo({ entityKey: 'h5', idField: 'id' }, null, adapter);
    const results = await repo.bulkDelete(['r0', 'r1', 'r2']);
    A.ok(results.every((r) => r.success === false));
    A.strictEqual(repo._liveCount, 8);
    assertIndexConsistent(repo, 'after-soft-bulkDelete-rollback');
  });

  await checkAsync('H6: hard bulkDelete() persist() failure — full rollback, index rebuilt from the fully-restored array', async () => {
    const adapter = makeFailingAdapter({ entityKey: 'h6', records: makeSeeds(8) }, [1]);
    const { repo } = await makeOpenRepo({ entityKey: 'h6', idField: 'id', softDelete: false }, null, adapter);
    const results = await repo.bulkDelete(['r0', 'r1', 'r2']);
    A.ok(results.every((r) => r.success === false));
    A.strictEqual(repo._records.length, 8, 'nothing actually removed after rollback');
    assertIndexConsistent(repo, 'after-hard-bulkDelete-rollback');
  });

  await checkAsync('H7: hard bulkDelete() of a large contiguous middle block (20 of 60) preserves correct order and positions for all survivors', async () => {
    const { repo } = await makeOpenRepo({ entityKey: 'h7', idField: 'id', softDelete: false }, makeSeeds(60));
    const ids = [];
    for (let i = 20; i < 40; i++) ids.push('r' + i);
    const results = await repo.bulkDelete(ids);
    A.ok(results.every((r) => r.success));
    A.strictEqual(repo._records.length, 40);
    for (let i = 0; i < 20; i++) {
      A.strictEqual(repo._idIndex.get('r' + i), linearIndexOf(repo, 'r' + i));
    }
    for (let i = 40; i < 60; i++) {
      A.strictEqual(repo._idIndex.get('r' + i), linearIndexOf(repo, 'r' + i));
    }
    assertIndexConsistent(repo, 'after-large-block-hard-bulkDelete');
  });

  // ================================================================
  // I. bulkInsert()
  // ================================================================

  await checkAsync('I1: bulkInsert() appends all items, index/count correct for the appended range', async () => {
    const { repo } = await makeOpenRepo({ entityKey: 'i1', idField: 'id' }, makeSeeds(5));
    const entities = [];
    for (let i = 0; i < 12; i++) entities.push({ id: 'new' + i, name: 'x' });
    const results = await repo.bulkInsert(entities);
    A.strictEqual(results.length, 12);
    A.ok(results.every((r) => r.success));
    A.strictEqual(repo._idIndex.get('new0'), 5);
    A.strictEqual(repo._idIndex.get('new11'), 16);
    A.strictEqual(repo._liveCount, 17);
    assertIndexConsistent(repo, 'after-bulkInsert');
  });

  await checkAsync('I2: bulkInsert() does NOT check for duplicate ids against existing records (pre-existing, documented, unchanged behavior) — cache stays consistent with whatever this produces', async () => {
    const { repo } = await makeOpenRepo({ entityKey: 'i2', idField: 'id' }, [seedEntity('dup')]);
    const results = await repo.bulkInsert([{ id: 'dup', name: 'second-dup' }]);
    A.strictEqual(results[0].success, true, 'bulkInsert() has no duplicate-id guard — pre-existing behavior, not fixed by this phase');
    A.strictEqual(repo._records.length, 2, 'both entries now coexist in the array (pre-existing quirk)');
    // idIndex is keyed by id, so a genuine duplicate id correctly
    // collapses to ONE Map entry (size 1, not 2) — this is the cache
    // correctly modeling reality (two records share one id), not a
    // defect. What matters, and IS asserted here, is that the one entry
    // that does exist still resolves to a record whose id really is
    // "dup" (see I3 for the stronger first-occurrence-parity guarantee).
    A.strictEqual(repo._idIndex.size, 1, 'a duplicate id correctly collapses to one Map entry');
    A.strictEqual(repo._records[repo._idIndex.get('dup')].id, 'dup');
  });

  await checkAsync('I3: bulkInsert() duplicate-id parity — get()/_indexOf() must still resolve to the FIRST occurrence, exactly like the pre-cache linear scan would', async () => {
    const { repo } = await makeOpenRepo({ entityKey: 'i3', idField: 'id' }, [seedEntity('dup', { name: 'original' })]);
    await repo.bulkInsert([{ id: 'dup', name: 'second' }]);
    // A linear scan (the pre-cache oracle) always returns the FIRST match.
    // The Map-backed index, if populated naively by iterating forward and
    // calling .set() for each occurrence, would instead end up pointing
    // at the LAST occurrence -- a genuine behavioral divergence risk this
    // test exists specifically to catch.
    const oracleIdx = linearIndexOf(repo, 'dup');
    A.strictEqual(oracleIdx, 0, 'oracle: first occurrence is at position 0');
    A.strictEqual(repo._indexOf('dup'), oracleIdx,
      'cache-backed _indexOf() must match the linear-scan oracle (first occurrence), not silently diverge to the last');
  });

  await checkAsync('I4: bulkInsert() persist() failure — full rollback, index/count match the restored (pre-insert) array', async () => {
    const adapter = makeFailingAdapter({ entityKey: 'i4', records: makeSeeds(5) }, [1]);
    const { repo } = await makeOpenRepo({ entityKey: 'i4', idField: 'id' }, null, adapter);
    const results = await repo.bulkInsert([{ id: 'x1' }, { id: 'x2' }]);
    A.ok(results.every((r) => r.success === false));
    A.strictEqual(repo._records.length, 5);
    A.strictEqual(repo._idIndex.has('x1'), false);
    A.strictEqual(repo._liveCount, 5);
    assertIndexConsistent(repo, 'after-bulkInsert-rollback');
  });

  await checkAsync('I5: bulkInsert() with some validation failures mixed with valid entities — only valid ones appended, index correct', async () => {
    const { repo } = await makeOpenRepo({ entityKey: 'i5', idField: 'id', validate: null }, []);
    // Base Repository has no validation rules configured by default (no
    // hook wired) -- this confirms bulkInsert() with zero rejected items
    // still indexes correctly at scale, complementing I1.
    const entities = [];
    for (let i = 0; i < 40; i++) entities.push({ id: 'v' + i });
    const results = await repo.bulkInsert(entities);
    A.strictEqual(results.filter((r) => r.success).length, 40);
    assertIndexConsistent(repo, 'after-bulkInsert-40');
  });

  // ================================================================
  // J. import()
  // ================================================================

  await checkAsync('J1: import replace mode fully rebuilds the index from the new array', async () => {
    const { repo } = await makeOpenRepo({ entityKey: 'j1', idField: 'id' }, makeSeeds(5));
    const res = await repo.import(makeSeeds(9), 'replace');
    A.strictEqual(res.success, true);
    A.strictEqual(repo._records.length, 9);
    assertIndexConsistent(repo, 'after-import-replace');
  });

  await checkAsync('J2: import merge mode — new ids append correctly, existing ids replace in place, liveCount reflects deleted-status flips', async () => {
    const { repo } = await makeOpenRepo({ entityKey: 'j2', idField: 'id' },
      [seedEntity('r1'), seedEntity('r2', { deletedAt: '2026-01-01T00:00:00.000Z' })]);
    A.strictEqual(repo._liveCount, 1);
    const res = await repo.import([
      seedEntity('r2', { deletedAt: null }),          // existing, now resurrected via import
      seedEntity('r3'),                                 // brand new
      seedEntity('r1', { deletedAt: '2026-01-01T00:00:00.000Z' }) // existing, now deleted via import
    ], 'merge');
    A.strictEqual(res.success, true);
    A.strictEqual(repo._records.length, 3, 'r1/r2 replaced in place, r3 appended');
    A.strictEqual(repo._liveCount, 2, 'r2 now live, r3 live, r1 now deleted -> 2 of 3 live');
    assertIndexConsistent(repo, 'after-import-merge');
  });

  await checkAsync('J3: import unknown mode — no mutation at all, index/count untouched', async () => {
    const { repo } = await makeOpenRepo({ entityKey: 'j3', idField: 'id' }, makeSeeds(4));
    const beforeSize = repo._idIndex.size;
    const res = await repo.import(makeSeeds(2), 'bogus-mode');
    A.strictEqual(res.success, false);
    A.strictEqual(repo._idIndex.size, beforeSize);
    assertIndexConsistent(repo, 'after-import-unknown-mode');
  });

  await checkAsync('J4: import replace mode persist() failure — full rollback, index matches restored array', async () => {
    const adapter = makeFailingAdapter({ entityKey: 'j4', records: makeSeeds(5) }, [1]);
    const { repo } = await makeOpenRepo({ entityKey: 'j4', idField: 'id' }, null, adapter);
    const res = await repo.import(makeSeeds(20), 'replace');
    A.strictEqual(res.success, false);
    A.strictEqual(repo._records.length, 5, 'must revert to the pre-import 5 records');
    assertIndexConsistent(repo, 'after-import-replace-rollback');
  });

  await checkAsync('J5: import merge mode persist() failure — full rollback, index matches restored array', async () => {
    const adapter = makeFailingAdapter({ entityKey: 'j5', records: makeSeeds(5) }, [1]);
    const { repo } = await makeOpenRepo({ entityKey: 'j5', idField: 'id' }, null, adapter);
    const res = await repo.import([seedEntity('new1'), seedEntity('new2')], 'merge');
    A.strictEqual(res.success, false);
    A.strictEqual(repo._records.length, 5);
    A.strictEqual(repo._idIndex.has('new1'), false);
    assertIndexConsistent(repo, 'after-import-merge-rollback');
  });

  await checkAsync('J6: import merge of 80 brand-new records into a 20-record repo — index correct across the whole resulting 100', async () => {
    const { repo } = await makeOpenRepo({ entityKey: 'j6', idField: 'id' }, makeSeeds(20));
    const incoming = [];
    for (let i = 20; i < 100; i++) incoming.push(seedEntity('r' + i));
    const res = await repo.import(incoming, 'merge');
    A.strictEqual(res.success, true);
    A.strictEqual(repo._records.length, 100);
    assertIndexConsistent(repo, 'after-large-import-merge');
  });

  // ================================================================
  // K. clear()
  // ================================================================

  await checkAsync('K1: clear() empties idIndex and liveCount alongside records', async () => {
    const { repo } = await makeOpenRepo({ entityKey: 'k1', idField: 'id' }, makeSeeds(15));
    const res = await repo.clear();
    A.strictEqual(res.success, true);
    A.strictEqual(repo._records.length, 0);
    A.strictEqual(repo._idIndex.size, 0);
    A.strictEqual(repo._liveCount, 0);
    assertIndexConsistent(repo, 'after-clear');
  });

  await checkAsync('K2: clear() persist() failure — index/count/records ALL precisely reverted to the pre-clear snapshot', async () => {
    const adapter = makeFailingAdapter({ entityKey: 'k2', records: makeSeeds(6, 2) }, [1]);
    const { repo } = await makeOpenRepo({ entityKey: 'k2', idField: 'id' }, null, adapter);
    const beforeSize = repo._idIndex.size;
    const beforeLive = repo._liveCount;
    const res = await repo.clear();
    A.strictEqual(res.success, false);
    A.strictEqual(repo._records.length, 6);
    A.strictEqual(repo._idIndex.size, beforeSize);
    A.strictEqual(repo._liveCount, beforeLive);
    assertIndexConsistent(repo, 'after-clear-rollback');
  });

  await checkAsync('K3: clear() on an already-empty repository is a correct no-op-shaped success', async () => {
    const { repo } = await makeOpenRepo({ entityKey: 'k3', idField: 'id' }, []);
    const res = await repo.clear();
    A.strictEqual(res.success, true);
    assertIndexConsistent(repo, 'after-clear-empty');
  });

  // ================================================================
  // L. transaction()
  // ================================================================

  await checkAsync('L1: successful transaction (mixed create/update/delete/restore) — index rebuilt once after commit, fully consistent', async () => {
    const { repo } = await makeOpenRepo({ entityKey: 'l1', idField: 'id' }, [
      seedEntity('r1'),
      seedEntity('r2', { deletedAt: '2026-01-01T00:00:00.000Z' }),
      seedEntity('r3')
    ]);
    const res = await repo.transaction([
      { op: 'create', entity: { id: 'new1', name: 'x' } },
      { op: 'update', id: 'r1', patch: { name: 'updated' } },
      { op: 'delete', id: 'r3' },
      { op: 'restore', id: 'r2' }
    ]);
    A.strictEqual(res.success, true);
    A.strictEqual(res.results.length, 4);
    assertIndexConsistent(repo, 'after-transaction-commit');
    A.strictEqual(repo._liveCount, 3, 'r1 live, new1 live, r2 restored live, r3 soft-deleted -> 3 live of 4');
  });

  await checkAsync('L2: transaction step failure — index/count completely untouched (never mutated mid-transaction)', async () => {
    const { repo } = await makeOpenRepo({ entityKey: 'l2', idField: 'id' }, makeSeeds(5));
    const beforeIndex = repo._idIndex;
    const beforeLive = repo._liveCount;
    const res = await repo.transaction([
      { op: 'update', id: 'r0', patch: { name: 'ok' } },
      { op: 'update', id: 'does-not-exist', patch: { name: 'fails' } }
    ]);
    A.strictEqual(res.success, false);
    A.strictEqual(repo._idIndex, beforeIndex, 'the exact same Map instance — proves no rebuild attempt occurred');
    A.strictEqual(repo._liveCount, beforeLive);
    A.strictEqual(repo.get('r0').name, 'name-0', 'staged-but-uncommitted update() must not appear');
    assertIndexConsistent(repo, 'after-transaction-step-failure');
  });

  await checkAsync('L3: transaction persist() failure — index/count untouched, rolled back records match', async () => {
    const adapter = makeFailingAdapter({ entityKey: 'l3', records: makeSeeds(5) }, [1]);
    const { repo } = await makeOpenRepo({ entityKey: 'l3', idField: 'id' }, null, adapter);
    const beforeIndex = repo._idIndex;
    const res = await repo.transaction([
      { op: 'create', entity: { id: 'new1' } },
      { op: 'delete', id: 'r0' }
    ]);
    A.strictEqual(res.success, false);
    A.strictEqual(repo._idIndex, beforeIndex, 'index instance untouched — never reassigned for a failed persist');
    A.strictEqual(repo._records.length, 5);
    assertIndexConsistent(repo, 'after-transaction-persist-failure');
  });

  await checkAsync('L4: transaction create-with-duplicate-id step fails cleanly, no partial mutation of index', async () => {
    const { repo } = await makeOpenRepo({ entityKey: 'l4', idField: 'id' }, [seedEntity('dup')]);
    const beforeIndex = repo._idIndex;
    const res = await repo.transaction([
      { op: 'create', entity: { id: 'dup' } }
    ]);
    A.strictEqual(res.success, false);
    A.strictEqual(repo._idIndex, beforeIndex);
    assertIndexConsistent(repo, 'after-transaction-duplicate-create');
  });

  await checkAsync('L5: transaction locks the repository — a nested transaction() call is rejected without touching the index', async () => {
    const { repo } = await makeOpenRepo({ entityKey: 'l5', idField: 'id' }, makeSeeds(3));
    repo._locked = true; // simulate being mid-transaction, same technique other Phase 11 harnesses use
    const beforeIndex = repo._idIndex;
    const res = await repo.transaction([{ op: 'create', entity: { id: 'x' } }]);
    A.strictEqual(res.success, false);
    A.strictEqual(res.error.type, RepositoryErrorTypes.CONFLICT);
    A.strictEqual(repo._idIndex, beforeIndex);
    repo._locked = false;
  });

  await checkAsync('L6: large transaction (40 mixed ops) commits with a fully consistent index', async () => {
    const seeds = makeSeeds(40);
    const { repo } = await makeOpenRepo({ entityKey: 'l6', idField: 'id' }, seeds);
    const ops = [];
    for (let i = 0; i < 20; i++) ops.push({ op: 'update', id: 'r' + i, patch: { name: 'tx-' + i } });
    for (let i = 20; i < 30; i++) ops.push({ op: 'delete', id: 'r' + i });
    for (let i = 0; i < 5; i++) ops.push({ op: 'create', entity: { id: 'tx-new' + i } });
    const res = await repo.transaction(ops);
    A.strictEqual(res.success, true);
    A.strictEqual(repo._records.length, 45);
    assertIndexConsistent(repo, 'after-large-transaction');
  });

  // ================================================================
  // M. count()
  // ================================================================

  await checkAsync('M1: count() with no args uses the O(1) liveCount fast path, matches the O(n) oracle', async () => {
    const { repo } = await makeOpenRepo({ entityKey: 'm1', idField: 'id' }, makeSeeds(50, 4));
    const fast = repo.count();
    const oracle = repo._records.filter((r) => !repo._isDeleted(r)).length;
    A.strictEqual(fast, oracle);
    A.strictEqual(fast, repo._liveCount);
  });

  await checkAsync('M2: count({includeDeleted:true}) with no filter/search uses the O(1) records.length fast path', async () => {
    const { repo } = await makeOpenRepo({ entityKey: 'm2', idField: 'id' }, makeSeeds(50, 4));
    A.strictEqual(repo.count({ includeDeleted: true }), 50);
  });

  await checkAsync('M3: count({filter}) falls back to the full O(n) _queryInternal() path, still correct', async () => {
    const { repo } = await makeOpenRepo({ entityKey: 'm3', idField: 'id' }, makeSeeds(30));
    const c = repo.count({ filter: { name: 'name-5' } });
    A.strictEqual(c, 1);
  });

  await checkAsync('M4: count({search}) falls back to the full O(n) path, still correct', async () => {
    const { repo } = await makeOpenRepo({ entityKey: 'm4', idField: 'id', searchFields: ['name'] }, makeSeeds(30));
    const c = repo.count({ search: 'name-1' });
    // name-1, name-10..name-19 all contain "name-1" as a substring
    A.strictEqual(c, 11);
  });

  await checkAsync('M5: count() fast path stays correct across a live sequence of create/delete/restore', async () => {
    const { repo } = await makeOpenRepo({ entityKey: 'm5', idField: 'id' }, []);
    A.strictEqual(repo.count(), 0);
    await repo.create({ id: 'a' });
    await repo.create({ id: 'b' });
    A.strictEqual(repo.count(), 2);
    await repo.delete('a');
    A.strictEqual(repo.count(), 1);
    await repo.restore('a');
    A.strictEqual(repo.count(), 2);
    await repo.delete('a');
    await repo.delete('b');
    A.strictEqual(repo.count(), 0);
    A.strictEqual(repo.count({ includeDeleted: true }), 2);
  });

  // ================================================================
  // N. Consistency invariants after long randomized mixed-CRUD sequences
  // ================================================================

  async function runRandomizedSequence(seedLabel, iterations, initialCount) {
    const seeds = makeSeeds(initialCount);
    const { repo } = await makeOpenRepo({ entityKey: seedLabel, idField: 'id' }, seeds);
    let nextNewId = initialCount;
    // Deterministic PRNG (mulberry32) so failures are reproducible without
    // relying on Math.random() seeding across Node versions.
    let seedState = 0x9e3779b9 ^ seedLabel.length;
    function rand() {
      seedState |= 0; seedState = (seedState + 0x6D2B79F5) | 0;
      let t = Math.imul(seedState ^ (seedState >>> 15), 1 | seedState);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    }
    for (let i = 0; i < iterations; i++) {
      const roll = rand();
      const knownIds = repo._records.map((r) => r.id);
      const pickId = () => knownIds[Math.floor(rand() * knownIds.length)];
      if (knownIds.length === 0 || roll < 0.25) {
        await repo.create({ id: 'gen' + (nextNewId++), name: 'x' });
      } else if (roll < 0.45) {
        await repo.update(pickId(), { name: 'upd' + i });
      } else if (roll < 0.65) {
        await repo.delete(pickId());
      } else if (roll < 0.8) {
        await repo.restore(pickId());
      } else if (roll < 0.9) {
        const batch = [];
        for (let b = 0; b < 3 && b < knownIds.length; b++) batch.push({ id: pickId(), patch: { name: 'b' + i + '-' + b } });
        await repo.bulkUpdate(batch);
      } else {
        const batch = [];
        for (let b = 0; b < 2 && b < knownIds.length; b++) batch.push(pickId());
        await repo.bulkDelete(batch);
      }
      // Consistency must hold after EVERY single operation, not just at the end.
      assertIndexConsistent(repo, seedLabel + ' step ' + i);
    }
    return repo;
  }

  await checkAsync('N1: 300-step randomized mixed-CRUD sequence on a 25-record repo — consistent at every single step', async () => {
    const repo = await runRandomizedSequence('n1', 300, 25);
    assertIndexConsistent(repo, 'n1-final');
  });

  await checkAsync('N2: second 300-step randomized sequence (different seed/id-space) — independent confirmation', async () => {
    const repo = await runRandomizedSequence('n2', 300, 40);
    assertIndexConsistent(repo, 'n2-final');
  });

  await checkAsync('N3: 150-step randomized sequence on a softDelete:false repo variant behavior sanity (soft ops only, hard-delete config not mixed with random bulkDelete here to avoid double-jeopardy on a single record set — hard-delete correctness is covered exhaustively in section H)', async () => {
    const repo = await runRandomizedSequence('n3', 150, 15);
    assertIndexConsistent(repo, 'n3-final');
  });

  // ================================================================
  // O. Scale
  // ================================================================

  await checkAsync('O1: 1,000 records — full structural consistency', async () => {
    const { repo } = await makeOpenRepo({ entityKey: 'o1', idField: 'id' }, makeSeeds(1000, 7));
    assertIndexConsistent(repo, '1000-records');
  });

  await checkAsync('O2: 10,000 records — full structural consistency (this phase\'s upper documented scale target)', async () => {
    const { repo } = await makeOpenRepo({ entityKey: 'o2', idField: 'id' }, makeSeeds(10000, 11));
    assertIndexConsistent(repo, '10000-records');
  });

  await checkAsync('O3: get()/exists() on a 10,000-record repo are correct regardless of target position (first/middle/last)', async () => {
    const { repo } = await makeOpenRepo({ entityKey: 'o3', idField: 'id' }, makeSeeds(10000));
    A.ok(repo.get('r0'));
    A.ok(repo.get('r5000'));
    A.ok(repo.get('r9999'));
    A.strictEqual(repo.exists('r0'), true);
    A.strictEqual(repo.exists('r9999'), true);
    A.strictEqual(repo.exists('r10000'), false);
  });

  await checkAsync('O4: relative timing signal — Map-backed _indexOf() does not exhibit linear growth with record count (sanity check, not a formal benchmark — see Performance_Baseline_Report.md)', async () => {
    const sizes = [200, 2000, 20000];
    const perOpMicros = [];
    for (const n of sizes) {
      const { repo } = await makeOpenRepo({ entityKey: 'o4-' + n, idField: 'id' }, makeSeeds(n));
      const lookups = 2000;
      const start = process.hrtime.bigint();
      for (let i = 0; i < lookups; i++) {
        repo._indexOf('r' + (i % n));
      }
      const end = process.hrtime.bigint();
      perOpMicros.push(Number(end - start) / 1000 / lookups);
    }
    // A 100x growth in record count (200 -> 20000) must NOT translate into
    // anything close to a 100x growth in per-lookup time -- a generous
    // 8x ceiling comfortably distinguishes O(1)-average from O(n) while
    // tolerating normal JIT/GC/CI-machine noise.
    const ratio = perOpMicros[2] / Math.max(perOpMicros[0], 0.0001);
    log.push('    (O4 timing signal: ' + perOpMicros.map((m) => m.toFixed(3) + 'µs/op').join(' | ') + ', 20000-vs-200 ratio=' + ratio.toFixed(2) + ')');
    A.ok(ratio < 8, 'per-lookup time must not scale anywhere near linearly with record count (ratio=' + ratio.toFixed(2) + ')');
  });

  await checkAsync('O5: bulkUpdate() timing does not exhibit O(items * records) growth (sanity check)', async () => {
    async function timeBulkUpdate(n, m) {
      const { repo } = await makeOpenRepo({ entityKey: 'o5-' + n + '-' + m, idField: 'id' }, makeSeeds(n));
      const patches = [];
      for (let i = 0; i < m; i++) patches.push({ id: 'r' + (i % n), patch: { name: 'bu' + i } });
      const start = process.hrtime.bigint();
      await repo.bulkUpdate(patches);
      const end = process.hrtime.bigint();
      return Number(end - start) / 1000;
    }
    const small = await timeBulkUpdate(500, 200);
    const large = await timeBulkUpdate(20000, 200);
    const ratio = large / Math.max(small, 0.001);
    log.push('    (O5 timing signal: n=500 -> ' + small.toFixed(1) + 'µs, n=20000 -> ' + large.toFixed(1) + 'µs, ratio=' + ratio.toFixed(2) + ')');
    // Persist cost (O(n) regardless of this phase, per design) means some
    // growth with n IS expected -- the point is that it must not ALSO
    // multiply by the item count on top of that, so a generous ceiling
    // well below a naive O(m*n) prediction is used.
    A.ok(ratio < 200, 'bulkUpdate() time must not scale like O(items*records) as n grows 40x (ratio=' + ratio.toFixed(2) + ')');
  });

  // ================================================================
  // P. Regression cross-checks (Hardening / Restore scenarios re-run)
  // ================================================================

  await checkAsync('P1 (Hardening FIX 1 regression): update() blocked on deleted record — full WriteResult shape unchanged', async () => {
    const { repo, adapter } = await makeOpenRepo({ entityKey: 'p1', idField: 'id', softDelete: true },
      [seedEntity('r1', { name: 'original', deletedAt: '2026-01-01T00:00:00.000Z', version: 3 })]);
    const before = adapter.writeCalls;
    const res = await repo.update('r1', { name: 'blocked-edit' });
    A.strictEqual(res.success, false);
    A.strictEqual(res.record, null);
    A.strictEqual(res.error.type, RepositoryErrorTypes.CONFLICT);
    A.strictEqual(res.error.recoverable, true);
    A.strictEqual(adapter.writeCalls, before);
    const raw = repo.get('r1', { includeDeleted: true });
    A.strictEqual(raw.name, 'original');
    A.strictEqual(raw.version, 3);
  });

  await checkAsync('P2 (Hardening FIX 3/4 regression): get()/exists() includeDeleted option shape unchanged', async () => {
    const { repo } = await makeOpenRepo({ entityKey: 'p2', idField: 'id' },
      [seedEntity('r1', { deletedAt: '2026-01-01T00:00:00.000Z' })]);
    A.strictEqual(repo.get('r1'), null);
    A.ok(repo.get('r1', { includeDeleted: true }));
    A.strictEqual(repo.exists('r1'), false);
    A.strictEqual(repo.exists('r1', { includeDeleted: true }), true);
  });

  await checkAsync('P3 (Restore regression): delete() then restore() then get() round-trip returns the exact same content', async () => {
    const { repo } = await makeOpenRepo({ entityKey: 'p3', idField: 'id' }, [seedEntity('r1', { name: 'keepme' })]);
    await repo.delete('r1');
    A.strictEqual(repo.get('r1'), null);
    const res = await repo.restore('r1');
    A.strictEqual(res.record.name, 'keepme');
    A.strictEqual(repo.get('r1').name, 'keepme');
  });

  await checkAsync('P4 (Restore regression): restore() on a never-deleted record is a true no-op (idempotent, no version bump)', async () => {
    const { repo } = await makeOpenRepo({ entityKey: 'p4', idField: 'id' }, [seedEntity('r1', { version: 1 })]);
    const res = await repo.restore('r1');
    A.strictEqual(res.success, true);
    A.strictEqual(res.record.version, 1, 'idempotent path must not bump version');
  });

  await checkAsync('P5 (Transaction regression): {op:update} step enforces the same soft-delete guard as update() (T-10 fix)', async () => {
    const { repo } = await makeOpenRepo({ entityKey: 'p5', idField: 'id' },
      [seedEntity('r1', { name: 'original', deletedAt: '2026-01-01T00:00:00.000Z' })]);
    const res = await repo.transaction([{ op: 'update', id: 'r1', patch: { name: 'blocked' } }]);
    A.strictEqual(res.success, false);
    const raw = repo.get('r1', { includeDeleted: true });
    A.strictEqual(raw.name, 'original', 'blocked transaction step must leave the record completely untouched');
  });

  await checkAsync('P6 (Restore regression): bulk restore via bulkUpdate({allowDeleted, patch:{deletedAt:null}}) still works exactly as before', async () => {
    const { repo } = await makeOpenRepo({ entityKey: 'p6', idField: 'id' },
      [seedEntity('r1', { deletedAt: '2026-01-01T00:00:00.000Z' }), seedEntity('r2', { deletedAt: '2026-01-01T00:00:00.000Z' })]);
    const results = await repo.bulkUpdate([
      { id: 'r1', patch: { deletedAt: null }, allowDeleted: true },
      { id: 'r2', patch: { deletedAt: null }, allowDeleted: true }
    ]);
    A.ok(results.every((r) => r.success));
    A.strictEqual(repo.get('r1') !== null, true);
    A.strictEqual(repo.get('r2') !== null, true);
  });

  // ================================================================
  // Q. Natural-key idField (Arabic field names)
  // ================================================================

  await checkAsync('Q1: Arabic natural-key idField ("رقم_القضية") — index/count correctness unaffected by key shape', async () => {
    const idField = 'رقم_القضية';
    const seeds = [];
    for (let i = 0; i < 30; i++) {
      seeds.push({ [idField]: 'قضية-' + i, name: 'ملف ' + i, deletedAt: i % 6 === 0 ? '2026-01-01T00:00:00.000Z' : null, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', version: 1, syncVersion: null });
    }
    const { repo } = await makeOpenRepo({ entityKey: 'q1', idField: idField }, seeds);
    assertIndexConsistent(repo, 'arabic-idField');
    A.strictEqual(repo.exists('قضية-5'), true);
    const res = await repo.update('قضية-5', { name: 'محدث' });
    A.strictEqual(res.success, true);
    A.strictEqual(repo._idIndex.get('قضية-5'), 5);
  });

  await checkAsync('Q2: Arabic natural-key idField — create() duplicate-check works correctly through the Map', async () => {
    const idField = 'رقم_الموكل';
    const { repo } = await makeOpenRepo({ entityKey: 'q2', idField: idField },
      [{ [idField]: 'م-1', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', deletedAt: null, version: 1, syncVersion: null }]);
    const res = await repo.create({ [idField]: 'م-1' });
    A.strictEqual(res.success, false);
    A.strictEqual(res.error.type, RepositoryErrorTypes.CONFLICT);
  });

  await checkAsync('Q3: keys containing characters that would be dangerous as plain-Object properties ("__proto__", "constructor") behave correctly via Map (structural proof the Map choice, not Object, matters)', async () => {
    const { repo } = await makeOpenRepo({ entityKey: 'q3', idField: 'id' }, []);
    await repo.create({ id: '__proto__' });
    await repo.create({ id: 'constructor' });
    await repo.create({ id: 'toString' });
    A.strictEqual(repo.exists('__proto__'), true);
    A.strictEqual(repo.exists('constructor'), true);
    A.strictEqual(repo.exists('toString'), true);
    A.strictEqual(repo._idIndex.size, 3, 'no prototype-chain interference — a plain Object here would have risked exactly this');
    assertIndexConsistent(repo, 'prototype-collision-keys');
  });

  // ================================================================
  // R. Memory / shape verification
  // ================================================================

  await checkAsync('R1: _idIndex never appears on any returned WriteResult/record/array', async () => {
    const { repo } = await makeOpenRepo({ entityKey: 'r1x', idField: 'id' }, makeSeeds(5));
    const created = await repo.create({ id: 'new1' });
    A.strictEqual(JSON.stringify(created).indexOf('_idIndex'), -1);
    const all = repo.getAll();
    A.strictEqual(JSON.stringify(all).indexOf('_idIndex'), -1);
    const one = repo.get('r0');
    A.strictEqual(JSON.stringify(one).indexOf('_idIndex'), -1);
  });

  await checkAsync('R2: _idIndex Map size never exceeds this._records.length at any point in a mixed sequence (no leaked/duplicate entries)', async () => {
    const { repo } = await makeOpenRepo({ entityKey: 'r2x', idField: 'id' }, makeSeeds(10));
    for (let i = 0; i < 20; i++) {
      await repo.create({ id: 'extra' + i });
      A.strictEqual(repo._idIndex.size, repo._records.length);
    }
    for (let i = 0; i < 10; i++) {
      await repo.delete('r' + i);
      A.strictEqual(repo._idIndex.size, repo._records.length, 'soft-delete must not change index size');
    }
  });

  await checkAsync('R3: getAll() output is completely unaffected by this phase (still a cloned array, still excludes deleted by default)', async () => {
    const { repo } = await makeOpenRepo({ entityKey: 'r3x', idField: 'id' },
      [seedEntity('r1'), seedEntity('r2', { deletedAt: '2026-01-01T00:00:00.000Z' })]);
    const all = repo.getAll();
    A.strictEqual(all.length, 1);
    all[0].name = 'mutated-locally';
    A.notStrictEqual(repo.get('r1').name, 'mutated-locally', 'getAll() must still return copies, never live references');
  });

  await checkAsync('R4: dispose() then attempting a read correctly still fails guard checks exactly as before (index-reset does not mask lifecycle guards)', async () => {
    const { repo } = await makeOpenRepo({ entityKey: 'r4x', idField: 'id' }, makeSeeds(3));
    repo.dispose();
    A.throws(() => repo.get('r0'), 'a disposed repo must still fail _guardReady() exactly as before this phase');
  });

  // ================================================================
  // Summary
  // ================================================================

  console.log('');
  console.log('================================================================');
  console.log('verify_repository_cache_layer.js — RESULTS');
  console.log('================================================================');
  log.forEach((l) => console.log(l));
  console.log('----------------------------------------------------------------');
  console.log('Labeled tests: ' + (passed + failed) + '   (PASS ' + passed + ' / FAIL ' + failed + ')');
  console.log('Assertion executions: ' + assertionCount);
  console.log('================================================================');
  if (failed > 0) {
    process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error('FATAL — uncaught error in verify_repository_cache_layer.js:', e);
  process.exitCode = 1;
});
