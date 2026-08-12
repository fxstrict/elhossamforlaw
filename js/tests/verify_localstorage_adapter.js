/**
 * verify_localstorage_adapter.js
 * Standalone Node harness for LocalStorageAdapter (Phase 8 / Sub-phase
 * 8.3.2). Self-contained — no shared helper module, matching the existing
 * `verify_*_repository.js` harnesses' pattern.
 * Run: node js/tests/verify_localstorage_adapter.js
 * No browser required — uses a fake in-memory object satisfying the full
 * Storage shape (getItem/setItem/removeItem/key/length) the real browser
 * `localStorage` exposes, injected via `config.storageImpl`.
 */

const assert = require('assert');
const path = require('path');

const { StorageAdapter, NotImplementedError } =
  require(path.join(__dirname, '..', 'core', 'StorageAdapter.js'));
const { LocalStorageAdapter, StorageError, ValidationError } =
  require(path.join(__dirname, '..', 'core', 'LocalStorageAdapter.js'));
const { Repository } = require(path.join(__dirname, '..', 'core', 'Repository.js'));

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

// ---- Fake localStorage (matches the real Storage interface used by
// getItem/setItem/removeItem/key/length, plus a `_dump()` convenience for
// direct inspection — same shape verify_fees_repository.js already uses,
// extended with removeItem/key/length for clear()/exists()/delete()). ----
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

async function main() {

  // 1. Class existence and inheritance
  check('LocalStorageAdapter is a function / class', () => {
    assert.strictEqual(typeof LocalStorageAdapter, 'function');
  });

  check('LocalStorageAdapter extends StorageAdapter (prototype chain)', () => {
    const fake = makeFakeStorage({});
    const adapter = new LocalStorageAdapter({ storageImpl: fake });
    assert.ok(adapter instanceof StorageAdapter);
    assert.ok(adapter instanceof LocalStorageAdapter);
  });

  check('LocalStorageAdapter exposes all 8 required methods', () => {
    const fake = makeFakeStorage({});
    const adapter = new LocalStorageAdapter({ storageImpl: fake });
    ['open', 'close', 'destroy', 'read', 'write', 'delete', 'clear', 'exists'].forEach(m => {
      assert.strictEqual(typeof adapter[m], 'function', m + ' missing');
    });
  });

  check('A bare (un-subclassed) StorageAdapter instance still throws NotImplementedError (base class untouched)', () => {
    const base = new StorageAdapter();
    assert.throws(() => base.read('cases'), NotImplementedError);
  });

  // 2. Lifecycle: open / close / destroy
  await checkAsync('open() resolves successfully against a valid injected engine', async () => {
    const fake = makeFakeStorage({});
    const adapter = new LocalStorageAdapter({ storageImpl: fake });
    await adapter.open();
  });

  await checkAsync('open() is idempotent (second call is a no-op success)', async () => {
    const fake = makeFakeStorage({});
    const adapter = new LocalStorageAdapter({ storageImpl: fake });
    await adapter.open();
    await adapter.open();
  });

  await checkAsync('open() rejects with StorageError when no engine is available at all', async () => {
    const adapter = new LocalStorageAdapter({ storageImpl: null });
    // Force resolveEngine() to find nothing: no global localStorage exists
    // in this plain Node process, and no override was given.
    let rejected = null;
    try { await adapter.open(); } catch (e) { rejected = e; }
    assert.ok(rejected, 'expected open() to reject');
    assert.strictEqual(rejected.type, 'StorageError');
  });

  await checkAsync('close() resolves successfully even if never opened (no-op, matches StorageAdapter.js contract)', async () => {
    const fake = makeFakeStorage({});
    const adapter = new LocalStorageAdapter({ storageImpl: fake });
    await adapter.close();
  });

  await checkAsync('destroy() resolves successfully and does not delete underlying data', async () => {
    const fake = makeFakeStorage({ cases: '[{"a":1}]' });
    const adapter = new LocalStorageAdapter({ storageImpl: fake });
    await adapter.open();
    await adapter.destroy();
    assert.strictEqual(fake.getItem('cases'), '[{"a":1}]');
  });

  // 3. read()
  await checkAsync('read() on a never-written key resolves [] (matches index.html\'s ||"[]" bootstrap)', async () => {
    const fake = makeFakeStorage({});
    const adapter = new LocalStorageAdapter({ storageImpl: fake });
    await adapter.open();
    const result = await adapter.read('cases');
    assert.deepStrictEqual(result, []);
  });

  await checkAsync('read() parses and returns an existing JSON array unchanged', async () => {
    const seed = { clients: JSON.stringify([{ id: '1', name: 'محمد' }]) };
    const fake = makeFakeStorage(seed);
    const adapter = new LocalStorageAdapter({ storageImpl: fake });
    await adapter.open();
    const result = await adapter.read('clients');
    assert.deepStrictEqual(result, [{ id: '1', name: 'محمد' }]);
  });

  await checkAsync('read() rejects with StorageError on corrupt (unparseable) JSON', async () => {
    const fake = makeFakeStorage({ broken: '{not-json' });
    const adapter = new LocalStorageAdapter({ storageImpl: fake });
    await adapter.open();
    let rejected = null;
    try { await adapter.read('broken'); } catch (e) { rejected = e; }
    assert.ok(rejected);
    assert.strictEqual(rejected.type, 'StorageError');
  });

  await checkAsync('read() rejects with ValidationError for a non-string entityKey', async () => {
    const fake = makeFakeStorage({});
    const adapter = new LocalStorageAdapter({ storageImpl: fake });
    await adapter.open();
    let rejected = null;
    try { await adapter.read(123); } catch (e) { rejected = e; }
    assert.ok(rejected);
    assert.strictEqual(rejected.type, 'ValidationError');
  });

  // 4. write()
  await checkAsync('write() stores a plain JSON array parseable exactly like index.html expects', async () => {
    const fake = makeFakeStorage({});
    const adapter = new LocalStorageAdapter({ storageImpl: fake });
    await adapter.open();
    await adapter.write('tasks', [{ id: 'x' }]);
    const raw = fake.getItem('tasks');
    assert.strictEqual(JSON.parse(raw)[0].id, 'x');
  });

  await checkAsync('write() round-trips through read() unchanged', async () => {
    const fake = makeFakeStorage({});
    const adapter = new LocalStorageAdapter({ storageImpl: fake });
    await adapter.open();
    const records = [{ 'رقم_القضية': '2026-1' }, { 'رقم_القضية': '2026-2' }];
    await adapter.write('cases', records);
    const readBack = await adapter.read('cases');
    assert.deepStrictEqual(readBack, records);
  });

  await checkAsync('write() rejects with ValidationError when records is not an Array', async () => {
    const fake = makeFakeStorage({});
    const adapter = new LocalStorageAdapter({ storageImpl: fake });
    await adapter.open();
    let rejected = null;
    try { await adapter.write('cases', { not: 'an array' }); } catch (e) { rejected = e; }
    assert.ok(rejected);
    assert.strictEqual(rejected.type, 'ValidationError');
  });

  await checkAsync('write() rejects with ValidationError when records contains a circular reference (unserializable)', async () => {
    const fake = makeFakeStorage({});
    const adapter = new LocalStorageAdapter({ storageImpl: fake });
    await adapter.open();
    const circular = {};
    circular.self = circular;
    let rejected = null;
    try { await adapter.write('cases', [circular]); } catch (e) { rejected = e; }
    assert.ok(rejected);
    assert.strictEqual(rejected.type, 'ValidationError');
  });

  await checkAsync('write() rejects with StorageError when the engine setItem() throws (e.g. quota exceeded)', async () => {
    const fake = makeFakeStorage({});
    fake.setItem = () => { throw new Error('QuotaExceededError'); };
    const adapter = new LocalStorageAdapter({ storageImpl: fake });
    await adapter.open();
    let rejected = null;
    try { await adapter.write('cases', []); } catch (e) { rejected = e; }
    assert.ok(rejected);
    assert.strictEqual(rejected.type, 'StorageError');
  });

  // 5. delete()
  await checkAsync('delete() removes an existing entity key entirely', async () => {
    const fake = makeFakeStorage({ cases: '[{"a":1}]' });
    const adapter = new LocalStorageAdapter({ storageImpl: fake });
    await adapter.open();
    await adapter.delete('cases');
    assert.strictEqual(fake.getItem('cases'), null);
  });

  await checkAsync('delete() on a non-existent key resolves successfully (not an error, per StorageAdapter.js contract)', async () => {
    const fake = makeFakeStorage({});
    const adapter = new LocalStorageAdapter({ storageImpl: fake });
    await adapter.open();
    await adapter.delete('never-existed');
  });

  // 6. exists()
  await checkAsync('exists() resolves true for a key that was written', async () => {
    const fake = makeFakeStorage({ cases: '[]' });
    const adapter = new LocalStorageAdapter({ storageImpl: fake });
    await adapter.open();
    assert.strictEqual(await adapter.exists('cases'), true);
  });

  await checkAsync('exists() resolves false for a key that was never written', async () => {
    const fake = makeFakeStorage({});
    const adapter = new LocalStorageAdapter({ storageImpl: fake });
    await adapter.open();
    assert.strictEqual(await adapter.exists('nope'), false);
  });

  await checkAsync('exists() never rejects, even for a malformed entityKey (advisory per contract)', async () => {
    const fake = makeFakeStorage({});
    const adapter = new LocalStorageAdapter({ storageImpl: fake });
    await adapter.open();
    const result = await adapter.exists(null);
    assert.strictEqual(result, false);
  });

  // 7. clear()
  await checkAsync('clear() removes every entity this adapter manages (default empty prefix = whole engine)', async () => {
    const fake = makeFakeStorage({ cases: '[]', clients: '[]', sessions: '[]' });
    const adapter = new LocalStorageAdapter({ storageImpl: fake });
    await adapter.open();
    await adapter.clear();
    assert.strictEqual(fake.getItem('cases'), null);
    assert.strictEqual(fake.getItem('clients'), null);
    assert.strictEqual(fake.getItem('sessions'), null);
  });

  await checkAsync('clear() with a configured keyPrefix only removes matching keys', async () => {
    const fake = makeFakeStorage({ 'v10:cases': '[]', 'unrelated': '[1]' });
    const adapter = new LocalStorageAdapter({ storageImpl: fake, keyPrefix: 'v10:' });
    await adapter.open();
    await adapter.clear();
    assert.strictEqual(fake.getItem('v10:cases'), null);
    assert.strictEqual(fake.getItem('unrelated'), '[1]');
  });

  // 8. Compatibility with Repository.js — minimal Repository instance
  await checkAsync('A minimal Repository opens successfully against LocalStorageAdapter with pre-existing legacy data', async () => {
    const fake = makeFakeStorage({
      cases: JSON.stringify([{ 'رقم_القضية': '2026-100', 'اسم_الموكل': 'محمد أحمد' }])
    });
    const adapter = new LocalStorageAdapter({ storageImpl: fake });
    const repo = new Repository({
      entityKey: 'cases',
      storageAdapter: adapter,
      idField: 'رقم_القضية'
    });
    await repo.open();
    assert.strictEqual(repo.isReady(), true);
    const all = repo.getAll();
    assert.strictEqual(all.length, 1);
    assert.strictEqual(all[0]['اسم_الموكل'], 'محمد أحمد');
  });

  await checkAsync('Repository create()/persist() writes back through LocalStorageAdapter, byte-for-byte JSON-array compatible', async () => {
    const fake = makeFakeStorage({});
    const adapter = new LocalStorageAdapter({ storageImpl: fake });
    const repo = new Repository({
      entityKey: 'clients',
      storageAdapter: adapter,
      idField: null,
      idGenerator: () => 'generated-id-1'
    });
    await repo.open();
    const res = await repo.create({ 'اسم': 'سارة' });
    assert.strictEqual(res.success, true);
    const raw = fake.getItem('clients');
    const parsed = JSON.parse(raw);
    assert.ok(Array.isArray(parsed));
    assert.strictEqual(parsed[0]['اسم'], 'سارة');
  });

  await checkAsync('A second Repository instance opening the same LocalStorageAdapter-backed storage sees identical data (no data loss across "reload")', async () => {
    const fake = makeFakeStorage({});
    const adapterA = new LocalStorageAdapter({ storageImpl: fake });
    const repoA = new Repository({
      entityKey: 'tasks', storageAdapter: adapterA, idField: null,
      idGenerator: () => 't-1'
    });
    await repoA.open();
    await repoA.create({ 'العنوان': 'مهمة 1' });

    const adapterB = new LocalStorageAdapter({ storageImpl: fake });
    const repoB = new Repository({
      entityKey: 'tasks', storageAdapter: adapterB, idField: null,
      idGenerator: () => 't-2'
    });
    await repoB.open();
    assert.strictEqual(repoB.getAll().length, 1);
    assert.strictEqual(repoB.getAll()[0]['العنوان'], 'مهمة 1');
  });

  check('Repository.assertStorageAdapter() accepts a LocalStorageAdapter instance without modification to Repository.js', () => {
    const fake = makeFakeStorage({});
    const adapter = new LocalStorageAdapter({ storageImpl: fake });
    // Constructing a Repository already runs assertStorageAdapter()
    // internally — if this throws, the check() wrapper reports FAIL.
    new Repository({ entityKey: 'sessions', storageAdapter: adapter, idField: null, idGenerator: () => 's-1' });
  });

  // 9. Scope discipline — the adapter must not do anything beyond storage
  check('LocalStorageAdapter defines no validate/filter/sort/search/cache/migrate/sync methods', () => {
    const fake = makeFakeStorage({});
    const adapter = new LocalStorageAdapter({ storageImpl: fake });
    ['validate', 'filter', 'sort', 'search', 'cache', 'migrate', 'synchronize', 'generateId'].forEach(m => {
      assert.strictEqual(typeof adapter[m], 'undefined', m + ' unexpectedly present');
    });
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
