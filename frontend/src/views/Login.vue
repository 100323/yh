<template>
  <div class="login-container">
    <div class="login-card">
      <div class="login-header">
        <img src="/icons/tom_king.jpg" alt="汤姆之王" class="logo">
        <h1>汤姆之王</h1>
      </div>
      
      <el-tabs v-model="activeTab" class="login-tabs">
        <el-tab-pane label="登录" name="login">
          <el-form ref="loginFormRef" :model="loginForm" :rules="rules" @submit.prevent="handleLogin">
            <el-form-item prop="username">
              <el-input
                v-model="loginForm.username"
                placeholder="用户名"
                :prefix-icon="User"
                size="large"
              />
            </el-form-item>
            
            <el-form-item prop="password">
              <el-input
                v-model="loginForm.password"
                type="password"
                placeholder="密码"
                :prefix-icon="Lock"
                size="large"
                show-password
              />
            </el-form-item>
            
            <el-form-item>
              <el-button
                type="primary"
                size="large"
                :loading="loginLoading"
                class="login-btn"
                @click="handleLogin"
              >
                登录
              </el-button>
            </el-form-item>
          </el-form>
        </el-tab-pane>
        
        <el-tab-pane label="注册" name="register">
          <el-form ref="registerFormRef" :model="registerForm" :rules="rules" @submit.prevent="handleRegister">
            <el-form-item prop="username">
              <el-input
                v-model="registerForm.username"
                placeholder="用户名"
                :prefix-icon="User"
                size="large"
              />
            </el-form-item>
            
            <el-form-item prop="password">
              <el-input
                v-model="registerForm.password"
                type="password"
                placeholder="密码"
                :prefix-icon="Lock"
                size="large"
                show-password
              />
            </el-form-item>
            
            <el-form-item prop="confirmPassword">
              <el-input
                v-model="registerForm.confirmPassword"
                type="password"
                placeholder="确认密码"
                :prefix-icon="Lock"
                size="large"
                show-password
              />
            </el-form-item>
            
            <el-form-item prop="inviteCode">
              <el-input
                v-model="registerForm.inviteCode"
                placeholder="邀请码"
                :prefix-icon="Ticket"
                size="large"
              />
            </el-form-item>
            
            <el-form-item>
              <el-button
                type="primary"
                size="large"
                :loading="registerLoading"
                class="login-btn"
                @click="handleRegister"
              >
                注册
              </el-button>
            </el-form-item>
          </el-form>
        </el-tab-pane>
      </el-tabs>
    </div>
  </div>
</template>

<script setup>
import { ref, reactive } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import { ElMessage } from 'element-plus';
import { Lock, Ticket, User } from '@element-plus/icons-vue';
import { useAuthStore } from '@stores/auth';

const router = useRouter();
const route = useRoute();
const authStore = useAuthStore();

const activeTab = ref('login');
const loginLoading = ref(false);
const registerLoading = ref(false);

const loginFormRef = ref();
const registerFormRef = ref();

const loginForm = reactive({
  username: '',
  password: ''
});

const registerForm = reactive({
  username: '',
  password: '',
  confirmPassword: '',
  inviteCode: ''
});

const rules = {
  username: [
    { required: true, message: '请输入用户名', trigger: 'blur' },
    { min: 3, max: 20, message: '用户名长度3-20个字符', trigger: 'blur' }
  ],
  password: [
    { required: true, message: '请输入密码', trigger: 'blur' },
    { min: 6, message: '密码至少6个字符', trigger: 'blur' }
  ],
  confirmPassword: [
    { required: true, message: '请确认密码', trigger: 'blur' },
    {
      validator: (rule, value, callback) => {
        if (value !== registerForm.password) {
          callback(new Error('两次输入的密码不一致'));
        } else {
          callback();
        }
      },
      trigger: 'blur'
    }
  ],
  inviteCode: [
    { required: true, message: '请输入邀请码', trigger: 'blur' }
  ]
};

const handleLogin = async () => {
  if (!loginFormRef.value) return;
  
  try {
    await loginFormRef.value.validate();
    loginLoading.value = true;
    
    await authStore.login(loginForm.username, loginForm.password);
    
    ElMessage.success('登录成功');
    
    const redirect = route.query.redirect || '/';
    router.push(redirect);
  } catch (error) {
    if (error !== false) {
      ElMessage.error(error.response?.data?.error || '登录失败');
    }
  } finally {
    loginLoading.value = false;
  }
};

const handleRegister = async () => {
  if (!registerFormRef.value) return;
  
  try {
    await registerFormRef.value.validate();
    registerLoading.value = true;
    
    await authStore.register(registerForm.username, registerForm.password, registerForm.inviteCode);
    
    ElMessage.success('注册成功');
    router.push('/');
  } catch (error) {
    if (error !== false) {
      ElMessage.error(error.response?.data?.error || '注册失败');
    }
  } finally {
    registerLoading.value = false;
  }
};
</script>

<style lang="scss" scoped>
.login-container {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background:
    radial-gradient(circle at 15% 20%, rgba(91, 124, 255, 0.3), transparent 28%),
    radial-gradient(circle at 82% 18%, rgba(124, 92, 255, 0.28), transparent 24%),
    linear-gradient(135deg, #eff3ff 0%, #f5f6ff 40%, #eef2fb 100%);
}

.login-card {
  width: min(100%, 440px);
  padding: 32px;
  background: rgba(255, 255, 255, 0.82);
  border: 1px solid rgba(138, 151, 185, 0.18);
  border-radius: 28px;
  box-shadow: 0 30px 70px rgba(29, 47, 92, 0.18);
  backdrop-filter: blur(18px);
  -webkit-backdrop-filter: blur(18px);
}

.login-header {
  text-align: center;
  margin-bottom: 26px;
  
  .logo {
    width: 72px;
    height: 72px;
    margin-bottom: 18px;
    border-radius: 20px;
    box-shadow: 0 16px 32px rgba(91, 124, 255, 0.2);
  }
  
  h1 {
    margin: 0;
    font-size: 28px;
    font-weight: 700;
    color: var(--text-primary);
    letter-spacing: 0.02em;
  }
}

.login-tabs {
  :deep(.el-tabs__header) {
    margin-bottom: 26px;
  }
  
  :deep(.el-tabs__nav-wrap::after) {
    display: none;
  }

  :deep(.el-tabs__nav-wrap) {
    display: flex;
    justify-content: center;
  }
  
  :deep(.el-tabs__nav-scroll) {
    display: flex;
    justify-content: center;
    width: 100%;
  }

  :deep(.el-tabs__nav) {
    padding: 4px;
    background: rgba(91, 124, 255, 0.08);
    border-radius: 999px;
    width: min(220px, 100%);
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 4px;
    box-shadow: inset 0 0 0 1px rgba(91, 124, 255, 0.08);
  }

  :deep(.el-tabs__item) {
    font-size: 15px;
    height: 42px;
    padding: 0 14px;
    border-radius: 999px;
    color: var(--text-secondary);
    justify-content: center;
    transition: all 0.2s ease;
    font-weight: 600;
  }
  
  :deep(.el-tabs__active-bar) {
    display: none;
  }

  :deep(.el-tabs__item.is-active) {
    color: #fff;
    background: linear-gradient(135deg, var(--primary-color), var(--secondary-color));
    box-shadow: 0 10px 22px rgba(91, 124, 255, 0.24);
  }

  :deep(.el-form-item) {
    margin-bottom: 18px;
  }

  :deep(.el-input__wrapper) {
    min-height: 48px;
    border-radius: 16px;
    background: rgba(255, 255, 255, 0.84);
  }
}

.login-btn {
  width: 100%;
  height: 48px;
  font-size: 16px;
  margin-top: 8px;
}

@media (max-width: 768px) {
  .login-container {
    padding: 16px;
  }

  .login-card {
    padding: 26px 20px;
    border-radius: 24px;
  }

  .login-header {
    margin-bottom: 22px;

    .logo {
      width: 64px;
      height: 64px;
      margin-bottom: 14px;
    }

    h1 {
      font-size: 24px;
    }
  }
}

@media (max-width: 480px) {
  .login-container {
    padding: 12px;
    align-items: stretch;
  }

  .login-card {
    width: 100%;
    min-height: calc(100vh - 24px);
    display: flex;
    flex-direction: column;
    justify-content: center;
    border-radius: 22px;
  }

  .login-tabs {
    :deep(.el-tabs__item) {
      flex: 1;
      padding: 0 14px;
    }
  }
}
</style>
