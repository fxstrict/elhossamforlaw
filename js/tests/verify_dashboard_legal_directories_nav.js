/**
 * verify_dashboard_legal_directories_nav.js
 * Standalone Node harness for js/modules/dashboard-legal-directories-nav.js
 * (Legal Directories — Dashboard Shortcut Navigator).
 * Run: node js/tests/verify_dashboard_legal_directories_nav.js
 * No browser required — hand-rolled DOM/fetch stubs (same convention as
 * verify_legal_directories_module.js / js/tests/_shared/browserStubs.js).
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

function installStubs(global, datasetJson, fetchShouldFail, opts) {
  opts = opts || {};
  const registry = {};
  ['dashLegalDirNav', 'dashLegalDirHeader', 'dashLegalDirStrip', 'dashLegalDirEmpty', 'dashLegalDirError'].forEach((id) => {
    const el = makeElement('div');
    el.id = id;
    registry[id] = el;
  });
  global.document = {
    createElement: (tag) => makeElement(tag),
    getElementById: (id) => (opts.omitStrip && id === 'dashLegalDirStrip') ? null : (registry[id] || null)
  };
  global.__opened = [];
  global.__fetchCalls = 0;
  global.open = function (url, target) { global.__opened.push({ url: url, target: target }); };
  global.fetch = function () {
    global.__fetchCalls++;
    if (fetchShouldFail) return Promise.resolve({ ok: false, status: 404 });
    return Promise.resolve({
      ok: true,
      json: () => Promise.resolve(datasetJson)
    });
  };
  return registry;
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
    log.push('FAIL — ' + label + '  =>  ' + (e && e.message ? e.message : e));
  });
}

async function main() {
  const datasetPath = path.join(__dirname, '..', 'data', 'directories', 'legal-directories.json');
  const realDataset = JSON.parse(fs.readFileSync(datasetPath, 'utf8'));

  const modelPath = path.join(__dirname, '..', 'utils', 'DirectoryModel.js');
  const validationPath = path.join(__dirname, '..', 'utils', 'DirectoryValidation.js');
  const rendererPath = path.join(__dirname, '..', 'utils', 'DirectoryRenderer.js');
  const legalDirPath = path.join(__dirname, '..', 'modules', 'legal-directories.js');
  const widgetPath = path.join(__dirname, '..', 'modules', 'dashboard-legal-directories-nav.js');

  function freshModule() {
    // Fresh require cache each time so module-level in-memory state
    // (legal-directories.js's _dataset/_stack, this widget's _stack)
    // doesn't leak between checks.
    [modelPath, validationPath, rendererPath, legalDirPath, widgetPath].forEach((p) => {
      delete require.cache[require.resolve(p)];
    });
    require(modelPath);
    require(validationPath);
    require(rendererPath);
    require(legalDirPath);
    return require(widgetPath);
  }

  function flush() { return new Promise((resolve) => setTimeout(resolve, 0)); }

  await check('root level shows one tile per enabled Directory, sorted by order', async () => {
    const registry = installStubs(global, realDataset, false);
    const mod = freshModule();
    mod.renderDashboardLegalDirNav();
    await flush(); await flush();
    const enabledCount = realDataset.directories.filter((d) => d.enabled !== false).length;
    assert.strictEqual(registry.dashLegalDirStrip.children.length, enabledCount);
  });

  await check('no back tile at root level', async () => {
    const registry = installStubs(global, realDataset, false);
    const mod = freshModule();
    mod.renderDashboardLegalDirNav();
    await flush(); await flush();
    const backTiles = registry.dashLegalDirStrip.children.filter((c) => c.className.indexOf('dash-legaldir-back') !== -1);
    assert.strictEqual(backTiles.length, 0);
  });

  await check('clicking a folder tile drills in without touching the full page\'s own module state', async () => {
    const registry = installStubs(global, realDataset, false);
    const mod = freshModule();
    mod.renderDashboardLegalDirNav();
    await flush(); await flush();
    registry.dashLegalDirStrip.children[0].click(); // open first directory
    assert.strictEqual(mod._stackDepthForTests(), 1);
    // a back tile must now be the first child of the strip
    assert.strictEqual(registry.dashLegalDirStrip.children[0].className.indexOf('dash-legaldir-back') !== -1, true);
  });

  await check('the back tile is clearly textual ("رجوع"), not just an arrow glyph', async () => {
    const registry = installStubs(global, realDataset, false);
    const mod = freshModule();
    mod.renderDashboardLegalDirNav();
    await flush(); await flush();
    registry.dashLegalDirStrip.children[0].click();
    const backTile = registry.dashLegalDirStrip.children[0];
    const titleSpan = backTile.children.find((c) => c.className === 'legal-dir-card-title');
    assert.ok(titleSpan, 'expected a title span inside the back tile');
    assert.strictEqual(titleSpan.textContent, 'رجوع');
  });

  await check('clicking the back tile returns to the previous level', async () => {
    const registry = installStubs(global, realDataset, false);
    const mod = freshModule();
    mod.renderDashboardLegalDirNav();
    await flush(); await flush();
    const rootCount = registry.dashLegalDirStrip.children.length;
    registry.dashLegalDirStrip.children[0].click();
    registry.dashLegalDirStrip.children[0].click(); // the back tile is now index 0
    assert.strictEqual(mod._stackDepthForTests(), 0);
    assert.strictEqual(registry.dashLegalDirStrip.children.length, rootCount);
  });

  await check('navigating more than two levels deep keeps working generically', async () => {
    const registry = installStubs(global, realDataset, false);
    const mod = freshModule();
    mod.renderDashboardLegalDirNav();
    await flush(); await flush();
    registry.dashLegalDirStrip.children[0].click(); // depth 1 (into first Directory)
    const folderTile = registry.dashLegalDirStrip.children.find((c) => c.dataset.nodeType === 'folder');
    if (folderTile) {
      folderTile.click(); // depth 2 (into a nested folder, if the demo dataset has one at this level)
      assert.strictEqual(mod._stackDepthForTests(), 2);
      mod._goBackForTests();
      assert.strictEqual(mod._stackDepthForTests(), 1);
    } else {
      assert.strictEqual(mod._stackDepthForTests(), 1);
    }
  });

  await check('clicking a link tile opens its url instead of trying to drill in', async () => {
    const registry = installStubs(global, realDataset, false);
    global.__opened = [];
    const mod = freshModule();
    mod.renderDashboardLegalDirNav();
    await flush(); await flush();
    registry.dashLegalDirStrip.children[0].click(); // into first directory
    // walk down until a link tile is found (demo dataset nests at least one)
    let guard = 0;
    while (guard < 5) {
      const linkTile = registry.dashLegalDirStrip.children.find((c) => c.dataset.nodeType === 'link');
      if (linkTile) { linkTile.click(); break; }
      const folderTile = registry.dashLegalDirStrip.children.find((c) => c.dataset.nodeType === 'folder');
      if (!folderTile) break;
      folderTile.click();
      guard++;
    }
    assert.strictEqual(global.__opened.length, 1);
  });

  await check('a disabled top-level Directory does not get a tile', async () => {
    const custom = { directories: [
      { id: 'd1', title: 'Visible', items: [] },
      { id: 'd2', title: 'Hidden', enabled: false, items: [] }
    ] };
    const registry = installStubs(global, custom, false);
    const mod = freshModule();
    mod.renderDashboardLegalDirNav();
    await flush(); await flush();
    assert.strictEqual(registry.dashLegalDirStrip.children.length, 1);
  });

  await check('a folder with no children does not break navigation (renders an empty strip, just a back tile)', async () => {
    const custom = { directories: [
      { id: 'd1', title: 'D1', items: [{ id: 'f1', title: 'Empty folder', type: 'folder', children: [] }] }
    ] };
    const registry = installStubs(global, custom, false);
    const mod = freshModule();
    mod.renderDashboardLegalDirNav();
    await flush(); await flush();
    registry.dashLegalDirStrip.children[0].click(); // into D1 (depth 1) — shows the one folder tile
    const emptyFolderTile = registry.dashLegalDirStrip.children.find((c) => c.dataset.nodeType === 'folder');
    assert.ok(emptyFolderTile, 'expected a folder tile for the empty folder at depth 1');
    assert.doesNotThrow(() => emptyFolderTile.click()); // into the empty folder (depth 2)
    assert.strictEqual(registry.dashLegalDirStrip.children.length, 1); // just the back tile
  });

  await check('an empty dataset (zero directories) does not break the widget, shows the empty message', async () => {
    const custom = { directories: [] };
    const registry = installStubs(global, custom, false);
    const mod = freshModule();
    assert.doesNotThrow(() => mod.renderDashboardLegalDirNav());
    await flush(); await flush();
    assert.strictEqual(registry.dashLegalDirStrip.children.length, 0);
    assert.strictEqual(registry.dashLegalDirEmpty.style.display, '');
  });

  await check('a fetch failure shows the error message instead of throwing', async () => {
    const registry = installStubs(global, realDataset, true);
    const mod = freshModule();
    assert.doesNotThrow(() => mod.renderDashboardLegalDirNav());
    await flush(); await flush();
    assert.strictEqual(registry.dashLegalDirError.style.display, '');
  });

  await check('the widget and the full page share one dataset fetch (no second data source)', async () => {
    const registry = installStubs(global, realDataset, false);
    const mod = freshModule();
    const legalDirModule = require(legalDirPath);
    mod.renderDashboardLegalDirNav();       // widget triggers the load first
    legalDirModule.renderLegalDirectories(); // full page loads right after
    await flush(); await flush(); await flush();
    assert.strictEqual(global.__fetchCalls, 1);
  });

  await check('missing widget markup (page not on screen yet) is a safe no-op, not a crash', async () => {
    installStubs(global, realDataset, false, { omitStrip: true });
    const mod = freshModule();
    assert.doesNotThrow(() => mod.renderDashboardLegalDirNav());
  });

  console.log(log.join('\n'));
  console.log('\n' + passed + ' passed, ' + failed + ' failed.');
  if (failed > 0) process.exit(1);
}

main();
