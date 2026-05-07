/**
 * 代理验证器 - 验证代理的可用性
 */

import { VALIDATION_CONFIG } from './config.js';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { SocksProxyAgent } from 'socks-proxy-agent';
import fetch from 'node-fetch';

export class ProxyValidator {
  constructor(config = {}) {
    this.config = { ...VALIDATION_CONFIG, ...config };
    this.validating = new Set();
  }

  /**
   * 批量验证代理
   */
  async validateBatch(proxies) {
    console.log(`[ProxyValidator] 开始验证 ${proxies.length} 个代理`);

    const results = [];
    const chunks = this.chunkArray(proxies, this.config.concurrency);

    for (const chunk of chunks) {
      const chunkResults = await Promise.allSettled(
        chunk.map(proxy => this.validateProxy(proxy))
      );

      chunkResults.forEach((result, index) => {
        const proxy = chunk[index];
        if (result.status === 'fulfilled') {
          results.push({
            ...proxy,
            ...result.value
          });
        } else {
          results.push({
            ...proxy,
            isValid: false,
            lastValidated: Date.now(),
            failCount: (proxy.failCount || 0) + 1,
            error: result.reason?.message || 'Unknown error'
          });
        }
      });
    }

    const validCount = results.filter(r => r.isValid).length;
    console.log(`[ProxyValidator] 验证完成: ${validCount}/${proxies.length} 个代理可用`);

    return results;
  }

  /**
   * 验证单个代理
   */
  async validateProxy(proxy) {
    if (this.validating.has(proxy.id)) {
      throw new Error('Proxy is already being validated');
    }

    this.validating.add(proxy.id);

    try {
      const startTime = Date.now();
      const response = await this.withTemporarySocketErrorGuard(() => this.testProxyConnection(proxy));
      const responseTime = Date.now() - startTime;
      const isValid = response.ok && responseTime < this.config.maxResponseTime;

      return {
        isValid,
        lastValidated: Date.now(),
        responseTime,
        successCount: isValid ? (proxy.successCount || 0) + 1 : proxy.successCount || 0,
        failCount: isValid ? proxy.failCount || 0 : (proxy.failCount || 0) + 1,
        error: null
      };
    } catch (error) {
      return {
        isValid: false,
        lastValidated: Date.now(),
        responseTime: null,
        successCount: proxy.successCount || 0,
        failCount: (proxy.failCount || 0) + 1,
        error: error.message
      };
    } finally {
      this.validating.delete(proxy.id);
    }
  }

  /**
   * 部分坏代理/坏 SOCKS 节点会在底层 socket 上异步抛 error，而不是通过 fetch promise reject。
   * 验证阶段临时兜底，避免单个坏代理把整个后端进程打崩。
   */
  async withTemporarySocketErrorGuard(operation) {
    const swallowedErrors = [];
    const guard = (error) => {
      const code = error?.code || '';
      const message = error?.message || '';
      const isSocketProxyError = [
        'ECONNRESET',
        'ECONNREFUSED',
        'EHOSTUNREACH',
        'ENETUNREACH',
        'ETIMEDOUT',
        'EPIPE',
        'TLS_ERROR',
      ].includes(code) || /socket|proxy|TLS connection/i.test(message);

      if (!isSocketProxyError) {
        throw error;
      }

      swallowedErrors.push(error);
    };

    process.prependListener('uncaughtException', guard);
    try {
      const result = await operation();
      if (swallowedErrors.length > 0) {
        throw swallowedErrors[0];
      }
      return result;
    } finally {
      process.removeListener('uncaughtException', guard);
    }
  }

  /**
   * 测试代理连接
   */
  async testProxyConnection(proxy) {
    const proxyUrl = this.buildProxyUrl(proxy);
    const agent = this.createProxyAgent(proxyUrl, proxy.protocol);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.config.timeout);

    try {
      const response = await fetch(this.config.testUrl, {
        method: 'GET',
        agent,
        signal: controller.signal,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
      });

      clearTimeout(timeoutId);
      return response;
    } catch (error) {
      clearTimeout(timeoutId);
      if (error.name === 'AbortError') {
        throw new Error('Proxy connection timeout');
      }
      throw error;
    }
  }

  /**
   * 创建代理Agent
   */
  createProxyAgent(proxyUrl, protocol) {
    if (protocol === 'socks' || protocol === 'socks5' || protocol === 'socks4') {
      return new SocksProxyAgent(proxyUrl);
    } else {
      return new HttpsProxyAgent(proxyUrl);
    }
  }

  /**
   * 构建代理URL
   */
  buildProxyUrl(proxy) {
    const protocol = proxy.protocol || 'http';
    return `${protocol}://${proxy.host}:${proxy.port}`;
  }

  /**
   * 将数组分块
   */
  chunkArray(array, size) {
    const chunks = [];
    for (let i = 0; i < array.length; i += size) {
      chunks.push(array.slice(i, i + size));
    }
    return chunks;
  }
}
