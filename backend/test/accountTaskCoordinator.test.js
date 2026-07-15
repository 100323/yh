import test from 'node:test';
import assert from 'node:assert/strict';
import config from '../src/config/index.js';
import {
  clearAccountTaskCoordinator,
  runAccountTaskExclusive,
  runTaskTypeCommandThrottled,
  runTaskTypeThrottled,
} from '../src/utils/accountTaskCoordinator.js';
import { withSchedulerObservationContext } from '../src/observability/schedulerObservationCore.js';

function deferred() {
  let resolve;
  const promise = new Promise((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

test('account queue observation preserves FIFO and reports one wait per acquired account', async (t) => {
  const originalMaxConcurrentAccounts = config.scheduler.maxConcurrentAccounts;
  const originalDispatchIntervalMs = config.scheduler.accountDispatchIntervalMs;
  config.scheduler.maxConcurrentAccounts = 1;
  config.scheduler.accountDispatchIntervalMs = 0;
  clearAccountTaskCoordinator();

  t.after(() => {
    config.scheduler.maxConcurrentAccounts = originalMaxConcurrentAccounts;
    config.scheduler.accountDispatchIntervalMs = originalDispatchIntervalMs;
    clearAccountTaskCoordinator();
  });

  const firstMayFinish = deferred();
  const firstStarted = deferred();
  const starts = [];
  const observations = [];
  const observer = {
    observeAccountQueue(event) {
      observations.push(event);
    },
  };

  const first = withSchedulerObservationContext({
    source: 'scheduler',
    runId: 'run-1',
    taskType: 'FIRST',
  }, () => runAccountTaskExclusive(1, async () => {
    starts.push(1);
    firstStarted.resolve();
    await firstMayFinish.promise;
    return 'first';
  }, { lane: 'direct', observer }));

  await firstStarted.promise;
  const second = withSchedulerObservationContext({
    source: 'scheduler',
    runId: 'run-2',
    taskType: 'SECOND',
  }, () => runAccountTaskExclusive(2, async () => {
    starts.push(2);
    return 'second';
  }, { lane: 'direct', observer }));

  await new Promise((resolve) => setTimeout(resolve, 15));
  assert.deepEqual(starts, [1]);
  firstMayFinish.resolve();
  assert.deepEqual(await Promise.all([first, second]), ['first', 'second']);
  assert.deepEqual(starts, [1, 2]);
  assert.equal(observations.length, 2);
  assert.deepEqual(Object.keys(observations[1]).sort(), [
    'accountId',
    'executionLane',
    'runId',
    'source',
    'taskType',
    'waitMs',
  ]);
  assert.equal(observations[1].accountId, 2);
  assert.equal(observations[1].executionLane, 'direct');
  assert.equal(observations[1].source, 'scheduler');
  assert.equal(observations[1].runId, 'run-2');
  assert.equal(observations[1].taskType, 'SECOND');
  assert.ok(observations[1].waitMs > 0);
});

test('account queue observer getter, throw, and rejection cannot change return or release', async (t) => {
  const originalMaxConcurrentAccounts = config.scheduler.maxConcurrentAccounts;
  const originalDispatchIntervalMs = config.scheduler.accountDispatchIntervalMs;
  config.scheduler.maxConcurrentAccounts = 1;
  config.scheduler.accountDispatchIntervalMs = 0;
  clearAccountTaskCoordinator();

  t.after(() => {
    config.scheduler.maxConcurrentAccounts = originalMaxConcurrentAccounts;
    config.scheduler.accountDispatchIntervalMs = originalDispatchIntervalMs;
    clearAccountTaskCoordinator();
  });

  const result = { ok: true };
  const optionsWithThrowingObserverGetter = {};
  Object.defineProperty(optionsWithThrowingObserverGetter, 'observer', {
    get() {
      throw new Error('observer getter failed');
    },
  });
  assert.strictEqual(
    await runAccountTaskExclusive('getter', async () => result, optionsWithThrowingObserverGetter),
    result,
  );

  const observerWithThrowingMethodGetter = {};
  Object.defineProperty(observerWithThrowingMethodGetter, 'observeAccountQueue', {
    get() {
      throw new Error('method getter failed');
    },
  });
  assert.equal(await runAccountTaskExclusive('method-getter', async () => 1, {
    observer: observerWithThrowingMethodGetter,
  }), 1);

  assert.equal(await runAccountTaskExclusive('throw', async () => 2, {
    observer: {
      observeAccountQueue() {
        throw new Error('observer failed');
      },
    },
  }), 2);

  assert.equal(await runAccountTaskExclusive('reject', async () => 3, {
    observer: {
      observeAccountQueue() {
        return Promise.reject(new Error('observer rejected'));
      },
    },
  }), 3);

  const taskError = new Error('task failed');
  await assert.rejects(
    runAccountTaskExclusive('error', async () => {
      throw taskError;
    }, {
      observer: {
        observeAccountQueue() {
          throw new Error('observer failed while task fails');
        },
      },
    }),
    (error) => error === taskError,
  );

  assert.equal(await runAccountTaskExclusive('after-error', async () => 'released'), 'released');
});

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
