# 每日任务完成度与持续补偿设计

## 目标

修复点金、灯神扫荡出现“外层成功但实际做少”时无法补偿的问题，并把每日补偿从每天 19:15 一次检查改为每 15 分钟检查一次。补偿必须只执行缺少的次数或缺少的阶段，不能因为重复执行而造成额外消耗。

## 根因

普通调度器和批量调度器都会把 `result.data` 写入任务日志，但日志归一化函数会在 `success` 状态下直接丢弃 `details`。因此 marker 只有成功消息，没有点金成功次数、灯神四国结果和扫荡券结果。补偿器只能把“有成功日志”当作已完成。

另外，`GameClient.genieDailySweep()` 在单个国家或领券命令遇到非跳过异常时直接抛错，前面已经完成的结果不会被保存，导致下一次执行无法知道哪些阶段已完成。

## 设计

### 1. 共享完成度判定

新增 `backend/src/utils/taskCompletion.js`，集中解析任务详情并返回 `complete`、`status`、`retryable`、`reason` 与点金 `remainingCount`。

点金以 `buyNum` 与 `successCount` 判定。超时、断线、未连接等错误在未达到目标时进入补偿；明确表示今日次数用完或资源不足时视为当天完成。

灯神要求四国每个国家都有成功或明确跳过结果，扫荡券阶段要么完成三次，要么收到“今日扫荡券已领完”。缺国家、失败结果、超时或断线都标记为部分完成并进入补偿。

### 2. 结果生产与日志保留

普通和批量点金执行器都保存 `buyNum`、`successCount`、`remainingCount`、`results` 与 `completion`。补偿执行时将点金目标配置收窄为 `remainingCount`，避免重复点金。

普通和批量灯神执行器保存完整 `genieDailySweep()` 返回值和 `completion`。

任务路由与批量任务路由在成功/信息日志中保留结构化 `details`，继续保留 1000 字符上限和截断行为。

### 3. 灯神阶段容错

灯神单个国家失败时记录 `{ success: false, error }` 并继续其他国家；领券遇到临时异常时记录失败结果并结束本轮领券。明确的已扫荡、条件不满足、模块未开启和领券次数耗尽仍然是正常跳过，不进入无限补偿。

### 4. 持续补偿

每日补偿 cron 改为 `*/15 * * * *`，继续使用上海时区、账号互斥、连接重连、代理、错峰和周六 blackout 逻辑。

`collectDailyCatchupTasks()` 同时检查：当天没有日志/marker、最新执行早于当天最近应执行时间、最新状态为 retryable error、或 `success` 但 `completion.complete === false`。已完成或明确耗尽的任务不再补偿。

## 兼容性边界

- 不改变任务类型、HTTP API、数据库表结构或现有 cron 配置格式。
- 不删除用户现有定时任务，不覆盖线上无关文件。
- 只改变成功日志详情的保留方式；旧日志没有详情时仍按旧逻辑处理。
- 外部 WebSocket 或游戏服务器拒绝命令、账号离线、代理不可用仍可能导致本轮无法完成，但会留下可供下一次补偿使用的结构化结果。

## 验证

- `node --test backend/test/taskCompletion.test.js`
- `node --test backend/test/gameClient.test.js backend/test/taskCompletion.test.js`
- `npm --prefix backend test`
- 对修改后的 JavaScript 文件执行 `node --check`
- 提交前检查 `git diff --check`、工作区状态和提交内容。
