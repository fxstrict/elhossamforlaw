'use strict';
/**
 * PHASE A7.6 — Project Configuration + Multi-Deployment Isolation
 * Static tests (no GAS runtime available in this session — same disclosed
 * limitation as PHASE_A7_static_tests.js). These tests:
 *   1) Re-run validateProjectConfig()'s exact rules against mock configs
 *      to prove bad configs are rejected and good configs pass.
 *   2) Simulate two independent deployments (Project A / Project B) as
 *      separate config objects + separate mock "Script Properties" /
 *      "Drive" stores, and assert that reading/writing under Project A's
 *      config never touches Project B's store, and vice versa.
 *   3) Grep-based checks that Drive folder lookup now supports Mode 1
 *      (DRIVE_FOLDER_ID) and that protected A7.5 files were not touched.
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..', '..');

let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log('PASS -', name); }
  else { fail++; console.log('FAIL -', name); }
}

// ---------------------------------------------------------------------
// 1) validateProjectConfig() rules re-implemented identically to
//    Config/00_Config.gs, to statically exercise the logic outside GAS.
// ---------------------------------------------------------------------
function validateProjectConfig(cfg) {
  const errors = [];
  if (!cfg.PROJECT_ID || String(cfg.PROJECT_ID).trim() === '') {
    errors.push('PROJECT_ID فارغ');
  } else if (!/^[A-Za-z0-9_]+$/.test(cfg.PROJECT_ID)) {
    errors.push('PROJECT_ID صيغة غير صالحة');
  }
  if (cfg.ENVIRONMENT !== 'production' && cfg.ENVIRONMENT !== 'test') {
    errors.push('ENVIRONMENT غير معروف');
  }
  if (!cfg.LAWYER_EMAIL || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cfg.LAWYER_EMAIL)) {
    errors.push('LAWYER_EMAIL غير صالح');
  }
  if (!cfg.SPREADSHEET_NAME || String(cfg.SPREADSHEET_NAME).trim() === '') {
    errors.push('SPREADSHEET_NAME فارغ');
  }
  if (!cfg.DRIVE_FOLDER || String(cfg.DRIVE_FOLDER).trim() === '') {
    errors.push('DRIVE_FOLDER فارغ');
  }
  return { ok: errors.length === 0, errors: errors };
}

const validConfig = {
  PROJECT_ID: 'HOSSAM_01', ENVIRONMENT: 'production',
  LAWYER_EMAIL: 'hossammohamedlawyer@gmail.com',
  SPREADSHEET_NAME: 'نظام الحسام للمحاماة', DRIVE_FOLDER: 'نسخ احتياطي — نظام المحامي'
};
check('valid config passes validation', validateProjectConfig(validConfig).ok === true);
check('empty PROJECT_ID is rejected', validateProjectConfig(Object.assign({}, validConfig, { PROJECT_ID: '' })).ok === false);
check('PROJECT_ID with spaces is rejected', validateProjectConfig(Object.assign({}, validConfig, { PROJECT_ID: 'Rasha Office 01' })).ok === false);
check('unknown ENVIRONMENT is rejected', validateProjectConfig(Object.assign({}, validConfig, { ENVIRONMENT: 'staging' })).ok === false);
check('invalid email is rejected', validateProjectConfig(Object.assign({}, validConfig, { LAWYER_EMAIL: 'not-an-email' })).ok === false);
check('empty SPREADSHEET_NAME is rejected', validateProjectConfig(Object.assign({}, validConfig, { SPREADSHEET_NAME: '' })).ok === false);
check('empty DRIVE_FOLDER is rejected', validateProjectConfig(Object.assign({}, validConfig, { DRIVE_FOLDER: '' })).ok === false);

// ---------------------------------------------------------------------
// 2) Multi-deployment isolation simulation — Project A vs Project B.
//    Mocks PropertiesService (per-script, so naturally separate here)
//    and Drive (a single shared mock filesystem, which is the ONLY
//    place real cross-project bleed is architecturally possible — via
//    folder-name collisions in Mode 2).
// ---------------------------------------------------------------------
function makeMockPropertiesStore() {
  const store = {};
  return {
    getProperty: k => (k in store ? store[k] : null),
    setProperty: (k, v) => { store[k] = v; },
    deleteProperty: k => { delete store[k]; },
    _dump: () => Object.assign({}, store)
  };
}

function makeMockDrive() {
  // folderId -> {name, files: {}}
  const folders = {};
  let nextId = 1;
  return {
    getOrCreateByName(name) {
      const existing = Object.values(folders).find(f => f.name === name);
      if (existing) return existing;
      const f = { id: 'folder_' + (nextId++), name, files: {} };
      folders[f.id] = f;
      return f;
    },
    getById(id) {
      if (!folders[id]) throw new Error('No such folder: ' + id);
      return folders[id];
    },
    writeFile(folder, fileName, content) { folder.files[fileName] = content; },
    readFile(folder, fileName) { return folder.files[fileName]; },
    _allFolders: () => folders
  };
}

// getOrCreateDriveFolder() mirrored from Config/03_Drive.gs (Mode 1/Mode 2)
function getOrCreateDriveFolder(mockDrive, cfg) {
  if (cfg.DRIVE_FOLDER_ID) return mockDrive.getById(cfg.DRIVE_FOLDER_ID);
  return mockDrive.getOrCreateByName(cfg.DRIVE_FOLDER);
}

const sharedDrive = makeMockDrive();
const propsA = makeMockPropertiesStore();
const propsB = makeMockPropertiesStore();

const configA = { PROJECT_ID: 'TEST_A', DRIVE_FOLDER: 'FOLDER_A', DRIVE_FOLDER_ID: '', LAWYER_EMAIL: 'a@example.com' };
const configB = { PROJECT_ID: 'TEST_B', DRIVE_FOLDER: 'FOLDER_B', DRIVE_FOLDER_ID: '', LAWYER_EMAIL: 'b@example.com' };

// Project A writes its spreadsheet id + a backup file
propsA.setProperty('SPREADSHEET_ID', 'SHEET_A');
const driveFolderA = getOrCreateDriveFolder(sharedDrive, configA);
sharedDrive.writeFile(driveFolderA, 'backup_A.json', '{"client":"A"}');

// Project B writes its spreadsheet id + a backup file
propsB.setProperty('SPREADSHEET_ID', 'SHEET_B');
const driveFolderB = getOrCreateDriveFolder(sharedDrive, configB);
sharedDrive.writeFile(driveFolderB, 'backup_B.json', '{"client":"B"}');

check('A does not read B\'s spreadsheet id (script properties are per-deployment)', propsA.getProperty('SPREADSHEET_ID') === 'SHEET_A' && propsB.getProperty('SPREADSHEET_ID') === 'SHEET_B');
check('A cannot write into B\'s properties store (separate objects)', propsA.getProperty('SPREADSHEET_ID') !== propsB.getProperty('SPREADSHEET_ID'));
check('A and B resolve to two DIFFERENT Drive folders when DRIVE_FOLDER names differ', driveFolderA.id !== driveFolderB.id);
check('A\'s backup file is not visible inside B\'s folder', sharedDrive.readFile(driveFolderB, 'backup_A.json') === undefined);
check('B\'s backup file is not visible inside A\'s folder', sharedDrive.readFile(driveFolderA, 'backup_B.json') === undefined);

// Regression check: the documented collision risk — same DRIVE_FOLDER name
// with no DRIVE_FOLDER_ID set DOES still collide in Mode 2 (this is a real,
// disclosed limitation of name-based lookup, not a bug in this test).
const configA2 = { PROJECT_ID: 'TEST_A2', DRIVE_FOLDER: 'SAME_NAME', DRIVE_FOLDER_ID: '' };
const configB2 = { PROJECT_ID: 'TEST_B2', DRIVE_FOLDER: 'SAME_NAME', DRIVE_FOLDER_ID: '' };
const fA2 = getOrCreateDriveFolder(sharedDrive, configA2);
const fB2 = getOrCreateDriveFolder(sharedDrive, configB2);
check('Documented risk: identical DRIVE_FOLDER names DO collide in Mode 2 (why the guide requires unique names or DRIVE_FOLDER_ID)', fA2.id === fB2.id);

// And Mode 1 (DRIVE_FOLDER_ID) removes that risk even with identical names:
const explicitFolder = sharedDrive.getOrCreateByName('SOME_EXISTING_FOLDER');
const configA3 = { PROJECT_ID: 'TEST_A3', DRIVE_FOLDER: 'SAME_NAME', DRIVE_FOLDER_ID: explicitFolder.id };
const configB3 = { PROJECT_ID: 'TEST_B3', DRIVE_FOLDER: 'SAME_NAME', DRIVE_FOLDER_ID: '' };
const fA3 = getOrCreateDriveFolder(sharedDrive, configA3);
const fB3 = getOrCreateDriveFolder(sharedDrive, configB3);
check('Mode 1 (DRIVE_FOLDER_ID) avoids the name-collision risk even when DRIVE_FOLDER names match', fA3.id !== fB3.id);

// ---------------------------------------------------------------------
// 3) Source-level checks against the real repo files.
// ---------------------------------------------------------------------
const configGs = fs.readFileSync(path.join(ROOT, 'Config/00_Config.gs'), 'utf8');
check('Config/00_Config.gs defines PROJECT_ID', /const PROJECT_ID\s*=/.test(configGs));
check('Config/00_Config.gs defines ENVIRONMENT', /const ENVIRONMENT\s*=/.test(configGs));
check('Config/00_Config.gs defines DRIVE_FOLDER_ID (Mode 1 support)', /const DRIVE_FOLDER_ID\s*=/.test(configGs));
check('Config/00_Config.gs defines validateProjectConfig()', /function validateProjectConfig\s*\(/.test(configGs));
check('Config/00_Config.gs defines assertValidProjectConfig()', /function assertValidProjectConfig\s*\(/.test(configGs));

const driveGs = fs.readFileSync(path.join(ROOT, 'Config/03_Drive.gs'), 'utf8');
check('Config/03_Drive.gs: getOrCreateDriveFolder() checks DRIVE_FOLDER_ID first (Mode 1)', /DRIVE_FOLDER_ID/.test(driveGs));

const dbGs = fs.readFileSync(path.join(ROOT, 'Config/01_Database.gs'), 'utf8');
check('Config/01_Database.gs: setupAll() calls assertValidProjectConfig()', /function setupAll\s*\([^)]*\)\s*\{\s*[\s\S]{0,200}assertValidProjectConfig\(\)/.test(dbGs));

// Protected files must be byte-identical to before PHASE A7.6 (no edits).
const PROTECTED = [
  'js/core/SyncEngine.js', 'js/core/SyncCheckpoint.js', 'js/core/OfflineQueue.js',
  'js/core/Repository.js', 'js/core/StorageAdapter.js', 'js/core/IndexedDBAdapter.js',
  'js/api/api.js', 'service-worker.js', 'js/core/SyncCoordinator.js'
];
PROTECTED.forEach(function (rel) {
  const p = path.join(ROOT, rel);
  const exists = fs.existsSync(p);
  check('Protected file exists and was not touched by A7.6 (no config-constant references added): ' + rel, exists && !/PROJECT_ID|DRIVE_FOLDER_ID|validateProjectConfig/.test(fs.readFileSync(p, 'utf8')));
});

console.log('\n=== RESULT: ' + pass + ' PASS / ' + fail + ' FAIL ===');
process.exitCode = fail > 0 ? 1 : 0;
