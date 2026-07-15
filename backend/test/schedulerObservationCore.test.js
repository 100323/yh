import test from 'node:test';
import assert from 'node:assert/strict';
import {
  OBSERVATION_OUTCOMES,
  SchedulerObservationAggregator,
  classifyCommandFailure,
  createEgressDescriptor,
  sanitizeObservationMessage,
} from '../src/observability/schedulerObservationCore.js';

test('exports exactly the supported observation outcomes', () => {
  assert.deepEqual([...OBSERVATION_OUTCOMES], [
    'success',
    'ignored',
    'error',
    'timeout',
    'disconnected',
    'rate_limited',
    'sent',
  ]);
});

test('sanitizeObservationMessage removes secrets and caps the summary length', () => {
  const longEncoding = 'A'.repeat(96);
  const raw = [
    'failed\u0000\n',
    'https://game.example/path?token=query-secret&role=1',
    ' token=plain-secret',
    ' roleToken: "role-secret"',
    ' p=proxy-secret',
    ` encoded=${longEncoding}`,
    ' tail='.concat('z'.repeat(400)),
  ].join('');

  const result = sanitizeObservationMessage(raw);

  assert.ok(result.length <= 300);
  assert.equal(result.includes('\u0000'), false);
  assert.equal(result.includes('\n'), false);
  assert.equal(result.includes('query-secret'), false);
  assert.equal(result.includes('plain-secret'), false);
  assert.equal(result.includes('role-secret'), false);
  assert.equal(result.includes('proxy-secret'), false);
  assert.equal(result.includes(longEncoding), false);
  assert.match(result, /https:\/\/game\.example\/path/);
});

test('sanitizeObservationMessage honors a custom maximum and handles empty values', () => {
  assert.equal(sanitizeObservationMessage(null), '');
  assert.equal(sanitizeObservationMessage('123456789', 5), '12345');
  assert.equal(sanitizeObservationMessage('value', 0), '');
});

test('classifyCommandFailure recognizes structured and textual rate limits', () => {
  assert.equal(classifyCommandFailure({ code: 200400 }), 'rate_limited');
  assert.equal(
    classifyCommandFailure({ response: { data: { code: '12400000' } } }),
    'rate_limited',
  );
  assert.equal(
    classifyCommandFailure(new Error('操作过快，请稍后重试')),
    'rate_limited',
  );
});

test('classifyCommandFailure prioritizes timeout and disconnection hints', () => {
  const rateLimited = { code: 200400, message: '过于频繁' };

  assert.equal(
    classifyCommandFailure(rateLimited, { timeout: true, disconnected: true }),
    'timeout',
  );
  assert.equal(
    classifyCommandFailure(rateLimited, { disconnected: true }),
    'disconnected',
  );
  assert.equal(classifyCommandFailure(new Error('ordinary failure')), 'error');
});

test('createEgressDescriptor returns direct without a proxy', () => {
  assert.deepEqual(createEgressDescriptor(), { type: 'direct', key: 'direct' });
  assert.deepEqual(createEgressDescriptor(null), { type: 'direct', key: 'direct' });
});

test('createEgressDescriptor returns only a stable proxy fingerprint', () => {
  const proxy = {
    protocol: 'HTTPS:',
    host: 'Secret.Proxy.Example',
    port: '8443',
    username: 'private-user',
    password: 'private-password',
  };

  const first = createEgressDescriptor(proxy);
  const second = createEgressDescriptor({
    protocol: 'https',
    host: 'secret.proxy.example',
    port: 8443,
  });
  const serialized = JSON.stringify(first);

  assert.deepEqual(first, second);
  assert.equal(first.type, 'proxy');
  assert.match(first.key, /^proxy:[a-f0-9]{12}$/);
  assert.equal(serialized.includes('Secret.Proxy.Example'), false);
  assert.equal(serialized.includes('secret.proxy.example'), false);
  assert.equal(serialized.includes('private-user'), false);
  assert.equal(serialized.includes('private-password'), false);
});

test('SchedulerObservationAggregator separates command outcomes and totals counts', () => {
  const aggregator = new SchedulerObservationAggregator({
    now: () => Date.parse('2026-07-15T08:09:42.000Z'),
  });

  aggregator.recordCommand({
    command: 'role:info:get',
    outcome: 'success',
    dimensions: { scheduler: 'regular' },
  });
  aggregator.recordCommand({
    command: 'role:info:get',
    outcome: 'rate_limited',
    dimensions: { scheduler: 'regular' },
  });

  const snapshot = aggregator.takeSnapshot();

  assert.equal(snapshot.commandMetrics.length, 2);
  assert.deepEqual(
    snapshot.commandMetrics.map((row) => row.outcome).sort(),
    ['rate_limited', 'success'],
  );
  assert.equal(snapshot.totals.commandCount, 2);
  assert.equal(snapshot.totals.rateLimitedCount, 1);
  assert.ok(snapshot.commandMetrics.every((row) => row.minute === '2026-07-15 08:09:00'));
});

test('recordTask normalizes empty and object dimensions without object key coercion', () => {
  const aggregator = new SchedulerObservationAggregator({ now: () => 0 });

  aggregator.recordTask({
    outcome: 'success',
    dimensions: { scheduler: null, task: { unsafe: 'object' } },
  });

  const snapshot = aggregator.takeSnapshot();
  assert.equal(snapshot.taskMetrics.length, 1);
  assert.equal(snapshot.taskMetrics[0].dimensions.scheduler, '');
  assert.equal(snapshot.taskMetrics[0].dimensions.task, 'UNATTRIBUTED');
  assert.equal(snapshot.taskMetrics[0].minute, '1970-01-01 00:00:00');
  assert.equal(snapshot.totals.taskCount, 1);
  assert.equal(JSON.stringify(snapshot).includes('[object Object]'), false);
});

test('metric capacity drops only new keys and reports health', () => {
  const aggregator = new SchedulerObservationAggregator({ maxMetricKeys: 1 });

  assert.equal(aggregator.recordCommand({ command: 'one', outcome: 'success' }), true);
  assert.equal(aggregator.recordCommand({ command: 'one', outcome: 'success' }), true);
  assert.equal(aggregator.recordTask({ task: 'two', outcome: 'success' }), false);

  assert.deepEqual(aggregator.getHealth(), {
    metricKeys: 1,
    anomalyCount: 0,
    droppedMetrics: 1,
    droppedAnomalies: 0,
  });

  const snapshot = aggregator.takeSnapshot();
  assert.equal(snapshot.commandMetrics[0].count, 2);
  assert.equal(snapshot.totals.commandCount, 2);
  assert.equal(snapshot.health.droppedMetrics, 1);
});

test('anomaly capacity removes the oldest entry and sanitizes stored fields', () => {
  let timestamp = Date.parse('2026-07-15T00:00:00.000Z');
  const aggregator = new SchedulerObservationAggregator({
    now: () => timestamp,
    maxAnomalies: 2,
  });

  aggregator.recordAnomaly({ type: 'first', message: 'token=first-secret', stack: 'full-stack' });
  timestamp += 60_000;
  aggregator.recordAnomaly({ type: 'second', message: 'safe second' });
  timestamp += 60_000;
  aggregator.recordAnomaly({
    type: 'third',
    message: 'safe third',
    dimensions: {
      responseBody: 'raw-response-secret',
      stack: 'raw-stack-secret',
      proxy: 'http://raw.proxy.local:8080',
    },
  });

  const snapshot = aggregator.takeSnapshot();
  const serialized = JSON.stringify(snapshot);
  assert.deepEqual(snapshot.anomalies.map((entry) => entry.type), ['second', 'third']);
  assert.equal(snapshot.health.droppedAnomalies, 1);
  assert.equal(serialized.includes('first-secret'), false);
  assert.equal(serialized.includes('full-stack'), false);
  assert.equal(serialized.includes('raw-response-secret'), false);
  assert.equal(serialized.includes('raw-stack-secret'), false);
  assert.equal(serialized.includes('raw.proxy.local'), false);
});

test('takeSnapshot swaps buffers and returned data is unaffected by later records', () => {
  const aggregator = new SchedulerObservationAggregator({ now: () => 0 });
  aggregator.recordCommand({ command: 'before', outcome: 'sent' });

  const first = aggregator.takeSnapshot();
  aggregator.recordCommand({ command: 'after', outcome: 'success' });
  aggregator.recordAnomaly({ type: 'after', message: 'later' });

  assert.equal(first.commandMetrics.length, 1);
  assert.equal(first.commandMetrics[0].dimensions.command, 'before');
  assert.equal(first.anomalies.length, 0);
  assert.deepEqual(first.health, {
    metricKeys: 1,
    anomalyCount: 0,
    droppedMetrics: 0,
    droppedAnomalies: 0,
  });
  assert.deepEqual(aggregator.getHealth(), {
    metricKeys: 1,
    anomalyCount: 1,
    droppedMetrics: 0,
    droppedAnomalies: 0,
  });
});

test('mergeSnapshot combines matching metric rows, anomalies, and drop counters', () => {
  const source = new SchedulerObservationAggregator({ now: () => 0, maxMetricKeys: 1 });
  source.recordCommand({ command: 'shared', outcome: 'rate_limited' });
  source.recordTask({ task: 'dropped', outcome: 'error' });
  source.recordAnomaly({ type: 'source', message: 'source anomaly' });

  const target = new SchedulerObservationAggregator({ now: () => 0 });
  target.recordCommand({ command: 'shared', outcome: 'rate_limited' });
  assert.equal(target.mergeSnapshot(source.takeSnapshot()), true);

  const merged = target.takeSnapshot();
  assert.equal(merged.commandMetrics.length, 1);
  assert.equal(merged.commandMetrics[0].count, 2);
  assert.equal(merged.totals.commandCount, 2);
  assert.equal(merged.totals.rateLimitedCount, 2);
  assert.deepEqual(merged.anomalies.map((entry) => entry.type), ['source']);
  assert.equal(merged.health.droppedMetrics, 1);
});

test('mergeSnapshot preserves an anomaly ISO timestamp', () => {
  const source = new SchedulerObservationAggregator({
    now: () => Date.parse('2026-07-15T01:02:03.000Z'),
  });
  source.recordAnomaly({ type: 'source', message: 'source anomaly' });

  const target = new SchedulerObservationAggregator({
    now: () => Date.parse('2026-07-16T04:05:06.000Z'),
  });
  target.mergeSnapshot(source.takeSnapshot());

  const merged = target.takeSnapshot();
  assert.equal(merged.anomalies[0].timestamp, '2026-07-15T01:02:03.000Z');
  assert.equal(merged.anomalies[0].minute, '2026-07-15 01:02:00');
});

test('mergeSnapshot rejects non-snapshot input without changing state', () => {
  const aggregator = new SchedulerObservationAggregator();

  assert.equal(aggregator.mergeSnapshot(null), false);
  assert.equal(aggregator.mergeSnapshot({}), false);
  assert.deepEqual(aggregator.getHealth(), {
    metricKeys: 0,
    anomalyCount: 0,
    droppedMetrics: 0,
    droppedAnomalies: 0,
  });
});
