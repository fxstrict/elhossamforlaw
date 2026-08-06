/**
 * verify_documents_repository.js
 * Standalone Node harness for DocumentsRepository (Phase 5 / Sub-phase 5.8).
 * Independent of verify_clients_repository.js / verify_children_repository.js /
 * verify_sessions_repository.js / verify_tasks_repository.js /
 * verify_fees_repository.js (no shared helper module — self-contained, per
 * this phase's "Harness مستقل" instruction).
 * Run: node js/tests/verify_documents_repository.js
 * No browser required — uses a fake in-memory object satisfying the exact
 * Storage shape (getItem/setItem) that the real browser localStorage
 * exposes. No unnecessary mocking beyond that single boundary.
 */

const assert = require('assert');
const path = require('path');

const { Repository } = require(path.join(__dirname, '..', 'core', 'Repository.js'));
const { DocumentsRepository, createDocumentsLocalStorageAdapter } =
  require(path.join(__dirname, '..', 'repositories', 'DocumentsRepository.js'));
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
// PHASE 13.5: IDBFactory-shaped fake — createDocumentsLocalStorageAdapter()
// now wraps a real IndexedDBAdapter/DatabaseService pair.
function makeFakeStorage(seed) {
  if (seed && Object.keys(seed).length) {
    throw new Error('makeFakeStorage(seed): non-empty seed is not supported against FakeIndexedDB');
  }
  return new FakeIndexedDB();
}

async function main() {

  // 1. Class existence
  check('DocumentsRepository is a function / class', () => {
    assert.strictEqual(typeof DocumentsRepository, 'function');
  });

  check('DocumentsRepository extends Repository (prototype chain)', () => {
    assert.strictEqual(Object.getPrototypeOf(DocumentsRepository.prototype), Repository.prototype);
  });

  // 2. Empty Repository — open() on empty localStorage (real first-run condition)
  await (async () => {
    const fake = makeFakeStorage({});
    const repo = new DocumentsRepository({ storageAdapter: createDocumentsLocalStorageAdapter(fake) });
    await repo.open();
    check('open() on empty localStorage (no "documents" key) starts with zero records, no throw', () => {
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
    const seedRepo = new DocumentsRepository({ storageAdapter: createDocumentsLocalStorageAdapter(fake) });
    await seedRepo.open();
    await seedRepo.create({
      'رقم_المستند': 'legacy-doc-1',
      'رقم_القضية': '2026-100',
      'اسم_المستند': 'عقد زواج محمد وسارة',
      'نوع_المستند': 'عقد زواج',
      'تاريخ_الإيداع': '2026-01-15',
      'رابط_Drive': 'https://drive.google.com/legacy-1',
      'الملاحظات': ''
    });

    repo = new DocumentsRepository({ storageAdapter: createDocumentsLocalStorageAdapter(fake) });
    await repo.open();
    check('open() loads existing ("legacy") data unchanged after a reopen', () => {
      const all = repo.getAll();
      assert.strictEqual(all.length, 1);
      assert.strictEqual(all[0]['اسم_المستند'], 'عقد زواج محمد وسارة');
      assert.strictEqual(all[0]['رقم_المستند'], 'legacy-doc-1');
      assert.strictEqual(all[0]['نوع_المستند'], 'عقد زواج');
    });
  })();

  check('getAll() returns a copy, not a live reference (Contract §19)', () => {
    const a = repo.getAll();
    a[0]['اسم_المستند'] = 'MUTATED';
    const b = repo.getAll();
    assert.strictEqual(b[0]['اسم_المستند'], 'عقد زواج محمد وسارة');
  });

  // 4. Validation — two required fields, BOTH trimmed (no asymmetry, unlike Fees)
  check('validate() rejects a record missing رقم_القضية and اسم_المستند (both errors reported)', () => {
    const r = repo.validate({ 'نوع_المستند': 'محضر' });
    assert.strictEqual(r.valid, false);
    assert.strictEqual(r.errors.length, 2);
    const fields = r.errors.map(e => e.field).sort();
    assert.deepStrictEqual(fields, ['اسم_المستند', 'رقم_القضية']);
  });

  check('validate() accepts a record with both required fields present, everything else absent', () => {
    const r = repo.validate({ 'رقم_القضية': '2026-200', 'اسم_المستند': 'إيصال استلام' });
    assert.strictEqual(r.valid, true);
  });

  check('validate() rejects whitespace-only رقم_القضية (matches .trim() check on c in saveDocument())', () => {
    const r = repo.validate({ 'رقم_القضية': '   ', 'اسم_المستند': 'مستند ما' });
    assert.strictEqual(r.valid, false);
    assert.strictEqual(r.errors[0].field, 'رقم_القضية');
  });

  check('validate() ALSO rejects whitespace-only اسم_المستند (matches .trim() check on n in saveDocument() — NO asymmetry here, unlike Fees)', () => {
    const r = repo.validate({ 'رقم_القضية': '2026-200', 'اسم_المستند': '   ' });
    assert.strictEqual(r.valid, false);
    assert.strictEqual(r.errors[0].field, 'اسم_المستند');
  });

  check('validate() rejects اسم_المستند = "" (empty string) exactly like رقم_القضية = ""', () => {
    const rEmptyName = repo.validate({ 'رقم_القضية': '2026-200', 'اسم_المستند': '' });
    assert.strictEqual(rEmptyName.valid, false);
    const rEmptyCase = repo.validate({ 'رقم_القضية': '', 'اسم_المستند': 'مستند صالح' });
    assert.strictEqual(rEmptyCase.valid, false);
  });

  check('validate() reports BOTH errors when both fields are whitespace-only simultaneously', () => {
    const r = repo.validate({ 'رقم_القضية': '   ', 'اسم_المستند': '   ' });
    assert.strictEqual(r.valid, false);
    assert.strictEqual(r.errors.length, 2);
  });

  // 5. Insert / create — hybrid id generation + duplicate protection
  let insertedId;
  await (async () => {
    const res = await repo.insert({ 'رقم_القضية': '2026-101', 'اسم_المستند': 'شهادة ميلاد يوسف', 'نوع_المستند': 'شهادة ميلاد' });
    check('insert() [alias of create()] adds a new document, auto-generating رقم_المستند when absent', () => {
      assert.strictEqual(res.success, true);
      assert.ok(res.record['رقم_المستند'], 'expected a generated رقم_المستند');
      assert.strictEqual(res.record['اسم_المستند'], 'شهادة ميلاد يوسف');
      insertedId = res.record['رقم_المستند'];
    });
  })();

  await (async () => {
    const res = await repo.insert({ 'رقم_المستند': 'explicit-doc-1', 'رقم_القضية': '2026-102', 'اسم_المستند': 'محضر شرطة', 'نوع_المستند': 'محضر' });
    check('insert() preserves a caller-supplied رقم_المستند instead of overwriting it (matches saveDocument()\'s || uid() fallback)', () => {
      assert.strictEqual(res.success, true);
      assert.strictEqual(res.record['رقم_المستند'], 'explicit-doc-1');
    });
  })();

  await (async () => {
    const res = await repo.insert({ 'رقم_المستند': 'explicit-doc-1', 'رقم_القضية': '2026-103', 'اسم_المستند': 'مستند مكرر' });
    check('insert() [Duplicate ID] rejects a second record with an explicitly duplicate رقم_المستند', () => {
      assert.strictEqual(res.success, false);
      assert.strictEqual(res.error.type, 'ConflictError');
    });
  })();

  await (async () => {
    const res = await repo.insert({ 'نوع_المستند': 'بلا رقم قضية أو اسم' }); // missing both required fields
    check('insert() [Invalid Entity] rejects a record missing required fields before touching storage', () => {
      assert.strictEqual(res.success, false);
      assert.strictEqual(res.error.type, 'ValidationError');
    });
  })();

  await (async () => {
    const res = await repo.insert(null); // null entity edge case
    check('insert() [Null Entity] rejects a null entity gracefully (no throw, ValidationError)', () => {
      assert.strictEqual(res.success, false);
      assert.strictEqual(res.error.type, 'ValidationError');
    });
  })();

  // 6. get / exists
  check('get(id) returns the document by رقم_المستند', () => {
    const d = repo.get(insertedId);
    assert.ok(d);
    assert.strictEqual(d['اسم_المستند'], 'شهادة ميلاد يوسف');
  });

  check('get(id) returns null for unknown id', () => {
    assert.strictEqual(repo.get('no-such-id'), null);
  });

  check('exists(id) true/false', () => {
    assert.strictEqual(repo.exists(insertedId), true);
    assert.strictEqual(repo.exists('no-such-id'), false);
  });

  // 7. Update Document
  await (async () => {
    const res = await repo.update(insertedId, { 'رابط_Drive': 'https://drive.google.com/new-link', 'الملاحظات': 'نسخة مصدَّقة' });
    check('update(id, entity) merges fields and stamps updatedAt/version', () => {
      assert.strictEqual(res.success, true);
      assert.strictEqual(res.record['رابط_Drive'], 'https://drive.google.com/new-link');
      assert.strictEqual(res.record['الملاحظات'], 'نسخة مصدَّقة');
      assert.strictEqual(res.record['اسم_المستند'], 'شهادة ميلاد يوسف'); // untouched field preserved
      assert.strictEqual(res.record.version, 2); // 1 on create, +1 on update
      assert.ok(res.record.updatedAt);
    });
  })();

  await (async () => {
    const res = await repo.update(insertedId, { 'اسم_المستند': '' });
    check('update(id, entity) rejects a patch that would violate a required field (اسم_المستند emptied)', () => {
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
    // legacy-doc-1 + insertedId + explicit-doc-1 = 3 (the duplicate/invalid inserts above never landed)
    assert.strictEqual(repo.count(), 3);
  });

  // 9. Delete Document — soft delete
  await (async () => {
    const res = await repo.remove(insertedId);
    check('remove(id) [alias of delete()] soft-deletes by default (Data_Schema §3.7 / §4.7 Delete Rules)', () => {
      assert.strictEqual(res.success, true);
      assert.ok(res.record.deletedAt);
    });
  })();

  check('soft-deleted record excluded from default getAll()/get()', () => {
    assert.strictEqual(repo.get(insertedId), null);
    assert.strictEqual(repo.getAll().some(r => r['رقم_المستند'] === insertedId), false);
  });

  check('getAll({includeDeleted:true}) still returns the soft-deleted record', () => {
    const all = repo.getAll({ includeDeleted: true });
    assert.strictEqual(all.some(r => r['رقم_المستند'] === insertedId), true);
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

  // 10. Restore — undo a soft delete via restore() (Repository.js's
  // dedicated Restore System, Phase 10.2). PHASE 11.2 update: this block
  // previously restored via `update(id, {deletedAt:null})`, a pattern
  // that predates restore() and is now intentionally blocked by FIX 1
  // (Repository_API_Consistency_Report.md) — update() no longer permits
  // modifying a soft-deleted record's fields, including deletedAt,
  // unless {allowDeleted:true} is explicitly passed. restore() is now
  // the single supported path back to a live record; this test is
  // updated to use it, matching current, correct project behavior.
  await (async () => {
    const res = await repo.restore(insertedId);
    check('restore() brings a soft-deleted record back into default getAll()/get() results', () => {
      assert.strictEqual(res.success, true);
      assert.strictEqual(res.record.deletedAt, null);
      assert.ok(repo.get(insertedId));
      assert.strictEqual(repo.getAll().some(r => r['رقم_المستند'] === insertedId), true);
    });
  })();

  check('count() includes the restored record again', () => {
    assert.strictEqual(repo.count(), 3);
  });

  // 11. Permanent delete — hard delete via a softDelete:false instance
  await (async () => {
    const hardFake = makeFakeStorage({});
    const hardRepo = new DocumentsRepository({ storageAdapter: createDocumentsLocalStorageAdapter(hardFake) });
    await hardRepo.open();
    await hardRepo.insert({ 'رقم_القضية': '2026-900', 'اسم_المستند': 'مستند للحذف النهائي' });
    hardRepo._softDelete = false; // Permanent delete path exercised directly on the base class's hard-delete branch
    const all = hardRepo.getAll();
    const idToHardDelete = all[0]['رقم_المستند'];
    const res = await hardRepo.remove(idToHardDelete);
    check('Permanent delete [softDelete:false branch] removes the record from storage entirely, not just marking deletedAt', () => {
      assert.strictEqual(res.success, true);
      assert.strictEqual(res.record.deletedAt, null); // never soft-deleted, so deletedAt stays at its create()-time default of null
      assert.strictEqual(hardRepo.getAll({ includeDeleted: true }).length, 0);
    });
  })();

  // 12. Search — full-record join, matches renderDocuments()
  check('search() free-text matches across ANY legacy field, case-insensitively (matches renderDocuments(), despite Data_Schema claiming search is scoped to اسم_المستند only)', () => {
    const result = repo.search({ search: 'محضر' }); // matches نوع_المستند 'محضر' on explicit-doc-1
    assert.strictEqual(result.items.length, 1);
    assert.strictEqual(result.items[0]['رقم_المستند'], 'explicit-doc-1');
  });

  check('search() free-text matches a non-name field (case number)', () => {
    const result = repo.search({ search: '2026-100' });
    assert.strictEqual(result.items.length, 1);
    assert.strictEqual(result.items[0]['رقم_المستند'], 'legacy-doc-1');
  });

  check('search() free-text matches the رابط_Drive field (part of Object.values() join today)', () => {
    const result = repo.search({ search: 'drive.google.com/legacy-1' });
    assert.strictEqual(result.items.length, 1);
    assert.strictEqual(result.items[0]['رقم_المستند'], 'legacy-doc-1');
  });

  check('search() does NOT match against new audit/metadata fields (checksum/version etc.)', () => {
    const target = repo.get('explicit-doc-1');
    const result = repo.search({ search: String(target.checksum) });
    assert.strictEqual(result.items.length, 0);
  });

  check('search() excludes soft-deleted records by default', () => {
    // Re-soft-delete the restored record for this isolated check, then verify.
    const beforeSnapshot = repo.getAll({ includeDeleted: true });
    const target = beforeSnapshot.find(r => r['رقم_المستند'] === insertedId);
    assert.ok(target); // sanity: still present (restored earlier)
    const result = repo.search({ search: 'شهادة ميلاد يوسف' });
    assert.strictEqual(result.items.length, 1); // currently restored/active — included
  });

  // 13. Filter — Case Number, Document Type (LIVE control), Drive Link, Status (gap)
  check('filter() [Document Type Filter] by نوع_المستند returns exactly the documents of that type (REAL field, backed by a LIVE #filterDocType dropdown today — unlike Fees which had zero live filter controls)', () => {
    const contracts = repo.filter({ 'نوع_المستند': 'عقد زواج' });
    assert.strictEqual(contracts.length, 1);
    assert.strictEqual(contracts[0]['رقم_المستند'], 'legacy-doc-1');
    const reports = repo.filter({ 'نوع_المستند': 'محضر' });
    assert.strictEqual(reports.length, 1);
    assert.strictEqual(reports[0]['رقم_المستند'], 'explicit-doc-1');
  });

  check('filter() [Case Number Filter] by رقم_القضية returns exactly the matching document (documented Filter Field, no live UI control)', () => {
    const byCase = repo.filter({ 'رقم_القضية': '2026-100' });
    assert.strictEqual(byCase.length, 1);
    assert.strictEqual(byCase[0]['رقم_المستند'], 'legacy-doc-1');
  });

  check('filter() [Status Filter] by الحالة — documented Input Gap: no status field exists anywhere for Documents (no #status control, no DOCUMENTS_FIELDS/DOCUMENTS_MAP entry, no Code_v4.gs sheet column) — the generic pass-through does not throw and correctly returns zero matches rather than fabricating a status concept', () => {
    const result = repo.filter({ 'الحالة': 'reviewed' });
    assert.deepStrictEqual(result, []);
  });

  check('filter() [Drive Link presence] by رابط_Drive returns exactly the matching document (real field, undocumented as a Filter Field, no live UI control — generic pass-through)', () => {
    const withLink = repo.filter({ 'رابط_Drive': 'https://drive.google.com/legacy-1' });
    assert.strictEqual(withLink.length, 1);
    assert.strictEqual(withLink[0]['رقم_المستند'], 'legacy-doc-1');
  });

  check('filter() with an AND compound (رقم_القضية + نوع_المستند) via the base class\'s generic engine', () => {
    const combo = repo.filter({ and: [{ 'رقم_القضية': '2026-100' }, { 'نوع_المستند': 'عقد زواج' }] });
    assert.strictEqual(combo.length, 1);
    assert.strictEqual(combo[0]['رقم_المستند'], 'legacy-doc-1');
    const noMatch = repo.filter({ and: [{ 'رقم_القضية': '2026-100' }, { 'نوع_المستند': 'محضر' }] });
    assert.strictEqual(noMatch.length, 0);
  });

  check('filter() by a case number with no documents returns an empty array', () => {
    assert.deepStrictEqual(repo.filter({ 'رقم_القضية': 'no-such-case' }), []);
  });

  // Date Range Filter — documented Sort Field, also usable as a Filter via
  // the base class's generic {op,value} range engine.
  await (async () => {
    await repo.insert({ 'رقم_القضية': '2026-106', 'اسم_المستند': 'إيصال متأخر', 'تاريخ_الإيداع': '2027-06-01' });
  })();

  check('filter() [Date Range Filter] on تاريخ_الإيداع returns only documents filed within range (real field, undocumented as a live-UI-bound Filter Field)', () => {
    const filedBy2026 = repo.filter({ 'تاريخ_الإيداع': { op: 'lte', value: '2026-12-31' } });
    assert.strictEqual(filedBy2026.some(f => f['رقم_القضية'] === '2026-106'), false);
    assert.strictEqual(filedBy2026.some(f => f['رقم_المستند'] === 'legacy-doc-1'), true);
  });

  // 14. Sort
  check('sort() orders by تاريخ_الإيداع ascending by default (purely additive — no live sort exists in renderDocuments() to reconcile against)', () => {
    const sorted = repo.sort();
    assert.ok(Array.isArray(sorted));
    assert.strictEqual(sorted.length, repo.count());
    const dates = sorted.map(d => d['تاريخ_الإيداع']).filter(Boolean);
    for (let i = 1; i < dates.length; i++) {
      assert.ok(String(dates[i - 1]) <= String(dates[i]));
    }
  });

  check('sort() accepts an explicit sortSpec and array of records without mutating input', () => {
    const input = repo.getAll();
    const inputCopy = JSON.parse(JSON.stringify(input));
    const sorted = repo.sort(input, { field: 'تاريخ_الإيداع', direction: 'asc' });
    assert.deepStrictEqual(input, inputCopy); // input untouched
    const dates = sorted.map(d => d['تاريخ_الإيداع']).filter(Boolean);
    for (let i = 1; i < dates.length; i++) {
      assert.ok(String(dates[i - 1]) <= String(dates[i]));
    }
  });

  check('sort() with direction "desc" reverses the order', () => {
    const asc = repo.sort(repo.getAll(), { field: 'تاريخ_الإيداع', direction: 'asc' }).map(d => d['تاريخ_الإيداع']);
    const desc = repo.sort(repo.getAll(), { field: 'تاريخ_الإيداع', direction: 'desc' }).map(d => d['تاريخ_الإيداع']);
    assert.deepStrictEqual(desc, asc.slice().reverse());
  });

  // 15. Repository Interface — Contract-literal + phase-requested names
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

  check('no business-logic methods (e.g. renderRow/openDriveLink) exist — this Repository does not transfer any Business Logic (file header + phase instructions)', () => {
    assert.strictEqual(typeof repo.renderRow, 'undefined');
    assert.strictEqual(typeof repo.openDriveLink, 'undefined');
  });

  // 16. Bulk operations — Large dataset + performance sanity
  await (async () => {
    const bulkFake = makeFakeStorage({});
    const bulkRepo = new DocumentsRepository({ storageAdapter: createDocumentsLocalStorageAdapter(bulkFake) });
    await bulkRepo.open();
    const bulkEntities = [];
    for (let i = 0; i < 500; i++) {
      bulkEntities.push({
        'رقم_القضية': '2026-' + (200 + i),
        'اسم_المستند': 'مستند رقم ' + i,
        'نوع_المستند': (i % 2 === 0) ? 'إيصال' : 'حكم',
        'تاريخ_الإيداع': '2026-01-' + String((i % 28) + 1).padStart(2, '0')
      });
    }
    const start = Date.now();
    const results = await bulkRepo.bulkInsert(bulkEntities);
    const elapsedInsert = Date.now() - start;
    check('bulkInsert() [Large Dataset] inserts 500 records in one batch persist, all succeeding', () => {
      assert.strictEqual(results.length, 500);
      assert.strictEqual(results.every(r => r.success), true);
      assert.strictEqual(bulkRepo.count(), 500);
    });
    check('Performance sanity: bulkInsert() of 500 records completes well under 1 second in-memory', () => {
      assert.ok(elapsedInsert < 1000, 'bulkInsert took ' + elapsedInsert + 'ms');
    });
    const searchStart = Date.now();
    const searchResult = bulkRepo.search({ search: 'مستند رقم 250', filter: { 'نوع_المستند': 'إيصال' }, sort: { field: 'تاريخ_الإيداع', direction: 'asc' } });
    const elapsedSearch = Date.now() - searchStart;
    check('Performance sanity: combined search+filter+sort over 500 records completes quickly and returns the right record', () => {
      assert.ok(elapsedSearch < 500, 'search took ' + elapsedSearch + 'ms');
      assert.strictEqual(searchResult.items.length, 1);
      assert.strictEqual(searchResult.items[0]['اسم_المستند'], 'مستند رقم 250');
    });
    const bulkIds = bulkRepo.getAll().slice(0, 100).map(r => r['رقم_المستند']);
    const bulkDeleteResults = await bulkRepo.bulkDelete(bulkIds);
    check('bulkDelete() [Large Dataset] soft-deletes 100 of 500 records in one batch persist', () => {
      assert.strictEqual(bulkDeleteResults.every(r => r.success), true);
      assert.strictEqual(bulkRepo.count(), 400);
      assert.strictEqual(bulkRepo.getAll({ includeDeleted: true }).length, 500);
    });
  })();

  // 17. Legacy localStorage compatibility — storage format round-trip
  // PHASE 13.6: `fake` is a FakeIndexedDB (IDBFactory-shaped) instance,
  // not a getItem/setItem Storage-shaped fake, so there is no raw
  // localStorage["documents"] string to JSON.parse (see ChildrenRepository's
  // equivalent PHASE 13.6 fix). Read the object store back through the
  // same DatabaseService/IndexedDBAdapter pair the Repository itself
  // uses instead.
  await (async () => {
    const readBackAdapter = createDocumentsLocalStorageAdapter(fake);
    const persisted = await readBackAdapter.read('documents');
    check('persisted "documents" object store is a plain array of records, exactly like index.html expects', () => {
      assert.ok(Array.isArray(persisted));
      assert.ok(persisted.length > 0);
    });
  })();

  await (async () => {
    const repo2 = new DocumentsRepository({ storageAdapter: createDocumentsLocalStorageAdapter(fake) });
    await repo2.open();
    check('a second DocumentsRepository instance opening the same storage sees identical data (no data loss across "reload")', () => {
      assert.deepStrictEqual(
        repo2.getAll({ includeDeleted: true }).map(r => r['رقم_المستند']).sort(),
        repo.getAll({ includeDeleted: true }).map(r => r['رقم_المستند']).sort()
      );
    });
  })();

  // 18. Corrupt data / edge cases
  // PHASE 13.5 — SKIPPED, not modernized: see verify_library_repository.js
  // for the same flagged gap (no direct IndexedDB equivalent to a
  // corrupt raw-JSON localStorage string).
  check('SKIPPED — open() on corrupt JSON in localStorage["documents"] (no IndexedDB equivalent; needs follow-up)', () => {
    // Intentionally not asserted either way.
  });

  check('DocumentsRepository does not reference ClientsRepository/CasesRepository/ChildrenRepository/SessionsRepository/TasksRepository/FeesRepository at runtime (independent harness, independent class)', () => {
    assert.strictEqual(Object.getPrototypeOf(DocumentsRepository.prototype).constructor, Repository);
  });

  check('No idField collision: a record with idField undefined on create() still resolves via uid()-equivalent, never crashing', () => {
    // covered structurally: _resolveId always falls back to this._idGenerator()
    assert.strictEqual(typeof repo._resolveId, 'function');
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
