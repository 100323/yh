/**
 * 代理池管理器 - 核心代理池管理（后端版本）
 */

import { ProxyFetcher } from './ProxyFetcher.js';
import { ProxyValidator } from './ProxyValidator.js';
import { PROXY_CONFIG, PROXY_SOURCES } from './config.js';
import fs from 'fs/promises';
import path from 'path';

const PROXY_POOL_FILE = path.join(process.cwd(), 'data', 'proxy_pool.json');
const PROXY_STATS_FILE = path.join(process.cwd(), 'data', 'proxy_stats.json');

export class ProxyPoolManager {
  constructor(config = {}) {
    this.config = { ...PROXY_CONFIG, ...config };
    this.fetcher = new ProxyFetcher();
    this.validator = new ProxyValidator();

    this.proxyPool = [];
    this.proxyStats = {
      totalFetched: 0,
      totalValidated: 0,
      totalUsed: 0,
      lastRefreshTime: null
    };

    this.isRefreshing = false;
    this.isValidating = false;
    this.assignedProxies = new Map(); // accountId -> proxy
    this.initialized = false;
    this.initPromise = null;
    this.validationTimer = null;
    this.warmupPromise = null;
    this.warmupStatus = {
      running: false,
      startedAt: null,
      finishedAt: null,
      lastError: null
    };
  }

  /**
   * 初始化代理池
   */
  async init() {
    if (this.initialized) {
      return;
    }

    console.log('[ProxyPoolManager] 初始化代理池');

    // 确保数据目录存在
    await fs.mkdir(path.dirname(PROXY_POOL_FILE), { recursive: true });

    // 加载已有代理池
    await this.loadFromDisk();
    const prunedCount = this.pruneDisabledSourceProxies();
    if (prunedCount > 0) {
      await this.saveToDisk();
    }

    // 如果代理池为空或过期，自动刷新
    if (this.proxyPool.length === 0 || this.isPoolExpired()) {
      await this.refreshPool();
    } else {
      console.log(`[ProxyPoolManager] 加载已有代理池: ${this.proxyPool.length} 个代理`);
      // 后台验证现有代理
      this.validatePool().catch(err => {
        console.error('[ProxyPoolManager] 后台验证失败:', err);
      });
    }

    // 启动定期验证
    this.startPeriodicValidation();
    this.initialized = true;
  }

  getEnabledSourceIds() {
    return new Set(
      PROXY_SOURCES
        .filter(source => source.enabled)
        .map(source => source.sourceId)
        .filter(Boolean)
    );
  }

  pruneDisabledSourceProxies() {
    const enabledSourceIds = this.getEnabledSourceIds();
    if (enabledSourceIds.size === 0 || this.proxyPool.length === 0) {
      return 0;
    }

    const beforeCount = this.proxyPool.length;
    this.proxyPool = this.proxyPool.filter(proxy => enabledSourceIds.has(proxy.source || 'unknown'));

    const removedIds = new Set();
    for (const [accountId, assigned] of this.assignedProxies.entries()) {
      if (!enabledSourceIds.has(assigned?.proxy?.source || 'unknown')) {
        removedIds.add(assigned?.proxy?.id);
        this.assignedProxies.delete(accountId);
      }
    }

    const removedCount = beforeCount - this.proxyPool.length;
    if (removedCount > 0) {
      console.log(`[ProxyPoolManager] 已清理禁用来源代理 ${removedCount} 个${removedIds.size ? `，释放分配 ${removedIds.size} 个` : ''}`);
    }
    return removedCount;
  }

  /**
   * 按需初始化代理池，避免代理功能关闭时产生后台网络请求/定时器
   */
  async ensureInitialized() {
    if (this.initialized) {
      return;
    }

    if (!this.initPromise) {
      this.initPromise = this.init().finally(() => {
        this.initPromise = null;
      });
    }

    await this.initPromise;
  }

  /**
   * 非阻塞初始化：任务热路径只触发后台预热，不等待代理源抓取/验证。
   */
  ensureInitializedInBackground(reason = 'background') {
    if (this.initialized || this.initPromise) {
      return this.getWarmupStatus();
    }

    console.log(`[ProxyPoolManager] 后台初始化代理池 (${reason})`);
    this.warmupStatus = {
      running: true,
      startedAt: new Date().toISOString(),
      finishedAt: null,
      lastError: null
    };
    this.initPromise = this.init()
      .catch((error) => {
        this.warmupStatus.lastError = error?.message || String(error);
        console.error('[ProxyPoolManager] 后台初始化失败:', error);
      })
      .finally(() => {
        this.warmupStatus.running = false;
        this.warmupStatus.finishedAt = new Date().toISOString();
        this.initPromise = null;
      });

    return this.getWarmupStatus();
  }

  /**
   * 后台预热代理池。立即返回状态，避免管理接口被代理验证阻塞。
   */
  startWarmup() {
    if (this.warmupPromise) {
      return this.getWarmupStatus();
    }

    this.warmupStatus = {
      running: true,
      startedAt: new Date().toISOString(),
      finishedAt: null,
      lastError: null
    };

    this.warmupPromise = (async () => {
      try {
        await this.ensureInitialized();
        await this.refreshPool();
      } catch (error) {
        this.warmupStatus.lastError = error?.message || String(error);
        console.error('[ProxyPoolManager] 代理池预热失败:', error);
      } finally {
        this.warmupStatus.running = false;
        this.warmupStatus.finishedAt = new Date().toISOString();
        this.warmupPromise = null;
      }
    })();

    return this.getWarmupStatus();
  }

  getWarmupStatus() {
    return {
      ...this.warmupStatus,
      running: !!this.warmupPromise || !!this.warmupStatus.running
    };
  }

  /**
   * 从磁盘加载代理池
   */
  async loadFromDisk() {
    try {
      const poolData = await fs.readFile(PROXY_POOL_FILE, 'utf-8');
      this.proxyPool = JSON.parse(poolData);

      const statsData = await fs.readFile(PROXY_STATS_FILE, 'utf-8');
      this.proxyStats = JSON.parse(statsData);

      console.log(`[ProxyPoolManager] 从磁盘加载 ${this.proxyPool.length} 个代理`);
    } catch (error) {
      // 文件不存在或解析失败，使用默认值
      this.proxyPool = [];
      this.proxyStats = {
        totalFetched: 0,
        totalValidated: 0,
        totalUsed: 0,
        lastRefreshTime: null
      };
    }
  }

  /**
   * 保存代理池到磁盘
   */
  async saveToDisk() {
    try {
      await fs.writeFile(PROXY_POOL_FILE, JSON.stringify(this.proxyPool, null, 2));
      await fs.writeFile(PROXY_STATS_FILE, JSON.stringify(this.proxyStats, null, 2));
    } catch (error) {
      console.error('[ProxyPoolManager] 保存到磁盘失败:', error);
    }
  }

  /**
   * 刷新代理池
   */
  async refreshPool() {
    if (this.isRefreshing) {
      console.warn('[ProxyPoolManager] 代理池正在刷新中');
      return;
    }

    this.isRefreshing = true;
    console.log('[ProxyPoolManager] 开始刷新代理池');

    try {
      const newProxies = await this.fetcher.fetchAll();
      console.log(`[ProxyPoolManager] 获取到 ${newProxies.length} 个新代理`);

      if (newProxies.length === 0) {
        console.warn('[ProxyPoolManager] 未获取到任何代理');
        return;
      }

      const existingIds = new Set(this.proxyPool.map(p => p.id));
      const uniqueFetchedProxies = newProxies.filter(p => !existingIds.has(p.id));
      const maxValidationCandidates = Math.max(1, Number(this.config.maxValidationCandidates || 300));
      const candidatesForValidation = this.selectValidationCandidates(
        uniqueFetchedProxies,
        maxValidationCandidates
      );

      if (uniqueFetchedProxies.length > candidatesForValidation.length) {
        console.log(`[ProxyPoolManager] 候选代理过多，仅验证前 ${candidatesForValidation.length}/${uniqueFetchedProxies.length} 个`);
      }

      const validatedProxies = await this.validator.validateBatch(candidatesForValidation);
      const validProxies = validatedProxies.filter(p => p.isValid);

      console.log(`[ProxyPoolManager] 验证完成: ${validProxies.length}/${candidatesForValidation.length} 个代理可用`);

      // 合并到代理池（去重）
      const uniqueNewProxies = validProxies.filter(p => !existingIds.has(p.id));

      this.proxyPool = [
        ...this.proxyPool,
        ...uniqueNewProxies
      ].slice(0, this.config.maxPoolSize);

      // 更新统计
      this.proxyStats.totalFetched += newProxies.length;
      this.proxyStats.totalValidated += validatedProxies.length;
      this.proxyStats.lastRefreshTime = Date.now();

      // 保存到磁盘
      await this.saveToDisk();

      console.log(`[ProxyPoolManager] 代理池刷新完成: 当前 ${this.proxyPool.length} 个可用代理`);
    } catch (error) {
      console.error('[ProxyPoolManager] 刷新代理池失败:', error);
    } finally {
      this.isRefreshing = false;
    }
  }

  /**
   * 验证代理池
   */
  async validatePool() {
    if (this.isValidating) {
      console.warn('[ProxyPoolManager] 代理池正在验证中');
      return;
    }

    this.isValidating = true;
    console.log('[ProxyPoolManager] 开始验证代理池');

    try {
      const validatedProxies = await this.validator.validateBatch(this.proxyPool);

      // 更新代理池，移除失败次数过多的代理
      this.proxyPool = validatedProxies.filter(p => {
        return p.isValid || p.failCount < 3;
      });

      const validCount = this.proxyPool.filter(p => p.isValid).length;
      console.log(`[ProxyPoolManager] 验证完成: ${validCount}/${this.proxyPool.length} 个代理可用`);

      // 保存到磁盘
      await this.saveToDisk();

      // 如果可用代理不足，自动补充
      if (validCount < this.config.minPoolSize) {
        console.log('[ProxyPoolManager] 可用代理不足，开始补充');
        await this.refreshPool();
      }
    } catch (error) {
      console.error('[ProxyPoolManager] 验证代理池失败:', error);
    } finally {
      this.isValidating = false;
    }
  }

  /**
   * 获取一个可用代理
   */
  getProxy(accountId = null, options = {}) {
    const {
      allowInitialize = false,
      triggerWarmup = true
    } = options;

    if (!this.initialized) {
      if (allowInitialize) {
        throw new Error('getProxy() does not support blocking initialization; call ensureInitialized() first');
      }
      if (triggerWarmup) {
        this.ensureInitializedInBackground('get-proxy-fast-path');
      }
      console.warn('[ProxyPoolManager] 代理池尚未初始化，快路径返回空代理');
      return null;
    }

    if ((this.isRefreshing || this.isValidating) && triggerWarmup) {
      console.log('[ProxyPoolManager] 代理池正在后台刷新/验证，任务快路径使用当前可用快照');
    }

    // 如果该账号已分配代理且仍在冷却期内，返回同一个代理
    if (accountId && this.assignedProxies.has(accountId)) {
      const assigned = this.assignedProxies.get(accountId);
      const cooldownRemaining = assigned.lastUsed + this.config.proxyCooldown - Date.now();

      if (cooldownRemaining > 0) {
        const currentProxy = this.proxyPool.find(p => p.id === assigned.proxy.id);
        if (!currentProxy || !currentProxy.isValid) {
          console.log(`[ProxyPoolManager] 已分配代理 ${assigned.proxy.id} 不可用，重新选择`);
          this.assignedProxies.delete(accountId);
        } else {
          assigned.proxy = currentProxy;
          console.log(`[ProxyPoolManager] 复用已分配代理 ${assigned.proxy.id} (冷却剩余 ${Math.ceil(cooldownRemaining / 1000)}s)`);
          return assigned.proxy;
        }
      } else {
        this.assignedProxies.delete(accountId);
      }
    }

    // 获取可用代理列表
    const now = Date.now();
    const availableProxies = this.proxyPool.filter(proxy => {
      if (!proxy.isValid) return false;
      if (!proxy.lastUsed) return true;
      return (now - proxy.lastUsed) > this.config.proxyCooldown;
    });

    if (availableProxies.length === 0) {
      console.warn('[ProxyPoolManager] 没有可用代理');
      const anyValid = this.proxyPool.find(p => p.isValid);
      if (anyValid) {
        console.log('[ProxyPoolManager] 使用冷却期内的代理（无其他选择）');
        return this.assignProxy(anyValid, accountId);
      }
      return null;
    }

    // 选择最优代理
    const bestProxy = this.selectBestProxy(availableProxies);
    return this.assignProxy(bestProxy, accountId);
  }

  /**
   * 分配代理给账号
   */
  assignProxy(proxy, accountId) {
    // 更新代理使用时间
    const proxyIndex = this.proxyPool.findIndex(p => p.id === proxy.id);
    if (proxyIndex !== -1) {
      this.proxyPool[proxyIndex].lastUsed = Date.now();
      this.proxyPool[proxyIndex].usedCount = Number(this.proxyPool[proxyIndex].usedCount || 0) + 1;
      proxy = this.proxyPool[proxyIndex];
    }

    // 记录分配关系
    if (accountId) {
      this.assignedProxies.set(accountId, {
        proxy,
        lastUsed: Date.now()
      });
    }

    // 更新统计
    this.proxyStats.totalUsed++;

    console.log(`[ProxyPoolManager] 分配代理 ${proxy.id} 给账号 ${accountId || 'unknown'}`);

    return proxy;
  }

  /**
   * 选择最优代理
   */
  selectBestProxy(proxies) {
    const scoredProxies = proxies.map(proxy => {
      const totalAttempts = proxy.successCount + proxy.failCount;
      const successRate = totalAttempts > 0 ? proxy.successCount / totalAttempts : 0.5;
      const speedScore = proxy.responseTime ? Math.max(0, 1 - proxy.responseTime / 5000) : 0.5;
      const usedCount = Number(proxy.usedCount || 0);

      return {
        proxy,
        usedCount,
        lastUsed: Number(proxy.lastUsed || 0),
        score: successRate * 0.7 + speedScore * 0.3
      };
    });

    scoredProxies.sort((a, b) => {
      if (a.usedCount !== b.usedCount) {
        return a.usedCount - b.usedCount;
      }
      if (a.lastUsed !== b.lastUsed) {
        return a.lastUsed - b.lastUsed;
      }
      return b.score - a.score;
    });
    return scoredProxies[0].proxy;
  }

  /**
   * 按来源均衡抽样待验证代理，避免某个大源占满验证名额。
   */
  selectValidationCandidates(proxies, limit) {
    const normalizedLimit = Math.max(1, Number(limit) || 300);
    const groups = new Map();

    proxies.forEach((proxy) => {
      const source = proxy.source || 'unknown';
      if (!groups.has(source)) {
        groups.set(source, []);
      }
      groups.get(source).push(proxy);
    });

    const sources = Array.from(groups.keys());
    const selected = [];
    let cursor = 0;

    while (selected.length < normalizedLimit && sources.length > 0) {
      const source = sources[cursor % sources.length];
      const group = groups.get(source) || [];
      const proxy = group.shift();

      if (proxy) {
        selected.push(proxy);
      }

      if (group.length === 0) {
        groups.delete(source);
        sources.splice(cursor % sources.length, 1);
        cursor = 0;
      } else {
        cursor += 1;
      }
    }

    return selected;
  }

  /**
   * 标记代理为失败
   */
  markProxyFailed(proxyId) {
    const proxyIndex = this.proxyPool.findIndex(p => p.id === proxyId);
    if (proxyIndex !== -1) {
      this.proxyPool[proxyIndex].failCount++;
      this.proxyPool[proxyIndex].isValid = false;

      console.log(`[ProxyPoolManager] 标记代理 ${proxyId} 为失败 (失败次数: ${this.proxyPool[proxyIndex].failCount})`);

      // 如果失败次数过多，从池中移除
      if (this.proxyPool[proxyIndex].failCount >= 5) {
        this.proxyPool.splice(proxyIndex, 1);
        console.log(`[ProxyPoolManager] 移除失败代理 ${proxyId}`);
        this.saveToDisk();
      }
    }
  }

  /**
   * 标记代理为成功
   */
  markProxySuccess(proxyId) {
    const proxyIndex = this.proxyPool.findIndex(p => p.id === proxyId);
    if (proxyIndex !== -1) {
      this.proxyPool[proxyIndex].successCount++;
      this.proxyPool[proxyIndex].isValid = true;
      this.proxyPool[proxyIndex].lastUsed = Date.now();
    }
  }

  /**
   * 释放账号的代理分配
   */
  releaseProxy(accountId) {
    if (this.assignedProxies.has(accountId)) {
      const assigned = this.assignedProxies.get(accountId);
      console.log(`[ProxyPoolManager] 释放代理 ${assigned.proxy.id} (账号: ${accountId})`);
      this.assignedProxies.delete(accountId);
    }
  }

  /**
   * 检查代理池是否过期
   */
  isPoolExpired() {
    if (!this.proxyStats.lastRefreshTime) return true;
    const age = Date.now() - this.proxyStats.lastRefreshTime;
    const maxAge = 24 * 60 * 60 * 1000; // 24小时
    return age > maxAge;
  }

  /**
   * 启动定期验证
   */
  startPeriodicValidation() {
    if (this.validationTimer) {
      return;
    }

    this.validationTimer = setInterval(() => {
      if (!this.isValidating && !this.isRefreshing) {
        this.validatePool().catch(err => {
          console.error('[ProxyPoolManager] 定期验证失败:', err);
        });
      }
    }, this.config.validationInterval);

    console.log('[ProxyPoolManager] 已启动定期验证');
  }

  /**
   * 获取代理池统计信息
   */
  getStats() {
    const validProxies = this.proxyPool.filter(p => p.isValid);
    const avgResponseTime = validProxies.length > 0
      ? validProxies.reduce((sum, p) => sum + (p.responseTime || 0), 0) / validProxies.length
      : 0;

    return {
      total: this.proxyPool.length,
      valid: validProxies.length,
      invalid: this.proxyPool.length - validProxies.length,
      assigned: this.assignedProxies.size,
      avgResponseTime: Math.round(avgResponseTime),
      warmup: this.getWarmupStatus(),
      sources: {
        total: PROXY_SOURCES.length,
        enabled: PROXY_SOURCES.filter(source => source.enabled).length,
        enabledNames: PROXY_SOURCES.filter(source => source.enabled).map(source => source.name),
        enabledSourceIds: PROXY_SOURCES.filter(source => source.enabled).map(source => source.sourceId).filter(Boolean)
      },
      ...this.proxyStats
    };
  }

  /**
   * 清空代理池
   */
  async clearPool() {
    this.proxyPool = [];
    this.assignedProxies.clear();
    await this.saveToDisk();
    console.log('[ProxyPoolManager] 代理池已清空');
  }
}

// 导出单例
export const proxyPoolManager = new ProxyPoolManager();
