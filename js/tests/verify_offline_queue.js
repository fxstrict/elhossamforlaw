/**
 * verify_offline_queue.js
 * CASES_RELATIONSHIP_FINANCIAL — §8 ("تأكد من أن التعديلات تعمل
 * Offline... اختبر خصوصًا: Case→Client relation, ... Fees→source,
 * Expenses→source") و §12 ("اختبارات OfflineQueue").
 *
 * No test file for js/core/OfflineQueue.js existed before this phase —
 * a real, pre-existing coverage gap (the file shipped in an earlier
 * phase with none), not something introduced here. Closing it now
 * because this phase specifically requires proving the two NEW
 * entities (قضية_موكلين via CaseClientsRepository, المصروفات via
 * ExpensesRepository) work offline — and the only way to prove that
 * honestly is to first prove the queue mechanics themselves are
 * correct, then prove the new entities don't need any special-casing
 * (see js/api/api.js: OfflineQueue.enqueue() is called from 3 generic,
 * entity-agnostic catch blocks — confirmed by direct code inspection,
 * not assumed).
 */
'use strict';

const assert = require('assert');
const path = require('path');

// ---- Minimal browser-global stubs (localStorage, navigator, window) ----
// OfflineQueue.js is written for <script> tag loading (uses localStorage/
// navigator/window directly, not injected) — same minimal-stub approach
// as this suite's other browser-dependent tests use where a full vm
// sandbox isn't otherwise needed.
function makeFakeLocalStorage() {
  const store = {};
  return {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
    _dump: () => Object.assign({}, store)
  };
}

global.localStorage = makeFakeLocalStorage();
Object.defineProperty(global, 'navigator', { value: { onLine: true }, configurable: true, writable: true }); // Node 22 ships a built-in read-only navigator getter; override for this test (no serviceWorker key -> _requestBackgroundSync() no-ops safely)
global.window = { addEventListener: () => {} }; // capture nothing; replay() is called directly in these tests

const postedCalls = [];
let postShouldFail = false;
global.ApiService = {
  _post: async function (body) {
    if (postShouldFail) throw new Error('simulated offline failure');
    postedCalls.push(body);
    return { ok: true };
  }
};

const { OfflineQueue } = require(path.join(__dirname, '..', 'core', 'OfflineQueue.js'));

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

async function main() {
  // ---- 1. Core FIFO queue/replay mechanics ----

  await check('enqueue()/size(): a queued write increases the pending count', () => {
    OfflineQueue.enqueue({ sheet: 'الجلسات', action: 'add', row: { 'رقم_الجلسة': 'S1' } });
    assert.strictEqual(OfflineQueue.size(), 1);
  });

  await check('replay(): a successful replay posts the queued body via ApiService._post() and empties the queue', async () => {
    postedCalls.length = 0;
    await OfflineQueue.replay();
    assert.strictEqual(postedCalls.length, 1);
    assert.strictEqual(postedCalls[0].sheet, 'الجلسات');
    assert.strictEqual(OfflineQueue.size(), 0);
  });

  await check('replay(): a failed post (still offline) leaves the write queued, does not drop it', async () => {
    OfflineQueue.enqueue({ sheet: 'الأتعاب', action: 'add', row: { 'رقم_العملية': 'F1' } });
    postShouldFail = true;
    postedCalls.length = 0;
    await OfflineQueue.replay();
    assert.strictEqual(postedCalls.length, 0, 'must not have posted anything');
    assert.strictEqual(OfflineQueue.size(), 1, 'must still be queued for the next trigger');
    postShouldFail = false;
  });

  await check('replay(): once connectivity returns, the previously-failed write replays successfully on the next call', async () => {
    postedCalls.length = 0;
    await OfflineQueue.replay();
    assert.strictEqual(postedCalls.length, 1);
    assert.strictEqual(postedCalls[0].sheet, 'الأتعاب');
    assert.strictEqual(OfflineQueue.size(), 0);
  });

  await check('replay(): multiple queued writes replay in original FIFO order', async () => {
    OfflineQueue.enqueue({ sheet: 'القضايا', action: 'add', row: { id: 1 } });
    OfflineQueue.enqueue({ sheet: 'الموكلين', action: 'add', row: { id: 2 } });
    OfflineQueue.enqueue({ sheet: 'الخصوم', action: 'add', row: { id: 3 } });
    postedCalls.length = 0;
    await OfflineQueue.replay();
    assert.deepStrictEqual(postedCalls.map(c => c.sheet), ['القضايا', 'الموكلين', 'الخصوم']);
  });

  await check('replay(): a mid-list failure stops the loop, preserving unsent order (does not skip ahead or reorder)', async () => {
    OfflineQueue.enqueue({ sheet: 'A', action: 'add', row: {} });
    OfflineQueue.enqueue({ sheet: 'B', action: 'add', row: {} });
    OfflineQueue.enqueue({ sheet: 'C', action: 'add', row: {} });

    let callCount = 0;
    const originalPost = global.ApiService._post;
    global.ApiService._post = async function (body) {
      callCount++;
      if (callCount === 2) throw new Error('simulated mid-list failure');
      postedCalls.push(body);
      return { ok: true };
    };
    postedCalls.length = 0;

    await OfflineQueue.replay();

    assert.deepStrictEqual(postedCalls.map(c => c.sheet), ['A'], 'only the first item should have gone through before the failure');
    assert.strictEqual(OfflineQueue.size(), 2, 'B and C must remain queued, in order');

    global.ApiService._post = originalPost;
    // drain for subsequent tests
    postedCalls.length = 0;
    await OfflineQueue.replay();
    assert.strictEqual(OfflineQueue.size(), 0);
  });

  // ---- 2. CASES_RELATIONSHIP_FINANCIAL: new entities need zero special-casing ----

  await check('enqueue()/replay(): a قضية_موكلين (CaseClientsRepository) write is queued and replayed via the EXACT SAME generic path as every existing entity — no special-casing required', async () => {
    OfflineQueue.enqueue({ sheet: 'قضية_موكلين', action: 'add', row: { 'رقم_القضية': '2025/1001', 'رقم_الموكل': 'CL1', 'الصفة': 'موكل بالقضية' } });
    postedCalls.length = 0;
    await OfflineQueue.replay();
    assert.strictEqual(postedCalls.length, 1);
    assert.strictEqual(postedCalls[0].sheet, 'قضية_موكلين');
    assert.strictEqual(OfflineQueue.size(), 0);
  });

  await check('enqueue()/replay(): a المصروفات (ExpensesRepository) write is queued and replayed via the EXACT SAME generic path as every existing entity — no special-casing required', async () => {
    OfflineQueue.enqueue({ sheet: 'المصروفات', action: 'add', row: { 'النطاق': 'قضية', 'رقم_القضية': '2025/1001', 'المبلغ': '500' } });
    postedCalls.length = 0;
    await OfflineQueue.replay();
    assert.strictEqual(postedCalls.length, 1);
    assert.strictEqual(postedCalls[0].sheet, 'المصروفات');
    assert.strictEqual(OfflineQueue.size(), 0);
  });

  await check('replay(): a mixed batch (old entities + both new entities together) preserves FIFO order across all of them equally', async () => {
    OfflineQueue.enqueue({ sheet: 'الجلسات', action: 'add', row: {} });
    OfflineQueue.enqueue({ sheet: 'قضية_موكلين', action: 'add', row: {} });
    OfflineQueue.enqueue({ sheet: 'المصروفات', action: 'add', row: {} });
    OfflineQueue.enqueue({ sheet: 'الأتعاب', action: 'add', row: {} });
    postedCalls.length = 0;
    await OfflineQueue.replay();
    assert.deepStrictEqual(postedCalls.map(c => c.sheet), ['الجلسات', 'قضية_موكلين', 'المصروفات', 'الأتعاب']);
  });

  // ---- 3. Persistence across "reload" (queue survives via localStorage) ----

  await check('enqueue(): the queue is durably persisted to localStorage, not just held in memory', () => {
    OfflineQueue.enqueue({ sheet: 'test-persistence', action: 'add', row: {} });
    const raw = global.localStorage.getItem('__ahp_offline_write_queue__');
    assert.ok(raw, 'expected something written to localStorage');
    const parsed = JSON.parse(raw);
    assert.ok(parsed.some(e => e.payload.sheet === 'test-persistence'));
    // drain for a clean final state
    return OfflineQueue.replay();
  });

  console.log('\n' + passed + '/' + (passed + failed) + ' checks passed.');
  if (failed > 0) {
    console.log('\n' + failed + ' CHECK(S) FAILED.');
    process.exit(1);
  } else {
    console.log('\nALL CHECKS PASSED.');
    process.exit(0);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
