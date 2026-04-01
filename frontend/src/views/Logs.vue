<template>
  <div class="logs-page">
    <el-card class="logs-card">
      <template #header>
        <div class="card-header">
          <div>
            <span>执行日志</span>
            <div class="header-tip">按游戏账号查看最近 30 条执行记录</div>
          </div>
          <el-button @click="refreshCurrentView" :loading="loading">
            <el-icon><Refresh /></el-icon>
            刷新
          </el-button>
        </div>
      </template>

      <div class="filter-bar">
        <span class="filter-label">游戏账号</span>
        <el-select
          v-model="selectedAccountId"
          class="account-select"
          placeholder="请选择游戏账号"
          filterable
          clearable
          :loading="accountsLoading"
          @change="handleAccountChange"
        >
          <el-option
            v-for="account in accounts"
            :key="account.id"
            :label="account.name"
            :value="account.id"
          />
        </el-select>
      </div>

      <el-skeleton v-if="loading" :rows="6" animated />

      <template v-else>
        <el-empty
          v-if="accounts.length === 0"
          description="暂无游戏账号"
        />

        <el-empty
          v-else-if="!selectedAccountId"
          description="请选择要查看日志的游戏账号"
        />

        <el-empty
          v-else-if="logs.length === 0"
          description="当前账号暂无执行记录"
        />

        <div v-else class="log-list-wrap">
          <div class="account-summary">
            <span class="account-name">{{ currentAccountName }}</span>
            <span class="log-count">当前显示最近 {{ logs.length }} 条记录</span>
          </div>

          <div class="log-items">
            <div
              v-for="log in logs"
              :key="log.id"
              class="log-item"
            >
              <div class="log-item-header">
                <div class="log-left">
                  <el-tag
                    size="small"
                    :type="getLogStatusType(log)"
                  >
                    {{ getLogStatusText(log) }}
                  </el-tag>
                  <span class="log-time">{{ formatTime(log.created_at) }}</span>
                </div>
                <div class="log-right">
                  <span class="task-type">{{ getTaskLabel(log.task_type) }}</span>
                </div>
              </div>
              <div class="log-message">{{ log.message || '-' }}</div>
            </div>
          </div>
        </div>
      </template>
    </el-card>
  </div>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue';
import { ElMessage } from 'element-plus';
import { Refresh } from '@element-plus/icons-vue';
import api from '@/api';

const accounts = ref([]);
const accountsLoading = ref(false);
const loading = ref(false);
const selectedAccountId = ref(null);
const logs = ref([]);
const taskTypeNameMap = ref({});
const BENIGN_LOG_KEYWORDS = [
  '活动未开放',
  '不在开启时间内',
  '出了点小问题',
  '扫荡条件不满足',
  '已经选择过上阵武将了',
  '今日已领取免费奖励',
  '今天已经签到过了',
];

const currentAccountName = computed(() => {
  const currentAccount = accounts.value.find((account) => account.id === selectedAccountId.value);
  return currentAccount?.name || '未选择账号';
});

const getTaskLabel = (taskType) => {
  return taskTypeNameMap.value[taskType] || taskType || '-';
};

const getDisplayStatus = (log) => {
  if (isBenignLog(log)) return 'ignored';
  return log?.status || 'error';
};

const getLogStatusType = (log) => {
  const status = getDisplayStatus(log);
  if (status === 'success') return 'success';
  if (status === 'ignored') return 'info';
  return 'danger';
};

const getLogStatusText = (log) => {
  const status = getDisplayStatus(log);
  if (status === 'success') return '成功';
  if (status === 'ignored') return '已忽略';
  return '失败';
};

const formatTime = (time) => {
  if (!time) return '-';

  const raw = String(time).trim();
  const normalized = raw.includes('T') ? raw : raw.replace(' ', 'T');
  const hasTimezone = /([zZ]|[+-]\d{2}:?\d{2})$/.test(normalized);
  const parsed = new Date(hasTimezone ? normalized : `${normalized}Z`);

  return Number.isNaN(parsed.getTime()) ? raw : parsed.toLocaleString('zh-CN');
};

const isBenignLog = (log) => {
  const text = `${log?.message || ''} ${log?.details || ''}`;
  return BENIGN_LOG_KEYWORDS.some((keyword) => text.includes(keyword));
};

const fetchTaskTypes = async () => {
  try {
    const res = await api.get('/tasks/types');
    if (res.success && Array.isArray(res.data)) {
      taskTypeNameMap.value = res.data.reduce((acc, item) => {
        const type = String(item?.type || '').trim();
        if (type) {
          acc[type] = item?.name || type;
        }
        return acc;
      }, {});
    }
  } catch (error) {
    console.error('获取任务类型失败:', error);
  }
};

const fetchAccounts = async () => {
  accountsLoading.value = true;
  try {
    const res = await api.get('/accounts');
    if (res.success) {
      accounts.value = res.data || [];
      if (!selectedAccountId.value && accounts.value.length > 0) {
        selectedAccountId.value = accounts.value[0].id;
      } else if (
        selectedAccountId.value &&
        !accounts.value.some((account) => account.id === selectedAccountId.value)
      ) {
        selectedAccountId.value = accounts.value[0]?.id || null;
      }
    }
  } catch (error) {
    console.error('获取账号失败:', error);
    ElMessage.error('获取账号失败');
  } finally {
    accountsLoading.value = false;
  }
};

const fetchLogs = async () => {
  if (!selectedAccountId.value) {
    logs.value = [];
    return;
  }

  loading.value = true;
  try {
    const res = await api.get('/logs', {
      params: {
        accountId: selectedAccountId.value,
        limit: 30,
      },
    });

    if (res.success) {
      logs.value = Array.isArray(res.data) ? res.data : [];
    } else {
      logs.value = [];
    }
  } catch (error) {
    console.error('获取日志失败:', error);
    logs.value = [];
    ElMessage.error('获取日志失败');
  } finally {
    loading.value = false;
  }
};

const handleAccountChange = () => {
  fetchLogs();
};

const refreshCurrentView = async () => {
  await fetchAccounts();
  await fetchLogs();
};

onMounted(async () => {
  await fetchTaskTypes();
  await fetchAccounts();
  await fetchLogs();
});
</script>

<style lang="scss" scoped>
.logs-page {
  display: flex;
  flex-direction: column;
  gap: 18px;

  .card-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 16px;
  }

  .logs-card {
    :deep(.el-card__header) {
      border-bottom: 1px solid rgba(138, 151, 185, 0.14);
      padding-bottom: 14px;
    }
  }

  :deep(.el-card__header) {
    padding-bottom: 8px;
  }

  :deep(.el-card__body) {
    padding-top: 16px;
  }

  .header-tip {
    margin-top: 4px;
    font-size: 12px;
    color: var(--text-tertiary);
  }

  .filter-bar {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-bottom: 20px;
    flex-wrap: wrap;
    padding: 14px;
    border-radius: 18px;
    background: rgba(91, 124, 255, 0.05);
    border: 1px solid rgba(138, 151, 185, 0.14);
  }

  .filter-label {
    font-size: 14px;
    color: var(--text-secondary);
    font-weight: 600;
    white-space: nowrap;
  }

  .account-select {
    width: 320px;
    max-width: 100%;
  }

  .account-summary {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 16px;
    gap: 12px;
    flex-wrap: wrap;
  }

  .account-name {
    font-size: 16px;
    font-weight: 600;
    color: var(--text-primary);
  }

  .log-count {
    font-size: 13px;
    color: var(--text-tertiary);
  }

  .log-items {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .log-item {
    border: 1px solid rgba(138, 151, 185, 0.14);
    border-radius: 16px;
    padding: 14px 16px;
    background: rgba(255, 255, 255, 0.72);
    box-shadow: 0 8px 20px rgba(24, 39, 75, 0.06);
  }

  .log-item-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 12px;
    margin-bottom: 10px;
    flex-wrap: wrap;
  }

  .log-left,
  .log-right {
    display: flex;
    align-items: center;
    gap: 10px;
    flex-wrap: wrap;
  }

  .log-time,
  .task-type {
    font-size: 13px;
    color: var(--text-tertiary);
  }

  .log-message {
    color: var(--text-primary);
    line-height: 1.7;
    white-space: pre-wrap;
    word-break: break-word;
  }

  @media (max-width: 768px) {
    .card-header,
    .filter-bar,
    .account-summary,
    .log-item-header {
      flex-direction: column;
      align-items: stretch;
    }
  }
}
</style>
