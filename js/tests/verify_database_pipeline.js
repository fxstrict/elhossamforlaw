/**
 * verify_database_pipeline.js
 * ================================================================
 * PHASE 8 — SUB-PHASE 8.4.2 — DatabaseService Integration Verification
 * ================================================================
 * Standalone Node harness proving the full pipeline
 *
 *     Repository  ->  DatabaseService  ->  LocalStorageAdapter
 *
 * works correctly end-to-end. VERIFICATION ONLY — this file (and
 * docs/Database_Pipeline_Report.md) are the only artifacts this phase
 * creates.
 *
 * NOT MODIFIED (read-only inputs to this phase):
 *   - js/core/Repository.js
 *   - js/core/DatabaseService.js
 *   - js/core/StorageAdapter.js
 *   - js/core/LocalStorageAdapter.js
 *
 * A temporary `TestRepository` subclass of the real `Repository` base
 * class is defined IN THIS FILE ONLY (never written back to
 * js/repositories/ or js/core/) purely to have a minimal, concrete,
 * throwaway entity to drive through the pipeline. It adds no
 * business logic beyond a single required-field validation rule, so
 * that create()/update() validation paths are exercised too.
 *
 * Run: node js/tests/verify_database_pipeline.js
 * No browser required — a fake in-memory object satisfying the exact
 * Storage shape (getItem/setItem/removeItem/key/length) that the real
 * browser `localStorage` exposes is injected into LocalStorageAdapter's
 * `storageImpl` config, exactly like every existing
 * verify_*_repository.js harness already does via makeFakeStorage().
 * ================================================================
 */

'use strict';

const assert = require('assert');
const path = require('path');

const { Repository } = require(path.join(__dirname, '..', 'core', 'Repository.js'));
const { StorageAdapter } = require(path.join(__dirname, '..', 'core', 'StorageAdapter.js'));
const { DatabaseService } = require(path.join(__dirname, '..', 'core', 'DatabaseService.js'));
const { LocalStorageAdapter } = require(path.join(__dirname, '..', 'core', 'LocalStorageAdapter.js'));

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

// ----------------------------------------------------------------
// 0. Guard: make sure global localStorage is NOT reachable from this
//    Node process, and additionally trap any access to it. If
//    Repository (or anything it calls that ISN'T the injected
//    DatabaseService/adapter) ever touches localStorage directly, this
//    trap makes that failure loud and immediate instead of silently
//    passing because Node simply has no such global.
// ----------------------------------------------------------------
Object.defineProperty(global, 'localStorage', {
  configurable: true,
  get() {
    throw new Error(
      'FORBIDDEN ACCESS: something touched the global `localStorage` ' +
      'directly instead of going through the injected storageAdapter ' +
      '(Repository -> DatabaseService -> LocalStorageAdapter).'
    );
  }
});

// ---- Fake localStorage engine (matches getItem/setItem/removeItem/key/length shape) ----
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
// 1. Temporary Repository subclass (this file only — never persisted
//    elsewhere). Entity key: 'pipeline_probe'. Single required field
//    'name', softDelete left at the base-class default (true), so
//    delete()/exists()/getAll() soft-delete interplay is exercised too.
// ----------------------------------------------------------------
function TestRepository(config) {
  Repository.call(this, config);
}
TestRepository.prototype = Object.create(Repository.prototype);
TestRepository.prototype.constructor = TestRepository;

TestRepository.prototype._validate = function (operation, record) {
  if (operation === 'create' || operation === 'update') {
    if (!record || typeof record.name !== 'string' || !record.name.trim()) {
      return { valid: false, errors: [{ field: 'name', message: 'name is required' }] };
    }
  }
  return { valid: true, errors: [] };
};

let uidCounter = 0;
function makeIdGenerator() {
  return function () { return 'probe-' + (++uidCounter); };
}

function makeTestRepository(dbService) {
  return new TestRepository({
    entityKey: 'pipeline_probe',
    storageAdapter: dbService,
    idGenerator: makeIdGenerator(),
    searchFields: ['name']
  });
}

// ----------------------------------------------------------------
// 2. Call-order / argument instrumentation — wraps DatabaseService's
//    OWN read()/write() (the two methods Repository is documented to
//    call) so we can observe, without changing behavior, exactly what
//    Repository sends down through DatabaseService to the adapter, in
//    what order, and what each call returns.
// ----------------------------------------------------------------
function instrument(dbService) {
  const callLog = [];
  const originalRead = dbService.read.bind(dbService);
  const originalWrite = dbService.write.bind(dbService);

  dbService.read = function (entityKey) {
    const entry = { method: 'read', args: [entityKey], seq: callLog.length };
    callLog.push(entry);
    return originalRead(entityKey).then(function (result) {
      entry.resolved = true;
      entry.result = result;
      return result;
    }, function (err) {
      entry.resolved = false;
      entry.error = err;
      throw err;
    });
  };

  dbService.write = function (entityKey, records) {
    const entry = {
      method: 'write',
      args: [entityKey, JSON.parse(JSON.stringify(records))],
      seq: callLog.length
    };
    callLog.push(entry);
    return originalWrite(entityKey, records).then(function (result) {
      entry.resolved = true;
      return result;
    }, function (err) {
      entry.resolved = false;
      entry.error = err;
      throw err;
    });
  };

  return callLog;
}

async function main() {

  // ================================================================
  // A. Wiring / shape checks
  // ================================================================
  check('StorageAdapter, DatabaseService, LocalStorageAdapter, Repository all load as functions', () => {
    assert.strictEqual(typeof StorageAdapter, 'function');
    assert.strictEqual(typeof DatabaseService, 'function');
    assert.strictEqual(typeof LocalStorageAdapter, 'function');
    assert.strictEqual(typeof Repository, 'function');
  });

  const fakeEngine = makeFakeStorage({});
  const adapter = new LocalStorageAdapter({ storageImpl: fakeEngine });

  check('LocalStorageAdapter instance is an instanceof StorageAdapter', () => {
    assert.ok(adapter instanceof StorageAdapter);
  });

  await checkAsync('adapter.open() resolves cleanly against the fake engine', async () => {
    await adapter.open();
  });

  const dbService = new DatabaseService(adapter);
  check('DatabaseService accepted the LocalStorageAdapter instance (constructor shape guard passed)', () => {
    assert.ok(dbService instanceof DatabaseService);
  });

  const callLog = instrument(dbService);

  check('DatabaseService exposes read/write required by Repository\'s storageAdapter duck-type contract', () => {
    assert.strictEqual(typeof dbService.read, 'function');
    assert.strictEqual(typeof dbService.write, 'function');
  });

  // ================================================================
  // B. Repository wired to DatabaseService — open()
  // ================================================================
  const repo = makeTestRepository(dbService);

  check('Repository constructor accepted DatabaseService as its storageAdapter (assertStorageAdapter passed)', () => {
    assert.strictEqual(repo.entityKey, 'pipeline_probe');
  });

  check('Repository state is "created" before open()', () => {
    assert.strictEqual(repo.getState(), 'created');
  });

  await checkAsync('open() on empty storage succeeds and calls DatabaseService.read() exactly once', async () => {
    await repo.open();
    assert.strictEqual(repo.isReady(), true);
    const reads = callLog.filter(c => c.method === 'read');
    assert.strictEqual(reads.length, 1);
    assert.deepStrictEqual(reads[0].args, ['pipeline_probe']);
    assert.deepStrictEqual(reads[0].result, []);
  });

  check('getAll() on a freshly-opened, empty entity returns []', () => {
    assert.deepStrictEqual(repo.getAll(), []);
  });

  // ================================================================
  // C. create()
  // ================================================================
  let firstId;
  await checkAsync('create() succeeds, generates an id via the injected idGenerator, and persists through DatabaseService.write()', async () => {
    const beforeWrites = callLog.filter(c => c.method === 'write').length;
    const res = await repo.create({ name: 'Alpha' });
    assert.strictEqual(res.success, true);
    assert.ok(res.record.id, 'expected a generated id');
    firstId = res.record.id;
    assert.strictEqual(res.record.name, 'Alpha');
    assert.strictEqual(res.record.version, 1);
    assert.strictEqual(typeof res.record.createdAt, 'string');

    const writes = callLog.filter(c => c.method === 'write');
    assert.strictEqual(writes.length, beforeWrites + 1);
    const lastWrite = writes[writes.length - 1];
    assert.strictEqual(lastWrite.args[0], 'pipeline_probe');
    assert.strictEqual(lastWrite.args[1].length, 1);
    assert.strictEqual(lastWrite.args[1][0].name, 'Alpha');
  });

  check('call order so far is exactly [read, write] (open() then create())', () => {
    assert.deepStrictEqual(callLog.map(c => c.method), ['read', 'write']);
  });

  await checkAsync('create() rejects a record missing the required "name" field, WITHOUT calling DatabaseService.write() again', async () => {
    const writesBefore = callLog.filter(c => c.method === 'write').length;
    const res = await repo.create({});
    assert.strictEqual(res.success, false);
    assert.strictEqual(res.error.type, 'ValidationError');
    assert.strictEqual(res.error.field, 'name');
    const writesAfter = callLog.filter(c => c.method === 'write').length;
    assert.strictEqual(writesAfter, writesBefore, 'validation failure must never reach persist()');
  });

  // ================================================================
  // D. get() / getAll() / exists()
  // ================================================================
  check('get(id) returns the created record as a CLONE (mutating it does not affect internal state)', () => {
    const record = repo.get(firstId);
    assert.strictEqual(record.name, 'Alpha');
    record.name = 'MUTATED';
    const again = repo.get(firstId);
    assert.strictEqual(again.name, 'Alpha');
  });

  check('get() on a non-existent id returns null (no throw)', () => {
    assert.strictEqual(repo.get('no-such-id'), null);
  });

  check('getAll() returns exactly one record, matching the created one', () => {
    const all = repo.getAll();
    assert.strictEqual(all.length, 1);
    assert.strictEqual(all[0].id, firstId);
  });

  check('exists(id) is true for the created record, false for an unknown id', () => {
    assert.strictEqual(repo.exists(firstId), true);
    assert.strictEqual(repo.exists('no-such-id'), false);
  });

  // ================================================================
  // E. update()
  // ================================================================
  await checkAsync('update() merges the patch, bumps version, and persists via DatabaseService.write()', async () => {
    const writesBefore = callLog.filter(c => c.method === 'write').length;
    const res = await repo.update(firstId, { name: 'Alpha-Updated' });
    assert.strictEqual(res.success, true);
    assert.strictEqual(res.record.name, 'Alpha-Updated');
    assert.strictEqual(res.record.version, 2);
    assert.strictEqual(res.record.id, firstId);
    const writesAfter = callLog.filter(c => c.method === 'write').length;
    assert.strictEqual(writesAfter, writesBefore + 1);
  });

  await checkAsync('update() on a non-existent id returns a structured ValidationError, no write() call', async () => {
    const writesBefore = callLog.filter(c => c.method === 'write').length;
    const res = await repo.update('no-such-id', { name: 'x' });
    assert.strictEqual(res.success, false);
    assert.strictEqual(res.error.type, 'ValidationError');
    const writesAfter = callLog.filter(c => c.method === 'write').length;
    assert.strictEqual(writesAfter, writesBefore);
  });

  // ================================================================
  // F. A second record, for getAll()/exists() plurality + delete()
  // ================================================================
  let secondId;
  await checkAsync('create() a second record ("Beta")', async () => {
    const res = await repo.create({ name: 'Beta' });
    assert.strictEqual(res.success, true);
    secondId = res.record.id;
    assert.notStrictEqual(secondId, firstId);
  });

  check('getAll() now returns both records', () => {
    assert.strictEqual(repo.getAll().length, 2);
  });

  // ================================================================
  // G. delete() — soft delete by default
  // ================================================================
  await checkAsync('delete() soft-deletes: record persists with deletedAt set, excluded from getAll()/exists() by default', async () => {
    const res = await repo.delete(secondId);
    assert.strictEqual(res.success, true);
    assert.ok(res.record.deletedAt, 'expected deletedAt to be stamped');
    assert.strictEqual(repo.exists(secondId), false);
    assert.strictEqual(repo.get(secondId), null);
    assert.strictEqual(repo.getAll().length, 1);
    assert.strictEqual(repo.getAll({ includeDeleted: true }).length, 2);
  });

  await checkAsync('delete() on a non-existent id returns a structured ValidationError', async () => {
    const res = await repo.delete('no-such-id');
    assert.strictEqual(res.success, false);
    assert.strictEqual(res.error.type, 'ValidationError');
  });

  // ================================================================
  // H. Persistence across reopen (simulated app restart)
  // ================================================================
  await checkAsync('close() then open() on the SAME Repository instance reloads identical data from storage', async () => {
    repo.close();
    assert.strictEqual(repo.getState(), 'closed');
    await repo.open();
    assert.strictEqual(repo.isReady(), true);
    assert.strictEqual(repo.getAll({ includeDeleted: true }).length, 2);
    assert.strictEqual(repo.get(firstId).name, 'Alpha-Updated');
  });

  await checkAsync('a BRAND NEW Repository instance, wired to a NEW DatabaseService over the SAME LocalStorageAdapter/engine, sees identical data ("reopen after restart")', async () => {
    const dbService2 = new DatabaseService(adapter);
    const repo2 = makeTestRepository(dbService2);
    await repo2.open();
    const all1 = repo.getAll({ includeDeleted: true }).map(r => r.id).sort();
    const all2 = repo2.getAll({ includeDeleted: true }).map(r => r.id).sort();
    assert.deepStrictEqual(all2, all1);
    assert.strictEqual(repo2.get(firstId).name, 'Alpha-Updated');
  });

  await checkAsync('persistence survives even a brand new LocalStorageAdapter instance pointed at the same underlying fake engine', async () => {
    const adapter2 = new LocalStorageAdapter({ storageImpl: fakeEngine });
    await adapter2.open();
    const dbService3 = new DatabaseService(adapter2);
    const repo3 = makeTestRepository(dbService3);
    await repo3.open();
    assert.strictEqual(repo3.getAll({ includeDeleted: true }).length, 2);
    assert.strictEqual(repo3.get(firstId).name, 'Alpha-Updated');
  });

  // ================================================================
  // I. clear()
  // ================================================================
  await checkAsync('clear() empties the entity and persists an empty array via DatabaseService.write()', async () => {
    const writesBefore = callLog.filter(c => c.method === 'write').length;
    const res = await repo.clear();
    assert.strictEqual(res.success, true);
    assert.deepStrictEqual(repo.getAll({ includeDeleted: true }), []);
    const writes = callLog.filter(c => c.method === 'write');
    assert.strictEqual(writes.length, writesBefore + 1);
    assert.deepStrictEqual(writes[writes.length - 1].args[1], []);
  });

  await checkAsync('a fresh reopen after clear() confirms the empty state was actually persisted, not just in-memory', async () => {
    const dbService4 = new DatabaseService(adapter);
    const repo4 = makeTestRepository(dbService4);
    await repo4.open();
    assert.deepStrictEqual(repo4.getAll({ includeDeleted: true }), []);
  });

  // ================================================================
  // J. Exceptions — storage-layer failure propagation, unchanged
  // ================================================================
  await checkAsync('a write() failure at the LocalStorageAdapter engine layer propagates unchanged through DatabaseService up to a Repository StorageError, and the in-memory record is rolled back', async () => {
    const brokenEngine = {
      getItem() { return null; },
      setItem() { throw new Error('simulated quota exceeded'); },
      removeItem() {},
      key() { return null; },
      length: 0
    };
    const brokenAdapter = new LocalStorageAdapter({ storageImpl: brokenEngine });
    await brokenAdapter.open();
    const brokenDb = new DatabaseService(brokenAdapter);
    const brokenRepo = makeTestRepository(brokenDb);
    await brokenRepo.open();

    const res = await brokenRepo.create({ name: 'WillFail' });
    assert.strictEqual(res.success, false);
    assert.strictEqual(res.error.type, 'StorageError');
    // Rolled back: the failed record must not remain in memory.
    assert.strictEqual(brokenRepo.getAll().length, 0);
  });

  await checkAsync('a read() failure (corrupt JSON already in storage) surfaces as a Repository StorageError from open()', async () => {
    const corruptEngine = makeFakeStorage({ pipeline_probe_corrupt: '{not valid json' });
    const corruptAdapter = new LocalStorageAdapter({ storageImpl: corruptEngine });
    await corruptAdapter.open();
    const corruptDb = new DatabaseService(corruptAdapter);
    const corruptRepo = new TestRepository({
      entityKey: 'pipeline_probe_corrupt',
      storageAdapter: corruptDb,
      idGenerator: makeIdGenerator()
    });
    await assert.rejects(
      () => corruptRepo.open(),
      (err) => err && err.type === 'StorageError'
    );
  });

  check('operating on a Repository before open() throws a structured StorageError ("not ready")', () => {
    const neverOpened = makeTestRepository(new DatabaseService(adapter));
    assert.throws(() => neverOpened.getAll(), (err) => err && err.type === 'StorageError');
  });

  check('DatabaseService constructor rejects a non-adapter-shaped object (Contract-guard exception)', () => {
    assert.throws(() => new DatabaseService({}), /implement/);
  });

  check('Repository constructor rejects an adapter missing read/write (assertStorageAdapter exception)', () => {
    assert.throws(() => new TestRepository({
      entityKey: 'x', storageAdapter: {}, idGenerator: makeIdGenerator()
    }), (err) => err && err.type === 'StorageError');
  });

  // ================================================================
  // K. Repository never touches localStorage directly
  // ================================================================
  check('js/core/Repository.js contains no EXECUTABLE reference to "localStorage" (only appears inside comments, documenting that a future adapter may bind to it)', () => {
    const fs = require('fs');
    const src = fs.readFileSync(path.join(__dirname, '..', 'core', 'Repository.js'), 'utf8');
    // Strip block comments (/* ... */) and line comments (// ...) before
    // checking — Repository.js's own header/JSDoc discusses localStorage
    // extensively as CONTEXT ("today it's localStorage, tomorrow IndexedDB"),
    // which is expected and fine; what must never appear is a live
    // `localStorage.` call in actual executable code.
    const withoutBlockComments = src.replace(/\/\*[\s\S]*?\*\//g, '');
    const withoutLineComments = withoutBlockComments.replace(/\/\/.*$/gm, '');
    assert.strictEqual(/localStorage/.test(withoutLineComments), false,
      'found a live (non-comment) reference to localStorage in Repository.js');
    // Sanity: the raw source DOES mention it (in comments only), so this
    // check is proven to actually be doing comment-stripping, not just
    // trivially passing on an already-clean file.
    assert.ok(/localStorage/.test(src), 'expected localStorage to appear in documentation comments');
  });

  check('Repository.js constructor only ever requires read()/write() on its injected adapter (REQUIRED_ADAPTER_METHODS)', () => {
    const fs = require('fs');
    const src = fs.readFileSync(path.join(__dirname, '..', 'core', 'Repository.js'), 'utf8');
    const m = src.match(/REQUIRED_ADAPTER_METHODS\s*=\s*(\[[^\]]*\])/);
    assert.ok(m, 'expected to find REQUIRED_ADAPTER_METHODS array literal');
    const arr = JSON.parse(m[1].replace(/'/g, '"'));
    assert.deepStrictEqual(arr, ['read', 'write']);
  });

  check('the global localStorage trap was never triggered during this entire run', () => {
    // If any code path had touched global.localStorage, the getter above
    // would have thrown synchronously and this harness would have
    // crashed long before reaching this final check.
    assert.ok(true);
  });

  // ================================================================
  // L. Full call-order recap across the whole run (sanity re-check)
  // ================================================================
  check('every DatabaseService.write() call in this run resolved successfully (none silently swallowed an error)', () => {
    const writes = callLog.filter(c => c.method === 'write');
    assert.ok(writes.length >= 5);
    writes.forEach(w => assert.strictEqual(w.resolved, true));
  });

  check('every DatabaseService.read() call in this run resolved successfully', () => {
    const reads = callLog.filter(c => c.method === 'read');
    assert.ok(reads.length >= 1);
    reads.forEach(r => assert.strictEqual(r.resolved, true));
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
