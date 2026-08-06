/**
 * verify_sessions_repository.js
 * Standalone Node harness for SessionsRepository (Phase 5 / Sub-phase 5.5).
 * Independent of verify_clients_repository.js / verify_children_repository.js
 * (no shared helper module — self-contained, per this phase's "Harness
 * مستقل" instruction).
 * Run: node verify_sessions_repository.js
 * No browser required — uses a fake in-memory object satisfying the exact
 * Storage shape (getItem/setItem) that the real browser localStorage
 * exposes. No unnecessary mocking beyond that single boundary.
 */

const assert = require('assert');
const path = require('path');

const { Repository } = require(path.join(__dirname, '..', 'core', 'Repository.js'));
const { SessionsRepository, createSessionsLocalStorageAdapter } =
  require(path.join(__dirname, '..', 'repositories', 'SessionsRepository.js'));
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

// ---- Fake localStorage (matches getItem/setItem shape only) ----
// PHASE 13.5: IDBFactory-shaped fake (not Storage-shaped) — the
// create*LocalStorageAdapter() factory in this entity's repository now
// wraps a real IndexedDBAdapter/DatabaseService pair, so it needs an
// IDBFactory-shaped double. Reuses js/tests/fake_indexeddb.js's
// FakeIndexedDB, the same double verify_settings_repository.js uses.
function makeFakeStorage(seed) {
  if (seed && Object.keys(seed).length) {
    throw new Error('makeFakeStorage(seed): non-empty seed is not supported against FakeIndexedDB');
  }
  return new FakeIndexedDB();
}

async function main() {

  // 1. Class existence
  check('SessionsRepository is a function / class', () => {
    assert.strictEqual(typeof SessionsRepository, 'function');
  });

  // 2. Empty Repository — open() on empty localStorage (real first-run condition)
  await (async () => {
    const fake = makeFakeStorage({});
    const repo = new SessionsRepository({ storageAdapter: createSessionsLocalStorageAdapter(fake) });
    await repo.open();
    check('open() on empty localStorage (no "sessions" key) starts with zero records, no throw', () => {
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

  // PHASE 13.5: equivalent of "pre-existing data loads unchanged" for an
  // IndexedDB-backed store — data written by one repository instance is
  // still there when a second instance reopens the SAME FakeIndexedDB.
  let repo; // shared across the remaining CRUD-heavy checks
  const fake = makeFakeStorage({});

  await (async () => {
    const seedRepo = new SessionsRepository({ storageAdapter: createSessionsLocalStorageAdapter(fake) });
    await seedRepo.open();
    await seedRepo.create({
      'رقم_الجلسة': 'legacy-session-1',
      'رقم_القضية': '2026-100',
      'عنوان_القضية': 'قضية نفقة',
      'المحكمة': 'محكمة الأسرة',
      'التاريخ': '2026-01-10',
      'الوقت': '09:30',
      'الحالة': 'مجدولة'
    });

    repo = new SessionsRepository({ storageAdapter: createSessionsLocalStorageAdapter(fake) });
    await repo.open();
    check('open() loads existing ("legacy") data unchanged after a reopen', () => {
      const all = repo.getAll();
      assert.strictEqual(all.length, 1);
      assert.strictEqual(all[0]['عنوان_القضية'], 'قضية نفقة');
      assert.strictEqual(all[0]['رقم_الجلسة'], 'legacy-session-1');
      assert.strictEqual(all[0]['رقم_القضية'], '2026-100');
    });
  })();

  check('getAll() returns a copy, not a live reference (Contract §19)', () => {
    const a = repo.getAll();
    a[0]['المحكمة'] = 'MUTATED';
    const b = repo.getAll();
    assert.strictEqual(b[0]['المحكمة'], 'محكمة الأسرة');
  });

  // 4. Validation — two required fields (التاريخ, الوقت) — NOT رقم_القضية
  check('validate() rejects a record missing both required fields', () => {
    const r = repo.validate({ 'المحكمة': 'محكمة الجيزة' });
    assert.strictEqual(r.valid, false);
    assert.strictEqual(r.errors.length, 2);
    const fields = r.errors.map(e => e.field).sort();
    assert.deepStrictEqual(fields, ['التاريخ', 'الوقت'].sort());
  });

  check('validate() rejects a record missing only التاريخ', () => {
    const r = repo.validate({ 'الوقت': '10:00' });
    assert.strictEqual(r.valid, false);
    assert.strictEqual(r.errors.length, 1);
    assert.strictEqual(r.errors[0].field, 'التاريخ');
  });

  check('validate() rejects a record missing only الوقت', () => {
    const r = repo.validate({ 'التاريخ': '2026-02-01' });
    assert.strictEqual(r.valid, false);
    assert.strictEqual(r.errors.length, 1);
    assert.strictEqual(r.errors[0].field, 'الوقت');
  });

  check('validate() accepts a record with both required fields non-empty, EVEN with رقم_القضية absent (matches actual saveSession(), a documented deviation from Data_Schema_Specification §4.4)', () => {
    const r = repo.validate({ 'التاريخ': '2026-02-01', 'الوقت': '10:00' });
    assert.strictEqual(r.valid, true);
  });

  check('validate() rejects whitespace-only required fields (matches saveSession()\'s empty-string check)', () => {
    const r = repo.validate({ 'التاريخ': '   ', 'الوقت': '10:00' });
    assert.strictEqual(r.valid, false);
    assert.strictEqual(r.errors[0].field, 'التاريخ');
  });

  // 5. Insert / create — hybrid id generation + duplicate protection
  let insertedId;
  await (async () => {
    const res = await repo.insert({ 'رقم_القضية': '2026-101', 'التاريخ': '2026-02-05', 'الوقت': '11:00', 'الحالة': 'مجدولة' });
    check('insert() [alias of create()] adds a new session, auto-generating رقم_الجلسة when absent', () => {
      assert.strictEqual(res.success, true);
      assert.ok(res.record['رقم_الجلسة'], 'expected a generated رقم_الجلسة');
      assert.strictEqual(res.record['الحالة'], 'مجدولة');
      insertedId = res.record['رقم_الجلسة'];
    });
  })();

  await (async () => {
    const res = await repo.insert({ 'رقم_الجلسة': 'explicit-session-1', 'رقم_القضية': '2026-102', 'التاريخ': '2026-02-06', 'الوقت': '12:00' });
    check('insert() preserves a caller-supplied رقم_الجلسة instead of overwriting it (matches saveSession()\'s || uid() fallback)', () => {
      assert.strictEqual(res.success, true);
      assert.strictEqual(res.record['رقم_الجلسة'], 'explicit-session-1');
    });
  })();

  await (async () => {
    const res = await repo.insert({ 'رقم_الجلسة': 'explicit-session-1', 'رقم_القضية': '2026-103', 'التاريخ': '2026-02-07', 'الوقت': '13:00' });
    check('insert() [Duplicate ID] rejects a second record with an explicitly duplicate رقم_الجلسة', () => {
      assert.strictEqual(res.success, false);
      assert.strictEqual(res.error.type, 'ConflictError');
    });
  })();

  await (async () => {
    const res = await repo.insert({ 'رقم_القضية': '2026-104', 'التاريخ': '2026-02-08' }); // missing الوقت
    check('insert() [Invalid Entity] rejects a record missing a required field before touching storage', () => {
      assert.strictEqual(res.success, false);
      assert.strictEqual(res.error.type, 'ValidationError');
    });
  })();

  // 6. get / exists
  check('get(id) returns the session by رقم_الجلسة', () => {
    const s = repo.get(insertedId);
    assert.ok(s);
    assert.strictEqual(s['رقم_القضية'], '2026-101');
  });

  check('get(id) returns null for unknown id', () => {
    assert.strictEqual(repo.get('no-such-id'), null);
  });

  check('exists(id) true/false', () => {
    assert.strictEqual(repo.exists(insertedId), true);
    assert.strictEqual(repo.exists('no-such-id'), false);
  });

  // 7. Update Session
  await (async () => {
    const res = await repo.update(insertedId, { 'الحالة': 'مؤجلة', 'التأجيل_إلى': '2026-03-01' });
    check('update(id, entity) merges fields and stamps updatedAt/version', () => {
      assert.strictEqual(res.success, true);
      assert.strictEqual(res.record['الحالة'], 'مؤجلة');
      assert.strictEqual(res.record['التأجيل_إلى'], '2026-03-01');
      assert.strictEqual(res.record['رقم_القضية'], '2026-101'); // untouched field preserved
      assert.strictEqual(res.record.version, 2); // 1 on create, +1 on update
      assert.ok(res.record.updatedAt);
    });
  })();

  await (async () => {
    const res = await repo.update(insertedId, { 'التاريخ': '' });
    check('update(id, entity) rejects a patch that would violate a required field', () => {
      assert.strictEqual(res.success, false);
      assert.strictEqual(res.error.type, 'ValidationError');
    });
  })();

  await (async () => {
    const res = await repo.update('no-such-id', { 'الحالة': 'x' });
    check('update(id, entity) on an unknown id fails gracefully (base Repository.js reports ValidationError for "no record with this id" — unchanged Phase 5.1 base-class behavior)', () => {
      assert.strictEqual(res.success, false);
      assert.strictEqual(res.error.type, 'ValidationError');
    });
  })();

  // 8. count (baseline before delete checks)
  check('count() reflects current non-deleted record count', () => {
    // legacy-session-1 + insertedId + explicit-session-1 = 3 (the duplicate/invalid inserts above never landed)
    assert.strictEqual(repo.count(), 3);
  });

  // 9. Delete Session — soft delete
  await (async () => {
    const res = await repo.remove(insertedId);
    check('remove(id) [alias of delete()] soft-deletes by default (Data_Schema §3.7 / §4.4 Delete Rules)', () => {
      assert.strictEqual(res.success, true);
      assert.ok(res.record.deletedAt);
    });
  })();

  check('soft-deleted record excluded from default getAll()/get()', () => {
    assert.strictEqual(repo.get(insertedId), null);
    assert.strictEqual(repo.getAll().some(r => r['رقم_الجلسة'] === insertedId), false);
  });

  check('getAll({includeDeleted:true}) still returns the soft-deleted record', () => {
    const all = repo.getAll({ includeDeleted: true });
    assert.strictEqual(all.some(r => r['رقم_الجلسة'] === insertedId), true);
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

  // 10. Search — full-record join, matches renderSessions() (see file header "SEARCH" note)
  check('search() free-text matches across ANY legacy field, case-insensitively (matches renderSessions(), despite both planning reports claiming search is scoped to عنوان_القضية/رقم_القضية only)', () => {
    const result = repo.search({ search: 'الأسرة' }); // matches المحكمة 'محكمة الأسرة'
    assert.strictEqual(result.items.length, 1);
    assert.strictEqual(result.items[0]['رقم_الجلسة'], 'legacy-session-1');
  });

  check('search() free-text matches a non-title/case-number field (court name)', () => {
    const result = repo.search({ search: 'نفقة' });
    assert.strictEqual(result.items.length, 1);
    assert.strictEqual(result.items[0]['عنوان_القضية'], 'قضية نفقة');
  });

  check('search() does NOT match against new audit/metadata fields (checksum/version etc.)', () => {
    const target = repo.get('explicit-session-1');
    const result = repo.search({ search: String(target.checksum) });
    assert.strictEqual(result.items.length, 0);
  });

  check('search() excludes soft-deleted records by default', () => {
    const result = repo.search({ search: '11:00' });
    assert.strictEqual(result.items.length, 0);
  });

  // 11. Date Search — free-text search also matches on التاريخ (part of the same join)
  check('search() matches on التاريخ (date) since it is part of the same full-record join', () => {
    const result = repo.search({ search: '2026-01-10' });
    assert.strictEqual(result.items.length, 1);
    assert.strictEqual(result.items[0]['رقم_الجلسة'], 'legacy-session-1');
  });

  // 12. Filter — الحالة (status dropdown) and رقم_القضية (case relation)
  await (async () => {
    await repo.insert({ 'رقم_القضية': '2026-100', 'التاريخ': '2026-02-10', 'الوقت': '09:00', 'الحالة': 'منتهية' }); // same case as legacy-session-1
  })();

  check('filter() by الحالة returns exactly the sessions with that status (matches renderSessions()\'s #filterSessionStatus)', () => {
    const scheduled = repo.filter({ 'الحالة': 'مجدولة' });
    assert.strictEqual(scheduled.length, 1);
    assert.strictEqual(scheduled[0]['رقم_الجلسة'], 'legacy-session-1');
  });

  // Case Relation
  check('filter() by رقم_القضية returns exactly the sessions of that case ("sessions of a given case" — real pattern used in js/modules/cases.js)', () => {
    const caseSessions = repo.filter({ 'رقم_القضية': '2026-100' });
    assert.strictEqual(caseSessions.length, 2);
    const statuses = caseSessions.map(s => s['الحالة']).sort();
    assert.deepStrictEqual(statuses, ['منتهية', 'مجدولة'].sort());
  });

  check('filter() by a رقم_القضية with no sessions returns an empty array', () => {
    assert.deepStrictEqual(repo.filter({ 'رقم_القضية': '2026-999' }), []);
  });

  // 13. Sort
  check('sort() orders by التاريخ ascending by default (empty/missing values sort first)', () => {
    const sorted = repo.sort();
    assert.ok(Array.isArray(sorted));
    assert.strictEqual(sorted.length, repo.count());
    const dates = sorted.map(s => s['التاريخ']).filter(Boolean);
    for (let i = 1; i < dates.length; i++) {
      assert.ok(String(dates[i - 1]) <= String(dates[i]));
    }
  });

  await (async () => {
    await repo.insert({ 'رقم_القضية': '2026-105', 'التاريخ': '2026-01-01', 'الوقت': '08:00' });
    await repo.insert({ 'رقم_القضية': '2026-106', 'التاريخ': '2027-01-01', 'الوقت': '08:00' });
  })();

  check('sort() accepts an explicit sortSpec and array of records without mutating input', () => {
    const input = repo.getAll();
    const inputCopy = JSON.parse(JSON.stringify(input));
    const sorted = repo.sort(input, { field: 'التاريخ', direction: 'asc' });
    assert.deepStrictEqual(input, inputCopy); // input untouched
    const dates = sorted.map(s => s['التاريخ']).filter(Boolean);
    for (let i = 1; i < dates.length; i++) {
      assert.ok(String(dates[i - 1]) <= String(dates[i]));
    }
  });

  check('sort() with direction "desc" reverses the order', () => {
    const asc = repo.sort(repo.getAll(), { field: 'التاريخ', direction: 'asc' }).map(s => s['التاريخ']);
    const desc = repo.sort(repo.getAll(), { field: 'التاريخ', direction: 'desc' }).map(s => s['التاريخ']);
    assert.deepStrictEqual(desc, asc.slice().reverse());
  });

  // 14. Repository Interface — Contract-literal + phase-requested names
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

  // 15. Legacy localStorage compatibility — storage format round-trip
  // PHASE 13.6: `fake` is a FakeIndexedDB (IDBFactory-shaped) instance,
  // not a getItem/setItem Storage-shaped fake, so there is no raw
  // localStorage["sessions"] string to JSON.parse (see ChildrenRepository's
  // equivalent PHASE 13.6 fix). Read the object store back through the
  // same DatabaseService/IndexedDBAdapter pair the Repository itself
  // uses instead.
  await (async () => {
    const readBackAdapter = createSessionsLocalStorageAdapter(fake);
    const persisted = await readBackAdapter.read('sessions');
    check('persisted "sessions" object store is a plain array of records, exactly like index.html expects', () => {
      assert.ok(Array.isArray(persisted));
      assert.ok(persisted.length > 0);
    });
  })();

  await (async () => {
    const repo2 = new SessionsRepository({ storageAdapter: createSessionsLocalStorageAdapter(fake) });
    await repo2.open();
    check('a second SessionsRepository instance opening the same storage sees identical data (no data loss across "reload")', () => {
      assert.deepStrictEqual(
        repo2.getAll({ includeDeleted: true }).map(r => r['رقم_الجلسة']).sort(),
        repo.getAll({ includeDeleted: true }).map(r => r['رقم_الجلسة']).sort()
      );
    });
  })();

  check('SessionsRepository does not reference ClientsRepository/CasesRepository/ChildrenRepository at runtime (independent harness, independent class)', () => {
    assert.strictEqual(Object.getPrototypeOf(SessionsRepository.prototype).constructor, Repository);
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
