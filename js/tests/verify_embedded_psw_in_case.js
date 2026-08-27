/**
 * verify_embedded_psw_in_case.js
 * CASES_RELATIONSHIP_FINANCIAL — decision §4 ("محضرين (اختياري) —
 * نفس الأسلوب" [كعمل اداري]، يُربط تلقائيًا بأول موكل فى القضية).
 * Tests the new _createEmbeddedPswIfFilled() (js/modules/process-
 * server-works.js) and its saveCase() wrap.
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

const pswPath = path.join(__dirname, '..', 'modules', 'process-server-works.js');

async function main() {
  const fakeIndexedDB = new FakeIndexedDB();
  const fakeElements = {
    fCaseNum: makeFakeElement(),
    fCaseClients: makeFakeElement(),
    fCasePswNature: makeFakeElement(),
    fCasePswNumber: makeFakeElement(),
    fCasePswCourt: makeFakeElement(),
    fCasePswOffice: makeFakeElement(),
    fCasePswDeliveryDate: makeFakeElement(),
    fCasePswReceiptDate: makeFakeElement(),
    fCasePswSessionDate: makeFakeElement(),
    fCasePswNotes: makeFakeElement()
  };

  let saveCaseCalls = 0;
  const toastLog = [];
  const sandboxGlobals = {
    indexedDB: fakeIndexedDB,
    data: {
      processServerWorks: [],
      clients: [{ 'رقم_الموكل': 'CL1', 'الاسم': 'أحمد محمود' }, { 'رقم_الموكل': 'CL2', 'الاسم': 'سارة عبد الله' }]
    },
    editIdx: { processServerWorks: -1 },
    document: { getElementById: function (id) { return fakeElements[id] || null; } },
    escapeHtml: function (s) { return String(s == null ? '' : s); },
    // CASE_SAVE_CYCLE_FIX_2026 — B4: was a no-op stub; now records calls
    // so the no-client-skip test below can assert the fix (an explicit
    // toast instead of a silent console.error) actually fires.
    toast: function (msg, type) { toastLog.push({ msg: msg, type: type }); },
    updateBadges: function () {},
    saveCase: function () { saveCaseCalls++; return Promise.resolve({ success: true }); }
  };
  sandboxGlobals.window = global;

  Object.keys(sandboxGlobals).forEach(function (k) { global[k] = sandboxGlobals[k]; });

  const pswModule = loadModule(pswPath);
  await pswModule.processServerWorksRepository.open();

  await checkAsync('_createEmbeddedPswIfFilled(): does nothing when both طبيعة_الإعلان and رقم_المحضرين are left empty — decision §4 "اتركها فارغة"', async () => {
    fakeElements.fCaseNum.value = '2025/1001';
    fakeElements.fCaseClients.value = JSON.stringify(['CL1']);
    fakeElements.fCasePswNature.value = '';
    fakeElements.fCasePswNumber.value = '';
    const before = pswModule.processServerWorksRepository.getAll().length;

    await pswModule._createEmbeddedPswIfFilled();

    assert.strictEqual(pswModule.processServerWorksRepository.getAll().length, before);
  });

  await checkAsync('_createEmbeddedPswIfFilled(): creates a real PSW record linked to the case AND its first selected client — decision §4', async () => {
    fakeElements.fCaseNum.value = '2025/1001';
    fakeElements.fCaseClients.value = JSON.stringify(['CL1', 'CL2']);
    fakeElements.fCasePswNature.value = 'إعادة إعلان';
    fakeElements.fCasePswNumber.value = 'PSW-100';
    fakeElements.fCasePswCourt.value = 'محكمة الإسكندرية الجزئية';
    fakeElements.fCasePswOffice.value = 'قلم محضرين الجيزة';
    fakeElements.fCasePswDeliveryDate.value = '2026-02-01';
    fakeElements.fCasePswReceiptDate.value = '2026-02-05';
    fakeElements.fCasePswSessionDate.value = '2026-03-01';
    fakeElements.fCasePswNotes.value = 'ملاحظة';

    await pswModule._createEmbeddedPswIfFilled();

    const rows = pswModule.processServerWorksRepository.getAll().filter(function (w) { return w['رقم_القضية'] === '2025/1001'; });
    assert.strictEqual(rows.length, 1);
    assert.strictEqual(rows[0]['رقم_الموكل'], 'CL1', 'must use the FIRST selected client, not the second');
    assert.strictEqual(rows[0]['اسم_الموكل'], 'أحمد محمود');
    assert.strictEqual(rows[0]['طبيعة_الاعلان'], 'إعادة إعلان');
    assert.strictEqual(rows[0]['رقم_المحضرين'], 'PSW-100');
    assert.strictEqual(rows[0]['المحكمة'], 'محكمة الإسكندرية الجزئية');
    assert.strictEqual(rows[0]['قلم_المحضرين'], 'قلم محضرين الجيزة');
    assert.strictEqual(rows[0]['تاريخ_التسليم'], '2026-02-01');
    assert.strictEqual(rows[0]['تاريخ_الاستلام'], '2026-02-05');
    assert.strictEqual(rows[0]['تاريخ_الجلسة'], '2026-03-01');
    assert.strictEqual(rows[0]['الملاحظات'], 'ملاحظة');
  });

  check('_createEmbeddedPswIfFilled(): clears the tab fields after a successful creation', () => {
    assert.strictEqual(fakeElements.fCasePswNature.value, '');
    assert.strictEqual(fakeElements.fCasePswNumber.value, '');
  });

  await checkAsync('_createEmbeddedPswIfFilled(): only رقم_المحضرين filled (طبيعة_الإعلان empty) still triggers creation — either field is a valid intent signal', async () => {
    fakeElements.fCaseNum.value = '2025/2002';
    fakeElements.fCaseClients.value = JSON.stringify(['CL1']);
    fakeElements.fCasePswNature.value = '';
    fakeElements.fCasePswNumber.value = 'PSW-200';

    await pswModule._createEmbeddedPswIfFilled();

    const rows = pswModule.processServerWorksRepository.getAll().filter(function (w) { return w['رقم_القضية'] === '2025/2002'; });
    assert.strictEqual(rows.length, 1);
  });

  await checkAsync('_createEmbeddedPswIfFilled(): SKIPS creation (no error) when no client is selected at all — PSW_REQUIRED_FIELDS=[رقم_الموكل] cannot be satisfied, documented tradeoff for this optional tab', async () => {
    fakeElements.fCaseNum.value = '2025/3003';
    fakeElements.fCaseClients.value = ''; // no client selected
    fakeElements.fCasePswNature.value = 'محاولة بلا موكل';
    toastLog.length = 0;

    await assert.doesNotReject(pswModule._createEmbeddedPswIfFilled());

    const rows = pswModule.processServerWorksRepository.getAll().filter(function (w) { return w['رقم_القضية'] === '2025/3003'; });
    assert.strictEqual(rows.length, 0, 'must NOT create an invalid record missing the required رقم_الموكل');
  });

  check('B4: the skip above is NO LONGER silent — an error-type toast was shown explaining why the tab was not saved', () => {
    assert.strictEqual(toastLog.length, 1, 'expected exactly one toast; got ' + JSON.stringify(toastLog));
    assert.strictEqual(toastLog[0].type, 'error');
    assert.ok(toastLog[0].msg && toastLog[0].msg.indexOf('موكل') !== -1, 'toast message should mention the missing client, got: ' + toastLog[0].msg);
  });

  await checkAsync('_createEmbeddedPswIfFilled(): malformed JSON in #fCaseClients is handled gracefully (falls through to the no-client-selected skip path)', async () => {
    fakeElements.fCaseNum.value = '2025/4004';
    fakeElements.fCaseClients.value = 'not valid json {{{';
    fakeElements.fCasePswNature.value = 'محاولة أخرى';
    toastLog.length = 0;

    await assert.doesNotReject(pswModule._createEmbeddedPswIfFilled());
  });

  check('B4: the malformed-JSON skip above ALSO produced the explicit error toast (same code path as the no-client-selected skip)', () => {
    assert.strictEqual(toastLog.length, 1, 'expected exactly one toast; got ' + JSON.stringify(toastLog));
    assert.strictEqual(toastLog[0].type, 'error');
  });

  await checkAsync('saveCase() wrap: still calls the original saveCase() and passes through its outcome when the tab is empty', async () => {
    fakeElements.fCasePswNature.value = '';
    fakeElements.fCasePswNumber.value = '';
    saveCaseCalls = 0;

    const outcome = await global.saveCase();

    assert.strictEqual(saveCaseCalls, 1);
    assert.strictEqual(outcome.success, true);
  });

  await checkAsync('saveCase() wrap: creates the embedded PSW record AFTER the original saveCase() resolves, when the tab is filled', async () => {
    fakeElements.fCaseNum.value = '2025/5005';
    fakeElements.fCaseClients.value = JSON.stringify(['CL2']);
    fakeElements.fCasePswNature.value = 'إعلان من نموذج القضية';

    await global.saveCase();

    const rows = pswModule.processServerWorksRepository.getAll().filter(function (w) { return w['رقم_القضية'] === '2025/5005'; });
    assert.strictEqual(rows.length, 1);
    assert.strictEqual(rows[0]['رقم_الموكل'], 'CL2');
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
