<template>
  <div class="game-workbench-shell">
    <button
      v-if="hasSessions"
      type="button"
      class="workbench-fab"
      :class="{ hidden: !collapsed }"
      @click="toggleCollapsed(false)"
    >
      <span class="fab-label">游戏工作台</span>
      <span class="fab-count">{{ sessions.length }}</span>
    </button>

    <transition name="workbench-panel">
      <section v-if="hasSessions && !collapsed" class="workbench-panel">
        <header class="workbench-header">
          <div class="header-copy">
            <p class="eyebrow">Game Workbench</p>
            <h3>当前页多开游戏会话</h3>
            <span class="session-meta">已打开 {{ sessions.length }} 个会话</span>
          </div>

          <div class="header-actions">
            <div class="layout-switch">
              <button
                v-for="option in layoutOptions"
                :key="option.value"
                type="button"
                class="layout-button"
                :class="{ active: layoutMode === option.value }"
                @click="setLayoutMode(option.value)"
              >
                {{ option.label }}
              </button>
            </div>

            <button type="button" class="ghost-button" @click="toggleCollapsed(true)">
              收起
            </button>
            <button type="button" class="ghost-button danger" @click="closeAllSessions">
              全部关闭
            </button>
          </div>
        </header>

        <div class="session-tabs">
          <button
            v-for="session in sessions"
            :key="session.id"
            type="button"
            class="session-chip"
            :class="{ active: activeSession?.id === session.id }"
            @click="setActiveSession(session.id)"
          >
            <span class="status-dot" :class="session.status" />
            <span class="chip-copy">
              <strong>{{ session.name }}</strong>
              <small>{{ session.server || "未标记区服" }}</small>
            </span>
            <span class="chip-close" @click.stop="closeSession(session.id)">×</span>
          </button>
        </div>

        <div class="workbench-body" :class="`layout-${layoutMode}`" :style="bodyStyle">
          <template v-if="layoutMode === 'single'">
            <GameSessionCard
              v-if="activeSession"
              :session="activeSession"
              class="single-stage"
              @reload="reloadSession"
              @close="closeSession"
              @loaded="markLoaded"
              @error="markError"
            />
          </template>

          <template v-else>
            <GameSessionCard
              v-for="session in visibleSessions"
              :key="`${session.id}-${session.launchKey}`"
              :session="session"
              @reload="reloadSession"
              @close="closeSession"
              @loaded="markLoaded"
              @error="markError"
            />
          </template>
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
  activeSession,
  collapsed,
  hasSessions,
  layoutMode,
  orderedSessions,
} = storeToRefs(workbenchStore);
const {
  setLayoutMode,
  toggleCollapsed,
  setActiveSession,
  reloadSession,
  closeSession,
  closeAllSessions,
  setSessionStatus,
} = workbenchStore;

const layoutOptions = [
  { value: 'single', label: '单窗' },
  { value: 'grid2', label: '双窗' },
  { value: 'grid4', label: '四窗' },
] as const;

const visibleSessions = computed(() => {
  if (layoutMode.value === 'grid2') {
    return orderedSessions.value.slice(0, 2);
  }
  if (layoutMode.value === 'grid4') {
    return orderedSessions.value.slice(0, 4);
  }
  return activeSession.value ? [activeSession.value] : [];
});

const bodyStyle = computed(() => {
  if (layoutMode.value === 'single') {
    return {};
  }

  return {
    gridTemplateColumns: `repeat(${Math.max(1, visibleSessions.value.length)}, minmax(0, 1fr))`,
  };
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
  transition: transform 0.22s ease, opacity 0.22s ease;

  &.hidden {
    opacity: 0;
    transform: translateY(12px);
    pointer-events: none;
  }
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
  margin-left: 0;
  border-radius: 0;
  border: 1px solid rgba(150, 166, 204, 0.18);
  background:
    linear-gradient(180deg, rgba(8, 14, 28, 0.98), rgba(13, 21, 38, 0.98));
  box-shadow:
    0 26px 80px rgba(2, 7, 18, 0.46),
    inset 0 1px 0 rgba(255, 255, 255, 0.05);
  backdrop-filter: blur(24px);
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.workbench-header {
  display: flex;
  justify-content: space-between;
  gap: 20px;
  padding:
    calc(14px + env(safe-area-inset-top))
    calc(18px + env(safe-area-inset-right))
    14px
    calc(18px + env(safe-area-inset-left));
  border-bottom: 1px solid rgba(148, 164, 198, 0.12);
}

.header-copy {
  min-width: 0;

  .eyebrow {
    margin: 0 0 6px;
    font-size: 11px;
    letter-spacing: 0.16em;
    text-transform: uppercase;
    color: rgba(164, 183, 222, 0.72);
  }

  h3 {
    margin: 0;
    font-size: 22px;
    color: #f6f9ff;
    line-height: 1.15;
  }
}

.session-meta {
  display: inline-block;
  margin-top: 6px;
  color: rgba(177, 192, 223, 0.72);
  font-size: 13px;
}

.header-actions {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  justify-content: flex-end;
}

.layout-switch {
  display: inline-flex;
  padding: 4px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.08);
}

.layout-button,
.ghost-button {
  border: none;
  cursor: pointer;
  transition: all 0.2s ease;
}

.layout-button {
  min-width: 56px;
  padding: 8px 12px;
  border-radius: 999px;
  background: transparent;
  color: rgba(204, 216, 243, 0.7);
  font-size: 13px;

  &.active {
    background: linear-gradient(135deg, rgba(91, 124, 255, 0.94), rgba(124, 92, 255, 0.9));
    color: #fff;
    box-shadow: 0 8px 22px rgba(91, 124, 255, 0.24);
  }
}

.ghost-button {
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

.session-tabs {
  display: flex;
  gap: 10px;
  padding: 12px calc(18px + env(safe-area-inset-right)) 10px calc(18px + env(safe-area-inset-left));
  overflow-x: auto;
  border-bottom: 1px solid rgba(148, 164, 198, 0.08);
}

.session-chip {
  min-width: 196px;
  display: inline-flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border-radius: 18px;
  border: 1px solid rgba(154, 170, 210, 0.12);
  background: rgba(255, 255, 255, 0.04);
  color: #f7fbff;
  cursor: pointer;
  transition: all 0.2s ease;

  &.active {
    background: linear-gradient(135deg, rgba(91, 124, 255, 0.16), rgba(124, 92, 255, 0.18));
    border-color: rgba(121, 143, 255, 0.42);
    box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.03);
  }
}

.chip-copy {
  display: flex;
  flex-direction: column;
  min-width: 0;
  text-align: left;

  strong,
  small {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  strong {
    font-size: 13px;
  }

  small {
    margin-top: 2px;
    color: rgba(174, 190, 219, 0.72);
  }
}

.chip-close {
  margin-left: auto;
  font-size: 16px;
  line-height: 1;
  color: rgba(188, 202, 231, 0.7);
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

.workbench-body {
  flex: 1;
  min-height: 0;
  padding:
    16px
    calc(18px + env(safe-area-inset-right))
    calc(18px + env(safe-area-inset-bottom))
    calc(18px + env(safe-area-inset-left));
  display: grid;
  gap: 16px;

  &.layout-single {
    grid-template-columns: 1fr;
  }

  &.layout-grid2 {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  &.layout-grid4 {
    grid-template-columns: repeat(4, minmax(0, 1fr));
  }
}

.single-stage {
  min-height: 0;
  height: 100%;
}

.workbench-panel-enter-active,
.workbench-panel-leave-active {
  transition: opacity 0.22s ease, transform 0.22s ease;
}

.workbench-panel-enter-from,
.workbench-panel-leave-to {
  opacity: 0;
  transform: translateY(14px) scale(0.99);
}

@media (max-width: 1280px) {
  .workbench-panel {
    width: 100vw;
  }
}

@media (max-width: 992px) {
  .workbench-panel {
    width: 100vw;
    height: 100dvh;
  }

  .workbench-body.layout-grid2,
  .workbench-body.layout-grid4 {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 720px) {
  .workbench-panel {
    height: 100dvh;
    border-radius: 0;
  }

  .workbench-header,
  .session-tabs,
  .workbench-body {
    padding-left: max(14px, env(safe-area-inset-left));
    padding-right: max(14px, env(safe-area-inset-right));
  }

  .workbench-header {
    flex-direction: column;
    align-items: stretch;
    padding-top: max(14px, env(safe-area-inset-top));
  }

  .header-actions {
    justify-content: flex-start;
  }

  .workbench-body {
    padding-bottom: max(14px, env(safe-area-inset-bottom));
  }
}
</style>
