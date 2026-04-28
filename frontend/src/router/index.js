import { createRouter, createWebHistory } from 'vue-router';
import { useAuthStore } from '@stores/auth';

import MainLayout from '@layouts/MainLayout.vue';

const routes = [
  {
    path: '/login',
    name: 'Login',
    component: () => import('@views/Login.vue'),
    meta: { title: '登录', public: true }
  },
  {
    path: '/',
    component: MainLayout,
    children: [
      {
        path: '',
        name: 'Home',
        component: () => import('@views/Home.vue'),
        meta: { title: '首页' }
      },
      {
        path: 'tokens',
        name: 'Tokens',
        component: () => import('@views/TokenImport/index.vue'),
        meta: { title: '账号管理', requiresNaive: true, requiresArco: true }
      },
      {
        path: 'game-features',
        name: 'GameFeatures',
        component: () => import('@views/GameFeatures.vue'),
        meta: { title: '游戏功能', requiresNaive: true, requiresArco: true }
      },
      {
        path: 'daily-tasks',
        name: 'DailyTasks',
        component: () => import('@views/DailyTasks.vue'),
        meta: { title: '日常任务' }
      },
      {
        path: 'batch-daily-tasks',
        name: 'BatchDailyTasks',
        redirect: '/tasks'
      },
      {
        path: 'legion-war',
        name: 'LegionWar',
        component: () => import('@views/LegionWar.vue'),
        meta: { title: 'Legion War', requiresNaive: true }
      },
      {
        path: 'tasks',
        name: 'Tasks',
        component: () => import('@views/Tasks.vue'),
        meta: { title: '任务配置', requiresNaive: true }
      },
      {
        path: 'logs',
        name: 'Logs',
        component: () => import('@views/Logs.vue'),
        meta: { title: '执行日志' }
      },
      {
        path: 'profile',
        name: 'Profile',
        component: () => import('@views/Profile.vue'),
        meta: { title: '修改密码' }
      },
      {
        path: 'changelog',
        name: 'Changelog',
        component: () => import('@views/Changelog.vue'),
        meta: { title: '更新日志' }
      },
      {
        path: 'invite-codes',
        name: 'InviteCodes',
        component: () => import('@views/InviteCodes.vue'),
        meta: { title: '邀请码管理', requiresAdmin: true }
      },
      {
        path: 'activation-codes',
        name: 'ActivationCodes',
        component: () => import('@views/ActivationCodes.vue'),
        meta: { title: '激活码管理', requiresAdmin: true }
      },
      {
        path: 'user-management',
        name: 'UserManagement',
        component: () => import('@views/UserManagement.vue'),
        meta: { title: '用户管理', requiresAdmin: true }
      }
    ]
  },
  {
    path: '/admin/batch-daily-tasks',
    redirect: '/tasks'
  },
  {
    path: '/:pathMatch(.*)*',
    name: 'NotFound',
    component: () => import('@views/NotFound.vue'),
    meta: { title: '404' }
  }
];

const router = createRouter({
  history: createWebHistory(),
  routes
});

router.beforeEach((to, from, next) => {
  const authStore = useAuthStore();
  authStore.checkAuth();

  if (!to.meta.public && !authStore.isAuthenticated) {
    next({ name: 'Login', query: { redirect: to.fullPath } });
  } else if (to.meta.requiresAdmin && authStore.user?.role !== 'admin') {
    next({ name: 'Home' });
  } else if (to.name === 'Login' && authStore.isAuthenticated) {
    next({ name: 'Home' });
  } else {
    next();
  }
});

export default router;
