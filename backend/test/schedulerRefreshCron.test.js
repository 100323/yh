import test from 'node:test';
import assert from 'node:assert/strict';

import { __testing } from '../src/scheduler/index.js';

const {
  SCHEDULER_REFRESH_CRON,
  DEFAULT_SCHEDULER_REFRESH_CRON,
  normalizeRefreshCron,
} = __testing;

test('调度器注册对账心跳默认放宽到每 3 分钟', () => {
  assert.equal(DEFAULT_SCHEDULER_REFRESH_CRON, '*/3 * * * *');
});

test('生效的注册对账 cron 是合法的 5 段表达式', () => {
  assert.equal(typeof SCHEDULER_REFRESH_CRON, 'string');
  // node-cron 需要 5 段（分 时 日 月 周），段数不对会在 schedule() 时抛错中断初始化
  assert.equal(SCHEDULER_REFRESH_CRON.trim().split(/\s+/).length, 5);
});

test('normalizeRefreshCron 接受合法表达式并去除首尾空白', () => {
  assert.equal(normalizeRefreshCron('*/5 * * * *'), '*/5 * * * *');
  assert.equal(normalizeRefreshCron('* * * * *'), '* * * * *');
  assert.equal(normalizeRefreshCron('  */3 * * * *  '), '*/3 * * * *');
  assert.equal(normalizeRefreshCron('0 4 * * *'), '0 4 * * *');
});

test('normalizeRefreshCron 对非法值回退默认，避免初始化抛错', () => {
  const fallback = DEFAULT_SCHEDULER_REFRESH_CRON;
  // 空值
  assert.equal(normalizeRefreshCron(''), fallback);
  assert.equal(normalizeRefreshCron('   '), fallback);
  assert.equal(normalizeRefreshCron(null), fallback);
  assert.equal(normalizeRefreshCron(undefined), fallback);
  // 段数不对
  assert.equal(normalizeRefreshCron('*/3 * * *'), fallback);
  assert.equal(normalizeRefreshCron('* * * * * *'), fallback);
  assert.equal(normalizeRefreshCron('每分钟'), fallback);
});

test('normalizeRefreshCron 支持自定义回退值', () => {
  assert.equal(normalizeRefreshCron('', '*/5 * * * *'), '*/5 * * * *');
  assert.equal(normalizeRefreshCron('bad', '*/5 * * * *'), '*/5 * * * *');
});
