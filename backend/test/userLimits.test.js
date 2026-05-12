import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_MAX_GAME_ACCOUNTS,
  normalizeMaxGameAccountsForCreate,
} from '../src/utils/userLimits.js';

test('defaults newly created users to two game accounts', () => {
  assert.equal(DEFAULT_MAX_GAME_ACCOUNTS, 2);
  assert.equal(normalizeMaxGameAccountsForCreate(undefined), 2);
  assert.equal(normalizeMaxGameAccountsForCreate(''), 2);
});

test('allows unlimited game accounts when create value is null', () => {
  assert.equal(normalizeMaxGameAccountsForCreate(null), null);
});

test('validates explicit game account limits', () => {
  assert.equal(normalizeMaxGameAccountsForCreate(10), 10);
  assert.throws(
    () => normalizeMaxGameAccountsForCreate(0),
    /游戏账号数量上限需为 1-9999 的整数/,
  );
});
