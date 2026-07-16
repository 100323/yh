import { isIP } from 'node:net';
import { domainToASCII } from 'node:url';
import config from '../config/index.js';
import { getDatabase } from '../database/index.js';
import {
  OBSERVATION_OUTCOMES,
  sanitizeObservationMessage,
} from './schedulerObservationCore.js';

const DEFAULT_RETENTION_DAYS = 3;
const DEFAULT_MAX_COMMAND_METRICS = 50_000;
const DEFAULT_MAX_TASK_METRICS = 20_000;
const DEFAULT_MAX_ANOMALIES = 50_000;
const MAX_INTEGER = Number.MAX_SAFE_INTEGER;
const DEFAULT_IDENTIFIER_LENGTH = 160;
const OBSERVATION_OUTCOME_SET = new Set(OBSERVATION_OUTCOMES);
const SENSITIVE_FIELD_PATTERN_SOURCE = '(?:roleToken|token|params?|arguments?|requests?|responses?|body|stack|proxy)';
const SENSITIVE_IDENTIFIER_DETECTION_PATTERN = new RegExp(SENSITIVE_FIELD_PATTERN_SOURCE, 'i');
const SENSITIVE_SUMMARY_TOKEN_PATTERN = new RegExp(`\\S*${SENSITIVE_FIELD_PATTERN_SOURCE}\\S*`, 'gi');

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

function normalizeCappedInteger(value, fallback, hardMaximum) {
  return Math.min(hardMaximum, normalizeInteger(value, Math.min(fallback, hardMaximum)));
}

function normalizeNfkc(value) {
  if (typeof value !== 'string') return null;
  try {
    return value.normalize('NFKC');
  } catch {
    return null;
  }
}

function normalizeIpHost(value) {
  let host = value;
  if (host.startsWith('[') && host.endsWith(']')) host = host.slice(1, -1);
  const zoneIndex = host.indexOf('%');
  if (zoneIndex >= 0) host = host.slice(0, zoneIndex);
  return host;
}

function isDottedHostname(value) {
  const host = value.replace(/\.$/, '');
  if (!host.includes('.')) return false;
  if (/^\d+(?:\.\d+)+$/.test(host)) return false;
  try {
    const ascii = domainToASCII(host);
    return ascii.includes('.') && ascii.split('.').every((label) => (
      label.length > 0
      && label.length <= 63
      && /^[a-z\d](?:[a-z\d-]*[a-z\d])?$/i.test(label)
    ));
  } catch {
    return false;
  }
}

function isNetworkHost(value) {
  const host = normalizeIpHost(value);
  return isIP(host) !== 0
    || /^\d+$/.test(host)
    || /^localhost$/i.test(host)
    || isDottedHostname(host);
}

function isNetworkCandidate(rawToken) {
  let token = rawToken
    .replace(/^[({<"'`]+/u, '')
    .replace(/[)}>;,"'`!?]+$/u, '');
  const equalsIndex = token.lastIndexOf('=');
  if (equalsIndex >= 0) token = token.slice(equalsIndex + 1);
  token = token.split(/[/?#]/u, 1)[0];
  if (!token) return false;

  const bracketed = /^\[([^\]]+)\](?::\d{1,5})?$/u.exec(token);
  if (bracketed) return isIP(normalizeIpHost(bracketed[1])) !== 0;

  if (isIP(normalizeIpHost(token)) !== 0) return true;
  if (token.includes('%') && isIP(normalizeIpHost(token)) !== 0) return true;

  const hostWithPort = /^(.*):(\d{1,5})$/u.exec(token);
  if (hostWithPort && isNetworkHost(hostWithPort[1])) return true;

  return isNetworkHost(token) && (token.includes('.') || /^localhost$/i.test(token));
}

function redactNetworkAuthorities(value) {
  return value
    .replace(/\b([a-z][a-z\d+.-]*:\/\/)[^\s/?#]+/gi, '$1[REDACTED]')
    .replace(/(^|[\s([{=])\/\/[^\s/?#]+/g, '$1//[REDACTED]')
    .replace(/\S+/gu, (token) => (isNetworkCandidate(token) ? '[REDACTED]' : token));
}

function normalizeIdentifier(value, maxLength = DEFAULT_IDENTIFIER_LENGTH) {
  const normalized = normalizeNfkc(value);
  if (normalized === null || normalized === '') return '';
  const sanitized = sanitizeObservationMessage(normalized, Number.MAX_SAFE_INTEGER);
  if (SENSITIVE_IDENTIFIER_DETECTION_PATTERN.test(sanitized)) return '[REDACTED]';
  return redactNetworkAuthorities(sanitized).slice(0, maxLength);
}

function normalizeSummary(value, maxLength = 300) {
  const normalized = normalizeNfkc(value);
  if (normalized === null || normalized === '') return '';
  const sanitized = sanitizeObservationMessage(normalized, Number.MAX_SAFE_INTEGER);
  return redactNetworkAuthorities(sanitized)
    .replace(SENSITIVE_SUMMARY_TOKEN_PATTERN, '[REDACTED]')
    .slice(0, maxLength);
}

function readValue(input, dimensions, name) {
  if (input?.[name] !== undefined) return input[name];
  return dimensions?.[name];
}

function normalizeEgressType(value) {
  const normalizedValue = normalizeNfkc(value);
  if (normalizedValue === null) return '';
  const normalized = normalizedValue.trim().toLowerCase();
  return normalized === 'direct' || normalized === 'proxy' ? normalized : '';
}

function normalizeExecutionLane(value) {
  const normalizedValue = normalizeNfkc(value);
  if (normalizedValue !== null) {
    const normalized = normalizedValue.trim().toLowerCase();
    if (normalized === 'direct' || normalized === 'proxy') return normalized;
  }
  return normalizeIdentifier(value);
}

function normalizeEgressKey(value) {
  const normalizedValue = normalizeNfkc(value);
  if (normalizedValue === null) return '';
  const normalized = normalizedValue.trim().toLowerCase();
  return normalized === 'direct' || /^proxy:[a-f\d]{12}$/.test(normalized) ? normalized : '';
}

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function parseTimestamp(value) {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.getTime();
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const normalized = normalizeNfkc(value);
  if (normalized === null || normalized.trim() === '') return null;
  const parsed = Date.parse(normalized.trim());
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeTimestamp(value, label = 'timestamp') {
  const timestamp = parseTimestamp(value);
  if (timestamp === null) throw new RangeError(`${label} is invalid`);
  return new Date(timestamp).toISOString();
}

function normalizeBucketMinute(row) {
  const value = row.minute ?? row.bucketMinute;
  if (parseTimestamp(value) === null) throw new RangeError('metric minute is invalid');
  if (value instanceof Date || typeof value === 'number') return new Date(parseTimestamp(value)).toISOString();
  const normalized = normalizeNfkc(value)?.trim() ?? '';
  if (normalized.length > 40 || /[\u0000-\u001f\u007f-\u009f]/.test(normalized)) {
    throw new RangeError('metric minute is invalid');
  }
  return normalized;
}

function validateMetricRow(row, metricType) {
  if (!isPlainObject(row)) throw new TypeError(`${metricType} metric row must be a plain object`);
  if (!isPlainObject(row.dimensions)) {
    throw new TypeError(`${metricType} metric dimensions must be a plain object`);
  }
  normalizeBucketMinute(row);
  if (!OBSERVATION_OUTCOME_SET.has(row.outcome)) {
    throw new RangeError(`${metricType} metric outcome is invalid`);
  }
}

function validateAnomalyRow(anomaly) {
  if (!isPlainObject(anomaly)) throw new TypeError('anomaly row must be a plain object');
  if (!isPlainObject(anomaly.dimensions)) {
    throw new TypeError('anomaly dimensions must be a plain object');
  }
  normalizeTimestamp(anomaly.occurredAt ?? anomaly.timestamp, 'anomaly occurrence');
  const category = anomaly.category ?? anomaly.type;
  if (
    category === null
    || category === undefined
    || category === ''
    || typeof category === 'object'
    || typeof category === 'function'
    || typeof category === 'symbol'
  ) {
    throw new TypeError('anomaly requires category or type');
  }
}

function normalizeCommandMetric(row) {
  validateMetricRow(row, 'command');
  const dimensions = row.dimensions;
  return [
    normalizeBucketMinute(row),
    normalizeIdentifier(readValue(row, dimensions, 'source')),
    normalizeIdentifier(readValue(row, dimensions, 'commandClass')),
    normalizeIdentifier(readValue(row, dimensions, 'taskType')),
    normalizeIdentifier(readValue(row, dimensions, 'command')),
    normalizeExecutionLane(readValue(row, dimensions, 'executionLane')),
    normalizeEgressType(readValue(row, dimensions, 'egressType')),
    normalizeEgressKey(readValue(row, dimensions, 'egressKey')),
    row.outcome,
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
  validateMetricRow(row, 'task');
  const dimensions = row.dimensions;
  return [
    normalizeBucketMinute(row),
    normalizeIdentifier(readValue(row, dimensions, 'source')),
    normalizeIdentifier(readValue(row, dimensions, 'taskType')),
    normalizeExecutionLane(readValue(row, dimensions, 'executionLane')),
    row.outcome,
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

function normalizeAnomaly(anomaly) {
  validateAnomalyRow(anomaly);
  const dimensions = anomaly.dimensions;
  const summaryValue = readValue(anomaly, dimensions, 'summary')
    ?? readValue(anomaly, dimensions, 'message');
  const category = readValue(anomaly, dimensions, 'category')
    ?? readValue(anomaly, dimensions, 'type');
  const summary = typeof summaryValue === 'object' || typeof summaryValue === 'function'
    ? ''
    : normalizeSummary(summaryValue, 300);

  return [
    normalizeTimestamp(anomaly.occurredAt ?? anomaly.timestamp, 'anomaly occurrence'),
    normalizeIdentifier(readValue(anomaly, dimensions, 'runId')) || null,
    normalizeInteger(readValue(anomaly, dimensions, 'accountId'), 0, true),
    normalizeInteger(readValue(anomaly, dimensions, 'batchTaskId'), 0, true),
    normalizeIdentifier(readValue(anomaly, dimensions, 'source')),
    normalizeIdentifier(readValue(anomaly, dimensions, 'taskType')),
    normalizeIdentifier(readValue(anomaly, dimensions, 'command')),
    normalizeExecutionLane(readValue(anomaly, dimensions, 'executionLane')),
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

function trimObservationRows(targetDb, {
  maxCommandMetrics = DEFAULT_MAX_COMMAND_METRICS,
  maxTaskMetrics = DEFAULT_MAX_TASK_METRICS,
  maxAnomalies = normalizeCappedInteger(
    config.observability?.maxAnomalyRows,
    DEFAULT_MAX_ANOMALIES,
    DEFAULT_MAX_ANOMALIES,
  ),
} = {}) {
  const commandMetricsDeleted = writeCount(targetDb.run(
    `DELETE FROM command_metric_minutes
     WHERE rowid NOT IN (
       SELECT rowid FROM command_metric_minutes
       ORDER BY bucket_minute DESC, rowid DESC
       LIMIT ?
     )`,
    [maxCommandMetrics],
  ));
  const taskMetricsDeleted = writeCount(targetDb.run(
    `DELETE FROM task_metric_minutes
     WHERE rowid NOT IN (
       SELECT rowid FROM task_metric_minutes
       ORDER BY bucket_minute DESC, rowid DESC
       LIMIT ?
     )`,
    [maxTaskMetrics],
  ));
  const anomaliesDeleted = writeCount(targetDb.run(
    `DELETE FROM command_anomalies
     WHERE id NOT IN (
       SELECT id FROM command_anomalies
       ORDER BY occurred_at DESC, id DESC
       LIMIT ?
     )`,
    [maxAnomalies],
  ));
  return { commandMetricsDeleted, taskMetricsDeleted, anomaliesDeleted };
}

export function flushSchedulerObservationSnapshot(snapshot, targetDb = getDatabase()) {
  if (!isPlainObject(snapshot)) throw new TypeError('snapshot must be a plain object');
  if (!Array.isArray(snapshot.commandMetrics)) throw new TypeError('snapshot commandMetrics must be an array');
  if (!Array.isArray(snapshot.taskMetrics)) throw new TypeError('snapshot taskMetrics must be an array');
  if (!Array.isArray(snapshot.anomalies)) throw new TypeError('snapshot anomalies must be an array');

  const commandMetrics = snapshot.commandMetrics.map(normalizeCommandMetric);
  const taskMetrics = snapshot.taskMetrics.map(normalizeTaskMetric);
  const anomalies = snapshot.anomalies.map(normalizeAnomaly);

  const transaction = targetDb.transaction(() => {
    for (const params of commandMetrics) {
      targetDb.run(COMMAND_METRIC_UPSERT, params);
    }
    for (const params of taskMetrics) {
      targetDb.run(TASK_METRIC_UPSERT, params);
    }
    for (const params of anomalies) {
      targetDb.run(ANOMALY_INSERT, params);
    }
    trimObservationRows(targetDb);
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
    return normalizeTimestamp(options.cutoff, 'cleanup cutoff');
  }
  const retentionDays = normalizeCappedInteger(
    options.retentionDays,
    config.observability?.retentionDays ?? DEFAULT_RETENTION_DAYS,
    DEFAULT_RETENTION_DAYS,
  );
  const nowValue = typeof options.now === 'function' ? options.now() : options.now ?? Date.now();
  const now = new Date(nowValue);
  const nowTimestamp = Number.isNaN(now.getTime()) ? Date.now() : now.getTime();
  return new Date(nowTimestamp - retentionDays * 24 * 60 * 60 * 1000).toISOString();
}

function indexedTimeBounds(cutoff) {
  if (parseTimestamp(cutoff) === null) throw new RangeError('query cutoff is invalid');
  const rawCutoff = typeof cutoff === 'string' ? normalizeNfkc(cutoff)?.trim() : null;
  const normalizedCutoff = rawCutoff || normalizeTimestamp(cutoff, 'query cutoff');
  const utcDate = normalizeTimestamp(cutoff, 'query cutoff').slice(0, 10);
  const lowerDate = new Date(`${utcDate}T00:00:00.000Z`);
  lowerDate.setUTCDate(lowerDate.getUTCDate() - 1);
  const upperDate = new Date(`${utcDate}T00:00:00.000Z`);
  upperDate.setUTCDate(upperDate.getUTCDate() + 2);
  const lowerIso = lowerDate.toISOString();
  const upperIso = upperDate.toISOString();
  return {
    cutoff: normalizedCutoff,
    lowerBound: /^\d{4}-\d{2}-\d{2}T/u.test(lowerIso) ? lowerIso.slice(0, 10) : '',
    upperBound: /^\d{4}-\d{2}-\d{2}T/u.test(upperIso) ? upperIso.slice(0, 10) : ':',
  };
}

export function cleanupSchedulerObservation(targetDb = getDatabase(), options = {}) {
  const cutoff = resolveCutoff(options);
  const timeBounds = indexedTimeBounds(cutoff);
  const maxCommandMetrics = normalizeCappedInteger(
    options.maxCommandMetrics,
    DEFAULT_MAX_COMMAND_METRICS,
    DEFAULT_MAX_COMMAND_METRICS,
  );
  const maxTaskMetrics = normalizeCappedInteger(
    options.maxTaskMetrics,
    DEFAULT_MAX_TASK_METRICS,
    DEFAULT_MAX_TASK_METRICS,
  );
  const maxAnomalies = normalizeCappedInteger(
    options.maxAnomalies,
    config.observability?.maxAnomalyRows ?? DEFAULT_MAX_ANOMALIES,
    DEFAULT_MAX_ANOMALIES,
  );
  const result = {
    cutoff,
    commandMetricsDeleted: 0,
    commandMetricsOverflowDeleted: 0,
    taskMetricsDeleted: 0,
    taskMetricsOverflowDeleted: 0,
    anomaliesExpiredDeleted: 0,
    anomaliesOverflowDeleted: 0,
  };

  const transaction = targetDb.transaction(() => {
    result.commandMetricsDeleted += writeCount(targetDb.run(
      `DELETE FROM command_metric_minutes
       WHERE julianday(bucket_minute) IS NULL`,
    ));
    result.commandMetricsDeleted += writeCount(targetDb.run(
      `DELETE FROM command_metric_minutes
       WHERE bucket_minute < ? AND julianday(bucket_minute) < julianday(?)`,
      [timeBounds.upperBound, cutoff],
    ));
    result.taskMetricsDeleted += writeCount(targetDb.run(
      `DELETE FROM task_metric_minutes
       WHERE julianday(bucket_minute) IS NULL`,
    ));
    result.taskMetricsDeleted += writeCount(targetDb.run(
      `DELETE FROM task_metric_minutes
       WHERE bucket_minute < ? AND julianday(bucket_minute) < julianday(?)`,
      [timeBounds.upperBound, cutoff],
    ));
    result.anomaliesExpiredDeleted += writeCount(targetDb.run(
      `DELETE FROM command_anomalies
       WHERE julianday(occurred_at) IS NULL`,
    ));
    result.anomaliesExpiredDeleted += writeCount(targetDb.run(
      `DELETE FROM command_anomalies
       WHERE occurred_at < ? AND julianday(occurred_at) < julianday(?)`,
      [timeBounds.upperBound, cutoff],
    ));
    const overflow = trimObservationRows(targetDb, {
      maxCommandMetrics,
      maxTaskMetrics,
      maxAnomalies,
    });
    result.commandMetricsOverflowDeleted = overflow.commandMetricsDeleted;
    result.taskMetricsOverflowDeleted = overflow.taskMetricsDeleted;
    result.anomaliesOverflowDeleted = overflow.anomaliesDeleted;
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
  const timeBounds = indexedTimeBounds(filters.cutoff);
  const clauses = [
    'bucket_minute >= ?',
    'julianday(bucket_minute) >= julianday(?)',
  ];
  const params = [timeBounds.lowerBound, timeBounds.cutoff];
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
  const timeBounds = indexedTimeBounds(filters.cutoff);
  const clauses = [
    'occurred_at >= ?',
    'julianday(occurred_at) >= julianday(?)',
  ];
  const params = [timeBounds.lowerBound, timeBounds.cutoff];
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
