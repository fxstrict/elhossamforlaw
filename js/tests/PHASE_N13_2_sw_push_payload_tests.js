/**
 * ================================================================
 * PHASE_N13_2_sw_push_payload_tests.js — نظام الحسام للمحاماة
 * ================================================================
 * Executes the REAL 'push' and 'notificationclick' handlers from
 * service-worker.js (extracted from the source, not re-implemented)
 * against the payload shape Firebase Cloud Messaging actually delivers
 * to a raw Web Push handler:
 *
 *     { from, fcmMessageId, notification:{title,body}, data:{k:v,...} }
 *
 * i.e. the custom `data` keys sent by Config/10_Fcm.gs (page,
 * projectId, entityType, entityId, entityAction, notificationId) are
 * NESTED under `data` — verified against the Firebase JS SDK source
 * (@firebase/messaging MessagePayloadInternal: `data?: unknown` beside
 * `notification?`; onPush -> payload.data = messagePayloadInternal.data).
 *
 * Run: node js/tests/PHASE_N13_2_sw_push_payload_tests.js
 * ================================================================
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const swSrc = fs.readFileSync(path.join(__dirname, '..', '..', 'service-worker.js'), 'utf8');

let passed = 0, failed = 0;
async function check(label, fn) {
  try { await fn(); passed++; console.log('PASS - ' + label); }
  catch (e) { failed++; console.log('FAIL - ' + label + '  =>  ' + e.message); }
}

/** Extracts `self.addEventListener('<type>', function (event) {...});` by brace counting. */
function extractListener(type) {
  const marker = "self.addEventListener('" + type + "'";
  const start = swSrc.indexOf(marker);
  if (start === -1) throw new Error('listener not found: ' + type);
  let i = swSrc.indexOf('{', swSrc.indexOf('function', start));
  let depth = 0;
  for (; i < swSrc.length; i++) {
    if (swSrc[i] === '{') depth++;
    else if (swSrc[i] === '}') { depth--; if (depth === 0) break; }
  }
  const end = swSrc.indexOf(');', i) + 2;
  return swSrc.slice(start, end);
}

function makeSelf() {
  const handlers = {};
  const shown = [];
  const posted = [];
  const opened = [];
  const self = {
    addEventListener: function (t, fn) { handlers[t] = fn; },
    registration: { showNotification: function (title, opts) { shown.push({ title: title, opts: opts }); return Promise.resolve(); } },
    clients: {
      matchAll: function () { return Promise.resolve([{ postMessage: function (m) { posted.push(m); }, focus: function () { return Promise.resolve(); } }]); },
      openWindow: function (u) { opened.push(u); return Promise.resolve(); }
    }
  };
  vm.runInNewContext(extractListener('push') + '\n' + extractListener('notificationclick'), { self: self });
  return { handlers: handlers, shown: shown, posted: posted, opened: opened };
}

function pushEvent(payload) {
  let waited = null;
  return {
    data: { json: function () { return payload; } },
    waitUntil: function (p) { waited = p; },
    _done: function () { return waited; }
  };
}

// The exact wire shape: what Config/10_Fcm.gs sends -> what the SW receives.
const FCM_PAYLOAD = {
  from: '1047569999711',
  fcmMessageId: 'm1',
  notification: { title: 'قضية جديدة', body: 'تم تسجيل قضية جديدة إلى النظام' },
  data: { page: 'cases', projectId: 'hossam_02', entityType: 'القضايا', entityId: 'C-1', entityAction: 'add', notificationId: 'n-1', timestamp: 't' }
};

(async function main() {
  const w = makeSelf();

  const ev = pushEvent(FCM_PAYLOAD);
  w.handlers.push(ev);
  await ev._done();
  const n = w.shown[0];

  await check('S1.1 title/body still come from notification.{title,body}', () => {
    assert.strictEqual(n.title, 'قضية جديدة');
    assert.strictEqual(n.opts.body, 'تم تسجيل قضية جديدة إلى النظام');
  });

  await check('S1.2 data.page is read from the NESTED data object (so tapping opens the right page)', () => {
    assert.strictEqual(n.opts.data.page, 'cases');
  });

  await check('S1.3 data.projectId is read from the nested data (required for the post-tap SyncCoordinator sync)', () => {
    assert.strictEqual(n.opts.data.projectId, 'hossam_02');
  });

  await check('S1.4 entityType / entityId / entityAction / notificationId are all preserved', () => {
    assert.strictEqual(n.opts.data.entityType, 'القضايا');
    assert.strictEqual(n.opts.data.entityId, 'C-1');
    assert.strictEqual(n.opts.data.entityAction, 'add');
    assert.strictEqual(n.opts.data.notificationId, 'n-1');
  });

  await check('S1.5 tapping the notification relays page + projectId to the app (end-to-end through the real notificationclick handler)', async () => {
    // PHASE N.13.7 STEP 3 — UPDATED, not a functional regression: the SAME
    // push event this test already fired above (line 89) now ALSO posts an
    // AHP_PUSH_RECEIVED message to this mock's single open-window client
    // (service-worker.js's new, independent event.waitUntil() bridge — see
    // PHASE_N13_7_step3_push_bridge_tests.js T1/T2 for that behavior's own
    // dedicated coverage). That is the CORRECT, intended new behavior, not
    // a bug: w.posted already has exactly 1 entry (the push-bridge message)
    // BEFORE any click happens here. This test's original assertion
    // (`posted.length === 1`) implicitly assumed push never touches
    // `posted` — an assumption N.13.7 intentionally changes. The fix below
    // asserts on the LAST posted message specifically (what clicking
    // itself produces), which is what this test actually intends to prove,
    // while also explicitly confirming the pre-click push message is
    // exactly what N.13.7 promises (so this interaction stays honestly
    // documented here rather than silently tolerated).
    assert.strictEqual(w.posted.length, 1, 'the push event itself (fired above) is expected to have already posted exactly one AHP_PUSH_RECEIVED message — see PHASE N.13.7');
    assert.strictEqual(w.posted[0].type, 'AHP_PUSH_RECEIVED');
    const postedBeforeClick = w.posted.length;
    let waited = null;
    w.handlers.notificationclick({ notification: { close: function () {}, data: n.opts.data }, waitUntil: function (p) { waited = p; } });
    await waited;
    assert.strictEqual(w.posted.length, postedBeforeClick + 1, 'clicking must post exactly one MORE message (its own), on top of whatever push already posted');
    const clickMsg = w.posted[w.posted.length - 1];
    assert.strictEqual(clickMsg.type, 'AHP_NOTIFICATION_CLICK');
    assert.strictEqual(clickMsg.page, 'cases');
    assert.strictEqual(clickMsg.projectId, 'hossam_02');
  });

  // Backward compatibility: flat (legacy / hand-crafted) payloads keep working.
  const w2 = makeSelf();
  const ev2 = pushEvent({ title: 'قديم', body: 'نص', page: 'sessions', projectId: 'p' });
  w2.handlers.push(ev2);
  await ev2._done();
  await check('S2.1 a legacy flat payload (no nested data) still resolves title/body/page/projectId', () => {
    const m = w2.shown[0];
    assert.strictEqual(m.title, 'قديم');
    assert.strictEqual(m.opts.body, 'نص');
    assert.strictEqual(m.opts.data.page, 'sessions');
    assert.strictEqual(m.opts.data.projectId, 'p');
  });

  const w3 = makeSelf();
  const ev3 = pushEvent({});
  w3.handlers.push(ev3);
  await ev3._done();
  await check('S2.2 an empty payload still shows the default-title notification and never throws', () => {
    assert.strictEqual(w3.shown[0].title, 'نظام الحسام للمحاماة');
    assert.strictEqual(w3.shown[0].opts.data.page, '');
  });

  const w4 = makeSelf();
  const ev4 = { data: { json: function () { throw new Error('bad json'); } }, waitUntil: function (p) { ev4._p = p; } };
  w4.handlers.push(ev4);
  await ev4._p;
  await check('S2.3 a non-JSON push body is tolerated (default notification, no throw)', () => {
    assert.strictEqual(w4.shown.length, 1);
  });

  console.log('\nPHASE N.13.2 SW push payload: ' + passed + ' PASS / ' + failed + ' FAIL');
  process.exit(failed ? 1 : 0);
})();
