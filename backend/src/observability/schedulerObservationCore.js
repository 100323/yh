import { createHash } from 'node:crypto';

export const OBSERVATION_OUTCOMES = Object.freeze([
  'success',
  'ignored',
  'error',
  'timeout',
  'disconnected',
  'rate_limited',
  'sent',
]);

const OBSERVATION_OUTCOME_SET = new Set(OBSERVATION_OUTCOMES);
const RATE_LIMIT_CODES = new Set(['200400', '12400000']);
const RATE_LIMIT_MESSAGE_PATTERN = /操作过快|请稍后重试|过于频繁/;
const UTC_MINUTE_PATTERN = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:00$/;
const SENSITIVE_DIMENSION_PATTERN = /^(?:token|roleToken|p|params?|arguments?|request(?:Body)?|response(?:Body)?|body|stack)$/i;

function normalizeMaxLength(maxLength) {
  const numericLength = Number(maxLength);
  if (!Number.isFinite(numericLength)) return 300;
  return Math.max(0, Math.floor(numericLength));
}

export function sanitizeObservationMessage(value, maxLength = 300) {
  if (value === null || value === undefined) return '';

  const limit = normalizeMaxLength(maxLength);
  let summary = String(value);

  summary = summary.replace(/[\u0000-\u001f\u007f]/g, '');
  summary = summary.replace(
    /\b([a-z][a-z\d+.-]*:\/\/[^\s?"'<>]+)\?[^\s"'<>]*/gi,
    '$1',
  );
  summary = summary.replace(
    /(["']?\b(?:roleToken|token|p)\b["']?\s*[:=]\s*)(["'])(.*?)\2/gi,
    '$1$2[REDACTED]$2',
  );
  summary = summary.replace(
    /(["']?\b(?:roleToken|token|p)\b["']?\s*[:=]\s*)(?!["'])([^\s,;&}\]]+)/gi,
    '$1[REDACTED]',
  );
  summary = summary.replace(
    /(^|[^A-Za-z\d+/_=-])([A-Za-z\d+/_=-]{80,})(?=$|[^A-Za-z\d+/_=-])/g,
    '$1[REDACTED]',
  );

  return summary.slice(0, limit);
}

function collectFailureCodes(error) {
  return [
    error?.code,
    error?.errorCode,
    error?.body?.code,
    error?.data?.code,
    error?.response?.code,
    error?.response?.data?.code,
  ];
}

function collectFailureMessages(error) {
  if (typeof error === 'string') return [error];

  return [
    error?.message,
    error?.body?.message,
    error?.data?.message,
    error?.response?.message,
    error?.response?.data?.message,
  ].filter((message) => typeof message === 'string');
}

export function classifyCommandFailure(error, hints = {}) {
  if (hints?.timeout) return 'timeout';
  if (hints?.disconnected) return 'disconnected';

  if (collectFailureCodes(error).some((code) => RATE_LIMIT_CODES.has(String(code)))) {
    return 'rate_limited';
  }

  if (collectFailureMessages(error).some((message) => RATE_LIMIT_MESSAGE_PATTERN.test(message))) {
    return 'rate_limited';
  }

  return 'error';
}

function normalizeProxy(proxy) {
  if (typeof proxy === 'string') {
    try {
      const parsed = new URL(proxy);
      return {
        protocol: parsed.protocol,
        host: parsed.hostname,
        port: parsed.port,
      };
    } catch {
      return { protocol: '', host: '', port: '' };
    }
  }

  const nestedUrl = proxy?.url;
  if (typeof nestedUrl === 'string') return normalizeProxy(nestedUrl);

  return {
    protocol: proxy?.protocol ?? proxy?.type ?? '',
    host: proxy?.host ?? proxy?.hostname ?? '',
    port: proxy?.port ?? '',
  };
}

function canonicalizeProxy(proxy) {
  const normalized = normalizeProxy(proxy);
  const protocol = String(normalized.protocol).trim().toLowerCase().replace(/:$/, '');
  const host = String(normalized.host).trim().toLowerCase().replace(/\.$/, '');
  const port = String(normalized.port).trim();
  const bracketedHost = host.includes(':') && !host.startsWith('[') ? `[${host}]` : host;

  return `${protocol}://${bracketedHost}:${port}`;
}

export function createEgressDescriptor(proxy) {
  if (proxy === null || proxy === undefined || proxy === false) {
    return { type: 'direct', key: 'direct' };
  }

  const fingerprint = createHash('sha256')
    .update(canonicalizeProxy(proxy))
    .digest('hex')
    .slice(0, 12);

  return { type: 'proxy', key: `proxy:${fingerprint}` };
}

function normalizeCapacity(value, fallback) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) return fallback;
  return Math.max(0, Math.floor(numericValue));
}

function normalizeOutcome(outcome) {
  return OBSERVATION_OUTCOME_SET.has(outcome) ? outcome : 'error';
}

function normalizeTimestamp(value, fallback) {
  let timestamp;
  if (value instanceof Date) {
    timestamp = value.getTime();
  } else if (typeof value === 'string' && value.trim() && !/^[-+]?\d+(?:\.\d+)?$/.test(value.trim())) {
    timestamp = Date.parse(value);
  } else {
    timestamp = Number(value);
  }
  return Number.isFinite(timestamp) ? timestamp : fallback;
}

function formatUtcMinute(value, fallback) {
  if (typeof value === 'string' && UTC_MINUTE_PATTERN.test(value)) return value;

  const timestamp = normalizeTimestamp(value, fallback);
  const date = new Date(timestamp);
  const isoMinute = Number.isNaN(date.getTime())
    ? new Date(fallback).toISOString().slice(0, 16)
    : date.toISOString().slice(0, 16);
  return `${isoMinute.replace('T', ' ')}:00`;
}

function normalizeDimensionValue(key, value) {
  if (value === null || value === undefined || value === '') return '';
  if (SENSITIVE_DIMENSION_PATTERN.test(key)) return '[REDACTED]';

  if (key === 'egress' || key === 'proxy') {
    if (value === 'direct' || /^proxy:[a-f\d]{12}$/.test(value)) return value;
    return createEgressDescriptor(value).key;
  }

  if (typeof value === 'object' || typeof value === 'function' || typeof value === 'symbol') {
    return 'UNATTRIBUTED';
  }

  return sanitizeObservationMessage(value, 160);
}

function normalizeDimensions(input, metricType) {
  const rawDimensions = input?.dimensions && typeof input.dimensions === 'object'
    ? { ...input.dimensions }
    : {};

  const directDimensionNames = ['scheduler', 'schedulerType', 'taskType', 'source', 'egress', 'proxy'];
  for (const name of directDimensionNames) {
    if (input?.[name] !== undefined && rawDimensions[name] === undefined) {
      rawDimensions[name] = input[name];
    }
  }

  const primaryName = metricType === 'command' ? 'command' : 'task';
  if (input?.[primaryName] !== undefined) rawDimensions[primaryName] = input[primaryName];

  return Object.fromEntries(
    Object.keys(rawDimensions)
      .sort()
      .map((key) => [sanitizeObservationMessage(key, 80), normalizeDimensionValue(key, rawDimensions[key])]),
  );
}

function metricKey(minute, outcome, dimensions) {
  return JSON.stringify([minute, outcome, Object.entries(dimensions)]);
}

function cloneMetricRow(row) {
  return {
    minute: row.minute,
    dimensions: { ...row.dimensions },
    outcome: row.outcome,
    count: row.count,
    rateLimitedCount: row.rateLimitedCount,
  };
}

function sumMetricRows(commandMetrics, taskMetrics) {
  let commandCount = 0;
  let taskCount = 0;
  let rateLimitedCount = 0;

  for (const row of commandMetrics) {
    commandCount += row.count;
    rateLimitedCount += row.rateLimitedCount;
  }
  for (const row of taskMetrics) {
    taskCount += row.count;
    rateLimitedCount += row.rateLimitedCount;
  }

  return { commandCount, taskCount, rateLimitedCount };
}

export class SchedulerObservationAggregator {
  constructor({ now = Date.now, maxMetricKeys = 20_000, maxAnomalies = 5_000 } = {}) {
    this._now = typeof now === 'function' ? now : Date.now;
    this._maxMetricKeys = normalizeCapacity(maxMetricKeys, 20_000);
    this._maxAnomalies = normalizeCapacity(maxAnomalies, 5_000);
    this._commandMetrics = new Map();
    this._taskMetrics = new Map();
    this._anomalies = [];
    this._droppedMetrics = 0;
    this._droppedAnomalies = 0;
  }

  _currentTimestamp() {
    return normalizeTimestamp(this._now(), Date.now());
  }

  _recordMetric(metricType, input, count = 1) {
    const target = metricType === 'command' ? this._commandMetrics : this._taskMetrics;
    const currentTimestamp = this._currentTimestamp();
    const minute = formatUtcMinute(input?.minute ?? input?.timestamp, currentTimestamp);
    const outcome = normalizeOutcome(input?.outcome);
    const dimensions = normalizeDimensions(input, metricType);
    const key = metricKey(minute, outcome, dimensions);
    const existing = target.get(key);

    if (existing) {
      existing.count += count;
      if (outcome === 'rate_limited') existing.rateLimitedCount += count;
      return true;
    }

    if (this._commandMetrics.size + this._taskMetrics.size >= this._maxMetricKeys) {
      this._droppedMetrics += 1;
      return false;
    }

    target.set(key, {
      minute,
      dimensions,
      outcome,
      count,
      rateLimitedCount: outcome === 'rate_limited' ? count : 0,
    });
    return true;
  }

  recordCommand(observation = {}) {
    return this._recordMetric('command', observation);
  }

  recordTask(observation = {}) {
    return this._recordMetric('task', observation);
  }

  recordAnomaly(anomaly = {}) {
    const input = anomaly instanceof Error ? anomaly : anomaly ?? {};
    const currentTimestamp = this._currentTimestamp();
    const timestamp = normalizeTimestamp(input.timestamp, currentTimestamp);
    const type = sanitizeObservationMessage(input.type ?? input.category ?? input.kind ?? 'UNATTRIBUTED', 100);
    const message = sanitizeObservationMessage(input.message ?? input, 300);
    const dimensions = normalizeDimensions({ dimensions: input.dimensions }, 'anomaly');

    this._anomalies.push({
      timestamp: new Date(timestamp).toISOString(),
      minute: formatUtcMinute(timestamp, currentTimestamp),
      type: type || 'UNATTRIBUTED',
      message,
      dimensions,
    });

    while (this._anomalies.length > this._maxAnomalies) {
      this._anomalies.shift();
      this._droppedAnomalies += 1;
    }

    return this._maxAnomalies > 0;
  }

  getHealth() {
    return {
      metricKeys: this._commandMetrics.size + this._taskMetrics.size,
      anomalyCount: this._anomalies.length,
      droppedMetrics: this._droppedMetrics,
      droppedAnomalies: this._droppedAnomalies,
    };
  }

  takeSnapshot() {
    const commandMetrics = this._commandMetrics;
    const taskMetrics = this._taskMetrics;
    const anomalies = this._anomalies;
    const health = this.getHealth();

    this._commandMetrics = new Map();
    this._taskMetrics = new Map();
    this._anomalies = [];
    this._droppedMetrics = 0;
    this._droppedAnomalies = 0;

    const commandRows = [...commandMetrics.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([, row]) => cloneMetricRow(row));
    const taskRows = [...taskMetrics.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([, row]) => cloneMetricRow(row));

    return {
      version: 1,
      generatedAt: new Date(this._currentTimestamp()).toISOString(),
      commandMetrics: commandRows,
      taskMetrics: taskRows,
      anomalies: anomalies.map((entry) => ({ ...entry, dimensions: { ...entry.dimensions } })),
      totals: sumMetricRows(commandRows, taskRows),
      health,
    };
  }

  mergeSnapshot(snapshot) {
    if (
      snapshot?.version !== 1
      || !Array.isArray(snapshot.commandMetrics)
      || !Array.isArray(snapshot.taskMetrics)
      || !Array.isArray(snapshot.anomalies)
    ) {
      return false;
    }

    for (const row of snapshot.commandMetrics) {
      const count = normalizeCapacity(row?.count, 0);
      if (count > 0) {
        this._recordMetric('command', {
          minute: row.minute,
          outcome: row.outcome,
          dimensions: row.dimensions,
        }, count);
      }
    }

    for (const row of snapshot.taskMetrics) {
      const count = normalizeCapacity(row?.count, 0);
      if (count > 0) {
        this._recordMetric('task', {
          minute: row.minute,
          outcome: row.outcome,
          dimensions: row.dimensions,
        }, count);
      }
    }

    for (const anomaly of snapshot.anomalies) this.recordAnomaly(anomaly);

    this._droppedMetrics += normalizeCapacity(snapshot.health?.droppedMetrics, 0);
    this._droppedAnomalies += normalizeCapacity(snapshot.health?.droppedAnomalies, 0);
    return true;
  }
}
