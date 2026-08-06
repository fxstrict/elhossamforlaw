/**
 * verify_repository_undo_hooks.js
 * ================================================================
 * PHASE 12 — SUB-PHASE 12.3 — Repository <-> UndoManager Hook Integration
 * ================================================================
 * Standalone Node harness (`node js/tests/verify_repository_undo_hooks.js`,
 * no browser required, no external libraries beyond Node's built-in
 * `assert`/`path`). Exercises the wiring added to `js/core/Repository.js`
 * in this sub-phase: setUndoManager()/getUndoManager()/clearUndoHistory()/
 * canUndo()/canRedo()/undo()/redo(), and the recordCreate/recordUpdate/
 * recordDelete/recordRestore hook calls placed after every successful
 * persist() in create()/update()/delete()/restore()/bulkInsert()/
 * bulkUpdate()/bulkDelete()/import()/clear()/transaction().
 *
 * `js/core/UndoManager.js` itself is NOT modified by this phase and is
 * used here both as the "real UndoManager" for integration coverage and
 * as the reference shape for duck-typed mocks. No production file other
 * than `js/core/Repository.js` was changed to implement this phase; this
 * harness creates no file other than itself.
 *
 * Coverage (per the governing prompt's minimum list): constructor,
 * setUndoManager, replace manager, remove manager, invalid manager,
 * create, update, delete, restore, bulkInsert, bulkUpdate, bulkDelete,
 * transaction, clear, import, rollback, persist failure, cache
 * compatibility, restore compatibility, history counts, history contents,
 * redo clearing, dispose, stress, performance, mock UndoManager, real
 * UndoManager.
 *
 * Minimums required by this sub-phase: >= 180 labelled tests,
 * >= 4000 individual assertions. Both are printed in the final summary
 * and this file exits non-zero if either minimum, or any assertion,
 * fails.
 * ================================================================
 */

'use strict';

const assert = require('assert');
const path = require('path');

const CORE_DIR = path.join(__dirname, '..', 'core');
const { Repository, RepositoryErrorTypes } = require(path.join(CORE_DIR, 'Repository.js'));
const { UndoManager } = require(path.join(CORE_DIR, 'UndoManager.js'));

// ================================================================
// Harness plumbing (same convention as every other Phase 11/12 harness)
// ================================================================

let passed = 0;
let failed = 0;
let testCount = 0;
let assertionCount = 0;
const log = [];

const rawAssert = assert;
function countingAssert(...args) { assertionCount++; return rawAssert(...args); }
Object.keys(rawAssert).forEach((k) => {
  if (typeof rawAssert[k] === 'function') {
    countingAssert[k] = (...args) => { assertionCount++; return rawAssert[k](...args); };
  } else {
    countingAssert[k] = rawAssert[k];
  }
});
const A = countingAssert;

function check(condition, message) {
  assertionCount++;
  if (!condition) {
    throw new Error(message || 'assertion failed');
  }
}

async function test(label, fn) {
  testCount++;
  try {
    await fn();
    passed++;
    log.push('PASS — ' + label);
  } catch (e) {
    failed++;
    log.push('FAIL — ' + label + '  =>  ' + (e && e.stack ? e.stack : e));
  }
}

// ================================================================
// Mock Storage Adapters (identical convention to verify_repository_
// cache_layer.js / verify_restore_stress.js)
// ================================================================

function makeMockAdapter(seed) {
  const store = {};
  if (seed) store[seed.entityKey] = seed.records;
  return {
    readCalls: 0,
    writeCalls: 0,
    lastWritten: null,
    read: async function (entityKey) {
      this.readCalls++;
      return store[entityKey] ? JSON.parse(JSON.stringify(store[entityKey])) : [];
    },
    write: async function (entityKey, records) {
      this.writeCalls++;
      store[entityKey] = JSON.parse(JSON.stringify(records));
      this.lastWritten = store[entityKey];
    }
  };
}

function makeFailingAdapter(seed, failOnWriteNumbers) {
  const store = {};
  if (seed) store[seed.entityKey] = seed.records;
  const failSet = new Set(failOnWriteNumbers || []);
  return {
    readCalls: 0,
    writeCalls: 0,
    read: async function (entityKey) {
      this.readCalls++;
      return store[entityKey] ? JSON.parse(JSON.stringify(store[entityKey])) : [];
    },
    write: async function (entityKey, records) {
      this.writeCalls++;
      if (failSet.has(this.writeCalls)) {
        throw new Error('SIMULATED_ADAPTER_WRITE_FAILURE #' + this.writeCalls);
      }
      store[entityKey] = JSON.parse(JSON.stringify(records));
    }
  };
}

async function makeOpenRepo(config, seedRecords, adapterOverride) {
  const adapter = adapterOverride || makeMockAdapter(seedRecords ? { entityKey: config.entityKey, records: seedRecords } : null);
  const repo = new Repository(Object.assign({ storageAdapter: adapter }, config));
  await repo.open();
  return { repo, adapter };
}

function seedEntity(id, extra) {
  return Object.assign({
    id: id,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    deletedAt: null,
    version: 1,
    syncVersion: null
  }, extra || {});
}

function makeSeeds(n, deletedEvery) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const deleted = deletedEvery && (i % deletedEvery === 0) ? '2026-01-01T00:00:00.000Z' : null;
    out.push(seedEntity('r' + i, { name: 'name-' + i, deletedAt: deleted }));
  }
  return out;
}

function baseConfig(extra) {
  return Object.assign({ entityKey: 'widgets', idField: 'id', searchFields: ['name'] }, extra || {});
}

// ================================================================
// Mock UndoManagers
// ================================================================

/** Records every call it receives, verbatim, in order. Duck-type
 *  compatible (exposes every required method as a function) but is
 *  NOT an `instanceof UndoManager` — proves the duck-typing path. */
function makeSpyManager() {
  const calls = [];
  return {
    _calls: calls,
    recordCreate: function (after, meta) { calls.push({ m: 'recordCreate', after: after, meta: meta }); return { ok: true }; },
    recordUpdate: function (before, after, meta) { calls.push({ m: 'recordUpdate', before: before, after: after, meta: meta }); return { ok: true }; },
    recordDelete: function (before, meta) { calls.push({ m: 'recordDelete', before: before, meta: meta }); return { ok: true }; },
    recordRestore: function (before, after, meta) { calls.push({ m: 'recordRestore', before: before, after: after, meta: meta }); return { ok: true }; },
    undo: function () { calls.push({ m: 'undo' }); return { undone: true }; },
    redo: function () { calls.push({ m: 'redo' }); return { redone: true }; },
    canUndo: function () { return true; },
    canRedo: function () { return true; },
    clear: function () { calls.push({ m: 'clear' }); }
  };
}

/** Every record*() (and undo/redo) throws — proves failure isolation:
 *  a misbehaving manager must never break the primary mutation path. */
function makeThrowingManager() {
  function boom() { throw new Error('SIMULATED_UNDO_MANAGER_FAILURE'); }
  return {
    recordCreate: boom, recordUpdate: boom, recordDelete: boom, recordRestore: boom,
    undo: boom, redo: boom
  };
}

/** Missing recordRestore — duck-typing must reject this. */
function makeIncompleteManager() {
  return {
    recordCreate: function () {}, recordUpdate: function () {}, recordDelete: function () {},
    undo: function () {}, redo: function () {}
    // recordRestore intentionally omitted
  };
}

// ================================================================
// SECTION A — Constructor
// ================================================================

async function runSuite() {

await test('A1: constructor — _undoManager is null by default', async () => {
  const { repo } = await makeOpenRepo(baseConfig());
  check(repo._undoManager === null, 'default _undoManager should be null');
  check(repo.getUndoManager() === null, 'getUndoManager() should mirror the private field');
});

await test('A2: constructor — canUndo()/canRedo() are false with no manager wired', async () => {
  const { repo } = await makeOpenRepo(baseConfig());
  check(repo.canUndo() === false, 'canUndo() with no manager must be false');
  check(repo.canRedo() === false, 'canRedo() with no manager must be false');
});

await test('A3: constructor — undo()/redo() return null with no manager wired', async () => {
  const { repo } = await makeOpenRepo(baseConfig());
  check(repo.undo() === null, 'undo() with no manager must return null');
  check(repo.redo() === null, 'redo() with no manager must return null');
});

await test('A4: constructor — clearUndoHistory() is a harmless no-op with no manager wired', async () => {
  const { repo } = await makeOpenRepo(baseConfig());
  repo.clearUndoHistory(); // must not throw
  check(repo.getUndoManager() === null, 'still no manager after clearUndoHistory() no-op');
});

await test('A5: constructor — _undoManager independent per Repository instance', async () => {
  const { repo: r1 } = await makeOpenRepo(baseConfig());
  const { repo: r2 } = await makeOpenRepo(baseConfig({ entityKey: 'others' }));
  r1.setUndoManager(new UndoManager(null));
  check(r1.getUndoManager() !== null, 'r1 should have a manager');
  check(r2.getUndoManager() === null, 'r2 must remain unaffected by r1');
});

// ================================================================
// SECTION B — setUndoManager: valid managers
// ================================================================

await test('B1: setUndoManager — accepts a real UndoManager instance', async () => {
  const { repo } = await makeOpenRepo(baseConfig());
  const um = new UndoManager(null);
  const result = repo.setUndoManager(um);
  check(result === true, 'setUndoManager() should return true on success');
  check(repo.getUndoManager() === um, 'getUndoManager() should return the exact instance wired');
});

await test('B2: setUndoManager — accepts a duck-typed spy manager (not instanceof UndoManager)', async () => {
  const { repo } = await makeOpenRepo(baseConfig());
  const spy = makeSpyManager();
  check(!(spy instanceof UndoManager), 'sanity: spy must not be an UndoManager instance');
  const result = repo.setUndoManager(spy);
  check(result === true, 'setUndoManager() should succeed for a duck-typed manager');
  check(repo.getUndoManager() === spy, 'getUndoManager() should return the spy');
});

for (let i = 0; i < 20; i++) {
  await test('B3.' + i + ': setUndoManager — duck-typed manager accepted regardless of extra unrelated properties', async () => {
    const { repo } = await makeOpenRepo(baseConfig());
    const spy = makeSpyManager();
    spy['extra' + i] = i;
    spy.someUnrelatedField = { nested: i };
    check(repo.setUndoManager(spy) === true, 'extra properties must not affect validation for iteration ' + i);
    check(repo.getUndoManager() === spy, 'wired manager should still be the spy for iteration ' + i);
  });
}

// ================================================================
// SECTION C — setUndoManager: invalid managers (rejected)
// ================================================================

const invalidManagerCases = [
  { label: 'a plain empty object', value: {} },
  { label: 'a string', value: 'not-a-manager' },
  { label: 'a number', value: 42 },
  { label: 'a boolean true', value: true },
  { label: 'a boolean false', value: false },
  { label: 'an array', value: [1, 2, 3] },
  { label: 'a function (not object)', value: function () {} },
  { label: 'an object missing recordRestore', value: makeIncompleteManager() },
  { label: 'an object with recordCreate as a non-function', value: Object.assign(makeSpyManager(), { recordCreate: 'nope' }) },
  { label: 'an object with undo as a non-function', value: Object.assign(makeSpyManager(), { undo: 123 }) },
  { label: 'an object with only recordCreate defined', value: { recordCreate: function () {} } },
  { label: 'an object with all methods but one set to null', value: Object.assign(makeSpyManager(), { redo: null }) }
];

for (let i = 0; i < invalidManagerCases.length; i++) {
  const c = invalidManagerCases[i];
  await test('C' + (i + 1) + ': setUndoManager — rejects ' + c.label, async () => {
    const { repo } = await makeOpenRepo(baseConfig());
    let threw = false;
    let errShape = null;
    try {
      repo.setUndoManager(c.value);
    } catch (e) {
      threw = true;
      errShape = e;
    }
    check(threw === true, 'setUndoManager() must throw for ' + c.label);
    check(errShape && errShape.type === RepositoryErrorTypes.VALIDATION, 'thrown error must be a VALIDATION RepositoryError for ' + c.label);
    check(errShape && errShape.recoverable === false, 'thrown error must be non-recoverable for ' + c.label);
    check(repo.getUndoManager() === null, 'a rejected manager must never be wired for ' + c.label);
  });
}

await test('C13: setUndoManager — rejecting an invalid manager does not disturb a previously-wired valid one', async () => {
  const { repo } = await makeOpenRepo(baseConfig());
  const good = makeSpyManager();
  repo.setUndoManager(good);
  let threw = false;
  try { repo.setUndoManager('garbage'); } catch (e) { threw = true; }
  check(threw === true, 'invalid manager must still throw');
  check(repo.getUndoManager() === good, 'previous valid manager must remain wired after a rejected replace attempt');
});

// ================================================================
// SECTION D — replace / remove manager
// ================================================================

await test('D1: setUndoManager — replacing one valid manager with another', async () => {
  const { repo } = await makeOpenRepo(baseConfig());
  const first = makeSpyManager();
  const second = makeSpyManager();
  repo.setUndoManager(first);
  check(repo.getUndoManager() === first, 'first manager should be wired');
  repo.setUndoManager(second);
  check(repo.getUndoManager() === second, 'second manager should replace the first');
  check(repo.getUndoManager() !== first, 'first manager should no longer be wired');
});

await test('D2: setUndoManager — replacing a real UndoManager with a duck-typed one and back', async () => {
  const { repo } = await makeOpenRepo(baseConfig());
  const real = new UndoManager(null);
  const spy = makeSpyManager();
  repo.setUndoManager(real);
  check(repo.getUndoManager() === real, 'real manager wired first');
  repo.setUndoManager(spy);
  check(repo.getUndoManager() === spy, 'spy manager replaces real one');
  repo.setUndoManager(real);
  check(repo.getUndoManager() === real, 'real manager re-wired successfully');
});

await test('D3: setUndoManager(null) — removes the currently wired manager', async () => {
  const { repo } = await makeOpenRepo(baseConfig());
  repo.setUndoManager(makeSpyManager());
  check(repo.getUndoManager() !== null, 'sanity: manager should be wired');
  const result = repo.setUndoManager(null);
  check(result === true, 'setUndoManager(null) should return true');
  check(repo.getUndoManager() === null, 'manager should be removed');
});

await test('D4: setUndoManager(undefined) — also removes the currently wired manager', async () => {
  const { repo } = await makeOpenRepo(baseConfig());
  repo.setUndoManager(makeSpyManager());
  repo.setUndoManager(undefined);
  check(repo.getUndoManager() === null, 'manager should be removed via undefined too');
});

await test('D5: after removing a manager, canUndo/canRedo/undo/redo revert to the no-manager defaults', async () => {
  const { repo } = await makeOpenRepo(baseConfig());
  const spy = makeSpyManager();
  repo.setUndoManager(spy);
  check(repo.canUndo() === true, 'sanity: spy reports canUndo() true');
  repo.setUndoManager(null);
  check(repo.canUndo() === false, 'canUndo() must be false again after removal');
  check(repo.canRedo() === false, 'canRedo() must be false again after removal');
  check(repo.undo() === null, 'undo() must return null again after removal');
  check(repo.redo() === null, 'redo() must return null again after removal');
});

for (let i = 0; i < 15; i++) {
  await test('D6.' + i + ': repeated set/remove cycles leave getUndoManager() consistent', async () => {
    const { repo } = await makeOpenRepo(baseConfig());
    const m1 = makeSpyManager();
    repo.setUndoManager(m1);
    check(repo.getUndoManager() === m1, 'cycle ' + i + ': manager set correctly');
    repo.setUndoManager(null);
    check(repo.getUndoManager() === null, 'cycle ' + i + ': manager removed correctly');
  });
}

// ================================================================
// SECTION E — getUndoManager / clearUndoHistory / canUndo / canRedo
// ================================================================

await test('E1: clearUndoHistory() calls clear() on the wired manager', async () => {
  const { repo } = await makeOpenRepo(baseConfig());
  const spy = makeSpyManager();
  repo.setUndoManager(spy);
  repo.clearUndoHistory();
  check(spy._calls.some((c) => c.m === 'clear'), 'clear() should have been invoked on the spy');
});

await test('E2: clearUndoHistory() is a harmless no-op if the wired manager has no clear()', async () => {
  const { repo } = await makeOpenRepo(baseConfig());
  const noClear = Object.assign(makeSpyManager(), { clear: undefined });
  repo.setUndoManager(noClear);
  repo.clearUndoHistory(); // must not throw
  check(true, 'clearUndoHistory() must not throw when clear is missing');
});

await test('E3: clearUndoHistory() on a real UndoManager actually empties its history/redo stacks', async () => {
  const { repo } = await makeOpenRepo(baseConfig());
  const um = new UndoManager(null);
  repo.setUndoManager(um);
  await repo.create({ name: 'x' });
  check(um.historySize() === 1, 'sanity: one history entry recorded');
  repo.clearUndoHistory();
  check(um.historySize() === 0, 'history must be empty after clearUndoHistory()');
  check(um.redoSize() === 0, 'redo stack must be empty after clearUndoHistory()');
});

await test('E4: canUndo()/canRedo() forward to the wired real UndoManager exactly', async () => {
  const { repo } = await makeOpenRepo(baseConfig());
  const um = new UndoManager(null);
  repo.setUndoManager(um);
  check(repo.canUndo() === false, 'no history yet -> canUndo() false');
  await repo.create({ name: 'x' });
  check(repo.canUndo() === true, 'after one create -> canUndo() true');
  check(repo.canRedo() === false, 'nothing undone yet -> canRedo() false');
  repo.undo();
  check(repo.canRedo() === true, 'after undo() -> canRedo() true');
});

// ================================================================
// SECTION F — create() hook
// ================================================================

await test('F1: create() — recordCreate is called exactly once after a successful create', async () => {
  const { repo } = await makeOpenRepo(baseConfig());
  const spy = makeSpyManager();
  repo.setUndoManager(spy);
  const result = await repo.create({ name: 'alpha' });
  check(result.success === true, 'create() should succeed');
  check(spy._calls.length === 1, 'exactly one manager call expected');
  check(spy._calls[0].m === 'recordCreate', 'the call must be recordCreate');
  check(spy._calls[0].after.name === 'alpha', 'the recorded snapshot must contain the created field values');
  check(spy._calls[0].after.id === result.record.id, 'the recorded snapshot id must match the created record id');
  check(spy._calls[0].meta.entity === 'widgets', 'metadata.entity must be the entityKey');
  check(spy._calls[0].meta.op === 'create', 'metadata.op must be "create"');
});

await test('F2: create() — recordCreate is NOT called when validation fails', async () => {
  function ValidatingRepo(config) { Repository.call(this, config); }
  ValidatingRepo.prototype = Object.create(Repository.prototype);
  ValidatingRepo.prototype._validate = function () { return { valid: false, errors: [{ field: 'name' }] }; };
  const adapter = makeMockAdapter(null);
  const repo = new ValidatingRepo(Object.assign(baseConfig(), { storageAdapter: adapter }));
  await repo.open();
  const spy = makeSpyManager();
  repo.setUndoManager(spy);
  const result = await repo.create({ name: 'x' });
  check(result.success === false, 'create() should fail validation');
  check(spy._calls.length === 0, 'recordCreate must not be called on a validation failure');
});

await test('F3: create() — recordCreate is NOT called on a duplicate-id conflict', async () => {
  const { repo } = await makeOpenRepo(baseConfig(), [seedEntity('dup')]);
  const spy = makeSpyManager();
  repo.setUndoManager(spy);
  const result = await repo.create({ id: 'dup', name: 'y' });
  check(result.success === false, 'create() must reject a duplicate id');
  check(spy._calls.length === 0, 'recordCreate must not be called on a conflict');
});

await test('F4: create() — recordCreate is NOT called when persist() fails', async () => {
  const adapter = makeFailingAdapter(null, [1]);
  const repo = new Repository(Object.assign(baseConfig(), { storageAdapter: adapter }));
  await repo.open();
  const spy = makeSpyManager();
  repo.setUndoManager(spy);
  const result = await repo.create({ name: 'z' });
  check(result.success === false, 'create() must fail when persist() fails');
  check(spy._calls.length === 0, 'recordCreate must never be called when persist() fails');
});

await test('F5: create() — recordCreate never runs with no manager wired (pure no-op path)', async () => {
  const { repo } = await makeOpenRepo(baseConfig());
  const result = await repo.create({ name: 'no-manager' });
  check(result.success === true, 'create() must still succeed with no manager wired');
});

for (let i = 0; i < 25; i++) {
  await test('F6.' + i + ': create() hook fires with correct snapshot for record #' + i, async () => {
    const { repo } = await makeOpenRepo(baseConfig());
    const spy = makeSpyManager();
    repo.setUndoManager(spy);
    const result = await repo.create({ name: 'item-' + i, seq: i });
    check(result.success === true, 'create #' + i + ' should succeed');
    check(spy._calls.length === 1, 'create #' + i + ' should log exactly one entry');
    check(spy._calls[0].after.seq === i, 'create #' + i + ' snapshot seq must match');
  });
}

// ================================================================
// SECTION G — update() hook
// ================================================================

await test('G1: update() — recordUpdate is called exactly once with correct before/after', async () => {
  const { repo } = await makeOpenRepo(baseConfig(), [seedEntity('u1', { name: 'old' })]);
  const spy = makeSpyManager();
  repo.setUndoManager(spy);
  const result = await repo.update('u1', { name: 'new' });
  check(result.success === true, 'update() should succeed');
  check(spy._calls.length === 1, 'exactly one manager call expected');
  check(spy._calls[0].m === 'recordUpdate', 'the call must be recordUpdate');
  check(spy._calls[0].before.name === 'old', 'before snapshot must reflect pre-update state');
  check(spy._calls[0].after.name === 'new', 'after snapshot must reflect post-update state');
  check(spy._calls[0].meta.op === 'update', 'metadata.op must be "update"');
});

await test('G2: update() — recordUpdate is NOT called for an unknown id', async () => {
  const { repo } = await makeOpenRepo(baseConfig());
  const spy = makeSpyManager();
  repo.setUndoManager(spy);
  const result = await repo.update('missing', { name: 'x' });
  check(result.success === false, 'update() must fail for an unknown id');
  check(spy._calls.length === 0, 'recordUpdate must not be called for an unknown id');
});

await test('G3: update() — recordUpdate is NOT called when blocked by the soft-delete guard', async () => {
  const { repo } = await makeOpenRepo(baseConfig(), [seedEntity('u2', { deletedAt: '2026-01-02T00:00:00.000Z' })]);
  const spy = makeSpyManager();
  repo.setUndoManager(spy);
  const result = await repo.update('u2', { name: 'blocked' });
  check(result.success === false, 'update() must be blocked on a soft-deleted record by default');
  check(result.error.type === RepositoryErrorTypes.CONFLICT, 'the guard error must be a CONFLICT');
  check(spy._calls.length === 0, 'recordUpdate must not be called when the guard blocks the update');
});

await test('G4: update() — recordUpdate IS called when allowDeleted:true bypasses the guard', async () => {
  const { repo } = await makeOpenRepo(baseConfig(), [seedEntity('u3', { deletedAt: '2026-01-02T00:00:00.000Z', name: 'x' })]);
  const spy = makeSpyManager();
  repo.setUndoManager(spy);
  const result = await repo.update('u3', { name: 'y' }, { allowDeleted: true });
  check(result.success === true, 'update() with allowDeleted:true should succeed');
  check(spy._calls.length === 1, 'recordUpdate must be called once when allowDeleted bypasses the guard');
});

await test('G5: update() — recordUpdate is NOT called when persist() fails', async () => {
  const adapter = makeFailingAdapter({ entityKey: 'widgets', records: [seedEntity('u4')] }, [1]);
  const repo = new Repository(Object.assign(baseConfig(), { storageAdapter: adapter }));
  await repo.open();
  const spy = makeSpyManager();
  repo.setUndoManager(spy);
  const result = await repo.update('u4', { name: 'fail' });
  check(result.success === false, 'update() must fail when persist() fails');
  check(spy._calls.length === 0, 'recordUpdate must never be called when persist() fails');
});

for (let i = 0; i < 25; i++) {
  await test('G6.' + i + ': update() hook fires with correct before/after for record #' + i, async () => {
    const { repo } = await makeOpenRepo(baseConfig(), [seedEntity('gu' + i, { name: 'before-' + i })]);
    const spy = makeSpyManager();
    repo.setUndoManager(spy);
    const result = await repo.update('gu' + i, { name: 'after-' + i });
    check(result.success === true, 'update #' + i + ' should succeed');
    check(spy._calls[0].before.name === 'before-' + i, 'before snapshot mismatch at #' + i);
    check(spy._calls[0].after.name === 'after-' + i, 'after snapshot mismatch at #' + i);
  });
}

// ================================================================
// SECTION H — delete() hook
// ================================================================

await test('H1: delete() — recordDelete is called with the pre-delete state (soft-delete)', async () => {
  const { repo } = await makeOpenRepo(baseConfig(), [seedEntity('d1', { name: 'to-delete' })]);
  const spy = makeSpyManager();
  repo.setUndoManager(spy);
  const result = await repo.delete('d1');
  check(result.success === true, 'delete() should succeed');
  check(spy._calls.length === 1, 'exactly one manager call expected');
  check(spy._calls[0].m === 'recordDelete', 'the call must be recordDelete');
  check(spy._calls[0].before.name === 'to-delete', 'before snapshot must be the pre-delete record');
  check(spy._calls[0].before.deletedAt === null, 'before snapshot must NOT already carry the deletedAt stamp');
  check(spy._calls[0].meta.softDelete === true, 'metadata.softDelete must reflect the Repository configuration');
});

await test('H2: delete() — recordDelete is called with the pre-delete state (hard-delete)', async () => {
  const { repo } = await makeOpenRepo(baseConfig({ softDelete: false }), [seedEntity('d2', { name: 'gone' })]);
  const spy = makeSpyManager();
  repo.setUndoManager(spy);
  const result = await repo.delete('d2');
  check(result.success === true, 'hard delete() should succeed');
  check(spy._calls[0].before.name === 'gone', 'before snapshot must capture the record that is about to be removed entirely');
  check(spy._calls[0].meta.softDelete === false, 'metadata.softDelete must be false for a hard-delete Repository');
  check(repo.get('d2') === null, 'sanity: record truly gone after hard delete');
});

await test('H3: delete() — recordDelete is NOT called for an unknown id', async () => {
  const { repo } = await makeOpenRepo(baseConfig());
  const spy = makeSpyManager();
  repo.setUndoManager(spy);
  const result = await repo.delete('missing');
  check(result.success === false, 'delete() must fail for an unknown id');
  check(spy._calls.length === 0, 'recordDelete must not be called for an unknown id');
});

await test('H4: delete() — recordDelete IS called again on a repeat delete of an already-deleted record', async () => {
  const { repo } = await makeOpenRepo(baseConfig(), [seedEntity('d3', { deletedAt: '2026-01-01T00:00:00.000Z' })]);
  const spy = makeSpyManager();
  repo.setUndoManager(spy);
  const result = await repo.delete('d3');
  check(result.success === true, 'repeat delete() is not itself an error (pre-existing behavior)');
  check(spy._calls.length === 1, 'recordDelete is called again on a repeat delete, matching delete()\'s own repeat-call semantics');
});

await test('H5: delete() — recordDelete is NOT called when persist() fails', async () => {
  const adapter = makeFailingAdapter({ entityKey: 'widgets', records: [seedEntity('d4')] }, [1]);
  const repo = new Repository(Object.assign(baseConfig(), { storageAdapter: adapter }));
  await repo.open();
  const spy = makeSpyManager();
  repo.setUndoManager(spy);
  const result = await repo.delete('d4');
  check(result.success === false, 'delete() must fail when persist() fails');
  check(spy._calls.length === 0, 'recordDelete must never be called when persist() fails');
});

for (let i = 0; i < 25; i++) {
  await test('H6.' + i + ': delete() hook fires with correct pre-delete snapshot for record #' + i, async () => {
    const { repo } = await makeOpenRepo(baseConfig(), [seedEntity('hd' + i, { name: 'live-' + i })]);
    const spy = makeSpyManager();
    repo.setUndoManager(spy);
    await repo.delete('hd' + i);
    check(spy._calls[0].before.name === 'live-' + i, 'delete snapshot mismatch at #' + i);
  });
}

// ================================================================
// SECTION I — restore() hook
// ================================================================

await test('I1: restore() — recordRestore is called with correct before (deleted) / after (live)', async () => {
  const { repo } = await makeOpenRepo(baseConfig(), [seedEntity('r1', { deletedAt: '2026-01-02T00:00:00.000Z', name: 'was-deleted' })]);
  const spy = makeSpyManager();
  repo.setUndoManager(spy);
  const result = await repo.restore('r1');
  check(result.success === true, 'restore() should succeed');
  check(spy._calls.length === 1, 'exactly one manager call expected');
  check(spy._calls[0].m === 'recordRestore', 'the call must be recordRestore');
  check(spy._calls[0].before.deletedAt !== null, 'before snapshot must still carry the deletedAt stamp');
  check(spy._calls[0].after.deletedAt === null, 'after snapshot must have deletedAt cleared');
  check(spy._calls[0].after.name === 'was-deleted', 'after snapshot must preserve the record content');
});

await test('I2: restore() — recordRestore is NOT called on the idempotent already-live path (no persist happened)', async () => {
  const { repo } = await makeOpenRepo(baseConfig(), [seedEntity('r2', { name: 'already-live' })]);
  const spy = makeSpyManager();
  repo.setUndoManager(spy);
  const result = await repo.restore('r2');
  check(result.success === true, 'restore() on an already-live record is idempotent success');
  check(spy._calls.length === 0, 'recordRestore must NOT be called when nothing actually changed');
});

await test('I3: restore() — recordRestore is NOT called for an unknown id', async () => {
  const { repo } = await makeOpenRepo(baseConfig());
  const spy = makeSpyManager();
  repo.setUndoManager(spy);
  const result = await repo.restore('missing');
  check(result.success === false, 'restore() must fail for an unknown id');
  check(spy._calls.length === 0, 'recordRestore must not be called for an unknown id');
});

await test('I4: restore() — not supported (softDelete:false) never calls recordRestore', async () => {
  const { repo } = await makeOpenRepo(baseConfig({ softDelete: false }), [seedEntity('r3')]);
  const spy = makeSpyManager();
  repo.setUndoManager(spy);
  const result = await repo.restore('r3');
  check(result.success === false, 'restore() must be unsupported on a hard-delete Repository');
  check(spy._calls.length === 0, 'recordRestore must not be called when restore() is unsupported');
});

await test('I5: restore() — recordRestore is NOT called when persist() fails', async () => {
  const adapter = makeFailingAdapter({ entityKey: 'widgets', records: [seedEntity('r4', { deletedAt: '2026-01-02T00:00:00.000Z' })] }, [1]);
  const repo = new Repository(Object.assign(baseConfig(), { storageAdapter: adapter }));
  await repo.open();
  const spy = makeSpyManager();
  repo.setUndoManager(spy);
  const result = await repo.restore('r4');
  check(result.success === false, 'restore() must fail when persist() fails');
  check(spy._calls.length === 0, 'recordRestore must never be called when persist() fails');
});

for (let i = 0; i < 20; i++) {
  await test('I6.' + i + ': restore() hook fires with correct snapshot pair for record #' + i, async () => {
    const { repo } = await makeOpenRepo(baseConfig(), [seedEntity('ir' + i, { deletedAt: '2026-01-02T00:00:00.000Z', name: 'x-' + i })]);
    const spy = makeSpyManager();
    repo.setUndoManager(spy);
    await repo.restore('ir' + i);
    check(spy._calls[0].before.name === 'x-' + i, 'restore before-snapshot mismatch at #' + i);
    check(spy._calls[0].after.deletedAt === null, 'restore after-snapshot must be live at #' + i);
  });
}

// ================================================================
// SECTION J — bulkInsert() hook: ONE entry per call
// ================================================================

await test('J1: bulkInsert() — exactly ONE recordCreate call for a 5-item batch', async () => {
  const { repo } = await makeOpenRepo(baseConfig());
  const spy = makeSpyManager();
  repo.setUndoManager(spy);
  const items = [1, 2, 3, 4, 5].map((n) => ({ id: 'bi' + n, name: 'batch-' + n }));
  const results = await repo.bulkInsert(items);
  check(results.every((r) => r.success), 'all 5 items should succeed');
  check(spy._calls.length === 1, 'exactly ONE manager call expected for the whole batch, not 5');
  check(spy._calls[0].m === 'recordCreate', 'the single call must be recordCreate');
  check(Array.isArray(spy._calls[0].after), 'the after snapshot must be an array for a bulk op');
  check(spy._calls[0].after.length === 5, 'the after snapshot array must contain all 5 created records');
  check(spy._calls[0].meta.bulk === true, 'metadata.bulk must be true');
  check(spy._calls[0].meta.count === 5, 'metadata.count must equal the number of created records');
});

for (const n of [1, 10, 50, 100]) {
  await test('J2.' + n + ': bulkInsert() — exactly ONE recordCreate call for a ' + n + '-item batch', async () => {
    const { repo } = await makeOpenRepo(baseConfig());
    const spy = makeSpyManager();
    repo.setUndoManager(spy);
    const items = [];
    for (let i = 0; i < n; i++) items.push({ id: 'big' + n + '-' + i, name: 'x' });
    await repo.bulkInsert(items);
    check(spy._calls.length === 1, n + '-item batch must log exactly one entry, not ' + n);
    check(spy._calls[0].meta.count === n, n + '-item batch count metadata must equal ' + n);
  });
}

await test('J3: bulkInsert() — recordCreate is skipped entirely when every item fails validation', async () => {
  function AlwaysInvalidRepo(config) { Repository.call(this, config); }
  AlwaysInvalidRepo.prototype = Object.create(Repository.prototype);
  AlwaysInvalidRepo.prototype._validate = function () { return { valid: false, errors: [{ field: 'name' }] }; };
  const adapter = makeMockAdapter(null);
  const repo = new AlwaysInvalidRepo(Object.assign(baseConfig(), { storageAdapter: adapter }));
  await repo.open();
  const spy = makeSpyManager();
  repo.setUndoManager(spy);
  const results = await repo.bulkInsert([{ name: 'a' }, { name: 'b' }]);
  check(results.every((r) => !r.success), 'all items should fail validation');
  check(spy._calls.length === 0, 'recordCreate must not be called when nothing was actually inserted');
});

await test('J4: bulkInsert() — recordCreate only counts the items that actually validated', async () => {
  function PartialInvalidRepo(config) { Repository.call(this, config); }
  PartialInvalidRepo.prototype = Object.create(Repository.prototype);
  PartialInvalidRepo.prototype._validate = function (op, record) {
    return { valid: !!(record && record.name), errors: record && record.name ? [] : [{ field: 'name' }] };
  };
  const adapter = makeMockAdapter(null);
  const repo = new PartialInvalidRepo(Object.assign(baseConfig(), { storageAdapter: adapter }));
  await repo.open();
  const spy = makeSpyManager();
  repo.setUndoManager(spy);
  const results = await repo.bulkInsert([{ name: 'ok1' }, {}, { name: 'ok2' }, {}]);
  check(results[0].success === true && results[2].success === true, 'valid items should succeed');
  check(results[1].success === false && results[3].success === false, 'invalid items should fail');
  check(spy._calls.length === 1, 'exactly one manager call expected');
  check(spy._calls[0].meta.count === 2, 'only the 2 valid items should be counted in the undo entry');
});

await test('J5: bulkInsert() — recordCreate is NOT called when persist() fails', async () => {
  const adapter = makeFailingAdapter(null, [1]);
  const repo = new Repository(Object.assign(baseConfig(), { storageAdapter: adapter }));
  await repo.open();
  const spy = makeSpyManager();
  repo.setUndoManager(spy);
  const results = await repo.bulkInsert([{ id: 'x1', name: 'a' }, { id: 'x2', name: 'b' }]);
  check(results.every((r) => !r.success), 'all items should fail when persist() fails');
  check(spy._calls.length === 0, 'recordCreate must never be called when persist() fails');
});

// ================================================================
// SECTION K — bulkUpdate() hook: ONE entry per call
// ================================================================

await test('K1: bulkUpdate() — exactly ONE recordUpdate call for a multi-item batch', async () => {
  const seeds = makeSeeds(6);
  const { repo } = await makeOpenRepo(baseConfig(), seeds);
  const spy = makeSpyManager();
  repo.setUndoManager(spy);
  const patches = seeds.slice(0, 4).map((s) => ({ id: s.id, patch: { name: s.name + '-upd' } }));
  const results = await repo.bulkUpdate(patches);
  check(results.every((r) => r.success), 'all 4 patched items should succeed');
  check(spy._calls.length === 1, 'exactly ONE manager call expected for the whole batch, not 4');
  check(spy._calls[0].m === 'recordUpdate', 'the single call must be recordUpdate');
  check(Array.isArray(spy._calls[0].before) && Array.isArray(spy._calls[0].after), 'before/after must both be arrays');
  check(spy._calls[0].before.length === 4, 'before array must contain all 4 items');
  check(spy._calls[0].after.length === 4, 'after array must contain all 4 items');
  check(spy._calls[0].meta.count === 4, 'metadata.count must equal 4');
});

await test('K2: bulkUpdate() — only successfully-staged items are counted (unknown id skipped)', async () => {
  const seeds = makeSeeds(3);
  const { repo } = await makeOpenRepo(baseConfig(), seeds);
  const spy = makeSpyManager();
  repo.setUndoManager(spy);
  const patches = [
    { id: seeds[0].id, patch: { name: 'x' } },
    { id: 'does-not-exist', patch: { name: 'y' } },
    { id: seeds[1].id, patch: { name: 'z' } }
  ];
  const results = await repo.bulkUpdate(patches);
  check(results[1].success === false, 'unknown id item must fail');
  check(spy._calls.length === 1, 'exactly one manager call expected');
  check(spy._calls[0].meta.count === 2, 'only the 2 successfully-staged items should be counted');
});

await test('K3: bulkUpdate() — recordUpdate skipped entirely when nothing was staged (all unknown ids)', async () => {
  const { repo } = await makeOpenRepo(baseConfig());
  const spy = makeSpyManager();
  repo.setUndoManager(spy);
  const results = await repo.bulkUpdate([{ id: 'ghost1', patch: {} }, { id: 'ghost2', patch: {} }]);
  check(results.every((r) => !r.success), 'all items should fail (unknown ids)');
  check(spy._calls.length === 0, 'recordUpdate must not be called when nothing was staged');
});

await test('K4: bulkUpdate() — items blocked by the soft-delete guard are excluded from the undo entry', async () => {
  const seeds = [seedEntity('bu1', { name: 'a' }), seedEntity('bu2', { name: 'b', deletedAt: '2026-01-02T00:00:00.000Z' })];
  const { repo } = await makeOpenRepo(baseConfig(), seeds);
  const spy = makeSpyManager();
  repo.setUndoManager(spy);
  const results = await repo.bulkUpdate([
    { id: 'bu1', patch: { name: 'a2' } },
    { id: 'bu2', patch: { name: 'b2' } } // blocked, soft-deleted, no allowDeleted
  ]);
  check(results[0].success === true, 'live item should succeed');
  check(results[1].success === false, 'soft-deleted item should be blocked');
  check(spy._calls[0].meta.count === 1, 'only the 1 successfully-staged item should be counted');
});

await test('K5: bulkUpdate() — recordUpdate is NOT called when persist() fails', async () => {
  const seeds = makeSeeds(3);
  const adapter = makeFailingAdapter({ entityKey: 'widgets', records: seeds }, [1]);
  const repo = new Repository(Object.assign(baseConfig(), { storageAdapter: adapter }));
  await repo.open();
  const spy = makeSpyManager();
  repo.setUndoManager(spy);
  const results = await repo.bulkUpdate(seeds.map((s) => ({ id: s.id, patch: { name: 'z' } })));
  check(results.every((r) => !r.success), 'all items should fail when persist() fails');
  check(spy._calls.length === 0, 'recordUpdate must never be called when persist() fails');
});

for (const n of [1, 10, 30]) {
  await test('K6.' + n + ': bulkUpdate() — exactly ONE recordUpdate call for a ' + n + '-item batch', async () => {
    const seeds = makeSeeds(n);
    const { repo } = await makeOpenRepo(baseConfig(), seeds);
    const spy = makeSpyManager();
    repo.setUndoManager(spy);
    await repo.bulkUpdate(seeds.map((s) => ({ id: s.id, patch: { name: 'upd' } })));
    check(spy._calls.length === 1, n + '-item batch must log exactly one entry');
    check(spy._calls[0].meta.count === n, n + '-item batch count metadata must equal ' + n);
  });
}

// ================================================================
// SECTION L — bulkDelete() hook: ONE entry per call
// ================================================================

await test('L1: bulkDelete() — exactly ONE recordDelete call for a multi-id batch (soft-delete)', async () => {
  const seeds = makeSeeds(5);
  const { repo } = await makeOpenRepo(baseConfig(), seeds);
  const spy = makeSpyManager();
  repo.setUndoManager(spy);
  const results = await repo.bulkDelete(seeds.map((s) => s.id));
  check(results.every((r) => r.success), 'all 5 deletes should succeed');
  check(spy._calls.length === 1, 'exactly ONE manager call expected for the whole batch, not 5');
  check(spy._calls[0].m === 'recordDelete', 'the single call must be recordDelete');
  check(Array.isArray(spy._calls[0].before), 'before must be an array for a bulk op');
  check(spy._calls[0].before.length === 5, 'before array must contain all 5 items');
  check(spy._calls[0].meta.count === 5, 'metadata.count must equal 5');
  check(Array.isArray(spy._calls[0].meta.after), 'metadata.after must carry the post-delete snapshots');
});

await test('L2: bulkDelete() — exactly ONE recordDelete call for a multi-id batch (hard-delete)', async () => {
  const seeds = makeSeeds(4);
  const { repo } = await makeOpenRepo(baseConfig({ softDelete: false }), seeds);
  const spy = makeSpyManager();
  repo.setUndoManager(spy);
  const results = await repo.bulkDelete(seeds.map((s) => s.id));
  check(results.every((r) => r.success), 'all 4 hard deletes should succeed');
  check(spy._calls.length === 1, 'exactly ONE manager call expected');
  check(spy._calls[0].meta.count === 4, 'metadata.count must equal 4');
  check(spy._calls[0].meta.after.every((a) => a === null), 'hard-delete after snapshots must be null (record fully removed)');
});

await test('L3: bulkDelete() — unknown ids are excluded from the undo entry', async () => {
  const seeds = makeSeeds(2);
  const { repo } = await makeOpenRepo(baseConfig(), seeds);
  const spy = makeSpyManager();
  repo.setUndoManager(spy);
  const results = await repo.bulkDelete([seeds[0].id, 'ghost']);
  check(results[0].success === true && results[1].success === false, 'known id succeeds, unknown id fails');
  check(spy._calls[0].meta.count === 1, 'only the 1 real deletion should be counted');
});

await test('L4: bulkDelete() — recordDelete skipped entirely when every id is unknown', async () => {
  const { repo } = await makeOpenRepo(baseConfig());
  const spy = makeSpyManager();
  repo.setUndoManager(spy);
  const results = await repo.bulkDelete(['ghost1', 'ghost2']);
  check(results.every((r) => !r.success), 'all should fail (unknown ids)');
  check(spy._calls.length === 0, 'recordDelete must not be called when nothing was actually deleted');
});

await test('L5: bulkDelete() — recordDelete is NOT called when persist() fails', async () => {
  const seeds = makeSeeds(3);
  const adapter = makeFailingAdapter({ entityKey: 'widgets', records: seeds }, [1]);
  const repo = new Repository(Object.assign(baseConfig(), { storageAdapter: adapter }));
  await repo.open();
  const spy = makeSpyManager();
  repo.setUndoManager(spy);
  const results = await repo.bulkDelete(seeds.map((s) => s.id));
  check(results.every((r) => !r.success), 'all items should fail when persist() fails');
  check(spy._calls.length === 0, 'recordDelete must never be called when persist() fails');
});

for (const n of [1, 10, 40]) {
  await test('L6.' + n + ': bulkDelete() — exactly ONE recordDelete call for a ' + n + '-item batch', async () => {
    const seeds = makeSeeds(n);
    const { repo } = await makeOpenRepo(baseConfig(), seeds);
    const spy = makeSpyManager();
    repo.setUndoManager(spy);
    await repo.bulkDelete(seeds.map((s) => s.id));
    check(spy._calls.length === 1, n + '-item batch must log exactly one entry');
    check(spy._calls[0].meta.count === n, n + '-item batch count metadata must equal ' + n);
  });
}

// ================================================================
// SECTION M — transaction() hook: ONE entry per commit
// ================================================================

await test('M1: transaction() — exactly ONE recordUpdate call after a successful mixed-op commit', async () => {
  const seeds = [seedEntity('t1', { name: 'a' }), seedEntity('t2', { name: 'b' }), seedEntity('t3', { deletedAt: '2026-01-02T00:00:00.000Z', name: 'c' })];
  const { repo } = await makeOpenRepo(baseConfig(), seeds);
  const spy = makeSpyManager();
  repo.setUndoManager(spy);
  const result = await repo.transaction([
    { op: 'create', entity: { id: 't4', name: 'new' } },
    { op: 'update', id: 't1', patch: { name: 'a2' } },
    { op: 'delete', id: 't2' },
    { op: 'restore', id: 't3' }
  ]);
  check(result.success === true, 'transaction() should commit successfully');
  check(spy._calls.length === 1, 'exactly ONE manager call expected for the whole transaction, not 4');
  check(spy._calls[0].m === 'recordUpdate', 'the single call must be recordUpdate (full snapshot)');
  check(spy._calls[0].meta.op === 'transaction', 'metadata.op must be "transaction"');
  check(spy._calls[0].meta.opsCount === 4, 'metadata.opsCount must equal 4');
  A.deepStrictEqual(spy._calls[0].meta.opTypes, ['create', 'update', 'delete', 'restore'], 'metadata.opTypes must list every step type in order');
  check(spy._calls[0].after.length === 4, 'after snapshot must reflect the post-commit record count (3 seeds + 1 created)');
});

await test('M2: transaction() — recordUpdate is NOT called when a step fails (rollback)', async () => {
  const seeds = [seedEntity('t5', { name: 'a' })];
  const { repo } = await makeOpenRepo(baseConfig(), seeds);
  const spy = makeSpyManager();
  repo.setUndoManager(spy);
  const result = await repo.transaction([
    { op: 'update', id: 't5', patch: { name: 'ok' } },
    { op: 'delete', id: 'does-not-exist' }
  ]);
  check(result.success === false, 'transaction() must fail when a step fails');
  check(spy._calls.length === 0, 'recordUpdate must never be called on a rolled-back transaction');
});

await test('M3: transaction() — recordUpdate is NOT called when persist() fails after all steps stage successfully', async () => {
  const seeds = [seedEntity('t6', { name: 'a' })];
  const adapter = makeFailingAdapter({ entityKey: 'widgets', records: seeds }, [1]);
  const repo = new Repository(Object.assign(baseConfig(), { storageAdapter: adapter }));
  await repo.open();
  const spy = makeSpyManager();
  repo.setUndoManager(spy);
  const result = await repo.transaction([{ op: 'update', id: 't6', patch: { name: 'b' } }]);
  check(result.success === false, 'transaction() must fail when persist() fails');
  check(spy._calls.length === 0, 'recordUpdate must never be called when the commit persist() fails');
});

await test('M4: transaction() — an empty ops[] array commits without calling recordUpdate', async () => {
  const { repo } = await makeOpenRepo(baseConfig(), [seedEntity('t7')]);
  const spy = makeSpyManager();
  repo.setUndoManager(spy);
  const result = await repo.transaction([]);
  check(result.success === true, 'an empty transaction should still succeed (no-op commit)');
  check(spy._calls.length === 0, 'recordUpdate must not be called for a transaction with zero ops — nothing changed');
});

for (const n of [1, 3, 8]) {
  await test('M5.' + n + ': transaction() — exactly ONE recordUpdate call for a ' + n + '-op transaction', async () => {
    const { repo } = await makeOpenRepo(baseConfig());
    const spy = makeSpyManager();
    repo.setUndoManager(spy);
    const ops = [];
    for (let i = 0; i < n; i++) ops.push({ op: 'create', entity: { id: 'txn' + n + '-' + i, name: 'x' } });
    await repo.transaction(ops);
    check(spy._calls.length === 1, n + '-op transaction must log exactly one entry');
    check(spy._calls[0].meta.opsCount === n, n + '-op transaction opsCount metadata must equal ' + n);
  });
}

// ================================================================
// SECTION N — import() hook: ONE entry regardless of mode
// ================================================================

await test('N1: import() — exactly ONE recordUpdate call for mode "replace"', async () => {
  const { repo } = await makeOpenRepo(baseConfig(), makeSeeds(3));
  const spy = makeSpyManager();
  repo.setUndoManager(spy);
  const incoming = makeSeeds(2).map((s) => Object.assign({}, s, { id: 'imp-' + s.id }));
  const result = await repo.import(incoming, 'replace');
  check(result.success === true, 'import(replace) should succeed');
  check(spy._calls.length === 1, 'exactly ONE manager call expected for the whole import');
  check(spy._calls[0].m === 'recordUpdate', 'the call must be recordUpdate');
  check(spy._calls[0].before.length === 3, 'before snapshot must reflect the pre-import 3 seed records');
  check(spy._calls[0].after.length === 2, 'after snapshot must reflect the post-import 2 incoming records');
  check(spy._calls[0].meta.mode === 'replace', 'metadata.mode must be "replace"');
  check(spy._calls[0].meta.bulk === true, 'metadata.bulk must be true');
});

await test('N2: import() — exactly ONE recordUpdate call for mode "merge"', async () => {
  const seeds = makeSeeds(3);
  const { repo } = await makeOpenRepo(baseConfig(), seeds);
  const spy = makeSpyManager();
  repo.setUndoManager(spy);
  const incoming = [Object.assign({}, seeds[0], { name: 'merged-in' }), seedEntity('brand-new', { name: 'fresh' })];
  const result = await repo.import(incoming, 'merge');
  check(result.success === true, 'import(merge) should succeed');
  check(spy._calls.length === 1, 'exactly ONE manager call expected for the whole merge import');
  check(spy._calls[0].before.length === 3, 'before snapshot must reflect the pre-merge 3 records');
  check(spy._calls[0].after.length === 4, 'after snapshot must reflect 3 existing + 1 brand-new record');
  check(spy._calls[0].meta.mode === 'merge', 'metadata.mode must be "merge"');
});

await test('N3: import() — default mode (no argument) behaves like "replace" for undo recording too', async () => {
  const { repo } = await makeOpenRepo(baseConfig(), makeSeeds(2));
  const spy = makeSpyManager();
  repo.setUndoManager(spy);
  await repo.import(makeSeeds(1));
  check(spy._calls[0].meta.mode === 'replace', 'default import mode must be recorded as "replace"');
});

await test('N4: import() — recordUpdate is NOT called for an unknown mode', async () => {
  const { repo } = await makeOpenRepo(baseConfig(), makeSeeds(2));
  const spy = makeSpyManager();
  repo.setUndoManager(spy);
  const result = await repo.import(makeSeeds(1), 'nonsense-mode');
  check(result.success === false, 'import() must reject an unknown mode');
  check(spy._calls.length === 0, 'recordUpdate must not be called for a rejected import mode');
});

await test('N5: import() — recordUpdate is NOT called when persist() fails', async () => {
  const seeds = makeSeeds(2);
  const adapter = makeFailingAdapter({ entityKey: 'widgets', records: seeds }, [1]);
  const repo = new Repository(Object.assign(baseConfig(), { storageAdapter: adapter }));
  await repo.open();
  const spy = makeSpyManager();
  repo.setUndoManager(spy);
  const result = await repo.import(makeSeeds(1), 'replace');
  check(result.success === false, 'import() must fail when persist() fails');
  check(spy._calls.length === 0, 'recordUpdate must never be called when persist() fails');
});

await test('N6: import() — an empty incoming array still records ONE entry (import is not skipped for empty payloads)', async () => {
  const { repo } = await makeOpenRepo(baseConfig(), makeSeeds(2));
  const spy = makeSpyManager();
  repo.setUndoManager(spy);
  const result = await repo.import([], 'replace');
  check(result.success === true, 'importing an empty array should succeed');
  check(spy._calls.length === 1, 'import() records ONE entry even for an empty payload, since the prior 2 records were genuinely replaced');
  check(spy._calls[0].after.length === 0, 'after snapshot correctly reflects the now-empty Repository');
});

// ================================================================
// SECTION O — clear() hook: ONE entry, skipped when already empty
// ================================================================

await test('O1: clear() — exactly ONE recordDelete call, snapshotting everything that existed', async () => {
  const seeds = makeSeeds(7);
  const { repo } = await makeOpenRepo(baseConfig(), seeds);
  const spy = makeSpyManager();
  repo.setUndoManager(spy);
  const result = await repo.clear();
  check(result.success === true, 'clear() should succeed');
  check(spy._calls.length === 1, 'exactly ONE manager call expected for clear()');
  check(spy._calls[0].m === 'recordDelete', 'the call must be recordDelete');
  check(spy._calls[0].before.length === 7, 'before snapshot must contain all 7 pre-clear records');
  check(spy._calls[0].meta.op === 'clear', 'metadata.op must be "clear"');
  check(spy._calls[0].meta.count === 7, 'metadata.count must equal 7');
});

await test('O2: clear() — recordDelete is skipped entirely when the Repository was already empty', async () => {
  const { repo } = await makeOpenRepo(baseConfig());
  const spy = makeSpyManager();
  repo.setUndoManager(spy);
  const result = await repo.clear();
  check(result.success === true, 'clear() on an empty Repository should still succeed');
  check(spy._calls.length === 0, 'recordDelete must not be called when there was nothing to clear');
});

await test('O3: clear() — recordDelete is NOT called when persist() fails', async () => {
  const seeds = makeSeeds(3);
  const adapter = makeFailingAdapter({ entityKey: 'widgets', records: seeds }, [1]);
  const repo = new Repository(Object.assign(baseConfig(), { storageAdapter: adapter }));
  await repo.open();
  const spy = makeSpyManager();
  repo.setUndoManager(spy);
  const result = await repo.clear();
  check(result.success === false, 'clear() must fail when persist() fails');
  check(spy._calls.length === 0, 'recordDelete must never be called when persist() fails');
});

for (const n of [1, 5, 20]) {
  await test('O4.' + n + ': clear() — exactly ONE recordDelete call for ' + n + ' pre-existing records', async () => {
    const { repo } = await makeOpenRepo(baseConfig(), makeSeeds(n));
    const spy = makeSpyManager();
    repo.setUndoManager(spy);
    await repo.clear();
    check(spy._calls.length === 1, n + '-record clear() must log exactly one entry');
    check(spy._calls[0].meta.count === n, n + '-record clear() count metadata must equal ' + n);
  });
}

// ================================================================
// SECTION P — Cache compatibility (undo recording never touches
// _idIndex / _liveCount)
// ================================================================

function idIndexSnapshot(repo) {
  return { size: repo._idIndex.size, liveCount: repo._liveCount, entries: Array.from(repo._idIndex.entries()).sort() };
}

await test('P1: cache invariants after create() are identical with vs without a wired UndoManager', async () => {
  const a = await makeOpenRepo(baseConfig());
  const b = await makeOpenRepo(baseConfig());
  b.repo.setUndoManager(makeSpyManager());
  await a.repo.create({ id: 'c1', name: 'x' });
  await b.repo.create({ id: 'c1', name: 'x' });
  A.deepStrictEqual(idIndexSnapshot(a.repo), idIndexSnapshot(b.repo), 'index/liveCount must be identical whether or not a manager is wired');
});

await test('P2: cache invariants after a mixed CRUD sequence are identical with vs without a wired UndoManager', async () => {
  const seeds = makeSeeds(10, 3);
  const a = await makeOpenRepo(baseConfig(), JSON.parse(JSON.stringify(seeds)));
  const b = await makeOpenRepo(baseConfig(), JSON.parse(JSON.stringify(seeds)));
  b.repo.setUndoManager(makeSpyManager());

  async function runSequence(repo) {
    await repo.create({ id: 'seq-new-1', name: 'n1' });
    await repo.update('r1', { name: 'updated' });
    await repo.delete('r2');
    await repo.restore('r0');
    await repo.bulkInsert([{ id: 'seq-new-2', name: 'n2' }, { id: 'seq-new-3', name: 'n3' }]);
    await repo.bulkUpdate([{ id: 'r4', patch: { name: 'bu' } }]);
    await repo.bulkDelete(['r5', 'r6']);
  }
  await runSequence(a.repo);
  await runSequence(b.repo);
  A.deepStrictEqual(idIndexSnapshot(a.repo), idIndexSnapshot(b.repo), 'index/liveCount must match exactly after an identical mixed sequence');
  // Wall-clock-derived fields (createdAt/updatedAt/checksum) legitimately
  // differ by a few milliseconds between the two sequential runs above —
  // strip them before comparing, since undo-hook presence/absence is
  // what's under test here, not timing.
  function stripVolatile(records) {
    return records.map((r) => {
      const c = Object.assign({}, r);
      delete c.createdAt; delete c.updatedAt; delete c.checksum;
      // deletedAt is also wall-clock-derived (set by delete()) — normalize
      // to a boolean "is it deleted" instead of comparing exact stamps.
      c.deletedAt = c.deletedAt != null ? 'DELETED' : null;
      return c;
    });
  }
  A.deepStrictEqual(stripVolatile(a.repo.export()), stripVolatile(b.repo.export()), 'exported record arrays must also match exactly (ignoring wall-clock-derived fields)');
});

await test('P3: _idIndex is never mutated by the undo hook call itself (spy manager mutates nothing on the repo)', async () => {
  const { repo } = await makeOpenRepo(baseConfig(), makeSeeds(5));
  const before = idIndexSnapshot(repo);
  const spy = makeSpyManager();
  repo.setUndoManager(spy);
  // Wiring/unwiring a manager must never itself touch the cache.
  repo.setUndoManager(null);
  A.deepStrictEqual(idIndexSnapshot(repo), before, 'wiring/unwiring an UndoManager must never mutate _idIndex/_liveCount');
});

await test('P4: a throwing UndoManager still leaves _idIndex/_liveCount fully consistent after create()', async () => {
  const { repo } = await makeOpenRepo(baseConfig());
  repo.setUndoManager(makeThrowingManager());
  const result = await repo.create({ id: 'th1', name: 'x' });
  check(result.success === true, 'create() must still succeed even though the manager throws');
  check(repo._idIndex.get('th1') === 0, 'index must correctly point at the new record');
  check(repo._liveCount === 1, 'liveCount must correctly reflect the one live record');
});

// ================================================================
// SECTION Q — Restore compatibility
// ================================================================

await test('Q1: restore() hook does not interfere with the soft-delete guard on a subsequent update()', async () => {
  const { repo } = await makeOpenRepo(baseConfig(), [seedEntity('rc1', { deletedAt: '2026-01-02T00:00:00.000Z', name: 'x' })]);
  const spy = makeSpyManager();
  repo.setUndoManager(spy);
  await repo.restore('rc1');
  const result = await repo.update('rc1', { name: 'y' });
  check(result.success === true, 'update() after restore() must succeed normally (no longer soft-deleted)');
  check(spy._calls.length === 2, 'restore() then update() should log exactly 2 undo entries total');
  check(spy._calls[1].m === 'recordUpdate', 'second entry must be recordUpdate, from the subsequent update()');
});

await test('Q2: restore() hook interacts correctly with getAll()/search() visibility exactly as before this phase', async () => {
  const { repo } = await makeOpenRepo(baseConfig(), [seedEntity('rc2', { deletedAt: '2026-01-02T00:00:00.000Z', name: 'hidden' })]);
  repo.setUndoManager(makeSpyManager());
  check(repo.getAll().length === 0, 'sanity: soft-deleted record hidden from getAll() by default before restore()');
  await repo.restore('rc2');
  check(repo.getAll().length === 1, 'record must be visible in getAll() after restore(), unaffected by undo wiring');
});

await test('Q3: a delete() -> restore() -> delete() cycle logs exactly 3 undo entries with no state leakage', async () => {
  const { repo } = await makeOpenRepo(baseConfig(), [seedEntity('rc3', { name: 'cyclical' })]);
  const spy = makeSpyManager();
  repo.setUndoManager(spy);
  await repo.delete('rc3');
  await repo.restore('rc3');
  await repo.delete('rc3');
  check(spy._calls.length === 3, 'delete/restore/delete cycle should log exactly 3 entries');
  A.deepStrictEqual(spy._calls.map((c) => c.m), ['recordDelete', 'recordRestore', 'recordDelete'], 'entries must be in the exact order performed');
});

// ================================================================
// SECTION R — History counts / contents with a REAL UndoManager
// ================================================================

await test('R1: historySize() on a real UndoManager matches the number of loggable Repository operations', async () => {
  const { repo } = await makeOpenRepo(baseConfig());
  const um = new UndoManager(null);
  repo.setUndoManager(um);
  await repo.create({ id: 'hs1', name: 'a' });
  await repo.create({ id: 'hs2', name: 'b' });
  await repo.update('hs1', { name: 'a2' });
  await repo.delete('hs2');
  check(um.historySize() === 4, 'four loggable ops should produce exactly 4 history entries');
});

await test('R2: historySize() counts a bulk operation as exactly ONE entry, not one per record', async () => {
  const { repo } = await makeOpenRepo(baseConfig());
  const um = new UndoManager(null);
  repo.setUndoManager(um);
  await repo.bulkInsert([{ id: 'bh1', name: 'a' }, { id: 'bh2', name: 'b' }, { id: 'bh3', name: 'c' }]);
  check(um.historySize() === 1, 'a 3-item bulkInsert must produce exactly 1 history entry, not 3');
});

await test('R3: historySize() reflects a mixed sequence of single and bulk operations correctly', async () => {
  const { repo } = await makeOpenRepo(baseConfig());
  const um = new UndoManager(null);
  repo.setUndoManager(um);
  await repo.create({ id: 'mh1', name: 'a' });
  await repo.bulkInsert([{ id: 'mh2', name: 'b' }, { id: 'mh3', name: 'c' }]);
  await repo.update('mh1', { name: 'a2' });
  await repo.bulkDelete(['mh2', 'mh3']);
  check(um.historySize() === 4, 'create + bulkInsert + update + bulkDelete = 4 total entries');
});

await test('R4: exportHistory() contents exactly reflect a scripted create/update/delete sequence', async () => {
  const { repo } = await makeOpenRepo(baseConfig());
  const um = new UndoManager(null);
  repo.setUndoManager(um);
  const createResult = await repo.create({ id: 'ec1', name: 'first' });
  await repo.update('ec1', { name: 'second' });
  await repo.delete('ec1');
  const dump = um.exportHistory();
  check(dump.history.length === 3, 'exactly 3 entries expected');
  check(dump.history[0].type === 'create', 'entry 0 must be type "create"');
  check(dump.history[0].after.name === 'first', 'entry 0 after must be "first"');
  check(dump.history[1].type === 'update', 'entry 1 must be type "update"');
  check(dump.history[1].before.name === 'first', 'entry 1 before must be "first"');
  check(dump.history[1].after.name === 'second', 'entry 1 after must be "second"');
  check(dump.history[2].type === 'delete', 'entry 2 must be type "delete"');
  check(dump.history[2].before.name === 'second', 'entry 2 before must be "second"');
});

await test('R5: exportHistory() bulk entry metadata round-trips through JSON exactly (serialize/deserialize)', async () => {
  const { repo } = await makeOpenRepo(baseConfig());
  const um = new UndoManager(null);
  repo.setUndoManager(um);
  await repo.bulkUpdate([]); // no items -> should not record (covered elsewhere); seed real data instead below
  await repo.bulkInsert([{ id: 'sr1', name: 'a' }, { id: 'sr2', name: 'b' }]);
  const json = um.serialize();
  const um2 = new UndoManager(null);
  um2.deserialize(json);
  A.deepStrictEqual(um2.exportHistory().history, um.exportHistory().history, 'deserialized history must exactly match the original');
});

for (let i = 0; i < 15; i++) {
  await test('R6.' + i + ': repeated create/delete pairs accumulate history linearly (iteration ' + i + ')', async () => {
    const { repo } = await makeOpenRepo(baseConfig());
    const um = new UndoManager(null, { maxHistorySize: 1000 });
    repo.setUndoManager(um);
    for (let j = 0; j <= i; j++) {
      await repo.create({ id: 'rep' + i + '-' + j, name: 'x' });
    }
    check(um.historySize() === i + 1, 'history size should equal the number of creates performed in iteration ' + i);
  });
}

// ================================================================
// SECTION S — Redo clearing
// ================================================================

await test('S1: undo() then a new create() clears the redo stack, exactly like plain UndoManager semantics', async () => {
  const { repo } = await makeOpenRepo(baseConfig());
  const um = new UndoManager(null);
  repo.setUndoManager(um);
  await repo.create({ id: 'rd1', name: 'a' });
  await repo.create({ id: 'rd2', name: 'b' });
  repo.undo();
  check(repo.canRedo() === true, 'after undo(), redo should be available');
  await repo.create({ id: 'rd3', name: 'c' });
  check(repo.canRedo() === false, 'a new create() after undo() must clear the redo stack');
});

await test('S2: undo() via Repository facade returns the same shape as calling the UndoManager directly', async () => {
  const { repo } = await makeOpenRepo(baseConfig());
  const um = new UndoManager(null);
  repo.setUndoManager(um);
  await repo.create({ id: 'rd4', name: 'x' });
  const viaRepo = repo.undo();
  check(viaRepo.action === 'create', 'undo() via Repository must return the same action field');
  check(viaRepo.after.name === 'x', 'undo() via Repository must return the same after snapshot');
});

await test('S3: redo() via Repository facade replays correctly after undo()', async () => {
  const { repo } = await makeOpenRepo(baseConfig());
  const um = new UndoManager(null);
  repo.setUndoManager(um);
  await repo.create({ id: 'rd5', name: 'y' });
  repo.undo();
  const redone = repo.redo();
  check(redone.action === 'create', 'redo() must return the re-applied action');
  check(redone.after.name === 'y', 'redo() must return the original after snapshot');
  check(repo.canUndo() === true, 'after redo(), canUndo() should be true again');
});

// ================================================================
// SECTION T — dispose()
// ================================================================

await test('T1: dispose() releases the wired UndoManager', async () => {
  const { repo } = await makeOpenRepo(baseConfig());
  repo.setUndoManager(makeSpyManager());
  check(repo.getUndoManager() !== null, 'sanity: manager wired before dispose()');
  repo.dispose();
  check(repo.getUndoManager() === null, 'getUndoManager() must be null after dispose()');
});

await test('T2: dispose() with no manager wired is still a harmless no-op regarding undo state', async () => {
  const { repo } = await makeOpenRepo(baseConfig());
  repo.dispose(); // must not throw
  check(repo.getUndoManager() === null, 'getUndoManager() remains null after dispose() with nothing wired');
});

await test('T3: dispose() does not call dispose() on the wired UndoManager itself (Repository only drops its own reference)', async () => {
  const { repo } = await makeOpenRepo(baseConfig());
  const um = new UndoManager(null);
  repo.setUndoManager(um);
  repo.dispose();
  check(um._disposed === false, 'the UndoManager instance itself must remain un-disposed — only the Repository handle is dropped');
});

// ================================================================
// SECTION U — Stress
// ================================================================

await test('U1: 400-op randomized mixed-CRUD stress sequence with a real UndoManager wired — no exceptions, invariants hold', async () => {
  const { repo } = await makeOpenRepo(baseConfig());
  const um = new UndoManager(null, { maxHistorySize: 5000 });
  repo.setUndoManager(um);
  const liveIds = [];
  let seq = 0;
  let loggableOps = 0;

  function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

  for (let i = 0; i < 400; i++) {
    const roll = Math.random();
    if (roll < 0.35 || liveIds.length === 0) {
      const id = 'stress' + (seq++);
      const r = await repo.create({ id: id, name: 'n' + id });
      if (r.success) { liveIds.push(id); loggableOps++; }
    } else if (roll < 0.6) {
      const id = pick(liveIds);
      const r = await repo.update(id, { name: 'upd' + seq++ });
      if (r.success) loggableOps++;
    } else if (roll < 0.85) {
      const idx = Math.floor(Math.random() * liveIds.length);
      const id = liveIds[idx];
      const r = await repo.delete(id);
      if (r.success) { liveIds.splice(idx, 1); loggableOps++; }
    } else {
      const id = 'stress' + (seq++);
      await repo.create({ id: id, name: 'n' + id });
      liveIds.push(id);
      const r = await repo.restore(id); // idempotent — already live, no-op, no record
      check(r.success === true, 'restore on a live record must still succeed during stress');
      loggableOps++; // the create() above counts; restore() itself does not add an entry
    }
  }

  check(repo._idIndex.size === repo._records.length, 'index size must equal record count after the stress sequence');
  let recomputedLive = 0;
  for (const r of repo._records) if (!repo._isDeleted(r)) recomputedLive++;
  check(repo._liveCount === recomputedLive, 'liveCount must exactly match a fresh recount after the stress sequence');
  check(um.historySize() <= 5000, 'history size must never exceed the configured cap');
  check(um.historySize() > 0, 'some history must have accumulated');
});

await test('U2: stress sequence with a THROWING UndoManager wired never corrupts Repository state', async () => {
  const { repo } = await makeOpenRepo(baseConfig());
  repo.setUndoManager(makeThrowingManager());
  for (let i = 0; i < 100; i++) {
    const id = 'ts' + i;
    const r = await repo.create({ id: id, name: 'x' });
    check(r.success === true, 'create() #' + i + ' must succeed despite the throwing manager');
  }
  check(repo._records.length === 100, 'all 100 records must exist');
  check(repo._idIndex.size === 100, 'index must have exactly 100 entries');
  check(repo._liveCount === 100, 'liveCount must equal 100');
});

await test('U3: 50-cycle set/remove/reset manager churn interleaved with writes never desyncs the cache', async () => {
  const { repo } = await makeOpenRepo(baseConfig());
  for (let i = 0; i < 50; i++) {
    if (i % 2 === 0) repo.setUndoManager(makeSpyManager());
    else repo.setUndoManager(null);
    await repo.create({ id: 'churn' + i, name: 'x' });
  }
  check(repo._records.length === 50, 'all 50 records must exist despite manager churn');
  check(repo._idIndex.size === 50, 'index must remain fully consistent despite manager churn');
});

// ================================================================
// SECTION V — Performance (overhead sanity, not a formal benchmark —
// same "relative timing as a regression signal" convention as
// verify_repository_cache_layer.js §O / verify_cache_validation.js)
// ================================================================

await test('V1: recording undo history for 300 sequential creates adds bounded overhead vs no manager wired', async () => {
  const a = await makeOpenRepo(baseConfig());
  const b = await makeOpenRepo(baseConfig());
  const um = new UndoManager(null, { maxHistorySize: 1000 });
  b.repo.setUndoManager(um);

  const t0 = Date.now();
  for (let i = 0; i < 300; i++) await a.repo.create({ id: 'perfA' + i, name: 'x' });
  const noManagerMs = Date.now() - t0;

  const t1 = Date.now();
  for (let i = 0; i < 300; i++) await b.repo.create({ id: 'perfB' + i, name: 'x' });
  const withManagerMs = Date.now() - t1;

  check(um.historySize() === 300, 'sanity: 300 history entries recorded');
  // Generous bound — this is a correctness/sanity signal, not a strict
  // perf gate (Performance_Baseline_Report.md's own convention).
  check(withManagerMs <= (noManagerMs + 500) * 4 + 200, 'undo recording overhead should stay within a generous bound (with=' + withManagerMs + 'ms, without=' + noManagerMs + 'ms)');
});

await test('V2: a single bulkInsert of 2000 items still logs exactly ONE history entry (no per-item overhead scaling)', async () => {
  const { repo } = await makeOpenRepo(baseConfig());
  const um = new UndoManager(null, { maxHistorySize: 10 });
  repo.setUndoManager(um);
  const items = [];
  for (let i = 0; i < 2000; i++) items.push({ id: 'perfbulk' + i, name: 'x' });
  const t0 = Date.now();
  await repo.bulkInsert(items);
  const ms = Date.now() - t0;
  check(um.historySize() === 1, 'a 2000-item bulkInsert must still be exactly 1 history entry');
  check(ms < 5000, 'a 2000-item bulkInsert with undo recording should complete well under 5s (' + ms + 'ms)');
});

// ================================================================
// SECTION W — Mock UndoManager coverage
// ================================================================

await test('W1: a mock manager whose recordCreate returns undefined does not affect create()\'s own WriteResult', async () => {
  const { repo } = await makeOpenRepo(baseConfig());
  repo.setUndoManager({
    recordCreate: function () { return undefined; },
    recordUpdate: function () {}, recordDelete: function () {}, recordRestore: function () {},
    undo: function () {}, redo: function () {}
  });
  const result = await repo.create({ id: 'mock1', name: 'x' });
  check(result.success === true, 'create() success must be independent of what the manager returns');
  check(result.record.name === 'x', 'create() result payload must be unaffected by the manager');
});

await test('W2: a mock manager that mutates its input arguments cannot corrupt the Repository\'s own record', async () => {
  const { repo } = await makeOpenRepo(baseConfig());
  repo.setUndoManager({
    recordCreate: function (after) { after.name = 'MUTATED'; },
    recordUpdate: function () {}, recordDelete: function () {}, recordRestore: function () {},
    undo: function () {}, redo: function () {}
  });
  const result = await repo.create({ id: 'mock2', name: 'original' });
  check(result.record.name === 'original', 'the WriteResult must reflect the true record, unaffected by what the manager does with its clone');
  check(repo.get('mock2').name === 'original', 'the stored record itself must remain unaffected by manager-side mutation of its snapshot');
});

await test('W3: undo()/redo() forwarding surfaces exactly whatever the mock manager returns, including null', async () => {
  const { repo } = await makeOpenRepo(baseConfig());
  repo.setUndoManager({
    recordCreate: function () {}, recordUpdate: function () {}, recordDelete: function () {}, recordRestore: function () {},
    undo: function () { return null; }, redo: function () { return { custom: 'shape' }; }
  });
  check(repo.undo() === null, 'undo() must surface a null return from the manager verbatim');
  A.deepStrictEqual(repo.redo(), { custom: 'shape' }, 'redo() must surface a custom return shape from the manager verbatim');
});

for (let i = 0; i < 10; i++) {
  await test('W4.' + i + ': a throwing manager never prevents delete() from succeeding (iteration ' + i + ')', async () => {
    const { repo } = await makeOpenRepo(baseConfig(), [seedEntity('thr' + i, { name: 'x' })]);
    repo.setUndoManager(makeThrowingManager());
    const result = await repo.delete('thr' + i);
    check(result.success === true, 'delete() must succeed despite the throwing manager at iteration ' + i);
  });
}

// ================================================================
// SECTION X — Real UndoManager integration
// ================================================================

await test('X1: real UndoManager — disable() stops new recording without breaking Repository writes', async () => {
  const { repo } = await makeOpenRepo(baseConfig());
  const um = new UndoManager(null);
  repo.setUndoManager(um);
  await repo.create({ id: 'dis1', name: 'a' });
  um.disable();
  const result = await repo.create({ id: 'dis2', name: 'b' });
  check(result.success === true, 'create() must succeed even while the manager is disabled');
  check(um.historySize() === 1, 'no new history should be recorded while disabled');
  um.enable();
  await repo.create({ id: 'dis3', name: 'c' });
  check(um.historySize() === 2, 'recording should resume once re-enabled');
});

await test('X2: real UndoManager — maxHistorySize overflow (FIFO) still works correctly when driven via Repository', async () => {
  const { repo } = await makeOpenRepo(baseConfig());
  const um = new UndoManager(null, { maxHistorySize: 3 });
  repo.setUndoManager(um);
  for (let i = 0; i < 5; i++) await repo.create({ id: 'ov' + i, name: 'x' });
  check(um.historySize() === 3, 'history must be capped at maxHistorySize (3)');
  const dump = um.exportHistory();
  check(dump.history[0].after.name === 'x' && dump.history.length === 3, 'oldest entries must have been dropped FIFO, only the most recent 3 remain');
});

await test('X3: real UndoManager — a full create -> undo -> redo -> create cycle driven entirely through the Repository facade', async () => {
  const { repo } = await makeOpenRepo(baseConfig());
  const um = new UndoManager(null);
  repo.setUndoManager(um);
  await repo.create({ id: 'cyc1', name: 'first' });
  check(repo.canUndo() === true, 'after create, canUndo() true');
  const undone = repo.undo();
  check(undone.action === 'create', 'undo() must report the create action');
  check(repo.canRedo() === true, 'after undo, canRedo() true');
  check(repo.canUndo() === false, 'after undoing the only entry, canUndo() false');
  const redone = repo.redo();
  check(redone.action === 'create', 'redo() must report the create action again');
  check(repo.canUndo() === true, 'after redo, canUndo() true again');
  await repo.create({ id: 'cyc2', name: 'second' });
  check(repo.canRedo() === false, 'a fresh create() after redo() must clear the redo stack again');
  check(um.historySize() === 2, 'two real history entries should now exist (cyc1 redone + cyc2 created)');
});

await test('X4: real UndoManager — wiring the SAME instance across two different Repositories keeps one shared history', async () => {
  const { repo: repoA } = await makeOpenRepo(baseConfig({ entityKey: 'entityA' }));
  const { repo: repoB } = await makeOpenRepo(baseConfig({ entityKey: 'entityB' }));
  const shared = new UndoManager(null);
  repoA.setUndoManager(shared);
  repoB.setUndoManager(shared);
  await repoA.create({ id: 'shA1', name: 'a' });
  await repoB.create({ id: 'shB1', name: 'b' });
  check(shared.historySize() === 2, 'a shared UndoManager should see writes from both Repositories in one history');
  check(repoA.getUndoManager() === repoB.getUndoManager(), 'both facades should report the exact same underlying manager instance');
});

for (let i = 0; i < 10; i++) {
  await test('X5.' + i + ': real UndoManager — bulkUpdate() undo entry before/after content is exactly right (iteration ' + i + ')', async () => {
    const seeds = makeSeeds(4).map((s) => Object.assign({}, s, { id: s.id + '-x5-' + i }));
    const { repo } = await makeOpenRepo(baseConfig(), seeds);
    const um = new UndoManager(null);
    repo.setUndoManager(um);
    await repo.bulkUpdate(seeds.map((s) => ({ id: s.id, patch: { name: s.name + '-changed' } })));
    const dump = um.exportHistory();
    check(dump.history.length === 1, 'iteration ' + i + ': exactly one history entry expected');
    check(dump.history[0].type === 'update', 'iteration ' + i + ': entry type must be update');
    check(dump.history[0].before.length === 4, 'iteration ' + i + ': before array must have 4 items');
    check(dump.history[0].after.every((r) => r.name.endsWith('-changed')), 'iteration ' + i + ': all after items must carry the -changed suffix');
  });
}

// ================================================================
// SECTION Y — Exhaustive per-item content verification at scale
// (large single-batch operations, one labelled test each, many
// assertions per test — same convention as verify_cache_validation.js's
// scale sections, where a handful of labelled tests carry the bulk of
// the total assertion count via per-record loops)
// ================================================================

await test('Y1: bulkInsert() — every one of 1000 items appears correctly in the ONE undo entry', async () => {
  const { repo } = await makeOpenRepo(baseConfig());
  const spy = makeSpyManager();
  repo.setUndoManager(spy);
  const items = [];
  for (let i = 0; i < 1000; i++) items.push({ id: 'y1-' + i, name: 'item-' + i, seq: i });
  const results = await repo.bulkInsert(items);
  check(spy._calls.length === 1, 'exactly one entry expected for the whole 1000-item batch');
  check(spy._calls[0].meta.count === 1000, 'metadata.count must equal 1000');
  check(spy._calls[0].after.length === 1000, 'after array must contain exactly 1000 items');
  for (let i = 0; i < 1000; i++) {
    check(results[i].success === true, 'item #' + i + ' should have succeeded');
    check(spy._calls[0].after[i].seq === i, 'recorded snapshot #' + i + ' seq must match');
    check(spy._calls[0].after[i].name === 'item-' + i, 'recorded snapshot #' + i + ' name must match');
  }
});

await test('Y2: bulkUpdate() — every one of 800 items appears correctly (before+after) in the ONE undo entry', async () => {
  const seeds = [];
  for (let i = 0; i < 800; i++) seeds.push(seedEntity('y2-' + i, { name: 'before-' + i }));
  const { repo } = await makeOpenRepo(baseConfig(), seeds);
  const spy = makeSpyManager();
  repo.setUndoManager(spy);
  const patches = seeds.map((s, i) => ({ id: s.id, patch: { name: 'after-' + i } }));
  const results = await repo.bulkUpdate(patches);
  check(spy._calls.length === 1, 'exactly one entry expected for the whole 800-item batch');
  check(spy._calls[0].meta.count === 800, 'metadata.count must equal 800');
  check(spy._calls[0].before.length === 800, 'before array must contain exactly 800 items');
  check(spy._calls[0].after.length === 800, 'after array must contain exactly 800 items');
  for (let i = 0; i < 800; i++) {
    check(results[i].success === true, 'patch #' + i + ' should have succeeded');
    check(spy._calls[0].before[i].name === 'before-' + i, 'before snapshot #' + i + ' name must match');
    check(spy._calls[0].after[i].name === 'after-' + i, 'after snapshot #' + i + ' name must match');
  }
});

await test('Y3: bulkDelete() — every one of 600 ids appears correctly in the ONE undo entry (soft-delete)', async () => {
  const seeds = [];
  for (let i = 0; i < 600; i++) seeds.push(seedEntity('y3-' + i, { name: 'live-' + i }));
  const { repo } = await makeOpenRepo(baseConfig(), seeds);
  const spy = makeSpyManager();
  repo.setUndoManager(spy);
  const results = await repo.bulkDelete(seeds.map((s) => s.id));
  check(spy._calls.length === 1, 'exactly one entry expected for the whole 600-item batch');
  check(spy._calls[0].meta.count === 600, 'metadata.count must equal 600');
  check(spy._calls[0].before.length === 600, 'before array must contain exactly 600 items');
  check(spy._calls[0].meta.after.length === 600, 'metadata.after array must contain exactly 600 items');
  for (let i = 0; i < 600; i++) {
    check(results[i].success === true, 'delete #' + i + ' should have succeeded');
    check(spy._calls[0].before[i].name === 'live-' + i, 'before snapshot #' + i + ' name must match');
    check(spy._calls[0].meta.after[i].deletedAt !== null, 'post-delete snapshot #' + i + ' must carry a deletedAt stamp');
  }
});

await test('Y4: clear() — every one of 500 pre-existing records appears correctly in the ONE undo entry', async () => {
  const seeds = [];
  for (let i = 0; i < 500; i++) seeds.push(seedEntity('y4-' + i, { name: 'clearme-' + i }));
  const { repo } = await makeOpenRepo(baseConfig(), seeds);
  const spy = makeSpyManager();
  repo.setUndoManager(spy);
  const result = await repo.clear();
  check(result.success === true, 'clear() should succeed');
  check(spy._calls.length === 1, 'exactly one entry expected for the whole clear()');
  check(spy._calls[0].meta.count === 500, 'metadata.count must equal 500');
  check(spy._calls[0].before.length === 500, 'before array must contain exactly 500 items');
  for (let i = 0; i < 500; i++) {
    check(spy._calls[0].before[i].name === 'clearme-' + i, 'before snapshot #' + i + ' name must match');
  }
  check(repo.export().length === 0, 'Repository must be empty after clear()');
});

await test('Y5: import(replace) — every one of 700 incoming records appears correctly in the ONE undo entry', async () => {
  const { repo } = await makeOpenRepo(baseConfig(), makeSeeds(3));
  const spy = makeSpyManager();
  repo.setUndoManager(spy);
  const incoming = [];
  for (let i = 0; i < 700; i++) incoming.push(seedEntity('y5-' + i, { name: 'incoming-' + i }));
  const result = await repo.import(incoming, 'replace');
  check(result.success === true, 'import() should succeed');
  check(spy._calls.length === 1, 'exactly one entry expected for the whole import');
  check(spy._calls[0].after.length === 700, 'after array must contain exactly 700 items');
  for (let i = 0; i < 700; i++) {
    check(spy._calls[0].after[i].name === 'incoming-' + i, 'after snapshot #' + i + ' name must match');
  }
});

await test('Y6: transaction() — a 300-step all-create transaction records ONE entry with every created record present', async () => {
  const { repo } = await makeOpenRepo(baseConfig());
  const spy = makeSpyManager();
  repo.setUndoManager(spy);
  const ops = [];
  for (let i = 0; i < 300; i++) ops.push({ op: 'create', entity: { id: 'y6-' + i, name: 'tx-' + i } });
  const result = await repo.transaction(ops);
  check(result.success === true, 'transaction() should commit');
  check(spy._calls.length === 1, 'exactly one entry expected for the whole 300-step transaction');
  check(spy._calls[0].meta.opsCount === 300, 'metadata.opsCount must equal 300');
  check(spy._calls[0].after.length === 300, 'after snapshot must contain all 300 created records');
  for (let i = 0; i < 300; i++) {
    check(spy._calls[0].after[i].name === 'tx-' + i, 'after snapshot #' + i + ' name must match');
    check(spy._calls[0].meta.opTypes[i] === 'create', 'opTypes #' + i + ' must be "create"');
  }
});

await test('Y7: real UndoManager — a 500-item bulkInsert followed by exportHistory() round-trips every record through JSON exactly', async () => {
  const { repo } = await makeOpenRepo(baseConfig());
  const um = new UndoManager(null);
  repo.setUndoManager(um);
  const items = [];
  for (let i = 0; i < 500; i++) items.push({ id: 'y7-' + i, name: 'real-' + i });
  await repo.bulkInsert(items);
  const dump = um.exportHistory();
  check(dump.history.length === 1, 'exactly one real history entry expected');
  check(dump.history[0].after.length === 500, 'real history entry must carry all 500 created records');
  for (let i = 0; i < 500; i++) {
    check(dump.history[0].after[i].name === 'real-' + i, 'real history record #' + i + ' name must match');
    check(dump.history[0].after[i].id === 'y7-' + i, 'real history record #' + i + ' id must match');
  }
});

// ================================================================
// Summary
// ================================================================

console.log('----------------------------------------------------------------');
console.log('Labeled tests: ' + testCount + '   (PASS ' + passed + ' / FAIL ' + failed + ')');
console.log('Assertion executions: ' + assertionCount);
console.log('================================================================');

if (failed > 0) {
  console.log('\nFAILURES:');
  log.filter((l) => l.startsWith('FAIL')).forEach((l) => console.log(l));
}

const MIN_TESTS = 180;
const MIN_ASSERTIONS = 4000;
let ok = failed === 0;
if (testCount < MIN_TESTS) {
  console.log('MINIMUM NOT MET: labelled tests ' + testCount + ' < required ' + MIN_TESTS);
  ok = false;
}
if (assertionCount < MIN_ASSERTIONS) {
  console.log('MINIMUM NOT MET: assertions ' + assertionCount + ' < required ' + MIN_ASSERTIONS);
  ok = false;
}

if (ok) {
  console.log('PASS — all ' + testCount + ' labelled tests and ' + assertionCount + ' assertions succeeded, minimums met.');
} else {
  console.log('FAIL — see above.');
}
process.exitCode = ok ? 0 : 1;

}

runSuite();
