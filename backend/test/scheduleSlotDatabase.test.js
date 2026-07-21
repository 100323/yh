import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

test('database initialization creates the scheduler slot ledger and maintenance keeps three days', async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'xyzw-schedule-slots-'));
  const dbPath = path.join(directory, 'xyzw.db');
  const previousDbPath = process.env.DB_PATH;
  const previousAllowProjectPath = process.env.ALLOW_PROJECT_LOCAL_DB_PATH;
  process.env.DB_PATH = dbPath;
  process.env.ALLOW_PROJECT_LOCAL_DB_PATH = '1';
  let database = null;

  try {
    database = await import(`../src/database/index.js?slots=${Date.now()}`);
    await database.initDatabase();
    const db = database.getDatabase();

    assert.deepEqual(
      db.get("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'scheduler_task_slots'"),
      { name: 'scheduler_task_slots' },
    );
    db.run(`
      INSERT INTO scheduler_task_slots (
        task_config_id, account_id, task_type, scheduled_at, source, instance_id, status
      ) VALUES (1, 1, 'GENIE_SWEEP', '2020-01-01T00:00:00.000Z', 'scheduler', 'boot-a', 'queued')
    `);

    await database.runDatabaseMaintenance();

    assert.equal(db.get('SELECT COUNT(*) AS count FROM scheduler_task_slots').count, 0);
    await database.closeDatabase();
  } finally {
    await database?.closeDatabase?.();
    if (previousDbPath === undefined) delete process.env.DB_PATH;
    else process.env.DB_PATH = previousDbPath;
    if (previousAllowProjectPath === undefined) delete process.env.ALLOW_PROJECT_LOCAL_DB_PATH;
    else process.env.ALLOW_PROJECT_LOCAL_DB_PATH = previousAllowProjectPath;
    await rm(directory, { recursive: true, force: true });
  }
});
