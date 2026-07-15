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
