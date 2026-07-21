# TaskIntentDraft

Requested outcome：修复凌晨和高峰正常定时任务静默漏做，并让账号前端日志能够看到系统检测和补入。

Scope：普通后端账号 scheduler 的触发到持久化槽位边界；不修改具体游戏命令与批量 scheduler。

Non-goals：不处理“活动未开放、已领取、条件不满足、出了点小问题、版本过低”；不调整并发、错峰、重试、重连、代理或任务顺序；不定位所有 PM2 SIGINT 来源。

Risk hints：重复购买/领奖/战斗、跨时区槽位错误、高峰补入形成突发、重启后重复执行。

BaselineReadSetHint：`AGENTS.md`、初始架构 baseline、2026-07-18 槽位恢复计划、scheduler/ledger/node-cron scheduler 源码、线上 2026-07-19 槽位缺口统计。

ImpactStatementDraft：canonical owner 仍是 `backend/src/scheduler/index.js` 与 `scheduleSlotLedger.js`；新增纯时间槽位和对账模块。SQLite 唯一键是最终去重边界，原任务队列是唯一执行路径。
