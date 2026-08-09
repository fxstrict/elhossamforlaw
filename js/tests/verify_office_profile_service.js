'use strict';
// Lightweight, dependency-free smoke harness for js/office/OfficeProfileService.js.
// Stubs settingsRepository / settingsRepositoryReadyPromise / document / ApiService
// the same way the file's own guards expect (typeof checks), without requiring
// jsdom or the real IndexedDB adapter chain.

let failures = 0;
function assert(cond, msg) {
  if (!cond) { failures++; console.error('FAIL:', msg); }
  else console.log('PASS:', msg);
}

// --- in-memory settingsRepository stub ---
const store = {};
global.settingsRepository = {
  isReady: () => true,
  get: (k) => store[k],
  set: (k, v) => { store[k] = v; return Promise.resolve(); }
};
global.settingsRepositoryReadyPromise = Promise.resolve();

// --- document stub (only getElementById is used by this file) ---
const domStore = {};
global.document = {
  getElementById: (id) => domStore[id] || (domStore[id] = { textContent: '' })
};

// --- no ApiService / no API_URL -> sync push/pull must be silent no-ops ---
global.window = global;

const path = require('path');
require(path.join(__dirname, '..', 'office', 'OfficeProfileService.js'));
const svc = global.OfficeProfileService;

(async () => {
  assert(typeof svc === 'object', 'window.OfficeProfileService is defined');

  // 1. Before anything saved: not configured, display falls back to defaults
  assert(svc.isConfigured() === false, 'isConfigured() is false before any save');
  const disp0 = svc.getDisplayProfile();
  assert(disp0.officeName === svc.DEFAULTS.officeName, 'getDisplayProfile() falls back to default office name');
  assert(disp0.lawyerName === svc.DEFAULTS.lawyerName, 'getDisplayProfile() falls back to default lawyer name');

  // 2. saveProfile() validation: missing required fields must throw
  let threw = false;
  try { await svc.saveProfile({ officeName: '', lawyerName: '' }); } catch (e) { threw = true; }
  assert(threw, 'saveProfile() rejects when officeName/lawyerName are empty');

  // 3. saveProfile() happy path
  const saved = await svc.saveProfile({
    officeName: '  مكتب تجربة  ',
    lawyerName: '  المحامي أحمد  ',
    address: 'القاهرة',
    branches: '',
    phones: '01000000000',
    whatsapp: '01000000000'
  });
  assert(saved.officeName === 'مكتب تجربة', 'saveProfile() trims officeName');
  assert(store.officeProfile !== undefined, 'saveProfile() persisted into settingsRepository under "officeProfile"');

  // 4. isConfigured() now true, getProfile()/getDisplayProfile() reflect saved data
  assert(svc.isConfigured() === true, 'isConfigured() is true after a valid save');
  const p = svc.getProfile();
  assert(p.officeName === 'مكتب تجربة', 'getProfile() returns saved officeName');
  assert(p.lawyerName === 'المحامي أحمد', 'getProfile() returns saved lawyerName');

  // 5. applyToUI() writes into the sidebar DOM stub ids
  assert(domStore.sidebarOfficeName.textContent === 'مكتب تجربة', 'applyToUI() updated #sidebarOfficeName');
  assert(domStore.sidebarLawyerName.textContent === 'المحامي أحمد', 'applyToUI() updated #sidebarLawyerName');

  // 6. Re-parsing survives a fresh JSON round-trip (simulates reload)
  const raw = store.officeProfile;
  assert(typeof raw === 'string' && JSON.parse(raw).officeName === 'مكتب تجربة', 'stored value is valid round-trippable JSON');

  console.log('\n' + (failures === 0 ? 'ALL PASS' : failures + ' FAILURE(S)'));
  process.exit(failures === 0 ? 0 : 1);
})();
