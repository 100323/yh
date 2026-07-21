import assert from 'node:assert/strict';
import test from 'node:test';

import {
  SCHEDULER_RECONCILIATION_ACTIVATED_AT_KEY,
  resolveSchedulerReconciliationActivatedAt,
} from '../src/scheduler/scheduleSlotReconciliationActivation.js';

test('first activation persists one durable UTC watermark', () => {
  const writes = [];
  const result = resolveSchedulerReconciliationActivatedAt({
    now: new Date('2026-07-19T03:04:05.000Z'),
    getValue: () => null,
    setValue: (...args) => writes.push(args),
  });

  assert.equal(result, '2026-07-19T03:04:05.000Z');
  assert.deepEqual(writes, [[
    SCHEDULER_RECONCILIATION_ACTIVATED_AT_KEY,
    '2026-07-19T03:04:05.000Z',
  ]]);
});

test('later processes reuse the original valid activation watermark', () => {
  const writes = [];
  const result = resolveSchedulerReconciliationActivatedAt({
    now: new Date('2026-07-20T03:04:05.000Z'),
    getValue: () => '2026-07-19T03:04:05.000Z',
    setValue: (...args) => writes.push(args),
  });

  assert.equal(result, '2026-07-19T03:04:05.000Z');
  assert.deepEqual(writes, []);
});
