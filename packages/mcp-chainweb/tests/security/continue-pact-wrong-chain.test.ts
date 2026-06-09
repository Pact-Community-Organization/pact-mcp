/**
 * @fileoverview Security: continue_pact surfaces wrong-chain/proof errors.
 *
 * When the SPV proof or continuation chain is wrong, chainweb's `/local`
 * returns status=failure with a message. The tool MUST:
 *   - NOT invoke /send
 *   - return submitted=false with preflight.ok=false
 *   - include the (sanitized) error message
 */

import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { createChainwebClient } from '../../src/client/fetch.js';
import { createContinuePactTool } from '../../src/tools/continue-pact.js';
import {
  startMockChainweb,
  type MockHandle
} from '../fixtures/mock-chainweb.js';

const SIGNER_KEY =
  '368820f80c324bbc7c2b0610688a7da43e39f91d118732671cd9c7500ff43cca';

describe('continue_pact: wrong-chain / bad-proof surfacing', () => {
  let mock: MockHandle;

  beforeAll(async () => {
    mock = await startMockChainweb();
  });
  afterAll(async () => {
    await mock.close();
  });

  test('bad proof on cross-chain cont → submitted=false, no /send', async () => {
    mock.patch('localCont', {
      reqKey: 'rk',
      result: {
        status: 'failure',
        error: { message: 'SPV proof subject mismatch: wrong target chain' }
      },
      gas: 100
    });
    const client = createChainwebClient({
      baseUrl: mock.baseUrl,
      networkId: 'development',
      allowedOrigins: [],
      additionalAllowedOrigins: [mock.origin]
    });
    const before = mock.requests.length;
    const tool = createContinuePactTool({ client });
    const { content } = await tool({
      pactId: 'pact-id-abc',
      step: 1,
      targetChainId: '5',
      proof: 'eyJwcm9vZiI6ImJhc2U2NCJ9',
      signerKey: SIGNER_KEY,
      sigs: [{ sig: 'a'.repeat(128) }]
    });

    expect(content[0]!.submitted).toBe(false);
    expect(content[0]!.preflight.ok).toBe(false);
    expect(content[0]!.preflight.error).toMatch(/SPV proof|subject mismatch/i);
    const after = mock.requests.slice(before);
    expect(after.some((r) => /\/send$/.test(r.url))).toBe(false);
  });
});
