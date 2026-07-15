export const OBSERVABILITY_RANGE_OPTIONS = [
  { label: '最近 1 小时', value: '1h' },
  { label: '最近 6 小时', value: '6h' },
  { label: '最近 24 小时', value: '24h' },
  { label: '最近 3 天', value: '3d' },
];

const ANOMALY_CATEGORY_LABELS = new Map([
  ['command_rate_limited', '触发限流'],
  ['command_timeout', '请求超时'],
  ['command_disconnected', '连接断开'],
  ['slow_command', '响应缓慢'],
  ['command_error', '命令错误'],
]);

const ANOMALY_CATEGORY_ALIASES = new Map([
  ['rate_limited', 'command_rate_limited'],
  ['timeout', 'command_timeout'],
  ['disconnected', 'command_disconnected'],
  ['slow', 'slow_command'],
  ['error', 'command_error'],
]);

function finiteNonNegative(value) {
  try {
    const number = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(number) && number >= 0 ? number : 0;
  } catch {
    return 0;
  }
}

function safeRead(value, key) {
  try {
    return value !== null && typeof value === 'object' ? value[key] : undefined;
  } catch {
    return undefined;
  }
}

function safeString(value) {
  return typeof value === 'string' ? value : '';
}

function safeDateTime(value) {
  if (typeof value !== 'string') return null;
  try {
    const timestamp = Date.parse(value);
    return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
  } catch {
    return null;
  }
}

function safeRatio(value) {
  return Math.min(1, finiteNonNegative(value));
}

function safePositiveInteger(value, fallback) {
  const number = finiteNonNegative(value);
  return number >= 1 ? Math.floor(number) : fallback;
}

function safeNullableInteger(value) {
  if (value === null || value === undefined || value === '') return null;
  try {
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric < 0) return null;
    return Math.floor(numeric);
  } catch {
    return null;
  }
}

function safeRows(value) {
  if (!Array.isArray(value)) return [];
  let length = 0;
  try {
    length = value.length;
  } catch {
    return [];
  }

  const rows = [];
  for (let index = 0; index < length; index += 1) {
    let row;
    try {
      row = value[index];
    } catch {
      row = undefined;
    }
    if (row !== null && typeof row === 'object') rows.push({ row, index });
  }
  return rows;
}

function formatPercent(value) {
  const percentage = Math.round(safeRatio(value) * 10_000) / 100;
  return `${percentage.toFixed(2).replace(/\.00$/, '')}%`;
}

function normalizeEgressDescriptor(row) {
  const type = safeString(safeRead(row, 'type') ?? safeRead(row, 'egressType'));
  const rawKey = safeString(safeRead(row, 'key') ?? safeRead(row, 'egressKey'));
  if (type === 'direct') return { type: 'direct', key: 'direct' };
  if (type === 'proxy' && /^proxy:[a-f\d]{12}$/.test(rawKey)) {
    return { type: 'proxy', key: rawKey };
  }
  return { type: type === 'proxy' ? 'proxy' : 'unknown', key: 'unknown' };
}

function normalizeAnomalyCategory(category) {
  if (typeof category !== 'string') return 'unknown';
  const canonical = ANOMALY_CATEGORY_ALIASES.get(category) ?? category;
  return ANOMALY_CATEGORY_LABELS.has(canonical) ? canonical : 'unknown';
}

export function formatMetricDuration(ms) {
  const duration = ms === null ? 0 : finiteNonNegative(ms);
  return duration < 1000 ? `${duration} ms` : `${(duration / 1000).toFixed(2)} s`;
}

export function formatAmplification(commandCount, runCount) {
  const commands = finiteNonNegative(commandCount);
  const runs = finiteNonNegative(runCount);
  if (commands === 0 || runs === 0) return 0;

  const amplification = commands / runs;
  if (!Number.isFinite(amplification) || amplification < 0) return 0;
  const rounded = Math.round(amplification * 100) / 100;
  return Number.isFinite(rounded) ? rounded : amplification;
}

export function buildTrendBars(series) {
  let isArray = false;
  try {
    isArray = Array.isArray(series);
  } catch {
    return [];
  }
  if (!isArray) return [];

  let length = 0;
  try {
    length = series.length;
  } catch {
    return [];
  }

  const rows = [];
  for (let index = 0; index < length; index += 1) {
    let row;
    try {
      row = series[index];
    } catch {
      row = undefined;
    }
    rows.push({
      bucket: safeString(safeRead(row, 'bucket')),
      originalIndex: index,
      value: finiteNonNegative(safeRead(row, 'commandCount')),
    });
  }

  rows.sort((left, right) => (
    left.bucket.localeCompare(right.bucket) || left.originalIndex - right.originalIndex
  ));

  const maximum = rows.reduce((current, row) => Math.max(current, row.value), 0);

  return rows.map((row) => {
    const key = JSON.stringify([row.bucket, row.originalIndex]);
    const scaledHeight = maximum === 0 ? 0 : (row.value / maximum) * 100;
    const height = Number.isFinite(scaledHeight)
      ? Math.min(100, Math.max(0, Math.round(scaledHeight * 100) / 100))
      : 0;

    return { key, bucket: row.bucket, value: row.value, height };
  });
}

export function formatEgressLabel(row) {
  const type = safeString(safeRead(row, 'type') ?? safeRead(row, 'egressType'));
  const key = safeString(safeRead(row, 'key') ?? safeRead(row, 'egressKey'));

  if (type === 'direct' && key === 'direct') return '直连';
  const proxyMatch = type === 'proxy' ? /^proxy:([a-f\d]{12})$/.exec(key) : null;
  return proxyMatch ? `匿名代理 ${proxyMatch[1]}` : '未知出口';
}

export function formatAnomalyCategory(category) {
  const categoryValue = typeof category === 'string' ? category : safeRead(category, 'category');
  if (typeof categoryValue !== 'string') return '未知异常';

  const canonicalCategory = ANOMALY_CATEGORY_ALIASES.get(categoryValue) ?? categoryValue;
  return ANOMALY_CATEGORY_LABELS.get(canonicalCategory) ?? '未知异常';
}

const HEADLINE_DEFINITIONS = [
  { key: 'currentCommandRate', label: '当前命令速率', unit: '命令/分钟' },
  { key: 'peakCommandRate', label: '区间峰值', unit: '命令/分钟' },
  { key: 'rateLimitedCount', label: '限频', unit: '次' },
  { key: 'timeoutCount', label: '超时', unit: '次' },
  { key: 'averageLatencyMs', label: '平均响应', unit: '', duration: true },
  { key: 'maxQueueWaitMs', label: '最大排队', unit: '', duration: true },
];

const HEALTH_COUNTER_DEFINITIONS = [
  { key: 'flushErrors', label: '写入错误' },
  { key: 'mergeErrors', label: '合并错误' },
  { key: 'droppedRetrySnapshots', label: '丢弃重试快照' },
  { key: 'observationErrors', label: '观测错误' },
  { key: 'healthErrors', label: '健康检查错误' },
  { key: 'pendingQueueWaits', label: '待归并排队' },
  { key: 'droppedQueueWaits', label: '丢弃排队指标' },
  { key: 'metricKeys', label: '指标键' },
  { key: 'anomalyCount', label: '内存异常数' },
  { key: 'droppedMetrics', label: '丢弃指标' },
  { key: 'droppedAnomalies', label: '丢弃异常' },
];

const HEALTH_ISSUE_KEYS = new Set([
  'flushErrors',
  'mergeErrors',
  'droppedRetrySnapshots',
  'observationErrors',
  'healthErrors',
  'droppedQueueWaits',
  'droppedMetrics',
  'droppedAnomalies',
]);

function buildHeadline(headline) {
  return HEADLINE_DEFINITIONS.map((definition) => {
    const value = finiteNonNegative(safeRead(headline, definition.key));
    return {
      key: definition.key,
      label: definition.label,
      value,
      display: definition.duration ? formatMetricDuration(value) : String(value),
      unit: definition.unit,
    };
  });
}

function buildTasks(tasks) {
  return safeRows(tasks).map(({ row, index }) => {
    const taskType = safeString(safeRead(row, 'taskType')) || '未归类';
    const errorRate = safeRatio(safeRead(row, 'errorRate'));
    const commandAmplification = finiteNonNegative(safeRead(row, 'commandAmplification'));
    const averageDurationMs = finiteNonNegative(safeRead(row, 'averageDurationMs'));
    const maxDurationMs = finiteNonNegative(safeRead(row, 'maxDurationMs'));
    return {
      key: JSON.stringify([taskType, index]),
      taskType,
      runCount: finiteNonNegative(safeRead(row, 'runCount')),
      errorCount: finiteNonNegative(safeRead(row, 'errorCount')),
      timeoutCount: finiteNonNegative(safeRead(row, 'timeoutCount')),
      averageDurationMs,
      maxDurationMs,
      averageQueueWaitMs: finiteNonNegative(safeRead(row, 'averageQueueWaitMs')),
      maxQueueWaitMs: finiteNonNegative(safeRead(row, 'maxQueueWaitMs')),
      attributedCommandCount: finiteNonNegative(safeRead(row, 'attributedCommandCount')),
      commandCount: finiteNonNegative(safeRead(row, 'commandCount')),
      errorRate,
      errorRateDisplay: formatPercent(errorRate),
      commandAmplification,
      amplificationDisplay: `${commandAmplification}×`,
      averageDurationDisplay: formatMetricDuration(averageDurationMs),
      maxDurationDisplay: formatMetricDuration(maxDurationMs),
    };
  });
}

function buildEgresses(egresses) {
  return safeRows(egresses).map(({ row, index }) => {
    const descriptor = normalizeEgressDescriptor(row);
    const errorRate = safeRatio(safeRead(row, 'errorRate'));
    return {
      key: JSON.stringify([descriptor.type, descriptor.key, index]),
      label: formatEgressLabel(descriptor),
      type: descriptor.type,
      commandCount: finiteNonNegative(safeRead(row, 'commandCount')),
      errorCount: finiteNonNegative(safeRead(row, 'errorCount')),
      timeoutCount: finiteNonNegative(safeRead(row, 'timeoutCount')),
      disconnectedCount: finiteNonNegative(safeRead(row, 'disconnectedCount')),
      rateLimitedCount: finiteNonNegative(safeRead(row, 'rateLimitedCount')),
      averageLatencyMs: finiteNonNegative(safeRead(row, 'averageLatencyMs')),
      maxLatencyMs: finiteNonNegative(safeRead(row, 'maxLatencyMs')),
      errorRate,
      errorRateDisplay: formatPercent(errorRate),
    };
  });
}

function buildHealth(health) {
  const hasHealthPayload = health !== null && typeof health === 'object';
  const enabledValue = safeRead(health, 'enabled');
  const startedValue = safeRead(health, 'started');
  const enabled = typeof enabledValue === 'boolean' ? enabledValue : null;
  const started = typeof startedValue === 'boolean' ? startedValue : null;
  const counterRows = HEALTH_COUNTER_DEFINITIONS.map(({ key, label }) => ({
    key,
    label,
    value: finiteNonNegative(safeRead(health, key)),
  }));
  const hasIssues = counterRows.some((counter) => (
    HEALTH_ISSUE_KEYS.has(counter.key) && counter.value > 0
  ));
  let state = 'unknown';
  let label = '状态未知';
  let tone = 'neutral';
  if (hasHealthPayload && enabled === false) {
    state = 'disabled';
    label = '观测未启用';
    tone = 'warning';
  } else if (enabled === true && started === false) {
    state = 'stopped';
    label = '服务未启动';
    tone = 'warning';
  } else if (enabled === true && started === true && hasIssues) {
    state = 'degraded';
    label = '存在异常';
    tone = 'danger';
  } else if (enabled === true && started === true) {
    state = 'healthy';
    label = '运行正常';
    tone = 'success';
  }

  return {
    enabled,
    started,
    state,
    label,
    tone,
    lastFlushAt: safeDateTime(safeRead(health, 'lastFlushAt')),
    lastFlushDurationMs: finiteNonNegative(safeRead(health, 'lastFlushDurationMs')),
    ...Object.fromEntries(counterRows.map(({ key, value }) => [key, value])),
    counterRows,
  };
}

function buildAnomalies(anomalies) {
  const items = safeRows(safeRead(anomalies, 'items')).map(({ row, index }) => {
    const id = safeNullableInteger(safeRead(row, 'id'));
    const occurredAt = safeDateTime(safeRead(row, 'occurredAt'));
    const descriptor = normalizeEgressDescriptor(row);
    const category = normalizeAnomalyCategory(safeRead(row, 'category'));
    const latencyMs = finiteNonNegative(safeRead(row, 'latencyMs'));
    return {
      key: JSON.stringify([id, occurredAt, index]),
      id,
      occurredAt,
      runId: safeString(safeRead(row, 'runId')),
      accountId: safeNullableInteger(safeRead(row, 'accountId')),
      batchTaskId: safeNullableInteger(safeRead(row, 'batchTaskId')),
      source: safeString(safeRead(row, 'source')),
      taskType: safeString(safeRead(row, 'taskType')),
      command: safeString(safeRead(row, 'command')),
      executionLane: safeString(safeRead(row, 'executionLane')),
      egressType: descriptor.type,
      egressKey: descriptor.key,
      egressLabel: formatEgressLabel(descriptor),
      category,
      categoryLabel: formatAnomalyCategory(category),
      errorCode: safeNullableInteger(safeRead(row, 'errorCode')),
      latencyMs,
      latencyDisplay: formatMetricDuration(latencyMs),
      queueWaitMs: finiteNonNegative(safeRead(row, 'queueWaitMs')),
      summary: safeString(safeRead(row, 'summary')),
    };
  });

  return {
    items,
    total: Math.floor(finiteNonNegative(safeRead(anomalies, 'total'))),
    page: safePositiveInteger(safeRead(anomalies, 'page'), 1),
    pageSize: Math.min(100, safePositiveInteger(safeRead(anomalies, 'pageSize'), 25)),
  };
}

export function buildSchedulerObservabilityViewModel(summary = {}, anomalies = {}) {
  const headline = safeRead(summary, 'headline');
  return {
    hasSummaryData: headline !== null && typeof headline === 'object',
    range: safeString(safeRead(summary, 'range')),
    generatedAt: safeDateTime(safeRead(summary, 'generatedAt')),
    headline: buildHeadline(headline),
    totals: {
      commandCount: finiteNonNegative(safeRead(headline, 'commandCount')),
      taskCount: finiteNonNegative(safeRead(headline, 'taskCount')),
      commandErrorRate: safeRatio(safeRead(headline, 'commandErrorRate')),
      commandAmplification: finiteNonNegative(safeRead(headline, 'commandAmplification')),
    },
    trend: buildTrendBars(safeRead(summary, 'series')),
    tasks: buildTasks(safeRead(summary, 'tasks')),
    egresses: buildEgresses(safeRead(summary, 'egresses')),
    health: buildHealth(safeRead(summary, 'health')),
    anomalies: buildAnomalies(anomalies),
  };
}
