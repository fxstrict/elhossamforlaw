/**
 * ================================================================
 * PHASE_N13_2_notif_category_toggles_tests.js — نظام الحسام للمحاماة
 * ================================================================
 * index.html (#notificationsCard) has three category checkboxes
 * (#notifCatSessions / #notifCatTasks / #notifCatCases) whose
 * onchange calls handleNotifCategoryToggleChange(checkbox, category).
 * That function did not exist anywhere, and refreshSettingsCardUI()
 * never restored their state, so a tick was lost on every reload
 * ("أعلّم على الاختيارات، أعمل Refresh، العلامات تختفي").
 *
 * This suite loads the REAL js/core/pwa/NotificationManager.js into
 * jsdom next to the REAL checkbox markup taken verbatim from
 * index.html, and simulates a browser Refresh by carrying the
 * localStorage content over to a brand-new page instance.
 *
 * Run: node js/tests/PHASE_N13_2_notif_category_toggles_tests.js
 * ================================================================
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '..', '..');
const nmSrc = fs.readFileSync(path.join(ROOT, 'js/core/pwa/NotificationManager.js'), 'utf8');
const indexHtml = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

let passed = 0, failed = 0;
async function check(label, fn) {
  try { await fn(); passed++; console.log('PASS - ' + label); }
  catch (e) { failed++; console.log('FAIL - ' + label + '  =>  ' + e.message); }
}

// Real markup: the notificationsCard block exactly as shipped in index.html.
function realCardMarkup() {
  const start = indexHtml.indexOf('id="notificationsCard"');
  assert.ok(start !== -1, 'notificationsCard markup not found in index.html');
  const open = indexHtml.lastIndexOf('<div', start);
  // Card ends before the next settings pane comment.
  const end = indexHtml.indexOf('<!-- ============== تبويب 4', start);
  return indexHtml.slice(open, end);
}

const CARD = realCardMarkup();

function todayKey() {
  const n = new Date();
  const p = function (x) { return String(x).padStart(2, '0'); };
  return n.getFullYear() + '-' + p(n.getMonth() + 1) + '-' + p(n.getDate());
}

async function openPage(persistedLocalStorage) {
  const dom = new JSDOM('<!doctype html><html><body>' + CARD + '</body></html>', { runScripts: 'outside-only', url: 'http://localhost/' });
  const w = dom.window;
  const shown = [];
  let readyCb = null;
  Object.keys(persistedLocalStorage || {}).forEach(function (k) { w.localStorage.setItem(k, persistedLocalStorage[k]); });
  w.Notification = { permission: 'granted', requestPermission: function () { return Promise.resolve('granted'); } };
  Object.defineProperty(w.navigator, 'serviceWorker', {
    configurable: true,
    value: {
      ready: Promise.resolve({ showNotification: function (title, opts) { shown.push({ title: title, tag: opts.tag }); return Promise.resolve(); } }),
      addEventListener: function () {}
    }
  });
  w.BootManager = { onReady: function (cb) { readyCb = cb; } };
  w.data = {
    sessions: [{ 'التاريخ': todayKey(), 'الوقت': '', 'عنوان_القضية': 'قضية أ' }],
    tasks: [{ 'الحالة': 'open', 'الموعد_النهائي': '2000-01-01' }],
    cases: [{ 'الحالة': 'نشطة', 'رقم_القضية': 'C1', 'اسم_الخصم': '' }],
    documents: []
  };
  w.eval(nmSrc);
  await new Promise(function (r) { setTimeout(r, 20); });
  return {
    w: w, shown: shown,
    box: function (id) { return w.document.getElementById(id); },
    storage: function () { const o = {}; for (let i = 0; i < w.localStorage.length; i++) { const k = w.localStorage.key(i); o[k] = w.localStorage.getItem(k); } return o; },
    fireAppReady: function () { if (readyCb) readyCb(); },
    tick: function () { return new Promise(function (r) { setTimeout(r, 30); }); }
  };
}

function tags(p) { return p.shown.map(function (s) { return s.tag; }).sort(); }

(async function main() {
  // ---------- defaults ----------
  {
    const p = await openPage();
    await check('T1.1 the markup really contains the 3 checkboxes wired to handleNotifCategoryToggleChange', () => {
      ['notifCatSessions', 'notifCatTasks', 'notifCatCases'].forEach(function (id) {
        const el = p.box(id);
        assert.ok(el, id + ' missing');
        assert.ok(/handleNotifCategoryToggleChange/.test(el.getAttribute('onchange')));
      });
    });
    await check('T1.2 handleNotifCategoryToggleChange exists as a global function', () => {
      assert.strictEqual(typeof p.w.handleNotifCategoryToggleChange, 'function');
    });
    await check('T1.3 with nothing stored, all three categories are ON (index.html: "defaults ON")', () => {
      assert.strictEqual(p.box('notifCatSessions').checked, true);
      assert.strictEqual(p.box('notifCatTasks').checked, true);
      assert.strictEqual(p.box('notifCatCases').checked, true);
    });
    await check('T1.4 nothing is written to storage merely by opening the page', () => {
      assert.ok(!Object.keys(p.storage()).some(function (k) { return /categor/i.test(k); }));
    });
  }

  // ---------- persistence across Refresh ----------
  {
    const p1 = await openPage();
    const cb = p1.box('notifCatSessions');
    cb.checked = false;
    p1.w.handleNotifCategoryToggleChange(cb, 'sessions');
    const saved = p1.storage();

    await check('T2.1 unticking a category is persisted to device storage', () => {
      assert.ok(Object.keys(saved).some(function (k) { return /categor/i.test(k) && /sessions/i.test(k) && saved[k] === 'false'; }), JSON.stringify(saved));
    });

    const p2 = await openPage(saved); // <- "Refresh"
    await check('T2.2 after Refresh the unticked category is STILL unticked', () => {
      assert.strictEqual(p2.box('notifCatSessions').checked, false);
    });
    await check('T2.3 after Refresh the other two categories are still ticked (independent)', () => {
      assert.strictEqual(p2.box('notifCatTasks').checked, true);
      assert.strictEqual(p2.box('notifCatCases').checked, true);
    });

    const cb2 = p2.box('notifCatSessions');
    cb2.checked = true;
    p2.w.handleNotifCategoryToggleChange(cb2, 'sessions');
    const p3 = await openPage(p2.storage());
    await check('T2.4 re-ticking is persisted too (round trip)', () => {
      assert.strictEqual(p3.box('notifCatSessions').checked, true);
    });
  }

  // ---------- gating of delivery ----------
  {
    const all = await openPage();
    all.fireAppReady(); await all.tick();
    await check('T3.1 baseline: with all categories ON, sessions + tasks + cases alerts are delivered', () => {
      const t = tags(all);
      assert.ok(t.indexOf('ahp-sessions-today') !== -1, t.join(','));
      assert.ok(t.indexOf('ahp-tasks-overdue') !== -1, t.join(','));
      assert.ok(t.indexOf('ahp-cases-no-opponent') !== -1, t.join(','));
      assert.ok(t.indexOf('ahp-cases-no-documents') !== -1, t.join(','));
    });

    const noSess = await openPage({ ahpNotifCategory_sessions: 'false' });
    noSess.fireAppReady(); await noSess.tick();
    await check('T3.2 sessions OFF: no sessions-* alert is delivered, tasks + cases still are', () => {
      const t = tags(noSess);
      assert.ok(!t.some(function (x) { return x.indexOf('ahp-sessions-') === 0; }), t.join(','));
      assert.ok(t.indexOf('ahp-tasks-overdue') !== -1);
      assert.ok(t.indexOf('ahp-cases-no-opponent') !== -1);
    });

    const noTasks = await openPage({ ahpNotifCategory_tasks: 'false' });
    noTasks.fireAppReady(); await noTasks.tick();
    await check('T3.3 tasks OFF: tasks-overdue is suppressed only', () => {
      const t = tags(noTasks);
      assert.ok(t.indexOf('ahp-tasks-overdue') === -1);
      assert.ok(t.indexOf('ahp-sessions-today') !== -1);
      assert.ok(t.indexOf('ahp-cases-no-opponent') !== -1);
    });

    const noCases = await openPage({ ahpNotifCategory_cases: 'false' });
    noCases.fireAppReady(); await noCases.tick();
    await check('T3.4 cases OFF: both incomplete-case alerts are suppressed (no-opponent AND no-documents)', () => {
      const t = tags(noCases);
      assert.ok(t.indexOf('ahp-cases-no-opponent') === -1);
      assert.ok(t.indexOf('ahp-cases-no-documents') === -1);
      assert.ok(t.indexOf('ahp-tasks-overdue') !== -1);
    });

    const none = await openPage({ ahpNotifCategory_sessions: 'false', ahpNotifCategory_tasks: 'false', ahpNotifCategory_cases: 'false' });
    none.fireAppReady(); await none.tick();
    await check('T3.5 all categories OFF: nothing is delivered', () => {
      assert.strictEqual(none.shown.length, 0, tags(none).join(','));
    });

    const test = await openPage({ ahpNotifCategory_sessions: 'false', ahpNotifCategory_tasks: 'false', ahpNotifCategory_cases: 'false' });
    test.w.AhpNotifications.sendTestNotification(); await test.tick();
    await check('T3.6 the manual test notification is not affected by category switches', () => {
      assert.deepStrictEqual(tags(test), ['ahp-test']);
    });

    const master = await openPage({ ahpNotificationsEnabled: 'false' });
    master.fireAppReady(); await master.tick();
    await check('T3.7 the master switch still blocks everything regardless of category state', () => {
      assert.strictEqual(master.shown.length, 0);
    });
  }

  // ---------- robustness ----------
  {
    const p = await openPage();
    await check('T4.1 handler tolerates null checkbox / unknown category without throwing or writing', () => {
      p.w.handleNotifCategoryToggleChange(null, 'sessions');
      p.w.handleNotifCategoryToggleChange({ checked: false }, 'nonsense');
      p.w.handleNotifCategoryToggleChange({ checked: false }, undefined);
      assert.ok(!Object.keys(p.storage()).some(function (k) { return /categor/i.test(k); }));
    });
  }

  console.log('\nPHASE N.13.2 category toggles: ' + passed + ' PASS / ' + failed + ' FAIL');
  process.exit(failed ? 1 : 0);
})();
