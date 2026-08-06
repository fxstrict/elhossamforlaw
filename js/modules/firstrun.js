// ==================================================================
// FIRST RUN MODULE — js/modules/firstrun.js
// Added in PHASE UX-01 (First Run Experience + Branding + Onboarding)
// ==================================================================
// SCOPE: UI only. Does not read/write DatabaseService, StorageAdapter,
// LocalStorageAdapter, UndoManager, or any Cache/Sync internals. Only
// touches:
//   - the settings keys 'apiUrl' and 'localModeChosen', persisted via
//     SettingsRepository (js/repositories/SettingsRepositoryWiring.js —
//     `settingsRepository` / `settingsRepositoryReadyPromise`), the
//     same confirmed migration keys/repository already integrated in
//     settings.js (PHASE 13.4 PART 2). 'apiUrl' is the exact same key
//     written by saveApiUrl()/testConnection() in settings.js — this
//     file writes to the same repository record, nothing new.
//     (PHASE 13.4 PART 3 — migrated off localStorage.)
//   - the global API_URL variable (declared in index.html's inline
//     bootstrap script)
//   - DOM elements added in index.html for the splash screen and the
//     first-run wizard (#splashScreen, #firstRunWizard, and children)
//
// LOAD ORDER REQUIREMENT: must load after the main inline <script>
// block in index.html (needs API_URL, toast(), data), after
// settings.js (calls its updateConnectionStatus()/loadFromSheets() if
// present, both guarded with typeof checks so this file degrades
// gracefully even if settings.js were ever reordered), and after
// js/repositories/SettingsRepositoryWiring.js (needs the already-wired
// `settingsRepository` / `settingsRepositoryReadyPromise` globals —
// same load-order requirement settings.js itself relies on).
// ==================================================================

// Record the moment this file was parsed — used as the splash's
// "start" timestamp so the minimum-visible-time calculation below is
// accurate even though DOMContentLoaded fires slightly later.
window.__splashStart = window.__splashStart || Date.now();

// SUB-TASK "Splash Timing Polish" (independent of the phased roadmap —
// touches only this file's two timing constants + the splash CSS in
// css/components.css; no architecture/Boot/Nav/Render/Repository file
// touched, no new library added).
//
// MIN_VISIBLE_MS is the minimum time the splash stays fully visible
// before firstrun.js is allowed to start hiding it. It is set to match
// the moment the LAST staged element in the sequential CSS reveal
// timeline (css/components.css: logo → title → subtitle → version →
// contact → footer) finishes appearing (2.4s start + .5s duration =
// 2.9s), plus a short hold so the fully-revealed screen is actually
// readable (goal: total visible time, including the .6s fade-out
// transition already defined on .splash-screen, lands in the 3–4s
// range the user asked for: 3.3s hold-start + .6s fade-out ≈ 3.9s).
// This guarantees requirement #5 ("if init finishes before the
// animation, wait for the animation to finish before leaving") by
// construction — hideSplashAndCheckFirstRun() is simply never called
// before the animation timeline above has completed.
var MIN_VISIBLE_MS = 3300;

// Hard safety cap — a last-resort ceiling in case DOMContentLoaded is
// somehow delayed far longer than usual. Raised from the previous
// 1.5s (which was SHORTER than the new sequential animation and would
// have cut it off) to 6s, comfortably above MIN_VISIBLE_MS, so it can
// only ever fire as a genuine failsafe and never truncates the normal
// splash sequence. This still never waits on Google Sheets/API sync —
// loadFromSheets() already runs fully in the background (Promise.all +
// per-request timeout, see settings.js) and is never awaited here,
// which also satisfies requirement #6 ("if init takes longer than the
// animation, keep showing the splash until init completes"): the real
// local-data init this comment refers to (updateBadges()/
// renderDashboard()) runs synchronously in the inline bootstrap
// script's own DOMContentLoaded listener, registered before this
// file's — so by the time the timer below can fire, that init has, in
// practice, already finished; this cap exists purely as a ceiling for
// an abnormally slow DOMContentLoaded, not as the normal exit path.
setTimeout(function () {
  hideSplashAndCheckFirstRun();
}, 6000);

// BUGFIX (splash overlapping app content during sync) — previously the
// splash was hidden ONLY by these fixed timers (MIN_VISIBLE_MS / the
// 6000ms hard cap below), with no connection at all to whether the app
// underneath had actually finished rendering. On a slow boot (e.g. a sync
// still in flight) the real page — topbar, lists, cards — could already
// be fully rendered and interactive several seconds before either timer
// fired, so it sat there right under the still-visible/still-animating
// splash, reading as the splash "jittering" and "overlapping" the list
// beneath it. BootManager (js/core/boot/BootManager.js) already dispatches
// a single 'application:ready' event the moment hydration + its own
// skeleton teardown are done — listening for it here just lets the splash
// hide as soon as content is genuinely ready, in addition to (never
// instead of) the existing timers, so it never lingers over live content
// longer than necessary. hideSplashAndCheckFirstRun() is already
// idempotent (guards with classList.contains('splash-hide')), so this
// cannot double-fire or fight with the timers above.
window.addEventListener('application:ready', function () {
  hideSplashAndCheckFirstRun();
});

window.addEventListener('DOMContentLoaded', function () {
  // The inline bootstrap script's own DOMContentLoaded listener (which
  // renders local data: updateBadges()/renderDashboard()) is
  // registered before this one (it is declared earlier in the
  // document), so by the time this listener runs, local data is
  // already on screen. We wait out whatever is left of MIN_VISIBLE_MS
  // so the splash is never dismissed mid-animation (requirement #5)
  // and always reads as a deliberate, fully-readable brand moment
  // rather than a flicker.
  var elapsed = Date.now() - window.__splashStart;
  var remaining = Math.max(0, MIN_VISIBLE_MS - elapsed);
  setTimeout(function () {
    hideSplashAndCheckFirstRun();
  }, remaining);
});

// ==================================================================
// PHASE 29 — CONFIRMED ROOT CAUSE FIX (Splash/Wizard Cross-Fade Race)
// ------------------------------------------------------------------
// Root cause (see engineering investigation report, first-run-only
// bug: large blurred gap / flickering / "ghosted" text over the
// dashboard on the VERY FIRST boot only, gone after any refresh):
//
//   hideSplashAndCheckFirstRun() used to add '.splash-hide' to
//   #splashScreen (.6s opacity/visibility/transform fade-out, see
//   css/components.css) and call checkFirstRunWizard() — which, on a
//   true first run, immediately adds '.open' to #firstRunWizard (.25s
//   opacity fade-in, css/components.css .modal-overlay.open) — in the
//   same synchronous call, so both fades started at the exact same
//   instant. #splashScreen (z-index:900) sits above #firstRunWizard
//   (z-index:800) sits above the already-fully-rendered dashboard
//   underneath (BootManager._hydrateOnce() already ran before
//   'application:ready' fires — see js/core/boot/BootManager.js).
//   For up to .6s, two independently-timed, partially-transparent
//   full-viewport overlays were therefore blending with each other and
//   with the real dashboard beneath — read visually as a blurred empty
//   patch and flickering/overlapping content. This ONLY happens on a
//   genuine first run because that is the only scenario in which the
//   wizard's fade-in is triggered at all, concurrently with the
//   splash's fade-out; on any later load 'localModeChosen' is already
//   persisted, checkFirstRunWizard() never adds '.open', and only the
//   splash's own single, unblended fade-out plays — hence "fixed by
//   Refresh" was actually "the second fade-in never happens on
//   refresh", not any timing coincidence.
//
//   Verified NOT the cause (ruled out before this fix): re-render /
//   double-render of the dashboard (BootManager.shouldSkipLegacyRender()
//   already guards every render call-site — exactly one hydration
//   render happens), and reserved/leftover layout height (#splashScreen
//   and #firstRunWizard are both `position:fixed;inset:0`, which by the
//   CSS box model is excluded from document flow and cannot reserve
//   height for any sibling/ancestor regardless of its own height or
//   whether it is still in the DOM).
//
// Fix (this file only — no other file touched): the wizard is now only
// ever allowed to actually reveal itself (add '.open') AFTER the splash
// has fully finished its own fade-out, confirmed via a real
// 'transitionend' on #splashScreen, with a safety-timeout fallback (700ms:
// the .6s CSS duration + a small buffer) in case 'transitionend' never
// fires for any reason (e.g. a prefers-reduced-motion stylesheet swaps in
// a shorter/linear transition, or the element was already hidden by some
// other path) — this guarantees the wizard can never be left waiting
// forever. Every existing caller of checkFirstRunWizard() (the splash
// timers, the 'application:ready' listener, and the
// settingsRepositoryReadyPromise.then() correction added in Part 13.8)
// is covered by this same gate with no changes needed at their call
// sites, since the gate lives inside checkFirstRunWizard() itself.
// ==================================================================
var __splashHideStarted = false;
var __splashFullyGone = false;

function _markSplashFullyGone() {
  if (__splashFullyGone) return;
  __splashFullyGone = true;
  // Re-evaluate now that it is finally safe to visually reveal the
  // wizard — picks up whatever the most current decision is.
  checkFirstRunWizard();
}

function _beginSplashFadeOut() {
  var splash = document.getElementById('splashScreen');
  if (!splash) { _markSplashFullyGone(); return; }
  if (__splashHideStarted) return; // Idempotent: a fade-out is already in
                                    // flight (or already finished) — the
                                    // listener/timeout below already owns
                                    // seeing it through to completion.
  __splashHideStarted = true;
  if (splash.classList.contains('splash-hide')) {
    // Defensive: somehow already visually hidden with nothing tracking
    // its completion — treat as immediately gone.
    _markSplashFullyGone();
    return;
  }
  splash.classList.add('splash-hide');
  var settled = false;
  function onEnd(e) {
    if (e.target !== splash || settled) return;
    settled = true;
    splash.removeEventListener('transitionend', onEnd);
    _markSplashFullyGone();
  }
  splash.addEventListener('transitionend', onEnd);
  setTimeout(function () {
    if (!settled) { settled = true; splash.removeEventListener('transitionend', onEnd); _markSplashFullyGone(); }
  }, 700);
}

function hideSplashAndCheckFirstRun() {
  _beginSplashFadeOut();
  // PHASE 13.4 — PART 12: the splash-hide timeline (fixed timers,
  // above — see "Splash Timing Polish" comment for current values) and
  // the sync-status timeline (driven by
  // loadFromSheets()/showSyncIndicator(), in settings.js — see index.html's
  // Part 8 startup sequence) run independently of each other. Whichever one
  // of them finishes first, the topbar sync widget's DOM was last (or
  // never yet) rendered under the splash. Re-rendering it here — reusing
  // the same single render function every other sync event already funnels
  // through — guarantees it reflects whatever the CURRENT state already is
  // the instant the splash goes away: "جارٍ المزامنة" if a sync is still
  // in flight, the correct "منذ لحظات"/etc. if one already completed, or
  // the existing idle/never-synced fallback otherwise. No new sync logic,
  // no new timers, no duplicate request — this only asks the existing
  // widget to repaint from state that already exists.
  if (typeof updateTopbarSyncMeta === 'function') updateTopbarSyncMeta();
  checkFirstRunWizard();
}

// Shows the wizard whenever no Google Apps Script URL is saved yet AND
// the user has not previously chosen to start in local-only mode.
// PHASE UX-03A: once 'localModeChosen' is set (via wizardStartLocal()),
// the wizard never reappears automatically again — connecting Google
// later is entirely optional and handled from the Settings page instead.
function checkFirstRunWizard() {
  var wiz = document.getElementById('firstRunWizard');
  if (!wiz) return;
  // PHASE 13.4 — PART 14: STARTUP READINESS GUARD
  // hideSplashAndCheckFirstRun() (this function's only caller) fires on
  // fixed splash timers with no dependency on settingsRepository.open()
  // having resolved. Repository.prototype.get() throws before readiness
  // (Repository.js _guardReady()) — approved Part 13 root cause. Guard
  // with the repository's own public isReady() (no Repository.js /
  // SettingsRepository.js change) and fall back to the same "not found"
  // value get() itself already returns (undefined) when not yet ready —
  // identical effective behavior to a key that was never set, no throw,
  // no wait, no new promise/timer, no change to when the wizard's own
  // logic runs.
  var localModeChosen = (settingsRepository.isReady && settingsRepository.isReady())
    ? settingsRepository.get('localModeChosen')
    : undefined;
  if (!API_URL && !localModeChosen) {
    // PHASE 29 — only physically reveal the wizard once the splash has
    // completely finished fading out (see header comment above). If it
    // hasn't yet, do nothing further here: _markSplashFullyGone() calls
    // this function again the instant it has, which will then take this
    // same branch and actually add '.open'. Safe/idempotent either way.
    if (__splashFullyGone) {
      wiz.classList.add('open');
    }
  } else {
    wiz.classList.remove('open');
  }
}

// PHASE 13.8 — CONFIRMED ROOT CAUSE FIX (Bug A)
// hideSplashAndCheckFirstRun() fires checkFirstRunWizard() on the fixed
// splash timers above, with no dependency on settingsRepository.open()
// having resolved (Part 14's guard only prevents a throw — it does not
// make the decision correct once ready). On a refresh, if
// settingsRepository is not yet ready at that fixed moment,
// 'localModeChosen' reads as undefined and the wizard is shown even
// though it was already persisted as '1'. checkFirstRunWizard() is
// idempotent and side-effect-free beyond toggling one class, so simply
// re-running it once settingsRepositoryReadyPromise actually resolves
// corrects this: a already-correct decision is repeated harmlessly; an
// incorrect one (wizard shown while 'localModeChosen' is truly set, or
// vice versa) is corrected against the now-available real value. No
// change to the existing splash timers, no new Promise, no timing
// redesign — this only adds one more, already-existing-promise-driven
// call to the same function.
if (typeof settingsRepositoryReadyPromise !== 'undefined') {
  settingsRepositoryReadyPromise.then(function () {
    checkFirstRunWizard();
  });
}

async function wizardTestConnection() {
  var input = document.getElementById('wizardApiUrlInput');
  var url = input ? input.value.trim() : '';
  var res = document.getElementById('firstRunResult');
  if (!url) {
    if (res) res.innerHTML = '<span style="color:var(--danger)">أدخل الرابط أولاً</span>';
    return;
  }
  if (res) res.innerHTML = '<span style="color:var(--muted)">&#9203; جارٍ الاتصال...</span>';
  try {
    var r = await fetch(url + '?action=setup', { signal: AbortSignal.timeout(30000) });
    var d = await r.json();
    if (d && d.status === 'ok') {
      if (res) res.innerHTML = '<span style="color:var(--success)">&#10003; تم الاتصال بنجاح.</span>';
    } else {
      if (res) res.innerHTML = '<span style="color:var(--danger)">&#10007; تعذر الاتصال. راجع الرابط ثم حاول مرة أخرى.</span>';
    }
  } catch (e) {
    if (res) res.innerHTML = '<span style="color:var(--danger)">&#10007; تعذر الاتصال. راجع الرابط ثم حاول مرة أخرى.</span>';
  }
}

// PHASE 13.9 — CONFIRMED ROOT CAUSE FIX
// Root cause (see PHASE 13.9 report): this function used to close the
// wizard and enter the app unconditionally, whether or not a URL was
// entered, and without ever validating a URL that WAS entered. Setup
// was therefore never actually completed in either case — 'apiUrl' was
// only persisted when non-empty and 'localModeChosen' was never
// persisted at all — so checkFirstRunWizard()'s condition (!API_URL &&
// !localModeChosen) stayed true and the wizard reappeared on the very
// next load, even though the user had already been let into the app.
//
// Fixed behavior (no page reload, same in-place wizard as before):
//   - No URL entered            -> do NOT enter the app; show the
//                                   fallback panel (Case A).
//   - URL entered, validates    -> persist 'apiUrl', finish First Run,
//                                   enter the app (Case B / D).
//   - URL entered, fails/errors -> do NOT enter the app; keep the
//                                   existing inline error message and
//                                   show the fallback panel (Case C).
// Validation reuses the exact same request wizardTestConnection() (this
// file) already makes (`?action=setup`) — no new endpoint, no new
// contract.
async function wizardSaveAndStart() {
  var input = document.getElementById('wizardApiUrlInput');
  var url = input ? input.value.trim() : '';
  var res = document.getElementById('firstRunResult');

  if (!url) {
    _showFirstRunFallback('لم يتم إدخال رابط Google Apps Script.');
    return;
  }

  _hideFirstRunFallback();
  if (res) res.innerHTML = '<span style="color:var(--muted)">&#9203; جارٍ الاتصال...</span>';

  var connected = false;
  try {
    var r = await fetch(url + '?action=setup', { signal: AbortSignal.timeout(30000) });
    var d = await r.json();
    connected = !!(d && d.status === 'ok');
  } catch (e) {
    connected = false;
  }

  if (!connected) {
    if (res) res.innerHTML = '<span style="color:var(--danger)">&#10007; تعذر الاتصال. راجع الرابط ثم حاول مرة أخرى.</span>';
    _showFirstRunFallback('');
    return;
  }

  API_URL = url;
  _persistFirstRunSetting('apiUrl', url);
  if (typeof updateConnectionStatus === 'function') updateConnectionStatus();
  // Let the wizard close first, then sync quietly in the background —
  // same non-blocking pattern loadFromSheets() already uses.
  setTimeout(function () {
    if (typeof loadFromSheets === 'function') loadFromSheets();
  }, 500);
  closeFirstRunWizard();
  if (typeof toast === 'function') {
    toast('تم الحفظ — جارٍ بدء البرنامج', 'success');
  }
}

// PHASE 13.9 — shows/hides the Case A / Case C fallback panel (two
// choices: local mode now, or import an existing JSON backup). Both
// choices reuse existing, already-approved actions — no duplicated
// logic, no new screens.
function _showFirstRunFallback(message) {
  var box = document.getElementById('firstRunFallback');
  var msgEl = document.getElementById('firstRunFallbackMsg');
  if (msgEl) {
    msgEl.textContent = message || '';
    msgEl.style.display = message ? '' : 'none';
  }
  if (box) box.style.display = '';
}

function _hideFirstRunFallback() {
  var box = document.getElementById('firstRunFallback');
  if (box) box.style.display = 'none';
}

// PHASE 13.9 — "استيراد نسخة JSON" choice. Reuses the existing Settings
// page and its existing JSON import control (index.html's #dataManagementCard
// / importData()/handleImport() in settings.js) — no new import screen.
// Only closes the wizard, navigates to Settings, and scrolls the existing
// card into view so the user can use the existing "استيراد JSON" button.
function wizardGoToImport() {
  closeFirstRunWizard();
  if (typeof navigate === 'function') navigate('settings');
  setTimeout(function () {
    var card = document.getElementById('dataManagementCard');
    if (card && card.scrollIntoView) card.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, 50);
}

// PHASE UX-03A: renamed from wizardSkip() — this is no longer framed as
// "skipping" a required step. The app is fully local-first; Google Sync
// is an optional add-on. Persists the choice (PHASE 13.4 PART 3: via
// SettingsRepository, see _persistFirstRunSetting() below) so the
// wizard never reappears automatically on future launches (see
// checkFirstRunWizard() above). Still exactly as before: no fetch, no
// URL saved, no loading overlay — closes the wizard over the dashboard
// that is already fully rendered from local data.
function wizardStartLocal() {
  _persistFirstRunSetting('localModeChosen', '1');
  closeFirstRunWizard();
  if (typeof toast === 'function') {
    toast('يعمل البرنامج الآن محلياً على جهازك — يمكنك إضافة رابط Google Apps Script لاحقاً من الإعدادات', 'success');
  }
  if (typeof updateConnectionStatus === 'function') updateConnectionStatus();
}

function closeFirstRunWizard() {
  var wiz = document.getElementById('firstRunWizard');
  if (wiz) wiz.classList.remove('open');
}

// PHASE 13.4 — PART 3: persists a setting via the already-wired
// SettingsRepository (js/repositories/SettingsRepositoryWiring.js —
// `settingsRepository` / `settingsRepositoryReadyPromise`), mirroring
// the exact same fire-and-forget idiom settings.js's own
// _persistSetting() helper uses (PHASE 13.4 PART 2): no caller's
// control flow, timing, or return value changes — the write was
// fire-and-forget via a synchronous localStorage.setItem() before, and
// remains fire-and-forget (now via a Promise) after. No new repository
// instance, no new wiring, no migration logic — reuses the same
// globals settings.js already depends on. Kept as a local helper
// (rather than reusing settings.js's own _persistSetting) so this file
// does not depend on an internal helper of another module, consistent
// with the typeof-guarded, independently-degrading calls this file
// already makes into settings.js elsewhere.
function _persistFirstRunSetting(key, value) {
  settingsRepositoryReadyPromise.then(function () {
    return settingsRepository.set(key, value);
  }).catch(function (e) {
    console.warn('Settings persist failed for "' + key + '":', e);
  });
}
