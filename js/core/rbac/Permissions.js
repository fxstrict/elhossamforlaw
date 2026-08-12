/**
 * ================================================================
 * Permissions.js — Permission Catalog | نظام الحسام للمحاماة
 * ================================================================
 * PHASE 31 — SUB-PHASE 31.1 — Users, Roles & Permissions Core (RBAC)
 *
 * Source of design: user-supplied brief "المرحلة 30/31 — نظام صلاحيات
 * متعدد المستويات لمكتب محاماة" (المستوى الخامس: نظام الصلاحيات
 * Permissions، والصلاحيات حسب كل وحدة).
 *
 * WHAT THIS FILE IS
 *   A single, static, frozen catalog of every fine-grained permission key
 *   the system recognizes today (`CanViewCases`, `CanEditClients`, ...),
 *   grouped by module exactly as the brief lists them (العملاء، القضايا،
 *   الجلسات، المستندات، المالية، المكتبة القانونية، الإعدادات). This file
 *   defines WHAT permissions exist. It does not decide who has them
 *   (Roles.js / PermissionGroups.js) or how a decision is made
 *   (PermissionService.js).
 *
 * WHAT THIS FILE IS NOT
 *   - It does not read or write any user, role, or session data.
 *   - It does not modify any existing project file.
 *   - It is pure, static data plus a couple of stateless helpers
 *     (list(), existsPermission(), byModule()) — no side effects.
 *
 * Naming convention: `Can<Verb><Module>` (e.g. `CanDeleteCases`), matching
 * the brief's own example naming (`CanViewCases`, `CanCreateCases`, ...)
 * literally. Every key is namespaced by module so two modules can each
 * have their own "Delete" permission without collision.
 *
 * Load order: additive file, zero dependencies. Safe to load anywhere.
 * ================================================================
 */

(function (root) {
  'use strict';

  /**
   * PERMISSIONS — module -> { action -> permission key }.
   * Verbs per module follow the brief's own per-module breakdown
   * (المستوى الخامس، "الصلاحيات حسب كل وحدة") as closely as the actual
   * verbs it lists; a small common core (view/create/edit/delete/restore/
   * print/export) is shared everywhere a module doesn't call out
   * something more specific, so every module is at minimum CRUD-complete.
   */
  var PERMISSIONS = Object.freeze({
    clients: Object.freeze({ // العملاء
      view: 'CanViewClients',
      create: 'CanCreateClients',
      edit: 'CanEditClients',
      delete: 'CanDeleteClients',
      restore: 'CanRestoreClients',
      print: 'CanPrintClients',
      export: 'CanExportClients',
      merge: 'CanMergeClients',
      import: 'CanImportClients'
    }),
    cases: Object.freeze({ // القضايا
      view: 'CanViewCases',
      create: 'CanCreateCases',
      edit: 'CanEditCases',
      delete: 'CanDeleteCases',
      restore: 'CanRestoreCases',
      copy: 'CanCopyCases',
      changeStatus: 'CanChangeCaseStatus',
      close: 'CanCloseCases',
      open: 'CanOpenCases',
      transfer: 'CanTransferCases',
      print: 'CanPrintCases',
      export: 'CanExportCases'
    }),
    sessions: Object.freeze({ // الجلسات
      view: 'CanViewSessions',
      create: 'CanCreateSessions',
      edit: 'CanEditSessions',
      delete: 'CanDeleteSessions',
      approve: 'CanApproveSessions'
    }),
    documents: Object.freeze({ // المستندات
      view: 'CanViewDocuments',
      upload: 'CanUploadDocuments',
      download: 'CanDownloadDocuments',
      delete: 'CanDeleteDocuments',
      print: 'CanPrintDocuments',
      share: 'CanShareDocuments'
    }),
    finance: Object.freeze({ // المالية
      viewRevenue: 'CanViewRevenue',
      viewExpenses: 'CanViewExpenses',
      viewInvoices: 'CanViewInvoices',
      manageInvoices: 'CanManageInvoices',
      manageCollection: 'CanManageCollection',
      manageSalaries: 'CanManageSalaries',
      viewReports: 'CanViewFinanceReports'
    }),
    library: Object.freeze({ // المكتبة القانونية
      view: 'CanViewLibrary',
      create: 'CanCreateLibraryItems',
      edit: 'CanEditLibraryItems',
      delete: 'CanDeleteLibraryItems',
      download: 'CanDownloadLibraryItems'
    }),
    settings: Object.freeze({ // الإعدادات
      view: 'CanViewSettings',
      edit: 'CanEditSettings',
      backup: 'CanManageBackup',
      license: 'CanManageLicense',
      branding: 'CanManageBranding',
      data: 'CanManageRawData'
    }),
    users: Object.freeze({ // إدارة المستخدمين والصلاحيات (لوحة إدارة المستخدمين)
      view: 'CanViewUsers',
      create: 'CanCreateUsers',
      edit: 'CanEditUsers',
      delete: 'CanDeleteUsers',
      resetPassword: 'CanResetUserPasswords',
      changeRole: 'CanChangeUserRole',
      manageGroups: 'CanManagePermissionGroups',
      viewAuditLog: 'CanViewAuditLog',
      viewLoginLog: 'CanViewLoginLog',
      endSessions: 'CanEndUserSessions'
    })
  });

  /** @returns {Array<string>} every permission key across every module, flat. */
  function list() {
    var out = [];
    Object.keys(PERMISSIONS).forEach(function (moduleKey) {
      var moduleMap = PERMISSIONS[moduleKey];
      Object.keys(moduleMap).forEach(function (action) {
        out.push(moduleMap[action]);
      });
    });
    return out;
  }

  /** @param {string} key @returns {boolean} whether `key` is a known permission. */
  function existsPermission(key) {
    return list().indexOf(key) !== -1;
  }

  /** @param {string} moduleKey @returns {Object|null} the action->key map for one module. */
  function byModule(moduleKey) {
    return PERMISSIONS[moduleKey] || null;
  }

  var api = {
    PERMISSIONS: PERMISSIONS,
    list: list,
    existsPermission: existsPermission,
    byModule: byModule
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  if (root) {
    root.HossamPermissions = api;
  }
})(typeof window !== 'undefined' ? window : (typeof global !== 'undefined' ? global : this));
