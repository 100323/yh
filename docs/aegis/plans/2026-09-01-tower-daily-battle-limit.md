# 爬塔每日战斗上限实施计划

## 问题与基线

当前 live runtime 是 `backend/` + `frontend/`。`TOWER`、`WEIRD_TOWER` 的循环上限已被限制为 10 层，但普通 scheduler、batch scheduler 和前端批量执行器各自持有执行路径；任务配置仍允许 interval cron。需要在共享规则、持久化、API、两个后端 scheduler 和两个前端入口同时收紧。

## 文件边界

- `backend/src/utils/towerTaskConfig.js`：每日上限常量、规范化与计数接口。
- `backend/src/database/index.js`：每日塔战斗计数表/索引和原子读写。
- `backend/src/scheduler/index.js`：普通 scheduler 两类塔循环接入计数。
- `backend/src/batchScheduler/index.js`：batch scheduler 两类塔循环接入计数。
- `backend/src/routes/tasks.js`：固定 cron、保存约束、历史每小时迁移。
- `backend/src/routes/batchScheduler.js`：批量计划创建/更新的塔 cron 约束。
- `frontend/src/views/Tasks.vue`：隐藏塔任务 interval、加载/保存固定 09:20。
- `frontend/src/utils/batch/constants.js`：批量任务默认时间改为 09:20。
- `frontend/src/utils/batch/tasksTower.js` 与 `frontend/src/utils/batch/towerConfig.js`：前端手动批量路径接入 10 次边界。
- `backend/test/towerTaskConfig.test.js` 及新增定向测试：先 RED，再 GREEN。
- 本设计与计划文档：记录兼容、迁移和验收证据。

## 分步执行

1. 先为共享规范化、每小时 cron 识别、普通 scheduler、batch scheduler 和前端默认值写失败测试；运行 `pnpm --dir backend test` 或等价 Node test 命令确认 RED。
2. 增加数据库每日计数结构和共享原子 helper，覆盖上海业务日期、账号/任务类型隔离、成功确认和失败释放。
3. 改普通 scheduler 与 batch scheduler 的塔循环，保留现有奖励/能量/重试行为，验证成功战斗最多 10 次。
4. 改任务元数据、保存 API、批量计划 API 和启动迁移；验证旧 interval 形状统一到 `20 9 * * *`，其他自定义 cron 不变。
5. 改前端任务配置和批量常量/执行器；验证旧 interval 加载后不能恢复、保存请求固定 09:20。
6. 运行后端定向测试、前端测试、前端构建和必要的类型检查；检查只 stage 本次文件，保留工作区其他修改。
7. 提交 `fix: enforce daily tower battle limits`，推送 `origin/codex/tower-floor-limits`；如线上发布可执行，先备份、构建、上传、重启 PM2，再做健康和数据库核验。

## 兼容与回归

- `maxFloors=0` 继续关闭塔任务。
- 既有 `CAR_SEND`/`CAR_CLAIM` 停用边界不能回退。
- 普通 scheduler、batch scheduler、手动前端批量三条路径都必须受每日上限约束。
- 只强迁移每小时 cron，不重写其他任务或非每小时塔 cron。

## 验证命令

```text
pnpm --dir backend test
pnpm --dir frontend test
pnpm --dir frontend build
pnpm --dir frontend typecheck
git diff --check
git diff --stat
```

## 残余风险

请求超时但服务器已受理的单次战斗无法由本地客户端完全判定；发布后需以线上任务日志、每日计数记录和实际战斗帧抽查作为补充验证。

## Retirement Track

本次退休的是塔任务的 interval 配置入口和历史每小时调度形状；保留普通 daily/weekly 配置能力给其他任务，保留塔的层数上限作为更小边界。
