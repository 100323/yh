# TodoCheckpointDraft

更新时间：2026-07-16

## 当前 Todo

1. 纯观测核心、分类与脱敏（已完成）
2. AsyncLocalStorage 上下文与任务包装器（已完成）
3. SQLite 表、批量仓储与 3 天清理（已完成）
4. 观测服务、配置开关与生命周期（已完成）
5. GameClient 命令生命周期接入（已完成）
6. 账户队列、普通调度与批量调度关联（已完成）
7. 管理员只读查询 API（已完成）
8. 前端视图模型与 API 客户端（已完成）
9. 管理员“调度观测”页面和导航（已完成）
10. 负载、故障隔离、保留期与文档验证（进行中）
11. 最终架构复核与上线交接（待开始）

## Active Slice

Task 10：负载、故障隔离、保留期与文档验证。增加 10 万确定性事件与真实 SQLite 保留测试，并补充上线观察和回滚说明。

## Completed Todos

- 已完成设计、中文实施计划和初始架构基线。
- 已创建并验证隔离 worktree `E:\yh-main\.worktrees\scheduler-observability`，分支为 `codex/scheduler-observability`。
- Task 1 已完成 TDD，并通过规格复核与代码质量复核。
- Task 2 已完成 TDD，并通过规格复核与代码质量复核。
- Task 3 已完成真实 SQLite TDD，并通过规格复核与代码质量复核。
- Task 4 已完成服务生命周期 TDD，并通过规格复核与代码质量复核。
- Task 5 已完成 GameClient 传输边界 TDD，并通过规格复核与代码质量复核。
- Task 6 已完成调度上下文与队列关联 TDD，并通过规格复核与代码质量复核。
- Task 7 已完成管理员 API TDD，并通过规格复核与代码质量复核。
- Task 8 已完成前端纯视图模型/API TDD，并通过规格复核与代码质量复核。
- Task 9 已完成管理员页面、路由和同源菜单，并通过规格复核与代码质量复核。

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
- Task 3 最终证据：仓储测试 16/16、Node 22 串行后端全量 107/107、`git diff --check` 通过。
- Task 3 规格复核：`APPROVED`；代码质量复核：`APPROVED`。
- Task 3 HEAD：`017dda274b15baf8d89407589e87130d09ff24d8`。
- Task 4 最终证据：服务测试 25/25、Node 22 串行后端全量 132/132、`git diff --check` 通过。
- Task 4 规格复核：`APPROVED`；代码质量复核：`APPROVED`。
- Task 4 HEAD：`da2dffe8f3781e349425641e77c01078b44442f6`。
- Task 5 最终证据：目标测试 18/18、Node 22 串行全量 142/142、`git diff --check` 通过。
- Task 5 规格复核：`APPROVED`；代码质量复核：`APPROVED`。
- Task 5 HEAD：`e78c4a9ebfff26acfeb544fa311828da1062f3a2`。
- Task 6 最终证据：目标/控制 15/15、相关 95/95、Node 22 串行全量 153/153、`git diff --check` 通过。
- Task 6 规格复核：`APPROVED`；代码质量复核：`APPROVED`。
- Task 6 HEAD：`6114a2846274434ad9b168c78290276fc3e6b71b`。
- Task 7 最终证据：目标 12/12、Node 22 串行后端全量 165/165、真实 HTTP 401/403/200、`git diff --check` 通过。
- Task 7 规格复核：`APPROVED`；代码质量复核：`APPROVED`。
- Task 7 HEAD：`42d51852fd50a258046d1eba867b41867bea1cc3`。
- Task 8 最终证据：目标 10/10、typecheck/build 通过、`git diff --check` 通过。
- Task 8 规格复核：`APPROVED`；代码质量复核：`APPROVED`。
- Task 8 HEAD：`fc7448c6ee399884f3f2491db5f9440a57dac396`。
- Task 9 最终证据：前端测试 17/17、TypeScript typecheck 通过、Vite build 通过（仅既有大 chunk 警告）。
- Task 9 规格复核：`APPROVED`；代码质量复核：`APPROVED`。
- Task 9 HEAD：`98419e423e1e9dd5874d2c28ae934aac13bd9fcb`。

## Blocked On

- 无。真实 SQLite 验证使用 Node `v22.23.1` 与 SQLite `3.49.2`，原生绑定已验证可用。

## ResumeStateHint

从 Task 10 开始。先以失败测试证明负载、脱敏和保留边界，再只修正测试揭示的规格内问题并补充 README；完成后依次做规格与代码质量复核。

## DriftCheckDraft

- 原始意图：一致，Task 1–9 已形成后端采集、持久化、管理员只读查询与页面闭环。
- 兼容边界：FIFO、槽位、调度顺序、重试、GameClient 协议和错误语义未改变。
- 新 owner/fallback/分支：无。
- 退役轨：现有任务日志和 system-status 继续保留。
- 证据充分性：Task 9 双复核通过，可进入上线前负载与保留边界验证。
- decision：`continue`。

## Next

派发新的 Task 10 实现代理，按 TDD 完成 10 万事件、真实 SQLite 保留和部署文档验证。
