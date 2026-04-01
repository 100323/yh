import axios from 'axios';
import { ElMessage } from 'element-plus';
import router from '@router';

const instance = axios.create({
  baseURL: '/api',
  timeout: 15000
});

const redirectToLogin = () => {
  if (router.currentRoute.value?.name === 'Login') {
    return;
  }

  router.replace({
    name: 'Login',
    query: router.currentRoute.value?.fullPath
      ? { redirect: router.currentRoute.value.fullPath }
      : undefined,
  }).catch(() => {});
};

const createApiError = ({ message, status = null, response = null }) => ({
  success: false,
  message,
  errorCode: status || 'NETWORK_ERROR',
  response,
});

instance.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

instance.interceptors.response.use(
  (response) => {
    const data = response.data;
    if (data?.success !== undefined) {
      return data;
    }

    return {
      success: true,
      data,
      message: 'success',
    };
  },
  (error) => {
    const { response } = error;
    
    if (response) {
      switch (response.status) {
        case 401:
          localStorage.removeItem('token');
          localStorage.removeItem('user');
          ElMessage.error(response.data?.error || '登录已过期，请重新登录');
          redirectToLogin();
          return Promise.reject(createApiError({
            status: 401,
            message: response.data?.error || '登录已过期，请重新登录',
            response,
          }));
        case 403:
          ElMessage.error(response.data?.error || '没有权限执行此操作');
          return Promise.reject(createApiError({
            status: 403,
            message: response.data?.error || '没有权限执行此操作',
            response,
          }));
        case 404:
          ElMessage.error('请求的资源不存在');
          return Promise.reject(createApiError({
            status: 404,
            message: '请求的资源不存在',
            response,
          }));
        case 500:
          ElMessage.error('服务器错误，请稍后重试');
          return Promise.reject(createApiError({
            status: 500,
            message: response.data?.error || '服务器错误，请稍后重试',
            response,
          }));
        default:
          ElMessage.error(response.data?.error || '请求失败');
          return Promise.reject(createApiError({
            status: response.status,
            message: response.data?.error || '请求失败',
            response,
          }));
      }
    } else {
      ElMessage.error('网络错误，请检查网络连接');
      return Promise.reject(createApiError({
        message: '网络错误，请检查网络连接',
      }));
    }
  }
);

export default instance;
