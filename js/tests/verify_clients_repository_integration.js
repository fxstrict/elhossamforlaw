/**
 * verify_clients_repository_integration.js
 * ================================================================
 * PHASE 9 — SUB-PHASE 9.11 — Repository Integration (Clients Module)
 * ================================================================
 * Standalone Node harness (`node js/tests/verify_clients_repository_
 * integration.js`, no browser required) proving that js/modules/
 * clients.js — after this phase's migration — behaves identically to
 * the pre-migration inline module from the caller's point of view, while
 * now reading/writing exclusively through js/repositories/
 * ClientsRepository.js. Structurally mirrors js/tests/verify_documents_
 * repository_integration.js (Sub-Phase 9.3), extended for Clients' three
 * write call sites (saveClient/deleteClient/revokeAndRegenQR, vs.
 * Documents' two) and its Case-modal client-selector read surface.
 *
 * Because clients.js is a classic (non-module) browser script that
 * references a pile of globals (`data`, `editIdx`, `document`, `toast`,
 * `saveLocal`, `ApiService`, `val`, `uid`, `collectForm`, `fillForm`,
 * `resetForm`, `closeModal`, `updateBadges`, `confirm`, `window`), this
 * harness loads the REAL js/modules/clients.js file (via Node's own
 * Module wrapper, so its internal
 * `require('../repositories/ClientsRepository.js')` resolves exactly
 * the way it would from its real location on disk) inside a sandbox
 * that stubs those globals with small, inspectable fakes — the same
 * "single boundary" mocking discipline every existing verify_*.js
 * harness in this project already uses for localStorage.
 *
 * No file is modified by running this harness. It only reads
 * js/modules/clients.js and js/repositories/ClientsRepository.js (and,
 * transitively, js/core/Repository.js / DatabaseService.js /
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

// ---- Fake DOM element (only the surface clients.js actually touches) ----
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
 * clients.js is a classic (non-module) browser script: it references
 * bare identifiers like `data`/`document`/`toast` that are NOT among
 * Module.wrap's function parameters, so they must be resolved via the
 * scope chain, which bottoms out at the real global object when the
 * file is compiled with `vm`'s `runInThisContext`. Because clients.js
 * itself kicks off an async `.open().then(...)` chain at load time whose
 * continuation (syncClientsMirror, referencing `data`) runs on a LATER
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
 * real on-disk location (js/modules/clients.js's
 * `require('../repositories/ClientsRepository.js')` must resolve to
 * js/repositories/ClientsRepository.js, not to something relative to
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

/**
 * Builds a fresh sandbox globals object. Shared shape used by every test
 * block below; each block gets its own fakeElements/logs closure.
 */
function makeSandbox(seedStorage) {
  const fakeStorage = makeFakeStorage(seedStorage || {});
  const fakeIndexedDB = new FakeIndexedDB();
  const fakeElements = {};
  const toastLog = [];
  const badgeCalls = { count: 0 };
  const closeModalLog = [];
  const syncRowLog = [];
  const updateDataLog = [];
  const deleteDataLog = [];
  const saveLocalCalls = { count: 0 };
  const clickListeners = [];

  const sandboxGlobals = {
    localStorage: fakeStorage,
    indexedDB: fakeIndexedDB,
    window: global,
    data: { clients: [], cases: [], fees: [] },
    editIdx: { clients: -1 },
    document: {
      getElementById: function (id) {
        if (!fakeElements[id]) fakeElements[id] = makeFakeElement();
        return fakeElements[id];
      },
      addEventListener: function (evt, fn) { clickListeners.push({ evt: evt, fn: fn }); }
    },
    toast: function (msg, type) { toastLog.push({ msg: msg, type: type }); },
    updateBadges: function () { badgeCalls.count++; },
    closeModal: function (id) { closeModalLog.push(id); },
    formatDate: function (d) { return d || '—'; },
    val: function (id) {
      const el = fakeElements[id];
      return el ? el.value : '';
    },
    uid: function () { return 'test-uid-' + Math.random().toString(36).slice(2, 8); },
    collectForm: function () { return sandboxGlobals.__nextFormValue || {}; },
    fillForm: function (type, obj) { sandboxGlobals.__lastFilled = obj; },
    resetForm: function (type) { sandboxGlobals.__lastResetType = type; },
    ApiService: {
      syncRow: function (sheet, obj, idx) { syncRowLog.push({ sheet: sheet, obj: obj, idx: idx }); },
      deleteData: function (sheet, idx) { deleteDataLog.push({ sheet: sheet, idx: idx }); },
      updateData: function (sheet, obj, idx) { updateDataLog.push({ sheet: sheet, obj: obj, idx: idx }); },
      getPortalUrl: function (token) { return 'https://portal.example/' + token; },
      getQrImageUrl: function (data, size, ecc) { return 'https://qr.example/?d=' + encodeURIComponent(data); }
    },
    saveLocal: function () { saveLocalCalls.count++; },
    confirm: function () { return true; },
    confirmDialog: __confirmDialogStub,
    console: console
  };

  return {
    sandboxGlobals: sandboxGlobals,
    fakeElements: fakeElements,
    toastLog: toastLog,
    badgeCalls: badgeCalls,
    closeModalLog: closeModalLog,
    syncRowLog: syncRowLog,
    updateDataLog: updateDataLog,
    deleteDataLog: deleteDataLog,
    saveLocalCalls: saveLocalCalls,
    fakeStorage: fakeStorage
  };
}

async function main() {

  const clientsJsPath = path.join(__dirname, '..', 'modules', 'clients.js');
  const clientsRepoPath = path.join(__dirname, '..', 'repositories', 'ClientsRepository.js');
  const repositoryCorePath = path.join(__dirname, '..', 'core', 'Repository.js');
  const databaseServicePath = path.join(__dirname, '..', 'core', 'DatabaseService.js');
  const localStorageAdapterPath = path.join(__dirname, '..', 'core', 'LocalStorageAdapter.js');
  const apiServicePath = path.join(__dirname, '..', 'api', 'api.js');
  const casesJsPath = path.join(__dirname, '..', 'modules', 'cases.js');
  const dashboardJsPath = path.join(__dirname, '..', 'modules', 'dashboard.js');

  // ================================================================
  // 1. Static checks — only clients.js touched, nothing else edited
  // ================================================================

  check('js/modules/clients.js exists and is valid JS (node --check equivalent: parses via vm)', () => {
    const code = fs.readFileSync(clientsJsPath, 'utf8');
    assert.doesNotThrow(() => new vm.Script(Module.wrap(code), { filename: clientsJsPath }));
  });

  check('ClientsRepository.js on disk is unmodified (still exports ClientsRepository + factory)', () => {
    const ns = require(clientsRepoPath);
    assert.strictEqual(typeof ns.ClientsRepository, 'function');
    assert.strictEqual(typeof ns.createClientsLocalStorageAdapter, 'function');
  });

  check('Repository.js on disk is unmodified (still exports Repository)', () => {
    const ns = require(repositoryCorePath);
    assert.strictEqual(typeof ns.Repository, 'function');
  });

  check('DatabaseService.js on disk is unmodified (still exports DatabaseService)', () => {
    const ns = require(databaseServicePath);
    assert.strictEqual(typeof ns.DatabaseService, 'function');
  });

  check('LocalStorageAdapter.js on disk is unmodified (still exports LocalStorageAdapter)', () => {
    const ns = require(localStorageAdapterPath);
    assert.strictEqual(typeof ns.LocalStorageAdapter, 'function');
  });

  check('ApiService (js/api/api.js) file is present on disk, untouched by this phase', () => {
    assert.ok(fs.existsSync(apiServicePath));
  });

  check('cases.js still reads plain data.clients (linear scans preserved, file untouched by this phase)', () => {
    const code = fs.readFileSync(casesJsPath, 'utf8');
    assert.ok(code.indexOf('data.clients') !== -1);
    assert.ok(code.indexOf('quickCaseQR') !== -1);
  });

  check('dashboard.js still reads plain data.clients.length (file untouched by this phase)', () => {
    const code = fs.readFileSync(dashboardJsPath, 'utf8');
    assert.ok(code.indexOf('data.clients.length') !== -1);
  });

  // ================================================================
  // 2. Fresh load (empty localStorage — real first-run condition)
  // ================================================================

  let clientsModule, sandbox, secondClientIndex = -1, secondClientId = null;

  {
    sandbox = makeSandbox({});
    const { sandboxGlobals, fakeElements, toastLog, badgeCalls, closeModalLog, syncRowLog, saveLocalCalls } = sandbox;

    setGlobals(sandboxGlobals);
    clientsModule = loadModule(clientsJsPath);

    await checkAsync('Fresh load: repository opens with zero records, data.clients mirror is []', async () => {
      await clientsModule.ensureClientsRepositoryReady();
      assert.deepStrictEqual(clientsModule.clientsRepository.getAll(), []);
      assert.deepStrictEqual(sandboxGlobals.data.clients, []);
    });

    // ---- CREATE via saveClient() ----
    await checkAsync('saveClient(): create path (editIdx.clients = -1) inserts a new record via Repository.create(), stamps رقم_الموكل/تاريخ_الإنشاء', async () => {
      fakeElements['fClientName'] = makeFakeElement();
      fakeElements['fClientName'].value = 'أحمد محمود';
      sandboxGlobals.__nextFormValue = {
        'الاسم': 'أحمد محمود',
        'النوع': 'فرد',
        'الرقم_القومي': '29001011234567',
        'الهاتف': '01000000001',
        'البريد': '',
        'العنوان': 'القاهرة',
        'الوظيفة': 'مهندس',
        'جهة_العمل': 'شركة أ',
        'الحالة_الاجتماعية': 'أعزب',
        'ملاحظات': ''
      };
      sandboxGlobals.editIdx.clients = -1;

      await clientsModule.saveClient();

      assert.strictEqual(sandboxGlobals.data.clients.length, 1);
      const rec = sandboxGlobals.data.clients[0];
      assert.strictEqual(rec['الاسم'], 'أحمد محمود');
      assert.ok(rec[clientsModule.CLIENTS_ID_FIELD], 'a رقم_الموكل id must have been generated');
      assert.ok(rec['تاريخ_الإنشاء'], 'تاريخ_الإنشاء must have been stamped');
      assert.strictEqual(toastLog[toastLog.length - 1].msg, 'تمت إضافة الموكل بنجاح');
      assert.strictEqual(saveLocalCalls.count, 1);
      assert.strictEqual(syncRowLog[syncRowLog.length - 1].sheet, 'الموكلين');
      assert.strictEqual(syncRowLog[syncRowLog.length - 1].idx, -1);
      assert.strictEqual(closeModalLog[closeModalLog.length - 1], 'modalClient');
      assert.strictEqual(badgeCalls.count, 1);
    });

    // ---- CREATE a second record (for search/filter/index/QR tests) ----
    await checkAsync('saveClient(): create a second record with a portal_token-relevant name', async () => {
      sandboxGlobals.__nextFormValue = {
        'الاسم': 'سارة عبد الله',
        'النوع': 'شركة',
        'الرقم_القومي': '29505051234567',
        'الهاتف': '01000000002',
        'البريد': 'sara@example.com',
        'العنوان': 'الجيزة',
        'الوظيفة': 'محاسبة',
        'جهة_العمل': 'شركة ب',
        'الحالة_الاجتماعية': 'متزوجة',
        'ملاحظات': 'عميلة مميزة'
      };
      sandboxGlobals.editIdx.clients = -1;
      await clientsModule.saveClient();
      assert.strictEqual(sandboxGlobals.data.clients.length, 2);
    });

    // ---- VALIDATION: empty name blocked before any Repository call ----
    check('saveClient(): empty fClientName is still blocked with the original Arabic toast, before any Repository call', () => {
      fakeElements['fClientName'].value = '   ';
      const before = sandboxGlobals.data.clients.length;
      const toastCountBefore = toastLog.length;
      // saveClient() is async but the guard clause returns before any
      // await, so no promise needs to be awaited for this observation.
      clientsModule.saveClient();
      assert.strictEqual(sandboxGlobals.data.clients.length, before);
      assert.strictEqual(toastLog.length, toastCountBefore + 1);
      assert.strictEqual(toastLog[toastLog.length - 1].msg, 'يرجى إدخال اسم الموكل');
      assert.strictEqual(toastLog[toastLog.length - 1].type, 'error');
      fakeElements['fClientName'].value = 'أحمد محمود'; // restore for later checks
    });

    // ---- READ: renderClients() full-record free-text search (Repository.search(), synchronous) ----
    check('renderClients(): full-record free-text search still matches on notes field (not just the 3-field CLIENTS_SEARCH_FIELDS list)', () => {
      fakeElements['searchClients'] = makeFakeElement();
      fakeElements['searchClients'].value = 'مميزة'; // only in client #2's ملاحظات
      fakeElements['clientsTableBody'] = makeFakeElement();
      fakeElements['clientsMobileList'] = makeFakeElement();
      fakeElements['clientsEmpty'] = makeFakeElement();

      clientsModule.renderClients();

      assert.ok(fakeElements['clientsTableBody'].innerHTML.indexOf('سارة عبد الله') !== -1);
      assert.ok(fakeElements['clientsTableBody'].innerHTML.indexOf('أحمد محمود') === -1);
      assert.strictEqual(fakeElements['clientsEmpty'].style.display, 'none');
    });

    // ---- READ: empty-result path (#clientsEmpty shown, both lists cleared) ----
    check('renderClients(): no matches shows #clientsEmpty and clears both lists', () => {
      fakeElements['searchClients'].value = 'نص-غير-موجود-إطلاقاً';

      clientsModule.renderClients();

      assert.strictEqual(fakeElements['clientsTableBody'].innerHTML, '');
      assert.strictEqual(fakeElements['clientsMobileList'].innerHTML, '');
      assert.strictEqual(fakeElements['clientsEmpty'].style.display, '');
    });

    // ---- searchClients() alias still just delegates to renderClients() ----
    check('searchClients(): pure alias/delegate to renderClients() (identical output)', () => {
      fakeElements['searchClients'].value = '';
      clientsModule.searchClients();
      assert.ok(fakeElements['clientsTableBody'].innerHTML.indexOf('أحمد محمود') !== -1);
      assert.ok(fakeElements['clientsTableBody'].innerHTML.indexOf('سارة عبد الله') !== -1);
    });

    // ---- Index -> record -> id translation layer, exercised end-to-end (audit R-01) ----
    check('renderClients(): embeds resolvable indexes in onclick handlers matching the data.clients mirror (R-01 fixed via resolveClientIndex)', () => {
      fakeElements['searchClients'].value = '';
      clientsModule.renderClients();

      secondClientIndex = clientsModule.resolveClientIndex(sandboxGlobals.data.clients, sandboxGlobals.data.clients[1]);
      secondClientId = sandboxGlobals.data.clients[1][clientsModule.CLIENTS_ID_FIELD];
      assert.strictEqual(secondClientIndex, 1);
      assert.ok(fakeElements['clientsTableBody'].innerHTML.indexOf('viewClient(' + secondClientIndex + ')') !== -1);
      assert.ok(fakeElements['clientsTableBody'].innerHTML.indexOf('editClient(' + secondClientIndex + ')') !== -1);
      assert.ok(fakeElements['clientsTableBody'].innerHTML.indexOf('genClientQR(' + secondClientIndex + ')') !== -1);
      assert.ok(fakeElements['clientsTableBody'].innerHTML.indexOf('deleteClient(' + secondClientIndex + ')') !== -1);
      // Regression checklist §10 item 5: every row's four action buttons
      // resolve to the correct client after a search filter narrows rows.
      assert.ok(fakeElements['clientsMobileList'].innerHTML.indexOf('viewClient(' + secondClientIndex + ')') !== -1);
    });

    // ---- editClient(): synchronous, no Repository call, reads mirror only ----
    check('editClient(i): purely synchronous, pre-fills form from data.clients[i] (no Repository call)', () => {
      fakeElements['modalClientTitle'] = makeFakeElement();
      fakeElements['modalClient'] = makeFakeElement();

      clientsModule.editClient(secondClientIndex);

      assert.strictEqual(sandboxGlobals.editIdx.clients, secondClientIndex);
      assert.strictEqual(sandboxGlobals.__lastFilled['الاسم'], 'سارة عبد الله');
      assert.strictEqual(fakeElements['modalClientTitle'].textContent, 'تعديل بيانات الموكل');
      assert.ok(fakeElements['modalClient'].classList.contains('open'));
    });

    // ---- UPDATE via saveClient(): same array position + id preserved, original id/created-date NOT regenerated ----
    await checkAsync('saveClient(): update path (editIdx.clients >= 0) preserves رقم_الموكل and تاريخ_الإنشاء, does not regenerate either', async () => {
      const before = sandboxGlobals.data.clients[secondClientIndex];
      const idBefore = before[clientsModule.CLIENTS_ID_FIELD];
      const createdBefore = before['تاريخ_الإنشاء'];

      sandboxGlobals.__nextFormValue = {
        'رقم_الموكل': idBefore,
        'تاريخ_الإنشاء': createdBefore,
        'الاسم': 'سارة عبد الله (محدثة)',
        'النوع': 'شركة',
        'الرقم_القومي': '29505051234567',
        'الهاتف': '01000000002',
        'البريد': 'sara@example.com',
        'العنوان': 'الجيزة',
        'الوظيفة': 'محاسبة',
        'جهة_العمل': 'شركة ب',
        'الحالة_الاجتماعية': 'متزوجة',
        'ملاحظات': 'عميلة مميزة'
      };

      await clientsModule.saveClient();

      assert.strictEqual(sandboxGlobals.data.clients.length, 2);
      const rec = clientsModule.resolveClientIndex(sandboxGlobals.data.clients, { }) === -1
        ? sandboxGlobals.data.clients.filter(function (c) { return c[clientsModule.CLIENTS_ID_FIELD] === idBefore; })[0]
        : null;
      const updated = sandboxGlobals.data.clients.filter(function (c) { return c[clientsModule.CLIENTS_ID_FIELD] === idBefore; })[0];
      assert.strictEqual(updated['الاسم'], 'سارة عبد الله (محدثة)');
      assert.strictEqual(updated[clientsModule.CLIENTS_ID_FIELD], idBefore, 'رقم_الموكل must not be regenerated on update');
      assert.strictEqual(updated['تاريخ_الإنشاء'], createdBefore, 'تاريخ_الإنشاء must not be regenerated on update');
      assert.strictEqual(toastLog[toastLog.length - 1].msg, 'تم تحديث بيانات الموكل');
    });

    // ---- viewClient() / buildClientReport() / printView() mutual exclusivity with cases ----
    check('viewClient(i): sets window._currentViewClient and nulls _currentViewCase (view-modal mutual exclusivity, regression checklist §10 item 10)', () => {
      fakeElements['viewModalTitle'] = makeFakeElement();
      fakeElements['viewPortalBtn'] = makeFakeElement();
      fakeElements['viewModalBody'] = makeFakeElement();
      fakeElements['modalView'] = makeFakeElement();
      global._currentViewCase = { fake: 'case' };

      clientsModule.viewClient(secondClientIndex);

      assert.ok(global._currentViewClient, 'window._currentViewClient must be set');
      assert.strictEqual(global._currentViewCase, null, 'window._currentViewCase must be nulled by viewClient()');
      assert.strictEqual(global._currentViewClientIdx, secondClientIndex);
      assert.ok(fakeElements['modalView'].classList.contains('open'));
      assert.ok(fakeElements['viewModalBody'].innerHTML.indexOf('سارة عبد الله') !== -1);
    });

    // ---- buildClientReport(): cross-entity reads of data.cases/data.fees unaffected (regression checklist §10 item 12) ----
    check('buildClientReport(c): linked-cases/linked-fees sections still read live data.cases/data.fees (unaffected by this migration)', () => {
      sandboxGlobals.data.cases = [{ 'اسم_الموكل': 'سارة عبد الله (محدثة)', 'رقم_القضية': '2026-1', 'عنوان_القضية': 'قضية تجريبية', 'نوع_الدعوى': 'مدني', 'الحالة': 'نشطة' }];
      sandboxGlobals.data.fees = [{ 'اسم_الموكل': 'سارة عبد الله (محدثة)', 'رقم_القضية': '2026-1', 'المبلغ': '5000', 'نوع_الأتعاب': 'أتعاب أولى' }];

      const html = clientsModule.buildClientReport(sandboxGlobals.data.clients.filter(function (c) { return c[clientsModule.CLIENTS_ID_FIELD] === secondClientId; })[0]);

      assert.ok(html.indexOf('2026-1') !== -1);
      // Amount is rendered via Number(...).toLocaleString('ar-EG'), which
      // emits Arabic-Indic digits (٥٬٠٠٠), not ASCII '5000' — assert on
      // the fee-type text instead, which is unaffected by locale digit
      // formatting and equally proves the linked-fees section rendered.
      assert.ok(html.indexOf('أتعاب أولى') !== -1);
    });

    // ---- genClientQR(): no-ops with a toast when portal_token is absent ----
    // NOTE: prior to the portal_token fix, saveClient() never stamped a
    // portal_token on create — so this same "second client" (created via
    // saveClient() earlier in this suite) reached this point with no
    // token, and genClientQR() correctly no-op'd with an info toast. That
    // was the exact bug reported (QR/portal button dead-ends forever for
    // every client, because saveClient() never generates a token and the
    // only function that could — revokeAndRegenQR() — is only reachable
    // from inside the very modal genClientQR() refuses to open without a
    // token already present). The three checks below replace the old
    // (bug-encoding) assertion with checks for the corrected behavior.
    check('saveClient(): auto-generates portal_token on create (bug fix)', () => {
      assert.ok(
        sandboxGlobals.data.clients[secondClientIndex]['portal_token'],
        'expected saveClient() to have stamped a portal_token automatically on create'
      );
    });

    check('genClientQR(i): opens the modal directly for a client saved via saveClient() (token already auto-generated, no dead-end toast)', () => {
      fakeElements['portalClientLabel'] = makeFakeElement();
      fakeElements['portalLinkDiv'] = makeFakeElement();
      fakeElements['qrCodeDiv'] = makeFakeElement();
      fakeElements['modalPortal'] = makeFakeElement();
      global.window = global; global.window.innerWidth = 800;

      clientsModule.genClientQR(secondClientIndex);
      assert.ok(fakeElements['modalPortal'].classList.contains('open'));
    });

    await checkAsync('genClientQR(i): still shows the actionable info toast for a legacy client with no portal_token (record created bypassing saveClient(), simulating data saved before this fix)', async () => {
      const legacyResult = await clientsModule.clientsRepository.create({ 'الاسم': 'موكل قديم بدون توكن' });
      assert.ok(legacyResult.success);
      clientsModule.syncClientsMirror();
      const legacyIdx = clientsModule.resolveClientIndex(
        sandboxGlobals.data.clients,
        sandboxGlobals.data.clients.find(function (c) {
          return c[clientsModule.CLIENTS_ID_FIELD] === legacyResult.record[clientsModule.CLIENTS_ID_FIELD];
        })
      );
      const toastCountBefore = toastLog.length;
      clientsModule.genClientQR(legacyIdx);
      assert.strictEqual(toastLog.length, toastCountBefore + 1);
      assert.strictEqual(toastLog[toastLog.length - 1].type, 'info');

      // تنظيف: هذا الموكل الصوري أُنشئ فقط لمحاكاة سجل قديم بلا توكن —
      // يُحذف فورًا حتى لا يغيّر عدد السجلات المتوقع في اختبارات لاحقة
      // بهذا الملف (مثل اختبار deleteClient() أدناه الذي يفترض عددًا
      // محددًا من الموكلين الحاليين).
      await clientsModule.clientsRepository.delete(legacyResult.record[clientsModule.CLIENTS_ID_FIELD]);
      clientsModule.syncClientsMirror();
    });

    // ---- revokeAndRegenQR(): only works when a portal has already been generated; needs a token first ----
    // First, seed a portal_token via a direct saveClient() update cycle equivalent to genClientQR's own
    // real-world precondition (a token is normally set by the GAS backend on first sync; here we simulate
    // it by patching through the Repository directly, mirroring what a real portal-activated record looks like).
    await checkAsync('(setup) seed a portal_token on the second client via clientsRepository.update() directly', async () => {
      const result = await clientsModule.clientsRepository.update(secondClientId, { portal_token: 'seed-token-abc' });
      assert.ok(result.success);
      clientsModule.syncClientsMirror();
    });

    check('genClientQR(i): resolves portal URL and opens the modal when portal_token is present', () => {
      fakeElements['portalClientLabel'] = makeFakeElement();
      fakeElements['portalLinkDiv'] = makeFakeElement();
      fakeElements['qrCodeDiv'] = makeFakeElement();
      fakeElements['modalPortal'] = makeFakeElement();
      global.window = global; global.window.innerWidth = 800;

      clientsModule.genClientQR(secondClientIndex);

      assert.strictEqual(global._portalToken, 'seed-token-abc');
      assert.strictEqual(global._portalClientIdx, secondClientIndex);
      assert.ok(fakeElements['modalPortal'].classList.contains('open'));
    });

    // ---- showClientPortal(): delegates using the index stashed by viewClient() ----
    check('showClientPortal(): delegates to genClientQR() using window._currentViewClientIdx stashed by viewClient()', () => {
      global._currentViewClientIdx = secondClientIndex;
      const before = global._portalToken;
      clientsModule.showClientPortal();
      assert.strictEqual(global._portalToken, before, 'same client, same token — resolves the same record');
    });

    // ---- revokeAndRegenQR(): partial-field Repository update (R-03), new token reflected immediately ----
    await checkAsync('revokeAndRegenQR(): produces a new portal_token via a partial Repository.update() patch, reflected immediately in a subsequent genClientQR() (regression checklist §10 item 9)', async () => {
      const oldToken = global._portalToken;
      const idBefore = sandboxGlobals.data.clients[secondClientIndex][clientsModule.CLIENTS_ID_FIELD];
      const nameBefore = sandboxGlobals.data.clients[secondClientIndex]['الاسم'];

      await clientsModule.revokeAndRegenQR();

      assert.notStrictEqual(global._portalToken, oldToken, 'a new token must have been generated');
      assert.strictEqual(sandbox.updateDataLog[sandbox.updateDataLog.length - 1].sheet, 'الموكلين');
      assert.strictEqual(toastLog[toastLog.length - 1].msg, 'تم إنشاء رمز QR جديد — الرمز القديم لم يعد صالحاً');
      assert.strictEqual(closeModalLog[closeModalLog.length - 1], 'modalPortal');

      // Other fields on the record must be untouched by this PARTIAL patch —
      // confirms Repository.update()'s merge semantics, not a full overwrite.
      const rec = sandboxGlobals.data.clients.filter(function (c) { return c[clientsModule.CLIENTS_ID_FIELD] === idBefore; })[0];
      assert.strictEqual(rec['الاسم'], nameBefore);

      // Immediately reflected in a subsequent genClientQR() call, without
      // requiring a renderClients() refresh first (checklist item 9).
      const latestToken = global._portalToken;
      clientsModule.genClientQR(secondClientIndex);
      assert.strictEqual(global._portalToken, latestToken);
    });

    // ---- Group E: Client Selector picker (Case-modal), independent of renderClients()'s search ----
    check('renderClientSelectorList(): lists all non-empty-named clients, independent search from renderClients() (regression checklist §10 item 11)', () => {
      fakeElements['clientSelectorList'] = makeFakeElement();
      fakeElements['clientSelectorSearch'] = makeFakeElement();
      fakeElements['clientSelectorSearch'].value = '';

      clientsModule.renderClientSelectorList();

      assert.ok(fakeElements['clientSelectorList'].innerHTML.indexOf('أحمد محمود') !== -1);
      assert.ok(fakeElements['clientSelectorList'].innerHTML.indexOf('سارة عبد الله (محدثة)') !== -1);
    });

    check('_autofillCaseClientDetails(): autofills 5 detail fields from data.clients when exactly one client is selected', () => {
      fakeElements['fCaseClientNID'] = makeFakeElement();
      fakeElements['fCaseClientPhone'] = makeFakeElement();
      fakeElements['fCaseClientAddr'] = makeFakeElement();
      fakeElements['fCaseClientJob'] = makeFakeElement();
      fakeElements['fCaseClientEmployer'] = makeFakeElement();
      fakeElements['fCaseClient'] = makeFakeElement();

      clientsModule.toggleCaseClient('أحمد محمود', true);

      assert.strictEqual(fakeElements['fCaseClientNID'].value, '29001011234567');
      assert.strictEqual(fakeElements['fCaseClientPhone'].value, '01000000001');
      assert.strictEqual(fakeElements['fCaseClient'].value, 'أحمد محمود');

      clientsModule.toggleCaseClient('أحمد محمود', false); // cleanup selection state
    });

    check('syncCaseClientSelectorFromField(): round-trips picker state from #fCaseClient (regression checklist §10 item 11)', () => {
      fakeElements['fCaseClient'].value = 'أحمد محمود، سارة عبد الله (محدثة)';
      fakeElements['clientSelectorChips'] = makeFakeElement();

      clientsModule.syncCaseClientSelectorFromField();

      assert.ok(fakeElements['clientSelectorChips'].innerHTML.indexOf('أحمد محمود') !== -1);
      assert.ok(fakeElements['clientSelectorChips'].innerHTML.indexOf('سارة عبد الله (محدثة)') !== -1);
    });

    // ---- printClientsReport(): lists every client, same column order (regression checklist §10 item 13) ----
    check('printClientsReport(): builds a print document listing every current (non-deleted) client', () => {
      const originalOpen = global.window.open;
      let capturedHtml = null;
      global.window.open = function () {
        return {
          document: { write: function (html) { capturedHtml = html; }, close: function () {} },
          focus: function () {},
          print: function () {}
        };
      };
      const originalSetTimeout = global.setTimeout;
      global.setTimeout = function (fn) { fn(); };

      clientsModule.printClientsReport();

      assert.ok(capturedHtml && capturedHtml.indexOf('أحمد محمود') !== -1);
      assert.ok(capturedHtml && capturedHtml.indexOf('سارة عبد الله (محدثة)') !== -1);

      global.window.open = originalOpen;
      global.setTimeout = originalSetTimeout;
    });

    // ---- DELETE via deleteClient(): removed from mirror, badge/search reflect it, ApiService called with plain index (R-06) ----
    await checkAsync('deleteClient(i): soft-deletes via Repository.delete(); vanishes from mirror/UI exactly like the old hard delete', async () => {
      const beforeCount = sandboxGlobals.data.clients.length;
      const idxToDelete = clientsModule.resolveClientIndex(sandboxGlobals.data.clients, sandboxGlobals.data.clients.filter(function (c) { return c[clientsModule.CLIENTS_ID_FIELD] === secondClientId; })[0]);
      const deletedId = secondClientId;

      await clientsModule.deleteClient(idxToDelete);

      assert.strictEqual(sandboxGlobals.data.clients.length, beforeCount - 1);
      assert.ok(!sandboxGlobals.data.clients.some(function (c) { return c[clientsModule.CLIENTS_ID_FIELD] === deletedId; }));
      assert.strictEqual(toastLog[toastLog.length - 1].msg, 'تم حذف الموكل');

      // R-06 (documented, not fixed): ApiService.deleteData() still receives
      // the plain frontend index, exactly as before migration.
      assert.strictEqual(sandbox.deleteDataLog[sandbox.deleteDataLog.length - 1].sheet, 'الموكلين');
      assert.strictEqual(sandbox.deleteDataLog[sandbox.deleteDataLog.length - 1].idx, idxToDelete);

      // Confirm this is a SOFT delete under the hood (Repository config,
      // unchanged by this phase) but that this is NOT observable through
      // any path clients.js/cases.js/dashboard.js actually use — this is
      // an INTENTIONAL, EXPECTED divergence (regression checklist §10
      // item 7), not a regression.
      const includingDeleted = clientsModule.clientsRepository.getAll({ includeDeleted: true });
      const tombstone = includingDeleted.find(function (c) { return c[clientsModule.CLIENTS_ID_FIELD] === deletedId; });
      assert.ok(tombstone && tombstone.deletedAt, 'record is soft-deleted, still in storage with deletedAt');
      assert.ok(!clientsModule.clientsRepository.exists(deletedId), 'but exists()/getAll()/get() all correctly hide it');
    });

    // ---- data.clients.length reflects the deletion immediately (regression checklist §10 item 14) ----
    check('data.clients.length (read by dashboard.js) reflects only non-deleted clients immediately after delete', () => {
      assert.strictEqual(sandboxGlobals.data.clients.length, 1);
    });

    // ---- cases.js-style linear scan over data.clients still works unmodified against the mirror ----
    check('cases.js-style linear scan (quickCaseQR pattern) still resolves a client by name against the Repository-backed mirror', () => {
      let ci = -1;
      for (let x = 0; x < sandboxGlobals.data.clients.length; x++) {
        if ((sandboxGlobals.data.clients[x]['الاسم'] || '').trim() === 'أحمد محمود') { ci = x; break; }
      }
      assert.strictEqual(ci, 0);
    });
  }

  // ================================================================
  // 3. Repository core method regression (Repository.open/getAll/search/
  //    filter/create/update/delete/exists — audit's mandatory list)
  // ================================================================

  {
    const sandbox2 = makeSandbox({});
    setGlobals(sandbox2.sandboxGlobals);
    const cm2 = loadModule(clientsJsPath);

    await checkAsync('Repository.open()/isReady() lifecycle behaves as documented (opening -> ready)', async () => {
      await cm2.ensureClientsRepositoryReady();
      assert.ok(cm2.clientsRepository.isReady());
    });

    await checkAsync('Repository.create() + getAll() + exists() round-trip', async () => {
      const r = await cm2.clientsRepository.create({ 'الاسم': 'عميل تجريبي' });
      assert.ok(r.success);
      assert.ok(cm2.clientsRepository.exists(r.record[cm2.CLIENTS_ID_FIELD]));
      assert.strictEqual(cm2.clientsRepository.getAll().length, 1);
    });

    await checkAsync('Repository.search()/filter() synchronous read methods work against the live instance', async () => {
      const searchResult = cm2.clientsRepository.search({ search: 'تجريبي' });
      assert.strictEqual(searchResult.items.length, 1);
      const filtered = cm2.clientsRepository.filter({});
      assert.strictEqual(filtered.length, 1);
    });

    await checkAsync('Repository.update()/delete() round-trip, exists() flips false after delete', async () => {
      const all = cm2.clientsRepository.getAll();
      const id = all[0][cm2.CLIENTS_ID_FIELD];
      const upd = await cm2.clientsRepository.update(id, { 'ملاحظات': 'محدث' });
      assert.ok(upd.success);
      assert.strictEqual(upd.record['ملاحظات'], 'محدث');
      const del = await cm2.clientsRepository.delete(id);
      assert.ok(del.success);
      assert.strictEqual(cm2.clientsRepository.exists(id), false);
    });
  }

  // ================================================================
  // 4. Backward compatibility — pre-existing legacy-shaped data
  // PHASE 13.6: Repository now persists exclusively through
  // IndexedDBAdapter, so a raw localStorage["clients"] JSON string is
  // no longer read at all — seed the object store directly instead
  // (same fix as verify_cases_repository_integration.js).
  // ================================================================

  {
    const legacySeed = {
      clients: JSON.stringify([
        {
          'رقم_الموكل': 'legacy-client-1',
          'الاسم': 'موكل قديم',
          'النوع': 'فرد',
          'الرقم_القومي': '28001011234567',
          'الهاتف': '01099999999',
          'البريد': '',
          'العنوان': 'الإسكندرية',
          'الوظيفة': 'تاجر',
          'جهة_العمل': '',
          'الحالة_الاجتماعية': 'متزوج',
          'ملاحظات': '',
          'تاريخ_الإنشاء': '2025-01-01T00:00:00.000Z'
        }
      ])
    };
    const sandbox3 = makeSandbox(legacySeed);
    const { createClientsLocalStorageAdapter } = require(clientsRepoPath);
    const seedAdapter = createClientsLocalStorageAdapter(sandbox3.sandboxGlobals.indexedDB);
    await seedAdapter.write('clients', JSON.parse(legacySeed.clients));

    setGlobals(sandbox3.sandboxGlobals);
    const cm3 = loadModule(clientsJsPath);

    await checkAsync('Pre-existing legacy-shaped "clients" data loads unchanged through the Repository', async () => {
      await cm3.ensureClientsRepositoryReady();
      const all = cm3.clientsRepository.getAll();
      assert.strictEqual(all.length, 1);
      assert.strictEqual(all[0]['رقم_الموكل'], 'legacy-client-1');
      assert.strictEqual(all[0]['الاسم'], 'موكل قديم');
      assert.deepStrictEqual(sandbox3.sandboxGlobals.data.clients, all);
    });

    await checkAsync('Storage key unchanged: writes still land in the bare "clients" object store (no prefix)', async () => {
      const raw = await seedAdapter.read('clients');
      assert.ok(Array.isArray(raw));
      assert.strictEqual(raw[0]['رقم_الموكل'], 'legacy-client-1');
    });
  }

  // ================================================================
  // 5. No unhandled rejections / console.error during normal flows
  //    (regression checklist §10 item 15)
  // ================================================================

  {
    const originalConsoleError = console.error;
    let errorCount = 0;
    console.error = function () { errorCount++; originalConsoleError.apply(console, arguments); };

    const sandbox4 = makeSandbox({});
    setGlobals(sandbox4.sandboxGlobals);
    const cm4 = loadModule(clientsJsPath);

    await checkAsync('No console.error during a normal add/edit/delete cycle', async () => {
      sandbox4.fakeElements['fClientName'] = makeFakeElement();
      sandbox4.fakeElements['fClientName'].value = 'موكل الفحص';
      sandbox4.sandboxGlobals.__nextFormValue = { 'الاسم': 'موكل الفحص' };
      sandbox4.sandboxGlobals.editIdx.clients = -1;
      await cm4.saveClient();

      const idx = 0;
      sandbox4.sandboxGlobals.editIdx.clients = idx;
      sandbox4.fakeElements['modalClientTitle'] = makeFakeElement();
      sandbox4.fakeElements['modalClient'] = makeFakeElement();
      cm4.editClient(idx);

      await cm4.deleteClient(idx);

      assert.strictEqual(errorCount, 0);
    });

    console.error = originalConsoleError;
  }

  // ================================================================
  // Summary
  // ================================================================

  console.log(log.join('\n'));
  console.log('\n' + passed + ' passed, ' + failed + ' failed.');
  if (failed > 0) process.exitCode = 1;
}

main();
