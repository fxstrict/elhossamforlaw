// ==================================================================
// DASHBOARD MODULE — js/modules/dashboard.js
// Extracted from index.html — Dashboard Extraction Stage (Extraction Only)
// ==================================================================
// LOAD ORDER REQUIREMENT:
// This file depends on the shared global `data` object (declared in the
// main inline <script> block of index.html) and on 5 helper functions in
// js/ui-utils.js: pad(), parseLocalDate(), formatTime(), formatDate(),
// urgencyBadge(). It must be loaded AFTER js/ui-utils.js.
// It has NO dependency on cases.js, settings.js, or any other module file
// — no override chain, no populateCaseDropdown-style dependency (see
// DASHBOARD_AUDIT_REPORT.md Section 3, Dependency Graph).
//
// CALL-GRAPH NOTE (the one point requiring care — see
// DASHBOARD_AUDIT_REPORT.md Section 5.2): updateBadges() is called from
// 17 call sites across 9 files project-wide — the DOMContentLoaded
// bootstrap handler (inline), and every already-integrated module's
// save/delete functions: cases.js / print-utils.js's saveCase()+
// deleteCase(), clients.js, documents.js, fees.js, sessions.js, tasks.js
// (×2 each), children.js's saveChild()+deleteChild(), and settings.js's
// handleImport()/clearAllData()/loadFromSheets(). None of those call
// sites reference this file directly — they call the global function
// name `updateBadges`, which this file's declaration continues to
// provide once wired in. renderDashboard() is called from 5 sites:
// navigate() and the DOMContentLoaded handler (both inline), plus
// settings.js's handleImport()/clearAllData()/loadFromSheets()/
// refreshAll(). settings.js currently loads AFTER the inline block that
// (pre-extraction) declares these two functions; this is safe only
// because JS function declarations are hoisted and all actual *calls*
// happen at runtime (user interaction or the deferred DOMContentLoaded
// event), never at settings.js's own parse time — the same pattern
// already relied upon by every prior module extraction (Settings,
// Calendar, Children).
//
// This file is NOT yet wired into index.html (no <script> tag added) —
// integration is deferred to a later phase per instructions.
//
// Functions below are copied byte-for-byte from index.html, in their
// original source order, including the preceding "// DASHBOARD" section
// comment. No renaming, reformatting, or logic changes.
// ==================================================================
//
// ADDENDUM — PHASE 29 (Smart Dashboard, Priority 1 + 3): two new
// widget functions (renderTodayCenterWidget, renderAlertsCenterWidget)
// were appended at the end of this file, after updateBadges(). See
// the "PHASE 29" block below and PHASE29_SMART_DASHBOARD_REPORT.md.
// ==================================================================

// DASHBOARD
// ==================================================================
// PHASE 18.4 — DASHBOARD PROGRESSIVE DECOMPOSITION (widget split only)
// ==================================================================
// renderDashboard() has been decomposed into independent widget
// functions. This is PURE internal refactoring: every widget below is
// copied byte-for-byte from the original monolithic renderDashboard()
// (see Phase 18.4 report / verify_dashboard_widget_decomposition.js
// for the line-by-line mapping to the pre-refactor source). No HTML,
// DOM structure, CSS class, event, or timing change was made.
//
// COUPLING NOTE (see DASHBOARD_WIDGET_DEPENDENCIES.md §2, Phase 18.2):
// `now` (today at 00:00:00) and `todayStr` are computed independently
// inside renderStatisticsWidget(), renderAlertsWidget(), and
// renderSessionsWidget() rather than shared via a single top-level
// variable. In the original monolithic function these three sections
// read one shared `now`/`todayStr` computed once at the top of
// renderDashboard(). Recomputing them per-widget is behaviourally
// identical: `now` is derived from `new Date()` truncated to midnight,
// and all three widgets execute synchronously within the same
// renderDashboard() call on the same calendar day, so the recomputed
// values are always equal to the original shared ones. This keeps each
// widget independently callable (a precondition for Phase 18.5
// Progressive Boot) without changing any observable output.
//
// updateBadges() is intentionally left untouched below. It is already
// a separate, independent function (not part of renderDashboard()),
// it renders sidebar badges rather than Dashboard page body content,
// and Phase 18.2's dependency analysis (DASHBOARD_WIDGET_DEPENDENCIES.md
// §2) already establishes it as visually and architecturally
// independent of the Dashboard widgets. Decomposing it further is out
// of scope for this phase — see the Phase 18.4 report, "Scope
// Clarification" section.
// ==================================================================

function renderStatisticsWidget(){
  var now=new Date();now.setHours(0,0,0,0);
  var todayStr=now.getFullYear()+'-'+pad(now.getMonth()+1)+'-'+pad(now.getDate());
  var in7=new Date(now.getTime()+7*864e5);
  var active=data.cases.filter(function(c){return['نشطة','active'].includes(c['الحالة']);}).length;
  var todaySess=data.sessions.filter(function(s){return String(s['التاريخ']).slice(0,10)===todayStr;}).length;
  var weekSess=data.sessions.filter(function(s){var d=parseLocalDate(s['التاريخ']);return d&&d>=now&&d<=in7;}).length;
  var urgent=data.tasks.filter(function(t){return t['الأولوية']==='high'&&t['الحالة']!=='done';}).length;
  document.getElementById('statCases').textContent=data.cases.length;
  document.getElementById('statActive').textContent=active;
  document.getElementById('statToday').textContent=todaySess;
  document.getElementById('statWeek').textContent=weekSess;
  document.getElementById('statClients').textContent=data.clients.length;
  document.getElementById('statTasks').textContent=urgent;
}

function renderAlertsWidget(){
  var now=new Date();now.setHours(0,0,0,0);
  var todayStr=now.getFullYear()+'-'+pad(now.getMonth()+1)+'-'+pad(now.getDate());
  var alerts=document.getElementById('dashAlerts');alerts.innerHTML='';
  var ts=data.sessions.filter(function(s){return String(s['التاريخ']).slice(0,10)===todayStr;});
  if(ts.length)alerts.innerHTML='<div class="alert-bar">&#9888;&#65039; لديك <strong>'+ts.length+' جلسة</strong> اليوم: '+ts.map(function(s){return(s['عنوان_القضية']||'جلسة')+' الساعة '+formatTime(s['الوقت']);}).join(' | ')+'</div>';
}

function renderSessionsWidget(){
  var now=new Date();now.setHours(0,0,0,0);
  var up=data.sessions.filter(function(s){var d=parseLocalDate(s['التاريخ']);return d&&d>=now;}).sort(function(a,b){return parseLocalDate(a['التاريخ'])-parseLocalDate(b['التاريخ']);}).slice(0,5);
  var ds=document.getElementById('dashSessions');
  if(!up.length)ds.innerHTML='<div class="empty-state"><div class="icon">&#128197;</div><p>لا توجد جلسات قادمة</p></div>';
  else ds.innerHTML=up.map(function(s){var d=parseLocalDate(s['التاريخ']);if(!d)return'';return'<div class="session-item"><div class="session-date"><div class="day">'+d.getDate()+'</div><div class="month">'+d.toLocaleDateString('ar-EG',{month:'short'})+'</div></div><div class="session-info"><div class="session-title">'+(s['عنوان_القضية']||'جلسة')+' '+urgencyBadge(s['التاريخ'])+'</div><div class="session-meta"><span>&#128336; '+formatTime(s['الوقت'])+'</span><span>&#127963; '+(s['المحكمة']||'—')+'</span></div></div></div>';}).join('');
}

function renderTasksWidget(){
  var ut=data.tasks.filter(function(t){return t['الأولوية']==='high'&&t['الحالة']!=='done';}).slice(0,5);
  var dt=document.getElementById('dashTasks');
  if(!ut.length)dt.innerHTML='<div class="empty-state"><div class="icon">&#9989;</div><p>لا توجد مهام عاجلة</p></div>';
  // PHASE 13.14 PART 1 — Checkbox removed entirely (the .task-check
  // circle is no longer emitted, matching tasks.js's renderTasks()). In
  // its place, the whole card now opens the same Task Edit Dialog used
  // on the Tasks page (editTask() — no new screen/Modal/View). The index
  // passed to editTask() is resolved the same way tasks.js already does
  // it (resolveTaskIndex() against the data.tasks mirror by identifier,
  // not by array position/reference), so Dashboard always opens the
  // correct task regardless of filtering/order.
  // PHASE 13.15 PART 2 — UI Consistency: same wording/format as tasks.js
  // renderTasks() ("السبب:" never "بسبب", "الساعة" before the time never
  // "•"), plus the case number (رقم_القضية) on its own line when present.
  // Dashboard still intentionally shows ONLY reopen info, never
  // completion info (سبب/تاريخ/وقت الإنجاز) — dt only ever lists
  // non-done tasks, per the existing filter above (unchanged). Task
  // selection/filter/sort/slice(0,5) logic above is untouched.
  else dt.innerHTML=ut.map(function(t){
    var ri=resolveTaskIndex(data.tasks,t);
    var caseSpan = t['رقم_القضية']
      ? '<span class="task-due">&#9878; '+t['رقم_القضية']+'</span>'
      : '';
    var dueSpan = t['الموعد_النهائي']
      ? '<span class="task-due">'+urgencyBadge(t['الموعد_النهائي'])+' '+formatDate(t['الموعد_النهائي'])+'</span>'
      : '';
    var infoRow = (caseSpan||dueSpan)
      ? '<div style="display:flex;gap:9px;flex-wrap:wrap;margin-top:3px;">'+caseSpan+dueSpan+'</div>'
      : '';
    var reopenLine = '';
    if (t['تاريخ_إعادة_الفتح']) {
      reopenLine =
        '<div class="task-due" style="width:100%;margin-top:2px;">أعيد فتحها:<br>'+formatDate(t['تاريخ_إعادة_الفتح'])+
        (t['وقت_إعادة_الفتح']?' الساعة '+formatTime(t['وقت_إعادة_الفتح']):'')+
        (t['سبب_إعادة_الفتح']?'<br>السبب:<br>'+t['سبب_إعادة_الفتح']:'')+
        '</div>';
    }
    return '<div class="task-item high" style="cursor:pointer;" onclick="editTask('+ri+')"><div style="flex:1;min-width:0;"><div class="task-text">'+(TASK_PRIORITY_ICONS['high']||'')+' '+t['العنوان']+'</div>'+infoRow+reopenLine+'</div></div>';
  }).join('');
}

function renderWelcomeWidget(){
  // PHASE UX-01: first-use welcome state — shown instead of the (all-zero)
  // stats/dashboard grids only when there are zero cases yet. Purely a
  // display:'' / 'none' toggle on existing elements; no data read/written,
  // no change to any calculation above this block.
  var dw=document.getElementById('dashboardWelcome');
  if(dw){
    var statsGrid=document.querySelector('#page-dashboard .stats-grid');
    var dashGrid=document.querySelector('#page-dashboard .dashboard-grid');
    var sectionTitle=document.querySelector('#page-dashboard .dash-section-title');
    if(!data.cases.length){
      dw.style.display='';
      if(statsGrid)statsGrid.style.display='none';
      if(dashGrid)dashGrid.style.display='none';
      if(sectionTitle)sectionTitle.style.display='none';
      // HOTFIX (workflow correction): a case requires at least one existing
      // client, so guide the user to add a client first when both are empty.
      var stepClient=document.getElementById('welcomeStepClient');
      var stepCase=document.getElementById('welcomeStepCase');
      if(stepClient&&stepCase){
        if(!data.clients.length){stepClient.style.display='';stepCase.style.display='none';}
        else{stepClient.style.display='none';stepCase.style.display='';}
      }
    }else{
      dw.style.display='none';
      if(statsGrid)statsGrid.style.display='';
      if(dashGrid)dashGrid.style.display='';
      if(sectionTitle)sectionTitle.style.display='';
    }
  }
}

// ==================================================================
// PHASE 29 — SMART DASHBOARD (additive only)
// ==================================================================
// Scope: Priority 1 (Today Center) and Priority 3 (Alerts Center) from
// the Smart Dashboard specification — the two starred items the spec
// itself lists first, ahead of charts/KPI/AI-assistant/etc. Those
// remaining sections are intentionally deferred to later phases (see
// PHASE29_SMART_DASHBOARD_REPORT.md) rather than attempted all at
// once, per the project's own phased-execution rule.
//
// Both widgets below are NEW, independently-callable functions,
// following the exact Phase 18.4 decomposition pattern already used
// by renderStatisticsWidget/renderAlertsWidget/renderSessionsWidget/
// renderTasksWidget/renderWelcomeWidget above: each widget owns its
// own DOM container, computes its own `now`/`todayStr`, and touches
// nothing outside the ids it is documented to write to. Nothing in
// any of the five pre-existing widgets, or in renderDashboard()'s
// pre-existing five call lines, is modified — the two new calls are
// appended at the end of renderDashboard() only.
// ==================================================================

function renderExtendedStatisticsWidget(){
  // PHASE 29.1 — Priority 2 completion (Quick Statistics section of the
  // spec has 8 cards; renderStatisticsWidget() above — Phase 18.4,
  // untouched — already covers 6 of them). This widget owns only the
  // 4 NEW card ids added to index.html's .stats-grid in this phase:
  // statClosed / statChildren / statDocuments / statUpcoming.
  var now=new Date();now.setHours(0,0,0,0);
  var closed=data.cases.filter(function(c){return c['الحالة']==='منتهية';}).length;
  var childrenCount=(data.children||[]).length;
  var documentsCount=(data.documents||[]).length;
  var upcoming=data.sessions.filter(function(s){var d=parseLocalDate(s['التاريخ']);return d&&d>=now;}).length;
  var elClosed=document.getElementById('statClosed');if(elClosed)elClosed.textContent=closed;
  var elChildren=document.getElementById('statChildren');if(elChildren)elChildren.textContent=childrenCount;
  var elDocuments=document.getElementById('statDocuments');if(elDocuments)elDocuments.textContent=documentsCount;
  var elUpcoming=document.getElementById('statUpcoming');if(elUpcoming)elUpcoming.textContent=upcoming;
}

// ==================================================================
// PHASE 30 — TODAY CENTER REDESIGN (Smart Clock + Holidays Strip)
// ==================================================================
// Replaces the single-row "bar" layout of renderTodayCenterWidget()
// with the richer card layout from the approved design reference:
// a circular clock (tap → opens the device's native alarm screen),
// a Hijri date column, a Gregorian date column with a "days to next
// holiday" counter, a flip-calendar tile (tap → Calendar page), and
// a horizontally scrollable strip of upcoming official
// holidays/seasons with prev/next arrows + dot pagination.
//
// Everything here is additive/replacement to this one widget only —
// no other widget function, id, or file is touched. The container's
// own onclick="navigate('calendar')" (set once in index.html) is left
// as-is as a background fallback; the two interactive sub-elements
// below (.tc-clock, .tc-flip-cal) stop propagation so they can each
// carry their own, different action.
// ==================================================================

// Best-effort list of Egyptian official holidays/observances. Fixed
// (Gregorian) dates are exact; Islamic/Hijri-based dates shift every
// year and are recomputed below from the Hijri calendar via Intl
// where possible — the array only needs the *fixed* entries; Hijri
// entries are generated separately by getUpcomingHolidays().
var FIXED_HOLIDAYS=[
  {month:1,day:1,label:'رأس السنة الميلادية',icon:'&#127881;'},
  {month:1,day:7,label:'عيد الميلاد المجيد',icon:'&#10013;&#65039;'},
  {month:1,day:25,label:'عيد الشرطة وثورة 25 يناير',icon:'&#127894;'},
  {month:4,day:25,label:'عيد تحرير سيناء',icon:'&#127470;&#127468;'},
  {month:5,day:1,label:'عيد العمال',icon:'&#128119;'},
  {month:6,day:30,label:'ثورة 30 يونيو',icon:'&#127894;'},
  {month:7,day:23,label:'ثورة 23 يوليو',icon:'&#127894;'},
  {month:10,day:6,label:'عيد القوات المسلحة',icon:'&#127474;&#127468;'}
];

// Hijri-based observances, expressed as an (approximate month/day)
// pair in the *current* Hijri year — recomputed each call against
// `now` so the widget stays correct as years roll over, without
// hard-coding a Gregorian date that would go stale next year.
var HIJRI_HOLIDAYS=[
  {hMonth:1,hDay:1,label:'رأس السنة الهجرية',icon:'&#127769;'},
  {hMonth:3,hDay:12,label:'المولد النبوي الشريف',icon:'&#127978;'},
  {hMonth:9,hDay:1,label:'بداية شهر رمضان',icon:'&#127765;'},
  {hMonth:10,hDay:1,label:'عيد الفطر المبارك',icon:'&#127873;'},
  {hMonth:12,hDay:10,label:'عيد الأضحى المبارك',icon:'&#128031;'}
];

function getUpcomingHolidays(now,count){
  var results=[];
  var year=now.getFullYear();
  [year,year+1].forEach(function(y){
    FIXED_HOLIDAYS.forEach(function(h){
      var d=new Date(y,h.month-1,h.day);
      results.push({date:d,label:h.label,icon:h.icon});
    });
  });
  // Hijri entries: scan a ~380-day window day-by-day and match against
  // the Hijri month/day the Intl formatter reports — avoids needing a
  // full Hijri→Gregorian conversion routine of our own.
  try{
    var fmt=new Intl.DateTimeFormat('ar-SA-u-ca-islamic-umalqura',{month:'numeric',day:'numeric'});
    var seen={};
    for(var i=0;i<380;i++){
      var d=new Date(now.getTime()+i*864e5);
      var parts=fmt.formatToParts(d);
      var hm=null,hd=null;
      parts.forEach(function(p){if(p.type==='month')hm=parseInt(p.value,10);if(p.type==='day')hd=parseInt(p.value,10);});
      HIJRI_HOLIDAYS.forEach(function(h){
        var key=h.label+'-'+d.getFullYear();
        if(hm===h.hMonth&&hd===h.hDay&&!seen[key]){
          seen[key]=true;
          results.push({date:d,label:h.label,icon:h.icon});
        }
      });
    }
  }catch(e){
    // Islamic-calendar ICU data unavailable — fixed-date holidays
    // above still populate the strip normally.
  }
  var todayMid=new Date(now);todayMid.setHours(0,0,0,0);
  results=results.filter(function(r){return r.date>=todayMid;})
    .sort(function(a,b){return a.date-b.date;});
  return results.slice(0,count||8);
}

// Tap target for the clock face — best-effort deep link into the
// device's native clock/alarm app (no reliable cross-platform Web API
// exists for this, so we branch on user agent and fall back to a
// friendly message rather than a silent no-op).
function openDeviceAlarmClock(ev){
  if(ev&&ev.stopPropagation)ev.stopPropagation();
  var ua=navigator.userAgent||'';
  try{
    if(/Android/i.test(ua)){
      window.location.href='intent://com.android.deskclock/#Intent;scheme=android-app;action=android.intent.action.SET_ALARM;end';
    }else if(/iPhone|iPad|iPod/i.test(ua)){
      window.location.href='clock-alarm://';
    }else{
      alert('افتح تطبيق الساعة على جهازك لضبط تنبيه جديد.');
    }
  }catch(e){
    alert('افتح تطبيق الساعة على جهازك لضبط تنبيه جديد.');
  }
}

// Prev/next arrow buttons for the holidays strip.
function scrollTodayHolidays(dir){
  var track=document.getElementById('tcHolidaysTrack');
  if(!track)return;
  track.scrollBy({left:dir*160,behavior:'smooth'});
}

// Keeps the dot pagination under the strip in sync with scroll
// position. Bound once via the track's own onscroll= attribute (see
// markup below) rather than an addEventListener re-attached on every
// renderDashboard() call, to avoid stacking duplicate listeners.
function updateTodayHolidaysDots(){
  var track=document.getElementById('tcHolidaysTrack');
  var dots=document.getElementById('tcHolidaysDots');
  if(!track||!dots)return;
  var children=track.children;
  if(!children.length)return;
  var trackCenter=track.scrollLeft+track.clientWidth/2;
  var closest=0,closestDist=Infinity;
  for(var i=0;i<children.length;i++){
    var c=children[i];
    var center=c.offsetLeft+c.offsetWidth/2;
    var dist=Math.abs(center-trackCenter);
    if(dist<closestDist){closestDist=dist;closest=i;}
  }
  var dotEls=dots.children;
  for(var j=0;j<dotEls.length;j++){
    dotEls[j].classList.toggle('active',j===closest);
  }
}

function renderTodayCenterWidget(){
  var el=document.getElementById('dashTodayCenter');
  if(!el)return;
  var now=new Date();
  var gregorianDay=now.toLocaleDateString('ar-EG',{day:'numeric'});
  var gregorianMonth=now.toLocaleDateString('ar-EG',{month:'long'});
  var gregorianYear=now.toLocaleDateString('ar-EG',{year:'numeric'});
  var monthShortEn=now.toLocaleDateString('en-US',{month:'short'}).toUpperCase();
  var dayName=now.toLocaleDateString('ar-EG',{weekday:'long'});
  var time=now.toLocaleTimeString('ar-EG',{hour:'2-digit',minute:'2-digit',hour12:true});
  var isPm=now.getHours()>=12;
  var hijri='';
  try{
    hijri=new Intl.DateTimeFormat('ar-SA-u-ca-islamic-umalqura',{year:'numeric',month:'long',day:'numeric'}).format(now);
  }catch(e){
    // Islamic-calendar ICU data unavailable in this runtime — Gregorian
    // date/day/time above are unaffected; the Hijri line is simply
    // omitted rather than showing an incorrect approximation.
    hijri='';
  }

  var upcoming=getUpcomingHolidays(now,8);

  // LAWYER-CONTEXT TIP — a small, practical addition for this widget:
  // a first "chip" (before the holiday chips) surfacing the lawyer's
  // own nearest court obligation, computed from data already on the
  // dashboard (data.sessions), so the strip isn't only about public
  // holidays but also about what's actually due soon.
  var todayMid=new Date(now);todayMid.setHours(0,0,0,0);
  var nextSession=data.sessions
    .map(function(s){return{s:s,d:parseLocalDate(s['التاريخ'])};})
    .filter(function(x){return x.d&&x.d>=todayMid;})
    .sort(function(a,b){return a.d-b.d;})[0];
  var tipChip='';
  if(nextSession){
    var daysToSession=Math.round((nextSession.d-todayMid)/864e5);
    var sessLabel=daysToSession===0?'أقرب جلسة اليوم':'أقرب جلسة خلال '+daysToSession+' يوم';
    tipChip='<div class="tc-holiday-chip tc-tip-chip" onclick="event.stopPropagation();navigate(\'sessions\')" title="'+(nextSession.s['عنوان_القضية']||'')+'">'+
      '<span class="tc-holiday-date">&#9878;&#65039;</span>'+
      '<span class="tc-holiday-label">'+sessLabel+'</span>'+
    '</div>';
  }

  var holidayChips=upcoming.map(function(h){
    var dd=h.date.toLocaleDateString('ar-EG',{day:'numeric'});
    var mm=h.date.toLocaleDateString('ar-EG',{month:'long'});
    return '<div class="tc-holiday-chip">'+
      '<span class="tc-holiday-date">'+dd+' '+mm+'</span>'+
      '<span class="tc-holiday-label">'+h.icon+' '+h.label+'</span>'+
    '</div>';
  }).join('');

  var dots=upcoming.map(function(_,i){return '<span class="tc-dot'+(i===0?' active':'')+'"></span>';}).join('');

  var next=upcoming[0];
  var countdownText='';
  if(next){
    var daysTo=Math.round((next.date-todayMid)/864e5);
    countdownText=daysTo<=0?'عطلة اليوم — '+next.label:daysTo+' يوم قادم حتى '+next.label;
  }

  el.innerHTML=
    '<div class="today-center-main">'+
      '<div class="tc-clock" onclick="openDeviceAlarmClock(event)" role="button" tabindex="0" title="ضبط تنبيه في ساعة الجهاز" '+
        'onkeydown="if(event.key===\'Enter\'||event.key===\' \'){event.preventDefault();openDeviceAlarmClock(event);}">'+
        '<svg class="tc-clock-ring" viewBox="0 0 100 100" aria-hidden="true">'+
          '<circle cx="50" cy="50" r="44" class="tc-ring-bg"/>'+
          '<circle cx="50" cy="50" r="44" class="tc-ring-fg"/>'+
        '</svg>'+
        '<span class="tc-clock-mode">'+(isPm?'&#9728;&#65039;':'&#127765;')+'</span>'+
        '<div class="tc-clock-face">'+
          '<span class="tc-clock-time">'+time.replace(/\s?(ص|م|AM|PM)/i,'')+'</span>'+
          '<span class="tc-clock-ampm">'+(isPm?'م':'ص')+'</span>'+
        '</div>'+
        '<span class="tc-clock-bell">&#128276;</span>'+
      '</div>'+
      '<div class="tc-hijri">'+
        '<div class="tc-col-label"><span>&#127769;</span> التاريخ الهجري</div>'+
        (hijri?'<div class="tc-col-main">'+hijri+' هـ</div>':'<div class="tc-col-main tc-col-muted">غير متاح</div>')+
      '</div>'+
      '<div class="tc-gregorian">'+
        '<div class="tc-col-label"><span>&#128198;</span> التاريخ الميلادي</div>'+
        '<div class="tc-col-main">'+dayName+'</div>'+
        '<div class="tc-col-sub">'+gregorianDay+' '+gregorianMonth+' '+gregorianYear+'</div>'+
        (countdownText?'<div class="tc-countdown">&#128197; '+countdownText+'</div>':'')+
      '</div>'+
      '<div class="tc-flip-cal" onclick="event.stopPropagation();navigate(\'calendar\')" role="button" tabindex="0" title="عرض التقويم" '+
        'onkeydown="if(event.key===\'Enter\'||event.key===\' \'){event.preventDefault();navigate(\'calendar\');}">'+
        '<div class="tc-flip-top">'+monthShortEn+'</div>'+
        '<div class="tc-flip-day">'+gregorianDay+'</div>'+
      '</div>'+
    '</div>'+
    (upcoming.length?
      '<div class="tc-holidays">'+
        '<button type="button" class="tc-arrow tc-arrow-prev" onclick="event.stopPropagation();scrollTodayHolidays(-1)" aria-label="السابق">&#10094;</button>'+
        '<div class="tc-holidays-track" id="tcHolidaysTrack" onscroll="updateTodayHolidaysDots()">'+tipChip+holidayChips+'</div>'+
        '<button type="button" class="tc-arrow tc-arrow-next" onclick="event.stopPropagation();scrollTodayHolidays(1)" aria-label="التالي">&#10095;</button>'+
      '</div>'+
      '<div class="tc-dots" id="tcHolidaysDots">'+dots+'</div>'
      :'');
}

function renderAlertsCenterWidget(){
  var list=document.getElementById('dashAlertsCenterList');
  if(!list)return;
  var now=new Date();now.setHours(0,0,0,0);
  var todayStr=now.getFullYear()+'-'+pad(now.getMonth()+1)+'-'+pad(now.getDate());
  var in2h=new Date(new Date().getTime()+2*3600*1000);

  var activeCases=data.cases.filter(function(c){return['نشطة','active'].includes(c['الحالة']);});

  // 1) Sessions starting within the next 2 hours (today only).
  var soonSessions=data.sessions.filter(function(s){
    if(String(s['التاريخ']).slice(0,10)!==todayStr)return false;
    var t=String(s['الوقت']||'');
    if(!t)return false;
    var parts=t.split(':');
    if(parts.length<2)return false;
    var st=new Date();st.setHours(parseInt(parts[0],10)||0,parseInt(parts[1],10)||0,0,0);
    return st>=new Date()&&st<=in2h;
  });

  // 2) Active cases with no opponent recorded (اسم_الخصم empty).
  var casesNoOpponent=activeCases.filter(function(c){return!c['اسم_الخصم'];});

  // 3) Active cases with zero linked documents.
  var casesNoDocuments=activeCases.filter(function(c){
    var num=c['رقم_القضية'];
    if(!num)return false;
    return!data.documents.some(function(d){return d['رقم_القضية']===num;});
  });

  // 4) High-priority tasks whose deadline has already passed and are
  //    still not marked done (reuses the same not-done semantics as
  //    the pre-existing renderTasksWidget()/renderStatisticsWidget()
  //    urgent-task filters above — no new status value introduced).
  var overdueTasks=data.tasks.filter(function(t){
    if(t['الحالة']==='done')return false;
    var d=t['الموعد_النهائي']?parseLocalDate(t['الموعد_النهائي']):null;
    return d&&d<now;
  });

  var chips=[];
  if(soonSessions.length)chips.push({level:'danger',icon:'&#9200;',label:'جلسة خلال ساعتين',count:soonSessions.length,page:'sessions'});
  if(overdueTasks.length)chips.push({level:'danger',icon:'&#128204;',label:'مهام إدارية متأخرة',count:overdueTasks.length,page:'tasks'});
  if(casesNoOpponent.length)chips.push({level:'warning',icon:'&#128100;',label:'قضايا بدون بيانات خصم',count:casesNoOpponent.length,page:'cases'});
  if(casesNoDocuments.length)chips.push({level:'warning',icon:'&#128196;',label:'قضايا بدون مستندات',count:casesNoDocuments.length,page:'documents'});

  if(!chips.length){
    list.innerHTML='<div class="alerts-center-empty"><span>&#9989;</span><span>لا توجد تنبيهات حالياً — كل شيء تحت السيطرة</span></div>';
    return;
  }
  list.innerHTML=chips.map(function(c){
    return '<div class="alert-chip'+(c.level==='warning'?' warning':'')+'" onclick="navigate(\''+c.page+'\')">'+
      '<span class="alert-chip-icon">'+c.icon+'</span>'+
      '<span class="alert-chip-text">'+c.label+'</span>'+
      '<span class="alert-chip-count">'+c.count+'</span>'+
    '</div>';
  }).join('');
}

function renderDashboard(){
  renderStatisticsWidget();
  renderAlertsWidget();
  renderSessionsWidget();
  renderTasksWidget();
  renderWelcomeWidget();
  renderExtendedStatisticsWidget();
  renderTodayCenterWidget();
  renderAlertsCenterWidget();
  renderKpiWidget();
  renderChartsWidget();
}

function updateBadges(){
  function setBadge(id,val){var el=document.getElementById(id);if(el)el.textContent=val;}
  setBadge('badgeCases',data.cases.length);
  setBadge('badgeSessions',data.sessions.length);
  setBadge('badgeClients',data.clients.length);
  // PHASE 37 — Opponents Module (الخصوم): same pattern as badgeClients
  // just above. data.opponents is guarded with `|| []` because this
  // function can run before opponentsRepository.open() resolves (same
  // race every other entity already tolerates here — dashboard.js has
  // no dependency on load order of any *Repository module).
  setBadge('badgeOpponents',(data.opponents||[]).length);
  // PHASE 38 — Process Server Works Module (أعمال المحضرين): same
  // pattern as badgeOpponents just above.
  setBadge('badgePsw',(data.processServerWorks||[]).length);
  setBadge('badgeChildren',data.children.length);
  setBadge('badgeDocuments',data.documents.length);
  setBadge('badgeTasks',data.tasks.filter(function(t){return t['الحالة']!=='done';}).length);
  setBadge('badgeFees',data.fees.length);
}

// ==================================================================
// PHASE 29.2 — SMART DASHBOARD, PART 2 (additive only)
// ==================================================================
// Adds the KPI section, the Charts section, and the Quick Search box
// from the Smart Dashboard specification. Same rules as Phase 29:
// every new function below is independently callable, owns only the
// container ids documented for it, and nothing above this point in
// the file (including the Phase 29 Part 1 widgets) is modified.
//
// KPI SCOPE NOTE — the spec lists 6 KPIs; only 3 are shown here
// because the other 3 need data this project doesn't currently
// record (see PHASE29_SMART_DASHBOARD_REPORT.md, "KPI" subsection):
// there is no case "closed date" field (only أنواع status + the
// filing date تاريخ_القيد), so "cases closed this month" can't be
// computed — only a running "current completion rate" can. There is
// also no judgments (أحكام) or warnings/إنذارات field anywhere in the
// data model. Inventing those fields is a Forms/Repository-standard
// change, not a rendering one, and is out of scope here.
// ==================================================================

function renderKpiWidget(){
  var grid=document.getElementById('dashKpiGrid');
  if(!grid)return;
  var now=new Date();
  var monthStart=now.getFullYear()+'-'+pad(now.getMonth()+1);
  var newThisMonth=data.cases.filter(function(c){
    var d=c['تاريخ_القيد']||c['تاريخ_الإنشاء'];
    return d&&String(d).slice(0,7)===monthStart;
  }).length;
  var closed=data.cases.filter(function(c){return c['الحالة']==='منتهية';}).length;
  var completionRate=data.cases.length?Math.round((closed/data.cases.length)*100):0;
  var executedSessions=data.sessions.filter(function(s){return s['الحالة']==='منتهية';}).length;

  var kpis=[
    {value:newThisMonth,label:'قضايا جديدة هذا الشهر'},
    {value:completionRate+'%',label:'معدل الإنجاز'},
    {value:executedSessions,label:'جلسات منفذة'}
  ];
  grid.innerHTML=kpis.map(function(k){
    return '<div class="kpi-card"><div class="kpi-value">'+k.value+'</div><div class="kpi-label">'+k.label+'</div></div>';
  }).join('');
}

// Small dependency-free horizontal bar chart renderer shared by all
// three charts below — plain HTML/CSS bars, no canvas/SVG library
// (offline-first app; no CDN chart script is added to PRECACHE_URLS).
function renderDashboardBarChart(containerId,rows){
  var el=document.getElementById(containerId);
  if(!el)return;
  if(!rows.length){el.innerHTML='<div class="chart-empty">لا توجد بيانات كافية</div>';return;}
  var max=Math.max.apply(null,rows.map(function(r){return r.count;}))||1;
  el.innerHTML=rows.map(function(r){
    var pct=Math.round((r.count/max)*100);
    return '<div class="chart-bar-row">'+
      '<div class="chart-bar-label">'+r.label+'</div>'+
      '<div class="chart-bar-track"><div class="chart-bar-fill" style="width:'+pct+'%"></div></div>'+
      '<div class="chart-bar-count">'+r.count+'</div>'+
    '</div>';
  }).join('');
}

function renderChartsWidget(){
  // Cases by type (نوع_الدعوى)
  var byType={};
  data.cases.forEach(function(c){
    var t=c['نوع_الدعوى']||'غير محدد';
    byType[t]=(byType[t]||0)+1;
  });
  var typeRows=Object.keys(byType).map(function(k){return{label:k,count:byType[k]};})
    .sort(function(a,b){return b.count-a.count;}).slice(0,8);
  renderDashboardBarChart('dashChartCaseType',typeRows);

  // Cases by status (الحالة) — fixed, known set of 4 statuses so every
  // bar always shows even at 0, matching the spec's fixed category list.
  var statuses=['نشطة','معلقة','منتهية','مُحالة'];
  var statusRows=statuses.map(function(s){
    return{label:s,count:data.cases.filter(function(c){return c['الحالة']===s;}).length};
  });
  renderDashboardBarChart('dashChartCaseStatus',statusRows);

  // Sessions per month, current calendar year only (matches the
  // spec's "الجلسات خلال السنة" — within the year, not all-time).
  var year=new Date().getFullYear();
  var monthNames=['يناير','فبراير','مارس','أبريل','مايو','يونيو','يوليو','أغسطس','سبتمبر','أكتوبر','نوفمبر','ديسمبر'];
  var perMonth=new Array(12).fill(0);
  data.sessions.forEach(function(s){
    var d=parseLocalDate(s['التاريخ']);
    if(d&&d.getFullYear()===year)perMonth[d.getMonth()]++;
  });
  var sessionRows=monthNames.map(function(name,i){return{label:name,count:perMonth[i]};});
  renderDashboardBarChart('dashChartSessionsYear',sessionRows);
}

// ==================================================================
// PHASE 29.2 — Quick Search
// ==================================================================
// performDashboardQuickSearch() is wired directly to the search
// input's oninput/onfocus in index.html (not called from
// renderDashboard() — it only needs to run when the user types, not
// on every dashboard refresh). Searches only the fields already
// rendered elsewhere in the app for each entity (case number/title/
// opponent, client name, document name, task title, session case
// title) — capped at 20 results total to stay responsive on large
// datasets.
// ==================================================================

function performDashboardQuickSearch(query){
  var box=document.getElementById('dashQuickSearchResults');
  if(!box)return;
  var q=(query||'').trim().toLowerCase();
  if(!q){box.classList.remove('open');box.innerHTML='';return;}

  var results=[];
  function push(type,label,page){if(results.length<20)results.push({type:type,label:label,page:page});}

  data.cases.forEach(function(c){
    var hay=[c['رقم_القضية'],c['عنوان_القضية'],c['اسم_الخصم']].join(' ').toLowerCase();
    if(hay.indexOf(q)!==-1)push('قضية',(c['رقم_القضية']||'')+' — '+(c['عنوان_القضية']||''),'cases');
  });
  data.clients.forEach(function(cl){
    if(String(cl['الاسم']||'').toLowerCase().indexOf(q)!==-1)push('موكل',cl['الاسم'],'clients');
  });
  data.documents.forEach(function(d){
    if(String(d['اسم_المستند']||'').toLowerCase().indexOf(q)!==-1)push('مستند',d['اسم_المستند'],'documents');
  });
  data.tasks.forEach(function(t){
    if(String(t['العنوان']||'').toLowerCase().indexOf(q)!==-1)push('مهمة',t['العنوان'],'tasks');
  });
  data.sessions.forEach(function(s){
    if(String(s['عنوان_القضية']||'').toLowerCase().indexOf(q)!==-1)push('جلسة',(s['عنوان_القضية']||'')+' — '+formatDate(s['التاريخ']),'sessions');
  });

  if(!results.length){
    box.innerHTML='<div class="quick-search-empty">لا توجد نتائج مطابقة</div>';
    box.classList.add('open');
    return;
  }
  box.innerHTML=results.map(function(r){
    return '<div class="quick-search-item" onmousedown="navigate(\''+r.page+'\')">'+
      '<span>'+(r.label||'—')+'</span><span class="qs-type">'+r.type+'</span>'+
    '</div>';
  }).join('');
  box.classList.add('open');
}
