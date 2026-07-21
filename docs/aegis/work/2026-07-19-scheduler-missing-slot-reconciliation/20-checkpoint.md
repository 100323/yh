# TodoCheckpointDraft

当前 Todo：

1. 直接验证 node-cron 跨秒漏触发（已完成）。
2. 写时间槽位失败测试并实现（已完成）。
3. 写 778 同分钟、去重、latest-only、started 不重放失败测试并实现（已完成）。
4. 增加首次启用水位、配置创建时间保护、跨上海日界线和 60 分钟回看上限（已完成）。
5. 增加前端中文来源映射（已完成）。
6. 全量验证、独立审查、备份部署与线上验证（已完成）。

Active Slice：完成。线上 health、scheduler、数据库水位、重复槽位和前端产物均已验证。

Evidence：服务器 Node 22 后端串行 213/213，前端 20/20，typecheck、生产构建、`git diff --check` 通过；独立复核 APPROVED。部署备份 `/home/ubuntu/zy-backups/scheduler-reconcile-20260719_091814`。线上启用配置 3308，activation 已持久化，水位前对账槽位 0，重复槽位 0。

ResumeStateHint：实现已发布；接下来观察未来高峰分钟的 `scheduler-reconcile` 槽位和“应到 vs 实际”覆盖率，不得用今天水位前历史缺口判断新功能失效。

DriftCheckDraft：仍只服务于普通 scheduler 静默漏做；批量 scheduler、业务命令、并发、错峰、重试、重连和代理均未改变。旧每任务 cron 暂留快速路径，3 天观察后再退休。Decision：complete candidate。
