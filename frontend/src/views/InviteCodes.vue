<template>
  <div class="invite-codes-page">
    <el-card>
      <template #header>
        <div class="card-header">
          <span>邀请码管理</span>
          <div class="header-actions">
            <el-button type="primary" @click="showGenerateDialog = true">
              生成邀请码
            </el-button>
            <el-button @click="showBatchDialog = true">
              批量生成
            </el-button>
          </div>
        </div>
      </template>

      <el-table :data="inviteCodes" v-loading="loading" stripe>
        <el-table-column prop="code" label="邀请码" width="120" />
        <el-table-column label="使用情况" width="120">
          <template #default="{ row }">
            {{ row.used_count }} / {{ row.max_uses }}
          </template>
        </el-table-column>
        <el-table-column label="剩余次数" width="100">
          <template #default="{ row }">
            <el-tag :type="row.remainingUses > 0 ? 'success' : 'info'">
              {{ row.remainingUses }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="100">
          <template #default="{ row }">
            <el-tag v-if="!row.is_active" type="info">已禁用</el-tag>
            <el-tag v-else-if="row.isExpired" type="warning">已过期</el-tag>
            <el-tag v-else-if="row.used_count >= row.max_uses" type="danger">已用完</el-tag>
            <el-tag v-else type="success">可用</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="created_by_name" label="创建者" width="100" />
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
        <el-table-column label="操作" width="150" fixed="right">
          <template #default="{ row }">
            <el-button 
              type="primary" 
              link 
              size="small"
              @click="copyCode(row.code)"
            >
              复制
            </el-button>
            <el-button 
              :type="row.is_active ? 'warning' : 'success'" 
              link 
              size="small"
              @click="toggleCode(row)"
            >
              {{ row.is_active ? '禁用' : '启用' }}
            </el-button>
            <el-button 
              type="danger" 
              link 
              size="small"
              @click="deleteCode(row)"
            >
              删除
            </el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <el-dialog v-model="showGenerateDialog" title="生成邀请码" width="400px">
      <el-form :model="generateForm" label-width="100px">
        <el-form-item label="使用次数">
          <el-input-number v-model="generateForm.maxUses" :min="1" :max="1000" />
        </el-form-item>
        <el-form-item label="有效期">
          <el-select v-model="generateForm.expiresInDays" placeholder="选择有效期" style="width: 100%">
            <el-option :value="null" label="永久有效" />
            <el-option :value="1" label="1天" />
            <el-option :value="7" label="7天" />
            <el-option :value="30" label="30天" />
            <el-option :value="90" label="90天" />
          </el-select>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showGenerateDialog = false">取消</el-button>
        <el-button type="primary" @click="generateCode" :loading="generating">生成</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="showBatchDialog" title="批量生成邀请码" width="400px">
      <el-form :model="batchForm" label-width="100px">
        <el-form-item label="生成数量">
          <el-input-number v-model="batchForm.count" :min="1" :max="100" />
        </el-form-item>
        <el-form-item label="使用次数">
          <el-input-number v-model="batchForm.maxUses" :min="1" :max="1000" />
        </el-form-item>
        <el-form-item label="有效期">
          <el-select v-model="batchForm.expiresInDays" placeholder="选择有效期" style="width: 100%">
            <el-option :value="null" label="永久有效" />
            <el-option :value="1" label="1天" />
            <el-option :value="7" label="7天" />
            <el-option :value="30" label="30天" />
            <el-option :value="90" label="90天" />
          </el-select>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showBatchDialog = false">取消</el-button>
        <el-button type="primary" @click="batchGenerate" :loading="generating">批量生成</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import api from '@/api';

const loading = ref(false);
const generating = ref(false);
const inviteCodes = ref([]);
const showGenerateDialog = ref(false);
const showBatchDialog = ref(false);

const generateForm = reactive({
  maxUses: 1,
  expiresInDays: null
});

const batchForm = reactive({
  count: 10,
  maxUses: 1,
  expiresInDays: null
});

const formatTime = (timestamp) => {
  if (!timestamp) return '-';
  const text = String(timestamp);
  let date;
  if (/^\d+$/.test(text)) {
    date = new Date(Number(text));
  } else {
    const normalized = text.includes('T') ? text : text.replace(' ', 'T');
    date = new Date(`${normalized}Z`);
  }
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleString('zh-CN');
};

const fetchInviteCodes = async () => {
  loading.value = true;
  try {
    const res = await api.get('/invite-codes/list');
    if (res.success) {
      inviteCodes.value = res.data;
    }
  } catch (error) {
    ElMessage.error('获取邀请码列表失败');
  } finally {
    loading.value = false;
  }
};

const generateCode = async () => {
  generating.value = true;
  try {
    const res = await api.post('/invite-codes/generate', generateForm);
    if (res.success) {
      ElMessage.success(`邀请码 ${res.data.code} 生成成功`);
      showGenerateDialog.value = false;
      fetchInviteCodes();
    }
  } catch (error) {
    ElMessage.error(error.response?.data?.error || '生成失败');
  } finally {
    generating.value = false;
  }
};

const batchGenerate = async () => {
  generating.value = true;
  try {
    const res = await api.post('/invite-codes/batch-generate', batchForm);
    if (res.success) {
      ElMessage.success(`成功生成 ${res.data.length} 个邀请码`);
      showBatchDialog.value = false;
      fetchInviteCodes();
    }
  } catch (error) {
    ElMessage.error(error.response?.data?.error || '批量生成失败');
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
      textArea.style.pointerEvents = 'none';
      document.body.appendChild(textArea);
      textArea.focus();
      textArea.select();
      textArea.setSelectionRange(0, textArea.value.length);
      const copied = document.execCommand('copy');
      document.body.removeChild(textArea);
      if (!copied) {
        throw new Error('execCommand copy failed');
      }
    }
    ElMessage.success('邀请码已复制到剪贴板');
  } catch {
    ElMessage.error('复制失败');
  }
};

const toggleCode = async (row) => {
  try {
    const res = await api.put(`/invite-codes/${row.id}/toggle`);
    if (res.success) {
      ElMessage.success(res.message);
      fetchInviteCodes();
    }
  } catch (error) {
    ElMessage.error(error.response?.data?.error || '操作失败');
  }
};

const deleteCode = async (row) => {
  try {
    await ElMessageBox.confirm('确定要删除该邀请码吗？', '提示', { type: 'warning' });
    const res = await api.delete(`/invite-codes/${row.id}`);
    if (res.success) {
      ElMessage.success('删除成功');
      fetchInviteCodes();
    }
  } catch (error) {
    if (error !== 'cancel') {
      ElMessage.error(error.response?.data?.error || '删除失败');
    }
  }
};

onMounted(() => {
  fetchInviteCodes();
});
</script>

<style scoped>
.invite-codes-page {
  padding: 20px;
}

.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.header-actions {
  display: flex;
  gap: 10px;
}
</style>
