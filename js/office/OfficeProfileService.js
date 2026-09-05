/**
 * ============================================================================
 * OfficeProfileService.js — js/office/OfficeProfileService.js
 * ----------------------------------------------------------------------------
 * Data layer for "بيانات المكتب" (office identity: office name, lawyer
 * name, address, branches, phone numbers, WhatsApp number) — the data
 * that replaces the hardcoded "حسام محمد ابراهيم / مكتب الحسام للمحاماة"
 * text throughout the running app (sidebar, printed client reports) once
 * an office enters its own data, either via the mandatory first-run
 * screen (OfficeSetupWizard.js) or the Settings page panel
 * (OfficeProfilePanel.js).
 *
 * NOTE — brand vs. office data: "نظام الحسام للمحاماة" (the software's
 * own product name — page <title>, meta tags, splash screen, Google
 * Sheet/Drive folder names) is a separate, fixed brand and is
 * intentionally NEVER touched by this file or by anything that reads
 * from it. Only the identity of the *office actually using* the
 * software (visible in the sidebar, printed reports, the client
 * portal, and the daily email notifications) is data-driven by this
 * service.
 *
 * STORAGE MODEL
 *   Local (offline-first, always available immediately): one JSON blob
 *   under the existing SettingsRepository (js/repositories/
 *   SettingsRepositoryWiring.js — `settingsRepository` /
 *   `settingsRepositoryReadyPromise`, already wired, already loaded
 *   before this file — see index.html script order), key "officeProfile".
 *   No IndexedDB schema change: reuses the existing "settings" object
 *   store exactly like every other setting (apiUrl, driveUrl, ...).
 *
 *   Remote (multi-device sync, best-effort): the existing generic
 *   Apps Script row API (js/api/api.js — `ApiService.loadData` /
 *   `ApiService.syncRow`, already wired, no new backend endpoint) against
 *   a new sheet "بيانات_المكتب" (Config/00_Config.gs SHEET_DEFS — a
 *   single row, id="1"). Exactly the same generic add/update contract
 *   every entity module (cases.js, clients.js, ...) already relies on —
 *   nothing new on the backend surface. When offline or no API_URL is
 *   configured, saves still succeed locally and the push is silently
 *   skipped (fire-and-forget), consistent with how every other write in
 *   this app already degrades offline.
 *
 * WHAT THIS FILE IS NOT
 *   - Does not modify SettingsRepository.js, Repository.js, api.js, or
 *     any IndexedDB schema/version file.
 *   - Does not render any UI itself (see OfficeSetupWizard.js /
 *     OfficeProfilePanel.js for the two UI entry points).
 *
 * 100% additive: defines exactly one new global, window.OfficeProfileService.
 * ============================================================================
 */
(function (window, document) {
  'use strict';

  var SETTINGS_KEY = 'officeProfile';
  var SHEET_NAME = 'بيانات_المكتب';

  // Same text as the original hardcoded values (index.html / clients.js)
  // before this feature existed — used purely as the fallback so every
  // existing installation that has not yet entered its own office data
  // keeps looking exactly as it did (Zero Regression).
  var DEFAULTS = Object.freeze({
    officeName: 'مكتب الحسام للمحاماة',
    lawyerName: 'المستشار حسام محمد ابراهيم',
    address: '',
    branches: '',
    phones: '',
    whatsapp: ''
  });

  function _repoReady() {
    return typeof settingsRepository !== 'undefined' &&
      settingsRepository.isReady && settingsRepository.isReady();
  }

  /**
   * Reads the locally stored profile (synchronous — mirrors the same
   * settingsRepository.isReady()-guarded pattern already used by
   * js/modules/firstrun.js). Returns null before the repository is
   * ready or when nothing has been saved yet — callers fall back to
   * DEFAULTS via getDisplayProfile() below.
   * @returns {?Object}
   */
  function getProfile() {
    if (!_repoReady()) return null;
    var raw;
    try {
      raw = settingsRepository.get(SETTINGS_KEY);
    } catch (e) {
      return null;
    }
    if (!raw) return null;
    try {
      var parsed = JSON.parse(raw);
      return {
        officeName: parsed.officeName || '',
        lawyerName: parsed.lawyerName || '',
        address: parsed.address || '',
        branches: parsed.branches || '',
        phones: parsed.phones || '',
        whatsapp: parsed.whatsapp || ''
      };
    } catch (e) {
      return null;
    }
  }

  /**
   * Same as getProfile(), but always returns a complete object —
   * missing/unset fields fall back to DEFAULTS. This is what every UI
   * consumer (sidebar, print headers, client portal is server-side and
   * not covered here) should call.
   * @returns {Object}
   */
  function getDisplayProfile() {
    var p = getProfile() || {};
    return {
      officeName: (p.officeName || '').trim() || DEFAULTS.officeName,
      lawyerName: (p.lawyerName || '').trim() || DEFAULTS.lawyerName,
      address: (p.address || '').trim(),
      branches: (p.branches || '').trim(),
      phones: (p.phones || '').trim(),
      whatsapp: (p.whatsapp || '').trim()
    };
  }

  /**
   * true once the office has entered at least its own name and
   * lawyer/owner name (the two required fields — see OfficeSetupWizard.js).
   * Used by OfficeSetupWizard.js to decide whether the mandatory
   * first-run screen still needs to be shown.
   * @returns {boolean}
   */
  function isConfigured() {
    var p = getProfile();
    return !!(p && p.officeName && p.officeName.trim() && p.lawyerName && p.lawyerName.trim());
  }

  function _persistLocal(profile) {
    return settingsRepositoryReadyPromise.then(function () {
      return settingsRepository.set(SETTINGS_KEY, JSON.stringify(profile));
    });
  }

  /**
   * Best-effort push of the current profile to the "بيانات_المكتب"
   * sheet, for other devices/browsers signed into the same Apps Script
   * backend to pick up. Silently does nothing when offline / no
   * API_URL configured — never blocks or fails saveProfile().
   * @param {Object} profile
   * @returns {Promise<void>}
   */
  async function _syncPush(profile) {
    if (typeof ApiService === 'undefined') return;
    if (typeof API_URL === 'undefined' || !API_URL) return;
    try {
      var rows = await ApiService.loadData(SHEET_NAME);
      var rowIndex = (Array.isArray(rows) && rows.length > 0) ? 0 : -1;
      var payload = {
        'id': '1',
        'اسم_المكتب': profile.officeName || '',
        'اسم_المحامي': profile.lawyerName || '',
        'العنوان': profile.address || '',
        'الفروع': profile.branches || '',
        'أرقام_الهواتف': profile.phones || '',
        'واتساب_المكتب': profile.whatsapp || '',
        'تاريخ_التحديث': new Date().toISOString()
      };
      await ApiService.syncRow(SHEET_NAME, payload, rowIndex);
    } catch (e) {
      if (typeof console !== 'undefined' && console.warn) {
        console.warn('[OfficeProfileService] sync push failed (kept locally, will retry on next save):', e);
      }
    }
  }

  /**
   * Pulls the office profile from the "بيانات_المكتب" sheet (other
   * device already configured it) and, if found, saves it locally and
   * refreshes every visible place it appears. Called once at boot
   * (after login/license gates) and safe to call repeatedly. Never
   * overwrites a local value with an empty remote one.
   * @returns {Promise<?Object>}
   */
  async function syncPull() {
    if (typeof ApiService === 'undefined') return null;
    if (typeof API_URL === 'undefined' || !API_URL) return null;
    try {
      var rows = await ApiService.loadData(SHEET_NAME);
      var row = Array.isArray(rows) && rows[0];
      if (!row) return null;
      var profile = {
        officeName: String(row['اسم_المكتب'] || '').trim(),
        lawyerName: String(row['اسم_المحامي'] || '').trim(),
        address: String(row['العنوان'] || '').trim(),
        branches: String(row['الفروع'] || '').trim(),
        phones: String(row['أرقام_الهواتف'] || '').trim(),
        whatsapp: String(row['واتساب_المكتب'] || '').trim()
      };
      if (!profile.officeName && !profile.lawyerName) return null;
      await _persistLocal(profile);
      applyToUI();
      return profile;
    } catch (e) {
      if (typeof console !== 'undefined' && console.warn) {
        console.warn('[OfficeProfileService] sync pull failed:', e);
      }
      return null;
    }
  }

  /**
   * Validates, persists locally, refreshes the UI, and (fire-and-forget)
   * pushes to the backend sheet for other devices.
   * @param {Object} profile  {officeName, lawyerName, address, branches, phones, whatsapp}
   * @returns {Promise<Object>} the saved (trimmed) profile
   */
  async function saveProfile(profile) {
    profile = profile || {};
    var clean = {
      officeName: String(profile.officeName || '').trim(),
      lawyerName: String(profile.lawyerName || '').trim(),
      address: String(profile.address || '').trim(),
      branches: String(profile.branches || '').trim(),
      phones: String(profile.phones || '').trim(),
      whatsapp: String(profile.whatsapp || '').trim()
    };
    if (!clean.officeName || !clean.lawyerName) {
      throw new Error('اسم المكتب واسم المحامي مطلوبان');
    }
    await _persistLocal(clean);
    applyToUI(clean);
    _syncPush(clean); // intentionally not awaited — see file header
    return clean;
  }

  /**
   * Updates every place in the currently-rendered page that shows the
   * office's identity. Purely additive DOM writes guarded by
   * getElementById — a complete no-op wherever an id below does not
   * exist (older cached page, isolated test harness, etc.).
   * @param {Object} [profile]  defaults to getDisplayProfile()
   */
  function applyToUI(profile) {
    profile = profile || getDisplayProfile();

    var nameEl = document.getElementById('sidebarOfficeName');
    if (nameEl) nameEl.textContent = profile.officeName;

    var subEl = document.getElementById('sidebarLawyerName');
    if (subEl) subEl.textContent = profile.lawyerName;
  }

  // ==========================================================================
  // PHASE B — BOOTSTRAP RACE FIX
  // --------------------------------------------------------------------------
  // Root cause (confirmed by reading index.html's DOMContentLoaded listener):
  // OfficeSetupWizard.init() (chained off LicenseCore.init().then(...)) and
  // this file's syncPull() (chained off settingsRepositoryReadyPromise.then(
  // ...) — a SECOND, fully independent promise chain) had no ordering
  // guarantee between them. OfficeSetupWizard._evaluate() only ever awaited
  // settingsRepositoryReadyPromise (i.e. "local IndexedDB is open") and then
  // read isConfigured() — a synchronous, purely-local check — so a fresh
  // device could show the mandatory setup screen before syncPull() had any
  // chance to discover and pull an office profile that already exists on
  // the server.
  //
  // A second, independent bug in the old syncPull() (left untouched above,
  // still used by nothing now — see below): it built its "does an office
  // exist" answer from ApiService.loadData(), which collapses THREE
  // different outcomes into the identical `[]`: (1) the sheet is genuinely
  // empty, (2) the network/request failed, (3) the backend returned an
  // `{error:...}` object. There was no way to tell "confirmed no office"
  // apart from "could not confirm anything" — exactly the risk named in the
  // Phase B brief ("syncPull failed -> assume no office" is not acceptable).
  //
  // FIX — two parts, both purely additive:
  //   1. js/api/api.js: ApiService.loadDataWithStatus() (new, independent
  //      of loadData()) reports {ok:true, rows} vs {ok:false, reason}.
  //   2. Here: bootstrap() is the ONE shared, memoized (idempotent) entry
  //      point. Whichever of the two former call sites (the license chain
  //      via OfficeSetupWizard, or the settings-ready chain in index.html)
  //      reaches it first performs the actual discovery; the other simply
  //      awaits the same in-flight/resolved promise. Both call sites now
  //      see the SAME server-confirmed state before either one renders a
  //      decision — there is no longer a window where one has it and the
  //      other doesn't.
  //
  // NOT changed: syncPull(), _syncPush(), isConfigured(), applyToUI(),
  // saveProfile(), DB_VERSION, IndexedDB schema, SyncEngine/OfflineQueue/
  // SyncCheckpoint, Config/06_Api.gs. index.html's one call site was
  // changed from `OfficeProfileService.syncPull()` to
  // `OfficeProfileService.bootstrap()` — see that file's diff.
  // ==========================================================================

  var BootstrapStatus = Object.freeze({
    SERVER_CONFIRMED_OFFICE: 'SERVER_CONFIRMED_OFFICE',
    SERVER_CONFIRMED_NO_OFFICE: 'SERVER_CONFIRMED_NO_OFFICE',
    SERVER_UNAVAILABLE: 'SERVER_UNAVAILABLE'
  });

  var _bootstrapPromise = null;

  /**
   * Talks to the backend exactly once per bootstrap() call and classifies
   * the result. Never throws — every failure path resolves to
   * SERVER_UNAVAILABLE so callers never need a try/catch of their own.
   * @returns {Promise<{status:string, profile:?Object}>}
   */
  async function _discoverServerProfile() {
    if (typeof ApiService === 'undefined' || typeof ApiService.loadDataWithStatus !== 'function') {
      // No API layer wired at all (isolated test harness, or a page that
      // never loaded js/api/api.js) — cannot confirm anything either way.
      return { status: BootstrapStatus.SERVER_UNAVAILABLE, profile: null };
    }
    if (typeof API_URL === 'undefined' || !API_URL) {
      // No backend configured yet for this installation — same as offline
      // for discovery purposes; must NOT be read as "confirmed no office".
      return { status: BootstrapStatus.SERVER_UNAVAILABLE, profile: null };
    }

    var result;
    try {
      result = await ApiService.loadDataWithStatus(SHEET_NAME);
    } catch (e) {
      // Defensive only — loadDataWithStatus() is itself designed to never
      // throw, but a caller here can never be left unresolved either way.
      return { status: BootstrapStatus.SERVER_UNAVAILABLE, profile: null };
    }

    if (!result.ok) {
      return { status: BootstrapStatus.SERVER_UNAVAILABLE, profile: null };
    }

    var row = Array.isArray(result.rows) && result.rows[0];
    if (!row) {
      // Sheet reachable and confirmed empty — a real, positive answer,
      // not a guess.
      return { status: BootstrapStatus.SERVER_CONFIRMED_NO_OFFICE, profile: null };
    }

    var profile = {
      officeName: String(row['اسم_المكتب'] || '').trim(),
      lawyerName: String(row['اسم_المحامي'] || '').trim(),
      address: String(row['العنوان'] || '').trim(),
      branches: String(row['الفروع'] || '').trim(),
      phones: String(row['أرقام_الهواتف'] || '').trim(),
      whatsapp: String(row['واتساب_المكتب'] || '').trim()
    };
    if (!profile.officeName && !profile.lawyerName) {
      // Row exists but both required fields are blank — treat exactly like
      // "no office" (mirrors the same guard already in syncPull() above).
      return { status: BootstrapStatus.SERVER_CONFIRMED_NO_OFFICE, profile: null };
    }
    return { status: BootstrapStatus.SERVER_CONFIRMED_OFFICE, profile: profile };
  }

  /**
   * THE single entry point for Phase B. Idempotent/memoized — safe to call
   * from any number of places (OfficeSetupWizard.init() AND index.html's
   * boot listener both call it); the underlying discovery request runs
   * exactly once per page load, and every caller awaits the same result.
   *
   * Guarantees:
   *   - Never clears or overwrites a local profile except when the server
   *     POSITIVELY confirms its own profile (SERVER_CONFIRMED_OFFICE).
   *   - SERVER_UNAVAILABLE (network/HTTP/parse/app-level failure, or no
   *     API_URL configured) NEVER touches local storage and is never
   *     conflated with SERVER_CONFIRMED_NO_OFFICE.
   *   - Resolves in bounded time (loadDataWithStatus()'s own 8s timeout) —
   *     never hangs the UI indefinitely.
   *
   * @returns {Promise<{status:string, profile:?Object}>}
   */
  function bootstrap() {
    if (_bootstrapPromise) return _bootstrapPromise;
    _bootstrapPromise = (async function () {
      if (typeof settingsRepositoryReadyPromise !== 'undefined') {
        try { await settingsRepositoryReadyPromise; } catch (e) {}
      }

      var discovery = await _discoverServerProfile();

      if (discovery.status === BootstrapStatus.SERVER_CONFIRMED_OFFICE) {
        await _persistLocal(discovery.profile);
        applyToUI(discovery.profile);
      } else {
        // SERVER_CONFIRMED_NO_OFFICE or SERVER_UNAVAILABLE: local storage
        // (if any) is left exactly as it was; just re-apply whatever is
        // already there (or DEFAULTS) so the sidebar/UI stays consistent.
        applyToUI();
      }

      return discovery;
    })();
    return _bootstrapPromise;
  }

  window.OfficeProfileService = {
    DEFAULTS: DEFAULTS,
    BootstrapStatus: BootstrapStatus,
    getProfile: getProfile,
    getDisplayProfile: getDisplayProfile,
    isConfigured: isConfigured,
    saveProfile: saveProfile,
    syncPull: syncPull,
    applyToUI: applyToUI,
    bootstrap: bootstrap // PHASE B
  };
})(typeof window !== 'undefined' ? window : this, typeof document !== 'undefined' ? document : undefined);
