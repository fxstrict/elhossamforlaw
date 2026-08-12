/* ============================================================================
 * js/core/pwa/InstallPromptManager.js
 * ----------------------------------------------------------------------------
 * PHASE PWA-INSTALL — PERSISTENT "تثبيت التطبيق" CONTROL IN SETTINGS
 *
 * WHAT THIS FILE IS
 *   Wires the three-state install card already markup-only in index.html's
 *   #installAppCard (id="page-settings") to the real browser install APIs:
 *     1. installAppAvailable — a real "beforeinstallprompt" event is sitting
 *        ready (captured as early as possible by the inline script at the
 *        very top of index.html's <head>, into
 *        window.__ahpDeferredInstallPrompt, because that event can only be
 *        used if preventDefault() was called on it synchronously when it
 *        first fired — this file only ever reads it, never listens for the
 *        raw event itself, so it can safely load late like every other
 *        module script).
 *     2. installAppInstalled — the app is already running standalone
 *        (installed), detected via display-mode / navigator.standalone.
 *     3. installAppManual — neither of the above: browser hasn't offered an
 *        automatic prompt (yet, or ever, e.g. iOS Safari has no
 *        beforeinstallprompt API at all) — shows manual per-platform steps.
 *
 * WHY THIS SOLVES "install option must survive the top install bar
 * disappearing / must still work after an uninstall"
 *   Chrome's own install bar/mini-infobar is transient: the person can
 *   dismiss it, it can simply not reappear for a while per the browser's own
 *   heuristics, and none of that is under this app's control. This file does
 *   not try to force that bar to reappear — instead it keeps its OWN button
 *   permanently visible in Settings and re-checks state every time Settings
 *   is opened (see refreshInstallCardUI below) and whenever the browser
 *   later dispatches the 'ahp:bip-available' / 'ahp:app-installed' custom
 *   events from that same early inline script. If a person uninstalls the
 *   app and later revisits the site, the browser will (per its own
 *   heuristics) typically fire "beforeinstallprompt" again — this file is
 *   already listening for that via the custom event, so the Settings button
 *   becomes usable again the moment it does, with no separate re-install
 *   flow needed.
 *
 * WHAT THIS FILE DOES NOT DO
 *   It never touches IndexedDB, Repository.js, ApiService, or any
 *   business/legal data — install-prompt plumbing + Settings UI only, same
 *   scope boundary as js/core/pwa/ServiceWorkerRegistrar.js. It defines
 *   exactly one new global function, handleInstallAppClick(), because
 *   index.html's #installAppBtn already calls it inline (same onclick="..."
 *   convention every other button on that page already uses — see
 *   saveApiUrl(), testConnection(), etc.).
 * ==========================================================================*/
(function () {
  'use strict';

  function isStandaloneDisplay() {
    try {
      if (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) return true;
    } catch (e) {}
    // iOS Safari legacy flag — no matchMedia standalone support there.
    return !!window.navigator.standalone;
  }

  function showOnly(id) {
    var ids = ['installAppAvailable', 'installAppInstalled', 'installAppManual'];
    for (var i = 0; i < ids.length; i++) {
      var el = document.getElementById(ids[i]);
      if (!el) continue;
      el.style.display = (ids[i] === id) ? (id === 'installAppAvailable' ? 'flex' : 'block') : 'none';
    }
  }

  function refreshInstallCardUI() {
    if (!document.getElementById('installAppCard')) return; // settings markup not present — no-op

    if (isStandaloneDisplay()) {
      showOnly('installAppInstalled');
      return;
    }
    if (window.__ahpDeferredInstallPrompt) {
      showOnly('installAppAvailable');
      return;
    }
    showOnly('installAppManual');
  }

  // Exposed so index.html's #installAppBtn (onclick="handleInstallAppClick()")
  // can call it — same pattern as every other settings action on that page.
  window.handleInstallAppClick = function handleInstallAppClick() {
    var deferred = window.__ahpDeferredInstallPrompt;
    if (!deferred) {
      // Prompt is no longer available (already used, or never fired) —
      // fall back to showing the manual per-platform steps instead of a
      // dead button.
      showOnly('installAppManual');
      return;
    }
    var btn = document.getElementById('installAppBtn');
    if (btn) { btn.disabled = true; }
    try {
      deferred.prompt();
      deferred.userChoice.then(function () {
        // Whether accepted or dismissed, this specific prompt object is now
        // spent and cannot be reused — clear it either way. If accepted,
        // 'appinstalled' will also fire and switch the card to "installed".
        window.__ahpDeferredInstallPrompt = null;
        if (btn) { btn.disabled = false; }
        refreshInstallCardUI();
      }).catch(function () {
        window.__ahpDeferredInstallPrompt = null;
        if (btn) { btn.disabled = false; }
        refreshInstallCardUI();
      });
    } catch (e) {
      if (btn) { btn.disabled = false; }
      refreshInstallCardUI();
    }
  };

  document.addEventListener('ahp:bip-available', refreshInstallCardUI);
  document.addEventListener('ahp:app-installed', refreshInstallCardUI);

  // Re-check every time Settings is actually opened, in case display-mode
  // or the deferred-prompt global changed since the page first loaded (this
  // app is a single long-lived page — navigate('settings') never reloads
  // it — so this is the only reliable moment besides the two events above).
  document.addEventListener('click', function (e) {
    var t = e.target;
    if (t && t.closest && t.closest('[onclick*="navigate(\'settings\')"]')) {
      setTimeout(refreshInstallCardUI, 0);
    }
  }, true);

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', refreshInstallCardUI);
  } else {
    refreshInstallCardUI();
  }
})();
