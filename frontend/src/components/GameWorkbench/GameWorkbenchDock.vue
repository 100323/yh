<template>
  <div class="game-workbench-shell">
    <button
      v-if="hasSessions && collapsed"
      type="button"
      class="workbench-fab"
      @click="toggleCollapsed(false)"
    >
      <span class="fab-label">游戏工作台</span>
      <span class="fab-count">{{ sessions.length }}</span>
    </button>

    <transition name="workbench-panel">
      <section v-if="hasSessions" v-show="!collapsed" class="workbench-panel">
        <div class="floating-actions">
          <button type="button" class="floating-button" @click="toggleCollapsed(true)">
            收起
          </button>
          <button type="button" class="floating-button danger" @click="closeAllSessions">
            关闭
          </button>
        </div>

        <div class="workbench-body" :class="layoutClass">
          <GameSessionCard
            v-for="session in visibleSessions"
            :key="`${session.id}-${session.launchKey}`"
            :session="session"
            :compact-mode="visibleSessions.length > 1"
            @loaded="markLoaded"
            @error="markError"
          />
        </div>
      </section>
    </transition>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { storeToRefs } from 'pinia';
import { useGameWorkbenchStore } from '@/stores/gameWorkbench';
import GameSessionCard from './GameSessionCard.vue';

const workbenchStore = useGameWorkbenchStore();
const {
  sessions,
  collapsed,
  hasSessions,
} = storeToRefs(workbenchStore);
const {
  toggleCollapsed,
  closeAllSessions,
  setSessionStatus,
} = workbenchStore;

const visibleSessions = computed(() => sessions.value.slice(0, 4));

const layoutClass = computed(() => {
  const count = visibleSessions.value.length;
  if (count <= 1) return 'layout-single';
  if (count === 2) return 'layout-double';
  if (count === 3) return 'layout-triple';
  return 'layout-quad';
});

const markLoaded = (sessionId: string) => {
  setSessionStatus(sessionId, 'running');
};

const markError = (sessionId: string) => {
  setSessionStatus(sessionId, 'error');
};
</script>

<style scoped lang="scss">
.game-workbench-shell {
  position: fixed;
  inset: 0;
  z-index: calc(var(--z-modal) + 5);
  pointer-events: none;
}

.workbench-fab,
.workbench-panel {
  pointer-events: auto;
}

.workbench-fab {
  position: absolute;
  right: max(16px, env(safe-area-inset-right));
  bottom: max(16px, env(safe-area-inset-bottom));
  display: inline-flex;
  align-items: center;
  gap: 12px;
  border: 1px solid rgba(149, 167, 208, 0.24);
  background:
    linear-gradient(135deg, rgba(12, 20, 37, 0.96), rgba(22, 33, 56, 0.98));
  color: #f7fbff;
  border-radius: 999px;
  padding: 12px 18px;
  box-shadow: 0 18px 48px rgba(5, 10, 23, 0.34);
  cursor: pointer;
}

.fab-label {
  font-size: 13px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  opacity: 0.84;
}

.fab-count {
  min-width: 26px;
  height: 26px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 999px;
  background: linear-gradient(135deg, #5b7cff, #7c5cff);
  font-size: 13px;
  font-weight: 700;
}

.workbench-panel {
  position: absolute;
  inset: 0;
  width: 100vw;
  height: 100dvh;
  background:
    linear-gradient(180deg, rgba(8, 14, 28, 0.98), rgba(13, 21, 38, 0.98));
  backdrop-filter: blur(24px);
  overflow: hidden;
}

.floating-actions {
  position: absolute;
  top: calc(14px + env(safe-area-inset-top));
  right: calc(16px + env(safe-area-inset-right));
  display: flex;
  gap: 10px;
  z-index: 3;
}

.floating-button {
  border: none;
  cursor: pointer;
  padding: 10px 14px;
  border-radius: 14px;
  background: rgba(8, 14, 28, 0.72);
  color: rgba(240, 245, 255, 0.92);
  border: 1px solid rgba(149, 167, 208, 0.16);
  backdrop-filter: blur(12px);
  font-size: 13px;

  &.danger {
    color: #ffb3c1;
  }
}

.workbench-body {
  height: 100%;
  padding:
    calc(56px + env(safe-area-inset-top))
    calc(12px + env(safe-area-inset-right))
    calc(12px + env(safe-area-inset-bottom))
    calc(12px + env(safe-area-inset-left));
  display: grid;
  gap: 12px;
  grid-auto-rows: minmax(0, 1fr);
}

.layout-single {
  grid-template-columns: 1fr;
}

.layout-double {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.layout-triple {
  grid-template-columns: repeat(3, minmax(0, 1fr));
}

.layout-quad {
  grid-template-columns: repeat(4, minmax(0, 1fr));
}

.workbench-panel-enter-active,
.workbench-panel-leave-active {
  transition: opacity 0.2s ease;
}

.workbench-panel-enter-from,
.workbench-panel-leave-to {
  opacity: 0;
}

@media (max-width: 1200px) {
  .layout-triple,
  .layout-quad {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 900px) {
  .workbench-body {
    overflow-y: auto;
    align-content: start;
    gap: 14px;
    grid-auto-rows: auto;
  }

  .layout-double,
  .layout-triple,
  .layout-quad {
    grid-template-columns: 1fr;
  }

  .workbench-body.layout-single {
    padding-top: calc(42px + env(safe-area-inset-top));
    gap: 0;
  }

  .layout-single :deep(.session-card) {
    min-height: calc(100dvh - 52px - env(safe-area-inset-top) - 12px - env(safe-area-inset-bottom));
  }
}

@media (max-width: 720px) {
  .floating-actions {
    top: calc(10px + env(safe-area-inset-top));
    right: calc(12px + env(safe-area-inset-right));
    gap: 8px;
  }

  .floating-button {
    padding: 9px 12px;
    font-size: 12px;
  }

  .workbench-body {
    padding:
      calc(50px + env(safe-area-inset-top))
      max(10px, env(safe-area-inset-right))
      max(10px, env(safe-area-inset-bottom))
      max(10px, env(safe-area-inset-left));
  }
}
</style>
