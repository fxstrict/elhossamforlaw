// =====================================================================
// verify_settings_merge_tombstone.js
//
// FIX P2 (DATABASE_FORENSIC_REPORT.md §P2, "عودة بيانات محذوفة بعد
// Refresh/Sync") — settings.js integration coverage.
//
// js/core/Repository.js's own test suites (verify_cache_validation.js
// D3, verify_repository_cache_layer.js J2) already prove that
// import('merge') respects an explicit `deletedAt` key on an incoming
// record. This file covers the layer above that: settings.js's
// `_persistEntityViaRepository()` — the actual function loadFromSheets()
// calls — with data shaped exactly like a REAL Google Sheets row (i.e.
// literally no `deletedAt` key at all, since Sheets has no such column).
// That is the specific scenario the original bug depended on, and the
// one the Repository-level tests (which always construct an explicit
// `deletedAt`, even `null`) do not exercise.
//
// Also covers: handleImport()'s explicit "restore from backup file"
// path must still fully REPLACE (unchanged, deliberate user action),
// contrasted directly against loadFromSheets()'s MERGE.
//
// PHASE S.5.1 ADDITION (BUG-1 fix — see
// PHASE_S5_PULL_MERGE_TOMBSTONE_FORENSIC_AUDIT.md §3/§10): loadFromSheets()
// now runs each raw row through `_translateSheetRowTombstone()` before
// merging. The two new blocks below exercise exactly that combination
// (`_translateSheetRowTombstone()` + `_persistEntityViaRepository(...,
// 'merge')`) for the two cases the audit found broken:
//   Case A — local live, server NEWLY tombstoned (must become tombstoned)
//   Case C — local absent, server ALREADY tombstoned (must be added as a
//            tombstone, not a live record)
//
// Run: node js/tests/verify_settings_merge_tombstone.js
// =====================================================================

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const Module = require('module');
const assert = require('assert');

let passed = 0, failed = 0;
const log = [];
function check(name, fn) { try { fn(); passed++; log.push('PASS — ' + name); } catch (e) { failed++; log.push('FAIL — ' + name + '  =>  ' + (e && e.message ? e.message : e)); } }
async function checkAsync(name, fn) { try { await fn(); passed++; log.push('PASS — ' + name); } catch (e) { failed++; log.push('FAIL — ' + name + '  =>  ' + (e && e.message ? e.message : e)); } }

function setGlobals(extraGlobals) { Object.keys(extraGlobals).forEach(function (k) { global[k] = extraGlobals[k]; }); }
function clearGlobals(keys) { keys.forEach(function (k) { delete global[k]; }); }

function loadModule(filePath) {
  const code = fs.readFileSync(filePath, 'utf8');
  const wrapper = Module.wrap(code);
  const script = new vm.Script(wrapper, { filename: filePath });
  const compiledWrapper = script.runInThisContext();
  const mod = new Module(filePath, module);
  mod.filename = filePath;
  mod.paths = Module._nodeModulePaths(path.dirname(filePath));
  const localRequire = function (id) { return mod.require(id); };
  compiledWrapper.call(mod.exports, mod.exports, localRequire, mod, filePath, path.dirname(filePath));
  mod.loaded = true;
  return mod.exports;
}

function makeMockAdapter() {
  const store = {};
  return {
    read: async function (entityKey) { return store[entityKey] ? JSON.parse(JSON.stringify(store[entityKey])) : []; },
    write: async function (entityKey, records) { store[entityKey] = JSON.parse(JSON.stringify(records)); }
  };
}

async function main() {
  const repoJsPath = path.join(__dirname, '..', 'core', 'Repository.js');
  const settingsJsPath = path.join(__dirname, '..', 'modules', 'settings.js');
  const { Repository } = require(repoJsPath);

  // ================================================================
  // Scenario: a case was soft-deleted LOCALLY (e.g. deleteCase() ran,
  // but its own ApiService.deleteData() sync to the Sheet hasn't
  // completed yet — offline, or in flight). A subsequent
  // loadFromSheets() pull still sees the case's row in the Sheet (the
  // Sheet-side delete hasn't landed yet) and must NOT resurrect it
  // locally.
  // ================================================================
  {
    const repo = new Repository({ entityKey: 'cases', idField: 'رقم_القضية', storageAdapter: makeMockAdapter() });
    await repo.open();
    await repo.create({ 'رقم_القضية': '2026/1', 'عنوان_القضية': 'قضية أولى' });
    await repo.create({ 'رقم_القضية': '2026/2', 'عنوان_القضية': 'قضية ثانية' });
    await repo.delete('2026/2'); // soft-delete: sync to Sheets assumed NOT YET completed

    setGlobals({
      window: global,
      casesRepository: repo,
      casesRepositoryReadyPromise: Promise.resolve()
    });
    const settingsModule = loadModule(settingsJsPath);

    await checkAsync('_persistEntityViaRepository(mode=import, importMode=merge): a raw Sheets row (no deletedAt key) for a locally soft-deleted case does NOT resurrect it', async () => {
      // Shaped exactly like a real Google Sheets row: a plain object
      // with only the sheet's columns — literally no `deletedAt` key.
      const rawSheetRows = [
        { 'رقم_القضية': '2026/1', 'عنوان_القضية': 'قضية أولى محدّثة من الشيت' },
        { 'رقم_القضية': '2026/2', 'عنوان_القضية': 'قضية ثانية' } // still present in the Sheet
      ];
      await settingsModule._persistEntityViaRepository('cases', 'import', rawSheetRows, 'merge');

      const visible = repo.getAll();
      assert.strictEqual(visible.length, 1, 'the soft-deleted case must still be hidden from default getAll()');
      assert.strictEqual(visible[0]['رقم_القضية'], '2026/1');
      assert.strictEqual(visible[0]['عنوان_القضية'], 'قضية أولى محدّثة من الشيت', 'non-deleted records still pick up field updates from the merge');

      const withDeleted = repo.getAll({ includeDeleted: true });
      const tombstone = withDeleted.find(function (r) { return r['رقم_القضية'] === '2026/2'; });
      assert.ok(tombstone, 'the soft-deleted record must still exist in storage');
      assert.ok(tombstone.deletedAt, 'its deletedAt tombstone must be preserved, not cleared by the merge');
    });

    clearGlobals(['window', 'casesRepository', 'casesRepositoryReadyPromise']);
  }

  // ================================================================
  // Scenario: a record was created LOCALLY WHILE OFFLINE (never yet
  // pushed to the Sheet, so it cannot possibly appear in a Sheets pull
  // response). A loadFromSheets() merge must never delete/lose it —
  // this is the "لا يؤدي Pull لاحق إلى إعادة السجلات المحذوفة... ولا
  // فقد بيانات" requirement for the offline-create case specifically.
  // ================================================================
  {
    const repo = new Repository({ entityKey: 'clients', idField: 'رقم_الموكل', storageAdapter: makeMockAdapter() });
    await repo.open();
    await repo.create({ 'رقم_الموكل': 'C-1', 'الاسم': 'موكل من الشيت' });
    await repo.create({ 'رقم_الموكل': 'C-OFFLINE-NEW', 'الاسم': 'موكل أُنشئ أوفلاين، لم يُزامن بعد' });

    setGlobals({
      window: global,
      clientsRepository: repo,
      clientsRepositoryReadyPromise: Promise.resolve()
    });
    const settingsModule = loadModule(settingsJsPath);

    await checkAsync('_persistEntityViaRepository(merge): a not-yet-synced offline-created record survives a Sheets pull that does not (yet) contain it', async () => {
      // The Sheet only knows about C-1 — C-OFFLINE-NEW hasn't been
      // pushed there yet.
      const rawSheetRows = [{ 'رقم_الموكل': 'C-1', 'الاسم': 'موكل من الشيت' }];
      await settingsModule._persistEntityViaRepository('clients', 'import', rawSheetRows, 'merge');

      const all = repo.getAll();
      assert.strictEqual(all.length, 2, 'both records must survive — merge only touches ids present in the incoming array');
      assert.ok(all.some(function (r) { return r['رقم_الموكل'] === 'C-OFFLINE-NEW'; }), 'the offline-created, not-yet-synced record must not be lost');
    });

    clearGlobals(['window', 'clientsRepository', 'clientsRepositoryReadyPromise']);
  }

  // ================================================================
  // Contrast: handleImport()'s explicit "restore from backup file"
  // still fully REPLACES — deliberate, unchanged behavior (default
  // importMode stays 'replace' when the 4th param is omitted).
  // ================================================================
  {
    const repo = new Repository({ entityKey: 'sessions', idField: 'رقم_الجلسة', storageAdapter: makeMockAdapter() });
    await repo.open();
    await repo.create({ 'رقم_الجلسة': 'S-OLD', 'التاريخ': '2025-01-01' });

    setGlobals({
      window: global,
      sessionsRepository: repo,
      sessionsRepositoryReadyPromise: Promise.resolve()
    });
    const settingsModule = loadModule(settingsJsPath);

    await checkAsync('_persistEntityViaRepository(mode=import, no importMode arg): still fully REPLACES, exact prior behavior for handleImport()/backup-restore', async () => {
      const backupData = [{ 'رقم_الجلسة': 'S-FROM-BACKUP', 'التاريخ': '2026-05-05' }];
      await settingsModule._persistEntityViaRepository('sessions', 'import', backupData);
      const all = repo.getAll();
      assert.strictEqual(all.length, 1, 'replace mode discards anything not in the imported set');
      assert.strictEqual(all[0]['رقم_الجلسة'], 'S-FROM-BACKUP');
      assert.ok(!all.some(function (r) { return r['رقم_الجلسة'] === 'S-OLD'; }), 'S-OLD from before the restore must be gone — this IS the intended "restore from backup" behavior');
    });

    clearGlobals(['window', 'sessionsRepository', 'sessionsRepositoryReadyPromise']);
  }

  // ================================================================
  // PHASE S.5.1 — BUG-1 Case A: a case is LIVE locally. The server
  // pull now shows the SAME id carrying a non-empty محذوف_في (deleted
  // on another device since the last sync). Before the fix, the raw
  // row (no `deletedAt` key at all) would fully replace the local
  // record and leave it live forever — the new delete was never
  // learned. After the fix, _translateSheetRowTombstone() must set
  // `deletedAt` on the incoming row so the merge honors the flip.
  // ================================================================
  {
    const repo = new Repository({ entityKey: 'cases', idField: 'رقم_القضية', storageAdapter: makeMockAdapter() });
    await repo.open();
    await repo.create({ 'رقم_القضية': '2026/1', 'عنوان_القضية': 'قضية محلية حية' });

    setGlobals({
      window: global,
      casesRepository: repo,
      casesRepositoryReadyPromise: Promise.resolve()
    });
    const settingsModule = loadModule(settingsJsPath);

    await checkAsync('PHASE S.5.1 (BUG-1 Case A): a local LIVE record learns a NEW server-side tombstone via loadFromSheets()-shaped merge', async () => {
      const rawSheetRows = [
        { 'رقم_القضية': '2026/1', 'عنوان_القضية': 'قضية محلية حية', 'محذوف_في': '2026-09-10T00:00:00.000Z' }
      ].map(settingsModule._translateSheetRowTombstone); // exactly what loadFromSheets() now does before the merge call

      await settingsModule._persistEntityViaRepository('cases', 'import', rawSheetRows, 'merge');

      const visible = repo.getAll();
      assert.strictEqual(visible.length, 0, 'the record must now be hidden — the server-side delete must be learned');
      const withDeleted = repo.getAll({ includeDeleted: true });
      const tombstone = withDeleted.find(function (r) { return r['رقم_القضية'] === '2026/1'; });
      assert.ok(tombstone && tombstone.deletedAt, 'the record must be tombstoned locally, not silently stay live forever');
    });

    clearGlobals(['window', 'casesRepository', 'casesRepositoryReadyPromise']);
  }

  // ================================================================
  // PHASE S.5.1 — BUG-1 Case C: a record is ABSENT locally (e.g. a
  // brand-new device's first sync) and the server row already carries
  // a non-empty محذوف_في. Before the fix, this would be pushed as a
  // brand-new LIVE record (a "ghost"). After the fix it must be added
  // as an already-tombstoned record.
  // ================================================================
  {
    const repo = new Repository({ entityKey: 'clients', idField: 'رقم_الموكل', storageAdapter: makeMockAdapter() });
    await repo.open();

    setGlobals({
      window: global,
      clientsRepository: repo,
      clientsRepositoryReadyPromise: Promise.resolve()
    });
    const settingsModule = loadModule(settingsJsPath);

    await checkAsync('PHASE S.5.1 (BUG-1 Case C): a record absent locally and already tombstoned on the server is added AS a tombstone, not a live ghost', async () => {
      const rawSheetRows = [
        { 'رقم_الموكل': 'C-GHOST', 'الاسم': 'موكل محذوف سلفًا على الخادم', 'محذوف_في': '2026-01-01T00:00:00.000Z' }
      ].map(settingsModule._translateSheetRowTombstone);

      await settingsModule._persistEntityViaRepository('clients', 'import', rawSheetRows, 'merge');

      const visible = repo.getAll();
      assert.strictEqual(visible.length, 0, 'a record already deleted on the server must never appear as a live record on first sync');
      const withDeleted = repo.getAll({ includeDeleted: true });
      const tombstone = withDeleted.find(function (r) { return r['رقم_الموكل'] === 'C-GHOST'; });
      assert.ok(tombstone && tombstone.deletedAt, 'it must exist in storage as a tombstone (so a later restore() remains possible), just never visible');
    });

    clearGlobals(['window', 'clientsRepository', 'clientsRepositoryReadyPromise']);
  }

  console.log(log.join('\n'));
  console.log('\n' + passed + ' passed, ' + failed + ' failed.');
  process.exit(failed > 0 ? 1 : 0);
}

main();
