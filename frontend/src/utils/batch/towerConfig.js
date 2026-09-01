export const TOWER_MIN_FLOORS = 0;
export const TOWER_MAX_FLOORS = 10;
export const TOWER_DEFAULT_MAX_FLOORS = 10;
export const TOWER_DAILY_BATTLE_LIMIT = 10;
export const TOWER_BATTLE_USAGE_STORAGE_KEY = "towerBattleDailyUsage";

const getStorage = (storage) => {
  if (storage) return storage;
  if (typeof localStorage !== "undefined") return localStorage;
  return null;
};

const getTowerUsageKey = (accountId, taskType, businessDate) =>
  String(accountId ?? "").trim() + ":" +
  String(taskType ?? "").trim() + ":" +
  String(businessDate ?? "").trim();

export const getShanghaiBusinessDate = (date = new Date()) => {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return values.year + "-" + values.month + "-" + values.day;
};

const readTowerUsage = (storage) => {
  const targetStorage = getStorage(storage);
  if (!targetStorage) return {};
  try {
    const parsed = JSON.parse(targetStorage.getItem(TOWER_BATTLE_USAGE_STORAGE_KEY) || "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
};

const writeTowerUsage = (usage, storage) => {
  const targetStorage = getStorage(storage);
  if (!targetStorage) return false;
  try {
    targetStorage.setItem(TOWER_BATTLE_USAGE_STORAGE_KEY, JSON.stringify(usage));
    return true;
  } catch {
    return false;
  }
};

const resolveUsageOptions = (options = {}) => ({
  storage: options?.storage,
  businessDate: options?.businessDate || getShanghaiBusinessDate(options?.date || new Date()),
});

export const getTowerBattleUsage = (accountId, taskType, options = {}) => {
  const { storage, businessDate } = resolveUsageOptions(options);
  const key = getTowerUsageKey(accountId, taskType, businessDate);
  return Math.max(0, Number(readTowerUsage(storage)[key] || 0));
};

export const reserveTowerBattleSlot = (accountId, taskType, options = {}) => {
  const { storage, businessDate } = resolveUsageOptions(options);
  const usage = readTowerUsage(storage);
  const key = getTowerUsageKey(accountId, taskType, businessDate);
  const current = Math.max(0, Number(usage[key] || 0));
  if (current >= TOWER_DAILY_BATTLE_LIMIT) return false;
  usage[key] = current + 1;
  return writeTowerUsage(usage, storage);
};

export const releaseTowerBattleSlot = (accountId, taskType, options = {}) => {
  const { storage, businessDate } = resolveUsageOptions(options);
  const usage = readTowerUsage(storage);
  const key = getTowerUsageKey(accountId, taskType, businessDate);
  const current = Math.max(0, Number(usage[key] || 0));
  if (current <= 0) return false;
  usage[key] = current - 1;
  return writeTowerUsage(usage, storage);
};

export const getEffectiveTowerBattleLimit = (configuredLimit, remainingLimit) => {
  const configured = normalizeTowerMaxFloors(configuredLimit, TOWER_DEFAULT_MAX_FLOORS);
  const remaining = Number.isFinite(Number(remainingLimit))
    ? Math.max(0, Math.trunc(Number(remainingLimit)))
    : TOWER_DAILY_BATTLE_LIMIT;
  return Math.min(configured, remaining, TOWER_DAILY_BATTLE_LIMIT);
};

export const normalizeTowerMaxFloors = (value, fallback = TOWER_DEFAULT_MAX_FLOORS) => {
  const fallbackNumber = Number(fallback);
  const safeFallback = Number.isFinite(fallbackNumber)
    ? Math.trunc(fallbackNumber)
    : TOWER_DEFAULT_MAX_FLOORS;
  const numericValue = Number(value ?? safeFallback);

  if (!Number.isFinite(numericValue)) {
    return Math.max(TOWER_MIN_FLOORS, Math.min(TOWER_MAX_FLOORS, safeFallback));
  }

  return Math.max(TOWER_MIN_FLOORS, Math.min(TOWER_MAX_FLOORS, Math.trunc(numericValue)));
};

export const normalizeTowerSettings = (settings = {}) => ({
  ...(settings || {}),
  towerMaxFloors: normalizeTowerMaxFloors(settings?.towerMaxFloors, TOWER_DEFAULT_MAX_FLOORS),
  weirdTowerMaxFloors: normalizeTowerMaxFloors(
    settings?.weirdTowerMaxFloors ?? settings?.towerMaxFloors,
    TOWER_DEFAULT_MAX_FLOORS,
  ),
});

export const isTowerTaskDisabled = (taskType, settings = {}) => {
  if (taskType === "TOWER") {
    return normalizeTowerMaxFloors(settings?.towerMaxFloors, TOWER_DEFAULT_MAX_FLOORS) === 0;
  }

  if (taskType === "WEIRD_TOWER") {
    return normalizeTowerMaxFloors(
      settings?.weirdTowerMaxFloors ?? settings?.towerMaxFloors,
      TOWER_DEFAULT_MAX_FLOORS,
    ) === 0;
  }

  return false;
};
