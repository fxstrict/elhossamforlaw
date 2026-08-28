/**
 * verify_toast_above_modal_stacking.js
 * PROBLEM 1 (Case Save Cycle audit, v79) — Regression test.
 *
 * ROOT CAUSE (proved by code trace, not guessed):
 *   css/variables.css defines a single documented "centralized z-index
 *   scale" (--z-topbar:50 ... --z-toast:1000 ... --z-license-overlay:99999)
 *   with an explicit comment: "Order below is the actual stacking order,
 *   low -> high" — i.e. --z-toast(1000) was designed to always render
 *   ABOVE --z-modal(200).
 *
 *   PHASE 33's ModalZIndexEngine (js/core/modal/ZIndexEngine.js) later
 *   introduced *dynamic* per-open-modal z-index assignment starting at
 *   BASE=1000 (ModalManager.js._restack sets el.style.zIndex =
 *   ModalZIndexEngine.forDepth(depth) on every open modal, overriding the
 *   static --z-modal:200 default). BASE=1000 was chosen only to beat the
 *   highest *legacy hard-coded* modal value (950) — its own comment does
 *   not account for --z-toast also being 1000.
 *
 *   Net effect: the first (and any) open modal now gets inline
 *   style.zIndex = "1000", exactly equal to .toast-container's z-index
 *   (var(--z-toast,1000)). With equal z-index, CSS paints same-level boxes
 *   back-to-front in DOM tree order (spec: "stacking contexts... painted
 *   ... according to tree order for same stacking level"). #toastContainer
 *   is declared at index.html:541; every <div class="modal-overlay"> (e.g.
 *   #modalCase) is declared later, several are even *after* </div><!--
 *   /app-shell -->. Being later in the DOM, the open modal (opacity:1,
 *   pointer-events:all, inset:0, backdrop-filter:blur) paints on top of
 *   and visually covers the toast — reproducing exactly the reported bug
 *   ("رسالة خطأ الحفظ تظهر خلف الصفحة/الـmodal").
 *
 * This test loads the REAL css/variables.css and the REAL
 * js/core/modal/ZIndexEngine.js (unmodified, via vm) and asserts the
 * invariant variables.css itself documents: toast must out-rank every
 * z-index the modal engine can assign, at any realistic stack depth —
 * not merely "not be numerically equal" (equal already loses to DOM
 * order; the fix must give toast a comfortable, collision-free margin).
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

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
    log.push('FAIL — ' + label + '  =>  ' + e.message);
  }
}

const ROOT = path.join(__dirname, '..', '..');

function readCssVar(cssText, varName) {
  var re = new RegExp('--' + varName + '\\s*:\\s*(\\d+)\\s*;');
  var m = cssText.match(re);
  if (!m) throw new Error('CSS variable --' + varName + ' not found');
  return parseInt(m[1], 10);
}

function loadZIndexEngine() {
  var filePath = path.join(ROOT, 'js', 'core', 'modal', 'ZIndexEngine.js');
  var code = fs.readFileSync(filePath, 'utf8');
  var sandbox = { window: {}, module: { exports: {} }, console: console };
  sandbox.global = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox, { filename: filePath });
  return sandbox.window.ModalZIndexEngine;
}

function main() {
  var variablesCss = fs.readFileSync(path.join(ROOT, 'css', 'variables.css'), 'utf8');
  var componentsCss = fs.readFileSync(path.join(ROOT, 'css', 'components.css'), 'utf8');
  var indexHtml = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

  var zToast = readCssVar(variablesCss, 'z-toast');
  var engine = loadZIndexEngine();

  check('.toast-container CSS references var(--z-toast, ...)', function () {
    assert.ok(
      /\.toast-container\{[^}]*z-index:\s*var\(--z-toast/.test(componentsCss),
      '.toast-container must derive its z-index from --z-toast'
    );
  });

  check('DOM order: #toastContainer is declared before #modalCase (Problem 1\'s reported modal) — equal z-index would let it paint over the toast', function () {
    var toastIdx = indexHtml.indexOf('id="toastContainer"');
    var modalCaseIdx = indexHtml.indexOf('<div class="modal-overlay" id="modalCase"');
    assert.ok(toastIdx !== -1, '#toastContainer not found in index.html');
    assert.ok(modalCaseIdx !== -1, '#modalCase not found in index.html');
    assert.ok(
      toastIdx < modalCaseIdx,
      '#modalCase no longer comes after #toastContainer in the DOM — re-verify the stacking assumption this test relies on'
    );
  });

  check('ModalZIndexEngine.forDepth(0) — the z-index assigned to the FIRST/only open modal — must be strictly below --z-toast', function () {
    var modalDepth0 = engine.forDepth(0);
    assert.ok(
      zToast > modalDepth0,
      '--z-toast (' + zToast + ') must be greater than the first open modal\'s assigned z-index (' + modalDepth0 +
      '); with DOM order placing modals after #toastContainer, any tie or inversion here hides toasts behind the modal'
    );
  });

  check('--z-toast stays above every realistic modal/confirm-dialog stack depth (0..20), not just depth 0', function () {
    for (var depth = 0; depth <= 20; depth++) {
      var regular = engine.forDepth(depth);
      var confirm = engine.forConfirmDialog(depth);
      assert.ok(zToast > regular, '--z-toast (' + zToast + ') must exceed forDepth(' + depth + ') = ' + regular);
      assert.ok(zToast > confirm, '--z-toast (' + zToast + ') must exceed forConfirmDialog(' + depth + ') = ' + confirm);
    }
  });

  console.log(log.join('\n'));
  console.log('\n' + passed + '/' + (passed + failed) + ' checks passed.');
  if (failed > 0) {
    console.log('\n' + failed + ' CHECK(S) FAILED.');
    process.exit(1);
  } else {
    console.log('\nALL CHECKS PASSED.');
    process.exit(0);
  }
}

main();
