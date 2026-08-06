/* ============================================================================
 * js/core/pwa/ServiceWorkerRegistrar.js
 * ----------------------------------------------------------------------------
 * PHASE 17.3 — SERVICE WORKER REGISTRATION + SAFE-UPDATE BANNER
 *
 * WHAT THIS FILE IS
 *   The only piece of the app that talks to service-worker.js. It:
 *     1. Registers the service worker after `window.load`, so registration
 *        (a background, non-blocking network request for the SW script
 *        itself) never competes with first-paint/boot work.
 *     2. Detects when a NEW service worker has finished installing and is
 *        sitting in the "waiting" state (i.e. an update is available) and
 *        shows a small, self-contained update banner.
 *     3. Only sends the waiting worker the `SKIP_WAITING` message — the
 *        one thing that lets it take over — after the person actually
 *        clicks "Update now" on that banner. Never automatically.
 *     4. Reloads the page exactly once when the new worker takes control,
 *        so the person immediately gets the new shell instead of a stale
 *        one still running old JS.
 *
 * WHY A NEW FILE INSTEAD OF EXTENDING toast()
 *   index.html's existing toast(msg,type) (used throughout the app) is a
 *   fire-and-forget notice that auto-dismisses after 3.5s and has no
 *   click/action support — it was not built to ask the person to do
 *   something. Adding a click handler / persistent variant to it would
 *   mean editing a shared function every other module already depends on,
 *   which is out of this phase's scope ("لا تعدل في كود ليس له علاقة
 *   بالموضوع"). This file instead builds its own small, fully
 *   self-contained banner (own DOM node, own inline styles, no dependency
 *   on any existing CSS file or class) — the same pattern
 *   js/debug/RuntimeDebugLayer.js already uses for its floating "RD"
 *   button, so it does not collide with or depend on app styling that may
 *   change later.
 *
 * WHAT THIS FILE DOES NOT DO
 *   It never touches IndexedDB, Repository.js, ApiService, or any
 *   business/legal data — this is registration + UI plumbing only, per
 *   this project's PWA standard ("Business logic must never be
 *   implemented inside the Service Worker" — and, by the same principle,
 *   not in this file either). If registration fails for any reason
 *   (unsupported browser, blocked network, running from `file://`), it
 *   fails silently to a console.warn and the app continues exactly as it
 *   did before this phase — no user-visible error, no thrown exception.
 * ==========================================================================*/
(function () {
  'use strict';

  if (!('serviceWorker' in navigator)) return; // unsupported browser — no-op, app works as before

  var _reloadedOnce = false;

  function showUpdateBanner(waitingWorker) {
    if (document.getElementById('swUpdateBanner')) return; // already shown

    var bar = document.createElement('div');
    bar.id = 'swUpdateBanner';
    bar.setAttribute('dir', 'rtl');
    bar.style.cssText = [
      'position:fixed', 'left:0', 'right:0', 'bottom:0', 'z-index:99999',
      'display:flex', 'align-items:center', 'justify-content:center',
      'gap:14px', 'flex-wrap:wrap', 'padding:12px 16px',
      'background:#0D1B2A', 'color:#fff', 'font-size:13px',
      'font-family:Cairo,Tahoma,Arial,sans-serif',
      'box-shadow:0 -2px 10px rgba(0,0,0,0.25)'
    ].join(';');

    var msg = document.createElement('span');
    msg.textContent = '\u2728 يتوفر إصدار جديد من التطبيق';
    bar.appendChild(msg);

    var updateBtn = document.createElement('button');
    updateBtn.textContent = 'تحديث الآن';
    updateBtn.style.cssText = 'background:#1AB86C;color:#fff;border:none;border-radius:6px;padding:7px 16px;font-size:13px;cursor:pointer;font-family:inherit;';
    updateBtn.onclick = function () {
      updateBtn.disabled = true;
      updateBtn.textContent = 'جارِ التحديث...';
      dismissBtn.disabled = true;
      try { waitingWorker.postMessage({ type: 'SKIP_WAITING' }); } catch (e) {}
    };
    bar.appendChild(updateBtn);

    var dismissBtn = document.createElement('button');
    dismissBtn.textContent = 'لاحقًا';
    dismissBtn.style.cssText = 'background:transparent;color:#cfd8e3;border:1px solid rgba(255,255,255,0.35);border-radius:6px;padding:7px 16px;font-size:13px;cursor:pointer;font-family:inherit;';
    dismissBtn.onclick = function () {
      // Deferred Update: the waiting worker is left alone. It activates on
      // its own, per the standard Service Worker lifecycle, the next time
      // every open tab of this app is closed and the app is reopened — no
      // extra plumbing needed for that case.
      if (bar.parentNode) bar.parentNode.removeChild(bar);
    };
    bar.appendChild(dismissBtn);

    document.body.appendChild(bar);
  }

  function trackInstallingWorker(reg, worker) {
    if (!worker) return;
    worker.addEventListener('statechange', function () {
      if (worker.state === 'installed' && navigator.serviceWorker.controller) {
        // A controller already existed before this install finished, so
        // this is an UPDATE to an already-running app, not the very first
        // install — exactly the case that needs the person's confirmation.
        showUpdateBanner(worker);
      }
    });
  }

  window.addEventListener('load', function () {
    navigator.serviceWorker.register('./service-worker.js').then(function (reg) {
      if (reg.waiting && navigator.serviceWorker.controller) {
        showUpdateBanner(reg.waiting);
      }
      if (reg.installing) trackInstallingWorker(reg, reg.installing);
      reg.addEventListener('updatefound', function () {
        trackInstallingWorker(reg, reg.installing);
      });
    }).catch(function (err) {
      try { console.warn('[SW] registration skipped (non-fatal):', err && err.message); } catch (e) {}
    });
  });

  navigator.serviceWorker.addEventListener('controllerchange', function () {
    if (_reloadedOnce) return; // guard against a reload loop
    _reloadedOnce = true;
    location.reload();
  });
})();
