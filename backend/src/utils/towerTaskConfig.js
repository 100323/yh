export const TOWER_MIN_FLOORS = 0;
export const TOWER_MAX_FLOORS = 10;
export const TOWER_DEFAULT_MAX_FLOORS = 10;

export function normalizeTowerMaxFloors(value, fallback = TOWER_DEFAULT_MAX_FLOORS) {
  const fallbackNumber = Number(fallback);
  const safeFallback = Number.isFinite(fallbackNumber)
    ? Math.trunc(fallbackNumber)
    : TOWER_DEFAULT_MAX_FLOORS;
  const rawValue = value ?? safeFallback;
  const numericValue = Number(rawValue);

  if (!Number.isFinite(numericValue)) {
    return Math.max(TOWER_MIN_FLOORS, Math.min(TOWER_MAX_FLOORS, safeFallback));
  }

  return Math.max(TOWER_MIN_FLOORS, Math.min(TOWER_MAX_FLOORS, Math.trunc(numericValue)));
}

export function normalizeTowerTaskConfig(taskType, config = {}) {
  const next = { ...(config || {}) };

  if (taskType === 'TOWER') {
    next.maxFloors = normalizeTowerMaxFloors(next.maxFloors, TOWER_DEFAULT_MAX_FLOORS);
  }

  if (taskType === 'WEIRD_TOWER') {
    next.weirdTowerMaxFloors = normalizeTowerMaxFloors(
      next.weirdTowerMaxFloors ?? next.maxFloors,
      TOWER_DEFAULT_MAX_FLOORS,
    );
  }

  return next;
}

export function getTowerTaskMaxFloors(taskType, config = {}) {
  if (taskType === 'TOWER') {
    return normalizeTowerMaxFloors(config?.maxFloors, TOWER_DEFAULT_MAX_FLOORS);
  }

  if (taskType === 'WEIRD_TOWER') {
    return normalizeTowerMaxFloors(
      config?.weirdTowerMaxFloors ?? config?.maxFloors,
      TOWER_DEFAULT_MAX_FLOORS,
    );
  }

  return null;
}

export function isTowerTaskDisabled(taskType, config = {}) {
  return getTowerTaskMaxFloors(taskType, config) === TOWER_MIN_FLOORS;
}
