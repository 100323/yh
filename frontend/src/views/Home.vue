<template>
  <div class="home-page">
    <el-row :gutter="16" class="stats-row">
      <el-col :xs="12" :sm="8" :lg="4">
        <el-card class="stat-card">
          <div class="stat-info">
            <div class="stat-value">{{ stats.accountCount }}</div>
            <div class="stat-label">账号总数</div>
          </div>
        </el-card>
      </el-col>
      
      <el-col :xs="12" :sm="8" :lg="4">
        <el-card class="stat-card">
          <div class="stat-info">
            <div class="stat-value">{{ stats.enabledTaskCount }}</div>
            <div class="stat-label">启用调度总数（单账号+批量）</div>
          </div>
        </el-card>
      </el-col>
      
      <el-col :xs="12" :sm="8" :lg="4">
        <el-card class="stat-card">
          <div class="stat-info">
            <div class="stat-value">{{ stats.todayLogCount }}</div>
            <div class="stat-label">今日执行记录（单账号+批量）</div>
          </div>
        </el-card>
      </el-col>

      <el-col :xs="12" :sm="8" :lg="4">
        <el-card class="stat-card pending">
          <div class="stat-info">
            <div class="stat-value">{{ stats.pendingTaskCount }}</div>
            <div class="stat-label">待执行调度（单账号+批量）</div>
          </div>
        </el-card>
      </el-col>

      <el-col :xs="12" :sm="8" :lg="4">
        <el-card class="stat-card error">
          <div class="stat-info">
            <div class="stat-value">{{ stats.failedTaskCount }}</div>
            <div class="stat-label">今日失败记录（单账号+批量）</div>
          </div>
        </el-card>
      </el-col>

      <el-col :xs="12" :sm="8" :lg="4">
        <el-card class="stat-card success">
          <div class="stat-info">
            <div class="stat-value">{{ stats.successTaskCount }}</div>
            <div class="stat-label">今日成功记录（单账号+批量）</div>
          </div>
        </el-card>
      </el-col>
    </el-row>

    <el-row :gutter="16" class="content-row">
      <el-col :xs="24" :lg="12">
        <el-card class="status-card">
          <template #header>
            <div class="card-header">
              <span>系统状态</span>
              <el-button 
                type="primary" 
                size="small" 
                :icon="RefreshRight" 
                @click="refreshStatus"
                :loading="statusLoading"
              >
                刷新
              </el-button>
            </div>
          </template>
          <div v-if="systemStatus.scheduler" class="status-content">
            <div class="status-item">
              <span class="status-label">调度器状态:</span>
              <el-tag class="status-tag" :type="systemStatus.service.scheduler === 'active' ? 'success' : 'info'">
                {{ systemStatus.service.scheduler === 'active' ? '运行中' : '空闲' }}
              </el-tag>
            </div>
            <div class="status-item">
              <span class="status-label">已调度任务(单账号+批量):</span>
              <el-tag class="status-tag" type="primary">{{ systemStatus.scheduler.totalJobs }} 个</el-tag>
            </div>
            <div class="status-item">
              <span class="status-label">活跃连接(单账号+批量):</span>
              <el-tag class="status-tag" type="success">{{ systemStatus.scheduler.activeConnections }} 个</el-tag>
            </div>
            <div class="status-item">
              <span class="status-label">数据库:</span>
              <el-tag class="status-tag" type="success">{{ systemStatus.service.database }}</el-tag>
            </div>
            <div class="status-item">
              <span class="status-label">WebSocket:</span>
              <el-tag class="status-tag" :type="systemStatus.service.websocket === 'connected' ? 'success' : 'info'">
                {{ systemStatus.service.websocket === 'connected' ? '已连接' : '未连接' }}
              </el-tag>
            </div>
            <div class="status-item">
              <span class="status-label">运行时间:</span>
              <span>{{ formatUptime(systemStatus.scheduler.uptime) }}</span>
            </div>
          </div>
        </el-card>
      </el-col>

      <el-col :xs="24" :lg="12">
        <el-card class="status-card">
          <template #header>
            <div class="card-header">
              <span>最近活动</span>
              <el-button 
                type="primary" 
                size="small" 
                @click="$router.push('/logs')"
              >
                查看全部
              </el-button>
            </div>
          </template>
          <div v-if="recentActivities.length > 0" class="activities-list">
            <div 
              v-for="activity in recentActivities" 
              :key="activity.id" 
              class="activity-item"
            >
              <div class="activity-icon">
                <el-icon :size="20" :color="getActivityColor(activity)">
                  <component :is="getActivityIcon(activity)" />
                </el-icon>
              </div>
              <div class="activity-content">
                <div class="activity-title">
                  <span class="account-name">{{ activity.account_name }}</span>
                  <span class="task-type">{{ getTaskTypeName(activity.task_type) }}</span>
                </div>
                <div class="activity-message">{{ activity.message }}</div>
                <div class="activity-time">{{ formatTime(activity.created_at) }}</div>
              </div>
            </div>
          </div>
          <el-empty v-else description="暂无活动记录" />
        </el-card>
      </el-col>
    </el-row>

    <el-card v-if="stats.accountCount === 0" class="welcome-card">
      <div class="welcome-content">
        <h2>欢迎使用汤姆之王</h2>
        <p>请先添加游戏账号开始使用</p>
        <el-button type="primary" size="large" @click="$router.push('/tokens')">
          添加账号
        </el-button>
      </div>
    </el-card>

    <el-card v-else class="quick-actions">
      <template #header>
        <span>快捷操作</span>
      </template>
      <div class="quick-actions-grid">
        <el-button type="primary" @click="$router.push('/tokens')">账号管理</el-button>
        <el-button type="success" @click="$router.push('/daily-tasks')">日常任务</el-button>
        <el-button type="warning" @click="$router.push('/game-features')">游戏功能</el-button>
        <el-button type="info" @click="$router.push('/logs')">执行日志</el-button>
      </div>
    </el-card>
  </div>
</template>

<script setup>
import { ref, onMounted, onUnmounted } from 'vue';
import { RefreshRight, CircleCheckFilled, CircleCloseFilled, InfoFilled } from '@element-plus/icons-vue';
import api from '@/api';

const stats = ref({
  accountCount: 0,
  enabledTaskCount: 0,
  todayLogCount: 0,
  pendingTaskCount: 0,
  failedTaskCount: 0,
  successTaskCount: 0
});

const systemStatus = ref({
  scheduler: {
    status: 'unknown',
    totalJobs: 0,
    activeConnections: 0,
    uptime: 0
  },
  service: {
    database: 'unknown',
    scheduler: 'unknown',
    websocket: 'unknown'
  }
});

const recentActivities = ref([]);
const statusLoading = ref(false);
let refreshTimer = null;
const BENIGN_LOG_KEYWORDS = [
  '活动未开放',
  '不在开启时间内',
  '出了点小问题',
  '扫荡条件不满足',
  '已经选择过上阵武将了',
  '今日已领取免费奖励',
  '今天已经签到过了',
];

const isBenignActivity = (activity) => {
  const text = `${activity?.message || ''} ${activity?.details || ''}`;
  return BENIGN_LOG_KEYWORDS.some((keyword) => text.includes(keyword));
};

const getActivityStatus = (activity) => {
  if (isBenignActivity(activity)) return 'ignored';
  return activity?.status || 'error';
};

const getActivityColor = (activity) => {
  const status = getActivityStatus(activity);
  if (status === 'success') return '#67C23A';
  if (status === 'ignored') return '#909399';
  return '#F56C6C';
};

const getActivityIcon = (activity) => {
  const status = getActivityStatus(activity);
  if (status === 'success') return CircleCheckFilled;
  if (status === 'ignored') return InfoFilled;
  return CircleCloseFilled;
};

const taskTypeNames = {
  SIGN_IN: '每日签到',
  LEGION_SIGN: '军团签到',
  ARENA: '竞技场战斗',
  TOWER: '爬塔',
  BOSS_TOWER: '咸王宝库',
  WEIRD_TOWER: '怪异塔',
  WEIRD_TOWER_FREE_ITEM: '怪异塔免费道具',
  WEIRD_TOWER_USE_ITEM: '使用怪异塔道具',
  WEIRD_TOWER_MERGE_ITEM: '怪异塔合成',
  LEGION_BOSS: '军团BOSS',
  DAILY_BOSS: '每日咸王',
  RECRUIT: '武将招募',
  FRIEND_GOLD: '送好友金币',
  BUY_GOLD: '点金',
  FISHING: '钓鱼',
  MAIL_CLAIM: '领取邮件',
  HANGUP_CLAIM: '领取挂机奖励',
  STUDY: '答题',
  HANGUP_ADD_TIME: '一键加钟',
  BOTTLE_RESET: '重置罐子',
  BOTTLE_CLAIM: '领取罐子',
  CAR_SEND: '智能发车',
  CAR_CLAIM: '一键收车',
  BLACK_MARKET: '黑市采购',
  TREASURE_CLAIM: '珍宝阁领取',
  LEGACY_CLAIM: '残卷收取',
  WELFARE_CLAIM: '福利奖励领取',
  DAILY_TASK_CLAIM: '每日任务奖励领取',
  DREAM: '梦境',
  DREAM_PURCHASE: '购买梦境商品',
  SKIN_CHALLENGE: '换皮闯关',
  STAR_TEMPLE: '星级十殿',
  PEACH_TASK: '蟠桃园任务',
  BOX_OPEN: '批量开箱',
  LEGION_STORE_FRAGMENT: '购买四圣碎片',
  GENIE_SWEEP: '灯神扫荡'
};

const getTaskTypeName = (taskType) => {
  return taskTypeNames[taskType] || taskType;
};

const formatUptime = (seconds) => {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  
  if (days > 0) {
    return `${days}天 ${hours}小时 ${minutes}分钟`;
  } else if (hours > 0) {
    return `${hours}小时 ${minutes}分钟`;
  } else {
    return `${minutes}分钟`;
  }
};

const formatTime = (timestamp) => {
  if (!timestamp) return '-';
  let date;
  if (typeof timestamp === 'number') {
    date = new Date(timestamp);
  } else {
    const text = String(timestamp);
    if (/^\d+$/.test(text)) {
      date = new Date(Number(text));
    } else {
      const normalized = text.includes('T') ? text : text.replace(' ', 'T');
      // 后端SQLite CURRENT_TIMESTAMP为UTC，这里按UTC解释再转本地时区显示
      date = new Date(`${normalized}Z`);
    }
  }
  if (Number.isNaN(date.getTime())) return '-';
  const now = new Date();
  const diff = now - date;
  
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);
  
  if (days > 0) {
    return `${days}天前`;
  } else if (hours > 0) {
    return `${hours}小时前`;
  } else if (minutes > 0) {
    return `${minutes}分钟前`;
  } else {
    return '刚刚';
  }
};

const fetchStats = async () => {
  try {
    const response = await api.stats.getOverview();
    if (response.success) {
      stats.value = response.data;
    }
  } catch (error) {
    console.error('获取统计数据失败:', error);
  }
};

const fetchSystemStatus = async () => {
  statusLoading.value = true;
  try {
    const response = await api.stats.getSystemStatus();
    if (response.success) {
      systemStatus.value = response.data;
    }
  } catch (error) {
    console.error('获取系统状态失败:', error);
  } finally {
    statusLoading.value = false;
  }
};

const fetchRecentActivities = async () => {
  try {
    const response = await api.stats.getRecentActivities(5);
    if (response.success) {
      recentActivities.value = response.data;
    }
  } catch (error) {
    console.error('获取最近活动失败:', error);
  }
};

const refreshStatus = () => {
  fetchSystemStatus();
};

const startAutoRefresh = () => {
  refreshTimer = setInterval(() => {
    fetchSystemStatus();
    fetchStats();
  }, 30000);
};

const stopAutoRefresh = () => {
  if (refreshTimer) {
    clearInterval(refreshTimer);
    refreshTimer = null;
  }
};

onMounted(() => {
  fetchStats();
  fetchSystemStatus();
  fetchRecentActivities();
  startAutoRefresh();
});

onUnmounted(() => {
  stopAutoRefresh();
});
</script>

<style scoped>
.home-page {
  display: flex;
  flex-direction: column;
  gap: 18px;
}

.stats-row,
.content-row,
.welcome-card,
.quick-actions {
  margin-top: 0;
}

.stats-row {
  :deep(.el-col) {
    display: flex;
  }
}

.stat-card {
  text-align: center;
  position: relative;
  padding: 6px;
  transition: all 0.28s ease;
  height: 100%;
  overflow: hidden;

  &::before {
    content: '';
    position: absolute;
    inset: 0;
    background: linear-gradient(180deg, rgba(255, 255, 255, 0.34), transparent 42%);
    pointer-events: none;
  }
}

.stat-card:hover {
  transform: translateY(-4px);
  box-shadow: 0 20px 42px rgba(25, 40, 74, 0.14);
}

.stat-card.pending {
  box-shadow: inset 0 0 0 1px rgba(245, 166, 35, 0.18);
}

.stat-card.error {
  box-shadow: inset 0 0 0 1px rgba(208, 48, 80, 0.18);
}

.stat-card.success {
  box-shadow: inset 0 0 0 1px rgba(24, 160, 88, 0.18);
}

.stat-info {
  position: relative;
  z-index: 1;
  min-height: 116px;
  display: flex;
  flex-direction: column;
  justify-content: center;
  padding: 8px 6px;
}

.stat-value {
  font-size: clamp(28px, 3vw, 36px);
  font-weight: 700;
  color: var(--text-primary);
  line-height: 1;
}

.stat-label {
  font-size: 13px;
  color: var(--text-secondary);
  margin-top: 10px;
  line-height: 1.55;
}

.status-card {
  min-height: 320px;

  :deep(.el-card__header) {
    border-bottom: none;
    padding-bottom: 14px;
  }

  :deep(.el-card__body) {
    padding-top: 18px;
  }
}

.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
}

.status-content {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.status-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  padding: 14px 16px;
  border: 1px solid rgba(138, 151, 185, 0.14);
  border-radius: 16px;
  background: rgba(255, 255, 255, 0.58);
}

.status-label {
  font-weight: 600;
  color: var(--text-secondary);
}

.activities-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.activity-item {
  display: flex;
  gap: 12px;
  padding: 14px;
  border-radius: 18px;
  border: 1px solid rgba(138, 151, 185, 0.14);
  background-color: rgba(255, 255, 255, 0.6);
  transition: all 0.24s ease;
}

.activity-item:hover {
  background-color: rgba(255, 255, 255, 0.88);
  transform: translateY(-1px);
}

.activity-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 38px;
  height: 38px;
  border-radius: 14px;
  background: rgba(91, 124, 255, 0.08);
}

.activity-content {
  flex: 1;
  min-width: 0;
}

.activity-title {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 4px;
}

.account-name {
  font-weight: 600;
  color: var(--text-primary);
}

.task-type {
  color: var(--text-secondary);
  font-size: 13px;
}

.activity-message {
  font-size: 13px;
  color: var(--text-secondary);
  margin-bottom: 4px;
  line-height: 1.6;
}

.activity-time {
  font-size: 12px;
  color: var(--text-tertiary);
}

.welcome-content {
  text-align: center;
  padding: 40px 20px;
}

.welcome-content h2 {
  margin-bottom: 10px;
  color: var(--text-primary);
}

.welcome-content p {
  color: var(--text-secondary);
  margin-bottom: 20px;
}

.quick-actions-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;
}

.quick-actions-grid .el-button {
  margin: 0;
  justify-content: center;
}

@media (max-width: 768px) {
  .stat-card {
    padding: 2px;
  }

  .stat-value {
    font-size: 24px;
  }

  .status-card {
    min-height: auto;
  }

  .card-header {
    align-items: flex-start;
    flex-wrap: wrap;
  }

  .status-item {
    align-items: flex-start;
    flex-direction: column;
  }

  .status-tag {
    align-self: flex-start;
  }

  .activity-item {
    padding: 12px;
  }

  .quick-actions-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .quick-actions-grid .el-button {
    width: 100%;
  }
}

@media (max-width: 480px) {
  .stat-card {
    padding: 14px 10px;
  }

  .stat-value {
    font-size: 20px;
  }

  .stat-label,
  .task-type,
  .activity-message {
    font-size: 12px;
  }

  .welcome-content {
    padding: 24px 12px;
  }

  .quick-actions-grid {
    grid-template-columns: 1fr;
  }
}
</style>
