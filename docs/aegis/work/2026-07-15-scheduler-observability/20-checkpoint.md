# TodoCheckpointDraft

更新时间：2026-07-15

## 当前 Todo

1. 纯观测核心、分类与脱敏（已完成）
2. AsyncLocalStorage 上下文与任务包装器（已完成）
3. SQLite 表、批量仓储与 3 天清理（进行中）
4. 观测服务、配置开关与生命周期（待开始）
5. GameClient 命令生命周期接入（待开始）
6. 账户队列、普通调度与批量调度关联（待开始）
7. 管理员只读查询 API（待开始）
8. 前端视图模型与 API 客户端（待开始）
9. 管理员“调度观测”页面和导航（待开始）
10. 负载、故障隔离、保留期与文档验证（待开始）
11. 最终架构复核与上线交接（待开始）

## Active Slice

Task 3：SQLite 表、批量仓储与 3 天清理。开始实现前先寻找本机兼容 Node 运行时，确保真实 `better-sqlite3` 测试可执行。

## Completed Todos

- 已完成设计、中文实施计划和初始架构基线。
- 已创建并验证隔离 worktree `E:\yh-main\.worktrees\scheduler-observability`，分支为 `codex/scheduler-observability`。
- Task 1 已完成 TDD，并通过规格复核与代码质量复核。
- Task 2 已完成 TDD，并通过规格复核与代码质量复核。

## Evidence Refs

- 后端基线：`node --test`，33 项通过。
- 前端基线：`pnpm typecheck` 通过。
- 前端基线：`pnpm build` 通过，仅有既有大 chunk 警告。
- Git 起点：`1651d0d chore: ignore project worktrees`。
- Task 1 最终证据：核心测试 36/36、后端全量 69/69、`git diff --check` 通过。
- Task 1 规格复核：`APPROVED`；代码质量复核：`APPROVED`。
- Task 1 HEAD：`aff45d09d4d5f86f4e45aed85e3e6015e910da85`。
- Task 2 最终证据：核心测试 58/58、默认后端全量 91/91、`git diff --check` 通过。
- Task 2 规格复核：`APPROVED`；代码质量复核：`APPROVED`。
- Task 2 HEAD：`21c0e9e`。

## Blocked On

- 真实 SQLite 集成测试受当前 Node `v24.16.0` 与 `better-sqlite3@11.10.0` 原生绑定限制；机器缺 Visual Studio C++ workload。该限制不阻塞 Task 1/2，但阻塞最终数据库证据闭环。

## ResumeStateHint

从 Task 3 开始。先确认兼容 `better-sqlite3@11.10.0` 的 Node 运行时；随后使用新的实现代理，并依次完成规格与代码质量复核。后续所有修改与测试必须在本 worktree 内执行。

## DriftCheckDraft

- 原始意图：一致，Task 1/2 仍只建立被动观测核心与上下文。
- 兼容边界：未接入运行链路，未修改调度参数或持久化行为。
- 新 owner/fallback/分支：无。
- 退役轨：现有任务日志和 system-status 继续保留。
- 证据充分性：Task 2 双复核通过；Task 3 需先解决/外置 SQLite ABI 验证条件。
- decision：`continue`。

## Next

检查本机可用 Node 运行时与 `better-sqlite3` 绑定，再决定 Task 3 的可执行验证命令。
