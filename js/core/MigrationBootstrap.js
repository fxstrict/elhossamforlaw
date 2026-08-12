/**
 * ================================================================
 * MigrationBootstrap.js — Silent Background Migration Bootstrap | نظام الحسام للمحاماة
 * ================================================================
 * PHASE 13.3C — PART 3C — Migration Bootstrap (REDESIGN — no page reload)
 *
 * Source of design (no assumption outside these):
 *   - js/core/MigrationService.js (PHASE 13.3C / PART 3B) — the already
 *     built, already verified (25/25 checks) migration engine this file
 *     drives. `MigrationService.getStatus()` / `.migrate()` are used
 *     exactly as documented there; this file does not reimplement, wrap
 *     with retries, or change any of MigrationService's own checkpoint /
 *     idempotency / resumability guarantees. Read in full; NOT modified.
 *   - js/core/LocalStorageAdapter.js — constructed here, unconfigured
 *     (default empty `keyPrefix`), as the migration SOURCE — the exact
 *     same real `localStorage` keys ('cases', 'clients', ...) index.html's
 *     `data.*` bootstrap already reads today. Read in full; NOT modified.
 *   - js/core/IndexedDBAdapter.js — constructed here, unconfigured
 *     (`new IndexedDBAdapter({})`), as the migration TARGET — deliberately
 *     built with the exact same no-argument shape every *Repository.js
 *     factory already builds in production (see e.g.
 *     `CasesRepository.js`'s `createCasesLocalStorageAdapter()`), so this
 *     file's target is the SAME physical IndexedDB database every
 *     Repository already reads/writes through DatabaseService. Read in
 *     full; NOT modified.
 *
 * ----------------------------------------------------------------
 * WHY PART 3C WAS REDESIGNED (abandoned prior attempt)
 * ----------------------------------------------------------------
 *   The first PART 3C attempt wired an automatic full-page reload after
 *   a successful migration, on the theory that a reload would let
 *   already-initialized Repositories "see" freshly migrated IndexedDB
 *   data. That design was abandoned before being wired into index.html or
 *   committed anywhere, because an automatic reload is unsafe in this
 *   application: index.html has no in-page draft/unsaved-changes concept
 *   guarding a reload — a user who has typed into any open add/edit modal
 *   (cases, sessions, clients, tasks, documents, fees, children, library,
 *   templates — see the `FIELDS`/`MAP` tables in index.html) would lose
 *   that input outright, with no warning, the instant a background
 *   migration happened to finish. A silent data-loss trigger firing at an
 *   unpredictable moment during normal use is strictly worse than the
 *   problem migration exists to solve. This file replaces that design
 *   entirely: no automatic full-page reload call appears anywhere below, and none
 *   is planned.
 *
 * WHAT THIS FILE IS
 *   A silent, best-effort, fire-and-forget background bootstrap that:
 *     1. Constructs the same source (LocalStorageAdapter) / target
 *        (IndexedDBAdapter) pair Repositories already use.
 *     2. Asks MigrationService for the current checkpoint status
 *        (`getStatus()`, read-only).
 *     3. If already `'completed'`, does nothing further — resolves
 *        immediately, per the "startup must immediately continue"
 *        requirement, without a redundant `migrate()` call.
 *     4. Otherwise calls `MigrationService.migrate()` exactly once
 *        (no `force`, so a prior interrupted run resumes correctly and a
 *        prior completed run is never touched) and lets it run fully in
 *        the background.
 *     5. NEVER reloads the page, NEVER shows a browser dialog
 *        (alert/confirm/prompt), NEVER throws synchronously, and NEVER
 *        rejects its returned Promise — every failure path (missing
 *        dependency, adapter construction failure, migration failure) is
 *        caught and turned into a `{success:false, ...}` report instead,
 *        so nothing that loads or calls this file can be broken by it.
 *
 * WHAT THIS FILE IS NOT
 *   - It is NOT a UI layer. It never touches the DOM, never calls
 *     `toast()`/`showLoading()`, never touches the `data.*` global object
 *     index.html's inline script owns, and never refreshes any rendered
 *     page. Repositories already read/write IndexedDB directly today (see
 *     WIRING note below); making the already-rendered `data.*` mirror
 *     reflect newly migrated records is a separate, later concern — not
 *     introduced here, and not silently attempted here either.
 *   - It does NOT modify MigrationService.js, LocalStorageAdapter.js,
 *     IndexedDBAdapter.js, DatabaseService.js, Repository.js, or any
 *     Repository/Module file.
 *   - It does NOT add retry/backoff logic, does NOT run on a timer, and
 *     does NOT re-run once per navigation — see "Idempotent bootstrap"
 *     below for the exact single-run guarantee this file itself adds on
 *     top of MigrationService's own idempotency.
 *
 * ----------------------------------------------------------------
 * WIRING NOTE — an existing fact this file relies on, not one it creates
 * ----------------------------------------------------------------
 *   Direct inspection of every `js/repositories/*Repository.js` factory
 *   (e.g. `CasesRepository.js`'s `createCasesLocalStorageAdapter()`) shows
 *   each one already builds `new IndexedDBAdapter(...)` → `new
 *   DatabaseService(adapter)` as its real Storage Adapter — despite the
 *   `LocalStorage`-named factory function and file-header wording (stale
 *   from an earlier phase; not touched here, out of this phase's allowed
 *   file list). In other words: every Repository already reads and writes
 *   IndexedDB today, unconditionally, regardless of whether this
 *   bootstrap has run, is running, or has failed. This is exactly what
 *   makes "if migration fails, application must continue safely using the
 *   current storage" true by construction — "current storage" for every
 *   Repository IS IndexedDB already, migration success or not. What this
 *   bootstrap exists to fix is a DIFFERENT, narrower problem: real user
 *   data that was written under the OLD architecture (when Repositories
 *   still used `LocalStorageAdapter`) and is still sitting in raw
 *   `localStorage`, invisible to any Repository until it is copied over.
 *
 * ----------------------------------------------------------------
 * NO DATA LOSS — the one residual race this design documents rather than
 * silently hides (mirrors this codebase's own convention of documenting,
 * not absorbing, out-of-scope findings — see MigrationService.js §4)
 * ----------------------------------------------------------------
 *   `MigrationService.migrate()` is, by its own documented design, a
 *   plain whole-array `write()` (replace, not merge) for every entity key
 *   the source actually has. If a real user create/update/delete already
 *   landed in IndexedDB (via a Repository) for some entity BEFORE this
 *   bootstrap's `migrate()` call reaches that same entity, and stale
 *   localStorage data also exists for that entity, migrate()'s replace
 *   would overwrite the newer IndexedDB record set with the older
 *   localStorage one — a genuine data-loss race, but one that already
 *   exists inside MigrationService.js itself (a protected, unmodifiable
 *   file for this phase), not something introduced by this bootstrap.
 *   This file minimizes that window the only way available to it without
 *   touching MigrationService.js: its `<script>` tag (see index.html) is
 *   placed immediately after `IndexedDBAdapter.js` and BEFORE every
 *   `*Repository.js` file, so `run()` fires — and typically each small
 *   entity finishes migrating — before a single Repository instance even
 *   exists on the page, let alone before any user-initiated write is
 *   possible. It cannot be reduced to zero without changing
 *   MigrationService.js, which is out of this phase's scope; this is
 *   flagged here for whichever future phase next touches that file.
 *
 * Idempotent bootstrap:
 *   Independent of (and in addition to) MigrationService's own
 *   checkpoint-driven idempotency, this file guarantees `run()` itself
 *   only ever starts one migration attempt per page load: the first call
 *   caches its in-flight Promise; every subsequent call (whether from the
 *   auto-run below, a duplicate `<script>` inclusion, or a manual
 *   `MigrationBootstrap.run()` call from the console) returns that exact
 *   same Promise instead of invoking `MigrationService` a second time.
 *
 * Load order: must load after `js/core/LocalStorageAdapter.js`,
 * `js/core/IndexedDBAdapter.js`, and `js/core/MigrationService.js`
 * (transitively requires `IndexedDBSchema.js`, already MigrationService's
 * own dependency). In the browser, this file auto-runs its migration
 * check once, at script-parse time, as soon as those dependencies are
 * available — it does not wait for `DOMContentLoaded`. When loaded via
 * `require()` in Node (test harnesses), auto-run is skipped; the harness
 * calls `MigrationBootstrap.run(config)` explicitly with injected fakes.
 * ================================================================
 */

(function (root) {
  'use strict';

  /** @private Node/browser dual-mode dependency lookup, matching every
   *  other core file's own `requireNS` helper (MigrationService.js,
   *  IndexedDBAdapter.js, ...). Returns `null` instead of throwing when a
   *  dependency is missing — this file must never let a missing/late
   *  script break page load; a missing dependency is treated the same as
   *  any other startup failure (see `run()`'s try/catch below). */
  function optionalRequireNS(name) {
    try {
      if (typeof module !== 'undefined' && module.exports) {
        return require('./' + name + '.js');
      }
      return root && root[name] ? root : null;
    } catch (e) {
      return null;
    }
  }

  var _inFlightPromise = null;

  // PHASE 17.5 — STARTUP TIMEOUT MANAGER: bound for each of this file's
  // two internal steps (getStatus(), migrate()). See _boundStep()/
  // execute() below for full rationale on why this is more generous than
  // the 12s used elsewhere for entity-ready promises.
  var MIGRATION_STEP_TIMEOUT_MS = 20000;

  /**
   * @private Builds the default source/target adapter pair and the
   * MigrationService instance driving them. Deliberately mirrors, byte
   * for byte, the no-argument shape every *Repository.js factory already
   * builds in production (`new IndexedDBAdapter(storageImpl ? {...} :
   * {})` with no `storageImpl`), so this file's target is the exact same
   * physical database every Repository already uses.
   *
   * @param {Object} [config]
   * @param {Object} [config.sourceAdapter] - injected LocalStorageAdapter-
   *   shaped override (tests only). Defaults to `new LocalStorageAdapter()`.
   * @param {Object} [config.targetAdapter] - injected IndexedDBAdapter-
   *   shaped override (tests only). Defaults to `new IndexedDBAdapter({})`.
   * @param {Object} [config.MigrationServiceClass] - injected
   *   MigrationService class override (tests only).
   * @returns {Object} {service: MigrationService}
   * @throws whatever adapter/service construction throws — caller
   *   (`run()`) always wraps this in try/catch.
   */
  function buildService(config) {
    config = config || {};

    var LocalStorageAdapterNS = optionalRequireNS('LocalStorageAdapter');
    var IndexedDBAdapterNS = optionalRequireNS('IndexedDBAdapter');
    var MigrationServiceNS = optionalRequireNS('MigrationService');

    var LocalStorageAdapter = config.sourceAdapter
      ? null
      : (LocalStorageAdapterNS && LocalStorageAdapterNS.LocalStorageAdapter);
    var IndexedDBAdapter = config.targetAdapter
      ? null
      : (IndexedDBAdapterNS && IndexedDBAdapterNS.IndexedDBAdapter);
    var MigrationService = config.MigrationServiceClass ||
      (MigrationServiceNS && MigrationServiceNS.MigrationService);

    if (!MigrationService) {
      throw new Error(
        'MigrationBootstrap requires js/core/MigrationService.js to be loaded first.'
      );
    }
    if (!config.sourceAdapter && !LocalStorageAdapter) {
      throw new Error(
        'MigrationBootstrap requires js/core/LocalStorageAdapter.js to be loaded first.'
      );
    }
    if (!config.targetAdapter && !IndexedDBAdapter) {
      throw new Error(
        'MigrationBootstrap requires js/core/IndexedDBAdapter.js to be loaded first.'
      );
    }

    var sourceAdapter = config.sourceAdapter || new LocalStorageAdapter();
    var targetAdapter = config.targetAdapter || new IndexedDBAdapter({});

    var service = new MigrationService({
      sourceAdapter: sourceAdapter,
      targetAdapter: targetAdapter
    });

    return { service: service };
  }

  /**
   * @private Actually performs the status-check-then-maybe-migrate
   * sequence. Never called directly by outside code — always wrapped by
   * `run()`'s single-flight cache + try/catch below.
   * @returns {Promise<Object>} a report — see `run()`'s doc comment for
   *   the exact shape. Never rejects.
   */
  function execute(config) {
    var startedAt = Date.now();
    var built;
    try {
      built = buildService(config);
    } catch (e) {
      return Promise.resolve({
        ran: false,
        skipped: false,
        success: false,
        reason: 'dependencies-unavailable',
        error: { message: e && e.message ? e.message : String(e) },
        startedAt: startedAt,
        finishedAt: Date.now()
      });
    }

    var service = built.service;

    // PHASE 17.5 — STARTUP TIMEOUT MANAGER
    // Neither step below (`getStatus()`, `migrate()`) previously had any
    // bound at all — an unbounded `IndexedDBEngine`/`LocalStorageAdapter`
    // call inside either one could keep this file's own in-flight Promise
    // pending forever. Harmless to the UI today (nothing currently awaits
    // `MigrationBootstrap.run()`'s result — see file header, "fire-and-
    // forget"), but exactly the unbounded wait this phase's brief asks to
    // close on principle, before any future caller starts awaiting it.
    // `rejectOnTimeout: true` is used deliberately here (unlike
    // SettingsRepositoryWiring.js's default `false`): a timed-out step
    // now flows through the exact same, already-existing, already-tested
    // `.then(null, function (err) {...})` catch-all a few lines below,
    // which already turns ANY rejection (a real `getStatus()`/`migrate()`
    // failure, or now a timeout) into the same `{success:false,
    // reason:'migration-failed', error:{message,...}}` report shape — no
    // new report shape, no new branch, nothing else about this function
    // changes. `MIGRATION_STEP_TIMEOUT_MS` is more generous than the 12s
    // used for entity-ready promises (js/core/RepositoryReadyTimeout.js)
    // because this background migration is not on the critical UI path
    // and may need to copy a real, larger dataset — see this phase's
    // report for the full rationale.
    function _boundStep(label, promise) {
      return (typeof StartupTimeoutManager !== 'undefined')
        ? StartupTimeoutManager.wrap(label, promise, MIGRATION_STEP_TIMEOUT_MS, { rejectOnTimeout: true })
        : promise;
    }

    return _boundStep('migrationBootstrap.getStatus', service.getStatus())
      .then(function (status) {
        if (status && status.status === 'completed') {
          return {
            ran: false,
            skipped: true,
            success: true,
            reason: 'already-completed',
            migrationReport: null,
            startedAt: startedAt,
            finishedAt: Date.now()
          };
        }

        return _boundStep('migrationBootstrap.migrate', service.migrate()).then(function (migrationReport) {
          return {
            ran: true,
            skipped: !!migrationReport.skipped,
            success: true,
            reason: migrationReport.skipped ? migrationReport.reason : 'migrated',
            migrationReport: migrationReport,
            startedAt: startedAt,
            finishedAt: Date.now()
          };
        });
      })
      .then(null, function (err) {
        // Migration failed (or getStatus() itself failed). Never thrown,
        // never surfaced as a rejection — the application must continue
        // safely using its current storage (see file header). Every
        // Repository already reads/writes IndexedDB directly, independent
        // of this outcome, so a failed/partial migration never blocks
        // normal use; the next page load's run() will resume from
        // whatever checkpoint MigrationService already persisted (its own
        // interrupted-run handling — see MigrationService.js §2.3).
        return {
          ran: true,
          skipped: false,
          success: false,
          reason: 'migration-failed',
          error: {
            message: err && err.message ? err.message : String(err),
            entityKey: (err && err.entityKey) || null,
            stage: (err && err.stage) || null
          },
          migrationReport: null,
          startedAt: startedAt,
          finishedAt: Date.now()
        };
      });
  }

  /**
   * MigrationBootstrap.run(config) -> Promise<Object>
   *
   * Silently, in the background, ensures every real entity's data has
   * been copied from localStorage into IndexedDB — with NO page reload,
   * NO browser dialog, NO interruption of whatever the user is doing, and
   * NO risk of losing in-progress/unsaved UI state, since this function
   * never touches the DOM or the `data.*` global.
   *
   * Idempotent at TWO independent levels:
   *   (1) This function itself: the first call's Promise is cached and
   *       returned to every subsequent call within the same page load —
   *       a second call never starts a second migration attempt.
   *   (2) MigrationService's own checkpoint: even a fresh `execute()`
   *       call (e.g. in a fresh test process) that finds a `'completed'`
   *       checkpoint does nothing further; a `'not-started'` or
   *       `'interrupted'` checkpoint resumes correctly and can never
   *       duplicate an already-migrated entity (see MigrationService.js
   *       §2.3).
   *
   * This Promise NEVER rejects. Every failure — a missing dependency
   * script, an adapter construction error, a `getStatus()` failure, or a
   * `migrate()` failure partway through — resolves with
   * `{success:false, ...}` instead, so nothing awaiting or ignoring this
   * call's result can ever be broken by it.
   *
   * @param {Object} [config] - test-only adapter/service injection, see
   *   `buildService()`'s doc comment. Production callers pass nothing.
   * @returns {Promise<Object>} report:
   *   {
   *     ran: boolean,           // true iff migrate() was actually invoked
   *     skipped: boolean,       // true iff nothing needed to be written
   *     success: boolean,       // false iff any step failed
   *     reason: string,         // 'already-completed' | 'migrated' |
   *                             // 'dependencies-unavailable' |
   *                             // 'migration-failed' | (a MigrationService
   *                             // skip reason)
   *     migrationReport: Object|null, // MigrationService.migrate()'s own
   *                                   // report, verbatim, when it ran
   *     error: Object|undefined,      // present only when success:false
   *     startedAt: number,
   *     finishedAt: number
   *   }
   */
  function run(config) {
    if (_inFlightPromise) {
      return _inFlightPromise;
    }
    _inFlightPromise = execute(config);
    return _inFlightPromise;
  }

  /**
   * MigrationBootstrap.reset() — test-only helper that clears the
   * single-flight cache so a fresh `run()` call is not short-circuited by
   * a previous test's in-flight/settled Promise. Not used anywhere in
   * production; index.html never calls this.
   */
  function reset() {
    _inFlightPromise = null;
  }

  // ================================================================
  // Exports
  // ================================================================

  var api = {
    run: run,
    reset: reset
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  if (root) {
    root.MigrationBootstrap = api;
  }

  // ----------------------------------------------------------------
  // Browser auto-run: fires as soon as this script parses (does NOT wait
  // for DOMContentLoaded), so it starts — and, for the typical small
  // per-user dataset sizes this application handles (see
  // Large_Data_Performance_Audit.md), usually finishes — before any
  // Repository script below it on the page has even been parsed, let
  // alone constructed or written to. Entirely silent: no console output
  // on the success path, matching "migration must happen transparently".
  // Skipped in Node (require()'d by the test harness), which calls
  // run()/reset() explicitly with injected fakes instead.
  // ----------------------------------------------------------------
  if (typeof window !== 'undefined' && typeof document !== 'undefined') {
    run().then(function (report) {
      if (!report.success) {
        // Non-fatal by design (see file header "NO DATA LOSS" /
        // "application must continue safely"). Logged at warn level only
        // — never an alert/confirm/prompt, never thrown, never blocks
        // anything already running on the page.
        if (root.console && typeof root.console.warn === 'function') {
          root.console.warn('MigrationBootstrap: background migration did not complete.', report);
        }
      }
    });
  }

})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
