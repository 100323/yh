<template>
  <div class="tokens-page">
    <div style="background: lightgreen; padding: 20px;">
      <h2>Tokens页面已加载!</h2>
      <p>tokens数量: {{ tokens.length }}</p>
      <el-button type="primary" @click="testClick">测试按钮</el-button>
    </div>
    
    <el-card>
      <template #header>
        <div class="card-header">
          <span>账号管理</span>
          <el-button type="primary" @click="showAddDialog = true">
            添加账号
          </el-button>
        </div>
      </template>

      <el-empty v-if="tokens.length === 0" description="暂无Token数据" />
      
      <el-table v-else :data="tokens" stripe>
        <el-table-column prop="name" label="名称" />
        <el-table-column prop="server" label="服务器" />
        <el-table-column prop="created_at" label="创建时间" />
      </el-table>
    </el-card>

    <el-dialog v-model="showAddDialog" title="添加Token" width="500px">
      <el-form :model="form" label-width="80px">
        <el-form-item label="名称">
          <el-input v-model="form.name" placeholder="请输入名称" />
        </el-form-item>
        <el-form-item label="Token">
          <el-input v-model="form.token" type="textarea" :rows="3" placeholder="请输入Token" />
        </el-form-item>
        <el-form-item label="服务器">
          <el-input v-model="form.server" placeholder="服务器名称（可选）" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showAddDialog = false">取消</el-button>
        <el-button type="primary" :loading="submitting" @click="handleSubmit">确定</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted } from 'vue';
import { ElMessage } from 'element-plus';
import api from '@/api';

console.log('Tokens.vue 开始加载');

const tokens = ref([]);
const showAddDialog = ref(false);
const submitting = ref(false);

const form = reactive({
  name: '',
  token: '',
  server: ''
});

const testClick = () => {
  console.log('测试按钮被点击');
  ElMessage.success('按钮点击成功！');
};

const fetchTokens = async () => {
  console.log('开始获取Tokens...');
  try {
    const response = await api.get('/accounts');
    console.log('Tokens响应:', response);
    if (response.success) {
      tokens.value = response.data;
    }
  } catch (error) {
    console.error('获取Tokens失败:', error);
  }
};

const handleSubmit = async () => {
  if (!form.name || !form.token) {
    ElMessage.error('请填写名称和Token');
    return;
  }
  
  submitting.value = true;
  try {
    const response = await api.post('/accounts', {
      name: form.name,
      token: form.token,
      server: form.server
    });
    
    if (response.success) {
      ElMessage.success('添加成功');
      showAddDialog.value = false;
      form.name = '';
      form.token = '';
      form.server = '';
      fetchTokens();
    }
  } catch (error) {
    console.error('添加失败:', error);
    ElMessage.error('添加失败');
  } finally {
    submitting.value = false;
  }
};

onMounted(() => {
  console.log('Tokens.vue onMounted');
  fetchTokens();
});
</script>

<style scoped>
.tokens-page {
  padding: 20px;
}
.tokens-page::before {
  content: '遗留调试页：主账号管理请使用 /tokens（TokenImport）主流程';
  display: block;
  margin-bottom: 12px;
  color: #e6a23c;
}
.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
</style>
