import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  getSchedulerObservationHealth,
  observeAccountQueue,
  observeCommandSent,
  observeCommandSettled,
  observeTaskSettled,
  startSchedulerObservationService,
  stopSchedulerObservationService,
} from '../src/observability/schedulerObservationService.js';

const CONFIG_ENV_NAMES = [
  'SCHEDULER_OBSERVABILITY_ENABLED',
  'SCHEDULER_OBSERVABILITY_FLUSH_INTERVAL_MS',
  'SCHEDULER_OBSERVABILITY_SLOW_COMMAND_MS',
  'SCHEDULER_OBSERVABILITY_RETENTION_DAYS',
  'SCHEDULER_OBSERVABILITY_MAX_METRIC_KEYS',
  'SCHEDULER_OBSERVABILITY_MAX_ANOMALY_BUFFER',
  'SCHEDULER_OBSERVABILITY_MAX_ANOMALY_ROWS',
];

function snapshot({ commandMetrics = [], taskMetrics = [], anomalies = [], health = {} } = {}) {
  return {
    version: 1,
    generatedAt: '2026-07-15T00:00:00.000Z',
    commandMetrics,
    taskMetrics,
    anomalies,
    totals: { commandCount: 0, taskCount: 0, rateLimitedCount: 0 },
    health: {
      metricKeys: commandMetrics.length + taskMetrics.length,
      anomalyCount: anomalies.length,
      droppedMetrics: 0,
      droppedAnomalies: 0,
      ...health,
    },
  };
}

function commandSnapshot(command = 'role:info:get') {
  return snapshot({
    commandMetrics: [{ command, outcome: 'sent' }],
  });
}

function createTimerHarness() {
  const intervals = [];
  const cleared = [];
  return {
    intervals,
    cleared,
    setIntervalFn(callback, delay) {
      const handle = { callback, delay, id: intervals.length + 1 };
      intervals.push(handle);
      return handle;
    },
    clearIntervalFn(handle) {
      cleared.push(handle);
    },
  };
}

function createAggregator({ snapshots = [snapshot()], health, overrides = {} } = {}) {
  const calls = {
    recordCommand: [],
    recordTask: [],
    recordAnomaly: [],
    takeSnapshot: 0,
    mergeSnapshot: [],
    getHealth: 0,
  };
  const queue = [...snapshots];
  const aggregator = {
    recordCommand(event) {
      calls.recordCommand.push(event);
      return true;
    },
    recordTask(event) {
      calls.recordTask.push(event);
      return true;
    },
    recordAnomaly(event) {
      calls.recordAnomaly.push(event);
      return true;
    },
    takeSnapshot() {
      calls.takeSnapshot += 1;
      return queue.shift() ?? snapshot();
    },
    mergeSnapshot(value) {
      calls.mergeSnapshot.push(value);
      return true;
    },
    getHealth() {
      calls.getHealth += 1;
      return health ?? {
        metricKeys: 0,
        anomalyCount: 0,
        droppedMetrics: 0,
        droppedAnomalies: 0,
      };
    },
    ...overrides,
  };
  return { aggregator, calls, queue };
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function drainAsyncWork() {
  await Promise.resolve();
  await new Promise((resolve) => setImmediate(resolve));
}

async function importFreshConfig() {
  const suffix = `${Date.now()}-${Math.random()}`;
  return import(`../src/config/index.js?service-test=${suffix}`);
}

afterEach(async () => {
  await stopSchedulerObservationService({ flush: false });
  for (const name of CONFIG_ENV_NAMES) delete process.env[name];
});

test('disabled service creates no timer and every observer is a fast no-op', async () => {
  const timers = createTimerHarness();
  const { aggregator, calls } = createAggregator({
    overrides: {
      recordCommand() { throw new Error('must not touch aggregator'); },
      recordTask() { throw new Error('must not touch aggregator'); },
      recordAnomaly() { throw new Error('must not touch aggregator'); },
      getHealth() { throw new Error('must not touch aggregator'); },
      takeSnapshot() { throw new Error('must not touch aggregator'); },
    },
  });
  let flushCalls = 0;

  assert.equal(startSchedulerObservationService({
    config: { enabled: false },
    aggregator,
    flushSnapshot: () => { flushCalls += 1; },
    ...timers,
  }), false);

  assert.equal(observeCommandSent({ command: 'ignored' }), false);
  assert.equal(observeCommandSettled({ command: 'ignored', outcome: 'error' }), false);
  assert.equal(observeTaskSettled({ taskType: 'ignored', outcome: 'success' }), false);
  assert.equal(observeAccountQueue({ accountId: 1, queueWaitMs: 5 }), false);
  assert.equal(timers.intervals.length, 0);
  assert.equal(flushCalls, 0);
  assert.deepEqual(calls.recordCommand, []);
  await assert.doesNotReject(stopSchedulerObservationService());
  assert.equal(timers.cleared.length, 0);
});

test('start is idempotent, one populated tick flushes once, and empty snapshots skip repository', async () => {
  const timers = createTimerHarness();
  const { aggregator, calls } = createAggregator({
    snapshots: [commandSnapshot(), snapshot()],
  });
  const flushed = [];
  const options = {
    config: { enabled: true, flushIntervalMs: 3210 },
    aggregator,
    flushSnapshot(value) { flushed.push(value); },
    ...timers,
  };

  assert.equal(startSchedulerObservationService(options), true);
  assert.equal(startSchedulerObservationService(options), true);
  assert.equal(timers.intervals.length, 1);
  assert.equal(timers.intervals[0].delay, 3210);

  assert.equal(timers.intervals[0].callback(), undefined);
  await drainAsyncWork();
  assert.equal(flushed.length, 1);

  timers.intervals[0].callback();
  await drainAsyncWork();
  assert.equal(calls.takeSnapshot, 2);
  assert.equal(flushed.length, 1);
});

test('successful flush updates timing health and merges aggregator counters', async () => {
  const timers = createTimerHarness();
  const { aggregator } = createAggregator({
    snapshots: [commandSnapshot()],
    health: {
      metricKeys: 7,
      anomalyCount: 3,
      droppedMetrics: 2,
      droppedAnomalies: 1,
    },
  });
  const monotonicValues = [100, 112.5];

  startSchedulerObservationService({
    config: { enabled: true, flushIntervalMs: 1000 },
    aggregator,
    flushSnapshot() {},
    now: () => Date.parse('2026-07-15T08:00:00.000Z'),
    monotonicNow: () => monotonicValues.shift(),
    ...timers,
  });
  timers.intervals[0].callback();
  await drainAsyncWork();

  const health = getSchedulerObservationHealth();
  assert.equal(health.lastFlushAt, '2026-07-15T08:00:00.000Z');
  assert.equal(health.lastFlushDurationMs, 12.5);
  assert.equal(health.flushErrors, 0);
  assert.equal(health.metricKeys, 7);
  assert.equal(health.anomalyCount, 3);
  assert.equal(health.droppedMetrics, 2);
  assert.equal(health.droppedAnomalies, 1);
});

for (const [name, createFailure] of [
  ['synchronous repository throw', () => () => { throw new Error('sync write failed'); }],
  ['asynchronous repository rejection', () => async () => { throw new Error('async write failed'); }],
]) {
  test(`${name} is swallowed and restores the exact snapshot once`, async () => {
    const timers = createTimerHarness();
    const pendingSnapshot = commandSnapshot('failing-command');
    const { aggregator, calls } = createAggregator({ snapshots: [pendingSnapshot] });

    startSchedulerObservationService({
      config: { enabled: true, flushIntervalMs: 1000 },
      aggregator,
      flushSnapshot: createFailure(),
      ...timers,
    });

    assert.doesNotThrow(() => timers.intervals[0].callback());
    await drainAsyncWork();
    assert.equal(getSchedulerObservationHealth().flushErrors, 1);
    assert.equal(calls.mergeSnapshot.length, 1);
    assert.strictEqual(calls.mergeSnapshot[0], pendingSnapshot);
  });
}

test('merge failure is swallowed and visible in health', async () => {
  const timers = createTimerHarness();
  const { aggregator, calls } = createAggregator({
    snapshots: [commandSnapshot()],
    overrides: {
      mergeSnapshot(value) {
        calls.mergeSnapshot.push(value);
        throw new Error('merge failed');
      },
    },
  });

  startSchedulerObservationService({
    config: { enabled: true, flushIntervalMs: 1000 },
    aggregator,
    flushSnapshot: () => Promise.reject(new Error('write failed')),
    ...timers,
  });

  assert.doesNotThrow(() => timers.intervals[0].callback());
  await drainAsyncWork();
  const health = getSchedulerObservationHealth();
  assert.equal(health.flushErrors, 1);
  assert.equal(health.mergeErrors, 1);
  assert.equal(calls.mergeSnapshot.length, 1);
});

test('mergeSnapshot false retains one retry snapshot until a later tick persists it', async () => {
  const timers = createTimerHarness();
  const failedSnapshot = commandSnapshot('retry-first');
  const laterSnapshot = commandSnapshot('aggregator-later');
  const { aggregator, calls } = createAggregator({
    snapshots: [failedSnapshot, laterSnapshot],
    overrides: {
      mergeSnapshot(value) {
        calls.mergeSnapshot.push(value);
        return false;
      },
    },
  });
  const repositoryCalls = [];

  startSchedulerObservationService({
    config: { enabled: true, flushIntervalMs: 1000 },
    aggregator,
    async flushSnapshot(value) {
      repositoryCalls.push(value);
      if (repositoryCalls.length <= 2) throw new Error('repository unavailable');
    },
    ...timers,
  });

  timers.intervals[0].callback();
  await drainAsyncWork();
  assert.equal(getSchedulerObservationHealth().flushErrors, 1);
  assert.equal(getSchedulerObservationHealth().mergeErrors, 1);
  assert.equal(getSchedulerObservationHealth().pendingRetrySnapshots, 1);
  assert.equal(calls.takeSnapshot, 1);
  assert.deepEqual(calls.mergeSnapshot, [failedSnapshot]);

  timers.intervals[0].callback();
  await drainAsyncWork();
  assert.equal(repositoryCalls.length, 2);
  assert.strictEqual(repositoryCalls[0], failedSnapshot);
  assert.strictEqual(repositoryCalls[1], failedSnapshot);
  assert.equal(calls.takeSnapshot, 1);
  assert.deepEqual(calls.mergeSnapshot, [failedSnapshot]);
  assert.equal(getSchedulerObservationHealth().pendingRetrySnapshots, 1);

  timers.intervals[0].callback();
  await drainAsyncWork();
  assert.equal(getSchedulerObservationHealth().pendingRetrySnapshots, 0);
  assert.equal(calls.takeSnapshot, 1);

  timers.intervals[0].callback();
  await drainAsyncWork();
  assert.equal(repositoryCalls.length, 4);
  assert.strictEqual(repositoryCalls[3], laterSnapshot);
  assert.equal(calls.takeSnapshot, 2);
});

test('ticks do not overlap a pending flush and later data flushes on the next tick', async () => {
  const timers = createTimerHarness();
  const firstWrite = deferred();
  const { aggregator, calls } = createAggregator({
    snapshots: [commandSnapshot('first'), commandSnapshot('second')],
  });
  const flushed = [];

  startSchedulerObservationService({
    config: { enabled: true, flushIntervalMs: 1000 },
    aggregator,
    flushSnapshot(value) {
      flushed.push(value);
      return flushed.length === 1 ? firstWrite.promise : undefined;
    },
    ...timers,
  });

  timers.intervals[0].callback();
  timers.intervals[0].callback();
  await drainAsyncWork();
  assert.equal(calls.takeSnapshot, 1);
  assert.equal(flushed.length, 1);
  assert.equal(getSchedulerObservationHealth().flushing, true);

  firstWrite.resolve();
  await drainAsyncWork();
  timers.intervals[0].callback();
  await drainAsyncWork();
  assert.equal(calls.takeSnapshot, 2);
  assert.equal(flushed.length, 2);
});

test('stop with flush clears the timer, awaits in-flight work, and flushes remaining data once', async () => {
  const timers = createTimerHarness();
  const firstWrite = deferred();
  const { aggregator } = createAggregator({
    snapshots: [commandSnapshot('in-flight'), commandSnapshot('final'), snapshot()],
  });
  const flushed = [];

  startSchedulerObservationService({
    config: { enabled: true, flushIntervalMs: 1000 },
    aggregator,
    flushSnapshot(value) {
      flushed.push(value);
      return flushed.length === 1 ? firstWrite.promise : undefined;
    },
    ...timers,
  });
  timers.intervals[0].callback();
  await drainAsyncWork();

  let stopped = false;
  const stopping = stopSchedulerObservationService().then(() => { stopped = true; });
  assert.equal(timers.cleared.length, 1);
  await drainAsyncWork();
  assert.equal(stopped, false);
  assert.equal(flushed.length, 1);

  firstWrite.resolve();
  await stopping;
  assert.equal(flushed.length, 2);
  await stopSchedulerObservationService();
  assert.equal(timers.cleared.length, 1);
  assert.equal(flushed.length, 2);
});

test('stop retries a retained snapshot before one final aggregator snapshot and bounds a second failure', async () => {
  const timers = createTimerHarness();
  const retainedSnapshot = commandSnapshot('retained-first');
  const finalSnapshot = commandSnapshot('final-second');
  const { aggregator, calls } = createAggregator({
    snapshots: [retainedSnapshot, finalSnapshot],
    overrides: {
      mergeSnapshot(value) {
        calls.mergeSnapshot.push(value);
        return false;
      },
    },
  });
  const repositoryCalls = [];
  startSchedulerObservationService({
    config: { enabled: true, flushIntervalMs: 1000 },
    aggregator,
    async flushSnapshot(value) {
      repositoryCalls.push(value);
      throw new Error('repository remains unavailable');
    },
    ...timers,
  });

  timers.intervals[0].callback();
  await drainAsyncWork();
  assert.equal(getSchedulerObservationHealth().pendingRetrySnapshots, 1);

  await assert.doesNotReject(stopSchedulerObservationService());
  assert.deepEqual(repositoryCalls, [retainedSnapshot, retainedSnapshot, finalSnapshot]);
  assert.deepEqual(calls.mergeSnapshot, [retainedSnapshot, finalSnapshot]);
  const health = getSchedulerObservationHealth();
  assert.equal(health.pendingRetrySnapshots, 1);
  assert.equal(health.droppedRetrySnapshots, 1);
  assert.equal(health.flushErrors, 3);
  assert.equal(health.mergeErrors, 2);
});

test('stop without flush never drains buffered observations', async () => {
  const timers = createTimerHarness();
  const { aggregator, calls } = createAggregator({ snapshots: [commandSnapshot()] });
  let flushCalls = 0;
  startSchedulerObservationService({
    config: { enabled: true, flushIntervalMs: 1000 },
    aggregator,
    flushSnapshot() { flushCalls += 1; },
    ...timers,
  });

  await stopSchedulerObservationService({ flush: false });
  assert.equal(timers.cleared.length, 1);
  assert.equal(calls.takeSnapshot, 0);
  assert.equal(flushCalls, 0);
});

test('stop treats a throwing options getter as flush true and always returns a resolving Promise', async () => {
  const timers = createTimerHarness();
  const { aggregator } = createAggregator({ snapshots: [commandSnapshot('malicious-stop')] });
  const flushed = [];
  startSchedulerObservationService({
    config: { enabled: true, flushIntervalMs: 1000 },
    aggregator,
    flushSnapshot(value) { flushed.push(value); },
    ...timers,
  });
  const maliciousOptions = new Proxy({}, {
    get() { throw new Error('options getter failed'); },
  });

  let stopping;
  assert.doesNotThrow(() => {
    stopping = stopSchedulerObservationService(maliciousOptions);
  });
  assert.equal(typeof stopping?.then, 'function');
  await assert.doesNotReject(stopping);
  assert.equal(flushed.length, 1);
});

test('all observation and health entry points swallow malicious getters and dependency errors', () => {
  const timers = createTimerHarness();
  const maliciousEvent = new Proxy({}, {
    get() { throw new Error('malicious getter'); },
  });
  const { aggregator } = createAggregator({
    overrides: {
      recordCommand() { throw new Error('record command failed'); },
      recordTask() { throw new Error('record task failed'); },
      recordAnomaly() { throw new Error('record anomaly failed'); },
      getHealth() { throw new Error('health failed'); },
    },
  });
  startSchedulerObservationService({
    config: { enabled: true, flushIntervalMs: 1000 },
    aggregator,
    flushSnapshot() {},
    ...timers,
  });

  assert.doesNotThrow(() => observeCommandSent(maliciousEvent));
  assert.doesNotThrow(() => observeCommandSettled(maliciousEvent));
  assert.doesNotThrow(() => observeTaskSettled(maliciousEvent));
  assert.doesNotThrow(() => observeAccountQueue(maliciousEvent));
  assert.doesNotThrow(() => getSchedulerObservationHealth());
  assert.equal(observeCommandSent({ command: 'throws' }), false);
  assert.equal(observeTaskSettled({ taskType: 'throws' }), false);
});

test('command and task mappings classify failures, emit only approved sanitized anomalies, and skip fast success anomalies', () => {
  const timers = createTimerHarness();
  const { aggregator, calls } = createAggregator();
  startSchedulerObservationService({
    config: { enabled: true, flushIntervalMs: 1000, slowCommandMs: 5000 },
    aggregator,
    flushSnapshot() {},
    ...timers,
  });

  assert.equal(observeCommandSent({
    command: 'role:info:get',
    accountId: 9,
    runId: 'run-9',
    params: { token: 'sent-secret' },
  }), true);
  assert.equal(calls.recordCommand[0].outcome, 'sent');

  const outcomes = [
    ['rate_limited', { outcome: 'rate_limited' }],
    ['timeout', { timeout: true }],
    ['disconnected', { disconnected: true }],
    ['error', {}],
  ];
  for (const [expected, extra] of outcomes) {
    observeCommandSettled({
      command: `command:${expected}`,
      accountId: 9,
      runId: 'run-9',
      latencyMs: 25,
      error: new Error(`token=${expected}-secret body=private`),
      params: { token: `${expected}-params-secret` },
      response: { body: `${expected}-response-secret` },
      ...extra,
    });
  }
  observeCommandSettled({
    command: 'command:slow-success',
    outcome: 'success',
    latencyMs: 5000,
  });
  observeCommandSettled({
    command: 'command:fast-success',
    outcome: 'success',
    latencyMs: 4999,
  });
  observeTaskSettled({
    taskType: 'DAILY_SIGN_IN',
    outcome: 'success',
    durationMs: 123,
    accountId: 9,
  });

  assert.deepEqual(
    calls.recordCommand.slice(1).map((event) => event.outcome),
    ['rate_limited', 'timeout', 'disconnected', 'error', 'success', 'success'],
  );
  assert.equal(calls.recordAnomaly.length, 5);
  assert.equal(calls.recordTask.length, 1);
  assert.equal(calls.recordTask[0].task, 'DAILY_SIGN_IN');
  for (const anomaly of calls.recordAnomaly) {
    assert.deepEqual(Object.keys(anomaly).sort(), ['dimensions', 'message', 'type']);
    assert.match(anomaly.message, /\[REDACTED\]|slow command/);
    const serialized = JSON.stringify(anomaly);
    assert.doesNotMatch(serialized, /-secret|private|params-secret|response-secret/);
    assert.doesNotMatch(serialized, /params|response|body|stack/);
  }
});

test('rate-limited anomalies normalize error codes by the approved priority without retaining errors', () => {
  const timers = createTimerHarness();
  const { aggregator, calls } = createAggregator();
  startSchedulerObservationService({
    config: { enabled: true, flushIntervalMs: 1000, slowCommandMs: 5000 },
    aggregator,
    flushSnapshot() {},
    ...timers,
  });

  observeCommandSettled({
    command: 'root-error-code',
    errorCode: '200400',
    code: '12400000',
    error: Object.assign(new Error('limited'), { errorCode: 9, code: 10 }),
  });
  observeCommandSettled({
    command: 'root-code',
    code: '12400000',
    error: Object.assign(new Error('limited'), { errorCode: 11, code: 12 }),
  });
  observeCommandSettled({
    command: 'nested-error-code',
    error: Object.assign(new Error('limited'), { errorCode: '200400', code: '12400000' }),
  });
  observeCommandSettled({
    command: 'nested-code',
    error: Object.assign(new Error('limited'), { code: '12400000' }),
  });

  assert.deepEqual(calls.recordCommand.map((event) => event.outcome), [
    'rate_limited',
    'rate_limited',
    'rate_limited',
    'rate_limited',
  ]);
  assert.deepEqual(
    calls.recordAnomaly.map((anomaly) => anomaly.dimensions.errorCode),
    [200400, 12400000, 200400, 12400000],
  );
  for (const anomaly of calls.recordAnomaly) {
    assert.equal(Number.isInteger(anomaly.dimensions.errorCode), true);
    assert.equal(Object.hasOwn(anomaly, 'error'), false);
    assert.equal(Object.hasOwn(anomaly, 'stack'), false);
    assert.doesNotMatch(JSON.stringify(anomaly), /"error"|"stack"/);
  }
});

test('account queue waits are bounded, do not create runs, and merge once into matching tasks', () => {
  const timers = createTimerHarness();
  const { aggregator, calls } = createAggregator();
  startSchedulerObservationService({
    config: {
      enabled: true,
      flushIntervalMs: 1000,
      slowCommandMs: 5000,
      maxMetricKeys: 2,
    },
    aggregator,
    flushSnapshot() {},
    ...timers,
  });

  assert.equal(observeAccountQueue({ queueWaitMs: 1 }), false);
  assert.equal(observeAccountQueue({ accountId: 1, queueWaitMs: 10 }), true);
  assert.equal(observeAccountQueue({ runId: 'run-2', queueWaitMs: 20 }), true);
  assert.equal(observeAccountQueue({ accountId: 3, runId: 'run-3', queueWaitMs: 30 }), true);
  assert.equal(calls.recordTask.length, 0);

  observeTaskSettled({ accountId: 1, taskType: 'evicted', outcome: 'success' });
  observeTaskSettled({ runId: 'run-2', taskType: 'run-match', outcome: 'success' });
  observeTaskSettled({
    accountId: 3,
    runId: 'run-3',
    taskType: 'explicit-wins',
    outcome: 'success',
    queueWaitMs: 99,
  });
  observeTaskSettled({
    accountId: 3,
    runId: 'run-3',
    taskType: 'deleted-after-merge',
    outcome: 'success',
  });

  assert.equal(calls.recordTask[0].queueWaitMs, undefined);
  assert.equal(calls.recordTask[1].queueWaitMs, 20);
  assert.equal(calls.recordTask[2].queueWaitMs, 99);
  assert.equal(calls.recordTask[3].queueWaitMs, undefined);
  const health = getSchedulerObservationHealth();
  assert.equal(health.pendingQueueWaits, 0);
  assert.equal(health.droppedQueueWaits, 1);
});

test('observability config defaults locally and clamps finite bounds while falling back for NaN', async () => {
  const originalNodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = 'test';
  try {
    for (const name of CONFIG_ENV_NAMES) delete process.env[name];
    let imported = await importFreshConfig();
    assert.equal(imported.config.observability.enabled, false);
    assert.equal(imported.config.observability.retentionDays, 3);
    assert.equal(imported.config.observability.flushIntervalMs, 10000);

    process.env.SCHEDULER_OBSERVABILITY_ENABLED = '1';
    process.env.SCHEDULER_OBSERVABILITY_FLUSH_INTERVAL_MS = '10';
    process.env.SCHEDULER_OBSERVABILITY_SLOW_COMMAND_MS = '999999';
    process.env.SCHEDULER_OBSERVABILITY_RETENTION_DAYS = '999';
    process.env.SCHEDULER_OBSERVABILITY_MAX_METRIC_KEYS = 'not-a-number';
    process.env.SCHEDULER_OBSERVABILITY_MAX_ANOMALY_BUFFER = '1';
    process.env.SCHEDULER_OBSERVABILITY_MAX_ANOMALY_ROWS = '999999';
    imported = await importFreshConfig();
    assert.deepEqual(imported.config.observability, {
      enabled: true,
      flushIntervalMs: 1000,
      slowCommandMs: 30000,
      retentionDays: 3,
      maxMetricKeys: 20000,
      maxAnomalyBuffer: 100,
      maxAnomalyRows: 50000,
    });
  } finally {
    if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalNodeEnv;
  }
});
