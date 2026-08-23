/**
 * verify_embedded_document_in_case.js
 * CASES_RELATIONSHIP_FINANCIAL — decision §4 ("المستندات (اختياري) —
 * إضافة/رفع المستندات مع الربط الصحيح"). Tests the new
 * _createEmbeddedDocumentIfFilled() (js/modules/documents.js) and its
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
  return { value: '', textContent: '', innerHTML: '', style: { display: '' }, selectedIndex: 0 };
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

const documentsPath = path.join(__dirname, '..', 'modules', 'documents.js');

async function main() {
  const fakeIndexedDB = new FakeIndexedDB();
  const fakeElements = {
    fCaseNum: makeFakeElement(),
    fCaseClients: makeFakeElement(),
    fCaseDocName: makeFakeElement(),
    fCaseDocType: makeFakeElement(),
    fCaseDocDriveUrl: makeFakeElement(),
    fCaseDocNotes: makeFakeElement()
  };

  let saveCaseCalls = 0;
  const sandboxGlobals = {
    indexedDB: fakeIndexedDB,
    data: {
      documents: [],
      clients: [{ 'رقم_الموكل': 'CL1', 'الاسم': 'أحمد محمود' }, { 'رقم_الموكل': 'CL2', 'الاسم': 'سارة عبد الله' }]
    },
    editIdx: { documents: -1 },
    document: { getElementById: function (id) { return fakeElements[id] || null; } },
    escapeHtml: function (s) { return String(s == null ? '' : s); },
    toast: function () {},
    updateBadges: function () {},
    saveCase: function () { saveCaseCalls++; return Promise.resolve({ success: true }); }
  };
  sandboxGlobals.window = global;

  Object.keys(sandboxGlobals).forEach(function (k) { global[k] = sandboxGlobals[k]; });

  const documentsModule = loadModule(documentsPath);
  await documentsModule.ensureDocumentsRepositoryReady();

  await checkAsync('_createEmbeddedDocumentIfFilled(): does nothing when اسم_المستند is left empty — decision §4 "اتركها فارغة"', async () => {
    fakeElements.fCaseNum.value = '2025/1001';
    fakeElements.fCaseDocName.value = '';
    const before = documentsModule.documentsRepository.getAll().length;

    await documentsModule._createEmbeddedDocumentIfFilled();

    assert.strictEqual(documentsModule.documentsRepository.getAll().length, before);
  });

  await checkAsync('_createEmbeddedDocumentIfFilled(): creates a real Documents record linked to the case AND its first selected client — decision §4', async () => {
    fakeElements.fCaseNum.value = '2025/1001';
    fakeElements.fCaseClients.value = JSON.stringify(['CL1', 'CL2']);
    fakeElements.fCaseDocName.value = 'صورة البطاقة';
    fakeElements.fCaseDocType.value = 'مستند آخر';
    fakeElements.fCaseDocDriveUrl.value = 'https://drive.google.com/file/d/xyz';
    fakeElements.fCaseDocNotes.value = 'أُرفقت مع القضية';

    await documentsModule._createEmbeddedDocumentIfFilled();

    const rows = documentsModule.documentsRepository.getAll().filter(function (d) { return d['رقم_القضية'] === '2025/1001'; });
    assert.strictEqual(rows.length, 1);
    assert.strictEqual(rows[0]['اسم_المستند'], 'صورة البطاقة');
    assert.strictEqual(rows[0]['رقم_الموكل'], 'CL1', 'must use the FIRST selected client, not the second');
    assert.strictEqual(rows[0]['نوع_المستند'], 'مستند آخر');
    assert.strictEqual(rows[0]['رابط_Drive'], 'https://drive.google.com/file/d/xyz');
    assert.strictEqual(rows[0]['الملاحظات'], 'أُرفقت مع القضية');
  });

  check('_createEmbeddedDocumentIfFilled(): clears the tab fields after a successful creation', () => {
    assert.strictEqual(fakeElements.fCaseDocName.value, '');
    assert.strictEqual(fakeElements.fCaseDocDriveUrl.value, '');
  });

  await checkAsync('_createEmbeddedDocumentIfFilled(): still creates the document (with no client link) when #fCaseClients is empty — رقم_القضية alone satisfies DocumentsRepository\'s "قضية OR موكل" validation (decision §3-L)', async () => {
    fakeElements.fCaseNum.value = '2025/2002';
    fakeElements.fCaseClients.value = '';
    fakeElements.fCaseDocName.value = 'مستند بلا موكل محدد';

    await documentsModule._createEmbeddedDocumentIfFilled();

    const rows = documentsModule.documentsRepository.getAll().filter(function (d) { return d['رقم_القضية'] === '2025/2002'; });
    assert.strictEqual(rows.length, 1);
    assert.strictEqual(rows[0]['رقم_الموكل'], '');
  });

  await checkAsync('_createEmbeddedDocumentIfFilled(): malformed JSON in #fCaseClients is handled gracefully (non-fatal), document still created', async () => {
    fakeElements.fCaseNum.value = '2025/3003';
    fakeElements.fCaseClients.value = 'not valid json {{{';
    fakeElements.fCaseDocName.value = 'مستند آخر';

    await assert.doesNotReject(documentsModule._createEmbeddedDocumentIfFilled());

    const rows = documentsModule.documentsRepository.getAll().filter(function (d) { return d['رقم_القضية'] === '2025/3003'; });
    assert.strictEqual(rows.length, 1);
  });

  await checkAsync('saveCase() wrap: still calls the original saveCase() and passes through its outcome when the tab is empty', async () => {
    fakeElements.fCaseDocName.value = '';
    saveCaseCalls = 0;

    const outcome = await global.saveCase();

    assert.strictEqual(saveCaseCalls, 1);
    assert.strictEqual(outcome.success, true);
  });

  await checkAsync('saveCase() wrap: creates the embedded document AFTER the original saveCase() resolves, when the tab is filled', async () => {
    fakeElements.fCaseNum.value = '2025/4004';
    fakeElements.fCaseClients.value = JSON.stringify(['CL2']);
    fakeElements.fCaseDocName.value = 'مستند من نموذج القضية';

    await global.saveCase();

    const rows = documentsModule.documentsRepository.getAll().filter(function (d) { return d['رقم_القضية'] === '2025/4004'; });
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
