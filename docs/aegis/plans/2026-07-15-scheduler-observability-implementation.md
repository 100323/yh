# 调度命令可观测性实施计划

日期：2026-07-15  
状态：待执行

## Goal（目标）

为线上后端普通定时调度和持久化批量调度增加低开销、可关闭、故障隔离的命令级观测能力。在不改变任务并发、错峰、延迟、超时、重试、重连和返回语义的前提下，采集并展示：

- 每分钟命令量及峰值；
- 任务到命令的放大倍数；
- 账户队列等待；
- 命令响应耗时；
- 限频、超时、断线、慢响应和未分类错误；
- 调度车道与实际出口的差异；
- 观测模块自身的刷新失败和丢弃计数。

所有分钟汇总和异常明细只保留 3 天；不记录 Token、命令参数、响应正文、原始代理地址和完整堆栈。

## Architecture（架构）

```text
普通调度 / 批量调度
        ↓ AsyncLocalStorage 任务上下文
账户队列观测 + GameClient 命令生命周期观测
        ↓ 非抛错同步事件入口
内存分钟桶 + 有界异常队列
        ↓ 每 10 秒 snapshot-and-swap
SQLite 短事务 UPSERT
        ↓
管理员只读 API
        ↓
调度观测页面（30 秒轮询）
```

建议新增三个隔离模块：

- `backend/src/observability/schedulerObservationCore.js`：纯函数、脱敏、分类、聚合器和上下文。
- `backend/src/observability/schedulerObservationRepository.js`：SQLite 写入、查询和 3 天清理。
- `backend/src/observability/schedulerObservationService.js`：全局运行实例、定时刷新、故障隔离和健康状态。

生产者只调用窄接口；业务执行不依赖观测写入成功。

## Tech Stack（技术栈）

- Node.js ESM
- `AsyncLocalStorage`（Node 内置）
- `crypto.createHash` / `randomUUID`（Node 内置）
- `better-sqlite3` 现有同步适配器
- Express 现有鉴权与 `adminOnly`
- Vue 3 Composition API
- Element Plus 现有组件
- Node 内置测试运行器
- 不新增图表、指标或日志依赖

## Baseline / Authority Refs（基线与权威来源）

- `AGENTS.md`
- `docs/aegis/BASELINE-GOVERNANCE.md`
- `docs/aegis/baseline/2026-07-15-initial-baseline.md`
- `docs/aegis/specs/2026-07-15-scheduler-observability-design.md`
- `backend/src/scheduler/index.js`
- `backend/src/batchScheduler/index.js`
- `backend/src/utils/accountTaskCoordinator.js`
- `backend/src/utils/gameClient.js`
- `backend/src/database/index.js`
- `backend/src/routes/stats.js`
- `frontend/src/router/index.js`
- `frontend/src/layouts/MainLayout.vue`
- `frontend/src/api/index.js`

## Compatibility Boundary（兼容边界）

实施必须保持：

1. `runAccountTaskExclusive(...)` 仍是账户排他执行唯一入口。
2. 不改变直连/代理并发槽、账户启动波次、10 分钟错峰或任务排序。
3. 不改变任何现有命令超时起点、Promise 返回值、错误对象或重试判断。
4. 不改变 WebSocket 预热、重连、BIN Token 刷新和每日奖励延迟补领。
5. 观测关闭时不创建刷新定时器、不写表，生产者路径只执行一次快速条件判断。
6. 观测故障、缓冲区溢出或 SQLite 写入失败不得向任务链路抛错。
7. 第一版不观测浏览器手动任务，不修复批量代理行为，不增加主动限频。

## Verification（总体验证）

完成后至少执行：

```powershell
pnpm --dir backend exec node --test test/schedulerObservationCore.test.js
pnpm --dir backend exec node --test test/schedulerObservationRepository.test.js
pnpm --dir backend exec node --test test/schedulerObservationService.test.js
pnpm --dir backend exec node --test test/gameClientObservability.test.js
pnpm --dir backend exec node --test test/schedulerObservationIntegration.test.js
pnpm --dir backend exec node --test test/schedulerObservabilityRoutes.test.js
pnpm --dir backend exec node --test test/schedulerObservationLoad.test.js
pnpm --dir backend test
pnpm --dir frontend exec node --test test/schedulerObservabilityViewModel.test.js
pnpm --dir frontend typecheck
pnpm --dir frontend build
git diff --check
```

如果当前 Node ABI 与已安装的 `better-sqlite3` 原生绑定不一致，先在与生产一致的 Node 版本中执行数据库集成测试；不得因为本地 ABI 问题跳过最终数据库验证。

## Scope Check（范围检查）

### 已证实事实

- 后端默认单 PM2 进程运行；账户锁、队列和节流均为进程内状态。
- 普通调度和批量调度最终都通过后端 `GameClient` 发送命令。
- 当前绝大多数命令直接调用 `ws.send`，不存在统一出口级命令统计。
- 普通与批量调度共享账户协调器，但维护两套任务执行流程。
- 当前 SQLite 日志记录任务结果，不记录命令级速率和耗时。

### 实施假设

- 第一版继续以单后端进程为受支持部署模型。
- 生产显式设置 `SCHEDULER_OBSERVABILITY_ENABLED=1` 后才启用采集。
- 3 天数据足够定位当前线上限频问题。

### 有界未知项

- 官方完整限频错误码集合未知：第一版以已知错误码和脱敏消息模式分类，未知项归入 `command_error`。
- 实际命令放大倍数未知：通过 10 万事件负载测试确定防御性行数上限，并在线上观察后再调整。
- 生产代理数量未知：持久化代理出口只使用短指纹，维度增长受内存键数和表行数双重限制。

## Ripple Signal Triage（涟漪信号分诊）

本改动命中共享传输、共享账户协调、数据库契约、管理 API 和前端消费者，因此扩大验证范围：

- **Owner**：新观测模块是指标唯一所有者；`GameClient` 仍是发送唯一所有者；协调器仍是队列唯一所有者。
- **Downstream**：普通调度、补偿调度、批量调度、预热、心跳、统计 API 和管理页面均需验证。
- **Contract**：只增加可选内部观察器与只读 API；现有命令/任务接口不可变化。
- **Source of truth**：业务结果仍以现有任务日志为准；新表只负责运行指标，不能替代审计日志。
- **Fallback**：观测禁用或失败时退化为无指标，不增加业务 fallback。
- **Verification expansion**：除了新测试，还必须运行完整后端测试、前端类型检查和构建。

## File Map（文件映射）

### 新建

- `backend/src/observability/schedulerObservationCore.js`
- `backend/src/observability/schedulerObservationRepository.js`
- `backend/src/observability/schedulerObservationService.js`
- `backend/test/schedulerObservationCore.test.js`
- `backend/test/schedulerObservationRepository.test.js`
- `backend/test/schedulerObservationService.test.js`
- `backend/test/gameClientObservability.test.js`
- `backend/test/schedulerObservationIntegration.test.js`
- `backend/test/schedulerObservabilityRoutes.test.js`
- `backend/test/schedulerObservationLoad.test.js`
- `frontend/src/utils/schedulerObservabilityViewModel.js`
- `frontend/src/views/SchedulerObservability.vue`
- `frontend/test/schedulerObservabilityViewModel.test.js`

### 修改

- `backend/src/config/index.js`
- `backend/src/database/index.js`
- `backend/src/index.js`
- `backend/src/utils/gameClient.js`
- `backend/src/utils/accountTaskCoordinator.js`
- `backend/src/scheduler/index.js`
- `backend/src/batchScheduler/index.js`
- `backend/src/routes/stats.js`
- `backend/test/accountTaskCoordinator.test.js`
- `frontend/src/api/index.js`
- `frontend/src/router/index.js`
- `frontend/src/layouts/MainLayout.vue`
- `.env.example`
- `ecosystem.config.cjs`
- `README.md`

---

## Task 1：建立纯观测核心、分类与脱敏

**Files**

- Create: `backend/src/observability/schedulerObservationCore.js`
- Create: `backend/test/schedulerObservationCore.test.js`

**Why**

先建立无数据库、无定时器的纯核心，固定安全字段、聚合键和错误分类，后续所有生产者复用同一契约。

**Impact / Compatibility**

新模块尚不接入运行链路；无生产行为变化。

**Verification**

```powershell
pnpm --dir backend exec node --test test/schedulerObservationCore.test.js
```

- [ ] **1.1 Write test（写失败测试）**

创建测试，至少覆盖以下断言：

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SchedulerObservationAggregator,
  classifyCommandFailure,
  createEgressDescriptor,
  sanitizeObservationMessage,
} from '../src/observability/schedulerObservationCore.js';

test('脱敏 Token、URL 查询串、长编码串并限制摘要长度', () => {
  const summary = sanitizeObservationMessage(
    'failed token=abc123456789 https://host/path?p=secret ' + 'A'.repeat(500),
  );
  assert.equal(summary.includes('abc123456789'), false);
  assert.equal(summary.includes('p=secret'), false);
  assert.ok(summary.length <= 300);
});

test('优先按结构化错误码识别限频', () => {
  assert.equal(classifyCommandFailure({ code: 200400, message: 'x' }), 'rate_limited');
  assert.equal(classifyCommandFailure({ code: 12400000, message: 'x' }), 'rate_limited');
  assert.equal(classifyCommandFailure({ message: '操作过快，请稍后重试' }), 'rate_limited');
});

test('代理出口只返回稳定指纹，不返回原始地址', () => {
  const descriptor = createEgressDescriptor({ protocol: 'http', host: '1.2.3.4', port: 8080 });
  assert.equal(descriptor.type, 'proxy');
  assert.match(descriptor.key, /^proxy:[a-f0-9]{12}$/);
  assert.equal(JSON.stringify(descriptor).includes('1.2.3.4'), false);
});

test('分钟聚合累加命令、耗时和限频计数', () => {
  const aggregator = new SchedulerObservationAggregator({ now: () => Date.parse('2026-07-15T00:00:30Z') });
  aggregator.recordCommand({ source: 'scheduler', taskType: 'ARENA', command: 'arena_startarea', outcome: 'success', latencyMs: 120 });
  aggregator.recordCommand({ source: 'scheduler', taskType: 'ARENA', command: 'arena_startarea', outcome: 'rate_limited', latencyMs: 300 });
  const snapshot = aggregator.takeSnapshot();
  assert.equal(snapshot.commandMetrics.length, 2);
  assert.equal(snapshot.commandMetrics.reduce((sum, row) => sum + row.commandCount, 0), 2);
  assert.equal(snapshot.commandMetrics.reduce((sum, row) => sum + row.rateLimitedCount, 0), 1);
});
```

- [ ] **1.2 Verify RED（确认红灯）**

运行上面的命令，预期失败为 `ERR_MODULE_NOT_FOUND`，证明测试确实约束新模块。

- [ ] **1.3 Minimal code（最小实现）**

实现并导出固定常量、三个纯函数和聚合器：

- `OBSERVATION_OUTCOMES` 精确包含 `success`、`ignored`、`error`、`timeout`、`disconnected`、`rate_limited`、`sent`。
- `sanitizeObservationMessage(value, maxLength = 300)` 依次去除控制字符、URL 查询串、`token/roleToken/p` 键值、连续 80 字符以上的 Base64/十六进制片段，最后截断到 300 字符。
- `classifyCommandFailure(error, hints = {})` 优先读取 `hints.timeout`、`hints.disconnected`、错误码 `200400/12400000`，再匹配“操作过快、请稍后重试、过于频繁”，否则返回 `error`。
- `createEgressDescriptor(proxy)` 在无代理时返回 `{ type: 'direct', key: 'direct' }`；有代理时对规范化后的 `protocol://host:port` 做 SHA-256，只保留前 12 位并返回 `{ type: 'proxy', key: 'proxy:<fingerprint>' }`。
- `SchedulerObservationAggregator` 构造参数为 `{ now = Date.now, maxMetricKeys = 20000, maxAnomalies = 5000 }`，公开 `recordCommand`、`recordTask`、`recordAnomaly`、`takeSnapshot`、`mergeSnapshot`、`getHealth`。达到键上限时不再创建新键并增加 `droppedMetrics`；异常队列超限时删除最旧项并增加 `droppedAnomalies`。

固定 UTC 分钟格式为 `YYYY-MM-DD HH:mm:00`；所有空维度归一化为稳定空字符串或 `UNATTRIBUTED`，不得把对象直接拼进键。`takeSnapshot()` 必须替换内部 Map/数组，而不是返回仍会被继续修改的引用。

- [ ] **1.4 Verify GREEN（确认绿灯）**

运行核心测试，预期全部通过且无控制台敏感信息。

- [ ] **1.5 Commit（提交）**

```powershell
git add backend/src/observability/schedulerObservationCore.js backend/test/schedulerObservationCore.test.js
git commit -m "feat: add scheduler observation core"
```

---

## Task 2：增加 AsyncLocalStorage 上下文与任务包装器

**Files**

- Modify: `backend/src/observability/schedulerObservationCore.js`
- Modify: `backend/test/schedulerObservationCore.test.js`

**Why**

任务辅助函数层级深，逐层传参容易产生接口漂移。异步上下文可以安全关联账户、任务、来源和运行编号。

**Impact / Compatibility**

包装器必须原样返回 executor 的值并原样抛出同一个错误对象。

**Verification**

```powershell
pnpm --dir backend exec node --test test/schedulerObservationCore.test.js
```

- [ ] **2.1 Write test**

增加嵌套上下文与错误恒等测试：

```js
test('异步任务上下文跨 await 保留并支持嵌套覆盖', async () => {
  await withSchedulerObservationContext({ source: 'scheduler', accountId: 1 }, async () => {
    await Promise.resolve();
    assert.equal(getSchedulerObservationContext().accountId, 1);
    await withSchedulerObservationContext({ taskType: 'ARENA' }, async () => {
      assert.deepEqual(getSchedulerObservationContext(), {
        source: 'scheduler', accountId: 1, taskType: 'ARENA',
      });
    });
  });
});

test('任务包装器保持返回值和错误对象', async () => {
  assert.equal(await runObservedTask({ taskType: 'SIGN_IN' }, async () => 42), 42);
  const error = new Error('boom');
  await assert.rejects(() => runObservedTask({ taskType: 'SIGN_IN' }, async () => { throw error; }), (caught) => caught === error);
});
```

- [ ] **2.2 Verify RED**

运行核心测试，预期因缺少三个导出而失败。

- [ ] **2.3 Minimal code**

使用 `node:async_hooks` 的 `AsyncLocalStorage` 实现三个精确接口：

- `getSchedulerObservationContext()`：没有上下文时返回 `null`，有上下文时返回浅拷贝。
- `withSchedulerObservationContext(context, executor)`：以 `{ ...parent, ...context }` 合并并调用 `storage.run`。
- `runObservedTask(context, executor, observer)`：补充 `runId` 和 `startedAt`，在上下文内执行；成功时调用 `observer.observeTaskSettled({ outcome: 'success', durationMs })`，失败时按分类结果调用一次结算后原样抛出捕获的错误。

`runId` 使用 `randomUUID()`；父上下文中的 `queueWaitMs` 和 `executionLane` 必须被子任务继承。

- [ ] **2.4 Verify GREEN**

核心测试全部通过。

- [ ] **2.5 Commit**

```powershell
git add backend/src/observability/schedulerObservationCore.js backend/test/schedulerObservationCore.test.js
git commit -m "feat: add scheduler observation context"
```

---

## Task 3：增加 SQLite 表、批量仓储与 3 天清理

**Files**

- Modify: `backend/src/database/index.js`
- Create: `backend/src/observability/schedulerObservationRepository.js`
- Create: `backend/test/schedulerObservationRepository.test.js`

**Why**

分钟汇总必须使用短事务批量写入；异常明细必须受时间和行数双重上限保护。

**Impact / Compatibility**

仅增加幂等表和索引；不改变现有表字段，不启用 WAL，不移除现有任务日志。

**Verification**

```powershell
pnpm --dir backend exec node --test test/schedulerObservationRepository.test.js
```

- [ ] **3.1 Write test**

使用临时目录和真实 `better-sqlite3` 创建隔离数据库，写四个测试：

1. 对完全相同维度连续刷新两次 `commandCount=1`，断言查询只有一行且 `command_count=2`。
2. 插入一条当前异常、一条 4 天前异常和超过配置上限的当前异常，清理后断言无过期行且总行数等于上限。
3. 分别用 `1h/6h/24h/3d` 查询固定夹具，断言每个范围只包含 cutoff 之后的桶。
4. 用包装适配器统计 `transaction()` 调用次数，刷新一个包含多行的 snapshot 后断言只调用一次。

测试数据库必须在 `t.after()` 中关闭并删除，不读取仓库真实 `backend/data/xyzw.db`。

- [ ] **3.2 Verify RED**

运行仓储测试，预期因表和仓储模块缺失失败。

- [ ] **3.3 Minimal code**

向现有 schema 模板加入三个表，所有聚合维度列设为 `NOT NULL DEFAULT ''`，并创建：

```sql
CREATE TABLE IF NOT EXISTS command_metric_minutes (
  bucket_minute TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT '',
  command_class TEXT NOT NULL DEFAULT '',
  task_type TEXT NOT NULL DEFAULT '',
  command TEXT NOT NULL DEFAULT '',
  execution_lane TEXT NOT NULL DEFAULT '',
  egress_type TEXT NOT NULL DEFAULT '',
  egress_key TEXT NOT NULL DEFAULT '',
  outcome TEXT NOT NULL DEFAULT '',
  command_count INTEGER NOT NULL DEFAULT 0,
  error_count INTEGER NOT NULL DEFAULT 0,
  timeout_count INTEGER NOT NULL DEFAULT 0,
  disconnected_count INTEGER NOT NULL DEFAULT 0,
  rate_limited_count INTEGER NOT NULL DEFAULT 0,
  latency_count INTEGER NOT NULL DEFAULT 0,
  latency_sum_ms INTEGER NOT NULL DEFAULT 0,
  latency_max_ms INTEGER NOT NULL DEFAULT 0,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (bucket_minute, source, command_class, task_type, command,
               execution_lane, egress_type, egress_key, outcome)
);
CREATE TABLE IF NOT EXISTS task_metric_minutes (
  bucket_minute TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT '',
  task_type TEXT NOT NULL DEFAULT '',
  execution_lane TEXT NOT NULL DEFAULT '',
  outcome TEXT NOT NULL DEFAULT '',
  run_count INTEGER NOT NULL DEFAULT 0,
  duration_count INTEGER NOT NULL DEFAULT 0,
  duration_sum_ms INTEGER NOT NULL DEFAULT 0,
  duration_max_ms INTEGER NOT NULL DEFAULT 0,
  queue_wait_count INTEGER NOT NULL DEFAULT 0,
  queue_wait_sum_ms INTEGER NOT NULL DEFAULT 0,
  queue_wait_max_ms INTEGER NOT NULL DEFAULT 0,
  attributed_command_count INTEGER NOT NULL DEFAULT 0,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (bucket_minute, source, task_type, execution_lane, outcome)
);
CREATE TABLE IF NOT EXISTS command_anomalies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  occurred_at DATETIME NOT NULL,
  run_id TEXT,
  account_id INTEGER,
  batch_task_id INTEGER,
  source TEXT NOT NULL DEFAULT '',
  task_type TEXT NOT NULL DEFAULT '',
  command TEXT NOT NULL DEFAULT '',
  execution_lane TEXT NOT NULL DEFAULT '',
  egress_type TEXT NOT NULL DEFAULT '',
  egress_key TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL,
  error_code INTEGER,
  latency_ms INTEGER,
  queue_wait_ms INTEGER,
  summary TEXT
);
CREATE INDEX IF NOT EXISTS idx_command_metrics_bucket ON command_metric_minutes(bucket_minute);
CREATE INDEX IF NOT EXISTS idx_task_metrics_bucket ON task_metric_minutes(bucket_minute);
CREATE INDEX IF NOT EXISTS idx_command_anomalies_time ON command_anomalies(occurred_at);
CREATE INDEX IF NOT EXISTS idx_command_anomalies_category ON command_anomalies(category, occurred_at);
```

仓储导出四个固定接口：`flushSchedulerObservationSnapshot(snapshot, targetDb = getDatabase())`、`cleanupSchedulerObservation(targetDb = getDatabase(), options = {})`、`querySchedulerObservationSummary(filters, targetDb = getDatabase())`、`querySchedulerObservationAnomalies(filters, targetDb = getDatabase())`。前者对两个分钟表使用 additive UPSERT，对异常表使用参数化 INSERT；后两者只接受已规范化的 cutoff、筛选枚举和分页数值。

把 `cleanupSchedulerObservation` 接入 `runDatabaseMaintenance()`，而不是任何命令或日志写入函数。

- [ ] **3.4 Verify GREEN**

仓储测试全部通过；检查临时数据库已删除。

- [ ] **3.5 Commit**

```powershell
git add backend/src/database/index.js backend/src/observability/schedulerObservationRepository.js backend/test/schedulerObservationRepository.test.js
git commit -m "feat: persist scheduler observation metrics"
```

---

## Task 4：建立全局观测服务、配置、刷新与关停

**Files**

- Create: `backend/src/observability/schedulerObservationService.js`
- Create: `backend/test/schedulerObservationService.test.js`
- Modify: `backend/src/config/index.js`
- Modify: `backend/src/index.js`
- Modify: `.env.example`
- Modify: `ecosystem.config.cjs`

**Why**

运行实例需要可开关、可注入测试、定时批量刷新，并在故障或关停时保持业务隔离。

**Impact / Compatibility**

生产由显式环境变量启用；禁用时不创建定时器。关停时先停止调度，再尽力刷新观测，最后关闭数据库。

**Verification**

```powershell
pnpm --dir backend exec node --test test/schedulerObservationService.test.js
```

- [ ] **4.1 Write test**

使用假时钟、假定时器和假仓储写四个测试：关闭时定时器创建次数为 0；一次 tick 只调用一次仓储；仓储抛错后调用方不收到异常且 `flushErrors=1`；`stop({ flush: true })` 清理定时器并在存在待写数据时进行一次最终刷新。

- [ ] **4.2 Verify RED**

运行服务测试，预期模块缺失失败。

- [ ] **4.3 Minimal code**

配置字段固定为有界值：

```js
observability: {
  enabled: String(process.env.SCHEDULER_OBSERVABILITY_ENABLED || '0') === '1',
  flushIntervalMs: clamp(process.env.SCHEDULER_OBSERVABILITY_FLUSH_MS, 1000, 60000, 10000),
  slowCommandMs: clamp(process.env.SCHEDULER_OBSERVABILITY_SLOW_COMMAND_MS, 1000, 30000, 5000),
  retentionDays: clamp(process.env.SCHEDULER_OBSERVABILITY_RETENTION_DAYS, 1, 3, 3),
  maxMetricKeys: clamp(process.env.SCHEDULER_OBSERVABILITY_MAX_METRIC_KEYS, 1000, 100000, 20000),
  maxAnomalyBuffer: clamp(process.env.SCHEDULER_OBSERVABILITY_MAX_ANOMALY_BUFFER, 100, 20000, 5000),
  maxAnomalyRows: clamp(process.env.SCHEDULER_OBSERVABILITY_MAX_ANOMALY_ROWS, 1000, 50000, 50000),
}
```

服务导出固定的非抛错入口：

```js
export function startSchedulerObservationService(options = {}) {}
export async function stopSchedulerObservationService({ flush = true } = {}) {}
export function observeCommandSent(event) {}
export function observeCommandSettled(event) {}
export function observeTaskSettled(event) {}
export function observeAccountQueue(event) {}
export function getSchedulerObservationHealth() {}
```

`index.js` 在数据库初始化成功后启动服务；关停顺序为停止调度器、停止维护任务、关闭 HTTP、最终刷新观测、关闭数据库。

`.env.example` 写清 3 天硬上限；`ecosystem.config.cjs` 使用 `process.env.SCHEDULER_OBSERVABILITY_ENABLED || '1'` 显式启用生产观测。

- [ ] **4.4 Verify GREEN**

服务测试通过；额外运行：

```powershell
pnpm --dir backend exec node -e "import('./src/config/index.js').then(({default:c}) => console.log(c.observability))"
```

预期默认本地 `enabled=false`、`retentionDays=3`。

- [ ] **4.5 Commit**

```powershell
git add backend/src/observability/schedulerObservationService.js backend/test/schedulerObservationService.test.js backend/src/config/index.js backend/src/index.js .env.example ecosystem.config.cjs
git commit -m "feat: run scheduler observation service"
```

---

## Task 5：在 GameClient 发送边界记录真实命令生命周期

**Files**

- Modify: `backend/src/utils/gameClient.js`
- Create: `backend/test/gameClientObservability.test.js`
- Modify: `backend/test/gameClient.test.js`

**Why**

只有最终发送边界能准确统计真实命令、响应耗时、超时、断线和实际代理出口。

**Impact / Compatibility**

不得改变 seq/ack、Promise 注册顺序、超时起点、回包匹配和断线拒绝语义。

**Verification**

```powershell
pnpm --dir backend exec node --test test/gameClientObservability.test.js test/gameClient.test.js
```

- [ ] **5.1 Write test**

通过 `GameClient` 的可选 `commandObserver` 注入假观察器，写六个测试：成功只产生一次 `sent` 和一次 `success`；超时只结算一次 `timeout`；断线批量拒绝时每个 pending 只结算一次 `disconnected`；业务错误保持原 Error 对象且观察事件含 `code=200400`；代理观察事件不含 host/port；`_sys/ack` 被归为 system 命令。

- [ ] **5.2 Verify RED**

运行测试，预期缺少观察回调而失败；现有 `gameClient.test.js` 必须保持绿色。

- [ ] **5.3 Minimal code**

构造器增加内部可选项：

```js
this.commandObserver = options.commandObserver || schedulerObservationService;
```

在实际 `ws.send(encoded)` 前生成一次发送元数据；`promises` 中保存不可变的 observation 元数据。新增内部幂等结算辅助函数，所有成功、错误、超时和 `_rejectPendingPromises` 统一调用它，结算后立即清除引用。

调用观察器必须包在内部 `try/catch` 中，且不能复用业务错误处理分支。观察器得到当前 AsyncLocalStorage 任务上下文、`accountId`、命令、开始时间、实际代理指纹和错误结构；不得得到 `params`、encoded packet 或 response body。

- [ ] **5.4 Verify GREEN**

新旧 GameClient 测试全部通过；确认原有超时和回包匹配断言未修改为宽松条件。

- [ ] **5.5 Commit**

```powershell
git add backend/src/utils/gameClient.js backend/test/gameClientObservability.test.js backend/test/gameClient.test.js
git commit -m "feat: observe backend game commands"
```

---

## Task 6：观测账户队列和两条后端任务链路

**Files**

- Modify: `backend/src/utils/accountTaskCoordinator.js`
- Modify: `backend/test/accountTaskCoordinator.test.js`
- Modify: `backend/src/scheduler/index.js`
- Modify: `backend/src/batchScheduler/index.js`
- Create: `backend/test/schedulerObservationIntegration.test.js`

**Why**

把命令关联到来源、账户、任务类型和调度车道，并测量真实账户槽位等待时间。

**Impact / Compatibility**

不改变排队顺序、槽位释放时机、任务批处理、客户端复用或重连逻辑。

**Verification**

```powershell
pnpm --dir backend exec node --test test/accountTaskCoordinator.test.js test/schedulerObservationIntegration.test.js
```

- [ ] **6.1 Write test**

增加五个测试：并发上限为 1 时账户启动顺序仍为 `[1, 2]` 且账户 2 的 `waitMs > 0`；普通调度命令继承 `scheduler/accountId/taskType/lane`；批量调度命令继承 `batch/batchTaskId/accountId/taskType`；lane 为 proxy 但 client 无代理时 actual egress 仍为 direct；观察器抛错时任务返回值或原错误对象不变。

- [ ] **6.2 Verify RED**

运行测试；预期缺少队列事件和任务上下文关联而失败。

- [ ] **6.3 Minimal code**

在 `runAccountTaskExclusive` 中只增加计时与非抛错事件：记录请求槽位时间、获得槽位时间、lane、账户 ID 和当前外层上下文；不得移动 `acquireGlobalAccountSlot` 或 `releaseGlobalAccountSlot`。

在普通调度的账户批次和 `executeTask` 外层建立来源上下文；在每个 `executeTaskWithFlowControl` 调用最小边界使用 `runObservedTask`。批量调度同样在账户批次建立外层上下文，在每个 task type 执行建立子上下文。

上下文来源值固定为：

- `scheduler`
- `scheduler-catchup`
- `scheduler-manual`
- `batch`
- `system`

不把代理车道当作实际出口；实际出口仍由 `GameClient` 计算。

- [ ] **6.4 Verify GREEN**

集成测试通过，并重跑：

```powershell
pnpm --dir backend exec node --test test/accountTaskCoordinator.test.js test/taskExecutionControl.test.js
```

预期现有 4 项协调/重连测试保持通过。

- [ ] **6.5 Commit**

```powershell
git add backend/src/utils/accountTaskCoordinator.js backend/test/accountTaskCoordinator.test.js backend/src/scheduler/index.js backend/src/batchScheduler/index.js backend/test/schedulerObservationIntegration.test.js
git commit -m "feat: associate scheduler tasks with command metrics"
```

---

## Task 7：增加管理员只读查询 API

**Files**

- Modify: `backend/src/routes/stats.js`
- Create: `backend/test/schedulerObservabilityRoutes.test.js`

**Why**

为管理页面提供受限、可分页、不可注入的汇总和异常查询。

**Impact / Compatibility**

只新增端点；现有 `/api/stats/*` 保持不变。新端点同时要求登录和管理员权限。

**Verification**

```powershell
pnpm --dir backend exec node --test test/schedulerObservabilityRoutes.test.js
```

- [ ] **7.1 Write test**

把范围解析和响应组装提取为可测试导出，写五个测试：只接受 `1h/6h/24h/3d`；`pageSize` 被限制在 `1..100`；普通用户访问得到 403；汇总响应精确包含 `headline/series/tasks/egresses/health`；异常响应分页且序列化结果不包含代理地址、参数、body 或 token 字段。

- [ ] **7.2 Verify RED**

运行路由测试，预期端点/解析器缺失失败。

- [ ] **7.3 Minimal code**

在 `stats.js` 引入 `adminOnly`，只对 `/observability/summary` 和 `/observability/anomalies` 两个新 GET 端点使用。summary 端点调用规范化后的汇总仓储函数；anomalies 端点调用规范化后的分页仓储函数。

响应契约：

```js
{
  success: true,
  data: {
    range,
    generatedAt,
    headline,
    series,
    tasks,
    egresses,
    health,
  },
}
```

异常接口返回 `{ items, total, page, pageSize }`。所有筛选值使用 allow-list 或 SQL 参数，不允许客户端传列名、排序 SQL 或任意时间表达式。

- [ ] **7.4 Verify GREEN**

路由测试通过；对非管理员和管理员分别执行一次 API 集成冒烟测试。

- [ ] **7.5 Commit**

```powershell
git add backend/src/routes/stats.js backend/test/schedulerObservabilityRoutes.test.js
git commit -m "feat: expose scheduler observation APIs"
```

---

## Task 8：建立前端视图模型与 API 客户端

**Files**

- Create: `frontend/src/utils/schedulerObservabilityViewModel.js`
- Create: `frontend/test/schedulerObservabilityViewModel.test.js`
- Modify: `frontend/src/api/index.js`

**Why**

先固定页面数据格式、耗时显示、放大倍数和轻量趋势计算，减少 Vue 页面中的业务逻辑。

**Impact / Compatibility**

只增加 API 方法和纯工具，不影响现有页面。

**Verification**

```powershell
pnpm --dir frontend exec node --test test/schedulerObservabilityViewModel.test.js
```

- [ ] **8.1 Write test**

写五个测试：`120` 格式化为 `120 ms`、`1500` 格式化为 `1.50 s`；`runCount=0` 的放大倍数为 `0`；全零趋势不产生 NaN；出口标签只显示“直连”或 12 位短匿名指纹；中文异常标签不改变原始 category 值。

- [ ] **8.2 Verify RED**

运行测试，预期工具模块缺失失败。

- [ ] **8.3 Minimal code**

导出：

```js
export const OBSERVABILITY_RANGE_OPTIONS = [
  { label: '最近 1 小时', value: '1h' },
  { label: '最近 6 小时', value: '6h' },
  { label: '最近 24 小时', value: '24h' },
  { label: '最近 3 天', value: '3d' },
];
export function formatMetricDuration(ms) {}
export function formatAmplification(commandCount, runCount) {}
export function buildTrendBars(series) {}
export function formatEgressLabel(row) {}
export function formatAnomalyCategory(category) {}
```

向 `api.stats` 增加参数化方法，使用 request 的 `params` 选项而不是字符串拼接：

```js
getSchedulerObservabilitySummary: (params) => request.get('/stats/observability/summary', { params }),
getSchedulerObservabilityAnomalies: (params) => request.get('/stats/observability/anomalies', { params }),
```

- [ ] **8.4 Verify GREEN**

前端视图模型测试通过。

- [ ] **8.5 Commit**

```powershell
git add frontend/src/utils/schedulerObservabilityViewModel.js frontend/test/schedulerObservabilityViewModel.test.js frontend/src/api/index.js
git commit -m "feat: add scheduler observation view model"
```

---

## Task 9：实现管理员“调度观测”页面和导航

**Files**

- Create: `frontend/src/views/SchedulerObservability.vue`
- Modify: `frontend/src/router/index.js`
- Modify: `frontend/src/layouts/MainLayout.vue`

**Why**

让管理员不读取数据库或服务器日志即可判断高峰、放大任务、异常命令和实际出口。

**Impact / Compatibility**

新增管理员路由和菜单项；非管理员仍由现有路由守卫重定向。页面只读、30 秒轮询，不增加图表依赖。

**Verification**

```powershell
pnpm --dir frontend typecheck
pnpm --dir frontend build
```

- [ ] **9.1 Write test**

先扩展前端视图模型测试，使用一份完整 API fixture 验证页面需要的数据均可映射：6 个 headline、趋势、任务表、出口表、健康状态和分页异常；预期新 fixture 映射函数缺失而失败。

- [ ] **9.2 Verify RED**

运行视图模型测试，确认因缺少 `buildSchedulerObservabilityViewModel` 失败。

- [ ] **9.3 Minimal code**

页面必须包含：

- 范围、来源、任务类型和出口类型筛选；
- 6 个 headline 指标；
- 使用 CSS 高度条或内联 SVG 的轻量趋势，不增加依赖；
- 任务表：运行次数、命令数、放大倍数、平均/最大耗时、异常率；
- 出口表：直连/匿名代理、命令量、异常率；
- 最近异常表与分页；
- 观测健康提示：最后刷新、flushErrors、droppedMetrics、droppedAnomalies；
- loading、空状态、API 错误提示；
- 30 秒轮询，并在 `onUnmounted` 清理定时器；筛选变化时重置异常页码并立即刷新。

路由：

```js
{
  path: 'scheduler-observability',
  name: 'SchedulerObservability',
  component: () => import('@views/SchedulerObservability.vue'),
  meta: { title: '调度观测', requiresAdmin: true },
}
```

菜单使用现有 Element Plus 图标并设置 `adminOnly: true`。桌面和移动菜单都由同一 `menuItems` 数据源生成，无需重复修改。

- [ ] **9.4 Verify GREEN**

运行视图模型测试、类型检查和生产构建；用管理员账号确认页面可访问，用普通账号确认被重定向；在窄屏确认表格可横向滚动且筛选区换行。

- [ ] **9.5 Commit**

```powershell
git add frontend/src/views/SchedulerObservability.vue frontend/src/router/index.js frontend/src/layouts/MainLayout.vue frontend/src/utils/schedulerObservabilityViewModel.js frontend/test/schedulerObservabilityViewModel.test.js
git commit -m "feat: add scheduler observation dashboard"
```

---

## Task 10：负载、故障隔离、保留期与文档验证

**Files**

- Create: `backend/test/schedulerObservationLoad.test.js`
- Modify: `README.md`
- Modify: `docs/aegis/specs/2026-07-15-scheduler-observability-design.md` only if implementation evidence requires a reviewed correction

**Why**

上线前证明 10 万事件不会转化为 10 万次 SQLite 写入，且所有数据确实只保留 3 天。

**Impact / Compatibility**

只增加测试和部署说明；不得为了让负载测试通过而放宽故障隔离或保留要求。

**Verification**

```powershell
pnpm --dir backend exec node --test test/schedulerObservationLoad.test.js
pnpm --dir backend test
pnpm --dir frontend exec node --test test/schedulerObservabilityViewModel.test.js
pnpm --dir frontend typecheck
pnpm --dir frontend build
git diff --check
```

- [ ] **10.1 Write test**

负载测试生成 100,000 个确定性事件，断言：

```js
assert.equal(totalRecordedCommands, 100000);
assert.ok(snapshot.commandMetrics.length < 5000);
assert.ok(snapshot.anomalies.length <= configuredMaxAnomalies);
assert.ok(estimatedSnapshotJsonBytes < 5 * 1024 * 1024);
assert.equal(snapshotContainsSensitivePayload, false);
```

增加仓储保留测试，固定当前时间后插入 4 天前、3 天内和超量数据，断言清理后只保留 3 天内且行数不超过上限。

- [ ] **10.2 Verify RED**

在完整实现接入前运行负载测试；若未实现容量计数、行数上限或脱敏检查，测试应失败。

- [ ] **10.3 Minimal code**

只修正负载测试揭示的边界问题；在 README 增加：

- 开关和所有观测环境变量；
- 3 天硬上限；
- 数据不包含哪些敏感内容；
- 管理页面入口；
- 首次上线 24–72 小时观察清单；
- 关闭观测的回滚方式：设置 `SCHEDULER_OBSERVABILITY_ENABLED=0` 并重启单个后端进程；
- 禁止在首轮观测期间同时调整调度并发。

- [ ] **10.4 Verify GREEN**

执行本节全部命令。记录：完整测试数量、负载测试事件数/聚合键数、前端产物构建结果和数据库清理结果。

- [ ] **10.5 Commit**

```powershell
git add backend/test/schedulerObservationLoad.test.js README.md
git commit -m "test: verify scheduler observation production bounds"
```

---

## Task 11：最终架构复核与上线交接

**Files**

- Review all files listed in File Map
- Update: `docs/aegis/INDEX.md` only if execution creates additional authoritative documents

**Why**

确认观测模块没有成为执行依赖，也没有扩大数据敏感面或悄悄修正业务行为。

**Impact / Compatibility**

本任务不增加功能，只处理验证发现的计划内缺陷；任何主动限频、代理修复或调度重构必须另开规格。

**Verification**

```powershell
git status --short
git diff --check
git log --oneline -12
```

- [ ] **11.1 Write test / review checklist**

创建执行检查记录，逐项确认：

- 所有观察入口非抛错；
- 禁用开关无定时器和写入；
- 不存储禁止字段；
- 普通/批量/补偿/system 命令来源可区分；
- lane 与 actual egress 分离；
- 3 天时间与行数上限同时有效；
- 管理 API 仅管理员可访问；
- 页面轮询可清理；
- 无新增依赖；
- 现有调度参数零变化。

- [ ] **11.2 Verify baseline**

对照基线 7 个架构维度检查 owner、边界、契约、依赖方向、fallback 和熵变化。若发现实现偏离已批准规格，回到对应任务修正，不通过新增兼容分支掩盖。

- [ ] **11.3 Minimal closeout changes**

仅允许修正文档、测试遗漏或已证实的规格内缺陷；禁止顺手修复批量代理、全局限流或队列持久化。

- [ ] **11.4 Verify final state**

重新执行总体验证命令，并确认工作区只包含本计划文件。上线前保存一份不含敏感数据的验证摘要：测试结果、观测开关、刷新耗时、表行数和数据库大小。

- [ ] **11.5 Commit**

若本任务产生必要修正：

```powershell
git add <本任务实际修正文件>
git commit -m "chore: finalize scheduler observation rollout"
```

若无修正则不创建空提交。

## Repair Track（修复轨）

本计划不是修复现有限频或代理问题。唯一要解决的架构缺口是“没有统一、低成本的命令观测来源”：

- 根因：任务日志位于业务结果层，无法看到最终命令发送和真实出口。
- 正确所有者：新观测模块聚合指标；`GameClient` 只产生生命周期事件。
- 最小变化：被动事件、内存聚合、批量 SQLite 写、只读 API/UI。
- 验证：故障隔离测试、命令生命周期测试、10 万事件负载测试和完整回归。

## Retirement Track（退役轨）

- 现有任务日志继续保留，原因是它们是业务审计和补偿证据；不由观测表替代。
- 现有 `/api/stats/system-status` 继续保留，原因是它提供即时调度状态；新页面复用其中能复用的健康概念，但不复制执行权威。
- 不新增第二套命令发送器、错误重试器或代理选择器。
- 当后续主动限流设计获批时，可以复用稳定的错误分类和真实出口描述；是否提升为执行决策来源必须另行评审。

## Risks and Rollback（风险与回滚）

- **SQLite 写入阻塞**：10 秒批量短事务、内存 snapshot-and-swap；通过刷新耗时和负载测试验证。
- **维度爆炸**：只允许固定维度、命令名归一化、内存键数和持久化行数双重上限。
- **敏感信息泄漏**：生产者不传 params/body，异常在进入缓冲前脱敏，API 契约测试禁止敏感字段。
- **重复结算**：pending observation 使用幂等 settled 标记，成功/错误/超时/断线共享结算辅助函数。
- **观测失效不自知**：页面展示 lastFlushAt、flushErrors 和 dropped counters。
- **快速回滚**：设置 `SCHEDULER_OBSERVABILITY_ENABLED=0` 并重启后端；保留新增表不影响业务，确认稳定后按正常维护窗口清理。
- **多进程部署**：第一版只承诺当前单 PM2 进程；扩容到多进程前必须评审 SQLite 竞争、跨进程健康聚合和统一 runId。

## Plan Self-Review（计划自审）

- 规格覆盖：采集、上下文、出口、聚合、异常、3 天保留、API、页面、自健康、负载与上线均有对应任务。
- 占位检查：没有未决实现项；所有未知均有有界处理策略。
- 类型一致：来源、outcome、lane、egress 和 API range 使用固定枚举值。
- 兼容检查：不改变执行语义，主动限流和代理修复明确排除。
- 验证检查：每个主要切片均包含 RED、最小实现、GREEN 和提交步骤。
- 双轨检查：新观测所有者明确；现有业务日志和 system-status 保留理由明确。
