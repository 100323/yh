# TodoCheckpointDraft

更新时间：2026-07-15

## 当前 Todo

1. 纯观测核心、分类与脱敏（进行中）
2. AsyncLocalStorage 上下文与任务包装器（待开始）
3. SQLite 表、批量仓储与 3 天清理（待开始）
4. 观测服务、配置开关与生命周期（待开始）
5. GameClient 命令生命周期接入（待开始）
6. 账户队列、普通调度与批量调度关联（待开始）
7. 管理员只读查询 API（待开始）
8. 前端视图模型与 API 客户端（待开始）
9. 管理员“调度观测”页面和导航（待开始）
10. 负载、故障隔离、保留期与文档验证（待开始）
11. 最终架构复核与上线交接（待开始）

## Active Slice

Task 1：纯观测核心、分类与脱敏。该切片不依赖 SQLite，可在当前 Node 24 环境执行完整 TDD。

## Completed Todos

- 已完成设计、中文实施计划和初始架构基线。
- 已创建并验证隔离 worktree `E:\yh-main\.worktrees\scheduler-observability`，分支为 `codex/scheduler-observability`。

## Evidence Refs

- 后端基线：`node --test`，33 项通过。
- 前端基线：`pnpm typecheck` 通过。
- 前端基线：`pnpm build` 通过，仅有既有大 chunk 警告。
- Git 起点：`1651d0d chore: ignore project worktrees`。

## Blocked On

- 真实 SQLite 集成测试受当前 Node `v24.16.0` 与 `better-sqlite3@11.10.0` 原生绑定限制；机器缺 Visual Studio C++ workload。该限制不阻塞 Task 1/2，但阻塞最终数据库证据闭环。

## ResumeStateHint

从 Task 1 开始。每项任务使用一个新实现代理，完成后按顺序进行规格复核和代码质量复核；两阶段问题全部关闭后才更新本检查点并进入下一项。后续所有修改与测试必须在本 worktree 内执行。

## DriftCheckDraft

- 原始意图：一致，仍只做被动观测。
- 兼容边界：尚未修改运行链路。
- 新 owner/fallback/分支：无。
- 退役轨：现有任务日志和 system-status 继续保留。
- 证据充分性：足够开始不依赖 SQLite 的 Task 1。
- decision：`continue`。

## Next

派发 Task 1 实现代理，要求记录 RED 和 GREEN 证据并提交计划内两个文件。
