/**
 * verify_clients_repository.js
 * Standalone Node harness for ClientsRepository (Phase 5 / Sub-phase 5.3).
 * Run: node verify_clients_repository.js
 * No browser required.
 *
 * PHASE 13.5 — TEST HARNESS MODERNIZATION: createClientsLocalStorageAdapter
 * now builds a real IndexedDBAdapter/DatabaseService pair (see
 * ClientsRepository.js), so the fake passed to it must be IDBFactory-
 * shaped, not Storage-shaped (getItem/setItem). Swapped to
 * js/tests/fake_indexeddb.js's FakeIndexedDB, the same double already
 * used by verify_settings_repository.js — reusing the existing fake
 * IndexedDB environment rather than inventing a new one.
 */

const assert = require('assert');
const path = require('path');

const { Repository } = require(path.join(__dirname, '..', 'core', 'Repository.js'));
const { ClientsRepository, createClientsLocalStorageAdapter } =
  require(path.join(__dirname, '..', 'repositories', 'ClientsRepository.js'));
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

// ---- Fake IndexedDB (IDBFactory-shaped) ----
function makeFakeStorage(seed) {
  if (seed && Object.keys(seed).length) {
    throw new Error('makeFakeStorage(seed): non-empty seed is not supported against FakeIndexedDB');
  }
  return new FakeIndexedDB();
}

async function main() {

  // 1. Class existence
  check('ClientsRepository is a function / class', () => {
    assert.strictEqual(typeof ClientsRepository, 'function');
  });

  // 2. Fresh/empty state — open() on empty localStorage
  await (async () => {
    const fake = makeFakeStorage({});
    const repo = new ClientsRepository({ storageAdapter: createClientsLocalStorageAdapter(fake) });
    await repo.open();
    check('open() on empty localStorage (no "clients" key) starts with zero records, no throw', () => {
      assert.deepStrictEqual(repo.getAll(), []);
    });
  })();

  // PHASE 13.5: equivalent of "pre-existing data loads unchanged" for an
  // IndexedDB-backed store — data written by one repository instance is
  // still there when a second instance reopens the SAME FakeIndexedDB
  // (same "simulates a reload" pattern verify_settings_repository.js
  // already uses).
  let repo; // shared across the remaining CRUD-heavy checks
  const fake = makeFakeStorage({});

  await (async () => {
    const seedRepo = new ClientsRepository({ storageAdapter: createClientsLocalStorageAdapter(fake) });
    await seedRepo.open();
    await seedRepo.create({ 'رقم_الموكل': 'legacy1', 'الاسم': 'أحمد علي', 'النوع': 'فرد', 'الهاتف': '0100000001' });

    repo = new ClientsRepository({ storageAdapter: createClientsLocalStorageAdapter(fake) });
    await repo.open();
    check('open() loads existing ("legacy") data unchanged after a reopen', () => {
      const all = repo.getAll();
      assert.strictEqual(all.length, 1);
      assert.strictEqual(all[0]['الاسم'], 'أحمد علي');
      assert.strictEqual(all[0]['رقم_الموكل'], 'legacy1');
    });
  })();

  check('getAll() returns a copy, not a live reference (Contract §19)', () => {
    const a = repo.getAll();
    a[0]['الاسم'] = 'MUTATED';
    const b = repo.getAll();
    assert.strictEqual(b[0]['الاسم'], 'أحمد علي');
  });

  // 4. Validation
  check('validate() rejects missing الاسم', () => {
    const r = repo.validate({ 'النوع': 'فرد' });
    assert.strictEqual(r.valid, false);
    assert.strictEqual(r.errors[0].field, 'الاسم');
  });

  check('validate() accepts a record with الاسم non-empty', () => {
    const r = repo.validate({ 'الاسم': 'محمد سعيد' });
    assert.strictEqual(r.valid, true);
  });

  check('validate() rejects whitespace-only الاسم (matches .trim() check in saveClient())', () => {
    const r = repo.validate({ 'الاسم': '   ' });
    assert.strictEqual(r.valid, false);
  });

  // 5. Insert / create — hybrid id generation
  let insertedId;
  await (async () => {
    const res = await repo.insert({ 'الاسم': 'سارة محمود', 'الهاتف': '0123456789' });
    check('insert() [alias of create()] adds a new client, auto-generating رقم_الموكل when absent', () => {
      assert.strictEqual(res.success, true);
      assert.ok(res.record['رقم_الموكل'], 'expected a generated رقم_الموكل');
      assert.strictEqual(res.record['الاسم'], 'سارة محمود');
      insertedId = res.record['رقم_الموكل'];
    });
  })();

  await (async () => {
    const res = await repo.insert({ 'رقم_الموكل': 'explicit-id-1', 'الاسم': 'خالد يوسف' });
    check('insert() preserves a caller-supplied رقم_الموكل instead of overwriting it (matches saveClient()\'s || uid() fallback)', () => {
      assert.strictEqual(res.success, true);
      assert.strictEqual(res.record['رقم_الموكل'], 'explicit-id-1');
    });
  })();

  await (async () => {
    const res = await repo.insert({ 'رقم_الموكل': 'explicit-id-1', 'الاسم': 'تكرار' });
    check('insert() rejects a duplicate رقم_الموكل (uniqueness enforced by base class idField)', () => {
      assert.strictEqual(res.success, false);
      assert.strictEqual(res.error.type, 'ConflictError');
    });
  })();

  await (async () => {
    const res = await repo.insert({ 'النوع': 'شركة' }); // missing الاسم
    check('insert() rejects invalid record (missing required field) before touching storage', () => {
      assert.strictEqual(res.success, false);
      assert.strictEqual(res.error.type, 'ValidationError');
    });
  })();

  // 6. get / exists
  check('get(id) returns the client by رقم_الموكل', () => {
    const c = repo.get(insertedId);
    assert.ok(c);
    assert.strictEqual(c['الاسم'], 'سارة محمود');
  });

  check('get(id) returns null for unknown id', () => {
    assert.strictEqual(repo.get('no-such-id'), null);
  });

  check('exists(id) true/false', () => {
    assert.strictEqual(repo.exists(insertedId), true);
    assert.strictEqual(repo.exists('no-such-id'), false);
  });

  // 7. update
  await (async () => {
    const res = await repo.update(insertedId, { 'الهاتف': '0199999999' });
    check('update(id, entity) merges fields and stamps updatedAt/version', () => {
      assert.strictEqual(res.success, true);
      assert.strictEqual(res.record['الهاتف'], '0199999999');
      assert.strictEqual(res.record['الاسم'], 'سارة محمود'); // untouched field preserved
      assert.strictEqual(res.record.version, 2); // 1 on create, +1 on update
      assert.ok(res.record.updatedAt);
    });
  })();

  await (async () => {
    const res = await repo.update(insertedId, { 'الاسم': '' });
    check('update(id, entity) rejects a patch that would violate required fields', () => {
      assert.strictEqual(res.success, false);
      assert.strictEqual(res.error.type, 'ValidationError');
    });
  })();

  // 8. count (baseline before delete checks)
  check('count() reflects current non-deleted record count', () => {
    // legacy1 + سارة + خالد = 3 (the duplicate/invalid inserts above never landed)
    assert.strictEqual(repo.count(), 3);
  });

  // 9. remove / delete — soft delete
  await (async () => {
    const res = await repo.remove(insertedId);
    check('remove(id) [alias of delete()] soft-deletes by default (Data_Schema §3.7 / §4.2 Delete Rules)', () => {
      assert.strictEqual(res.success, true);
      assert.ok(res.record.deletedAt);
    });
  })();

  check('soft-deleted record excluded from default getAll()/get()', () => {
    assert.strictEqual(repo.get(insertedId), null);
    assert.strictEqual(repo.getAll().some(r => r['رقم_الموكل'] === insertedId), false);
  });

  check('getAll({includeDeleted:true}) still returns the soft-deleted record', () => {
    const all = repo.getAll({ includeDeleted: true });
    assert.strictEqual(all.some(r => r['رقم_الموكل'] === insertedId), true);
  });

  check('count() excludes the soft-deleted record after remove()', () => {
    assert.strictEqual(repo.count(), 2);
  });

  // 10. Search — full-record join, matches renderClients()
  check('search() free-text matches across ANY legacy field, case-insensitively (matches renderClients())', () => {
    const result = repo.search({ search: 'يوسف' }); // matches الاسم 'خالد يوسف'
    assert.strictEqual(result.items.length, 1);
    assert.strictEqual(result.items[0]['الاسم'], 'خالد يوسف');
  });

  check('search() free-text matches phone number', () => {
    const result = repo.search({ search: '0100000001' });
    assert.strictEqual(result.items.length, 1);
    assert.strictEqual(result.items[0]['رقم_الموكل'], 'legacy1');
  });

  check('search() does NOT match against new audit/metadata fields (checksum/version etc.)', () => {
    const target = repo.get('explicit-id-1');
    const result = repo.search({ search: String(target.checksum) });
    assert.strictEqual(result.items.length, 0);
  });

  check('search() excludes soft-deleted records by default', () => {
    const result = repo.search({ search: 'سارة' });
    assert.strictEqual(result.items.length, 0);
  });

  // 11. Filter
  await (async () => {
    await repo.insert({ 'الاسم': 'شركة النور', 'النوع': 'شركة' });
    await repo.insert({ 'الاسم': 'منى إبراهيم', 'النوع': 'فرد' });
  })();

  check('filter() by النوع matches exactly like a "النوع" dropdown would', () => {
    const companies = repo.filter({ 'النوع': 'شركة' });
    assert.strictEqual(companies.length, 1);
    assert.strictEqual(companies[0]['الاسم'], 'شركة النور');
  });

  check('filter() combining fields (AND semantics)', () => {
    const res = repo.filter({ and: [{ 'النوع': 'فرد' }, { 'الاسم': 'منى إبراهيم' }] });
    assert.strictEqual(res.length, 1);
  });

  // 12. Sort
  check('sort() orders by الاسم ascending by default', () => {
    const sorted = repo.sort();
    for (let i = 1; i < sorted.length; i++) {
      assert.ok(String(sorted[i - 1]['الاسم']) <= String(sorted[i]['الاسم']));
    }
  });

  check('sort() accepts an explicit sortSpec and array of records without mutating input', () => {
    const input = repo.getAll();
    const inputCopy = JSON.parse(JSON.stringify(input));
    const sorted = repo.sort(input, { field: 'الاسم', direction: 'desc' });
    assert.deepStrictEqual(input, inputCopy); // input untouched
    for (let i = 1; i < sorted.length; i++) {
      assert.ok(String(sorted[i - 1]['الاسم']) >= String(sorted[i]['الاسم']));
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

  // 14. Backward compatibility — storage format round-trip
  // PHASE 13.6: `fake` is a FakeIndexedDB (IDBFactory-shaped) instance,
  // not a getItem/setItem Storage-shaped fake, so there is no raw
  // localStorage["clients"] string to JSON.parse (see ChildrenRepository's
  // equivalent PHASE 13.6 fix). Read the object store back through the
  // same DatabaseService/IndexedDBAdapter pair the Repository itself
  // uses instead.
  await (async () => {
    const readBackAdapter = createClientsLocalStorageAdapter(fake);
    const persisted = await readBackAdapter.read('clients');
    check('persisted "clients" object store is a plain array of records, exactly like index.html expects', () => {
      assert.ok(Array.isArray(persisted));
      assert.ok(persisted.length > 0);
    });
  })();

  await (async () => {
    const repo2 = new ClientsRepository({ storageAdapter: createClientsLocalStorageAdapter(fake) });
    await repo2.open();
    check('a second ClientsRepository instance opening the same storage sees identical data (no data loss across "reload")', () => {
      assert.deepStrictEqual(
        repo2.getAll({ includeDeleted: true }).map(r => r['رقم_الموكل']).sort(),
        repo.getAll({ includeDeleted: true }).map(r => r['رقم_الموكل']).sort()
      );
    });
  })();

  // 15. Empty repository behavior (distinct instance, distinct key)
  await (async () => {
    const emptyFake = makeFakeStorage({});
    const emptyRepo = new ClientsRepository({ storageAdapter: createClientsLocalStorageAdapter(emptyFake) });
    await emptyRepo.open();
    check('Empty repository: getAll()/count()/search() behave correctly with zero records', () => {
      assert.deepStrictEqual(emptyRepo.getAll(), []);
      assert.strictEqual(emptyRepo.count(), 0);
      assert.deepStrictEqual(emptyRepo.search({ search: 'anything' }).items, []);
      assert.strictEqual(emptyRepo.exists('x'), false);
      assert.strictEqual(emptyRepo.get('x'), null);
    });
  })();

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
