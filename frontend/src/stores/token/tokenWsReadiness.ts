import type { Ref } from 'vue';

interface TokenWsReadinessOptions {
  wsConnections: Ref<Record<string, any>>;
  gameTokens: Ref<Array<{ id: string; token: string; wsUrl?: string | null }>>;
  gameData: Ref<any>;
  createWebSocketConnection: (tokenId: string, token: string, wsUrl?: string | null) => Promise<any>;
  isLegacyWsUrl: (wsUrl: string | null | undefined) => boolean;
  setBattleVersion: (version: number | null) => void;
  wsLogger: any;
  gameLogger: any;
  sendMessage: (tokenId: string, cmd: string, params?: any, options?: any) => any;
  sendMessageWithPromise: (tokenId: string, cmd: string, params?: any, timeout?: number) => Promise<any>;
  getErrorMessage: (error: unknown) => string;
}

export function createTokenWsReadinessManager({
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
}: TokenWsReadinessOptions) {
  const protocolWarmupPromises = new Map<string, Promise<void>>();

  const syncProtocolState = (tokenId: string, body: any) => {
    if (!body) {
      return;
    }

    const incomingBattleVersion = Number(
      body?.battleData?.version
        || body?.battleVersion
        || body?.battle_data?.version
        || 0,
    );
    if (Number.isFinite(incomingBattleVersion) && incomingBattleVersion > 0) {
      if (gameData.value.battleVersion !== incomingBattleVersion) {
        setBattleVersion(incomingBattleVersion);
        wsLogger.debug(`同步 battleVersion [${tokenId}]: ${incomingBattleVersion}`);
      }
    }

    const dataBundleVersion = body?.dataBundleVer ?? body?.bundleVers ?? null;
    if (dataBundleVersion !== null && wsConnections.value[tokenId]) {
      wsConnections.value[tokenId].dataBundleVersion = dataBundleVersion;
    }
  };

  const ensureWebSocketConnected = async (tokenId: string, waitMs = 6000) => {
    let connection = wsConnections.value[tokenId];
    const token = gameTokens.value.find((item) => item.id === tokenId);

    if (connection?.status === 'connected' && connection.client) {
      const shouldReconnectLegacyUrl = !token?.wsUrl && isLegacyWsUrl(connection.wsUrl);
      if (!shouldReconnectLegacyUrl) {
        return connection;
      }
      wsLogger.info(`检测到旧版连接参数，准备重连 [${tokenId}]`);
      await createWebSocketConnection(tokenId, token?.token || '', token?.wsUrl || null);
      connection = wsConnections.value[tokenId];
    }

    if (!token) {
      return null;
    }

    if (!connection || connection.status === 'disconnected' || connection.status === 'error') {
      wsLogger.info(`检测到连接断开，尝试自动重连 [${tokenId}]`);
      await createWebSocketConnection(tokenId, token.token, token.wsUrl || null);
    }

    const startedAt = Date.now();
    while (Date.now() - startedAt < waitMs) {
      connection = wsConnections.value[tokenId];
      if (connection?.status === 'connected' && connection.client) {
        return connection;
      }
      if (connection?.status === 'error') {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 200));
    }

    return null;
  };

  const ensureProtocolReady = async (tokenId: string, reason = '') => {
    const connection = wsConnections.value[tokenId];
    const lastWarmupAt = connection?.protocolWarmupAt
      ? new Date(connection.protocolWarmupAt).getTime()
      : 0;
    const now = Date.now();
    const hasBattleVersion = Number.isFinite(Number(gameData.value.battleVersion))
      && Number(gameData.value.battleVersion) > 0;

    if (lastWarmupAt && now - lastWarmupAt < 30000 && hasBattleVersion) {
      return;
    }

    if (protocolWarmupPromises.has(tokenId)) {
      return protocolWarmupPromises.get(tokenId);
    }

    const warmupPromise = (async () => {
      const readyConnection = await ensureWebSocketConnected(tokenId);
      if (!readyConnection?.client) {
        throw new Error(`协议预热失败，WebSocket未连接 [${tokenId}]`);
      }

      const client = readyConnection.client;
      wsLogger.info(`开始协议预热 [${tokenId}]${reason ? `: ${reason}` : ''}`);

      const steps = ['role_getroleinfo', 'system_getdatabundlever', 'fight_startlevel'];
      let completedStep = false;

      for (const step of steps) {
        try {
          const result = await client.sendWithPromise(step, {}, 5000);
          syncProtocolState(tokenId, result);
          completedStep = true;
        } catch (error) {
          wsLogger.warn(`协议预热步骤失败 [${tokenId}] ${step}:`, error);
        }
      }

      if (completedStep && wsConnections.value[tokenId]) {
        wsConnections.value[tokenId].protocolWarmupAt = new Date().toISOString();
      }
    })();

    protocolWarmupPromises.set(tokenId, warmupPromise);
    try {
      await warmupPromise;
    } finally {
      protocolWarmupPromises.delete(tokenId);
    }
  };

  const sendHeartbeat = (tokenId: string) => sendMessage(tokenId, 'heart_beat');

  const sendGetRoleInfo = async (tokenId: string, params = {}, retryCount = 0) => {
    try {
      const timeout = 15000;
      const roleInfo = await sendMessageWithPromise(tokenId, 'role_getroleinfo', params, timeout);

      if (roleInfo) {
        gameData.value.roleInfo = roleInfo;
        gameData.value.lastUpdated = new Date().toISOString();
        gameLogger.verbose('角色信息已通过 Promise 更新');
      }

      return roleInfo;
    } catch (error) {
      gameLogger.error(`获取角色信息失败 [${tokenId}]:`, getErrorMessage(error));
      if (retryCount < 2) {
        gameLogger.info(`正在重试获取角色信息 [${tokenId}]，重试次数: ${retryCount + 1}`);
        await new Promise((resolve) => setTimeout(resolve, 1000));
        return sendGetRoleInfo(tokenId, params, retryCount + 1);
      }
      throw error;
    }
  };

  const sendGetDataBundleVersion = (tokenId: string, params = {}) => (
    sendMessageWithPromise(tokenId, 'system_getdatabundlever', params)
  );

  const sendSignIn = (tokenId: string) => sendMessageWithPromise(tokenId, 'system_signinreward');

  const sendClaimDailyReward = (tokenId: string, rewardId = 0) => (
    sendMessageWithPromise(tokenId, 'task_claimdailyreward', { rewardId })
  );

  const sendGetTeamInfo = (tokenId: string, params = {}) => (
    sendMessageWithPromise(tokenId, 'presetteam_getinfo', params)
  );

  const sendMessageToWorld = (tokenId: string, message: string) => (
    sendMessageWithPromise(tokenId, 'system_sendchatmessage', { channel: 1, emojiId: 0, extra: null, msg: message, msgType: 1 })
  );

  const sendMessageToLegion = (tokenId: string, message: string) => (
    sendMessageWithPromise(tokenId, 'system_sendchatmessage', { channel: 2, emojiId: 0, extra: null, msg: message, msgType: 1 })
  );

  const sendGameMessage = (
    tokenId: string,
    cmd: string,
    params = {},
    options: { usePromise?: boolean; timeout?: number; [key: string]: any } = {},
  ) => {
    if (options.usePromise) {
      return sendMessageWithPromise(tokenId, cmd, params, options.timeout);
    }
    return sendMessage(tokenId, cmd, params, options);
  };

  return {
    syncProtocolState,
    ensureWebSocketConnected,
    ensureProtocolReady,
    sendHeartbeat,
    sendGetRoleInfo,
    sendGetDataBundleVersion,
    sendSignIn,
    sendClaimDailyReward,
    sendGetTeamInfo,
    sendMessageToWorld,
    sendMessageToLegion,
    sendGameMessage,
  };
}
