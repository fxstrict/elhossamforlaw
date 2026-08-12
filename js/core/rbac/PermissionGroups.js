/**
 * ================================================================
 * PermissionGroups.js — Permission Groups | نظام الحسام للمحاماة
 * ================================================================
 * PHASE 31 — SUB-PHASE 31.1 — Users, Roles & Permissions Core (RBAC)
 *
 * Source of design: brief's "مجموعات الصلاحيات" section — "بدلاً من
 * إعادة إنشاء الصلاحيات لكل مستخدم... مجموعة المحاسبين / المحامين /
 * المتدربين / الإدارة... ثم تضيف المستخدم للمجموعة."
 *
 * WHAT THIS FILE IS
 *   Named, reusable bundles of permission keys (from Permissions.js).
 *   Roles.js composes default Roles out of these groups. A User (see
 *   UsersRepository.js) may ALSO be assigned one or more groups directly,
 *   independent of their Role — exactly the brief's model: Role gives a
 *   baseline, Permission Groups add reusable extra bundles, and
 *   individual per-user overrides (allow/deny) apply last.
 *
 * WHAT THIS FILE IS NOT
 *   - Not a source of truth for "who has what" (that's a per-user
 *     assignment, stored on the user record — see UsersRepository.js
 *     `مجموعات_الصلاحيات` field). This file only defines what each named
 *     group CONTAINS.
 *   - Does not evaluate anything — pure data + one lookup helper.
 *
 * Load order: additive file. Depends only on Permissions.js having been
 * loaded first.
 * ================================================================
 */

(function (root) {
  'use strict';

  var PermissionsNS = (typeof module !== 'undefined' && module.exports)
    ? require('./Permissions.js')
    : root.HossamPermissions;

  if (!PermissionsNS || !PermissionsNS.PERMISSIONS) {
    throw new Error('PermissionGroups.js requires js/core/rbac/Permissions.js to be loaded first.');
  }

  var P = PermissionsNS.PERMISSIONS;

  /**
   * PERMISSION_GROUPS — groupKey -> { label, permissions: [keys...] }.
   * The four groups the brief names explicitly, plus two more that map
   * 1:1 onto roles the brief also names but that benefit from being
   * reusable bundles (الاستقبال، الأرشيف) rather than hard-coded only
   * inside Roles.js.
   */
  var PERMISSION_GROUPS = Object.freeze({
    accountants: Object.freeze({ // مجموعة المحاسبين
      label: 'المحاسبون',
      permissions: Object.freeze([
        // "لا يرى تفاصيل القضايا" per the brief — deliberately no
        // P.cases.* permission in this group (P.clients.view is kept:
        // invoices/collection are billed per-client, and the brief only
        // excludes CASE detail, not the client record itself).
        P.finance.viewRevenue, P.finance.viewExpenses, P.finance.viewInvoices,
        P.finance.manageInvoices, P.finance.manageCollection, P.finance.manageSalaries,
        P.finance.viewReports,
        P.clients.view
      ])
    }),
    lawyers: Object.freeze({ // مجموعة المحامين
      label: 'المحامون',
      permissions: Object.freeze([
        P.clients.view, P.clients.create, P.clients.edit, P.clients.print, P.clients.export,
        P.cases.view, P.cases.create, P.cases.edit, P.cases.changeStatus, P.cases.close,
        P.cases.open, P.cases.print, P.cases.export,
        P.sessions.view, P.sessions.create, P.sessions.edit,
        P.documents.view, P.documents.upload, P.documents.download, P.documents.print,
        P.library.view, P.library.download
      ])
    }),
    trainees: Object.freeze({ // مجموعة المتدربين
      label: 'المتدربون',
      permissions: Object.freeze([
        P.clients.view, P.cases.view, P.sessions.view,
        P.documents.view, P.documents.download,
        P.library.view, P.library.download
      ])
    }),
    management: Object.freeze({ // مجموعة الإدارة
      label: 'الإدارة',
      permissions: Object.freeze(PermissionsNS.list().filter(function (key) {
        // كل شيء ما عدا الترخيص وإدارة المديرين — يطابق وصف "المدير
        // التنفيذى" في المستند: "كل شئ ماعدا: تغيير الترخيص، إدارة
        // المديرين، حذف النسخة الاحتياطية".
        return key !== P.settings.license && key !== P.users.changeRole;
      }))
    }),
    reception: Object.freeze({ // مجموعة الاستقبال
      label: 'الاستقبال',
      permissions: Object.freeze([
        P.clients.view, P.clients.create,
        P.sessions.view, P.sessions.create
      ])
    }),
    archive: Object.freeze({ // مجموعة الأرشيف
      label: 'الأرشيف',
      permissions: Object.freeze([
        P.documents.view, P.documents.upload, P.documents.download, P.documents.print
      ])
    })
  });

  /** @param {string} groupKey @returns {Array<string>} permission keys in that group, or []. */
  function permissionsOf(groupKey) {
    var group = PERMISSION_GROUPS[groupKey];
    return group ? group.permissions.slice() : [];
  }

  /** @returns {Array<string>} every defined group key. */
  function list() {
    return Object.keys(PERMISSION_GROUPS);
  }

  var api = {
    PERMISSION_GROUPS: PERMISSION_GROUPS,
    permissionsOf: permissionsOf,
    list: list
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  if (root) {
    root.HossamPermissionGroups = api;
  }
})(typeof window !== 'undefined' ? window : (typeof global !== 'undefined' ? global : this));
