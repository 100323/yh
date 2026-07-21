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

const SOURCE_LABELS = new Map([
  ['scheduler', '定时调度'],
  ['scheduler-recovery', '重启恢复'],
  ['scheduler-reconcile', '分钟对账补漏'],
  ['scheduler-catchup', '晚间补偿'],
  ['scheduler-manual', '手动执行'],
  ['batch', '批量任务'],
  ['system', '系统收尾'],
]);

export const SCHEDULER_SOURCE_OPTIONS = [
  { value: 'scheduler', label: '定时调度', description: '按任务配置的时间自动执行。' },
  { value: 'scheduler-recovery', label: '重启恢复', description: '服务重启后恢复尚未开始的错峰任务。' },
  { value: 'scheduler-reconcile', label: '分钟对账补漏', description: '检测定时回调未触发且没有生成槽位的任务，并重新入队。' },
  { value: 'scheduler-catchup', label: '晚间补偿', description: '晚间检查并补做符合条件的任务。' },
  { value: 'scheduler-manual', label: '手动执行', description: '在任务管理中由人工单独触发。' },
  { value: 'batch', label: '批量任务', description: '从批量任务计划发起的执行。' },
  { value: 'system', label: '系统收尾', description: '任务完成后的系统自动收尾操作。' },
];

const COMMAND_LABELS = new Map([
  ['role_getroleinfo', '获取角色信息'],
  ['system_getdatabundlever', '获取数据版本'],
  ['fight_startlevel', '挑战关卡'],
  ['system_mysharecallback', '领取分享奖励'],
  ['system_claimhangupreward', '领取挂机奖励'],
  ['task_claimdailypoint', '领取日常活跃奖励'],
  ['fight_starttower', '挑战爬塔'],
  ['fight_startareaarena', '挑战竞技场'],
  ['arena_getareatarget', '获取竞技场目标'],
  ['arena_startarea', '发起竞技场战斗'],
  ['mail_getlist', '获取邮件列表'],
  ['mail_claimallattachment', '一键领取邮件'],
  ['card_claimreward', '领取卡牌奖励'],
  ['genie_sweep', '灯神扫荡'],
  ['genie_buysweep', '购买灯神扫荡次数'],
  ['fight_startboss', '挑战军团BOSS'],
  ['system_buygold', '购买金币'],
  ['hero_recruit', '英雄招募'],
  ['item_openbox', '开启宝箱'],
  ['store_purchase', '商店购买'],
  ['mergebox_getinfo', '获取合成箱信息'],
  ['mergebox_mergeitem', '合成物品'],
  ['mergebox_openbox', '开启合成箱'],
  ['legion_signin', '军团签到'],
  ['presetteam_getinfo', '获取预设阵容'],
  ['presetteam_saveteam', '保存预设阵容'],
]);

const BUILTIN_TASK_TYPE_LABELS = new Map([
  ['BATCH', '批量任务'],
  ['DAILY_TASK', '日常任务'],
  ['DAILY_TASK_CLAIM', '日常活跃奖励'],
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

function finiteNullableNonNegative(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
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

export function formatSourceLabel(source) {
  return SOURCE_LABELS.get(safeString(source)) || '未知来源';
}

export function formatCommandLabel(command) {
  const normalized = safeString(command);
  if (!normalized) return '未记录命令';
  return COMMAND_LABELS.get(normalized) || '未收录命令';
}

export function formatTaskTypeLabel(taskType, taskTypeLabels = {}) {
  const normalized = safeString(taskType);
  const label = safeString(safeRead(taskTypeLabels, normalized));
  if (!normalized || normalized === '未归类') return '未归类';
  return label || BUILTIN_TASK_TYPE_LABELS.get(normalized) || '未收录任务';
}

export function buildSchedulerObservabilityRequestParams(filters = {}, page = 1, pageSize = 25) {
  const common = {};
  for (const name of ['range', 'source', 'taskType', 'egressType']) {
    const value = safeString(safeRead(filters, name));
    if (value !== '') common[name] = value;
  }
  const summary = { ...common };
  const commandClass = safeString(safeRead(filters, 'commandClass'));
  if (commandClass !== '') summary.commandClass = commandClass;

  return {
    summary,
    anomalies: {
      ...common,
      page: safePositiveInteger(page, 1),
      pageSize: Math.min(100, safePositiveInteger(pageSize, 25)),
    },
  };
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

function buildTasks(tasks, taskTypeLabels) {
  return safeRows(tasks).map(({ row, index }) => {
    const taskType = safeString(safeRead(row, 'taskType')) || '未归类';
    const errorRate = safeRatio(safeRead(row, 'errorRate'));
    const anomalyRate = safeRatio(safeRead(row, 'anomalyRate'));
    const commandAmplification = finiteNonNegative(safeRead(row, 'commandAmplification'));
    const averageDurationMs = finiteNonNegative(safeRead(row, 'averageDurationMs'));
    const maxDurationMs = finiteNonNegative(safeRead(row, 'maxDurationMs'));
    return {
      key: JSON.stringify([taskType, index]),
      taskType,
      taskTypeLabel: formatTaskTypeLabel(taskType, taskTypeLabels),
      runCount: finiteNonNegative(safeRead(row, 'runCount')),
      errorCount: finiteNonNegative(safeRead(row, 'errorCount')),
      timeoutCount: finiteNonNegative(safeRead(row, 'timeoutCount')),
      averageDurationMs,
      maxDurationMs,
      averageQueueWaitMs: finiteNonNegative(safeRead(row, 'averageQueueWaitMs')),
      maxQueueWaitMs: finiteNonNegative(safeRead(row, 'maxQueueWaitMs')),
      attributedCommandCount: finiteNonNegative(safeRead(row, 'attributedCommandCount')),
      commandCount: finiteNonNegative(safeRead(row, 'commandCount')),
      anomalyCount: finiteNonNegative(safeRead(row, 'anomalyCount')),
      anomalyRate,
      anomalyRateDisplay: formatPercent(anomalyRate),
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
    const anomalyRate = safeRatio(safeRead(row, 'anomalyRate'));
    return {
      key: JSON.stringify([descriptor.type, descriptor.key, index]),
      label: formatEgressLabel(descriptor),
      type: descriptor.type,
      commandCount: finiteNonNegative(safeRead(row, 'commandCount')),
      errorCount: finiteNonNegative(safeRead(row, 'errorCount')),
      timeoutCount: finiteNonNegative(safeRead(row, 'timeoutCount')),
      disconnectedCount: finiteNonNegative(safeRead(row, 'disconnectedCount')),
      rateLimitedCount: finiteNonNegative(safeRead(row, 'rateLimitedCount')),
      slowCount: finiteNonNegative(safeRead(row, 'slowCount')),
      anomalyCount: finiteNonNegative(safeRead(row, 'anomalyCount')),
      averageLatencyMs: finiteNonNegative(safeRead(row, 'averageLatencyMs')),
      maxLatencyMs: finiteNonNegative(safeRead(row, 'maxLatencyMs')),
      errorRate,
      errorRateDisplay: formatPercent(errorRate),
      anomalyRate,
      anomalyRateDisplay: formatPercent(anomalyRate),
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
    lastFlushDurationMs: finiteNullableNonNegative(safeRead(health, 'lastFlushDurationMs')),
    ...Object.fromEntries(counterRows.map(({ key, value }) => [key, value])),
    counterRows,
  };
}

function buildAnomalies(anomalies, taskTypeLabels) {
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
      sourceLabel: formatSourceLabel(safeRead(row, 'source')),
      taskTypeLabel: formatTaskTypeLabel(safeRead(row, 'taskType'), taskTypeLabels),
      commandLabel: formatCommandLabel(safeRead(row, 'command')),
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

function buildSlots(slotSummary) {
  const hasData = slotSummary !== null
    && typeof slotSummary === 'object'
    && safeRead(slotSummary, 'totalCount') !== undefined;
  const metricDefinitions = [
    { key: 'queuedCount', label: '等待执行', tone: 'warning' },
    { key: 'recoveredCount', label: '重启恢复', tone: 'success' },
    { key: 'interruptedCount', label: '中断未重放', tone: 'danger' },
    { key: 'unavailableCount', label: '配置不可用', tone: 'neutral' },
  ];
  return {
    hasData,
    range: safeString(safeRead(slotSummary, 'range')),
    generatedAt: safeDateTime(safeRead(slotSummary, 'generatedAt')),
    totalCount: finiteNonNegative(safeRead(slotSummary, 'totalCount')),
    metrics: metricDefinitions.map((definition) => ({
      ...definition,
      value: finiteNonNegative(safeRead(slotSummary, definition.key)),
    })),
  };
}

export function buildSchedulerObservabilityViewModel(summary = {}, anomalies = {}, options = {}) {
  const headline = safeRead(summary, 'headline');
  const taskTypeLabels = safeRead(options, 'taskTypeLabels') || {};
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
    tasks: buildTasks(safeRead(summary, 'tasks'), taskTypeLabels),
    egresses: buildEgresses(safeRead(summary, 'egresses')),
    health: buildHealth(safeRead(summary, 'health')),
    anomalies: buildAnomalies(anomalies, taskTypeLabels),
    slots: buildSlots(safeRead(options, 'slotSummary')),
  };
}
