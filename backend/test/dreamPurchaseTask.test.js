import test from 'node:test';
import assert from 'node:assert/strict';
import { TASK_TYPES, DEFAULT_TASK_CONFIG_SEEDS, LEGACY_DEFAULT_TASK_CRONS } from '../src/routes/tasks.js';
import { BATCH_TASK_TYPES } from '../src/routes/batchScheduler.js';
import * as batchScheduler from '../src/batchScheduler/index.js';

const DREAM_OPEN_CRON = '10 12 * * 0,1,3,4';
const DREAM_GOLD_PURCHASE_LIST = ['1-5', '1-6', '2-6', '2-7', '3-5', '3-6', '3-7'];

test('dream purchase defaults match dream open days and gold-item list', () => {
  assert.equal(TASK_TYPES.DREAM.cron, DREAM_OPEN_CRON);
  assert.equal(TASK_TYPES.DREAM_PURCHASE.cron, DREAM_OPEN_CRON);
  assert.ok(LEGACY_DEFAULT_TASK_CRONS.DREAM.includes('10 12 * * 0,3,6'));
  assert.ok(LEGACY_DEFAULT_TASK_CRONS.DREAM_PURCHASE.includes('10 12 * * 0,3,6'));
  assert.deepEqual(DEFAULT_TASK_CONFIG_SEEDS.DREAM_PURCHASE.config.purchaseList, DREAM_GOLD_PURCHASE_LIST);
});

test('backend batch scheduler exposes dream purchase task metadata', () => {
  assert.deepEqual(BATCH_TASK_TYPES.DREAM_PURCHASE, {
    name: '购买梦境商品',
    group: 'dungeon',
  });
});

test('backend batch scheduler routes dream purchase to client.buyDreamItems', async () => {
  assert.equal(typeof batchScheduler.__testing?.runTaskByType, 'function');

  const calls = [];
  const client = {
    async buyDreamItems(purchaseList) {
      calls.push(purchaseList);
      return {
        successCount: 1,
        results: [{ success: true }],
      };
    },
  };

  const result = await batchScheduler.__testing.runTaskByType(client, 'DREAM_PURCHASE', {
    purchaseList: ['1-5'],
  });

  assert.deepEqual(calls, [['1-5']]);
  assert.equal(result.message, '梦境购买完成 (成功1/1)');
});
