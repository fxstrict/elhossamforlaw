/* ============================================================================
 * js/modules/desktop-detail.js — Master/Detail side panel (Desktop UI, MOD-20)
 * Desktop only (>=1024px): clicking a row of the Cases / Clients table opens a
 * read-only summary in a `.side-panel` while the table stays visible. The panel's
 * actions call the EXISTING page functions (editCase / viewCase / quickPrintCase /
 * deleteCase, callClient / whatsappClient / viewClient / editClient / deleteClient);
 * no data is written and no business logic is copied. Nothing here runs below 1024px:
 * the row click handler returns immediately and the panel is never created.
 *
 * Wiring (additive): ONE permanent delegated `click` listener on `document` (rows are
 * re-rendered by DomRecycler, so no per-row listeners). While the panel is open it adds
 * listeners for Esc / outside click / hashchange / popstate / viewport change and removes
 * ALL of them on close (no leak). Page change closes it via ShellEvents 'shell:afterNavigate'
 * (existing bus, subscribe only). Adds/removes `body.has-side-panel` and `.is-selected` on
 * the chosen row. No MutationObserver, no position:fixed/sticky/backdrop-filter outside the
 * existing `.side-panel` rule in css/desktop.css.
 * Never wraps navigate(); never touches NavigationManager / ModalManager / ModalHistoryBridge
 * or any protected system. Reads window.data only. ES5-safe, every access guarded, never throws.
 * ==========================================================================*/
(function (global) {
  'use strict';
  var doc = global.document;
  if (!doc) return;

  var PANEL_ID = 'deskDetailPanel';
  var state = { kind: null, key: null, row: null, panel: null, handlers: null };

  function safely(fn) { try { return fn(); } catch (e) { return undefined; } }
  function isDesktop() {
    var m = safely(function () { return global.matchMedia('(min-width:1024px)'); });
    return m ? m.matches : global.innerWidth >= 1024;
  }
  function icon(name, size) {
    return (global.UiIcon && typeof global.UiIcon.html === 'function') ? global.UiIcon.html(name, size || 16) : '';
  }
  function txt(v) { return v === null || v === undefined ? '' : String(v).replace(/\s+/g, ' ').trim(); }
  function short(v, n) { v = txt(v); return v.length > n ? v.slice(0, n) + '…' : v; }
  function dateText(v) {
    v = txt(v); if (!v) return '';
    var f = safely(function () { return typeof global.formatDate === 'function' ? global.formatDate(v) : ''; });
    return f && f !== '—' ? f : v;
  }

  /* ---------- per-page configuration (pure data; no logic copied from the pages) ---------- */
  var KINDS = {
    cases: {
      page: 'cases', body: 'casesTableBody', list: 'cases', idField: 'رقم_القضية', idRe: /viewCase\((\d+)\)/,
      title: function (r) { return txt(r['عنوان_القضية']) || txt(r['رقم_القضية']) || '—'; },
      sub: function (r) { return txt(r['رقم_القضية']); },
      badge: function (r) { return txt(r['الحالة']); },
      fields: [
        ['نوع الدعوى', 'نوع_الدعوى'], ['المحكمة', 'المحكمة'], ['رقم الدائرة', 'رقم_الدائرة'], ['رقم القاعة', 'رقم_القاعة'],
        ['رقم الدعوى', 'رقم_الدعوى'], ['الموكل', 'اسم_الموكل'], ['هاتف الموكل', 'هاتف_الموكل'], ['الخصم', 'اسم_الخصم'],
        ['تاريخ القيد', 'تاريخ_القيد', 'date'], ['الجلسة القادمة', 'تاريخ_الجلسة_القادمة', 'date'], ['ملاحظات', 'الملاحظات', 'long']
      ],
      actions: [
        { label: 'تعديل', icon: 'act-edit', fn: 'editCase', primary: true },
        { label: 'عرض كامل', icon: 'act-view', fn: 'viewCase' },
        { label: 'طباعة', icon: 'act-print', fn: 'quickPrintCase' },
        { label: 'حذف', icon: 'act-delete', fn: 'deleteCase', danger: true }
      ]
    },
    clients: {
      page: 'clients', body: 'clientsTableBody', list: 'clients', idField: 'رقم_الموكل', idRe: /viewClient\((\d+)\)/,
      title: function (r) { return txt(r['الاسم']) || '—'; },
      sub: function (r) { return txt(r['النوع']); },
      badge: function () { return ''; },
      fields: [
        ['الهاتف', 'الهاتف', 'ltr'], ['البريد', 'البريد', 'ltr'], ['رقم التوكيل', 'رقم_التوكيل'],
        ['العنوان', 'العنوان'], ['الوظيفة', 'الوظيفة'], ['جهة العمل', 'جهة_العمل'], ['الحالة الاجتماعية', 'الحالة_الاجتماعية'],
        ['ملاحظات', 'ملاحظات', 'long']
      ],
      actions: [
        { label: 'اتصال', icon: 'sys-phone', fn: 'callClient', keepOpen: true },
        { label: 'واتساب', icon: 'sys-message', fn: 'whatsappClient', keepOpen: true },
        { label: 'تعديل', icon: 'act-edit', fn: 'editClient', primary: true },
        { label: 'عرض الملف', icon: 'act-view', fn: 'viewClient' },
        { label: 'حذف', icon: 'act-delete', fn: 'deleteClient', danger: true }
      ]
    }
  };

  function listOf(cfg) {
    var d = global.data;
    return d && d[cfg.list] && typeof d[cfg.list].length === 'number' ? d[cfg.list] : null;
  }
  /* index resolved at click time by the record's id (indices shift after edits/sync) */
  function indexOfKey(cfg, key) {
    var list = listOf(cfg), i;
    if (!list) return -1;
    for (i = 0; i < list.length; i++) if (list[i] && list[i][cfg.idField] === key) return i;
    return -1;
  }
  function rowIndex(cfg, tr) {            /* the row's own "view" button already carries the current index */
    var btns = tr.querySelectorAll('button[onclick]'), i, m;
    for (i = 0; i < btns.length; i++) {
      m = cfg.idRe.exec(btns[i].getAttribute('onclick') || '');
      if (m) return parseInt(m[1], 10);
    }
    return -1;
  }

  /* ---------- DOM building (createElement/textContent only: no HTML injection of record data) ---------- */
  function el(tag, cls, text) {
    var n = doc.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = text;
    return n;
  }
  function build(cfg, rec) {
    var p = el('aside', 'side-panel desk-detail');
    p.id = PANEL_ID;
    p.setAttribute('role', 'complementary');
    p.setAttribute('aria-label', 'تفاصيل مختصرة');

    var head = el('div', 'desk-detail-head');
    var titles = el('div', 'desk-detail-titles');
    titles.appendChild(el('div', 'desk-detail-title', cfg.title(rec)));
    var sub = cfg.sub(rec);
    if (sub) titles.appendChild(el('div', 'desk-detail-sub', sub));
    var badge = cfg.badge(rec);
    if (badge) titles.appendChild(el('span', 'badge badge-pending desk-detail-badge', badge));
    head.appendChild(titles);
    var close = el('button', 'desk-detail-close');
    close.type = 'button';
    close.setAttribute('aria-label', 'إغلاق');
    close.title = 'إغلاق (Esc)';
    close.innerHTML = icon('act-close', 16);
    close.addEventListener('click', function () { closePanel(); });
    head.appendChild(close);
    p.appendChild(head);

    var body = el('dl', 'desk-detail-fields'), shown = 0, i, f, v, dd;
    for (i = 0; i < cfg.fields.length; i++) {
      f = cfg.fields[i];
      v = f[2] === 'date' ? dateText(rec[f[1]]) : (f[2] === 'long' ? short(rec[f[1]], 220) : txt(rec[f[1]]));
      if (!v) continue;
      body.appendChild(el('dt', null, f[0]));
      dd = el('dd', f[2] === 'ltr' ? 'is-ltr' : (f[2] === 'long' ? 'is-long' : null), v);
      body.appendChild(dd);
      shown++;
    }
    if (!shown) body.appendChild(el('div', 'desk-detail-empty', 'لا توجد بيانات إضافية'));
    p.appendChild(body);

    var foot = el('div', 'desk-detail-actions'), a, b;
    function wire(btn, act) { btn.addEventListener('click', function () { runAction(cfg, act); }); }
    for (i = 0; i < cfg.actions.length; i++) {
      a = cfg.actions[i];
      b = el('button', 'btn btn-sm ' + (a.primary ? 'btn-primary' : (a.danger ? 'btn-danger' : 'btn-ghost')));
      b.type = 'button';
      b.innerHTML = icon(a.icon, 16);
      b.appendChild(doc.createTextNode(' ' + a.label));
      wire(b, a);
      foot.appendChild(b);
    }
    p.appendChild(foot);
    return p;
  }

  function runAction(cfg, act) {
    var idx = indexOfKey(cfg, state.key);
    var fn = global[act.fn];
    if (idx < 0 || typeof fn !== 'function') { closePanel(); return; }
    if (!act.keepOpen) closePanel();
    safely(function () { fn(idx); });      /* existing page function; it owns its own confirm/modal/toast */
  }

  /* ---------- open / close ---------- */
  function anyModalOpen() { return !!doc.querySelector('.modal-overlay.open'); }

  function onKey(e) {
    if (e && (e.key === 'Escape' || e.keyCode === 27) && !anyModalOpen()) closePanel();
  }
  function onDocClick(e) {                /* outside click: ignore the panel, table rows, and any modal */
    var t = e && e.target;
    if (!t || !t.closest) return;
    if (t.closest('#' + PANEL_ID) || t.closest('.modal-overlay') || t.closest('.toast-container')) return;
    if (t.closest('#casesTableBody tr') || t.closest('#clientsTableBody tr')) return;
    closePanel();
  }
  function onNav() { closePanel(); }
  function onViewport() { if (!isDesktop()) closePanel(); }

  function attach() {
    var h = { timer: null };
    state.handlers = h;
    doc.addEventListener('keydown', onKey);
    global.addEventListener('hashchange', onNav);
    global.addEventListener('popstate', onNav);
    global.addEventListener('resize', onViewport);
    h.timer = global.setTimeout(function () { h.timer = null; if (state.handlers === h) doc.addEventListener('click', onDocClick); }, 0);
  }
  function detach() {
    var h = state.handlers;
    if (!h) return;
    if (h.timer) global.clearTimeout(h.timer);
    doc.removeEventListener('keydown', onKey);
    doc.removeEventListener('click', onDocClick);
    global.removeEventListener('hashchange', onNav);
    global.removeEventListener('popstate', onNav);
    global.removeEventListener('resize', onViewport);
    state.handlers = null;
  }

  function closePanel() {
    safely(function () {
      detach();
      if (state.row && state.row.classList) state.row.classList.remove('is-selected');
      if (state.panel && state.panel.parentNode) state.panel.parentNode.removeChild(state.panel);
      var stray = doc.getElementById(PANEL_ID);
      if (stray && stray.parentNode) stray.parentNode.removeChild(stray);
      if (doc.body) doc.body.classList.remove('has-side-panel');
      state.kind = null; state.key = null; state.row = null; state.panel = null;
    });
  }

  function openFor(kind, tr) {
    var cfg = KINDS[kind], idx, list, rec, panel;
    if (!cfg || !isDesktop() || global.currentPage !== cfg.page) return;
    idx = rowIndex(cfg, tr); list = listOf(cfg);
    rec = list && idx >= 0 ? list[idx] : null;
    if (!rec) return;
    if (state.panel && state.kind === kind && state.key === rec[cfg.idField]) { closePanel(); return; }   /* same row again = toggle */
    closePanel();
    panel = build(cfg, rec);
    doc.body.appendChild(panel);
    panel.classList.add('open');
    doc.body.classList.add('has-side-panel');
    tr.classList.add('is-selected');
    state.kind = kind; state.key = rec[cfg.idField]; state.row = tr; state.panel = panel;
    attach();
  }

  function onRowClick(e) {
    var t = e && e.target, tr, kind;
    if (!t || !t.closest || !isDesktop()) return;
    if (t.closest('button, a, input, select, textarea, label')) return;      /* row buttons keep their own behaviour */
    tr = t.closest('#casesTableBody tr') ? t.closest('#casesTableBody tr') : t.closest('#clientsTableBody tr');
    if (!tr) return;
    kind = t.closest('#casesTableBody tr') ? 'cases' : 'clients';
    safely(function () { openFor(kind, tr); });
  }

  function init() {
    doc.addEventListener('click', onRowClick);
    if (global.ShellEvents && typeof global.ShellEvents.on === 'function') {
      safely(function () { global.ShellEvents.on('shell:afterNavigate', function () { closePanel(); }); });
    }
  }

  global.DesktopDetail = { close: closePanel, isOpen: function () { return !!state.panel; }, _kinds: KINDS };
  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', init); else init();
})(window);
