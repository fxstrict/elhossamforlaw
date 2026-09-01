/**
 * ================================================================
 * SyncEngine.js — PHASE A7 (STEP 3/4): Frontend Incremental Sync
 * Receive → Validate → Apply → Commit Checkpoint orchestration
 * نظام الحسام للمحاماة
 * ================================================================
 * WHY THIS FILE / WHERE THE INTEGRATION POINT CAME FROM
 *   PHASE_A7_IMPLEMENTATION_REPORT.md §13 left "Frontend Apply" wiring
 *   unwritten because no centralized loader was found by an earlier
 *   grep of `ApiService.loadData`. A fuller forensic pass (this
 *   session) found the REAL, live, already-working central loader:
 *   `loadFromSheets()` in js/modules/settings.js. It already does, for
 *   exactly 12 of the 15 sheets (the same 12 SHEET_DEFS the A7 backend
 *   put in sync scope minus قضية_موكلين/المصروفات, which have no pull
 *   path at all today — a pre-existing gap, NOT introduced or widened
 *   here, and out of scope per §10/"لا تخترع integration points"):
 *     fetch(sheet) → _persistEntityViaRepository(key,'import',arr,'merge')
 *   `_persistEntityViaRepository()` already resolves each entity's
 *   Repository the same way for every one of these 12 keys:
 *     window[key + 'Repository']            (the Repository instance)
 *     window[key + 'RepositoryReadyPromise'] (resolves once IndexedDB is open)
 *   index.html's own `readyPromiseNames` array (DOMContentLoaded
 *   listener, PHASE 13.8) independently lists the exact same 12 names —
 *   confirmed, not assumed, by direct inspection of both files. This
 *   is the single centralized, already-proven-safe seam this session's
 *   §3 STEP asked for. No new abstraction was invented; this file only
 *   adds a second caller of that exact same seam, for incremental
 *   (cursor-based) data instead of a full re-read.
 *
 * WHAT THIS FILE DOES
 *   For each of the 12 sheets above:
 *     1. Receive  — SyncCheckpoint.get(sheetName), then ApiService.syncSheet(sheetName, cursor)
 *     2. Validate — response must be an object with an `items` array;
 *                   anything else (network failure, malformed body,
 *                   thrown error) is treated as a failed page: the loop
 *                   stops for THAT sheet only, and no checkpoint is
 *                   written for the failed page (old cursor stays valid).
 *     3. Apply    — TOMBSTONE TRANSLATION (§ of the request): each item's
 *                   server field `محذوف_في` is translated into the
 *                   Repository's own `deletedAt` concept
 *                   (non-empty `محذوف_في` -> deletedAt = that value;
 *                   empty/missing -> deletedAt = null). The key is
 *                   always explicitly set (even to null) — Repository.js's
 *                   own existing import('merge') contract (see its
 *                   `oldWasDeleted && !('deletedAt' in record)` check)
 *                   treats an explicit `deletedAt` key as an authoritative
 *                   status flip, which is exactly what an A7 sync item
 *                   is (unlike a normal loadFromSheets() row, which
 *                   never carries the key at all and therefore can
 *                   never resurrect a local tombstone by accident).
 *                   Applied via the SAME existing, tested primitive
 *                   loadFromSheets() already uses: repo.import(items,'merge').
 *     4. Commit   — ONLY if step 3's import() returned {success:true},
 *                   SyncCheckpoint.save(sheetName, response.nextCursor).
 *                   If Apply failed, the OLD cursor is left untouched —
 *                   Checkpoint Safety, exactly as specified: Receive →
 *                   Validate → Apply-entire-batch-successfully → Commit.
 *   Multiple pages: while response.hasMore is true AND the page applied
 *   successfully, the loop immediately fetches the next page with the
 *   just-committed cursor. If any page fails to apply, the loop for
 *   that sheet stops at the last successfully committed cursor — safe
 *   to resume later (re-pulling the same failed page is idempotent:
 *   import('merge') re-applying already-applied items is a no-op change
 *   to already-identical records).
 *   Initial Sync (no stored checkpoint) is NOT a separate code path —
 *   SyncCheckpoint.get() returning null simply means ApiService.syncSheet
 *   is called with cursor=null, which Config/06_Api.gs's apiSyncSheet()
 *   already defines as "return everything, tombstones included" (its
 *   own doc comment, Config/06_Api.gs). This satisfies the request's
 *   "Full Read → Apply → Determine cursor → Store checkpoint" shape
 *   without a second implementation: the "full read" IS page 1 of the
 *   normal incremental loop, and nextCursor already encodes the highest
 *   (updatedAt, id) reached, exactly as specified.
 *
 * WHAT THIS FILE DELIBERATELY DOES NOT DO
 *   - Does NOT replace or modify loadFromSheets() itself (§ "لا تكسر
 *     القراءة الكاملة الحالية" — do not break the current full read).
 *     Both mechanisms run; loadFromSheets() remains the app's existing,
 *     unchanged full-refresh path (manual "تحديث" button, periodic
 *     calls, etc.) and this file adds a second, additive, cursor-based
 *     pull run once at boot (see bootIncrementalSync(), wired from
 *     settings.js's bootLoadFromSheets() — see that file's own small,
 *     documented addition — to run strictly AFTER loadFromSheets()
 *     resolves, never concurrently with it, to avoid two competing
 *     repo.import('merge') calls on the same Repository racing each
 *     other).
 *   - Does NOT touch Repository.js, StorageAdapter.js, or any of the
 *     12 js/repositories/*.js files.
 *   - Does NOT invent a 13th/14th/15th integration point for
 *     قضية_موكلين or المصروفات — those have no existing pull path in
 *     loadFromSheets() today, and adding one would be a new,
 *     unreviewed integration point, forbidden by §10 of the request.
 *   - Does NOT add authentication (pre-existing, unrelated blocker,
 *     unchanged by this session).
 * ================================================================
 */

const SyncEngine = (function () {
  'use strict';

  // Mirrors settings.js's loadFromSheets() pairs list EXACTLY for the
  // 12 sheets that already have a confirmed, live, working Repository +
  // ready-promise + pull path (see file header). This list is
  // intentionally duplicated rather than imported from settings.js
  // (which exposes no such constant today) — extracting a shared
  // constant would mean editing settings.js's existing pairs array
  // declaration, a larger change than this session's scope calls for.
  // If the two lists ever diverge, the tests in
  // tests/PHASE_A7_frontend_sync_tests.js catch it (they assert this
  // list is a subset of settings.js's own literal pairs array).
  const SYNC_ENTITY_PAIRS = [
    ['القضايا', 'cases'],
    ['الجلسات', 'sessions'],
    ['الموكلين', 'clients'],
    ['الأطفال', 'children'],
    ['المستندات', 'documents'],
    ['الأعمال الإدارية', 'tasks'],
    ['الأتعاب', 'fees'],
    ['رسائل_الموكل', 'clientMessages'],
    ['الصيغ', 'templates'],
    ['المكتبة', 'library'],
    ['الخصوم', 'opponents'],
    ['أعمال_المحضرين', 'processServerWorks']
  ];

  const TOMBSTONE_FIELD = 'محذوف_في';

  /**
   * Tombstone Translation: maps one raw A7 sync item (a server sheet
   * row, possibly a tombstone) onto a shallow-cloned copy carrying an
   * explicit `deletedAt`, per this file's header comment. All other
   * fields (including the raw `محذوف_في` / `آخر_تحديث` columns
   * themselves) are preserved as-is on the returned object — Repository
   * treats unknown extra keys as ordinary record data, exactly like any
   * other sheet column already does today via loadFromSheets().
   * @param {Object} item
   * @returns {Object}
   */
  function _translateTombstone(item) {
    const out = Object.assign({}, item);
    const raw = item ? item[TOMBSTONE_FIELD] : undefined;
    out.deletedAt = (raw != null && raw !== '') ? raw : null;
    return out;
  }

  /**
   * Applies one already-fetched, already-validated page of sync items
   * into the given entity's Repository, via the exact same
   * `window[key+'Repository']` / `window[key+'RepositoryReadyPromise']`
   * resolution `_persistEntityViaRepository()` already uses.
   * @param {string} repoKey
   * @param {Array} items
   * @returns {Promise<boolean>} true iff the apply step fully succeeded
   */
  async function _applyPage(repoKey, items) {
    const repo = (typeof window !== 'undefined') ? window[repoKey + 'Repository'] : undefined;
    const readyPromise = (typeof window !== 'undefined') ? window[repoKey + 'RepositoryReadyPromise'] : undefined;
    if (!repo || !readyPromise || typeof repo.import !== 'function') return false;
    try {
      await readyPromise;
      if (!items.length) return true; // nothing to apply is a trivially-successful apply
      const mapped = items.map(_translateTombstone);
      const result = await repo.import(mapped, 'merge');
      return !!(result && result.success === true);
    } catch (e) {
      try { console.warn('[SyncEngine] apply failed for "' + repoKey + '":', e); } catch (e2) {}
      return false;
    }
  }

  /**
   * Runs the full Receive → Validate → Apply → Commit loop for ONE
   * sheet, across as many pages as `hasMore` reports, stopping (without
   * committing the failed page) the moment anything fails.
   * @param {string} sheetName  Arabic sheet name
   * @param {string} repoKey    e.g. 'cases'
   * @returns {Promise<{sheet:string, ok:boolean, pagesApplied:number, error:?string}>}
   */
  async function syncEntityIncremental(sheetName, repoKey) {
    let pagesApplied = 0;
    let cursor = null;
    try {
      cursor = SyncCheckpoint.get(sheetName);
    } catch (e) {
      cursor = null;
    }

    for (;;) {
      let response;
      try {
        response = await ApiService.syncSheet(sheetName, cursor);
      } catch (e) {
        return { sheet: sheetName, ok: pagesApplied > 0, pagesApplied: pagesApplied, error: 'network: ' + (e && e.message) };
      }

      // VALIDATE — a malformed/missing response is a failed page. Note:
      // ApiService.syncSheet() itself already normalizes network/HTTP/
      // application errors into {items:[], nextCursor:cursor, hasMore:false}
      // (see js/api/api.js), so this check mainly guards against a
      // future/foreign caller shape and defensive drift, not the
      // documented failure path (which already looks like success with
      // zero items — see the `hasMore` handling below, which correctly
      // treats that shape as "nothing new, stop").
      if (!response || !Array.isArray(response.items)) {
        return { sheet: sheetName, ok: pagesApplied > 0, pagesApplied: pagesApplied, error: 'invalid sync response' };
      }

      const applied = await _applyPage(repoKey, response.items);
      if (!applied) {
        // APPLY FAILED — Checkpoint Safety: do NOT commit. Old cursor
        // (whatever it was at loop entry) remains the durable checkpoint.
        return { sheet: sheetName, ok: pagesApplied > 0, pagesApplied: pagesApplied, error: 'apply failed' };
      }

      // COMMIT — only reached after a fully successful apply.
      try {
        SyncCheckpoint.save(sheetName, response.nextCursor != null ? response.nextCursor : null);
      } catch (e) {
        // Checkpoint write itself failing is treated like an apply
        // failure for safety: stop here rather than silently looping
        // forever without ever being able to persist progress.
        return { sheet: sheetName, ok: pagesApplied > 0, pagesApplied: pagesApplied, error: 'checkpoint commit failed' };
      }
      cursor = response.nextCursor != null ? response.nextCursor : null;
      pagesApplied++;

      if (!response.hasMore) {
        return { sheet: sheetName, ok: true, pagesApplied: pagesApplied, error: null };
      }
      // else: loop again immediately with the newly committed cursor —
      // multi-page incremental sync, per §"Composite Cursor" / multiple
      // pages requirement.
    }
  }

  /**
   * Runs incremental sync for every SYNC_ENTITY_PAIRS entry. Each
   * sheet's success/failure is fully independent — one sheet failing
   * (e.g. one bad response) never stops or rolls back any other sheet,
   * matching the same per-sheet isolation `loadFromSheets()` already
   * uses (Promise.all of independent per-sheet try/catch blocks).
   * @returns {Promise<{results:Array, succeeded:number, failed:number}>}
   */
  async function runIncrementalSync() {
    const results = await Promise.all(
      SYNC_ENTITY_PAIRS.map(function (pair) {
        return syncEntityIncremental(pair[0], pair[1]);
      })
    );
    const succeeded = results.filter(function (r) { return r.ok; }).length;
    const failed = results.length - succeeded;
    return { results: results, succeeded: succeeded, failed: failed };
  }

  let _bootIncrementalSyncInProgress = false;

  /**
   * Fire-and-forget boot entry point, mirroring bootLoadFromSheets()'s
   * own re-entrancy guard and never-throw contract. Intended to be
   * called strictly AFTER loadFromSheets() has resolved (see
   * js/modules/settings.js's bootLoadFromSheets(), which now `return`s
   * loadFromSheets()'s promise and chains this call after it) so the
   * two never run concurrently against the same Repositories.
   * @returns {Promise<void>}
   */
  async function bootIncrementalSync() {
    if (_bootIncrementalSyncInProgress) return;
    if (typeof API_URL === 'undefined' || !API_URL) return;
    if (typeof ApiService === 'undefined' || typeof ApiService.syncSheet !== 'function') return;
    if (typeof SyncCheckpoint === 'undefined') return;
    _bootIncrementalSyncInProgress = true;
    try {
      await runIncrementalSync();
    } catch (e) {
      try { console.warn('[SyncEngine] bootIncrementalSync failed:', e); } catch (e2) {}
    } finally {
      _bootIncrementalSyncInProgress = false;
    }
  }

  return {
    SYNC_ENTITY_PAIRS: SYNC_ENTITY_PAIRS,
    syncEntityIncremental: syncEntityIncremental,
    runIncrementalSync: runIncrementalSync,
    bootIncrementalSync: bootIncrementalSync,
    _translateTombstone: _translateTombstone // exposed for tests only
  };
})();

if (typeof window !== 'undefined') { window.SyncEngine = SyncEngine; }
