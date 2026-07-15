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

function redactSensitiveAssignments(value) {
  const keyPrefix = String.raw`((?:\\?["'])?\b(?:roleToken|token|p)\b(?:\\?["'])?\s*[:=]\s*)`;
  const escapedQuotedValue = new RegExp(
    `${keyPrefix}\\\\(["'])(?:(?!\\\\\\2)[\\s\\S])*?\\\\\\2`,
    'gi',
  );
  const quotedValue = new RegExp(
    `${keyPrefix}(["'])(?:\\\\.|(?!\\2)[\\s\\S])*\\2`,
    'gi',
  );
  const unquotedValue = new RegExp(
    `${keyPrefix}(?!["'])[^\\s,;&}\\]]+`,
    'gi',
  );

  return value
    .replace(escapedQuotedValue, (_, prefix, quote) => `${prefix}\\${quote}[REDACTED]\\${quote}`)
    .replace(quotedValue, (_, prefix, quote) => `${prefix}${quote}[REDACTED]${quote}`)
    .replace(unquotedValue, '$1[REDACTED]');
}

export function sanitizeObservationMessage(value, maxLength = 300) {
  if (value === null || value === undefined) return '';

  const limit = normalizeMaxLength(maxLength);
  let summary = String(value);

  summary = summary.replace(/[\u0000-\u001f\u007f-\u009f]/g, '');
  summary = summary.replace(
    /\b([a-z][a-z\d+.-]*:\/\/[^\s?"'<>]+)\?[^\s"'<>]*/gi,
    '$1',
  );
  summary = redactSensitiveAssignments(summary);
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

function normalizeMeasurement(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? value
    : null;
}

function commandMetricRow({ minute, dimensions, outcome }, observation = {}) {
  const latencyMs = normalizeMeasurement(observation.latencyMs);
  return {
    minute,
    dimensions,
    outcome,
    commandCount: 1,
    errorCount: outcome === 'error' ? 1 : 0,
    timeoutCount: outcome === 'timeout' ? 1 : 0,
    disconnectedCount: outcome === 'disconnected' ? 1 : 0,
    rateLimitedCount: outcome === 'rate_limited' ? 1 : 0,
    latencyCount: latencyMs === null ? 0 : 1,
    latencySumMs: latencyMs ?? 0,
    latencyMaxMs: latencyMs ?? 0,
  };
}

function taskMetricRow({ minute, dimensions, outcome }, observation = {}) {
  const durationMs = normalizeMeasurement(observation.durationMs);
  const queueWaitMs = normalizeMeasurement(observation.queueWaitMs);
  const attributedCommandCount = normalizeCapacity(
    observation.attributedCommandCount ?? observation.commandCount,
    0,
  );

  return {
    minute,
    dimensions,
    outcome,
    runCount: 1,
    durationCount: durationMs === null ? 0 : 1,
    durationSumMs: durationMs ?? 0,
    durationMaxMs: durationMs ?? 0,
    queueWaitCount: queueWaitMs === null ? 0 : 1,
    queueWaitSumMs: queueWaitMs ?? 0,
    queueWaitMaxMs: queueWaitMs ?? 0,
    attributedCommandCount,
  };
}

function normalizeCommandMetricRow(identity, row) {
  return {
    ...identity,
    commandCount: normalizeCapacity(row?.commandCount, 0),
    errorCount: normalizeCapacity(row?.errorCount, 0),
    timeoutCount: normalizeCapacity(row?.timeoutCount, 0),
    disconnectedCount: normalizeCapacity(row?.disconnectedCount, 0),
    rateLimitedCount: normalizeCapacity(row?.rateLimitedCount, 0),
    latencyCount: normalizeCapacity(row?.latencyCount, 0),
    latencySumMs: normalizeMeasurement(row?.latencySumMs) ?? 0,
    latencyMaxMs: normalizeMeasurement(row?.latencyMaxMs) ?? 0,
  };
}

function normalizeTaskMetricRow(identity, row) {
  return {
    ...identity,
    runCount: normalizeCapacity(row?.runCount, 0),
    durationCount: normalizeCapacity(row?.durationCount, 0),
    durationSumMs: normalizeMeasurement(row?.durationSumMs) ?? 0,
    durationMaxMs: normalizeMeasurement(row?.durationMaxMs) ?? 0,
    queueWaitCount: normalizeCapacity(row?.queueWaitCount, 0),
    queueWaitSumMs: normalizeMeasurement(row?.queueWaitSumMs) ?? 0,
    queueWaitMaxMs: normalizeMeasurement(row?.queueWaitMaxMs) ?? 0,
    attributedCommandCount: normalizeCapacity(row?.attributedCommandCount, 0),
  };
}

function mergeCommandMetricRows(target, source) {
  target.commandCount += source.commandCount;
  target.errorCount += source.errorCount;
  target.timeoutCount += source.timeoutCount;
  target.disconnectedCount += source.disconnectedCount;
  target.rateLimitedCount += source.rateLimitedCount;
  target.latencyCount += source.latencyCount;
  target.latencySumMs += source.latencySumMs;
  target.latencyMaxMs = Math.max(target.latencyMaxMs, source.latencyMaxMs);
}

function mergeTaskMetricRows(target, source) {
  target.runCount += source.runCount;
  target.durationCount += source.durationCount;
  target.durationSumMs += source.durationSumMs;
  target.durationMaxMs = Math.max(target.durationMaxMs, source.durationMaxMs);
  target.queueWaitCount += source.queueWaitCount;
  target.queueWaitSumMs += source.queueWaitSumMs;
  target.queueWaitMaxMs = Math.max(target.queueWaitMaxMs, source.queueWaitMaxMs);
  target.attributedCommandCount += source.attributedCommandCount;
}

function cloneMetricRow(row) {
  return {
    ...row,
    dimensions: { ...row.dimensions },
  };
}

function sumMetricRows(commandMetrics, taskMetrics) {
  let commandCount = 0;
  let taskCount = 0;
  let rateLimitedCount = 0;

  for (const row of commandMetrics) {
    commandCount += row.commandCount;
    rateLimitedCount += row.rateLimitedCount;
  }
  for (const row of taskMetrics) {
    taskCount += row.runCount;
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

  _metricIdentity(metricType, input) {
    const currentTimestamp = this._currentTimestamp();
    return {
      minute: formatUtcMinute(input?.minute ?? input?.timestamp, currentTimestamp),
      outcome: normalizeOutcome(input?.outcome),
      dimensions: normalizeDimensions(input, metricType),
    };
  }

  _recordMetric(metricType, input) {
    const target = metricType === 'command' ? this._commandMetrics : this._taskMetrics;
    const identity = this._metricIdentity(metricType, input);
    const key = metricKey(identity.minute, identity.outcome, identity.dimensions);
    const existing = target.get(key);
    const row = metricType === 'command'
      ? commandMetricRow(identity, input)
      : taskMetricRow(identity, input);

    if (existing) {
      if (metricType === 'command') mergeCommandMetricRows(existing, row);
      else mergeTaskMetricRows(existing, row);
      return true;
    }

    if (this._commandMetrics.size + this._taskMetrics.size >= this._maxMetricKeys) {
      this._droppedMetrics += 1;
      return false;
    }

    target.set(key, row);
    return true;
  }

  _mergeMetricRow(metricType, input) {
    const target = metricType === 'command' ? this._commandMetrics : this._taskMetrics;
    const identity = this._metricIdentity(metricType, input);
    const key = metricKey(identity.minute, identity.outcome, identity.dimensions);
    const row = metricType === 'command'
      ? normalizeCommandMetricRow(identity, input)
      : normalizeTaskMetricRow(identity, input);
    const existing = target.get(key);

    if (existing) {
      if (metricType === 'command') mergeCommandMetricRows(existing, row);
      else mergeTaskMetricRows(existing, row);
    } else {
      target.set(key, row);
    }
  }

  recordCommand(observation = {}) {
    return this._recordMetric('command', observation);
  }

  recordTask(observation = {}) {
    return this._recordMetric('task', observation);
  }

  _createAnomalyEntry(anomaly) {
    const input = anomaly instanceof Error ? anomaly : anomaly ?? {};
    const currentTimestamp = this._currentTimestamp();
    const timestamp = normalizeTimestamp(input.timestamp, currentTimestamp);
    const type = sanitizeObservationMessage(input.type ?? input.category ?? input.kind ?? 'UNATTRIBUTED', 100);
    const message = sanitizeObservationMessage(input.message ?? input, 300);
    const dimensions = normalizeDimensions({ dimensions: input.dimensions }, 'anomaly');

    return {
      timestamp: new Date(timestamp).toISOString(),
      minute: formatUtcMinute(timestamp, currentTimestamp),
      type: type || 'UNATTRIBUTED',
      message,
      dimensions,
    };
  }

  recordAnomaly(anomaly = {}) {
    this._anomalies.push(this._createAnomalyEntry(anomaly));

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

    for (const row of snapshot.commandMetrics) this._mergeMetricRow('command', row);
    for (const row of snapshot.taskMetrics) this._mergeMetricRow('task', row);

    const restoredAnomalies = snapshot.anomalies.map((anomaly) => this._createAnomalyEntry(anomaly));
    this._anomalies = [...restoredAnomalies, ...this._anomalies];

    this._droppedMetrics += normalizeCapacity(snapshot.health?.droppedMetrics, 0);
    this._droppedAnomalies += normalizeCapacity(snapshot.health?.droppedAnomalies, 0);
    return true;
  }
}
