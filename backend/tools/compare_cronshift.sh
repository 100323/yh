#!/bin/bash
# ============================================================
# 错峰 + 方向A 改造效果对比主脚本
# 用法: bash compare_cronshift.sh
# 输出: 终端摘要 + /home/ubuntu/zy/backend/data/compare-<时间戳>.txt
# ============================================================
set -uo pipefail
TS=$(date +%Y%m%d-%H%M%S)
OUT="/home/ubuntu/zy/backend/data/compare-${TS}.txt"
LOG_DIR="/home/ubuntu/.pm2/logs"
exec > >(tee "$OUT") 2>&1

echo "############################################################"
echo "#  错峰 + 方向A（连接复用）改造效果对比报告"
echo "#  生成时间: $(date '+%Y-%m-%d %H:%M:%S %Z')  (UTC $(date -u '+%H:%M'))"
echo "############################################################"
echo

echo "########## 一、进程与配置现状 ##########"
pm2 list 2>/dev/null | grep -E "xyzw-backend|name"
echo
echo "[关键环境变量]"
pm2 env $(pm2 jlist 2>/dev/null | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{const j=JSON.parse(s);const p=j.find(x=>x.name==='xyzw-backend');console.log(p?p.pm_id:'')}catch(e){console.log('')}})") 2>/dev/null \
  | grep -E '^(MAX_CONCURRENT_ACCOUNTS|WS_REUSE_MAX_IDLE_MS|WS_REUSE_MAX_AGE_MS|SCHEDULER_STAGGER_WINDOW_MS|ALLOW_PROJECT_LOCAL_DB_PATH|DB_PATH)'
echo

echo "########## 二、健康检查 ##########"
echo -n "本地 3001: "; curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3001/ 
echo -n "nginx 80 : "; curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1/
echo -n "进程状态 : "; pm2 jlist 2>/dev/null | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{const j=JSON.parse(s);const p=j.find(x=>x.name==='xyzw-backend');console.log(p?p.pm2_env.status+' restarts='+p.pm2_env.restart_time:'NOT_FOUND')}catch(e){console.log('ERR')}})"
echo

echo "########## 三、数据库快照（错峰任务 cron 落地） ##########"
cd /home/ubuntu/zy/backend
node gather_snapshot.cjs after-run 2>&1 | sed -n '/错峰任务 cron 分布/,/WebSocket 连接/p'
echo

echo "########## 四、今日各小时执行量（错峰效果核心指标） ##########"
node -e "
const db=require('better-sqlite3')('data/xyzw.db',{readonly:true,timeout:15000});
const rows=db.prepare(\"SELECT strftime('%H', executed_at, '+8 hours') AS hh, COUNT(*) c FROM task_execution_markers WHERE date(executed_at,'+8 hours')=date('now','+8 hours') GROUP BY hh ORDER BY hh\").all();
let total=0; for(const r of rows) total+=r.c;
console.log('小时  | 执行数 | 占比');
for(const r of rows) console.log(String(r.hh).padStart(4)+'  | '+String(r.c).padStart(6)+' | '+(r.c/total*100).toFixed(1)+'%');
console.log('合计  | '+String(total).padStart(6)+' | 100%');
const peak=rows.reduce((a,b)=>b.c>a.c?b:a,{c:0});
console.log('峰值小时: '+peak.hh+' 点 = '+peak.c+' 次 ('+(peak.c/total*100).toFixed(1)+'%)');
" 2>&1
echo

echo "########## 五、连接复用 / 重连统计（日志侧） ##########"
FILES=$(ls -1t ${LOG_DIR}/xyzw-backend-out*.log 2>/dev/null | head -10)
cnt() { grep -hE "$1" $FILES 2>/dev/null | wc -l | tr -d ' '; }
echo "复用命中(♻️):     $(cnt '复用已有WebSocket连接')"
echo "批次结束断开(🧹): $(cnt '账号批次执行结束')"
echo "弃用连接:         $(cnt 'discardInactiveClient|连接已超时|超过最大存活')"
echo "连接建立:         $(cnt '连接已建立|WebSocket 已连接')"
echo "扫描日志文件数:   $(echo "$FILES" | grep -c . )"
echo

echo "########## 六、任务延迟诊断：计划时刻 vs 实际执行 ##########"
node -e "
const db=require('better-sqlite3')('data/xyzw.db',{readonly:true,timeout:15000});
const rows=db.prepare(\"SELECT task_type, strftime('%H',executed_at,'+8 hours') hh, COUNT(*) c FROM task_execution_markers WHERE date(executed_at,'+8 hours')=date('now','+8 hours') GROUP BY task_type, hh ORDER BY task_type, hh\").all();
const byType={};
for(const r of rows){ (byType[r.task_type]=byType[r.task_type]||[]).push(r.hh+':'+r.c); }
for(const t of Object.keys(byType).sort()) console.log(t.padEnd(26)+byType[t].join('  '));
" 2>&1
echo

echo "########## 七、用户账号今日执行明细 ##########"
node -e "
const db=require('better-sqlite3')('data/xyzw.db',{readonly:true,timeout:15000});
const accts=db.prepare('SELECT id,name,remark FROM game_accounts WHERE user_id=45 ORDER BY id').all();
for(const a of accts){
  const t=db.prepare(\"SELECT COUNT(*) n, MIN(strftime('%H:%M',executed_at,'+8 hours')) f, MAX(strftime('%H:%M',executed_at,'+8 hours')) l FROM task_execution_markers WHERE account_id=? AND date(executed_at,'+8 hours')=date('now','+8 hours')\").get(a.id);
  const un=db.prepare(\"SELECT task_type,latest_status FROM task_execution_markers WHERE account_id=? AND date(updated_at,'+8 hours')=date('now','+8 hours') AND latest_status NOT IN ('success','completed','done')\").all(a.id);
  console.log('#'+a.id+' '+String(a.remark||a.name).padEnd(26)+' 今日 '+String(t.n).padStart(3)+' 条  '+t.f+'~'+t.l+'  未完成:'+un.length);
}
" 2>&1
echo

echo "########## 八、慢命令 / 异常（今日） ##########"
node -e "
const db=require('better-sqlite3')('data/xyzw.db',{readonly:true,timeout:15000});
console.log('[慢命令 Top]');
try{
  const r=db.prepare(\"SELECT task_type, SUM(slow_count) sc, SUM(timeout_count) tc, SUM(error_count) ec FROM command_metric_minutes WHERE date(bucket_minute,'+8 hours')=date('now','+8 hours') GROUP BY task_type HAVING sc+tc+ec>0 ORDER BY sc+tc+ec DESC LIMIT 15\").all();
  for(const x of r) console.log('  '+String(x.task_type).padEnd(26)+'slow='+x.sc+' timeout='+x.tc+' error='+x.ec);
}catch(e){console.log('  '+e.message)}
console.log('[异常分类 Top]');
try{
  const r=db.prepare(\"SELECT category, COUNT(*) c FROM command_anomalies WHERE date(occurred_at,'+8 hours')=date('now','+8 hours') GROUP BY category ORDER BY c DESC LIMIT 15\").all();
  for(const x of r) console.log('  '+String(x.category).padEnd(30)+x.c);
}catch(e){console.log('  '+e.message)}
" 2>&1
echo

echo "############################################################"
echo "#  报告结束  文件: $OUT"
echo "############################################################"
