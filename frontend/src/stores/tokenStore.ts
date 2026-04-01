import { useLocalStorage } from "@vueuse/core";
import { defineStore } from "pinia";
import { computed, ref } from "vue";

import { ProtoMsg } from "@/utils/bonProtocol";
import { gameLogger, tokenLogger, wsLogger } from "@/utils/logger";
import { XyzwWebSocketClient } from "@/utils/xyzwWebSocket";

import useIndexedDB from "@/hooks/useIndexedDB";
import { emitPlus } from "./events/index";
import api from "@/api";
import { useAuthStore } from "./auth";
import { createTokenCrudManager } from "./token/tokenCrud";
import { createTokenSelectionManager } from "./token/tokenSelection";
import { createTokenSyncManager } from "./token/tokenSync";
import { createTokenMaintenanceManager } from "./token/tokenMaintenance";
import { createTokenGroupsManager } from "./token/tokenGroups";
import { createTokenWsMessagingManager } from "./token/tokenWsMessaging";
import { createTokenWsLifecycleManager } from "./token/tokenWsLifecycle";
import { createTokenWsReadinessManager } from "./token/tokenWsReadiness";
import { createTokenMessageStateManager } from "./token/tokenMessageState";
import { createTokenBinPayloadManager } from "./token/tokenBinPayload";
import { parseBase64Token, validateToken } from "./token/tokenParsing";

const DEFAULT_ACCOUNT_AVATAR = "/icons/tom_king.jpg";
const DEFAULT_WS_BASE_URL = "wss://xxz-xyzw-new.hortorgames.com/agent";

const indexedDb = useIndexedDB();
const {
  isReady: indexedDbReady,
  getArrayBuffer,
  storeArrayBuffer,
  deleteArrayBuffer,
  clearAll,
} = indexedDb;

declare interface TokenData {
  id: string;
  name: string;
  token: string;
  wsUrl: string | null;
  server: string;
  createdAt?: string;
  lastUsed?: string;
  level?: number;
  profession?: string;
  isActive?: boolean;
  remark?: string;
  importMethod?: "manual" | "bin" | "url" | "wxQrcode";
  sourceUrl?: string | null;
  avatar?: string;
  upgradedToPermanent?: boolean;
  upgradedAt?: string;
  updatedAt?: string;
  storageKey?: string;
  legacyStorageKeys?: string[];
  [key: string]: any;
}

declare interface WebSocketConnection {
  status: "connecting" | "connected" | "disconnected" | "disconnecting" | "error";
  client: XyzwWebSocketClient | null;
  lastError: { timestamp: string; error: string; url?: string } | null;
  tokenId: string;
  sessionId: string;
  createdAt: string;
  connectedAt?: string | null;
  wsUrl?: string | null;
  actualToken?: string | null;
  lastMessageAt: string | null;
  lastMessage?: { timestamp: string; data: ProtoMsg; cmd?: string } | null;
  reconnectAttempts?: number;
  randomSeedSynced?: boolean;
  lastRandomSeedSource?: number | null;
  lastRandomSeed?: number | null;
  protocolWarmupAt?: string | null;
  dataBundleVersion?: string | number | null;
}

declare type WebCtx = Record<string, Partial<WebSocketConnection>>;

declare interface ConnectLock {
  tokenId: string;
  operation: "connect" | "disconnect";
  timestamp: number;
  sessionId: string;
}

declare type LockCtx = Record<string, Partial<ConnectLock>>;

declare interface CrossTabConnectionState {
  action: "connecting" | "connected" | "disconnecting" | "disconnected";
  sessionId: string;
  timestamp: number;
  url: string;
}

declare interface TokenGroup {
  id: string;
  name: string;
  color: string;
  tokenIds: string[];
  createdAt?: string;
  updatedAt?: string;
}

export const gameTokens = useLocalStorage<TokenData[]>("gameTokens", []);
export const hasTokens = computed(() => gameTokens.value.length > 0);
export const selectedTokenId = useLocalStorage<string>("selectedTokenId", "");
export const selectedToken = computed(() => {
  return gameTokens.value.find((token) => token.id === selectedTokenId.value) || null;
});
export const selectedRoleInfo = useLocalStorage<any>("selectedRoleInfo", null);
const activeConnections = useLocalStorage<Record<string, CrossTabConnectionState>>("activeConnections", {});
export const tokenGroups = useLocalStorage<TokenGroup[]>("tokenGroups", []);

let tokenStoreInitialized = false;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const waitForIndexedDBReady = async (timeoutMs = 5000) => {
  if (indexedDbReady.value) {
    return true;
  }

  const startedAt = Date.now();
  while (!indexedDbReady.value && Date.now() - startedAt < timeoutMs) {
    await sleep(100);
  }

  return indexedDbReady.value;
};

const normalizeStorageKey = (value: unknown) => String(value || "").trim();

const mergeLegacyStorageKeys = (...groups: unknown[][]) => {
  const merged = new Set<string>();
  groups.flat().forEach((item) => {
    const key = normalizeStorageKey(item);
    if (key) {
      merged.add(key);
    }
  });
  return [...merged];
};

const getErrorMessage = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

const getTokenFingerprint = (token: unknown) => {
  const raw = String(token ?? "").trim();
  if (!raw) {
    return "empty#0:0";
  }

  let hash = 0;
  for (let i = 0; i < raw.length; i += 1) {
    hash = ((hash << 5) - hash + raw.charCodeAt(i)) | 0;
  }

  const preview = raw.length > 24 ? `${raw.slice(0, 12)}...${raw.slice(-8)}` : raw;
  return `${preview}#${(hash >>> 0).toString(16)}:${raw.length}`;
};

const summarizeWsUrlForLogs = (wsUrl?: string | null) => {
  const raw = String(wsUrl ?? "").trim();
  if (!raw) {
    return null;
  }

  return raw.replace(/([?&]p=)[^&]+/i, "$1***");
};

const isLegacyWsUrl = (wsUrl?: string | null) => {
  const raw = String(wsUrl || "").trim();
  if (!raw) {
    return false;
  }

  return raw.includes("xxz-xyzw.hortorgames.com/agent") && !raw.includes("xxz-xyzw-new.hortorgames.com/agent");
};

const buildDefaultWsUrl = (token: string) => {
  const actualToken = String(token || "").trim();
  const url = new URL(DEFAULT_WS_BASE_URL);
  url.searchParams.set("p", actualToken);
  url.searchParams.set("e", "x");
  url.searchParams.set("lang", "chinese");
  return url.toString();
};

export const useTokenStore = defineStore("tokens", () => {
  const wsConnections = ref<WebCtx>({});
  const connectionLocks = ref<LockCtx>({});
  const gameData = ref<any>({
    roleInfo: null,
    legionInfo: null,
    commonActivityInfo: null,
    bossTowerInfo: null,
    evoTowerInfo: null,
    presetTeam: null,
    battleVersion: null as number | null,
    studyStatus: {
      isAnswering: false,
      questionCount: 0,
      answeredCount: 0,
      status: "",
      timestamp: null,
    },
    lastUpdated: null as string | null,
  });

  const selectedTokenRoleInfo = computed(() => gameData.value.roleInfo);
  const versionSensitiveCommands = new Set([
    "fight_startpvp",
    "fight_startareaarena",
    "legionwar_getdetails",
  ]);

  const getMaxGameAccounts = () => {
    const authStore = useAuthStore();
    const rawValue = authStore.user?.maxGameAccounts ?? authStore.user?.max_game_accounts ?? null;
    const value = Number(rawValue);
    return Number.isFinite(value) && value > 0 ? value : null;
  };

  const {
    loadStoredBinData,
    getBackendBinPayload,
  } = createTokenBinPayloadManager({
    waitForIndexedDBReady,
    getArrayBuffer,
    mergeLegacyStorageKeys,
  });

  const deleteBackendTokenAccount = async (tokenId: string) => {
    const accountId = String(tokenId || "").trim();
    if (!/^\d+$/.test(accountId) || !localStorage.getItem("token")) {
      return;
    }

    try {
      await api.delete(`/accounts/${accountId}`);
    } catch (error) {
      tokenLogger.warn(`删除后端账号失败 [${accountId}]`, error);
    }
  };

  let syncAccountToBackendRef: (tokenData: TokenData) => Promise<void> | void = async () => {};
  let createWebSocketConnectionRef: (tokenId: string, token: string, wsUrl?: string | null) => Promise<any> = async () => null;
  let syncProtocolStateRef: (tokenId: string, body: any) => void = () => {};
  let handleGameMessageRef: (tokenId: string, message: ProtoMsg, client: XyzwWebSocketClient) => void = () => {};
  let ensureWebSocketConnectedRef: (tokenId: string, waitMs?: number) => Promise<any> = async () => null;
  let ensureProtocolReadyRef: (tokenId: string, reason?: string) => Promise<unknown> = async () => {};

  const {
    normalizeImportMethod,
    addToken,
    updateToken,
    upsertToken,
    removeToken,
  } = createTokenCrudManager({
    gameTokens,
    selectedTokenId,
    wsConnections,
    defaultAvatar: DEFAULT_ACCOUNT_AVATAR,
    getMaxGameAccounts,
    normalizeStorageKey,
    mergeLegacyStorageKeys,
    syncAccountToBackend: (tokenData) => syncAccountToBackendRef(tokenData as TokenData),
    closeWebSocketConnection: (tokenId: string) => closeWebSocketConnection(tokenId),
    deleteArrayBuffer,
    deleteBackendTokenAccount,
  });

  const setBattleVersion = (version: number | null) => {
    gameData.value.battleVersion = version;
    gameData.value.lastUpdated = new Date().toISOString();
  };

  const getBattleVersion = () => gameData.value.battleVersion;

  const attemptTokenRefresh = async (tokenId: string, forceReconnect = false) => {
    const token = gameTokens.value.find((item) => item.id === tokenId);
    if (!token?.sourceUrl) {
      return null;
    }

    try {
      const sourceUrl = String(token.sourceUrl).trim();
      const isDirect = sourceUrl.startsWith(window.location.origin)
        || sourceUrl.startsWith("/")
        || sourceUrl.startsWith("http://localhost")
        || sourceUrl.startsWith("http://127.0.0.1");

      const response = isDirect
        ? await fetch(sourceUrl)
        : await fetch(sourceUrl, { mode: "cors" });

      if (!response.ok) {
        throw new Error(`refresh failed: ${response.status}`);
      }

      const nextToken = (await response.text()).trim();
      if (!nextToken) {
        throw new Error("empty token response");
      }

      updateToken(tokenId, {
        token: nextToken,
        updatedAt: new Date().toISOString(),
        lastUsed: new Date().toISOString(),
      });

      if (forceReconnect) {
        await createWebSocketConnectionRef(tokenId, nextToken, token.wsUrl || null);
      }

      return nextToken;
    } catch (error) {
      tokenLogger.warn(`自动刷新 Token 失败 [${tokenId}]`, error);
      return null;
    }
  };

  const lifecycleManager = createTokenWsLifecycleManager({
    wsConnections,
    connectionLocks,
    activeConnections,
    parseBase64Token,
    validateToken,
    buildDefaultWsUrl,
    handleGameMessage: (tokenId: string, message: ProtoMsg, client: XyzwWebSocketClient) => handleGameMessageRef(tokenId, message, client),
    attemptTokenRefresh,
    setBattleVersion,
    getErrorMessage,
    getTokenFingerprint,
    summarizeWsUrlForLogs,
    wsLogger,
  });

  const {
    currentSessionId,
    createWebSocketConnection,
    closeWebSocketConnection,
    validateConnectionUniqueness,
    connectionMonitor,
    setupCrossTabListener,
  } = lifecycleManager;

  createWebSocketConnectionRef = createWebSocketConnection;

  const {
    migrateTokenIdToBackendId,
    syncAccountToBackend,
    syncAccountsFromBackend,
  } = createTokenSyncManager({
    gameTokens,
    selectedTokenId,
    wsConnections,
    tokenGroups,
    defaultAvatar: DEFAULT_ACCOUNT_AVATAR,
    normalizeImportMethod,
    mergeLegacyStorageKeys,
    loadStoredBinData,
    storeArrayBuffer,
    deleteArrayBuffer,
    getBackendBinPayload,
    request: api,
    tokenLogger,
  });

  syncAccountToBackendRef = syncAccountToBackend;

  const { selectToken } = createTokenSelectionManager({
    gameTokens,
    selectedTokenId,
    wsConnections,
    updateToken,
    createWebSocketConnection,
    tokenLogger,
    wsLogger,
  });

  const {
    getWebSocketStatus,
    getWebSocketClient,
    sendMessage,
    sendMessageWithPromise,
  } = createTokenWsMessagingManager({
    wsConnections,
    ensureWebSocketConnected: (tokenId: string, waitMs?: number) => ensureWebSocketConnectedRef(tokenId, waitMs),
    ensureProtocolReady: (tokenId: string, reason?: string) => ensureProtocolReadyRef(tokenId, reason),
    versionSensitiveCommands,
    gameData,
    wsLogger,
    getErrorMessage,
  });

  const readinessManager = createTokenWsReadinessManager({
    wsConnections,
    gameTokens,
    gameData,
    createWebSocketConnection,
    isLegacyWsUrl,
    setBattleVersion,
    wsLogger,
    gameLogger,
    sendMessage,
    sendMessageWithPromise,
    getErrorMessage,
  });

  syncProtocolStateRef = readinessManager.syncProtocolState;
  ensureWebSocketConnectedRef = readinessManager.ensureWebSocketConnected;
  ensureProtocolReadyRef = readinessManager.ensureProtocolReady;

  const { handleGameMessage } = createTokenMessageStateManager({
    wsConnections,
    gameTokens,
    gameData,
    selectedRoleInfo,
    updateToken,
    syncProtocolState: (tokenId: string, body: any) => syncProtocolStateRef(tokenId, body),
    emitPlus,
    gameLogger,
  });

  handleGameMessageRef = handleGameMessage;

  const {
    sendHeartbeat,
    sendGetRoleInfo,
    sendGetDataBundleVersion,
    sendSignIn,
    sendClaimDailyReward,
    sendGetTeamInfo,
    sendMessageToWorld,
    sendMessageToLegion,
    sendGameMessage,
  } = readinessManager;

  const {
    exportTokens,
    importTokens,
    clearAllTokens,
    cleanExpiredTokens,
    upgradeTokenToPermanent,
  } = createTokenMaintenanceManager({
    gameTokens,
    selectedTokenId,
    wsConnections,
    clearAll,
    closeWebSocketConnection,
    removeToken,
    updateToken,
    getErrorMessage,
  });

  const {
    createTokenGroup,
    deleteTokenGroup,
    updateTokenGroup,
    addTokenToGroup,
    removeTokenFromGroup,
    getTokenGroups,
    getGroupTokenIds,
    getValidGroupTokenIds,
    cleanupInvalidTokens,
  } = createTokenGroupsManager({
    tokenGroups,
    gameTokens,
  });

  const importBase64Token = (tokenString: string, tokenMeta: Partial<TokenData> = {}) => {
    const parseResult = parseBase64Token(tokenString);
    if (!parseResult.success) {
      throw new Error(parseResult.error || "invalid token");
    }

    return addToken({
      name: tokenMeta.name || `账号${gameTokens.value.length + 1}`,
      token: tokenString,
      wsUrl: tokenMeta.wsUrl || null,
      server: tokenMeta.server || "",
      remark: tokenMeta.remark || "",
      importMethod: (tokenMeta.importMethod as any) || "manual",
      sourceUrl: tokenMeta.sourceUrl || null,
      avatar: tokenMeta.avatar || DEFAULT_ACCOUNT_AVATAR,
      ...tokenMeta,
    });
  };

  const setMessageListener = (listener: ((message: any) => void) | null) => {
    if (!selectedToken.value) {
      return false;
    }

    const connection = wsConnections.value[selectedToken.value.id];
    if (!connection?.client || typeof connection.client.setMessageListener !== "function") {
      return false;
    }

    connection.client.setMessageListener(listener);
    return true;
  };

  const setShowMsg = (show: boolean) => {
    if (!selectedToken.value) {
      return false;
    }

    const connection = wsConnections.value[selectedToken.value.id];
    if (!connection?.client || typeof connection.client.setShowMsg !== "function") {
      return false;
    }

    connection.client.setShowMsg(show);
    return true;
  };

  const getCurrentTowerLevel = () => {
    try {
      const roleInfo = gameData.value.roleInfo;
      const tower = roleInfo?.role?.tower;
      if (!tower) {
        return null;
      }

      return tower.level || tower.currentLevel || tower.floor || tower.stage || null;
    } catch (error) {
      gameLogger.error("获取塔层信息失败", error);
      return null;
    }
  };

  const getTowerInfo = () => {
    try {
      return gameData.value.roleInfo?.role?.tower || null;
    } catch (error) {
      gameLogger.error("获取塔信息失败", error);
      return null;
    }
  };

  const initTokenStore = async () => {
    if (!tokenStoreInitialized) {
      cleanExpiredTokens();
      connectionMonitor.startMonitoring();
      setupCrossTabListener();
      tokenStoreInitialized = true;
    }

    await syncAccountsFromBackend();
    tokenLogger.info("Token Store 初始化完成");
  };

  return {
    gameTokens,
    selectedTokenId,
    wsConnections,
    gameData,

    hasTokens,
    selectedToken,
    selectedTokenRoleInfo,

    addToken,
    upsertToken,
    updateToken,
    removeToken,
    selectToken,

    parseBase64Token,
    importBase64Token,

    createWebSocketConnection,
    closeWebSocketConnection,
    getWebSocketStatus,
    getWebSocketClient,
    sendMessage,
    sendMessageWithPromise,
    setMessageListener,
    setShowMsg,
    sendHeartbeat,
    sendGetRoleInfo,
    sendGetDataBundleVersion,
    sendSignIn,
    sendClaimDailyReward,
    sendGetTeamInfo,
    sendGameMessage,

    exportTokens,
    importTokens,
    clearAllTokens,
    cleanExpiredTokens,
    upgradeTokenToPermanent,
    initTokenStore,
    getBackendBinPayload,

    sendMessageToLegion,
    sendMessageToWorld,

    getCurrentTowerLevel,
    getTowerInfo,

    setBattleVersion,
    getBattleVersion,

    validateToken,
    debugToken: (tokenString: string) => {
      const parseResult = parseBase64Token(tokenString);
      console.log("Token 调试信息", {
        tokenString,
        parseResult,
        valid: parseResult.success ? validateToken(parseResult.data.actualToken) : false,
      });
      return parseResult;
    },

    validateConnectionUniqueness,
    connectionMonitor,
    currentSessionId: () => currentSessionId(),

    tokenGroups,
    createTokenGroup,
    deleteTokenGroup,
    updateTokenGroup,
    addTokenToGroup,
    removeTokenFromGroup,
    getTokenGroups,
    getGroupTokenIds,
    getValidGroupTokenIds,
    cleanupInvalidTokens,

    devTools: {
      getConnectionStats: () => connectionMonitor.getStats(),
      forceCleanup: () => connectionMonitor.forceCleanup(),
      showConnectionLocks: () => Object.keys(connectionLocks.value),
      showCrossTabStates: () => Object.keys(activeConnections.value),
      testDuplicateConnection: (tokenId: string) => {
        const token = gameTokens.value.find((item) => item.id === tokenId);
        if (token) {
          createWebSocketConnection(`${tokenId}_test`, token.token, token.wsUrl || null);
        }
      },
    },

    migrateTokenIdToBackendId,
    syncAccountToBackend,
    syncAccountsFromBackend,
  };
});






