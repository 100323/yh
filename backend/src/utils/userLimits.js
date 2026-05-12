export const DEFAULT_MAX_GAME_ACCOUNTS = 2;

export function normalizeMaxGameAccountsForCreate(value) {
  if (value === undefined || value === '') return DEFAULT_MAX_GAME_ACCOUNTS;
  if (value === null) return null;
  const normalized = Number(value);
  if (!Number.isInteger(normalized) || normalized < 1 || normalized > 9999) {
    throw new Error('游戏账号数量上限需为 1-9999 的整数');
  }
  return normalized;
}

export function normalizeMaxGameAccountsForUpdate(value) {
  if (value === null) return null;
  if (value === undefined || value === '') {
    throw new Error('游戏账号数量上限不能为空');
  }
  const normalized = Number(value);
  if (!Number.isInteger(normalized) || normalized < 1 || normalized > 9999) {
    throw new Error('游戏账号数量上限需为 1-9999 的整数');
  }
  return normalized;
}

export default {
  DEFAULT_MAX_GAME_ACCOUNTS,
  normalizeMaxGameAccountsForCreate,
  normalizeMaxGameAccountsForUpdate,
};
