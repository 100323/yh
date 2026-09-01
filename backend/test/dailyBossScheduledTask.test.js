import test from 'node:test';
import assert from 'node:assert/strict';

import { executeDailyBossScheduledTask } from '../src/utils/scheduledTaskHelpers.js';

function createClient(startDailyBossFight) {
  return {
    ensureBattleVersion: async () => {},
    startDailyBossFight,
  };
}

test('retries the same daily boss attempt after a too-fast response', async () => {
  const calls = [];
  let callCount = 0;
  const client = createClient(async (bossId) => {
    callCount += 1;
    calls.push(bossId);
    if (callCount === 1) {
      throw new Error('操作过快,请稍后重试');
    }
    return { round: callCount };
  });

  const result = await executeDailyBossScheduledTask(client, {
    bossId: 9904,
    tooFastRetryDelaysMs: [0],
    challengeDelayMs: 0,
  });

  assert.equal(result.message, '每日咸王挑战完成 (5/5次)');
  assert.equal(callCount, 6);
  assert.deepEqual(calls, [9904, 9904, 9904, 9904, 9904, 9904]);
});

test('fails the task when every retry remains rate limited', async () => {
  const client = createClient(async () => {
    throw new Error('操作过快,请稍后重试');
  });

  await assert.rejects(
    executeDailyBossScheduledTask(client, {
      bossId: 9904,
      tooFastRetryDelaysMs: [0, 0],
      challengeDelayMs: 0,
    }),
    (error) => {
      assert.match(error.message, /连续限频/);
      assert.equal(error.details.successCount, 0);
      assert.equal(error.details.results.length, 1);
      assert.equal(error.details.results[0].rateLimited, true);
      return true;
    },
  );
});

test('stops as a no-op when the daily boss was already challenged', async () => {
  let callCount = 0;
  const client = createClient(async () => {
    callCount += 1;
    throw new Error('今日已挑战');
  });

  const result = await executeDailyBossScheduledTask(client, {
    bossId: 9904,
    challengeDelayMs: 0,
  });

  assert.equal(callCount, 1);
  assert.equal(result.message, '每日咸王已挑战，无需重复执行');
  assert.equal(result.data.successCount, 0);
  assert.equal(result.data.results[0].stop, true);
});

test('stops as a no-op when the daily boss challenge quota is exhausted', async () => {
  let callCount = 0;
  const client = createClient(async () => {
    callCount += 1;
    throw new Error('挑战次数已达上限');
  });

  const result = await executeDailyBossScheduledTask(client, {
    bossId: 9904,
    challengeDelayMs: 0,
  });

  assert.equal(callCount, 1);
  assert.equal(result.message, '每日咸王今日挑战次数已用完');
  assert.equal(result.data.successCount, 0);
  assert.equal(result.data.results[0].stop, true);
});
