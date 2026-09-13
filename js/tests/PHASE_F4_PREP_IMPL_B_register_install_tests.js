/**
 * PHASE F.4-PREP-IMPL-B — Real browser orchestration tests for
 * LicenseManagerPanel.js's new backfill "تسجيل هذا التثبيت" affordance
 * (calls the existing, unmodified InstallationRegistrar.register()).
 * Real Chrome via Playwright, real DOM, real button .disabled
 * semantics — same convention as
 * Hossam-License-Manager-Pro/js/tests/PHASE_C1_wizard_modals_flow_tests.js
 * and this project's own PHASE_F4_PREP_IMPL_A backfill test.
 *
 * The real, unmodified production LicenseManagerPanel.js is loaded;
 * only the LicenseCore/MachineFingerprint/InstallationRegistrar
 * boundary is scripted (see fixtures/phase_f4_prep_impl_b_register_install/
 * index.html) so success/failure/empty-input scenarios are
 * deterministic. The orchestration logic itself (the new button +
 * onRegisterInstallSubmit(), added by this phase) is 100% real,
 * unmodified code.
 */
const { chromium } = require('/home/claude/.npm-global/lib/node_modules/playwright');
const path = require('path');

const PORT = 8079;
const ROOT = path.join(__dirname, 'fixtures', 'phase_f4_prep_impl_b_register_install');
const CHROME_PATH = '/opt/google/chrome/chrome';

let passed = 0, failed = 0;
const log = [];
function check(label, cond) {
  if (cond) { passed++; log.push('PASS: ' + label); }
  else { failed++; log.push('FAIL: ' + label); }
}

function startServer() {
  return new Promise((resolve) => {
    const { spawn } = require('child_process');
    const proc = spawn('node', [path.join(ROOT, 'server.js'), ROOT, String(PORT)]);
    proc.stdout.once('data', () => resolve(proc));
  });
}

async function freshPage(browser) {
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${PORT}/index.html`);
  return page;
}

async function main() {
  const serverProc = await startServer();
  let browser;
  try {
    browser = await chromium.launch({ executablePath: CHROME_PATH, headless: true, args: ['--no-sandbox'] });

    // ================================================================
    // Test A — Visibility: shown iff hasLocalCredential() === false
    // ================================================================
    {
      const page = await freshPage(browser);
      await page.evaluate(() => { window.__hasCredential = false; return window.__renderPanel(); });
      check('A: registration affordance IS visible when hasLocalCredential() === false', await page.evaluate(() => window.__isRegisterButtonVisible()));

      await page.evaluate(() => { window.__hasCredential = true; return window.__renderPanel(); });
      check('A: registration affordance is HIDDEN when hasLocalCredential() === true', !(await page.evaluate(() => window.__isRegisterButtonVisible())));
      await page.close();
    }

    // ================================================================
    // Test B — Empty code: no register() call
    // ================================================================
    {
      const page = await freshPage(browser);
      await page.evaluate(() => { window.__hasCredential = false; return window.__renderPanel(); });
      await page.evaluate(() => window.__clickRegisterButton());
      check('B: clicking the button reveals the activation-code step', await page.evaluate(() => window.__isStepVisible()));

      await page.evaluate(() => window.__setCode(''));
      await page.evaluate(() => window.__clickSubmitAndWait());
      const spy = await page.evaluate(() => window.__spy.calls);
      check('B: submitting an empty activation code never calls register()', !spy.register);
      check('B: an inline note explains the empty-input rejection', (await page.evaluate(() => window.__noteText())).length > 0);
      await page.close();
    }

    // ================================================================
    // Test C — Cancel: no register() call, no mutation
    // ================================================================
    {
      const page = await freshPage(browser);
      await page.evaluate(() => { window.__hasCredential = false; return window.__renderPanel(); });
      await page.evaluate(() => window.__clickRegisterButton());
      await page.evaluate(() => window.__setCode('SOME-CODE-1234'));
      await page.evaluate(() => window.__clickCancel());
      const spy = await page.evaluate(() => window.__spy.calls);
      check('C: cancelling never calls register()', !spy.register);
      check('C: cancelling collapses the activation-code step', !(await page.evaluate(() => window.__isStepVisible())));
      check('C: cancelling re-reveals the registration button (credential still absent)', await page.evaluate(() => window.__isRegisterButtonVisible()));
      check('C: cancelling clears the input field', (await page.evaluate(() => window.__inputValue())) === '');
      await page.close();
    }

    // ================================================================
    // Test D — Correct registrar call: existing license context used
    // ================================================================
    {
      const page = await freshPage(browser);
      await page.evaluate(() => { window.__hasCredential = false; window.__registerBehavior = 'success'; return window.__renderPanel(); });
      await page.evaluate(() => window.__clickRegisterButton());
      await page.evaluate(() => window.__setCode('  ABCD-1234-EFGH-5678  '));
      await page.evaluate(() => window.__clickSubmitAndWait());
      const spy = await page.evaluate(() => window.__spy.calls);
      check('D: register() called exactly once', (spy.register || []).length === 1);
      check('D: register() called with the license\'s existing licenseId (not a manually typed one)', spy.register[0][0].licenseId === 'HSM-LIC-EXISTING-1');
      check('D: register() called with the device\'s existing machineId', spy.register[0][0].machineId === 'HSM-AAAA-BBBB-CCCC');
      check('D: activation code passed through trimmed, unmodified otherwise', spy.register[0][0].activationCode === 'ABCD-1234-EFGH-5678');
      check('D: licenseId sourced via the existing LicenseCore.getStoredRecordMeta(), same as ActivationWizard.js', (spy.getStoredRecordMeta || []).length >= 1);
      await page.close();
    }

    // ================================================================
    // Test E — Success: state refresh, affordance disappears
    // ================================================================
    {
      const page = await freshPage(browser);
      await page.evaluate(() => { window.__hasCredential = false; window.__registerBehavior = 'success'; return window.__renderPanel(); });
      await page.evaluate(() => window.__clickRegisterButton());
      await page.evaluate(() => window.__setCode('VALID-CODE-0001'));
      await page.evaluate(() => window.__clickSubmitAndWait());

      check('E: a success toast is shown', (await page.evaluate(() => window.__toasts)).some(t => t.type === 'success'));
      check('E: registration affordance disappears after a successful registration', !(await page.evaluate(() => window.__isRegisterButtonVisible())));
      check('E: activation-code step is gone too (panel was fully re-rendered)', !(await page.evaluate(() => window.__isStepVisible())));
      await page.close();
    }

    // ================================================================
    // Test F — Failure: no false success, error shown, UI still available
    // ================================================================
    {
      const page = await freshPage(browser);
      await page.evaluate(() => { window.__hasCredential = false; window.__registerBehavior = 'fail'; return window.__renderPanel(); });
      await page.evaluate(() => window.__clickRegisterButton());
      await page.evaluate(() => window.__setCode('INVALID-CODE-0001'));
      await page.evaluate(() => window.__clickSubmitAndWait());

      const spy = await page.evaluate(() => window.__spy.calls);
      check('F: register() was still attempted exactly once', (spy.register || []).length === 1);
      check('F: no success toast is shown on failure (no false success)', !(await page.evaluate(() => window.__toasts)).some(t => t.type === 'success'));
      check('F: an error toast is shown', (await page.evaluate(() => window.__toasts)).some(t => t.type === 'error'));
      check('F: an inline error note is shown', (await page.evaluate(() => window.__noteText())).length > 0);
      check('F: the registration affordance remains available for retry (credential still absent)', await page.evaluate(() => window.__isRegisterButtonVisible()) === false && await page.evaluate(() => window.__isStepVisible()));
      const submitEnabled = await page.evaluate(() => !document.getElementById('licRegisterInstallSubmitBtn').disabled);
      check('F: the submit button is re-enabled after a failure (operator can retry)', submitEnabled);
      await page.close();
    }

    // ================================================================
    // Test G — No duplicate submission (double-click safety)
    // ================================================================
    {
      const page = await freshPage(browser);
      await page.evaluate(() => { window.__hasCredential = false; window.__registerBehavior = 'success'; return window.__renderPanel(); });
      await page.evaluate(() => window.__clickRegisterButton());
      await page.evaluate(() => window.__setCode('VALID-CODE-0002'));
      const disabledRightAfterFirstClick = await page.evaluate(() => window.__clickSubmitTwiceRapidly());
      const spy = await page.evaluate(() => window.__spy.calls);
      check('G: submit button is disabled immediately after the first click', disabledRightAfterFirstClick === true);
      check('G: a rapid second click does not produce a second register() call', (spy.register || []).length === 1);
      await page.close();
    }

  } finally {
    if (browser) await browser.close();
    serverProc.kill();
  }

  console.log('\n' + log.join('\n'));
  console.log('\n==== PHASE F.4-PREP-IMPL-B — نظام الحسام (LicenseManagerPanel.js register-this-installation) — Playwright harness ====');
  console.log('PASSED: ' + passed + '   FAILED: ' + failed);
  process.exitCode = failed > 0 ? 1 : 0;
}

main();
