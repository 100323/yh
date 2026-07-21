# 高峰分钟漏调度对账修复计划

## Goal

修复大量普通定时任务在同一分钟命中时，部分 `node-cron` 回调因事件循环跨过目标秒而完全不触发，导致没有槽位、没有账号日志、任务静默漏做的问题。

## Architecture

保留现有每任务 cron 作为低延迟快速路径，在现有 `checkAndRunDueTasks()` 增加统一持久化对账作为可靠路径。对账按上海时区计算每个启用配置“已经到期的最新一个槽位”，经过一分钟宽限后用 `(task_config_id, scheduled_at)` 唯一键创建槽位；只有新建成功的槽位才写 `missed` 检测日志并进入原 `enqueueAccountTaskBatch`。同一任务更早的历史周期不回放，已有 `queued/started/settled` 槽位都不重放。

对账仍使用原账号互斥、错峰、并发、重试、重连、代理通道和任务顺序。内存游标只用于避免每分钟重复访问同一个已知槽位，SQLite 唯一键仍是跨进程和重启后的最终去重边界。

首次启用会在 `system_settings` 持久化 `scheduler_reconciliation_activated_at`，水位之前的旧任务绝不补做；水位无法写入时对账严格关闭。为覆盖上海 00:00 日界线，对账可检查前一个自然日，但候选槽位最多回看 60 分钟，避免第二天补做陈旧周期。

## Tech Stack

Node.js ESM、`node:test`、better-sqlite3、node-cron 3.0.3、Vue 3 前端映射。

## Baseline / Authority Refs

- `AGENTS.md`
- `docs/aegis/baseline/2026-07-15-initial-baseline.md`
- `docs/aegis/plans/2026-07-18-scheduler-slot-recovery.md`
- `backend/src/scheduler/index.js`
- `backend/src/scheduler/scheduleSlotLedger.js`
- `backend/node_modules/node-cron/src/scheduler.js`
- 2026-07-19 线上只读诊断：3308 个启用配置；截至 08:48 应触发 1954、实际槽位 956、无槽位缺口 1052；缺口集中在 00:00、06:00、07:00、08:00。

## Compatibility Boundary

- 不改变任务业务步骤、任务顺序、账号互斥、最大并发、错峰窗口、重试、重连、代理行为和超时。
- 不自动回放已经存在 `started` 槽位的任务。
- 一个任务存在多个过期周期时只补最新一个，避免连续购买、领奖或战斗。
- 首次发布不回放对账启用水位之前的任务；新建配置不回放 `created_at` 之前的槽位。
- 继续保留 19:15 日补偿；本修复只覆盖“正常 cron 回调未产生槽位”。
- 槽位、观测和新增漏做日志仍只保留 3 天，不写 Token、参数、响应正文或代理地址。

## Verification

- `node --test test/scheduleDueSlot.test.js test/scheduleSlotReconciliation.test.js test/scheduleSlotLedger.test.js test/scheduleSlotRecovery.test.js`
- `node --test --test-concurrency=1 test/*.test.js`
- `pnpm --dir frontend test`
- `pnpm --dir frontend typecheck`
- `pnpm --dir frontend build`
- `git diff --check`
- 部署后查询当天每小时“应到槽位 vs 实际槽位”，并确认新来源中文可读且没有重复槽位。

## Task 1：纯时间槽位计算

**Files:** `backend/src/scheduler/scheduleDueSlot.js`、`backend/test/scheduleDueSlot.test.js`、`backend/src/scheduler/index.js`

**Why:** 将上海时区、cron 日期匹配、宽限期和 UTC 槽位时间集中成可直接测试的 owner，避免对账路径自行猜测时间。

**Impact / Compatibility:** 现有日补偿继续取得相同的本地时间字符串；新对账额外使用准确的 UTC `scheduledAt`。

1. 写失败测试：`findLatestDueScheduleSlot()` 在上海 00:01 后返回 00:00 槽位，多个历史周期只返回最新一个，宽限期内返回 `null`。
2. 运行 `node --test test/scheduleDueSlot.test.js`，确认因模块/API 不存在而 RED。
3. 最小实现 `findLatestDueScheduleSlot(cronExpressions, { now, graceMs })`，返回 `{ localScheduledAt, scheduledAt, cronExpression }`；让现有 `getLatestDueSlotForToday()` 委托该函数。
4. 重跑目标测试并运行涉及日补偿的 scheduler 测试，确认 GREEN。
5. 提交本切片。

## Task 2：持久化缺口对账与 778 同分钟回归

**Files:** `backend/src/scheduler/scheduleSlotReconciliation.js`、`backend/test/scheduleSlotReconciliation.test.js`、`backend/src/scheduler/index.js`、`backend/test/schedulerObservationIntegration.test.js`

**Why:** cron 回调没执行时也能由一个统一入口补建槽位，并沿用原执行队列。

**Impact / Compatibility:** 新来源为 `scheduler-reconcile`；只在唯一槽位新建成功时入队。日志失败不能阻止任务入队。

1. 写失败测试：778 个同分钟配置全部生成唯一槽位；重复对账不重复入队；已有 `started` 不重放；同任务多周期只入队最新槽位；日志异常不影响入队。
2. 运行 `node --test test/scheduleSlotReconciliation.test.js`，确认因对账模块不存在而 RED。
3. 最小实现 `reconcileMissingScheduleSlots()`，使用真实 `queueScheduleSlot()`、一分钟宽限、60 分钟最大回看、持久化启用水位、配置创建时间保护、内存游标和后台 enqueue rejection 处理；在 `checkAndRunDueTasks()` 与启动初始化中调用，并给唯一的分钟刷新 job 开启 `recoverMissedExecutions`。
4. 重跑目标测试和 scheduler 集成测试，确认 GREEN。
5. 提交本切片。

## Task 3：前端来源中文与全量验证

**Files:** `frontend/src/utils/schedulerObservabilityViewModel.js`、`frontend/test/schedulerObservabilityViewModel.test.js`、本 work 记录。

**Why:** 让管理员明确区分“正常定时触发”“重启恢复”和“分钟对账补漏”。

**Impact / Compatibility:** API 内部来源值保持稳定，只有展示文本新增“分钟对账补漏”。

1. 写失败测试：`formatSourceLabel('scheduler-reconcile')` 返回 `分钟对账补漏`。
2. 运行前端目标测试确认 RED，再添加最小映射并确认 GREEN。
3. 运行后端串行全量、前端全量、typecheck、生产构建和 `git diff --check`。
4. 独立复核去重、`started` 不回放、3 天保留和所有兼容边界。
5. 服务器备份后部署，验证 health、数据库 schema、PM2 单实例和当天槽位覆盖率。

## Repair Track

根因 owner 是 `node-cron` 3.0.3 的每任务独立秒级 timer：项目未开启 `recoverMissedExecutions`，事件循环延迟跨过目标秒后，`i > 0` 的错过时间不会匹配回调。最小安全修复是在已有持久化槽位 owner 前增加统一对账，使“回调是否发生”不再是创建槽位的唯一条件；首次启用水位避免旧版本已完成任务因缺少历史槽位而被误回放。

## Retirement Track

3308 个每任务 cron 暂时保留为快速路径，原因是本次在线修复优先缩小变更面。统一对账与唯一键是可靠路径；连续观察至少 3 天确认槽位覆盖率和执行延迟后，下一阶段删除每任务 cron timer，只保留统一调度，从根源消除惊群和重复 owner。

## Residual Risk

- 本次只补最新一个周期，较早且已经被后续周期覆盖的漏做不会补执行，这是为避免重复业务副作用的明确安全取舍。
- 对账补入的任务仍受原 10 分钟错峰和账号并发限制，异常高峰下可能晚于原计划完成，但不会静默消失。
- PM2 历史 SIGINT 的触发者仍未定位；queued 槽位恢复继续降低其影响，但不宣称已消除重启根因。
