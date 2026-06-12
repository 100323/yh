export const TOWER_MIN_FLOORS = 0;
export const TOWER_MAX_FLOORS = 10;
export const TOWER_DEFAULT_MAX_FLOORS = 10;

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
