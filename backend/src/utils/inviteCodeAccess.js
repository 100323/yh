const ALLOWED_REGISTERED_USER_ACCESS_DAYS = new Set([1, 30, 180, 365]);
const DAY_MS = 24 * 60 * 60 * 1000;

const DEFAULT_REGISTERED_MAX_GAME_ACCOUNTS = 1;
const MIN_REGISTERED_MAX_GAME_ACCOUNTS = 1;
const MAX_REGISTERED_MAX_GAME_ACCOUNTS = 9999;

export function normalizeRegisteredMaxGameAccounts(
  value,
  defaultValue = DEFAULT_REGISTERED_MAX_GAME_ACCOUNTS
) {
  if (value === undefined || value === '') {
    return defaultValue;
  }

  // 注意：与 registered_user_access_days 不同，这里 null 不代表“不限”。
  // 账号数量必须有具体值，null 一律回落到默认值，避免注册出无限制账号的用户。
  if (value === null) {
    return defaultValue;
  }

  const accounts = Number(value);
  if (
    !Number.isInteger(accounts) ||
    accounts < MIN_REGISTERED_MAX_GAME_ACCOUNTS ||
    accounts > MAX_REGISTERED_MAX_GAME_ACCOUNTS
  ) {
    throw new Error(
      `注册账号数量需为 ${MIN_REGISTERED_MAX_GAME_ACCOUNTS}-${MAX_REGISTERED_MAX_GAME_ACCOUNTS} 的整数`
    );
  }

  return accounts;
}

export function normalizeRegisteredUserAccessDays(value, defaultValue = 30) {
  if (value === undefined || value === '') {
    return defaultValue;
  }

  if (value === null) {
    return null;
  }

  const days = Number(value);
  if (!Number.isInteger(days) || !ALLOWED_REGISTERED_USER_ACCESS_DAYS.has(days)) {
    throw new Error('注册账号有效期只能选择永久、1天、30天、180天、365天');
  }

  return days;
}

export function resolveRegisteredUserAccessEndAt(days, now = new Date()) {
  const normalizedDays = normalizeRegisteredUserAccessDays(days, null);
  if (normalizedDays === null) {
    return null;
  }

  return new Date(now.getTime() + normalizedDays * DAY_MS).toISOString();
}

export default {
  normalizeRegisteredUserAccessDays,
  resolveRegisteredUserAccessEndAt,
  normalizeRegisteredMaxGameAccounts,
};
