<template>
  <article class="session-card">
    <div class="session-toolbar">
      <div class="session-headline">
        <span class="status-dot" :class="session.status" />
        <div>
          <strong>{{ session.name }}</strong>
          <small>{{ session.server || "未标记区服" }}</small>
        </div>
      </div>

      <div class="session-actions">
        <button type="button" class="mini-button" @click="$emit('reload', session.id)">重载</button>
        <button type="button" class="mini-button danger" @click="$emit('close', session.id)">关闭</button>
      </div>
    </div>

    <div class="session-frame-shell">
      <iframe
        class="session-frame"
        :src="session.launchUrl"
        allow="clipboard-read; clipboard-write; fullscreen"
        @load="$emit('loaded', session.id)"
        @error="$emit('error', session.id)"
      />
      <div v-if="session.status === 'loading'" class="session-mask">
        <span>游戏加载中…</span>
      </div>
    </div>
  </article>
</template>

<script setup lang="ts">
defineProps<{
  session: {
    id: string;
    name: string;
    server: string;
    status: 'loading' | 'running' | 'error';
    launchUrl: string;
  };
}>();

defineEmits<{
  (e: 'reload', sessionId: string): void;
  (e: 'close', sessionId: string): void;
  (e: 'loaded', sessionId: string): void;
  (e: 'error', sessionId: string): void;
}>();
</script>

<style scoped lang="scss">
.session-card {
  min-height: 0;
  border-radius: 24px;
  overflow: hidden;
  border: 1px solid rgba(149, 167, 208, 0.12);
  background:
    linear-gradient(180deg, rgba(11, 17, 31, 0.96), rgba(8, 13, 24, 0.98));
  display: flex;
  flex-direction: column;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.03);
}

.session-toolbar {
  display: flex;
  justify-content: space-between;
  gap: 14px;
  align-items: center;
  padding: 14px 16px;
  border-bottom: 1px solid rgba(149, 167, 208, 0.08);
}

.session-headline {
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 12px;

  div {
    min-width: 0;
    display: flex;
    flex-direction: column;
  }

  strong,
  small {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  strong {
    color: #f6f9ff;
    font-size: 14px;
  }

  small {
    color: rgba(180, 195, 225, 0.72);
    margin-top: 2px;
  }
}

.session-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  justify-content: flex-end;
}

.mini-button {
  border: none;
  cursor: pointer;
  transition: all 0.2s ease;
  padding: 9px 12px;
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.06);
  color: rgba(231, 238, 255, 0.86);
  font-size: 13px;

  &:hover {
    background: rgba(255, 255, 255, 0.12);
  }

  &.danger {
    color: #ffb3c1;
  }
}

.status-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  flex-shrink: 0;
  background: rgba(154, 170, 210, 0.45);

  &.loading {
    background: #f5a623;
    box-shadow: 0 0 0 6px rgba(245, 166, 35, 0.14);
  }

  &.running {
    background: #18a058;
    box-shadow: 0 0 0 6px rgba(24, 160, 88, 0.14);
  }

  &.error {
    background: #d03050;
    box-shadow: 0 0 0 6px rgba(208, 48, 80, 0.14);
  }
}

.session-frame-shell {
  position: relative;
  flex: 1;
  min-height: 0;
  background: #060b14;
}

.session-frame {
  width: 100%;
  height: 100%;
  border: none;
  display: block;
  background: #060b14;
}

.session-mask {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(180deg, rgba(5, 9, 18, 0.2), rgba(5, 9, 18, 0.48));
  color: #f5f8ff;
  font-size: 14px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  backdrop-filter: blur(6px);
}

@media (max-width: 720px) {
  .session-toolbar {
    flex-direction: column;
    align-items: stretch;
  }

  .session-actions {
    justify-content: flex-start;
  }
}
</style>
