/* ============================================================================
 * PHASE 17.0 — STARTUP RELIABILITY — PER-ENTITY READY-PROMISE TIMEOUT
 * File: js/core/RepositoryReadyTimeout.js
 * ----------------------------------------------------------------------------
 * WHAT THIS IS
 *   A tiny, standalone, additive helper. It does exactly one thing: given
 *   an existing `<entityKey>RepositoryReadyPromise` (already built and
 *   already resolving-on-failure by each entity module — e.g.
 *   `casesRepositoryReadyPromise` in js/modules/cases.js), it returns a
 *   NEW Promise that is GUARANTEED to settle within `timeoutMs`, even if
 *   the underlying `<entity>Repository.open()` call never settles at all
 *   (the exact class of bug documented in
 *   docs/Boot_Optimization_Plan.md-era work and in this project's own
 *   Phase 17 diagnostics: a browser/WebView whose IndexedDB.open() never
 *   fires success or error).
 *
 * WHY A SEPARATE FILE INSTEAD OF EDITING EACH MODULE'S LOGIC
 *   The exact same 12-line pattern is duplicated, byte-for-byte except for
 *   entity names, across 10 files (cases.js, clients.js, sessions.js,
 *   tasks.js, documents.js, fees.js, library.js, templates.js, children.js,
 *   client-messages.js). Centralizing the timeout/logging logic here means
 *   each of those 10 files only needs one small, mechanical, identical
 *   wrapping edit (see this phase's report) instead of 10 separate
 *   hand-written timeout implementations that could drift out of sync.
 *
 * WHAT THIS DELIBERATELY DOES NOT DO
 *   - Does not call `.open()` again, does not retry, does not poll (no
 *     `setInterval`) — exactly one `setTimeout` race per call, same
 *     convention already used in js/core/RepositoryReadyCoordinator.js §10
 *     for the aggregate `window.bootReadyPromise`.
 *   - Does not change what the wrapped Promise resolves WITH on the happy
 *     path — `RepositoryReadyTimeout.wrap(key, p)` resolves with whatever
 *     `p` resolves with, unchanged, as soon as `p` settles.
 *   - Does not touch any Repository instance, any module's private
 *     `sync<Entity>Mirror()` call, or any existing `.catch()` logging —
 *     those keep running exactly as before; this only wraps the outer
 *     Promise boundary.
 *   - Never rejects. On timeout it resolves (mirroring every module's own
 *     existing "resolves even on failure" contract for these Promises —
 *     see e.g. cases.js's `casesRepositoryReadyPromise` comment "Surface
 *     the failure without throwing"), after logging the reason.
 *
 * PUBLIC API
 *   RepositoryReadyTimeout.wrap(entityKey, promise, [timeoutMs])
 *     -> Promise, always settles within timeoutMs (default 12000).
 *   RepositoryReadyTimeout.DEFAULT_TIMEOUT_MS
 *
 *   Diagnostics recorded on timeout (for DevTools inspection without
 *   needing to reproduce the failure live):
 *     window.__repositoryReadyTimeouts[entityKey] = {
 *       entityKey, elapsedMs, timeoutMs, timestamp
 *     }
 *   DOM event dispatched on timeout: 'repository:entityTimeout',
 *     detail = the same object as above.
 *
 * LOAD ORDER
 *   Must load AFTER js/core/StorageAdapter.js (no hard dependency, but
 *   grouped with the other small js/core/*.js utilities by convention) and
 *   BEFORE every entity module (cases.js, clients.js, ...), since each of
 *   those modules calls `RepositoryReadyTimeout.wrap(...)` at top-level
 *   parse time when constructing its own `<entityKey>RepositoryReadyPromise`.
 *   If this file is absent (e.g. an older page or a standalone test
 *   harness that loads a module directly), every call-site below falls
 *   back to the original, completely unwrapped Promise — see each module's
 *   own PHASE 17.0 comment — so nothing breaks if this file is missing.
 * ==========================================================================*/
(function (root) {
  'use strict';

  var DEFAULT_TIMEOUT_MS = 12000; // 12s — same constant used by
                                   // RepositoryReadyCoordinator.js §10 for
                                   // the aggregate boot promise.

  /**
   * @param {string} entityKey - e.g. 'cases', 'clients', 'clientMessages'.
   * @param {Promise} promise - the module's own already-existing ready
   *   Promise (e.g. casesRepository.open().then(...).catch(...)).
   * @param {number} [timeoutMs] - defaults to DEFAULT_TIMEOUT_MS.
   * @returns {Promise<void>} settles within timeoutMs no matter what.
   */
  function wrap(entityKey, promise, timeoutMs) {
    if (!promise || typeof promise.then !== 'function') return promise;
    var limit = (typeof timeoutMs === 'number' && timeoutMs > 0) ? timeoutMs : DEFAULT_TIMEOUT_MS;
    var startedAt = (typeof Date !== 'undefined') ? Date.now() : 0;

    return new Promise(function (resolve) {
      var settled = false;

      var timer = root.setTimeout(function () {
        if (settled) return;
        settled = true;

        var elapsed = ((typeof Date !== 'undefined') ? Date.now() : 0) - startedAt;
        var reason = {
          entityKey: entityKey,
          elapsedMs: elapsed,
          timeoutMs: limit,
          timestamp: (typeof Date !== 'undefined') ? new Date().toISOString() : null
        };

        root.__repositoryReadyTimeouts = root.__repositoryReadyTimeouts || {};
        root.__repositoryReadyTimeouts[entityKey] = reason;

        if (typeof console !== 'undefined' && console.error) {
          console.error(
            '[RepositoryReadyTimeout] "' + entityKey + '" Repository did not ' +
            'become ready within ' + limit + 'ms. Proceeding without blocking ' +
            'further (isReady() may still report false — see ' +
            'window.__repositoryReadyTimeouts.' + entityKey + ').'
          );
        }

        if (typeof document !== 'undefined' && document
          && typeof document.dispatchEvent === 'function'
          && typeof CustomEvent === 'function') {
          try { document.dispatchEvent(new CustomEvent('repository:entityTimeout', { detail: reason })); }
          catch (e) { /* best-effort only */ }
        }

        resolve();
      }, limit);

      promise.then(function (value) {
        if (settled) return;
        settled = true;
        root.clearTimeout(timer);
        resolve(value);
      }, function () {
        // Each module's own Promise already swallows open() failures and
        // resolves regardless (its own "Surface the failure without
        // throwing" comment) — this rejection branch is defensive only,
        // for a future module that might propagate a rejection instead.
        if (settled) return;
        settled = true;
        root.clearTimeout(timer);
        resolve();
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
    root.RepositoryReadyTimeout = api;
  }

})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
