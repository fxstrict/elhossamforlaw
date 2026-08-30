/**
 * verify_expense_case_autofill.js
 * PHASE 13 — EXPENSE AUTO-FILL. Written BEFORE implementation (TDD).
 *
 * Confirmed gap (PHASE 7 §11 CONFIRMED GAP, re-confirmed unfixed by the
 * PHASE 8-24 master prompt itself): #fExpenseCaseNum has no onchange
 * handler, so populateExpenseClientDropdown() always lists ALL clients
 * regardless of which case is selected — the user must still hunt for
 * the right client by name instead of the system using
 * CaseClientsRepository (already the source of truth for case<->client
 * links) to narrow/auto-fill it.
 *
 * Does NOT touch ExpensesRepository — this is UI-layer wiring only,
 * reading the existing data.caseClients mirror, exactly the pattern
 * PHASE 4/8's own createFeePayment()/openPaymentModal() already use.
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const Module = require('module');
const vm = require('vm');

let passed = 0;
let failed = 0;
function check(label, fn) {
  try {
    fn();
    passed++;
    console.log('PASS — ' + label);
  } catch (e) {
    failed++;
    console.log('FAIL — ' + label + '  =>  ' + e.message);
  }
}

function makeFakeElement() {
  return { value: '', innerHTML: '' };
}

function loadModule(filePath) {
  const code = fs.readFileSync(filePath, 'utf8');
  const wrapper = Module.wrap(code);
  const script = new vm.Script(wrapper, { filename: filePath });
  const compiledWrapper = script.runInThisContext();
  const mod = new Module(filePath, module);
  mod.filename = filePath;
  mod.paths = Module._nodeModulePaths(path.dirname(filePath));
  compiledWrapper.call(mod.exports, mod.exports, function (id) { return mod.require(id); }, mod, filePath, path.dirname(filePath));
  mod.loaded = true;
  return mod.exports;
}

function main() {
  const fakeElements = {};
  global.document = { getElementById: function (id) { if (!fakeElements[id]) fakeElements[id] = makeFakeElement(); return fakeElements[id]; } };
  global.escapeHtml = function (s) { return s == null ? '' : String(s); };
  global.data = {
    clients: [
      { 'رقم_الموكل': 'CL1', 'الاسم': 'أحمد محمود' },
      { 'رقم_الموكل': 'CL2', 'الاسم': 'سارة عبد الله' },
      { 'رقم_الموكل': 'CL3', 'الاسم': 'محمد علي' } // not linked to any case below — must not appear when a case with relationships is selected
    ],
    caseClients: [
      { id: 'REL-1', 'رقم_القضية': '2026/123', 'رقم_الموكل': 'CL1', 'الصفة': 'مدّعي' }
    ]
  };
  global.window = global;
  global.editIdx = { expenses: -1 };
  global.populateCaseDropdown = function () {};
  global.fillForm = function () {};
  global.toggleExpenseScopeFields = function () {};

  const expensesModule = loadModule(path.join(__dirname, '..', 'modules', 'expenses.js'));

  check('SETUP: expenses.js exposes an onExpenseCaseSelected(caseNum) function', () => {
    assert.strictEqual(typeof expensesModule.onExpenseCaseSelected, 'function');
  });

  check('onExpenseCaseSelected(caseNum) — case with EXACTLY ONE linked client: auto-selects that client (per PHASE 13 §3: "إذا كانت القضية مرتبطة بموكل واحد فقط → تعبئة الموكل تلقائيًا")', () => {
    expensesModule.onExpenseCaseSelected('2026/123');
    assert.strictEqual(fakeElements['fExpenseClientId'].value, 'CL1');
  });

  check('onExpenseCaseSelected(caseNum) — the client dropdown is narrowed to ONLY the linked client(s), not all 3 clients (CL3 must not appear as an option)', () => {
    const html = fakeElements['fExpenseClientId'].innerHTML;
    assert.ok(html.indexOf('أحمد محمود') !== -1);
    assert.ok(html.indexOf('محمد علي') === -1, 'CL3 is not linked to this case and must not appear in the narrowed list');
  });

  check('onExpenseCaseSelected(caseNum) — a case with MULTIPLE linked clients: dropdown lists all of them, none pre-selected (per PHASE 13 §4: "اجعل الاختيار واضحًا بدل اختيار عشوائي")', () => {
    global.data.caseClients.push({ id: 'REL-2', 'رقم_القضية': '2026/123', 'رقم_الموكل': 'CL2', 'الصفة': 'مدّعى عليه' });
    fakeElements['fExpenseClientId'].value = '';
    expensesModule.onExpenseCaseSelected('2026/123');
    assert.strictEqual(fakeElements['fExpenseClientId'].value, '', 'must NOT auto-select an arbitrary one of several linked clients');
    const html = fakeElements['fExpenseClientId'].innerHTML;
    assert.ok(html.indexOf('أحمد محمود') !== -1);
    assert.ok(html.indexOf('سارة عبد الله') !== -1);
  });

  check('onExpenseCaseSelected(caseNum) — a case with NO linked clients at all falls back to showing every client (never leaves the user with an empty, unusable dropdown)', () => {
    expensesModule.onExpenseCaseSelected('2099/999');
    const html = fakeElements['fExpenseClientId'].innerHTML;
    assert.ok(html.indexOf('أحمد محمود') !== -1);
    assert.ok(html.indexOf('سارة عبد الله') !== -1);
    assert.ok(html.indexOf('محمد علي') !== -1, 'fallback to the full client list when the case has no known relationships');
  });

  check('onExpenseCaseSelected(\'\') — clearing the case selection resets to the full client list (no case = no narrowing)', () => {
    expensesModule.onExpenseCaseSelected('');
    const html = fakeElements['fExpenseClientId'].innerHTML;
    assert.ok(html.indexOf('محمد علي') !== -1);
  });

  check('onExpenseCaseSelected(): does NOT modify ExpensesRepository, CaseClientsRepository, or data.caseClients in any way — pure UI read', () => {
    const before = JSON.stringify(global.data.caseClients);
    expensesModule.onExpenseCaseSelected('2026/123');
    const after = JSON.stringify(global.data.caseClients);
    assert.strictEqual(before, after);
  });

  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  if (failed > 0) process.exitCode = 1;
}

main();
