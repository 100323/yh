<template>
  <div class="layout-container">
    <el-container>
      <el-aside width="220px" class="sidebar">
        <div class="logo">
          <img src="/icons/tom_king.jpg" alt="汤姆之王">
          <span>汤姆之王</span>
        </div>
        
        <el-menu
          :default-active="activeMenu"
          router
          background-color="#1e1e2d"
          text-color="#a2a3b8"
          active-text-color="#fff"
        >
          <el-menu-item
            v-for="item in visibleMenuItems"
            :key="item.index"
            :index="item.index"
          >
            <el-icon><component :is="item.icon" /></el-icon>
            <span>{{ item.label }}</span>
          </el-menu-item>
        </el-menu>
      </el-aside>
      
      <el-container>
        <el-header class="header">
          <div class="header-left">
            <el-button class="mobile-menu-trigger" text @click="mobileMenuOpen = true">
              <el-icon :size="20"><Operation /></el-icon>
            </el-button>
            <h2>{{ pageTitle }}</h2>
          </div>
          
          <div class="header-right">
            <el-badge
              v-if="gameWorkbenchStore.hasSessions"
              :value="gameWorkbenchStore.sessions.length"
              :max="9"
              class="workbench-badge"
            >
              <el-button class="workbench-toggle" text @click="toggleWorkbench">
                <el-icon :size="18"><Monitor /></el-icon>
                <span>游戏工作台</span>
              </el-button>
            </el-badge>

            <el-dropdown @command="handleCommand">
              <span class="user-info">
                <el-avatar :size="32" icon="UserFilled" />
                <span class="username">{{ authStore.user?.username }}</span>
                <el-icon><ArrowDown /></el-icon>
              </span>
              <template #dropdown>
                <el-dropdown-menu>
                  <el-dropdown-item command="profile">个人资料</el-dropdown-item>
                  <el-dropdown-item divided command="logout">退出登录</el-dropdown-item>
                </el-dropdown-menu>
              </template>
            </el-dropdown>
          </div>
        </el-header>
        
        <el-main class="main">
          <div class="page-outlet">
            <router-view v-slot="{ Component }">
              <template v-if="Component">
                <component :is="Component" />
              </template>
              <template v-else>
                <div style="background: red; color: white; padding: 20px;">
                  错误: 没有匹配的路由组件
                  <br>当前路径: {{ $route.path }}
                </div>
              </template>
            </router-view>
          </div>
        </el-main>
      </el-container>
    </el-container>

    <GameWorkbenchDock />

    <el-drawer
      v-model="mobileMenuOpen"
      class="mobile-drawer"
      direction="ltr"
      size="min(82vw, 280px)"
      :with-header="false"
    >
      <div class="mobile-drawer-content">
        <div class="mobile-drawer-logo">
          <img src="/icons/tom_king.jpg" alt="汤姆之王">
          <span>汤姆之王</span>
        </div>

        <el-menu
          :default-active="activeMenu"
          class="mobile-menu"
          @select="handleMobileMenuSelect"
        >
          <el-menu-item
            v-for="item in visibleMenuItems"
            :key="item.index"
            :index="item.index"
          >
            <el-icon><component :is="item.icon" /></el-icon>
            <span>{{ item.label }}</span>
          </el-menu-item>
        </el-menu>
      </div>
    </el-drawer>
  </div>
</template>

<script setup>
import { computed, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ElMessage, ElMessageBox } from 'element-plus';
import {
  ArrowDown,
  Clock,
  Document,
  HomeFilled,
  Key,
  Monitor,
  Operation,
  Setting,
  Ticket,
  Trophy,
  User,
  UserFilled
} from '@element-plus/icons-vue';
import { useAuthStore } from '@stores/auth';
import { useGameWorkbenchStore } from '@stores/gameWorkbench';
import GameWorkbenchDock from '@components/GameWorkbench/GameWorkbenchDock.vue';

const route = useRoute();
const router = useRouter();
const authStore = useAuthStore();
const gameWorkbenchStore = useGameWorkbenchStore();
const mobileMenuOpen = ref(false);

const activeMenu = computed(() => route.path);
const pageTitle = computed(() => route.meta?.title || '汤姆之王');
const isAdmin = computed(() => authStore.user?.role === 'admin');
const menuItems = [
  { index: '/', label: '首页', icon: HomeFilled },
  { index: '/tokens', label: '账号管理', icon: Key },
  { index: '/game-features', label: '游戏功能', icon: Trophy },
  { index: '/daily-tasks', label: '日常任务', icon: Clock },
  { index: '/tasks', label: '任务配置', icon: Setting },
  { index: '/logs', label: '执行日志', icon: Document },
  { index: '/user-management', label: '用户管理', icon: User, adminOnly: true },
  { index: '/invite-codes', label: '邀请码管理', icon: Ticket, adminOnly: true }
];
const visibleMenuItems = computed(() =>
  menuItems.filter((item) => !item.adminOnly || isAdmin.value)
);
const handleCommand = (command) => {
  if (command === 'profile') {
    router.push('/profile');
    return;
  }

  if (command === 'logout') {
    ElMessageBox.confirm('确定要退出登录吗？', '提示', { type: 'warning' })
      .then(() => {
        authStore.logout();
        router.push('/login');
        ElMessage.success('已退出登录');
      })
      .catch(() => {});
  }
};

const handleMobileMenuSelect = (index) => {
  mobileMenuOpen.value = false;
  if (route.path !== index) {
    router.push(index);
  }
};

const toggleWorkbench = () => {
  gameWorkbenchStore.toggleCollapsed();
};

watch(
  () => route.fullPath,
  () => {
    mobileMenuOpen.value = false;
  }
);
</script>

<style lang="scss" scoped>
.layout-container {
  min-height: 100vh;
  background: transparent;
  position: relative;

  &::before,
  &::after {
    content: '';
    position: fixed;
    inset: auto;
    pointer-events: none;
    z-index: 0;
    filter: blur(12px);
  }

  &::before {
    width: 320px;
    height: 320px;
    top: 80px;
    right: -120px;
    background: radial-gradient(circle, rgba(91, 124, 255, 0.22), transparent 68%);
  }

  &::after {
    width: 280px;
    height: 280px;
    bottom: 40px;
    left: -100px;
    background: radial-gradient(circle, rgba(124, 92, 255, 0.18), transparent 68%);
  }
}

.el-container {
  min-height: 100vh;
  position: relative;
  z-index: 1;
}

.sidebar {
  background: var(--bg-sidebar);
  border-right: 1px solid rgba(255, 255, 255, 0.08);
  box-shadow: 20px 0 48px rgba(7, 12, 24, 0.18);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  
  .logo {
    height: 74px;
    display: flex;
    align-items: center;
    justify-content: flex-start;
    gap: 12px;
    padding: 0 22px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.08);
    
    img {
      width: 38px;
      height: 38px;
      border-radius: 14px;
      box-shadow: 0 10px 24px rgba(91, 124, 255, 0.26);
    }
    
    span {
      color: white;
      font-size: 20px;
      font-weight: 700;
      letter-spacing: 0.08em;
    }
  }
  
  .el-menu {
    border-right: none;
    padding: 14px 12px 18px;
    background: transparent;
  }

  :deep(.el-menu-item) {
    height: 48px;
    margin-bottom: 8px;
    border-radius: 16px;
    color: rgba(226, 233, 255, 0.76);
    transition: all 0.2s ease;
    overflow: hidden;

    .el-icon {
      margin-right: 10px;
      font-size: 18px;
    }

    &:hover {
      color: #fff;
      background: rgba(255, 255, 255, 0.08);
    }
  }

  :deep(.el-menu-item.is-active) {
    color: #fff;
    background:
      linear-gradient(135deg, rgba(91, 124, 255, 0.9), rgba(124, 92, 255, 0.82));
    box-shadow: 0 16px 28px rgba(70, 92, 196, 0.28);
  }
}

.header {
  background: rgba(255, 255, 255, 0.76);
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 74px;
  margin: 14px 16px 0;
  padding: 12px 18px;
  border: 1px solid rgba(138, 151, 185, 0.16);
  border-radius: 24px;
  box-shadow: var(--shadow-glass);
  backdrop-filter: blur(18px);
  -webkit-backdrop-filter: blur(18px);
  position: sticky;
  top: 12px;
  z-index: 30;
  
  .header-left {
    display: flex;
    align-items: center;
    gap: 12px;
    min-width: 0;

    h2 {
      margin: 0;
      font-size: 20px;
      font-weight: 700;
      color: var(--text-primary);
      letter-spacing: 0.01em;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
  }
  
  .user-info {
    display: flex;
    align-items: center;
    gap: 8px;
    cursor: pointer;
    min-width: 0;
    padding: 8px 12px;
    border-radius: 999px;
    background: rgba(91, 124, 255, 0.08);
    transition: all 0.2s ease;
    
    .username {
      color: var(--text-primary);
      font-weight: 600;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      max-width: 180px;
    }

    &:hover {
      background: rgba(91, 124, 255, 0.14);
      box-shadow: inset 0 0 0 1px rgba(91, 124, 255, 0.14);
    }
  }
}

.workbench-toggle {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-height: 40px;
  padding: 0 12px;
  border-radius: 14px;
  color: var(--text-primary);
  background: rgba(255, 255, 255, 0.48);
  border: 1px solid rgba(120, 138, 177, 0.18);
  box-shadow: 0 10px 24px rgba(17, 27, 48, 0.08);

  &:hover {
    color: var(--primary-color);
    background: rgba(255, 255, 255, 0.72);
  }

  span {
    font-size: 13px;
    font-weight: 600;
  }
}

.workbench-badge {
  margin-right: 10px;
}

.mobile-menu-trigger {
  display: none;
  flex-shrink: 0;
}

.main {
  background: transparent;
  padding: 18px 16px 20px;
  min-width: 0;
  overflow-x: hidden;
}

.page-outlet {
  max-width: var(--page-max-width);
  margin: 0 auto;
}

.mobile-drawer-content {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--bg-sidebar);
}

.mobile-drawer-logo {
  height: 72px;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 0 20px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);

  img {
    width: 38px;
    height: 38px;
    border-radius: 14px;
  }

  span {
    color: white;
    font-size: 20px;
    font-weight: 700;
  }
}

.mobile-menu {
  flex: 1;
  border-right: none;
  padding: 14px 12px 24px;
}

:deep(.mobile-drawer) {
  .el-drawer {
    background: transparent;
  }

  .el-drawer__body {
    padding: 0;
    background: var(--bg-sidebar);
  }

  .el-menu {
    border-right: none;
    background: transparent;
  }

  .el-menu-item {
    height: 46px;
    margin-bottom: 8px;
    border-radius: 14px;
    color: rgba(226, 233, 255, 0.76);
  }

  .el-menu-item.is-active {
    color: #fff;
    background:
      linear-gradient(135deg, rgba(91, 124, 255, 0.9), rgba(124, 92, 255, 0.82));
  }
}

@media (max-width: 992px) {
  .sidebar {
    display: none;
  }

  .mobile-menu-trigger {
    display: inline-flex;
  }

  .header {
    margin: 12px 12px 0;
    padding: 12px 14px;
  }
}

@media (max-width: 768px) {
  .header {
    top: 8px;
    min-height: 66px;
    border-radius: 20px;

    .header-left h2 {
      font-size: 16px;
    }

    .user-info {
      gap: 6px;

      .username {
        max-width: 96px;
        font-size: 13px;
      }
    }
  }

  .main {
    padding: 14px 12px 18px;
  }
}

@media (max-width: 480px) {
  .header {
    margin: 8px 8px 0;
    padding: 10px 12px;

    .user-info {
      .username {
        display: none;
      }
    }
  }

  .main {
    padding: 12px 8px 16px;
  }
}
</style>
