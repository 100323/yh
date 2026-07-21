# 正常调度槽位恢复实施计划

## Goal

修复后端在错峰队列尚未执行完成时重启，导致正常 cron 任务静默漏做的问题；将漏做和恢复过程写入可查询日志，并在调度观测页面以中文展示任务、命令和来源。

## Architecture

在正常 cron 回调与内存错峰队列之间增加持久化的“调度槽位账本”。每个槽位以任务配置、账号和实际调度分钟唯一标识，经历 `queued -> started -> success|ignored|error`。新进程只恢复旧进程遗留的 `queued` 槽位；`started` 槽位记录为中断告警而不自动重放，以避免重复购买、领取或战斗。

恢复仍通过现有 `enqueueAccountTaskBatch`、账号互斥、错峰、并发、重连和重试路径执行。不会提高并发、缩短延迟或改变任务顺序。

## Tech Stack

Node.js ESM、better-sqlite3、node:test、Vue 3、Element Plus。

## Baseline / Authority

- `AGENTS.md`
- `backend/src/scheduler/index.js`
- `backend/src/database/index.js`
- `backend/src/routes/logs.js`
- `frontend/src/views/Logs.vue`
- `frontend/src/views/SchedulerObservability.vue`
- 线上证据：2026-07-18 正常 `00:01` 任务在 PM2 `00:06` 重启后留下无 marker、无 task log 的缺口。

## Compatibility Boundary

- 不改变既有 cron、账号并发、代理/直连车道、错峰窗口、任务顺序、重试和重连。
- 不回放已开始执行的任务。
- 所有新槽位/恢复记录最多保留 3 天，且不保存 Token、参数、响应正文或代理地址。
- 现有 `task_logs`、`task_execution_markers` 和晚间补偿继续工作。

## File Map

- `backend/src/database/index.js`：槽位账本 schema、3 天清理和数据库维护接入。
- `backend/src/scheduler/scheduleSlotLedger.js`：槽位入队、开始、结算、遗留查询和状态转换的唯一 owner。
- `backend/src/scheduler/index.js`：cron 触发时写入槽位，批次执行时更新槽位，启动/每分钟检查时恢复旧进程遗留 queued 槽位。
- `backend/src/routes/logs.js`：返回槽位漏做/恢复日志，保留原有日志 API 兼容。
- `frontend/src/views/Logs.vue`：显示漏做、恢复和来源。
- `frontend/src/utils/schedulerObservabilityViewModel.js`、`frontend/src/views/SchedulerObservability.vue`：任务/命令/来源中文显示与槽位缺口摘要。
- 对应 `backend/test/` 与 `frontend/test/`：覆盖持久化、恢复、重复保护、已开始不回放、API 和视图映射。

## Tasks

### 1. 槽位账本与 retention

先写真实 SQLite 失败测试：同一任务分钟只能创建一个 queued 槽位；旧实例 queued 可领取；started 不可领取；超过 3 天的槽位会删除。实现 schema、索引、repository 和清理后运行目标测试，再运行仓储回归。

### 2. 正常 cron 和队列恢复

先写 scheduler 失败测试：cron 槽位在入队前持久化；新实例只恢复旧实例 queued 槽位且经既有 enqueue；批次开始/结算更新槽位；started 槽位只写中断日志。实现最小集成后运行 scheduler 与 coordinator 回归。

### 3. 日志和观测读取

先写 API 失败测试：账号日志能够返回漏做/恢复记录且不泄露敏感字段。实现后保持 `/api/logs` 现有响应兼容；为观测读取增加槽位缺口汇总，不将漏做伪装成命令异常。

### 4. 前端可读性

先写 view-model 失败测试：任务名、命令名、来源均显示中文，漏做/恢复可被稳定渲染。实现日志状态、来源说明和观测缺口展示；底层筛选值保持英文稳定。

### 5. 回归、审查与上线准备

运行后端串行全量、前端测试、typecheck、build 和 `git diff --check`。复核恢复只覆盖 queued 槽位、所有新增数据 3 天清理、调度参数零漂移。完成独立代码审查后再建立服务器备份并部署。

## Repair Track

根因是 `pendingAccountTaskBatches` 仅存在内存，进程重启会丢弃尚未执行的错峰定时器，而普通任务日志只在执行结算后写入。修复在调度器触发边界持久化槽位，并在新进程恢复遗留 queued 槽位。

## Retirement Track

原来的“重启后仅注册未来 cron、漏掉的 queued 任务无记录”路径由槽位恢复替代。晚间补偿仍保留，负责业务失败和非 queued 漏做；它不再是进程重启后的唯一保护层。

## Verification

- `node --test backend/test/scheduleSlotLedger.test.js`
- `node --test backend/test/schedulerSlotRecovery.test.js`
- `node --test --test-concurrency=1 backend/test/*.test.js`
- `pnpm --dir frontend test`
- `pnpm --dir frontend typecheck`
- `pnpm --dir frontend build`
- `git diff --check`

## Residual Risk

近期 PM2 高频 `SIGINT` 的直接触发者尚未从系统 cron/timer 找到；本计划降低其造成的漏做影响，但不把“重启根因消失”作为前提或宣称已解决。
