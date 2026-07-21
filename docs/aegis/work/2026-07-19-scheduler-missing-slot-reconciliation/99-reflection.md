# Reflection

Goal：高峰正常定时任务不再因 cron callback 未发生而静默消失。

DeeperCause：已确认。直接原因是 node-cron 3.0.3 默认不恢复跨秒检查；架构原因是 3308 个独立 timer 同时唤醒且 callback 是槽位创建的唯一入口。

Evidence：线上缺口与同分钟 fan-out 强相关，缺失点位于槽位之前；依赖源码与本地阻塞复现一致。

Risk / Unknown：新对账需要未来高峰分钟的生产数据确认实际覆盖率；PM2 SIGINT 来源仍未知。旧每任务 cron 暂留，仍有 timer 惊群开销，但已不再是唯一可靠触发源。

Decision：完成候选。Repair track 已发布并验证；Retirement track 是连续观察 3 天后删除每任务 cron timer。信心 A（直接依赖复现、目标测试、全量回归、独立审查和线上验证）。
