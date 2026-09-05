/**
 * ================================================================
 * js/modules/global-search-ui.js — Search Workspace UI | نظام الحسام للمحاماة
 * ================================================================
 * PHASE 02 — GLOBAL SEARCH / SEARCH WORKSPACE — STEP 2/3/6 (UI)
 * PHASE 02.2 — BUG FIX PASS (this revision)
 *
 * ----------------------------------------------------------------
 * BUG FIXED IN THIS REVISION — read this before touching this file
 * ----------------------------------------------------------------
 * The previous revision built every dynamic button (scope tabs, Recent
 * Search chips, their remove buttons) by string-concatenating HTML and
 * embedding `JSON.stringify(value)` INSIDE a double-quoted `onclick="..."`
 * attribute, e.g.:
 *
 *     'onclick="setGlobalSearchScope(' + JSON.stringify(def.type) + ')">'
 *
 * `JSON.stringify('client')` returns the 8-character string `"client"`
 * (WITH literal double quotes). Concatenated into an already
 * double-quoted attribute, the browser's HTML tokenizer (WHATWG
 * "attribute value (double-quoted) state") ends the attribute at the
 * FIRST of those quotes:
 *
 *     onclick="setGlobalSearchScope("client")">
 *              \_______________________/ <- this is literally the whole
 *                                           onclick value the browser
 *                                           keeps: `setGlobalSearchScope(`
 *
 * That's invalid JavaScript, so the browser drops the handler silently.
 * Confirmed independently with a standards-conformant HTML tokenizer
 * (Python's html.parser, which follows the same quoted-attribute-value
 * state as the WHATWG spec) — it parses the attribute as exactly
 * `setGlobalSearchScope(` and then a bogus bareword attribute for the
 * leftover `client")"` text. This affected EVERY entity scope tab (not
 * just Sessions/Clients — all 12; "الكل" was the only one that ever
 * worked because it used a hardcoded 'all' string with no
 * JSON.stringify() involved) AND both Recent Search chip actions
 * (applyRecentGlobalSearch / removeRecentGlobalSearch). Net effect:
 * clicking any scope tab other than "الكل", or any Recent Search chip,
 * did nothing — the workspace silently stayed on whatever scope/state it
 * was already in, which is exactly the "nothing changes when I switch
 * between Sessions and Clients" symptom that was reported.
 *
 * THE FIX: this file no longer builds ANY markup via string-concatenated
 * HTML with embedded dynamic values. Every dynamic element (scope tabs,
 * recent chips, result rows) is built with `document.createElement` +
 * `textContent` + `addEventListener` — there is no attribute-quoting
 * step left to get wrong, for any current or future value (including
 * one that might itself contain a `"` or `'`, which the old approach
 * would have mishandled even without the JSON.stringify bug). The only
 * places `innerHTML` is still used are for the small set of ICON glyphs
 * (plain literal Unicode characters now — see js/modules/global-search.js
 * PHASE 02.2 — no longer `&#NNNN;` HTML-entity strings, precisely so
 * they never need `innerHTML` either; kept as an innerHTML assignment
 * only as an extra no-op-safe path for a stray legacy `&...;` value).
 * A regression test for exactly this bug class lives in
 * js/tests/verify_global_search_ui_dom.js (fake-DOM harness).
 *
 * Everything else in this revision is UNCHANGED behavior from the prior
 * one — same commit-on-Enter/click-result Recent Searches timing, same
 * per-entity error messages, same icons/chevron/pill visual layout, same
 * ShellEvents wiring, same absolute prohibitions below.
 * ----------------------------------------------------------------
 *
 * Wires the static #page-globalSearch markup (index.html) to the pure
 * GlobalSearchController / SearchHistoryStore / debounce logic in
 * js/modules/global-search.js. This file is DOM-only glue — it holds no
 * search/matching logic of its own.
 *
 * DOES NOT TOUCH (PHASE 02 §4/§33 absolute prohibitions):
 *   navigate(), #dashQuickSearchInput, #dashQuickSearchResults,
 *   performDashboardQuickSearch(), any Repository, any *.js under
 *   js/core/ or js/repositories/.
 *
 * RESULT NAVIGATION DECISION (PHASE 02 §30/§31 — investigated, not
 * assumed, unchanged from prior revision): every entity module's
 * "view"/"edit" function (viewCase(i), viewOpponent(i), ...) takes a
 * POSITIONAL ARRAY INDEX into that module's own `data.<entity>` mirror
 * array, not a stable record id (`js/modules/cases.js`: `data.cases[i]`,
 * `js/modules/opponents.js`: `data.opponents[i]`). No entity exposes an
 * id-based "open this specific record" function, so every result click
 * calls the existing, unmodified `navigate(def.page)` and nothing else,
 * for all 12 entities — the explicit, endorsed §31 fallback.
 *
 * This file is exported for Node (module.exports) purely so
 * verify_global_search_ui_dom.js can require() it against a fake DOM —
 * it still auto-wires itself against the real `document`/`window` when
 * one is present, exactly like the rest of this app's module files.
 * ================================================================
 */
(function (root) {
  'use strict';

  var doc = (typeof document !== 'undefined') ? document : (root && root.document);
  var win = root || (typeof window !== 'undefined' ? window : null);

  if (!doc) {
    // No DOM at all (e.g. required from Node without a fake one being
    // set on `root.document` first) — export the functions below for
    // introspection/testing and stop; nothing else in this file can run.
  }

  // Reuse the app's existing HTML-escaping helper where it's still
  // needed (icon innerHTML fallback only — see file header). Falls back
  // to a minimal inline escaper if that file isn't loaded.
  var _gsEsc = (typeof escapeHtml === 'function') ? escapeHtml : function (v) {
    if (v === null || v === undefined) return '';
    return String(v).replace(/[&<>"']/g, function (ch) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
    });
  };

  var _gsHistoryStore = (win && typeof win.SearchHistoryStore === 'function') ? new win.SearchHistoryStore()
    : (typeof SearchHistoryStore === 'function' ? new SearchHistoryStore() : null);
  var _gsSequencer = (win && typeof win.createGlobalSearchRequestSequencer === 'function') ? win.createGlobalSearchRequestSequencer()
    : (typeof createGlobalSearchRequestSequencer === 'function' ? createGlobalSearchRequestSequencer() : null);
  var _gsCurrentScope = 'all';
  var _gsLastRenderedResult = null;

  function _gsGetEntityDefs() {
    if (win && win.GLOBAL_SEARCH_ENTITY_DEFS) return win.GLOBAL_SEARCH_ENTITY_DEFS;
    return (typeof GLOBAL_SEARCH_ENTITY_DEFS !== 'undefined' && GLOBAL_SEARCH_ENTITY_DEFS) || [];
  }

  function _gsGetController() {
    return (win && win.globalSearchController) || null;
  }

  function _gsGroupSearchResults(result) {
    if (win && typeof win.groupSearchResults === 'function') return win.groupSearchResults(result);
    if (typeof groupSearchResults === 'function') return groupSearchResults(result);
    return result;
  }

  function _gsDebounceFn() {
    return (win && typeof win.globalSearchDebounce === 'function') ? win.globalSearchDebounce
      : (typeof globalSearchDebounce === 'function' ? globalSearchDebounce : null);
  }

  function _gsDefaultDebounceMs() {
    if (win && typeof win.DEFAULT_DEBOUNCE_MS === 'number') return win.DEFAULT_DEBOUNCE_MS;
    if (typeof DEFAULT_DEBOUNCE_MS === 'number') return DEFAULT_DEBOUNCE_MS;
    return 250;
  }

  // ---------------------------------------------------------------
  // DOM builder helpers — the actual fix. Every dynamic value below
  // goes through textContent (Element.textContent never re-parses its
  // input as markup) or addEventListener (a real function reference,
  // never a string to be re-parsed as JS). No attribute-quoting step
  // exists for any of this, so no value — however it's escaped or not
  // — can corrupt the surrounding markup or silently drop a handler.
  // ---------------------------------------------------------------

  function _el(tag, className) {
    var node = doc.createElement(tag);
    if (className) node.className = className;
    return node;
  }

  function _text(node, str) {
    node.textContent = (str === null || str === undefined) ? '' : String(str);
    return node;
  }

  /** Icon glyphs are a fixed, internal, non-user-controlled set of plain
   * Unicode characters (see js/modules/global-search.js PHASE 02.2) —
   * textContent is enough and is used first; innerHTML is only a
   * defensive fallback for a stray legacy `&#NNNN;` entity string, and
   * even then only ever with the app's own escapeHtml()-safe values,
   * never anything derived from a search result/record. */
  function _icon(glyph) {
    var span = _el('span', 'global-search-scope-icon');
    if (glyph && /&#/.test(glyph)) {
      span.innerHTML = glyph; // trusted, fixed internal config value only
    } else {
      span.textContent = glyph || '';
    }
    return span;
  }

  // ================================================================
  // Scope tabs (STEP 2 §16/§17/§18)
  // ================================================================

  function renderGlobalSearchScopeTabs() {
    var container = doc.getElementById('globalSearchScope');
    if (!container) return;
    container.innerHTML = '';

    var allBtn = _el('button', 'global-search-scope-tab');
    allBtn.type = 'button';
    allBtn.setAttribute('role', 'tab');
    allBtn.setAttribute('aria-selected', _gsCurrentScope === 'all' ? 'true' : 'false');
    allBtn.appendChild(_icon('📋'));
    allBtn.appendChild(doc.createTextNode('الكل'));
    allBtn.addEventListener('click', function () { setGlobalSearchScope('all'); });
    container.appendChild(allBtn);

    _gsGetEntityDefs().forEach(function (def) {
      var btn = _el('button', 'global-search-scope-tab');
      btn.type = 'button';
      btn.setAttribute('role', 'tab');
      btn.setAttribute('aria-selected', _gsCurrentScope === def.type ? 'true' : 'false');
      btn.appendChild(_icon(def.icon));
      btn.appendChild(doc.createTextNode(def.labelAr));
      // Real closure over `def.type` — nothing to quote, nothing to
      // corrupt. This is the actual fix for the bug described above.
      btn.addEventListener('click', function () { setGlobalSearchScope(def.type); });
      container.appendChild(btn);
    });
  }

  function setGlobalSearchScope(scopeType) {
    _gsCurrentScope = scopeType || 'all';
    renderGlobalSearchScopeTabs();
    var input = doc.getElementById('globalSearchInput');
    runGlobalSearch(input ? input.value : '', { commit: false });
  }

  // ================================================================
  // Input handling — debounce (STEP 5 §26/§27) applied ONLY here
  // ================================================================

  var _gsDebounceImpl = _gsDebounceFn();
  var _gsDebouncedSearch = _gsDebounceImpl
    ? _gsDebounceImpl(function (term) { runGlobalSearch(term, { commit: false }); }, _gsDefaultDebounceMs())
    : function (term) { runGlobalSearch(term, { commit: false }); };

  function onGlobalSearchInputChanged(value) {
    var clearBtn = doc.getElementById('globalSearchClearBtn');
    if (clearBtn) clearBtn.style.display = value ? '' : 'none';

    if (!value || !value.trim()) {
      if (_gsDebouncedSearch.cancel) _gsDebouncedSearch.cancel();
      runGlobalSearch('', { commit: false });
      return;
    }
    _gsDebouncedSearch(value);
  }

  function onGlobalSearchInputKeydown(event) {
    if (!event || event.key !== 'Enter') return;
    event.preventDefault();
    var input = doc.getElementById('globalSearchInput');
    var value = input ? input.value : '';
    if (_gsDebouncedSearch.cancel) _gsDebouncedSearch.cancel();
    runGlobalSearch(value, { commit: true }); // Enter = commit to Recent Searches immediately
  }

  function onGlobalSearchInputFocused() {
    renderRecentGlobalSearches();
  }

  function clearGlobalSearchInput() {
    var input = doc.getElementById('globalSearchInput');
    if (input) input.value = '';
    var clearBtn = doc.getElementById('globalSearchClearBtn');
    if (clearBtn) clearBtn.style.display = 'none';
    if (_gsDebouncedSearch.cancel) _gsDebouncedSearch.cancel();
    runGlobalSearch('', { commit: false });
    if (input) input.focus();
  }

  // ================================================================
  // Recent Searches (STEP 4 §23/§24) — committed on Enter or on
  // clicking a result, never on every debounced keystroke pause.
  // ================================================================

  function renderRecentGlobalSearches() {
    var panel = doc.getElementById('globalSearchRecent');
    var list = doc.getElementById('globalSearchRecentList');
    if (!panel || !list) return;

    var input = doc.getElementById('globalSearchInput');
    var hasQuery = !!(input && input.value && input.value.trim());
    if (hasQuery || !_gsHistoryStore) { panel.style.display = 'none'; return; }

    var recent = _gsHistoryStore.getAll();
    if (!recent.length) { panel.style.display = 'none'; return; }

    panel.style.display = '';
    list.innerHTML = '';

    recent.forEach(function (term) {
      var chip = _el('div', 'global-search-recent-chip');

      var label = _el('span', 'global-search-recent-chip-label');
      _text(label, term);
      chip.appendChild(label);

      var removeBtn = _el('button', 'global-search-recent-chip-remove');
      removeBtn.type = 'button';
      removeBtn.setAttribute('aria-label', 'حذف');
      _text(removeBtn, '✕');
      removeBtn.addEventListener('click', function (event) {
        removeRecentGlobalSearch(event, term); // real closure — no re-parsed string
      });
      chip.appendChild(removeBtn);

      chip.addEventListener('click', function () { applyRecentGlobalSearch(term); });
      list.appendChild(chip);
    });
  }

  function applyRecentGlobalSearch(term) {
    var input = doc.getElementById('globalSearchInput');
    if (input) { input.value = term; input.focus(); }
    var clearBtn = doc.getElementById('globalSearchClearBtn');
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
      var el = doc.getElementById(id);
      if (el) el.style.display = (id === stateId) ? '' : 'none';
    });
  }

  function runGlobalSearch(term, options) {
    var q = (term || '').trim();
    var errorBox = doc.getElementById('globalSearchError');
    var countLine = doc.getElementById('globalSearchTotalCount');
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
      result = { term: q, groups: [], totalCount: 0, hasError: true, _controllerMissing: true };
    }

    if (_gsSequencer && !_gsSequencer.isCurrent(token)) return; // stale

    var grouped = _gsGroupSearchResults(result);
    _gsLastRenderedResult = grouped;

    var recentPanel = doc.getElementById('globalSearchRecent');
    if (recentPanel) recentPanel.style.display = 'none';

    if (result._controllerMissing) {
      if (errorBox) {
        _text(errorBox, 'تعذر تشغيل البحث الشامل حاليًا (لم يتم تحميل مكوّن البحث). جرّب تحديث الصفحة.');
        errorBox.style.display = '';
      }
      if (typeof toast === 'function') { try { toast('تعذر تشغيل البحث الشامل', 'error'); } catch (e) { /* best-effort */ } }
      if (countLine) countLine.style.display = 'none';
      _gsShowOnly('globalSearchEmpty');
      return;
    }

    if (grouped.hasError) {
      var failedLabels = (result.groups || []).filter(function (g) { return g.error; })
        .map(function (g) { return g.label; }).join('، ');
      if (errorBox) {
        _text(errorBox, 'تعذر البحث في: ' + failedLabels + '. النتائج المعروضة أدناه من باقي الأقسام فقط.');
        errorBox.style.display = '';
      }
    }

    if (options && options.commit && _gsHistoryStore) {
      _gsHistoryStore.add(q);
    }

    if (!grouped.totalCount) {
      var emptyText = doc.getElementById('globalSearchEmptyText');
      if (emptyText) {
        _text(emptyText, (_gsCurrentScope === 'all')
          ? 'لا توجد نتائج مطابقة في أي قسم.'
          : 'لا توجد نتائج مطابقة في هذا النطاق. جرّب "الكل" لتوسيع نطاق البحث.');
      }
      if (countLine) countLine.style.display = 'none';
      _gsShowOnly('globalSearchEmpty');
      return;
    }

    if (countLine) {
      countLine.style.display = '';
      _text(countLine, 'إجمالي النتائج: ' + grouped.totalCount);
    }
    _gsShowOnly('globalSearchResults');
    renderGlobalSearchResultGroups(grouped);
  }

  function renderGlobalSearchResultGroups(grouped) {
    var container = doc.getElementById('globalSearchResults');
    if (!container) return;
    container.innerHTML = '';

    grouped.groups.forEach(function (group) {
      var groupEl = _el('div', 'global-search-group');

      var header = _el('div', 'global-search-group-header');
      header.appendChild(_icon(group.icon));
      var labelSpan = _el('span');
      _text(labelSpan, group.label);
      header.appendChild(labelSpan);
      var countSpan = _el('span', 'global-search-group-count');
      _text(countSpan, '(' + group.total + ')');
      header.appendChild(countSpan);
      if (group.error) {
        var errSpan = _el('span', 'global-search-group-error');
        _text(errSpan, 'تعذر البحث في هذا القسم');
        header.appendChild(errSpan);
      }
      groupEl.appendChild(header);

      var itemsBox = _el('div', 'global-search-group-items');
      group.items.forEach(function (item) { itemsBox.appendChild(_renderResultItem(item)); });
      groupEl.appendChild(itemsBox);

      container.appendChild(groupEl);
    });
  }

  function _renderResultItem(item) {
    var btn = _el('button', 'global-search-result-item');
    btn.type = 'button';
    btn.setAttribute('data-page', item.page || '');
    btn.setAttribute('data-type', item.type || '');
    btn.setAttribute('data-entity-id', item.entityId === null || item.entityId === undefined ? '' : String(item.entityId));

    var chevron = _el('span', 'global-search-result-chevron');
    _text(chevron, '‹');
    btn.appendChild(chevron);

    var body = _el('span', 'global-search-result-body');

    var main = _el('span', 'global-search-result-main');
    if (item.status) {
      var statusSpan = _el('span', 'global-search-result-status');
      _text(statusSpan, item.status);
      main.appendChild(statusSpan);
    }
    var labelSpan = _el('span', 'global-search-result-label');
    _text(labelSpan, item.label || '—');
    main.appendChild(labelSpan);
    body.appendChild(main);

    var secondaryParts = [];
    if (item.secondaryLabel) secondaryParts.push(item.secondaryLabel);
    if (item.date) secondaryParts.push(item.date);
    if (secondaryParts.length) {
      var secondary = _el('div', 'global-search-result-secondary');
      secondaryParts.forEach(function (p) {
        var span = _el('span');
        _text(span, p);
        secondary.appendChild(span);
      });
      body.appendChild(secondary);
    }

    btn.appendChild(body);

    if (item.meta && item.meta.entityIcon) {
      var iconSpan = _icon(item.meta.entityIcon);
      iconSpan.className = 'global-search-result-icon';
      btn.appendChild(iconSpan);
    }

    // Click navigation is bound directly on this button (a real closure
    // over `item.page`) as a defense-in-depth complement to the
    // container-level delegated handler below (handleGlobalSearchResultClick
    // still exists for the container onclick in index.html and for any
    // future markup that reintroduces string-built rows) — both paths
    // resolve to the same navigate(item.page) call, never a rebuilt
    // string attribute.
    btn.addEventListener('click', function () { _openGlobalSearchResult(item); });

    return btn;
  }

  function _openGlobalSearchResult(item) {
    if (!item || !item.page) return;
    var input = doc.getElementById('globalSearchInput');
    if (_gsHistoryStore && input && input.value && input.value.trim()) {
      _gsHistoryStore.add(input.value.trim());
    }
    if (win && typeof win.navigate === 'function') win.navigate(item.page);
    else if (typeof navigate === 'function') navigate(item.page); // existing, unmodified navigate()
  }

  /** Kept for markup compatibility (index.html's #globalSearchResults
   * still carries onclick="handleGlobalSearchResultClick(event)" as a
   * belt-and-suspenders delegated handler). Reads only `data-page`,
   * which was set via setAttribute (safe) above — no string-built
   * onclick is generated anywhere in this file anymore. */
  function handleGlobalSearchResultClick(event) {
    var target = event.target;
    while (target && target !== event.currentTarget && (!target.classList || !target.classList.contains('global-search-result-item'))) {
      target = target.parentElement;
    }
    if (!target || !target.classList || !target.classList.contains('global-search-result-item')) return;
    var page = target.getAttribute('data-page');
    if (!page) return;
    var input = doc.getElementById('globalSearchInput');
    if (_gsHistoryStore && input && input.value && input.value.trim()) {
      _gsHistoryStore.add(input.value.trim());
    }
    if (win && typeof win.navigate === 'function') win.navigate(page);
    else if (typeof navigate === 'function') navigate(page);
  }

  // ================================================================
  // Boot wiring
  // ================================================================

  function _gsBoot() {
    // NOTE: #globalSearchInput / #globalSearchClearBtn /
    // #globalSearchClearRecentBtn / #globalSearchResults already carry
    // static inline handlers in index.html
    // (oninput="onGlobalSearchInputChanged(this.value)", etc.). Those
    // are safe as written — fixed function names with no embedded
    // dynamic value, not the bug pattern this revision fixes — so they
    // are intentionally left as-is and NOT re-bound here via
    // addEventListener, to avoid firing every handler twice. Only the
    // dynamically GENERATED elements (scope tabs, recent chips, result
    // rows) needed to move off string-built onclick attributes, and
    // those are wired via addEventListener at render time in
    // renderGlobalSearchScopeTabs()/renderRecentGlobalSearches()/
    // renderGlobalSearchResultGroups() above.
    renderGlobalSearchScopeTabs();
    runGlobalSearch('', { commit: false });
  }

  if (doc) {
    if (doc.readyState === 'loading') {
      doc.addEventListener('DOMContentLoaded', _gsBoot);
    } else if (doc.getElementById && doc.getElementById('globalSearchInput')) {
      // Node/fake-DOM test harnesses may already be "ready" with the
      // markup present — boot immediately rather than waiting for an
      // event that may never fire on a fake document.
      _gsBoot();
    } else {
      doc.addEventListener && doc.addEventListener('DOMContentLoaded', _gsBoot);
    }
  }

  // Refresh Recent Searches whenever the Shell reports the user actually
  // navigated to this page — additive use of the EXISTING ShellEvents bus,
  // navigate() itself is never touched to wire this up.
  if (win && win.ShellEvents && typeof win.ShellEvents.on === 'function') {
    win.ShellEvents.on('shell:afterNavigate', function (payload) {
      if (payload && payload.to === 'globalSearch') {
        var input = doc.getElementById('globalSearchInput');
        if (!input || !input.value || !input.value.trim()) renderRecentGlobalSearches();
      }
    });
  }

  var api = {
    renderGlobalSearchScopeTabs: renderGlobalSearchScopeTabs,
    setGlobalSearchScope: setGlobalSearchScope,
    onGlobalSearchInputChanged: onGlobalSearchInputChanged,
    onGlobalSearchInputKeydown: onGlobalSearchInputKeydown,
    onGlobalSearchInputFocused: onGlobalSearchInputFocused,
    clearGlobalSearchInput: clearGlobalSearchInput,
    renderRecentGlobalSearches: renderRecentGlobalSearches,
    applyRecentGlobalSearch: applyRecentGlobalSearch,
    removeRecentGlobalSearch: removeRecentGlobalSearch,
    clearRecentGlobalSearches: clearRecentGlobalSearches,
    runGlobalSearch: runGlobalSearch,
    renderGlobalSearchResultGroups: renderGlobalSearchResultGroups,
    handleGlobalSearchResultClick: handleGlobalSearchResultClick,
    _boot: _gsBoot,
    _getCurrentScope: function () { return _gsCurrentScope; }
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  if (win) {
    win.renderGlobalSearchScopeTabs = renderGlobalSearchScopeTabs;
    win.setGlobalSearchScope = setGlobalSearchScope;
    win.onGlobalSearchInputChanged = onGlobalSearchInputChanged;
    win.onGlobalSearchInputKeydown = onGlobalSearchInputKeydown;
    win.onGlobalSearchInputFocused = onGlobalSearchInputFocused;
    win.clearGlobalSearchInput = clearGlobalSearchInput;
    win.applyRecentGlobalSearch = applyRecentGlobalSearch;
    win.removeRecentGlobalSearch = removeRecentGlobalSearch;
    win.clearRecentGlobalSearches = clearRecentGlobalSearches;
    win.handleGlobalSearchResultClick = handleGlobalSearchResultClick;
    win._globalSearchUiTestApi = api; // used only by verify_global_search_ui_dom.js
  }

})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
