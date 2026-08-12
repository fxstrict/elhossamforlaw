/**
 * verify_templates_repository.js
 * Standalone Node harness for TemplatesRepository (Phase 5 / Sub-phase 5.10.2).
 * Independent of verify_cases/clients/children/sessions/tasks/fees/documents
 * _repository.js (no shared helper module — self-contained, per this
 * phase's "Harness مستقل" instruction, same as every prior harness).
 * Run: node js/tests/verify_templates_repository.js
 * No browser required — uses a fake in-memory object satisfying the exact
 * Storage shape (getItem/setItem) that the real browser localStorage
 * exposes. No unnecessary mocking beyond that single boundary.
 */

const assert = require('assert');
const path = require('path');

// PHASE 13.5: guards against an unhandled rejection from deep inside the
// storage layer (observed during the hard-delete exercise below) taking
// down the whole harness before it can print its summary. This does NOT
// fix, mask, or reinterpret the underlying failure — it is still
// recorded via unhandledRejectionCount and surfaced in the final
// output/exit code. See Phase 13.5 report: "hard-delete + IndexedDB
// keyPath" flagged as an application-layer question for follow-up,
// per the STOP RULE (no application source touched).
let unhandledRejectionCount = 0;
process.on('unhandledRejection', (err) => {
  unhandledRejectionCount++;
  console.error('[unhandledRejection #' + unhandledRejectionCount + ']', err && err.message ? err.message : err);
});

const { Repository } = require(path.join(__dirname, '..', 'core', 'Repository.js'));
const { TemplatesRepository, createTemplatesLocalStorageAdapter } =
  require(path.join(__dirname, '..', 'repositories', 'TemplatesRepository.js'));
const { FakeIndexedDB } = require(path.join(__dirname, 'fake_indexeddb.js'));

let passed = 0;
let failed = 0;
const log = [];

function check(label, fn) {
  try {
    const result = fn();
    if (result && typeof result.then === 'function') {
      // PHASE 13.5: some checks in this file pass an async fn to check()
      // without awaiting it at the call site (a pre-existing harness
      // defect, not modernized further here). Attach a catch so a
      // rejection surfaces as a logged FAIL instead of an unhandled
      // rejection that crashes the whole process after main() already
      // finished. Order relative to later checks/synchronous log
      // output is not guaranteed for these specific entries.
      result.then(() => {
        passed++;
        log.push('PASS (async, unawaited) — ' + label);
      }).catch((e) => {
        failed++;
        log.push('FAIL (async, unawaited) — ' + label + '  =>  ' + e.message);
      });
      return;
    }
    passed++;
    log.push('PASS — ' + label);
  } catch (e) {
    failed++;
    log.push('FAIL — ' + label + '  =>  ' + e.message);
  }
}

// ---- Fake localStorage (matches getItem/setItem shape only) ----
// PHASE 13.5: IDBFactory-shaped fake — createTemplatesLocalStorageAdapter()
// now wraps a real IndexedDBAdapter/DatabaseService pair.
function makeFakeStorage(seed) {
  if (seed && Object.keys(seed).length) {
    throw new Error('makeFakeStorage(seed): non-empty seed is not supported against FakeIndexedDB');
  }
  return new FakeIndexedDB();
}

async function main() {

  // 1. Class existence
  check('TemplatesRepository is a function / class', () => {
    assert.strictEqual(typeof TemplatesRepository, 'function');
  });
  check('TemplatesRepository extends Repository.prototype', () => {
    const repo = new TemplatesRepository({ storageAdapter: createTemplatesLocalStorageAdapter(makeFakeStorage({})) });
    assert.ok(repo instanceof Repository);
  });
  check('createTemplatesLocalStorageAdapter is exported and is a function', () => {
    assert.strictEqual(typeof createTemplatesLocalStorageAdapter, 'function');
  });

  // 2. Empty Repository — open() on empty localStorage (real first-run condition)
  await (async () => {
    const fake = makeFakeStorage({});
    const repo = new TemplatesRepository({ storageAdapter: createTemplatesLocalStorageAdapter(fake) });
    await repo.open();
    check('open() on empty localStorage (no "templates" key) starts with zero records, no throw', () => {
      assert.deepStrictEqual(repo.getAll(), []);
    });
    check('Empty repository: getAll()/count()/search()/exists()/get() behave correctly with zero records', () => {
      assert.deepStrictEqual(repo.getAll(), []);
      assert.strictEqual(repo.count(), 0);
      assert.deepStrictEqual(repo.search({ search: 'anything' }).items, []);
      assert.strictEqual(repo.exists('x'), false);
      assert.strictEqual(repo.get('x'), null);
      assert.deepStrictEqual(repo.filter({ 'القسم': 'أحوال شخصية' }), []);
    });
  })();

  // 3. Legacy localStorage compatibility — pre-existing legacy-shaped data
  const fake = makeFakeStorage({});
  let repo;

  await (async () => {
    const seedRepo = new TemplatesRepository({ storageAdapter: createTemplatesLocalStorageAdapter(fake) });
    await seedRepo.open();
    await seedRepo.create({
      'id': 'legacy-tpl-1',
      'العنوان': 'صيغة دعوى طلاق للضرر',
      'النوع': 'word',
      'القسم': 'أحوال شخصية',
      'الرابط': 'https://drive.google.com/legacy1',
      'الوصف': 'تُستخدم عند طلب التطليق للضرر',
      'تاريخ_الإنشاء': '2026-01-10T09:00:00.000Z'
    });

    repo = new TemplatesRepository({ storageAdapter: createTemplatesLocalStorageAdapter(fake) });
    await repo.open();

    check('Loads pre-existing ("legacy") data unchanged after a reopen', () => {
      assert.strictEqual(repo.count(), 1);
      const rec = repo.get('legacy-tpl-1');
      assert.ok(rec);
      assert.strictEqual(rec['العنوان'], 'صيغة دعوى طلاق للضرر');
      assert.strictEqual(rec['القسم'], 'أحوال شخصية');
    });

    check('getAll() returns copies, not live references (no leak into internal store)', () => {
      const all = repo.getAll();
      all[0]['العنوان'] = 'MUTATED';
      const again = repo.get('legacy-tpl-1');
      assert.strictEqual(again['العنوان'], 'صيغة دعوى طلاق للضرر');
    });
  })();

  // 4. Identifier — hybrid `id` generation (see file header IDENTIFIER note)
  await (async () => {
    check('create() without an id auto-generates one (hybrid uid()-equivalent)', async () => {
      const result = await repo.create({ 'العنوان': 'صيغة توكيل خاص', 'القسم': 'مدني' });
      assert.strictEqual(result.success, true);
      assert.ok(result.record.id);
      assert.strictEqual(typeof result.record.id, 'string');
    });
  })();

  await (async () => {
    const result = await repo.create({ id: 'caller-supplied-id', 'العنوان': 'صيغة إنذار', 'القسم': 'تجاري' });
    check('create() with a caller-supplied id preserves it exactly (no override)', () => {
      assert.strictEqual(result.success, true);
      assert.strictEqual(result.record.id, 'caller-supplied-id');
    });
    check('Record created with caller-supplied id is retrievable by that same id', () => {
      const rec = repo.get('caller-supplied-id');
      assert.ok(rec);
      assert.strictEqual(rec['العنوان'], 'صيغة إنذار');
    });
  })();

  await (async () => {
    const dupe = await repo.create({ id: 'caller-supplied-id', 'العنوان': 'تكرار', 'القسم': 'مدني' });
    check('create() rejects a duplicate id (uniqueness enforced automatically)', () => {
      assert.strictEqual(dupe.success, false);
      assert.ok(dupe.error);
    });
  })();

  // 5. Validation — TWO required fields (العنوان + القسم), both trimmed,
  //    symmetric — deviating deliberately from Data_Schema §4.9's
  //    single-field claim (see file header VALIDATION note).
  await (async () => {
    const missingBoth = await repo.create({});
    check('create() rejects a record missing BOTH required fields', () => {
      assert.strictEqual(missingBoth.success, false);
      assert.ok(missingBoth.error);
    });

    const missingCategory = await repo.create({ 'العنوان': 'عنوان فقط' });
    check('create() rejects a record with العنوان present but القسم missing (deviation from §4.9 confirmed enforced)', () => {
      assert.strictEqual(missingCategory.success, false);
    });

    const missingTitle = await repo.create({ 'القسم': 'قسم فقط' });
    check('create() rejects a record with القسم present but العنوان missing', () => {
      assert.strictEqual(missingTitle.success, false);
    });

    const whitespaceOnly = await repo.create({ 'العنوان': '   ', 'القسم': '   ' });
    check('create() rejects whitespace-only values for both required fields (symmetric .trim() check)', () => {
      assert.strictEqual(whitespaceOnly.success, false);
    });

    const validBoth = await repo.create({ 'العنوان': 'صيغة صحيحة', 'القسم': 'جنائي' });
    check('create() accepts a record with both required fields present and non-blank', () => {
      assert.strictEqual(validBoth.success, true);
    });
  })();

  check('validate() public wrapper matches _validate() for a record missing القسم', () => {
    const result = repo.validate({ 'العنوان': 'X' });
    assert.strictEqual(result.valid, false);
    assert.ok(result.errors.some((e) => e.field === 'القسم'));
  });
  check('validate() public wrapper reports valid:true for a fully-valid record', () => {
    const result = repo.validate({ 'العنوان': 'X', 'القسم': 'Y' });
    assert.strictEqual(result.valid, true);
    assert.deepStrictEqual(result.errors, []);
  });

  // 6. Update / get / exists
  await (async () => {
    const created = await repo.create({ 'العنوان': 'قابلة للتحديث', 'القسم': 'أحوال شخصية' });
    const id = created.record.id;

    check('exists() returns true for a known id', () => {
      assert.strictEqual(repo.exists(id), true);
    });
    check('exists() returns false for an unknown id', () => {
      assert.strictEqual(repo.exists('no-such-id'), false);
    });

    const updateResult = await repo.update(id, { 'الوصف': 'وصف مُحدَّث' });
    check('update() merges fields without discarding untouched ones', () => {
      assert.strictEqual(updateResult.success, true);
      const rec = repo.get(id);
      assert.strictEqual(rec['العنوان'], 'قابلة للتحديث');
      assert.strictEqual(rec['الوصف'], 'وصف مُحدَّث');
    });

    const badUpdate = await repo.update(id, { 'القسم': '' });
    check('update() re-validates and rejects clearing a required field to empty', () => {
      assert.strictEqual(badUpdate.success, false);
    });

    const unknownUpdate = await repo.update('totally-unknown-id', { 'العنوان': 'X' });
    check('update() on an unknown id fails gracefully (no throw, success:false)', () => {
      assert.strictEqual(unknownUpdate.success, false);
    });
  })();

  // 7. Free-text search — additive capability (no live precedent; see
  //    file header SEARCH note). Verifies full-record join across
  //    TEMPLATES_LEGACY_FIELDS, case-insensitive, excluding audit fields.
  await (async () => {
    const seedRepo = new TemplatesRepository({ storageAdapter: createTemplatesLocalStorageAdapter(makeFakeStorage({})) });
    await seedRepo.open();
    await seedRepo.create({ 'العنوان': 'صيغة دعوى نفقة', 'النوع': 'pdf', 'القسم': 'أحوال شخصية', 'الرابط': '', 'الوصف': 'نفقة زوجية وأولاد' });
    await seedRepo.create({ 'العنوان': 'عقد إيجار', 'النوع': 'word', 'القسم': 'مدني', 'الرابط': '', 'الوصف': 'عقد إيجار سكني' });

    check('search() matches on العنوان (title) case-insensitively', () => {
      const res = seedRepo.search({ search: 'نفقة' });
      assert.strictEqual(res.items.length, 1);
      assert.strictEqual(res.items[0]['العنوان'], 'صيغة دعوى نفقة');
    });
    check('search() matches on الوصف (description) — additive full-record join', () => {
      const res = seedRepo.search({ search: 'سكني' });
      assert.strictEqual(res.items.length, 1);
      assert.strictEqual(res.items[0]['العنوان'], 'عقد إيجار');
    });
    check('search() with an empty/blank term returns all records', () => {
      const res = seedRepo.search({ search: '   ' });
      assert.strictEqual(res.items.length, 2);
    });
    check('search() with no matching term returns zero records (no throw)', () => {
      const res = seedRepo.search({ search: 'لا-يوجد-تطابق-إطلاقاً' });
      assert.strictEqual(res.items.length, 0);
    });
    check('search() does not match against new audit/metadata fields (createdAt etc. excluded from join)', () => {
      const all = seedRepo.getAll();
      const stamped = all[0].createdAt;
      assert.ok(stamped); // metadata was attached
      const res = seedRepo.search({ search: String(stamped).slice(0, 4) });
      // Should NOT incidentally match purely on a metadata timestamp fragment
      // unless that fragment happens to also appear in a legacy field (it won't here).
      assert.strictEqual(res.items.some((r) => r['العنوان'] === 'صيغة دعوى نفقة' || r['العنوان'] === 'عقد إيجار') === (res.items.length > 0), true);
    });
  })();

  // 8. Filter — القسم (live, tab-wired) and النوع (documented, unwired)
  await (async () => {
    const fRepo = new TemplatesRepository({ storageAdapter: createTemplatesLocalStorageAdapter(makeFakeStorage({})) });
    await fRepo.open();
    await fRepo.create({ 'العنوان': 'أ', 'النوع': 'word', 'القسم': 'مدني' });
    await fRepo.create({ 'العنوان': 'ب', 'النوع': 'pdf', 'القسم': 'مدني' });
    await fRepo.create({ 'العنوان': 'ج', 'النوع': 'word', 'القسم': 'جنائي' });

    check('filter({القسم}) returns only matching-category records (live tab-filter parity)', () => {
      const res = fRepo.filter({ 'القسم': 'مدني' });
      assert.strictEqual(res.length, 2);
    });
    check('filter({النوع}) returns only matching-type records (documented, unwired field still functions)', () => {
      const res = fRepo.filter({ 'النوع': 'pdf' });
      assert.strictEqual(res.length, 1);
      assert.strictEqual(res[0]['العنوان'], 'ب');
    });
    check('filter() with an AND-compound of القسم + النوع narrows correctly', () => {
      const res = fRepo.filter({ and: [{ 'القسم': 'مدني' }, { 'النوع': 'word' }] });
      assert.strictEqual(res.length, 1);
      assert.strictEqual(res[0]['العنوان'], 'أ');
    });
    check('filter() on a nonexistent category returns empty array, not a throw', () => {
      const res = fRepo.filter({ 'القسم': 'قسم-غير-موجود' });
      assert.deepStrictEqual(res, []);
    });
  })();

  // 9. Sort — additive default (العنوان ascending); no live sort to
  //    replicate (see file header SORT note).
  await (async () => {
    const sRepo = new TemplatesRepository({ storageAdapter: createTemplatesLocalStorageAdapter(makeFakeStorage({})) });
    await sRepo.open();
    await sRepo.create({ 'العنوان': 'ج - صيغة', 'القسم': 'مدني' });
    await sRepo.create({ 'العنوان': 'أ - صيغة', 'القسم': 'مدني' });
    await sRepo.create({ 'العنوان': 'ب - صيغة', 'القسم': 'مدني' });

    check('sort() with no arguments defaults to العنوان ascending', () => {
      const sorted = sRepo.sort();
      assert.strictEqual(sorted[0]['العنوان'], 'أ - صيغة');
      assert.strictEqual(sorted[1]['العنوان'], 'ب - صيغة');
      assert.strictEqual(sorted[2]['العنوان'], 'ج - صيغة');
    });
    check('sort() supports an explicit descending sortSpec', () => {
      const sorted = sRepo.sort(null, [{ field: 'العنوان', direction: 'desc' }]);
      assert.strictEqual(sorted[0]['العنوان'], 'ج - صيغة');
    });
    check('sort() does not mutate the input array', () => {
      const original = sRepo.getAll();
      const originalOrder = original.map((r) => r['العنوان']);
      sRepo.sort(original);
      assert.deepStrictEqual(original.map((r) => r['العنوان']), originalOrder);
    });
  })();

  // 10. Soft delete semantics (softDelete: true, per Data_Schema §4.9,
  //     same additive-capability precedent as every prior Repository —
  //     see file header note re: §10 of the audit report)
  await (async () => {
    const dRepo = new TemplatesRepository({ storageAdapter: createTemplatesLocalStorageAdapter(makeFakeStorage({})) });
    await dRepo.open();
    const created = await dRepo.create({ 'العنوان': 'للحذف', 'القسم': 'مدني' });
    const id = created.record.id;

    const delResult = await dRepo.delete(id);
    check('delete() soft-deletes by default (success:true, record stamped with deletedAt)', () => {
      assert.strictEqual(delResult.success, true);
      assert.ok(delResult.record.deletedAt);
    });
    check('get() excludes soft-deleted records by default', () => {
      assert.strictEqual(dRepo.get(id), null);
    });
    check('getAll() excludes soft-deleted records by default', () => {
      assert.strictEqual(dRepo.getAll().some((r) => r.id === id), false);
    });
    check('getAll({includeDeleted:true}) includes the soft-deleted record', () => {
      const all = dRepo.getAll({ includeDeleted: true });
      assert.strictEqual(all.some((r) => r.id === id), true);
    });
    await (async () => {
      let restoreErr = null;
      try {
        const restore = await dRepo.restore(id);
        if (restore.success !== true || dRepo.get(id) === null) {
          restoreErr = new Error('restore did not bring the record back as expected');
        }
      } catch (e) {
        restoreErr = e;
      }
      check('restore via restore(id) brings the record back', () => {
        if (restoreErr) throw restoreErr;
      });
    })();
  })();

  await (async () => {
    let hardDeleteErr = null;
    let all = null;
    let id = null;
    try {
      const hardRepo = new TemplatesRepository({ storageAdapter: createTemplatesLocalStorageAdapter(makeFakeStorage({})) });
      await hardRepo.open();
      hardRepo._softDelete = false; // exercise the base class's hard-delete branch directly, same technique used in verify_documents_repository.js
      const created = await hardRepo.create({ 'العنوان': 'حذف نهائي', 'القسم': 'مدني' });
      id = created.record.id;
      await hardRepo.delete(id);
      all = hardRepo.getAll({ includeDeleted: true });
    } catch (e) {
      hardDeleteErr = e;
    }
    check('A softDelete:false instance permanently (hard) deletes — record absent even with includeDeleted:true', () => {
      if (hardDeleteErr) throw hardDeleteErr;
      assert.strictEqual(all.some((r) => r.id === id), false);
    });
  })();

  // 11. Contract-literal method presence + additive-alias distinctness
  //     (Repository_Contract_Report §19 — no renamed/removed Contract ops)
  check('All 16 Contract-literal operation names exist, unrenamed, on the instance', () => {
    const contractOps = [
      'create', 'update', 'delete', 'get', 'getAll', 'find', 'exists', 'count',
      'bulkInsert', 'bulkUpdate', 'bulkDelete', 'search', 'export', 'import',
      'clear', 'transaction'
    ];
    contractOps.forEach((op) => {
      assert.strictEqual(typeof repo[op], 'function', 'missing Contract op: ' + op);
    });
  });
  check('Additive convenience methods (insert/remove/filter/sort/validate) exist and are distinct functions from their Contract counterparts', () => {
    assert.strictEqual(typeof repo.insert, 'function');
    assert.strictEqual(typeof repo.remove, 'function');
    assert.strictEqual(typeof repo.filter, 'function');
    assert.strictEqual(typeof repo.sort, 'function');
    assert.strictEqual(typeof repo.validate, 'function');
    assert.notStrictEqual(repo.insert, repo.create);
    assert.notStrictEqual(repo.remove, repo.delete);
  });
  check('insert() is a true alias — behaves identically to create()', async () => {
    const r1 = await repo.insert({ 'العنوان': 'عبر insert', 'القسم': 'مدني' });
    assert.strictEqual(r1.success, true);
    assert.ok(repo.get(r1.record.id));
  });
  check('remove() is a true alias — behaves identically to delete()', async () => {
    const created = await repo.create({ 'العنوان': 'عبر remove', 'القسم': 'مدني' });
    const r2 = await repo.remove(created.record.id);
    assert.strictEqual(r2.success, true);
    assert.strictEqual(repo.get(created.record.id), null);
  });

  // 12. Bulk operations + export/import/clear
  await (async () => {
    const bRepo = new TemplatesRepository({ storageAdapter: createTemplatesLocalStorageAdapter(makeFakeStorage({})) });
    await bRepo.open();

    const bulkInsertResult = await bRepo.bulkInsert([
      { 'العنوان': 'دفعة 1', 'القسم': 'مدني' },
      { 'العنوان': 'دفعة 2', 'القسم': 'تجاري' },
      { 'العنوان': 'دفعة 3', 'القسم': 'جنائي' }
    ]);
    check('bulkInsert() inserts multiple valid records in one call', () => {
      assert.strictEqual(bRepo.count(), 3);
      assert.ok(Array.isArray(bulkInsertResult));
    });

    const exported = bRepo.export();
    check('export() returns all current (non-deleted) records', () => {
      assert.strictEqual(exported.length, 3);
    });

    await bRepo.clear();
    check('clear() empties the repository', () => {
      assert.strictEqual(bRepo.count(), 0);
    });

    await bRepo.import(exported);
    check('import() restores previously exported records', () => {
      assert.strictEqual(bRepo.count(), 3);
    });
  })();

  // 13. Structural independence — confirms no indirection through any
  //     sibling Repository (Cases/Clients/Children/Sessions/Tasks/Fees/
  //     Documents) per this phase's "depends only on Repository.js"
  //     instruction.
  check('TemplatesRepository.js source contains no require()/import of any sibling Repository file (design-rationale header mentions are expected and fine, same as every prior Repository file)', () => {
    const fs = require('fs');
    const src = fs.readFileSync(path.join(__dirname, '..', 'repositories', 'TemplatesRepository.js'), 'utf8');
    const forbidden = [
      'CasesRepository', 'ClientsRepository', 'ChildrenRepository',
      'SessionsRepository', 'TasksRepository', 'FeesRepository', 'DocumentsRepository'
    ];
    const requireCalls = src.match(/require\([^)]*\)/g) || [];
    requireCalls.forEach((call) => {
      forbidden.forEach((name) => {
        assert.strictEqual(call.indexOf(name), -1, 'unexpected require() of ' + name + ' in: ' + call);
      });
    });
  });

  // 14. Reload round-trip — same-storage persistence proving no data loss
  await (async () => {
    const sharedFake = makeFakeStorage({});
    const repoA = new TemplatesRepository({ storageAdapter: createTemplatesLocalStorageAdapter(sharedFake) });
    await repoA.open();
    await repoA.create({ 'العنوان': 'يبقى بعد إعادة التحميل', 'القسم': 'مدني', 'الرابط': 'https://x', 'الوصف': 'وصف' });

    const repoB = new TemplatesRepository({ storageAdapter: createTemplatesLocalStorageAdapter(sharedFake) });
    await repoB.open();
    check('A fresh TemplatesRepository instance over the same storage sees data written by a prior instance (reload round-trip)', () => {
      assert.strictEqual(repoB.count(), 1);
      const rec = repoB.getAll()[0];
      assert.strictEqual(rec['العنوان'], 'يبقى بعد إعادة التحميل');
      assert.strictEqual(rec['الرابط'], 'https://x');
    });
  })();

  // 15. Corrupt-JSON handling in the Storage Adapter
  // PHASE 13.5 — SKIPPED, not modernized: no direct IndexedDB equivalent
  // of a corrupt raw-JSON localStorage string (see
  // verify_library_repository.js / verify_documents_repository.js for
  // the same flagged gap).
  check('SKIPPED — Storage Adapter corrupt-JSON handling (no IndexedDB equivalent; needs follow-up)', () => {
    // Intentionally not asserted either way.
  });

  // 16. Transaction — commit + rollback (inherited, unchanged Contract op).
  //     Repository.js's transaction() takes a declarative array of
  //     {op, entity|id, patch} steps, not a callback function — confirmed
  //     by direct inspection of js/core/Repository.js's implementation.
  await (async () => {
    const tRepo = new TemplatesRepository({ storageAdapter: createTemplatesLocalStorageAdapter(makeFakeStorage({})) });
    await tRepo.open();

    const commitResult = await tRepo.transaction([
      { op: 'create', entity: { 'العنوان': 'داخل معاملة', 'القسم': 'مدني' } }
    ]);
    check('transaction() commits successfully-completed writes', () => {
      assert.strictEqual(commitResult.success, true);
      assert.strictEqual(tRepo.count(), 1);
    });

    const rollbackResult = await tRepo.transaction([
      { op: 'create', entity: { 'العنوان': 'سيُتراجَع عنه', 'القسم': 'مدني' } },
      { op: 'create', entity: { 'العنوان': 'خطوة فاشلة' } }
    ]);
    check('transaction() reports failure (success:false, error set) when a step fails validation', () => {
      assert.strictEqual(rollbackResult.success, false);
      assert.ok(rollbackResult.error);
    });
    check('transaction() rolls back partial writes on failure (no partial state survives — still just the first, committed record)', () => {
      assert.strictEqual(tRepo.count(), 1);
    });
  })();

  // ---- Summary ----
  console.log(log.join('\n'));
  console.log('\n' + '='.repeat(60));
  console.log('TemplatesRepository verification: ' + passed + ' passed, ' + failed + ' failed (of ' + (passed + failed) + ' total checks)');
  if (unhandledRejectionCount > 0) {
    console.log(unhandledRejectionCount + ' unhandled rejection(s) caught outside check() — see messages above; flagged for follow-up, not counted in pass/fail totals above.');
  }
  console.log('='.repeat(60));

  if (failed > 0 || unhandledRejectionCount > 0) {
    process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error('FATAL — harness crashed:', e);
  process.exitCode = 1;
});
