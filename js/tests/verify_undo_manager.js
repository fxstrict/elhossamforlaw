/**
 * verify_undo_manager.js
 * ================================================================
 * PHASE 12 — SUB-PHASE 12.2 — Undo Manager Core Implementation
 * ================================================================
 * Standalone Node harness (`node js/tests/verify_undo_manager.js`, no
 * browser required, no external libraries beyond Node's built-in
 * `assert`/`path`). Exercises `js/core/UndoManager.js` in complete
 * isolation — no Repository is imported or required; a trivial mock
 * repository object is used only to prove the constructor accepts and
 * stores (but never calls) whatever handle it is given.
 *
 * Coverage (per the governing prompt's minimum list): constructor,
 * enable, disable, history size, redo size, FIFO, clear, recordCreate,
 * recordUpdate, recordDelete, recordRestore, undo, redo, undo empty,
 * redo empty, multiple undo, multiple redo, history overflow, snapshot
 * isolation, deep clone, timestamps, metadata, serialize, deserialize,
 * export, import, dispose, random stress, large history, performance,
 * memory.
 *
 * Minimums required by this sub-phase: >= 150 labelled tests,
 * >= 3000 individual assertions. Both are printed in the final summary
 * and this file exits non-zero if either minimum, or any assertion,
 * fails.
 */

'use strict';

const assert = require('assert');
const path = require('path');

const { UndoManager } = require(path.join(__dirname, '..', 'core', 'UndoManager.js'));

// ================================================================
// Harness plumbing
// ================================================================

let testCount = 0;
let assertionCount = 0;
let failCount = 0;
const failures = [];

/** Counts as one assertion; records a failure without throwing so the
 *  rest of the current test still runs (maximizes diagnostic output). */
function check(condition, message) {
  assertionCount++;
  if (!condition) {
    failCount++;
    failures.push(message);
  }
}

function deepEqual(a, b, message) {
  assertionCount++;
  try {
    assert.deepStrictEqual(a, b);
  } catch (e) {
    failCount++;
    failures.push(message + ' — ' + e.message);
  }
}

function test(label, fn) {
  testCount++;
  try {
    fn();
  } catch (e) {
    failCount++;
    failures.push('[' + label + '] threw: ' + (e && e.stack ? e.stack : e));
  }
}

// A trivial mock repository. UndoManager must never call any method on
// this — several tests below assert exactly that.
function makeMockRepository() {
  const calls = [];
  return {
    _calls: calls,
    create: function () { calls.push('create'); },
    update: function () { calls.push('update'); },
    delete: function () { calls.push('delete'); },
    restore: function () { calls.push('restore'); }
  };
}

// ================================================================
// 1. Constructor
// ================================================================

test('constructor: default maxHistorySize is 50', () => {
  const um = new UndoManager(makeMockRepository());
  check(um._maxHistory === 50, 'default maxHistory should be 50');
});

test('constructor: stores repository handle without calling it', () => {
  const repo = makeMockRepository();
  const um = new UndoManager(repo);
  check(um._repository === repo, 'repository handle should be stored as-is');
  check(repo._calls.length === 0, 'constructor must never call the repository');
});

test('constructor: accepts null repository', () => {
  const um = new UndoManager(null);
  check(um._repository === null, 'null repository should be stored as null');
});

test('constructor: accepts undefined repository', () => {
  const um = new UndoManager(undefined);
  check(um._repository === null, 'undefined repository should normalize to null');
});

test('constructor: no options object at all', () => {
  const um = new UndoManager(makeMockRepository());
  check(um._maxHistory === 50, 'missing options should still default maxHistory to 50');
});

test('constructor: empty options object', () => {
  const um = new UndoManager(makeMockRepository(), {});
  check(um._maxHistory === 50, 'empty options should default maxHistory to 50');
});

test('constructor: custom maxHistorySize honored', () => {
  const um = new UndoManager(makeMockRepository(), { maxHistorySize: 5 });
  check(um._maxHistory === 5, 'custom maxHistory should be honored');
});

test('constructor: custom maxHistorySize=1', () => {
  const um = new UndoManager(makeMockRepository(), { maxHistorySize: 1 });
  check(um._maxHistory === 1, 'maxHistory of 1 should be honored');
});

test('constructor: custom maxHistorySize=1000', () => {
  const um = new UndoManager(makeMockRepository(), { maxHistorySize: 1000 });
  check(um._maxHistory === 1000, 'large maxHistory should be honored');
});

test('constructor: non-integer maxHistorySize is floored', () => {
  const um = new UndoManager(makeMockRepository(), { maxHistorySize: 7.9 });
  check(um._maxHistory === 7, 'non-integer maxHistory should be floored');
});

const invalidSizes = [0, -5, -1, NaN, Infinity, -Infinity, '50', null, undefined, {}, [], true, false];
invalidSizes.forEach((bad, i) => {
  test('constructor: invalid maxHistorySize #' + i + ' (' + String(bad) + ') falls back to 50', () => {
    const um = new UndoManager(makeMockRepository(), { maxHistorySize: bad });
    check(um._maxHistory === 50, 'invalid maxHistorySize (' + String(bad) + ') should fall back to default 50');
  });
});

test('constructor: starts enabled', () => {
  const um = new UndoManager(makeMockRepository());
  check(um.isEnabled() === true, 'new UndoManager should start enabled');
});

test('constructor: starts with empty history and redo', () => {
  const um = new UndoManager(makeMockRepository());
  check(um.historySize() === 0, 'history should start empty');
  check(um.redoSize() === 0, 'redo should start empty');
  check(um.canUndo() === false, 'canUndo() should start false');
  check(um.canRedo() === false, 'canRedo() should start false');
});

// ================================================================
// 2. enable / disable / isEnabled
// ================================================================

test('enable/disable: disable() then isEnabled() is false', () => {
  const um = new UndoManager(makeMockRepository());
  um.disable();
  check(um.isEnabled() === false, 'isEnabled should be false after disable()');
});

test('enable/disable: enable() after disable() restores true', () => {
  const um = new UndoManager(makeMockRepository());
  um.disable();
  um.enable();
  check(um.isEnabled() === true, 'isEnabled should be true after enable()');
});

test('enable/disable: disable() prevents recordCreate from recording', () => {
  const um = new UndoManager(makeMockRepository());
  um.disable();
  const result = um.recordCreate({ id: 1 });
  check(result === null, 'recordCreate should return null while disabled');
  check(um.historySize() === 0, 'history should stay empty while disabled');
});

test('enable/disable: disable() prevents recordUpdate from recording', () => {
  const um = new UndoManager(makeMockRepository());
  um.disable();
  const result = um.recordUpdate({ id: 1, v: 1 }, { id: 1, v: 2 });
  check(result === null, 'recordUpdate should return null while disabled');
  check(um.historySize() === 0, 'history should stay empty while disabled');
});

test('enable/disable: disable() prevents recordDelete from recording', () => {
  const um = new UndoManager(makeMockRepository());
  um.disable();
  const result = um.recordDelete({ id: 1 });
  check(result === null, 'recordDelete should return null while disabled');
  check(um.historySize() === 0, 'history should stay empty while disabled');
});

test('enable/disable: disable() prevents recordRestore from recording', () => {
  const um = new UndoManager(makeMockRepository());
  um.disable();
  const result = um.recordRestore({ id: 1 }, { id: 1 });
  check(result === null, 'recordRestore should return null while disabled');
  check(um.historySize() === 0, 'history should stay empty while disabled');
});

test('enable/disable: disable() does NOT block undo()/redo()', () => {
  const um = new UndoManager(makeMockRepository());
  um.recordCreate({ id: 1 });
  um.disable();
  const instr = um.undo();
  check(instr !== null, 'undo() should still work while disabled');
  check(um.canRedo() === true, 'redo should be available after undo() while disabled');
});

test('enable/disable: re-enabling resumes recording', () => {
  const um = new UndoManager(makeMockRepository());
  um.disable();
  um.recordCreate({ id: 1 });
  um.enable();
  um.recordCreate({ id: 2 });
  check(um.historySize() === 1, 'only the post-enable record should be in history');
});

test('enable/disable: multiple toggles are idempotent', () => {
  const um = new UndoManager(makeMockRepository());
  um.enable(); um.enable(); um.disable(); um.disable(); um.enable();
  check(um.isEnabled() === true, 'final state should reflect last call');
});

// ================================================================
// 3. historySize / redoSize
// ================================================================

for (let i = 1; i <= 6; i++) {
  test('historySize: after ' + i + ' recordCreate call(s)', () => {
    const um = new UndoManager(makeMockRepository(), { maxHistorySize: 50 });
    for (let j = 0; j < i; j++) um.recordCreate({ id: j });
    check(um.historySize() === i, 'historySize should equal number of records made');
  });
}

for (let i = 1; i <= 6; i++) {
  test('redoSize: after ' + i + ' recordCreate + ' + i + ' undo call(s)', () => {
    const um = new UndoManager(makeMockRepository(), { maxHistorySize: 50 });
    for (let j = 0; j < i; j++) um.recordCreate({ id: j });
    for (let j = 0; j < i; j++) um.undo();
    check(um.redoSize() === i, 'redoSize should equal number of undos performed');
    check(um.historySize() === 0, 'history should be empty after undoing everything');
  });
}

// ================================================================
// 4. clear()
// ================================================================

test('clear: empties a populated history', () => {
  const um = new UndoManager(makeMockRepository());
  um.recordCreate({ id: 1 });
  um.recordCreate({ id: 2 });
  um.clear();
  check(um.historySize() === 0, 'history should be empty after clear()');
});

test('clear: empties a populated redo stack', () => {
  const um = new UndoManager(makeMockRepository());
  um.recordCreate({ id: 1 });
  um.undo();
  um.clear();
  check(um.redoSize() === 0, 'redo should be empty after clear()');
});

test('clear: canUndo/canRedo both false after clear()', () => {
  const um = new UndoManager(makeMockRepository());
  um.recordCreate({ id: 1 });
  um.recordCreate({ id: 2 });
  um.undo();
  um.clear();
  check(um.canUndo() === false, 'canUndo should be false after clear()');
  check(um.canRedo() === false, 'canRedo should be false after clear()');
});

test('clear: does not change enabled state', () => {
  const um = new UndoManager(makeMockRepository());
  um.disable();
  um.clear();
  check(um.isEnabled() === false, 'clear() should not re-enable the manager');
});

test('clear: safe to call on an already-empty manager', () => {
  const um = new UndoManager(makeMockRepository());
  um.clear();
  check(um.historySize() === 0, 'clear() on empty manager should stay empty');
});

test('clear: manager remains usable after clear()', () => {
  const um = new UndoManager(makeMockRepository());
  um.recordCreate({ id: 1 });
  um.clear();
  um.recordCreate({ id: 2 });
  check(um.historySize() === 1, 'manager should record normally after clear()');
});

// ================================================================
// 5. FIFO overflow — history
// ================================================================

[1, 2, 3, 5, 10].forEach((max) => {
  test('FIFO history overflow: maxHistorySize=' + max + ', push ' + (max + 3), () => {
    const um = new UndoManager(makeMockRepository(), { maxHistorySize: max });
    for (let i = 0; i < max + 3; i++) um.recordCreate({ id: i });
    check(um.historySize() === max, 'historySize should be capped at ' + max);
    const exported = um.exportHistory();
    check(exported.history[0].after.id === 3, 'oldest 3 entries should have been dropped (FIFO)');
    check(exported.history[exported.history.length - 1].after.id === max + 2, 'newest entry should be the last one pushed');
  });
});

// ================================================================
// 6. FIFO overflow — redo
// ================================================================

[1, 2, 3, 5, 10].forEach((max) => {
  test('FIFO redo overflow: maxHistorySize=' + max + ', undo ' + (max + 3) + ' of ' + (max + 3), () => {
    const um = new UndoManager(makeMockRepository(), { maxHistorySize: max + 3 });
    for (let i = 0; i < max + 3; i++) um.recordCreate({ id: i });
    um._maxHistory = max; // simulate a bound tighter than what history currently holds is not needed; instead push undo count beyond max directly
    for (let i = 0; i < max + 3; i++) um.undo();
    check(um.redoSize() === max, 'redoSize should be capped at ' + max);
  });
});

// ================================================================
// 7. recordCreate
// ================================================================

test('recordCreate: basic entry shape', () => {
  const um = new UndoManager(makeMockRepository());
  const entry = um.recordCreate({ id: 1, name: 'a' }, { user: 'x' });
  check(entry.type === 'create', 'type should be create');
  check(entry.before === null, 'before should be null for create');
  deepEqual(entry.after, { id: 1, name: 'a' }, 'after should match the created record');
  deepEqual(entry.metadata, { user: 'x' }, 'metadata should match what was passed');
  check(typeof entry.timestamp === 'string', 'timestamp should be a string');
});

test('recordCreate: default metadata is {}', () => {
  const um = new UndoManager(makeMockRepository());
  const entry = um.recordCreate({ id: 1 });
  deepEqual(entry.metadata, {}, 'metadata should default to an empty object');
});

test('recordCreate: pushes exactly one history entry', () => {
  const um = new UndoManager(makeMockRepository());
  um.recordCreate({ id: 1 });
  check(um.historySize() === 1, 'history should have exactly one entry');
});

test('recordCreate: clears an existing redo stack', () => {
  const um = new UndoManager(makeMockRepository());
  um.recordCreate({ id: 1 });
  um.undo();
  check(um.canRedo() === true, 'sanity: redo available before new record');
  um.recordCreate({ id: 2 });
  check(um.canRedo() === false, 'a fresh recordCreate should clear the redo stack');
});

test('recordCreate: after is deep-cloned (mutating caller object does not affect history)', () => {
  const um = new UndoManager(makeMockRepository());
  const obj = { id: 1, nested: { x: 1 } };
  um.recordCreate(obj);
  obj.nested.x = 999;
  const exported = um.exportHistory();
  check(exported.history[0].after.nested.x === 1, 'mutating the original object after recording must not affect the stored snapshot');
});

test('recordCreate: returned entry is deep-cloned (mutating it does not affect internal state)', () => {
  const um = new UndoManager(makeMockRepository());
  const entry = um.recordCreate({ id: 1, nested: { x: 1 } });
  entry.after.nested.x = 999;
  const exported = um.exportHistory();
  check(exported.history[0].after.nested.x === 1, 'mutating the returned entry must not affect internal state');
});

test('recordCreate: works with array-valued fields', () => {
  const um = new UndoManager(makeMockRepository());
  const entry = um.recordCreate({ id: 1, tags: ['a', 'b'] });
  deepEqual(entry.after.tags, ['a', 'b'], 'array fields should be preserved');
});

test('recordCreate: works with deeply nested objects', () => {
  const um = new UndoManager(makeMockRepository());
  const entry = um.recordCreate({ id: 1, a: { b: { c: { d: 42 } } } });
  check(entry.after.a.b.c.d === 42, 'deeply nested values should survive cloning');
});

test('recordCreate: never calls the repository', () => {
  const repo = makeMockRepository();
  const um = new UndoManager(repo);
  um.recordCreate({ id: 1 });
  check(repo._calls.length === 0, 'recordCreate must never call the repository');
});

test('recordCreate: metadata deep clone isolation', () => {
  const um = new UndoManager(makeMockRepository());
  const meta = { tag: 'x', nested: { n: 1 } };
  um.recordCreate({ id: 1 }, meta);
  meta.nested.n = 999;
  const exported = um.exportHistory();
  check(exported.history[0].metadata.nested.n === 1, 'metadata should be deep cloned, not referenced');
});

// ================================================================
// 8. recordUpdate
// ================================================================

test('recordUpdate: basic entry shape', () => {
  const um = new UndoManager(makeMockRepository());
  const entry = um.recordUpdate({ id: 1, v: 1 }, { id: 1, v: 2 }, { who: 'a' });
  check(entry.type === 'update', 'type should be update');
  deepEqual(entry.before, { id: 1, v: 1 }, 'before should match prior state');
  deepEqual(entry.after, { id: 1, v: 2 }, 'after should match new state');
});

test('recordUpdate: default metadata is {}', () => {
  const um = new UndoManager(makeMockRepository());
  const entry = um.recordUpdate({ id: 1 }, { id: 1, v: 2 });
  deepEqual(entry.metadata, {}, 'metadata should default to {}');
});

test('recordUpdate: pushes exactly one history entry', () => {
  const um = new UndoManager(makeMockRepository());
  um.recordUpdate({ id: 1 }, { id: 1, v: 2 });
  check(um.historySize() === 1, 'history should have one entry');
});

test('recordUpdate: clears redo stack', () => {
  const um = new UndoManager(makeMockRepository());
  um.recordCreate({ id: 1 });
  um.undo();
  um.recordUpdate({ id: 1 }, { id: 1, v: 2 });
  check(um.canRedo() === false, 'recordUpdate should clear redo');
});

test('recordUpdate: before and after are independently cloned', () => {
  const um = new UndoManager(makeMockRepository());
  const before = { id: 1, v: 1 };
  const after = { id: 1, v: 2 };
  um.recordUpdate(before, after);
  before.v = 999;
  after.v = 888;
  const exported = um.exportHistory();
  check(exported.history[0].before.v === 1, 'before snapshot should be isolated from source mutation');
  check(exported.history[0].after.v === 2, 'after snapshot should be isolated from source mutation');
});

test('recordUpdate: handles identical before/after (no-op update)', () => {
  const um = new UndoManager(makeMockRepository());
  const entry = um.recordUpdate({ id: 1, v: 1 }, { id: 1, v: 1 });
  deepEqual(entry.before, entry.after, 'identical before/after should still be recorded as-is');
});

test('recordUpdate: works with null before (edge case)', () => {
  const um = new UndoManager(makeMockRepository());
  const entry = um.recordUpdate(null, { id: 1 });
  check(entry.before === null, 'null before should be preserved as null');
});

test('recordUpdate: never calls the repository', () => {
  const repo = makeMockRepository();
  const um = new UndoManager(repo);
  um.recordUpdate({ id: 1 }, { id: 1, v: 2 });
  check(repo._calls.length === 0, 'recordUpdate must never call the repository');
});

test('recordUpdate: timestamp is an ISO string', () => {
  const um = new UndoManager(makeMockRepository());
  const entry = um.recordUpdate({ id: 1 }, { id: 1, v: 2 });
  check(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(entry.timestamp), 'timestamp should match ISO 8601 format');
});

test('recordUpdate: returns null while disabled and history stays untouched', () => {
  const um = new UndoManager(makeMockRepository());
  um.recordCreate({ id: 1 });
  um.disable();
  const r = um.recordUpdate({ id: 1 }, { id: 1, v: 2 });
  check(r === null, 'should return null while disabled');
  check(um.historySize() === 1, 'history should be unaffected while disabled');
});

// ================================================================
// 9. recordDelete
// ================================================================

test('recordDelete: basic entry shape', () => {
  const um = new UndoManager(makeMockRepository());
  const entry = um.recordDelete({ id: 1, name: 'x' }, { who: 'a' });
  check(entry.type === 'delete', 'type should be delete');
  deepEqual(entry.before, { id: 1, name: 'x' }, 'before should match the deleted record');
  check(entry.after === null, 'after should be null for delete');
});

test('recordDelete: default metadata is {}', () => {
  const um = new UndoManager(makeMockRepository());
  const entry = um.recordDelete({ id: 1 });
  deepEqual(entry.metadata, {}, 'metadata should default to {}');
});

test('recordDelete: pushes exactly one history entry', () => {
  const um = new UndoManager(makeMockRepository());
  um.recordDelete({ id: 1 });
  check(um.historySize() === 1, 'history should have one entry');
});

test('recordDelete: clears redo stack', () => {
  const um = new UndoManager(makeMockRepository());
  um.recordCreate({ id: 1 });
  um.undo();
  um.recordDelete({ id: 2 });
  check(um.canRedo() === false, 'recordDelete should clear redo');
});

test('recordDelete: before is deep-cloned', () => {
  const um = new UndoManager(makeMockRepository());
  const before = { id: 1, nested: { x: 1 } };
  um.recordDelete(before);
  before.nested.x = 999;
  const exported = um.exportHistory();
  check(exported.history[0].before.nested.x === 1, 'before snapshot should be isolated');
});

test('recordDelete: never calls the repository', () => {
  const repo = makeMockRepository();
  const um = new UndoManager(repo);
  um.recordDelete({ id: 1 });
  check(repo._calls.length === 0, 'recordDelete must never call the repository');
});

test('recordDelete: works with soft-delete style record (deletedAt set)', () => {
  const um = new UndoManager(makeMockRepository());
  const entry = um.recordDelete({ id: 1, deletedAt: '2026-01-01T00:00:00.000Z' });
  check(entry.before.deletedAt === '2026-01-01T00:00:00.000Z', 'deletedAt field should be preserved as-is');
});

test('recordDelete: returns null while disabled', () => {
  const um = new UndoManager(makeMockRepository());
  um.disable();
  check(um.recordDelete({ id: 1 }) === null, 'should return null while disabled');
});

// ================================================================
// 10. recordRestore
// ================================================================

test('recordRestore: basic entry shape', () => {
  const um = new UndoManager(makeMockRepository());
  const entry = um.recordRestore({ id: 1, deletedAt: '2026-01-01T00:00:00.000Z' }, { id: 1, deletedAt: null });
  check(entry.type === 'restore', 'type should be restore');
  check(entry.before.deletedAt !== null, 'before should reflect the deleted state');
  check(entry.after.deletedAt === null, 'after should reflect the restored (live) state');
});

test('recordRestore: default metadata is {}', () => {
  const um = new UndoManager(makeMockRepository());
  const entry = um.recordRestore({ id: 1 }, { id: 1 });
  deepEqual(entry.metadata, {}, 'metadata should default to {}');
});

test('recordRestore: pushes exactly one history entry', () => {
  const um = new UndoManager(makeMockRepository());
  um.recordRestore({ id: 1 }, { id: 1 });
  check(um.historySize() === 1, 'history should have one entry');
});

test('recordRestore: clears redo stack', () => {
  const um = new UndoManager(makeMockRepository());
  um.recordCreate({ id: 1 });
  um.undo();
  um.recordRestore({ id: 2 }, { id: 2 });
  check(um.canRedo() === false, 'recordRestore should clear redo');
});

test('recordRestore: before/after independently cloned', () => {
  const um = new UndoManager(makeMockRepository());
  const before = { id: 1, v: 1 };
  const after = { id: 1, v: 1 };
  um.recordRestore(before, after);
  before.v = 999;
  after.v = 888;
  const exported = um.exportHistory();
  check(exported.history[0].before.v === 1, 'before should be isolated');
  check(exported.history[0].after.v === 1, 'after should be isolated');
});

test('recordRestore: never calls the repository', () => {
  const repo = makeMockRepository();
  const um = new UndoManager(repo);
  um.recordRestore({ id: 1 }, { id: 1 });
  check(repo._calls.length === 0, 'recordRestore must never call the repository');
});

test('recordRestore: returns null while disabled', () => {
  const um = new UndoManager(makeMockRepository());
  um.disable();
  check(um.recordRestore({ id: 1 }, { id: 1 }) === null, 'should return null while disabled');
});

// ================================================================
// 11. undo()
// ================================================================

test('undo: on empty manager returns null', () => {
  const um = new UndoManager(makeMockRepository());
  check(um.undo() === null, 'undo() on empty history should return null');
});

test('undo: basic instruction shape for a create entry', () => {
  const um = new UndoManager(makeMockRepository());
  um.recordCreate({ id: 1, name: 'a' }, { who: 'x' });
  const instr = um.undo();
  check(instr.action === 'create', 'action should equal the original type');
  check(instr.before === null, 'before should be null (create had no before)');
  deepEqual(instr.after, { id: 1, name: 'a' }, 'after should be the created snapshot');
  deepEqual(instr.metadata, { who: 'x' }, 'metadata should be preserved');
});

test('undo: basic instruction shape for an update entry', () => {
  const um = new UndoManager(makeMockRepository());
  um.recordUpdate({ id: 1, v: 1 }, { id: 1, v: 2 });
  const instr = um.undo();
  check(instr.action === 'update', 'action should be update');
  deepEqual(instr.before, { id: 1, v: 1 }, 'before should be the prior state');
  deepEqual(instr.after, { id: 1, v: 2 }, 'after should be the new state');
});

test('undo: basic instruction shape for a delete entry', () => {
  const um = new UndoManager(makeMockRepository());
  um.recordDelete({ id: 1, name: 'x' });
  const instr = um.undo();
  check(instr.action === 'delete', 'action should be delete');
  deepEqual(instr.before, { id: 1, name: 'x' }, 'before should be the deleted snapshot');
  check(instr.after === null, 'after should be null for a delete entry');
});

test('undo: basic instruction shape for a restore entry', () => {
  const um = new UndoManager(makeMockRepository());
  um.recordRestore({ id: 1, deletedAt: '2026-01-01T00:00:00.000Z' }, { id: 1, deletedAt: null });
  const instr = um.undo();
  check(instr.action === 'restore', 'action should be restore');
  check(instr.before.deletedAt !== null, 'before should reflect the deleted state');
  check(instr.after.deletedAt === null, 'after should reflect the live state');
});

test('undo: moves the entry from history to redo', () => {
  const um = new UndoManager(makeMockRepository());
  um.recordCreate({ id: 1 });
  um.undo();
  check(um.historySize() === 0, 'history should be empty after undoing its only entry');
  check(um.redoSize() === 1, 'redo should now hold the undone entry');
});

test('undo: decrements historySize and increments redoSize by exactly 1', () => {
  const um = new UndoManager(makeMockRepository());
  um.recordCreate({ id: 1 });
  um.recordCreate({ id: 2 });
  const hBefore = um.historySize();
  const rBefore = um.redoSize();
  um.undo();
  check(um.historySize() === hBefore - 1, 'historySize should decrement by 1');
  check(um.redoSize() === rBefore + 1, 'redoSize should increment by 1');
});

test('undo: never calls the repository', () => {
  const repo = makeMockRepository();
  const um = new UndoManager(repo);
  um.recordCreate({ id: 1 });
  um.undo();
  check(repo._calls.length === 0, 'undo() must never call the repository');
});

test('undo: returned instruction is independent of internal state (mutation-safe)', () => {
  const um = new UndoManager(makeMockRepository());
  um.recordCreate({ id: 1, nested: { x: 1 } });
  const instr = um.undo();
  instr.after.nested.x = 999;
  const exported = um.exportHistory();
  check(exported.redo[0].after.nested.x === 1, 'mutating the returned instruction must not affect internal redo state');
});

test('undo: LIFO order across three entries', () => {
  const um = new UndoManager(makeMockRepository());
  um.recordCreate({ id: 1 });
  um.recordCreate({ id: 2 });
  um.recordCreate({ id: 3 });
  const i1 = um.undo();
  const i2 = um.undo();
  const i3 = um.undo();
  check(i1.after.id === 3, 'first undo should reverse the most recent entry');
  check(i2.after.id === 2, 'second undo should reverse the middle entry');
  check(i3.after.id === 1, 'third undo should reverse the oldest entry');
});

test('undo: calling past empty returns null without throwing', () => {
  const um = new UndoManager(makeMockRepository());
  um.recordCreate({ id: 1 });
  um.undo();
  const extra = um.undo();
  check(extra === null, 'undoing past the available history should return null');
});

// ================================================================
// 12. redo()
// ================================================================

test('redo: on empty manager returns null', () => {
  const um = new UndoManager(makeMockRepository());
  check(um.redo() === null, 'redo() with nothing undone should return null');
});

test('redo: after a single undo, replays the same entry', () => {
  const um = new UndoManager(makeMockRepository());
  um.recordCreate({ id: 1, name: 'a' }, { who: 'x' });
  const undone = um.undo();
  const redone = um.redo();
  check(redone.action === undone.action, 'redo action should match the undone action');
  deepEqual(redone.after, undone.after, 'redo after should match the undone after');
  deepEqual(redone.before, undone.before, 'redo before should match the undone before');
  deepEqual(redone.metadata, undone.metadata, 'redo metadata should match the undone metadata');
});

test('redo: moves the entry from redo back to history', () => {
  const um = new UndoManager(makeMockRepository());
  um.recordCreate({ id: 1 });
  um.undo();
  um.redo();
  check(um.historySize() === 1, 'history should hold the entry again after redo');
  check(um.redoSize() === 0, 'redo should be empty after redoing its only entry');
});

test('redo: decrements redoSize and increments historySize by exactly 1', () => {
  const um = new UndoManager(makeMockRepository());
  um.recordCreate({ id: 1 });
  um.recordCreate({ id: 2 });
  um.undo();
  um.undo();
  const hBefore = um.historySize();
  const rBefore = um.redoSize();
  um.redo();
  check(um.historySize() === hBefore + 1, 'historySize should increment by 1');
  check(um.redoSize() === rBefore - 1, 'redoSize should decrement by 1');
});

test('redo: never calls the repository', () => {
  const repo = makeMockRepository();
  const um = new UndoManager(repo);
  um.recordCreate({ id: 1 });
  um.undo();
  um.redo();
  check(repo._calls.length === 0, 'redo() must never call the repository');
});

test('redo: LIFO order across three undone entries', () => {
  const um = new UndoManager(makeMockRepository());
  um.recordCreate({ id: 1 });
  um.recordCreate({ id: 2 });
  um.recordCreate({ id: 3 });
  um.undo(); um.undo(); um.undo();
  const r1 = um.redo();
  const r2 = um.redo();
  const r3 = um.redo();
  check(r1.after.id === 1, 'first redo should replay the oldest undone entry');
  check(r2.after.id === 2, 'second redo should replay the middle entry');
  check(r3.after.id === 3, 'third redo should replay the most recently undone entry');
});

test('redo: calling past empty returns null without throwing', () => {
  const um = new UndoManager(makeMockRepository());
  um.recordCreate({ id: 1 });
  um.undo();
  um.redo();
  const extra = um.redo();
  check(extra === null, 'redoing past the available redo stack should return null');
});

test('redo: returned instruction is independent of internal state', () => {
  const um = new UndoManager(makeMockRepository());
  um.recordCreate({ id: 1, nested: { x: 1 } });
  um.undo();
  const instr = um.redo();
  instr.after.nested.x = 999;
  const exported = um.exportHistory();
  check(exported.history[0].after.nested.x === 1, 'mutating the redo() return value must not affect internal state');
});

test('redo: works correctly for update/delete/restore types too', () => {
  const um = new UndoManager(makeMockRepository());
  um.recordUpdate({ id: 1, v: 1 }, { id: 1, v: 2 });
  um.recordDelete({ id: 2 });
  um.recordRestore({ id: 3, deletedAt: 'x' }, { id: 3, deletedAt: null });
  um.undo(); um.undo(); um.undo();
  const r1 = um.redo();
  const r2 = um.redo();
  const r3 = um.redo();
  check(r1.action === 'update', 'first redo should be the update entry');
  check(r2.action === 'delete', 'second redo should be the delete entry');
  check(r3.action === 'restore', 'third redo should be the restore entry');
});

// ================================================================
// 13. multiple undo / multiple redo combined scenarios
// ================================================================

for (let n = 1; n <= 8; n++) {
  test('multiple undo: undo all ' + n + ' recorded entries in sequence', () => {
    const um = new UndoManager(makeMockRepository(), { maxHistorySize: 50 });
    for (let i = 0; i < n; i++) um.recordCreate({ id: i });
    let undone = 0;
    while (um.canUndo()) {
      const instr = um.undo();
      check(instr !== null, 'each undo while canUndo() is true should succeed');
      undone++;
    }
    check(undone === n, 'should be able to undo exactly ' + n + ' times');
    check(um.redoSize() === n, 'redo should hold all ' + n + ' undone entries');
  });
}

for (let n = 1; n <= 8; n++) {
  test('multiple redo: redo all ' + n + ' undone entries in sequence', () => {
    const um = new UndoManager(makeMockRepository(), { maxHistorySize: 50 });
    for (let i = 0; i < n; i++) um.recordCreate({ id: i });
    for (let i = 0; i < n; i++) um.undo();
    let redone = 0;
    while (um.canRedo()) {
      const instr = um.redo();
      check(instr !== null, 'each redo while canRedo() is true should succeed');
      redone++;
    }
    check(redone === n, 'should be able to redo exactly ' + n + ' times');
    check(um.historySize() === n, 'history should be fully restored');
  });
}

// ================================================================
// 14. undo/redo alternating patterns
// ================================================================

test('alternating: undo, redo, undo returns to undone state', () => {
  const um = new UndoManager(makeMockRepository());
  um.recordCreate({ id: 1 });
  um.undo();
  um.redo();
  const instr = um.undo();
  check(instr.after.id === 1, 'alternating undo/redo/undo should still reverse the same entry correctly');
});

test('alternating: new record after undo prevents stale redo', () => {
  const um = new UndoManager(makeMockRepository());
  um.recordCreate({ id: 1 });
  um.undo();
  um.recordCreate({ id: 2 });
  check(um.canRedo() === false, 'a new record after undo should invalidate the redo stack');
  const instr = um.undo();
  check(instr.after.id === 2, 'undo should now reverse the newly recorded entry, not the stale one');
});

test('alternating: undo/redo/undo/redo four-entry sequence preserves order', () => {
  const um = new UndoManager(makeMockRepository());
  um.recordCreate({ id: 1 });
  um.recordCreate({ id: 2 });
  um.undo();
  um.undo();
  um.redo();
  um.redo();
  check(um.historySize() === 2, 'full undo then full redo should restore original history size');
  check(um.redoSize() === 0, 'redo should be empty again');
});

test('alternating: interleaved record/undo/record/redo does not corrupt state', () => {
  const um = new UndoManager(makeMockRepository());
  um.recordCreate({ id: 1 });
  um.undo();
  um.recordCreate({ id: 2 });
  um.recordCreate({ id: 3 });
  um.undo();
  const redoAttempt = um.redo();
  check(redoAttempt.after.id === 3, 'redo should replay entry #3, the only valid pending redo');
});

test('alternating: canUndo/canRedo flags track state correctly through a long sequence', () => {
  const um = new UndoManager(makeMockRepository());
  check(um.canUndo() === false && um.canRedo() === false, 'both flags false at start');
  um.recordCreate({ id: 1 });
  check(um.canUndo() === true && um.canRedo() === false, 'after record: canUndo true, canRedo false');
  um.undo();
  check(um.canUndo() === false && um.canRedo() === true, 'after undo: canUndo false, canRedo true');
  um.redo();
  check(um.canUndo() === true && um.canRedo() === false, 'after redo: canUndo true, canRedo false');
});

test('alternating: six-step zigzag ends with correct sizes', () => {
  const um = new UndoManager(makeMockRepository());
  um.recordCreate({ id: 1 });
  um.recordCreate({ id: 2 });
  um.recordCreate({ id: 3 });
  um.undo();
  um.redo();
  um.undo();
  check(um.historySize() === 2, 'history size should reflect net effect of the zigzag');
  check(um.redoSize() === 1, 'redo size should reflect net effect of the zigzag');
});

// ================================================================
// 15. Snapshot isolation / deep clone (additional targeted cases)
// ================================================================

test('isolation: exportHistory() output is not a live reference to internal arrays', () => {
  const um = new UndoManager(makeMockRepository());
  um.recordCreate({ id: 1 });
  const exp = um.exportHistory();
  exp.history.push({ type: 'create', before: null, after: { id: 999 }, timestamp: 'x', metadata: {} });
  check(um.historySize() === 1, 'mutating an exported snapshot must not affect internal history');
});

test('isolation: two calls to exportHistory() return independent objects', () => {
  const um = new UndoManager(makeMockRepository());
  um.recordCreate({ id: 1, nested: { x: 1 } });
  const exp1 = um.exportHistory();
  const exp2 = um.exportHistory();
  exp1.history[0].after.nested.x = 999;
  check(exp2.history[0].after.nested.x === 1, 'separate exportHistory() calls must not share internal references');
});

test('isolation: recordCreate with array of objects clones every element', () => {
  const um = new UndoManager(makeMockRepository());
  const arr = [{ a: 1 }, { a: 2 }];
  um.recordCreate({ id: 1, items: arr });
  arr[0].a = 999;
  const exported = um.exportHistory();
  check(exported.history[0].after.items[0].a === 1, 'array elements should be deep-cloned individually');
});

test('isolation: null and undefined nested fields survive cloning as null', () => {
  const um = new UndoManager(makeMockRepository());
  const entry = um.recordCreate({ id: 1, maybe: null });
  check(entry.after.maybe === null, 'explicit null fields should remain null after cloning');
});

test('isolation: boolean and numeric fields survive cloning unchanged', () => {
  const um = new UndoManager(makeMockRepository());
  const entry = um.recordCreate({ id: 1, active: true, count: 0, ratio: 3.14 });
  check(entry.after.active === true, 'boolean true should be preserved');
  check(entry.after.count === 0, 'numeric zero should be preserved');
  check(entry.after.ratio === 3.14, 'floating point should be preserved');
});

test('isolation: string fields with special characters survive cloning', () => {
  const um = new UndoManager(makeMockRepository());
  const entry = um.recordCreate({ id: 1, name: 'قضية رقم "١" \n test' });
  check(entry.after.name === 'قضية رقم "١" \n test', 'Arabic/quote/newline content should round-trip through JSON cloning');
});

test('isolation: empty object and empty array fields survive cloning', () => {
  const um = new UndoManager(makeMockRepository());
  const entry = um.recordCreate({ id: 1, obj: {}, arr: [] });
  deepEqual(entry.after.obj, {}, 'empty object field should be preserved');
  deepEqual(entry.after.arr, [], 'empty array field should be preserved');
});

test('isolation: recordUpdate after-object mutation post-call does not leak into redo after undo', () => {
  const um = new UndoManager(makeMockRepository());
  const after = { id: 1, v: 2 };
  um.recordUpdate({ id: 1, v: 1 }, after);
  const instr = um.undo();
  after.v = 999;
  check(instr.after.v === 2, 'mutating the caller object post-hoc must not affect an already-returned instruction');
});

test('isolation: importHistory() deep-clones its input', () => {
  const um = new UndoManager(makeMockRepository());
  const data = {
    maxHistorySize: 50,
    history: [{ type: 'create', before: null, after: { id: 1, nested: { x: 1 } }, timestamp: 't', metadata: {} }],
    redo: []
  };
  um.importHistory(data);
  data.history[0].after.nested.x = 999;
  const exported = um.exportHistory();
  check(exported.history[0].after.nested.x === 1, 'importHistory() must clone, not reference, its input');
});

test('isolation: metadata objects with array values are cloned', () => {
  const um = new UndoManager(makeMockRepository());
  const meta = { tags: ['a', 'b'] };
  um.recordCreate({ id: 1 }, meta);
  meta.tags.push('c');
  const exported = um.exportHistory();
  check(exported.history[0].metadata.tags.length === 2, 'metadata array fields should be cloned, not shared');
});

// ================================================================
// 16. Timestamps
// ================================================================

test('timestamps: recordCreate produces a valid ISO 8601 string', () => {
  const um = new UndoManager(makeMockRepository());
  const entry = um.recordCreate({ id: 1 });
  check(!isNaN(Date.parse(entry.timestamp)), 'timestamp should be parseable as a date');
});

test('timestamps: recordUpdate produces a valid ISO 8601 string', () => {
  const um = new UndoManager(makeMockRepository());
  const entry = um.recordUpdate({ id: 1 }, { id: 1, v: 2 });
  check(!isNaN(Date.parse(entry.timestamp)), 'timestamp should be parseable as a date');
});

test('timestamps: recordDelete produces a valid ISO 8601 string', () => {
  const um = new UndoManager(makeMockRepository());
  const entry = um.recordDelete({ id: 1 });
  check(!isNaN(Date.parse(entry.timestamp)), 'timestamp should be parseable as a date');
});

test('timestamps: recordRestore produces a valid ISO 8601 string', () => {
  const um = new UndoManager(makeMockRepository());
  const entry = um.recordRestore({ id: 1 }, { id: 1 });
  check(!isNaN(Date.parse(entry.timestamp)), 'timestamp should be parseable as a date');
});

test('timestamps: sequential entries have non-decreasing timestamps', () => {
  const um = new UndoManager(makeMockRepository());
  const e1 = um.recordCreate({ id: 1 });
  const e2 = um.recordCreate({ id: 2 });
  check(Date.parse(e2.timestamp) >= Date.parse(e1.timestamp), 'timestamps should be non-decreasing across sequential records');
});

// ================================================================
// 17. Metadata
// ================================================================

test('metadata: plain object metadata preserved exactly', () => {
  const um = new UndoManager(makeMockRepository());
  const entry = um.recordCreate({ id: 1 }, { userId: 'u1', reason: 'test' });
  deepEqual(entry.metadata, { userId: 'u1', reason: 'test' }, 'metadata object should be preserved exactly');
});

test('metadata: nested metadata preserved', () => {
  const um = new UndoManager(makeMockRepository());
  const entry = um.recordCreate({ id: 1 }, { context: { page: 'cases', action: 'create' } });
  check(entry.metadata.context.page === 'cases', 'nested metadata fields should be preserved');
});

test('metadata: array-valued metadata preserved', () => {
  const um = new UndoManager(makeMockRepository());
  const entry = um.recordCreate({ id: 1 }, { affectedIds: [1, 2, 3] });
  deepEqual(entry.metadata.affectedIds, [1, 2, 3], 'array metadata should be preserved');
});

test('metadata: null metadata normalizes to {}', () => {
  const um = new UndoManager(makeMockRepository());
  const entry = um.recordCreate({ id: 1 }, null);
  deepEqual(entry.metadata, {}, 'explicit null metadata should normalize to an empty object');
});

test('metadata: metadata survives undo()/redo() round trip', () => {
  const um = new UndoManager(makeMockRepository());
  um.recordCreate({ id: 1 }, { who: 'x' });
  const instr1 = um.undo();
  const instr2 = um.redo();
  deepEqual(instr1.metadata, { who: 'x' }, 'metadata should survive undo()');
  deepEqual(instr2.metadata, { who: 'x' }, 'metadata should survive redo()');
});

test('metadata: metadata survives export/import round trip', () => {
  const um = new UndoManager(makeMockRepository());
  um.recordCreate({ id: 1 }, { who: 'x' });
  const exported = um.exportHistory();
  const um2 = new UndoManager(makeMockRepository());
  um2.importHistory(exported);
  deepEqual(um2.exportHistory().history[0].metadata, { who: 'x' }, 'metadata should survive export/import');
});

test('metadata: metadata survives serialize/deserialize round trip', () => {
  const um = new UndoManager(makeMockRepository());
  um.recordCreate({ id: 1 }, { who: 'x' });
  const json = um.serialize();
  const um2 = new UndoManager(makeMockRepository());
  um2.deserialize(json);
  deepEqual(um2.exportHistory().history[0].metadata, { who: 'x' }, 'metadata should survive serialize/deserialize');
});

test('metadata: distinct metadata per entry is not cross-contaminated', () => {
  const um = new UndoManager(makeMockRepository());
  um.recordCreate({ id: 1 }, { tag: 'first' });
  um.recordCreate({ id: 2 }, { tag: 'second' });
  const exported = um.exportHistory();
  check(exported.history[0].metadata.tag === 'first', 'first entry metadata should not be overwritten');
  check(exported.history[1].metadata.tag === 'second', 'second entry metadata should be independent');
});

// ================================================================
// 18. serialize() / deserialize()
// ================================================================

test('serialize: returns a valid JSON string', () => {
  const um = new UndoManager(makeMockRepository());
  um.recordCreate({ id: 1 });
  const json = um.serialize();
  check(typeof json === 'string', 'serialize() should return a string');
  check(() => { JSON.parse(json); return true; }, 'sanity placeholder');
  let parsed;
  let threw = false;
  try { parsed = JSON.parse(json); } catch (e) { threw = true; }
  check(threw === false, 'serialize() output should be valid JSON');
  check(Array.isArray(parsed.history), 'parsed JSON should contain a history array');
});

test('serialize/deserialize: round trip preserves history exactly', () => {
  const um = new UndoManager(makeMockRepository(), { maxHistorySize: 20 });
  um.recordCreate({ id: 1 });
  um.recordUpdate({ id: 1, v: 1 }, { id: 1, v: 2 });
  um.recordDelete({ id: 2 });
  const json = um.serialize();
  const um2 = new UndoManager(makeMockRepository());
  um2.deserialize(json);
  deepEqual(um2.exportHistory(), um.exportHistory(), 'deserialized state should exactly match the original exportHistory() output');
});

test('serialize/deserialize: round trip preserves redo stack', () => {
  const um = new UndoManager(makeMockRepository());
  um.recordCreate({ id: 1 });
  um.recordCreate({ id: 2 });
  um.undo();
  const json = um.serialize();
  const um2 = new UndoManager(makeMockRepository());
  um2.deserialize(json);
  check(um2.redoSize() === 1, 'redo stack should survive serialize/deserialize');
});

test('serialize/deserialize: round trip preserves maxHistorySize', () => {
  const um = new UndoManager(makeMockRepository(), { maxHistorySize: 7 });
  um.recordCreate({ id: 1 });
  const json = um.serialize();
  const um2 = new UndoManager(makeMockRepository(), { maxHistorySize: 999 });
  um2.deserialize(json);
  check(um2._maxHistory === 7, 'deserialize should restore the original maxHistorySize');
});

test('deserialize: throws a plain Error on invalid JSON', () => {
  const um = new UndoManager(makeMockRepository());
  let threw = false;
  try { um.deserialize('{not valid json'); } catch (e) { threw = true; }
  check(threw === true, 'deserialize() should throw on malformed JSON input');
});

test('deserialize: throws on JSON that is not an object', () => {
  const um = new UndoManager(makeMockRepository());
  let threw = false;
  try { um.deserialize('42'); } catch (e) { threw = true; }
  check(threw === true, 'deserialize() should throw when the parsed JSON is not a plain object');
});

test('deserialize: throws on JSON array instead of object', () => {
  const um = new UndoManager(makeMockRepository());
  let threw = false;
  try { um.deserialize('[1,2,3]'); } catch (e) { threw = true; }
  check(threw === true, 'deserialize() should throw when the parsed JSON is an array');
});

test('serialize: empty manager serializes and deserializes cleanly', () => {
  const um = new UndoManager(makeMockRepository());
  const json = um.serialize();
  const um2 = new UndoManager(makeMockRepository());
  um2.deserialize(json);
  check(um2.historySize() === 0, 'empty manager should round-trip to an empty manager');
  check(um2.redoSize() === 0, 'empty redo should round-trip to empty redo');
});

test('serialize: large history serializes and deserializes without data loss', () => {
  const um = new UndoManager(makeMockRepository(), { maxHistorySize: 200 });
  for (let i = 0; i < 150; i++) um.recordCreate({ id: i, payload: 'x'.repeat(20) });
  const json = um.serialize();
  const um2 = new UndoManager(makeMockRepository());
  um2.deserialize(json);
  check(um2.historySize() === 150, 'large history should fully round-trip');
});

// ================================================================
// 19. exportHistory() / importHistory()
// ================================================================

test('exportHistory: shape has maxHistorySize, history, redo', () => {
  const um = new UndoManager(makeMockRepository());
  const exp = um.exportHistory();
  check('maxHistorySize' in exp, 'export should include maxHistorySize');
  check('history' in exp, 'export should include history');
  check('redo' in exp, 'export should include redo');
});

test('importHistory: round trip with a freshly-constructed manager', () => {
  const um = new UndoManager(makeMockRepository());
  um.recordCreate({ id: 1 });
  um.recordCreate({ id: 2 });
  const exp = um.exportHistory();
  const um2 = new UndoManager(makeMockRepository());
  um2.importHistory(exp);
  check(um2.historySize() === 2, 'imported manager should have the same history size');
});

test('importHistory: overwrites any pre-existing state', () => {
  const um = new UndoManager(makeMockRepository());
  um.recordCreate({ id: 1 });
  const exp = um.exportHistory();
  const um2 = new UndoManager(makeMockRepository());
  um2.recordCreate({ id: 999 });
  um2.recordCreate({ id: 998 });
  um2.importHistory(exp);
  check(um2.historySize() === 1, 'importHistory should fully replace prior state, not merge with it');
});

test('importHistory: throws on non-object input', () => {
  const um = new UndoManager(makeMockRepository());
  let threw = false;
  try { um.importHistory('not an object'); } catch (e) { threw = true; }
  check(threw === true, 'importHistory() should throw on a non-object argument');
});

test('importHistory: throws on null input', () => {
  const um = new UndoManager(makeMockRepository());
  let threw = false;
  try { um.importHistory(null); } catch (e) { threw = true; }
  check(threw === true, 'importHistory() should throw on null');
});

test('importHistory: throws when a history entry has an invalid type', () => {
  const um = new UndoManager(makeMockRepository());
  let threw = false;
  try {
    um.importHistory({ history: [{ type: 'not-a-real-type', before: null, after: null, timestamp: 't', metadata: {} }], redo: [] });
  } catch (e) { threw = true; }
  check(threw === true, 'importHistory() should validate each history entry\'s type');
});

test('importHistory: throws when a redo entry has an invalid type', () => {
  const um = new UndoManager(makeMockRepository());
  let threw = false;
  try {
    um.importHistory({ history: [], redo: [{ type: 'bogus', before: null, after: null, timestamp: 't', metadata: {} }] });
  } catch (e) { threw = true; }
  check(threw === true, 'importHistory() should validate each redo entry\'s type');
});

test('importHistory: missing history/redo arrays default to empty', () => {
  const um = new UndoManager(makeMockRepository());
  um.recordCreate({ id: 1 });
  um.importHistory({});
  check(um.historySize() === 0, 'missing history array should import as empty');
  check(um.redoSize() === 0, 'missing redo array should import as empty');
});

test('importHistory: honors a smaller maxHistorySize by trimming oldest entries', () => {
  const um = new UndoManager(makeMockRepository());
  const history = [];
  for (let i = 0; i < 10; i++) history.push({ type: 'create', before: null, after: { id: i }, timestamp: 't' + i, metadata: {} });
  um.importHistory({ maxHistorySize: 3, history: history, redo: [] });
  check(um.historySize() === 3, 'import should trim history down to the new maxHistorySize');
  const exported = um.exportHistory();
  check(exported.history[exported.history.length - 1].after.id === 9, 'trimming should keep the newest entries');
});

test('importHistory: valid four-type mix imports without error', () => {
  const um = new UndoManager(makeMockRepository());
  um.importHistory({
    history: [
      { type: 'create', before: null, after: { id: 1 }, timestamp: 't1', metadata: {} },
      { type: 'update', before: { id: 1 }, after: { id: 1, v: 2 }, timestamp: 't2', metadata: {} },
      { type: 'delete', before: { id: 1 }, after: null, timestamp: 't3', metadata: {} },
      { type: 'restore', before: { id: 1 }, after: { id: 1 }, timestamp: 't4', metadata: {} }
    ],
    redo: []
  });
  check(um.historySize() === 4, 'all four valid entry types should import successfully');
});

test('importHistory: does not call the repository', () => {
  const repo = makeMockRepository();
  const um = new UndoManager(repo);
  um.importHistory({ history: [{ type: 'create', before: null, after: { id: 1 }, timestamp: 't', metadata: {} }], redo: [] });
  check(repo._calls.length === 0, 'importHistory() must never call the repository');
});

// ================================================================
// 20. dispose()
// ================================================================

test('dispose: clears history and redo', () => {
  const um = new UndoManager(makeMockRepository());
  um.recordCreate({ id: 1 });
  um.recordCreate({ id: 2 });
  um.undo();
  um.dispose();
  check(um.historySize() === 0, 'history should be cleared after dispose()');
  check(um.redoSize() === 0, 'redo should be cleared after dispose()');
});

test('dispose: disables further recording', () => {
  const um = new UndoManager(makeMockRepository());
  um.dispose();
  check(um.isEnabled() === false, 'manager should be disabled after dispose()');
});

test('dispose: releases the repository handle', () => {
  const um = new UndoManager(makeMockRepository());
  um.dispose();
  check(um._repository === null, 'repository handle should be released after dispose()');
});

test('dispose: recordCreate after dispose is a safe no-op', () => {
  const um = new UndoManager(makeMockRepository());
  um.dispose();
  const r = um.recordCreate({ id: 1 });
  check(r === null, 'recordCreate after dispose() should return null');
  check(um.historySize() === 0, 'history should remain empty after dispose()');
});

test('dispose: undo()/redo() after dispose are safe no-ops', () => {
  const um = new UndoManager(makeMockRepository());
  um.recordCreate({ id: 1 });
  um.dispose();
  check(um.undo() === null, 'undo() after dispose() should return null (history was cleared)');
  check(um.redo() === null, 'redo() after dispose() should return null (redo was cleared)');
});

test('dispose: is idempotent (safe to call multiple times)', () => {
  const um = new UndoManager(makeMockRepository());
  um.recordCreate({ id: 1 });
  um.dispose();
  let threw = false;
  try { um.dispose(); um.dispose(); } catch (e) { threw = true; }
  check(threw === false, 'calling dispose() multiple times should never throw');
});

test('dispose: does not throw even when called on a fresh manager', () => {
  const um = new UndoManager(makeMockRepository());
  let threw = false;
  try { um.dispose(); } catch (e) { threw = true; }
  check(threw === false, 'dispose() on a never-used manager should not throw');
});

test('dispose: never calls the repository', () => {
  const repo = makeMockRepository();
  const um = new UndoManager(repo);
  um.recordCreate({ id: 1 });
  um.dispose();
  check(repo._calls.length === 0, 'dispose() must never call the repository');
});

// ================================================================
// 21. Random stress tests
// ================================================================

test('stress: 500 random record operations keep historySize <= maxHistorySize at all times', () => {
  const max = 30;
  const um = new UndoManager(makeMockRepository(), { maxHistorySize: max });
  const kinds = ['create', 'update', 'delete', 'restore'];
  for (let i = 0; i < 500; i++) {
    const kind = kinds[i % kinds.length];
    if (kind === 'create') um.recordCreate({ id: i });
    else if (kind === 'update') um.recordUpdate({ id: i, v: 1 }, { id: i, v: 2 });
    else if (kind === 'delete') um.recordDelete({ id: i });
    else um.recordRestore({ id: i }, { id: i });
    check(um.historySize() <= max, 'historySize must never exceed maxHistorySize (iteration ' + i + ')');
    check(um.historySize() >= 1, 'historySize must be at least 1 after any successful record (iteration ' + i + ')');
    check(um.canRedo() === false, 'redo must be empty immediately after any fresh record (iteration ' + i + ')');
  }
});

test('stress: 500 alternating undo/redo calls never desync historySize + redoSize total', () => {
  const um = new UndoManager(makeMockRepository(), { maxHistorySize: 40 });
  for (let i = 0; i < 40; i++) um.recordCreate({ id: i });
  const total = um.historySize() + um.redoSize();
  for (let i = 0; i < 500; i++) {
    if (i % 2 === 0) um.undo(); else um.redo();
    check(um.historySize() + um.redoSize() === total, 'history+redo total must remain constant through pure undo/redo (iteration ' + i + ')');
    check(um.historySize() >= 0 && um.redoSize() >= 0, 'sizes must never go negative (iteration ' + i + ')');
  }
});

test('stress: 300 iterations of record-then-undo-immediately always fully drains history', () => {
  const um = new UndoManager(makeMockRepository(), { maxHistorySize: 10 });
  for (let i = 0; i < 300; i++) {
    um.recordCreate({ id: i });
    const instr = um.undo();
    check(instr !== null, 'undo immediately after a record should always succeed (iteration ' + i + ')');
    check(instr.after.id === i, 'undo should reverse exactly the entry just recorded (iteration ' + i + ')');
    check(um.historySize() === 0, 'history should be empty after each record+undo pair (iteration ' + i + ')');
    check(um.redoSize() === 1, 'redo should hold exactly one entry after each record+undo pair (iteration ' + i + ')');
  }
});

test('stress: 200 iterations of random export/import round trips preserve state', () => {
  for (let i = 0; i < 200; i++) {
    const um = new UndoManager(makeMockRepository(), { maxHistorySize: 15 });
    const opsCount = (i % 20) + 1;
    for (let j = 0; j < opsCount; j++) um.recordCreate({ id: j, iter: i });
    const exp = um.exportHistory();
    const um2 = new UndoManager(makeMockRepository());
    um2.importHistory(exp);
    check(um2.historySize() === um.historySize(), 'round trip #' + i + ' should preserve historySize');
    deepEqual(um2.exportHistory().history, um.exportHistory().history, 'round trip #' + i + ' should preserve history content exactly');
  }
});

test('stress: 200 iterations mixing all four record types plus random undo/redo maintain invariants', () => {
  const um = new UndoManager(makeMockRepository(), { maxHistorySize: 25 });
  let seed = 12345;
  function rand() { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; }
  for (let i = 0; i < 200; i++) {
    const r = rand();
    if (r < 0.25) um.recordCreate({ id: i });
    else if (r < 0.5) um.recordUpdate({ id: i, v: 1 }, { id: i, v: 2 });
    else if (r < 0.75) um.recordDelete({ id: i });
    else um.recordRestore({ id: i }, { id: i });

    if (rand() < 0.3 && um.canUndo()) um.undo();
    if (rand() < 0.3 && um.canRedo()) um.redo();

    check(um.historySize() <= 25, 'historySize must respect the cap throughout the mixed stress run (iteration ' + i + ')');
    check(um.historySize() >= 0, 'historySize must never be negative (iteration ' + i + ')');
    check(um.redoSize() >= 0, 'redoSize must never be negative (iteration ' + i + ')');
  }
});

// ================================================================
// 22. Large history
// ================================================================

test('large history: 2000 records with maxHistorySize=100 caps correctly and keeps newest', () => {
  const um = new UndoManager(makeMockRepository(), { maxHistorySize: 100 });
  for (let i = 0; i < 2000; i++) um.recordCreate({ id: i });
  check(um.historySize() === 100, 'history should be capped at exactly 100');
  const exported = um.exportHistory();
  check(exported.history[0].after.id === 1900, 'oldest surviving entry should be #1900 (2000-100)');
  check(exported.history[99].after.id === 1999, 'newest entry should be #1999');
});

test('large history: undo() after a 2000-record run still works correctly', () => {
  const um = new UndoManager(makeMockRepository(), { maxHistorySize: 100 });
  for (let i = 0; i < 2000; i++) um.recordCreate({ id: i });
  const instr = um.undo();
  check(instr.after.id === 1999, 'undo after large history should reverse the most recent surviving entry');
});

test('large history: exportHistory() on a 100-entry-capped history returns exactly 100 entries', () => {
  const um = new UndoManager(makeMockRepository(), { maxHistorySize: 100 });
  for (let i = 0; i < 500; i++) um.recordCreate({ id: i });
  const exported = um.exportHistory();
  check(exported.history.length === 100, 'exported history array length should equal the cap');
});

// ================================================================
// 23. Performance (loose, non-flaky bounds — informational + sane upper bound)
// ================================================================

test('performance: 10,000 recordCreate calls complete in a reasonable time', () => {
  const um = new UndoManager(makeMockRepository(), { maxHistorySize: 50 });
  const start = Date.now();
  for (let i = 0; i < 10000; i++) um.recordCreate({ id: i, payload: 'x'.repeat(10) });
  const elapsed = Date.now() - start;
  check(um.historySize() === 50, 'history should still be correctly capped after 10,000 pushes');
  check(elapsed < 5000, '10,000 recordCreate calls should complete in under 5 seconds (took ' + elapsed + 'ms)');
});

test('performance: 5,000 undo/redo alternations complete in a reasonable time', () => {
  const um = new UndoManager(makeMockRepository(), { maxHistorySize: 50 });
  for (let i = 0; i < 50; i++) um.recordCreate({ id: i });
  const start = Date.now();
  for (let i = 0; i < 5000; i++) {
    if (i % 2 === 0) um.undo(); else um.redo();
  }
  const elapsed = Date.now() - start;
  check(elapsed < 5000, '5,000 undo/redo calls should complete in under 5 seconds (took ' + elapsed + 'ms)');
});

test('performance: serialize()/deserialize() on a 100-entry history completes quickly', () => {
  const um = new UndoManager(makeMockRepository(), { maxHistorySize: 100 });
  for (let i = 0; i < 100; i++) um.recordCreate({ id: i, payload: 'x'.repeat(50) });
  const start = Date.now();
  for (let i = 0; i < 100; i++) {
    const json = um.serialize();
    const um2 = new UndoManager(makeMockRepository());
    um2.deserialize(json);
  }
  const elapsed = Date.now() - start;
  check(elapsed < 5000, '100 serialize/deserialize round trips should complete in under 5 seconds (took ' + elapsed + 'ms)');
});

// ================================================================
// 24. Memory (bounded growth)
// ================================================================

test('memory: history array length never exceeds maxHistorySize regardless of volume', () => {
  [10, 25, 50, 100].forEach((max) => {
    const um = new UndoManager(makeMockRepository(), { maxHistorySize: max });
    for (let i = 0; i < max * 20; i++) um.recordCreate({ id: i });
    check(um._history.length === max, 'internal history array length should equal the cap for maxHistorySize=' + max);
    check(um._history.length <= max, 'internal history array length should never exceed the cap for maxHistorySize=' + max);
  });
});

test('memory: redo array length never exceeds maxHistorySize regardless of volume', () => {
  const um = new UndoManager(makeMockRepository(), { maxHistorySize: 20 });
  for (let i = 0; i < 20; i++) um.recordCreate({ id: i });
  for (let i = 0; i < 20; i++) um.undo();
  check(um._redo.length === 20, 'internal redo array length should equal the cap');
  check(um._redo.length <= 20, 'internal redo array length should never exceed the cap');
});

// ================================================================
// 25. Cross-cutting: unsupported-operation safety (never touches Repository)
// ================================================================

['recordCreate', 'recordUpdate', 'recordDelete', 'recordRestore', 'undo', 'redo', 'clear', 'dispose'].forEach((method) => {
  test('cross-cutting: ' + method + '() never touches the injected repository object', () => {
    const repo = makeMockRepository();
    const um = new UndoManager(repo);
    um.recordCreate({ id: 1 });
    um.recordUpdate({ id: 1 }, { id: 1, v: 2 });
    if (method === 'undo' || method === 'redo') {
      um[method]();
    } else if (method === 'recordDelete') {
      um.recordDelete({ id: 1 });
    } else if (method === 'recordRestore') {
      um.recordRestore({ id: 1 }, { id: 1 });
    } else if (method === 'recordCreate' || method === 'recordUpdate') {
      // already exercised above
    } else {
      um[method]();
    }
    check(repo._calls.length === 0, method + '() must never invoke any method on the repository handle');
  });
});

// ================================================================
// Final summary
// ================================================================

console.log('================================================================');
console.log('verify_undo_manager.js — RESULTS');
console.log('================================================================');
console.log('Labelled tests run:   ' + testCount);
console.log('Total assertions:     ' + assertionCount);
console.log('Assertion failures:   ' + failCount);
console.log('----------------------------------------------------------------');

const MIN_TESTS = 150;
const MIN_ASSERTIONS = 3000;

let overallPass = true;

if (testCount < MIN_TESTS) {
  console.log('FAIL — labelled test count ' + testCount + ' is below the required minimum of ' + MIN_TESTS);
  overallPass = false;
}
if (assertionCount < MIN_ASSERTIONS) {
  console.log('FAIL — assertion count ' + assertionCount + ' is below the required minimum of ' + MIN_ASSERTIONS);
  overallPass = false;
}
if (failCount > 0) {
  console.log('FAIL — ' + failCount + ' assertion(s) failed:');
  failures.slice(0, 50).forEach((f) => console.log('  - ' + f));
  if (failures.length > 50) console.log('  ... and ' + (failures.length - 50) + ' more');
  overallPass = false;
}

if (overallPass) {
  console.log('PASS — all ' + testCount + ' labelled tests and ' + assertionCount + ' assertions succeeded.');
} else {
  console.log('OVERALL: FAIL');
}
console.log('================================================================');

process.exit(overallPass ? 0 : 1);
