/**
 * ================================================================
 * js/modules/operations.js — صفحة سجل العمليات | نظام الحسام للمحاماة
 * ================================================================
 * Replaces js/modules/historypanel-ui.js's slide-over panel with a full,
 * regular page (#page-operations, same navigate('operations') pattern
 * as every other item in the sidebar) with two tabs:
 *
 *   1. "سجل النشاط الحقيقي" (default) — the REAL, persistent, works-for-
 *      every-account activity feed: who opened the program and for how
 *      long, every page they viewed and for how long, every login/
 *      logout, every case/client/client-portal they merely viewed, and
 *      every create/update/delete/restore on any of the 9 entities.
 *      Source of truth: js/core/rbac/ActivityRecorder.js's
 *      `HossamActivity.getFeed()`, itself backed by
 *      js/core/rbac/AuditLog.js's real IndexedDB storage (survives a
 *      refresh — unlike the old panel's in-memory-only UndoManager
 *      feed) and mirrored live to the 'سجل_العمليات' Google Sheet (see
 *      Config/00_Config.gs SHEET_DEFS) so the office owner can see it
 *      from any device, not just the browser the action happened in.
 *   2. "تراجع / إعادة" — the pre-existing Undo/Redo capability, UNCHANGED,
 *      still reading js/core/HistoryPanel.js's public
 *      getFeed()/jumpTo()/verbFor() API only (that file is not touched
 *      by this phase at all) — so no working feature is removed by this
 *      conversion, just relocated from a slide-over panel into this
 *      page's second tab.
 *
 * ACCESS CONTROL
 *   Gated by the existing RBAC permission catalog (js/core/rbac/
 *   Permissions.js) — no new permission key introduced. Visible to:
 *     - any office-wide role (office_owner/executive_manager/partner —
 *       see PermissionService.isOfficeWide()), or
 *     - any user explicitly granted CanViewAuditLog or CanViewLoginLog.
 *   Exactly like every other RBAC integration point in this project,
 *   this is fail-OPEN when RBAC/login isn't configured at all (no
 *   HossamSession / no current user) — a single-user office with no
 *   login screen enabled still sees its own operations log, unchanged
 *   from how every other page in this app behaves pre-login.
 *
 * REAL-TIME "RECORDING" SIDE (the other half of this phase)
 *   This file ALSO owns the small number of additive, non-invasive
 *   function wraps needed to observe real user behavior without
 *   touching cases.js/clients.js/index.html's navigate():
 *     - wraps `window.navigate` to log a "فتح_صفحة" entry (with real
 *       time-spent duration) every time the user leaves a page,
 *     - wraps `viewCase`/`viewClient`/`showClientPortal` to log "عرض"
 *       entries when staff open a case/client/client-portal,
 *     - listens for `visibilitychange`/`pagehide` to flush the
 *       currently-open page's duration (best-effort `sendBeacon`) so
 *       "أغلقه متى" is captured even on a hard tab close.
 *   Login/logout events themselves are recorded at their own canonical
 *   source (js/auth/LoginScreen.js and js/core/rbac/SessionContext.js
 *   `clear()`) — see those files' own small additions — not here.
 * ================================================================
 */
(function () {
  'use strict';

  // --------------------------------------------------------------
  // Small local helpers (each module file in this project keeps its
  // own copy rather than depending on load order of another module).
  // --------------------------------------------------------------
  function escapeHtmlLocal(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  var esc = (typeof window.escapeHtml === 'function') ? window.escapeHtml : escapeHtmlLocal;

  function relativeTime(iso) {
    if (!iso) return '';
    var diffMs = Date.now() - new Date(iso).getTime();
    var s = Math.floor(diffMs / 1000);
    if (s < 10) return 'الآن';
    if (s < 60) return 'منذ ' + s + ' ثانية';
    var m = Math.floor(s / 60);
    if (m < 60) return m === 1 ? 'منذ دقيقة' : 'منذ ' + m + ' دقائق';
    var h = Math.floor(m / 60);
    if (h < 24) return h === 1 ? 'منذ ساعة' : 'منذ ' + h + ' ساعات';
    var d = new Date(iso), now = new Date();
    if (d.toDateString() === now.toDateString()) return 'اليوم ' + d.toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' });
    var yest = new Date(now); yest.setDate(now.getDate() - 1);
    if (d.toDateString() === yest.toDateString()) return 'أمس ' + d.toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' });
    return d.toLocaleDateString('ar-EG') + ' ' + d.toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' });
  }

  var ACTION_ICON = {
    'تسجيل_دخول': '&#128274;', 'محاولة_دخول_فاشلة': '&#9888;', 'تسجيل_خروج': '&#128682;',
    'فتح_صفحة': '&#128204;', 'عرض': '&#128065;',
    'إنشاء': '&#10133;', 'تعديل': '&#9998;', 'حذف': '&#128465;', 'استرجاع': '&#9851;'
  };
  var ACTION_LABELS = {
    'تسجيل_دخول': 'تسجيل دخول', 'محاولة_دخول_فاشلة': 'محاولة دخول فاشلة', 'تسجيل_خروج': 'تسجيل خروج',
    'فتح_صفحة': 'فتح صفحة', 'عرض': 'عرض',
    'إنشاء': 'إنشاء', 'تعديل': 'تعديل', 'حذف': 'حذف', 'استرجاع': 'استرجاع'
  };
  var MODULE_LABELS = Object.assign(
    { auth: 'الدخول والخروج', clientMessages: 'رسائل الموكلين', users: 'المستخدمون' },
    (typeof PAGE_TITLES !== 'undefined') ? PAGE_TITLES : {}
  );

  // --------------------------------------------------------------
  // Access control
  // --------------------------------------------------------------
  function canViewOperations() {
    try {
      if (!window.HossamSession || typeof HossamSession.getCurrentUser !== 'function') return true; // RBAC not wired -> fail open
      var user = HossamSession.getCurrentUser();
      if (!user) return true; // no login configured yet -> fail open, same as the rest of the app
      if (!window.HossamPermissionService) return true;
      if (HossamPermissionService.isOfficeWide(user)) return true;
      return HossamPermissionService.can(user, 'CanViewAuditLog') || HossamPermissionService.can(user, 'CanViewLoginLog');
    } catch (e) {
      return true; // never let a guard error hide the page unexpectedly
    }
  }

  // --------------------------------------------------------------
  // Filter dropdowns (populated once from known action/module labels)
  // --------------------------------------------------------------
  var filtersBuilt = false;
  function buildFilterOptions() {
    if (filtersBuilt) return;
    filtersBuilt = true;
    var actionSel = document.getElementById('opsFilterAction');
    var moduleSel = document.getElementById('opsFilterModule');
    if (actionSel) {
      Object.keys(ACTION_LABELS).forEach(function (key) {
        var opt = document.createElement('option');
        opt.value = key; opt.textContent = ACTION_LABELS[key];
        actionSel.appendChild(opt);
      });
    }
    if (moduleSel) {
      Object.keys(MODULE_LABELS).forEach(function (key) {
        var opt = document.createElement('option');
        opt.value = key; opt.textContent = MODULE_LABELS[key];
        moduleSel.appendChild(opt);
      });
    }
  }

  // --------------------------------------------------------------
  // Row rendering
  // --------------------------------------------------------------
  function rowHtml(entry) {
    var action = entry.الإجراء || '';
    var icon = ACTION_ICON[action] || '&#128337;';
    var actionLabel = ACTION_LABELS[action] || action;
    var moduleLabel = MODULE_LABELS[entry.الوحدة] || entry.الوحدة || '';
    var duration = (entry.المدة_ثانية !== undefined && entry.المدة_ثانية !== null && window.HossamActivity)
      ? HossamActivity.humanDuration(entry.المدة_ثانية) : '';

    return (
      '<div class="ops-item" data-ops-action="' + esc(action) + '">' +
        '<div class="ops-item-icon">' + icon + '</div>' +
        '<div class="ops-item-body">' +
          '<div class="ops-item-top">' +
            '<span class="ops-item-badge">' + esc(actionLabel) + '</span>' +
            '<span class="ops-item-title">' + esc(entry.الوصف || actionLabel) + '</span>' +
            '<span class="ops-item-time" title="' + esc(entry.الوقت || '') + '">' + esc(relativeTime(entry.الوقت)) + '</span>' +
          '</div>' +
          '<div class="ops-item-meta">' +
            '<span>&#128100; ' + esc(entry.الاسم_الظاهر || 'غير معروف') + '</span>' +
            (moduleLabel ? '<span>&#128193; ' + esc(moduleLabel) + '</span>' : '') +
            (duration ? '<span>&#9201; ' + esc(duration) + '</span>' : '') +
          '</div>' +
        '</div>' +
      '</div>'
    );
  }

  // --------------------------------------------------------------
  // Main render (tab 1 — real activity)
  // --------------------------------------------------------------
  var renderToken = 0; // guards against an older async render finishing after a newer one started
  async function renderOperations() {
    var deniedEl = document.getElementById('opsDeniedState');
    var contentEl = document.getElementById('opsContent');
    if (!document.getElementById('page-operations')) return; // page markup not present -> nothing to do

    if (!canViewOperations()) {
      if (deniedEl) deniedEl.style.display = '';
      if (contentEl) contentEl.style.display = 'none';
      return;
    }
    if (deniedEl) deniedEl.style.display = 'none';
    if (contentEl) contentEl.style.display = '';

    buildFilterOptions();

    var listEl = document.getElementById('opsList');
    var emptyEl = document.getElementById('opsEmpty');
    if (!listEl || !window.HossamActivity) return;

    var myToken = ++renderToken;
    var filters = {
      action: (document.getElementById('opsFilterAction') || {}).value || '',
      moduleKey: (document.getElementById('opsFilterModule') || {}).value || '',
      query: (document.getElementById('opsSearchInput') || {}).value || ''
    };

    var feed;
    try {
      feed = await HossamActivity.getFeed(filters);
    } catch (e) {
      feed = [];
    }
    if (myToken !== renderToken) return; // a newer render superseded this one

    if (!feed.length) {
      listEl.innerHTML = '';
      if (emptyEl) emptyEl.style.display = '';
      updateOperationsBadge(0);
      return;
    }
    if (emptyEl) emptyEl.style.display = 'none';

    var MAX_ROWS = 300; // keep the DOM light — the persisted store itself is not truncated by this
    listEl.innerHTML = feed.slice(0, MAX_ROWS).map(rowHtml).join('');
    updateOperationsBadge(feed.filter(function (e) { return (Date.now() - new Date(e.الوقت).getTime()) < 24 * 3600 * 1000; }).length);
  }

  function updateOperationsBadge(count) {
    var badge = document.getElementById('badgeOperations');
    if (!badge) return;
    if (count > 0) { badge.textContent = count > 99 ? '99+' : String(count); badge.style.display = ''; }
    else { badge.style.display = 'none'; }
  }

  // --------------------------------------------------------------
  // Tab switching (activity <-> undo/redo)
  // --------------------------------------------------------------
  function switchOperationsTab(tab) {
    var tabsEl = document.getElementById('opsMainTabs');
    if (tabsEl) {
      tabsEl.querySelectorAll('.tab-btn').forEach(function (b) {
        b.classList.toggle('active', b.getAttribute('data-ops-tab') === tab);
      });
    }
    var actPane = document.getElementById('opsPaneActivity');
    var urPane = document.getElementById('opsPaneUndoRedo');
    if (actPane) actPane.style.display = (tab === 'activity') ? '' : 'none';
    if (urPane) urPane.style.display = (tab === 'undoredo') ? '' : 'none';
    if (tab === 'undoredo') renderOpsUndoRedo();
  }

  // --------------------------------------------------------------
  // Tab 2 — Undo/Redo (reuses js/core/HistoryPanel.js, unchanged)
  // --------------------------------------------------------------
  var opsUrFilter = 'all';
  var TYPE_LABEL_AR = { create: 'إنشاء', update: 'تعديل', delete: 'حذف', restore: 'استرجاع' };
  var MARKER_CLASS = { create: 'hp-marker-create', update: 'hp-marker-update', delete: 'hp-marker-delete', restore: 'hp-marker-restore' };

  function opsUrRowHtml(group, listKind) {
    var e = group.entity, anchor = group.anchor, isBulk = group.bulk, count = group.members.length;
    var verb = window.HistoryPanel.verbFor(group.type, listKind === 'redo');
    var label = anchor.isSnapshotArray ? 'تحديث جماعي' : (anchor.label || '—');
    var title = (isBulk || anchor.isSnapshotArray)
      ? (verb + ' ' + count + ' ' + e.plural)
      : (verb + ' ' + e.label + (label !== '—' ? (': ' + label) : ''));
    var jumpLabel = listKind === 'redo' ? 'إعادة' : 'تراجع';
    var markerClass = isBulk ? 'hp-marker-bulk' : (MARKER_CLASS[group.type] || '');
    return (
      '<div class="hp-row">' +
        '<div class="hp-row-marker"><span class="hp-marker-dot ' + markerClass + '">' + e.icon + '</span></div>' +
        '<div class="hp-row-content">' +
          '<div class="hp-row-top">' +
            '<span class="hp-badge">' + esc(TYPE_LABEL_AR[group.type] || group.type) + '</span>' +
            '<span class="hp-entity-badge">' + esc(e.plural) + '</span>' +
            '<span class="hp-row-time">' + esc(relativeTime(anchor.timestamp)) + '</span>' +
          '</div>' +
          '<div class="hp-row-title">' + esc(title) + '</div>' +
          '<div class="hp-row-actions">' +
            '<button type="button" class="btn btn-ghost btn-sm hp-jump-btn" data-ops-jump="' + listKind + '" data-ops-entity="' + esc(e.key) + '" data-ops-ts="' + esc(anchor.timestamp) + '">' + jumpLabel + '</button>' +
          '</div>' +
        '</div>' +
      '</div>'
    );
  }

  function renderOpsUndoRedo() {
    if (!window.HistoryPanel) return;
    var feed = HistoryPanel.getFeed();
    var listEl = document.getElementById('opsUrList');
    var limitsEl = document.getElementById('opsUrLimits');
    var undoCountEl = document.getElementById('opsUndoCount');
    var redoCountEl = document.getElementById('opsRedoCount');
    if (undoCountEl) undoCountEl.textContent = String(feed.counts.undo);
    if (redoCountEl) redoCountEl.textContent = String(feed.counts.redo);
    if (limitsEl) {
      var used = feed.limits.reduce(function (s, l) { return s + l.used; }, 0);
      var max = feed.limits.reduce(function (s, l) { return s + (l.max || 0); }, 0);
      limitsEl.textContent = 'السجل ' + used + ' / ' + max;
    }

    var groups = (opsUrFilter === 'all') ? feed.undo
      : (opsUrFilter === 'redo') ? feed.redo
      : (opsUrFilter === 'undo') ? feed.undo
      : feed.undo.filter(function (g) { return g.entity.key === opsUrFilter; });

    if (!listEl) return;
    if (!groups.length) {
      listEl.innerHTML = '<div class="empty-state empty-container" style="padding:24px 10px;"><div class="icon">&#128337;</div><h3>لا يوجد شيء للتراجع عنه بعد</h3></div>';
      return;
    }
    listEl.innerHTML = groups.map(function (g) { return opsUrRowHtml(g, opsUrFilter === 'redo' ? 'redo' : 'undo'); }).join('');
  }

  function wireOpsUrTabs() {
    var tabsEl = document.getElementById('opsUrTabs');
    if (!tabsEl) return;
    tabsEl.addEventListener('click', function (ev) {
      var tab = ev.target.closest('.hp-tab');
      if (!tab) return;
      tabsEl.querySelectorAll('.hp-tab').forEach(function (t) { t.classList.remove('active'); t.setAttribute('aria-selected', 'false'); });
      tab.classList.add('active'); tab.setAttribute('aria-selected', 'true');
      opsUrFilter = tab.getAttribute('data-hp-filter');
      renderOpsUndoRedo();
    });
    var listEl = document.getElementById('opsUrList');
    if (listEl) {
      listEl.addEventListener('click', function (ev) {
        var btn = ev.target.closest('[data-ops-jump]');
        if (!btn || !window.HistoryPanel) return;
        var direction = btn.getAttribute('data-ops-jump');
        var entityKey = btn.getAttribute('data-ops-entity');
        var ts = btn.getAttribute('data-ops-ts');
        var feed = HistoryPanel.getFeed();
        var pool = direction === 'redo' ? feed.redo : feed.undo;
        var group = pool.filter(function (g) { return g.entity.key === entityKey && g.anchor.timestamp === ts; })[0];
        if (!group) return;
        btn.disabled = true;
        HistoryPanel.jumpTo(group, direction).then(function (result) {
          btn.disabled = false;
          if (window.toast) toast(result.success ? 'تم التنفيذ' : ('تعذر التنفيذ: ' + (result.error || '')), result.success ? 'success' : 'error');
          renderOpsUndoRedo();
          renderOperations();
        });
      });
    }
  }

  // --------------------------------------------------------------
  // REAL-TIME RECORDING — page-view duration
  // --------------------------------------------------------------
  var pageVisitStartedAt = null;
  var pageVisitKey = null;

  function flushCurrentPageVisit(beacon) {
    if (!pageVisitKey || !pageVisitStartedAt || !window.HossamActivity) return;
    var durationMs = Date.now() - pageVisitStartedAt;
    var title = (typeof PAGE_TITLES !== 'undefined' && PAGE_TITLES[pageVisitKey]) ? PAGE_TITLES[pageVisitKey] : pageVisitKey;
    HossamActivity.recordPageVisit(pageVisitKey, title, durationMs, { beacon: !!beacon });
    pageVisitKey = null; pageVisitStartedAt = null;
  }

  function beginPageVisit(pageKey) {
    pageVisitKey = pageKey;
    pageVisitStartedAt = Date.now();
  }

  function wireNavigationTracking() {
    var original = window.navigate;
    if (typeof original !== 'function' || original.__opsWrapped) return;
    var wrapped = function (page) {
      flushCurrentPageVisit(false);
      var result = original.apply(this, arguments);
      beginPageVisit(page);
      return result;
    };
    wrapped.__opsWrapped = true;
    window.navigate = wrapped;
    // The very first page (dashboard, active by default before any
    // navigate() call ever fires) needs its own start timestamp too,
    // or its visit duration would silently never be recorded.
    beginPageVisit((typeof currentPage !== 'undefined' && currentPage) ? currentPage : 'dashboard');
  }

  function wireVisibilityTracking() {
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'hidden') flushCurrentPageVisit(true);
      else beginPageVisit(pageVisitKey || (typeof currentPage !== 'undefined' ? currentPage : 'dashboard'));
    });
    window.addEventListener('pagehide', function () { flushCurrentPageVisit(true); });
  }

  // --------------------------------------------------------------
  // REAL-TIME RECORDING — viewing a case / client / client portal
  // --------------------------------------------------------------
  function wireViewTracking() {
    var wrap = function (name, moduleKey, targetType, resolveLabel) {
      var original = window[name];
      if (typeof original !== 'function' || original.__opsViewWrapped) return;
      var wrapped = function () {
        var result = original.apply(this, arguments);
        try {
          if (window.HossamActivity) {
            var label = resolveLabel.apply(this, arguments);
            var idArg = arguments[0];
            HossamActivity.recordView(moduleKey, targetType, idArg, label);
          }
        } catch (e) { /* never break the original view action */ }
        return result;
      };
      wrapped.__opsViewWrapped = true;
      window[name] = wrapped;
    };

    wrap('viewCase', 'cases', 'قضية', function (i) {
      var c = (typeof data !== 'undefined' && data.cases) ? data.cases[i] : null;
      return c ? (c['عنوان_القضية'] || c['رقم_القضية'] || '') : '';
    });
    wrap('viewClient', 'clients', 'موكل', function (i) {
      var c = (typeof data !== 'undefined' && data.clients) ? data.clients[i] : null;
      return c ? (c['الاسم'] || '') : '';
    });
    wrap('showClientPortal', 'clients', 'بوابة موكل', function () {
      var c = window._currentViewClient;
      return c ? (c['الاسم'] || '') : '';
    });
  }

  // --------------------------------------------------------------
  // Boot wiring
  // --------------------------------------------------------------
  document.addEventListener('DOMContentLoaded', function () {
    wireNavigationTracking();
    wireVisibilityTracking();
    wireViewTracking();
    wireOpsUrTabs();
    var searchEl = document.getElementById('opsSearchInput');
    if (searchEl) {
      var debounceId = null;
      searchEl.addEventListener('input', function () {
        clearTimeout(debounceId);
        debounceId = setTimeout(renderOperations, 180);
      });
    }
    // Keep the sidebar badge fresh even while the user is on another
    // page, same "always visible" spirit as every other nav badge in
    // this app (badgeCases/badgeClients/...).
    setInterval(function () {
      var page = (typeof currentPage !== 'undefined') ? currentPage : null;
      if (page !== 'operations' && window.HossamActivity && canViewOperations()) {
        HossamActivity.getFeed({}).then(function (feed) {
          updateOperationsBadge(feed.filter(function (e) { return (Date.now() - new Date(e.الوقت).getTime()) < 24 * 3600 * 1000; }).length);
        }).catch(function () {});
      }
    }, 120000);
  });

  window.renderOperations = renderOperations;
  window.switchOperationsTab = switchOperationsTab;
})();
