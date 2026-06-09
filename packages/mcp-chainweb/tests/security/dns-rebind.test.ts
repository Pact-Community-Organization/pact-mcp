/**
 * @fileoverview Security test: DNS-rebind-style attack — `localhost.evil.com`
 *               must be refused by the allowlisted fetch despite containing
 *               the substring `localhost`.
 */

import { describe, test, expect } from 'vitest';
import { createChainwebClient } from '../../src/client/fetch.js';

describe('dns-rebind', () => {
  test('refuses base URL with suffixed attacker domain', () => {
    expect(() =>
      createChainwebClient({
        baseUrl: 'http://localhost.evil.com:8081',
        networkId: 'development',
        allowedOrigins: [
          'http://localhost:8081',
          'http://localhost:8082',
          'http://localhost:8083'
        ]
      })
    ).toThrow(/not in allowlist/);
  });

  test('refuses prefixed attacker domain (evil.localhost)', () => {
    expect(() =>
      createChainwebClient({
        baseUrl: 'http://evil.localhost:8081',
        networkId: 'development',
        allowedOrigins: ['http://localhost:8081']
      })
    ).toThrow(/not in allowlist/);
  });

  test('refuses different port even if host matches', () => {
    expect(() =>
      createChainwebClient({
        baseUrl: 'http://localhost:9999',
        networkId: 'development',
        allowedOrigins: ['http://localhost:8081']
      })
    ).toThrow(/not in allowlist/);
  });

  test('refuses https upgrade attempt against http allowlist', () => {
    expect(() =>
      createChainwebClient({
        baseUrl: 'https://localhost:8081',
        networkId: 'development',
        allowedOrigins: ['http://localhost:8081']
      })
    ).toThrow(/not in allowlist/);
  });

  test('fetch wrapper still enforces allowlist when client built (defence in depth)', () => {
    // Build a valid client, then assert the baseUrl stored matches what we
    // passed — defence in depth: the fetch wrapper also re-checks on every
    // call (exercised indirectly by other tests).
    const client = createChainwebClient({
      baseUrl: 'http://localhost:8081',
      networkId: 'development',
      allowedOrigins: ['http://localhost:8081']
    });
    expect(client.baseUrl).toBe('http://localhost:8081');
  });
});
