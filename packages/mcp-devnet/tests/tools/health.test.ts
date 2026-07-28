/**
 * @fileoverview Unit tests — src/tools/health.ts
 */

import { describe, it, expect, afterEach } from 'vitest';
import { createAllowlistedFetch } from '@pact-community/mcp-shared';

import { createHealthTool } from '../../src/tools/health.js';
import {
  startMockDevnet,
  DEFAULT_INFO,
  makeCut,
  type MockDevnetHandle
} from '../fixtures/mock-devnet.js';

const servers: MockDevnetHandle[] = [];
afterEach(async () => {
  while (servers.length > 0) {
    const s = servers.pop();
    if (s) await s.close();
  }
});

async function makeMock(
  spec: Parameters<typeof startMockDevnet>[0] = {}
): Promise<MockDevnetHandle> {
  const s = await startMockDevnet(spec);
  servers.push(s);
  return s;
}

describe('devnet_health tool', () => {
  it('reports reachable:true when /info and /cut both respond', async () => {
    const wallNow = Math.floor(Date.now() / 1000);
    const mock = await makeMock({
      info: DEFAULT_INFO,
      cut: makeCut(wallNow, 0)
    });
    const fetchImpl = createAllowlistedFetch([], {
      additionalAllowedOrigins: [mock.origin]
    });
    const tool = createHealthTool({
      fetchImpl,
      baseUrlFor: () => mock.url
    });
    const { content } = await tool({ agent: 'Developer' });
    const r = content[0]!;
    expect(r.reachable).toBe(true);
    expect(r.networkId).toBe('development');
    expect(r.nodeVersion).toBe('chainweb-node-2.21.0-test');
    expect(r.chainCount).toBe(10);
    expect(r.genesisCaughtUp).toBe(true);
  });

  it('reports genesisCaughtUp:false when chain time lags beyond the window', async () => {
    const wallNow = Math.floor(Date.now() / 1000);
    const mock = await makeMock({
      info: DEFAULT_INFO,
      cut: makeCut(wallNow, 3600) // 1 hour behind
    });
    const fetchImpl = createAllowlistedFetch([], {
      additionalAllowedOrigins: [mock.origin]
    });
    const tool = createHealthTool({
      fetchImpl,
      baseUrlFor: () => mock.url
    });
    const { content } = await tool({ agent: 'Developer' });
    expect(content[0]!.reachable).toBe(true);
    expect(content[0]!.genesisCaughtUp).toBe(false);
  });

  it('returns reachable:false without throwing when /info is unreachable', async () => {
    // Point at a closed port
    const fetchImpl = createAllowlistedFetch([], {
      additionalAllowedOrigins: ['http://127.0.0.1:1']
    });
    const tool = createHealthTool({
      fetchImpl,
      baseUrlFor: () => 'http://127.0.0.1:1'
    });
    const { content } = await tool({ agent: 'Developer' });
    expect(content[0]!.reachable).toBe(false);
    expect(content[0]!.error).toBeDefined();
  });

  it('returns reachable:true with genesisCaughtUp:false when /cut 500s', async () => {
    const mock = await makeMock({ info: DEFAULT_INFO, cut: null });
    const fetchImpl = createAllowlistedFetch([], {
      additionalAllowedOrigins: [mock.origin]
    });
    const tool = createHealthTool({
      fetchImpl,
      baseUrlFor: () => mock.url
    });
    const { content } = await tool({ agent: 'Developer' });
    expect(content[0]!.reachable).toBe(true);
    expect(content[0]!.genesisCaughtUp).toBe(false);
  });

  it('propagates NETWORK_ALLOWLIST_VIOLATION as a thrown McpToolError', async () => {
    // Strict allowlist — mock origin not included.
    const fetchImpl = createAllowlistedFetch(['http://localhost:9999']);
    const tool = createHealthTool({
      fetchImpl,
      baseUrlFor: () => 'http://localhost:8888' // not allowed
    });
    await expect(tool({ agent: 'Developer' })).rejects.toMatchObject({
      code: 'NETWORK_ALLOWLIST_VIOLATION'
    });
  });

  it('rejects unknown agent', async () => {
    const fetchImpl = createAllowlistedFetch([]);
    const tool = createHealthTool({ fetchImpl });
    await expect(tool({ agent: 'Rogue' })).rejects.toThrow();
  });

  it('records latency in ms', async () => {
    const wallNow = Math.floor(Date.now() / 1000);
    const mock = await makeMock({
      info: DEFAULT_INFO,
      cut: makeCut(wallNow, 0)
    });
    const fetchImpl = createAllowlistedFetch([], {
      additionalAllowedOrigins: [mock.origin]
    });
    const tool = createHealthTool({
      fetchImpl,
      baseUrlFor: () => mock.url
    });
    const { content } = await tool({ agent: 'Developer' });
    expect(content[0]!.latencyMs).toBeGreaterThanOrEqual(0);
    expect(content[0]!.latencyMs).toBeLessThan(5000);
  });
});
