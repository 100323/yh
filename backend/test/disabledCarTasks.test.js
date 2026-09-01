import test from 'node:test';
import assert from 'node:assert/strict';
import {
  TASK_TYPES,
  DEFAULT_TASK_CONFIG_SEEDS,
} from '../src/routes/tasks.js';
import { BATCH_TASK_TYPES } from '../src/routes/batchScheduler.js';
import * as batchScheduler from '../src/batchScheduler/index.js';
import * as scheduler from '../src/scheduler/index.js';

const DISABLED_TASK_TYPES = ['CAR_SEND', 'CAR_CLAIM'];

test('disabled car task types are removed from backend task catalogs', () => {
  for (const taskType of DISABLED_TASK_TYPES) {
    assert.equal(TASK_TYPES[taskType], undefined);
    assert.equal(BATCH_TASK_TYPES[taskType], undefined);
    assert.equal(DEFAULT_TASK_CONFIG_SEEDS[taskType], undefined);
  }
});

test('both task schedulers reject disabled car task execution', async () => {
  assert.equal(typeof batchScheduler.__testing?.runTaskByType, 'function');
  assert.equal(typeof scheduler.__testing?.runTaskByType, 'function');

  for (const taskType of DISABLED_TASK_TYPES) {
    await assert.rejects(
      () => batchScheduler.__testing.runTaskByType({}, taskType, {}),
      /任务已停用/,
    );
    await assert.rejects(
      () => scheduler.__testing.runTaskByType({}, taskType, {}),
      /任务已停用/,
    );
  }
});
