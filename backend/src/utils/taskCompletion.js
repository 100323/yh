function toPositiveInteger(value, fallback = 0) {
  const normalized = Math.floor(Number(value) || 0);
  return normalized > 0 ? normalized : fallback;
}

function getResultErrors(results = []) {
  return results
    .filter((item) => item && item.ok === false)
    .map((item) => String(item.error || item.message || ''));
}

function isBuyGoldExhaustedError(message) {
  const normalized = String(message || '');
  return (
    normalized.includes('次数') ||
    normalized.includes('上限') ||
    normalized.includes('不足') ||
    normalized.includes('用完')
  );
}

function isGenieTicketExhausted(ticketResults = []) {
  return ticketResults.some((item) => {
    if (!item?.skipped) return false;
    const reason = String(item.reason || item.error || '');
    return reason.includes('扫荡券') || reason.includes('次数') || reason.includes('领完');
  });
}

function normalizeStoredCompletion(completion) {
  if (!completion || typeof completion !== 'object' || typeof completion.complete !== 'boolean') {
    return null;
  }

  return {
    ...completion,
    status: completion.status || (completion.complete ? 'complete' : 'partial'),
    retryable: completion.retryable === true,
    reason: completion.reason || (completion.complete ? 'completed' : 'partial'),
  };
}

function isCompletionAwareTaskType(taskType) {
  return taskType === 'BUY_GOLD' || taskType === 'GENIE_SWEEP';
}

function compactText(value, maxLength = 64) {
  if (value === null || value === undefined || value === '') {
    return undefined;
  }

  const text = String(value);
  return text.length <= maxLength ? text : `${text.slice(0, Math.max(0, maxLength - 3))}...`;
}

function compactBuyGoldResults(results = []) {
  return results.map((item) => {
    const compact = { ok: item?.ok === true };
    const error = compactText(item?.error || item?.message);
    if (error) {
      compact.error = error;
    }
    return compact;
  });
}

function compactGenieSweepResults(results = []) {
  return results.map((item) => {
    const compact = {};
    if (item?.genieId !== undefined) compact.genieId = Number(item.genieId);
    const name = compactText(item?.name, 32);
    if (name) compact.name = name;
    if (item?.success !== undefined) compact.success = item.success === true;
    if (item?.skipped !== undefined) compact.skipped = item.skipped === true;
    const reason = compactText(item?.reason, 64);
    if (reason) compact.reason = reason;
    const error = compactText(item?.error, 64);
    if (error) compact.error = error;
    if (item?.code !== undefined && item?.code !== null) compact.code = item.code;
    return compact;
  });
}

function compactGenieTicketResults(results = []) {
  return results.map((item) => {
    const compact = {};
    if (item?.index !== undefined) compact.index = Number(item.index);
    if (item?.success !== undefined) compact.success = item.success === true;
    if (item?.skipped !== undefined) compact.skipped = item.skipped === true;
    const reason = compactText(item?.reason, 64);
    if (reason) compact.reason = reason;
    const error = compactText(item?.error, 64);
    if (error) compact.error = error;
    if (item?.code !== undefined && item?.code !== null) compact.code = item.code;
    return compact;
  });
}

function fitsTaskLogDetails(details) {
  return JSON.stringify(details).length <= 900;
}

export function parseTaskDetails(details) {
  if (!details) return null;
  if (typeof details === 'object') return details;
  if (typeof details !== 'string') return null;

  try {
    const parsed = JSON.parse(details);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

function getBuyGoldCompletion(data = {}) {
  const results = Array.isArray(data.results) ? data.results : [];
  const buyNum = toPositiveInteger(data.buyNum ?? data.buyGoldTimes, 3);
  const successCount = Math.max(
    0,
    Number.isFinite(Number(data.successCount))
      ? Number(data.successCount)
      : results.filter((item) => item?.ok).length,
  );
  const remainingCount = Math.max(0, buyNum - successCount);
  const exhausted = getResultErrors(results).some(isBuyGoldExhaustedError);

  if (remainingCount === 0) {
    return {
      complete: true,
      status: 'complete',
      retryable: false,
      reason: 'completed',
      buyNum,
      successCount,
      remainingCount,
    };
  }

  if (exhausted) {
    return {
      complete: true,
      status: 'complete',
      retryable: false,
      reason: 'exhausted',
      buyNum,
      successCount,
      remainingCount,
    };
  }

  return {
    complete: false,
    status: successCount > 0 ? 'partial' : 'failed',
    retryable: true,
    reason: successCount > 0 ? 'partial' : 'retryable_failure',
    buyNum,
    successCount,
    remainingCount,
  };
}

function getGenieSweepCompletion(data = {}) {
  const sweepResults = Array.isArray(data.sweepResults) ? data.sweepResults : [];
  const ticketResults = Array.isArray(data.ticketResults) ? data.ticketResults : [];
  const resultByGenieId = new Map(
    sweepResults
      .filter((item) => Number.isInteger(Number(item?.genieId)))
      .map((item) => [Number(item.genieId), item]),
  );
  const missingGenieIds = [];
  const failedGenieIds = [];

  for (let genieId = 1; genieId <= 4; genieId += 1) {
    const result = resultByGenieId.get(genieId);
    if (!result) {
      missingGenieIds.push(genieId);
    } else if (!result.success && !result.skipped) {
      failedGenieIds.push(genieId);
    }
  }

  const claimedTickets = Number.isFinite(Number(data.claimedTickets))
    ? Number(data.claimedTickets)
    : ticketResults.filter((item) => item?.success).length;
  const ticketsComplete = claimedTickets >= 3 || isGenieTicketExhausted(ticketResults);
  const ticketsFailed = ticketResults.some((item) => item && item.success === false && !item.skipped);
  const complete = missingGenieIds.length === 0 && failedGenieIds.length === 0 && ticketsComplete;
  const exhausted = complete && isGenieTicketExhausted(ticketResults);

  return {
    complete,
    status: complete ? 'complete' : (sweepResults.length > 0 || ticketResults.length > 0 ? 'partial' : 'failed'),
    retryable: !complete,
    reason: complete ? (exhausted ? 'exhausted' : 'completed') : 'partial',
    missingGenieIds,
    failedGenieIds,
    ticketsComplete,
    ticketsFailed,
    claimedTickets,
  };
}

export function getTaskCompletionState(taskType, details) {
  const data = parseTaskDetails(details) || {};
  const storedCompletion = normalizeStoredCompletion(data.completion);
  if (storedCompletion) {
    return storedCompletion;
  }

  switch (String(taskType || '').trim()) {
    case 'BUY_GOLD':
      return getBuyGoldCompletion(data);
    case 'GENIE_SWEEP':
      return getGenieSweepCompletion(data);
    default:
      return {
        complete: true,
        status: 'complete',
        retryable: false,
        reason: 'not_applicable',
      };
  }
}

export function shouldRetryTaskCompletion(taskType, status, completion) {
  const normalizedTaskType = String(taskType || '').trim();
  const storedCompletion = normalizeStoredCompletion(completion);
  if (storedCompletion) {
    if (storedCompletion.complete) {
      return false;
    }

    return storedCompletion.retryable === true || String(status || '').toLowerCase() === 'error';
  }

  if (!isCompletionAwareTaskType(normalizedTaskType)) {
    return String(status || '').toLowerCase() === 'error';
  }

  const normalized = getTaskCompletionState(normalizedTaskType, completion);
  if (normalized.complete) {
    return false;
  }

  return normalized.retryable === true || String(status || '').toLowerCase() === 'error';
}

export function createTaskCompletionLogDetails(taskType, data) {
  const normalizedTaskType = String(taskType || '').trim();
  const details = parseTaskDetails(data) || {};

  if (normalizedTaskType === 'BUY_GOLD') {
    const completion = getTaskCompletionState(normalizedTaskType, details);
    const compact = {
      buyNum: completion.buyNum,
      successCount: completion.successCount,
      remainingCount: completion.remainingCount,
      results: compactBuyGoldResults(Array.isArray(details.results) ? details.results : []),
      completion,
    };
    return fitsTaskLogDetails(compact)
      ? compact
      : {
        buyNum: completion.buyNum,
        successCount: completion.successCount,
        remainingCount: completion.remainingCount,
        completion,
      };
  }

  if (normalizedTaskType === 'GENIE_SWEEP') {
    const completion = getTaskCompletionState(normalizedTaskType, details);
    const compact = {
      sweptCount: Number(details.sweptCount || 0),
      claimedTickets: completion.claimedTickets,
      sweepResults: compactGenieSweepResults(Array.isArray(details.sweepResults) ? details.sweepResults : []),
      ticketResults: compactGenieTicketResults(Array.isArray(details.ticketResults) ? details.ticketResults : []),
      completion,
    };
    return fitsTaskLogDetails(compact)
      ? compact
      : {
        sweptCount: Number(details.sweptCount || 0),
        claimedTickets: completion.claimedTickets,
        completion,
      };
  }

  return details;
}
