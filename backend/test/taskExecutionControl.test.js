import test from 'node:test';
import assert from 'node:assert/strict';
import { ensureConnectedTaskClient } from '../src/utils/taskExecutionControl.js';

test('keeps an open task client after a queued task acquires its slot', async () => {
  const client = { isSocketOpen: () => true };
  let reconnectCalls = 0;

  const result = await ensureConnectedTaskClient(client, async () => {
    reconnectCalls += 1;
    return { isSocketOpen: () => true };
  });

  assert.equal(result, client);
  assert.equal(reconnectCalls, 0);
});

test('reconnects a closed task client after a queued task acquires its slot', async () => {
  const replacement = { isSocketOpen: () => true };
  let reconnectCalls = 0;

  const result = await ensureConnectedTaskClient(
    { isSocketOpen: () => false },
    async () => {
      reconnectCalls += 1;
      return replacement;
    },
  );

  assert.equal(result, replacement);
  assert.equal(reconnectCalls, 1);
});
