/**
 * ================================================================
 * IndexedDBSchema.js — Database Schema Definition | نظام الحسام للمحاماة
 * ================================================================
 * PHASE 13.3A — IndexedDB Foundation — Database Engine Core
 *
 * WHAT THIS FILE IS
 *   A pure, declarative description of the future IndexedDB database:
 *   its name, its version, and the object stores + indexes each version
 *   introduces. No code here ever calls `indexedDB.open()` or touches a
 *   real `IDBDatabase`/`IDBTransaction` — this file only describes the
 *   shape those future calls (IndexedDBEngine.js, IndexedDBVersion.js)
 *   will apply.
 *
 * WHAT THIS FILE IS NOT
 *   - It does not open, upgrade, or migrate anything.
 *   - It does not read or write LocalStorage or IndexedDB.
 *   - It does not modify Repository.js, StorageAdapter.js,
 *     LocalStorageAdapter.js, DatabaseService.js, or any Repository.
 *
 * Primary keys: every store's `keyPath` matches that entity's actual
 * Repository `idField` (e.g. `رقم_القضية` for `cases`, `رقم_الموكل` for
 * `clients`, ... `id` only for `library`/`templates`/`settings`/
 * `metadata`, which really do use `id`) — no new ids are generated
 * here, matching the Phase 13.3A "preserve current Repository IDs"
 * requirement. See `IndexedDB_KeyPath_Audit.md` (PHASE 13.3A-HOTFIX)
 * for the full per-store audit that produced this mapping.
 * ================================================================
 */

(function (root) {
  'use strict';

  var DB_NAME = 'HossamLawOffice';
  // INTEGRATION PHASE — Client Portal Messages Wiring: bumped 1 -> 2 to
  // add the 'clientMessages' object store (see SCHEMA_VERSIONS version 2
  // step below). Existing stores/indexes from version 1 are untouched —
  // IndexedDBVersion.js's ensureStore() is existence-guarded, so an
  // already-provisioned database only gains the one new store.
  // PHASE 31 — Users, Roles & Permissions Core (RBAC): bumped 2 -> 3 to
  // add the 'users', 'auditLog', and 'loginLog' object stores (see
  // SCHEMA_VERSIONS version 3 step below). Existing stores/indexes from
  // versions 1-2 are untouched — IndexedDBVersion.js's ensureStore() is
  // existence-guarded, so an already-provisioned database only gains
  // the three new stores on next open.
  // PHASE 37 — Opponents Module (الخصوم): bumped 3 -> 4 to add the
  // 'opponents' object store (see SCHEMA_VERSIONS version 4 step
  // below), mirroring the 'clients' store exactly (same keyPath
  // strategy: the actual OpponentsRepository idField, not a generic
  // 'id'). Existing stores/indexes from versions 1-3 are untouched —
  // IndexedDBVersion.js's ensureStore() is existence-guarded, so an
  // already-provisioned database only gains the one new store on next
  // open. No conflict with 'clients'/'cases'/any other store: purely
  // additive, own store name, own keyPath, own indexes.
  // PHASE 38 — Process Server Works Module (أعمال المحضرين): bumped
  // 4 -> 5 to add the 'processServerWorks' object store (see
  // SCHEMA_VERSIONS version 5 step below), mirroring the 'opponents'
  // store exactly (same keyPath strategy: the actual
  // ProcessServerWorksRepository idField, not a generic 'id').
  // Existing stores/indexes from versions 1-4 are untouched —
  // IndexedDBVersion.js's ensureStore() is existence-guarded, so an
  // already-provisioned database only gains the one new store on next
  // open. No conflict with 'clients'/'cases'/'opponents'/any other
  // store: purely additive, own store name, own keyPath, own indexes.
  // CASES_RELATIONSHIP_FINANCIAL: bumped 5 -> 6 to add the 'caseClients'
  // (ID-based Case<->Client junction, decision §3-C) and 'expenses'
  // (3-level Client/Case/Office expenses, decision §3-G) object stores
  // (see SCHEMA_VERSIONS version 6 step below). Existing stores/indexes
  // from versions 1-5 are untouched — ensureStore() is existence-guarded,
  // so an already-provisioned database only gains the two new stores on
  // next open. No conflict with 'clients'/'cases'/'opponents'/any other
  // store: purely additive, own store names, own keyPaths, own indexes.
  var DB_VERSION = 6;

  // ----------------------------------------------------------------
  // Index definitions per store. Only indexes an existing Repository/
  // Module actually filters, sorts, or looks up by are declared — no
  // speculative over-indexing (per Phase 13.3A "DO NOT over-index").
  // `unique: false` everywhere: uniqueness is a Repository-level
  // concern (id already is the keyPath and is implicitly unique),
  // not something this storage layer enforces on secondary fields.
  // ----------------------------------------------------------------

  var COMMON_AUDIT_INDEXES = [
    { name: 'createdAt', keyPath: 'createdAt', unique: false },
    { name: 'updatedAt', keyPath: 'updatedAt', unique: false }
  ];

  /**
   * STORE_DEFINITIONS — one entry per object store.
   * Shape: { name, keyPath, autoIncrement, indexes: [{name, keyPath, unique, multiEntry?}] }
   */
  // V1_STORE_DEFINITIONS — the original 9 stores, exactly as SCHEMA_VERSIONS
  // version 1 already applied them. Left byte-for-byte unchanged so the
  // version 1 upgrade step below still describes precisely what it always
  // described.
  var V1_STORE_DEFINITIONS = [
    {
      name: 'cases',
      keyPath: 'رقم_القضية',
      autoIncrement: false,
      indexes: [
        { name: 'code', keyPath: 'code', unique: false },
        { name: 'clientId', keyPath: 'clientId', unique: false },
        { name: 'status', keyPath: 'status', unique: false },
        { name: 'searchText', keyPath: 'searchText', unique: false }
      ].concat(COMMON_AUDIT_INDEXES)
    },
    {
      name: 'clients',
      keyPath: 'رقم_الموكل',
      autoIncrement: false,
      indexes: [
        { name: 'code', keyPath: 'code', unique: false },
        { name: 'name', keyPath: 'name', unique: false },
        { name: 'searchText', keyPath: 'searchText', unique: false }
      ].concat(COMMON_AUDIT_INDEXES)
    },
    {
      name: 'sessions',
      keyPath: 'رقم_الجلسة',
      autoIncrement: false,
      indexes: [
        { name: 'caseId', keyPath: 'caseId', unique: false },
        { name: 'clientId', keyPath: 'clientId', unique: false },
        { name: 'sessionDate', keyPath: 'sessionDate', unique: false },
        { name: 'status', keyPath: 'status', unique: false }
      ].concat(COMMON_AUDIT_INDEXES)
    },
    {
      name: 'documents',
      keyPath: 'رقم_المستند',
      autoIncrement: false,
      indexes: [
        { name: 'caseId', keyPath: 'caseId', unique: false },
        { name: 'clientId', keyPath: 'clientId', unique: false },
        { name: 'name', keyPath: 'name', unique: false },
        { name: 'searchText', keyPath: 'searchText', unique: false }
      ].concat(COMMON_AUDIT_INDEXES)
    },
    {
      name: 'tasks',
      keyPath: 'رقم_المهمة',
      autoIncrement: false,
      indexes: [
        { name: 'caseId', keyPath: 'caseId', unique: false },
        { name: 'clientId', keyPath: 'clientId', unique: false },
        { name: 'status', keyPath: 'status', unique: false }
      ].concat(COMMON_AUDIT_INDEXES)
    },
    {
      name: 'children',
      keyPath: 'رقم_الطفل',
      autoIncrement: false,
      indexes: [
        { name: 'caseId', keyPath: 'caseId', unique: false },
        { name: 'clientId', keyPath: 'clientId', unique: false },
        { name: 'name', keyPath: 'name', unique: false }
      ].concat(COMMON_AUDIT_INDEXES)
    },
    {
      name: 'fees',
      keyPath: 'رقم_العملية',
      autoIncrement: false,
      indexes: [
        { name: 'caseId', keyPath: 'caseId', unique: false },
        { name: 'clientId', keyPath: 'clientId', unique: false },
        { name: 'status', keyPath: 'status', unique: false }
      ].concat(COMMON_AUDIT_INDEXES)
    },
    {
      name: 'library',
      keyPath: 'id',
      autoIncrement: false,
      indexes: [
        { name: 'name', keyPath: 'name', unique: false },
        { name: 'searchText', keyPath: 'searchText', unique: false }
      ].concat(COMMON_AUDIT_INDEXES)
    },
    {
      name: 'templates',
      keyPath: 'id',
      autoIncrement: false,
      indexes: [
        { name: 'name', keyPath: 'name', unique: false },
        { name: 'code', keyPath: 'code', unique: false }
      ].concat(COMMON_AUDIT_INDEXES)
    },
    {
      name: 'settings',
      keyPath: 'id',
      autoIncrement: false,
      // Settings is a small, singleton-ish store — audit indexes are
      // sufficient; no secondary lookup fields exist for it today.
      indexes: COMMON_AUDIT_INDEXES.slice()
    },
    {
      name: 'metadata',
      keyPath: 'id',
      autoIncrement: false,
      // Engine bookkeeping store (schema version markers, future
      // migration checkpoints). No secondary indexes needed.
      indexes: []
    }
  ];

  // ----------------------------------------------------------------
  // V2_STORE_DEFINITIONS — INTEGRATION PHASE: Client Portal Messages
  // Wiring. One new store: 'clientMessages', backing the already-live
  // 'رسائل_الموكل' sheet (Config/00_Config.gs SHEET_DEFS) and already-live
  // Config/05_Portal.gs reads. keyPath 'id' (hybrid id, same strategy as
  // 'library'/'templates' above — no natural key exists for a message).
  // ----------------------------------------------------------------
  var V2_STORE_DEFINITIONS = [
    {
      name: 'clientMessages',
      keyPath: 'id',
      autoIncrement: false,
      indexes: [
        { name: 'clientId', keyPath: 'clientId', unique: false },
        { name: 'caseId', keyPath: 'caseId', unique: false },
        { name: 'searchText', keyPath: 'searchText', unique: false }
      ].concat(COMMON_AUDIT_INDEXES)
    }
  ];

  // ----------------------------------------------------------------
  // V3_STORE_DEFINITIONS — PHASE 31: Users, Roles & Permissions Core
  // (RBAC). Three new stores, all additive, nothing from version 1 or
  // 2 touched: 'users' (UsersRepository.js, keyPath matches its
  // idField اسم_المستخدم — same "keyPath = actual Repository idField"
  // rule this whole file documents at its own header), and 'auditLog'/
  // 'loginLog' (AuditLog.js — append-only, no Repository sits on top of
  // them, but they still persist through this same schema/engine so an
  // offline-first deployment keeps one single storage story).
  // ----------------------------------------------------------------
  var V3_STORE_DEFINITIONS = [
    {
      name: 'users',
      keyPath: 'اسم_المستخدم',
      autoIncrement: false,
      indexes: [
        { name: 'name', keyPath: 'الاسم', unique: false },
        { name: 'status', keyPath: 'الحالة', unique: false },
        { name: 'role', keyPath: 'الدور', unique: false }
      ].concat(COMMON_AUDIT_INDEXES)
    },
    {
      name: 'auditLog',
      keyPath: 'id',
      autoIncrement: false,
      indexes: [
        { name: 'user', keyPath: 'المستخدم', unique: false },
        { name: 'action', keyPath: 'الإجراء', unique: false }
      ]
    },
    {
      name: 'loginLog',
      keyPath: 'id',
      autoIncrement: false,
      indexes: [
        { name: 'user', keyPath: 'المستخدم', unique: false }
      ]
    }
  ];

  // ----------------------------------------------------------------
  // V4_STORE_DEFINITIONS — PHASE 37: Opponents Module (الخصوم). One
  // new store: 'opponents', backing the new 'الخصوم' GAS sheet
  // (Config/00_Config.gs SHEET_DEFS) and js/repositories/
  // OpponentsRepository.js. keyPath 'رقم_الخصم' — same "keyPath =
  // actual Repository idField" rule this file's header documents,
  // mirroring 'clients' -> 'رقم_الموكل' exactly. Purely additive: does
  // not touch 'clients', 'cases', or any other store/index.
  // ----------------------------------------------------------------
  var V4_STORE_DEFINITIONS = [
    {
      name: 'opponents',
      keyPath: 'رقم_الخصم',
      autoIncrement: false,
      indexes: [
        { name: 'name', keyPath: 'الاسم', unique: false },
        { name: 'searchText', keyPath: 'searchText', unique: false }
      ].concat(COMMON_AUDIT_INDEXES)
    }
  ];

  // ----------------------------------------------------------------
  // V5_STORE_DEFINITIONS — PHASE 38: Process Server Works Module
  // (أعمال المحضرين). One new store: 'processServerWorks', backing the
  // new 'أعمال_المحضرين' GAS sheet (Config/00_Config.gs SHEET_DEFS) and
  // js/repositories/ProcessServerWorksRepository.js. keyPath 'رقم_العمل'
  // — same "keyPath = actual Repository idField" rule this file's
  // header documents, mirroring 'opponents' -> 'رقم_الخصم' exactly.
  // Purely additive: does not touch 'clients', 'cases', 'opponents', or
  // any other store/index.
  // ----------------------------------------------------------------
  var V5_STORE_DEFINITIONS = [
    {
      name: 'processServerWorks',
      keyPath: 'رقم_العمل',
      autoIncrement: false,
      indexes: [
        { name: 'clientId', keyPath: 'رقم_الموكل', unique: false },
        { name: 'caseNum', keyPath: 'رقم_القضية', unique: false },
        { name: 'status', keyPath: 'الحالة', unique: false },
        { name: 'searchText', keyPath: 'searchText', unique: false }
      ].concat(COMMON_AUDIT_INDEXES)
    }
  ];

  // ----------------------------------------------------------------
  // V6_STORE_DEFINITIONS — CASES_RELATIONSHIP_FINANCIAL: two new
  // stores. 'caseClients' backs the new 'قضية_موكلين' GAS sheet
  // (Config/00_Config.gs SHEET_DEFS) and the new
  // js/repositories/CaseClientsRepository.js — the real ID-based
  // Case<->Client junction (decision §3-C), keyPath 'id' since the
  // junction row itself has no natural single-column key (mirrors
  // 'auditLog'/'loginLog' -> 'id' precedent above, not 'clients'/
  // 'opponents' -> natural-key precedent, because this is a relationship
  // record, not an entity record). 'expenses' backs the new
  // 'المصروفات' GAS sheet and js/repositories/ExpensesRepository.js
  // (decision §3-G), same 'id' keyPath rationale. Purely additive: does
  // not touch 'clients', 'cases', 'opponents', 'processServerWorks', or
  // any other store/index.
  // ----------------------------------------------------------------
  var V6_STORE_DEFINITIONS = [
    {
      name: 'caseClients',
      keyPath: 'id',
      autoIncrement: false,
      indexes: [
        { name: 'caseNum', keyPath: 'رقم_القضية', unique: false },
        { name: 'clientId', keyPath: 'رقم_الموكل', unique: false }
      ].concat(COMMON_AUDIT_INDEXES)
    },
    {
      name: 'expenses',
      keyPath: 'id',
      autoIncrement: false,
      indexes: [
        { name: 'scope', keyPath: 'النطاق', unique: false },
        { name: 'clientId', keyPath: 'رقم_الموكل', unique: false },
        { name: 'caseNum', keyPath: 'رقم_القضية', unique: false },
        { name: 'searchText', keyPath: 'searchText', unique: false }
      ].concat(COMMON_AUDIT_INDEXES)
    }
  ];

  /**
   * STORE_DEFINITIONS — every store name the CURRENT (latest) schema
   * version defines (version 1 stores + every additive version's new
   * stores). Used by getStoreNames()/getStoreDefinition() below.
   */
  var STORE_DEFINITIONS = V1_STORE_DEFINITIONS.concat(V2_STORE_DEFINITIONS).concat(V3_STORE_DEFINITIONS).concat(V4_STORE_DEFINITIONS).concat(V5_STORE_DEFINITIONS).concat(V6_STORE_DEFINITIONS);

  /**
   * SCHEMA_VERSIONS — ordered upgrade steps. Version 1 was the original
   * Phase 13.3A schema (all 9 original object stores). Version 2 is
   * additive-only (INTEGRATION PHASE — Client Portal Messages Wiring):
   * it introduces exactly one new store ('clientMessages') and touches
   * nothing from version 1. IndexedDBVersion.js walks this list and
   * applies only the steps between an existing database's oldVersion and
   * the current DB_VERSION — an already-provisioned database (at
   * version 1) will have ONLY the version 2 step's store created on next
   * open; a brand-new database gets both steps applied in order.
   */
  var SCHEMA_VERSIONS = [
    {
      version: 1,
      description: 'Initial HossamLawOffice schema — all Phase 13.3A object stores and indexes.',
      stores: V1_STORE_DEFINITIONS
    },
    {
      version: 2,
      description: 'INTEGRATION PHASE — Client Portal Messages Wiring: adds the clientMessages object store.',
      stores: V2_STORE_DEFINITIONS
    },
    {
      version: 3,
      description: 'PHASE 31 — Users, Roles & Permissions Core (RBAC): adds the users, auditLog, and loginLog object stores.',
      stores: V3_STORE_DEFINITIONS
    },
    {
      version: 4,
      description: 'PHASE 37 — Opponents Module (الخصوم): adds the opponents object store.',
      stores: V4_STORE_DEFINITIONS
    },
    {
      version: 5,
      description: 'PHASE 38 — Process Server Works Module (أعمال المحضرين): adds the processServerWorks object store.',
      stores: V5_STORE_DEFINITIONS
    },
    {
      version: 6,
      description: 'CASES_RELATIONSHIP_FINANCIAL: adds the caseClients (Case<->Client junction) and expenses (3-level Expenses) object stores.',
      stores: V6_STORE_DEFINITIONS
    }
  ];

  /** getStoreNames() -> string[] — every store name the current (latest) schema version defines. */
  function getStoreNames() {
    return STORE_DEFINITIONS.map(function (s) { return s.name; });
  }

  /** getStoreDefinition(name) -> store definition object | null */
  function getStoreDefinition(name) {
    for (var i = 0; i < STORE_DEFINITIONS.length; i++) {
      if (STORE_DEFINITIONS[i].name === name) { return STORE_DEFINITIONS[i]; }
    }
    return null;
  }

  /** getSchemaVersionStep(version) -> the SCHEMA_VERSIONS entry for that version, or null. */
  function getSchemaVersionStep(version) {
    for (var i = 0; i < SCHEMA_VERSIONS.length; i++) {
      if (SCHEMA_VERSIONS[i].version === version) { return SCHEMA_VERSIONS[i]; }
    }
    return null;
  }

  var api = {
    DB_NAME: DB_NAME,
    DB_VERSION: DB_VERSION,
    STORE_DEFINITIONS: STORE_DEFINITIONS,
    SCHEMA_VERSIONS: SCHEMA_VERSIONS,
    getStoreNames: getStoreNames,
    getStoreDefinition: getStoreDefinition,
    getSchemaVersionStep: getSchemaVersionStep
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  if (root) {
    root.IndexedDBSchema = api;
  }

})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
