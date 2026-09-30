/**
 * verify_work_sheets_repository.js — AGENDA-3
 * Run: node js/tests/verify_work_sheets_repository.js
 */
const assert = require('assert');
const path = require('path');

const { Repository } = require(path.join(__dirname, '..', 'core', 'Repository.js'));
const {
  WorkSheetsRepository, createWorkSheetsStorageAdapter, WORK_SHEET_TRANSITIONS, parseWorkSheetItems
} = require(path.join(__dirname, '..', 'repositories', 'WorkSheetsRepository.js'));
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
function newRepo(fake) { return new WorkSheetsRepository({ storageAdapter: createWorkSheetsStorageAdapter(fake) }); }

(async function main() {
  check('WorkSheetsRepository extends the shared Repository base class', () => {
    assert.ok(newRepo(new FakeIndexedDB()) instanceof Repository);
  });

  const fake = new FakeIndexedDB();
  const repo = newRepo(fake);
  await repo.open();

  let sheetId;
  await acheck('createDraft() starts a sheet in DRAFT with an empty item list and a real generated id', async () => {
    const r = await repo.createDraft({ 'تاريخ_الاستهداف': '2026-09-28', 'أنشأها': 'boss' });
    assert.strictEqual(r.success, true, JSON.stringify(r.error));
    sheetId = r.record['معرف_الورقة'];
    assert.ok(sheetId && sheetId.indexOf('ws:') === 0);
    assert.strictEqual(r.record['الحالة'], 'DRAFT');
    assert.deepStrictEqual(repo.getItems(sheetId), []);
  });

  await acheck('createDraft() without تاريخ_الاستهداف is rejected', async () => {
    const r = await repo.createDraft({ 'أنشأها': 'boss' });
    assert.strictEqual(r.success, false);
  });

  await acheck('addItem() adds a reference, twice is a de-duplicated no-op (§10)', async () => {
    await repo.addItem(sheetId, 'session', 'S1');
    await repo.addItem(sheetId, 'session', 'S1');
    await repo.addItem(sheetId, 'administrativeWork', 'T1');
    const items = repo.getItems(sheetId);
    assert.strictEqual(items.length, 2);
    assert.strictEqual(items.filter((i) => i.sourceType === 'session' && i.sourceRecordId === 'S1').length, 1);
  });

  await acheck('removeItem() removes exactly one reference', async () => {
    await repo.removeItem(sheetId, 'administrativeWork', 'T1');
    const items = repo.getItems(sheetId);
    assert.strictEqual(items.length, 1);
    assert.strictEqual(items[0].sourceType, 'session');
  });

  await acheck('the same Work Item can sit on two different open sheets (§11)', async () => {
    const r2 = await repo.createDraft({ 'تاريخ_الاستهداف': '2026-09-29', 'أنشأها': 'boss' });
    await repo.addItem(r2.record['معرف_الورقة'], 'session', 'S1');
    const openSheets = repo.findOpenSheetsContaining('session', 'S1');
    assert.strictEqual(openSheets.length, 2);
  });

  await check('WORK_SHEET_TRANSITIONS matches §11 exactly (linear + two cancel edges, both terminal buckets empty)', () => {
    assert.deepStrictEqual(WORK_SHEET_TRANSITIONS.DRAFT, ['ISSUED', 'CANCELLED']);
    assert.deepStrictEqual(WORK_SHEET_TRANSITIONS.ISSUED, ['IN_PROGRESS', 'CANCELLED']);
    assert.deepStrictEqual(WORK_SHEET_TRANSITIONS.IN_PROGRESS, ['SETTLED']);
    assert.deepStrictEqual(WORK_SHEET_TRANSITIONS.SETTLED, ['CLOSED']);
    assert.deepStrictEqual(WORK_SHEET_TRANSITIONS.CLOSED, []);
    assert.deepStrictEqual(WORK_SHEET_TRANSITIONS.CANCELLED, []);
  });

  await acheck('DRAFT -> ISSUED succeeds and can carry المسند_إلى in the same write', async () => {
    const r = await repo.transitionState(sheetId, 'ISSUED', { 'المسند_إلى': 'ahmed' });
    assert.strictEqual(r.success, true, JSON.stringify(r.error));
    assert.strictEqual(repo.get(sheetId)['الحالة'], 'ISSUED');
    assert.strictEqual(repo.get(sheetId)['المسند_إلى'], 'ahmed');
  });

  await acheck('DRAFT -> SETTLED (skipping states) is rejected — no write occurs', async () => {
    const r3 = await repo.createDraft({ 'تاريخ_الاستهداف': '2026-09-28', 'أنشأها': 'boss' });
    const id3 = r3.record['معرف_الورقة'];
    const bad = await repo.transitionState(id3, 'SETTLED');
    assert.strictEqual(bad.success, false);
    assert.strictEqual(repo.get(id3)['الحالة'], 'DRAFT');
  });

  await acheck('ISSUED -> IN_PROGRESS -> SETTLED -> CLOSED, in order, all succeed', async () => {
    let r = await repo.transitionState(sheetId, 'IN_PROGRESS');
    assert.strictEqual(r.success, true, JSON.stringify(r.error));
    r = await repo.transitionState(sheetId, 'SETTLED', { 'ملخص_التسوية': 'أُنجز عنصر واحد' });
    assert.strictEqual(r.success, true, JSON.stringify(r.error));
    assert.strictEqual(repo.get(sheetId)['ملخص_التسوية'], 'أُنجز عنصر واحد');
    r = await repo.transitionState(sheetId, 'CLOSED');
    assert.strictEqual(r.success, true, JSON.stringify(r.error));
  });

  await acheck('CLOSED is terminal: no further transition succeeds', async () => {
    const r = await repo.transitionState(sheetId, 'ISSUED');
    assert.strictEqual(r.success, false);
  });

  await acheck('IN_PROGRESS cannot be cancelled (§11: only DRAFT or ISSUED)', async () => {
    const r4 = await repo.createDraft({ 'تاريخ_الاستهداف': '2026-09-28', 'أنشأها': 'boss' });
    const id4 = r4.record['معرف_الورقة'];
    await repo.transitionState(id4, 'ISSUED');
    await repo.transitionState(id4, 'IN_PROGRESS');
    const cancel = await repo.transitionState(id4, 'CANCELLED');
    assert.strictEqual(cancel.success, false);
  });

  await acheck('ISSUED CAN be cancelled directly (§11)', async () => {
    const r5 = await repo.createDraft({ 'تاريخ_الاستهداف': '2026-09-28', 'أنشأها': 'boss' });
    const id5 = r5.record['معرف_الورقة'];
    await repo.transitionState(id5, 'ISSUED');
    const cancel = await repo.transitionState(id5, 'CANCELLED');
    assert.strictEqual(cancel.success, true, JSON.stringify(cancel.error));
  });

  check('parseWorkSheetItems() is defensive against already-parsed arrays and blanks', () => {
    assert.deepStrictEqual(parseWorkSheetItems('[]'), []);
    assert.deepStrictEqual(parseWorkSheetItems(null), []);
    assert.deepStrictEqual(parseWorkSheetItems([{ sourceType: 'x', sourceRecordId: '1' }]),
      [{ sourceType: 'x', sourceRecordId: '1' }]);
    assert.deepStrictEqual(parseWorkSheetItems('not json'), []);
  });

  await acheck('an unknown الحالة value is rejected by create() directly (createDraft() always forces DRAFT, bypassing this)', async () => {
    const r = await repo.create({ 'تاريخ_الاستهداف': '2026-09-28', 'أنشأها': 'boss', 'الحالة': 'BOGUS', 'العناصر': '[]' });
    assert.strictEqual(r.success, false);
  });

  await acheck('records persist across a fresh repository instance on the same store', async () => {
    const repo2 = newRepo(fake);
    await repo2.open();
    assert.strictEqual(repo2.get(sheetId)['الحالة'], 'CLOSED');
  });

  console.log(log.join('\n'));
  console.log('\n' + passed + ' passed, ' + failed + ' failed.');
  process.exit(failed ? 1 : 0);
})();
