import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeRegisteredUserAccessDays,
  resolveRegisteredUserAccessEndAt,
} from '../src/utils/inviteCodeAccess.js';

test('defaults invite-code registered user access to 30 days', () => {
  assert.equal(normalizeRegisteredUserAccessDays(undefined), 30);
});

test('allows permanent registered user access', () => {
  assert.equal(normalizeRegisteredUserAccessDays(null), null);
  assert.equal(resolveRegisteredUserAccessEndAt(null), null);
});

test('allows configured registered user access day options', () => {
  assert.equal(normalizeRegisteredUserAccessDays(1), 1);
  assert.equal(normalizeRegisteredUserAccessDays(30), 30);
  assert.equal(normalizeRegisteredUserAccessDays(180), 180);
  assert.equal(normalizeRegisteredUserAccessDays(365), 365);
});

test('rejects unsupported registered user access day options', () => {
  assert.throws(
    () => normalizeRegisteredUserAccessDays(7),
    /注册账号有效期只能选择永久、1天、30天、180天、365天/,
  );
});

test('resolves registered user access end time from registration time', () => {
  const now = new Date('2026-05-12T08:00:00.000Z');
  assert.equal(
    resolveRegisteredUserAccessEndAt(30, now),
    '2026-06-11T08:00:00.000Z',
  );
});
