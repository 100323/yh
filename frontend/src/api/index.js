import request from '@/utils/api';

const api = Object.assign(request, {
  auth: {
    login: (credentials) => request.post('/auth/login', credentials),
    register: (userInfo) => request.post('/auth/register', userInfo),
    logout: () => request.post('/auth/logout'),
    getUserInfo: () => request.get('/auth/me'),
    refreshToken: () => request.post('/auth/refresh-token'),
  },

  gameRoles: {
    getList: () => request.get('/gamerole_list'),
    add: (roleData) => request.post('/gameroles', roleData),
    update: (roleId, roleData) => request.put(`/gameroles/${roleId}`, roleData),
    delete: (roleId) => request.delete(`/gameroles/${roleId}`),
    getDetail: (roleId) => request.get(`/gameroles/${roleId}`),
  },

  dailyTasks: {
    getList: (roleId) => request.get(`/daily-tasks?roleId=${roleId}`),
    getStatus: (roleId) => request.get(`/daily-tasks/status?roleId=${roleId}`),
    complete: (taskId, roleId) => request.post(`/daily-tasks/${taskId}/complete`, { roleId }),
    getHistory: (roleId, page = 1, limit = 20) => request.get(`/daily-tasks/history?roleId=${roleId}&page=${page}&limit=${limit}`),
  },

  user: {
    getProfile: () => request.get('/user/profile'),
    updateProfile: (profileData) => request.put('/user/profile', profileData),
    changePassword: (passwordData) => request.put('/user/password', passwordData),
    getStats: () => request.get('/user/stats'),
  },

  stats: {
    getOverview: () => request.get('/stats/overview'),
    getSystemStatus: () => request.get('/stats/system-status'),
    getTaskSummary: (days = 7) => request.get(`/stats/task-summary?days=${days}`),
    getRecentActivities: (limit = 10) => request.get(`/stats/recent-activities?limit=${limit}`),
  },

  batchScheduler: {
    getTypes: () => request.get('/batch-scheduler/types'),
    getList: () => request.get('/batch-scheduler'),
    getDetail: (id) => request.get(`/batch-scheduler/${id}`),
    create: (data) => request.post('/batch-scheduler', data),
    update: (id, data) => request.put(`/batch-scheduler/${id}`, data),
    delete: (id) => request.delete(`/batch-scheduler/${id}`),
    execute: (id) => request.post(`/batch-scheduler/${id}/execute`),
    getLogs: (id, limit = 50) => request.get(`/batch-scheduler/${id}/logs?limit=${limit}`),
  },

  batchSettings: {
    getAccountSettings: () => request.get('/batch-settings/account-settings'),
    saveAccountSettings: (accountId, data) => request.put(`/batch-settings/account-settings/${accountId}`, data),
    getTemplates: () => request.get('/batch-settings/templates'),
    createTemplate: (data) => request.post('/batch-settings/templates', data),
    updateTemplate: (id, data) => request.put(`/batch-settings/templates/${id}`, data),
    deleteTemplate: (id) => request.delete(`/batch-settings/templates/${id}`),
  },

  inviteCodes: {
    getList: () => request.get('/invite-codes'),
    create: (data) => request.post('/invite-codes', data),
    update: (id, data) => request.put(`/invite-codes/${id}`, data),
    delete: (id) => request.delete(`/invite-codes/${id}`),
  },

  adminUsers: {
    getList: () => request.get('/admin/users'),
    create: (data) => request.post('/admin/users', data),
    update: (id, data) => request.put(`/admin/users/${id}`, data),
    delete: (id) => request.delete(`/admin/users/${id}`),
  },
});

export { request };
export default api;

