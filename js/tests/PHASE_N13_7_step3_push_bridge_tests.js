'use strict';
/**
 * ================================================================
 * PHASE_N13_7_step3_push_bridge_tests.js — نظام الحسام للمحاماة
 * ================================================================
 * PHASE N.13.7 STEP 3 — "FCM push arrives while the app is already
 * open" bridge: service-worker.js's real 'push' handler now ALSO
 * posts AHP_PUSH_RECEIVED to open windows (independent of
 * showNotification), and js/core/pwa/NotificationManager.js's real
 * message listener now has a second branch that validates projectId
 * and calls SyncCoordinator.requestSync('notification') — reusing the
 * exact single-flight/pending/follow-up machinery PHASE N.13.5 already
 * built and PHASE N.13.6 already exercises.
 *
 * TWO INDEPENDENT GROUPS, mirroring the two files touched:
 *
 *   GROUP A (T1, T2, T10, T11, T12, T13a) — service-worker.js's real
 *   'push' and 'notificationclick' listeners, extracted from source by
 *   brace-counting (same technique as
 *   PHASE_N13_2_sw_push_payload_tests.js) and run in a vm sandbox with
 *   a `self` that records EVERY event.waitUntil() call separately, so
 *   a test can prove showNotification and the new postMessage bridge
 *   are genuinely independent (one failing must never affect the
 *   other).
 *
 *   GROUP B (T3–T9, T13b) — js/core/pwa/NotificationManager.js's real
 *   message listener AND js/core/SyncCoordinator.js's real
 *   requestSync()/shouldSync() logic, both loaded into one jsdom
 *   window (same `(function (global) {...})(window)` / bare-global
 *   loading pattern PHASE_N13_2_fcm_bootstrap_race_tests.js and
 *   PHASE_N13_5_step1_design_d_tests.js already use), driven by a
 *   controllable fake SyncEngine — so T6/T7/T8 observe REAL N.13.5
 *   single-flight/pending/follow-up behavior, not a re-implemented
 *   stub of it.
 *
 * STATIC/MOCK VERIFIED only — no real Firebase project, no real
 * Android device, no real Service Worker registration, no IndexedDB,
 * no network. See each group's own further disclaimers below.
 *
 * Run: node js/tests/PHASE_N13_7_step3_push_bridge_tests.js
 * ================================================================
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '..', '..');
function read(rel) { return fs.readFileSync(path.join(ROOT, rel), 'utf8'); }
const swSrc = read('service-worker.js');
const nmSrc = read('js/core/pwa/NotificationManager.js');
const scSrc = read('js/core/SyncCoordinator.js');

let passed = 0, failed = 0;
async function check(label, fn) {
  try { const r = await fn(); if (r === false) throw new Error('assertion returned false'); passed++; console.log('PASS - ' + label); }
  catch (e) { failed++; console.log('FAIL - ' + label + '  =>  ' + (e && e.message || e)); }
}

// ==================================================================
// GROUP A — service-worker.js real listeners
// ==================================================================

/** Extracts `self.addEventListener('<type>', function (event) {...});` by brace counting (same technique as PHASE_N13_2_sw_push_payload_tests.js). */
function extractListener(type) {
  const marker = "self.addEventListener('" + type + "'";
  const start = swSrc.indexOf(marker);
  if (start === -1) throw new Error('listener not found in service-worker.js: ' + type);
  let i = swSrc.indexOf('{', swSrc.indexOf('function', start));
  let depth = 0;
  for (; i < swSrc.length; i++) {
    if (swSrc[i] === '{') depth++;
    else if (swSrc[i] === '}') { depth--; if (depth === 0) break; }
  }
  const end = swSrc.indexOf(');', i) + 2;
  return swSrc.slice(start, end);
}

/**
 * @param {Array<{postMessage?:Function, focus?:Function}>} clientList clients self.clients.matchAll() should resolve with
 * @param {object} opts { failMatchAll?: boolean }
 */
function makeSelf(clientList, opts) {
  opts = opts || {};
  const handlers = {};
  const shown = [];
  const waits = []; // every event.waitUntil(promise) call, kept SEPARATE so independence can be asserted
  const opened = [];
  const matchAllCalls = [];
  const self = {
    addEventListener: function (t, fn) { handlers[t] = fn; },
    registration: { showNotification: function (title, o) { shown.push({ title: title, opts: o }); return Promise.resolve(); } },
    clients: {
      matchAll: function (options) {
        matchAllCalls.push(options);
        if (opts.failMatchAll) return Promise.reject(new Error('simulated clients.matchAll() failure'));
        return Promise.resolve(clientList || []);
      },
      openWindow: function (u) { opened.push(u); return Promise.resolve(); }
    }
  };
  vm.runInNewContext(extractListener('push') + '\n' + extractListener('notificationclick'), { self: self, console: console });
  return { handlers: handlers, shown: shown, waits: waits, opened: opened, matchAllCalls: matchAllCalls };
}

function makeClient(id, opts) {
  opts = opts || {};
  const posted = [];
  return {
    id: id, posted: posted,
    postMessage: function (m) {
      if (opts.throws) throw new Error('simulated postMessage failure on client ' + id);
      posted.push(m);
    },
    focus: function () { return Promise.resolve(); }
  };
}

function pushEvent(payload) {
  const waits = [];
  return {
    _waits: waits,
    data: { json: function () { return payload; } },
    waitUntil: function (p) { waits.push(p); }
  };
}

const FCM_PAYLOAD = {
  from: '1047569999711', fcmMessageId: 'm1',
  notification: { title: 'قضية جديدة', body: 'تم تسجيل قضية جديدة إلى النظام' },
  data: { page: 'cases', projectId: 'hossam_02', entityType: 'القضايا', entityId: 'C-1', entityAction: 'add', notificationId: 'n-1', timestamp: 't' }
};

(async function main() {
  console.log('=== GROUP A — service-worker.js push -> open-window bridge (real, extracted listeners) ===');

  // ---------------- T1: message emitted, notification still shown ----------------
  {
    const clientA = makeClient('A');
    const w = makeSelf([clientA]);
    const ev = pushEvent(FCM_PAYLOAD);
    w.handlers.push(ev);
    await check('T1a: push handler registers TWO independent waitUntil() calls (notification + bridge, not one combined)', () => ev._waits.length === 2);
    await Promise.all(ev._waits);
    await check('T1b: system notification is still shown', () => w.shown.length === 1 && w.shown[0].title === 'قضية جديدة');
    await check('T1c: AHP_PUSH_RECEIVED is posted to the open window', () => clientA.posted.length === 1 && clientA.posted[0].type === 'AHP_PUSH_RECEIVED');
  }

  // ---------------- T2: correct message payload mapping ----------------
  {
    const clientA = makeClient('A');
    const w = makeSelf([clientA]);
    const ev = pushEvent(FCM_PAYLOAD);
    w.handlers.push(ev);
    await Promise.all(ev._waits);
    const msg = clientA.posted[0];
    await check('T2: AHP_PUSH_RECEIVED carries the correct projectId/page/entityType/entityAction/notificationId from the real nested FCM payload', () =>
      msg.type === 'AHP_PUSH_RECEIVED' &&
      msg.projectId === 'hossam_02' &&
      msg.page === 'cases' &&
      msg.entityType === 'القضايا' &&
      msg.entityAction === 'add' &&
      msg.notificationId === 'n-1'
    );
  }

  // ---------------- T10: postMessage failure must not affect showNotification ----------------
  {
    const throwingClient = makeClient('A', { throws: true });
    const w = makeSelf([throwingClient]);
    const ev = pushEvent(FCM_PAYLOAD);
    w.handlers.push(ev);
    // The two waitUntil promises are independent; await the notification one directly,
    // and separately prove the bridge one does not reject (it .catch()es internally).
    await check('T10a: showNotification promise resolves fine even though the client throws on postMessage', async () => {
      await ev._waits[0]; // showNotification's own waitUntil
      return w.shown.length === 1;
    });
    await check('T10b: the bridge waitUntil promise itself does not reject (internal .catch), so it never surfaces as an unhandled rejection', async () => {
      await ev._waits[1]; // must not throw
      return true;
    });
  }
  {
    // Same guarantee when clients.matchAll() itself rejects (no clients reachable at all).
    const w = makeSelf(null, { failMatchAll: true });
    const ev = pushEvent(FCM_PAYLOAD);
    w.handlers.push(ev);
    await check('T10c: clients.matchAll() rejecting entirely still leaves showNotification unaffected', async () => {
      await ev._waits[0];
      await ev._waits[1]; // must not throw despite matchAll() rejecting
      return w.shown.length === 1;
    });
  }

  // ---------------- T11: Service Worker never calls sync directly (static source check) ----------------
  function stripComments(src) {
    // Strips /* */ and // comments so prose EXPLAINING the architecture
    // (this file's own header comments legitimately mention
    // "SyncCoordinator.requestSync" as documentation of where the app
    // page performs the sync) is not mistaken for actual executable code.
    return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
  }
  await check('T11: service-worker.js contains no ACTUAL CODE call to SyncCoordinator/SyncEngine/Repository/apiSyncSheet/requestSync — comment-only mentions in this file\'s own architecture documentation do not count', () => {
    const codeOnly = stripComments(swSrc);
    const forbidden = ['SyncCoordinator.', 'SyncEngine.', 'Repository.', 'apiSyncSheet', '.requestSync('];
    const hits = forbidden.filter((f) => codeOnly.indexOf(f) !== -1);
    if (hits.length) throw new Error('forbidden direct-sync reference(s) found in service-worker.js CODE (not comments): ' + hits.join(', '));
    return true;
  });
  await check('T11b: the new bridge code itself only calls clients.matchAll()/postMessage() — no fetch() added near it', () => {
    const start = swSrc.indexOf('AHP_PUSH_RECEIVED');
    const blockEnd = swSrc.indexOf('});', start);
    const block = swSrc.slice(Math.max(0, start - 400), blockEnd);
    return block.indexOf('fetch(') === -1;
  });

  // ---------------- T12: existing notificationclick behavior preserved ----------------
  {
    const w = makeSelf([]);
    let waited = null;
    w.handlers.notificationclick({ notification: { close: function () {}, data: { page: 'cases', projectId: 'hossam_02' } }, waitUntil: function (p) { waited = p; } });
    await waited;
    await check('T12a: notificationclick with no open window still calls clients.openWindow with the page hash (unchanged)', () => w.opened.length === 1 && w.opened[0] === './#cases');
  }
  {
    const clientA = makeClient('A');
    const w = makeSelf([clientA]);
    let waited = null;
    w.handlers.notificationclick({ notification: { close: function () {}, data: { page: 'cases', projectId: 'hossam_02' } }, waitUntil: function (p) { waited = p; } });
    await waited;
    await check('T12b: notificationclick with an open window posts AHP_NOTIFICATION_CLICK (unchanged type, unchanged shape) and focuses it', () =>
      clientA.posted.length === 1 && clientA.posted[0].type === 'AHP_NOTIFICATION_CLICK' && clientA.posted[0].page === 'cases' && clientA.posted[0].projectId === 'hossam_02'
    );
  }

  // ---------------- T13a: multiple open windows all receive the push message ----------------
  {
    const clientA = makeClient('A'), clientB = makeClient('B'), clientC = makeClient('C');
    const w = makeSelf([clientA, clientB, clientC]);
    const ev = pushEvent(FCM_PAYLOAD);
    w.handlers.push(ev);
    await Promise.all(ev._waits);
    await check('T13a: ALL open windows receive AHP_PUSH_RECEIVED (not just the first, unlike notificationclick\'s single-client focus behavior)', () =>
      clientA.posted.length === 1 && clientB.posted.length === 1 && clientC.posted.length === 1
    );
    await check('T13a-2: matchAll was called with includeUncontrolled:true (a just-opened, not-yet-controlled tab must still be reached)', () =>
      w.matchAllCalls[w.matchAllCalls.length - 1].includeUncontrolled === true
    );
  }
})().then(async () => {

// ==================================================================
// GROUP B — NotificationManager.js real message handler +
// SyncCoordinator.js real requestSync()/shouldSync() logic, in jsdom
// ==================================================================
console.log('\n=== GROUP B — NotificationManager -> SyncCoordinator integration (real SyncCoordinator.js in jsdom) ===');

function tick() { return new Promise((r) => setTimeout(r, 0)); }

/**
 * Loads BOTH js/core/SyncCoordinator.js (real, unmodified by N.13.7) and
 * js/core/pwa/NotificationManager.js (real, N.13.7-modified) into one
 * jsdom window, with a controllable fake SyncEngine wired to the REAL
 * SyncCoordinator — same gate-based determinism technique
 * PHASE_N13_5_step1_design_d_tests.js proved necessary (bounded
 * tick-count polling was flaky under this sandbox's single-core CPU
 * contention; a resolvable "gate" per call is not).
 */
function makeIntegrationEnv(opts) {
  opts = opts || {};
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { runScripts: 'outside-only', url: 'http://localhost/' });
  const w = dom.window;
  const warns = [];
  w.console.warn = function () { warns.push(Array.prototype.slice.call(arguments).join(' ')); };

  let messageHandler = null;
  Object.defineProperty(w.navigator, 'serviceWorker', {
    configurable: true,
    value: {
      ready: new Promise(function () {}), // never resolves — token registration is irrelevant here
      addEventListener: function (type, fn) { if (type === 'message') messageHandler = fn; }
    }
  });
  w.Notification = { permission: 'granted', requestPermission: () => Promise.resolve('granted') };
  w.BootManager = { onReady: function () {} }; // no boot registration needed for these tests
  w.data = { sessions: [], tasks: [], cases: [], documents: [] };

  if (opts.projectId !== undefined) w.localStorage.setItem('ahp_project_id', opts.projectId);

  // --- real SyncCoordinator.js, driven by a controllable fake SyncEngine ---
  const calls = { runIncrementalAndPersist: 0 };
  const gates = {};
  Object.defineProperty(w.navigator, 'onLine', { configurable: true, get: function () { return _onLine; } });
  let _onLine = (opts.onLine !== undefined) ? opts.onLine : true;
  w.SyncCheckpoint = { get: () => 'C1' };
  w.SyncEngine = {
    SYNC_ENTITY_PAIRS: [['SHEET_A', 'a']],
    runIncrementalSyncAndPersist: async function () {
      calls.runIncrementalAndPersist++;
      const idx = calls.runIncrementalAndPersist;
      if (opts.gateCalls && opts.gateCalls.indexOf(idx) !== -1) {
        await new Promise((res) => { gates[idx] = res; });
      }
      if (opts.resultForCall) return opts.resultForCall(idx);
      return { status: 'success', results: [], succeeded: 1, failed: 0 };
    },
    bootIncrementalSync: async function () { return undefined; }
  };
  w.OfflineQueue = { replay: async function () { return undefined; } };

  w.eval(scSrc); // defines w.SyncCoordinator
  w.eval(nmSrc); // defines w.handleNotifToggleChange etc. AND registers the real message listener via navigator.serviceWorker.addEventListener('message', ...)

  return {
    w: w, warns: warns, calls: calls,
    releaseGate: (idx) => { if (gates[idx]) { gates[idx](); delete gates[idx]; } },
    sendPush: (data) => { if (!messageHandler) throw new Error('NotificationManager did not register a message listener'); messageHandler({ data: Object.assign({ type: 'AHP_PUSH_RECEIVED' }, data) }); },
    getSyncState: () => w.SyncCoordinator.getState(),
    setOnline: (v) => { _onLine = v; }
  };
}

const VALID_PUSH = { projectId: 'hossam_02', page: 'cases', entityType: 'القضايا', entityAction: 'add', notificationId: 'n-1' };

(async () => {
  // ---------------- T3: open window receives the message and reacts ----------------
  {
    const env = makeIntegrationEnv({ projectId: 'hossam_02' });
    env.sendPush(VALID_PUSH);
    await tick(); await tick();
    await check('T3: a valid AHP_PUSH_RECEIVED message reaches NotificationManager and triggers a real SyncCoordinator sync', () => env.calls.runIncrementalAndPersist === 1);
  }

  // ---------------- T4: wrong project must NOT trigger sync ----------------
  {
    const env = makeIntegrationEnv({ projectId: 'hossam_02' });
    env.sendPush(Object.assign({}, VALID_PUSH, { projectId: 'some-other-project' }));
    await tick(); await tick();
    await check('T4: a message for a DIFFERENT projectId is ignored (no sync, matches the existing AHP_NOTIFICATION_CLICK guard)', () =>
      env.calls.runIncrementalAndPersist === 0 && env.warns.some((m) => /different project/.test(m))
    );
  }
  {
    const env = makeIntegrationEnv({}); // no stored ahp_project_id at all yet
    env.sendPush(VALID_PUSH);
    await tick(); await tick();
    await check('T4b: with no locally-known project yet, a message WITH a projectId is still accepted (nothing to conflict with — same as the click branch)', () => env.calls.runIncrementalAndPersist === 1);
  }
  {
    const env = makeIntegrationEnv({ projectId: 'hossam_02' });
    env.sendPush(Object.assign({}, VALID_PUSH, { projectId: '' }));
    await tick(); await tick();
    await check('T4c: a message with NO projectId at all is ignored outright (nothing to validate)', () => env.calls.runIncrementalAndPersist === 0);
  }

  // ---------------- T5: valid project triggers exactly requestSync('notification') ----------------
  {
    const env = makeIntegrationEnv({ projectId: 'hossam_02' });
    env.sendPush(VALID_PUSH);
    await tick(); await tick();
    await check('T5: SyncCoordinator state reflects a real notification-reason sync actually ran', () => env.getSyncState().lastReason === 'notification' && env.getSyncState().status === 'success');
  }

  // ---------------- T6: recent successful sync does not suppress the push-triggered sync (N.13.5 integration) ----------------
  {
    const env = makeIntegrationEnv({ projectId: 'hossam_02' });
    await env.w.SyncCoordinator.requestSync('resume'); // a recent, successful, unrelated sync
    const before = env.calls.runIncrementalAndPersist;
    env.sendPush(VALID_PUSH);
    await tick(); await tick();
    await check('T6: a push arriving right after a recent successful sync still triggers a real sync (TTL bypass via N.13.5 Design D, not re-implemented here)', () =>
      env.calls.runIncrementalAndPersist === before + 1
    );
  }

  // ---------------- T7: notification during an in-flight sync must not create a concurrent sync ----------------
  {
    const env = makeIntegrationEnv({ projectId: 'hossam_02', gateCalls: [1] });
    const resumeDone = env.w.SyncCoordinator.requestSync('resume'); // call #1 begins, gated
    await new Promise((resolve) => { (function poll() { env.calls.runIncrementalAndPersist >= 1 ? resolve() : setImmediate(poll); })(); });
    env.sendPush(VALID_PUSH); // arrives WHILE call #1 is still in flight
    await tick(); await tick();
    const stillOne = env.calls.runIncrementalAndPersist === 1;
    env.releaseGate(1);
    await resumeDone;
    await tick(); await tick();
    await check('T7: the push during an in-flight sync does not start a second CONCURRENT sync (still 1 while running)', () => stillOne);
    await check('T7b: it is instead handled as a real N.13.5 follow-up once the in-flight sync completes (2 total, not 1 lost)', () => env.calls.runIncrementalAndPersist === 2);
  }

  // ---------------- T8: multiple rapid pushes respect N.13.5's follow-up cap (bounded, no throttling re-implemented here) ----------------
  {
    const env = makeIntegrationEnv({ projectId: 'hossam_02', gateCalls: [1, 2] });
    env.sendPush(VALID_PUSH); // call #1 (initial), gated
    await new Promise((resolve) => { (function poll() { env.calls.runIncrementalAndPersist >= 1 ? resolve() : setImmediate(poll); })(); });
    for (let i = 0; i < 5; i++) env.sendPush(VALID_PUSH); // all join the in-flight chain
    env.releaseGate(1); // -> follow-up #1 = call #2, also gated
    await new Promise((resolve) => { (function poll() { env.calls.runIncrementalAndPersist >= 2 ? resolve() : setImmediate(poll); })(); });
    for (let i = 0; i < 5; i++) env.sendPush(VALID_PUSH); // arrive during follow-up #1
    env.releaseGate(2); // -> follow-up #2 = call #3, ungated
    await tick(); await tick(); await tick();
    await check('T8: rapid repeated pushes are bounded at initial + 2 follow-ups (max 3 real sync executions) — no NotificationManager-side throttling was added; N.13.5\'s existing cap alone handles it', () =>
      env.calls.runIncrementalAndPersist === 3
    );
  }

  // ---------------- T9: push arriving while offline — pending survives, existing online path consumes it ----------------
  {
    const env = makeIntegrationEnv({ projectId: 'hossam_02', onLine: false });
    env.sendPush(VALID_PUSH);
    await tick(); await tick();
    await check('T9a: while offline, the push is received and requestSync is still called (SyncCoordinator itself handles the offline guard, not NotificationManager)', () =>
      env.getSyncState().status === 'offline' && env.getSyncState().hasPendingNotification === true
    );
    env.setOnline(true);
    const r = await env.w.SyncCoordinator.requestSync('online'); // the EXISTING online-recovery mechanism — not a new one
    await check('T9b: once connectivity returns, the EXISTING online mechanism consumes the pending notification and syncs (no new offline mechanism added)', () =>
      r.skipped !== true && env.calls.runIncrementalAndPersist === 1 && env.getSyncState().hasPendingNotification === false
    );
  }

  // ---------------- T13b: multiple windows each independently request sync (no new cross-window lock invented) ----------------
  {
    const envA = makeIntegrationEnv({ projectId: 'hossam_02' });
    const envB = makeIntegrationEnv({ projectId: 'hossam_02' }); // a SEPARATE jsdom window = a separate tab's own module instance
    envA.sendPush(VALID_PUSH);
    envB.sendPush(VALID_PUSH);
    await tick(); await tick();
    await check('T13b: two independent open-window instances each independently ran their own sync (matches this codebase\'s existing per-tab SyncCoordinator singleton — no BroadcastChannel/SharedWorker exists to coordinate them, by design, same as resume/online/boot already work today)', () =>
      envA.calls.runIncrementalAndPersist === 1 && envB.calls.runIncrementalAndPersist === 1
    );
  }

  // ---------------- Static check: NotificationManager never calls sync internals directly ----------------
  await check('Static: NotificationManager.js\'s AHP_PUSH_RECEIVED branch calls ONLY SyncCoordinator.requestSync — no direct SyncEngine/Repository/ApiService/fetch call near it', () => {
    const start = nmSrc.indexOf('AHP_PUSH_RECEIVED');
    const branchEnd = nmSrc.indexOf('}\n    });', start);
    const block = nmSrc.slice(start, branchEnd);
    const forbidden = ['SyncEngine.', 'Repository.', 'ApiService.', 'fetch('];
    const hits = forbidden.filter((f) => block.indexOf(f) !== -1);
    if (hits.length) throw new Error('forbidden direct call(s) found: ' + hits.join(', '));
    return block.indexOf('SyncCoordinator.requestSync') !== -1;
  });

  console.log('\nPHASE N.13.7 STEP 3: ' + passed + ' PASS / ' + failed + ' FAIL');
  process.exit(failed ? 1 : 0);
})();
});
