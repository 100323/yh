# TodoCheckpointDraft

当前 Todo：
1. 槽位账本 repository 与 3 天清理（已完成）。
2. 普通 cron 入队、批次开始/结算、新进程恢复与每分钟补扫（已完成）。
3. 漏做/恢复日志、执行标记隔离与管理员槽位摘要 API（已完成）。
4. 前端中文映射、来源说明、漏做状态和集中摘要（已完成）。
5. 全量回归、独立审查、服务器备份、部署与线上验证（已完成）。

Active Slice：完成。线上健康、schema、前端资源与备份校验和均已验证。

Evidence：Node 22 后端串行全量、前端全量、typecheck、生产构建与目标集成测试均通过。恢复可分页处理超过 500 个槽位；旧实例 `started` 只告警不重放；`missed` 在实时写入和数据库回填时都不会成为 execution marker。

DriftCheckDraft：仍只增强普通调度器恢复和观测；未改变并发、错峰、延迟、任务顺序、重试、重连、代理或业务任务步骤。Decision：`complete`。
