import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const originalCwd = process.cwd();
const importCwd = fs.mkdtempSync(path.join(os.tmpdir(), 'new-weekly-tasks-'));
process.chdir(importCwd);

const [taskRoutes, batchSchedulerRoutes, scheduler, batchScheduler] = await Promise.all([
  import('../src/routes/tasks.js'),
  import('../src/routes/batchScheduler.js'),
  import('../src/scheduler/index.js'),
  import('../src/batchScheduler/index.js'),
]);

process.chdir(originalCwd);

const expectedTasks = {
  LEGION_SALT_SIGNUP: {
    name: '盐场报名',
    cron: '0 16 * * 6',
    group: 'dungeon',
  },
  LEGION_PEACH_SIGNUP: {
    name: '蟠桃报名',
    cron: '0 16 * * 0',
    group: 'dungeon',
  },
  GENIE_SWEEP_DEEP_SEA: {
    name: '深海扫荡',
    cron: '1 0 * * 1',
    group: 'resource',
  },
  CLUB_BONFIRE_SIGNUP: {
    name: '营地篝火报名',
    cron: '0 22 * * 0',
    group: 'dungeon',
  },
};

const expectedDefaultEnabled = {
  LEGION_SALT_SIGNUP: false,
  LEGION_PEACH_SIGNUP: false,
  GENIE_SWEEP_DEEP_SEA: true,
  CLUB_BONFIRE_SIGNUP: false,
};

test('exposes four weekly tasks with fixed cron and required defaults', () => {
  for (const [taskType, expected] of Object.entries(expectedTasks)) {
    assert.deepEqual(taskRoutes.TASK_TYPES[taskType], expected);
    assert.equal(taskRoutes.DEFAULT_TASK_CONFIG_SEEDS[taskType].enabled, expectedDefaultEnabled[taskType]);
    assert.deepEqual(taskRoutes.DEFAULT_TASK_CONFIG_SEEDS[taskType].config, {});
    assert.equal(batchSchedulerRoutes.BATCH_TASK_TYPES[taskType].name, expected.name);
  }
});

test('locks new task cron expressions on backend save', () => {
  for (const [taskType, expected] of Object.entries(expectedTasks)) {
    assert.equal(
      taskRoutes.normalizeLockedTaskCronExpression(taskType, '0 8 * * *'),
      expected.cron,
    );
    assert.equal(taskRoutes.normalizeLockedTaskCronExpression(taskType), expected.cron);
  }

  assert.equal(taskRoutes.normalizeLockedTaskCronExpression('SIGN_IN', '0 7 * * *'), '0 7 * * *');
});

test('locks fixed weekly tasks as standalone batch schedules', () => {
  assert.deepEqual(batchSchedulerRoutes.normalizeLockedBatchTaskSchedule(['LEGION_SALT_SIGNUP']), {
    runType: 'cron',
    runTime: null,
    cronExpression: '0 16 * * 6',
  });
  assert.equal(batchSchedulerRoutes.normalizeLockedBatchTaskSchedule(['SIGN_IN']), null);
  assert.equal(
    batchSchedulerRoutes.normalizeLockedBatchTaskSchedule(['LEGION_SALT_SIGNUP', 'SIGN_IN']),
    null,
  );
  assert.equal(
    batchSchedulerRoutes.normalizeLockedBatchTaskSchedule([
      'LEGION_SALT_SIGNUP',
      'LEGION_PEACH_SIGNUP',
    ]),
    null,
  );
});

test('dispatches new signup and sweep tasks in both schedulers', async () => {
  for (const schedulerModule of [scheduler, batchScheduler]) {
    const client = {
      calls: [],
      legionSignup: async function () {
        this.calls.push(['legionSignup']);
        return { ok: 'salt' };
      },
      legionPayloadSignup: async function () {
        this.calls.push(['legionPayloadSignup']);
        return { ok: 'peach' };
      },
      genieDeepSeaSweep: async function (params) {
        this.calls.push(['genieDeepSeaSweep', params]);
        return { ok: 'deep-sea' };
      },
      clubSignup: async function () {
        this.calls.push(['clubSignup']);
        return { ok: 'club' };
      },
    };

    const saltResult = await schedulerModule.__testing.runTaskByType(client, 'LEGION_SALT_SIGNUP', {});
    const peachResult = await schedulerModule.__testing.runTaskByType(client, 'LEGION_PEACH_SIGNUP', {});
    const sweepResult = await schedulerModule.__testing.runTaskByType(client, 'GENIE_SWEEP_DEEP_SEA', {});
    const clubResult = await schedulerModule.__testing.runTaskByType(client, 'CLUB_BONFIRE_SIGNUP', {});

    assert.deepEqual(client.calls, [
      ['legionSignup'],
      ['legionPayloadSignup'],
      ['genieDeepSeaSweep', { genieId: 5, sweepCnt: 1 }],
      ['clubSignup'],
    ]);
    assert.deepEqual(saltResult, { message: '盐场报名成功', data: { ok: 'salt' } });
    assert.deepEqual(peachResult, { message: '蟠桃报名成功', data: { ok: 'peach' } });
    assert.deepEqual(sweepResult, {
      message: '深海扫荡成功',
      data: { ok: 'deep-sea', genieId: 5, sweepCnt: 1 },
    });
    assert.deepEqual(clubResult, { message: '营地篝火报名成功', data: { ok: 'club' } });
  }
});
