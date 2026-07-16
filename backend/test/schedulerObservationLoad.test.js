import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test, { after, before } from 'node:test';

import { SchedulerObservationAggregator } from '../src/observability/schedulerObservationCore.js';

const EVENT_COUNT = 100_000;
const MAX_ANOMALIES = 1_000;
const MAX_SNAPSHOT_BYTES = 5 * 1024 * 1024;
const FIXED_NOW = '2026-07-15T12:00:00.000Z';
const FORBIDDEN_PAYLOADS = [
  'load-test-token-secret-123456789',
  'response-body-secret-987654321',
  '198.51.100.42:8080',
  'at internalSensitiveFrame',
];

let databaseModule;
let repository;
let db;
let tempDir;

function captureDatabase(target) {
  const statements = [];
  return {
    run(sql, params = []) {
      statements.push({ method: 'run', sql, params });
      return target.run(sql, params);
    },
    get(sql, params = []) {
      statements.push({ method: 'get', sql, params });
      return target.get(sql, params);
    },
    all(sql, params = []) {
      statements.push({ method: 'all', sql, params });
      return target.all(sql, params);
    },
    transaction(fn) {
      return target.transaction(fn);
    },
    statements,
  };
}

function explainStatementUsesRangeIndex(target, statement, indexName, column) {
  assert.ok(statement, `missing captured range statement for ${column}`);
  const plan = target.all(`EXPLAIN QUERY PLAN ${statement.sql}`, statement.params);
  const details = plan.map((row) => String(row.detail)).join('\n');
  assert.match(details, new RegExp(`SEARCH .* USING (?:COVERING )?INDEX ${indexName} .*${column}[<>]=?\\?`, 'i'));
  return details;
}

before(async () => {
  tempDir = await mkdtemp(path.join(os.tmpdir(), 'scheduler-observation-load-'));
  process.env.DB_PATH = path.join(tempDir, 'load.test.db');
  process.env.SCHEDULER_OBSERVABILITY_RETENTION_DAYS = '2';
  process.env.SCHEDULER_OBSERVABILITY_MAX_ANOMALY_ROWS = '1000';
  databaseModule = await import('../src/database/index.js');
  repository = await import('../src/observability/schedulerObservationRepository.js');
  db = await databaseModule.initDatabase();
});

after(async () => {
  await databaseModule?.closeDatabase();
  if (tempDir) await rm(tempDir, { recursive: true, force: true });
  delete process.env.DB_PATH;
  delete process.env.SCHEDULER_OBSERVABILITY_RETENTION_DAYS;
  delete process.env.SCHEDULER_OBSERVABILITY_MAX_ANOMALY_ROWS;
});

test('100000 deterministic command observations remain bounded and exclude sensitive payloads', (t) => {
  const aggregator = new SchedulerObservationAggregator({
    now: () => Date.parse(FIXED_NOW),
    maxMetricKeys: 20_000,
    maxAnomalies: MAX_ANOMALIES,
  });

  let totalRecordedCommands = 0;
  for (let index = 0; index < EVENT_COUNT; index += 1) {
    const outcome = index % 25 === 0 ? 'rate_limited' : 'success';
    const recorded = aggregator.recordCommand({
      timestamp: Date.parse(FIXED_NOW) - (index % 60) * 60_000,
      command: `command-${index % 20}`,
      outcome,
      latencyMs: 20 + (index % 8_000),
      dimensions: {
        source: index % 2 === 0 ? 'scheduler' : 'batch_scheduler',
        commandClass: `class-${index % 3}`,
        taskType: `task-${index % 8}`,
        executionLane: `lane-${index % 4}`,
        egressType: index % 5 === 0 ? 'proxy' : 'direct',
        egressKey: index % 5 === 0 ? `proxy:fingerprint-${index % 7}` : 'direct',
      },
      token: FORBIDDEN_PAYLOADS[0],
      params: { secret: FORBIDDEN_PAYLOADS[0] },
      response: { body: FORBIDDEN_PAYLOADS[1] },
      proxy: `http://${FORBIDDEN_PAYLOADS[2]}`,
      stack: `Error: secret\n    ${FORBIDDEN_PAYLOADS[3]}`,
    });
    if (recorded) totalRecordedCommands += 1;

    if (outcome === 'rate_limited') {
      aggregator.recordAnomaly({
        timestamp: Date.parse(FIXED_NOW) - (index % 60) * 60_000,
        type: 'command_rate_limited',
        message: `token=${FORBIDDEN_PAYLOADS[0]} response=${FORBIDDEN_PAYLOADS[1]} proxy=http://${FORBIDDEN_PAYLOADS[2]}`,
        dimensions: {
          source: 'scheduler',
          command: `command-${index % 20}`,
          stack: `Error: secret\n    ${FORBIDDEN_PAYLOADS[3]}`,
        },
      });
    }
  }

  const snapshot = aggregator.takeSnapshot();
  const serialized = JSON.stringify(snapshot);
  const estimatedSnapshotJsonBytes = Buffer.byteLength(serialized, 'utf8');

  assert.equal(totalRecordedCommands, EVENT_COUNT);
  assert.equal(snapshot.totals.commandCount, EVENT_COUNT);
  assert.ok(snapshot.commandMetrics.length < 5_000, snapshot.commandMetrics.length);
  assert.ok(snapshot.anomalies.length <= MAX_ANOMALIES, snapshot.anomalies.length);
  assert.ok(estimatedSnapshotJsonBytes < MAX_SNAPSHOT_BYTES, estimatedSnapshotJsonBytes);
  assert.equal(FORBIDDEN_PAYLOADS.some((payload) => serialized.includes(payload)), false);
  t.diagnostic(JSON.stringify({
    recordedCommands: totalRecordedCommands,
    commandMetricKeys: snapshot.commandMetrics.length,
    anomalies: snapshot.anomalies.length,
    snapshotJsonBytes: estimatedSnapshotJsonBytes,
  }));
});

test('real SQLite cleanup enforces three-day and row caps with indexed range scans', (t) => {
  const tables = ['command_metric_minutes', 'task_metric_minutes', 'command_anomalies'];
  for (const table of tables) db.run(`DELETE FROM ${table}`);

  db.run(
    `INSERT INTO command_metric_minutes (bucket_minute, command, command_count)
     VALUES ('2026-07-11 11:59:59', 'expired', 1)`,
  );
  db.run(
    `INSERT INTO task_metric_minutes (bucket_minute, task_type, run_count)
     VALUES ('2026-07-11 11:59:59', 'expired', 1)`,
  );
  db.run(
    `INSERT INTO command_anomalies (occurred_at, category, summary)
     VALUES ('2026-07-11T11:59:59.999Z', 'expired', 'expired')`,
  );
  db.run(
    `WITH RECURSIVE seq(n) AS (
       VALUES(0) UNION ALL SELECT n + 1 FROM seq WHERE n < 39
     )
     INSERT INTO command_metric_minutes (bucket_minute, command, command_count)
     SELECT datetime('2026-07-15 11:59:00', printf('-%d minutes', n)), printf('command-%d', n), 1 FROM seq`,
  );
  db.run(
    `WITH RECURSIVE seq(n) AS (
       VALUES(0) UNION ALL SELECT n + 1 FROM seq WHERE n < 34
     )
     INSERT INTO task_metric_minutes (bucket_minute, task_type, run_count)
     SELECT datetime('2026-07-15 11:59:00', printf('-%d minutes', n)), printf('task-%d', n), 1 FROM seq`,
  );
  db.run(
    `WITH RECURSIVE seq(n) AS (
       VALUES(0) UNION ALL SELECT n + 1 FROM seq WHERE n < 29
     )
     INSERT INTO command_anomalies (occurred_at, category, summary)
     SELECT strftime('%Y-%m-%dT%H:%M:%fZ', '2026-07-15 11:59:00', printf('-%d minutes', n)), 'bulk', printf('anomaly-%d', n) FROM seq`,
  );

  const captured = captureDatabase(db);
  const cleanup = repository.cleanupSchedulerObservation(captured, {
    now: FIXED_NOW,
    retentionDays: 3,
    maxCommandMetrics: 25,
    maxTaskMetrics: 20,
    maxAnomalies: 15,
  });

  assert.equal(cleanup.cutoff, '2026-07-12T12:00:00.000Z');
  assert.equal(db.get("SELECT COUNT(*) AS count FROM command_metric_minutes WHERE command = 'expired'").count, 0);
  assert.equal(db.get("SELECT COUNT(*) AS count FROM task_metric_minutes WHERE task_type = 'expired'").count, 0);
  assert.equal(db.get("SELECT COUNT(*) AS count FROM command_anomalies WHERE category = 'expired'").count, 0);

  repository.querySchedulerObservationSummary({ cutoff: cleanup.cutoff }, captured);
  repository.querySchedulerObservationAnomalies({
    cutoff: cleanup.cutoff,
    page: 1,
    pageSize: 10,
  }, captured);

  const rangeStatement = (method, table, operator) => captured.statements.find((entry) => (
    entry.method === method
    && new RegExp(`(?:FROM|DELETE FROM)\\s+${table}`, 'i').test(entry.sql)
    && entry.sql.includes(operator)
  ));
  const explainDetails = [];
  explainDetails.push(explainStatementUsesRangeIndex(
    db,
    rangeStatement('run', 'command_metric_minutes', '< ?'),
    'idx_command_metrics_bucket',
    'bucket_minute',
  ));
  explainDetails.push(explainStatementUsesRangeIndex(
    db,
    rangeStatement('run', 'task_metric_minutes', '< ?'),
    'idx_task_metrics_bucket',
    'bucket_minute',
  ));
  explainDetails.push(explainStatementUsesRangeIndex(
    db,
    rangeStatement('run', 'command_anomalies', '< ?'),
    'idx_command_anomalies_time',
    'occurred_at',
  ));
  explainDetails.push(explainStatementUsesRangeIndex(
    db,
    rangeStatement('all', 'command_metric_minutes', '>= ?'),
    'idx_command_metrics_bucket',
    'bucket_minute',
  ));
  explainDetails.push(explainStatementUsesRangeIndex(
    db,
    rangeStatement('all', 'task_metric_minutes', '>= ?'),
    'idx_task_metrics_bucket',
    'bucket_minute',
  ));
  explainDetails.push(explainStatementUsesRangeIndex(
    db,
    rangeStatement('all', 'command_anomalies', '>= ?'),
    'idx_command_anomalies_time',
    'occurred_at',
  ));

  assert.equal(db.get('SELECT COUNT(*) AS count FROM command_metric_minutes').count, 25);
  assert.equal(db.get('SELECT COUNT(*) AS count FROM task_metric_minutes').count, 20);
  assert.equal(db.get('SELECT COUNT(*) AS count FROM command_anomalies').count, 15);
  t.diagnostic(JSON.stringify({
    retainedRows: { commandMetrics: 25, taskMetrics: 20, anomalies: 15 },
    indexedSearches: explainDetails.length,
    indexes: [
      'idx_command_metrics_bucket',
      'idx_task_metrics_bucket',
      'idx_command_anomalies_time',
    ],
  }));
});

test('daily cleanup defaults honor configured retention and persisted anomaly caps', () => {
  for (const table of ['command_metric_minutes', 'task_metric_minutes', 'command_anomalies']) {
    db.run(`DELETE FROM ${table}`);
  }
  db.run(
    `WITH RECURSIVE seq(n) AS (
       VALUES(0) UNION ALL SELECT n + 1 FROM seq WHERE n < 1000
     )
     INSERT INTO command_anomalies (occurred_at, category, summary)
     SELECT '2026-07-15T11:00:00.000Z', 'configured-cap', printf('anomaly-%d', n) FROM seq`,
  );

  const cleanup = repository.cleanupSchedulerObservation(db, { now: FIXED_NOW });

  assert.equal(cleanup.cutoff, '2026-07-13T12:00:00.000Z');
  assert.equal(db.get('SELECT COUNT(*) AS count FROM command_anomalies').count, 1000);
});
