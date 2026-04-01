import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import api from '@/api';

export const useAuthStore = defineStore('auth', () => {
  const token = ref(localStorage.getItem('token') || null);
  const user = ref(JSON.parse(localStorage.getItem('user') || 'null'));

  const isAuthenticated = computed(() => !!token.value);

  async function login(username, password) {
    const res = await api.post('/auth/login', { username, password });
    
    if (res.success) {
      token.value = res.data.token;
      user.value = res.data.user;
      
      localStorage.setItem('token', res.data.token);
      localStorage.setItem('user', JSON.stringify(res.data.user));

      await fetchUser();
    }
    
    return res;
  }

  async function register(username, password, inviteCode) {
    const res = await api.post('/auth/register', { username, password, inviteCode });
    
    if (res.success) {
      token.value = res.data.token;
      user.value = res.data.user;
      
      localStorage.setItem('token', res.data.token);
      localStorage.setItem('user', JSON.stringify(res.data.user));

      await fetchUser();
    }
    
    return res;
  }

  async function fetchUser() {
    if (!token.value) return null;
    
    try {
      const res = await api.get('/auth/me');
      
      if (res.success) {
        user.value = res.data;
        localStorage.setItem('user', JSON.stringify(res.data));
      }
      
      return res.data;
    } catch {
      logout();
      return null;
    }
  }

  async function changePassword(oldPassword, newPassword) {
    const res = await api.post('/auth/change-password', { oldPassword, newPassword });
    return res;
  }

  function logout() {
    token.value = null;
    user.value = null;
    localStorage.removeItem('token');
    localStorage.removeItem('user');
  }

  function checkAuth() {
    const savedToken = localStorage.getItem('token');
    const savedUser = localStorage.getItem('user');
    
    if (savedToken && savedUser) {
      token.value = savedToken;
      user.value = JSON.parse(savedUser);
    }
  }

  return {
    token,
    user,
    isAuthenticated,
    login,
    register,
    fetchUser,
    changePassword,
    logout,
    checkAuth
  };
});
