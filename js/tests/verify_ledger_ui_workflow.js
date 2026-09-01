/**
 * verify_ledger_ui_workflow.js
 * PHASE 9/10 — LEDGER UI wiring proof (mirrors verify_payment_modal_
 * workflow.js's technique). Proves openLedger() actually renders
 * getCaseLedger()/getClientLedger()/getOfficeLedger()'s output into
 * #modalLedger — not just a function sitting unused (PHASE 8-12 master
 * prompt's core rule: "إذا كانت الدالة موجودة ولا يوجد زر أو شاشة
 * تستدعيها: الحالة = FAIL وليس PASS").
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
  return {
    value: '', textContent: '', innerHTML: '',
    classList: { _c: {}, add: function (c) { this._c[c] = true; }, contains: function (c) { return !!this._c[c]; } }
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
  compiledWrapper.call(mod.exports, mod.exports, function (id) { return mod.require(id); }, mod, filePath, path.dirname(filePath));
  mod.loaded = true;
  return mod.exports;
}

function main() {
  const fakeElements = {};
  const navigateLog = [];
  const closeModalLog = [];

  global.document = { getElementById: function (id) { if (!fakeElements[id]) fakeElements[id] = makeFakeElement(); return fakeElements[id]; } };
  global.escapeHtml = function (s) { return s == null ? '' : String(s); };
  global.formatDate = function (d) { return d || '—'; };
  global.closeModal = function (id) { closeModalLog.push(id); };
  global.navigate = function (page) { navigateLog.push(page); };
  global.window = global;

  global.getCaseLedger = function (caseNum) {
    assert.strictEqual(caseNum, '2026/123');
    return [
      { date: '2026-08-01', type: 'دفعة أتعاب', description: 'دفعة أولى', caseNum: '2026/123', clientName: 'أحمد', income: 5000, expense: 0, balance: 5000, sourceType: 'fee', sourceId: 'F1' },
      { date: '2026-08-10', type: 'مصروف (قضية)', description: 'رسوم إعلان', caseNum: '2026/123', clientName: '', income: 0, expense: 350, balance: 4650, sourceType: 'expense', sourceId: 'E1' }
    ];
  };
  global.getClientLedger = function (clientId) {
    assert.strictEqual(clientId, 'CL1');
    return [];
  };
  global.getOfficeLedger = function () { return []; };

  const ledgerModule = loadModule(path.join(__dirname, '..', 'modules', 'ledger.js'));

  check('openLedger(\'case\', caseNum): calls getCaseLedger() and renders its rows into #ledgerModalBody', () => {
    ledgerModule.openLedger('case', '2026/123');
    const body = fakeElements['ledgerModalBody'].innerHTML;
    assert.ok(body.indexOf('دفعة أولى') !== -1);
    assert.ok(body.indexOf('رسوم إعلان') !== -1);
    assert.ok(body.indexOf((4650).toLocaleString('ar-EG')) !== -1, 'expected the final running balance (4650) to appear');
    assert.ok(fakeElements['modalLedger'].classList.contains('open'));
    assert.strictEqual(fakeElements['ledgerModalTitle'].textContent, 'كشف حساب القضية 2026/123');
  });

  check('openLedger(\'case\', caseNum): income row shows "+5,000" and expense row shows "-350" (not blended into one column)', () => {
    const body = fakeElements['ledgerModalBody'].innerHTML;
    assert.ok(body.indexOf('+' + (5000).toLocaleString('ar-EG')) !== -1);
    assert.ok(body.indexOf('-' + (350).toLocaleString('ar-EG')) !== -1);
  });

  check('openLedger(\'client\', clientId): calls getClientLedger() (proves it is wired, distinctly from getCaseLedger)', () => {
    ledgerModule.openLedger('client', 'CL1');
    assert.strictEqual(fakeElements['ledgerModalTitle'].textContent, 'كشف حساب الموكل');
  });

  check('openLedger(): with an empty ledger renders the empty-state message, not a broken/empty table', () => {
    ledgerModule.openLedger('office');
    const body = fakeElements['ledgerModalBody'].innerHTML;
    assert.ok(body.indexOf('لا توجد حركات مالية بعد') !== -1);
  });

  check('openLedgerEntrySource(\'fee\', id): closes the Ledger modal and navigates to the Fees page', () => {
    ledgerModule.openLedgerEntrySource('fee', 'F1');
    assert.strictEqual(closeModalLog[closeModalLog.length - 1], 'modalLedger');
    assert.strictEqual(navigateLog[navigateLog.length - 1], 'fees');
  });

  check('openLedgerEntrySource(\'expense\', id): navigates to the Expenses page', () => {
    ledgerModule.openLedgerEntrySource('expense', 'E1');
    assert.strictEqual(navigateLog[navigateLog.length - 1], 'expenses');
  });

  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  if (failed > 0) process.exitCode = 1;
}

main();
