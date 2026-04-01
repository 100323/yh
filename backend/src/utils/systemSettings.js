import config from '../config/index.js';
import { get, run } from '../database/index.js';

export const SCHEDULER_MAX_CONCURRENT_ACCOUNTS_KEY = 'scheduler_max_concurrent_accounts';
export const SCHEDULER_MAX_CONCURRENT_ACCOUNTS_MIN = 1;
export const SCHEDULER_MAX_CONCURRENT_ACCOUNTS_MAX = 20;

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

export function updateSchedulerMaxConcurrentAccountsSetting(value) {
  const normalized = normalizeSchedulerMaxConcurrentAccounts(value);
  setSystemSettingValue(SCHEDULER_MAX_CONCURRENT_ACCOUNTS_KEY, normalized);
  return normalized;
}

export function getSchedulerSettings() {
  return {
    maxConcurrentAccounts: getSchedulerMaxConcurrentAccountsSetting(),
    limits: {
      min: SCHEDULER_MAX_CONCURRENT_ACCOUNTS_MIN,
      max: SCHEDULER_MAX_CONCURRENT_ACCOUNTS_MAX,
    },
  };
}
