<template>
  <el-dialog
    :model-value="modelValue"
    width="min(420px, 92vw)"
    class="wechat-contact-dialog"
    append-to-body
    @update:model-value="emit('update:modelValue', $event)"
  >
    <template #header>
      <div class="wechat-dialog-header">
        <span class="wechat-icon">💬</span>
        <span>微信联系</span>
      </div>
    </template>

    <div class="wechat-contact">
      <img :src="qrCodeUrl" alt="微信二维码" class="wechat-qr" />

      <div class="wechat-id-card">
        <span class="wechat-label">微信号</span>
        <strong>{{ wechatId }}</strong>
      </div>

      <el-button type="primary" class="copy-button" @click="copyWechatId">
        复制微信号
      </el-button>

      <p class="wechat-tip">
        扫码添加好友；已是好友可复制微信号后在微信搜索并私聊。
      </p>
    </div>
  </el-dialog>
</template>

<script setup>
import { ElMessage } from 'element-plus';

defineProps({
  modelValue: {
    type: Boolean,
    default: false
  }
});

const emit = defineEmits(['update:modelValue']);

const wechatId = 'Aajie4649';
const qrCodeUrl = '/contact/wechat-qr.jpg';

const copyTextFallback = (text) => {
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.left = '-9999px';
  document.body.appendChild(textarea);
  textarea.select();
  const copied = document.execCommand('copy');
  document.body.removeChild(textarea);
  return copied;
};

const copyWechatId = async () => {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(wechatId);
    } else if (!copyTextFallback(wechatId)) {
      throw new Error('copy failed');
    }
    ElMessage.success('微信号已复制');
  } catch (error) {
    console.error('复制微信号失败:', error);
    ElMessage.warning(`请手动复制微信号：${wechatId}`);
  }
};
</script>

<style lang="scss" scoped>
.wechat-dialog-header {
  display: flex;
  align-items: center;
  gap: 10px;
  font-weight: 700;
  color: var(--text-primary);
}

.wechat-icon {
  font-size: 18px;
}

.wechat-contact {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;
  text-align: center;
}

.wechat-qr {
  width: min(280px, 78vw);
  max-width: 100%;
  border-radius: 18px;
  border: 1px solid rgba(138, 151, 185, 0.22);
  box-shadow: 0 18px 42px rgba(29, 47, 92, 0.14);
}

.wechat-id-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  width: min(280px, 100%);
  padding: 12px 14px;
  border-radius: 16px;
  background: rgba(91, 124, 255, 0.08);
  color: var(--text-primary);

  strong {
    font-size: 18px;
    letter-spacing: 0.02em;
  }
}

.wechat-label {
  color: var(--text-secondary);
  font-size: 13px;
}

.copy-button {
  width: min(280px, 100%);
}

.wechat-tip {
  margin: 0;
  color: var(--text-secondary);
  line-height: 1.7;
  font-size: 13px;
}
</style>
