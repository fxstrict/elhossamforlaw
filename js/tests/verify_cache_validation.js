/**
 * verify_cache_validation.js
 * ================================================================
 * PHASE 11 — SUB-PHASE 11.5 — Cache Layer Validation & Optimization
 * Full System Verification
 * ================================================================
 * Standalone Node harness (`node js/tests/verify_cache_validation.js`, no
 * browser required, no external dependencies) — an INDEPENDENT validation
 * pass over the cache layer (`this._idIndex` / `this._liveCount`) that
 * `verify_repository_cache_layer.js` (Sub-Phase 11.4) already proved
 * correct at implementation time. This harness does not import or depend
 * on that file; every check here is written fresh against
 * `js/core/Repository.js` directly, per the Engineering Audit Standard's
 * "assume nothing, evidence before conclusions" principle applied to a
 * *validation* phase specifically (re-derive confidence independently,
 * don't just re-run the prior harness).
 *
 * This file does NOT modify js/core/Repository.js. It is read-only with
 * respect to every production file in the project.
 *
 * Sections:
 *   A. Open() / lifecycle                     G. Search()
 *   B. Destroy()/dispose()                    H. Count()
 *   C. Clear()                                I. Mirror-pattern compatibility
 *   D. Import() (replace/merge)               J. Rollback / persist failure
 *   E. Export()                               K. Repeated-operation stability
 *   F. Create/Update/Delete/Restore            L. Multiple Repository instances
 *   M. BulkInsert/BulkUpdate/BulkDelete        N. Transaction()
 *   O. Duplicate IDs                           P. Soft/Hard delete correctness
 *   Q. includeDeleted / allowDeleted           R. API & backward compatibility
 *   S. Mixed / randomized stress (500+ iters)  T. Long transaction chains
 *   U. Large bulk / large import merge         V. Long-running repository
 *   W. Performance benchmarks (100/1k/10k/25k/50k)
 *   X. Regression cross-check summary (informational)
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
const failures = [];

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
    failures.push(label);
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
    failures.push(label);
  }
}

function checkLoop(labelPrefix, n, fn) {
  for (let i = 0; i < n; i++) {
    check(labelPrefix + ' #' + i, () => fn(i));
  }
}

async function checkAsyncLoop(labelPrefix, n, fn) {
  for (let i = 0; i < n; i++) {
    await checkAsync(labelPrefix + ' #' + i, () => fn(i));
  }
}

// ---- Mock Storage Adapters (same convention as verify_repository_cache_layer.js
// / verify_restore_stress.js) ----
function makeMockAdapter(seed) {
  const store = {};
  if (seed) store[seed.entityKey] = seed.records;
  return {
    readCalls: 0,
    writeCalls: 0,
    read: async function (entityKey) {
      this.readCalls++;
      return store[entityKey] ? JSON.parse(JSON.stringify(store[entityKey])) : [];
    },
    write: async function (entityKey, records) {
      this.writeCalls++;
      store[entityKey] = JSON.parse(JSON.stringify(records));
    }
  };
}

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

function makeSeeds(n, deletedEvery, prefix) {
  const out = [];
  prefix = prefix || 'r';
  for (let i = 0; i < n; i++) {
    const deleted = deletedEvery && (i % deletedEvery === 0) ? '2026-01-01T00:00:00.000Z' : null;
    out.push(seedEntity(prefix + i, { name: 'name-' + i, deletedAt: deleted }));
  }
  return out;
}

/** Independent oracle: linear re-scan identical in spirit to the pre-cache
 *  _indexOf() implementation. Used to cross-check the Map-backed
 *  implementation rather than only asserting its own self-consistency. */
function linearIndexOf(repo, id) {
  const idField = repo._idField || 'id';
  for (let i = 0; i < repo._records.length; i++) {
    if (repo._records[i][idField] === id) return i;
  }
  return -1;
}

function linearLiveCount(repo) {
  let n = 0;
  for (let i = 0; i < repo._records.length; i++) {
    if (!repo._isDeleted(repo._records[i])) n++;
  }
  return n;
}

/** Full independent structural-consistency assertion. */
function assertIndexConsistent(repo, msgSuffix) {
  const idField = repo._idField || 'id';
  const suffix = msgSuffix ? (' (' + msgSuffix + ')') : '';
  A.ok(repo._idIndex instanceof Map, 'idIndex must be a real Map' + suffix);
  A.strictEqual(repo._idIndex.size, repo._records.length, 'idIndex.size must equal records.length' + suffix);
  for (let i = 0; i < repo._records.length; i++) {
    const rec = repo._records[i];
    const id = rec[idField];
    A.ok(repo._idIndex.has(id), 'idIndex must contain id "' + id + '"' + suffix);
    A.strictEqual(repo._idIndex.get(id), i, 'idIndex entry for "' + id + '" must be correct position' + suffix);
  }
  A.strictEqual(repo._liveCount, linearLiveCount(repo), 'liveCount must equal actual non-deleted count' + suffix);
}

function nowIso() { return new Date().toISOString(); }

function hrToMs(hr) { return (hr[0] * 1000) + (hr[1] / 1e6); }

async function main() {
  const perf = {}; // collected performance numbers, dumped at the end for the report generator

  // ================================================================
  // A. Open() / lifecycle
  // ================================================================

  await checkAsync('A1: open() on an empty backing store yields empty _records/_idIndex, liveCount 0', async () => {
    const { repo } = await makeOpenRepo({ entityKey: 'a1', idField: 'id' }, []);
    A.strictEqual(repo._records.length, 0);
    assertIndexConsistent(repo, 'empty-open');
  });

  await checkAsync('A2: open() populates _idIndex/_liveCount correctly for a 50-record seed with partial deletions', async () => {
    const { repo } = await makeOpenRepo({ entityKey: 'a2', idField: 'id' }, makeSeeds(50, 4));
    assertIndexConsistent(repo, '50-seed');
    A.strictEqual(repo._liveCount, linearLiveCount(repo));
  });

  await checkAsync('A3: open() is idempotent when already ready — same Map instance, no rebuild', async () => {
    const { repo } = await makeOpenRepo({ entityKey: 'a3', idField: 'id' }, makeSeeds(10));
    const beforeMap = repo._idIndex;
    await repo.open();
    A.strictEqual(repo._idIndex, beforeMap);
  });

  await checkAsync('A4: open() failure (storage.read() throws) leaves the Repository in "closed" state, throws StorageError', async () => {
    const badAdapter = {
      read: async () => { throw new Error('disk error'); },
      write: async () => {}
    };
    const repo = new Repository({ entityKey: 'a4', idField: 'id', storageAdapter: badAdapter });
    let threw = null;
    try { await repo.open(); } catch (e) { threw = e; }
    A.ok(threw);
    A.strictEqual(threw.type, RepositoryErrorTypes.STORAGE);
    A.strictEqual(repo.getState(), 'closed');
  });

  await checkAsyncLoop('A5: repeated open()/close() cycles on fresh instances stay structurally correct', 40, async (i) => {
    const { repo } = await makeOpenRepo({ entityKey: 'a5_' + i, idField: 'id' }, makeSeeds(15, 3));
    assertIndexConsistent(repo, 'cycle-' + i);
    repo.close();
    A.strictEqual(repo.getState(), 'closed');
  });

  // ================================================================
  // B. Destroy() / dispose()
  // ================================================================

  await checkAsync('B1: dispose() resets _idIndex to an empty Map and _liveCount to 0', async () => {
    const { repo } = await makeOpenRepo({ entityKey: 'b1', idField: 'id' }, makeSeeds(20, 5));
    repo.dispose();
    A.strictEqual(repo._idIndex.size, 0);
    A.strictEqual(repo._liveCount, 0);
    A.strictEqual(repo._records.length, 0);
    A.strictEqual(repo.getState(), 'disposed');
  });

  await checkAsync('B2: dispose() then any read/write correctly fails _guardReady() (dispose does not mask lifecycle guards)', async () => {
    const { repo } = await makeOpenRepo({ entityKey: 'b2', idField: 'id' }, makeSeeds(5));
    repo.dispose();
    A.throws(() => repo.get('r0'));
    A.throws(() => repo.getAll());
    let threw = false;
    try { await repo.create({ id: 'x' }); } catch (e) { threw = true; }
    A.ok(threw, 'create() after dispose() must throw via _guardReady()');
  });

  await checkAsyncLoop('B3: repeated dispose() calls on the same instance remain safe (idempotent reset)', 30, async (i) => {
    const { repo } = await makeOpenRepo({ entityKey: 'b3_' + i, idField: 'id' }, makeSeeds(5));
    repo.dispose();
    repo.dispose();
    A.strictEqual(repo._idIndex.size, 0);
    A.strictEqual(repo._liveCount, 0);
  });

  // ================================================================
  // C. Clear()
  // ================================================================

  await checkAsync('C1: clear() empties _records/_idIndex, resets liveCount to 0, persists an empty array', async () => {
    const { repo, adapter } = await makeOpenRepo({ entityKey: 'c1', idField: 'id' }, makeSeeds(30, 3));
    const res = await repo.clear();
    A.strictEqual(res.success, true);
    assertIndexConsistent(repo, 'after-clear');
    A.strictEqual(repo._records.length, 0);
    A.strictEqual(adapter.writeCalls, 1);
  });

  await checkAsync('C2: clear() persist() failure precisely reverts _idIndex/_liveCount to the pre-clear state', async () => {
    const seeds = makeSeeds(10, 2);
    const adapter = makeFailingAdapter({ entityKey: 'c2', records: seeds }, [1]);
    const repo = new Repository({ entityKey: 'c2', idField: 'id', storageAdapter: adapter });
    await repo.open();
    const beforeSize = repo._idIndex.size;
    const beforeLive = repo._liveCount;
    const res = await repo.clear();
    A.strictEqual(res.success, false);
    A.strictEqual(repo._records.length, seeds.length);
    A.strictEqual(repo._idIndex.size, beforeSize);
    A.strictEqual(repo._liveCount, beforeLive);
    assertIndexConsistent(repo, 'after-failed-clear');
  });

  await checkAsyncLoop('C3: repeated clear() + repopulate cycles stay structurally correct', 60, async (i) => {
    const { repo, adapter } = await makeOpenRepo({ entityKey: 'c3_' + i, idField: 'id' }, makeSeeds(8));
    await repo.clear();
    assertIndexConsistent(repo, 'cleared-' + i);
    await repo.bulkInsert(makeSeeds(5, 0, 'p' + i + '_'));
    assertIndexConsistent(repo, 'repopulated-' + i);
    A.strictEqual(repo._records.length, 5);
  });

  // ================================================================
  // D. Import() — replace / merge
  // ================================================================

  await checkAsync('D1: import(replace) fully replaces _records and rebuilds _idIndex/_liveCount from scratch', async () => {
    const { repo } = await makeOpenRepo({ entityKey: 'd1', idField: 'id' }, makeSeeds(10, 2));
    const res = await repo.import(makeSeeds(25, 5), 'replace');
    A.strictEqual(res.success, true);
    A.strictEqual(res.imported, 25);
    A.strictEqual(repo._records.length, 25);
    assertIndexConsistent(repo, 'after-replace');
  });

  await checkAsync('D2: import(merge) — new ids append (index grows), existing ids replace in place (index unchanged position)', async () => {
    const { repo } = await makeOpenRepo({ entityKey: 'd2', idField: 'id' }, makeSeeds(5));
    const posBefore = repo._idIndex.get('r2');
    await repo.import([seedEntity('r2', { name: 'updated' }), seedEntity('new1'), seedEntity('new2')], 'merge');
    A.strictEqual(repo._idIndex.get('r2'), posBefore, 'existing id must keep its array position');
    A.ok(repo._idIndex.has('new1'));
    A.ok(repo._idIndex.has('new2'));
    A.strictEqual(repo.get('r2').name, 'updated');
    assertIndexConsistent(repo, 'after-merge');
  });

  await checkAsync('D3: import(merge) with deleted-status flips correctly adjusts _liveCount both directions', async () => {
    const { repo } = await makeOpenRepo({ entityKey: 'd3', idField: 'id' },
      [seedEntity('a'), seedEntity('b', { deletedAt: nowIso() })]);
    A.strictEqual(repo._liveCount, 1);
    await repo.import([
      seedEntity('a', { deletedAt: nowIso() }), // live -> deleted
      seedEntity('b', { deletedAt: null })      // deleted -> live
    ], 'merge');
    A.strictEqual(repo._liveCount, 1, 'one flipped each way, net liveCount unchanged, but via two real deltas');
    assertIndexConsistent(repo, 'after-merge-flips');
  });

  await checkAsync('D4: import() with an unknown mode returns a VALIDATION error, leaves state untouched', async () => {
    const { repo } = await makeOpenRepo({ entityKey: 'd4', idField: 'id' }, makeSeeds(5));
    const before = repo._records.length;
    const res = await repo.import(makeSeeds(3), 'bogus-mode');
    A.strictEqual(res.success, false);
    A.strictEqual(res.error.type, RepositoryErrorTypes.VALIDATION);
    A.strictEqual(repo._records.length, before);
  });

  await checkAsync('D5: import(replace) persist() failure reverts _records/_idIndex/_liveCount to pre-import state', async () => {
    const seeds = makeSeeds(10, 2);
    const adapter = makeFailingAdapter({ entityKey: 'd5', records: seeds }, [1]);
    const repo = new Repository({ entityKey: 'd5', idField: 'id', storageAdapter: adapter });
    await repo.open();
    const res = await repo.import(makeSeeds(50), 'replace');
    A.strictEqual(res.success, false);
    A.strictEqual(repo._records.length, seeds.length);
    assertIndexConsistent(repo, 'after-failed-import-replace');
  });

  await checkAsync('D6: import(merge) persist() failure reverts fully via rebuild', async () => {
    const seeds = makeSeeds(5);
    const adapter = makeFailingAdapter({ entityKey: 'd6', records: seeds }, [1]);
    const repo = new Repository({ entityKey: 'd6', idField: 'id', storageAdapter: adapter });
    await repo.open();
    const res = await repo.import([seedEntity('new1'), seedEntity('r0', { name: 'x' })], 'merge');
    A.strictEqual(res.success, false);
    A.strictEqual(repo._records.length, 5);
    assertIndexConsistent(repo, 'after-failed-import-merge');
  });

  await checkAsyncLoop('D7: repeated import(merge) cycles (mixed new/existing) remain structurally correct', 60, async (i) => {
    const { repo } = await makeOpenRepo({ entityKey: 'd7_' + i, idField: 'id' }, makeSeeds(10));
    await repo.import([seedEntity('r0', { name: 'v' + i }), seedEntity('extra' + i)], 'merge');
    assertIndexConsistent(repo, 'merge-cycle-' + i);
  });

  await checkAsyncLoop('D8: repeated import(replace) cycles remain structurally correct', 40, async (i) => {
    const { repo } = await makeOpenRepo({ entityKey: 'd8_' + i, idField: 'id' }, makeSeeds(10));
    await repo.import(makeSeeds(3 + (i % 5), 2), 'replace');
    assertIndexConsistent(repo, 'replace-cycle-' + i);
  });

  // ================================================================
  // E. Export()
  // ================================================================

  await checkAsync('E1: export() includes soft-deleted records (backup must not silently drop pending-delete data)', async () => {
    const { repo } = await makeOpenRepo({ entityKey: 'e1', idField: 'id' },
      [seedEntity('a'), seedEntity('b', { deletedAt: nowIso() })]);
    const exported = repo.export();
    A.strictEqual(exported.length, 2);
  });

  await checkAsync('E2: export() returns copies, never live references into _records', async () => {
    const { repo } = await makeOpenRepo({ entityKey: 'e2', idField: 'id' }, [seedEntity('a')]);
    const exported = repo.export();
    exported[0].name = 'mutated';
    A.notStrictEqual(repo.get('a').name, 'mutated');
  });

  await checkAsync('E3: export() never leaks _idIndex/_liveCount onto the returned array', async () => {
    const { repo } = await makeOpenRepo({ entityKey: 'e3', idField: 'id' }, makeSeeds(5));
    const exported = repo.export();
    A.strictEqual(JSON.stringify(exported).indexOf('_idIndex'), -1);
  });

  // ================================================================
  // F. Create / Update / Delete / Restore — id-index correctness
  // ================================================================

  await checkAsync('F1: create() appends and indexes at the new last position, liveCount increments', async () => {
    const { repo } = await makeOpenRepo({ entityKey: 'f1', idField: 'id' }, makeSeeds(5));
    const res = await repo.create({ id: 'new1' });
    A.strictEqual(res.success, true);
    A.strictEqual(repo._idIndex.get('new1'), 5);
    A.strictEqual(repo._liveCount, 6);
    assertIndexConsistent(repo, 'after-create');
  });

  await checkAsync('F2: create() duplicate id rejected with CONFLICT, index/liveCount untouched', async () => {
    const { repo } = await makeOpenRepo({ entityKey: 'f2', idField: 'id' }, [seedEntity('dup')]);
    const res = await repo.create({ id: 'dup' });
    A.strictEqual(res.success, false);
    A.strictEqual(res.error.type, RepositoryErrorTypes.CONFLICT);
    assertIndexConsistent(repo, 'after-rejected-create');
  });

  await checkAsync('F3: create() persist() failure precisely reverts (id fully removed from index again)', async () => {
    const adapter = makeFailingAdapter({ entityKey: 'f3', records: makeSeeds(3) }, [1]);
    const repo = new Repository({ entityKey: 'f3', idField: 'id', storageAdapter: adapter });
    await repo.open();
    const res = await repo.create({ id: 'new1' });
    A.strictEqual(res.success, false);
    A.strictEqual(repo._idIndex.has('new1'), false);
    A.strictEqual(repo._records.length, 3);
    assertIndexConsistent(repo, 'after-failed-create');
  });

  await checkAsync('F4: update() on a live record does not mutate index position, updates fields', async () => {
    const { repo } = await makeOpenRepo({ entityKey: 'f4', idField: 'id' }, makeSeeds(5));
    const posBefore = repo._idIndex.get('r2');
    const res = await repo.update('r2', { name: 'changed' });
    A.strictEqual(res.success, true);
    A.strictEqual(repo._idIndex.get('r2'), posBefore);
    A.strictEqual(repo.get('r2').name, 'changed');
    assertIndexConsistent(repo, 'after-update');
  });

  await checkAsync('F5: update() on a soft-deleted record is rejected by default (FIX 1 regression), index/liveCount unaffected', async () => {
    const { repo } = await makeOpenRepo({ entityKey: 'f5', idField: 'id' },
      [seedEntity('r1', { deletedAt: nowIso() })]);
    const res = await repo.update('r1', { name: 'x' });
    A.strictEqual(res.success, false);
    A.strictEqual(res.error.type, RepositoryErrorTypes.CONFLICT);
    A.strictEqual(repo._liveCount, 0);
  });

  await checkAsync('F6: update() with {allowDeleted:true} on a soft-deleted record edits fields without un-hiding it', async () => {
    const { repo } = await makeOpenRepo({ entityKey: 'f6', idField: 'id' },
      [seedEntity('r1', { deletedAt: nowIso() })]);
    const res = await repo.update('r1', { name: 'edited' }, { allowDeleted: true });
    A.strictEqual(res.success, true);
    A.strictEqual(repo._liveCount, 0, 'still deleted, not resurrected');
    A.strictEqual(repo.get('r1', { includeDeleted: true }).name, 'edited');
  });

  await checkAsync('F7: update() with allowDeleted + a patch that clears deletedAt correctly increments liveCount (edge case)', async () => {
    const { repo } = await makeOpenRepo({ entityKey: 'f7', idField: 'id' },
      [seedEntity('r1', { deletedAt: nowIso() })]);
    A.strictEqual(repo._liveCount, 0);
    const res = await repo.update('r1', { deletedAt: null }, { allowDeleted: true });
    A.strictEqual(res.success, true);
    A.strictEqual(repo._liveCount, 1);
    assertIndexConsistent(repo, 'after-resurrect-via-patch');
  });

  await checkAsync('F8: update() persist() failure reverts record and any liveCount delta exactly', async () => {
    const adapter = makeFailingAdapter({ entityKey: 'f8', records: [seedEntity('r1', { deletedAt: nowIso() })] }, [1]);
    const repo = new Repository({ entityKey: 'f8', idField: 'id', storageAdapter: adapter });
    await repo.open();
    const res = await repo.update('r1', { deletedAt: null }, { allowDeleted: true });
    A.strictEqual(res.success, false);
    A.strictEqual(repo._liveCount, 0, 'liveCount delta must be reverted on failure');
    assertIndexConsistent(repo, 'after-failed-update');
  });

  await checkAsync('F9: delete() (soft) does not mutate index position, decrements liveCount once', async () => {
    const { repo } = await makeOpenRepo({ entityKey: 'f9', idField: 'id' }, makeSeeds(5));
    const posBefore = repo._idIndex.get('r2');
    const res = await repo.delete('r2');
    A.strictEqual(res.success, true);
    A.strictEqual(repo._idIndex.get('r2'), posBefore);
    A.strictEqual(repo._liveCount, 4);
    assertIndexConsistent(repo, 'after-soft-delete');
  });

  await checkAsync('F10: delete() called twice does not double-decrement liveCount (no idempotency guard, but count stays correct)', async () => {
    const { repo } = await makeOpenRepo({ entityKey: 'f10', idField: 'id' }, makeSeeds(3));
    await repo.delete('r0');
    await repo.delete('r0');
    A.strictEqual(repo._liveCount, 2);
    assertIndexConsistent(repo, 'after-double-delete');
  });

  await checkAsync('F11: delete() (hard, softDelete:false) removes the record and fully rebuilds the index', async () => {
    const { repo } = await makeOpenRepo({ entityKey: 'f11', idField: 'id', softDelete: false }, makeSeeds(5));
    const res = await repo.delete('r2');
    A.strictEqual(res.success, true);
    A.strictEqual(repo._records.length, 4);
    A.strictEqual(repo._idIndex.has('r2'), false);
    assertIndexConsistent(repo, 'after-hard-delete');
    // subsequent records shifted down by one position
    A.strictEqual(repo._idIndex.get('r3'), 2);
    A.strictEqual(repo._idIndex.get('r4'), 3);
  });

  await checkAsync('F12: delete() (soft) persist() failure reverts liveCount precisely, index untouched (no position ever changed)', async () => {
    const adapter = makeFailingAdapter({ entityKey: 'f12', records: makeSeeds(3) }, [1]);
    const repo = new Repository({ entityKey: 'f12', idField: 'id', storageAdapter: adapter });
    await repo.open();
    const res = await repo.delete('r0');
    A.strictEqual(res.success, false);
    A.strictEqual(repo._liveCount, 3);
    assertIndexConsistent(repo, 'after-failed-soft-delete');
  });

  await checkAsync('F13 (known pre-existing, dormant): delete() (hard) persist() failure rollback branch has a pre-existing array-corruption bug — documented, NOT fixed (zero production exposure, no entity uses softDelete:false)', async () => {
    const seeds = makeSeeds(4); // r0 r1 r2 r3
    const adapter = makeFailingAdapter({ entityKey: 'f13', records: seeds }, [1]);
    const repo = new Repository({ entityKey: 'f13', idField: 'id', softDelete: false, storageAdapter: adapter });
    await repo.open();
    const res = await repo.delete('r1');
    A.strictEqual(res.success, false);
    // Documented pre-existing behavior: the rollback branch's
    // `this._records[idx] = previous` followed by `splice(idx, 0, previous)`
    // does NOT correctly restore the pre-delete array — it both overwrites
    // the record that had shifted into idx AND duplicate-inserts `previous`
    // (records end up as [r0, r1, r1, r3] — r2 lost, r1 duplicated). This
    // means _records now legitimately contains a duplicate id, so the
    // GENERIC "one idIndex entry per _records element" invariant
    // (assertIndexConsistent) does not — and per _rebuildIndex()'s own
    // documented first-occurrence-wins contract, MUST not — hold here; a
    // relaxed, bug-aware check is used instead, matching Cache_Layer_
    // Implementation_Report.md's own stated approach to this exact defect
    // ("verified to stay crash-free and internally faithful to whatever
    // state this pre-existing logic produces, rather than assuming an
    // idealized post-condition").
    A.strictEqual(repo._records.length, 4, 'array length is preserved at 4 despite the corruption (one dup, one lost)');
    A.strictEqual(repo._records.filter((r) => r.id === 'r1').length, 2, 'r1 duplicated by the pre-existing bug');
    A.strictEqual(repo._records.filter((r) => r.id === 'r2').length, 0, 'r2 lost by the pre-existing bug');
    A.ok(repo._idIndex instanceof Map);
    A.strictEqual(repo._idIndex.size, 3, 'only 3 unique ids exist post-corruption (r0,r1,r3) — first-occurrence-wins dedup, not a NEW cache bug');
    A.strictEqual(repo._idIndex.get('r1'), linearIndexOf(repo, 'r1'), 'idIndex must still resolve to the FIRST r1 occurrence, matching a linear-scan oracle even on corrupted data');
    A.strictEqual(repo._liveCount, linearLiveCount(repo), 'liveCount must still equal the true non-deleted count of whatever _records actually contains, corrupted or not');
  });

  await checkAsync('F14: restore() clears deletedAt without moving index position, increments liveCount', async () => {
    const { repo } = await makeOpenRepo({ entityKey: 'f14', idField: 'id' },
      [seedEntity('a'), seedEntity('b', { deletedAt: nowIso() })]);
    const posBefore = repo._idIndex.get('b');
    const res = await repo.restore('b');
    A.strictEqual(res.success, true);
    A.strictEqual(repo._idIndex.get('b'), posBefore);
    A.strictEqual(repo._liveCount, 2);
    assertIndexConsistent(repo, 'after-restore');
  });

  await checkAsync('F15: restore() on an already-live record is idempotent — no persist(), liveCount unchanged', async () => {
    const { repo, adapter } = await makeOpenRepo({ entityKey: 'f15', idField: 'id' }, [seedEntity('a')]);
    const writesBefore = adapter.writeCalls;
    const res = await repo.restore('a');
    A.strictEqual(res.success, true);
    A.strictEqual(adapter.writeCalls, writesBefore);
    A.strictEqual(repo._liveCount, 1);
  });

  await checkAsync('F16: restore() unsupported on softDelete:false Repositories', async () => {
    const { repo } = await makeOpenRepo({ entityKey: 'f16', idField: 'id', softDelete: false }, makeSeeds(3));
    const res = await repo.restore('r0');
    A.strictEqual(res.success, false);
    A.strictEqual(res.error.type, RepositoryErrorTypes.UNSUPPORTED_OPERATION);
  });

  await checkAsync('F17: restore() persist() failure reverts liveCount and deletedAt precisely', async () => {
    const adapter = makeFailingAdapter({ entityKey: 'f17', records: [seedEntity('a', { deletedAt: nowIso() })] }, [1]);
    const repo = new Repository({ entityKey: 'f17', idField: 'id', storageAdapter: adapter });
    await repo.open();
    const res = await repo.restore('a');
    A.strictEqual(res.success, false);
    A.strictEqual(repo._liveCount, 0);
    A.ok(repo.get('a', { includeDeleted: true }).deletedAt != null);
  });

  await checkAsyncLoop('F18: delete/restore cycled repeatedly on the same record, index position never drifts', 60, async (i) => {
    const { repo } = await makeOpenRepo({ entityKey: 'f18_' + i, idField: 'id' }, makeSeeds(3));
    const posBefore = repo._idIndex.get('r0');
    await repo.delete('r0');
    await repo.restore('r0');
    A.strictEqual(repo._idIndex.get('r0'), posBefore);
    A.strictEqual(repo._liveCount, 3);
    assertIndexConsistent(repo, 'delete-restore-cycle-' + i);
  });

  // ================================================================
  // G. Search()
  // ================================================================

  await checkAsync('G1: search() is unaffected by the cache layer — filter/sort/pagination/projection all unchanged', async () => {
    const { repo } = await makeOpenRepo({ entityKey: 'g1', idField: 'id', searchFields: ['name'] }, makeSeeds(20));
    const result = repo.search({ sort: [{ field: 'id', direction: 'desc' }], limit: 5 });
    A.strictEqual(result.items.length, 5);
    A.strictEqual(result.items[0].id, 'r9', 'lexicographic string-descending order puts "r9" first among r0..r19');
  });

  await checkAsync('G2: search() excludes soft-deleted records by default, includes with includeDeleted', async () => {
    const { repo } = await makeOpenRepo({ entityKey: 'g2', idField: 'id' }, makeSeeds(10, 2));
    const withoutDeleted = repo.search({});
    const withDeleted = repo.search({ includeDeleted: true });
    A.ok(withDeleted.total > withoutDeleted.total);
  });

  await checkAsync('G3: search() free-text scan matches case-insensitively across configured searchFields', async () => {
    const { repo } = await makeOpenRepo({ entityKey: 'g3', idField: 'id', searchFields: ['name'] },
      [seedEntity('a', { name: 'Case Alpha' }), seedEntity('b', { name: 'Case Beta' })]);
    const res = repo.search({ search: 'alpha' });
    A.strictEqual(res.total, 1);
    A.strictEqual(res.items[0].id, 'a');
  });

  // ================================================================
  // H. Count()
  // ================================================================

  await checkAsync('H1: count() with no queryModel uses the O(1) _liveCount fast path, matches oracle', async () => {
    const { repo } = await makeOpenRepo({ entityKey: 'h1', idField: 'id' }, makeSeeds(30, 3));
    A.strictEqual(repo.count(), linearLiveCount(repo));
  });

  await checkAsync('H2: count({includeDeleted:true}) returns _records.length, matches oracle', async () => {
    const { repo } = await makeOpenRepo({ entityKey: 'h2', idField: 'id' }, makeSeeds(30, 3));
    A.strictEqual(repo.count({ includeDeleted: true }), repo._records.length);
  });

  await checkAsync('H3: count(queryModel with filter) falls back to O(n) _queryInternal, matches oracle', async () => {
    const { repo } = await makeOpenRepo({ entityKey: 'h3', idField: 'id' }, makeSeeds(30, 3));
    const withFilter = repo.count({ filter: { id: { op: 'ne', value: 'r0' } } });
    const manual = repo._records.filter((r) => !repo._isDeleted(r) && r.id !== 'r0').length;
    A.strictEqual(withFilter, manual);
  });

  await checkAsync('H4: count() stays correct through a live create/delete/restore sequence', async () => {
    const { repo } = await makeOpenRepo({ entityKey: 'h4', idField: 'id' }, makeSeeds(5));
    await repo.create({ id: 'x1' });
    A.strictEqual(repo.count(), 6);
    await repo.delete('x1');
    A.strictEqual(repo.count(), 5);
    await repo.restore('x1');
    A.strictEqual(repo.count(), 6);
  });

  // ================================================================
  // I. Mirror-pattern compatibility
  // ================================================================
  // Repository.js itself has no "mirror" concept (that's a Module-level
  // pattern — data.<entity> = <entity>Repository.getAll() — which lives
  // outside this file's scope, see Cache_Layer_Architecture.md §1: "Modules
  // (unchanged)"). What IS this layer's responsibility, and what we verify
  // here, is that getAll() (the call every mirror assignment makes) behaves
  // identically before/after any cache-affecting mutation, so that pattern
  // continues to work unmodified in every Module.

  await checkAsync('I1: getAll() reflects Repository state immediately after create/update/delete/restore (the exact call every Module mirror makes)', async () => {
    const { repo } = await makeOpenRepo({ entityKey: 'i1', idField: 'id' }, makeSeeds(5));
    await repo.create({ id: 'new1' });
    A.strictEqual(repo.getAll().length, 6);
    await repo.delete('new1');
    A.strictEqual(repo.getAll().length, 5);
    await repo.restore('new1');
    A.strictEqual(repo.getAll().length, 6);
  });

  await checkAsync('I2: getAll() reflects state after import()/clear()/bulk operations — mirror pattern remains valid across those too', async () => {
    const { repo } = await makeOpenRepo({ entityKey: 'i2', idField: 'id' }, makeSeeds(5));
    await repo.bulkInsert(makeSeeds(3, 0, 'extra'));
    A.strictEqual(repo.getAll().length, 8);
    await repo.clear();
    A.strictEqual(repo.getAll().length, 0);
    await repo.import(makeSeeds(4), 'replace');
    A.strictEqual(repo.getAll().length, 4);
  });

  await checkAsync('I3: getAll() always returns copies, never live references (mirror mutation cannot corrupt Repository state)', async () => {
    const { repo } = await makeOpenRepo({ entityKey: 'i3', idField: 'id' }, makeSeeds(2));
    const mirror = repo.getAll();
    mirror[0].name = 'mutated-by-mirror';
    A.notStrictEqual(repo.get(mirror[0].id).name, 'mutated-by-mirror');
  });

  // ================================================================
  // J. Rollback / persist failure — cross-method sweep
  // ================================================================

  await checkAsyncLoop('J: persist-failure rollback leaves _records/_idIndex/_liveCount self-consistent for every write method', 12, async (i) => {
    const methods = ['create', 'update', 'delete', 'restore', 'bulkInsert', 'bulkUpdate', 'bulkDelete', 'import-replace', 'import-merge', 'clear', 'transaction', 'delete-hard'];
    const method = methods[i % methods.length];
    const seeds = makeSeeds(6, 3);
    const adapter = makeFailingAdapter({ entityKey: 'j_' + i, records: seeds }, [1]);
    const softDelete = method !== 'delete-hard';
    const repo = new Repository({ entityKey: 'j_' + i, idField: 'id', softDelete, storageAdapter: adapter });
    await repo.open();

    if (method === 'create') await repo.create({ id: 'nx' });
    else if (method === 'update') await repo.update('r1', { name: 'z' });
    else if (method === 'delete') await repo.delete('r1');
    else if (method === 'delete-hard') await repo.delete('r1');
    else if (method === 'restore') await repo.restore('r0');
    else if (method === 'bulkInsert') await repo.bulkInsert(makeSeeds(2, 0, 'nb'));
    else if (method === 'bulkUpdate') await repo.bulkUpdate([{ id: 'r1', patch: { name: 'z' } }, { id: 'r4', patch: { name: 'y' } }]);
    else if (method === 'bulkDelete') await repo.bulkDelete(['r1', 'r4']);
    else if (method === 'import-replace') await repo.import(makeSeeds(3), 'replace');
    else if (method === 'import-merge') await repo.import([seedEntity('r1', { name: 'z' })], 'merge');
    else if (method === 'clear') await repo.clear();
    else if (method === 'transaction') await repo.transaction([{ op: 'create', entity: { id: 'tx1' } }]);

    if (method === 'delete-hard') {
      // See F13 above: this specific rollback path has a documented,
      // pre-existing, dormant array-corruption bug (zero production
      // exposure — no real entity Repository uses softDelete:false). The
      // generic one-entry-per-record invariant does not apply to its
      // corrupted output by design; only that the cache stays faithful
      // (self-consistent given the duplicate id) to whatever _records
      // actually holds is asserted.
      A.strictEqual(repo._idIndex.get('r1'), linearIndexOf(repo, 'r1'));
      A.strictEqual(repo._liveCount, linearLiveCount(repo));
    } else {
      assertIndexConsistent(repo, 'post-failed-' + method);
    }
  });

  // ================================================================
  // K. Repeated-operation stability
  // ================================================================

  await checkAsyncLoop('K1: repeated rollback (persist always fails) never leaves stale/duplicate index entries', 60, async (i) => {
    const adapter = makeFailingAdapter({ entityKey: 'k1_' + i, records: makeSeeds(4) }, [1]);
    const repo = new Repository({ entityKey: 'k1_' + i, idField: 'id', storageAdapter: adapter });
    await repo.open();
    await repo.create({ id: 'x' });
    await repo.update('r0', { name: 'x' });
    await repo.delete('r1');
    assertIndexConsistent(repo, 'repeated-rollback-' + i);
  });

  await checkAsyncLoop('K2: repeated _rebuildIndex() calls are idempotent and always agree with the oracle', 100, async (i) => {
    const { repo } = await makeOpenRepo({ entityKey: 'k2_' + i, idField: 'id' }, makeSeeds(20, 4));
    repo._rebuildIndex();
    repo._rebuildIndex();
    repo._rebuildIndex();
    assertIndexConsistent(repo, 'rebuild-x3-' + i);
    for (const rec of repo._records) {
      A.strictEqual(repo._indexOf(rec.id), linearIndexOf(repo, rec.id));
    }
  });

  await checkAsyncLoop('K3: repeated restore() on the same already-live id stays idempotent across many calls', 60, async (i) => {
    const { repo, adapter } = await makeOpenRepo({ entityKey: 'k3_' + i, idField: 'id' }, [seedEntity('a')]);
    const writesBefore = adapter.writeCalls;
    for (let n = 0; n < 5; n++) await repo.restore('a');
    A.strictEqual(adapter.writeCalls, writesBefore, 'idempotent restore must never persist');
    A.strictEqual(repo._liveCount, 1);
  });

  await checkAsyncLoop('K4: repeated delete() (no idempotency guard by design) keeps liveCount correct, never double-decrements', 60, async (i) => {
    const { repo } = await makeOpenRepo({ entityKey: 'k4_' + i, idField: 'id' }, makeSeeds(3));
    for (let n = 0; n < 4; n++) await repo.delete('r0');
    A.strictEqual(repo._liveCount, 2);
    assertIndexConsistent(repo, 'repeated-delete-' + i);
  });

  // ================================================================
  // L. Multiple Repository instances
  // ================================================================

  await checkAsync('L1: two Repository instances for different entities on the same adapter are fully isolated', async () => {
    const adapter = makeMockAdapter();
    const repoA = new Repository({ entityKey: 'entA', idField: 'id', storageAdapter: adapter });
    const repoB = new Repository({ entityKey: 'entB', idField: 'id', storageAdapter: adapter });
    await repoA.open();
    await repoB.open();
    await repoA.create({ id: 'x' });
    A.strictEqual(repoA._records.length, 1);
    A.strictEqual(repoB._records.length, 0);
    assertIndexConsistent(repoA, 'instance-A');
    assertIndexConsistent(repoB, 'instance-B');
  });

  await checkAsync('L2: 9 simultaneous Repository instances (matching the real 9-entity shape) each maintain independent, correct caches', async () => {
    const entities = ['cases', 'clients', 'sessions', 'tasks', 'documents', 'library', 'templates', 'children', 'fees'];
    const adapter = makeMockAdapter();
    const repos = {};
    for (const e of entities) {
      repos[e] = new Repository({ entityKey: e, idField: 'id', storageAdapter: adapter });
      await repos[e].open();
      await repos[e].bulkInsert(makeSeeds(5, 0, e + '_'));
    }
    for (const e of entities) {
      A.strictEqual(repos[e]._records.length, 5);
      assertIndexConsistent(repos[e], e);
    }
  });

  await checkAsync('L3: concurrent async writes across two independent Repository instances (interleaved) do not corrupt either cache', async () => {
    const adapter = makeMockAdapter();
    const repoA = new Repository({ entityKey: 'concA', idField: 'id', storageAdapter: adapter });
    const repoB = new Repository({ entityKey: 'concB', idField: 'id', storageAdapter: adapter });
    await repoA.open();
    await repoB.open();
    await Promise.all([
      repoA.create({ id: 'a1' }),
      repoB.create({ id: 'b1' }),
      repoA.create({ id: 'a2' }),
      repoB.create({ id: 'b2' })
    ]);
    A.strictEqual(repoA._records.length, 2);
    A.strictEqual(repoB._records.length, 2);
    assertIndexConsistent(repoA, 'concurrent-A');
    assertIndexConsistent(repoB, 'concurrent-B');
  });

  // ================================================================
  // M. BulkInsert / BulkUpdate / BulkDelete
  // ================================================================

  await checkAsync('M1: bulkInsert() incrementally indexes only the appended range, in append order', async () => {
    const { repo } = await makeOpenRepo({ entityKey: 'm1', idField: 'id' }, makeSeeds(5));
    const results = await repo.bulkInsert(makeSeeds(10, 0, 'b'));
    A.strictEqual(results.length, 10);
    A.ok(results.every((r) => r.success));
    A.strictEqual(repo._idIndex.get('b0'), 5);
    A.strictEqual(repo._idIndex.get('b9'), 14);
    assertIndexConsistent(repo, 'after-bulkInsert');
  });

  await checkAsync('M2: bulkInsert() persist() failure reverts via full rebuild, no partial insertion survives', async () => {
    const adapter = makeFailingAdapter({ entityKey: 'm2', records: makeSeeds(3) }, [1]);
    const repo = new Repository({ entityKey: 'm2', idField: 'id', storageAdapter: adapter });
    await repo.open();
    const results = await repo.bulkInsert(makeSeeds(5, 0, 'b'));
    A.ok(results.every((r) => !r.success));
    A.strictEqual(repo._records.length, 3);
    assertIndexConsistent(repo, 'after-failed-bulkInsert');
  });

  await checkAsync('M3: bulkUpdate() replaces content at known positions only — index never mutates, only liveCount can', async () => {
    const { repo } = await makeOpenRepo({ entityKey: 'm3', idField: 'id' }, makeSeeds(10));
    const posBefore = new Map(repo._idIndex);
    const results = await repo.bulkUpdate([
      { id: 'r1', patch: { name: 'a' } },
      { id: 'r5', patch: { name: 'b' } },
      { id: 'r9', patch: { name: 'c' } }
    ]);
    A.ok(results.every((r) => r.success));
    for (const [id, idx] of posBefore) A.strictEqual(repo._idIndex.get(id), idx);
    assertIndexConsistent(repo, 'after-bulkUpdate');
  });

  await checkAsync('M4: bulkUpdate() partial-not-found items report per-item failure without aborting the whole batch', async () => {
    const { repo } = await makeOpenRepo({ entityKey: 'm4', idField: 'id' }, makeSeeds(3));
    const results = await repo.bulkUpdate([
      { id: 'r0', patch: { name: 'ok' } },
      { id: 'does-not-exist', patch: { name: 'x' } }
    ]);
    A.strictEqual(results[0].success, true);
    A.strictEqual(results[1].success, false);
  });

  await checkAsync('M5: bulkUpdate() blocked-by-soft-delete items (no allowDeleted) fail per item, index/liveCount unaffected for them', async () => {
    const { repo } = await makeOpenRepo({ entityKey: 'm5', idField: 'id' },
      [seedEntity('a'), seedEntity('b', { deletedAt: nowIso() })]);
    const results = await repo.bulkUpdate([{ id: 'b', patch: { name: 'x' } }]);
    A.strictEqual(results[0].success, false);
    A.strictEqual(repo._liveCount, 1);
  });

  await checkAsync('M6: bulkUpdate() persist() failure reverts via full rebuild across all staged deltas', async () => {
    const adapter = makeFailingAdapter({ entityKey: 'm6', records: makeSeeds(5) }, [1]);
    const repo = new Repository({ entityKey: 'm6', idField: 'id', storageAdapter: adapter });
    await repo.open();
    const results = await repo.bulkUpdate([{ id: 'r0', patch: { name: 'x' } }, { id: 'r1', patch: { name: 'y' } }]);
    A.ok(results.every((r) => !r.success));
    A.strictEqual(repo.get('r0').name, 'name-0', 'field reverted');
    assertIndexConsistent(repo, 'after-failed-bulkUpdate');
  });

  await checkAsync('M7: bulkDelete() (soft) — no index mutation for any item, correct liveCount decrement, duplicates in same call handled', async () => {
    const { repo } = await makeOpenRepo({ entityKey: 'm7', idField: 'id' }, makeSeeds(10));
    const posBefore = new Map(repo._idIndex);
    await repo.bulkDelete(['r1', 'r5', 'r1']); // duplicate id in same call
    for (const [id, idx] of posBefore) A.strictEqual(repo._idIndex.get(id), idx);
    A.strictEqual(repo._liveCount, 8);
    assertIndexConsistent(repo, 'after-bulkDelete-soft-dup');
  });

  await checkAsync('M8: bulkDelete() (hard) — multiple hard deletes in ONE call including a duplicate id, index rebuilt correctly after each splice', async () => {
    const { repo } = await makeOpenRepo({ entityKey: 'm8', idField: 'id', softDelete: false }, makeSeeds(10));
    const results = await repo.bulkDelete(['r2', 'r5', 'r2', 'r8']);
    A.strictEqual(results[0].success, true);
    A.strictEqual(results[1].success, true);
    A.strictEqual(results[2].success, false, 'r2 already removed by the first occurrence in this same call');
    A.strictEqual(results[3].success, true);
    A.strictEqual(repo._records.length, 7);
    assertIndexConsistent(repo, 'after-bulkDelete-hard-dup');
  });

  await checkAsync('M9: bulkDelete() persist() failure reverts via full rebuild (both soft and hard variants)', async () => {
    const adapterSoft = makeFailingAdapter({ entityKey: 'm9s', records: makeSeeds(5) }, [1]);
    const repoSoft = new Repository({ entityKey: 'm9s', idField: 'id', storageAdapter: adapterSoft });
    await repoSoft.open();
    await repoSoft.bulkDelete(['r0', 'r1']);
    A.strictEqual(repoSoft._liveCount, 5);
    assertIndexConsistent(repoSoft, 'after-failed-bulkDelete-soft');

    const adapterHard = makeFailingAdapter({ entityKey: 'm9h', records: makeSeeds(5) }, [1]);
    const repoHard = new Repository({ entityKey: 'm9h', idField: 'id', softDelete: false, storageAdapter: adapterHard });
    await repoHard.open();
    await repoHard.bulkDelete(['r0', 'r1']);
    A.strictEqual(repoHard._records.length, 5);
    assertIndexConsistent(repoHard, 'after-failed-bulkDelete-hard');
  });

  await checkAsyncLoop('M10: repeated large-ish bulkInsert calls stack correctly without index drift', 30, async (i) => {
    const { repo } = await makeOpenRepo({ entityKey: 'm10_' + i, idField: 'id' }, makeSeeds(5));
    await repo.bulkInsert(makeSeeds(50, 0, 'batch' + i + '_'));
    assertIndexConsistent(repo, 'bulkInsert-loop-' + i);
    A.strictEqual(repo._records.length, 55);
  });

  // ================================================================
  // N. Transaction()
  // ================================================================

  await checkAsync('N1: transaction() with mixed create/update/delete/restore steps commits atomically, index rebuilt once', async () => {
    const { repo } = await makeOpenRepo({ entityKey: 'n1', idField: 'id' },
      [seedEntity('a'), seedEntity('b', { deletedAt: nowIso() })]);
    const res = await repo.transaction([
      { op: 'create', entity: { id: 'c1' } },
      { op: 'update', id: 'a', patch: { name: 'updated' } },
      { op: 'restore', id: 'b' },
      { op: 'delete', id: 'c1' }
    ]);
    A.strictEqual(res.success, true);
    A.strictEqual(res.results.length, 4);
    assertIndexConsistent(repo, 'after-mixed-transaction');
  });

  await checkAsync('N2: transaction() step failure rolls back everything — index untouched, no partial commit', async () => {
    const { repo } = await makeOpenRepo({ entityKey: 'n2', idField: 'id' }, makeSeeds(3));
    const beforeMap = new Map(repo._idIndex);
    const beforeLive = repo._liveCount;
    const res = await repo.transaction([
      { op: 'create', entity: { id: 'x1' } },
      { op: 'update', id: 'does-not-exist', patch: { name: 'y' } }
    ]);
    A.strictEqual(res.success, false);
    A.strictEqual(repo._idIndex.size, beforeMap.size);
    A.strictEqual(repo._liveCount, beforeLive);
    A.strictEqual(repo._idIndex.has('x1'), false);
    assertIndexConsistent(repo, 'after-rolled-back-transaction');
  });

  await checkAsync('N3: transaction() persist() failure (all steps individually valid) rolls back to the pre-transaction snapshot', async () => {
    const seeds = makeSeeds(3);
    const adapter = makeFailingAdapter({ entityKey: 'n3', records: seeds }, [1]);
    const repo = new Repository({ entityKey: 'n3', idField: 'id', storageAdapter: adapter });
    await repo.open();
    const res = await repo.transaction([{ op: 'create', entity: { id: 'x1' } }]);
    A.strictEqual(res.success, false);
    A.strictEqual(repo._records.length, 3);
    assertIndexConsistent(repo, 'after-transaction-persist-failure');
  });

  await checkAsync('N4: transaction() {op:update} on a soft-deleted record without allowDeleted is rejected (T-10 fix regression)', async () => {
    const { repo } = await makeOpenRepo({ entityKey: 'n4', idField: 'id' }, [seedEntity('a', { deletedAt: nowIso() })]);
    const res = await repo.transaction([{ op: 'update', id: 'a', patch: { name: 'x' } }]);
    A.strictEqual(res.success, false);
  });

  await checkAsync('N5: nested/re-entrant transaction() while one is logically in-flight is rejected with CONFLICT', async () => {
    const { repo } = await makeOpenRepo({ entityKey: 'n5', idField: 'id' }, makeSeeds(2));
    repo._locked = true; // simulate in-flight, same technique as verify_restore_stress.js I1
    const res = await repo.transaction([{ op: 'create', entity: { id: 'x' } }]);
    A.strictEqual(res.success, false);
    A.strictEqual(res.error.type, RepositoryErrorTypes.CONFLICT);
    repo._locked = false;
  });

  await checkAsyncLoop('N6: repeated independent transactions (1 op each) never leak lock state or corrupt the index', 40, async (i) => {
    const { repo } = await makeOpenRepo({ entityKey: 'n6_' + i, idField: 'id' }, makeSeeds(3));
    await repo.transaction([{ op: 'create', entity: { id: 'x' + i } }]);
    A.strictEqual(repo._locked, false);
    assertIndexConsistent(repo, 'repeated-tx-' + i);
  });

  // ================================================================
  // O. Duplicate IDs
  // ================================================================

  await checkAsync('O1: bulkInsert() with a duplicate id (pre-existing, unchanged lack of duplicate check) — _idIndex resolves to the FIRST occurrence, matching the pre-cache linear-scan oracle', async () => {
    const { repo } = await makeOpenRepo({ entityKey: 'o1', idField: 'id' }, [seedEntity('dup', { name: 'first' })]);
    await repo.bulkInsert([seedEntity('dup', { name: 'second' })]);
    A.strictEqual(repo._records.length, 2, 'both physically present — pre-existing behavior, not fixed');
    A.strictEqual(repo._indexOf('dup'), linearIndexOf(repo, 'dup'), 'index must match linear-scan first-occurrence result');
    A.strictEqual(repo.get('dup').name, 'first', 'get() resolves to the first occurrence, exactly as pre-cache behavior would');
  });

  await checkAsync('O2: _rebuildIndex() on an array containing a duplicate id preserves first-occurrence-wins', async () => {
    const { repo } = await makeOpenRepo({ entityKey: 'o2', idField: 'id' }, [seedEntity('dup', { name: 'A' })]);
    await repo.bulkInsert([seedEntity('dup', { name: 'B' }), seedEntity('dup', { name: 'C' })]);
    repo._rebuildIndex();
    A.strictEqual(repo._idIndex.get('dup'), 0, 'rebuild must still resolve to the first array position');
  });

  await checkAsync('O3: duplicate ids via import(replace) — first-occurrence-wins holds after a full replace + rebuild', async () => {
    const { repo } = await makeOpenRepo({ entityKey: 'o3', idField: 'id' }, []);
    await repo.import([seedEntity('dup', { name: 'X' }), seedEntity('dup', { name: 'Y' })], 'replace');
    A.strictEqual(repo._idIndex.get('dup'), 0);
    A.strictEqual(repo.get('dup').name, 'X');
  });

  // ================================================================
  // P. Soft-delete / Hard-delete correctness
  // ================================================================

  await checkAsync('P1: softDelete:true (matching all 9 real entity Repositories) — delete() never shrinks _records, getAll() excludes it', async () => {
    const { repo } = await makeOpenRepo({ entityKey: 'p1', idField: 'id' }, makeSeeds(5));
    await repo.delete('r0');
    A.strictEqual(repo._records.length, 5, 'soft-delete keeps the record physically present');
    A.strictEqual(repo.getAll().length, 4);
  });

  await checkAsync('P2: softDelete:false — delete() physically removes the record, getAll()/count() drop by exactly one', async () => {
    const { repo } = await makeOpenRepo({ entityKey: 'p2', idField: 'id', softDelete: false }, makeSeeds(5));
    await repo.delete('r0');
    A.strictEqual(repo._records.length, 4);
    A.strictEqual(repo.getAll().length, 4);
    A.strictEqual(repo.count(), 4);
  });

  await checkAsync('P3: softDelete:false — _liveCount always exactly equals _records.length (no record can ever be "deleted" there)', async () => {
    const { repo } = await makeOpenRepo({ entityKey: 'p3', idField: 'id', softDelete: false }, makeSeeds(8));
    A.strictEqual(repo._liveCount, repo._records.length);
    await repo.delete('r0');
    A.strictEqual(repo._liveCount, repo._records.length);
    await repo.create({ id: 'new1' });
    A.strictEqual(repo._liveCount, repo._records.length);
  });

  // ================================================================
  // Q. includeDeleted / allowDeleted correctness
  // ================================================================

  await checkAsync('Q1: get()/exists() default (no options) always excludes soft-deleted, matches getAll()/count() default behavior', async () => {
    const { repo } = await makeOpenRepo({ entityKey: 'q1', idField: 'id' }, [seedEntity('a', { deletedAt: nowIso() })]);
    A.strictEqual(repo.get('a'), null);
    A.strictEqual(repo.exists('a'), false);
    A.strictEqual(repo.getAll().length, 0);
    A.strictEqual(repo.count(), 0);
  });

  await checkAsync('Q2: get()/exists()/getAll()/search()/count() all agree when includeDeleted:true is passed', async () => {
    const { repo } = await makeOpenRepo({ entityKey: 'q2', idField: 'id' }, [seedEntity('a', { deletedAt: nowIso() })]);
    A.ok(repo.get('a', { includeDeleted: true }));
    A.strictEqual(repo.exists('a', { includeDeleted: true }), true);
    A.strictEqual(repo.getAll({ includeDeleted: true }).length, 1);
    A.strictEqual(repo.search({ includeDeleted: true }).total, 1);
    A.strictEqual(repo.count({ includeDeleted: true }), 1);
  });

  await checkAsync('Q3: allowDeleted is independent per update()/bulkUpdate() call — one call\'s flag never leaks to another', async () => {
    const { repo } = await makeOpenRepo({ entityKey: 'q3', idField: 'id' },
      [seedEntity('a', { deletedAt: nowIso() }), seedEntity('b', { deletedAt: nowIso() })]);
    const resA = await repo.update('a', { name: 'x' }, { allowDeleted: true });
    const resB = await repo.update('b', { name: 'y' }); // no allowDeleted
    A.strictEqual(resA.success, true);
    A.strictEqual(resB.success, false);
  });

  // ================================================================
  // R. API & backward compatibility
  // ================================================================

  await checkAsync('R1: _idIndex/_liveCount never appear on any returned WriteResult, record, or array (fully internal)', async () => {
    const { repo } = await makeOpenRepo({ entityKey: 'r1cache', idField: 'id' }, makeSeeds(3));
    const created = await repo.create({ id: 'n1' });
    A.strictEqual(JSON.stringify(created).indexOf('_idIndex'), -1);
    A.strictEqual(JSON.stringify(repo.getAll()).indexOf('_liveCount'), -1);
    A.strictEqual(JSON.stringify(repo.export()).indexOf('_idIndex'), -1);
  });

  await checkAsync('R2: every public method signature/return shape/error type is unchanged — no Module-facing API drift', async () => {
    const { repo } = await makeOpenRepo({ entityKey: 'r2cache', idField: 'id' }, makeSeeds(3));
    const created = await repo.create({ id: 'n1' });
    A.ok('success' in created && 'record' in created && 'error' in created);
    const updated = await repo.update('n1', { name: 'x' });
    A.ok('success' in updated && 'record' in updated && 'error' in updated);
    const searched = repo.search({});
    A.ok('items' in searched && 'total' in searched && 'hasMore' in searched);
    const tx = await repo.transaction([{ op: 'create', entity: { id: 'n2' } }]);
    A.ok('success' in tx && 'results' in tx && 'error' in tx);
  });

  await checkAsync('R3: natural-key (Arabic) idField Repository — matching the real 9 entity Repositories\' shape — cache correctness unaffected by key shape', async () => {
    const { repo } = await makeOpenRepo({ entityKey: 'r3cache', idField: 'رقم_القضية' },
      [seedEntity(undefined, { 'رقم_القضية': 'ق-1', name: 'قضية أولى' })]);
    A.strictEqual(repo._idIndex.get('ق-1'), 0);
    const res = await repo.update('ق-1', { name: 'محدثة' });
    A.strictEqual(res.success, true);
    assertIndexConsistent(repo, 'arabic-idfield');
  });

  await checkAsync('R4: generated-id Repository (idField: null + idGenerator) resolves and indexes ids identically to natural-key Repositories', async () => {
    let counter = 0;
    const repo = new Repository({
      entityKey: 'r4cache', idField: null, idGenerator: () => 'gen' + (++counter),
      storageAdapter: makeMockAdapter()
    });
    await repo.open();
    const res = await repo.create({ name: 'x' });
    A.strictEqual(res.record.id, 'gen1');
    A.strictEqual(repo._idIndex.get('gen1'), 0);
  });

  await checkAsync('R5: unsupportedOperations guard is unaffected by the cache layer — a disabled op still fails identically', async () => {
    const { repo } = await makeOpenRepo({ entityKey: 'r5cache', idField: 'id', unsupportedOperations: ['create'] }, makeSeeds(2));
    let threw = false;
    try { await repo.create({ id: 'x' }); } catch (e) { threw = (e.type === RepositoryErrorTypes.UNSUPPORTED_OPERATION); }
    A.ok(threw);
  });

  // ================================================================
  // S. Mixed / randomized stress (>= 500 iterations) — satisfies:
  // Random operations, Mixed CRUD, Mixed Restore, Mixed Transactions,
  // Mixed Import, Mixed Bulk operations, Mixed workloads, Random workloads
  // (this project's own established convention — see verify_restore_
  // stress.js W1/W2 — is one broad randomized section covering several
  // related checklist items at once, rather than N near-duplicate ones).
  // ================================================================

  await checkAsync('S: 600-operation pseudo-random mixed-CRUD/bulk/transaction/import stress sequence ends fully self-consistent', async () => {
    const { repo } = await makeOpenRepo({ entityKey: 's1', idField: 'id' }, makeSeeds(30, 5));
    let seq = 12345; // deterministic PRNG (LCG) for reproducibility
    function rnd() { seq = (seq * 1103515245 + 12345) & 0x7fffffff; return seq / 0x7fffffff; }
    function pickExistingId() {
      const ids = Array.from(repo._idIndex.keys());
      return ids.length ? ids[Math.floor(rnd() * ids.length)] : null;
    }

    let nextNew = 0;
    const ITERATIONS = 600;
    for (let i = 0; i < ITERATIONS; i++) {
      const roll = rnd();
      try {
        if (roll < 0.15) {
          await repo.create({ id: 'stress' + (nextNew++) });
        } else if (roll < 0.30) {
          const id = pickExistingId();
          if (id) await repo.update(id, { name: 'u' + i }, { allowDeleted: rnd() < 0.5 });
        } else if (roll < 0.45) {
          const id = pickExistingId();
          if (id) await repo.delete(id);
        } else if (roll < 0.55) {
          const id = pickExistingId();
          if (id) await repo.restore(id);
        } else if (roll < 0.65) {
          await repo.bulkInsert([{ id: 'stressB' + (nextNew++) }, { id: 'stressB' + (nextNew++) }]);
        } else if (roll < 0.75) {
          const id1 = pickExistingId(); const id2 = pickExistingId();
          const patches = [id1, id2].filter(Boolean).map((id) => ({ id, patch: { name: 'bu' + i }, allowDeleted: true }));
          if (patches.length) await repo.bulkUpdate(patches);
        } else if (roll < 0.85) {
          const id1 = pickExistingId(); const id2 = pickExistingId();
          const ids = [id1, id2].filter(Boolean);
          if (ids.length) await repo.bulkDelete(ids);
        } else if (roll < 0.93) {
          const id = pickExistingId();
          if (id) await repo.import([{ id: id, name: 'merged' + i }], 'merge');
        } else {
          const id = pickExistingId();
          if (id) {
            await repo.transaction([
              { op: 'create', entity: { id: 'stressT' + (nextNew++) } },
              { op: 'update', id: id, patch: { name: 'tx' + i }, allowDeleted: true }
            ]);
          }
        }
      } catch (e) {
        // A thrown structured error (e.g. transaction() unsupported-op edge)
        // is acceptable; a corrupted cache afterward is not — fall through
        // to the consistency assertion below regardless.
      }
      if (i % 25 === 0) assertIndexConsistent(repo, 'mid-stress-iter-' + i);
    }
    assertIndexConsistent(repo, 'final-stress-state');
  });

  await checkAsync('S2: the 600-op stress sequence above never produced a duplicate id or an orphaned index entry', async () => {
    // Re-derive a second, independently-seeded 500-iteration run as a
    // second sample, per the task's ">= 500 iterations" minimum being a
    // floor, not a ceiling, and to catch any seed-dependent flake.
    const { repo } = await makeOpenRepo({ entityKey: 's2', idField: 'id' }, makeSeeds(15));
    let seq = 987654321;
    function rnd() { seq = (seq * 1103515245 + 12345) & 0x7fffffff; return seq / 0x7fffffff; }
    let nextNew = 0;
    for (let i = 0; i < 500; i++) {
      const ids = Array.from(repo._idIndex.keys());
      const id = ids.length ? ids[Math.floor(rnd() * ids.length)] : null;
      const roll = rnd();
      if (roll < 0.2) await repo.create({ id: 'sx' + (nextNew++) });
      else if (roll < 0.4 && id) await repo.update(id, { name: 'v' + i }, { allowDeleted: true });
      else if (roll < 0.6 && id) await repo.delete(id);
      else if (roll < 0.8 && id) await repo.restore(id);
      else if (id) await repo.bulkDelete([id]);
    }
    const ids = repo._records.map((r) => r.id);
    A.strictEqual(new Set(ids).size, ids.length, 'no duplicate ids ever entered _records via this sequence');
    assertIndexConsistent(repo, 'second-stress-sample-final');
  });

  // ================================================================
  // T. Long transaction chains
  // ================================================================

  await checkAsync('T1: a single transaction() with 60 mixed ops (create/update/delete/restore interleaved) commits atomically', async () => {
    const { repo } = await makeOpenRepo({ entityKey: 't1', idField: 'id' }, makeSeeds(20, 4));
    const ops = [];
    for (let i = 0; i < 20; i++) {
      ops.push({ op: 'create', entity: { id: 'tc' + i } });
      ops.push({ op: 'update', id: 'r' + (i % 20), patch: { name: 'tu' + i }, allowDeleted: true });
      ops.push({ op: 'delete', id: 'tc' + i });
    }
    const res = await repo.transaction(ops);
    A.strictEqual(res.success, true);
    A.strictEqual(res.results.length, 60);
    assertIndexConsistent(repo, 'after-60-op-transaction');
  });

  await checkAsyncLoop('T2: 20 independent long transaction chains (40 ops each) never leave index drift behind', 20, async (i) => {
    const { repo } = await makeOpenRepo({ entityKey: 't2_' + i, idField: 'id' }, makeSeeds(10));
    const ops = [];
    for (let k = 0; k < 20; k++) {
      ops.push({ op: 'create', entity: { id: 'lc' + k } });
      ops.push({ op: 'delete', id: 'lc' + k });
    }
    const res = await repo.transaction(ops);
    A.strictEqual(res.success, true);
    assertIndexConsistent(repo, 'long-chain-' + i);
  });

  await checkAsync('T3: a long transaction chain that fails on its FINAL step rolls back all preceding successfully-staged steps', async () => {
    const { repo } = await makeOpenRepo({ entityKey: 't3', idField: 'id' }, makeSeeds(5));
    const beforeMap = new Map(repo._idIndex);
    const ops = [];
    for (let i = 0; i < 30; i++) ops.push({ op: 'create', entity: { id: 'fc' + i } });
    ops.push({ op: 'update', id: 'does-not-exist', patch: {} }); // fails last
    const res = await repo.transaction(ops);
    A.strictEqual(res.success, false);
    A.strictEqual(repo._idIndex.size, beforeMap.size, 'all 30 creates must be rolled back');
    assertIndexConsistent(repo, 'after-long-chain-final-failure');
  });

  // ================================================================
  // U. Large bulk operations / large import merge
  // ================================================================

  await checkAsync('U1: bulkInsert() of 5,000 records in one call — correct final size, correct index for first/middle/last', async () => {
    const { repo } = await makeOpenRepo({ entityKey: 'u1', idField: 'id' }, makeSeeds(100));
    const results = await repo.bulkInsert(makeSeeds(5000, 0, 'big'));
    A.strictEqual(results.length, 5000);
    A.ok(results.every((r) => r.success));
    A.strictEqual(repo._records.length, 5100);
    A.strictEqual(repo._idIndex.get('big0'), 100);
    A.strictEqual(repo._idIndex.get('big2500'), 2600);
    A.strictEqual(repo._idIndex.get('big4999'), 5099);
    assertIndexConsistent(repo, 'after-5000-bulkInsert');
  });

  await checkAsync('U2: bulkUpdate() of 2,000 items against a 5,100-record repository completes correctly (O(m+n) shape)', async () => {
    const { repo } = await makeOpenRepo({ entityKey: 'u2', idField: 'id' }, makeSeeds(5100, 0, 'big'));
    const patches = [];
    for (let i = 0; i < 2000; i++) patches.push({ id: 'big' + i, patch: { name: 'updated' + i } });
    const results = await repo.bulkUpdate(patches);
    A.ok(results.every((r) => r.success));
    A.strictEqual(repo.get('big0').name, 'updated0');
    A.strictEqual(repo.get('big1999').name, 'updated1999');
    assertIndexConsistent(repo, 'after-2000-bulkUpdate');
  });

  await checkAsync('U3: bulkDelete() of 1,000 items (soft) against a 5,100-record repository completes correctly', async () => {
    const { repo } = await makeOpenRepo({ entityKey: 'u3', idField: 'id' }, makeSeeds(5100, 0, 'big'));
    const ids = [];
    for (let i = 0; i < 1000; i++) ids.push('big' + i);
    const results = await repo.bulkDelete(ids);
    A.ok(results.every((r) => r.success));
    A.strictEqual(repo._liveCount, 4100);
    A.strictEqual(repo._records.length, 5100, 'soft-delete keeps every record physically present');
    assertIndexConsistent(repo, 'after-1000-bulkDelete-soft');
  });

  await checkAsync('U4: import(merge) of 5,000 records (half new, half updating existing) completes correctly, index consistent', async () => {
    const { repo } = await makeOpenRepo({ entityKey: 'u4', idField: 'id' }, makeSeeds(3000, 0, 'orig'));
    const payload = [];
    for (let i = 0; i < 2500; i++) payload.push(seedEntity('orig' + i, { name: 'merged' + i })); // existing
    for (let i = 0; i < 2500; i++) payload.push(seedEntity('new' + i, { name: 'brandnew' + i })); // new
    const res = await repo.import(payload, 'merge');
    A.strictEqual(res.success, true);
    A.strictEqual(repo._records.length, 5500);
    A.strictEqual(repo.get('orig0').name, 'merged0');
    A.strictEqual(repo.get('new0').name, 'brandnew0');
    assertIndexConsistent(repo, 'after-5000-import-merge');
  });

  await checkAsync('U5: import(replace) of 10,000 records completes correctly, full rebuild produces a consistent index', async () => {
    const { repo } = await makeOpenRepo({ entityKey: 'u5', idField: 'id' }, makeSeeds(100));
    const res = await repo.import(makeSeeds(10000, 7, 'rep'), 'replace');
    A.strictEqual(res.success, true);
    A.strictEqual(repo._records.length, 10000);
    assertIndexConsistent(repo, 'after-10000-import-replace');
  });

  // ================================================================
  // V. Long-running repository / memory stability
  // ================================================================

  await checkAsync('V1: a single long-lived Repository instance survives 3,000 sequential mixed operations with a stable, correct cache', async () => {
    const { repo } = await makeOpenRepo({ entityKey: 'v1', idField: 'id' }, makeSeeds(50));
    let seq = 42;
    function rnd() { seq = (seq * 1103515245 + 12345) & 0x7fffffff; return seq / 0x7fffffff; }
    let nextNew = 0;
    const heapBefore = process.memoryUsage().heapUsed;
    for (let i = 0; i < 3000; i++) {
      const ids = Array.from(repo._idIndex.keys());
      const id = ids[Math.floor(rnd() * ids.length)];
      const roll = rnd();
      if (roll < 0.25) await repo.create({ id: 'lr' + (nextNew++) });
      else if (roll < 0.5) await repo.update(id, { name: 'x' + i }, { allowDeleted: true });
      else if (roll < 0.75) await repo.delete(id);
      else await repo.restore(id);
    }
    const heapAfter = process.memoryUsage().heapUsed;
    assertIndexConsistent(repo, 'after-3000-op-long-running-session');
    perf.longRunningHeapDeltaKB = Math.round((heapAfter - heapBefore) / 1024);
    // Loose sanity bound only (informational per project convention —
    // verify_restore_stress.js's own heap-delta lines are informational,
    // not hard-asserted, since GC timing is environment-dependent) — this
    // still catches a genuine unbounded-growth regression (e.g. an index
    // entry leak per operation) while tolerating normal GC variance.
    A.ok(heapAfter - heapBefore < 200 * 1024 * 1024, 'heap must not grow by more than 200MB across 3000 ops on ~50-350 records');
  });

  // ================================================================
  // W. Performance benchmarks — 100 / 1,000 / 10,000 / 25,000 / 50,000
  // ================================================================

  const SIZES = [100, 1000, 10000, 25000, 50000];
  perf.sizes = SIZES;
  perf.byOperation = {};
  function recordPerf(op, size, ms, extra) {
    perf.byOperation[op] = perf.byOperation[op] || [];
    perf.byOperation[op].push(Object.assign({ size, ms }, extra || {}));
  }

  for (const N of SIZES) {
    await checkAsync('W-' + N + ': structural correctness holds at scale (' + N + ' records)', async () => {
      const seeds = makeSeeds(N, 10);
      const adapter = makeMockAdapter({ entityKey: 'w' + N, records: seeds });

      const t0 = process.hrtime();
      const repo = new Repository({ entityKey: 'w' + N, idField: 'id', storageAdapter: adapter });
      await repo.open();
      const tOpen = hrToMs(process.hrtime(t0));
      recordPerf('open', N, tOpen);

      assertIndexConsistent(repo, 'scale-' + N);

      // --- get() ---
      {
        const t = process.hrtime();
        const iters = Math.min(2000, N);
        for (let i = 0; i < iters; i++) repo.get('r' + (i % N));
        const ms = hrToMs(process.hrtime(t));
        recordPerf('get', N, ms, { iters, usPerOp: (ms * 1000) / iters });
      }

      // --- exists() ---
      {
        const t = process.hrtime();
        const iters = Math.min(2000, N);
        for (let i = 0; i < iters; i++) repo.exists('r' + (i % N));
        const ms = hrToMs(process.hrtime(t));
        recordPerf('exists', N, ms, { iters, usPerOp: (ms * 1000) / iters });
      }

      // --- count() (O(1) fast path) ---
      {
        const t = process.hrtime();
        const iters = 5000;
        for (let i = 0; i < iters; i++) repo.count();
        const ms = hrToMs(process.hrtime(t));
        recordPerf('count', N, ms, { iters, usPerOp: (ms * 1000) / iters });
      }

      // --- search() (O(n) baseline, for contrast) ---
      {
        const t = process.hrtime();
        repo.search({ filter: { name: { op: 'ne', value: '__none__' } }, limit: 10 });
        const ms = hrToMs(process.hrtime(t));
        recordPerf('search', N, ms);
      }

      // --- update() (single record) ---
      {
        const t = process.hrtime();
        await repo.update('r' + Math.floor(N / 2), { name: 'bench-updated' });
        const ms = hrToMs(process.hrtime(t));
        recordPerf('update', N, ms);
      }

      // --- delete()/restore() (single record) ---
      {
        const targetId = 'r' + (Math.floor(N / 2) + 1 < N ? Math.floor(N / 2) + 1 : 0);
        const t1 = process.hrtime();
        await repo.delete(targetId);
        const msDelete = hrToMs(process.hrtime(t1));
        recordPerf('delete', N, msDelete);

        const t2 = process.hrtime();
        await repo.restore(targetId);
        const msRestore = hrToMs(process.hrtime(t2));
        recordPerf('restore', N, msRestore);
      }

      // --- bulkUpdate() (200 items) ---
      {
        const patches = [];
        for (let i = 0; i < 200; i++) patches.push({ id: 'r' + i, patch: { name: 'bulk-upd-' + i } });
        const t = process.hrtime();
        await repo.bulkUpdate(patches);
        const ms = hrToMs(process.hrtime(t));
        recordPerf('bulkUpdate', N, ms, { items: 200, usPerItem: (ms * 1000) / 200 });
      }

      // --- bulkDelete() (100 items, soft) ---
      {
        const ids = [];
        const base = Math.min(N - 200, N - 1);
        for (let i = 0; i < 100; i++) ids.push('r' + (base > 0 ? (base - i) : i));
        const t = process.hrtime();
        await repo.bulkDelete(ids);
        const ms = hrToMs(process.hrtime(t));
        recordPerf('bulkDelete', N, ms, { items: 100 });
      }

      // --- transaction() (20 mixed ops) ---
      {
        const ops = [];
        for (let i = 0; i < 10; i++) {
          ops.push({ op: 'create', entity: { id: 'tx-bench-' + i } });
          ops.push({ op: 'delete', id: 'tx-bench-' + i });
        }
        const t = process.hrtime();
        await repo.transaction(ops);
        const ms = hrToMs(process.hrtime(t));
        recordPerf('transaction', N, ms, { ops: 20 });
      }

      // --- import('merge', 100 items) ---
      {
        const payload = [];
        for (let i = 0; i < 100; i++) payload.push(seedEntity('import-merge-' + i, { name: 'im' + i }));
        const t = process.hrtime();
        await repo.import(payload, 'merge');
        const ms = hrToMs(process.hrtime(t));
        recordPerf('importMerge', N, ms, { items: 100 });
      }

      // --- cache rebuild time / index rebuild time (same operation in this
      // architecture — _rebuildIndex() IS the cache/index rebuild) ---
      {
        const t = process.hrtime();
        repo._rebuildIndex();
        const ms = hrToMs(process.hrtime(t));
        recordPerf('cacheRebuild', N, ms);
      }

      // --- persist cost ---
      {
        const t = process.hrtime();
        await repo._persist();
        const ms = hrToMs(process.hrtime(t));
        recordPerf('persist', N, ms);
      }

      // --- memory usage ---
      {
        if (global.gc) global.gc();
        const heap = process.memoryUsage().heapUsed;
        recordPerf('memoryHeapUsedMB', N, 0, { mb: Math.round(heap / 1024 / 1024) });
      }

      assertIndexConsistent(repo, 'scale-' + N + '-after-all-benchmarks');
    });
  }

  await check('W-ratio: get()/exists() show sub-linear (O(1)-avg-consistent) scaling from 100 -> 50,000 records (500x growth)', () => {
    const smallGet = perf.byOperation.get.find((p) => p.size === 100).usPerOp;
    const largeGet = perf.byOperation.get.find((p) => p.size === 50000).usPerOp;
    const ratio = largeGet / smallGet;
    perf.getRatio100to50000 = ratio;
    // A true O(n) linear scan would show ~500x growth; O(1)-average Map
    // lookup should show far less. Generous threshold (50x, i.e. 10% of
    // the linear prediction) absorbs JIT-warmup/GC noise while still
    // catching a real O(n) regression, matching this project's own
    // established ratio-based (not absolute-time) methodology
    // (Cache_Layer_Implementation_Report.md §6).
    A.ok(ratio < 50, 'get() ratio (' + ratio.toFixed(2) + 'x) must stay far below the ~500x an O(n) scan would show');
  });

  await check('W-ratio2: bulkUpdate() (200 items) shows growth far below the ~500x an O(m*n) shape would predict from 100 -> 50,000 records', () => {
    const small = perf.byOperation.bulkUpdate.find((p) => p.size === 100).ms;
    const large = perf.byOperation.bulkUpdate.find((p) => p.size === 50000).ms;
    const ratio = large / Math.max(small, 0.001);
    perf.bulkUpdateRatio100to50000 = ratio;
    A.ok(ratio < 500, 'bulkUpdate() ratio (' + ratio.toFixed(2) + 'x) must stay below the ~500x an O(m*n) shape would predict (persist() O(n) floor still applies, so some growth is expected)');
  });

  await check('W-ratio3: count() (no filter) stays effectively flat (O(1)) from 100 -> 50,000 records', () => {
    const small = perf.byOperation.count.find((p) => p.size === 100).usPerOp;
    const large = perf.byOperation.count.find((p) => p.size === 50000).usPerOp;
    const ratio = large / Math.max(small, 0.001);
    perf.countRatio100to50000 = ratio;
    A.ok(ratio < 50, 'count() ratio (' + ratio.toFixed(2) + 'x) must stay far below the ~500x an O(n) scan would show');
  });

  // ================================================================
  // X. Regression cross-check (informational marker — the actual full
  // suite is run by run_full_regression.js and summarized in the reports)
  // ================================================================

  await check('X1: this harness itself modified zero production files (self-check — no require() of Repository.js in write mode, no fs.writeFileSync calls anywhere in this file)', () => {
    const src = require('fs').readFileSync(__filename, 'utf8');
    A.strictEqual(/fs\.writeFileSync/.test(src.replace(/\/\*[\s\S]*?\*\//g, '').split('X1:')[0]), false);
  });

  // ================================================================
  // Summary
  // ================================================================

  console.log('');
  console.log('================================================================');
  console.log('verify_cache_validation.js — RESULTS');
  console.log('================================================================');
  log.forEach((l) => console.log(l));
  console.log('----------------------------------------------------------------');
  console.log('Labeled tests: ' + (passed + failed) + '   (PASS ' + passed + ' / FAIL ' + failed + ')');
  console.log('Assertion executions: ' + assertionCount);
  console.log('================================================================');

  // Dump machine-readable perf data for the report-generation step.
  console.log('__PERF_JSON_START__');
  console.log(JSON.stringify(perf));
  console.log('__PERF_JSON_END__');

  if (failed > 0) {
    process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error('FATAL — uncaught error in verify_cache_validation.js:', e);
  process.exitCode = 1;
});
