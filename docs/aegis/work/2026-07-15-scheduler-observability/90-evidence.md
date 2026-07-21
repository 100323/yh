# EvidenceBundleDraft

## 基线证据

- 后端：全量 `node --test` 通过，共 33 项测试。
- 前端：`pnpm typecheck` 通过。
- 前端：`pnpm build` 通过；仅出现既有大 chunk 警告。
- 隔离分支：`codex/scheduler-observability`，起点 `1651d0d`。

## 环境限制

- Node：`v24.16.0`。
- `better-sqlite3@11.10.0` 无当前 ABI 的预编译绑定。
- 本机构建缺少 Visual Studio C++ workload。
- 处理：Task 1/2 正常推进；涉及真实 SQLite 的最终验证必须在生产一致 Node 或可构建环境执行并补录证据。

## 切片证据

### Task 1：纯观测核心、分类与脱敏

- 初始 RED：`ERR_MODULE_NOT_FOUND`，证明测试先于生产模块。
- 复核驱动的安全/边界 RED：最终扩展为 36 项，覆盖脱敏绕过、全局容量、异常 FIFO、无损/原子 merge、数值饱和和 snapshot-and-swap。
- GREEN：`pnpm --dir backend exec node --test test/schedulerObservationCore.test.js`，36/36 通过。
- 回归：`pnpm --dir backend test`，最终 69/69 通过。
- 静态检查：`git diff --check` 通过；计划内文件无 `console`。
- 范围：仅新增 `schedulerObservationCore.js` 与对应测试；没有数据库、定时器、AsyncLocalStorage、依赖或运行时接入。
- 规格复核：`APPROVED`。
- 代码质量复核：`APPROVED`。
- 最终提交：`aff45d09d4d5f86f4e45aed85e3e6015e910da85`。
- 环境注记：Node 24 测试运行器数次出现 IPC 反序列化瞬态；既有文件单测均通过，随后全量重跑通过，未修改无关代码。

### Task 2：AsyncLocalStorage 上下文与任务包装器

- RED：缺少 `getSchedulerObservationContext` 导出；后续边界 RED 覆盖 observer getter、分类 getter、hostile thenable、重复结算与自返回链。
- GREEN：`pnpm --dir backend exec node --test test/schedulerObservationCore.test.js`，58/58 通过。
- 回归：默认 `pnpm --dir backend test`，最终 91/91 通过。
- 静态检查：`git diff --check` 通过；无新增 `console` 或敏感输出。
- 范围：仅修改观测核心与对应测试；未接入 scheduler、service、database 或 GameClient。
- 规格复核：`APPROVED`。
- 代码质量复核：`APPROVED`。
- 最终提交：`21c0e9e`。
- 环境注记：实现早期默认并行 runner 曾出现既有 Node 24 IPC 反序列化瞬态；串行全量通过，后续默认全量连续通过。

### Task 3：SQLite 表、批量仓储与 3 天清理

- 环境：官方便携 Node `v22.23.1` 位于 `D:\CodexTools\node-v22.23.1-win-x64`；SHA-256 已校验。`better-sqlite3@11.10.0` 预编译绑定成功加载，SQLite 版本 3.49.2。
- RED：仓储模块缺失；后续覆盖安全整数溢出、raw proxy/Unicode/IDN 绕过、毫秒 cutoff、坏行原子性和合法 proxy lane。
- GREEN：真实 SQLite 仓储测试 16/16。
- 回归：Node 22 `--test --test-concurrency=1` 后端全量 107/107。
- Schema：真实 `initDatabase()` + PRAGMA 验证三表、列、默认值、复合 PK 和四索引。
- 隔离：所有临时数据库已关闭并删除；`backend/data/xyzw.db` 测试前后均不存在。
- 范围：仅数据库 schema/维护入口、仓储与真实数据库测试；无 service/API/调度接入/WAL 变化。
- 规格复核：`APPROVED`。
- 代码质量复核：`APPROVED`。
- 最终提交：`017dda274b15baf8d89407589e87130d09ff24d8`。
- 残余风险：`julianday(indexed_column)` 保留毫秒语义但阻止时间范围索引搜索，登记到 Task 10 负载验证。

### Task 4：观测服务、配置与生命周期

- RED：服务模块缺失；后续覆盖 merge=false、恶意 stop 参数、errorCode、stop 最终写窗口和 queue alias 碰撞。
- GREEN：服务目标测试 25/25。
- 回归：Node 22 串行后端全量 132/132。
- 禁用：定时器创建 0 次，观察入口快速返回 false。
- 失败恢复：单 retry 槽、flush/merge/drop 健康可见；普通 tick 最多一次仓储调用。
- 关停：等待旧在途期间接收晚事件；最终 snapshot 前封口；stop resolve 后 disabled；restart 全新状态。
- Queue 关联：完整 NFKC primitive 的类型化 SHA-256 元组，无分隔符/截断/类型碰撞，hash 不持久化。
- 配置：本地默认 `enabled=false`、`retentionDays=3`；生产 ecosystem 显式默认启用。
- 规格复核：`APPROVED`。
- 代码质量复核：`APPROVED`。
- 最终提交：`da2dffe8f3781e349425641e77c01078b44442f6`。

### Task 5：GameClient 命令生命周期

- RED：新增观测测试 7 项因 sent/settled 缺失失败，既有 GameClient 8/8 保持绿色；后续覆盖对象上下文泄漏和限频误分类。
- GREEN：目标测试 18/18。
- 回归：Node 22 串行后端全量 142/142。
- 生命周期：success、timeout/迟到回包、disconnect、业务错误、proxy/direct、system/game、同步 send throw 与 hostile observer。
- 兼容：seq/ack、timer、pending 注册、ws.send 次数/字节、回包匹配和 Error 引用保持。
- 安全：上下文逐字段标量化；事件独立；无 params/body/token/raw proxy/stack；实际 agent 决定匿名出口。
- 分类：200400/12400000 为 `rate_limited`，普通业务错误为 `error`。
- 规格复核：`APPROVED`。
- 代码质量复核：`APPROVED`。
- 最终提交：`e78c4a9ebfff26acfeb544fa311828da1062f3a2`。

### Task 6：账户队列与调度上下文

- RED：queue 观察缺失、调度包装边界缺失；后续覆盖 observer getter、daily-point 边界和自解析 thenable 活锁。
- GREEN：目标/控制 15/15；相关观测回归 95/95。
- 回归：Node 22 串行后端全量 153/153。
- 兼容：FIFO `[1,2]`、acquire/release、任务顺序、retry、client 与 Error 引用保持。
- 上下文：scheduler/catchup/manual/system/batch、account/task/batchTask/lane/queueWait；lane proxy 与 actual direct 分离。
- Daily point：主命令与领取命令共享 taskType/runId，任务仅结算一次且 duration 覆盖领取阶段。
- 观察隔离：getter/throw/reject/self-return/self-resolving thenable 不影响任务或定时器。
- 规格复核：`APPROVED`。
- 代码质量复核：`APPROVED`。
- 最终提交：`6114a2846274434ad9b168c78290276fc3e6b71b`。

### Task 7：管理员只读查询 API

- RED：新导出缺失；后续覆盖 commandClass、历史敏感网络数据、当前分钟速率和真实路由顺序。
- GREEN：目标测试 12/12。
- 回归：Node 22 串行后端全量 165/165。
- 权限：真实 Express + JWT + auth/admin，未登录 401、普通用户 403、管理员 200；旧端点权限不变。
- 契约：固定 range/cutoff/page/filter；summary/anomalies shape；安全 500；无任意 SQL/sort/cutoff。
- 安全：多词 token、URL、IPv4/IPv6、IDN、host/path、assignment+wrapper 历史值防御性脱敏；合法 proxy lane/type/fingerprint 保留。
- 资源：port0 server、临时 SQLite 均在 after 关闭删除。
- 规格复核：`APPROVED`。
- 代码质量复核：`APPROVED`。
- 最终提交：`42d51852fd50a258046d1eba867b41867bea1cc3`。

### Task 8：前端视图模型与 API 客户端

- RED：视图模型模块缺失；后续覆盖真实 category 契约和趋势 key 碰撞。
- GREEN：Node 22 目标测试 10/10。
- 前端验证：direct TypeScript CLI 通过；Vite production build 通过，仅既有大 chunk 警告。
- 契约：范围、耗时、放大倍数、趋势、匿名出口、真实五类异常标签；API 使用 `{ params }`。
- 稳定性：趋势 key 全局唯一、确定且不修改输入；无 NaN/Infinity/raw egress 回显。
- 环境：pnpm 11 ignored-build policy 阻断 wrapper 命令，使用本地 CLI 验证；未修改依赖，临时 YAML 已删除。
- 规格复核：`APPROVED`。
- 代码质量复核：`APPROVED`。
- 最终提交：`fc7448c6ee399884f3f2491db5f9440a57dac396`。

### Task 9：管理员“调度观测”页面和导航

- 前端测试：Node 22 运行 17/17 通过。
- 静态验证：TypeScript typecheck 通过；Vite production build 通过，仅有既有大 chunk 警告。
- 路由与导航：router、桌面菜单、移动菜单和页面统一使用 `/scheduler-observability`；路由要求 `requiresAdmin: true`，桌面与移动端共用 `visibleMenuItems`。
- 页面生命周期：30 秒轮询；generation 防止旧请求覆盖新筛选；卸载时清除定时器并使在途结果失效。
- 契约显示：五个筛选项中 `commandClass` 明确标注“仅汇总”；健康状态覆盖 unknown、disabled、stopped、degraded、healthy；`lastFlushDurationMs=null` 显示“暂无”，`0` 显示 `0 ms`。
- 规格复核：`APPROVED`。
- 代码质量复核：`APPROVED`。
- 最终提交：`98419e423e1e9dd5874d2c28ae934aac13bd9fcb`。

### Task 10：负载、故障隔离、保留期与文档验证

- RED：聚合表行数 cap 缺失（40 行未收敛到 25）；纯 `julianday(indexed_column)` 无法使用时间范围索引；保留期/异常行 cap 未接入每日维护。
- 初始 GREEN：100000 条命令全部记录并聚合为 144 个命令键；异常队列 1000 条；快照 269590 bytes；禁止 payload 未进入快照。
- SQLite：真实临时数据库验证命令分钟、任务分钟、异常明细均执行时间与行数双上限；6 个查询/清理范围通过 `EXPLAIN QUERY PLAN` 命中对应时间索引。
- 质量修正 1：补充 ±14 小时时区 offset 查询/清理回归；索引候选窗口使用 UTC 日期超集，最终由 `julianday` 保持精确语义；显式 options 也强制 3 天、50000/20000/50000 行硬上限。
- 质量修正 2：使用低/高索引哨兵覆盖 SQLite `0000..9999` 日期域，新增 0000 年初查询与 9999 年末三表清理回归。
- README：记录全部 7 个环境变量、3 天硬上限、禁止字段、管理员入口、24–72 小时观察清单、关闭重启回滚及观察期间不改调度并发。
- 最终验证：仓储+负载 22/22；Node 22 串行后端全量 171/171；前端 21/21；TypeScript、Vite build、`git diff --check` 通过；worktree clean；未触碰 `backend/data/xyzw.db`。
- 规格复核：`APPROVED`。
- 代码质量复核：两轮 `CHANGES_REQUESTED` 均经 TDD 修复，同一 reviewer 最终 `APPROVED`。
- 提交：`0db9157 test: verify scheduler observation production bounds`、`9270312 fix: enforce scheduler observation retention bounds`、`0833fbe fix: bound observation index sentinels`。
- 残余风险：无效时间清理每日执行一次全表扫描，但三表均受硬行数 cap 约束；线上真实基数仍需按计划观察 24–72 小时。

### Task 11：最终架构复核与上线交接

- 最终独立架构 reviewer：`APPROVED`；逐项复核非抛入口、disabled producer guard、禁止字段、source/lane/actual egress、3 天与硬 cap、管理员权限、前端轮询清理、依赖和调度参数零漂移。
- 修复提交：`40d5d70`（命令只计一次）、`4fba5c2`（ALS 任务归因）、`b8ff760`（buffer 网络脱敏）、`806c0ff`（恢复与 flush hard cap）、`68c4698`（disabled 快速旁路）、`79f67ff`（补领 task owner）、`d5f1f29`（聚合异常率/slow_count 迁移）。
- Fresh 后端：Node 22 `--test --test-concurrency=1`，182/182 通过。
- Fresh 前端：Node 测试 21/21；`tsc --noEmit -p tsconfig.typecheck.json` 通过；Vite production build 通过，仅有既有大 chunk 警告。
- Fresh 目标：仓储 21/21；10 万负载与保留测试 3/3；`git diff --check` 通过。
- 测试隔离：未创建或触碰 `backend/data/xyzw.db`；临时 `backend/data/proxy_config.json` 已确认是测试产物并清理。
- 浏览器视觉 QA：已尝试启动并访问本地页面，但浏览器安全策略拒绝 `127.0.0.1:4173`；未绕过限制，未伪称管理员桌面/移动实测通过。
- 工作区限制：测试路径一行修正已通过仓储 21/21 与后端 182/182，但提交时受 `.git/worktrees/scheduler-observability` ACL 拒绝创建 `index.lock`；该未提交 diff 为 `backend/test/schedulerObservationRepository.test.js` 的相对导入修正。
