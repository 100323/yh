import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash, randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';

const schedulerObservationStorage = new AsyncLocalStorage();

function isContextObject(value) {
  return value !== null && typeof value === 'object';
}

function monotonicNow() {
  const value = performance.now();
  if (Number.isFinite(value)) return value;
  return Number(process.hrtime.bigint()) / 1_000_000;
}

function elapsedMilliseconds(startedAt) {
  const elapsed = monotonicNow() - startedAt;
  return Number.isFinite(elapsed) && elapsed >= 0 ? elapsed : 0;
}

function noop() {}

function safelyObserveTaskSettlement(observer, payload) {
  try {
    const method = observer?.observeTaskSettled;
    if (typeof method !== 'function') return;

    const result = method.call(observer, payload);
    if (result === null || (typeof result !== 'object' && typeof result !== 'function')) return;

    const then = result.then;
    if (typeof then !== 'function') return;

    const chained = then.call(result, undefined, noop);
    if (chained !== result) Promise.resolve(chained).catch(noop);
  } catch {
    // Observation must never affect task settlement.
  }
}

function safelyClassifyCommandFailure(error) {
  try {
    return classifyCommandFailure(error, error);
  } catch {
    return 'error';
  }
}

function safelyAttachTaskSettlement(result, onSuccess, onFailure) {
  if (result === null || (typeof result !== 'object' && typeof result !== 'function')) {
    return false;
  }

  try {
    const then = result.then;
    if (typeof then !== 'function') return false;

    const chained = then.call(result, onSuccess, onFailure);
    if (chained !== result) Promise.resolve(chained).catch(noop);
    return true;
  } catch (error) {
    onFailure(error);
    return true;
  }
}

export function getSchedulerObservationContext() {
  const context = schedulerObservationStorage.getStore();
  return context ? { ...context } : null;
}

export function withSchedulerObservationContext(context, executor) {
  const parent = schedulerObservationStorage.getStore();
  const merged = {
    ...(parent ?? {}),
    ...(isContextObject(context) ? context : {}),
  };
  return schedulerObservationStorage.run(merged, executor);
}

export function runObservedTask(context, executor, observer) {
  const runId = randomUUID();
  const startedAt = new Date().toISOString();

  return withSchedulerObservationContext({
    ...(isContextObject(context) ? context : {}),
    runId,
    startedAt,
  }, () => {
    const observationContext = getSchedulerObservationContext();
    const monotonicStartedAt = monotonicNow();
    let observed = false;
    const observeSuccess = () => {
      if (observed) return;
      observed = true;
      safelyObserveTaskSettlement(observer, {
        ...observationContext,
        outcome: 'success',
        durationMs: elapsedMilliseconds(monotonicStartedAt),
      });
    };
    const observeFailure = (error) => {
      if (observed) return;
      observed = true;
      safelyObserveTaskSettlement(observer, {
        ...observationContext,
        outcome: safelyClassifyCommandFailure(error),
        durationMs: elapsedMilliseconds(monotonicStartedAt),
        error,
      });
    };

    let result;
    try {
      result = executor();
    } catch (error) {
      observeFailure(error);
      throw error;
    }

    if (!safelyAttachTaskSettlement(result, observeSuccess, observeFailure)) {
      observeSuccess();
    }
    return result;
  });
}

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
const MAX_OBSERVATION_NUMBER = Number.MAX_SAFE_INTEGER;
const SENSITIVE_FIELD_NAMES = Object.freeze([
  'token',
  'roleToken',
  'p',
  'param',
  'params',
  'argument',
  'arguments',
  'request',
  'requestBody',
  'response',
  'responseBody',
  'body',
  'stack',
  'proxy',
  'proxyUrl',
]);
const SENSITIVE_FIELD_NAME_SET = new Set(SENSITIVE_FIELD_NAMES.map((name) => name.toLowerCase()));
const SENSITIVE_FIELD_PATTERN_SOURCE = SENSITIVE_FIELD_NAMES.join('|');
const SENSITIVE_ASSIGNMENT_PATTERN = new RegExp(
  `(?:\\\\?["'])?\\b(${SENSITIVE_FIELD_PATTERN_SOURCE})\\b(?:\\\\?["'])?\\s*[:=]\\s*`,
  'gi',
);

function isSensitiveFieldName(value) {
  return SENSITIVE_FIELD_NAME_SET.has(String(value).toLowerCase());
}

function normalizeMaxLength(maxLength) {
  const numericLength = Number(maxLength);
  if (!Number.isFinite(numericLength)) return 300;
  return Math.max(0, Math.floor(numericLength));
}

function isEscapedQuote(value, index) {
  let slashCount = 0;
  for (let cursor = index - 1; cursor >= 0 && value[cursor] === '\\'; cursor -= 1) {
    slashCount += 1;
  }
  return slashCount % 2 === 1;
}

function findNormalQuoteEnd(value, start, quote, boundary) {
  for (let index = start; index < boundary; index += 1) {
    if (value[index] === quote && !isEscapedQuote(value, index)) return index;
  }
  return -1;
}

function findEscapedQuoteEnd(value, start, quote, boundary) {
  for (let index = start; index + 1 < boundary; index += 1) {
    if (value[index] === '\\' && value[index + 1] === quote && !isEscapedQuote(value, index)) {
      return index;
    }
  }
  return -1;
}

function findChainedSensitiveAssignment(value, start, candidateClosingIndex) {
  const prefixBeforeCandidate = new RegExp(
    `(?:\\\\?["'])?\\b(?:${SENSITIVE_FIELD_PATTERN_SOURCE})\\b(?:\\\\?["'])?\\s*[:=]\\s*$`,
    'i',
  );
  const match = prefixBeforeCandidate.exec(value.slice(start, candidateClosingIndex));
  return match ? { boundary: start + match.index } : null;
}

function hasCompleteSensitiveValue(value, start) {
  if (value[start] === '\\' && /["']/.test(value[start + 1] ?? '')) {
    return findEscapedQuoteEnd(value, start + 2, value[start + 1], value.length) >= 0;
  }
  if (/["']/.test(value[start] ?? '')) {
    return findNormalQuoteEnd(value, start + 1, value[start], value.length) >= 0;
  }
  return start < value.length;
}

function findNextCompleteSensitiveAssignment(value, start) {
  const pattern = new RegExp(SENSITIVE_ASSIGNMENT_PATTERN.source, 'gi');
  pattern.lastIndex = start;
  for (let match = pattern.exec(value); match; match = pattern.exec(value)) {
    if (hasCompleteSensitiveValue(value, pattern.lastIndex)) return { boundary: match.index };
  }
  return null;
}

function redactSensitiveAssignments(value) {
  let result = '';
  let cursor = 0;
  SENSITIVE_ASSIGNMENT_PATTERN.lastIndex = 0;

  for (let match = SENSITIVE_ASSIGNMENT_PATTERN.exec(value); match; match = SENSITIVE_ASSIGNMENT_PATTERN.exec(value)) {
    if (match.index < cursor) continue;

    const valueStart = SENSITIVE_ASSIGNMENT_PATTERN.lastIndex;
    result += value.slice(cursor, valueStart);

    if (value[valueStart] === '\\' && /["']/.test(value[valueStart + 1] ?? '')) {
      const quote = value[valueStart + 1];
      const closingIndex = findEscapedQuoteEnd(value, valueStart + 2, quote, value.length);
      const chainedAssignment = closingIndex < 0
        ? findNextCompleteSensitiveAssignment(value, valueStart + 2)
        : findChainedSensitiveAssignment(value, valueStart + 2, closingIndex);
      const isClosed = closingIndex >= 0 && chainedAssignment === null;
      const valueEnd = isClosed ? closingIndex + 2 : chainedAssignment?.boundary ?? value.length;
      result += `\\${quote}[REDACTED]${isClosed ? `\\${quote}` : ''}`;
      cursor = valueEnd;
    } else if (/["']/.test(value[valueStart] ?? '')) {
      const quote = value[valueStart];
      const closingIndex = findNormalQuoteEnd(value, valueStart + 1, quote, value.length);
      const chainedAssignment = closingIndex < 0
        ? findNextCompleteSensitiveAssignment(value, valueStart + 1)
        : findChainedSensitiveAssignment(value, valueStart + 1, closingIndex);
      const isClosed = closingIndex >= 0 && chainedAssignment === null;
      const valueEnd = isClosed ? closingIndex + 1 : chainedAssignment?.boundary ?? value.length;
      result += `${quote}[REDACTED]${isClosed ? quote : ''}`;
      cursor = valueEnd;
    } else {
      cursor = value.length;
      result += '[REDACTED]';
    }

    SENSITIVE_ASSIGNMENT_PATTERN.lastIndex = cursor;
  }

  return result + value.slice(cursor);
}

export function sanitizeObservationMessage(value, maxLength = 300) {
  if (value === null || value === undefined) return '';

  const limit = normalizeMaxLength(maxLength);
  let summary = String(value);

  summary = summary.replace(/[\u0000-\u001f\u007f-\u009f]/g, '');
  summary = summary.replace(
    /(^|[^A-Za-z\d+.-])((?:[a-z][a-z\d+.-]*:)?\/\/[^\s?"'<>]+)\?[^\s<>]*/gi,
    '$1$2',
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
  return Math.min(MAX_OBSERVATION_NUMBER, Math.max(0, Math.floor(numericValue)));
}

function normalizeOutcome(outcome) {
  return OBSERVATION_OUTCOME_SET.has(outcome) ? outcome : 'error';
}

function parseTimestamp(value) {
  let timestamp;
  if (value instanceof Date) {
    timestamp = value.getTime();
  } else if (typeof value === 'string' && value.trim() && !/^[-+]?\d+(?:\.\d+)?$/.test(value.trim())) {
    timestamp = Date.parse(value);
  } else {
    timestamp = Number(value);
  }
  if (!Number.isFinite(timestamp) || Number.isNaN(new Date(timestamp).getTime())) return null;
  return timestamp;
}

function normalizeTimestamp(value, fallback) {
  return parseTimestamp(value) ?? parseTimestamp(fallback) ?? Date.now();
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

function normalizeDimensionValue(rawKey, normalizedKey, value) {
  if (isSensitiveFieldName(rawKey) || isSensitiveFieldName(normalizedKey)) return '[REDACTED]';
  if (value === null || value === undefined || value === '') return '';

  if (normalizedKey === 'egress') {
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

  const normalizedDimensions = new Map();
  for (const rawKey of Object.keys(rawDimensions).sort()) {
    const normalizedKey = sanitizeObservationMessage(rawKey, 80);
    const normalizedValue = normalizeDimensionValue(rawKey, normalizedKey, rawDimensions[rawKey]);
    const existingValue = normalizedDimensions.get(normalizedKey);

    if (existingValue === '[REDACTED]' && normalizedValue !== '[REDACTED]') continue;
    normalizedDimensions.set(normalizedKey, normalizedValue);
  }

  return Object.fromEntries(
    [...normalizedDimensions.entries()].sort(([left], [right]) => left.localeCompare(right)),
  );
}

function metricKey(minute, outcome, dimensions) {
  return JSON.stringify([minute, outcome, Object.entries(dimensions)]);
}

function normalizeMeasurement(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? Math.min(MAX_OBSERVATION_NUMBER, value)
    : null;
}

function addObservationNumbers(left, right) {
  const normalizedLeft = normalizeMeasurement(left) ?? 0;
  const normalizedRight = normalizeMeasurement(right) ?? 0;
  return Math.min(MAX_OBSERVATION_NUMBER, normalizedLeft + normalizedRight);
}

function maxObservationNumber(left, right) {
  return Math.min(
    MAX_OBSERVATION_NUMBER,
    Math.max(normalizeMeasurement(left) ?? 0, normalizeMeasurement(right) ?? 0),
  );
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
  target.commandCount = addObservationNumbers(target.commandCount, source.commandCount);
  target.errorCount = addObservationNumbers(target.errorCount, source.errorCount);
  target.timeoutCount = addObservationNumbers(target.timeoutCount, source.timeoutCount);
  target.disconnectedCount = addObservationNumbers(target.disconnectedCount, source.disconnectedCount);
  target.rateLimitedCount = addObservationNumbers(target.rateLimitedCount, source.rateLimitedCount);
  target.latencyCount = addObservationNumbers(target.latencyCount, source.latencyCount);
  target.latencySumMs = addObservationNumbers(target.latencySumMs, source.latencySumMs);
  target.latencyMaxMs = maxObservationNumber(target.latencyMaxMs, source.latencyMaxMs);
}

function mergeTaskMetricRows(target, source) {
  target.runCount = addObservationNumbers(target.runCount, source.runCount);
  target.durationCount = addObservationNumbers(target.durationCount, source.durationCount);
  target.durationSumMs = addObservationNumbers(target.durationSumMs, source.durationSumMs);
  target.durationMaxMs = maxObservationNumber(target.durationMaxMs, source.durationMaxMs);
  target.queueWaitCount = addObservationNumbers(target.queueWaitCount, source.queueWaitCount);
  target.queueWaitSumMs = addObservationNumbers(target.queueWaitSumMs, source.queueWaitSumMs);
  target.queueWaitMaxMs = maxObservationNumber(target.queueWaitMaxMs, source.queueWaitMaxMs);
  target.attributedCommandCount = addObservationNumbers(
    target.attributedCommandCount,
    source.attributedCommandCount,
  );
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
    commandCount = addObservationNumbers(commandCount, row.commandCount);
    rateLimitedCount = addObservationNumbers(rateLimitedCount, row.rateLimitedCount);
  }
  for (const row of taskMetrics) {
    taskCount = addObservationNumbers(taskCount, row.runCount);
  }

  return { commandCount, taskCount, rateLimitedCount };
}

const COMMAND_METRIC_NUMBER_FIELDS = [
  'commandCount',
  'errorCount',
  'timeoutCount',
  'disconnectedCount',
  'rateLimitedCount',
  'latencyCount',
  'latencySumMs',
  'latencyMaxMs',
];
const TASK_METRIC_NUMBER_FIELDS = [
  'runCount',
  'durationCount',
  'durationSumMs',
  'durationMaxMs',
  'queueWaitCount',
  'queueWaitSumMs',
  'queueWaitMaxMs',
  'attributedCommandCount',
];

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasValidDimensions(dimensions) {
  return isRecord(dimensions)
    && Object.values(dimensions).every((value) => typeof value === 'string');
}

function hasValidMetricIdentity(row) {
  if (!isRecord(row) || !UTC_MINUTE_PATTERN.test(row.minute)) return false;
  const timestamp = parseTimestamp(`${row.minute.replace(' ', 'T')}Z`);
  return timestamp !== null
    && OBSERVATION_OUTCOME_SET.has(row.outcome)
    && hasValidDimensions(row.dimensions);
}

function hasValidMetricNumbers(row, fields) {
  return fields.every((field) => (
    typeof row[field] === 'number' && Number.isFinite(row[field]) && row[field] >= 0
  ));
}

function isValidSnapshotForMerge(snapshot) {
  if (
    snapshot?.version !== 1
    || !Array.isArray(snapshot.commandMetrics)
    || !Array.isArray(snapshot.taskMetrics)
    || !Array.isArray(snapshot.anomalies)
    || !isRecord(snapshot.health)
  ) {
    return false;
  }

  if (!snapshot.commandMetrics.every((row) => (
    hasValidMetricIdentity(row) && hasValidMetricNumbers(row, COMMAND_METRIC_NUMBER_FIELDS)
  ))) return false;
  if (!snapshot.taskMetrics.every((row) => (
    hasValidMetricIdentity(row) && hasValidMetricNumbers(row, TASK_METRIC_NUMBER_FIELDS)
  ))) return false;
  if (!snapshot.anomalies.every((anomaly) => (
    isRecord(anomaly)
    && parseTimestamp(anomaly.timestamp) !== null
    && typeof anomaly.type === 'string'
    && typeof anomaly.message === 'string'
    && hasValidDimensions(anomaly.dimensions)
  ))) return false;

  return ['metricKeys', 'anomalyCount', 'droppedMetrics', 'droppedAnomalies'].every((field) => (
    typeof snapshot.health[field] === 'number'
    && Number.isFinite(snapshot.health[field])
    && snapshot.health[field] >= 0
  ));
}

export class SchedulerObservationAggregator {
  constructor({ now = Date.now, maxMetricKeys = 20_000, maxAnomalies = 5_000 } = {}) {
    this._now = typeof now === 'function' ? now : Date.now;
    this._maxMetricKeys = normalizeCapacity(maxMetricKeys, 20_000);
    this._maxAnomalies = normalizeCapacity(maxAnomalies, 5_000);
    this._commandMetrics = new Map();
    this._taskMetrics = new Map();
    this._anomalies = [];
    this._restoredAnomalyCount = 0;
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
      this._droppedMetrics = addObservationNumbers(this._droppedMetrics, 1);
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
    const entry = this._createAnomalyEntry(anomaly);
    this._anomalies.push(entry);
    let retained = true;

    if (this._anomalies.length > this._maxAnomalies) {
      const [removed] = this._anomalies.splice(this._restoredAnomalyCount, 1);
      this._droppedAnomalies = addObservationNumbers(this._droppedAnomalies, 1);
      retained = removed !== entry;
    }

    return retained;
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
    this._restoredAnomalyCount = 0;
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
    try {
      if (!isValidSnapshotForMerge(snapshot)) return false;

      const staging = new SchedulerObservationAggregator({
        now: this._now,
        maxMetricKeys: this._maxMetricKeys,
        maxAnomalies: this._maxAnomalies,
      });
      staging._commandMetrics = new Map(
        [...this._commandMetrics].map(([key, row]) => [key, cloneMetricRow(row)]),
      );
      staging._taskMetrics = new Map(
        [...this._taskMetrics].map(([key, row]) => [key, cloneMetricRow(row)]),
      );
      staging._anomalies = this._anomalies.map((entry) => ({
        ...entry,
        dimensions: { ...entry.dimensions },
      }));
      staging._restoredAnomalyCount = this._restoredAnomalyCount;
      staging._droppedMetrics = this._droppedMetrics;
      staging._droppedAnomalies = this._droppedAnomalies;

      for (const row of snapshot.commandMetrics) staging._mergeMetricRow('command', row);
      for (const row of snapshot.taskMetrics) staging._mergeMetricRow('task', row);

      const restoredAnomalies = snapshot.anomalies.map((anomaly) => (
        staging._createAnomalyEntry(anomaly)
      ));
      staging._anomalies.splice(
        staging._restoredAnomalyCount,
        0,
        ...restoredAnomalies,
      );
      staging._restoredAnomalyCount += restoredAnomalies.length;
      staging._droppedMetrics = addObservationNumbers(
        staging._droppedMetrics,
        normalizeCapacity(snapshot.health.droppedMetrics, 0),
      );
      staging._droppedAnomalies = addObservationNumbers(
        staging._droppedAnomalies,
        normalizeCapacity(snapshot.health.droppedAnomalies, 0),
      );

      this._commandMetrics = staging._commandMetrics;
      this._taskMetrics = staging._taskMetrics;
      this._anomalies = staging._anomalies;
      this._restoredAnomalyCount = staging._restoredAnomalyCount;
      this._droppedMetrics = staging._droppedMetrics;
      this._droppedAnomalies = staging._droppedAnomalies;
      return true;
    } catch {
      return false;
    }
  }
}
