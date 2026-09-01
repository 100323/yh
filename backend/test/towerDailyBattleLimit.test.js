import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import {
  getShanghaiBusinessDate,
  getTowerBattleUsage,
  releaseTowerBattleSlot,
  reserveTowerBattleSlot,
} from '../src/database/index.js';
import scheduler from '../src/scheduler/index.js';
import batchScheduler from '../src/batchScheduler/index.js';

function createUsageDb() {
  const database = new Database(':memory:');
  database.exec(`
    CREATE TABLE tower_battle_daily_usage (
      account_id INTEGER NOT NULL,
      task_type TEXT NOT NULL,
      business_date TEXT NOT NULL,
      reserved_count INTEGER NOT NULL DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(account_id, task_type, business_date)
    )
  `);
  return {
    run: (sql, params = []) => database.prepare(sql).run(...params),
    get: (sql, params = []) => database.prepare(sql).get(...params) || null,
    all: (sql, params = []) => database.prepare(sql).all(...params),
    close: () => database.close(),
  };
}

test('tower usage is isolated by account, task type, and Shanghai business date', () => {
  const db = createUsageDb();
  try {
    const beforeShanghaiMidnight = new Date('2026-08-31T15:59:59.000Z');
    const afterShanghaiMidnight = new Date('2026-08-31T16:00:00.000Z');
    assert.equal(getShanghaiBusinessDate(beforeShanghaiMidnight), '2026-08-31');
    assert.equal(getShanghaiBusinessDate(afterShanghaiMidnight), '2026-09-01');

    for (let i = 0; i < 10; i += 1) {
      assert.equal(reserveTowerBattleSlot(1, 'TOWER', '2026-08-31', db), true);
    }
    assert.equal(reserveTowerBattleSlot(1, 'TOWER', '2026-08-31', db), false);
    assert.equal(reserveTowerBattleSlot(2, 'TOWER', '2026-08-31', db), true);
    assert.equal(reserveTowerBattleSlot(1, 'WEIRD_TOWER', '2026-08-31', db), true);
    assert.equal(reserveTowerBattleSlot(1, 'TOWER', '2026-09-01', db), true);
    assert.equal(getTowerBattleUsage(1, 'TOWER', '2026-08-31', db), 10);

    releaseTowerBattleSlot(1, 'TOWER', '2026-08-31', db);
    assert.equal(getTowerBattleUsage(1, 'TOWER', '2026-08-31', db), 9);
    assert.equal(reserveTowerBattleSlot(1, 'TOWER', '2026-08-31', db), true);
  } finally {
    db.close();
  }
});

function createTowerClient({ weird = false, fightFailures = 0 } = {}) {
  let energy = 20;
  let failuresLeft = fightFailures;
  const calls = [];
  const client = {
    calls,
    ensureBattleVersion: async () => {},
    getRoleInfo: async () => ({ role: { tower: { id: 10 } } }),
    claimTowerReward: async () => {},
    startTowerFight: async () => {
      calls.push('tower-fight');
      if (failuresLeft > 0) {
        failuresLeft -= 1;
        throw new Error('temporary fight failure');
      }
      return { ok: true };
    },
    sendWithPromise: async (command) => {
      calls.push(command);
      if (command === 'evotower_getinfo') {
        const current = energy;
        energy -= 1;
        return { evoTower: { energy: current, towerId: 10, taskClaimMap: {} } };
      }
      if (command === 'evotower_fight') {
        if (failuresLeft > 0) {
          failuresLeft -= 1;
          throw new Error('temporary fight failure');
        }
        return { winList: [true] };
      }
      return {};
    },
  };
  return client;
}

async function runTower(core, client, taskType, extraContext = {}) {
  const reserveCalls = [];
  const releasedCalls = [];
  let allowed = 1;
  const result = await core(client, taskType === 'TOWER'
    ? { maxFloors: 10 }
    : { weirdTowerMaxFloors: 10 }, {
    accountId: 100,
    reserveTowerBattleSlot: async (...args) => {
      reserveCalls.push(args);
      if (allowed <= 0) return false;
      allowed -= 1;
      return true;
    },
    releaseTowerBattleSlot: async (...args) => releasedCalls.push(args),
    sleep: async () => {},
    ...extraContext,
  });
  return { result, reserveCalls, releasedCalls };
}

test('ordinary scheduler uses the smaller of configured floors and daily remaining battles', async () => {
  const client = createTowerClient();
  const { result, reserveCalls } = await runTower(
    scheduler.__testing.executeTowerCore,
    client,
    'TOWER',
  );
  assert.equal(client.calls.filter((item) => item === 'tower-fight').length, 1);
  assert.equal(reserveCalls.length, 2);
  assert.equal(result.data.successCount, 1);
});
test('ordinary scheduler releases a slot when the fight request fails', async () => {
  const client = createTowerClient({ fightFailures: 1 });
  let reservations = 0;
  let releases = 0;
  const result = await scheduler.__testing.executeTowerCore(client, { maxFloors: 2 }, {
    accountId: 100,
    reserveTowerBattleSlot: async () => {
      reservations += 1;
      return true;
    },
    releaseTowerBattleSlot: async () => {
      releases += 1;
    },
    sleep: async () => {},
  });
  assert.equal(reservations, 2);
  assert.equal(releases, 1);
  assert.equal(result.data.successCount, 1);
});

test('batch scheduler applies the same daily limit to weird tower', async () => {
  const client = createTowerClient({ weird: true });
  const { result, reserveCalls } = await runTower(
    batchScheduler.__testing.executeWeirdTowerCore,
    client,
    'WEIRD_TOWER',
  );
  assert.equal(client.calls.filter((item) => item === 'evotower_fight').length, 1);
  assert.equal(reserveCalls.length, 2);
  assert.equal(result.data.successCount, 1);
});
