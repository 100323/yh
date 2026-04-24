<template>
  <div class="change-password-page">
    <div class="page-container">
      <div class="page-header">
        <h1>修改密码</h1>
        <p>为了保障账户安全，请定期更新登录密码。</p>
      </div>

      <el-card class="password-card" shadow="never">
        <template #header>
          <div class="card-header">
            <div>
              <h2>账户密码</h2>
              <p>修改后，下次登录请使用新密码。</p>
            </div>
            <div class="account-name">
              当前账号：{{ authStore.user?.username || "未登录" }}
            </div>
          </div>
        </template>

        <el-form
          ref="passwordFormRef"
          :model="passwordForm"
          :rules="passwordRules"
          label-width="100px"
          class="password-form"
          status-icon
        >
          <el-form-item label="当前密码" prop="currentPassword">
            <el-input
              v-model="passwordForm.currentPassword"
              type="password"
              show-password
              clearable
              autocomplete="current-password"
              placeholder="请输入当前密码"
            />
          </el-form-item>

          <el-form-item label="新密码" prop="newPassword">
            <el-input
              v-model="passwordForm.newPassword"
              type="password"
              show-password
              clearable
              autocomplete="new-password"
              placeholder="请输入新密码"
            />
          </el-form-item>

          <el-form-item label="确认新密码" prop="confirmPassword">
            <el-input
              v-model="passwordForm.confirmPassword"
              type="password"
              show-password
              clearable
              autocomplete="new-password"
              placeholder="请再次输入新密码"
              @keyup.enter="submitChangePassword"
            />
          </el-form-item>

          <div class="password-tips">
            <div>• 新密码长度至少 6 位</div>
            <div>• 新密码不能与当前密码相同</div>
          </div>

          <el-form-item class="form-actions">
            <el-button
              type="primary"
              :loading="submitting"
              @click="submitChangePassword"
            >
              保存新密码
            </el-button>
            <el-button :disabled="submitting" @click="resetForm">清空输入</el-button>
          </el-form-item>
        </el-form>
      </el-card>
    </div>
  </div>
</template>

<script setup>
import { reactive, ref } from "vue";
import { ElMessage } from "element-plus";
import { useRouter } from "vue-router";
import { useAuthStore } from "@/stores/auth";

const router = useRouter();
const authStore = useAuthStore();
const passwordFormRef = ref(null);
const submitting = ref(false);

const passwordForm = reactive({
  currentPassword: "",
  newPassword: "",
  confirmPassword: "",
});

const validateNewPassword = (_rule, value, callback) => {
  if (!value) {
    callback(new Error("请输入新密码"));
    return;
  }

  if (String(value).length < 6) {
    callback(new Error("密码长度不能少于 6 位"));
    return;
  }

  if (value === passwordForm.currentPassword) {
    callback(new Error("新密码不能与当前密码相同"));
    return;
  }

  callback();
};

const validateConfirmPassword = (_rule, value, callback) => {
  if (!value) {
    callback(new Error("请再次输入新密码"));
    return;
  }

  if (value !== passwordForm.newPassword) {
    callback(new Error("两次输入的新密码不一致"));
    return;
  }

  callback();
};

const passwordRules = {
  currentPassword: [
    { required: true, message: "请输入当前密码", trigger: "blur" },
  ],
  newPassword: [{ validator: validateNewPassword, trigger: "blur" }],
  confirmPassword: [{ validator: validateConfirmPassword, trigger: "blur" }],
};

const resetForm = () => {
  passwordForm.currentPassword = "";
  passwordForm.newPassword = "";
  passwordForm.confirmPassword = "";
  passwordFormRef.value?.clearValidate?.();
};

const submitChangePassword = async () => {
  if (!passwordFormRef.value || submitting.value) return;

  try {
    await passwordFormRef.value.validate();
    submitting.value = true;

    const res = await authStore.changePassword(
      passwordForm.currentPassword,
      passwordForm.newPassword,
    );

    if (!res?.success) {
      throw new Error(res?.error || res?.message || "修改密码失败");
    }

    ElMessage.success("密码修改成功，请重新登录");
    resetForm();
    authStore.logout();
    router.replace("/login");
  } catch (error) {
    const text = String(error?.message || "");
    if (
      text
      && text !== "validation failed"
      && !text.includes("validate")
      && !text.includes("invalid")
    ) {
      ElMessage.error(text);
    }
  } finally {
    submitting.value = false;
  }
};
</script>

<style scoped lang="scss">
.change-password-page {
  min-height: 100%;
  padding: 0;
}

.page-container {
  max-width: 760px;
  margin: 0 auto;
}

.page-header {
  margin-bottom: 20px;

  h1 {
    margin: 0 0 8px;
    font-size: 28px;
    font-weight: 700;
    color: var(--text-primary);
  }

  p {
    margin: 0;
    color: var(--text-secondary);
    font-size: 14px;
  }
}

.password-card {
  border-radius: 16px;
  border: 1px solid var(--border-light);
}

.card-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;

  h2 {
    margin: 0 0 6px;
    font-size: 18px;
    color: var(--text-primary);
  }

  p {
    margin: 0;
    color: var(--text-secondary);
    font-size: 13px;
  }
}

.account-name {
  white-space: nowrap;
  color: var(--text-secondary);
  font-size: 13px;
  padding: 8px 12px;
  border-radius: 999px;
  background: var(--bg-secondary);
}

.password-form {
  max-width: 560px;
}

.password-tips {
  margin: 4px 0 20px 100px;
  padding: 12px 14px;
  border-radius: 12px;
  background: var(--bg-secondary);
  color: var(--text-secondary);
  font-size: 13px;
  line-height: 1.8;
}

:deep(.form-actions .el-form-item__content) {
  margin-left: 100px !important;
}

@media (max-width: 768px) {
  .page-header h1 {
    font-size: 24px;
  }

  .card-header {
    flex-direction: column;
  }

  .password-form {
    max-width: none;
  }

  .password-tips {
    margin-left: 0;
  }

  :deep(.el-form) {
    --el-form-label-font-size: 14px;
  }

  :deep(.el-form-item) {
    display: block;
  }

  :deep(.el-form-item__label) {
    display: block;
    width: auto !important;
    margin-bottom: 8px;
    line-height: 1.4;
    text-align: left;
  }

  :deep(.el-form-item__content) {
    margin-left: 0 !important;
  }
}
</style>
