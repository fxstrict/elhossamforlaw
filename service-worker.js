/* ============================================================================
 * service-worker.js
 * ----------------------------------------------------------------------------
 * PHASE PWA-REBUILD (v3) — OFFLINE-FIRST, MULTI-BUCKET CACHING, SAFE UPDATES
 *
 * WHAT THIS FILE IS
 *   Pure infrastructure, per this project's PWA/Service Worker standard
 *   ("The Service Worker is infrastructure. Business logic must never be
 *   implemented inside the Service Worker."). It never touches IndexedDB,
 *   Repository.js, or any application data — the app's existing
 *   offline-first data layer (StorageAdapter -> IndexedDBAdapter ->
 *   Repository) is untouched and unaware this file exists.
 *
 * WHAT CHANGED FROM v1/v2 (this is a genuine restructure, not just a
 * version bump — see the delivery report for the full before/after)
 *   1. FOUR cache buckets instead of two, each with its own strategy,
 *      because "every resource defines its strategy" (this project's own
 *      PWA standard) is not actually true with one runtime bucket for
 *      everything:
 *        SHELL_CACHE   — index.html, offline.html, css/*, js/* (Cache
 *                         First; versioned as a whole via SW_VERSION).
 *        ICON_CACHE    — manifest icons/favicon/apple-touch-icon (Cache
 *                         First, precached, tiny and effectively static —
 *                         see manifest.json for why only a small critical
 *                         subset of the full assets/icons/ set is
 *                         precached here; the rest — splash screens,
 *                         maskable 1024, OG/social images — are the "Lazy
 *                         Cache" case below, fetched and cached only the
 *                         first time something actually requests them,
 *                         since they are large and not needed for the
 *                         very first paint).
 *        IMAGE_CACHE   — any other same-origin image request (Accept:
 *                         image/* or a common image extension) — Cache
 *                         First with an entry cap, kept separate from
 *                         RUNTIME_CACHE so a burst of document/attachment
 *                         thumbnails a person opens in one session can
 *                         never evict cached CSS/JS from RUNTIME_CACHE's
 *                         own cap, and vice versa. This is the "Image
 *                         Cache" and "Lazy Cache" requirement.
 *        RUNTIME_CACHE — everything else same-origin (Stale-While-
 *                         Revalidate, entry-capped) — unchanged from v1/v2.
 *   2. Offline Page: offline.html (new, static, dependency-free file) is
 *      now the final fallback for a failed navigation when even the
 *      cached index.html is unavailable — previously that case returned
 *      Response.error() (a browser network-error page). See offline.html
 *      itself for exactly when this can happen (it is rare).
 *   3. Background Sync scaffold: registers a real 'sync' event listener
 *      (tag 'ahp-connectivity-restored'). Per the "SW is infrastructure
 *      only" rule above, it does not call into any business/data logic
 *      itself — this codebase has no existing write-queue/replay
 *      mechanism for it to safely trigger (verified: no
 *      `addEventListener('online'` anywhere in js/ before this phase, so
 *      there is nothing already-working to wire into without guessing at
 *      undocumented behavior). Instead it broadcasts a postMessage to
 *      every open tab; js/core/pwa/InstallPromptManager.js listens and
 *      dispatches a `document` CustomEvent ('ahp:connectivity-restored')
 *      any future feature can attach to. This is documented as a
 *      "future recommendation" in the delivery report, not silently
 *      pretended to be full queued background sync.
 *   4. Network Fallback for images: an image request that fails AND has
 *      no cache entry now resolves to a tiny inline placeholder SVG
 *      instead of a broken-image icon / hard failure.
 *
 * EVERYTHING BELOW THIS POINT THAT v1/v2 ALREADY GOT RIGHT IS UNCHANGED
 * IN BEHAVIOR (same guarantees, just reorganized to fit the new buckets):
 *   - Cache Versioning: SW_VERSION is still the only thing that has to
 *     change to ship a new shell version; bumping it creates all-new
 *     cache names so an already-open tab never has a cache mutated out
 *     from under a mid-flight request.
 *   - Cache Cleanup: activate() still deletes every cache name not in
 *     CURRENT_CACHES.
 *   - Manual Update: still no self.skipWaiting() on install and no
 *     self.clients.claim() before activation — updates wait for the
 *     person to click "Update now" on ServiceWorkerRegistrar.js's banner
 *     via postMessage({type:'SKIP_WAITING'}).
 *   - Navigation requests still Network First (falls back to cached
 *     index.html, and now falls back further to offline.html — see #2).
 *   - Precached shell files still Cache First.
 *   - Anything cross-origin (Google Fonts, Apps Script) and anything
 *     that is not a GET (Apps Script sync POSTs) is still left
 *     completely untouched by fetch() below — same "never cache
 *     sensitive requests" guarantee as before.
 *
 * EVIDENCE THE PRECACHE LIST IS CORRECT (not hand-typed, not guessed)
 *   PRECACHE_URLS was regenerated directly from this exact index.html's
 *   own <link rel="stylesheet"> and <script src> tags (grep -oE, same
 *   technique the original v1 header documented), in the order those
 *   tags appear, immediately after this phase's own edits to index.html
 *   (the two new <script src> tags this phase added —
 *   js/core/pwa/InstallPromptManager.js — and manifest.json/offline.html
 *   are included; nothing was invented, renamed, or assumed).
 * ==========================================================================*/

'use strict';

/* ----------------------------------------------------------------------
 * PHASE 29 — OFFLINE STARTUP HOTFIX (root cause + fix)
 * ----------------------------------------------------------------------
 * SYMPTOM REPORTED: offline app either loses CSS files, or opens on
 * index.html and stalls on the first splash/logo screen — every time,
 * not rarely.
 *
 * EVIDENCE:
 *   1. index.html line 54: <link rel="canonical"
 *      href="https://fxstrict.github.io/hossam/"> — this app is deployed
 *      under a GitHub Pages PROJECT subpath ("/hossam/"), not domain root.
 *   2. ServiceWorkerRegistrar.js registers this file with a relative path
 *      ('./service-worker.js'), so its scope is that same "/hossam/"
 *      subpath — correct, and not being changed here.
 *   3. THE BUG (this file, fetch handler, pre-existing): `path =
 *      url.pathname.replace(/^\//, '')` strips only the leading slash,
 *      giving "hossam/css/base.css" for a request to
 *      "https://fxstrict.github.io/hossam/css/base.css". That string is
 *      then compared against PRECACHE_URLS, whose entries are root-
 *      relative ("css/base.css", no "hossam/" prefix) — so it NEVER
 *      matches under this deployment. Every shell CSS/JS request falls
 *      through past the SHELL_CACHE/ICON_CACHE branches into the final
 *      staleWhileRevalidate(RUNTIME_CACHE) branch instead.
 *   4. RUNTIME_CACHE was never precached (only SHELL_CACHE/ICON_CACHE are,
 *      in the install handler below) and is capped at
 *      RUNTIME_CACHE_MAX_ENTRIES with oldest-entry eviction
 *      (trimCache()). staleWhileRevalidate(), offline, with no existing
 *      RUNTIME_CACHE entry for a given file, resolves to `undefined`
 *      (its own network branch's `.catch` returns the un-set `cached`
 *      variable) — an invalid Service Worker response, which the browser
 *      reports as a failed resource load.
 *   5. This exactly matches BOTH reported symptoms from one root cause:
 *      whichever shell files are NOT currently sitting in the capped,
 *      rotating RUNTIME_CACHE at the moment the device goes offline fail
 *      to load — CSS files fail visibly (unstyled page), and if a
 *      boot-critical JS file (e.g. js/core/boot/BootManager.js) is the
 *      one missing, the app hangs on the splash/logo screen forever
 *      because boot never receives the script it is waiting on. Which
 *      specific files are missing varies run to run (whatever RUNTIME_CACHE
 *      happened to still hold), which is why the symptom looked
 *      inconsistent rather than a clean, single reproducible file.
 *
 * FIX: compute `path` relative to THIS SCRIPT'S OWN registration scope
 * (the directory service-worker.js itself lives in) instead of relative
 * to the origin root. Works identically for root deployments (scope "/")
 * and subpath deployments (scope "/hossam/", or any other subpath) — see
 * pathRelativeToScope() below. SW_VERSION is bumped so every existing
 * install picks up new, correctly-keyed caches instead of continuing to
 * read from the old mis-keyed RUNTIME_CACHE entries.
 *
 * Also hardened cacheFirstIn() (used for SHELL_CACHE/ICON_CACHE) with a
 * network-failure fallback to a cross-cache lookup, so a single file that
 * silently failed to precache during install (the install handler below
 * already treats per-file precache failure as non-fatal and continues)
 * does not hard-fail as an unhandled rejection offline — see that
 * function for the residual limitation this does NOT solve.
 * ---------------------------------------------------------------------- */

// PHASE 35 — Voice Input (Speech-to-Text): added css/voice-input.css +
// js/core/VoiceInputController.js to PRECACHE_URLS below (new <link>/
// <script> tags in index.html). SW_VERSION bumped v23 -> v24 for the same
// "Cache Versioning" reason as every previous bump in this file (see the
// PRECACHE_URLS v12 note a few lines down) — otherwise a previously-
// installed PWA keeps serving its old cached shell and never picks up the
// two new files. No other entry in this file was changed for Phase 35.
// PHASE 37 — Opponents Module (الخصوم): added js/repositories/
// OpponentsRepository.js, js/modules/opponents.js (both to
// PRECACHE_URLS above, mirroring their Clients counterparts) plus two
// new, NOT-precached files loaded via RUNTIME_CACHE the same way
// js/modules/client-fields.js already is (js/modules/opponent-fields.js).
// SW_VERSION bumped v33 -> v34 for the same "Cache Versioning" reason
// as every previous bump in this file — otherwise a previously-
// installed PWA keeps serving its old cached shell (missing the new
// opponents page/modal/scripts) and never picks up these additions.
// PHASE 38 — Process Server Works Module (أعمال المحضرين): added
// js/repositories/ProcessServerWorksRepository.js and js/modules/
// process-server-works.js to PRECACHE_URLS above (mirroring their
// Opponents counterparts exactly). js/modules/process-server-fields.js
// is intentionally NOT precached, same treatment js/modules/
// opponent-fields.js and js/modules/client-fields.js already get
// (runtime-cached on first fetch instead). SW_VERSION bumped v35 -> v36
// for the same "Cache Versioning" reason as every previous bump in this
// file — otherwise a previously-installed PWA keeps serving its old
// cached shell (missing the new أعمال المحضرين page/modal/scripts) and
// never picks up these additions.
// STABILITY FIX (ROOT-CAUSE REPORT items #1-#3) — index.html and
// css/{variables,layout,components,skeleton,license}.css were edited
// (error-boundary in navigate(), centralized z-index tokens, LTR fix for
// the license textarea) but SW_VERSION was left unbumped in that
// delivery. Per every SW_VERSION comment in this file, SHELL_CACHE is
// keyed by SW_VERSION and served Cache First, so an already-installed
// PWA kept reading the OLD cached copies of those exact files from
// 'ahp-shell-v39' and never fetched the new ones — this is why uploading
// the fixed files changed nothing on an already-installed device. Same
// "Cache Versioning" rule as every previous bump below. No other line in
// this file, and no file outside the 6 above, was touched.
// UPLOAD-MISMATCH FIX — the previous v40 bump was deployed together with
// an OLD/pre-fix copy of one or more of the 7 files (the version string
// was changed by hand without the matching file content), so any device
// that already fetched that broken 'v40' shell has it permanently cached
// under that exact key — Cache First means it will NEVER re-check the
// server for 'v40' again, no matter what the server now contains. The
// only way to make every device — including those that already saw the
// bad v40 — fetch the corrected files is a NEW key. Bumped to v41 for
// that reason, together with re-verified, correct copies of the same 7
// files (see the delivery notes). No other line in this file changed.
// (v42 note) BUGFIX — ROOT-CAUSE: Forensic_RootCause_Audit_RenderingRegression_v41.md.
// index.html's <script>/<link> tags for every local JS/CSS file had no
// cache-busting query string at all (0 of 224 references), unlike the
// documented v29/v30 fix for this exact class of bug. Because JS/CSS is
// served cacheFirstIn(SHELL_CACHE) ("NEVER re-check the network" — see the
// v15 note below) while index.html itself is served networkFirstShell()
// (always fresh), any deploy that changed a shared JS/CSS file under its
// existing filename kept being served stale to already-open tabs until a
// manual "تحديث الآن" reload — producing exactly the intermittent blank/
// partial page and modal bodies in the audit report (Process Server Works
// page/modal, dashboard stat cards, sidebar drawer counts). Fix: every
// local <script src>/<link href> in index.html now carries ?v=42, and
// every js/css entry in PRECACHE_URLS below is updated to match byte-for-
// byte (icons/manifest/offline.html deliberately left unversioned — not
// touched by this bug). pathRelativeToScope() below was also corrected to
// include url.search, since PRECACHE_URLS.indexOf(path) would otherwise
// never match a versioned request again. SW_VERSION bumped v41 -> v42 so
// every device that already saw the un-versioned v41 shell fetches this
// corrected copy — same "Cache Versioning" rule as every previous
// SW_VERSION bump in this file. No Repository/DatabaseService/IndexedDB
// code touched — see audit report §11.
var SW_VERSION = 'v45'; // FORENSIC FIX (Sidebar Instability) — css/layout.css?v=42 is listed in
                         // PRECACHE_URLS below and served cacheFirstIn(SHELL_CACHE), which is
                         // keyed by SW_VERSION (see SHELL_CACHE definition a few lines down), so
                         // an already-installed client keeps serving its OLD cached copy of
                         // layout.css forever until SW_VERSION changes — same "Cache Versioning"
                         // rule as every previous SW_VERSION bump in this file. The .sidebar rule
                         // in that file was just changed (viewport-unit height replaced with
                         // top:0/bottom:0 — see css/layout.css for the full root-cause note), so
                         // SW_VERSION must bump for the fix to actually reach already-installed
                         // devices. PRECACHE_URLS itself is unchanged (no file added/removed, no
                         // path renamed) — this bump only regenerates SHELL_CACHE's contents under
                         // the new 'ahp-shell-v45' name so it re-fetches every listed URL, layout.css
                         // included. No other file/line in this file touched.
// (v44 note, kept for history) BUGFIX (Forensic Shell/Precache Reconciliation, Phase 2) — the v34/
                         // v36 comments a few lines below claimed js/modules/client-fields.js,
                         // js/modules/opponent-fields.js and js/modules/process-server-fields.js
                         // were "intentionally NOT precached" / "runtime-cached on first fetch".
                         // Re-verified against actual code, not the comment: index.html loads all
                         // three with the exact same plain, unconditional <script src="...?v=42">
                         // tag as their already-precached siblings (clients.js/opponents.js/
                         // process-server-works.js) — no defer/async/type=module, no dynamic
                         // import(), no createElement('script'), no conditional/lazy loader
                         // anywhere in the project (grepped project-wide). They are called
                         // synchronously from those siblings' save/edit flows (ClientFields.*/
                         // OpponentFields.*/ProcessServerFields.*), so they are required for
                         // normal operation, not optional. The "intentional" comment was not
                         // supported by the code and is corrected here, not just silently
                         // dropped. All three fell through to staleWhileRevalidate(RUNTIME_CACHE)
                         // instead of cacheFirstIn(SHELL_CACHE) — same class of bug as the v15
                         // note below (23 files) and the v43 fix above, just these 3 were missed
                         // by both. Added to PRECACHE_URLS in the same order they appear in
                         // index.html, using the exact same ?v= convention as every other
                         // PRECACHE_URLS entry. No other line in PRECACHE_URLS changed. SW_VERSION
                         // bumped v43 -> v44 so SHELL_CACHE is regenerated to include them — same
                         // "Cache Versioning" rule as every previous SW_VERSION bump in this file.
                         // No Repository/DatabaseService/IndexedDB/auth/UI code touched.
// (v42 note, kept for history) BUGFIX (PHASE PWA-NOTIFICATIONS-CLOSED-APP, cont'd) — v18 fixed the
                         // WRONG-PAGE part (see that entry below) but a real installed WebAPK
                         // (confirmed: appears as its own entry under Settings > Apps, installed via
                         // Chrome's "تثبيت التطبيق") was still opening the tapped notification in a
                         // plain Chrome tab instead of the standalone app window. Root cause was in
                         // manifest.json, not this file: (1) "display_override" explicitly listed
                         // "browser" as a valid fallback display mode, handing Chrome a manifest-
                         // sanctioned reason to render the cold, notification-triggered launch as a
                         // normal tab instead of standalone — removed; (2) "id" was the ABSOLUTE path
                         // "/", which for a GitHub Pages PROJECT site (scope is a sub-path like
                         // "/repo-name/", not the domain root) resolves to a different app identity
                         // than "scope" — changed to the relative "./" so id resolves under the same
                         // sub-path as scope/start_url, matching this project's actual GitHub Pages
                         // deployment. manifest.json is precached under SHELL_CACHE (Cache First,
                         // keyed by SW_VERSION), so SW_VERSION must bump for the corrected
                         // manifest.json to actually reach the browser instead of serving the stale
                         // cached copy — same "Cache Versioning" rule as every previous SW_VERSION
                         // bump in this file. No PRECACHE_URLS list change, no other file touched.
                         // NOTE: an already-installed WebAPK does not re-read manifest.json
                         // immediately on its own schedule — see the deployment note accompanying
                         // this fix for what the person needs to do on their phone to pick it up.
// (v15 note, kept for history) BUGFIX — PRECACHE_URLS never included Phase 30
// (js/license/*, css/license.css) or Phase 31/32 (js/core/rbac/*, js/auth/*,
// css/auth.css) files. Those 23 files were silently falling through to the
// staleWhileRevalidate(RUNTIME_CACHE) branch instead of the intended
// cacheFirstIn(SHELL_CACHE) branch, which (a) is slower/less reliable
// offline for boot-critical license/auth code, and (b) is WHY a code fix
// shipped to a license file did not visibly take effect after a version
// bump: RUNTIME_CACHE serves the cached copy immediately and only refreshes
// it in the background for the *next* load, so seeing a fix requires an
// extra reload cycle even after activation, on top of the already-required
// "تحديث الآن" banner click. List regenerated from index.html's own
// <script src>/<link rel="stylesheet"> tags exactly as this file's header
// describes — see that header for why this is the intended process and not
// a one-off patch.
var SHELL_CACHE = 'ahp-shell-' + SW_VERSION;
var ICON_CACHE = 'ahp-icons-' + SW_VERSION;
var IMAGE_CACHE = 'ahp-images-' + SW_VERSION;
var RUNTIME_CACHE = 'ahp-runtime-' + SW_VERSION;
var CURRENT_CACHES = [SHELL_CACHE, ICON_CACHE, IMAGE_CACHE, RUNTIME_CACHE];

var IMAGE_CACHE_MAX_ENTRIES = 80;
var RUNTIME_CACHE_MAX_ENTRIES = 60;

// Small, critical icon subset only — see file header point #1 (ICON_CACHE).
var ICON_PRECACHE_URLS = [
  'assets/favicon/favicon.ico',
  'assets/favicon/favicon-16.png',
  'assets/favicon/favicon-32.png',
  'assets/favicon/favicon-48.png',
  'assets/apple/apple-touch-icon-180.png',
  'assets/icons/icon-192.png',
  'assets/icons/icon-512.png',
  'assets/icons/maskable/icon-maskable-192.png',
  'assets/icons/maskable/icon-maskable-512.png'
];

// Generated from index.html's own <link>/<script> tags — see file header.
// BUGFIX (SW_VERSION v12): re-regenerated from scratch against the current
// index.html. The previous list stopped tracking new <script>/<link> tags
// at some point after Phase 30 and was missing 23 files, all now restored
// below in the exact order they appear in index.html: the full
// js/license/* set + css/license.css (Phase 30), and js/core/rbac/*,
// js/auth/*, js/repositories/UsersRepository.js + css/auth.css (Phase 31/32).
var PRECACHE_URLS = [
  'index.html',
  'manifest.json',
  'offline.html',
  'css/variables.css?v=42',
  'css/base.css?v=42',
  'css/layout.css?v=42',
  'css/components.css?v=42',
  'css/responsive.css?v=42',
  'css/utilities.css?v=42',
  'css/skeleton.css?v=42',
  'css/boot-error.css?v=42',
  'css/safe-mode.css?v=42',
  'css/dashboard-smart.css?v=42',
  'css/license.css?v=42',
  'css/auth.css?v=42',
  'css/voice-input.css?v=42',
  'assets/favicon/favicon.ico',
  'assets/favicon/favicon-16.png',
  'assets/favicon/favicon-32.png',
  'assets/favicon/favicon-48.png',
  'assets/apple/apple-touch-icon-180.png',
  'assets/icons/icon-192.png',
  'assets/icons/icon-512.png',
  'assets/icons/maskable/icon-maskable-192.png',
  'assets/icons/maskable/icon-maskable-512.png',
  'js/debug/RuntimeDebugLayer.js?v=42',
  'js/license/license-public-key.js?v=42',
  'js/license/LicenseCrypto.js?v=42',
  'js/license/MachineFingerprint.js?v=42',
  'js/license/LicenseCore.js?v=42',
  'js/license/ReadOnlyGuard.js?v=42',
  'js/license/SubscriptionManager.js?v=42',
  'js/license/ActivationWizard.js?v=42',
  'js/license/LicenseOnlineValidator.js?v=42',
  'js/license/LicenseManagerPanel.js?v=42',
  'js/api/api.js?v=42',
  'js/core/OfflineQueue.js?v=42',
  'js/ui-utils.js?v=42',
  'js/print-utils.js?v=42',
  'js/core/StorageAdapter.js?v=42',
  'js/core/StartupTimeoutManager.js?v=42',
  'js/core/LocalStorageAdapter.js?v=42',
  'js/core/DatabaseService.js?v=42',
  'js/core/Repository.js?v=42',
  'js/core/UndoManager.js?v=42',
  'js/core/UndoReconciler.js?v=42',
  'js/core/IndexedDBErrors.js?v=42',
  'js/core/IndexedDBSchema.js?v=42',
  'js/core/IndexedDBUtils.js?v=42',
  'js/core/IndexedDBVersion.js?v=42',
  'js/core/IndexedDBTransaction.js?v=42',
  'js/core/IndexedDBEngine.js?v=42',
  'js/core/IndexedDBAdapter.js?v=42',
  'js/core/MigrationService.js?v=42',
  'js/core/MigrationBootstrap.js?v=42',
  'js/core/rbac/Permissions.js?v=42',
  'js/core/rbac/PermissionGroups.js?v=42',
  'js/core/rbac/Roles.js?v=42',
  'js/core/rbac/PermissionService.js?v=42',
  'js/auth/SessionPersistence.js?v=42',
  'js/core/rbac/SessionContext.js?v=42',
  'js/core/rbac/AuditLog.js?v=42',
  'js/repositories/CasesRepository.js?v=42',
  'js/repositories/ClientsRepository.js?v=42',
  'js/repositories/OpponentsRepository.js?v=42',
  'js/repositories/ProcessServerWorksRepository.js?v=42',
  'js/repositories/ClientMessagesRepository.js?v=42',
  'js/repositories/ChildrenRepository.js?v=42',
  'js/repositories/SessionsRepository.js?v=42',
  'js/repositories/TasksRepository.js?v=42',
  'js/repositories/FeesRepository.js?v=42',
  'js/repositories/DocumentsRepository.js?v=42',
  'js/repositories/LibraryRepository.js?v=42',
  'js/repositories/TemplatesRepository.js?v=42',
  'js/repositories/SettingsRepository.js?v=42',
  'js/repositories/SettingsRepositoryWiring.js?v=42',
  'js/office/OfficeProfileService.js?v=42',
  'js/office/OfficeSetupWizard.js?v=42',
  'js/office/OfficeProfilePanel.js?v=42',
  'js/repositories/UsersRepository.js?v=42',
  'js/auth/PasswordHasher.js?v=42',
  'js/auth/LoginAttempts.js?v=42',
  'js/auth/LoginScreen.js?v=42',
  'js/auth/UsersAdminPanel.js?v=42',
  'js/auth/TopbarSessionBadge.js?v=42',
  'js/auth/SidebarSessionBadge.js?v=42',
  'js/core/RepositoryReadyTimeout.js?v=42',
  'js/modules/cases.js?v=42',
  'js/modules/settings.js?v=42',
  'js/modules/firstrun.js?v=42',
  'js/modules/calendar.js?v=42',
  'js/modules/children.js?v=42',
  'js/modules/dashboard.js?v=42',
  'js/modules/tasks.js?v=42',
  'js/modules/documents.js?v=42',
  'js/modules/sessions.js?v=42',
  'js/core/HistoryPanel.js?v=42',
  'js/modules/clients.js?v=42',
  'js/modules/client-fields.js?v=42',
  'js/modules/opponents.js?v=42',
  'js/modules/opponent-fields.js?v=42',
  'js/modules/process-server-works.js?v=42',
  'js/modules/process-server-fields.js?v=42',
  'js/modules/client-messages.js?v=42',
  'js/modules/fees.js?v=42',
  'js/modules/library.js?v=42',
  'js/modules/templates.js?v=42',
  'js/modules/historypanel-ui.js?v=42',
  'js/core/RepositoryReadyCoordinator.js?v=42',
  'js/core/boot/BootManager.js?v=42',
  'js/core/shell/ShellEvents.js?v=42',
  'js/core/shell/BootState.js?v=42',
  'js/core/shell/PageRegistry.js?v=42',
  'js/core/shell/ViewRegistry.js?v=42',
  'js/core/shell/NavigationRegistry.js?v=42',
  'js/core/shell/ShellState.js?v=42',
  'js/core/shell/ShellRegistry.js?v=42',
  'js/core/shell/LifecycleManager.js?v=42',
  'js/core/render/RenderMetrics.js?v=42',
  'js/core/render/RenderTask.js?v=42',
  'js/core/render/RenderRegistry.js?v=42',
  'js/core/render/RenderScheduler.js?v=42',
  'js/core/render/RenderDispatcher.js?v=42',
  'js/core/render/RenderQueue.js?v=42',
  'js/core/view/ViewVersion.js?v=42',
  'js/core/view/DirtyTracker.js?v=42',
  'js/core/view/ViewCache.js?v=42',
  'js/core/view/PageState.js?v=42',
  'js/core/view/ViewLifecycle.js?v=42',
  'js/core/dom/DomKeyIndex.js?v=42',
  'js/core/dom/DomNodeFactory.js?v=42',
  'js/core/dom/DomPatch.js?v=42',
  'js/core/dom/DomRecycler.js?v=42',
  'js/core/shell/ApplicationShell.js?v=42',
  'js/core/shell/NavigationManager.js?v=42',
  'js/core/modal/ZIndexEngine.js?v=42',
  'js/core/modal/ModalStack.js?v=42',
  'js/core/modal/ScrollLockManager.js?v=42',
  'js/core/modal/FocusManager.js?v=42',
  'js/core/modal/ModalHistoryBridge.js?v=42',
  'js/core/modal/ModalManager.js?v=42',
  'js/core/boot/SafeModeController.js?v=42',
  'js/core/pwa/ServiceWorkerRegistrar.js?v=42',
  'js/core/pwa/InstallPromptManager.js?v=42',
  'js/core/pwa/NotificationManager.js?v=42',
  'js/core/VoiceInputController.js?v=42'
];

// 1x1-scale, dependency-free inline placeholder for a same-origin image
// request that fails offline and was never cached — see file header #4.
var IMAGE_FALLBACK_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200">' +
  '<rect width="200" height="200" fill="#0D1B2A"/>' +
  '<text x="100" y="105" font-size="13" fill="#C9A84C" text-anchor="middle" font-family="sans-serif">لا يوجد اتصال</text>' +
  '</svg>';

self.addEventListener('install', function (event) {
  event.waitUntil(
    Promise.all([
      caches.open(SHELL_CACHE).then(function (cache) {
        return Promise.all(PRECACHE_URLS.map(function (url) {
          return cache.add(url).catch(function (err) {
            try { console.warn('[SW] shell precache skipped (non-fatal):', url, err && err.message); } catch (e) {}
          });
        }));
      }),
      caches.open(ICON_CACHE).then(function (cache) {
        return Promise.all(ICON_PRECACHE_URLS.map(function (url) {
          return cache.add(url).catch(function (err) {
            try { console.warn('[SW] icon precache skipped (non-fatal):', url, err && err.message); } catch (e) {}
          });
        }));
      })
    ])
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (names) {
      return Promise.all(names.map(function (name) {
        if (CURRENT_CACHES.indexOf(name) === -1) {
          return caches.delete(name);
        }
      }));
    }).then(function () {
      return self.clients.claim();
    })
  );
});

// Lets js/core/pwa/ServiceWorkerRegistrar.js hand control to a waiting
// update only after the person explicitly asks for it. See file header.
self.addEventListener('message', function (event) {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

// Background Sync scaffold — see file header point #3 for exactly what
// this does and does not do.
self.addEventListener('sync', function (event) {
  if (event.tag !== 'ahp-connectivity-restored') return;
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (clientList) {
      clientList.forEach(function (client) {
        client.postMessage({ type: 'AHP_BACKGROUND_SYNC_TICK' });
      });
    })
  );
});

// PHASE PWA-NOTIFICATIONS — thin, generic relay only (no business logic —
// see js/core/pwa/NotificationManager.js's header for the "SW is
// infrastructure" reasoning). Focuses/opens the app and hands the tapped
// notification's page back to it; the client's own already-existing global
// navigate() does the actual routing.
//
// Two delivery paths for "which page", depending on whether the app is
// already running:
//   - APP ALREADY OPEN (a window client exists): postMessage() the page to
//     it directly — NotificationManager.js's message listener calls
//     navigate(page) immediately. Unchanged from before this fix.
//   - APP FULLY CLOSED (BUGFIX, no window client exists): postMessage has
//     nothing to deliver to, so the page was previously silently lost and
//     clients.openWindow('./') always landed on the default page. Now the
//     new window is opened at './#<page>' instead — NavigationManager.js's
//     own init() (already shipped, unrelated file, unchanged) already reads
//     location.hash on cold start and calls navigate() for any recognized
//     page, exactly as it does for a bookmarked/shared deep link, so this
//     simply reuses that existing, already-tested mechanism.
self.addEventListener('notificationclick', function (event) {
  event.notification.close();
  var page = (event.notification.data && event.notification.data.page) || '';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (clientList) {
      for (var i = 0; i < clientList.length; i++) {
        var client = clientList[i];
        client.postMessage({ type: 'AHP_NOTIFICATION_CLICK', page: page });
        if ('focus' in client) return client.focus();
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow(page ? './#' + page : './');
      }
    })
  );
});

// Directory this SW script itself lives in, e.g. '/hossam/' for a GitHub
// Pages project subpath, or '/' for a root deployment. Computed once from
// self.location (always available, unlike self.registration.scope which
// is not guaranteed populated in every event) — see PHASE 29 note above.
var SCOPE_PATH = self.location.pathname.replace(/[^/]*$/, '');

// Root-cause fix (PHASE 29): path must be computed relative to THIS
// SCOPE, not relative to the origin root, or every PRECACHE_URLS/
// ICON_PRECACHE_URLS lookup silently fails under a subpath deployment.
function pathRelativeToScope(url) {
  // BUGFIX (Cache-Busting Fix, paired with index.html ?v=42 query params on
  // all local JS/CSS references): this used to return url.pathname only,
  // dropping any query string. PRECACHE_URLS entries are now versioned
  // (e.g. 'js/modules/dashboard.js?v=42'), so the lookup below must include
  // url.search or PRECACHE_URLS.indexOf(path) would never match a real
  // request again and every shell JS/CSS file would silently fall through
  // to the staleWhileRevalidate() branch instead of the intended
  // Cache-First SHELL_CACHE path. Path-only requests (no query string,
  // e.g. 'index.html') are unaffected since url.search is '' for those.
  var relative;
  if (url.pathname.indexOf(SCOPE_PATH) === 0) {
    relative = url.pathname.slice(SCOPE_PATH.length);
  } else {
    relative = url.pathname.replace(/^\//, ''); // defensive fallback, unchanged old behavior
  }
  return relative + url.search;
}

function isNavigationRequest(request) {
  if (request.mode === 'navigate') return true;
  var accept = request.headers.get('accept');
  return request.method === 'GET' && !!accept && accept.indexOf('text/html') !== -1;
}

function isImageRequest(request, url) {
  var accept = request.headers.get('accept');
  if (accept && accept.indexOf('image/') !== -1) return true;
  return /\.(png|jpg|jpeg|gif|webp|svg|ico)$/i.test(url.pathname);
}

function networkFirstShell(request) {
  return fetch(request).then(function (response) {
    if (response && response.ok) {
      var copy = response.clone();
      caches.open(SHELL_CACHE).then(function (cache) { cache.put('index.html', copy); });
    }
    return response;
  }).catch(function () {
    return caches.match('index.html').then(function (cached) {
      if (cached) return cached;
      // Deepest fallback — see offline.html's own header for exactly when
      // this path is reached (rare: first-ever visit, offline, before any
      // precache completed).
      return caches.match('offline.html').then(function (offlineCached) {
        return offlineCached || Response.error();
      });
    });
  });
}

function cacheFirstIn(cacheName, request) {
  return caches.match(request).then(function (cached) {
    if (cached) return cached;
    return fetch(request).then(function (response) {
      if (response && response.ok) {
        var copy = response.clone();
        caches.open(cacheName).then(function (cache) { cache.put(request, copy); });
      }
      return response;
    }).catch(function () {
      // PHASE 29 hardening: offline AND not found in `cacheName` — this
      // means the specific file's install-time precache silently failed
      // (see the install handler's per-file .catch). Last resort: check
      // every cache bucket before giving up, in case it landed somewhere
      // else. Does NOT solve the underlying "precache can silently miss a
      // file" behavior — that is an intentional, pre-existing install()
      // policy (fail soft rather than block install on one flaky file)
      // and changing it is out of this fix's scope.
      return caches.match(request);
    });
  });
}

function trimCache(cacheName, maxEntries) {
  caches.open(cacheName).then(function (cache) {
    cache.keys().then(function (keys) {
      if (keys.length > maxEntries) {
        cache.delete(keys[0]).then(function () { trimCache(cacheName, maxEntries); });
      }
    });
  });
}

function cacheFirstImage(request) {
  return caches.match(request, { cacheName: IMAGE_CACHE }).then(function (cached) {
    if (cached) return cached;
    return fetch(request).then(function (response) {
      if (response && response.ok) {
        var copy = response.clone();
        caches.open(IMAGE_CACHE).then(function (cache) {
          cache.put(request, copy);
          trimCache(IMAGE_CACHE, IMAGE_CACHE_MAX_ENTRIES);
        });
      }
      return response;
    }).catch(function () {
      // Network Fallback for images — see file header point #4.
      return new Response(IMAGE_FALLBACK_SVG, { headers: { 'Content-Type': 'image/svg+xml' } });
    });
  });
}

function staleWhileRevalidate(request) {
  return caches.open(RUNTIME_CACHE).then(function (cache) {
    return cache.match(request).then(function (cached) {
      var networkFetch = fetch(request).then(function (response) {
        if (response && response.ok) {
          cache.put(request, response.clone());
          trimCache(RUNTIME_CACHE, RUNTIME_CACHE_MAX_ENTRIES);
        }
        return response;
      }).catch(function () { return cached; });
      return cached || networkFetch;
    });
  });
}

self.addEventListener('fetch', function (event) {
  var request = event.request;
  if (request.method !== 'GET') return; // never intercept writes/sync calls

  var url;
  try { url = new URL(request.url); } catch (e) { return; }
  if (url.origin !== self.location.origin) return; // cross-origin (fonts, Apps Script) — untouched

  if (isNavigationRequest(request)) {
    event.respondWith(networkFirstShell(request));
    return;
  }

  var path = pathRelativeToScope(url);

  if (PRECACHE_URLS.indexOf(path) !== -1) {
    event.respondWith(cacheFirstIn(SHELL_CACHE, request));
    return;
  }
  if (ICON_PRECACHE_URLS.indexOf(path) !== -1) {
    event.respondWith(cacheFirstIn(ICON_CACHE, request));
    return;
  }
  if (isImageRequest(request, url)) {
    event.respondWith(cacheFirstImage(request));
    return;
  }

  event.respondWith(staleWhileRevalidate(request));
});
