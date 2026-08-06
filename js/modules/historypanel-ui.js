/**
 * ================================================================
 * js/modules/historypanel-ui.js — History Panel UI | نظام الحسام للمحاماة
 * ================================================================
 * PHASE 12.6A — History Panel UI Completion
 * PHASE 12.6B — History Timeline Professional Polish + Mobile Sync
 *   Status Completion. UI-only polish pass on top of 12.6A's already-
 *   working feed/search/tabs/badge/incremental-render foundation:
 *     - visual timeline (connector + icon markers) instead of a flat list
 *     - expandable "عرض التفاصيل" row detail (Before -> After / bulk
 *       member breakdown), reading the `before`/`after` fields
 *       js/core/HistoryPanel.js now also passes through
 *     - staggered fade-in row entrance, hover lift, no bounce
 *     - richer empty state copy (unchanged trigger conditions)
 *   Still consumes js/core/HistoryPanel.js's public API only
 *   (getFeed()/jumpTo()/verbFor()/typeLabel()) — that file is touched in
 *   this phase ONLY to surface `before`/`after` (see its own header);
 *   grouping/search/tab/incremental-render logic below is unchanged.
 *
 * Renders the merged feed produced by js/core/HistoryPanel.js (UNCHANGED
 * in this phase — this file only consumes its existing public API:
 * getFeed()/jumpTo()/verbFor(); it never touches HistoryPanel.js,
 * UndoManager.js, UndoReconciler.js, Repository.js, or any
 * js/repositories/*.js / entity module file) into the #historyPanel
 * markup, and completes the UI-only gaps identified by the independent
 * Phase 12.6 audit:
 *   - live, instant search across every visible field
 *   - filter tabs (per-entity + Undo/Redo), reusing already-fetched data
 *   - a live counter badge on the always-visible TopBar button
 *   - keyed incremental DOM rendering (create/move/patch — no more
 *     innerHTML full rebuild of the list on every refresh)
 *   - right-side slide-in panel (RTL-correct, matches the Sidebar
 *     convention already used elsewhere in this app)
 *   - richer empty state, per-row entity badge, Arabic operation labels
 *   - keyboard accessibility (Escape to close, focus management, ARIA)
 *
 * LIVE UPDATES WITHOUT TOUCHING ANY OF THE 9 MODULE FILES
 *   Unchanged from Phase 12.6: this file (loaded LAST, after every
 *   module script — see index.html) wraps each already-exported global
 *   entry point (saveCase/deleteCase/restoreCase/undoLastCaseAction/
 *   redoLastCaseAction, and the same 5 for every other entity — 45
 *   functions total) so that after the ORIGINAL function has finished
 *   (success or failure, via try/finally) the panel refreshes its
 *   TopBar badge always, and its full body only if it is currently
 *   open. This is the only "hook" mechanism this phase uses; it
 *   changes zero bytes of any pre-existing module file, and a wrapped
 *   function's return value/thrown error is passed through unchanged.
 * ================================================================
 */
(function () {
  'use strict';

  var WRAPPED_ENTITY_FUNCS = [
    'saveCase', 'deleteCase', 'restoreCase', 'undoLastCaseAction', 'redoLastCaseAction',
    'saveClient', 'deleteClient', 'restoreClient', 'undoLastClientAction', 'redoLastClientAction',
    'saveChild', 'deleteChild', 'restoreChild', 'undoLastChildAction', 'redoLastChildAction',
    'saveSession', 'deleteSession', 'restoreSession', 'undoLastSessionAction', 'redoLastSessionAction',
    'saveTask', 'deleteTask', 'restoreTask', 'undoLastTaskAction', 'redoLastTaskAction',
    'saveFee', 'deleteFee', 'restoreFee', 'undoLastFeeAction', 'redoLastFeeAction',
    'saveDocument', 'deleteDocument', 'restoreDocument', 'undoLastDocumentAction', 'redoLastDocumentAction',
    'saveLibBook', 'deleteLibBook', 'restoreLibBook', 'undoLastLibBookAction', 'redoLastLibBookAction',
    'saveTemplate', 'deleteTemplate', 'restoreTemplate', 'undoLastTemplateAction', 'redoLastTemplateAction'
  ];

  function afterEntityAction() {
    updateTopbarBadge();
    var panel = document.getElementById('historyPanel');
    if (panel && panel.classList.contains('open')) renderHistoryPanel();
  }

  function wireLiveRefresh() {
    WRAPPED_ENTITY_FUNCS.forEach(function (name) {
      var original = window[name];
      if (typeof original !== 'function' || original.__historyWrapped) return;
      var wrapped = function () {
        var result = original.apply(this, arguments);
        if (result && typeof result.then === 'function') {
          return result.finally(function () { afterEntityAction(); });
        }
        afterEntityAction();
        return result;
      };
      wrapped.__historyWrapped = true;
      window[name] = wrapped;
    });
  }

  // --------------------------------------------------------------
  // Relative time (نسبى)
  // --------------------------------------------------------------
  function relativeTime(iso) {
    var diffMs = Date.now() - new Date(iso).getTime();
    var s = Math.floor(diffMs / 1000);
    if (s < 10) return 'الآن';
    if (s < 60) return 'منذ ' + s + ' ثانية';
    var m = Math.floor(s / 60);
    if (m < 60) return m === 1 ? 'منذ دقيقة' : 'منذ ' + m + ' دقائق';
    var h = Math.floor(m / 60);
    if (h < 24) return h === 1 ? 'منذ ساعة' : 'منذ ' + h + ' ساعات';
    var d = new Date(iso);
    var now = new Date();
    var isToday = d.toDateString() === now.toDateString();
    if (isToday) return 'اليوم ' + d.toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' });
    var yesterday = new Date(now); yesterday.setDate(now.getDate() - 1);
    if (d.toDateString() === yesterday.toDateString()) return 'أمس ' + d.toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' });
    return d.toLocaleDateString('ar-EG') + ' ' + d.toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' });
  }

  function absoluteDateText(iso) {
    var d = new Date(iso);
    return d.toLocaleDateString('ar-EG') + ' ' + d.toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' });
  }

  var BADGE_CLASS = { create: 'hp-badge-create', update: 'hp-badge-update', delete: 'hp-badge-delete', restore: 'hp-badge-restore' };
  // PHASE 12.6B — icon marker color per §6: Create=green, Update=blue,
  // Delete=red, Restore=orange, Bulk=purple (overrides the row's base
  // type color once >= BULK_MIN_COUNT), Undo-list rows=indigo accent,
  // Redo-list rows=teal accent. Purely presentational (icon circle
  // background + row's timeline connector color) — never affects which
  // badge class buildRows()/matchesFilter() key off of.
  var MARKER_CLASS = { create: 'hp-marker-create', update: 'hp-marker-update', delete: 'hp-marker-delete', restore: 'hp-marker-restore' };
  // Arabic operation-type labels for on-screen display only — purely a
  // presentation choice made in this file; js/core/HistoryPanel.js's own
  // typeLabel()/verbFor() API is untouched and still used for the verb
  // phrase ("تم إنشاء" / "تم التراجع عن حذف" ...).
  var TYPE_LABEL_AR = { create: 'إنشاء', update: 'تعديل', delete: 'حذف', restore: 'استرجاع' };

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function cssEscapeAttr(s) {
    return String(s).replace(/["\\]/g, '\\$&');
  }

  // --------------------------------------------------------------
  // Row model — one entry per (group, listKind). `key` is stable across
  // re-renders as long as the underlying group is unchanged, which is
  // what makes incremental (create/move/patch, not full rebuild) DOM
  // updates possible in diffRender() below.
  // --------------------------------------------------------------
  function rowKey(group, listKind) {
    return listKind + ':' + group.entity.key + ':' + group.type + ':' +
      group.anchor.timestamp + ':' + (group.bulk ? ('bulk' + group.members.length) : 'single');
  }

  function rowContent(group, listKind) {
    var e = group.entity;
    var anchor = group.anchor;
    var isBulk = group.bulk;
    var count = group.members.length;
    var badgeClass = BADGE_CLASS[group.type] || '';
    var verb = window.HistoryPanel.verbFor(group.type, listKind === 'redo');
    var bulkIcon = group.type === 'delete' ? '🗑' : e.icon;
    var title = isBulk
      ? (bulkIcon + ' ' + verb + ' جماعي — ' + count + ' ' + e.plural)
      : (e.icon + ' ' + verb + ' ' + e.label + (anchor.label ? (' — ' + anchor.label) : ''));
    var relTime = relativeTime(anchor.timestamp);
    var absTime = absoluteDateText(anchor.timestamp);
    var sub = isBulk ? (count + ' عنصر • ' + relTime) : relTime;
    var actionLabel = listKind === 'redo' ? 'إعادة إلى هنا' : 'العودة إلى هنا';
    var typeAr = TYPE_LABEL_AR[group.type] || group.type;

    // Everything a user might plausibly type into Search, lower-cased.
    var searchBlob = [
      title, sub, typeAr, e.label, e.plural, actionLabel, relTime, absTime,
      anchor.label || '', anchor.record ? JSON.stringify(anchor.record) : ''
    ].join(' ').toLowerCase();

    var markerClass = (isBulk ? 'hp-marker-bulk' : (MARKER_CLASS[group.type] || 'hp-marker-update'));
    var listAccentClass = listKind === 'redo' ? 'hp-list-redo' : 'hp-list-undo';
    var markerIcon = isBulk ? '🗑' : { create: '➕', update: '✎', delete: '🗑', restore: '↺' }[group.type] || e.icon;

    return {
      badgeClass: badgeClass, typeAr: typeAr, title: title, sub: sub,
      actionLabel: actionLabel, entityLabel: e.label, entityIcon: e.icon,
      searchBlob: searchBlob, markerClass: markerClass, markerIcon: markerIcon,
      listAccentClass: listAccentClass
    };
  }

  // --------------------------------------------------------------
  // Expandable detail ("عرض التفاصيل") — Before -> After for a single
  // entry, or a member breakdown for a bulk group. Reads only the
  // `before`/`after`/`record` fields js/core/HistoryPanel.js's getFeed()
  // already exposes on every anchor/member — never re-derives or fetches
  // anything from a Repository itself.
  // --------------------------------------------------------------
  function fieldEntries(rec) {
    if (!rec) return [];
    return Object.keys(rec).filter(function (k) {
      var v = rec[k];
      return v !== undefined && v !== null && String(v).trim() !== '' && typeof v !== 'object';
    });
  }

  function diffFields(before, after) {
    var keys = {};
    fieldEntries(before).forEach(function (k) { keys[k] = 1; });
    fieldEntries(after).forEach(function (k) { keys[k] = 1; });
    var changed = [];
    Object.keys(keys).forEach(function (k) {
      var a = before ? before[k] : undefined;
      var b = after ? after[k] : undefined;
      if (String(a == null ? '' : a) !== String(b == null ? '' : b)) changed.push({ field: k, before: a, after: b });
    });
    return changed;
  }

  function recordFieldsHtml(rec) {
    var keys = fieldEntries(rec).slice(0, 10);
    if (!keys.length) return '<div class="hp-details-empty-note">لا توجد بيانات إضافية مسجلة.</div>';
    return '<div class="hp-detail-fields">' + keys.map(function (k) {
      return '<div class="hp-detail-field-row"><span class="hp-detail-field-key">' + escapeHtml(k) + '</span>' +
        '<span class="hp-detail-field-val">' + escapeHtml(String(rec[k])) + '</span></div>';
    }).join('') + '</div>';
  }

  function metaBlockHtml(group) {
    var a = group.anchor;
    return '<div class="hp-detail-meta">' +
      '<div class="hp-detail-meta-row"><span class="hp-detail-meta-key">السجل</span><span>' + escapeHtml(a.label || '—') + '</span></div>' +
      '<div class="hp-detail-meta-row"><span class="hp-detail-meta-key">الكيان</span><span>' + escapeHtml(group.entity.label) + '</span></div>' +
      '<div class="hp-detail-meta-row"><span class="hp-detail-meta-key">نوع العملية</span><span>' + escapeHtml(TYPE_LABEL_AR[group.type] || group.type) + '</span></div>' +
      '<div class="hp-detail-meta-row"><span class="hp-detail-meta-key">التاريخ</span><span>' + escapeHtml(absoluteDateText(a.timestamp)) + '</span></div>' +
    '</div>';
  }

  function detailsHtml(group) {
    if (group.bulk) {
      var members = group.members.map(function (m) {
        return '<div class="hp-detail-member">' +
          '<span class="hp-detail-member-label">' + escapeHtml(m.label || String(m.idx + 1)) + '</span>' +
          '<span class="hp-detail-member-time">' + escapeHtml(relativeTime(m.timestamp)) + '</span></div>';
      }).join('');
      return '<div class="hp-details-inner">' + metaBlockHtml(group) +
        '<div class="hp-details-section-title">العناصر (' + group.members.length + ')</div>' +
        '<div class="hp-detail-members">' + members + '</div></div>';
    }

    var a = group.anchor;
    var body = '';
    if (group.type === 'update') {
      var changed = diffFields(a.before, a.after);
      body = changed.length
        ? '<div class="hp-details-section-title">الحقول التى تغيرت</div><div class="hp-detail-diff">' +
          changed.map(function (c) {
            return '<div class="hp-diff-row"><span class="hp-diff-field">' + escapeHtml(c.field) + '</span>' +
              '<span class="hp-diff-before">' + escapeHtml(c.before == null || c.before === '' ? '—' : String(c.before)) + '</span>' +
              '<span class="hp-diff-arrow" aria-hidden="true">&#8592;</span>' +
              '<span class="hp-diff-after">' + escapeHtml(c.after == null || c.after === '' ? '—' : String(c.after)) + '</span></div>';
          }).join('') + '</div>'
        : '<div class="hp-details-empty-note">لا توجد حقول متغيرة مسجلة لهذه العملية.</div>';
    } else if (group.type === 'delete') {
      body = '<div class="hp-details-section-title">بيانات السجل قبل الحذف</div>' + recordFieldsHtml(a.before);
    } else if (group.type === 'create') {
      body = '<div class="hp-details-section-title">بيانات السجل</div>' + recordFieldsHtml(a.after);
    } else if (group.type === 'restore') {
      body = '<div class="hp-details-section-title">بيانات السجل بعد الاسترجاع</div>' + recordFieldsHtml(a.after || a.before);
    }
    return '<div class="hp-details-inner">' + metaBlockHtml(group) + body + '</div>';
  }

  function buildRows(feed) {
    var rows = [];
    feed.undo.forEach(function (g) { rows.push({ group: g, listKind: 'undo', key: rowKey(g, 'undo') }); });
    feed.redo.forEach(function (g) { rows.push({ group: g, listKind: 'redo', key: rowKey(g, 'redo') }); });
    return rows;
  }

  function matchesFilter(row, filter) {
    if (filter === 'all') return true;
    if (filter === 'undo' || filter === 'redo') return row.listKind === filter;
    return row.group.entity.key === filter;
  }

  function matchesQuery(row, query, cache) {
    if (!query) return true;
    var c = cache[row.key] || (cache[row.key] = rowContent(row.group, row.listKind));
    return c.searchBlob.indexOf(query) !== -1;
  }

  // --------------------------------------------------------------
  // Empty state
  // --------------------------------------------------------------
  function emptyIllustrationSvg() {
    // PHASE 12.6B §11 — small inline "legal" illustration (a simple
    // document + scale motif) replacing the old single emoji icon for
    // the default (no filter, no query) empty state only. Kept as
    // static inline SVG using currentColor so it follows the panel's
    // existing color variables without any new asset/network request.
    return '<svg class="hp-empty-illustration" viewBox="0 0 64 64" width="64" height="64" aria-hidden="true">' +
      '<rect x="16" y="8" width="26" height="34" rx="2" fill="none" stroke="currentColor" stroke-width="2"/>' +
      '<line x1="21" y1="16" x2="37" y2="16" stroke="currentColor" stroke-width="2"/>' +
      '<line x1="21" y1="22" x2="37" y2="22" stroke="currentColor" stroke-width="2"/>' +
      '<line x1="21" y1="28" x2="31" y2="28" stroke="currentColor" stroke-width="2"/>' +
      '<line x1="29" y1="42" x2="29" y2="50" stroke="currentColor" stroke-width="2"/>' +
      '<line x1="20" y1="50" x2="38" y2="50" stroke="currentColor" stroke-width="2"/>' +
      '<line x1="16" y1="46" x2="16" y2="50" stroke="currentColor" stroke-width="2"/>' +
      '<line x1="42" y1="46" x2="42" y2="50" stroke="currentColor" stroke-width="2"/>' +
      '<path d="M10 46 L16 34 L22 46 Z" fill="none" stroke="currentColor" stroke-width="2"/>' +
      '<path d="M36 46 L42 34 L48 46 Z" fill="none" stroke="currentColor" stroke-width="2"/>' +
    '</svg>';
  }

  function emptyStateHtml(filter, query) {
    var title, sub, icon = null;
    if (query) {
      title = 'لا توجد نتائج';
      sub = 'لم يتم العثور على أى عملية تطابق "' + escapeHtml(query) + '".';
      icon = '🔎';
    } else if (filter !== 'all' && filter !== 'undo' && filter !== 'redo') {
      title = 'لا توجد عمليات لهذا القسم';
      sub = 'سيظهر هنا سجل التعديلات الخاصة بهذا النوع من السجلات عند إجرائها.';
      icon = '🕘';
    } else if (filter === 'redo') {
      title = 'لا توجد عمليات لإعادتها';
      sub = 'العمليات التى تقوم بالتراجع عنها ستظهر هنا لإمكانية إعادتها.';
      icon = '🕘';
    } else {
      title = 'لا توجد عمليات حتى الآن';
      sub = 'سيظهر هنا سجل كامل لجميع التعديلات التى تقوم بها داخل البرنامج.<br>ابدأ بإضافة موكل أو قضية ليبدأ السجل تلقائياً.';
    }
    var iconHtml = icon
      ? '<div class="hp-empty-icon">' + icon + '</div>'
      : emptyIllustrationSvg();
    return '<div class="hp-empty">' +
      iconHtml +
      '<div class="hp-empty-title">' + escapeHtml(title) + '</div>' +
      '<div class="hp-empty-sub">' + sub + '</div>' +
    '</div>';
  }

  // --------------------------------------------------------------
  // Row DOM element (create once per key; patched afterwards, never
  // fully rebuilt while its key is still present in the feed).
  // --------------------------------------------------------------
  function buildRowElement(row) {
    var c = rowContent(row.group, row.listKind);
    var el = document.createElement('div');
    el.className = 'hp-row ' + c.listAccentClass;
    el.setAttribute('data-key', row.key);
    el.setAttribute('data-entity', row.group.entity.key);
    el.setAttribute('data-list', row.listKind);
    var detailsId = 'hpd-' + Math.random().toString(36).slice(2, 9);
    el.innerHTML =
      '<div class="hp-row-marker"><span class="hp-marker-dot ' + c.markerClass + '">' + c.markerIcon + '</span></div>' +
      '<div class="hp-row-content">' +
        '<div class="hp-row-top">' +
          '<span class="hp-badge ' + c.badgeClass + '">' + escapeHtml(c.typeAr) + '</span>' +
          '<span class="hp-entity-badge">' + c.entityIcon + ' ' + escapeHtml(c.entityLabel) + '</span>' +
          '<span class="hp-row-time">' + escapeHtml(c.sub) + '</span>' +
        '</div>' +
        '<div class="hp-row-title">' + escapeHtml(c.title) + '</div>' +
        '<div class="hp-row-actions">' +
          '<button type="button" class="hp-expand-btn" aria-expanded="false" aria-controls="' + detailsId + '">عرض التفاصيل</button>' +
          '<button type="button" class="btn btn-ghost btn-sm hp-jump-btn" aria-label="' + escapeHtml(c.actionLabel) + '">' + escapeHtml(c.actionLabel) + '</button>' +
        '</div>' +
        '<div class="hp-details" id="' + detailsId + '" hidden></div>' +
      '</div>';
    el.__hpLastSub = c.sub;
    el.__hpLastTitle = c.title;
    el.__hpDetailsBuilt = false;
    return el;
  }

  /** Patches only the parts of an existing row that can legitimately
   *  change between renders without the key itself changing — right
   *  now that's just the relative-time text (everything else that
   *  could change, e.g. bulk member count, is already folded into the
   *  key, so a real content change naturally becomes a create+remove
   *  instead of silently going stale). */
  function patchRowElement(el, row) {
    var c = rowContent(row.group, row.listKind);
    if (el.__hpLastSub !== c.sub) {
      var subEl = el.querySelector('.hp-row-time');
      if (subEl) subEl.textContent = c.sub;
      el.__hpLastSub = c.sub;
    }
    if (el.__hpLastTitle !== c.title) {
      var titleEl = el.querySelector('.hp-row-title');
      if (titleEl) titleEl.textContent = c.title;
      el.__hpLastTitle = c.title;
    }
  }

  /** Keyed incremental reconciliation: removes rows no longer present,
   *  patches rows still present, creates rows that are new, and moves
   *  elements only when their relative order actually changed. Never
   *  does `list.innerHTML = ...` for the row set itself. */
  function diffRender(container, rows) {
    var existingEls = Array.prototype.slice.call(container.children);
    var wantedKeys = {};
    rows.forEach(function (r) { wantedKeys[r.key] = true; });

    existingEls.forEach(function (el) {
      if (!wantedKeys[el.getAttribute('data-key')]) el.remove();
    });

    var prevEl = null;
    rows.forEach(function (row, i) {
      var el = container.querySelector('[data-key="' + cssEscapeAttr(row.key) + '"]');
      if (!el) {
        el = buildRowElement(row);
        // PHASE 12.6B §10 — staggered fade-in, newly created rows only
        // (rows already present just get patched/moved, no re-animation).
        el.style.setProperty('--hp-row-delay', Math.min(i, 12) * 28 + 'ms');
        el.classList.add('hp-row-enter');
      } else {
        patchRowElement(el, row);
      }
      jumpMap[row.key] = { group: row.group, direction: row.listKind };
      var desiredNext = prevEl ? prevEl.nextSibling : container.firstChild;
      if (desiredNext !== el) container.insertBefore(el, desiredNext);
      prevEl = el;
    });
  }

  // --------------------------------------------------------------
  // State
  // --------------------------------------------------------------
  var currentFilter = 'all';
  var currentQuery = '';
  var jumpMap = {}; // key -> {group, direction}

  function updateTopbarBadge(feedMaybe) {
    var badgeEl = document.getElementById('hpTopbarBadge');
    if (!badgeEl || !window.HistoryPanel) return;
    var feed = feedMaybe || window.HistoryPanel.getFeed();
    var n = feed.counts.undo;
    if (n > 0) {
      badgeEl.textContent = n > 99 ? '99+' : String(n);
      badgeEl.style.display = '';
    } else {
      badgeEl.style.display = 'none';
    }
  }

  function renderHistoryPanel() {
    if (!window.HistoryPanel) return;
    var feed = window.HistoryPanel.getFeed();
    updateTopbarBadge(feed);

    var undoCountEl = document.getElementById('hpUndoCount');
    var redoCountEl = document.getElementById('hpRedoCount');
    if (undoCountEl) undoCountEl.textContent = feed.counts.undo;
    if (redoCountEl) redoCountEl.textContent = feed.counts.redo;

    var limitsEl = document.getElementById('hpLimits');
    if (limitsEl) {
      var wired = feed.limits.filter(function (l) { return l.wired; });
      var totalUsed = wired.reduce(function (s, l) { return s + l.used; }, 0);
      var totalMax = wired.reduce(function (s, l) { return s + (l.max || 0); }, 0);
      limitsEl.textContent = 'السجل ' + totalUsed + ' / ' + totalMax + ' (لكل نوع سجل مستقل بحد ' + (wired[0] ? wired[0].max : 50) + ')';
    }

    var allRows = buildRows(feed);
    var queryCache = {};
    var q = currentQuery;
    var filtered = allRows.filter(function (r) {
      return matchesFilter(r, currentFilter) && matchesQuery(r, q, queryCache);
    });

    var listEl = document.getElementById('hpList');
    if (!listEl) return;

    if (!filtered.length) {
      listEl.innerHTML = emptyStateHtml(currentFilter, currentQuery);
      listEl.setAttribute('data-empty', '1');
      jumpMap = {};
      return;
    }
    if (listEl.getAttribute('data-empty') === '1') {
      listEl.innerHTML = '';
      listEl.removeAttribute('data-empty');
    }
    diffRender(listEl, filtered);
  }

  async function handlePanelClick(ev) {
    var expandBtn = ev.target.closest('.hp-expand-btn');
    if (expandBtn) {
      var rowEl = expandBtn.closest('[data-key]');
      var detailsEl = rowEl && rowEl.querySelector('.hp-details');
      if (!detailsEl) return;
      var willOpen = detailsEl.hasAttribute('hidden');
      if (willOpen) {
        var key = rowEl.getAttribute('data-key');
        var target = jumpMap[key];
        if (target && !rowEl.__hpDetailsBuilt) {
          detailsEl.innerHTML = detailsHtml(target.group);
          rowEl.__hpDetailsBuilt = true;
        }
        detailsEl.removeAttribute('hidden');
        expandBtn.setAttribute('aria-expanded', 'true');
        expandBtn.textContent = 'إخفاء التفاصيل';
      } else {
        detailsEl.setAttribute('hidden', '');
        expandBtn.setAttribute('aria-expanded', 'false');
        expandBtn.textContent = 'عرض التفاصيل';
      }
      return;
    }
    var jumpBtn = ev.target.closest('.hp-jump-btn');
    if (jumpBtn) {
      var row = jumpBtn.closest('[data-key]');
      var key = row && row.getAttribute('data-key');
      var target = key && jumpMap[key];
      if (!target) return;
      jumpBtn.disabled = true;
      var prevText = jumpBtn.textContent;
      jumpBtn.textContent = '...جارٍ التنفيذ';
      var res = await window.HistoryPanel.jumpTo(target.group, target.direction);
      jumpBtn.disabled = false;
      jumpBtn.textContent = prevText;
      if (res.success) {
        if (typeof toast === 'function') toast(target.direction === 'undo' ? 'تم التراجع' : 'تمت الإعادة', 'success');
      } else if (typeof toast === 'function') {
        toast('تعذر تنفيذ العملية: ' + (res.error || ''), 'error');
      }
      renderHistoryPanel();
      return;
    }
  }

  // --------------------------------------------------------------
  // Tabs (entity filters + Undo/Redo) — reuses whatever getFeed()
  // already returned; never re-fetches or recomputes underlying data.
  // --------------------------------------------------------------
  function setActiveTab(tabEl) {
    var tabs = document.querySelectorAll('#hpTabs .hp-tab');
    tabs.forEach(function (t) {
      t.classList.remove('active');
      t.setAttribute('aria-selected', 'false');
      t.setAttribute('tabindex', '-1');
    });
    tabEl.classList.add('active');
    tabEl.setAttribute('aria-selected', 'true');
    tabEl.setAttribute('tabindex', '0');
    currentFilter = tabEl.getAttribute('data-hp-filter');
    renderHistoryPanel();
  }

  function wireTabs() {
    var tabsEl = document.getElementById('hpTabs');
    if (!tabsEl) return;
    tabsEl.addEventListener('click', function (ev) {
      var tab = ev.target.closest('.hp-tab');
      if (!tab) return;
      setActiveTab(tab);
    });
    tabsEl.addEventListener('keydown', function (ev) {
      if (ev.key !== 'ArrowLeft' && ev.key !== 'ArrowRight') return;
      var tabs = Array.prototype.slice.call(tabsEl.querySelectorAll('.hp-tab'));
      var idx = tabs.indexOf(document.activeElement);
      if (idx === -1) return;
      ev.preventDefault();
      var dir = ev.key === 'ArrowRight' ? 1 : -1; // RTL-visual right = previous in DOM order
      var next = tabs[(idx + dir + tabs.length) % tabs.length];
      next.focus();
      setActiveTab(next);
    });
  }

  // --------------------------------------------------------------
  // Search — instant, no button, case-insensitive.
  // --------------------------------------------------------------
  function wireSearch() {
    var input = document.getElementById('hpSearchInput');
    var clearBtn = document.getElementById('hpSearchClear');
    if (!input) return;
    function syncClearBtn() {
      if (clearBtn) clearBtn.style.display = input.value ? '' : 'none';
    }
    input.addEventListener('input', function () {
      currentQuery = input.value.trim().toLowerCase();
      syncClearBtn();
      renderHistoryPanel();
    });
    if (clearBtn) {
      clearBtn.addEventListener('click', function () {
        input.value = '';
        currentQuery = '';
        syncClearBtn();
        renderHistoryPanel();
        input.focus();
      });
    }
  }

  // --------------------------------------------------------------
  // Open / close + accessibility
  // --------------------------------------------------------------
  var lastFocusedEl = null;

  function openHistoryPanel() {
    var panel = document.getElementById('historyPanel');
    var overlay = document.getElementById('historyPanelOverlay');
    if (!panel) return;
    lastFocusedEl = document.activeElement;
    panel.classList.add('open');
    panel.setAttribute('aria-hidden', 'false');
    if (overlay) overlay.classList.add('open');
    renderHistoryPanel();
    var searchInput = document.getElementById('hpSearchInput');
    if (searchInput) {
      // Defer focus one frame so the slide-in transition isn't jarred.
      setTimeout(function () { searchInput.focus(); }, 50);
    }
  }

  function closeHistoryPanel() {
    var panel = document.getElementById('historyPanel');
    var overlay = document.getElementById('historyPanelOverlay');
    if (panel) {
      panel.classList.remove('open');
      panel.setAttribute('aria-hidden', 'true');
    }
    if (overlay) overlay.classList.remove('open');
    if (lastFocusedEl && typeof lastFocusedEl.focus === 'function') lastFocusedEl.focus();
  }

  function toggleHistoryPanel() {
    var panel = document.getElementById('historyPanel');
    if (!panel) return;
    if (panel.classList.contains('open')) closeHistoryPanel(); else openHistoryPanel();
  }

  document.addEventListener('DOMContentLoaded', function () {
    wireLiveRefresh();
    wireTabs();
    wireSearch();
    updateTopbarBadge();
    var panel = document.getElementById('historyPanel');
    if (panel) panel.addEventListener('click', handlePanelClick);
    var closeBtn = document.getElementById('hpCloseBtn');
    if (closeBtn) closeBtn.addEventListener('click', closeHistoryPanel);
    var overlay = document.getElementById('historyPanelOverlay');
    if (overlay) overlay.addEventListener('click', closeHistoryPanel);
    document.addEventListener('keydown', function (ev) {
      if (ev.key !== 'Escape') return;
      var p = document.getElementById('historyPanel');
      if (p && p.classList.contains('open')) closeHistoryPanel();
    });
  });

  window.openHistoryPanel = openHistoryPanel;
  window.closeHistoryPanel = closeHistoryPanel;
  window.toggleHistoryPanel = toggleHistoryPanel;
  window.renderHistoryPanel = renderHistoryPanel;

})();
