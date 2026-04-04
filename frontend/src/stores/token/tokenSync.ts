import type { Ref } from 'vue';

interface TokenSyncTokenData {
  id: string;
  name?: string;
  token?: string;
  wsUrl?: string | null;
  server?: string;
  remark?: string;
  avatar?: string;
  importMethod?: string;
  sourceUrl?: string | null;
  storageKey?: string;
  legacyStorageKeys?: string[];
  createdAt?: string;
  updatedAt?: string;
  lastUsed?: string;
  isActive?: boolean;
  [key: string]: any;
}

interface TokenGroup {
  tokenIds: string[];
  [key: string]: any;
}

interface LoadStoredBinDataResult {
  data: ArrayBuffer | null;
  matchedKey: string | null;
  triedKeys: string[];
}

interface TokenSyncManagerOptions {
  gameTokens: Ref<TokenSyncTokenData[]>;
  selectedTokenId: Ref<any>;
  wsConnections: Ref<Record<string, any>>;
  tokenGroups: Ref<TokenGroup[]>;
  defaultAvatar: string;
  normalizeImportMethod: (importMethod?: string) => string;
  mergeLegacyStorageKeys: (...groups: unknown[][]) => string[];
  loadStoredBinData: (tokenId: string, token?: TokenSyncTokenData | null) => Promise<LoadStoredBinDataResult>;
  storeArrayBuffer: (key: string, data: ArrayBuffer) => Promise<boolean>;
  deleteArrayBuffer: (key: string) => Promise<unknown>;
  getBackendBinPayload: (tokenData: TokenSyncTokenData | null | undefined) => Promise<any>;
  request: {
    get: (url: string) => Promise<any>;
    post: (url: string, data?: any) => Promise<any>;
    put: (url: string, data?: any) => Promise<any>;
  };
  tokenLogger: { warn: (...args: any[]) => void };
}

export function createTokenSyncManager({
  gameTokens,
  selectedTokenId,
  wsConnections,
  tokenGroups,
  defaultAvatar,
  normalizeImportMethod,
  mergeLegacyStorageKeys,
  loadStoredBinData,
  storeArrayBuffer,
  deleteArrayBuffer,
  getBackendBinPayload,
  request,
  tokenLogger,
}: TokenSyncManagerOptions) {
  let backendHydrationPromise: Promise<void> | null = null;
  const accountSyncPromises = new Map<string, Promise<void>>();

  const migrateTokenIdToBackendId = async (oldId: string, backendId: string) => {
    if (!oldId || !backendId || oldId === backendId) {
      return;
    }

    const token = gameTokens.value.find((item) => item.id === oldId);
    const legacyStorageKeys = mergeLegacyStorageKeys(
      [oldId],
      [token?.storageKey],
      Array.isArray(token?.legacyStorageKeys) ? token.legacyStorageKeys : [],
    );

    try {
      const { data: binData, matchedKey } = await loadStoredBinData(oldId, token);
      if (binData) {
        const saved = await storeArrayBuffer(backendId, binData);
        if (saved && matchedKey && matchedKey !== backendId) {
          await deleteArrayBuffer(matchedKey);
        }
      } else {
        tokenLogger.warn(`迁移本地BIN数据未命中，保留旧键用于后续刷新 [${oldId} -> ${backendId}]`, {
          legacyStorageKeys,
        });
      }
    } catch (error) {
      tokenLogger.warn(`迁移本地BIN数据失败 [${oldId} -> ${backendId}]`, error);
    }

    if (token) {
      token.id = backendId;
      token.storageKey = backendId;
      token.legacyStorageKeys = mergeLegacyStorageKeys(
        legacyStorageKeys,
        token.legacyStorageKeys || [],
      );
    }

    if (selectedTokenId.value === oldId) {
      selectedTokenId.value = backendId;
    }

    if (wsConnections.value[oldId]) {
      wsConnections.value[backendId] = wsConnections.value[oldId];
      wsConnections.value[backendId].tokenId = backendId;
      delete wsConnections.value[oldId];
    }

    tokenGroups.value.forEach((group) => {
      group.tokenIds = group.tokenIds.map((id) => (id === oldId ? backendId : id));
    });
  };

  const syncAccountToBackend = async (tokenData: TokenSyncTokenData) => {
    const rawToken = String(tokenData?.token || '').trim();
    if (!rawToken) {
      return;
    }

    const syncKey = String(tokenData?.name || tokenData?.id || rawToken).trim().toLowerCase();
    if (accountSyncPromises.has(syncKey)) {
      return accountSyncPromises.get(syncKey);
    }

    const syncPromise = (async () => {
      try {
        const backendBin = await getBackendBinPayload(tokenData);
        const createRes = await request.post('/accounts', {
          name: tokenData.name,
          token: rawToken,
          server: tokenData.server || '',
          wsUrl: tokenData.wsUrl || '',
          remark: tokenData.remark || '',
          avatar: tokenData.avatar || defaultAvatar,
          importMethod: normalizeImportMethod(tokenData.importMethod),
          sourceUrl: tokenData.sourceUrl || '',
          binData: backendBin?.binData || '',
        });

        if (createRes?.success && createRes?.data?.id !== undefined) {
          await migrateTokenIdToBackendId(tokenData.id, String(createRes.data.id));
          return;
        }
      } catch (error: any) {
        if (error?.response?.status !== 409) {
          tokenLogger.warn(`同步账号到后端失败 [${tokenData?.name || ''}]`, error);
          return;
        }
      }

      try {
        const backendBin = await getBackendBinPayload(tokenData);
        const listRes = await request.get('/accounts');
        const exists = listRes?.data?.find((item: any) => item.name === tokenData.name);
        if (!exists?.id) {
          return;
        }

        await request.put(`/accounts/${exists.id}`, {
          token: rawToken,
          server: tokenData.server || '',
          wsUrl: tokenData.wsUrl || '',
          remark: tokenData.remark || '',
          avatar: tokenData.avatar || defaultAvatar,
          binData: backendBin?.binData || '',
        });
        await migrateTokenIdToBackendId(tokenData.id, String(exists.id));
      } catch (error) {
        tokenLogger.warn(`处理重名账号同步失败 [${tokenData?.name || ''}]`, error);
      }
    })().finally(() => {
      accountSyncPromises.delete(syncKey);
    });

    accountSyncPromises.set(syncKey, syncPromise);
    return syncPromise;
  };

  const syncAccountsFromBackend = async () => {
    if (!localStorage.getItem('token')) {
      return;
    }

    if (backendHydrationPromise) {
      return backendHydrationPromise;
    }

    backendHydrationPromise = (async () => {
      try {
        const pendingLocalTokens = gameTokens.value.filter((token) => (
          !/^\d+$/.test(String(token.id)) && !!String(token.token || '').trim()
        ));

        if (pendingLocalTokens.length > 0) {
          await Promise.all(pendingLocalTokens.map((token) => syncAccountToBackend(token)));
        }

        const listRes = await request.get('/accounts');
        if (!listRes?.success || !Array.isArray(listRes.data)) {
          return;
        }

        const backendAccounts = listRes.data;
        const backendNameSet = new Set(
          backendAccounts
            .map((account: any) => String(account?.name || '').trim())
            .filter(Boolean),
        );

        const existingBackendTokens = new Map(
          gameTokens.value
            .filter((token) => /^\d+$/.test(String(token.id)))
            .map((token) => [String(token.id), token]),
        );

        const localOnlyTokens = gameTokens.value.filter((token) => {
          if (/^\d+$/.test(String(token.id))) {
            return false;
          }
          return !backendNameSet.has(String(token.name || '').trim());
        });

        const backendTokens = await Promise.all(
          backendAccounts.map(async (account: any) => {
            const accountId = String(account.id);
            const existingToken = existingBackendTokens.get(accountId);
            let rawToken = '';

            try {
              const tokenRes = await request.get(`/accounts/${accountId}/token`);
              if (tokenRes?.success) {
                rawToken = String(tokenRes?.data?.token || '').trim();
              }
            } catch (error) {
              tokenLogger.warn(`获取后端账号Token失败 [${accountId}]`, error);
            }

            if (!rawToken) {
              rawToken = String(existingToken?.token || '').trim();
            }

            return {
              ...existingToken,
              id: accountId,
              name: account.name || existingToken?.name || `账号${accountId}`,
              token: rawToken || existingToken?.token || '',
              wsUrl: account.ws_url ?? existingToken?.wsUrl ?? null,
              server: account.server ?? existingToken?.server ?? '',
              remark: account.remark ?? existingToken?.remark ?? '',
              avatar: account.avatar ?? existingToken?.avatar ?? defaultAvatar,
              importMethod: normalizeImportMethod(account.import_method || existingToken?.importMethod),
              sourceUrl: account.source_url ?? existingToken?.sourceUrl ?? null,
              createdAt: existingToken?.createdAt || account.created_at || new Date().toISOString(),
              updatedAt: account.updated_at || existingToken?.updatedAt || new Date().toISOString(),
              lastUsed: account.last_used_at || existingToken?.lastUsed || account.updated_at || new Date().toISOString(),
              isActive: account.status !== 'disabled',
            };
          }),
        );

        gameTokens.value = [...localOnlyTokens, ...backendTokens];

        if (
          selectedTokenId.value
          && !gameTokens.value.some((token) => token.id === selectedTokenId.value)
        ) {
          selectedTokenId.value = gameTokens.value[0]?.id || '';
        }
      } catch (error) {
        tokenLogger.warn('从后端恢复账号失败', error);
      }
    })().finally(() => {
      backendHydrationPromise = null;
    });

    return backendHydrationPromise;
  };

  return {
    migrateTokenIdToBackendId,
    syncAccountToBackend,
    syncAccountsFromBackend,
  };
}
