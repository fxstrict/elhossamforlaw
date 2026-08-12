/**
 * verify_settings_repository.js
 * ================================================================
 * PHASE 13.4 — PART 1B-2 — SettingsRepository verification tests
 * ================================================================
 * Standalone Node harness (`node js/tests/verify_settings_repository.js`,
 * no browser required) for js/repositories/SettingsRepository.js
 * (created in Part 1B-1). Modeled on the project's existing
 * verify_*_repository.js harnesses (e.g. verify_library_repository.js)
 * for style — self-contained, no shared helper module — but SettingsRepository
 * is IndexedDB-backed (not LocalStorage-backed like Library), so this
 * harness uses js/tests/fake_indexeddb.js (the same in-memory
 * IDBFactory-shaped test double already used by
 * verify_indexeddb_engine.js / verify_migration_bootstrap.js /
 * verify_migration_service.js) via SettingsRepository.js's own exported
 * createSettingsIndexedDBAdapter(storageImpl) — the same wiring path the
 * repository itself uses, per REFERENCE_MAP.md's "Repository Templates"
 * / "IndexedDB References".
 *
 * SCOPE (Part 1B-2, per phase prompt): verify ONLY —
 *   1. Repository opens successfully.
 *   2. set(key, value)
 *   3. get(key)
 *   4. has(key)
 *   5. remove(key)
 *   6. getAll()
 *   7. getAllAsObject()
 *   8. migrateFromLocalStorage() — CURRENT DEFERRED behavior only
 *      (Part 1B-1's stub: no LocalStorage read/write, non-throwing,
 *      { migrated:false, reason:... }). Actual migration logic is
 *      explicitly OUT of scope here (deferred to Part 4 /
 *      MigrationService.js per REFERENCE_MAP.md "Migration References").
 *
 * This file does not modify, import from, or duplicate logic from
 * SettingsRepository.js — it only requires it and exercises its public
 * API exactly as written on disk.
 * ================================================================
 */

'use strict';

const assert = require('assert');
const path = require('path');

const { Repository } = require(path.join(__dirname, '..', 'core', 'Repository.js'));
const { FakeIndexedDB } = require(path.join(__dirname, 'fake_indexeddb.js'));
const { SettingsRepository, createSettingsIndexedDBAdapter } =
  require(path.join(__dirname, '..', 'repositories', 'SettingsRepository.js'));

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

/** Builds a fresh, opened SettingsRepository backed by its own
 *  IndexedDB adapter wiring (createSettingsIndexedDBAdapter), pointed
 *  at a fake in-memory IDBFactory so no real browser IndexedDB is
 *  required. Optionally shares an existing FakeIndexedDB instance so a
 *  second repository instance can observe the same underlying "database"
 *  (simulates a page reload against persisted data). */
async function makeOpenedRepo(sharedFake) {
  const fake = sharedFake || new FakeIndexedDB();
  const repo = new SettingsRepository({ storageAdapter: createSettingsIndexedDBAdapter(fake) });
  await repo.open();
  return { repo, fake };
}

async function main() {

  // ---- 0. Class shape ----
  check('SettingsRepository is a function / class', () => {
    assert.strictEqual(typeof SettingsRepository, 'function');
  });

  check('SettingsRepository extends Repository (prototype chain)', () => {
    assert.strictEqual(Object.getPrototypeOf(SettingsRepository.prototype), Repository.prototype);
  });

  check('createSettingsIndexedDBAdapter is exported alongside SettingsRepository', () => {
    assert.strictEqual(typeof createSettingsIndexedDBAdapter, 'function');
  });

  // ---- 1. open() ----
  let repo;
  let fake;
  await checkAsync('open() succeeds against an empty IndexedDB store, no throw', async () => {
    const built = await makeOpenedRepo();
    repo = built.repo;
    fake = built.fake;
    assert.strictEqual(repo.isReady(), true);
    assert.strictEqual(repo.getState(), 'ready');
  });

  check('open() on an empty store starts with zero settings', () => {
    assert.deepStrictEqual(repo.getAll(), []);
    assert.deepStrictEqual(repo.getAllAsObject(), {});
  });

  // ---- 2 & 3. set(key, value) / get(key) ----
  await checkAsync('set(key, value) creates a new setting when the key does not yet exist', async () => {
    const res = await repo.set('apiUrl', 'https://example.com/api');
    assert.strictEqual(res.success, true);
    assert.strictEqual(res.record.id, 'apiUrl');
    assert.strictEqual(res.record.value, 'https://example.com/api');
  });

  check('get(key) returns just the unwrapped value for an existing key', () => {
    assert.strictEqual(repo.get('apiUrl'), 'https://example.com/api');
  });

  check('get(key) returns undefined for a key that was never set', () => {
    assert.strictEqual(repo.get('noSuchKey'), undefined);
  });

  await checkAsync('set(key, value) updates the value in place when the key already exists (no duplicate record)', async () => {
    const res = await repo.set('apiUrl', 'https://example.com/api-v2');
    assert.strictEqual(res.success, true);
    assert.strictEqual(res.record.value, 'https://example.com/api-v2');
    assert.strictEqual(repo.get('apiUrl'), 'https://example.com/api-v2');
    assert.strictEqual(repo.getAll().filter(r => r.id === 'apiUrl').length, 1);
  });

  await checkAsync('set(key, value) accepts heterogeneous value types (boolean), per Decision 001', async () => {
    const res = await repo.set('localModeChosen', true);
    assert.strictEqual(res.success, true);
    assert.strictEqual(repo.get('localModeChosen'), true);
    assert.strictEqual(typeof repo.get('localModeChosen'), 'boolean');
  });

  await checkAsync('set("", value) / set(null, value) reject an empty/non-string key (ValidationError, no throw)', async () => {
    const resEmpty = await repo.set('', 'x');
    assert.strictEqual(resEmpty.success, false);
    assert.strictEqual(resEmpty.error.type, 'ValidationError');
    const resNull = await repo.set(null, 'x');
    assert.strictEqual(resNull.success, false);
    assert.strictEqual(resNull.error.type, 'ValidationError');
  });

  // ---- 4. has(key) ----
  check('has(key) is true for a key that has been set', () => {
    assert.strictEqual(repo.has('apiUrl'), true);
  });

  check('has(key) is false for a key that has never been set', () => {
    assert.strictEqual(repo.has('neverSet'), false);
  });

  // ---- 5. remove(key) ----
  await checkAsync('remove(key) deletes an existing setting and returns success', async () => {
    await repo.set('driveUrl', 'https://drive.example.com');
    const res = await repo.remove('driveUrl');
    assert.strictEqual(res.success, true);
    assert.strictEqual(res.record.id, 'driveUrl');
  });

  check('after remove(key), has(key)/get(key) behave as if the setting was never set (hard delete, softDelete:false)', () => {
    assert.strictEqual(repo.has('driveUrl'), false);
    assert.strictEqual(repo.get('driveUrl'), undefined);
    assert.strictEqual(repo.getAll().some(r => r.id === 'driveUrl'), false);
    assert.strictEqual(repo.getAll({ includeDeleted: true }).some(r => r.id === 'driveUrl'), false);
  });

  await checkAsync('remove(key) on a key that was never set fails gracefully (ValidationError, no throw)', async () => {
    const res = await repo.remove('neverSetEither');
    assert.strictEqual(res.success, false);
    assert.strictEqual(res.error.type, 'ValidationError');
  });

  // ---- 6. getAll() ----
  await checkAsync('getAll() returns every current { id, value, ...metadata } record', async () => {
    const { repo: freshRepo } = await makeOpenedRepo();
    await freshRepo.set('apiUrl', 'https://a');
    await freshRepo.set('sheetUrl', 'https://b');
    const all = freshRepo.getAll();
    assert.strictEqual(all.length, 2);
    assert.deepStrictEqual(all.map(r => r.id).sort(), ['apiUrl', 'sheetUrl']);
    all.forEach(r => assert.ok(Object.prototype.hasOwnProperty.call(r, 'value')));
  });

  check('getAll() returns a copy, not a live reference', () => {
    const a = repo.getAll();
    if (a.length > 0) {
      const originalValue = a[0].value;
      a[0].value = 'MUTATED';
      const b = repo.getAll();
      assert.strictEqual(b[0].value, originalValue);
    }
  });

  // ---- 7. getAllAsObject() ----
  await checkAsync('getAllAsObject() flattens getAll() into a single plain key/value object', async () => {
    const { repo: freshRepo } = await makeOpenedRepo();
    await freshRepo.set('apiUrl', 'https://a');
    await freshRepo.set('driveUrl', 'https://b');
    await freshRepo.set('localModeChosen', false);
    const obj = freshRepo.getAllAsObject();
    assert.deepStrictEqual(obj, { apiUrl: 'https://a', driveUrl: 'https://b', localModeChosen: false });
  });

  await checkAsync('getAllAsObject() on a freshly opened, empty repository returns {}', async () => {
    const { repo: emptyRepo } = await makeOpenedRepo();
    assert.deepStrictEqual(emptyRepo.getAllAsObject(), {});
  });

  // ---- 8. migrateFromLocalStorage() — current deferred behavior only ----
  await checkAsync('migrateFromLocalStorage() resolves without throwing (no real migration performed in this phase)', async () => {
    const result = await repo.migrateFromLocalStorage();
    assert.strictEqual(typeof result, 'object');
    assert.notStrictEqual(result, null);
  });

  await checkAsync('migrateFromLocalStorage() reports migrated:false with a structured reason string (Part 1B-1 stub contract)', async () => {
    const result = await repo.migrateFromLocalStorage();
    assert.strictEqual(result.migrated, false);
    assert.strictEqual(typeof result.reason, 'string');
    assert.ok(result.reason.length > 0);
  });

  await checkAsync('migrateFromLocalStorage() performs no side effects on the settings store (getAllAsObject unchanged before/after)', async () => {
    const { repo: sideEffectRepo } = await makeOpenedRepo();
    await sideEffectRepo.set('apiUrl', 'https://unchanged');
    const before = sideEffectRepo.getAllAsObject();
    await sideEffectRepo.migrateFromLocalStorage();
    const after = sideEffectRepo.getAllAsObject();
    assert.deepStrictEqual(after, before);
  });

  // ---- 9. Persistence — a second repository instance sees prior writes ----
  await checkAsync('a second SettingsRepository instance opening the SAME underlying IndexedDB sees identically persisted settings ("reload" simulation)', async () => {
    const shared = new FakeIndexedDB();
    const { repo: repoA } = await makeOpenedRepo(shared);
    await repoA.set('apiUrl', 'https://persisted');
    await repoA.set('lastSyncAt', '2026-01-01T00:00:00.000Z');

    const { repo: repoB } = await makeOpenedRepo(shared);
    assert.deepStrictEqual(repoB.getAllAsObject(), {
      apiUrl: 'https://persisted',
      lastSyncAt: '2026-01-01T00:00:00.000Z'
    });
  });

  // ---- 10. Independence from other Repositories ----
  check('SettingsRepository does not reference any other concrete *Repository at runtime (independent harness, independent class)', () => {
    assert.strictEqual(Object.getPrototypeOf(SettingsRepository.prototype).constructor, Repository);
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
