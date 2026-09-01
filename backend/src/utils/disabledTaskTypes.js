const DISABLED_TASK_TYPES = new Set(['CAR_SEND', 'CAR_CLAIM']);

export function isDisabledTaskType(taskType) {
  return DISABLED_TASK_TYPES.has(String(taskType || '').trim());
}

export function filterDisabledTaskTypes(taskTypes = []) {
  if (!Array.isArray(taskTypes)) {
    return [];
  }
  return taskTypes.filter((taskType) => !isDisabledTaskType(taskType));
}

export function containsDisabledTaskType(taskTypes = []) {
  if (!Array.isArray(taskTypes)) {
    return false;
  }
  return taskTypes.some((taskType) => isDisabledTaskType(taskType));
}
