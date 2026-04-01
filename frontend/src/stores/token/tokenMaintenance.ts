import type { Ref } from 'vue';

interface TokenMaintenanceToken {
  id: string;
  importMethod?: string;
  upgradedToPermanent?: boolean;
  upgradedAt?: string;
  lastUsed?: string;
  createdAt?: string;
  [key: string]: any;
}

interface TokenMaintenanceOptions {
  gameTokens: Ref<TokenMaintenanceToken[]>;
  selectedTokenId: Ref<any>;
  wsConnections: Ref<Record<string, any>>;
  clearAll: () => Promise<unknown>;
  closeWebSocketConnection: (tokenId: string) => void;
  removeToken: (tokenId: string) => Promise<unknown>;
  updateToken: (tokenId: string, updates: Partial<TokenMaintenanceToken>) => boolean;
  getErrorMessage: (error: unknown) => string;
}

export function createTokenMaintenanceManager({
  gameTokens,
  selectedTokenId,
  wsConnections,
  clearAll,
  closeWebSocketConnection,
  removeToken,
  updateToken,
  getErrorMessage,
}: TokenMaintenanceOptions) {
  const exportTokens = () => ({
    tokens: gameTokens.value,
    exportedAt: new Date().toISOString(),
    version: '2.0',
  });

  const importTokens = (data: any) => {
    try {
      if (data.tokens && Array.isArray(data.tokens)) {
        gameTokens.value = data.tokens;
        return {
          success: true,
          message: `成功导入 ${data.tokens.length} 个Token`,
        };
      }

      return { success: false, message: '导入数据格式错误' };
    } catch (error) {
      return { success: false, message: `导入失败：${getErrorMessage(error)}` };
    }
  };

  const clearAllTokens = async () => {
    Object.keys(wsConnections.value).forEach((tokenId) => {
      closeWebSocketConnection(tokenId);
    });

    gameTokens.value = [];
    selectedTokenId.value = null;

    await clearAll();
  };

  const cleanExpiredTokens = async () => {
    const now = new Date();
    const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    const tokensToRemove = gameTokens.value.filter((token) => {
      if (
        token.importMethod === 'url'
        || token.importMethod === 'bin'
        || token.importMethod === 'wxQrcode'
        || token.upgradedToPermanent
      ) {
        return false;
      }

      const lastUsed = new Date(token.lastUsed || token.createdAt || Date.now());
      return lastUsed <= oneDayAgo;
    });

    const cleanedCount = tokensToRemove.length;
    for (const token of tokensToRemove) {
      await removeToken(token.id);
    }

    return cleanedCount;
  };

  const upgradeTokenToPermanent = (tokenId: string) => {
    const token = gameTokens.value.find((item) => item.id === tokenId);
    if (
      token
      && !token.upgradedToPermanent
      && token.importMethod !== 'url'
      && token.importMethod !== 'bin'
      && token.importMethod !== 'wxQrcode'
    ) {
      updateToken(tokenId, {
        upgradedToPermanent: true,
        upgradedAt: new Date().toISOString(),
      });
      return true;
    }

    return false;
  };

  return {
    exportTokens,
    importTokens,
    clearAllTokens,
    cleanExpiredTokens,
    upgradeTokenToPermanent,
  };
}
