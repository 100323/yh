import { performance } from 'node:perf_hooks';

import config from '../config/index.js';
import {
  SchedulerObservationAggregator,
  classifyCommandFailure,
  sanitizeObservationMessage,
} from './schedulerObservationCore.js';
import { flushSchedulerObservationSnapshot } from './schedulerObservationRepository.js';

const SETTLED_OUTCOMES = new Set([
  'success',
  'ignored',
  'error',
  'timeout',
  'disconnected',
  'rate_limited',
]);
const ANOMALY_OUTCOMES = new Set(['error', 'timeout', 'disconnected', 'rate_limited']);
const MAX_OBSERVATION_NUMBER = Number.MAX_SAFE_INTEGER;

function createIdleState() {
  return {
    enabled: false,
    started: false,
    stopping: false,
    timer: null,
    clearIntervalFn: clearInterval,
    aggregator: null,
    flushSnapshot: flushSchedulerObservationSnapshot,
    now: Date.now,
    monotonicNow: () => performance.now(),
    flushPromise: null,
    stopPromise: null,
    retrySnapshot: null,
    flushErrors: 0,
    mergeErrors: 0,
    droppedRetrySnapshots: 0,
    observationErrors: 0,
    healthErrors: 0,
    lastFlushAt: null,
    lastFlushDurationMs: null,
    slowCommandMs: 5_000,
    maxPendingQueueWaits: 20_000,
    pendingQueueWaits: new Map(),
    queueWaitAliases: new Map(),
    queueWaitSequence: 0,
    droppedQueueWaits: 0,
  };
}

let serviceState = createIdleState();

function safeRead(input, property) {
  try {
    return input?.[property];
  } catch {
    return undefined;
  }
}

function safeFunction(value, fallback) {
  return typeof value === 'function' ? value : fallback;
}

function normalizeNonNegativeNumber(value) {
  const numericValue = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numericValue) || numericValue < 0) return undefined;
  return Math.min(MAX_OBSERVATION_NUMBER, numericValue);
}

function normalizeFiniteInteger(value) {
  if (value === null || value === undefined || value === '') return undefined;
  if (!['number', 'string', 'bigint'].includes(typeof value)) return undefined;
  try {
    const numericValue = Number(value);
    if (!Number.isFinite(numericValue)) return undefined;
    return Math.max(
      -MAX_OBSERVATION_NUMBER,
      Math.min(MAX_OBSERVATION_NUMBER, Math.trunc(numericValue)),
    );
  } catch {
    return undefined;
  }
}

function normalizePositiveInteger(value, fallback) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue) || numericValue <= 0) return fallback;
  return Math.min(MAX_OBSERVATION_NUMBER, Math.max(1, Math.floor(numericValue)));
}

function normalizeTimestamp(value) {
  try {
    const timestamp = Number(value);
    if (Number.isFinite(timestamp) && !Number.isNaN(new Date(timestamp).getTime())) {
      return new Date(timestamp).toISOString();
    }
  } catch {
    // Fall through to a safe clock.
  }
  return new Date().toISOString();
}

function readClock(clock, fallback) {
  try {
    const value = Number(clock());
    return Number.isFinite(value) ? value : fallback();
  } catch {
    return fallback();
  }
}

function elapsedMilliseconds(state, startedAt) {
  const endedAt = readClock(state.monotonicNow, () => performance.now());
  const elapsed = endedAt - startedAt;
  return Number.isFinite(elapsed) && elapsed >= 0 ? elapsed : 0;
}

function isSnapshotEmpty(snapshot) {
  try {
    return snapshot.commandMetrics.length === 0
      && snapshot.taskMetrics.length === 0
      && snapshot.anomalies.length === 0;
  } catch {
    return false;
  }
}

function incrementHealthCounter(state, name) {
  const current = Number(state[name]);
  state[name] = Math.min(
    MAX_OBSERVATION_NUMBER,
    (Number.isFinite(current) && current >= 0 ? current : 0) + 1,
  );
}

function safelyMergeSnapshot(state, snapshot) {
  try {
    const merged = state.aggregator?.mergeSnapshot(snapshot) === true;
    if (!merged) incrementHealthCounter(state, 'mergeErrors');
    return merged;
  } catch {
    incrementHealthCounter(state, 'mergeErrors');
    return false;
  }
}

function retainRetrySnapshot(state, snapshot) {
  if (state.retrySnapshot === null) {
    state.retrySnapshot = snapshot;
    return true;
  }
  if (state.retrySnapshot !== snapshot) {
    incrementHealthCounter(state, 'droppedRetrySnapshots');
  }
  return false;
}

async function persistSnapshot(state, pendingSnapshot, { retry = false } = {}) {
  const startedAt = readClock(state.monotonicNow, () => performance.now());
  try {
    await state.flushSnapshot(pendingSnapshot);
    if (retry && state.retrySnapshot === pendingSnapshot) state.retrySnapshot = null;
    state.lastFlushAt = normalizeTimestamp(readClock(state.now, Date.now));
    state.lastFlushDurationMs = elapsedMilliseconds(state, startedAt);
    return true;
  } catch {
    incrementHealthCounter(state, 'flushErrors');
    if (!retry && !safelyMergeSnapshot(state, pendingSnapshot)) {
      retainRetrySnapshot(state, pendingSnapshot);
    }
    return false;
  }
}

async function flushRetrySnapshot(state) {
  const pendingSnapshot = state.retrySnapshot;
  if (pendingSnapshot === null) return false;
  return persistSnapshot(state, pendingSnapshot, { retry: true });
}

async function flushAggregatorSnapshot(state) {
  let pendingSnapshot;

  try {
    pendingSnapshot = state.aggregator?.takeSnapshot();
  } catch {
    incrementHealthCounter(state, 'flushErrors');
    return false;
  }

  if (!pendingSnapshot || isSnapshotEmpty(pendingSnapshot)) return false;
  return persistSnapshot(state, pendingSnapshot);
}

async function flushOnce(state) {
  if (state.retrySnapshot !== null) return flushRetrySnapshot(state);
  return flushAggregatorSnapshot(state);
}

async function flushForStop(state) {
  if (state.retrySnapshot !== null) await flushRetrySnapshot(state);
  return flushAggregatorSnapshot(state);
}

function beginFlush(state, { allowStopping = false, final = false } = {}) {
  if ((!state.enabled && !final) || (!allowStopping && (!state.started || state.stopping))) {
    return Promise.resolve(false);
  }
  if (state.flushPromise) return state.flushPromise;

  const flushPromise = Promise.resolve()
    .then(() => (final ? flushForStop(state) : flushOnce(state)))
    .catch(() => {
      incrementHealthCounter(state, 'flushErrors');
      return false;
    })
    .finally(() => {
      if (state.flushPromise === flushPromise) state.flushPromise = null;
    });
  state.flushPromise = flushPromise;
  return flushPromise;
}

function safeIdentifier(value) {
  if (value === null || value === undefined || value === '') return undefined;
  if (typeof value === 'object' || typeof value === 'function' || typeof value === 'symbol') {
    return undefined;
  }
  try {
    return sanitizeObservationMessage(value, 160) || undefined;
  } catch {
    return undefined;
  }
}

function buildMetricDimensions(event, { includeCommandClass = false } = {}) {
  const dimensions = {};
  const names = [
    'source',
    'taskType',
    'executionLane',
    'egressType',
    'egressKey',
  ];
  if (includeCommandClass) names.push('commandClass');

  for (const name of names) {
    const value = safeIdentifier(safeRead(event, name));
    if (value !== undefined) dimensions[name] = value;
  }
  return dimensions;
}

function buildAnomalyDimensions(event, command, latencyMs) {
  const dimensions = {};
  const identifierNames = [
    'runId',
    'source',
    'taskType',
    'executionLane',
    'egressType',
    'egressKey',
  ];

  for (const name of identifierNames) {
    const value = safeIdentifier(safeRead(event, name));
    if (value !== undefined) dimensions[name] = value;
  }
  for (const name of ['accountId', 'batchTaskId']) {
    const value = normalizeFiniteInteger(safeRead(event, name));
    if (value !== undefined) dimensions[name] = value;
  }
  const error = safeRead(event, 'error');
  const errorCodeCandidates = [
    safeRead(event, 'errorCode'),
    safeRead(event, 'code'),
    safeRead(error, 'errorCode'),
    safeRead(error, 'code'),
  ];
  for (const candidate of errorCodeCandidates) {
    const errorCode = normalizeFiniteInteger(candidate);
    if (errorCode !== undefined) {
      dimensions.errorCode = errorCode;
      break;
    }
  }
  const queueWaitMs = normalizeNonNegativeNumber(safeRead(event, 'queueWaitMs'));
  if (queueWaitMs !== undefined) dimensions.queueWaitMs = queueWaitMs;
  if (command !== undefined) dimensions.command = command;
  if (latencyMs !== undefined) dimensions.latencyMs = latencyMs;
  return dimensions;
}

function safelyClassifyOutcome(event) {
  const explicitOutcome = safeRead(event, 'outcome');
  if (SETTLED_OUTCOMES.has(explicitOutcome)) return explicitOutcome;

  const error = safeRead(event, 'error');
  try {
    return classifyCommandFailure({
      errorCode: safeRead(event, 'errorCode') ?? safeRead(error, 'errorCode'),
      code: safeRead(event, 'code') ?? safeRead(error, 'code'),
      message: typeof error === 'string' ? error : safeRead(error, 'message'),
    }, {
      timeout: Boolean(safeRead(event, 'timeout')),
      disconnected: Boolean(safeRead(event, 'disconnected')),
    });
  } catch {
    return 'error';
  }
}

function safelyRecord(state, methodName, payload) {
  try {
    const method = state.aggregator?.[methodName];
    if (typeof method !== 'function') return false;
    return method.call(state.aggregator, payload) !== false;
  } catch {
    incrementHealthCounter(state, 'observationErrors');
    return false;
  }
}

function eventCommand(event) {
  return safeIdentifier(safeRead(event, 'command') ?? safeRead(event, 'cmd'));
}

function buildCommandObservation(event, outcome) {
  const command = eventCommand(event);
  const observation = {
    command,
    outcome,
    dimensions: buildMetricDimensions(event, { includeCommandClass: true }),
  };
  const timestamp = safeRead(event, 'timestamp');
  const latencyMs = normalizeNonNegativeNumber(safeRead(event, 'latencyMs'));
  if (timestamp !== undefined) observation.timestamp = timestamp;
  if (latencyMs !== undefined) observation.latencyMs = latencyMs;
  return observation;
}

function buildFailureSummary(event, outcome, latencyMs) {
  if (!ANOMALY_OUTCOMES.has(outcome)) {
    return sanitizeObservationMessage(`slow command (${latencyMs}ms)`, 300);
  }

  const error = safeRead(event, 'error');
  const message = typeof error === 'string'
    ? error
    : safeRead(error, 'message');
  return sanitizeObservationMessage(message || `command ${outcome}`, 300);
}

function queueAssociationKeys(event) {
  const accountId = safeIdentifier(safeRead(event, 'accountId'));
  const runId = safeIdentifier(safeRead(event, 'runId'));
  const keys = [];
  if (accountId !== undefined && runId !== undefined) keys.push(`account:${accountId}|run:${runId}`);
  if (runId !== undefined) keys.push(`run:${runId}`);
  if (accountId !== undefined) keys.push(`account:${accountId}`);
  return keys;
}

function removePendingQueueWait(state, entryId) {
  const entry = state.pendingQueueWaits.get(entryId);
  if (!entry) return null;
  state.pendingQueueWaits.delete(entryId);
  for (const key of entry.keys) {
    if (state.queueWaitAliases.get(key) === entryId) state.queueWaitAliases.delete(key);
  }
  return entry;
}

function findPendingQueueWait(state, keys) {
  for (const key of keys) {
    const entryId = state.queueWaitAliases.get(key);
    if (entryId !== undefined) return removePendingQueueWait(state, entryId);
  }
  return null;
}

function storePendingQueueWait(state, keys, queueWaitMs) {
  const existingEntryIds = new Set(
    keys.map((key) => state.queueWaitAliases.get(key)).filter((value) => value !== undefined),
  );
  for (const entryId of existingEntryIds) removePendingQueueWait(state, entryId);

  while (state.pendingQueueWaits.size >= state.maxPendingQueueWaits) {
    const oldestEntryId = state.pendingQueueWaits.keys().next().value;
    if (oldestEntryId === undefined) break;
    removePendingQueueWait(state, oldestEntryId);
    incrementHealthCounter(state, 'droppedQueueWaits');
  }

  state.queueWaitSequence += 1;
  const entryId = state.queueWaitSequence;
  state.pendingQueueWaits.set(entryId, { keys, queueWaitMs });
  for (const key of keys) state.queueWaitAliases.set(key, entryId);
}

function baseHealth(state) {
  return {
    enabled: state.enabled,
    started: state.started,
    stopping: state.stopping,
    flushing: Boolean(state.flushPromise),
    flushErrors: state.flushErrors,
    mergeErrors: state.mergeErrors,
    pendingRetrySnapshots: state.retrySnapshot === null ? 0 : 1,
    droppedRetrySnapshots: state.droppedRetrySnapshots,
    observationErrors: state.observationErrors,
    healthErrors: state.healthErrors,
    lastFlushAt: state.lastFlushAt,
    lastFlushDurationMs: state.lastFlushDurationMs,
    pendingQueueWaits: state.pendingQueueWaits.size,
    droppedQueueWaits: state.droppedQueueWaits,
    metricKeys: 0,
    anomalyCount: 0,
    droppedMetrics: 0,
    droppedAnomalies: 0,
  };
}

export function startSchedulerObservationService(options = {}) {
  try {
    if (serviceState.stopping) return false;
    if (serviceState.started) return true;

    const observationConfig = options?.config ?? config.observability;
    if (observationConfig?.enabled !== true) {
      serviceState = createIdleState();
      return false;
    }

    const now = safeFunction(options?.now, Date.now);
    const monotonicNow = safeFunction(options?.monotonicNow, () => performance.now());
    const maxMetricKeys = normalizePositiveInteger(observationConfig.maxMetricKeys, 20_000);
    const maxAnomalies = normalizePositiveInteger(observationConfig.maxAnomalyBuffer, 5_000);
    const aggregator = options?.aggregator ?? new SchedulerObservationAggregator({
      now,
      maxMetricKeys,
      maxAnomalies,
    });
    const setIntervalFn = safeFunction(options?.setIntervalFn, setInterval);
    const clearIntervalFn = safeFunction(options?.clearIntervalFn, clearInterval);
    const nextState = {
      ...createIdleState(),
      enabled: true,
      started: true,
      aggregator,
      flushSnapshot: safeFunction(options?.flushSnapshot, flushSchedulerObservationSnapshot),
      clearIntervalFn,
      now,
      monotonicNow,
      slowCommandMs: normalizePositiveInteger(observationConfig.slowCommandMs, 5_000),
      maxPendingQueueWaits: maxMetricKeys,
    };
    serviceState = nextState;
    const flushIntervalMs = normalizePositiveInteger(observationConfig.flushIntervalMs, 10_000);
    nextState.timer = setIntervalFn(() => {
      void beginFlush(nextState);
    }, flushIntervalMs);
    nextState.timer?.unref?.();
    return true;
  } catch {
    serviceState = createIdleState();
    return false;
  }
}

export async function stopSchedulerObservationService(options = {}) {
  try {
    const requestedFlush = safeRead(options, 'flush');
    const flush = requestedFlush === undefined ? true : Boolean(requestedFlush);
    const state = serviceState;
    if (state.stopPromise) return await state.stopPromise;
    if (!state.enabled && !state.started) return false;

    state.stopping = true;
    state.started = false;
    if (state.timer !== null) {
      try {
        state.clearIntervalFn(state.timer);
      } catch {
        incrementHealthCounter(state, 'observationErrors');
      }
      state.timer = null;
    }

    state.stopPromise = (async () => {
      try {
        if (state.flushPromise) await state.flushPromise;
        state.enabled = false;
        if (flush) await beginFlush(state, { allowStopping: true, final: true });
        return true;
      } catch {
        return false;
      } finally {
        state.enabled = false;
        state.started = false;
        state.pendingQueueWaits.clear();
        state.queueWaitAliases.clear();
        state.queueWaitSequence = 0;
        state.stopping = false;
      }
    })();
    return await state.stopPromise;
  } catch {
    return false;
  }
}

export function observeCommandSent(event) {
  const state = serviceState;
  if (!state.enabled) return false;
  try {
    return safelyRecord(state, 'recordCommand', buildCommandObservation(event, 'sent'));
  } catch {
    incrementHealthCounter(state, 'observationErrors');
    return false;
  }
}

export function observeCommandSettled(event) {
  const state = serviceState;
  if (!state.enabled) return false;
  try {
    const outcome = safelyClassifyOutcome(event);
    const observation = buildCommandObservation(event, outcome);
    const recorded = safelyRecord(state, 'recordCommand', observation);
    const latencyMs = observation.latencyMs;
    if (ANOMALY_OUTCOMES.has(outcome) || (latencyMs !== undefined && latencyMs >= state.slowCommandMs)) {
      const anomalyType = ANOMALY_OUTCOMES.has(outcome) ? `command_${outcome}` : 'slow_command';
      safelyRecord(state, 'recordAnomaly', {
        type: anomalyType,
        message: buildFailureSummary(event, outcome, latencyMs),
        dimensions: buildAnomalyDimensions(event, observation.command, latencyMs),
      });
    }
    return recorded;
  } catch {
    incrementHealthCounter(state, 'observationErrors');
    return false;
  }
}

export function observeTaskSettled(event) {
  const state = serviceState;
  if (!state.enabled) return false;
  try {
    const association = findPendingQueueWait(state, queueAssociationKeys(event));
    const explicitQueueWaitMs = normalizeNonNegativeNumber(safeRead(event, 'queueWaitMs'));
    const task = safeIdentifier(safeRead(event, 'task') ?? safeRead(event, 'taskType'));
    const observation = {
      task,
      outcome: safelyClassifyOutcome(event),
      dimensions: buildMetricDimensions(event),
    };
    const timestamp = safeRead(event, 'timestamp');
    const durationMs = normalizeNonNegativeNumber(safeRead(event, 'durationMs'));
    const attributedCommandCount = normalizeNonNegativeNumber(
      safeRead(event, 'attributedCommandCount') ?? safeRead(event, 'commandCount'),
    );
    const queueWaitMs = explicitQueueWaitMs ?? association?.queueWaitMs;
    if (timestamp !== undefined) observation.timestamp = timestamp;
    if (durationMs !== undefined) observation.durationMs = durationMs;
    if (queueWaitMs !== undefined) observation.queueWaitMs = queueWaitMs;
    if (attributedCommandCount !== undefined) observation.attributedCommandCount = attributedCommandCount;
    return safelyRecord(state, 'recordTask', observation);
  } catch {
    incrementHealthCounter(state, 'observationErrors');
    return false;
  }
}

export function observeAccountQueue(event) {
  const state = serviceState;
  if (!state.enabled) return false;
  try {
    const keys = queueAssociationKeys(event);
    if (keys.length === 0) return false;
    const queueWaitMs = normalizeNonNegativeNumber(safeRead(event, 'queueWaitMs'));
    if (queueWaitMs === undefined) return false;
    storePendingQueueWait(state, keys, queueWaitMs);
    return true;
  } catch {
    incrementHealthCounter(state, 'observationErrors');
    return false;
  }
}

export function getSchedulerObservationHealth() {
  const state = serviceState;
  const health = baseHealth(state);
  if (!state.enabled || !state.aggregator) return health;

  try {
    const aggregatorHealth = state.aggregator.getHealth();
    for (const name of ['metricKeys', 'anomalyCount', 'droppedMetrics', 'droppedAnomalies']) {
      const value = normalizeNonNegativeNumber(aggregatorHealth?.[name]);
      if (value !== undefined) health[name] = value;
    }
  } catch {
    incrementHealthCounter(state, 'healthErrors');
    health.healthErrors = state.healthErrors;
  }
  return health;
}
