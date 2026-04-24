<template>
  <div class="user-management-page">
    <el-card class="management-card scheduler-settings-card">
      <template #header>
        <div class="card-header">
          <div>
            <span>调度并发设置</span>
            <p class="header-subtitle">定时任务会按游戏账号批次执行，当前账号批次跑完后自动断开连接。</p>
          </div>
        </div>
      </template>

      <div class="scheduler-settings-panel" v-loading="schedulerSettingsLoading">
        <div class="scheduler-setting-main">
          <div class="scheduler-setting-copy">
            <div class="scheduler-setting-title">并发账号数</div>
            <div class="scheduler-setting-desc">
              同时最多跑多少个游戏账号。建议从较小数值开始逐步压测。
            </div>
          </div>
          <div class="scheduler-setting-control">
            <el-input-number
              v-model="schedulerMaxConcurrentAccounts"
              :min="schedulerLimits.min"
              :max="schedulerLimits.max"
              controls-position="right"
            />
            <el-button type="primary" :loading="schedulerSettingsSaving" @click="saveSchedulerSettings">
              保存
            </el-button>
          </div>
        </div>
        <div class="scheduler-setting-tip">
          当前可配置范围：{{ schedulerLimits.min }} - {{ schedulerLimits.max }}，默认值：3。
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
const schedulerLimits = reactive({
  min: 1,
  max: 20,
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

const form = reactive(createEmptyForm());
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
      schedulerLimits.min = Number(res.data?.limits?.min || 1);
      schedulerLimits.max = Number(res.data?.limits?.max || 20);
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
    });
    if (res.success) {
      schedulerMaxConcurrentAccounts.value = Number(res.data?.maxConcurrentAccounts || schedulerMaxConcurrentAccounts.value);
      schedulerLimits.min = Number(res.data?.limits?.min || schedulerLimits.min);
      schedulerLimits.max = Number(res.data?.limits?.max || schedulerLimits.max);
      ElMessage.success('调度并发设置已保存');
    }
  } catch (error) {
    ElMessage.error(error.response?.data?.error || '保存调度并发设置失败');
  } finally {
    schedulerSettingsSaving.value = false;
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
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 18px;
  border-radius: 18px;
  border: 1px solid rgba(138, 151, 185, 0.14);
  background: linear-gradient(135deg, rgba(91, 124, 255, 0.09), rgba(120, 210, 255, 0.06));
}

.scheduler-setting-copy {
  display: flex;
  flex-direction: column;
  gap: 6px;
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
  .scheduler-setting-main,
  .card-header,
  .account-summary,
  .log-item-header,
  .log-filter-bar {
    flex-direction: column;
    align-items: stretch;
  }

  .scheduler-setting-control {
    width: 100%;
    flex-direction: column;
    align-items: stretch;
  }

  .scheduler-setting-control :deep(.el-input-number) {
    width: 100%;
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
