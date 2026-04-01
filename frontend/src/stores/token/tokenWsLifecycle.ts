import { useLocalStorage } from '@vueuse/core';

import { g_utils, ProtoMsg } from '@/utils/bonProtocol';
import { XyzwWebSocketClient } from '@/utils/xyzwWebSocket';

interface TokenWsLifecycleOptions {
  wsConnections: any;
  connectionLocks: any;
  activeConnections: any;
  parseBase64Token: (token: string) => any;
  validateToken: (token: string) => boolean;
  buildDefaultWsUrl: (token: string) => string;
  handleGameMessage: (tokenId: string, message: ProtoMsg, client: XyzwWebSocketClient) => void;
  attemptTokenRefresh: (tokenId: string, forceReconnect?: boolean) => Promise<any>;
  setBattleVersion: (version: number | null) => void;
  getErrorMessage: (error: unknown) => string;
  getTokenFingerprint: (token: string) => string;
  summarizeWsUrlForLogs: (wsUrl: string | null | undefined) => string | null;
  wsLogger: any;
}

const generateSessionId = () => (
  `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
);

export function createTokenWsLifecycleManager({
  wsConnections,
  connectionLocks,
  activeConnections,
  parseBase64Token,
  validateToken,
  buildDefaultWsUrl,
  handleGameMessage,
  attemptTokenRefresh,
  setBattleVersion,
  getErrorMessage,
  getTokenFingerprint,
  summarizeWsUrlForLogs,
  wsLogger,
}: TokenWsLifecycleOptions) {
  const currentSessionId = generateSessionId();

  const acquireConnectionLock = async (tokenId: string, operation: 'connect' | 'disconnect' = 'connect') => {
    const lockKey = `${tokenId}_${operation}`;
    const locks = connectionLocks.value;

    if (locks[lockKey]) {
      wsLogger.debug(`等待连接锁释放: ${tokenId} (${operation})`);
      let attempts = 0;
      while (locks[lockKey] && attempts < 100) {
        await new Promise((resolve) => setTimeout(resolve, 100));
        attempts += 1;
      }

      if (locks[lockKey]) {
        wsLogger.warn(`连接锁等待超时: ${tokenId} (${operation})`);
        return false;
      }
    }

    locks[lockKey] = {
      tokenId,
      operation,
      timestamp: Date.now(),
      sessionId: currentSessionId,
    };
    wsLogger.connectionLock(tokenId, operation, true);
    return true;
  };

  const releaseConnectionLock = (tokenId: string, operation: 'connect' | 'disconnect' = 'connect') => {
    const lockKey = `${tokenId}_${operation}`;
    if (connectionLocks.value[lockKey]) {
      delete connectionLocks.value[lockKey];
      wsLogger.connectionLock(tokenId, operation, false);
    }
  };

  const updateCrossTabConnectionState = (tokenId: string, action: 'connecting' | 'connected' | 'disconnecting' | 'disconnected', sessionId: string = currentSessionId) => {
    const state = useLocalStorage(`ws_connection_${tokenId}`, {
      action,
      sessionId,
      timestamp: Date.now(),
      url: window.location.href,
    });

    if (activeConnections.value) {
      activeConnections.value[tokenId] = state.value;
    }
  };

  const checkCrossTabConnection = (tokenId: string) => {
    const storageKey = `ws_connection_${tokenId}`;
    try {
      const stored = localStorage.getItem(storageKey);
      if (stored) {
        const state = JSON.parse(stored);
        const isRecent = Date.now() - state.timestamp < 30000;
        const isDifferentSession = state.sessionId !== currentSessionId;
        if (isRecent && isDifferentSession && (state.action === 'connecting' || state.action === 'connected')) {
          wsLogger.debug(`检测到其他标签页的活跃连接: ${tokenId}`);
          return state;
        }
      }
    } catch (error) {
      wsLogger.warn('检查跨标签页连接状态失败:', error);
    }

    return null;
  };

  const closeWebSocketConnectionAsync = async (tokenId: string) => {
    const lockAcquired = await acquireConnectionLock(tokenId, 'disconnect');
    if (!lockAcquired) {
      wsLogger.warn(`无法获取断开连接锁: ${tokenId}`);
      return;
    }

    try {
      const connection = wsConnections.value[tokenId];
      if (connection && connection.client) {
        wsLogger.debug(`开始优雅关闭连接: ${tokenId}`);

        connection.status = 'disconnecting';
        updateCrossTabConnectionState(tokenId, 'disconnecting');

        const client = connection.client;
        if (!client) {
          delete wsConnections.value[tokenId];
          updateCrossTabConnectionState(tokenId, 'disconnected');
          return;
        }

        client.disconnect();

        await new Promise<void>((resolve) => {
          const checkDisconnected = () => {
            if (!client.connected) {
              resolve();
            } else {
              setTimeout(checkDisconnected, 100);
            }
          };
          setTimeout(resolve, 5000);
          checkDisconnected();
        });

        delete wsConnections.value[tokenId];
        updateCrossTabConnectionState(tokenId, 'disconnected');
        wsLogger.info(`连接已优雅关闭: ${tokenId}`);
      }
    } catch (error) {
      wsLogger.error(`关闭连接失败 [${tokenId}]:`, error);
    } finally {
      releaseConnectionLock(tokenId, 'disconnect');
    }
  };

  const createWebSocketConnection = async (tokenId: string, base64Token: string, customWsUrl: string | null = null) => {
    wsLogger.info(`开始创建连接: ${tokenId}`, {
      token: getTokenFingerprint(base64Token),
      ws: summarizeWsUrlForLogs(customWsUrl),
    });

    const lockAcquired = await acquireConnectionLock(tokenId, 'connect');
    if (!lockAcquired) {
      wsLogger.error(`无法获取连接锁: ${tokenId}`);
      return null;
    }

    try {
      const crossTabState = checkCrossTabConnection(tokenId);
      if (crossTabState) {
        wsLogger.debug(`跳过创建，其他标签页已有连接: ${tokenId}`);
        releaseConnectionLock(tokenId, 'connect');
        return null;
      }

      updateCrossTabConnectionState(tokenId, 'connecting');

      if (wsConnections.value[tokenId]) {
        wsLogger.debug(`优雅关闭现有连接: ${tokenId}`);
        await closeWebSocketConnectionAsync(tokenId);
      }

      const parseResult = parseBase64Token(base64Token);
      let actualToken;
      if (parseResult.success) {
        actualToken = parseResult.data.actualToken;
      } else if (validateToken(base64Token)) {
        actualToken = base64Token;
      } else {
        throw new Error(`Token无效: ${parseResult.error}`);
      }

      const wsUrl = customWsUrl || buildDefaultWsUrl(actualToken);
      wsLogger.debug(`连接使用Token指纹 [${tokenId}]`, {
        token: getTokenFingerprint(actualToken),
        ws: summarizeWsUrlForLogs(wsUrl),
      });

      const wsClient = new XyzwWebSocketClient({
        url: wsUrl,
        utils: g_utils,
        heartbeatMs: 5000,
      });

      wsConnections.value[tokenId] = {
        client: wsClient,
        status: 'connecting',
        tokenId,
        wsUrl,
        actualToken,
        sessionId: currentSessionId,
        connectedAt: null,
        lastMessage: null,
        lastError: null,
        reconnectAttempts: 0,
        randomSeedSynced: false,
        lastRandomSeedSource: null,
        lastRandomSeed: null,
        protocolWarmupAt: null,
        dataBundleVersion: null,
      };

      wsClient.onConnect = () => {
        wsLogger.wsConnect(tokenId);
        if (wsConnections.value[tokenId]) {
          wsConnections.value[tokenId].status = 'connected';
          wsConnections.value[tokenId].connectedAt = new Date().toISOString();
          wsConnections.value[tokenId].reconnectAttempts = 0;
          wsConnections.value[tokenId].randomSeedSynced = false;
          wsConnections.value[tokenId].lastRandomSeedSource = null;
          wsConnections.value[tokenId].lastRandomSeed = null;
          wsConnections.value[tokenId].protocolWarmupAt = null;
          wsConnections.value[tokenId].dataBundleVersion = null;
        }
        updateCrossTabConnectionState(tokenId, 'connected');
        releaseConnectionLock(tokenId, 'connect');
        localStorage.removeItem('xyzw_chat_msg_list');

        setTimeout(() => {
          try {
            wsClient.send('role_getroleinfo');
          } catch (error) {
            wsLogger.warn(`初始化角色信息请求失败 [${tokenId}]`, error);
          }

          setTimeout(() => {
            try {
              wsClient.send('system_getdatabundlever');
            } catch (error) {
              wsLogger.warn(`初始化数据包版本请求失败 [${tokenId}]`, error);
            }
          }, 200);

          setTimeout(async () => {
            try {
              const levelInfo = await wsClient.sendWithPromise('fight_startlevel', {}, 5000);
              const version = Number(levelInfo?.battleData?.version || levelInfo?.battleVersion || 0);
              if (Number.isFinite(version) && version > 0) {
                setBattleVersion(version);
                wsLogger.info(`初始化 battleVersion 成功 [${tokenId}]: ${version}`);
              }
            } catch (error) {
              wsLogger.warn(`初始化 battleVersion 失败 [${tokenId}]`, error);
            }
          }, 400);
        }, 300);
      };

      wsClient.onDisconnect = async (event: CloseEvent) => {
        const reason = event.code === 1006 ? '异常断开' : event.reason || '';
        wsLogger.wsDisconnect(tokenId, reason);
        wsLogger.warn(`WebSocket断开详情 [${tokenId}]`, {
          code: event.code,
          reason,
          ws: summarizeWsUrlForLogs(wsUrl),
        });

        if (wsConnections.value[tokenId]) {
          const connection = wsConnections.value[tokenId];
          connection.status = 'disconnected';
          connection.randomSeedSynced = false;

          if (event.code === 1006 && !connection.connectedAt) {
            wsLogger.warn(`检测到握手失败(1006)，尝试刷新Token [${tokenId}]`);
            await attemptTokenRefresh(tokenId, true);
          }
        }

        updateCrossTabConnectionState(tokenId, 'disconnected');
      };

      wsClient.onError = (error: unknown) => {
        wsLogger.wsError(tokenId, error);
        wsLogger.error(`WebSocket错误详情 [${tokenId}]`, {
          error: getErrorMessage(error),
          ws: summarizeWsUrlForLogs(wsUrl),
          token: getTokenFingerprint(actualToken),
        });
        if (wsConnections.value[tokenId]) {
          wsConnections.value[tokenId].status = 'error';
          wsConnections.value[tokenId].lastError = {
            timestamp: new Date().toISOString(),
            error: String(error),
            url: wsUrl,
          };
        }
        releaseConnectionLock(tokenId, 'connect');
      };

      wsClient.setMessageListener((message: ProtoMsg) => {
        const cmd = message?.cmd || 'unknown';
        wsLogger.wsMessage(tokenId, cmd, true);

        if (wsConnections.value[tokenId]) {
          wsConnections.value[tokenId].lastMessage = {
            timestamp: new Date().toISOString(),
            data: message,
            cmd: message?.cmd,
          };
          handleGameMessage(tokenId, message, wsClient);
        }
      });

      wsClient.init();
      wsLogger.verbose(`WebSocket客户端创建成功: ${tokenId}`);
      return wsClient;
    } catch (error) {
      wsLogger.error(`创建连接失败 [${tokenId}]:`, error);
      updateCrossTabConnectionState(tokenId, 'disconnected');
      releaseConnectionLock(tokenId, 'connect');
      return null;
    }
  };

  const closeWebSocketConnection = (tokenId: string) => {
    closeWebSocketConnectionAsync(tokenId).catch((error) => {
      wsLogger.error(`关闭连接异步操作失败 [${tokenId}]:`, error);
    });
  };

  const validateConnectionUniqueness = (tokenId: string) => {
    const connections = Object.values(wsConnections.value).filter(
      (connection: any) => connection.tokenId === tokenId && (connection.status === 'connecting' || connection.status === 'connected'),
    );

    if (connections.length > 1) {
      wsLogger.warn(`检测到重复连接: ${tokenId}, 连接数: ${connections.length}`);
      const sortedConnections = connections.sort(
        (a: any, b: any) => new Date(b.connectedAt || 0).getTime() - new Date(a.connectedAt || 0).getTime(),
      );

      for (let index = 1; index < sortedConnections.length; index += 1) {
        const oldConnection: any = sortedConnections[index];
        if (oldConnection.tokenId) {
          wsLogger.debug(`关闭重复连接: ${tokenId}`);
          closeWebSocketConnectionAsync(oldConnection.tokenId);
        }
      }

      return false;
    }

    return true;
  };

  const connectionMonitor = {
    startMonitoring: () => {
      setInterval(() => {
        const now = Date.now();

        Object.entries(wsConnections.value).forEach(([tokenId, connection]: any) => {
          const lastActivity = connection.lastMessage?.timestamp || connection.connectedAt;
          if (lastActivity) {
            const timeSinceActivity = now - new Date(lastActivity).getTime();
            if (timeSinceActivity > 30000 && connection.status === 'connected') {
              wsLogger.warn(`检测到连接可能已断开: ${tokenId}`);
              if (connection.client) {
                connection.client.sendHeartbeat();
              }
            }
          }
        });

        Object.entries(connectionLocks.value).forEach(([lockKey, lock]: any) => {
          if (now - (lock.timestamp ?? 0) > 600000) {
            delete connectionLocks.value[lockKey];
            wsLogger.debug(`清理过期连接锁: ${lockKey}`);
          }
        });

        Object.entries(activeConnections.value).forEach(([tokenId, state]: any) => {
          if (now - state.timestamp > 300000) {
            wsLogger.debug(`清理过期跨标签页状态: ${tokenId}`);
            delete activeConnections.value[tokenId];
            localStorage.removeItem(`ws_connection_${tokenId}`);
          }
        });
      }, 10000);
    },

    getStats: () => {
      const duplicateTokens: string[] = [];
      const stats: Record<string, any> = {
        totalConnections: Object.keys(wsConnections.value).length,
        connectedCount: 0,
        connectingCount: 0,
        disconnectedCount: 0,
        errorCount: 0,
        duplicateTokens,
        activeLocks: Object.keys(connectionLocks.value).length,
        crossTabStates: Object.keys(activeConnections.value).length,
      };

      const tokenCounts = new Map();
      Object.values(wsConnections.value).forEach((connection: any) => {
        const statusKey = `${connection.status}Count`;
        if (statusKey in stats) {
          stats[statusKey] += 1;
        }

        const count = tokenCounts.get(connection.tokenId) || 0;
        tokenCounts.set(connection.tokenId, count + 1);
        if (count > 0) {
          stats.duplicateTokens.push(connection.tokenId);
        }
      });

      return stats;
    },

    forceCleanup: async () => {
      wsLogger.info('开始强制清理所有连接...');
      const cleanupPromises = Object.keys(wsConnections.value).map((tokenId) => closeWebSocketConnectionAsync(tokenId));
      await Promise.all(cleanupPromises);

      Object.keys(localStorage).forEach((key) => {
        if (key.startsWith('ws_connection_')) {
          localStorage.removeItem(key);
        }
      });

      wsLogger.info('强制清理完成');
    },
  };

  const setupCrossTabListener = () => {
    window.addEventListener('storage', (event) => {
      if (event.key?.startsWith('ws_connection_')) {
        const tokenId = event.key.replace('ws_connection_', '');
        wsLogger.debug(`检测到跨标签页连接状态变化: ${tokenId}`, event.newValue);

        if (event.newValue) {
          try {
            const newState = JSON.parse(event.newValue);
            const localConnection = wsConnections.value[tokenId];
            if (newState.action === 'connected' && newState.sessionId !== currentSessionId && localConnection?.status === 'connected') {
              wsLogger.info(`检测到其他标签页已连接同一token，关闭本地连接: ${tokenId}`);
              closeWebSocketConnectionAsync(tokenId);
            }
          } catch (error) {
            wsLogger.warn('解析跨标签页状态失败:', error);
          }
        }
      }
    });
  };

  return {
    currentSessionId: () => currentSessionId,
    acquireConnectionLock,
    releaseConnectionLock,
    updateCrossTabConnectionState,
    checkCrossTabConnection,
    createWebSocketConnection,
    closeWebSocketConnectionAsync,
    closeWebSocketConnection,
    validateConnectionUniqueness,
    connectionMonitor,
    setupCrossTabListener,
  };
}
