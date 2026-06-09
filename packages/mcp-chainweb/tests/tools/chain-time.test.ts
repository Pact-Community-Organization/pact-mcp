/**
 * @fileoverview Tests for chainweb.chain_time tool.
 */

import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { createChainwebClient } from '../../src/client/fetch.js';
import { createChainTimeTool } from '../../src/tools/chain-time.js';
import {
  startMockChainweb,
  type MockHandle
} from '../fixtures/mock-chainweb.js';

describe('chainweb.chain_time', () => {
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

  test('converts microseconds to seconds', async () => {
    mock.patch('header', {
      creationTime: 1_700_000_000_000_000, // μs
      height: 123,
      hash: 'hdr-hash'
    });
    const tool = createChainTimeTool({ client: makeClient() });
    const { content } = await tool({ chainId: '0' });
    expect(content[0]!.creationTimeSec).toBe(1_700_000_000);
    expect(content[0]!.blockHeight).toBe(123);
    expect(content[0]!.blockHash).toBe('hdr-hash');
    mock.patch('header', undefined);
  });

  test('rejects chainId not present in /cut', async () => {
    const tool = createChainTimeTool({ client: makeClient() });
    await expect(tool({ chainId: '999' })).rejects.toMatchObject({
      code: 'CHAIN_NOT_FOUND'
    });
  });

  test('rejects non-numeric chainId via zod', async () => {
    const tool = createChainTimeTool({ client: makeClient() });
    await expect(tool({ chainId: 'abc' })).rejects.toBeDefined();
  });

  test('sends blockheader-encoding=object accept header', async () => {
    const tool = createChainTimeTool({ client: makeClient() });
    const before = mock.requests.length;
    await tool({ chainId: '0' });
    const headerReq = mock.requests
      .slice(before)
      .find((r) => /\/header\//.test(r.url));
    expect(headerReq).toBeDefined();
    const accept = String(headerReq!.headers['accept'] ?? '');
    expect(accept).toContain('blockheader-encoding=object');
  });

  test('fails loudly if header missing creationTime', async () => {
    mock.patch('header', { height: 10, hash: 'h' }); // no creationTime
    const tool = createChainTimeTool({ client: makeClient() });
    await expect(tool({ chainId: '0' })).rejects.toMatchObject({
      code: 'HEADER_MISSING_CREATION_TIME'
    });
    mock.patch('header', undefined);
  });
});
