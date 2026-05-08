<template>
  <div class="user-management-page">
    <el-card class="management-card scheduler-settings-card">
      <template #header>
        <div class="card-header">
          <div>
            <span>调度并发设置</span>
          </div>
        </div>
      </template>

      <div class="scheduler-settings-panel" v-loading="schedulerSettingsLoading">
        <div class="scheduler-setting-main">
          <div class="scheduler-setting-field">
            <div class="scheduler-setting-title">直连并发账号数</div>
            <el-input-number
              v-model="schedulerMaxConcurrentAccounts"
              :min="schedulerLimits.min"
              :max="schedulerLimits.max"
              controls-position="right"
            />
          </div>
          <div class="scheduler-setting-field">
            <div class="scheduler-setting-title">代理并发账号数</div>
            <el-input-number
              v-model="schedulerProxyMaxConcurrentAccounts"
              :min="schedulerLimits.min"
              :max="schedulerLimits.max"
              controls-position="right"
            />
          </div>
          <div class="scheduler-setting-field">
            <div class="scheduler-setting-title">直连启动间隔（秒）</div>
            <el-input-number
              v-model="schedulerAccountDispatchIntervalSeconds"
              :min="schedulerLimits.accountDispatchIntervalSecondsMin"
              :max="schedulerLimits.accountDispatchIntervalSecondsMax"
              controls-position="right"
            />
          </div>
          <div class="scheduler-setting-field">
            <div class="scheduler-setting-title">代理启动间隔（秒）</div>
            <el-input-number
              v-model="schedulerProxyAccountDispatchIntervalSeconds"
              :min="schedulerLimits.accountDispatchIntervalSecondsMin"
              :max="schedulerLimits.accountDispatchIntervalSecondsMax"
              controls-position="right"
            />
          </div>
          <div class="scheduler-setting-control">
            <el-button type="primary" :loading="schedulerSettingsSaving" @click="saveSchedulerSettings">
              保存
            </el-button>
          </div>
        </div>
      </div>
    </el-card>

    <el-card class="management-card proxy-settings-card">
      <template #header>
        <div class="card-header">
          <div>
            <span>代理发布策略</span>
            <p class="header-subtitle">按游戏账号名称控制后端定时任务是否通过代理连接，默认关闭且失败可自动直连降级。</p>
          </div>
          <div class="proxy-status-tags">
            <el-tag :type="proxyForm.enabled ? 'success' : 'info'">
              {{ proxyForm.enabled ? '已启用' : '已关闭' }}
            </el-tag>
            <el-tag type="warning" plain>{{ getProxyStrategyLabel(proxyForm.rollout.strategy) }}</el-tag>
          </div>
        </div>
      </template>

      <div class="proxy-settings-panel" v-loading="proxySettingsLoading">
        <el-form label-width="110px" class="proxy-settings-form">
          <div class="proxy-switch-row">
            <el-form-item label="启用代理">
              <el-switch
                v-model="proxyForm.enabled"
                active-text="启用"
                inactive-text="关闭"
              />
            </el-form-item>
            <el-form-item label="失败降级">
              <el-switch
                v-model="proxyForm.fallbackToDirect"
                active-text="直连兜底"
                inactive-text="不降级"
              />
            </el-form-item>
            <el-form-item label="失败重试">
              <el-input-number
                v-model="proxyForm.maxRetries"
                :min="1"
                :max="10"
                controls-position="right"
              />
            </el-form-item>
          </div>

          <el-form-item label="发布策略">
            <el-radio-group v-model="proxyForm.rollout.strategy">
              <el-radio-button label="whitelist">白名单</el-radio-button>
              <el-radio-button label="percentage">百分比</el-radio-button>
              <el-radio-button label="all">全量</el-radio-button>
              <el-radio-button label="none">暂停</el-radio-button>
            </el-radio-group>
          </el-form-item>

          <el-form-item
            v-if="proxyForm.rollout.strategy === 'percentage'"
            label="灰度比例"
          >
            <div class="proxy-percentage-control">
              <el-slider
                v-model="proxyForm.rollout.percentage"
                :min="0"
                :max="100"
                :step="1"
                show-input
              />
            </div>
          </el-form-item>

          <el-form-item
            v-if="proxyForm.rollout.strategy === 'whitelist'"
            label="白名单账号"
          >
            <el-select
              v-model="proxyForm.rollout.whitelist"
              multiple
              filterable
              allow-create
              default-first-option
              placeholder="选择或输入游戏账号名称"
              class="proxy-account-select"
            >
              <el-option
                v-for="name in proxyAccountNameOptions"
                :key="`proxy-whitelist-${name}`"
                :label="name"
                :value="name"
              />
            </el-select>
          </el-form-item>

          <el-form-item label="排除账号">
            <el-select
              v-model="proxyForm.rollout.excludeList"
              multiple
              filterable
              allow-create
              default-first-option
              placeholder="始终不走代理的游戏账号名称"
              class="proxy-account-select"
            >
              <el-option
                v-for="name in proxyAccountNameOptions"
                :key="`proxy-exclude-${name}`"
                :label="name"
                :value="name"
              />
            </el-select>
            <div class="form-tip">排除列表优先级最高；白名单/百分比/全量命中后也会被排除。</div>
          </el-form-item>
        </el-form>

        <div class="proxy-stats-row">
          <span>代理池：{{ proxyPoolStats.valid || 0 }} / {{ proxyPoolStats.total || 0 }} 可用</span>
          <span>代理源：{{ proxyPoolStats.sources?.enabled || 0 }} / {{ proxyPoolStats.sources?.total || 0 }} 启用</span>
          <span>已分配：{{ proxyPoolStats.assigned || 0 }}</span>
          <span>平均延迟：{{ proxyPoolStats.avgResponseTime || 0 }}ms</span>
          <span>命中过代理的账号：{{ proxyStats?.accountsUsingProxy || 0 }}</span>
          <span v-if="proxyPoolStats.warmup?.running">预热中，请稍后刷新</span>
        </div>

        <div class="proxy-actions">
          <el-button @click="fetchProxySettings" :disabled="proxySettingsSaving">刷新</el-button>
          <el-button
            type="success"
            plain
            :loading="proxyWarmupLoading"
            :disabled="proxySettingsSaving"
            @click="warmupProxyPool"
          >
            预热代理池
          </el-button>
          <el-button type="primary" :loading="proxySettingsSaving" @click="saveProxySettings">
            保存代理策略
          </el-button>
        </div>
      </div>
    </el-card>

    <el-card class="management-card broadcast-card">
      <template #header>
        <div class="card-header">
          <div>
            <span>公共通知</span>
            <p class="header-subtitle">仅保留 1 条当前广播，登录用户进入页面时会自动弹出。</p>
          </div>
        </div>
      </template>

      <div class="broadcast-panel" v-loading="broadcastLoading">
        <el-form label-width="80px">
          <el-form-item label="标题">
            <el-input
              v-model="broadcastForm.title"
              maxlength="60"
              show-word-limit
              placeholder="请输入通知标题"
            />
          </el-form-item>
          <el-form-item label="正文">
            <el-input
              v-model="broadcastForm.content"
              type="textarea"
              :rows="5"
              maxlength="1000"
              show-word-limit
              placeholder="请输入通知正文"
            />
          </el-form-item>
        </el-form>

        <div v-if="currentBroadcast" class="broadcast-meta">
          <span>当前广播ID：{{ currentBroadcast.id }}</span>
          <span>更新时间：{{ formatTime(currentBroadcast.updatedAt) || '-' }}</span>
        </div>

        <div class="broadcast-actions">
          <el-button @click="loadBroadcast" :disabled="broadcastSaving">刷新</el-button>
          <el-button type="danger" plain @click="clearBroadcast" :loading="broadcastClearing">清空</el-button>
          <el-button type="primary" @click="saveBroadcast" :loading="broadcastSaving">发布通知</el-button>
        </div>
      </div>
    </el-card>

    <el-card class="management-card">
      <template #header>
        <div class="card-header">
          <span>用户管理</span>
          <el-button type="primary" @click="openCreateDialog">新增用户</el-button>
        </div>
      </template>

      <el-table :data="users" v-loading="loading" stripe class="user-table">
        <el-table-column prop="username" label="用户名" min-width="120" />
        <el-table-column label="角色" width="100">
          <template #default="{ row }">
            <el-tag :type="row.role === 'admin' ? 'danger' : 'info'">
              {{ row.role === 'admin' ? '管理员' : '普通用户' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="140">
          <template #default="{ row }">
            <el-tag :type="getUserStatusType(row)">
              {{ getUserStatusText(row) }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="可用时间" min-width="260">
          <template #default="{ row }">
            <div class="time-window">
              <div>开始：{{ formatTime(row.access_start_at) || '不限' }}</div>
              <div>结束：{{ formatTime(row.access_end_at) || '不限' }}</div>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="已导入游戏账号" width="130" align="center">
          <template #default="{ row }">
            {{ row.game_account_count || 0 }} / {{ row.max_game_accounts || '不限' }}
          </template>
        </el-table-column>
        <el-table-column label="最后登录" width="180">
          <template #default="{ row }">
            {{ formatTime(row.last_login) || '-' }}
          </template>
        </el-table-column>
        <el-table-column label="创建时间" width="180">
          <template #default="{ row }">
            {{ formatTime(row.created_at) || '-' }}
          </template>
        </el-table-column>
        <el-table-column label="操作" width="280" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" @click="openLogDialog(row)">查看日志</el-button>
            <el-button link type="primary" @click="openEditDialog(row)">编辑</el-button>
            <el-button
              link
              :type="row.is_enabled ? 'warning' : 'success'"
              @click="quickToggle(row)"
              :disabled="isCurrentUser(row)"
            >
              {{ row.is_enabled ? '禁用' : '启用' }}
            </el-button>
            <el-button
              link
              type="danger"
              @click="deleteUser(row)"
              :disabled="isCurrentUser(row)"
            >
              删除
            </el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <el-dialog
      v-model="dialogVisible"
      :title="isEditing ? '编辑用户' : '新增用户'"
      width="min(520px, 100%)"
      destroy-on-close
      class="responsive-dialog user-edit-dialog"
    >
      <el-form ref="formRef" :model="form" :rules="rules" label-width="110px">
        <el-form-item label="用户名" prop="username">
          <el-input v-model="form.username" maxlength="20" show-word-limit />
        </el-form-item>
        <el-form-item :label="isEditing ? '新密码' : '密码'" prop="password">
          <el-input
            v-model="form.password"
            type="password"
            :placeholder="isEditing ? '留空则不修改密码' : '请输入密码'"
            show-password
          />
        </el-form-item>
        <el-form-item label="角色" prop="role">
          <el-radio-group v-model="form.role">
            <el-radio label="user">普通用户</el-radio>
            <el-radio label="admin">管理员</el-radio>
          </el-radio-group>
        </el-form-item>
        <el-form-item label="启用账号" prop="is_enabled">
          <el-switch v-model="form.is_enabled" />
        </el-form-item>
        <el-form-item label="账号数量上限">
          <div class="limit-setting">
            <el-switch v-model="form.limit_enabled" />
            <span class="limit-setting-text">{{ form.limit_enabled ? '启用限制' : '不限数量' }}</span>
          </div>
          <el-input-number
            v-if="form.limit_enabled"
            v-model="form.max_game_accounts"
            :min="1"
            :max="9999"
            style="width: 100%; margin-top: 8px"
            controls-position="right"
          />
          <div class="form-tip">默认上限为 5。你也可以关闭限制，允许该用户不限数量。</div>
        </el-form-item>
        <el-form-item label="开始可用">
          <el-date-picker
            v-model="form.access_start_at"
            type="datetime"
            placeholder="不限制开始时间"
            style="width: 100%"
            clearable
            value-format="YYYY-MM-DD HH:mm:ss"
          />
        </el-form-item>
        <el-form-item label="结束可用">
          <el-date-picker
            v-model="form.access_end_at"
            type="datetime"
            placeholder="不限制结束时间"
            style="width: 100%"
            clearable
            value-format="YYYY-MM-DD HH:mm:ss"
          />
        </el-form-item>
      </el-form>

      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="submitForm">
          {{ isEditing ? '保存' : '创建' }}
        </el-button>
      </template>
    </el-dialog>

    <el-dialog
      v-model="logDialogVisible"
      width="min(760px, 100%)"
      destroy-on-close
      class="responsive-dialog user-log-dialog"
      :title="logDialogTitle"
    >
      <div class="log-filter-bar">
        <span class="log-filter-label">游戏账号</span>
        <el-select
          v-model="selectedLogAccountId"
          class="log-account-select"
          placeholder="请选择游戏账号"
          filterable
          clearable
          :loading="logAccountsLoading"
          @change="handleLogAccountChange"
        >
          <el-option
            v-for="account in logAccounts"
            :key="account.id"
            :label="account.name"
            :value="account.id"
          />
        </el-select>
        <el-button :loading="logLoading" @click="refreshUserLogs">刷新</el-button>
      </div>

      <el-skeleton v-if="logLoading && !userLogs.length" :rows="6" animated />

      <template v-else>
        <el-empty
          v-if="!logAccountsLoading && logAccounts.length === 0"
          description="该用户暂无游戏账号"
        />

        <el-empty
          v-else-if="!selectedLogAccountId"
          description="请选择要查看日志的游戏账号"
        />

        <el-empty
          v-else-if="userLogs.length === 0"
          description="当前账号暂无执行记录"
        />

        <div v-else class="log-list-wrap">
          <div class="account-summary">
            <span class="account-name">{{ currentLogAccountName }}</span>
            <span class="log-count">当前显示最近 {{ userLogs.length }} 条记录</span>
          </div>

          <div class="log-items">
            <div
              v-for="log in userLogs"
              :key="log.id"
              class="log-item"
            >
              <div class="log-item-header">
                <div class="log-left">
                  <el-tag size="small" :type="getLogStatusType(log)">
                    {{ getLogStatusText(log) }}
                  </el-tag>
                  <span class="log-time">{{ formatLogTime(log.created_at) }}</span>
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
    </el-dialog>
  </div>
</template>

<script setup>
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import api from '@/api';
import { useAuthStore } from '@stores/auth';

const authStore = useAuthStore();
const loading = ref(false);
const saving = ref(false);
const dialogVisible = ref(false);
const isEditing = ref(false);
const editingId = ref(null);
const users = ref([]);
const formRef = ref();
const taskTypeNameMap = ref({});
const logDialogVisible = ref(false);
const logAccountsLoading = ref(false);
const logLoading = ref(false);
const selectedLogUser = ref(null);
const logAccounts = ref([]);
const selectedLogAccountId = ref(null);
const userLogs = ref([]);
const schedulerSettingsLoading = ref(false);
const schedulerSettingsSaving = ref(false);
const schedulerMaxConcurrentAccounts = ref(3);
const schedulerProxyMaxConcurrentAccounts = ref(2);
const schedulerAccountDispatchIntervalSeconds = ref(8);
const schedulerProxyAccountDispatchIntervalSeconds = ref(12);
const schedulerLimits = reactive({
  min: 1,
  max: 20,
  accountDispatchIntervalSecondsMin: 0,
  accountDispatchIntervalSecondsMax: 120,
});
const proxySettingsLoading = ref(false);
const proxySettingsSaving = ref(false);
const proxyWarmupLoading = ref(false);
const proxyAccountNameOptions = ref([]);
const proxyStats = ref(null);
const proxyPoolStats = reactive({
  total: 0,
  valid: 0,
  assigned: 0,
  avgResponseTime: 0,
  warmup: null,
  sources: null,
});
const broadcastLoading = ref(false);
const broadcastSaving = ref(false);
const broadcastClearing = ref(false);
const currentBroadcast = ref(null);
const BENIGN_LOG_KEYWORDS = [
  '活动未开放',
  '不在开启时间内',
  '出了点小问题',
  '扫荡条件不满足',
  '已经选择过上阵武将了',
  '今日已领取免费奖励',
  '今天已经签到过了',
];

const createEmptyForm = () => ({
  username: '',
  password: '',
  role: 'user',
  is_enabled: true,
  limit_enabled: true,
  max_game_accounts: 5,
  access_start_at: null,
  access_end_at: null
});

const createDefaultProxyForm = () => ({
  enabled: false,
  fallbackToDirect: true,
  maxRetries: 3,
  rollout: {
    strategy: 'whitelist',
    whitelist: [],
    percentage: 0,
    excludeList: [],
  },
});

const form = reactive(createEmptyForm());
const proxyForm = reactive(createDefaultProxyForm());
const broadcastForm = reactive({
  title: '',
  content: '',
});

const passwordValidator = (rule, value, callback) => {
  if (!isEditing.value && !value) {
    callback(new Error('请输入密码'));
    return;
  }
  if (value && value.length < 6) {
    callback(new Error('密码至少 6 位'));
    return;
  }
  callback();
};

const timeValidator = (rule, value, callback) => {
  if (form.access_start_at && form.access_end_at) {
    const start = new Date(form.access_start_at).getTime();
    const end = new Date(form.access_end_at).getTime();
    if (start > end) {
      callback(new Error('开始时间不能晚于结束时间'));
      return;
    }
  }
  callback();
};

const rules = {
  username: [
    { required: true, message: '请输入用户名', trigger: 'blur' },
    { min: 3, max: 20, message: '用户名长度需要在 3-20 个字符之间', trigger: 'blur' }
  ],
  password: [{ validator: passwordValidator, trigger: 'blur' }],
  access_start_at: [{ validator: timeValidator, trigger: 'change' }],
  access_end_at: [{ validator: timeValidator, trigger: 'change' }]
};

const currentUserId = computed(() => Number(authStore.user?.id || 0));
const currentLogAccountName = computed(() => {
  const current = logAccounts.value.find((item) => item.id === selectedLogAccountId.value);
  return current?.name || '未选择账号';
});
const logDialogTitle = computed(() => {
  const username = selectedLogUser.value?.username || '';
  return username ? `查看日志 - ${username}` : '查看日志';
});

const resetForm = () => {
  Object.assign(form, createEmptyForm());
  editingId.value = null;
  isEditing.value = false;
  formRef.value?.clearValidate?.();
};

const toPickerValue = (value) => {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const pad = (num) => String(num).padStart(2, '0');
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate())
  ].join('-') + ' ' + [
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds())
  ].join(':');
};

const formatTime = (value) => {
  if (!value) return '';
  const text = String(value);
  const normalized = text.includes('T') ? text : text.replace(' ', 'T');
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) return text;
  return date.toLocaleString('zh-CN', { hour12: false });
};

const formatLogTime = (value) => {
  if (!value) return '-';
  const text = String(value).trim();
  const normalized = text.includes('T') ? text : text.replace(' ', 'T');
  const hasTimezone = /([zZ]|[+-]\d{2}:?\d{2})$/.test(normalized);
  const date = new Date(hasTimezone ? normalized : `${normalized}Z`);
  if (Number.isNaN(date.getTime())) return text;
  return date.toLocaleString('zh-CN');
};

const getTaskLabel = (taskType) => taskTypeNameMap.value[taskType] || taskType || '-';

const isBenignLog = (log) => {
  const text = `${log?.message || ''} ${log?.details || ''}`;
  return BENIGN_LOG_KEYWORDS.some((keyword) => text.includes(keyword));
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

const getUserStatusText = (row) => {
  if (!row.is_enabled) return '已禁用';
  const now = Date.now();
  if (row.access_start_at && now < new Date(row.access_start_at).getTime()) return '未到开始时间';
  if (row.access_end_at && now > new Date(row.access_end_at).getTime()) return '已过期';
  return '可用';
};

const getUserStatusType = (row) => {
  if (!row.is_enabled) return 'danger';
  const text = getUserStatusText(row);
  if (text === '可用') return 'success';
  if (text === '未到开始时间') return 'warning';
  return 'info';
};

const isCurrentUser = (row) => Number(row.id) === currentUserId.value;

const normalizeNameList = (value) => {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(
    value
      .map((item) => String(item || '').trim())
      .filter(Boolean)
  ));
};

const getProxyStrategyLabel = (strategy) => {
  const labels = {
    whitelist: '白名单',
    percentage: '百分比',
    all: '全量',
    none: '暂停',
  };
  return labels[strategy] || '白名单';
};

const fetchUsers = async () => {
  loading.value = true;
  try {
    const res = await api.get('/admin/users');
    if (res.success) {
      users.value = res.data;
    }
  } finally {
    loading.value = false;
  }
};

const fetchSchedulerSettings = async () => {
  schedulerSettingsLoading.value = true;
  try {
    const res = await api.get('/admin/users/settings/scheduler');
    if (res.success) {
      schedulerMaxConcurrentAccounts.value = Number(res.data?.maxConcurrentAccounts || 3);
      schedulerProxyMaxConcurrentAccounts.value = Number(res.data?.proxyMaxConcurrentAccounts || 2);
      schedulerAccountDispatchIntervalSeconds.value = Number(res.data?.accountDispatchIntervalSeconds ?? 8);
      schedulerProxyAccountDispatchIntervalSeconds.value = Number(res.data?.proxyAccountDispatchIntervalSeconds ?? 12);
      schedulerLimits.min = Number(res.data?.limits?.min || 1);
      schedulerLimits.max = Number(res.data?.limits?.max || 20);
      schedulerLimits.accountDispatchIntervalSecondsMin = Number(res.data?.limits?.accountDispatchIntervalSecondsMin ?? 0);
      schedulerLimits.accountDispatchIntervalSecondsMax = Number(res.data?.limits?.accountDispatchIntervalSecondsMax ?? 120);
    }
  } catch (error) {
    ElMessage.error(error.response?.data?.error || '获取调度并发设置失败');
  } finally {
    schedulerSettingsLoading.value = false;
  }
};

const saveSchedulerSettings = async () => {
  schedulerSettingsSaving.value = true;
  try {
    const res = await api.put('/admin/users/settings/scheduler', {
      maxConcurrentAccounts: schedulerMaxConcurrentAccounts.value,
      proxyMaxConcurrentAccounts: schedulerProxyMaxConcurrentAccounts.value,
      accountDispatchIntervalSeconds: schedulerAccountDispatchIntervalSeconds.value,
      proxyAccountDispatchIntervalSeconds: schedulerProxyAccountDispatchIntervalSeconds.value,
    });
    if (res.success) {
      schedulerMaxConcurrentAccounts.value = Number(res.data?.maxConcurrentAccounts || schedulerMaxConcurrentAccounts.value);
      schedulerProxyMaxConcurrentAccounts.value = Number(
        res.data?.proxyMaxConcurrentAccounts || schedulerProxyMaxConcurrentAccounts.value,
      );
      schedulerAccountDispatchIntervalSeconds.value = Number(
        res.data?.accountDispatchIntervalSeconds ?? schedulerAccountDispatchIntervalSeconds.value,
      );
      schedulerProxyAccountDispatchIntervalSeconds.value = Number(
        res.data?.proxyAccountDispatchIntervalSeconds ?? schedulerProxyAccountDispatchIntervalSeconds.value,
      );
      schedulerLimits.min = Number(res.data?.limits?.min || schedulerLimits.min);
      schedulerLimits.max = Number(res.data?.limits?.max || schedulerLimits.max);
      schedulerLimits.accountDispatchIntervalSecondsMin = Number(
        res.data?.limits?.accountDispatchIntervalSecondsMin ?? schedulerLimits.accountDispatchIntervalSecondsMin,
      );
      schedulerLimits.accountDispatchIntervalSecondsMax = Number(
        res.data?.limits?.accountDispatchIntervalSecondsMax ?? schedulerLimits.accountDispatchIntervalSecondsMax,
      );
      ElMessage.success('调度并发设置已保存');
    }
  } catch (error) {
    ElMessage.error(error.response?.data?.error || '保存调度并发设置失败');
  } finally {
    schedulerSettingsSaving.value = false;
  }
};

const syncProxySettings = (data = {}) => {
  const config = data?.config || {};
  const rollout = config.rollout || {};
  proxyForm.enabled = !!config.enabled;
  proxyForm.fallbackToDirect = config.fallbackToDirect !== false;
  proxyForm.maxRetries = Number(config.maxRetries || 3);
  proxyForm.rollout.strategy = ['whitelist', 'percentage', 'all', 'none'].includes(rollout.strategy)
    ? rollout.strategy
    : 'whitelist';
  proxyForm.rollout.whitelist = normalizeNameList(rollout.whitelist);
  proxyForm.rollout.percentage = Math.max(0, Math.min(100, Number(rollout.percentage || 0)));
  proxyForm.rollout.excludeList = normalizeNameList(rollout.excludeList);

  proxyAccountNameOptions.value = normalizeNameList(data.accountNames);
  proxyStats.value = data || null;
  Object.assign(proxyPoolStats, {
    total: Number(data?.poolStats?.total || 0),
    valid: Number(data?.poolStats?.valid || 0),
    assigned: Number(data?.poolStats?.assigned || 0),
    avgResponseTime: Number(data?.poolStats?.avgResponseTime || 0),
    warmup: data?.poolStats?.warmup || data?.warmup || null,
    sources: data?.poolStats?.sources || null,
  });
};

const fetchProxySettings = async () => {
  proxySettingsLoading.value = true;
  try {
    const res = await api.adminUsers.getProxySettings();
    if (res.success) {
      syncProxySettings(res.data || {});
    }
  } catch (error) {
    ElMessage.error(error.response?.data?.error || '获取代理发布策略失败');
  } finally {
    proxySettingsLoading.value = false;
  }
};

const buildProxySettingsPayload = () => ({
  enabled: proxyForm.enabled,
  fallbackToDirect: proxyForm.fallbackToDirect,
  maxRetries: Number(proxyForm.maxRetries || 3),
  rollout: {
    strategy: proxyForm.rollout.strategy,
    whitelist: normalizeNameList(proxyForm.rollout.whitelist),
    percentage: Number(proxyForm.rollout.percentage || 0),
    excludeList: normalizeNameList(proxyForm.rollout.excludeList),
  },
});

const saveProxySettings = async () => {
  const payload = buildProxySettingsPayload();
  if (payload.rollout.strategy === 'percentage' && (payload.rollout.percentage < 0 || payload.rollout.percentage > 100)) {
    ElMessage.warning('灰度比例需在 0-100 之间');
    return;
  }
  if (payload.rollout.strategy === 'whitelist' && payload.enabled && payload.rollout.whitelist.length === 0) {
    ElMessage.warning('白名单模式启用代理前，请先选择至少一个游戏账号名称');
    return;
  }

  proxySettingsSaving.value = true;
  try {
    const res = await api.adminUsers.saveProxySettings(payload);
    if (res.success) {
      syncProxySettings(res.data || {});
      ElMessage.success('代理发布策略已保存');
    }
  } catch (error) {
    ElMessage.error(error.response?.data?.error || '保存代理发布策略失败');
  } finally {
    proxySettingsSaving.value = false;
  }
};

const warmupProxyPool = async () => {
  proxyWarmupLoading.value = true;
  try {
    const res = await api.adminUsers.warmupProxyPool();
    if (res.success) {
      syncProxySettings(res.data || {});
      ElMessage.success(res.message || '代理池预热已启动，请稍后刷新查看可用数量');
      window.setTimeout(() => {
        void fetchProxySettings();
      }, 3000);
    }
  } catch (error) {
    ElMessage.error(error.response?.data?.error || '预热代理池失败');
  } finally {
    proxyWarmupLoading.value = false;
  }
};

const fetchTaskTypes = async () => {
  try {
    const res = await api.get('/tasks/types');
    if (res.success && Array.isArray(res.data)) {
      taskTypeNameMap.value = res.data.reduce((acc, item) => {
        const type = String(item?.type || '').trim();
        if (type) acc[type] = item?.name || type;
        return acc;
      }, {});
    }
  } catch (error) {
    console.error('获取任务类型失败:', error);
  }
};

const syncBroadcastForm = (broadcast = null) => {
  broadcastForm.title = broadcast?.title || '';
  broadcastForm.content = broadcast?.content || '';
};

const loadBroadcast = async () => {
  broadcastLoading.value = true;
  try {
    const res = await api.adminUsers.getBroadcast();
    if (res.success) {
      currentBroadcast.value = res.data || null;
      syncBroadcastForm(currentBroadcast.value);
    }
  } catch (error) {
    ElMessage.error(error.response?.data?.error || '获取公共通知失败');
  } finally {
    broadcastLoading.value = false;
  }
};

const saveBroadcast = async () => {
  const title = String(broadcastForm.title || '').trim();
  const content = String(broadcastForm.content || '').trim();
  if (!title || !content) {
    ElMessage.warning('请先填写标题和正文');
    return;
  }

  broadcastSaving.value = true;
  try {
    const res = await api.adminUsers.saveBroadcast({ title, content });
    if (res.success) {
      currentBroadcast.value = res.data || null;
      syncBroadcastForm(currentBroadcast.value);
      ElMessage.success('公共通知已发布');
    }
  } catch (error) {
    ElMessage.error(error.response?.data?.error || '保存公共通知失败');
  } finally {
    broadcastSaving.value = false;
  }
};

const clearBroadcast = async () => {
  if (!currentBroadcast.value && !broadcastForm.title && !broadcastForm.content) {
    return;
  }

  try {
    await ElMessageBox.confirm('确定要清空当前公共通知吗？', '提示', { type: 'warning' });
  } catch {
    return;
  }

  broadcastClearing.value = true;
  try {
    const res = await api.adminUsers.clearBroadcast();
    if (res.success) {
      currentBroadcast.value = null;
      syncBroadcastForm(null);
      ElMessage.success('公共通知已清空');
    }
  } catch (error) {
    ElMessage.error(error.response?.data?.error || '清空公共通知失败');
  } finally {
    broadcastClearing.value = false;
  }
};

const fetchUserAccounts = async (userId) => {
  logAccountsLoading.value = true;
  try {
    const res = await api.get(`/admin/users/${userId}/accounts`);
    if (res.success) {
      logAccounts.value = Array.isArray(res.data?.accounts) ? res.data.accounts : [];
      if (!selectedLogAccountId.value && logAccounts.value.length > 0) {
        selectedLogAccountId.value = logAccounts.value[0].id;
      } else if (
        selectedLogAccountId.value &&
        !logAccounts.value.some((account) => account.id === selectedLogAccountId.value)
      ) {
        selectedLogAccountId.value = logAccounts.value[0]?.id || null;
      }
    } else {
      logAccounts.value = [];
      selectedLogAccountId.value = null;
    }
  } catch (error) {
    logAccounts.value = [];
    selectedLogAccountId.value = null;
    ElMessage.error(error.response?.data?.error || '获取游戏账号失败');
  } finally {
    logAccountsLoading.value = false;
  }
};

const fetchUserLogs = async () => {
  if (!selectedLogUser.value?.id || !selectedLogAccountId.value) {
    userLogs.value = [];
    return;
  }

  logLoading.value = true;
  try {
    const res = await api.get(`/admin/users/${selectedLogUser.value.id}/logs`, {
      params: {
        accountId: selectedLogAccountId.value,
        limit: 30,
      },
    });
    if (res.success) {
      userLogs.value = Array.isArray(res.data?.logs) ? res.data.logs : [];
    } else {
      userLogs.value = [];
    }
  } catch (error) {
    userLogs.value = [];
    ElMessage.error(error.response?.data?.error || '获取日志失败');
  } finally {
    logLoading.value = false;
  }
};

const openLogDialog = async (row) => {
  selectedLogUser.value = row;
  logDialogVisible.value = true;
  selectedLogAccountId.value = null;
  logAccounts.value = [];
  userLogs.value = [];
  await fetchUserAccounts(row.id);
  await fetchUserLogs();
};

const handleLogAccountChange = () => {
  fetchUserLogs();
};

const refreshUserLogs = async () => {
  if (!selectedLogUser.value?.id) return;
  await fetchUserAccounts(selectedLogUser.value.id);
  await fetchUserLogs();
};

const openCreateDialog = () => {
  resetForm();
  dialogVisible.value = true;
};

const openEditDialog = (row) => {
  resetForm();
  isEditing.value = true;
  editingId.value = row.id;
  Object.assign(form, {
    username: row.username,
    password: '',
    role: row.role || 'user',
    is_enabled: !!row.is_enabled,
    limit_enabled: !!row.max_game_accounts,
    max_game_accounts: row.max_game_accounts || null,
    access_start_at: toPickerValue(row.access_start_at),
    access_end_at: toPickerValue(row.access_end_at)
  });
  dialogVisible.value = true;
};

const buildPayload = () => ({
  username: form.username.trim(),
  password: form.password,
  role: form.role,
  isEnabled: form.is_enabled,
  maxGameAccounts: form.limit_enabled ? (form.max_game_accounts || 5) : null,
  accessStartAt: form.access_start_at || null,
  accessEndAt: form.access_end_at || null
});

watch(
  () => form.limit_enabled,
  (enabled) => {
    if (enabled && !form.max_game_accounts) {
      form.max_game_accounts = 5;
    }
  }
);

const submitForm = async () => {
  if (!formRef.value) return;

  try {
    await formRef.value.validate();
    saving.value = true;

    const payload = buildPayload();
    if (isEditing.value && !payload.password) {
      delete payload.password;
    }

    const res = isEditing.value
      ? await api.put(`/admin/users/${editingId.value}`, payload)
      : await api.post('/admin/users', payload);

    if (res.success) {
      ElMessage.success(isEditing.value ? '用户更新成功' : '用户创建成功');
      dialogVisible.value = false;
      resetForm();
      if (isCurrentUser({ id: editingId.value })) {
        await authStore.fetchUser();
      }
      await fetchUsers();
    }
  } catch (error) {
    if (error !== false) {
      ElMessage.error(error.response?.data?.error || '保存失败');
    }
  } finally {
    saving.value = false;
  }
};

const quickToggle = async (row) => {
  try {
    const res = await api.put(`/admin/users/${row.id}`, {
      isEnabled: !row.is_enabled
    });
    if (res.success) {
      ElMessage.success(!row.is_enabled ? '用户已启用' : '用户已禁用');
      await fetchUsers();
    }
  } catch (error) {
    ElMessage.error(error.response?.data?.error || '操作失败');
  }
};

const deleteUser = async (row) => {
  try {
    await ElMessageBox.confirm(
      `确定删除用户「${row.username}」吗？该用户下的游戏账号和任务数据也会一并删除。`,
      '删除确认',
      { type: 'warning' }
    );
    const res = await api.delete(`/admin/users/${row.id}`);
    if (res.success) {
      ElMessage.success('删除成功');
      await fetchUsers();
    }
  } catch (error) {
    if (error !== 'cancel' && error !== 'close') {
      ElMessage.error(error.response?.data?.error || '删除失败');
    }
  }
};

onMounted(() => {
  fetchSchedulerSettings();
  fetchProxySettings();
  fetchTaskTypes();
  fetchUsers();
  loadBroadcast();
});
</script>

<style scoped>
.user-management-page {
  display: flex;
  flex-direction: column;
  gap: 18px;
}

.card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.management-card {
  :deep(.el-card__header) {
    border-bottom: 1px solid rgba(138, 151, 185, 0.14);
    padding-bottom: 14px;
  }
}

.header-subtitle {
  margin: 6px 0 0;
  font-size: 12px;
  line-height: 1.6;
  color: var(--text-tertiary);
}

.scheduler-settings-panel {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.broadcast-panel {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.proxy-settings-panel {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.proxy-status-tags {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.proxy-settings-form {
  padding: 18px;
  border-radius: 18px;
  border: 1px solid rgba(138, 151, 185, 0.14);
  background: linear-gradient(135deg, rgba(34, 197, 94, 0.08), rgba(59, 130, 246, 0.05));
}

.proxy-switch-row {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
}

.proxy-account-select {
  width: 100%;
}

.proxy-percentage-control {
  width: min(640px, 100%);
}

.proxy-stats-row {
  display: flex;
  flex-wrap: wrap;
  gap: 10px 16px;
  font-size: 12px;
  color: var(--text-secondary);
}

.proxy-actions {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
}

.broadcast-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  color: var(--text-secondary);
  font-size: 12px;
}

.broadcast-actions {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
}

.scheduler-setting-main {
  display: grid;
  grid-template-columns: repeat(4, minmax(140px, 1fr)) auto;
  align-items: end;
  gap: 16px;
  padding: 18px;
  border-radius: 18px;
  border: 1px solid rgba(138, 151, 185, 0.14);
  background: linear-gradient(135deg, rgba(91, 124, 255, 0.09), rgba(120, 210, 255, 0.06));
}

.scheduler-setting-field,
.scheduler-setting-copy {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.scheduler-setting-field :deep(.el-input-number) {
  width: 100%;
}

.scheduler-setting-title {
  font-size: 15px;
  font-weight: 600;
  color: var(--text-primary);
}

.scheduler-setting-desc {
  max-width: 520px;
  line-height: 1.6;
  color: var(--text-secondary);
}

.scheduler-setting-control {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-shrink: 0;
}

.scheduler-setting-tip {
  font-size: 12px;
  color: var(--text-tertiary);
}

.user-table {
  :deep(.el-button + .el-button) {
    margin-left: 2px;
  }
}

.time-window {
  line-height: 1.6;
  color: var(--text-secondary);
}

.form-tip {
  margin-top: 6px;
  line-height: 1.5;
  font-size: 12px;
  color: var(--text-tertiary);
}

.limit-setting {
  display: flex;
  align-items: center;
  gap: 8px;
}

.limit-setting-text {
  color: var(--text-secondary);
}

.log-filter-bar {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 16px;
  padding: 14px;
  border-radius: 18px;
  background: rgba(91, 124, 255, 0.05);
  border: 1px solid rgba(138, 151, 185, 0.14);
}

.log-filter-label {
  flex-shrink: 0;
  color: var(--text-secondary);
  font-weight: 600;
}

.log-account-select {
  flex: 1;
}

.account-summary {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 12px;
  color: var(--text-secondary);
}

.account-name {
  font-weight: 600;
  color: var(--text-primary);
}

.log-count {
  font-size: 12px;
  color: var(--text-tertiary);
}

.log-items {
  display: flex;
  flex-direction: column;
  gap: 12px;
  max-height: 60vh;
  overflow-y: auto;
}

.log-item {
  padding: 14px 16px;
  border: 1px solid rgba(138, 151, 185, 0.14);
  border-radius: 16px;
  background: rgba(255, 255, 255, 0.72);
  box-shadow: 0 8px 20px rgba(24, 39, 75, 0.06);
}

.log-item-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 8px;
}

.log-left,
.log-right {
  display: flex;
  align-items: center;
  gap: 8px;
}

.log-time {
  font-size: 12px;
  color: var(--text-tertiary);
}

.task-type {
  font-weight: 500;
  color: var(--text-secondary);
}

.log-message {
  line-height: 1.6;
  color: var(--text-primary);
  word-break: break-word;
}

:deep(.user-edit-dialog .el-dialog__body) {
  padding-top: 6px;
}

:deep(.user-edit-dialog .el-form-item__label) {
  color: var(--text-secondary);
  font-weight: 600;
}

@media (max-width: 768px) {
  .proxy-switch-row,
  .card-header,
  .account-summary,
  .log-item-header,
  .log-filter-bar {
    flex-direction: column;
    align-items: stretch;
  }

  .scheduler-setting-main {
    grid-template-columns: 1fr;
  }

  .scheduler-setting-control {
    width: 100%;
    flex-direction: column;
    align-items: stretch;
  }

  .scheduler-setting-control :deep(.el-input-number) {
    width: 100%;
  }

  .proxy-switch-row {
    display: flex;
  }

  .proxy-actions {
    flex-direction: column;
  }

  .log-left,
  .log-right {
    justify-content: space-between;
  }
}

:deep(.user-log-dialog .el-dialog__body) {
  padding-top: 10px;
}

@media (max-width: 768px) {
  .log-filter-bar,
  .account-summary,
  .log-item-header {
    flex-direction: column;
    align-items: stretch;
  }

  .card-header {
    align-items: stretch;
  }

  .limit-setting {
    flex-wrap: wrap;
  }
}

@media (max-width: 480px) {
  .log-item {
    padding: 12px 14px;
  }
}
</style>
