/**
 * ================================================================
 * OfflineQueue.js — Offline Write Queue | نظام الحسام للمحاماة
 * ================================================================
 * PHASE 29 — OFFLINE QUEUE
 *
 * GAP THIS CLOSES (evidence: js/api/api.js, saveData/updateData/
 * deleteData, all three, unchanged elsewhere):
 *   Every one of those three methods already does
 *     try { await this._post(body); }
 *     catch (e) { console.warn(...); }
 *   with no further action in the catch block. `_post` is a plain
 *   `fetch()`, which REJECTS on a true network failure (offline, DNS,
 *   timeout — NOT on a 4xx/5xx HTTP response, which fetch() does not
 *   reject on; that pre-existing, separate gap is untouched here). So
 *   today, an edit made while offline is written to the local
 *   Repository/IndexedDB (untouched, already correct — DirtyTracker/
 *   Undo/Restore already cover that side) but its outbound sync to
 *   Google Sheets is silently DROPPED forever the moment `_post` throws
 *   — nothing ever retries it, even after connectivity returns.
 *
 * WHAT THIS FILE ADDS
 *   A small durable FIFO queue, persisted to localStorage (same simple
 *   "one JSON blob under one key" pattern LocalStorageAdapter.js already
 *   uses for entity data — kept independent of it and of IndexedDB/
 *   Repository.js on purpose: this queues raw outbound Apps Script
 *   request bodies, not domain records, so it has no schema, no
 *   migration, and cannot collide with or block the existing
 *   IndexedDB-based offline-first data layer):
 *     user edits → _post() fails (offline) → OfflineQueue.enqueue(body)
 *     → connectivity returns (any of: window 'online' event, a same-tab
 *       boot-time check, or the Service Worker's existing
 *       'ahp-connectivity-restored' background-sync broadcast — see
 *       service-worker.js, already scaffolded there, previously
 *       unconsumed by anything) → OfflineQueue.replay() → each queued
 *       body is re-POSTed, in original order, via the exact same
 *       ApiService._post() the original call used → removed from the
 *       queue only on confirmed success.
 *   No UI, no toast, no user-visible state — matches the request
 *   ("بدون أن يشعر المستخدم" / without the user having to notice
 *   anything). Failures during replay stop the loop (still offline) and
 *   leave the remainder queued for the next trigger; console logging
 *   only (devtools), consistent with this project's existing "fails
 *   silently to console, non-fatal" convention (ServiceWorkerRegistrar.js,
 *   service-worker.js install handler).
 *
 * WHAT THIS FILE DOES NOT DO (documented, not silently glossed over)
 *   - Does not resolve the pre-existing ApiService positional-index
 *     drift limitation already documented elsewhere (R-06): a queued
 *     `updateData`/`deleteData` body carries the rowIndex captured at
 *     the moment of the ORIGINAL edit. If the sheet's row order changed
 *     on the server between then and replay (e.g. two different queued
 *     edits touching the same sheet, or a change from another device),
 *     that pre-existing limitation applies exactly as it already does
 *     for a normal same-session sync — this file neither introduces nor
 *     fixes that.
 *   - Does not queue `ApiService.uploadFile()` (Drive uploads) — a
 *     different endpoint with a different (large, base64) payload shape
 *     and its own response contract (`{ok,url}`) that callers actually
 *     read; queuing it is a separate, out-of-scope feature.
 *   - Does not touch Repository.js, DirtyTracker.js, UndoManager.js, or
 *     any *.js module — the only integration point is the three
 *     `catch` blocks in js/api/api.js (one line added to each).
 * ================================================================
 */

const OfflineQueue = (function () {
  'use strict';

  const STORAGE_KEY = '__ahp_offline_write_queue__';
  const SYNC_TAG = 'ahp-connectivity-restored';
  let replaying = false;

  function _readAll() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch (e) {
      return [];
    }
  }

  function _writeAll(list) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
    } catch (e) {
      try { console.warn('[OfflineQueue] failed to persist queue:', e); } catch (e2) {}
    }
  }

  function _uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  /**
   * Durably queues a raw Apps Script request body (exactly the object
   * shape ApiService._post() already sends) for retry once connectivity
   * returns.
   * @param {Object} body - the request body that just failed to send.
   */
  function enqueue(body) {
    const list = _readAll();
    list.push({ id: _uid(), payload: body, queuedAt: Date.now() });
    _writeAll(list);
    try { console.info('[OfflineQueue] queued for retry, pending:', list.length); } catch (e) {}
    _requestBackgroundSync();
  }

  /** @returns {number} number of writes currently pending retry. */
  function size() {
    return _readAll().length;
  }

  // Best-effort: ask the Service Worker's already-scaffolded 'sync' event
  // (see service-worker.js) to wake this queue even if the tab is closed
  // before connectivity returns. Silently no-ops where unsupported
  // (Background Sync is not available in every browser) — same
  // fail-soft convention this project already uses for PWA features.
  function _requestBackgroundSync() {
    if (!('serviceWorker' in navigator)) return;
    navigator.serviceWorker.ready
      .then(function (reg) {
        if (reg && reg.sync && typeof reg.sync.register === 'function') {
          return reg.sync.register(SYNC_TAG).catch(function () {});
        }
      })
      .catch(function () {});
  }

  /**
   * Replays every queued write, in original (FIFO) order, over the
   * caller's live network connection. Re-entrancy-guarded (multiple
   * triggers — 'online' event, boot check, background-sync tick — can
   * fire close together). Stops at the first failure and leaves the
   * remainder queued for the next trigger, rather than reordering or
   * dropping anything.
   */
  async function replay() {
    if (replaying) return;
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
    if (typeof ApiService === 'undefined' || typeof ApiService._post !== 'function') return;

    replaying = true;
    try {
      let list = _readAll();
      while (list.length) {
        const entry = list[0];
        try {
          await ApiService._post(entry.payload);
        } catch (e) {
          break; // still offline / failing — keep it and everything after it queued
        }
        list.shift();
        _writeAll(list);
      }
      if (list.length === 0) {
        try { console.info('[OfflineQueue] all pending writes synced'); } catch (e) {}
      }
    } finally {
      replaying = false;
    }
  }

  if (typeof window !== 'undefined') {
    window.addEventListener('online', function () { replay(); });
    // Boot-time catch-up: covers writes queued in a previous session that
    // never got a chance to replay (e.g. tab closed while still offline).
    window.addEventListener('load', function () {
      if (navigator.onLine) replay();
    });
  }
  if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
    navigator.serviceWorker.addEventListener('message', function (event) {
      if (event.data && event.data.type === 'AHP_BACKGROUND_SYNC_TICK') replay();
    });
  }

  return { enqueue: enqueue, replay: replay, size: size };
})();
