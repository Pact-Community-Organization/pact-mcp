/**
 * @fileoverview Tests for chainweb.spv_proof.
 */

import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { createChainwebClient } from '../../src/client/fetch.js';
import { createSpvProofTool } from '../../src/tools/spv-proof.js';
import {
  startMockChainweb,
  type MockHandle
} from '../fixtures/mock-chainweb.js';

describe('chainweb.spv_proof', () => {
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

  test('ready=true with proof string when server returns JSON-encoded string', async () => {
    // JSON response where the body IS a JSON string: "eyJ..."
    mock.patch('spv', 'eyJwcm9vZiI6ImJhc2U2NCJ9');
    const tool = createSpvProofTool({ client: makeClient() });
    const { content } = await tool({
      sourceChainId: '0',
      targetChainId: '1',
      requestKey: 'req-key-abc'
    });
    expect(content[0]!.ready).toBe(true);
    expect(content[0]!.proof).toBe('eyJwcm9vZiI6ImJhc2U2NCJ9');
  });

  test('ready=false when server returns plain-text "proof not ready"', async () => {
    mock.patch('spv', 'SPV proof not ready');
    mock.patch('spvContentType', 'text/plain');
    const tool = createSpvProofTool({ client: makeClient() });
    const { content } = await tool({
      sourceChainId: '0',
      targetChainId: '1',
      requestKey: 'req-key-abc'
    });
    expect(content[0]!.ready).toBe(false);
    expect(content[0]!.message).toMatch(/not ready/i);
    expect(content[0]!.proof).toBeUndefined();
    mock.patch('spvContentType', undefined);
    mock.patch('spv', undefined);
  });

  test('ready=false when server returns 400 with "awaiting" message', async () => {
    mock.patch('spv', { error: 'awaiting cut confirmation' });
    mock.patch('spvStatus', 400);
    const tool = createSpvProofTool({ client: makeClient() });
    const { content } = await tool({
      sourceChainId: '0',
      targetChainId: '1',
      requestKey: 'req-key-abc'
    });
    expect(content[0]!.ready).toBe(false);
    expect(content[0]!.message).toMatch(/awaiting/i);
    mock.patch('spvStatus', undefined);
    mock.patch('spv', undefined);
  });

  test('rejects sourceChainId === targetChainId', async () => {
    const tool = createSpvProofTool({ client: makeClient() });
    await expect(
      tool({
        sourceChainId: '0',
        targetChainId: '0',
        requestKey: 'req-key-abc'
      })
    ).rejects.toMatchObject({ code: 'SPV_SAME_CHAIN' });
  });

  test('POSTs body {requestKey, targetChainId}', async () => {
    mock.patch('spv', 'proof-base64');
    const before = mock.requests.length;
    const tool = createSpvProofTool({ client: makeClient() });
    await tool({
      sourceChainId: '2',
      targetChainId: '5',
      requestKey: 'req-key-xyz'
    });
    const last = mock.requests
      .slice(before)
      .find((r) => /\/pact\/spv$/.test(r.url));
    expect(last).toBeDefined();
    expect(last!.url).toContain('/chain/2/pact/spv');
    const body = JSON.parse(last!.body) as Record<string, unknown>;
    expect(body).toEqual({ requestKey: 'req-key-xyz', targetChainId: '5' });
  });

  test('unexpected response shape → ready=false with diagnostic message', async () => {
    mock.patch('spv', { unexpected: 'shape', notAString: 42 });
    const tool = createSpvProofTool({ client: makeClient() });
    const { content } = await tool({
      sourceChainId: '0',
      targetChainId: '1',
      requestKey: 'req-key-abc'
    });
    expect(content[0]!.ready).toBe(false);
    expect(content[0]!.message).toContain('Unexpected SPV response shape');
    mock.patch('spv', undefined);
  });
});
