import { Router } from 'express';
import { get, all } from '../database/index.js';
import { adminOnly, authMiddleware } from '../middleware/auth.js';
import { getScheduledJobs, getActiveConnections } from '../scheduler/index.js';
import { getScheduledBatchJobs, getActiveBatchConnections } from '../batchScheduler/index.js';
import { getAccountTaskCoordinatorStatus } from '../utils/accountTaskCoordinator.js';
import { getNextRunAt, resolveBatchCronExpression, isNextRunPendingToday } from '../utils/cronSchedule.js';
import {
  querySchedulerObservationAnomalies,
  querySchedulerObservationSummary,
} from '../observability/schedulerObservationRepository.js';
import { getSchedulerObservationHealth } from '../observability/schedulerObservationService.js';

const OBSERVABILITY_RANGE_MS = Object.freeze({
  '1h': 60 * 60 * 1000,
  '6h': 6 * 60 * 60 * 1000,
  '24h': 24 * 60 * 60 * 1000,
  '3d': 3 * 24 * 60 * 60 * 1000,
});
const DEFAULT_OBSERVABILITY_RANGE = '24h';
const DEFAULT_OBSERVABILITY_PAGE_SIZE = 25;
const MAX_OBSERVABILITY_PAGE_SIZE = 100;
const SAFE_FILTER_PATTERN = /^[A-Za-z0-9_.:-]{1,100}$/u;
const HEALTH_BOOLEAN_FIELDS = ['enabled', 'started'];
const HEALTH_NUMBER_FIELDS = [
  'flushErrors',
  'mergeErrors',
  'droppedRetrySnapshots',
  'observationErrors',
  'healthErrors',
  'lastFlushDurationMs',
  'pendingQueueWaits',
  'droppedQueueWaits',
  'metricKeys',
  'anomalyCount',
  'droppedMetrics',
  'droppedAnomalies',
];
const MAX_SAFE_OBSERVABILITY_NUMBER = Number.MAX_SAFE_INTEGER;

function safeRead(input, property) {
  try {
    return { ok: true, value: input?.[property] };
  } catch {
    return { ok: false, value: undefined };
  }
}

function normalizeClock(now) {
  try {
    const value = typeof now === 'function' ? now() : now;
    const date = new Date(value ?? Date.now());
    if (!Number.isNaN(date.getTime())) return date;
  } catch {
    // Use a server clock if an injected clock is unavailable.
  }
  return new Date();
}

function normalizePositiveInteger(value, fallback, maximum = MAX_SAFE_OBSERVABILITY_NUMBER) {
  if (!['number', 'string', 'bigint'].includes(typeof value) || value === '') return fallback;
  try {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return fallback;
    return Math.min(maximum, Math.max(1, Math.floor(numeric)));
  } catch {
    return fallback;
  }
}

function normalizeFilter(query, name, validator = (value) => SAFE_FILTER_PATTERN.test(value)) {
  const read = safeRead(query, name);
  if (!read.ok) return { ok: false };
  if (read.value === undefined || read.value === null || read.value === '') {
    return { ok: true, value: undefined };
  }
  if (typeof read.value !== 'string') return { ok: false };
  const value = read.value.trim();
  return validator(value) ? { ok: true, value } : { ok: false };
}

export function normalizeObservabilityQuery(query = {}, { now = Date.now } = {}) {
  if (query === null || typeof query !== 'object' || Array.isArray(query)) {
    return { ok: false, error: 'Invalid observability query' };
  }

  const rangeRead = safeRead(query, 'range');
  if (!rangeRead.ok) return { ok: false, error: 'Invalid observability query' };
  const range = rangeRead.value === undefined
    ? DEFAULT_OBSERVABILITY_RANGE
    : rangeRead.value;
  if (typeof range !== 'string' || !Object.hasOwn(OBSERVABILITY_RANGE_MS, range)) {
    return { ok: false, error: 'Invalid observability query' };
  }

  const normalizedFilters = {};
  for (const name of ['category', 'source', 'taskType']) {
    const normalized = normalizeFilter(query, name);
    if (!normalized.ok) return { ok: false, error: 'Invalid observability query' };
    if (normalized.value !== undefined) normalizedFilters[name] = normalized.value;
  }
  const egressType = normalizeFilter(
    query,
    'egressType',
    (value) => value === 'direct' || value === 'proxy',
  );
  if (!egressType.ok) return { ok: false, error: 'Invalid observability query' };
  if (egressType.value !== undefined) normalizedFilters.egressType = egressType.value;

  const pageRead = safeRead(query, 'page');
  const pageSizeRead = safeRead(query, 'pageSize');
  if (!pageRead.ok || !pageSizeRead.ok) {
    return { ok: false, error: 'Invalid observability query' };
  }
  const generatedAtDate = normalizeClock(now);
  const generatedAt = generatedAtDate.toISOString();
  return {
    ok: true,
    value: {
      range,
      generatedAt,
      cutoff: new Date(generatedAtDate.getTime() - OBSERVABILITY_RANGE_MS[range]).toISOString(),
      page: normalizePositiveInteger(pageRead.value, 1),
      pageSize: normalizePositiveInteger(
        pageSizeRead.value,
        DEFAULT_OBSERVABILITY_PAGE_SIZE,
        MAX_OBSERVABILITY_PAGE_SIZE,
      ),
      ...normalizedFilters,
    },
  };
}

function finiteNonNegative(value) {
  if (!['number', 'string', 'bigint'].includes(typeof value) || value === '') return 0;
  try {
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric < 0) return 0;
    return Math.min(MAX_SAFE_OBSERVABILITY_NUMBER, numeric);
  } catch {
    return 0;
  }
}

function safeAdd(left, right) {
  return Math.min(MAX_SAFE_OBSERVABILITY_NUMBER, finiteNonNegative(left) + finiteNonNegative(right));
}

function roundedRatio(numerator, denominator) {
  const safeDenominator = finiteNonNegative(denominator);
  if (safeDenominator === 0) return 0;
  const ratio = finiteNonNegative(numerator) / safeDenominator;
  return Number.isFinite(ratio) ? Number(ratio.toFixed(4)) : 0;
}

function rowValue(row, property) {
  return safeRead(row, property).value;
}

function normalizePublicIdentifier(value, fallback = 'UNATTRIBUTED') {
  if (typeof value !== 'string') return fallback;
  const normalized = value.trim();
  if (!SAFE_FILTER_PATTERN.test(normalized)) return fallback;
  if (/(?:token|params?|body|stack)/iu.test(normalized)) return '[REDACTED]';
  return normalized;
}

function normalizeBucket(value) {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  if (normalized.length === 0 || normalized.length > 40 || !Number.isFinite(Date.parse(normalized))) {
    return null;
  }
  return normalized;
}

function createBucketAggregate(bucket) {
  return {
    bucket,
    commandCount: 0,
    errorCount: 0,
    timeoutCount: 0,
    rateLimitedCount: 0,
    latencyCount: 0,
    latencySumMs: 0,
    latencyMaxMs: 0,
    taskCount: 0,
    taskErrorCount: 0,
    durationCount: 0,
    durationSumMs: 0,
    maxQueueWaitMs: 0,
  };
}

function createTaskAggregate(taskType) {
  return {
    taskType,
    runCount: 0,
    errorCount: 0,
    timeoutCount: 0,
    durationCount: 0,
    durationSumMs: 0,
    maxDurationMs: 0,
    queueWaitCount: 0,
    queueWaitSumMs: 0,
    maxQueueWaitMs: 0,
    attributedCommandCount: 0,
    commandCount: 0,
  };
}

function normalizeEgressType(value) {
  return value === 'direct' || value === 'proxy' ? value : 'unknown';
}

function normalizeEgressKey(value, type) {
  if (value === 'direct') return 'direct';
  if (typeof value === 'string' && /^proxy:[a-f\d]{12}$/u.test(value)) return value;
  return type === 'direct' ? 'direct' : 'unknown';
}

function createEgressAggregate(type, key) {
  return {
    type,
    key,
    commandCount: 0,
    errorCount: 0,
    timeoutCount: 0,
    disconnectedCount: 0,
    rateLimitedCount: 0,
    latencyCount: 0,
    latencySumMs: 0,
    latencyMaxMs: 0,
  };
}

function serializeHealth(health) {
  const result = {};
  if (health === null || typeof health !== 'object') return result;
  for (const name of HEALTH_BOOLEAN_FIELDS) {
    const value = rowValue(health, name);
    if (typeof value === 'boolean') result[name] = value;
  }
  const lastFlushAt = rowValue(health, 'lastFlushAt');
  if (lastFlushAt === null) result.lastFlushAt = null;
  else if (typeof lastFlushAt === 'string' && Number.isFinite(Date.parse(lastFlushAt))) {
    result.lastFlushAt = new Date(lastFlushAt).toISOString();
  }
  for (const name of HEALTH_NUMBER_FIELDS) {
    const value = rowValue(health, name);
    if (value !== undefined && value !== null) result[name] = finiteNonNegative(value);
  }
  return result;
}

export function buildSchedulerObservabilitySummary(raw = {}, options = {}) {
  const commandMetrics = Array.isArray(rowValue(raw, 'commandMetrics'))
    ? rowValue(raw, 'commandMetrics')
    : [];
  const taskMetrics = Array.isArray(rowValue(raw, 'taskMetrics'))
    ? rowValue(raw, 'taskMetrics')
    : [];
  const buckets = new Map();
  const tasks = new Map();
  const egresses = new Map();
  const headline = {
    currentCommandRate: 0,
    peakCommandRate: 0,
    rateLimitedCount: 0,
    timeoutCount: 0,
    averageLatencyMs: 0,
    maxQueueWaitMs: 0,
    commandCount: 0,
    taskCount: 0,
    commandErrorRate: 0,
    commandAmplification: 0,
  };
  let commandErrorCount = 0;
  let latencyCount = 0;
  let latencySumMs = 0;

  for (const row of commandMetrics) {
    if (row === null || typeof row !== 'object') continue;
    const bucketName = normalizeBucket(rowValue(row, 'bucket_minute'));
    if (bucketName === null) continue;
    if (!buckets.has(bucketName)) buckets.set(bucketName, createBucketAggregate(bucketName));
    const bucket = buckets.get(bucketName);
    const commandCount = finiteNonNegative(rowValue(row, 'command_count'));
    const errorCount = finiteNonNegative(rowValue(row, 'error_count'));
    const timeoutCount = finiteNonNegative(rowValue(row, 'timeout_count'));
    const disconnectedCount = finiteNonNegative(rowValue(row, 'disconnected_count'));
    const rateLimitedCount = finiteNonNegative(rowValue(row, 'rate_limited_count'));
    const rowLatencyCount = finiteNonNegative(rowValue(row, 'latency_count'));
    const rowLatencySumMs = rowLatencyCount > 0
      ? finiteNonNegative(rowValue(row, 'latency_sum_ms'))
      : 0;
    const latencyMaxMs = finiteNonNegative(rowValue(row, 'latency_max_ms'));
    bucket.commandCount = safeAdd(bucket.commandCount, commandCount);
    bucket.errorCount = safeAdd(bucket.errorCount, errorCount);
    bucket.timeoutCount = safeAdd(bucket.timeoutCount, timeoutCount);
    bucket.rateLimitedCount = safeAdd(bucket.rateLimitedCount, rateLimitedCount);
    bucket.latencyCount = safeAdd(bucket.latencyCount, rowLatencyCount);
    bucket.latencySumMs = safeAdd(bucket.latencySumMs, rowLatencySumMs);
    bucket.latencyMaxMs = Math.max(bucket.latencyMaxMs, latencyMaxMs);
    headline.commandCount = safeAdd(headline.commandCount, commandCount);
    commandErrorCount = safeAdd(commandErrorCount, errorCount);
    headline.timeoutCount = safeAdd(headline.timeoutCount, timeoutCount);
    headline.rateLimitedCount = safeAdd(headline.rateLimitedCount, rateLimitedCount);
    latencyCount = safeAdd(latencyCount, rowLatencyCount);
    latencySumMs = safeAdd(latencySumMs, rowLatencySumMs);

    const taskType = normalizePublicIdentifier(rowValue(row, 'task_type'));
    if (!tasks.has(taskType)) tasks.set(taskType, createTaskAggregate(taskType));
    tasks.get(taskType).commandCount = safeAdd(tasks.get(taskType).commandCount, commandCount);

    const egressType = normalizeEgressType(rowValue(row, 'egress_type'));
    const egressKey = normalizeEgressKey(rowValue(row, 'egress_key'), egressType);
    const egressMapKey = `${egressType}\u0000${egressKey}`;
    if (!egresses.has(egressMapKey)) {
      egresses.set(egressMapKey, createEgressAggregate(egressType, egressKey));
    }
    const egress = egresses.get(egressMapKey);
    egress.commandCount = safeAdd(egress.commandCount, commandCount);
    egress.errorCount = safeAdd(egress.errorCount, errorCount);
    egress.timeoutCount = safeAdd(egress.timeoutCount, timeoutCount);
    egress.disconnectedCount = safeAdd(egress.disconnectedCount, disconnectedCount);
    egress.rateLimitedCount = safeAdd(egress.rateLimitedCount, rateLimitedCount);
    egress.latencyCount = safeAdd(egress.latencyCount, rowLatencyCount);
    egress.latencySumMs = safeAdd(egress.latencySumMs, rowLatencySumMs);
    egress.latencyMaxMs = Math.max(egress.latencyMaxMs, latencyMaxMs);
  }

  for (const row of taskMetrics) {
    if (row === null || typeof row !== 'object') continue;
    const bucketName = normalizeBucket(rowValue(row, 'bucket_minute'));
    if (bucketName === null) continue;
    if (!buckets.has(bucketName)) buckets.set(bucketName, createBucketAggregate(bucketName));
    const bucket = buckets.get(bucketName);
    const runCount = finiteNonNegative(rowValue(row, 'run_count'));
    const durationCount = finiteNonNegative(rowValue(row, 'duration_count'));
    const durationSumMs = durationCount > 0
      ? finiteNonNegative(rowValue(row, 'duration_sum_ms'))
      : 0;
    const durationMaxMs = finiteNonNegative(rowValue(row, 'duration_max_ms'));
    const queueWaitCount = finiteNonNegative(rowValue(row, 'queue_wait_count'));
    const queueWaitSumMs = queueWaitCount > 0
      ? finiteNonNegative(rowValue(row, 'queue_wait_sum_ms'))
      : 0;
    const queueWaitMaxMs = finiteNonNegative(rowValue(row, 'queue_wait_max_ms'));
    const attributedCommandCount = finiteNonNegative(rowValue(row, 'attributed_command_count'));
    const outcome = rowValue(row, 'outcome');
    const errorCount = outcome === 'error' ? runCount : 0;
    const timeoutCount = outcome === 'timeout' ? runCount : 0;
    bucket.taskCount = safeAdd(bucket.taskCount, runCount);
    bucket.taskErrorCount = safeAdd(bucket.taskErrorCount, errorCount);
    bucket.durationCount = safeAdd(bucket.durationCount, durationCount);
    bucket.durationSumMs = safeAdd(bucket.durationSumMs, durationSumMs);
    bucket.maxQueueWaitMs = Math.max(bucket.maxQueueWaitMs, queueWaitMaxMs);
    headline.taskCount = safeAdd(headline.taskCount, runCount);
    headline.maxQueueWaitMs = Math.max(headline.maxQueueWaitMs, queueWaitMaxMs);

    const taskType = normalizePublicIdentifier(rowValue(row, 'task_type'));
    if (!tasks.has(taskType)) tasks.set(taskType, createTaskAggregate(taskType));
    const task = tasks.get(taskType);
    task.runCount = safeAdd(task.runCount, runCount);
    task.errorCount = safeAdd(task.errorCount, errorCount);
    task.timeoutCount = safeAdd(task.timeoutCount, timeoutCount);
    task.durationCount = safeAdd(task.durationCount, durationCount);
    task.durationSumMs = safeAdd(task.durationSumMs, durationSumMs);
    task.maxDurationMs = Math.max(task.maxDurationMs, durationMaxMs);
    task.queueWaitCount = safeAdd(task.queueWaitCount, queueWaitCount);
    task.queueWaitSumMs = safeAdd(task.queueWaitSumMs, queueWaitSumMs);
    task.maxQueueWaitMs = Math.max(task.maxQueueWaitMs, queueWaitMaxMs);
    task.attributedCommandCount = safeAdd(task.attributedCommandCount, attributedCommandCount);
  }

  const series = Array.from(buckets.values())
    .sort((left, right) => left.bucket.localeCompare(right.bucket))
    .map((bucket) => ({
      bucket: bucket.bucket,
      commandCount: bucket.commandCount,
      errorCount: bucket.errorCount,
      timeoutCount: bucket.timeoutCount,
      rateLimitedCount: bucket.rateLimitedCount,
      averageLatencyMs: roundedRatio(bucket.latencySumMs, bucket.latencyCount),
      maxLatencyMs: bucket.latencyMaxMs,
      taskCount: bucket.taskCount,
      taskErrorCount: bucket.taskErrorCount,
      averageTaskDurationMs: roundedRatio(bucket.durationSumMs, bucket.durationCount),
      maxQueueWaitMs: bucket.maxQueueWaitMs,
    }));
  headline.currentCommandRate = series.at(-1)?.commandCount ?? 0;
  headline.peakCommandRate = series.reduce(
    (peak, bucket) => Math.max(peak, bucket.commandCount),
    0,
  );
  headline.averageLatencyMs = roundedRatio(latencySumMs, latencyCount);
  headline.commandErrorRate = roundedRatio(commandErrorCount, headline.commandCount);
  headline.commandAmplification = roundedRatio(headline.commandCount, headline.taskCount);

  const serializedTasks = Array.from(tasks.values())
    .sort((left, right) => left.taskType.localeCompare(right.taskType))
    .map((task) => ({
      taskType: task.taskType,
      runCount: task.runCount,
      errorCount: task.errorCount,
      timeoutCount: task.timeoutCount,
      averageDurationMs: roundedRatio(task.durationSumMs, task.durationCount),
      maxDurationMs: task.maxDurationMs,
      averageQueueWaitMs: roundedRatio(task.queueWaitSumMs, task.queueWaitCount),
      maxQueueWaitMs: task.maxQueueWaitMs,
      attributedCommandCount: task.attributedCommandCount,
      commandCount: task.commandCount,
      errorRate: roundedRatio(task.errorCount, task.runCount),
      commandAmplification: roundedRatio(task.commandCount, task.runCount),
    }));
  const serializedEgresses = Array.from(egresses.values())
    .sort((left, right) => left.type.localeCompare(right.type) || left.key.localeCompare(right.key))
    .map((egress) => ({
      type: egress.type,
      key: egress.key,
      commandCount: egress.commandCount,
      errorCount: egress.errorCount,
      timeoutCount: egress.timeoutCount,
      disconnectedCount: egress.disconnectedCount,
      rateLimitedCount: egress.rateLimitedCount,
      averageLatencyMs: roundedRatio(egress.latencySumMs, egress.latencyCount),
      maxLatencyMs: egress.latencyMaxMs,
      errorRate: roundedRatio(egress.errorCount, egress.commandCount),
    }));

  return {
    range: Object.hasOwn(OBSERVABILITY_RANGE_MS, options.range)
      ? options.range
      : DEFAULT_OBSERVABILITY_RANGE,
    generatedAt: normalizeClock(options.generatedAt).toISOString(),
    headline,
    series,
    tasks: serializedTasks,
    egresses: serializedEgresses,
    health: serializeHealth(options.health),
  };
}

function publicNullableInteger(value) {
  if (value === null || value === undefined || value === '') return null;
  return Math.floor(finiteNonNegative(value));
}

function sanitizePublicSummary(value) {
  if (typeof value !== 'string') return '';
  return value
    .replace(/(?:token|params?|body|stack)\s*[:=]\s*\S+/giu, '[REDACTED]')
    .replace(/\b([a-z][a-z\d+.-]*:\/\/)[^\s/?#]+/giu, '$1[REDACTED]')
    .replace(/\b(?:\d{1,3}\.){3}\d{1,3}(?::\d{1,5})?\b/gu, '[REDACTED]')
    .replace(/\b(?:[A-Za-z\d-]+\.)+[A-Za-z]{2,}(?::\d{1,5})?\b/gu, '[REDACTED]')
    .slice(0, 300);
}

function serializeAnomalyItem(row) {
  const occurredAt = rowValue(row, 'occurred_at');
  return {
    id: publicNullableInteger(rowValue(row, 'id')),
    occurredAt: typeof occurredAt === 'string' && Number.isFinite(Date.parse(occurredAt))
      ? new Date(occurredAt).toISOString()
      : null,
    runId: normalizePublicIdentifier(rowValue(row, 'run_id'), ''),
    accountId: publicNullableInteger(rowValue(row, 'account_id')),
    batchTaskId: publicNullableInteger(rowValue(row, 'batch_task_id')),
    source: normalizePublicIdentifier(rowValue(row, 'source'), '[REDACTED]'),
    taskType: normalizePublicIdentifier(rowValue(row, 'task_type'), ''),
    command: normalizePublicIdentifier(rowValue(row, 'command'), ''),
    executionLane: normalizePublicIdentifier(rowValue(row, 'execution_lane'), ''),
    egressType: normalizeEgressType(rowValue(row, 'egress_type')),
    egressKey: normalizeEgressKey(
      rowValue(row, 'egress_key'),
      normalizeEgressType(rowValue(row, 'egress_type')),
    ),
    category: normalizePublicIdentifier(rowValue(row, 'category'), 'UNATTRIBUTED'),
    errorCode: publicNullableInteger(rowValue(row, 'error_code')),
    latencyMs: publicNullableInteger(rowValue(row, 'latency_ms')),
    queueWaitMs: publicNullableInteger(rowValue(row, 'queue_wait_ms')),
    summary: sanitizePublicSummary(rowValue(row, 'summary')),
  };
}

export function serializeSchedulerAnomalies(raw = {}) {
  const items = Array.isArray(rowValue(raw, 'items')) ? rowValue(raw, 'items') : [];
  return {
    items: items
      .filter((row) => row !== null && typeof row === 'object')
      .map(serializeAnomalyItem),
    total: Math.floor(finiteNonNegative(rowValue(raw, 'total'))),
    page: normalizePositiveInteger(rowValue(raw, 'page'), 1),
    pageSize: normalizePositiveInteger(
      rowValue(raw, 'pageSize'),
      DEFAULT_OBSERVABILITY_PAGE_SIZE,
      MAX_OBSERVABILITY_PAGE_SIZE,
    ),
  };
}

function repositoryFilters(query, includePagination) {
  const filters = { cutoff: query.cutoff };
  if (includePagination) {
    filters.page = query.page;
    filters.pageSize = query.pageSize;
  }
  for (const name of ['category', 'source', 'taskType', 'egressType']) {
    if (query[name] !== undefined && (includePagination || name !== 'category')) {
      filters[name] = query[name];
    }
  }
  return filters;
}

export function createSchedulerObservabilityHandlers({
  querySummary,
  queryAnomalies,
  getHealth,
  now = Date.now,
}) {
  return {
    async summary(req, res) {
      const normalized = normalizeObservabilityQuery(req?.query, { now });
      if (!normalized.ok) {
        return res.status(400).json({ success: false, error: normalized.error });
      }
      try {
        const raw = await querySummary(repositoryFilters(normalized.value, false));
        const health = await getHealth();
        return res.json({
          success: true,
          data: buildSchedulerObservabilitySummary(raw, {
            range: normalized.value.range,
            generatedAt: normalized.value.generatedAt,
            health,
          }),
        });
      } catch {
        return res.status(500).json({
          success: false,
          error: 'Failed to fetch scheduler observability summary',
        });
      }
    },
    async anomalies(req, res) {
      const normalized = normalizeObservabilityQuery(req?.query, { now });
      if (!normalized.ok) {
        return res.status(400).json({ success: false, error: normalized.error });
      }
      try {
        const raw = await queryAnomalies(repositoryFilters(normalized.value, true));
        const data = serializeSchedulerAnomalies({
          ...raw,
          page: normalized.value.page,
          pageSize: normalized.value.pageSize,
        });
        return res.json({ success: true, data });
      } catch {
        return res.status(500).json({
          success: false,
          error: 'Failed to fetch scheduler observability anomalies',
        });
      }
    },
  };
}

const router = Router();

router.use(authMiddleware);

const schedulerObservabilityHandlers = createSchedulerObservabilityHandlers({
  querySummary: querySchedulerObservationSummary,
  queryAnomalies: querySchedulerObservationAnomalies,
  getHealth: getSchedulerObservationHealth,
  now: Date.now,
});

router.get('/observability/summary', adminOnly, schedulerObservabilityHandlers.summary);
router.get('/observability/anomalies', adminOnly, schedulerObservabilityHandlers.anomalies);

const BENIGN_FAILURE_KEYWORDS = [
  '模块未开启',
  '活动未开放',
  '不在开启时间内',
  '出了点小问题',
  '扫荡条件不满足',
  '已经选择过上阵武将了',
  '今日已领取免费奖励',
  '今天已经签到过了',
];
const SHANGHAI_UTC_OFFSET_MS = 8 * 60 * 60 * 1000;

function buildIgnoredFailureCondition(alias) {
  const messageExpr = `COALESCE(${alias}.message, '')`;
  const detailsExpr = `COALESCE(${alias}.details, '')`;
  const keywordConditions = BENIGN_FAILURE_KEYWORDS
    .map((keyword) => `(${messageExpr} LIKE '%${keyword}%' OR ${detailsExpr} LIKE '%${keyword}%')`)
    .join(' OR ');

  return `(${alias}.status = 'ignored' OR (${alias}.status = 'error' AND (${keywordConditions})))`;
}

function formatSqliteUtcDateTime(date) {
  return new Date(date.getTime()).toISOString().slice(0, 19).replace('T', ' ');
}

function getShanghaiTodayUtcRange(now = new Date()) {
  const shanghaiNow = new Date(now.getTime() + SHANGHAI_UTC_OFFSET_MS);
  const startUtcMs = Date.UTC(
    shanghaiNow.getUTCFullYear(),
    shanghaiNow.getUTCMonth(),
    shanghaiNow.getUTCDate(),
    0,
    0,
    0,
    0,
  ) - SHANGHAI_UTC_OFFSET_MS;
  const endUtcMs = startUtcMs + 24 * 60 * 60 * 1000;

  return {
    start: formatSqliteUtcDateTime(new Date(startUtcMs)),
    end: formatSqliteUtcDateTime(new Date(endUtcMs)),
  };
}

router.get('/overview', (req, res) => {
  try {
    const userId = req.user.userId;
    const ignoredFailureConditionSingle = buildIgnoredFailureCondition('tl');
    const ignoredFailureConditionBatch = buildIgnoredFailureCondition('btl');

    const accountCount = get(
      'SELECT COUNT(*) as count FROM game_accounts WHERE user_id = ?',
      [userId]
    );

    const enabledSingleTaskCount = get(
      `SELECT COUNT(*) as count
       FROM task_configs tc 
       JOIN game_accounts ga ON tc.account_id = ga.id 
       WHERE ga.user_id = ? AND tc.enabled = 1`,
      [userId]
    );

    const enabledBatchTaskCount = get(
      `SELECT COUNT(*) as count
       FROM batch_scheduled_tasks
       WHERE user_id = ? AND enabled = 1`,
      [userId]
    );

    const todayRange = getShanghaiTodayUtcRange();
    const todaySingleLogCount = get(
      `SELECT COUNT(*) as count
       FROM task_logs tl 
       JOIN game_accounts ga ON tl.account_id = ga.id 
       WHERE ga.user_id = ? AND tl.created_at >= ? AND tl.created_at < ?`,
      [userId, todayRange.start, todayRange.end]
    );

    const todayBatchLogCount = get(
      `SELECT COUNT(*) as count
       FROM batch_task_logs btl
       JOIN batch_scheduled_tasks bst ON btl.batch_task_id = bst.id
       WHERE bst.user_id = ? AND btl.created_at >= ? AND btl.created_at < ?`,
      [userId, todayRange.start, todayRange.end]
    );

    const enabledSingleTasks = all(
      `SELECT tc.cron_expression, tc.next_run_at
       FROM task_configs tc 
       JOIN game_accounts ga ON tc.account_id = ga.id 
       WHERE ga.user_id = ? AND tc.enabled = 1`,
      [userId]
    );

    const enabledBatchTasks = all(
      `SELECT run_type, run_time, cron_expression, next_run_at
       FROM batch_scheduled_tasks
       WHERE user_id = ? AND enabled = 1`,
      [userId]
    );

    const pendingSingleTaskCount = enabledSingleTasks.filter((task) =>
      isNextRunPendingToday(getNextRunAt(task.cron_expression, task.next_run_at), 'Asia/Shanghai')
    ).length;

    const pendingBatchTaskCount = enabledBatchTasks.filter((task) =>
      isNextRunPendingToday(getNextRunAt(resolveBatchCronExpression(task), task.next_run_at), 'Asia/Shanghai')
    ).length;

    const failedSingleTaskCount = get(
      `SELECT COUNT(*) as count
       FROM task_logs tl 
       JOIN game_accounts ga ON tl.account_id = ga.id 
       WHERE ga.user_id = ? AND tl.status = 'error' AND tl.created_at >= ? AND tl.created_at < ? AND NOT ${ignoredFailureConditionSingle}`,
      [userId, todayRange.start, todayRange.end]
    );

    const failedBatchTaskCount = get(
      `SELECT COUNT(*) as count
       FROM batch_task_logs btl
       JOIN batch_scheduled_tasks bst ON btl.batch_task_id = bst.id
       WHERE bst.user_id = ? AND btl.status = 'error' AND btl.created_at >= ? AND btl.created_at < ? AND NOT ${ignoredFailureConditionBatch}`,
      [userId, todayRange.start, todayRange.end]
    );

    const successSingleTaskCount = get(
      `SELECT COUNT(*) as count
       FROM task_logs tl 
       JOIN game_accounts ga ON tl.account_id = ga.id 
       WHERE ga.user_id = ? AND tl.status = 'success' AND tl.created_at >= ? AND tl.created_at < ?`,
      [userId, todayRange.start, todayRange.end]
    );

    const successBatchTaskCount = get(
      `SELECT COUNT(*) as count
       FROM batch_task_logs btl
       JOIN batch_scheduled_tasks bst ON btl.batch_task_id = bst.id
       WHERE bst.user_id = ? AND btl.status = 'success' AND btl.created_at >= ? AND btl.created_at < ?`,
      [userId, todayRange.start, todayRange.end]
    );

    res.json({
      success: true,
      data: {
        accountCount: accountCount?.count || 0,
        enabledTaskCount: (enabledSingleTaskCount?.count || 0) + (enabledBatchTaskCount?.count || 0),
        todayLogCount: (todaySingleLogCount?.count || 0) + (todayBatchLogCount?.count || 0),
        pendingTaskCount: pendingSingleTaskCount + pendingBatchTaskCount,
        failedTaskCount: (failedSingleTaskCount?.count || 0) + (failedBatchTaskCount?.count || 0),
        successTaskCount: (successSingleTaskCount?.count || 0) + (successBatchTaskCount?.count || 0)
      }
    });
  } catch (error) {
    console.error('获取统计概览错误:', error);
    res.status(500).json({
      success: false,
      error: '获取统计概览失败'
    });
  }
});

router.get('/system-status', (req, res) => {
  try {
    const scheduledJobs = getScheduledJobs();
    const scheduledBatchJobs = getScheduledBatchJobs();
    const activeConnections = getActiveConnections();
    const activeBatchConnections = getActiveBatchConnections();
    const coordinatorStatus = getAccountTaskCoordinatorStatus();

    const combinedConnectionIds = new Set([
      ...Array.from(activeConnections.keys()).map((id) => String(id)),
      ...Array.from(activeBatchConnections.keys()).map((id) => String(id)),
    ]);

    const schedulerStatus = {
      status: 'running',
      totalJobs: scheduledJobs.size + scheduledBatchJobs.size,
      activeConnections: combinedConnectionIds.size,
      accountConcurrency: coordinatorStatus,
      uptime: process.uptime(),
      memoryUsage: process.memoryUsage(),
      cpuUsage: process.cpuUsage()
    };

    const serviceStatus = {
      database: 'connected',
      scheduler: (scheduledJobs.size + scheduledBatchJobs.size) > 0 ? 'active' : 'idle',
      websocket: combinedConnectionIds.size > 0 ? 'connected' : 'disconnected'
    };

    const jobs = [];
    for (const [key, job] of scheduledJobs) {
      const [accountId, taskType] = key.split('_');
      jobs.push({
        accountId: parseInt(accountId),
        taskType,
        status: 'scheduled',
        source: 'single'
      });
    }

    for (const [taskId, job] of scheduledBatchJobs) {
      jobs.push({
        taskId: Number(taskId),
        taskType: 'BATCH_TASK',
        status: 'scheduled',
        source: 'batch',
        nextRun: job?.nextRun || null
      });
    }

    const connections = [];
    for (const [accountId, client] of activeConnections) {
      connections.push({
        accountId,
        status: client?.isSocketOpen?.() ? 'connected' : 'disconnected',
        readyState: client?.getConnectionStateSummary?.()?.readyState || null,
      });
    }

    res.json({
      success: true,
      data: {
        scheduler: schedulerStatus,
        service: serviceStatus,
        jobs,
        connections,
        timestamp: new Date().toISOString()
      }
    });
  } catch (error) {
    console.error('获取系统状态错误:', error);
    res.status(500).json({
      success: false,
      error: '获取系统状态失败'
    });
  }
});

router.get('/task-summary', (req, res) => {
  try {
    const userId = req.user.userId;
    const { days = 7 } = req.query;
    const ignoredFailureConditionSingle = buildIgnoredFailureCondition('tl');

    const taskSummary = all(
      `SELECT 
        tl.task_type,
        COUNT(*) as total_count,
        SUM(CASE WHEN tl.status = 'success' THEN 1 ELSE 0 END) as success_count,
        SUM(CASE WHEN tl.status = 'error' AND NOT ${ignoredFailureConditionSingle} THEN 1 ELSE 0 END) as error_count,
        MAX(tl.created_at) as last_run
       FROM task_logs tl
       JOIN game_accounts ga ON tl.account_id = ga.id
       WHERE ga.user_id = ? AND tl.created_at >= datetime('now', '-' || ? || ' days')
       GROUP BY tl.task_type
       ORDER BY total_count DESC`,
      [userId, days]
    );

    res.json({
      success: true,
      data: taskSummary
    });
  } catch (error) {
    console.error('获取任务摘要错误:', error);
    res.status(500).json({
      success: false,
      error: '获取任务摘要失败'
    });
  }
});

router.get('/recent-activities', (req, res) => {
  try {
    const userId = req.user.userId;
    const { limit = 10 } = req.query;

    const activities = all(
      `SELECT 
        tl.*,
        ga.name as account_name
       FROM task_logs tl
       JOIN game_accounts ga ON tl.account_id = ga.id
       WHERE ga.user_id = ?
       ORDER BY tl.created_at DESC
       LIMIT ?`,
      [userId, parseInt(limit)]
    );

    res.json({
      success: true,
      data: activities
    });
  } catch (error) {
    console.error('获取最近活动错误:', error);
    res.status(500).json({
      success: false,
      error: '获取最近活动失败'
    });
  }
});

export default router;
