import type { Ref } from 'vue';

export interface TokenCrudTokenData {
  id?: string;
  name?: string;
  token?: string;
  wsUrl?: string | null;
  server?: string;
  createdAt?: string;
  lastUsed?: string;
  level?: number;
  profession?: string;
  isActive?: boolean;
  remark?: string;
  importMethod?: string;
  sourceUrl?: string | null;
  avatar?: string;
  updatedAt?: string;
  storageKey?: string;
  legacyStorageKeys?: string[];
  [key: string]: any;
}

interface TokenCrudManagerOptions {
  gameTokens: Ref<TokenCrudTokenData[]>;
  selectedTokenId: Ref<any>;
  wsConnections: Ref<Record<string, any>>;
  defaultAvatar: string;
  getMaxGameAccounts: () => number | null;
  normalizeStorageKey: (value: unknown) => string;
  mergeLegacyStorageKeys: (...groups: unknown[][]) => string[];
  syncAccountToBackend: (tokenData: TokenCrudTokenData) => Promise<void> | void;
  closeWebSocketConnection: (tokenId: string) => void;
  deleteArrayBuffer: (tokenId: string) => Promise<unknown>;
  deleteBackendTokenAccount: (tokenId: string) => Promise<void>;
}

const SUPPORTED_IMPORT_METHODS = new Set(['manual', 'bin', 'url', 'wxQrcode', 'phone']);

export function createTokenCrudManager({
  gameTokens,
  selectedTokenId,
  wsConnections,
  defaultAvatar,
  getMaxGameAccounts,
  normalizeStorageKey,
  mergeLegacyStorageKeys,
  syncAccountToBackend,
  closeWebSocketConnection,
  deleteArrayBuffer,
  deleteBackendTokenAccount,
}: TokenCrudManagerOptions) {
  const normalizeImportMethod = (importMethod?: string) => {
    const normalized = String(importMethod || '');
    return SUPPORTED_IMPORT_METHODS.has(normalized) ? normalized : 'manual';
  };

  const addToken = (tokenData: TokenCrudTokenData) => {
    const maxGameAccounts = getMaxGameAccounts();

    if (maxGameAccounts !== null && Number.isFinite(maxGameAccounts) && gameTokens.value.length >= maxGameAccounts) {
      throw new Error(`当前账号最多只能添加 ${maxGameAccounts} 个游戏账号，已达到上限`);
    }

    const id = tokenData.id || `token_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const {
      id: _ignoredId,
      name,
      token,
      wsUrl,
      server,
      remark,
      level,
      profession,
      sourceUrl,
      importMethod,
      avatar,
      ...extraFields
    } = tokenData;

    const newToken = {
      ...extraFields,
      id,
      name,
      token,
      wsUrl: wsUrl || null,
      server: server || '',
      remark: remark || '',
      level: level || 1,
      profession: profession || '',
      createdAt: new Date().toISOString(),
      lastUsed: new Date().toISOString(),
      isActive: true,
      sourceUrl: sourceUrl || null,
      importMethod: normalizeImportMethod(importMethod),
      avatar: avatar || defaultAvatar,
      storageKey: normalizeStorageKey(extraFields.storageKey || id),
      legacyStorageKeys: mergeLegacyStorageKeys(
        Array.isArray(extraFields.legacyStorageKeys) ? extraFields.legacyStorageKeys : [],
        [normalizeStorageKey(extraFields.storageKey || id)],
      ),
    };

    gameTokens.value.push(newToken);
    void syncAccountToBackend(newToken);
    return newToken;
  };

  const updateToken = (tokenId: string, updates: Partial<TokenCrudTokenData>) => {
    const index = gameTokens.value.findIndex((token) => token.id === tokenId);
    if (index === -1) {
      return false;
    }

    gameTokens.value[index] = {
      ...gameTokens.value[index],
      ...updates,
      updatedAt: new Date().toISOString(),
    };

    return true;
  };

  const upsertToken = (tokenData: TokenCrudTokenData, options: { syncBackend?: boolean } = {}) => {
    const normalizedTokenValue = String(tokenData?.token || '').trim();
    const existingIndex = gameTokens.value.findIndex((token) => {
      if (tokenData?.id && token.id === tokenData.id) {
        return true;
      }

      return normalizedTokenValue !== '' && String(token.token || '').trim() === normalizedTokenValue;
    });

    if (existingIndex === -1) {
      const createdToken = addToken({
        ...tokenData,
        token: normalizedTokenValue,
        importMethod: normalizeImportMethod(tokenData.importMethod),
      });

      return { token: createdToken, created: true };
    }

    const existingToken = gameTokens.value[existingIndex];
    const mergedToken = {
      ...existingToken,
      ...tokenData,
      id: existingToken.id,
      token: normalizedTokenValue || existingToken.token,
      name: tokenData.name ?? existingToken.name,
      wsUrl: tokenData.wsUrl ?? existingToken.wsUrl ?? null,
      server: tokenData.server ?? existingToken.server ?? '',
      remark: tokenData.remark ?? existingToken.remark ?? '',
      sourceUrl: tokenData.sourceUrl ?? existingToken.sourceUrl ?? null,
      importMethod: normalizeImportMethod(tokenData.importMethod),
      avatar: tokenData.avatar || existingToken.avatar || defaultAvatar,
      updatedAt: new Date().toISOString(),
      lastUsed: tokenData.lastUsed || new Date().toISOString(),
      storageKey: normalizeStorageKey(tokenData.storageKey || existingToken.storageKey || existingToken.id),
      legacyStorageKeys: mergeLegacyStorageKeys(
        Array.isArray(tokenData.legacyStorageKeys) ? tokenData.legacyStorageKeys : existingToken.legacyStorageKeys || [],
        [normalizeStorageKey(tokenData.storageKey || existingToken.storageKey || existingToken.id)],
      ),
    };

    gameTokens.value[existingIndex] = mergedToken;

    if (options.syncBackend !== false) {
      void syncAccountToBackend(mergedToken);
    }

    return { token: mergedToken, created: false };
  };

  const removeToken = async (tokenId: string) => {
    await deleteBackendTokenAccount(tokenId);

    gameTokens.value = gameTokens.value.filter((token) => token.id !== tokenId);
    localStorage.removeItem(`saved_lineups_${tokenId}`);

    if (wsConnections.value[tokenId]) {
      closeWebSocketConnection(tokenId);
    }

    if (selectedTokenId.value === tokenId) {
      selectedTokenId.value = null;
    }

    await deleteArrayBuffer(tokenId);

    return true;
  };

  return {
    normalizeImportMethod,
    addToken,
    updateToken,
    upsertToken,
    removeToken,
  };
}
