/**
 * verify_sessions_repository_integration.js
 * ================================================================
 * PHASE 9 — SUB-PHASE 9.4 — Repository Integration (Sessions Module)
 * ================================================================
 * Standalone Node harness (`node js/tests/verify_sessions_repository_
 * integration.js`, no browser required) proving that js/modules/
 * sessions.js — after this phase's migration — behaves identically to
 * the pre-migration inline module from the caller's point of view, while
 * now reading/writing exclusively through js/repositories/
 * SessionsRepository.js. Modeled directly on the Documents module's
 * verify_documents_repository_integration.js harness (SUB-PHASE 9.3),
 * same "single boundary" mocking discipline.
 *
 * No file is modified by running this harness. It only reads
 * js/modules/sessions.js and js/repositories/SessionsRepository.js
 * (and, transitively, js/core/Repository.js / DatabaseService.js /
 * LocalStorageAdapter.js) exactly as they exist on disk.
 * ================================================================
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const Module = require('module');
const vm = require('vm');
const { FakeIndexedDB } = require(path.join(__dirname, 'fake_indexeddb.js'));
const { confirmDialog: __confirmDialogStub } = require(path.join(__dirname, '_shared', 'browserStubs.js'));

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

async function checkAsync(label, fn) {
  try {
    await fn();
    passed++;
    log.push('PASS — ' + label);
  } catch (e) {
    failed++;
    log.push('FAIL — ' + label + '  =>  ' + e.message);
  }
}

// ---- Fake localStorage (matches getItem/setItem shape only — same
//      fake every existing verify_*_repository.js harness uses) ----
function makeFakeStorage(seed) {
  const store = Object.assign({}, seed || {});
  return {
    getItem: function (k) { return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; },
    setItem: function (k, v) { store[k] = String(v); },
    _dump: function () { return store; }
  };
}

// ---- Fake DOM element (only the surface sessions.js actually touches) ----
function makeFakeElement() {
  return {
    value: '',
    textContent: '',
    innerHTML: '',
    style: { display: '' },
    classList: {
      _classes: {},
      add: function (c) { this._classes[c] = true; },
      remove: function (c) { delete this._classes[c]; },
      contains: function (c) { return !!this._classes[c]; }
    }
  };
}

/**
 * Assigns `extraGlobals` directly onto the real Node `global` object.
 * sessions.js is a classic (non-module) browser script: it references
 * bare identifiers like `data`/`document`/`toast` that are NOT among
 * Module.wrap's function parameters, so they must be resolved via the
 * scope chain, which bottoms out at the real global object when the
 * file is compiled with `vm`'s `runInThisContext`. Because sessions.js
 * itself kicks off an async `.open().then(...)` chain at load time whose
 * continuation (syncSessionsMirror, referencing `data`) runs on a LATER
 * microtask turn, these globals must stay assigned for as long as that
 * module instance is in use — not just for the duration of the
 * synchronous load call. Each test block below calls this once with a
 * fresh set of fakes before loading/using its own module instance.
 * @param {Object} extraGlobals
 */
function setGlobals(extraGlobals) {
  Object.keys(extraGlobals).forEach(function (k) {
    global[k] = extraGlobals[k];
  });
}

/**
 * Loads a CommonJS file via Node's own Module wrapper so its internal
 * relative `require()` calls resolve exactly as they would from its
 * real on-disk location (js/modules/sessions.js's
 * `require('../repositories/SessionsRepository.js')` must resolve to
 * js/repositories/SessionsRepository.js, not to something relative to
 * this test file). Call `setGlobals()` first with whatever fakes the
 * file needs to find on the global object.
 * @param {string} filePath - absolute path to the file to load.
 * @returns {*} module.exports of the loaded file.
 */
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

async function main() {

  const sessionsJsPath = path.join(__dirname, '..', 'modules', 'sessions.js');
  const sessionsRepoPath = path.join(__dirname, '..', 'repositories', 'SessionsRepository.js');
  const repositoryCorePath = path.join(__dirname, '..', 'core', 'Repository.js');

  // ================================================================
  // 1. Static checks — only sessions.js touched, nothing else edited
  // ================================================================

  check('js/modules/sessions.js exists and is valid JS (node --check equivalent: parses via vm)', () => {
    const code = fs.readFileSync(sessionsJsPath, 'utf8');
    assert.doesNotThrow(() => new vm.Script(Module.wrap(code), { filename: sessionsJsPath }));
  });

  check('SessionsRepository.js on disk is unmodified (still exports SessionsRepository + factory)', () => {
    const ns = require(sessionsRepoPath);
    assert.strictEqual(typeof ns.SessionsRepository, 'function');
    assert.strictEqual(typeof ns.createSessionsLocalStorageAdapter, 'function');
  });

  check('Repository.js on disk is unmodified (still exports Repository)', () => {
    const ns = require(repositoryCorePath);
    assert.strictEqual(typeof ns.Repository, 'function');
  });

  // ================================================================
  // 2. Fresh load (empty localStorage — real first-run condition)
  // ================================================================

  {
    const fakeStorage = makeFakeStorage({});
    const fakeIndexedDB = new FakeIndexedDB();
    const fakeElements = {};
    const toastLog = [];
    const badgeCalls = { count: 0 };
    const closeModalLog = [];
    const syncRowLog = [];
    const deleteDataLog = [];
    const saveLocalCalls = { count: 0 };

    const sandboxGlobals = {
      localStorage: fakeStorage,
      indexedDB: fakeIndexedDB,
      window: global,
      data: { sessions: [], cases: [] },
      editIdx: { sessions: -1 },
      document: {
        getElementById: function (id) {
          if (!fakeElements[id]) fakeElements[id] = makeFakeElement();
          return fakeElements[id];
        }
      },
      toast: function (msg, type) { toastLog.push({ msg: msg, type: type }); },
      updateBadges: function () { badgeCalls.count++; },
      closeModal: function (id) { closeModalLog.push(id); },
      populateCaseDropdown: function () {},
      autofillSessionFromCase: function () {},
      formatDate: function (d) { return d || '—'; },
      formatTime: function (t) { return t || '—'; },
      parseLocalDate: function (d) { return d ? new Date(d + 'T00:00:00') : null; },
      urgencyBadge: function () { return ''; },
      statusBadge: function () { return ''; },
      sanitizeTime: function (t) { return t || ''; },
      val: function (id) {
        const el = fakeElements[id];
        return el ? el.value : '';
      },
      uid: function () { return 'test-uid-' + Math.random().toString(36).slice(2, 8); },
      collectForm: function () { return sandboxGlobals.__nextFormValue || {}; },
      fillForm: function (type, obj) { sandboxGlobals.__lastFilled = obj; },
      ApiService: {
        syncRow: function (sheet, obj, idx) { syncRowLog.push({ sheet: sheet, obj: obj, idx: idx }); },
        deleteData: function (sheet, idx) { deleteDataLog.push({ sheet: sheet, idx: idx }); }
      },
      saveLocal: function () { saveLocalCalls.count++; },
      confirm: function () { return true; },
      confirmDialog: __confirmDialogStub,
      console: console
    };

    setGlobals(sandboxGlobals);
    const sessModule = loadModule(sessionsJsPath);

    await checkAsync('Fresh load: repository opens with zero records, data.sessions mirror is []', async () => {
      await sessModule.ensureSessionsRepositoryReady();
      assert.deepStrictEqual(sessModule.sessionsRepository.getAll(), []);
      assert.deepStrictEqual(sandboxGlobals.data.sessions, []);
    });

    // ---- VALIDATION: missing date/time still blocked before the Repository ----
    check('saveSession(): empty التاريخ/الوقت still blocked before reaching the Repository (validated via direct DOM read)', () => {
      fakeElements['fSessionDate'] = makeFakeElement();
      fakeElements['fSessionDate'].value = '';
      fakeElements['fSessionTime'] = makeFakeElement();
      fakeElements['fSessionTime'].value = '';
      const before = sandboxGlobals.data.sessions.length;
      const toastCountBefore = toastLog.length;
      // saveSession() is async but the guard clause returns before any
      // await, so no promise needs to be awaited for this observation.
      sessModule.saveSession();
      assert.strictEqual(sandboxGlobals.data.sessions.length, before);
      assert.strictEqual(toastLog.length, toastCountBefore + 1);
      assert.strictEqual(toastLog[toastLog.length - 1].type, 'error');
    });

    // ---- CREATE via saveSession() ----
    await checkAsync('saveSession(): create path (editIdx.sessions = -1) inserts a new record via Repository.create(), id auto-generated', async () => {
      fakeElements['fSessionDate'].value = '2026-08-10';
      fakeElements['fSessionTime'].value = '10:30';
      sandboxGlobals.__nextFormValue = {
        'رقم_القضية': '2026-55',
        'عنوان_القضية': 'قضية اختبار',
        'نوع_الدعوى': 'مدني',
        'المحكمة': 'محكمة القاهرة',
        'التاريخ': '2026-08-10',
        'الوقت': '10:30',
        'القاضي': 'أحمد',
        'الحالة': 'مجدولة',
        'ما_تم_في_الجلسة': '',
        'القرار': '',
        'التأجيل_إلى': '',
        'الملاحظات': ''
      };
      sandboxGlobals.editIdx.sessions = -1;

      await sessModule.saveSession();

      assert.strictEqual(sandboxGlobals.data.sessions.length, 1);
      const rec = sandboxGlobals.data.sessions[0];
      assert.strictEqual(rec['المحكمة'], 'محكمة القاهرة');
      assert.ok(rec[sessModule.SESSIONS_ID_FIELD], 'a رقم_الجلسة id must have been generated');
      assert.ok(rec['تاريخ_الإنشاء'], 'تاريخ_الإنشاء must have been stamped');
      assert.strictEqual(toastLog[toastLog.length - 1].msg, 'تمت إضافة الجلسة — ستظهر في Google Calendar');
      assert.strictEqual(saveLocalCalls.count, 1);
      assert.strictEqual(syncRowLog[syncRowLog.length - 1].sheet, 'الجلسات');
      assert.strictEqual(closeModalLog[closeModalLog.length - 1], 'modalSession');
      assert.strictEqual(badgeCalls.count, 1);
    });

    // ---- CREATE a second record with a different status/date (for search/filter/sort tests) ----
    await checkAsync('saveSession(): create a second record with a different status and later date', async () => {
      sandboxGlobals.__nextFormValue = {
        'رقم_القضية': '2026-56',
        'عنوان_القضية': 'قضية الطلاق',
        'نوع_الدعوى': 'أحوال شخصية',
        'المحكمة': 'محكمة الأسرة',
        'التاريخ': '2026-08-01',
        'الوقت': '09:00',
        'القاضي': 'سارة',
        'الحالة': 'منتهية',
        'ما_تم_في_الجلسة': 'تم الاستماع إلى الشهود',
        'القرار': '',
        'التأجيل_إلى': '',
        'الملاحظات': ''
      };
      sandboxGlobals.editIdx.sessions = -1;
      await sessModule.saveSession();
      assert.strictEqual(sandboxGlobals.data.sessions.length, 2);
    });

    // ---- READ: renderSessions() free-text search (Repository.search(), sync) ----
    check('renderSessions(): free-text search matches across full legacy field set (Repository.search(), synchronous)', () => {
      fakeElements['searchSessions'] = makeFakeElement();
      fakeElements['searchSessions'].value = 'الشهود'; // only in session #2's "ما تم في الجلسة"
      fakeElements['filterSessionStatus'] = makeFakeElement();
      fakeElements['filterSessionStatus'].value = '';
      fakeElements['sessionsListView'] = makeFakeElement();
      fakeElements['sessionsEmpty'] = makeFakeElement();

      sessModule.renderSessions();

      assert.ok(fakeElements['sessionsListView'].innerHTML.indexOf('قضية الطلاق') !== -1);
      assert.ok(fakeElements['sessionsListView'].innerHTML.indexOf('قضية اختبار') === -1);
      assert.strictEqual(fakeElements['sessionsEmpty'].style.display, 'none');
    });

    // ---- READ: renderSessions() status filter (exact-equality, combined with search) ----
    check('renderSessions(): #filterSessionStatus exact-equality filter combines with search (AND semantics, matches original)', () => {
      fakeElements['searchSessions'].value = '';
      fakeElements['filterSessionStatus'].value = 'مجدولة';

      sessModule.renderSessions();

      assert.ok(fakeElements['sessionsListView'].innerHTML.indexOf('قضية اختبار') !== -1);
      assert.ok(fakeElements['sessionsListView'].innerHTML.indexOf('قضية الطلاق') === -1);
    });

    // ---- READ: sort ascending by التاريخ (session #2's 08-01 before #1's 08-10) ----
    check('renderSessions(): rows sorted ascending by التاريخ, matching the original inline sort exactly', () => {
      fakeElements['searchSessions'].value = '';
      fakeElements['filterSessionStatus'].value = '';

      sessModule.renderSessions();

      const html = fakeElements['sessionsListView'].innerHTML;
      const posEarlier = html.indexOf('قضية الطلاق');   // 2026-08-01
      const posLater = html.indexOf('قضية اختبار');      // 2026-08-10
      assert.ok(posEarlier !== -1 && posLater !== -1 && posEarlier < posLater,
        'the 2026-08-01 session must render before the 2026-08-10 session');
    });

    // ---- READ: empty-result path (#sessionsEmpty shown, list cleared) ----
    check('renderSessions(): no matches shows #sessionsEmpty and clears the list', () => {
      fakeElements['searchSessions'].value = 'نص-غير-موجود-إطلاقاً';
      fakeElements['filterSessionStatus'].value = '';

      sessModule.renderSessions();

      assert.strictEqual(fakeElements['sessionsListView'].innerHTML, '');
      assert.strictEqual(fakeElements['sessionsEmpty'].style.display, '');
    });

    // ---- Index -> record -> id translation layer, exercised end-to-end ----
    let secondSessionIndex = -1;
    check('renderSessions(): embeds resolvable indexes in onclick handlers matching the data.sessions mirror', () => {
      fakeElements['searchSessions'].value = '';
      fakeElements['filterSessionStatus'].value = '';
      sessModule.renderSessions();

      secondSessionIndex = sessModule.resolveSessionIndex(
        sandboxGlobals.data.sessions,
        sandboxGlobals.data.sessions.filter(function (x) { return x['عنوان_القضية'] === 'قضية الطلاق'; })[0]
      );
      assert.notStrictEqual(secondSessionIndex, -1);
      assert.ok(fakeElements['sessionsListView'].innerHTML.indexOf('editSession(' + secondSessionIndex + ')') !== -1);
      assert.ok(fakeElements['sessionsListView'].innerHTML.indexOf('deleteSession(' + secondSessionIndex + ')') !== -1);
    });

    // ---- editSession(): synchronous, no Repository call, reads mirror only ----
    check('editSession(i): purely synchronous, pre-fills form from data.sessions[i] (no Repository call)', () => {
      fakeElements['modalSessionTitle'] = makeFakeElement();
      fakeElements['modalSession'] = makeFakeElement();

      sessModule.editSession(secondSessionIndex);

      assert.strictEqual(sandboxGlobals.editIdx.sessions, secondSessionIndex);
      assert.strictEqual(sandboxGlobals.__lastFilled['عنوان_القضية'], 'قضية الطلاق');
      assert.strictEqual(fakeElements['modalSessionTitle'].textContent, 'تعديل الجلسة');
      assert.ok(fakeElements['modalSession'].classList.contains('open'));
    });

    // ---- UPDATE via saveSession(): same array position and id preserved ----
    await checkAsync('saveSession(): update path (editIdx.sessions >= 0) preserves list position and id', async () => {
      const idBefore = sandboxGlobals.data.sessions[secondSessionIndex][sessModule.SESSIONS_ID_FIELD];
      sandboxGlobals.__nextFormValue = {
        'رقم_القضية': '2026-56',
        'عنوان_القضية': 'قضية الطلاق (محدّثة)',
        'نوع_الدعوى': 'أحوال شخصية',
        'المحكمة': 'محكمة الأسرة',
        'التاريخ': '2026-08-02',
        'الوقت': '09:30',
        'القاضي': 'سارة',
        'الحالة': 'منتهية',
        'ما_تم_في_الجلسة': 'تم الاستماع للشهود وإصدار القرار',
        'القرار': 'تأجيل',
        'التأجيل_إلى': '',
        'الملاحظات': ''
      };

      await sessModule.saveSession();

      assert.strictEqual(sandboxGlobals.data.sessions.length, 2);
      assert.strictEqual(sandboxGlobals.data.sessions[secondSessionIndex]['عنوان_القضية'], 'قضية الطلاق (محدّثة)');
      assert.strictEqual(sandboxGlobals.data.sessions[secondSessionIndex][sessModule.SESSIONS_ID_FIELD], idBefore,
        'Repository.update() preserves the existing id — same array position, same identity');
      assert.strictEqual(toastLog[toastLog.length - 1].msg, 'تم تحديث الجلسة');
    });

    // ---- DELETE via deleteSession(): removed from mirror, ApiService.deleteData() still called ----
    await checkAsync('deleteSession(i): soft-deletes via Repository.delete(); vanishes from mirror/UI exactly like the old hard delete', async () => {
      const beforeCount = sandboxGlobals.data.sessions.length;
      const deletedId = sandboxGlobals.data.sessions[secondSessionIndex][sessModule.SESSIONS_ID_FIELD];

      await sessModule.deleteSession(secondSessionIndex);

      assert.strictEqual(sandboxGlobals.data.sessions.length, beforeCount - 1);
      assert.ok(!sandboxGlobals.data.sessions.some(function (s) { return s[sessModule.SESSIONS_ID_FIELD] === deletedId; }));
      assert.strictEqual(toastLog[toastLog.length - 1].msg, 'تم الحذف');

      // Confirm this is a SOFT delete under the hood (Repository config,
      // unchanged by this phase) but that this is NOT observable through
      // any path sessions.js/calendar.js/dashboard.js/cases.js actually use:
      const includingDeleted = sessModule.sessionsRepository.getAll({ includeDeleted: true });
      const tombstone = includingDeleted.find(function (s) { return s[sessModule.SESSIONS_ID_FIELD] === deletedId; });
      assert.ok(tombstone && tombstone.deletedAt, 'record is soft-deleted, still in storage with deletedAt');
      assert.ok(!sessModule.sessionsRepository.exists(deletedId), 'but exists()/getAll()/get() all correctly hide it');
    });

    // ---- ApiService.deleteData() call preserved (pre-existing behavior, unlike Documents' gap) ----
    check('deleteSession(): still calls ApiService.deleteData(\'الجلسات\', i) exactly as the original inline deleteSession() did', () => {
      assert.strictEqual(deleteDataLog.length, 1);
      assert.strictEqual(deleteDataLog[0].sheet, 'الجلسات');
      assert.strictEqual(deleteDataLog[0].idx, secondSessionIndex);
    });
  }

  // ================================================================
  // 3. Backward compatibility — pre-existing legacy-shaped localStorage
  // ================================================================

  {
    const legacySeed = {
      sessions: JSON.stringify([
        {
          'رقم_الجلسة': 'legacy-session-1',
          'رقم_القضية': '2025-900',
          'عنوان_القضية': 'قضية قديمة',
          'نوع_الدعوى': 'تجاري',
          'المحكمة': 'محكمة الإسكندرية',
          'التاريخ': '2025-06-01',
          'الوقت': '11:00',
          'القاضي': '',
          'الحالة': 'منتهية',
          'ما_تم_في_الجلسة': '',
          'القرار': '',
          'التأجيل_إلى': '',
          'الملاحظات': '',
          'تاريخ_الإنشاء': '2025-06-01T00:00:00.000Z'
        }
      ])
    };
    const fakeStorage = makeFakeStorage(legacySeed);
    const fakeIndexedDB = new FakeIndexedDB();
    const fakeElements = {};

    const sandboxGlobals = {
      localStorage: fakeStorage,
      indexedDB: fakeIndexedDB,
      window: global,
      data: { sessions: [], cases: [] },
      editIdx: { sessions: -1 },
      document: { getElementById: function (id) { if (!fakeElements[id]) fakeElements[id] = makeFakeElement(); return fakeElements[id]; } },
      toast: function () {},
      updateBadges: function () {},
      closeModal: function () {},
      populateCaseDropdown: function () {},
      autofillSessionFromCase: function () {},
      formatDate: function (d) { return d || '—'; },
      formatTime: function (t) { return t || '—'; },
      parseLocalDate: function (d) { return d ? new Date(d + 'T00:00:00') : null; },
      urgencyBadge: function () { return ''; },
      statusBadge: function () { return ''; },
      sanitizeTime: function (t) { return t || ''; },
      val: function (id) { const el = fakeElements[id]; return el ? el.value : ''; },
      uid: function () { return 'x'; },
      collectForm: function () { return {}; },
      fillForm: function () {},
      ApiService: { syncRow: function () {}, deleteData: function () {} },
      saveLocal: function () {},
      confirm: function () { return true; },
      confirmDialog: __confirmDialogStub,
      console: console
    };

    setGlobals(sandboxGlobals);
    const { createSessionsLocalStorageAdapter } = require(sessionsRepoPath);
    const seedAdapter = createSessionsLocalStorageAdapter(fakeIndexedDB);
    await seedAdapter.write('sessions', JSON.parse(legacySeed.sessions));

    const sessModule = loadModule(sessionsJsPath);

    await checkAsync('Pre-existing legacy-shaped "sessions" data loads unchanged through the Repository', async () => {
      await sessModule.ensureSessionsRepositoryReady();
      const all = sessModule.sessionsRepository.getAll();
      assert.strictEqual(all.length, 1);
      assert.strictEqual(all[0]['رقم_الجلسة'], 'legacy-session-1');
      assert.strictEqual(all[0]['عنوان_القضية'], 'قضية قديمة');
      assert.deepStrictEqual(sandboxGlobals.data.sessions, all);
    });

    await checkAsync('Storage key unchanged: writes still land in the bare "sessions" object store (no prefix)', async () => {
      const raw = await seedAdapter.read('sessions');
      assert.ok(Array.isArray(raw));
      assert.strictEqual(raw[0]['رقم_الجلسة'], 'legacy-session-1');
    });
  }

  // ================================================================
  // Summary
  // ================================================================

  console.log(log.join('\n'));
  console.log('\n' + passed + ' passed, ' + failed + ' failed.');
  if (failed > 0) process.exitCode = 1;
}

main();
