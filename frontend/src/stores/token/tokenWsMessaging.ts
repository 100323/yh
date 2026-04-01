import type { Ref } from 'vue';

interface WebSocketConnectionLike {
  status?: string;
  client?: any;
}

interface TokenWsMessagingOptions {
  wsConnections: Ref<Record<string, WebSocketConnectionLike>>;
  ensureWebSocketConnected: (tokenId: string, waitMs?: number) => Promise<any>;
  ensureProtocolReady: (tokenId: string, cmd?: string) => Promise<unknown>;
  versionSensitiveCommands: Set<string>;
  gameData: Ref<{ battleVersion?: number | null }>;
  wsLogger: {
    error: (...args: any[]) => void;
    info: (...args: any[]) => void;
    wsMessage: (...args: any[]) => void;
  };
  getErrorMessage: (error: unknown) => string;
}

export function createTokenWsMessagingManager({
  wsConnections,
  ensureWebSocketConnected,
  ensureProtocolReady,
  versionSensitiveCommands,
  gameData,
  wsLogger,
  getErrorMessage,
}: TokenWsMessagingOptions) {
  const getWebSocketStatus = (tokenId: string) => (
    wsConnections.value[tokenId]?.status || 'disconnected'
  );

  const getWebSocketClient = (tokenId: string) => (
    wsConnections.value[tokenId]?.client || null
  );

  const sendMessage = (
    tokenId: string,
    cmd: string,
    params = {},
    options = {},
  ) => {
    const connection = wsConnections.value[tokenId];
    if (!connection || connection.status !== 'connected') {
      wsLogger.error(`WebSocket未连接，无法发送消息 [${tokenId}]`);
      return false;
    }

    try {
      const client = connection.client;
      if (!client) {
        wsLogger.error(`WebSocket客户端不存在 [${tokenId}]`);
        return false;
      }

      client.send(cmd, params, options);
      wsLogger.wsMessage(tokenId, cmd, false);
      return true;
    } catch (error) {
      wsLogger.error(`发送失败 [${tokenId}] ${cmd}:`, getErrorMessage(error));
      return false;
    }
  };

  const sendMessageWithPromise = async (
    tokenId: string,
    cmd: string,
    params = {},
    timeout = 5000,
  ) => {
    let connection = wsConnections.value[tokenId];
    if (!connection || connection.status !== 'connected' || !connection.client) {
      connection = await ensureWebSocketConnected(tokenId);
    }
    if (!connection || connection.status !== 'connected') {
      return Promise.reject(new Error(`WebSocket未连接 [${tokenId}]`));
    }

    const client = connection.client;
    if (!client) {
      return Promise.reject(new Error(`WebSocket客户端不存在 [${tokenId}]`));
    }

    if (versionSensitiveCommands.has(cmd)) {
      await ensureProtocolReady(tokenId, cmd);
    }

    if (cmd === 'fight_startpvp' || cmd === 'fight_startareaarena') {
      const normalizedTargetId = Number((params as any)?.targetId);
      if (Number.isFinite(normalizedTargetId) && normalizedTargetId > 0) {
        params = { ...params, targetId: normalizedTargetId };
      }
    }

    const versionedBattleCommands = [
      'fight_starttower',
      'fight_startboss',
      'fight_startlegionboss',
      'fight_startdungeon',
    ];
    if (versionedBattleCommands.includes(cmd)) {
      const battleVersion = gameData.value.battleVersion;
      params = { battleVersion, ...params };
      wsLogger.info(`⚔️ [战斗命令] 注入 battleVersion: ${battleVersion} [${cmd}]`);
    }

    try {
      const result = await client.sendWithPromise(cmd, params, timeout);

      if (cmd === 'fight_starttower') {
        wsLogger.info(`🗼 [咸将塔] 收到爬塔响应 [${tokenId}]:`, result);
      }

      return result;
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      const shouldRetryWithBattleVersion = (
        (cmd === 'fight_startpvp' || cmd === 'fight_startareaarena')
        && !Object.prototype.hasOwnProperty.call(params, 'battleVersion')
        && errorMessage.includes('200750')
        && Number(gameData.value.battleVersion) > 0
      );

      if (shouldRetryWithBattleVersion) {
        const retryParams = {
          ...params,
          battleVersion: Number(gameData.value.battleVersion),
        };
        wsLogger.info(`⚔️ [战斗命令] 检测到版本错误，重试并注入 battleVersion: ${retryParams.battleVersion} [${cmd}]`);
        return client.sendWithPromise(cmd, retryParams, timeout);
      }

      if (cmd === 'fight_starttower') {
        wsLogger.error(`🗼 [咸将塔] 爬塔请求失败 [${tokenId}]:`, errorMessage);
      }

      throw error;
    }
  };

  return {
    getWebSocketStatus,
    getWebSocketClient,
    sendMessage,
    sendMessageWithPromise,
  };
}
