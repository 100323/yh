import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createTaskCompletionLogDetails,
  getTaskCompletionState,
  parseTaskDetails,
  shouldRetryTaskCompletion,
} from '../src/utils/taskCompletion.js';
import scheduler from '../src/scheduler/index.js';
import batchScheduler from '../src/batchScheduler/index.js';

test('点金 2/3 遇到请求超时会标记部分完成并需要补偿', () => {
  const completion = getTaskCompletionState('BUY_GOLD', {
    buyNum: 3,
    successCount: 2,
    results: [{ ok: true }, { ok: true }, { ok: false, error: '请求超时' }],
  });

  assert.equal(completion.complete, false);
  assert.equal(completion.status, 'partial');
  assert.equal(completion.remainingCount, 1);
  assert.equal(shouldRetryTaskCompletion('BUY_GOLD', 'success', completion), true);
});

test('点金 2/3 但今日次数已用完视为当天完成且不补偿', () => {
  const completion = getTaskCompletionState('BUY_GOLD', {
    buyNum: 3,
    successCount: 2,
    results: [{ ok: true }, { ok: true }, { ok: false, error: '今日点金次数已用完' }],
  });

  assert.equal(completion.complete, true);
  assert.equal(completion.reason, 'exhausted');
  assert.equal(shouldRetryTaskCompletion('BUY_GOLD', 'success', completion), false);
});

test('点金 3/3 为完整成功且不补偿', () => {
  const completion = getTaskCompletionState('BUY_GOLD', {
    buyNum: 3,
    successCount: 3,
    results: [{ ok: true }, { ok: true }, { ok: true }],
  });

  assert.equal(completion.complete, true);
  assert.equal(completion.status, 'complete');
  assert.equal(completion.remainingCount, 0);
  assert.equal(shouldRetryTaskCompletion('BUY_GOLD', 'success', completion), false);
});

test('灯神四国成功或明确跳过时为完整', () => {
  const completion = getTaskCompletionState('GENIE_SWEEP', {
    sweepResults: [
      { genieId: 1, success: true },
      { genieId: 2, skipped: true, reason: '今日已扫荡' },
      { genieId: 3, success: true },
      { genieId: 4, skipped: true, reason: '扫荡条件不满足' },
    ],
    ticketResults: [
      { index: 1, success: true },
      { index: 2, skipped: true, reason: '今日扫荡券已领完' },
    ],
  });

  assert.equal(completion.complete, true);
  assert.equal(completion.status, 'complete');
  assert.equal(shouldRetryTaskCompletion('GENIE_SWEEP', 'success', completion), false);
});

test('灯神缺少国家结果时为部分完成并需要补偿', () => {
  const completion = getTaskCompletionState('GENIE_SWEEP', {
    sweepResults: [
      { genieId: 1, success: true },
      { genieId: 2, success: false, error: '请求超时' },
      { genieId: 3, skipped: true, reason: '今日已扫荡' },
    ],
    ticketResults: [{ index: 1, skipped: true, reason: '今日扫荡券已领完' }],
  });

  assert.equal(completion.complete, false);
  assert.equal(completion.status, 'partial');
  assert.deepEqual(completion.missingGenieIds, [4]);
  assert.equal(shouldRetryTaskCompletion('GENIE_SWEEP', 'success', completion), true);
});

test('灯神今日扫荡券已领完属于正常结束', () => {
  const completion = getTaskCompletionState('GENIE_SWEEP', {
    sweepResults: [1, 2, 3, 4].map((genieId) => ({ genieId, skipped: true, reason: '今日已扫荡' })),
    ticketResults: [{ index: 1, skipped: true, reason: '今日扫荡券已领完' }],
  });

  assert.equal(completion.complete, true);
  assert.equal(completion.reason, 'exhausted');
  assert.equal(shouldRetryTaskCompletion('GENIE_SWEEP', 'success', completion), false);
});

test('任务详情支持 JSON 字符串和对象输入', () => {
  assert.deepEqual(parseTaskDetails('{"successCount":2}'), { successCount: 2 });
  assert.deepEqual(parseTaskDetails({ successCount: 2 }), { successCount: 2 });
  assert.equal(parseTaskDetails('not-json'), null);
});

test('非完成度任务的 error 状态仍会进入补偿', () => {
  assert.equal(shouldRetryTaskCompletion('SIGN_IN', 'error', null), true);
});

test('普通和批量点金执行器均记录部分完成度', async () => {
  for (const currentScheduler of [scheduler, batchScheduler]) {
    let attempts = 0;
    const result = await currentScheduler.__testing.runTaskByType({
      buyGold: async () => {
        attempts += 1;
        if (attempts === 3) {
          throw new Error('请求超时');
        }
        return { ok: true };
      },
    }, 'BUY_GOLD', { buyNum: 3 });

    assert.equal(result.data.successCount, 2);
    assert.equal(result.data.remainingCount, 1);
    assert.equal(result.data.completion.complete, false);
    assert.equal(result.data.completion.retryable, true);
  }
});

test('成功和信息日志保留结构化任务详情', async () => {
  const [tasksRoute, batchRoute] = await Promise.all([
    import('../src/routes/tasks.js'),
    import('../src/routes/batchScheduler.js'),
  ]);
  const details = { successCount: 2, completion: { complete: false } };

  assert.equal(tasksRoute.__testing.normalizeTaskLogDetails('success', details), JSON.stringify(details));
  assert.equal(batchRoute.__testing.normalizeBatchTaskLogDetails('info', details), JSON.stringify(details));
});

test('完成度日志移除灯神原始响应并保持可解析', async () => {
  const { __testing: tasksTesting } = await import('../src/routes/tasks.js');
  const details = createTaskCompletionLogDetails('GENIE_SWEEP', {
    sweepResults: [1, 2, 3, 4].map((genieId) => ({
      genieId,
      name: `国家${genieId}`,
      success: true,
      result: { raw: 'x'.repeat(2000) },
    })),
    ticketResults: [{ index: 1, skipped: true, reason: '今日扫荡券已领完' }],
  });
  const normalized = tasksTesting.normalizeTaskLogDetails('success', details);

  assert.ok(normalized.length <= 1000);
  assert.equal(JSON.parse(normalized).completion.complete, true);
  assert.equal(JSON.parse(normalized).sweepResults[0].result, undefined);
});

test('catchup 识别成功但完成度不足的点金并只补剩余次数', () => {
  const now = new Date('2026-09-01T04:00:00.000Z');
  const task = {
    id: 101,
    account_id: 7,
    task_type: 'BUY_GOLD',
    cron_expression: '0 8 * * *',
    config_json: JSON.stringify({ buyNum: 3 }),
  };
  const markerSnapshots = new Map([[
    '7_BUY_GOLD',
    {
      latest_status: 'success',
      latest_message: '点金完成 (2/3)',
      latest_details: JSON.stringify({
        buyNum: 3,
        successCount: 2,
        results: [{ ok: true }, { ok: true }, { ok: false, error: '请求超时' }],
      }),
      local_executed_at: '2026-09-01 08:10:00',
    },
  ]]);

  const catchup = scheduler.__testing.collectDailyCatchupTasks(
    [task],
    19,
    now,
    { markerSnapshots, logSnapshots: new Map() },
  );

  assert.equal(catchup.incompleteTasks.length, 1);
  assert.equal(catchup.tasks[0].catchupReason, 'incomplete_success');
  assert.equal(JSON.parse(catchup.tasks[0].config_json).buyNum, 1);
});

test('补做检查从 14:00 起每半小时触发', () => {
  assert.equal(scheduler.__testing.DAILY_CATCHUP_CRON, '0,30 14-22 * * *');
});

test('日周活跃奖励在 22:30 兜底补做', () => {
  assert.deepEqual(scheduler.__testing.TASK_EXTRA_CRON_EXPRESSIONS.DAILY_TASK_CLAIM, [
    '30 22 * * *',
  ]);
});

test('weekly task is not a catchup candidate outside its configured weekday', () => {
  const task = {
    id: 104,
    account_id: 10,
    task_type: 'DAILY_TASK_CLAIM',
    cron_expression: '0 8 * * 0',
  };

  const catchup = scheduler.__testing.collectDailyCatchupTasks(
    [task],
    19,
    new Date('2026-09-01T04:00:00.000Z'),
    { markerSnapshots: new Map(), logSnapshots: new Map() },
  );

  assert.deepEqual(catchup.tasks, []);
});

test('weekly task becomes a catchup candidate after its configured weekday slot', () => {
  const task = {
    id: 105,
    account_id: 11,
    task_type: 'DAILY_TASK_CLAIM',
    cron_expression: '0 8 * * 0',
  };

  const catchup = scheduler.__testing.collectDailyCatchupTasks(
    [task],
    19,
    new Date('2026-09-06T03:00:00.000Z'),
    { markerSnapshots: new Map(), logSnapshots: new Map() },
  );

  assert.equal(catchup.missingTasks.length, 1);
  assert.equal(catchup.tasks[0].catchupExpectedAt, '2026-09-06 08:00:00');
});

test('batch scheduler executes daily boss with one challenge by default', async () => {
  let callCount = 0;
  const result = await batchScheduler.__testing.runTaskByType({
    ensureBattleVersion: async () => {},
    startDailyBossFight: async () => {
      callCount += 1;
      return { round: callCount };
    },
  }, 'DAILY_BOSS', { totalChallenges: 5 });

  assert.equal(callCount, 1);
  assert.equal(result.data.totalChallenges, 1);
  assert.equal(result.message, '每日咸王挑战完成 (1/1次)');
});

test('晚间任务尚未到期时，零候选补做不能提前停止当天检查', () => {
  const task = {
    id: 102,
    account_id: 8,
    task_type: 'DAILY_TASK_CLAIM',
    cron_expression: '30 23 * * *',
  };
  const now = new Date('2026-09-01T06:00:00.000Z');

  assert.equal(
    scheduler.__testing.shouldSettleDailyCatchup([task], { tasks: [] }, now),
    false,
  );
});

test('最后一个任务时段已过且没有补做项时，停止当天后续检查', () => {
  const task = {
    id: 103,
    account_id: 9,
    task_type: 'DAILY_TASK_CLAIM',
    cron_expression: '30 23 * * *',
  };
  const now = new Date('2026-09-01T15:45:00.000Z');

  assert.equal(
    scheduler.__testing.shouldSettleDailyCatchup([task], { tasks: [] }, now),
    true,
  );
  assert.equal(
    scheduler.__testing.shouldSettleDailyCatchup([task], { tasks: [task] }, now),
    false,
  );
});
