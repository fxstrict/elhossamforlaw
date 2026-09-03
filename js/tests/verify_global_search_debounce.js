/**
 * verify_global_search_debounce.js
 * PHASE 02 — GLOBAL SEARCH / SEARCH WORKSPACE — STEP 5 TEST
 * (debounce() + createRequestSequencer(), js/modules/global-search.js).
 * Run: node verify_global_search_debounce.js
 * Uses real (short) timers rather than a fake-timer library — no such
 * library is a project dependency, and the waits below are short enough
 * (<=120ms total) to keep the harness fast.
 */

const assert = require('assert');
const path = require('path');

const { debounce, createRequestSequencer, DEFAULT_DEBOUNCE_MS } =
  require(path.join(__dirname, '..', 'modules', 'global-search.js'));

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

function wait(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

async function main() {

  check('DEFAULT_DEBOUNCE_MS matches the PHASE 02 §26 initial value (250ms)', () => {
    assert.strictEqual(DEFAULT_DEBOUNCE_MS, 250);
  });

  await (async () => {
    let callCount = 0;
    let lastArg = null;
    const debounced = debounce((v) => { callCount++; lastArg = v; }, 30);

    // Simulate "م" -> "مح" -> "محم" -> "محمد" typed quickly (PHASE 02
    // §27's literal example): each call must reset the pending timer.
    debounced('م');
    debounced('مح');
    debounced('محم');
    debounced('محمد');

    await wait(15); // still inside the 30ms window — must not have fired yet
    const firedTooEarly = callCount;

    await wait(30); // now past the 30ms window since the LAST call

    check('a burst of rapid calls results in exactly ONE underlying call', () => {
      assert.strictEqual(callCount, 1, 'callCount was ' + callCount);
    });
    check('the single call received the LAST argument, not an earlier one', () => {
      assert.strictEqual(lastArg, 'محمد');
    });
    check('no call had fired yet before the debounce window elapsed', () => {
      assert.strictEqual(firedTooEarly, 0);
    });
  })();

  await (async () => {
    let callCount = 0;
    const debounced = debounce(() => { callCount++; }, 20);
    debounced();
    await wait(35);
    debounced();
    await wait(35);
    check('calls spaced further apart than the wait each fire independently', () => {
      assert.strictEqual(callCount, 2);
    });
  })();

  await (async () => {
    let callCount = 0;
    const debounced = debounce(() => { callCount++; }, 20);
    debounced();
    debounced.cancel();
    await wait(35);
    check('cancel() prevents a pending debounced call from firing at all', () => {
      assert.strictEqual(callCount, 0);
    });
  })();

  // ---- Stale-result / request sequence protection ----

  check('createRequestSequencer(): a token is only current until a newer one is issued', () => {
    const seq = createRequestSequencer();
    const t1 = seq.issue();
    assert.ok(seq.isCurrent(t1));
    const t2 = seq.issue();
    assert.ok(!seq.isCurrent(t1), 'old token must no longer be current');
    assert.ok(seq.isCurrent(t2));
  });

  check('createRequestSequencer(): simulates an out-of-order async resolution being ignored', () => {
    // Scenario §28 describes: two searches in flight, older one resolves
    // last — its result must be recognized as stale and discarded.
    const seq = createRequestSequencer();
    const older = seq.issue(); // "قض" search starts
    const newer = seq.issue(); // "قضية" search starts before "قض" resolves
    const appliedResults = [];
    function onResolve(token, label) {
      if (seq.isCurrent(token)) appliedResults.push(label);
    }
    onResolve(newer, 'نتائج قضية'); // resolves first
    onResolve(older, 'نتائج قض');   // resolves second (out of order) — must be ignored
    assert.deepStrictEqual(appliedResults, ['نتائج قضية']);
  });

  console.log(log.join('\n'));
  console.log('\n' + passed + '/' + (passed + failed) + ' checks passed.');
  if (failed > 0) {
    console.error('\n' + failed + ' CHECK(S) FAILED.');
    process.exit(1);
  }
}

main().catch(err => {
  console.error('HARNESS CRASHED:', err);
  process.exit(1);
});
