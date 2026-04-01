import type { Ref } from 'vue';

interface BinTokenLike {
  id?: string;
  storageKey?: string;
  legacyStorageKeys?: string[];
}

interface TokenBinPayloadOptions {
  waitForIndexedDBReady: (timeoutMs?: number) => Promise<boolean>;
  getArrayBuffer: (key: string) => Promise<ArrayBuffer | null>;
  mergeLegacyStorageKeys: (...groups: unknown[][]) => string[];
}

const arrayBufferToBase64 = (buffer: ArrayBuffer) => {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunkSize = 0x8000;

  for (let index = 0; index < bytes.length; index += chunkSize) {
    const chunk = bytes.subarray(index, index + chunkSize);
    binary += String.fromCharCode(...chunk);
  }

  return btoa(binary);
};

export function createTokenBinPayloadManager({
  waitForIndexedDBReady,
  getArrayBuffer,
  mergeLegacyStorageKeys,
}: TokenBinPayloadOptions) {
  const loadStoredBinData = async (tokenId: string, token?: BinTokenLike | null) => {
    await waitForIndexedDBReady();

    const triedKeys = mergeLegacyStorageKeys(
      [tokenId],
      [token?.storageKey],
      Array.isArray(token?.legacyStorageKeys) ? token.legacyStorageKeys : [],
    );

    for (const key of triedKeys) {
      const data = await getArrayBuffer(key);
      if (data) {
        return {
          data,
          matchedKey: key,
          triedKeys,
        };
      }
    }

    return {
      data: null,
      matchedKey: null,
      triedKeys,
    };
  };

  const getBackendBinPayload = async (tokenData?: BinTokenLike | null) => {
    if (!tokenData) {
      return null;
    }

    const { data, matchedKey, triedKeys } = await loadStoredBinData(String(tokenData.id || ''), tokenData);
    return {
      binData: data ? arrayBufferToBase64(data) : '',
      matchedKey,
      triedKeys,
    };
  };

  return {
    loadStoredBinData,
    getBackendBinPayload,
  };
}

