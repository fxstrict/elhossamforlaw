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
 *   14 of the 18 SHEET_DEFS sheets as of PHASE S.9 (the same 12 the A7
 *   backend originally put in sync scope, plus قضية_موكلين added in
 *   S.8 and المصروفات added in S.9 — see those phases' reports). The
 *   remaining 4 are each excluded for a distinct, verified reason, not
 *   a gap (see PHASE S.9 report §5/§15 for the full audit):
 *     - بيانات_المكتب: single fixed record, no محذوف_في/آخر_تحديث
 *       columns at all — outside this sync model's shape entirely.
 *     - أجهزة_FCM: per-device FCM push token registration — inherently
 *       device-local data, not a shared business entity to merge
 *       across devices; also uses 'updated_at' (not 'آخر_تحديث') and
 *       has no tombstone column, so apiSyncSheet() would reject it
 *       even if added.
 *     - التثبيتات / أكواد_التفعيل: license/installation infrastructure,
 *       already in _getRestrictedSheetNames_() (Config/00_Config.gs) —
 *       protected, out of scope per this project's licensing rules.
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
 *   - Does NOT invent a 14th/15th integration point for المصروفات —
 *     that sheet still has no existing pull path in loadFromSheets()
 *     today, and adding one would be a new, unreviewed integration
 *     point. (قضية_موكلين WAS added as a reviewed, authorized
 *     integration point in PHASE S.8 — see that phase's forensic
 *     audit report for the full verification trail: SHEET_DEFS shape,
 *     restricted-sheet check, and generic API route behavior were all
 *     confirmed compatible before this list was changed.)
 *   - Does NOT add authentication (pre-existing, unrelated blocker,
 *     unchanged by this session).
 * ================================================================
 */

const SyncEngine = (function () {
  'use strict';

  // Mirrors settings.js's loadFromSheets() pairs list EXACTLY for the
  // 13 sheets that already have a confirmed, live, working Repository +
  // ready-promise + pull path (see file header). This list is
  // intentionally duplicated rather than imported from settings.js
  // (which exposes no such constant today) — extracting a shared
  // constant would mean editing settings.js's existing pairs array
  // declaration, a larger change than this session's scope calls for.
  // If the two lists ever diverge, the tests in
  // tests/PHASE_A7_frontend_sync_tests.js catch it (they assert this
  // list is a subset of settings.js's own literal pairs array).
  //
  // PHASE S.8 — 'قضية_موكلين'/'caseClients' added: SHEET_DEFS already
  // defines this sheet with idField 'id' plus 'آخر_تحديث'/'محذوف_في'
  // columns (same shape as every other pair here), it is not in
  // _getRestrictedSheetNames_(), and settings.js's own pairs array was
  // updated in the same phase — see that file's PHASE S.8 comment for
  // the full verification trail. No longer "no pull path at all" as
  // this file's header previously documented.
  //
  // PHASE S.9 — 'المصروفات'/'expenses' added on the same basis (see
  // PHASE S.9 report §5): push already existed, only pull was missing.
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
    ['أعمال_المحضرين', 'processServerWorks'],
    ['قضية_موكلين', 'caseClients'],
    ['المصروفات', 'expenses']
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
    // S.5.1 / BUG-2 fix: a live row must NOT carry an explicit
    // `deletedAt: null` — the key must be absent entirely, so
    // Repository.import()'s existing protection
    // (oldWasDeleted && !('deletedAt' in record)) can recognize this as
    // "incoming record says nothing about deletion" and refuse to
    // resurrect a newer local tombstone. Only a genuinely tombstoned row
    // gets an explicit `deletedAt` with its real value.
    if (raw != null && raw !== '') {
      out.deletedAt = raw;
    } else {
      delete out.deletedAt;
    }
    return out;
  }

  /**
   * Applies one already-fetched, already-validated page of sync items
   * into the given entity's Repository, via the exact same
   * `window[key+'Repository']` / `window[key+'RepositoryReadyPromise']`
   * resolution `_persistEntityViaRepository()` already uses.
   *
   * PHASE N.13 — CONFIRMED ROOT CAUSE FIX ("update from another device
   * appears late" — investigated and confirmed this session, not
   * inferred): incremental sync has always correctly merged new/changed
   * rows into the Repository (IndexedDB) here, but never told the UI
   * layer anything changed. `navigate(page)` (index.html) only re-runs
   * a page's render function — which is what actually refreshes the
   * in-memory `data.<entity>` mirror via that page's own
   * `sync<Entity>Mirror()` call, e.g. `renderCases()` calls
   * `syncCasesMirror()` — when `ApplicationShell.isDirty(page)` is
   * true. `loadFromSheets()` (settings.js, the FULL pull) already calls
   * `ApplicationShell.markDirty(key)` after importing; this incremental
   * path (the fast, frequent one that runs on every normal sync after
   * the very first) never did. Result: a background incremental sync
   * updated local storage correctly and silently, but an already-open
   * or already-visited page kept showing its last-rendered snapshot
   * until some LATER full pull happened to also touch the same entity
   * and finally set the flag — exactly the "appears after a delay,
   * once something else eventually refreshes it" symptom reported.
   * Only marks dirty when this page actually contained items (an
   * empty page is already a no-op two lines above) — no functional
   * change to the merge/commit/checkpoint logic at all, and this
   * cannot mark a page dirty on a FAILED apply, since this line is
   * only reached after `result.success === true` returns true, above.
   * Zero additional Apps Script/network calls — this is a purely
   * client-side (this device's own memory) signal.
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
      const ok = !!(result && result.success === true);
      if (ok) {
        // PHASE N.13 — see this function's own doc comment above.
        try {
          if (typeof ApplicationShell !== 'undefined' && ApplicationShell && typeof ApplicationShell.markDirty === 'function') {
            ApplicationShell.markDirty(repoKey);
          }
        } catch (e) { /* best-effort UI hint only — never affects sync success/failure */ }
      }
      return ok;
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
    let anyItemsApplied = false; // PHASE N.13 — see runIncrementalSync()'s use of this below
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
        return { sheet: sheetName, ok: pagesApplied > 0, pagesApplied: pagesApplied, error: 'network: ' + (e && e.message), anyItemsApplied: anyItemsApplied };
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
        return { sheet: sheetName, ok: pagesApplied > 0, pagesApplied: pagesApplied, error: 'invalid sync response', anyItemsApplied: anyItemsApplied };
      }

      const applied = await _applyPage(repoKey, response.items);
      if (!applied) {
        // APPLY FAILED — Checkpoint Safety: do NOT commit. Old cursor
        // (whatever it was at loop entry) remains the durable checkpoint.
        return { sheet: sheetName, ok: pagesApplied > 0, pagesApplied: pagesApplied, error: 'apply failed', anyItemsApplied: anyItemsApplied };
      }
      if (response.items.length > 0) anyItemsApplied = true;

      // COMMIT — only reached after a fully successful apply.
      try {
        SyncCheckpoint.save(sheetName, response.nextCursor != null ? response.nextCursor : null);
      } catch (e) {
        // Checkpoint write itself failing is treated like an apply
        // failure for safety: stop here rather than silently looping
        // forever without ever being able to persist progress.
        return { sheet: sheetName, ok: pagesApplied > 0, pagesApplied: pagesApplied, error: 'checkpoint commit failed', anyItemsApplied: anyItemsApplied };
      }
      cursor = response.nextCursor != null ? response.nextCursor : null;
      pagesApplied++;

      if (!response.hasMore) {
        return { sheet: sheetName, ok: true, pagesApplied: pagesApplied, error: null, anyItemsApplied: anyItemsApplied };
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
    // PHASE N.13 — companion dirty-marking for the two aggregator pages
    // that summarize data across entities, mirroring loadFromSheets()'s
    // own 'dashboard'/'calendar' markDirty calls — but gated on real
    // change (see doc comment above) rather than unconditional, since
    // this function runs far more frequently than the full pull.
    try {
      const anyChanged = results.some(function (r) { return r.anyItemsApplied; });
      if (anyChanged && typeof ApplicationShell !== 'undefined' && ApplicationShell && typeof ApplicationShell.markDirty === 'function') {
        ApplicationShell.markDirty('dashboard');
        ApplicationShell.markDirty('calendar');
      }
    } catch (e) { /* best-effort UI hint only */ }
    return { results: results, succeeded: succeeded, failed: failed };
  }

  let _bootIncrementalSyncInProgress = false;

  /**
   * ================================================================
   * PHASE SYNC-FIX-01 — ROOT CAUSE FIX
   * ================================================================
   * runIncrementalSync() (above, UNCHANGED) never touched lastSyncAt,
   * never called updateTopbarSyncMeta()/showSyncIndicator() — it only
   * ever updated Repositories + SyncCheckpoint. That was fine for the
   * VERY FIRST sync (SyncCoordinator's "first sync" branch runs
   * loadFromSheets() first, which DOES persist lastSyncAt, THEN chains
   * bootIncrementalSync() after it as a bonus). But
   * SyncCoordinator._attemptOnce()'s "subsequent sync" branch — i.e.
   * EVERY sync after the very first one, forever, including every boot
   * and every manual-refresh button press — calls ONLY
   * runIncrementalSync(), never loadFromSheets(). Since that path never
   * touched lastSyncAt, the UI's "last sync" timestamp froze at whatever
   * the first-ever sync wrote, even while real incremental syncs kept
   * succeeding silently underneath — this is the actual mechanism behind
   * the reported "🟢 منذ يوم" staying stuck.
   *
   * Fix: classify the real result (SUCCESS / PARTIAL / FAILED — same
   * three states §15 asks loadFromSheets() to use) and, for SUCCESS/
   * PARTIAL only, persist lastSyncAt through the exact same
   * `_persistSetting` / `updateTopbarSyncMeta` / `showSyncIndicator`
   * globals settings.js's own loadFromSheets() already uses (no new
   * persistence mechanism invented). FAILED never touches lastSyncAt
   * (§2/§16/§23 — "لا تزوّر lastSyncAt").
   *
   * This also fixes a second bug in the same spot: because
   * runIncrementalSync() never threw and its result was previously
   * discarded entirely by _attemptOnce(), a sync where ALL 12 sheets
   * failed still resolved normally — SyncCoordinator's own retry/backoff
   * (§9/§16 of A7.5) never engaged, and its internal state.lastSuccessAt
   * was wrongly marked "success". runIncrementalSyncAndPersist()'s
   * {status:'failed', ...} return now lets SyncCoordinator.js (this
   * phase) `throw` in that case, so the existing 1s/2s/4s retry ladder
   * actually runs, exactly as A7.5 already specifies for the first-sync
   * path.
   * ================================================================
   */

  /**
   * @param {{succeeded:number, failed:number}} result
   * @returns {'success'|'partial'|'failed'}
   */
  function _classifyResult(result) {
    var total = result.succeeded + result.failed;
    if (total === 0) return 'success'; // nothing to sync (empty SYNC_ENTITY_PAIRS) — not an error
    if (result.failed === 0) return 'success';
    if (result.succeeded === 0) return 'failed';
    return 'partial';
  }

  /**
   * Persists a REAL sync outcome through the exact same globals
   * settings.js's own loadFromSheets() success path already uses. Only
   * ever called for 'success'/'partial' — never for 'failed' (see file
   * header). All three lookups are defensive (`typeof x === 'function'`)
   * because SyncEngine.js can run in a test/Node context where
   * settings.js's globals do not exist (mirrors this file's existing
   * `typeof API_URL === 'undefined'` style guards elsewhere).
   * @param {'success'|'partial'} status
   */
  function _persistSyncOutcome(status) {
    try {
      if (typeof _persistSetting === 'function') {
        _persistSetting('lastSyncAt', new Date().toISOString());
      }
    } catch (e) { /* best-effort, mirrors _persistSetting's own internal catch */ }
    try {
      if (typeof updateTopbarSyncMeta === 'function') updateTopbarSyncMeta();
    } catch (e) { /* defensive: UI may not be mounted (e.g. background tab) */ }
    try {
      if (typeof showSyncIndicator === 'function') {
        showSyncIndicator(status === 'partial' ? 'partial' : 'success');
      }
    } catch (e) { /* defensive, same reasoning */ }
  }

  /**
   * Same as runIncrementalSync(), plus: classifies the outcome and, for
   * success/partial, persists lastSyncAt + refreshes the sync-status UI
   * (see header block above for why this was missing and what broke).
   * Never throws — callers that need retry-on-failure behavior should
   * check the returned `status`, not a rejection (matches this file's
   * existing "never throws" contract for bootIncrementalSync()).
   * @returns {Promise<{status:string, results:Array, succeeded:number, failed:number}>}
   */
  async function runIncrementalSyncAndPersist() {
    var result = await runIncrementalSync();
    var status = _classifyResult(result);
    if (status !== 'failed') {
      _persistSyncOutcome(status);
    }
    result.status = status;
    return result;
  }

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
      // PHASE SYNC-FIX-01: was runIncrementalSync() (result discarded).
      // Now uses the persisting wrapper so this boot-time incremental
      // pass also keeps lastSyncAt/topbar status honest, same as every
      // other call site.
      await runIncrementalSyncAndPersist();
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
    runIncrementalSyncAndPersist: runIncrementalSyncAndPersist,
    bootIncrementalSync: bootIncrementalSync,
    _translateTombstone: _translateTombstone // exposed for tests only
  };
})();

if (typeof window !== 'undefined') { window.SyncEngine = SyncEngine; }
