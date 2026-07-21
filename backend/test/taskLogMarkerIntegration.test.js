import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

test('addTaskLog persists missed events without creating execution evidence', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'xyzw-missed-log-'));
  const previousDbPath = process.env.DB_PATH;
  const previousAllowProjectPath = process.env.ALLOW_PROJECT_LOCAL_DB_PATH;
  process.env.DB_PATH = path.join(directory, 'xyzw.db');
  process.env.ALLOW_PROJECT_LOCAL_DB_PATH = '1';

  let database;
  try {
    database = await import('../src/database/index.js');
    await database.initDatabase();
    const db = database.getDatabase();
    db.run("INSERT INTO users (username, password_hash, salt) VALUES ('marker-user', 'hash', 'salt')");
    const accountId = db.run(`
      INSERT INTO game_accounts (user_id, name, token_encrypted, token_iv)
      VALUES (1, 'marker-account', 'token', 'iv')
    `).lastInsertRowid;

    const { addTaskLog } = await import('../src/routes/tasks.js');
    addTaskLog(accountId, 'GENIE_SWEEP', 'missed', '任务漏做：服务重启后已重新入队');

    assert.equal(db.get('SELECT COUNT(*) AS count FROM task_logs').count, 1);
    assert.equal(db.get('SELECT COUNT(*) AS count FROM task_execution_markers').count, 0);

    await database.closeDatabase();
    await database.initDatabase();
    const reopenedDb = database.getDatabase();
    assert.equal(reopenedDb.get('SELECT COUNT(*) AS count FROM task_execution_markers').count, 0);

    addTaskLog(accountId, 'GENIE_SWEEP', 'success', '执行成功');
    assert.equal(reopenedDb.get('SELECT COUNT(*) AS count FROM task_execution_markers').count, 1);
  } finally {
    await database?.closeDatabase?.();
    if (previousDbPath === undefined) delete process.env.DB_PATH;
    else process.env.DB_PATH = previousDbPath;
    if (previousAllowProjectPath === undefined) delete process.env.ALLOW_PROJECT_LOCAL_DB_PATH;
    else process.env.ALLOW_PROJECT_LOCAL_DB_PATH = previousAllowProjectPath;
    await rm(directory, { recursive: true, force: true });
  }
});
