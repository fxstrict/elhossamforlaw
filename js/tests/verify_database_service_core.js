/**
 * verify_database_service_core.js
 * Standalone Node harness for DatabaseService Core Skeleton (Phase 8 /
 * Sub-phase 8.4.1). Self-contained — no shared helper module, matching
 * the existing `verify_*_repository.js` / `verify_localstorage_adapter.js`
 * harnesses' pattern.
 * Run: node js/tests/verify_database_service_core.js
 *
 * Uses a hand-rolled Mock StorageAdapter (not the real LocalStorageAdapter)
 * so every delegated call, its arguments, its call count, and its
 * resolved/rejected outcome can be asserted directly and unambiguously —
 * this harness verifies DELEGATION, not storage engine behavior (that is
 * already covered by verify_localstorage_adapter.js).
 */

const assert = require('assert');
const path = require('path');

const { StorageAdapter } = require(path.join(__dirname, '..', 'core', 'StorageAdapter.js'));
const { DatabaseService } = require(path.join(__dirname, '..', 'core', 'DatabaseService.js'));

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
    log.push('FAIL — ' + label + '  =>  ' + e.message);
  }
}

async function checkAsync(label, fn) {
  try {
    await fn();
    passed++;
    log.push('PASS — ' + label);
  } catch (e) {
    failed++;
    log.push('FAIL — ' + label + '  =>  ' + e.message);
  }
}

// ---- Mock StorageAdapter — records every call (name, args, call count)
// and lets each test script exactly what each method resolves/rejects
// with. Deliberately does NOT extend the real StorageAdapter class (a
// plain duck-typed object is sufficient and keeps this harness fully
// independent of StorageAdapter.js's own internals — only DatabaseService's
// constructor-time shape guard needs the method NAMES present). ----
function makeMockAdapter(overrides) {
  overrides = overrides || {};
  const calls = {
    open: [], close: [], destroy: [],
    read: [], write: [], delete: [], clear: [], exists: []
  };

  function record(name, args, behavior) {
    calls[name].push(args);
    if (typeof behavior === 'function') return behavior.apply(null, args);
    return behavior;
  }

  const mock = {
    _calls: calls,
    open: function () { return record('open', [], overrides.open || Promise.resolve(undefined)); },
    close: function () { return record('close', [], overrides.close || Promise.resolve(undefined)); },
    destroy: function () { return record('destroy', [], overrides.destroy || Promise.resolve(undefined)); },
    read: function (entityKey) {
      return record('read', [entityKey], overrides.read || Promise.resolve([]));
    },
    write: function (entityKey, records) {
      return record('write', [entityKey, records], overrides.write || Promise.resolve(undefined));
    },
    delete: function (entityKey) {
      return record('delete', [entityKey], overrides.delete || Promise.resolve(undefined));
    },
    clear: function () { return record('clear', [], overrides.clear || Promise.resolve(undefined)); },
    exists: function (entityKey) {
      return record('exists', [entityKey], overrides.exists || Promise.resolve(false));
    }
  };
  return mock;
}

async function main() {

  // 1. Class existence / constructor guard
  check('DatabaseService is a function / class', () => {
    assert.strictEqual(typeof DatabaseService, 'function');
  });

  check('constructor throws synchronously when no adapter is given', () => {
    assert.throws(() => new DatabaseService(), Error);
  });

  check('constructor throws synchronously when adapter is missing a required method', () => {
    const incomplete = { open: () => {}, close: () => {}, destroy: () => {}, read: () => {} };
    // missing write/delete/clear/exists
    assert.throws(() => new DatabaseService(incomplete), Error);
  });

  check('constructor accepts a fully-shaped adapter without throwing', () => {
    const mock = makeMockAdapter();
    const db = new DatabaseService(mock);
    assert.ok(db instanceof DatabaseService);
  });

  check('constructor accepts a real StorageAdapter subclass instance (shape-compatible)', () => {
    function FullAdapter() { StorageAdapter.call(this); }
    FullAdapter.prototype = Object.create(StorageAdapter.prototype);
    ['open', 'close', 'destroy', 'read', 'write', 'delete', 'clear', 'exists'].forEach(m => {
      FullAdapter.prototype[m] = function () { return Promise.resolve(); };
    });
    const db = new DatabaseService(new FullAdapter());
    assert.ok(db instanceof DatabaseService);
  });

  // 2. Delegation — call counts + arguments, one method at a time
  await checkAsync('open() delegates exactly once to adapter.open() with no arguments', async () => {
    const mock = makeMockAdapter();
    const db = new DatabaseService(mock);
    await db.open();
    assert.strictEqual(mock._calls.open.length, 1);
    assert.deepStrictEqual(mock._calls.open[0], []);
  });

  await checkAsync('close() delegates exactly once to adapter.close() with no arguments', async () => {
    const mock = makeMockAdapter();
    const db = new DatabaseService(mock);
    await db.close();
    assert.strictEqual(mock._calls.close.length, 1);
    assert.deepStrictEqual(mock._calls.close[0], []);
  });

  await checkAsync('destroy() delegates exactly once to adapter.destroy() with no arguments', async () => {
    const mock = makeMockAdapter();
    const db = new DatabaseService(mock);
    await db.destroy();
    assert.strictEqual(mock._calls.destroy.length, 1);
    assert.deepStrictEqual(mock._calls.destroy[0], []);
  });

  await checkAsync('read(entityKey) delegates exactly once with the exact entityKey argument', async () => {
    const mock = makeMockAdapter();
    const db = new DatabaseService(mock);
    await db.read('cases');
    assert.strictEqual(mock._calls.read.length, 1);
    assert.deepStrictEqual(mock._calls.read[0], ['cases']);
  });

  await checkAsync('write(entityKey, records) delegates exactly once with both exact arguments (same reference, not a clone)', async () => {
    const mock = makeMockAdapter();
    const db = new DatabaseService(mock);
    const records = [{ id: 1 }, { id: 2 }];
    await db.write('clients', records);
    assert.strictEqual(mock._calls.write.length, 1);
    assert.strictEqual(mock._calls.write[0][0], 'clients');
    assert.strictEqual(mock._calls.write[0][1], records); // identical reference — no cloning/wrapping
  });

  await checkAsync('delete(entityKey) delegates exactly once with the exact entityKey argument', async () => {
    const mock = makeMockAdapter();
    const db = new DatabaseService(mock);
    await db.delete('sessions');
    assert.strictEqual(mock._calls.delete.length, 1);
    assert.deepStrictEqual(mock._calls.delete[0], ['sessions']);
  });

  await checkAsync('clear() delegates exactly once with no arguments', async () => {
    const mock = makeMockAdapter();
    const db = new DatabaseService(mock);
    await db.clear();
    assert.strictEqual(mock._calls.clear.length, 1);
    assert.deepStrictEqual(mock._calls.clear[0], []);
  });

  await checkAsync('exists(entityKey) delegates exactly once with the exact entityKey argument', async () => {
    const mock = makeMockAdapter();
    const db = new DatabaseService(mock);
    await db.exists('tasks');
    assert.strictEqual(mock._calls.exists.length, 1);
    assert.deepStrictEqual(mock._calls.exists[0], ['tasks']);
  });

  // 3. Call-count discipline across multiple invocations / methods
  await checkAsync('each method call increments only its own counter, never another method\'s', async () => {
    const mock = makeMockAdapter();
    const db = new DatabaseService(mock);
    await db.open();
    await db.read('cases');
    await db.read('clients');
    await db.write('cases', []);
    assert.strictEqual(mock._calls.open.length, 1);
    assert.strictEqual(mock._calls.read.length, 2);
    assert.strictEqual(mock._calls.write.length, 1);
    assert.strictEqual(mock._calls.close.length, 0);
    assert.strictEqual(mock._calls.destroy.length, 0);
    assert.strictEqual(mock._calls.delete.length, 0);
    assert.strictEqual(mock._calls.clear.length, 0);
    assert.strictEqual(mock._calls.exists.length, 0);
  });

  // 4. Return values — resolved value passed through unchanged
  await checkAsync('read() resolves with the exact array the adapter resolved with (same reference)', async () => {
    const sentinel = [{ 'رقم_القضية': '2026-1' }];
    const mock = makeMockAdapter({ read: () => Promise.resolve(sentinel) });
    const db = new DatabaseService(mock);
    const result = await db.read('cases');
    assert.strictEqual(result, sentinel);
  });

  await checkAsync('exists() resolves with the exact boolean the adapter resolved with', async () => {
    const mock = makeMockAdapter({ exists: () => Promise.resolve(true) });
    const db = new DatabaseService(mock);
    const result = await db.exists('cases');
    assert.strictEqual(result, true);
  });

  await checkAsync('write() resolves with undefined, matching adapter.write()\'s own Promise<void>', async () => {
    const mock = makeMockAdapter();
    const db = new DatabaseService(mock);
    const result = await db.write('cases', []);
    assert.strictEqual(result, undefined);
  });

  await checkAsync('open()/close()/destroy() each resolve with the adapter\'s own resolved value unchanged', async () => {
    const sentinel = { marker: 'lifecycle-sentinel' };
    const mock = makeMockAdapter({
      open: () => Promise.resolve(sentinel),
      close: () => Promise.resolve(sentinel),
      destroy: () => Promise.resolve(sentinel)
    });
    const db = new DatabaseService(mock);
    assert.strictEqual(await db.open(), sentinel);
    assert.strictEqual(await db.close(), sentinel);
    assert.strictEqual(await db.destroy(), sentinel);
  });

  // 5. Exceptions — rejections pass through unchanged, never swallowed
  await checkAsync('read() propagates a StorageError-shaped rejection unchanged (same object, not wrapped)', async () => {
    const storageErr = { type: 'StorageError', message: 'engine unreachable' };
    const mock = makeMockAdapter({ read: () => Promise.reject(storageErr) });
    const db = new DatabaseService(mock);
    let rejected = null;
    try { await db.read('cases'); } catch (e) { rejected = e; }
    assert.strictEqual(rejected, storageErr);
    assert.strictEqual(rejected.type, 'StorageError');
  });

  await checkAsync('write() propagates a ValidationError-shaped rejection unchanged', async () => {
    const validationErr = { type: 'ValidationError', message: 'records must be an Array' };
    const mock = makeMockAdapter({ write: () => Promise.reject(validationErr) });
    const db = new DatabaseService(mock);
    let rejected = null;
    try { await db.write('cases', {}); } catch (e) { rejected = e; }
    assert.strictEqual(rejected, validationErr);
    assert.strictEqual(rejected.type, 'ValidationError');
  });

  await checkAsync('delete() propagates a NotFoundError-shaped rejection unchanged', async () => {
    const notFoundErr = { type: 'NotFoundError', message: 'key not found' };
    const mock = makeMockAdapter({ delete: () => Promise.reject(notFoundErr) });
    const db = new DatabaseService(mock);
    let rejected = null;
    try { await db.delete('cases'); } catch (e) { rejected = e; }
    assert.strictEqual(rejected, notFoundErr);
    assert.strictEqual(rejected.type, 'NotFoundError');
  });

  await checkAsync('open() propagates a rejection unchanged, and the call is still recorded (exception not swallowed silently)', async () => {
    const err = { type: 'StorageError', message: 'open failed' };
    const mock = makeMockAdapter({ open: () => Promise.reject(err) });
    const db = new DatabaseService(mock);
    let rejected = null;
    try { await db.open(); } catch (e) { rejected = e; }
    assert.strictEqual(rejected, err);
    assert.strictEqual(mock._calls.open.length, 1);
  });

  await checkAsync('clear() propagates a rejection unchanged', async () => {
    const err = { type: 'StorageError', message: 'clear failed' };
    const mock = makeMockAdapter({ clear: () => Promise.reject(err) });
    const db = new DatabaseService(mock);
    let rejected = null;
    try { await db.clear(); } catch (e) { rejected = e; }
    assert.strictEqual(rejected, err);
  });

  await checkAsync('exists() rejection (non-standard, since the real contract says it should never reject) still passes through unchanged — DatabaseService never re-interprets adapter behavior', async () => {
    const err = { type: 'StorageError', message: 'unexpected exists failure' };
    const mock = makeMockAdapter({ exists: () => Promise.reject(err) });
    const db = new DatabaseService(mock);
    let rejected = null;
    try { await db.exists('cases'); } catch (e) { rejected = e; }
    assert.strictEqual(rejected, err);
  });

  // 6. Scope discipline — no business logic anywhere on DatabaseService
  check('DatabaseService defines no validate/filter/sort/search/cache/transaction/migrate/sync/getState/isReady methods', () => {
    const mock = makeMockAdapter();
    const db = new DatabaseService(mock);
    [
      'validate', 'filter', 'sort', 'search', 'cache',
      'beginTransaction', 'commit', 'rollback', 'transaction',
      'bulkRead', 'bulkWrite', 'bulkDelete',
      'getVersion', 'setVersion', 'migrate',
      'getState', 'isReady'
    ].forEach(m => {
      assert.strictEqual(typeof db[m], 'undefined', m + ' unexpectedly present');
    });
  });

  check('DatabaseService exposes exactly the 8 requested methods plus the constructor', () => {
    const mock = makeMockAdapter();
    const db = new DatabaseService(mock);
    const expected = ['open', 'close', 'destroy', 'read', 'write', 'delete', 'clear', 'exists'];
    expected.forEach(m => assert.strictEqual(typeof db[m], 'function', m + ' missing'));
    const ownPrototypeMethods = Object.getOwnPropertyNames(DatabaseService.prototype)
      .filter(k => k !== 'constructor');
    assert.deepStrictEqual(ownPrototypeMethods.sort(), expected.sort());
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
