/**
 * ================================================================
 * verify_firstrun_save_completion.js — PHASE 13.9 verification
 * ================================================================
 * Verifies the "حفظ وبدء البرنامج" (Save) button on the First Run
 * wizard no longer lets the user into the app with an incomplete
 * setup, per PHASE 13.9's Cases A-D:
 *   A. No URL entered            -> app NOT entered; fallback panel
 *      shown with exactly two choices (local mode / import JSON).
 *   B. URL entered, valid        -> connection validated, settings
 *      saved, First Run finished, app entered.
 *   C. URL entered, invalid      -> app NOT entered; existing error
 *      shown; same two-choice fallback shown.
 *   D. (covered by verify_firstrun_local_mode.js) URL valid path is
 *      unchanged from today.
 *   E. Settings-page "connection settings" control (separate from the
 *      First Run wizard/fallback) still allows clearing a previously
 *      saved apiUrl back to empty, unaffected by this phase.
 *   F. (PHASE 13.9.2 — coverage gap closed) The wizard's standalone
 *      "اختبار الاتصال" (Test Connection) button — wizardTestConnection(),
 *      js/modules/firstrun.js — is a separate code path from Save
 *      (wizardSaveAndStart()) that was not exercised by any FirstRun
 *      test. It only ever writes a result message; it must never persist
 *      'apiUrl', never set 'localModeChosen', and never close the wizard,
 *      on either a valid or invalid deployment.
 *
 * PHASE 13.9.1 — TEST CONSOLIDATION:
 * Case E was moved here, unmodified in substance, from the now-removed
 * verify_firstrun_full_scenario_chain.js, where it was the only check()
 * assertion in that file not already duplicated elsewhere. It is
 * isolated into its own fresh browser context here rather than kept in
 * a continuous multi-step chain, since it exercises the general
 * Settings page URL field (not First Run-specific logic) and does not
 * depend on any other case's state. See docs/phase13/PHASE_HISTORY.md,
 * Phase 13.9.1 entry, for the full duplication analysis.
 *
 * Loads the real index.html in headless Chromium, mocking
 * window.fetch for the Google Apps Script endpoint so no real network
 * call is required.
 * Run: node js/tests/verify_firstrun_save_completion.js
 * ================================================================
 */
'use strict';

const path = require('path');
const { chromium } = require('playwright');

const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
const INDEX_HTML = path.join(PROJECT_ROOT, 'index.html');

let checks = 0;
function check(label, cond) {
  checks++;
  if (!cond) throw new Error('FAILED: ' + label);
  console.log('  \u2713 ' + label);
}

(async () => {
  const browser = await chromium.launch();

  // ---------------------------------------------------------------
  // CASE A — no URL entered
  // ---------------------------------------------------------------
  {
    const context = await browser.newContext();
    const page = await context.newPage();
    let sawRequest = false;
    page.on('request', (req) => {
      if (req.url().includes('script.google.com') || req.url().includes('macros/s/')) sawRequest = true;
    });

    console.log('CASE A \u2014 Save pressed with no URL\n');
    await page.goto('file://' + INDEX_HTML, { waitUntil: 'load' });
    await page.waitForTimeout(600);

    await page.click('#firstRunWizard .modal-footer .btn-primary'); // حفظ وبدء البرنامج
    await page.waitForTimeout(150);

    const wizardStillOpen = await page.$eval('#firstRunWizard', el => el.classList.contains('open'));
    check('wizard stays open (app NOT entered)', wizardStillOpen === true);
    check('no network request attempted', sawRequest === false);

    const fallbackVisible = await page.evaluate(() => {
      const el = document.getElementById('firstRunFallback');
      return !!el && getComputedStyle(el).display !== 'none';
    });
    check('fallback panel is shown', fallbackVisible === true);

    const fallbackMsg = await page.$eval('#firstRunFallbackMsg', el => el.textContent.trim());
    check('fallback message matches spec', fallbackMsg === 'لم يتم إدخال رابط Google Apps Script.');

    const fallbackButtons = await page.$$eval('#firstRunFallback button', els => els.map(e => e.textContent.trim()));
    check('exactly two choices offered', fallbackButtons.length === 2);
    check('choice 1 is "العمل محلياً الآن"', fallbackButtons[0].indexOf('العمل محلياً الآن') !== -1);
    check('choice 2 is "استيراد نسخة JSON"', fallbackButtons[1].indexOf('استيراد نسخة JSON') !== -1);

    const localModeChosenBefore = await page.evaluate(async () => {
      await settingsRepositoryReadyPromise;
      return settingsRepository.get('localModeChosen');
    });
    check('localModeChosen NOT set yet (setup not silently completed)', localModeChosenBefore == null);

    // Choice 1: "العمل محلياً الآن" -> same action as wizardStartLocal()
    await page.click('#firstRunFallback button:nth-child(1)');
    await page.waitForTimeout(150);
    const wizardOpenAfterLocal = await page.$eval('#firstRunWizard', el => el.classList.contains('open'));
    check('choosing local mode closes the wizard', wizardOpenAfterLocal === false);
    const localModeChosenAfter = await page.evaluate(async () => {
      await settingsRepositoryReadyPromise;
      return settingsRepository.get('localModeChosen');
    });
    check("localModeChosen === '1' after choosing local mode", localModeChosenAfter === '1');

    // Refresh must not show the wizard again.
    await page.reload({ waitUntil: 'load' });
    await page.waitForTimeout(600);
    const wizardOpenAfterReload = await page.$eval('#firstRunWizard', el => el.classList.contains('open'));
    check('refresh after local-mode choice does not reopen the wizard (bug fixed)', wizardOpenAfterReload === false);

    await context.close();
  }

  // ---------------------------------------------------------------
  // CASE A, choice 2 — "استيراد نسخة JSON" scrolls to the existing
  // JSON import section (no new import screen).
  // ---------------------------------------------------------------
  {
    const context = await browser.newContext();
    const page = await context.newPage();
    console.log('\nCASE A \u2014 "\u0627\u0633\u062a\u064a\u0631\u0627\u062f \u0646\u0633\u062e\u0629 JSON" choice\n');
    await page.goto('file://' + INDEX_HTML, { waitUntil: 'load' });
    await page.waitForTimeout(600);
    await page.click('#firstRunWizard .modal-footer .btn-primary');
    await page.waitForTimeout(150);
    await page.click('#firstRunFallback button:nth-child(2)');
    await page.waitForTimeout(200);

    const wizardOpen = await page.$eval('#firstRunWizard', el => el.classList.contains('open'));
    check('wizard closes when choosing JSON import', wizardOpen === false);

    const onSettingsPage = await page.$eval('#page-settings', el => el.classList.contains('active'));
    check('navigated to the existing Settings page', onSettingsPage === true);

    const importButtonExists = await page.$('#dataManagementCard button[onclick="importData()"]');
    check('existing "\u0627\u0633\u062a\u064a\u0631\u0627\u062f JSON" control is present (reused, not duplicated)', importButtonExists !== null);

    await context.close();
  }

  // ---------------------------------------------------------------
  // CASE B — URL entered, valid
  // ---------------------------------------------------------------
  {
    const context = await browser.newContext();
    const page = await context.newPage();
    // Single catch-all route for the fake Apps Script deployment — covers
    // ?action=setup (wizardSaveAndStart) as well as whatever loadFromSheets()
    // requests 500ms later (fired in the background after success).
    await page.route('**script.google.com**', (route) => {
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'ok', spreadsheet_url: '' }) });
    });

    console.log('\nCASE B \u2014 Save pressed with a VALID URL\n');
    await page.goto('file://' + INDEX_HTML, { waitUntil: 'load' });
    await page.waitForTimeout(600);
    await page.fill('#wizardApiUrlInput', 'https://script.google.com/macros/s/VALID_TEST_ID/exec');
    await page.click('#firstRunWizard .modal-footer .btn-primary');
    await page.waitForTimeout(400);

    const wizardOpen = await page.$eval('#firstRunWizard', el => el.classList.contains('open'));
    check('wizard closes and app is entered', wizardOpen === false);

    const apiUrlSaved = await page.evaluate(async () => {
      await settingsRepositoryReadyPromise;
      return settingsRepository.get('apiUrl');
    });
    check('apiUrl persisted', apiUrlSaved === 'https://script.google.com/macros/s/VALID_TEST_ID/exec');

    const fallbackVisible = await page.evaluate(() => {
      const el = document.getElementById('firstRunFallback');
      return !!el && getComputedStyle(el).display !== 'none';
    });
    check('fallback panel not shown on success', fallbackVisible === false);

    // Refresh must not show the wizard again (Case D parity).
    await page.reload({ waitUntil: 'load' });
    await page.waitForTimeout(600);
    const wizardOpenAfterReload = await page.$eval('#firstRunWizard', el => el.classList.contains('open'));
    check('refresh after valid save does not reopen the wizard', wizardOpenAfterReload === false);

    await context.close();
  }

  // ---------------------------------------------------------------
  // CASE C — URL entered, invalid/unreachable
  // ---------------------------------------------------------------
  {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.route('**/macros/s/**action=setup**', (route) => {
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'error', error: 'bad deployment' }) });
    });

    console.log('\nCASE C \u2014 Save pressed with an INVALID URL\n');
    await page.goto('file://' + INDEX_HTML, { waitUntil: 'load' });
    await page.waitForTimeout(600);
    await page.fill('#wizardApiUrlInput', 'https://script.google.com/macros/s/BAD_TEST_ID/exec');
    await page.click('#firstRunWizard .modal-footer .btn-primary');
    await page.waitForTimeout(400);

    const wizardStillOpen = await page.$eval('#firstRunWizard', el => el.classList.contains('open'));
    check('wizard stays open (app NOT entered)', wizardStillOpen === true);

    const resultText = await page.$eval('#firstRunResult', el => el.textContent.trim());
    check('existing connection-error message is shown', resultText.indexOf('تعذر الاتصال') !== -1);

    const fallbackButtons = await page.$$eval('#firstRunFallback button', els => els.map(e => e.textContent.trim()));
    check('same two choices offered as Case A', fallbackButtons.length === 2 &&
      fallbackButtons[0].indexOf('العمل محلياً الآن') !== -1 &&
      fallbackButtons[1].indexOf('استيراد نسخة JSON') !== -1);

    const apiUrlSaved = await page.evaluate(async () => {
      await settingsRepositoryReadyPromise;
      return settingsRepository.get('apiUrl');
    });
    check('invalid apiUrl NOT persisted', apiUrlSaved == null || apiUrlSaved === '');

    await context.close();
  }

  // ---------------------------------------------------------------
  // CASE E — Settings-page connection-settings control clears a
  // previously saved apiUrl (existing, unmodified control; preserved
  // from the removed verify_firstrun_full_scenario_chain.js).
  // ---------------------------------------------------------------
  {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.route('**script.google.com**', (route) => {
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'ok', spreadsheet_url: '' }) });
    });

    console.log('\nCASE E \u2014 Settings-page URL clear (existing control)\n');
    await page.goto('file://' + INDEX_HTML, { waitUntil: 'load' });
    await page.waitForTimeout(600);
    await page.fill('#wizardApiUrlInput', 'https://script.google.com/macros/s/VALID_TEST_ID/exec');
    await page.click('#firstRunWizard .modal-footer .btn-primary');
    await page.waitForTimeout(400);

    await page.evaluate(() => navigate('settings'));
    await page.fill('#apiUrlInput', '');
    await page.click('#page-settings .settings-card:first-child .btn-primary');
    await page.waitForTimeout(150);
    const apiUrlAfterClear = await page.evaluate(async () => {
      await settingsRepositoryReadyPromise;
      return settingsRepository.get('apiUrl');
    });
    check('apiUrl cleared via Settings-page control (now local)', apiUrlAfterClear === '');

    await context.close();
  }

  // ---------------------------------------------------------------
  // CASE F — wizard's standalone "اختبار الاتصال" (Test Connection)
  // button, wizardTestConnection() (js/modules/firstrun.js). Separate
  // code path from Save/wizardSaveAndStart() — previously untested by
  // any FirstRun test file (PHASE 13.9.2 coverage gap, closed here).
  // ---------------------------------------------------------------
  {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.route('**script.google.com**', (route) => {
      const url = route.request().url();
      if (url.indexOf('BAD_TEST_ID') !== -1) {
        route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'error', error: 'bad deployment' }) });
      } else {
        route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'ok', spreadsheet_url: '' }) });
      }
    });

    console.log('\nCASE F \u2014 wizard "Test Connection" button (valid URL)\n');
    await page.goto('file://' + INDEX_HTML, { waitUntil: 'load' });
    await page.waitForTimeout(600);
    await page.fill('#wizardApiUrlInput', 'https://script.google.com/macros/s/VALID_TEST_ID/exec');
    await page.click('#firstRunWizard .modal-footer .btn-ghost:not([onclick="wizardStartLocal()"])');
    await page.waitForTimeout(400);

    const resultTextValid = await page.$eval('#firstRunResult', el => el.textContent.trim());
    check('success message shown', resultTextValid.indexOf('تم الاتصال بنجاح') !== -1);

    const wizardStillOpenValid = await page.$eval('#firstRunWizard', el => el.classList.contains('open'));
    check('wizard stays open (Test Connection never enters the app)', wizardStillOpenValid === true);

    const apiUrlAfterTestValid = await page.evaluate(async () => {
      await settingsRepositoryReadyPromise;
      return settingsRepository.get('apiUrl');
    });
    check('apiUrl NOT persisted by Test Connection alone', apiUrlAfterTestValid == null || apiUrlAfterTestValid === '');

    console.log('\nCASE F \u2014 wizard "Test Connection" button (invalid URL)\n');
    await page.fill('#wizardApiUrlInput', 'https://script.google.com/macros/s/BAD_TEST_ID/exec');
    await page.click('#firstRunWizard .modal-footer .btn-ghost:not([onclick="wizardStartLocal()"])');
    await page.waitForTimeout(400);

    const resultTextInvalid = await page.$eval('#firstRunResult', el => el.textContent.trim());
    check('failure message shown', resultTextInvalid.indexOf('تعذر الاتصال') !== -1);

    const wizardStillOpenInvalid = await page.$eval('#firstRunWizard', el => el.classList.contains('open'));
    check('wizard stays open after failed Test Connection', wizardStillOpenInvalid === true);

    const fallbackVisibleAfterTest = await page.evaluate(() => {
      const el = document.getElementById('firstRunFallback');
      return !!el && getComputedStyle(el).display !== 'none';
    });
    check('fallback panel NOT triggered by Test Connection (only Save triggers it)', fallbackVisibleAfterTest === false);

    const localModeAfterTest = await page.evaluate(async () => {
      await settingsRepositoryReadyPromise;
      return settingsRepository.get('localModeChosen');
    });
    check('localModeChosen NOT set by Test Connection', localModeAfterTest == null);

    await context.close();
  }

  await browser.close();
  console.log('\n' + checks + '/' + checks + ' checks passed.');
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
