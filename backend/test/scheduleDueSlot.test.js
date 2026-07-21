import assert from 'node:assert/strict';
import test from 'node:test';

import { findLatestDueScheduleSlot } from '../src/scheduler/scheduleDueSlot.js';

test('findLatestDueScheduleSlot converts a Shanghai cron minute into its UTC durable slot', () => {
  const result = findLatestDueScheduleSlot(['0 0 * * *'], {
    now: new Date('2026-07-18T16:01:00.000Z'),
    graceMs: 60_000,
  });

  assert.deepEqual(result, {
    localScheduledAt: '2026-07-19 00:00:00',
    scheduledAt: '2026-07-18T16:00:00.000Z',
    cronExpression: '0 0 * * *',
  });
});

test('findLatestDueScheduleSlot returns only the latest due cycle for one task', () => {
  const result = findLatestDueScheduleSlot([
    '0 0 * * *',
    '0 6 * * *',
    '0 8 * * *',
  ], {
    now: new Date('2026-07-19T00:48:00.000Z'),
    graceMs: 60_000,
  });

  assert.equal(result.localScheduledAt, '2026-07-19 08:00:00');
  assert.equal(result.scheduledAt, '2026-07-19T00:00:00.000Z');
  assert.equal(result.cronExpression, '0 8 * * *');
});

test('findLatestDueScheduleSlot waits for the grace period and ignores invalid expressions', () => {
  const beforeGrace = findLatestDueScheduleSlot(['invalid', '0 0 * * *'], {
    now: new Date('2026-07-18T16:00:59.999Z'),
    graceMs: 60_000,
  });
  const afterGrace = findLatestDueScheduleSlot(['invalid', '0 0 * * *'], {
    now: new Date('2026-07-18T16:01:00.000Z'),
    graceMs: 60_000,
  });

  assert.equal(beforeGrace, null);
  assert.equal(afterGrace?.scheduledAt, '2026-07-18T16:00:00.000Z');
});

test('findLatestDueScheduleSlot applies the same day-of-week matching as node-cron', () => {
  const sunday = findLatestDueScheduleSlot(['0 10 * * 0'], {
    now: new Date('2026-07-19T04:00:00.000Z'),
    graceMs: 0,
  });
  const monday = findLatestDueScheduleSlot(['0 10 * * 0'], {
    now: new Date('2026-07-20T04:00:00.000Z'),
    graceMs: 0,
  });

  assert.equal(sunday?.localScheduledAt, '2026-07-19 10:00:00');
  assert.equal(monday, null);
});

test('findLatestDueScheduleSlot can reconcile the previous Shanghai day across a month boundary', () => {
  const result = findLatestDueScheduleSlot(['59 23 31 7 *'], {
    now: new Date('2026-07-31T16:01:00.000Z'),
    graceMs: 60_000,
    lookbackDays: 1,
  });

  assert.deepEqual(result, {
    localScheduledAt: '2026-07-31 23:59:00',
    scheduledAt: '2026-07-31T15:59:00.000Z',
    cronExpression: '59 23 31 7 *',
  });
});

test('findLatestDueScheduleSlot does not replay an old previous-day cycle outside the reconciliation window', () => {
  const result = findLatestDueScheduleSlot(['0 6 * * *'], {
    now: new Date('2026-07-19T21:00:00.000Z'),
    graceMs: 60_000,
    lookbackDays: 1,
    maxLookbackMs: 60 * 60 * 1000,
  });

  assert.equal(result, null);
});
