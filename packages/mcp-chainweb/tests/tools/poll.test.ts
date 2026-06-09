/**
 * @fileoverview Tests for chainweb.poll tool.
 */

import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { createChainwebClient } from '../../src/client/fetch.js';
import { createPollTool } from '../../src/tools/poll.js';
import {
  startMockChainweb,
  type MockHandle
} from '../fixtures/mock-chainweb.js';

describe('chainweb.poll', () => {
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

  test('returns unwrapped success result with block metadata', async () => {
    const tool = createPollTool({
      client: makeClient(),
      sleep: async () => {}
    });
    const { content } = await tool({
      chainId: '0',
      requestKeys: ['rk-1']
    });
    const out = content[0]!;
    expect(out.complete).toBe(true);
    expect(out.results).toHaveLength(1);
    expect(out.results[0]!.requestKey).toBe('rk-1');
    expect(out.results[0]!.status).toBe('success');
    expect(out.results[0]!.result).toBe(7); // {int: "7"} → 7
    expect(out.results[0]!.blockHeight).toBe(200);
    expect(out.results[0]!.blockHash).toBe('block-hash-mock');
  });

  test('pending keys are reported when timeout hits', async () => {
    mock.patch('poll', {}); // Empty response — nothing resolved.
    const tool = createPollTool({
      client: makeClient(),
      sleep: async () => {}
    });
    const { content } = await tool({
      chainId: '0',
      requestKeys: ['rk-a', 'rk-b'],
      timeoutMs: 50,
      intervalMs: 250
    });
    expect(content[0]!.complete).toBe(false);
    expect(content[0]!.results.map((r) => r.status)).toEqual([
      'pending',
      'pending'
    ]);
    mock.patch('poll', undefined);
  });

  test('unwraps failure error shape', async () => {
    mock.patch('poll', {
      'rk-f': {
        reqKey: 'rk-f',
        result: {
          status: 'failure',
          error: { message: 'row-not-found', info: { int: '404' } }
        },
        gas: 5,
        metaData: { blockHeight: 1, blockHash: 'h' }
      }
    });
    const tool = createPollTool({
      client: makeClient(),
      sleep: async () => {}
    });
    const { content } = await tool({
      chainId: '0',
      requestKeys: ['rk-f']
    });
    expect(content[0]!.results[0]!.status).toBe('failure');
    expect(content[0]!.results[0]!.result).toEqual({
      message: 'row-not-found',
      info: 404
    });
    mock.patch('poll', undefined);
  });

  test('rejects empty requestKeys array via zod', async () => {
    const tool = createPollTool({
      client: makeClient(),
      sleep: async () => {}
    });
    await expect(
      tool({ chainId: '0', requestKeys: [] })
    ).rejects.toBeDefined();
  });
});
