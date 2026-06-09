/**
 * @fileoverview Security: spv_proof surfaces "not ready" without throwing.
 *
 * Tx-not-yet-mined cases must return `ready: false` — a caller loop MUST
 * NOT see an exception for this expected state, else they'd treat it as a
 * terminal failure.
 */

import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { createChainwebClient } from '../../src/client/fetch.js';
import { createSpvProofTool } from '../../src/tools/spv-proof.js';
import {
  startMockChainweb,
  type MockHandle
} from '../fixtures/mock-chainweb.js';

describe('spv_proof: not-ready detection', () => {
  let mock: MockHandle;

  beforeAll(async () => {
    mock = await startMockChainweb();
  });
  afterAll(async () => {
    await mock.close();
  });

  function makeTool() {
    return createSpvProofTool({
      client: createChainwebClient({
        baseUrl: mock.baseUrl,
        networkId: 'development',
        allowedOrigins: [],
        additionalAllowedOrigins: [mock.origin]
      })
    });
  }

  const notReadyMessages = [
    'SPV proof not ready',
    'tx not yet mined',
    'proof not yet available',
    'still pending'
  ];

  for (const msg of notReadyMessages) {
    test(`ready=false for plain-text: ${msg}`, async () => {
      mock.patch('spv', msg);
      mock.patch('spvContentType', 'text/plain');
      const { content } = await makeTool()({
        sourceChainId: '0',
        targetChainId: '1',
        requestKey: 'req-key'
      });
      expect(content[0]!.ready).toBe(false);
      mock.patch('spvContentType', undefined);
      mock.patch('spv', undefined);
    });
  }

  test('does NOT throw on not-ready response', async () => {
    mock.patch('spv', 'SPV proof not ready');
    mock.patch('spvContentType', 'text/plain');
    await expect(
      makeTool()({
        sourceChainId: '0',
        targetChainId: '1',
        requestKey: 'req-key'
      })
    ).resolves.toBeDefined();
    mock.patch('spvContentType', undefined);
    mock.patch('spv', undefined);
  });

  test('DOES throw on genuine server errors (non-match regex)', async () => {
    mock.patch('spv', 'internal server error');
    mock.patch('spvStatus', 500);
    await expect(
      makeTool()({
        sourceChainId: '0',
        targetChainId: '1',
        requestKey: 'req-key'
      })
    ).rejects.toMatchObject({ code: 'CHAINWEB_HTTP_ERROR' });
    mock.patch('spvStatus', undefined);
    mock.patch('spv', undefined);
  });
});
