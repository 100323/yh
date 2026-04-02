function normalizeQuestionList(candidate) {
  return Array.isArray(candidate) && candidate.length > 0 ? candidate : null;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeStudyErrorMessage(error) {
  return String(error?.message || error || '').trim();
}

function isStudyAttemptLimitMessage(message) {
  return [
    '次数已用完',
    '次数不足',
    '今日次数',
    '重试次数',
    '超过3次',
    '超过三次',
    '每日只能',
    '今日只能',
  ].some((keyword) => message.includes(keyword));
}

function isStudyCompletedMessage(message) {
  return [
    '本周已完成',
    '本轮已完成',
    '已完成答题',
    '无需重复作答',
    '已经通关',
    '已通关',
  ].some((keyword) => message.includes(keyword));
}

function extractStudyInfo(payload = {}) {
  return payload?.role?.study || payload?.study || {};
}

export function isInCurrentWeek(timestampMs) {
  if (!timestampMs) return false;

  const now = new Date();
  const currentDay = now.getDay();
  const mondayOffset = currentDay === 0 ? -6 : 1 - currentDay;
  const weekStart = new Date(now);
  weekStart.setDate(now.getDate() + mondayOffset);
  weekStart.setHours(0, 0, 0, 0);

  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekStart.getDate() + 7);

  const target = new Date(Number(timestampMs));
  return target >= weekStart && target < weekEnd;
}

export function getStudyProgressSnapshot(payload = {}) {
  const study = extractStudyInfo(payload);
  return {
    id: study?.id ?? null,
    maxCorrectNum: Number(study?.maxCorrectNum || 0),
    beginTimeMs: Number(study?.beginTime || 0) * 1000,
  };
}

export function isStudyCompletedThisWeek(payload = {}) {
  const snapshot = getStudyProgressSnapshot(payload);
  return snapshot.maxCorrectNum >= 10 && isInCurrentWeek(snapshot.beginTimeMs);
}

export function extractStudySession(payload = {}, fallbackStudyId = null) {
  const study = extractStudyInfo(payload);
  const questionList =
    normalizeQuestionList(payload?.questionList) ||
    normalizeQuestionList(payload?.questions) ||
    normalizeQuestionList(payload?.questionlist) ||
    normalizeQuestionList(payload?.study?.questionList) ||
    normalizeQuestionList(payload?.role?.study?.questionList) ||
    normalizeQuestionList(payload?.data?.questionList) ||
    normalizeQuestionList(payload?.data?.questions);

  const studyId =
    payload?.role?.study?.id ||
    payload?.study?.id ||
    payload?.studyId ||
    payload?.data?.studyId ||
    payload?.data?.id ||
    payload?.id ||
    study?.id ||
    fallbackStudyId ||
    null;

  if (!questionList || !studyId) {
    return null;
  }

  return {
    questionList,
    studyId,
  };
}

export async function resolveStudySession(client, options = {}) {
  const {
    maxAttempts = 1,
    startTimeoutMs = 8000,
    roleInfoTimeoutMs = 8000,
    retryDelayMs = 400,
    logContext = {},
  } = options;

  let latestRoleInfo = null;
  let latestSnapshot = null;
  let fallbackStudyId = null;

  const refreshRoleInfo = async () => {
    const roleInfo = await client.getRoleInfo(roleInfoTimeoutMs);
    latestRoleInfo = roleInfo;
    latestSnapshot = getStudyProgressSnapshot(roleInfo);
    fallbackStudyId = latestSnapshot.id || fallbackStudyId;
    return roleInfo;
  };

  try {
    await refreshRoleInfo();
    if (isStudyCompletedThisWeek(latestRoleInfo)) {
      return {
        completed: true,
        snapshot: latestSnapshot,
        source: 'roleInfo',
        reason: 'roleInfo.maxCorrectNum >= 10',
      };
    }
  } catch (error) {
    console.warn('⚠️ 答题预热角色信息获取失败', {
      ...logContext,
      error: error?.message || String(error),
    });
  }

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    let startResp = null;
    try {
      startResp = await client.sendWithPromise('study_startgame', {}, startTimeoutMs);
    } catch (error) {
      const errorMessage = normalizeStudyErrorMessage(error);
      if (isStudyCompletedMessage(errorMessage)) {
        return {
          completed: true,
          snapshot: latestSnapshot,
          source: 'startStudyError',
          reason: errorMessage,
        };
      }
      if (isStudyAttemptLimitMessage(errorMessage)) {
        return {
          completed: false,
          blocked: 'attempt_limit',
          snapshot: latestSnapshot,
          source: 'startStudyError',
          reason: errorMessage,
        };
      }
      if (attempt >= maxAttempts) {
        throw error;
      }
      console.warn('⚠️ 答题开始请求失败，准备重试', {
        ...logContext,
        attempt,
        maxAttempts,
        error: error?.message || String(error),
      });
      await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
      continue;
    }

    const directSession = extractStudySession(startResp, fallbackStudyId);
    if (directSession) {
      return {
        completed: false,
        session: directSession,
        snapshot: latestSnapshot,
        source: 'startStudy',
      };
    }

    const startSnapshot = getStudyProgressSnapshot(startResp);
    if (startSnapshot.id) {
      fallbackStudyId = startSnapshot.id;
    }
    if (isStudyCompletedThisWeek(startResp)) {
      return {
        completed: true,
        snapshot: startSnapshot,
        source: 'startStudy',
        reason: 'startStudy.maxCorrectNum >= 10',
      };
    }

    try {
      const refreshedRoleInfo = await refreshRoleInfo();
      const refreshedSession = extractStudySession(refreshedRoleInfo, fallbackStudyId);
      if (refreshedSession) {
        return {
          completed: false,
          session: refreshedSession,
          snapshot: latestSnapshot,
          source: 'roleInfoRefresh',
        };
      }
      if (isStudyCompletedThisWeek(refreshedRoleInfo)) {
        return {
          completed: true,
          snapshot: latestSnapshot,
          source: 'roleInfoRefresh',
          reason: 'roleInfoRefresh.maxCorrectNum >= 10',
        };
      }
    } catch (error) {
      console.warn('⚠️ 答题开始后刷新角色信息失败', {
        ...logContext,
        attempt,
        maxAttempts,
        error: error?.message || String(error),
      });
    }

    if (attempt < maxAttempts) {
      await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
    }
  }

  throw new Error('未获取到答题题目或学习ID');
}

export async function executeStudyChallenge(client, options = {}) {
  const {
    maxStudyAttempts = 3,
    answerDelayMs = 300,
    answerToRewardDelayMs = 1500,
    rewardDelayMs = 200,
    betweenAttemptDelayMs = 500,
    roleInfoTimeoutMs = 8000,
    afterAttemptSnapshotRetries = 2,
    afterAttemptSnapshotRetryDelayMs = 400,
    logContext = {},
    findAnswer,
  } = options;

  if (typeof findAnswer !== 'function') {
    throw new Error('缺少答题答案解析函数');
  }

  const attempts = [];

  for (let attempt = 1; attempt <= maxStudyAttempts; attempt += 1) {
    const resolved = await resolveStudySession(client, {
      maxAttempts: 1,
      roleInfoTimeoutMs,
      logContext: {
        ...logContext,
        studyAttempt: attempt,
      },
    });

    if (resolved.completed) {
      return {
        message: '咸鱼大冲关已完成',
        data: {
          attempts,
          completionReason: resolved.reason || null,
          sessionSource: resolved.source,
          snapshot: resolved.snapshot || null,
        },
      };
    }

    if (resolved.blocked === 'attempt_limit') {
      return {
        message: resolved.reason || `咸鱼大冲关今日最多只能尝试 ${maxStudyAttempts} 次`,
        data: {
          attempts,
          blocked: resolved.blocked,
          sessionSource: resolved.source,
          snapshot: resolved.snapshot || null,
        },
      };
    }

    const { questionList, studyId } = resolved.session;
    const answerResults = [];
    let matchedCount = 0;
    let fallbackCount = 0;

    for (let i = 0; i < questionList.length; i += 1) {
      const question = questionList[i];
      const questionId = question?.id;
      const questionText = question?.question || '';
      if (!questionId) continue;

      const resolvedAnswer = findAnswer(questionText);
      const answer =
        typeof resolvedAnswer === 'object' && resolvedAnswer !== null
          ? Number(resolvedAnswer.answer) || 1
          : Number(resolvedAnswer) || 1;
      const matched = typeof resolvedAnswer === 'object' && resolvedAnswer !== null
        ? Boolean(resolvedAnswer.matched)
        : resolvedAnswer != null;
      const matchedQuestion =
        typeof resolvedAnswer === 'object' && resolvedAnswer !== null
          ? resolvedAnswer.matchedQuestion || null
          : null;

      if (matched) {
        matchedCount += 1;
      } else {
        fallbackCount += 1;
      }

      try {
        const result = await client.answerStudy(studyId, questionId, answer);
        answerResults.push({ questionId, answer, matched, matchedQuestion, ok: true, result });
      } catch (error) {
        answerResults.push({
          questionId,
          answer,
          matched,
          matchedQuestion,
          ok: false,
          error: normalizeStudyErrorMessage(error),
        });
      }
      await sleep(answerDelayMs);
    }

    console.log('🧠 答题命中率', {
      ...logContext,
      studyAttempt: attempt,
      studyId,
      totalQuestions: questionList.length,
      matchedCount,
      fallbackCount,
      summary: `本轮 ${questionList.length} 题里，题库命中 ${matchedCount} 题，默认答案兜底 ${fallbackCount} 题`,
    });

    await sleep(answerToRewardDelayMs);

    const rewardResults = [];
    for (let rewardId = 1; rewardId <= 10; rewardId += 1) {
      try {
        const result = await client.claimStudyReward(rewardId);
        rewardResults.push({ rewardId, ok: true, result });
      } catch (error) {
        rewardResults.push({
          rewardId,
          ok: false,
          error: normalizeStudyErrorMessage(error),
        });
      }
      await sleep(rewardDelayMs);
    }

    let latestSnapshot = null;
    for (let snapshotAttempt = 1; snapshotAttempt <= afterAttemptSnapshotRetries; snapshotAttempt += 1) {
      try {
        const latestRoleInfo = await client.getRoleInfo(roleInfoTimeoutMs);
        latestSnapshot = getStudyProgressSnapshot(latestRoleInfo);
        break;
      } catch (error) {
        console.warn('⚠️ 答题完成后刷新角色信息失败', {
          ...logContext,
          studyAttempt: attempt,
          snapshotAttempt,
          afterAttemptSnapshotRetries,
          error: normalizeStudyErrorMessage(error),
        });
        if (snapshotAttempt < afterAttemptSnapshotRetries) {
          await sleep(afterAttemptSnapshotRetryDelayMs);
        }
      }
    }

    const answered = answerResults.filter((item) => item.ok).length;
    const correctCount = Number(latestSnapshot?.maxCorrectNum || 0);

    attempts.push({
      attempt,
      totalQuestions: questionList.length,
      answered,
      correctCount,
      matchedCount,
      fallbackCount,
      studyId,
      sessionSource: resolved.source,
      answerResults,
      rewardResults,
      snapshot: latestSnapshot,
    });

    if (!latestSnapshot) {
      return {
        message: `咸鱼大冲关第 ${attempt} 次尝试已提交，但成绩确认失败，已停止继续重试`,
        data: {
          attempts,
          completed: false,
          scoreConfirmed: false,
        },
      };
    }

    if (correctCount >= 10) {
      return {
        message: `咸鱼大冲关完成，第 ${attempt} 次尝试答对 ${correctCount}/10 题`,
        data: {
          attempts,
          completed: true,
          finalSnapshot: latestSnapshot,
        },
      };
    }

    if (attempt < maxStudyAttempts) {
      await sleep(betweenAttemptDelayMs);
    }
  }

  const bestCorrectCount = attempts.reduce(
    (max, item) => Math.max(max, Number(item?.correctCount || 0)),
    0,
  );

  return {
    message: `咸鱼大冲关未完成，已尝试 ${attempts.length} 次，最高答对 ${bestCorrectCount}/10 题`,
    data: {
      attempts,
      completed: false,
      bestCorrectCount,
    },
  };
}
