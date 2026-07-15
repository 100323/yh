import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  OBSERVABILITY_RANGE_OPTIONS,
  buildTrendBars,
  formatAmplification,
  formatAnomalyCategory,
  formatEgressLabel,
  formatMetricDuration,
} from '../src/utils/schedulerObservabilityViewModel.js';

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
    { key: '2026-07-15T12:00:00.000Z', bucket: '2026-07-15T12:00:00.000Z', value: 10, height: 50 },
    { key: '2026-07-15T12:01:00.000Z', bucket: '2026-07-15T12:01:00.000Z', value: 0, height: 0 },
    { key: '2026-07-15T12:02:00.000Z', bucket: '2026-07-15T12:02:00.000Z', value: 20, height: 100 },
    { key: '2026-07-15T12:03:00.000Z', bucket: '2026-07-15T12:03:00.000Z', value: 0, height: 0 },
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
    { key: 'a', bucket: 'a', value: 0, height: 0 },
    { key: 'b', bucket: 'b', value: 0, height: 0 },
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

test('localizes anomaly categories without changing the original category', () => {
  const labels = {
    rate_limited: '触发限流',
    timeout: '请求超时',
    disconnected: '连接断开',
    slow: '响应缓慢',
    error: '命令错误',
  };

  for (const [category, label] of Object.entries(labels)) {
    const original = category;
    assert.equal(formatAnomalyCategory(category), label);
    assert.equal(category, original);
  }
  assert.equal(formatAnomalyCategory('raw secret error'), '未知异常');
  assert.equal(formatAnomalyCategory(null), '未知异常');
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
