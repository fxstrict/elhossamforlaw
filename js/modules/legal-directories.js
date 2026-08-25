/**
 * ================================================================
 * legal-directories.js — js/modules/legal-directories.js
 * نظام الحسام للمحاماة
 * ================================================================
 * PHASE — Legal Directories: Generic UI (Stage 2) + Admin Panel (Stage 3, PART B)
 *
 * WHAT THIS IS (Stage 2, unchanged)
 *   The page module behind the "الأدلة القانونية" nav item / page
 *   (#page-legalDirectories). Loads the static dataset once, walks
 *   it with a simple breadcrumb/drill-down stack, and delegates all
 *   DOM building to js/utils/DirectoryRenderer.js. Never branches on
 *   a specific directory/node id/slug/title (Stage-1 §19).
 *
 * WHAT'S NEW (Stage 3, PART B — admin mode)
 *   A permission-gated "وضع الإدارة" toggle. When ON, browsing
 *   switches from the live dataset to an in-memory DRAFT
 *   (js/modules/legal-directories-admin.js) so nothing is ever
 *   written back to js/data/directories/legal-directories.json by
 *   the browser itself. Admin mode lets you:
 *     - add/edit/toggle-enabled/remove/reorder Directories (root)
 *     - add/edit/toggle-enabled/remove/reorder Nodes (folder/link),
 *       at any nesting depth
 *     - see live validation status (js/utils/DirectoryValidation.js)
 *     - download the edited dataset as JSON (via js/utils/
 *       DirectoryPublisher.js — canonical order, sorted, versioned)
 *   PERMISSION: reuses the EXISTING RBAC system exactly as-is —
 *   window.HossamSession.getCurrentUser() + window.HossamPermissionService
 *   .can(user, 'CanManageRawData') (an existing permission key from
 *   js/core/rbac/Permissions.js's "settings" group — CHOSEN, not
 *   added: no RBAC file was modified for this phase). Fails OPEN
 *   (admin controls visible) when RBAC isn't wired up or no session
 *   is active yet, matching js/core/rbac/SessionContext.js's own
 *   documented fail-open convention (login screen is "Deferred").
 *   NOTE — this permission gates the in-app admin UI ONLY. It is not
 *   a real security boundary: the static JSON lives in a public repo
 *   that anyone with repo access (or just the raw file URL) can read
 *   or edit outside this app. No backend authorization is needed
 *   right now because publishing is a manual, human-in-the-loop
 *   step (see below) — there is nothing this permission is meant to
 *   stop a technical user from doing to the file itself.
 *
 *   PUBLISHING (CONFIRMED, Stage 4 — approach (b)): Admin Panel ->
 *   Draft -> Validation -> DirectoryPublisher.createExportArtifact()
 *   -> browser download -> YOU manually commit the file to GitHub.
 *   See js/modules/legal-directories-admin.js's header for exactly
 *   why GitHub API/PAT/OAuth/Actions/a new backend are NOT built
 *   here, and how a future "Publish to GitHub" button would only
 *   replace this file's download-button handler.
 *
 * WIRING (index.html)
 *   Requires these ids on #page-legalDirectories:
 *     #legalDirBreadcrumb, #legalDirGrid, #legalDirEmpty, #legalDirError,
 *     #legalDirAdminBar (Stage 3)
 *   Entry point unchanged: renderLegalDirectories().
 *
 * BUG FIX — Back button (user-reported): drilling into a directory/
 *   folder now pushes a browser history entry per level and listens
 *   for popstate, so the Android/browser Back button goes up ONE tree
 *   level at a time (matching breadcrumb navigation) instead of
 *   exiting straight to the dashboard. See section 6 below for the
 *   full explanation and its one documented limitation (Forward).
 * ================================================================
 */
(function (global) {
  'use strict';

  // In-memory-only state — never persisted, never touches any
  // Repository/IndexedDB/localStorage (this is static reference
  // content, not office/case data).
  var _dataset = null;          // { directories: Directory[] } | null — the LIVE, read-only copy
  var _loadPromise = null;
  var _loadError = null;
  // Navigation stack: [{ kind:'directory'|'folder', directory, node? }, ...]
  // `directory` is always the ancestor Directory object for this
  // level (used by admin actions to know which directory a Node
  // add/edit belongs to, without ever branching on its id/title).
  var _stack = [];
  var _adminMode = false;

  function getDom() {
    return {
      breadcrumb: global.document.getElementById('legalDirBreadcrumb'),
      grid: global.document.getElementById('legalDirGrid'),
      empty: global.document.getElementById('legalDirEmpty'),
      error: global.document.getElementById('legalDirError'),
      adminBar: global.document.getElementById('legalDirAdminBar')
    };
  }

  // ================================================================
  // 1. Load + validate (once) — Stage 2, unchanged
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
  // 2. Admin permission (reuses existing RBAC — nothing added there)
  // ================================================================

  function isAdminAllowed() {
    var session = global.HossamSession;
    if (!session || typeof session.getCurrentUser !== 'function') return true; // RBAC not wired -> fail-open
    var user = session.getCurrentUser();
    if (!user) return true; // no active session (login deferred) -> fail-open, matches SessionContext.check()
    if (!global.HossamPermissionService || typeof global.HossamPermissionService.can !== 'function') return true;
    return global.HossamPermissionService.can(user, 'CanManageRawData');
  }

  /** The dataset actually being browsed: the admin draft when admin
   *  mode is on, otherwise the live, read-only dataset. */
  function activeDataset() {
    return (_adminMode && global.LegalDirectoriesAdmin) ? global.LegalDirectoriesAdmin.getDraft() : _dataset;
  }

  function toggleAdminMode() {
    if (!isAdminAllowed()) return;
    if (!global.LegalDirectoriesAdmin) return; // admin module not loaded — nothing to toggle into
    if (!_adminMode) {
      global.LegalDirectoriesAdmin.startDraft(_dataset || { directories: [] });
      _adminMode = true;
    } else {
      _adminMode = false;
    }
    _stack = []; // stale references across dataset<->draft — always return to root (documented tradeoff)
    renderCurrentLevel();
  }

  // ================================================================
  // 3. Breadcrumb — Stage 2, unchanged
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
  // 4. Admin bar (Stage 3) — toggle, validation status, quick-add
  //    form, per-card admin toolbars. All optional: if
  //    #legalDirAdminBar isn't in the DOM, or admin isn't allowed,
  //    this renders nothing and Stage-2 read-only behavior is
  //    unaffected.
  // ================================================================

  function currentAdminContext() {
    // Returns { directoryId, parentNodeId } describing where a new
    // Node would be added at the CURRENT level, or null at root
    // (root = add a Directory, not a Node).
    if (_stack.length === 0) return null;
    var top = _stack[_stack.length - 1];
    return {
      directoryId: top.directory.id,
      parentNodeId: top.kind === 'folder' ? top.node.id : null
    };
  }

  function buildQuickForm(dom, editTarget) {
    // editTarget: null (adding new) | { kind:'directory'|'node', id, values }
    var doc = global.document;
    var form = doc.createElement('div');
    form.className = 'legal-dir-admin-form';

    var ctx = currentAdminContext(); // null => root => Directory form
    var isDirectoryForm = !ctx;

    var titleInput = doc.createElement('input');
    titleInput.type = 'text';
    titleInput.placeholder = 'العنوان';
    titleInput.value = (editTarget && editTarget.values.title) || '';
    form.appendChild(titleInput);

    var descInput = doc.createElement('input');
    descInput.type = 'text';
    descInput.placeholder = 'وصف (اختياري)';
    descInput.value = (editTarget && editTarget.values.description) || '';
    form.appendChild(descInput);

    var typeSelect = null, urlInput = null;
    if (!isDirectoryForm) {
      typeSelect = doc.createElement('select');
      ['folder', 'link'].forEach(function (t) {
        var opt = doc.createElement('option');
        opt.value = t; opt.textContent = t === 'folder' ? 'مجلد' : 'رابط';
        typeSelect.appendChild(opt);
      });
      typeSelect.value = (editTarget && editTarget.values.type) || 'link';
      form.appendChild(typeSelect);

      urlInput = doc.createElement('input');
      urlInput.type = 'text';
      urlInput.placeholder = 'الرابط (لعنصر من نوع رابط)';
      urlInput.value = (editTarget && editTarget.values.url) || '';
      form.appendChild(urlInput);
    }

    var saveBtn = doc.createElement('button');
    saveBtn.type = 'button';
    saveBtn.textContent = editTarget ? 'حفظ التعديل' : (isDirectoryForm ? 'إضافة دليل' : 'إضافة عنصر');
    saveBtn.addEventListener('click', function () {
      var Admin = global.LegalDirectoriesAdmin;
      var fields = { title: titleInput.value, description: descInput.value || undefined };
      if (!isDirectoryForm) {
        fields.type = typeSelect.value;
        if (typeSelect.value === 'link') fields.url = urlInput.value;
      }
      try {
        if (editTarget) {
          if (editTarget.kind === 'directory') Admin.updateDirectory(editTarget.id, fields);
          else Admin.updateNode(editTarget.id, fields);
        } else if (isDirectoryForm) {
          Admin.addDirectory(fields);
        } else {
          Admin.addNode(ctx.directoryId, ctx.parentNodeId, fields);
        }
        renderCurrentLevel();
      } catch (e) {
        console.error('[legal-directories admin]', e);
      }
    });
    form.appendChild(saveBtn);

    return form;
  }

  function buildAdminToolbar(kind, id, node) {
    var doc = global.document;
    var Admin = global.LegalDirectoriesAdmin;
    var bar = doc.createElement('div');
    bar.className = 'legal-dir-admin-toolbar';

    function btn(label, onClick) {
      var b = doc.createElement('button');
      b.type = 'button';
      b.textContent = label;
      b.addEventListener('click', onClick);
      bar.appendChild(b);
      return b;
    }

    btn('\u25B2', function () { // ▲
      if (kind === 'directory') Admin.moveDirectoryOrder(id, 'up'); else Admin.moveNodeOrder(id, 'up');
      renderCurrentLevel();
    });
    btn('\u25BC', function () { // ▼
      if (kind === 'directory') Admin.moveDirectoryOrder(id, 'down'); else Admin.moveNodeOrder(id, 'down');
      renderCurrentLevel();
    });
    btn('\u270E \u062A\u0639\u062F\u064A\u0644', function () { // ✎ تعديل
      renderCurrentLevel({ kind: kind, id: id, values: node });
    });
    btn(node.enabled === false ? '\u{1F441} \u062A\u0641\u0639\u064A\u0644' : '\u{1F441} \u062A\u0639\u0637\u064A\u0644', function () {
      if (kind === 'directory') Admin.toggleDirectoryEnabled(id); else Admin.toggleNodeEnabled(id);
      renderCurrentLevel();
    });
    btn('\u{1F5D1} \u062D\u0630\u0641', function () { // 🗑 حذف
      var confirmFn = global.confirm || function () { return true; };
      if (!confirmFn('هل تريد حذف هذا العنصر نهائياً من المسودة؟')) return;
      if (kind === 'directory') Admin.removeDirectory(id); else Admin.removeNode(id);
      renderCurrentLevel();
    });

    return bar;
  }

  function renderAdminBar(dom, editTarget) {
    if (!dom.adminBar) return;
    dom.adminBar.innerHTML = '';
    if (!isAdminAllowed()) return;
    var doc = global.document;

    var toggleBtn = doc.createElement('button');
    toggleBtn.type = 'button';
    toggleBtn.className = 'legal-dir-admin-toggle';
    toggleBtn.textContent = _adminMode ? 'إنهاء وضع الإدارة' : 'تفعيل وضع الإدارة';
    toggleBtn.addEventListener('click', toggleAdminMode);
    dom.adminBar.appendChild(toggleBtn);

    if (!_adminMode || !global.LegalDirectoriesAdmin) return;
    var Admin = global.LegalDirectoriesAdmin;

    var status = doc.createElement('div');
    status.className = 'legal-dir-admin-status';
    var result = Admin.validateDraft();
    status.textContent = result.valid
      ? '\u2705 المسودة صالحة (' + (Admin.isDirty() ? 'بها تعديلات غير محفوظة خارج المتصفح' : 'بدون تعديلات') + ')'
      : '\u26A0 ' + result.errors.length + ' خطأ في المسودة — التنزيل معطّل حتى يتم الإصلاح';
    dom.adminBar.appendChild(status);

    var downloadBtn = doc.createElement('button');
    downloadBtn.type = 'button';
    downloadBtn.textContent = 'تنزيل التعديلات (JSON)';
    downloadBtn.disabled = !result.valid;
    downloadBtn.addEventListener('click', function () {
      var artifact;
      try {
        artifact = Admin.exportArtifact(); // {filename, content, dataset} — see DirectoryPublisher.js
      } catch (e) {
        console.error('[legal-directories admin] export blocked:', e);
        return;
      }
      if (typeof global.Blob === 'function' && global.document.createElement('a').download !== undefined) {
        var blob = new global.Blob([artifact.content], { type: 'application/json' });
        var url = global.URL.createObjectURL(blob);
        var a = doc.createElement('a');
        a.href = url;
        a.download = artifact.filename;
        a.click();
        global.URL.revokeObjectURL(url);
      }
    });
    dom.adminBar.appendChild(downloadBtn);

    var resetBtn = doc.createElement('button');
    resetBtn.type = 'button';
    resetBtn.textContent = 'تراجع عن كل التعديلات';
    resetBtn.addEventListener('click', function () {
      Admin.resetDraft();
      _stack = [];
      renderCurrentLevel();
    });
    dom.adminBar.appendChild(resetBtn);

    dom.adminBar.appendChild(buildQuickForm(dom, editTarget || null));
  }

  // ================================================================
  // 5. Rendering the current level (Stage 2 flow + Stage 3 wrap)
  // ================================================================

  function renderCurrentLevel(editTarget) {
    var dom = getDom();
    if (!dom.grid) return; // page not in DOM (defensive — never throw)

    renderAdminBar(dom, editTarget);

    if (_loadError && !_adminMode) {
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

    var dataset = activeDataset();
    var nodesForToolbar = []; // [{kind,id,node}] parallel to cards, admin-mode only

    var cards;
    if (_stack.length === 0) {
      var directories = (dataset ? dataset.directories : [])
        .filter(function (d) { return _adminMode || global.DirectoryModel.isEnabled(d); });
      var sorted = global.DirectoryModel.sortByOrder(directories);
      cards = sorted.map(function (directory) {
        var pseudoNode = {
          id: directory.id, title: directory.title, type: 'folder',
          description: directory.description, icon: directory.icon, enabled: directory.enabled
        };
        var card = global.DirectoryRenderer.renderNode(pseudoNode, {
          onFolderClick: function () { pushDirectory(directory); }
        });
        nodesForToolbar.push({ kind: 'directory', id: directory.id, node: directory });
        return card;
      });
    } else {
      var top = _stack[_stack.length - 1];
      var list = top.kind === 'directory' ? top.directory.items : (top.node.children || []);
      var visibleList = list.filter(function (n) { return _adminMode || global.DirectoryModel.isEnabled(n); });
      var sortedNodes = global.DirectoryModel.sortByOrder(visibleList);
      cards = sortedNodes.map(function (node) {
        var card = global.DirectoryRenderer.renderNode(node, handlers);
        nodesForToolbar.push({ kind: 'node', id: node.id, node: node });
        return card;
      });
    }

    dom.grid.innerHTML = '';
    cards.forEach(function (card, i) {
      if (_adminMode) {
        var doc = global.document;
        var wrap = doc.createElement('div');
        wrap.className = 'legal-dir-card-wrap';
        wrap.appendChild(card);
        wrap.appendChild(buildAdminToolbar(nodesForToolbar[i].kind, nodesForToolbar[i].id, nodesForToolbar[i].node));
        dom.grid.appendChild(wrap);
      } else {
        dom.grid.appendChild(card);
      }
    });
    dom.empty.style.display = cards.length === 0 ? '' : 'none';

    renderBreadcrumb(dom);
  }

  // ================================================================
  // 6. Navigation actions — carry `directory` on every stack entry
  //    so admin actions always know which Directory a Node belongs
  //    to without branching on any id/title (Stage-1 §19).
  //
  //    BUG FIX (reported by user): the Android/browser Back button
  //    used to exit straight to the dashboard instead of going up one
  //    level in the tree, because drilling into a directory/folder
  //    never created a browser history entry — only the top-level
  //    navigate() call (via js/core/shell/NavigationManager.js) did.
  //    Fix: every drill-down pushes ONE history entry
  //    ({page:'legalDirectories', legalDirDepth:N}, same '#legalDirectories'
  //    URL — see js/core/shell/NavigationManager.js's own "why hash-based"
  //    rationale, which applies identically here). Going shallower
  //    (breadcrumb/root click OR the real Back button) is driven
  //    through history.go(-steps) + the popstate listener below, so
  //    in-app breadcrumb clicks and the OS/browser Back button always
  //    manipulate the exact same history stack and can never diverge.
  //
  //    KNOWN LIMITATION: pressing Forward after pressing Back multiple
  //    levels deep cannot fully restore state deeper than what is
  //    still held in `_stack` (the actual Directory/Node object
  //    references for popped levels aren't cached for "redo"). This
  //    is a deliberate, minimal scope: the reported bug was about
  //    Back, and mobile users overwhelmingly do not use browser
  //    Forward. See _onLegalDirPopState()'s clamp for the safe
  //    fallback in that rare case (renders at the deepest level we
  //    can actually reconstruct, instead of crashing).
  // ================================================================

  function pushHistoryForDepth(depth) {
    try {
      if (global.history && typeof global.history.pushState === 'function') {
        global.history.pushState({ page: 'legalDirectories', legalDirDepth: depth }, '', '#legalDirectories');
      }
    } catch (e) { /* defensive — never break navigation */ }
  }

  /** @returns {boolean} true if a real back-navigation was requested (caller should NOT also render synchronously — the popstate listener will). */
  function goBackSteps(steps) {
    try {
      if (steps > 0 && global.history && typeof global.history.go === 'function') {
        global.history.go(-steps);
        return true;
      }
    } catch (e) { /* fall through to synchronous fallback */ }
    return false;
  }

  function pushDirectory(directory) {
    _stack.push({ kind: 'directory', directory: directory });
    pushHistoryForDepth(_stack.length);
    renderCurrentLevel();
  }

  function pushFolder(node) {
    var ancestorDirectory = _stack.length > 0 ? _stack[_stack.length - 1].directory : null;
    _stack.push({ kind: 'folder', node: node, directory: ancestorDirectory });
    pushHistoryForDepth(_stack.length);
    renderCurrentLevel();
  }

  function goToRoot() {
    if (goBackSteps(_stack.length)) return; // popstate listener will truncate + render
    _stack = [];
    renderCurrentLevel();
  }

  function goToDepth(index) {
    var targetDepth = index + 1;
    if (goBackSteps(_stack.length - targetDepth)) return; // popstate listener will truncate + render
    _stack = _stack.slice(0, targetDepth);
    renderCurrentLevel();
  }

  /**
   * Handles Back/Forward for this page's internal tree depth. Only
   * acts when the landed-on history state still belongs to this page
   * (page === 'legalDirectories') — anything else (the user backed
   * out of the page entirely) is left untouched for
   * js/core/shell/NavigationManager.js's own popstate handler to
   * process via navigate(), exactly as it already does for every
   * other page.
   */
  function onLegalDirPopState(event) {
    try {
      var state = event && event.state;
      if (state && state.page === 'legalDirectories') {
        var depth = (typeof state.legalDirDepth === 'number') ? state.legalDirDepth : 0;
        // Clamp: see KNOWN LIMITATION above — we cannot regrow past
        // what _stack currently holds (Forward beyond a Back further
        // than we cached), so render as deep as we actually can.
        _stack = _stack.slice(0, Math.min(depth, _stack.length));
        renderCurrentLevel();
      } else {
        // Left the page entirely (back past its root entry) — reset
        // so a future fresh visit starts at the root, not mid-tree.
        _stack = [];
      }
    } catch (e) { /* never break navigation */ }
  }

  if (global.window && typeof global.window.addEventListener === 'function') {
    global.window.addEventListener('popstate', onLegalDirPopState);
  }

  // ================================================================
  // 7. Entry point (called from navigate() dispatch, like renderX())
  // ================================================================

  function renderLegalDirectories() {
    loadDataset().then(function () { renderCurrentLevel(); });
    renderCurrentLevel();
  }

  // ================================================================
  // 8. Exports
  // ================================================================

  global.renderLegalDirectories = renderLegalDirectories;

  var api = {
    renderLegalDirectories: renderLegalDirectories,
    _resetForTests: function () {
      _dataset = null; _loadPromise = null; _loadError = null; _stack = []; _adminMode = false;
      if (global.LegalDirectoriesAdmin) global.LegalDirectoriesAdmin.discardDraft();
    },
    _isAdminModeForTests: function () { return _adminMode; },
    _toggleAdminModeForTests: toggleAdminMode,
    _simulatePopStateForTests: onLegalDirPopState,
    _stackDepthForTests: function () { return _stack.length; }
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  global.LegalDirectoriesModule = api;
})(typeof window !== 'undefined' ? window : (typeof global !== 'undefined' ? global : this));
