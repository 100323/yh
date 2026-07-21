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
10. 负载、故障隔离、保留期与文档验证（已完成）
11. 最终架构复核与上线交接（已完成）

## Active Slice

Task 11：最终架构复核与上线交接。对照设计、基线和文件映射逐项检查非抛、禁用、安全字段、来源/出口、保留、权限、轮询、依赖与调度参数不变量。

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
- Task 10 已完成 10 万事件、真实 SQLite 保留/索引、硬上限与上线文档验证，并通过规格复核与代码质量复核。
- Task 11 已关闭最终架构 review 发现的 7 个 Important：命令重复计数、任务归因、buffer 脱敏、故障恢复/SQLite hard cap、disabled 快速旁路、DAILY_TASK_CLAIM 双 wrapper、异常率口径。

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
- Task 10 最终证据：100000 命令聚合为 144 个键、1000 条异常、269590 bytes；6 个查询/清理范围均为索引 `SEARCH`。
- Task 10 SQLite 证据：三表同时执行最多 3 天和行数 cap；覆盖 ±14 时区偏移、毫秒 cutoff、0000/9999 年边界和显式超大 options 钳制。
- Task 10 回归：仓储+负载 22/22、Node 22 串行后端全量 171/171、前端 21/21、typecheck/build 与 `git diff --check` 通过。
- Task 10 规格复核：`APPROVED`；代码质量复核经两轮修正后最终 `APPROVED`。
- Task 10 提交：`0db9157`、`9270312`、`0833fbe`。
- Task 11 提交链：`40d5d70`、`4fba5c2`、`b8ff760`、`806c0ff`、`68c4698`、`79f67ff`、`d5f1f29`。
- Task 11 最终架构 reviewer：`APPROVED`，无新的 Critical/Important。
- Task 11 fresh 回归：Node 22 串行后端 182/182；前端测试 21/21；项目 typecheck 通过；Vite build 通过（仅既有大 chunk 警告）；`git diff --check` 通过。
- Task 11 数据库迁移：旧 SQLite `slow_count` 幂等初始化测试通过；`backend/data/xyzw.db` 不存在且未触碰。

## Blocked On

- 无。真实 SQLite 验证使用 Node `v22.23.1` 与 SQLite `3.49.2`，原生绑定已验证可用。

## ResumeStateHint

实现与代码验证已完成。浏览器视觉 QA 尝试访问本地 `127.0.0.1:4173` 时被浏览器安全策略拒绝；没有绕过策略，也没有管理员会话实测证据。若后续允许本地浏览器访问，再补桌面/移动截图和真实管理员页面检查。

## DriftCheckDraft

- 原始意图：一致，Task 1–10 已形成采集、持久化、查询、页面和上线边界证据闭环。
- 兼容边界：FIFO、槽位、调度顺序、重试、GameClient 协议和错误语义未改变。
- 新 owner/fallback/分支：无。
- 退役轨：现有任务日志和 system-status 继续保留。
- 证据充分性：Task 11 架构复核与自动化回归通过；视觉 QA 受本地浏览器策略阻塞。
- decision：`pause-for-user`。

## Next

等待用户决定是否在允许本地浏览器访问后补视觉 QA；代码与自动化证据已达到交接候选状态。
