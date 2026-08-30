/**
 * verify_legal_directories_module.js
 * Standalone Node harness for js/modules/legal-directories.js
 * (Legal Directories — Generic UI, Stage 2).
 * Run: node js/tests/verify_legal_directories_module.js
 * No browser required — hand-rolled DOM/fetch stubs (same convention
 * as verify_directory_renderer.js / js/tests/_shared/browserStubs.js).
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');

// ---- Minimal DOM stub ----

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

function installStubs(global, datasetJson, fetchShouldFail, invalidJson) {
  const registry = {};
  ['legalDirBreadcrumb', 'legalDirGrid', 'legalDirEmpty', 'legalDirError'].forEach((id) => {
    const el = makeElement('div');
    el.id = id;
    registry[id] = el;
  });
  global.document = {
    createElement: (tag) => makeElement(tag),
    getElementById: (id) => registry[id] || null
  };
  global.__opened = [];
  global.open = function (url, target) { global.__opened.push({ url: url, target: target }); };
  global.fetch = function () {
    if (fetchShouldFail) return Promise.resolve({ ok: false, status: 404 });
    return Promise.resolve({
      ok: true,
      json: () => Promise.resolve(invalidJson || datasetJson)
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

  function freshModule(registryOverrides) {
    // Fresh require cache each time so module-level in-memory state
    // (_dataset/_stack) doesn't leak between checks.
    delete require.cache[require.resolve(path.join(__dirname, '..', 'modules', 'legal-directories.js'))];
    delete require.cache[require.resolve(path.join(__dirname, '..', 'utils', 'DirectoryModel.js'))];
    delete require.cache[require.resolve(path.join(__dirname, '..', 'utils', 'DirectoryRenderer.js'))];
    delete require.cache[require.resolve(path.join(__dirname, '..', 'utils', 'DirectoryValidation.js'))];
    require(path.join(__dirname, '..', 'utils', 'DirectoryModel.js'));
    require(path.join(__dirname, '..', 'utils', 'DirectoryRenderer.js'));
    require(path.join(__dirname, '..', 'utils', 'DirectoryValidation.js'));
    return require(path.join(__dirname, '..', 'modules', 'legal-directories.js'));
  }

  function flush() { return new Promise((resolve) => setTimeout(resolve, 0)); }

  await check('renderLegalDirectories() renders the root level (one card per enabled directory)', async () => {
    const registry = installStubs(global, realDataset, false);
    const mod = freshModule();
    mod.renderLegalDirectories();
    await flush(); await flush();
    const enabledCount = realDataset.directories.filter((d) => d.enabled !== false).length;
    assert.strictEqual(registry.legalDirGrid.children.length, enabledCount);
  });

  await check('root breadcrumb shows exactly one crumb ("الأدلة القانونية"), marked current', async () => {
    const registry = installStubs(global, realDataset, false);
    const mod = freshModule();
    mod.renderLegalDirectories();
    await flush(); await flush();
    assert.strictEqual(registry.legalDirBreadcrumb.children.length, 1);
    assert.strictEqual(registry.legalDirBreadcrumb.children[0].getAttribute('aria-current'), 'page');
  });

  await check('clicking a directory card drills in and adds a breadcrumb entry', async () => {
    const registry = installStubs(global, realDataset, false);
    const mod = freshModule();
    mod.renderLegalDirectories();
    await flush(); await flush();
    registry.legalDirGrid.children[0].click(); // open first directory
    // breadcrumb now: root + directory = 2 entries (root is non-button-count via children incl separators — count only aria items)
    const crumbButtons = registry.legalDirBreadcrumb.children.filter((c) => c.tagName === 'BUTTON');
    assert.strictEqual(crumbButtons.length, 2);
    assert.strictEqual(crumbButtons[1].getAttribute('aria-current'), 'page');
  });

  await check('clicking the root breadcrumb after drilling in returns to the directory list', async () => {
    const registry = installStubs(global, realDataset, false);
    const mod = freshModule();
    mod.renderLegalDirectories();
    await flush(); await flush();
    registry.legalDirGrid.children[0].click();
    const rootCrumb = registry.legalDirBreadcrumb.children.find((c) => c.tagName === 'BUTTON');
    rootCrumb.click();
    const enabledCount = realDataset.directories.filter((d) => d.enabled !== false).length;
    assert.strictEqual(registry.legalDirGrid.children.length, enabledCount);
  });

  await check('drilling into a nested folder then a link card opens the url (no crash mid-tree)', async () => {
    const registry = installStubs(global, realDataset, false);
    global.__opened = [];
    const mod = freshModule();
    mod.renderLegalDirectories();
    await flush(); await flush();
    registry.legalDirGrid.children[0].click(); // into "courts" (first enabled directory)
    // find a folder card among current grid (courts dataset has a nested folder)
    const folderCard = registry.legalDirGrid.children.find((c) => c.dataset.nodeType === 'folder');
    assert.ok(folderCard, 'expected at least one folder card at this level of the demo dataset');
    folderCard.click();
    const linkCard = registry.legalDirGrid.children.find((c) => c.dataset.nodeType === 'link');
    assert.ok(linkCard, 'expected at least one link card inside the nested folder');
    linkCard.click();
    assert.strictEqual(global.__opened.length, 1);
  });

  await check('fetch failure shows the error box, not a thrown exception', async () => {
    const registry = installStubs(global, realDataset, true);
    const mod = freshModule();
    assert.doesNotThrow(() => mod.renderLegalDirectories());
    await flush(); await flush();
    assert.strictEqual(registry.legalDirError.style.display, '');
  });

  await check('an invalid dataset (fails DirectoryValidation) also degrades to the error box, not a crash', async () => {
    const invalid = { directories: [{ id: 'd1', title: 'D', items: [{ id: 'n1', title: 'N', type: 'link' }] }] }; // missing url
    const registry = installStubs(global, realDataset, false, invalid);
    const mod = freshModule();
    assert.doesNotThrow(() => mod.renderLegalDirectories());
    await flush(); await flush();
    assert.strictEqual(registry.legalDirError.style.display, '');
  });

  console.log(log.join('\n'));
  console.log('\n' + passed + ' passed, ' + failed + ' failed.');
  if (failed > 0) process.exit(1);
}

main();
