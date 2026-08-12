/* ============================================================================
 * PHASE 17.6 — SAFE MODE BOOT (additive-only)
 * File: js/core/boot/SafeModeController.js
 * ----------------------------------------------------------------------------
 * WHAT THIS IS
 *   A new, self-contained layer that turns a partial boot failure — one or
 *   more entity Repositories never becoming ready within
 *   RepositoryReadyCoordinator.js's boot timeout — from an undifferentiated,
 *   silent condition into a visible, per-module "Safe Mode": the modules
 *   that ARE ready keep working exactly as before, and the ones that are
 *   NOT ready are clearly marked, instead of the whole application being
 *   treated as failed (js/core/boot/BootManager.js's existing full-screen
 *   error overlay) or silently showing a blank/stale page (every
 *   render<Entity>() function's own existing
 *   `if (!<entity>Repository.isReady()) return;` guard — evidence: e.g.
 *   js/modules/cases.js renderCases() line ~493).
 *
 *   Concretely, for each mapped entity that is not ready once boot settles:
 *     - its sidebar nav-item gets a small ✕ status marker (css/safe-mode.css
 *       .safe-mode-status--fail); every other mapped nav-item gets a ✓
 *       marker, so the partial state is visible at a glance (only when Safe
 *       Mode is actually active — see "ZERO-CHANGE HAPPY PATH" below).
 *     - a single, non-blocking banner appears (bottom of the viewport,
 *       z-index BELOW every existing boot/splash/error overlay — see
 *       css/safe-mode.css header) naming which sections are affected, with
 *       a "retry" button (a plain reload — this phase does not add a
 *       surgical single-Repository retry API, since none exists yet to
 *       hook into).
 *     - if/when the user navigates to that module's own page, an inline
 *       notice is shown at the top of that page's existing container
 *       (#page-<id>) explaining that this specific section is unavailable,
 *       without touching that page's own render function or markup.
 *   If an affected entity's Repository later becomes ready on its own
 *   (RepositoryReadyCoordinator already supports this — a slow but
 *   eventually-successful IndexedDB open does not stop retrying), this
 *   file flips that module back to ✓, drops it from the banner, and
 *   removes its page notice — live, with no reload required.
 *
 * WHAT THIS FILE IS NOT
 *   - It is NOT a replacement for BootManager.js's full-screen error
 *     overlay. That overlay is reserved for the "root.bootReadyPromise
 *     itself never settled" case (BootManager.js §17.0) — a strictly worse
 *     failure. This file only ever runs AFTER BootManager has already
 *     completed its own boot sequence (hooked via BootManager.onReady()),
 *     and only concerns itself with per-entity granularity below that.
 *   - It does NOT call open() on anything, does NOT construct or wrap any
 *     Repository, and does NOT modify RepositoryReadyCoordinator.js,
 *     BootManager.js, or any entity module (cases.js, clients.js,
 *     documents.js, etc.) — zero lines of any of those files changed.
 *   - It does NOT poll. All readiness observation is via
 *     RepositoryReadyCoordinator's existing `isReady()` / `onReady()`
 *     Promise-driven API — no `setInterval`, no retry loop.
 *   - It does NOT touch any page's own render function
 *     (renderCases/renderClients/renderDocuments/...). Those keep running
 *     exactly as before, including their own existing not-ready guard.
 *
 * ZERO-CHANGE HAPPY PATH
 *   On a fully successful boot (every entity Repository ready in time —
 *   the overwhelmingly common case), `_evaluate()` finds zero failed
 *   entities and returns immediately: no nav-item is touched, no banner is
 *   built, no page notice is ever shown. This file adds nothing to the DOM
 *   at all unless Safe Mode is genuinely active.
 *
 * THE ONE INDEX.HTML TOUCH THIS PHASE MAKES (besides the new <script> tag)
 *   navigate() already contains exactly two guarded lines added by prior
 *   phases for the identical purpose (Phase 16.1's
 *   `if(window.ApplicationShell)ApplicationShell.recordNavigation(page);`
 *   and Phase 16.3's
 *   `if(window.ShellNavigationManager)ShellNavigationManager.onNavigate(page);`).
 *   This phase adds ONE more line in that exact convention:
 *   `if(window.SafeModeController)SafeModeController.onNavigate(page);` —
 *   so the per-page notice can be shown/hidden as the user moves between
 *   pages. Nothing else inside navigate() was touched. If this file is
 *   absent or throws, navigate() runs exactly as it did before.
 *
 * PUBLIC API
 *   SafeModeController.onNavigate(pageId)
 *     Read by the one guarded line inside navigate() above. Never throws.
 *   SafeModeController.isActive()
 *     true once at least one mapped entity has been found not-ready after
 *     boot settled (and has not since recovered back to zero).
 *   SafeModeController.getFailedEntities()
 *     string[] snapshot of currently-failed entity keys.
 *
 * LOAD ORDER
 *   Must load AFTER js/core/RepositoryReadyCoordinator.js and
 *   js/core/boot/BootManager.js (reads window.getRepositoryReadyCoordinator
 *   and window.BootManager.onReady). Placed in index.html directly after
 *   js/core/shell/NavigationManager.js — the last of the existing boot/
 *   shell layer scripts — so every dependency above is already guaranteed
 *   to exist by the time this file runs. If any of them is absent, this
 *   file fails safe (see init()) rather than throwing.
 * ==========================================================================*/
(function (global) {
  'use strict';

  function safely(fn, fallback) {
    try {
      return fn();
    } catch (err) {
      if (global.console && global.console.warn) {
        global.console.warn('[SafeModeController] internal error (swallowed):', err);
      }
      return fallback;
    }
  }

  // Entity keys are RepositoryReadyCoordinator.js's DEFAULT_ENTITY_KEYS;
  // page ids are index.html's PAGE_TITLES / navigate() page ids. Every key
  // here maps 1:1 to an existing nav-item and an existing #page-<id>
  // container — no new page was created. 'clientMessages' is deliberately
  // left unmapped: it has no dedicated nav-item/page of its own (see
  // index.html's PAGE_TITLES, which has no 'clientMessages' entry).
  var ENTITY_TO_PAGE = {
    cases: 'cases',
    clients: 'clients',
    sessions: 'sessions',
    tasks: 'tasks',
    documents: 'documents',
    fees: 'fees',
    library: 'library',
    templates: 'templates',
    children: 'children'
  };

  // Arabic display names for the banner text only — mirrors index.html's
  // own PAGE_TITLES values verbatim, kept as a local copy so this file has
  // no hard dependency on PAGE_TITLES existing (fails soft to the page id
  // itself if PAGE_TITLES is ever unavailable).
  var PAGE_LABELS = {
    cases: 'القضايا', clients: 'الموكلون', sessions: 'الجلسات', tasks: 'المهام',
    documents: 'المستندات', fees: 'الأتعاب', library: 'المكتبة القانونية',
    templates: 'صيغ الدعاوى', children: 'الأطفال'
  };

  var BANNER_ID = 'safeModeBanner';

  function SafeModeController() {
    this._started = false;
    this._initialized = false; // true once boot has been evaluated at least once
    this._failedEntities = {}; // entityKey -> true
  }

  function coordinator() {
    return (typeof global.getRepositoryReadyCoordinator === 'function')
      ? global.getRepositoryReadyCoordinator()
      : null;
  }

  // ----------------------------------------------------------------
  // Nav-item status marker (✓ / ✕)
  // ----------------------------------------------------------------

  SafeModeController.prototype._navItemFor = function (page) {
    return safely(function () {
      if (!global.document) return null;
      var items = global.document.querySelectorAll('.nav-item');
      for (var i = 0; i < items.length; i++) {
        // Same exact selector convention navigate() itself already uses
        // (index.html) to find a nav-item for a given page id.
        if (items[i].getAttribute('onclick') === "navigate('" + page + "')") return items[i];
      }
      return null;
    }, null);
  };

  SafeModeController.prototype._markNavItem = function (page, ok) {
    safely(function () {
      var item = this._navItemFor(page);
      if (!item) return;
      var existing = item.querySelector('.safe-mode-status');
      if (existing && existing.parentNode) existing.parentNode.removeChild(existing);
      var span = global.document.createElement('span');
      span.className = 'safe-mode-status ' + (ok ? 'safe-mode-status--ok' : 'safe-mode-status--fail');
      span.setAttribute('aria-hidden', 'false');
      span.title = ok ? 'متاح' : 'غير متاح الآن — الوضع الآمن';
      span.textContent = ok ? '\u2713' : '\u2715';
      item.appendChild(span);
    }.bind(this), undefined);
  };

  // ----------------------------------------------------------------
  // Banner
  // ----------------------------------------------------------------

  SafeModeController.prototype._buildBanner = function () {
    return safely(function () {
      var existing = global.document.getElementById(BANNER_ID);
      if (existing) return existing;
      var el = global.document.createElement('div');
      el.id = BANNER_ID;
      el.className = 'safe-mode-banner';
      el.setAttribute('role', 'status');

      var text = global.document.createElement('span');
      text.className = 'safe-mode-banner-text';
      el.appendChild(text);

      var retry = global.document.createElement('button');
      retry.type = 'button';
      retry.className = 'safe-mode-banner-retry';
      retry.textContent = 'إعادة المحاولة';
      retry.onclick = function () {
        safely(function () { global.location.reload(); }, undefined);
      };
      el.appendChild(retry);

      global.document.body.appendChild(el);
      return el;
    }, null);
  };

  SafeModeController.prototype._updateBanner = function () {
    safely(function () {
      var failedKeys = Object.keys(this._failedEntities);

      if (!failedKeys.length) {
        var existing = global.document.getElementById(BANNER_ID);
        if (existing && existing.parentNode) existing.parentNode.removeChild(existing);
        return;
      }

      var el = this._buildBanner();
      if (!el) return;
      var labels = failedKeys.map(function (k) { return PAGE_LABELS[k] || k; }).join('، ');
      var textEl = el.querySelector('.safe-mode-banner-text');
      if (textEl) {
        textEl.textContent = '\u26A0 الوضع الآمن مفعّل — تعذر تحميل: ' + labels +
          '. باقي أقسام النظام تعمل بشكل طبيعي.';
      }
      el.classList.add('show');
    }.bind(this), undefined);
  };

  // ----------------------------------------------------------------
  // Per-page inline notice
  // ----------------------------------------------------------------

  SafeModeController.prototype._pageNotice = function (page) {
    return safely(function () {
      var container = global.document.getElementById('page-' + page);
      if (!container) return null;
      return container.querySelector('.safe-mode-page-notice');
    }, null);
  };

  SafeModeController.prototype._showPageNotice = function (page) {
    safely(function () {
      var container = global.document.getElementById('page-' + page);
      if (!container || this._pageNotice(page)) return;
      var el = global.document.createElement('div');
      el.className = 'safe-mode-page-notice';
      el.setAttribute('role', 'alert');
      el.textContent = '\u26A0 تعذر تحميل بيانات هذا القسم حالياً. ' +
        'النظام يعمل في الوضع الآمن وباقي الأقسام غير متأثرة.';
      container.insertBefore(el, container.firstChild);
    }.bind(this), undefined);
  };

  SafeModeController.prototype._hidePageNotice = function (page) {
    safely(function () {
      var el = this._pageNotice(page);
      if (el && el.parentNode) el.parentNode.removeChild(el);
    }.bind(this), undefined);
  };

  // ----------------------------------------------------------------
  // Evaluation (runs once, after BootManager.onReady fires) + live
  // self-healing subscriptions for any entity that recovers afterward.
  // ----------------------------------------------------------------

  SafeModeController.prototype._onEntityRecovered = function (entityKey) {
    safely(function () {
      if (!Object.prototype.hasOwnProperty.call(this._failedEntities, entityKey)) return;
      delete this._failedEntities[entityKey];
      var page = ENTITY_TO_PAGE[entityKey];
      this._markNavItem(page, true);
      this._hidePageNotice(page);
      this._updateBanner();
    }.bind(this), undefined);
  };

  SafeModeController.prototype._evaluate = function () {
    safely(function () {
      this._initialized = true;
      var coord = coordinator();
      if (!coord) return; // Fail-safe: coordinator unavailable, Safe Mode stays inert.

      var self = this;
      Object.keys(ENTITY_TO_PAGE).forEach(function (entityKey) {
        if (coord.isReady(entityKey)) return;
        self._failedEntities[entityKey] = true;
        // Self-healing: flips this module back to ✓ live if its
        // Repository eventually opens successfully after all.
        coord.onReady(entityKey, function () { self._onEntityRecovered(entityKey); });
      });

      var failedKeys = Object.keys(this._failedEntities);
      if (!failedKeys.length) return; // Zero-change happy path — see header.

      Object.keys(ENTITY_TO_PAGE).forEach(function (entityKey) {
        self._markNavItem(ENTITY_TO_PAGE[entityKey], !self._failedEntities[entityKey]);
      });
      this._updateBanner();

      // If the currently-open page belongs to an already-failed entity
      // (e.g. a restored deep link), show its notice immediately instead
      // of waiting for the next navigate() call.
      var current = safely(function () { return global.currentPage; }, null);
      if (current && this._failedEntities[current]) this._showPageNotice(current);
    }.bind(this), undefined);
  };

  // ----------------------------------------------------------------
  // Public API
  // ----------------------------------------------------------------

  /** Read by the one guarded line added inside navigate(). Never throws. */
  SafeModeController.prototype.onNavigate = function (page) {
    safely(function () {
      if (!this._initialized) return; // Boot not evaluated yet — nothing to show either way.
      if (Object.prototype.hasOwnProperty.call(this._failedEntities, page)) {
        this._showPageNotice(page);
      } else {
        this._hidePageNotice(page);
      }
    }.bind(this), undefined);
  };

  SafeModeController.prototype.isActive = function () {
    return Object.keys(this._failedEntities).length > 0;
  };

  SafeModeController.prototype.getFailedEntities = function () {
    return Object.keys(this._failedEntities);
  };

  SafeModeController.prototype.init = function () {
    return safely(function () {
      if (this._started) return;
      this._started = true;
      if (global.BootManager && typeof global.BootManager.onReady === 'function') {
        global.BootManager.onReady(this._evaluate.bind(this));
      } else {
        // Fail-safe: BootManager absent (e.g. a stripped-down harness).
        // Evaluate on the next microtask against whatever readiness state
        // already exists, so this file never hard-depends on a boot layer
        // it cannot find.
        global.Promise.resolve().then(this._evaluate.bind(this));
      }
    }.bind(this), undefined);
  };

  global.SafeModeController = new SafeModeController();
  global.SafeModeController.init();

})(window);
