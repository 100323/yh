import { getDatabase } from '../database/index.js';
import { sanitizeObservationMessage } from './schedulerObservationCore.js';

const DEFAULT_RETENTION_DAYS = 3;
const DEFAULT_MAX_ANOMALIES = 50_000;
const MAX_INTEGER = Number.MAX_SAFE_INTEGER;
const DEFAULT_IDENTIFIER_LENGTH = 160;

const COMMAND_METRIC_COLUMNS = `
  bucket_minute, source, command_class, task_type, command, execution_lane,
  egress_type, egress_key, outcome, command_count, error_count, timeout_count,
  disconnected_count, rate_limited_count, latency_count, latency_sum_ms,
  latency_max_ms, updated_at
`;
const TASK_METRIC_COLUMNS = `
  bucket_minute, source, task_type, execution_lane, outcome, run_count,
  duration_count, duration_sum_ms, duration_max_ms, queue_wait_count,
  queue_wait_sum_ms, queue_wait_max_ms, attributed_command_count, updated_at
`;
const ANOMALY_COLUMNS = `
  id, occurred_at, run_id, account_id, batch_task_id, source, task_type,
  command, execution_lane, egress_type, egress_key, category, error_code,
  latency_ms, queue_wait_ms, summary
`;

const COMMAND_METRIC_UPSERT = `
  INSERT INTO command_metric_minutes (
    bucket_minute, source, command_class, task_type, command, execution_lane,
    egress_type, egress_key, outcome, command_count, error_count, timeout_count,
    disconnected_count, rate_limited_count, latency_count, latency_sum_ms,
    latency_max_ms
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT (
    bucket_minute, source, command_class, task_type, command, execution_lane,
    egress_type, egress_key, outcome
  ) DO UPDATE SET
    command_count = MIN(9007199254740991, command_metric_minutes.command_count + excluded.command_count),
    error_count = MIN(9007199254740991, command_metric_minutes.error_count + excluded.error_count),
    timeout_count = MIN(9007199254740991, command_metric_minutes.timeout_count + excluded.timeout_count),
    disconnected_count = MIN(9007199254740991, command_metric_minutes.disconnected_count + excluded.disconnected_count),
    rate_limited_count = MIN(9007199254740991, command_metric_minutes.rate_limited_count + excluded.rate_limited_count),
    latency_count = MIN(9007199254740991, command_metric_minutes.latency_count + excluded.latency_count),
    latency_sum_ms = MIN(9007199254740991, command_metric_minutes.latency_sum_ms + excluded.latency_sum_ms),
    latency_max_ms = MAX(command_metric_minutes.latency_max_ms, excluded.latency_max_ms),
    updated_at = CURRENT_TIMESTAMP
`;

const TASK_METRIC_UPSERT = `
  INSERT INTO task_metric_minutes (
    bucket_minute, source, task_type, execution_lane, outcome, run_count,
    duration_count, duration_sum_ms, duration_max_ms, queue_wait_count,
    queue_wait_sum_ms, queue_wait_max_ms, attributed_command_count
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT (bucket_minute, source, task_type, execution_lane, outcome)
  DO UPDATE SET
    run_count = MIN(9007199254740991, task_metric_minutes.run_count + excluded.run_count),
    duration_count = MIN(9007199254740991, task_metric_minutes.duration_count + excluded.duration_count),
    duration_sum_ms = MIN(9007199254740991, task_metric_minutes.duration_sum_ms + excluded.duration_sum_ms),
    duration_max_ms = MAX(task_metric_minutes.duration_max_ms, excluded.duration_max_ms),
    queue_wait_count = MIN(9007199254740991, task_metric_minutes.queue_wait_count + excluded.queue_wait_count),
    queue_wait_sum_ms = MIN(9007199254740991, task_metric_minutes.queue_wait_sum_ms + excluded.queue_wait_sum_ms),
    queue_wait_max_ms = MAX(task_metric_minutes.queue_wait_max_ms, excluded.queue_wait_max_ms),
    attributed_command_count = MIN(9007199254740991, task_metric_minutes.attributed_command_count + excluded.attributed_command_count),
    updated_at = CURRENT_TIMESTAMP
`;

const ANOMALY_INSERT = `
  INSERT INTO command_anomalies (
    occurred_at, run_id, account_id, batch_task_id, source, task_type, command,
    execution_lane, egress_type, egress_key, category, error_code, latency_ms,
    queue_wait_ms, summary
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`;

function normalizeInteger(value, fallback = 0, nullable = false) {
  if (value === null || value === undefined || value === '') {
    return nullable ? null : fallback;
  }
  if (typeof value === 'object' || typeof value === 'function' || typeof value === 'symbol') {
    return nullable ? null : fallback;
  }
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) return nullable ? null : fallback;
  return Math.min(MAX_INTEGER, Math.floor(numeric));
}

function redactNetworkAuthorities(value) {
  return value
    .replace(/\b([a-z][a-z\d+.-]*:\/\/)[^\s/?#]+/gi, '$1[REDACTED]')
    .replace(
      /(?<![A-Za-z\d.-])(?:[^\s:@/]+:[^\s@/]+@)?(?:localhost|(?:\d{1,3}\.){3}\d{1,3}|\[[0-9a-f:]+\]|[a-z\d-]+(?:\.[a-z\d-]+)+):\d{1,5}(?!\d)/gi,
      '[REDACTED]',
    );
}

function normalizeIdentifier(value, maxLength = DEFAULT_IDENTIFIER_LENGTH) {
  if (value === null || value === undefined || value === '') return '';
  if (typeof value === 'object' || typeof value === 'function' || typeof value === 'symbol') return '';
  return redactNetworkAuthorities(sanitizeObservationMessage(String(value), maxLength)).slice(0, maxLength);
}

function readValue(input, dimensions, name) {
  if (input?.[name] !== undefined) return input[name];
  return dimensions?.[name];
}

function normalizeEgressType(value) {
  const normalized = normalizeIdentifier(value, 16).toLowerCase();
  return normalized === 'direct' || normalized === 'proxy' ? normalized : '';
}

function normalizeEgressKey(value) {
  if (typeof value !== 'string') return '';
  const normalized = value.trim().toLowerCase();
  return normalized === 'direct' || /^proxy:[a-f\d]{12}$/.test(normalized) ? normalized : '';
}

function normalizeTimestamp(value, fallback) {
  const candidate = value ?? fallback;
  const date = candidate instanceof Date ? candidate : new Date(candidate);
  if (!Number.isNaN(date.getTime())) return date.toISOString();
  return new Date().toISOString();
}

function normalizeCommandMetric(row) {
  const dimensions = row?.dimensions;
  return [
    normalizeIdentifier(row?.minute, 19),
    normalizeIdentifier(readValue(row, dimensions, 'source')),
    normalizeIdentifier(readValue(row, dimensions, 'commandClass')),
    normalizeIdentifier(readValue(row, dimensions, 'taskType')),
    normalizeIdentifier(readValue(row, dimensions, 'command')),
    normalizeIdentifier(readValue(row, dimensions, 'executionLane')),
    normalizeEgressType(readValue(row, dimensions, 'egressType')),
    normalizeEgressKey(readValue(row, dimensions, 'egressKey')),
    normalizeIdentifier(row?.outcome, 32),
    normalizeInteger(row?.commandCount),
    normalizeInteger(row?.errorCount),
    normalizeInteger(row?.timeoutCount),
    normalizeInteger(row?.disconnectedCount),
    normalizeInteger(row?.rateLimitedCount),
    normalizeInteger(row?.latencyCount),
    normalizeInteger(row?.latencySumMs),
    normalizeInteger(row?.latencyMaxMs),
  ];
}

function normalizeTaskMetric(row) {
  const dimensions = row?.dimensions;
  return [
    normalizeIdentifier(row?.minute, 19),
    normalizeIdentifier(readValue(row, dimensions, 'source')),
    normalizeIdentifier(readValue(row, dimensions, 'taskType')),
    normalizeIdentifier(readValue(row, dimensions, 'executionLane')),
    normalizeIdentifier(row?.outcome, 32),
    normalizeInteger(row?.runCount),
    normalizeInteger(row?.durationCount),
    normalizeInteger(row?.durationSumMs),
    normalizeInteger(row?.durationMaxMs),
    normalizeInteger(row?.queueWaitCount),
    normalizeInteger(row?.queueWaitSumMs),
    normalizeInteger(row?.queueWaitMaxMs),
    normalizeInteger(row?.attributedCommandCount),
  ];
}

function normalizeAnomaly(anomaly, fallbackTimestamp) {
  const dimensions = anomaly?.dimensions;
  const summaryValue = readValue(anomaly, dimensions, 'summary')
    ?? readValue(anomaly, dimensions, 'message');
  const category = readValue(anomaly, dimensions, 'category')
    ?? readValue(anomaly, dimensions, 'type')
    ?? 'UNATTRIBUTED';
  const summary = typeof summaryValue === 'object' || typeof summaryValue === 'function'
    ? ''
    : redactNetworkAuthorities(sanitizeObservationMessage(summaryValue, 300)).slice(0, 300);

  return [
    normalizeTimestamp(anomaly?.occurredAt ?? anomaly?.timestamp, fallbackTimestamp),
    normalizeIdentifier(readValue(anomaly, dimensions, 'runId')) || null,
    normalizeInteger(readValue(anomaly, dimensions, 'accountId'), 0, true),
    normalizeInteger(readValue(anomaly, dimensions, 'batchTaskId'), 0, true),
    normalizeIdentifier(readValue(anomaly, dimensions, 'source')),
    normalizeIdentifier(readValue(anomaly, dimensions, 'taskType')),
    normalizeIdentifier(readValue(anomaly, dimensions, 'command')),
    normalizeIdentifier(readValue(anomaly, dimensions, 'executionLane')),
    normalizeEgressType(readValue(anomaly, dimensions, 'egressType')),
    normalizeEgressKey(readValue(anomaly, dimensions, 'egressKey')),
    normalizeIdentifier(category, 100) || 'UNATTRIBUTED',
    normalizeInteger(readValue(anomaly, dimensions, 'errorCode'), 0, true),
    normalizeInteger(readValue(anomaly, dimensions, 'latencyMs'), 0, true),
    normalizeInteger(readValue(anomaly, dimensions, 'queueWaitMs'), 0, true),
    summary,
  ];
}

function writeCount(result) {
  return Number(result?.changes || 0);
}

export function flushSchedulerObservationSnapshot(snapshot, targetDb = getDatabase()) {
  const commandMetrics = Array.isArray(snapshot?.commandMetrics) ? snapshot.commandMetrics : [];
  const taskMetrics = Array.isArray(snapshot?.taskMetrics) ? snapshot.taskMetrics : [];
  const anomalies = Array.isArray(snapshot?.anomalies) ? snapshot.anomalies : [];
  if (commandMetrics.length === 0 && taskMetrics.length === 0 && anomalies.length === 0) {
    return { commandMetrics: 0, taskMetrics: 0, anomalies: 0 };
  }

  const transaction = targetDb.transaction(() => {
    for (const row of commandMetrics) {
      targetDb.run(COMMAND_METRIC_UPSERT, normalizeCommandMetric(row));
    }
    for (const row of taskMetrics) {
      targetDb.run(TASK_METRIC_UPSERT, normalizeTaskMetric(row));
    }
    for (const anomaly of anomalies) {
      targetDb.run(ANOMALY_INSERT, normalizeAnomaly(anomaly, snapshot?.generatedAt));
    }
  });
  transaction();

  return {
    commandMetrics: commandMetrics.length,
    taskMetrics: taskMetrics.length,
    anomalies: anomalies.length,
  };
}

function resolveCutoff(options) {
  if (options.cutoff !== undefined && options.cutoff !== null) {
    return normalizeTimestamp(options.cutoff);
  }
  const retentionDays = normalizeInteger(options.retentionDays, DEFAULT_RETENTION_DAYS);
  const nowValue = typeof options.now === 'function' ? options.now() : options.now ?? Date.now();
  const now = new Date(nowValue);
  const nowTimestamp = Number.isNaN(now.getTime()) ? Date.now() : now.getTime();
  return new Date(nowTimestamp - retentionDays * 24 * 60 * 60 * 1000).toISOString();
}

export function cleanupSchedulerObservation(targetDb = getDatabase(), options = {}) {
  const cutoff = resolveCutoff(options);
  const maxAnomalies = normalizeInteger(options.maxAnomalies, DEFAULT_MAX_ANOMALIES);
  const result = {
    cutoff,
    commandMetricsDeleted: 0,
    taskMetricsDeleted: 0,
    anomaliesExpiredDeleted: 0,
    anomaliesOverflowDeleted: 0,
  };

  const transaction = targetDb.transaction(() => {
    result.commandMetricsDeleted = writeCount(targetDb.run(
      'DELETE FROM command_metric_minutes WHERE datetime(bucket_minute) < datetime(?)',
      [cutoff],
    ));
    result.taskMetricsDeleted = writeCount(targetDb.run(
      'DELETE FROM task_metric_minutes WHERE datetime(bucket_minute) < datetime(?)',
      [cutoff],
    ));
    result.anomaliesExpiredDeleted = writeCount(targetDb.run(
      'DELETE FROM command_anomalies WHERE datetime(occurred_at) < datetime(?)',
      [cutoff],
    ));
    result.anomaliesOverflowDeleted = writeCount(targetDb.run(
      `DELETE FROM command_anomalies
       WHERE id NOT IN (
         SELECT id FROM command_anomalies
         ORDER BY occurred_at DESC, id DESC
         LIMIT ?
       )`,
      [maxAnomalies],
    ));
  });
  transaction();
  return result;
}

function addFilter(clauses, params, column, value) {
  if (value === undefined || value === null || value === '') return;
  clauses.push(`${column} = ?`);
  params.push(value);
}

function buildSummaryQuery(filters, metricType) {
  const clauses = ['datetime(bucket_minute) >= datetime(?)'];
  const params = [filters.cutoff];
  addFilter(clauses, params, 'source', filters.source);
  addFilter(clauses, params, 'task_type', filters.taskType);
  if (metricType === 'command') {
    addFilter(clauses, params, 'command_class', filters.commandClass);
    addFilter(clauses, params, 'egress_type', filters.egressType);
  }
  return { clauses, params };
}

export function querySchedulerObservationSummary(filters = {}, targetDb = getDatabase()) {
  const commandQuery = buildSummaryQuery(filters, 'command');
  const taskQuery = buildSummaryQuery(filters, 'task');
  return {
    commandMetrics: targetDb.all(
      `SELECT ${COMMAND_METRIC_COLUMNS}
       FROM command_metric_minutes
       WHERE ${commandQuery.clauses.join(' AND ')}
       ORDER BY bucket_minute ASC`,
      commandQuery.params,
    ),
    taskMetrics: targetDb.all(
      `SELECT ${TASK_METRIC_COLUMNS}
       FROM task_metric_minutes
       WHERE ${taskQuery.clauses.join(' AND ')}
       ORDER BY bucket_minute ASC`,
      taskQuery.params,
    ),
  };
}

function buildAnomalyQuery(filters) {
  const clauses = ['datetime(occurred_at) >= datetime(?)'];
  const params = [filters.cutoff];
  addFilter(clauses, params, 'category', filters.category);
  addFilter(clauses, params, 'source', filters.source);
  addFilter(clauses, params, 'task_type', filters.taskType);
  addFilter(clauses, params, 'command', filters.command);
  addFilter(clauses, params, 'egress_type', filters.egressType);
  return { clauses, params };
}

export function querySchedulerObservationAnomalies(filters = {}, targetDb = getDatabase()) {
  const { clauses, params } = buildAnomalyQuery(filters);
  const where = clauses.join(' AND ');
  const total = Number(targetDb.get(
    `SELECT COUNT(*) AS total FROM command_anomalies WHERE ${where}`,
    params,
  )?.total || 0);
  const offset = (filters.page - 1) * filters.pageSize;
  const items = targetDb.all(
    `SELECT ${ANOMALY_COLUMNS}
     FROM command_anomalies
     WHERE ${where}
     ORDER BY occurred_at DESC, id DESC
     LIMIT ? OFFSET ?`,
    [...params, filters.pageSize, offset],
  );
  return { items, total, page: filters.page, pageSize: filters.pageSize };
}
