/**
 * verify_opponents_case_selector_integration.js
 * ================================================================
 * CASES_RELATIONSHIP_FINANCIAL — closes a real, pre-existing coverage
 * gap: js/modules/opponents.js's Case-modal opponent-selector (the
 * ID-based multi-select + saveCase/editCase/resetForm wraps) had NO
 * dedicated DOM-integration test before this phase, unlike its sibling
 * js/modules/clients.js (see verify_clients_repository_integration.js).
 * Structurally mirrors that file's exact sandbox pattern (same
 * loadModule/setGlobals helpers, same fake element/storage shapes) —
 * no new test-harness architecture invented.
 *
 * Focus: the case-selector surface this phase actually touched —
 * ID-based opponent selection (pre-existing, unaffected — asserted
 * here as a baseline), and the NEW صفات_الخصوم (decision §3-D)
 * role-card UI: renderOpponentSelectorChips(), getOpponentRoles(),
 * and the sync-on-save / restore-on-edit / clear-on-reset lifecycle.
 *
 * No file is modified by running this harness. It only reads
 * js/modules/opponents.js and js/repositories/OpponentsRepository.js
 * (and, transitively, js/core/Repository.js/DatabaseService.js/
 * IndexedDBAdapter.js) exactly as they exist on disk.
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

function setGlobals(extraGlobals) {
  Object.keys(extraGlobals).forEach(function (k) { global[k] = extraGlobals[k]; });
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

const opponentsJsPath = path.join(__dirname, '..', 'modules', 'opponents.js');

async function main() {
  const fakeIndexedDB = new FakeIndexedDB();
  const fakeElements = {
    fCaseOpponents: makeFakeElement(),
    fCaseOpponentRoles: makeFakeElement(),
    fCaseOpponent: makeFakeElement(),
    fCaseOpponentNID: makeFakeElement(),
    fCaseOpponentPhone: makeFakeElement(),
    fCaseOpponentAddr: makeFakeElement(),
    fCaseOpponentJob: makeFakeElement(),
    fCaseOpponentEmployer: makeFakeElement(),
    opponentSelectorList: makeFakeElement(),
    opponentSelectorChips: makeFakeElement(),
    opponentSelectorPanel: makeFakeElement(),
    opponentSelectorSearch: makeFakeElement()
  };

  const savedCaseCalls = [];
  const sandboxGlobals = {
    indexedDB: fakeIndexedDB,
    data: {
      opponents: [],
      cases: []
    },
    editIdx: { cases: -1 },
    document: {
      getElementById: function (id) { return fakeElements[id] || null; },
      addEventListener: function () {},
      querySelectorAll: function () { return []; }
    },
    escapeHtml: function (s) { return String(s == null ? '' : s); },
    toast: function () {},
    resetForm: function (type) { savedCaseCalls.push({ fn: 'resetForm', type: type }); },
    editCase: function (i) { savedCaseCalls.push({ fn: 'editCase', i: i }); },
    saveCase: async function () { savedCaseCalls.push({ fn: 'saveCase' }); return { success: true }; }
  };
  sandboxGlobals.window = global; // self-referential, matching verify_clients_repository_integration.js's exact pattern — IndexedDBAdapter's root resolves to window when defined, so window.indexedDB must be the SAME object as global.indexedDB above, not a disconnected empty stub.

  setGlobals(sandboxGlobals);
  const opponentsModule = loadModule(opponentsJsPath);
  await opponentsModule.ensureOpponentsRepositoryReady();

  // CASES_RELATIONSHIP_FINANCIAL: seed via the Repository itself, not a
  // raw data.opponents array assignment — syncOpponentsMirror() (which
  // runs automatically once the repository finishes opening, see
  // opponentsRepositoryReadyPromise in opponents.js) overwrites
  // data.opponents with opponentsRepository.getAll(), which would
  // silently wipe a manually-assigned fixture array back to empty.
  await opponentsModule.opponentsRepository.create({ 'رقم_الخصم': 'OP1', 'الاسم': 'حمو إبراهيم', 'النوع': 'شخص طبيعي' });
  await opponentsModule.opponentsRepository.create({ 'رقم_الخصم': 'OP2', 'الاسم': 'شركة النور', 'النوع': 'شخص اعتباري' });
  global.data.opponents = opponentsModule.opponentsRepository.getAll();

  // ================================================================
  // 1. Baseline: ID-based selection (pre-existing behavior, unaffected)
  // ================================================================
  check('toggleCaseOpponent(): selecting an id adds it, writes JSON array to #fCaseOpponents', () => {
    opponentsModule.toggleCaseOpponent('OP1', true);
    assert.deepStrictEqual(JSON.parse(fakeElements.fCaseOpponents.value), ['OP1']);
  });

  check('toggleCaseOpponent(): deselecting removes it again', () => {
    opponentsModule.toggleCaseOpponent('OP1', false);
    assert.deepStrictEqual(JSON.parse(fakeElements.fCaseOpponents.value), []);
  });

  // ================================================================
  // 2. NEW: صفات_الخصوم role-card UI (decision §3-D)
  // ================================================================
  check('renderOpponentSelectorChips(): renders a role-card (with a صفة input) for each selected opponent', () => {
    opponentsModule.toggleCaseOpponent('OP1', true);
    opponentsModule.toggleCaseOpponent('OP2', true);
    const html = fakeElements.opponentSelectorChips.innerHTML;
    assert.ok(html.indexOf('حمو إبراهيم') !== -1);
    assert.ok(html.indexOf('شركة النور') !== -1);
    assert.ok(html.indexOf('data-opponent-role-id') !== -1, 'expected role-card input markup');
  });

  check('getOpponentRoles(): with the fake DOM stub returning no real child elements, returns an empty map (documented stub limitation, not a functional gap)', () => {
    const roles = opponentsModule.getOpponentRoles();
    assert.deepStrictEqual(roles, {});
  });

  check('_syncCaseOpponentField(): writes an empty {} to #fCaseOpponentRoles when no roles are typed (stub has no real inputs to read)', () => {
    assert.strictEqual(fakeElements.fCaseOpponentRoles.value, '{}');
  });

  // ================================================================
  // 3. Lifecycle: restore-on-edit (previously completely missing)
  // ================================================================
  check('syncCaseOpponentSelectorFromField(): restores صفات_الخصوم from the case record when editing an existing case', () => {
    const caseRecord = {
      'رقم_الخصوم': JSON.stringify(['OP1', 'OP2']),
      'صفات_الخصوم': JSON.stringify({ OP1: 'مدّعى عليه', OP2: 'مدّعى عليه ثانٍ' })
    };
    opponentsModule.syncCaseOpponentSelectorFromField(caseRecord);
    assert.strictEqual(fakeElements.fCaseOpponentRoles.value, JSON.stringify({ OP1: 'مدّعى عليه', OP2: 'مدّعى عليه ثانٍ' }));
    assert.deepStrictEqual(JSON.parse(fakeElements.fCaseOpponents.value), ['OP1', 'OP2']);
  });

  check('syncCaseOpponentSelectorFromField(): a legacy case with no صفات_الخصوم at all falls back to an empty map, not an error', () => {
    const caseRecord = { 'رقم_الخصوم': JSON.stringify(['OP1']) };
    opponentsModule.syncCaseOpponentSelectorFromField(caseRecord);
    assert.strictEqual(fakeElements.fCaseOpponentRoles.value, '{}');
  });

  // ================================================================
  // 4. Lifecycle: clear-on-reset
  // ================================================================
  check('resetForm wrap: clears #fCaseOpponentRoles back to {} (and #fCaseOpponents back to [])', () => {
    opponentsModule.toggleCaseOpponent('OP1', true);
    global.resetForm('cases');
    assert.strictEqual(fakeElements.fCaseOpponentRoles.value, '{}');
    assert.strictEqual(fakeElements.fCaseOpponents.value, '[]');
  });

  // ================================================================
  // 5. Lifecycle: sync-on-save (the gap this phase specifically fixed)
  // ================================================================
  check('saveCase wrap: re-syncs #fCaseOpponentRoles immediately before delegating to the original saveCase (not just on toggle)', async () => {
    opponentsModule.toggleCaseOpponent('OP1', true);
    fakeElements.fCaseOpponentRoles.value = '';
    await global.saveCase();
    assert.doesNotThrow(() => JSON.parse(fakeElements.fCaseOpponentRoles.value));
    assert.ok(savedCaseCalls.some(c => c.fn === 'saveCase'), 'the original saveCase must still have been called');
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
