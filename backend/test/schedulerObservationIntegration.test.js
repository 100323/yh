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

  for (const source of ['scheduler', 'scheduler-recovery', 'scheduler-reconcile', 'scheduler-catchup', 'scheduler-manual', 'system']) {
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

test('disabled default observation bypasses scheduler catchup batch contexts before ALS work', async () => {
  await stopSchedulerObservationService({ flush: false });
  const wrappers = [
    {
      runAccount: requiredFunction(scheduler, 'runSchedulerAccountObserved'),
      runTask: requiredFunction(scheduler, 'runSchedulerTaskObserved'),
      context: { source: 'scheduler-catchup', accountId: 81, executionLane: 'direct' },
    },
    {
      runAccount: requiredFunction(batchScheduler, 'runBatchAccountObserved'),
      runTask: requiredFunction(batchScheduler, 'runBatchTaskObserved'),
      context: { batchTaskId: 82, accountId: 82, executionLane: 'direct' },
    },
  ];

  for (const { runAccount, runTask, context } of wrappers) {
    let taskContextReads = 0;
    const taskContext = new Proxy({}, {
      get(_target, name) {
        if (name === 'afterTask') return undefined;
        taskContextReads += 1;
        throw new Error('disabled observation must not read task context');
      },
    });
    const result = await runAccount(context, () => runTask(taskContext, () => {
      assert.equal(getSchedulerObservationContext(), null);
      return 'unchanged';
    }));
    assert.equal(result, 'unchanged');
    assert.equal(taskContextReads, 0);
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

test('scheduler and batch task settlements include daily-point claims in one run', async () => {
  const cases = [
    {
      runAccount: requiredFunction(scheduler, 'runSchedulerAccountObserved'),
      runTask: requiredFunction(scheduler, 'runSchedulerTaskObserved'),
      source: 'scheduler',
      accountId: 61,
      accountContext: { source: 'scheduler', accountId: 61, executionLane: 'direct' },
    },
    {
      runAccount: requiredFunction(batchScheduler, 'runBatchAccountObserved'),
      runTask: requiredFunction(batchScheduler, 'runBatchTaskObserved'),
      source: 'batch',
      accountId: 62,
      accountContext: { batchTaskId: 11, accountId: 62, executionLane: 'direct' },
    },
  ];

  for (const { runAccount, runTask, source, accountId, accountContext } of cases) {
    const commands = [];
    const tasks = [];
    const client = createOpenClient({
      observeCommandSent(event) {
        commands.push(event);
      },
    });

    const resultPromise = runAccount(accountContext, () => runTask({
      taskType: 'SIGN_IN',
      afterTask: async () => {
        await client.claimDailyPoint(1);
        await new Promise((resolve) => setTimeout(resolve, 25));
      },
    }, () => client.sendWithPromise('role_getroleinfo', {}), {
      observeTaskSettled(event) {
        tasks.push(event);
      },
    }), { observer: { observeAccountQueue() {} } });

    await waitFor(() => commands.length === 1);
    client._handleMessage({ resp: 1, seq: 2, cmd: 'role_getroleinforesp', body: { ok: true } });
    await waitFor(() => commands.length === 2);
    assert.deepEqual(commands.map((event) => event.command), [
      'role_getroleinfo',
      'task_claimdailypoint',
    ]);
    assert.equal(commands[1].source, source);
    assert.equal(commands[1].accountId, accountId);
    assert.equal(commands[1].taskType, 'SIGN_IN');
    assert.equal(commands[1].runId, commands[0].runId);
    assert.equal(tasks.length, 0);

    client._handleMessage({ resp: 1, seq: 3, cmd: 'syncresp', body: { ok: true } });
    assert.deepEqual(await resultPromise, { ok: true });
    assert.equal(tasks.length, 1);
    assert.equal(tasks[0].taskType, 'SIGN_IN');
    assert.equal(tasks[0].runId, commands[0].runId);
    assert.ok(tasks[0].durationMs >= 20);
  }
});

test('task settlement attributes only game commands sent inside its active run', async (t) => {
  const runAccount = requiredFunction(scheduler, 'runSchedulerAccountObserved');
  const runTask = requiredFunction(scheduler, 'runSchedulerTaskObserved');
  const commands = [];
  const tasks = [];
  startSchedulerObservationService({
    config: { enabled: true, flushIntervalMs: 60_000, maxMetricKeys: 100 },
    aggregator: {
      recordCommand(event) {
        commands.push(event);
        return true;
      },
      recordTask(event) {
        tasks.push(event);
        return true;
      },
      recordAnomaly() { return true; },
      getHealth() { return {}; },
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

  const outsideClient = createOpenClient();
  outsideClient.send('_sys/ack', {});
  outsideClient.send('warmup_getinfo', {});

  const client = createOpenClient();
  const resultPromise = runAccount({
    source: 'scheduler',
    accountId: 63,
    executionLane: 'direct',
  }, () => runTask({ taskType: 'ATTRIBUTED' }, async () => {
    const first = client.sendWithPromise('role_getroleinfo', {});
    await waitFor(() => commands.some((row) => row.command === 'role_getroleinfo'));
    client._handleMessage({ resp: 1, seq: 2, cmd: 'role_getroleinforesp', body: { ok: 1 } });
    await first;
    const second = client.sendWithPromise('tower_getinfo', {});
    await waitFor(() => commands.some((row) => row.command === 'tower_getinfo'));
    client._handleMessage({ resp: 1, seq: 3, cmd: 'tower_getinforesp', body: { ok: 2 } });
    return second;
  }));

  assert.deepEqual(await resultPromise, { ok: 2 });
  assert.equal(tasks.length, 1);
  assert.equal(tasks[0].task, 'ATTRIBUTED');
  assert.equal(tasks[0].attributedCommandCount, 2);
  assert.equal(commands.filter((row) => row.commandCount === 1).length, 4);
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

test('daily task auto-claim records only inside claim execution, not on the account wrapper', () => {
  const source = fs.readFileSync(new URL('../src/scheduler/index.js', import.meta.url), 'utf8');
  const start = source.indexOf('async function flushDailyRewardClaim(accountId');
  const end = source.indexOf('\nfunction getDateKey()', start);
  assert.equal(start >= 0 && end > start, true);
  const implementation = source.slice(start, end);
  const accountCallStart = implementation.indexOf('runSchedulerAccountObserved({');
  const accountExecutorStart = implementation.indexOf('}, async () => {', accountCallStart);
  assert.equal(accountCallStart >= 0 && accountExecutorStart > accountCallStart, true);
  assert.doesNotMatch(
    implementation.slice(accountCallStart, accountExecutorStart),
    /taskType\s*:/,
  );
  assert.match(
    implementation,
    /runSchedulerTaskObserved\(\{[\s\S]*?taskType:\s*'DAILY_TASK_CLAIM'[\s\S]*?executeDailyTaskClaim/,
  );
});

test('minute scheduler refresh also scans durable slots left by an older instance', () => {
  const source = fs.readFileSync(new URL('../src/scheduler/index.js', import.meta.url), 'utf8');
  const start = source.indexOf('export async function checkAndRunDueTasks()');
  const end = source.indexOf('\nexport async function executeTask(', start);
  assert.equal(start >= 0 && end > start, true);
  assert.match(source.slice(start, end), /await recoverQueuedSchedulerSlots\(tasks\)/);
});

test('minute scheduler refresh reconciles cron callbacks that never created a durable slot', () => {
  const source = fs.readFileSync(new URL('../src/scheduler/index.js', import.meta.url), 'utf8');
  const checkStart = source.indexOf('export async function checkAndRunDueTasks()');
  const checkEnd = source.indexOf('\nexport async function executeTask(', checkStart);
  const initializeStart = source.indexOf('export async function initScheduler()');
  const initializeEnd = source.indexOf('\nexport function scheduleTask(', initializeStart);
  assert.equal(checkStart >= 0 && checkEnd > checkStart, true);
  assert.equal(initializeStart >= 0 && initializeEnd > initializeStart, true);
  assert.match(source.slice(checkStart, checkEnd), /reconcileMissingSchedulerSlots\(tasks/);
  assert.match(source.slice(initializeStart, initializeEnd), /reconcileMissingSchedulerSlots\(tasks/);
  assert.match(
    source.slice(initializeStart, initializeEnd),
    /cron\.schedule\('\* \* \* \* \*'[\s\S]*?recoverMissedExecutions:\s*true/,
  );
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
