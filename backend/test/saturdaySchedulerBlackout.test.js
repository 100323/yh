import test from 'node:test';
import assert from 'node:assert/strict';

async function loadBlackoutModule() {
  try {
    return await import('../src/utils/saturdaySchedulerBlackout.js');
  } catch {
    return {};
  }
}

test('classifies the Saturday Shanghai blackout boundaries', async () => {
  const { isSaturdaySchedulerBlackout } = await loadBlackoutModule();

  assert.equal(typeof isSaturdaySchedulerBlackout, 'function');
  assert.equal(isSaturdaySchedulerBlackout(new Date('2026-08-08T11:59:59.000Z')), false);
  assert.equal(isSaturdaySchedulerBlackout(new Date('2026-08-08T12:00:00.000Z')), true);
  assert.equal(isSaturdaySchedulerBlackout(new Date('2026-08-08T12:59:59.000Z')), true);
  assert.equal(isSaturdaySchedulerBlackout(new Date('2026-08-08T13:00:00.000Z')), false);
  assert.equal(isSaturdaySchedulerBlackout(new Date('2026-08-09T12:30:00.000Z')), false);
});

test('defaults the Saturday blackout policy to enabled', async () => {
  const { normalizeSaturdaySchedulerPolicy } = await loadBlackoutModule();

  assert.equal(typeof normalizeSaturdaySchedulerPolicy, 'function');
  assert.deepEqual(normalizeSaturdaySchedulerPolicy(), { saturdayBlackoutEnabled: true });
  assert.deepEqual(normalizeSaturdaySchedulerPolicy({ saturday_blackout_enabled: 0 }), {
    saturdayBlackoutEnabled: false,
  });
});

test('builds an idempotent deferred-run identity and stable replay order', async () => {
  const {
    buildDeferredRunIdentity,
    sortDeferredRuns,
  } = await loadBlackoutModule();

  assert.equal(typeof buildDeferredRunIdentity, 'function');
  assert.equal(typeof sortDeferredRuns, 'function');

  const firstIdentity = buildDeferredRunIdentity({
    businessDate: '2026-08-08',
    source: 'scheduler',
    taskConfigId: 12,
    plannedAt: '2026-08-08 20:05:00',
  });
  const secondIdentity = buildDeferredRunIdentity({
    businessDate: '2026-08-08',
    source: 'scheduler',
    taskConfigId: 12,
    plannedAt: '2026-08-08 20:05:00',
  });

  assert.equal(firstIdentity, secondIdentity);
  assert.deepEqual(
    sortDeferredRuns([
      { id: 4, planned_at: '2026-08-08 20:30:00' },
      { id: 3, planned_at: '2026-08-08 20:05:00' },
      { id: 2, planned_at: '2026-08-08 20:05:00' },
    ]).map((item) => item.id),
    [2, 3, 4],
  );
});

test('defers only automatic work for enabled users during the blackout', async () => {
  const { shouldDeferAutomaticExecution } = await loadBlackoutModule();

  assert.equal(typeof shouldDeferAutomaticExecution, 'function');
  const now = new Date('2026-08-08T12:15:00.000Z');

  assert.equal(
    shouldDeferAutomaticExecution({ source: 'scheduler', policy: {}, now }),
    true,
  );
  assert.equal(
    shouldDeferAutomaticExecution({ source: 'scheduler-catchup', policy: {}, now }),
    true,
  );
  assert.equal(
    shouldDeferAutomaticExecution({ source: 'batch', policy: {}, now }),
    true,
  );
  assert.equal(
    shouldDeferAutomaticExecution({ source: 'manual', policy: {}, now }),
    false,
  );
  assert.equal(
    shouldDeferAutomaticExecution({ source: 'scheduler', policy: { saturdayBlackoutEnabled: false }, now }),
    false,
  );
});

test('calculates the Saturday 21:00 Shanghai release time', async () => {
  const { getSaturdayBlackoutReleaseAt } = await loadBlackoutModule();

  assert.equal(typeof getSaturdayBlackoutReleaseAt, 'function');
  assert.equal(
    getSaturdayBlackoutReleaseAt(new Date('2026-08-08T12:15:00.000Z')).toISOString(),
    '2026-08-08T13:00:00.000Z',
  );
});

test('calculates the remaining Saturday blackout delay', async () => {
  const { getSaturdayBlackoutDelayMs } = await loadBlackoutModule();

  assert.equal(typeof getSaturdayBlackoutDelayMs, 'function');
  assert.equal(getSaturdayBlackoutDelayMs(new Date('2026-08-08T11:59:59.000Z')), 0);
  assert.equal(getSaturdayBlackoutDelayMs(new Date('2026-08-08T12:00:00.000Z')), 3_600_000);
  assert.equal(getSaturdayBlackoutDelayMs(new Date('2026-08-08T12:45:00.000Z')), 900_000);
  assert.equal(getSaturdayBlackoutDelayMs(new Date('2026-08-08T13:00:00.000Z')), 0);
  assert.equal(getSaturdayBlackoutDelayMs(new Date('2026-08-09T12:30:00.000Z')), 0);
});

test('expires an abandoned replay claim before retrying it', async () => {
  const {
    DEFERRED_RUN_CLAIM_LEASE_MS,
    getDeferredRunClaimExpiresAt,
  } = await loadBlackoutModule();

  assert.equal(typeof DEFERRED_RUN_CLAIM_LEASE_MS, 'number');
  assert.equal(typeof getDeferredRunClaimExpiresAt, 'function');
  assert.equal(
    getDeferredRunClaimExpiresAt(new Date('2026-08-08T13:00:00.000Z')).toISOString(),
    '2026-08-08T13:15:00.000Z',
  );
});
