/**
 * ================================================================
 * SessionsRepository.js — Sessions Repository | نظام الحسام للمحاماة
 * ================================================================
 * V10 — Offline First Architecture
 * PHASE 5 — SUB-PHASE 5.5 — Sessions Repository
 *
 * Source of design (no assumption outside these — see Input Gap in
 * Sessions_Repository_Report.md):
 *   - Repository_Contract_Report_PHASE2_V10.md  (Contract §3, Catalog §4.4,
 *     Standards §19 — literal operation names, no synonyms)
 *   - Data_Schema_Specification_Report_PHASE4_V10.md (§4.4 Sessions:
 *     Primary Key, Required Fields, Search/Sort/Filter Fields, Delete/Sync
 *     Rules)
 *   - js/core/Repository.js (Repository Core — Phase 5.1, extended here,
 *     never modified)
 *   - js/core/CasesRepository.js, js/repositories/ClientsRepository.js,
 *     js/repositories/ChildrenRepository.js (Phases 5.2/5.3/5.4 — the
 *     pattern reused again here: temporary localStorage Adapter, additive
 *     insert/remove/filter/sort/validate wrappers, documented deviations
 *     resolved in favor of actual runtime behavior — none of these three
 *     files read for implementation details beyond this pattern; none
 *     modified, none imported from)
 *   - Direct inspection of js/modules/sessions.js (actual current runtime
 *     behavior of saveSession()/deleteSession()/renderSessions() — ground
 *     truth for the "100% Behavior Compatible" requirement of this phase)
 *   - Direct inspection of index.html (FIELDS.sessions / MAP.sessions field
 *     definitions, `data.sessions` localStorage wiring, the DOMContentLoaded
 *     sanitizeTime() migration pass)
 *   - Direct inspection of Code_v4.gs (SHEET_DEFS confirms a real 'الجلسات'
 *     sheet DOES exist — unlike Children's gap — see "SYNC" note below)
 *
 * WHAT THIS FILE IS
 *   The fourth concrete, entity-aware Repository. It subclasses the generic
 *   Repository base class (js/core/Repository.js) and adds ONLY Sessions
 *   business knowledge: the "رقم_الجلسة" identifier field (hybrid id per
 *   Data_Schema_Specification §3.2 — generated via a uid()-equivalent when
 *   absent, exactly as saveSession() does today), the two fields ACTUALLY
 *   required today by saveSession() (which differ from what
 *   Data_Schema_Specification §4.4 states — see "VALIDATION" note below),
 *   and the actual free-text search behavior enforced today by
 *   renderSessions().
 *
 * WHAT THIS FILE IS NOT
 *   - It does NOT modify js/core/Repository.js, js/core/CasesRepository.js,
 *     js/repositories/ClientsRepository.js, or
 *     js/repositories/ChildrenRepository.js.
 *   - It does NOT modify js/modules/sessions.js, js/modules/cases.js,
 *     js/modules/clients.js, js/modules/children.js, js/modules/documents.js,
 *     js/modules/tasks.js, js/modules/fees.js, js/modules/calendar.js,
 *     js/modules/dashboard.js, index.html, any CSS, or Code_v4.gs.
 *   - It is NOT wired into index.html in this phase (no <script> tag
 *     references it) — pure additive file, inert until a later Migration
 *     Contract stage (Repository_Contract_Report.md §16).
 *   - It does NOT implement IndexedDB and does NOT call or reference
 *     DatabaseService or ApiService (no `syncToSheets()`/`API_URL`
 *     dependency — this Repository never syncs; see "SYNC" note below).
 *   - It does NOT move, replicate, or otherwise implement the
 *     `sanitizeTime()` normalization logic anywhere in this file — see
 *     "NORMALIZATION" note below for why, despite both planning reports
 *     recommending it.
 *
 * ----------------------------------------------------------------
 * INPUT GAP — see Sessions_Repository_Report.md for the full table.
 *   Summary (unchanged since Phase 5.4, re-confirmed for this phase):
 *   `PROJECT_MAP.md` remains absent from the archive entirely.
 *   `PROJECT_HISTORY.md` and `NEXT_PHASE.md` remain available only under
 *   their numbered-duplicate filenames in doc/ (`PROJECT_HISTORY (5).md`,
 *   `NEXT_PHASE (5).md`). `PROJECT_STATE.md` and `PROJECT_STATE (7).md`
 *   remain a single, identical, up-to-date pair — both read and treated as
 *   one authoritative document here.
 *
 * STORAGE ADAPTER — a temporary, Sessions-scoped adapter (same decision
 *   pattern as Cases/Clients/Children — each Repository still gets its own
 *   adapter; NEXT_PHASE.md still leaves "shared adapter vs. per-Repository
 *   adapter" as an open decision). Reads/writes the SAME localStorage key
 *   ('sessions') that index.html's global `data.sessions` / `saveLocal()`
 *   already use today.
 *
 * IDENTIFIER — the same documented reconciliation pattern already applied
 *   to Clients (Phase 5.3) and Children (Phase 5.4), now confirmed again
 *   for Sessions, exactly as `NEXT_PHASE.md` flagged as the first thing to
 *   check for this phase: Data_Schema_Specification §4.4 abstracts the
 *   Primary Key as generic `id` (Hybrid). Direct inspection of the ACTUAL
 *   saveSession() in js/modules/sessions.js (line 171) shows the generated
 *   identifier is stored under the Arabic field name "رقم_الجلسة", not a
 *   generic "id":
 *     obj['رقم_الجلسة'] = obj['رقم_الجلسة'] || uid();
 *   Because this phase's explicit priority is "Behavior Compatible 100%
 *   مع Sessions Module الحالي", SessionsRepository below configures
 *   `idField: 'رقم_الجلسة'` (so every inherited Contract-literal method
 *   reads/writes the correct field name) and overrides `_resolveId()` to
 *   fall back to a local uid()-equivalent generator ONLY when 'رقم_الجلسة'
 *   is absent on create — replicating saveSession()'s `|| uid()` fallback
 *   exactly, the same override pattern used in ClientsRepository.js /
 *   ChildrenRepository.js (not imported from either — see
 *   "NAMING/independence" note below).
 *
 * VALIDATION — **a documented discrepancy against
 *   Data_Schema_Specification_Report.md §4.4**, which lists Required
 *   Fields as `رقم_القضية`, `التاريخ`. Direct inspection of the ACTUAL
 *   saveSession() (js/modules/sessions.js, lines 162-167) shows a
 *   DIFFERENT pair is actually enforced today:
 *     var date = document.getElementById('fSessionDate').value;
 *     var time = document.getElementById('fSessionTime').value;
 *     if (!date || !time) { toast('يرجى تحديد تاريخ ووقت الجلسة','error'); return; }
 *   `date` maps (via MAP.sessions) to `التاريخ`, `time` maps to `الوقت`.
 *   `رقم_القضية` is NOT checked anywhere in saveSession() — a session can
 *   be saved today with an empty/absent `رقم_القضية`. Because this phase's
 *   explicit priority is "Behavior Compatible 100% مع Sessions Module
 *   الحالي" — and because this is the actual, live, runtime-enforced rule,
 *   not an abstract planning document's field list — `_validate()` below
 *   enforces exactly `التاريخ` and `الوقت` as the two required, non-empty
 *   (after trim) fields, NOT `رقم_القضية`. This divergence from
 *   Data_Schema_Specification_Report.md §4.4 is called out explicitly (not
 *   silently "fixed") in Sessions_Repository_Report.md §2.2 — same
 *   resolution pattern as the Cases/Children validation deviations in
 *   prior phases.
 *
 * SEARCH — Data_Schema_Specification_Report.md §4.4 states Search Fields
 *   are narrowly `عنوان_القضية`, `رقم_القضية` — the one occasion so far
 *   (per `NEXT_PHASE.md`'s explicit warning to re-check, learned from the
 *   Children §2.4 contradiction) where BOTH planning reports actually
 *   claim real free-text search exists for this entity. Direct inspection
 *   of the ACTUAL current renderSessions() (js/modules/sessions.js, lines
 *   89-96) shows the claim UNDERSTATES the real behavior: it is not
 *   scoped to those two fields, it is the same full-record free-text join
 *   pattern already confirmed for Cases/Clients/Children:
 *     var rows = data.sessions.filter(function(x) {
 *       var t = Object.values(x).join(' ').toLowerCase();
 *       return (!s || t.includes(s)) && (!st || x['الحالة'] === st);
 *     });
 *   bound to a real, live UI search box (`#searchSessions`). Because this
 *   phase's explicit priority is "Behavior Compatible 100% مع Sessions
 *   Module الحالي" — and because a live, wired UI control exercising this
 *   exact behavior today is stronger evidence than an abstract planning
 *   document's narrower field list — `_matchesSearch` is overridden here
 *   to replicate the actual free-text join across `SESSIONS_LEGACY_FIELDS`
 *   (excluding the new audit/metadata fields that did not exist in the
 *   record shape before this Repository layer, same reasoning as
 *   Cases/Clients/Children). This divergence is called out explicitly in
 *   Sessions_Repository_Report.md §2.4.
 *
 * FILTER — renderSessions() also applies a second, independent condition
 *   in the SAME filter callback: `x['الحالة'] === st` (a status dropdown,
 *   `#filterSessionStatus`). This is a plain equality filter, already
 *   covered by the base class's generic `_matchesFilter` engine with no
 *   override needed (same as every filter used by Cases/Clients/Children
 *   so far). `رقم_القضية` is also a documented Filter Field
 *   (Data_Schema_Specification §4.4 / Repository_Contract_Report §4.4) and
 *   is the real, live query pattern used elsewhere in the project (e.g.
 *   `viewCase()`/`quickPrintCase()` in js/modules/cases.js filter
 *   `data.sessions` by `رقم_القضية`, outside this file's scope) — the
 *   additive `filter()` wrapper below is a generic pass-through (not
 *   hardcoded to one field), so it supports both `{الحالة: ...}` and
 *   `{رقم_القضية: ...}` (and any AND/OR combination) without any
 *   entity-specific override, same as ChildrenRepository's filter().
 *
 * SORT — Data_Schema_Specification §4.4 lists a Composite Index
 *   `(رقم_القضية + التاريخ)` and `NEXT_PHASE.md` flagged this as a possible
 *   need for a composite (two-field) default sort — unlike every prior
 *   Repository, which used a single-field default. Direct inspection of
 *   the ACTUAL current renderSessions() (js/modules/sessions.js, lines
 *   94-96) shows the real, live, UI-driving sort is single-field only:
 *     .sort(function(a, b) {
 *       return (parseLocalDate(a['التاريخ']) || 0) - (parseLocalDate(b['التاريخ']) || 0);
 *     });
 *   ascending by `التاريخ` alone, treating a missing/unparseable date as
 *   `0` (sorts first). No `رقم_القضية` tie-break exists in the real code.
 *   Because this phase's explicit priority is "Behavior Compatible 100%",
 *   the default `sort()` sortSpec below is the single field `التاريخ`
 *   ascending — the Composite Index remains a storage/indexing detail
 *   (Data_Schema §4.4), not a default sort order, and is not implemented
 *   here (this Repository builds no internal index structures at all,
 *   matching the base class's Phase 5.1 scope). `التاريخ` values in the
 *   real record shape are `YYYY-MM-DD`-style ISO date strings (HTML
 *   `<input type="date">`), so the base class's generic lexical
 *   `_compareRecords` comparator already produces the same chronological
 *   order as `parseLocalDate()` would — no override needed, same as every
 *   date-sortable field in Cases/Clients/Children so far.
 *
 * NORMALIZATION — Repository_Contract_Report_PHASE2_V10.md §4.4 explicitly
 *   recommends that `sanitizeTime()` (today applied to the `الوقت` field
 *   in TWO places: once inside `saveSession()` itself, and once more as a
 *   one-time migration pass in index.html's `DOMContentLoaded` handler —
 *   `data.sessions = data.sessions.map(function(s){ if (s['الوقت'])
 *   s['الوقت'] = sanitizeTime(s['الوقت']); return s; });`) "should become
 *   part of a Validation/Normalization Layer inside this Repository instead
 *   of staying isolated logic in index.html." This phase's own explicit
 *   instructions ("لا تنقل أي Business Logic" / "لا تضف أي Sync" / "لا تضف
 *   أي Cache" — do not move any business logic, do not add sync, do not
 *   add caching) take priority over that forward-looking planning-report
 *   recommendation for THIS phase. `sanitizeTime()` is a `js/ui-utils.js`
 *   helper, `الوقت` normalization is genuine business logic (not
 *   structural CRUD), and this Repository's explicit dependency contract
 *   is "depends only on Repository.js" — importing or re-implementing
 *   `sanitizeTime()` here would violate both constraints at once.
 *   `SessionsRepository` therefore stores/reads `الوقت` completely as
 *   handed to it, doing no time-string normalization of any kind. This is
 *   a deliberate, documented scope exclusion, not an oversight — called
 *   out explicitly in Sessions_Repository_Report.md §2.3 for a future
 *   phase to revisit once "Validation/Normalization Layer" is itself
 *   scoped as its own deliverable.
 *
 * SYNC — Code_v4.gs's SHEET_DEFS confirms a real 'الجلسات' sheet DOES exist
 *   in the Apps Script backend (unlike Children's 'الأطفال' gap from Phase
 *   5.4), and js/modules/sessions.js's saveSession()/deleteSession() call
 *   `ApiService.syncRow('الجلسات', ...)` / `ApiService.deleteData('الجلسات',
 *   i)` respectively — i.e. Sessions has NO sync gap at all today (both
 *   create/update AND delete are synced), unlike Children/Fees. This does
 *   not change anything about this Repository's scope: this phase's
 *   instructions forbid adding any Sync here regardless, consistent with
 *   CasesRepository/ClientsRepository/ChildrenRepository (none of which
 *   sync either) — it is a pure localStorage CRUD layer. Nothing here
 *   forecloses wiring a sync layer on top of this Repository later without
 *   changing its Contract.
 *
 * NAMING / independence — same reconciliation as CasesRepository.js,
 *   ClientsRepository.js, and ChildrenRepository.js (see their header
 *   "NAMING"/"IDENTIFIER" notes): every Contract-literal method
 *   (create/update/delete/get/getAll/find/exists/count/bulkInsert/
 *   bulkUpdate/bulkDelete/search/export/import/clear/transaction) is
 *   inherited UNCHANGED from Repository.prototype. insert()/remove()/
 *   filter()/sort()/validate() are additive convenience wrappers requested
 *   by this phase's instructions, not renamed or removed Contract methods.
 *   This file does not import or reference ClientsRepository.js/
 *   CasesRepository.js/ChildrenRepository.js in any way — its local
 *   uid()-equivalent generator and Storage Adapter are self-contained
 *   duplicates of the same pattern, not shared code, per this phase's
 *   "depends only on Repository.js" instruction.
 *
 * Load order: additive file, not yet wired into index.html. Depends only on
 * js/core/Repository.js having been loaded first (throws a clear error
 * otherwise — see guard below).
 * ================================================================
 */

(function (root) {
  'use strict';

  var RepositoryNS = (typeof module !== 'undefined' && module.exports)
    ? require('../core/Repository.js')
    : root;

  var Repository = RepositoryNS.Repository;
  var RepositoryErrorTypes = RepositoryNS.RepositoryErrorTypes;
  var createRepositoryError = RepositoryNS.createRepositoryError;

  if (typeof Repository !== 'function') {
    throw new Error(
      'SessionsRepository requires js/core/Repository.js to be loaded first ' +
      '(Repository base class not found).'
    );
  }

  // PHASE 8 / SUB-PHASE 8.5.2 — Repository Wiring: SessionsRepository's Storage
  // Adapter is now built from the real DatabaseService/LocalStorageAdapter
  // pair, exactly as CasesRepository/ClientsRepository were wired in PHASE
  // 8/8.5.1. Neither dependency is modified by this phase — both are
  // required here exactly as PHASE 8 already built and verified them.
  var DatabaseServiceNS = (typeof module !== 'undefined' && module.exports)
    ? require('../core/DatabaseService.js')
    : root;
  var IndexedDBAdapterNS = (typeof module !== 'undefined' && module.exports)
    ? require('../core/IndexedDBAdapter.js')
    : root;

  var DatabaseService = DatabaseServiceNS && DatabaseServiceNS.DatabaseService;
  var IndexedDBAdapter = IndexedDBAdapterNS && IndexedDBAdapterNS.IndexedDBAdapter;

  if (typeof DatabaseService !== 'function') {
    throw new Error(
      'SessionsRepository requires js/core/DatabaseService.js to be loaded ' +
      'first (DatabaseService class not found).'
    );
  }
  if (typeof IndexedDBAdapter !== 'function') {
    throw new Error(
      'SessionsRepository requires js/core/IndexedDBAdapter.js to be ' +
      'loaded first (IndexedDBAdapter class not found).'
    );
  }

  // ================================================================
  // 1. Sessions business knowledge (private to this file)
  // ================================================================

  /**
   * Identifier field — actual runtime field name (see file header
   * "IDENTIFIER" note). A hybrid id per Data_Schema_Specification §3.2:
   * generated via a uid()-equivalent, but stored under this Arabic key,
   * not a generic "id".
   */
  var SESSIONS_ID_FIELD = 'رقم_الجلسة';

  /**
   * Fields ACTUALLY required today, verified against the ACTUAL
   * saveSession() runtime check in js/modules/sessions.js — DIVERGES from
   * Data_Schema_Specification §4.4 (`رقم_القضية`, `التاريخ`); see file
   * header "VALIDATION" note for the full reconciliation.
   */
  var SESSIONS_REQUIRED_FIELDS = ['التاريخ', 'الوقت'];

  /** Filter Fields per Data_Schema_Specification §4.4 / Repository_Contract
   *  §4.4 — the two real, documented, and actually-used filtering
   *  dimensions for Sessions (status dropdown in renderSessions(), and
   *  "sessions of a given case" used elsewhere, e.g. js/modules/cases.js).
   *  Exposed here for documentation only — filter() below is a generic,
   *  data-driven pass-through (no field hardcoded), same as
   *  ChildrenRepository.filter(). */
  var SESSIONS_FILTER_FIELDS = ['رقم_القضية', 'الحالة'];

  /** Sort Fields per Data_Schema_Specification §4.4 AND the ACTUAL current
   *  renderSessions() (agree with each other on this single field, unlike
   *  the Composite Index note — see file header "SORT" note): ascending by
   *  `التاريخ`, missing/unparseable values sorting first. */
  var SESSIONS_SORT_FIELDS = ['التاريخ'];

  /**
   * The full set of legacy Arabic/business fields for Sessions, used to
   * replicate the exact legacy free-text search behavior (see
   * _matchesSearch override — file header "SEARCH" note) without
   * accidentally matching against the new English audit/metadata fields
   * (createdAt, updatedAt, deletedAt, version, syncVersion, checksum) that
   * did not exist in the record shape before this Repository layer —
   * including them in the join would change search results and break
   * "100% Behavior Compatible".
   *
   * Derived from SESSIONS_MAP (js/modules/sessions.js) — رقم_القضية,
   * عنوان_القضية, نوع_الدعوى, المحكمة, التاريخ, الوقت, القاضي, الحالة,
   * ما_تم_في_الجلسة, القرار, التأجيل_إلى, الملاحظات — plus:
   *   - 'رقم_الجلسة'    : the identifier itself (set by saveSession() and
   *                        already part of every real record — included in
   *                        Object.values(x) today, so included here too).
   *   - 'تاريخ_الإنشاء' : creation timestamp stamped by saveSession().
   * No portal-token-equivalent or other dynamically-added field exists for
   * Sessions (unlike Clients' 'portal_token') — confirmed by full read of
   * js/modules/sessions.js (217 lines total, no other field ever written).
   */
  var SESSIONS_LEGACY_FIELDS = [
    'رقم_الجلسة', 'رقم_القضية', 'عنوان_القضية', 'نوع_الدعوى', 'المحكمة', 'رقم_الدائرة', 'رقم_القاعة',
    'التاريخ', 'الوقت', 'القاضي', 'الحالة', 'ما_تم_في_الجلسة', 'القرار',
    'التأجيل_إلى', 'الملاحظات', 'تاريخ_الإنشاء'
  ];

  // ================================================================
  // 2. Storage Adapter — DatabaseService-backed (PHASE 8 / SUB-PHASE 8.5.2)
  // ================================================================
  // See file header "WIRING UPDATE" note (added by this phase). Reads/
  // writes the SAME 'sessions' key index.html already uses today, in the
  // SAME flat JSON-array shape — LocalStorageAdapter's own default empty
  // keyPrefix guarantees this. Public factory NAME and SIGNATURE are
  // unchanged from the prior phase; only what it builds internally changed
  // (a real DatabaseService + LocalStorageAdapter pair instead of the old
  // hand-rolled ad-hoc {read,write} object).

  /**
   * Builds the Storage Adapter injected into SessionsRepository's underlying
   * Repository base class: a real DatabaseService instance wrapping a real
   * LocalStorageAdapter instance. This satisfies Repository.js's duck-typed
   * contract ({read(entityKey), write(entityKey, records)}) because
   * DatabaseService exposes both methods, each delegating unchanged to the
   * LocalStorageAdapter beneath it — which in turn reads/writes the
   * browser's real localStorage (or an injected localStorage-shaped
   * stand-in) under the exact same key ('sessions') the current global
   * `data.sessions`/`saveLocal()` already use.
   * @param {Storage} [storageImpl] - optional localStorage-shaped override
   *   (e.g. a test harness's in-memory stand-in). When omitted,
   *   LocalStorageAdapter itself resolves the real global localStorage
   *   lazily, on first read()/write() call (not here, not at construction
   *   time), matching LocalStorageAdapter's own documented lazy-engine-
   *   resolution design.
   * @returns {DatabaseService}
   */
  function createSessionsLocalStorageAdapter(storageImpl) {
    var adapter = new IndexedDBAdapter(storageImpl ? { engineOptions: { indexedDBImpl: storageImpl } } : {});
    return new DatabaseService(adapter);
  }

  // ================================================================
  // 3. Local uid()-equivalent generator (private to this file)
  // ================================================================
  // Repository.js deliberately does NOT define uid() itself (it lives in
  // js/ui-utils.js and must be injected — see Repository.js file header,
  // config.idGenerator doc). This file does not import js/ui-utils.js (no
  // dependency beyond js/core/Repository.js is permitted this phase), so a
  // byte-for-byte algorithmic replica of the actual uid() is defined here,
  // private to this module — a self-contained duplicate of the same helper
  // already defined independently in ClientsRepository.js/
  // ChildrenRepository.js, per this phase's "depends only on Repository.js"
  // instruction (no cross-Repository imports).
  //
  // Verified identical algorithm to js/ui-utils.js:
  //   function uid(){return Date.now().toString(36)+Math.random().toString(36).slice(2,6);}

  function generateSessionId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  }

  // ================================================================
  // 4. SessionsRepository — subclass
  // ================================================================

  /**
   * @class SessionsRepository
   * @param {{storageAdapter?: object, idGenerator?: function}} [config] -
   *   Optional overrides (e.g. for tests). Defaults to the
   *   localStorage-backed placeholder adapter and the local uid()-
   *   equivalent generator above.
   */
  function SessionsRepository(config) {
    config = config || {};
    var storageAdapter = config.storageAdapter || createSessionsLocalStorageAdapter();
    var idGenerator = typeof config.idGenerator === 'function' ? config.idGenerator : generateSessionId;

    Repository.call(this, {
      entityKey: 'sessions',
      storageAdapter: storageAdapter,
      idField: SESSIONS_ID_FIELD,
      idGenerator: idGenerator,
      // No officially documented narrow Search Fields list is accurate for
      // Sessions (file header "SEARCH" note) — searchFields is set to the
      // full legacy field list so that even a caller bypassing the
      // _matchesSearch override (e.g. via a future field-scoped query
      // option) still sees a sensible default rather than an empty scope.
      searchFields: SESSIONS_LEGACY_FIELDS,
      softDelete: true, // Data_Schema_Specification §4.4 Delete Rules: Soft Delete.
      unsupportedOperations: []
    });
  }

  SessionsRepository.prototype = Object.create(Repository.prototype);
  SessionsRepository.prototype.constructor = SessionsRepository;

  // ----------------------------------------------------------------
  // 4.1 Identifier resolution — extension point (see file header
  //     "IDENTIFIER" note)
  // ----------------------------------------------------------------

  /**
   * _resolveId(record) — overrides the base class default. The base
   * class's default (when idField is set) is `return record[idField];`
   * with no generation fallback, correct for Cases (a true user-entered
   * natural key, always present by validation time). Sessions' identifier
   * is a HYBRID id (Data_Schema §3.2): generated only when absent, exactly
   * replicating saveSession()'s `obj['رقم_الجلسة'] = obj['رقم_الجلسة'] ||
   * uid();`. This override is the only behavioral difference from the base
   * class's natural-key resolution path (same pattern as
   * ClientsRepository._resolveId / ChildrenRepository._resolveId,
   * duplicated independently here).
   * @param {Object} record
   * @returns {string}
   * @protected
   * @override
   */
  SessionsRepository.prototype._resolveId = function (record) {
    var existing = record ? record[SESSIONS_ID_FIELD] : null;
    return (existing != null && existing !== '') ? existing : this._idGenerator();
  };

  // ----------------------------------------------------------------
  // 4.2 Validation — Repository Contract §9 (extension point)
  // ----------------------------------------------------------------

  /**
   * _validate(operation, record) — overrides the base class no-op hook.
   * Enforces exactly the rule verified in ACTUAL saveSession() today: two
   * required, non-empty (after trim) fields — التاريخ and الوقت (NOT
   * رقم_القضية — see file header "VALIDATION" note for the documented
   * discrepancy against Data_Schema_Specification §4.4). Applies to
   * create/update (delete does not validate field content — Contract §9
   * default).
   * @protected
   * @override
   */
  SessionsRepository.prototype._validate = function (operation, record) {
    if (operation !== 'create' && operation !== 'update') {
      return { valid: true, errors: [] };
    }
    var errors = [];
    SESSIONS_REQUIRED_FIELDS.forEach(function (field) {
      var value = record ? record[field] : undefined;
      var isEmpty = value == null || (typeof value === 'string' && value.trim() === '');
      if (isEmpty) {
        errors.push({ field: field, message: 'الحقل "' + field + '" إلزامي ولا يمكن أن يكون فارغاً.' });
      }
    });
    return { valid: errors.length === 0, errors: errors };
  };

  /**
   * validate(record) — PUBLIC convenience wrapper requested by this phase's
   * instructions. Thin pass-through to the protected _validate() hook,
   * defaulting to the 'create' operation shape. Does not replace or rename
   * any Contract operation.
   * @param {Object} record
   * @param {'create'|'update'} [operation='create']
   * @returns {{valid:boolean, errors:Array<{field:string,message:string}>}}
   */
  SessionsRepository.prototype.validate = function (record, operation) {
    return this._validate(operation || 'create', record);
  };

  // ----------------------------------------------------------------
  // 4.3 Search — Repository Contract §7 (extension point)
  // ----------------------------------------------------------------

  /**
   * _matchesSearch(record, term) — overrides the base class's
   * searchFields-scoped substring scan to exactly replicate the ACTUAL
   * current renderSessions() behavior: `Object.values(x).join(' ')` across
   * every legacy business field (excluding the new audit/metadata fields
   * that did not exist in the record before this Repository layer — see
   * SESSIONS_LEGACY_FIELDS comment above). Required for "100% Behavior
   * Compatible" free-text search once this Repository is eventually wired
   * to replace renderSessions()'s inline filter — see file header "SEARCH"
   * note for why this deliberately overrides the narrower two-field list
   * both planning reports claim for Sessions.
   * @protected
   * @override
   */
  SessionsRepository.prototype._matchesSearch = function (record, term) {
    if (!term) return true;
    var needle = String(term).trim().toLowerCase();
    if (!needle) return true;
    var joined = SESSIONS_LEGACY_FIELDS
      .map(function (field) { return record[field] != null ? record[field] : ''; })
      .join(' ')
      .toLowerCase();
    return joined.indexOf(needle) !== -1;
  };

  /**
   * filter(filterObj) — PUBLIC convenience wrapper requested by this
   * phase's instructions. Thin pass-through to search({filter: filterObj}),
   * returning just the matched records (not the full QueryResult envelope).
   * Generic and data-driven (no field hardcoded), so it supports both the
   * real `{الحالة: ...}` status-dropdown pattern (renderSessions()) and the
   * real `{رقم_القضية: ...}` "sessions of a case" pattern (used elsewhere,
   * e.g. js/modules/cases.js) — see file header "FILTER" note. Does not
   * replace or rename search() — additive only.
   * @param {Object} filterObj - Query Model filter object (Contract §7).
   * @returns {Object[]}
   */
  SessionsRepository.prototype.filter = function (filterObj) {
    return this.search({ filter: filterObj }).items;
  };

  // ----------------------------------------------------------------
  // 4.4 Sort — Repository Contract §7 (extension point)
  // ----------------------------------------------------------------

  /**
   * sort(records, sortSpec) — PUBLIC convenience wrapper requested by this
   * phase's instructions. Applies the base class's generic comparator
   * engine (_compareRecords) to an explicit array of records, defaulting
   * sortSpec to SESSIONS_SORT_FIELDS (single field, `التاريخ` ascending —
   * matches the ACTUAL renderSessions() sort exactly; see file header
   * "SORT" note for why this is single-field, not the Composite Index
   * `(رقم_القضية + التاريخ)` from Data_Schema_Specification §4.4) when
   * omitted. Does not mutate the input array or replace search()'s own
   * sort option — additive only.
   * @param {Object[]} [records] - defaults to this.getAll() when omitted.
   * @param {Array<{field:string, direction?:'asc'|'desc'}>|{field:string, direction?:'asc'|'desc'}} [sortSpec]
   * @returns {Object[]}
   */
  SessionsRepository.prototype.sort = function (records, sortSpec) {
    var list = Array.isArray(records) ? records.slice() : this.getAll();
    var spec = sortSpec || SESSIONS_SORT_FIELDS.map(function (f) { return { field: f, direction: 'asc' }; });
    var self = this;
    return list.sort(function (a, b) { return self._compareRecords(a, b, Array.isArray(spec) ? spec : [spec]); });
  };

  // ----------------------------------------------------------------
  // 4.5 Contract-literal convenience aliases (Repository §3, §19)
  // ----------------------------------------------------------------
  // insert()/remove() are ADDITIVE public aliases, named exactly as this
  // phase's instructions require, wired directly to the unchanged
  // Contract-literal create()/delete() inherited from Repository.prototype.
  // create()/update()/delete() themselves remain available, unrenamed, on
  // every instance — Contract §19 compliance is preserved.

  /**
   * insert(entity) -> WriteResult
   * Alias for the inherited, Contract-literal create(entity).
   * @param {Object} entity
   * @returns {Promise<{success:boolean, record:?Object, error:?Object}>}
   */
  SessionsRepository.prototype.insert = function (entity) {
    return this.create(entity);
  };

  /**
   * remove(id) -> WriteResult
   * Alias for the inherited, Contract-literal delete(id).
   * @param {string} id
   * @returns {Promise<{success:boolean, record:?Object, error:?Object}>}
   */
  SessionsRepository.prototype.remove = function (id) {
    return this.delete(id);
  };

  // ================================================================
  // 5. Exports
  // ================================================================

  var api = {
    SessionsRepository: SessionsRepository,
    createSessionsLocalStorageAdapter: createSessionsLocalStorageAdapter
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  if (root) {
    root.SessionsRepository = SessionsRepository;
    root.createSessionsLocalStorageAdapter = createSessionsLocalStorageAdapter;
  }

})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
