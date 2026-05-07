import config from '../config/index.js';
import { get, run } from '../database/index.js';

export const SCHEDULER_MAX_CONCURRENT_ACCOUNTS_KEY = 'scheduler_max_concurrent_accounts';
export const SCHEDULER_MAX_CONCURRENT_ACCOUNTS_MIN = 1;
export const SCHEDULER_MAX_CONCURRENT_ACCOUNTS_MAX = 20;
export const SCHEDULER_ACCOUNT_DISPATCH_INTERVAL_MS_KEY = 'scheduler_account_dispatch_interval_ms';
export const SCHEDULER_ACCOUNT_DISPATCH_INTERVAL_MS_MIN = 0;
export const SCHEDULER_ACCOUNT_DISPATCH_INTERVAL_MS_MAX = 120000;

function toInteger(value) {
  const normalized = Number(value);
  return Number.isInteger(normalized) ? normalized : null;
}

function getSchedulerMaxConcurrentAccountsFallback() {
  const fallback = Number(config?.scheduler?.maxConcurrentAccounts || 0);
  if (Number.isInteger(fallback) && fallback >= SCHEDULER_MAX_CONCURRENT_ACCOUNTS_MIN) {
    return Math.min(fallback, SCHEDULER_MAX_CONCURRENT_ACCOUNTS_MAX);
  }
  return 3;
}

function getSchedulerAccountDispatchIntervalMsFallback() {
  const fallback = Number(config?.scheduler?.accountDispatchIntervalMs || 0);
  if (
    Number.isInteger(fallback) &&
    fallback >= SCHEDULER_ACCOUNT_DISPATCH_INTERVAL_MS_MIN &&
    fallback <= SCHEDULER_ACCOUNT_DISPATCH_INTERVAL_MS_MAX
  ) {
    return fallback;
  }
  return 8000;
}

export function normalizeSchedulerMaxConcurrentAccounts(value) {
  const normalized = toInteger(value);
  if (
    normalized === null ||
    normalized < SCHEDULER_MAX_CONCURRENT_ACCOUNTS_MIN ||
    normalized > SCHEDULER_MAX_CONCURRENT_ACCOUNTS_MAX
  ) {
    throw new Error(
      `并发账号数需为 ${SCHEDULER_MAX_CONCURRENT_ACCOUNTS_MIN}-${SCHEDULER_MAX_CONCURRENT_ACCOUNTS_MAX} 的整数`
    );
  }
  return normalized;
}

export function normalizeSchedulerAccountDispatchIntervalMs(value) {
  const normalized = toInteger(value);
  if (
    normalized === null ||
    normalized < SCHEDULER_ACCOUNT_DISPATCH_INTERVAL_MS_MIN ||
    normalized > SCHEDULER_ACCOUNT_DISPATCH_INTERVAL_MS_MAX
  ) {
    throw new Error(
      `账号启动间隔需为 ${SCHEDULER_ACCOUNT_DISPATCH_INTERVAL_MS_MIN / 1000}-${SCHEDULER_ACCOUNT_DISPATCH_INTERVAL_MS_MAX / 1000} 秒`
    );
  }
  return normalized;
}

export function getSystemSettingValue(key, fallback = null) {
  try {
    const row = get('SELECT value FROM system_settings WHERE key = ? LIMIT 1', [key]);
    if (!row || row.value === undefined || row.value === null || row.value === '') {
      return fallback;
    }
    return row.value;
  } catch {
    return fallback;
  }
}

export function setSystemSettingValue(key, value) {
  const existing = get('SELECT key FROM system_settings WHERE key = ? LIMIT 1', [key]);
  if (existing) {
    run(
      'UPDATE system_settings SET value = ?, updated_at = CURRENT_TIMESTAMP WHERE key = ?',
      [String(value), key],
    );
    return;
  }

  run(
    'INSERT INTO system_settings (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)',
    [key, String(value)],
  );
}

export function getSchedulerMaxConcurrentAccountsSetting() {
  const fallback = getSchedulerMaxConcurrentAccountsFallback();
  const stored = getSystemSettingValue(SCHEDULER_MAX_CONCURRENT_ACCOUNTS_KEY, null);
  if (stored === null) {
    return fallback;
  }

  const normalized = Number(stored);
  if (!Number.isInteger(normalized) || normalized < SCHEDULER_MAX_CONCURRENT_ACCOUNTS_MIN) {
    return fallback;
  }

  return Math.min(normalized, SCHEDULER_MAX_CONCURRENT_ACCOUNTS_MAX);
}

export function getSchedulerAccountDispatchIntervalMsSetting() {
  const fallback = getSchedulerAccountDispatchIntervalMsFallback();
  const stored = getSystemSettingValue(SCHEDULER_ACCOUNT_DISPATCH_INTERVAL_MS_KEY, null);
  if (stored === null) {
    return fallback;
  }

  const normalized = Number(stored);
  if (
    !Number.isInteger(normalized) ||
    normalized < SCHEDULER_ACCOUNT_DISPATCH_INTERVAL_MS_MIN ||
    normalized > SCHEDULER_ACCOUNT_DISPATCH_INTERVAL_MS_MAX
  ) {
    return fallback;
  }

  return normalized;
}

export function updateSchedulerMaxConcurrentAccountsSetting(value) {
  const normalized = normalizeSchedulerMaxConcurrentAccounts(value);
  setSystemSettingValue(SCHEDULER_MAX_CONCURRENT_ACCOUNTS_KEY, normalized);
  return normalized;
}

export function updateSchedulerAccountDispatchIntervalMsSetting(value) {
  const normalized = normalizeSchedulerAccountDispatchIntervalMs(value);
  setSystemSettingValue(SCHEDULER_ACCOUNT_DISPATCH_INTERVAL_MS_KEY, normalized);
  return normalized;
}

export function getSchedulerSettings() {
  const accountDispatchIntervalMs = getSchedulerAccountDispatchIntervalMsSetting();
  return {
    maxConcurrentAccounts: getSchedulerMaxConcurrentAccountsSetting(),
    accountDispatchIntervalMs,
    accountDispatchIntervalSeconds: Math.round(accountDispatchIntervalMs / 1000),
    limits: {
      min: SCHEDULER_MAX_CONCURRENT_ACCOUNTS_MIN,
      max: SCHEDULER_MAX_CONCURRENT_ACCOUNTS_MAX,
      accountDispatchIntervalSecondsMin: SCHEDULER_ACCOUNT_DISPATCH_INTERVAL_MS_MIN / 1000,
      accountDispatchIntervalSecondsMax: SCHEDULER_ACCOUNT_DISPATCH_INTERVAL_MS_MAX / 1000,
    },
  };
}
