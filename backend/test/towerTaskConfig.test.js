import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_TASK_CONFIG_SEEDS,
  normalizeTaskConfigPayload,
} from '../src/routes/tasks.js';
import {
  clampHistoricalBatchTowerSettings,
  normalizeHistoricalBatchTowerSettings,
} from '../src/routes/batchSettings.js';
import {
  TOWER_DAILY_BATTLE_LIMIT,
  TOWER_DAILY_CRON,
  isHourlyCronExpression,
  isTowerTaskDisabled,
  normalizeTowerCronExpression,
} from '../src/utils/towerTaskConfig.js';

test('tower task defaults run at most ten floors', () => {
  assert.equal(DEFAULT_TASK_CONFIG_SEEDS.TOWER.config.maxFloors, 10);
  assert.equal(DEFAULT_TASK_CONFIG_SEEDS.WEIRD_TOWER.config.weirdTowerMaxFloors, 10);
});

test('tower task config clamps historical values to the 0-10 range', () => {
  assert.equal(normalizeTaskConfigPayload('TOWER', { maxFloors: 99 }).maxFloors, 10);
  assert.equal(normalizeTaskConfigPayload('TOWER', { maxFloors: -3 }).maxFloors, 0);
  assert.equal(normalizeTaskConfigPayload('TOWER', { maxFloors: 0 }).maxFloors, 0);

  assert.equal(
    normalizeTaskConfigPayload('WEIRD_TOWER', { weirdTowerMaxFloors: 88 }).weirdTowerMaxFloors,
    10,
  );
  assert.equal(
    normalizeTaskConfigPayload('WEIRD_TOWER', { maxFloors: 0 }).weirdTowerMaxFloors,
    0,
  );
});

test('batch tower settings expose the historical clamp migration helper', () => {
  assert.equal(typeof clampHistoricalBatchTowerSettings, 'function');
});

test('zero tower floors disables tower task execution', () => {
  assert.equal(isTowerTaskDisabled('TOWER', { maxFloors: 0 }), true);
  assert.equal(isTowerTaskDisabled('WEIRD_TOWER', { weirdTowerMaxFloors: 0 }), true);
  assert.equal(isTowerTaskDisabled('WEIRD_TOWER', { maxFloors: 0 }), true);
  assert.equal(isTowerTaskDisabled('TOWER', { maxFloors: 1 }), false);
  assert.equal(isTowerTaskDisabled('ARENA', {}), false);
});

test('historical batch settings clamp only existing tower floor fields', () => {
  const withoutTowerSettings = { arenaCount: 3 };
  const noChange = normalizeHistoricalBatchTowerSettings(withoutTowerSettings);
  assert.deepEqual(noChange, withoutTowerSettings);

  const withTowerSettings = normalizeHistoricalBatchTowerSettings({
    arenaCount: 3,
    towerMaxFloors: 99,
    weirdTowerMaxFloors: -2,
  });
  assert.deepEqual(withTowerSettings, {
    arenaCount: 3,
    towerMaxFloors: 10,
    weirdTowerMaxFloors: 0,
  });
});

test('tower tasks have a shared daily battle limit and fixed Shanghai schedule', () => {
  assert.equal(TOWER_DAILY_BATTLE_LIMIT, 10);
  assert.equal(TOWER_DAILY_CRON, '20 9 * * *');
  assert.equal(isHourlyCronExpression('0 * * * *'), true);
  assert.equal(isHourlyCronExpression('15 */3 * * *'), true);
  assert.equal(isHourlyCronExpression('20 9 * * *'), false);
  assert.equal(normalizeTowerCronExpression('TOWER', '0 */2 * * *'), TOWER_DAILY_CRON);
  assert.equal(normalizeTowerCronExpression('WEIRD_TOWER', '7 12 * * *'), TOWER_DAILY_CRON);
  assert.equal(normalizeTowerCronExpression('ARENA', '0 */2 * * *'), '0 */2 * * *');
});
