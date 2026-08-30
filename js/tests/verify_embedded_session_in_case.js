/**
 * verify_embedded_session_in_case.js
 * CASES_RELATIONSHIP_FINANCIAL — decision §4 ("جلسة (اختياري) — أضف
 * جلسة للقضية الآن أو اتركها فارغة"). Tests the new
 * _createEmbeddedSessionIfFilled() (js/modules/sessions.js) and its
 * saveCase() wrap — the first of the 4 remaining embedded sub-entity
 * tabs from docs/DELIVERY_REPORT_AR.md §3-ج to be implemented.
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

function makeFakeElement() {
  return { value: '', textContent: '', innerHTML: '', style: { display: '' } };
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

const sessionsPath = path.join(__dirname, '..', 'modules', 'sessions.js');

async function main() {
  const fakeIndexedDB = new FakeIndexedDB();
  const fakeElements = {
    fCaseNum: makeFakeElement(),
    fCaseSessionTitle: makeFakeElement(),
    fCaseSessionDate: makeFakeElement(),
    fCaseSessionTime: makeFakeElement(),
    fCaseSessionRequired: makeFakeElement(),
    fCaseSessionNotes: makeFakeElement()
  };

  const badgeCalls = { count: 0 };
  const consoleErrors = [];
  const originalConsoleError = console.error;
  console.error = function (...args) { consoleErrors.push(args); };

  let saveCaseCalls = 0;
  const sandboxGlobals = {
    indexedDB: fakeIndexedDB,
    data: { sessions: [] },
    editIdx: { sessions: -1 },
    document: { getElementById: function (id) { return fakeElements[id] || null; } },
    escapeHtml: function (s) { return String(s == null ? '' : s); },
    toast: function () {},
    updateBadges: function () { badgeCalls.count++; },
    saveCase: function () { saveCaseCalls++; return Promise.resolve({ success: true }); }
  };
  sandboxGlobals.window = global;

  Object.keys(sandboxGlobals).forEach(function (k) { global[k] = sandboxGlobals[k]; });

  const sessionsModule = loadModule(sessionsPath);
  await sessionsModule.ensureSessionsRepositoryReady();

  await checkAsync('_createEmbeddedSessionIfFilled(): does nothing (no error, no record) when تاريخ_الجلسة is left empty — decision §4 "اتركها فارغة"', async () => {
    fakeElements.fCaseNum.value = '2025/1001';
    fakeElements.fCaseSessionDate.value = '';
    const before = sessionsModule.sessionsRepository.getAll().length;

    await sessionsModule._createEmbeddedSessionIfFilled();

    assert.strictEqual(sessionsModule.sessionsRepository.getAll().length, before);
  });

  await checkAsync('_createEmbeddedSessionIfFilled(): creates a real Sessions record when تاريخ_الجلسة is filled, linked to the case رقم_القضية', async () => {
    fakeElements.fCaseNum.value = '2025/1001';
    fakeElements.fCaseSessionDate.value = '2026-03-01';
    fakeElements.fCaseSessionTime.value = '10:30';
    fakeElements.fCaseSessionTitle.value = 'جلسة أولى';
    fakeElements.fCaseSessionRequired.value = 'إعلان الخصم';
    fakeElements.fCaseSessionNotes.value = 'ملاحظة تجريبية';

    await sessionsModule._createEmbeddedSessionIfFilled();

    const rows = sessionsModule.sessionsRepository.getAll().filter(function (s) { return s['رقم_القضية'] === '2025/1001'; });
    assert.strictEqual(rows.length, 1);
    assert.strictEqual(rows[0]['التاريخ'], '2026-03-01');
    assert.strictEqual(rows[0]['الوقت'], '10:30');
    assert.strictEqual(rows[0]['عنوان_القضية'], 'جلسة أولى');
    assert.strictEqual(rows[0]['ما_تم_في_الجلسة'], 'إعلان الخصم');
    assert.strictEqual(rows[0]['الملاحظات'], 'ملاحظة تجريبية');
  });

  check('_createEmbeddedSessionIfFilled(): clears the tab fields after a successful creation (prevents an immediate re-save from duplicating the session)', () => {
    assert.strictEqual(fakeElements.fCaseSessionDate.value, '');
    assert.strictEqual(fakeElements.fCaseSessionTitle.value, '');
    assert.strictEqual(fakeElements.fCaseSessionTime.value, '');
  });

  await checkAsync('_createEmbeddedSessionIfFilled(): defaults الوقت to 00:00 when the time field is left empty (still passes SessionsRepository\'s required-field validation, decision §3-J)', async () => {
    fakeElements.fCaseNum.value = '2025/2002';
    fakeElements.fCaseSessionDate.value = '2026-04-01';
    fakeElements.fCaseSessionTime.value = '';

    await sessionsModule._createEmbeddedSessionIfFilled();

    const rows = sessionsModule.sessionsRepository.getAll().filter(function (s) { return s['رقم_القضية'] === '2025/2002'; });
    assert.strictEqual(rows.length, 1);
    assert.strictEqual(rows[0]['الوقت'], '00:00');
  });

  await checkAsync('saveCase() wrap: still calls the original saveCase() and returns its outcome, even when no session tab data is present', async () => {
    fakeElements.fCaseSessionDate.value = '';
    saveCaseCalls = 0;

    const outcome = await global.saveCase();

    assert.strictEqual(saveCaseCalls, 1);
    assert.strictEqual(outcome.success, true, 'the original saveCase() outcome must be passed through unchanged');
  });

  await checkAsync('saveCase() wrap: creates the embedded session AFTER the original saveCase() resolves, when the tab is filled', async () => {
    fakeElements.fCaseNum.value = '2025/3003';
    fakeElements.fCaseSessionDate.value = '2026-05-01';
    fakeElements.fCaseSessionTime.value = '12:00';

    await global.saveCase();

    const rows = sessionsModule.sessionsRepository.getAll().filter(function (s) { return s['رقم_القضية'] === '2025/3003'; });
    assert.strictEqual(rows.length, 1);
  });

  await checkAsync('_createEmbeddedSessionIfFilled(): resolves quietly with no رقم_القضية present (defensive branch — saveCase() itself already guarantees this in practice)', async () => {
    fakeElements.fCaseNum.value = '';
    fakeElements.fCaseSessionDate.value = '2026-06-01';

    await assert.doesNotReject(sessionsModule._createEmbeddedSessionIfFilled());
  });

  console.error = originalConsoleError;

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

main().catch((e) => { console.error(e); process.exit(1); });
