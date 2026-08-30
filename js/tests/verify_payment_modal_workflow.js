/**
 * verify_payment_modal_workflow.js
 * PHASE 8 — SECURITY + PAYMENT WORKFLOW — UI wiring proof.
 *
 * Loads the REAL js/modules/fees.js (via Node's Module wrapper, exactly
 * like verify_clients_repository_integration.js does) inside a sandbox
 * that stubs document/data/toast/confirmDialog/viewCase/viewClient —
 * proving PHASE 7 §12's core finding ("createFeePayment() لا يوجد لها
 * consumer حقيقي في UI") is now fixed: openPaymentModal() ->
 * onPaymentCaseSelected() -> onPaymentRelationshipSelected() ->
 * submitPayment() is a real, working chain that ends in an actual
 * createFeePayment() call and a real view refresh — not just a
 * function sitting unused.
 *
 * No production file is modified by running this harness.
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
async function checkAsync(label, fn) {
  try {
    await fn();
    passed++;
    console.log('PASS — ' + label);
  } catch (e) {
    failed++;
    console.log('FAIL — ' + label + '  =>  ' + e.message);
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
    }
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

async function main() {
  const fakeElements = {};
  const toastLog = [];
  const viewCaseCalls = [];
  const viewClientCalls = [];
  const closeModalLog = [];
  const confirmDialogQueue = []; // pushed answers, shifted per call

  global.indexedDB = new FakeIndexedDB();
  global.data = {
    clients: [{ 'رقم_الموكل': 'CL1', 'الاسم': 'أحمد محمود' }],
    cases: [{ 'رقم_القضية': '2026/123' }],
    fees: [],
    caseClients: [
      { id: 'REL-1', 'رقم_القضية': '2026/123', 'رقم_الموكل': 'CL1', 'الصفة': 'مدّعي', 'أتعاب_العلاقة': '20000' }
    ]
  };
  global.document = {
    getElementById: function (id) {
      if (!fakeElements[id]) fakeElements[id] = makeFakeElement();
      return fakeElements[id];
    }
  };
  global.toast = function (msg, type) { toastLog.push({ msg: msg, type: type }); };
  global.updateBadges = function () {};
  global.closeModal = function (id) { closeModalLog.push(id); };
  global.escapeHtml = function (s) { return s == null ? '' : String(s); };
  global.val = function (id) { var el = fakeElements[id]; return el ? el.value : ''; };
  global.formatDate = function (d) { return d || '—'; };
  global.confirmDialog = function () { return Promise.resolve(confirmDialogQueue.shift()); };
  global.ApiService = { syncRow: function () {} };
  global.saveLocal = function () {};
  global.renderFees = function () {};
  global.viewCase = function (idx) { viewCaseCalls.push(idx); };
  global.viewClient = function (idx) { viewClientCalls.push(idx); };
  global.getRelationshipRemaining = function (relationshipId) {
    var rel = global.data.caseClients.filter(function (r) { return r.id === relationshipId; })[0];
    if (!rel) return { agreedTotal: 0, collected: 0, remaining: 0 };
    var agreedTotal = parseFloat(rel['أتعاب_العلاقة']) || 0;
    var collected = global.data.fees.filter(function (f) { return f['رقم_علاقة'] === relationshipId; })
      .reduce(function (acc, f) { return acc + (parseFloat(f['المبلغ']) || 0); }, 0);
    return { agreedTotal: agreedTotal, collected: collected, remaining: agreedTotal - collected };
  };
  global.populateCaseDropdown = function () {};
  global.window = global;

  // Pre-warm every field id the payment modal touches, so tests can set
  // .value directly without first triggering a getElementById() call
  // through production code (mirrors the other harnesses' convenience,
  // but explicit here since submitPayment() reads several fields the
  // openPaymentModal()/onPaymentCaseSelected() paths don't all touch).
  ['fPaymentCaseNum', 'fPaymentRelationship', 'fPaymentAmount', 'fPaymentDate',
   'fPaymentMethod', 'fPaymentType', 'fPaymentNotes'].forEach(function (id) {
    fakeElements[id] = makeFakeElement();
  });

  const feesModule = loadModule(path.join(__dirname, '..', 'modules', 'fees.js'));

  // give feesRepository.open() (kicked off at module load) a tick to settle
  await new Promise(function (resolve) { setTimeout(resolve, 20); });

  // ================================================================
  // Context-bound entry (from Case/Client view — relationshipId given)
  // ================================================================

  check('openPaymentModal({relationshipId}): locks the modal (hides #paymentPickerGroup) and shows the correct summary', () => {
    feesModule.openPaymentModal({ relationshipId: 'REL-1', caseIdx: 0 });
    assert.strictEqual(fakeElements['paymentPickerGroup'].style.display, 'none');
    assert.strictEqual(fakeElements['paymentClientDisplay'].textContent, 'أحمد محمود');
    assert.strictEqual(fakeElements['paymentCaseDisplay'].textContent, '2026/123');
    assert.strictEqual(fakeElements['paymentAgreedDisplay'].textContent, (20000).toLocaleString('ar-EG') + ' ج.م');
    assert.strictEqual(fakeElements['paymentRemainingDisplay'].textContent, (20000).toLocaleString('ar-EG') + ' ج.م');
    assert.ok(fakeElements['modalFeePayment'].classList.contains('open'));
  });

  await checkAsync('submitPayment(): a valid context-bound payment calls createFeePayment(), creates a real Fees record, refreshes Fees + the originating Case view (viewCase(0)), and closes the modal', async () => {
    fakeElements['fPaymentAmount'].value = '5000';
    fakeElements['fPaymentDate'].value = '2026-08-01';
    fakeElements['fPaymentMethod'].value = 'نقداً';
    fakeElements['fPaymentType'].value = 'دفعة أولى';

    await feesModule.submitPayment();

    assert.strictEqual(global.data.fees.length, 1, 'expected exactly one Fees record to have been created');
    assert.strictEqual(global.data.fees[0]['رقم_علاقة'], 'REL-1');
    assert.strictEqual(global.data.fees[0]['رقم_القضية'], '2026/123');
    assert.strictEqual(global.data.fees[0]['رقم_الموكل'], 'CL1');
    assert.strictEqual(parseFloat(global.data.fees[0]['المبلغ']), 5000);
    assert.deepStrictEqual(viewCaseCalls, [0], 'expected the originating Case view (index 0) to be refreshed exactly once');
    assert.strictEqual(closeModalLog[closeModalLog.length - 1], 'modalFeePayment');
    assert.ok(toastLog.some(function (t) { return t.type === 'success'; }));
  });

  // ================================================================
  // General entry (from the Fees page — no context, pickers shown)
  // ================================================================

  check('openPaymentModal() with NO context: shows #paymentPickerGroup (pickers visible) instead of a locked summary', () => {
    feesModule.openPaymentModal();
    assert.notStrictEqual(fakeElements['paymentPickerGroup'].style.display, 'none');
  });

  check('onPaymentCaseSelected(caseNum): auto-selects the single matching relationship and renders its summary', () => {
    feesModule.onPaymentCaseSelected('2026/123');
    assert.strictEqual(fakeElements['fPaymentRelationship'].value, 'REL-1');
    assert.strictEqual(fakeElements['paymentClientDisplay'].textContent, 'أحمد محمود');
  });

  // ================================================================
  // Security: over-remaining amount is rejected, then the "سجّل
  // المتبقي فقط" confirm path is exercised end to end.
  // ================================================================

  await checkAsync('submitPayment(): an amount exceeding the relationship\'s remaining (15000 left, entering 20000) does NOT silently create a record — it is blocked pending confirmation', async () => {
    feesModule.openPaymentModal({ relationshipId: 'REL-1', clientIdx: 0 });
    fakeElements['fPaymentAmount'].value = '20000'; // only 15000 remains after the earlier 5000 payment
    confirmDialogQueue.push(false); // user cancels the "register remaining only" offer

    await feesModule.submitPayment();

    assert.strictEqual(global.data.fees.length, 1, 'still only the one earlier valid payment — the over-limit attempt must not have created a second record');
  });

  await checkAsync('submitPayment(): confirming "تسجيل المتبقي فقط" resubmits capped to the exact remaining amount (15000), and refreshes the originating Client view', async () => {
    feesModule.openPaymentModal({ relationshipId: 'REL-1', clientIdx: 2 });
    fakeElements['fPaymentAmount'].value = '20000';
    confirmDialogQueue.push(true); // user accepts "register 15000 only"

    await feesModule.submitPayment();

    assert.strictEqual(global.data.fees.length, 2, 'expected the capped retry to have created exactly one more record');
    assert.strictEqual(parseFloat(global.data.fees[1]['المبلغ']), 15000, 'expected the amount to have been capped to the exact remaining balance, not the originally-entered 20000');
    assert.ok(viewClientCalls.indexOf(2) !== -1, 'expected the originating Client view (index 2) to have been refreshed');

    const finalRemaining = global.getRelationshipRemaining('REL-1');
    assert.strictEqual(finalRemaining.remaining, 0, 'agreed 20000 fully collected across the two payments (5000 + 15000) — remaining must now be exactly 0');
  });

  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  if (failed > 0) process.exitCode = 1;
}

main().catch(function (e) {
  console.error('FATAL:', e);
  process.exitCode = 1;
});
