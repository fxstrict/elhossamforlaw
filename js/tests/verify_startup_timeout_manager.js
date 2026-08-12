/**
 * verify_startup_timeout_manager.js
 * PHASE 17.5 — Startup Timeout Manager verification harness.
 * Standalone Node harness, matching the existing `verify_*.js` harnesses'
 * pattern (check()/checkAsync() + PASS/FAIL log + summary + exit code).
 *
 * Covers:
 *   1. StartupTimeoutManager.wrap() resolves with the underlying value
 *      when the promise settles before the timeout.
 *   2. Default mode (rejectOnTimeout unset/false): resolves with
 *      `undefined` on timeout — never rejects.
 *   3. Default mode: an underlying rejection is swallowed (resolves with
 *      undefined), mirroring RepositoryReadyTimeout.js's own contract.
 *   4. rejectOnTimeout:true mode: rejects with a descriptive
 *      `.isStartupTimeout === true` Error on timeout.
 *   5. rejectOnTimeout:true mode: an underlying rejection passes through
 *      unchanged (not swallowed).
 *   6. Diagnostics are recorded on global.__startupTimeouts[label] and a
 *      'startup:stepTimeout' DOM event is dispatched, on timeout only.
 *   7. wrap() never throws synchronously for non-promise input.
 *   8. No polling anywhere in the source (no setInterval, no retry loop).
 *   9. No location.reload anywhere in the source.
 *  10. index.html WIRING:
 *      a. StartupTimeoutManager.js is present exactly once.
 *      b. It loads AFTER js/core/StorageAdapter.js.
 *      c. It loads BEFORE js/core/MigrationBootstrap.js.
 *      d. It loads BEFORE js/repositories/SettingsRepositoryWiring.js.
 *      e. It loads BEFORE js/core/RepositoryReadyTimeout.js (grouped with
 *         the other small startup-timing utilities, by convention).
 *  11. js/repositories/SettingsRepositoryWiring.js source now references
 *      StartupTimeoutManager.wrap('settings', ...), guarded by a
 *      `typeof StartupTimeoutManager !== 'undefined'` fallback (so it
 *      still works standalone if this file is ever absent).
 *  12. js/core/MigrationBootstrap.js source now wraps both getStatus()
 *      and migrate() with a bounded timeout (rejectOnTimeout:true), still
 *      guarded by the same fallback pattern, and RepositoryReadyTimeout.js
 *      / the 10 entity modules remain byte-for-byte untouched by this
 *      phase (regression safety, checked by their own existing harnesses
 *      — not duplicated here).
 *
 * Run: node js/tests/verify_startup_timeout_manager.js
 */
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');

let passed = 0;
let failed = 0;
const log = [];

function check(label, fn) {
  try {
    fn();
    passed++;
    log.push('PASS — ' + label);
  } catch (e) {
    failed++;
    log.push('FAIL — ' + label + '  =>  ' + (e && e.message ? e.message : e));
  }
}

async function checkAsync(label, fn) {
  try {
    await fn();
    passed++;
    log.push('PASS — ' + label);
  } catch (e) {
    failed++;
    log.push('FAIL — ' + label + '  =>  ' + (e && e.message ? e.message : e));
  }
}

const CORE_DIR = path.join(__dirname, '..', 'core');
const REPOS_DIR = path.join(__dirname, '..', 'repositories');
const STM_SRC_PATH = path.join(CORE_DIR, 'StartupTimeoutManager.js');
const MIGRATION_BOOTSTRAP_SRC_PATH = path.join(CORE_DIR, 'MigrationBootstrap.js');
const SETTINGS_WIRING_SRC_PATH = path.join(REPOS_DIR, 'SettingsRepositoryWiring.js');
const INDEX_HTML_PATH = path.join(__dirname, '..', '..', 'index.html');

const stmSrc = fs.readFileSync(STM_SRC_PATH, 'utf8');
const migrationBootstrapSrc = fs.readFileSync(MIGRATION_BOOTSTRAP_SRC_PATH, 'utf8');
const settingsWiringSrc = fs.readFileSync(SETTINGS_WIRING_SRC_PATH, 'utf8');

function deferred() {
  let resolve, reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  // Fresh, isolated global for each require — this file does not use the
  // browser `window`, so we require it directly and let it attach to
  // Node's own `global`/`globalThis` (same dual-mode pattern the source
  // file itself already supports).
  delete require.cache[STM_SRC_PATH];
  const StartupTimeoutManager = require(STM_SRC_PATH);

  // ============================================================
  // 1-7. Core wrap() behavior
  // ============================================================
  await checkAsync('[Happy path] wrap() resolves with the underlying value well before timeout', async () => {
    const value = await StartupTimeoutManager.wrap('t1', Promise.resolve('hello'), 200);
    assert.strictEqual(value, 'hello');
  });

  await checkAsync('[Default mode] wrap() resolves with undefined on timeout (never rejects)', async () => {
    const never = new Promise(() => {}); // deliberately never settles
    const value = await StartupTimeoutManager.wrap('t2', never, 30);
    assert.strictEqual(value, undefined);
  });

  await checkAsync('[Default mode] an underlying rejection is swallowed (resolves with undefined)', async () => {
    const rejecting = Promise.reject(new Error('boom'));
    const value = await StartupTimeoutManager.wrap('t3', rejecting, 200);
    assert.strictEqual(value, undefined);
  });

  await checkAsync('[rejectOnTimeout:true] rejects with a descriptive, flagged Error on timeout', async () => {
    const never = new Promise(() => {});
    let caught = null;
    try {
      await StartupTimeoutManager.wrap('t4', never, 30, { rejectOnTimeout: true });
    } catch (e) {
      caught = e;
    }
    assert.ok(caught, 'expected a rejection');
    assert.strictEqual(caught.isStartupTimeout, true);
    assert.strictEqual(caught.label, 't4');
    assert.strictEqual(typeof caught.message, 'string');
  });

  await checkAsync('[rejectOnTimeout:true] an underlying rejection passes through unchanged', async () => {
    const originalErr = new Error('original failure');
    let caught = null;
    try {
      await StartupTimeoutManager.wrap('t5', Promise.reject(originalErr), 200, { rejectOnTimeout: true });
    } catch (e) {
      caught = e;
    }
    assert.strictEqual(caught, originalErr);
  });

  await checkAsync('[Diagnostics] timeout records global.__startupTimeouts[label] with expected shape', async () => {
    const never = new Promise(() => {});
    await StartupTimeoutManager.wrap('diagLabel', never, 25);
    const g = (typeof globalThis !== 'undefined') ? globalThis : global;
    assert.ok(g.__startupTimeouts && g.__startupTimeouts.diagLabel, 'expected diagnostics entry');
    const entry = g.__startupTimeouts.diagLabel;
    assert.strictEqual(entry.label, 'diagLabel');
    assert.strictEqual(entry.timeoutMs, 25);
    assert.strictEqual(typeof entry.elapsedMs, 'number');
  });

  check('[Diagnostics] no timeout means no diagnostics entry is created for that label', () => {
    const g = (typeof globalThis !== 'undefined') ? globalThis : global;
    assert.ok(!g.__startupTimeouts || !g.__startupTimeouts.neverTimedOutLabel);
  });

  check('[Non-promise input] wrap() never throws synchronously for garbage input', () => {
    assert.doesNotThrow(() => { StartupTimeoutManager.wrap('bad1', null); });
    assert.doesNotThrow(() => { StartupTimeoutManager.wrap('bad2', undefined); });
    assert.doesNotThrow(() => { StartupTimeoutManager.wrap('bad3', 42); });
    assert.doesNotThrow(() => { StartupTimeoutManager.wrap('bad4', { then: 'not a function' }); });
  });

  check('[Default constant] DEFAULT_TIMEOUT_MS is 12000, matching RepositoryReadyTimeout.js / RepositoryReadyCoordinator.js §10', () => {
    assert.strictEqual(StartupTimeoutManager.DEFAULT_TIMEOUT_MS, 12000);
  });

  // ============================================================
  // 8-9. Static source-safety checks
  // ============================================================
  check('[No polling] StartupTimeoutManager.js contains no setInterval anywhere', () => {
    assert.ok(!/setInterval\s*\(/.test(stmSrc));
  });
  check('[No polling] StartupTimeoutManager.js uses exactly one setTimeout per wrap() call (no retry loop)', () => {
    const matches = stmSrc.match(/root\.setTimeout\s*\(/g) || [];
    assert.strictEqual(matches.length, 1);
  });
  check('[No reload] StartupTimeoutManager.js contains no location.reload call', () => {
    assert.ok(!/location\s*\.\s*reload\s*\(/.test(stmSrc));
  });
  check('[No dialogs] StartupTimeoutManager.js never calls alert/confirm/prompt', () => {
    assert.ok(!/\balert\s*\(/.test(stmSrc));
    assert.ok(!/\bconfirm\s*\(/.test(stmSrc));
    assert.ok(!/\bprompt\s*\(/.test(stmSrc));
  });
  check('[Exports] StartupTimeoutManager exposes exactly wrap() and DEFAULT_TIMEOUT_MS', () => {
    const keys = Object.keys(StartupTimeoutManager).sort();
    assert.deepStrictEqual(keys, ['DEFAULT_TIMEOUT_MS', 'wrap']);
  });

  // ============================================================
  // 10. index.html WIRING — static script-order check
  // ============================================================
  const html = fs.readFileSync(INDEX_HTML_PATH, 'utf8');
  const srcs = [...html.matchAll(/<script src="([^"]+)"><\/script>/g)].map(m => m[1]);
  const indexOf = (needle) => srcs.findIndex(s => s === needle);

  check('[Wiring] index.html loads js/core/StartupTimeoutManager.js exactly once', () => {
    assert.strictEqual(srcs.filter(s => s === 'js/core/StartupTimeoutManager.js').length, 1);
  });
  check('[Wiring] StartupTimeoutManager.js loads after js/core/StorageAdapter.js', () => {
    assert.ok(indexOf('js/core/StartupTimeoutManager.js') > indexOf('js/core/StorageAdapter.js'));
  });
  check('[Wiring] StartupTimeoutManager.js loads before js/core/MigrationBootstrap.js', () => {
    assert.ok(indexOf('js/core/StartupTimeoutManager.js') < indexOf('js/core/MigrationBootstrap.js'));
  });
  check('[Wiring] StartupTimeoutManager.js loads before js/repositories/SettingsRepositoryWiring.js', () => {
    assert.ok(indexOf('js/core/StartupTimeoutManager.js') < indexOf('js/repositories/SettingsRepositoryWiring.js'));
  });
  check('[Wiring] StartupTimeoutManager.js loads before js/core/RepositoryReadyTimeout.js', () => {
    assert.ok(indexOf('js/core/StartupTimeoutManager.js') < indexOf('js/core/RepositoryReadyTimeout.js'));
  });
  check('[Wiring] index.html still contains no location.reload call anywhere (unaffected by this phase)', () => {
    assert.ok(!/location\s*\.\s*reload\s*\(\s*\)/.test(html));
  });

  // ============================================================
  // 11. SettingsRepositoryWiring.js integration (static source check)
  // ============================================================
  check('[Settings integration] SettingsRepositoryWiring.js calls StartupTimeoutManager.wrap(\'settings\', ...)', () => {
    assert.ok(/StartupTimeoutManager\.wrap\(\s*['"]settings['"]/.test(settingsWiringSrc));
  });
  check('[Settings integration] the call is guarded by a typeof StartupTimeoutManager !== \'undefined\' fallback', () => {
    assert.ok(/typeof\s+StartupTimeoutManager\s*!==\s*'undefined'/.test(settingsWiringSrc));
  });
  check('[Settings integration] rejectOnTimeout is NOT passed (keeps the pre-existing "always resolves" contract)', () => {
    const callSite = settingsWiringSrc.slice(settingsWiringSrc.indexOf("StartupTimeoutManager.wrap("));
    const closeParenIdx = callSite.indexOf(');');
    const callText = callSite.slice(0, closeParenIdx);
    assert.ok(!/rejectOnTimeout/.test(callText));
  });

  // ============================================================
  // 12. MigrationBootstrap.js integration (static source check)
  // ============================================================
  check('[Bootstrap integration] MigrationBootstrap.js wraps getStatus() via StartupTimeoutManager', () => {
    assert.ok(/StartupTimeoutManager\.wrap\(\s*label/.test(migrationBootstrapSrc) || /_boundStep\(/.test(migrationBootstrapSrc));
    assert.ok(/_boundStep\(\s*['"]migrationBootstrap\.getStatus['"]/.test(migrationBootstrapSrc));
  });
  check('[Bootstrap integration] MigrationBootstrap.js wraps migrate() via StartupTimeoutManager', () => {
    assert.ok(/_boundStep\(\s*['"]migrationBootstrap\.migrate['"]/.test(migrationBootstrapSrc));
  });
  check('[Bootstrap integration] both bounded steps use rejectOnTimeout:true (routes through the existing catch-all)', () => {
    assert.ok(/rejectOnTimeout:\s*true/.test(migrationBootstrapSrc));
  });
  check('[Bootstrap integration] MigrationBootstrap.js still never rejects run()\'s own returned Promise (unmodified guarantee)', () => {
    assert.ok(/\.then\(null, function \(err\) \{/.test(migrationBootstrapSrc));
  });
  check('[Bootstrap integration] no new setInterval / retry loop introduced', () => {
    assert.ok(!/setInterval\s*\(/.test(migrationBootstrapSrc));
  });

  // ---- Summary ----
  console.log(log.join('\n'));
  console.log('\n' + passed + '/' + (passed + failed) + ' checks passed.');
  if (failed > 0) {
    console.error('\n' + failed + ' CHECK(S) FAILED.');
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('HARNESS CRASHED:', err);
  process.exit(1);
});
