import { computed, ref } from 'vue';
import { defineStore } from 'pinia';
import { openSlimGameWithAccount, prepareSlimGameLaunch } from '@/utils/slimGameLauncher';

export type GameWorkbenchSessionStatus = 'loading' | 'running' | 'error';
export type GameWorkbenchLayoutMode = 'single' | 'grid2' | 'grid4';

export interface GameWorkbenchSession {
  id: string;
  accountKey: string;
  name: string;
  server: string;
  status: GameWorkbenchSessionStatus;
  launchKey: string;
  launchUrl: string;
  account: Record<string, any>;
  createdAt: string;
  updatedAt: string;
}

function createSessionId() {
  return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `gw-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function toCleanString(value: unknown) {
  return String(value ?? '').trim();
}

function cloneLaunchAccount(account: Record<string, any>) {
  try {
    if (typeof structuredClone === 'function') {
      return structuredClone(account);
    }
  } catch {
    // ignore structuredClone failures
  }

  try {
    return JSON.parse(JSON.stringify(account || {}));
  } catch {
    return { ...(account || {}) };
  }
}

function getAccountKey(account: Record<string, any>) {
  return (
    toCleanString(account?.id) ||
    toCleanString(account?.accountId) ||
    toCleanString(account?.name) ||
    createSessionId()
  );
}

export const useGameWorkbenchStore = defineStore('gameWorkbench', () => {
  const sessions = ref<GameWorkbenchSession[]>([]);
  const activeSessionId = ref('');
  const collapsed = ref(true);
  const layoutMode = ref<GameWorkbenchLayoutMode>('single');

  const hasSessions = computed(() => sessions.value.length > 0);
  const activeSession = computed(() => {
    if (!sessions.value.length) return null;
    return sessions.value.find((session) => session.id === activeSessionId.value) || sessions.value[0];
  });

  const orderedSessions = computed(() => {
    if (!activeSession.value) return sessions.value;
    const currentId = activeSession.value.id;
    return [
      ...sessions.value.filter((session) => session.id === currentId),
      ...sessions.value.filter((session) => session.id !== currentId),
    ];
  });

  const openSession = (account: Record<string, any>) => {
    const accountSnapshot = cloneLaunchAccount(account);
    const accountKey = getAccountKey(accountSnapshot);
    const existing = sessions.value.find((session) => session.accountKey === accountKey);
    const sessionId = existing?.id || createSessionId();
    const prepared = prepareSlimGameLaunch(accountSnapshot, {
      sessionId,
      embed: true,
    });
    const now = new Date().toISOString();

    if (existing) {
      existing.name = toCleanString(accountSnapshot?.name) || existing.name;
      existing.server = toCleanString(accountSnapshot?.server) || existing.server;
      existing.status = 'loading';
      existing.launchKey = prepared.launchKey;
      existing.launchUrl = prepared.launchUrl;
      existing.account = accountSnapshot;
      existing.updatedAt = now;
      activeSessionId.value = existing.id;
      collapsed.value = false;
      return existing;
    }

    const nextSession: GameWorkbenchSession = {
      id: sessionId,
      accountKey,
      name: toCleanString(accountSnapshot?.name) || '未命名账号',
      server: toCleanString(accountSnapshot?.server),
      status: 'loading',
      launchKey: prepared.launchKey,
      launchUrl: prepared.launchUrl,
      account: accountSnapshot,
      createdAt: now,
      updatedAt: now,
    };

    sessions.value = [nextSession, ...sessions.value];
    activeSessionId.value = nextSession.id;
    collapsed.value = false;
    return nextSession;
  };

  const reloadSession = (sessionId: string) => {
    const session = sessions.value.find((item) => item.id === sessionId);
    if (!session) return null;

    const prepared = prepareSlimGameLaunch(cloneLaunchAccount(session.account), {
      sessionId: session.id,
      embed: true,
    });

    session.status = 'loading';
    session.launchKey = prepared.launchKey;
    session.launchUrl = prepared.launchUrl;
    session.updatedAt = new Date().toISOString();
    activeSessionId.value = session.id;
    collapsed.value = false;
    return session;
  };

  const popoutSession = (sessionId: string) => {
    const session = sessions.value.find((item) => item.id === sessionId);
    if (!session) return null;

    return openSlimGameWithAccount(cloneLaunchAccount(session.account), {
      sessionId: session.id,
      embed: false,
    });
  };

  const setActiveSession = (sessionId: string) => {
    const exists = sessions.value.some((session) => session.id === sessionId);
    if (!exists) return;
    activeSessionId.value = sessionId;
  };

  const setSessionStatus = (sessionId: string, status: GameWorkbenchSessionStatus) => {
    const session = sessions.value.find((item) => item.id === sessionId);
    if (!session) return;
    session.status = status;
    session.updatedAt = new Date().toISOString();
  };

  const setLayoutMode = (nextLayout: GameWorkbenchLayoutMode) => {
    layoutMode.value = nextLayout;
  };

  const toggleCollapsed = (nextState?: boolean) => {
    collapsed.value = typeof nextState === 'boolean' ? nextState : !collapsed.value;
  };

  const closeSession = (sessionId: string) => {
    sessions.value = sessions.value.filter((session) => session.id !== sessionId);
    if (!sessions.value.length) {
      activeSessionId.value = '';
      collapsed.value = true;
      return;
    }

    if (activeSessionId.value === sessionId) {
      activeSessionId.value = sessions.value[0].id;
    }
  };

  const closeAllSessions = () => {
    sessions.value = [];
    activeSessionId.value = '';
    collapsed.value = true;
  };

  return {
    sessions,
    activeSessionId,
    collapsed,
    layoutMode,
    hasSessions,
    activeSession,
    orderedSessions,
    openSession,
    reloadSession,
    popoutSession,
    setActiveSession,
    setSessionStatus,
    setLayoutMode,
    toggleCollapsed,
    closeSession,
    closeAllSessions,
  };
});
