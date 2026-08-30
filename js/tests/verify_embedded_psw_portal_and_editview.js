/**
 * verify_embedded_psw_portal_and_editview.js
 * PROBLEM 4 (Case Save Cycle audit, v79) — Regression test.
 *
 * TWO independent, proven root causes — traced Case -> embedded PSW ->
 * _createEmbeddedPswIfFilled() -> client selection -> case number ->
 * PSW repository -> local storage -> sync -> Google Sheets -> Portal
 * -> case filtering, compared against the standalone PSW screen's own
 * path at every step:
 *
 * ROOT CAUSE A (same defect family as Problem 3 — sessions.js):
 *   Standalone saveProcessServerWork() (process-server-works.js) ends
 *   with `saveLocal(); ApiService.syncRow('أعمال_المحضرين', ...)`.
 *   _createEmbeddedPswIfFilled() only calls syncProcessServerWorksMirror()
 *   (local IndexedDB mirror refresh) — no ApiService.syncRow anywhere in
 *   it. The record is created correctly, WITH the correct رقم_الموكل and
 *   رقم_القضية (verified below — the repository layer is not where this
 *   lives), but never reaches Google Sheets, so Config/05_Portal.gs's
 *   `readSheetObjects(ss, 'أعمال_المحضرين')` never sees it.
 *
 * ROOT CAUSE B (distinct — the "رقم القضية لم يكن ظاهرًا" half of the
 * report): editProcessServerWork(i) (process-server-works.js) calls, in
 * order: fillForm(...) -> syncPswClientSelectorFromRecord(record) ->
 * syncPswCaseSelectorFromRecord(record). The last of those does
 *   `sel.value = record['رقم_القضية']`
 * on the #fPswCaseNum <select> — but that <select>'s <option> list is
 * ONLY ever (re)built by populatePswCaseDropdown(clientName), and that
 * is called from selectPswClient()/removePswClient()/
 * resetPswClientSelector() only — NEVER from editProcessServerWork()'s
 * path. Opening an existing record (this covers exactly the "دخلت إلى
 * شاشة أعمال المحضرين نفسها" step in the report) sets .value to a case
 * number that has no matching <option> yet, so — exactly like a real
 * <select> — the case appears unselected/empty even though the record's
 * own رقم_القضية is correct. Manually re-picking the client (which does
 * call populatePswCaseDropdown) then re-picking the case is what made it
 * "stick" in the reported reproduction.
 *
 * NOTED BUT NOT TOUCHED — not a bug:
 *   PORTAL_PSW_DEFAULT_VISIBILITY = 'مخفي' (Config/00_Config.gs) /
 *   PSW_PORTAL_VISIBILITY_DEFAULT = 'مخفي' (js/repositories/
 *   ProcessServerWorksRepository.js) is an intentional, explicitly
 *   commented privacy-safe default ("الافتراضي الآمن لأي سجل
 *   قديم/فارغ") — every PSW record, embedded or standalone, starts
 *   Portal-hidden until a visibility level is explicitly chosen
 *   (#fPswPortalVisibility's first <option> is مخفي with no
 *   `selected` override on any other option). This is unrelated to A/B
 *   above and is left exactly as-is.
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
    disabled: false,
    classList: {
      _classes: {},
      add: function (c) { this._classes[c] = true; },
      remove: function (c) { delete this._classes[c]; },
      contains: function (c) { return !!this._classes[c]; }
    },
    children: [],
    querySelectorAll: function () { return []; },
    appendChild: function () {},
    setAttribute: function (name, val) { this['_attr_' + name] = val; },
    getAttribute: function (name) { return this['_attr_' + name] !== undefined ? this['_attr_' + name] : null; }
  };
}

// A more faithful <select> fake: setting .value to something with no
// matching <option> resets to '' (selectedIndex -1), exactly like a
// real browser <select> — this is the ONLY way Root Cause B is provable
// rather than trivially true.
function makeFakeSelectElement() {
  var el = makeFakeElement('SELECT');
  var _value = '';
  el.options = [];
  el.selectedIndex = -1;
  Object.defineProperty(el, 'value', {
    get: function () { return _value; },
    set: function (v) {
      var idx = el.options.findIndex(function (o) { return o.value === v; });
      if (idx === -1) { _value = ''; el.selectedIndex = -1; }
      else { _value = v; el.selectedIndex = idx; }
    }
  });
  Object.defineProperty(el, 'innerHTML', {
    get: function () { return el._innerHTML || ''; },
    set: function (html) {
      el._innerHTML = html;
      // populatePswCaseDropdown() resets via sel.innerHTML = '<option value="">...';
      // before appendChild-ing the real options — mirror that reset.
      var placeholderMatch = /<option value="([^"]*)">/.exec(html || '');
      el.options = placeholderMatch ? [{ value: placeholderMatch[1], selected: false }] : [];
      _value = el.options.length ? el.options[0].value : '';
      el.selectedIndex = el.options.length ? 0 : -1;
    }
  });
  el.appendChild = function (opt) { el.options.push(opt); };
  return el;
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

function loadRealPortalPswFilter() {
  const gas = fs.readFileSync(path.join(ROOT, 'Config', '05_Portal.gs'), 'utf8');
  const m = gas.match(
    /const processServerWorks = allProcessServerWorks\s*\n\s*\.filter\(function \(w\) \{\s*\n\s*const byClient = (.+?);\s*\n\s*const byCase = (.+?);\s*\n\s*const visibility = (.+?);\s*\n\s*return (.+?);\s*\n\s*\}\)/
  );
  if (!m) throw new Error('Could not locate the processServerWorks filter in Config/05_Portal.gs — Portal linkage logic may have changed; re-verify this test');
  var body = 'const byClient = ' + m[1] + '; const byCase = ' + m[2] + '; const visibility = ' + m[3] + '; return ' + m[4] + ';';
  return new Function('w', 'clientId', 'caseNum', body); // eslint-disable-line no-new-func
}

async function main() {
  const fakeIndexedDB = new FakeIndexedDB();
  const fakeElements = {};
  const fakeSheet = { 'أعمال_المحضرين': [] };
  const syncRowCalls = [];

  const REAL_FIELDS = loadRealConfigObject('FIELDS');
  const REAL_MAP = loadRealConfigObject('MAP');
  const portalPswMatches = loadRealPortalPswFilter();

  ['fCaseNum', 'fCaseTitle', 'fCaseClient', 'fCaseDocketNum', 'fCaseClients',
    'fCasePswNature', 'fCasePswNumber', 'fCasePswCourt', 'fCasePswOffice',
    'fCasePswDeliveryDate', 'fCasePswReceiptDate', 'fCasePswSessionDate', 'fCasePswNotes'
  ].forEach(function (id) { fakeElements[id] = makeFakeElement(); });
  fakeElements.fPswCaseNum = makeFakeSelectElement();
  fakeElements.fPswCaseTitle = makeFakeElement();
  fakeElements.fPswClientId = makeFakeElement();
  fakeElements.fPswClientNameHidden = makeFakeElement();
  fakeElements.pswClientSelectorChips = makeFakeElement();
  fakeElements.pswClientSelectorPanel = makeFakeElement();

  const sandboxGlobals = {
    indexedDB: fakeIndexedDB,
    data: {
      cases: [], clients: [{ 'رقم_الموكل': 'CL-9', 'الاسم': 'منى إبراهيم' }],
      processServerWorks: []
    },
    editIdx: { cases: -1, processServerWorks: -1 },
    FIELDS: REAL_FIELDS,
    MAP: REAL_MAP,
    document: {
      getElementById: function (id) {
        if (!fakeElements[id]) fakeElements[id] = makeFakeElement();
        return fakeElements[id];
      },
      createElement: function (tag) { return tag === 'select' ? makeFakeSelectElement() : makeFakeElement(tag); },
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
    CLIENTS_ID_FIELD: 'رقم_الموكل',
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
  const pswModule = loadModule(path.join(modulesDir, 'process-server-works.js'));

  await casesModule.ensureCasesRepositoryReady();
  await pswModule.processServerWorksRepository.open();

  // ================================================================
  // PATH A — إنشاء "عمل محضرين" من داخل القضية (embedded)
  // ================================================================
  fakeElements.fCaseNum.value = 'C-2026-555';
  fakeElements.fCaseTitle.value = 'قضية اختبار المحضرين';
  fakeElements.fCaseClient.value = 'منى إبراهيم';
  fakeElements.fCaseClients.value = JSON.stringify(['CL-9']); // client already linked to the case
  fakeElements.fCasePswNature.value = 'إعلان بالحضور';
  fakeElements.fCasePswNumber.value = '77';
  fakeElements.fCasePswCourt.value = 'محكمة الأسرة';

  const saveOutcomeA = await global.saveCase();

  check('PATH A precondition — case + embedded PSW both saved locally without error', function () {
    assert.ok(saveOutcomeA && saveOutcomeA.success === true, 'case save failed: ' + JSON.stringify(saveOutcomeA));
    assert.strictEqual(pswModule.processServerWorksRepository.getAll().length, 1, 'expected exactly 1 عمل محضرين created by the embedded تبويب');
  });

  const embeddedPsw = pswModule.processServerWorksRepository.getAll()[0];

  check('PATH A — the embedded record itself has correct رقم_الموكل AND رقم_القضية (repository layer is NOT where either bug lives)', function () {
    assert.strictEqual(embeddedPsw['رقم_الموكل'], 'CL-9');
    assert.strictEqual(embeddedPsw['رقم_القضية'], 'C-2026-555');
  });

  check('ROOT CAUSE A — ApiService.syncRow(\'أعمال_المحضرين\', ...) must be called for the embedded record, same as the standalone screen always does', function () {
    const wasSynced = syncRowCalls.some(function (call) {
      return call.sheetName === 'أعمال_المحضرين' && call.record && call.record['رقم_القضية'] === 'C-2026-555';
    });
    assert.ok(wasSynced, 'the embedded PSW was created locally but ApiService.syncRow was never called for it — it will never reach Google Sheets or Client Portal');
  });

  check('ROOT CAUSE A — Client Portal\'s REAL filter (Config/05_Portal.gs) finds the record once synced AND visible (visibility default is deliberately excluded from this check — see file header)', function () {
    const syncedRow = fakeSheet['أعمال_المحضرين'][0];
    assert.ok(syncedRow, 'nothing was synced — see the previous check');
    const visibleRow = Object.assign({}, syncedRow, { 'ظهور_في_بوابة_الموكل': 'بيانات_فقط' });
    const visible = portalPswMatches(visibleRow, 'CL-9', 'C-2026-555');
    assert.ok(visible, 'Portal would still not show a synced, visibility-permitted PSW row for this case/client — a THIRD issue beyond A/B would need investigating');
  });

  // ================================================================
  // ROOT CAUSE B — reopening the embedded record in the standalone
  // "أعمال المحضرين" screen
  // ================================================================
  await pswModule.ensureProcessServerWorksRepositoryReady === undefined
    ? Promise.resolve()
    : pswModule.ensureProcessServerWorksRepositoryReady();
  // Mirror the record into data.processServerWorks the way the app does
  // via syncProcessServerWorksMirror() (already exercised above) so
  // editProcessServerWork(i) can find it by index, exactly like the UI.
  const mirrorIdx = global.data.processServerWorks.findIndex(function (r) { return r['رقم_القضية'] === 'C-2026-555'; });
  assert.ok(mirrorIdx !== -1, 'setup — embedded PSW record must be present in the data.processServerWorks mirror');

  pswModule.editProcessServerWork(mirrorIdx);

  check('ROOT CAUSE B — client name IS shown when reopening the embedded record in the standalone screen (matches "وجدت اسم الموكل" in the report — this half already worked)', function () {
    assert.strictEqual(fakeElements.fPswClientNameHidden.value, 'منى إبراهيم');
  });

  check('ROOT CAUSE B — رقم القضية must ALSO be shown/selected in #fPswCaseNum when reopening the embedded record (matches "رقم القضية لم يكن ظاهرًا/مرتبطًا" in the report)', function () {
    assert.strictEqual(
      fakeElements.fPswCaseNum.value,
      'C-2026-555',
      'the case dropdown shows "' + fakeElements.fPswCaseNum.value + '" instead of the record\'s actual case — its <option> list was never (re)populated for this client before its value was set'
    );
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
