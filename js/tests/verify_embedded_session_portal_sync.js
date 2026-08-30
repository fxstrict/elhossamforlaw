/**
 * verify_embedded_session_portal_sync.js
 * PROBLEM 3 (Case Save Cycle audit, v79) — Regression test.
 *
 * ROOT CAUSE (proved by code trace across the full path, not guessed):
 *   Traced PATH A (embedded: Case Form -> #fCaseSessionDate ->
 *   _createEmbeddedSessionIfFilled() -> sessions.js -> repository ->
 *   sync -> Google Sheets -> Client Portal -> filtering -> rendering)
 *   against PATH B (standalone: Sessions screen -> saveSession() ->
 *   same repository -> sync -> Sheets -> Portal), comparing every value
 *   at every point.
 *
 *   Both paths write an identical, correctly-linked session to
 *   SessionsRepository (رقم_القضية set correctly in both — verified by
 *   the pre-existing verify_embedded_session_in_case.js test, still
 *   passing). They do NOT diverge at the repository layer.
 *
 *   They diverge one step later. Standalone saveSession() (sessions.js)
 *   ends with:
 *       saveLocal();
 *       ApiService.syncRow('الجلسات', result.record, idx);
 *   _createEmbeddedSessionIfFilled() (sessions.js) has NO equivalent
 *   call anywhere in its body — it calls syncSessionsMirror() (a purely
 *   local IndexedDB->mirror refresh) and stops. The embedded record is
 *   never pushed to Google Sheets.
 *
 *   Config/05_Portal.gs's serveClientPortal() reads sessions exclusively
 *   from Sheets (`readSheetObjects(ss, 'الجلسات')`) and filters them by
 *   `String(s['رقم_القضية']||'').trim() === caseNum` (verbatim, quoted
 *   below from the real file). A session that only exists in local
 *   IndexedDB — regardless of how correctly رقم_القضية is set on it —
 *   is simply absent from that array and can never match this filter.
 *
 *   This is exactly the reported reproduction: creating a session from
 *   inside the case leaves it invisible in Client Portal; reopening that
 *   same session in the standalone Sessions screen and re-saving it (a
 *   path that DOES call ApiService.syncRow) makes it appear.
 *
 * This test loads the REAL cases.js + sessions.js (production <script>
 * order), a fake ApiService.syncRow that mimics "writing a row to the
 * الجلسات sheet", and applies the REAL filter expression read out of
 * Config/05_Portal.gs (not a hand-typed copy) to prove the session is
 * invisible to Portal before the fix and visible after.
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
    value: '',
    textContent: '',
    innerHTML: '',
    tagName: tagName || 'INPUT',
    options: [],
    style: { display: '' },
    classList: {
      _classes: {},
      add: function (c) { this._classes[c] = true; },
      remove: function (c) { delete this._classes[c]; },
      contains: function (c) { return !!this._classes[c]; },
      toggle: function (c, force) {
        var on = force !== undefined ? force : !this._classes[c];
        if (on) this._classes[c] = true; else delete this._classes[c];
        return on;
      }
    },
    children: [],
    querySelectorAll: function () { return []; },
    appendChild: function () {}
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

// ---- Pull the REAL Portal session-filter expression out of the REAL
//      Config/05_Portal.gs, so this test breaks if that file's matching
//      logic ever changes, instead of silently testing a stale copy. ----
function loadRealPortalSessionFilter() {
  const gas = fs.readFileSync(path.join(ROOT, 'Config', '05_Portal.gs'), 'utf8');
  const m = gas.match(
    /const sessions = allSessions\s*\n\s*\.filter\(function \(s\) \{ return (String\(s\['رقم_القضية'\] \|\| ''\)\.trim\(\) === caseNum); \}\)/
  );
  if (!m) throw new Error('Could not locate the sessions filter expression in Config/05_Portal.gs — Portal linkage logic may have changed; re-verify this test');
  return new Function('s', 'caseNum', 'return ' + m[1] + ';'); // eslint-disable-line no-new-func
}

async function main() {
  const fakeIndexedDB = new FakeIndexedDB();
  const fakeElements = {};
  const fakeSheet = { 'الجلسات': [] }; // simulates what's actually IN Google Sheets
  const syncRowCalls = [];

  const REAL_FIELDS = loadRealConfigObject('FIELDS');
  const REAL_MAP = loadRealConfigObject('MAP');
  const portalMatches = loadRealPortalSessionFilter();

  const sandboxGlobals = {
    indexedDB: fakeIndexedDB,
    data: { cases: [], clients: [], sessions: [] },
    editIdx: { cases: -1, sessions: -1 },
    FIELDS: REAL_FIELDS,
    MAP: REAL_MAP,
    document: {
      getElementById: function (id) {
        if (!fakeElements[id]) fakeElements[id] = makeFakeElement();
        return fakeElements[id];
      },
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
    sanitizeTime: function (t) { return t || ''; },
    // ---- The fake "Google Sheets": ONLY populated when ApiService.syncRow
    //      is actually called, exactly as production Sheets are only
    //      populated by the real network call this stub replaces. ----
    ApiService: {
      syncRow: function (sheetName, record, idx) {
        syncRowCalls.push({ sheetName: sheetName, record: record, idx: idx });
        if (!fakeSheet[sheetName]) fakeSheet[sheetName] = [];
        fakeSheet[sheetName].push(Object.assign({}, record));
      },
      deleteData: function () {},
      updateData: function () {}
    },
    saveLocal: function () {},
    console: console
  };
  sandboxGlobals.window = global;
  Object.keys(sandboxGlobals).forEach(function (k) { global[k] = sandboxGlobals[k]; });

  const printUtilsCode = fs.readFileSync(path.join(ROOT, 'js', 'print-utils.js'), 'utf8');
  vm.runInThisContext(printUtilsCode, { filename: path.join(ROOT, 'js', 'print-utils.js') });

  const casesModule = loadModule(path.join(modulesDir, 'cases.js'));
  global.saveCase = casesModule.saveCase;
  const sessModule = loadModule(path.join(modulesDir, 'sessions.js'));

  await casesModule.ensureCasesRepositoryReady();
  await sessModule.ensureSessionsRepositoryReady();

  // ================================================================
  // PATH A — إنشاء جلسة من داخل القضية (embedded)
  // ================================================================
  ['fCaseNum', 'fCaseTitle', 'fCaseClient', 'fCaseDocketNum', 'fCaseClients',
    'fCaseSessionDate', 'fCaseSessionTime', 'fCaseSessionTitle',
    'fCaseSessionRequired', 'fCaseSessionNotes'].forEach(function (id) {
    fakeElements[id] = makeFakeElement();
  });
  fakeElements.fCaseNum.value = 'C-2026-777';
  fakeElements.fCaseTitle.value = 'قضية اختبار المسار A';
  fakeElements.fCaseClient.value = 'محمد علي';
  fakeElements.fCaseDocketNum.value = '2026/777 مدني كلي';
  fakeElements.fCaseSessionDate.value = '2026-12-01';
  fakeElements.fCaseSessionTime.value = '11:00';
  fakeElements.fCaseSessionTitle.value = 'جلسة أولى';

  const saveOutcomeA = await global.saveCase();

  check('PATH A precondition — case + embedded session both saved locally without error', function () {
    assert.ok(saveOutcomeA && saveOutcomeA.success === true, 'case save failed: ' + JSON.stringify(saveOutcomeA));
    assert.strictEqual(sessModule.sessionsRepository.getAll().length, 1, 'expected exactly 1 session created by the embedded تبويب');
  });

  const embeddedSession = sessModule.sessionsRepository.getAll()[0];

  check('PATH A — the embedded session record itself has the correct رقم_القضية (repository layer is NOT where this bug lives)', function () {
    assert.strictEqual(embeddedSession['رقم_القضية'], 'C-2026-777');
  });

  check('PATH A — ApiService.syncRow(\'الجلسات\', ...) must be called for the embedded session, same as the standalone path always does', function () {
    const wasSynced = syncRowCalls.some(function (call) {
      return call.sheetName === 'الجلسات' && call.record && call.record['رقم_القضية'] === 'C-2026-777';
    });
    assert.ok(wasSynced, 'the embedded session was created locally but ApiService.syncRow was never called for it — it will never reach Google Sheets or Client Portal');
  });

  check('PATH A — Client Portal\'s REAL filter (Config/05_Portal.gs) finds the embedded session — proves end-to-end visibility, not just that syncRow fired', function () {
    const visibleToPortal = fakeSheet['الجلسات'].filter(function (s) { return portalMatches(s, 'C-2026-777'); });
    assert.strictEqual(visibleToPortal.length, 1, 'Portal would show 0 sessions for case C-2026-777 — reproduces "الجلسة لا تظهر داخل القضية" في Client Portal');
  });

  // ================================================================
  // PATH B — إنشاء جلسة مستقلة (control group — already known-working,
  // proves the divergence is real and isolated to the embedded path)
  // ================================================================
  fakeElements.fSessionCaseNum = makeFakeElement('SELECT');
  fakeElements.fSessionCaseNum.value = 'C-2026-777';
  fakeElements.fSessionDate = makeFakeElement();
  fakeElements.fSessionDate.value = '2026-12-05';
  fakeElements.fSessionTime = makeFakeElement();
  fakeElements.fSessionTime.value = '12:00';
  global.editIdx.sessions = -1;

  await sessModule.saveSession();

  check('PATH B (control) — the standalone Sessions screen DOES call ApiService.syncRow, confirming the two paths genuinely diverge only in the embedded creator', function () {
    const wasSynced = syncRowCalls.some(function (call) {
      return call.sheetName === 'الجلسات' && call.record && call.record['التاريخ'] === '2026-12-05';
    });
    assert.ok(wasSynced, 'expected the standalone saveSession() to call ApiService.syncRow — if this fails too, the root-cause comparison above is invalid');
  });

  console.log(log.join('\n'));
  console.log('\n' + passed + '/' + (passed + failed) + ' checks passed.');
  if (failed > 0) {
    console.log('\n' + failed + ' CHECK(S) FAILED.');
    process.exit(1);
  } else {
    console.log('\nALL CHECKS PASSED.');
    process.exit(0);
  }
}

main().catch(function (err) {
  console.error('FATAL — uncaught error in test runner:', err && err.stack ? err.stack : err);
  process.exit(1);
});
