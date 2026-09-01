/* ============================================================================
 * js/core/pwa/FcmClient.js
 * ----------------------------------------------------------------------------
 * PHASE A8 — Firebase Cloud Messaging (frontend token bridge)
 *
 * WHAT THIS FILE IS
 *   A thin, additive-only bridge between:
 *     1. Firebase Web Modular SDK (loaded lazily, exactly once, via CDN
 *        <script type="module">, no bundler/build-step required — the
 *        project has none, so the CDN ESM build is the correct choice; the
 *        legacy "compat" SDK was rejected because it would pull in a much
 *        larger, older API surface for no benefit here).
 *     2. The Service Worker THIS PROJECT ALREADY REGISTERS
 *        (js/core/pwa/ServiceWorkerRegistrar.js -> ./service-worker.js).
 *        Firebase Messaging's modular getToken() accepts an EXISTING
 *        ServiceWorkerRegistration via the `serviceWorkerRegistration`
 *        option — so this file does NOT register a second, separate
 *        `firebase-messaging-sw.js`. One Service Worker, one scope, no risk
 *        to the existing Background Sync ('sync' event) or precache logic.
 *        (See PHASE A8 blueprint report, section C, for the audit that
 *        justified this choice.)
 *
 * WHAT THIS FILE IS NOT
 *   - It does NOT request Notification permission (that stays exactly where
 *     it already lives: js/core/pwa/NotificationManager.js's
 *     requestPermission(), triggered only by the person's explicit "تفعيل"
 *     tap in Settings — no second permission system is created here).
 *   - It does NOT call SyncCoordinator directly.
 *   - It does NOT run if Firebase isn't configured for this deployment
 *     (Config/00_Config.gs's FIREBASE_* fields empty) — every function here
 *     fails silently/no-ops in that case, so a deployment with FCM disabled
 *     behaves exactly as before A8.
 *
 * WHEN IT LOADS THE SDK
 *   Lazily, only inside getOrCreateFcmToken() — i.e. only after the person
 *   has actually granted Notification permission and NotificationManager.js
 *   asks for a token. Nothing is fetched from a CDN just because the app
 *   opened.
 * ==========================================================================*/
(function (global) {
  'use strict';
  if (!global.document) return;

  var FIREBASE_SDK_VERSION = '10.13.2'; // pinned, documented — see file header
  var _appPromise = null; // memoized: Firebase SDK + app are loaded/initialized at most once per page session

  function safely(fn, fallback) {
    try { return fn(); } catch (e) { return fallback; }
  }

  /** Reads the Public Firebase Web config cached by js/modules/settings.js's
   * pingConnection() (from apiPing()'s response, Config/06_Api.gs) — no new
   * network call is made here to fetch it. Returns null if this deployment
   * has FCM disabled (empty FIREBASE_PROJECT_ID server-side, per
   * Config/00_Config.gs's documented safe-disable behavior). */
  function getCachedFirebaseConfig() {
    return safely(function () {
      var raw = global.localStorage.getItem('ahp_firebase_config');
      if (!raw) return null;
      var cfg = JSON.parse(raw);
      if (!cfg || !cfg.projectId || !cfg.apiKey || !cfg.messagingSenderId || !cfg.appId || !cfg.vapidKey) return null;
      return cfg;
    }, null);
  }

  /** Loads the Firebase modular SDK from CDN (once) and returns an
   * initialized {app, messaging} pair, or null if unsupported/unconfigured.
   * @returns {Promise<?{app:Object, messaging:Object, vapidKey:string}>}
   */
  function loadFirebaseMessaging() {
    if (_appPromise) return _appPromise;

    var cfg = getCachedFirebaseConfig();
    if (!cfg) { _appPromise = Promise.resolve(null); return _appPromise; }
    if (!('serviceWorker' in navigator) || typeof global.Notification === 'undefined') {
      _appPromise = Promise.resolve(null);
      return _appPromise;
    }

    _appPromise = Promise.all([
      import('https://www.gstatic.com/firebasejs/' + FIREBASE_SDK_VERSION + '/firebase-app.js'),
      import('https://www.gstatic.com/firebasejs/' + FIREBASE_SDK_VERSION + '/firebase-messaging.js')
    ]).then(function (mods) {
      var appMod = mods[0], msgMod = mods[1];
      var app = appMod.initializeApp({
        apiKey: cfg.apiKey,
        projectId: cfg.projectId,
        messagingSenderId: cfg.messagingSenderId,
        appId: cfg.appId
      });
      var messaging = msgMod.getMessaging(app);
      return { app: app, messaging: messaging, vapidKey: cfg.vapidKey, mod: msgMod };
    }).catch(function (err) {
      // Network/CDN failure, unsupported browser, malformed config, etc. —
      // FCM simply stays unavailable; nothing else in the app is affected.
      console.warn('[FcmClient] Firebase SDK load failed (FCM disabled for this session):', err);
      return null;
    });

    return _appPromise;
  }

  /** Requests an FCM token using the Service Worker registration this app
   * already owns (js/core/pwa/ServiceWorkerRegistrar.js). MUST be called
   * only after Notification.permission === 'granted' (caller's
   * responsibility — see NotificationManager.js).
   * @returns {Promise<?string>} the FCM token, or null on any failure.
   */
  global.ahpGetFcmToken = function ahpGetFcmToken() {
    return loadFirebaseMessaging().then(function (ctx) {
      if (!ctx) return null;
      return navigator.serviceWorker.ready.then(function (registration) {
        return ctx.mod.getToken(ctx.messaging, { vapidKey: ctx.vapidKey, serviceWorkerRegistration: registration })
          .catch(function (err) {
            console.warn('[FcmClient] getToken() failed:', err);
            return null;
          });
      });
    });
  };
})(window);
