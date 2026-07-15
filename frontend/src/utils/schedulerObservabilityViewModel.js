export const OBSERVABILITY_RANGE_OPTIONS = [
  { label: '最近 1 小时', value: '1h' },
  { label: '最近 6 小时', value: '6h' },
  { label: '最近 24 小时', value: '24h' },
  { label: '最近 3 天', value: '3d' },
];

const ANOMALY_CATEGORY_LABELS = Object.freeze({
  rate_limited: '触发限流',
  timeout: '请求超时',
  disconnected: '连接断开',
  slow: '响应缓慢',
  error: '命令错误',
});

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
  const keyCounts = new Map();

  return rows.map((row) => {
    const keyBase = row.bucket || `trend-${row.originalIndex}`;
    const keyOccurrence = keyCounts.get(keyBase) ?? 0;
    keyCounts.set(keyBase, keyOccurrence + 1);
    const key = keyOccurrence === 0 ? keyBase : `${keyBase}-${keyOccurrence + 1}`;
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
  return typeof category === 'string'
    ? ANOMALY_CATEGORY_LABELS[category] ?? '未知异常'
    : '未知异常';
}
