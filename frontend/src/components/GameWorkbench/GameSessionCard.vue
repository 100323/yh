<template>
  <article class="session-card" :class="{ compact: compactMode }">
    <div class="session-frame-shell">
      <iframe
        class="session-frame"
        :src="session.launchUrl"
        allow="clipboard-read; clipboard-write; fullscreen"
        @load="$emit('loaded', session.id)"
        @error="$emit('error', session.id)"
      />

      <div class="session-overlay">
        <div class="session-meta">
          <strong>{{ session.name }}</strong>
          <small>{{ session.server || "未标记区服" }}</small>
        </div>
      </div>

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
  compactMode?: boolean;
}>();

defineEmits<{
  (e: 'loaded', sessionId: string): void;
  (e: 'error', sessionId: string): void;
}>();
</script>

<style scoped lang="scss">
.session-card {
  min-height: 0;
  height: 100%;
  border-radius: 24px;
  overflow: hidden;
  border: 1px solid rgba(149, 167, 208, 0.12);
  background:
    linear-gradient(180deg, rgba(11, 17, 31, 0.96), rgba(8, 13, 24, 0.98));
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.03);
}

.session-frame-shell {
  position: relative;
  width: 100%;
  height: 100%;
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

.session-overlay {
  position: absolute;
  left: 12px;
  right: 12px;
  bottom: 12px;
  display: flex;
  justify-content: flex-start;
  pointer-events: none;
}

.session-meta {
  max-width: min(72%, 320px);
  padding: 8px 12px;
  border-radius: 14px;
  background: rgba(4, 9, 20, 0.56);
  border: 1px solid rgba(149, 167, 208, 0.16);
  backdrop-filter: blur(12px);
  color: #f5f8ff;

  strong,
  small {
    display: block;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  strong {
    font-size: 13px;
    line-height: 1.2;
  }

  small {
    margin-top: 3px;
    color: rgba(189, 201, 226, 0.78);
    font-size: 12px;
  }
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

@media (max-width: 900px) {
  .session-card.compact {
    height: auto;
    aspect-ratio: 16 / 9;
  }

  .session-card.compact {
    min-height: auto;
  }

  .session-overlay {
    left: 10px;
    right: 10px;
    bottom: 10px;
  }

  .session-meta {
    max-width: min(84%, 320px);
  }
}
</style>
