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

test('sanitizeObservationMessage removes escaped secrets and C1 controls without swallowing context', () => {
  const escapedPayload = 'prefix payload="{\\"token\\":\\"escaped-secret\\"}" suffix';
  const escapedQuote = 'before token="part1\\"part2-secret" after';

  const payloadResult = sanitizeObservationMessage(escapedPayload);
  const quoteResult = sanitizeObservationMessage(escapedQuote);
  const controlResult = sanitizeObservationMessage('left\u0085right');

  assert.equal(payloadResult.includes('escaped-secret'), false);
  assert.match(payloadResult, /prefix/);
  assert.match(payloadResult, /suffix/);
  assert.equal(quoteResult.includes('part2-secret'), false);
  assert.match(quoteResult, /before/);
  assert.match(quoteResult, /after/);
  assert.equal(controlResult, 'leftright');
});

test('sanitizeObservationMessage redacts unterminated sensitive values and complete URL queries', () => {
  const sensitiveCases = [
    ['token="unterminated-secret', 'unterminated-secret'],
    ["roleToken='unterminated-role", 'unterminated-role'],
    ['p="unterminated-proxy', 'unterminated-proxy'],
  ];

  for (const [input, secret] of sensitiveCases) {
    assert.equal(sanitizeObservationMessage(input).includes(secret), false);
  }

  assert.equal(
    sanitizeObservationMessage('https://game.example/path?foo="query-secret"'),
    'https://game.example/path',
  );
  assert.equal(
    sanitizeObservationMessage('//game.example/path?foo=query-secret'),
    '//game.example/path',
  );
  assert.equal(
    sanitizeObservationMessage('ordinary diagnostic text without assignments'),
    'ordinary diagnostic text without assignments',
  );
});

test('sanitizeObservationMessage keeps structural characters inside closed sensitive quotes redacted', () => {
  const cases = [
    ['token="first,comma-secret"', 'comma-secret'],
    ["roleToken='first;semicolon-secret'", 'semicolon-secret'],
    ['p="first&amp-secret"', 'amp-secret'],
    ['token="first]bracket-secret"', 'bracket-secret'],
  ];

  for (const [input, secret] of cases) {
    const result = sanitizeObservationMessage(input);
    assert.equal(result.includes(secret), false);
    assert.match(result, /\[REDACTED\]/);
  }
});

test('sanitizeObservationMessage continues through chained secrets after an unterminated value', () => {
  const cases = [
    {
      input: 'token="token-secret, p="proxy-secret"',
      secrets: ['token-secret', 'proxy-secret'],
    },
    {
      input: "roleToken='role-secret; token='token-secret'",
      secrets: ['role-secret', 'token-secret'],
    },
    {
      input: String.raw`token="first-secret, roleToken=\"second-secret\"; p='third-secret'`,
      secrets: ['first-secret', 'second-secret', 'third-secret'],
    },
  ];

  for (const { input, secrets } of cases) {
    const result = sanitizeObservationMessage(input);
    for (const secret of secrets) assert.equal(result.includes(secret), false);
    assert.equal((result.match(/\[REDACTED\]/g) ?? []).length, secrets.length);
  }
});

test('sanitizeObservationMessage recognizes whitespace-separated chained quoted secrets', () => {
  const cases = [
    {
      input: 'token="token-secret p="proxy-secret"',
      secrets: ['token-secret', 'proxy-secret'],
    },
    {
      input: "roleToken='role-secret token='next-secret'",
      secrets: ['role-secret', 'next-secret'],
    },
  ];

  for (const { input, secrets } of cases) {
    const result = sanitizeObservationMessage(input);
    for (const secret of secrets) assert.equal(result.includes(secret), false);
    assert.equal((result.match(/\[REDACTED\]/g) ?? []).length, 2);
  }
});

test('sanitizeObservationMessage keeps closed values with assignment-like text as one redaction', () => {
  const cases = [
    {
      input: 'before token="ordinary, token=inside-text" after',
      expected: 'before token="[REDACTED]" after',
      secrets: ['ordinary', 'inside-text'],
    },
    {
      input: "before roleToken='ordinary; p=inside-text' after",
      expected: "before roleToken='[REDACTED]' after",
      secrets: ['ordinary', 'inside-text'],
    },
  ];

  for (const { input, expected, secrets } of cases) {
    const result = sanitizeObservationMessage(input);
    assert.equal(result, expected);
    assert.equal((result.match(/\[REDACTED\]/g) ?? []).length, 1);
    for (const secret of secrets) assert.equal(result.includes(secret), false);
  }
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

test('recordCommand accumulates outcome counts and valid latency statistics', () => {
  const aggregator = new SchedulerObservationAggregator({ now: () => 0 });

  aggregator.recordCommand({ command: 'observe', outcome: 'error', latencyMs: 12.5 });
  aggregator.recordCommand({ command: 'observe', outcome: 'timeout', latencyMs: 0 });
  aggregator.recordCommand({ command: 'observe', outcome: 'disconnected', latencyMs: -1 });
  aggregator.recordCommand({ command: 'observe', outcome: 'rate_limited', latencyMs: Infinity });

  const rows = Object.fromEntries(
    aggregator.takeSnapshot().commandMetrics.map((row) => [row.outcome, row]),
  );

  assert.deepEqual(rows.error, {
    minute: '1970-01-01 00:00:00',
    dimensions: { command: 'observe' },
    outcome: 'error',
    commandCount: 1,
    errorCount: 1,
    timeoutCount: 0,
    disconnectedCount: 0,
    rateLimitedCount: 0,
    latencyCount: 1,
    latencySumMs: 12.5,
    latencyMaxMs: 12.5,
  });
  assert.equal(rows.timeout.timeoutCount, 1);
  assert.equal(rows.timeout.latencyCount, 1);
  assert.equal(rows.timeout.latencySumMs, 0);
  assert.equal(rows.disconnected.disconnectedCount, 1);
  assert.equal(rows.disconnected.latencyCount, 0);
  assert.equal(rows.disconnected.latencySumMs, 0);
  assert.equal(rows.rate_limited.rateLimitedCount, 1);
  assert.equal(rows.rate_limited.latencyCount, 0);
  assert.equal(rows.rate_limited.latencyMaxMs, 0);
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

test('recordTask accumulates valid timing statistics and attributed command aliases', () => {
  const aggregator = new SchedulerObservationAggregator({ now: () => 0 });

  aggregator.recordTask({
    task: 'daily',
    outcome: 'success',
    durationMs: 25,
    queueWaitMs: 5,
    commandCount: '2.9',
  });
  aggregator.recordTask({
    task: 'daily',
    outcome: 'success',
    durationMs: -1,
    queueWaitMs: Infinity,
    attributedCommandCount: 3,
  });
  aggregator.recordTask({
    task: 'daily',
    outcome: 'success',
    durationMs: 'not-a-number',
    queueWaitMs: -10,
    commandCount: -4,
  });

  const row = aggregator.takeSnapshot().taskMetrics[0];
  assert.deepEqual(row, {
    minute: '1970-01-01 00:00:00',
    dimensions: { task: 'daily' },
    outcome: 'success',
    runCount: 3,
    durationCount: 1,
    durationSumMs: 25,
    durationMaxMs: 25,
    queueWaitCount: 1,
    queueWaitSumMs: 5,
    queueWaitMaxMs: 5,
    attributedCommandCount: 5,
  });
});

test('record metrics saturate extreme measurements and counts at a finite safe limit', () => {
  const aggregator = new SchedulerObservationAggregator({ now: () => 0 });

  for (let index = 0; index < 2; index += 1) {
    aggregator.recordCommand({ command: 'extreme', outcome: 'success', latencyMs: Number.MAX_VALUE });
    aggregator.recordTask({
      task: 'extreme',
      outcome: 'success',
      durationMs: Number.MAX_VALUE,
      queueWaitMs: Number.MAX_VALUE,
      attributedCommandCount: Number.MAX_VALUE,
    });
  }

  const snapshot = aggregator.takeSnapshot();
  const command = snapshot.commandMetrics[0];
  const task = snapshot.taskMetrics[0];
  const numericValues = [
    ...Object.values(command).filter((value) => typeof value === 'number'),
    ...Object.values(task).filter((value) => typeof value === 'number'),
    ...Object.values(snapshot.totals),
  ];

  assert.ok(numericValues.every((value) => Number.isFinite(value)));
  assert.ok(numericValues.every((value) => value <= Number.MAX_SAFE_INTEGER));
  assert.equal(command.latencySumMs, Number.MAX_SAFE_INTEGER);
  assert.equal(command.latencyMaxMs, Number.MAX_SAFE_INTEGER);
  assert.equal(task.durationSumMs, Number.MAX_SAFE_INTEGER);
  assert.equal(task.queueWaitSumMs, Number.MAX_SAFE_INTEGER);
  assert.equal(task.attributedCommandCount, Number.MAX_SAFE_INTEGER);
  assert.equal(JSON.stringify(snapshot).includes(':null'), false);
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
  assert.equal(snapshot.commandMetrics[0].commandCount, 2);
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
  assert.equal(merged.commandMetrics[0].commandCount, 2);
  assert.equal(merged.totals.commandCount, 2);
  assert.equal(merged.totals.rateLimitedCount, 2);
  assert.deepEqual(merged.anomalies.map((entry) => entry.type), ['source']);
  assert.equal(merged.health.droppedMetrics, 1);
});

test('mergeSnapshot bypasses metric capacity and combines every command field losslessly', () => {
  const target = new SchedulerObservationAggregator({ now: () => 0, maxMetricKeys: 1 });
  target.recordCommand({ command: 'current', outcome: 'error', latencyMs: 10 });

  const source = new SchedulerObservationAggregator({ now: () => 0 });
  source.recordCommand({ command: 'current', outcome: 'error', latencyMs: 20 });
  source.recordCommand({ command: 'source', outcome: 'timeout', latencyMs: 7 });

  target.mergeSnapshot(source.takeSnapshot());
  const snapshot = target.takeSnapshot();
  const rows = Object.fromEntries(
    snapshot.commandMetrics.map((row) => [row.dimensions.command, row]),
  );

  assert.equal(snapshot.commandMetrics.length, 2);
  assert.equal(rows.current.commandCount, 2);
  assert.equal(rows.current.errorCount, 2);
  assert.equal(rows.current.latencyCount, 2);
  assert.equal(rows.current.latencySumMs, 30);
  assert.equal(rows.current.latencyMaxMs, 20);
  assert.equal(rows.source.commandCount, 1);
  assert.equal(rows.source.timeoutCount, 1);
  assert.equal(snapshot.health.droppedMetrics, 0);
});

test('mergeSnapshot combines every task field using sums and maxima', () => {
  const target = new SchedulerObservationAggregator({ now: () => 0 });
  target.recordTask({
    task: 'shared',
    outcome: 'success',
    durationMs: 10,
    queueWaitMs: 4,
    commandCount: 2,
  });

  const source = new SchedulerObservationAggregator({ now: () => 0 });
  source.recordTask({
    task: 'shared',
    outcome: 'success',
    durationMs: 30,
    queueWaitMs: 1,
    attributedCommandCount: 3,
  });

  target.mergeSnapshot(source.takeSnapshot());
  const row = target.takeSnapshot().taskMetrics[0];

  assert.equal(row.runCount, 2);
  assert.equal(row.durationCount, 2);
  assert.equal(row.durationSumMs, 40);
  assert.equal(row.durationMaxMs, 30);
  assert.equal(row.queueWaitCount, 2);
  assert.equal(row.queueWaitSumMs, 5);
  assert.equal(row.queueWaitMaxMs, 4);
  assert.equal(row.attributedCommandCount, 5);
});

test('mergeSnapshot saturates every command and task numeric field without Infinity', () => {
  const target = new SchedulerObservationAggregator({ now: () => 0 });
  target.recordCommand({ command: 'overflow', outcome: 'error', latencyMs: 1 });
  target.recordTask({ task: 'overflow', outcome: 'success', durationMs: 1, queueWaitMs: 1 });

  const source = new SchedulerObservationAggregator({ now: () => 0 });
  source.recordCommand({ command: 'overflow', outcome: 'error', latencyMs: 1 });
  source.recordTask({ task: 'overflow', outcome: 'success', durationMs: 1, queueWaitMs: 1 });
  const sourceSnapshot = source.takeSnapshot();

  for (const row of [...sourceSnapshot.commandMetrics, ...sourceSnapshot.taskMetrics]) {
    for (const [key, value] of Object.entries(row)) {
      if (typeof value === 'number') row[key] = Number.MAX_VALUE;
    }
  }

  target.mergeSnapshot(sourceSnapshot);
  const merged = target.takeSnapshot();
  const rows = [...merged.commandMetrics, ...merged.taskMetrics];
  const numericValues = rows.flatMap((row) => (
    Object.values(row).filter((value) => typeof value === 'number')
  ));

  assert.ok(numericValues.every((value) => Number.isFinite(value)));
  assert.ok(numericValues.every((value) => value <= Number.MAX_SAFE_INTEGER));
  assert.equal(JSON.stringify(merged).includes(':null'), false);
});

test('mergeSnapshot prepends all older anomalies without applying current capacity', () => {
  const target = new SchedulerObservationAggregator({
    now: () => Date.parse('2026-07-15T03:00:00.000Z'),
    maxAnomalies: 1,
  });
  target.recordAnomaly({ type: 'current', message: 'current' });

  let sourceTime = Date.parse('2026-07-15T01:00:00.000Z');
  const source = new SchedulerObservationAggregator({
    now: () => sourceTime,
    maxAnomalies: 5,
  });
  source.recordAnomaly({ type: 'oldest', message: 'oldest' });
  sourceTime += 60 * 60 * 1000;
  source.recordAnomaly({ type: 'older', message: 'older' });

  target.mergeSnapshot(source.takeSnapshot());
  const snapshot = target.takeSnapshot();

  assert.deepEqual(
    snapshot.anomalies.map((entry) => entry.type),
    ['oldest', 'older', 'current'],
  );
  assert.equal(snapshot.health.anomalyCount, 3);
  assert.equal(snapshot.health.droppedAnomalies, 0);
});

test('mergeSnapshot keeps chronological FIFO across multiple restores and stable ties', () => {
  const createSnapshot = (type, timestamp) => {
    const source = new SchedulerObservationAggregator({ now: () => timestamp });
    source.recordAnomaly({ type, message: type });
    return source.takeSnapshot();
  };

  const target = new SchedulerObservationAggregator({
    now: () => Date.parse('2026-07-15T03:00:00.000Z'),
    maxAnomalies: 1,
  });
  target.recordAnomaly({ type: 'current', message: 'current' });
  target.mergeSnapshot(createSnapshot('oldest', Date.parse('2026-07-15T01:00:00.000Z')));
  target.mergeSnapshot(createSnapshot('older', Date.parse('2026-07-15T02:00:00.000Z')));

  assert.deepEqual(
    target.takeSnapshot().anomalies.map((entry) => entry.type),
    ['oldest', 'older', 'current'],
  );

  const tiedTarget = new SchedulerObservationAggregator({
    now: () => Date.parse('2026-07-15T03:00:00.000Z'),
  });
  tiedTarget.recordAnomaly({ type: 'current', message: 'current' });
  const tiedTime = Date.parse('2026-07-15T01:00:00.000Z');
  tiedTarget.mergeSnapshot(createSnapshot('first', tiedTime));
  tiedTarget.mergeSnapshot(createSnapshot('second', tiedTime));

  assert.deepEqual(
    tiedTarget.takeSnapshot().anomalies.map((entry) => entry.type),
    ['first', 'second', 'current'],
  );
});

test('mergeSnapshot keeps same-millisecond restores before live anomalies in merge order', () => {
  const timestamp = Date.parse('2026-07-15T01:00:00.000Z');
  const createSnapshot = (type) => {
    const source = new SchedulerObservationAggregator({ now: () => timestamp });
    source.recordAnomaly({ type, message: type });
    return source.takeSnapshot();
  };

  const firstSnapshot = createSnapshot('snapshot-first');
  const target = new SchedulerObservationAggregator({ now: () => timestamp });
  target.recordAnomaly({ type: 'current-second', message: 'current-second' });
  target.mergeSnapshot(firstSnapshot);

  assert.deepEqual(
    target.takeSnapshot().anomalies.map((entry) => entry.type),
    ['snapshot-first', 'current-second'],
  );

  const multiTarget = new SchedulerObservationAggregator({ now: () => timestamp });
  multiTarget.recordAnomaly({ type: 'current', message: 'current' });
  multiTarget.mergeSnapshot(createSnapshot('first-snapshot'));
  multiTarget.mergeSnapshot(createSnapshot('second-snapshot'));

  assert.deepEqual(
    multiTarget.takeSnapshot().anomalies.map((entry) => entry.type),
    ['first-snapshot', 'second-snapshot', 'current'],
  );
});

test('recordAnomaly evicts only live anomalies after restored data exceeds capacity', () => {
  const timestamp = Date.parse('2026-07-15T01:00:00.000Z');
  const createSnapshot = (type) => {
    const source = new SchedulerObservationAggregator({ now: () => timestamp });
    source.recordAnomaly({ type, message: type });
    return source.takeSnapshot();
  };
  const target = new SchedulerObservationAggregator({ now: () => timestamp, maxAnomalies: 1 });
  target.recordAnomaly({ type: 'old-live', message: 'old-live' });
  target.mergeSnapshot(createSnapshot('restored-first'));
  target.mergeSnapshot(createSnapshot('restored-second'));

  target.recordAnomaly({ type: 'new-live', message: 'new-live' });
  const snapshot = target.takeSnapshot();

  assert.deepEqual(
    snapshot.anomalies.map((entry) => entry.type),
    ['restored-first', 'restored-second', 'new-live'],
  );
  assert.equal(snapshot.health.droppedAnomalies, 1);
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
