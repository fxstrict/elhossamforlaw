/**
 * verify_global_search_history.js
 * PHASE 02 — GLOBAL SEARCH / SEARCH WORKSPACE — STEP 4 TEST
 * (Recent Searches / SearchHistoryStore, js/modules/global-search.js).
 * Run: node verify_global_search_history.js
 * No browser required — a plain in-memory object stands in for
 * localStorage (same fake-storage-double pattern as
 * js/tests/verify_localstorage_adapter.js).
 */

const assert = require('assert');
const path = require('path');

const { SearchHistoryStore } = require(path.join(__dirname, '..', 'modules', 'global-search.js'));

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

/** Minimal Storage-shaped in-memory fake (getItem/setItem only — all this needs). */
function makeFakeLocalStorage() {
  const data = Object.create(null);
  return {
    getItem(key) { return Object.prototype.hasOwnProperty.call(data, key) ? data[key] : null; },
    setItem(key, value) { data[key] = String(value); },
    removeItem(key) { delete data[key]; }
  };
}

function main() {

  check('MAX_RECENT_SEARCHES is a fixed, named config value (not scattered magic numbers)', () => {
    assert.strictEqual(SearchHistoryStore.MAX_RECENT_SEARCHES, 10);
  });

  check('a fresh store has an empty list', () => {
    const store = new SearchHistoryStore(makeFakeLocalStorage());
    assert.deepStrictEqual(store.getAll(), []);
  });

  check('add() places the newest term first', () => {
    const store = new SearchHistoryStore(makeFakeLocalStorage());
    store.add('قضية أحمد');
    store.add('محمد');
    assert.deepStrictEqual(store.getAll(), ['محمد', 'قضية أحمد']);
  });

  check('add() trims whitespace and ignores a blank term', () => {
    const store = new SearchHistoryStore(makeFakeLocalStorage());
    store.add('  محمد  ');
    store.add('   ');
    store.add('');
    assert.deepStrictEqual(store.getAll(), ['محمد']);
  });

  check('duplicate (including non-consecutive) search terms do not create two entries', () => {
    const store = new SearchHistoryStore(makeFakeLocalStorage());
    store.add('محمد');
    store.add('سارة');
    store.add('محمد'); // repeat, not consecutive (سارة was in between)
    assert.deepStrictEqual(store.getAll(), ['محمد', 'سارة']);
  });

  check('re-adding an existing term (case-insensitive) moves it to the top instead of duplicating', () => {
    const store = new SearchHistoryStore(makeFakeLocalStorage());
    store.add('Ahmed');
    store.add('سارة');
    store.add('AHMED');
    assert.deepStrictEqual(store.getAll(), ['AHMED', 'سارة']);
  });

  check('list never exceeds MAX_RECENT_SEARCHES (10) — oldest entries drop off', () => {
    const store = new SearchHistoryStore(makeFakeLocalStorage());
    for (let i = 1; i <= 12; i++) store.add('term' + i);
    const all = store.getAll();
    assert.strictEqual(all.length, 10);
    assert.strictEqual(all[0], 'term12');
    assert.ok(!all.includes('term1'));
    assert.ok(!all.includes('term2'));
  });

  check('remove() deletes exactly one entry, leaving the rest untouched and in order', () => {
    const store = new SearchHistoryStore(makeFakeLocalStorage());
    store.add('a');
    store.add('b');
    store.add('c');
    store.remove('b');
    assert.deepStrictEqual(store.getAll(), ['c', 'a']);
  });

  check('clear() empties the list entirely', () => {
    const store = new SearchHistoryStore(makeFakeLocalStorage());
    store.add('a');
    store.add('b');
    store.clear();
    assert.deepStrictEqual(store.getAll(), []);
  });

  check('data persists across separate SearchHistoryStore instances sharing the same storage', () => {
    const fakeLs = makeFakeLocalStorage();
    const store1 = new SearchHistoryStore(fakeLs);
    store1.add('محمد');
    const store2 = new SearchHistoryStore(fakeLs);
    assert.deepStrictEqual(store2.getAll(), ['محمد']);
  });

  check('a corrupt/unparseable stored value is treated as an empty list, never throws', () => {
    const fakeLs = makeFakeLocalStorage();
    fakeLs.setItem(SearchHistoryStore.STORAGE_KEY, 'not valid json {{{');
    const store = new SearchHistoryStore(fakeLs);
    assert.deepStrictEqual(store.getAll(), []);
  });

  check('when no storage is available at all, getAll()/add()/clear() degrade to no-ops, never throw', () => {
    const store = new SearchHistoryStore({
      getItem() { throw new Error('storage unavailable'); },
      setItem() { throw new Error('storage unavailable'); }
    });
    assert.deepStrictEqual(store.getAll(), []);
    assert.doesNotThrow(() => store.add('x'));
    assert.doesNotThrow(() => store.clear());
  });

  // ---- Summary ----
  console.log(log.join('\n'));
  console.log('\n' + passed + '/' + (passed + failed) + ' checks passed.');
  if (failed > 0) {
    console.error('\n' + failed + ' CHECK(S) FAILED.');
    process.exit(1);
  }
}

main();
