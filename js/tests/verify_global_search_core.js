/**
 * verify_global_search_core.js
 * PHASE 02 — GLOBAL SEARCH / SEARCH WORKSPACE — STEP 1 CORE TEST.
 * Standalone Node harness for js/modules/global-search.js
 * (GlobalSearchController + groupSearchResults + SearchHistoryStore).
 * Run: node verify_global_search_core.js
 * No browser required.
 *
 * Mirrors the project's existing verify_opponents_repository.js /
 * verify_clients_repository.js structure (same FakeIndexedDB double,
 * same check()/log()/summary harness) — wires REAL, unmodified
 * Repository subclasses (CasesRepository, ClientsRepository, ...)
 * against a fake IndexedDB store, exactly like those tests, then
 * injects them into a real GlobalSearchController instance. Nothing in
 * js/core/Repository.js or js/repositories/*.js is touched or
 * re-implemented here — this only proves the NEW aggregation layer
 * behaves correctly on top of the EXISTING, unmodified search() API.
 */

const assert = require('assert');
const path = require('path');

const { Repository } = require(path.join(__dirname, '..', 'core', 'Repository.js'));
const { FakeIndexedDB } = require(path.join(__dirname, 'fake_indexeddb.js'));

const { CasesRepository, createCasesLocalStorageAdapter } =
  require(path.join(__dirname, '..', 'repositories', 'CasesRepository.js'));
const { ClientsRepository, createClientsLocalStorageAdapter } =
  require(path.join(__dirname, '..', 'repositories', 'ClientsRepository.js'));
const { SessionsRepository, createSessionsLocalStorageAdapter } =
  require(path.join(__dirname, '..', 'repositories', 'SessionsRepository.js'));
const { DocumentsRepository, createDocumentsLocalStorageAdapter } =
  require(path.join(__dirname, '..', 'repositories', 'DocumentsRepository.js'));
const { TasksRepository, createTasksLocalStorageAdapter } =
  require(path.join(__dirname, '..', 'repositories', 'TasksRepository.js'));
const { OpponentsRepository, createOpponentsLocalStorageAdapter } =
  require(path.join(__dirname, '..', 'repositories', 'OpponentsRepository.js'));
const { ChildrenRepository, createChildrenLocalStorageAdapter } =
  require(path.join(__dirname, '..', 'repositories', 'ChildrenRepository.js'));

const {
  GlobalSearchController,
  groupSearchResults,
  GLOBAL_SEARCH_ENTITY_DEFS
} = require(path.join(__dirname, '..', 'modules', 'global-search.js'));

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

async function buildRepo(RepoClass, createAdapter, fake) {
  const repo = new RepoClass({ storageAdapter: createAdapter(fake) });
  await repo.open();
  return repo;
}

async function main() {

  // ================================================================
  // Section A — construction / entity-def sanity
  // ================================================================

  check('GlobalSearchController is a function/class', () => {
    assert.strictEqual(typeof GlobalSearchController, 'function');
  });

  check('GLOBAL_SEARCH_ENTITY_DEFS includes all 12 audited entities', () => {
    const types = GLOBAL_SEARCH_ENTITY_DEFS.map(d => d.type).sort();
    assert.deepStrictEqual(types, [
      'case', 'child', 'client', 'document', 'expense', 'fee',
      'library', 'opponent', 'processServerWork', 'session',
      'task', 'template'
    ].sort());
  });

  check('a controller with an empty repositories map supports zero entity types', () => {
    const ctrl = new GlobalSearchController({});
    assert.deepStrictEqual(ctrl.getSupportedEntityTypes(), []);
  });

  check('searchEntity() on an unwired entity type returns zero items, no error', () => {
    const ctrl = new GlobalSearchController({});
    const r = ctrl.searchEntity('case', 'قضية');
    assert.strictEqual(r.items.length, 0);
    assert.strictEqual(r.total, 0);
    assert.strictEqual(r.error, null);
  });

  check('searchEntity() on an unknown entity type returns a real error', () => {
    const ctrl = new GlobalSearchController({});
    const r = ctrl.searchEntity('not_a_real_entity', 'x');
    assert.ok(r.error && /Unknown entity type/.test(r.error.message));
  });

  // ================================================================
  // Section B — real Repository wiring, one shared fake IndexedDB
  // ================================================================

  await (async () => {
    const fake = makeFakeStorage();

    const casesRepository = await buildRepo(CasesRepository, createCasesLocalStorageAdapter, fake);
    const clientsRepository = await buildRepo(ClientsRepository, createClientsLocalStorageAdapter, fake);
    const sessionsRepository = await buildRepo(SessionsRepository, createSessionsLocalStorageAdapter, fake);
    const documentsRepository = await buildRepo(DocumentsRepository, createDocumentsLocalStorageAdapter, fake);
    const tasksRepository = await buildRepo(TasksRepository, createTasksLocalStorageAdapter, fake);
    const opponentsRepository = await buildRepo(OpponentsRepository, createOpponentsLocalStorageAdapter, fake);
    const childrenRepository = await buildRepo(ChildrenRepository, createChildrenLocalStorageAdapter, fake);

    // Seed one findable, distinctively-named record per entity.
    await casesRepository.insert({ 'رقم_القضية': 'C-1', 'عنوان_القضية': 'نفقة محمد', 'اسم_الموكل': 'أحمد علي', 'الحالة': 'قيد النظر' });
    await casesRepository.insert({ 'رقم_القضية': 'C-2', 'عنوان_القضية': 'طلاق سارة', 'اسم_الموكل': 'سارة محمود' });
    await clientsRepository.insert({ 'رقم_الموكل': 'CL-1', 'الاسم': 'محمد إبراهيم', 'الهاتف': '0100000000' });
    const sessionInsert = await sessionsRepository.insert({ 'رقم_الجلسة': 'S-1', 'رقم_القضية': 'C-1', 'عنوان_القضية': 'نفقة محمد', 'المحكمة': 'محكمة الأسرة', 'التاريخ': '2026-01-01', 'الوقت': '10:00' });
    await documentsRepository.insert({ 'رقم_المستند': 'D-1', 'اسم_المستند': 'عقد محمد', 'رقم_القضية': 'C-1' });
    await tasksRepository.insert({ 'رقم_المهمة': 'T-1', 'العنوان': 'متابعة محمد', 'الحالة': 'مفتوحة' });
    await opponentsRepository.insert({ 'رقم_الخصم': 'O-1', 'الاسم': 'محمد الخصم' });
    const childInsert = await childrenRepository.insert({ 'رقم_الطفل': 'CH-1', 'رقم_القضية': 'C-1', 'الاسم': 'طفل محمد' });

    check('(seed) session insert succeeded — required fields satisfied', () => {
      assert.ok(sessionInsert && sessionInsert.success, JSON.stringify(sessionInsert && sessionInsert.error));
    });
    check('(seed) child insert succeeded — required fields satisfied', () => {
      assert.ok(childInsert && childInsert.success, JSON.stringify(childInsert && childInsert.error));
    });

    const repositories = {
      case: casesRepository,
      client: clientsRepository,
      session: sessionsRepository,
      document: documentsRepository,
      task: tasksRepository,
      opponent: opponentsRepository,
      child: childrenRepository
    };
    const ctrl = new GlobalSearchController(repositories);

    // ---- STEP 1 TEST §12: per-entity searches ----

    check('Case Search — known term returns the seeded Case', () => {
      const r = ctrl.searchEntity('case', 'نفقة');
      assert.strictEqual(r.error, null);
      assert.strictEqual(r.total, 1);
      assert.strictEqual(r.items[0].entityId, 'C-1');
      assert.strictEqual(r.items[0].type, 'case');
    });

    check('Client Search — known term returns the seeded Client', () => {
      const r = ctrl.searchEntity('client', 'محمد إبراهيم');
      assert.strictEqual(r.total, 1);
      assert.strictEqual(r.items[0].entityId, 'CL-1');
    });

    check('Session Search — known term returns the seeded Session', () => {
      const r = ctrl.searchEntity('session', 'الأسرة');
      assert.strictEqual(r.total, 1);
      assert.strictEqual(r.items[0].entityId, 'S-1');
    });

    check('Document Search — known term returns the seeded Document', () => {
      const r = ctrl.searchEntity('document', 'عقد محمد');
      assert.strictEqual(r.total, 1);
      assert.strictEqual(r.items[0].entityId, 'D-1');
    });

    check('Task Search — known term returns the seeded Task', () => {
      const r = ctrl.searchEntity('task', 'متابعة');
      assert.strictEqual(r.total, 1);
      assert.strictEqual(r.items[0].entityId, 'T-1');
    });

    check('Opponent Search — now included and returns the seeded Opponent', () => {
      const r = ctrl.searchEntity('opponent', 'محمد الخصم');
      assert.strictEqual(r.total, 1);
      assert.strictEqual(r.items[0].entityId, 'O-1');
    });

    check('Child Search — included and returns the seeded Child', () => {
      const r = ctrl.searchEntity('child', 'طفل محمد');
      assert.strictEqual(r.total, 1);
      assert.strictEqual(r.items[0].entityId, 'CH-1');
    });

    // ---- empty / whitespace query ----

    check('empty query ("") returns zero items for every entity, no Repository call needed', () => {
      const r = ctrl.searchAll('');
      assert.strictEqual(r.totalCount, 0);
      r.groups.forEach(g => assert.strictEqual(g.items.length, 0));
    });

    check('whitespace-only query ("   ") behaves identically to empty query', () => {
      const r = ctrl.searchAll('   ');
      assert.strictEqual(r.totalCount, 0);
    });

    // ---- case-insensitive behavior (inherited from Repository._matchesSearch) ----

    check('case-insensitive-equivalent behavior is inherited unchanged from Repository.search()', () => {
      // Arabic has no case distinction, so this proves the pass-through
      // itself: mixed partial substrings still match exactly like a
      // direct repository.search() call would (no re-implementation of
      // matching here).
      const direct = casesRepository.search({ search: 'نفقة' });
      const viaController = ctrl.searchEntity('case', 'نفقة');
      assert.strictEqual(viaController.total, direct.total);
      assert.strictEqual(viaController.items.length, direct.items.length);
    });

    // ---- Search All: multiple entities in one call ----

    check('Search All — "محمد" collects results from more than one entity in a single call', () => {
      const r = ctrl.searchAll('محمد');
      const typesWithHits = r.groups.filter(g => g.items.length > 0).map(g => g.type);
      assert.ok(typesWithHits.length > 1, 'expected hits in more than one entity, got: ' + typesWithHits.join(','));
      assert.ok(typesWithHits.includes('case'));
      assert.ok(typesWithHits.includes('client'));
      assert.ok(typesWithHits.includes('document'));
      assert.ok(typesWithHits.includes('opponent'));
      assert.ok(typesWithHits.includes('child'));
    });

    check('Search All — totalCount equals the sum of every group\'s total', () => {
      const r = ctrl.searchAll('محمد');
      const sum = r.groups.reduce((s, g) => s + g.total, 0);
      assert.strictEqual(r.totalCount, sum);
    });

    check('Search All — entityTypes option (Search Scope = single entity) restricts the search', () => {
      const r = ctrl.searchAll('محمد', { entityTypes: ['case'] });
      assert.strictEqual(r.groups.length, 1);
      assert.strictEqual(r.groups[0].type, 'case');
    });

    check('Search All uses the SAME method for "الكل" and for a single scope (no parallel search function)', () => {
      // Both call sites below are literally ctrl.searchAll — proving the
      // Workspace UI never needs (and per PHASE 02 §17 must never use) a
      // different function per UI state.
      const all = ctrl.searchAll('محمد');
      const scoped = ctrl.searchAll('محمد', { entityTypes: ['client'] });
      assert.ok(all.groups.length > scoped.groups.length);
    });

    // ---- Result Normalization ----

    check('normalized result items expose {type, entityId, label, secondaryLabel, status, date, page, meta}', () => {
      const r = ctrl.searchEntity('case', 'نفقة');
      const item = r.items[0];
      assert.strictEqual(item.type, 'case');
      assert.strictEqual(item.entityId, 'C-1');
      assert.strictEqual(item.label, 'C-1 — نفقة محمد');
      assert.strictEqual(item.secondaryLabel, 'أحمد علي');
      assert.strictEqual(item.status, 'قيد النظر');
      assert.strictEqual(item.page, 'cases');
      assert.strictEqual(item.meta.entityLabelAr, 'قضية');
    });

    check('normalization never invents a field the record does not have (null, not a fabricated value)', () => {
      const r = ctrl.searchEntity('client', 'محمد إبراهيم');
      // ClientsRepository records have no "status"/"date" concept in this
      // schema — must be null, never a guessed value.
      assert.strictEqual(r.items[0].status, null);
      assert.strictEqual(r.items[0].date, null);
    });

    // ---- Grouping ----

    check('groupSearchResults() drops entities with zero hits and no error', () => {
      const r = ctrl.searchAll('نفقة');
      const grouped = groupSearchResults(r);
      grouped.groups.forEach(g => assert.ok(g.items.length > 0 || g.error, 'empty group leaked through: ' + g.type));
    });

    check('groupSearchResults() flatItems length equals the sum of each surviving group\'s items', () => {
      const r = ctrl.searchAll('محمد');
      const grouped = groupSearchResults(r);
      const sum = grouped.groups.reduce((s, g) => s + g.items.length, 0);
      assert.strictEqual(grouped.flatItems.length, sum);
    });

    // ---- Result Counts ----

    check('per-entity group carries its own real total (from Repository pagination metadata, not invented)', () => {
      const r = ctrl.searchAll('محمد', { limit: 1 }); // force pagination: only 1 item returned per entity...
      const caseGroup = r.groups.find(g => g.type === 'case');
      // ...but "case" has 2 matches for "محمد" title-wise? Actually only
      // C-1 matches 'محمد' among cases (C-2 does not) — assert the
      // count matches what repository.search() itself reports, whatever
      // it is, rather than assuming a specific number here.
      const direct = casesRepository.search({ search: 'محمد', limit: 1 });
      assert.strictEqual(caseGroup.total, direct.total);
      assert.ok(caseGroup.items.length <= 1, 'limit option was not honored');
    });

    // ---- Error handling: closed/unready repository ----

    check('searchEntity() reports error (not a throw) when a Repository is not ready', () => {
      const freshFake = makeFakeStorage();
      const notOpenedRepo = new CasesRepository({ storageAdapter: createCasesLocalStorageAdapter(freshFake) });
      const ctrl2 = new GlobalSearchController({ case: notOpenedRepo });
      const r = ctrl2.searchEntity('case', 'أي شيء');
      assert.ok(r.error && /not ready/.test(r.error.message));
      assert.strictEqual(r.items.length, 0);
    });

    check('a single failing entity does not prevent other entities\' results in searchAll()', () => {
      const freshFake = makeFakeStorage();
      const notOpenedRepo = new CasesRepository({ storageAdapter: createCasesLocalStorageAdapter(freshFake) });
      const mixed = new GlobalSearchController({ case: notOpenedRepo, client: clientsRepository });
      const r = mixed.searchAll('محمد');
      const caseGroup = r.groups.find(g => g.type === 'case');
      const clientGroup = r.groups.find(g => g.type === 'client');
      assert.ok(caseGroup.error, 'expected case group to carry the error');
      assert.ok(!clientGroup.error, 'client group must be unaffected');
      assert.strictEqual(clientGroup.total, 1);
      assert.strictEqual(r.hasError, true);
    });
  })();

  // ================================================================
  // Summary
  // ================================================================
  console.log(log.join('\n'));
  console.log('\n' + passed + '/' + (passed + failed) + ' checks passed.');
  console.log('\nSTEP 1 STATUS: ' + (failed === 0 ? 'PASS' : 'FAIL'));
  if (failed > 0) {
    console.error('\n' + failed + ' CHECK(S) FAILED.');
    process.exit(1);
  }
}

main().catch(err => {
  console.error('HARNESS CRASHED:', err);
  process.exit(1);
});
