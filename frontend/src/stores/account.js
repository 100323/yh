import { defineStore } from 'pinia';
import { ref } from 'vue';
import api from '@/api';

export const useAccountStore = defineStore('account', () => {
  const accounts = ref([]);
  const loading = ref(false);

  async function fetchAccounts() {
    loading.value = true;
    try {
      const res = await api.get('/accounts');
      if (res.success) {
        accounts.value = res.data;
      }
      return res;
    } finally {
      loading.value = false;
    }
  }

  async function addAccount(data) {
    const res = await api.post('/accounts', data);
    if (res.success) {
      await fetchAccounts();
    }
    return res;
  }

  async function updateAccount(id, data) {
    const res = await api.put(`/accounts/${id}`, data);
    if (res.success) {
      await fetchAccounts();
    }
    return res;
  }

  async function deleteAccount(id) {
    const res = await api.delete(`/accounts/${id}`);
    if (res.success) {
      accounts.value = accounts.value.filter(a => a.id !== id);
    }
    return res;
  }

  async function getToken(id) {
    const res = await api.get(`/accounts/${id}/token`);
    return res;
  }

  return {
    accounts,
    loading,
    fetchAccounts,
    addAccount,
    updateAccount,
    deleteAccount,
    getToken
  };
});
