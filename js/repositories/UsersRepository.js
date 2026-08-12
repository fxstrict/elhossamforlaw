/**
 * ================================================================
 * UsersRepository.js — Users Repository | نظام الحسام للمحاماة
 * ================================================================
 * PHASE 31 — SUB-PHASE 31.1 — Users, Roles & Permissions Core (RBAC)
 *
 * Source of design: brief's "المستوى الأول — المستخدم User" and
 * "المستوى الثانى — بيانات الدخول" and "المستوى الثالث — حالة الحساب".
 * Built as a direct sibling of `js/repositories/CasesRepository.js` —
 * SAME base class (`js/core/Repository.js`), SAME Storage Adapter
 * construction pattern (DatabaseService + IndexedDBAdapter), SAME
 * module.exports/window-global shape. See CasesRepository.js's own
 * header for the full rationale behind that pipeline; not repeated here.
 *
 * WHAT THIS FILE IS
 *   The 'users' entity Repository: CRUD for user accounts, with the
 *   required-field validation the brief specifies (الاسم، اسم المستخدم
 *   إلزاميان) plus a uniqueness check on `اسم_المستخدم` (the natural
 *   key — see idField below, which gives duplicate-username rejection
 *   for free via the base class's existing create() duplicate-id guard,
 *   with no extra code needed here).
 *
 * WHAT THIS FILE IS NOT
 *   - It does NOT hash, verify, or otherwise touch passwords. The brief's
 *     "بيانات الدخول" section (تغيير كلمة المرور / نسيت كلمة المرور /
 *     التحقق الثنائى) is login/authentication surface, not a data-record
 *     concern, and requires an actual login screen + crypto decision this
 *     phase does not make (see docs/phase31 report, "Deferred: Login
 *     Screen & Password Handling"). `كلمة_المرور_مجزأة` is stored as
 *     an opaque string field only — whatever produced it is a future
 *     phase's responsibility.
 *   - It does NOT modify Repository.js, DatabaseService.js,
 *     LocalStorageAdapter.js, or IndexedDBAdapter.js.
 *   - It is NOT wired into index.html's active boot chain (no user list
 *     screen calls it yet) — pure additive file, exactly like
 *     CasesRepository was when it was first written (see that file's own
 *     header, "Load order" note).
 *
 * شكل السجل (Record shape) — كل الحقول اختيارية إلا الاسم واسم_المستخدم:
 *   اسم_المستخدم   string   (natural key, unique — idField)
 *   الاسم          string   (required)
 *   البريد         string
 *   الهاتف         string
 *   كلمة_المرور_مجزأة  string  (opaque — see "WHAT THIS FILE IS NOT" above)
 *   الحالة         'نشط'|'موقوف'|'مغلق'|'بانتظار التفعيل'|'منتهى' (default 'بانتظار التفعيل')
 *   المكتب / الفرع / القسم   string
 *   الدور          string   (a Roles.js role key)
 *   مجموعات_الصلاحيات    Array<string>   (PermissionGroups.js group keys)
 *   صلاحيات_فردية  {مسموحة:Array<string>, ممنوعة:Array<string>}
 *   نافذة_الدخول   {من:'HH:MM', إلى:'HH:MM'}   (optional — PermissionService.withinLoginWindow)
 *   آخر_دخول / آخر_IP / آخر_جهاز / آخر_نشاط     string  (session metadata,
 *     written by the future login screen, not by this Repository)
 *   الملاحظات      string
 *
 * Load order: additive file. Depends only on js/core/Repository.js,
 * js/core/DatabaseService.js, and js/core/IndexedDBAdapter.js having
 * been loaded first, exactly like CasesRepository.js.
 * ================================================================
 */

(function (root) {
  'use strict';

  var RepositoryNS = (typeof module !== 'undefined' && module.exports)
    ? require('../core/Repository.js') : root;
  var Repository = RepositoryNS.Repository;

  if (typeof Repository !== 'function') {
    throw new Error('UsersRepository requires js/core/Repository.js to be loaded first (Repository base class not found).');
  }

  var DatabaseServiceNS = (typeof module !== 'undefined' && module.exports)
    ? require('../core/DatabaseService.js') : root;
  var IndexedDBAdapterNS = (typeof module !== 'undefined' && module.exports)
    ? require('../core/IndexedDBAdapter.js') : root;

  var DatabaseService = DatabaseServiceNS && DatabaseServiceNS.DatabaseService;
  var IndexedDBAdapter = IndexedDBAdapterNS && IndexedDBAdapterNS.IndexedDBAdapter;

  if (typeof DatabaseService !== 'function') {
    throw new Error('UsersRepository requires js/core/DatabaseService.js to be loaded first (DatabaseService class not found).');
  }
  if (typeof IndexedDBAdapter !== 'function') {
    throw new Error('UsersRepository requires js/core/IndexedDBAdapter.js to be loaded first (IndexedDBAdapter class not found).');
  }

  var USERS_ID_FIELD = 'اسم_المستخدم';
  var USERS_REQUIRED_FIELDS = ['اسم_المستخدم', 'الاسم'];
  var USERS_SEARCH_FIELDS = ['الاسم', 'اسم_المستخدم', 'البريد', 'الهاتف'];
  var USERS_FILTER_FIELDS = ['الحالة', 'الدور', 'الفرع', 'القسم'];
  var VALID_STATUSES = ['نشط', 'موقوف', 'مغلق', 'بانتظار التفعيل', 'منتهى'];

  function createUsersLocalStorageAdapter(storageImpl) {
    var adapter = new IndexedDBAdapter(storageImpl ? { engineOptions: { indexedDBImpl: storageImpl } } : {});
    return new DatabaseService(adapter);
  }

  /**
   * @class UsersRepository
   * @param {{storageAdapter?: object}} [config]
   */
  function UsersRepository(config) {
    config = config || {};
    var storageAdapter = config.storageAdapter || createUsersLocalStorageAdapter();

    Repository.call(this, {
      entityKey: 'users',
      storageAdapter: storageAdapter,
      idField: USERS_ID_FIELD,
      searchFields: USERS_SEARCH_FIELDS,
      softDelete: true, // an account should be recoverable, matching Cases/Clients default.
      unsupportedOperations: []
    });
  }

  UsersRepository.prototype = Object.create(Repository.prototype);
  UsersRepository.prototype.constructor = UsersRepository;

  /**
   * _validate(operation, record) — required fields + status enum +
   * username format (no spaces, matches the natural-key/login-field
   * role it plays) on create/update. Uniqueness of اسم_المستخدم is
   * enforced for free by the base class's existing create() duplicate-id
   * guard (idField === اسم_المستخدم), so it is deliberately NOT
   * re-checked here.
   * @protected
   * @override
   */
  UsersRepository.prototype._validate = function (operation, record) {
    if (operation !== 'create' && operation !== 'update') {
      return { valid: true, errors: [] };
    }
    var errors = [];
    USERS_REQUIRED_FIELDS.forEach(function (field) {
      var value = record ? record[field] : undefined;
      var isEmpty = value == null || (typeof value === 'string' && value.trim() === '');
      if (isEmpty) {
        errors.push({ field: field, message: 'الحقل "' + field + '" إلزامي ولا يمكن أن يكون فارغاً.' });
      }
    });
    if (record && typeof record.اسم_المستخدم === 'string' && /\s/.test(record.اسم_المستخدم)) {
      errors.push({ field: 'اسم_المستخدم', message: 'اسم المستخدم لا يجب أن يحتوي على مسافات.' });
    }
    if (record && record.الحالة != null && VALID_STATUSES.indexOf(record.الحالة) === -1) {
      errors.push({ field: 'الحالة', message: 'قيمة "الحالة" غير صالحة. القيم المسموحة: ' + VALID_STATUSES.join('، ') + '.' });
    }
    return { valid: errors.length === 0, errors: errors };
  };

  /** validate(record, operation?) — public convenience wrapper, same shape as CasesRepository.validate(). */
  UsersRepository.prototype.validate = function (record, operation) {
    return this._validate(operation || 'create', record);
  };

  /**
   * _attachMetadata(record, operation) — override to also default
   * `الحالة` to 'بانتظار التفعيل' on create (brief's account-state
   * section lists it as one of five valid states; a freshly created
   * account should not silently start 'نشط' with no activation step).
   * Calls the base class's metadata stamping first, unchanged.
   * @protected
   * @override
   */
  UsersRepository.prototype._attachMetadata = function (record, operation) {
    Repository.prototype._attachMetadata.call(this, record, operation);
    if (operation === 'create' && record.الحالة == null) {
      record.الحالة = 'بانتظار التفعيل';
    }
  };

  /** insert(entity) -> WriteResult — alias for create(), matching CasesRepository's convenience alias. */
  UsersRepository.prototype.insert = function (entity) { return this.create(entity); };
  /** remove(id) -> WriteResult — alias for delete(), matching CasesRepository's convenience alias. */
  UsersRepository.prototype.remove = function (id) { return this.delete(id); };

  var api = {
    UsersRepository: UsersRepository,
    createUsersLocalStorageAdapter: createUsersLocalStorageAdapter
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  if (root) {
    root.UsersRepository = UsersRepository;
    root.createUsersLocalStorageAdapter = createUsersLocalStorageAdapter;
  }
})(typeof window !== 'undefined' ? window : (typeof global !== 'undefined' ? global : this));
