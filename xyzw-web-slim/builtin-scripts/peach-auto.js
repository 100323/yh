// ==UserScript==
// @name         蟠桃园本地测试助手
// @namespace    local.test.lp.smart
// @version      3.0.0
// @description  仅用于 localhost/127.0.0.1 的蟠桃园 LEGION_PAYLOAD 本地调试助手。
// @match        http://localhost/*
// @match        http://127.0.0.1/*
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  const CFG = {
    tickMs: 800,
    enterCooldownMs: 10000,
    battleCooldownMs: 2200,
    moveCooldownMs: 3200,
    pickCooldownMs: 2600,
    useItemCooldownMs: 5000,
    deployCooldownMs: 5000,
    deployEnterDelayMs: 1200,
    reviveReadyGraceMs: 90000,
    attackRange: 1,
    maxRetries: 3,
    debug: true,
    verboseLog: false,
    strategy: {
      autoEnter: true,
      autoGetOnCar: true,
      autoAttack: true,
      autoPickItem: true,
      autoUseCarItem: true,
      protectCar: true,
      autoOpenDeploy: true,
      useMainTeam: true,
      carDistance: 2,
      priorityTarget: 'nearCar',
    },
  };

  const state = {
    running: false,
    lastEnter: 0,
    lastBattle: 0,
    lastMove: 0,
    lastPick: 0,
    lastUseItem: 0,
    lastDeployOpen: 0,
    currentCar: null,
    battleCount: 0,
    moveCount: 0,
    pickCount: 0,
    useItemCount: 0,
    deployCount: 0,
    deployPending: false,
    deployReady: false,
    deployBattlefieldId: '',
    lastSeenBattlefieldId: '',
    lastDeploySignature: '',
    deathCount: 0,
    wasDead: false,
    lastReviveSeconds: 0,
    lastDeathAt: 0,
    reviveDeadlineAt: 0,
    reviveReadyAt: 0,
    deployAfterRevivePending: false,
    lastForcedDeployAt: 0,
    errorCount: 0,
    lastError: '',
    enterPending: false,
    enterRetryCount: 0,
    lastSnapshot: null,
    taskLog: [],
  };

  const ui = {
    root: null,
    status: null,
    log: null,
    minimized: false,
    drag: null,
    moved: false,
    suppressClick: false,
  };

  const REQ_CANDIDATES = {
    ModuleManager: ['ModuleManager', '../modules/ModuleManager', './ModuleManager'],
    Configs: ['Configs', '../../../launcher/config/Configs', '../../../../launcher/config/Configs'],
    Types: ['types-legion-payload', './types-legion-payload', '../../modules/legionPayload/types-legion-payload'],
    LPSignal: ['LPSignal', './LPSignal', '../../modules/legionPayload/LPSignal'],
    DateUtil: ['DateUtil', '../core/utils/DateUtil', '../../core/utils/DateUtil'],
    ServerData: ['ServerData', '../orange/data/ServerData', '../../orange/data/ServerData'],
  };

  function reqOne(names) {
    if (!window.__require) return null;
    for (const name of names) {
      try {
        const mod = window.__require(name);
        if (mod) return mod;
      } catch (_) {
        // Try next candidate.
      }
    }
    return null;
  }

  function req(name) {
    return reqOne(REQ_CANDIDATES[name] || [name]);
  }

  function getServerTime() {
    const DateUtil = req('DateUtil');
    const value = DateUtil?.default?.serverTime ?? DateUtil?.serverTime;
    return typeof value === 'number' ? value : Date.now();
  }

  function getModules() {
    const ModuleManager = req('ModuleManager');
    const Configs = req('Configs');
    const Types = req('Types');
    if (!ModuleManager || !Configs) return null;
    return { ModuleManager, Configs, Types: Types || {} };
  }

  function getLP() {
    const mods = getModules();
    if (!mods?.Configs?.ModuleType) return null;
    try {
      return mods.ModuleManager.GET_MODULE(mods.Configs.ModuleType.LEGION_PAYLOAD);
    } catch (_) {
      return null;
    }
  }

  function log(...args) {
    if (CFG.debug) console.log('[蟠桃园助手]', ...args);
  }

  function logVerbose(...args) {
    if (CFG.debug && CFG.verboseLog) console.log('[蟠桃园助手]', ...args);
  }

  function logError(...args) {
    state.errorCount++;
    state.lastError = args.map((x) => String(x?.message || x)).join(' ');
    console.error('[蟠桃园助手错误]', ...args);
    addTask('error', state.lastError);
  }

  function addTask(type, message, data) {
    state.taskLog.unshift({
      at: new Date().toLocaleTimeString(),
      type,
      message,
      data,
    });
    if (state.taskLog.length > 100) state.taskLog.length = 100;
    renderUI();
  }

  function shouldRun(last, cooldown, now) {
    return now - last >= cooldown;
  }

  function forEachMapLike(value, fn) {
    if (!value) return;
    if (typeof value.forEach === 'function') {
      value.forEach(fn);
      return;
    }
    if (Array.isArray(value)) {
      value.forEach((v, i) => fn(v, i));
      return;
    }
    if (typeof value === 'object') {
      Object.keys(value).forEach((key) => fn(value[key], key));
    }
  }

  function pointOf(obj) {
    const p = obj?.position ?? obj?.pos ?? obj?.serverData?.position ?? obj;
    if (!p) return null;
    const x = Number(p.x);
    const y = Number(p.y);
    return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
  }

  function getId(obj, ...keys) {
    for (const key of keys) {
      const value = obj?.[key] ?? obj?.serverData?.[key];
      if (value !== undefined && value !== null && value !== '') return value;
    }
    return null;
  }

  function distance(a, b) {
    const pa = pointOf(a);
    const pb = pointOf(b);
    if (!pa || !pb) return Infinity;
    return Math.abs(pa.x - pb.x) + Math.abs(pa.y - pb.y);
  }

  function samePoint(a, b) {
    const pa = pointOf(a);
    const pb = pointOf(b);
    return !!pa && !!pb && pa.x === pb.x && pa.y === pb.y;
  }

  function getReviveSeconds(role, now = getServerTime()) {
    const rawSeconds = role?.reviveTime ?? role?.reviveSeconds ?? role?.remainReviveTime ?? role?.serverData?.reviveTime;
    const seconds = Number(rawSeconds);
    if (Number.isFinite(seconds) && seconds > 0) return Math.ceil(seconds);

    const rawAt = role?.reviveAt ?? role?.reviveTimeAt ?? role?.serverData?.reviveAt;
    const reviveAt = Number(rawAt);
    if (!Number.isFinite(reviveAt) || reviveAt <= 0) return 0;
    const nowSeconds = now > 1e12 ? now / 1000 : now;
    const reviveSeconds = reviveAt > 1e12 ? reviveAt / 1000 : reviveAt;
    return Math.max(0, Math.ceil(reviveSeconds - nowSeconds));
  }

  function getTrackedReviveSeconds(now = getServerTime()) {
    if (!state.reviveDeadlineAt) return state.lastReviveSeconds || 0;
    return Math.max(0, Math.ceil((state.reviveDeadlineAt - now) / 1000));
  }

  function markReviveReady(now = getServerTime()) {
    state.wasDead = false;
    state.lastReviveSeconds = 0;
    state.reviveDeadlineAt = 0;
    state.reviveReadyAt = now;
  }

  function isReviveReadyGrace(now = getServerTime()) {
    return !!state.reviveReadyAt && now - state.reviveReadyAt <= CFG.reviveReadyGraceMs;
  }

  function clearReviveReady() {
    state.reviveReadyAt = 0;
  }
  function getBattlefield(lp = getLP()) {
    return lp?.lPWarData?.battlefield || null;
  }

  function getSelf(bf = getBattlefield()) {
    return bf?.self || null;
  }

  function isEnemy(self, role) {
    if (!self || !role) return false;
    const selfId = getId(self, 'roleId', 'id');
    const roleId = getId(role, 'roleId', 'id');
    if (selfId && roleId && selfId === roleId) return false;
    if (role.isDead || role.dead) return false;
    if (role.legionId !== undefined && self.legionId !== undefined && role.legionId === self.legionId) return false;
    if (role.campId !== undefined && self.campId !== undefined && role.campId === self.campId) return false;
    return !!pointOf(role);
  }

  function isRoleOnCar(role, car) {
    const roleId = getId(role, 'roleId', 'id');
    if (!roleId || !car) return false;
    if (role.isOnCar) return true;
    if (car.memberMap?.has?.(roleId)) return true;
    const queues = [car.friendQueue, car.enemyQueue, car.battleQueue, car.members, car.memberList];
    return queues.some((list) => Array.isArray(list) && list.some((item) => getId(item, 'roleId', 'id') === roleId));
  }

  function getCars(bf) {
    const cars = [];
    forEachMapLike(bf?.carData, (car) => {
      if (car && !car.isEndMarch) cars.push(car);
    });
    return cars;
  }

  function getRoles(bf) {
    const roles = [];
    forEachMapLike(bf?.roles || bf?.roleData || bf?.playerData, (role) => {
      if (role) roles.push(role);
    });
    return roles;
  }

  function getItems(bf) {
    const items = [];
    forEachMapLike(bf?.itemData || bf?.items || bf?.dropItemData, (item) => {
      if (item && pointOf(item)) items.push(item);
    });
    return items;
  }

  function pickBestCar(bf, self) {
    const cars = getCars(bf);
    if (!cars.length || !pointOf(self)) return null;

    const onCar = cars.find((car) => isRoleOnCar(self, car));
    if (onCar) return onCar;

    return cars
      .map((car) => ({ car, dist: distance(self, car) }))
      .filter((x) => Number.isFinite(x.dist))
      .sort((a, b) => a.dist - b.dist)[0]?.car || null;
  }

  function pickBestEnemy(bf, self, car) {
    const enemies = getRoles(bf)
      .filter((role) => isEnemy(self, role))
      .map((role) => ({
        role,
        dist: distance(self, role),
        carDist: car ? distance(role, car) : Infinity,
        onCar: car ? isRoleOnCar(role, car) : !!role.isOnCar,
      }))
      .filter((x) => x.dist <= CFG.attackRange);

    if (!enemies.length) return null;

    if (CFG.strategy.priorityTarget === 'onCar') {
      const hit = enemies.find((x) => x.onCar);
      if (hit) return hit.role;
    }

    if (CFG.strategy.priorityTarget === 'nearCar' && car) {
      const hit = enemies
        .filter((x) => x.carDist <= CFG.strategy.carDistance)
        .sort((a, b) => a.carDist - b.carDist || a.dist - b.dist)[0];
      if (hit) return hit.role;
    }

    return enemies.sort((a, b) => a.dist - b.dist)[0].role;
  }

  function pickBestItem(bf, self) {
    return getItems(bf)
      .map((item) => ({ item, dist: distance(self, item) }))
      .filter((x) => Number.isFinite(x.dist))
      .sort((a, b) => a.dist - b.dist)[0]?.item || null;
  }

  function makePoint(x, y) {
    return { x: Number(x), y: Number(y) };
  }

  function buildPath(lp, target) {
    const bf = getBattlefield(lp);
    const self = getSelf(bf);
    const selfPos = pointOf(self);
    const targetPos = pointOf(target);
    if (!selfPos || !targetPos) return null;

    if (samePoint(selfPos, targetPos)) return [];

    const sourceMap = lp?.lPWarData?.sourceMap || lp?.sourceMap || bf?.sourceMap;
    try {
      if (sourceMap?.map?.refreshMarchData) {
        sourceMap.map.refreshMarchData(selfPos.x, selfPos.y);
      }
      if (typeof sourceMap?.marchArr === 'function') {
        const arr = sourceMap.marchArr(targetPos.x, targetPos.y) || [];
        const path = arr
          .slice()
          .reverse()
          .map(pointOf)
          .filter(Boolean);
        if (path.length) {
          const last = path[path.length - 1];
          if (last.x !== targetPos.x || last.y !== targetPos.y) path.push(targetPos);
          return path.map((p) => makePoint(p.x, p.y));
        }
      }
    } catch (error) {
      logVerbose('寻路失败', error);
    }

    return [makePoint(targetPos.x, targetPos.y)];
  }

  function sendMoveTo(lp, target, carId = 0) {
    const path = buildPath(lp, target);
    if (!path) return false;
    if (!path.length) return true;

    if (carId && typeof lp.sendGetCar === 'function') {
      lp.sendGetCar(carId, path);
    } else if (typeof lp.sendMarch === 'function') {
      lp.sendMarch(path);
    } else {
      return false;
    }

    state.moveCount++;
    addTask('ok', `移动到 ${pointText(target)}，路径 ${path.length} 步`);
    return true;
  }

  function safeCall(name, fn) {
    try {
      const result = fn();
      addTask('ok', `${name} 已发送`);
      return result;
    } catch (error) {
      logError(`${name} 失败`, error);
      return null;
    }
  }

  function getRoleData() {
    const ServerData = req('ServerData');
    return ServerData?.ROLE || null;
  }

  function getHeroIdFromTeamEntry(entry) {
    const heroId = Number(entry?.heroId ?? entry?.id ?? entry);
    return Number.isFinite(heroId) && heroId > 0 ? heroId : 0;
  }

  function buildMainTeamDeployPayload() {
    const role = getRoleData();
    const battleTeam = new Map();

    forEachMapLike(role?.battleTeam, (entry, slot) => {
      const heroId = getHeroIdFromTeamEntry(entry);
      const slotId = Number(slot);
      if (heroId && Number.isFinite(slotId)) battleTeam.set(slotId, heroId);
    });

    return {
      battleTeam,
      lordWeaponId: Number(role?.lordWeaponId ?? 0) || 0,
      petUId: role?.petData?.petUId || role?.petUId || '',
    };
  }

  function deploySignature(payload) {
    if (!payload?.battleTeam?.size) return '';
    const team = [];
    payload.battleTeam.forEach((heroId, slot) => team.push(`${slot}:${heroId}`));
    team.sort();
    return `${team.join('|')}|w:${payload.lordWeaponId || 0}|p:${payload.petUId || ''}`;
  }

  function deployMainTeam(lp = getLP(), force = false) {
    if (!lp) {
      addTask('error', '未找到 LEGION_PAYLOAD 模块');
      return false;
    }
    if (!lp?.sendSetBattleTeam && !lp?.deployData?.sendSetBattleTeam) {
      addTask('error', '未找到蟠桃园保存布阵接口');
      return false;
    }

    const payload = buildMainTeamDeployPayload();
    if (!payload.battleTeam.size) {
      addTask('error', 'main team is empty, cannot deploy');
      return false;
    }

    const bf = getBattlefield(lp);
    const battlefieldId = bf?.id || '';
    const signature = deploySignature(payload);
    if (!force && state.deployReady && state.deployBattlefieldId === battlefieldId && state.lastDeploySignature === signature) return true;
    if (state.deployPending) return true;

    state.deployPending = true;
    state.deployReady = false;
    state.deployBattlefieldId = battlefieldId;
    state.lastDeploySignature = signature;

    const send = () => {
      if (lp.deployData?.dealDeploy) {
        return Promise.resolve(lp.deployData.dealDeploy(payload.battleTeam, payload.lordWeaponId, payload.petUId))
          .then(() => (lp.sendSetBattleTeam ? lp.sendSetBattleTeam(payload.battleTeam, payload.lordWeaponId, payload.petUId) : lp.deployData.sendSetBattleTeam()));
      }
      return lp.sendSetBattleTeam(payload.battleTeam, payload.lordWeaponId, payload.petUId);
    };

    try {
      const result = send();
      Promise.resolve(result)
        .then(() => {
          state.deployCount++;
          state.deployReady = true;
          state.deployBattlefieldId = battlefieldId;
          addTask('ok', `布阵已提交：${payload.battleTeam.size} 个武将`);
          updateSnapshot();
        })
        .catch((error) => {
          state.deployReady = false;
          state.lastDeploySignature = '';
          logError('布阵失败', error);
        })
        .finally(() => {
          state.deployPending = false;
        });
      return true;
    } catch (error) {
      state.deployPending = false;
      state.deployReady = false;
      state.lastDeploySignature = '';
          logError('布阵失败', error);
      return false;
    }
  }

  function resetDeployState() {
    state.deployReady = false;
    state.deployBattlefieldId = '';
    state.lastDeploySignature = '';
  }

  function forceDeployOnce(lp = getLP(), reason = '自动布阵一次', now = getServerTime(), enterAfter = false, ignoreCooldown = false) {
    if (!CFG.strategy.autoOpenDeploy) return false;
    if (state.deployPending) return true;
    if (!ignoreCooldown && !shouldRun(state.lastForcedDeployAt, CFG.deployCooldownMs, now)) return false;

    resetDeployState();
    state.lastDeployOpen = now;
    state.lastForcedDeployAt = now;
    addTask('info', reason);
    const ok = deployMainTeam(lp, true);

    if (ok && enterAfter) {
      setTimeout(() => {
        const nextLp = getLP();
        if (state.running && nextLp) tryEnterBattle(nextLp, true);
      }, CFG.deployEnterDelayMs);
    }
    return ok;
  }

  function tryEnterBattle(lp, force = false) {
    const now = getServerTime();
    if (!force && !CFG.strategy.autoEnter) return false;
    if (!force && !shouldRun(state.lastEnter, CFG.enterCooldownMs, now)) return false;
    if (!lp?.startBattle) return false;

    state.lastEnter = now;
    state.enterPending = true;
    state.enterRetryCount++;

    if (state.enterRetryCount > CFG.maxRetries) {
      state.enterPending = false;
      state.enterRetryCount = 0;
      addTask('error', '进场重试次数过多，已停止自动进场');
      return false;
    }

    safeCall('进入战场', () => lp.startBattle(force));
    return true;
  }

  function ensureDeployReady(lp, self, now) {
    if (!self || self.isDead) return false;
    if (!CFG.strategy.autoOpenDeploy) return true;
    const bf = getBattlefield(lp);
    const battlefieldId = bf?.id || '';
    if (state.deployReady && state.deployBattlefieldId === battlefieldId) return true;
    if (state.deployPending) return false;
    if (!shouldRun(state.lastDeployOpen, CFG.deployCooldownMs, now)) return false;

    state.lastDeployOpen = now;
    if (CFG.strategy.useMainTeam && deployMainTeam(lp, false)) return false;
    if (lp?.sendStart) safeCall('open deploy', () => lp.sendStart());
    return false;
  }

  function tick() {
    if (!state.running) return;

    try {
      const lp = getLP();
      if (!lp) return;

      const bf = getBattlefield(lp);
      const now = getServerTime();

      if (!bf?.self) {
        if (state.deployAfterRevivePending || state.wasDead) {
          const reviveLeft = getTrackedReviveSeconds(now);
          if (reviveLeft <= 0) {
            markReviveReady(now);
            if (forceDeployOnce(lp, '复活倒计时结束，自动布阵并进场', now, true, true)) {
              state.deployAfterRevivePending = false;
            }
          }
        }
        tryEnterBattle(lp, false);
        updateSnapshot();
        return;
      }

      if (state.enterPending) {
        state.enterPending = false;
        state.enterRetryCount = 0;
        resetDeployState();
        addTask('ok', '已进入战场');
      }

      const self = bf.self;
      const currentBattlefieldId = bf?.id || 'unknown';
      if (state.lastSeenBattlefieldId !== currentBattlefieldId) {
        state.lastSeenBattlefieldId = currentBattlefieldId;
        forceDeployOnce(lp, '进入战场，自动布阵一次', now, false, true);
      }

      if (state.deployBattlefieldId && state.deployBattlefieldId !== bf.id) {
        resetDeployState();
      }

      if ((self.isDead || self.dead) && isReviveReadyGrace(now)) {
        state.lastReviveSeconds = 0;
        state.reviveDeadlineAt = 0;
        if (forceDeployOnce(lp, '复活已就绪，自动布阵并进场', now, true, false)) {
          state.deployAfterRevivePending = false;
        }
        updateSnapshot();
        return;
      }

      if (self.isDead || self.dead) {
        const reviveSeconds = getReviveSeconds(self, now);
        if (!state.wasDead) {
          state.deathCount++;
          state.lastDeathAt = now;
          state.wasDead = true;
          state.lastReviveSeconds = reviveSeconds;
          state.reviveDeadlineAt = now + Math.max(1, reviveSeconds || 0) * 1000;
          state.deployAfterRevivePending = true;
          addTask('info', `战斗失败，等待复活：${state.lastReviveSeconds || '-'}秒`);
        } else {
          state.lastReviveSeconds = getTrackedReviveSeconds(now);
        }
        if (state.deployAfterRevivePending && getTrackedReviveSeconds(now) <= 0) {
          markReviveReady(now);
          if (forceDeployOnce(lp, '复活倒计时结束，自动布阵并进场', now, true, true)) {
            state.deployAfterRevivePending = false;
          }
        }
        updateSnapshot();
        return;
      }
      clearReviveReady();
      if (state.wasDead) {
        state.wasDead = false;
        state.lastReviveSeconds = 0;
        state.reviveDeadlineAt = 0;
        clearReviveReady();
        addTask('ok', '已复活，继续执行');
        if (state.deployAfterRevivePending) {
          state.deployAfterRevivePending = false;
          forceDeployOnce(lp, '复活完成，自动布阵并进场', now, true, true);
        } else {
          state.deployAfterRevivePending = false;
        }
      }

      ensureDeployReady(lp, self, now);

      state.currentCar = pickBestCar(bf, self);

      if (CFG.strategy.autoPickItem && shouldRun(state.lastPick, CFG.pickCooldownMs, now)) {
        const item = pickBestItem(bf, self);
        if (item && distance(self, item) <= 1 && lp.sendPickItem) {
          state.lastPick = now;
          state.pickCount++;
          safeCall('拾取道具', () => lp.sendPickItem());
        }
      }

      if (CFG.strategy.autoUseCarItem && state.currentCar && shouldRun(state.lastUseItem, CFG.useItemCooldownMs, now)) {
        const carId = getId(state.currentCar, 'carId', 'id');
        if (carId && lp.sendUse) {
          state.lastUseItem = now;
          state.useItemCount++;
          safeCall(`使用车辆道具 ${carId}`, () => lp.sendUse(carId));
        }
      }

      if (CFG.strategy.autoGetOnCar && state.currentCar && !isRoleOnCar(self, state.currentCar)) {
        const carId = getId(state.currentCar, 'carId', 'id');
        if (carId && shouldRun(state.lastMove, CFG.moveCooldownMs, now)) {
          state.lastMove = now;
          sendMoveTo(lp, state.currentCar, carId);
        }
      }

      if (CFG.strategy.autoAttack && shouldRun(state.lastBattle, CFG.battleCooldownMs, now)) {
        const enemy = pickBestEnemy(bf, self, state.currentCar);
        const enemyId = getId(enemy, 'roleId', 'id');
        if (enemyId && lp.sendBattle) {
          state.lastBattle = now;
          state.battleCount++;
          safeCall(`攻击 ${enemyId}`, () => lp.sendBattle(enemyId));
        }
      }

      updateSnapshot();
    } catch (error) {
      logError('主循环异常', error);
      if (state.errorCount > CFG.maxRetries) {
        state.running = false;
        addTask('error', '错误次数过多，已自动暂停');
      }
    }
  }

  function updateSnapshot() {
    state.lastSnapshot = getDetailedStatus();
    renderUI();
  }

  function pointText(value) {
    const p = pointOf(value);
    return p ? `${p.x},${p.y}` : '-';
  }

  function getDetailedStatus() {
    const lp = getLP();
    const bf = getBattlefield(lp);
    const mods = getModules();
    if (!lp) return { ready: false, status: '未找到 LEGION_PAYLOAD 模块' };
    if (!bf?.self) {
      return {
        ready: true,
        status: '未进入战场',
        stage: lp.lpMatchDay?.stage,
        isBattleDay: !!lp.isBattleDay,
        isSignUp: !!lp.lpMatchDay?.isSignUp,
        hasRed: !!lp.hasRed?.(),
      };
    }

    const self = bf.self;
    const reviveSeconds = isReviveReadyGrace() ? 0 : (state.wasDead ? getTrackedReviveSeconds() : getReviveSeconds(self));
    const car = state.currentCar || pickBestCar(bf, self);
    const roles = getRoles(bf);
    const enemies = roles.filter((role) => isEnemy(self, role));
    const nearbyEnemies = enemies.filter((role) => distance(self, role) <= CFG.attackRange);
    const cars = getCars(bf);
    const items = getItems(bf);

    return {
      ready: true,
      status: '战场中',
      bfId: bf.id,
      selfId: getId(self, 'roleId', 'id'),
      selfState: self.state,
      selfPos: pointOf(self),
      isDead: !!(self.isDead || self.dead),
      reviveSeconds,
      isOnCar: !!(car && isRoleOnCar(self, car)),
      stage: lp.lpMatchDay?.stage,
      stageName: stageName(lp.lpMatchDay?.stage, mods?.Types),
      carCount: cars.length,
      currentCarId: getId(car, 'carId', 'id'),
      currentCarPos: pointOf(car),
      enemyCount: enemies.length,
      nearbyEnemyCount: nearbyEnemies.length,
      itemCount: items.length,
      nearestItemPos: pointOf(pickBestItem(bf, self)),
    };
  }

  function stageName(value, Types) {
    const LPStage = Types?.LPStage;
    if (!LPStage || value === undefined || value === null) return value ?? '-';
    return LPStage[value] || String(value);
  }

  function cssText() {
    return `
      #lp-smart-panel {
        position: fixed;
        right: 20px;
        bottom: 20px;
        z-index: 2147483647;
        width: min(400px, calc(100vw - 28px));
        max-height: min(720px, calc(100vh - 28px));
        color: #e2e8f0;
        background: linear-gradient(145deg, rgba(15, 23, 42, 0.95), rgba(8, 14, 26, 0.98));
        backdrop-filter: blur(16px);
        -webkit-backdrop-filter: blur(16px);
        border: 1px solid rgba(56, 189, 248, 0.2);
        border-radius: 14px;
        box-shadow: 0 20px 48px -8px rgba(0, 0, 0, 0.65), 0 0 24px rgba(56, 189, 248, 0.12), inset 0 1px 1px rgba(255, 255, 255, 0.1);
        font: 12px/1.45 ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
        overflow: hidden;
        touch-action: auto;
        transition: box-shadow 0.2s ease, border-color 0.2s ease;
      }
      #lp-smart-panel.lp-min {
        width: 52px;
        height: 52px;
        max-height: 52px;
        border-radius: 50%;
        background: rgba(11, 15, 25, 0.92);
        border: 1px solid rgba(56, 189, 248, 0.4);
        box-shadow: 0 8px 30px rgba(0, 0, 0, 0.7), 0 0 16px rgba(56, 189, 248, 0.35);
        backdrop-filter: blur(8px);
      }
      #lp-smart-panel * { box-sizing: border-box; }
      #lp-smart-panel .lp-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        padding: 11px 14px;
        border-bottom: 1px solid rgba(255, 255, 255, 0.08);
        background: linear-gradient(180deg, rgba(255, 255, 255, 0.04) 0%, rgba(255, 255, 255, 0) 100%);
        cursor: pointer;
        user-select: none;
        touch-action: none;
      }
      #lp-smart-panel.lp-min .lp-head {
        width: 52px;
        height: 52px;
        padding: 0;
        border: 0;
        background: transparent;
        justify-content: center;
      }
      #lp-smart-panel.lp-min .lp-title,
      #lp-smart-panel.lp-min [data-action="toggleRun"] { display: none; }
      #lp-smart-panel.lp-min [data-action="min"] {
        width: 44px;
        height: 44px;
        padding: 0;
        border-radius: 50%;
        border: 1px solid rgba(56, 189, 248, 0.4);
        background: radial-gradient(circle at 35% 35%, #38bdf8 0%, #0369a1 45%, #082f49 85%, #030712 100%);
        box-shadow: 0 0 12px rgba(56, 189, 248, 0.5), inset 0 0 8px rgba(255, 255, 255, 0.4);
        font-size: 0;
        position: relative;
        cursor: move;
        outline: none;
      }
      #lp-smart-panel.lp-min [data-action="min"]::before {
        content: '';
        position: absolute;
        top: 50%;
        left: 50%;
        width: 22px;
        height: 22px;
        transform: translate(-50%, -50%);
        border-radius: 50%;
        border: 2px dashed rgba(224, 242, 254, 0.7);
        pointer-events: none;
      }
      #lp-smart-panel.lp-min [data-action="min"]::after {
        content: '';
        position: absolute;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        width: 8px;
        height: 8px;
        border-radius: 50%;
        background: #ffffff;
        box-shadow: 0 0 8px #ffffff, 0 0 14px #38bdf8;
      }
      #lp-smart-panel .lp-title {
        font-weight: 700;
        font-size: 13px;
        letter-spacing: 0.02em;
        color: #f8fafc;
        display: flex;
        align-items: center;
        gap: 6px;
      }
      #lp-smart-panel .lp-title::before {
        content: '';
        display: inline-block;
        width: 8px;
        height: 8px;
        border-radius: 50%;
        background: #38bdf8;
        box-shadow: 0 0 8px #38bdf8;
      }
      #lp-smart-panel .lp-body {
        display: grid;
        gap: 10px;
        padding: 12px;
        max-height: calc(min(720px, 100vh - 28px) - 52px);
        max-height: calc(min(720px, 100dvh - 28px) - 52px);
        overflow-x: hidden;
        overflow-y: auto;
        overscroll-behavior: contain;
        -webkit-overflow-scrolling: touch;
        touch-action: pan-y;
      }
      #lp-smart-panel .lp-body::-webkit-scrollbar { width: 5px; }
      #lp-smart-panel .lp-body::-webkit-scrollbar-thumb { background: rgba(255, 255, 255, 0.15); border-radius: 4px; }
      #lp-smart-panel.lp-min .lp-body { display: none; }
      #lp-smart-panel .lp-row { display: flex; align-items: center; gap: 7px; flex-wrap: wrap; }
      #lp-smart-panel button,
      #lp-smart-panel select {
        height: 30px;
        border: 1px solid rgba(255, 255, 255, 0.12);
        border-radius: 7px;
        color: #f1f5f9;
        background: rgba(30, 41, 59, 0.65);
        padding: 0 11px;
        font: inherit;
        font-size: 12px;
        font-weight: 500;
        cursor: pointer;
        touch-action: manipulation;
        transition: all 0.18s ease;
        outline: none;
      }
      #lp-smart-panel button:hover,
      #lp-smart-panel select:hover {
        background: rgba(51, 65, 85, 0.85);
        border-color: rgba(56, 189, 248, 0.4);
        color: #ffffff;
      }
      #lp-smart-panel button:active { transform: scale(0.97); }
      #lp-smart-panel button[data-active="true"] {
        color: #042f2e;
        background: linear-gradient(135deg, #34d399, #10b981);
        border-color: #34d399;
        font-weight: 700;
        box-shadow: 0 0 12px rgba(16, 185, 129, 0.35);
      }
      #lp-smart-panel select {
        padding-right: 18px;
        background-color: #1e293b;
      }
      #lp-smart-panel [data-action="min"] {
        font-weight: 700;
        width: 28px;
        height: 28px;
        padding: 0;
        line-height: 24px;
        border-radius: 6px;
      }
      #lp-smart-panel .lp-card {
        border: 1px solid rgba(255, 255, 255, 0.08);
        border-radius: 9px;
        padding: 9px 11px;
        background: rgba(15, 23, 42, 0.55);
        box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.03);
      }
      #lp-smart-panel .lp-stats {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 8px 12px;
      }
      #lp-smart-panel .lp-stat {
        min-width: 0;
        color: #94a3b8;
        font-size: 11.5px;
        display: flex;
        align-items: center;
        justify-content: space-between;
        background: rgba(255, 255, 255, 0.02);
        padding: 3px 6px;
        border-radius: 5px;
      }
      #lp-smart-panel .lp-stat b {
        color: #38bdf8;
        font-weight: 600;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        margin-left: 6px;
      }
      #lp-smart-panel .lp-log {
        max-height: 170px;
        overflow: auto;
        overscroll-behavior: contain;
        -webkit-overflow-scrolling: touch;
        touch-action: pan-y;
        display: grid;
        gap: 5px;
        font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
        font-size: 11px;
        padding-right: 2px;
      }
      #lp-smart-panel .lp-log::-webkit-scrollbar { width: 4px; }
      #lp-smart-panel .lp-log::-webkit-scrollbar-thumb { background: rgba(255, 255, 255, 0.12); border-radius: 4px; }
      #lp-smart-panel .lp-log-item {
        display: grid;
        grid-template-columns: 66px 1fr;
        gap: 6px;
        color: #cbd5e1;
        padding: 2px 4px;
        border-radius: 4px;
        background: rgba(255, 255, 255, 0.02);
      }
      #lp-smart-panel .lp-log-time { color: #64748b; }
      #lp-smart-panel .lp-log-item[data-type="error"] { color: #f87171; background: rgba(239, 68, 68, 0.1); }
      #lp-smart-panel .lp-log-item[data-type="ok"] { color: #34d399; }
      @media (max-width: 520px) {
        #lp-smart-panel:not(.lp-min) { left: 8px !important; right: 8px !important; top: 8px !important; bottom: auto !important; width: auto; max-height: calc(100vh - 16px); max-height: calc(100dvh - 16px); font-size: 13px; }
        #lp-smart-panel.lp-min { left: auto !important; right: 12px !important; top: auto !important; bottom: 12px !important; width: 48px; height: 48px; max-height: 48px; }
        #lp-smart-panel.lp-min .lp-head { width: 48px; height: 48px; }
        #lp-smart-panel.lp-min [data-action="min"] { width: 40px; height: 40px; }
        #lp-smart-panel .lp-head { min-height: 44px; padding: 7px 10px; }
        #lp-smart-panel .lp-body { max-height: calc(100vh - 58px); max-height: calc(100dvh - 58px); gap: 8px; padding: 8px; }
        #lp-smart-panel button, #lp-smart-panel select { min-height: 36px; height: 36px; font-size: 13px; }
        #lp-smart-panel .lp-row { gap: 6px; }
        #lp-smart-panel .lp-stats { grid-template-columns: repeat(2, minmax(0, 1fr)); }
        #lp-smart-panel .lp-card { padding: 8px; }
        #lp-smart-panel .lp-log { max-height: 150px; }
        #lp-smart-panel .lp-log-item { grid-template-columns: 56px minmax(0, 1fr); overflow-wrap: anywhere; }
      }
    `;
  }

  const UI_POS_KEY = 'lp-smart-panel-pos-v1';

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function loadPanelPos() {
    try {
      const raw = localStorage.getItem(UI_POS_KEY);
      if (!raw) return null;
      const data = JSON.parse(raw);
      const x = Number(data.x);
      const y = Number(data.y);
      return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
    } catch (_) {
      return null;
    }
  }

  function savePanelPos(pos) {
    try {
      localStorage.setItem(UI_POS_KEY, JSON.stringify(pos));
    } catch (_) {
      // ignore storage failure
    }
  }

  function applyPanelPos(root, pos) {
    if (!root || !pos) return;
    const width = root.offsetWidth || 58;
    const height = root.offsetHeight || 58;
    const x = clamp(Number(pos.x) || 0, 0, Math.max(0, window.innerWidth - width));
    const y = clamp(Number(pos.y) || 0, 0, Math.max(0, window.innerHeight - height));
    root.style.left = `${x}px`;
    root.style.top = `${y}px`;
    root.style.right = 'auto';
    root.style.bottom = 'auto';
  }

  function initPanelDrag(root) {
    root.addEventListener('pointerdown', (event) => {
      const head = event.target.closest('.lp-head');
      if (!head) return;
      if (!root.classList.contains('lp-min') && event.target.closest('button,select')) return;

      const rect = root.getBoundingClientRect();
      ui.drag = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        offsetX: event.clientX - rect.left,
        offsetY: event.clientY - rect.top,
        startedMinimized: root.classList.contains('lp-min'),
      };
      ui.moved = false;
      root.setPointerCapture?.(event.pointerId);
      event.preventDefault();
    });

    root.addEventListener('pointermove', (event) => {
      if (!ui.drag || event.pointerId !== ui.drag.pointerId) return;
      const dx = Math.abs(event.clientX - ui.drag.startX);
      const dy = Math.abs(event.clientY - ui.drag.startY);
      if (dx + dy > 4) ui.moved = true;
      if (!ui.moved) return;

      const width = root.offsetWidth || 58;
      const height = root.offsetHeight || 58;
      const x = clamp(event.clientX - ui.drag.offsetX, 0, Math.max(0, window.innerWidth - width));
      const y = clamp(event.clientY - ui.drag.offsetY, 0, Math.max(0, window.innerHeight - height));
      root.style.left = `${x}px`;
      root.style.top = `${y}px`;
      root.style.right = 'auto';
      root.style.bottom = 'auto';
      event.preventDefault();
    });

    const finish = (event) => {
      if (!ui.drag || event.pointerId !== ui.drag.pointerId) return;
      root.releasePointerCapture?.(event.pointerId);
      if (ui.moved) {
        const rect = root.getBoundingClientRect();
        savePanelPos({ x: rect.left, y: rect.top });
      } else if (ui.drag.startedMinimized) {
        ui.suppressClick = true;
        toggleMinimized(root.querySelector('[data-action="min"]'));
      }
      ui.drag = null;
      setTimeout(() => {
        ui.moved = false;
        ui.suppressClick = false;
      }, 0);
    };
    root.addEventListener('pointerup', finish);
    root.addEventListener('pointercancel', finish);
  }

  function initUI() {
    if (ui.root || !document.body) return;

    const style = document.createElement('style');
    style.textContent = cssText();
    document.head.appendChild(style);

    const root = document.createElement('div');
    root.id = 'lp-smart-panel';
    root.innerHTML = `
      <div class="lp-head">
        <div class="lp-title">自动蟠桃园</div>
        <div class="lp-row">
          <button type="button" data-action="toggleRun"></button>
          <button type="button" data-action="min" title="收起为圆形图标">-</button>
        </div>
      </div>
      <div class="lp-body">
        <div class="lp-card lp-stats" data-role="status"></div>
        <div class="lp-card">
          <div class="lp-row">
            <button type="button" data-action="autoEnter">自动进场</button>
            <button type="button" data-action="autoCar">自动上车</button>
            <button type="button" data-action="autoAttack">自动攻击</button>
            <button type="button" data-action="autoPick">自动拾取</button>
            <button type="button" data-action="autoUse">使用车辆道具</button>
            <button type="button" data-action="autoDeploy">自动布阵</button>
          </div>
          <div class="lp-row" style="margin-top:8px">
            <select data-action="priority">
              <option value="nearCar">优先护车</option>
              <option value="onCar">优先车上敌人</option>
              <option value="nearest">优先最近敌人</option>
            </select>
            <button type="button" data-action="enterNow">手动进场</button>
            <button type="button" data-action="deployNow">布阵一次</button>
            <button type="button" data-action="moveCar">去最近车</button>
            <button type="button" data-action="attackNow">攻击一次</button>
            <button type="button" data-action="pickNow">拾取一次</button>
          </div>
        </div>
        <div class="lp-card">
          <div class="lp-row" style="justify-content:space-between;margin-bottom:6px">
            <b>日志</b>
            <span class="lp-row">
              <button type="button" data-action="diagnose">诊断</button>
              <button type="button" data-action="reset">重置统计</button>
              <button type="button" data-action="clearLog">清空</button>
            </span>
          </div>
          <div class="lp-log" data-role="log"></div>
        </div>
      </div>
    `;

    root.addEventListener('click', onPanelClick);
    root.addEventListener('change', onPanelChange);
    document.body.appendChild(root);
    initPanelDrag(root);
    applyPanelPos(root, loadPanelPos());

    ui.root = root;
    ui.status = root.querySelector('[data-role="status"]');
    ui.log = root.querySelector('[data-role="log"]');
    renderUI();
  }

  function onPanelClick(event) {
    if (ui.suppressClick) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    if (ui.moved) return;
    const button = event.target.closest('button');
    if (!button) return;
    const action = button.dataset.action;
    const api = window.__LP_SMART__;

    if (action && !['min', 'diagnose', 'reset', 'clearLog'].includes(action)) {
      window.__broadcastAutomationControl?.('peach', 'click', { action });
    }

    if (action === 'toggleRun') state.running ? api.stop() : api.start();
    if (action === 'min') {
      toggleMinimized(button);
      return;
      ui.minimized = !ui.minimized;
      ui.root.classList.toggle('lp-min', ui.minimized);
      const rect = ui.root.getBoundingClientRect();
      applyPanelPos(ui.root, { x: rect.left, y: rect.top });
      const nextRect = ui.root.getBoundingClientRect();
      savePanelPos({ x: nextRect.left, y: nextRect.top });
      button.title = ui.minimized ? '展开助手' : '收起助手';
    }
    if (action === 'autoEnter') api.setStrategy('autoEnter', !CFG.strategy.autoEnter);
    if (action === 'autoCar') api.setStrategy('autoGetOnCar', !CFG.strategy.autoGetOnCar);
    if (action === 'autoAttack') api.setStrategy('autoAttack', !CFG.strategy.autoAttack);
    if (action === 'autoPick') api.setStrategy('autoPickItem', !CFG.strategy.autoPickItem);
    if (action === 'autoUse') api.setStrategy('autoUseCarItem', !CFG.strategy.autoUseCarItem);
    if (action === 'autoDeploy') api.setStrategy('autoOpenDeploy', !CFG.strategy.autoOpenDeploy);
    if (action === 'enterNow') api.enterNow();
    if (action === 'deployNow') api.deployNow();
    if (action === 'moveCar') api.moveToCar();
    if (action === 'attackNow') api.attackNearest();
    if (action === 'pickNow') api.pickItem();
    if (action === 'diagnose') api.diagnose();
    if (action === 'reset') api.resetStats();
    if (action === 'clearLog') {
      state.taskLog.length = 0;
      renderUI();
    }
  }

  function toggleMinimized(button) {
    if (!ui.root) return;
    ui.minimized = !ui.minimized;
    ui.root.classList.toggle('lp-min', ui.minimized);
    const rect = ui.root.getBoundingClientRect();
    applyPanelPos(ui.root, { x: rect.left, y: rect.top });
    const nextRect = ui.root.getBoundingClientRect();
    savePanelPos({ x: nextRect.left, y: nextRect.top });
      button.title = ui.minimized ? '展开助手' : '收起助手';
  }

  function onPanelChange(event) {
    const select = event.target.closest('select[data-action="priority"]');
    if (select) {
      window.__broadcastAutomationControl?.('peach', 'change', { action: 'priority', value: select.value });
      window.__LP_SMART__.setStrategy('priorityTarget', select.value);
    }
  }

  function renderUI() {
    if (!ui.root) return;

    const detail = state.lastSnapshot || getDetailedStatus();

    setButton('toggleRun', state.running, state.running ? '暂停' : '启动');
    setButton('autoEnter', CFG.strategy.autoEnter);
    setButton('autoCar', CFG.strategy.autoGetOnCar);
    setButton('autoAttack', CFG.strategy.autoAttack);
    setButton('autoPick', CFG.strategy.autoPickItem);
    setButton('autoUse', CFG.strategy.autoUseCarItem);
    setButton('autoDeploy', CFG.strategy.autoOpenDeploy);

    const priority = ui.root.querySelector('[data-action="priority"]');
    if (priority) priority.value = CFG.strategy.priorityTarget;

    const fields = [
      ['运行', state.running ? '运行中' : '已暂停'],
      ['状态', detail.status || '-'],
      ['战场', detail.bfId || '-'],
      ['阶段', detail.stageName || detail.stage || '-'],
      ['自身', detail.selfPos ? pointText(detail.selfPos) : '-'],
      ['复活', detail.isDead ? `${detail.reviveSeconds || state.lastReviveSeconds || '-'}秒` : '-'],
      ['车辆', detail.currentCarId || '-'],
      ['敌人', detail.nearbyEnemyCount ?? '-'],
      ['道具', detail.itemCount ?? '-'],
      ['移动', state.moveCount],
      ['攻击', state.battleCount],
      ['拾取', state.pickCount],
      ['布阵', state.deployPending ? '提交中' : (state.deployReady ? '已完成' : state.deployCount)],
      ['错误', state.errorCount],
    ];

    ui.status.replaceChildren(...fields.map(([label, value]) => {
      const item = document.createElement('div');
      item.className = 'lp-stat';
      const b = document.createElement('b');
      b.textContent = String(value);
      item.append(label, b);
      return item;
    }));

    ui.log.replaceChildren(...state.taskLog.slice(0, 50).map((entry) => {
      const row = document.createElement('div');
      row.className = 'lp-log-item';
      row.dataset.type = entry.type;
      const time = document.createElement('span');
      time.className = 'lp-log-time';
      time.textContent = entry.at;
      const msg = document.createElement('span');
      msg.textContent = entry.message;
      row.append(time, msg);
      return row;
    }));
  }

  function setButton(action, active, text) {
    const btn = ui.root?.querySelector(`[data-action="${action}"]`);
    if (!btn) return;
    btn.dataset.active = String(active);
    if (text) btn.textContent = text;
  }

  function setStrategy(key, value) {
    if (!Object.prototype.hasOwnProperty.call(CFG.strategy, key)) return false;
    CFG.strategy[key] = value;
    addTask('info', `${strategyName(key)} = ${valueText(value)}`);
    renderUI();
    return true;
  }

  function strategyName(key) {
    return {
      autoEnter: '自动进场',
      autoGetOnCar: '自动上车',
      autoAttack: '自动攻击',
      autoPickItem: '自动拾取',
      autoUseCarItem: '使用车辆道具',
      protectCar: '护车',
      autoOpenDeploy: '自动布阵',
      useMainTeam: '使用主阵容',
      carDistance: '车辆距离',
      priorityTarget: '目标优先级',
    }[key] || key;
  }

  function valueText(value) {
    if (value === true) return '开启';
    if (value === false) return '关闭';
    return String(value);
  }

  const timer = setInterval(tick, CFG.tickMs);
  const uiTimer = setInterval(updateSnapshot, 1000);

  window.__LP_SMART__ = {
    start() {
      state.running = true;
      state.errorCount = 0;
      addTask('info', '已启动');
      log('已启动');
      renderUI();
    },
    stop() {
      state.running = false;
      addTask('info', '已暂停');
      log('已停止');
      renderUI();
    },
    stopTimer() {
      clearInterval(timer);
      clearInterval(uiTimer);
      state.running = false;
      addTask('info', '定时器已停止');
      renderUI();
    },
    setStrategy,
    setConfig(key, value) {
      if (!Object.prototype.hasOwnProperty.call(CFG, key) || key === 'strategy') return false;
      CFG[key] = value;
      addTask('info', `配置 ${strategyName(key)} = ${valueText(value)}`);
      renderUI();
      return true;
    },
    enterNow() {
      const lp = getLP();
      if (!lp) return addTask('error', '未找到 LEGION_PAYLOAD 模块');
      return tryEnterBattle(lp, true);
    },
    deployNow() {
      const lp = getLP();
      return deployMainTeam(lp, true);
    },
    moveToCar() {
      const lp = getLP();
      const bf = getBattlefield(lp);
      const self = getSelf(bf);
      const car = pickBestCar(bf, self);
      const carId = getId(car, 'carId', 'id');
      if (!lp || !bf || !self || !carId) return addTask('error', '没有可用车辆或未进入战场');
      state.currentCar = car;
      return sendMoveTo(lp, car, carId);
    },
    attackNearest() {
      const lp = getLP();
      const bf = getBattlefield(lp);
      const self = getSelf(bf);
      const car = state.currentCar || pickBestCar(bf, self);
      const enemy = pickBestEnemy(bf, self, car);
      const enemyId = getId(enemy, 'roleId', 'id');
      if (!lp?.sendBattle || !enemyId) return addTask('error', 'no enemy in attack range');
      state.battleCount++;
      return safeCall(`攻击 ${enemyId}`, () => lp.sendBattle(enemyId));
    },
    pickItem() {
      const lp = getLP();
      if (!lp?.sendPickItem) return addTask('error', '未找到 sendPickItem');
      state.pickCount++;
      return safeCall('拾取道具', () => lp.sendPickItem());
    },
    useCarItem(carId) {
      const lp = getLP();
      const bf = getBattlefield(lp);
      const self = getSelf(bf);
      const car = carId ? getCars(bf).find((x) => String(getId(x, 'carId', 'id')) === String(carId)) : state.currentCar || pickBestCar(bf, self);
      const id = getId(car, 'carId', 'id');
      if (!lp?.sendUse || !id) return addTask('error', '没有可用车辆道具目标');
      state.useItemCount++;
      return safeCall(`使用车辆道具 ${id}`, () => lp.sendUse(id));
    },
    diagnose() {
      const lp = getLP();
      const detail = getDetailedStatus();
      console.table(detail);
      console.log('[蟠桃园助手] LP module:', lp);
      addTask('info', `diagnose done: ${detail.status || '-'}`);
      return detail;
    },
    getStats() {
      return {
        running: state.running,
        battleCount: state.battleCount,
        moveCount: state.moveCount,
        pickCount: state.pickCount,
        useItemCount: state.useItemCount,
        deployCount: state.deployCount,
        deployPending: state.deployPending,
        deployReady: state.deployReady,
        deployBattlefieldId: state.deployBattlefieldId,
        lastSeenBattlefieldId: state.lastSeenBattlefieldId,
        deathCount: state.deathCount,
        wasDead: state.wasDead,
        lastReviveSeconds: state.lastReviveSeconds,
        lastDeathAt: state.lastDeathAt,
        deployAfterRevivePending: state.deployAfterRevivePending,
        lastForcedDeployAt: state.lastForcedDeployAt,
        errorCount: state.errorCount,
        lastError: state.lastError,
        enterRetryCount: state.enterRetryCount,
        enterPending: state.enterPending,
        currentCarId: getId(state.currentCar, 'carId', 'id'),
        strategy: { ...CFG.strategy },
      };
    },
    getDetailedStatus,
    getStatus() {
      return { ...state };
    },
    getConfig() {
      return { ...CFG, strategy: { ...CFG.strategy } };
    },
    resetStats() {
      state.battleCount = 0;
      state.moveCount = 0;
      state.pickCount = 0;
      state.useItemCount = 0;
      state.deathCount = 0;
      state.wasDead = false;
      state.lastReviveSeconds = 0;
      state.lastDeathAt = 0;
      state.reviveDeadlineAt = 0;
      state.reviveReadyAt = 0;
      state.deployAfterRevivePending = false;
      state.lastSeenBattlefieldId = '';
      state.lastForcedDeployAt = 0;
      state.errorCount = 0;
      state.lastError = '';
      state.enterRetryCount = 0;
      state.enterPending = false;
      addTask('info', 'stats reset');
      renderUI();
    },
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initUI, { once: true });
  } else {
    initUI();
  }

  addTask('info', '助手已加载，接口：window.__LP_SMART__');
  log('已加载，接口：window.__LP_SMART__');
})();