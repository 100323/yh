/**
 * 代理获取器 - 从多个免费代理源获取代理
 */

import { PROXY_SOURCES } from './config.js';
import fetch from 'node-fetch';

export class ProxyFetcher {
  constructor() {
    this.sources = PROXY_SOURCES.filter(source => source.enabled);
  }

  /**
   * 从所有启用的代理源获取代理
   */
  async fetchAll() {
    const results = await Promise.allSettled(
      this.sources.map(source => this.fetchFromSource(source))
    );

    const proxies = [];
    results.forEach((result, index) => {
      if (result.status === 'fulfilled') {
        proxies.push(...result.value);
        console.log(`[ProxyFetcher] 从 ${this.sources[index].name} 获取到 ${result.value.length} 个代理`);
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
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);

    try {
      const url = this.buildUrl(source.url, source.params);

      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        },
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
      return proxies.map(proxy => this.normalizeProxy(proxy));
    } catch (error) {
      const message = error.name === 'AbortError' ? 'Proxy source request timeout' : error.message;
      console.error(`[ProxyFetcher] 获取代理失败 (${source.name}):`, message);
      return [];
    } finally {
      clearTimeout(timeoutId);
    }
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
    return {
      host: proxy.host,
      port: parseInt(proxy.port),
      protocol: (proxy.protocol || 'http').toLowerCase(),
      country: proxy.country || 'unknown',
      anonymity: proxy.anonymity || 'unknown',
      speed: proxy.speed || null,
      source: proxy.source || 'unknown',
      // 代理池管理字段
      id: `${proxy.host}:${proxy.port}`,
      createdAt: Date.now(),
      lastValidated: null,
      lastUsed: null,
      isValid: null,
      failCount: 0,
      successCount: 0
    };
  }
}
