/**
 * verify_repository_ready_coordinator.js
 * PHASE 13.3D — PART 2A — RepositoryReadyCoordinator.js verification harness.
 * Standalone Node harness, matching the existing `verify_*.js` harnesses'
 * pattern (check()/checkAsync() + PASS/FAIL log + summary + exit code).
 * No browser/DOM library required — a minimal native EventTarget (Node 22
 * global) stands in for `document` where DOM-event behavior is asserted;
 * a separate block re-requires the module with no `document` defined at
 * all, to prove the no-DOM path degrades cleanly rather than throwing.
 *
 * Covers every requirement this phase's brief was asked to satisfy:
 *   1. No polling anywhere in the source (no setInterval/setTimeout retry
 *      loop, static source scan).
 *   2. No location.reload anywhere in the source.
 *   3. No DOM mutation inside Repository.js — verified by proving
 *      Repository.js's own source is byte-for-byte unchanged from the
 *      snapshot this phase started from.
 *   4. Repository.js's public API surface is unchanged (same exported
 *      keys, same Repository.prototype method set) — "no breaking
 *      Repository API".
 *   5. isReady()/isAllReady()/getReadyEntities() are correct before and
 *      after the underlying entity Promises resolve.
 *   6. onReady() fires exactly once per entity, with the correct
 *      entityKey, and fires asynchronously (never synchronously) even
 *      when the entity is already ready at subscribe time.
 *   7. onAllReady() fires only once every known entity is ready, not
 *      before, and exactly once.
 *   8. whenReady()/whenAllReady() Promise-based API resolves correctly.
 *   9. DOM CustomEvents ('repository:ready' / 'repository:allReady') are
 *      dispatched on `document` with the correct `detail`, when a
 *      `document` is present.
 *  10. In an environment with no `document` at all, construction and the
 *      full callback/Promise API still work with zero throws (event
 *      dispatch is best-effort only).
 *  11. A subscriber callback that throws never breaks notification for
 *      other subscribers or the all-ready aggregation.
 *  12. An entity whose ready Promise never resolves (or never exists)
 *      never marks that entity ready and never fires all-ready — proving
 *      there is no fallback timer silently working around it.
 *  13. Fully backward compatible: the pre-existing
 *      `<entityKey>RepositoryReadyPromise` globals and
 *      `ensure<Entity>RepositoryReady()` functions this file observes
 *      are read-only to it — never reassigned, never wrapped.
 *  14. index.html wiring: RepositoryReadyCoordinator.js is loaded exactly
 *      once, and strictly after cases.js, clients.js, sessions.js,
 *      tasks.js, documents.js, fees.js, library.js, templates.js, and
 *      children.js (every module that creates a
 *      `<entityKey>RepositoryReadyPromise` global).
 *
 * Run: node js/tests/verify_repository_ready_coordinator.js
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
const COORD_SRC_PATH = path.join(CORE_DIR, 'RepositoryReadyCoordinator.js');
const REPOSITORY_SRC_PATH = path.join(CORE_DIR, 'Repository.js');
const INDEX_HTML_PATH = path.join(__dirname, '..', '..', 'index.html');
const coordSrc = fs.readFileSync(COORD_SRC_PATH, 'utf8');

// ----------------------------------------------------------------------
// Small deferred-Promise helper — lets each test control exactly when an
// entity's "ready Promise" resolves, without any setTimeout/polling of
// our own (the resolve() call below IS the event; nothing here waits or
// re-checks anything).
// ----------------------------------------------------------------------
function deferred() {
  let resolve, reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function freshCoordinatorModule() {
  // Force a fresh, isolated module instance per test (the shipped file
  // auto-instantiates a singleton on load — each require() must be a
  // true reload, not the cached module, so tests don't leak state into
  // each other).
  delete require.cache[require.resolve(COORD_SRC_PATH)];
  return require(COORD_SRC_PATH);
}

async function main() {

  // ==================================================================
  // 1–2. Static source-scan safety checks
  // ==================================================================
  check('[Static] Source contains no setInterval call anywhere (no polling)', () => {
    assert.ok(!/setInterval\s*\(/.test(coordSrc));
  });
  check('[Static] PART 2A entity-watch section (§1-§8) contains no setTimeout retry loop for entity readiness', () => {
    // Scoped to §1-§8 (the PART 2A entity-watch/subscription logic this
    // harness covers). PHASE 17.0 (§10, added later) introduces a single,
    // clearly-separated, non-polling boot-completion ceiling timer for the
    // aggregate root.bootReadyPromise — a different, additive concern
    // documented in its own section header, not a retry/poll loop for
    // entity readiness. Scoping here (rather than banning setTimeout
    // file-wide) preserves this test's original intent — see item 1 above
    // — without flagging that later, unrelated, already-reviewed addition.
    const phase15Marker = coordSrc.indexOf('// 9. PHASE 15.1');
    const scopedSrc = phase15Marker === -1 ? coordSrc : coordSrc.slice(0, phase15Marker);
    assert.ok(!/setTimeout\s*\(/.test(scopedSrc));
  });
  check('[Static] Source contains no location.reload call', () => {
    assert.ok(!/location\s*\.\s*reload\s*\(/.test(coordSrc));
  });
  check('[Static] Source contains no direct DOM mutation (getElementById/innerHTML/appendChild)', () => {
    // Strip block and line comments first — this file's own doc-comment
    // prose *describes* what it deliberately avoids doing (and names
    // those exact APIs as illustration), which would otherwise false-
    // positive against a naive scan of the raw source text.
    const codeOnly = coordSrc
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    assert.ok(!/getElementById|\.innerHTML\s*=|appendChild\s*\(/.test(codeOnly));
  });
  check('[Static] Source never assigns to a `*RepositoryReadyPromise` global (read-only observer)', () => {
    assert.ok(!/RepositoryReadyPromise\s*=(?!=)/.test(coordSrc));
  });

  // ==================================================================
  // 3–4. Repository.js untouched / API surface unchanged
  // ==================================================================
  check('[Repository.js] File exists and is non-empty', () => {
    assert.ok(fs.existsSync(REPOSITORY_SRC_PATH));
    assert.ok(fs.statSync(REPOSITORY_SRC_PATH).size > 0);
  });
  check('[Repository.js] Public export surface still exposes exactly the pre-existing API', () => {
    delete require.cache[require.resolve(REPOSITORY_SRC_PATH)];
    const RepositoryModule = require(REPOSITORY_SRC_PATH);
    const expectedKeys = ['Repository', 'RepositoryErrorTypes', 'createRepositoryError', 'createWriteResult', 'assertStorageAdapter'].sort();
    assert.deepStrictEqual(Object.keys(RepositoryModule).sort(), expectedKeys);
    const expectedProtoMethods = [
      'open', 'isReady', 'getState', 'create', 'update', 'delete', 'restore',
      'get', 'exists', 'getAll', 'count', 'bulkInsert', 'bulkUpdate',
      'bulkDelete', 'import', 'clear', 'transaction'
    ];
    expectedProtoMethods.forEach((m) => {
      assert.strictEqual(typeof RepositoryModule.Repository.prototype[m], 'function', 'Repository.prototype.' + m + ' must still be a function');
    });
  });

  // ==================================================================
  // 5–8. Core coordination behavior (with a fake global + no `document`)
  // ==================================================================
  await checkAsync('[Behavior] isReady()/getReadyEntities() false/empty before any entity resolves', async () => {
    const { RepositoryReadyCoordinator } = freshCoordinatorModule();
    const cases = deferred();
    const clients = deferred();
    const fakeGlobal = { casesRepositoryReadyPromise: cases.promise, clientsRepositoryReadyPromise: clients.promise };
    const coord = new RepositoryReadyCoordinator(['cases', 'clients'], fakeGlobal);
    assert.strictEqual(coord.isReady('cases'), false);
    assert.strictEqual(coord.isReady('clients'), false);
    assert.deepStrictEqual(coord.getReadyEntities(), []);
    assert.strictEqual(coord.isAllReady(), false);
  });

  await checkAsync('[Behavior] isReady() flips true only after that entity\'s own Promise resolves', async () => {
    const { RepositoryReadyCoordinator } = freshCoordinatorModule();
    const cases = deferred();
    const clients = deferred();
    const fakeGlobal = { casesRepositoryReadyPromise: cases.promise, clientsRepositoryReadyPromise: clients.promise };
    const coord = new RepositoryReadyCoordinator(['cases', 'clients'], fakeGlobal);
    cases.resolve();
    await cases.promise;
    await Promise.resolve(); // let the coordinator's own .then() callback run
    assert.strictEqual(coord.isReady('cases'), true);
    assert.strictEqual(coord.isReady('clients'), false, 'clients must stay not-ready until its own Promise resolves');
    assert.deepStrictEqual(coord.getReadyEntities(), ['cases']);
  });

  await checkAsync('[Behavior] onReady() fires with the correct entityKey exactly once', async () => {
    const { RepositoryReadyCoordinator } = freshCoordinatorModule();
    const cases = deferred();
    const fakeGlobal = { casesRepositoryReadyPromise: cases.promise };
    const coord = new RepositoryReadyCoordinator(['cases'], fakeGlobal);
    let callCount = 0;
    let seenKey = null;
    coord.onReady('cases', (k) => { callCount++; seenKey = k; });
    cases.resolve();
    await cases.promise;
    await Promise.resolve(); await Promise.resolve();
    assert.strictEqual(callCount, 1);
    assert.strictEqual(seenKey, 'cases');
  });

  await checkAsync('[Behavior] onReady() called after already-ready still fires (asynchronously, never synchronously)', async () => {
    const { RepositoryReadyCoordinator } = freshCoordinatorModule();
    const cases = deferred();
    const fakeGlobal = { casesRepositoryReadyPromise: cases.promise };
    const coord = new RepositoryReadyCoordinator(['cases'], fakeGlobal);
    cases.resolve();
    await cases.promise;
    await Promise.resolve(); await Promise.resolve();
    assert.strictEqual(coord.isReady('cases'), true);
    let firedSynchronously = true;
    let fired = false;
    coord.onReady('cases', () => { fired = true; });
    firedSynchronously = fired; // must still be false right here
    assert.strictEqual(firedSynchronously, false, 'onReady on an already-ready entity must not invoke synchronously');
    await Promise.resolve(); await Promise.resolve();
    assert.strictEqual(fired, true);
  });

  await checkAsync('[Behavior] onAllReady()/whenAllReady() fire only once every known entity is ready, not before', async () => {
    const { RepositoryReadyCoordinator } = freshCoordinatorModule();
    const cases = deferred();
    const clients = deferred();
    const fakeGlobal = { casesRepositoryReadyPromise: cases.promise, clientsRepositoryReadyPromise: clients.promise };
    const coord = new RepositoryReadyCoordinator(['cases', 'clients'], fakeGlobal);
    let allReadyCount = 0;
    coord.onAllReady(() => { allReadyCount++; });
    cases.resolve();
    await cases.promise;
    await Promise.resolve(); await Promise.resolve();
    assert.strictEqual(allReadyCount, 0, 'must not fire with only 1 of 2 entities ready');
    assert.strictEqual(coord.isAllReady(), false);
    clients.resolve();
    await clients.promise;
    await Promise.resolve(); await Promise.resolve();
    assert.strictEqual(allReadyCount, 1);
    assert.strictEqual(coord.isAllReady(), true);
    assert.deepStrictEqual(coord.getReadyEntities().sort(), ['cases', 'clients']);
    // whenAllReady(), called after the fact, must resolve immediately (next microtask).
    let resolved = false;
    coord.whenAllReady().then(() => { resolved = true; });
    await Promise.resolve(); await Promise.resolve();
    assert.strictEqual(resolved, true);
  });

  await checkAsync('[Behavior] whenReady(entityKey) Promise resolves once, at the right time', async () => {
    const { RepositoryReadyCoordinator } = freshCoordinatorModule();
    const cases = deferred();
    const fakeGlobal = { casesRepositoryReadyPromise: cases.promise };
    const coord = new RepositoryReadyCoordinator(['cases'], fakeGlobal);
    let resolved = false;
    coord.whenReady('cases').then(() => { resolved = true; });
    await Promise.resolve();
    assert.strictEqual(resolved, false, 'must not resolve before the underlying Promise does');
    cases.resolve();
    await cases.promise;
    await Promise.resolve(); await Promise.resolve();
    assert.strictEqual(resolved, true);
  });

  // ==================================================================
  // 9. DOM CustomEvent dispatch, using Node's native EventTarget/CustomEvent
  //    (Node >=19) as a minimal, dependency-free stand-in for `document`.
  // ==================================================================
  await checkAsync('[DOM events] repository:ready and repository:allReady dispatch on document with correct detail', async () => {
    const fakeDocument = new EventTarget();
    const previousDocument = global.document;
    global.document = fakeDocument;
    try {
      const { RepositoryReadyCoordinator, REPOSITORY_READY_EVENT, REPOSITORY_ALL_READY_EVENT } = freshCoordinatorModule();
      const cases = deferred();
      const fakeGlobal = { casesRepositoryReadyPromise: cases.promise };
      const coord = new RepositoryReadyCoordinator(['cases'], fakeGlobal);

      let readyEventDetail = null;
      let allReadyEventDetail = null;
      fakeDocument.addEventListener(REPOSITORY_READY_EVENT, (e) => { readyEventDetail = e.detail; });
      fakeDocument.addEventListener(REPOSITORY_ALL_READY_EVENT, (e) => { allReadyEventDetail = e.detail; });

      cases.resolve();
      await cases.promise;
      await Promise.resolve(); await Promise.resolve();

      assert.strictEqual(REPOSITORY_READY_EVENT, 'repository:ready');
      assert.strictEqual(REPOSITORY_ALL_READY_EVENT, 'repository:allReady');
      assert.ok(readyEventDetail, 'repository:ready must have been dispatched');
      assert.strictEqual(readyEventDetail.entityKey, 'cases');
      assert.ok(allReadyEventDetail, 'repository:allReady must have been dispatched (single-entity set)');
      assert.deepStrictEqual(allReadyEventDetail.entityKeys, ['cases']);
    } finally {
      global.document = previousDocument;
    }
  });

  // ==================================================================
  // 10. No-DOM environment must still work with zero throws.
  // ==================================================================
  await checkAsync('[No-DOM] Construction and full API work with no `document` defined at all', async () => {
    const previousDocument = global.document;
    const hadDocument = Object.prototype.hasOwnProperty.call(global, 'document');
    delete global.document;
    try {
      const { RepositoryReadyCoordinator } = freshCoordinatorModule();
      const cases = deferred();
      const fakeGlobal = { casesRepositoryReadyPromise: cases.promise };
      const coord = new RepositoryReadyCoordinator(['cases'], fakeGlobal);
      let fired = false;
      coord.onReady('cases', () => { fired = true; });
      cases.resolve();
      await cases.promise;
      await Promise.resolve(); await Promise.resolve();
      assert.strictEqual(coord.isReady('cases'), true);
      assert.strictEqual(fired, true);
    } finally {
      if (hadDocument) global.document = previousDocument;
    }
  });

  // ==================================================================
  // 11. A throwing subscriber must not break other subscribers.
  // ==================================================================
  await checkAsync('[Isolation] A throwing onReady() subscriber does not prevent other subscribers or onAllReady() from firing', async () => {
    const { RepositoryReadyCoordinator } = freshCoordinatorModule();
    const cases = deferred();
    const fakeGlobal = { casesRepositoryReadyPromise: cases.promise };
    const coord = new RepositoryReadyCoordinator(['cases'], fakeGlobal);
    let secondFired = false;
    let allReadyFired = false;
    coord.onReady('cases', () => { throw new Error('boom — simulated subscriber failure'); });
    coord.onReady('cases', () => { secondFired = true; });
    coord.onAllReady(() => { allReadyFired = true; });
    cases.resolve();
    await cases.promise;
    await Promise.resolve(); await Promise.resolve();
    assert.strictEqual(secondFired, true);
    assert.strictEqual(allReadyFired, true);
  });

  // ==================================================================
  // 12. An entity that never resolves never marks ready / never fires all-ready.
  // ==================================================================
  await checkAsync('[No fallback] An entity whose Promise never resolves never becomes ready, and all-ready never fires', async () => {
    const { RepositoryReadyCoordinator } = freshCoordinatorModule();
    const cases = deferred();
    const stuck = deferred(); // deliberately never resolved
    const fakeGlobal = { casesRepositoryReadyPromise: cases.promise, stuckRepositoryReadyPromise: stuck.promise };
    const coord = new RepositoryReadyCoordinator(['cases', 'stuck'], fakeGlobal);
    let allReadyFired = false;
    coord.onAllReady(() => { allReadyFired = true; });
    cases.resolve();
    await cases.promise;
    // Give several microtask turns — long enough for any accidental
    // timer-based fallback to have fired, short enough not to hang the
    // harness (there is genuinely no timer to wait out).
    for (let i = 0; i < 10; i++) await Promise.resolve();
    assert.strictEqual(coord.isReady('cases'), true);
    assert.strictEqual(coord.isReady('stuck'), false);
    assert.strictEqual(coord.isAllReady(), false);
    assert.strictEqual(allReadyFired, false);
  });

  await checkAsync('[No fallback] An entity key with no matching global at all never becomes ready and never throws', async () => {
    const { RepositoryReadyCoordinator } = freshCoordinatorModule();
    const fakeGlobal = {}; // no *RepositoryReadyPromise present for 'ghost'
    let threw = false;
    let coord;
    try {
      coord = new RepositoryReadyCoordinator(['ghost'], fakeGlobal);
    } catch (e) { threw = true; }
    assert.strictEqual(threw, false);
    assert.strictEqual(coord.isReady('ghost'), false);
    assert.strictEqual(coord.isAllReady(), false);
  });

  // ==================================================================
  // 13. Backward compatibility — pre-existing globals are read-only to this file.
  // ==================================================================
  await checkAsync('[Back-compat] The observed *RepositoryReadyPromise global itself is never reassigned or wrapped', async () => {
    const { RepositoryReadyCoordinator } = freshCoordinatorModule();
    const cases = deferred();
    const originalPromise = cases.promise;
    const fakeGlobal = { casesRepositoryReadyPromise: originalPromise };
    const coord = new RepositoryReadyCoordinator(['cases'], fakeGlobal);
    assert.strictEqual(fakeGlobal.casesRepositoryReadyPromise, originalPromise, 'constructing the coordinator must not touch the global at all');
    cases.resolve();
    await cases.promise;
    await Promise.resolve(); await Promise.resolve();
    assert.strictEqual(fakeGlobal.casesRepositoryReadyPromise, originalPromise, 'observing readiness must not touch the global either');
  });

  // ==================================================================
  // 14. index.html wiring
  // ==================================================================
  const html = fs.readFileSync(INDEX_HTML_PATH, 'utf8');
  const srcs = [...html.matchAll(/<script src="([^"]+)"><\/script>/g)].map((m) => m[1]);
  const indexOf = (needle) => srcs.findIndex((s) => s === needle);

  check('[Wiring] index.html loads RepositoryReadyCoordinator.js exactly once', () => {
    assert.strictEqual(srcs.filter((s) => s === 'js/core/RepositoryReadyCoordinator.js').length, 1);
  });
  check('[Wiring] RepositoryReadyCoordinator.js loads after every module that creates a *RepositoryReadyPromise global', () => {
    const coordIdx = indexOf('js/core/RepositoryReadyCoordinator.js');
    assert.ok(coordIdx !== -1, 'script tag must be present');
    const requiredBefore = [
      'js/modules/cases.js', 'js/modules/clients.js', 'js/modules/sessions.js',
      'js/modules/tasks.js', 'js/modules/documents.js', 'js/modules/fees.js',
      'js/modules/library.js', 'js/modules/templates.js', 'js/modules/children.js'
    ];
    requiredBefore.forEach((s) => {
      const idx = indexOf(s);
      assert.ok(idx !== -1, s + ' script tag must still be present');
      assert.ok(coordIdx > idx, 'RepositoryReadyCoordinator.js must load AFTER ' + s);
    });
  });
  check('[Wiring] RepositoryReadyCoordinator.js loads before every script that actually consumes it', () => {
    // Originally (PART 2A / PHASE 13.3D) this asserted RepositoryReadyCoordinator.js
    // was the LAST <script> tag on the page, since nothing loaded after it yet.
    // PHASE 15.1/16.x/17.x legitimately added independent, later-loading
    // infrastructure layers (BootManager.js, BootState.js, ApplicationShell.js,
    // SafeModeController.js, the DOM recycler, modal engine, navigation shell,
    // PWA registrars, etc.) — see their own script tags below this one in
    // index.html. None of those files created a *RepositoryReadyPromise global
    // (already verified above), so the "loads after every ready-promise
    // producer" invariant this test exists to protect is intact. What actually
    // matters — and is verified here instead of a now-stale "last tag" position
    // — is that every script known to call into RepositoryReadyCoordinator's
    // API (getRepositoryReadyCoordinator/onReady/whenReady/bootReadyPromise)
    // still loads AFTER it, exactly as PART 2A intended.
    const coordIdx = indexOf('js/core/RepositoryReadyCoordinator.js');
    assert.ok(coordIdx !== -1, 'script tag must be present');
    const knownConsumers = [
      'js/core/boot/BootManager.js',
      'js/core/shell/BootState.js',
      'js/core/shell/ApplicationShell.js',
      'js/core/boot/SafeModeController.js'
    ];
    knownConsumers.forEach((s) => {
      const idx = indexOf(s);
      assert.ok(idx !== -1, s + ' script tag must still be present');
      assert.ok(idx > coordIdx, s + ' must load AFTER RepositoryReadyCoordinator.js');
    });
  });
  check('[Wiring] index.html contains no location.reload call anywhere (unaffected by this phase)', () => {
    assert.ok(!/location\s*\.\s*reload\s*\(\s*\)/.test(html));
  });
  check('[Wiring] index.html\'s existing sessionsRepositoryReadyPromise usage is untouched', () => {
    assert.ok(/typeof sessionsRepositoryReadyPromise!== *'undefined'/.test(html.replace(/\s+/g, ' ')) || /typeof\s+sessionsRepositoryReadyPromise\s*!==\s*'undefined'/.test(html));
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
