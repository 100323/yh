<template>
  <el-config-provider :locale="zhCn">
    <n-message-provider>
      <n-dialog-provider>
        <n-notification-provider>
          <router-view />
        </n-notification-provider>
      </n-dialog-provider>
    </n-message-provider>
  </el-config-provider>
</template>

<script setup>
import { onMounted } from 'vue';
import { useAuthStore } from '@stores/auth';
import { ElConfigProvider } from 'element-plus';
import zhCn from 'element-plus/es/locale/lang/zh-cn';
import { NMessageProvider } from 'naive-ui/es/message';
import { NDialogProvider } from 'naive-ui/es/dialog';
import { NNotificationProvider } from 'naive-ui/es/notification';

const authStore = useAuthStore();

onMounted(async () => {
  authStore.checkAuth();
  if (authStore.isAuthenticated) {
    await authStore.fetchUser();
  }
});
</script>

<style>
html, body, #app {
  height: 100%;
  margin: 0;
  padding: 0;
}
</style>
