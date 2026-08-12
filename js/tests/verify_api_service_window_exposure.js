/**
 * verify_api_service_window_exposure.js
 * ================================================================
 * BUGFIX VERIFICATION — "خدمة الرفع غير متاحة حاليًا" on every
 * توكيل/مستند upload (js/modules/client-fields.js#uploadRowFile)
 * ================================================================
 * Root cause: js/api/api.js declares `const ApiService = {...}` at the
 * top level of a classic (non-module) <script>. Browsers do NOT copy a
 * top-level `const`/`let` binding onto the `window` object (unlike
 * `var`), so `window.ApiService` was always `undefined` even though the
 * bare `ApiService` identifier worked everywhere else in the codebase.
 * Two call sites explicitly gate on the `window`/`global` form:
 *   - js/modules/client-fields.js#uploadRowFile():
 *       if (!window.ApiService || typeof ApiService.uploadFile !== 'function')
 *   - js/debug/RuntimeDebugLayer.js's API instrumentation pass:
 *       if (global.ApiService) { ... }   // global === window
 * This harness loads the REAL js/api/api.js source (no mocking of its
 * own logic) inside a fresh vm sandbox that mimics a classic browser
 * <script> environment (a bare `window` object, no vm "module" wrapper),
 * which is the only way to reproduce the exact bug: Node's CommonJS
 * `require()` would wrap the file in a function scope and mask the
 * global-`const`-vs-`window` distinction entirely.
 * ================================================================
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const API_JS_PATH = path.join(__dirname, '..', 'api', 'api.js');
const SOURCE = fs.readFileSync(API_JS_PATH, 'utf8');

let passed = 0;
let failed = 0;
const failures = [];

function check(label, fn) {
  try {
    fn();
    passed++;
    console.log('  \u2713 ' + label);
  } catch (err) {
    failed++;
    failures.push({ label, error: err });
    console.log('  \u2717 ' + label + ' -> ' + (err && err.stack ? err.stack : err));
  }
}

/**
 * Builds a fresh sandbox that mirrors what a classic <script src="api.js">
 * tag executes against in a real browser: a top-level `window` object is
 * present, but nothing pre-populates `window.ApiService` — that is the
 * job of api.js itself (post-fix).
 */
function loadApiJsInBrowserLikeSandbox() {
  const sandbox = { window: {}, console, API_URL: 'https://example.test/exec' };
  vm.createContext(sandbox);
  vm.runInContext(SOURCE, sandbox, { filename: API_JS_PATH });
  return sandbox;
}

function main() {
  console.log('\n=== api.js — window.ApiService exposure (client-file-upload fix) ===');

  check('bare `ApiService` identifier is defined after loading api.js (pre-existing behavior, must not regress)', () => {
    const sandbox = loadApiJsInBrowserLikeSandbox();
    const bare = vm.runInContext('typeof ApiService', sandbox);
    assert.strictEqual(bare, 'object');
  });

  check('window.ApiService is defined (THE FIX — was always undefined before)', () => {
    const sandbox = loadApiJsInBrowserLikeSandbox();
    assert.ok(sandbox.window.ApiService, 'window.ApiService must be set by api.js');
  });

  check('window.ApiService.uploadFile is a function', () => {
    const sandbox = loadApiJsInBrowserLikeSandbox();
    assert.strictEqual(typeof sandbox.window.ApiService.uploadFile, 'function');
  });

  check('window.ApiService and the bare ApiService identifier are the SAME object (no duplicate/stale copy)', () => {
    const sandbox = loadApiJsInBrowserLikeSandbox();
    const same = vm.runInContext('window.ApiService === ApiService', sandbox);
    assert.strictEqual(same, true);
  });

  check('reproduces client-fields.js#uploadRowFile\'s exact guard and confirms it now passes', () => {
    const sandbox = loadApiJsInBrowserLikeSandbox();
    const guardTripped = vm.runInContext(
      '(!window.ApiService || typeof ApiService.uploadFile !== "function")',
      sandbox
    );
    assert.strictEqual(guardTripped, false, 'the "خدمة الرفع غير متاحة حاليًا" guard must no longer trip');
  });

  check('reproduces RuntimeDebugLayer.js\'s exact guard (`global.ApiService`) and confirms it now passes', () => {
    const sandbox = loadApiJsInBrowserLikeSandbox();
    // RuntimeDebugLayer.js is invoked as (function (global) { ... })(window),
    // so `global` there IS the same `window` object.
    const guardPasses = vm.runInContext('!!(window.ApiService)', sandbox);
    assert.strictEqual(guardPasses, true);
  });

  check('other existing ApiService methods survive unchanged (getPortalUrl, getQrImageUrl, syncRow)', () => {
    const sandbox = loadApiJsInBrowserLikeSandbox();
    ['getPortalUrl', 'getQrImageUrl', 'syncRow', 'updateData', 'deleteData', 'loadAllSheets']
      .forEach((m) => {
        assert.strictEqual(typeof sandbox.window.ApiService[m], 'function', m + ' must still be a function');
      });
  });

  console.log('\n' + passed + ' passed, ' + failed + ' failed\n');
  if (failed > 0) {
    failures.forEach((f) => console.log('FAILED: ' + f.label));
    process.exitCode = 1;
  }
}

main();
