<template>
  <div class="daily-tasks-page">
    <el-card class="header-card">
      <div class="page-header">
        <div class="header-left">
          <h2>日常任务</h2>
          <p>管理和执行游戏日常任务</p>
        </div>
        <div class="header-right">
          <el-select v-model="selectedTokenId" placeholder="选择账号" style="width: 200px">
            <el-option
              v-for="token in tokenStore.gameTokens"
              :key="token.id"
              :label="token.name"
              :value="token.id"
            />
          </el-select>
        </div>
      </div>
    </el-card>

    <template v-if="selectedTokenId">
      <el-row :gutter="16" class="task-cards">
        <el-col :xs="24" :sm="12" :md="8" :lg="6" v-for="task in taskList" :key="task.key">
          <el-card class="task-card" :class="{ disabled: !task.enabled }">
            <div class="task-header">
              <div class="task-info">
                <span class="task-name">{{ task.name }}</span>
                <el-tag size="small" :type="task.enabled ? 'success' : 'info'">
                  {{ task.enabled ? '已启用' : '已禁用' }}
                </el-tag>
              </div>
              <el-switch v-model="task.enabled" />
            </div>
            
            <div class="task-body">
              <div class="task-desc">{{ task.description }}</div>
              <div class="task-status">
                <span class="label">连接状态:</span>
                <el-tag 
                  size="small" 
                  :type="getConnectionStatus(task.tokenId) === 'connected' ? 'success' : 'danger'"
                >
                  {{ getConnectionStatusText(task.tokenId) }}
                </el-tag>
              </div>
            </div>

            <div class="task-footer">
              <el-button
                type="primary"
                size="small"
                :loading="task.executing"
                :disabled="!task.enabled"
                @click="executeTask(task)"
              >
                立即执行
              </el-button>
            </div>
          </el-card>
        </el-col>
      </el-row>

      <el-card class="batch-actions">
        <template #header>
          <span>批量操作</span>
        </template>
        <el-space wrap>
          <el-button type="primary" @click="executeAllTasks" :loading="batchExecuting">
            执行所有启用任务
          </el-button>
          <el-button @click="enableAllTasks">启用所有任务</el-button>
          <el-button @click="disableAllTasks">禁用所有任务</el-button>
        </el-space>
      </el-card>
    </template>

    <el-empty v-else description="请先在账号管理中添加账号" />
  </div>
</template>

<script setup>
import { ref, onMounted, watch } from 'vue';
import { ElMessage } from 'element-plus';
import { useTokenStore } from '@stores/tokenStore';

const tokenStore = useTokenStore();

const selectedTokenId = ref(null);
const batchExecuting = ref(false);

const taskList = ref([
  { key: 'signIn', name: '每日签到', description: '领取每日签到奖励', cmd: 'system_signinreward', enabled: true, executing: false, simple: true },
  { key: 'legionSignIn', name: '军团签到', description: '进行军团签到', cmd: 'legion_signin', enabled: true, executing: false, simple: true },
  { key: 'mail', name: '领取邮件', description: '一键领取所有邮件', cmd: 'mail_claimallattachment', enabled: true, executing: false, simple: true },
  { key: 'hangup', name: '挂机奖励', description: '领取挂机奖励', cmd: 'system_claimhangupreward', enabled: true, executing: false, simple: true },
  { key: 'arena', name: '竞技场', description: '自动竞技场战斗', cmd: 'arena', enabled: true, executing: false, simple: false },
  { key: 'tower', name: '咸将塔', description: '自动爬塔', cmd: 'tower', enabled: true, executing: false, simple: false },
  { key: 'bossTower', name: '咸王宝库', description: '挑战咸王宝库', cmd: 'fight_startboss', enabled: false, executing: false, simple: false },
  { key: 'fishing', name: '钓鱼', description: '自动钓鱼', cmd: 'artifact_lottery', enabled: true, executing: false, simple: true }
]);

const getConnectionStatus = (tokenId) => {
  return tokenStore.wsConnections[selectedTokenId.value]?.status || 'disconnected';
};

const getConnectionStatusText = (tokenId) => {
  const status = getConnectionStatus(tokenId);
  const statusMap = {
    'connected': '已连接',
    'connecting': '连接中',
    'disconnected': '未连接',
    'error': '连接错误'
  };
  return statusMap[status] || '未知';
};

const pickArenaTargetId = (targets) => {
  if (!targets) return null;
  if (Array.isArray(targets)) {
    const candidate = targets[0];
    return candidate?.roleId || candidate?.id || candidate?.targetId;
  }
  const candidate =
    targets?.rankList?.[0] ||
    targets?.roleList?.[0] ||
    targets?.targets?.[0] ||
    targets?.targetList?.[0] ||
    targets?.list?.[0];
  if (candidate) {
    if (candidate.roleId) return candidate.roleId;
    if (candidate.id) return candidate.id;
    if (candidate.targetId) return candidate.targetId;
  }
  return targets?.roleId || targets?.id || targets?.targetId;
};

const getTodayBossId = () => {
  const DAY_BOSS_MAP = [9904, 9905, 9901, 9902, 9903, 9904, 9905];
  const dayOfWeek = new Date().getDay();
  return DAY_BOSS_MAP[dayOfWeek];
};

const executeSimpleTask = async (task) => {
  const result = await tokenStore.sendMessageWithPromise(
    selectedTokenId.value,
    task.cmd,
    {}
  );
  return result;
};

const executeFishing = async () => {
  for (let i = 0; i < 3; i++) {
    await tokenStore.sendMessageWithPromise(
      selectedTokenId.value,
      'artifact_lottery',
      { lotteryNumber: 1, newFree: true, type: 1 }
    );
    await new Promise(resolve => setTimeout(resolve, 500));
  }
};

const executeArena = async () => {
  await ensureBattleVersion();
  
  await tokenStore.sendMessageWithPromise(
    selectedTokenId.value,
    'arena_startarea',
    {}
  );
  await new Promise(resolve => setTimeout(resolve, 300));

  for (let i = 0; i < 3; i++) {
    const targets = await tokenStore.sendMessageWithPromise(
      selectedTokenId.value,
      'arena_getareatarget',
      {}
    );
    const targetId = pickArenaTargetId(targets);
    if (targetId) {
      await tokenStore.sendMessageWithPromise(
        selectedTokenId.value,
        'fight_startareaarena',
        { targetId }
      );
    }
    await new Promise(resolve => setTimeout(resolve, 500));
  }
};

const ensureBattleVersion = async () => {
  let battleVersion = tokenStore.getBattleVersion();
  if (!battleVersion) {
    const levelInfo = await tokenStore.sendMessageWithPromise(
      selectedTokenId.value,
      'fight_startlevel',
      {}
    );
    battleVersion = levelInfo?.battleData?.version;
    if (battleVersion) {
      tokenStore.setBattleVersion(battleVersion);
    }
  }
  return battleVersion;
};

const executeTower = async () => {
  const battleVersion = await ensureBattleVersion();
  if (!battleVersion) {
    throw new Error('无法获取battleVersion');
  }
  await tokenStore.sendMessageWithPromise(
    selectedTokenId.value,
    'fight_starttower',
    {}
  );
};

const executeBossTower = async () => {
  await ensureBattleVersion();
  const bossId = getTodayBossId();
  await tokenStore.sendMessageWithPromise(
    selectedTokenId.value,
    'fight_startboss',
    { bossId }
  );
};

const executeTask = async (task) => {
  if (!selectedTokenId.value) {
    ElMessage.warning('请先选择账号');
    return;
  }

  const connection = tokenStore.wsConnections[selectedTokenId.value];
  if (!connection || connection.status !== 'connected') {
    ElMessage.warning('该账号未连接，请先在账号管理中连接');
    return;
  }

  task.executing = true;
  try {
    if (task.simple) {
      if (task.key === 'fishing') {
        await executeFishing();
      } else {
        await executeSimpleTask(task);
      }
    } else {
      switch (task.key) {
        case 'arena':
          await executeArena();
          break;
        case 'tower':
          await executeTower();
          break;
        case 'bossTower':
          await executeBossTower();
          break;
        default:
          await executeSimpleTask(task);
      }
    }
    ElMessage.success(`${task.name}执行成功`);
  } catch (error) {
    ElMessage.error(error.message || `${task.name}执行失败`);
  } finally {
    task.executing = false;
  }
};

const executeAllTasks = async () => {
  if (!selectedTokenId.value) {
    ElMessage.warning('请先选择账号');
    return;
  }

  const connection = tokenStore.wsConnections[selectedTokenId.value];
  if (!connection || connection.status !== 'connected') {
    ElMessage.warning('该账号未连接，请先在Token管理中连接');
    return;
  }

  const enabledTasks = taskList.value.filter(t => t.enabled);
  
  if (enabledTasks.length === 0) {
    ElMessage.warning('没有启用的任务');
    return;
  }

  batchExecuting.value = true;
  let successCount = 0;
  let failCount = 0;

  for (const task of enabledTasks) {
    try {
      task.executing = true;
      await executeTask(task);
      successCount++;
    } catch {
      failCount++;
    } finally {
      task.executing = false;
    }
    
    await new Promise(resolve => setTimeout(resolve, 500));
  }

  batchExecuting.value = false;
  
  if (failCount === 0) {
    ElMessage.success(`全部执行成功 (${successCount}个任务)`);
  } else {
    ElMessage.warning(`执行完成：成功 ${successCount}，失败 ${failCount}`);
  }
};

const enableAllTasks = () => {
  taskList.value.forEach(task => {
    task.enabled = true;
  });
  ElMessage.success('已启用所有任务');
};

const disableAllTasks = () => {
  taskList.value.forEach(task => {
    task.enabled = false;
  });
  ElMessage.success('已禁用所有任务');
};

onMounted(() => {
  if (tokenStore.gameTokens.length > 0 && !selectedTokenId.value) {
    selectedTokenId.value = tokenStore.gameTokens[0].id;
  }
});

watch(() => tokenStore.gameTokens, (tokens) => {
  if (tokens.length > 0 && !selectedTokenId.value) {
    selectedTokenId.value = tokens[0].id;
  }
}, { immediate: true });
</script>

<style lang="scss" scoped>
.daily-tasks-page {
  .header-card {
    margin-bottom: 16px;
  }

  .page-header {
    display: flex;
    justify-content: space-between;
    align-items: center;

    .header-left {
      h2 {
        margin: 0 0 4px 0;
        font-size: 18px;
      }

      p {
        margin: 0;
        color: var(--el-text-color-secondary);
        font-size: 14px;
      }
    }
  }

  .task-cards {
    margin-bottom: 16px;
  }

  .task-card {
    margin-bottom: 16px;

    &.disabled {
      opacity: 0.7;
    }

    .task-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 12px;
    }

    .task-info {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .task-name {
      font-weight: 500;
    }

    .task-body {
      font-size: 13px;
      color: var(--el-text-color-secondary);
      margin-bottom: 12px;

      .task-desc {
        margin-bottom: 8px;
      }

      .task-status {
        display: flex;
        align-items: center;
        gap: 4px;
      }

      .label {
        color: var(--el-text-color-regular);
      }
    }

    .task-footer {
      text-align: right;
    }
  }

  .batch-actions {
    margin-top: 16px;
  }
}
</style>
