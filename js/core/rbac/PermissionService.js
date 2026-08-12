/**
 * ================================================================
 * PermissionService.js — Authorization Engine | نظام الحسام للمحاماة
 * ================================================================
 * PHASE 31 — SUB-PHASE 31.1 — Users, Roles & Permissions Core (RBAC)
 *
 * Source of design: brief's "المستوى الخامس" (Permissions) + "صلاحيات
 * حسب القضية / الموكل / الفرع / القسم" (scope-based access).
 *
 * WHAT THIS FILE IS
 *   The ONE place a yes/no permission decision is actually computed.
 *   Resolution order, matching the brief's own layered model exactly
 *   (المستخدم -> الدور الوظيفي -> الصلاحيات -> القيود الأمنية):
 *     1. Base = permissions granted by the user's Role (Roles.js).
 *     2. + permissions granted by every Permission Group assigned to the
 *        user (PermissionGroups.js, `مجموعات_الصلاحيات` field).
 *     3. + `فردية_مسموحة` (individual per-user allow-list overrides).
 *     4. - `فردية_ممنوعة` (individual per-user deny-list overrides —
 *        deny always wins over allow/role/group, per the brief's own
 *        example: "كل المتدربين لا يحذفون، إلا محمد له صلاحية الحذف" —
 *        i.e. overrides exist precisely to add/remove permissions
 *        outside what Role/Groups already say, and an explicit deny is
 *        the stronger, more specific signal so it always wins ties).
 *   Scope checks (per-record, on top of the boolean permission check
 *   above) cover the brief's "صلاحيات حسب القضية / الموكل / الفرع /
 *   القسم" section: a user who CAN view cases in general may still be
 *   denied a SPECIFIC case if they are not its responsible/assistant/
 *   trainee lawyer, not in its branch, or not in its department — unless
 *   they hold an office-wide role (see `isOfficeWide`).
 *
 * WHAT THIS FILE IS NOT
 *   - It does not touch the DOM, localStorage directly, or any Module.
 *   - It does not decide WHO the current user is (SessionContext.js).
 *   - It is deliberately fail-closed on `can()` (unknown user/permission
 *     => false) but the whole RBAC layer is fail-OPEN at the integration
 *     seam (Repository.js only enforces when a session is actually
 *     registered — see SessionContext.js header), so a deployment that
 *     has not turned RBAC on yet is completely unaffected.
 *
 * Load order: additive file. Depends on Permissions.js, Roles.js,
 * PermissionGroups.js having been loaded first.
 * ================================================================
 */

(function (root) {
  'use strict';

  var PermissionsNS = (typeof module !== 'undefined' && module.exports)
    ? require('./Permissions.js') : root.HossamPermissions;
  var RolesNS = (typeof module !== 'undefined' && module.exports)
    ? require('./Roles.js') : root.HossamRoles;
  var GroupsNS = (typeof module !== 'undefined' && module.exports)
    ? require('./PermissionGroups.js') : root.HossamPermissionGroups;

  if (!PermissionsNS) throw new Error('PermissionService.js requires Permissions.js first.');
  if (!RolesNS) throw new Error('PermissionService.js requires Roles.js first.');
  if (!GroupsNS) throw new Error('PermissionService.js requires PermissionGroups.js first.');

  /**
   * Resolves the full, flat set of permission keys a user record
   * currently holds (Role ∪ Groups ∪ allow − deny). Pure function, no
   * side effects, no I/O — takes a plain user record shape (see
   * UsersRepository.js "شكل السجل"), not a class instance.
   * @param {Object} user
   * @returns {Object} map permissionKey -> true (a Set-shaped object,
   *   for O(1) lookups without requiring an ES6 Set polyfill).
   */
  function resolvePermissions(user) {
    var granted = {};
    if (!user) return granted;

    (RolesNS.permissionsOf(user.الدور)).forEach(function (k) { granted[k] = true; });

    (user.مجموعات_الصلاحيات || []).forEach(function (groupKey) {
      GroupsNS.permissionsOf(groupKey).forEach(function (k) { granted[k] = true; });
    });

    var overrides = user.صلاحيات_فردية || {};
    (overrides.مسموحة || []).forEach(function (k) { granted[k] = true; });
    (overrides.ممنوعة || []).forEach(function (k) { delete granted[k]; });

    return granted;
  }

  /**
   * can(user, permissionKey) -> boolean
   * The core boolean check. Unknown permission key or missing/inactive
   * user always resolves to false (fail-closed).
   * @param {Object} user
   * @param {string} permissionKey - one of Permissions.js's keys.
   * @returns {boolean}
   */
  function can(user, permissionKey) {
    if (!user || user.الحالة !== 'نشط') return false;
    if (!PermissionsNS.existsPermission(permissionKey)) return false;
    var granted = resolvePermissions(user);
    return granted[permissionKey] === true;
  }

  /**
   * Roles whose users may see every record regardless of branch/
   * department/case-assignment scoping (office_owner, executive_manager,
   * partner per the brief's own "يرى كل القضايا" for الشريك).
   */
  var OFFICE_WIDE_ROLES = { office_owner: true, executive_manager: true, partner: true };

  /** @param {Object} user @returns {boolean} */
  function isOfficeWide(user) {
    return !!(user && OFFICE_WIDE_ROLES[user.الدور]);
  }

  /**
   * canAccessCase(user, caseRecord) -> boolean
   * Brief: "ليس كل محام يرى كل القضايا... فقط هؤلاء يرونها" (assigned
   * lawyer/assistant/trainee on the case), plus branch/department
   * scoping ("كل فرع يرى قضاياه فقط" / "كل محام يرى قسمه"), plus VIP
   * client scoping ("بعض الموكلين... لا يراها إلا: المدير/صاحب
   * المكتب/الشريك"). All checks below are ADDITIVE narrowing on top of
   * the base CanViewCases permission — call can(user,'CanViewCases')
   * first; this function only narrows to a SPECIFIC record.
   * @param {Object} user
   * @param {Object} caseRecord - expected optional fields (all optional;
   *   absent = not scoped on that axis, so it doesn't restrict):
   *   `المسئول`, `المساعد`, `المتدرب` (user ids on the case),
   *   `الفرع`, `القسم` (branch/department the case belongs to),
   *   `عميل_حساس` (boolean — VIP/sensitive client flag).
   * @returns {boolean}
   */
  function canAccessCase(user, caseRecord) {
    if (!user || !caseRecord) return false;
    if (isOfficeWide(user)) return true;

    if (caseRecord.عميل_حساس === true) return false; // narrowed above already for office-wide roles

    var assigned = [caseRecord.المسئول, caseRecord.المساعد, caseRecord.المتدرب].filter(Boolean);
    if (assigned.length > 0 && assigned.indexOf(user.id) === -1) return false;

    if (caseRecord.الفرع && user.الفرع && caseRecord.الفرع !== user.الفرع) return false;
    if (caseRecord.القسم && user.القسم && caseRecord.القسم !== user.القسم) return false;

    return true;
  }

  /**
   * withinLoginWindow(user, now?) -> boolean
   * Brief: "صلاحيات حسب الوقت — يمكن تسجيل الدخول من 8 صباحاً حتى 8
   * مساءً". Optional per-user field `نافذة_الدخول: {من:'HH:MM', إلى:'HH:MM'}`
   * — absent means unrestricted (default true), matching this whole
   * module's fail-open-when-unconfigured design.
   * @param {Object} user
   * @param {Date} [now]
   * @returns {boolean}
   */
  function withinLoginWindow(user, now) {
    var window_ = user && user.نافذة_الدخول;
    if (!window_ || !window_.من || !window_.إلى) return true;
    now = now || new Date();
    var minutesNow = now.getHours() * 60 + now.getMinutes();
    var toMinutes = function (hhmm) {
      var parts = String(hhmm).split(':');
      return (parseInt(parts[0], 10) || 0) * 60 + (parseInt(parts[1], 10) || 0);
    };
    var from = toMinutes(window_.من);
    var to = toMinutes(window_.إلى);
    if (from <= to) return minutesNow >= from && minutesNow <= to;
    return minutesNow >= from || minutesNow <= to; // overnight window (e.g. 20:00 -> 06:00)
  }

  var api = {
    resolvePermissions: resolvePermissions,
    can: can,
    isOfficeWide: isOfficeWide,
    canAccessCase: canAccessCase,
    withinLoginWindow: withinLoginWindow
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  if (root) {
    root.HossamPermissionService = api;
  }
})(typeof window !== 'undefined' ? window : (typeof global !== 'undefined' ? global : this));
