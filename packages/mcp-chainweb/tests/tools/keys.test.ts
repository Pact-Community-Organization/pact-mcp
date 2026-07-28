/**
 * @fileoverview Tests for chainweb_keys.
 */

import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { createChainwebClient } from '../../src/client/fetch.js';
import { createKeysTool } from '../../src/tools/keys.js';
import {
  startMockChainweb,
  type MockHandle
} from '../fixtures/mock-chainweb.js';

describe('chainweb_keys', () => {
  let mock: MockHandle;

  beforeAll(async () => {
    mock = await startMockChainweb();
  });
  afterAll(async () => {
    await mock.close();
  });

  function makeClient() {
    return createChainwebClient({
      baseUrl: mock.baseUrl,
      networkId: 'development',
      allowedOrigins: [],
      additionalAllowedOrigins: [mock.origin]
    });
  }

  test('returns list of keys under limit', async () => {
    mock.patch('local', {
      reqKey: 'rk',
      result: { status: 'success', data: ['alice', 'bob', 'carol'] },
      gas: 20
    });
    const tool = createKeysTool({ client: makeClient() });
    const { content } = await tool({
      chainId: '0',
      module: 'n_abc.dao-token',
      table: 'accounts'
    });
    expect(content[0]!.keys).toEqual(['alice', 'bob', 'carol']);
    expect(content[0]!.count).toBe(3);
    expect(content[0]!.hasMore).toBe(false);
    expect(content[0]!.gasUsed).toBe(20);
  });

  test('hasMore=true when keys reach limit', async () => {
    const manyKeys = Array.from({ length: 5 }, (_, i) => `user-${i}`);
    mock.patch('local', {
      reqKey: 'rk',
      result: { status: 'success', data: manyKeys },
      gas: 1
    });
    const tool = createKeysTool({ client: makeClient() });
    const { content } = await tool({
      chainId: '0',
      module: 'n_abc.dao-token',
      table: 'accounts',
      limit: 5
    });
    expect(content[0]!.hasMore).toBe(true);
  });

  test('uses (take limit ...) composition', async () => {
    mock.patch('local', {
      reqKey: 'rk',
      result: { status: 'success', data: [] },
      gas: 1
    });
    const before = mock.requests.length;
    const tool = createKeysTool({ client: makeClient() });
    await tool({
      chainId: '0',
      module: 'n_abc.dao-token',
      table: 'accounts',
      limit: 500
    });
    const last = mock.requests.slice(before).find((r) =>
      /\/local/.test(r.url)
    );
    expect(last).toBeDefined();
    const parsed = JSON.parse(last!.body) as { cmd: string };
    const inner = JSON.parse(parsed.cmd) as {
      payload: { exec: { code: string } };
    };
    expect(inner.payload.exec.code).toBe(
      '(take 500 (keys n_abc.dao-token.accounts))'
    );
  });

  test('throws KEYS_FAILED on pact-level failure', async () => {
    mock.patch('local', {
      reqKey: 'rk',
      result: {
        status: 'failure',
        error: { message: 'no such table' }
      },
      gas: 0
    });
    const tool = createKeysTool({ client: makeClient() });
    await expect(
      tool({
        chainId: '0',
        module: 'n_abc.dao-token',
        table: 'accounts'
      })
    ).rejects.toMatchObject({ code: 'KEYS_FAILED' });
  });
});
