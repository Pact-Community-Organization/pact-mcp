/**
 * @fileoverview Security test: Pact JSON-boundary unwrap returns plain JS
 *               values for every tool that reads from chainweb.
 *               Guards against `{int:N} === N` silent false-positive pattern.
 */

import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { createChainwebClient } from '../../src/client/fetch.js';
import { createLocalTool } from '../../src/tools/local.js';
import { createPollTool } from '../../src/tools/poll.js';
import {
  startMockChainweb,
  type MockHandle
} from '../fixtures/mock-chainweb.js';

describe('type-unwrap (security)', () => {
  let mock: MockHandle;

  beforeAll(async () => {
    mock = await startMockChainweb();
  });
  afterAll(async () => {
    await mock.close();
  });

  function client() {
    return createChainwebClient({
      baseUrl: mock.baseUrl,
      networkId: 'development',
      allowedOrigins: [],
      additionalAllowedOrigins: [mock.origin]
    });
  }

  test('local: deeply nested Pact types are all unwrapped', async () => {
    mock.patch('local', {
      reqKey: 'k',
      result: {
        status: 'success',
        data: {
          amount: { decimal: '1.5' },
          count: { int: '3' },
          nested: {
            when: { time: '2024-01-01T00:00:00Z' },
            ledger: [
              { amount: { decimal: '10' }, votes: { int: '2' } },
              { amount: { decimal: '20' }, votes: { int: '4' } }
            ]
          }
        }
      },
      gas: 1
    });
    const tool = createLocalTool({ client: client() });
    const { content } = await tool({ chainId: '0', code: '(foo)' });
    expect(content[0]!.result).toEqual({
      amount: '1.5',
      count: 3,
      nested: {
        when: '2024-01-01T00:00:00Z',
        ledger: [
          { amount: '10', votes: 2 },
          { amount: '20', votes: 4 }
        ]
      }
    });
  });

  test('poll: unwraps boundary types in result data', async () => {
    mock.patch('poll', {
      'rk-x': {
        reqKey: 'rk-x',
        result: {
          status: 'success',
          data: { balance: { decimal: '99.9' }, nonce: { int: '1024' } }
        },
        gas: 10,
        metaData: { blockHeight: 5, blockHash: 'b' }
      }
    });
    const tool = createPollTool({
      client: client(),
      sleep: async () => {}
    });
    const { content } = await tool({
      chainId: '0',
      requestKeys: ['rk-x']
    });
    expect(content[0]!.results[0]!.result).toEqual({
      balance: '99.9',
      nonce: 1024
    });
    mock.patch('poll', undefined);
  });

  test('missing fields unwrap to null, never NaN', async () => {
    mock.patch('local', {
      reqKey: 'k',
      result: { status: 'success', data: null },
      gas: 0
    });
    const tool = createLocalTool({ client: client() });
    const { content } = await tool({ chainId: '0', code: '()' });
    expect(content[0]!.result).toBe(null);
  });
});
