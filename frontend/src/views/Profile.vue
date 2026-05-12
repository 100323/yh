<template>
  <div class="account-settings-page">
    <div class="page-container">
      <div class="page-header">
        <h1>账号设置</h1>
        <p>查看当前账号有效期，并维护登录密码。</p>
      </div>

      <section class="access-panel" aria-label="账号状态">
        <div class="access-panel-main">
          <div>
            <div class="access-eyebrow">账号状态</div>
            <div class="access-account">{{ accountAccessDisplay.username }}</div>
          </div>
          <el-tag
            class="access-status-tag"
            :type="accountAccessDisplay.tagType"
            effect="light"
          >
            {{ accountAccessDisplay.statusText }}
          </el-tag>
        </div>

        <div class="access-details">
          <div class="access-detail-item">
            <span>到期时间</span>
            <strong>{{ accountAccessDisplay.endText }}</strong>
          </div>
          <div class="access-detail-item">
            <span>开始时间</span>
            <strong>{{ accountAccessDisplay.startText }}</strong>
          </div>
          <div class="access-detail-item">
            <span>游戏账号上限</span>
            <strong>{{ accountAccessDisplay.maxGameAccountsText }}</strong>
          </div>
        </div>
      </section>

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
import { computed, onMounted, reactive, ref } from "vue";
import { ElMessage } from "element-plus";
import { useRouter } from "vue-router";
import { useAuthStore } from "@/stores/auth";
import { buildAccountAccessDisplay } from "@/utils/accountAccessDisplay";

const router = useRouter();
const authStore = useAuthStore();
const passwordFormRef = ref(null);
const submitting = ref(false);
const accountAccessDisplay = computed(() => buildAccountAccessDisplay(authStore.user));

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

onMounted(() => {
  if (authStore.isAuthenticated) {
    void authStore.fetchUser();
  }
});
</script>

<style scoped lang="scss">
.account-settings-page {
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

.access-panel {
  margin-bottom: 18px;
  padding: 18px;
  border: 1px solid var(--border-light);
  border-radius: 16px;
  background:
    linear-gradient(135deg, rgba(91, 124, 255, 0.08), rgba(255, 255, 255, 0.74));
  box-shadow: 0 16px 34px rgba(17, 27, 48, 0.08);
}

.access-panel-main {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 14px;
  margin-bottom: 18px;
}

.access-eyebrow {
  margin-bottom: 6px;
  color: var(--text-secondary);
  font-size: 13px;
  font-weight: 600;
}

.access-account {
  color: var(--text-primary);
  font-size: 22px;
  font-weight: 700;
  line-height: 1.25;
  overflow-wrap: anywhere;
}

.access-status-tag {
  flex-shrink: 0;
  margin-top: 2px;
}

.access-details {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
}

.access-detail-item {
  min-width: 0;
  padding: 12px 14px;
  border: 1px solid rgba(138, 151, 185, 0.14);
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.58);

  span,
  strong {
    display: block;
  }

  span {
    margin-bottom: 6px;
    color: var(--text-secondary);
    font-size: 12px;
  }

  strong {
    color: var(--text-primary);
    font-size: 14px;
    font-weight: 700;
    line-height: 1.45;
    overflow-wrap: anywhere;
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

  .access-panel {
    padding: 16px;
  }

  .access-panel-main {
    flex-direction: column;
    margin-bottom: 14px;
  }

  .access-account {
    font-size: 20px;
  }

  .access-details {
    grid-template-columns: 1fr;
    gap: 10px;
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
