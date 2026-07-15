import test from 'node:test';
import assert from 'node:assert/strict';

import statsRouter, {
  buildSchedulerObservabilitySummary,
  createSchedulerObservabilityHandlers,
  normalizeObservabilityQuery,
  serializeSchedulerAnomalies,
} from '../src/routes/stats.js';
import { adminOnly, authMiddleware } from '../src/middleware/auth.js';

const FIXED_NOW = '2026-07-15T12:00:00.000Z';

function responseRecorder() {
  return {
    statusCode: 200,
    body: undefined,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
}

async function runMiddlewareChain(middleware, req, res) {
  let index = 0;
  const dispatch = async () => {
    const handler = middleware[index++];
    if (!handler) return;
    let nextPromise;
    const next = () => {
      nextPromise = dispatch();
      return nextPromise;
    };
    await handler(req, res, next);
    if (nextPromise) await nextPromise;
  };
  await dispatch();
}

test('normalizes fixed ranges to exact server-generated ISO cutoffs', () => {
  const expected = new Map([
    ['1h', '2026-07-15T11:00:00.000Z'],
    ['6h', '2026-07-15T06:00:00.000Z'],
    ['24h', '2026-07-14T12:00:00.000Z'],
    ['3d', '2026-07-12T12:00:00.000Z'],
  ]);

  for (const [range, cutoff] of expected) {
    assert.deepEqual(
      normalizeObservabilityQuery({ range }, { now: () => FIXED_NOW }),
      {
        ok: true,
        value: {
          range,
          generatedAt: FIXED_NOW,
          cutoff,
          page: 1,
          pageSize: 25,
        },
      },
    );
  }

  assert.equal(
    normalizeObservabilityQuery({}, { now: () => FIXED_NOW }).value.range,
    '24h',
  );
});

test('rejects invalid range values and malicious getters without throwing', () => {
  for (const range of ['5m', '', ['24h'], { value: '24h' }]) {
    const normalized = normalizeObservabilityQuery({ range }, { now: () => FIXED_NOW });
    assert.equal(normalized.ok, false);
  }

  const query = {};
  Object.defineProperty(query, 'range', {
    get() {
      throw new Error('getter secret');
    },
  });
  assert.doesNotThrow(() => normalizeObservabilityQuery(query, { now: () => FIXED_NOW }));
  assert.equal(normalizeObservabilityQuery(query, { now: () => FIXED_NOW }).ok, false);
});

test('normalizes pagination and exposes only safe fixed filters', () => {
  assert.deepEqual(
    normalizeObservabilityQuery({
      range: '6h',
      page: '-8',
      pageSize: '999',
      category: 'command_timeout',
      source: 'batch',
      taskType: 'DAILY_TASK',
      commandClass: 'game.read',
      egressType: 'proxy',
      cutoff: '1970-01-01T00:00:00.000Z',
      sort: 'id DESC',
      column: 'stack',
      sql: 'OR 1=1',
      time: "datetime('now')",
    }, { now: () => FIXED_NOW }),
    {
      ok: true,
      value: {
        range: '6h',
        generatedAt: FIXED_NOW,
        cutoff: '2026-07-15T06:00:00.000Z',
        page: 1,
        pageSize: 100,
        category: 'command_timeout',
        source: 'batch',
        taskType: 'DAILY_TASK',
        commandClass: 'game.read',
        egressType: 'proxy',
      },
    },
  );

  const defaults = normalizeObservabilityQuery({ page: 'wat', pageSize: {} }, {
    now: () => FIXED_NOW,
  });
  assert.equal(defaults.value.page, 1);
  assert.equal(defaults.value.pageSize, 25);

  for (const unsafe of [
    { category: "timeout' OR 1=1 --" },
    { source: ['batch'] },
    { taskType: { value: 'DAILY_TASK' } },
    { commandClass: ['game.read'] },
    { commandClass: { value: 'game.read' } },
    { egressType: 'http://127.0.0.1:8080' },
  ]) {
    assert.equal(
      normalizeObservabilityQuery(unsafe, { now: () => FIXED_NOW }).ok,
      false,
    );
  }
});

test('builds the exact summary shape with deterministic bucket, task, and egress aggregates', () => {
  const raw = {
    commandMetrics: [
      {
        bucket_minute: '2026-07-15T11:58:00.000Z',
        task_type: 'DAILY',
        egress_type: 'direct',
        egress_key: 'direct',
        command_count: 10,
        error_count: 2,
        timeout_count: 1,
        disconnected_count: 0,
        rate_limited_count: 1,
        latency_count: 8,
        latency_sum_ms: 400,
        latency_max_ms: 100,
      },
      {
        bucket_minute: '2026-07-15T11:58:00.000Z',
        task_type: 'DAILY',
        egress_type: 'proxy',
        egress_key: 'proxy:012345abcdef',
        command_count: 5,
        error_count: 0,
        timeout_count: 0,
        disconnected_count: 0,
        rate_limited_count: 0,
        latency_count: 2,
        latency_sum_ms: 200,
        latency_max_ms: 150,
      },
      {
        bucket_minute: '2026-07-15T11:59:00.000Z',
        task_type: 'OTHER',
        egress_type: 'direct',
        egress_key: 'direct',
        command_count: 4,
        error_count: Number.POSITIVE_INFINITY,
        timeout_count: -1,
        disconnected_count: 0,
        rate_limited_count: 0,
        latency_count: 0,
        latency_sum_ms: 50,
        latency_max_ms: 80,
      },
    ],
    taskMetrics: [
      {
        bucket_minute: '2026-07-15T11:58:00.000Z',
        task_type: 'DAILY',
        outcome: 'success',
        run_count: 2,
        duration_count: 2,
        duration_sum_ms: 1000,
        duration_max_ms: 700,
        queue_wait_count: 2,
        queue_wait_sum_ms: 100,
        queue_wait_max_ms: 80,
        attributed_command_count: 12,
      },
      {
        bucket_minute: '2026-07-15T11:59:00.000Z',
        task_type: 'DAILY',
        outcome: 'error',
        run_count: 1,
        duration_count: 1,
        duration_sum_ms: 800,
        duration_max_ms: 800,
        queue_wait_count: 1,
        queue_wait_sum_ms: 200,
        queue_wait_max_ms: 200,
        attributed_command_count: 7,
      },
      {
        bucket_minute: '2026-07-15T11:59:00.000Z',
        task_type: 'EMPTY',
        outcome: 'success',
        run_count: 0,
        duration_count: 0,
        duration_sum_ms: Number.POSITIVE_INFINITY,
        duration_max_ms: -10,
        queue_wait_count: 0,
        queue_wait_sum_ms: 10,
        queue_wait_max_ms: Number.NaN,
        attributed_command_count: 0,
      },
    ],
  };
  const health = {
    enabled: true,
    started: true,
    flushErrors: 2,
    retrySnapshot: { token: 'must-not-leak' },
    pendingRetrySnapshots: 1,
  };

  const data = buildSchedulerObservabilitySummary(raw, {
    range: '1h',
    generatedAt: FIXED_NOW,
    health,
  });

  assert.deepEqual(Object.keys(data), [
    'range',
    'generatedAt',
    'headline',
    'series',
    'tasks',
    'egresses',
    'health',
  ]);
  assert.deepEqual(data.headline, {
    currentCommandRate: 4,
    peakCommandRate: 15,
    rateLimitedCount: 1,
    timeoutCount: 1,
    averageLatencyMs: 60,
    maxQueueWaitMs: 200,
    commandCount: 19,
    taskCount: 3,
    commandErrorRate: 0.1053,
    commandAmplification: 6.3333,
  });
  assert.deepEqual(data.series.map((row) => [row.bucket, row.commandCount, row.taskCount]), [
    ['2026-07-15T11:58:00.000Z', 15, 2],
    ['2026-07-15T11:59:00.000Z', 4, 1],
  ]);
  assert.deepEqual(data.tasks.find((row) => row.taskType === 'DAILY'), {
    taskType: 'DAILY',
    runCount: 3,
    errorCount: 1,
    timeoutCount: 0,
    averageDurationMs: 600,
    maxDurationMs: 800,
    averageQueueWaitMs: 100,
    maxQueueWaitMs: 200,
    attributedCommandCount: 19,
    commandCount: 15,
    errorRate: 0.3333,
    commandAmplification: 5,
  });
  assert.deepEqual(data.egresses.map((row) => [row.type, row.key, row.commandCount]), [
    ['direct', 'direct', 14],
    ['proxy', 'proxy:012345abcdef', 5],
  ]);
  assert.deepEqual(data.health, {
    enabled: true,
    started: true,
    flushErrors: 2,
  });
  assert.doesNotMatch(JSON.stringify(data), /NaN|Infinity|must-not-leak|retrySnapshot/);
});

test('serializes anomaly results with an allowlist and fail-closed sensitive/network redaction', () => {
  const data = serializeSchedulerAnomalies({
    items: [
      {
        id: 7,
        occurred_at: '2026-07-15T11:59:00.000Z',
        run_id: 'run-7',
        account_id: 3,
        batch_task_id: 9,
        source: 'http://alice:pw@source.example:8080/private',
        task_type: 'DAILY',
        command: 'role:info',
        execution_lane: 'proxy',
        egress_type: 'proxy',
        egress_key: 'proxy:012345abcdef',
        category: 'command_timeout',
        error_code: 504,
        latency_ms: 8000,
        queue_wait_ms: 40,
        summary: 'token = alpha beta',
        params: 'params-secret',
        body: 'body-secret',
        token: 'token-secret',
        stack: 'stack-secret',
        proxy: 'http://raw-proxy.example:9000',
      },
      {
        occurred_at: '2026-07-15T11:58:00.000Z',
        summary: 'roleToken = alpha beta',
      },
      {
        occurred_at: '2026-07-15T11:57:00.000Z',
        summary: 'proxy=[2001:db8::1]:1080',
      },
      {
        occurred_at: '2026-07-15T11:56:00.000Z',
        summary: 'connect http://bob:secret@auth.example:8443/path',
      },
      {
        occurred_at: '2026-07-15T11:55:00.000Z',
        summary: 'connect 192.0.2.10:8080 edge.example:9000 [2001:db8::2]:443 2001:db8::3',
      },
      {
        occurred_at: '2026-07-15T11:54:00.000Z',
        summary: 'ｔｏｋｅｎ = fullwidth alpha beta',
      },
      {
        occurred_at: '2026-07-15T11:53:00.000Z',
        summary: 'connect edge.example',
      },
      {
        occurred_at: '2026-07-15T11:52:00.000Z',
        summary: 'connect edge.example/path',
      },
      {
        occurred_at: '2026-07-15T11:51:00.000Z',
        summary: 'connect 例子.测试/path',
      },
      {
        occurred_at: '2026-07-15T11:50:00.000Z',
        command: 'arena.start',
        summary: 'version 1.25',
      },
    ],
    total: 10,
    page: 2,
    pageSize: 10,
  });

  assert.deepEqual(Object.keys(data), ['items', 'total', 'page', 'pageSize']);
  assert.deepEqual(Object.keys(data.items[0]), [
    'id',
    'occurredAt',
    'runId',
    'accountId',
    'batchTaskId',
    'source',
    'taskType',
    'command',
    'executionLane',
    'egressType',
    'egressKey',
    'category',
    'errorCode',
    'latencyMs',
    'queueWaitMs',
    'summary',
  ]);
  assert.equal(data.items[0].source, '[REDACTED]');
  assert.equal(data.items[0].executionLane, 'proxy');
  assert.equal(data.items[0].egressType, 'proxy');
  assert.equal(data.items[0].egressKey, 'proxy:012345abcdef');
  assert.equal(data.items[6].summary, 'connect [REDACTED]');
  assert.equal(data.items[7].summary, 'connect [REDACTED]');
  assert.equal(data.items[8].summary, 'connect [REDACTED]');
  assert.equal(data.items[9].command, 'arena.start');
  assert.equal(data.items[9].summary, 'version 1.25');
  const serialized = JSON.stringify(data);
  for (const secret of [
    'alpha',
    'beta',
    'fullwidth',
    '192.0.2.10',
    '2001:db8::1',
    '2001:db8::2',
    '2001:db8::3',
    'edge.example',
    'auth.example',
    'source.example',
    '例子',
    '测试',
    'alice:pw',
    'bob:secret',
    'params-secret',
    'body-secret',
    'token-secret',
    'stack-secret',
    'raw-proxy.example',
  ]) {
    assert.equal(serialized.includes(secret), false, secret);
  }
  for (const forbiddenField of ['"params":', '"body":', '"token":', '"stack":', '"proxy":']) {
    assert.equal(serialized.includes(forbiddenField), false, forbiddenField);
  }
});

test('invalid queries return 400 without entering the repository', async () => {
  let calls = 0;
  const handlers = createSchedulerObservabilityHandlers({
    querySummary() {
      calls += 1;
      return { commandMetrics: [], taskMetrics: [] };
    },
    queryAnomalies() {
      calls += 1;
      return { items: [], total: 0, page: 1, pageSize: 25 };
    },
    getHealth: () => ({}),
    now: () => FIXED_NOW,
  });
  const summaryRes = responseRecorder();
  await handlers.summary({ query: { range: ['24h'] } }, summaryRes);
  assert.equal(summaryRes.statusCode, 400);
  const anomalyRes = responseRecorder();
  await handlers.anomalies({ query: { category: "x' OR 1=1 --" } }, anomalyRes);
  assert.equal(anomalyRes.statusCode, 400);
  assert.equal(calls, 0);
});

test('handlers pass only endpoint-approved normalized repository filters and return exact success envelopes', async () => {
  const calls = [];
  const handlers = createSchedulerObservabilityHandlers({
    querySummary(filters) {
      calls.push(['summary', filters]);
      return { commandMetrics: [], taskMetrics: [] };
    },
    async queryAnomalies(filters) {
      calls.push(['anomalies', filters]);
      return { items: [], total: 0, page: filters.page, pageSize: filters.pageSize };
    },
    getHealth: async () => ({ enabled: true, started: true }),
    now: () => FIXED_NOW,
  });

  const summaryRes = responseRecorder();
  await handlers.summary({
    query: {
      range: '1h',
      commandClass: 'game.read',
      cutoff: 'evil',
      sort: 'evil',
    },
  }, summaryRes);
  assert.equal(summaryRes.statusCode, 200);
  assert.deepEqual(Object.keys(summaryRes.body), ['success', 'data']);
  assert.deepEqual(Object.keys(summaryRes.body.data), [
    'range', 'generatedAt', 'headline', 'series', 'tasks', 'egresses', 'health',
  ]);
  assert.deepEqual(calls[0], ['summary', {
    cutoff: '2026-07-15T11:00:00.000Z',
    commandClass: 'game.read',
  }]);

  const anomalyRes = responseRecorder();
  await handlers.anomalies({
    query: {
      range: '3d',
      page: '2',
      pageSize: '10',
      source: 'batch',
      commandClass: 'game.write',
      sort: 'id DESC',
      cutoff: 'evil',
    },
  }, anomalyRes);
  assert.equal(anomalyRes.statusCode, 200);
  assert.deepEqual(anomalyRes.body, {
    success: true,
    data: { items: [], total: 0, page: 2, pageSize: 10 },
  });
  assert.deepEqual(calls[1], ['anomalies', {
    cutoff: '2026-07-12T12:00:00.000Z',
    page: 2,
    pageSize: 10,
    source: 'batch',
  }]);
});

test('invalid summary commandClass returns 400 without entering the repository', async () => {
  let calls = 0;
  const handlers = createSchedulerObservabilityHandlers({
    querySummary() {
      calls += 1;
      return { commandMetrics: [], taskMetrics: [] };
    },
    queryAnomalies: () => ({ items: [], total: 0, page: 1, pageSize: 25 }),
    getHealth: () => ({}),
    now: () => FIXED_NOW,
  });

  for (const commandClass of [['game.read'], { value: 'game.read' }]) {
    const res = responseRecorder();
    await handlers.summary({ query: { commandClass } }, res);
    assert.equal(res.statusCode, 400);
  }
  assert.equal(calls, 0);
});

test('synchronous throws and asynchronous rejects return safe 500 responses', async () => {
  for (const failure of [
    () => {
      throw new Error('SELECT token, stack FROM secrets');
    },
    () => Promise.reject(new Error('SQL proxy password at 10.0.0.1:8080')),
  ]) {
    const handlers = createSchedulerObservabilityHandlers({
      querySummary: failure,
      queryAnomalies: failure,
      getHealth: () => ({ enabled: true }),
      now: () => FIXED_NOW,
    });
    for (const name of ['summary', 'anomalies']) {
      const res = responseRecorder();
      await handlers[name]({ query: {} }, res);
      assert.equal(res.statusCode, 500);
      assert.deepEqual(res.body, {
        success: false,
        error: `Failed to fetch scheduler observability ${name}`,
      });
      assert.doesNotMatch(JSON.stringify(res.body), /SELECT|token|stack|password|10\.0\.0\.1/);
    }
  }

  const handlers = createSchedulerObservabilityHandlers({
    querySummary: () => ({ commandMetrics: [], taskMetrics: [] }),
    queryAnomalies: () => ({ items: [], total: 0, page: 1, pageSize: 25 }),
    getHealth: () => Promise.reject(new Error('retry snapshot token secret')),
    now: () => FIXED_NOW,
  });
  const res = responseRecorder();
  await handlers.summary({ query: {} }, res);
  assert.equal(res.statusCode, 500);
  assert.deepEqual(res.body, {
    success: false,
    error: 'Failed to fetch scheduler observability summary',
  });
});

test('new routes require authentication and admin while existing stats permissions stay unchanged', async () => {
  const globalAuthLayer = statsRouter.stack.find((layer) => layer.name === 'authMiddleware');
  assert.equal(globalAuthLayer?.handle, authMiddleware);

  const routeLayers = new Map(
    statsRouter.stack
      .filter((layer) => layer.route)
      .map((layer) => [layer.route.path, layer.route.stack.map((entry) => entry.handle)]),
  );
  for (const path of ['/observability/summary', '/observability/anomalies']) {
    assert.equal(routeLayers.get(path)?.[0], adminOnly, path);
  }
  for (const path of ['/overview', '/system-status', '/task-summary', '/recent-activities']) {
    assert.equal(routeLayers.get(path)?.includes(adminOnly), false, path);
  }

  const unauthenticatedRes = responseRecorder();
  await runMiddlewareChain([authMiddleware], { headers: {} }, unauthenticatedRes);
  assert.equal(unauthenticatedRes.statusCode, 401);

  const ordinaryRes = responseRecorder();
  await runMiddlewareChain([adminOnly], { user: { role: 'user' } }, ordinaryRes);
  assert.equal(ordinaryRes.statusCode, 403);

  const adminHandlers = createSchedulerObservabilityHandlers({
    querySummary: () => ({ commandMetrics: [], taskMetrics: [] }),
    queryAnomalies: () => ({ items: [], total: 0, page: 1, pageSize: 25 }),
    getHealth: () => ({ enabled: true }),
    now: () => FIXED_NOW,
  });
  const adminRes = responseRecorder();
  await runMiddlewareChain(
    [adminOnly, adminHandlers.summary],
    { user: { role: 'admin' }, query: {} },
    adminRes,
  );
  assert.equal(adminRes.statusCode, 200);
});
