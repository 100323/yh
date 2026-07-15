import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  OBSERVABILITY_RANGE_OPTIONS,
  buildSchedulerObservabilityViewModel,
  buildTrendBars,
  formatAmplification,
  formatAnomalyCategory,
  formatEgressLabel,
  formatMetricDuration,
} from '../src/utils/schedulerObservabilityViewModel.js';

test('maps complete scheduler observability API fixtures without mutating inputs', () => {
  const summary = {
    range: '6h',
    generatedAt: '2026-07-15T12:00:00.000Z',
    headline: {
      currentCommandRate: 7,
      peakCommandRate: 19,
      rateLimitedCount: 3,
      timeoutCount: 2,
      averageLatencyMs: 1250,
      maxQueueWaitMs: 480,
      commandCount: 36,
      taskCount: 6,
      commandErrorRate: 0.0833,
      commandAmplification: 6,
    },
    series: [
      { bucket: '2026-07-15T11:59:00.000Z', commandCount: 19 },
      { bucket: '2026-07-15T11:58:00.000Z', commandCount: 9 },
      { bucket: '2026-07-15T11:59:00.000Z', commandCount: 8 },
    ],
    tasks: [{
      taskType: 'DAILY_TASK',
      runCount: 6,
      errorCount: 1,
      timeoutCount: 1,
      averageDurationMs: 1250,
      maxDurationMs: 2800,
      averageQueueWaitMs: 120,
      maxQueueWaitMs: 480,
      attributedCommandCount: 34,
      commandCount: 36,
      errorRate: 0.1667,
      commandAmplification: 6,
    }],
    egresses: [{
      type: 'proxy',
      key: 'proxy:012345abcdef',
      commandCount: 31,
      errorCount: 2,
      timeoutCount: 2,
      disconnectedCount: 1,
      rateLimitedCount: 3,
      averageLatencyMs: 880,
      maxLatencyMs: 2200,
      errorRate: 0.0645,
    }],
    health: {
      enabled: true,
      started: true,
      lastFlushAt: '2026-07-15T11:59:55.000Z',
      lastFlushDurationMs: 42,
      flushErrors: 1,
      mergeErrors: 2,
      droppedRetrySnapshots: 3,
      observationErrors: 4,
      healthErrors: 5,
      pendingQueueWaits: 6,
      droppedQueueWaits: 7,
      metricKeys: 8,
      anomalyCount: 9,
      droppedMetrics: 10,
      droppedAnomalies: 11,
    },
  };
  const anomalies = {
    items: [{
      id: 91,
      occurredAt: '2026-07-15T11:59:40.000Z',
      runId: 'run-91',
      accountId: 12,
      batchTaskId: 8,
      source: 'scheduler',
      taskType: 'DAILY_TASK',
      command: 'role:info',
      executionLane: 'proxy',
      egressType: 'proxy',
      egressKey: 'proxy:012345abcdef',
      category: 'command_timeout',
      errorCode: 504,
      latencyMs: 8000,
      queueWaitMs: 45,
      summary: 'safe summary',
    }],
    total: 26,
    page: 2,
    pageSize: 25,
  };
  const summarySnapshot = structuredClone(summary);
  const anomaliesSnapshot = structuredClone(anomalies);

  const model = buildSchedulerObservabilityViewModel(summary, anomalies);

  assert.equal(model.hasSummaryData, true);
  assert.deepEqual(model.headline, [
    { key: 'currentCommandRate', label: '当前命令速率', value: 7, display: '7', unit: '命令/分钟' },
    { key: 'peakCommandRate', label: '区间峰值', value: 19, display: '19', unit: '命令/分钟' },
    { key: 'rateLimitedCount', label: '限频', value: 3, display: '3', unit: '次' },
    { key: 'timeoutCount', label: '超时', value: 2, display: '2', unit: '次' },
    { key: 'averageLatencyMs', label: '平均响应', value: 1250, display: '1.25 s', unit: '' },
    { key: 'maxQueueWaitMs', label: '最大排队', value: 480, display: '480 ms', unit: '' },
  ]);
  assert.equal(model.range, '6h');
  assert.equal(model.generatedAt, '2026-07-15T12:00:00.000Z');
  assert.deepEqual(model.totals, {
    commandCount: 36,
    taskCount: 6,
    commandErrorRate: 0.0833,
    commandAmplification: 6,
  });
  assert.deepEqual(model.trend.map(({ key, value, height }) => ({ key, value, height })), [
    { key: JSON.stringify(['2026-07-15T11:58:00.000Z', 1]), value: 9, height: 47.37 },
    { key: JSON.stringify(['2026-07-15T11:59:00.000Z', 0]), value: 19, height: 100 },
    { key: JSON.stringify(['2026-07-15T11:59:00.000Z', 2]), value: 8, height: 42.11 },
  ]);
  assert.deepEqual(model.tasks[0], {
    key: JSON.stringify(['DAILY_TASK', 0]),
    taskType: 'DAILY_TASK',
    runCount: 6,
    errorCount: 1,
    timeoutCount: 1,
    averageDurationMs: 1250,
    maxDurationMs: 2800,
    averageQueueWaitMs: 120,
    maxQueueWaitMs: 480,
    attributedCommandCount: 34,
    commandCount: 36,
    errorRate: 0.1667,
    errorRateDisplay: '16.67%',
    commandAmplification: 6,
    amplificationDisplay: '6×',
    averageDurationDisplay: '1.25 s',
    maxDurationDisplay: '2.80 s',
  });
  assert.deepEqual(model.egresses[0], {
    key: JSON.stringify(['proxy', 'proxy:012345abcdef', 0]),
    label: '匿名代理 012345abcdef',
    type: 'proxy',
    commandCount: 31,
    errorCount: 2,
    timeoutCount: 2,
    disconnectedCount: 1,
    rateLimitedCount: 3,
    averageLatencyMs: 880,
    maxLatencyMs: 2200,
    errorRate: 0.0645,
    errorRateDisplay: '6.45%',
  });
  assert.equal(model.health.status, 'degraded');
  assert.equal(model.health.statusLabel, '存在异常');
  assert.equal(model.health.lastFlushAt, '2026-07-15T11:59:55.000Z');
  assert.equal(model.health.droppedRetrySnapshots, 3);
  assert.equal(model.health.droppedAnomalies, 11);
  assert.equal(model.health.counterRows.length, 11);
  assert.deepEqual(model.anomalies, {
    items: [{
      key: JSON.stringify([91, '2026-07-15T11:59:40.000Z', 0]),
      id: 91,
      occurredAt: '2026-07-15T11:59:40.000Z',
      runId: 'run-91',
      accountId: 12,
      batchTaskId: 8,
      source: 'scheduler',
      taskType: 'DAILY_TASK',
      command: 'role:info',
      executionLane: 'proxy',
      egressType: 'proxy',
      egressKey: 'proxy:012345abcdef',
      egressLabel: '匿名代理 012345abcdef',
      category: 'command_timeout',
      categoryLabel: '请求超时',
      errorCode: 504,
      latencyMs: 8000,
      latencyDisplay: '8.00 s',
      queueWaitMs: 45,
      summary: 'safe summary',
    }],
    total: 26,
    page: 2,
    pageSize: 25,
  });
  assert.deepEqual(summary, summarySnapshot);
  assert.deepEqual(anomalies, anomaliesSnapshot);
});

test('view model fails closed for missing and dirty scheduler observability values', () => {
  const hostile = {};
  Object.defineProperty(hostile, 'headline', {
    get() {
      throw new Error('must not escape');
    },
  });

  assert.doesNotThrow(() => buildSchedulerObservabilityViewModel(hostile, hostile));
  const model = buildSchedulerObservabilityViewModel({
    generatedAt: 'not-a-date',
    headline: {
      currentCommandRate: -1,
      averageLatencyMs: Number.POSITIVE_INFINITY,
    },
    tasks: [{ taskType: 9, runCount: Number.NaN, errorRate: 4 }],
    egresses: [{ type: 'proxy', key: 'https://secret.example:8080', errorRate: -1 }],
    health: { enabled: 'true', started: null, lastFlushAt: 'bad', flushErrors: -2 },
  }, {
    items: [{
      id: -1,
      occurredAt: 'bad',
      accountId: Number.POSITIVE_INFINITY,
      category: 'secret-category',
      latencyMs: -4,
    }],
    total: -4,
    page: 0,
    pageSize: Number.NaN,
  });

  assert.equal(model.generatedAt, null);
  assert.equal(model.headline.length, 6);
  assert.equal(model.headline.every((metric) => metric.value === 0), true);
  assert.equal(model.tasks[0].taskType, '未归类');
  assert.equal(model.tasks[0].errorRate, 1);
  assert.equal(model.egresses[0].label, '未知出口');
  assert.equal(JSON.stringify(model).includes('secret.example'), false);
  assert.equal(model.health.status, 'disabled');
  assert.equal(model.health.lastFlushAt, null);
  assert.equal(model.health.flushErrors, 0);
  assert.equal(model.anomalies.page, 1);
  assert.equal(model.anomalies.pageSize, 25);
  assert.equal(model.anomalies.items[0].categoryLabel, '未知异常');
  assert.equal(model.anomalies.items[0].occurredAt, null);
  assert.equal(model.anomalies.items[0].latencyMs, 0);

  const missingModel = buildSchedulerObservabilityViewModel();
  assert.equal(missingModel.hasSummaryData, false);
  assert.equal(missingModel.health.status, 'unknown');
  assert.equal(missingModel.health.statusLabel, '状态未知');

  let symbolModel;
  assert.doesNotThrow(() => {
    symbolModel = buildSchedulerObservabilityViewModel({}, {
      items: [{ id: Symbol('dirty-id') }],
    });
  });
  assert.equal(symbolModel.anomalies.items[0].id, null);
});

test('exposes the exact supported observability ranges', () => {
  assert.deepEqual(OBSERVABILITY_RANGE_OPTIONS, [
    { label: '最近 1 小时', value: '1h' },
    { label: '最近 6 小时', value: '6h' },
    { label: '最近 24 小时', value: '24h' },
    { label: '最近 3 天', value: '3d' },
  ]);
});

test('formats metric durations and fails closed for invalid values', () => {
  assert.equal(formatMetricDuration(120), '120 ms');
  assert.equal(formatMetricDuration(1500), '1.50 s');

  for (const value of [null, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.equal(formatMetricDuration(value), '0 ms');
  }
});

test('formats amplification as a finite non-negative number', () => {
  assert.equal(formatAmplification(7, 3), 2.33);
  assert.equal(formatAmplification(10, 4), 2.5);
  assert.equal(Number.isFinite(formatAmplification(Number.MAX_VALUE, 1)), true);

  for (const [commandCount, runCount] of [
    [5, 0],
    [-5, 2],
    [5, -2],
    [Number.POSITIVE_INFINITY, 2],
    [5, Number.NaN],
  ]) {
    assert.equal(formatAmplification(commandCount, runCount), 0);
  }
});

test('builds sorted, bounded trend bars without mutating the input', () => {
  const series = [
    { bucket: '2026-07-15T12:02:00.000Z', commandCount: 20 },
    { bucket: '2026-07-15T12:00:00.000Z', commandCount: 10 },
    { bucket: '2026-07-15T12:01:00.000Z', commandCount: -5 },
    { bucket: '2026-07-15T12:03:00.000Z', commandCount: Number.NaN },
  ];
  const snapshot = series.map((row) => ({ ...row }));

  assert.deepEqual(buildTrendBars(series), [
    { key: JSON.stringify(['2026-07-15T12:00:00.000Z', 1]), bucket: '2026-07-15T12:00:00.000Z', value: 10, height: 50 },
    { key: JSON.stringify(['2026-07-15T12:01:00.000Z', 2]), bucket: '2026-07-15T12:01:00.000Z', value: 0, height: 0 },
    { key: JSON.stringify(['2026-07-15T12:02:00.000Z', 0]), bucket: '2026-07-15T12:02:00.000Z', value: 20, height: 100 },
    { key: JSON.stringify(['2026-07-15T12:03:00.000Z', 3]), bucket: '2026-07-15T12:03:00.000Z', value: 0, height: 0 },
  ]);
  assert.deepEqual(series, snapshot);
});

test('builds safe zero-height bars for empty, all-zero, and hostile input', () => {
  assert.deepEqual(buildTrendBars([]), []);
  assert.deepEqual(buildTrendBars(null), []);
  assert.deepEqual(buildTrendBars([
    { bucket: 'b', commandCount: 0 },
    { bucket: 'a', commandCount: 0 },
  ]), [
    { key: JSON.stringify(['a', 1]), bucket: 'a', value: 0, height: 0 },
    { key: JSON.stringify(['b', 0]), bucket: 'b', value: 0, height: 0 },
  ]);

  const hostile = {};
  Object.defineProperty(hostile, 'commandCount', {
    get() {
      throw new Error('must not escape');
    },
  });
  const bars = buildTrendBars([hostile]);
  assert.equal(bars.length, 1);
  assert.equal(bars[0].value, 0);
  assert.equal(bars[0].height, 0);
  assert.equal(Number.isFinite(bars[0].height), true);
});

test('builds globally unique deterministic keys for duplicate and empty buckets', () => {
  const series = [
    { bucket: 'b', commandCount: 5 },
    { bucket: 'a', commandCount: 4 },
    { bucket: 'a', commandCount: 3 },
    { bucket: 'a-2', commandCount: 2 },
    { bucket: '', commandCount: 1 },
  ];
  const snapshot = series.map((row) => ({ ...row }));

  const first = buildTrendBars(series);
  const second = buildTrendBars(series);
  assert.deepEqual(first.map((bar) => bar.key), [
    JSON.stringify(['', 4]),
    JSON.stringify(['a', 1]),
    JSON.stringify(['a', 2]),
    JSON.stringify(['a-2', 3]),
    JSON.stringify(['b', 0]),
  ]);
  assert.equal(new Set(first.map((bar) => bar.key)).size, first.length);
  assert.deepEqual(second, first);
  assert.deepEqual(series, snapshot);
});

test('formats only allow-listed egress descriptors without reflecting raw addresses', () => {
  assert.equal(formatEgressLabel({ type: 'direct', key: 'direct' }), '直连');
  assert.equal(
    formatEgressLabel({ type: 'proxy', key: 'proxy:012345abcdef' }),
    '匿名代理 012345abcdef',
  );

  const unsafeRows = [
    { type: 'proxy', key: 'proxy:ABCDEF012345' },
    { type: 'proxy', key: 'proxy.example:8080' },
    { type: 'proxy', key: '192.0.2.10:8080' },
    { type: 'proxy', key: 'https://proxy.example:8080' },
    { type: 'proxy', key: 'proxy:short' },
    { type: 'direct', key: 'https://direct.example' },
  ];
  for (const row of unsafeRows) {
    assert.equal(formatEgressLabel(row), '未知出口');
  }

  const hostile = {};
  Object.defineProperty(hostile, 'key', {
    get() {
      throw new Error('must not escape');
    },
  });
  assert.doesNotThrow(() => formatEgressLabel(hostile));
  assert.equal(formatEgressLabel(hostile), '未知出口');
});

test('localizes canonical API anomaly categories without changing string or object input', () => {
  const canonicalLabels = {
    command_rate_limited: '触发限流',
    command_timeout: '请求超时',
    command_disconnected: '连接断开',
    slow_command: '响应缓慢',
    command_error: '命令错误',
  };

  for (const [category, label] of Object.entries(canonicalLabels)) {
    const original = category;
    assert.equal(formatAnomalyCategory(category), label);
    assert.equal(category, original);

    const row = { category, marker: 'unchanged' };
    const snapshot = { ...row };
    assert.equal(formatAnomalyCategory(row), label);
    assert.deepEqual(row, snapshot);
  }
});

test('keeps short category aliases compatible and fails closed for unknown input', () => {
  assert.equal(formatAnomalyCategory('rate_limited'), '触发限流');
  assert.equal(formatAnomalyCategory('timeout'), '请求超时');
  assert.equal(formatAnomalyCategory('disconnected'), '连接断开');
  assert.equal(formatAnomalyCategory('slow'), '响应缓慢');
  assert.equal(formatAnomalyCategory('error'), '命令错误');
  assert.equal(formatAnomalyCategory('raw secret error'), '未知异常');
  assert.equal(formatAnomalyCategory(null), '未知异常');

  const hostile = {};
  Object.defineProperty(hostile, 'category', {
    get() {
      throw new Error('must not escape');
    },
  });
  assert.doesNotThrow(() => formatAnomalyCategory(hostile));
  assert.equal(formatAnomalyCategory(hostile), '未知异常');
});

test('stats observability APIs pass the original params through request options', async () => {
  const apiSource = await readFile(new URL('../src/api/index.js', import.meta.url), 'utf8');

  assert.match(
    apiSource,
    /getSchedulerObservabilitySummary:\s*\(params\)\s*=>\s*request\.get\('\/stats\/observability\/summary',\s*\{\s*params\s*\}\)/,
  );
  assert.match(
    apiSource,
    /getSchedulerObservabilityAnomalies:\s*\(params\)\s*=>\s*request\.get\('\/stats\/observability\/anomalies',\s*\{\s*params\s*\}\)/,
  );
  assert.doesNotMatch(apiSource, /observability\/(?:summary|anomalies)\?\$\{/);
});

test('scheduler observability route, shared admin menu, and page lifecycle stay aligned', async () => {
  const [routerSource, layoutSource, pageSource] = await Promise.all([
    readFile(new URL('../src/router/index.js', import.meta.url), 'utf8'),
    readFile(new URL('../src/layouts/MainLayout.vue', import.meta.url), 'utf8'),
    readFile(new URL('../src/views/SchedulerObservability.vue', import.meta.url), 'utf8'),
  ]);

  assert.match(routerSource, /path:\s*'scheduler-observability'/);
  assert.match(routerSource, /name:\s*'SchedulerObservability'/);
  assert.match(routerSource, /import\('@views\/SchedulerObservability\.vue'\)/);
  assert.match(routerSource, /meta:\s*\{\s*title:\s*'调度观测',\s*requiresAdmin:\s*true\s*\}/);
  assert.match(layoutSource, /index:\s*'\/scheduler-observability'[\s\S]*label:\s*'调度观测'[\s\S]*adminOnly:\s*true/);
  assert.equal((layoutSource.match(/v-for="item in visibleMenuItems"/g) || []).length, 2);

  assert.match(pageSource, /const POLL_INTERVAL_MS = 30_000/);
  assert.match(pageSource, /Promise\.allSettled/);
  assert.match(pageSource, /requestGeneration/);
  assert.match(pageSource, /anomalyPage\.value = 1/);
  assert.match(pageSource, /clearInterval\(pollTimer\)/);
  assert.match(pageSource, /onUnmounted/);
  assert.match(pageSource, /overflow-x:\s*auto/);
  assert.match(pageSource, /prefers-reduced-motion:\s*reduce/);
  assert.doesNotMatch(pageSource, /n-(?:card|data-table|select|button)|a-(?:card|table|select|button)/);
});
