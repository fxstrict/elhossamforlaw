/**
 * ================================================================
 * ActivityRecorder.js — Real, Persistent Activity Recorder | نظام الحسام للمحاماة
 * ================================================================
 * PHASE — سجل العمليات (صفحة كاملة + رصد حقيقي)
 *
 * WHY THIS FILE EXISTS
 *   The previous "سجل العمليات" side panel (js/modules/historypanel-ui.js
 *   + js/core/HistoryPanel.js) only ever showed each entity's in-memory
 *   UndoManager stack (js/core/UndoManager.js — "no localStorage" by its
 *   own header). That means every entry disappeared on refresh, was
 *   never linked to WHICH account performed it beyond a best-effort
 *   `actorName` on the undo entry, never recorded logins/logouts, never
 *   recorded which page/case/client/client-portal a user simply VIEWED,
 *   and never left the browser it happened in — so an office owner on a
 *   different device could never see it. This file fixes exactly that,
 *   without touching UndoManager/UndoReconciler/HistoryPanel.js's
 *   undo-redo contract at all.
 *
 * WHAT THIS FILE IS
 *   A single, additive, fail-open recorder used by the rest of the app
 *   (Repository.js, SessionContext.js, LoginScreen.js, and the new
 *   js/modules/operations.js page) to persist ONE real activity entry
 *   per real action:
 *     1. Locally, through the EXISTING js/core/rbac/AuditLog.js
 *        (`HossamAuditLog`/`HossamLoginLog` — already wired to
 *        DatabaseService/IndexedDBAdapter, i.e. real IndexedDB, not
 *        memory) — so the Operations page's content survives a refresh
 *        and is never blank/reset the way the old panel was.
 *     2. Remotely, through the EXISTING js/api/api.js `ApiService`
 *        (`saveData()` — the exact same call every Repository already
 *        uses to sync a row to Google Sheets), into a new sheet
 *        'سجل_العمليات' (see Config/00_Config.gs SHEET_DEFS) — so the
 *        office owner sees every action from every device/account
 *        centrally and close to real time, the same way every other
 *        sheet in this app already works. Falls back to
 *        `OfflineQueue.enqueue()` (already used by every other
 *        ApiService write) when offline, exactly like every Repository.
 *
 * WHAT THIS FILE IS NOT
 *   - Not a Repository. Append-only, same design rationale as
 *     AuditLog.js itself (an audit trail must never be user-editable).
 *   - Never throws into its caller. Every public method is wrapped so a
 *     storage/network failure degrades only the log, never the action
 *     the log is describing (identical fail-isolation philosophy to
 *     Repository.js's own `_recordUndo()`).
 *
 * Load order: additive file. Depends on js/core/rbac/AuditLog.js (and
 * therefore DatabaseService.js/IndexedDBAdapter.js) and, optionally, on
 * js/api/api.js + js/core/OfflineQueue.js (both already loaded earlier
 * in index.html — see load-order comment at this file's <script> tag).
 * ================================================================
 */

(function (root) {
  'use strict';

  var SHEET_NAME = 'سجل_العمليات';

  // ----------------------------------------------------------------
  // Actor resolution — works whether or not RBAC/login is configured
  // at all (fail-open, matching every other optional integration point
  // in this project — see SessionContext.js header).
  // ----------------------------------------------------------------
  function currentActor() {
    try {
      var user = root.HossamSession && typeof root.HossamSession.getCurrentUser === 'function'
        ? root.HossamSession.getCurrentUser() : null;
      if (user) {
        return {
          المستخدم: user.اسم_المستخدم || user.id || null,
          الاسم_الظاهر: user.الاسم || user.اسم_المستخدم || user.id || 'مستخدم',
          الدور: user.الدور || null
        };
      }
    } catch (e) { /* fail open */ }
    return { المستخدم: null, الاسم_الظاهر: 'مستخدم غير مسجل الدخول', الدور: null };
  }

  function deviceInfo() {
    try {
      return (typeof navigator !== 'undefined' && navigator.userAgent) ? navigator.userAgent : '';
    } catch (e) { return ''; }
  }

  function nowIso() { return new Date().toISOString(); }

  // ----------------------------------------------------------------
  // Remote sync — best-effort, never blocks/breaks the caller. Reuses
  // the exact same ApiService/OfflineQueue pipeline every Repository
  // already relies on for Google Sheets sync.
  // ----------------------------------------------------------------
  function pushToSheet(row) {
    try {
      if (root.ApiService && typeof root.ApiService.saveData === 'function') {
        root.ApiService.saveData(SHEET_NAME, row).catch(function () { /* saveData already queues offline internally */ });
      }
    } catch (e) { /* never let a sync failure break the caller */ }
  }

  function pushBeacon(row) {
    // Best-effort synchronous-ish delivery for page-hide/close events,
    // where a normal fetch() may be aborted before it completes. Falls
    // back to the regular async path when sendBeacon/API_URL aren't
    // available — never throws either way.
    try {
      var url = (typeof API_URL !== 'undefined' ? API_URL : '') || '';
      if (url && typeof navigator !== 'undefined' && navigator.sendBeacon) {
        var blob = new Blob([JSON.stringify({ action: 'add', sheet: SHEET_NAME, data: row })], { type: 'text/plain' });
        var ok = navigator.sendBeacon(url, blob);
        if (ok) return;
      }
    } catch (e) { /* fall through to normal path */ }
    pushToSheet(row);
  }

  /**
   * The one low-level entry point. Every convenience helper below
   * ultimately calls this. Never throws.
   * @param {Object} fields - any subset of the سجل_العمليات columns;
   *   المستخدم/الاسم_الظاهر/الدور/الوقت/الجهاز are always stamped here.
   * @param {{beacon?:boolean}} [opts]
   * @returns {Object} the stamped entry (also already queued for
   *   local + remote persistence — this return value is for immediate,
   *   optimistic UI use only, e.g. by js/modules/operations.js).
   */
  function record(fields, opts) {
    var actor = currentActor();
    var entry = Object.assign({
      id: 'act_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8),
      الوقت: nowIso(),
      الجهاز: deviceInfo()
    }, actor, fields || {});

    try {
      if (root.HossamAuditLog && typeof root.HossamAuditLog.record === 'function') {
        root.HossamAuditLog.record(entry).catch(function () { /* local persistence best-effort */ });
      }
    } catch (e) { /* never break the caller */ }

    try {
      if (opts && opts.beacon) pushBeacon(entry); else pushToSheet(entry);
    } catch (e) { /* never break the caller */ }

    return entry;
  }

  // ----------------------------------------------------------------
  // Convenience helpers — one per real-world event this project's
  // brief asked to see ("من فتحه، وأخذ وقت أد إيه، وأغلقه متى، وأي
  // إجراء قام به حتى تصفح قضية أو بوابة موكل").
  // ----------------------------------------------------------------

  /** تسجيل دخول (نجاح/فشل) — يُستدعى بجانب HossamLoginLog.record() الحالي. */
  function recordLogin(username, success, reason) {
    return record({
      الإجراء: success ? 'تسجيل_دخول' : 'محاولة_دخول_فاشلة',
      الوحدة: 'auth',
      الوصف: success ? ('تسجيل دخول ناجح: ' + username) : ('محاولة دخول فاشلة: ' + username + (reason ? (' — ' + reason) : '')),
      نجاح: !!success
    });
  }

  /** تسجيل خروج، مع مدة الجلسة الفعلية بالثواني إن توفرت. */
  function recordLogout(username, sessionDurationMs) {
    var secs = (typeof sessionDurationMs === 'number' && isFinite(sessionDurationMs) && sessionDurationMs >= 0)
      ? Math.round(sessionDurationMs / 1000) : null;
    return record({
      الإجراء: 'تسجيل_خروج',
      الوحدة: 'auth',
      الوصف: 'تسجيل خروج: ' + (username || '—') + (secs !== null ? (' — مدة الجلسة: ' + humanDuration(secs)) : ''),
      المدة_ثانية: secs
    });
  }

  /**
   * زيارة صفحة كاملة انتهت (تُسجَّل عند مغادرة الصفحة، مع مدة البقاء فيها).
   * @param {{beacon?:boolean}} [opts] - beacon:true عند إغلاق/إخفاء الصفحة
   *   (js/modules/operations.js's visibilitychange/pagehide handlers)،
   *   لضمان وصول الحدث حتى لو أُغلق التطبيق فورًا.
   */
  function recordPageVisit(pageKey, pageTitle, durationMs, opts) {
    var secs = (typeof durationMs === 'number' && isFinite(durationMs) && durationMs >= 0)
      ? Math.round(durationMs / 1000) : null;
    return record({
      الإجراء: 'فتح_صفحة',
      الوحدة: pageKey || '',
      الهدف_النوع: 'صفحة',
      الهدف_الاسم: pageTitle || pageKey || '',
      الوصف: 'فتح صفحة "' + (pageTitle || pageKey || '') + '"' + (secs !== null ? (' لمدة ' + humanDuration(secs)) : ''),
      المدة_ثانية: secs
    }, opts);
  }

  /** عرض سجل بعينه (قضية/موكل/بوابة موكل...) دون تعديل. */
  function recordView(moduleKey, targetType, targetId, targetLabel) {
    return record({
      الإجراء: 'عرض',
      الوحدة: moduleKey || '',
      الهدف_النوع: targetType || '',
      الهدف_المعرف: (targetId === undefined || targetId === null) ? '' : String(targetId),
      الهدف_الاسم: targetLabel || '',
      الوصف: 'اطّلع على ' + (targetType || 'سجل') + (targetLabel ? (': ' + targetLabel) : '')
    });
  }

  var OP_VERB = { create: 'أنشأ', update: 'عدّل', delete: 'حذف', restore: 'استرجع' };
  var OP_ACTION = { create: 'إنشاء', update: 'تعديل', delete: 'حذف', restore: 'استرجاع' };

  /**
   * تسجيل عملية حقيقية على سجل (إنشاء/تعديل/حذف/استرجاع). مصمَّم
   * ليُستدعى من نقطة واحدة (Repository.js `_recordUndo`) تغطي كل
   * الكيانات التسعة معًا بدل الاعتماد على التفاف 45 دالة عامة من الخارج.
   * @param {string} entityLabel - عربي مقروء، مثال: 'قضية'، 'موكل'
   * @param {string} op - 'create'|'update'|'delete'|'restore'
   * @param {string} moduleKey - مفتاح الوحدة، مثال: 'cases'
   * @param {string} targetLabel - عنوان/اسم السجل المتأثر إن أمكن استنتاجه
   * @param {string|number} targetId
   */
  function recordEntityAction(entityLabel, op, moduleKey, targetLabel, targetId) {
    var verb = OP_VERB[op] || op;
    return record({
      الإجراء: OP_ACTION[op] || op,
      الوحدة: moduleKey || '',
      الهدف_النوع: entityLabel || '',
      الهدف_المعرف: (targetId === undefined || targetId === null) ? '' : String(targetId),
      الهدف_الاسم: targetLabel || '',
      الوصف: verb + ' ' + (entityLabel || 'سجل') + (targetLabel ? (': ' + targetLabel) : '')
    });
  }

  // ----------------------------------------------------------------
  // Repository integration — ONE small, additive hook call from
  // js/core/Repository.js's existing `_recordUndo(method, args)` (see
  // that file's own comment at the call site) covers all 9 entities x
  // 4 operations from a single place, instead of relying on wrapping
  // 45 separate global function names from the outside (fragile: a
  // renamed/added entity function would silently stop being tracked).
  // Mirrors js/core/HistoryPanel.js's own REGISTRY/labelFor() shape,
  // deliberately duplicated (not imported) — this file must never
  // depend on HistoryPanel.js loading, and vice versa.
  // ----------------------------------------------------------------
  var ENTITY_META = {
    cases:          { label: 'قضية',        idField: 'رقم_القضية',  labelFields: ['عنوان_القضية', 'اسم_الموكل'] },
    clients:        { label: 'موكل',        idField: 'رقم_الموكل',  labelFields: ['الاسم'] },
    opponents:      { label: 'خصم',         idField: 'رقم_الخصم',   labelFields: ['الاسم'] },
    clientMessages: { label: 'رسالة موكل',   idField: 'id',           labelFields: ['نص_الرسالة'] },
    children:       { label: 'طفل',         idField: 'رقم_الطفل',   labelFields: ['الاسم', 'اسم'] },
    sessions:       { label: 'جلسة',        idField: 'رقم_الجلسة',  labelFields: ['عنوان_القضية'] },
    tasks:          { label: 'مهمة',        idField: 'رقم_المهمة',  labelFields: ['العنوان'] },
    fees:           { label: 'أتعاب',       idField: 'رقم_العملية', labelFields: ['اسم_الموكل'] },
    documents:      { label: 'مستند',       idField: 'رقم_المستند', labelFields: ['اسم_المستند'] },
    library:        { label: 'كتاب',        idField: 'id',           labelFields: ['العنوان'] },
    templates:      { label: 'صيغة',        idField: 'id',           labelFields: ['العنوان'] },
    users:          { label: 'مستخدم',      idField: 'id',           labelFields: ['الاسم', 'اسم_المستخدم'] },
    settings:       { label: 'إعدادات',     idField: 'id',           labelFields: [] }
  };
  var METHOD_TO_OP = { recordCreate: 'create', recordUpdate: 'update', recordDelete: 'delete', recordRestore: 'restore' };

  /**
   * @param {string} entityKey - Repository.prototype.entityKey (e.g. 'cases')
   * @param {string} method - the `_recordUndo` method name (e.g. 'recordCreate')
   * @param {Array} args - the exact args `_recordUndo` was called with
   */
  function recordFromRepository(entityKey, method, args) {
    try {
      var meta = ENTITY_META[entityKey];
      var op = METHOD_TO_OP[method];
      if (!meta || !op) return null; // unmapped entity/operation -> silently skipped, fail-open

      var rec = (op === 'delete') ? args[0] : (op === 'update' || op === 'restore') ? args[1] : args[0];
      if (!rec || Array.isArray(rec)) {
        // Whole-repository snapshot (bulkUpdate()/import()/transaction()/
        // clear()) — same honesty rule as HistoryPanel.js's `isSnapshotArray`:
        // label it as a bulk operation instead of guessing a record name.
        return recordEntityAction(meta.label + ' (تحديث جماعي)', op, entityKey, null, null);
      }
      var label = null;
      for (var i = 0; i < meta.labelFields.length; i++) {
        var v = rec[meta.labelFields[i]];
        if (v !== undefined && v !== null && String(v).trim() !== '') { label = String(v); break; }
      }
      var id = rec[meta.idField];
      return recordEntityAction(meta.label, op, entityKey, label, id);
    } catch (e) {
      return null; // never let logging break the calling Repository action
    }
  }

  function humanDuration(totalSeconds) {
    if (totalSeconds === null || totalSeconds === undefined) return '';
    var s = Math.max(0, Math.round(totalSeconds));
    if (s < 60) return s + ' ث';
    var m = Math.floor(s / 60), rem = s % 60;
    if (m < 60) return m + ' د' + (rem ? ' ' + rem + ' ث' : '');
    var h = Math.floor(m / 60), remM = m % 60;
    return h + ' س' + (remM ? ' ' + remM + ' د' : '');
  }

  // ----------------------------------------------------------------
  // Feed — merges the persisted local logs (survives refresh) for the
  // new Operations page. Remote (Sheets) is the cross-device source of
  // truth; this local feed is the fast/offline-capable read path.
  // ----------------------------------------------------------------
  async function getFeed(filters) {
    filters = filters || {};
    var activity = (root.HossamAuditLog ? await root.HossamAuditLog.query({}) : []) || [];
    var logins = (root.HossamLoginLog ? await root.HossamLoginLog.query({}) : []) || [];
    var loginsNormalized = logins.map(function (e) {
      return Object.assign({
        الإجراء: e.نجاح ? 'تسجيل_دخول' : 'محاولة_دخول_فاشلة',
        الوحدة: 'auth',
        الاسم_الظاهر: e.المستخدم || 'مستخدم',
        الوصف: e.نجاح ? ('تسجيل دخول ناجح: ' + e.المستخدم) : ('محاولة دخول فاشلة: ' + e.المستخدم + (e.سبب ? (' — ' + e.سبب) : ''))
      }, e);
    });
    // Avoid double-counting: recordLogin() already writes an equivalent
    // entry into HossamAuditLog directly, so entries that clearly came
    // from LoginScreen.js's own HossamLoginLog.record() are merged only
    // when ActivityRecorder's own login entry is absent (older data /
    // any call site that only ever called HossamLoginLog directly).
    var merged = activity.concat(loginsNormalized.filter(function (l) {
      return !activity.some(function (a) { return a.الإجراء && a.الإجراء.indexOf('دخول') !== -1 && a.الوقت === l.الوقت && a.المستخدم === l.المستخدم; });
    }));

    if (filters.action) merged = merged.filter(function (e) { return e.الإجراء === filters.action; });
    if (filters.moduleKey) merged = merged.filter(function (e) { return e.الوحدة === filters.moduleKey; });
    if (filters.username) merged = merged.filter(function (e) { return e.المستخدم === filters.username; });
    if (filters.since) merged = merged.filter(function (e) { return e.الوقت >= filters.since; });
    if (filters.query) {
      var q = String(filters.query).toLowerCase();
      merged = merged.filter(function (e) {
        return [e.الوصف, e.الاسم_الظاهر, e.الهدف_الاسم, e.الوحدة, e.الإجراء]
          .some(function (v) { return v && String(v).toLowerCase().indexOf(q) !== -1; });
      });
    }

    merged.sort(function (a, b) { return new Date(b.الوقت) - new Date(a.الوقت); });
    return merged;
  }

  var api = {
    record: record,
    recordLogin: recordLogin,
    recordLogout: recordLogout,
    recordPageVisit: recordPageVisit,
    recordView: recordView,
    recordEntityAction: recordEntityAction,
    recordFromRepository: recordFromRepository,
    getFeed: getFeed,
    humanDuration: humanDuration,
    SHEET_NAME: SHEET_NAME
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  if (root) {
    root.HossamActivity = api;
  }
})(typeof window !== 'undefined' ? window : (typeof global !== 'undefined' ? global : this));
