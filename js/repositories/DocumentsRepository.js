/**
 * ================================================================
 * DocumentsRepository.js — Documents Repository | نظام الحسام للمحاماة
 * ================================================================
 * V10 — Offline First Architecture
 * PHASE 5 — SUB-PHASE 5.8 — Documents Repository
 *
 * Source of design (no assumption outside these — see Input Gap in
 * Documents_Repository_Report.md):
 *   - Repository_Contract_Report_PHASE2_V10.md  (Contract §3, Catalog §4.7,
 *     Standards §19 — literal operation names, no synonyms)
 *   - Data_Schema_Specification_Report_PHASE4_V10.md (§4.7 Documents: Primary
 *     Key, Required Fields, Search/Sort/Filter Fields, Delete/Sync Rules)
 *   - js/core/Repository.js (Repository Core — Phase 5.1, extended here,
 *     never modified)
 *   - js/repositories/CasesRepository.js, ClientsRepository.js,
 *     ChildrenRepository.js, SessionsRepository.js, TasksRepository.js,
 *     FeesRepository.js (Phases 5.2/5.3/5.4/5.5/5.6/5.7 — the pattern reused
 *     again here: temporary localStorage Adapter, additive
 *     insert/remove/filter/sort/validate wrappers, documented deviations
 *     resolved in favor of actual runtime behavior — none of these six files
 *     read for implementation details beyond this pattern; none modified,
 *     none imported from)
 *   - Direct inspection of js/modules/documents.js (actual current runtime
 *     behavior of saveDocument()/deleteDocument()/editDocument()/
 *     renderDocuments() — ground truth for the "100% Behavior Compatible"
 *     requirement of this phase)
 *   - Direct inspection of index.html (FIELDS.documents / MAP.documents field
 *     definitions, `data.documents` localStorage wiring, `#searchDocuments`,
 *     `#filterDocType` — a REAL, live filter control exists for Documents,
 *     unlike Fees)
 *   - Direct inspection of Code_v4.gs (SHEET_DEFS confirms a real
 *     'المستندات' sheet exists, headers order — see "SYNC"/"IDENTIFIER"
 *     notes below)
 *
 * WHAT THIS FILE IS
 *   The seventh concrete, entity-aware Repository. It subclasses the generic
 *   Repository base class (js/core/Repository.js) and adds ONLY Documents
 *   business knowledge: the "رقم_المستند" identifier field (hybrid id per
 *   Data_Schema_Specification §3.2 — generated via a uid()-equivalent when
 *   absent, exactly as saveDocument() does today), the two fields ACTUALLY
 *   required today by saveDocument() (`رقم_القضية` and `اسم_المستند`, BOTH
 *   trimmed — no asymmetry this time, see "VALIDATION" note below), the
 *   actual free-text search behavior enforced today by renderDocuments(),
 *   and the actual, LIVE `نوع_المستند` type filter already wired to
 *   `#filterDocType` today.
 *
 * WHAT THIS FILE IS NOT
 *   - It does NOT modify js/core/Repository.js,
 *     js/repositories/CasesRepository.js, js/repositories/ClientsRepository.js,
 *     js/repositories/ChildrenRepository.js,
 *     js/repositories/SessionsRepository.js, js/repositories/TasksRepository.js,
 *     or js/repositories/FeesRepository.js.
 *   - It does NOT modify js/modules/documents.js, js/modules/cases.js,
 *     js/modules/clients.js, js/modules/children.js,
 *     js/modules/sessions.js, js/modules/tasks.js, js/modules/fees.js,
 *     js/modules/library.js, js/modules/templates.js,
 *     js/modules/dashboard.js, js/modules/settings.js, index.html, any CSS,
 *     or Code_v4.gs.
 *   - It is NOT wired into index.html in this phase (no <script> tag
 *     references it) — pure additive file, inert until a later Migration
 *     Contract stage (Repository_Contract_Report.md §16).
 *   - It does NOT implement IndexedDB and does NOT call or reference
 *     DatabaseService or ApiService (no `syncToSheets()`/`API_URL`
 *     dependency — this Repository never syncs; see "SYNC" note below).
 *   - It does NOT transfer any Business Logic (row/card HTML rendering,
 *     Drive-link anchor building, modal wiring) out of
 *     js/modules/documents.js — that stays exactly where it is, untouched.
 *   - It does NOT add any Cache or Sync layer of any kind.
 *
 * ----------------------------------------------------------------
 * INPUT GAP — see Documents_Repository_Report.md §1 for the full table.
 *   Summary: `PROJECT_MAP.md` remains absent from the archive entirely.
 *   `PROJECT_HISTORY.md`, `NEXT_PHASE.md`, and `PROJECT_STATE.md` are
 *   present under their literal, non-numbered filenames this time — no
 *   numbered-duplicate naming gap this phase (an improvement over Phase 5.7's
 *   archive). ADDITIONALLY, the packaging discrepancy flagged in
 *   `Fees_Repository_Report.md` (CasesRepository.js/SessionsRepository.js/
 *   TasksRepository.js physically under `js/core/` instead of
 *   `js/repositories/`) is **no longer present** in this delivered archive —
 *   direct inspection confirms all six prior concrete Repositories
 *   (`CasesRepository.js`, `ClientsRepository.js`, `ChildrenRepository.js`,
 *   `SessionsRepository.js`, `TasksRepository.js`, `FeesRepository.js`) are
 *   now physically located together under `js/repositories/`, and all prior
 *   verification harnesses are physically located together under
 *   `js/tests/`. This is a packaging correction, not a code change — none of
 *   these files were moved, renamed, or edited by this phase. This phase's
 *   own deliverable is created at the exact path its instructions specify:
 *   `js/repositories/DocumentsRepository.js`.
 *
 * STORAGE ADAPTER — a temporary, Documents-scoped adapter (same decision
 *   pattern as Cases/Clients/Children/Sessions/Tasks/Fees — each Repository
 *   still gets its own adapter; NEXT_PHASE.md still leaves "shared adapter
 *   vs. per-Repository adapter" as an open decision). Reads/writes the SAME
 *   localStorage key ('documents') that index.html's global `data.documents`
 *   / `saveLocal()` already use today.
 *
 * IDENTIFIER — the same documented reconciliation pattern already applied
 *   to Clients/Children/Sessions/Tasks/Fees, now confirmed again for
 *   Documents, exactly as NEXT_PHASE.md flagged as the first thing to check
 *   for this phase: Data_Schema_Specification §4.7 abstracts the Primary Key
 *   as generic `id` (Hybrid). Direct inspection of the ACTUAL saveDocument()
 *   in js/modules/documents.js shows the generated identifier is stored
 *   under the Arabic field name "رقم_المستند", not a generic "id":
 *     obj['رقم_المستند']   = obj['رقم_المستند']   || uid();
 *     obj['تاريخ_الإنشاء'] = obj['تاريخ_الإنشاء'] || new Date().toISOString();
 *   Confirmed independently by Code_v4.gs's SHEET_DEFS for sheet
 *   'المستندات', whose first header column is literally 'رقم_المستند'.
 *   Because this phase's explicit priority is "Behavior Compatible 100% مع
 *   Documents Module الحالي", DocumentsRepository below configures
 *   `idField: 'رقم_المستند'` (so every inherited Contract-literal method
 *   reads/writes the correct field name) and overrides `_resolveId()` to
 *   fall back to a local uid()-equivalent generator ONLY when 'رقم_المستند'
 *   is absent on create — replicating saveDocument()'s `|| uid()` fallback
 *   exactly, the same override pattern used in
 *   ClientsRepository.js/ChildrenRepository.js/SessionsRepository.js/
 *   TasksRepository.js/FeesRepository.js (not imported from any of them —
 *   see "NAMING/independence" note below).
 *
 * VALIDATION — Data_Schema_Specification_Report.md §4.7 lists two Required
 *   Fields: `رقم_القضية` and `اسم_المستند` — no discrepancy with the actual
 *   code on WHICH fields are required. Direct inspection of the ACTUAL
 *   saveDocument() (js/modules/documents.js) confirms exactly this:
 *     var c = document.getElementById('fDocCaseNum').value.trim();
 *     var n = document.getElementById('fDocName').value.trim();
 *     if (!c || !n) { toast('يرجى ملء رقم القضية واسم المستند', 'error'); return; }
 *   Unlike Fees (Phase 5.7), there is NO trim/no-trim asymmetry here — BOTH
 *   `c` (رقم_القضية) and `n` (اسم_المستند) are read WITH `.trim()` before the
 *   emptiness check. `_validate()` below applies the same uniform
 *   "non-empty after trim" rule to both fields, matching the live form check
 *   exactly (a first since Tasks, Phase 5.6, with no internal asymmetry to
 *   preserve — this is a genuinely SYMMETRIC pair, not merely "no
 *   discrepancy with the planning report" the way Tasks was). Also per
 *   Data_Schema_Specification §4.7: `رابط_Drive` is documented as free text,
 *   "لا تحقق URL صارم حالياً". No URL-format check is added here, matching
 *   that explicit instruction and the actual code (saveDocument() never
 *   validates `رابط_Drive`'s shape — `ApiService.uploadFile` exists but is
 *   not actually wired to this save path, exactly as
 *   Repository_Contract_Report.md §4.7 documents).
 *
 * SEARCH — Data_Schema_Specification_Report.md §4.7 states the Search Field
 *   is narrowly `اسم_المستند` only. Direct inspection of the ACTUAL current
 *   renderDocuments() (js/modules/documents.js) shows the claim UNDERSTATES
 *   the real behavior — same recurring pattern as
 *   Cases/Clients/Children/Sessions/Tasks/Fees (now the seventh consecutive
 *   occurrence): it is not scoped to one field, it is the same full-record
 *   free-text join pattern:
 *     var rows = data.documents.filter(function(d) {
 *       var t = Object.values(d).join(' ').toLowerCase();
 *       return (!s || t.includes(s)) && (!ty || d['نوع_المستند'] === ty);
 *     });
 *   bound to a real, live UI search box (`#searchDocuments`,
 *   `oninput="renderDocuments()"`). Because this phase's explicit priority
 *   is "Behavior Compatible 100% مع Documents Module الحالي" — and because a
 *   live, wired UI control exercising this exact behavior today is stronger
 *   evidence than an abstract planning document's narrower field list —
 *   `_matchesSearch` is overridden here to replicate the actual free-text
 *   join across `DOCUMENTS_LEGACY_FIELDS` (excluding the new audit/metadata
 *   fields that did not exist in the record shape before this Repository
 *   layer, same reasoning as every prior Repository). This divergence is
 *   called out explicitly in Documents_Repository_Report.md §2.4.
 *
 * FILTER — Data_Schema_Specification §4.7 / Repository_Contract_Report §4.7
 *   both document Filter Fields for Documents as `رقم_القضية` and
 *   `نوع_المستند`. UNLIKE Fees (Phase 5.7, which had ZERO live filter
 *   controls of any kind), direct inspection of index.html and
 *   renderDocuments() confirms Documents genuinely HAS one real, live filter
 *   control today: `#filterDocType` (`onchange="renderDocuments()"`, a
 *   `<select>` with a fixed set of `نوع_المستند` option values: عقد زواج,
 *   شهادة ميلاد, مفردات مرتب, محضر, إيصال, حكم, مستند آخر), which
 *   renderDocuments() applies as an exact-equality filter
 *   (`!ty || d['نوع_المستند'] === ty`) ON TOP OF the free-text search, not
 *   instead of it. `رقم_القضية`, by contrast, has NO live filter control
 *   anywhere (no dropdown, no input) — it is a real field usable through the
 *   generic filter engine, but not exercised by any UI today, same
 *   "documented-but-unwired" status Fees' `رقم_القضية` filter field had.
 *   Exactly as with every prior Repository, the additive `filter()` wrapper
 *   below is a generic, data-driven pass-through (no field hardcoded), so it
 *   already supports both `{نوع_المستند: ...}` (documented AND live) and
 *   `{رقم_القضية: ...}` (documented, not live) without any entity-specific
 *   override needed. This is the first Repository since Tasks (5.6, which
 *   had `#filterTaskPriority` live) to have a genuinely live, working
 *   dropdown filter control to reconcile against — see
 *   Documents_Repository_Report.md §2.5 for the full comparison table.
 *
 * SORT — Data_Schema_Specification §4.7 lists `تاريخ_الإيداع` as the Sort
 *   Field. Direct inspection of the ACTUAL current renderDocuments() shows
 *   NO `.sort()` call exists at all — document rows render in
 *   `data.documents` insertion order only, identical in kind to Children's
 *   Phase 5.4, Tasks' Phase 5.6, and Fees' Phase 5.7 findings. Because this
 *   phase's explicit priority is "Behavior Compatible 100%", the additive
 *   `sort()` method below does not replace or emulate any existing
 *   behavior — it is a genuinely new capability, defaulting to
 *   `تاريخ_الإيداع` ascending (missing/unparseable filing dates sort first)
 *   exactly as Data_Schema_Specification recommends, since no real behavior
 *   exists to contradict it.
 *
 * SYNC — Code_v4.gs's SHEET_DEFS confirms a real 'المستندات' sheet DOES
 *   exist in the Apps Script backend, and js/modules/documents.js's
 *   saveDocument() calls `ApiService.syncRow('المستندات', obj, idx)`
 *   (create/update ARE synced) — but `deleteDocument()` does NOT call
 *   `ApiService.deleteData()`/`syncDeleteToSheets()` at all. Unlike Fees
 *   (where this gap is only called out in `Data_Schema_Specification_Report`
 *   and `PROJECT_STATE.md`), for Documents the gap is ALSO named explicitly
 *   in `js/modules/documents.js`'s own inline JSDoc comment directly above
 *   `deleteDocument()`, which states this omission is a "pre-existing gap"
 *   flagged in a prior `DOCUMENTS_MODULE_REPORT.md` — the strongest,
 *   most-explicit self-documentation of this delete-sync gap seen across any
 *   entity so far. This does not change anything about this Repository's
 *   scope: this phase's instructions forbid adding any Sync here regardless,
 *   consistent with every prior Repository (none of which sync either) — it
 *   is a pure localStorage CRUD layer. Nothing here forecloses wiring a sync
 *   layer on top of this Repository later without changing its Contract.
 *
 * NAMING / independence — same reconciliation as CasesRepository.js,
 *   ClientsRepository.js, ChildrenRepository.js, SessionsRepository.js,
 *   TasksRepository.js, and FeesRepository.js (see their header
 *   "NAMING"/"IDENTIFIER" notes): every Contract-literal method
 *   (create/update/delete/get/getAll/find/exists/count/bulkInsert/
 *   bulkUpdate/bulkDelete/search/export/import/clear/transaction) is
 *   inherited UNCHANGED from Repository.prototype. insert()/remove()/
 *   filter()/sort()/validate() are additive convenience wrappers requested
 *   by this phase's instructions, not renamed or removed Contract methods.
 *   This file does not import or reference ClientsRepository.js/
 *   CasesRepository.js/ChildrenRepository.js/SessionsRepository.js/
 *   TasksRepository.js/FeesRepository.js in any way — its local
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
      'DocumentsRepository requires js/core/Repository.js to be loaded first ' +
      '(Repository base class not found).'
    );
  }

  // PHASE 8 / SUB-PHASE 8.5.2 — Repository Wiring: DocumentsRepository's Storage
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
      'DocumentsRepository requires js/core/DatabaseService.js to be loaded ' +
      'first (DatabaseService class not found).'
    );
  }
  if (typeof IndexedDBAdapter !== 'function') {
    throw new Error(
      'DocumentsRepository requires js/core/IndexedDBAdapter.js to be ' +
      'loaded first (IndexedDBAdapter class not found).'
    );
  }

  // ================================================================
  // 1. Documents business knowledge (private to this file)
  // ================================================================

  /**
   * Identifier field — actual runtime field name (see file header
   * "IDENTIFIER" note). A hybrid id per Data_Schema_Specification §3.2:
   * generated via a uid()-equivalent, but stored under this Arabic key,
   * not a generic "id". Also the first header column of the real
   * 'المستندات' sheet in Code_v4.gs.
   */
  var DOCUMENTS_ID_FIELD = 'رقم_المستند';

  /**
   * Fields ACTUALLY required today, verified against the ACTUAL
   * saveDocument() runtime check in js/modules/documents.js — matches
   * Data_Schema_Specification §4.7 exactly on which fields are required.
   * Unlike Fees (Phase 5.7), BOTH fields are checked WITH `.trim()` — no
   * asymmetry to preserve here (see file header "VALIDATION" note).
   */
  var DOCUMENTS_REQUIRED_FIELDS = ['رقم_القضية', 'اسم_المستند'];

  /** Filter Fields per Data_Schema_Specification §4.7 / Repository_Contract
   *  §4.7 — `رقم_القضية` and `نوع_المستند`. Unlike Fees, `نوع_المستند` IS
   *  actually wired to a live UI control today (`#filterDocType`, see file
   *  header "FILTER" note) — `رقم_القضية` is not. Exposed here for
   *  documentation only — filter() below is a generic, data-driven
   *  pass-through (no field hardcoded), same as
   *  TasksRepository.filter()/FeesRepository.filter(), so both fields (and
   *  every other real field, e.g. `رابط_Drive`) already work through it
   *  without any entity-specific override. */
  var DOCUMENTS_FILTER_FIELDS = ['رقم_القضية', 'نوع_المستند'];

  /** Sort Fields per Data_Schema_Specification §4.7 — `تاريخ_الإيداع`. The
   *  ACTUAL current renderDocuments() applies no sort at all (insertion
   *  order only, same finding as Children/Tasks/Fees) — so this is a
   *  purely additive new capability, not a reconciliation against existing
   *  behavior (see file header "SORT" note). */
  var DOCUMENTS_SORT_FIELDS = ['تاريخ_الإيداع'];

  /**
   * The full set of legacy Arabic/business fields for Documents, used to
   * replicate the exact legacy free-text search behavior (see
   * _matchesSearch override — file header "SEARCH" note) without
   * accidentally matching against the new English audit/metadata fields
   * (createdAt, updatedAt, deletedAt, version, syncVersion, checksum) that
   * did not exist in the record shape before this Repository layer —
   * including them in the join would change search results and break
   * "100% Behavior Compatible".
   *
   * Derived from DOCUMENTS_MAP (js/modules/documents.js) — رقم_القضية,
   * اسم_المستند, نوع_المستند, تاريخ_الإيداع, رابط_Drive, الملاحظات — plus:
   *   - 'رقم_المستند'   : the identifier itself (set by saveDocument() and
   *                       already part of every real record — included in
   *                       Object.values(d) today, so included here too).
   *   - 'تاريخ_الإنشاء' : creation timestamp stamped by saveDocument().
   * Matches, in the same order, Code_v4.gs's 'المستندات' sheet headers:
   *   ['رقم_المستند','رقم_القضية','اسم_المستند','نوع_المستند',
   *    'تاريخ_الإيداع','رابط_Drive','الملاحظات','تاريخ_الإنشاء']
   * No other dynamically-added field exists for Documents — confirmed by
   * full read of js/modules/documents.js (176 lines total, no other field
   * ever written).
   */
  var DOCUMENTS_LEGACY_FIELDS = [
    'رقم_المستند', 'رقم_القضية', 'اسم_المستند', 'نوع_المستند',
    'تاريخ_الإيداع', 'رابط_Drive', 'الملاحظات', 'ظاهر_للموكل', 'تاريخ_الإنشاء'
  ];

  // ================================================================
  // 2. Storage Adapter — DatabaseService-backed (PHASE 8 / SUB-PHASE 8.5.2)
  // ================================================================
  // See file header "WIRING UPDATE" note (added by this phase). Reads/
  // writes the SAME 'documents' key index.html already uses today, in the
  // SAME flat JSON-array shape — LocalStorageAdapter's own default empty
  // keyPrefix guarantees this. Public factory NAME and SIGNATURE are
  // unchanged from the prior phase; only what it builds internally changed
  // (a real DatabaseService + LocalStorageAdapter pair instead of the old
  // hand-rolled ad-hoc {read,write} object).

  /**
   * Builds the Storage Adapter injected into DocumentsRepository's underlying
   * Repository base class: a real DatabaseService instance wrapping a real
   * LocalStorageAdapter instance. This satisfies Repository.js's duck-typed
   * contract ({read(entityKey), write(entityKey, records)}) because
   * DatabaseService exposes both methods, each delegating unchanged to the
   * LocalStorageAdapter beneath it — which in turn reads/writes the
   * browser's real localStorage (or an injected localStorage-shaped
   * stand-in) under the exact same key ('documents') the current global
   * `data.documents`/`saveLocal()` already use.
   * @param {Storage} [storageImpl] - optional localStorage-shaped override
   *   (e.g. a test harness's in-memory stand-in). When omitted,
   *   LocalStorageAdapter itself resolves the real global localStorage
   *   lazily, on first read()/write() call (not here, not at construction
   *   time), matching LocalStorageAdapter's own documented lazy-engine-
   *   resolution design.
   * @returns {DatabaseService}
   */
  function createDocumentsLocalStorageAdapter(storageImpl) {
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
  // ChildrenRepository.js/SessionsRepository.js/TasksRepository.js/
  // FeesRepository.js, per this phase's "depends only on Repository.js"
  // instruction (no cross-Repository imports).
  //
  // Verified identical algorithm to js/ui-utils.js:
  //   function uid(){return Date.now().toString(36)+Math.random().toString(36).slice(2,6);}

  function generateDocumentId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  }

  // ================================================================
  // 4. DocumentsRepository — subclass
  // ================================================================

  /**
   * @class DocumentsRepository
   * @param {{storageAdapter?: object, idGenerator?: function}} [config] -
   *   Optional overrides (e.g. for tests). Defaults to the
   *   localStorage-backed placeholder adapter and the local uid()-
   *   equivalent generator above.
   */
  function DocumentsRepository(config) {
    config = config || {};
    var storageAdapter = config.storageAdapter || createDocumentsLocalStorageAdapter();
    var idGenerator = typeof config.idGenerator === 'function' ? config.idGenerator : generateDocumentId;

    Repository.call(this, {
      entityKey: 'documents',
      storageAdapter: storageAdapter,
      idField: DOCUMENTS_ID_FIELD,
      idGenerator: idGenerator,
      // No officially documented narrow Search Fields list is accurate for
      // Documents (file header "SEARCH" note) — searchFields is set to the
      // full legacy field list so that even a caller bypassing the
      // _matchesSearch override (e.g. via a future field-scoped query
      // option) still sees a sensible default rather than an empty scope.
      searchFields: DOCUMENTS_LEGACY_FIELDS,
      softDelete: true, // Data_Schema_Specification §4.7 Delete Rules: Soft Delete.
      unsupportedOperations: []
    });
  }

  DocumentsRepository.prototype = Object.create(Repository.prototype);
  DocumentsRepository.prototype.constructor = DocumentsRepository;

  // ----------------------------------------------------------------
  // 4.1 Identifier resolution — extension point (see file header
  //     "IDENTIFIER" note)
  // ----------------------------------------------------------------

  /**
   * _resolveId(record) — overrides the base class default. The base
   * class's default (when idField is set) is `return record[idField];`
   * with no generation fallback, correct for Cases (a true user-entered
   * natural key, always present by validation time). Documents' identifier
   * is a HYBRID id (Data_Schema §3.2): generated only when absent, exactly
   * replicating saveDocument()'s `obj['رقم_المستند'] = obj['رقم_المستند'] ||
   * uid();`. This override is the only behavioral difference from the base
   * class's natural-key resolution path (same pattern as
   * ClientsRepository._resolveId / ChildrenRepository._resolveId /
   * SessionsRepository._resolveId / TasksRepository._resolveId /
   * FeesRepository._resolveId, duplicated independently here).
   * @param {Object} record
   * @returns {string}
   * @protected
   * @override
   */
  DocumentsRepository.prototype._resolveId = function (record) {
    var existing = record ? record[DOCUMENTS_ID_FIELD] : null;
    return (existing != null && existing !== '') ? existing : this._idGenerator();
  };

  // ----------------------------------------------------------------
  // 4.2 Validation — Repository Contract §9 (extension point)
  // ----------------------------------------------------------------

  /**
   * _validate(operation, record) — overrides the base class no-op hook.
   * Enforces exactly the rule verified in ACTUAL saveDocument() today: two
   * required fields — رقم_القضية and اسم_المستند, BOTH checked WITH
   * `.trim()` (unlike Fees' deliberate asymmetry — see file header
   * "VALIDATION" note for why no asymmetry exists to preserve here).
   * Applies to create/update (delete does not validate field content —
   * Contract §9 default).
   * @protected
   * @override
   */
  DocumentsRepository.prototype._validate = function (operation, record) {
    if (operation !== 'create' && operation !== 'update') {
      return { valid: true, errors: [] };
    }
    var errors = [];
    var caseNum = record ? record['رقم_القضية'] : undefined;
    var caseNumEmpty = caseNum == null || (typeof caseNum === 'string' ? caseNum.trim() === '' : false);
    if (caseNumEmpty) {
      errors.push({ field: 'رقم_القضية', message: 'الحقل "رقم_القضية" إلزامي ولا يمكن أن يكون فارغاً.' });
    }
    var docName = record ? record['اسم_المستند'] : undefined;
    var docNameEmpty = docName == null || (typeof docName === 'string' ? docName.trim() === '' : false);
    if (docNameEmpty) {
      errors.push({ field: 'اسم_المستند', message: 'الحقل "اسم_المستند" إلزامي ولا يمكن أن يكون فارغاً.' });
    }
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
  DocumentsRepository.prototype.validate = function (record, operation) {
    return this._validate(operation || 'create', record);
  };

  // ----------------------------------------------------------------
  // 4.3 Search — Repository Contract §7 (extension point)
  // ----------------------------------------------------------------

  /**
   * _matchesSearch(record, term) — overrides the base class's
   * searchFields-scoped substring scan to exactly replicate the ACTUAL
   * current renderDocuments() behavior: `Object.values(d).join(' ')` across
   * every legacy business field (excluding the new audit/metadata fields
   * that did not exist in the record before this Repository layer — see
   * DOCUMENTS_LEGACY_FIELDS comment above). Required for "100% Behavior
   * Compatible" free-text search once this Repository is eventually wired
   * to replace renderDocuments()'s inline filter — see file header "SEARCH"
   * note for why this deliberately overrides the narrower single-field
   * claim both planning reports make for Documents.
   * @protected
   * @override
   */
  DocumentsRepository.prototype._matchesSearch = function (record, term) {
    if (!term) return true;
    var needle = String(term).trim().toLowerCase();
    if (!needle) return true;
    var joined = DOCUMENTS_LEGACY_FIELDS
      .map(function (field) { return record[field] != null ? record[field] : ''; })
      .join(' ')
      .toLowerCase();
    return joined.indexOf(needle) !== -1;
  };

  /**
   * filter(filterObj) — PUBLIC convenience wrapper requested by this
   * phase's instructions. Thin pass-through to search({filter: filterObj}),
   * returning just the matched records (not the full QueryResult envelope).
   * Generic and data-driven (no field hardcoded), so it supports the
   * documented `{نوع_المستند: ...}` pattern — the same exact-equality match
   * renderDocuments()'s live `#filterDocType` dropdown already performs
   * today (`!ty || d['نوع_المستند'] === ty`) — as well as the documented
   * `{رقم_القضية: ...}` pattern (real field, no live UI control) and any
   * other real field via the base class's generic range/equality engine —
   * same pattern as TasksRepository.filter()/FeesRepository.filter(). Does
   * not replace or rename search() — additive only.
   * @param {Object} filterObj - Query Model filter object (Contract §7).
   * @returns {Object[]}
   */
  DocumentsRepository.prototype.filter = function (filterObj) {
    return this.search({ filter: filterObj }).items;
  };

  // ----------------------------------------------------------------
  // 4.4 Sort — Repository Contract §7 (extension point)
  // ----------------------------------------------------------------

  /**
   * sort(records, sortSpec) — PUBLIC convenience wrapper requested by this
   * phase's instructions. Applies the base class's generic comparator
   * engine (_compareRecords) to an explicit array of records, defaulting
   * sortSpec to DOCUMENTS_SORT_FIELDS (`تاريخ_الإيداع` ascending — a purely
   * additive capability, since the ACTUAL renderDocuments() applies no sort
   * at all; see file header "SORT" note) when omitted. Does not mutate the
   * input array or replace search()'s own sort option — additive only.
   * @param {Object[]} [records] - defaults to this.getAll() when omitted.
   * @param {Array<{field:string, direction?:'asc'|'desc'}>|{field:string, direction?:'asc'|'desc'}} [sortSpec]
   * @returns {Object[]}
   */
  DocumentsRepository.prototype.sort = function (records, sortSpec) {
    var list = Array.isArray(records) ? records.slice() : this.getAll();
    var spec = sortSpec || DOCUMENTS_SORT_FIELDS.map(function (f) { return { field: f, direction: 'asc' }; });
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
  DocumentsRepository.prototype.insert = function (entity) {
    return this.create(entity);
  };

  /**
   * remove(id) -> WriteResult
   * Alias for the inherited, Contract-literal delete(id).
   * @param {string} id
   * @returns {Promise<{success:boolean, record:?Object, error:?Object}>}
   */
  DocumentsRepository.prototype.remove = function (id) {
    return this.delete(id);
  };

  // ================================================================
  // 5. Exports
  // ================================================================

  var api = {
    DocumentsRepository: DocumentsRepository,
    createDocumentsLocalStorageAdapter: createDocumentsLocalStorageAdapter
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  if (root) {
    root.DocumentsRepository = DocumentsRepository;
    root.createDocumentsLocalStorageAdapter = createDocumentsLocalStorageAdapter;
  }

})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
