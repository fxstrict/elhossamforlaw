'use strict';
/**
 * PHASE A8 — Firebase Cloud Messaging tests.
 *
 * IMPORTANT HONESTY NOTE (per PHASE A8 master prompt §43/§44):
 * These are STATIC VERIFIED / MOCK VERIFIED tests only — this sandbox has
 * no real Firebase project, no real Android device, and no real FCM
 * credentials. Nothing here proves a real push notification was ever
 * delivered to a real closed app. Every check below either (a) greps the
 * real source files for the required code shape, or (b) re-implements the
 * exact same small piece of logic in a mock to prove its behavior in
 * isolation (e.g. apiAddRow's fire-and-forget contract). None of this is
 * "REAL DEVICE VERIFIED".
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..', '..');

let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log('PASS -', name); }
  else { fail++; console.log('FAIL -', name); }
}
function read(rel) { return fs.readFileSync(path.join(ROOT, rel), 'utf8'); }

const configGs   = read('Config/00_Config.gs');
const apiGs      = read('Config/06_Api.gs');
const fcmGs      = read('Config/10_Fcm.gs');
const sw         = read('service-worker.js');
const notifMgr   = read('js/core/pwa/NotificationManager.js');
const fcmClient  = read('js/core/pwa/FcmClient.js');
const indexHtml  = read('index.html');
const settingsJs = read('js/modules/settings.js');

// =====================================================================
// Configuration — [STATIC VERIFIED]
// =====================================================================
check('Config/00_Config.gs defines FIREBASE_PROJECT_ID', /const FIREBASE_PROJECT_ID\s*=/.test(configGs));
check('Config/00_Config.gs defines FIREBASE_API_KEY', /const FIREBASE_API_KEY\s*=/.test(configGs));
check('Config/00_Config.gs defines FIREBASE_MESSAGING_SENDER_ID', /const FIREBASE_MESSAGING_SENDER_ID\s*=/.test(configGs));
check('Config/00_Config.gs defines FIREBASE_APP_ID', /const FIREBASE_APP_ID\s*=/.test(configGs));
check('Config/00_Config.gs defines FIREBASE_VAPID_KEY', /const FIREBASE_VAPID_KEY\s*=/.test(configGs));
check('Config/00_Config.gs defines FCM_NOTIFY_SHEETS as a Config-level array (not scattered logic)', /const FCM_NOTIFY_SHEETS\s*=\s*\[/.test(configGs));
check('Config/00_Config.gs: no service-account/private-key literal anywhere in Config', !/private_key['"]?\s*:/.test(configGs) && !/BEGIN PRIVATE KEY/.test(configGs));
check('Config/00_Config.gs: SHEET_DEFS gains a new أجهزة_FCM entry (additive)', /name:\s*'أجهزة_FCM'/.test(configGs));
check('أجهزة_FCM sheet def has token/status/project_id fields for dedup + isolation', /'token'/.test(configGs) && /'status'/.test(configGs) && /'project_id'/.test(configGs));

// =====================================================================
// Secrets never in frontend / SW / Config — [STATIC VERIFIED]
// =====================================================================
// Matches an actual VALUE (assignment/JSON key with a quoted value), not a
// bare mention of the word in a warning comment (Config/00_Config.gs
// intentionally documents "never put private_key/client_email here" in
// Arabic prose, which must NOT itself be flagged as a leaked secret).
const SECRET_VALUE_PATTERNS = [
  /private_key['"]?\s*[:=]\s*['"]/i,
  /client_email['"]?\s*[:=]\s*['"]/i,
  /BEGIN PRIVATE KEY/,
  /service_account['"]?\s*[:=]\s*['"]/i,
  /admin\.credential\s*\(/i
];
const FRONTEND_FILES = ['index.html', 'service-worker.js', 'js/modules/settings.js', 'js/core/pwa/NotificationManager.js', 'js/core/pwa/FcmClient.js', 'Config/00_Config.gs'];
FRONTEND_FILES.forEach(function (rel) {
  const content = read(rel);
  const hit = SECRET_VALUE_PATTERNS.some(function (re) { return re.test(content); });
  check('No service-account/private-key secret VALUE found in ' + rel, !hit);
});
check('Config/10_Fcm.gs reads the Service Account ONLY from PropertiesService (never a literal)', /PropertiesService\.getScriptProperties\(\)\.getProperty\(FCM_SA_PROPERTY_KEY\)/.test(fcmGs) && !/private_key['"]?\s*:\s*['"]/.test(fcmGs));

// =====================================================================
// Service Worker — [STATIC VERIFIED]
// =====================================================================
check('service-worker.js: push listener added', /self\.addEventListener\('push',/.test(sw));
check('service-worker.js: push handler calls showNotification', /self\.registration\.showNotification\(/.test(sw));
check('service-worker.js: notificationclick preserved', /self\.addEventListener\('notificationclick',/.test(sw));
check('service-worker.js: sync (Background Sync) preserved', /self\.addEventListener\('sync',/.test(sw));
check('service-worker.js: fetch preserved', /self\.addEventListener\('fetch',/.test(sw));
check('service-worker.js: install preserved', /self\.addEventListener\('install',/.test(sw));
check('service-worker.js: activate preserved', /self\.addEventListener\('activate',/.test(sw));
check('service-worker.js: message preserved', /self\.addEventListener\('message',/.test(sw));
check('service-worker.js: SW_VERSION was bumped for this phase (v94)', /var SW_VERSION = 'v94'/.test(sw));
check('service-worker.js: FcmClient.js added to PRECACHE_URLS (offline-boot stays in sync with index.html)', /'js\/core\/pwa\/FcmClient\.js\?v=1'/.test(sw));
check('service-worker.js: only ONE service worker file touched — no firebase-messaging-sw.js created', !fs.existsSync(path.join(ROOT, 'firebase-messaging-sw.js')));
check('service-worker.js: no setInterval anywhere (push stays event-driven, no polling introduced)', !/setInterval/.test(sw));

// =====================================================================
// Frontend — [STATIC VERIFIED]
// =====================================================================
check('index.html: FcmClient.js is loaded exactly once', (indexHtml.match(/<script src="js\/core\/pwa\/FcmClient\.js\?v=1">/g) || []).length === 1);
check('index.html: FcmClient.js\'s <script> tag loads BEFORE NotificationManager.js\'s <script> tag (token bridge ready before it is used)',
  indexHtml.indexOf('<script src="js/core/pwa/FcmClient.js') < indexHtml.indexOf('<script src="js/core/pwa/NotificationManager.js'));
check('FcmClient.js: Firebase SDK version is pinned in exactly one place and reused for both imports (not multiple scattered CDN versions)',
  (fcmClient.match(/FIREBASE_SDK_VERSION = '10\.13\.2'/g) || []).length === 1 && (fcmClient.match(/FIREBASE_SDK_VERSION \+/g) || []).length === 2);
check('FcmClient.js: no eager Firebase init at file load — only inside a function', /loadFirebaseMessaging\(\)/.test(fcmClient) && !/^\s*loadFirebaseMessaging\(\);/m.test(fcmClient));
check('FcmClient.js: reuses navigator.serviceWorker.ready (the SAME existing registration), no second SW registration', /navigator\.serviceWorker\.ready/.test(fcmClient) && !/\.register\(/.test(fcmClient));
check('NotificationManager.js: permissionState()/isEnabled()/setEnabled()/requestPermission() still exported (no second permission system)',
  /permissionState:\s*permissionState/.test(notifMgr) && /isEnabled:\s*isEnabled/.test(notifMgr) && /setEnabled:\s*setEnabled/.test(notifMgr) && /requestPermission:\s*requestPermission/.test(notifMgr));
check('NotificationManager.js: token registration is triggered from the SAME explicit user click as before (handleEnableNotificationsClick), not automatically at boot',
  /registerFcmTokenIfAvailable\(\);/.test(notifMgr) && /global\.handleEnableNotificationsClick = function/.test(notifMgr));
check('NotificationManager.js: token registration reuses ApiService.saveData (apiAddRow) — no new endpoint invented', /ApiService\.saveData\('أجهزة_FCM'/.test(notifMgr));
check('NotificationManager.js: token row id === token (idempotent update-in-place, no duplicate-row risk)', /id:\s*token,/.test(notifMgr) && /token:\s*token,/.test(notifMgr));
check('NotificationManager.js: message listener calls SyncCoordinator.requestSync(\'notification\')', /SyncCoordinator\.requestSync\('notification'\)/.test(notifMgr));
check('NotificationManager.js: project mismatch is checked and sync is skipped on mismatch', /incomingProjectId !== currentProjectId/.test(notifMgr));
check('settings.js pingConnection(): caches project_id + firebase config locally, no new network call added', /ahp_project_id/.test(settingsJs) && /ahp_firebase_config/.test(settingsJs));
check('No setInterval added anywhere in the frontend files touched by A8', !/setInterval/.test(notifMgr) && !/setInterval/.test(fcmClient));

// =====================================================================
// Backend — [STATIC VERIFIED]
// =====================================================================
check('Config/10_Fcm.gs defines sendFcmNotification() as the single external entry point', /function sendFcmNotification\(/.test(fcmGs));
check('Config/10_Fcm.gs: uses FCM HTTP v1 endpoint (not legacy)', /fcm\.googleapis\.com\/v1\/projects\//.test(fcmGs));
check('Config/10_Fcm.gs: builds its own OAuth access token via a Service Account JWT (not an actual ScriptApp.getOAuthToken() call — mentioned only in an explanatory comment)',
  /getFcmAccessToken_/.test(fcmGs) && !/=\s*ScriptApp\.getOAuthToken\(/.test(fcmGs) && /computeRsaSha256Signature/.test(fcmGs));
check('Config/10_Fcm.gs: reads only ACTIVE tokens (status===\'active\')', /statusCol\] === 'active'/.test(fcmGs));
check('Config/10_Fcm.gs: an invalid/expired token is marked expired, not deleted', /function markFcmTokenExpired_/.test(fcmGs) && /setValue\('expired'\)/.test(fcmGs) && !/deleteRow/.test(fcmGs));
check('Config/10_Fcm.gs: a single token failure does not stop sending to other tokens (loop continues, no throw/break on per-token failure)',
  /for \(var i = 0; i < tokens\.length; i\+\+\) \{\s*sendFcmToSingleToken_/.test(fcmGs));
check('Config/10_Fcm.gs: sendFcmNotification wraps everything in try/catch and never rethrows', /function sendFcmNotification\(sheetName, rowData\) \{\s*try \{/.test(fcmGs) && /catch \(err\) \{[\s\S]{0,200}Logger\.log/.test(fcmGs));
check('Config/06_Api.gs: apiPing() exposes project_id + Public firebase config only (no secret fields)', /project_id: \(typeof PROJECT_ID/.test(apiGs) && /firebase: \(typeof FIREBASE_PROJECT_ID/.test(apiGs) && !/private_key/.test(apiGs));

// =====================================================================
// apiAddRow safety — THE most important test (§14 of the A8 prompt)
// [MOCK VERIFIED — same control-flow shape as the real 06_Api.gs, not the
// real GAS runtime, which cannot execute in plain node]
// =====================================================================
check('Config/06_Api.gs: sendFcmNotification() is called AFTER the actual row write (setValues), not before',
  (function () {
    const writeIdx = apiGs.indexOf('sheet.getRange(targetRow, 1, 1, row.length).setValues([row]);');
    const fcmIdx = apiGs.indexOf('try { sendFcmNotification(sheetName, rowData); }');
    return writeIdx !== -1 && fcmIdx !== -1 && writeIdx < fcmIdx;
  })()
);
check('Config/06_Api.gs: the FCM call site is wrapped in its own try/catch inside apiAddRow (defense-in-depth beyond sendFcmNotification\'s own try/catch)',
  /try \{ sendFcmNotification\(sheetName, rowData\); \} catch \(fcmErr\)/.test(apiGs));
check('Config/06_Api.gs: apiAddRow\'s final success response is still returned after the FCM call site (return not skipped/altered)',
  /catch \(fcmErr\)[^\n]*\n\n  return jsonResponse\(\{ status: 'ok', message: 'تمت الإضافة'/.test(apiGs));

(function mockApiAddRowFcmFailureIsolation() {
  // Reproduces the exact control-flow shape now in apiAddRow(): write,
  // THEN try{fcm}catch{log}, THEN return success — proving a throwing FCM
  // call cannot prevent the success response, without needing the real
  // GAS SpreadsheetApp runtime.
  function mockApiAddRow(sendFcmNotificationImpl) {
    const writeResult = { status: 'written' }; // the write already happened successfully
    try { sendFcmNotificationImpl(); } catch (fcmErr) { /* logged only */ }
    return { status: 'ok', message: 'تمت الإضافة', write: writeResult };
  }
  const resultWhenFcmThrows = mockApiAddRow(function () { throw new Error('FCM HTTP v1 unreachable'); });
  check('MOCK: Spreadsheet write succeeds + FCM throws => apiAddRow still returns status:ok', resultWhenFcmThrows.status === 'ok' && resultWhenFcmThrows.write.status === 'written');

  let threw = false;
  try { mockApiAddRow(function () { throw new Error('boom'); }); } catch (e) { threw = true; }
  check('MOCK: apiAddRow-shaped call never propagates the FCM exception to its own caller', threw === false);
})();

// =====================================================================
// Project isolation — [MOCK VERIFIED]
// =====================================================================
(function mockProjectIsolation() {
  function shouldSync(incomingProjectId, currentProjectId) {
    if (!incomingProjectId) return false; // legacy local notifications never carry one — never trigger a sync
    if (currentProjectId && incomingProjectId !== currentProjectId) return false;
    return true;
  }
  check('MOCK: matching projectId triggers sync', shouldSync('HOSSAM_01', 'HOSSAM_01') === true);
  check('MOCK: mismatched projectId (Project A token notif reaching a Project B browser) is rejected', shouldSync('HOSSAM_01', 'RASHA_01') === false);
  check('MOCK: legacy local notification (no projectId at all) never triggers a sync via this path', shouldSync('', 'HOSSAM_01') === false);
})();

// =====================================================================
// No polling anywhere touched by A8 — [STATIC VERIFIED]
// =====================================================================
[sw, notifMgr, fcmClient, fcmGs, apiGs].forEach(function (content, i) {
  const names = ['service-worker.js', 'NotificationManager.js', 'FcmClient.js', '10_Fcm.gs', '06_Api.gs'];
  check('No setInterval-based polling for FCM/notifications introduced in ' + names[i], !/setInterval/.test(content));
});
check('Config/10_Fcm.gs never calls UrlFetchApp toward the app\'s own Web App URL (no self-polling)', !/UrlFetchApp\.fetch\(API_URL/.test(fcmGs));

// =====================================================================
// SyncCoordinator itself — [STATIC VERIFIED]
// =====================================================================
// Note: SyncCoordinator.js legitimately mentions "Firebase" in comments
// dating back to A7.5 (documenting that the 'notification' reason was
// reserved for future Firebase use) — that predates A8 and is not a sign
// of modification. What actually proves A8 didn't touch this file is the
// ABSENCE of the concrete new identifiers A8 introduces everywhere else
// (sendFcmNotification, ahpGetFcmToken, FIREBASE_PROJECT_ID, an actual
// self.addEventListener('push', ...) call, etc.).
const syncCoordinator = read('js/core/SyncCoordinator.js');
const A8_INTRODUCED_IDENTIFIERS = /sendFcmNotification|ahpGetFcmToken|FIREBASE_PROJECT_ID|FCM_NOTIFY_SHEETS|self\.addEventListener\('push'/;
check('js/core/SyncCoordinator.js was NOT modified for A8 (no concrete A8-introduced identifier appears inside it)', !A8_INTRODUCED_IDENTIFIERS.test(syncCoordinator));
check('\'notification\' was already a valid reason before A8 (unchanged, just now actually used)', /notification/.test(syncCoordinator));

// =====================================================================
// Protected files — must remain byte-shape unchanged w.r.t. A8 additions
// =====================================================================
const PROTECTED = [
  'js/core/SyncEngine.js', 'js/core/SyncCheckpoint.js', 'js/core/OfflineQueue.js',
  'js/core/Repository.js', 'js/core/StorageAdapter.js', 'js/core/IndexedDBAdapter.js',
  'js/api/api.js', 'js/core/SyncCoordinator.js'
];
PROTECTED.forEach(function (rel) {
  const content = read(rel);
  check('Protected file untouched by A8 (no concrete A8-introduced identifier leaked in): ' + rel, !A8_INTRODUCED_IDENTIFIERS.test(content));
});

// =====================================================================
// PHASE A9 — REGRESSION: push handler icon/badge must point at the
// real asset location (assets/icons/), not the non-existent ./icons/
// path the original A8 handler used.
// =====================================================================
const fsA9 = require('fs');
const pathA9 = require('path');
const swSrcForIcons = read('service-worker.js');
check("service-worker.js push handler: icon path is './assets/icons/icon-192.png' (not the broken './icons/icon-192.png')", /icon:\s*'\.\/assets\/icons\/icon-192\.png'/.test(swSrcForIcons));
check("service-worker.js push handler: badge path is './assets/icons/icon-96.png' (not the broken './icons/icon-96.png')", /badge:\s*'\.\/assets\/icons\/icon-96\.png'/.test(swSrcForIcons));
check('service-worker.js push handler no longer references the non-existent ./icons/ (without assets/) path', !/icon:\s*'\.\/icons\//.test(swSrcForIcons) && !/badge:\s*'\.\/icons\//.test(swSrcForIcons));
check('assets/icons/icon-192.png actually exists on disk (path the push handler now points at)', fsA9.existsSync(pathA9.join(ROOT, 'assets', 'icons', 'icon-192.png')));
check('assets/icons/icon-96.png actually exists on disk (path the push handler now points at)', fsA9.existsSync(pathA9.join(ROOT, 'assets', 'icons', 'icon-96.png')));

console.log('\n=== RESULT: ' + pass + ' PASS / ' + fail + ' FAIL ===');
console.log('NOTE: all PASS results above are STATIC VERIFIED or MOCK VERIFIED only — no real Firebase project, no real Android device, no real FCM delivery was exercised in this environment.');
process.exitCode = fail > 0 ? 1 : 0;
