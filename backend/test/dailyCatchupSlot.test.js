import test from 'node:test';
import assert from 'node:assert/strict';

import { __testing } from '../src/scheduler/index.js';

const {
  getDailyCatchupSlotKey,
  getLatestDueSlotForToday,
  shanghaiLocalToEpochMs,
  shouldRunDailyCatchupSlot,
} = __testing;

const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1000;

/** 构造"上海本地时间"对应的 Date 对象。 */
function shanghai(year, month, day, hour, minute, second = 0) {
  return new Date(Date.UTC(year, month - 1, day, hour, minute, second, 0) - SHANGHAI_OFFSET_MS);
}

const pad2 = (value) => String(value).padStart(2, '0');

/** 零填充字符串比较——旧实现的做法，用于守护"等效重构"这一结论。 */
function legacyLatestDueSlot(cronHours, now, graceMs) {
  const shifted = new Date(now.getTime() - graceMs + SHANGHAI_OFFSET_MS);
  const boundary = [
    shifted.getUTCFullYear(),
    '-',
    pad2(shifted.getUTCMonth() + 1),
    '-',
    pad2(shifted.getUTCDate()),
    ' ',
    pad2(shifted.getUTCHours()),
    ':',
    pad2(shifted.getUTCMinutes()),
    ':',
    pad2(shifted.getUTCSeconds()),
  ].join('');
  const local = new Date(now.getTime() + SHANGHAI_OFFSET_MS);
  const datePrefix = [
    local.getUTCFullYear(),
    '-',
    pad2(local.getUTCMonth() + 1),
    '-',
    pad2(local.getUTCDate()),
    ' ',
  ].join('');

  let latest = null;
  for (const hour of cronHours) {
    const slot = datePrefix + pad2(hour) + ':00:00';
    if (slot <= boundary && (!latest || slot > latest)) {
      latest = slot;
    }
  }
  return latest;
}

test('getDailyCatchupSlotKey 全天成档，不再受 14:00-18:00 限制', () => {
  // 旧实现在这些时刻返回 null，使补偿整天停摆——漏做主因场景（凌晨）恰好落在窗口外。
  const cases = [
    [shanghai(2026, 10, 1, 0, 30), '2026-10-01 00:00'],
    [shanghai(2026, 10, 1, 8, 15), '2026-10-01 08:00'],
    [shanghai(2026, 10, 1, 13, 59), '2026-10-01 13:00'],
    [shanghai(2026, 10, 1, 14, 0), '2026-10-01 14:00'],
    [shanghai(2026, 10, 1, 17, 59), '2026-10-01 17:00'],
    [shanghai(2026, 10, 1, 18, 0), '2026-10-01 18:00'],
    [shanghai(2026, 10, 1, 22, 0), '2026-10-01 22:00'],
    [shanghai(2026, 10, 1, 23, 59), '2026-10-01 23:00'],
  ];

  for (const [now, expected] of cases) {
    assert.equal(getDailyCatchupSlotKey(now), expected);
  }
});

test('getDailyCatchupSlotKey 在任意时刻都返回非空档位', () => {
  for (let hour = 0; hour < 24; hour += 1) {
    const slotKey = getDailyCatchupSlotKey(shanghai(2026, 10, 1, hour, 30));
    assert.equal(typeof slotKey, 'string');
    assert.match(slotKey, /^\d{4}-\d{2}-\d{2} \d{2}:00$/);
  }
});

test('shanghaiLocalToEpochMs 按 UTC+8 换算，跨天不偏移', () => {
  // 上海 2026-10-01 00:00 == UTC 2026-09-30 16:00
  assert.equal(shanghaiLocalToEpochMs(2026, 10, 1, 0, 0), Date.parse('2026-09-30T16:00:00Z'));
  assert.equal(shanghaiLocalToEpochMs(2026, 10, 1, 18, 0), Date.parse('2026-10-01T10:00:00Z'));
  // 跨年
  assert.equal(shanghaiLocalToEpochMs(2027, 1, 1, 0, 0), Date.parse('2026-12-31T16:00:00Z'));
  // 相邻档位严格单调，间隔恰好一小时
  assert.equal(
    shanghaiLocalToEpochMs(2026, 10, 1, 6, 0) - shanghaiLocalToEpochMs(2026, 10, 1, 5, 0),
    60 * 60 * 1000,
  );
});

test('getLatestDueSlotForToday 滞后一档：00:00 档要等 00:05 才判定', () => {
  const task = { cron_expression: '0 */6 * * *' };

  // 每天 00:00:00~00:04:59 处于"空窗"，返回 null。
  // 这不是漏做，而是刻意的滞后：等错峰延迟走完、执行标记落库后再判定，
  // 否则会把"刚派发、还没写完 marker"的批次误判为漏做并重复执行。
  assert.equal(getLatestDueSlotForToday(task, shanghai(2026, 10, 1, 0, 0, 0)), null);
  assert.equal(getLatestDueSlotForToday(task, shanghai(2026, 10, 1, 0, 0, 30)), null);
  assert.equal(getLatestDueSlotForToday(task, shanghai(2026, 10, 1, 0, 4, 59)), null);

  // 宽限边界是闭区间：正好 5 分钟即视为到期。
  assert.equal(getLatestDueSlotForToday(task, shanghai(2026, 10, 1, 0, 5, 0)), '2026-10-01 00:00:00');
  assert.equal(getLatestDueSlotForToday(task, shanghai(2026, 10, 1, 0, 6, 0)), '2026-10-01 00:00:00');
});

test('getLatestDueSlotForToday 跨月/跨年不串档', () => {
  const task = { cron_expression: '0 */6 * * *' };

  // 月初第一天：不得回退到上月最后一档
  assert.equal(getLatestDueSlotForToday(task, shanghai(2026, 10, 1, 0, 5, 0)), '2026-10-01 00:00:00');
  // 年末跨到年初
  assert.equal(getLatestDueSlotForToday(task, shanghai(2027, 1, 1, 0, 5, 0)), '2027-01-01 00:00:00');
  // 单/双位数月日切换
  assert.equal(getLatestDueSlotForToday(task, shanghai(2026, 10, 9, 0, 5, 0)), '2026-10-09 00:00:00');
  assert.equal(getLatestDueSlotForToday(task, shanghai(2026, 10, 10, 0, 5, 0)), '2026-10-10 00:00:00');
});

test('getLatestDueSlotForToday 取当天最近一档已到期档位', () => {
  const task = { cron_expression: '0 */6 * * *' };

  assert.equal(getLatestDueSlotForToday(task, shanghai(2026, 10, 1, 1, 5, 0)), '2026-10-01 00:00:00');
  assert.equal(getLatestDueSlotForToday(task, shanghai(2026, 10, 1, 5, 59, 0)), '2026-10-01 00:00:00');
  assert.equal(getLatestDueSlotForToday(task, shanghai(2026, 10, 1, 6, 5, 0)), '2026-10-01 06:00:00');
  assert.equal(getLatestDueSlotForToday(task, shanghai(2026, 10, 1, 12, 5, 0)), '2026-10-01 12:00:00');
  assert.equal(getLatestDueSlotForToday(task, shanghai(2026, 10, 1, 18, 5, 0)), '2026-10-01 18:00:00');
  assert.equal(getLatestDueSlotForToday(task, shanghai(2026, 10, 1, 23, 59, 0)), '2026-10-01 18:00:00');
});

test('getLatestDueSlotForToday 合并任务类型的附加 cron', () => {
  // DAILY_TASK_CLAIM 除自身 cron 外还挂 30 22 * * *（TASK_EXTRA_CRON_EXPRESSIONS）
  const task = { task_type: 'DAILY_TASK_CLAIM', cron_expression: '0 9 * * *' };

  assert.equal(getLatestDueSlotForToday(task, shanghai(2026, 10, 1, 9, 5, 0)), '2026-10-01 09:00:00');
  assert.equal(getLatestDueSlotForToday(task, shanghai(2026, 10, 1, 15, 0, 0)), '2026-10-01 09:00:00');
  assert.equal(getLatestDueSlotForToday(task, shanghai(2026, 10, 1, 22, 35, 0)), '2026-10-01 22:30:00');
});

test('getLatestDueSlotForToday 无 cron 或当日不命中时返回 null', () => {
  assert.equal(getLatestDueSlotForToday({ cron_expression: '' }, shanghai(2026, 10, 1, 12, 0, 0)), null);
  assert.equal(getLatestDueSlotForToday({}, shanghai(2026, 10, 1, 12, 0, 0)), null);
  // 2026-10-01 是周四，周日专属任务当天没有档位
  assert.equal(
    getLatestDueSlotForToday({ cron_expression: '0 10 * * 0' }, shanghai(2026, 10, 1, 12, 0, 0)),
    null,
  );
});

test('时间戳比较与旧字符串比较等效（守护重构前提）', () => {
  // 旧实现拿 (now - grace) 格式化出的零填充字符串做字典序比较。因为所有字段定长零填充，
  // 字典序恰好等于时序，所以两种写法结果一致。这条测试锁住该前提：一旦有人改动
  // formatShanghaiLocalDateTime 的填充方式，这里会失败，提醒跨天判断可能已失效。
  const cronHours = [0, 6, 12, 18];
  const graceMs = 5 * 60 * 1000;
  const task = { cron_expression: '0 */6 * * *' };
  const starts = [
    shanghai(2026, 9, 30, 14, 0, 30),
    shanghai(2026, 12, 31, 14, 0, 30),
    shanghai(2026, 1, 9, 14, 0, 30),
  ];

  let checked = 0;
  for (const start of starts) {
    for (let minute = 0; minute < 26 * 60; minute += 7) {
      const now = new Date(start.getTime() + minute * 60 * 1000);
      assert.equal(
        getLatestDueSlotForToday(task, now),
        legacyLatestDueSlot(cronHours, now, graceMs),
        `mismatch at ${now.toISOString()}`,
      );
      checked += 1;
    }
  }
  assert.ok(checked > 500, `抽样点过少: ${checked}`);
});

test('shouldRunDailyCatchupSlot 去重与互斥', () => {
  assert.equal(shouldRunDailyCatchupSlot('2026-10-01 00:00', null, false), true);
  assert.equal(shouldRunDailyCatchupSlot('2026-10-01 00:00', '2026-09-30 23:00', false), true);
  assert.equal(shouldRunDailyCatchupSlot('2026-10-01 00:00', '2026-10-01 00:00', false), false);
  assert.equal(shouldRunDailyCatchupSlot('2026-10-01 00:00', null, true), false);
  assert.equal(shouldRunDailyCatchupSlot(null, null, false), false);
});
