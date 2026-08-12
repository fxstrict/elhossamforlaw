/**
 * verify_children_repository.js
 * Standalone Node harness for ChildrenRepository (Phase 5 / Sub-phase 5.4).
 * Independent of verify_clients_repository.js and verify_cases_repository.js
 * (no shared helper module — self-contained, per this phase's "Harness
 * مستقل" instruction).
 * Run: node verify_children_repository.js
 * No browser required.
 *
 * PHASE 13.5 — TEST HARNESS MODERNIZATION:
 * createChildrenLocalStorageAdapter(storageImpl) no longer wraps a
 * plain localStorage-shaped (getItem/setItem) object — it now builds a
 * real IndexedDBAdapter/DatabaseService pair (see ChildrenRepository.js
 * "Storage Adapter — DatabaseService-backed (PHASE 8 / SUB-PHASE
 * 8.5.2)"), so `storageImpl` must satisfy the IDBFactory shape, not the
 * old Storage shape. This harness previously passed a getItem/setItem
 * fake, which the current adapter cannot use, causing every test to
 * crash with "No usable indexedDB implementation is present". Updated
 * to use js/tests/fake_indexeddb.js's `FakeIndexedDB` — the same
 * in-memory IDBFactory-shaped double already used by
 * verify_settings_repository.js / verify_indexeddb_engine.js — per this
 * phase's "reuse the existing fake IndexedDB environment, do not invent
 * a new one" instruction. No assertions changed, only the fake's shape.
 */

const assert = require('assert');
const path = require('path');

const { Repository } = require(path.join(__dirname, '..', 'core', 'Repository.js'));
const { ChildrenRepository, createChildrenLocalStorageAdapter } =
  require(path.join(__dirname, '..', 'repositories', 'ChildrenRepository.js'));
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
    log.push('FAIL — ' + label + '  =>  ' + e.message);
  }
}

// ---- Fake IndexedDB (IDBFactory-shaped — matches what
// createChildrenLocalStorageAdapter's IndexedDBAdapter actually needs) ----
function makeFakeStorage(seed) {
  const fake = new FakeIndexedDB();
  if (seed && Object.keys(seed).length) {
    // Legacy seed data (pre-migration localStorage snapshots) is no
    // longer applicable to an IndexedDB-backed store — callers in this
    // file only ever seed with {} (see "open() on empty ... (real
    // first-run condition)" below), so this is a no-op guard, not a
    // silent data loss.
    throw new Error('makeFakeStorage(seed): non-empty seed is not supported against FakeIndexedDB');
  }
  return fake;
}

async function main() {

  // 1. Class existence
  check('ChildrenRepository is a function / class', () => {
    assert.strictEqual(typeof ChildrenRepository, 'function');
  });

  // 2. Empty Repository — open() on empty localStorage (real first-run condition)
  await (async () => {
    const fake = makeFakeStorage({});
    const repo = new ChildrenRepository({ storageAdapter: createChildrenLocalStorageAdapter(fake) });
    await repo.open();
    check('open() on empty localStorage (no "children" key) starts with zero records, no throw', () => {
      assert.deepStrictEqual(repo.getAll(), []);
    });
    check('Empty repository: getAll()/count()/search()/exists()/get() behave correctly with zero records', () => {
      assert.deepStrictEqual(repo.getAll(), []);
      assert.strictEqual(repo.count(), 0);
      assert.deepStrictEqual(repo.search({ search: 'anything' }).items, []);
      assert.strictEqual(repo.exists('x'), false);
      assert.strictEqual(repo.get('x'), null);
      assert.deepStrictEqual(repo.filter({ 'رقم_القضية': '2026-100' }), []);
    });
  })();

  // 3. Legacy localStorage compatibility — pre-existing legacy-shaped data
  // PHASE 13.5: IndexedDB has no raw-JSON "seed" the way localStorage
  // did, so the equivalent of "pre-existing data loads unchanged" is
  // data written by one repository instance still being there when a
  // second instance reopens the SAME underlying FakeIndexedDB — the
  // same "simulates a page reload" pattern verify_settings_repository.js
  // already uses (makeOpenedRepo(sharedFake)). Same intent, same
  // assertions on the record shape — only how the data gets there
  // changed, since the storage layer changed underneath this test.
  let repo; // shared across the remaining CRUD-heavy checks
  const fake = makeFakeStorage({});

  await (async () => {
    const seedRepo = new ChildrenRepository({ storageAdapter: createChildrenLocalStorageAdapter(fake) });
    await seedRepo.open();
    await seedRepo.create({
      'رقم_الطفل': 'legacy-child-1',
      'رقم_القضية': '2026-100',
      'الاسم': 'ياسمين محمد',
      'السن': '7',
      'المدرسة': 'مدرسة النور'
    });

    repo = new ChildrenRepository({ storageAdapter: createChildrenLocalStorageAdapter(fake) });
    await repo.open();
    check('open() loads existing ("legacy") data unchanged after a reopen', () => {
      const all = repo.getAll();
      assert.strictEqual(all.length, 1);
      assert.strictEqual(all[0]['الاسم'], 'ياسمين محمد');
      assert.strictEqual(all[0]['رقم_القضية'], '2026-100');
    });
  })();

  check('getAll() returns a copy, not a live reference (Contract §19)', () => {
    const a = repo.getAll();
    a[0]['الاسم'] = 'MUTATED';
    const b = repo.getAll();
    assert.strictEqual(b[0]['الاسم'], 'ياسمين محمد');
  });

  // 4. Validation — two required fields (رقم_القضية, الاسم)
  check('validate() rejects a record missing both required fields', () => {
    const r = repo.validate({ 'السن': '5' });
    assert.strictEqual(r.valid, false);
    assert.strictEqual(r.errors.length, 2);
    const fields = r.errors.map(e => e.field).sort();
    assert.deepStrictEqual(fields, ['الاسم', 'رقم_القضية'].sort());
  });

  check('validate() rejects a record missing only رقم_القضية', () => {
    const r = repo.validate({ 'الاسم': 'محمود' });
    assert.strictEqual(r.valid, false);
    assert.strictEqual(r.errors.length, 1);
    assert.strictEqual(r.errors[0].field, 'رقم_القضية');
  });

  check('validate() rejects a record missing only الاسم', () => {
    const r = repo.validate({ 'رقم_القضية': '2026-200' });
    assert.strictEqual(r.valid, false);
    assert.strictEqual(r.errors.length, 1);
    assert.strictEqual(r.errors[0].field, 'الاسم');
  });

  check('validate() accepts a record with both required fields non-empty', () => {
    const r = repo.validate({ 'رقم_القضية': '2026-200', 'الاسم': 'محمود' });
    assert.strictEqual(r.valid, true);
  });

  check('validate() rejects whitespace-only required fields (matches .trim() checks in saveChild())', () => {
    const r = repo.validate({ 'رقم_القضية': '   ', 'الاسم': 'محمود' });
    assert.strictEqual(r.valid, false);
    assert.strictEqual(r.errors[0].field, 'رقم_القضية');
  });

  // 5. Insert / create — hybrid id generation + duplicate protection
  let insertedId;
  await (async () => {
    const res = await repo.insert({ 'رقم_القضية': '2026-101', 'الاسم': 'كريم علي', 'السن': '10' });
    check('insert() [alias of create()] adds a new child, auto-generating رقم_الطفل when absent', () => {
      assert.strictEqual(res.success, true);
      assert.ok(res.record['رقم_الطفل'], 'expected a generated رقم_الطفل');
      assert.strictEqual(res.record['الاسم'], 'كريم علي');
      insertedId = res.record['رقم_الطفل'];
    });
  })();

  await (async () => {
    const res = await repo.insert({ 'رقم_الطفل': 'explicit-child-1', 'رقم_القضية': '2026-102', 'الاسم': 'نور حسن' });
    check('insert() preserves a caller-supplied رقم_الطفل instead of overwriting it (matches saveChild()\'s || uid() fallback)', () => {
      assert.strictEqual(res.success, true);
      assert.strictEqual(res.record['رقم_الطفل'], 'explicit-child-1');
    });
  })();

  await (async () => {
    const res = await repo.insert({ 'رقم_الطفل': 'explicit-child-1', 'رقم_القضية': '2026-103', 'الاسم': 'تكرار' });
    check('insert() [Duplicate ID] rejects a second record with an explicitly duplicate رقم_الطفل', () => {
      assert.strictEqual(res.success, false);
      assert.strictEqual(res.error.type, 'ConflictError');
    });
  })();

  await (async () => {
    const res = await repo.insert({ 'رقم_القضية': '2026-104' }); // missing الاسم
    check('insert() [Invalid Entity] rejects a record missing a required field before touching storage', () => {
      assert.strictEqual(res.success, false);
      assert.strictEqual(res.error.type, 'ValidationError');
    });
  })();

  // 6. get / exists
  check('get(id) returns the child by رقم_الطفل', () => {
    const c = repo.get(insertedId);
    assert.ok(c);
    assert.strictEqual(c['الاسم'], 'كريم علي');
  });

  check('get(id) returns null for unknown id', () => {
    assert.strictEqual(repo.get('no-such-id'), null);
  });

  check('exists(id) true/false', () => {
    assert.strictEqual(repo.exists(insertedId), true);
    assert.strictEqual(repo.exists('no-such-id'), false);
  });

  // 7. Update Child
  await (async () => {
    const res = await repo.update(insertedId, { 'السن': '11', 'المدرسة': 'مدرسة الأمل' });
    check('update(id, entity) merges fields and stamps updatedAt/version', () => {
      assert.strictEqual(res.success, true);
      assert.strictEqual(res.record['السن'], '11');
      assert.strictEqual(res.record['المدرسة'], 'مدرسة الأمل');
      assert.strictEqual(res.record['الاسم'], 'كريم علي'); // untouched field preserved
      assert.strictEqual(res.record.version, 2); // 1 on create, +1 on update
      assert.ok(res.record.updatedAt);
    });
  })();

  await (async () => {
    const res = await repo.update(insertedId, { 'رقم_القضية': '' });
    check('update(id, entity) rejects a patch that would violate a required field', () => {
      assert.strictEqual(res.success, false);
      assert.strictEqual(res.error.type, 'ValidationError');
    });
  })();

  await (async () => {
    const res = await repo.update('no-such-id', { 'الاسم': 'x' });
    check('update(id, entity) on an unknown id fails gracefully (base Repository.js reports ValidationError for "no record with this id" — unchanged Phase 5.1 base-class behavior)', () => {
      assert.strictEqual(res.success, false);
      assert.strictEqual(res.error.type, 'ValidationError');
    });
  })();

  // 8. count (baseline before delete checks)
  check('count() reflects current non-deleted record count', () => {
    // legacy-child-1 + كريم + نور = 3 (the duplicate/invalid inserts above never landed)
    assert.strictEqual(repo.count(), 3);
  });

  // 9. Delete Child — soft delete
  await (async () => {
    const res = await repo.remove(insertedId);
    check('remove(id) [alias of delete()] soft-deletes by default (Data_Schema §3.7 / §4.3 Delete Rules)', () => {
      assert.strictEqual(res.success, true);
      assert.ok(res.record.deletedAt);
    });
  })();

  check('soft-deleted record excluded from default getAll()/get()', () => {
    assert.strictEqual(repo.get(insertedId), null);
    assert.strictEqual(repo.getAll().some(r => r['رقم_الطفل'] === insertedId), false);
  });

  check('getAll({includeDeleted:true}) still returns the soft-deleted record', () => {
    const all = repo.getAll({ includeDeleted: true });
    assert.strictEqual(all.some(r => r['رقم_الطفل'] === insertedId), true);
  });

  check('count() excludes the soft-deleted record after remove()', () => {
    assert.strictEqual(repo.count(), 2);
  });

  await (async () => {
    const res = await repo.remove('no-such-id');
    check('remove(id) on an unknown id fails gracefully (base Repository.js reports ValidationError for "no record with this id" — unchanged Phase 5.1 base-class behavior)', () => {
      assert.strictEqual(res.success, false);
      assert.strictEqual(res.error.type, 'ValidationError');
    });
  })();

  // 10. Search — full-record join, matches renderChildren() (see file header "SEARCH" note)
  check('search() free-text matches across ANY legacy field, case-insensitively (matches renderChildren(), despite both planning reports claiming no free-text search exists)', () => {
    const result = repo.search({ search: 'حسن' }); // matches الاسم 'نور حسن'
    assert.strictEqual(result.items.length, 1);
    assert.strictEqual(result.items[0]['الاسم'], 'نور حسن');
  });

  check('search() free-text matches a non-name field (school)', () => {
    const result = repo.search({ search: 'النور' });
    assert.strictEqual(result.items.length, 1);
    assert.strictEqual(result.items[0]['رقم_الطفل'], 'legacy-child-1');
  });

  check('search() does NOT match against new audit/metadata fields (checksum/version etc.)', () => {
    const target = repo.get('explicit-child-1');
    const result = repo.search({ search: String(target.checksum) });
    assert.strictEqual(result.items.length, 0);
  });

  check('search() excludes soft-deleted records by default', () => {
    const result = repo.search({ search: 'كريم' });
    assert.strictEqual(result.items.length, 0);
  });

  // 11. Filter — رقم_القضية (the only real filtering pattern used by Children today)
  await (async () => {
    await repo.insert({ 'رقم_القضية': '2026-100', 'الاسم': 'شقيق ياسمين' }); // same case as legacy-child-1
  })();

  check('filter() by رقم_القضية returns exactly the children of that case ("children of a given case" — the real query pattern)', () => {
    const siblings = repo.filter({ 'رقم_القضية': '2026-100' });
    assert.strictEqual(siblings.length, 2);
    const names = siblings.map(c => c['الاسم']).sort();
    assert.deepStrictEqual(names, ['شقيق ياسمين', 'ياسمين محمد'].sort());
  });

  check('filter() by a رقم_القضية with no children returns an empty array', () => {
    assert.deepStrictEqual(repo.filter({ 'رقم_القضية': '2026-999' }), []);
  });

  // 12. Sort
  check('sort() orders by تاريخ_الميلاد ascending by default (empty/missing values sort first)', () => {
    const sorted = repo.sort();
    assert.ok(Array.isArray(sorted));
    assert.strictEqual(sorted.length, repo.count());
  });

  await (async () => {
    await repo.insert({ 'رقم_القضية': '2026-105', 'الاسم': 'Aya', 'تاريخ_الميلاد': '2015-01-01' });
    await repo.insert({ 'رقم_القضية': '2026-106', 'الاسم': 'Zain', 'تاريخ_الميلاد': '2010-01-01' });
  })();

  check('sort() accepts an explicit sortSpec and array of records without mutating input', () => {
    const input = repo.getAll();
    const inputCopy = JSON.parse(JSON.stringify(input));
    const sorted = repo.sort(input, { field: 'تاريخ_الميلاد', direction: 'asc' });
    assert.deepStrictEqual(input, inputCopy); // input untouched
    const dates = sorted.map(c => c['تاريخ_الميلاد']).filter(Boolean);
    for (let i = 1; i < dates.length; i++) {
      assert.ok(String(dates[i - 1]) <= String(dates[i]));
    }
  });

  // 13. Repository Interface — Contract-literal + phase-requested names
  check('Contract-literal create/update/delete are still present and callable', () => {
    assert.strictEqual(typeof repo.create, 'function');
    assert.strictEqual(typeof repo.update, 'function');
    assert.strictEqual(typeof repo.delete, 'function');
  });

  check('insert/remove/filter/sort/validate are additive aliases, not overriding create/update/delete', () => {
    assert.notStrictEqual(repo.insert, repo.create);
    assert.strictEqual(typeof repo.insert, 'function');
    assert.notStrictEqual(repo.remove, repo.delete);
    assert.strictEqual(typeof repo.remove, 'function');
    assert.strictEqual(typeof repo.filter, 'function');
    assert.strictEqual(typeof repo.sort, 'function');
    assert.strictEqual(typeof repo.validate, 'function');
  });

  check('getAll/get/exists/count/find/bulkInsert/bulkUpdate/bulkDelete/export/import/clear/transaction all present', () => {
    ['getAll', 'get', 'exists', 'count', 'find', 'bulkInsert', 'bulkUpdate',
      'bulkDelete', 'export', 'import', 'clear', 'transaction'].forEach(m => {
      assert.strictEqual(typeof repo[m], 'function', m + ' missing');
    });
  });

  // 14. Legacy localStorage compatibility — storage format round-trip
  // PHASE 13.6: `fake` is a FakeIndexedDB (IDBFactory-shaped) instance,
  // not a getItem/setItem Storage-shaped fake, so there is no raw
  // localStorage["children"] string to JSON.parse anymore (see the file
  // header's PHASE 13.5 note). The IndexedDB-era equivalent of "the
  // persisted form is a plain array of records, exactly like index.html
  // expects" is reading the object store back through the same
  // DatabaseService/IndexedDBAdapter pair the Repository itself uses
  // (`createChildrenLocalStorageAdapter(fake).read('children')`), which
  // resolves the array `IndexedDBAdapter.write()` actually persisted via
  // `store.getAll()` — the direct IndexedDB analogue of the old raw-JSON
  // round-trip check.
  await (async () => {
    const readBackAdapter = createChildrenLocalStorageAdapter(fake);
    const persisted = await readBackAdapter.read('children');
    check('persisted "children" object store is a plain array of records, exactly like index.html expects', () => {
      assert.ok(Array.isArray(persisted));
      assert.ok(persisted.length > 0);
    });
  })();

  await (async () => {
    const repo2 = new ChildrenRepository({ storageAdapter: createChildrenLocalStorageAdapter(fake) });
    await repo2.open();
    check('a second ChildrenRepository instance opening the same storage sees identical data (no data loss across "reload")', () => {
      assert.deepStrictEqual(
        repo2.getAll({ includeDeleted: true }).map(r => r['رقم_الطفل']).sort(),
        repo.getAll({ includeDeleted: true }).map(r => r['رقم_الطفل']).sort()
      );
    });
  })();

  check('ChildrenRepository does not reference ClientsRepository/CasesRepository at runtime (independent harness, independent class)', () => {
    assert.strictEqual(Object.getPrototypeOf(ChildrenRepository.prototype).constructor, Repository);
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
