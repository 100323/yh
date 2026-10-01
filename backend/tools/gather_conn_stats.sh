#!/bin/bash
# 采集连接复用 / 重连相关的日志统计（错峰 + 方向A 效果验证用）
# 用法: bash gather_conn_stats.sh [天数,默认1]
DAYS="${1:-1}"
LOG_DIR="/home/ubuntu/.pm2/logs"
OUT="/home/ubuntu/zy/backend/data/conn-stats-$(date +%Y%m%d-%H%M%S).txt"

exec > >(tee "$OUT") 2>&1

echo "=== 连接复用统计 (最近 ${DAYS} 天) ==="
echo "采集时间: $(date '+%Y-%m-%d %H:%M:%S')"
echo

# pm2-logrotate 会切分日志，取所有 rotation 文件
FILES=$(ls -1t ${LOG_DIR}/xyzw-backend-out*.log 2>/dev/null | head -20)
echo "扫描日志文件: $(echo $FILES | tr '\n' ' ')"
echo

echo "--- 1. 连接复用命中（♻️ 复用已有WebSocket连接）---"
grep -h "复用已有WebSocket连接" $FILES 2>/dev/null | wc -l

echo
echo "--- 2. 新建连接（握手/连接建立）---"
grep -hcE "连接已建立|WebSocket 已连接|ws.*connected|连接成功" $FILES 2>/dev/null | paste -sd+ | bc 2>/dev/null || echo 0

echo
echo "--- 3. 主动断开（账号批次执行结束）---"
grep -h "账号批次执行结束，连接已断开" $FILES 2>/dev/null | wc -l

echo
echo "--- 4. 弃用连接（超时/超龄重连）---"
grep -hcE "discardInactiveClient|连接已超时|连接超过最大存活|丢弃.*连接" $FILES 2>/dev/null | paste -sd+ | bc 2>/dev/null || echo 0

echo
echo "--- 5. 每小时的复用 vs 新建（按日志时间戳）---"
echo "[复用]"
grep -h "复用已有WebSocket连接" $FILES 2>/dev/null | grep -oE '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}|[0-9]{2}:[0-9]{2}:[0-9]{2}' | grep -oE '^.{2}' | sort | uniq -c | sort -k2 | head -30
echo "[断开]"
grep -h "账号批次执行结束，连接已断开" $FILES 2>/dev/null | grep -oE '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}|[0-9]{2}:[0-9]{2}:[0-9]{2}' | grep -oE '^.{2}' | sort | uniq -c | sort -k2 | head -30

echo
echo "--- 6. 队列/并发相关 ---"
echo "等待并发槽位: $(grep -hcE '等待并发|排队等待|acquire.*slot' $FILES 2>/dev/null | paste -sd+ | bc 2>/dev/null || echo 0)"
echo "批次开始: $(grep -hcE '账号批次执行开始|开始执行账号批次' $FILES 2>/dev/null | paste -sd+ | bc 2>/dev/null || echo 0)"

echo
echo "--- 7. 账号批次执行时长样本（最近 30 条）---"
grep -hE "账号批次执行结束" $FILES 2>/dev/null | tail -30

echo
echo "=== 完成，输出已保存: $OUT ==="
