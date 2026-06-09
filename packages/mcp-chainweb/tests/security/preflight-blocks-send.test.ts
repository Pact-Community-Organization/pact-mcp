/**
 * @fileoverview Security test: preflight failure MUST block the downstream
 *               POST to /send. The check is defence-in-depth: even a
 *               malicious caller that sets a skip flag cannot bypass the
 *               preflight guard.
 */

import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { createChainwebClient } from '../../src/client/fetch.js';
import { createSendTool } from '../../src/tools/send.js';
import {
  startMockChainweb,
  type MockHandle
} from '../fixtures/mock-chainweb.js';

const SIGNED_TX = {
  cmd: '{"networkId":"development","payload":{"exec":{"code":"(+ 1 2)"}}}',
  hash: 'mock-hash',
  sigs: [{ sig: 'a'.repeat(128) }]
};

describe('preflight-blocks-send', () => {
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

  test('preflight status=failure → throws PREFLIGHT_FAILED and never hits /send', async () => {
    mock.patch('local', {
      reqKey: 'pre',
      result: {
        status: 'failure',
        error: { message: 'gas limit exceeded' }
      },
      gas: 999_999
    });
    // If /send is hit, this mock would return success — we assert it isn't.
    mock.patch('send', { requestKeys: ['SHOULD-NEVER-SEE'] });

    const startIdx = mock.requests.length;
    const tool = createSendTool({ client: client() });
    await expect(
      tool({ chainId: '0', signedTx: SIGNED_TX })
    ).rejects.toMatchObject({ code: 'PREFLIGHT_FAILED' });

    const after = mock.requests.slice(startIdx);
    const sendHits = after.filter((r) => /\/send$/.test(r.url));
    expect(sendHits).toHaveLength(0);
    mock.patch('local', undefined);
    mock.patch('send', undefined);
  });

  test('preflight HTTP 500 → surfaces as CHAINWEB_HTTP_ERROR, no /send attempt', async () => {
    mock.patch('localStatus', 500);
    mock.patch('local', { error: 'upstream boom' });
    mock.patch('send', { requestKeys: ['SHOULD-NEVER-SEE'] });

    const startIdx = mock.requests.length;
    const tool = createSendTool({ client: client() });
    await expect(
      tool({ chainId: '0', signedTx: SIGNED_TX })
    ).rejects.toMatchObject({ code: 'CHAINWEB_HTTP_ERROR' });

    const after = mock.requests.slice(startIdx);
    expect(after.some((r) => /\/send$/.test(r.url))).toBe(false);

    mock.patch('localStatus', undefined);
    mock.patch('local', undefined);
    mock.patch('send', undefined);
  });
});
