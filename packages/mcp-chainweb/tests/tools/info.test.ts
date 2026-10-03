/**
 * @fileoverview Tests for chainweb_info tool.
 */

import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { createChainwebClient } from '../../src/client/fetch.js';
import { createInfoTool } from '../../src/tools/info.js';
import {
  startMockChainweb,
  type MockHandle
} from '../fixtures/mock-chainweb.js';

describe('chainweb_info', () => {
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

  test('returns networkId + chainIds + chainTimestamps', async () => {
    const tool = createInfoTool({ client: makeClient() });
    const { content } = await tool({});
    expect(content[0]!.networkId).toBe('development');
    expect(content[0]!.chainIds).toHaveLength(20);
    expect(content[0]!.chainIds).toContain('0');
    expect(content[0]!.chainTimestamps).toBeDefined();
    expect(typeof content[0]!.chainTimestamps!['0']).toBe('number');
    expect(content[0]!.chainHeights!['0']).toBe(100);
    expect(content[0]!.chainHeights!['19']).toBe(119);
  });

  test('reports the node software version, not the network id, as nodeVersion', async () => {
    const tool = createInfoTool({ client: makeClient() });
    const { content } = await tool({});
    expect(content[0]!.nodeVersion).toBe('3.2.1');
  });

  test('a mainnet-configured client accepts a mainnet01 node', async () => {
    // Body shape of a real chainweb-node 3.2 /info on mainnet01.
    mock.patch('info', {
      nodeApiVersion: '0.0',
      nodeBlockDelay: 30000000,
      nodeChains: ['0', '1'],
      nodeNumberOfChains: 20,
      nodePackageVersion: '3.2',
      nodeVersion: 'mainnet01'
    });
    const client = createChainwebClient({
      baseUrl: mock.baseUrl,
      networkId: 'mainnet01',
      allowedOrigins: [],
      additionalAllowedOrigins: [mock.origin]
    });
    const tool = createInfoTool({ client });
    const { content } = await tool({});
    expect(content[0]!.networkId).toBe('mainnet01');
    expect(content[0]!.nodeVersion).toBe('3.2');
    mock.patch('info', undefined);
  });

  test('a mainnet-configured client refuses a devnet node', async () => {
    const client = createChainwebClient({
      baseUrl: mock.baseUrl,
      networkId: 'mainnet01',
      allowedOrigins: [],
      additionalAllowedOrigins: [mock.origin]
    });
    const tool = createInfoTool({ client });
    await expect(tool({})).rejects.toMatchObject({
      code: 'NETWORK_ID_MISMATCH',
      message: expect.stringContaining("Expected 'mainnet01', got 'development'")
    });
  });

  test('refuses non-development networkId with NETWORK_ID_MISMATCH', async () => {
    mock.patch('info', {
      nodeVersion: 'mainnet01',
      nodeApiVersion: 'pact5',
      nodeChains: ['0'],
      networkId: 'mainnet01',
      chainwebVersion: 'mainnet01'
    });
    const tool = createInfoTool({ client: makeClient() });
    await expect(tool({})).rejects.toMatchObject({
      code: 'NETWORK_ID_MISMATCH'
    });
    // Restore default.
    mock.patch('info', undefined);
  });

  test('still returns info when /cut fails (chainTimestamps omitted)', async () => {
    mock.patch('info', {
      nodeVersion: 'development',
      nodeApiVersion: 'pact5',
      nodeChains: ['0', '1'],
      networkId: 'development',
      chainwebVersion: 'development'
    });
    mock.patch('cut', null);
    // Force /cut into 500.
    const client = makeClient();
    mock.patch('cut', { malformed: true });
    const tool = createInfoTool({ client });
    const { content } = await tool({});
    expect(content[0]!.networkId).toBe('development');
    // chainTimestamps may be {} when hashes missing — accept either
    // undefined or empty.
    const ts = content[0]!.chainTimestamps;
    if (ts !== undefined) {
      expect(Object.keys(ts).length).toBe(0);
    }
    mock.patch('info', undefined);
    mock.patch('cut', undefined);
  });
});
