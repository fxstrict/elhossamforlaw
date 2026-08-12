/**
 * verify_fees_repository.js
 * Standalone Node harness for FeesRepository (Phase 5 / Sub-phase 5.7).
 * Independent of verify_clients_repository.js / verify_children_repository.js /
 * verify_sessions_repository.js / verify_tasks_repository.js (no shared
 * helper module — self-contained, per this phase's "Harness مستقل"
 * instruction).
 * Run: node js/repositories/verify_fees_repository.js
 * No browser required — uses a fake in-memory object satisfying the exact
 * Storage shape (getItem/setItem) that the real browser localStorage
 * exposes. No unnecessary mocking beyond that single boundary.
 */

const assert = require('assert');
const path = require('path');

const { Repository } = require(path.join(__dirname, '..', 'core', 'Repository.js'));
const { FeesRepository, createFeesLocalStorageAdapter } =
  require(path.join(__dirname, '..', 'repositories', 'FeesRepository.js'));
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
  check('FeesRepository is a function / class', () => {
    assert.strictEqual(typeof FeesRepository, 'function');
  });

  // 2. Empty Repository — open() on empty localStorage (real first-run condition)
  await (async () => {
    const fake = makeFakeStorage({});
    const repo = new FeesRepository({ storageAdapter: createFeesLocalStorageAdapter(fake) });
    await repo.open();
    check('open() on empty localStorage (no "fees" key) starts with zero records, no throw', () => {
      assert.deepStrictEqual(repo.getAll(), []);
    });
    check('Empty repository: getAll()/count()/search()/exists()/get() behave correctly with zero records', () => {
      assert.deepStrictEqual(repo.getAll(), []);
      assert.strictEqual(repo.count(), 0);
      assert.deepStrictEqual(repo.search({ search: 'anything' }).items, []);
      assert.strictEqual(repo.exists('x'), false);
      assert.strictEqual(repo.get('x'), null);
      assert.deepStrictEqual(repo.filter({ 'رقم_القضية': '2026-1' }), []);
    });
  })();

  // PHASE 13.5: equivalent of "pre-existing data loads unchanged" for an
  // IndexedDB-backed store — data written by one repository instance is
  // still there when a second instance reopens the SAME FakeIndexedDB.
  let repo; // shared across the remaining CRUD-heavy checks
  const fake = makeFakeStorage({});

  await (async () => {
    const seedRepo = new FeesRepository({ storageAdapter: createFeesLocalStorageAdapter(fake) });
    await seedRepo.open();
    await seedRepo.create({
      'رقم_العملية': 'legacy-fee-1',
      'رقم_القضية': '2026-100',
      'اسم_الموكل': 'محمد أحمد',
      'نوع_الأتعاب': 'أتعاب متابعة',
      'المبلغ': '5000',
      'تاريخ_الاستلام': '2026-01-15',
      'طريقة_الدفع': 'نقداً',
      'الملاحظات': ''
    });

    repo = new FeesRepository({ storageAdapter: createFeesLocalStorageAdapter(fake) });
    await repo.open();
    check('open() loads existing ("legacy") data unchanged after a reopen', () => {
      const all = repo.getAll();
      assert.strictEqual(all.length, 1);
      assert.strictEqual(all[0]['اسم_الموكل'], 'محمد أحمد');
      assert.strictEqual(all[0]['رقم_العملية'], 'legacy-fee-1');
      assert.strictEqual(all[0]['طريقة_الدفع'], 'نقداً');
    });
  })();

  check('getAll() returns a copy, not a live reference (Contract §19)', () => {
    const a = repo.getAll();
    a[0]['اسم_الموكل'] = 'MUTATED';
    const b = repo.getAll();
    assert.strictEqual(b[0]['اسم_الموكل'], 'محمد أحمد');
  });

  // 4. Validation — two required fields (رقم_القضية trimmed, المبلغ not trimmed)
  check('validate() rejects a record missing رقم_القضية and المبلغ (both errors reported)', () => {
    const r = repo.validate({ 'اسم_الموكل': 'test' });
    assert.strictEqual(r.valid, false);
    assert.strictEqual(r.errors.length, 2);
    const fields = r.errors.map(e => e.field).sort();
    assert.deepStrictEqual(fields, ['المبلغ', 'رقم_القضية']);
  });

  check('validate() accepts a record with both required fields present, everything else absent', () => {
    const r = repo.validate({ 'رقم_القضية': '2026-200', 'المبلغ': '1000' });
    assert.strictEqual(r.valid, true);
  });

  check('validate() rejects whitespace-only رقم_القضية (matches .trim() check on c in saveFee())', () => {
    const r = repo.validate({ 'رقم_القضية': '   ', 'المبلغ': '1000' });
    assert.strictEqual(r.valid, false);
    assert.strictEqual(r.errors[0].field, 'رقم_القضية');
  });

  check('validate() ACCEPTS whitespace-only المبلغ (matches the raw, non-trimmed !a check in saveFee() — deliberate asymmetry)', () => {
    const r = repo.validate({ 'رقم_القضية': '2026-200', 'المبلغ': '   ' });
    assert.strictEqual(r.valid, true);
  });

  check('validate() rejects المبلغ = "" (empty string) but not المبلغ = "0" (non-empty string is truthy)', () => {
    const rEmpty = repo.validate({ 'رقم_القضية': '2026-200', 'المبلغ': '' });
    assert.strictEqual(rEmpty.valid, false);
    const rZero = repo.validate({ 'رقم_القضية': '2026-200', 'المبلغ': '0' });
    assert.strictEqual(rZero.valid, true);
  });

  // 5. Insert / create — hybrid id generation + duplicate protection
  let insertedId;
  await (async () => {
    const res = await repo.insert({ 'رقم_القضية': '2026-101', 'اسم_الموكل': 'سارة علي', 'المبلغ': '3000', 'طريقة_الدفع': 'تحويل بنكي' });
    check('insert() [alias of create()] adds a new fee, auto-generating رقم_العملية when absent', () => {
      assert.strictEqual(res.success, true);
      assert.ok(res.record['رقم_العملية'], 'expected a generated رقم_العملية');
      assert.strictEqual(res.record['اسم_الموكل'], 'سارة علي');
      insertedId = res.record['رقم_العملية'];
    });
  })();

  await (async () => {
    const res = await repo.insert({ 'رقم_العملية': 'explicit-fee-1', 'رقم_القضية': '2026-102', 'المبلغ': '750', 'طريقة_الدفع': 'شيك' });
    check('insert() preserves a caller-supplied رقم_العملية instead of overwriting it (matches saveFee()\'s || uid() fallback)', () => {
      assert.strictEqual(res.success, true);
      assert.strictEqual(res.record['رقم_العملية'], 'explicit-fee-1');
    });
  })();

  await (async () => {
    const res = await repo.insert({ 'رقم_العملية': 'explicit-fee-1', 'رقم_القضية': '2026-103', 'المبلغ': '999' });
    check('insert() [Duplicate ID] rejects a second record with an explicitly duplicate رقم_العملية', () => {
      assert.strictEqual(res.success, false);
      assert.strictEqual(res.error.type, 'ConflictError');
    });
  })();

  await (async () => {
    const res = await repo.insert({ 'اسم_الموكل': 'بلا رقم قضية أو مبلغ' }); // missing both required fields
    check('insert() [Invalid Entity] rejects a record missing required fields before touching storage', () => {
      assert.strictEqual(res.success, false);
      assert.strictEqual(res.error.type, 'ValidationError');
    });
  })();

  // 6. get / exists
  check('get(id) returns the fee by رقم_العملية', () => {
    const f = repo.get(insertedId);
    assert.ok(f);
    assert.strictEqual(f['اسم_الموكل'], 'سارة علي');
  });

  check('get(id) returns null for unknown id', () => {
    assert.strictEqual(repo.get('no-such-id'), null);
  });

  check('exists(id) true/false', () => {
    assert.strictEqual(repo.exists(insertedId), true);
    assert.strictEqual(repo.exists('no-such-id'), false);
  });

  // 7. Update Fee
  await (async () => {
    const res = await repo.update(insertedId, { 'طريقة_الدفع': 'محفظة إلكترونية', 'الملاحظات': 'دفعة أولى' });
    check('update(id, entity) merges fields and stamps updatedAt/version', () => {
      assert.strictEqual(res.success, true);
      assert.strictEqual(res.record['طريقة_الدفع'], 'محفظة إلكترونية');
      assert.strictEqual(res.record['الملاحظات'], 'دفعة أولى');
      assert.strictEqual(res.record['اسم_الموكل'], 'سارة علي'); // untouched field preserved
      assert.strictEqual(res.record.version, 2); // 1 on create, +1 on update
      assert.ok(res.record.updatedAt);
    });
  })();

  await (async () => {
    const res = await repo.update(insertedId, { 'المبلغ': '' });
    check('update(id, entity) rejects a patch that would violate a required field (المبلغ emptied)', () => {
      assert.strictEqual(res.success, false);
      assert.strictEqual(res.error.type, 'ValidationError');
    });
  })();

  await (async () => {
    const res = await repo.update('no-such-id', { 'الملاحظات': 'x' });
    check('update(id, entity) on an unknown id fails gracefully (base Repository.js reports ValidationError for "no record with this id" — unchanged Phase 5.1 base-class behavior)', () => {
      assert.strictEqual(res.success, false);
      assert.strictEqual(res.error.type, 'ValidationError');
    });
  })();

  // 8. count (baseline before delete checks)
  check('count() reflects current non-deleted record count', () => {
    // legacy-fee-1 + insertedId + explicit-fee-1 = 3 (the duplicate/invalid inserts above never landed)
    assert.strictEqual(repo.count(), 3);
  });

  // 9. Delete Fee — soft delete
  await (async () => {
    const res = await repo.remove(insertedId);
    check('remove(id) [alias of delete()] soft-deletes by default (Data_Schema §3.7 / §4.5 Delete Rules)', () => {
      assert.strictEqual(res.success, true);
      assert.ok(res.record.deletedAt);
    });
  })();

  check('soft-deleted record excluded from default getAll()/get()', () => {
    assert.strictEqual(repo.get(insertedId), null);
    assert.strictEqual(repo.getAll().some(r => r['رقم_العملية'] === insertedId), false);
  });

  check('getAll({includeDeleted:true}) still returns the soft-deleted record', () => {
    const all = repo.getAll({ includeDeleted: true });
    assert.strictEqual(all.some(r => r['رقم_العملية'] === insertedId), true);
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

  // 10. Search — full-record join, matches renderFees()
  check('search() free-text matches across ANY legacy field, case-insensitively (matches renderFees(), despite both planning reports claiming search is scoped to اسم_الموكل/رقم_القضية only)', () => {
    const result = repo.search({ search: 'شيك' }); // matches طريقة_الدفع 'شيك' on explicit-fee-1
    assert.strictEqual(result.items.length, 1);
    assert.strictEqual(result.items[0]['رقم_العملية'], 'explicit-fee-1');
  });

  check('search() free-text matches a non-client-name field (case number)', () => {
    const result = repo.search({ search: '2026-100' });
    assert.strictEqual(result.items.length, 1);
    assert.strictEqual(result.items[0]['رقم_العملية'], 'legacy-fee-1');
  });

  check('search() does NOT match against new audit/metadata fields (checksum/version etc.)', () => {
    const target = repo.get('explicit-fee-1');
    const result = repo.search({ search: String(target.checksum) });
    assert.strictEqual(result.items.length, 0);
  });

  check('search() excludes soft-deleted records by default', () => {
    const result = repo.search({ search: 'سارة علي' });
    assert.strictEqual(result.items.length, 0);
  });

  // 11. Filter — Case Number, Payment Method, Amount Range, Date Range, Status (gap)
  check('filter() [Status Filter] by الحالة — documented Input Gap: no status field exists anywhere for Fees (no #status control, no FEES_FIELDS/FEES_MAP entry, no Code_v4.gs sheet column) — the generic pass-through does not throw and correctly returns zero matches rather than fabricating a status concept', () => {
    const result = repo.filter({ 'الحالة': 'paid' });
    assert.deepStrictEqual(result, []);
  });

  check('filter() [Payment Method Filter] by طريقة_الدفع returns exactly the fees paid via that method (real field, no live dropdown exists — generic pass-through)', () => {
    const bankTransfer = repo.filter({ 'طريقة_الدفع': 'تحويل بنكي' });
    assert.strictEqual(bankTransfer.length, 0); // insertedId (تحويل بنكي originally) was updated to محفظة إلكترونية, then soft-deleted
    const wallet = repo.filter({ 'طريقة_الدفع': 'محفظة إلكترونية' });
    assert.strictEqual(wallet.length, 0); // that record is soft-deleted, excluded by default
    const cheque = repo.filter({ 'طريقة_الدفع': 'شيك' });
    assert.strictEqual(cheque.length, 1);
    assert.strictEqual(cheque[0]['رقم_العملية'], 'explicit-fee-1');
  });

  check('filter() [Case Number Filter] by رقم_القضية returns exactly the matching fee (documented Filter Field)', () => {
    const byCase = repo.filter({ 'رقم_القضية': '2026-100' });
    assert.strictEqual(byCase.length, 1);
    assert.strictEqual(byCase[0]['رقم_العملية'], 'legacy-fee-1');
  });

  // Amount Range Filter — via the base class's generic {op,value} range engine
  await (async () => {
    await repo.insert({ 'رقم_القضية': '2026-105', 'المبلغ': '20000', 'طريقة_الدفع': 'نقداً' });
  })();

  check('filter() [Amount Range Filter] with a range operator on المبلغ returns only fees within range (real field, undocumented as a Filter Field, no live UI control — generic pass-through)', () => {
    const under10k = repo.filter({ 'المبلغ': { op: 'lt', value: 10000 } });
    assert.strictEqual(under10k.some(f => f['المبلغ'] === '20000'), false);
    assert.strictEqual(under10k.some(f => f['رقم_العملية'] === 'legacy-fee-1'), true); // 5000 < 10000
    const atLeast10k = repo.filter({ 'المبلغ': { op: 'gte', value: 10000 } });
    assert.strictEqual(atLeast10k.some(f => f['المبلغ'] === '20000'), true);
  });

  // Date Range Filter — documented Filter Field (تاريخ_الاستلام)
  await (async () => {
    await repo.insert({ 'رقم_القضية': '2026-106', 'المبلغ': '1200', 'تاريخ_الاستلام': '2027-06-01' });
  })();

  check('filter() [Date Range Filter] on تاريخ_الاستلام returns only fees received within range (documented Filter Field)', () => {
    const receivedBy2026 = repo.filter({ 'تاريخ_الاستلام': { op: 'lte', value: '2026-12-31' } });
    assert.strictEqual(receivedBy2026.some(f => f['رقم_القضية'] === '2026-106'), false);
    assert.strictEqual(receivedBy2026.some(f => f['رقم_العملية'] === 'legacy-fee-1'), true);
  });

  check('filter() by a case number with no fees returns an empty array', () => {
    assert.deepStrictEqual(repo.filter({ 'رقم_القضية': 'no-such-case' }), []);
  });

  // 12. Sort
  check('sort() orders by تاريخ_الاستلام ascending by default (purely additive — no live sort exists in renderFees() to reconcile against)', () => {
    const sorted = repo.sort();
    assert.ok(Array.isArray(sorted));
    assert.strictEqual(sorted.length, repo.count());
    const dates = sorted.map(f => f['تاريخ_الاستلام']).filter(Boolean);
    for (let i = 1; i < dates.length; i++) {
      assert.ok(String(dates[i - 1]) <= String(dates[i]));
    }
  });

  check('sort() accepts an explicit sortSpec and array of records without mutating input', () => {
    const input = repo.getAll();
    const inputCopy = JSON.parse(JSON.stringify(input));
    const sorted = repo.sort(input, { field: 'تاريخ_الاستلام', direction: 'asc' });
    assert.deepStrictEqual(input, inputCopy); // input untouched
    const dates = sorted.map(f => f['تاريخ_الاستلام']).filter(Boolean);
    for (let i = 1; i < dates.length; i++) {
      assert.ok(String(dates[i - 1]) <= String(dates[i]));
    }
  });

  check('sort() with direction "desc" reverses the order', () => {
    const asc = repo.sort(repo.getAll(), { field: 'تاريخ_الاستلام', direction: 'asc' }).map(f => f['تاريخ_الاستلام']);
    const desc = repo.sort(repo.getAll(), { field: 'تاريخ_الاستلام', direction: 'desc' }).map(f => f['تاريخ_الاستلام']);
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

  check('no business-logic methods (e.g. computeTotal/toggleStatus) exist — this Repository does not transfer any Business Logic (file header + phase instructions)', () => {
    assert.strictEqual(typeof repo.computeTotal, 'undefined');
    assert.strictEqual(typeof repo.toggleStatus, 'undefined');
  });

  // 14. Legacy localStorage compatibility — storage format round-trip
  // PHASE 13.6: `fake` is a FakeIndexedDB (IDBFactory-shaped) instance,
  // not a getItem/setItem Storage-shaped fake, so there is no raw
  // localStorage["fees"] string to JSON.parse (see ChildrenRepository's
  // equivalent PHASE 13.6 fix). Read the object store back through the
  // same DatabaseService/IndexedDBAdapter pair the Repository itself
  // uses instead.
  await (async () => {
    const readBackAdapter = createFeesLocalStorageAdapter(fake);
    const persisted = await readBackAdapter.read('fees');
    check('persisted "fees" object store is a plain array of records, exactly like index.html expects', () => {
      assert.ok(Array.isArray(persisted));
      assert.ok(persisted.length > 0);
    });
  })();

  await (async () => {
    const repo2 = new FeesRepository({ storageAdapter: createFeesLocalStorageAdapter(fake) });
    await repo2.open();
    check('a second FeesRepository instance opening the same storage sees identical data (no data loss across "reload")', () => {
      assert.deepStrictEqual(
        repo2.getAll({ includeDeleted: true }).map(r => r['رقم_العملية']).sort(),
        repo.getAll({ includeDeleted: true }).map(r => r['رقم_العملية']).sort()
      );
    });
  })();

  check('FeesRepository does not reference ClientsRepository/CasesRepository/ChildrenRepository/SessionsRepository/TasksRepository at runtime (independent harness, independent class)', () => {
    assert.strictEqual(Object.getPrototypeOf(FeesRepository.prototype).constructor, Repository);
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
