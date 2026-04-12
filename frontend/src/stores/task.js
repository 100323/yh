import { defineStore } from 'pinia';
import { ref } from 'vue';
import api from '@/api';

export const useTaskStore = defineStore('task', () => {
  const taskTypes = ref([]);
  const accountTasks = ref({});
  const taskConfigRevisions = ref({});
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
      const payload = Array.isArray(res.data)
        ? { items: res.data, revision: null }
        : {
            items: res.data?.items || [],
            revision: res.data?.revision || null,
          };

      if (res.success) {
        accountTasks.value[accountId] = payload.items;
        taskConfigRevisions.value[accountId] = payload.revision;
      }

      return {
        ...res,
        data: payload,
      };
    } finally {
      loading.value = false;
    }
  }

  async function updateTaskConfig(accountId, taskType, data, options = {}) {
    const { refetch = true, baselineRevision = null } = options;
    const res = await api.post(`/tasks/account/${accountId}`, {
      taskType,
      baselineRevision,
      ...data
    });
    if (res.success) {
      taskConfigRevisions.value[accountId] = res.data?.revision || null;
      if (refetch) {
        await fetchAccountTasks(accountId);
      }
    }
    return res;
  }

  async function deleteTaskConfig(taskId) {
    const res = await api.delete(`/tasks/${taskId}`);
    return res;
  }

  async function batchUpdateAccountTasks(accountId, tasks, options = {}) {
    const { baselineRevision = null, refetch = false } = options;
    const res = await api.put(`/tasks/account/${accountId}/batch`, {
      tasks,
      baselineRevision,
    });

    if (res.success) {
      taskConfigRevisions.value[accountId] = res.data?.revision || null;
      if (refetch) {
        await fetchAccountTasks(accountId);
      }
    }

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
    taskConfigRevisions,
    loading,
    fetchTaskTypes,
    fetchAccountTasks,
    updateTaskConfig,
    batchUpdateAccountTasks,
    deleteTaskConfig,
    executeTask,
    fetchTaskLogs
  };
});
