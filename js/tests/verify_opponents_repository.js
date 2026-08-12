/**
 * verify_opponents_repository.js
 * Standalone Node harness for OpponentsRepository (PHASE 37 — Opponents
 * Module). Run: node verify_opponents_repository.js
 * No browser required.
 *
 * Directly mirrors js/tests/verify_clients_repository.js's structure
 * (same FakeIndexedDB double, same check()/log()/summary harness),
 * adapted field-for-field to Opponents' own id (رقم_الخصم), required
 * field (الاسم), and legacy search-field set.
 */

const assert = require('assert');
const path = require('path');

const { Repository } = require(path.join(__dirname, '..', 'core', 'Repository.js'));
const { OpponentsRepository, createOpponentsLocalStorageAdapter } =
  require(path.join(__dirname, '..', 'repositories', 'OpponentsRepository.js'));
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

function makeFakeStorage() {
  return new FakeIndexedDB();
}

async function main() {

  // 1. Class existence
  check('OpponentsRepository is a function / class', () => {
    assert.strictEqual(typeof OpponentsRepository, 'function');
  });

  check('OpponentsRepository extends the shared Repository base class', () => {
    const fake = makeFakeStorage();
    const repo = new OpponentsRepository({ storageAdapter: createOpponentsLocalStorageAdapter(fake) });
    assert.ok(repo instanceof Repository);
  });

  // 2. Fresh/empty state
  await (async () => {
    const fake = makeFakeStorage();
    const repo = new OpponentsRepository({ storageAdapter: createOpponentsLocalStorageAdapter(fake) });
    await repo.open();
    check('open() on an empty store starts with zero records, no throw', () => {
      assert.deepStrictEqual(repo.getAll(), []);
    });
  })();

  // 3. Reopen / persistence across instances (same FakeIndexedDB)
  let repo;
  const fake = makeFakeStorage();

  await (async () => {
    const seedRepo = new OpponentsRepository({ storageAdapter: createOpponentsLocalStorageAdapter(fake) });
    await seedRepo.open();
    await seedRepo.create({ 'رقم_الخصم': 'legacy1', 'الاسم': 'محمود عبدالله', 'النوع': 'شخص طبيعي', 'الرقم_القومي': '29001011234567' });

    repo = new OpponentsRepository({ storageAdapter: createOpponentsLocalStorageAdapter(fake) });
    await repo.open();
    check('open() loads existing ("legacy") data unchanged after a reopen', () => {
      const all = repo.getAll();
      assert.strictEqual(all.length, 1);
      assert.strictEqual(all[0]['الاسم'], 'محمود عبدالله');
      assert.strictEqual(all[0]['رقم_الخصم'], 'legacy1');
    });
  })();

  check('getAll() returns a copy, not a live reference', () => {
    const a = repo.getAll();
    a[0]['الاسم'] = 'MUTATED';
    const b = repo.getAll();
    assert.strictEqual(b[0]['الاسم'], 'محمود عبدالله');
  });

  // 4. Validation — only اسم الخصم is required
  check('validate() rejects missing الاسم', () => {
    const r = repo.validate({ 'النوع': 'شخص طبيعي' });
    assert.strictEqual(r.valid, false);
    assert.strictEqual(r.errors[0].field, 'الاسم');
  });

  check('validate() accepts a record with الاسم non-empty', () => {
    const r = repo.validate({ 'الاسم': 'سيد محمد' });
    assert.strictEqual(r.valid, true);
  });

  check('validate() rejects whitespace-only الاسم', () => {
    const r = repo.validate({ 'الاسم': '   ' });
    assert.strictEqual(r.valid, false);
  });

  check('validate() does NOT require النوع/الرقم_القومي/الجنسية/etc. (only الاسم is mandatory)', () => {
    const r = repo.validate({ 'الاسم': 'خصم بلا بيانات إضافية' });
    assert.strictEqual(r.valid, true);
  });

  // 5. Insert / create — hybrid id generation
  let insertedId;
  await (async () => {
    const res = await repo.insert({ 'الاسم': 'إبراهيم كامل', 'النوع': 'شخص طبيعي' });
    check('insert() adds a new opponent, auto-generating رقم_الخصم when absent', () => {
      assert.strictEqual(res.success, true);
      assert.ok(res.record['رقم_الخصم'], 'expected a generated رقم_الخصم');
      assert.strictEqual(res.record['الاسم'], 'إبراهيم كامل');
      insertedId = res.record['رقم_الخصم'];
    });
  })();

  await (async () => {
    const res = await repo.insert({ 'رقم_الخصم': 'explicit-id-1', 'الاسم': 'شركة الفجر للمقاولات', 'النوع': 'شخص اعتباري' });
    check('insert() preserves a caller-supplied رقم_الخصم instead of overwriting it', () => {
      assert.strictEqual(res.success, true);
      assert.strictEqual(res.record['رقم_الخصم'], 'explicit-id-1');
    });
  })();

  await (async () => {
    const res = await repo.insert({ 'رقم_الخصم': 'explicit-id-1', 'الاسم': 'تكرار' });
    check('insert() rejects a duplicate رقم_الخصم (uniqueness enforced by base class idField)', () => {
      assert.strictEqual(res.success, false);
      assert.strictEqual(res.error.type, 'ConflictError');
    });
  })();

  await (async () => {
    const res = await repo.insert({ 'النوع': 'شخص طبيعي' }); // missing الاسم
    check('insert() rejects invalid record (missing required field) before touching storage', () => {
      assert.strictEqual(res.success, false);
      assert.strictEqual(res.error.type, 'ValidationError');
    });
  })();

  // 6. Extended fields round-trip (phones/addresses JSON columns)
  await (async () => {
    const phones = JSON.stringify([{ type: 'موبايل', number: '01099998888' }]);
    const addresses = JSON.stringify([{ type: 'منزل', detail: 'القاهرة - مدينة نصر' }]);
    const res = await repo.insert({
      'الاسم': 'كريم عادل',
      'أرقام_الهواتف': phones,
      'العناوين': addresses
    });
    check('create() round-trips the JSON phones/addresses columns unchanged (same pattern as Clients الموسّعة fields)', () => {
      assert.strictEqual(res.success, true);
      assert.strictEqual(res.record['أرقام_الهواتف'], phones);
      assert.strictEqual(res.record['العناوين'], addresses);
      const parsedPhones = JSON.parse(repo.get(res.record['رقم_الخصم'])['أرقام_الهواتف']);
      assert.strictEqual(parsedPhones[0].number, '01099998888');
    });
  })();

  // 7. get / exists
  check('get(id) returns the opponent by رقم_الخصم', () => {
    const o = repo.get(insertedId);
    assert.ok(o);
    assert.strictEqual(o['الاسم'], 'إبراهيم كامل');
  });

  check('get(id) returns null for unknown id', () => {
    assert.strictEqual(repo.get('no-such-id'), null);
  });

  check('exists(id) true/false', () => {
    assert.strictEqual(repo.exists(insertedId), true);
    assert.strictEqual(repo.exists('no-such-id'), false);
  });

  // 8. update
  await (async () => {
    const res = await repo.update(insertedId, { 'الوظيفة': 'تاجر' });
    check('update(id, entity) merges fields and stamps updatedAt/version', () => {
      assert.strictEqual(res.success, true);
      assert.strictEqual(res.record['الوظيفة'], 'تاجر');
      assert.strictEqual(res.record['الاسم'], 'إبراهيم كامل');
      assert.strictEqual(res.record.version, 2);
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

  // 9. count baseline — legacy1 + إبراهيم + شركة الفجر + كريم = 4
  check('count() reflects current non-deleted record count', () => {
    assert.strictEqual(repo.count(), 4);
  });

  // 10. remove / delete — soft delete
  await (async () => {
    const res = await repo.remove(insertedId);
    check('remove(id) soft-deletes by default (softDelete: true, matches ClientsRepository)', () => {
      assert.strictEqual(res.success, true);
      assert.ok(res.record.deletedAt);
    });
  })();

  check('soft-deleted record excluded from default getAll()/get()', () => {
    assert.strictEqual(repo.get(insertedId), null);
    assert.strictEqual(repo.getAll().some(r => r['رقم_الخصم'] === insertedId), false);
  });

  check('getAll({includeDeleted:true}) still returns the soft-deleted record', () => {
    const all = repo.getAll({ includeDeleted: true });
    assert.strictEqual(all.some(r => r['رقم_الخصم'] === insertedId), true);
  });

  check('count() excludes the soft-deleted record after remove()', () => {
    assert.strictEqual(repo.count(), 3);
  });

  // 11. restore()
  await (async () => {
    const res = await repo.restore(insertedId);
    check('restore(id) brings a soft-deleted opponent back', () => {
      assert.strictEqual(res.success, true);
      assert.strictEqual(repo.get(insertedId)['الاسم'], 'إبراهيم كامل');
    });
  })();

  // 12. Search
  check('search() free-text matches الاسم, case-insensitively', () => {
    const result = repo.search({ search: 'الفجر' });
    assert.strictEqual(result.items.length, 1);
    assert.strictEqual(result.items[0]['الاسم'], 'شركة الفجر للمقاولات');
  });

  check('search() free-text matches الرقم_القومي', () => {
    const result = repo.search({ search: '29001011234567' });
    assert.strictEqual(result.items.length, 1);
    assert.strictEqual(result.items[0]['رقم_الخصم'], 'legacy1');
  });

  check('search() does NOT match against new audit/metadata fields (checksum/version etc.)', () => {
    const target = repo.get('explicit-id-1');
    const result = repo.search({ search: String(target.checksum) });
    assert.strictEqual(result.items.length, 0);
  });

  // 13. Filter
  check('filter() by النوع matches exactly like the نوع الخصم dropdown would', () => {
    const companies = repo.filter({ 'النوع': 'شخص اعتباري' });
    assert.strictEqual(companies.length, 1);
    assert.strictEqual(companies[0]['الاسم'], 'شركة الفجر للمقاولات');
  });

  // 14. Sort
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
    assert.deepStrictEqual(input, inputCopy);
    for (let i = 1; i < sorted.length; i++) {
      assert.ok(String(sorted[i - 1]['الاسم']) >= String(sorted[i]['الاسم']));
    }
  });

  // 15. Repository Interface
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

  check('getAll/get/exists/count/find/bulkInsert/bulkUpdate/bulkDelete/export/import/clear/transaction/restore all present', () => {
    ['getAll', 'get', 'exists', 'count', 'find', 'bulkInsert', 'bulkUpdate',
      'bulkDelete', 'export', 'import', 'clear', 'transaction', 'restore'].forEach(m => {
      assert.strictEqual(typeof repo[m], 'function', m + ' missing');
    });
  });

  // 16. Storage-format round-trip — 'opponents' store is independent of
  // 'clients' (no key/entity collision — the whole point of Phase 37's
  // "دون أى تعارض مع باقي الجداول" requirement).
  await (async () => {
    const readBackAdapter = createOpponentsLocalStorageAdapter(fake);
    const persisted = await readBackAdapter.read('opponents');
    check('persisted "opponents" object store is a plain array of records, independent of "clients"', () => {
      assert.ok(Array.isArray(persisted));
      assert.ok(persisted.length > 0);
    });
  })();

  await (async () => {
    const repo2 = new OpponentsRepository({ storageAdapter: createOpponentsLocalStorageAdapter(fake) });
    await repo2.open();
    check('a second OpponentsRepository instance opening the same storage sees identical data (no data loss across "reload")', () => {
      assert.deepStrictEqual(
        repo2.getAll({ includeDeleted: true }).map(r => r['رقم_الخصم']).sort(),
        repo.getAll({ includeDeleted: true }).map(r => r['رقم_الخصم']).sort()
      );
    });
  })();

  // 17. Empty repository behavior (distinct instance, distinct key)
  await (async () => {
    const emptyFake = makeFakeStorage();
    const emptyRepo = new OpponentsRepository({ storageAdapter: createOpponentsLocalStorageAdapter(emptyFake) });
    await emptyRepo.open();
    check('Empty repository: getAll()/count()/search() behave correctly with zero records', () => {
      assert.deepStrictEqual(emptyRepo.getAll(), []);
      assert.strictEqual(emptyRepo.count(), 0);
      assert.deepStrictEqual(emptyRepo.search({ search: 'anything' }).items, []);
      assert.strictEqual(emptyRepo.exists('x'), false);
      assert.strictEqual(emptyRepo.get('x'), null);
    });
  })();

  // 18. Cross-entity isolation — Opponents and Clients stores opened
  // against the SAME underlying FakeIndexedDB never see each other's
  // records (verifies IndexedDBSchema's additive 'opponents' store
  // definition never collides with 'clients').
  await (async () => {
    const { ClientsRepository, createClientsLocalStorageAdapter } =
      require(path.join(__dirname, '..', 'repositories', 'ClientsRepository.js'));
    const sharedFake = makeFakeStorage();
    const opp = new OpponentsRepository({ storageAdapter: createOpponentsLocalStorageAdapter(sharedFake) });
    const cli = new ClientsRepository({ storageAdapter: createClientsLocalStorageAdapter(sharedFake) });
    await opp.open();
    await cli.open();
    await opp.insert({ 'الاسم': 'خصم فقط' });
    await cli.insert({ 'الاسم': 'موكل فقط' });
    check('OpponentsRepository and ClientsRepository against the same IndexedDB never cross-read each other\'s records', () => {
      assert.strictEqual(opp.getAll().length, 1);
      assert.strictEqual(opp.getAll()[0]['الاسم'], 'خصم فقط');
      assert.strictEqual(cli.getAll().length, 1);
      assert.strictEqual(cli.getAll()[0]['الاسم'], 'موكل فقط');
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
