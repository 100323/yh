const MAIL_CATEGORIES = [0, 4, 5];
const DEFAULT_DAILY_TASK_IDS = Array.from({ length: 10 }, (_, index) => index + 1);
const NOOP_ERROR_PATTERNS = [
  '没有可领取',
  '已经领取',
  '已领取',
  '今日已领取',
  '已经签到',
  '已签到',
  '任务未达成',
  '无效的ID',
  '不存在',
  '条件不满足',
  '次数已达上限',
  '已完成',
];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeErrorMessage(error) {
  return String(error?.message || error || '未知错误');
}

function isNoopError(error) {
  const message = normalizeErrorMessage(error);
  return NOOP_ERROR_PATTERNS.some((pattern) => message.includes(pattern));
}

function stableClone(value, seen = new WeakSet()) {
  if (Array.isArray(value)) {
    return value.map((item) => stableClone(item, seen));
  }
  if (value && typeof value === 'object') {
    if (seen.has(value)) {
      return '[Circular]';
    }
    seen.add(value);
    const output = {};
    for (const key of Object.keys(value).sort()) {
      output[key] = stableClone(value[key], seen);
    }
    seen.delete(value);
    return output;
  }
  return value;
}

function stableStringify(value) {
  try {
    return JSON.stringify(stableClone(value));
  } catch {
    return '';
  }
}

function createDetailedError(message, details = null) {
  const error = new Error(message);
  if (details && typeof details === 'object') {
    error.details = details;
  }
  return error;
}

function pickArenaTargetId(target) {
  if (!target || typeof target !== 'object') {
    return null;
  }

  return Number(
    target.roleId ??
      target.roleid ??
      target.targetId ??
      target.id ??
      target.uid ??
      0
  ) || null;
}

function isArenaTargetCandidate(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }

  const targetId = pickArenaTargetId(value);
  if (!targetId) {
    return false;
  }

  const keys = Object.keys(value);
  return (
    'targetId' in value ||
    'roleId' in value ||
    'roleid' in value ||
    keys.some((key) =>
      ['name', 'nick', 'nickname', 'rank', 'score', 'power', 'fight', 'server', 'level'].includes(
        key.toLowerCase()
      )
    )
  );
}

function resolveArenaTargets(payload, depth = 0, visited = new WeakSet()) {
  if (!payload || depth > 5) {
    return [];
  }

  if (Array.isArray(payload)) {
    const direct = payload.filter((item) => isArenaTargetCandidate(item));
    if (direct.length > 0) {
      return direct;
    }

    for (const item of payload) {
      const nested = resolveArenaTargets(item, depth + 1, visited);
      if (nested.length > 0) {
        return nested;
      }
    }

    return [];
  }

  if (typeof payload !== 'object') {
    return [];
  }

  if (visited.has(payload)) {
    return [];
  }
  visited.add(payload);

  if (isArenaTargetCandidate(payload)) {
    return [payload];
  }

  const prioritizedKeys = [
    'rankList',
    'roleList',
    'targets',
    'targetList',
    'list',
    'arenaList',
    'enemyList',
    'opponentList',
    'roles',
    'data',
    'body',
    'result',
    'arena',
    'arenaInfo',
  ];

  for (const key of prioritizedKeys) {
    if (!(key in payload)) continue;
    const nested = resolveArenaTargets(payload[key], depth + 1, visited);
    if (nested.length > 0) {
      return nested;
    }
  }

  for (const value of Object.values(payload)) {
    const nested = resolveArenaTargets(value, depth + 1, visited);
    if (nested.length > 0) {
      return nested;
    }
  }

  return [];
}

function describePayloadKeys(payload) {
  if (!payload || typeof payload !== 'object') {
    return '';
  }
  return Object.keys(payload).slice(0, 10).join(', ');
}

async function getDailyTaskState(client) {
  const roleInfo = await client.getRoleInfo(8000);
  const dailyTask = roleInfo?.role?.dailyTask || {};
  const completeMap = dailyTask?.complete && typeof dailyTask.complete === 'object'
    ? dailyTask.complete
    : {};

  const readyTaskIds = Object.entries(completeMap)
    .filter(([, value]) => Number(value) === -1 || value === true)
    .map(([key]) => Number(key))
    .filter((value) => Number.isFinite(value) && DEFAULT_DAILY_TASK_IDS.includes(value))
    .sort((a, b) => a - b);

  return {
    fingerprint: stableStringify(dailyTask),
    dailyPoint: Number(dailyTask?.dailyPoint || 0),
    completeMap,
    readyTaskIds,
    raw: dailyTask,
  };
}

async function tryClaim(results, label, action) {
  try {
    const result = await action();
    results.push({ name: label, ok: true, result });
    return { ok: true, noop: false };
  } catch (error) {
    const message = normalizeErrorMessage(error);
    const noop = isNoopError(message);
    results.push({ name: label, ok: false, error: message, noop });
    return { ok: false, noop, error: message };
  }
}

async function tryClaimWithExtraNoopPatterns(results, label, action, extraNoopPatterns = []) {
  try {
    const result = await action();
    results.push({ name: label, ok: true, result });
    return { ok: true, noop: false };
  } catch (error) {
    const message = normalizeErrorMessage(error);
    const noop = isNoopError(message) || extraNoopPatterns.some((pattern) => message.includes(pattern));
    results.push({ name: label, ok: false, error: message, noop });
    return { ok: false, noop, error: message };
  }
}

export async function executeArenaScheduledTask(client, config = {}) {
  const { battleCount = 3 } = config;
  const results = [];

  await client.ensureBattleVersion();

  for (let i = 0; i < battleCount; i++) {
    try {
      await client.startArenaArea();
    } catch {
      // 忽略开场失败，继续尝试拉取目标
    }

    let targetsResp = null;
    let targets = [];

    try {
      targetsResp = await client.getArenaTargets(false);
      targets = resolveArenaTargets(targetsResp);
    } catch {
      // 忽略，下面继续刷新兜底
    }

    if (targets.length === 0) {
      try {
        targetsResp = await client.getArenaTargets(true);
        targets = resolveArenaTargets(targetsResp);
      } catch {
        // 忽略刷新失败
      }
    }

    if (targets.length === 0) {
      const suffix = describePayloadKeys(targetsResp);
      results.push({
        target: 'unknown',
        ok: false,
        error: suffix ? `未找到竞技场数据（响应字段: ${suffix}）` : '未找到竞技场数据',
      });
      break;
    }

    const target = targets[0];
    const targetId = pickArenaTargetId(target);
    if (!targetId) {
      results.push({ target: 'unknown', ok: false, error: '未找到可用的竞技场目标' });
      break;
    }

    try {
      const result = await client.startArenaFight(targetId);
      results.push({
        target: target.name || target.nickName || target.nickname || targetId,
        ok: true,
        result,
      });
    } catch (error) {
      results.push({
        target: target.name || target.nickName || target.nickname || targetId,
        ok: false,
        error: normalizeErrorMessage(error),
      });
    }

    await sleep(600);
  }

  const successCount = results.filter((item) => item.ok).length;
  if (results.length === 0) {
    throw new Error('未找到可用的竞技场目标');
  }
  if (successCount === 0) {
    throw new Error(results.find((item) => item?.error)?.error || '竞技场战斗失败');
  }

  return {
    message: `竞技场战斗完成 (${successCount}/${results.length}场)`,
    data: { results, successCount },
  };
}

export async function executeMailClaimScheduledTask(client) {
  let beforeState = null;
  try {
    beforeState = await client.getMailList();
  } catch {
    // 读取邮件列表失败不阻断后续领取
  }

  const results = [];
  let successCount = 0;

  for (const category of MAIL_CATEGORIES) {
    const claimResult = await tryClaim(
      results,
      `邮件分类${category}`,
      () => client.claimAllMail(category)
    );
    if (claimResult.ok) {
      successCount += 1;
    }
    await sleep(150);
  }

  let afterState = null;
  try {
    afterState = await client.getMailList();
  } catch {
    // 忽略校验失败
  }

  const changed =
    beforeState && afterState
      ? stableStringify(beforeState) !== stableStringify(afterState)
      : null;
  const hardErrors = results.filter((item) => !item.ok && !item.noop);

  if (successCount === 0) {
    if (hardErrors.length > 0) {
      throw new Error(hardErrors[0].error || '邮件领取失败');
    }

    return {
      message: '没有可领取的邮件',
      data: { results, changed },
    };
  }

  if (changed === false) {
    return {
      message: '未检测到邮件变化，可能没有可领取附件',
      data: { results, changed, successCount },
    };
  }

  return {
    message: `邮件领取完成 (${successCount}/${MAIL_CATEGORIES.length}类)`,
    data: { results, successCount, changed },
  };
}

export async function executeDailyTaskClaimScheduledTask(client) {
  let beforeState = null;
  try {
    beforeState = await getDailyTaskState(client);
  } catch {
    // 忽略前置状态读取失败
  }

  const results = [];
  let successCount = 0;

  const taskIds = DEFAULT_DAILY_TASK_IDS
    .filter((value, index, list) => list.indexOf(value) === index)
    .sort((a, b) => a - b);

  for (const taskId of taskIds) {
    const claimResult = await tryClaim(
      results,
      `任务奖励${taskId}`,
      () => client.claimDailyPoint(taskId)
    );
    if (claimResult.ok) {
      successCount += 1;
    }
    await sleep(150);
  }

  const dailyRewardResult = await tryClaimWithExtraNoopPatterns(
    results,
    '日常任务宝箱(自动)',
    () => client.claimDailyReward(0),
    ['出了点小问题，请尝试重启游戏解决～']
  );
  if (dailyRewardResult.ok) {
    successCount += 1;
  }
  await sleep(120);

  const weeklyRewardResult = await tryClaimWithExtraNoopPatterns(
    results,
    '周常任务宝箱(自动)',
    () => client.claimWeeklyReward(0),
    ['出了点小问题，请尝试重启游戏解决～']
  );
  if (weeklyRewardResult.ok) {
    successCount += 1;
  }
  await sleep(120);

  let afterState = null;
  try {
    afterState = await getDailyTaskState(client);
  } catch {
    // 忽略后置状态读取失败
  }

  const hardErrors = results.filter((item) => !item.ok && !item.noop);
  const changed =
    beforeState && afterState
      ? beforeState.fingerprint !== afterState.fingerprint
      : null;

  if (successCount === 0) {
    if (hardErrors.length > 0) {
      throw createDetailedError(
        hardErrors[0].error || '每日任务奖励领取失败',
        {
          results,
          claimedCount: 0,
          changed,
          beforeDailyPoint: beforeState?.dailyPoint ?? null,
          afterDailyPoint: afterState?.dailyPoint ?? null,
          checkedTaskIds: taskIds,
          hardErrors,
        }
      );
    }

    return {
      message: '没有可领取的每日任务奖励',
      data: {
        results,
        claimedCount: 0,
        changed,
        beforeDailyPoint: beforeState?.dailyPoint ?? null,
        afterDailyPoint: afterState?.dailyPoint ?? null,
        checkedTaskIds: taskIds,
      },
    };
  }

  return {
    message: `每日任务奖励领取完成 (${successCount}/${results.length})`,
    data: {
      results,
      claimedCount: successCount,
      changed,
      beforeDailyPoint: beforeState?.dailyPoint ?? null,
      afterDailyPoint: afterState?.dailyPoint ?? null,
      checkedTaskIds: taskIds,
    },
  };
}
