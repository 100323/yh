import type { Ref } from 'vue';

interface TokenSelectionToken {
  id: string;
  token: string;
  wsUrl?: string | null;
  [key: string]: any;
}

interface TokenSelectionManagerOptions {
  gameTokens: Ref<TokenSelectionToken[]>;
  selectedTokenId: Ref<any>;
  wsConnections: Ref<Record<string, any>>;
  updateToken: (tokenId: string, updates: Partial<TokenSelectionToken>) => boolean;
  createWebSocketConnection: (tokenId: string, token: string, wsUrl?: string | null) => unknown;
  tokenLogger: { debug: (...args: any[]) => void };
  wsLogger: { info: (...args: any[]) => void; debug: (...args: any[]) => void };
}

export function createTokenSelectionManager({
  gameTokens,
  selectedTokenId,
  wsConnections,
  updateToken,
  createWebSocketConnection,
  tokenLogger,
  wsLogger,
}: TokenSelectionManagerOptions) {
  const selectToken = (tokenId: string, forceReconnect = false) => {
    const token = gameTokens.value.find((item) => item.id === tokenId);
    if (!token) {
      return null;
    }

    const isAlreadySelected = selectedTokenId.value === tokenId;
    const existingConnection = wsConnections.value[tokenId];
    const isConnected = existingConnection?.status === 'connected';
    const isConnecting = existingConnection?.status === 'connecting';

    tokenLogger.debug(`选择Token: ${tokenId}`, {
      isAlreadySelected,
      isConnected,
      isConnecting,
      forceReconnect,
    });

    selectedTokenId.value = tokenId;
    updateToken(tokenId, { lastUsed: new Date().toISOString() });

    if (isConnected) {
      return token;
    }

    const shouldCreateConnection = (
      forceReconnect
      || !isAlreadySelected
      || !existingConnection
      || existingConnection.status === 'disconnected'
      || existingConnection.status === 'error'
    );

    if (shouldCreateConnection) {
      if (isAlreadySelected && !forceReconnect) {
        wsLogger.info(`Token已选中但无连接，创建新连接: ${tokenId}`);
      } else if (!isAlreadySelected) {
        wsLogger.info(`切换到新Token，创建连接: ${tokenId}`);
      } else if (forceReconnect) {
        wsLogger.info(`强制重连Token: ${tokenId}`);
      }

      createWebSocketConnection(tokenId, token.token, token.wsUrl);
    } else if (isConnected) {
      wsLogger.debug(`Token已连接，跳过连接创建: ${tokenId}`);
    } else if (isConnecting) {
      wsLogger.debug(`Token连接中，跳过连接创建: ${tokenId}`);
    } else {
      wsLogger.debug(`Token已选中且有连接，跳过连接创建: ${tokenId}`);
    }

    return token;
  };

  return {
    selectToken,
  };
}
