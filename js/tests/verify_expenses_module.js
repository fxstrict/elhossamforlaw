/**
 * verify_expenses_module.js
 * CASES_RELATIONSHIP_FINANCIAL — closes the gap flagged in
 * docs/DELIVERY_REPORT_AR.md §3-أ: js/modules/expenses.js (the CRUD/UI
 * layer built on top of the already-tested ExpensesRepository) had no
 * test coverage at all. This tests it against the real Repository
 * engine (FakeIndexedDB), reusing financial-reports.js's
 * expensesRepository instance exactly as expenses.js itself does in
 * production (not a duplicate instance — see expenses.js's own file
 * header for why that matters).
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
    },
    querySelectorAll: function () { return []; }
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

const financialReportsPath = path.join(__dirname, '..', 'modules', 'financial-reports.js');
const expensesPath = path.join(__dirname, '..', 'modules', 'expenses.js');

async function main() {
  const fakeIndexedDB = new FakeIndexedDB();
  const fakeElements = {
    fExpenseScope: makeFakeElement(),
    fExpenseClientId: makeFakeElement(),
    fExpenseCaseNum: makeFakeElement(),
    fExpenseAmount: makeFakeElement(),
    fExpenseCategory: makeFakeElement(),
    fExpenseSource: makeFakeElement(),
    fExpenseDate: makeFakeElement(),
    fExpenseStatus: makeFakeElement(),
    fExpenseNotes: makeFakeElement(),
    modalExpenseTitle: makeFakeElement(),
    modalExpense: makeFakeElement(),
    expensesTableBody: makeFakeElement(),
    expensesEmpty: makeFakeElement(),
    expensesMobileList: makeFakeElement(),
    expensesTotalNum: makeFakeElement(),
    expensesCountNum: makeFakeElement(),
    searchExpenses: makeFakeElement()
  };

  const toastLog = [];
  const apiCalls = [];
  const savedLocalCalls = { count: 0 };
  const badgeCalls = { count: 0 };
  const closeModalLog = [];
  let confirmDialogAnswer = true;

  function collectForm(type) {
    if (type !== 'expenses') return {};
    return {
      'النطاق': fakeElements.fExpenseScope.value,
      'رقم_الموكل': fakeElements.fExpenseClientId.value,
      'رقم_القضية': fakeElements.fExpenseCaseNum.value,
      'المبلغ': fakeElements.fExpenseAmount.value,
      'التصنيف': fakeElements.fExpenseCategory.value,
      'المصدر': fakeElements.fExpenseSource.value,
      'التاريخ': fakeElements.fExpenseDate.value,
      'الحالة': fakeElements.fExpenseStatus.value,
      'الملاحظات': fakeElements.fExpenseNotes.value
    };
  }

  function fillForm(type, record) {
    if (type !== 'expenses') return;
    fakeElements.fExpenseScope.value = record['النطاق'] || '';
    fakeElements.fExpenseClientId.value = record['رقم_الموكل'] || '';
    fakeElements.fExpenseCaseNum.value = record['رقم_القضية'] || '';
    fakeElements.fExpenseAmount.value = record['المبلغ'] || '';
    fakeElements.fExpenseCategory.value = record['التصنيف'] || '';
    fakeElements.fExpenseSource.value = record['المصدر'] || '';
    fakeElements.fExpenseDate.value = record['التاريخ'] || '';
    fakeElements.fExpenseStatus.value = record['الحالة'] || '';
    fakeElements.fExpenseNotes.value = record['الملاحظات'] || '';
  }

  const sandboxGlobals = {
    indexedDB: fakeIndexedDB,
    data: { clients: [{ 'رقم_الموكل': 'CL1', 'الاسم': 'أحمد محمود' }], cases: [{ 'رقم_القضية': '2025/1001' }], expenses: [] },
    editIdx: { expenses: -1 },
    document: {
      getElementById: function (id) { return fakeElements[id] || null; },
      addEventListener: function () {},
      querySelectorAll: function () { return []; }
    },
    escapeHtml: function (s) { return String(s == null ? '' : s); },
    formatDate: function (d) { return d || '—'; },
    toast: function (msg, type) { toastLog.push({ msg: msg, type: type }); },
    val: function (id) { return fakeElements[id] ? fakeElements[id].value : ''; },
    collectForm: collectForm,
    fillForm: fillForm,
    confirmDialog: async function () { return confirmDialogAnswer; },
    closeModal: function (id) { closeModalLog.push(id); },
    saveLocal: function () { savedLocalCalls.count++; },
    updateBadges: function () { badgeCalls.count++; },
    populateCaseDropdown: function () {},
    toggleExpenseScopeFields: function () {},
    ApiService: {
      syncRow: function (sheet, record, idx) { apiCalls.push({ fn: 'syncRow', sheet: sheet, record: record }); },
      deleteData: function (sheet, idx, id) { apiCalls.push({ fn: 'deleteData', sheet: sheet, id: id }); }
    }
  };
  sandboxGlobals.window = global;

  Object.keys(sandboxGlobals).forEach(function (k) { global[k] = sandboxGlobals[k]; });

  const financialReports = loadModule(financialReportsPath);
  await financialReports.ensureExpensesRepositoryReady();
  const expensesModule = loadModule(expensesPath);

  await checkAsync('saveExpense(): blocked with a toast when النطاق/المبلغ/التصنيف are missing, before any Repository call', async () => {
    toastLog.length = 0;
    await expensesModule.saveExpense();
    assert.strictEqual(toastLog.length, 1);
    assert.strictEqual(sandboxGlobals.data.expenses.length, 0);
  });

  await checkAsync('saveExpense(): scope=موكل blocked with a toast when no client is selected', async () => {
    fakeElements.fExpenseScope.value = 'موكل';
    fakeElements.fExpenseAmount.value = '100';
    fakeElements.fExpenseCategory.value = 'انتقال';
    fakeElements.fExpenseClientId.value = '';
    toastLog.length = 0;
    await expensesModule.saveExpense();
    assert.strictEqual(toastLog.length, 1);
    assert.ok(toastLog[0].msg.indexOf('الموكل') !== -1);
  });

  await checkAsync('saveExpense(): scope=قضية blocked with a toast when no case is selected', async () => {
    fakeElements.fExpenseScope.value = 'قضية';
    fakeElements.fExpenseCaseNum.value = '';
    toastLog.length = 0;
    await expensesModule.saveExpense();
    assert.strictEqual(toastLog.length, 1);
    assert.ok(toastLog[0].msg.indexOf('القضية') !== -1);
  });

  await checkAsync('saveExpense(): scope=موكل — creates a real ExpensesRepository record, syncs mirror, calls ApiService.syncRow', async () => {
    fakeElements.fExpenseScope.value = 'موكل';
    fakeElements.fExpenseClientId.value = 'CL1';
    fakeElements.fExpenseCaseNum.value = '';
    fakeElements.fExpenseAmount.value = '250';
    fakeElements.fExpenseCategory.value = 'مواصلات';
    fakeElements.fExpenseDate.value = '2026-01-01';
    apiCalls.length = 0;
    savedLocalCalls.count = 0;

    await expensesModule.saveExpense();

    const rows = financialReports.expensesRepository.getAll().filter(function (e) { return e['رقم_الموكل'] === 'CL1'; });
    assert.strictEqual(rows.length, 1);
    assert.strictEqual(rows[0]['المبلغ'], '250');
    assert.strictEqual(rows[0]['النطاق'], 'موكل');
    assert.strictEqual(rows[0]['رقم_القضية'], '', 'رقم_القضية must be cleared for a موكل-scope record even if a stale value was left in the field');
    assert.ok(apiCalls.some(function (c) { return c.fn === 'syncRow' && c.sheet === 'المصروفات'; }));
    assert.strictEqual(savedLocalCalls.count, 1);
    assert.strictEqual(closeModalLog[closeModalLog.length - 1], 'modalExpense');
  });

  await checkAsync('saveExpense(): scope=مكتب — creates a record with neither رقم_الموكل nor رقم_القضية', async () => {
    fakeElements.fExpenseScope.value = 'مكتب';
    fakeElements.fExpenseClientId.value = '';
    fakeElements.fExpenseCaseNum.value = '';
    fakeElements.fExpenseAmount.value = '5000';
    fakeElements.fExpenseCategory.value = 'إيجار';

    await expensesModule.saveExpense();

    const rows = financialReports.expensesRepository.getAll().filter(function (e) { return e['التصنيف'] === 'إيجار'; });
    assert.strictEqual(rows.length, 1);
    assert.strictEqual(rows[0]['رقم_الموكل'], '');
    assert.strictEqual(rows[0]['رقم_القضية'], '');
  });

  await checkAsync('saveExpense(): update path (editIdx.expenses >= 0) updates the existing record instead of creating a new one', async () => {
    sandboxGlobals.data.expenses = financialReports.expensesRepository.getAll();
    const officeIdx = sandboxGlobals.data.expenses.findIndex(function (e) { return e['التصنيف'] === 'إيجار'; });
    const before = financialReports.expensesRepository.getAll().length;

    sandboxGlobals.editIdx.expenses = officeIdx;
    fakeElements.fExpenseAmount.value = '5500';
    fakeElements.fExpenseCategory.value = 'إيجار';
    fakeElements.fExpenseScope.value = 'مكتب';

    await expensesModule.saveExpense();

    const after = financialReports.expensesRepository.getAll().length;
    assert.strictEqual(after, before, 'update must not create a new row');
    const updated = financialReports.expensesRepository.getAll().filter(function (e) { return e['التصنيف'] === 'إيجار'; })[0];
    assert.strictEqual(updated['المبلغ'], '5500');

    sandboxGlobals.editIdx.expenses = -1;
  });

  check('editExpense(i): pre-fills the form fields and opens the modal', () => {
    sandboxGlobals.data.expenses = financialReports.expensesRepository.getAll();
    const i = sandboxGlobals.data.expenses.findIndex(function (e) { return e['رقم_الموكل'] === 'CL1'; });

    expensesModule.editExpense(i);

    assert.strictEqual(fakeElements.fExpenseAmount.value, '250');
    assert.strictEqual(fakeElements.fExpenseCategory.value, 'مواصلات');
    assert.ok(fakeElements.modalExpense.classList.contains('open'));
  });

  await checkAsync('deleteExpense(i): soft-deletes via ExpensesRepository, calls ApiService.deleteData, updates mirror', async () => {
    sandboxGlobals.data.expenses = financialReports.expensesRepository.getAll();
    const i = sandboxGlobals.data.expenses.findIndex(function (e) { return e['رقم_الموكل'] === 'CL1'; });
    const id = sandboxGlobals.data.expenses[i]['id'];
    apiCalls.length = 0;

    await expensesModule.deleteExpense(i);

    assert.ok(apiCalls.some(function (c) { return c.fn === 'deleteData' && c.id === id; }));
    const stillVisible = financialReports.expensesRepository.getAll().some(function (e) { return e['id'] === id; });
    assert.strictEqual(stillVisible, false);
  });

  await checkAsync('deleteExpense(i): confirmDialog()=false aborts the delete entirely', async () => {
    sandboxGlobals.data.expenses = financialReports.expensesRepository.getAll();
    const before = financialReports.expensesRepository.getAll().length;
    confirmDialogAnswer = false;

    await expensesModule.deleteExpense(0);

    assert.strictEqual(financialReports.expensesRepository.getAll().length, before);
    confirmDialogAnswer = true;
  });

  await checkAsync('restoreExpense(id): brings a soft-deleted record back, calls ApiService.syncRow', async () => {
    const allIncludingDeleted = financialReports.expensesRepository.search({ includeDeleted: true }).items;
    const deletedRecord = allIncludingDeleted.filter(function (e) { return e['رقم_الموكل'] === 'CL1'; })[0];
    assert.ok(deletedRecord, 'expected to find the soft-deleted record from the earlier test');

    apiCalls.length = 0;
    await expensesModule.restoreExpense(deletedRecord['id']);

    assert.ok(apiCalls.some(function (c) { return c.fn === 'syncRow'; }));
    const visibleAgain = financialReports.expensesRepository.getAll().some(function (e) { return e['id'] === deletedRecord['id']; });
    assert.strictEqual(visibleAgain, true);
  });

  check('renderExpenses(): computes total/count from the real Repository data and writes them to the stat elements', () => {
    fakeElements.searchExpenses.value = '';
    expensesModule.renderExpenses();

    const expected = financialReports.expensesRepository.getAll().reduce(function (acc, e) { return acc + (parseFloat(e['المبلغ']) || 0); }, 0);
    assert.strictEqual(fakeElements.expensesCountNum.textContent, financialReports.expensesRepository.getAll().length);
    assert.strictEqual(fakeElements.expensesTotalNum.textContent, expected.toLocaleString('ar-EG'));
  });

  check('renderExpenses(): renders a table row for each non-deleted expense', () => {
    const count = financialReports.expensesRepository.getAll().length;
    assert.ok(count > 0, 'expected at least one expense from earlier tests');
    const rowMatches = fakeElements.expensesTableBody.innerHTML.match(/<tr>/g) || [];
    assert.strictEqual(rowMatches.length, count);
  });

  check('populateExpenseClientDropdown(): populates #fExpenseClientId from data.clients, pre-selecting when given a value', () => {
    fakeElements.fExpenseClientId.innerHTML = '';
    expensesModule.populateExpenseClientDropdown('CL1');
    assert.ok(fakeElements.fExpenseClientId.innerHTML.indexOf('أحمد محمود') !== -1);
    assert.ok(fakeElements.fExpenseClientId.innerHTML.indexOf('selected') !== -1);
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
