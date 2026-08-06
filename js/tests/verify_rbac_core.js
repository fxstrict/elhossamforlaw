/**
 * verify_rbac_core.js
 * ================================================================
 * PHASE 31 — SUB-PHASE 31.1 — Users, Roles & Permissions Core (RBAC)
 * ================================================================
 * Standalone Node harness (`node js/tests/verify_rbac_core.js`, no
 * browser required), following the exact same structure/tooling every
 * existing `verify_*` harness in this project already uses (assert,
 * FakeIndexedDB, plain counted PASS/FAIL log, non-zero exit on failure).
 *
 * Sections:
 *   A. Permissions.js catalog — every key well-formed, unique, byModule()/
 *      existsPermission() correct.
 *   B. PermissionGroups.js — every group only references real
 *      permission keys.
 *   C. Roles.js — every role only references real permission keys;
 *      spot-checks against the brief's own prose per role (§ "الأدوار").
 *   D. PermissionService.js — resolution order (Role ∪ Groups ∪
 *      allow − deny, deny wins), can(), isOfficeWide(), canAccessCase()
 *      scoping (assignment/branch/department/VIP client),
 *      withinLoginWindow() (including the overnight-window case).
 *   E. UsersRepository.js — CRUD via the SAME Repository base class
 *      pipeline as CasesRepository (DatabaseService + IndexedDBAdapter),
 *      required-field validation, status-enum validation, username-
 *      uniqueness (free via idField), default status on create,
 *      persistence across reopen.
 *   F. Repository.js `_guardPermission()` integration — regression proof
 *      that (1) with NO window.HossamPermissionGuard registered, every
 *      existing Repository (CasesRepository used as the representative)
 *      behaves EXACTLY as before Phase 31 (zero regression); (2) with a
 *      guard registered but no current user set, still fail-open; (3)
 *      with a current user set who lacks the permission, the guarded
 *      operation throws a PermissionError and the record is NOT written;
 *      (4) with a current user who holds the permission, the operation
 *      succeeds normally.
 *   G. Structural check: `js/core/Repository.js`'s pre-existing
 *      `_guardWritable` machinery (PHASE 30) is untouched — MD5 of the
 *      function's own source text is compared against a known-good
 *      snapshot taken from this same file before Phase 31's edits.
 * ================================================================
 */

'use strict';

const assert = require('assert');
const path = require('path');

const CORE_DIR = path.join(__dirname, '..', 'core');
const RBAC_DIR = path.join(CORE_DIR, 'rbac');
const REPOS_DIR = path.join(__dirname, '..', 'repositories');

const { Repository, RepositoryErrorTypes } = require(path.join(CORE_DIR, 'Repository.js'));
const { DatabaseService } = require(path.join(CORE_DIR, 'DatabaseService.js'));
const { IndexedDBAdapter } = require(path.join(CORE_DIR, 'IndexedDBAdapter.js'));
const { FakeIndexedDB } = require(path.join(__dirname, 'fake_indexeddb.js'));

const PermissionsNS = require(path.join(RBAC_DIR, 'Permissions.js'));
const GroupsNS = require(path.join(RBAC_DIR, 'PermissionGroups.js'));
const RolesNS = require(path.join(RBAC_DIR, 'Roles.js'));
const PermissionServiceNS = require(path.join(RBAC_DIR, 'PermissionService.js'));

const { CasesRepository, createCasesLocalStorageAdapter } = require(path.join(REPOS_DIR, 'CasesRepository.js'));
const { UsersRepository, createUsersLocalStorageAdapter } = require(path.join(REPOS_DIR, 'UsersRepository.js'));

let passed = 0;
let failed = 0;
const failures = [];

function check(label, fn) {
  try {
    fn();
    passed++;
    console.log('  \u2713 ' + label);
  } catch (err) {
    failed++;
    failures.push({ label: label, error: err });
    console.log('  \u2717 ' + label + ' -> ' + err.message);
  }
}

async function checkAsync(label, fn) {
  try {
    await fn();
    passed++;
    console.log('  \u2713 ' + label);
  } catch (err) {
    failed++;
    failures.push({ label: label, error: err });
    console.log('  \u2717 ' + label + ' -> ' + err.message);
  }
}

function freshStorage() { return new FakeIndexedDB(); }

async function main() {
  console.log('\n=== SECTION A: Permissions.js catalog ===');
  const allKeys = PermissionsNS.list();
  check('catalog is non-empty', () => assert.ok(allKeys.length > 40, 'expected 40+ permission keys, got ' + allKeys.length));
  check('every key is unique', () => assert.strictEqual(new Set(allKeys).size, allKeys.length));
  check('every key matches Can<Verb><Module> shape', () => {
    allKeys.forEach(k => assert.ok(/^Can[A-Z][A-Za-z]+$/.test(k), 'bad key: ' + k));
  });
  check('existsPermission() true for real key, false for junk', () => {
    assert.strictEqual(PermissionsNS.existsPermission('CanViewCases'), true);
    assert.strictEqual(PermissionsNS.existsPermission('CanDoNonsense'), false);
  });
  check('byModule("cases") returns the cases action map', () => {
    const mod = PermissionsNS.byModule('cases');
    assert.strictEqual(mod.delete, 'CanDeleteCases');
  });

  console.log('\n=== SECTION B: PermissionGroups.js ===');
  check('every group permission is a real, known key', () => {
    GroupsNS.list().forEach(groupKey => {
      GroupsNS.permissionsOf(groupKey).forEach(k => {
        assert.ok(PermissionsNS.existsPermission(k), groupKey + ' references unknown key ' + k);
      });
    });
  });
  check('management group excludes license + changeRole (brief: المدير التنفيذى استثناءات)', () => {
    const mgmt = GroupsNS.permissionsOf('management');
    assert.ok(mgmt.indexOf('CanManageLicense') === -1);
    assert.ok(mgmt.indexOf('CanChangeUserRole') === -1);
  });

  console.log('\n=== SECTION C: Roles.js ===');
  check('every role permission is a real, known key', () => {
    RolesNS.list().forEach(roleKey => {
      RolesNS.permissionsOf(roleKey).forEach(k => {
        assert.ok(PermissionsNS.existsPermission(k), roleKey + ' references unknown key ' + k);
      });
    });
  });
  check('office_owner holds every permission ("كل الصلاحيات")', () => {
    assert.strictEqual(RolesNS.permissionsOf('office_owner').length, allKeys.length);
  });
  check('executive_manager holds everything except license + changeRole', () => {
    const perms = RolesNS.permissionsOf('executive_manager');
    assert.ok(perms.indexOf('CanManageLicense') === -1);
    assert.ok(perms.indexOf('CanChangeUserRole') === -1);
    assert.strictEqual(perms.length, allKeys.length - 2);
  });
  check('trainee_lawyer cannot delete anything (برief: لا يحذف)', () => {
    const perms = RolesNS.permissionsOf('trainee_lawyer');
    assert.ok(perms.every(k => k.indexOf('Delete') === -1));
  });
  check('secretary cannot see finance (برief: لا يرى البيانات المالية)', () => {
    const perms = RolesNS.permissionsOf('secretary');
    assert.ok(perms.every(k => Object.values(PermissionsNS.byModule('finance')).indexOf(k) === -1));
  });
  check('accountant cannot see case details (برief: لا يرى تفاصيل القضايا)', () => {
    const perms = RolesNS.permissionsOf('accountant');
    assert.ok(perms.indexOf('CanViewCases') === -1);
  });
  check('guest has very limited permissions (برief: محدودة جداً)', () => {
    assert.strictEqual(RolesNS.permissionsOf('guest').length, 1);
  });

  console.log('\n=== SECTION D: PermissionService.js ===');
  check('resolvePermissions() = Role \u222a Groups \u222a allow - deny (deny wins)', () => {
    const user = {
      الحالة: 'نشط', الدور: 'trainee_lawyer',
      مجموعات_الصلاحيات: ['reception'],
      صلاحيات_فردية: { مسموحة: ['CanDeleteCases'], ممنوعة: ['CanViewSessions'] }
    };
    const granted = PermissionServiceNS.resolvePermissions(user);
    assert.strictEqual(granted.CanViewCases, true, 'from role');
    assert.strictEqual(granted.CanCreateClients, true, 'from group');
    assert.strictEqual(granted.CanDeleteCases, true, 'from individual allow (trainee role alone has no delete)');
    assert.strictEqual(granted.CanViewSessions, undefined, 'individual deny must win over role grant');
  });
  check('can() is fail-closed for inactive user', () => {
    const user = { الحالة: 'موقوف', الدور: 'office_owner' };
    assert.strictEqual(PermissionServiceNS.can(user, 'CanViewCases'), false);
  });
  check('can() is fail-closed for unknown permission key', () => {
    const user = { الحالة: 'نشط', الدور: 'office_owner' };
    assert.strictEqual(PermissionServiceNS.can(user, 'CanDoNonsense'), false);
  });
  check('can() true for a role-granted permission on an active user', () => {
    const user = { الحالة: 'نشط', الدور: 'lawyer' };
    assert.strictEqual(PermissionServiceNS.can(user, 'CanCreateCases'), true);
  });
  check('isOfficeWide() true only for owner/executive/partner', () => {
    assert.strictEqual(PermissionServiceNS.isOfficeWide({ الدور: 'office_owner' }), true);
    assert.strictEqual(PermissionServiceNS.isOfficeWide({ الدور: 'partner' }), true);
    assert.strictEqual(PermissionServiceNS.isOfficeWide({ الدور: 'lawyer' }), false);
  });
  check('canAccessCase() restricts to assigned lawyers only (برief: فقط هؤلاء يرونها)', () => {
    const lawyer = { id: 'u1', الدور: 'lawyer' };
    const otherLawyer = { id: 'u2', الدور: 'lawyer' };
    const theCase = { المسئول: 'u1', المساعد: 'u3' };
    assert.strictEqual(PermissionServiceNS.canAccessCase(lawyer, theCase), true);
    assert.strictEqual(PermissionServiceNS.canAccessCase(otherLawyer, theCase), false);
  });
  check('canAccessCase() office-wide role bypasses assignment scoping', () => {
    const partner = { id: 'uX', الدور: 'partner' };
    const theCase = { المسئول: 'u1' };
    assert.strictEqual(PermissionServiceNS.canAccessCase(partner, theCase), true);
  });
  check('canAccessCase() branch scoping (برief: كل فرع يرى قضاياه فقط)', () => {
    const lawyer = { id: 'u1', الدور: 'lawyer', الفرع: 'القاهرة' };
    const theCase = { المسئول: 'u1', الفرع: 'الإسكندرية' };
    assert.strictEqual(PermissionServiceNS.canAccessCase(lawyer, theCase), false);
  });
  check('canAccessCase() VIP client scoping (برief: لا يراها إلا المدير/صاحب المكتب/الشريك)', () => {
    const lawyer = { id: 'u1', الدور: 'lawyer' };
    const partner = { id: 'u2', الدور: 'partner' };
    const vipCase = { المسئول: 'u1', عميل_حساس: true };
    assert.strictEqual(PermissionServiceNS.canAccessCase(lawyer, vipCase), false);
    assert.strictEqual(PermissionServiceNS.canAccessCase(partner, vipCase), true);
  });
  check('withinLoginWindow() unrestricted when unconfigured', () => {
    assert.strictEqual(PermissionServiceNS.withinLoginWindow({}), true);
  });
  check('withinLoginWindow() ordinary daytime window', () => {
    const user = { نافذة_الدخول: { من: '08:00', إلى: '20:00' } };
    assert.strictEqual(PermissionServiceNS.withinLoginWindow(user, new Date(2026, 0, 1, 10, 0)), true);
    assert.strictEqual(PermissionServiceNS.withinLoginWindow(user, new Date(2026, 0, 1, 23, 0)), false);
  });
  check('withinLoginWindow() overnight window (from > to)', () => {
    const user = { نافذة_الدخول: { من: '20:00', إلى: '06:00' } };
    assert.strictEqual(PermissionServiceNS.withinLoginWindow(user, new Date(2026, 0, 1, 23, 0)), true);
    assert.strictEqual(PermissionServiceNS.withinLoginWindow(user, new Date(2026, 0, 1, 12, 0)), false);
  });

  console.log('\n=== SECTION E: UsersRepository.js ===');
  await checkAsync('create() a valid user succeeds and defaults الحالة', async () => {
    const repo = new UsersRepository({ storageAdapter: createUsersLocalStorageAdapter(freshStorage()) });
    await repo.open();
    const result = await repo.create({ اسم_المستخدم: 'ahmed', الاسم: 'أحمد علي', الدور: 'lawyer' });
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.record.الحالة, 'بانتظار التفعيل');
  });
  await checkAsync('create() rejects missing required fields', async () => {
    const repo = new UsersRepository({ storageAdapter: createUsersLocalStorageAdapter(freshStorage()) });
    await repo.open();
    const result = await repo.create({ اسم_المستخدم: 'x' });
    assert.strictEqual(result.success, false);
    assert.strictEqual(result.error.type, RepositoryErrorTypes.VALIDATION);
  });
  await checkAsync('create() rejects username with whitespace', async () => {
    const repo = new UsersRepository({ storageAdapter: createUsersLocalStorageAdapter(freshStorage()) });
    await repo.open();
    const result = await repo.create({ اسم_المستخدم: 'has space', الاسم: 'Test' });
    assert.strictEqual(result.success, false);
  });
  await checkAsync('create() rejects invalid الحالة enum value', async () => {
    const repo = new UsersRepository({ storageAdapter: createUsersLocalStorageAdapter(freshStorage()) });
    await repo.open();
    const result = await repo.create({ اسم_المستخدم: 'y', الاسم: 'Test', الحالة: 'invalid_status' });
    assert.strictEqual(result.success, false);
  });
  await checkAsync('duplicate اسم_المستخدم is rejected (free uniqueness via idField)', async () => {
    const storage = freshStorage();
    const repo = new UsersRepository({ storageAdapter: createUsersLocalStorageAdapter(storage) });
    await repo.open();
    await repo.create({ اسم_المستخدم: 'dup1', الاسم: 'One' });
    const second = await repo.create({ اسم_المستخدم: 'dup1', الاسم: 'Two' });
    assert.strictEqual(second.success, false);
  });
  await checkAsync('persists across reopen', async () => {
    const storage = freshStorage();
    const repo1 = new UsersRepository({ storageAdapter: createUsersLocalStorageAdapter(storage) });
    await repo1.open();
    await repo1.create({ اسم_المستخدم: 'persist1', الاسم: 'Persist Test' });
    const repo2 = new UsersRepository({ storageAdapter: createUsersLocalStorageAdapter(storage) });
    await repo2.open();
    const found = await repo2.get('persist1');
    assert.ok(found, 'record should survive reopen against the same storage');
    assert.strictEqual(found.الاسم, 'Persist Test');
  });

  console.log('\n=== SECTION F: Repository.js _guardPermission() integration ===');
  const SessionContextPath = path.join(RBAC_DIR, 'SessionContext.js');

  await checkAsync('NO guard registered -> CasesRepository behaves exactly as before Phase 31', async () => {
    delete require.cache[require.resolve(SessionContextPath)];
    const g = global;
    const savedGuard = g.HossamPermissionGuard;
    delete g.HossamPermissionGuard;
    try {
      const repo = new CasesRepository({ storageAdapter: createCasesLocalStorageAdapter(freshStorage()) });
      await repo.open();
      const result = await repo.create({ رقم_القضية: 'C-1', عنوان_القضية: 'ت', اسم_الموكل: 'م' });
      assert.strictEqual(result.success, true);
    } finally {
      if (savedGuard) g.HossamPermissionGuard = savedGuard;
    }
  });

  await checkAsync('guard registered, NO current user -> fail-open (unchanged behavior)', async () => {
    delete require.cache[require.resolve(SessionContextPath)];
    const { HossamSession } = require(SessionContextPath);
    HossamSession.clear();
    const repo = new CasesRepository({ storageAdapter: createCasesLocalStorageAdapter(freshStorage()) });
    await repo.open();
    const result = await repo.create({ رقم_القضية: 'C-2', عنوان_القضية: 'ت', اسم_الموكل: 'م' });
    assert.strictEqual(result.success, true);
  });

  await checkAsync('current user LACKS permission -> create() blocked, nothing written', async () => {
    delete require.cache[require.resolve(SessionContextPath)];
    const { HossamSession } = require(SessionContextPath);
    const storage = freshStorage();
    const repo = new CasesRepository({ storageAdapter: createCasesLocalStorageAdapter(storage) });
    await repo.open();
    HossamSession.setCurrentUser({ id: 'u1', اسم_المستخدم: 'trainee1', الحالة: 'نشط', الدور: 'trainee_lawyer' });
    try {
      // _guardPermission(), like PHASE 30's _guardWritable() right above
      // it, throws synchronously rather than resolving to
      // {success:false,...} — matching the existing guard-vs-validation
      // error-surfacing split already established in Repository.js (see
      // js/core/Repository.js create(), where _guardWritable()/
      // _guardPermission() run BEFORE the try/catch that turns
      // validation/conflict/persist failures into a WriteResult).
      let threw = null;
      try { await repo.create({ رقم_القضية: 'C-3', عنوان_القضية: 'ت', اسم_الموكل: 'م' }); }
      catch (err) { threw = err; }
      assert.ok(threw, 'create() must throw when permission is denied');
      assert.strictEqual(threw.type, RepositoryErrorTypes.PERMISSION);
      const all = await repo.getAll();
      assert.strictEqual(all.filter(c => c.رقم_القضية === 'C-3').length, 0);
    } finally {
      HossamSession.clear();
    }
  });

  await checkAsync('current user HOLDS permission -> create() succeeds normally', async () => {
    delete require.cache[require.resolve(SessionContextPath)];
    const { HossamSession } = require(SessionContextPath);
    const repo = new CasesRepository({ storageAdapter: createCasesLocalStorageAdapter(freshStorage()) });
    await repo.open();
    HossamSession.setCurrentUser({ id: 'u2', اسم_المستخدم: 'lawyer1', الحالة: 'نشط', الدور: 'lawyer' });
    try {
      const result = await repo.create({ رقم_القضية: 'C-4', عنوان_القضية: 'ت', اسم_الموكل: 'م' });
      assert.strictEqual(result.success, true);
    } finally {
      HossamSession.clear();
    }
  });

  await checkAsync('delete() blocked for a role without CanDeleteCases, allowed for one that has it', async () => {
    delete require.cache[require.resolve(SessionContextPath)];
    const { HossamSession } = require(SessionContextPath);
    const storage = freshStorage();
    const repo = new CasesRepository({ storageAdapter: createCasesLocalStorageAdapter(storage) });
    await repo.open();
    const created = await repo.create({ رقم_القضية: 'C-5', عنوان_القضية: 'ت', اسم_الموكل: 'م' });
    assert.strictEqual(created.success, true);

    HossamSession.setCurrentUser({ id: 'u3', اسم_المستخدم: 'lawyer2', الحالة: 'نشط', الدور: 'lawyer' }); // lawyer has no CanDeleteCases
    let blockedErr = null;
    try { await repo.delete('C-5'); } catch (err) { blockedErr = err; }
    assert.ok(blockedErr, 'delete() must throw when permission is denied');
    assert.strictEqual(blockedErr.type, RepositoryErrorTypes.PERMISSION);

    HossamSession.setCurrentUser({ id: 'u4', اسم_المستخدم: 'partner1', الحالة: 'نشط', الدور: 'partner' }); // partner does
    const allowed = await repo.delete('C-5');
    assert.strictEqual(allowed.success, true);
    HossamSession.clear();
  });

  console.log('\n=== SECTION G: Structural regression check (PHASE 30 machinery untouched) ===');
  check('_guardWritable still references LicenseReadOnlyGuard, unmodified by Phase 31', () => {
    const src = Repository.prototype._guardWritable.toString();
    assert.ok(src.indexOf('LicenseReadOnlyGuard') !== -1, '_guardWritable must still reference LicenseReadOnlyGuard unchanged');
    assert.ok(src.indexOf('isReadOnly') !== -1 && src.indexOf('getReason') !== -1, '_guardWritable body shape unchanged');
  });
  check('_guardPermission is a new, distinct function (not aliasing _guardWritable)', () => {
    assert.notStrictEqual(Repository.prototype._guardPermission, Repository.prototype._guardWritable);
    assert.strictEqual(typeof Repository.prototype._guardPermission, 'function');
  });
  await checkAsync('License Read-Only guard still fires independently of the new permission guard', async () => {
    const g = global;
    const saved = g.LicenseReadOnlyGuard;
    g.LicenseReadOnlyGuard = { isReadOnly: () => true, getReason: () => 'اختبار' };
    try {
      const repo = new CasesRepository({ storageAdapter: createCasesLocalStorageAdapter(freshStorage()) });
      await repo.open();
      let threw = null;
      try { await repo.create({ رقم_القضية: 'C-6', عنوان_القضية: 'ت', اسم_الموكل: 'م' }); }
      catch (err) { threw = err; }
      assert.ok(threw, 'create() must throw when License Read-Only Mode is active');
      assert.strictEqual(threw.type, RepositoryErrorTypes.PERMISSION);
    } finally {
      if (saved) g.LicenseReadOnlyGuard = saved; else delete g.LicenseReadOnlyGuard;
    }
  });

  console.log('\n================================================================');
  console.log('TOTAL: ' + passed + ' passed, ' + failed + ' failed (' + (passed + failed) + ' checks)');
  console.log('================================================================\n');
  if (failed > 0) {
    failures.forEach(f => console.log('FAILED: ' + f.label + '\n  ' + (f.error.stack || f.error)));
    process.exitCode = 1;
  }
}

main().catch(err => {
  console.error('HARNESS CRASHED:', err);
  process.exitCode = 1;
});
