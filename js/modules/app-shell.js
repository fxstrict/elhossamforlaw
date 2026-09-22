/* ==========================================================================
   PHASE UI-1 — APPLICATION SHELL BEHAVIOR
   ==========================================================================
   Source: "تقرير جنائي شامل — تحويل واجهات النظام" (2026-09-22), §6 و §9
   (Phase UI-1).

   Everything in this file is NEW and ADDITIVE:
     - It never redefines navigate(), toggleSidebar(), openAddModal(), or
       any other existing global function — it only CALLS them.
     - The bottom-nav buttons reuse the exact existing
       `.nav-item[onclick="navigate('<page>')"]` convention (see index.html
       navigate()), so their active/inactive state is kept in sync by the
       ORIGINAL, unmodified navigate() function — no observer/polling
       needed here for that part.
     - The notification bell does not read or recompute alert data itself;
       it scrolls to the existing #dashAlertsCenter block that
       dashboard.js's own renderAlertsCenterWidget() already renders, so
       there is exactly one source of truth for alerts.
     - The FAB is a thin dispatcher over the existing per-page
       openAddModal()/openAddDocModal()/openAddFeeModal()/
       openAddExpenseModal() functions; for pages with more than one
       sensible "add" target (or none), it opens a small bottom sheet of
       its own (new, additive markup created here) rather than guessing.

   Every function below is wrapped so a failure here can never break the
   rest of the app (same defensive convention as ApplicationShell.js /
   SafeModeController.js already used in this codebase).
   ========================================================================== */
(function(){
  'use strict';

  function safely(fn){ try{ fn(); }catch(e){ if(window.console)console.error('[AppShell]',e); } }

  // Pages that already have a single, unambiguous "add" action via the
  // existing global functions. Kept in one place so the FAB and the
  // bottom-sheet fallback agree on the same mapping.
  var DIRECT_ADD = {
    cases:'openAddModal', sessions:'openAddModal', clients:'openAddModal',
    tasks:'openAddModal', opponents:'openAddModal', processServerWorks:'openAddModal',
    documents:'openAddDocModal', fees:'openAddFeeModal', expenses:'openAddExpenseModal'
  };

  // Shown in the FAB's bottom sheet on pages with no single obvious
  // target (dashboard, calendar, search, library, settings, ...).
  var SHEET_OPTIONS = [
    {label:'قضية جديدة', icon:'&#9878;', page:'cases', fn:'openAddModal'},
    {label:'موكل جديد', icon:'&#128101;', page:'clients', fn:'openAddModal'},
    {label:'جلسة جديدة', icon:'&#128197;', page:'sessions', fn:'openAddModal'},
    {label:'مهمة جديدة', icon:'&#9989;', page:'tasks', fn:'openAddModal'},
    {label:'دفعة أتعاب', icon:'&#128176;', page:'fees', fn:'openAddFeeModal'},
    {label:'مستند جديد', icon:'&#128196;', page:'documents', fn:'openAddDocModal'}
  ];

  function el(html){
    var d=document.createElement('div'); d.innerHTML=html.trim(); return d.firstChild;
  }

  function ensureFabSheet(){
    if(document.getElementById('fabSheetOverlay'))return;
    var overlay=el('<div class="fab-sheet-overlay" id="fabSheetOverlay"></div>');
    var sheet=el(
      '<div class="fab-sheet" id="fabSheet" role="dialog" aria-modal="true" aria-label="إضافة جديد">'+
        '<div class="fab-sheet-handle"></div>'+
        '<div class="fab-sheet-title">ماذا تريد أن تضيف؟</div>'+
        '<div id="fabSheetOptions"></div>'+
      '</div>'
    );
    document.body.appendChild(overlay);
    document.body.appendChild(sheet);
    overlay.addEventListener('click', closeFabSheet);
    var optsWrap=sheet.querySelector('#fabSheetOptions');
    SHEET_OPTIONS.forEach(function(opt){
      var row=el(
        '<div class="fab-sheet-option">'+
          '<span class="fso-icon">'+opt.icon+'</span>'+
          '<span>'+opt.label+'</span>'+
        '</div>'
      );
      row.addEventListener('click', function(){
        closeFabSheet();
        safely(function(){
          if(typeof navigate==='function')navigate(opt.page);
          setTimeout(function(){
            if(typeof window[opt.fn]==='function')window[opt.fn]();
          }, 30); // let navigate()'s render pass finish first
        });
      });
      optsWrap.appendChild(row);
    });
  }

  function openFabSheet(){
    ensureFabSheet();
    document.getElementById('fabSheetOverlay').classList.add('open');
    document.getElementById('fabSheet').classList.add('open');
  }
  function closeFabSheet(){
    var o=document.getElementById('fabSheetOverlay'), s=document.getElementById('fabSheet');
    if(o)o.classList.remove('open');
    if(s)s.classList.remove('open');
  }

  function onFabClick(){
    safely(function(){
      var page = (typeof currentPage!=='undefined') ? currentPage : null;
      var directFn = page && DIRECT_ADD[page];
      if(directFn && typeof window[directFn]==='function'){
        window[directFn]();
      } else {
        openFabSheet();
      }
    });
  }

  function onBellClick(){
    safely(function(){
      if(typeof navigate==='function')navigate('alerts');
    });
  }

  function wireBottomNav(){
    var bar=document.getElementById('bottomNav');
    if(!bar)return;
    bar.addEventListener('click', function(evt){
      var fab=evt.target.closest('#appFab');
      if(fab){ onFabClick(); }
    });
    var bell=document.getElementById('appHeaderBell');
    if(bell)bell.addEventListener('click', onBellClick);
    var burger=document.getElementById('appHeaderBurger');
    if(burger)burger.addEventListener('click', function(){
      safely(function(){ if(typeof toggleSidebar==='function')toggleSidebar(); });
    });
    var brand=document.getElementById('appHeaderBrand');
    if(brand)brand.addEventListener('click', function(){
      safely(function(){ if(typeof navigate==='function')navigate('dashboard'); });
    });
  }

  // --------------------------------------------------------------------
  // PHASE UI-4 (partial) — Cases page stats strip (report §4/§9).
  // READ-ONLY: reads the existing global `data.cases` array (the exact
  // same object cases.js/dashboard.js already read) and writes markup
  // into a NEW container (#casesStatBar, added additively in index.html)
  // that no existing file writes to. Never mutates `data`. Reuses the
  // exact case-status filter already proven in
  // dashboard.js:renderStatisticsWidget() (`['نشطة','active'].includes(...)`)
  // instead of inventing a new one, so the numbers always agree with the
  // dashboard's own "قضايا نشطة" figure.
  // --------------------------------------------------------------------
  function renderCasesStatBar(){
    safely(function(){
      var host = document.getElementById('casesStatBar');
      if(!host || typeof data === 'undefined' || !data || !Array.isArray(data.cases)) return;
      var all = data.cases;
      var active = all.filter(function(c){ return ['نشطة','active'].includes(c['الحالة']); }).length;
      var closed = all.filter(function(c){ return c['الحالة']==='منتهية'; }).length;
      var pending = all.filter(function(c){ return c['الحالة']==='معلقة'; }).length;
      host.innerHTML =
        '<div class="stat-card"><div class="stat-num">'+all.length+'</div><div class="stat-label">إجمالي القضايا</div></div>'+
        '<div class="stat-card"><div class="stat-num">'+active+'</div><div class="stat-label">نشطة</div></div>'+
        '<div class="stat-card"><div class="stat-num">'+pending+'</div><div class="stat-label">معلقة</div></div>'+
        '<div class="stat-card"><div class="stat-num">'+closed+'</div><div class="stat-label">منتهية</div></div>';
    });
  }

  // --------------------------------------------------------------------
  // PHASE UI-10 — Alerts & follow-up center (report §7, screen 12).
  // Deliberately does NOT recompute anything: calls the existing
  // dashboard.js:renderAlertsCenterWidget() (unchanged) so the one place
  // that decides what counts as an alert stays the one place, then
  // mirrors its rendered output into the new page's own container.
  // --------------------------------------------------------------------
  function renderAlertsPage(){
    safely(function(){
      var dst = document.getElementById('alertsPageList');
      if(!dst) return;
      if(typeof renderAlertsCenterWidget === 'function') renderAlertsCenterWidget();
      var src = document.getElementById('dashAlertsCenterList');
      dst.innerHTML = src ? src.innerHTML : '<div class="alerts-center-empty"><span>&#9989;</span><span>لا توجد تنبيهات حالياً — كل شيء تحت السيطرة</span></div>';
    });
  }

  function wireShellEventsBridge(){
    // window.ShellEvents is the project's own, purpose-built, already-
    // tested observation channel (js/core/shell/ShellEvents.js, "let
    // other code observe shell activity if it wants to") — using it here
    // is exactly its documented intended use, and it is defensively
    // guarded on both ends (emit() never throws into us; we never touch
    // navigate() itself).
    if(window.ShellEvents && typeof window.ShellEvents.on === 'function'){
      window.ShellEvents.on('shell:afterNavigate', function(payload){
        safely(function(){
          if(!payload) return;
          if(payload.to === 'cases') renderCasesStatBar();
          if(payload.to === 'alerts') renderAlertsPage();
        });
      });
    }
    // Cold-start fallback for the (rare) case a deep link lands directly
    // on one of these pages before any navigate() call fires afterNavigate.
    if(typeof currentPage !== 'undefined'){
      if(currentPage === 'cases') renderCasesStatBar();
      if(currentPage === 'alerts') renderAlertsPage();
    }
  }

  document.addEventListener('DOMContentLoaded', function(){
    safely(wireBottomNav);
    safely(wireShellEventsBridge);
  });

  // Exposed only for the (optional, non-blocking) manual smoke check in
  // js/tests — mirrors the pattern already used by ApplicationShell etc.
  window.AppShell = { onFabClick: onFabClick, onBellClick: onBellClick, openFabSheet: openFabSheet, closeFabSheet: closeFabSheet, renderCasesStatBar: renderCasesStatBar, renderAlertsPage: renderAlertsPage };
})();
