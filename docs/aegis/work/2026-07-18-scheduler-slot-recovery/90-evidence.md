# Evidence

## Root cause

- 正常 cron 命中后只进入 `pendingAccountTaskBatches` 内存队列。
- PM2 在错峰窗口重启时，未开始的定时器和批次项会消失。
- 原 `task_logs` 仅在真实任务结算后写入，因此未进入执行层的漏做没有前端记录。

## Repair evidence

- `scheduler_task_slots` 以 `(task_config_id, scheduled_at)` 唯一，状态覆盖 queued、started 与结算结果。
- 新实例与每分钟检查只恢复旧实例 queued；started 结算为中断错误并写 missed，不自动重放。
- 恢复分批循环直到旧 queued 清空，覆盖 3500+ 任务规模；日志异常不会阻止重新入队。
- 同批次合并任务保留全部槽位并一起开始、结算。
- `missed` 日志在实时写入和数据库启动回填时均不生成 execution marker。
- 管理员 `/api/stats/observability/slots` 只返回聚合计数，前端集中显示等待执行、重启恢复、中断未重放、配置不可用。
- 槽位与调度观测数据最多保留 3 天。

## Verification

- 后端 Node 22 串行全量测试 198/198 通过。
- 前端 Node 22 全量测试 20/20 通过。
- 前端 TypeScript `--noEmit` 通过。
- Vite production build 通过；仅存在项目原有的大 chunk 警告。
- `git diff --check` 通过。
- 独立审查发现的 marker 回填、500 条上限、started 无日志、每分钟补扫和集中摘要问题均已修复并新增回归覆盖。

## Deployment

- 部署前备份：`/home/ubuntu/zy-backups/scheduler-slot-20260718_130448`。
- 备份包含原后端源码、原前端 dist、SQLite 一致性备份及 SHA256 校验文件。
- 线上验证：PM2 进程存活，`/api/health` 为 ok，database/scheduler 为 ready。
- `scheduler_task_slots` 与 `requeued_at` 已初始化；前端构建包含“漏做保护”；备份 SHA256 校验通过。
