// 错峰 + 方向A 改造效果对比：采集一份快照并打印关键指标
// 用法: node gather_snapshot.js <label>      例: node gather_snapshot.js before
// label 用于文件名区分（before / after / 任意）
const path = require('path');
const fs = require('fs');
const Database = require(path.join(__dirname, 'node_modules', 'better-sqlite3'));

const label = (process.argv[2] || 'snapshot').replace(/[^a-zA-Z0-9_-]/g, '');
const dbPath = path.join(__dirname, 'data', 'xyzw.db');
const db = new Database(dbPath, { readonly: true, timeout: 15000 });

const TARGET_TASKS = [
  'LEGION_BOSS', 'TOWER', 'STUDY', 'WEIRD_TOWER',
  'WEIRD_TOWER_FREE_ITEM', 'WEIRD_TOWER_USE_ITEM', 'WEIRD_TOWER_MERGE_ITEM',
];

const out = {
  label,
  capturedAtUtc: new Date().toISOString(),
  capturedAtLocal: new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }),
};

const safe = (fn, fallback) => { try { return fn(); } catch (e) { return { error: String(e.message) }; } };

// ---------- 1. 今日实际执行量：按小时（本地时区 UTC+8） ----------
out.execByHourToday = safe(() =>
  db.prepare(
    `SELECT strftime('%H', executed_at, '+8 hours') AS hh, COUNT(*) AS c
     FROM task_execution_markers
     WHERE date(executed_at, '+8 hours') = date('now', '+8 hours')
     GROUP BY hh ORDER BY hh`
  ).all()
);

// ---------- 2. 错峰任务的 cron 分布 + 自定义保护情况 ----------
out.cronDistribution = safe(() =>
  db.prepare(
    `SELECT task_type, cron_expression, COUNT(*) AS c, COALESCE(SUM(cron_is_customized),0) AS customized
     FROM task_configs
     WHERE task_type IN (${TARGET_TASKS.map(() => '?').join(',')})
     GROUP BY task_type, cron_expression ORDER BY task_type, c DESC`
  ).all(...TARGET_TASKS)
);

// ---------- 3. 任务时长/排队指标（今日，每分钟聚合表） ----------
out.taskMetricToday = safe(() =>
  db.prepare(
    `SELECT task_type,
            SUM(run_count)          AS runs,
            SUM(queue_wait_count)   AS queueEvents,
            ROUND(AVG(queue_wait_max_ms))  AS avgQueueWaitMaxMs,
            MAX(queue_wait_max_ms)  AS maxQueueWaitMs,
            ROUND(AVG(duration_max_ms))    AS avgDurMaxMs,
            MAX(duration_max_ms)    AS maxDurMs
     FROM task_metric_minutes
     WHERE date(bucket_minute, '+8 hours') = date('now', '+8 hours')
     GROUP BY task_type ORDER BY runs DESC LIMIT 40`
  ).all()
);

// ---------- 4. 命令层指标：慢命令/错误/超时（今日） ----------
out.commandMetricToday = safe(() =>
  db.prepare(
    `SELECT command_class, outcome,
            SUM(command_count) AS cmds,
            SUM(error_count) AS errs,
            SUM(timeout_count) AS timeouts,
            SUM(disconnected_count) AS disconnects,
            SUM(rate_limited_count) AS rateLimited,
            SUM(slow_count) AS slows,
            ROUND(AVG(latency_max_ms)) AS avgLatMaxMs,
            MAX(latency_max_ms) AS maxLatMs
     FROM command_metric_minutes
     WHERE date(bucket_minute, '+8 hours') = date('now', '+8 hours')
     GROUP BY command_class, outcome ORDER BY cmds DESC LIMIT 40`
  ).all()
);

// ---------- 5. 异常分布（今日） ----------
out.anomaliesToday = safe(() =>
  db.prepare(
    `SELECT category, command, COUNT(*) AS c
     FROM command_anomalies
     WHERE date(occurred_at, '+8 hours') = date('now', '+8 hours')
     GROUP BY category, command ORDER BY c DESC LIMIT 30`
  ).all()
);

// ---------- 6. WebSocket 连接：今日新建数 / 当前活跃数 ----------
out.wsConnections = safe(() => ({
  todayCreated: db.prepare(
    `SELECT COUNT(*) AS c FROM ws_connections
     WHERE date(connected_at, '+8 hours') = date('now', '+8 hours')`
  ).get().c,
  total: db.prepare(`SELECT COUNT(*) AS c FROM ws_connections`).get().c,
  byStatus: db.prepare(
    `SELECT status, COUNT(*) AS c FROM ws_connections GROUP BY status ORDER BY c DESC`
  ).all(),
}));

// ---------- 7. 规模 ----------
out.scale = safe(() => ({
  accounts: db.prepare(`SELECT COUNT(*) AS c FROM game_accounts`).get().c,
  users: db.prepare(`SELECT COUNT(*) AS c FROM users`).get().c,
  enabledTaskConfigs: db.prepare(
    `SELECT COUNT(*) AS c FROM task_configs WHERE COALESCE(enabled,1)=1`
  ).get().c || null,
}));

// ---------- 8. 指定用户（45）的账号今日任务明细 ----------
const USER_ID = 45;
out.userAccounts = safe(() => {
  const accts = db
    .prepare(`SELECT id, name, remark FROM game_accounts WHERE user_id = ? ORDER BY id`)
    .all(USER_ID);
  return accts.map((a) => {
    const perTask = {};
    for (const t of TARGET_TASKS) {
      const r = db.prepare(
        `SELECT COUNT(*) AS n,
                MIN(strftime('%H:%M', executed_at, '+8 hours')) AS firstAt,
                MAX(strftime('%H:%M', executed_at, '+8 hours')) AS lastAt
         FROM task_execution_markers
         WHERE account_id = ? AND task_type = ?
           AND date(executed_at, '+8 hours') = date('now', '+8 hours')`
      ).get(a.id, t);
      perTask[t] = r.n ? { n: r.n, first: r.firstAt, last: r.lastAt } : 0;
    }
    const total = db.prepare(
      `SELECT COUNT(*) AS n,
              MIN(strftime('%H:%M', executed_at, '+8 hours')) AS firstAt,
              MAX(strftime('%H:%M', executed_at, '+8 hours')) AS lastAt
       FROM task_execution_markers
       WHERE account_id = ? AND date(executed_at, '+8 hours') = date('now', '+8 hours')`
    ).get(a.id);
    const running = db.prepare(
      `SELECT task_type, latest_status, strftime('%H:%M', updated_at, '+8 hours') AS at
       FROM task_execution_markers WHERE account_id = ?
         AND date(updated_at, '+8 hours') = date('now', '+8 hours')
         AND latest_status NOT IN ('success','completed','done')
       ORDER BY updated_at DESC LIMIT 10`
    ).all(a.id);
    return { id: a.id, name: a.name, remark: a.remark, todayTotal: total, perTask, unfinished: running };
  });
});

// ---------- 9. 延迟分布：计划 vs 实际（近 24h，按计划小时看实际执行散落） ----------
out.delayBuckets = safe(() =>
  db.prepare(
    `SELECT strftime('%H', executed_at, '+8 hours') AS execHour, COUNT(*) AS c
     FROM task_execution_markers
     WHERE executed_at >= datetime('now', '-24 hours')
     GROUP BY execHour ORDER BY execHour`
  ).all()
);

const outFile = path.join(__dirname, 'data', `snapshot-${label}-${Date.now()}.json`);
fs.writeFileSync(outFile, JSON.stringify(out, null, 2));

console.log('=== SNAPSHOT ' + label + ' ===');
console.log('file: ' + outFile);
console.log('time: ' + out.capturedAtLocal);
console.log('\n--- 今日各小时执行量 ---');
console.log(JSON.stringify(out.execByHourToday));
console.log('\n--- 错峰任务 cron 分布 ---');
if (Array.isArray(out.cronDistribution)) {
  for (const r of out.cronDistribution) {
    console.log('  ' + String(r.task_type).padEnd(24) + String(r.cron_expression).padEnd(16) + 'n=' + String(r.c).padEnd(5) + 'custom=' + r.customized);
  }
}
console.log('\n--- WebSocket 连接 ---');
console.log(JSON.stringify(out.wsConnections));
console.log('\n--- 规模 ---');
console.log(JSON.stringify(out.scale));
console.log('\n--- 用户45 账号今日汇总 ---');
if (Array.isArray(out.userAccounts)) {
  for (const a of out.userAccounts) {
    const t = a.todayTotal || {};
    console.log('  #' + a.id + ' ' + (a.remark || a.name) + ' | 今日共 ' + t.n + ' 条 | 首次 ' + t.firstAt + ' | 末次 ' + t.lastAt + ' | 未完成 ' + (a.unfinished || []).length);
  }
}
db.close();
