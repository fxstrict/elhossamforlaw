/**
 * ================================================================
 * SyncCoordinator.js — PHASE A7.5: Sync Trigger Unification
 * نظام الحسام للمحاماة
 * ================================================================
 * GOAL OF THIS FILE (per the A7.5 request header)
 *   توحيد جميع محفزات المزامنة وتقليل استدعاءات Google Apps Script
 *   تمهيدًا لـ Firebase Notifications في PHASE A8.
 *   Today, five different call sites each decide FOR THEMSELVES when to
 *   hit Apps Script (index.html x2 boot points, settings.js
 *   testConnection()/refreshAll(), firstrun.js). This file becomes the
 *   SINGLE place that decides WHETHER and HOW a sync runs; every one of
 *   those five call sites is reduced to `SyncCoordinator.requestSync(reason)`
 *   (see index.html, js/modules/settings.js, js/modules/firstrun.js —
 *   each carries its own inline comment on why its reason was chosen).
 *
 * WHAT THIS FILE IS NOT
 *   - It is NOT a new sync engine. It contains zero Repository/API/
 *     IndexedDB logic of its own — SyncEngine.js, SyncCheckpoint.js,
 *     OfflineQueue.js, ApiService and loadFromSheets() are all used as
 *     black boxes, exactly as the request's §4/§15 require. This file
 *     only decides TIMING (should a sync run right now, given TTL/
 *     cooldown/single-flight/offline) and SEQUENCING (offline-queue
 *     replay, then the correct kind of pull, then checkpoint-backed
 *     state bookkeeping).
 *   - It is NOT a poller. No setInterval anywhere in this file, and the
 *     only setTimeout use is the bounded, one-shot retry backoff below
 *     (§28 of the request — TTL is a decision made at a trigger, not a
 *     timer that re-fires itself).
 *
 * FIRST-SYNC vs SUBSEQUENT-SYNC DETECTION (§13/§14 — no invented API)
 *   SyncCheckpoint.js exposes only get(sheetName)/save(sheetName,cursor)/
 *   clearAll() — there is no exists()/hasAny() (§15 explicitly forbids
 *   inventing one). To decide "has ANY sheet ever completed a sync",
 *   this file calls the existing, already-public SyncCheckpoint.get()
 *   once per sheet name in SyncEngine.SYNC_ENTITY_PAIRS (the same list
 *   SyncEngine.js itself iterates for runIncrementalSync() — reused,
 *   not duplicated) and checks whether every one of them is still null.
 *     - If EVERY sheet has no checkpoint yet -> First Sync (§13):
 *         await loadFromSheets(); then SyncEngine.bootIncrementalSync()
 *       — i.e. the exact same two calls bootLoadFromSheets() already
 *       chains today (js/modules/settings.js), reused verbatim, not
 *       reinvented.
 *     - If AT LEAST ONE sheet already has a checkpoint -> Subsequent
 *       Sync (§14): SyncEngine.runIncrementalSync() only — no full
 *       loadFromSheets() pull. (Per-sheet: runIncrementalSync() already
 *       handles any individual sheet that itself still has no
 *       checkpoint by pulling it in full via cursor=null — see
 *       SyncEngine.js's own header — so nothing is lost for a sheet
 *       that lags behind the others.)
 *   NOTE — this is a real, deliberate behavior change from today's
 *   bootLoadFromSheets(), which currently runs the FULL loadFromSheets()
 *   pull on every single boot regardless of checkpoint state. Skipping
 *   the full pull once every sheet has a checkpoint is the entire point
 *   of A7.5 (fewer Apps Script calls) and is explicitly asked for by
 *   §14 ("لا تنفذ full pull في كل مرة"). Existing tests for
 *   bootLoadFromSheets() itself (PHASE_A7_frontend_sync_tests.js) are
 *   untouched and still pass because bootLoadFromSheets() itself is not
 *   modified — only its callers in index.html/settings.js/firstrun.js
 *   are redirected to go through this Coordinator instead.
 *
 * RETRY / BACKOFF — HOW "3 محاولات" x "1s/2s/4s" WAS INTERPRETED
 *   The request lists three delay values (1s, 2s, 4s) for three
 *   attempts, and separately caps "محاولات" (attempts) at 3. Read
 *   literally as "3 total attempts" there would only be 2 gaps between
 *   attempts (1s, 2s) — leaving the documented "4s" value dead code,
 *   which would silently contradict the very requirement asking for it.
 *   This file instead reads "المحاولة الأولى/الثانية/الثالثة" as the
 *   1st/2nd/3rd RETRY (i.e. attempts after the initial one), each
 *   separated by escalating backoff: initial attempt -> (fails) -> wait
 *   1s -> retry #1 -> (fails) -> wait 2s -> retry #2 -> (fails) -> wait
 *   4s -> retry #3 -> (fails) -> permanent failure for this cycle. That
 *   makes all three documented delay values real, reachable code paths
 *   (see tests/PHASE_A7_5_sync_coordinator_tests.js #16-19), while "max
 *   3 محاولات" is enforced as "max 3 retries" (4 network attempts total
 *   in the worst case). If this reading is wrong, it is an easy,
 *   isolated constant change (RETRY_DELAYS_MS below) — nothing else in
 *   this file depends on the specific count.
 *
 * WHAT THIS FILE DELIBERATELY DOES NOT DO
 *   - Does not add any Firebase/FCM/token/Firestore code (§29/§35).
 *   - Does not touch OfflineQueue.js's own 'online'/
 *     AHP_BACKGROUND_SYNC_TICK listeners (§26) — those still trigger
 *     OfflineQueue.replay() directly, exactly as today; this file only
 *     calls OfflineQueue.replay() itself, once, as step 1 of its own
 *     sync sequence (§12), never adding a second listener for the same
 *     events.
 *   - Does not add a 'focus' listener (request's §8 — "لا تضف focus بلا
 *     حاجة"): 'visibilitychange' + 'pageshow' + 'online' (below) already
 *     cover every resume path this phase's TEST 1–15 require.
 *
 * PHASE SYNC-FIX-01 ADDENDUM (this phase)
 *   The paragraph above previously said this file does NOT wire
 *   'visibilitychange'/'pageshow'/'focus' to requestSync('resume') — that
 *   was true for A7.5 but is the direct, confirmed root cause of the
 *   reported "🟢 منذ يوم" staleness: with no listener for any of those
 *   events, a SyncCoordinator built entirely around
 *   boot/manual/online/notification triggers had NO way to ever run
 *   again once the user simply backgrounded and re-foregrounded an
 *   already-open tab/PWA (the single most common real-world usage
 *   pattern, and the request's own TEST 3/4/14/15). See the bottom of
 *   this file (`_wireLifecycleTriggers`) for the actual fix: 'resume' on
 *   visibilitychange->visible and on pageshow, 'online' on the window
 *   'online' event — every one of them funneled through the SAME
 *   requestSync() single-flight/TTL/cooldown gate already defined below,
 *   so a burst of all three firing together (a real risk called out in
 *   §4 of the request) still yields at most one actual sync: the second
 *   and third calls arrive synchronously (same JS turn) after the first
 *   has already assigned `_currentPromise`, so they short-circuit on the
 *   §10 single-flight check before ever reaching shouldSync(). No new
 *   debounce timer/constant was invented for this — TTL+cooldown+
 *   single-flight (§7/§8/§10, unchanged) already fully cover it.
 * ================================================================
 */

const SyncCoordinator = (function () {
  'use strict';

  // §7 — ONE constant, defined once, never repeated elsewhere in this file.
  const DEFAULT_TTL_MS = 5 * 60 * 1000; // 5 دقائق

  // §8 — ONE constant, defined once, never repeated elsewhere in this file.
  const DEFAULT_COOLDOWN_MS = 10 * 1000; // 10 ثوانٍ

  // See file header "RETRY / BACKOFF" note above for how these three
  // values were derived from the request's "1s / 2s / 4s" table.
  const RETRY_DELAYS_MS = [1000, 2000, 4000];

  const VALID_REASONS = ['boot', 'manual', 'online', 'resume', 'notification'];

  // §6 — metadata-only state. No case/client/session data is ever
  // stored here.
  const state = {
    status: 'idle', // idle | syncing | success | failed | offline
    lastStartedAt: null,
    lastCompletedAt: null,
    lastSuccessAt: null,
    lastFailureAt: null,
    lastReason: null,
    consecutiveFailures: 0
  };

  // §10 — single-flight: the Promise of whichever sync is currently
  // running, or null when idle. requestSync() returns THIS SAME Promise
  // to every caller that arrives while it is non-null.
  let _currentPromise = null;

  function _delay(ms) {
    return new Promise(function (resolve) { setTimeout(resolve, ms); });
  }

  /**
   * §13/§14 — decides First Sync vs Subsequent Sync using ONLY the
   * real, existing SyncCheckpoint.get()/SyncEngine.SYNC_ENTITY_PAIRS
   * API (see file header — no exists()/hasAny() invented).
   * @returns {boolean} true if at least one sheet already has a
   *          committed checkpoint.
   */
  function _hasAnyCheckpoint() {
    if (typeof SyncEngine === 'undefined' || !Array.isArray(SyncEngine.SYNC_ENTITY_PAIRS)) {
      // Defensive default: if SyncEngine isn't available at all, treat
      // this as "no checkpoint" so the safe, existing full-pull path
      // (loadFromSheets + bootIncrementalSync's own internal guards)
      // is what runs — matches today's behavior when SyncEngine.js
      // fails to load (see settings.js bootLoadFromSheets()'s own
      // `typeof SyncEngine!=='undefined'` guard).
      return false;
    }
    if (typeof SyncCheckpoint === 'undefined' || typeof SyncCheckpoint.get !== 'function') {
      return false;
    }
    for (var i = 0; i < SyncEngine.SYNC_ENTITY_PAIRS.length; i++) {
      var sheetName = SyncEngine.SYNC_ENTITY_PAIRS[i][0];
      try {
        if (SyncCheckpoint.get(sheetName) != null) return true;
      } catch (e) {
        // treat a broken read as "no checkpoint for this sheet" and
        // keep checking the rest
      }
    }
    return false;
  }

  /**
   * §12 — one full attempt at the sync sequence:
   *   1. OfflineQueue.replay()
   *   2. determine pull type (first vs subsequent)
   *   3. execute pull
   * Step 4 (update state) is handled by the caller (_runSync), not
   * here, since retry needs to re-run steps 1-3 without touching
   * metadata between attempts.
   *
   * PHASE SYNC-FIX-01 — root-cause fix, second half (see SyncEngine.js
   * header for the first half — the missing lastSyncAt persistence).
   * BEFORE this phase, both branches below awaited their pull call and
   * simply discarded whatever it returned. loadFromSheets() and
   * runIncrementalSync() both NEVER throw on failure (by design — a
   * network failure must not crash the caller, §12.4B/§18) — so a sync
   * where every single sheet failed still resolved normally here, which
   * made this function structurally incapable of ever reporting failure
   * to _syncWithRetry() below. That meant: no retry/backoff ever ran on
   * a real failure, and state.lastSuccessAt/consecutiveFailures (this
   * file's own bookkeeping — §6) were wrong after a 100%-failed sync.
   * Fix: read the status each function now returns and `throw` when it
   * is 'failed' — everything else about both functions (what they fetch,
   * how they apply, when THEY touch lastSyncAt) is untouched.
   * @returns {Promise<void>} rejects if any step throws — the retry
   *          wrapper below is what decides what happens next.
   */
  async function _attemptOnce() {
    if (typeof OfflineQueue !== 'undefined' && typeof OfflineQueue.replay === 'function') {
      // §27 — call OfflineQueue.replay() exactly once per attempt, and
      // rely entirely on OfflineQueue's own internal single-flight
      // (`replaying` flag) rather than adding a second guard here.
      await OfflineQueue.replay();
    }

    if (_hasAnyCheckpoint()) {
      // §14 — Subsequent Sync: incremental only, no full pull.
      if (typeof SyncEngine !== 'undefined' && typeof SyncEngine.runIncrementalSyncAndPersist === 'function') {
        var incResult = await SyncEngine.runIncrementalSyncAndPersist();
        if (incResult && incResult.status === 'failed') {
          throw new Error('[SyncCoordinator] incremental sync failed for all sheets');
        }
      } else if (typeof SyncEngine !== 'undefined' && typeof SyncEngine.runIncrementalSync === 'function') {
        // Defensive fallback if an older SyncEngine.js is present without
        // the persisting wrapper — preserves pre-fix behavior exactly
        // rather than throwing on a missing method.
        await SyncEngine.runIncrementalSync();
      }
    } else {
      // §13 — First Sync: reuse the exact existing behavior verbatim.
      if (typeof loadFromSheets === 'function') {
        var lfsResult = await loadFromSheets();
        if (lfsResult && lfsResult.status === 'failed') {
          throw new Error('[SyncCoordinator] initial loadFromSheets() failed for all sheets');
        }
      }
      if (typeof SyncEngine !== 'undefined' && typeof SyncEngine.bootIncrementalSync === 'function') {
        // bootIncrementalSync() keeps its existing never-throw contract
        // (it is also called directly from settings.js's
        // bootLoadFromSheets() legacy path) — a failure here alone does
        // not fail the overall attempt when the first-sync full pull
        // above already succeeded.
        await SyncEngine.bootIncrementalSync();
      }
    }
  }

  /**
   * §16 — retry wrapper: initial attempt + up to RETRY_DELAYS_MS.length
   * retries, with escalating backoff between them. Never throws/rejects
   * (§18 — "لا ترمِ خطأً غير معالج"); returns true/false instead.
   * @returns {Promise<boolean>} true iff some attempt succeeded.
   */
  async function _syncWithRetry() {
    var totalAttempts = RETRY_DELAYS_MS.length + 1;
    for (var attempt = 0; attempt < totalAttempts; attempt++) {
      if (attempt > 0) {
        await _delay(RETRY_DELAYS_MS[attempt - 1]);
      }
      try {
        await _attemptOnce();
        return true;
      } catch (e) {
        // §18 — log clearly, but never let this escape as an unhandled
        // rejection; the loop either retries or falls through to the
        // final "failed" state below.
        try {
          console.warn('[SyncCoordinator] attempt ' + (attempt + 1) + '/' + totalAttempts + ' failed:', e);
        } catch (e2) { /* console unavailable — ignore */ }
      }
    }
    return false;
  }

  /**
   * §19 — pure decision function: would a sync be allowed to start
   * right now for this reason? Does NOT itself check single-flight
   * (requestSync() already short-circuits on an in-flight sync before
   * ever calling this) and does NOT itself check offline (requestSync()
   * checks that first too, per §11).
   * @param {string} reason
   * @returns {boolean}
   */
  function shouldSync(reason) {
    if (reason === 'manual') {
      // §9/§20 — manual bypasses BOTH TTL and cooldown.
      return true;
    }
    var now = Date.now();
    if (state.lastSuccessAt != null && (now - state.lastSuccessAt) < DEFAULT_TTL_MS) {
      // A recent successful sync already covered this — no need to hit
      // Apps Script again just because another boot/online/resume/
      // notification trigger fired.
      return false;
    }
    if (state.lastStartedAt != null && (now - state.lastStartedAt) < DEFAULT_COOLDOWN_MS) {
      // §20 — cooldown: absorbs a burst of triggers (e.g. boot + online
      // + resume within the same few seconds) into a single sync.
      return false;
    }
    return true;
  }

  /**
   * §17/§18 — runs one full (possibly retried) sync cycle and updates
   * the metadata state before/after. Only ever called when the caller
   * has already established there is no other sync in flight.
   * @param {string} reason
   * @returns {Promise<{reason:string, success:boolean, status:string}>}
   */
  async function _runSync(reason) {
    state.status = 'syncing';
    state.lastStartedAt = Date.now();
    state.lastReason = reason;

    var success = await _syncWithRetry();

    var now = Date.now();
    state.lastCompletedAt = now;
    if (success) {
      state.status = 'success';
      state.consecutiveFailures = 0;
      state.lastSuccessAt = now;
    } else {
      state.status = 'failed';
      state.lastFailureAt = now;
      state.consecutiveFailures = state.consecutiveFailures + 1;
    }
    return { reason: reason, success: success, status: state.status };
  }

  /**
   * §5 — main entry point. Every UI/boot/online/(future Firebase) call
   * site should call this instead of touching loadFromSheets()/
   * SyncEngine directly.
   * @param {string} reason one of 'boot'|'manual'|'online'|'resume'|'notification'
   * @returns {Promise<Object>} resolves with a small status summary;
   *          NEVER rejects.
   */
  function requestSync(reason) {
    if (VALID_REASONS.indexOf(reason) === -1) reason = 'manual';

    // §10 — single-flight: any reason arriving while a sync is already
    // running gets the SAME Promise back, never a second sync.
    if (_currentPromise) return _currentPromise;

    // §11 — offline guard: exits immediately, zero network calls.
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      state.status = 'offline';
      return Promise.resolve({ reason: reason, success: false, status: 'offline', started: false });
    }

    if (!shouldSync(reason)) {
      return Promise.resolve({ reason: reason, success: false, status: state.status, started: false, skipped: true });
    }

    var p = _runSync(reason);
    _currentPromise = p;
    p.finally(function () { _currentPromise = null; });
    return p;
  }

  /** Convenience wrapper: always attempts a sync now (manual reason). */
  function syncNow() {
    return requestSync('manual');
  }

  /** @returns {Object} a shallow copy of the internal metadata state. */
  function getState() {
    return {
      status: state.status,
      lastStartedAt: state.lastStartedAt,
      lastCompletedAt: state.lastCompletedAt,
      lastSuccessAt: state.lastSuccessAt,
      lastFailureAt: state.lastFailureAt,
      lastReason: state.lastReason,
      consecutiveFailures: state.consecutiveFailures
    };
  }

  // ==================================================================
  // PHASE SYNC-FIX-01 — §4/§5/§6/§7/§8: resume/online lifecycle wiring
  // ==================================================================
  // Root cause (see file header ADDENDUM): nothing in the app previously
  // called requestSync('resume') or requestSync('online') at all. Boot
  // (index.html DOMContentLoaded) and manual (the refresh button) were
  // the ONLY two triggers wired to this Coordinator — so once the tab/
  // PWA was left open across a background/foreground cycle (or the
  // device's connectivity dropped and came back) with no full page
  // reload in between, no sync ever ran again, and the topbar's "منذ
  // ..." timestamp necessarily went stale no matter how the rest of this
  // file's TTL/cooldown/retry logic worked.
  //
  // Each listener below does the SAME two things and nothing else:
  //   1. Decide the right `reason` for this event ('resume' or 'online').
  //   2. Call requestSync(reason) — every dedup/TTL/cooldown/offline/
  //      single-flight decision is made entirely inside requestSync()/
  //      shouldSync() above, unchanged. No event handler here decides
  //      "should a sync run" on its own.
  // guarded against non-browser environments (Node test harness, SSR)
  // exactly like the rest of this file's `typeof window !== 'undefined'`
  // checks.
  function _wireLifecycleTriggers() {
    if (typeof document === 'undefined' || typeof window === 'undefined') return;

    // §7 "resume" — visibilitychange->visible: covers "returning to the
    // app after it was in the background" and "reopening the PWA" (TEST
    // 3/14 of the request). shouldSync()'s existing TTL check already
    // means this is a no-op if a sync completed successfully within the
    // last DEFAULT_TTL_MS — no extra "was hidden long enough" timer
    // needed on top of that (§7 "أو آخر Sync قديمة بما يكفي" — the TTL
    // check IS that condition, reused rather than duplicated).
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible') {
        requestSync('resume');
      }
    });

    // §6/§ "BFCache" — pageshow, specifically for the back-forward-cache
    // restore case (event.persisted === true), which does NOT fire a
    // fresh 'DOMContentLoaded'/boot trigger at all (TEST 15). Also fires
    // on a normal fresh load with persisted===false; requestSync('resume')
    // is harmless there too since the real boot trigger (index.html) has
    // its own separate 'boot' reason and the two are deduped by the same
    // single-flight/cooldown machinery either way.
    window.addEventListener('pageshow', function () {
      requestSync('resume');
    });

    // §5 "online" — connectivity returning. Distinct from
    // OfflineQueue.js's own 'online' listener (still present, unchanged,
    // still replays writes) — requestSync('online') here additionally
    // runs OfflineQueue.replay() itself as step 1 of _attemptOnce() (§12
    // above), then the correct pull. OfflineQueue.replay()'s own
    // internal single-flight guard makes the two listeners firing on the
    // same event safe (no double-replay of the same queued write).
    window.addEventListener('online', function () {
      requestSync('online');
    });
  }

  _wireLifecycleTriggers();

  return {
    requestSync: requestSync,
    syncNow: syncNow,
    getState: getState,
    shouldSync: shouldSync,
    // Exposed for tests only, mirroring SyncEngine.js's own
    // "exposed for tests only" convention — not used by any app code.
    DEFAULT_TTL_MS: DEFAULT_TTL_MS,
    DEFAULT_COOLDOWN_MS: DEFAULT_COOLDOWN_MS,
    RETRY_DELAYS_MS: RETRY_DELAYS_MS,
    // PHASE SYNC-FIX-01 — exposed for tests only (mirrors the pattern
    // above), so tests can verify listeners were registered without
    // relying on real visibilitychange/pageshow/online browser events.
    _wireLifecycleTriggers: _wireLifecycleTriggers
  };
})();

if (typeof window !== 'undefined') { window.SyncCoordinator = SyncCoordinator; }

// Node/test export, same dual-export pattern already used by
// OfflineQueue.js/SyncCheckpoint.js/SyncEngine.js in this codebase.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { SyncCoordinator: SyncCoordinator };
}
