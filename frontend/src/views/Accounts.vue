<template>
  <div class="accounts-page">
    <el-card>
      <template #header>
        <div class="card-header">
          <span>账号管理</span>
          <el-button type="primary" @click="showAddDialog = true">
            <el-icon><Plus /></el-icon>
            添加账号
          </el-button>
        </div>
      </template>
      
      <el-table :data="accountStore.accounts" v-loading="accountStore.loading" stripe>
        <el-table-column prop="name" label="账号名称" width="150" />
        <el-table-column prop="server" label="服务器" width="120" />
        <el-table-column prop="remark" label="备注" show-overflow-tooltip />
        <el-table-column prop="status" label="状态" width="100">
          <template #default="{ row }">
            <el-tag :type="row.status === 'active' ? 'success' : 'danger'" size="small">
              {{ row.status === 'active' ? '正常' : '禁用' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="created_at" label="创建时间" width="180">
          <template #default="{ row }">
            {{ formatTime(row.created_at) }}
          </template>
        </el-table-column>
        <el-table-column label="操作" width="200" fixed="right">
          <template #default="{ row }">
            <el-button text type="primary" @click="handleEdit(row)">编辑</el-button>
            <el-button text type="primary" @click="handleViewToken(row)">查看Token</el-button>
            <el-button text type="danger" @click="handleDelete(row)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-card>
    
    <el-dialog v-model="showAddDialog" :title="editingAccount ? '编辑账号' : '添加账号'" width="500px">
      <el-form ref="formRef" :model="form" :rules="rules" label-width="80px">
        <el-form-item label="名称" prop="name">
          <el-input v-model="form.name" placeholder="请输入账号名称" />
        </el-form-item>
        <el-form-item label="Token" prop="token" v-if="!editingAccount">
          <el-input
            v-model="form.token"
            type="textarea"
            :rows="3"
            placeholder="请输入游戏Token"
          />
        </el-form-item>
        <el-form-item label="服务器" prop="server">
          <el-input v-model="form.server" placeholder="服务器名称（可选）" />
        </el-form-item>
        <el-form-item label="备注" prop="remark">
          <el-input v-model="form.remark" type="textarea" :rows="2" placeholder="备注信息（可选）" />
        </el-form-item>
        <el-form-item label="状态" prop="status" v-if="editingAccount">
          <el-select v-model="form.status">
            <el-option label="正常" value="active" />
            <el-option label="禁用" value="disabled" />
          </el-select>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showAddDialog = false">取消</el-button>
        <el-button type="primary" :loading="submitting" @click="handleSubmit">确定</el-button>
      </template>
    </el-dialog>
    
    <el-dialog v-model="showTokenDialog" title="Token信息" width="500px">
      <el-input
        v-model="currentToken"
        type="textarea"
        :rows="5"
        readonly
      />
      <template #footer>
        <el-button type="primary" @click="copyToken">复制</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { Plus } from '@element-plus/icons-vue';
import { useAccountStore } from '@stores/account';

const accountStore = useAccountStore();

const showAddDialog = ref(false);
const showTokenDialog = ref(false);
const submitting = ref(false);
const editingAccount = ref(null);
const currentToken = ref('');

const formRef = ref();
const form = reactive({
  name: '',
  token: '',
  server: '',
  remark: '',
  status: 'active'
});

const rules = {
  name: [
    { required: true, message: '请输入账号名称', trigger: 'blur' }
  ],
  token: [
    { required: true, message: '请输入Token', trigger: 'blur' }
  ]
};

const formatTime = (time) => {
  return new Date(time).toLocaleString('zh-CN');
};

const resetForm = () => {
  form.name = '';
  form.token = '';
  form.server = '';
  form.remark = '';
  form.status = 'active';
  editingAccount.value = null;
};

const handleEdit = (account) => {
  editingAccount.value = account;
  form.name = account.name;
  form.server = account.server || '';
  form.remark = account.remark || '';
  form.status = account.status;
  showAddDialog.value = true;
};

const handleSubmit = async () => {
  if (!formRef.value) return;
  
  try {
    await formRef.value.validate();
    submitting.value = true;
    
    if (editingAccount.value) {
      await accountStore.updateAccount(editingAccount.value.id, {
        name: form.name,
        server: form.server,
        remark: form.remark,
        status: form.status
      });
      ElMessage.success('更新成功');
    } else {
      await accountStore.addAccount({
        name: form.name,
        token: form.token,
        server: form.server,
        remark: form.remark
      });
      ElMessage.success('添加成功');
    }
    
    showAddDialog.value = false;
    resetForm();
  } catch (error) {
    if (error !== false) {
      ElMessage.error(error.response?.data?.error || '操作失败');
    }
  } finally {
    submitting.value = false;
  }
};

const handleViewToken = async (account) => {
  try {
    const res = await accountStore.getToken(account.id);
    if (res.success) {
      currentToken.value = res.data.token;
      showTokenDialog.value = true;
    }
  } catch (error) {
    ElMessage.error('获取Token失败');
  }
};

const copyToken = async () => {
  try {
    await navigator.clipboard.writeText(currentToken.value);
    ElMessage.success('已复制到剪贴板');
  } catch {
    ElMessage.error('复制失败');
  }
};

const handleDelete = async (account) => {
  try {
    await ElMessageBox.confirm(`确定要删除账号 "${account.name}" 吗？`, '提示', {
      type: 'warning'
    });
    
    await accountStore.deleteAccount(account.id);
    ElMessage.success('删除成功');
  } catch (error) {
    if (error !== 'cancel') {
      ElMessage.error('删除失败');
    }
  }
};

onMounted(() => {
  accountStore.fetchAccounts();
});
</script>

<style lang="scss" scoped>
.accounts-page {
  .card-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
}
</style>
