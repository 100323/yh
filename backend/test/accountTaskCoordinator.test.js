import test from 'node:test';
import assert from 'node:assert/strict';
import config from '../src/config/index.js';
import {
  clearAccountTaskCoordinator,
  runTaskTypeCommandThrottled,
  runTaskTypeThrottled,
} from '../src/utils/accountTaskCoordinator.js';

test('limits concurrent GENIE_SWEEP task executions when configured', async (t) => {
  const originalTaskTypeMaxConcurrency = config.scheduler.taskTypeMaxConcurrency;
  config.scheduler.taskTypeMaxConcurrency = {
    ...originalTaskTypeMaxConcurrency,
    GENIE_SWEEP: 2,
  };
  clearAccountTaskCoordinator();

  t.after(() => {
    config.scheduler.taskTypeMaxConcurrency = originalTaskTypeMaxConcurrency;
    clearAccountTaskCoordinator();
  });

  let active = 0;
  let maxActive = 0;
  const executions = Array.from({ length: 4 }, (_, index) =>
    runTaskTypeThrottled('GENIE_SWEEP', { accountId: index + 1 }, async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 25));
      active -= 1;
      return index;
    })
  );

  await Promise.all(executions);

  assert.equal(maxActive, 2);
});

test('spaces GENIE_SWEEP commands globally while task executions remain concurrent', async (t) => {
  const originalThrottle = config.scheduler.taskTypeCommandThrottleMs;
  config.scheduler.taskTypeCommandThrottleMs = {
    ...originalThrottle,
    GENIE_SWEEP: 30,
  };
  clearAccountTaskCoordinator();

  t.after(() => {
    config.scheduler.taskTypeCommandThrottleMs = originalThrottle;
    clearAccountTaskCoordinator();
  });

  const startedAt = [];
  await Promise.all(Array.from({ length: 3 }, (_, index) =>
    runTaskTypeCommandThrottled('GENIE_SWEEP', {
      command: 'genie_sweep',
      genieId: index + 1,
    }, async () => {
      startedAt.push(Date.now());
      return index;
    })
  ));

  assert.equal(startedAt.length, 3);
  assert.ok(startedAt[1] - startedAt[0] >= 25);
  assert.ok(startedAt[2] - startedAt[1] >= 25);
});
