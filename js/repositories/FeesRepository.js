/**
 * ================================================================
 * FeesRepository.js — Fees Repository | نظام الحسام للمحاماة
 * ================================================================
 * V10 — Offline First Architecture
 * PHASE 5 — SUB-PHASE 5.7 — Fees Repository
 *
 * Source of design (no assumption outside these — see Input Gap in
 * Fees_Repository_Report.md):
 *   - Repository_Contract_Report_PHASE2_V10.md  (Contract §3, Catalog §4.5,
 *     Standards §19 — literal operation names, no synonyms)
 *   - Data_Schema_Specification_Report_PHASE4_V10.md (§4.5 Fees: Primary
 *     Key, Required Fields, Search/Sort/Filter Fields, Delete/Sync Rules)
 *   - js/core/Repository.js (Repository Core — Phase 5.1, extended here,
 *     never modified)
 *   - js/core/CasesRepository.js, js/repositories/ClientsRepository.js,
 *     js/repositories/ChildrenRepository.js, js/core/SessionsRepository.js,
 *     js/core/TasksRepository.js (Phases 5.2/5.3/5.4/5.5/5.6 — the pattern
 *     reused again here: temporary localStorage Adapter, additive
 *     insert/remove/filter/sort/validate wrappers, documented deviations
 *     resolved in favor of actual runtime behavior — none of these five
 *     files read for implementation details beyond this pattern; none
 *     modified, none imported from)
 *   - Direct inspection of js/modules/fees.js (actual current runtime
 *     behavior of saveFee()/deleteFee()/editFee()/renderFees() — ground
 *     truth for the "100% Behavior Compatible" requirement of this phase)
 *   - Direct inspection of index.html (FIELDS.fees / MAP.fees field
 *     definitions, `data.fees` localStorage wiring, `#searchFees` — no
 *     fee-status, payment-method, amount-range, or date-range filter
 *     control of any kind exists anywhere for Fees)
 *   - Direct inspection of Code_v4.gs (SHEET_DEFS confirms a real
 *     'الأتعاب' sheet exists, headers order — see "SYNC"/"IDENTIFIER"
 *     notes below)
 *
 * WHAT THIS FILE IS
 *   The sixth concrete, entity-aware Repository. It subclasses the generic
 *   Repository base class (js/core/Repository.js) and adds ONLY Fees
 *   business knowledge: the "رقم_العملية" identifier field (hybrid id per
 *   Data_Schema_Specification §3.2 — generated via a uid()-equivalent when
 *   absent, exactly as saveFee() does today), the two fields ACTUALLY
 *   required today by saveFee() (`رقم_القضية` and `المبلغ`), and the
 *   actual free-text search behavior enforced today by renderFees().
 *
 * WHAT THIS FILE IS NOT
 *   - It does NOT modify js/core/Repository.js, js/core/CasesRepository.js,
 *     js/repositories/ClientsRepository.js,
 *     js/repositories/ChildrenRepository.js, js/core/SessionsRepository.js,
 *     or js/core/TasksRepository.js.
 *   - It does NOT modify js/modules/fees.js, js/modules/cases.js,
 *     js/modules/clients.js, js/modules/children.js,
 *     js/modules/sessions.js, js/modules/documents.js, js/modules/tasks.js,
 *     js/modules/library.js, js/modules/templates.js,
 *     js/modules/dashboard.js, js/modules/settings.js, index.html, any CSS,
 *     or Code_v4.gs.
 *   - It is NOT wired into index.html in this phase (no <script> tag
 *     references it) — pure additive file, inert until a later Migration
 *     Contract stage (Repository_Contract_Report.md §16).
 *   - It does NOT implement IndexedDB and does NOT call or reference
 *     DatabaseService or ApiService (no `syncToSheets()`/`API_URL`
 *     dependency — this Repository never syncs; see "SYNC" note below).
 *   - It does NOT transfer any Business Logic (totals aggregation,
 *     currency formatting, modal wiring) out of js/modules/fees.js — that
 *     stays exactly where it is, untouched.
 *   - It does NOT add any Cache or Sync layer of any kind.
 *
 * ----------------------------------------------------------------
 * INPUT GAP — see Fees_Repository_Report.md §1 for the full table.
 *   Summary (unchanged since Phase 5.6, re-confirmed for this phase):
 *   `PROJECT_MAP.md` remains absent from the archive entirely.
 *   `PROJECT_HISTORY.md` and `NEXT_PHASE.md` remain available only under
 *   their numbered-duplicate filenames in doc/. `PROJECT_STATE.md` is
 *   likewise only present under a numbered-duplicate filename. All three
 *   were read and treated as the authoritative documents regardless.
 *   ADDITIONALLY, and specific to this phase: the five prior Repository
 *   files this phase's instructions require as reference
 *   (`CasesRepository.js`, `SessionsRepository.js`, `TasksRepository.js`)
 *   are physically located at `js/core/` in the delivered archive, NOT at
 *   `js/repositories/` as their own file headers, Tasks_Repository_Report.md
 *   §1, and NEXT_PHASE.md's own prose all state. Only
 *   `ClientsRepository.js` and `ChildrenRepository.js` are physically
 *   present under `js/repositories/`. This is a packaging discrepancy in
 *   the delivered archive, not a code change — the content of each file
 *   was read and used as read (MD5-verified identical to the values
 *   Tasks_Repository_Report.md §5 already recorded for four of the five),
 *   and NONE of them were moved, renamed, or edited by this phase. This
 *   phase's own deliverable is created at the exact path its instructions
 *   specify: `js/repositories/FeesRepository.js`.
 *
 * STORAGE ADAPTER — a temporary, Fees-scoped adapter (same decision
 *   pattern as Cases/Clients/Children/Sessions/Tasks — each Repository
 *   still gets its own adapter; NEXT_PHASE.md still leaves "shared adapter
 *   vs. per-Repository adapter" as an open decision). Reads/writes the
 *   SAME localStorage key ('fees') that index.html's global `data.fees` /
 *   `saveLocal()` already use today.
 *
 * IDENTIFIER — the same documented reconciliation pattern already applied
 *   to Clients/Children/Sessions/Tasks, now confirmed again for Fees,
 *   exactly as NEXT_PHASE.md flagged as the first thing to check for this
 *   phase: Data_Schema_Specification §4.5 abstracts the Primary Key as
 *   generic `id` (Hybrid). Direct inspection of the ACTUAL saveFee() in
 *   js/modules/fees.js shows the generated identifier is stored under the
 *   Arabic field name "رقم_العملية", not a generic "id":
 *     obj['رقم_العملية'] = obj['رقم_العملية'] || uid();
 *   Confirmed independently by Code_v4.gs's SHEET_DEFS for sheet 'الأتعاب',
 *   whose first header column is literally 'رقم_العملية'. Because this
 *   phase's explicit priority is "Behavior Compatible 100% مع Fees Module
 *   الحالي", FeesRepository below configures `idField: 'رقم_العملية'` (so
 *   every inherited Contract-literal method reads/writes the correct field
 *   name) and overrides `_resolveId()` to fall back to a local
 *   uid()-equivalent generator ONLY when 'رقم_العملية' is absent on
 *   create — replicating saveFee()'s `|| uid()` fallback exactly, the same
 *   override pattern used in ClientsRepository.js/ChildrenRepository.js/
 *   SessionsRepository.js/TasksRepository.js (not imported from any of
 *   them — see "NAMING/independence" note below).
 *
 * VALIDATION — Data_Schema_Specification_Report.md §4.5 lists two Required
 *   Fields: `رقم_القضية` and `المبلغ` — no discrepancy with the actual
 *   code this time (same as Tasks, Phase 5.6). Direct inspection of the
 *   ACTUAL saveFee() (js/modules/fees.js) confirms exactly this:
 *     var c = document.getElementById('fFeeCaseNum').value.trim();
 *     var a = document.getElementById('fFeeAmount').value;
 *     if (!c || !a) { toast('يرجى ملء رقم القضية والمبلغ', 'error'); return; }
 *   Note the asymmetry preserved deliberately below: `c` (رقم_القضية) is
 *   read via `.trim()` before the emptiness check, while `a` (المبلغ) is
 *   read WITHOUT `.trim()` — only a raw falsy check (`!a`, true for `''`,
 *   `null`, `undefined`, `0`, but NOT for the non-empty string `'0'` or a
 *   whitespace-only string like `'   '`, since a non-empty string is
 *   truthy in JavaScript regardless of its content). `_validate()` below
 *   reproduces this exact asymmetry field-by-field rather than applying a
 *   single uniform "non-empty after trim" rule to both fields, to stay
 *   byte-for-byte behavior compatible with the live form check. Also per
 *   Data_Schema_Specification §4.5: "`المبلغ` رقمي (توصية — لا فرض نوع
 *   صارم حالياً في الكود، الحقل نص HTML عادي)" — i.e. numeric-ness is
 *   explicitly a RECOMMENDATION only, not an enforced rule today. No
 *   numeric type check is added here, matching that explicit instruction
 *   and the actual code (which never calls `Number()`/`parseFloat()`
 *   before persisting `المبلغ` in saveFee() — only inside renderFees()'s
 *   display-only total/format calls, which are Business Logic this phase
 *   is forbidden from moving).
 *
 * SEARCH — Data_Schema_Specification_Report.md §4.5 states Search Fields
 *   are narrowly `اسم_الموكل`, `رقم_القضية`. Direct inspection of the
 *   ACTUAL current renderFees() (js/modules/fees.js) shows the claim
 *   UNDERSTATES the real behavior — same recurring pattern as
 *   Cases/Clients/Children/Sessions/Tasks: it is not scoped to two fields,
 *   it is the same full-record free-text join pattern:
 *     var rows = data.fees.filter(function(f) {
 *       return !s || Object.values(f).join(' ').toLowerCase().includes(s);
 *     });
 *   bound to a real, live UI search box (`#searchFees`). Because this
 *   phase's explicit priority is "Behavior Compatible 100% مع Fees Module
 *   الحالي" — and because a live, wired UI control exercising this exact
 *   behavior today is stronger evidence than an abstract planning
 *   document's narrower field list — `_matchesSearch` is overridden here
 *   to replicate the actual free-text join across `FEES_LEGACY_FIELDS`
 *   (excluding the new audit/metadata fields that did not exist in the
 *   record shape before this Repository layer, same reasoning as
 *   Cases/Clients/Children/Sessions/Tasks). This divergence is called out
 *   explicitly in Fees_Repository_Report.md §2.4.
 *
 * FILTER — Data_Schema_Specification §4.5 / Repository_Contract_Report
 *   §4.5 both document Filter Fields for Fees as `رقم_القضية` and a range
 *   filter on `تاريخ_الاستلام` only. Direct inspection of index.html and
 *   renderFees() confirms there is NO live filter control of ANY kind for
 *   Fees today — not for case number, not for payment method
 *   (`طريقة_الدفع`), not for amount (`المبلغ`), and there is no status
 *   concept for Fees at all (no `الحالة` field exists anywhere in
 *   FEES_FIELDS/FEES_MAP, in index.html's fee form, or in Code_v4.gs's
 *   'الأتعاب' sheet headers — confirmed by grepping all three; this is a
 *   genuine absence, not an oversight to reconcile, and is documented
 *   verbatim as an Input Gap between this phase's instructions — which
 *   ask for a "Status Filter" test — and the live schema, in
 *   Fees_Repository_Report.md §2.5). Only the free-text search box
 *   (`#searchFees`) exists as a live query control. Exactly as with
 *   Tasks/Sessions/Children, the additive `filter()` wrapper below is a
 *   generic, data-driven pass-through (no field hardcoded), so it already
 *   supports `{رقم_القضية: ...}` (documented), `{طريقة_الدفع: ...}` and
 *   range filters on `{المبلغ: {op, value}}` / `{تاريخ_الاستلام: {op,
 *   value}}` (all real fields, even though undocumented as Filter Fields)
 *   without any entity-specific override needed. A `{الحالة: ...}` filter
 *   is also accepted by the same generic engine without throwing, but
 *   will simply match zero records against real data today, since no fee
 *   record has ever carried that key — this is the harness's basis for
 *   the required "Status Filter" verification test (§2.5 of the report),
 *   proving graceful, non-crashing behavior rather than fabricating a
 *   status field that does not exist in the live application.
 *
 * SORT — Data_Schema_Specification §4.5 lists `تاريخ_الاستلام` as the Sort
 *   Field. Direct inspection of the ACTUAL current renderFees() shows NO
 *   `.sort()` call exists at all — fee rows render in `data.fees`
 *   insertion order only, identical in kind to Children's Phase 5.4 and
 *   Tasks' Phase 5.6 findings. Because this phase's explicit priority is
 *   "Behavior Compatible 100%", the additive `sort()` method below does
 *   not replace or emulate any existing behavior — it is a genuinely new
 *   capability, defaulting to `تاريخ_الاستلام` ascending (missing/
 *   unparseable receipt dates sort first) exactly as
 *   Data_Schema_Specification recommends, since no real behavior exists
 *   to contradict it.
 *
 * SYNC — Code_v4.gs's SHEET_DEFS confirms a real 'الأتعاب' sheet DOES
 *   exist in the Apps Script backend, and js/modules/fees.js's saveFee()
 *   calls `ApiService.syncRow('الأتعاب', obj, idx)` (create/update ARE
 *   synced) — but `deleteFee()` does NOT call `ApiService.deleteData()`/
 *   `syncDeleteToSheets()` at all (a pre-existing, already-documented gap
 *   — the fees.js file's own inline comment above `deleteFee()` names this
 *   explicitly, matching `Data_Schema_Specification_Report.md §4.5`'s
 *   `"syncPolicy" حذف = local-only` and the "Documents/Tasks/Fees
 *   delete-sync gap" noted project-wide). This does not change anything
 *   about this Repository's scope: this phase's instructions forbid
 *   adding any Sync here regardless, consistent with every prior
 *   Repository (none of which sync either) — it is a pure localStorage
 *   CRUD layer. Nothing here forecloses wiring a sync layer on top of this
 *   Repository later without changing its Contract.
 *
 * NAMING / independence — same reconciliation as CasesRepository.js,
 *   ClientsRepository.js, ChildrenRepository.js, SessionsRepository.js,
 *   and TasksRepository.js (see their header "NAMING"/"IDENTIFIER"
 *   notes): every Contract-literal method (create/update/delete/get/
 *   getAll/find/exists/count/bulkInsert/bulkUpdate/bulkDelete/search/
 *   export/import/clear/transaction) is inherited UNCHANGED from
 *   Repository.prototype. insert()/remove()/filter()/sort()/validate()
 *   are additive convenience wrappers requested by this phase's
 *   instructions, not renamed or removed Contract methods. This file does
 *   not import or reference ClientsRepository.js/CasesRepository.js/
 *   ChildrenRepository.js/SessionsRepository.js/TasksRepository.js in any
 *   way — its local uid()-equivalent generator and Storage Adapter are
 *   self-contained duplicates of the same pattern, not shared code, per
 *   this phase's "depends only on Repository.js" instruction.
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
      'FeesRepository requires js/core/Repository.js to be loaded first ' +
      '(Repository base class not found).'
    );
  }

  // PHASE 8 / SUB-PHASE 8.5.2 — Repository Wiring: FeesRepository's Storage
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
      'FeesRepository requires js/core/DatabaseService.js to be loaded ' +
      'first (DatabaseService class not found).'
    );
  }
  if (typeof IndexedDBAdapter !== 'function') {
    throw new Error(
      'FeesRepository requires js/core/IndexedDBAdapter.js to be ' +
      'loaded first (IndexedDBAdapter class not found).'
    );
  }

  // ================================================================
  // 1. Fees business knowledge (private to this file)
  // ================================================================

  /**
   * Identifier field — actual runtime field name (see file header
   * "IDENTIFIER" note). A hybrid id per Data_Schema_Specification §3.2:
   * generated via a uid()-equivalent, but stored under this Arabic key,
   * not a generic "id". Also the first header column of the real
   * 'الأتعاب' sheet in Code_v4.gs.
   */
  var FEES_ID_FIELD = 'رقم_العملية';

  /**
   * Fields ACTUALLY required today, verified against the ACTUAL saveFee()
   * runtime check in js/modules/fees.js — matches
   * Data_Schema_Specification §4.5 exactly (no discrepancy this time,
   * same as Tasks in Phase 5.6). See file header "VALIDATION" note for
   * the deliberate trim/no-trim asymmetry between the two fields.
   */
  var FEES_REQUIRED_FIELDS = ['رقم_القضية', 'المبلغ'];

  /** Filter Fields per Data_Schema_Specification §4.5 / Repository_Contract
   *  §4.5 — `رقم_القضية` and a range filter on `تاريخ_الاستلام`. NEITHER is
   *  actually wired to a live UI control today (see file header "FILTER"
   *  note — Fees has no filter dropdown of any kind, only free-text
   *  search). Exposed here for documentation only — filter() below is a
   *  generic, data-driven pass-through (no field hardcoded), same as
   *  TasksRepository.filter()/SessionsRepository.filter(), so this field
   *  (and every other real field, e.g. `طريقة_الدفع`, `المبلغ`) already
   *  works through it without any entity-specific override. */
  var FEES_FILTER_FIELDS = ['رقم_القضية', 'تاريخ_الاستلام'];

  /** Sort Fields per Data_Schema_Specification §4.5 — `تاريخ_الاستلام`. The
   *  ACTUAL current renderFees() applies no sort at all (insertion order
   *  only, same finding as Children/Tasks) — so this is a purely
   *  additive new capability, not a reconciliation against existing
   *  behavior (see file header "SORT" note). */
  var FEES_SORT_FIELDS = ['تاريخ_الاستلام'];

  /**
   * The full set of legacy Arabic/business fields for Fees, used to
   * replicate the exact legacy free-text search behavior (see
   * _matchesSearch override — file header "SEARCH" note) without
   * accidentally matching against the new English audit/metadata fields
   * (createdAt, updatedAt, deletedAt, version, syncVersion, checksum) that
   * did not exist in the record shape before this Repository layer —
   * including them in the join would change search results and break
   * "100% Behavior Compatible".
   *
   * Derived from FEES_MAP (js/modules/fees.js) — رقم_القضية, اسم_الموكل,
   * نوع_الأتعاب, المبلغ, تاريخ_الاستلام, طريقة_الدفع, الملاحظات — plus:
   *   - 'رقم_العملية'   : the identifier itself (set by saveFee() and
   *                       already part of every real record — included in
   *                       Object.values(f) today, so included here too).
   *   - 'تاريخ_الإنشاء' : creation timestamp stamped by saveFee().
   * Matches, in the same order, Code_v4.gs's 'الأتعاب' sheet headers:
   *   ['رقم_العملية','رقم_القضية','اسم_الموكل','نوع_الأتعاب','المبلغ',
   *    'تاريخ_الاستلام','طريقة_الدفع','الملاحظات','تاريخ_الإنشاء']
   * No other dynamically-added field exists for Fees (unlike Clients'
   * 'portal_token') — confirmed by full read of js/modules/fees.js (227
   * lines total, no other field ever written).
   */
  var FEES_LEGACY_FIELDS = [
    'رقم_العملية', 'رقم_القضية', 'اسم_الموكل', 'نوع_الأتعاب', 'المبلغ',
    'تاريخ_الاستلام', 'طريقة_الدفع', 'الملاحظات', 'تاريخ_الإنشاء'
  ];

  // ================================================================
  // 2. Storage Adapter — DatabaseService-backed (PHASE 8 / SUB-PHASE 8.5.2)
  // ================================================================
  // See file header "WIRING UPDATE" note (added by this phase). Reads/
  // writes the SAME 'fees' key index.html already uses today, in the
  // SAME flat JSON-array shape — LocalStorageAdapter's own default empty
  // keyPrefix guarantees this. Public factory NAME and SIGNATURE are
  // unchanged from the prior phase; only what it builds internally changed
  // (a real DatabaseService + LocalStorageAdapter pair instead of the old
  // hand-rolled ad-hoc {read,write} object).

  /**
   * Builds the Storage Adapter injected into FeesRepository's underlying
   * Repository base class: a real DatabaseService instance wrapping a real
   * LocalStorageAdapter instance. This satisfies Repository.js's duck-typed
   * contract ({read(entityKey), write(entityKey, records)}) because
   * DatabaseService exposes both methods, each delegating unchanged to the
   * LocalStorageAdapter beneath it — which in turn reads/writes the
   * browser's real localStorage (or an injected localStorage-shaped
   * stand-in) under the exact same key ('fees') the current global
   * `data.fees`/`saveLocal()` already use.
   * @param {Storage} [storageImpl] - optional localStorage-shaped override
   *   (e.g. a test harness's in-memory stand-in). When omitted,
   *   LocalStorageAdapter itself resolves the real global localStorage
   *   lazily, on first read()/write() call (not here, not at construction
   *   time), matching LocalStorageAdapter's own documented lazy-engine-
   *   resolution design.
   * @returns {DatabaseService}
   */
  function createFeesLocalStorageAdapter(storageImpl) {
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
  // ChildrenRepository.js/SessionsRepository.js/TasksRepository.js, per
  // this phase's "depends only on Repository.js" instruction (no
  // cross-Repository imports).
  //
  // Verified identical algorithm to js/ui-utils.js:
  //   function uid(){return Date.now().toString(36)+Math.random().toString(36).slice(2,6);}

  function generateFeeId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  }

  // ================================================================
  // 4. FeesRepository — subclass
  // ================================================================

  /**
   * @class FeesRepository
   * @param {{storageAdapter?: object, idGenerator?: function}} [config] -
   *   Optional overrides (e.g. for tests). Defaults to the
   *   localStorage-backed placeholder adapter and the local uid()-
   *   equivalent generator above.
   */
  function FeesRepository(config) {
    config = config || {};
    var storageAdapter = config.storageAdapter || createFeesLocalStorageAdapter();
    var idGenerator = typeof config.idGenerator === 'function' ? config.idGenerator : generateFeeId;

    Repository.call(this, {
      entityKey: 'fees',
      storageAdapter: storageAdapter,
      idField: FEES_ID_FIELD,
      idGenerator: idGenerator,
      // No officially documented narrow Search Fields list is accurate for
      // Fees (file header "SEARCH" note) — searchFields is set to the
      // full legacy field list so that even a caller bypassing the
      // _matchesSearch override (e.g. via a future field-scoped query
      // option) still sees a sensible default rather than an empty scope.
      searchFields: FEES_LEGACY_FIELDS,
      softDelete: true, // Data_Schema_Specification §4.5 Delete Rules: Soft Delete.
      unsupportedOperations: []
    });
  }

  FeesRepository.prototype = Object.create(Repository.prototype);
  FeesRepository.prototype.constructor = FeesRepository;

  // ----------------------------------------------------------------
  // 4.1 Identifier resolution — extension point (see file header
  //     "IDENTIFIER" note)
  // ----------------------------------------------------------------

  /**
   * _resolveId(record) — overrides the base class default. The base
   * class's default (when idField is set) is `return record[idField];`
   * with no generation fallback, correct for Cases (a true user-entered
   * natural key, always present by validation time). Fees' identifier is
   * a HYBRID id (Data_Schema §3.2): generated only when absent, exactly
   * replicating saveFee()'s `obj['رقم_العملية'] = obj['رقم_العملية'] ||
   * uid();`. This override is the only behavioral difference from the base
   * class's natural-key resolution path (same pattern as
   * ClientsRepository._resolveId / ChildrenRepository._resolveId /
   * SessionsRepository._resolveId / TasksRepository._resolveId, duplicated
   * independently here).
   * @param {Object} record
   * @returns {string}
   * @protected
   * @override
   */
  FeesRepository.prototype._resolveId = function (record) {
    var existing = record ? record[FEES_ID_FIELD] : null;
    return (existing != null && existing !== '') ? existing : this._idGenerator();
  };

  // ----------------------------------------------------------------
  // 4.2 Validation — Repository Contract §9 (extension point)
  // ----------------------------------------------------------------

  /**
   * _validate(operation, record) — overrides the base class no-op hook.
   * Enforces exactly the rule verified in ACTUAL saveFee() today: two
   * required fields — رقم_القضية (checked WITH `.trim()`) and المبلغ
   * (checked WITHOUT `.trim()`, a plain falsy check) — see file header
   * "VALIDATION" note for why this asymmetry is deliberate and preserved.
   * Applies to create/update (delete does not validate field content —
   * Contract §9 default).
   * @protected
   * @override
   */
  FeesRepository.prototype._validate = function (operation, record) {
    if (operation !== 'create' && operation !== 'update') {
      return { valid: true, errors: [] };
    }
    var errors = [];
    var caseNum = record ? record['رقم_القضية'] : undefined;
    var caseNumEmpty = caseNum == null || (typeof caseNum === 'string' && caseNum.trim() === '');
    if (caseNumEmpty) {
      errors.push({ field: 'رقم_القضية', message: 'الحقل "رقم_القضية" إلزامي ولا يمكن أن يكون فارغاً.' });
    }
    var amount = record ? record['المبلغ'] : undefined;
    // Deliberately NOT trimmed — replicates saveFee()'s raw `!a` check
    // exactly (a non-empty, whitespace-only string is NOT rejected today).
    var amountEmpty = amount == null || amount === '';
    if (amountEmpty) {
      errors.push({ field: 'المبلغ', message: 'الحقل "المبلغ" إلزامي ولا يمكن أن يكون فارغاً.' });
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
  FeesRepository.prototype.validate = function (record, operation) {
    return this._validate(operation || 'create', record);
  };

  // ----------------------------------------------------------------
  // 4.3 Search — Repository Contract §7 (extension point)
  // ----------------------------------------------------------------

  /**
   * _matchesSearch(record, term) — overrides the base class's
   * searchFields-scoped substring scan to exactly replicate the ACTUAL
   * current renderFees() behavior: `Object.values(f).join(' ')` across
   * every legacy business field (excluding the new audit/metadata fields
   * that did not exist in the record before this Repository layer — see
   * FEES_LEGACY_FIELDS comment above). Required for "100% Behavior
   * Compatible" free-text search once this Repository is eventually wired
   * to replace renderFees()'s inline filter — see file header "SEARCH"
   * note for why this deliberately overrides the narrower two-field list
   * both planning reports claim for Fees.
   * @protected
   * @override
   */
  FeesRepository.prototype._matchesSearch = function (record, term) {
    if (!term) return true;
    var needle = String(term).trim().toLowerCase();
    if (!needle) return true;
    var joined = FEES_LEGACY_FIELDS
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
   * documented `{رقم_القضية: ...}` pattern, range filters such as
   * `{تاريخ_الاستلام: {op, value}}` / `{المبلغ: {op, value}}`, and the
   * real-but-undocumented `{طريقة_الدفع: ...}` field — none of which are
   * wired to any live UI control today (see file header "FILTER" note) —
   * same pattern as TasksRepository.filter()/SessionsRepository.filter().
   * Does not replace or rename search() — additive only.
   * @param {Object} filterObj - Query Model filter object (Contract §7).
   * @returns {Object[]}
   */
  FeesRepository.prototype.filter = function (filterObj) {
    return this.search({ filter: filterObj }).items;
  };

  // ----------------------------------------------------------------
  // 4.4 Sort — Repository Contract §7 (extension point)
  // ----------------------------------------------------------------

  /**
   * sort(records, sortSpec) — PUBLIC convenience wrapper requested by this
   * phase's instructions. Applies the base class's generic comparator
   * engine (_compareRecords) to an explicit array of records, defaulting
   * sortSpec to FEES_SORT_FIELDS (`تاريخ_الاستلام` ascending — a purely
   * additive capability, since the ACTUAL renderFees() applies no sort at
   * all; see file header "SORT" note) when omitted. Does not mutate the
   * input array or replace search()'s own sort option — additive only.
   * @param {Object[]} [records] - defaults to this.getAll() when omitted.
   * @param {Array<{field:string, direction?:'asc'|'desc'}>|{field:string, direction?:'asc'|'desc'}} [sortSpec]
   * @returns {Object[]}
   */
  FeesRepository.prototype.sort = function (records, sortSpec) {
    var list = Array.isArray(records) ? records.slice() : this.getAll();
    var spec = sortSpec || FEES_SORT_FIELDS.map(function (f) { return { field: f, direction: 'asc' }; });
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
  FeesRepository.prototype.insert = function (entity) {
    return this.create(entity);
  };

  /**
   * remove(id) -> WriteResult
   * Alias for the inherited, Contract-literal delete(id).
   * @param {string} id
   * @returns {Promise<{success:boolean, record:?Object, error:?Object}>}
   */
  FeesRepository.prototype.remove = function (id) {
    return this.delete(id);
  };

  // ================================================================
  // 5. Exports
  // ================================================================

  var api = {
    FeesRepository: FeesRepository,
    createFeesLocalStorageAdapter: createFeesLocalStorageAdapter
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  if (root) {
    root.FeesRepository = FeesRepository;
    root.createFeesLocalStorageAdapter = createFeesLocalStorageAdapter;
  }

})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
