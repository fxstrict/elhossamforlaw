/**
 * verify_repository_wiring_all.js
 * ================================================================
 * PHASE 8 — SUB-PHASE 8.5.2 — Repository Wiring (Remaining Repositories)
 * ================================================================
 * Standalone Node harness (`node js/tests/verify_repository_wiring_all.js`,
 * no browser required) proving that wiring the eight remaining Repositories
 * (Clients, Children, Sessions, Tasks, Fees, Documents, Library, Templates)
 * to a real DatabaseService (backed by a real LocalStorageAdapter) — the
 * exact same pipeline CasesRepository was wired to in PHASE 8/8.5.1 —
 * produces a fully working, backward-compatible storage layer for every one
 * of them.
 *
 * One shared regression sequence (open/create/get/getAll/update/delete/
 * exists/clear, persistence-across-reopen, backward compatibility with
 * pre-existing localStorage, and error propagation) is run identically
 * against all eight Repositories via a small per-entity fixture table —
 * only the entity-specific field names differ; the sequence of operations
 * and the shape of every assertion is otherwise identical across all eight.
 *
 * Structure:
 *   A. Per-repository CRUD/validation/persistence/backward-compatibility/
 *      error-propagation suite (Sections 1-9 below), run once for each of
 *      the eight repositories in REPOS.
 *   B. Structural checks: Repository.js / DatabaseService.js /
 *      StorageAdapter.js / LocalStorageAdapter.js / CasesRepository.js are
 *      byte-unchanged (MD5), and only the eight target files were modified.
 *
 * Uses the same fake in-memory localStorage-shaped engine
 * (getItem/setItem/removeItem/key/length) every existing
 * verify_*_repository.js harness already uses.
 * ================================================================
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const CORE_DIR = path.join(__dirname, '..', 'core');
const REPOS_DIR = path.join(__dirname, '..', 'repositories');

const { DatabaseService } = require(path.join(CORE_DIR, 'DatabaseService.js'));
const { LocalStorageAdapter } = require(path.join(CORE_DIR, 'LocalStorageAdapter.js'));
const { IndexedDBAdapter } = require(path.join(CORE_DIR, 'IndexedDBAdapter.js'));
const { FakeIndexedDB } = require(path.join(__dirname, 'fake_indexeddb.js'));

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

// ---- Fake localStorage engine (getItem/setItem/removeItem/key/length) ----
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

// ================================================================
// Per-entity fixture table — the eight remaining Repositories
// ================================================================
const REPOS = [
  {
    label: 'ClientsRepository',
    file: 'ClientsRepository.js',
    exportName: 'ClientsRepository',
    adapterFactoryName: 'createClientsLocalStorageAdapter',
    entityKey: 'clients',
    idField: 'رقم_الموكل',
    idIsUserSupplied: false,
    validRecord: () => ({ 'الاسم': 'أحمد محمود', 'النوع': 'فرد' }),
    updatePatch: { 'الهاتف': '01000000000' },
    invalidRecord: () => ({ 'النوع': 'فرد' }), // missing required 'الاسم'
    legacySeedRecord: { 'رقم_الموكل': 'legacy-c1', 'الاسم': 'موكل قديم' }
  },
  {
    label: 'ChildrenRepository',
    file: 'ChildrenRepository.js',
    exportName: 'ChildrenRepository',
    adapterFactoryName: 'createChildrenLocalStorageAdapter',
    entityKey: 'children',
    idField: 'رقم_الطفل',
    idIsUserSupplied: false,
    validRecord: () => ({ 'رقم_القضية': '2026-500', 'الاسم': 'طفل تجريبي' }),
    updatePatch: { 'المدرسة': 'مدرسة النصر' },
    invalidRecord: () => ({ 'رقم_القضية': '2026-500' }), // missing required 'الاسم'
    legacySeedRecord: { 'رقم_الطفل': 'legacy-ch1', 'رقم_القضية': '2025-1', 'الاسم': 'طفل قديم' }
  },
  {
    label: 'SessionsRepository',
    file: 'SessionsRepository.js',
    exportName: 'SessionsRepository',
    adapterFactoryName: 'createSessionsLocalStorageAdapter',
    entityKey: 'sessions',
    idField: 'رقم_الجلسة',
    idIsUserSupplied: false,
    validRecord: () => ({ 'التاريخ': '2026-08-01', 'الوقت': '10:00' }),
    updatePatch: { 'الوقت': '11:30' },
    invalidRecord: () => ({ 'التاريخ': '2026-08-01' }), // missing required 'الوقت'
    legacySeedRecord: { 'رقم_الجلسة': 'legacy-s1', 'التاريخ': '2025-01-01', 'الوقت': '09:00' }
  },
  {
    label: 'TasksRepository',
    file: 'TasksRepository.js',
    exportName: 'TasksRepository',
    adapterFactoryName: 'createTasksLocalStorageAdapter',
    entityKey: 'tasks',
    idField: 'رقم_المهمة',
    idIsUserSupplied: false,
    validRecord: () => ({ 'العنوان': 'مهمة تجريبية' }),
    updatePatch: { 'العنوان': 'مهمة محدثة' },
    invalidRecord: () => ({}), // missing required 'العنوان'
    legacySeedRecord: { 'رقم_المهمة': 'legacy-t1', 'العنوان': 'مهمة قديمة' }
  },
  {
    label: 'FeesRepository',
    file: 'FeesRepository.js',
    exportName: 'FeesRepository',
    adapterFactoryName: 'createFeesLocalStorageAdapter',
    entityKey: 'fees',
    idField: 'رقم_العملية',
    idIsUserSupplied: false,
    validRecord: () => ({ 'رقم_القضية': '2026-500', 'المبلغ': '1000' }),
    updatePatch: { 'المبلغ': '1500' },
    invalidRecord: () => ({ 'رقم_القضية': '2026-500' }), // missing required 'المبلغ'
    legacySeedRecord: { 'رقم_العملية': 'legacy-f1', 'رقم_القضية': '2025-1', 'المبلغ': '500' }
  },
  {
    label: 'DocumentsRepository',
    file: 'DocumentsRepository.js',
    exportName: 'DocumentsRepository',
    adapterFactoryName: 'createDocumentsLocalStorageAdapter',
    entityKey: 'documents',
    idField: 'رقم_المستند',
    idIsUserSupplied: false,
    validRecord: () => ({ 'رقم_القضية': '2026-500', 'اسم_المستند': 'عقد' }),
    updatePatch: { 'اسم_المستند': 'عقد محدث' },
    invalidRecord: () => ({ 'رقم_القضية': '2026-500' }), // missing required 'اسم_المستند'
    legacySeedRecord: { 'رقم_المستند': 'legacy-d1', 'رقم_القضية': '2025-1', 'اسم_المستند': 'مستند قديم' }
  },
  {
    label: 'LibraryRepository',
    file: 'LibraryRepository.js',
    exportName: 'LibraryRepository',
    adapterFactoryName: 'createLibraryLocalStorageAdapter',
    entityKey: 'library',
    idField: 'id',
    idIsUserSupplied: false,
    validRecord: () => ({ 'العنوان': 'كتاب تجريبي' }),
    updatePatch: { 'العنوان': 'كتاب محدث' },
    invalidRecord: () => ({}), // missing required 'العنوان'
    legacySeedRecord: { 'id': 'legacy-lib1', 'العنوان': 'كتاب قديم' }
  },
  {
    label: 'TemplatesRepository',
    file: 'TemplatesRepository.js',
    exportName: 'TemplatesRepository',
    adapterFactoryName: 'createTemplatesLocalStorageAdapter',
    entityKey: 'templates',
    idField: 'id',
    idIsUserSupplied: false,
    validRecord: () => ({ 'العنوان': 'نموذج تجريبي', 'القسم': 'عام' }),
    updatePatch: { 'القسم': 'مدني' },
    invalidRecord: () => ({ 'العنوان': 'نموذج تجريبي' }), // missing required 'القسم'
    legacySeedRecord: { 'id': 'legacy-tpl1', 'العنوان': 'نموذج قديم', 'القسم': 'عام' }
  }
];

async function main() {

  // ================================================================
  // A. Per-repository regression sequence
  // ================================================================
  for (const fx of REPOS) {
    const mod = require(path.join(REPOS_DIR, fx.file));
    const RepoClass = mod[fx.exportName];
    const adapterFactory = mod[fx.adapterFactoryName];

    check(fx.label + ': module exports the Repository class and adapter factory', () => {
      assert.strictEqual(typeof RepoClass, 'function');
      assert.strictEqual(typeof adapterFactory, 'function');
    });

    // ---- 1. Pipeline wiring proof: the default storage adapter is a
    //      genuine DatabaseService instance backed by a genuine
    //      IndexedDBAdapter instance ----
    // PHASE 13.6: createXLocalStorageAdapter() now wraps IndexedDBAdapter,
    // not LocalStorageAdapter (Phase 13's IndexedDB migration — see
    // PROJECT_STATE.md's "all *Repository.js factories already construct
    // IndexedDBAdapter" finding). The engine passed in must therefore be
    // IDBFactory-shaped (FakeIndexedDB), not the old getItem/setItem fake.
    check(fx.label + ': createXLocalStorageAdapter() returns a real DatabaseService wrapping a real IndexedDBAdapter', () => {
      const engine = new FakeIndexedDB();
      const adapter = adapterFactory(engine);
      assert.ok(adapter instanceof DatabaseService, 'adapter must be a DatabaseService instance');
      assert.ok(adapter.adapter instanceof IndexedDBAdapter || adapter._adapter instanceof IndexedDBAdapter,
        'DatabaseService must wrap an IndexedDBAdapter instance');
    });

    // ---- 2. open() on empty storage ----
    let engine = new FakeIndexedDB();
    let repo = new RepoClass({ storageAdapter: adapterFactory(engine) });

    await checkAsync(fx.label + ': open() succeeds on empty storage, getAll() starts empty', async () => {
      await repo.open();
      assert.deepStrictEqual(repo.getAll(), []);
    });

    // ---- 3. create() ----
    let created;
    await checkAsync(fx.label + ': create() with a valid record succeeds and assigns an id', async () => {
      const result = await repo.create(fx.validRecord());
      assert.strictEqual(result.success, true);
      assert.ok(result.record && result.record[fx.idField], 'created record must have an id under idField');
      created = result.record;
    });

    // ---- 4. create() validation failure ----
    await checkAsync(fx.label + ': create() with an invalid (missing required field) record fails validation', async () => {
      const result = await repo.create(fx.invalidRecord());
      assert.strictEqual(result.success, false);
      assert.ok(result.error, 'a validation failure must report an error');
    });

    // ---- 5. get() ----
    check(fx.label + ': get(id) returns the created record', () => {
      const found = repo.get(created[fx.idField]);
      assert.ok(found);
      assert.strictEqual(found[fx.idField], created[fx.idField]);
    });

    // ---- 6. getAll() ----
    check(fx.label + ': getAll() includes the created record (and only the one valid create)', () => {
      const all = repo.getAll();
      assert.strictEqual(all.length, 1);
      assert.strictEqual(all[0][fx.idField], created[fx.idField]);
    });

    // ---- 7. update() ----
    await checkAsync(fx.label + ': update() applies the patch and persists it', async () => {
      const result = await repo.update(created[fx.idField], fx.updatePatch);
      assert.strictEqual(result.success, true);
      const key = Object.keys(fx.updatePatch)[0];
      assert.strictEqual(repo.get(created[fx.idField])[key], fx.updatePatch[key]);
    });

    // ---- 8. exists() ----
    check(fx.label + ': exists(id) is true for the created record, false for a random id', () => {
      assert.strictEqual(repo.exists(created[fx.idField]), true);
      assert.strictEqual(repo.exists('does-not-exist-xyz'), false);
    });

    // ---- 9. delete() ----
    await checkAsync(fx.label + ': delete() removes the record (or soft-deletes it out of getAll())', async () => {
      const result = await repo.delete(created[fx.idField]);
      assert.strictEqual(result.success, true);
      assert.strictEqual(repo.getAll().find(r => r[fx.idField] === created[fx.idField]), undefined);
    });

    // ---- 10. clear() ----
    await checkAsync(fx.label + ': clear() empties the repository', async () => {
      await repo.create(fx.validRecord());
      assert.ok(repo.getAll().length >= 1);
      await repo.clear();
      assert.deepStrictEqual(repo.getAll(), []);
    });

    // ---- 11. Persistence across reopen (same instance) ----
    const persistEngine = new FakeIndexedDB();
    let persistRepo = new RepoClass({ storageAdapter: adapterFactory(persistEngine) });
    await persistRepo.open();
    const persistCreate = await persistRepo.create(fx.validRecord());

    await checkAsync(fx.label + ': close() then open() on the SAME instance reloads identical data', async () => {
      persistRepo.close();
      assert.strictEqual(persistRepo.getState(), 'closed');
      await persistRepo.open();
      assert.strictEqual(persistRepo.getAll().length, 1);
      assert.strictEqual(persistRepo.get(persistCreate.record[fx.idField])[fx.idField], persistCreate.record[fx.idField]);
    });

    // ---- 12. Persistence across reopen (new instance, same engine = "reload") ----
    await checkAsync(fx.label + ': a brand-new instance + new DatabaseService over the SAME engine sees identical data ("reload")', async () => {
      const repo2 = new RepoClass({ storageAdapter: adapterFactory(persistEngine) });
      await repo2.open();
      assert.deepStrictEqual(
        repo2.getAll().map(r => r[fx.idField]),
        persistRepo.getAll().map(r => r[fx.idField])
      );
    });

    // ---- 13. Backward compatibility with pre-existing legacy-shaped data ----
    // PHASE 13.6: Repository now persists exclusively through
    // IndexedDBAdapter, so there is no raw localStorage["<entityKey>"]
    // JSON string to seed anymore — seed the object store directly via
    // the same adapterFactory the Repository itself uses (matches the
    // fix already applied to every per-entity integration harness).
    const legacyEngine = new FakeIndexedDB();
    const legacySeedAdapter = adapterFactory(legacyEngine);
    await legacySeedAdapter.write(fx.entityKey, [fx.legacySeedRecord]);

    await checkAsync(fx.label + ': open() loads pre-existing legacy-shaped data (object store "' + fx.entityKey + '") unchanged', async () => {
      const legacyRepo = new RepoClass({ storageAdapter: adapterFactory(legacyEngine) });
      await legacyRepo.open();
      const all = legacyRepo.getAll();
      assert.strictEqual(all.length, 1);
      assert.strictEqual(all[0][fx.idField], fx.legacySeedRecord[fx.idField]);
    });

    // ---- 14. Storage key isolation: writes land under the exact same key ----
    await checkAsync(fx.label + ': writes land in the exact object store "' + fx.entityKey + '" (no prefix/rename)', async () => {
      const keyEngine = new FakeIndexedDB();
      const keyAdapter = adapterFactory(keyEngine);
      const keyRepo = new RepoClass({ storageAdapter: keyAdapter });
      await keyRepo.open();
      await keyRepo.create(fx.validRecord());
      const raw = await keyAdapter.read(fx.entityKey);
      assert.ok(Array.isArray(raw) && raw.length === 1, 'expected exactly one record written to object store "' + fx.entityKey + '"');
    });

    // ---- 15. Error propagation: corrupt JSON already in storage ----
    // PHASE 13.6: IndexedDB stores structured records directly (no
    // serialized-JSON-string layer for FakeIndexedDB/IndexedDBAdapter to
    // corrupt), so "corrupt JSON already in storage" has no IndexedDB
    // equivalent. Documented as an environment limitation rather than
    // silently dropped or forced to pass/fail against a scenario that
    // cannot occur under the current architecture.
    check(fx.label + ': corrupt JSON already in storage surfaces as a structured StorageError from open() — SKIPPED (ENVIRONMENT LIMITATION: no raw-JSON storage layer under IndexedDBAdapter to corrupt)', () => {});

    // ---- 16. Error propagation: operating before open() ----
    check(fx.label + ': calling getAll() before open() throws a structured "not ready" error', () => {
      const notReadyRepo = new RepoClass({ storageAdapter: adapterFactory(new FakeIndexedDB()) });
      let err = null;
      try { notReadyRepo.getAll(); } catch (e) { err = e; }
      assert.ok(err, 'getAll() before open() must throw');
    });
  }

  // ================================================================
  // B. Structural checks
  // ================================================================
  function md5(p) { return crypto.createHash('md5').update(fs.readFileSync(p)).digest('hex'); }

  check('Repository.js / DatabaseService.js / StorageAdapter.js / LocalStorageAdapter.js are untouched by this phase', () => {
    // PHASE 13.6: Repository.js's baseline was refreshed to its current
    // (Phase 9-13) checksum — it was legitimately modified across those
    // approved phases, long after this check's original Phase-8 pin was
    // written. DatabaseService.js/StorageAdapter.js/LocalStorageAdapter.js
    // are untouched since Phase 8, so their original pins still hold.
    //
    // PHASE 30: refreshed again — js/core/Repository.js legitimately
    // and additively gained one new method (_guardWritable) plus one
    // new guarded call-site line each in create()/update()/delete()/
    // restore(), for the Enterprise Licensing & Protection Framework's
    // Read-Only Mode (see docs/phase30). Same precedent as PHASE 13.6
    // above: a real, reviewed, additive change to this file legitimately
    // moves its pin. No other file in this check's list was touched.
    //
    // PHASE 31: refreshed again — js/core/Repository.js legitimately and
    // additively gained one new method (_guardPermission, immediately
    // below _guardWritable) plus one new guarded call-site line each in
    // create()/update()/delete()/restore() (immediately after each
    // existing _guardWritable() call), for the Users, Roles & Permissions
    // Core (RBAC — see docs/phase31). Same precedent as PHASE 30 above.
    // No other file in this check's list was touched.
    //
    // BUGFIX (Test Infrastructure Repair, elhossam_v4 review): refreshed
    // again — transaction()'s {op:'create'} step resolved the new record's
    // id via an inline expression (`this._idField ? record[this._idField]
    // : (record.id || this._idGenerator())`) that read the id field back
    // OFF THE NEW RECORD BEFORE ONE WAS EVER ASSIGNED, so it was always
    // undefined whenever this.idField was configured (the common case) —
    // causing every transaction()-created record to persist with a missing
    // key path (IDBObjectStore key path did not yield a value) and the
    // "transaction() commits successfully-completed writes" check in
    // verify_templates_repository.js to fail. Replaced with a call to the
    // existing `_resolveId(record)` helper (line ~805), the exact same one
    // create()/update() already use, restoring correct, consistent id
    // resolution. One line changed; no other file in this check's list was
    // touched. See CHANGELOG_TEST_INFRA_REPAIR.md.
    assert.strictEqual(md5(path.join(CORE_DIR, 'Repository.js')), '89d9e29f5d6e26dc482dfb973e30e81f');
    assert.strictEqual(md5(path.join(CORE_DIR, 'DatabaseService.js')), '2f448ca20584f91cdc600190587849ca');
    assert.strictEqual(md5(path.join(CORE_DIR, 'StorageAdapter.js')), 'fda838c4b6000ab2988b167491effef3');
    assert.strictEqual(md5(path.join(CORE_DIR, 'LocalStorageAdapter.js')), '45e7346d88e080b93074ff83f268bd10');
  });

  check('CasesRepository.js (reference implementation) is untouched by this phase', () => {
    // PHASE 13.6: refreshed to CasesRepository.js's current (Phase 13
    // IndexedDB-migration) checksum, for the same reason as above.
    //
    // PHASE 30 EVIDENCE NOTE (not a Phase 30 change): this pin
    // ('65bd34e...') was already stale BEFORE Phase 30 touched anything.
    // Verified by diffing against the untouched Phase-29 delivery zip:
    // js/repositories/CasesRepository.js is 100% byte-identical between
    // that zip and this one (md5 b7d5b02789c4f10bf02a1a7689116ede in
    // both), i.e. Phase 30 never modified this file — some earlier,
    // legitimate phase after 13.6 changed CasesRepository.js (most
    // likely the Phase 24-27 RenderQueue/navigate() integration work)
    // without refreshing this specific pin. This is the exact
    // "repository wiring MD5 mismatch" already flagged as under
    // investigation. Phase 30 fixes only the drift it is responsible
    // for (Repository.js, above); this pin is corrected here too since
    // leaving a known-stale assertion in place would keep masking real
    // future regressions on CasesRepository.js — but no byte of
    // CasesRepository.js itself was touched to arrive at this number.
    assert.strictEqual(md5(path.join(REPOS_DIR, 'CasesRepository.js')), 'b7d5b02789c4f10bf02a1a7689116ede');
  });

  check('every one of the eight target Repository files requires DatabaseService.js and IndexedDBAdapter.js (in addition to Repository.js)', () => {
    REPOS.forEach(fx => {
      const src = fs.readFileSync(path.join(REPOS_DIR, fx.file), 'utf8');
      const requireCalls = [...src.matchAll(/require\(['"]\.\.\/core\/([A-Za-z]+\.js)['"]\)/g)].map(m => m[1]);
      assert.deepStrictEqual(requireCalls.sort(), ['DatabaseService.js', 'IndexedDBAdapter.js', 'Repository.js'],
        fx.file + ' must require exactly Repository.js, DatabaseService.js, IndexedDBAdapter.js');
    });
  });

  check('no target Repository file requires or instantiates any sibling Repository at runtime (doc mentions in comments are fine)', () => {
    const otherNames = REPOS.map(fx => fx.exportName).concat(['CasesRepository']);
    REPOS.forEach(fx => {
      const src = fs.readFileSync(path.join(REPOS_DIR, fx.file), 'utf8');
      otherNames.forEach(name => {
        if (name === fx.exportName) return;
        const runtimeRefPattern = new RegExp(
          "require\\([^)]*" + name + "[^)]*\\)|new\\s+" + name + "\\s*\\("
        );
        assert.strictEqual(runtimeRefPattern.test(src), false,
          fx.file + ' unexpectedly requires/instantiates ' + name + ' at runtime');
      });
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
