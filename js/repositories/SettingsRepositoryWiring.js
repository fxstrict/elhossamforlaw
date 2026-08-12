/**
 * ================================================================
 * SettingsRepositoryWiring.js — js/repositories/SettingsRepositoryWiring.js
 * ================================================================
 * PHASE 13.4 — PART 2A — SettingsRepository Wiring Only
 *
 * WHAT THIS FILE IS
 *   Creates the single global SettingsRepository instance and its
 *   ready-promise, exposed with exactly the same
 *   `<entityKey>Repository` / `<entityKey>RepositoryReadyPromise`
 *   naming convention already used by every existing entity module
 *   (e.g. js/modules/library.js -> `libraryRepository` /
 *   `libraryRepositoryReadyPromise`; js/modules/cases.js ->
 *   `casesRepository` / `casesRepositoryReadyPromise`).
 *
 * WHY A SEPARATE FILE
 *   Every existing repository is instantiated inside its own entity
 *   module (cases.js, library.js, etc.). SettingsRepository has no
 *   such module yet — js/modules/settings.js is explicitly out of
 *   scope for this phase (integration is deferred to Part 2) — so
 *   this file exists solely to perform the wiring step on its own,
 *   reusing the exact same pattern, without touching settings.js.
 *
 * WHAT THIS FILE IS NOT
 *   - It does NOT modify js/repositories/SettingsRepository.js.
 *   - It does NOT modify js/modules/settings.js.
 *   - It does NOT modify js/modules/firstrun.js.
 *   - It does NOT implement or modify the LocalStorage -> IndexedDB
 *     migration logic itself (migrateFromLocalStorage() in
 *     SettingsRepository.js, Part 4, is used exactly as-is). This file
 *     only invokes that existing method once, after open() succeeds
 *     (Part 9 — see settingsRepositoryReadyPromise below).
 *   - It does NOT register anything with RepositoryReadyCoordinator.js
 *     (that wiring is Part 5, per REFERENCE_MAP.md "Coordinator
 *     References").
 *   - It does NOT read or write any application data, settings value,
 *     or DOM element — it only opens the repository.
 *
 * LOAD ORDER REQUIREMENT
 *   Must be loaded AFTER js/repositories/SettingsRepository.js, in the
 *   same script grouping already used for the other repositories in
 *   index.html.
 * ================================================================
 */

var SettingsRepositoryNS = (typeof module !== 'undefined' && module.exports)
  ? require('./SettingsRepository.js')
  : (typeof window !== 'undefined' ? window : this);

var SettingsRepository = SettingsRepositoryNS && SettingsRepositoryNS.SettingsRepository;

if (typeof SettingsRepository !== 'function') {
  throw new Error(
    'SettingsRepositoryWiring.js requires js/repositories/SettingsRepository.js ' +
    'to be loaded first (SettingsRepository class not found).'
  );
}

/**
 * The single SettingsRepository instance this wiring exposes. Default
 * construction (no config) wires it to the real DatabaseService +
 * IndexedDBAdapter pair — the exact same "settings" IndexedDB object
 * store (keyPath "id") SettingsRepository.js's own header documents —
 * identically to how every other entity module constructs its
 * repository with `new <Entity>Repository()`.
 */
var settingsRepository = new SettingsRepository();

/**
 * Resolves once SettingsRepository.open() has completed — repository
 * readiness only — following the exact same
 * `<entityKey>RepositoryReadyPromise` convention every other entity
 * module exposes (casesRepositoryReadyPromise, libraryRepositoryReadyPromise,
 * etc.). Unlike the existing entity modules, there is no legacy mirror
 * (`data.settings`) to refresh once open() resolves — settings.js
 * integration is explicitly deferred to Part 2 — so this promise
 * resolves with no side effect beyond opening the repository.
 *
 * PHASE 13.4 — PART 10 — STARTUP TIMING REGRESSION FIX
 * Part 9 chained migrateFromLocalStorage() onto this same promise,
 * which delayed every consumer awaiting `settingsRepositoryReadyPromise`
 * (including index.html's Part 8 apiUrl/driveUrl/sheetUrl reconciliation)
 * until migration had also finished, reintroducing the startup timing
 * regression Part 8 fixed. Migration is now kicked off separately, right
 * after open() succeeds, without being chained into the promise
 * consumers await — restoring Part 8's original timing while still
 * running migration automatically, exactly once, copy-only, and
 * idempotently (migrateFromLocalStorage() itself, Part 4, is
 * unmodified).
 */
var settingsRepositoryOpenPromise = settingsRepository.open();

var settingsRepositoryReadyPromise = settingsRepositoryOpenPromise
  .catch(function (err) {
    // Surface the failure without throwing out of a top-level Promise
    // chain (would otherwise be an unhandled rejection), exactly as the
    // existing entity modules already do for their own open() calls.
    if (typeof console !== 'undefined' && console.error) {
      console.error('SettingsRepository failed to open:', err);
    }
  });

// PHASE 17.5 — STARTUP TIMEOUT MANAGER
// `settingsRepositoryReadyPromise` was, before this phase, the ONLY
// `<entityKey>RepositoryReadyPromise` in the codebase never bounded by a
// timeout — every one of the other 10 entity modules (cases.js,
// clients.js, sessions.js, tasks.js, documents.js, fees.js, library.js,
// templates.js, children.js, client-messages.js) already wraps its own
// ready promise with `RepositoryReadyTimeout.wrap(...)` so an
// `IndexedDBEngine` open() that never settles can never hang that
// module's consumers forever (see js/core/RepositoryReadyTimeout.js).
// `window.bootReadyPromise` was already safe either way — it joins this
// promise inside a Promise.all bounded by RepositoryReadyCoordinator.js
// §10's own 12s timeout — but the three call-sites that await
// `settingsRepositoryReadyPromise` DIRECTLY (index.html's Part 8
// apiUrl/driveUrl/sheetUrl reconciliation, js/modules/settings.js,
// js/modules/firstrun.js) had no bound of their own until now.
//
// Purely additive: if js/core/StartupTimeoutManager.js is absent (older
// page / isolated test harness), this falls back to the original,
// completely unwrapped promise — identical to how every entity module's
// own `typeof RepositoryReadyTimeout !== 'undefined' ? ... : ...` guard
// already behaves. `rejectOnTimeout` is intentionally left at its default
// (false), so this promise keeps its pre-existing "always resolves, never
// rejects" contract that all three consumers above already depend on.
if (typeof StartupTimeoutManager !== 'undefined') {
  settingsRepositoryReadyPromise = StartupTimeoutManager.wrap(
    'settings',
    settingsRepositoryReadyPromise
  );
}

// PHASE 13.4 — PART 10: migration runs once open() succeeds, attached to
// the original open() promise (not the failure-tolerant
// settingsRepositoryReadyPromise above), so it only ever runs after a
// real successful open — never after a failed one — and, critically, in
// parallel with (not gating) settingsRepositoryReadyPromise, so no
// consumer waiting on repository readiness is delayed by migration.
settingsRepositoryOpenPromise.then(function () {
  return settingsRepository.migrateFromLocalStorage().catch(function (err) {
    if (typeof console !== 'undefined' && console.warn) {
      console.warn('SettingsRepository migration failed:', err);
    }
  });
}, function () {
  // open() itself failed — already logged above; migration cannot run
  // against an unopened repository, so intentionally do nothing here.
});

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    settingsRepository: settingsRepository,
    settingsRepositoryReadyPromise: settingsRepositoryReadyPromise
  };
}
