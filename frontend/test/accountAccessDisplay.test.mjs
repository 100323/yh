import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildAccountAccessDisplay } from '../src/utils/accountAccessDisplay.js';

const NOW = new Date('2026-05-12T08:00:00.000Z');

test('shows permanent access when no end time exists', () => {
  const display = buildAccountAccessDisplay({
    username: 'demo',
    is_enabled: true,
    access_end_at: null,
  }, NOW);

  assert.equal(display.headerLabel, '永久有效');
  assert.equal(display.tagType, 'success');
  assert.equal(display.endText, '不限');
});

test('warns when access expires within seven days', () => {
  const display = buildAccountAccessDisplay({
    username: 'demo',
    is_enabled: true,
    access_end_at: '2026-05-15T08:00:00.000Z',
  }, NOW);

  assert.equal(display.headerLabel, '剩余 3 天');
  assert.equal(display.statusText, '剩余 3 天');
  assert.equal(display.tagType, 'warning');
});

test('formats parsed access dates in detail text', () => {
  const display = buildAccountAccessDisplay({
    username: 'demo',
    is_enabled: true,
    access_start_at: '2026-05-01T08:00:00.000Z',
    access_end_at: '2026-06-12T08:00:00.000Z',
  }, NOW);

  assert.notEqual(display.startText, '不限');
  assert.notEqual(display.endText, '不限');
  assert.match(display.startText, /2026/);
  assert.match(display.endText, /2026/);
});

test('marks expired access as unavailable', () => {
  const display = buildAccountAccessDisplay({
    username: 'demo',
    is_enabled: true,
    access_end_at: '2026-05-11T08:00:00.000Z',
  }, NOW);

  assert.equal(display.headerLabel, '已过期');
  assert.equal(display.statusText, '已过期');
  assert.equal(display.tagType, 'danger');
});
