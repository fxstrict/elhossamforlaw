/* ============================================================================
 * PHASE 16.4 — BOOT SEQUENCE CONSOLIDATION + PROGRESSIVE HYDRATION
 * File: js/core/boot/BootManager.js
 * ----------------------------------------------------------------------------
 * WHAT THIS IS
 *   A new, self-contained layer responsible for exactly one thing: making
 *   sure the dashboard is painted from real data ONCE, instead of the
 *   confirmed two-pass sequence that existed before this phase:
 *
 *     BEFORE (still the fallback path if this file is absent/fails):
 *       DOMContentLoaded -> renderDashboard() [from stale localStorage
 *       mirror] -> Promise.all(readyPromises) settles -> renderDashboard()
 *       AGAIN [from real IndexedDB data] -> visible Flash / Layout Shift.
 *
 *     AFTER (when this file is present and window.bootReadyPromise exists):
 *       DOMContentLoaded -> BootManager.beginBoot() -> show Skeleton
 *       -> window.bootReadyPromise resolves -> renderDashboard() ONCE
 *       -> hide Skeleton -> dispatch 'application:ready'.
 *
 *   window.bootReadyPromise itself is NOT new — it was already built in
 *   Phase 15.1 (see js/core/RepositoryReadyCoordinator.js, section 9) by
 *   joining settingsRepositoryReadyPromise with
 *   getRepositoryReadyCoordinator().whenAllReady(), and that file's own
 *   comment states nothing in the codebase consumed it yet. This file is
 *   its first consumer. No new readiness mechanism is introduced.
 *
 * WHY THE TWO EXISTING RENDER CALL-SITES IN index.html NEEDED A GUARD
 *   Every <script> tag in this document is a plain, synchronous,
 *   non-deferred script, so by the time the DOMContentLoaded event actually
 *   fires, every listener for it (the pre-existing inline one and any
 *   other module's) is already registered, and they run, back-to-back, in
 *   registration order. A brand-new "add another listener" approach
 *   therefore CANNOT be executed before the pre-existing inline listener's
 *   own body runs — it is always registered later in the document. The
 *   only way to actually stop the first, stale-data render from happening
 *   (not just add a second one on top) is to ask that one pre-existing
 *   call-site whether BootManager is already handling this boot. That is
 *   the ONE deliberate, minimal touch to index.html in this phase: a
 *   guard condition around the two existing `updateBadges();
 *   renderDashboard();` statements, in the same
 *   `if (window.SomeNewLayer) SomeNewLayer.method()` guarded-line
 *   convention already used twice in this project (Phase 16.1's
 *   ApplicationShell.recordNavigation() line, Phase 16.3's
 *   ShellNavigationManager.onNavigate() line). Neither statement was
 *   deleted, renamed, or moved — both still exist verbatim and still run
 *   exactly as before whenever BootManager is absent, fails to load, or
 *   window.bootReadyPromise does not exist.
 *
 * PUBLIC API
 *   BootManager.beginBoot()
 *     Idempotent. Called as the very first statement inside the existing
 *     DOMContentLoaded listener (guarded: `if (window.BootManager)
 *     BootManager.beginBoot();`). Does nothing at all (no skeleton, not
 *     "managed") unless window.bootReadyPromise already exists and is
 *     thenable — this is the fail-safe: if the Phase 15.1 primitive isn't
 *     present, BootManager never intercepts anything, and the app behaves
 *     exactly as it did before this phase. If it IS present, shows the
 *     Skeleton immediately and marks itself "managed".
 *
 *   BootManager.shouldSkipLegacyRender()
 *     Read by the two existing render call-sites. Returns true only while
 *     BootManager is actively managing this boot AND has not yet hydrated
 *     — i.e. exactly the window during which the old code must stay
 *     silent so only ONE render happens, driven by BootManager itself
 *     below. Returns false in every other case (not managed, already
 *     hydrated, or beginBoot() never ran), so the legacy calls simply run
 *     as before.
 *
 *   BootManager.onReady(callback)
 *     Subscribe to Application Ready. Invoked once, asynchronously, after
 *     hydration + skeleton hide. If Application Ready has already fired,
 *     the callback runs on the next microtask (same convention as
 *     RepositoryReadyCoordinator.onAllReady()).
 *
 *   EVENT: 'application:ready' (dispatched on window)
 *     event.detail = { timestamp: <number> }. Later phases can rely on
 *     this instead of re-deriving readiness themselves.
 *
 * WHY THIS CANNOT BREAK THE EXISTING APP (zero-regression checklist)
 *   - Adds exactly one global: window.BootManager.
 *   - Does not read, write, or reference Repository, StorageAdapter,
 *     IndexedDB*, RenderQueue, any js/core/shell/* file, or
 *     ShellNavigationManager. Its only external dependency is the
 *     pre-existing window.bootReadyPromise and the pre-existing global
 *     functions updateBadges()/renderDashboard() (called exactly as the
 *     legacy code already calls them — no new arguments, no altered
 *     order).
 *   - No existing CSS file is edited; the Skeleton's styles live entirely
 *     in the new css/skeleton.css.
 *   - The Skeleton DOM node is created and removed entirely at runtime by
 *     this file (document.createElement/appendChild/removeChild) — no
 *     existing HTML element is touched, and no new static HTML markup was
 *     added to index.html for it.
 *   - A 5000ms safety-net timer (same "hard cap" convention already used
 *     by the splash screen's own 1500ms cap in js/modules/firstrun.js)
 *     guarantees the Skeleton can never stay on screen indefinitely even
 *     if bootReadyPromise were somehow never to settle.
 *   - Every public method is wrapped so a failure inside this file can
 *     never propagate out and break DOMContentLoaded or navigate().
 * ==========================================================================*/
(function (global) {
  'use strict';

  function safely(fn, fallback) {
    try {
      return fn();
    } catch (err) {
      if (global.console && global.console.warn) {
        global.console.warn('[BootManager] internal error (swallowed):', err);
      }
      return fallback;
    }
  }

  // PHASE 17.0: raised from 5000 to 16000ms so this timer is a true
  // last-resort backstop that fires AFTER RepositoryReadyCoordinator's
  // own 12000ms boot timeout (js/core/RepositoryReadyCoordinator.js §10)
  // has already had a chance to settle root.bootReadyPromise with a
  // detailed reason. If this timer still fires first, it means
  // root.bootReadyPromise itself never got created/attached correctly —
  // a strictly worse failure than a normal repository timeout — and is
  // reported as such (see _completeBoot()'s 'no-boot-promise' reason).
  var SAFETY_NET_MS = 16000;
  var SKELETON_ID = 'bootSkeletonOverlay';
  var ERROR_SCREEN_ID = 'bootErrorOverlay';

  function BootManager() {
    this._started = false;   // beginBoot() ran
    this._managed = false;   // actively intercepting the legacy render calls
    this._hydrated = false;  // the single hydration render has happened
    this._readyFired = false;
    this._readyCallbacks = [];
    this._skeletonEl = null;
    this._errorEl = null; // PHASE 17.0
    this._safetyTimer = null;
  }

  function hasThenableBootPromise() {
    return !!(global.bootReadyPromise && typeof global.bootReadyPromise.then === 'function');
  }

  BootManager.prototype._buildSkeleton = function () {
    if (this._skeletonEl || !global.document) return;
    var el = global.document.createElement('div');
    el.id = SKELETON_ID;
    el.className = 'boot-skeleton';
    el.setAttribute('aria-hidden', 'true');
    // Generic placeholder shapes — intentionally not a pixel-perfect
    // mirror of the dashboard's real cards, to avoid coupling this new
    // file to that page's markup. Purely visual, no functional role.
    el.innerHTML =
      '<div class="boot-skeleton-block boot-skeleton-title"></div>' +
      '<div class="boot-skeleton-block boot-skeleton-row"></div>' +
      '<div class="boot-skeleton-block boot-skeleton-row short"></div>' +
      '<div class="boot-skeleton-cards">' +
        '<div class="boot-skeleton-block boot-skeleton-card"></div>' +
        '<div class="boot-skeleton-block boot-skeleton-card"></div>' +
        '<div class="boot-skeleton-block boot-skeleton-card"></div>' +
      '</div>';
    global.document.body.appendChild(el);
    this._skeletonEl = el;
  };

  BootManager.prototype._showSkeleton = function () {
    safely(function () {
      this._buildSkeleton();
      if (this._skeletonEl) this._skeletonEl.classList.add('show');
    }.bind(this), undefined);
  };

  BootManager.prototype._hideSkeleton = function () {
    safely(function () {
      if (this._skeletonEl) {
        this._skeletonEl.classList.remove('show');
        if (this._skeletonEl.parentNode) this._skeletonEl.parentNode.removeChild(this._skeletonEl);
        this._skeletonEl = null;
      }
    }.bind(this), undefined);
  };

  // ==========================================================================
  // PHASE 17.0 — Startup Reliability: visible error screen (additive only)
  // --------------------------------------------------------------------------
  // Built at runtime exactly like _buildSkeleton() above (document.createElement
  // / appendChild), styled entirely by the new, standalone css/boot-error.css
  // (same "new file, no existing CSS edited" convention already used by
  // css/skeleton.css). No existing DOM node, HTML markup, or CSS file is
  // touched to add this. Shown ONLY when boot genuinely could not confirm
  // readiness in time (see beginBoot()) — never on the normal fast path.
  // ==========================================================================
  BootManager.prototype._buildErrorScreen = function (message) {
    if (!global.document) return;
    if (this._errorEl && this._errorEl.parentNode) {
      this._errorEl.parentNode.removeChild(this._errorEl);
      this._errorEl = null;
    }
    var el = global.document.createElement('div');
    el.id = ERROR_SCREEN_ID;
    el.className = 'boot-error';
    el.setAttribute('role', 'alert');
    el.innerHTML =
      '<div class="boot-error-box">' +
        '<div class="boot-error-icon" aria-hidden="true">&#9888;</div>' +
        '<div class="boot-error-title">تعذّر تحميل البيانات</div>' +
        '<div class="boot-error-message"></div>' +
        '<button type="button" class="boot-error-retry">إعادة المحاولة</button>' +
      '</div>';
    var msgEl = el.querySelector('.boot-error-message');
    if (msgEl) msgEl.textContent = message || 'استغرق تحميل بيانات البرنامج وقتًا أطول من المتوقع. يرجى إعادة تحميل الصفحة أو التحقق من الاتصال بالإنترنت.';
    var retryBtn = el.querySelector('.boot-error-retry');
    if (retryBtn) {
      retryBtn.addEventListener('click', function () {
        safely(function () { global.location.reload(); }, undefined);
      });
    }
    global.document.body.appendChild(el);
    this._errorEl = el;
  };

  /** @param {string} [message] - Arabic, user-facing. Reason detail always
   *   goes to console/window.__lastBootFailure instead (see
   *   RepositoryReadyCoordinator.js §10), never into this user-facing text. */
  BootManager.prototype._showErrorScreen = function (message) {
    safely(function () {
      this._buildErrorScreen(message);
      var el = this._errorEl;
      if (!el) return;
      if (global.requestAnimationFrame) {
        global.requestAnimationFrame(function () { el.classList.add('show'); });
      } else {
        el.classList.add('show');
      }
    }.bind(this), undefined);
  };

  /** Runs the single hydration render using the pre-existing global
   * functions, exactly as the legacy code already calls them. */
  BootManager.prototype._hydrateOnce = function () {
    safely(function () {
      if (this._hydrated) return;
      this._hydrated = true;
      if (typeof global.updateBadges === 'function') global.updateBadges();
      if (typeof global.renderDashboard === 'function') global.renderDashboard();
      // PHASE 26 — VIEW INFRASTRUCTURE INTEGRATION: this is the app's one
      // real initial paint of the dashboard (see file header — the whole
      // point of this function is that it is called exactly once). Before
      // this line, that paint was invisible to js/core/view/*: ViewCache
      // held no cached version for 'dashboard' yet, so the very next
      // navigate('dashboard') always re-rendered even if nothing had
      // changed since boot. Recording it here — the same way navigate()
      // already does via ViewLifecycle.recordRendered() for every other
      // render call — makes the cache warm from first paint instead of
      // from first navigation. Guarded exactly like every other line in
      // this file: a no-op if js/core/view/ViewLifecycle.js hasn't loaded.
      if (global.ViewLifecycle) global.ViewLifecycle.recordRendered('dashboard');
    }.bind(this), undefined);
  };

  BootManager.prototype._fireApplicationReady = function () {
    safely(function () {
      if (this._readyFired) return;
      this._readyFired = true;
      if (this._safetyTimer) { global.clearTimeout(this._safetyTimer); this._safetyTimer = null; }

      var detail = { timestamp: Date.now() };
      if (global.CustomEvent) {
        global.dispatchEvent(new global.CustomEvent('application:ready', { detail: detail }));
      }
      var callbacks = this._readyCallbacks;
      this._readyCallbacks = [];
      callbacks.forEach(function (fn) { safely(function () { fn(detail); }, undefined); });
    }.bind(this), undefined);
  };

  /** @param {{timedOut:boolean, notReadyEntities:string[], reasonCode:string}} [failure]
   *   PHASE 17.0: optional. Undefined/omitted means the normal, successful
   *   boot path — behavior is then byte-for-byte identical to before this
   *   phase (hydrate, hide skeleton, fire ready; no error screen). When
   *   present, this is a genuine, logged failure (see
   *   RepositoryReadyCoordinator.js §10 for where notReadyEntities/reasonCode
   *   are produced and logged) and a visible error screen is shown in
   *   addition to — not instead of — the existing hydrate/ready steps, so
   *   whatever partial data did manage to load is still displayed. */
  BootManager.prototype._completeBoot = function (failure) {
    safely(function () {
      this._hydrateOnce();
      this._hideSkeleton();
      if (failure && failure.timedOut) {
        this._showErrorScreen();
      }
      this._fireApplicationReady();
    }.bind(this), undefined);
  };

  /** THE single entry point — called once from the existing
   * DOMContentLoaded listener. Never throws. */
  BootManager.prototype.beginBoot = function () {
    return safely(function () {
      if (this._started) return;
      this._started = true;

      if (!hasThenableBootPromise()) {
        // Fail-safe: Phase 15.1's primitive isn't present (e.g. a
        // stripped-down page, or RepositoryReadyCoordinator.js failed to
        // load). Do not intercept anything — the legacy call-sites will
        // run exactly as before.
        this._managed = false;
        return;
      }

      this._managed = true;
      this._showSkeleton();

      // PHASE 17.0: last-resort backstop only. Fires only if
      // root.bootReadyPromise itself never settles at all — a strictly
      // worse failure than a normal repository timeout, since
      // RepositoryReadyCoordinator.js §10 now guarantees that Promise
      // settles on its own within 12000ms. Reported with its own reason
      // code so this case is distinguishable in the console / in
      // window.__lastBootFailure from a normal repository timeout.
      this._safetyTimer = global.setTimeout(function () {
        if (global.console && global.console.error) {
          global.console.error('[BootManager] Safety-net timer fired: window.bootReadyPromise never settled within ' + SAFETY_NET_MS + 'ms (reason: boot-promise-unsettled).');
        }
        global.__lastBootFailure = global.__lastBootFailure || {
          reasonCode: 'boot-promise-unsettled',
          timeoutMs: SAFETY_NET_MS,
          timestamp: (typeof Date !== 'undefined') ? new Date().toISOString() : null
        };
        this._completeBoot({ timedOut: true, notReadyEntities: [], reasonCode: 'boot-promise-unsettled' });
      }.bind(this), SAFETY_NET_MS);

      global.bootReadyPromise.then(function (result) {
        // PHASE 17.0: result now carries { timedOut, notReadyEntities }
        // from RepositoryReadyCoordinator.js §10 instead of being
        // ignored. A normal, older/other producer of bootReadyPromise
        // that still resolves with `undefined` is handled safely too
        // (result defaults to "no failure" below), so this change is
        // backward compatible with any non-Phase-17.0 producer.
        this._completeBoot(result && result.timedOut ? result : undefined);
      }.bind(this)).catch(function () {
        // bootReadyPromise itself is now guaranteed to resolve, never
        // reject (see RepositoryReadyCoordinator.js §10 — every internal
        // path calls resolve()). This .catch is defensive-only backstop
        // so a future change to that contract still can't leave the
        // Skeleton stuck on screen; reported as its own reason code.
        global.__lastBootFailure = global.__lastBootFailure || {
          reasonCode: 'boot-promise-rejected',
          timestamp: (typeof Date !== 'undefined') ? new Date().toISOString() : null
        };
        this._completeBoot({ timedOut: true, notReadyEntities: [], reasonCode: 'boot-promise-rejected' });
      }.bind(this));
    }.bind(this), undefined);
  };

  /** Read by the two guarded legacy render call-sites in index.html. */
  BootManager.prototype.shouldSkipLegacyRender = function () {
    // Once BootManager takes ownership of this boot (managed === true) it
    // stays the sole source of the initial dashboard render for the rest
    // of the boot sequence — before AND after hydration — so a legacy
    // call-site that happens to resolve after BootManager already
    // hydrated (e.g. its own Promise.all settling slightly later) still
    // does not repaint a second time. Internal double-hydration within
    // BootManager itself is separately guarded by this._hydrated inside
    // _hydrateOnce().
    return safely(function () {
      return this._started && this._managed;
    }.bind(this), false);
  };

  BootManager.prototype.isManaged = function () {
    return this._managed;
  };

  BootManager.prototype.isReady = function () {
    return this._readyFired;
  };

  BootManager.prototype.onReady = function (callback) {
    return safely(function () {
      if (typeof callback !== 'function') return;
      if (this._readyFired) {
        global.Promise.resolve().then(function () { safely(function () { callback({ timestamp: Date.now() }); }, undefined); });
        return;
      }
      this._readyCallbacks.push(callback);
    }.bind(this), undefined);
  };

  global.BootManager = new BootManager();
})(window);
