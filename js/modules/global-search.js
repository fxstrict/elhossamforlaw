/**
 * ================================================================
 * js/modules/global-search.js — Global Search Core | نظام الحسام للمحاماة
 * ================================================================
 * PHASE 02 — GLOBAL SEARCH / SEARCH WORKSPACE — STEP 1 (CORE)
 *
 * WHAT THIS FILE IS
 *   A thin aggregation layer over the Repository.prototype.search() API
 *   that already exists, unmodified, on every entity Repository (see
 *   PHASE 01 forensic audit report, §03/§04). This file adds NO new
 *   filtering/matching logic of its own — every text match, every
 *   case-insensitive comparison, every searchable field is still decided
 *   entirely by js/core/Repository.js + each js/repositories/*.js file's
 *   own `searchFields` config, exactly as documented in the audit.
 *
 * WHAT THIS FILE IS NOT
 *   - It is NOT a second search engine. It never reads/filters
 *     data.cases / data.clients / ... arrays directly (PHASE 01 §06
 *     explicitly flagged that pattern, used by the OLD
 *     performDashboardQuickSearch(), as something not to repeat).
 *   - It NEVER touches js/core/Repository.js, js/repositories/*.js,
 *     Repository.prototype.search, _matchesSearch, or searchFields.
 *   - It does not replace or modify performDashboardQuickSearch()
 *     (js/modules/dashboard.js) — that function, #dashQuickSearchInput
 *     and #dashQuickSearchResults are untouched and keep working exactly
 *     as before (PHASE 02 brief §33, ARCHITECTURAL PROHIBITION).
 *
 * DEPENDENCY INJECTION (why GlobalSearchController takes a `repositories`
 * map instead of reaching for window.casesRepository etc. itself)
 *   Every real Repository instance in this app already lives on a
 *   predictable global once its owning module script has run (e.g.
 *   `window.casesRepository`, `window.opponentsRepository` — see
 *   js/modules/cases.js:382, js/modules/opponents.js:96, etc.). Rather
 *   than hard-coding those globals inside this file (which would make it
 *   impossible to unit-test in plain Node, exactly the gap PHASE 01 §07
 *   noted the project's own verify_*.js harnesses avoid by constructing
 *   Repository instances directly), GlobalSearchController accepts an
 *   explicit `{entityType: repositoryInstance, ...}` map. The browser
 *   wiring at the bottom of this file builds that map from the real
 *   window.*Repository globals; a Node test can instead build it from
 *   freshly-constructed Repository instances against a fake storage
 *   engine, exactly like js/tests/verify_opponents_repository.js does.
 *
 * ENTITY FIELD SOURCES (no invented fields — every field name below is
 * copied verbatim from the already-existing, already-audited
 * searchFields/legacy-field constants in js/repositories/*.js; see
 * PHASE 01 report §04/§09 for the full per-entity table this mirrors):
 *   Cases      -> CASES_SEARCH_FIELDS      (CasesRepository.js)
 *   Clients    -> CLIENTS_SEARCH_FIELDS    (ClientsRepository.js)
 *   Sessions   -> SESSIONS_LEGACY_FIELDS   (SessionsRepository.js)
 *   Documents  -> DOCUMENTS_LEGACY_FIELDS  (DocumentsRepository.js)
 *   Tasks      -> TASKS_LEGACY_FIELDS      (TasksRepository.js)
 *   Opponents  -> OPPONENTS_SEARCH_FIELDS  (OpponentsRepository.js)
 *   Children   -> CHILDREN_LEGACY_FIELDS   (ChildrenRepository.js)
 *   Fees       -> FEES_LEGACY_FIELDS       (FeesRepository.js)
 *   Library    -> LIBRARY_LEGACY_FIELDS    (LibraryRepository.js)
 *   Templates  -> TEMPLATES_LEGACY_FIELDS  (TemplatesRepository.js)
 *   Expenses   -> EXPENSES_SEARCH_FIELDS/EXPENSES_FILTER_FIELDS/
 *                 EXPENSES_SORT_FIELDS     (ExpensesRepository.js)
 *   ProcessServerWorks -> PSW_SEARCH_FIELDS/PSW_FILTER_FIELDS/
 *                 PSW_SORT_FIELDS          (ProcessServerWorksRepository.js)
 *
 * EMPTY-QUERY BEHAVIOR (deliberate product decision, documented here so
 * it isn't mistaken for a bug): a blank/whitespace-only term returns
 * zero items per entity WITHOUT calling repository.search() at all —
 * this matches the existing performDashboardQuickSearch() behavior
 * (dashboard.js:531-532: "if(!q){...return;}") of showing nothing until
 * the user actually types something, and avoids dumping every record of
 * every entity on workspace open.
 * ================================================================
 */
(function (root) {
  'use strict';

  var isNodeEnv = typeof module !== 'undefined' && module.exports;

  // ================================================================
  // 1. Entity Definitions — programmatic type ids (PHASE 02 §11: stable,
  //    non-Arabic identifiers for the UI to rely on) + how to read a
  //    display label/secondary line/status/date off each entity's own,
  //    already-existing field shape. `page` is the exact string
  //    navigate() already accepts for this entity today (index.html
  //    nav-items / PAGE_TITLES) — used for Result Navigation (§30).
  // ================================================================

  function readOrNull(record, field) {
    if (!record) return null;
    var v = record[field];
    return (v === undefined || v === null || v === '') ? null : v;
  }

  function joinNonEmpty(parts, sep) {
    var out = [];
    for (var i = 0; i < parts.length; i++) {
      if (parts[i] !== null && parts[i] !== undefined && parts[i] !== '') out.push(parts[i]);
    }
    return out.join(sep || ' — ');
  }

  var ENTITY_DEFS = [
    {
      type: 'case', labelAr: 'قضية', page: 'cases', idField: 'رقم_القضية', icon: '&#9878;',
      getLabel: function (r) { return joinNonEmpty([readOrNull(r, 'رقم_القضية'), readOrNull(r, 'عنوان_القضية')]); },
      getSecondary: function (r) { return readOrNull(r, 'اسم_الموكل'); },
      getStatus: function (r) { return readOrNull(r, 'الحالة'); },
      getDate: function (r) { return readOrNull(r, 'تاريخ_الإنشاء'); }
    },
    {
      type: 'client', labelAr: 'موكل', page: 'clients', idField: 'رقم_الموكل', icon: '&#128101;',
      getLabel: function (r) { return readOrNull(r, 'الاسم'); },
      getSecondary: function (r) { return readOrNull(r, 'الهاتف'); },
      getStatus: function () { return null; },
      getDate: function () { return null; }
    },
    {
      type: 'session', labelAr: 'جلسة', page: 'sessions', idField: 'رقم_الجلسة', icon: '&#128197;',
      getLabel: function (r) { return readOrNull(r, 'عنوان_القضية'); },
      getSecondary: function (r) { return readOrNull(r, 'المحكمة'); },
      getStatus: function (r) { return readOrNull(r, 'الحالة'); },
      getDate: function (r) { return readOrNull(r, 'التاريخ'); }
    },
    {
      type: 'document', labelAr: 'مستند', page: 'documents', idField: 'رقم_المستند', icon: '&#128206;',
      getLabel: function (r) { return readOrNull(r, 'اسم_المستند'); },
      getSecondary: function (r) { return readOrNull(r, 'رقم_القضية'); },
      getStatus: function () { return null; },
      getDate: function (r) { return readOrNull(r, 'تاريخ_الإيداع'); }
    },
    {
      type: 'task', labelAr: 'مهمة', page: 'tasks', idField: 'رقم_المهمة', icon: '&#9989;',
      getLabel: function (r) { return readOrNull(r, 'العنوان'); },
      getSecondary: function (r) { return joinNonEmpty([readOrNull(r, 'اسم_الموكل'), readOrNull(r, 'عنوان_القضية')]); },
      getStatus: function (r) { return readOrNull(r, 'الحالة'); },
      getDate: function (r) { return readOrNull(r, 'الموعد_النهائي'); }
    },
    {
      type: 'opponent', labelAr: 'خصم', page: 'opponents', idField: 'رقم_الخصم', icon: '&#129333;',
      getLabel: function (r) { return readOrNull(r, 'الاسم'); },
      getSecondary: function (r) { return readOrNull(r, 'الرقم_القومي'); },
      getStatus: function () { return null; },
      getDate: function () { return null; }
    },
    {
      type: 'child', labelAr: 'طفل', page: 'children', idField: 'رقم_الطفل', icon: '&#128118;',
      getLabel: function (r) { return readOrNull(r, 'الاسم'); },
      getSecondary: function (r) { return readOrNull(r, 'رقم_القضية'); },
      getStatus: function () { return null; },
      getDate: function (r) { return readOrNull(r, 'تاريخ_الميلاد'); }
    },
    {
      type: 'fee', labelAr: 'أتعاب', page: 'fees', idField: 'رقم_العملية', icon: '&#128176;',
      getLabel: function (r) { return joinNonEmpty([readOrNull(r, 'نوع_الأتعاب'), readOrNull(r, 'المبلغ')]); },
      getSecondary: function (r) { return readOrNull(r, 'اسم_الموكل'); },
      getStatus: function () { return null; },
      getDate: function (r) { return readOrNull(r, 'تاريخ_الاستلام'); }
    },
    {
      type: 'library', labelAr: 'المكتبة', page: 'library', idField: 'id', icon: '&#128218;',
      getLabel: function (r) { return readOrNull(r, 'العنوان'); },
      getSecondary: function (r) { return readOrNull(r, 'القسم'); },
      getStatus: function () { return null; },
      getDate: function (r) { return readOrNull(r, 'تاريخ_الإنشاء'); }
    },
    {
      type: 'template', labelAr: 'صيغة', page: 'templates', idField: 'id', icon: '&#128196;',
      getLabel: function (r) { return readOrNull(r, 'العنوان'); },
      getSecondary: function (r) { return readOrNull(r, 'القسم'); },
      getStatus: function () { return null; },
      getDate: function (r) { return readOrNull(r, 'تاريخ_الإنشاء'); }
    },
    {
      type: 'expense', labelAr: 'مصروف', page: 'expenses', idField: 'id', icon: '&#128181;',
      getLabel: function (r) { return joinNonEmpty([readOrNull(r, 'التصنيف'), readOrNull(r, 'المصدر')]); },
      getSecondary: function (r) { return readOrNull(r, 'المصدر'); },
      getStatus: function (r) { return readOrNull(r, 'الحالة'); },
      getDate: function (r) { return readOrNull(r, 'التاريخ'); }
    },
    {
      type: 'processServerWork', labelAr: 'عمل محضرين', page: 'processServerWorks', idField: 'رقم_العمل', icon: '&#128220;',
      getLabel: function (r) { return joinNonEmpty([readOrNull(r, 'طبيعة_الاعلان'), readOrNull(r, 'رقم_المحضرين')]); },
      getSecondary: function (r) { return readOrNull(r, 'المحكمة'); },
      getStatus: function (r) { return readOrNull(r, 'الحالة'); },
      getDate: function (r) { return readOrNull(r, 'تاريخ_الإنشاء'); }
    }
  ];

  var ENTITY_DEF_BY_TYPE = {};
  ENTITY_DEFS.forEach(function (d) { ENTITY_DEF_BY_TYPE[d.type] = d; });

  function getEntityDef(type) { return ENTITY_DEF_BY_TYPE[type] || null; }

  function safeStr(v) { return v === null || v === undefined ? '' : String(v); }

  function logError(context, err) {
    if (typeof console !== 'undefined' && console.error) {
      console.error('[GlobalSearchController] ' + context + ':', err);
    }
  }

  // ================================================================
  // 2. Result Normalization — PHASE 02 §10/§22. Minimum shape:
  //    {type, entityId, label, meta}. Optional fields (page,
  //    secondaryLabel, status, date) are included as `null` when the
  //    entity genuinely has no such field, rather than omitted — an
  //    explicit null is honest about "not applicable", never invented.
  // ================================================================

  function normalizeRecord(def, record) {
    return {
      type: def.type,
      entityId: readOrNull(record, def.idField),
      label: def.getLabel(record) || '',
      secondaryLabel: def.getSecondary ? def.getSecondary(record) : null,
      status: def.getStatus ? def.getStatus(record) : null,
      date: def.getDate ? def.getDate(record) : null,
      page: def.page,
      meta: { entityLabelAr: def.labelAr, entityIcon: def.icon }
    };
  }

  // ================================================================
  // 3. GlobalSearchController
  // ================================================================

  var DEFAULT_RESULT_LIMIT_PER_ENTITY = 20;

  /**
   * @param {Object} repositories map of entityType -> Repository instance
   *        (only entities present in this map are ever searched; an
   *        entity type missing from the map is treated as "not wired in
   *        this build", not as an error — see searchEntity() below).
   * @param {Object} [options]
   * @param {number} [options.resultLimitPerEntity] default 20
   */
  function GlobalSearchController(repositories, options) {
    this._repositories = repositories || {};
    this._resultLimitPerEntity = (options && typeof options.resultLimitPerEntity === 'number')
      ? options.resultLimitPerEntity
      : DEFAULT_RESULT_LIMIT_PER_ENTITY;
  }

  GlobalSearchController.DEFAULT_RESULT_LIMIT_PER_ENTITY = DEFAULT_RESULT_LIMIT_PER_ENTITY;
  GlobalSearchController.ENTITY_TYPES = ENTITY_DEFS.map(function (d) { return d.type; });

  /** Entity types this instance can actually search (i.e. were injected). */
  GlobalSearchController.prototype.getSupportedEntityTypes = function () {
    var repos = this._repositories;
    return ENTITY_DEFS.filter(function (d) { return !!repos[d.type]; }).map(function (d) { return d.type; });
  };

  GlobalSearchController.prototype.getEntityLabel = function (entityType) {
    var def = getEntityDef(entityType);
    return def ? def.labelAr : entityType;
  };

  /**
   * searchEntity(entityType, term, options) -> {type,label,items,total,error}
   * Never throws — any Repository.search() failure (including "not
   * ready") is caught and returned as `error`, so one broken entity
   * can never take down searchAll() (PHASE 02 §29 Error State / §42
   * Error Handling: no silent catch(e){} — every failure is logged via
   * console.error and surfaced in the returned `error` field).
   */
  GlobalSearchController.prototype.searchEntity = function (entityType, term, options) {
    var def = getEntityDef(entityType);
    if (!def) {
      return { type: entityType, label: entityType, items: [], total: 0, error: { message: 'Unknown entity type: ' + entityType } };
    }

    var repo = this._repositories[entityType];
    if (!repo) {
      // Not an error: this entity's Repository simply was not injected
      // into this GlobalSearchController instance (e.g. not loaded in
      // this build/page). Zero results, no error — distinguishes "not
      // wired" from "wired but failing".
      return { type: def.type, label: def.labelAr, icon: def.icon, items: [], total: 0, error: null };
    }

    var q = safeStr(term).trim();
    if (!q) {
      // Deliberate: blank query = no results, no Repository call. See
      // file header "EMPTY-QUERY BEHAVIOR".
      return { type: def.type, label: def.labelAr, icon: def.icon, items: [], total: 0, error: null };
    }

    if (typeof repo.isReady === 'function' && !repo.isReady()) {
      var notReadyErr = { message: 'Repository not ready: ' + entityType };
      logError('searchEntity(' + entityType + ') — repository not ready', notReadyErr.message);
      return { type: def.type, label: def.labelAr, icon: def.icon, items: [], total: 0, error: notReadyErr };
    }

    var limit = (options && typeof options.limit === 'number') ? options.limit : this._resultLimitPerEntity;

    try {
      var result = repo.search({ search: q, limit: limit });
      var items = (result && result.items ? result.items : []).map(function (r) { return normalizeRecord(def, r); });
      var total = (result && typeof result.total === 'number') ? result.total : items.length;
      return { type: def.type, label: def.labelAr, icon: def.icon, items: items, total: total, error: null };
    } catch (err) {
      logError('searchEntity(' + entityType + ') — repository.search() threw', err);
      return { type: def.type, label: def.labelAr, icon: def.icon, items: [], total: 0, error: { message: err && err.message ? err.message : String(err) } };
    }
  };

  /**
   * searchAll(term, options) -> {term, groups[], totalCount, hasError}
   * `options.entityTypes` restricts the search to a subset (used by
   * Search Scope — PHASE 02 §16/§18: choosing a single scope tab calls
   * this with entityTypes:[thatOneType], so "الكل" and a specific scope
   * both go through the exact same method, per §17's explicit
   * requirement not to call a different search function per UI state).
   */
  GlobalSearchController.prototype.searchAll = function (term, options) {
    var self = this;
    var types = (options && Array.isArray(options.entityTypes) && options.entityTypes.length)
      ? options.entityTypes
      : this.getSupportedEntityTypes();

    var groups = types.map(function (t) { return self.searchEntity(t, term, options); });
    var totalCount = groups.reduce(function (sum, g) { return sum + (g.total || 0); }, 0);
    var hasError = groups.some(function (g) { return !!g.error; });

    return { term: safeStr(term).trim(), groups: groups, totalCount: totalCount, hasError: hasError };
  };

  // ================================================================
  // 4. SearchResultGrouper — STEP 3 (PHASE 02 §20). searchAll() already
  //    returns per-entity groups (that IS the grouping — Repository
  //    boundaries are natural group boundaries), so this is a small
  //    presentation-shaping helper, not a second aggregation pass: it
  //    just drops empty groups and exposes a flat list alongside the
  //    grouped one for callers that want both.
  // ================================================================

  function groupSearchResults(searchAllResult) {
    var nonEmptyGroups = (searchAllResult.groups || []).filter(function (g) { return g.items.length > 0 || g.error; });
    var flatItems = [];
    nonEmptyGroups.forEach(function (g) { flatItems = flatItems.concat(g.items); });
    return {
      term: searchAllResult.term,
      groups: nonEmptyGroups,
      flatItems: flatItems,
      totalCount: searchAllResult.totalCount,
      hasError: searchAllResult.hasError
    };
  }

  // ================================================================
  // 5. SearchHistoryStore — STEP 4 (PHASE 02 §23/§24/§25). Brand-new,
  //    standalone feature; does NOT touch HistoryPanel.js/UndoManager.js
  //    (those are the Undo/Redo data-change audit trail — a different
  //    concept, per PHASE 01 §09's explicit finding that conflating the
  //    two would be a conceptual mistake).
  //
  //    STORAGE CHOICE (documented per §25's requirement): plain
  //    localStorage, same mechanism the app already uses today for
  //    comparable small, non-critical, per-browser UI/config values
  //    (apiUrl, driveUrl, userName, lastSyncAt — all read via
  //    localStorage.getItem in index.html's own top-level script, e.g.
  //    index.html:2497-2498). Recent Searches is exactly that class of
  //    data: small, local-only, safe to lose. No IndexedDB schema
  //    change, no new Repository, no Database architecture touched.
  // ================================================================

  var RECENT_SEARCHES_STORAGE_KEY = 'globalSearchRecentQueries';
  var MAX_RECENT_SEARCHES = 10;

  function safeGetLocalStorage() {
    try {
      if (typeof localStorage !== 'undefined') return localStorage;
    } catch (e) { /* localStorage can throw in some locked-down contexts — treat as unavailable */ }
    return null;
  }

  /**
   * @param {Object} [storageImpl] injectable storage (getItem/setItem),
   *        defaults to the real browser localStorage. Tests inject a
   *        plain in-memory fake object (same pattern as
   *        js/tests/verify_localstorage_adapter.js already uses).
   */
  function SearchHistoryStore(storageImpl) {
    this._storage = storageImpl || null;
  }

  SearchHistoryStore.MAX_RECENT_SEARCHES = MAX_RECENT_SEARCHES;
  SearchHistoryStore.STORAGE_KEY = RECENT_SEARCHES_STORAGE_KEY;

  SearchHistoryStore.prototype._store = function () {
    return this._storage || safeGetLocalStorage();
  };

  SearchHistoryStore.prototype.getAll = function () {
    var ls = this._store();
    if (!ls) return [];
    try {
      var raw = ls.getItem(RECENT_SEARCHES_STORAGE_KEY);
      var parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch (err) {
      logError('SearchHistoryStore.getAll — corrupt/unreadable storage, treating as empty', err);
      return [];
    }
  };

  SearchHistoryStore.prototype._persist = function (list) {
    var ls = this._store();
    if (!ls) return false;
    try {
      ls.setItem(RECENT_SEARCHES_STORAGE_KEY, JSON.stringify(list));
      return true;
    } catch (err) {
      logError('SearchHistoryStore._persist — failed to write recent searches', err);
      return false;
    }
  };

  /**
   * add(term) -> string[] (the new list, most recent first).
   * De-duplicates the term anywhere in the list (case-insensitive), not
   * just immediately-consecutive repeats, so a 10-slot list never shows
   * the same query twice — a strict superset of the brief's stated
   * minimum ("منع duplicate entries المتتالية"). Re-searching an
   * existing term simply moves it back to the top.
   */
  SearchHistoryStore.prototype.add = function (term) {
    var t = safeStr(term).trim();
    if (!t) return this.getAll();
    var existing = this.getAll();
    var deduped = existing.filter(function (item) { return safeStr(item).toLowerCase() !== t.toLowerCase(); });
    deduped.unshift(t);
    if (deduped.length > MAX_RECENT_SEARCHES) deduped = deduped.slice(0, MAX_RECENT_SEARCHES);
    this._persist(deduped);
    return deduped;
  };

  /** remove(term) -> string[] — deletes one exact entry (Clear-one-item option, §24). */
  SearchHistoryStore.prototype.remove = function (term) {
    var t = safeStr(term);
    var list = this.getAll().filter(function (item) { return item !== t; });
    this._persist(list);
    return list;
  };

  /** clear() -> [] — Clear Recent Searches. */
  SearchHistoryStore.prototype.clear = function () {
    this._persist([]);
    return [];
  };

  // ================================================================
  // 6. Debounce + stale-result (request sequence) protection —
  //    STEP 5 (PHASE 02 §26/§27/§28). Pure, dependency-free utilities so
  //    they're independently testable in Node, same as everything else
  //    in this file. Applied ONLY to the new #globalSearchInput by the
  //    UI layer (js/modules/global-search-ui.js) — the old
  //    #dashQuickSearchInput and every per-page entity search box keep
  //    their existing un-debounced oninput behavior untouched.
  // ================================================================

  var DEFAULT_DEBOUNCE_MS = 250;

  /**
   * debounce(fn, waitMs) -> debounced function with a .cancel() method.
   * Standard trailing-edge debounce: each call resets the pending timer,
   * so a burst of keystrokes ("م","مح","محم","محمد") collapses into
   * exactly one call to fn, `waitMs` after the last keystroke.
   */
  function debounce(fn, waitMs) {
    var wait = typeof waitMs === 'number' ? waitMs : DEFAULT_DEBOUNCE_MS;
    var timer = null;
    function debounced() {
      var ctx = this, args = arguments;
      if (timer) clearTimeout(timer);
      timer = setTimeout(function () {
        timer = null;
        fn.apply(ctx, args);
      }, wait);
    }
    debounced.cancel = function () {
      if (timer) { clearTimeout(timer); timer = null; }
    };
    return debounced;
  }

  /**
   * createRequestSequencer() -> {issue(), isCurrent(token)}
   * Belt-and-suspenders stale-result guard (§28). GlobalSearchController
   * itself is fully synchronous today (Repository.search() never
   * returns a Promise — PHASE 01 §07/§08), so within a single
   * searchAll() call there is no real race to protect against; this
   * exists so the UI layer has an explicit, testable place to ignore an
   * out-of-order result if a future Repository implementation ever
   * becomes asynchronous, without needing AbortController (deliberately
   * not used — §28 explicitly says not to add it unless actually
   * needed, and nothing here performs a cancellable network/IO call).
   */
  function createRequestSequencer() {
    var current = 0;
    return {
      issue: function () { current += 1; return current; },
      isCurrent: function (token) { return token === current; }
    };
  }

  // ================================================================
  // 7. Browser wiring — build the real repositories map from the
  //    global Repository instances every entity module already exposes
  //    (see file header "DEPENDENCY INJECTION"). Purely additive: does
  //    not touch any of those globals, only reads them.
  // ================================================================

  function buildRepositoriesMapFromGlobals(globalObj) {
    var g = globalObj || {};
    var map = {};
    if (g.casesRepository) map.case = g.casesRepository;
    if (g.clientsRepository) map.client = g.clientsRepository;
    if (g.sessionsRepository) map.session = g.sessionsRepository;
    if (g.documentsRepository) map.document = g.documentsRepository;
    if (g.tasksRepository) map.task = g.tasksRepository;
    if (g.opponentsRepository) map.opponent = g.opponentsRepository;
    if (g.childrenRepository) map.child = g.childrenRepository;
    if (g.feesRepository) map.fee = g.feesRepository;
    if (g.libraryRepository) map.library = g.libraryRepository;
    if (g.templatesRepository) map.template = g.templatesRepository;
    if (g.expensesRepository) map.expense = g.expensesRepository;
    if (g.processServerWorksRepository) map.processServerWork = g.processServerWorksRepository;
    return map;
  }

  // ================================================================
  // 8. Exports
  // ================================================================

  var api = {
    GlobalSearchController: GlobalSearchController,
    GLOBAL_SEARCH_ENTITY_DEFS: ENTITY_DEFS,
    groupSearchResults: groupSearchResults,
    SearchHistoryStore: SearchHistoryStore,
    buildRepositoriesMapFromGlobals: buildRepositoriesMapFromGlobals,
    debounce: debounce,
    DEFAULT_DEBOUNCE_MS: DEFAULT_DEBOUNCE_MS,
    createRequestSequencer: createRequestSequencer
  };

  if (isNodeEnv) {
    module.exports = api;
  }
  if (root) {
    root.GlobalSearchController = GlobalSearchController;
    root.GLOBAL_SEARCH_ENTITY_DEFS = ENTITY_DEFS;
    root.groupSearchResults = groupSearchResults;
    root.SearchHistoryStore = SearchHistoryStore;
    root.globalSearchDebounce = debounce;
    root.createGlobalSearchRequestSequencer = createRequestSequencer;

    // Only auto-instantiate the live, browser-wired singleton when running
    // in an actual browser page (not when this file is require()'d by a
    // Node test harness, where the caller builds its own instance against
    // fake/injected repositories instead).
    if (typeof window !== 'undefined' && root === window) {
      root.globalSearchController = new GlobalSearchController(buildRepositoriesMapFromGlobals(root));
    }
  }

})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
