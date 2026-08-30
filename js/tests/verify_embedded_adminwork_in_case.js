/**
 * verify_embedded_adminwork_in_case.js
 * CASES_RELATIONSHIP_FINANCIAL — decision §4 ("عمل اداري (اختياري) —
 * يُربط تلقائيًا بأول موكل فى القضية"). Tests the new
 * _createEmbeddedAdminWorkIfFilled() (js/modules/tasks.js) and its
 * saveCase() wrap.
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

const tasksPath = path.join(__dirname, '..', 'modules', 'tasks.js');

async function main() {
  const fakeIndexedDB = new FakeIndexedDB();
  const fakeElements = {
    fCaseNum: makeFakeElement(),
    fCaseClients: makeFakeElement(),
    fCaseTaskTitle: makeFakeElement(),
    fCaseTaskDeadline: makeFakeElement(),
    fCaseTaskLocation: makeFakeElement(),
    fCaseTaskRequired: makeFakeElement(),
    fCaseTaskNotes: makeFakeElement()
  };

  let saveCaseCalls = 0;
  const sandboxGlobals = {
    indexedDB: fakeIndexedDB,
    data: {
      tasks: [],
      clients: [{ 'رقم_الموكل': 'CL1', 'الاسم': 'أحمد محمود' }, { 'رقم_الموكل': 'CL2', 'الاسم': 'سارة عبد الله' }]
    },
    editIdx: { tasks: -1 },
    document: { getElementById: function (id) { return fakeElements[id] || null; } },
    escapeHtml: function (s) { return String(s == null ? '' : s); },
    toast: function () {},
    updateBadges: function () {},
    saveCase: function () { saveCaseCalls++; return Promise.resolve({ success: true }); }
  };
  sandboxGlobals.window = global;

  Object.keys(sandboxGlobals).forEach(function (k) { global[k] = sandboxGlobals[k]; });

  const tasksModule = loadModule(tasksPath);
  await tasksModule.ensureTasksRepositoryReady();

  await checkAsync('_createEmbeddedAdminWorkIfFilled(): does nothing when العنوان is left empty — decision §4 "اتركها فارغة"', async () => {
    fakeElements.fCaseNum.value = '2025/1001';
    fakeElements.fCaseTaskTitle.value = '';
    const before = tasksModule.tasksRepository.getAll().length;

    await tasksModule._createEmbeddedAdminWorkIfFilled();

    assert.strictEqual(tasksModule.tasksRepository.getAll().length, before);
  });

  await checkAsync('_createEmbeddedAdminWorkIfFilled(): creates a real Tasks record linked to the case AND its first selected client — decision §4 "يُربط تلقائيًا بأول موكل"', async () => {
    fakeElements.fCaseNum.value = '2025/1001';
    fakeElements.fCaseClients.value = JSON.stringify(['CL1', 'CL2']);
    fakeElements.fCaseTaskTitle.value = 'استخراج توكيل';
    fakeElements.fCaseTaskDeadline.value = '2026-03-15';
    fakeElements.fCaseTaskLocation.value = 'الشهر العقاري';
    fakeElements.fCaseTaskRequired.value = 'إحضار البطاقة الشخصية';
    fakeElements.fCaseTaskNotes.value = 'عاجل';

    await tasksModule._createEmbeddedAdminWorkIfFilled();

    const rows = tasksModule.tasksRepository.getAll().filter(function (t) { return t['رقم_القضية'] === '2025/1001'; });
    assert.strictEqual(rows.length, 1);
    assert.strictEqual(rows[0]['العنوان'], 'استخراج توكيل');
    assert.strictEqual(rows[0]['رقم_الموكل'], 'CL1', 'must use the FIRST selected client, not the second');
    assert.strictEqual(rows[0]['اسم_الموكل'], 'أحمد محمود');
    assert.strictEqual(rows[0]['الموعد_النهائي'], '2026-03-15');
    assert.strictEqual(rows[0]['مكان_التنفيذ'], 'الشهر العقاري');
    assert.strictEqual(rows[0]['المطلوب'], 'إحضار البطاقة الشخصية');
    assert.strictEqual(rows[0]['الملاحظات'], 'عاجل');
  });

  check('_createEmbeddedAdminWorkIfFilled(): clears the tab fields after a successful creation', () => {
    assert.strictEqual(fakeElements.fCaseTaskTitle.value, '');
    assert.strictEqual(fakeElements.fCaseTaskDeadline.value, '');
  });

  await checkAsync('_createEmbeddedAdminWorkIfFilled(): still creates the task (with no client link) when #fCaseClients is empty — decision §3-H allows tasks with no client link either', async () => {
    fakeElements.fCaseNum.value = '2025/2002';
    fakeElements.fCaseClients.value = '';
    fakeElements.fCaseTaskTitle.value = 'مهمة بلا موكل محدد';

    await tasksModule._createEmbeddedAdminWorkIfFilled();

    const rows = tasksModule.tasksRepository.getAll().filter(function (t) { return t['رقم_القضية'] === '2025/2002'; });
    assert.strictEqual(rows.length, 1);
    assert.strictEqual(rows[0]['رقم_الموكل'], '');
  });

  await checkAsync('_createEmbeddedAdminWorkIfFilled(): malformed JSON in #fCaseClients is handled gracefully (non-fatal), task still created', async () => {
    fakeElements.fCaseNum.value = '2025/3003';
    fakeElements.fCaseClients.value = 'not valid json {{{';
    fakeElements.fCaseTaskTitle.value = 'مهمة أخرى';

    await assert.doesNotReject(tasksModule._createEmbeddedAdminWorkIfFilled());

    const rows = tasksModule.tasksRepository.getAll().filter(function (t) { return t['رقم_القضية'] === '2025/3003'; });
    assert.strictEqual(rows.length, 1);
  });

  await checkAsync('saveCase() wrap: still calls the original saveCase() and passes through its outcome when the tab is empty', async () => {
    fakeElements.fCaseTaskTitle.value = '';
    saveCaseCalls = 0;

    const outcome = await global.saveCase();

    assert.strictEqual(saveCaseCalls, 1);
    assert.strictEqual(outcome.success, true);
  });

  await checkAsync('saveCase() wrap: creates the embedded admin-work task AFTER the original saveCase() resolves, when the tab is filled', async () => {
    fakeElements.fCaseNum.value = '2025/4004';
    fakeElements.fCaseClients.value = JSON.stringify(['CL2']);
    fakeElements.fCaseTaskTitle.value = 'عمل من نموذج القضية';

    await global.saveCase();

    const rows = tasksModule.tasksRepository.getAll().filter(function (t) { return t['رقم_القضية'] === '2025/4004'; });
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
