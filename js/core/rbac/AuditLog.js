/**
 * ================================================================
 * AuditLog.js — Activity & Login Log | نظام الحسام للمحاماة
 * ================================================================
 * PHASE 31 — SUB-PHASE 31.1 — Users, Roles & Permissions Core (RBAC)
 *
 * Source of design: brief's "سجل النشاط Audit Log" ("من، ومتى، وماذا
 * فعل") and "سجل الدخول" ("التاريخ، الوقت، الجهاز، IP، المتصفح، نجاح/
 * فشل") sections.
 *
 * WHAT THIS FILE IS
 *   Two small, append-only logs, deliberately NOT built as a Repository
 *   subclass: `dexie-is-accessed-only-through-repositories` governs
 *   mutable business records, but an audit trail's entire value is that
 *   it is NEVER user-editable — exposing update()/delete() on it (as
 *   every Repository does) would be a self-defeating audit trail. Both
 *   logs persist through the SAME DatabaseService/LocalStorageAdapter
 *   pair every Repository uses (so they share the same storage engine
 *   and offline-first guarantees), under their own dedicated keys
 *   (`auditLog`, `loginLog`), with only `record()`/`query()` — no
 *   update, no delete, by design.
 *   FIFO-capped at MAX_ENTRIES per log so an offline-first localStorage
 *   deployment cannot grow this unboundedly forever (brief doesn't
 *   specify a retention policy; a generous default is chosen here and
 *   is trivially raised later — see docs/phase31 report §"Deferred").
 *
 * WHAT THIS FILE IS NOT
 *   - Not a Repository — no create/update/delete/restore, on purpose.
 *   - Does not decide what counts as "sensitive" — callers (Repository.js
 *     guard hook, UsersRepository.js, future login screen) decide when
 *     to call record().
 *
 * Load order: additive file. Depends on DatabaseService.js and
 * LocalStorageAdapter.js (or IndexedDBAdapter.js) having been loaded
 * first, same as every Repository.
 * ================================================================
 */

(function (root) {
  'use strict';

  var DatabaseServiceNS = (typeof module !== 'undefined' && module.exports)
    ? require('../DatabaseService.js') : root;
  var IndexedDBAdapterNS = (typeof module !== 'undefined' && module.exports)
    ? require('../IndexedDBAdapter.js') : root;

  var DatabaseService = DatabaseServiceNS && DatabaseServiceNS.DatabaseService;
  var IndexedDBAdapter = IndexedDBAdapterNS && IndexedDBAdapterNS.IndexedDBAdapter;

  if (typeof DatabaseService !== 'function') {
    throw new Error('AuditLog.js requires js/core/DatabaseService.js to be loaded first.');
  }
  if (typeof IndexedDBAdapter !== 'function') {
    throw new Error('AuditLog.js requires js/core/IndexedDBAdapter.js to be loaded first.');
  }

  var MAX_ENTRIES = 5000;

  /**
   * @class AuditLog
   * @param {{storageKey:string, storageImpl?:Storage, maxEntries?:number}} config
   */
  function AuditLog(config) {
    config = config || {};
    if (!config.storageKey) throw new Error('AuditLog requires a storageKey.');
    this._storageKey = config.storageKey;
    this._maxEntries = config.maxEntries || MAX_ENTRIES;
    var adapter = new IndexedDBAdapter(
      config.storageImpl ? { engineOptions: { indexedDBImpl: config.storageImpl } } : {}
    );
    this._db = new DatabaseService(adapter);
  }

  /**
   * record(entry) -> Promise<Object> the stored entry (with generated id
   * + timestamp attached). Never throws on a full log — trims oldest.
   * @param {Object} entry - arbitrary fields; `المستخدم`, `الإجراء`, and
   *   `الوصف` are the ones every caller in this project is expected to
   *   set (matches brief's "من، ومتى، وماذا فعل").
   */
  AuditLog.prototype.record = async function (entry) {
    var stamped = Object.assign({}, entry, {
      id: 'log_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8),
      الوقت: new Date().toISOString()
    });
    var existing = await this._db.read(this._storageKey);
    var list = Array.isArray(existing) ? existing.slice() : [];
    list.push(stamped);
    if (list.length > this._maxEntries) {
      list = list.slice(list.length - this._maxEntries);
    }
    await this._db.write(this._storageKey, list);
    return stamped;
  };

  /**
   * query(filters?) -> Promise<Array<Object>> most-recent-first.
   * @param {{المستخدم?:string, الإجراء?:string, since?:string}} [filters]
   */
  AuditLog.prototype.query = async function (filters) {
    filters = filters || {};
    var existing = await this._db.read(this._storageKey);
    var list = Array.isArray(existing) ? existing.slice() : [];
    if (filters.المستخدم) list = list.filter(function (e) { return e.المستخدم === filters.المستخدم; });
    if (filters.الإجراء) list = list.filter(function (e) { return e.الإجراء === filters.الإجراء; });
    if (filters.since) list = list.filter(function (e) { return e.الوقت >= filters.since; });
    return list.slice().reverse();
  };

  function createAuditLog(storageImpl) {
    return new AuditLog({ storageKey: 'auditLog', storageImpl: storageImpl });
  }

  function createLoginLog(storageImpl) {
    return new AuditLog({ storageKey: 'loginLog', storageImpl: storageImpl });
  }

  var api = {
    AuditLog: AuditLog,
    createAuditLog: createAuditLog,
    createLoginLog: createLoginLog
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  if (root) {
    // Lazily constructed on first access (getter), NOT at file-load time —
    // consistent with every Repository in this project, which is also
    // only ever constructed on first use, never as a load-time side
    // effect. Avoids depending on IndexedDBAdapter's own readiness timing
    // during initial <script> parsing.
    var auditSingleton = null;
    var loginSingleton = null;
    Object.defineProperty(root, 'HossamAuditLog', {
      configurable: true,
      get: function () { return auditSingleton || (auditSingleton = createAuditLog()); }
    });
    Object.defineProperty(root, 'HossamLoginLog', {
      configurable: true,
      get: function () { return loginSingleton || (loginSingleton = createLoginLog()); }
    });
    root.HossamAuditLogFactory = api;
  }
})(typeof window !== 'undefined' ? window : (typeof global !== 'undefined' ? global : this));
