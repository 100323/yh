import type { Ref } from 'vue';

import { generateRandomSeed } from '@/utils/randomSeed';

interface TokenMessageStateOptions {
  wsConnections: Ref<Record<string, any>>;
  gameTokens: Ref<Array<{ id: string; avatar?: string }>>;
  gameData: Ref<any>;
  selectedRoleInfo: Ref<any>;
  updateToken: (tokenId: string, updates: Record<string, any>) => boolean;
  syncProtocolState: (tokenId: string, body: any) => void;
  emitPlus: (event: string | symbol, ...args: Array<any>) => boolean;
  gameLogger: any;
}

export function createTokenMessageStateManager({
  wsConnections,
  gameTokens,
  gameData,
  selectedRoleInfo,
  updateToken,
  syncProtocolState,
  emitPlus,
  gameLogger,
}: TokenMessageStateOptions) {
  const syncRandomSeedFromStatistics = (tokenId: string, body: any) => {
    const connection = wsConnections.value[tokenId];
    if (!connection) {
      return;
    }

    const lastLoginTime = body?.role?.lastLoginTime
      ?? body?.role?.last_login_time
      ?? body?.role?.statistics?.lastLoginTime
      ?? body?.role?.statistics?.['last:login:time']
      ?? null;

    if (lastLoginTime == null) {
      return;
    }

    const randomSeedSource = Number(lastLoginTime) || null;
    const randomSeed = generateRandomSeed(lastLoginTime);

    connection.randomSeedSynced = randomSeed > 0;
    connection.lastRandomSeedSource = randomSeedSource;
    connection.lastRandomSeed = randomSeed > 0 ? randomSeed : null;
  };

  const handleGameMessage = (tokenId: string, message: any, client: any) => {
    if (!message) {
      return;
    }

    const cmd = String(message.cmd || '').toLowerCase();
    const body = typeof message.getData === 'function' ? message.getData() : null;
    const connection = wsConnections.value[tokenId];

    if (connection) {
      connection.lastMessageAt = new Date().toISOString();
      connection.lastMessage = {
        timestamp: new Date().toISOString(),
        data: message,
        cmd,
      };
    }

    syncProtocolState(tokenId, body);

    if (cmd === 'role_getroleinforesp' || cmd === 'role_getroleinfo') {
      syncRandomSeedFromStatistics(tokenId, body);
      gameData.value.roleInfo = body;
      selectedRoleInfo.value = body;
      gameData.value.lastUpdated = new Date().toISOString();

      if (body?.role?.headImg) {
        const token = gameTokens.value.find((item) => item.id === tokenId);
        if (token && token.avatar !== body.role.headImg) {
          updateToken(tokenId, { avatar: body.role.headImg });
        }
      }
    } else if (cmd.includes('legion')) {
      gameData.value.legionInfo = body;
      gameData.value.lastUpdated = new Date().toISOString();
    } else if (cmd.includes('commonactivity')) {
      gameData.value.commonActivityInfo = body;
      gameData.value.lastUpdated = new Date().toISOString();
    } else if (cmd.includes('bosstower')) {
      gameData.value.bossTowerInfo = body;
      gameData.value.lastUpdated = new Date().toISOString();
    } else if (cmd.includes('evotower') || cmd.includes('towers_')) {
      gameData.value.evoTowerInfo = body;
      gameData.value.lastUpdated = new Date().toISOString();
    } else if (cmd.includes('presetteam')) {
      gameData.value.presetTeam = body;
      gameData.value.lastUpdated = new Date().toISOString();
    }

    emitPlus(cmd, {
      tokenId,
      body,
      message,
      client,
      gameData,
    });

    if (typeof gameLogger?.gameMessage === 'function') {
      gameLogger.gameMessage(tokenId, cmd, !!body);
    }
  };

  return {
    syncRandomSeedFromStatistics,
    handleGameMessage,
  };
}
