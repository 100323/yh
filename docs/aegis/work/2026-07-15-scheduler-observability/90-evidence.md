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
