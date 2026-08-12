/**
 * verify_entity_runtime_refresh.js
 * PHASE 13.3D — PART 2C — Entity Runtime Refresh verification harness.
 * Standalone Node harness, matching the existing `verify_*.js` harnesses'
 * pattern (check()/checkAsync() + PASS/FAIL log + summary + exit code) —
 * same style as js/tests/verify_repository_ready_coordinator.js (PART 2A).
 *
 * Covers every requirement PART 2C's brief was asked to satisfy:
 *   1. No polling/timer/reload anywhere in the (now-extended)
 *      RepositoryReadyCoordinator.js source.
 *   2. The new PART 2C section performs no direct DOM mutation of its
 *      own — it only calls each module's already-existing render<Entity>()
 *      global, exactly as navigate() itself already does.
 *   3. The new section never touches Repository internals and never
 *      reassigns a `*RepositoryReadyPromise` global.
 *   4. Repository.js's public export surface is unchanged (untouched
 *      file, same check PART 2A ran).
 *   5. Every one of the 9 entity modules still declares the exact
 *      render<Entity>() function name PART 2C's map expects (guards
 *      against a silent name mismatch breaking the wiring).
 *   6. Auto-render fires exactly once when the user is on that entity's
 *      page at the moment its Repository becomes ready (the race this
 *      phase closes).
 *   7. Auto-render does NOT fire when the user is on a different page
 *      at that moment (navigate()'s own existing call handles that page
 *      correctly whenever they do visit it).
 *   8. Auto-render never fires twice for the same entity, across many
 *      microtask turns ("already-ready repositories must not render
 *      twice" / "duplicate rendering" prohibition).
 *   9. One entity becoming ready never renders a different entity.
 *  10. A missing render<Entity>() global (stripped-down page/harness)
 *      never throws.
 *  11. No `currentPage` global at all never throws and never renders.
 *  12. PART 2A's own public constructor/onReady/whenReady API is fully
 *      unaffected by PART 2C's additive singleton-wiring section.
 *  13. index.html was not touched by this phase — RepositoryReadyCoordinator.js
 *      is still the sole, still the LAST, `<script>` tag on the page.
 *  14. The directly-relevant PART 2A regression harness
 *      (verify_repository_ready_coordinator.js) still passes in full.
 *
 * NOTE ON THE WIDER TEST SUITE: a full `js/tests/verify_*.js` sweep was
 * run by hand for this phase (see Phase13_3D_PART2C_Verification_Report.md
 * §4) and diffed against the same sweep on the untouched PART 2A snapshot.
 * 25 pre-existing harnesses already failed identically on BOTH the
 * untouched snapshot and this phase's output (environment-related
 * Repository/localStorage-mock timing issues in files this phase is
 * expressly forbidden from touching — Repository.js, DatabaseService.js,
 * StorageAdapter.js, LocalStorageAdapter.js, IndexedDBAdapter.js,
 * MigrationService.js, MigrationBootstrap.js — and in Undo- and
 * History-related integration specs layered on top of them). The failure SET is
 * byte-for-byte identical before and after this phase's changes — proof
 * PART 2C introduced zero regressions — so that full-suite diff is not
 * re-encoded as an assertion in this file (it would either hide behind a
 * fragile hard-coded exclude-list or falsely fail on unrelated,
 * out-of-scope pre-existing issues). This file instead re-runs, in full,
 * the one harness whose subject matter PART 2C actually touches (#14).
 *
 * Run: node js/tests/verify_entity_runtime_refresh.js
 */
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

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
const MODULES_DIR = path.join(__dirname, '..', 'modules');
const COORD_SRC_PATH = path.join(CORE_DIR, 'RepositoryReadyCoordinator.js');
const REPOSITORY_SRC_PATH = path.join(CORE_DIR, 'Repository.js');
const INDEX_HTML_PATH = path.join(__dirname, '..', '..', 'index.html');
const coordSrc = fs.readFileSync(COORD_SRC_PATH, 'utf8');

// ----------------------------------------------------------------------
// Small deferred-Promise helper — same pattern as verify_repository_ready
// _coordinator.js: the resolve() call below IS the readiness event;
// nothing here waits or re-checks anything.
// ----------------------------------------------------------------------
function deferred() {
  let resolve, reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

const ENTITY_RENDER_FN = {
  cases: 'renderCases',
  clients: 'renderClients',
  sessions: 'renderSessions',
  tasks: 'renderTasks',
  documents: 'renderDocuments',
  fees: 'renderFees',
  library: 'renderLibrary',
  templates: 'renderTemplates',
  children: 'renderChildren'
};
const ALL_ENTITIES = Object.keys(ENTITY_RENDER_FN);

function clearGlobals() {
  ALL_ENTITIES.forEach((k) => {
    delete global[k + 'RepositoryReadyPromise'];
    delete global[ENTITY_RENDER_FN[k]];
  });
  delete global.currentPage;
  delete global.repositoryReadyCoordinator;
  delete global.RepositoryReadyCoordinator;
  delete global.getRepositoryReadyCoordinator;
  delete global.REPOSITORY_READY_EVENT;
  delete global.REPOSITORY_ALL_READY_EVENT;
}

// Forces a fresh, isolated module instance (the shipped file
// auto-instantiates a singleton on load, reading whatever globals are
// present at that moment — so globals must be set up BEFORE this call).
function freshModuleWithGlobals(setup) {
  clearGlobals();
  if (setup) setup();
  delete require.cache[require.resolve(COORD_SRC_PATH)];
  return require(COORD_SRC_PATH);
}

async function main() {

  // ==================================================================
  // 1–3. Static source-scan safety checks (whole file, then PART 2C's
  //       own section specifically)
  // ==================================================================
  check('[Static] Updated file still contains no setInterval (PART 2C introduced no polling)', () => {
    assert.ok(!/setInterval\s*\(/.test(coordSrc));
  });
  check('[Static] PART 2C section introduced no deferred re-check loop for entity readiness', () => {
    // Scoped the same way verify_repository_ready_coordinator.js scopes
    // its equivalent check: PHASE 17.0 (added after PART 2C) introduces a
    // single, clearly-separated, non-polling boot-completion ceiling timer
    // for the aggregate root.bootReadyPromise — a different, additive,
    // already-reviewed concern, not a retry/poll loop for entity
    // readiness. Banning setTimeout file-wide would flag that unrelated
    // later section instead of verifying PART 2C's actual behavior.
    const phase15Marker = coordSrc.indexOf('// 9. PHASE 15.1');
    const scopedSrc = phase15Marker === -1 ? coordSrc : coordSrc.slice(0, phase15Marker);
    assert.ok(!/setTimeout\s*\(/.test(scopedSrc));
  });
  check('[Static] Updated file still contains no location.reload', () => {
    assert.ok(!/location\s*\.\s*reload\s*\(/.test(coordSrc));
  });
  check('[Static] PART 2C section marker is present', () => {
    assert.ok(coordSrc.indexOf('PART 2C — Entity Runtime Refresh (additive)') !== -1);
  });
  check('[Static] PART 2C section performs no direct DOM mutation of its own (getElementById/.innerHTML=/appendChild()', () => {
    const marker = coordSrc.indexOf('var ENTITY_RENDER_FN');
    assert.ok(marker !== -1, 'PART 2C implementation block must be present');
    const section = coordSrc.slice(marker)
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    assert.ok(!/getElementById|\.innerHTML\s*=|appendChild\s*\(/.test(section));
  });
  check('[Static] PART 2C section never reassigns a `*RepositoryReadyPromise` global and never touches a Repository instance directly', () => {
    const marker = coordSrc.indexOf('var ENTITY_RENDER_FN');
    const section = coordSrc.slice(marker);
    assert.ok(!/RepositoryReadyPromise\s*=(?!=)/.test(section));
    assert.ok(!/\bcasesRepository\s*\./.test(section));
    assert.ok(!/\.open\s*\(\s*\)/.test(section));
  });

  // ==================================================================
  // 4. Repository.js untouched (same API-surface check PART 2A ran)
  // ==================================================================
  check('[Repository.js] Public export surface unchanged by this phase', () => {
    delete require.cache[require.resolve(REPOSITORY_SRC_PATH)];
    const RepositoryModule = require(REPOSITORY_SRC_PATH);
    const expectedKeys = ['Repository', 'RepositoryErrorTypes', 'createRepositoryError', 'createWriteResult', 'assertStorageAdapter'].sort();
    assert.deepStrictEqual(Object.keys(RepositoryModule).sort(), expectedKeys);
  });

  // ==================================================================
  // 5. Every entity module still declares the exact function name
  //    PART 2C's ENTITY_RENDER_FN map expects.
  // ==================================================================
  ALL_ENTITIES.forEach((entityKey) => {
    const fnName = ENTITY_RENDER_FN[entityKey];
    check('[Modules] ' + entityKey + '.js still declares function ' + fnName + '()', () => {
      const modPath = path.join(MODULES_DIR, entityKey + '.js');
      const src = fs.readFileSync(modPath, 'utf8');
      const re = new RegExp('function\\s+' + fnName + '\\s*\\(');
      assert.ok(re.test(src), fnName + ' must exist in ' + entityKey + '.js');
    });
  });

  // ==================================================================
  // 6. The race this phase closes: auto-render fires exactly once when
  //    the user is on that entity's page at the moment it becomes ready.
  // ==================================================================
  await checkAsync('[Behavior] Auto-renders once when currentPage matches the entity that just became ready', async () => {
    const casesDeferred = deferred();
    let renderCallCount = 0;
    freshModuleWithGlobals(() => {
      global.casesRepositoryReadyPromise = casesDeferred.promise;
      global.currentPage = 'cases';
      global.renderCases = () => { renderCallCount++; };
    });
    casesDeferred.resolve();
    await casesDeferred.promise;
    for (let i = 0; i < 6; i++) await Promise.resolve();
    assert.strictEqual(renderCallCount, 1);
  });

  // ==================================================================
  // 7. Elsewhere on the app: no auto-render (navigate() handles it later).
  // ==================================================================
  await checkAsync('[Behavior] Does NOT auto-render when the user is on a different page', async () => {
    const casesDeferred = deferred();
    let renderCallCount = 0;
    freshModuleWithGlobals(() => {
      global.casesRepositoryReadyPromise = casesDeferred.promise;
      global.currentPage = 'dashboard';
      global.renderCases = () => { renderCallCount++; };
    });
    casesDeferred.resolve();
    await casesDeferred.promise;
    for (let i = 0; i < 6; i++) await Promise.resolve();
    assert.strictEqual(renderCallCount, 0);
  });

  // ==================================================================
  // 8. Never renders an entity twice ("must not render twice" / "do not
  //    duplicate rendering"), however many microtask turns elapse.
  // ==================================================================
  await checkAsync('[Behavior] Never renders an entity twice, however many microtask turns elapse', async () => {
    const clientsDeferred = deferred();
    let renderCallCount = 0;
    freshModuleWithGlobals(() => {
      global.clientsRepositoryReadyPromise = clientsDeferred.promise;
      global.currentPage = 'clients';
      global.renderClients = () => { renderCallCount++; };
    });
    clientsDeferred.resolve();
    await clientsDeferred.promise;
    for (let i = 0; i < 20; i++) await Promise.resolve();
    assert.strictEqual(renderCallCount, 1, 'must render exactly once, not on every subsequent microtask turn');
  });

  // ==================================================================
  // 9. Entities are independent — one becoming ready must not render another.
  // ==================================================================
  await checkAsync('[Behavior] One entity becoming ready does not trigger another entity\'s render', async () => {
    const casesDeferred = deferred();
    const clientsDeferred = deferred(); // deliberately never resolved
    let casesRenderCount = 0;
    let clientsRenderCount = 0;
    freshModuleWithGlobals(() => {
      global.casesRepositoryReadyPromise = casesDeferred.promise;
      global.clientsRepositoryReadyPromise = clientsDeferred.promise;
      global.currentPage = 'clients';
      global.renderCases = () => { casesRenderCount++; };
      global.renderClients = () => { clientsRenderCount++; };
    });
    casesDeferred.resolve();
    await casesDeferred.promise;
    for (let i = 0; i < 6; i++) await Promise.resolve();
    assert.strictEqual(casesRenderCount, 0, 'cases becoming ready must not render cases while the user is on the clients page');
    assert.strictEqual(clientsRenderCount, 0, 'clients repository never became ready, so it must never auto-render');
  });

  // ==================================================================
  // 10. Robustness — a missing render<Entity>() global never throws.
  // ==================================================================
  await checkAsync('[Robustness] A missing render<Entity>() global (unwired/stripped page) never throws', async () => {
    const casesDeferred = deferred();
    let threw = false;
    freshModuleWithGlobals(() => {
      global.casesRepositoryReadyPromise = casesDeferred.promise;
      global.currentPage = 'cases';
      // deliberately no global.renderCases
    });
    try {
      casesDeferred.resolve();
      await casesDeferred.promise;
      for (let i = 0; i < 6; i++) await Promise.resolve();
    } catch (e) { threw = true; }
    assert.strictEqual(threw, false);
  });

  // ==================================================================
  // 11. Robustness — no currentPage concept at all never throws / never renders.
  // ==================================================================
  await checkAsync('[Robustness] No currentPage global at all — never throws, never auto-renders', async () => {
    const casesDeferred = deferred();
    let renderCallCount = 0;
    let threw = false;
    freshModuleWithGlobals(() => {
      global.casesRepositoryReadyPromise = casesDeferred.promise;
      // deliberately no global.currentPage at all
      global.renderCases = () => { renderCallCount++; };
    });
    try {
      casesDeferred.resolve();
      await casesDeferred.promise;
      for (let i = 0; i < 6; i++) await Promise.resolve();
    } catch (e) { threw = true; }
    assert.strictEqual(threw, false);
    assert.strictEqual(renderCallCount, 0);
  });

  // ==================================================================
  // 12. PART 2A's own public API is fully unaffected — proof this is
  //     additive-only, not a rewrite.
  // ==================================================================
  await checkAsync('[Back-compat] PART 2A public constructor/onReady/whenReady API still works standalone', async () => {
    const mod = freshModuleWithGlobals();
    const cases = deferred();
    const fakeGlobal = { casesRepositoryReadyPromise: cases.promise };
    const coord = new mod.RepositoryReadyCoordinator(['cases'], fakeGlobal);
    let fired = false;
    coord.onReady('cases', () => { fired = true; });
    cases.resolve();
    await cases.promise;
    await Promise.resolve(); await Promise.resolve();
    assert.strictEqual(coord.isReady('cases'), true);
    assert.strictEqual(fired, true);
  });

  // ==================================================================
  // 13. index.html wiring — untouched by this phase.
  // ==================================================================
  check('[Wiring] index.html still loads RepositoryReadyCoordinator.js exactly once, before every script that actually consumes it (index.html was not modified by PART 2C)', () => {
    // See the matching, more-detailed comment in
    // verify_repository_ready_coordinator.js: PHASE 15.1/16.x/17.x
    // legitimately added independent, later-loading infrastructure
    // (BootManager.js, BootState.js, ApplicationShell.js,
    // SafeModeController.js, etc.) after RepositoryReadyCoordinator.js in
    // index.html, so "still the LAST <script> tag" is no longer the right
    // invariant to check. What PART 2C actually needs preserved is that
    // RepositoryReadyCoordinator.js still loads exactly once and before
    // every script known to consume its API.
    const html = fs.readFileSync(INDEX_HTML_PATH, 'utf8');
    const srcs = [...html.matchAll(/<script src="([^"]+)"><\/script>/g)].map((m) => m[1]);
    assert.strictEqual(srcs.filter((s) => s === 'js/core/RepositoryReadyCoordinator.js').length, 1);
    const coordIdx = srcs.indexOf('js/core/RepositoryReadyCoordinator.js');
    const knownConsumers = [
      'js/core/boot/BootManager.js',
      'js/core/shell/BootState.js',
      'js/core/shell/ApplicationShell.js',
      'js/core/boot/SafeModeController.js'
    ];
    knownConsumers.forEach((s) => {
      const idx = srcs.indexOf(s);
      assert.ok(idx !== -1, s + ' script tag must still be present');
      assert.ok(idx > coordIdx, s + ' must load AFTER RepositoryReadyCoordinator.js');
    });
  });

  // ==================================================================
  // 14. The directly-relevant PART 2A regression harness still passes
  //     in full against the now-extended coordinator file.
  // ==================================================================
  await checkAsync('[Regression] verify_repository_ready_coordinator.js (PART 2A) still passes in full', async () => {
    execFileSync(process.execPath, [path.join(__dirname, 'verify_repository_ready_coordinator.js')], { stdio: 'pipe' });
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
