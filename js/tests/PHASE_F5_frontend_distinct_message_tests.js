/**
 * PHASE F.5 — Frontend distinct-message test.
 * Real browser (Playwright/Chromium), real DOM, the REAL unmodified
 * production js/license/LicenseManagerPanel.js (synced copy — see
 * fixtures/phase_f5_installation_limit/js/LicenseManagerPanel.js) and a
 * scripted InstallationRegistrar boundary stub, same convention as
 * js/tests/PHASE_F4_PREP_IMPL_B_register_install_tests.js.
 *
 * Scope: ONLY the one thing approved for F.5's frontend surface —
 * confirms INSTALLATION_LIMIT_REACHED produces a distinct, accurate
 * note/toast, and that no OTHER failure status (e.g. an AUTH/activation
 * failure) shows that same message. Nothing else in
 * onRegisterInstallSubmit()'s existing, already-tested behavior
 * (visibility, empty-code guard, cancel, double-submit guard, generic
 * success/failure toasts) is re-tested here — that is already fully
 * covered by PHASE_F4_PREP_IMPL_B_register_install_tests.js, which was
 * re-run and re-verified (25/25) against this same F.5-patched file
 * before this test was written.
 */
const { chromium } = require('/home/claude/.npm-global/lib/node_modules/playwright');
const path = require('path');

const PORT = 8080;
const ROOT = path.join(__dirname, 'fixtures', 'phase_f5_installation_limit');
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
    // Test A — INSTALLATION_LIMIT_REACHED shows the distinct message
    // ================================================================
    {
      const page = await freshPage(browser);
      await page.evaluate(() => { window.__hasCredential = false; window.__registerBehavior = 'limit_reached'; return window.__renderPanel(); });
      await page.evaluate(() => window.__clickRegisterButton());
      await page.evaluate(() => window.__setCode('SOME-VALID-CODE'));
      await page.evaluate(() => window.__clickSubmitAndWait());

      const note = await page.evaluate(() => window.__noteText());
      const toasts = await page.evaluate(() => window.__toasts);
      check('A: distinct note mentions the installation limit (not the generic "تأكد من صحة كود التفعيل")', note.indexOf('الحد الأقصى') !== -1 && note.indexOf('تأكد من صحة كود التفعيل') === -1);
      check('A: an error toast about the limit is shown', toasts.some(t => t.type === 'error' && t.msg.indexOf('الحد الأقصى') !== -1));
      check('A: no success toast is shown', !toasts.some(t => t.type === 'success'));
      check('A: registration step remains open for retry (button correctly still hidden, step still visible)', await page.evaluate(() => window.__isRegisterButtonVisible()) === false && await page.evaluate(() => window.__isStepVisible()));
      await page.close();
    }

    // ================================================================
    // Test B — a DIFFERENT failure status (e.g. INVALID_ACTIVATION)
    // must NOT show the limit-specific message
    // ================================================================
    {
      const page = await freshPage(browser);
      await page.evaluate(() => { window.__hasCredential = false; window.__registerBehavior = 'other_failure'; return window.__renderPanel(); });
      await page.evaluate(() => window.__clickRegisterButton());
      await page.evaluate(() => window.__setCode('SOME-CODE'));
      await page.evaluate(() => window.__clickSubmitAndWait());

      const note = await page.evaluate(() => window.__noteText());
      const toasts = await page.evaluate(() => window.__toasts);
      check('B: a non-limit failure shows the ORIGINAL generic note, unchanged', note.indexOf('تأكد من صحة كود التفعيل') !== -1);
      check('B: a non-limit failure does NOT show the limit-specific wording', note.indexOf('الحد الأقصى') === -1);
      check('B: the generic error toast is shown, not the limit-specific one', toasts.some(t => t.type === 'error' && t.msg.indexOf('تعذّر تسجيل') !== -1) && !toasts.some(t => t.msg.indexOf('الحد الأقصى') !== -1));
      await page.close();
    }

    // ================================================================
    // Test C — success path is completely unaffected by the new code
    // ================================================================
    {
      const page = await freshPage(browser);
      await page.evaluate(() => { window.__hasCredential = false; window.__registerBehavior = 'success'; return window.__renderPanel(); });
      await page.evaluate(() => window.__clickRegisterButton());
      await page.evaluate(() => window.__setCode('SOME-CODE'));
      await page.evaluate(() => window.__clickSubmitAndWait());

      const toasts = await page.evaluate(() => window.__toasts);
      check('C: success still shows the original success toast', toasts.some(t => t.type === 'success'));
      check('C: registration affordance disappears after success (unchanged behavior)', !(await page.evaluate(() => window.__isRegisterButtonVisible())));
      await page.close();
    }

  } finally {
    if (browser) await browser.close();
    serverProc.kill();
  }

  console.log('\n' + log.join('\n'));
  console.log('\n==== PHASE F.5 — LicenseManagerPanel.js distinct-message — Playwright harness ====');
  console.log('PASSED: ' + passed + '   FAILED: ' + failed);
  if (failed > 0) process.exit(1);
}

main();
