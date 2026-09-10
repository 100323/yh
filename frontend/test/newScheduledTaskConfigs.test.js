import test from 'node:test';
import assert from 'node:assert/strict';
import {
  availableTasks,
  defaultTaskConfigs,
  scheduledTaskBackendTypeMap,
  scheduledTaskFrontendTypeMap,
  taskConfigDefinitions,
} from '../src/utils/batch/constants.js';

const expectedTasks = [
  {
    key: 'legionSignup',
    label: '盐场报名',
    group: 'dungeon',
    weekdays: [6],
    hour: 16,
    minute: 0,
    enabled: false,
  },
  {
    key: 'legionPayloadSignup',
    label: '蟠桃报名',
    group: 'dungeon',
    weekdays: [0],
    hour: 16,
    minute: 0,
    enabled: false,
  },
  {
    key: 'genieDeepSeaSweep',
    label: '深海扫荡',
    group: 'resource',
    weekdays: [1],
    hour: 0,
    minute: 1,
    enabled: true,
  },
  {
    key: 'clubSignup',
    label: '营地篝火报名',
    group: 'dungeon',
    weekdays: [0],
    hour: 22,
    minute: 0,
    enabled: false,
  },
];

test('exposes the new weekly task configs with fixed default schedules', () => {
  for (const expected of expectedTasks) {
    const definition = taskConfigDefinitions[expected.key];
    assert.equal(definition.label, expected.label);
    assert.equal(definition.group, expected.group);

    const task = defaultTaskConfigs[expected.key];
    assert.equal(task.enabled, expected.enabled);
    assert.equal(task.scheduleType, 'weekly');
    assert.deepEqual(task.weekdays, expected.weekdays);

    const runTime = new Date(task.runTime);
    assert.equal(runTime.getHours(), expected.hour);
    assert.equal(runTime.getMinutes(), expected.minute);

    assert.equal(
      availableTasks.some((item) => item.value === expected.key),
      true,
    );
  }
});

test('maps new weekly task keys for backend scheduled task APIs', () => {
  const expectedBackendTypes = new Set(expectedTasks.map((task) => task.key));
  const reverseScheduledTaskMap = Object.fromEntries(
    Object.entries(scheduledTaskBackendTypeMap).map(([key, backendType]) => [
      backendType,
      scheduledTaskFrontendTypeMap[backendType],
    ]),
  );

  assert.deepEqual(
    new Set(Object.keys(scheduledTaskBackendTypeMap)),
    expectedBackendTypes,
  );
  assert.deepEqual(
    reverseScheduledTaskMap,
    scheduledTaskFrontendTypeMap,
  );
  assert.equal(scheduledTaskBackendTypeMap.genieDeepSeaSweep, 'GENIE_SWEEP_DEEP_SEA');
});
