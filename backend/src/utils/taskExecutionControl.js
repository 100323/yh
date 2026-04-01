import config from '../config/index.js';

const TOO_FAST_ERROR_PATTERNS = ['操作过快', '请稍后重试'];
const HASH_MOD = 2147483647;

function toPositiveNumber(value, fallback = 0) {
  const normalized = Number(value);
  return Number.isFinite(normalized) && normalized > 0 ? normalized : fallback;
}

export function sleep(ms) {
  const delayMs = Math.max(0, Number(ms) || 0);
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

export function getSchedulerStaggerWindowMs() {
  return toPositiveNumber(config?.scheduler?.staggerWindowMs, 0);
}

export function computeDeterministicDelayMs(seed, maxDelayMs = getSchedulerStaggerWindowMs()) {
  const normalizedSeed = String(seed || '').trim();
  const normalizedMaxDelay = toPositiveNumber(maxDelayMs, 0);
  if (!normalizedSeed || normalizedMaxDelay <= 0) {
    return 0;
  }

  let hash = 0;
  for (let i = 0; i < normalizedSeed.length; i += 1) {
    hash = ((hash * 131) + normalizedSeed.charCodeAt(i)) % HASH_MOD;
  }
  return hash % (normalizedMaxDelay + 1);
}

export async function waitForScheduledTaskStagger(context = {}) {
  const staggerWindowMs = getSchedulerStaggerWindowMs();
  if (staggerWindowMs <= 0) {
    return 0;
  }

  const seed = [
    context.scope || 'scheduler',
    context.taskId || '',
    context.accountId || '',
    context.taskType || '',
    context.cronExpression || '',
  ].join(':');
  const delayMs = computeDeterministicDelayMs(seed, staggerWindowMs);

  if (delayMs > 0) {
    console.log('⏱️ 定时任务错峰延迟', {
      ...context,
      delayMs,
      staggerWindowMs,
    });
    await sleep(delayMs);
  }

  return delayMs;
}

export function isTooFastError(error) {
  const message = String(error?.message || error || '');
  return TOO_FAST_ERROR_PATTERNS.some((pattern) => message.includes(pattern));
}

export function getSensitiveTaskRetryConfig() {
  return {
    maxRetries: toPositiveNumber(config?.scheduler?.sensitiveTaskRetry?.maxRetries, 2),
    baseDelayMs: toPositiveNumber(config?.scheduler?.sensitiveTaskRetry?.baseDelayMs, 3000),
    maxDelayMs: toPositiveNumber(config?.scheduler?.sensitiveTaskRetry?.maxDelayMs, 8000),
  };
}

export function getWsReconnectRetryConfig() {
  return {
    maxRetries: toPositiveNumber(config?.scheduler?.wsReconnectRetry?.maxRetries, 2),
    baseDelayMs: toPositiveNumber(config?.scheduler?.wsReconnectRetry?.baseDelayMs, 1500),
    maxDelayMs: toPositiveNumber(config?.scheduler?.wsReconnectRetry?.maxDelayMs, 5000),
  };
}
