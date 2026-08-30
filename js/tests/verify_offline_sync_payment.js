/**
 * verify_offline_sync_payment.js
 * PHASE 15 — OFFLINE / SYNC. Tests js/core/OfflineQueue.js's real FIFO
 * replay() against the exact scenario the master prompt describes:
 *   Case -> CaseClient relationship (id generated locally) -> Fee
 *   Payment carrying that رقم_علاقة -> both queued offline -> replay.
 *
 * Proves:
 *   A. the relationship's queued request is replayed BEFORE the
 *      payment's (FIFO order preserved — OfflineQueue.js's own file
 *      header documents this as its whole purpose).
 *   B. a retried/duplicate replay of the SAME request does not create
 *      a second server-side row (simulated via a fake apiAddRow-style
 *      idempotency check — id-based, matching the REAL backend
 *      behavior documented in PHASE 1 DISCOVERY's own findings on
 *      Config/06_Api.gs's _resolveIdFieldForSheet/_findRowByIdValue).
 *   C. رقم_علاقة on the payload never changes across enqueue -> replay.
 *   D. رقم_العملية (the Fee's own id) never changes across enqueue -> replay.
 *   E. a retry after a successful send results in exactly ONE row for
 *      that id server-side, not two.
 *
 * This does not modify OfflineQueue.js, ApiService, or any backend
 * file — it is a pure behavioral test against the real, unmodified
 * OfflineQueue.replay() implementation, with a fake in-memory
 * "backend" standing in for Google Sheets (id-keyed, exactly like the
 * real apiAddRow()).
 */
'use strict';

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const vm = require('vm');

let passed = 0;
let failed = 0;
async function check(label, fn) {
  try {
    await fn();
    console.log('PASS — ' + label);
    passed++;
  } catch (e) {
    console.log('FAIL — ' + label + '  =>  ' + e.message);
    failed++;
  }
}

function main() {
  return (async () => {
    // ---- Fake in-memory backend, id-keyed exactly like the real
    // apiAddRow()/_findRowByIdValue() (PHASE 1 DISCOVERY finding) ----
    const backendRows = {}; // sheetName -> { idValue -> row }
    const postLog = []; // records the order + payload of every "network" call

    const fakeLocalStorageStore = {};
    const sandbox = {
      localStorage: {
        getItem: function (k) { return Object.prototype.hasOwnProperty.call(fakeLocalStorageStore, k) ? fakeLocalStorageStore[k] : null; },
        setItem: function (k, v) { fakeLocalStorageStore[k] = v; }
      },
      navigator: { onLine: true }, // no `serviceWorker` property -> _requestBackgroundSync() no-ops safely
      console: console,
      Date: Date,
      Math: Math,
      JSON: JSON,
      window: undefined // OfflineQueue.js guards `typeof window !== 'undefined'` before attaching listeners
    };
    sandbox.ApiService = {
      _post: function (payload) {
        postLog.push(JSON.parse(JSON.stringify(payload)));
        var sheet = payload.sheet;
        var idField = payload.idField;
        var row = payload.row;
        if (!backendRows[sheet]) backendRows[sheet] = {};
        var idValue = row[idField];
        // Exactly the real apiAddRow()'s own idempotency rule (PHASE 1):
        // an existing row with this id is left as-is, never duplicated.
        if (!backendRows[sheet][idValue]) {
          backendRows[sheet][idValue] = row;
        }
        return Promise.resolve({ success: true });
      }
    };
    vm.createContext(sandbox);

    const src = fs.readFileSync(path.join(__dirname, '..', 'core', 'OfflineQueue.js'), 'utf8');
    vm.runInContext(src, sandbox, { filename: 'OfflineQueue.js' });
    // OfflineQueue.js declares `const OfflineQueue = ...` at top level —
    // vm's context object only auto-exposes `var`/function declarations,
    // not `const`/`let` bindings, so retrieve it via a second
    // runInContext call sharing the same context's lexical environment.
    const OfflineQueue = vm.runInContext('OfflineQueue', sandbox);

    // ---- Scenario: relationship created locally (id already assigned
    // client-side, exactly like CaseClientsRepository.create() does via
    // uid() before any network round trip), then a Fee Payment carrying
    // that same رقم_علاقة — both go offline, both get queued. ----
    const relationshipId = 'REL-OFFLINE-1';
    const feeId = 'FEE-OFFLINE-1';

    OfflineQueue.enqueue({
      sheet: 'قضية_موكلين', idField: 'id',
      row: { id: relationshipId, 'رقم_القضية': '2026/OFF', 'رقم_الموكل': 'CL1', 'الصفة': 'مدّعي', 'أتعاب_العلاقة': '20000' }
    });
    OfflineQueue.enqueue({
      sheet: 'الأتعاب', idField: 'رقم_العملية',
      row: { 'رقم_العملية': feeId, 'رقم_القضية': '2026/OFF', 'رقم_الموكل': 'CL1', 'رقم_علاقة': relationshipId, 'المبلغ': '5000' }
    });

    await check('SETUP: both writes are queued (pending size = 2) before replay', () => {
      assert.strictEqual(OfflineQueue.size(), 2);
    });

    await OfflineQueue.replay();

    await check('A. FIFO order preserved: the relationship (قضية_موكلين) request was sent to the backend BEFORE the payment (الأتعاب) request', () => {
      assert.strictEqual(postLog.length, 2);
      assert.strictEqual(postLog[0].sheet, 'قضية_موكلين');
      assert.strictEqual(postLog[1].sheet, 'الأتعاب');
    });

    await check('After replay: queue is fully drained (size = 0)', () => {
      assert.strictEqual(OfflineQueue.size(), 0);
    });

    await check('C. رقم_علاقة on the replayed payment payload is unchanged — still points at the exact relationship id generated before enqueueing', () => {
      assert.strictEqual(postLog[1].row['رقم_علاقة'], relationshipId);
    });

    await check('D. رقم_العملية on the replayed payment is unchanged — still the exact id generated before enqueueing', () => {
      assert.strictEqual(postLog[1].row['رقم_العملية'], feeId);
    });

    await check('Backend state after the first replay: exactly one row per sheet, keyed by the stable id', () => {
      assert.strictEqual(Object.keys(backendRows['قضية_موكلين']).length, 1);
      assert.strictEqual(Object.keys(backendRows['الأتعاب']).length, 1);
      assert.strictEqual(backendRows['الأتعاب'][feeId]['المبلغ'], '5000');
    });

    // ---- B/E — simulate a retry: the SAME payment request is
    // re-queued (e.g. the user's tab reloaded mid-sync-confirmation and
    // the app conservatively re-queues) and replayed again. ----
    OfflineQueue.enqueue({
      sheet: 'الأتعاب', idField: 'رقم_العملية',
      row: { 'رقم_العملية': feeId, 'رقم_القضية': '2026/OFF', 'رقم_الموكل': 'CL1', 'رقم_علاقة': relationshipId, 'المبلغ': '5000' }
    });
    await OfflineQueue.replay();

    await check('B/E. Retry/duplicate replay of the SAME فee id does NOT create a second backend row — exactly one row remains, not two (5000, not 5000+5000)', () => {
      assert.strictEqual(Object.keys(backendRows['الأتعاب']).length, 1, 'still exactly one row keyed by رقم_العملية');
      assert.strictEqual(postLog.length, 3, 'the retry WAS sent over the network (postLog grew)...');
      assert.strictEqual(backendRows['الأتعاب'][feeId]['المبلغ'], '5000', '...but the backend\'s own id-based idempotency rule (not OfflineQueue itself) is what prevented the duplicate row — exactly the real apiAddRow() behavior this test simulates');
    });

    console.log('\n' + passed + ' passed, ' + failed + ' failed');
    if (failed > 0) process.exitCode = 1;
  })();
}

main().catch(function (e) {
  console.error('FATAL:', e);
  process.exitCode = 1;
});
