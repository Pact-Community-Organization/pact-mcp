/**
 * @fileoverview Tests for chainweb.local tool.
 */

import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { createChainwebClient } from '../../src/client/fetch.js';
import { createLocalTool } from '../../src/tools/local.js';
import {
  startMockChainweb,
  type MockHandle
} from '../fixtures/mock-chainweb.js';

describe('chainweb.local', () => {
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

  test('unwraps {int: N} success result', async () => {
    mock.patch('local', {
      reqKey: 'rk',
      result: { status: 'success', data: { int: '99' } },
      gas: 55,
      logs: 'hash',
      txId: null
    });
    const tool = createLocalTool({ client: makeClient() });
    const { content } = await tool({
      chainId: '0',
      code: '(+ 1 2)'
    });
    expect(content[0]!.status).toBe('success');
    expect(content[0]!.result).toBe(99);
    expect(content[0]!.gasUsed).toBe(55);
  });

  test('unwraps nested object result', async () => {
    mock.patch('local', {
      reqKey: 'rk',
      result: {
        status: 'success',
        data: {
          balance: { decimal: '1234.5678' },
          votes: { int: '10' }
        }
      },
      gas: 20,
      logs: null
    });
    const tool = createLocalTool({ client: makeClient() });
    const { content } = await tool({
      chainId: '0',
      code: '(coin.get-balance "alice")'
    });
    expect(content[0]!.result).toEqual({
      balance: '1234.5678',
      votes: 10
    });
  });

  test('returns status=failure with unwrapped error', async () => {
    mock.patch('local', {
      reqKey: 'rk',
      result: {
        status: 'failure',
        error: { message: 'keyset failure' }
      },
      gas: 0
    });
    const tool = createLocalTool({ client: makeClient() });
    const { content } = await tool({
      chainId: '0',
      code: '(dao-token.pause)'
    });
    expect(content[0]!.status).toBe('failure');
    expect(content[0]!.result).toMatchObject({ message: 'keyset failure' });
  });

  test('forwards env-data into payload', async () => {
    mock.patch('local', undefined);
    const tool = createLocalTool({ client: makeClient() });
    const before = mock.requests.length;
    await tool({
      chainId: '0',
      code: '(read-msg "amount")',
      data: { amount: 42 }
    });
    const req = mock.requests.slice(before).find((r) => /\/local/.test(r.url));
    expect(req).toBeDefined();
    expect(req!.body).toContain('amount');
  });

  test('rejects gasLimit > 150_000', async () => {
    const tool = createLocalTool({ client: makeClient() });
    await expect(
      tool({ chainId: '0', code: '(+ 1 2)', gasLimit: 999_999 })
    ).rejects.toBeDefined();
  });

  test('signers with capabilities are forwarded', async () => {
    const tool = createLocalTool({ client: makeClient() });
    const before = mock.requests.length;
    await tool({
      chainId: '0',
      code: '(+ 1 2)',
      signers: [
        {
          publicKey:
            '368820f80c324bbc7c2b0610688a7da43e39f91d118732671cd9c7500ff43cca',
          capabilities: [{ name: 'coin.GAS', args: [] }]
        }
      ]
    });
    const req = mock.requests.slice(before).find((r) => /\/local/.test(r.url));
    expect(req!.body).toContain('coin.GAS');
    expect(req!.body).toContain('368820f80c324bbc');
  });
});
