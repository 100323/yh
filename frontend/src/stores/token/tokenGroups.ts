import type { Ref } from 'vue';

interface TokenGroup {
  id: string;
  name: string;
  color: string;
  tokenIds: string[];
  createdAt?: string;
  updatedAt?: string;
}

interface TokenGroupsManagerOptions {
  tokenGroups: Ref<TokenGroup[]>;
  gameTokens: Ref<Array<{ id: string }>>;
}

export function createTokenGroupsManager({ tokenGroups, gameTokens }: TokenGroupsManagerOptions) {
  const createTokenGroup = (name: string, color: string = '#1677ff') => {
    const group: TokenGroup = {
      id: `group_${Date.now()}${Math.random().toString(36).slice(2)}`,
      name,
      color,
      tokenIds: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    tokenGroups.value.push(group);
    return group;
  };

  const deleteTokenGroup = (groupId: string) => {
    const index = tokenGroups.value.findIndex((group) => group.id === groupId);
    if (index !== -1) {
      tokenGroups.value.splice(index, 1);
    }
  };

  const updateTokenGroup = (groupId: string, updates: Partial<TokenGroup>) => {
    const group = tokenGroups.value.find((item) => item.id === groupId);
    if (group) {
      Object.assign(group, updates, {
        updatedAt: new Date().toISOString(),
      });
    }
  };

  const addTokenToGroup = (groupId: string, tokenId: string) => {
    const group = tokenGroups.value.find((item) => item.id === groupId);
    if (group && !group.tokenIds.includes(tokenId)) {
      group.tokenIds.push(tokenId);
      group.updatedAt = new Date().toISOString();
    }
  };

  const removeTokenFromGroup = (groupId: string, tokenId: string) => {
    const group = tokenGroups.value.find((item) => item.id === groupId);
    if (!group) {
      return;
    }

    const index = group.tokenIds.indexOf(tokenId);
    if (index !== -1) {
      group.tokenIds.splice(index, 1);
      group.updatedAt = new Date().toISOString();
    }
  };

  const getTokenGroups = (tokenId: string): TokenGroup[] => (
    tokenGroups.value.filter((group) => group.tokenIds.includes(tokenId))
  );

  const getGroupTokenIds = (groupId: string): string[] => {
    const group = tokenGroups.value.find((item) => item.id === groupId);
    return group ? group.tokenIds : [];
  };

  const getValidGroupTokenIds = (groupId: string): string[] => {
    const tokenIds = getGroupTokenIds(groupId);
    const validTokenIds = gameTokens.value.map((token) => token.id);
    return tokenIds.filter((id) => validTokenIds.includes(id));
  };

  const cleanupInvalidTokens = () => {
    const validTokenIds = new Set(gameTokens.value.map((token) => token.id));
    tokenGroups.value.forEach((group) => {
      group.tokenIds = group.tokenIds.filter((id) => validTokenIds.has(id));
    });
  };

  return {
    createTokenGroup,
    deleteTokenGroup,
    updateTokenGroup,
    addTokenToGroup,
    removeTokenFromGroup,
    getTokenGroups,
    getGroupTokenIds,
    getValidGroupTokenIds,
    cleanupInvalidTokens,
  };
}
