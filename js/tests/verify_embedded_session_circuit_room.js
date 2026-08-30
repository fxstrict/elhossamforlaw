/**
 * verify_embedded_session_circuit_room.js
 * PROBLEM 5 (Case Save Cycle audit, v79) — Regression test.
 *
 * ROOT CAUSE (proved by code trace, not guessed):
 *   Compared PATH A (Embedded Session Creation) against PATH B
 *   (Standalone Session, Case Selection) for where رقم_الدائرة/رقم_القاعة
 *   originate.
 *
 *   PATH B: selecting a case in the standalone Sessions screen fires
 *   autofillSessionFromCase(caseNum) (cases.js), which does
 *       var c = data.cases.find(x => x['رقم_القضية'] === caseNum);
 *       circuitEl.value = c['رقم_الدائرة'];
 *       roomEl.value    = c['رقم_القاعة'];
 *   directly onto the standalone form's #fSessionCircuit/#fSessionRoom
 *   — SESSIONS_MAP then carries those into the saved record unchanged.
 *
 *   PATH A: the embedded "جلسة" tab inside the Add Case modal has NO
 *   circuit/room fields at all (only Date/Time/Title/المطلوب/Notes —
 *   verified against index.html's actual markup for that tab), and
 *   BEFORE this fix, _createEmbeddedSessionIfFilled() (sessions.js)
 *   built its record from exactly 7 keys — رقم_القضية, رقم_الدعوى,
 *   التاريخ, الوقت, عنوان_القضية, ما_تم_في_الجلسة, الملاحظات — never
 *   رقم_الدائرة or رقم_القاعة. No code path anywhere copied them onto
 *   an embedded-created session; they were structurally always absent,
 *   not merely lost in transit.
 *
 * This test loads the REAL cases.js + sessions.js and proves the
 * embedded session record is missing رقم_الدائرة/رقم_القاعة before the
 * fix, and carries the case's own values (read directly from
 * #fCaseCircuit/#fCaseRoom — the exact fields the user just filled in
 * on the case form, same "read the case form's own field" pattern this
 * function already used for رقم_الدعوى) after it.
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
      contains: function (c) { return !!this._classes[c]; }
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

async function main() {
  const fakeIndexedDB = new FakeIndexedDB();
  const fakeElements = {};

  ['fCaseNum', 'fCaseTitle', 'fCaseClient', 'fCaseDocketNum', 'fCaseCircuit', 'fCaseRoom',
    'fCaseSessionDate', 'fCaseSessionTime', 'fCaseSessionTitle', 'fCaseSessionRequired', 'fCaseSessionNotes'
  ].forEach(function (id) { fakeElements[id] = makeFakeElement(); });

  const REAL_FIELDS = loadRealConfigObject('FIELDS');
  const REAL_MAP = loadRealConfigObject('MAP');

  const sandboxGlobals = {
    indexedDB: fakeIndexedDB,
    data: { cases: [], clients: [], sessions: [] },
    editIdx: { cases: -1 },
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
    ApiService: { syncRow: function () {}, deleteData: function () {}, updateData: function () {} },
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
  // إنشاء قضية بها رقم دائرة/قاعة، مع جلسة مضمّنة فى نفس الحفظة
  // ================================================================
  fakeElements.fCaseNum.value = 'C-2026-321';
  fakeElements.fCaseTitle.value = 'قضية اختبار الدائرة والقاعة';
  fakeElements.fCaseClient.value = 'كريم فتحي';
  fakeElements.fCaseDocketNum.value = '2026/321 مدني كلي';
  fakeElements.fCaseCircuit.value = '7';
  fakeElements.fCaseRoom.value = '4';
  fakeElements.fCaseSessionDate.value = '2026-12-15';
  fakeElements.fCaseSessionTime.value = '09:30';

  const saveOutcome = await global.saveCase();

  check('setup — case + embedded session both saved without error', function () {
    assert.ok(saveOutcome && saveOutcome.success === true, 'save failed: ' + JSON.stringify(saveOutcome));
    assert.strictEqual(sessModule.sessionsRepository.getAll().length, 1);
  });

  const embeddedSession = sessModule.sessionsRepository.getAll()[0];

  check('the embedded session carries رقم_الدائرة from the case form (#fCaseCircuit)', function () {
    assert.strictEqual(embeddedSession['رقم_الدائرة'], '7', 'expected رقم_الدائرة to be "7", got "' + embeddedSession['رقم_الدائرة'] + '"');
  });

  check('the embedded session carries رقم_القاعة from the case form (#fCaseRoom)', function () {
    assert.strictEqual(embeddedSession['رقم_القاعة'], '4', 'expected رقم_القاعة to be "4", got "' + embeddedSession['رقم_القاعة'] + '"');
  });

  check('unrelated session fields are unaffected by this fix (رقم_الدعوى still comes from #fCaseDocketNum, unchanged)', function () {
    assert.strictEqual(embeddedSession['رقم_الدعوى'], '2026/321 مدني كلي');
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
