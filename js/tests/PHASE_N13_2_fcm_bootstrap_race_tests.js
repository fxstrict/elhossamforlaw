/**
 * ================================================================
 * PHASE_N13_2_fcm_bootstrap_race_tests.js — نظام الحسام للمحاماة
 * ================================================================
 * The Firebase public config reaches FcmClient only via
 *   pingConnection() (settings.js, fired by index.html 2000 ms after
 *   boot) -> localStorage 'ahp_firebase_config' -> FcmClient.
 * NotificationManager's onAppReady() token registration can run
 * BEFORE that first ping on a device that has never cached the config
 * (first install / cleared storage). Then:
 *   1) FcmClient memoized `Promise.resolve(null)` for the WHOLE page
 *      session even though the config arrived 2 s later, and
 *   2) nothing re-triggered registration once the config existed.
 * => the device stayed unregistered until the next full reload.
 *
 * Runs the REAL FcmClient.js, the REAL pingConnection() extracted from
 * settings.js, and the REAL NotificationManager.js inside jsdom.
 *
 * Run: node js/tests/PHASE_N13_2_fcm_bootstrap_race_tests.js
 * ================================================================
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '..', '..');
function read(rel) { return fs.readFileSync(path.join(ROOT, rel), 'utf8'); }
const fcmClientSrc = read('js/core/pwa/FcmClient.js');
const nmSrc = read('js/core/pwa/NotificationManager.js');
const settingsSrc = read('js/modules/settings.js');

let passed = 0, failed = 0;
async function check(label, fn) {
  try { await fn(); passed++; console.log('PASS - ' + label); }
  catch (e) { failed++; console.log('FAIL - ' + label + '  =>  ' + e.message); }
}
const tick = function (ms) { return new Promise(function (r) { setTimeout(r, ms || 30); }); };

const FIREBASE_CFG = { projectId: 'p', apiKey: 'k', messagingSenderId: 's', appId: 'a', vapidKey: 'v' };
const CFG_KEY = 'ahp_firebase_config';
const EVENT = 'ahp:firebase-config-ready';

function extractAsyncFunction(src, name) {
  const start = src.indexOf('async function ' + name + '(');
  if (start === -1) throw new Error('not found: ' + name);
  let i = src.indexOf('{', start), depth = 0;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) break; }
  }
  return src.slice(start, i + 1);
}

function newDom(html) {
  const dom = new JSDOM('<!doctype html><html><body>' + (html || '') + '</body></html>', { runScripts: 'outside-only', url: 'http://localhost/' });
  const w = dom.window;
  const warns = [];
  w.console.warn = function () { warns.push(Array.prototype.slice.call(arguments).join(' ')); };
  Object.defineProperty(w.navigator, 'serviceWorker', {
    configurable: true,
    value: { ready: new Promise(function () {}), addEventListener: function () {} }
  });
  w.Notification = { permission: 'granted', requestPermission: function () { return Promise.resolve('granted'); } };
  return { w: w, warns: warns };
}

(async function main() {
  // ---------------- A. FcmClient memoization ----------------
  {
    const { w, warns } = newDom();
    w.eval(fcmClientSrc);

    const first = await w.ahpGetFcmToken();
    await check('R1.1 with no cached config, ahpGetFcmToken() resolves null without trying to load the SDK', () => {
      assert.strictEqual(first, null);
      assert.strictEqual(warns.length, 0);
    });

    w.localStorage.setItem(CFG_KEY, JSON.stringify(FIREBASE_CFG)); // <- config arrives later (the 2 s ping)
    await w.ahpGetFcmToken();
    await check('R1.2 once the config exists, the SAME page session retries (does not stay null forever)', () => {
      assert.ok(warns.some(function (m) { return m.indexOf('[FcmClient] Firebase SDK load failed') !== -1; }),
        'expected an SDK load attempt after the config appeared; warns=' + JSON.stringify(warns));
    });
  }

  {
    const { w } = newDom();
    w.localStorage.setItem(CFG_KEY, JSON.stringify(FIREBASE_CFG));
    let attempts = 0;
    w.console.warn = function (m) { if (String(m).indexOf('SDK load failed') !== -1) attempts++; };
    w.eval(fcmClientSrc);
    await w.ahpGetFcmToken();
    await w.ahpGetFcmToken();
    await check('R1.3 with a config present the SDK load is still memoized (attempted once, not per call)', () => {
      assert.strictEqual(attempts, 1, 'attempts=' + attempts);
    });
  }

  // ---------------- B. pingConnection announces a NEW/changed config ----------------
  function pingHarness(pingResponses) {
    const { w } = newDom('<span id="statusDot"></span><span id="statusText"></span>');
    w.API_URL = 'https://example.test/exec';
    let i = 0;
    w.fetch = function () { const r = pingResponses[Math.min(i++, pingResponses.length - 1)]; return Promise.resolve({ json: function () { return Promise.resolve(r); } }); };
    w.AbortSignal = { timeout: function () { return undefined; } };
    const events = [];
    w.addEventListener(EVENT, function () { events.push(w.localStorage.getItem(CFG_KEY)); });
    w.eval(extractAsyncFunction(settingsSrc, 'pingConnection') + '\nwindow.__ping = pingConnection;');
    return { w: w, events: events, ping: function () { return w.__ping(); } };
  }

  {
    const h = pingHarness([{ status: 'ok', version: '1', project_id: 'hossam_02', firebase: FIREBASE_CFG }]);
    await h.ping();
    await check('R2.1 first successful ping that stores a config announces it exactly once', () => {
      assert.strictEqual(h.events.length, 1);
      assert.strictEqual(JSON.parse(h.events[0]).projectId, 'p');
      assert.strictEqual(h.w.localStorage.getItem('ahp_project_id'), 'hossam_02');
    });
    await h.ping();
    await check('R2.2 a later ping returning the SAME config does not re-announce (no duplicate registrations on normal boots)', () => {
      assert.strictEqual(h.events.length, 1);
    });
  }
  {
    const h = pingHarness([
      { status: 'ok', project_id: 'x', firebase: FIREBASE_CFG },
      { status: 'ok', project_id: 'x', firebase: Object.assign({}, FIREBASE_CFG, { vapidKey: 'v2' }) }
    ]);
    await h.ping(); await h.ping();
    await check('R2.3 a CHANGED config (e.g. rotated VAPID key) is announced again', () => {
      assert.strictEqual(h.events.length, 2);
    });
  }
  {
    const h = pingHarness([{ status: 'ok', project_id: 'x', firebase: null }]);
    await h.ping();
    await check('R2.4 a ping with FCM disabled (firebase:null) announces nothing and clears the cached config (unchanged behaviour)', () => {
      assert.strictEqual(h.events.length, 0);
      assert.strictEqual(h.w.localStorage.getItem(CFG_KEY), null);
    });
  }
  {
    const h = pingHarness([{ status: 'error' }]);
    await h.ping();
    await check('R2.5 a failed ping announces nothing', () => { assert.strictEqual(h.events.length, 0); });
  }

  // ---------------- C. NotificationManager re-registers when the config arrives ----------------
  function nmHarness(permission) {
    const { w } = newDom();
    w.Notification.permission = permission;
    const saves = [];
    let readyCb = null;
    w.BootManager = { onReady: function (cb) { readyCb = cb; } };
    w.data = { sessions: [], tasks: [], cases: [], documents: [] };
    w.ahpGetFcmToken = function () { return Promise.resolve('TOKEN-1'); };
    w.ApiService = { saveData: function (sheet, row) { saves.push({ sheet: sheet, row: row }); return Promise.resolve(); } };
    w.eval(nmSrc);
    return { w: w, saves: saves, ready: function () { readyCb && readyCb(); } };
  }

  {
    const h = nmHarness('granted');
    h.ready(); await tick();
    const afterBoot = h.saves.length;
    await check('R3.1 boot registration still runs once when permission is granted (N.4 behaviour preserved)', () => {
      assert.strictEqual(afterBoot, 1);
      assert.strictEqual(h.saves[0].sheet, 'أجهزة_FCM');
      assert.strictEqual(h.saves[0].row.token, 'TOKEN-1');
    });
    h.w.dispatchEvent(new h.w.Event(EVENT)); await tick();
    await check('R3.2 when the Firebase config arrives after boot, the device is registered again (closes the race)', () => {
      assert.strictEqual(h.saves.length, afterBoot + 1);
      assert.strictEqual(h.saves[1].row.status, 'active');
    });
  }
  {
    const h = nmHarness('default');
    h.w.dispatchEvent(new h.w.Event(EVENT)); await tick();
    await check('R3.3 the config-ready event never registers (nor prompts) when permission was not granted', () => {
      assert.strictEqual(h.saves.length, 0);
    });
  }
  {
    const h = nmHarness('denied');
    h.w.dispatchEvent(new h.w.Event(EVENT)); await tick();
    await check('R3.4 ...and never registers when permission is denied', () => { assert.strictEqual(h.saves.length, 0); });
  }

  console.log('\nPHASE N.13.2 FCM bootstrap race: ' + passed + ' PASS / ' + failed + ' FAIL');
  process.exit(failed ? 1 : 0);
})();
