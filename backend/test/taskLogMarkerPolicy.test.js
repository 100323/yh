import assert from 'node:assert/strict';
import test from 'node:test';
import { shouldRecordTaskExecutionMarker } from '../src/utils/taskLogMarkerPolicy.js';

test('missed observation logs do not count as task execution markers', () => {
  assert.equal(shouldRecordTaskExecutionMarker('missed'), false);
});

test('actual task outcomes continue to update execution markers', () => {
  for (const status of ['success', 'error', 'ignored', 'info']) {
    assert.equal(shouldRecordTaskExecutionMarker(status), true);
  }
});
