/**
 * 代理配置管理器
 * 管理账号级别的代理使用策略
 */

import fs from 'fs/promises';
import path from 'path';
import { proxyPoolManager } from './proxyPool/index.js';

const PROXY_CONFIG_FILE = path.join(process.cwd(), 'data', 'proxy_config.json');
const DEFAULT_PROXY_CONFIG = {
  enabled: false,
  fallbackToDirect: true,
  maxRetries: 3,
  rollout: {
    strategy: 'whitelist', // whitelist | percentage | all | none
    whitelist: [], // 账号名称列表
    percentage: 0,
    excludeList: []
  }
};

function normalizeNameList(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return Array.from(new Set(
    value
      .map((item) => String(item || '').trim())
      .filter(Boolean)
  ));
}

function normalizeRollout(rollout = {}) {
  const strategy = ['whitelist', 'percentage', 'all', 'none'].includes(rollout?.strategy)
    ? rollout.strategy
    : DEFAULT_PROXY_CONFIG.rollout.strategy;
  const percentage = Math.max(0, Math.min(100, Number(rollout?.percentage || 0)));

  return {
    strategy,
    whitelist: normalizeNameList(rollout?.whitelist),
    percentage: Number.isFinite(percentage) ? percentage : 0,
    excludeList: normalizeNameList(rollout?.excludeList)
  };
}

function normalizeConfig(config = {}) {
  return {
    ...DEFAULT_PROXY_CONFIG,
    ...(config || {}),
    enabled: !!config?.enabled,
    fallbackToDirect: config?.fallbackToDirect !== false,
    maxRetries: Math.max(1, Math.min(10, Number(config?.maxRetries || DEFAULT_PROXY_CONFIG.maxRetries))),
    rollout: normalizeRollout(config?.rollout)
  };
}

class ProxyConfigManager {
  constructor() {
    this.config = normalizeConfig();

    this.accountProxyStats = new Map(); // accountName -> { successCount, failCount, lastUsed }
    this.initPromise = this.init();
  }

  async init() {
    await this.loadConfig();
  }

  async ensureLoaded() {
    if (this.initPromise) {
      await this.initPromise;
    }
  }

  /**
   * 加载配置
   */
  async loadConfig() {
    try {
      const data = await fs.readFile(PROXY_CONFIG_FILE, 'utf-8');
      this.config = normalizeConfig(JSON.parse(data));
      console.log('[ProxyConfigManager] 配置已加载');
    } catch (error) {
      // 文件不存在，使用默认配置
      await this.saveConfig();
    }
  }

  /**
   * 保存配置
   */
  async saveConfig() {
    try {
      await fs.mkdir(path.dirname(PROXY_CONFIG_FILE), { recursive: true });
      await fs.writeFile(PROXY_CONFIG_FILE, JSON.stringify(this.config, null, 2));
    } catch (error) {
      console.error('[ProxyConfigManager] 保存配置失败:', error);
    }
  }

  /**
   * 更新配置
   */
  async updateConfig(updates) {
    await this.ensureLoaded();
    this.config = normalizeConfig({
      ...this.config,
      ...(updates || {}),
      rollout: {
        ...(this.config.rollout || {}),
        ...(updates?.rollout || {})
      }
    });
    await this.saveConfig();
    console.log('[ProxyConfigManager] 配置已更新', updates);
  }

  /**
   * 判断账号是否应该使用代理
   */
  shouldUseProxy(accountName) {
    if (!this.config.enabled) return false;
    const normalizedAccountName = String(accountName || '').trim();
    if (!normalizedAccountName) return false;

    const { strategy, whitelist, percentage, excludeList } = this.config.rollout;

    // 检查排除列表
    if (excludeList.includes(normalizedAccountName)) return false;

    // 根据策略判断
    switch (strategy) {
      case 'all':
        return true;
      case 'none':
        return false;
      case 'whitelist':
        return whitelist.includes(normalizedAccountName);
      case 'percentage':
        // 基于账号名称的哈希值决定
        const hash = normalizedAccountName.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
        return (hash % 100) < percentage;
      default:
        return false;
    }
  }

  async shouldFallbackToDirect() {
    await this.ensureLoaded();
    return !!this.config.fallbackToDirect;
  }

  async isEnabled() {
    await this.ensureLoaded();
    return !!this.config.enabled;
  }

  async getMaxRetries() {
    await this.ensureLoaded();
    const maxRetries = Number(this.config.maxRetries || DEFAULT_PROXY_CONFIG.maxRetries);
    return Number.isInteger(maxRetries) && maxRetries > 0 ? maxRetries : DEFAULT_PROXY_CONFIG.maxRetries;
  }

  /**
   * 为账号获取代理
   */
  async getProxyForAccount(accountName, accountId) {
    await this.ensureLoaded();

    if (!this.shouldUseProxy(accountName)) {
      return null;
    }

    try {
      await proxyPoolManager.ensureInitialized();
      const proxy = proxyPoolManager.getProxy(accountId);
      if (!proxy) {
        console.warn(`[ProxyConfigManager] 无可用代理: ${accountName}`);
        if (this.config.fallbackToDirect) {
          return null;
        }
        throw new Error('No available proxy');
      }

      // 记录使用
      if (!this.accountProxyStats.has(accountName)) {
        this.accountProxyStats.set(accountName, {
          successCount: 0,
          failCount: 0,
          lastUsed: null,
          lastProxy: null
        });
      }

      const stats = this.accountProxyStats.get(accountName);
      stats.lastUsed = new Date().toISOString();
      stats.lastProxy = proxy.id;

      return proxy;
    } catch (error) {
      console.error(`[ProxyConfigManager] 获取代理失败: ${accountName}`, error);
      if (this.config.fallbackToDirect) {
        return null;
      }
      throw error;
    }
  }

  /**
   * 标记代理使用结果
   */
  markProxyResult(accountName, proxyId, success) {
    if (this.accountProxyStats.has(accountName)) {
      const stats = this.accountProxyStats.get(accountName);
      if (success) {
        stats.successCount++;
        proxyPoolManager.markProxySuccess(proxyId);
      } else {
        stats.failCount++;
        proxyPoolManager.markProxyFailed(proxyId);
      }
    }
  }

  /**
   * 获取统计信息
   */
  getStats() {
    const poolStats = proxyPoolManager.getStats();
    const accountStats = Array.from(this.accountProxyStats.entries()).map(([name, stats]) => ({
      accountName: name,
      ...stats
    }));

    return {
      config: this.config,
      poolStats,
      accountStats,
      accountsUsingProxy: accountStats.length
    };
  }

  /**
   * 添加账号到白名单
   */
  async addToWhitelist(accountNames) {
    await this.ensureLoaded();
    const names = Array.isArray(accountNames) ? accountNames : [accountNames];
    const whitelist = new Set(this.config.rollout.whitelist);
    names.forEach(name => whitelist.add(name));
    this.config.rollout.whitelist = Array.from(whitelist);
    await this.saveConfig();
    console.log(`[ProxyConfigManager] 添加到白名单: ${names.join(', ')}`);
  }

  /**
   * 从白名单移除账号
   */
  async removeFromWhitelist(accountNames) {
    await this.ensureLoaded();
    const names = Array.isArray(accountNames) ? accountNames : [accountNames];
    this.config.rollout.whitelist = this.config.rollout.whitelist.filter(
      name => !names.includes(name)
    );
    await this.saveConfig();
    console.log(`[ProxyConfigManager] 从白名单移除: ${names.join(', ')}`);
  }
}

export const proxyConfigManager = new ProxyConfigManager();
