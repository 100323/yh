import WebSocket from 'ws';
import { bon, encode, parse, getEnc } from '../../../frontend/src/utils/bonProtocol.js';
import config from '../config/index.js';
import { normalizeErrorMessage, summarizeHeaders, truncate } from './wsDiagnostics.js';

const ERROR_CODE_MAP = {
  700010: '任务未达成完成条件',
  1400010: '没有购买该月卡,不能领取每日奖励',
  12000116: '今日已领取免费奖励',
  3300060: '扫荡条件不满足',
  1300050: '请修改您的采购次数',
  200020: '出了点小问题，请尝试重启游戏解决～',
  200160: '模块未开启',
  7500140: '请先输入密码',
  7500100: '密码输入错误',
  7500120: '密码输入错误次数已达上限',
  200400: '操作太快，请稍后再试',
  200760: '您当前看到的界面已发生变化，请重新登录',
  2300190: '今天已经签到过了',
  2300370: '俱乐部商品购买数量超出上限',
  400000: '物品不存在',
  1500020: '能量不足',
  2300070: '未加入俱乐部',
  3500020: '没有可领取的奖励',
  12000050: '今日发车次数已达上限',
  12000060: '不在发车时间内',
  400190: '没有可领取的签到奖励',
  1000020: '今天已经领取过奖励了',
  3300050: '购买数量超出限制',
  700020: '已经领取过这个任务',
  12400000: '挂机奖励领取过于频繁',
  2300250: '俱乐部BOSS今日攻打次数已用完',
  400010: '物品数量不足',
  7900023: '已达到使用次数上限',
  12300040: '没有空格子了',
  12300080: '未达到解锁条件',
  200330: '无效的ID',
  1500040: '上座塔的奖励未领取',
  1500010: '已经全部通关'
};

const COMMAND_RESPONSE_ALIASES = {
  role_getroleinfo: ['role_getroleinforesp'],
  study_startgame: ['studyresp'],
  study_answer: ['syncresp'],
  study_claimreward: ['syncresp'],
  task_claimdailypoint: ['syncresp'],
  task_claimdailyreward: ['task_claimdailyrewardresp'],
  task_claimweekreward: ['task_claimweekrewardresp'],
  legion_signin: ['legion_signinresp'],
  system_signinreward: ['syncrewardresp'],
  discount_claimreward: ['syncrewardresp'],
  card_claimreward: ['syncrewardresp'],
  arena_getareatarget: ['arena_getareatargetresp'],
  arena_startarea: ['arena_startarearesp'],
  fight_startareaarena: ['fight_startareaarenaresp'],
  fight_startlevel: ['fight_startlevelresp'],
  fight_startboss: ['fight_startbossresp'],
  fight_startlegionboss: ['fight_startlegionbossresp'],
  system_claimhangupreward: ['system_claimhanguprewardresp'],
  system_mysharecallback: ['syncresp'],
  bottlehelper_stop: ['bottlehelper_stopresp'],
  bottlehelper_start: ['bottlehelper_startresp'],
  bottlehelper_claim: ['bottlehelper_claimresp'],
  car_getrolecar: ['car_getrolecarresp'],
  car_send: ['car_sendresp'],
  car_claim: ['car_claimresp'],
  store_purchase: ['store_buyresp'],
  collection_claimfreereward: ['collection_claimfreerewardresp'],
  legacy_beginhangup: ['legacy_beginhangupresp'],
  legacy_claimhangup: ['legacy_claimhangupresp'],
  evotower_getinfo: ['evotowerinforesp'],
  evotower_readyfight: ['evotower_readyfightresp'],
  evotower_fight: ['evotower_fightresp'],
  evotower_claimreward: ['evotower_claimrewardresp'],
  evotower_claimtask: ['evotower_claimtaskresp'],
  towers_getinfo: ['towers_getinforesp'],
  towers_start: ['towers_startresp'],
  towers_fight: ['towers_fightresp'],
  fight_starttower: ['fight_starttowerresp'],
  tower_getinfo: ['tower_getinforesp'],
  tower_claimreward: ['tower_claimrewardresp'],
  genie_sweep: ['syncrewardresp'],
  genie_buysweep: ['syncrewardresp'],
  hero_recruit: ['hero_recruitresp'],
  friend_batch: ['friend_batchresp'],
  system_buygold: ['syncrewardresp'],
  mail_claimallattachment: ['mail_claimallattachmentresp'],
  fight_startboss: ['fight_startbossresp'],
  fight_startlegionboss: ['fight_startlegionbossresp'],
  artifact_lottery: ['syncrewardresp'],
  system_getdatabundlever: ['system_getdatabundleverresp'],
  item_openbox: ['item_openboxresp'],
  item_batchclaimboxpointreward: ['item_batchclaimboxpointrewardresp'],
};

function normalizeCmd(cmd) {
  return String(cmd || '').toLowerCase();
}

function expectedRespCmds(requestCmd) {
  const cmd = normalizeCmd(requestCmd);
  const set = new Set();
  if (!cmd) return set;
  set.add(`${cmd}resp`);
  const aliases = COMMAND_RESPONSE_ALIASES[cmd] || [];
  aliases.forEach((alias) => set.add(normalizeCmd(alias)));
  return set;
}

function isTodayAvailable(statisticsTime) {
  if (!statisticsTime) return true;
  const today = new Date().toDateString();
  const recordDate = new Date(Number(statisticsTime) * 1000).toDateString();
  return today !== recordDate;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function describeReadyState(readyState) {
  switch (readyState) {
    case WebSocket.CONNECTING:
      return 'CONNECTING';
    case WebSocket.OPEN:
      return 'OPEN';
    case WebSocket.CLOSING:
      return 'CLOSING';
    case WebSocket.CLOSED:
      return 'CLOSED';
    default:
      return 'UNKNOWN';
  }
}

function normalizeCloseReason(reason) {
  if (reason === undefined || reason === null) {
    return '';
  }
  if (Buffer.isBuffer(reason)) {
    return reason.toString();
  }
  return String(reason);
}

function extractLegacyHangUpBeginTime(payload) {
  return Number(
    payload?.roleLegacy?.hangUpBeginTime
    || payload?.rolelegacy?.hangUpBeginTime
    || payload?.rolelegacy?.hangupbegintime
    || 0
  );
}

function summarizeLegacyErrorContext(error) {
  if (!error || typeof error !== 'object') {
    return null;
  }

  const summary = {
    cmd: error.cmd || null,
    code: Number(error.code) || 0,
    hint: error.hint || null,
    rawError: error.rawError || null,
    body: error.body ?? null,
    raw: error.raw ?? null,
  };

  if (!summary.cmd && !summary.code && !summary.hint && !summary.rawError && summary.body == null && summary.raw == null) {
    return null;
  }

  return summary;
}

export class GameClient {
  constructor(token, options = {}) {
    this.token = token;
    this.roleId = Number.isFinite(Number(options.roleId)) && Number(options.roleId) > 0
      ? Math.trunc(Number(options.roleId))
      : null;
    this.wsUrl = options.wsUrl || `${config.game.wsUrl}?p=${encodeURIComponent(token)}&e=x&lang=chinese`;
    this.heartbeatInterval = options.heartbeatInterval || config.game.heartbeatInterval;
    this.defaultBattleVersion = Number(options.battleVersion ?? config.game.battleVersion) || 241201;
    this.battleVersion = this.defaultBattleVersion;
    this.battleVersionSynced = false;
    
    this.ws = null;
    this.seq = 0;
    this.ack = 0;
    this.connected = false;
    this.messageQueue = [];
    this.promises = new Map();
    this.heartbeatTimer = null;
    
    this.onMessage = null;
    this.onConnect = null;
    this.onDisconnect = null;
    this.onError = null;
    this.onUnexpectedResponse = null;
    this.lastConnectMeta = null;
    this.lastMessageAt = null;
  }

  connect() {
    return new Promise((resolve, reject) => {
      let settled = false;
      let opened = false;
      const connectStartedAt = Date.now();
      const connectMeta = {
        startedAt: new Date(connectStartedAt).toISOString(),
        openedAt: null,
        closedAt: null,
        connectElapsedMs: null,
        closeElapsedMs: null,
        closeBeforeOpen: false,
        readyState: 'CONNECTING',
        unexpectedResponse: null,
        lastError: null,
      };

      const updateMeta = () => {
        connectMeta.readyState = describeReadyState(this.ws?.readyState);
        this.lastConnectMeta = { ...connectMeta };
        return this.lastConnectMeta;
      };

      const rejectOnce = (error) => {
        updateMeta();
        if (settled) {
          return;
        }
        settled = true;
        reject(error);
      };

      const resolveOnce = () => {
        updateMeta();
        if (settled) {
          return;
        }
        settled = true;
        resolve();
      };

      try {
        this.ws = new WebSocket(this.wsUrl);

        this.ws.on('open', () => {
          opened = true;
          this.connected = true;
          connectMeta.openedAt = new Date().toISOString();
          connectMeta.connectElapsedMs = Date.now() - connectStartedAt;
          this._startHeartbeat();

          if (this.onConnect) {
            this.onConnect(updateMeta());
          }

          resolveOnce();
        });

        this.ws.on('unexpected-response', (request, response) => {
          const unexpectedResponse = {
            statusCode: Number(response?.statusCode) || 0,
            statusMessage: truncate(response?.statusMessage || '', 120),
            headers: summarizeHeaders(response?.headers || {}),
          };

          connectMeta.unexpectedResponse = unexpectedResponse;
          connectMeta.lastError = `WebSocket握手失败: HTTP ${unexpectedResponse.statusCode || 'unknown'}${unexpectedResponse.statusMessage ? ` ${unexpectedResponse.statusMessage}` : ''}`;

          const error = new Error(connectMeta.lastError);
          error.handshake = unexpectedResponse;

          if (this.onUnexpectedResponse) {
            this.onUnexpectedResponse(unexpectedResponse, updateMeta());
          }

          rejectOnce(error);
        });

        this.ws.on('message', (data) => {
          this.lastMessageAt = new Date().toISOString();
          this._handleMessage(data);
        });

        this.ws.on('close', (code, reason) => {
          this.connected = false;
          this._stopHeartbeat();
          connectMeta.closedAt = new Date().toISOString();
          connectMeta.closeElapsedMs = Date.now() - connectStartedAt;
          connectMeta.closeBeforeOpen = !opened;
          this._rejectPendingPromises(
            new Error(`WebSocket连接已断开(${Number(code) || 0}${reason ? `: ${normalizeCloseReason(reason)}` : ''})`)
          );

          if (this.onDisconnect) {
            this.onDisconnect(code, normalizeCloseReason(reason), updateMeta());
          }

          if (!opened) {
            rejectOnce(
              new Error(
                `WebSocket握手阶段断开(${Number(code) || 0}${reason ? `: ${normalizeCloseReason(reason)}` : ''})`
              )
            );
          }
        });

        this.ws.on('error', (error) => {
          this.connected = false;
          connectMeta.lastError = normalizeErrorMessage(error);
          this._rejectPendingPromises(error);

          if (this.onError) {
            this.onError(error, updateMeta());
          }

          rejectOnce(error);
        });
      } catch (error) {
        connectMeta.lastError = normalizeErrorMessage(error);
        rejectOnce(error);
      }
    });
  }

  disconnect() {
    this._stopHeartbeat();
    this._rejectPendingPromises(new Error('WebSocket连接已关闭'));
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.connected = false;
  }

  send(cmd, params = {}) {
    if (!this.isSocketOpen()) {
      throw new Error('WebSocket未连接');
    }

    const message = this._buildMessage(cmd, params);
    const encoded = encode(message, getEnc('x'));
    
    this.ws.send(encoded);
    return message.seq;
  }

  isSocketOpen() {
    return this.connected && this.ws?.readyState === WebSocket.OPEN;
  }

  getConnectionStateSummary() {
    return {
      connected: this.connected,
      readyState: describeReadyState(this.ws?.readyState),
      lastMessageAt: this.lastMessageAt,
      lastConnectMeta: this.lastConnectMeta,
    };
  }

  sendWithPromise(cmd, params = {}, timeout = 15000) {
    return new Promise((resolve, reject) => {
      if (!this.isSocketOpen()) {
        reject(new Error('WebSocket未连接'));
        return;
      }

      const seq = ++this.seq;
      const promiseKey = String(seq);
      
      const timer = setTimeout(() => {
        console.warn(`⏱️ 请求超时: ${cmd}, seq=${seq}, pending=${this.promises.size}`);
        this.promises.delete(promiseKey);
        reject(new Error(`请求超时: ${cmd}`));
      }, timeout);

      this.promises.set(promiseKey, { resolve, reject, timer, cmd, seq });

      const message = this._buildMessage(cmd, params, seq);
      const encoded = encode(message, getEnc('x'));
      
      this.ws.send(encoded);
    });
  }

  _buildMessage(cmd, params = {}, seq = null) {
    const body = bon.encode(params);
    return {
      cmd,
      body,
      ack: this.ack,
      seq: seq !== null ? seq : ++this.seq,
      time: Date.now()
    };
  }

  _handleMessage(data) {
    try {
      const raw = parse(data, getEnc('x'));
      if (!raw || typeof raw !== 'object') {
        return;
      }
      const body = raw.body ? bon.decode(raw.body) : raw;

      this._updateBattleVersion(body, raw);
      
      if (raw.seq !== undefined) {
        this.ack = raw.seq;
      }

      const buildResponseError = () => {
        if (raw.error) {
          const error = new Error(raw.error);
          error.cmd = raw.cmd || null;
          error.code = Number(raw.code) || 0;
          error.hint = raw.hint || null;
          error.rawError = raw.error;
          error.body = body;
          error.raw = raw;
          return error;
        }

        if (raw.code && raw.code !== 0) {
          const errorMsg = ERROR_CODE_MAP[raw.code] || raw.hint || `错误码: ${raw.code}`;
          const error = new Error(errorMsg);
          error.cmd = raw.cmd || null;
          error.code = Number(raw.code) || 0;
          error.hint = raw.hint || null;
          error.rawError = raw.error || null;
          error.body = body;
          error.raw = raw;
          return error;
        }

        return null;
      };

      const respKey = raw.resp !== undefined && raw.resp !== null ? String(raw.resp) : null;
      if (respKey && this.promises.has(respKey)) {
        const promise = this.promises.get(respKey);
        this.promises.delete(respKey);
        clearTimeout(promise.timer);

        const responseError = buildResponseError();
        if (responseError) {
          promise.reject(responseError);
        } else {
          promise.resolve(body);
        }
        return;
      }

      const incomingCmd = normalizeCmd(raw.cmd);
      if (incomingCmd && this.promises.size > 0) {
        let matchedSeq = null;
        for (const [seqKey, pending] of this.promises.entries()) {
          const respCmds = expectedRespCmds(pending.cmd);
          if (respCmds.has(incomingCmd)) {
            matchedSeq = seqKey;
            break;
          }
        }

        if (matchedSeq !== null && this.promises.has(matchedSeq)) {
          const promise = this.promises.get(matchedSeq);
          this.promises.delete(matchedSeq);
          clearTimeout(promise.timer);

          const responseError = buildResponseError();
          if (responseError) {
            promise.reject(responseError);
          } else {
            promise.resolve(body);
          }
          return;
        }

        if (!incomingCmd.startsWith('_sys/')) {
          console.warn(
            `⚠️ 未匹配回包: cmd=${incomingCmd}, resp=${raw.resp ?? 'none'}, pending=${[...this.promises.values()].map((p) => `${p.cmd}#${p.seq}`).join(',')}`
          );
        }
      }

      if (this.onMessage) {
        this.onMessage(raw.cmd, body, raw);
      }
    } catch (error) {
      console.error('处理消息错误:', error);
    }
  }

  _startHeartbeat() {
    this.heartbeatTimer = setInterval(() => {
      if (this.isSocketOpen()) {
        this.send('_sys/ack', {});
      }
    }, this.heartbeatInterval);
  }

  _stopHeartbeat() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  _rejectPendingPromises(error) {
    if (this.promises.size === 0) {
      return;
    }

    const rejectError = error instanceof Error
      ? error
      : new Error(String(error || 'WebSocket未连接'));

    for (const [promiseKey, promise] of this.promises.entries()) {
      clearTimeout(promise.timer);
      promise.reject(rejectError);
      this.promises.delete(promiseKey);
    }
  }

  async getRoleInfo(timeoutOrOptions = 15000, options = {}) {
    const timeout = typeof timeoutOrOptions === 'number' ? timeoutOrOptions : 15000;
    const normalizedOptions = typeof timeoutOrOptions === 'object' && timeoutOrOptions !== null
      ? timeoutOrOptions
      : options;
    const params = {
      clientVersion: config.game.clientVersion,
      inviteUid: 0,
      platform: 'hortor',
      platformExt: 'mix',
      scene: ''
    };
    const includeRoleId = normalizedOptions.includeRoleId !== false;
    if (includeRoleId && this.roleId) {
      params.roleId = this.roleId;
    }
    return this.sendWithPromise('role_getroleinfo', params, timeout);
  }

  sendDataBundleVer() {
    this.send('system_getdatabundlever', {
      isAudit: false
    });
  }

  _updateBattleVersion(body, raw) {
    const candidates = [
      body?.battleData?.version,
      body?.battleVersion,
      body?.battle_data?.version,
      raw?.battleVersion
    ];

    for (const candidate of candidates) {
      const value = Number(candidate);
      if (Number.isFinite(value) && value > 0) {
        const changed = value !== this.battleVersion;
        this.battleVersion = value;
        this.battleVersionSynced = true;
        if (changed) {
          console.log(`🔄 更新 battleVersion: ${value}`);
        }
        break;
      }
    }
  }

  async ensureBattleVersion(timeout = 8000) {
    if (this.battleVersionSynced && this.battleVersion > 0) {
      console.log(`✅ 使用已有 battleVersion: ${this.battleVersion}`);
      return this.battleVersion;
    }
    try {
      console.log('🔄 正在获取最新 battleVersion...');
      const result = await this.sendWithPromise('fight_startlevel', {}, timeout);
      console.log('📦 fight_startlevel 响应:', JSON.stringify(result, null, 2).substring(0, 500));
      this._updateBattleVersion(result, result);
      if (!this.battleVersionSynced || !this.battleVersion) {
        console.warn(`⚠️ 未能从 fight_startlevel 获取有效 battleVersion，使用默认值 ${this.defaultBattleVersion}`);
        this.battleVersion = this.defaultBattleVersion;
      }
    } catch (error) {
      console.warn(`⚠️ 获取 battleVersion 失败: ${error.message}，使用默认值 ${this.defaultBattleVersion}`);
      this.battleVersion = this.defaultBattleVersion;
    }
    console.log(`✅ 最终 battleVersion: ${this.battleVersion}`);
    return this.battleVersion;
  }

  async signIn() {
    return this.sendWithPromise('system_signinreward', {});
  }

  async legionSignIn() {
    return this.sendWithPromise('legion_signin', {});
  }

  async claimDailyReward(rewardId = 0) {
    return this.sendWithPromise('task_claimdailyreward', { rewardId });
  }

  async claimDailyPoint(taskId) {
    return this.sendWithPromise('task_claimdailypoint', { taskId });
  }

  async claimWeeklyReward(rewardId = 0) {
    return this.sendWithPromise('task_claimweekreward', { rewardId });
  }

  async claimHangupReward() {
    return this.sendWithPromise('system_claimhangupreward', {});
  }

  async startArenaFight(targetId, battleVersion = 1) {
    const version = Number(battleVersion ?? this.battleVersion) || this.battleVersion || this.defaultBattleVersion || 241201;
    console.log(`⚔️ 竞技场战斗 targetId=${targetId}, battleVersion=${version}`);

    try {
      return await this.sendWithPromise('fight_startareaarena', { targetId });
    } catch (error) {
      const message = String(error?.message || '');
      if (!message.includes('版本过低')) {
        throw error;
      }

      console.warn(`⚠️ 竞技场无版本参数发起失败，尝试刷新 battleVersion 后重试: ${message}`);
      await this.ensureBattleVersion();
      const retryVersion = this.battleVersion || version;
      console.log(`🔁 竞技场战斗重试 targetId=${targetId}, battleVersion=${retryVersion}`);
      return this.sendWithPromise('fight_startareaarena', { targetId, battleVersion: retryVersion });
    }
  }

  async getArenaTargets(refresh = false) {
    return this.sendWithPromise('arena_getareatarget', { refresh });
  }

  async startArenaArea() {
    return this.sendWithPromise('arena_startarea', {});
  }

  async startTowerFight(battleVersion = 1) {
    const version = Number(battleVersion ?? this.battleVersion) || this.battleVersion || 241201;
    return this.sendWithPromise('fight_starttower', { battleVersion: version });
  }

  async getTowerInfo() {
    return this.sendWithPromise('tower_getinfo', {});
  }

  async claimTowerReward(rewardId) {
    return this.sendWithPromise('tower_claimreward', { rewardId });
  }

  async startBossFight(battleVersion = 1) {
    const version = Number(battleVersion ?? this.battleVersion) || this.battleVersion || 241201;
    return this.sendWithPromise('fight_startboss', { battleVersion: version });
  }

  async startDailyBossFight(bossId, battleVersion = 1) {
    const version = Number(battleVersion ?? this.battleVersion) || this.battleVersion || 241201;
    return this.sendWithPromise('fight_startboss', { bossId, battleVersion: version });
  }

  async startLegionBossFight(battleVersion = 1) {
    const version = Number(battleVersion ?? this.battleVersion) || this.battleVersion || 241201;
    return this.sendWithPromise('fight_startlegionboss', { battleVersion: version });
  }

  async getPresetTeamInfo() {
    return this.sendWithPromise('presetteam_getinfo', {});
  }

  async savePresetTeam(teamId) {
    return this.sendWithPromise('presetteam_saveteam', { teamId });
  }

  async recruitHero(recruitType = 3, recruitNumber = 1) {
    return this.sendWithPromise('hero_recruit', {
      byClub: false,
      recruitNumber,
      recruitType
    });
  }

  async sendFriendGold(friendId = 0) {
    return this.sendWithPromise('friend_batch', { friendId });
  }

  async buyGold(buyNum = 1) {
    return this.sendWithPromise('system_buygold', { buyNum });
  }

  async fishing(lotteryNumber = 1, type = 1) {
    return this.sendWithPromise('artifact_lottery', {
      lotteryNumber,
      newFree: true,
      type
    });
  }

  async claimAllMail(category = 0) {
    return this.sendWithPromise('mail_claimallattachment', { category });
  }

  async openBox(itemId = 2001, number = 10) {
    return this.sendWithPromise('item_openbox', { itemId, number });
  }

  async claimBoxPointReward() {
    return this.sendWithPromise('item_batchclaimboxpointreward', {});
  }

  async getMailList() {
    return this.sendWithPromise('mail_getlist', {
      category: [0, 4, 5],
      lastId: 0,
      size: 60
    });
  }

  async startStudy() {
    return this.sendWithPromise('study_startgame', {});
  }

  async answerStudy(studyId, questionId, answer) {
    return this.sendWithPromise('study_answer', {
      id: studyId,
      option: [answer],
      questionId: [questionId]
    });
  }

  async claimStudyReward(rewardId = 1) {
    return this.sendWithPromise('study_claimreward', { rewardId });
  }

  async addHangupTime() {
    const results = [];
    for (let i = 0; i < 4; i++) {
      results.push(
        await this.sendWithPromise('system_mysharecallback', {
          isSkipShareCard: true,
          type: 2
        })
      );
    }
    return { results };
  }

  async resetBottles() {
    await this.sendWithPromise('bottlehelper_stop', {});
    await this.sendWithPromise('bottlehelper_start', {});
    return { ok: true };
  }

  async claimAllBottles() {
    return this.sendWithPromise('bottlehelper_claim', {});
  }

  async smartSendCar() {
    const roleCarInfo = await this.sendWithPromise('car_getrolecar', {});
    const roleCar = roleCarInfo?.roleCar || roleCarInfo?.rolecar || {};
    const carDataMap = roleCar.carDataMap || roleCar.cardatamap || {};
    const cars = Object.entries(carDataMap).map(([id, info]) => ({ id, ...(info || {}) }));
    const sendResults = [];

    for (const car of cars) {
      const sendAt = Number(car.sendAt || 0);
      if (sendAt !== 0) continue;
      try {
        const result = await this.sendWithPromise('car_send', {
          carId: String(car.id),
          helperId: 0,
          text: '',
          isUpgrade: false
        });
        sendResults.push(result);
      } catch (error) {
        sendResults.push({ error: error.message });
      }
    }

    return { sendCount: sendResults.length, results: sendResults };
  }

  async claimAllCars() {
    const FOUR_HOURS_MS = 4 * 60 * 60 * 1000;
    const roleCarInfo = await this.sendWithPromise('car_getrolecar', {});
    const roleCar = roleCarInfo?.roleCar || roleCarInfo?.rolecar || {};
    const carDataMap = roleCar.carDataMap || roleCar.cardatamap || {};
    const now = Date.now();
    const cars = Object.entries(carDataMap).map(([id, info]) => ({ id, ...(info || {}) }));
    const claimResults = [];

    for (const car of cars) {
      const sendAt = Number(car.sendAt || 0);
      if (!sendAt) continue;
      if (sendAt + FOUR_HOURS_MS > now) continue;
      try {
        const result = await this.sendWithPromise('car_claim', { carId: String(car.id) });
        claimResults.push(result);
      } catch (error) {
        claimResults.push({ error: error.message });
      }
    }

    return { claimCount: claimResults.length, results: claimResults };
  }

  async blackMarketPurchase(goodsId = 1) {
    return this.sendWithPromise('store_purchase', { goodsId });
  }

  async directStoreBuy(goodsId = 1) {
    return this.sendWithPromise('store_buy', { goodsId });
  }

  async claimTreasureFreeReward() {
    return this.sendWithPromise('collection_claimfreereward', {});
  }

  async getLegacyInfo() {
    return this.sendWithPromise('legacy_getinfo', {});
  }

  async claimLegacyScrolls() {
    return this.sendWithPromise('legacy_claimhangup', {});
  }

  async beginLegacyHangup() {
    return this.sendWithPromise('legacy_beginhangup', {});
  }

  async reopenLegacyHangup(options = {}) {
    const {
      verifyAttempts = 5,
      verifyDelayMs = 1200,
    } = options;

    const legacyInfoBefore = await this.getLegacyInfo().catch(() => null);

    let beginResult = null;
    let beginError = null;
    try {
      beginResult = await this.beginLegacyHangup();
    } catch (error) {
      beginError = error;
    }

    const beginTimeFromResult = extractLegacyHangUpBeginTime(beginResult);
    if (beginTimeFromResult > 0) {
      return {
        beginResult,
        beginError: null,
        legacyInfoBefore,
        legacyInfoAfter: beginResult,
        hangUpBeginTime: beginTimeFromResult,
      };
    }

    const verificationSnapshots = [];
    let legacyInfoAfter = null;

    for (let attempt = 0; attempt < Math.max(1, Number(verifyAttempts) || 1); attempt += 1) {
      if (attempt > 0) {
        await sleep(Number(verifyDelayMs) || 1200);
      }

      legacyInfoAfter = await this.getLegacyInfo().catch((error) => {
        verificationSnapshots.push({
          attempt: attempt + 1,
          error: error?.message || String(error),
          context: summarizeLegacyErrorContext(error),
        });
        return null;
      });

      const beginTime = extractLegacyHangUpBeginTime(legacyInfoAfter);
      verificationSnapshots.push({
        attempt: attempt + 1,
        hangUpBeginTime: beginTime,
        roleLegacy: legacyInfoAfter?.roleLegacy || legacyInfoAfter?.rolelegacy || null,
      });

      if (beginTime > 0) {
        return {
          beginResult,
          beginError: null,
          legacyInfoBefore,
          legacyInfoAfter,
          verificationSnapshots,
          hangUpBeginTime: beginTime,
        };
      }
    }

    if (beginError) {
      beginError.legacyContext = {
        stage: 'legacy_beginhangup',
        legacyInfoBefore,
        verificationSnapshots,
        beginResult,
        beginError: summarizeLegacyErrorContext(beginError),
      };
      throw beginError;
    }

    const verifyError = new Error('残卷挂机开启命令已发送，但在轮询校验后仍未观察到 hangUpBeginTime 更新');
    verifyError.legacyContext = {
      stage: 'legacy_beginhangup_verify',
      legacyInfoBefore,
      beginResult,
      legacyInfoAfter,
      verificationSnapshots,
    };
    throw verifyError;
  }

  async startDreamBattle() {
    const dayOfWeek = new Date().getDay();
    if (dayOfWeek !== 0 && dayOfWeek !== 1 && dayOfWeek !== 3 && dayOfWeek !== 4) {
      return { skipped: true, reason: '当前不是梦境开放时间（周三/周四/周日/周一）' };
    }
    const battleTeam = { 0: 107 };
    const result = await this.sendWithPromise('dungeon_selecthero', { battleTeam }, 8000);
    return { success: true, result };
  }

  async startSkinChallenge() {
    const res = await this.sendWithPromise('towers_getinfo', {}, 8000);
    const towerData = res.actId ? res : (res.towerData && res.towerData.actId ? res.towerData : res);

    if (!towerData.actId) {
      return { skipped: true, reason: '换皮闯关活动信息获取失败' };
    }

    const actId = String(towerData.actId);
    if (actId.length >= 6) {
      const year = "20" + actId.substring(0, 2);
      const month = actId.substring(2, 4);
      const day = actId.substring(4, 6);
      const startDate = new Date(`${year}-${month}-${day}T00:00:00`);
      const endDate = new Date(startDate);
      endDate.setDate(startDate.getDate() + 7);
      const now = new Date();
      if (now < startDate || now >= endDate) {
        return { skipped: true, reason: '换皮闯关活动已结束' };
      }
    }

    const levelRewardMap = towerData.levelRewardMap || {};
    const todayWeekDay = new Date().getDay();
    const openTowerMap = {
      5: [1],
      6: [2],
      0: [3],
      1: [4],
      2: [5],
      3: [6],
      4: [1, 2, 3, 4, 5, 6]
    };
    const todayOpenTowers = openTowerMap[todayWeekDay] || [];

    const isTowerCleared = (type, map) => {
      const key1 = `${type}008`;
      const key2 = Number(key1);
      return !!(map[key1] || map[key2]);
    };

    const targetTowers = todayOpenTowers.filter(type => !isTowerCleared(type, levelRewardMap));

    if (targetTowers.length === 0) {
      return { skipped: true, reason: '今日换皮闯关已全部通关' };
    }

    const results = [];
    for (const type of targetTowers) {
      try {
        await this.sendWithPromise('towers_start', { towerType: type }, 5000);
        await new Promise(r => setTimeout(r, 300));

        let needStart = false;
        let loop = true;
        let failCount = 0;
        let cleared = false;

        while (loop && failCount < 3) {
          if (needStart) {
            await this.sendWithPromise('towers_start', { towerType: type }, 5000);
            await new Promise(r => setTimeout(r, 300));
          }

          const fightRes = await this.sendWithPromise('towers_fight', { towerType: type }, 5000);
          const battleData = fightRes?.battleData;
          const curHP = battleData?.result?.accept?.ext?.curHP;

          if (curHP === 0) {
            needStart = false;
            failCount = 0;

            const infoRes = await this.sendWithPromise('towers_getinfo', {}, 5000);
            const updatedData = infoRes.actId ? infoRes : (infoRes.towerData || infoRes);
            const updatedMap = updatedData.levelRewardMap || {};

            if (isTowerCleared(type, updatedMap)) {
              loop = false;
              cleared = true;
            }
          } else {
            needStart = true;
            failCount++;
          }
        }

        results.push({ type, cleared, failCount });
      } catch (error) {
        results.push({ type, error: error.message });
      }
    }

    return { success: true, results, clearedCount: results.filter(r => r.cleared).length };
  }

  async buyDreamItems(purchaseList = []) {
    const dayOfWeek = new Date().getDay();
    if (dayOfWeek !== 0 && dayOfWeek !== 1 && dayOfWeek !== 3 && dayOfWeek !== 4) {
      return { skipped: true, reason: '当前不是梦境开放时间（周三/周四/周日/周一）' };
    }

    if (!purchaseList || purchaseList.length === 0) {
      return { skipped: true, reason: '购买清单为空' };
    }

    const roleInfo = await this.getRoleInfo(15000);
    if (!roleInfo?.role?.dungeon?.merchant) {
      return { skipped: true, reason: '无法获取梦境商店数据' };
    }

    const merchantData = roleInfo.role.dungeon.merchant;
    const levelId = roleInfo.role.levelId || 0;

    if (levelId < 4000) {
      return { skipped: true, reason: '关卡数小于4000，无法购买' };
    }

    const operations = [];
    for (const itemKey of purchaseList) {
      const [targetMerchantId, targetItemIndex] = itemKey.split('-').map(Number);
      const merchantItems = merchantData[targetMerchantId];
      if (merchantItems) {
        for (let pos = 0; pos < merchantItems.length; pos++) {
          if (merchantItems[pos] === targetItemIndex) {
            operations.push({
              merchantId: targetMerchantId,
              index: targetItemIndex,
              pos: pos
            });
          }
        }
      }
    }

    operations.sort((a, b) => {
      if (a.merchantId !== b.merchantId) return a.merchantId - b.merchantId;
      return b.pos - a.pos;
    });

    const results = [];
    let successCount = 0;
    let failCount = 0;

    for (const op of operations) {
      try {
        const response = await this.sendWithPromise('dungeon_buymerchant', {
          id: op.merchantId,
          index: op.index,
          pos: op.pos
        }, 5000);

        if (response && response.reward) {
          successCount++;
          results.push({ merchantId: op.merchantId, index: op.index, success: true });
        } else {
          failCount++;
          results.push({ merchantId: op.merchantId, index: op.index, success: false });
        }
      } catch (error) {
        failCount++;
        results.push({ merchantId: op.merchantId, index: op.index, error: error.message });
      }
      await new Promise(r => setTimeout(r, 300));
    }

    return { success: true, successCount, failCount, results };
  }

  async genieSweep(options = {}) {
    const roleInfo = await this.getRoleInfo();
    const role = roleInfo?.role || {};
    const genie = role.genie || {};
    const sweepTicketCount = Number(role.items?.[1021]?.quantity || 0);

    if (sweepTicketCount <= 0) {
      return { skipped: true, reason: '扫荡券不足', sweepTicketCount: 0 };
    }

    let bestGenieId = 1;
    let maxLayer = -1;

    for (let i = 1; i <= 4; i++) {
      const layer = Number(genie[i] ?? -1);
      if (layer > maxLayer) {
        maxLayer = layer;
        bestGenieId = i;
      }
    }

    const targetGenieId = Number(options?.genieId || bestGenieId) || bestGenieId;
    const maxSweepPerReq = Math.max(1, Number(options?.maxSweepPerRequest || 20) || 20);
    const desiredTotal = Math.max(
      1,
      Number(options?.totalSweepCount || options?.sweepCnt || sweepTicketCount) || sweepTicketCount
    );
    let remaining = Math.min(sweepTicketCount, desiredTotal);
    let executed = 0;
    const results = [];

    while (remaining > 0) {
      const sweepCnt = Math.min(remaining, maxSweepPerReq);
      const res = await this.sendWithPromise('genie_sweep', {
        genieId: targetGenieId,
        sweepCnt
      });
      results.push(res);
      executed += sweepCnt;
      remaining -= sweepCnt;
    }

    return {
      genieId: targetGenieId,
      sweepTicketCount,
      executed,
      requestCount: results.length,
      results
    };
  }

  async genieDailySweep(options = {}) {
    const roleInfo = await this.getRoleInfo();
    const role = roleInfo?.role || {};
    const statisticsTime = role.statisticsTime || {};
    const genieNames = { 1: '魏国', 2: '蜀国', 3: '吴国', 4: '群雄' };
    const sweepResults = [];
    const ticketResults = [];

    const sendSweepWithRetry = async (genieId) => {
      try {
        return await this.sendWithPromise('genie_sweep', { genieId, sweepCnt: 1 }, 5000);
      } catch (error) {
        if (!String(error?.message || '').includes('出了点小问题')) {
          throw error;
        }
        await sleep(700);
        return this.sendWithPromise('genie_sweep', { genieId, sweepCnt: 1 }, 5000);
      }
    };

    const claimSweepTicket = async () => {
      try {
        return await this.sendWithPromise('genie_buysweep', {}, 5000);
      } catch (error) {
        if (!String(error?.message || '').includes('出了点小问题')) {
          throw error;
        }
        await sleep(700);
        return this.sendWithPromise('genie_buysweep', {}, 5000);
      }
    };

    for (let genieId = 1; genieId <= 4; genieId += 1) {
      const statKey = `genie:daily:free:${genieId}`;
      if (!isTodayAvailable(statisticsTime[statKey])) {
        sweepResults.push({ genieId, name: genieNames[genieId], skipped: true, reason: '今日已扫荡' });
        continue;
      }

      const result = await sendSweepWithRetry(genieId);
      sweepResults.push({ genieId, name: genieNames[genieId], success: true, result });
      await sleep(options.sweepDelayMs ?? 250);
    }

    for (let index = 0; index < 3; index += 1) {
      try {
        const result = await claimSweepTicket();
        ticketResults.push({ index: index + 1, success: true, result });
      } catch (error) {
        const message = String(error?.message || '');
        if (message.includes('购买数量超出限制') || message.includes('今天已经领取过奖励了')) {
          ticketResults.push({ index: index + 1, skipped: true, reason: '今日扫荡券已领取完' });
          break;
        }
        throw error;
      }
      await sleep(options.ticketDelayMs ?? 180);
    }

    const sweptCount = sweepResults.filter((item) => item.success).length;
    const claimedTickets = ticketResults.filter((item) => item.success).length;

    if (sweptCount === 0 && claimedTickets === 0) {
      return {
        skipped: true,
        reason: '四国已扫荡且今日扫荡券已领完',
        sweepResults,
        ticketResults,
      };
    }

    return {
      sweptCount,
      claimedTickets,
      sweepResults,
      ticketResults,
    };
  }
}

export default GameClient;
