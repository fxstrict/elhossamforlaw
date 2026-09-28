/**
 * verify_agenda_metadata_repository.js
 * Standalone Node harness for AgendaMetadataRepository (AGENDA-2).
 * Run: node js/tests/verify_agenda_metadata_repository.js
 * Same FakeIndexedDB double / check() harness as
 * verify_process_server_works_repository.js.
 */

const assert = require('assert');
const path = require('path');

const { Repository } = require(path.join(__dirname, '..', 'core', 'Repository.js'));
const {
  AgendaMetadataRepository, createAgendaMetadataStorageAdapter,
  agendaMetadataKey, AGENDA_DEFAULT_EXECUTION_STATUS
} = require(path.join(__dirname, '..', 'repositories', 'AgendaMetadataRepository.js'));
const { FakeIndexedDB } = require(path.join(__dirname, 'fake_indexeddb.js'));

let passed = 0, failed = 0;
const log = [];
function check(label, fn) {
  try { fn(); passed++; log.push('PASS — ' + label); }
  catch (e) { failed++; log.push('FAIL — ' + label + '  =>  ' + e.message); }
}
async function acheck(label, fn) {
  try { await fn(); passed++; log.push('PASS — ' + label); }
  catch (e) { failed++; log.push('FAIL — ' + label + '  =>  ' + e.message); }
}

function newRepo(fake) {
  return new AgendaMetadataRepository({ storageAdapter: createAgendaMetadataStorageAdapter(fake) });
}

(async function main() {
  check('AgendaMetadataRepository extends the shared Repository base class', () => {
    assert.ok(newRepo(new FakeIndexedDB()) instanceof Repository);
  });

  const fake = new FakeIndexedDB();
  let repo = newRepo(fake);
  await repo.open();

  check('open() on an empty store starts with zero records', () => {
    assert.deepStrictEqual(repo.getAll(), []);
  });

  check('agendaMetadataKey() is sourceType:sourceId', () => {
    assert.strictEqual(agendaMetadataKey('session', '123'), 'session:123');
  });

  let created;
  await acheck('upsertForWorkItem() lazily creates a row with deterministic id + NOT_STARTED default', async () => {
    const r = await repo.upsertForWorkItem('administrativeWork', 'T1', { 'مُسند_إلى': 'ahmed' });
    assert.strictEqual(r.success, true, JSON.stringify(r.error));
    created = r.record;
    assert.strictEqual(created['المعرف'], 'administrativeWork:T1');
    assert.strictEqual(created['حالة_التنفيذ'], AGENDA_DEFAULT_EXECUTION_STATUS);
    assert.strictEqual(created['مُسند_إلى'], 'ahmed');
    assert.strictEqual(repo.getAll().length, 1);
  });

  await acheck('a second upsert for the same work item UPDATES (no duplicate row)', async () => {
    const r = await repo.upsertForWorkItem('administrativeWork', 'T1', { 'حالة_التنفيذ': 'IN_PROGRESS' });
    assert.strictEqual(r.success, true, JSON.stringify(r.error));
    assert.strictEqual(repo.getAll().length, 1);
    assert.strictEqual(repo.getByWorkItemId('administrativeWork:T1')['حالة_التنفيذ'], 'IN_PROGRESS');
    assert.strictEqual(repo.getByWorkItemId('administrativeWork:T1')['مُسند_إلى'], 'ahmed');
  });

  await acheck('BLOCKED without سبب_التوقف is rejected', async () => {
    const r = await repo.upsertForWorkItem('session', 'S1', { 'حالة_التنفيذ': 'BLOCKED' });
    assert.strictEqual(r.success, false);
    assert.strictEqual(repo.getByWorkItemId('session:S1'), null);
  });

  await acheck('BLOCKED with سبب_التوقف is accepted', async () => {
    const r = await repo.upsertForWorkItem('session', 'S1', { 'حالة_التنفيذ': 'BLOCKED', 'سبب_التوقف': 'بانتظار مستند' });
    assert.strictEqual(r.success, true, JSON.stringify(r.error));
  });

  await acheck('an unknown حالة_التنفيذ is rejected', async () => {
    const r = await repo.upsertForWorkItem('processServerWork', 'P1', { 'حالة_التنفيذ': 'DONE' });
    assert.strictEqual(r.success, false);
  });

  await acheck('an unknown نوع_المصدر is rejected', async () => {
    const r = await repo.upsertForWorkItem('bogus', 'X1', {});
    assert.strictEqual(r.success, false);
  });

  await acheck('records persist across a fresh repository instance on the same store', async () => {
    const repo2 = newRepo(fake);
    await repo2.open();
    assert.strictEqual(repo2.getAll().length, 2); // administrativeWork:T1 + session:S1
    assert.strictEqual(repo2.getByWorkItemId('session:S1')['سبب_التوقف'], 'بانتظار مستند');
  });

  console.log(log.join('\n'));
  console.log('\n' + passed + ' passed, ' + failed + ' failed.');
  process.exit(failed ? 1 : 0);
})();
