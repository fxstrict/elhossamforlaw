/* ============================================================================
 * js/core/pwa/NotificationManager.js
 * ----------------------------------------------------------------------------
 * PHASE PWA-NOTIFICATIONS — LOCAL PROFESSIONAL SYSTEM-TRAY NOTIFICATIONS
 *
 * WHAT THIS FILE IS
 *   A fully self-contained, additive-only module that shows real OS-level
 *   notifications (Android/desktop notification shade — "ستارة الإشعارات")
 *   for the alerts already computed inside the app (today's/soon sessions,
 *   overdue tasks, cases missing opponent data, cases missing documents —
 *   the exact same four categories js/modules/dashboard.js's
 *   renderAlertsCenterWidget()/renderAlertsWidget() already show inside the
 *   page), the moment the app is opened — and ONLY then, never on a
 *   background timer, never from any external server.
 *
 *   100% LOCAL / NO EXTERNAL SERVER
 *   Uses only two standard, on-device browser APIs:
 *     1. Notification permission (Notification.requestPermission()).
 *     2. ServiceWorkerRegistration.showNotification() — this is what makes
 *        the notification a real, native system-tray entry (appears in the
 *        phone's notification shade, shows the app icon, can vibrate, stays
 *        after the browser tab is closed) instead of a page-only in-tab
 *        alert. No Push API, no VAPID keys, no push server, no network
 *        request of any kind is involved — the app itself calls
 *        showNotification() locally, synchronously, at app-open time, using
 *        the Service Worker registration that js/core/pwa/
 *        ServiceWorkerRegistrar.js already registers.
 *
 *   SOUND — why there is no in-app sound picker
 *   The Web Notification API intentionally has NO parameter for a custom
 *   sound file — this is a browser/OS security restriction, not a
 *   limitation of this implementation. On every modern phone the
 *   notification's sound, vibration pattern, LED, and priority are instead
 *   controlled by the device's own OS-level notification settings for this
 *   installed app/site (Android: Settings -> Apps -> [this app] ->
 *   Notifications -> Sound; iOS/desktop equivalents are analogous) — i.e.
 *   exactly "نغمة يمكن تحديدها من الموبيل من نغمات الموبيل" as requested.
 *   The Settings card this file adds (#notificationsCard) links the person
 *   straight to that reasoning so it is never a mystery why the sound
 *   picker lives on the phone and not inside this app.
 *
 * WHEN IT FIRES — "عند فتح التطبيق ... في وقت فتح البرنامج فقط"
 *   Hooked to the app's own existing single Application-Ready signal
 *   (js/core/boot/BootManager.js's onReady()/'application:ready' event,
 *   with the pre-existing window.bootReadyPromise primitive itself as a
 *   fail-safe fallback — see onAppReady() below). This fires exactly once
 *   per app open/reload, after real data has finished loading, and never
 *   again until the app is closed and reopened — it does not re-fire on
 *   navigate() or on every dashboard re-render.
 *
 * DUPLICATE / STORM PREVENTION (per this project's own Notification
 *   standard — "Avoid duplicate notifications. Prevent notification
 *   storms."): each alert category is only ever notified once per
 *   calendar day (tracked per-category in localStorage — see
 *   LAST_SENT_PREFIX below), so reopening the app five times in the same
 *   afternoon does not resend five copies of the same alert.
 *
 * WHAT THIS FILE DOES NOT DO
 *   - Does not modify js/modules/dashboard.js (its byte-for-byte parity
 *     with its own verify_dashboard_widget_decomposition.js test makes it
 *     unsafe to touch for an unrelated feature). The alert categories below
 *     are an independent, additive re-derivation from the same global
 *     `data` object and the same field names, kept deliberately in sync by
 *     comment reference — see computeAlertSnapshot() below.
 *   - Does not touch IndexedDB, Repository.js, or any business data — reads
 *     the already-loaded in-memory `data` global only, same as
 *     dashboard.js.
 *   - Does not implement any business logic inside service-worker.js — the
 *     Service Worker only gains a thin, generic 'notificationclick' relay
 *     (focus/open the app + tell it which page was tapped), per this
 *     project's own PWA standard ("The Service Worker is infrastructure.
 *     Business logic must never be implemented inside the Service
 *     Worker.").
 *   - Does not send anything over the network. Fully extensible later
 *     (per-category toggles, quiet hours, scheduled/recurring reminders —
 *     see EXTENSION POINTS at the bottom) without changing this contract.
 * ==========================================================================*/
(function (global) {
  'use strict';

  if (!global.document) return;

  // ------------------------------------------------------------------
  // Local-device preferences (device-local only, like DEV_MODE_KEY in
  // js/modules/settings.js and every js/core/pwa/* file's own state —
  // never synced, never sent anywhere).
  // ------------------------------------------------------------------
  var ENABLED_KEY = 'ahpNotificationsEnabled';       // 'true' | 'false' | absent(=on by default)
  var LAST_SENT_PREFIX = 'ahpNotifLastSent:';        // + category key -> 'YYYY-MM-DD'
  var NOTIF_ICON = 'assets/icons/icon-192.png';
  var NOTIF_BADGE = 'assets/icons/icon-96.png';

  function safely(fn, fallback) {
    try { return fn(); } catch (e) { return fallback; }
  }

  function isEnabled() {
    return safely(function () {
      var v = global.localStorage.getItem(ENABLED_KEY);
      return v === null ? true : v === 'true'; // default ON, per request scope
    }, true);
  }

  function setEnabled(flag) {
    safely(function () { global.localStorage.setItem(ENABLED_KEY, flag ? 'true' : 'false'); }, undefined);
  }

  function todayStr() {
    var d = new Date();
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }
  function pad2(n) { return String(n).padStart(2, '0'); }

  function alreadySentToday(categoryKey) {
    return safely(function () {
      return global.localStorage.getItem(LAST_SENT_PREFIX + categoryKey) === todayStr();
    }, false);
  }
  function markSentToday(categoryKey) {
    safely(function () { global.localStorage.setItem(LAST_SENT_PREFIX + categoryKey, todayStr()); }, undefined);
  }

  // ------------------------------------------------------------------
  // Permission
  // ------------------------------------------------------------------
  function notificationsSupported() {
    return typeof global.Notification !== 'undefined' && 'serviceWorker' in navigator;
  }

  function permissionState() {
    if (!notificationsSupported()) return 'unsupported';
    return global.Notification.permission; // 'granted' | 'denied' | 'default'
  }

  /** Requests permission. Must be called from the click handler for
   * browsers that require a user gesture — the Settings card's "تفعيل"
   * button calls this directly. Also attempted silently at app-open time
   * (harmless no-op on browsers that require a gesture: they simply leave
   * permission at 'default' until the person uses the button). */
  function requestPermission(callback) {
    if (!notificationsSupported()) { if (callback) callback('unsupported'); return; }
    if (global.Notification.permission !== 'default') {
      if (callback) callback(global.Notification.permission);
      return;
    }
    try {
      var maybePromise = global.Notification.requestPermission(function (result) {
        if (callback) callback(result);
      });
      if (maybePromise && typeof maybePromise.then === 'function') {
        maybePromise.then(function (result) { if (callback) callback(result); });
      }
    } catch (e) {
      if (callback) callback('default');
    }
  }

  // ------------------------------------------------------------------
  // Alert snapshot — independent re-derivation of the same four
  // categories already shown by js/modules/dashboard.js's
  // renderAlertsWidget()/renderAlertsCenterWidget() (same `data` global,
  // same field names, same thresholds) — see file header for why this is
  // a deliberate, kept-in-sync-by-comment duplication rather than a shared
  // import from that file.
  // ------------------------------------------------------------------
  function computeAlertSnapshot() {
    var d = global.data;
    if (!d || !d.cases || !d.sessions || !d.tasks || !d.documents) return [];

    var now = new Date();
    now.setHours(0, 0, 0, 0);
    var todayKey = now.getFullYear() + '-' + pad2(now.getMonth() + 1) + '-' + pad2(now.getDate());
    var in2h = new Date(new Date().getTime() + 2 * 3600 * 1000);

    var alerts = [];

    // 1) Sessions today (mirrors renderAlertsWidget()).
    var todaySessions = (d.sessions || []).filter(function (s) {
      return String(s['التاريخ']).slice(0, 10) === todayKey;
    });
    if (todaySessions.length) {
      alerts.push({
        key: 'sessions-today',
        title: '\u2696\uFE0F لديك جلسات اليوم',
        body: 'لديك ' + todaySessions.length + ' جلسة اليوم — اضغط لعرض التفاصيل.',
        page: 'sessions'
      });
    }

    // 2) Sessions starting within the next 2 hours (mirrors
    //    renderAlertsCenterWidget()'s soonSessions).
    var soonSessions = (d.sessions || []).filter(function (s) {
      if (String(s['التاريخ']).slice(0, 10) !== todayKey) return false;
      var t = String(s['الوقت'] || '');
      if (!t) return false;
      var parts = t.split(':');
      if (parts.length < 2) return false;
      var st = new Date();
      st.setHours(parseInt(parts[0], 10) || 0, parseInt(parts[1], 10) || 0, 0, 0);
      return st >= new Date() && st <= in2h;
    });
    if (soonSessions.length) {
      alerts.push({
        key: 'sessions-soon',
        title: '\u23F0 جلسة خلال ساعتين',
        body: (soonSessions[0]['عنوان_القضية'] || 'جلسة') + (soonSessions.length > 1 ? ' و' + (soonSessions.length - 1) + ' أخرى' : '') + ' — قريباً جداً.',
        page: 'sessions'
      });
    }

    // 3) Overdue high-priority tasks (mirrors renderAlertsCenterWidget()'s
    //    overdueTasks).
    var overdueTasks = (d.tasks || []).filter(function (t) {
      if (t['الحالة'] === 'done') return false;
      var due = t['الموعد_النهائي'];
      if (!due) return false;
      var dd = safely(function () { return global.parseLocalDate ? global.parseLocalDate(due) : new Date(due); }, null);
      return dd && dd < now;
    });
    if (overdueTasks.length) {
      alerts.push({
        key: 'tasks-overdue',
        title: '\uD83D\uDCCC مهام إدارية متأخرة',
        body: 'لديك ' + overdueTasks.length + ' مهمة تجاوزت موعدها النهائي.',
        page: 'tasks'
      });
    }

    // 4) Active cases with no opponent recorded (mirrors
    //    renderAlertsCenterWidget()'s casesNoOpponent).
    var activeCases = (d.cases || []).filter(function (c) {
      return ['نشطة', 'active'].indexOf(c['الحالة']) !== -1;
    });
    var casesNoOpponent = activeCases.filter(function (c) { return !c['اسم_الخصم']; });
    if (casesNoOpponent.length) {
      alerts.push({
        key: 'cases-no-opponent',
        title: '\uD83D\uDC64 قضايا بدون بيانات خصم',
        body: 'يوجد ' + casesNoOpponent.length + ' قضية نشطة بدون اسم خصم مسجل.',
        page: 'cases'
      });
    }

    // 5) Active cases with zero linked documents (mirrors
    //    renderAlertsCenterWidget()'s casesNoDocuments).
    var casesNoDocuments = activeCases.filter(function (c) {
      var num = c['رقم_القضية'];
      if (!num) return false;
      return !(d.documents || []).some(function (doc) { return doc['رقم_القضية'] === num; });
    });
    if (casesNoDocuments.length) {
      alerts.push({
        key: 'cases-no-documents',
        title: '\uD83D\uDCC4 قضايا بدون مستندات',
        body: 'يوجد ' + casesNoDocuments.length + ' قضية نشطة بدون أي مستند مرفق.',
        page: 'documents'
      });
    }

    return alerts;
  }

  // ------------------------------------------------------------------
  // Delivery — real system-tray notification via the Service Worker
  // registration (falls back to the plain Notification constructor only
  // if no Service Worker is available at all, e.g. unsupported browser).
  // ------------------------------------------------------------------
  function deliver(alert) {
    var options = {
      body: alert.body,
      icon: NOTIF_ICON,
      badge: NOTIF_BADGE,
      tag: 'ahp-' + alert.key,      // replaces any still-visible same-category notification instead of stacking duplicates
      renotify: false,
      dir: 'rtl',
      lang: 'ar',
      vibrate: [200, 100, 200],
      data: { page: alert.page, key: alert.key },
      timestamp: Date.now()
    };
    if ('serviceWorker' in navigator && navigator.serviceWorker.ready) {
      navigator.serviceWorker.ready.then(function (reg) {
        reg.showNotification(alert.title, options);
      }).catch(function () {
        safely(function () { new global.Notification(alert.title, options); }, undefined);
      });
    } else {
      safely(function () { new global.Notification(alert.title, options); }, undefined);
    }
  }

  /** Public: computes the current snapshot and delivers any category not
   * already sent today. Safe to call multiple times — already-sent
   * categories are skipped. */
  function checkAndNotify() {
    if (!isEnabled()) return;
    if (permissionState() !== 'granted') return;
    var alerts = safely(computeAlertSnapshot, []) || [];
    alerts.forEach(function (alert) {
      if (alreadySentToday(alert.key)) return;
      deliver(alert);
      markSentToday(alert.key);
    });
  }

  /** Public: bypasses the once-per-day guard — used by the Settings
   * card's "إرسال إشعار تجريبي" button so the person can confirm sound/
   * appearance immediately. */
  function sendTestNotification() {
    deliver({
      key: 'test',
      title: '\uD83D\uDD14 إشعار تجريبي — نظام الحسام',
      body: 'هكذا ستظهر تنبيهاتك على شاشة الهاتف. النغمة تُحدَّد من إعدادات إشعارات الهاتف لهذا التطبيق.',
      page: 'dashboard'
    });
  }

  // ------------------------------------------------------------------
  // App-open hook — see file header "WHEN IT FIRES".
  // ------------------------------------------------------------------
  function onAppReady(cb) {
    if (global.BootManager && typeof global.BootManager.onReady === 'function') {
      global.BootManager.onReady(cb);
      return;
    }
    if (global.bootReadyPromise && typeof global.bootReadyPromise.then === 'function') {
      global.bootReadyPromise.then(function () { cb(); }).catch(function () { cb(); });
      return;
    }
    // Last-resort fallback for a stripped-down page missing both
    // primitives — mirrors the fail-soft convention already used
    // throughout js/core/pwa/*.
    if (global.document.readyState === 'complete') {
      global.setTimeout(cb, 1500);
    } else {
      global.addEventListener('load', function () { global.setTimeout(cb, 1500); });
    }
  }

  // ------------------------------------------------------------------
  // Settings card wiring (#notificationsCard — markup added to
  // index.html, mount-point-only, exact same convention as
  // #installAppCard / InstallPromptManager.js).
  // ------------------------------------------------------------------
  function refreshSettingsCardUI() {
    var card = global.document.getElementById('notificationsCard');
    if (!card) return; // settings markup not present on this page — no-op

    var statusEl = global.document.getElementById('notifPermissionStatus');
    var enableBtn = global.document.getElementById('notifEnableBtn');
    var testBtn = global.document.getElementById('notifTestBtn');
    var toggle = global.document.getElementById('notifToggleCheckbox');

    var state = permissionState();
    var labels = {
      granted: '\u2705 مفعّلة — ستصلك الإشعارات على شاشة هاتفك.',
      denied: '\u26D4 محظورة من المتصفح. لتفعيلها: افتح إعدادات الموقع/التطبيق على هاتفك وفعّل "الإشعارات" يدوياً.',
      default: '\u26AA لم يتم التفعيل بعد.',
      unsupported: '\u26A0\uFE0F المتصفح الحالي لا يدعم إشعارات النظام.'
    };
    if (statusEl) statusEl.textContent = labels[state] || labels.default;
    if (enableBtn) enableBtn.style.display = (state === 'default') ? 'inline-block' : 'none';
    if (testBtn) testBtn.disabled = (state !== 'granted');
    if (toggle) toggle.checked = isEnabled();
  }

  global.handleEnableNotificationsClick = function handleEnableNotificationsClick() {
    requestPermission(function (result) {
      refreshSettingsCardUI();
      if (result === 'granted') {
        setEnabled(true);
        checkAndNotify();
      }
    });
  };

  global.handleNotifToggleChange = function handleNotifToggleChange(checkbox) {
    setEnabled(!!(checkbox && checkbox.checked));
    if (checkbox && checkbox.checked && permissionState() === 'default') {
      global.handleEnableNotificationsClick();
    }
  };

  global.handleSendTestNotificationClick = function handleSendTestNotificationClick() {
    if (permissionState() !== 'granted') { refreshSettingsCardUI(); return; }
    sendTestNotification();
  };

  // Re-check every time Settings is opened, same pattern
  // InstallPromptManager.js already uses for its own card.
  global.document.addEventListener('click', function (e) {
    var t = e.target;
    if (t && t.closest && t.closest('[onclick*="navigate(\'settings\')"]')) {
      global.setTimeout(refreshSettingsCardUI, 0);
    }
  }, true);

  // ------------------------------------------------------------------
  // Client-side half of the Service Worker's 'notificationclick' relay
  // (see service-worker.js) — the SW only focuses/opens the window and
  // posts the tapped page back; actual navigation uses this app's own
  // existing global navigate(), never duplicated inside the SW.
  // ------------------------------------------------------------------
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.addEventListener('message', function (event) {
      if (event.data && event.data.type === 'AHP_NOTIFICATION_CLICK' && event.data.page) {
        safely(function () { if (typeof global.navigate === 'function') global.navigate(event.data.page); }, undefined);
      }
    });
  }

  if (global.document.readyState === 'loading') {
    global.document.addEventListener('DOMContentLoaded', refreshSettingsCardUI);
  } else {
    refreshSettingsCardUI();
  }

  onAppReady(function () {
    safely(function () {
      // Silent attempt: on many installed-PWA/Android contexts this
      // succeeds without a gesture; where it doesn't, permission simply
      // stays 'default' until the person taps "تفعيل" in Settings — see
      // requestPermission()'s own doc comment.
      if (isEnabled() && permissionState() === 'default') {
        requestPermission(function () { refreshSettingsCardUI(); checkAndNotify(); });
      } else {
        checkAndNotify();
      }
      refreshSettingsCardUI();
    }, undefined);
  });

  // ------------------------------------------------------------------
  // EXTENSION POINTS (documented, not implemented — future phases only):
  //   - Per-category on/off toggles: iterate computeAlertSnapshot()'s
  //     `key`s into individual checkboxes, gate deliver() on each.
  //   - Quiet hours: check a stored "from"/"to" pair before deliver().
  //   - Scheduled/recurring reminders independent of app-open: would
  //     require the Push API + a real push server (explicitly out of
  //     scope here per "بدون سيرفر خارجي محلياً").
  // ------------------------------------------------------------------

  global.AhpNotifications = {
    checkAndNotify: checkAndNotify,
    sendTestNotification: sendTestNotification,
    requestPermission: requestPermission,
    isEnabled: isEnabled,
    setEnabled: setEnabled,
    permissionState: permissionState
  };
})(window);
