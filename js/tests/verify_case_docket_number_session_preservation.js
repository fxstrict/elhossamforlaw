/**
 * verify_case_docket_number_session_preservation.js
 * ================================================================
 * CASE_SAVE_CYCLE_FIX_2026 — B1 dedicated coverage. Sibling to
 * verify_embedded_session_in_case.js (same exact harness pattern,
 * reused verbatim), focused specifically on the newly-added رقم_الدعوى
 * field: js/repositories/SessionsRepository.js/js/modules/sessions.js
 * now carry it, sourced from the case form's #fCaseDocketNum at the
 * moment an embedded session is created — this file is the dedicated,
 * narrow proof of that one behavior (the broader end-to-end proof,
 * across the full production wrapper chain, lives in
 * verify_case_save_cycle_full_integration.js).
 * ================================================================
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
    fCaseDocketNum: makeFakeElement(),
    fCaseSessionTitle: makeFakeElement(),
    fCaseSessionDate: makeFakeElement(),
    fCaseSessionTime: makeFakeElement(),
    fCaseSessionRequired: makeFakeElement(),
    fCaseSessionNotes: makeFakeElement()
  };

  const sandboxGlobals = {
    indexedDB: fakeIndexedDB,
    data: { sessions: [] },
    editIdx: { sessions: -1 },
    document: { getElementById: function (id) { return fakeElements[id] || null; } },
    escapeHtml: function (s) { return String(s == null ? '' : s); },
    toast: function () {},
    updateBadges: function () {},
    saveCase: function () { return Promise.resolve({ success: true }); }
  };
  sandboxGlobals.window = global;
  Object.keys(sandboxGlobals).forEach(function (k) { global[k] = sandboxGlobals[k]; });

  const sessionsModule = loadModule(sessionsPath);
  await sessionsModule.ensureSessionsRepositoryReady();

  await checkAsync('SessionsRepository.js/sessions.js: the header list actually includes رقم_الدعوى (schema check via a real create() round-trip)', async () => {
    fakeElements.fCaseNum.value = '2026/5001';
    fakeElements.fCaseDocketNum.value = '2026/9999 مدني كلي';
    fakeElements.fCaseSessionDate.value = '2026-09-10';

    await sessionsModule._createEmbeddedSessionIfFilled();

    const row = sessionsModule.sessionsRepository.getAll().filter(function (s) { return s['رقم_القضية'] === '2026/5001'; })[0];
    assert.ok(row, 'expected a session record to have been created');
    assert.strictEqual(row['رقم_الدعوى'], '2026/9999 مدني كلي');
  });

  await checkAsync('B1: رقم_الدعوى is read from #fCaseDocketNum at embedded-creation time, independently of رقم_القضية (proves it is not accidentally aliased to the case number itself)', async () => {
    fakeElements.fCaseNum.value = '2026/5002';
    fakeElements.fCaseDocketNum.value = '2026/7777 أحوال شخصية';
    fakeElements.fCaseSessionDate.value = '2026-09-11';

    await sessionsModule._createEmbeddedSessionIfFilled();

    const row = sessionsModule.sessionsRepository.getAll().filter(function (s) { return s['رقم_القضية'] === '2026/5002'; })[0];
    assert.ok(row);
    assert.notStrictEqual(row['رقم_الدعوى'], row['رقم_القضية']);
    assert.strictEqual(row['رقم_الدعوى'], '2026/7777 أحوال شخصية');
  });

  await checkAsync('B1: رقم_الدعوى is trimmed of surrounding whitespace, matching every other field on this same form', async () => {
    fakeElements.fCaseNum.value = '2026/5003';
    fakeElements.fCaseDocketNum.value = '   2026/1111   ';
    fakeElements.fCaseSessionDate.value = '2026-09-12';

    await sessionsModule._createEmbeddedSessionIfFilled();

    const row = sessionsModule.sessionsRepository.getAll().filter(function (s) { return s['رقم_القضية'] === '2026/5003'; })[0];
    assert.ok(row);
    assert.strictEqual(row['رقم_الدعوى'], '2026/1111');
  });

  await checkAsync('B1: an EMPTY #fCaseDocketNum (case has no رقم الدعوى yet) saves an empty string on the session — no crash, no "undefined" leaking into the record (backward-compatible with a case that never had one)', async () => {
    fakeElements.fCaseNum.value = '2026/5004';
    fakeElements.fCaseDocketNum.value = '';
    fakeElements.fCaseSessionDate.value = '2026-09-13';

    await sessionsModule._createEmbeddedSessionIfFilled();

    const row = sessionsModule.sessionsRepository.getAll().filter(function (s) { return s['رقم_القضية'] === '2026/5004'; })[0];
    assert.ok(row);
    assert.strictEqual(row['رقم_الدعوى'], '');
  });

  await checkAsync('B1: a MISSING #fCaseDocketNum element entirely (defensive branch — old cached page markup, or a caller that never rendered that field) does not throw and saves an empty string', async () => {
    const savedEl = fakeElements.fCaseDocketNum;
    delete fakeElements.fCaseDocketNum; // getElementById now returns null for this id

    fakeElements.fCaseNum.value = '2026/5005';
    fakeElements.fCaseSessionDate.value = '2026-09-14';

    await assert.doesNotReject(sessionsModule._createEmbeddedSessionIfFilled());

    const row = sessionsModule.sessionsRepository.getAll().filter(function (s) { return s['رقم_القضية'] === '2026/5005'; })[0];
    assert.ok(row);
    assert.strictEqual(row['رقم_الدعوى'], '');

    fakeElements.fCaseDocketNum = savedEl; // restore for any later checks
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

main().catch((e) => { console.error(e); process.exit(1); });
