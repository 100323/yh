# 每日任务完成度与持续补偿实现计划

## Goal

让点金与灯神扫荡在部分成功、超时、断线或连接失败时留下可解析的完成度，并由普通调度器和批量调度器在当天持续补偿未完成部分；把补偿检查频率调整为每 15 分钟。

## Architecture

任务执行器产生结构化 `data`，路由层写入任务日志与 execution marker，调度器消费 marker/log 判断是否需要补偿。共享完成度规则位于 `backend/src/utils/taskCompletion.js`，避免普通、批量和 catchup 各自解释结果。

## Tech Stack

Node.js ESM、`node:test`、SQLite/better-sqlite3、node-cron。现有 WebSocket、账号互斥、代理、重连和周六 blackout 机制保持不变。

## Baseline/Authority Refs

- `AGENTS.md`
- `backend/src/scheduler/index.js`
- `backend/src/batchScheduler/index.js`
- `backend/src/routes/tasks.js`
- `backend/src/routes/batchScheduler.js`
- `backend/src/utils/gameClient.js`
- `backend/test/gameClient.test.js`
- `docs/superpowers/specs/2026-09-01-daily-task-completion-recovery-design.md`

## Compatibility Boundary

不改公开任务类型、数据库 schema、API 入参和账号执行互斥。成功日志详情由丢弃改为保留并继续截断；旧 marker 详情为空时仍支持缺日志补偿。线上发布只覆盖本次改动的后端源码文件，先备份数据库与运行文件。

## Verification

先让完成度测试因新模块缺失而 RED；实现后运行定向测试、全量 `npm --prefix backend test`、`node --check`、`git diff --check`。发布后备份线上数据库，重启 `xyzw-backend`，检查 `/api/health`、PM2 日志和 marker/details 结构。

## Tasks

### 1. 完成度判定与 RED 测试

Files: `backend/test/taskCompletion.test.js`, `backend/src/utils/taskCompletion.js`。

写入点金完整/部分/耗尽，灯神四国完整/部分/领券耗尽，以及 JSON 详情解析的测试。先运行 `node --test backend/test/taskCompletion.test.js`，确认因为工具模块尚不存在而失败；再实现最小纯函数并运行同一命令确认 GREEN。

### 2. 生产结果与日志契约

Files: `backend/src/scheduler/index.js`, `backend/src/batchScheduler/index.js`, `backend/src/utils/gameClient.js`, `backend/src/routes/tasks.js`, `backend/src/routes/batchScheduler.js`。

保留成功/信息日志 details；为点金写入剩余次数和完成度；灯神保留每国及领券结果；单个灯神阶段失败不丢失已完成结果。为 producer 和 consumer 补测试，确保日志详情进入 marker 且完成度能被调度器读取。

### 3. 持续补偿与防重复消耗

Files: `backend/src/scheduler/index.js`、必要时 `backend/src/batchScheduler/index.js`。

把 catchup cron 改为 `*/15 * * * *`，让 `collectDailyCatchupTasks()` 识别 success + incomplete、retryable error，并把点金 catchup 配置收窄到 `remainingCount`。沿用现有账号批次去重、连接恢复、代理、错峰、限流和 blackout。

### 4. 验证、提交、发布

运行全部后端测试与语法检查，查看 diff。提交本地修改并推送 GitHub；线上只备份并覆盖变更文件，重启 PM2，检查健康接口、进程状态和新日志。

## Repair Track

根因修复点是日志 producer 保留结构化详情、共享工具统一完成度判定，以及 GameClient 返回阶段性结果。调度器只消费这份 canonical completion，不在调用方增加第二套规则。

## Retirement Track

原先“success 直接视为完成”和“19:15 单次补偿”在主路径中退出。保留旧的缺日志判断作为兼容 fallback；当线上所有 marker 均包含 completion 且历史数据自然过期后，可单独评估删除该 fallback。本次不删除任何既有兼容路径。

## Ripple Signal Triage

变更跨越 producer（执行器/路由）、source of truth（marker details）和 consumers（普通/批量 catchup），因此必须同时验证纯工具、GameClient、路由详情保留和调度器候选判定；不能只通过单元测试工具函数宣称完成。
