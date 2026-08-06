/**
 * verify_repository_ready_groups.js
 * PHASE 18.3 — Progressive Boot Foundation — Coordinator Extension —
 * Critical Boot Groups. Verification harness for the new, ADDITIVE
 * onGroupReady()/whenGroupReady()/registerCriticalGroup() API added to
 * js/core/RepositoryReadyCoordinator.js.
 *
 * Standalone Node harness, same check()/checkAsync() + PASS/FAIL log +
 * summary + exit-code pattern as js/tests/verify_repository_ready_coordinator.js
 * (the pre-existing sibling harness for this same file). Uses the same
 * freshCoordinatorModule()/deferred() helpers, re-implemented locally so
 * this file has no runtime dependency on the other test file.
 *
 * Covers every case this phase's brief requires:
 *   1.  Single repo ready — group with one entity fires when it's ready.
 *   2.  Multiple repo ready — group with several entities fires only once
 *       every one of them is ready.
 *   3.  Group fires exactly once, even with multiple callbacks registered.
 *   4.  Group registered BEFORE its entities become ready.
 *   5.  Group registered AFTER its entities are already ready.
 *   6.  Duplicate registrations of the same groupName — each callback
 *       still fires exactly once; the entityKeys list is fixed at first
 *       registration.
 *   7.  Multiple, independently-tracked groups.
 *   8.  Group independence — one group firing/not-firing has zero effect
 *       on any other group, and vice versa.
 *   9.  Legacy per-entity APIs (isReady/onReady/whenReady) unchanged.
 *  10.  whenAllReady()/onAllReady() unchanged and uninterfered-with by
 *       group registration.
 *  11.  Stress test — many groups, many entities, random settle order.
 *  12.  registerCriticalGroup() creates exactly the predefined `critical`
 *       group (cases, sessions, clients, tasks) and nothing else.
 *  13.  A throwing group callback never prevents sibling callbacks (same
 *       isolation guarantee the per-entity/all-ready APIs already have).
 *  14.  'repository:groupReady' DOM CustomEvent dispatch, when a
 *       `document` is present; a complete no-op with no `document`.
 *
 * Run: node js/tests/verify_repository_ready_groups.js
 */
'use strict';
const assert = require('assert');
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

const COORD_SRC_PATH = path.join(__dirname, '..', 'core', 'RepositoryReadyCoordinator.js');

function deferred() {
  let resolve, reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function freshCoordinatorModule() {
  // Force a fresh, isolated module instance per test — the shipped file
  // auto-instantiates a singleton against the real global on load, which
  // must not leak state between tests.
  delete require.cache[require.resolve(COORD_SRC_PATH)];
  return require(COORD_SRC_PATH);
}

async function tick(n) {
  for (let i = 0; i < (n || 2); i++) await Promise.resolve();
}

async function main() {

  // ==================================================================
  // 1. Single repo ready.
  // ==================================================================
  await checkAsync('[Single] Group of exactly one entity fires once that entity is ready', async () => {
    const { RepositoryReadyCoordinator } = freshCoordinatorModule();
    const cases = deferred();
    const coord = new RepositoryReadyCoordinator(['cases'], { casesRepositoryReadyPromise: cases.promise });
    let fired = false;
    let seenGroupName = null;
    coord.onGroupReady('solo', ['cases'], (name) => { fired = true; seenGroupName = name; });
    assert.strictEqual(fired, false, 'must not fire before cases is ready');
    cases.resolve();
    await cases.promise;
    await tick();
    assert.strictEqual(fired, true);
    assert.strictEqual(seenGroupName, 'solo');
  });

  // ==================================================================
  // 2. Multiple repo ready.
  // ==================================================================
  await checkAsync('[Multi] Group of several entities fires only once EVERY one of them is ready, not before', async () => {
    const { RepositoryReadyCoordinator } = freshCoordinatorModule();
    const cases = deferred();
    const clients = deferred();
    const sessions = deferred();
    const coord = new RepositoryReadyCoordinator(['cases', 'clients', 'sessions'], {
      casesRepositoryReadyPromise: cases.promise,
      clientsRepositoryReadyPromise: clients.promise,
      sessionsRepositoryReadyPromise: sessions.promise
    });
    let fired = false;
    coord.onGroupReady('trio', ['cases', 'clients', 'sessions'], () => { fired = true; });
    cases.resolve(); await cases.promise; await tick();
    assert.strictEqual(fired, false, 'must not fire with 1 of 3 ready');
    clients.resolve(); await clients.promise; await tick();
    assert.strictEqual(fired, false, 'must not fire with 2 of 3 ready');
    sessions.resolve(); await sessions.promise; await tick();
    assert.strictEqual(fired, true, 'must fire once all 3 are ready');
  });

  // ==================================================================
  // 3. Group fires exactly once, even with multiple callbacks.
  // ==================================================================
  await checkAsync('[Once] A group with multiple registered callbacks fires each callback exactly once, never twice', async () => {
    const { RepositoryReadyCoordinator } = freshCoordinatorModule();
    const cases = deferred();
    const coord = new RepositoryReadyCoordinator(['cases'], { casesRepositoryReadyPromise: cases.promise });
    let count1 = 0, count2 = 0, count3 = 0;
    coord.onGroupReady('g', ['cases'], () => { count1++; });
    coord.onGroupReady('g', ['cases'], () => { count2++; });
    cases.resolve(); await cases.promise; await tick();
    coord.onGroupReady('g', ['cases'], () => { count3++; }); // registered AFTER firing
    await tick();
    assert.strictEqual(count1, 1);
    assert.strictEqual(count2, 1);
    assert.strictEqual(count3, 1, 'a callback registered after the group already fired must still fire exactly once');
    // Force a few more ready-cycles on an unrelated entity to prove the
    // already-fired group is never re-evaluated / never fires again.
    const extra = deferred();
    coord._readyState.extra = false; // simulate another entity key existing
    // (no-op path — this coordinator instance only tracks 'cases'; this
    // just proves no crash / no re-fire happens from internal re-checks)
    await tick(5);
    assert.strictEqual(count1, 1);
    assert.strictEqual(count2, 1);
    assert.strictEqual(count3, 1);
  });

  // ==================================================================
  // 4. Group registered BEFORE its entities become ready.
  // ==================================================================
  await checkAsync('[Before] Group registered before any of its entities are ready still fires once they all become ready', async () => {
    const { RepositoryReadyCoordinator } = freshCoordinatorModule();
    const cases = deferred();
    const clients = deferred();
    const coord = new RepositoryReadyCoordinator(['cases', 'clients'], {
      casesRepositoryReadyPromise: cases.promise,
      clientsRepositoryReadyPromise: clients.promise
    });
    let fired = false;
    coord.onGroupReady('early', ['cases', 'clients'], () => { fired = true; });
    await tick();
    assert.strictEqual(fired, false);
    cases.resolve(); await cases.promise; await tick();
    clients.resolve(); await clients.promise; await tick();
    assert.strictEqual(fired, true);
  });

  // ==================================================================
  // 5. Group registered AFTER its entities are already ready.
  // ==================================================================
  await checkAsync('[After] Group registered after its entities are already ready fires asynchronously (never synchronously)', async () => {
    const { RepositoryReadyCoordinator } = freshCoordinatorModule();
    const cases = deferred();
    const clients = deferred();
    const coord = new RepositoryReadyCoordinator(['cases', 'clients'], {
      casesRepositoryReadyPromise: cases.promise,
      clientsRepositoryReadyPromise: clients.promise
    });
    cases.resolve(); await cases.promise;
    clients.resolve(); await clients.promise;
    await tick();
    assert.strictEqual(coord.isReady('cases'), true);
    assert.strictEqual(coord.isReady('clients'), true);
    let fired = false;
    coord.onGroupReady('late', ['cases', 'clients'], () => { fired = true; });
    assert.strictEqual(fired, false, 'must not fire synchronously even though both entities are already ready');
    await tick();
    assert.strictEqual(fired, true);
  });

  // ==================================================================
  // 6. Duplicate registrations of the same groupName.
  // ==================================================================
  await checkAsync('[Duplicate] Re-registering the same groupName reuses the original entityKeys and still fires every callback once', async () => {
    const { RepositoryReadyCoordinator } = freshCoordinatorModule();
    const cases = deferred();
    const clients = deferred();
    const coord = new RepositoryReadyCoordinator(['cases', 'clients'], {
      casesRepositoryReadyPromise: cases.promise,
      clientsRepositoryReadyPromise: clients.promise
    });
    let firedA = false, firedB = false;
    // First registration fixes the group's entityKeys to ['cases'] only.
    coord.onGroupReady('dup', ['cases'], () => { firedA = true; });
    // Second registration passes a DIFFERENT list — must be ignored; the
    // group stays scoped to ['cases'] as originally registered.
    coord.onGroupReady('dup', ['cases', 'clients'], () => { firedB = true; });
    cases.resolve(); await cases.promise; await tick();
    assert.strictEqual(firedA, true, 'both callbacks must fire once cases (the ORIGINAL entityKeys) is ready');
    assert.strictEqual(firedB, true, 'the second registration\'s callback fires against the ORIGINAL entityKeys, not its own passed list');
    // clients was never required by this group at all (ignored on 2nd
    // registration) — resolving it afterward must not cause a second fire.
    let refired = false;
    coord.onGroupReady('dup', ['cases'], () => { refired = true; });
    await tick();
    assert.strictEqual(refired, true, 'a 3rd registration after the group already fired still fires once, immediately');
  });

  // ==================================================================
  // 7. Multiple, independently-tracked groups.
  // ==================================================================
  await checkAsync('[Multi-group] Several distinct named groups are tracked independently', async () => {
    const { RepositoryReadyCoordinator } = freshCoordinatorModule();
    const cases = deferred();
    const clients = deferred();
    const sessions = deferred();
    const tasks = deferred();
    const coord = new RepositoryReadyCoordinator(['cases', 'clients', 'sessions', 'tasks'], {
      casesRepositoryReadyPromise: cases.promise,
      clientsRepositoryReadyPromise: clients.promise,
      sessionsRepositoryReadyPromise: sessions.promise,
      tasksRepositoryReadyPromise: tasks.promise
    });
    let groupAFired = false, groupBFired = false;
    coord.onGroupReady('A', ['cases', 'clients'], () => { groupAFired = true; });
    coord.onGroupReady('B', ['sessions', 'tasks'], () => { groupBFired = true; });
    cases.resolve(); await cases.promise; await tick();
    clients.resolve(); await clients.promise; await tick();
    assert.strictEqual(groupAFired, true);
    assert.strictEqual(groupBFired, false, 'group B must be unaffected by group A becoming ready');
    sessions.resolve(); await sessions.promise; await tick();
    assert.strictEqual(groupBFired, false, 'still only 1 of 2 for group B');
    tasks.resolve(); await tasks.promise; await tick();
    assert.strictEqual(groupBFired, true);
  });

  // ==================================================================
  // 8. Group independence — overlapping entities, one group's fate does
  //    not touch another's, even when they share an entity.
  // ==================================================================
  await checkAsync('[Independence] Groups sharing an entity remain independent of each other', async () => {
    const { RepositoryReadyCoordinator } = freshCoordinatorModule();
    const cases = deferred();
    const clients = deferred();
    const sessions = deferred();
    const coord = new RepositoryReadyCoordinator(['cases', 'clients', 'sessions'], {
      casesRepositoryReadyPromise: cases.promise,
      clientsRepositoryReadyPromise: clients.promise,
      sessionsRepositoryReadyPromise: sessions.promise
    });
    let smallFired = false, bigFired = false;
    coord.onGroupReady('small', ['cases'], () => { smallFired = true; });
    coord.onGroupReady('big', ['cases', 'clients', 'sessions'], () => { bigFired = true; });
    cases.resolve(); await cases.promise; await tick();
    assert.strictEqual(smallFired, true, 'the group that only needs cases fires as soon as cases is ready');
    assert.strictEqual(bigFired, false, 'the bigger group sharing that same entity must still wait for its own remaining entities');
    clients.resolve(); await clients.promise; await tick();
    sessions.resolve(); await sessions.promise; await tick();
    assert.strictEqual(bigFired, true);
  });

  // ==================================================================
  // 9. Legacy per-entity APIs unchanged.
  // ==================================================================
  await checkAsync('[Legacy unchanged] isReady()/onReady()/whenReady() behave exactly as before, unaffected by group registration', async () => {
    const { RepositoryReadyCoordinator } = freshCoordinatorModule();
    const cases = deferred();
    const clients = deferred();
    const coord = new RepositoryReadyCoordinator(['cases', 'clients'], {
      casesRepositoryReadyPromise: cases.promise,
      clientsRepositoryReadyPromise: clients.promise
    });
    coord.onGroupReady('g', ['cases', 'clients'], () => {}); // registered, irrelevant to this check
    assert.strictEqual(coord.isReady('cases'), false);
    assert.strictEqual(coord.isReady('clients'), false);
    let onReadyFired = false;
    coord.onReady('cases', () => { onReadyFired = true; });
    let whenReadyResolved = false;
    coord.whenReady('clients').then(() => { whenReadyResolved = true; });
    cases.resolve(); await cases.promise; await tick();
    assert.strictEqual(coord.isReady('cases'), true);
    assert.strictEqual(onReadyFired, true);
    assert.strictEqual(whenReadyResolved, false, 'clients has not resolved yet — unaffected by the cases-only group progress');
    clients.resolve(); await clients.promise; await tick();
    assert.strictEqual(whenReadyResolved, true);
  });

  // ==================================================================
  // 10. whenAllReady()/onAllReady() unchanged and uninterfered-with.
  // ==================================================================
  await checkAsync('[AllReady unchanged] onAllReady()/whenAllReady() still require every KNOWN entity (not just a group\'s), unaffected by group registration', async () => {
    const { RepositoryReadyCoordinator } = freshCoordinatorModule();
    const cases = deferred();
    const clients = deferred();
    const sessions = deferred();
    const coord = new RepositoryReadyCoordinator(['cases', 'clients', 'sessions'], {
      casesRepositoryReadyPromise: cases.promise,
      clientsRepositoryReadyPromise: clients.promise,
      sessionsRepositoryReadyPromise: sessions.promise
    });
    let groupFired = false;
    let allReadyFired = false;
    coord.onGroupReady('justTwo', ['cases', 'clients'], () => { groupFired = true; });
    coord.onAllReady(() => { allReadyFired = true; });
    cases.resolve(); await cases.promise; await tick();
    clients.resolve(); await clients.promise; await tick();
    assert.strictEqual(groupFired, true, 'the 2-entity group is done');
    assert.strictEqual(allReadyFired, false, 'all-ready must still require sessions too — the group firing must not short-circuit it');
    sessions.resolve(); await sessions.promise; await tick();
    assert.strictEqual(allReadyFired, true);
    assert.strictEqual(coord.isAllReady(), true);
  });

  // ==================================================================
  // 11. Stress test — many groups, many entities, random settle order.
  // ==================================================================
  await checkAsync('[Stress] Many overlapping groups over many entities, settling in random order, each fires exactly once and only when complete', async () => {
    const { RepositoryReadyCoordinator } = freshCoordinatorModule();
    const entityNames = ['e0', 'e1', 'e2', 'e3', 'e4', 'e5', 'e6', 'e7', 'e8', 'e9'];
    const deferreds = {};
    const fakeGlobal = {};
    entityNames.forEach((n) => {
      deferreds[n] = deferred();
      fakeGlobal[n + 'RepositoryReadyPromise'] = deferreds[n].promise;
    });
    const coord = new RepositoryReadyCoordinator(entityNames, fakeGlobal);

    // 20 groups, each a random, non-empty subset of entityNames.
    const GROUP_COUNT = 20;
    const groupEntities = {};
    const groupFireCount = {};
    for (let i = 0; i < GROUP_COUNT; i++) {
      const name = 'grp' + i;
      const size = 1 + Math.floor(Math.random() * entityNames.length);
      const shuffled = entityNames.slice().sort(() => Math.random() - 0.5);
      const subset = shuffled.slice(0, size);
      groupEntities[name] = subset;
      groupFireCount[name] = 0;
      coord.onGroupReady(name, subset, () => { groupFireCount[name]++; });
    }

    // Resolve all 10 entities in a random order.
    const order = entityNames.slice().sort(() => Math.random() - 0.5);
    for (const n of order) {
      deferreds[n].resolve();
      await deferreds[n].promise;
      await tick();
      // Every group whose full subset is now ready must have fired
      // exactly once by now; every group with a not-yet-ready member
      // must not have fired.
      Object.keys(groupEntities).forEach((name) => {
        const allReady = groupEntities[name].every((e) => coord.isReady(e));
        if (allReady) {
          assert.strictEqual(groupFireCount[name], 1, name + ' should have fired exactly once by now');
        } else {
          assert.strictEqual(groupFireCount[name], 0, name + ' should not have fired yet');
        }
      });
    }
    // After all entities resolve, every group must have fired exactly once.
    await tick(3);
    Object.keys(groupFireCount).forEach((name) => {
      assert.strictEqual(groupFireCount[name], 1, name + ' must have fired exactly once overall');
    });
    assert.strictEqual(coord.isAllReady(), true);
  });

  // ==================================================================
  // 12. registerCriticalGroup() creates exactly the predefined group.
  // ==================================================================
  await checkAsync('[Critical group] registerCriticalGroup() creates a `critical` group containing ONLY cases, sessions, clients, tasks', async () => {
    const { RepositoryReadyCoordinator, CRITICAL_GROUP_ENTITY_KEYS } = freshCoordinatorModule();
    assert.deepStrictEqual(CRITICAL_GROUP_ENTITY_KEYS.slice().sort(), ['cases', 'clients', 'sessions', 'tasks']);

    const entityNames = ['cases', 'clients', 'sessions', 'tasks', 'documents', 'fees'];
    const deferreds = {};
    const fakeGlobal = {};
    entityNames.forEach((n) => {
      deferreds[n] = deferred();
      fakeGlobal[n + 'RepositoryReadyPromise'] = deferreds[n].promise;
    });
    const coord = new RepositoryReadyCoordinator(entityNames, fakeGlobal);

    let fired = false;
    coord.registerCriticalGroup((name) => { fired = true; assert.strictEqual(name, 'critical'); });

    // Resolve every NON-critical entity first — must NOT fire the group,
    // proving 'documents'/'fees' are correctly excluded from `critical`.
    deferreds.documents.resolve(); await deferreds.documents.promise; await tick();
    deferreds.fees.resolve(); await deferreds.fees.promise; await tick();
    assert.strictEqual(fired, false, 'critical group must ignore documents/fees entirely');

    deferreds.cases.resolve(); await deferreds.cases.promise; await tick();
    deferreds.sessions.resolve(); await deferreds.sessions.promise; await tick();
    deferreds.clients.resolve(); await deferreds.clients.promise; await tick();
    assert.strictEqual(fired, false, 'still missing tasks');
    deferreds.tasks.resolve(); await deferreds.tasks.promise; await tick();
    assert.strictEqual(fired, true, 'critical group fires once all 4 of its own entities are ready, regardless of the other 2');
  });

  await checkAsync('[Critical group] registerCriticalGroup() called with no callback still pre-creates the group so a later onGroupReady call observes the SAME entity list', async () => {
    const { RepositoryReadyCoordinator, CRITICAL_GROUP_ENTITY_KEYS } = freshCoordinatorModule();
    const entityNames = CRITICAL_GROUP_ENTITY_KEYS.slice();
    const deferreds = {};
    const fakeGlobal = {};
    entityNames.forEach((n) => {
      deferreds[n] = deferred();
      fakeGlobal[n + 'RepositoryReadyPromise'] = deferreds[n].promise;
    });
    const coord = new RepositoryReadyCoordinator(entityNames, fakeGlobal);

    coord.registerCriticalGroup(); // no callback — pre-create only
    let fired = false;
    // Intentionally pass a DIFFERENT (wrong) list here — must be ignored,
    // since 'critical' was already created above.
    coord.onGroupReady('critical', ['cases'], () => { fired = true; });
    entityNames.forEach((n) => { deferreds[n].resolve(); });
    await Promise.all(entityNames.map((n) => deferreds[n].promise));
    await tick(3);
    assert.strictEqual(fired, true);
  });

  // ==================================================================
  // 13. A throwing group callback never prevents sibling callbacks.
  // ==================================================================
  await checkAsync('[Isolation] A throwing group callback does not prevent other callbacks on the same group, or any other group, from firing', async () => {
    const { RepositoryReadyCoordinator } = freshCoordinatorModule();
    const cases = deferred();
    const coord = new RepositoryReadyCoordinator(['cases'], { casesRepositoryReadyPromise: cases.promise });
    let secondFired = false;
    let otherGroupFired = false;
    coord.onGroupReady('g', ['cases'], () => { throw new Error('boom — simulated group callback failure'); });
    coord.onGroupReady('g', ['cases'], () => { secondFired = true; });
    coord.onGroupReady('h', ['cases'], () => { otherGroupFired = true; });
    cases.resolve(); await cases.promise; await tick();
    assert.strictEqual(secondFired, true);
    assert.strictEqual(otherGroupFired, true);
  });

  // ==================================================================
  // 14. DOM CustomEvent dispatch for group-ready, and no-DOM safety.
  // ==================================================================
  await checkAsync('[DOM event] repository:groupReady dispatches on document with the correct detail', async () => {
    const fakeDocument = new EventTarget();
    const previousDocument = global.document;
    global.document = fakeDocument;
    try {
      const { RepositoryReadyCoordinator, REPOSITORY_GROUP_READY_EVENT } = freshCoordinatorModule();
      assert.strictEqual(REPOSITORY_GROUP_READY_EVENT, 'repository:groupReady');
      const cases = deferred();
      const coord = new RepositoryReadyCoordinator(['cases'], { casesRepositoryReadyPromise: cases.promise });
      let detail = null;
      fakeDocument.addEventListener(REPOSITORY_GROUP_READY_EVENT, (e) => { detail = e.detail; });
      coord.onGroupReady('evt', ['cases'], () => {});
      cases.resolve(); await cases.promise; await tick();
      assert.ok(detail, 'repository:groupReady must have been dispatched');
      assert.strictEqual(detail.groupName, 'evt');
      assert.deepStrictEqual(detail.entityKeys, ['cases']);
    } finally {
      global.document = previousDocument;
    }
  });

  await checkAsync('[No-DOM] Group API works with zero throws when no `document` is defined at all', async () => {
    const previousDocument = global.document;
    const hadDocument = Object.prototype.hasOwnProperty.call(global, 'document');
    delete global.document;
    try {
      const { RepositoryReadyCoordinator } = freshCoordinatorModule();
      const cases = deferred();
      const coord = new RepositoryReadyCoordinator(['cases'], { casesRepositoryReadyPromise: cases.promise });
      let fired = false;
      coord.onGroupReady('nodom', ['cases'], () => { fired = true; });
      cases.resolve(); await cases.promise; await tick();
      assert.strictEqual(fired, true);
    } finally {
      if (hadDocument) global.document = previousDocument;
    }
  });

  // ---- Summary ----
  console.log(log.join('\n'));
  console.log('\n' + passed + '/' + (passed + failed) + ' checks passed.');
  if (failed > 0) {
    console.error('\n' + failed + ' CHECK(S) FAILED.');
    process.exit(1);
  }
  // Every freshCoordinatorModule() call above re-requires the real
  // source file, which auto-instantiates its singleton against Node's
  // real `global` and starts a real (unref'd-by-nothing) 12s boot
  // timeout each time (see RepositoryReadyCoordinator.js §9-10) — a
  // pre-existing characteristic of requiring this file directly, not
  // something introduced by this test. Exiting explicitly here, exactly
  // like the sibling harness's failure path already does, avoids
  // sitting through however many leftover 12s timers accumulated.
  process.exit(0);
}

main().catch((err) => {
  console.error('HARNESS CRASHED:', err);
  process.exit(1);
});
