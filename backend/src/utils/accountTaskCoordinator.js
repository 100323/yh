import { performance } from 'node:perf_hooks';
import config from '../config/index.js';
import { getSchedulerObservationContext } from '../observability/schedulerObservationCore.js';
import * as schedulerObservationService from '../observability/schedulerObservationService.js';
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
const taskTypeConcurrencyStates = new Map();
const taskTypeCommandChains = new Map();
const taskTypeCommandNextAllowedAt = new Map();

function normalizeAccountId(accountId) {
  return String(accountId);
}

function monotonicNow() {
  const value = performance.now();
  if (Number.isFinite(value)) return value;
  return Number(process.hrtime.bigint()) / 1_000_000;
}

function safeObservationIdentifier(context, name) {
  try {
    const value = context?.[name];
    if (
      value === null
      || value === undefined
      || typeof value === 'object'
      || typeof value === 'function'
      || typeof value === 'symbol'
    ) {
      return undefined;
    }
    return value;
  } catch {
    return undefined;
  }
}

function noop() {}

function resolveAccountQueueObserver(options) {
  try {
    let observer;
    try {
      observer = options?.observer;
    } catch {
      return null;
    }
    if (observer === undefined) observer = schedulerObservationService;

    if (
      observer === schedulerObservationService
      && !schedulerObservationService.isSchedulerObservationEnabled()
    ) {
      return null;
    }
    return observer;
  } catch {
    return null;
  }
}

function safelyObserveAccountQueue(observer, event) {
  try {
    const method = observer?.observeAccountQueue;
    if (typeof method !== 'function') return;
    const payload = observer === schedulerObservationService
      ? { accountId: event.accountId, runId: event.runId, queueWaitMs: event.waitMs }
      : event;
    const result = method.call(observer, payload);
    if (result === null || (typeof result !== 'object' && typeof result !== 'function')) return;
    const then = result.then;
    if (typeof then !== 'function') return;
    const chained = then.call(result, undefined, noop);
    if (chained !== result) Promise.resolve(chained).catch(noop);
  } catch {
    // Observation must never affect account execution or slot release.
  }
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

function getTaskTypeMaxConcurrency(taskType) {
  const value = Number(config?.scheduler?.taskTypeMaxConcurrency?.[String(taskType || '')] || 0);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

function getTaskTypeCommandThrottleMs(taskType) {
  const value = Number(config?.scheduler?.taskTypeCommandThrottleMs?.[String(taskType || '')] || 0);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

function getTaskTypeConcurrencyState(taskType) {
  const normalizedTaskType = String(taskType || '').trim();
  if (!taskTypeConcurrencyStates.has(normalizedTaskType)) {
    taskTypeConcurrencyStates.set(normalizedTaskType, {
      activeExecutions: 0,
      queuedExecutions: [],
    });
  }
  return taskTypeConcurrencyStates.get(normalizedTaskType);
}

function dispatchTaskTypeQueue(taskType) {
  const normalizedTaskType = String(taskType || '').trim();
  const state = taskTypeConcurrencyStates.get(normalizedTaskType);
  if (!state) return;

  const limit = getTaskTypeMaxConcurrency(normalizedTaskType);
  if (limit <= 0) {
    while (state.queuedExecutions.length > 0) {
      state.queuedExecutions.shift().resolve();
    }
    taskTypeConcurrencyStates.delete(normalizedTaskType);
    return;
  }

  while (state.activeExecutions < limit && state.queuedExecutions.length > 0) {
    const queued = state.queuedExecutions.shift();
    state.activeExecutions += 1;
    queued.resolve();
  }

  if (state.activeExecutions === 0 && state.queuedExecutions.length === 0) {
    taskTypeConcurrencyStates.delete(normalizedTaskType);
  }
}

async function acquireTaskTypeSlot(taskType, context = {}) {
  const normalizedTaskType = String(taskType || '').trim();
  const limit = getTaskTypeMaxConcurrency(normalizedTaskType);
  if (!normalizedTaskType || limit <= 0) {
    return () => {};
  }

  const state = getTaskTypeConcurrencyState(normalizedTaskType);
  if (state.activeExecutions < limit && state.queuedExecutions.length === 0) {
    state.activeExecutions += 1;
  } else {
    await new Promise((resolve) => {
      state.queuedExecutions.push({
        accountId: context.accountId ?? null,
        accountName: context.accountName || null,
        source: context.source || null,
        queuedAt: Date.now(),
        resolve,
      });
    });
  }

  let released = false;
  return () => {
    if (released) return;
    released = true;
    const latestState = taskTypeConcurrencyStates.get(normalizedTaskType);
    if (!latestState) return;
    latestState.activeExecutions = Math.max(0, latestState.activeExecutions - 1);
    dispatchTaskTypeQueue(normalizedTaskType);
  };
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
      const requestedAt = monotonicNow();
      await acquireGlobalAccountSlot(key, lane);
      const acquiredAt = monotonicNow();
      const queueObserver = resolveAccountQueueObserver(options);
      if (queueObserver !== null) {
        let observationContext = null;
        try {
          observationContext = getSchedulerObservationContext();
        } catch {
          // Observation context is optional.
        }
        const queueObservation = {
          accountId,
          executionLane: lane,
          waitMs: Math.max(0, acquiredAt - requestedAt),
        };
        for (const name of ['source', 'runId', 'taskType']) {
          const value = safeObservationIdentifier(observationContext, name);
          if (value !== undefined) queueObservation[name] = value;
        }
        safelyObserveAccountQueue(queueObserver, queueObservation);
      }
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
  const maxConcurrency = getTaskTypeMaxConcurrency(normalizedTaskType);
  if (!normalizedTaskType || (throttleMs <= 0 && maxConcurrency <= 0)) {
    return await taskExecutor();
  }

  if (throttleMs <= 0) {
    const releaseTaskTypeSlot = await acquireTaskTypeSlot(normalizedTaskType, context);
    try {
      return await taskExecutor();
    } finally {
      releaseTaskTypeSlot();
    }
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

export async function runTaskTypeCommandThrottled(taskType, context = {}, commandExecutor) {
  const normalizedTaskType = String(taskType || '').trim();
  const throttleMs = getTaskTypeCommandThrottleMs(normalizedTaskType);
  if (!normalizedTaskType || throttleMs <= 0) {
    return await commandExecutor();
  }

  const previous = taskTypeCommandChains.get(normalizedTaskType) || Promise.resolve();
  const current = previous
    .catch(() => {})
    .then(async () => {
      const waitMs = Math.max(
        0,
        (taskTypeCommandNextAllowedAt.get(normalizedTaskType) || 0) - Date.now(),
      );
      if (waitMs > 0) {
        console.log('灯神命令全局节流等待', {
          taskType: normalizedTaskType,
          command: context.command || null,
          genieId: context.genieId ?? null,
          waitMs,
          throttleMs,
        });
        await sleep(waitMs);
      }

      taskTypeCommandNextAllowedAt.set(normalizedTaskType, Date.now() + throttleMs);
      return await commandExecutor();
    });

  taskTypeCommandChains.set(normalizedTaskType, current);
  try {
    return await current;
  } finally {
    if (taskTypeCommandChains.get(normalizedTaskType) === current) {
      taskTypeCommandChains.delete(normalizedTaskType);
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
    limitedTaskTypes: Array.from(taskTypeConcurrencyStates.entries()).map(([taskType, state]) => ({
      taskType,
      maxConcurrency: getTaskTypeMaxConcurrency(taskType),
      activeExecutions: state.activeExecutions,
      queuedExecutions: state.queuedExecutions.length,
      queuedAccounts: state.queuedExecutions.map((item) => item.accountId),
    })),
  };
}

export function clearAccountTaskCoordinator() {
  accountTaskChains.clear();
  accountClients.clear();
  taskTypeChains.clear();
  taskTypeNextAllowedAt.clear();
  taskTypeConcurrencyStates.clear();
  taskTypeCommandChains.clear();
  taskTypeCommandNextAllowedAt.clear();
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
