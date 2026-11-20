import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { generateOtp, hashOtp, safeEqualHex, resendWaitMs, nextSendWindow, evaluateAttempt } from '../../src/services/otp.js';

const SECRET = 'x'.repeat(40);
const mkRecord = (code, over = {}) => ({
  codeHash: hashOtp(code, 'a@b.com', 'verify_email', SECRET),
  expiresAt: new Date(Date.now() + 60_000), attempts: 1, consumed: false, ...over,
});
const attempt = (rec, code) => evaluateAttempt(rec, { code, identifier: 'a@b.com', purpose: 'verify_email', secret: SECRET });

describe('otp generation and hashing', () => {
  test('always 6 digits, including leading zeros', () => {
    for (let i = 0; i < 500; i++) assert.match(generateOtp(), /^\d{6}$/);
  });
  test('hash is deterministic and bound to identifier + purpose + secret', () => {
    const h = hashOtp('123456', 'a@b.com', 'verify_email', SECRET);
    assert.equal(h, hashOtp('123456', 'a@b.com', 'verify_email', SECRET));
    assert.notEqual(h, hashOtp('123456', 'c@d.com', 'verify_email', SECRET));
    assert.notEqual(h, hashOtp('123456', 'a@b.com', 'reset_password', SECRET));
    assert.notEqual(h, hashOtp('123456', 'a@b.com', 'verify_email', 'y'.repeat(40)));
  });
  test('safeEqualHex rejects mismatched/empty input without throwing', () => {
    assert.equal(safeEqualHex('', ''), false);
    assert.equal(safeEqualHex('ab', 'abcd'), false);
    assert.equal(safeEqualHex('abcd', 'abcd'), true);
  });
});

describe('verification outcome', () => {
  test('OK for correct code', () => assert.equal(attempt(mkRecord('123456'), '123456'), 'OK'));
  test('INVALID for wrong code', () => assert.equal(attempt(mkRecord('123456'), '000000'), 'INVALID'));
  test('EXPIRED beats everything', () =>
    assert.equal(attempt(mkRecord('123456', { expiresAt: new Date(Date.now() - 1) }), '123456'), 'EXPIRED'));
  test('TOO_MANY_ATTEMPTS even with the correct code (stops brute force)', () =>
    assert.equal(attempt(mkRecord('123456', { attempts: 6 }), '123456'), 'TOO_MANY_ATTEMPTS'));
  test('5th attempt is still allowed, 6th is not', () => {
    assert.equal(attempt(mkRecord('123456', { attempts: 5 }), '123456'), 'OK');
  });
  test('consumed or missing record -> NO_OTP (no replay)', () => {
    assert.equal(attempt(mkRecord('123456', { consumed: true }), '123456'), 'NO_OTP');
    assert.equal(attempt(null, '123456'), 'NO_OTP');
  });
});

describe('resend cooldown and hourly quota', () => {
  test('cooldown', () => {
    const now = Date.now();
    assert.equal(resendWaitMs(null, now), 0);
    assert.equal(resendWaitMs({ lastSentAt: new Date(now - 10_000) }, now, 60_000), 50_000);
    assert.equal(resendWaitMs({ lastSentAt: new Date(now - 61_000) }, now, 60_000), 0);
  });
  test('quota blocks the 6th send within an hour and resets after', () => {
    const now = Date.now();
    let rec = null;
    for (let i = 1; i <= 5; i++) {
      const w = nextSendWindow(rec, now);
      assert.equal(w.sendCount, i);
      rec = w;
    }
    assert.equal(nextSendWindow(rec, now).blocked, true);
    assert.equal(nextSendWindow(rec, now + 61 * 60_000).sendCount, 1);
  });
});
