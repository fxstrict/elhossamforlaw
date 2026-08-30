/**
 * ================================================================
 * dashboard-legal-directories-nav.js
 * js/modules/dashboard-legal-directories-nav.js | نظام الحسام للمحاماة
 * ================================================================
 * PHASE — Legal Directories: Dashboard Shortcut Navigator
 *
 * WHAT THIS IS
 *   A small, additive widget on the Dashboard page (#page-dashboard)
 *   that lets the user browse the SAME Legal Directories tree
 *   (courts / prosecutions / bar association / ... and every level
 *   under them, including anything added later from the Admin Panel)
 *   directly from the dashboard, as a single horizontal, dynamic,
 *   drag-scrollable strip — without navigating to the full
 *   "الأجندة والمواقع الرسمية" page (#page-legalDirectories).
 *   Tapping the header row still opens that full page as before.
 *
 * WHAT THIS IS NOT / REUSE RULES (unchanged project constraints)
 *   - NOT a second data source. It never fetches
 *     js/data/directories/legal-directories.json itself — it calls
 *     js/modules/legal-directories.js's ensureDatasetLoaded()/
 *     getDataset()/getLoadError() accessors, which read/await the
 *     exact same singleton (_dataset/_loadPromise) the full page
 *     uses. The dataset is still fetched at most once per session.
 *   - NOT a second renderer. Every folder/link tile is built by the
 *     existing js/utils/DirectoryRenderer.js renderNode(), the exact
 *     same function the full page's grid uses — only the container
 *     around the tiles (a horizontal flex strip instead of a grid)
 *     and its compact sizing are specific to this widget, both via
 *     additive, scoped CSS (css/dashboard-legal-directories-nav.css)
 *     that touches no existing selector.
 *   - NOT wired to IndexedDB/Repository/Google Sheets/Apps Script —
 *     same as the data it reads.
 *   - NOT entity-specific: navigation is driven purely by
 *     type/children/items (js/utils/DirectoryModel.js), never by a
 *     specific id/slug/title (Stage-1 §19, carried over here).
 *   - Independent navigation state from the full page: this widget
 *     keeps its own small in-memory stack (_stack, same shape as
 *     legal-directories.js's own: [{kind:'directory'|'folder',
 *     directory, node?}, ...]) rather than sharing that module's
 *     internal stack, because the two are different, independently
 *     visible UI surfaces (dashboard widget vs. full page) — there
 *     is no dual-source risk here since both always read from the
 *     one shared dataset singleton described above.
 *
 * WIRING (index.html)
 *   Requires these ids inside #page-dashboard:
 *     #dashLegalDirNav, #dashLegalDirHeader, #dashLegalDirStrip,
 *     #dashLegalDirEmpty, #dashLegalDirError
 *   Entry point: renderDashboardLegalDirNav(), called from
 *   js/modules/dashboard.js's renderDashboard() (same additive
 *   pattern already used there for renderTodayCenterWidget() /
 *   renderAlertsCenterWidget()) — guarded with a typeof check there
 *   so a missing/not-yet-loaded copy of this file never breaks the
 *   rest of the dashboard.
 *
 * SCOPE — no browser history integration
 *   Unlike the full page, drilling in/out of this widget does NOT
 *   push browser history entries or listen for popstate. This is a
 *   lightweight in-place shortcut living on top of the Dashboard
 *   page, not a navigable "place" of its own — the Android/browser
 *   Back button continues to behave exactly as it already does on
 *   the Dashboard page today. "الرجوع" inside the strip is a plain
 *   in-widget action (pop one level, re-render the same strip).
 * ================================================================
 */
(function (global) {
  'use strict';

  // Independent, in-memory-only navigation state for this widget —
  // see header note above for why it is not shared with
  // js/modules/legal-directories.js's own _stack.
  var _stack = []; // [{ kind:'directory'|'folder', directory, node? }, ...]

  function getDom() {
    return {
      nav: global.document.getElementById('dashLegalDirNav'),
      strip: global.document.getElementById('dashLegalDirStrip'),
      empty: global.document.getElementById('dashLegalDirEmpty'),
      error: global.document.getElementById('dashLegalDirError')
    };
  }

  function dependenciesReady() {
    return !!(global.DirectoryModel && global.DirectoryRenderer && global.LegalDirectoriesModule);
  }

  // ================================================================
  // Navigation actions (mirrors legal-directories.js's push/back
  // logic exactly, minus the browser-history piece — see header)
  // ================================================================

  function pushDirectory(directory) {
    _stack.push({ kind: 'directory', directory: directory });
    renderCurrentLevel();
  }

  function pushFolder(node) {
    var ancestorDirectory = _stack.length > 0 ? _stack[_stack.length - 1].directory : null;
    _stack.push({ kind: 'folder', node: node, directory: ancestorDirectory });
    renderCurrentLevel();
  }

  function goBack() {
    if (_stack.length === 0) return;
    _stack.pop();
    renderCurrentLevel();
  }

  function buildBackTile(doc) {
    var btn = doc.createElement('button');
    btn.type = 'button';
    btn.className = 'legal-dir-card dash-legaldir-back';
    btn.setAttribute('aria-label', 'رجوع إلى المستوى السابق');

    var icon = doc.createElement('span');
    icon.className = 'legal-dir-card-icon';
    icon.setAttribute('aria-hidden', 'true');
    icon.textContent = '\u2190'; // ← — same glyph convention as the full page's breadcrumb affordance

    var title = doc.createElement('span');
    title.className = 'legal-dir-card-title';
    title.textContent = 'رجوع';

    btn.appendChild(icon);
    btn.appendChild(title);
    btn.addEventListener('click', goBack);
    return btn;
  }

  // ================================================================
  // Render current level into the horizontal strip
  // ================================================================

  function renderCurrentLevel() {
    var dom = getDom();
    if (!dom.strip) return; // widget markup not on this page — nothing to do
    if (!dependenciesReady()) return; // DirectoryModel/Renderer/LegalDirectoriesModule not loaded yet

    var loadErr = global.LegalDirectoriesModule.getLoadError();
    if (loadErr) {
      dom.strip.innerHTML = '';
      if (dom.error) dom.error.style.display = '';
      if (dom.empty) dom.empty.style.display = 'none';
      return;
    }

    var dataset = global.LegalDirectoriesModule.getDataset();
    if (dom.error) dom.error.style.display = 'none';
    if (!dataset) {
      // Still loading — leave the strip as-is; ensureDatasetLoaded()'s
      // .then() (see renderDashboardLegalDirNav()) will re-render once
      // the shared dataset singleton resolves.
      return;
    }

    var doc = global.document;
    var handlers = {
      onFolderClick: function (node) { pushFolder(node); },
      onLinkClick: function (node) {
        if (node.url) global.open(node.url, node.target || '_blank', 'noopener,noreferrer');
      }
    };

    var cards;
    if (_stack.length === 0) {
      var directories = (dataset.directories || [])
        .filter(function (d) { return global.DirectoryModel.isEnabled(d); });
      var sortedDirs = global.DirectoryModel.sortByOrder(directories);
      cards = sortedDirs.map(function (directory) {
        var pseudoNode = {
          id: directory.id, title: directory.title, type: 'folder',
          description: directory.description, icon: directory.icon, enabled: directory.enabled
        };
        return global.DirectoryRenderer.renderNode(pseudoNode, {
          onFolderClick: function () { pushDirectory(directory); }
        });
      });
    } else {
      var top = _stack[_stack.length - 1];
      var list = top.kind === 'directory' ? top.directory.items : (top.node.children || []);
      var visible = (list || []).filter(function (n) { return global.DirectoryModel.isEnabled(n); });
      var sortedNodes = global.DirectoryModel.sortByOrder(visible);
      cards = sortedNodes.map(function (node) { return global.DirectoryRenderer.renderNode(node, handlers); });
    }

    dom.strip.innerHTML = '';
    if (_stack.length > 0) dom.strip.appendChild(buildBackTile(doc));
    cards.forEach(function (card) { dom.strip.appendChild(card); });

    if (dom.empty) dom.empty.style.display = (cards.length === 0 && _stack.length === 0) ? '' : 'none';
  }

  // ================================================================
  // Entry point (called from dashboard.js's renderDashboard(), like
  // every other widget function there)
  // ================================================================

  function renderDashboardLegalDirNav() {
    var dom = getDom();
    if (!dom.strip) return; // additive feature — safe no-op if markup isn't present
    if (global.LegalDirectoriesModule && typeof global.LegalDirectoriesModule.ensureDatasetLoaded === 'function') {
      global.LegalDirectoriesModule.ensureDatasetLoaded().then(renderCurrentLevel);
    }
    renderCurrentLevel();
  }

  // ================================================================
  // Exports
  // ================================================================

  global.renderDashboardLegalDirNav = renderDashboardLegalDirNav;

  var api = {
    renderDashboardLegalDirNav: renderDashboardLegalDirNav,
    _resetForTests: function () { _stack = []; },
    _stackDepthForTests: function () { return _stack.length; },
    _goBackForTests: goBack
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  global.DashboardLegalDirNav = api;
})(typeof window !== 'undefined' ? window : (typeof global !== 'undefined' ? global : this));
