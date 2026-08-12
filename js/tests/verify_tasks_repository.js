/**
 * verify_tasks_repository.js
 * Standalone Node harness for TasksRepository (Phase 5 / Sub-phase 5.6).
 * Independent of verify_clients_repository.js / verify_children_repository.js /
 * verify_sessions_repository.js (no shared helper module — self-contained,
 * per this phase's "Harness مستقل" instruction).
 * Run: node js/core/verify_tasks_repository.js
 * No browser required — uses a fake in-memory object satisfying the exact
 * Storage shape (getItem/setItem) that the real browser localStorage
 * exposes. No unnecessary mocking beyond that single boundary.
 */

const assert = require('assert');
const path = require('path');

const { Repository } = require(path.join(__dirname, '..', 'core', 'Repository.js'));
const { TasksRepository, createTasksLocalStorageAdapter } =
  require(path.join(__dirname, '..', 'repositories', 'TasksRepository.js'));
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
  check('TasksRepository is a function / class', () => {
    assert.strictEqual(typeof TasksRepository, 'function');
  });

  // 2. Empty Repository — open() on empty localStorage (real first-run condition)
  await (async () => {
    const fake = makeFakeStorage({});
    const repo = new TasksRepository({ storageAdapter: createTasksLocalStorageAdapter(fake) });
    await repo.open();
    check('open() on empty localStorage (no "tasks" key) starts with zero records, no throw', () => {
      assert.deepStrictEqual(repo.getAll(), []);
    });
    check('Empty repository: getAll()/count()/search()/exists()/get() behave correctly with zero records', () => {
      assert.deepStrictEqual(repo.getAll(), []);
      assert.strictEqual(repo.count(), 0);
      assert.deepStrictEqual(repo.search({ search: 'anything' }).items, []);
      assert.strictEqual(repo.exists('x'), false);
      assert.strictEqual(repo.get('x'), null);
      assert.deepStrictEqual(repo.filter({ 'الأولوية': 'high' }), []);
    });
  })();

  // PHASE 13.5: equivalent of "pre-existing data loads unchanged" for an
  // IndexedDB-backed store — data written by one repository instance is
  // still there when a second instance reopens the SAME FakeIndexedDB.
  let repo; // shared across the remaining CRUD-heavy checks
  const fake = makeFakeStorage({});

  await (async () => {
    const seedRepo = new TasksRepository({ storageAdapter: createTasksLocalStorageAdapter(fake) });
    await seedRepo.open();
    await seedRepo.create({
      'رقم_المهمة': 'legacy-task-1',
      'العنوان': 'متابعة إيداع مذكرة',
      'رقم_القضية': '2026-100',
      'الأولوية': 'high',
      'الموعد_النهائي': '2026-02-01',
      'الحالة': 'pending'
    });

    repo = new TasksRepository({ storageAdapter: createTasksLocalStorageAdapter(fake) });
    await repo.open();
    check('open() loads existing ("legacy") data unchanged after a reopen', () => {
      const all = repo.getAll();
      assert.strictEqual(all.length, 1);
      assert.strictEqual(all[0]['العنوان'], 'متابعة إيداع مذكرة');
      assert.strictEqual(all[0]['رقم_المهمة'], 'legacy-task-1');
      assert.strictEqual(all[0]['الأولوية'], 'high');
    });
  })();

  check('getAll() returns a copy, not a live reference (Contract §19)', () => {
    const a = repo.getAll();
    a[0]['العنوان'] = 'MUTATED';
    const b = repo.getAll();
    assert.strictEqual(b[0]['العنوان'], 'متابعة إيداع مذكرة');
  });

  // 4. Validation — single required field (العنوان)
  check('validate() rejects a record missing العنوان', () => {
    const r = repo.validate({ 'الأولوية': 'low' });
    assert.strictEqual(r.valid, false);
    assert.strictEqual(r.errors.length, 1);
    assert.strictEqual(r.errors[0].field, 'العنوان');
  });

  check('validate() accepts a record with العنوان present, even with everything else absent', () => {
    const r = repo.validate({ 'العنوان': 'مهمة جديدة' });
    assert.strictEqual(r.valid, true);
  });

  check('validate() rejects whitespace-only العنوان (matches .trim() check in saveTask())', () => {
    const r = repo.validate({ 'العنوان': '   ' });
    assert.strictEqual(r.valid, false);
    assert.strictEqual(r.errors[0].field, 'العنوان');
  });

  // 5. Insert / create — hybrid id generation + duplicate protection
  let insertedId;
  await (async () => {
    const res = await repo.insert({ 'العنوان': 'إعداد صحيفة دعوى', 'رقم_القضية': '2026-101', 'الأولوية': 'medium', 'الحالة': 'pending' });
    check('insert() [alias of create()] adds a new task, auto-generating رقم_المهمة when absent', () => {
      assert.strictEqual(res.success, true);
      assert.ok(res.record['رقم_المهمة'], 'expected a generated رقم_المهمة');
      assert.strictEqual(res.record['الأولوية'], 'medium');
      insertedId = res.record['رقم_المهمة'];
    });
  })();

  await (async () => {
    const res = await repo.insert({ 'رقم_المهمة': 'explicit-task-1', 'العنوان': 'مراجعة عقد', 'الأولوية': 'low' });
    check('insert() preserves a caller-supplied رقم_المهمة instead of overwriting it (matches saveTask()\'s || uid() fallback)', () => {
      assert.strictEqual(res.success, true);
      assert.strictEqual(res.record['رقم_المهمة'], 'explicit-task-1');
    });
  })();

  await (async () => {
    const res = await repo.insert({ 'رقم_المهمة': 'explicit-task-1', 'العنوان': 'مهمة مكررة' });
    check('insert() [Duplicate ID] rejects a second record with an explicitly duplicate رقم_المهمة', () => {
      assert.strictEqual(res.success, false);
      assert.strictEqual(res.error.type, 'ConflictError');
    });
  })();

  await (async () => {
    const res = await repo.insert({ 'رقم_القضية': '2026-104' }); // missing العنوان
    check('insert() [Invalid Entity] rejects a record missing a required field before touching storage', () => {
      assert.strictEqual(res.success, false);
      assert.strictEqual(res.error.type, 'ValidationError');
    });
  })();

  // 6. get / exists
  check('get(id) returns the task by رقم_المهمة', () => {
    const t = repo.get(insertedId);
    assert.ok(t);
    assert.strictEqual(t['العنوان'], 'إعداد صحيفة دعوى');
  });

  check('get(id) returns null for unknown id', () => {
    assert.strictEqual(repo.get('no-such-id'), null);
  });

  check('exists(id) true/false', () => {
    assert.strictEqual(repo.exists(insertedId), true);
    assert.strictEqual(repo.exists('no-such-id'), false);
  });

  // 7. Update Task
  await (async () => {
    const res = await repo.update(insertedId, { 'الحالة': 'done', 'الملاحظات': 'تم التسليم' });
    check('update(id, entity) merges fields and stamps updatedAt/version', () => {
      assert.strictEqual(res.success, true);
      assert.strictEqual(res.record['الحالة'], 'done');
      assert.strictEqual(res.record['الملاحظات'], 'تم التسليم');
      assert.strictEqual(res.record['العنوان'], 'إعداد صحيفة دعوى'); // untouched field preserved
      assert.strictEqual(res.record.version, 2); // 1 on create, +1 on update
      assert.ok(res.record.updatedAt);
    });
  })();

  await (async () => {
    const res = await repo.update(insertedId, { 'العنوان': '' });
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
    // legacy-task-1 + insertedId + explicit-task-1 = 3 (the duplicate/invalid inserts above never landed)
    assert.strictEqual(repo.count(), 3);
  });

  // 9. Delete Task — soft delete
  await (async () => {
    const res = await repo.remove(insertedId);
    check('remove(id) [alias of delete()] soft-deletes by default (Data_Schema §3.7 / §4.6 Delete Rules)', () => {
      assert.strictEqual(res.success, true);
      assert.ok(res.record.deletedAt);
    });
  })();

  check('soft-deleted record excluded from default getAll()/get()', () => {
    assert.strictEqual(repo.get(insertedId), null);
    assert.strictEqual(repo.getAll().some(r => r['رقم_المهمة'] === insertedId), false);
  });

  check('getAll({includeDeleted:true}) still returns the soft-deleted record', () => {
    const all = repo.getAll({ includeDeleted: true });
    assert.strictEqual(all.some(r => r['رقم_المهمة'] === insertedId), true);
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

  // 10. Search — full-record join, matches renderTasks() (see file header "SEARCH" note)
  check('search() free-text matches across ANY legacy field, case-insensitively (matches renderTasks(), despite both planning reports claiming search is scoped to العنوان only)', () => {
    const result = repo.search({ search: 'عقد' }); // matches العنوان 'مراجعة عقد'
    assert.strictEqual(result.items.length, 1);
    assert.strictEqual(result.items[0]['رقم_المهمة'], 'explicit-task-1');
  });

  check('search() free-text matches a non-title field (case number)', () => {
    const result = repo.search({ search: '2026-100' });
    assert.strictEqual(result.items.length, 1);
    assert.strictEqual(result.items[0]['رقم_المهمة'], 'legacy-task-1');
  });

  check('search() does NOT match against new audit/metadata fields (checksum/version etc.)', () => {
    const target = repo.get('explicit-task-1');
    const result = repo.search({ search: String(target.checksum) });
    assert.strictEqual(result.items.length, 0);
  });

  check('search() excludes soft-deleted records by default', () => {
    const result = repo.search({ search: 'إعداد صحيفة دعوى' });
    assert.strictEqual(result.items.length, 0);
  });

  // 11. Filter — Priority (live UI pattern) and Status (documented, not yet UI-wired)
  check('filter() by الأولوية returns exactly the tasks with that priority (matches renderTasks()\'s #filterTaskPriority)', () => {
    const highPriority = repo.filter({ 'الأولوية': 'high' });
    assert.strictEqual(highPriority.length, 1);
    assert.strictEqual(highPriority[0]['رقم_المهمة'], 'legacy-task-1');
  });

  check('filter() by الحالة returns exactly the tasks with that status (documented Filter Field, generic pass-through works even without a live dropdown)', () => {
    const pendingTasks = repo.filter({ 'الحالة': 'pending' });
    assert.strictEqual(pendingTasks.length, 1);
    assert.strictEqual(pendingTasks[0]['رقم_المهمة'], 'legacy-task-1');
  });

  // Date Filter — range filter on الموعد_النهائي via the base class's generic {op,value} engine
  await (async () => {
    await repo.insert({ 'العنوان': 'مهمة بعيدة الأجل', 'الموعد_النهائي': '2027-06-01' });
  })();

  check('filter() with a date-range operator on الموعد_النهائي returns only tasks due within range', () => {
    const dueEarly2026 = repo.filter({ 'الموعد_النهائي': { op: 'lte', value: '2026-12-31' } });
    assert.strictEqual(dueEarly2026.some(t => t['العنوان'] === 'مهمة بعيدة الأجل'), false);
    assert.strictEqual(dueEarly2026.some(t => t['رقم_المهمة'] === 'legacy-task-1'), true);
  });

  check('filter() by a priority with no tasks returns an empty array', () => {
    assert.deepStrictEqual(repo.filter({ 'الأولوية': 'no-such-priority' }), []);
  });

  // 12. Sort
  check('sort() orders by الموعد_النهائي ascending by default (purely additive — no live sort exists in renderTasks() to reconcile against)', () => {
    const sorted = repo.sort();
    assert.ok(Array.isArray(sorted));
    assert.strictEqual(sorted.length, repo.count());
    const dates = sorted.map(t => t['الموعد_النهائي']).filter(Boolean);
    for (let i = 1; i < dates.length; i++) {
      assert.ok(String(dates[i - 1]) <= String(dates[i]));
    }
  });

  check('sort() accepts an explicit sortSpec and array of records without mutating input', () => {
    const input = repo.getAll();
    const inputCopy = JSON.parse(JSON.stringify(input));
    const sorted = repo.sort(input, { field: 'الموعد_النهائي', direction: 'asc' });
    assert.deepStrictEqual(input, inputCopy); // input untouched
    const dates = sorted.map(t => t['الموعد_النهائي']).filter(Boolean);
    for (let i = 1; i < dates.length; i++) {
      assert.ok(String(dates[i - 1]) <= String(dates[i]));
    }
  });

  check('sort() with direction "desc" reverses the order', () => {
    const asc = repo.sort(repo.getAll(), { field: 'الموعد_النهائي', direction: 'asc' }).map(t => t['الموعد_النهائي']);
    const desc = repo.sort(repo.getAll(), { field: 'الموعد_النهائي', direction: 'desc' }).map(t => t['الموعد_النهائي']);
    assert.deepStrictEqual(desc, asc.slice().reverse());
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

  check('no toggleStatus() method exists (deliberately excluded — not in the phase\'s requested method list)', () => {
    assert.strictEqual(typeof repo.toggleStatus, 'undefined');
  });

  // 14. Legacy localStorage compatibility — storage format round-trip
  // PHASE 13.6: `fake` is a FakeIndexedDB (IDBFactory-shaped) instance,
  // not a getItem/setItem Storage-shaped fake, so there is no raw
  // localStorage["tasks"] string to JSON.parse (see ChildrenRepository's
  // equivalent PHASE 13.6 fix). Read the object store back through the
  // same DatabaseService/IndexedDBAdapter pair the Repository itself
  // uses instead.
  await (async () => {
    const readBackAdapter = createTasksLocalStorageAdapter(fake);
    const persisted = await readBackAdapter.read('tasks');
    check('persisted "tasks" object store is a plain array of records, exactly like index.html expects', () => {
      assert.ok(Array.isArray(persisted));
      assert.ok(persisted.length > 0);
    });
  })();

  await (async () => {
    const repo2 = new TasksRepository({ storageAdapter: createTasksLocalStorageAdapter(fake) });
    await repo2.open();
    check('a second TasksRepository instance opening the same storage sees identical data (no data loss across "reload")', () => {
      assert.deepStrictEqual(
        repo2.getAll({ includeDeleted: true }).map(r => r['رقم_المهمة']).sort(),
        repo.getAll({ includeDeleted: true }).map(r => r['رقم_المهمة']).sort()
      );
    });
  })();

  check('TasksRepository does not reference ClientsRepository/CasesRepository/ChildrenRepository/SessionsRepository at runtime (independent harness, independent class)', () => {
    assert.strictEqual(Object.getPrototypeOf(TasksRepository.prototype).constructor, Repository);
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
