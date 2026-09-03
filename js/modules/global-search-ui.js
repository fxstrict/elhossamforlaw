/**
 * ================================================================
 * js/modules/global-search-ui.js — Search Workspace UI | نظام الحسام للمحاماة
 * ================================================================
 * PHASE 02 — GLOBAL SEARCH / SEARCH WORKSPACE — STEP 2/3/6 (UI)
 *
 * Wires the static #page-globalSearch markup (index.html) to the pure
 * GlobalSearchController / SearchHistoryStore / debounce logic in
 * js/modules/global-search.js. This file is DOM-only glue — it holds
 * no search/matching logic of its own (that would repeat PHASE 01's
 * exact "second search engine" mistake this whole feature exists to
 * avoid) and is not unit-tested in Node for the same reason none of
 * this app's other render*()/onClick handlers are (js/modules/cases.js,
 * dashboard.js, etc. also have zero DOM-level Node tests — only their
 * Repository layer is tested; the equivalent here,
 * GlobalSearchController/SearchHistoryStore/debounce, already is, in
 * js/tests/verify_global_search_core.js /
 * verify_global_search_history.js / verify_global_search_debounce.js).
 *
 * DOES NOT TOUCH (PHASE 02 §4/§33 absolute prohibitions):
 *   navigate(), #dashQuickSearchInput, #dashQuickSearchResults,
 *   performDashboardQuickSearch(), any Repository, any *.js under
 *   js/core/ or js/repositories/.
 *
 * RESULT NAVIGATION DECISION (PHASE 02 §30/§31 — investigated, not
 * assumed): every entity module's "view"/"edit" function
 * (viewCase(i), viewClient(i), viewOpponent(i), editSession(i),
 * editDocument(i), editTask(i), editChild(i), ...) takes a POSITIONAL
 * ARRAY INDEX into that module's own `data.<entity>` mirror array, not
 * a stable record id — confirmed by reading viewCase()/viewOpponent()
 * (`js/modules/cases.js:1242`: `var c = data.cases[i];`,
 * `js/modules/opponents.js:384`: `var o = data.opponents[i];`).
 * Calling one of these with an id from a Global Search result would
 * open whatever record happens to sit at that array position today —
 * silently wrong, not just non-functional. No entity exposes an
 * id-based "open this specific record" function. Per §31's explicit
 * instruction for exactly this situation ("إذا لا: ... استخدم
 * navigate(page) كـfallback آمن. وسجّل Entity الذي لا يدعم Deep
 * Navigation"), every result click below therefore calls the existing,
 * unmodified navigate(def.page) and nothing else — for ALL 12 entities,
 * not just some. This is recorded again in the PHASE 02 implementation
 * report's "Known Limitations" section.
 * ================================================================
 */
'use strict';

// Reuse the app's existing HTML-escaping helper (js/modules/cases.js,
// PHASE 13.17 XSS HARDENING) instead of writing a second one — falls
// back to a minimal inline escaper only if that file somehow is not
// loaded, so this file never throws for lack of it.
var _gsEsc = (typeof escapeHtml === 'function') ? escapeHtml : function (v) {
  if (v === null || v === undefined) return '';
  return String(v).replace(/[&<>"']/g, function (ch) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
  });
};

var _gsHistoryStore = (typeof SearchHistoryStore === 'function') ? new SearchHistoryStore() : null;
var _gsSequencer = (typeof createGlobalSearchRequestSequencer === 'function') ? createGlobalSearchRequestSequencer() : null;
var _gsCurrentScope = 'all';
var _gsLastRenderedResult = null; // last groupSearchResults() output actually shown, kept only for click lookups

/** All entity scope tabs, built once from the SAME defs the controller
 * itself uses — a scope tab can never exist for an entity type the
 * controller doesn't know about, or vice versa (PHASE 02 §16 spec). */
function _gsGetEntityDefs() {
  return (typeof GLOBAL_SEARCH_ENTITY_DEFS !== 'undefined' && GLOBAL_SEARCH_ENTITY_DEFS) || [];
}

function _gsGetController() {
  return (typeof window !== 'undefined' && window.globalSearchController) || null;
}

// ================================================================
// Scope tabs (STEP 2 §16/§17/§18)
// ================================================================

function renderGlobalSearchScopeTabs() {
  var container = document.getElementById('globalSearchScope');
  if (!container) return;
  var defs = _gsGetEntityDefs();
  var html = '<button type="button" class="global-search-scope-tab" role="tab" ' +
    'aria-selected="' + (_gsCurrentScope === 'all' ? 'true' : 'false') + '" ' +
    'onclick="setGlobalSearchScope(\'all\')">الكل</button>';
  defs.forEach(function (def) {
    html += '<button type="button" class="global-search-scope-tab" role="tab" ' +
      'aria-selected="' + (_gsCurrentScope === def.type ? 'true' : 'false') + '" ' +
      'onclick="setGlobalSearchScope(' + JSON.stringify(def.type) + ')">' +
      _gsEsc(def.labelAr) + '</button>';
  });
  container.innerHTML = html;
}

function setGlobalSearchScope(scopeType) {
  _gsCurrentScope = scopeType || 'all';
  renderGlobalSearchScopeTabs();
  var input = document.getElementById('globalSearchInput');
  runGlobalSearch(input ? input.value : '', { commit: false });
}

// ================================================================
// Input handling — debounce (STEP 5 §26/§27) applied ONLY here
// ================================================================

var _gsDebouncedSearch = (typeof globalSearchDebounce === 'function')
  ? globalSearchDebounce(function (term) { runGlobalSearch(term, { commit: false }); }, (typeof DEFAULT_DEBOUNCE_MS === 'number' ? DEFAULT_DEBOUNCE_MS : 250))
  : function (term) { runGlobalSearch(term, { commit: false }); }; // no debounce module loaded: degrade to immediate search rather than not searching at all

function onGlobalSearchInputChanged(value) {
  var clearBtn = document.getElementById('globalSearchClearBtn');
  if (clearBtn) clearBtn.style.display = value ? '' : 'none';

  if (!value || !value.trim()) {
    // Immediate, not debounced: clearing the box should feel instant.
    if (_gsDebouncedSearch.cancel) _gsDebouncedSearch.cancel();
    runGlobalSearch('', { commit: false });
    return;
  }
  _gsDebouncedSearch(value);
}

function onGlobalSearchInputKeydown(event) {
  if (!event || event.key !== 'Enter') return;
  event.preventDefault();
  var input = document.getElementById('globalSearchInput');
  var value = input ? input.value : '';
  if (_gsDebouncedSearch.cancel) _gsDebouncedSearch.cancel();
  runGlobalSearch(value, { commit: true }); // Enter = commit to Recent Searches immediately
}

function onGlobalSearchInputFocused() {
  renderRecentGlobalSearches();
}

function clearGlobalSearchInput() {
  var input = document.getElementById('globalSearchInput');
  if (input) input.value = '';
  var clearBtn = document.getElementById('globalSearchClearBtn');
  if (clearBtn) clearBtn.style.display = 'none';
  if (_gsDebouncedSearch.cancel) _gsDebouncedSearch.cancel();
  runGlobalSearch('', { commit: false });
  if (input) input.focus();
}

// ================================================================
// Recent Searches (STEP 4 §23/§24) — committed on Enter or on
// clicking a result (an actual "found it" moment), never on every
// debounced keystroke pause, so the list reflects completed searches
// rather than every partially-typed fragment. This is a deliberate
// product decision beyond the brief's stated minimum, documented here
// and in the PHASE 02 implementation report.
// ================================================================

function renderRecentGlobalSearches() {
  var panel = document.getElementById('globalSearchRecent');
  var list = document.getElementById('globalSearchRecentList');
  if (!panel || !list) return;

  var input = document.getElementById('globalSearchInput');
  var hasQuery = !!(input && input.value && input.value.trim());
  if (hasQuery || !_gsHistoryStore) { panel.style.display = 'none'; return; }

  var recent = _gsHistoryStore.getAll();
  if (!recent.length) { panel.style.display = 'none'; return; }

  panel.style.display = '';
  list.innerHTML = recent.map(function (term) {
    var safe = _gsEsc(term);
    return '<div class="global-search-recent-chip" onclick="applyRecentGlobalSearch(' + JSON.stringify(term) + ')">' +
      '<span class="global-search-recent-chip-label">' + safe + '</span>' +
      '<button type="button" class="global-search-recent-chip-remove" aria-label="حذف" ' +
      'onclick="removeRecentGlobalSearch(event, ' + JSON.stringify(term) + ')">&#10005;</button>' +
      '</div>';
  }).join('');
}

function applyRecentGlobalSearch(term) {
  var input = document.getElementById('globalSearchInput');
  if (input) { input.value = term; input.focus(); }
  var clearBtn = document.getElementById('globalSearchClearBtn');
  if (clearBtn) clearBtn.style.display = term ? '' : 'none';
  if (_gsDebouncedSearch.cancel) _gsDebouncedSearch.cancel();
  runGlobalSearch(term, { commit: true });
}

function removeRecentGlobalSearch(event, term) {
  if (event && event.stopPropagation) event.stopPropagation();
  if (_gsHistoryStore) _gsHistoryStore.remove(term);
  renderRecentGlobalSearches();
}

function clearRecentGlobalSearches() {
  if (_gsHistoryStore) _gsHistoryStore.clear();
  renderRecentGlobalSearches();
}

// ================================================================
// Search execution + rendering
// ================================================================

function _gsShowOnly(stateId) {
  ['globalSearchInitial', 'globalSearchEmpty', 'globalSearchResults'].forEach(function (id) {
    var el = document.getElementById(id);
    if (el) el.style.display = (id === stateId) ? '' : 'none';
  });
}

function runGlobalSearch(term, options) {
  var q = (term || '').trim();
  var errorBox = document.getElementById('globalSearchError');
  var countLine = document.getElementById('globalSearchTotalCount');
  if (errorBox) { errorBox.style.display = 'none'; errorBox.textContent = ''; }

  if (!q) {
    if (countLine) countLine.style.display = 'none';
    _gsShowOnly('globalSearchInitial');
    renderRecentGlobalSearches();
    return;
  }

  var token = _gsSequencer ? _gsSequencer.issue() : null;
  var controller = _gsGetController();
  var scopeOption = (_gsCurrentScope && _gsCurrentScope !== 'all') ? { entityTypes: [_gsCurrentScope] } : {};

  var result;
  if (controller) {
    result = controller.searchAll(q, scopeOption);
  } else {
    // Defensive: the core module failed to load for any reason. Never
    // crash the page — show a clear error instead (§29/§42).
    result = { term: q, groups: [], totalCount: 0, hasError: true, _controllerMissing: true };
  }

  if (_gsSequencer && !_gsSequencer.isCurrent(token)) return; // stale (see global-search.js §6)

  var grouped = (typeof groupSearchResults === 'function') ? groupSearchResults(result) : result;
  _gsLastRenderedResult = grouped;

  // Recent Searches is hidden once there's a query, regardless of outcome.
  var recentPanel = document.getElementById('globalSearchRecent');
  if (recentPanel) recentPanel.style.display = 'none';

  if (result._controllerMissing) {
    if (errorBox) {
      errorBox.textContent = 'تعذر تشغيل البحث الشامل حاليًا (لم يتم تحميل مكوّن البحث). جرّب تحديث الصفحة.';
      errorBox.style.display = '';
    }
    if (typeof toast === 'function') { try { toast('تعذر تشغيل البحث الشامل', 'error'); } catch (e) { /* toast is best-effort UI feedback; never let it block search rendering */ } }
    if (countLine) countLine.style.display = 'none';
    _gsShowOnly('globalSearchEmpty');
    return;
  }

  if (grouped.hasError) {
    var failedLabels = (result.groups || []).filter(function (g) { return g.error; })
      .map(function (g) { return g.label; }).join('، ');
    if (errorBox) {
      errorBox.textContent = 'تعذر البحث في: ' + failedLabels + '. النتائج المعروضة أدناه من باقي الأقسام فقط.';
      errorBox.style.display = '';
    }
  }

  if (options && options.commit && _gsHistoryStore) {
    _gsHistoryStore.add(q);
  }

  if (!grouped.totalCount) {
    var emptyText = document.getElementById('globalSearchEmptyText');
    if (emptyText) {
      emptyText.textContent = (_gsCurrentScope === 'all')
        ? 'لا توجد نتائج مطابقة في أي قسم.'
        : 'لا توجد نتائج مطابقة في هذا النطاق. جرّب "الكل" لتوسيع نطاق البحث.';
    }
    if (countLine) countLine.style.display = 'none';
    _gsShowOnly('globalSearchEmpty');
    return;
  }

  if (countLine) {
    countLine.style.display = '';
    countLine.textContent = 'إجمالي النتائج: ' + grouped.totalCount;
  }
  _gsShowOnly('globalSearchResults');
  renderGlobalSearchResultGroups(grouped);
}

function renderGlobalSearchResultGroups(grouped) {
  var container = document.getElementById('globalSearchResults');
  if (!container) return;

  container.innerHTML = grouped.groups.map(function (group) {
    var headerHtml = '<div class="global-search-group-header">' +
      '<span>' + _gsEsc(group.label) + '</span>' +
      '<span class="global-search-group-count">(' + group.total + ')</span>' +
      (group.error ? '<span class="global-search-group-error">تعذر البحث في هذا القسم</span>' : '') +
      '</div>';

    var itemsHtml = group.items.map(function (item) {
      var secondaryParts = [];
      if (item.secondaryLabel) secondaryParts.push(_gsEsc(item.secondaryLabel));
      if (item.date) secondaryParts.push(_gsEsc(item.date));
      var secondaryHtml = secondaryParts.length
        ? '<div class="global-search-result-secondary">' + secondaryParts.map(function (p) { return '<span>' + p + '</span>'; }).join('') + '</div>'
        : '';
      var statusHtml = item.status ? '<span class="global-search-result-status">' + _gsEsc(item.status) + '</span>' : '';

      return '<button type="button" class="global-search-result-item" ' +
        'data-page="' + _gsEsc(item.page) + '" data-type="' + _gsEsc(item.type) + '" data-entity-id="' + _gsEsc(item.entityId) + '">' +
        '<div class="global-search-result-main">' +
        '<span class="global-search-result-label">' + _gsEsc(item.label || '—') + '</span>' +
        statusHtml +
        '</div>' +
        secondaryHtml +
        '</button>';
    }).join('');

    return '<div class="global-search-group">' + headerHtml + '<div class="global-search-group-items">' + itemsHtml + '</div></div>';
  }).join('');
}

/** Single delegated click handler for #globalSearchResults (attribute
 * set directly on the container in index.html). See file header
 * "RESULT NAVIGATION DECISION" for why this always calls navigate(page)
 * and never a per-entity view/edit function. */
function handleGlobalSearchResultClick(event) {
  var target = event.target;
  while (target && target !== event.currentTarget && !target.classList.contains('global-search-result-item')) {
    target = target.parentElement;
  }
  if (!target || !target.classList || !target.classList.contains('global-search-result-item')) return;

  var page = target.getAttribute('data-page');
  if (!page) return;

  // A result was actually acted on — worth remembering as a completed
  // search (§23), same "commit" moment as pressing Enter.
  var input = document.getElementById('globalSearchInput');
  if (_gsHistoryStore && input && input.value && input.value.trim()) {
    _gsHistoryStore.add(input.value.trim());
  }

  navigate(page); // existing, unmodified navigate() — see file header.
}

// ================================================================
// Boot wiring
// ================================================================

document.addEventListener('DOMContentLoaded', function () {
  renderGlobalSearchScopeTabs();
  runGlobalSearch('', { commit: false }); // establishes the Initial State + Recent Searches on first load
});

// Refresh Recent Searches whenever the Shell reports the user actually
// navigated to this page — additive use of the EXISTING ShellEvents bus
// (js/core/shell/ShellEvents.js), not a new navigation mechanism, and
// navigate() itself is never touched to wire this up (PHASE 02 §14
// "لا تخترع Navigation Architecture جديدة"). Fully guarded: a no-op if
// ShellEvents hasn't loaded for any reason.
if (typeof window !== 'undefined' && window.ShellEvents && typeof window.ShellEvents.on === 'function') {
  window.ShellEvents.on('shell:afterNavigate', function (payload) {
    if (payload && payload.to === 'globalSearch') {
      var input = document.getElementById('globalSearchInput');
      if (!input || !input.value || !input.value.trim()) renderRecentGlobalSearches();
    }
  });
}
