/**
 * ================================================================
 * legal-directories.js — js/modules/legal-directories.js
 * نظام الحسام للمحاماة
 * ================================================================
 * PHASE — Legal Directories: Generic UI (Stage 2)
 *
 * WHAT THIS IS
 *   The page module behind the "الأدلة القانونية" nav item / page
 *   (#page-legalDirectories). Loads the static dataset once, walks
 *   it with a simple breadcrumb/drill-down stack, and delegates all
 *   DOM building to js/utils/DirectoryRenderer.js. This file owns
 *   ONLY navigation state (which directory/folder is open) — it
 *   never branches on a specific directory/node id/slug/title
 *   (Stage-1 §19 requirement, carried into Stage 2).
 *
 * DATA SOURCE
 *   fetch('js/data/directories/legal-directories.json') — the exact
 *   same static file validated and tested in Stage 1
 *   (js/utils/DirectoryValidation.js). Fetched once per page load and
 *   cached in memory; the app's own service worker already serves
 *   same-origin GET requests it doesn't explicitly precache via a
 *   stale-while-revalidate runtime cache (see service-worker.js),
 *   so this file does not need special offline handling of its own.
 *   NOTE (flagged, not silently assumed): this file is intentionally
 *   NOT added to service-worker.js's PRECACHE_URLS in this phase —
 *   see the delivery report for why, and why that's still safe.
 *
 * WHAT THIS IS NOT
 *   - Not a Repository. No IndexedDB, no Google Sheets, no user data.
 *   - Not an admin/editor. Read-only browsing only (Stage-1 §28).
 *
 * WIRING (index.html)
 *   Requires these ids to exist on #page-legalDirectories:
 *     #legalDirBreadcrumb, #legalDirGrid, #legalDirEmpty, #legalDirError
 *   Entry point called from navigate()'s dispatch, exactly like every
 *   other page's renderX(): renderLegalDirectories().
 * ================================================================
 */
(function (global) {
  'use strict';

  // In-memory-only state — never persisted, never touches any
  // Repository/IndexedDB/localStorage (this is static reference
  // content, not office/case data).
  var _dataset = null;          // { directories: Directory[] } | null
  var _loadPromise = null;
  var _loadError = null;
  // Navigation stack: [{ kind:'directory', directory }, { kind:'folder', node }, ...]
  var _stack = [];

  function getDom() {
    return {
      breadcrumb: global.document.getElementById('legalDirBreadcrumb'),
      grid: global.document.getElementById('legalDirGrid'),
      empty: global.document.getElementById('legalDirEmpty'),
      error: global.document.getElementById('legalDirError')
    };
  }

  // ================================================================
  // 1. Load + validate (once)
  // ================================================================

  function loadDataset() {
    if (_dataset || _loadError) return Promise.resolve();
    if (_loadPromise) return _loadPromise;

    _loadPromise = global.fetch('js/data/directories/legal-directories.json')
      .then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
      })
      .then(function (json) {
        if (global.DirectoryValidation) {
          var result = global.DirectoryValidation.validateDataset(json);
          if (!result.valid) {
            // Fail loudly in the console (dev-visible) but degrade
            // gracefully in the UI — never throw up through navigate().
            console.error('[legal-directories] dataset failed validation:',
              result.errors.map(global.DirectoryValidation.toDisplayString));
            throw new Error('dataset failed validation (' + result.errors.length + ' error(s), see console)');
          }
        }
        _dataset = json;
      })
      .catch(function (err) {
        _loadError = err;
        console.error('[legal-directories] failed to load dataset:', err);
      });

    return _loadPromise;
  }

  // ================================================================
  // 2. Breadcrumb
  // ================================================================

  function renderBreadcrumb(dom) {
    dom.breadcrumb.innerHTML = '';
    var doc = global.document;

    function addCrumb(label, onClick, isCurrent) {
      if (dom.breadcrumb.children.length > 0) {
        var sep = doc.createElement('span');
        sep.className = 'legal-dir-breadcrumb-sep';
        sep.textContent = '\u203A'; // ›
        dom.breadcrumb.appendChild(sep);
      }
      var btn = doc.createElement('button');
      btn.type = 'button';
      btn.className = 'legal-dir-breadcrumb-item';
      btn.textContent = label;
      if (isCurrent) {
        btn.setAttribute('aria-current', 'page');
      } else {
        btn.addEventListener('click', onClick);
      }
      dom.breadcrumb.appendChild(btn);
    }

    addCrumb('الأدلة القانونية', function () { goToRoot(); }, _stack.length === 0);

    _stack.forEach(function (entry, index) {
      var isLast = index === _stack.length - 1;
      var title = entry.kind === 'directory' ? entry.directory.title : entry.node.title;
      addCrumb(title, function () { goToDepth(index); }, isLast);
    });
  }

  // ================================================================
  // 3. Rendering the current level
  // ================================================================

  function renderCurrentLevel() {
    var dom = getDom();
    if (!dom.grid) return; // page not in DOM (defensive — never throw)

    if (_loadError) {
      dom.grid.innerHTML = '';
      dom.empty.style.display = 'none';
      dom.error.style.display = '';
      dom.error.textContent = 'تعذر تحميل الأدلة القانونية. تحقق من الاتصال ثم أعد المحاولة.';
      renderBreadcrumb(dom);
      return;
    }
    dom.error.style.display = 'none';

    var handlers = {
      onFolderClick: function (node) { pushFolder(node); },
      onLinkClick: function (node) { if (node.url) global.open(node.url, node.target || '_blank', 'noopener,noreferrer'); }
    };

    var cards;
    if (_stack.length === 0) {
      // Root level: the list of Directories themselves, rendered as
      // folder-like cards using the SAME generic Node card shape by
      // wrapping each Directory as a folder-typed Node — no separate
      // "DirectoryCard" component needed (Stage-1 §1: one renderer).
      var directories = (_dataset ? _dataset.directories : [])
        .filter(function (d) { return global.DirectoryModel.isEnabled(d); });
      var sorted = global.DirectoryModel.sortByOrder(directories);
      cards = sorted.map(function (directory) {
        var pseudoNode = {
          id: directory.id, title: directory.title, type: 'folder',
          description: directory.description, icon: directory.icon, enabled: true
        };
        var card = global.DirectoryRenderer.renderNode(pseudoNode, {
          onFolderClick: function () { pushDirectory(directory); }
        });
        return card;
      });
    } else {
      var top = _stack[_stack.length - 1];
      if (top.kind === 'directory') {
        cards = global.DirectoryRenderer.renderDirectory(top.directory, handlers);
      } else {
        cards = global.DirectoryRenderer.renderNodeChildren(top.node, handlers);
      }
    }

    dom.grid.innerHTML = '';
    cards.forEach(function (card) { dom.grid.appendChild(card); });
    dom.empty.style.display = cards.length === 0 ? '' : 'none';

    renderBreadcrumb(dom);
  }

  // ================================================================
  // 4. Navigation actions
  // ================================================================

  function pushDirectory(directory) {
    _stack.push({ kind: 'directory', directory: directory });
    renderCurrentLevel();
  }

  function pushFolder(node) {
    _stack.push({ kind: 'folder', node: node });
    renderCurrentLevel();
  }

  function goToRoot() {
    _stack = [];
    renderCurrentLevel();
  }

  function goToDepth(index) {
    _stack = _stack.slice(0, index + 1);
    renderCurrentLevel();
  }

  // ================================================================
  // 5. Entry point (called from navigate() dispatch, like renderX())
  // ================================================================

  function renderLegalDirectories() {
    loadDataset().then(renderCurrentLevel);
    // Render immediately too (covers the already-loaded/cached case
    // synchronously, and shows an empty grid instead of a blank page
    // while the first fetch is in flight).
    renderCurrentLevel();
  }

  // ================================================================
  // 6. Exports (global function name matches navigate()'s dispatch
  //    convention: renderLegalDirectories(), exactly like renderLibrary())
  // ================================================================

  global.renderLegalDirectories = renderLegalDirectories;

  var api = {
    renderLegalDirectories: renderLegalDirectories,
    _resetForTests: function () { _dataset = null; _loadPromise = null; _loadError = null; _stack = []; }
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  global.LegalDirectoriesModule = api;
})(typeof window !== 'undefined' ? window : (typeof global !== 'undefined' ? global : this));
