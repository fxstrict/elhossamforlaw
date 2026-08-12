/**
 * ================================================================
 * verify_firstrun_scenario_chain.js — PHASE 13.9 verification
 * (comprehensive continuous-session scenario test)
 * ================================================================
 * PHASE 13.9.1 — TEST CONSOLIDATION:
 * This file is the former verify_firstrun_part2_sequence.js, renamed.
 * Its sibling verify_firstrun_full_scenario_chain.js was removed as
 * part of this consolidation: every check() assertion it made was a
 * duplicate of an assertion already present here (or in
 * verify_firstrun_save_completion.js), with one exception, which has
 * been preserved by moving it to verify_firstrun_save_completion.js
 * as an isolated case (see "CASE E" there) rather than folding it into
 * this continuous session, since it exercises a different, unrelated
 * Settings-page control and would have required contradicting this
 * session's already-established localModeChosen state. See
 * docs/phase13/PHASE_HISTORY.md, Phase 13.9.1 entry, for the full
 * duplication analysis. No test behavior in this file was changed.
 *
 * Executes the exact sequence requested in PHASE 13.9 PART 2, in one
 * continuous browser session (single IndexedDB origin, reloaded in
 * place between steps):
 *
 *   Fresh install -> Save with empty URL -> Refresh -> First Run
 *   wizard still appears -> Enter invalid URL -> Validation fails ->
 *   Fallback panel appears -> "Work locally now" -> Refresh -> Wizard
 *   never returns -> Create first Case -> Refresh -> Dashboard still
 *   opens -> Clear local database -> Refresh -> (observed) -> Configure
 *   valid GAS URL -> Refresh -> Dashboard opens normally.
 *
 * Run: node js/tests/verify_firstrun_scenario_chain.js
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
function info(label) {
  console.log('  \u2139 ' + label);
}

(async () => {
  const browser = await chromium.launch();
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
  page.on('dialog', d => d.accept());

  console.log('STEP 1 \u2014 Fresh install\n');
  await page.goto('file://' + INDEX_HTML, { waitUntil: 'load' });
  await page.waitForTimeout(600);
  check('wizard open on fresh install', await page.$eval('#firstRunWizard', el => el.classList.contains('open')));

  console.log('\nSTEP 2 \u2014 Save with empty URL\n');
  await page.click('#firstRunWizard .modal-footer .btn-primary');
  await page.waitForTimeout(150);
  check('app NOT entered (wizard stays open)', await page.$eval('#firstRunWizard', el => el.classList.contains('open')));
  const localModeAfterStep2 = await page.evaluate(async () => { await settingsRepositoryReadyPromise; return settingsRepository.get('localModeChosen'); });
  check('localModeChosen NOT set (setup not silently completed)', localModeAfterStep2 == null);

  console.log('\nSTEP 3 \u2014 Refresh\n');
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(600);

  console.log('\nSTEP 4 \u2014 First Run wizard still appears\n');
  check('wizard reappears after refresh (bug scenario confirmed fixed-safe)', await page.$eval('#firstRunWizard', el => el.classList.contains('open')));

  console.log('\nSTEP 5 \u2014 Enter invalid URL\n');
  await page.fill('#wizardApiUrlInput', 'https://script.google.com/macros/s/BAD_TEST_ID/exec');

  console.log('\nSTEP 6 \u2014 Validation fails (press Save)\n');
  await page.click('#firstRunWizard .modal-footer .btn-primary');
  await page.waitForTimeout(300);
  check('wizard stays open (app NOT entered)', await page.$eval('#firstRunWizard', el => el.classList.contains('open')));
  check('existing connection-error message shown', (await page.$eval('#firstRunResult', el => el.textContent)).indexOf('تعذر الاتصال') !== -1);

  console.log('\nSTEP 7 \u2014 Fallback panel appears\n');
  check('fallback panel visible', await page.evaluate(() => getComputedStyle(document.getElementById('firstRunFallback')).display !== 'none'));
  const fallbackButtons = await page.$$eval('#firstRunFallback button', els => els.map(e => e.textContent.trim()));
  check('two choices offered', fallbackButtons.length === 2);

  console.log('\nSTEP 8 \u2014 "Work locally now"\n');
  await page.click('#firstRunFallback button:nth-child(1)'); // العمل محلياً الآن
  await page.waitForTimeout(150);
  check('wizard closes', (await page.$eval('#firstRunWizard', el => el.classList.contains('open'))) === false);
  const localModeAfterStep8 = await page.evaluate(async () => { await settingsRepositoryReadyPromise; return settingsRepository.get('localModeChosen'); });
  check("localModeChosen === '1'", localModeAfterStep8 === '1');
  const apiUrlAfterStep8 = await page.evaluate(async () => { await settingsRepositoryReadyPromise; return settingsRepository.get('apiUrl'); });
  check('invalid apiUrl was NOT persisted', apiUrlAfterStep8 == null || apiUrlAfterStep8 === '');

  console.log('\nSTEP 9 \u2014 Refresh\n');
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(600);

  console.log('\nSTEP 10 \u2014 Wizard never returns\n');
  check('wizard does not reopen', (await page.$eval('#firstRunWizard', el => el.classList.contains('open'))) === false);

  console.log('\nSTEP 11 \u2014 Create first Case\n');
  await page.evaluate(() => navigate('cases'));
  await page.evaluate(() => openAddModal());
  await page.fill('#fCaseNum', '2026/9101');
  await page.fill('#fCaseTitle', 'Phase 13.9 Part 2 verification case');
  await page.evaluate(() => toggleCaseClient('Part2 Test Client', true));
  await page.evaluate(() => saveCase());
  await page.waitForTimeout(300);
  const caseCount = await page.evaluate(() => data.cases.length);
  check('case created', caseCount >= 1);

  console.log('\nSTEP 12 \u2014 Refresh\n');
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(600);

  console.log('\nSTEP 13 \u2014 Dashboard still opens\n');
  check('wizard does not reopen', (await page.$eval('#firstRunWizard', el => el.classList.contains('open'))) === false);
  check('dashboard page present/active', await page.$eval('#page-dashboard', el => el.classList.contains('active')));
  const caseCountAfterReload = await page.evaluate(() => data.cases.length);
  check('case persisted across refresh', caseCountAfterReload >= 1);

  console.log('\nSTEP 14 \u2014 Clear local database\n');
  await page.evaluate(() => navigate('settings'));
  await page.evaluate(() => clearAllData());
  await page.waitForTimeout(400);
  const caseCountAfterClear = await page.evaluate(() => data.cases.length);
  check('data cleared', caseCountAfterClear === 0);
  const localModeAfterClear = await page.evaluate(async () => { await settingsRepositoryReadyPromise; return settingsRepository.get('localModeChosen'); });
  check("localModeChosen untouched by Clear Database (still '1') \u2014 clearAllData() only clears entity keys, confirmed in code", localModeAfterClear === '1');

  console.log('\nSTEP 15 \u2014 Refresh\n');
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(600);

  console.log('\nSTEP 16 \u2014 Observed state after clear + refresh\n');
  const wizardAfterClearRefresh = await page.$eval('#firstRunWizard', el => el.classList.contains('open'));
  const activePage = await page.evaluate(() => currentPage);
  const caseCountAfterClearRefresh = await page.evaluate(() => data.cases.length);
  info('wizard open: ' + wizardAfterClearRefresh);
  info('active page on load: ' + activePage);
  info('data.cases.length: ' + caseCountAfterClearRefresh);
  // clearAllData() (js/modules/settings.js, PHASE 13.8, unmodified this
  // phase) only clears the 9 entity Repositories/localStorage mirrors —
  // it never touches 'apiUrl' or 'localModeChosen' (settings keys).
  // Since localModeChosen was already persisted in STEP 8, the wizard's
  // existing, unmodified condition (!API_URL && !localModeChosen) is
  // false, so per the CURRENT, CONFIRMED application logic the wizard
  // is expected to stay closed and the (now-empty) Dashboard is expected
  // to be the page shown. This is asserted below.
  check('wizard does NOT reopen after Clear Database (localModeChosen persists across clearAllData(), per confirmed code)', wizardAfterClearRefresh === false);
  check('app lands on Dashboard (default page) with the now-empty dataset — no separate "first page" state exists in this app', activePage === 'dashboard');
  check('dataset is empty post-clear, confirming clear actually took effect', caseCountAfterClearRefresh === 0);

  console.log('\nSTEP 17 \u2014 Configure valid GAS URL\n');
  await page.evaluate(() => navigate('settings'));
  await page.fill('#apiUrlInput', 'https://script.google.com/macros/s/GOOD_TEST_ID/exec');
  await page.click('#page-settings .settings-card:first-child .btn-primary');
  await page.waitForTimeout(400);
  const apiUrlAfterStep17 = await page.evaluate(async () => { await settingsRepositoryReadyPromise; return settingsRepository.get('apiUrl'); });
  check('sync URL configured', apiUrlAfterStep17 === 'https://script.google.com/macros/s/GOOD_TEST_ID/exec');

  console.log('\nSTEP 18 \u2014 Refresh\n');
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(600);

  console.log('\nSTEP 19 \u2014 Dashboard opens normally\n');
  check('wizard does not appear', (await page.$eval('#firstRunWizard', el => el.classList.contains('open'))) === false);
  check('dashboard page active', await page.$eval('#page-dashboard', el => el.classList.contains('active')));
  check('app loaded with no crash', await page.$eval('#page-dashboard', el => !!el));

  await browser.close();
  console.log('\n' + checks + '/' + checks + ' checks passed.');
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
