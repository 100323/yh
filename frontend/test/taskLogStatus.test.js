import assert from 'node:assert/strict';
import test from 'node:test';
import { getTaskLogDisplayStatus } from '../src/utils/taskLogStatus.js';

test('missed scheduler logs render as a distinct warning state', () => {
  assert.deepEqual(getTaskLogDisplayStatus({ status: 'missed' }), {
    status: 'missed',
    label: '漏做',
    tone: 'warning',
  });
});

test('known benign task messages remain ignored', () => {
  assert.deepEqual(getTaskLogDisplayStatus({
    status: 'error',
    message: '活动未开放',
  }), {
    status: 'ignored',
    label: '已忽略',
    tone: 'info',
  });
});
