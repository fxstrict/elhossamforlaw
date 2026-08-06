// ==================================================================
// SETTINGS MODULE — js/modules/settings.js
// Extracted from index.html — Phase 12A (Extraction Only)
// ==================================================================
// LOAD ORDER REQUIREMENT:
// This file depends on globals defined in the main inline <script> block
// of index.html (API_URL, DRIVE_URL, data, toast(), saveLocal(),
// updateBadges(), renderDashboard(), loadFromSheets()).
// It must be loaded AFTER that inline script block, in the same position
// as the other already-extracted modules (tasks.js, documents.js,
// sessions.js, clients.js, fees.js, library.js, templates.js).
// This file is NOT yet wired into index.html (no <script> tag added) —
// integration is deferred to a later phase per instructions.
// ==================================================================

// SETTINGS

// ------------------------------------------------------------------
// PHASE 17.2 — Production Mode gate for Developer Diagnostics.
//
// EVIDENCE: this project has no build step (package.json is test-only,
// see js/tests/; there is no bundler, no NODE_ENV, no separate
// production/development artifact — index.html is served as-is in every
// environment). So "production" cannot be detected at build time; it can
// only be treated as "the default state every installed copy starts in",
// with a deliberate, non-accidental local action required to leave it.
//
// Before this phase, the "Developer Diagnostics" card in Settings
// (#developerDiagnosticsCard, index.html) was unconditionally visible and
// its checkbox unconditionally usable by ANY user — the only thing gated
// was the diagnostics framework itself (js/debug/RuntimeDebugLayer.js's
// own __RDL_DIAGNOSTICS_ENABLED__ master switch, off by default, which
// this phase does not touch and does not need to touch: it already has
// zero cost when off). The gap this phase closes is upstream of that:
// reaching the switch at all. Developer Mode below is that gate — a
// second, independent, hidden-by-default local flag
// (__DEV_MODE_UNLOCKED__) that must be unlocked before the diagnostics
// card's toggle is even shown. Production installs, by default, never
// see it. Nothing here touches RuntimeDebugLayer.js.
// ------------------------------------------------------------------
var DEV_MODE_KEY='__DEV_MODE_UNLOCKED__';
var DEV_MODE_TAPS_REQUIRED=7;
var DEV_MODE_TAP_WINDOW_MS=3000;
var _devModeTapCount=0;
var _devModeTapTimer=null;

function isDeveloperModeUnlocked(){
  try{ return localStorage.getItem(DEV_MODE_KEY)==='true'; }catch(e){ return false; }
}

function handleDevModeTitleTap(){
  if(isDeveloperModeUnlocked()) return; // already unlocked, nothing to count
  _devModeTapCount++;
  if(_devModeTapTimer) clearTimeout(_devModeTapTimer);
  _devModeTapTimer=setTimeout(function(){ _devModeTapCount=0; },DEV_MODE_TAP_WINDOW_MS);
  if(_devModeTapCount>=DEV_MODE_TAPS_REQUIRED){
    _devModeTapCount=0;
    if(_devModeTapTimer){ clearTimeout(_devModeTapTimer); _devModeTapTimer=null; }
    try{ localStorage.setItem(DEV_MODE_KEY,'true'); }catch(e){}
    toast('تم تفعيل وضع المطوّر','success');
    refreshDeveloperDiagnosticsToggle();
  }
}

// ------------------------------------------------------------------
// PHASE 17.3.1 — Developer Diagnostics (permanent, hidden-by-default
// runtime diagnostics framework; see js/debug/RuntimeDebugLayer.js).
// This is a pure UI wrapper around window.RuntimeDebug.enableDiagnostics()/
// disableDiagnostics(), which itself just persists one localStorage flag.
// The actual framework only (re)installs on the NEXT load, since it must
// be the first <script> in <head> to see the flag before anything else
// registers a listener/timer — so toggling here reloads the app.
// PHASE 17.2 update: this UI is now only reachable once Developer Mode
// (above) has been unlocked; production installs stay on the locked view.
// ------------------------------------------------------------------
function refreshDeveloperDiagnosticsToggle(){
  var cb=document.getElementById('devDiagnosticsToggle');
  var hint=document.getElementById('devDiagnosticsHint');
  var locked=document.getElementById('devDiagnosticsLocked');
  var unlocked=document.getElementById('devDiagnosticsUnlocked');
  if(!cb) return;
  var devModeOn=isDeveloperModeUnlocked();
  if(locked) locked.style.display=devModeOn?'none':'';
  if(unlocked) unlocked.style.display=devModeOn?'':'none';
  if(!devModeOn) return; // locked view is showing; nothing else to populate
  var enabled=(typeof window.RuntimeDebug!=='undefined' && window.RuntimeDebug.isDiagnosticsEnabled && window.RuntimeDebug.isDiagnosticsEnabled());
  cb.checked=!!enabled;
  if(hint) hint.textContent=enabled?'مفعّلة — سيظهر زر RD العائم أسفل يسار الشاشة.':'غير مفعّلة — لا يعمل أي شيء ولا تأثير على الأداء.';
}

function toggleDeveloperDiagnostics(checked){
  if(!isDeveloperModeUnlocked()){toast('وضع المطوّر غير مفعّل','error');return;}
  if(typeof window.RuntimeDebug==='undefined'){toast('تعذر الوصول لأداة التشخيص','error');return;}
  if(checked){
    window.RuntimeDebug.enableDiagnostics();
    toast('سيتم تفعيل أدوات التشخيص بعد إعادة تحميل التطبيق...','success');
  }else{
    window.RuntimeDebug.disableDiagnostics();
    toast('تم إيقاف أدوات التشخيص','success');
  }
  setTimeout(function(){ location.reload(); },600);
}

function saveApiUrl(){API_URL=document.getElementById('apiUrlInput').value.trim();_persistSetting('apiUrl',API_URL);toast('تم حفظ الرابط','success');updateConnectionStatus();}
function saveDriveUrl(){DRIVE_URL=document.getElementById('driveUrlInput').value.trim();_persistSetting('driveUrl',DRIVE_URL);var b=document.getElementById('driveOpenBtn');if(DRIVE_URL){b.href=DRIVE_URL;b.style.display='';}else b.style.display='none';toast('تم حفظ رابط Drive','success');}

async function testConnection(){
  var url=document.getElementById('apiUrlInput').value.trim();
  if(!url){toast('أدخل الرابط أولاً','error');return;}
  var res=document.getElementById('connectionResult');
  res.innerHTML='<span style="color:var(--muted)">⏳ جارٍ الاتصال وإعداد جدول البيانات...</span>';
  try{
    // Step 1: setup (creates spreadsheet if needed)
    var r=await fetch(url+'?action=setup',{signal:AbortSignal.timeout(30000)});
    var d=await r.json();
    if(d.status==='ok'){
      API_URL=url;
      _persistSetting('apiUrl',url);
      updateConnectionStatus();
      // Step 2: ping to get sheet URL
      try{
        var r2=await fetch(url+'?action=ping',{signal:AbortSignal.timeout(10000)});
        var d2=await r2.json();
        var sheetUrl = d2.spreadsheet_url || d.spreadsheet_url || '';
        if(sheetUrl){
          displaySheetUrl(sheetUrl);
          res.innerHTML='<span style="color:var(--success)">✅ الاتصال ناجح! جدول البيانات جاهز — جارٍ تحميل البيانات...</span>';
        } else {
          res.innerHTML='<span style="color:var(--success)">✅ الاتصال ناجح! جارٍ تحميل البيانات...</span>';
        }
      }catch(pe){
        res.innerHTML='<span style="color:var(--success)">✅ الاتصال ناجح! جارٍ تحميل البيانات...</span>';
      }
      setTimeout(loadFromSheets,800);
    } else {
      res.innerHTML='<span style="color:var(--danger)">✗ خطأ: '+(d.error||'غير معروف')+'</span>';
    }
  }catch(e){
    res.innerHTML='<span style="color:var(--danger)">✗ فشل الاتصال — تحقق من الرابط وإعدادات النشر<br><small>'+e.message+'</small></span>';
  }
}

function displaySheetUrl(url){
  if(!url) return;
  var box=document.getElementById('sheetUrlBox');
  var inp=document.getElementById('sheetUrlDisplay');
  var btn=document.getElementById('sheetOpenBtn');
  if(box) box.style.display='block';
  if(inp) inp.value=url;
  if(btn){ btn.href=url; }
  _persistSetting('sheetUrl', url);
}

function copySheetUrl(){
  var inp=document.getElementById('sheetUrlDisplay');
  if(!inp||!inp.value) return;
  navigator.clipboard.writeText(inp.value).then(function(){ toast('تم نسخ رابط الشيت','success'); });
}

function updateConnectionStatus(){
  var dot=document.getElementById('statusDot'),tx=document.getElementById('statusText');
  if(API_URL){dot.classList.add('connected');dot.classList.remove('error');tx.textContent='متصل بـ Google Sheets';}
  else{dot.classList.remove('connected','error');tx.textContent='غير متصل بـ Sheets';}
  // PHASE UX-03A: small non-blocking notice in Settings ("أنت تعمل حالياً
  // بالوضع المحلي...") — visible only while no Google URL is configured.
  // Reuses this same function (already the single place connection-state
  // changes flow through) instead of adding a new call site.
  var notice=document.getElementById('localModeNotice');
  if(notice)notice.style.display=API_URL?'none':'flex';
  if(typeof updateTopbarSyncMeta==='function')updateTopbarSyncMeta();
}
async function pingConnection(){
  if(!API_URL)return;
  try{
    var r=await fetch(API_URL+'?action=ping',{signal:AbortSignal.timeout(8000)});
    var d=await r.json();
    var dot=document.getElementById('statusDot'),tx=document.getElementById('statusText');
    if(d.status==='ok'){
      dot.classList.add('connected');dot.classList.remove('error');
      tx.textContent='متصل ✓ v'+(d.version||'');
      if(d.spreadsheet_url) displaySheetUrl(d.spreadsheet_url);
    } else {
      dot.classList.remove('connected');dot.classList.add('error');tx.textContent='خطأ في الاتصال';
    }
  }catch(e){
    var dot=document.getElementById('statusDot'),tx=document.getElementById('statusText');
    dot.classList.remove('connected');dot.classList.add('error');tx.textContent='تعذر الاتصال';
  }
  if(typeof updateTopbarSyncMeta==='function')updateTopbarSyncMeta();
}

// PHASE 13.2 — LEGACY STORAGE CLEANUP
// handleImport()/clearAllData() used to mutate `data.*` directly and
// persist ONLY via saveLocal() -> localStorage, never touching any
// Repository at all (a confirmed bypass, not merely a duplicate write —
// see Legacy_Storage_Cleanup_Report.md finding F-01/F-02). Repository.js's
// own doc comments for import()/clear() already state they are "used by
// clearAllData()" / match "loadFromSheets behavior" — this helper is the
// first code to actually wire that up. Every entity's Repository is
// resolved by naming convention (`<key>Repository` / `<key>RepositoryReadyPromise`,
// consistent across all 9 entity modules); an entity with no Repository
// (there are none today, but this stays defensive) is simply skipped.
async function _persistEntityViaRepository(key, mode, entities) {
  var repo = window[key + 'Repository'];
  var readyPromise = window[key + 'RepositoryReadyPromise'];
  if (!repo || !readyPromise) return null;
  try {
    await readyPromise;
    if (mode === 'clear') return await repo.clear();
    return await repo.import(entities || [], 'replace');
  } catch (e) {
    console.warn('Repository persist failed for "' + key + '":', e);
    return null;
  }
}

// PHASE 13.4 — PART 2B: SettingsRepository INTEGRATION
// The confirmed LocalStorage keys owned by this module (apiUrl, driveUrl,
// sheetUrl, lastSyncAt — per docs/phase13/REFERENCE_MAP.md "Migration
// References"; localModeChosen belongs to firstrun.js, Part 3) are now
// written through the already-wired `settingsRepository` /
// `settingsRepositoryReadyPromise` (js/repositories/SettingsRepositoryWiring.js)
// instead of directly via localStorage.setItem(). This mirrors the exact
// same fire-and-forget-after-ready idiom `_persistEntityViaRepository()`
// (above) already uses for entity data: wait for the existing ready
// promise, then write; log and swallow failures instead of throwing, so
// no caller's control flow, timing, or return value changes — the write
// was fire-and-forget via a synchronous localStorage.setItem() before,
// and remains fire-and-forget (now via a Promise) after.
// No LocalStorage migration is performed here (deferred to Part 4) and
// LocalStorage itself is left untouched (no removeItem calls existed for
// these keys, and none are added).
function _persistSetting(key, value) {
  settingsRepositoryReadyPromise.then(function () {
    return settingsRepository.set(key, value);
  }).catch(function (e) {
    console.warn('Settings persist failed for "' + key + '":', e);
  });
}

function exportData(){var b=new Blob([JSON.stringify(data,null,2)],{type:'application/json'});var a=document.createElement('a');a.href=URL.createObjectURL(b);a.download='lawyer_backup_'+new Date().toISOString().slice(0,10)+'.json';a.click();toast('تم التصدير','success');}
function importData(){document.getElementById('importFile').click();}
function handleImport(evt){
  var f=evt.target.files[0];if(!f)return;
  var r=new FileReader();
  r.onload=async function(e){
    try{
      var im=JSON.parse(e.target.result);
      if(typeof im!=='object'||Array.isArray(im)){toast('الملف غير صالح — يجب أن يكون ملف JSON صادراً من هذا النظام','error');return;}
      var imported=0;
      var keys=Object.keys(data);
      for(var i=0;i<keys.length;i++){
        var k=keys[i];
        if(im[k]&&Array.isArray(im[k])){
          await _persistEntityViaRepository(k,'import',im[k]);
          data[k]=im[k];
          imported++;
          // PHASE 16.5.1 — DIRTY PROPAGATION (additive only, see phase brief)
          if(window.ApplicationShell)ApplicationShell.markDirty(k);
        }
      }
      if(!imported){toast('لم يُعثر على بيانات صالحة في الملف','error');return;}
      updateBadges();renderDashboard();
      // PHASE 16.5.1 — DIRTY PROPAGATION (additive only, see phase brief)
      // Import can touch any subset of the 9 entity keys above, and we
      // cannot cheaply tell in advance whether that subset included
      // cases/sessions/clients/tasks (the entities dashboard.js/calendar.js
      // read) without adding extra logic beyond markDirty calls — so both
      // are marked dirty here unconditionally whenever any import succeeded.
      if(window.ApplicationShell){ApplicationShell.markDirty('dashboard');ApplicationShell.markDirty('calendar');}
      toast('تم الاستيراد بنجاح ('+imported+' مجموعات بيانات)','success');
    }catch(err){toast('خطأ في قراءة الملف — تأكد أنه ملف JSON صحيح','error');}
  };
  r.readAsText(f);
}
async function clearAllData(){
  if(!(await confirmDialog('مسح كل البيانات المحلية؟ لا يمكن التراجع!','تأكيد المسح')))return;
  var keys=['cases','sessions','clients','children','documents','tasks','fees','library','templates','clientMessages'];
  for(var i=0;i<keys.length;i++){ await _persistEntityViaRepository(keys[i],'clear'); }
  // PHASE 13.8 — CONFIRMED ROOT CAUSE FIX (Bug B, part 1 of 2):
  // saveLocal() has been a no-op since PHASE 13.2 (see its own comment
  // above), but the ORIGINAL localStorage.setItem() writes it used to
  // make for these same 9 keys were never removed — clearAllData() only
  // ever cleared each Repository (IndexedDB), never these legacy keys.
  // index.html's inline bootstrap script re-seeds the in-memory `data`
  // object directly from these exact localStorage keys on every page
  // load (before any Repository opens), so a stale pre-clear snapshot
  // was being reloaded on every refresh. Removing them here is the
  // same one-time cleanup clearAllData() already does for the
  // Repository copy, applied to the one remaining legacy copy — no
  // other localStorage key (apiUrl/driveUrl/sheetUrl/lastSyncAt/
  // localModeChosen) is touched, and no other function is changed.
  for(var j=0;j<keys.length;j++){ localStorage.removeItem(keys[j]); }
  data={cases:[],sessions:[],clients:[],children:[],documents:[],tasks:[],fees:[],library:[],templates:[]};
  updateBadges();renderDashboard();
  // PHASE 16.5.1 — DIRTY PROPAGATION (additive only, see phase brief)
  // clearAllData() always wipes all 9 entity keys unconditionally (see
  // `keys` above), so every one of them, plus dashboard and calendar
  // (which read cases/sessions/clients/tasks), is marked dirty here.
  if(window.ApplicationShell){
    for(var m=0;m<keys.length;m++){ApplicationShell.markDirty(keys[m]);}
    ApplicationShell.markDirty('dashboard');
    ApplicationShell.markDirty('calendar');
  }
  toast('تم المسح','info');
}

// ---- Extracted below: functions copied byte-identical from index.html ----
// (saveDriveFromModal, syncToSheets, syncDeleteToSheets, loadFromSheets, refreshAll)
// Source: index.html inline <script> block (Settings/Sync section).
// Per SETTINGS_INTEGRATION_AUDIT_REPORT.md Section 1 / Required Changes #2.

function saveDriveFromModal(){DRIVE_URL=document.getElementById('fDriveUrl').value.trim();_persistSetting('driveUrl',DRIVE_URL);closeModal('modalDrive');toast('تم ربط Google Drive','success');}

// SYNC — إصلاح CORS: نرسل text/plain
async function syncToSheets(sheet,rowData,rowIndex){
  if(!API_URL)return;
  try{var action=rowIndex>=0?'update':'add';var body={action:action,sheet:sheet,data:rowData};if(action==='update')body.rowIndex=rowIndex+1;await fetch(API_URL,{method:'POST',body:JSON.stringify(body),headers:{'Content-Type':'text/plain'}});}catch(e){console.warn('Sync:',e);}
}
async function syncDeleteToSheets(sheet,rowIndex){
  if(!API_URL)return;
  try{await fetch(API_URL,{method:'POST',body:JSON.stringify({action:'delete',sheet:sheet,rowIndex:rowIndex+1}),headers:{'Content-Type':'text/plain'}});}catch(e){console.warn('Delete:',e);}
}

// Non-blocking background sync indicator — never covers the UI (unlike showLoading/#loadingOverlay).
// PHASE UX-02: extended to a small state machine instead of a plain show/hide toggle:
//   showSyncIndicator(true)      -> "جارٍ المزامنة…" (syncing, pulsing dot)
//   showSyncIndicator('success') -> "تمت المزامنة" (green, auto-hides after 2.5s)
//   showSyncIndicator('error')   -> "العمل بالبيانات المحلية" (red, auto-hides after 4s)
//   showSyncIndicator(false)     -> hidden immediately (unchanged legacy behavior)
// The app remains fully usable in every state; this only touches a small pill in
// the topbar, never a screen-covering overlay.
var _syncIndicatorHideTimer=null;
function showSyncIndicator(v){
  // PHASE UX-03: this stays the single entry point for every sync-state
  // transition in the app. It still drives the transient floating pill
  // (#syncIndicator, unchanged behavior below) AND now also drives the
  // persistent topbar status (#topbarLastSync) via _topbarSyncState +
  // updateTopbarSyncMeta() — so the two widgets can never say different
  // things, and no sync event needs to be handled in more than one place.
  var el=document.getElementById('syncIndicator');
  var textEl=el?document.getElementById('syncIndicatorText'):null;
  if(_syncIndicatorHideTimer){clearTimeout(_syncIndicatorHideTimer);_syncIndicatorHideTimer=null;}
  if(_topbarSyncSuccessTimer){clearTimeout(_topbarSyncSuccessTimer);_topbarSyncSuccessTimer=null;}
  if(el)el.classList.remove('success','error');
  if(v===true){
    if(textEl)textEl.textContent='جارٍ المزامنة…';
    if(el)el.classList.add('show');
    _topbarSyncState='syncing';
    if(typeof updateTopbarSyncMeta==='function')updateTopbarSyncMeta();
  }else if(v==='success'){
    if(textEl)textEl.textContent='تمت المزامنة';
    if(el)el.classList.add('show','success');
    _syncIndicatorHideTimer=setTimeout(function(){if(el)el.classList.remove('show','success');},2500);
    // Persistent widget: show the ✅ confirmation for 3s (per spec), then
    // fall back to idle — which recomputes the relative time from the
    // lastSyncAt timestamp the caller already saved (typically "منذ لحظات").
    _topbarSyncState='success';
    if(typeof updateTopbarSyncMeta==='function')updateTopbarSyncMeta();
    _topbarSyncSuccessTimer=setTimeout(function(){
      _topbarSyncState=null;
      if(typeof updateTopbarSyncMeta==='function')updateTopbarSyncMeta();
    },3000);
  }else if(v==='error'){
    if(textEl)textEl.textContent='العمل بالبيانات المحلية';
    if(el)el.classList.add('show','error');
    _syncIndicatorHideTimer=setTimeout(function(){if(el)el.classList.remove('show','error');},4000);
    // Persistent widget: stays on the ⚠️ error state (does not auto-hide,
    // does not get overwritten by the 60s interval) until the next sync
    // attempt calls showSyncIndicator(true) or ('success') again.
    _topbarSyncState='error';
    if(typeof updateTopbarSyncMeta==='function')updateTopbarSyncMeta();
  }else{
    if(el)el.classList.remove('show');
    // v===false: clears only the transient pill (legacy behavior,
    // unchanged). The persistent widget is intentionally left alone —
    // it is about to receive its real state a moment later (success/
    // error) from the same loadFromSheets() call that triggered this.
  }
}

// ==================================================================
// PHASE UX-03 HOTFIX — Professional Last-Sync Status (Top Bar)
// ==================================================================
// Design in one paragraph: #topbarLastSync becomes a small persistent
// status area (Notion/Drive/Dropbox-style) driven by a single state
// variable (_topbarSyncState) and rendered by a single function
// (updateTopbarSyncMeta, below). Every sync event already funnels
// through showSyncIndicator() (PHASE UX-02) — that remains the ONLY
// call site that changes sync state, so the logic is not duplicated
// anywhere else. A single setInterval (60s, text-only, no fetch) keeps
// the relative time ("منذ دقيقة"/"منذ ساعة"/...) fresh while idle.
// Does not touch Repository/Database/Cache/Undo/Boot/Apps Script.
// ==================================================================

// The ONLY function that turns a timestamp into "منذ ..." text. Used by
// updateTopbarSyncMeta() and nowhere else, so phrasing can never drift.
function formatLastSyncRelative(iso){
  if(!iso)return null;
  var then=new Date(iso).getTime();
  if(isNaN(then))return null;
  var diffSec=Math.max(0,Math.floor((Date.now()-then)/1000));
  if(diffSec<60)return'منذ لحظات';
  var m=Math.floor(diffSec/60);
  if(m<60){
    if(m===1)return'منذ دقيقة';
    if(m===2)return'منذ دقيقتين';
    if(m<=10)return'منذ '+m+' دقائق';
    return'منذ '+m+' دقيقة';
  }
  var h=Math.floor(diffSec/3600);
  if(h<24){
    if(h===1)return'منذ ساعة';
    if(h===2)return'منذ ساعتين';
    if(h<=10)return'منذ '+h+' ساعات';
    return'منذ '+h+' ساعة';
  }
  var d=Math.floor(diffSec/86400);
  if(d===1)return'منذ يوم';
  if(d===2)return'منذ يومين';
  if(d<=10)return'منذ '+d+' أيام';
  return'منذ '+d+' يوم';
}

// 'syncing' | 'success' | 'error' | null(=idle, show relative time / local-data fallback)
var _topbarSyncState=null;
var _topbarSyncSuccessTimer=null;
var _topbarSyncIntervalStarted=false;

// PHASE 12.6B §14/§15 — Adaptive TopBar sync status (never hidden).
// Previously #topbarLastSync lived inside .topbar-meta, which mobile's
// `display:none` rule hid ENTIRELY (see css/responsive.css) — the exact
// bug this phase closes. The fix is NOT to keep forcing it visible with
// one long string; it's to render THREE ready-made text variants (full /
// compact / chip) into three sibling spans every time state changes, and
// let CSS (see .tls-full/.tls-compact/.tls-chip media queries in
// css/components.css) pick exactly one per breakpoint. No resize
// listener, no layout thrash — plain CSS `display` toggling.
// This is the ONLY function that writes to #topbarLastSync's children.
function updateTopbarSyncMeta(){
  var dot=document.getElementById('topbarConnDot'),tx=document.getElementById('topbarConnText');
  if(dot&&tx){
    if(API_URL){dot.classList.add('connected');dot.classList.remove('error');tx.textContent='متصل بـ Sheets';}
    else{dot.classList.remove('connected','error');tx.textContent='محلي فقط';}
  }
  var fullEl=document.getElementById('tlsFull');
  var compactEl=document.getElementById('tlsCompact');
  var chipDotEl=document.getElementById('tlsChipDot');
  var chipTextEl=document.getElementById('tlsChipText');
  var lsEl=document.getElementById('topbarLastSync');
  if(lsEl&&fullEl&&compactEl&&chipDotEl&&chipTextEl){
    lsEl.classList.remove('is-syncing','is-success','is-error','is-idle','is-neversynced');
    var state=_topbarSyncState;
    var full,compact,chipText,chipClass,stateClass;
    if(state==='syncing'){
      full='🟡 جارٍ المزامنة...';compact='🟡 جارٍ...';chipText='جارٍ...';chipClass='tls-dot-syncing';stateClass='is-syncing';
    }else if(state==='success'){
      full='✅ تمت المزامنة';compact='✓ تمت المزامنة';chipText='الآن';chipClass='tls-dot-success';stateClass='is-success';
    }else if(state==='error'){
      full='⚠️ تعذر الاتصال — العمل بالبيانات المحلية';compact='🔴 محلي';chipText='محلي';chipClass='tls-dot-error';stateClass='is-error';
    }else{
      // PHASE 13.4 — PART 14: STARTUP READINESS GUARD
      // This function can be invoked (via updateConnectionStatus(), called
      // synchronously at index.html's very first DOMContentLoaded line, and
      // via hideSplashAndCheckFirstRun() on its own fixed timers) before
      // settingsRepository.open() has resolved. Repository.prototype.get()
      // throws in that state (Repository.js _guardReady()) — approved Part
      // 13 root cause. Guard with the repository's own public isReady()
      // (no Repository.js/SettingsRepository.js change) and fall back to
      // the same "not found" value get() itself already returns
      // (undefined) when not yet ready — identical effective behavior to a
      // key that was never set, no throw, no wait, no new promise/timer.
      var ts=(settingsRepository.isReady && settingsRepository.isReady())?settingsRepository.get('lastSyncAt'):undefined;
      var rel=formatLastSyncRelative(ts);
      if(rel){
        full='🕒 آخر مزامنة '+rel;compact='✓ '+rel;chipText=rel;chipClass='tls-dot-success';stateClass='is-idle';
      }else{
        full='📂 آخر مزامنة — من البيانات المحلية';compact='⚪ لم تتم';chipText='لم تتم';chipClass='tls-dot-neversynced';stateClass='is-neversynced';
      }
    }
    fullEl.textContent=full;
    compactEl.textContent=compact;
    chipTextEl.textContent=chipText;
    chipDotEl.className='tls-chip-dot '+chipClass;
    lsEl.classList.add(stateClass);
  }
  var nameEl=document.getElementById('topbarUserName');
  if(nameEl){
    var uname=localStorage.getItem('userName');
    if(uname){nameEl.textContent=uname;nameEl.style.display='';}
    else nameEl.style.display='none';
  }
  // Single interval, started once, browser-only: re-renders the relative
  // text every 60s while idle. No fetch, no request, no state mutation —
  // just calls this same function again.
  if(!_topbarSyncIntervalStarted&&typeof window!=='undefined'&&typeof window.setInterval==='function'){
    _topbarSyncIntervalStarted=true;
    window.setInterval(function(){
      if(_topbarSyncState===null)updateTopbarSyncMeta();
    },60000);
  }
}

// PHASE 14.1 — CONCURRENCY GUARD
// Module-level flag preventing two or more loadFromSheets() executions from
// running at the same time (multiple call sites exist: automatic boot calls
// in index.html, testConnection(), refreshAll()). No business logic below
// is altered — a call that arrives while another is already in progress is
// simply a no-op.
var _loadFromSheetsInProgress=false;

// PHASE 12.4B — INSTANT STARTUP HOTFIX
// Local data is already rendered before this runs (see DOMContentLoaded in index.html).
// This function must NEVER block the UI: no full-screen overlay, requests run in parallel
// (not sequentially), each with a timeout, and failures never clear local data or freeze startup.
async function loadFromSheets(){
  if(!API_URL)return;
  if(_loadFromSheetsInProgress)return;
  _loadFromSheetsInProgress=true;
  try{
    showSyncIndicator(true);
    var pairs=[['القضايا','cases'],['الجلسات','sessions'],['الموكلين','clients'],['الأطفال','children'],['المستندات','documents'],['المهام','tasks'],['الأتعاب','fees'],['رسائل_الموكل','clientMessages']];
    var results=await Promise.all(pairs.map(async function(pair){
      var sh=pair[0],k=pair[1];
      try{
        var r=await fetch(API_URL+'?sheet='+encodeURIComponent(sh),{signal:AbortSignal.timeout(8000)});
        var arr=await r.json();
        if(Array.isArray(arr)&&arr.length>0){
          if(sh==='الجلسات'){arr=arr.map(function(row){if(row['الوقت'])row['الوقت']=sanitizeTime(row['الوقت']);return row;});}
          await _persistEntityViaRepository(k,'import',arr);
          data[k]=arr;
          // PHASE 16.5.1 — DIRTY PROPAGATION (additive only, see phase brief)
          if(window.ApplicationShell)ApplicationShell.markDirty(k);
          return 'loaded';
        }
        return 'empty';
      }catch(e){
        console.warn('Load '+sh+':',e);
        return 'failed';
      }
    }));
    showSyncIndicator(false);
    var loaded=results.filter(function(r){return r==='loaded';}).length;
    var failed=results.filter(function(r){return r==='failed';}).length;
    if(loaded>0){
      updateBadges();renderDashboard();
      // PHASE 16.5.1 — DIRTY PROPAGATION (additive only, see phase brief)
      // Same reasoning as handleImport(): any subset of the 7 synced
      // keys above may have loaded, so dashboard+calendar (which read
      // cases/sessions/clients/tasks) are marked dirty unconditionally
      // whenever at least one sheet loaded successfully.
      if(window.ApplicationShell){ApplicationShell.markDirty('dashboard');ApplicationShell.markDirty('calendar');}
      _persistSetting('lastSyncAt',new Date().toISOString());
      if(typeof updateTopbarSyncMeta==='function')updateTopbarSyncMeta();
      showSyncIndicator('success');
      toast('تم تحديث البيانات من Sheets ('+loaded+' أوراق)','success');
    }else if(failed===pairs.length){
      // Total sync failure (offline / Apps Script unreachable): keep working on local data.
      showSyncIndicator('error');
      toast('تعذرت المزامنة مع Sheets — العمل بالبيانات المحلية','error');
    }else{
      _persistSetting('lastSyncAt',new Date().toISOString());
      if(typeof updateTopbarSyncMeta==='function')updateTopbarSyncMeta();
      showSyncIndicator('success');
      toast('الاتصال نجح — لا توجد بيانات جديدة في الأوراق','info');
    }
  }finally{
    _loadFromSheetsInProgress=false;
  }
}

async function refreshAll(){if(API_URL)await loadFromSheets();else toast('أضف رابط Apps Script في الإعدادات للمزامنة السحابية','info');renderDashboard();}

// ==================================================================
// Node/test export (browser: `module` is undefined, this is a no-op —
// every function above remains a plain global exactly as before).
// PHASE UX-03: exposes formatLastSyncRelative for the pure-function
// test harness (js/tests/verify_topbar_sync_status.js).
// ==================================================================
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    formatLastSyncRelative: formatLastSyncRelative
  };
}
