import config from '../config/index.js';
import {
  getSchedulerAccountDispatchIntervalMsSetting,
  getSchedulerMaxConcurrentAccountsSetting,
  getSchedulerProxyAccountDispatchIntervalMsSetting,
  getSchedulerProxyMaxConcurrentAccountsSetting,
} from './systemSettings.js';

const accountTaskChains = new Map();
const accountClients = new Map();
const EXECUTION_LANES = {
  DIRECT: 'direct',
  PROXY: 'proxy',
};

const laneStates = {
  [EXECUTION_LANES.DIRECT]: {
    queuedAccounts: [],
    activeAccountExecutions: 0,
    queuedDispatchTimer: null,
    queuedDispatchScheduledAt: null,
  },
  [EXECUTION_LANES.PROXY]: {
    queuedAccounts: [],
    activeAccountExecutions: 0,
    queuedDispatchTimer: null,
    queuedDispatchScheduledAt: null,
  },
};
const taskTypeChains = new Map();
const taskTypeNextAllowedAt = new Map();

function normalizeAccountId(accountId) {
  return String(accountId);
}

function getMaxConcurrentAccounts() {
  try {
    return getSchedulerMaxConcurrentAccountsSetting();
  } catch {
    const value = Number(config?.scheduler?.maxConcurrentAccounts || 0);
    return Number.isFinite(value) && value > 0 ? Math.floor(value) : 3;
  }
}

function normalizeExecutionLane(lane) {
  return lane === EXECUTION_LANES.PROXY ? EXECUTION_LANES.PROXY : EXECUTION_LANES.DIRECT;
}

function getLaneState(lane) {
  return laneStates[normalizeExecutionLane(lane)];
}

function getMaxConcurrentAccountsForLane(lane) {
  if (normalizeExecutionLane(lane) === EXECUTION_LANES.PROXY) {
    try {
      return getSchedulerProxyMaxConcurrentAccountsSetting();
    } catch {
      const value = Number(config?.scheduler?.proxyMaxConcurrentAccounts || 0);
      return Number.isFinite(value) && value > 0 ? Math.floor(value) : 2;
    }
  }

  return getMaxConcurrentAccounts();
}

function getTaskTypeThrottleMs(taskType) {
  const value = Number(config?.scheduler?.sensitiveTaskThrottleMs?.[String(taskType || '')] || 0);
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function getAccountDispatchIntervalMs() {
  try {
    return getSchedulerAccountDispatchIntervalMsSetting();
  } catch {
    const value = Number(config?.scheduler?.accountDispatchIntervalMs || 0);
    return Number.isFinite(value) && value >= 0 ? Math.floor(value) : 8000;
  }
}

function getAccountDispatchIntervalMsForLane(lane) {
  if (normalizeExecutionLane(lane) === EXECUTION_LANES.PROXY) {
    try {
      return getSchedulerProxyAccountDispatchIntervalMsSetting();
    } catch {
      const value = Number(config?.scheduler?.proxyAccountDispatchIntervalMs || 0);
      return Number.isFinite(value) && value >= 0 ? Math.floor(value) : 12000;
    }
  }

  return getAccountDispatchIntervalMs();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(ms) || 0)));
}

function scheduleQueuedAccountDispatch(lane = EXECUTION_LANES.DIRECT, delayMs = getAccountDispatchIntervalMsForLane(lane)) {
  const normalizedLane = normalizeExecutionLane(lane);
  const state = getLaneState(normalizedLane);
  if (state.queuedDispatchTimer || state.queuedAccounts.length === 0) {
    return;
  }
  if (state.activeAccountExecutions >= getMaxConcurrentAccountsForLane(normalizedLane)) {
    return;
  }

  const normalizedDelay = Math.max(0, Number(delayMs) || 0);
  state.queuedDispatchScheduledAt = Date.now() + normalizedDelay;
  state.queuedDispatchTimer = setTimeout(() => {
    state.queuedDispatchTimer = null;
    state.queuedDispatchScheduledAt = null;
    dispatchQueuedAccounts(normalizedLane);
  }, normalizedDelay);
}

function dispatchQueuedAccounts(lane = EXECUTION_LANES.DIRECT) {
  const normalizedLane = normalizeExecutionLane(lane);
  const state = getLaneState(normalizedLane);
  const limit = getMaxConcurrentAccountsForLane(normalizedLane);
  while (state.activeAccountExecutions < limit && state.queuedAccounts.length > 0) {
    const queued = state.queuedAccounts.shift();
    state.activeAccountExecutions += 1;
    queued.resolve();
  }

  if (state.queuedAccounts.length > 0 && state.activeAccountExecutions < limit) {
    scheduleQueuedAccountDispatch(normalizedLane);
  }
}

async function acquireGlobalAccountSlot(accountId, lane = EXECUTION_LANES.DIRECT) {
  const key = normalizeAccountId(accountId);
  const normalizedLane = normalizeExecutionLane(lane);
  const state = getLaneState(normalizedLane);
  const limit = getMaxConcurrentAccountsForLane(normalizedLane);

  if (state.activeAccountExecutions < limit && state.queuedAccounts.length === 0) {
    state.activeAccountExecutions += 1;
    return;
  }

  await new Promise((resolve) => {
    state.queuedAccounts.push({
      accountId: key,
      lane: normalizedLane,
      queuedAt: Date.now(),
      resolve,
    });
    scheduleQueuedAccountDispatch(normalizedLane);
  });
}

function releaseGlobalAccountSlot(lane = EXECUTION_LANES.DIRECT) {
  const normalizedLane = normalizeExecutionLane(lane);
  const state = getLaneState(normalizedLane);
  state.activeAccountExecutions = Math.max(0, state.activeAccountExecutions - 1);
  scheduleQueuedAccountDispatch(normalizedLane);
}

export async function runAccountTaskExclusive(accountId, taskExecutor, options = {}) {
  const key = normalizeAccountId(accountId);
  const lane = normalizeExecutionLane(options?.lane);
  const previous = accountTaskChains.get(key) || Promise.resolve();
  const current = previous
    .catch(() => {})
    .then(async () => {
      await acquireGlobalAccountSlot(key, lane);
      try {
        return await taskExecutor();
      } finally {
        releaseGlobalAccountSlot(lane);
      }
    });

  accountTaskChains.set(key, current);
  try {
    return await current;
  } finally {
    if (accountTaskChains.get(key) === current) {
      accountTaskChains.delete(key);
    }
  }
}

export async function runTaskTypeThrottled(taskType, context = {}, taskExecutor) {
  const normalizedTaskType = String(taskType || '').trim();
  const throttleMs = getTaskTypeThrottleMs(normalizedTaskType);
  if (!normalizedTaskType || throttleMs <= 0) {
    return await taskExecutor();
  }

  const previous = taskTypeChains.get(normalizedTaskType) || Promise.resolve();
  const current = previous
    .catch(() => {})
    .then(async () => {
      const waitMs = Math.max(0, (taskTypeNextAllowedAt.get(normalizedTaskType) || 0) - Date.now());
      if (waitMs > 0) {
        console.log('⏳ 敏感任务节流等待', {
          taskType: normalizedTaskType,
          throttleMs,
          waitMs,
          accountId: context.accountId ?? null,
          accountName: context.accountName || null,
          source: context.source || null,
        });
        await sleep(waitMs);
      }

      taskTypeNextAllowedAt.set(normalizedTaskType, Date.now() + throttleMs);
      return await taskExecutor();
    });

  taskTypeChains.set(normalizedTaskType, current);
  try {
    return await current;
  } finally {
    if (taskTypeChains.get(normalizedTaskType) === current) {
      taskTypeChains.delete(normalizedTaskType);
    }
  }
}

export function isAccountTaskRunning(accountId) {
  return accountTaskChains.has(normalizeAccountId(accountId));
}

export function registerAccountClient(accountId, client) {
  if (!client) return;
  const key = normalizeAccountId(accountId);
  const existingSet = accountClients.get(key) || new Set();

  for (const existingClient of existingSet) {
    if (existingClient === client) continue;
    try {
      existingClient.disconnect?.();
    } catch {
      // ignore
    }
    existingSet.delete(existingClient);
  }

  existingSet.add(client);
  accountClients.set(key, existingSet);
}

export function unregisterAccountClient(accountId, client = null) {
  const key = normalizeAccountId(accountId);
  if (!accountClients.has(key)) {
    return;
  }

  if (!client) {
    accountClients.delete(key);
    return;
  }

  const clientSet = accountClients.get(key);
  clientSet.delete(client);
  if (clientSet.size === 0) {
    accountClients.delete(key);
  }
}

export function getAccountTaskCoordinatorStatus() {
  const directState = laneStates[EXECUTION_LANES.DIRECT];
  const proxyState = laneStates[EXECUTION_LANES.PROXY];
  return {
    maxConcurrentAccounts: getMaxConcurrentAccounts(),
    accountDispatchIntervalMs: getAccountDispatchIntervalMs(),
    proxyMaxConcurrentAccounts: getMaxConcurrentAccountsForLane(EXECUTION_LANES.PROXY),
    proxyAccountDispatchIntervalMs: getAccountDispatchIntervalMsForLane(EXECUTION_LANES.PROXY),
    activeAccountExecutions: directState.activeAccountExecutions + proxyState.activeAccountExecutions,
    queuedAccountExecutions: directState.queuedAccounts.length + proxyState.queuedAccounts.length,
    queuedDispatchScheduledAt: directState.queuedDispatchScheduledAt,
    runningAccountChains: accountTaskChains.size,
    lanes: {
      [EXECUTION_LANES.DIRECT]: {
        maxConcurrentAccounts: getMaxConcurrentAccountsForLane(EXECUTION_LANES.DIRECT),
        accountDispatchIntervalMs: getAccountDispatchIntervalMsForLane(EXECUTION_LANES.DIRECT),
        activeAccountExecutions: directState.activeAccountExecutions,
        queuedAccountExecutions: directState.queuedAccounts.length,
        queuedDispatchScheduledAt: directState.queuedDispatchScheduledAt,
        queuedAccounts: directState.queuedAccounts.map((item) => item.accountId),
      },
      [EXECUTION_LANES.PROXY]: {
        maxConcurrentAccounts: getMaxConcurrentAccountsForLane(EXECUTION_LANES.PROXY),
        accountDispatchIntervalMs: getAccountDispatchIntervalMsForLane(EXECUTION_LANES.PROXY),
        activeAccountExecutions: proxyState.activeAccountExecutions,
        queuedAccountExecutions: proxyState.queuedAccounts.length,
        queuedDispatchScheduledAt: proxyState.queuedDispatchScheduledAt,
        queuedAccounts: proxyState.queuedAccounts.map((item) => item.accountId),
      },
    },
    queuedAccounts: [
      ...directState.queuedAccounts.map((item) => item.accountId),
      ...proxyState.queuedAccounts.map((item) => item.accountId),
    ],
    throttledTaskTypes: Array.from(taskTypeNextAllowedAt.entries()).map(([taskType, nextAllowedAt]) => ({
      taskType,
      nextAllowedAt,
    })),
  };
}

export function clearAccountTaskCoordinator() {
  accountTaskChains.clear();
  accountClients.clear();
  taskTypeChains.clear();
  taskTypeNextAllowedAt.clear();
  for (const state of Object.values(laneStates)) {
    state.queuedAccounts.length = 0;
    state.activeAccountExecutions = 0;
    if (state.queuedDispatchTimer) {
      clearTimeout(state.queuedDispatchTimer);
      state.queuedDispatchTimer = null;
    }
    state.queuedDispatchScheduledAt = null;
  }
}

export { EXECUTION_LANES };
