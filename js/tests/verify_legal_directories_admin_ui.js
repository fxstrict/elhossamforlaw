/**
 * verify_legal_directories_admin_ui.js
 * Standalone Node harness for the Stage-3 admin-mode wiring inside
 * js/modules/legal-directories.js (admin bar, per-card toolbars,
 * RBAC gating). Uses the same hand-rolled DOM/fetch stub convention
 * as verify_legal_directories_module.js — no jsdom.
 * Run: node js/tests/verify_legal_directories_admin_ui.js
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
    disabled: false,
    value: '',
    href: '', download: '',
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
  global.confirm = function () { return true; };
  global.fetch = function () {
    return Promise.resolve({ ok: true, json: () => Promise.resolve(datasetJson) });
  };
  // No Blob/URL in this stub -> download click is a safe no-op branch
  // (legal-directories.js checks typeof global.Blob === 'function' first).
  delete global.HossamSession;
  delete global.HossamPermissionService;
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
    log.push('FAIL — ' + label + '  =>  ' + (e && e.stack ? e.stack.split('\n')[0] : e));
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
      path.join(__dirname, '..', 'utils', 'DirectoryValidation.js')
    ].forEach((p) => { delete require.cache[require.resolve(p)]; });
    require(path.join(__dirname, '..', 'utils', 'DirectoryModel.js'));
    require(path.join(__dirname, '..', 'utils', 'DirectoryRenderer.js'));
    require(path.join(__dirname, '..', 'utils', 'DirectoryValidation.js'));
    require(path.join(__dirname, '..', 'modules', 'legal-directories-admin.js'));
    return require(path.join(__dirname, '..', 'modules', 'legal-directories.js'));
  }

  function findButtonByText(container, text) {
    return container.children.find((c) => c.tagName === 'BUTTON' && c.textContent.indexOf(text) !== -1);
  }

  // ---- 1. Fail-open: no RBAC wired at all -> admin toggle is visible ----
  await check('with no RBAC wired (fail-open), the admin toggle button renders', async () => {
    const registry = installStubs(global, realDataset);
    const mod = freshModule();
    mod.renderLegalDirectories();
    await flush(); await flush();
    const toggle = findButtonByText(registry.legalDirAdminBar, 'تفعيل وضع الإدارة');
    assert.ok(toggle, 'expected the admin toggle button to be present');
  });

  // ---- 2. Fail-closed when RBAC explicitly denies ----
  await check('with RBAC wired AND permission denied, the admin bar renders nothing', async () => {
    const registry = installStubs(global, realDataset);
    global.HossamSession = { getCurrentUser: () => ({ اسم_المستخدم: 'u1' }) };
    global.HossamPermissionService = { can: () => false };
    const mod = freshModule();
    mod.renderLegalDirectories();
    await flush(); await flush();
    assert.strictEqual(registry.legalDirAdminBar.children.length, 0);
  });

  // ---- 3. Permission granted -> toggle works ----
  await check('with RBAC wired AND permission granted, toggling admin mode enters admin mode', async () => {
    installStubs(global, realDataset);
    global.HossamSession = { getCurrentUser: () => ({ اسم_المستخدم: 'u1' }) };
    global.HossamPermissionService = { can: () => true };
    const mod = freshModule();
    mod.renderLegalDirectories();
    await flush(); await flush();
    mod._toggleAdminModeForTests();
    assert.strictEqual(mod._isAdminModeForTests(), true);
  });

  // ---- 4. Admin bar shows validation status + quick-add form once in admin mode ----
  await check('admin mode shows a valid-draft status message and a quick-add form', async () => {
    const registry = installStubs(global, realDataset);
    const mod = freshModule();
    mod.renderLegalDirectories();
    await flush(); await flush();
    mod._toggleAdminModeForTests();
    const statusEl = registry.legalDirAdminBar.children.find((c) => c.className === 'legal-dir-admin-status');
    assert.ok(statusEl);
    assert.ok(statusEl.textContent.indexOf('صالحة') !== -1);
    const form = registry.legalDirAdminBar.children.find((c) => c.className === 'legal-dir-admin-form');
    assert.ok(form, 'expected the quick-add form to render');
  });

  // ---- 5. Adding a new Directory via the root quick-add form ----
  await check('filling the root quick-add form and clicking save adds a new Directory to the draft', async () => {
    const registry = installStubs(global, realDataset);
    const mod = freshModule();
    mod.renderLegalDirectories();
    await flush(); await flush();
    mod._toggleAdminModeForTests();
    const form = registry.legalDirAdminBar.children.find((c) => c.className === 'legal-dir-admin-form');
    const [titleInput] = form.children;
    titleInput.value = 'دليل تجريبي جديد';
    const saveBtn = form.children.find((c) => c.tagName === 'BUTTON');
    saveBtn.click();
    const Admin = require(path.join(__dirname, '..', 'modules', 'legal-directories-admin.js'));
    const newDir = Admin.getDraft().directories.find((d) => d.title === 'دليل تجريبي جديد');
    assert.ok(newDir);
  });

  // ---- 6. Per-card admin toolbar: toggle enabled ----
  await check('clicking the disable button on a directory card toggles its enabled flag in the draft', async () => {
    const registry = installStubs(global, realDataset);
    const mod = freshModule();
    mod.renderLegalDirectories();
    await flush(); await flush();
    mod._toggleAdminModeForTests();
    const firstWrap = registry.legalDirGrid.children[0];
    assert.strictEqual(firstWrap.className, 'legal-dir-card-wrap');
    const toolbar = firstWrap.children[1];
    const disableBtn = toolbar.children.find((c) => c.textContent.indexOf('تعطيل') !== -1);
    disableBtn.click();
    const Admin = require(path.join(__dirname, '..', 'modules', 'legal-directories-admin.js'));
    const firstId = realDataset.directories.filter((d) => d.enabled !== false)
      .sort((a, b) => (a.order || 0) - (b.order || 0))[0].id;
    assert.strictEqual(Admin.findDirectory(firstId).enabled, false);
  });

  // ---- 7. Disabled items are still visible (not hidden) while in admin mode ----
  await check('a disabled directory remains visible in the grid while in admin mode (so it can be re-enabled)', async () => {
    const registry = installStubs(global, realDataset);
    const mod = freshModule();
    mod.renderLegalDirectories();
    await flush(); await flush();
    mod._toggleAdminModeForTests();
    const countBefore = registry.legalDirGrid.children.length;
    const toolbar = registry.legalDirGrid.children[0].children[1];
    toolbar.children.find((c) => c.textContent.indexOf('تعطيل') !== -1).click();
    assert.strictEqual(registry.legalDirGrid.children.length, countBefore); // still shown, not removed
  });

  // ---- 8. Deleting a directory removes it from the draft and the grid ----
  await check('clicking delete on a directory card removes it from the draft', async () => {
    const registry = installStubs(global, realDataset);
    const mod = freshModule();
    mod.renderLegalDirectories();
    await flush(); await flush();
    mod._toggleAdminModeForTests();
    const countBefore = registry.legalDirGrid.children.length;
    const toolbar = registry.legalDirGrid.children[0].children[1];
    toolbar.children.find((c) => c.textContent.indexOf('حذف') !== -1).click();
    assert.strictEqual(registry.legalDirGrid.children.length, countBefore - 1);
  });

  // ---- 9. Turning admin mode off returns to the read-only live dataset (no draft edits leak) ----
  await check('turning admin mode off shows the original (unedited) directory count again', async () => {
    const registry = installStubs(global, realDataset);
    const mod = freshModule();
    mod.renderLegalDirectories();
    await flush(); await flush();
    const liveCount = registry.legalDirGrid.children.length;
    mod._toggleAdminModeForTests();
    registry.legalDirGrid.children[0].children[1].children
      .find((c) => c.textContent.indexOf('حذف') !== -1).click();
    mod._toggleAdminModeForTests(); // back off
    assert.strictEqual(registry.legalDirGrid.children.length, liveCount);
  });

  // ---- 10. Download button is disabled when the draft is invalid ----
  // (Note: a dataset that's invalid at LOAD time never becomes the live
  // dataset at all — see loadDataset()'s own validation gate — so to
  // exercise the draft-time validation gate we make the DRAFT invalid
  // via the admin UI itself: add a "link" node and leave its URL empty.)
  await check('the download button is disabled while the draft fails validation', async () => {
    const registry = installStubs(global, realDataset);
    const mod = freshModule();
    mod.renderLegalDirectories();
    await flush(); await flush();
    mod._toggleAdminModeForTests();
    // Drill into the first directory so the quick-add form is Node-level (has a type/url field).
    registry.legalDirGrid.children[0].children[0].click();
    const form = registry.legalDirAdminBar.children.find((c) => c.className === 'legal-dir-admin-form');
    const [titleInput, , typeSelect, urlInput] = form.children;
    titleInput.value = 'رابط بلا عنوان';
    typeSelect.value = 'link';
    urlInput.value = ''; // deliberately invalid
    form.children.find((c) => c.tagName === 'BUTTON').click();
    const downloadBtn = findButtonByText(registry.legalDirAdminBar, 'تنزيل');
    assert.strictEqual(downloadBtn.disabled, true);
  });

  await check('the download button is enabled once the draft is valid', async () => {
    const registry = installStubs(global, realDataset);
    const mod = freshModule();
    mod.renderLegalDirectories();
    await flush(); await flush();
    mod._toggleAdminModeForTests();
    const downloadBtn = findButtonByText(registry.legalDirAdminBar, 'تنزيل');
    assert.strictEqual(downloadBtn.disabled, false);
  });

  console.log(log.join('\n'));
  console.log('\n' + passed + ' passed, ' + failed + ' failed.');
  if (failed > 0) process.exit(1);
}

main();
