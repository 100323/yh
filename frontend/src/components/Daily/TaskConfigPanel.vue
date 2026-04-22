<template>
  <div class="task-config-panel" v-if="initialized">
    <div class="panel-header">
      <h3>{{ title }}</h3>
      <div class="header-actions">
        <n-button size="small" @click="expandAll">展开全部</n-button>
        <n-button size="small" @click="collapseAll" :disabled="disabled">折叠全部</n-button>
        <n-button size="small" type="primary" @click="resetToDefault" :disabled="disabled">恢复默认</n-button>
      </div>
    </div>

    <div class="task-groups">
      <n-collapse v-model:expanded-names="expandedGroups">
        <n-collapse-item
          v-for="group in taskGroupDefinitions"
          :key="group.name"
          :name="group.name"
        >
          <template #header>
            <div class="group-header">
              <span class="group-icon">{{ group.icon }}</span>
              <span class="group-label">{{ group.label }}</span>
              <n-tag size="small" :type="getGroupEnabledCount(group.name) > 0 ? 'success' : 'default'">
                {{ getGroupEnabledCount(group.name) }}/{{ getGroupTotalCount(group.name) }}
              </n-tag>
            </div>
          </template>

          <div class="task-list">
            <div
              v-for="task in getGroupTasks(group.name)"
              :key="task.value"
              class="task-item"
            >
              <div class="task-header">
                <div class="task-info">
                  <n-switch
                    v-model:value="getTaskConfig(task.value).enabled"
                    size="small"
                    :disabled="disabled"
                  />
                  <span class="task-label">{{ task.label }}</span>
                  <n-tooltip v-if="task.description" trigger="hover" placement="right" :content-style="{ maxWidth: '280px', whiteSpace: 'pre-line' }">
                    <template #trigger>
                      <n-icon size="14" color="#86909c">
                        <InformationCircle />
                      </n-icon>
                    </template>
                    {{ task.description }}
                  </n-tooltip>
                </div>
                <n-button
                  v-if="task.configFields && task.configFields.length > 0"
                  size="tiny"
                  text
                  :disabled="disabled"
                  @click="toggleTaskConfig(task.value)"
                >
                  {{ isTaskExpanded(task.value) ? '收起配置' : '展开配置' }}
                  <n-icon>
                    <ChevronUp v-if="isTaskExpanded(task.value)" />
                    <ChevronDown v-else />
                  </n-icon>
                </n-button>
              </div>

              <n-collapse-transition :show="isTaskExpanded(task.value) && task.configFields && task.configFields.length > 0">
                <div class="task-config-fields">
                  <div
                    v-for="field in task.configFields"
                    :key="field.key"
                    class="config-field"
                  >
                    <label class="field-label">
                      {{ field.label }}
                      <n-tooltip v-if="field.description" trigger="hover">
                        <template #trigger>
                          <n-icon size="12" color="#86909c">
                            <InformationCircle />
                          </n-icon>
                        </template>
                        {{ field.description }}
                      </n-tooltip>
                    </label>

                    <div class="field-input">
                      <n-select
                        v-if="field.type === 'select'"
                        v-model:value="getTaskConfig(task.value).config[field.key]"
                        :options="getOptionByRef(field.options)"
                        size="small"
                        :disabled="disabled"
                        :placeholder="`请选择${field.label}`"
                      />
                      <n-input-number
                        v-else-if="field.type === 'number'"
                        v-model:value="getTaskConfig(task.value).config[field.key]"
                        :min="field.min"
                        :max="field.max"
                        size="small"
                        :disabled="disabled"
                        :placeholder="`请输入${field.label}`"
                      />
                      <n-switch
                        v-else-if="field.type === 'switch'"
                        v-model:value="getTaskConfig(task.value).config[field.key]"
                        size="small"
                        :disabled="disabled"
                      />
                      <n-input
                        v-else
                        v-model:value="getTaskConfig(task.value).config[field.key]"
                        size="small"
                        :disabled="disabled"
                        :placeholder="`请输入${field.label}`"
                      />
                    </div>
                  </div>
                </div>
              </n-collapse-transition>
            </div>
          </div>
        </n-collapse-item>
      </n-collapse>
    </div>

    <div class="panel-footer">
      <n-button @click="handleCancel" :disabled="disabled">取消</n-button>
      <n-button type="primary" @click="handleSave" :loading="saving" :disabled="disabled">保存配置</n-button>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted, nextTick } from 'vue';
import {
  taskGroupDefinitions,
  taskConfigDefinitions,
  defaultTaskConfigs,
  formationOptions,
  bossTimesOptions,
  carMinColorOptions,
  boxTypeOptions,
  fishTypeOptions,
} from '@/utils/batch/constants';
import { InformationCircle, ChevronUp, ChevronDown } from '@vicons/ionicons5';

const props = defineProps({
  title: {
    type: String,
    default: '任务配置',
  },
  modelValue: {
    type: Object,
    default: () => ({}),
  },
  disabled: {
    type: Boolean,
    default: false,
  },
  saving: {
    type: Boolean,
    default: false,
  },
});

const emit = defineEmits(['update:modelValue', 'save', 'cancel']);

const initialized = ref(false);
const expandedGroups = ref(['daily', 'dungeon', 'resource']);
const expandedTasks = ref([]);
const taskConfigs = ref({});

const optionRefs = {
  formationOptions,
  bossTimesOptions,
  carMinColorOptions,
  boxTypeOptions,
  fishTypeOptions,
};

const getOptionByRef = (refName) => {
  return optionRefs[refName] || [];
};

const getTaskConfig = (taskValue) => {
  if (!taskConfigs.value[taskValue]) {
    taskConfigs.value[taskValue] = JSON.parse(
      JSON.stringify(defaultTaskConfigs[taskValue] || {
        enabled: true,
        config: {},
        scheduleType: 'daily',
        runTime: null,
        intervalHours: 4,
      }),
    );
  }
  return taskConfigs.value[taskValue];
};

const getGroupTasks = (groupName) => {
  return Object.entries(taskConfigDefinitions)
    .filter(([value, config]) => value !== 'startBatch' && config.group === groupName)
    .map(([value, config]) => ({
      value,
      ...config,
    }));
};

const getGroupEnabledCount = (groupName) => {
  const tasks = getGroupTasks(groupName);
  return tasks.filter((task) => {
    const config = taskConfigs.value[task.value];
    return config?.enabled ?? task.defaultEnabled;
  }).length;
};

const getGroupTotalCount = (groupName) => {
  return getGroupTasks(groupName).length;
};

const isTaskExpanded = (taskValue) => {
  return expandedTasks.value.includes(taskValue);
};

const toggleTaskConfig = (taskValue) => {
  const index = expandedTasks.value.indexOf(taskValue);
  if (index > -1) {
    expandedTasks.value.splice(index, 1);
  } else {
    expandedTasks.value.push(taskValue);
  }
};

const expandAll = () => {
  expandedGroups.value = taskGroupDefinitions.map((g) => g.name);
  expandedTasks.value = Object.keys(taskConfigDefinitions);
};

const collapseAll = () => {
  expandedGroups.value = [];
  expandedTasks.value = [];
};

const resetToDefault = () => {
  taskConfigs.value = JSON.parse(JSON.stringify(defaultTaskConfigs));
};

const handleSave = () => {
  emit('update:modelValue', JSON.parse(JSON.stringify(taskConfigs.value)));
  emit('save', taskConfigs.value);
};

const handleCancel = () => {
  emit('cancel');
};

const initializeConfigs = () => {
  const newConfigs = {};

  Object.keys(taskConfigDefinitions).forEach((key) => {
    if (props.modelValue && props.modelValue[key]) {
      newConfigs[key] = {
        enabled: props.modelValue[key].enabled ?? defaultTaskConfigs[key]?.enabled ?? true,
        config: {
          ...(defaultTaskConfigs[key]?.config || {}),
          ...(props.modelValue[key].config || {}),
        },
        scheduleType: props.modelValue[key].scheduleType || defaultTaskConfigs[key]?.scheduleType || 'daily',
        runTime: props.modelValue[key].runTime || defaultTaskConfigs[key]?.runTime || null,
        intervalHours: props.modelValue[key].intervalHours ?? defaultTaskConfigs[key]?.intervalHours ?? 4,
      };
    } else {
      newConfigs[key] = {
        ...(JSON.parse(JSON.stringify(defaultTaskConfigs[key] || {
          enabled: true,
          config: {},
          scheduleType: 'daily',
          runTime: null,
          intervalHours: 4,
        }))),
      };
    }
  });

  taskConfigs.value = newConfigs;
  initialized.value = true;
};

watch(
  () => props.modelValue,
  (newVal) => {
    if (newVal && Object.keys(newVal).length > 0) {
      initializeConfigs();
    }
  },
  { deep: true }
);

onMounted(() => {
  nextTick(() => {
    initializeConfigs();
  });
});

watch(
  () => taskConfigs.value.batchRecruit?.config?.usePaidRecruit,
  (enabled) => {
    const recruitConfig = taskConfigs.value.batchRecruit?.config;
    if (!recruitConfig) {
      return;
    }

    const currentCount = Math.max(0, Number(recruitConfig.paidRecruitCount) || 0);
    if (enabled === false && currentCount !== 0) {
      recruitConfig.paidRecruitCount = 0;
      return;
    }

    if (enabled === true && currentCount <= 0) {
      recruitConfig.paidRecruitCount = 1;
    }
  }
);

watch(
  () => taskConfigs.value.batchRecruit?.config?.paidRecruitCount,
  (value) => {
    const recruitConfig = taskConfigs.value.batchRecruit?.config;
    if (!recruitConfig) {
      return;
    }

    const normalizedCount = Math.max(0, Number(value) || 0);
    if (value !== normalizedCount) {
      recruitConfig.paidRecruitCount = normalizedCount;
      return;
    }

    const shouldEnable = normalizedCount > 0;
    if (recruitConfig.usePaidRecruit !== shouldEnable) {
      recruitConfig.usePaidRecruit = shouldEnable;
    }
  }
);
</script>

<style scoped lang="scss">
.task-config-panel {
  display: flex;
  flex-direction: column;
  gap: 16px;
  max-height: 70vh;
  overflow: hidden;
  padding: 2px;
}

.panel-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 4px 2px 14px;

  h3 {
    margin: 0;
    font-size: 16px;
    font-weight: 600;
    color: var(--text-primary);
  }

  .header-actions {
    display: flex;
    gap: 8px;
  }
}

.task-groups {
  flex: 1;
  overflow-y: auto;
}

.group-header {
  display: flex;
  align-items: center;
  gap: 8px;

  .group-icon {
    font-size: 16px;
  }

  .group-label {
    font-weight: 500;
  }
}

.task-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 8px 0;
}

.task-item {
  padding: 14px 16px;
  background: rgba(255, 255, 255, 0.74);
  border-radius: 18px;
  border: 1px solid rgba(138, 151, 185, 0.14);
  box-shadow: 0 8px 20px rgba(24, 39, 75, 0.06);
}

.task-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.task-info {
  display: flex;
  align-items: center;
  gap: 8px;

  .task-label {
    font-size: 14px;
    font-weight: 600;
    color: var(--text-primary);
  }
}

.task-config-fields {
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px dashed rgba(138, 151, 185, 0.2);
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.config-field {
  display: flex;
  align-items: center;
  gap: 12px;

  .field-label {
    min-width: 120px;
    font-size: 13px;
    color: var(--text-secondary);
    display: flex;
    align-items: center;
    gap: 4px;
  }

  .field-input {
    flex: 1;
    max-width: 240px;
  }
}

.panel-footer {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
  padding-top: 12px;
}

.tooltip-content {
  max-width: 280px;
  white-space: pre-line;
  word-break: break-all;
  line-height: 1.5;
  font-size: 12px;
}

:deep(.n-collapse) {
  background: transparent;
}

:deep(.n-collapse-item) {
  margin-bottom: 12px;
  border-radius: 20px;
  border: 1px solid rgba(138, 151, 185, 0.14);
  background: rgba(255, 255, 255, 0.72);
  overflow: hidden;
  box-shadow: 0 8px 20px rgba(24, 39, 75, 0.05);
}

:deep(.n-collapse-item__header) {
  padding: 16px 18px !important;
}

:deep(.n-collapse-item__content-wrapper .n-collapse-item__content-inner) {
  padding: 0 14px 14px !important;
}

:deep(.n-base-selection),
:deep(.n-input-number),
:deep(.n-input .n-input-wrapper) {
  border-radius: 14px !important;
  background: rgba(255, 255, 255, 0.9);
  border: 1px solid rgba(138, 151, 185, 0.18);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.36);
}

:deep(.n-base-selection:hover),
:deep(.n-input-number:hover),
:deep(.n-input .n-input-wrapper:hover) {
  border-color: rgba(91, 124, 255, 0.3);
}

:deep(.n-base-selection.n-base-selection--active),
:deep(.n-input-number.n-input-number--focus),
:deep(.n-input.n-input--focus .n-input-wrapper) {
  border-color: rgba(91, 124, 255, 0.45);
  box-shadow:
    0 0 0 4px rgba(91, 124, 255, 0.12),
    inset 0 1px 0 rgba(255, 255, 255, 0.36);
}

:deep(.n-input-number .n-input-wrapper),
:deep(.n-input .n-input-wrapper) {
  box-shadow: none;
}

:deep(.n-input-number .n-input__border),
:deep(.n-input .n-input__border),
:deep(.n-base-selection .n-base-selection__border) {
  display: none !important;
}

@media (max-width: 768px) {
  .panel-header,
  .task-header,
  .config-field,
  .panel-footer {
    flex-direction: column;
    align-items: stretch;
  }

  .config-field {
    gap: 8px;
  }

  .config-field .field-input {
    max-width: none;
  }
}
</style>
