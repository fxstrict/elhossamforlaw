/* ============================================================================
 * js/modules/desktop-shell.js — Desktop shell behaviour (>=1024px only)
 *   MOD-03 (this file now): DesktopShell — sidebar expanded/collapsed
 *     (+ localStorage 'eh.sidebar'), custom tooltip for the collapsed rail, badge dots.
 *   MOD-04 (this file now): DesktopHeader — page header API set({page,subtitle,breadcrumb,actions}) / clear()
 *     over the existing .topbar, plus the Back button (history.back() with a navigate('dashboard') fallback).
 *     Page-change signal = ShellEvents 'shell:afterNavigate' (+ a childList-only MutationObserver on
 *     #topbarTitle as a safety net). The header never writes to the DOM below 1024px.
 * Never wraps navigate(); never touches NavigationManager / ModalManager / any protected system.
 * Mobile: data-sidebar is REMOVED below 1024px, and no attribute is written to the
 * sidebar items there, so mobile code paths never see anything this file does.
 * The early <script> in index.html <head> sets data-sidebar before first paint; this
 * file only takes over afterwards (toggle, resize, tooltip, badges).
 * ES5-safe, every access guarded, never throws.
 * ==========================================================================*/
(function (global) {
  'use strict';
  var doc = global.document;
  if (!doc) return;
  var KEY = 'eh.sidebar', root = doc.documentElement;
  var tipEl = null, badgeTimer = null, started = false;
  var HDR = { page: null, cache: {}, addHidden: false, addSaved: '' };   /* header state (MOD-04) */

  function safely(fn) { try { return fn(); } catch (e) { return undefined; } }
  function isDesktop() {
    var m = safely(function () { return global.matchMedia('(min-width:1024px)'); });
    return m ? m.matches : global.innerWidth >= 1024;
  }
  function stored() {
    var v = safely(function () { return global.localStorage.getItem(KEY); });
    return (v === 'expanded' || v === 'collapsed') ? v : null;
  }
  function persist(v) { safely(function () { global.localStorage.setItem(KEY, v); }); }
  function autoState() { return global.innerWidth < 1280 ? 'collapsed' : 'expanded'; }
  function state() { return root.getAttribute('data-sidebar'); }
  function $(id) { return doc.getElementById(id); }

  /* ---------- sidebar ---------- */
  function labelOf(item) {
    var out = '', n = item.childNodes, i;
    for (i = 0; i < n.length; i++) if (n[i].nodeType === 3) out += n[i].textContent;
    return out.replace(/\s+/g, ' ').trim();
  }
  function prepareItems() {                        /* desktop only: label cache + accessible name */
    var items = doc.querySelectorAll('#sidebar .sidebar-nav .nav-item'), i, it, l;
    for (i = 0; i < items.length; i++) {
      it = items[i]; l = it.getAttribute('data-eh-label');
      if (!l) { l = labelOf(it); it.setAttribute('data-eh-label', l); }
      if (!it.getAttribute('aria-label')) it.setAttribute('aria-label', l);
    }
  }
  function neutralizeTitles(collapsed) {           /* avoid native + custom tooltip together */
    var items = doc.querySelectorAll('#sidebar .nav-item'), i;
    for (i = 0; i < items.length; i++) {
      if (collapsed && items[i].hasAttribute('title')) {
        items[i].setAttribute('data-eh-title', items[i].getAttribute('title'));
        items[i].removeAttribute('title');
      } else if (!collapsed && items[i].hasAttribute('data-eh-title')) {
        items[i].setAttribute('title', items[i].getAttribute('data-eh-title'));
        items[i].removeAttribute('data-eh-title');
      }
    }
  }
  function refreshBadges() {                       /* .is-zero is only styled inside the collapsed rail */
    var b = doc.querySelectorAll('#sidebar .nav-item .nav-badge'), i, t;
    for (i = 0; i < b.length; i++) {
      t = (b[i].textContent || '').replace(/\s+/g, '');
      b[i].classList[(t === '' || t === '0') ? 'add' : 'remove']('is-zero');
    }
  }
  function syncToggle() {
    var btn = $('sidebarCollapseBtn'); if (!btn) return;
    var c = state() === 'collapsed', label = c ? 'توسيع القائمة' : 'طيّ القائمة';
    btn.setAttribute('aria-expanded', c ? 'false' : 'true');
    btn.setAttribute('aria-label', label);
    btn.setAttribute('title', label);
    if (global.UiIcon && global.UiIcon.html) btn.innerHTML = global.UiIcon.html(c ? 'act-chevrons-end' : 'act-chevrons-start', 16);
  }
  function apply(s) {
    if (!isDesktop()) { root.removeAttribute('data-sidebar'); hideTip(); return; }
    prepareItems();
    root.setAttribute('data-sidebar', s);
    neutralizeTitles(s === 'collapsed'); syncToggle(); refreshBadges(); hideTip();
  }
  function toggle() {
    if (!isDesktop()) return;
    var next = state() === 'collapsed' ? 'expanded' : 'collapsed';
    persist(next); apply(next);                    /* the only place 'eh.sidebar' is written */
  }
  function reevaluate() { apply(stored() || autoState()); }

  /* ---------- tooltip (collapsed rail only) ---------- */
  function showTip(item) {
    if (state() !== 'collapsed' || !isDesktop()) return;
    if (!tipEl) {
      tipEl = doc.createElement('div'); tipEl.id = 'shellTip'; tipEl.setAttribute('role', 'tooltip');
      doc.body.appendChild(tipEl);
    }
    var text = item.getAttribute('data-eh-label') || labelOf(item), badge = item.querySelector('.nav-badge');
    if (badge && !badge.classList.contains('is-zero') && (badge.textContent || '').trim()) text += ' — ' + badge.textContent.trim();
    tipEl.textContent = text; tipEl.classList.add('show');
    var r = item.getBoundingClientRect();
    tipEl.style.top = Math.round(r.top + r.height / 2) + 'px';
    tipEl.style.right = Math.round(global.innerWidth - r.left + 10) + 'px';   /* sidebar is on the right (RTL) */
  }
  function hideTip() { if (tipEl) tipEl.classList.remove('show'); }
  function closestItem(t) {
    while (t && t !== doc) { if (t.classList && t.classList.contains('nav-item')) return t; t = t.parentNode; }
    return null;
  }

  /* ---------- page header (MOD-04, >=1024px only) ----------
   * Contract: a page calls DesktopHeader.set({page, subtitle, breadcrumb, actions}) at the END of its render.
   * Order of events inside navigate(): 'shell:afterNavigate' fires FIRST (currentPage still the old page),
   * then currentPage changes and the page renders (and may call set). So the header is cleared synchronously
   * on the event and the deferred check never clears a header already set for the current page. Pages whose
   * render is skipped by the view cache (dirty tracking) get their last configuration re-applied from HDR.cache. */
  function addBtn() { return $('topbarAction'); }
  function restoreAdd() {                         /* give the default "+ إضافة" button back (only if WE hid it) */
    var b = addBtn(); if (!b || !HDR.addHidden) return;
    HDR.addHidden = false;
    if (b.style.getPropertyPriority('display') === 'important') {
      b.style.removeProperty('display');
      if (HDR.addSaved) b.style.display = HDR.addSaved;        /* navigate() inline value, if any */
    }
    HDR.addSaved = '';
  }
  function clearHeaderDom() {
    var c = $('deskBreadcrumb'), s = $('deskSubtitle'), a = $('deskActions');
    if (c) c.innerHTML = '';
    if (s) s.textContent = '';
    if (a) a.innerHTML = '';
    HDR.page = null; restoreAdd();
  }
  function paintHeader(o) {
    var c = $('deskBreadcrumb'), s = $('deskSubtitle'), a = $('deskActions'), replaces = false;
    HDR.page = o.page || global.currentPage;
    if (s) s.textContent = o.subtitle || '';
    if (c) {
      c.innerHTML = '';
      (o.breadcrumb || []).forEach(function (seg, idx, arr) {
        var el;
        if (idx) { el = doc.createElement('span'); el.textContent = '/'; c.appendChild(el); }
        if (seg.onClick && idx < arr.length - 1) {
          el = doc.createElement('button'); el.type = 'button'; el.textContent = seg.label || '';
          el.addEventListener('click', seg.onClick);
        } else { el = doc.createElement('span'); el.textContent = seg.label || ''; }
        c.appendChild(el);
      });
    }
    if (a) {
      a.innerHTML = '';
      (o.actions || []).forEach(function (act) {
        var b = doc.createElement('button'), lbl = doc.createElement('span');
        b.type = 'button'; if (act.id) b.id = act.id;
        b.className = 'btn btn-sm ' + (act.variant === 'primary' ? 'btn-primary' : 'btn-ghost');
        if (act.icon && global.UiIcon && global.UiIcon.html) b.innerHTML = global.UiIcon.html(act.icon, 16) + ' ';
        lbl.textContent = act.label || ''; b.appendChild(lbl);
        if (act.title) b.setAttribute('title', act.title);
        if (act.onClick) b.addEventListener('click', act.onClick);
        if (act.replacesAdd) replaces = true;
        a.appendChild(b);
      });
    }
    var ab = addBtn();
    if (ab) {
      if (replaces) {                 /* inline !important: app-shell.css forces #topbarAction visible (>=1024) with !important */
        if (!HDR.addHidden) { HDR.addSaved = ab.style.getPropertyValue('display') || ''; HDR.addHidden = true; }
        ab.style.setProperty('display', 'none', 'important');
      } else restoreAdd();
    }
  }
  function setHeader(o) {
    o = o || {};
    var page = o.page || global.currentPage;
    if (o.page && o.page !== global.currentPage) return false;      /* stale caller: the page changed meanwhile */
    if (page) HDR.cache[page] = o;                                  /* kept for view-cache navigations / viewport changes */
    if (!isDesktop()) return false;                                 /* mobile: nothing is ever written */
    paintHeader(o); return true;
  }
  function clearHeader() {                         /* public: the page explicitly drops its header configuration */
    if (global.currentPage) delete HDR.cache[global.currentPage];
    if (isDesktop()) clearHeaderDom();
  }
  function updateBack(page) {
    var btn = $('deskBackBtn'); if (!btn || !isDesktop()) return;
    if (global.UiIcon && global.UiIcon.html && !btn.getAttribute('data-ui-done')) {
      btn.innerHTML = global.UiIcon.html('act-back', 20); btn.setAttribute('data-ui-done', '1');
    }
    btn.hidden = (!page || page === 'dashboard');
  }
  function goBack() {
    if (!isDesktop()) return;
    if (!global.history || global.history.length <= 1) { if (global.navigate) global.navigate('dashboard'); return; }
    var fired = false;
    function onPop() { fired = true; }
    global.addEventListener('popstate', onPop);
    global.history.back();
    global.setTimeout(function () {
      global.removeEventListener('popstate', onPop);
      if (!fired && global.navigate) global.navigate('dashboard');
    }, 250);
  }
  function syncHeader() {                          /* idempotent: run after navigation settles / viewport changes */
    if (!isDesktop()) return;
    var p = global.currentPage;
    updateBack(p);
    if (HDR.page && HDR.page !== p) clearHeaderDom();            /* header belongs to another page */
    if (p && HDR.page !== p && HDR.cache[p]) paintHeader(HDR.cache[p]);
  }
  function onAfterNavigate(payload) {
    if (isDesktop()) { clearHeaderDom(); updateBack(payload && payload.to); hideTip(); }
    global.setTimeout(syncHeader, 0);              /* after navigate()'s synchronous body (render, currentPage) */
  }
  function schedulePageCheck() { global.setTimeout(syncHeader, 0); }

  /* ---------- init ---------- */
  function init() {
    if (started) return; started = true;
    safely(reevaluate);
    var btn = $('sidebarCollapseBtn'); if (btn) btn.addEventListener('click', toggle);
    var nav = doc.querySelector('#sidebar .sidebar-nav');
    if (nav) {
      nav.addEventListener('mouseover', function (e) { var it = closestItem(e.target); if (it) showTip(it); });
      nav.addEventListener('mouseout', hideTip);
      nav.addEventListener('focusin', function (e) { var it = closestItem(e.target); if (it) showTip(it); });
      nav.addEventListener('focusout', hideTip);
      nav.addEventListener('scroll', hideTip);
      nav.addEventListener('click', hideTip);
      if (global.MutationObserver) {               /* scope: the sidebar nav only (badge text changes) */
        new global.MutationObserver(function () {
          if (badgeTimer) return;
          badgeTimer = global.setTimeout(function () { badgeTimer = null; if (isDesktop()) safely(refreshBadges); }, 50);   /* never on mobile */
        }).observe(nav, { subtree: true, childList: true, characterData: true });
      }
    }
    ['(min-width:1024px)', '(min-width:1280px)'].forEach(function (q) {
      var m = safely(function () { return global.matchMedia(q); });
      if (m && m.addEventListener) m.addEventListener('change', reevaluate);
      else if (m && m.addListener) m.addListener(reevaluate);
    });
    /* ---- header (MOD-04) ---- */
    var back = $('deskBackBtn'); if (back) back.addEventListener('click', goBack);
    var m2 = safely(function () { return global.matchMedia('(min-width:1024px)'); });
    if (m2 && m2.addEventListener) m2.addEventListener('change', schedulePageCheck);
    else if (m2 && m2.addListener) m2.addListener(schedulePageCheck);
    if (global.ShellEvents && typeof global.ShellEvents.on === 'function') {
      safely(function () { global.ShellEvents.on('shell:afterNavigate', onAfterNavigate); });
    }
    var title = $('topbarTitle');                  /* safety net: scope = one element, childList only */
    if (title && global.MutationObserver) new global.MutationObserver(schedulePageCheck).observe(title, { childList: true });
    safely(syncHeader);
  }

  global.DesktopHeader = { set: setHeader, clear: clearHeader };
  global.DesktopShell = { toggle: toggle, state: state, goBack: goBack, _refreshBadges: refreshBadges };
  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', init); else init();
})(window);
