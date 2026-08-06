/* ============================================================================
 * PHASE 17.5 — STARTUP TIMEOUT MANAGER (generic, additive-only)
 * File: js/core/StartupTimeoutManager.js
 * ----------------------------------------------------------------------------
 * WHAT THIS IS
 *   A small, standalone, GENERIC version of the same bounded-wait pattern
 *   this project already applies in three separate, narrower places:
 *     1. js/core/RepositoryReadyTimeout.js — wraps each entity's own
 *        `<entityKey>RepositoryReadyPromise` (12s default).
 *     2. js/core/RepositoryReadyCoordinator.js §10 — wraps the aggregate
 *        `window.bootReadyPromise` (12s).
 *     3. js/core/boot/BootManager.js — a last-resort 16s safety net around
 *        `window.bootReadyPromise` itself.
 *   Those three already close every unbounded wait on the "9 entity
 *   Repositories + settings + aggregate boot" path. This file exists to
 *   close the two gaps a direct, evidence-based re-read of the current
 *   source (this phase's own audit) found OUTSIDE that already-covered
 *   path:
 *     (a) `settingsRepositoryReadyPromise` (js/repositories/
 *         SettingsRepositoryWiring.js) is the ONLY `<entityKey>Repository
 *         ReadyPromise` in the whole codebase that was never wrapped by
 *         RepositoryReadyTimeout.wrap(...) — every one of the other 10
 *         entity modules (cases, clients, sessions, tasks, documents,
 *         fees, library, templates, children, clientMessages) already
 *         does this. `window.bootReadyPromise` itself is still safe
 *         either way (RepositoryReadyCoordinator.js §10 bounds the
 *         *aggregate* Promise.all regardless), but the THREE separate,
 *         direct `settingsRepositoryReadyPromise.then(...)` call-sites
 *         (index.html's Part 8 reconciliation, js/modules/settings.js,
 *         js/modules/firstrun.js) each await that promise directly and
 *         had no bound of their own before this phase.
 *     (b) js/core/MigrationBootstrap.js's two internal steps
 *         (`service.getStatus()`, `service.migrate()`) had no timeout at
 *         all — an unbounded `IndexedDBEngine`/`LocalStorageAdapter` call
 *         inside either one could keep that background bootstrap's
 *         in-flight Promise pending indefinitely (harmless to the UI
 *         today, since nothing currently awaits it, but exactly the kind
 *         of silent unbounded wait this phase's brief asks to close on
 *         principle — "no wait remains unbounded" — before any future
 *         caller starts awaiting it).
 *
 *   Rather than hand-writing two more bespoke one-off wrappers (the
 *   pattern RepositoryReadyTimeout.js's own header already warns against
 *   — "10 separate hand-written timeout implementations that could drift
 *   out of sync"), this file provides ONE generic primitive so both gaps
 *   above (and any future one) share a single, tested implementation.
 *
 * WHAT THIS DELIBERATELY DOES NOT DO
 *   - Does not modify, replace, or re-implement RepositoryReadyTimeout.js.
 *     That file, and the 10 entity modules that already call it, are
 *     completely untouched — they keep working exactly as before. This
 *     file is a *sibling* utility, not a successor.
 *   - Does not call anything's `.open()`, does not retry, does not poll
 *     (no `setInterval`) — exactly one `setTimeout` race per call, same
 *     convention as RepositoryReadyTimeout.js and
 *     RepositoryReadyCoordinator.js §10.
 *   - Does not change what the wrapped Promise resolves WITH on the happy
 *     path — `wrap(label, promise)` settles with whatever `promise`
 *     settles with, unchanged, as soon as `promise` settles.
 *   - By default, never rejects (mirrors RepositoryReadyTimeout.js's own
 *     "resolves even on timeout" contract) — this is what
 *     SettingsRepositoryWiring.js uses, so `settingsRepositoryReadyPromise`
 *     keeps its own pre-existing "always resolves" guarantee that
 *     index.html / settings.js / firstrun.js already depend on.
 *   - Only rejects on timeout when the caller explicitly opts in via
 *     `{ rejectOnTimeout: true }` — used by MigrationBootstrap.js, whose
 *     `execute()` already has its own catch-all `.then(null, fn)` handler
 *     that turns ANY rejection into a controlled `{success:false,
 *     reason:'migration-failed', ...}` report. Opting in there means a
 *     hung step is reported through that already-existing, already-tested
 *     path instead of this file inventing a new one.
 *
 * PUBLIC API
 *   StartupTimeoutManager.wrap(label, promise, [timeoutMs], [options])
 *     -> Promise, GUARANTEED to settle within timeoutMs.
 *     @param {string} label - diagnostic key, e.g. 'settings',
 *       'migrationBootstrap.getStatus'. Must be unique per call-site.
 *     @param {Promise} promise - the already-existing Promise to bound.
 *     @param {number} [timeoutMs] - defaults to DEFAULT_TIMEOUT_MS (12000,
 *       the same constant already used project-wide by
 *       RepositoryReadyTimeout.js and RepositoryReadyCoordinator.js §10).
 *     @param {Object} [options]
 *     @param {boolean} [options.rejectOnTimeout=false] - when true,
 *       settles by REJECTING with a descriptive Error (`.isStartupTimeout
 *       === true`) on timeout instead of resolving with `undefined`, AND
 *       passes through a genuine underlying rejection unchanged. When
 *       false (default), this Promise NEVER rejects: both a timeout and a
 *       genuine underlying rejection resolve with `undefined` (mirrors
 *       RepositoryReadyTimeout.js's own "resolves even on failure"
 *       contract, which every `<entityKey>RepositoryReadyPromise`
 *       consumer already relies on).
 *   StartupTimeoutManager.DEFAULT_TIMEOUT_MS
 *
 *   Diagnostics recorded on timeout (for DevTools inspection without
 *   needing to reproduce the failure live — same convention as
 *   RepositoryReadyTimeout.js's `window.__repositoryReadyTimeouts`):
 *     window.__startupTimeouts[label] = {
 *       label, elapsedMs, timeoutMs, rejectOnTimeout, timestamp
 *     }
 *   DOM event dispatched on timeout: 'startup:stepTimeout',
 *     detail = the same object as above.
 *
 * LOAD ORDER
 *   Must load BEFORE js/core/MigrationBootstrap.js AND BEFORE
 *   js/repositories/SettingsRepositoryWiring.js, since both call
 *   `StartupTimeoutManager.wrap(...)` at the moment they run (module-load
 *   time for the former's auto-run, script-parse time for the latter).
 *   In index.html this file is placed directly after
 *   js/core/StorageAdapter.js — before MigrationService.js,
 *   MigrationBootstrap.js, every js/repositories/*.js file, and
 *   RepositoryReadyTimeout.js. If this file is absent for any reason
 *   (e.g. an older page, or a standalone test harness loading a module
 *   directly), every call-site below falls back to the original,
 *   completely unwrapped Promise — see each call-site's own comment — so
 *   nothing breaks if this file is missing.
 * ==========================================================================*/
(function (root) {
  'use strict';

  // Same constant already used project-wide (RepositoryReadyTimeout.js,
  // RepositoryReadyCoordinator.js §10) for the "generous, first-IndexedDB
  // -open-safe" default. Kept identical rather than introducing a second,
  // slightly different number for the same class of wait.
  var DEFAULT_TIMEOUT_MS = 12000;

  /**
   * @param {string} label
   * @param {Promise} promise
   * @param {number} [timeoutMs]
   * @param {{rejectOnTimeout?: boolean}} [options]
   * @returns {Promise} always settles within timeoutMs.
   */
  function wrap(label, promise, timeoutMs, options) {
    if (!promise || typeof promise.then !== 'function') return promise;

    var limit = (typeof timeoutMs === 'number' && timeoutMs > 0) ? timeoutMs : DEFAULT_TIMEOUT_MS;
    var rejectOnTimeout = !!(options && options.rejectOnTimeout);
    var startedAt = (typeof Date !== 'undefined') ? Date.now() : 0;

    return new Promise(function (resolve, reject) {
      var settled = false;

      var timer = root.setTimeout(function () {
        if (settled) return;
        settled = true;

        var elapsed = ((typeof Date !== 'undefined') ? Date.now() : 0) - startedAt;
        var reason = {
          label: label,
          elapsedMs: elapsed,
          timeoutMs: limit,
          rejectOnTimeout: rejectOnTimeout,
          timestamp: (typeof Date !== 'undefined') ? new Date().toISOString() : null
        };

        root.__startupTimeouts = root.__startupTimeouts || {};
        root.__startupTimeouts[label] = reason;

        if (typeof console !== 'undefined' && console.error) {
          console.error(
            '[StartupTimeoutManager] "' + label + '" did not settle within ' +
            limit + 'ms. Proceeding without blocking further (see ' +
            'window.__startupTimeouts.' + label + ').'
          );
        }

        if (typeof document !== 'undefined' && document
          && typeof document.dispatchEvent === 'function'
          && typeof CustomEvent === 'function') {
          try { document.dispatchEvent(new CustomEvent('startup:stepTimeout', { detail: reason })); }
          catch (e) { /* best-effort only */ }
        }

        if (rejectOnTimeout) {
          var err = new Error(
            '[StartupTimeoutManager] "' + label + '" timed out after ' + limit + 'ms.'
          );
          err.isStartupTimeout = true;
          err.label = label;
          err.elapsedMs = elapsed;
          err.timeoutMs = limit;
          reject(err);
        } else {
          resolve();
        }
      }, limit);

      promise.then(function (value) {
        if (settled) return;
        settled = true;
        root.clearTimeout(timer);
        resolve(value);
      }, function (err) {
        if (settled) return;
        settled = true;
        root.clearTimeout(timer);
        // Mirrors RepositoryReadyTimeout.js's own defensive contract: in
        // the default (rejectOnTimeout:false) mode this Promise never
        // rejects at all, so an unexpected underlying rejection is
        // swallowed (resolved with no value) exactly like a timeout would
        // be. In rejectOnTimeout:true mode (MigrationBootstrap's steps),
        // the underlying rejection is passed through unchanged, so the
        // caller's own existing rejection-handling (its catch-all
        // `.then(null, fn)`) keeps working exactly as before this file
        // existed.
        if (rejectOnTimeout) {
          reject(err);
        } else {
          resolve();
        }
      });
    });
  }

  var api = {
    wrap: wrap,
    DEFAULT_TIMEOUT_MS: DEFAULT_TIMEOUT_MS
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  if (root) {
    root.StartupTimeoutManager = api;
  }

})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
