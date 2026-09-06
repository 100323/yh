<template>
  <el-dialog
    class="plugin-script-manager-dialog"
    :model-value="visible"
    title="管理插件与脚本"
    width="34rem"
    append-to-body
    destroy-on-close
    @update:model-value="emit('update:visible', $event)"
  >
    <p v-if="BUILTIN_GAME_SCRIPTS.length === 0" class="empty-state">暂无内置脚本</p>

    <div v-else class="builtin-script-list">
      <div v-for="script in BUILTIN_GAME_SCRIPTS" :key="script.id" class="builtin-script-item">
        <div class="builtin-script-info">
          <strong>{{ script.title }}</strong>
          <p>{{ script.description }}</p>
        </div>
        <el-switch
          :model-value="enabledIds.includes(script.id)"
          @change="toggleScript(script.id, $event)"
        />
      </div>
    </div>

    <p class="builtin-script-hint">开启后，重新进入游戏时会加载到游戏内。</p>
  </el-dialog>
</template>

<script setup>
import { ref, watch } from 'vue';
import {
  BUILTIN_GAME_SCRIPTS,
  readEnabledBuiltinScriptIds,
  writeEnabledBuiltinScriptIds,
} from '@utils/builtinScripts';

const props = defineProps({
  visible: Boolean,
});

const emit = defineEmits(['update:visible']);

const enabledIds = ref([]);

const readState = () => {
  enabledIds.value = readEnabledBuiltinScriptIds();
};

const toggleScript = (scriptId, enabled) => {
  const nextIds = enabled
    ? [...new Set([...enabledIds.value, scriptId])]
    : enabledIds.value.filter((id) => id !== scriptId);

  try {
    enabledIds.value = writeEnabledBuiltinScriptIds(window.localStorage, nextIds);
  } catch {
    enabledIds.value = nextIds;
  }
};

watch(
  () => props.visible,
  (visible) => {
    if (visible) {
      readState();
    }
  },
  { immediate: true },
);
</script>

<style scoped>
.empty-state {
  margin: 0 0 16px;
  color: var(--text-secondary, #64748b);
  text-align: center;
}

.builtin-script-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin-bottom: 16px;
}

.builtin-script-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 16px;
  padding: 12px 14px;
  border-radius: 8px;
  border: 1px solid rgba(100, 116, 139, 0.22);
}

.builtin-script-info {
  min-width: 0;
}

.builtin-script-info strong {
  display: block;
  font-size: 14px;
  line-height: 1.4;
}

.builtin-script-info p {
  margin: 3px 0 0;
  color: var(--text-secondary, #64748b);
  font-size: 12px;
  line-height: 1.5;
}

.builtin-script-hint {
  margin: 0;
  color: var(--text-secondary, #64748b);
  font-size: 12px;
  line-height: 1.5;
}
</style>
