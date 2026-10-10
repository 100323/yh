import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { useTokenStore } from '@/stores/tokenStore';
import { XyzwLegionWarWebSocketClient } from '@/utils/xyzwLegionWarWebSocket';
import {
  buildBattleFieldWsUrl,
  pickBattleFieldInfo,
  describeBattleFieldTarget,
  DEFAULT_BATTLE_WS_URL,
} from '@/utils/battleFieldUrl';
import { extractValidData } from '@/utils/legionWar';
import { getCurrentTimeByFormat } from '@/utils/DateTimeUtils';

/**
 * 战场类型
 *  - war     : 俱乐部盐场战。主服取 legion_getbattlefield → info.battlefieldId / info.sid / info.domainName
 *  - payload : 蟠桃物资战。主服取 legion_getpayloadbf   → info.bfId          / info.sid / info.domainName
 *
 * 两者都要求：用 info.domainName 建第二条 WebSocket（战场专用服），sid2 = info.sid。
 */
export const BATTLE_KIND = Object.freeze({
  WAR: 'war',
  PAYLOAD: 'payload',
});

/** 战场类型 → 主服查询命令 */
const INFO_CMD_BY_KIND = {
  [BATTLE_KIND.WAR]: 'legion_getbattlefield',
  [BATTLE_KIND.PAYLOAD]: 'legion_getpayloadbf',
};

/** 战场类型 → 快照刷新命令（战场专用连接上发） */
const SNAPSHOT_CMD_BY_KIND = {
  [BATTLE_KIND.WAR]: 'war_getbattlefieldinfo',
  [BATTLE_KIND.PAYLOAD]: 'payload_enterbf',
};

/** 战场类型 → 快照 id 字段名 */
const ID_FIELD_BY_KIND = {
  [BATTLE_KIND.WAR]: 'battlefieldId',
  [BATTLE_KIND.PAYLOAD]: 'bfId',
};

export const useLegionWarStore = defineStore('legionWar', () => {
  const tokenStore = useTokenStore();

  // 状态
  const isConnected = ref(false);
  const connecting = ref(false);
  /** 盐场战场 id（蟠桃为 null） */
  const battlefieldId = ref(null);
  /** 蟠桃战场 id（盐场为 null） */
  const bfId = ref(null);
  /** 当前战场类型 */
  const battlefieldKind = ref(BATTLE_KIND.WAR);
  /** 服务端下发的战场专用服地址（用于排障展示） */
  const battleDomainName = ref('');
  const validData = ref(null);
  const legionDetails = ref({});
  const lastUpdateTime = ref("");
  const isJoined = ref(false); // 是否已进入战场

  // 引用计数，用于管理连接生命周期
  const subscriberCount = ref(0);
  let disconnectTimer = null;

  // WebSocket 实例
  let legionWarWebSocket = null;

  /** 当前战场的抽象 id（盐场 battlefieldId / 蟠桃 bfId） */
  const currentBattleId = computed(() =>
    battlefieldKind.value === BATTLE_KIND.PAYLOAD ? bfId.value : battlefieldId.value
  );

  /**
   * 连接战场。
   *
   * @param {{ kind?: 'war'|'payload', useDomainName?: boolean }} [options]
   *   kind          战场类型，默认 'war'（盐场）
   *   useDomainName 是否优先使用服务端下发的 domainName，默认 true；
   *                 置 false 时强制走兜底域名（排障用）
   */
  const connect = async (options = {}) => {
    const kind = options.kind === BATTLE_KIND.PAYLOAD ? BATTLE_KIND.PAYLOAD : BATTLE_KIND.WAR;
    const useDomainName = options.useDomainName !== false;

    subscriberCount.value++;

    // 如果有待执行的断开操作，取消它
    if (disconnectTimer) {
      clearTimeout(disconnectTimer);
      disconnectTimer = null;
    }

    if (!tokenStore.selectedToken) {
      subscriberCount.value--;
      throw new Error("请先选择一个Token");
    }

    // 已连接但战场类型变了 → 先断开重连
    if (isConnected.value && battlefieldKind.value !== kind) {
      performDisconnect();
    }

    if (isConnected.value) {
      if (!isJoined.value && !connecting.value) {
        tryJoinBattlefield();
      }
      return;
    }

    if (connecting.value) {
      return; // 正在连接中
    }

    connecting.value = true;
    battlefieldKind.value = kind;

    try {
      const tokenId = tokenStore.selectedToken.id;
      const infoCmd = INFO_CMD_BY_KIND[kind];

      // 1. 取战场信息（含 sid 与 domainName）
      const infoResp = await tokenStore.sendMessageWithPromise(tokenId, infoCmd, {}, 10000);

      const info = pickBattleFieldInfo(infoResp?.info, kind);
      const battleKey = kind === BATTLE_KIND.PAYLOAD ? info.bfId : info.battlefieldId;

      if (battleKey === null || battleKey === undefined || battleKey === '') {
        throw new Error(
          kind === BATTLE_KIND.PAYLOAD
            ? '无法获取蟠桃战场信息（缺少 bfId）'
            : '无法获取盐场战场信息（缺少 battlefieldId）'
        );
      }

      battlefieldId.value = kind === BATTLE_KIND.WAR ? battleKey : null;
      bfId.value = kind === BATTLE_KIND.PAYLOAD ? battleKey : null;
      battleDomainName.value = info.domainName;

      // 2. 构建战场 WS URL —— 优先使用服务端下发的 domainName
      const built = buildBattleFieldWsUrl({
        token: tokenStore.selectedToken.token,
        sid: info.sid,
        domainName: useDomainName ? info.domainName : '',
        baseUrl: DEFAULT_BATTLE_WS_URL,
      });

      console.log(
        `[战场] kind=${kind} 目标=${describeBattleFieldTarget(built.url)} ` +
        `domainName=${built.usedDomainName ? '服务端下发' : '兜底'}`
      );

      // 3. 建立连接（命令族与心跳按 kind 切换）
      legionWarWebSocket = new XyzwLegionWarWebSocketClient({
        url: built.url,
        utils: null,
        hint: battleKey,
        kind,
        heartbeatMs: 5000,
      });

      legionWarWebSocket.onConnect = () => {
        console.log("战场WebSocket连接成功");
        isConnected.value = true;
        connecting.value = false;

        // 延迟发送进入战场指令
        setTimeout(() => {
          tryJoinBattlefield();
        }, 1000);
      };

      legionWarWebSocket.setMessageListener((msg) => {
        const cmd = msg?.cmd || 'unknown';

        // 盐场快照
        if (cmd.includes("war_getbattlefieldinfo") || cmd.includes("war_enterbattlefieldresp")) {
          const extracted = extractValidData(msg.rawData);
          if (extracted) {
            validData.value = extracted;
            lastUpdateTime.value = getCurrentTimeByFormat("HH:mm:ss");

            Object.values(extracted.legionInfo || {}).forEach(legion => {
              if (!legionDetails.value[legion.id]) {
                fetchLegionDetail(legion.id);
              }
            });
          }
        }

        // 蟠桃快照
        if (cmd.includes("payload_enterbfresp") || cmd.includes("payload_bfresp")) {
          validData.value = msg.rawData ?? msg.decodedBody ?? msg.body ?? null;
          lastUpdateTime.value = getCurrentTimeByFormat("HH:mm:ss");
        }
      });

      legionWarWebSocket.onDisconnect = (event) => {
        console.log("战场WebSocket断开", event);
        isConnected.value = false;
        isJoined.value = false;
        connecting.value = false;
      };

      legionWarWebSocket.onError = (error) => {
        console.error("战场WebSocket错误", error);
        isConnected.value = false;
        isJoined.value = false;
        connecting.value = false;
      };

      await legionWarWebSocket.init();

    } catch (error) {
      console.error("连接失败:", error);
      connecting.value = false;
      subscriberCount.value--; // 连接失败，回滚计数
      throw error;
    }
  };

  /** 进入战场（命令与入参字段由客户端按 kind 自动选择） */
  const tryJoinBattlefield = () => {
    if (!legionWarWebSocket || !isConnected.value) return;

    legionWarWebSocket.enterBattlefield();
    isJoined.value = true;

    // 主动请求一次数据
    refreshData();
  };

  const disconnect = (force = false) => {
    if (subscriberCount.value > 0) {
      subscriberCount.value--;
    }

    if (force) {
      subscriberCount.value = 0;
      performDisconnect();
    } else if (subscriberCount.value <= 0) {
      // 延迟断开，防止页面切换时频繁断连
      if (disconnectTimer) clearTimeout(disconnectTimer);

      disconnectTimer = setTimeout(() => {
        if (subscriberCount.value <= 0) {
          performDisconnect();
        }
      }, 3000); // 3秒缓冲期
    }
  };

  const performDisconnect = () => {
    if (legionWarWebSocket) {
      legionWarWebSocket.disconnect();
      legionWarWebSocket = null;
    }
    isConnected.value = false;
    isJoined.value = false;
    connecting.value = false;
    battlefieldId.value = null;
    bfId.value = null;
    battleDomainName.value = '';
    disconnectTimer = null;
  };

  const refreshData = () => {
    if (!isConnected.value || !legionWarWebSocket) {
      console.warn("请先连接到战场");
      return;
    }

    const battleKey = currentBattleId.value;
    if (battleKey === null || battleKey === undefined || battleKey === '') {
      console.warn("未获取到战场ID");
      return;
    }

    const cmd = SNAPSHOT_CMD_BY_KIND[battlefieldKind.value];
    const idField = ID_FIELD_BY_KIND[battlefieldKind.value];
    legionWarWebSocket.send(cmd, { [idField]: battleKey });
  };

  /* ==================== 战场操作（布阵 / 开战 / 行军） ==================== */

  /** 布阵：battleTeam 为阵容对象，lordWeaponId 为主武器 id */
  const setBattleTeam = (battleTeam = {}, lordWeaponId = 0) => {
    if (!legionWarWebSocket || !isConnected.value) {
      throw new Error('战场未连接，无法布阵');
    }
    return legionWarWebSocket.setBattleTeam(battleTeam, lordWeaponId);
  };

  /** 开战：targetId 为目标（玩家/建筑/车辆）id */
  const startBattle = (targetId = 0) => {
    if (!legionWarWebSocket || !isConnected.value) {
      throw new Error('战场未连接，无法开战');
    }
    return legionWarWebSocket.startBattle(targetId);
  };

  /** 行军：carId 为车辆 id，path 为 [{x,y}...] */
  const startMarch = (carId = 0, path = []) => {
    if (!legionWarWebSocket || !isConnected.value) {
      throw new Error('战场未连接，无法行军');
    }
    return legionWarWebSocket.startMarch(carId, path);
  };

  const fetchLegionDetail = async (legionId) => {
    if (!tokenStore.selectedToken) return;
    try {
      const response = await tokenStore.sendMessageWithPromise(
        tokenStore.selectedToken.id,
        'legion_getinfobyid',
        { legionId: legionId }
      );

      if (response && (response.legionData || response.info)) {
        legionDetails.value[legionId] = response.legionData || response.info;
      }
    } catch (error) {
      console.error(`获取俱乐部[${legionId}]详情失败`, error);
    }
  };

  return {
    // State
    isConnected,
    connecting,
    battlefieldId,
    bfId,
    battlefieldKind,
    battleDomainName,
    validData,
    legionDetails,
    lastUpdateTime,
    isJoined,
    currentBattleId,

    // Actions
    connect,
    disconnect,
    refreshData,
    fetchLegionDetail,
    setBattleTeam,
    startBattle,
    startMarch,
  };
});
