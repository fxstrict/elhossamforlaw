/**
 * verify_auth_core.js
 * ================================================================
 * PHASE 32 — Login Screen, Session Activation & Users Admin Panel
 * ================================================================
 * Covers the two pure, non-DOM modules this phase adds:
 * PasswordHasher.js (PBKDF2-SHA256 hashing/verification) and
 * LoginAttempts.js (failed-attempt counting + lockout). The UI modules
 * (LoginScreen.js, UsersAdminPanel.js) build DOM at runtime and are not
 * exercised here — see docs/phase32 report, "Testing Notes", for why
 * and what manual QA is still required before relying on them.
 * ================================================================
 */

'use strict';

const assert = require('assert');
const path = require('path');

const AUTH_DIR = path.join(__dirname, '..', 'auth');
const PasswordHasherNS = require(path.join(AUTH_DIR, 'PasswordHasher.js'));
const LoginAttemptsNS = require(path.join(AUTH_DIR, 'LoginAttempts.js'));

let passed = 0;
let failed = 0;
const failures = [];

async function check(label, fn) {
  try {
    await fn();
    passed++;
    console.log('  \u2713 ' + label);
  } catch (err) {
    failed++;
    failures.push({ label, error: err });
    console.log('  \u2717 ' + label + ' -> ' + (err && err.stack ? err.stack : err));
  }
}

async function main() {
  console.log('\n=== PasswordHasher.js ===');

  await check('hashPassword() produces the self-describing pbkdf2$... format', async () => {
    const hash = await PasswordHasherNS.hashPassword('Test@1234');
    const parts = hash.split('$');
    assert.strictEqual(parts.length, 4);
    assert.strictEqual(parts[0], 'pbkdf2');
    assert.strictEqual(Number(parts[1]), PasswordHasherNS.ITERATIONS);
  });

  await check('two hashes of the SAME password are different (random salt)', async () => {
    const h1 = await PasswordHasherNS.hashPassword('Test@1234');
    const h2 = await PasswordHasherNS.hashPassword('Test@1234');
    assert.notStrictEqual(h1, h2);
  });

  await check('verifyPassword() true for the correct password', async () => {
    const hash = await PasswordHasherNS.hashPassword('Correct-Horse-1');
    assert.strictEqual(await PasswordHasherNS.verifyPassword('Correct-Horse-1', hash), true);
  });

  await check('verifyPassword() false for a wrong password', async () => {
    const hash = await PasswordHasherNS.hashPassword('Correct-Horse-1');
    assert.strictEqual(await PasswordHasherNS.verifyPassword('wrong-guess', hash), false);
  });

  await check('verifyPassword() false (not throw) for a malformed stored hash', async () => {
    assert.strictEqual(await PasswordHasherNS.verifyPassword('anything', 'not-a-real-hash'), false);
    assert.strictEqual(await PasswordHasherNS.verifyPassword('anything', ''), false);
    assert.strictEqual(await PasswordHasherNS.verifyPassword('anything', null), false);
    assert.strictEqual(await PasswordHasherNS.verifyPassword('anything', 'bcrypt$10$salt$hash'), false);
  });

  await check('verifyPassword() false for an empty candidate password', async () => {
    const hash = await PasswordHasherNS.hashPassword('SomeRealPassword1');
    assert.strictEqual(await PasswordHasherNS.verifyPassword('', hash), false);
  });

  await check('hashPassword() rejects an empty password rather than hashing it', async () => {
    let threw = null;
    try { await PasswordHasherNS.hashPassword(''); } catch (e) { threw = e; }
    assert.ok(threw, 'hashPassword("") must throw, not silently succeed');
  });

  console.log('\n=== LoginAttempts.js ===');

  check('isLocked() false for a fresh user with no lockout fields', () => {
    assert.strictEqual(LoginAttemptsNS.isLocked({}), false);
  });

  check('recordFailure() increments محاولات_فاشلة below the threshold', () => {
    const patch = LoginAttemptsNS.recordFailure({ محاولات_فاشلة: 2 }, new Date());
    assert.strictEqual(patch.محاولات_فاشلة, 3);
    assert.strictEqual(patch.مقفل_حتى, undefined);
  });

  check('recordFailure() locks the account on the 5th attempt (برief: بعد 5 محاولات)', () => {
    const now = new Date(2026, 0, 1, 12, 0, 0);
    const patch = LoginAttemptsNS.recordFailure({ محاولات_فاشلة: 4 }, now);
    assert.strictEqual(patch.محاولات_فاشلة, 0, 'counter resets once the lock itself is the deterrent');
    assert.ok(patch.مقفل_حتى, 'must set a lock expiry');
    const lockedFor = (new Date(patch.مقفل_حتى).getTime() - now.getTime()) / 60000;
    assert.strictEqual(lockedFor, LoginAttemptsNS.LOCK_MINUTES, 'برief: يقفل 30 دقيقة');
  });

  check('isLocked() true while inside the lock window, false once it has elapsed', () => {
    const now = new Date(2026, 0, 1, 12, 0, 0);
    const patch = LoginAttemptsNS.recordFailure({ محاولات_فاشلة: 4 }, now);
    const user = Object.assign({}, patch);
    assert.strictEqual(LoginAttemptsNS.isLocked(user, new Date(now.getTime() + 10 * 60000)), true);
    assert.strictEqual(LoginAttemptsNS.isLocked(user, new Date(now.getTime() + 31 * 60000)), false);
  });

  check('recordSuccess() clears both lockout fields', () => {
    const patch = LoginAttemptsNS.recordSuccess();
    assert.strictEqual(patch.محاولات_فاشلة, 0);
    assert.strictEqual(patch.مقفل_حتى, null);
  });

  check('lockedUntil() returns null when not locked, a Date when locked', () => {
    assert.strictEqual(LoginAttemptsNS.lockedUntil({}), null);
    const d = LoginAttemptsNS.lockedUntil({ مقفل_حتى: '2026-01-01T00:00:00.000Z' });
    assert.ok(d instanceof Date);
  });

  console.log('\n================================================================');
  console.log('TOTAL: ' + passed + ' passed, ' + failed + ' failed (' + (passed + failed) + ' checks)');
  console.log('================================================================\n');
  if (failed > 0) {
    failures.forEach(f => console.log('FAILED: ' + f.label));
    process.exitCode = 1;
  }
}

main().catch(err => {
  console.error('HARNESS CRASHED:', err);
  process.exitCode = 1;
});
