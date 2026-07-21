# EvidenceBundleDraft

## Root-cause evidence

- 线上 3308 个启用配置全部完成注册，无重复 `(account_id, task_type)` 配置。
- 2026-07-19 截至 08:48，无槽位缺口 1052；00:00 缺 592、06:00 缺 82、07:00 缺 64、08:00 缺 313，低并发分钟接近零缺口。
- 缺失任务没有 slot、marker、task_log，证明断点位于 cron callback 之前。
- `backend/node_modules/node-cron/src/scheduler.js` 仅在 `i === 0 || autorecover` 时检查错过秒；项目每任务 job 只传 `timezone`。
- 本地直接复现：事件循环阻塞 2400ms 后，关闭错过恢复命中 0 次，开启命中 1 次。

## Not loaded

- 未加载 Token、JWT、API Key、PM2 环境变量或游戏响应正文。
- 未读取与 2026-07-19 漏调度无关的大型历史日志。

## Next evidence

- 未来 3 天高峰分钟按小时应到槽位与实际槽位对比。

## Verification evidence

- 依赖直接复现：阻塞 2400ms 后，`recoverMissedExecutions=false` 命中 0，`true` 命中 1。
- 目标 RED/GREEN：上海时区、跨日/月界线、60 分钟上限、778 同分钟、唯一键、`started` 不重放、latest-only、`created_at` 和 activation watermark 均覆盖。
- 服务器 Node 22 隔离目录：`node --test --test-concurrency=1 test/*.test.js` → 213/213。
- 前端：`node --test test/*.test.js` → 20/20；TypeScript 和 Vite production build exit 0。
- 独立代码复核：APPROVED，Critical/Important 均关闭。
- 线上：health `ok`；database/scheduler/batchScheduler `ready`；3308 个任务完成注册；PM2 online，unstable restarts 0。
- 数据库：activation `2026-07-19T01:18:38.928Z`；`scheduler-reconcile` 水位前槽位 0；重复 `(task_config_id, scheduled_at)` 槽位 0。
- 备份：`/home/ubuntu/zy-backups/scheduler-reconcile-20260719_091814`，包含 scheduler、frontend dist、SQLite 一致性备份和校验值。
