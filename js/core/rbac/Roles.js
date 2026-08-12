/**
 * ================================================================
 * Roles.js — Default Role Catalog | نظام الحسام للمحاماة
 * ================================================================
 * PHASE 31 — SUB-PHASE 31.1 — Users, Roles & Permissions Core (RBAC)
 *
 * Source of design: brief's "المستوى الرابع — الأدوار Roles — مثال لمكتب
 * محاماة" — the eleven roles it lists, literally: صاحب المكتب، المدير
 * التنفيذى، الشريك، محام، محام متدرب، السكرتير، المحاسب، موظف الأرشيف،
 * موظف استقبال، مراقب، ضيف.
 *
 * WHAT THIS FILE IS
 *   Eleven default, editable-in-spirit Role definitions, each a set of
 *   permission keys built from Permissions.js + PermissionGroups.js
 *   exactly as the brief describes each role's scope in prose. These are
 *   SEED data / sensible defaults — an office can still assign
 *   PermissionGroups or individual overrides on top of any user's Role
 *   (see PermissionGroups.js header and UsersRepository.js), so nothing
 *   here is a hard ceiling enforced anywhere else in this file.
 *
 * WHAT THIS FILE IS NOT
 *   - Not per-user data. A specific office's actual role-to-user
 *     assignments live on User records (UsersRepository.js), not here.
 *   - Not an enforcement point — PermissionService.js is the only place
 *     a yes/no access decision is actually made.
 *
 * Load order: additive file. Depends on Permissions.js and
 * PermissionGroups.js having been loaded first.
 * ================================================================
 */

(function (root) {
  'use strict';

  var PermissionsNS = (typeof module !== 'undefined' && module.exports)
    ? require('./Permissions.js')
    : root.HossamPermissions;
  var GroupsNS = (typeof module !== 'undefined' && module.exports)
    ? require('./PermissionGroups.js')
    : root.HossamPermissionGroups;

  if (!PermissionsNS || !PermissionsNS.PERMISSIONS) {
    throw new Error('Roles.js requires js/core/rbac/Permissions.js to be loaded first.');
  }
  if (!GroupsNS || !GroupsNS.PERMISSION_GROUPS) {
    throw new Error('Roles.js requires js/core/rbac/PermissionGroups.js to be loaded first.');
  }

  var P = PermissionsNS.PERMISSIONS;
  var ALL = PermissionsNS.list();
  var g = GroupsNS.permissionsOf;

  /** de-duplicating union helper for composing a role out of several sources. */
  function union() {
    var out = {};
    for (var i = 0; i < arguments.length; i++) {
      var arr = arguments[i] || [];
      for (var j = 0; j < arr.length; j++) out[arr[j]] = true;
    }
    return Object.keys(out);
  }

  function minus(base, removeList) {
    var remove = {};
    removeList.forEach(function (k) { remove[k] = true; });
    return base.filter(function (k) { return !remove[k]; });
  }

  /**
   * ROLES — roleKey -> { label, permissions: [keys...] }.
   * `label` is the exact Arabic role name from the brief (used as the
   * default display label; a real deployment may still rename it per
   * office — Roles.js only ships the default).
   */
  var ROLES = Object.freeze({
    office_owner: Object.freeze({ // صاحب المكتب — "كل الصلاحيات"
      label: 'صاحب المكتب',
      permissions: Object.freeze(ALL.slice())
    }),
    executive_manager: Object.freeze({ // المدير التنفيذى — "كل شئ ماعدا: تغيير الترخيص، إدارة المديرين، حذف النسخة الاحتياطية"
      label: 'المدير التنفيذي',
      permissions: Object.freeze(minus(ALL, [
        P.settings.license, P.users.changeRole
      ]))
    }),
    partner: Object.freeze({ // الشريك — "يرى كل القضايا، يضيف، يعدل، يحذف، يعتمد"
      label: 'الشريك',
      permissions: Object.freeze(union(
        g('lawyers'),
        [P.cases.delete, P.cases.restore, P.cases.transfer, P.sessions.approve,
         P.clients.delete, P.clients.restore, P.finance.viewReports]
      ))
    }),
    lawyer: Object.freeze({ // محام — "القضايا الخاصة به، إضافة، تعديل، جلسات، مذكرات"
      label: 'محامٍ',
      permissions: Object.freeze(g('lawyers'))
    }),
    trainee_lawyer: Object.freeze({ // محام متدرب — "يرى فقط، لا يحذف، لا يعدل بيانات حساسة"
      label: 'محامٍ متدرب',
      permissions: Object.freeze(g('trainees'))
    }),
    secretary: Object.freeze({ // السكرتير — "العملاء، المواعيد، الجلسات، الاتصالات، لا يرى البيانات المالية"
      label: 'السكرتير',
      permissions: Object.freeze(union(
        [P.clients.view, P.clients.create, P.clients.edit],
        [P.sessions.view, P.sessions.create, P.sessions.edit],
        [P.cases.view]
      ))
    }),
    accountant: Object.freeze({ // المحاسب — "الفواتير، الإيرادات، المصروفات، لا يرى تفاصيل القضايا"
      label: 'المحاسب',
      permissions: Object.freeze(g('accountants'))
    }),
    archive_clerk: Object.freeze({ // موظف الأرشيف — "رفع ملفات، تنزيل ملفات، أرشفة، لا يعدل القضايا"
      label: 'موظف الأرشيف',
      permissions: Object.freeze(g('archive'))
    }),
    receptionist: Object.freeze({ // موظف استقبال — "إضافة عميل، تسجيل اتصال، حجز موعد"
      label: 'موظف استقبال',
      permissions: Object.freeze(g('reception'))
    }),
    observer: Object.freeze({ // مراقب — "قراءة فقط"
      label: 'مراقب',
      permissions: Object.freeze([
        P.clients.view, P.cases.view, P.sessions.view, P.documents.view,
        P.library.view, P.finance.viewReports
      ])
    }),
    guest: Object.freeze({ // ضيف — "صلاحيات محدودة جداً"
      label: 'ضيف',
      permissions: Object.freeze([P.cases.view])
    })
  });

  /** @param {string} roleKey @returns {Array<string>} permission keys for that role, or []. */
  function permissionsOf(roleKey) {
    var role = ROLES[roleKey];
    return role ? role.permissions.slice() : [];
  }

  /** @returns {Array<string>} every defined role key, in the brief's own listed order. */
  function list() {
    return Object.keys(ROLES);
  }

  var api = {
    ROLES: ROLES,
    permissionsOf: permissionsOf,
    list: list
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  if (root) {
    root.HossamRoles = api;
  }
})(typeof window !== 'undefined' ? window : (typeof global !== 'undefined' ? global : this));
