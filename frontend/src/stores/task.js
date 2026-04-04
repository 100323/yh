import { defineStore } from 'pinia';
import { ref } from 'vue';
import api from '@/api';

export const useTaskStore = defineStore('task', () => {
  const taskTypes = ref([]);
  const accountTasks = ref({});
  const loading = ref(false);

  async function fetchTaskTypes() {
    const res = await api.get('/tasks/types');
    if (res.success) {
      taskTypes.value = res.data;
    }
    return res;
  }

  async function fetchAccountTasks(accountId) {
    loading.value = true;
    try {
      const res = await api.get(`/tasks/account/${accountId}`);
      if (res.success) {
        accountTasks.value[accountId] = res.data;
      }
      return res;
    } finally {
      loading.value = false;
    }
  }

  async function updateTaskConfig(accountId, taskType, data, options = {}) {
    const { refetch = true } = options;
    const res = await api.post(`/tasks/account/${accountId}`, {
      taskType,
      ...data
    });
    if (res.success && refetch) {
      await fetchAccountTasks(accountId);
    }
    return res;
  }

  async function deleteTaskConfig(taskId) {
    const res = await api.delete(`/tasks/${taskId}`);
    return res;
  }

  async function executeTask(accountId, taskType) {
    const res = await api.post('/tasks/execute', { accountId, taskType });
    return res;
  }

  async function fetchTaskLogs(accountId, params = {}) {
    const query = new URLSearchParams(params).toString();
    const res = await api.get(`/tasks/logs/${accountId}?${query}`);
    return res;
  }

  return {
    taskTypes,
    accountTasks,
    loading,
    fetchTaskTypes,
    fetchAccountTasks,
    updateTaskConfig,
    deleteTaskConfig,
    executeTask,
    fetchTaskLogs
  };
});
