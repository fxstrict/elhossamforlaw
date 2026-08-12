/**
 * verify_process_server_works_repository.js
 * Standalone Node harness for ProcessServerWorksRepository (PHASE 38 —
 * Process Server Works Module / أعمال المحضرين).
 * Run: node verify_process_server_works_repository.js
 * No browser required.
 *
 * Directly mirrors js/tests/verify_opponents_repository.js's structure
 * (same FakeIndexedDB double, same check()/log()/summary harness),
 * adapted field-for-field to Process Server Works' own id (رقم_العمل),
 * required field (رقم_الموكل — the client link, since every work must
 * belong to a client), and legacy search-field set.
 */

const assert = require('assert');
const path = require('path');

const { Repository } = require(path.join(__dirname, '..', 'core', 'Repository.js'));
const { ProcessServerWorksRepository, createProcessServerWorksLocalStorageAdapter } =
  require(path.join(__dirname, '..', 'repositories', 'ProcessServerWorksRepository.js'));
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
  check('ProcessServerWorksRepository is a function / class', () => {
    assert.strictEqual(typeof ProcessServerWorksRepository, 'function');
  });

  check('ProcessServerWorksRepository extends the shared Repository base class', () => {
    const fake = makeFakeStorage();
    const repo = new ProcessServerWorksRepository({ storageAdapter: createProcessServerWorksLocalStorageAdapter(fake) });
    assert.ok(repo instanceof Repository);
  });

  // 2. Fresh/empty state
  await (async () => {
    const fake = makeFakeStorage();
    const repo = new ProcessServerWorksRepository({ storageAdapter: createProcessServerWorksLocalStorageAdapter(fake) });
    await repo.open();
    check('open() on an empty store starts with zero records, no throw', () => {
      assert.deepStrictEqual(repo.getAll(), []);
    });
  })();

  // 3. Reopen / persistence across instances (same FakeIndexedDB)
  let repo;
  const fake = makeFakeStorage();

  await (async () => {
    const seedRepo = new ProcessServerWorksRepository({ storageAdapter: createProcessServerWorksLocalStorageAdapter(fake) });
    await seedRepo.open();
    await seedRepo.create({
      'رقم_العمل': 'legacy1', 'رقم_الموكل': 'client-legacy', 'اسم_الموكل': 'محمود عبدالله',
      'طبيعة_الاعلان': 'اعادة اعلان', 'المحكمة': 'محكمة أسكندرية الجزئية', 'الحالة': 'غير مستلم'
    });

    repo = new ProcessServerWorksRepository({ storageAdapter: createProcessServerWorksLocalStorageAdapter(fake) });
    await repo.open();
    check('open() loads existing ("legacy") data unchanged after a reopen', () => {
      const all = repo.getAll();
      assert.strictEqual(all.length, 1);
      assert.strictEqual(all[0]['اسم_الموكل'], 'محمود عبدالله');
      assert.strictEqual(all[0]['رقم_العمل'], 'legacy1');
    });
  })();

  check('getAll() returns a copy, not a live reference', () => {
    const a = repo.getAll();
    a[0]['اسم_الموكل'] = 'MUTATED';
    const b = repo.getAll();
    assert.strictEqual(b[0]['اسم_الموكل'], 'محمود عبدالله');
  });

  // 4. Validation — only رقم_الموكل (the client link) is required, since
  // every Process Server Work must belong to exactly one client.
  check('validate() rejects missing رقم_الموكل', () => {
    const r = repo.validate({ 'طبيعة_الاعلان': 'اعلان بدون موكل' });
    assert.strictEqual(r.valid, false);
    assert.strictEqual(r.errors[0].field, 'رقم_الموكل');
  });

  check('validate() accepts a record with رقم_الموكل non-empty', () => {
    const r = repo.validate({ 'رقم_الموكل': 'client-x' });
    assert.strictEqual(r.valid, true);
  });

  check('validate() rejects whitespace-only رقم_الموكل', () => {
    const r = repo.validate({ 'رقم_الموكل': '   ' });
    assert.strictEqual(r.valid, false);
  });

  check('validate() does NOT require طبيعة_الاعلان/المحكمة/etc. (only رقم_الموكل is mandatory)', () => {
    const r = repo.validate({ 'رقم_الموكل': 'client-x' });
    assert.strictEqual(r.valid, true);
  });

  // 5. Insert / create — hybrid id generation
  let insertedId;
  await (async () => {
    const res = await repo.insert({ 'رقم_الموكل': 'client-1', 'اسم_الموكل': 'إبراهيم كامل', 'طبيعة_الاعلان': 'تكليف بالحضور' });
    check('insert() adds a new process-server work, auto-generating رقم_العمل when absent', () => {
      assert.strictEqual(res.success, true);
      assert.ok(res.record['رقم_العمل'], 'expected a generated رقم_العمل');
      assert.strictEqual(res.record['اسم_الموكل'], 'إبراهيم كامل');
      insertedId = res.record['رقم_العمل'];
    });
  })();

  await (async () => {
    const res = await repo.insert({ 'رقم_العمل': 'explicit-id-1', 'رقم_الموكل': 'client-2', 'اسم_الموكل': 'شركة الفجر للمقاولات', 'الحالة': 'مستلم' });
    check('insert() preserves a caller-supplied رقم_العمل instead of overwriting it', () => {
      assert.strictEqual(res.success, true);
      assert.strictEqual(res.record['رقم_العمل'], 'explicit-id-1');
    });
  })();

  await (async () => {
    const res = await repo.insert({ 'رقم_العمل': 'explicit-id-1', 'رقم_الموكل': 'client-2' });
    check('insert() rejects a duplicate رقم_العمل (uniqueness enforced by base class idField)', () => {
      assert.strictEqual(res.success, false);
      assert.strictEqual(res.error.type, 'ConflictError');
    });
  })();

  await (async () => {
    const res = await repo.insert({ 'طبيعة_الاعلان': 'اعلان بدون موكل' }); // missing رقم_الموكل
    check('insert() rejects invalid record (missing required client link) before touching storage', () => {
      assert.strictEqual(res.success, false);
      assert.strictEqual(res.error.type, 'ValidationError');
    });
  })();

  // 6. Extended fields round-trip (documents JSON column + tri-state
  // portal visibility) — same convention as Opponents' phones/addresses.
  await (async () => {
    const docs = JSON.stringify([{ name: 'صورة الإعلان', fileUrl: 'https://drive.google.com/file/x', fileId: 'x', uploadedAt: '2026-08-12T00:00:00.000Z' }]);
    const res = await repo.insert({
      'رقم_الموكل': 'client-3',
      'اسم_الموكل': 'كريم عادل',
      'المستندات': docs,
      'ظهور_في_بوابة_الموكل': 'بيانات_ومستندات'
    });
    check('create() round-trips the JSON المستندات column unchanged (same pattern as Opponents الموسّعة fields)', () => {
      assert.strictEqual(res.success, true);
      assert.strictEqual(res.record['المستندات'], docs);
      assert.strictEqual(res.record['ظهور_في_بوابة_الموكل'], 'بيانات_ومستندات');
      const parsedDocs = JSON.parse(repo.get(res.record['رقم_العمل'])['المستندات']);
      assert.strictEqual(parsedDocs[0].name, 'صورة الإعلان');
    });
  })();

  // 7. get / exists
  check('get(id) returns the process-server work by رقم_العمل', () => {
    const w = repo.get(insertedId);
    assert.ok(w);
    assert.strictEqual(w['اسم_الموكل'], 'إبراهيم كامل');
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
    const res = await repo.update(insertedId, { 'الحالة': 'مستلم' });
    check('update(id, entity) merges fields and stamps updatedAt/version', () => {
      assert.strictEqual(res.success, true);
      assert.strictEqual(res.record['الحالة'], 'مستلم');
      assert.strictEqual(res.record['اسم_الموكل'], 'إبراهيم كامل');
      assert.strictEqual(res.record.version, 2);
      assert.ok(res.record.updatedAt);
    });
  })();

  await (async () => {
    const res = await repo.update(insertedId, { 'رقم_الموكل': '' });
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
    check('remove(id) soft-deletes by default (softDelete: true, matches OpponentsRepository/ClientsRepository)', () => {
      assert.strictEqual(res.success, true);
      assert.ok(res.record.deletedAt);
    });
  })();

  check('soft-deleted record excluded from default getAll()/get()', () => {
    assert.strictEqual(repo.get(insertedId), null);
    assert.strictEqual(repo.getAll().some(r => r['رقم_العمل'] === insertedId), false);
  });

  check('getAll({includeDeleted:true}) still returns the soft-deleted record', () => {
    const all = repo.getAll({ includeDeleted: true });
    assert.strictEqual(all.some(r => r['رقم_العمل'] === insertedId), true);
  });

  check('count() excludes the soft-deleted record after remove()', () => {
    assert.strictEqual(repo.count(), 3);
  });

  // 11. restore()
  await (async () => {
    const res = await repo.restore(insertedId);
    check('restore(id) brings a soft-deleted process-server work back', () => {
      assert.strictEqual(res.success, true);
      assert.strictEqual(repo.get(insertedId)['اسم_الموكل'], 'إبراهيم كامل');
    });
  })();

  // 12. Search
  check('search() free-text matches اسم_الموكل, case-insensitively', () => {
    const result = repo.search({ search: 'الفجر' });
    assert.strictEqual(result.items.length, 1);
    assert.strictEqual(result.items[0]['اسم_الموكل'], 'شركة الفجر للمقاولات');
  });

  check('search() free-text matches المحكمة', () => {
    const result = repo.search({ search: 'أسكندرية الجزئية' });
    assert.strictEqual(result.items.length, 1);
    assert.strictEqual(result.items[0]['رقم_العمل'], 'legacy1');
  });

  check('search() does NOT match against new audit/metadata fields (checksum/version etc.)', () => {
    const target = repo.get('explicit-id-1');
    const result = repo.search({ search: String(target.checksum) });
    assert.strictEqual(result.items.length, 0);
  });

  // 13. Filter
  check('filter() by الحالة matches exactly like the tab filter (الكل/مستلم/غير مستلم) would', () => {
    // Note: insertedId (إبراهيم كامل) was also updated to 'مستلم' in the
    // update() check above, alongside explicit-id-1 (شركة الفجر) which
    // was seeded as 'مستلم' — so two records legitimately match here.
    const received = repo.filter({ 'الحالة': 'مستلم' });
    assert.strictEqual(received.length, 2);
    assert.ok(received.some(r => r['اسم_الموكل'] === 'شركة الفجر للمقاولات'));
    assert.ok(received.some(r => r['اسم_الموكل'] === 'إبراهيم كامل'));
  });

  check('filter() by رقم_الموكل scopes works to a single client', () => {
    const mine = repo.filter({ 'رقم_الموكل': 'client-1' });
    assert.strictEqual(mine.length, 1);
    assert.strictEqual(mine[0]['اسم_الموكل'], 'إبراهيم كامل');
  });

  // 14. Sort
  check('sort() orders by تاريخ_الإنشاء descending by default (newest first)', () => {
    const sorted = repo.sort();
    for (let i = 1; i < sorted.length; i++) {
      assert.ok(String(sorted[i - 1]['تاريخ_الإنشاء'] || '') >= String(sorted[i]['تاريخ_الإنشاء'] || ''));
    }
  });

  check('sort() accepts an explicit sortSpec and array of records without mutating input', () => {
    const input = repo.getAll();
    const inputCopy = JSON.parse(JSON.stringify(input));
    const sorted = repo.sort(input, { field: 'اسم_الموكل', direction: 'asc' });
    assert.deepStrictEqual(input, inputCopy);
    for (let i = 1; i < sorted.length; i++) {
      assert.ok(String(sorted[i - 1]['اسم_الموكل']) <= String(sorted[i]['اسم_الموكل']));
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

  // 16. Storage-format round-trip — 'processServerWorks' store is
  // independent of 'clients'/'cases'/'opponents' (no key/entity
  // collision — the whole point of Phase 38's requirement not to harm
  // any previously-stored data).
  await (async () => {
    const readBackAdapter = createProcessServerWorksLocalStorageAdapter(fake);
    const persisted = await readBackAdapter.read('processServerWorks');
    check('persisted "processServerWorks" object store is a plain array of records, independent of "clients"/"cases"/"opponents"', () => {
      assert.ok(Array.isArray(persisted));
      assert.ok(persisted.length > 0);
    });
  })();

  await (async () => {
    const repo2 = new ProcessServerWorksRepository({ storageAdapter: createProcessServerWorksLocalStorageAdapter(fake) });
    await repo2.open();
    check('a second ProcessServerWorksRepository instance opening the same storage sees identical data (no data loss across "reload")', () => {
      assert.deepStrictEqual(
        repo2.getAll({ includeDeleted: true }).map(r => r['رقم_العمل']).sort(),
        repo.getAll({ includeDeleted: true }).map(r => r['رقم_العمل']).sort()
      );
    });
  })();

  // 17. Empty repository behavior (distinct instance, distinct key)
  await (async () => {
    const emptyFake = makeFakeStorage();
    const emptyRepo = new ProcessServerWorksRepository({ storageAdapter: createProcessServerWorksLocalStorageAdapter(emptyFake) });
    await emptyRepo.open();
    check('Empty repository: getAll()/count()/search() behave correctly with zero records', () => {
      assert.deepStrictEqual(emptyRepo.getAll(), []);
      assert.strictEqual(emptyRepo.count(), 0);
      assert.deepStrictEqual(emptyRepo.search({ search: 'anything' }).items, []);
      assert.strictEqual(emptyRepo.exists('x'), false);
      assert.strictEqual(emptyRepo.get('x'), null);
    });
  })();

  // 18. Cross-entity isolation — ProcessServerWorks, Opponents, and
  // Clients stores opened against the SAME underlying FakeIndexedDB
  // never see each other's records (verifies IndexedDBSchema's
  // additive 'processServerWorks' store definition never collides with
  // 'opponents'/'clients' — the exact same guarantee Phase 37 verified
  // for Opponents<->Clients).
  await (async () => {
    const { ClientsRepository, createClientsLocalStorageAdapter } =
      require(path.join(__dirname, '..', 'repositories', 'ClientsRepository.js'));
    const { OpponentsRepository, createOpponentsLocalStorageAdapter } =
      require(path.join(__dirname, '..', 'repositories', 'OpponentsRepository.js'));
    const sharedFake = makeFakeStorage();
    const psw = new ProcessServerWorksRepository({ storageAdapter: createProcessServerWorksLocalStorageAdapter(sharedFake) });
    const opp = new OpponentsRepository({ storageAdapter: createOpponentsLocalStorageAdapter(sharedFake) });
    const cli = new ClientsRepository({ storageAdapter: createClientsLocalStorageAdapter(sharedFake) });
    await psw.open();
    await opp.open();
    await cli.open();
    await psw.insert({ 'رقم_الموكل': 'x', 'اسم_الموكل': 'عمل محضرين فقط' });
    await opp.insert({ 'الاسم': 'خصم فقط' });
    await cli.insert({ 'الاسم': 'موكل فقط' });
    check('ProcessServerWorksRepository, OpponentsRepository and ClientsRepository against the same IndexedDB never cross-read each other\'s records', () => {
      assert.strictEqual(psw.getAll().length, 1);
      assert.strictEqual(psw.getAll()[0]['اسم_الموكل'], 'عمل محضرين فقط');
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
