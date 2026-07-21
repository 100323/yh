import assert from 'node:assert/strict';
import test from 'node:test';
import {
  appendScheduleSlot,
  getScheduleSlots,
} from '../src/scheduler/scheduleSlotBatchState.js';

test('merged batch item retains every distinct schedule slot in trigger order', () => {
  const firstSlot = { id: 101 };
  const secondSlot = { id: 102 };
  const item = { scheduleSlots: [firstSlot] };

  appendScheduleSlot(item, firstSlot);
  appendScheduleSlot(item, secondSlot);

  assert.deepEqual(getScheduleSlots(item), [firstSlot, secondSlot]);
});

test('legacy single-slot batch item remains readable during rollout', () => {
  const legacySlot = { id: 103 };

  assert.deepEqual(getScheduleSlots({ scheduleSlot: legacySlot }), [legacySlot]);
});
