import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test, { after, before, beforeEach } from 'node:test';

const OBSERVATION_TABLES = [
  'command_anomalies',
  'command_metric_minutes',
  'task_metric_minutes',
];
const OBSERVATION_INDEXES = [
  'idx_command_anomalies_category',
  'idx_command_anomalies_time',
  'idx_command_metrics_bucket',
  'idx_task_metrics_bucket',
];
const FORBIDDEN_FIELDS = ['params', 'body', 'token', 'proxy', 'stack'];
const EXPECTED_TABLE_INFO = {
  command_metric_minutes: [
    ['bucket_minute', 'TEXT', 1, null, 1],
    ['source', 'TEXT', 1, "''", 2],
    ['command_class', 'TEXT', 1, "''", 3],
    ['task_type', 'TEXT', 1, "''", 4],
    ['command', 'TEXT', 1, "''", 5],
    ['execution_lane', 'TEXT', 1, "''", 6],
    ['egress_type', 'TEXT', 1, "''", 7],
    ['egress_key', 'TEXT', 1, "''", 8],
    ['outcome', 'TEXT', 1, "''", 9],
    ['command_count', 'INTEGER', 1, '0', 0],
    ['error_count', 'INTEGER', 1, '0', 0],
    ['timeout_count', 'INTEGER', 1, '0', 0],
    ['disconnected_count', 'INTEGER', 1, '0', 0],
    ['rate_limited_count', 'INTEGER', 1, '0', 0],
    ['latency_count', 'INTEGER', 1, '0', 0],
    ['latency_sum_ms', 'INTEGER', 1, '0', 0],
    ['latency_max_ms', 'INTEGER', 1, '0', 0],
    ['updated_at', 'DATETIME', 0, 'CURRENT_TIMESTAMP', 0],
  ],
  task_metric_minutes: [
    ['bucket_minute', 'TEXT', 1, null, 1],
    ['source', 'TEXT', 1, "''", 2],
    ['task_type', 'TEXT', 1, "''", 3],
    ['execution_lane', 'TEXT', 1, "''", 4],
    ['outcome', 'TEXT', 1, "''", 5],
    ['run_count', 'INTEGER', 1, '0', 0],
    ['duration_count', 'INTEGER', 1, '0', 0],
    ['duration_sum_ms', 'INTEGER', 1, '0', 0],
    ['duration_max_ms', 'INTEGER', 1, '0', 0],
    ['queue_wait_count', 'INTEGER', 1, '0', 0],
    ['queue_wait_sum_ms', 'INTEGER', 1, '0', 0],
    ['queue_wait_max_ms', 'INTEGER', 1, '0', 0],
    ['attributed_command_count', 'INTEGER', 1, '0', 0],
    ['updated_at', 'DATETIME', 0, 'CURRENT_TIMESTAMP', 0],
  ],
  command_anomalies: [
    ['id', 'INTEGER', 0, null, 1],
    ['occurred_at', 'DATETIME', 1, null, 0],
    ['run_id', 'TEXT', 0, null, 0],
    ['account_id', 'INTEGER', 0, null, 0],
    ['batch_task_id', 'INTEGER', 0, null, 0],
    ['source', 'TEXT', 1, "''", 0],
    ['task_type', 'TEXT', 1, "''", 0],
    ['command', 'TEXT', 1, "''", 0],
    ['execution_lane', 'TEXT', 1, "''", 0],
    ['egress_type', 'TEXT', 1, "''", 0],
    ['egress_key', 'TEXT', 1, "''", 0],
    ['category', 'TEXT', 1, null, 0],
    ['error_code', 'INTEGER', 0, null, 0],
    ['latency_ms', 'INTEGER', 0, null, 0],
    ['queue_wait_ms', 'INTEGER', 0, null, 0],
    ['summary', 'TEXT', 0, null, 0],
  ],
};
const EXPECTED_INDEX_COLUMNS = {
  idx_command_metrics_bucket: ['bucket_minute'],
  idx_task_metrics_bucket: ['bucket_minute'],
  idx_command_anomalies_time: ['occurred_at'],
  idx_command_anomalies_category: ['category', 'occurred_at'],
};

let databaseModule;
let repository;
let db;
let tempDir;
let tempDbPath;

function commandMetric(overrides = {}) {
  return {
    minute: '2026-07-15 00:00:00',
    dimensions: {
      source: 'batch',
      commandClass: 'read',
      taskType: 'DAILY',
      command: 'role:info:get',
      executionLane: 'account',
      egressType: 'direct',
      egressKey: 'direct',
    },
    outcome: 'success',
    commandCount: 1,
    errorCount: 0,
    timeoutCount: 0,
    disconnectedCount: 0,
    rateLimitedCount: 0,
    latencyCount: 1,
    latencySumMs: 10,
    latencyMaxMs: 10,
    ...overrides,
  };
}

function taskMetric(overrides = {}) {
  return {
    minute: '2026-07-15 00:00:00',
    dimensions: {
      source: 'batch',
      taskType: 'DAILY',
      executionLane: 'account',
    },
    outcome: 'success',
    runCount: 1,
    durationCount: 1,
    durationSumMs: 10,
    durationMaxMs: 10,
    queueWaitCount: 1,
    queueWaitSumMs: 5,
    queueWaitMaxMs: 5,
    attributedCommandCount: 1,
    ...overrides,
  };
}

function snapshot(overrides = {}) {
  return {
    version: 1,
    generatedAt: '2026-07-15T00:00:00.000Z',
    commandMetrics: [],
    taskMetrics: [],
    anomalies: [],
    ...overrides,
  };
}

function wrapDatabase(target, { failOnWrite = 0 } = {}) {
  let transactionCalls = 0;
  let observationWrites = 0;
  return {
    run(sql, params) {
      if (/^\s*INSERT INTO (?:command_metric_minutes|task_metric_minutes|command_anomalies)/i.test(sql)) {
        observationWrites += 1;
        if (failOnWrite > 0 && observationWrites === failOnWrite) {
          throw new Error('injected bad observation row');
        }
      }
      return target.run(sql, params);
    },
    get: (sql, params) => target.get(sql, params),
    all: (sql, params) => target.all(sql, params),
    transaction(fn) {
      transactionCalls += 1;
      return target.transaction(fn);
    },
    get transactionCalls() {
      return transactionCalls;
    },
  };
}

before(async () => {
  tempDir = await mkdtemp(path.join(os.tmpdir(), 'scheduler-observation-repository-'));
  tempDbPath = path.join(tempDir, 'observability.test.db');
  process.env.DB_PATH = tempDbPath;
  databaseModule = await import('../src/database/index.js');
  repository = await import('../src/observability/schedulerObservationRepository.js');
  db = await databaseModule.initDatabase();
});

beforeEach(() => {
  for (const table of OBSERVATION_TABLES) db.run(`DELETE FROM ${table}`);
});

after(async () => {
  await databaseModule?.closeDatabase();
  if (tempDir) await rm(tempDir, { recursive: true, force: true });
  delete process.env.DB_PATH;
});

test('initDatabase creates exactly the scheduler observation tables and indexes idempotently', async () => {
  const objectNames = [...OBSERVATION_TABLES, ...OBSERVATION_INDEXES];
  const placeholders = objectNames.map(() => '?').join(', ');
  const readObjects = () => db.all(
    `SELECT type, name FROM sqlite_master WHERE name IN (${placeholders}) ORDER BY type, name`,
    objectNames,
  );

  assert.deepEqual(readObjects(), [
    ...OBSERVATION_INDEXES.map((name) => ({ type: 'index', name })),
    ...OBSERVATION_TABLES.map((name) => ({ type: 'table', name })),
  ]);
  for (const [table, expected] of Object.entries(EXPECTED_TABLE_INFO)) {
    assert.deepEqual(
      db.all(`PRAGMA table_info('${table}')`).map((column) => [
        column.name,
        column.type,
        column.notnull,
        column.dflt_value,
        column.pk,
      ]),
      expected,
      table,
    );
  }
  for (const [index, expected] of Object.entries(EXPECTED_INDEX_COLUMNS)) {
    assert.deepEqual(
      db.all(`PRAGMA index_info('${index}')`).map((column) => column.name),
      expected,
      index,
    );
  }

  assert.equal(await databaseModule.initDatabase(), db);
  await databaseModule.closeDatabase();
  db = await databaseModule.initDatabase();
  assert.deepEqual(readObjects(), [
    ...OBSERVATION_INDEXES.map((name) => ({ type: 'index', name })),
    ...OBSERVATION_TABLES.map((name) => ({ type: 'table', name })),
  ]);
});

test('flush additively upserts matching metric dimensions and parameterizes anomalies', () => {
  repository.flushSchedulerObservationSnapshot(snapshot({
    commandMetrics: [commandMetric()],
    taskMetrics: [taskMetric()],
    anomalies: [{
      timestamp: '2026-07-15T00:00:05.000Z',
      type: 'command_error',
      message: "safe summary with a quote: O'Reilly",
      dimensions: {
        source: 'batch',
        taskType: 'DAILY',
        command: 'role:info:get',
        executionLane: 'account',
        egressType: 'direct',
        egressKey: 'direct',
        runId: 'run-1',
        accountId: '7',
        batchTaskId: '9',
        errorCode: '200400',
        latencyMs: '10',
        queueWaitMs: '5',
      },
    }],
  }), db);
  repository.flushSchedulerObservationSnapshot(snapshot({
    commandMetrics: [commandMetric({ latencySumMs: 20, latencyMaxMs: 20 })],
    taskMetrics: [taskMetric({
      durationSumMs: 15,
      durationMaxMs: 15,
      queueWaitSumMs: 7,
      queueWaitMaxMs: 7,
      attributedCommandCount: 2,
    })],
  }), db);

  assert.deepEqual(db.get(
    `SELECT command_count, latency_count, latency_sum_ms, latency_max_ms
     FROM command_metric_minutes`,
  ), {
    command_count: 2,
    latency_count: 2,
    latency_sum_ms: 30,
    latency_max_ms: 20,
  });
  assert.deepEqual(db.get(
    `SELECT run_count, duration_count, duration_sum_ms, duration_max_ms,
            queue_wait_count, queue_wait_sum_ms, queue_wait_max_ms, attributed_command_count
     FROM task_metric_minutes`,
  ), {
    run_count: 2,
    duration_count: 2,
    duration_sum_ms: 25,
    duration_max_ms: 15,
    queue_wait_count: 2,
    queue_wait_sum_ms: 12,
    queue_wait_max_ms: 7,
    attributed_command_count: 3,
  });
  assert.deepEqual(db.get(
    `SELECT occurred_at, run_id, account_id, batch_task_id, category, error_code,
            latency_ms, queue_wait_ms, summary FROM command_anomalies`,
  ), {
    occurred_at: '2026-07-15T00:00:05.000Z',
    run_id: 'run-1',
    account_id: 7,
    batch_task_id: 9,
    category: 'command_error',
    error_code: 200400,
    latency_ms: 10,
    queue_wait_ms: 5,
    summary: "safe summary with a quote: O'Reilly",
  });
});

test('flush uses one transaction for a multi-row snapshot and rolls the entire batch back on failure', () => {
  const countedDb = wrapDatabase(db);
  repository.flushSchedulerObservationSnapshot(snapshot({
    commandMetrics: [
      commandMetric(),
      commandMetric({ dimensions: { ...commandMetric().dimensions, command: 'role:other:get' } }),
    ],
    taskMetrics: [taskMetric()],
  }), countedDb);
  assert.equal(countedDb.transactionCalls, 1);
  assert.equal(db.get('SELECT COUNT(*) AS count FROM command_metric_minutes').count, 2);
  assert.equal(db.get('SELECT COUNT(*) AS count FROM task_metric_minutes').count, 1);

  db.run('DELETE FROM command_metric_minutes');
  db.run('DELETE FROM task_metric_minutes');
  const failingDb = wrapDatabase(db, { failOnWrite: 2 });
  assert.throws(
    () => repository.flushSchedulerObservationSnapshot(snapshot({
      commandMetrics: [commandMetric(), commandMetric({
        dimensions: { ...commandMetric().dimensions, command: 'bad-row' },
      })],
      taskMetrics: [taskMetric()],
    }), failingDb),
    /injected bad observation row/,
  );
  assert.equal(failingDb.transactionCalls, 1);
  assert.equal(db.get('SELECT COUNT(*) AS count FROM command_metric_minutes').count, 0);
  assert.equal(db.get('SELECT COUNT(*) AS count FROM task_metric_minutes').count, 0);

  const emptyDb = wrapDatabase(db);
  repository.flushSchedulerObservationSnapshot(snapshot(), emptyDb);
  assert.equal(emptyDb.transactionCalls, 0);
});

test('additive metric upserts remain bounded to nonnegative safe integers', () => {
  const large = snapshot({
    commandMetrics: [commandMetric({ commandCount: Number.MAX_SAFE_INTEGER })],
    taskMetrics: [taskMetric({ durationSumMs: Number.MAX_SAFE_INTEGER })],
  });
  repository.flushSchedulerObservationSnapshot(large, db);
  repository.flushSchedulerObservationSnapshot(large, db);

  assert.equal(
    db.get('SELECT command_count FROM command_metric_minutes').command_count,
    Number.MAX_SAFE_INTEGER,
  );
  assert.equal(
    db.get('SELECT duration_sum_ms FROM task_metric_minutes').duration_sum_ms,
    Number.MAX_SAFE_INTEGER,
  );
});

test('flush rejects every malformed row before opening a transaction or writing partial data', () => {
  const countedDb = wrapDatabase(db);
  const malformedSnapshots = [
    snapshot({ commandMetrics: [commandMetric(), null] }),
    snapshot({ commandMetrics: [{ ...commandMetric(), minute: undefined }] }),
    snapshot({ commandMetrics: [{ ...commandMetric(), outcome: undefined }] }),
    snapshot({ commandMetrics: [{ ...commandMetric(), dimensions: undefined }] }),
    snapshot({
      commandMetrics: [commandMetric()],
      anomalies: [{
        timestamp: new Date('invalid'),
        type: 'invalid_time',
        message: 'invalid date must reject',
        dimensions: {},
      }],
    }),
    snapshot({
      anomalies: [{
        timestamp: '2026-07-15T00:00:00.000Z',
        message: 'missing category must reject',
        dimensions: {},
      }],
    }),
  ];

  for (const malformed of malformedSnapshots) {
    assert.throws(
      () => repository.flushSchedulerObservationSnapshot(malformed, countedDb),
      /invalid|must be|requires/i,
    );
  }
  assert.equal(countedDb.transactionCalls, 0);
  for (const table of OBSERVATION_TABLES) {
    assert.equal(db.get(`SELECT COUNT(*) AS count FROM ${table}`).count, 0, table);
  }
});

test('millisecond cutoffs exclude and delete older rows while retaining the exact boundary', () => {
  const times = [
    '2026-07-15T00:00:00.100Z',
    '2026-07-15T00:00:00.500Z',
    '2026-07-15T00:00:00.900Z',
  ];
  for (const bucket of times) {
    db.run(
      `INSERT INTO command_metric_minutes (bucket_minute, source, command_count)
       VALUES (?, 'millisecond', 1)`,
      [bucket],
    );
    db.run(
      `INSERT INTO task_metric_minutes (bucket_minute, source, run_count)
       VALUES (?, 'millisecond', 1)`,
      [bucket],
    );
    db.run(
      `INSERT INTO command_anomalies (occurred_at, source, category, summary)
       VALUES (?, 'millisecond', 'cutoff', ?)`,
      [bucket, bucket],
    );
  }
  db.run(
    `INSERT INTO command_metric_minutes (bucket_minute, source, command_count)
     VALUES ('invalid-time', 'invalid', 1)`,
  );
  db.run(
    `INSERT INTO task_metric_minutes (bucket_minute, source, run_count)
     VALUES ('invalid-time', 'invalid', 1)`,
  );
  db.run(
    `INSERT INTO command_anomalies (occurred_at, source, category, summary)
     VALUES ('invalid-time', 'invalid', 'cutoff', 'invalid-time')`,
  );

  const cutoff = '2026-07-15T00:00:00.500Z';
  const summaryResult = repository.querySchedulerObservationSummary({ cutoff }, db);
  const anomalyResult = repository.querySchedulerObservationAnomalies({
    cutoff,
    page: 1,
    pageSize: 10,
  }, db);
  assert.deepEqual(
    summaryResult.commandMetrics.map((row) => row.bucket_minute),
    times.slice(1),
  );
  assert.deepEqual(
    summaryResult.taskMetrics.map((row) => row.bucket_minute),
    times.slice(1),
  );
  assert.equal(anomalyResult.total, 2);
  assert.deepEqual(anomalyResult.items.map((row) => row.occurred_at), times.slice(1).reverse());

  repository.cleanupSchedulerObservation(db, { cutoff, maxAnomalies: 100 });
  assert.deepEqual(
    db.all('SELECT bucket_minute FROM command_metric_minutes ORDER BY bucket_minute'),
    times.slice(1).map((bucket_minute) => ({ bucket_minute })),
  );
  assert.deepEqual(
    db.all('SELECT bucket_minute FROM task_metric_minutes ORDER BY bucket_minute'),
    times.slice(1).map((bucket_minute) => ({ bucket_minute })),
  );
  assert.deepEqual(
    db.all('SELECT occurred_at FROM command_anomalies ORDER BY occurred_at'),
    times.slice(1).map((occurred_at) => ({ occurred_at })),
  );
});

test('cleanup defaults to three days and 50000 newest anomalies, applying time and row limits', () => {
  db.run(
    `INSERT INTO command_metric_minutes (bucket_minute, command_count)
     VALUES (?, 1), (?, 1), (?, 1)`,
    ['2026-07-11 23:59:59', '2026-07-12 00:00:00', '2026-07-13 00:00:00'],
  );
  db.run(
    `INSERT INTO task_metric_minutes (bucket_minute, run_count)
     VALUES (?, 1), (?, 1), (?, 1)`,
    ['2026-07-11 23:59:59', '2026-07-12 00:00:00', '2026-07-13 00:00:00'],
  );
  db.run(
    `INSERT INTO command_anomalies (occurred_at, category, summary)
     VALUES (?, 'old', 'old'), (?, 'boundary', 'boundary')`,
    ['2026-07-11T23:59:59.999Z', '2026-07-12T00:00:00.000Z'],
  );
  db.run(
    `WITH RECURSIVE seq(n) AS (
       VALUES(1) UNION ALL SELECT n + 1 FROM seq WHERE n < 50001
     )
     INSERT INTO command_anomalies (occurred_at, category, summary)
     SELECT '2026-07-14T00:00:00.000Z', 'bulk', printf('bulk-%d', n) FROM seq`,
  );

  const result = repository.cleanupSchedulerObservation(db, {
    now: '2026-07-15T00:00:00.000Z',
  });

  assert.equal(result.cutoff, '2026-07-12T00:00:00.000Z');
  assert.deepEqual(
    db.all('SELECT bucket_minute FROM command_metric_minutes ORDER BY bucket_minute'),
    [{ bucket_minute: '2026-07-12 00:00:00' }, { bucket_minute: '2026-07-13 00:00:00' }],
  );
  assert.deepEqual(
    db.all('SELECT bucket_minute FROM task_metric_minutes ORDER BY bucket_minute'),
    [{ bucket_minute: '2026-07-12 00:00:00' }, { bucket_minute: '2026-07-13 00:00:00' }],
  );
  const anomalyState = db.get(
    `SELECT COUNT(*) AS count, MIN(id) AS min_id, MAX(id) AS max_id,
            MIN(occurred_at) AS oldest FROM command_anomalies`,
  );
  assert.equal(anomalyState.count, 50000);
  assert.equal(anomalyState.max_id - anomalyState.min_id, 49999);
  assert.equal(anomalyState.oldest, '2026-07-14T00:00:00.000Z');
});

test('cleanup accepts a fixed cutoff, keeps newest tied anomalies, and is called by daily maintenance', async () => {
  db.run(
    `INSERT INTO command_anomalies (occurred_at, category, summary)
     VALUES ('2026-07-10T00:00:00.000Z', 'old', 'old'),
            ('2026-07-14T00:00:00.000Z', 'tie', 'first'),
            ('2026-07-14T00:00:00.000Z', 'tie', 'second'),
            ('2026-07-14T00:00:00.000Z', 'tie', 'third')`,
  );
  repository.cleanupSchedulerObservation(db, {
    cutoff: '2026-07-12T00:00:00.000Z',
    maxAnomalies: 2,
  });
  assert.deepEqual(
    db.all('SELECT summary FROM command_anomalies ORDER BY occurred_at DESC, id DESC'),
    [{ summary: 'third' }, { summary: 'second' }],
  );

  db.run(
    `INSERT INTO command_anomalies (occurred_at, category, summary)
     VALUES (datetime('now', '-4 days'), 'maintenance', 'expired')`,
  );
  await databaseModule.runDatabaseMaintenance();
  assert.equal(
    db.get("SELECT COUNT(*) AS count FROM command_anomalies WHERE summary = 'expired'").count,
    0,
  );
});

test('summary query applies fixed cutoffs and parameterized dimension filters', () => {
  const fixtures = [
    commandMetric({ minute: '2026-07-12 00:00:00' }),
    commandMetric({ minute: '2026-07-14 00:00:00' }),
    commandMetric({ minute: '2026-07-14 18:00:00' }),
    commandMetric({ minute: '2026-07-14 23:00:00' }),
    commandMetric({ minute: '2026-07-14 23:30:00' }),
  ];
  repository.flushSchedulerObservationSnapshot(snapshot({
    commandMetrics: fixtures,
    taskMetrics: fixtures.map((row) => taskMetric({
      minute: row.minute,
      dimensions: {
        source: 'batch',
        taskType: 'DAILY',
        executionLane: 'account',
      },
    })),
  }), db);

  const cutoffs = [
    ['1h', '2026-07-14 23:00:00', 2],
    ['6h', '2026-07-14 18:00:00', 3],
    ['24h', '2026-07-14 00:00:00', 4],
    ['3d', '2026-07-12 00:00:00', 5],
  ];
  for (const [range, cutoff, expected] of cutoffs) {
    const result = repository.querySchedulerObservationSummary({ cutoff }, db);
    assert.equal(result.commandMetrics.length, expected, range);
    assert.equal(result.taskMetrics.length, expected, range);
    assert.ok(result.commandMetrics.every((row) => row.bucket_minute >= cutoff), range);
  }

  const match = repository.querySchedulerObservationSummary({
    cutoff: '2026-07-12 00:00:00',
    source: 'batch',
    taskType: 'DAILY',
    commandClass: 'read',
    egressType: 'direct',
  }, db);
  assert.equal(match.commandMetrics.length, 5);
  assert.equal(match.taskMetrics.length, 5);

  const injection = repository.querySchedulerObservationSummary({
    cutoff: '2026-07-12 00:00:00',
    source: "batch' OR 1=1 --",
  }, db);
  assert.equal(injection.commandMetrics.length, 0);
  assert.equal(injection.taskMetrics.length, 0);
});

test('anomaly query paginates with category filtering, stable ordering, and correct total', () => {
  db.run(
    `INSERT INTO command_anomalies (occurred_at, source, category, summary)
     VALUES ('2026-07-15T00:00:00.000Z', 'batch', 'timeout', 'first'),
            ('2026-07-15T00:00:00.000Z', 'batch', 'timeout', 'second'),
            ('2026-07-15T00:01:00.000Z', 'batch', 'timeout', 'third'),
            ('2026-07-15T00:02:00.000Z', 'batch', 'error', 'other')`,
  );

  const firstPage = repository.querySchedulerObservationAnomalies({
    cutoff: '2026-07-15T00:00:00.000Z',
    category: 'timeout',
    page: 1,
    pageSize: 2,
  }, db);
  assert.equal(firstPage.total, 3);
  assert.equal(firstPage.page, 1);
  assert.equal(firstPage.pageSize, 2);
  assert.deepEqual(firstPage.items.map((item) => item.summary), ['third', 'second']);

  const secondPage = repository.querySchedulerObservationAnomalies({
    cutoff: '2026-07-15T00:00:00.000Z',
    category: 'timeout',
    page: 2,
    pageSize: 2,
  }, db);
  assert.equal(secondPage.total, 3);
  assert.deepEqual(secondPage.items.map((item) => item.summary), ['first']);
});

test('schema, writes, and query results exclude sensitive payload fields and raw proxy addresses', () => {
  repository.flushSchedulerObservationSnapshot(snapshot({
    commandMetrics: [commandMetric({
      params: 'params-secret',
      body: 'body-secret',
      token: 'token-secret',
      proxy: 'http://raw-proxy.example:8080',
      stack: 'stack-secret',
      commandCount: Number.POSITIVE_INFINITY,
      latencySumMs: -1,
      latencyMaxMs: Number.MAX_VALUE,
      dimensions: {
        ...commandMetric().dimensions,
        source: 'http://source-proxy.example:8080',
        egressKey: 'http://raw-proxy.example:8080',
        token: 'dimension-token-secret',
      },
    })],
    anomalies: [{
      occurredAt: '2026-07-15T00:00:00.000Z',
      category: 'failure',
      summary: 'connect via http://alice:secret@10.0.0.8:8080/path and bare-proxy.example:9000; token="summary-token-secret" body="summary-body-secret"',
      params: 'anomaly-params-secret',
      body: 'anomaly-body-secret',
      token: 'anomaly-token-secret',
      proxy: 'http://anomaly-proxy.example:9000',
      stack: 'anomaly-stack-secret',
      dimensions: {
        source: 'batch',
        egressKey: 'http://dimension-proxy.example:8000',
        stack: 'dimension-stack-secret',
      },
    }],
  }), db);

  for (const table of OBSERVATION_TABLES) {
    const columns = db.all(`PRAGMA table_info('${table}')`).map((row) => row.name.toLowerCase());
    assert.ok(FORBIDDEN_FIELDS.every((field) => !columns.includes(field)), table);
  }

  const summary = repository.querySchedulerObservationSummary({
    cutoff: '2026-07-15 00:00:00',
  }, db);
  const anomalies = repository.querySchedulerObservationAnomalies({
    cutoff: '2026-07-15T00:00:00.000Z',
    page: 1,
    pageSize: 10,
  }, db);
  const serialized = JSON.stringify({ summary, anomalies });
  for (const secret of [
    'params-secret',
    'body-secret',
    'token-secret',
    'raw-proxy.example',
    'stack-secret',
    'anomaly-proxy.example',
    'dimension-proxy.example',
    'source-proxy.example',
    'alice:secret',
    '10.0.0.8:8080',
    'bare-proxy.example:9000',
  ]) {
    assert.equal(serialized.includes(secret), false, secret);
  }
  assert.equal(summary.commandMetrics[0].command_count, 0);
  assert.equal(summary.commandMetrics[0].latency_sum_ms, 0);
  assert.equal(summary.commandMetrics[0].latency_max_ms, Number.MAX_SAFE_INTEGER);
  assert.equal(summary.commandMetrics[0].source.includes('source-proxy.example'), false);
  assert.equal(summary.commandMetrics[0].egress_key, '');
  assert.equal(anomalies.items[0].egress_key, '');
  assert.match(anomalies.items[0].summary, /\[REDACTED\]/);
});

test('flush fail-closes every persisted text column while preserving normal scheduler identifiers', () => {
  const unsafeValues = [
    '10.0.0.8',
    '2001:db8::1',
    'proxy.example',
    'token-secret',
    'stack-secret',
    'localhost',
    '//relative.example/path',
    'http://user:pass@auth.example:8080/path',
    'bare.example:9000',
    '[2001:db8::2]',
    'request-secret',
    'body-secret',
    'response-secret',
    'param-secret',
  ];
  repository.flushSchedulerObservationSnapshot(snapshot({
    commandMetrics: [
      commandMetric({
        dimensions: {
          source: unsafeValues[0],
          commandClass: unsafeValues[1],
          taskType: unsafeValues[2],
          command: unsafeValues[3],
          executionLane: unsafeValues[4],
          egressType: 'direct',
          egressKey: 'direct',
        },
      }),
      commandMetric({
        dimensions: {
          source: 'scheduler',
          commandClass: 'batch_scheduler',
          taskType: 'ARENA',
          command: 'arena_startarea',
          executionLane: 'direct',
          egressType: 'direct',
          egressKey: 'direct',
        },
      }),
    ],
    taskMetrics: [
      taskMetric({
        dimensions: {
          source: unsafeValues[5],
          taskType: unsafeValues[6],
          executionLane: unsafeValues[7],
        },
      }),
      taskMetric({
        dimensions: {
          source: 'scheduler',
          taskType: 'ARENA',
          executionLane: 'direct',
        },
      }),
    ],
    anomalies: [{
      timestamp: '2026-07-15T00:00:00.000Z',
      type: unsafeValues[13],
      message: unsafeValues.join(' | '),
      dimensions: {
        runId: unsafeValues[8],
        source: unsafeValues[9],
        taskType: unsafeValues[10],
        command: unsafeValues[11],
        executionLane: unsafeValues[12],
        egressType: 'direct',
        egressKey: 'direct',
      },
    }],
  }), db);

  const persisted = JSON.stringify({
    commandMetrics: db.all('SELECT * FROM command_metric_minutes'),
    taskMetrics: db.all('SELECT * FROM task_metric_minutes'),
    anomalies: db.all('SELECT * FROM command_anomalies'),
  }).toLowerCase();
  for (const unsafe of unsafeValues) {
    assert.equal(persisted.includes(unsafe.toLowerCase()), false, unsafe);
  }

  assert.deepEqual(db.get(
    `SELECT source, command_class, task_type, command, execution_lane, egress_type, egress_key
     FROM command_metric_minutes WHERE source = 'scheduler'`,
  ), {
    source: 'scheduler',
    command_class: 'batch_scheduler',
    task_type: 'ARENA',
    command: 'arena_startarea',
    execution_lane: 'direct',
    egress_type: 'direct',
    egress_key: 'direct',
  });
});

test('flush preserves proxy execution lanes separately from actual egress while sanitizing unknown lanes', () => {
  const proxyEgress = {
    egressType: 'proxy',
    egressKey: 'proxy:abcdef123456',
  };
  repository.flushSchedulerObservationSnapshot(snapshot({
    commandMetrics: [
      commandMetric({
        dimensions: {
          ...commandMetric().dimensions,
          command: 'arena_lane_selected',
          executionLane: 'proxy',
          ...proxyEgress,
        },
      }),
      commandMetric({
        dimensions: {
          ...commandMetric().dimensions,
          command: 'arena_lane_unknown',
          executionLane: 'proxy.example',
          ...proxyEgress,
        },
      }),
    ],
    taskMetrics: [
      taskMetric({
        dimensions: {
          ...taskMetric().dimensions,
          taskType: 'LANE_SELECTED_TASK',
          executionLane: 'proxy',
          ...proxyEgress,
        },
      }),
      taskMetric({
        dimensions: {
          ...taskMetric().dimensions,
          taskType: 'LANE_UNKNOWN_TASK',
          executionLane: 'http://lane.example:8080/path',
          ...proxyEgress,
        },
      }),
    ],
    anomalies: [
      {
        timestamp: '2026-07-15T00:00:00.000Z',
        type: 'lane_anomaly',
        message: 'safe proxy lane',
        dimensions: {
          source: 'scheduler',
          taskType: 'ARENA',
          command: 'arena_lane_selected',
          executionLane: 'proxy',
          ...proxyEgress,
        },
      },
      {
        timestamp: '2026-07-15T00:00:01.000Z',
        type: 'lane_unknown_anomaly',
        message: 'unknown lane must sanitize',
        dimensions: {
          source: 'scheduler',
          taskType: 'ARENA',
          command: 'arena_lane_unknown',
          executionLane: 'http://anomaly-lane.example:8080/path',
          ...proxyEgress,
        },
      },
    ],
  }), db);

  assert.deepEqual(db.get(
    `SELECT execution_lane, egress_type, egress_key
     FROM command_metric_minutes WHERE command = 'arena_lane_selected'`,
  ), {
    execution_lane: 'proxy',
    egress_type: 'proxy',
    egress_key: 'proxy:abcdef123456',
  });
  assert.deepEqual(db.get(
    `SELECT execution_lane FROM task_metric_minutes WHERE task_type = 'LANE_SELECTED_TASK'`,
  ), { execution_lane: 'proxy' });
  assert.deepEqual(db.get(
    `SELECT execution_lane, egress_type, egress_key
     FROM command_anomalies WHERE category = 'lane_anomaly'`,
  ), {
    execution_lane: 'proxy',
    egress_type: 'proxy',
    egress_key: 'proxy:abcdef123456',
  });

  const unknownLanes = JSON.stringify([
    db.get("SELECT execution_lane FROM command_metric_minutes WHERE command = 'arena_lane_unknown'"),
    db.get("SELECT execution_lane FROM task_metric_minutes WHERE task_type = 'LANE_UNKNOWN_TASK'"),
    db.get("SELECT execution_lane FROM command_anomalies WHERE category = 'lane_unknown_anomaly'"),
  ]);
  assert.equal(unknownLanes.includes('proxy.example'), false);
  assert.equal(unknownLanes.includes('lane.example'), false);
  assert.equal(unknownLanes.includes('anomaly-lane.example'), false);
});
