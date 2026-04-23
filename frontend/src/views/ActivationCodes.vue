<template>
  <div class="activation-codes-page">
    <el-card class="activation-card">
      <template #header>
        <div class="card-header">
          <div>
            <div class="header-title">激活码管理</div>
            <div class="header-subtitle">用于瘦身版安卓端启动授权，支持设备绑定、清绑和停用。</div>
          </div>
          <div class="header-actions">
            <el-button type="primary" @click="showGenerateDialog = true">生成激活码</el-button>
            <el-button @click="showBatchDialog = true">批量生成</el-button>
          </div>
        </div>
      </template>

      <el-table :data="activationCodes" v-loading="loading" stripe>
        <el-table-column prop="code" label="激活码" min-width="170" />
        <el-table-column label="绑定情况" width="120" align="center">
          <template #default="{ row }">
            {{ row.active_binding_count }} / {{ row.max_bindings }}
          </template>
        </el-table-column>
        <el-table-column label="剩余可绑" width="110" align="center">
          <template #default="{ row }">
            <el-tag :type="row.remainingBindings > 0 ? 'success' : 'info'">
              {{ row.remainingBindings }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="120" align="center">
          <template #default="{ row }">
            <el-tag v-if="!row.is_active" type="info">已禁用</el-tag>
            <el-tag v-else-if="row.isExpired" type="warning">已过期</el-tag>
            <el-tag v-else-if="row.remainingBindings <= 0" type="danger">已满额</el-tag>
            <el-tag v-else type="success">可用</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="remark" label="备注" min-width="180">
          <template #default="{ row }">
            {{ row.remark || '-' }}
          </template>
        </el-table-column>
        <el-table-column prop="created_by_name" label="创建者" width="120">
          <template #default="{ row }">
            {{ row.created_by_name || '-' }}
          </template>
        </el-table-column>
        <el-table-column label="创建时间" width="180">
          <template #default="{ row }">
            {{ formatTime(row.created_at) }}
          </template>
        </el-table-column>
        <el-table-column label="过期时间" width="180">
          <template #default="{ row }">
            {{ row.expires_at ? formatTime(row.expires_at) : '永久有效' }}
          </template>
        </el-table-column>
        <el-table-column label="操作" width="240" fixed="right">
          <template #default="{ row }">
            <el-button type="primary" link size="small" @click="copyCode(row.code)">复制</el-button>
            <el-button type="primary" link size="small" @click="openBindingsDialog(row)">绑定设备</el-button>
            <el-button
              :type="row.is_active ? 'warning' : 'success'"
              link
              size="small"
              @click="toggleCode(row)"
            >
              {{ row.is_active ? '禁用' : '启用' }}
            </el-button>
            <el-button type="danger" link size="small" @click="deleteCode(row)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <el-dialog v-model="showGenerateDialog" title="生成激活码" width="420px">
      <el-form :model="generateForm" label-width="110px">
        <el-form-item label="绑定次数上限">
          <el-input-number v-model="generateForm.maxBindings" :min="1" :max="1000" />
        </el-form-item>
        <el-form-item label="有效期">
          <el-select v-model="generateForm.expiresInDays" placeholder="选择有效期" style="width: 100%">
            <el-option :value="null" label="永久有效" />
            <el-option :value="1" label="1天" />
            <el-option :value="7" label="7天" />
            <el-option :value="30" label="30天" />
            <el-option :value="90" label="90天" />
            <el-option :value="365" label="365天" />
          </el-select>
        </el-form-item>
        <el-form-item label="备注">
          <el-input v-model="generateForm.remark" maxlength="100" show-word-limit placeholder="可选，便于区分用途" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showGenerateDialog = false">取消</el-button>
        <el-button type="primary" :loading="generating" @click="generateCode">生成</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="showBatchDialog" title="批量生成激活码" width="420px">
      <el-form :model="batchForm" label-width="110px">
        <el-form-item label="生成数量">
          <el-input-number v-model="batchForm.count" :min="1" :max="100" />
        </el-form-item>
        <el-form-item label="绑定次数上限">
          <el-input-number v-model="batchForm.maxBindings" :min="1" :max="1000" />
        </el-form-item>
        <el-form-item label="有效期">
          <el-select v-model="batchForm.expiresInDays" placeholder="选择有效期" style="width: 100%">
            <el-option :value="null" label="永久有效" />
            <el-option :value="1" label="1天" />
            <el-option :value="7" label="7天" />
            <el-option :value="30" label="30天" />
            <el-option :value="90" label="90天" />
            <el-option :value="365" label="365天" />
          </el-select>
        </el-form-item>
        <el-form-item label="备注前缀">
          <el-input v-model="batchForm.remarkPrefix" maxlength="80" show-word-limit placeholder="例如：4月安卓包-" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showBatchDialog = false">取消</el-button>
        <el-button type="primary" :loading="generating" @click="batchGenerate">批量生成</el-button>
      </template>
    </el-dialog>

    <el-dialog
      v-model="bindingsDialogVisible"
      :title="bindingsDialogTitle"
      width="min(960px, 100%)"
      destroy-on-close
    >
      <div class="bindings-summary" v-if="currentActivationCode">
        <div>激活码：<strong>{{ currentActivationCode.code }}</strong></div>
        <div>
          当前绑定：{{ currentActivationCode.active_binding_count }} / {{ currentActivationCode.max_bindings }}
        </div>
      </div>

      <el-table :data="bindings" v-loading="bindingsLoading" stripe>
        <el-table-column prop="device_fingerprint" label="设备指纹" min-width="240" />
        <el-table-column prop="device_name" label="设备信息" min-width="180">
          <template #default="{ row }">
            {{ row.device_name || '-' }}
          </template>
        </el-table-column>
        <el-table-column prop="app_version" label="App版本" width="120">
          <template #default="{ row }">
            {{ row.app_version || '-' }}
          </template>
        </el-table-column>
        <el-table-column label="首次激活" width="180">
          <template #default="{ row }">
            {{ formatTime(row.activated_at) }}
          </template>
        </el-table-column>
        <el-table-column label="最近校验" width="180">
          <template #default="{ row }">
            {{ formatTime(row.last_check_at) }}
          </template>
        </el-table-column>
        <el-table-column label="状态" width="120" align="center">
          <template #default="{ row }">
            <el-tag :type="row.is_active ? 'success' : 'info'">
              {{ row.is_active ? '有效' : '已清绑' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="清绑信息" min-width="200">
          <template #default="{ row }">
            <div v-if="row.is_active">-</div>
            <div v-else>
              <div>{{ formatTime(row.unbound_at) }}</div>
              <div class="muted">{{ row.unbind_reason || row.unbound_by_name || '管理员清绑' }}</div>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="100" fixed="right">
          <template #default="{ row }">
            <el-button
              v-if="row.is_active"
              type="danger"
              link
              size="small"
              @click="unbindDevice(row)"
            >
              清绑
            </el-button>
            <span v-else class="muted">-</span>
          </template>
        </el-table-column>
      </el-table>
    </el-dialog>
  </div>
</template>

<script setup>
import { onMounted, reactive, ref, computed } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import api from '@/api';

const loading = ref(false);
const generating = ref(false);
const bindingsLoading = ref(false);
const activationCodes = ref([]);
const bindings = ref([]);
const currentActivationCode = ref(null);
const showGenerateDialog = ref(false);
const showBatchDialog = ref(false);
const bindingsDialogVisible = ref(false);

const generateForm = reactive({
  maxBindings: 1,
  expiresInDays: null,
  remark: '',
});

const batchForm = reactive({
  count: 10,
  maxBindings: 1,
  expiresInDays: null,
  remarkPrefix: '',
});

const bindingsDialogTitle = computed(() => {
  if (!currentActivationCode.value) {
    return '绑定设备';
  }
  return `绑定设备 - ${currentActivationCode.value.code}`;
});

const formatTime = (timestamp) => {
  if (!timestamp) return '-';
  const text = String(timestamp);
  const normalized = text.includes('T') ? text : text.replace(' ', 'T');
  const date = /\d{4}-\d{2}-\d{2}T/.test(normalized)
    ? new Date(normalized.endsWith('Z') ? normalized : `${normalized}Z`)
    : new Date(Number(normalized));
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleString('zh-CN');
};

const resetGenerateForm = () => {
  generateForm.maxBindings = 1;
  generateForm.expiresInDays = null;
  generateForm.remark = '';
};

const resetBatchForm = () => {
  batchForm.count = 10;
  batchForm.maxBindings = 1;
  batchForm.expiresInDays = null;
  batchForm.remarkPrefix = '';
};

const fetchActivationCodes = async () => {
  loading.value = true;
  try {
    const res = await api.get('/activation-codes/list');
    if (res.success) {
      activationCodes.value = res.data;
    }
  } finally {
    loading.value = false;
  }
};

const fetchBindings = async (activationCodeId) => {
  bindingsLoading.value = true;
  try {
    const res = await api.get(`/activation-codes/${activationCodeId}/bindings`);
    if (res.success) {
      bindings.value = res.data.bindings || [];
    }
  } finally {
    bindingsLoading.value = false;
  }
};

const generateCode = async () => {
  generating.value = true;
  try {
    const res = await api.post('/activation-codes/generate', generateForm);
    if (res.success) {
      ElMessage.success(`激活码 ${res.data.code} 生成成功`);
      showGenerateDialog.value = false;
      resetGenerateForm();
      await fetchActivationCodes();
    }
  } catch (error) {
    ElMessage.error(error.message || error.response?.data?.error || '生成失败');
  } finally {
    generating.value = false;
  }
};

const batchGenerate = async () => {
  generating.value = true;
  try {
    const res = await api.post('/activation-codes/batch-generate', batchForm);
    if (res.success) {
      ElMessage.success(`成功生成 ${res.data.length} 个激活码`);
      showBatchDialog.value = false;
      resetBatchForm();
      await fetchActivationCodes();
    }
  } catch (error) {
    ElMessage.error(error.message || error.response?.data?.error || '批量生成失败');
  } finally {
    generating.value = false;
  }
};

const copyCode = async (code) => {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(code);
    } else {
      const textArea = document.createElement('textarea');
      textArea.value = code;
      textArea.setAttribute('readonly', 'readonly');
      textArea.style.position = 'fixed';
      textArea.style.opacity = '0';
      document.body.appendChild(textArea);
      textArea.select();
      document.execCommand('copy');
      document.body.removeChild(textArea);
    }
    ElMessage.success('激活码已复制到剪贴板');
  } catch {
    ElMessage.error('复制失败');
  }
};

const openBindingsDialog = async (row) => {
  currentActivationCode.value = row;
  bindingsDialogVisible.value = true;
  await fetchBindings(row.id);
};

const toggleCode = async (row) => {
  try {
    const res = await api.put(`/activation-codes/${row.id}/toggle`);
    if (res.success) {
      ElMessage.success(res.message);
      await fetchActivationCodes();
      if (currentActivationCode.value?.id === row.id) {
        currentActivationCode.value = activationCodes.value.find((item) => item.id === row.id) || row;
      }
    }
  } catch (error) {
    ElMessage.error(error.message || error.response?.data?.error || '操作失败');
  }
};

const deleteCode = async (row) => {
  try {
    await ElMessageBox.confirm(
      '删除后该激活码及其绑定记录都会失效，确定继续吗？',
      '删除激活码',
      { type: 'warning' },
    );
    const res = await api.delete(`/activation-codes/${row.id}`);
    if (res.success) {
      ElMessage.success('删除成功');
      if (currentActivationCode.value?.id === row.id) {
        bindingsDialogVisible.value = false;
        currentActivationCode.value = null;
        bindings.value = [];
      }
      await fetchActivationCodes();
    }
  } catch (error) {
    if (error !== 'cancel' && error !== 'close') {
      ElMessage.error(error.message || error.response?.data?.error || '删除失败');
    }
  }
};

const unbindDevice = async (binding) => {
  if (!currentActivationCode.value) return;

  try {
    const { value } = await ElMessageBox.prompt(
      '可选填写清绑原因，留空则按默认原因记录。',
      '清绑设备',
      {
        inputPlaceholder: '例如：用户换机',
        confirmButtonText: '确认清绑',
        cancelButtonText: '取消',
      },
    );

    const res = await api.post(
      `/activation-codes/${currentActivationCode.value.id}/unbind/${binding.id}`,
      { reason: value || '' },
    );
    if (res.success) {
      ElMessage.success('设备已清绑');
      await Promise.all([
        fetchBindings(currentActivationCode.value.id),
        fetchActivationCodes(),
      ]);
      currentActivationCode.value = activationCodes.value.find((item) => item.id === currentActivationCode.value.id) || currentActivationCode.value;
    }
  } catch (error) {
    if (error !== 'cancel' && error !== 'close') {
      ElMessage.error(error.message || error.response?.data?.error || '清绑失败');
    }
  }
};

onMounted(() => {
  fetchActivationCodes();
});
</script>

<style scoped>
.activation-codes-page {
  padding: 20px;
}

.activation-card {
  border-radius: 20px;
}

.card-header {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  align-items: center;
}

.header-title {
  font-size: 18px;
  font-weight: 700;
}

.header-subtitle {
  margin-top: 6px;
  color: #7b8190;
  font-size: 13px;
}

.header-actions {
  display: flex;
  gap: 10px;
}

.bindings-summary {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 16px;
  padding: 12px 14px;
  border-radius: 14px;
  background: #f6f8fc;
  color: #374151;
}

.muted {
  color: #909399;
  font-size: 12px;
}

@media (max-width: 768px) {
  .activation-codes-page {
    padding: 12px;
  }

  .card-header,
  .bindings-summary {
    flex-direction: column;
    align-items: flex-start;
  }

  .header-actions {
    width: 100%;
  }
}
</style>
