import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import config from '../src/config/index.js';
import GameClient from '../src/utils/gameClient.js';
import { clearAccountTaskCoordinator } from '../src/utils/accountTaskCoordinator.js';
import { getSchedulerObservationContext } from '../src/observability/schedulerObservationCore.js';
import {
  startSchedulerObservationService,
  stopSchedulerObservationService,
} from '../src/observability/schedulerObservationService.js';

const originalCwd = process.cwd();
const importCwd = fs.mkdtempSync(path.join(os.tmpdir(), 'scheduler-observation-'));
process.chdir(importCwd);
const [scheduler, batchScheduler] = await Promise.all([
  import('../src/scheduler/index.js'),
  import('../src/batchScheduler/index.js'),
]);
process.chdir(originalCwd);

after(() => {
  process.chdir(originalCwd);
  fs.rmSync(importCwd, { recursive: true, force: true });
});

function requiredFunction(owner, name) {
  assert.equal(typeof owner[name], 'function', `missing integration function ${name}`);
  return owner[name];
}

function createOpenClient(commandObserver) {
  const client = new GameClient('must-not-leak', { commandObserver });
  client.connected = true;
  client.ws = {
    readyState: 1,
    send() {},
  };
  return client;
}

async function waitFor(predicate) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.fail('condition was not reached');
}

test('scheduler sources and task context flow through the command boundary', async () => {
  const runAccount = requiredFunction(scheduler, 'runSchedulerAccountObserved');
  const runTask = requiredFunction(scheduler, 'runSchedulerTaskObserved');

  for (const source of ['scheduler', 'scheduler-catchup', 'scheduler-manual', 'system']) {
    const commands = [];
    const tasks = [];
    const client = createOpenClient({
      observeCommandSent(event) {
        commands.push(event);
      },
    });

    const resultPromise = runAccount({
      source,
      accountId: 41,
      executionLane: 'direct',
    }, () => runTask({ taskType: 'ROLE_INFO' }, () => (
      client.sendWithPromise('role_getroleinfo', {})
    ), {
      observeTaskSettled(event) {
        tasks.push(event);
      },
    }), { observer: { observeAccountQueue() {} } });

    await waitFor(() => commands.length === 1);
    client._handleMessage({ resp: 1, seq: 2, cmd: 'role_getroleinforesp', body: { source } });
    assert.deepEqual(await resultPromise, { source });
    assert.equal(commands[0].source, source);
    assert.equal(commands[0].accountId, 41);
    assert.equal(commands[0].taskType, 'ROLE_INFO');
    assert.equal(commands[0].executionLane, 'direct');
    assert.equal(tasks.length, 1);
    assert.equal(tasks[0].source, source);
    assert.equal(tasks[0].taskType, 'ROLE_INFO');
  }
});

test('batch context includes batch task, account, task type, and lane', async () => {
  const runAccount = requiredFunction(batchScheduler, 'runBatchAccountObserved');
  const runTask = requiredFunction(batchScheduler, 'runBatchTaskObserved');
  const commands = [];
  const tasks = [];
  const client = createOpenClient({
    observeCommandSent(event) {
      commands.push(event);
    },
  });

  const resultPromise = runAccount({
    batchTaskId: 9,
    accountId: 42,
    executionLane: 'proxy',
  }, () => runTask({ taskType: 'ARENA' }, () => (
    client.sendWithPromise('arena_getinfo', {})
  ), {
    observeTaskSettled(event) {
      tasks.push(event);
    },
  }), { observer: { observeAccountQueue() {} } });

  await waitFor(() => commands.length === 1);
  client._handleMessage({ resp: 1, seq: 2, cmd: 'arena_getinforesp', body: { ok: true } });
  assert.deepEqual(await resultPromise, { ok: true });
  assert.equal(commands[0].source, 'batch');
  assert.equal(commands[0].batchTaskId, 9);
  assert.equal(commands[0].accountId, 42);
  assert.equal(commands[0].taskType, 'ARENA');
  assert.equal(commands[0].executionLane, 'proxy');
  assert.equal(tasks.length, 1);
  assert.equal(tasks[0].batchTaskId, 9);
  assert.equal(tasks[0].accountId, 42);
});

test('proxy scheduling lane does not become the actual command egress', async () => {
  const runAccount = requiredFunction(scheduler, 'runSchedulerAccountObserved');
  const runTask = requiredFunction(scheduler, 'runSchedulerTaskObserved');
  const commands = [];
  const client = createOpenClient({
    observeCommandSent(event) {
      commands.push(event);
    },
  });

  const resultPromise = runAccount({
    source: 'scheduler',
    accountId: 43,
    executionLane: 'proxy',
  }, () => runTask({ taskType: 'DIRECT_EGRESS' }, () => (
    client.sendWithPromise('role_getroleinfo', {})
  ), { observeTaskSettled() {} }), { observer: { observeAccountQueue() {} } });

  await waitFor(() => commands.length === 1);
  client._handleMessage({ resp: 1, seq: 2, cmd: 'role_getroleinforesp', body: { ok: true } });
  await resultPromise;
  assert.equal(commands[0].executionLane, 'proxy');
  assert.equal(commands[0].egressType, 'direct');
  assert.equal(commands[0].egressKey, 'direct');
  assert.equal(Object.hasOwn(commands[0], 'proxy'), false);
});

test('task observation failure preserves task return and original Error', async () => {
  const runTask = requiredFunction(scheduler, 'runSchedulerTaskObserved');
  const value = { stable: true };
  assert.strictEqual(await runTask({ taskType: 'RETURN' }, async () => value, {
    observeTaskSettled() {
      return Promise.reject(new Error('observer rejected'));
    },
  }), value);

  const taskError = new Error('same error');
  await assert.rejects(
    runTask({ taskType: 'ERROR' }, async () => {
      throw taskError;
    }, {
      observeTaskSettled() {
        throw new Error('observer failed');
      },
    }),
    (error) => error === taskError,
  );
});

test('scheduler and batch account wrappers isolate a throwing observer getter', async () => {
  const wrappers = [
    {
      run: requiredFunction(scheduler, 'runSchedulerAccountObserved'),
      context: { source: 'scheduler', accountId: 45, executionLane: 'direct' },
    },
    {
      run: requiredFunction(batchScheduler, 'runBatchAccountObserved'),
      context: { batchTaskId: 10, accountId: 46, executionLane: 'direct' },
    },
  ];

  for (const { run, context } of wrappers) {
    let executions = 0;
    const options = {};
    Object.defineProperty(options, 'observer', {
      get() {
        throw new Error('observer getter failed');
      },
    });
    assert.equal(await run(context, async () => {
      executions += 1;
      return 'unchanged';
    }, options), 'unchanged');
    assert.equal(executions, 1);
  }
});

test('single system account task consumes its queue wait in exactly one settlement', async (t) => {
  const runAccount = requiredFunction(scheduler, 'runSchedulerAccountObserved');
  const recordedTasks = [];
  startSchedulerObservationService({
    config: { enabled: true, flushIntervalMs: 60_000, maxMetricKeys: 100 },
    aggregator: {
      recordTask(event) {
        recordedTasks.push(event);
        return true;
      },
      getHealth() {
        return {};
      },
      takeSnapshot() {
        return {
          version: 1,
          generatedAt: new Date().toISOString(),
          commandMetrics: [],
          taskMetrics: [],
          anomalies: [],
          totals: { commandCount: 0, taskCount: 0, rateLimitedCount: 0 },
          health: { metricKeys: 0, anomalyCount: 0, droppedMetrics: 0, droppedAnomalies: 0 },
        };
      },
    },
    flushSnapshot() {},
  });
  t.after(async () => {
    await stopSchedulerObservationService({ flush: false });
    clearAccountTaskCoordinator();
  });

  assert.equal(await runAccount({
    source: 'system',
    accountId: 47,
    executionLane: 'direct',
    taskType: 'DAILY_TASK_CLAIM',
  }, async () => 'system-result'), 'system-result');
  assert.equal(recordedTasks.length, 1);
  assert.equal(recordedTasks[0].task, 'DAILY_TASK_CLAIM');
  assert.equal(recordedTasks[0].dimensions.source, 'system');
  assert.equal(recordedTasks[0].queueWaitMs >= 0, true);
});

test('queue wait associates with one task settlement without duplicate runs', async (t) => {
  const runAccount = requiredFunction(scheduler, 'runSchedulerAccountObserved');
  const runTask = requiredFunction(scheduler, 'runSchedulerTaskObserved');
  const originalMaxConcurrentAccounts = config.scheduler.maxConcurrentAccounts;
  const originalDispatchIntervalMs = config.scheduler.accountDispatchIntervalMs;
  config.scheduler.maxConcurrentAccounts = 1;
  config.scheduler.accountDispatchIntervalMs = 0;
  clearAccountTaskCoordinator();

  const recordedTasks = [];
  startSchedulerObservationService({
    config: { enabled: true, flushIntervalMs: 60_000, maxMetricKeys: 100 },
    aggregator: {
      recordTask(event) {
        recordedTasks.push(event);
        return true;
      },
      getHealth() {
        return {};
      },
      takeSnapshot() {
        return {
          version: 1,
          generatedAt: new Date().toISOString(),
          commandMetrics: [],
          taskMetrics: [],
          anomalies: [],
          totals: { commandCount: 0, taskCount: 0, rateLimitedCount: 0 },
          health: { metricKeys: 0, anomalyCount: 0, droppedMetrics: 0, droppedAnomalies: 0 },
        };
      },
    },
    flushSnapshot() {},
  });

  t.after(async () => {
    await stopSchedulerObservationService({ flush: false });
    config.scheduler.maxConcurrentAccounts = originalMaxConcurrentAccounts;
    config.scheduler.accountDispatchIntervalMs = originalDispatchIntervalMs;
    clearAccountTaskCoordinator();
  });

  let releaseFirst;
  const firstGate = new Promise((resolve) => {
    releaseFirst = resolve;
  });
  const first = runAccount({ source: 'scheduler', accountId: 51, executionLane: 'direct' }, () => (
    runTask({ taskType: 'FIRST' }, async () => {
      await firstGate;
      return 'first';
    })
  ));
  await waitFor(() => recordedTasks.length === 0);
  const second = runAccount({ source: 'scheduler', accountId: 52, executionLane: 'direct' }, () => (
    runTask({ taskType: 'SECOND' }, async () => 'second')
  ));
  await new Promise((resolve) => setTimeout(resolve, 15));
  releaseFirst();
  assert.deepEqual(await Promise.all([first, second]), ['first', 'second']);
  assert.equal(recordedTasks.length, 2);
  assert.deepEqual(recordedTasks.map((event) => event.task), ['FIRST', 'SECOND']);
  assert.equal(recordedTasks.filter((event) => event.task === 'SECOND').length, 1);
  assert.ok(recordedTasks.find((event) => event.task === 'SECOND').queueWaitMs > 0);
});
