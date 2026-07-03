import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseGeoNodeProxyList,
  parseProxyJsonList,
  parseProxyTextList
} from '../src/utils/proxyPool/config.js';
import { ProxyFetcher } from '../src/utils/proxyPool/ProxyFetcher.js';
import { ProxyPoolManager } from '../src/utils/proxyPool/ProxyPoolManager.js';

test('parseProxyTextList accepts plain, url, and comma-delimited proxies', () => {
  const proxies = parseProxyTextList(
    [
      '1.1.1.1:8080',
      'socks5://2.2.2.2:1080',
      '3.3.3.3,3128,US,anonymous',
      '# Updated Proxies: 2026-07-03 11:56 UTC',
      'bad-row'
    ].join('\n'),
    { source: 'fixture-source', protocol: 'http' }
  );

  assert.deepEqual(
    proxies.map((proxy) => ({
      host: proxy.host,
      port: proxy.port,
      protocol: proxy.protocol,
      country: proxy.country,
      source: proxy.source
    })),
    [
      { host: '1.1.1.1', port: 8080, protocol: 'http', country: 'unknown', source: 'fixture-source' },
      { host: '2.2.2.2', port: 1080, protocol: 'socks5', country: 'unknown', source: 'fixture-source' },
      { host: '3.3.3.3', port: 3128, protocol: 'http', country: 'US', source: 'fixture-source' }
    ]
  );
});

test('parseProxyJsonList accepts ProxyScrape-style provider data', () => {
  const proxies = parseProxyJsonList(
    {
      proxies: [
        { ip: '4.4.4.4', port: '8000', protocol: 'https', country: 'Japan', anonymity: 'elite' },
        { host: '5.5.5.5', port: 1080, type: 'socks5' }
      ]
    },
    { source: 'json-source', protocol: 'http' }
  );

  assert.deepEqual(
    proxies.map((proxy) => ({
      host: proxy.host,
      port: proxy.port,
      protocol: proxy.protocol,
      country: proxy.country,
      anonymity: proxy.anonymity,
      source: proxy.source
    })),
    [
      { host: '4.4.4.4', port: 8000, protocol: 'https', country: 'Japan', anonymity: 'elite', source: 'json-source' },
      { host: '5.5.5.5', port: 1080, protocol: 'socks5', country: 'unknown', anonymity: 'unknown', source: 'json-source' }
    ]
  );
});

test('parseGeoNodeProxyList accepts GeoNode api data', () => {
  const proxies = parseGeoNodeProxyList(
    {
      data: [
        {
          ip: '6.6.6.6',
          port: '9000',
          protocols: ['socks5', 'http'],
          country: 'Singapore',
          anonymityLevel: 'elite',
          speed: 120
        }
      ]
    },
    { source: 'geonode-live' }
  );

  assert.deepEqual(proxies, [
    {
      host: '6.6.6.6',
      port: 9000,
      protocol: 'socks5',
      country: 'Singapore',
      anonymity: 'elite',
      source: 'geonode-live',
      speed: 120
    }
  ]);
});

test('ProxyFetcher drops malformed proxies during normalization', async () => {
  const fetcher = new ProxyFetcher({
    sources: [
      {
        name: 'fixture',
        sourceId: 'fixture',
        enabled: true,
        fetcher: async () => [
          { host: '7.7.7.7', port: '8080', protocol: 'http', source: 'fixture' },
          { host: '', port: '8080', protocol: 'http', source: 'fixture' },
          { host: '8.8.8.8', port: '70000', protocol: 'http', source: 'fixture' },
          { host: '9.9.9.9', port: '1080', protocol: 'ftp', source: 'fixture' }
        ]
      }
    ]
  });

  const proxies = await fetcher.fetchAll();

  assert.equal(proxies.length, 1);
  assert.equal(proxies[0].id, '7.7.7.7:8080');
});

test('ProxyFetcher deduplicates repeated candidates across sources', async () => {
  const fetcher = new ProxyFetcher({
    sources: [
      {
        name: 'source-a',
        sourceId: 'source-a',
        enabled: true,
        fetcher: async () => [
          { host: '10.10.10.10', port: '9000', protocol: 'http', source: 'source-a' }
        ]
      },
      {
        name: 'source-b',
        sourceId: 'source-b',
        enabled: true,
        fetcher: async () => [
          { host: '10.10.10.10', port: '9000', protocol: 'http', source: 'source-b' }
        ]
      }
    ]
  });

  const proxies = await fetcher.fetchAll();

  assert.equal(proxies.length, 1);
  assert.equal(proxies[0].id, '10.10.10.10:9000');
});

test('ProxyPoolManager keeps legacy source ids enabled', () => {
  const manager = new ProxyPoolManager();
  const enabledSourceIds = manager.getEnabledSourceIds();

  assert.equal(enabledSourceIds.has('monosans-http'), true);
  assert.equal(enabledSourceIds.has('monosans-socks5'), true);
  assert.equal(enabledSourceIds.has('thespeedx-http'), true);
  assert.equal(enabledSourceIds.has('thespeedx-socks5'), true);
});
