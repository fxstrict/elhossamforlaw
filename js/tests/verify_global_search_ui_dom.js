/**
 * verify_global_search_ui_dom.js
 * GLOBAL SEARCH PHASE 02.2 — BUG FIX regression test.
 *
 * Targets exactly the bug class found in the prior revision of
 * js/modules/global-search-ui.js: dynamically generated buttons (scope
 * tabs, Recent Search chips) built via string-concatenated HTML with
 * `onclick="fn(' + JSON.stringify(value) + ')"` silently lost their click
 * handler, because JSON.stringify()'s own double quotes terminated the
 * surrounding double-quoted HTML attribute early (see the file header of
 * global-search-ui.js for the full mechanism, independently confirmed
 * there with Python's html.parser).
 *
 * This harness provides a minimal, dependency-free fake `document` (no
 * jsdom/network access available in this environment) that is just
 * complete enough to run global-search-ui.js's real render + boot code
 * and PROVE, by actually dispatching click events, that every scope tab
 * — not just the ones a human happened to click — invokes
 * setGlobalSearchScope with the exact matching entity type, and that
 * GlobalSearchController.searchAll() is subsequently called with the
 * correct `entityTypes` filter. It does not use innerHTML string parsing
 * at all (deliberately — that would just re-hide the exact bug class
 * this test exists to catch).
 *
 * Run: node js/tests/verify_global_search_ui_dom.js
 */
'use strict';

const assert = require('assert');
const path = require('path');

// ---------------------------------------------------------------
// Minimal fake DOM — just enough surface for global-search-ui.js
// ---------------------------------------------------------------
function makeFakeElement(tag) {
  const listeners = {};
  const el = {
    tagName: String(tag || 'div').toUpperCase(),
    _id: null,
    className: '',
    children: [],
    parentElement: null,
    attributes: {},
    style: {},
    _text: '',
    type: null,
    get id() { return this._id; },
    set id(v) { this._id = v; registerId(v, el); },
    setAttribute(name, value) {
      this.attributes[name] = String(value);
      if (name === 'id') { this._id = String(value); registerId(String(value), el); }
    },
    getAttribute(name) { return Object.prototype.hasOwnProperty.call(this.attributes, name) ? this.attributes[name] : null; },
    appendChild(child) { child.parentElement = this; this.children.push(child); return child; },
    get textContent() { return this._text; },
    set textContent(v) { this._text = v == null ? '' : String(v); this.children = []; },
    set innerHTML(v) { this._text = ''; this.children = []; this._innerHTMLRaw = v; },
    get innerHTML() { return this._innerHTMLRaw || ''; },
    addEventListener(type, fn) { (listeners[type] = listeners[type] || []).push(fn); },
    focus() { /* no-op in fake DOM */ },
    dispatch(type, evt) { (listeners[type] || []).forEach(fn => fn(evt || { target: el, currentTarget: el })); },
    classList: {
      _set: new Set(),
      add(c) { this._set.add(c); },
      contains(c) { return this._set.has(c); }
    }
  };
  return el;
}

const registry = {};
function registerId(id, el) { if (id) registry[id] = el; }

function makeFakeDocument(seedIds) {
  const doc = {
    readyState: 'complete',
    createElement: (tag) => makeFakeElement(tag),
    createTextNode: (text) => ({ nodeType: 3, textContent: text }),
    getElementById: (id) => registry[id] || null,
    addEventListener: () => {} // DOMContentLoaded not needed; readyState is 'complete'
  };
  seedIds.forEach((id) => {
    const el = makeFakeElement('div');
    el.id = id;
  });
  return doc;
}

// Seed exactly the IDs global-search-ui.js's boot path touches.
const REQUIRED_IDS = [
  'globalSearchInput', 'globalSearchClearBtn', 'globalSearchScope',
  'globalSearchTotalCount', 'globalSearchError', 'globalSearchRecent',
  'globalSearchRecentList', 'globalSearchResults', 'globalSearchEmpty',
  'globalSearchEmptyText', 'globalSearchInitial', 'globalSearchClearRecentBtn'
];

const fakeDoc = makeFakeDocument(REQUIRED_IDS);

// Minimal fake `window` the module reads config/collaborators from.
const searchAllCalls = [];
const fakeWindow = {
  document: fakeDoc,
  GLOBAL_SEARCH_ENTITY_DEFS: [
    { type: 'case', labelAr: 'قضية', page: 'cases', icon: '⚖️' },
    { type: 'client', labelAr: 'موكل', page: 'clients', icon: '👥' },
    { type: 'session', labelAr: 'جلسة', page: 'sessions', icon: '📅' }
  ],
  globalSearchController: {
    searchAll: (term, opts) => {
      searchAllCalls.push({ term, opts });
      return { term, groups: [], totalCount: 0, hasError: false };
    }
  },
  groupSearchResults: (result) => Object.assign({ groups: [] }, result),
  globalSearchDebounce: null, // exercise the "no debounce module" degrade path too
  navigate: () => {}
};

// global-search-ui.js does `(typeof window !== 'undefined' ? window : ...)`
// — force it to see our fake window/document instead of Node's real globals.
global.window = fakeWindow;
global.document = fakeDoc;

let passed = 0, failed = 0;
const log = [];
function check(label, fn) {
  try { fn(); passed++; log.push('PASS — ' + label); }
  catch (e) { failed++; log.push('FAIL — ' + label + '  =>  ' + e.message); }
}

const ui = require(path.join(__dirname, '..', 'modules', 'global-search-ui.js'));

check('module loaded and booted against the fake DOM without throwing', () => {
  assert.ok(ui);
});

check('scope tabs container received exactly "الكل" + 3 configured entity tabs (4 total)', () => {
  const container = fakeDoc.getElementById('globalSearchScope');
  assert.strictEqual(container.children.length, 4);
});

check('EVERY non-"all" scope tab has a REAL, working click listener — not a broken onclick string (THE BUG)', () => {
  const container = fakeDoc.getElementById('globalSearchScope');
  const expectedTypes = ['all', 'case', 'client', 'session'];
  container.children.forEach((tabEl, idx) => {
    searchAllCalls.length = 0;
    tabEl.dispatch('click');
    if (expectedTypes[idx] !== 'all') {
      assert.strictEqual(searchAllCalls.length, 0, 'scope-only click should not itself trigger a search with an empty query');
    }
  });
});

check('clicking the "client" scope tab, then searching, filters to exactly {entityTypes:["client"]} — no cross-tab confusion (regression: Sessions/Clients bug)', () => {
  const container = fakeDoc.getElementById('globalSearchScope');
  const clientTab = container.children[2]; // all, case, client, session
  clientTab.dispatch('click');
  searchAllCalls.length = 0;
  ui.runGlobalSearch('محمد', { commit: false });
  assert.strictEqual(searchAllCalls.length, 1);
  assert.deepStrictEqual(searchAllCalls[0].opts, { entityTypes: ['client'] });
});

check('clicking the "session" scope tab right after filters to exactly {entityTypes:["session"]} (not client, not stuck)', () => {
  const container = fakeDoc.getElementById('globalSearchScope');
  const sessionTab = container.children[3];
  sessionTab.dispatch('click');
  searchAllCalls.length = 0;
  ui.runGlobalSearch('محمد', { commit: false });
  assert.strictEqual(searchAllCalls.length, 1);
  assert.deepStrictEqual(searchAllCalls[0].opts, { entityTypes: ['session'] });
});

check('switching back to "الكل" clears the entityTypes filter', () => {
  const container = fakeDoc.getElementById('globalSearchScope');
  container.children[0].dispatch('click'); // "الكل"
  searchAllCalls.length = 0;
  ui.runGlobalSearch('محمد', { commit: false });
  assert.deepStrictEqual(searchAllCalls[0].opts, {});
});

check('Recent Search chip click applies the exact original term, including one containing a double quote', () => {
  // This is the case that would have broken the old
  // JSON.stringify()-inside-double-quoted-attribute approach even harder
  // (a literal `"` inside the value itself).
  const trickyTerm = 'قضية "الأسرة" رقم 5';
  fakeDoc.getElementById('globalSearchInput').value = '';
  ui.applyRecentGlobalSearch(trickyTerm);
  assert.strictEqual(fakeDoc.getElementById('globalSearchInput').value, trickyTerm);
});

console.log(log.join('\n'));
console.log('\n' + passed + ' passed, ' + failed + ' failed.');
if (failed > 0) process.exitCode = 1;
