<template>
  <div class="tasks-page">
    <n-card class="tasks-overview-card">
      <template #header>
        <div class="card-header">
          <span>任务配置</span>
          <n-space class="header-actions">
            <n-button @click="refreshTasks" :disabled="taskConfigOperating">
              <template #icon>
                <n-icon><Refresh /></n-icon>
              </template>
              刷新
            </n-button>
            <n-button type="primary" @click="saveCurrentConfig" :loading="saving" :disabled="taskConfigOperating">
              保存当前账号配置
            </n-button>
          </n-space>
        </div>
      </template>

      <n-alert type="info" class="tasks-tip">
        选择账号后，可单独配置该账号的任务执行参数。每个账号的配置独立保存。
      </n-alert>

      <div class="account-selector">
        <span>选择账号：</span>
        <n-select
          v-model:value="selectedAccountId"
          :options="accountOptions"
          placeholder="请选择要配置的账号"
          class="account-select"
          :disabled="taskConfigOperating"
          @update:value="handleAccountChange"
        />
        <n-tag v-if="selectedAccountId" type="success" size="small">
          已加载该账号的配置
        </n-tag>
        <n-space v-if="selectedAccountId" size="small">
          <n-button secondary type="warning" :loading="debugReopening" @click="handleManualLegacyReopen">
            调试开启残卷
          </n-button>
          <n-button secondary type="primary" :loading="debugClaiming" @click="handleManualLegacyClaim">
            立即收取残卷
          </n-button>
        </n-space>
      </div>

      <n-alert
        v-if="selectedAccountId && hasLegacyConfigDiff"
        type="warning"
        class="tasks-tip"
      >
        <template #header>
          检测到当前浏览器存在旧版本地任务配置，与数据库配置不一致
        </template>
        <div class="legacy-migration-alert">
          <span>当前页面已改为以后端数据库为准。若你确认要恢复这份旧本地配置，可手动导入到数据库。</span>
          <n-space size="small">
            <n-button
              secondary
              type="warning"
              :loading="legacyImporting"
              :disabled="taskConfigOperating"
              @click="importLegacyLocalConfig"
            >
              导入旧本地配置
            </n-button>
          </n-space>
        </div>
      </n-alert>
    </n-card>

    <template v-if="selectedAccountId">
      <n-card class="tasks-content-card">
        <n-tabs type="line" animated>
          <n-tab-pane name="schedule" tab="定时任务">
            <div class="schedule-section">
              <div class="schedule-header">
                <n-space align="center">
                  <span>每日执行时间：</span>
                  <n-time-picker
                    v-model:value="dailyRunTime"
                    format="HH:mm"
                    clearable
                    :disabled="taskConfigOperating"
                  />
                  <n-button type="primary" size="small" @click="applyDailyTime" :disabled="taskConfigOperating">
                    应用到所有启用的任务
                  </n-button>
                </n-space>
              </div>

              <n-alert type="info" class="schedule-tip">
                设置该账号每日任务的执行时间，系统将在指定时间自动执行所有启用的任务
              </n-alert>

              <div class="scheduled-tasks-list">
                <div
                  v-for="task in schedulableTasks"
                  :key="task.value"
                  class="scheduled-task-item"
                >
                  <div class="task-main">
                    <n-switch
                      :value="getTaskEnabled(task.value)"
                      size="small"
                      :disabled="taskConfigOperating"
                      @update:value="(val) => setTaskEnabled(task.value, val)"
                    />
                    <span class="task-name">{{ task.label }}</span>
                    <n-tag size="small" :type="getGroupType(task.group)">
                      {{ getGroupLabel(task.group) }}
                    </n-tag>
                  </div>
                  <div class="task-time">
                    <n-space align="center" size="small">
                      <n-select
                        :value="getTaskScheduleType(task.value)"
                        :options="scheduleModeOptions"
                        size="small"
                        class="task-schedule-mode"
                        :disabled="taskConfigOperating"
                        @update:value="(val) => setTaskScheduleType(task.value, val)"
                      />
                      <n-select
                        v-if="getTaskScheduleType(task.value) === 'weekly'"
                        :value="getTaskWeekdays(task.value)"
                        :options="weekdayOptions"
                        multiple
                        size="small"
                        class="task-weekday-select"
                        :disabled="taskConfigOperating"
                        placeholder="选择星期"
                        @update:value="(val) => setTaskWeekdays(task.value, val)"
                      />
                      <n-time-picker
                        v-if="['daily', 'weekly'].includes(getTaskScheduleType(task.value))"
                        :value="getTaskRunTime(task.value)"
                        format="HH:mm"
                        size="small"
                        clearable
                        :disabled="taskConfigOperating"
                        placeholder="默认时间"
                        @update:value="(val) => setTaskRunTime(task.value, val)"
                      />
                      <n-input-number
                        v-else
                        :value="getTaskIntervalHours(task.value)"
                        :min="1"
                        :max="23"
                        size="small"
                        class="task-interval-input"
                        :disabled="taskConfigOperating"
                        placeholder="每N小时"
                        @update:value="(val) => setTaskIntervalHours(task.value, val)"
                      />
                    </n-space>
                  </div>
                </div>
              </div>
            </div>
          </n-tab-pane>

          <n-tab-pane name="config" tab="任务详细配置">
            <TaskConfigPanel
              v-model="currentAccountConfig.taskConfigs"
              :title="`${currentAccountName} - 任务参数配置`"
              :disabled="taskConfigOperating"
              :saving="taskConfigOperating"
              @save="handleConfigSave"
            />
          </n-tab-pane>
        </n-tabs>
      </n-card>
    </template>

    <n-empty v-else description="请选择要配置的账号" style="margin-top: 50px" />
  </div>
</template>

<script setup>
import { ref, computed, onMounted, watch } from 'vue';
import { useMessage } from 'naive-ui';
import { Refresh } from '@vicons/ionicons5';
import TaskConfigPanel from '@/components/Daily/TaskConfigPanel.vue';
import { useTaskStore } from '@stores/task';
import { useAccountStore } from '@stores/account';
import {
  availableTasks,
  taskGroupDefinitions,
  defaultTaskConfigs,
  defaultSettings,
} from '@/utils/batch/constants';

const message = useMessage();
const taskStore = useTaskStore();
const accountStore = useAccountStore();

const saving = ref(false);
const debugReopening = ref(false);
const debugClaiming = ref(false);
const dailyRunTime = ref(null);
const selectedAccountId = ref(null);
const isHydrating = ref(false);
const backendLoadRequestId = ref(0);
const TASK_CONFIG_STORAGE_KEY = 'allAccountsTaskConfig';
const TASK_CONFIG_STORAGE_BACKUP_PREFIX = 'allAccountsTaskConfig_backup_';
const TASK_CONFIG_DISMISSED_STORAGE_KEY = 'allAccountsTaskConfig_legacy_dismissed';
const legacyLocalConfigs = ref({});
const legacyImporting = ref(false);
const dismissedLegacyAccounts = ref({});

const scheduleModeOptions = [
  { label: '每日固定时间', value: 'daily' },
  { label: '每周指定星期', value: 'weekly' },
  { label: '每N小时执行', value: 'interval' },
];
const weekdayOptions = [
  { label: '周一', value: 1 },
  { label: '周二', value: 2 },
  { label: '周三', value: 3 },
  { label: '周四', value: 4 },
  { label: '周五', value: 5 },
  { label: '周六', value: 6 },
  { label: '周日', value: 0 },
];
const weekdayOrder = [1, 2, 3, 4, 5, 6, 0];

const frontendToBackendTaskMap = {
  claimHangUpRewards: 'HANGUP_CLAIM',
  batchAddHangUpTime: 'HANGUP_ADD_TIME',
  resetBottles: 'BOTTLE_RESET',
  batchlingguanzi: 'BOTTLE_CLAIM',
  batchclubsign: 'LEGION_SIGN',
  batchFriendGold: 'FRIEND_GOLD',
  batchMailClaim: 'MAIL_CLAIM',
  batchStudy: 'STUDY',
  batcharenafight: 'ARENA',
  batchSmartSendCar: 'CAR_SEND',
  batchClaimCars: 'CAR_CLAIM',
  batchBuyGold: 'BUY_GOLD',
  batchRecruit: 'RECRUIT',
  batchFish: 'FISHING',
  batchOpenBox: 'BOX_OPEN',
  store_purchase: 'BLACK_MARKET',
  collection_claimfreereward: 'TREASURE_CLAIM',
  batchLegacyClaim: 'LEGACY_CLAIM',
  climbTower: 'TOWER',
  climbWeirdTower: 'WEIRD_TOWER',
  batchClaimFreeEnergy: 'WEIRD_TOWER_FREE_ITEM',
  batchUseItems: 'WEIRD_TOWER_USE_ITEM',
  batchMergeItems: 'WEIRD_TOWER_MERGE_ITEM',
  legion_storebuygoods: 'LEGION_STORE_FRAGMENT',
  batchmengjing: 'DREAM',
  skinChallenge: 'SKIN_CHALLENGE',
  batchGenieSweep: 'GENIE_SWEEP',
  batchLegionBoss: 'LEGION_BOSS',
  batchBuyDreamItems: 'DREAM_PURCHASE',
  batchDailyBoss: 'DAILY_BOSS',
  batchWelfareClaim: 'WELFARE_CLAIM',
  batchDailyTaskClaim: 'DAILY_TASK_CLAIM',
};

const backendTypeDefaultCronMap = ref({});

const cloneTaskConfigs = (taskConfigs = defaultTaskConfigs) => {
  return JSON.parse(JSON.stringify(taskConfigs));
};

const normalizeTaskConfigs = (taskConfigs = {}) => {
  const normalized = cloneTaskConfigs();

  Object.entries(taskConfigs || {}).forEach(([taskKey, taskValue]) => {
    if (!normalized[taskKey]) {
      return;
    }

    normalized[taskKey] = {
      ...normalized[taskKey],
      ...(taskValue || {}),
      config: {
        ...normalized[taskKey].config,
        ...(taskValue?.config || {}),
      },
    };
  });

  return normalized;
};

const normalizeAccountConfig = (accountConfig = {}) => {
  const taskConfigs = normalizeTaskConfigs(accountConfig.taskConfigs || {});
  const settings = {
    ...defaultSettings,
    ...(accountConfig.settings || {}),
  };

  if (accountConfig?.taskConfigs?.batchMailClaim?.enabled !== undefined) {
    settings.claimEmail = !!accountConfig.taskConfigs.batchMailClaim.enabled;
  } else if (taskConfigs.batchMailClaim) {
    taskConfigs.batchMailClaim.enabled = !!settings.claimEmail;
  }

  return {
    taskConfigs,
    settings,
  };
};

const createDefaultAccountConfig = () => normalizeAccountConfig();

const currentAccountConfig = ref(createDefaultAccountConfig());
const localOnlyTaskKeys = new Set(['startBatch']);
const taskConfigOperating = computed(() => saving.value || legacyImporting.value);
const createEmptyTaskScheduleConfig = () => ({
  enabled: true,
  config: {},
  scheduleType: 'daily',
  intervalHours: 4,
  runTime: null,
  weekdays: [],
});

const normalizeWeekdays = (weekdays = []) => {
  const allowed = new Set(weekdayOptions.map((item) => item.value));
  return weekdayOrder.filter((value, index, arr) => {
    return allowed.has(value) && Array.isArray(weekdays) && weekdays.includes(value) && arr.indexOf(value) === index;
  });
};

const parseCronWeekdays = (dayField = '') => {
  const values = new Set();
  String(dayField || '')
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
    .forEach((part) => {
      if (part.includes('-')) {
        const [startRaw, endRaw] = part.split('-');
        const start = Number(startRaw);
        const end = Number(endRaw);
        if (Number.isInteger(start) && Number.isInteger(end)) {
          for (let value = start; value <= end; value += 1) {
            const normalized = value === 7 ? 0 : value;
            if (weekdayOptions.some((item) => item.value === normalized)) {
              values.add(normalized);
            }
          }
        }
        return;
      }

      const value = Number(part);
      const normalized = value === 7 ? 0 : value;
      if (Number.isInteger(normalized) && weekdayOptions.some((item) => item.value === normalized)) {
        values.add(normalized);
      }
    });

  return normalizeWeekdays(Array.from(values));
};

const buildCronExpressionForConfig = (taskKey, taskConfig, fallbackDailyRunTime = null) => {
  const scheduleType = taskConfig?.scheduleType || 'daily';

  if (scheduleType === 'interval') {
    const intervalHours = Math.max(1, Math.min(23, Number(taskConfig?.intervalHours) || 4));
    return `0 */${intervalHours} * * *`;
  }

  const runTime = taskConfig?.runTime || fallbackDailyRunTime || null;
  if (runTime && scheduleType === 'weekly') {
    const weekdays = normalizeWeekdays(taskConfig?.weekdays || []);
    if (weekdays.length > 0) {
      const date = new Date(runTime);
      const hour = date.getHours();
      const minute = date.getMinutes();
      return `${minute} ${hour} * * ${weekdays.join(',')}`;
    }
  }

  if (runTime) {
    const date = new Date(runTime);
    const hour = date.getHours();
    const minute = date.getMinutes();
    return `${minute} ${hour} * * *`;
  }

  const backendTaskType = frontendToBackendTaskMap[taskKey];
  return backendTypeDefaultCronMap.value[backendTaskType] || '0 8 * * *';
};

const serializeBackendComparableConfig = (accountConfig = {}) => {
  const normalized = normalizeAccountConfig(accountConfig);
  const fallbackDailyRunTime = normalized.settings?.dailyRunTime || null;
  const comparable = Object.entries(normalized.taskConfigs || {})
    .filter(([taskKey]) => !localOnlyTaskKeys.has(taskKey) && !!frontendToBackendTaskMap[taskKey])
    .map(([taskKey, taskValue]) => ({
      taskType: frontendToBackendTaskMap[taskKey],
      enabled: !!taskValue.enabled,
      cronExpression: buildCronExpressionForConfig(taskKey, taskValue, fallbackDailyRunTime),
      config: mapFrontendConfigToBackend(taskKey, taskValue),
    }))
    .sort((a, b) => a.taskType.localeCompare(b.taskType));

  return JSON.stringify(comparable);
};

const hasLegacyConfigDiff = computed(() => {
  const accountId = String(selectedAccountId.value || '').trim();
  if (!accountId || dismissedLegacyAccounts.value[accountId]) {
    return false;
  }

  const legacyConfig = legacyLocalConfigs.value[accountId];
  if (!legacyConfig) {
    return false;
  }

  return serializeBackendComparableConfig(legacyConfig) !== serializeBackendComparableConfig(currentAccountConfig.value);
});

const schedulableTasks = computed(() => {
  return availableTasks.filter((task) => !localOnlyTaskKeys.has(task.value));
});

const accountOptions = computed(() => {
  return accountStore.accounts.map((account) => ({
    label: account.name,
    value: account.id,
  }));
});

const currentAccountName = computed(() => {
  const account = accountStore.accounts.find((t) => t.id === selectedAccountId.value);
  return account?.name || '';
});

const getTaskEnabled = (taskValue) => {
  const config = currentAccountConfig.value.taskConfigs[taskValue];
  return config?.enabled ?? true;
};

const setTaskEnabled = (taskValue, enabled) => {
  if (!currentAccountConfig.value.taskConfigs[taskValue]) {
    currentAccountConfig.value.taskConfigs[taskValue] = createEmptyTaskScheduleConfig();
  }
  currentAccountConfig.value.taskConfigs[taskValue].enabled = enabled;
};

const getTaskRunTime = (taskValue) => {
  const config = currentAccountConfig.value.taskConfigs[taskValue];
  return config?.runTime || null;
};

const setTaskRunTime = (taskValue, runTime) => {
  if (!currentAccountConfig.value.taskConfigs[taskValue]) {
    currentAccountConfig.value.taskConfigs[taskValue] = createEmptyTaskScheduleConfig();
  }
  currentAccountConfig.value.taskConfigs[taskValue].runTime = runTime;
};

const getTaskScheduleType = (taskValue) => {
  const config = currentAccountConfig.value.taskConfigs[taskValue];
  return config?.scheduleType || 'daily';
};

const setTaskScheduleType = (taskValue, scheduleType) => {
  if (!currentAccountConfig.value.taskConfigs[taskValue]) {
    currentAccountConfig.value.taskConfigs[taskValue] = createEmptyTaskScheduleConfig();
  }
  currentAccountConfig.value.taskConfigs[taskValue].scheduleType = scheduleType;
  if (scheduleType === 'interval' && !currentAccountConfig.value.taskConfigs[taskValue].intervalHours) {
    currentAccountConfig.value.taskConfigs[taskValue].intervalHours = 4;
  }
  if (scheduleType === 'weekly') {
    const currentWeekdays = currentAccountConfig.value.taskConfigs[taskValue].weekdays || [];
    currentAccountConfig.value.taskConfigs[taskValue].weekdays = normalizeWeekdays(
      currentWeekdays.length > 0 ? currentWeekdays : [1]
    );
    if (!currentAccountConfig.value.taskConfigs[taskValue].runTime && dailyRunTime.value) {
      currentAccountConfig.value.taskConfigs[taskValue].runTime = dailyRunTime.value;
    }
  }
};

const getTaskWeekdays = (taskValue) => {
  const config = currentAccountConfig.value.taskConfigs[taskValue];
  return normalizeWeekdays(config?.weekdays || []);
};

const setTaskWeekdays = (taskValue, weekdays) => {
  if (!currentAccountConfig.value.taskConfigs[taskValue]) {
    currentAccountConfig.value.taskConfigs[taskValue] = createEmptyTaskScheduleConfig();
  }
  const normalizedWeekdays = normalizeWeekdays(weekdays);
  if (normalizedWeekdays.length > 0) {
    currentAccountConfig.value.taskConfigs[taskValue].weekdays = normalizedWeekdays;
  }
};

const getTaskIntervalHours = (taskValue) => {
  const config = currentAccountConfig.value.taskConfigs[taskValue];
  return config?.intervalHours ?? 4;
};

const setTaskIntervalHours = (taskValue, intervalHours) => {
  if (!currentAccountConfig.value.taskConfigs[taskValue]) {
    currentAccountConfig.value.taskConfigs[taskValue] = createEmptyTaskScheduleConfig();
  }
  currentAccountConfig.value.taskConfigs[taskValue].intervalHours = intervalHours || 4;
};

const getGroupType = (group) => {
  const typeMap = {
    daily: 'success',
    dungeon: 'warning',
    resource: 'info',
    legacy: 'default',
    monthly: 'error',
    other: 'default',
  };
  return typeMap[group] || 'default';
};

const getGroupLabel = (groupName) => {
  const group = taskGroupDefinitions.find((g) => g.name === groupName);
  return group ? group.label : '其他';
};

const parseCronToSchedule = (cronExpression) => {
  if (!cronExpression) {
    return {
      scheduleType: 'daily',
      runTime: null,
      intervalHours: 4,
      weekdays: [],
    };
  }

  const parts = String(cronExpression).trim().split(/\s+/);
  if (parts.length === 5) {
    const [minuteField, hourField, dayOfMonthField, monthField, dayOfWeekField] = parts;

    if (hourField.startsWith('*/') && dayOfMonthField === '*' && monthField === '*' && dayOfWeekField === '*') {
      return {
        scheduleType: 'interval',
        runTime: null,
        intervalHours: Math.max(1, Math.min(23, Number(hourField.slice(2)) || 4)),
        weekdays: [],
      };
    }

    const minute = Number(minuteField);
    const hour = Number(hourField);
    const date = new Date();
    if (Number.isInteger(hour) && Number.isInteger(minute)) {
      date.setHours(hour, minute, 0, 0);

      if (dayOfMonthField === '*' && monthField === '*' && dayOfWeekField !== '*') {
        const weekdays = parseCronWeekdays(dayOfWeekField);
        if (weekdays.length > 0) {
          return {
            scheduleType: 'weekly',
            runTime: date.getTime(),
            intervalHours: 4,
            weekdays,
          };
        }
      }

      if (dayOfMonthField === '*' && monthField === '*' && dayOfWeekField === '*') {
        return {
          scheduleType: 'daily',
          runTime: date.getTime(),
          intervalHours: 4,
          weekdays: [],
        };
      }
    }
  }

  return {
    scheduleType: 'daily',
    runTime: null,
    intervalHours: 4,
    weekdays: [],
  };
};

const buildCronExpression = (taskKey, taskConfig) => buildCronExpressionForConfig(taskKey, taskConfig, dailyRunTime.value);

const mapBackendConfigToFrontend = (taskKey, backendConfig = {}) => {
  const mapped = { ...(backendConfig || {}) };
  if (taskKey === 'batcharenafight' && backendConfig.battleCount !== undefined) {
    mapped.arenaBattleCount = backendConfig.battleCount;
  }
  if (taskKey === 'climbTower' && backendConfig.maxFloors !== undefined) {
    mapped.towerMaxFloors = backendConfig.maxFloors;
  }
  if (taskKey === 'climbWeirdTower' && (backendConfig.weirdTowerMaxFloors !== undefined || backendConfig.maxFloors !== undefined)) {
    mapped.weirdTowerMaxFloors = backendConfig.weirdTowerMaxFloors ?? backendConfig.maxFloors;
  }
  if (taskKey === 'batchLegionBoss') {
    mapped.bossFormation = backendConfig.bossFormation ?? 2;
    mapped.bossTimes = backendConfig.bossTimes ?? 2;
  }
  if (taskKey === 'batchSmartSendCar') {
    mapped.smartDepartureMinCarColor = backendConfig.minCarColor ?? 4;
    mapped.smartDepartureMaxRefreshAttempts = backendConfig.maxRefreshAttempts ?? 3;
    mapped.smartDepartureAllowGoldRefresh = backendConfig.allowGoldRefresh ?? false;
    mapped.smartDepartureFallbackSendWhenStuck = backendConfig.fallbackSendWhenStuck ?? true;
    mapped.smartDepartureGoldThreshold = backendConfig.goldThreshold ?? 0;
    mapped.smartDepartureRecruitThreshold = backendConfig.recruitThreshold ?? 0;
    mapped.smartDepartureJadeThreshold = backendConfig.jadeThreshold ?? 0;
    mapped.smartDepartureTicketThreshold = backendConfig.ticketThreshold ?? 0;
    mapped.smartDepartureMatchAll = backendConfig.matchAll ?? false;
  }
  if (taskKey === 'batchLegacyClaim' && backendConfig.interval !== undefined) {
    mapped.legacyClaimInterval = backendConfig.interval;
  }
  if (taskKey === 'claimHangUpRewards') {
    mapped.hangupClaimCount = backendConfig.count ?? backendConfig.hangupClaimCount ?? 5;
  }
  if (taskKey === 'batchFriendGold') {
    mapped.friendGoldCount = backendConfig.count ?? backendConfig.friendGoldCount ?? 3;
  }
  if (taskKey === 'batchBuyGold' && backendConfig.buyNum !== undefined) {
    mapped.buyGoldTimes = backendConfig.buyNum;
  }
  if (taskKey === 'batchRecruit') {
    const rawPaidRecruitCount = Math.max(0, Number(backendConfig.paidRecruitCount ?? 1) || 0);
    mapped.useFreeRecruit = backendConfig.useFreeRecruit ?? true;
    mapped.usePaidRecruit = (backendConfig.usePaidRecruit ?? true) && rawPaidRecruitCount > 0;
    mapped.freeRecruitCount = Math.max(1, Number(backendConfig.freeRecruitCount ?? 1) || 1);
    mapped.paidRecruitCount = mapped.usePaidRecruit ? Math.max(1, rawPaidRecruitCount || 1) : 0;
    // 兼容旧配置
    if (backendConfig.recruitType !== undefined && backendConfig.count !== undefined) {
      mapped.useFreeRecruit = Number(backendConfig.recruitType) === 3;
      mapped.usePaidRecruit = Number(backendConfig.recruitType) === 1;
      if (mapped.useFreeRecruit) mapped.freeRecruitCount = backendConfig.count;
      if (mapped.usePaidRecruit) {
        mapped.paidRecruitCount = backendConfig.count;
      } else {
        mapped.paidRecruitCount = 0;
      }
    }
  }
  if (taskKey === 'batchOpenBox') {
    mapped.boxType = backendConfig.boxType ?? 2001;
    mapped.boxCount = backendConfig.number ?? backendConfig.count ?? 10;
  }
  if (taskKey === 'batchFish') {
    mapped.fishType = backendConfig.type ?? 1;
    mapped.fishCount = backendConfig.count ?? 3;
  }
  if (taskKey === 'batchBuyDreamItems') {
    const list = backendConfig.purchaseList || [];
    mapped.dreamPurchaseList = Array.isArray(list) ? list.join(',') : (list || '');
  }
  return mapped;
};

const mapFrontendConfigToBackend = (taskKey, taskConfig = {}) => {
  const sourceConfig = taskConfig.config || {};
  if (taskKey === 'batcharenafight') {
    return {
      battleCount: sourceConfig.arenaBattleCount ?? 3,
    };
  }
  if (taskKey === 'climbTower') {
    return {
      maxFloors: sourceConfig.towerMaxFloors ?? 10,
    };
  }
  if (taskKey === 'climbWeirdTower') {
    return {
      weirdTowerMaxFloors: sourceConfig.weirdTowerMaxFloors ?? 10,
    };
  }
  if (taskKey === 'batchLegionBoss') {
    return {
      bossFormation: Number(sourceConfig.bossFormation ?? 2) || 2,
      bossTimes: Math.max(0, Number(sourceConfig.bossTimes ?? 2) || 0),
    };
  }
  if (taskKey === 'batchSmartSendCar') {
    return {
      minCarColor: Math.max(0, Number(sourceConfig.smartDepartureMinCarColor ?? 4) || 0),
      maxRefreshAttempts: Math.max(0, Number(sourceConfig.smartDepartureMaxRefreshAttempts ?? 3) || 0),
      allowGoldRefresh: sourceConfig.smartDepartureAllowGoldRefresh ?? false,
      fallbackSendWhenStuck: sourceConfig.smartDepartureFallbackSendWhenStuck ?? true,
      goldThreshold: sourceConfig.smartDepartureGoldThreshold ?? 0,
      recruitThreshold: sourceConfig.smartDepartureRecruitThreshold ?? 0,
      jadeThreshold: sourceConfig.smartDepartureJadeThreshold ?? 0,
      ticketThreshold: sourceConfig.smartDepartureTicketThreshold ?? 0,
      matchAll: sourceConfig.smartDepartureMatchAll ?? false,
    };
  }
  if (taskKey === 'batchLegacyClaim') {
    return {
      interval: sourceConfig.legacyClaimInterval ?? 60,
    };
  }
  if (taskKey === 'claimHangUpRewards') {
    return {
      count: sourceConfig.hangupClaimCount ?? 5,
    };
  }
  if (taskKey === 'batchFriendGold') {
    return {
      count: sourceConfig.friendGoldCount ?? 3,
    };
  }
  if (taskKey === 'store_purchase') {
    return {};
  }
  if (taskKey === 'batchBuyGold') {
    return {
      buyNum: sourceConfig.buyGoldTimes ?? 3,
    };
  }
  if (taskKey === 'batchRecruit') {
    const rawPaidRecruitCount = Math.max(0, Number(sourceConfig.paidRecruitCount ?? (sourceConfig.usePaidRecruit === false ? 0 : 1)) || 0);
    const useFreeRecruit = sourceConfig.useFreeRecruit !== false;
    const usePaidRecruit = sourceConfig.usePaidRecruit !== false && rawPaidRecruitCount > 0;
    return {
      useFreeRecruit,
      usePaidRecruit,
      freeRecruitCount: Math.max(1, Number(sourceConfig.freeRecruitCount ?? 1) || 1),
      paidRecruitCount: usePaidRecruit ? Math.max(1, rawPaidRecruitCount || 1) : 0,
    };
  }
  if (taskKey === 'batchOpenBox') {
    return {
      boxType: sourceConfig.boxType ?? 2001,
      number: sourceConfig.boxCount ?? 3,
    };
  }
  if (taskKey === 'batchFish') {
    return {
      type: sourceConfig.fishType ?? 1,
      count: sourceConfig.fishCount ?? 3,
    };
  }
  if (taskKey === 'batchBuyDreamItems') {
    const rawList = sourceConfig.dreamPurchaseList ?? '';
    const purchaseList = String(rawList)
      .split(',')
      .map((v) => v.trim())
      .filter((v) => v && v.includes('-'));
    return {
      purchaseList: purchaseList.length > 0 ? purchaseList : [],
    };
  }
  return sourceConfig;
};

const inferDailyRunTime = (taskConfigs = {}, fallbackRunTime = null) => {
  const firstDailyTask = Object.values(taskConfigs).find((task) => {
    return (task?.scheduleType || 'daily') === 'daily' && !!task?.runTime;
  });
  return firstDailyTask?.runTime || fallbackRunTime || null;
};

const loadAccountTaskConfigsFromBackend = async (accountId, options = {}) => {
  const { force = false } = options;
  const requestId = ++backendLoadRequestId.value;
  const res = await taskStore.fetchAccountTasks(accountId);
  if (requestId !== backendLoadRequestId.value || selectedAccountId.value !== accountId) {
    return;
  }

  const backendConfigs = Array.isArray(res?.data) ? res.data : (res?.data?.items || []);
  const revision = Array.isArray(res?.data) ? null : (res?.data?.revision || null);
  if (!res?.success || !Array.isArray(backendConfigs)) {
    return;
  }

  const baseConfig = createDefaultAccountConfig();
  const mergedTaskConfigs = cloneTaskConfigs(baseConfig.taskConfigs);
  const backendToFrontendTaskMap = Object.fromEntries(
    Object.entries(frontendToBackendTaskMap).map(([frontendTask, backendTask]) => [backendTask, frontendTask]),
  );

  backendConfigs.forEach((item) => {
    const frontendTaskKey = backendToFrontendTaskMap[item.task_type];
    if (!frontendTaskKey || !mergedTaskConfigs[frontendTaskKey]) {
      return;
    }

    const schedule = parseCronToSchedule(item.cron_expression);
    mergedTaskConfigs[frontendTaskKey] = {
      ...mergedTaskConfigs[frontendTaskKey],
      enabled: !!item.enabled,
      config: {
        ...mergedTaskConfigs[frontendTaskKey].config,
        ...mapBackendConfigToFrontend(frontendTaskKey, item.config || {}),
      },
      scheduleType: schedule.scheduleType,
      runTime: schedule.runTime,
      intervalHours: schedule.intervalHours,
      weekdays: schedule.weekdays || [],
    };
  });

  isHydrating.value = true;
  try {
    currentAccountConfig.value = {
      taskConfigs: mergedTaskConfigs,
      settings: {
        ...defaultSettings,
        ...(baseConfig.settings || {}),
      },
    };
    dailyRunTime.value = inferDailyRunTime(
      currentAccountConfig.value.taskConfigs,
      currentAccountConfig.value.settings?.dailyRunTime || null,
    );
    taskStore.taskConfigRevisions[accountId] = revision;
  } finally {
    isHydrating.value = false;
  }
};

const handleAccountChange = async (accountId) => {
  isHydrating.value = true;
  try {
    currentAccountConfig.value = createDefaultAccountConfig();
    dailyRunTime.value = inferDailyRunTime(
      currentAccountConfig.value.taskConfigs,
      currentAccountConfig.value.settings?.dailyRunTime || null,
    );
  } finally {
    isHydrating.value = false;
  }

  if (!accountId) {
    return;
  }

  try {
    await loadAccountTaskConfigsFromBackend(accountId);
  } catch (error) {
    console.error('加载后端任务配置失败:', error);
    message.warning('读取后端任务配置失败，已保留当前页面配置');
  }
};

const applyDailyTime = () => {
  if (!dailyRunTime.value) {
    message.warning('请先选择执行时间');
    return;
  }

  Object.keys(currentAccountConfig.value.taskConfigs).forEach((key) => {
    if (
      currentAccountConfig.value.taskConfigs[key].enabled &&
      (currentAccountConfig.value.taskConfigs[key].scheduleType || 'daily') === 'daily'
    ) {
      currentAccountConfig.value.taskConfigs[key].runTime = dailyRunTime.value;
    }
  });

  message.success('已应用到该账号所有启用的任务');
};

const handleConfigSave = (configs) => {
  currentAccountConfig.value.taskConfigs = configs;
  saveCurrentConfig();
};

const handleManualLegacyReopen = async () => {
  if (!selectedAccountId.value) {
    message.warning('请先选择账号');
    return;
  }

  debugReopening.value = true;
  try {
    const res = await taskStore.executeTask(selectedAccountId.value, 'LEGACY_REOPEN');
    if (!res?.success) {
      throw new Error(res?.error || '调试开启失败');
    }

    const beginTime = res?.data?.hangUpBeginTime || res?.data?.data?.hangUpBeginTime || '';
    message.success(beginTime ? `残卷已主动开启，hangUpBeginTime=${beginTime}` : '残卷已主动开启');
  } catch (error) {
    message.error(error?.message || '调试开启失败');
  } finally {
    debugReopening.value = false;
  }
};

const handleManualLegacyClaim = async () => {
  if (!selectedAccountId.value) {
    message.warning('请先选择账号');
    return;
  }

  debugClaiming.value = true;
  try {
    const res = await taskStore.executeTask(selectedAccountId.value, 'LEGACY_CLAIM');
    if (!res?.success) {
      throw new Error(res?.error || '残卷收取失败');
    }
    message.success(res?.message || '残卷收取成功');
  } catch (error) {
    message.error(error?.message || '残卷收取失败');
  } finally {
    debugClaiming.value = false;
  }
};

const importLegacyLocalConfig = async () => {
  const accountId = String(selectedAccountId.value || '').trim();
  if (taskConfigOperating.value) {
    return;
  }
  if (!accountId || !legacyLocalConfigs.value[accountId]) {
    message.warning('当前账号没有可导入的旧本地配置');
    return;
  }

  legacyImporting.value = true;
  try {
    isHydrating.value = true;
    currentAccountConfig.value = normalizeAccountConfig(legacyLocalConfigs.value[accountId]);
    dailyRunTime.value = inferDailyRunTime(
      currentAccountConfig.value.taskConfigs,
      currentAccountConfig.value.settings?.dailyRunTime || null,
    );
  } finally {
    isHydrating.value = false;
  }

  const result = await syncCurrentConfigToBackend({ notify: true });
  if (result?.success) {
    dismissedLegacyAccounts.value[accountId] = true;
    try {
      localStorage.setItem(TASK_CONFIG_DISMISSED_STORAGE_KEY, JSON.stringify(dismissedLegacyAccounts.value));
    } catch (error) {
      console.error('保存旧本地配置忽略状态失败:', error);
    }
    message.success('旧本地配置已导入到数据库');
  }
  legacyImporting.value = false;
};

const dismissLegacyConfigPrompt = (accountId) => {
  const normalizedAccountId = String(accountId || '').trim();
  if (!normalizedAccountId) {
    return;
  }

  dismissedLegacyAccounts.value[normalizedAccountId] = true;
  try {
    localStorage.setItem(
      TASK_CONFIG_DISMISSED_STORAGE_KEY,
      JSON.stringify(dismissedLegacyAccounts.value),
    );
  } catch (error) {
    console.error('保存旧本地配置忽略状态失败:', error);
  }
};

const syncCurrentConfigToBackend = async ({ notify = false } = {}) => {
  if (!selectedAccountId.value) {
    return { success: false };
  }
  const accountId = selectedAccountId.value;
  const accountName = currentAccountName.value;
  const configSnapshot = normalizeAccountConfig(
    JSON.parse(JSON.stringify(currentAccountConfig.value))
  );
  const baselineRevision = taskStore.taskConfigRevisions[accountId] || null;

  if (notify) {
    saving.value = true;
  }

  try {
    let skippedCount = 0;
    const tasksPayload = [];

    for (const [taskKey, taskValue] of Object.entries(configSnapshot.taskConfigs)) {
      if (localOnlyTaskKeys.has(taskKey)) {
        continue;
      }

      const backendTaskType = frontendToBackendTaskMap[taskKey];
      if (!backendTaskType) {
        skippedCount++;
        continue;
      }

      tasksPayload.push({
        taskType: backendTaskType,
        enabled: !!taskValue.enabled,
        cronExpression: buildCronExpression(taskKey, taskValue),
        config: mapFrontendConfigToBackend(taskKey, taskValue),
      });
    }

    const res = await taskStore.batchUpdateAccountTasks(accountId, tasksPayload, {
      baselineRevision,
    });

    if (!res?.success) {
      throw new Error(res?.error || '保存失败');
    }

    taskStore.taskConfigRevisions[accountId] = res?.data?.revision || null;

    if (notify) {
      message.success(`${accountName} 的配置已保存，已同步 ${tasksPayload.length} 项任务`);
      if (skippedCount > 0) {
        message.info(`有 ${skippedCount} 项仅本地配置任务未同步到后端调度`);
      }
    }

    await loadAccountTaskConfigsFromBackend(accountId, { force: true });
    dismissLegacyConfigPrompt(accountId);
    return { success: true };
  } catch (error) {
    const conflictStatus = Number(error?.errorCode || error?.response?.status || 0);
    if (conflictStatus === 409) {
      const latestRevision = error?.response?.data?.data?.currentRevision || null;
      if (latestRevision) {
        taskStore.taskConfigRevisions[accountId] = latestRevision;
      }
      await loadAccountTaskConfigsFromBackend(accountId, { force: true });
      if (notify) {
        message.warning('检测到该账号任务配置已在其他页面或设备被修改，已刷新为后端最新配置');
      }
      return { success: false, conflict: true };
    }

    if (notify) {
      message.error(error?.response?.data?.error || error?.message || '后端同步失败，请稍后重试');
    } else {
      console.error('[Tasks] 同步任务配置失败:', error);
    }
    return { success: false };
  } finally {
    if (notify) {
      saving.value = false;
    }
  }
};

const saveCurrentConfig = async () => {
  if (taskConfigOperating.value) {
    return;
  }
  if (!selectedAccountId.value) {
    message.warning('请先选择账号');
    return;
  }
  await syncCurrentConfigToBackend({ notify: true });
};

const backupLegacyLocalStorage = () => {
  try {
    const saved = localStorage.getItem(TASK_CONFIG_STORAGE_KEY);
    if (!saved) {
      return;
    }

    const existingBackup = Array.from({ length: localStorage.length }, (_, index) => localStorage.key(index))
      .find((key) => String(key || '').startsWith(TASK_CONFIG_STORAGE_BACKUP_PREFIX));

    if (existingBackup) {
      return;
    }

    const backupKey = `${TASK_CONFIG_STORAGE_BACKUP_PREFIX}${Date.now()}`;
    localStorage.setItem(backupKey, saved);
  } catch (error) {
    console.error('备份旧版任务配置失败:', error);
  }
};

const loadLegacyLocalStorage = () => {
  try {
    const saved = localStorage.getItem(TASK_CONFIG_STORAGE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      legacyLocalConfigs.value = Object.fromEntries(
        Object.entries(parsed || {}).map(([accountId, accountConfig]) => [
          accountId,
          normalizeAccountConfig(accountConfig),
        ]),
      );
    }
  } catch (error) {
    console.error('加载旧版任务配置失败:', error);
  }
};

const loadDismissedLegacyState = () => {
  try {
    const saved = localStorage.getItem(TASK_CONFIG_DISMISSED_STORAGE_KEY);
    dismissedLegacyAccounts.value = saved ? JSON.parse(saved) || {} : {};
  } catch (error) {
    console.error('加载旧本地配置忽略状态失败:', error);
    dismissedLegacyAccounts.value = {};
  }
};

const refreshTasks = async () => {
  await accountStore.fetchAccounts();

  const accountIdSet = new Set(accountStore.accounts.map((a) => String(a.id)));
  Object.keys(taskStore.taskConfigRevisions || {}).forEach((accountId) => {
    if (!accountIdSet.has(String(accountId))) {
      delete taskStore.taskConfigRevisions[accountId];
    }
  });

  if (selectedAccountId.value && !accountIdSet.has(String(selectedAccountId.value))) {
    selectedAccountId.value = accountStore.accounts[0]?.id || null;
  }

  if (selectedAccountId.value) {
    await handleAccountChange(selectedAccountId.value);
  }
  message.success('已刷新配置');
};

watch(dailyRunTime, (value) => {
  if (isHydrating.value) {
    return;
  }

  currentAccountConfig.value.settings = {
    ...(currentAccountConfig.value.settings || {}),
    dailyRunTime: value,
  };
});

watch(
  () => currentAccountConfig.value.settings?.claimEmail,
  (value) => {
    if (isHydrating.value || !currentAccountConfig.value.taskConfigs?.batchMailClaim) {
      return;
    }

    if (currentAccountConfig.value.taskConfigs.batchMailClaim.enabled !== !!value) {
      currentAccountConfig.value.taskConfigs.batchMailClaim.enabled = !!value;
    }
  }
);

watch(
  () => currentAccountConfig.value.taskConfigs?.batchMailClaim?.enabled,
  (value) => {
    if (isHydrating.value || value === undefined) {
      return;
    }

    if (currentAccountConfig.value.settings?.claimEmail !== !!value) {
      currentAccountConfig.value.settings = {
        ...(currentAccountConfig.value.settings || {}),
        claimEmail: !!value,
      };
    }
  }
);

onMounted(() => {
  backupLegacyLocalStorage();
  loadLegacyLocalStorage();
  loadDismissedLegacyState();

  Promise.all([
    accountStore.fetchAccounts(),
    taskStore.fetchTaskTypes(),
  ]).then(([accountRes, taskTypesRes]) => {
    if (taskTypesRes?.success && Array.isArray(taskTypesRes.data)) {
      backendTypeDefaultCronMap.value = Object.fromEntries(
        taskTypesRes.data.map((item) => [item.type, item.defaultCron]),
      );
    }

    if (accountRes?.success && accountStore.accounts.length > 0 && !selectedAccountId.value) {
      selectedAccountId.value = accountStore.accounts[0].id;
      handleAccountChange(selectedAccountId.value);
    }
  }).catch((error) => {
    console.error('初始化任务配置失败:', error);
  });
});
</script>

<style lang="scss" scoped>
.tasks-page {
  display: flex;
  flex-direction: column;
  gap: 18px;

  .card-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 14px;
    flex-wrap: wrap;
  }
}

.tasks-overview-card,
.tasks-content-card {
  :deep(.n-card-header) {
    padding-bottom: 14px;
    border-bottom: none;
  }

  :deep(.n-card__content) {
    padding-top: 18px;
  }
}

.header-actions {
  :deep(.n-button) {
    min-width: 128px;
  }
}

.tasks-tip,
.schedule-tip {
  margin-bottom: 16px;
  border-radius: 18px;
}

.account-selector {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 16px;
  background: rgba(91, 124, 255, 0.05);
  border: 1px solid rgba(138, 151, 185, 0.14);
  border-radius: 18px;
  flex-wrap: wrap;
  color: var(--text-secondary);
  font-weight: 600;
}

.legacy-migration-alert {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  align-items: center;
  flex-wrap: wrap;
}

.account-select {
  width: 320px;
  max-width: 100%;
}

.schedule-section {
  .schedule-header {
    margin-bottom: 16px;
    padding: 14px 16px;
    background: rgba(91, 124, 255, 0.05);
    border: 1px solid rgba(138, 151, 185, 0.14);
    border-radius: 18px;
  }
}

.scheduled-tasks-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
  max-height: 500px;
  overflow-y: auto;
}

.scheduled-task-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  padding: 14px 16px;
  background: rgba(255, 255, 255, 0.72);
  border-radius: 18px;
  border: 1px solid rgba(138, 151, 185, 0.14);
  box-shadow: 0 8px 20px rgba(24, 39, 75, 0.06);

  .task-main {
    display: flex;
    align-items: center;
    gap: 12px;
    min-width: 0;

    .task-name {
      font-weight: 600;
      color: var(--text-primary);
    }
  }

  .task-time {
    flex-shrink: 0;
  }
}

.task-schedule-mode {
  width: 132px;
}

.task-interval-input {
  width: 108px;
  min-height: 36px;

  :deep(.n-input__input-el) {
    height: 34px;
    font-size: 14px;
  }

  :deep(.n-input-number-button) {
    width: 24px;
    height: 16px;
  }

  :deep(.n-input-number-button .n-base-icon) {
    font-size: 12px;
  }
}

.task-weekday-select {
  width: 220px;
}

:deep(.n-alert) {
  border-radius: 18px;
}

:deep(.n-tabs-nav) {
  margin-bottom: 12px;
}

:deep(.n-tabs-tab) {
  border-radius: 999px;
  padding: 10px 16px !important;
  color: var(--text-secondary);
}

:deep(.n-tabs-tab--active) {
  background: rgba(91, 124, 255, 0.1);
  color: var(--primary-color);
  font-weight: 700;
}

:deep(.n-button) {
  background: rgba(255, 255, 255, 0.78);
  border: 1px solid rgba(138, 151, 185, 0.16);
  color: var(--text-primary);
  box-shadow: none;
}

:deep(.n-button:hover) {
  border-color: rgba(91, 124, 255, 0.28);
  color: var(--primary-color);
}

:deep(.n-button--primary-type) {
  background: linear-gradient(135deg, var(--primary-color), var(--secondary-color));
  border-color: transparent;
  color: #fff;
  box-shadow: 0 12px 24px rgba(91, 124, 255, 0.2);
}

:deep(.n-button--primary-type:hover) {
  color: #fff;
  border-color: transparent;
}

:deep(.n-select),
:deep(.n-time-picker),
:deep(.n-input-number),
:deep(.n-base-selection) {
  max-width: 100%;
}

:deep(.n-base-selection),
:deep(.n-input-number),
:deep(.n-input .n-input-wrapper),
:deep(.n-time-picker .n-input__input-el),
:deep(.n-input-number .n-input__input-el) {
  border-radius: 14px !important;
}

:deep(.n-base-selection),
:deep(.n-input-number) {
  min-height: 40px;
  background: rgba(255, 255, 255, 0.86);
  border: 1px solid rgba(138, 151, 185, 0.18);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.35);
}

:deep(.n-base-selection:hover),
:deep(.n-input-number:hover) {
  border-color: rgba(91, 124, 255, 0.28);
}

:deep(.n-base-selection.n-base-selection--active),
:deep(.n-input-number.n-input-number--focus) {
  border-color: rgba(91, 124, 255, 0.45);
  box-shadow:
    0 0 0 4px rgba(91, 124, 255, 0.12),
    inset 0 1px 0 rgba(255, 255, 255, 0.35);
}

:deep(.n-base-selection .n-base-selection-label),
:deep(.n-base-selection .n-base-selection-placeholder),
:deep(.n-input-number .n-input__input-el) {
  color: var(--text-primary);
  font-weight: 500;
}

:deep(.n-input-number .n-input-wrapper),
:deep(.n-time-picker .n-input__input),
:deep(.n-select .n-base-selection-label) {
  background: transparent !important;
  box-shadow: none !important;
}

:deep(.n-input-number .n-input__border),
:deep(.n-time-picker .n-input__border),
:deep(.n-base-selection .n-base-selection__border) {
  display: none !important;
}

:deep(.n-select .n-base-selection-tags),
:deep(.n-base-selection .n-base-selection-label) {
  padding-left: 2px;
}

@media (max-width: 768px) {
  .tasks-page {
    gap: 14px;
  }

  .card-header,
  .account-selector,
  .schedule-header,
  .scheduled-task-item {
    flex-direction: column;
    align-items: stretch;
  }

  .header-actions {
    width: 100%;

    :deep(.n-space) {
      width: 100%;
      justify-content: stretch;
    }

    :deep(.n-button) {
      width: 100%;
      min-width: 0;
    }
  }

  .scheduled-tasks-list {
    max-height: none;
  }

  .scheduled-task-item .task-time {
    width: 100%;
  }

  .task-schedule-mode,
  .task-interval-input,
  .task-weekday-select {
    width: 100%;
  }
}

@media (max-width: 480px) {
  .account-selector,
  .schedule-section .schedule-header,
  .scheduled-task-item {
    padding: 12px 14px;
  }
}
</style>
