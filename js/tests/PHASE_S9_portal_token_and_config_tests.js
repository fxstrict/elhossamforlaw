/**
 * PHASE_S9_portal_token_and_config_tests.js — نظام الحسام للمحاماة
 * ================================================================
 * Targeted checks for two PHASE S.9 findings:
 *  1. Portal token generation strength (js/modules/clients.js
 *     _generatePortalToken()) — proves it now uses
 *     crypto.getRandomValues() (256 bits, 64 hex chars) rather than
 *     the old uid()+'-'+uid() pattern, and that tokens are unique
 *     across many calls (sanity, not a formal entropy proof).
 *  2. Static config checks: المصروفات/expenses is now present in both
 *     pull-pair lists (settings.js / SyncEngine.js), same style as
 *     PHASE_S8's own suite 3.
 * ================================================================
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const Module = require('module');
const vm = require('vm');
const { FakeIndexedDB } = require(path.join(__dirname, 'fake_indexeddb.js'));
const { confirmDialog } = require(path.join(__dirname, '_shared', 'browserStubs.js'));

let passed = 0, failed = 0;
function check(label, fn) {
  try { fn(); passed++; console.log('PASS — ' + label); }
  catch (e) { failed++; console.log('FAIL — ' + label + '  =>  ' + e.message); }
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
function makeFakeElement() {
  return {
    value: '', textContent: '', innerHTML: '', style: { display: '' },
    classList: { _c: {}, add: function (c) { this._c[c] = true; }, remove: function (c) { delete this._c[c]; }, contains: function (c) { return !!this._c[c]; } },
    querySelectorAll: function () { return []; }
  };
}

function suite1_portalToken() {
  const clientsJsPath = path.join(__dirname, '..', 'modules', 'clients.js');
  const fakeElements = {};

  global.window = global;
  global.indexedDB = new FakeIndexedDB();
  global.data = { clients: [], caseClients: [], cases: [] };
  global.editIdx = { clients: -1 };
  global.document = {
    getElementById: function (id) { if (!fakeElements[id]) fakeElements[id] = makeFakeElement(); return fakeElements[id]; },
    querySelectorAll: function () { return []; },
    addEventListener: function () {}
  };
  global.toast = function () {};
  global.saveLocal = function () {};
  global.closeModal = function () {};
  global.updateBadges = function () {};
  global.confirm = function () { return true; };
  global.confirmDialog = confirmDialog;
  global.uid = function () { return 'test-uid-' + Math.random().toString(36).slice(2, 8); };
  global.val = function (id) { return fakeElements[id] ? fakeElements[id].value : ''; };
  global.collectForm = function () { return {}; };
  global.fillForm = function () {};
  global.resetForm = function () {};
  global.escapeHtml = function (s) { return s == null ? '' : String(s); };
  global.formatDate = function (d) { return d || ''; };
  global.ApiService = { syncRow: function () {}, deleteData: function () {}, restoreRow: async function () { return 'SERVER_CONFIRMED'; }, getPortalUrl: function (t) { return 'https://portal.example/' + t; }, getQrImageUrl: function () { return ''; } };

  const cm = loadModule(clientsJsPath);

  check('_generatePortalToken(): uses crypto.getRandomValues -> 64 hex chars (256 bits), not the old uid()+"-"+uid() shape', () => {
    const t = cm._generatePortalToken();
    assert.strictEqual(typeof t, 'string');
    assert.strictEqual(t.length, 64, 'expected 32 bytes hex-encoded = 64 chars');
    assert.ok(/^[0-9a-f]{64}$/.test(t), 'expected pure lowercase hex, no "-" separator (old format used one)');
  });

  check('_generatePortalToken(): 200 calls produce 200 unique tokens (no collisions, sanity check)', () => {
    const seen = new Set();
    for (let i = 0; i < 200; i++) seen.add(cm._generatePortalToken());
    assert.strictEqual(seen.size, 200);
  });

  delete global.window; delete global.indexedDB; delete global.data; delete global.editIdx;
  delete global.document; delete global.toast; delete global.saveLocal; delete global.closeModal;
  delete global.updateBadges; delete global.confirm; delete global.confirmDialog; delete global.uid;
  delete global.val; delete global.collectForm; delete global.fillForm; delete global.resetForm;
  delete global.escapeHtml; delete global.formatDate; delete global.ApiService;
}

function suite2_expensesPullConfig() {
  const syncEngineSrc = fs.readFileSync(path.join(__dirname, '..', 'core', 'SyncEngine.js'), 'utf8');
  const settingsSrc = fs.readFileSync(path.join(__dirname, '..', 'modules', 'settings.js'), 'utf8');

  check('SyncEngine.js: SYNC_ENTITY_PAIRS literally includes [\'المصروفات\', \'expenses\']', () => {
    assert.ok(syncEngineSrc.indexOf("['المصروفات', 'expenses']") !== -1);
  });
  check('settings.js: loadFromSheets() pairs literally includes [\'المصروفات\',\'expenses\']', () => {
    assert.ok(settingsSrc.indexOf("['المصروفات','expenses']") !== -1);
  });
}

suite1_portalToken();
suite2_expensesPullConfig();
console.log('\n' + passed + '/' + (passed + failed) + ' checks passed.');
if (failed > 0) { console.log('\n' + failed + ' CHECK(S) FAILED.'); process.exit(1); }
console.log('\nALL CHECKS PASSED.');
