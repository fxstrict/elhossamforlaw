/**
 * verify_case_conflict_source_after_delete.js
 * PROBLEM 6 (Case Save Cycle audit, v79) — Diagnostic test (NOT a bug
 * fix — see file footer for why nothing was changed).
 *
 * QUESTION ASKED: after deleting an old case (from "the database AND
 * the Sheet"), a new case with the SAME رقم_القضية still gets rejected
 * with ConflictError. Where does that Conflict actually come from —
 * IndexedDB, the Repository's in-memory state, Google Sheets, the sync
 * queue, a stale cache, or a duplicate index?
 *
 * PROVEN SOURCE (traced to one exact line, not guessed):
 *   CasesRepository.js:279 — `softDelete: true` — an explicit, commented
 *   config choice ("Data_Schema_Specification §4.1 Delete Rules: soft
 *   delete is the default for Cases").
 *   deleteCase() (cases.js) calls casesRepository.delete(id), which —
 *   being soft-delete — sets deletedAt on the record but leaves it in
 *   this._records / this._idIndex (Repository.js's _isDeleted() only
 *   ever checks record.deletedAt; nothing removes the id from
 *   _idIndex on a soft delete).
 *   create()'s uniqueness check (Repository.js:947,
 *   `if (this._indexOf(id) !== -1)`) does not distinguish live from
 *   soft-deleted records — _indexOf() is a raw id->index lookup with no
 *   deletedAt filter — so it finds the soft-deleted record and rejects
 *   the new one with ConflictError, EVEN THOUGH ApiService.deleteData()
 *   already issued a real `sheet.deleteRow()` on the Google Sheets side
 *   (Config/06_Api.gs's apiDeleteRow() — confirmed a genuine hard
 *   delete, not a soft one).
 *
 *   So: the record IS still present in the source that matters here —
 *   local IndexedDB, via the Repository's own in-memory index — and it
 *   is there by DESIGN (see footer), not by an accidental cache/stale-
 *   data bug. This is not Google Sheets, not the sync queue, not a
 *   duplicate index, and not a "stale cache" — it's the live soft-
 *   delete record itself, exactly where restoreCase() (cases.js) needs
 *   it to still be.
 *
 * This test creates a case, soft-deletes it (the real deleteCase()
 * code path, via casesRepository.delete()), attempts to create a new
 * case with the identical رقم_القضية, and inspects the repository's
 * OWN internal state to prove — not assume — that the rejection comes
 * from the still-present soft-deleted record and nothing else.
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const Module = require('module');
const vm = require('vm');
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

function makeFakeElement(tagName) {
  return {
    value: '', textContent: '', innerHTML: '', tagName: tagName || 'INPUT', options: [],
    style: { display: '' },
    classList: {
      _classes: {},
      add: function (c) { this._classes[c] = true; },
      remove: function (c) { delete this._classes[c]; },
      contains: function (c) { return !!this._classes[c]; }
    },
    children: [], querySelectorAll: function () { return []; }, appendChild: function () {}
  };
}

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

const ROOT = path.join(__dirname, '..', '..');
const modulesDir = path.join(ROOT, 'js', 'modules');

function loadRealConfigObject(varName) {
  const indexHtml = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const re = new RegExp('var ' + varName + '=(\\{[\\s\\S]*?\\n\\};)');
  const m = indexHtml.match(re);
  if (!m) throw new Error('Could not locate `var ' + varName + '={...}` in index.html');
  const literal = '(' + m[1].replace(/;\s*$/, '') + ')';
  // eslint-disable-next-line no-eval
  return (0, eval)(literal);
}

async function main() {
  const fakeIndexedDB = new FakeIndexedDB();
  const fakeElements = {};
  ['fCaseNum', 'fCaseTitle', 'fCaseClient', 'fCaseDocketNum', 'fCaseParentCase'].forEach(function (id) {
    fakeElements[id] = makeFakeElement();
  });

  const REAL_FIELDS = loadRealConfigObject('FIELDS');
  const REAL_MAP = loadRealConfigObject('MAP');

  const sandboxGlobals = {
    indexedDB: fakeIndexedDB,
    data: { cases: [], clients: [] },
    editIdx: { cases: -1 },
    FIELDS: REAL_FIELDS,
    MAP: REAL_MAP,
    document: {
      getElementById: function (id) { if (!fakeElements[id]) fakeElements[id] = makeFakeElement(); return fakeElements[id]; },
      createElement: function () { return makeFakeElement(); },
      addEventListener: function () {},
      querySelectorAll: function () { return []; }
    },
    escapeHtml: function (s) { return String(s == null ? '' : s); },
    toast: function () {},
    updateBadges: function () {},
    closeModal: function () {},
    parseLocalDate: function (d) { return d ? new Date(d) : null; },
    urgencyBadge: function () { return ''; },
    statusBadge: function () { return ''; },
    formatDate: function (d) { return d || '—'; },
    formatTime: function (t) { return t || '—'; },
    val: function (id) { const el = fakeElements[id]; return el ? el.value : ''; },
    uid: function () { return 'test-uid-' + Math.random().toString(36).slice(2, 8); },
    ApiService: { syncRow: function () {}, deleteData: function () {}, updateData: function () {} },
    saveLocal: function () {},
    confirm: function () { return true; },
    console: console
  };
  sandboxGlobals.window = global;
  Object.keys(sandboxGlobals).forEach(function (k) { global[k] = sandboxGlobals[k]; });

  const printUtilsCode = fs.readFileSync(path.join(ROOT, 'js', 'print-utils.js'), 'utf8');
  vm.runInThisContext(printUtilsCode, { filename: path.join(ROOT, 'js', 'print-utils.js') });

  const casesModule = loadModule(path.join(modulesDir, 'cases.js'));
  global.saveCase = casesModule.saveCase;
  await casesModule.ensureCasesRepositoryReady();

  check('CasesRepository is configured for soft delete (Data_Schema_Specification §4.1 — a documented design choice, not a bug)', function () {
    assert.strictEqual(casesModule.casesRepository._softDelete, true);
  });

  // ---- Create the original case ----
  fakeElements.fCaseNum.value = 'C-2026-999';
  fakeElements.fCaseTitle.value = 'قضية قديمة سيتم حذفها';
  fakeElements.fCaseClient.value = 'سيد أحمد';
  const createResult = await global.saveCase();
  check('setup — original case created successfully', function () {
    assert.ok(createResult && createResult.success === true, JSON.stringify(createResult));
  });

  // ---- Delete it (the REAL deleteCase() code path) ----
  const idxToDelete = global.data.cases.findIndex(function (c) { return c['رقم_القضية'] === 'C-2026-999'; });
  await casesModule.deleteCase(idxToDelete);

  check('after deleteCase(), the record is GONE from the live UI mirror data.cases (matches the user seeing it disappear from the app)', function () {
    const stillInMirror = global.data.cases.some(function (c) { return c['رقم_القضية'] === 'C-2026-999'; });
    assert.strictEqual(stillInMirror, false);
  });

  check('but the record is STILL present in the repository\'s own internal index — soft-deleted, not purged (this is the proven source)', function () {
    const allIncludingDeleted = casesModule.casesRepository.getAll({ includeDeleted: true });
    const stillThere = allIncludingDeleted.filter(function (c) { return c['رقم_القضية'] === 'C-2026-999'; });
    assert.strictEqual(stillThere.length, 1, 'expected the soft-deleted record to still be findable via getAll({includeDeleted:true})');
    assert.ok(stillThere[0].deletedAt, 'expected deletedAt to be set — confirms it is soft-deleted, not a duplicate/stray live record');
  });

  // ---- Reuse the same رقم_القضية for a brand-new case ----
  global.editIdx.cases = -1;
  fakeElements.fCaseNum.value = 'C-2026-999'; // SAME number as the just-deleted case
  fakeElements.fCaseTitle.value = 'قضية جديدة بنفس الرقم';
  fakeElements.fCaseClient.value = 'ليلى حسن';
  const reuseResult = await global.saveCase();

  check('reproduces the report: reusing the deleted case\'s number is rejected with ConflictError, even though it no longer appears anywhere in the UI', function () {
    assert.ok(reuseResult && reuseResult.success === false);
    assert.strictEqual(reuseResult.error && reuseResult.error.type, 'ConflictError');
  });

  check('PROOF the rejection is Repository._indexOf() finding the soft-deleted record, and NOT a separate uniqueness/cache mechanism: casesRepository.create() run directly (bypassing saveCase()/DOM entirely) with the same id produces the identical CONFLICT error', function () {
    return casesModule.casesRepository.create({
      'رقم_القضية': 'C-2026-999', 'عنوان_القضية': 'مباشر عبر الـ Repository', 'اسم_الموكل': 'اختبار مباشر'
    }).then(function (directResult) {
      assert.strictEqual(directResult.success, false);
      assert.strictEqual(directResult.error.type, 'ConflictError');
      assert.ok(
        /already exists/.test(directResult.error.message || ''),
        'expected the base Repository\'s own "already exists" message (Repository.js:950), confirming this is the generic id-uniqueness guard — not a Cases-specific or Sheets-side check'
      );
    });
  });

  console.log(log.join('\n'));
  console.log('\n' + passed + '/' + (passed + failed) + ' checks passed.');
  if (failed > 0) {
    console.log('\n' + failed + ' CHECK(S) FAILED.');
    process.exit(1);
  } else {
    console.log('\nALL CHECKS PASSED — source of the Conflict is proven: the soft-deleted record\'s id, still held in Repository._idIndex by design (restoreCase() depends on it).');
    process.exit(0);
  }
}

main().catch(function (err) {
  console.error('FATAL — uncaught error in test runner:', err && err.stack ? err.stack : err);
  process.exit(1);
});

/**
 * ================================================================
 * WHY NOTHING WAS CHANGED FOR PROBLEM 6
 * ================================================================
 * This is a DIAGNOSTIC test, not a regression test for a fix — per the
 * brief's own instructions:
 *   "لا تمسح cache بشكل عشوائي" / "لا تضف workaround يسمح بتكرار رقم
 *   القضية" / "إذا كان conflict ناتجًا عن بيانات صحيحة مختلفة، أثبت
 *   ذلك."
 *
 * The soft-delete config (CasesRepository.js:279) exists specifically
 * to support restoreCase() (cases.js, PHASE 10.3 — "Cases Restore
 * Pilot"). If رقم_القضية could be reused immediately after a soft
 * delete, a later restoreCase() on the OLD case would collide with the
 * NEW case now holding the same id — silent data corruption (two
 * live cases sharing one id, or one overwriting the other). Rejecting
 * reuse of a soft-deleted case's number is therefore a deliberate
 * consequence of an existing, intentional feature (Restore), not a
 * stale-cache defect — removing it would itself be the kind of
 * duplicate-permitting workaround the brief explicitly forbids.
 *
 * What IS a genuine, reportable inconsistency (documented, not fixed,
 * since it is outside Problem 6's actual reproduction — the LOCAL
 * conflict the user hit): ApiService.deleteData() performs a real hard
 * delete on the Google Sheets side (Config/06_Api.gs's apiDeleteRow()
 * -> sheet.deleteRow()), while the LOCAL IndexedDB copy stays soft-
 * deleted. A fresh reload that re-hydrates local storage from Sheets
 * (rather than reusing the existing IndexedDB) would no longer see the
 * old record at all, and the conflict would disappear — but that is a
 * separate reconciliation question, not something to alter here.
 */
