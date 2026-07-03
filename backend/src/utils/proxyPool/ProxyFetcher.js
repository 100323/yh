/**
 * 代理获取器 - 从多个免费代理源获取代理
 */

import { PROXY_SOURCES } from './config.js';
import fetch from 'node-fetch';

export class ProxyFetcher {
  constructor(options = {}) {
    this.sources = (options.sources || PROXY_SOURCES).filter(source => source.enabled);
  }

  /**
   * 从所有启用的代理源获取代理
   */
  async fetchAll() {
    const results = await Promise.allSettled(
      this.sources.map(source => this.fetchFromSource(source))
    );

    const proxies = [];
    const seenIds = new Set();
    results.forEach((result, index) => {
      if (result.status === 'fulfilled') {
        const unique = [];
        result.value.forEach((proxy) => {
          const proxyId = proxy?.id;
          if (!proxyId || seenIds.has(proxyId)) {
            return;
          }
          seenIds.add(proxyId);
          unique.push(proxy);
        });
        proxies.push(...unique);
        console.log(`[ProxyFetcher] 从 ${this.sources[index].name} 获取到 ${unique.length} 个代理`);
      } else {
        console.error(`[ProxyFetcher] 从 ${this.sources[index].name} 获取失败:`, result.reason?.message);
      }
    });

    console.log(`[ProxyFetcher] 总共获取到 ${proxies.length} 个代理`);
    return proxies;
  }

  /**
   * 从单个代理源获取代理
   */
  async fetchFromSource(source) {
    if (typeof source.fetcher === 'function') {
      try {
        const proxies = await source.fetcher(source);
        return proxies.map(proxy => this.normalizeProxy(proxy)).filter(Boolean);
      } catch (error) {
        console.error(`[ProxyFetcher] 获取代理失败 (${source.name}):`, error?.message || error);
        return [];
      }
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);

    try {
      const url = this.buildUrl(source.url, this.resolveDynamicConfig(source.params, source));
      const headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        ...this.resolveDynamicConfig(source.headers, source)
      };

      const response = await fetch(url, {
        method: 'GET',
        headers,
        signal: controller.signal
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const contentType = response.headers.get('content-type');
      let data;

      if (contentType && contentType.includes('application/json')) {
        data = await response.json();
      } else {
        data = await response.text();
      }

      const proxies = source.parser(data);
      return proxies.map(proxy => this.normalizeProxy(proxy)).filter(Boolean);
    } catch (error) {
      const message = error.name === 'AbortError' ? 'Proxy source request timeout' : error.message;
      console.error(`[ProxyFetcher] 获取代理失败 (${source.name}):`, message);
      return [];
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * 解析动态配置。代理源里的 params/headers 支持函数，方便从环境变量读取密钥，
   * 避免把 API key 写死到代码或前端。
   */
  resolveDynamicConfig(value, source) {
    if (!value) {
      return {};
    }

    const resolved = typeof value === 'function' ? value(source) : value;
    if (!resolved || typeof resolved !== 'object') {
      return {};
    }

    return Object.fromEntries(
      Object.entries(resolved)
        .filter(([, item]) => item !== undefined && item !== null && String(item) !== '')
    );
  }

  /**
   * 构建请求URL
   */
  buildUrl(baseUrl, params) {
    if (!params || Object.keys(params).length === 0) {
      return baseUrl;
    }

    const queryString = Object.entries(params)
      .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
      .join('&');

    return `${baseUrl}?${queryString}`;
  }

  /**
   * 标准化代理格式
   */
  normalizeProxy(proxy) {
    const host = String(proxy?.host || '').trim();
    const port = parseInt(proxy?.port, 10);
    const protocol = String(proxy?.protocol || 'http').toLowerCase();
    const supportedProtocols = new Set(['http', 'https', 'socks', 'socks4', 'socks5']);

    if (!host || !Number.isInteger(port) || port <= 0 || port > 65535 || !supportedProtocols.has(protocol)) {
      return null;
    }

    return {
      host,
      port,
      protocol,
      country: proxy.country || 'unknown',
      anonymity: proxy.anonymity || 'unknown',
      speed: proxy.speed || null,
      source: proxy.source || 'unknown',
      upstreamProxyId: proxy.upstreamProxyId || null,
      upstreamTag: proxy.upstreamTag || null,
      // 代理池管理字段
      id: `${host}:${port}`,
      createdAt: Date.now(),
      lastValidated: null,
      lastUsed: null,
      isValid: null,
      failCount: 0,
      successCount: 0
    };
  }
}
