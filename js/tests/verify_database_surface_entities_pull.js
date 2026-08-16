// =====================================================================
// verify_database_surface_entities_pull.js
//
// PHASE 39 — DATABASE SURFACE ENTITIES SYNC FIX
//
// DATABASE_SURFACE_ENTITIES_PRE_IMPLEMENTATION_AUDIT.md identified four
// entities that were push-only or fully local (no pull path at all):
//   - F-1 (HIGH):     Templates (الصيغ)          — never synced
//   - F-2 (HIGH):     Library (المكتبة)          — never synced
//   - F-3 (CRITICAL): Opponents (الخصوم)         — push-only, no pull
//   - F-4 (CRITICAL): Process Server Works (أعمال_المحضرين) — push-only, no pull
//
// The fix (§25/§26 of the audit) adds these four entities to the ONE
// live pull-list array js/modules/settings.js's loadFromSheets() actually
// uses at boot (NOT js/api/api.js's loadAllSheets(), which is confirmed
// dead code with zero callers — left untouched, per the audit's
// lower-risk recommendation).
//
// This harness proves two things per entity, without needing a real
// network/fetch (loadFromSheets() itself is exercised end-to-end by the
// existing verify_settings_merge_tombstone.js pattern for other
// entities; this file follows the same technique):
//
//   (A) STATIC — the exact Arabic sheet-name/local-key pair for each of
//       the four entities is present, literally, in loadFromSheets()'s
//       source on disk. This is what actually closes F-1..F-4 — a
//       missing pull-list entry is precisely the bug that was found.
//   (B) FUNCTIONAL — _persistEntityViaRepository(key, 'import', arr,
//       'merge'), the exact call loadFromSheets() makes for every pair,
//       behaves correctly (FIX P2 merge semantics: a local soft-delete
//       or a not-yet-synced local record survives the pull) when
//       exercised against each of the four entities' own real idField
//       (id / id / رقم_الخصم / رقم_العمل) — not just the cases/clients/
//       sessions entities already covered by
//       verify_settings_merge_tombstone.js.
//
// Run: node js/tests/verify_database_surface_entities_pull.js
// =====================================================================

'use strict';

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
  // (A) STATIC — the four pairs must literally be present in
  // loadFromSheets()'s source, each mapping the real Arabic Sheet name
  // (matching SHEET_DEFS) to the real Repository-resolvable local key
  // (matching the `window[key+'Repository']` naming convention already
  // used by every other entry — see settings.js's own
  // _persistEntityViaRepository()).
  // ================================================================
  {
    const src = fs.readFileSync(settingsJsPath, 'utf8');
    const loadFromSheetsMatch = src.match(/async function loadFromSheets\(\)\{[\s\S]*?var pairs=(\[[\s\S]*?\]);/);

    check('loadFromSheets() pairs array is found in settings.js source', () => {
      assert.ok(loadFromSheetsMatch, 'expected to find "var pairs=[...]" inside loadFromSheets()');
    });

    const pairsSrc = loadFromSheetsMatch ? loadFromSheetsMatch[1] : '';
    const expected = [
      ['الصيغ', 'templates'],
      ['المكتبة', 'library'],
      ['الخصوم', 'opponents'],
      ['أعمال_المحضرين', 'processServerWorks']
    ];
    expected.forEach(function (pair) {
      check('loadFromSheets() pairs array includes [\'' + pair[0] + '\',\'' + pair[1] + '\'] (closes F-' + (['الصيغ', 'المكتبة', 'الخصوم', 'أعمال_المحضرين'].indexOf(pair[0]) + 1) + ')', () => {
        const needle = "['" + pair[0] + "','" + pair[1] + "']";
        assert.notStrictEqual(pairsSrc.indexOf(needle), -1, 'expected literal ' + needle + ' inside the pairs array');
      });
    });

    check('js/api/api.js\'s loadAllSheets() was left untouched (audit §36 lower-risk recommendation — dead code, zero callers, not the fix target)', () => {
      const apiSrc = fs.readFileSync(path.join(__dirname, '..', 'api', 'api.js'), 'utf8');
      // Confirms the dead-code list still has its original 7 entries
      // and was not "fixed" in its place instead of settings.js's real
      // pull list (which would have left the actual boot-time gap open).
      const loadAllSheetsMatch = apiSrc.match(/async loadAllSheets\(\)\s*\{[\s\S]*?const pairs\s*=\s*(\[[\s\S]*?\]);/);
      assert.ok(loadAllSheetsMatch, 'expected to still find loadAllSheets()\'s own pairs list');
      assert.strictEqual(loadAllSheetsMatch[1].indexOf('processServerWorks'), -1, 'loadAllSheets() must NOT have been edited by this fix');
      assert.strictEqual(loadAllSheetsMatch[1].indexOf('الصيغ'), -1, 'loadAllSheets() must still be the original 7-entry dead-code list, untouched');
    });
  }

  // ================================================================
  // (B) FUNCTIONAL — MERGE/TOMBSTONE safety for each of the four newly
  // wired entities, same technique as verify_settings_merge_tombstone.js
  // but using each entity's own real idField and a raw-Sheets-row shape
  // (no `deletedAt` key at all, exactly what a real Sheets read
  // returns).
  // ================================================================
  const entities = [
    { key: 'templates', idField: 'id', sample: (id, extra) => Object.assign({ id: id, 'العنوان': 'صيغة' }, extra || {}) },
    { key: 'library', idField: 'id', sample: (id, extra) => Object.assign({ id: id, 'العنوان': 'كتاب' }, extra || {}) },
    { key: 'opponents', idField: 'رقم_الخصم', sample: (id, extra) => Object.assign({ 'رقم_الخصم': id, 'الاسم': 'خصم' }, extra || {}) },
    { key: 'processServerWorks', idField: 'رقم_العمل', sample: (id, extra) => Object.assign({ 'رقم_العمل': id, 'النوع': 'إعلان' }, extra || {}) }
  ];

  for (const ent of entities) {
    // ---- (B1) a locally soft-deleted, not-yet-synced-delete record
    // must NOT be resurrected by a merge pull that still contains its
    // raw (no deletedAt) row. ----
    {
      const repo = new Repository({ entityKey: ent.key, idField: ent.idField, storageAdapter: makeMockAdapter() });
      await repo.open();
      await repo.create(ent.sample('KEEP-1'));
      await repo.create(ent.sample('DELETED-1'));
      await repo.delete('DELETED-1');

      const globalsKey = ent.key + 'Repository';
      const readyKey = ent.key + 'RepositoryReadyPromise';
      setGlobals({ window: global, [globalsKey]: repo, [readyKey]: Promise.resolve() });
      const settingsModule = loadModule(settingsJsPath);

      await checkAsync('[' + ent.key + '] MERGE: a raw Sheets row for a locally soft-deleted record does NOT resurrect it (FIX P2)', async () => {
        const rawSheetRows = [ent.sample('KEEP-1'), ent.sample('DELETED-1')];
        await settingsModule._persistEntityViaRepository(ent.key, 'import', rawSheetRows, 'merge');
        const visible = repo.getAll();
        assert.strictEqual(visible.length, 1, 'the soft-deleted record must stay hidden');
        assert.strictEqual(visible[0][ent.idField], 'KEEP-1');
        const tombstone = repo.getAll({ includeDeleted: true }).find(r => r[ent.idField] === 'DELETED-1');
        assert.ok(tombstone && tombstone.deletedAt, 'tombstone must be preserved through the merge');
      });

      clearGlobals(['window', globalsKey, readyKey]);
    }

    // ---- (B2) a locally created, not-yet-pushed record must survive a
    // pull whose Sheet snapshot doesn't contain it yet. ----
    {
      const repo = new Repository({ entityKey: ent.key, idField: ent.idField, storageAdapter: makeMockAdapter() });
      await repo.open();
      await repo.create(ent.sample('FROM-SHEET'));
      await repo.create(ent.sample('OFFLINE-NEW'));

      const globalsKey = ent.key + 'Repository';
      const readyKey = ent.key + 'RepositoryReadyPromise';
      setGlobals({ window: global, [globalsKey]: repo, [readyKey]: Promise.resolve() });
      const settingsModule = loadModule(settingsJsPath);

      await checkAsync('[' + ent.key + '] MERGE: a not-yet-synced local record survives a pull that doesn\'t (yet) contain it', async () => {
        const rawSheetRows = [ent.sample('FROM-SHEET')];
        await settingsModule._persistEntityViaRepository(ent.key, 'import', rawSheetRows, 'merge');
        const all = repo.getAll();
        assert.strictEqual(all.length, 2, 'both records must survive');
        assert.ok(all.some(r => r[ent.idField] === 'OFFLINE-NEW'));
      });

      clearGlobals(['window', globalsKey, readyKey]);
    }
  }

  console.log(log.join('\n'));
  console.log('\n' + passed + ' passed, ' + failed + ' failed.');
  process.exit(failed > 0 ? 1 : 0);
}

main();
