/**
 * verify_indexeddb_engine.js
 * Standalone Node harness for the Phase 13.3A IndexedDB foundation
 * (IndexedDBErrors.js, IndexedDBSchema.js, IndexedDBVersion.js,
 * IndexedDBUtils.js, IndexedDBTransaction.js, IndexedDBEngine.js).
 * No browser required — uses fake_indexeddb.js, a minimal in-memory
 * IDBFactory-shaped test double (same self-contained-fake pattern
 * verify_localstorage_adapter.js already uses for `localStorage`).
 * Run: node js/tests/verify_indexeddb_engine.js
 */

const assert = require('assert');
const path = require('path');

const { FakeIndexedDB } = require(path.join(__dirname, 'fake_indexeddb.js'));
const ErrorsNS = require(path.join(__dirname, '..', 'core', 'IndexedDBErrors.js'));
const SchemaNS = require(path.join(__dirname, '..', 'core', 'IndexedDBSchema.js'));
const VersionNS = require(path.join(__dirname, '..', 'core', 'IndexedDBVersion.js'));
const UtilsNS = require(path.join(__dirname, '..', 'core', 'IndexedDBUtils.js'));
const { IndexedDBTransaction } = require(path.join(__dirname, '..', 'core', 'IndexedDBTransaction.js'));
const { IndexedDBEngine } = require(path.join(__dirname, '..', 'core', 'IndexedDBEngine.js'));

let passed = 0;
let failed = 0;
const log = [];

async function check(label, fn) {
  try {
    await fn();
    passed++;
    log.push('PASS — ' + label);
  } catch (e) {
    failed++;
    log.push('FAIL — ' + label + '  =>  ' + (e && e.stack ? e.stack : e));
  }
}

function newEngine(extra) {
  const fake = new FakeIndexedDB();
  const engine = new IndexedDBEngine(Object.assign({ indexedDBImpl: fake }, extra || {}));
  return { fake, engine };
}

(async function main() {

  // ---- 1. Schema sanity ----
  await check('Schema declares all 15 required stores', () => {
    // PHASE 31 (RBAC): +3 stores ('users', 'auditLog', 'loginLog'),
    // 12 -> 15. See IndexedDBSchema.js's own PHASE 31 comment.
    const expected = ['cases', 'clients', 'sessions', 'documents', 'tasks',
      'children', 'fees', 'library', 'templates', 'settings', 'metadata',
      'clientMessages', 'users', 'auditLog', 'loginLog'];
    const actual = SchemaNS.getStoreNames();
    expected.forEach(name => assert.ok(actual.indexOf(name) !== -1, 'missing store ' + name));
    assert.strictEqual(actual.length, expected.length);
  });

  await check('Every store keyPath matches that entity\'s real Repository idField (PHASE 13.3A-HOTFIX)', () => {
    // Ground truth: each entity's *_ID_FIELD constant as configured in its
    // live js/repositories/*Repository.js `idField:`. See
    // docs/IndexedDB_KeyPath_Audit.md for the full audit. `library`,
    // `templates`, `settings`, and `metadata` are the only stores that
    // genuinely use `id`.
    const expectedKeyPaths = {
      cases: 'رقم_القضية',
      clients: 'رقم_الموكل',
      sessions: 'رقم_الجلسة',
      documents: 'رقم_المستند',
      tasks: 'رقم_المهمة',
      children: 'رقم_الطفل',
      fees: 'رقم_العملية',
      library: 'id',
      templates: 'id',
      settings: 'id',
      metadata: 'id',
      clientMessages: 'id',
      // PHASE 31 (RBAC): 'users' keyPath matches UsersRepository's
      // idField (اسم_المستخدم); 'auditLog'/'loginLog' use 'id' — they
      // sit outside the Repository pattern entirely (AuditLog.js is
      // deliberately not a Repository — no update()/delete() — but
      // still shares this same schema/engine).
      users: 'اسم_المستخدم',
      auditLog: 'id',
      loginLog: 'id'
    };
    SchemaNS.STORE_DEFINITIONS.forEach(def => {
      assert.strictEqual(def.keyPath, expectedKeyPaths[def.name], def.name);
    });
  });

  await check('DB_NAME is "HossamLawOffice" and DB_VERSION is 3', () => {
    // PHASE 31 (RBAC): DB_VERSION bumped 2 -> 3.
    assert.strictEqual(SchemaNS.DB_NAME, 'HossamLawOffice');
    assert.strictEqual(SchemaNS.DB_VERSION, 3);
  });

  // ---- 2. Database opens correctly ----
  await check('Database opens and reports the expected version', async () => {
    const { engine } = newEngine();
    const db = await engine.open();
    assert.strictEqual(db.version, 3); // PHASE 31 (RBAC): DB_VERSION 2 -> 3.
    assert.strictEqual(engine.isOpen(), true);
    await engine.close();
  });

  // ---- 3. Stores + indexes created ----
  await check('All object stores are created on first open', async () => {
    const { engine } = newEngine();
    const db = await engine.open();
    SchemaNS.getStoreNames().forEach(name => {
      assert.ok(db.objectStoreNames.contains(name), 'missing store ' + name);
    });
    await engine.close();
  });

  await check('Indexes are created for each store', async () => {
    const { engine } = newEngine();
    await engine.open();
    const result = await engine.verifyIntegrity();
    assert.strictEqual(result.ok, true, JSON.stringify(result));
    assert.deepStrictEqual(result.missingStores, []);
    assert.deepStrictEqual(result.missingIndexes, []);
    await engine.close();
  });

  // ---- 4. Database closes correctly ----
  await check('Database closes and isOpen() reflects it', async () => {
    const { engine } = newEngine();
    await engine.open();
    assert.strictEqual(engine.isOpen(), true);
    await engine.close();
    assert.strictEqual(engine.isOpen(), false);
  });

  await check('close() is a no-op success when nothing is open', async () => {
    const { engine } = newEngine();
    await engine.close(); // never opened
  });

  // ---- 5. Version manager / upgrade path ----
  await check('applyUpgrade() reports appliedVersions and storesCreated', async () => {
    const { engine } = newEngine();
    await engine.open();
    const result = engine.getLastUpgradeResult();
    assert.deepStrictEqual(result.appliedVersions, [1, 2, 3]); // PHASE 31 (RBAC): version 3 added.
    assert.strictEqual(result.storesCreated.length, SchemaNS.getStoreNames().length);
    await engine.close();
  });

  await check('applyUpgrade() is idempotent for an already-current version (no-op)', async () => {
    const fake = new FakeIndexedDB();
    const engine1 = new IndexedDBEngine({ indexedDBImpl: fake });
    await engine1.open();
    await engine1.close();
    // Reopen at the same version against the same fake backing store —
    // should not re-run onupgradeneeded at all.
    const engine2 = new IndexedDBEngine({ indexedDBImpl: fake });
    const db2 = await engine2.open();
    assert.strictEqual(db2.version, 3); // PHASE 31 (RBAC): DB_VERSION 2 -> 3.
    assert.strictEqual(engine2.getLastUpgradeResult(), null, 'no upgrade should have run on reopen');
    await engine2.close();
  });

  await check('applyUpgrade() rejects a version below the highest known schema (VersionConflictError)', () => {
    assert.throws(() => {
      const fakeDb = { objectStoreNames: { contains: () => false } };
      VersionNS.applyUpgrade(fakeDb, {}, 0, 999);
    }, (err) => err instanceof ErrorsNS.VersionConflictError);
  });

  // ---- 6. Blocked state handled ----
  await check('open() rejects with BlockedError when blocked, and onBlocked() listener fires', async () => {
    const { fake, engine } = newEngine();
    fake._forceBlockOnOpen[SchemaNS.DB_NAME] = true;
    let listenerFired = false;
    engine.onBlocked(() => { listenerFired = true; });
    await assert.rejects(
      () => engine.open(),
      (err) => err instanceof ErrorsNS.BlockedError
    );
    assert.strictEqual(listenerFired, true);
  });

  await check('deleteDatabase() rejects with BlockedError while another connection is open', async () => {
    const fake = new FakeIndexedDB();
    const holder = new IndexedDBEngine({ indexedDBImpl: fake });
    await holder.open(); // holds an open connection, never closed

    const deleter = new IndexedDBEngine({ indexedDBImpl: fake });
    await assert.rejects(
      () => deleter.deleteDatabase(),
      (err) => err instanceof ErrorsNS.BlockedError
    );
    await holder.close();
  });

  // ---- 7. Error handling ----
  await check('fromDOMException classifies QuotaExceededError', () => {
    const err = ErrorsNS.fromDOMException({ name: 'QuotaExceededError', message: 'full' });
    assert.ok(err instanceof ErrorsNS.QuotaExceededError);
    assert.strictEqual(err.type, 'QuotaExceeded');
  });

  await check('fromDOMException classifies AbortError', () => {
    const err = ErrorsNS.fromDOMException({ name: 'AbortError' });
    assert.ok(err instanceof ErrorsNS.AbortError);
  });

  await check('fromDOMException classifies VersionError as VersionConflictError', () => {
    const err = ErrorsNS.fromDOMException({ name: 'VersionError' });
    assert.ok(err instanceof ErrorsNS.VersionConflictError);
  });

  await check('fromDOMException falls back to UnknownError for unrecognized names', () => {
    const err = ErrorsNS.fromDOMException({ name: 'SomethingWeirdError' });
    assert.ok(err instanceof ErrorsNS.UnknownError);
  });

  await check('fromDOMException never throws, even with null input', () => {
    const err = ErrorsNS.fromDOMException(null);
    assert.ok(err instanceof ErrorsNS.UnknownError);
  });

  // ---- 8. Browser (environment) compatibility ----
  await check('BrowserUnsupportedError thrown when no indexedDB is present', async () => {
    const engine = new IndexedDBEngine({ indexedDBImpl: null });
    await assert.rejects(
      () => engine.open(),
      (err) => err instanceof ErrorsNS.BrowserUnsupportedError
    );
  });

  await check('isBrowserSupported() correctly detects presence/absence', () => {
    assert.strictEqual(ErrorsNS.isBrowserSupported({ indexedDB: { open: () => {} } }), true);
    assert.strictEqual(ErrorsNS.isBrowserSupported({}), false);
    assert.strictEqual(ErrorsNS.isBrowserSupported(null), false);
  });

  // ---- 9. Database deletion ----
  await check('deleteDatabase() removes the database (a subsequent open re-triggers upgrade)', async () => {
    const fake = new FakeIndexedDB();
    const engine1 = new IndexedDBEngine({ indexedDBImpl: fake });
    await engine1.open();
    await engine1.deleteDatabase(); // closes + deletes

    const engine2 = new IndexedDBEngine({ indexedDBImpl: fake });
    await engine2.open();
    const result = engine2.getLastUpgradeResult();
    assert.deepStrictEqual(result.appliedVersions, [1, 2, 3], 'delete should force a fresh upgrade on next open'); // PHASE 31 (RBAC): version 3 added.
    await engine2.close();
  });

  // ---- 10. Repeated open()/close() ----
  await check('Repeated open() calls are idempotent (same connection, single upgrade)', async () => {
    const { engine } = newEngine();
    const db1 = await engine.open();
    const db2 = await engine.open();
    assert.strictEqual(db1, db2);
    await engine.close();
  });

  await check('open() after close() reopens successfully without re-upgrading', async () => {
    const fake = new FakeIndexedDB();
    const engine = new IndexedDBEngine({ indexedDBImpl: fake });
    await engine.open();
    const firstUpgradeResult = engine.getLastUpgradeResult();
    assert.deepStrictEqual(firstUpgradeResult.appliedVersions, [1, 2, 3]); // PHASE 31 (RBAC): version 3 added.
    await engine.close();

    const db2 = await engine.open();
    assert.strictEqual(db2.version, 3); // PHASE 31 (RBAC): DB_VERSION 2 -> 3.
    // No second upgrade ran, so the recorded result is unchanged from the
    // first (and only) upgrade — a fresh IndexedDBEngine on the same
    // backing store confirms this independently in the prior test.
    assert.strictEqual(engine.getLastUpgradeResult(), firstUpgradeResult);
    await engine.close();
  });

  // ---- 11. Transaction helper (built, not yet connected — testable standalone) ----
  await check('IndexedDBTransaction.run() commits and resolves with callback result', async () => {
    const { engine } = newEngine();
    const db = await engine.open();
    const tx = new IndexedDBTransaction(db, ['cases'], 'readwrite');
    const result = await tx.run((t) => {
      const store = t.objectStore('cases');
      store.put({ 'رقم_القضية': 'c1', code: 'A1' });
      return 'done';
    });
    assert.strictEqual(result, 'done');
    assert.strictEqual(tx.getState(), 'committed');
    await engine.close();
  });

  await check('IndexedDBTransaction.run() rejects and aborts on synchronous callback throw', async () => {
    const { engine } = newEngine();
    const db = await engine.open();
    const tx = new IndexedDBTransaction(db, ['cases'], 'readwrite');
    await assert.rejects(() => tx.run(() => { throw new Error('boom'); }));
    assert.strictEqual(tx.getState(), 'aborted');
    await engine.close();
  });

  await check('IndexedDBTransaction spans multiple stores', async () => {
    const { engine } = newEngine();
    const db = await engine.open();
    const tx = new IndexedDBTransaction(db, ['cases', 'clients'], 'readwrite');
    const result = await tx.run((t) => {
      t.objectStore('cases').put({ 'رقم_القضية': 'c1' });
      t.objectStore('clients').put({ 'رقم_الموكل': 'cl1' });
      return true;
    });
    assert.strictEqual(result, true);
    await engine.close();
  });

  // ---- 12. Integrity validation ----
  await check('verifyIntegrity() reports connectionOpen=false before any open()', async () => {
    const { engine } = newEngine();
    const result = await engine.verifyIntegrity();
    assert.strictEqual(result.connectionOpen, false);
    assert.strictEqual(result.ok, false);
  });

  // ---- 13. withTimeout / promisifyRequest utils ----
  await check('withTimeout resolves normally when the promise settles first', async () => {
    const value = await UtilsNS.withTimeout(Promise.resolve(42), 1000);
    assert.strictEqual(value, 42);
  });

  await check('withTimeout rejects with TimeoutError when the promise never settles', async () => {
    const neverSettles = new Promise(() => {});
    await assert.rejects(
      () => UtilsNS.withTimeout(neverSettles, 20),
      (err) => err instanceof ErrorsNS.TimeoutError
    );
  });

  // ---- 14. STRESS TEST: repeated open/close/delete cycles ----
  await check('Stress test: 1000 open()/close() cycles — no leaks, no exceptions, consistent state', async () => {
    const fake = new FakeIndexedDB();
    const engine = new IndexedDBEngine({ indexedDBImpl: fake });
    for (let i = 0; i < 1000; i++) {
      const db = await engine.open();
      // PHASE 31 (RBAC): schema DB_VERSION bumped 2 -> 3 (adds the
      // 'users'/'auditLog'/'loginLog' stores — see IndexedDBSchema.js).
      assert.strictEqual(db.version, 3);
      assert.strictEqual(engine.isOpen(), true);
      await engine.close();
      assert.strictEqual(engine.isOpen(), false);
    }
    // Exactly one upgrade should ever have run across all 1000 cycles.
    const fresh = new IndexedDBEngine({ indexedDBImpl: fake });
    await fresh.open();
    assert.strictEqual(fresh.getLastUpgradeResult(), null, 'schema should already be current after 1000 cycles');
    await fresh.close();
  });

  await check('Stress test: 200 open()/delete()/open() cycles — clean re-creation each time', async () => {
    const fake = new FakeIndexedDB();
    for (let i = 0; i < 200; i++) {
      const engine = new IndexedDBEngine({ indexedDBImpl: fake });
      await engine.open();
      await engine.deleteDatabase();
    }
    // Final state: database absent until the next open recreates it.
    const finalEngine = new IndexedDBEngine({ indexedDBImpl: fake });
    const db = await finalEngine.open();
    // PHASE 31 (RBAC): schema DB_VERSION bumped 2 -> 3.
    assert.strictEqual(db.version, 3);
    assert.deepStrictEqual(finalEngine.getLastUpgradeResult().appliedVersions, [1, 2, 3]);
    await finalEngine.close();
  });

  // ---- Summary ----
  console.log(log.join('\n'));
  console.log('\n' + passed + ' passed, ' + failed + ' failed.');
  if (failed > 0) {
    process.exitCode = 1;
  }
})();
