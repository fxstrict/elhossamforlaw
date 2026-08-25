/**
 * verify_legal_directories_back_navigation.js
 * Standalone Node harness for the Back-button fix in
 * js/modules/legal-directories.js (user-reported: Back used to exit
 * straight to the dashboard instead of going up one tree level).
 * Uses a minimal, hand-rolled History API simulation (a real array of
 * entries + a pointer, with go(delta) synchronously invoking
 * registered popstate listeners) — not a real browser, but enough to
 * exercise the exact pushState/go/popstate contract this fix relies on.
 * Run: node js/tests/verify_legal_directories_back_navigation.js
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');

// ---- Minimal DOM stub (same shape as verify_legal_directories_module.js) ----

function makeElement(tag) {
  var _text = '';
  var _html = '';
  var el = {
    tagName: String(tag).toUpperCase(),
    children: [],
    dataset: {},
    style: { display: '' },
    className: '',
    id: '',
    _listeners: {},
    _attrs: {},
    appendChild(child) { this.children.push(child); return child; },
    addEventListener(evt, fn) { (this._listeners[evt] = this._listeners[evt] || []).push(fn); },
    click() { (this._listeners.click || []).forEach((fn) => fn()); },
    setAttribute(k, v) { this._attrs[k] = v; },
    getAttribute(k) { return this._attrs[k]; }
  };
  Object.defineProperty(el, 'textContent', {
    get() { return _text; },
    set(v) { _text = v; this.children = []; }
  });
  Object.defineProperty(el, 'innerHTML', {
    get() { return _html; },
    set(v) { _html = v; this.children = []; }
  });
  return el;
}

// ---- Minimal real-enough History simulation ----

function makeHistoryStub(listenerTarget) {
  var entries = [{ state: null, url: '#dashboard' }]; // simulate "already on dashboard" before entering the page
  var pointer = 0;
  return {
    pushState(state, title, url) {
      entries = entries.slice(0, pointer + 1); // pushState drops any "forward" entries, like a real browser
      entries.push({ state: state, url: url });
      pointer = entries.length - 1;
    },
    go(delta) {
      var target = pointer + delta;
      if (target < 0 || target >= entries.length) return; // real browsers also no-op out of range
      pointer = target;
      var entry = entries[pointer];
      (listenerTarget._listeners.popstate || []).forEach((fn) => fn({ state: entry.state }));
    },
    _entryCount: () => entries.length,
    _pointer: () => pointer
  };
}

function installStubs(global, datasetJson) {
  const registry = {};
  ['legalDirBreadcrumb', 'legalDirGrid', 'legalDirEmpty', 'legalDirError', 'legalDirAdminBar'].forEach((id) => {
    const el = makeElement('div');
    el.id = id;
    registry[id] = el;
  });
  global.document = {
    createElement: (tag) => makeElement(tag),
    getElementById: (id) => registry[id] || null
  };
  global.__opened = [];
  global.open = function (url) { global.__opened.push(url); };
  global.fetch = function () {
    return Promise.resolve({ ok: true, json: () => Promise.resolve(datasetJson) });
  };
  // IMPORTANT: legal-directories.js's module wrapper resolves its
  // internal `global` reference via
  // `typeof window !== 'undefined' ? window : global` — a bare
  // `window` lookup in Node resolves through globalThis.window. So
  // `global.window` must be THE SAME OBJECT as `global` itself, not a
  // separate stub — otherwise the module ends up looking up
  // document/fetch/DirectoryModel/etc. on a different object than the
  // one this function just stubbed them onto.
  global._listeners = { popstate: [] }; // reset per-check — a fresh module below registers its own listener
  if (typeof global.addEventListener !== 'function') {
    global.addEventListener = function (evt, fn) { (global._listeners[evt] = global._listeners[evt] || []).push(fn); };
  }
  global.window = global;
  const historyStub = makeHistoryStub(global);
  global.history = historyStub;
  delete global.HossamSession;
  delete global.HossamPermissionService;
  return { registry, historyStub };
}

let passed = 0;
let failed = 0;
const log = [];

function check(label, fn) {
  return fn().then(() => {
    passed++;
    log.push('PASS — ' + label);
  }).catch((e) => {
    failed++;
    log.push('FAIL — ' + label + '  =>  ' + (e && e.stack ? e.stack.split('\n').slice(0,3).join(' | ') : e));
  });
}

function flush() { return new Promise((resolve) => setTimeout(resolve, 0)); }

async function main() {
  const datasetPath = path.join(__dirname, '..', 'data', 'directories', 'legal-directories.json');
  const realDataset = JSON.parse(fs.readFileSync(datasetPath, 'utf8'));

  function freshModule() {
    [
      path.join(__dirname, '..', 'modules', 'legal-directories.js'),
      path.join(__dirname, '..', 'modules', 'legal-directories-admin.js'),
      path.join(__dirname, '..', 'utils', 'DirectoryModel.js'),
      path.join(__dirname, '..', 'utils', 'DirectoryRenderer.js'),
      path.join(__dirname, '..', 'utils', 'DirectoryValidation.js'),
      path.join(__dirname, '..', 'utils', 'DirectoryPublisher.js')
    ].forEach((p) => { delete require.cache[require.resolve(p)]; });
    require(path.join(__dirname, '..', 'utils', 'DirectoryModel.js'));
    require(path.join(__dirname, '..', 'utils', 'DirectoryRenderer.js'));
    require(path.join(__dirname, '..', 'utils', 'DirectoryValidation.js'));
    require(path.join(__dirname, '..', 'utils', 'DirectoryPublisher.js'));
    require(path.join(__dirname, '..', 'modules', 'legal-directories-admin.js'));
    return require(path.join(__dirname, '..', 'modules', 'legal-directories.js'));
  }

  function currentCrumbTitles(registry) {
    return registry.legalDirBreadcrumb.children
      .filter((c) => c.tagName === 'BUTTON')
      .map((c) => c.textContent);
  }

  // ---- 1. Drilling in pushes one real history entry per level ----
  await check('drilling into a directory pushes exactly one history entry', async () => {
    const { registry, historyStub } = installStubs(global, realDataset);
    const mod = freshModule();
    mod.renderLegalDirectories();
    await flush(); await flush();
    // Simulate what js/core/shell/NavigationManager.js's onNavigate()
    // already does in the real app: push ONE history entry for the page
    // itself (depth 0 / root) the moment the user navigates to it.
    historyStub.pushState({ page: 'legalDirectories' }, '', '#legalDirectories');
    const before = historyStub._entryCount();
    registry.legalDirGrid.children[0].click(); // open first directory
    assert.strictEqual(historyStub._entryCount(), before + 1);
    assert.strictEqual(mod._stackDepthForTests(), 1);
  });

  await check('drilling into a nested folder pushes a second history entry', async () => {
    const { registry, historyStub } = installStubs(global, realDataset);
    const mod = freshModule();
    mod.renderLegalDirectories();
    await flush(); await flush();
    // Simulate what js/core/shell/NavigationManager.js's onNavigate()
    // already does in the real app: push ONE history entry for the page
    // itself (depth 0 / root) the moment the user navigates to it.
    historyStub.pushState({ page: 'legalDirectories' }, '', '#legalDirectories');
    registry.legalDirGrid.children[0].click(); // into first directory
    const beforeFolder = historyStub._entryCount();
    const folderCard = registry.legalDirGrid.children.find((c) => c.dataset.nodeType === 'folder');
    assert.ok(folderCard, 'expected a folder in the demo dataset at this level');
    folderCard.click();
    assert.strictEqual(historyStub._entryCount(), beforeFolder + 1);
    assert.strictEqual(mod._stackDepthForTests(), 2);
  });

  // ---- 2. THE BUG: pressing Back must go up ONE tree level, not exit the page ----
  await check('BUG FIX: pressing Back once from 2 levels deep goes up to 1 level (not out of the page)', async () => {
    const { registry, historyStub } = installStubs(global, realDataset);
    const mod = freshModule();
    mod.renderLegalDirectories();
    await flush(); await flush();
    // Simulate what js/core/shell/NavigationManager.js's onNavigate()
    // already does in the real app: push ONE history entry for the page
    // itself (depth 0 / root) the moment the user navigates to it.
    historyStub.pushState({ page: 'legalDirectories' }, '', '#legalDirectories');
    registry.legalDirGrid.children[0].click();
    const folderCard = registry.legalDirGrid.children.find((c) => c.dataset.nodeType === 'folder');
    folderCard.click();
    assert.strictEqual(mod._stackDepthForTests(), 2);

    historyStub.go(-1); // simulate pressing the Android/browser Back button once

    assert.strictEqual(mod._stackDepthForTests(), 1); // up one level — this is the bug that was reported
    assert.strictEqual(currentCrumbTitles(registry).length, 2); // "الأدلة القانونية" + the directory
  });

  await check('pressing Back twice from 2 levels deep returns to the root directory list (still on the page)', async () => {
    const { registry, historyStub } = installStubs(global, realDataset);
    const mod = freshModule();
    mod.renderLegalDirectories();
    await flush(); await flush();
    // Simulate what js/core/shell/NavigationManager.js's onNavigate()
    // already does in the real app: push ONE history entry for the page
    // itself (depth 0 / root) the moment the user navigates to it.
    historyStub.pushState({ page: 'legalDirectories' }, '', '#legalDirectories');
    registry.legalDirGrid.children[0].click();
    const folderCard = registry.legalDirGrid.children.find((c) => c.dataset.nodeType === 'folder');
    folderCard.click();

    historyStub.go(-1);
    historyStub.go(-1);

    assert.strictEqual(mod._stackDepthForTests(), 0);
    assert.strictEqual(currentCrumbTitles(registry).length, 1); // just "الأدلة القانونية"
    const enabledCount = realDataset.directories.filter((d) => d.enabled !== false).length;
    assert.strictEqual(registry.legalDirGrid.children.length, enabledCount);
  });

  await check('pressing Back a third time (past this page\'s own root entry) resets internal depth without crashing', async () => {
    const { registry, historyStub } = installStubs(global, realDataset);
    const mod = freshModule();
    mod.renderLegalDirectories();
    await flush(); await flush();
    // Simulate what js/core/shell/NavigationManager.js's onNavigate()
    // already does in the real app: push ONE history entry for the page
    // itself (depth 0 / root) the moment the user navigates to it.
    historyStub.pushState({ page: 'legalDirectories' }, '', '#legalDirectories');
    registry.legalDirGrid.children[0].click();
    const folderCard = registry.legalDirGrid.children.find((c) => c.dataset.nodeType === 'folder');
    folderCard.click();

    assert.doesNotThrow(() => {
      historyStub.go(-1);
      historyStub.go(-1);
      historyStub.go(-1); // now landing on the pre-page {state:null} entry (e.g. dashboard)
    });
    assert.strictEqual(mod._stackDepthForTests(), 0);
  });

  // ---- 3. Breadcrumb clicks drive the SAME history stack (no divergence) ----
  await check('clicking the root breadcrumb from 2 levels deep uses history.go(-2), matching pressing Back twice', async () => {
    const { registry, historyStub } = installStubs(global, realDataset);
    const mod = freshModule();
    mod.renderLegalDirectories();
    await flush(); await flush();
    // Simulate what js/core/shell/NavigationManager.js's onNavigate()
    // already does in the real app: push ONE history entry for the page
    // itself (depth 0 / root) the moment the user navigates to it.
    historyStub.pushState({ page: 'legalDirectories' }, '', '#legalDirectories');
    registry.legalDirGrid.children[0].click();
    const folderCard = registry.legalDirGrid.children.find((c) => c.dataset.nodeType === 'folder');
    folderCard.click();
    const pointerBefore = historyStub._pointer();

    const rootCrumb = registry.legalDirBreadcrumb.children.find((c) => c.tagName === 'BUTTON');
    rootCrumb.click();

    assert.strictEqual(historyStub._pointer(), pointerBefore - 2);
    assert.strictEqual(mod._stackDepthForTests(), 0);
  });

  await check('clicking a middle breadcrumb entry goes back exactly the right number of steps', async () => {
    const { registry, historyStub } = installStubs(global, realDataset);
    const mod = freshModule();
    mod.renderLegalDirectories();
    await flush(); await flush();
    // Simulate what js/core/shell/NavigationManager.js's onNavigate()
    // already does in the real app: push ONE history entry for the page
    // itself (depth 0 / root) the moment the user navigates to it.
    historyStub.pushState({ page: 'legalDirectories' }, '', '#legalDirectories');
    registry.legalDirGrid.children[0].click();
    const folderCard = registry.legalDirGrid.children.find((c) => c.dataset.nodeType === 'folder');
    folderCard.click();
    assert.strictEqual(mod._stackDepthForTests(), 2);

    const crumbs = registry.legalDirBreadcrumb.children.filter((c) => c.tagName === 'BUTTON');
    crumbs[1].click(); // the directory-level crumb (index 1) -> should go back exactly 1 step

    assert.strictEqual(mod._stackDepthForTests(), 1);
  });

  // ---- 4. Forward-cache limitation is handled safely, not with a crash ----
  await check('simulated Forward beyond what _stack still holds clamps safely instead of throwing', async () => {
    const { registry, historyStub } = installStubs(global, realDataset);
    const mod = freshModule();
    mod.renderLegalDirectories();
    await flush(); await flush();
    // Simulate what js/core/shell/NavigationManager.js's onNavigate()
    // already does in the real app: push ONE history entry for the page
    // itself (depth 0 / root) the moment the user navigates to it.
    historyStub.pushState({ page: 'legalDirectories' }, '', '#legalDirectories');
    registry.legalDirGrid.children[0].click();
    const folderCard = registry.legalDirGrid.children.find((c) => c.dataset.nodeType === 'folder');
    folderCard.click();
    historyStub.go(-2); // back to root, _stack is now []
    assert.doesNotThrow(() => {
      mod._simulatePopStateForTests({ state: { page: 'legalDirectories', legalDirDepth: 2 } }); // simulate Forward wanting depth 2 back
    });
    assert.ok(mod._stackDepthForTests() <= 2);
  });

  console.log(log.join('\n'));
  console.log('\n' + passed + ' passed, ' + failed + ' failed.');
  if (failed > 0) process.exit(1);
}

main();
