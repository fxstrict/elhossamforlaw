/**
 * ================================================================
 * TemplatesRepository.js — Templates Repository | نظام الحسام للمحاماة
 * ================================================================
 * V10 — Offline First Architecture
 * PHASE 5 — SUB-PHASE 5.10.2 — Templates Repository (Build)
 * (يلي مباشرة PHASE 5 / SUB-PHASE 5.10.1 — Templates Repository Audit,
 *  READ-ONLY، الذي أُنتِج في هذه المحادثة قبل هذا الملف)
 *
 * Source of design (no assumption outside these — see Input Gap in
 * Templates_Repository_Report.md):
 *   - Repository_Contract_Report_PHASE2_V10.md  (Contract §3, Catalog §4.9,
 *     Standards §19 — literal operation names, no synonyms)
 *   - Data_Schema_Specification_Report_PHASE4_V10.md (§4.9 Templates:
 *     Primary Key, Required Fields, Search/Sort/Filter Fields, Delete/Sync
 *     Rules)
 *   - js/core/Repository.js (Repository Core — Phase 5.1, extended here,
 *     never modified)
 *   - js/repositories/CasesRepository.js, ClientsRepository.js,
 *     ChildrenRepository.js, SessionsRepository.js, TasksRepository.js,
 *     FeesRepository.js, DocumentsRepository.js (Phases 5.2–5.8 — the
 *     pattern reused again here: temporary localStorage Adapter, additive
 *     insert/remove/filter/sort/validate wrappers, documented deviations
 *     resolved in favor of actual runtime behavior — none of these seven
 *     files read for implementation details beyond this pattern; none
 *     modified, none imported from)
 *   - Direct inspection of js/modules/templates.js (actual current
 *     runtime behavior of saveTemplate()/deleteTemplate()/editTemplate()/
 *     filterTemplates()/renderTemplates() — ground truth for the "100%
 *     Behavior Compatible" requirement of this phase)
 *   - Direct inspection of index.html (FIELDS.templates / MAP.templates
 *     field definitions, `data.templates` localStorage wiring,
 *     `#templateTabs` — no free-text search box of any kind exists
 *     anywhere for Templates)
 *   - Direct inspection of Code_v4.gs (SHEET_DEFS — see "SYNC" note below)
 *
 * WHAT THIS FILE IS
 *   The eighth concrete, entity-aware Repository built in this sequence.
 *   (NOTE: per NEXT_PHASE.md's own documented migration order — Library →
 *   Templates → Fees → ... — Library Repository was meant to precede this
 *   one. The archive audited in Phase 5.10.1 contained no
 *   LibraryRepository.js / Library_Repository_Report.md at all. This file
 *   does not depend on Library in any way — see "INPUT GAP" note below —
 *   so its own correctness is unaffected, but the numbering "eighth" is
 *   provisional pending that separate gap being resolved.)
 *   It subclasses the generic Repository base class (js/core/Repository.js)
 *   and adds ONLY Templates business knowledge: the generic `id` (Hybrid)
 *   identifier field, the two fields ACTUALLY required today by
 *   saveTemplate() (`العنوان` and `القسم`), and an explicitly-decided
 *   free-text search policy (see "SEARCH" note — no live precedent exists
 *   to replicate, unlike every prior entity).
 *
 * WHAT THIS FILE IS NOT
 *   - It does NOT modify js/core/Repository.js, CasesRepository.js,
 *     ClientsRepository.js, ChildrenRepository.js, SessionsRepository.js,
 *     TasksRepository.js, FeesRepository.js, or DocumentsRepository.js.
 *   - It does NOT modify js/modules/templates.js, index.html, any CSS, or
 *     Code_v4.gs.
 *   - It is NOT wired into index.html in this phase (no <script> tag
 *     references it) — pure additive file, inert until a later Migration
 *     Contract stage (Repository_Contract_Report.md §16).
 *   - It does NOT implement IndexedDB and does NOT call or reference
 *     DatabaseService or ApiService (no `syncToSheets()`/`API_URL`
 *     dependency — this Repository never syncs; see "SYNC" note below).
 *   - It does NOT transfer any DOM/rendering logic (tab-bar construction,
 *     card HTML, modal wiring) out of js/modules/templates.js — that stays
 *     exactly where it is, untouched.
 *   - It does NOT resolve, remove, or paper over the Library Repository
 *     sequencing gap noted above — out of scope for this file.
 *
 * ----------------------------------------------------------------
 * INPUT GAP — see Templates_Repository_Report.md §1 for the full table.
 *   Summary: the archive audited for Phase 5.10.1 ends at Documents
 *   Repository (5.8) in PROJECT_STATE.md/NEXT_PHASE.md and contains no
 *   LibraryRepository.js, Library_Repository_Report.md, or
 *   verify_library_repository.js at all, despite NEXT_PHASE.md's own
 *   documented next-step and migration-order sections naming Library
 *   before Templates. This is a project-sequencing gap, not a defect in
 *   Templates itself — every Repository in this project (Cases through
 *   Documents) is independently self-contained and depends only on
 *   js/core/Repository.js, never on a sibling Repository, so building
 *   TemplatesRepository.js without Library existing yet introduces no
 *   broken dependency. The gap is documented here for traceability and
 *   must still be closed (Library Repository built) before this project's
 *   own migration-order documentation is internally consistent again.
 *
 *   ADDITIONALLY, and specific to Templates: both planning documents
 *   (Data_Schema_Specification_Report.md §4.9 and
 *   Repository_Contract_Report.md §4.9) state Templates' Sync Priority as
 *   "معطَّل بالكامل تصميماً — لا Sheet مقابل أصلاً" ("no corresponding
 *   Sheet exists at all"). Direct inspection of Code_v4.gs's SHEET_DEFS
 *   shows this is not literally true: a Sheet definition named 'الصيغ'
 *   DOES exist there, with headers identical in shape to the dormant
 *   'المكتبة' (Library) Sheet definition immediately preceding it
 *   (['id','العنوان','النوع','القسم','الرابط','الوصف','تاريخ_الإنشاء']).
 *   Neither Sheet is referenced by js/api/api.js's loadAllSheets() (which
 *   lists only 6 pairs: القضايا/الجلسات/الموكلين/المستندات/المهام/
 *   الأتعاب — plus الأطفال handled separately per ChildrenRepository.js's
 *   own file header), and js/modules/templates.js never calls
 *   syncToSheets()/syncDeleteToSheets()/ApiService in any form — so the
 *   FUNCTIONAL conclusion (no sync happens today) is correct, but the
 *   REASON given in both planning documents ("no Sheet exists") is
 *   factually wrong; the accurate description is "a dormant, unwired
 *   Sheet definition exists but is never loaded or synced" — the exact
 *   same situation already correctly documented for Library. This
 *   Repository's behavior is unaffected either way (it never syncs
 *   regardless of which description is accurate), but the correction is
 *   recorded here so it is not silently propagated forward.
 *
 * STORAGE ADAPTER — a temporary, Templates-scoped adapter (same decision
 *   pattern as every prior Repository — each one still gets its own
 *   adapter; NEXT_PHASE.md still leaves "shared adapter vs.
 *   per-Repository adapter" as an open decision). Reads/writes the SAME
 *   localStorage key ('templates') that index.html's global
 *   `data.templates` / `saveLocal()` already use today.
 *
 * IDENTIFIER — unlike every entity from Clients through Documents
 *   (Phases 5.3–5.8), which all reconciled an abstractly-documented `id`
 *   down to a real Arabic-named field, Templates is the first entity in
 *   this sequence confirmed to genuinely use the generic field name `id`
 *   at runtime. Direct inspection of the ACTUAL saveTemplate() in
 *   js/modules/templates.js confirms:
 *     obj['id'] = obj['id'] || uid();
 *   with no Arabic-named alternative anywhere in FIELDS.templates,
 *   MAP.templates, or Code_v4.gs's dormant 'الصيغ' Sheet headers (whose
 *   first column is literally 'id', matching 'المكتبة''s own first column
 *   for Library — see file header "INPUT GAP" note). Because this phase's
 *   explicit priority is "Behavior Compatible 100% مع Templates Module
 *   الحالي", TemplatesRepository below configures `idField: 'id'` (no
 *   Arabic-field override needed) and overrides `_resolveId()` only to
 *   replicate the `|| uid()` hybrid-generation fallback — the same
 *   override *shape* used in every prior Repository, just against the
 *   literal field `id` instead of an Arabic key this time.
 *
 * VALIDATION — Data_Schema_Specification_Report.md §4.9 lists exactly ONE
 *   Required Field: `العنوان` (and separately lists `القسم` under Optional
 *   Fields). Direct inspection of the ACTUAL saveTemplate() (
 *   js/modules/templates.js) contradicts this — TWO fields are checked,
 *   both via `.trim()` (a symmetric pair, same shape as Documents 5.8, no
 *   asymmetry like Fees 5.7):
 *     var t = document.getElementById('fTplTitle').value.trim();  // العنوان
 *     var c = document.getElementById('fTplCat').value.trim();    // القسم
 *     if (!t || !c) { toast('يرجى ملء الاسم والقسم', 'error'); return; }
 *   Independently corroborated by index.html's form markup: both
 *   `fTplTitle` and `fTplCat` carry a `<span class="req">*</span>`
 *   required-field marker; `fTplUrl`/`fTplDesc` do not. Because this
 *   phase's explicit priority is "Behavior Compatible 100%", `_validate()`
 *   below enforces BOTH fields, resolving the documented single-field
 *   claim in favor of the live, UI-confirmed two-field behavior — the same
 *   resolution approach already used for Sessions' §4.4 discrepancy
 *   (Phase 5.5). Full rationale: Templates_Repository_Report.md §2.3.
 *
 * SEARCH — Data_Schema_Specification_Report.md §4.9 states Search Fields
 *   are `العنوان`, `الوصف`. Direct inspection of the ACTUAL current
 *   templates.js (confirmed independently by PROJECT_HISTORY.md's own
 *   Phase 11A entry: "Confirmed no search box/function ever existed for
 *   Templates") shows there is NO free-text search implementation at all
 *   — not narrower than documented (as with every prior entity's
 *   deviation), but entirely ABSENT. Templates' only query mechanism is
 *   the category-tab filter (`filterTemplates(cat)` / `#templateTabs`).
 *   This is the first entity in the whole Phase 5 sequence with zero live
 *   search behavior to replicate either way. Per
 *   Templates_Repository_Report.md §2.4, the explicit decision made here
 *   is: implement the SAME generic full-record free-text join pattern
 *   already established for every prior entity (`Object.values(record)
 *   .join(' ')`), scoped to Templates' legacy business fields, as a
 *   genuinely ADDITIVE new capability (not a replication of existing
 *   behavior, since none exists) — consistent with how sort() was already
 *   added additively for Children/Tasks/Fees/Documents where no live sort
 *   existed. This is a documented design choice, not a silent assumption
 *   — an alternative (no search support at all, throwing
 *   UnsupportedOperationError) was considered and rejected because it
 *   would make TemplatesRepository behave inconsistently with every
 *   sibling Repository's search() Contract method for no compatibility
 *   benefit (there is nothing live to stay compatible with either way).
 *
 * FILTER — Data_Schema_Specification §4.9 / Repository_Contract_Report
 *   §4.9 both document Filter Fields for Templates as `النوع` and `القسم`.
 *   Direct inspection of index.html and renderTemplates() confirms:
 *     - `القسم` IS live and wired — dynamically-built category tabs
 *       (`#templateTabs`, built from `[...new Set(data.templates.map(t =>
 *       t['القسم']))]`) drive `filterTemplates(cat)` → `currentTplFilter`
 *       → `renderTemplates()`'s own `.filter()` call. Real, active
 *       filtering, exact-match on `القسم`.
 *     - `النوع` is documented but NOT wired to any filter control — it is
 *       used only to render a type badge/icon per card (`word`/`pdf`/
 *       `other`), never to narrow the list. Same "documented field, no
 *       live UI control" pattern already seen for `رقم_القضية` in
 *       Fees/Documents (Phases 5.7/5.8).
 *   The additive `filter()` wrapper below is a generic, data-driven
 *   pass-through (no field hardcoded), so it already supports both
 *   `{القسم: ...}` (live) and `{النوع: ...}` (documented, unwired) without
 *   any entity-specific override needed — same pattern as every prior
 *   Repository's filter().
 *
 * SORT — Data_Schema_Specification §4.9 lists `العنوان` as the Sort Field.
 *   Direct inspection of the ACTUAL current renderTemplates() shows NO
 *   `.sort()` call exists at all — templates render in `data.templates`
 *   insertion order only (after category filtering), identical in kind to
 *   Children/Tasks/Fees/Documents' prior findings. The additive `sort()`
 *   method below does not replace or emulate any existing behavior — it
 *   is a genuinely new capability, defaulting to `العنوان` ascending
 *   exactly as Data_Schema_Specification recommends, since no real
 *   behavior exists to contradict it.
 *
 * SYNC — Code_v4.gs's SHEET_DEFS shows a dormant Sheet definition named
 *   'الصيغ' exists (see file header "INPUT GAP" note above for the full
 *   correction of both planning documents' "no Sheet at all" claim), but
 *   it is never referenced by js/api/api.js's loadAllSheets(), and
 *   js/modules/templates.js's saveTemplate()/deleteTemplate() never call
 *   ApiService/syncToSheets/syncDeleteToSheets in any form — functionally
 *   local-only, matching Library's already-documented characteristic
 *   exactly. This Repository adds no Sync layer of any kind, consistent
 *   with every prior Repository (none of which sync either) — it is a
 *   pure localStorage CRUD layer. Nothing here forecloses wiring a sync
 *   layer on top of either this Repository or the dormant 'الصيغ' Sheet
 *   later, without changing this Repository's Contract.
 *
 * DEAD CODE NOTE — js/modules/templates.js declares its own
 *   `TEMPLATES_FIELDS`/`TEMPLATES_MAP` constants (lines 51–65), but
 *   `collectForm()`/`fillForm()`/`resetForm()` (js/print-utils.js) read
 *   from the GLOBAL `FIELDS.templates`/`MAP.templates` defined in
 *   index.html instead — confirmed identical in content by direct
 *   comparison, but confirmed by grep that `TEMPLATES_FIELDS`/
 *   `TEMPLATES_MAP` are never referenced anywhere at runtime (dead,
 *   duplicate constants, explicitly permitted to remain per
 *   PROJECT_HISTORY.md §Phase 11B: "FIELDS.templates/MAP.templates may be
 *   left in place"). This Repository does not import, reference, or rely
 *   on either copy — its own field knowledge (TEMPLATES_ID_FIELD,
 *   TEMPLATES_REQUIRED_FIELDS, etc. below) is derived directly from
 *   saveTemplate()'s live runtime checks, not from either FIELDS/MAP
 *   object.
 *
 * NAMING / independence — same reconciliation as every prior Repository
 *   (see their own header "NAMING"/"IDENTIFIER" notes): every
 *   Contract-literal method (create/update/delete/get/getAll/find/exists/
 *   count/bulkInsert/bulkUpdate/bulkDelete/search/export/import/clear/
 *   transaction) is inherited UNCHANGED from Repository.prototype.
 *   insert()/remove()/filter()/sort()/validate() are additive convenience
 *   wrappers requested by this phase's instructions, not renamed or
 *   removed Contract methods. This file does not import or reference
 *   CasesRepository.js/ClientsRepository.js/ChildrenRepository.js/
 *   SessionsRepository.js/TasksRepository.js/FeesRepository.js/
 *   DocumentsRepository.js in any way — its local uid()-equivalent
 *   generator and Storage Adapter are self-contained duplicates of the
 *   same pattern, not shared code, per this phase's "depends only on
 *   Repository.js" instruction.
 *
 * Load order: additive file, not yet wired into index.html. Depends only
 * on js/core/Repository.js having been loaded first (throws a clear error
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
      'TemplatesRepository requires js/core/Repository.js to be loaded ' +
      'first (Repository base class not found).'
    );
  }

  // PHASE 8 / SUB-PHASE 8.5.2 — Repository Wiring: TemplatesRepository's Storage
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
      'TemplatesRepository requires js/core/DatabaseService.js to be loaded ' +
      'first (DatabaseService class not found).'
    );
  }
  if (typeof IndexedDBAdapter !== 'function') {
    throw new Error(
      'TemplatesRepository requires js/core/IndexedDBAdapter.js to be ' +
      'loaded first (IndexedDBAdapter class not found).'
    );
  }

  // ================================================================
  // 1. Templates business knowledge (private to this file)
  // ================================================================

  /**
   * Identifier field — actual runtime field name (see file header
   * "IDENTIFIER" note). A hybrid id per Data_Schema_Specification §3.2:
   * generated via a uid()-equivalent, stored under the GENERIC key `id`
   * — unlike every entity from Clients through Documents, Templates
   * genuinely has no Arabic-named identifier field anywhere (confirmed
   * against FIELDS.templates/MAP.templates and Code_v4.gs's dormant
   * 'الصيغ' Sheet headers, whose own first column is also literally
   * 'id').
   */
  var TEMPLATES_ID_FIELD = 'id';

  /**
   * Fields ACTUALLY required today, verified against the ACTUAL
   * saveTemplate() runtime check in js/modules/templates.js — DEVIATES
   * from Data_Schema_Specification §4.9 (which lists `العنوان` only,
   * §4.9 treats `القسم` as merely Optional). See file header
   * "VALIDATION" note for the full resolution rationale (both fields
   * trimmed, no asymmetry, confirmed also by the `<span class="req">*`
   * markers on both fTplTitle and fTplCat in index.html).
   */
  var TEMPLATES_REQUIRED_FIELDS = ['العنوان', 'القسم'];

  /** Filter Fields per Data_Schema_Specification §4.9 / Repository_Contract
   *  §4.9 — `النوع` and `القسم`. Only `القسم` is actually wired to a live
   *  UI control today (the dynamically-built `#templateTabs` bar);
   *  `النوع` is documented but unwired (used only for a display badge —
   *  see file header "FILTER" note). Exposed here for documentation
   *  only — filter() below is a generic, data-driven pass-through (no
   *  field hardcoded), same as every prior Repository's filter(), so
   *  both fields already work through it without any entity-specific
   *  override. */
  var TEMPLATES_FILTER_FIELDS = ['النوع', 'القسم'];

  /** Sort Fields per Data_Schema_Specification §4.9 — `العنوان`. The
   *  ACTUAL current renderTemplates() applies no sort at all (insertion
   *  order only, after category filtering — same finding as
   *  Children/Tasks/Fees/Documents) — so this is a purely additive new
   *  capability, not a reconciliation against existing behavior (see
   *  file header "SORT" note). */
  var TEMPLATES_SORT_FIELDS = ['العنوان'];

  /**
   * The full set of legacy Arabic/business fields for Templates, used to
   * provide an additive full-record free-text search (see _matchesSearch
   * override — file header "SEARCH" note) without accidentally matching
   * against the new English audit/metadata fields (createdAt, updatedAt,
   * deletedAt, version, syncVersion, checksum) that did not exist in the
   * record shape before this Repository layer.
   *
   * Derived from FIELDS.templates/MAP.templates (index.html) — العنوان,
   * النوع, القسم, الرابط, الوصف — plus:
   *   - 'id'            : the identifier itself (set by saveTemplate()
   *                       and already part of every real record).
   *   - 'تاريخ_الإنشاء' : creation timestamp stamped by saveTemplate().
   * Matches, in the same order, Code_v4.gs's dormant 'الصيغ' Sheet
   * headers: ['id','العنوان','النوع','القسم','الرابط','الوصف',
   * 'تاريخ_الإنشاء']. No other dynamically-added field exists for
   * Templates — confirmed by full read of js/modules/templates.js (218
   * lines total, no other field ever written).
   */
  var TEMPLATES_LEGACY_FIELDS = [
    'id', 'العنوان', 'النوع', 'القسم', 'الرابط', 'الوصف', 'تاريخ_الإنشاء'
  ];

  // ================================================================
  // 2. Storage Adapter — DatabaseService-backed (PHASE 8 / SUB-PHASE 8.5.2)
  // ================================================================
  // See file header "WIRING UPDATE" note (added by this phase). Reads/
  // writes the SAME 'templates' key index.html already uses today, in the
  // SAME flat JSON-array shape — LocalStorageAdapter's own default empty
  // keyPrefix guarantees this. Public factory NAME and SIGNATURE are
  // unchanged from the prior phase; only what it builds internally changed
  // (a real DatabaseService + LocalStorageAdapter pair instead of the old
  // hand-rolled ad-hoc {read,write} object).

  /**
   * Builds the Storage Adapter injected into TemplatesRepository's underlying
   * Repository base class: a real DatabaseService instance wrapping a real
   * LocalStorageAdapter instance. This satisfies Repository.js's duck-typed
   * contract ({read(entityKey), write(entityKey, records)}) because
   * DatabaseService exposes both methods, each delegating unchanged to the
   * LocalStorageAdapter beneath it — which in turn reads/writes the
   * browser's real localStorage (or an injected localStorage-shaped
   * stand-in) under the exact same key ('templates') the current global
   * `data.templates`/`saveLocal()` already use.
   * @param {Storage} [storageImpl] - optional localStorage-shaped override
   *   (e.g. a test harness's in-memory stand-in). When omitted,
   *   LocalStorageAdapter itself resolves the real global localStorage
   *   lazily, on first read()/write() call (not here, not at construction
   *   time), matching LocalStorageAdapter's own documented lazy-engine-
   *   resolution design.
   * @returns {DatabaseService}
   */
  function createTemplatesLocalStorageAdapter(storageImpl) {
    var adapter = new IndexedDBAdapter(storageImpl ? { engineOptions: { indexedDBImpl: storageImpl } } : {});
    return new DatabaseService(adapter);
  }

  // ================================================================
  // 3. Local uid()-equivalent generator (private to this file)
  // ================================================================
  // Repository.js deliberately does NOT define uid() itself (it lives in
  // js/ui-utils.js and must be injected — see Repository.js file header,
  // config.idGenerator doc). This file does not import js/ui-utils.js (no
  // dependency beyond js/core/Repository.js is permitted this phase), so
  // a byte-for-byte algorithmic replica of the actual uid() is defined
  // here, private to this module — a self-contained duplicate of the
  // same helper already defined independently in every prior Repository
  // file, per this phase's "depends only on Repository.js" instruction
  // (no cross-Repository imports).
  //
  // Verified identical algorithm to js/ui-utils.js:
  //   function uid(){return Date.now().toString(36)+Math.random().toString(36).slice(2,6);}

  function generateTemplateId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  }

  // ================================================================
  // 4. TemplatesRepository — subclass
  // ================================================================

  /**
   * @class TemplatesRepository
   * @param {{storageAdapter?: object, idGenerator?: function}} [config] -
   *   Optional overrides (e.g. for tests). Defaults to the
   *   localStorage-backed placeholder adapter and the local uid()-
   *   equivalent generator above.
   */
  function TemplatesRepository(config) {
    config = config || {};
    var storageAdapter = config.storageAdapter || createTemplatesLocalStorageAdapter();
    var idGenerator = typeof config.idGenerator === 'function' ? config.idGenerator : generateTemplateId;

    Repository.call(this, {
      entityKey: 'templates',
      storageAdapter: storageAdapter,
      idField: TEMPLATES_ID_FIELD,
      idGenerator: idGenerator,
      // No live free-text search exists to bound this to (file header
      // "SEARCH" note) — searchFields is set to the full legacy field
      // list so even a caller bypassing the _matchesSearch override
      // (e.g. via a future field-scoped query option) sees a sensible
      // default rather than an empty scope.
      searchFields: TEMPLATES_LEGACY_FIELDS,
      softDelete: true, // Data_Schema_Specification §4.9 Delete Rules: Soft Delete.
      unsupportedOperations: []
    });
  }

  TemplatesRepository.prototype = Object.create(Repository.prototype);
  TemplatesRepository.prototype.constructor = TemplatesRepository;

  // ----------------------------------------------------------------
  // 4.1 Identifier resolution — extension point (see file header
  //     "IDENTIFIER" note)
  // ----------------------------------------------------------------

  /**
   * _resolveId(record) — overrides the base class default. The base
   * class's default (when idField is set) is `return record[idField];`
   * with no generation fallback, correct for Cases (a true user-entered
   * natural key, always present by validation time). Templates'
   * identifier is a HYBRID id (Data_Schema §3.2): generated only when
   * absent, exactly replicating saveTemplate()'s
   * `obj['id'] = obj['id'] || uid();`. This override is the only
   * behavioral difference from the base class's natural-key resolution
   * path (same override *shape* as every prior Repository, applied here
   * to the literal field `id` rather than an Arabic key).
   * @param {Object} record
   * @returns {string}
   * @protected
   * @override
   */
  TemplatesRepository.prototype._resolveId = function (record) {
    var existing = record ? record[TEMPLATES_ID_FIELD] : null;
    return (existing != null && existing !== '') ? existing : this._idGenerator();
  };

  // ----------------------------------------------------------------
  // 4.2 Validation — Repository Contract §9 (extension point)
  // ----------------------------------------------------------------

  /**
   * _validate(operation, record) — overrides the base class no-op hook.
   * Enforces exactly the rule verified in ACTUAL saveTemplate() today:
   * two required fields — العنوان and القسم, BOTH checked WITH `.trim()`
   * (a symmetric pair — see file header "VALIDATION" note for the
   * deliberate resolution against Data_Schema_Specification §4.9's
   * single-field claim). Applies to create/update (delete does not
   * validate field content — Contract §9 default).
   * @protected
   * @override
   */
  TemplatesRepository.prototype._validate = function (operation, record) {
    if (operation !== 'create' && operation !== 'update') {
      return { valid: true, errors: [] };
    }
    var errors = [];
    var title = record ? record['العنوان'] : undefined;
    var titleEmpty = title == null || (typeof title === 'string' && title.trim() === '');
    if (titleEmpty) {
      errors.push({ field: 'العنوان', message: 'الحقل "العنوان" إلزامي ولا يمكن أن يكون فارغاً.' });
    }
    var category = record ? record['القسم'] : undefined;
    var categoryEmpty = category == null || (typeof category === 'string' && category.trim() === '');
    if (categoryEmpty) {
      errors.push({ field: 'القسم', message: 'الحقل "القسم" إلزامي ولا يمكن أن يكون فارغاً.' });
    }
    return { valid: errors.length === 0, errors: errors };
  };

  /**
   * validate(record) — PUBLIC convenience wrapper requested by this
   * phase's instructions. Thin pass-through to the protected _validate()
   * hook, defaulting to the 'create' operation shape. Does not replace or
   * rename any Contract operation.
   * @param {Object} record
   * @param {'create'|'update'} [operation='create']
   * @returns {{valid:boolean, errors:Array<{field:string,message:string}>}}
   */
  TemplatesRepository.prototype.validate = function (record, operation) {
    return this._validate(operation || 'create', record);
  };

  // ----------------------------------------------------------------
  // 4.3 Search — Repository Contract §7 (extension point)
  // ----------------------------------------------------------------

  /**
   * _matchesSearch(record, term) — overrides the base class's
   * searchFields-scoped substring scan with the same generic full-record
   * join pattern already established for every prior entity
   * (`Object.values(record).join(' ')`, scoped to
   * TEMPLATES_LEGACY_FIELDS to exclude new audit/metadata fields). Unlike
   * every prior override, this does NOT replicate any existing live
   * behavior — there is none to replicate (see file header "SEARCH"
   * note, and Templates_Repository_Report.md §2.4 for the full decision
   * record). This is a documented, deliberate ADDITIVE capability.
   * @protected
   * @override
   */
  TemplatesRepository.prototype._matchesSearch = function (record, term) {
    if (!term) return true;
    var needle = String(term).trim().toLowerCase();
    if (!needle) return true;
    var joined = TEMPLATES_LEGACY_FIELDS
      .map(function (field) { return record[field] != null ? record[field] : ''; })
      .join(' ')
      .toLowerCase();
    return joined.indexOf(needle) !== -1;
  };

  /**
   * filter(filterObj) — PUBLIC convenience wrapper requested by this
   * phase's instructions. Thin pass-through to search({filter: filterObj}),
   * returning just the matched records (not the full QueryResult
   * envelope). Generic and data-driven (no field hardcoded), so it
   * supports both the LIVE `{القسم: ...}` pattern and the documented but
   * unwired `{النوع: ...}` pattern — no entity-specific override needed,
   * same as every prior Repository's filter().
   * @param {Object} filterObj - Query Model filter object (Contract §7).
   * @returns {Object[]}
   */
  TemplatesRepository.prototype.filter = function (filterObj) {
    return this.search({ filter: filterObj }).items;
  };

  // ----------------------------------------------------------------
  // 4.4 Sort — Repository Contract §7 (extension point)
  // ----------------------------------------------------------------

  /**
   * sort(records, sortSpec) — PUBLIC convenience wrapper requested by
   * this phase's instructions. Applies the base class's generic
   * comparator engine (_compareRecords) to an explicit array of records,
   * defaulting sortSpec to TEMPLATES_SORT_FIELDS (`العنوان` ascending — a
   * purely additive capability, since the ACTUAL renderTemplates()
   * applies no sort at all; see file header "SORT" note) when omitted.
   * Does not mutate the input array or replace search()'s own sort
   * option — additive only.
   * @param {Object[]} [records] - defaults to this.getAll() when omitted.
   * @param {Array<{field:string, direction?:'asc'|'desc'}>|{field:string, direction?:'asc'|'desc'}} [sortSpec]
   * @returns {Object[]}
   */
  TemplatesRepository.prototype.sort = function (records, sortSpec) {
    var list = Array.isArray(records) ? records.slice() : this.getAll();
    var spec = sortSpec || TEMPLATES_SORT_FIELDS.map(function (f) { return { field: f, direction: 'asc' }; });
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
  TemplatesRepository.prototype.insert = function (entity) {
    return this.create(entity);
  };

  /**
   * remove(id) -> WriteResult
   * Alias for the inherited, Contract-literal delete(id).
   * @param {string} id
   * @returns {Promise<{success:boolean, record:?Object, error:?Object}>}
   */
  TemplatesRepository.prototype.remove = function (id) {
    return this.delete(id);
  };

  // ================================================================
  // 5. Exports
  // ================================================================

  var api = {
    TemplatesRepository: TemplatesRepository,
    createTemplatesLocalStorageAdapter: createTemplatesLocalStorageAdapter
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  if (root) {
    root.TemplatesRepository = TemplatesRepository;
    root.createTemplatesLocalStorageAdapter = createTemplatesLocalStorageAdapter;
  }

})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
